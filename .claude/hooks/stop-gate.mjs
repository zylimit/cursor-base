// Stop hook: 有项目代码待 review 时阻止停止
// 状态文件 .needs-review（按文件登记，每行一个相对路径）
// 优先级反转（防 clean 与待审路径混存被误放行）：
//   - 去掉空行与 "clean" 行后，仍有文件 = 阻止并列出
//   - 否则（只剩 clean / 全空 / 不存在）= 放行并清理
// 连拦上限（防死锁）：.stop-gate-strikes（sig=/count= 两行自描述，损坏当无状态重建）记
//   同一待审清单被连拦的次数——子代理场景无法自行派 reviewer 满足闸条件，会被无限重验。
//   同一清单连拦 3 次后第 4 次放行并醒目提示欠账仍在；正常放行或清单变化即清零重计。
// 放行契约（向后兼容）：审查通过后 `echo clean > .claude/.needs-review` 即可。
// 删状态文件一律 rmSync(..., {force:true})：删不掉又被静默吞掉时 .stop-gate-strikes 会残留，
//   下一轮同一清单立刻撞上限提前放行——闸把自己关了（历史缺陷 81c63c9）。
// 档位（profile.json）：off 静默放行；advise（fast / standard 档）照判照记账，但出 systemMessage
//   而不是 decision:block，也不动 .needs-review 与连拦计数；block（strict 档，人当审批者时）
//   走上面全部逻辑。默认档只提醒是因为放行契约本就是被约束方自己 `echo clean`、外加三振自动
//   放行，本质是提醒；2026-09-03 一天拦 38 次、单小时 12 次，纯空转。
// advise 档去重：.stop-gate-advised（sig= / ts= 两行）记上次提醒的清单签名与时间，同一清单且未满
//   ADVISE_REPEAT_MS 就静默放行（不出 systemMessage、不写账本）；清单变了、清空后重现、满时限都再提醒一次。
//   读写与常量在 lib/advise-dedup.mjs，与 three-file-sync-gate / tdd-gate 共用一份。
//   读写失败一律当没记过（宁可多提醒，不许状态文件坏了就永久静默）；block 档不碰这个文件。
// fail-closed：闸自身出错（含状态文件清理失败）绝不静默放行，一律拦停。不读 stdin。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { projectDir, readTextFile, pendingReviewLines, emit, gateModeOf, runFailClosed } from './lib/io.mjs';
import { gateLog } from './lib/gatelog.mjs';
import { recentlyAdvised, recordAdvised, clearAdvised } from './lib/advise-dedup.mjs';
import { harnessEnabled, harnessExtInstalled, harnessExtMissingNotice, harnessRun, rcInContract, errHead } from './lib/harness.mjs';

/** 读连拦计数：只认与本次 sig 相同的记录，sig 一变即从 0 重计；文件损坏当无状态。 */
function readStrikes(file, sig) {
  const st = readTextFile(file);
  if (!st.text) return 0;
  const lines = st.text.replace(/\r/g, '').split('\n');
  const oldSig = (lines.find((l) => l.startsWith('sig=')) || '').slice(4);
  const oldN = (lines.find((l) => l.startsWith('count=')) || '').slice(6);
  if (oldSig !== sig) return 0;
  return /^\d+$/.test(oldN) ? Number(oldN) : 0;
}

function writeStrikes(file, sig, n) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `sig=${sig}\ncount=${n}\n`);
}

/** 拦停：账本 + decision JSON 一起走（gate-audit 靠账本统计哪些闸真拦下过东西）。 */
function blockWith(reason) {
  gateLog('stop-gate', reason);
  emit({ decision: 'block', reason });
}

/**
 * advise 档（默认档就是它）：同一段话照说、照记账，只是不拦。
 * 不 block ≠ 不吭声——欠账得看得见，gate-audit 也要统计得出「advise 档跳过了什么」。
 * 前缀写 [advise] 不写 [fast]：standard 档也走这条路，写死 fast 会让默认档的人以为有人开了放水。
 */
function adviseWith(reason) {
  const msg = `[advise] ${reason}`;
  gateLog('stop-gate', msg);
  emit({ systemMessage: msg });
}

/** 达连拦上限时的放行：不是「过了」，是欠账带着放行，必须让人看见。 */
function releaseWith(notice) {
  gateLog('stop-gate', notice);
  emit({ systemMessage: notice });
}

runFailClosed(async () => {
  const mode = await gateModeOf('stop-gate');
  if (mode === 'off') return;
  // advise 档只换出口形态（systemMessage 而不是 decision:block），判定与状态文件一个都不少
  const advise = mode === 'advise';
  const decide = (reason) => (advise ? adviseWith(reason) : blockWith(reason));

  const root = projectDir();
  const stateFile = path.join(root, '.claude', '.needs-review');
  const strikeFile = path.join(root, '.claude', '.stop-gate-strikes');
  const advisedFile = path.join(root, '.claude', '.stop-gate-advised');

  const state = readTextFile(stateFile);
  if (state.absent) { fs.rmSync(strikeFile, { force: true }); if (advise) clearAdvised(advisedFile); return; }
  // 读不出来 ≠ 没有：状态未知时放行就是拿「没看到欠账」当「没有欠账」，交给 fail-closed
  if (state.error) throw state.error;

  const files = pendingReviewLines(state.text);

  if (files.length === 0) {
    // 大仓回执网关（catalog 存在才启用；不启用时走原逻辑零行为变化）：清单已清空（口头释放）后，
    // 再校验当前工作树 diff 是否有已通过回执绑定——代码越过所有已审回执（STALE, rc=4）则强制重审，
    // 此时不清状态文件、保留 .needs-review 让下轮仍拦；rc=0/3 照原样清理放行。
    // 契约外退出码（receipt verify 契约只有 0/3/4）= 引擎自己崩了、闸压根没跑成，放行就是假绿：同样拦停、
    // 点名实际退出码、保留 .needs-review，并走同一套 .stop-gate-strikes 三振熔断（引擎长期崩不至于拦死人）。
    if (harnessEnabled()) {
      // catalog 在、引擎包（harness/ext）不在：receipt verify 只会 rc 3 降级，回执绑定压根没被验过。
      // 不拦（装不装包是人的决定，不该拿它卡住停止），也不动 .needs-review 与连拦计数，但必须出声——
      // 静默放行与「验过了没问题」在这里长得一模一样，正是拆包新开的那格假绿。
      if (!harnessExtInstalled()) {
        const notice = harnessExtMissingNotice('回执绑定校验（harness receipt verify）');
        if (advise) clearAdvised(advisedFile);
        gateLog('stop-gate', notice);
        emit({ systemMessage: notice });
        return;
      }
      // stderr 收进变量、stdout 丢弃：引擎崩掉时那几行是唯一有用的线索，要带进诊断
      const rv = harnessRun(['receipt', 'verify'], { cwd: root });
      const rc = rv.status;
      if (rc === 4) {
        if (advise) clearAdvised(advisedFile);
        decide('代码在上次审查后又有改动，无匹配的已通过回执（diff 已越过所有已审回执）。请重新派 code-reviewer 审查当前改动并写回执后再停止。');
        return;
      }
      if (!rcInContract(rc, 0, 3)) {
        // 连拦计数复用同一状态文件，sig 按退出码记（码一变即清零重计），与待审清单那套互不串味
        const hsig = `harness-receipt-verify-rc${rc}`;
        const strikes = advise ? 0 : readStrikes(strikeFile, hsig);
        const head = errHead(rv.stderr) || '（引擎无 stderr 输出）';
        if (strikes >= 3) {
          fs.rmSync(strikeFile, { force: true });
          releaseWith(`stop-gate：harness receipt verify 连续 3 次以契约外退出码 ${rc} 退出（引擎异常，不是回执过期），达连拦上限本次放行——但回执绑定始终没被验过，欠账仍在，请尽快修引擎：node .claude/harness/harness.mjs receipt verify。引擎报错：${head}`);
          return;
        }
        if (!advise) writeStrikes(strikeFile, hsig, strikes + 1);
        decide(`stop-gate：harness receipt verify 以契约外退出码 ${rc} 退出（契约只有 0/3/4），回执闸没跑成——这是引擎异常（如 .claude/harness/ext/ 半装或损坏、node 出岔），不是回执过期。跑 node .claude/harness/harness.mjs receipt verify 看真实报错，修好引擎再停止。引擎报错：${head}`);
        return;
      }
    }
    fs.rmSync(stateFile, { force: true });
    fs.rmSync(`${stateFile}.lock`, { force: true });
    fs.rmSync(strikeFile, { force: true });
    if (advise) clearAdvised(advisedFile);
    return;
  }

  const count = files.length;
  const inline = files.join('、');

  // 连拦计数：只对同一待审清单指纹累加，清单一变即清零重计（顺序无关，先排序再算）
  // advise 档不累计连拦：它压根没拦，攒下的次数只会让下一轮真拦时提前触顶放行
  const sig = crypto.createHash('sha256').update([...files].sort().join('\n')).digest('hex');
  const strikes = advise ? 0 : readStrikes(strikeFile, sig);
  if (strikes >= 3) {
    fs.rmSync(strikeFile, { force: true });
    releaseWith(`stop-gate：同一待审清单连续拦截已达 3 次上限，本次放行——但待审清单未清空（${count} 个欠账仍在：${inline}），条件允许时务必尽快派 code-reviewer 审查。`);
    return;
  }
  if (!advise) writeStrikes(strikeFile, sig, strikes + 1);
  if (advise) {
    if (recentlyAdvised(advisedFile, sig)) return;
    recordAdvised(advisedFile, sig);
  }
  decide(`代码已修改但未 code review（${count} 个待审文件：${inline}）。请派发 code-reviewer sub-agent 审一轮（Stage 0 → 1 → 2）；通过后执行 echo clean > .claude/.needs-review 放行。`);
}, 'stop-gate 自检失败，fail-closed 拦停——请修复闸/状态文件后重试停止。');
