// PostCompact：压缩后回注不变量——把「压缩会删掉治理约束」这件事自动补上。
// 压缩不是稀释约束，是主动删除：摘要器为任务连续性服务，二十轮没被引用过的铁律正是它最先丢的。
// 而摘要本身也不修正漂移——它把漂移原样带过去。所以这里不读摘要，改跑 harness invariants
// 从 CLAUDE.md / progress.md / 运行态重新派生「什么不能被交易掉 + 现在处在什么状态」，
// 经 additionalContext 注回当前轮。约 1200 字符预算：注回的东西太长，下一次压缩会把它一起吃掉。
// 与 precompact-gate 是压缩前后两端，不重复：那个在压缩前拦一次让人先固化，这个在压缩后补回来。
// 官方契约（code.claude.com/docs/en/hooks 核证）：
//   输入 compact_trigger / compaction_ratio / messages_before / messages_after 等字段；
//   输出支持顶层 additionalContext 与 systemMessage，PostCompact 无 decision control（拦不住，也不该拦）。
// 守卫（压缩已经发生了，拦也没用；但不许静默）：
//   - 引擎缺失 / 退出码不在 0|3 契约内 → 打可见的降级说明（systemMessage），退出 0 不阻断；
//   - 引擎输出解析不出来 → 同上，说清是哪一步没成，别让人以为不变量已经回来了。
//   - 大仓包（.claude/harness/ext/）没装 → 不是降级，是走自带的最小派生：Pinned + 待审 + 档位。
//     这是地板闸，不能吊在一个默认不装的可选包上；「装了才有不变量」等于绝大多数项目压缩完什么都没回来。
// 地板闸（profile.floor），任何档位都改不了：压缩已经把约束删了，这跟赶不赶进度没关系。
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, readStdinRaw, emit } from './lib/io.mjs';
import { harnessEntry, harnessRun, rcInContract } from './lib/harness.mjs';

// 降级说明用固定常量串输出——这条路径上引擎可能根本跑不起来，
// 而含变量的手拼文案一旦引号没转义就是坏 JSON（坏 JSON 会被记成 hook error，等于白注）。
// 没有 no-node 一档：本 hook 自己就是 node 起的，跑到这行说明 node 在。
const DEGRADE = {
  'no-harness': 'PostCompact: .claude/harness/harness.mjs is missing, so the invariants could not be re-derived after this compaction. The non-negotiable rules and the live state were NOT re-injected -- read .claude/CLAUDE.md and progress.md before acting on anything the summary implies.',
  engine: 'PostCompact: the harness failed while re-deriving the invariants after this compaction (see the debug log for its exit code and stderr). The non-negotiable rules and the live state were NOT re-injected -- fix the engine, or read .claude/CLAUDE.md and progress.md before acting on anything the summary implies.',
};

function degrade(kind) {
  emit({ systemMessage: DEGRADE[kind] || DEGRADE.engine });
  process.exitCode = 0;
}

const BUDGET = 1200;                 // 与引擎那条路径同一份预算：注回的东西太长，下次压缩会把它一起吃掉
const NO_ENGINE = 'PostCompact: invariants re-derived without the engine (ext not installed)';

/** 大仓包（harness/ext/）装没装。目标项目默认不装（setup.sh --with-harness 才有），所以这是最常见的那条路。 */
function extInstalled(root) {
  try { return fs.existsSync(path.join(root, '.claude', 'harness', 'ext')); } catch (_e) { return false; }
}

/** progress.md 的 Pinned 段：`- ` 开头的条目，最多 12 条、每条 120 字符。文件不在返回 null（≠ 空段）。 */
function pinnedOf(root) {
  let raw;
  try { raw = fs.readFileSync(path.join(root, 'progress.md'), 'utf8'); } catch (_e) { return null; }
  const items = [];
  let inside = false;
  for (const line of raw.split(/\r?\n/)) {
    // 标题按前缀认：仓里写的是「## Pinned（必守）」，要求逐字相等就永远命不中
    if (/^##\s/.test(line)) { inside = /^##\s*Pinned/i.test(line); continue; }
    if (inside && line.startsWith('- ')) {
      const text = line.slice(2).trim();
      // 「→ 被 … 取代」的条目是历史，不是现行规则。把它当铁律注回去比不注回更坏：
      // 压缩后的下一轮会照着已经作废的口径办事，而正文里那半句「被取代」在摘要里早没了。
      if (text.includes('→ 被') && text.includes('取代')) continue;
      // 截断处留个「…」：120 字砍在半句上，读的人得看得出这条没说完，别把半句当全文。
      items.push(text.length > 120 ? `${text.slice(0, 120)}…` : text);
      if (items.length >= 12) break;
    }
  }
  return items;
}

/** .claude/.needs-review 的待审文件。`clean` 是「口头释放」的标记，不是文件名，得刨掉。 */
function pendingOf(root) {
  try {
    return fs.readFileSync(path.join(root, '.claude', '.needs-review'), 'utf8')
      .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== 'clean');
  } catch (_e) { return []; }
}

/** 档位与来源；判定库起不来返回 null——读不出档位就说读不出，不许填一个具体档蒙过去。 */
async function tierOf(root) {
  try {
    const m = await import('./lib/tier.mjs');
    const t = m.effectiveTier({ projectDir: root });
    return `${t.tier}（来源 ${t.source}）`;
  } catch (_e) { return null; }
}

/**
 * 引擎不在时的最小回注：三样都是现读文件派生的，一样都没读到也要把「没读到什么」说出来——
 * 「什么都没说」和「没有约束」在下一轮里长得一模一样，那正是压缩刚刚制造的处境。
 */
async function reinjectWithoutEngine(root) {
  const pins = pinnedOf(root);
  const pending = pendingOf(root);
  const tier = await tierOf(root);
  const gaps = [];
  if (!pins || !pins.length) gaps.push(pins ? 'progress.md 没有 Pinned 段，约束未回注' : 'progress.md 不在，Pinned 约束未回注');
  if (!tier) gaps.push('档位判定库起不来，当前档位未知');

  const body = [
    '# INVARIANTS —— 引擎未装，以下由 hook 直接从文件派生',
    '',
    '## 这棵树现在的状态',
    `- 档位：${tier || '未知'}`,
    `- 待审文件：${pending.length ? `${pending.length} 个（${pending.slice(0, 5).join('、')}）` : '无'}`,
  ];
  if (pins && pins.length) body.push('', '## Pinned（progress.md）', ...pins.map((p) => `- ${p}`));
  const head = '刚刚发生了一次上下文压缩。压缩不是把约束稀释了，是把它们删了；下面这份是刚从文件重新派生的，不是从摘要里回忆的——按它校准。\n\n';
  // 预算砍掉的那部分得说一声：注回的正文本身就是「现在还剩什么约束」的全部证据，
  // 无声截断等于让下一轮把「没注回来」读成「没有了」。标记算进预算内，不挤到预算外。
  const full = head + body.join('\n');
  const mark = '\n（已按预算截断）';
  emit({
    systemMessage: gaps.length ? `${NO_ENGINE} -- ${gaps.join('；')}` : NO_ENGINE,
    additionalContext: full.length > BUDGET ? full.slice(0, BUDGET - mark.length) + mark : full,
  });
  process.exitCode = 0;
}

// 消费 stdin（事件 JSON：compact_trigger / compaction_ratio / messages_before|after）
const rawEvent = readStdinRaw();

try {
  const root = projectDir();
  if (!extInstalled(root)) {
    await reinjectWithoutEngine(root);
  } else if (!fs.existsSync(harnessEntry())) {
    degrade('no-harness');
  } else {
    const r = harnessRun(['invariants'], { cwd: root });
    // 契约：0 = 派生到了，3 = 源文件缺失但活跃状态仍然派生到了（两者都值得注回）。
    // 其余退出码 = 引擎自己出岔，不是「没有不变量」这个结论。
    // rc 3 + not installed 是上面那条 existsSync 的另一半：引擎按自己的位置找 ext，
    // 与 CLAUDE_PROJECT_DIR 指的未必是同一处，两边都认才不会在装歪的树上报「引擎失败」。
    if (rcInContract(r.status, 3) && /not installed/i.test(String(r.stderr || ''))) {
      await reinjectWithoutEngine(root);
    } else if (!rcInContract(r.status, 0, 3) || !r.stdout.trim()) {
      degrade('engine');
    } else {
      const parse = (s) => { try { return JSON.parse(s || ''); } catch (_e) { return null; } };
      const inv = parse(r.stdout);
      const ev = parse(rawEvent) || {};
      if (!inv || typeof inv.text !== 'string') {
        degrade('engine');
      } else {
        const bits = [];
        if (typeof ev.compact_trigger === 'string') bits.push('trigger=' + ev.compact_trigger);
        if (typeof ev.compaction_ratio === 'number') bits.push('compaction_ratio=' + ev.compaction_ratio);
        if (typeof ev.messages_before === 'number' && typeof ev.messages_after === 'number') {
          bits.push('messages ' + ev.messages_before + ' -> ' + ev.messages_after);
        }
        const what = bits.length ? '（' + bits.join('，') + '）' : '';
        const head = '刚刚发生了一次上下文压缩' + what
          + '。压缩不是把约束稀释了，是把它们删了；'
          + '摘要也不修正漂移，只会把漂移原样带过去。'
          + '下面这份是刚从文件重新派生的，不是从摘要里回忆的'
          + '——按它校准，别按压缩后的印象走。\n\n';
        const ratio = typeof ev.compaction_ratio === 'number' ? ' (compaction_ratio=' + ev.compaction_ratio + ')' : '';
        emit({
          systemMessage: 'PostCompact: invariants re-derived from files and re-injected' + ratio + '.',
          additionalContext: head + inv.text,
        });
        process.exitCode = 0;
      }
    }
  }
} catch (_e) {
  degrade('engine');
}
