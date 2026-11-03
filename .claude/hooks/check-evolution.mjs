// SessionStart：检查 .claude/feedback/FEEDBACK-INDEX.md 还有多少条待处理 feedback，
// 有就提醒派 evolution-runner。单行嵌套 JSON 的 additionalContext（Claude Code 与 Cursor 都收）。
// 待处理 = 未带前缀的条目（行首 "- ["）；总数 = 含「✅[已毕业] 」与「⏭[已跳过] 」两种前缀一并计数。
// 跳过 = evolution-engine 裁定 skipped: true 的条目（领域口径等不进框架的），不算待处理。
import path from 'node:path';
import { projectDir, readTextFile, context, fastOff, runFailOpen } from './lib/io.mjs';

runFailOpen(async () => {
  if (await fastOff('check-evolution')) return;

  const index = path.join(projectDir(), '.claude', 'feedback', 'FEEDBACK-INDEX.md');
  const r = readTextFile(index);
  if (r.text === null) return;

  const lines = r.text.replace(/\r/g, '').split('\n');
  const pending = lines.filter((l) => l.startsWith('- [')).length;
  const total = lines.filter((l) => /^- (✅\[已毕业\] |⏭\[已跳过\] )?\[/.test(l)).length;

  if (pending > 0) {
    context('SessionStart', `📋 项目有 ${pending} 条待处理 feedback（共 ${total} 条）。建议派发 evolution-runner 检查是否有进化建议。`);
  }
});
