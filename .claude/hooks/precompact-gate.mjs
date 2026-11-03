// PreCompact：压缩前守门——「session 内压缩丢决策」的可拦截化。
// 压缩会把对话正文换成摘要，未落盘的决策/待审状态最容易在这一步蒸发。本闸在压缩前检查：
//   C1：.needs-review 有待审文件（审查闭环没走完，压缩后欠账语境丢失）
//   C2：工作树有未提交代码/家底改动但 progress.md 不在改动集（决策还没写进项目记忆）
// 命中任一 → 拦一次压缩（decision:block），提示先 /record 固化 + 处理待审再压缩。
// 防砖设计（与 stop 闸相反，本闸倾向放行）：
//   - 同一 session 拦过一次后 10 分钟内不再拦（.precompact-block-epoch 记上次拦截时间）——
//     auto 压缩可能是上下文触顶的恢复动作，拦第二次只会让请求反复失败；
//   - 脚本自身出错 fail-open 放行（拦不住压缩顶多丢注记，拦死压缩会卡死整个会话）。
// 状态干净 / 非 git / 无 progress.md → 放行并清标记。
// 档位（profile.json）：off 静默放行；advise（fast 档）出 systemMessage + 记账不拦；block 走原逻辑。
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, readStdinRaw, readTextFile, pendingReviewFiles, git, porcelainZ, classifyChange, relToProject, emit, gateModeOf, runFailOpen } from './lib/io.mjs';
import { gateLog } from './lib/gatelog.mjs';

const COOLDOWN_SECONDS = 600;

runFailOpen(async () => {
  const mode = await gateModeOf('precompact-gate');
  if (mode === 'off') return;

  // 消费 stdin（trigger/custom_instructions 本闸不区分，manual/auto 同一判定）
  readStdinRaw();

  const root = projectDir();
  const mark = path.join(root, '.claude', '.precompact-block-epoch');
  const now = Math.floor(Date.now() / 1000);

  // 10 分钟冷却窗：拦过一次就先放行，给「记录后重试」留通道，也防 auto 压缩反复失败
  const prior = readTextFile(mark);
  if (prior.text !== null) {
    const last = prior.text.replace(/\r/g, '').split('\n').find((l) => /^\d+$/.test(l));
    if (last && now - Number(last) < COOLDOWN_SECONDS) return;
  }

  let dirtyReason = '';

  // C1：待审清单未清（复用 stop-gate 的清单语义：去空行去 clean 后仍有条目）
  const pending = pendingReviewFiles(root);
  if (pending.length > 0) dirtyReason = `待审清单未清（${pending.length} 个文件待 code review）`;

  // C2：代码/家底脏而 progress.md 未同步（three-file-sync C1 的简化版，只判是否需要先记录）
  if (!dirtyReason && fs.existsSync(path.join(root, 'progress.md'))
      && git(['rev-parse', '--is-inside-work-tree'], { cwd: root }).status === 0) {
    const prefix = git(['rev-parse', '--show-prefix'], { cwd: root }).stdout.replace(/\n$/, '');
    let codeDirty = false;
    let progDirty = false;

    // 剥前缀 → 归类，两步都用 io.mjs 那份（与 three-file-sync-gate 同一张表，不再各抄一份）
    const take = (p) => {
      const rel = relToProject(p, prefix);
      if (rel === null) return;
      const kind = classifyChange(rel);
      if (kind === 'progress') progDirty = true;
      else if (kind === 'code') codeDirty = true;
    };

    // -z 记录解析（NUL 切 + R/C 双记录）在 io.mjs；git 跑不成时 paths 为空 = 本轮不判脏，静默放行。
    // -uall 同 three-file-sync-gate：未跟踪的新目录不展开就整个逃过 C2。
    for (const p of porcelainZ(root, ['-uall', '--', '.']).paths) take(p);
    if (codeDirty && !progDirty) {
      dirtyReason = '工作树有未提交代码/家底改动但 progress.md 未同步（本轮决策还没进项目记忆）';
    }
  }

  if (!dirtyReason) {
    fs.rmSync(mark, { force: true });
    return;
  }

  try { fs.mkdirSync(path.dirname(mark), { recursive: true }); fs.writeFileSync(mark, `${now}\n`); } catch (_e) { /* 冷却标记写不成只会多拦一次 */ }

  const reason = `压缩前守门：${dirtyReason}。压缩会把对话正文换成摘要，这些状态最容易随之蒸发——请先派 progress-recorder /record 固化决策/完成事项（待审项处理或显式记欠账），再重试压缩。本次拦截后 10 分钟内不会再拦。`;
  // advise 档（fast）：同一段话照说、照记账，只是不拦压缩
  if (mode === 'advise') {
    const msg = `[fast] ${reason}`;
    gateLog('precompact-gate', msg);
    emit({ systemMessage: msg });
    return;
  }
  gateLog('precompact-gate', reason);
  emit({ decision: 'block', reason });
});
