// SessionStart：工作树有未提交改动（上个 session 可能中断/上下文压缩、状态未落 progress.md）
// → 注入提醒：先 /recap-project 读 progress.md，对照实际改动校准后再继续。
import { git, emit, fastOff, runFailOpen } from './lib/io.mjs';

runFailOpen(async () => {
  if (await fastOff('recap-on-dirty')) return;

  const root = process.env.CLAUDE_PROJECT_DIR;
  if (!root) return;

  // git 不在 / 不是工作树 / status 跑不成 → 优雅放行（本 hook 只是提醒，没有判定就不提醒）
  const inside = git(['rev-parse', '--is-inside-work-tree'], { cwd: root });
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') return;

  const st = git(['status', '--porcelain'], { cwd: root });
  if (st.status !== 0) return;
  const count = st.stdout.split('\n').filter((l) => l !== '').length;
  if (count === 0) return;

  const msg = `检测到 git 工作树有 ${count} 处未提交改动——上个 session 可能中断或上下文已压缩，progress.md 未必反映真实状态。建议先 /recap-project 读 progress.md，对照实际改动校准（决策/完成是否已记）后再继续。`;
  emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg } });
});
