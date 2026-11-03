// PostToolUse(Edit|Write)：大仓定向门的后台早警——asyncRewake 形态（settings 里
// async+asyncRewake 注册，本脚本只管跑与退出码）。
// 与 pre-commit-check 的关系：commit 闸仍是同步硬门；本 hook 在两次 commit 之间的编辑期
// 后台跑同一套 harness verify（四态门+五性证据门），FAIL/BLOCKED 时 exit 2 唤醒主 Agent
// 读 stderr 摘要——失败早暴露（fail-visible），不挤占交互时延。
// 启用条件与降级：catalog 存在才跑（大仓治理默认关闭）；档位 off（fast 档）静默放行（质量闸）；
// 180 秒防抖（.async-verify-last 记上次运行 epoch，异步并发场景先写后跑防风暴）；标记写不下时
// 防抖是永久失效而非多跑一次，那一行诊断必须留下，不吞。
// 摘要预算：只回 gate + 失败/受阻 check 前 5 条 + 属性缺口计数，不贴全量 JSON。
// 引擎包未装的提醒每个 session 只说一次、只记一次账：.claude/.runtime/async-verify-ext-notice 记已经
//   提醒过的 session 标识（stdin 的 session_id，没有就按天）。下游 30 天这一句记了 38 条，内容一字不差。
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, readStdinRaw, readTextFile, say, errText, fastOff } from './lib/io.mjs';
import { gateLog } from './lib/gatelog.mjs';
import { harnessEnabled, harnessExtInstalled, harnessExtMissingNotice, harnessRun, rcInContract, errHead } from './lib/harness.mjs';

const DEBOUNCE_SEC = 180;

/** 本次事件归哪个 session：stdin 的 session_id；没有（或 stdin 不是 JSON）就按 UTC 日期，一天说一次。 */
function sessionKey(raw) {
  let ev = null;
  try { ev = JSON.parse(raw); } catch (_e) { ev = null; }
  const id = ev && typeof ev === 'object' ? String(ev.session_id || '').trim() : '';
  return id ? `session:${id}` : `day:${new Date().toISOString().slice(0, 10)}`;
}

/** 这个 session 是不是已经说过「引擎包未装」：标记内容与本次标识一致才算；读不出一律当没说过。 */
function extNoticeSaid(file, key) {
  const st = readTextFile(file);
  return Boolean(st.text) && st.text.replace(/\r/g, '').split('\n')[0] === key;
}

/** 上次跑完的 epoch；文件缺失 / 不是纯数字都当「没跑过」。 */
function lastRun(mark) {
  const state = readTextFile(mark);
  const m = (state.text || '').replace(/\r/g, '').match(/^([0-9]+)$/m);
  return m ? Number(m[1]) : null;
}

/** verify 的 stdout 压成人读得完的几行；解析不出就给一句「自己去跑全量」。 */
function summarize(stdout) {
  let d;
  try { d = JSON.parse(stdout); } catch (_e) { d = null; }
  if (!d || typeof d !== 'object') {
    return 'verify rc=2（FAIL/BLOCKED 或五性证据缺口）——跑 node .claude/harness/harness.mjs verify 看全量';
  }
  const lines = [`gate=${d.gate || d.state || 'FAIL'}`];
  if (d.emptyPlan) lines.push('空验证计划：受影响模块没有任何 check（配置缺口，不算绿）');
  const bad = (Array.isArray(d.checks) ? d.checks : []).filter((c) => c && (c.state === 'FAIL' || c.state === 'BLOCKED'));
  for (const c of bad.slice(0, 5)) {
    lines.push(`- ${c.module || '?'} [${c.state}] ${c.id} ${c.reason || `exit=${c.exit}`}`);
  }
  if (bad.length > 5) lines.push(`- …另有 ${bad.length - 5} 条`);
  const gaps = d.attributeGaps || [];
  if (gaps.length) lines.push(`五性证据缺口 ${gaps.length} 处（critical/high 属性缺认领 PASS）`);
  return lines.join('\n');
}

async function main() {
  if (await fastOff('harness-async-verify')) return;

  // 消费 stdin（file_path 不用——verify 自己从 git 工作树算 changed 集；只取 session_id 给提醒去重）
  const raw = readStdinRaw();

  if (!harnessEnabled()) return;

  const root = projectDir();
  const mark = path.join(root, '.claude', '.async-verify-last');
  const now = Math.floor(Date.now() / 1000);
  const last = lastRun(mark);
  if (last !== null && now - last < DEBOUNCE_SEC) return;
  // 先写后跑：异步并发下后来者要立刻看到「有人在跑」，写在跑完之后就挡不住风暴
  try {
    fs.writeFileSync(mark, `${now}\n`);
  } catch (e) {
    // 标记写不下 → lastRun() 此后永远读不出 epoch → 防抖是**永久**失效，不是只多跑一次：
    // 每一次 Edit|Write 都要全量跑一遍 verify。本轮照跑（早警比防抖重要），但不许静默——
    // 用户那头只看得到「编辑变慢了」，没这一行就找不到原因。
    say(`[harness-async-verify] 防抖标记写不下（${errText(e)}），本轮防抖失效`);
  }

  // catalog 在、引擎包（harness/ext）不在：verify 只会 rc 3 降级，早警一次也没跑成。不唤醒
  // （早警本就不硬拦），但这一句必须出——否则编辑期看着像「后台一直在验、都没问题」。
  // 放在防抖之后：这是每次 Edit|Write 都会走的路，摆在防抖前就是每敲一下刷一句。
  // 一个 session 说一次就够：同一句话每过 180 秒刷一遍、记一条账，只会把它刷成没人看的噪音。
  if (!harnessExtInstalled()) {
    const noticeMark = path.join(root, '.claude', '.runtime', 'async-verify-ext-notice');
    const key = sessionKey(raw);
    if (extNoticeSaid(noticeMark, key)) return;
    const notice = harnessExtMissingNotice('编辑期后台质量门（harness verify）');
    say(`[harness-async-verify] ${notice}`);
    gateLog('harness-async-verify', notice);
    try {
      fs.mkdirSync(path.dirname(noticeMark), { recursive: true });
      fs.writeFileSync(noticeMark, `${key}\n`);
    } catch (e) {
      // 记不下 = 这个 session 每过防抖都会再说一次，退回旧行为；原因得留一行，不吞
      say(`[harness-async-verify] 提醒去重标记写不下（${errText(e)}），本 session 会重复提醒`);
    }
    return;
  }

  const r = harnessRun(['verify'], { cwd: root });

  // 契约外退出码（verify 契约只有 0/2/3）= 引擎自己崩了、门没跑成。早警不硬拦（commit 硬门仍是
  // pre-commit-check），但闸跑不起来这件事同样得说话——照唤醒形态发一条可见诊断，不静默 exit 0 吞掉。
  if (!rcInContract(r.status, 0, 2, 3)) {
    process.exitCode = 2;
    say(`[harness-async-verify] 编辑期后台质量门跑不起来：harness verify 以契约外退出码 ${r.status} 退出（契约只有 0/2/3）。`);
    say(errHead(r.stderr) || '（引擎无 stderr 输出）');
    say('这是引擎异常（如 .claude/harness/ext/ 半装或损坏、node 出岔），不是门未过；commit 时 pre-commit-check 会硬拦，建议现在就修引擎。');
    gateLog('harness-async-verify', `后台 verify 以契约外退出码 ${r.status} 退出（引擎异常，早警）`);
    return;
  }
  if (r.status !== 2) return;

  process.exitCode = 2;
  say('[harness-async-verify] 编辑期后台质量门未过：');
  say(summarize(r.stdout));
  say('commit 前会被 pre-commit-check 硬拦，建议现在就修或派 bug-fixer。');
  gateLog('harness-async-verify', '后台 verify 未过（早警，非硬拦）');
}

// 闸自身崩了（stdin 读不了、防抖文件读写抛错、判定中途出岔）不许静默 exit 0——那等于把
// 「早警根本没跑」伪装成「跑过了、没问题」。本 hook 没有 decision 通道，fail-closed 在这里
// 的形态是唤醒：一行诊断 + exit 2，主 Agent 至少知道这轮没人验过。
main().catch((e) => {
  process.exitCode = 2;
  say(`[harness-async-verify] 早警自身异常，按唤醒处理（本轮未验）：${errText(e)}`);
});
