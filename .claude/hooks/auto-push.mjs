// PostToolUse(Bash) if git commit*：commit 后若本地领先上游则自动 push。
// 不解析 hook 退出码字段（PostToolUse 输入 schema 跨版本不稳，旧写法用了
// 不存在的 .tool_exit_code 导致永不 push）——改用 git 状态判断，确定可靠。
import fs from 'node:fs';
import { readStdinJson, git, fastOff, runFailOpen } from './lib/io.mjs';

// git 与 commit 之间允许夹全局选项（`git -c user.name=x commit` / `git -C dir commit`）——只认
// 紧邻两个词的旧写法对这类形式不触发，提交完不推。前置限行首或分隔符，`echo "git commit"` 里
// 的字样不算提交；commit 后要空白或行尾，挡掉 commit-tree 与 log --grep=commit。
const COMMIT_RE = /(^|[\s;&|(){}])git(\s+-\S+(\s+\S+)?)*\s+commit(\s|$)/;

runFailOpen(async () => {
  if (await fastOff('auto-push')) return;

  // 脚本内自判触发命令：非 git commit 输入直接退出
  const ev = readStdinJson();
  const cmd = ev ? String((ev.tool_input || {}).command || '') : '';
  if (!COMMIT_RE.test(cmd)) return;

  // 空值兜底：目录为空会误推 cwd 所在的无关 repo，必须显式拦截
  const root = process.env.CLAUDE_PROJECT_DIR;
  if (!root || !fs.existsSync(root)) return;

  // 无上游分支（没配远程/未设 tracking）→ 跳过
  if (git(['rev-parse', '--abbrev-ref', '@{u}'], { cwd: root }).status !== 0) return;

  // 本地领先上游的 commit 数 > 0 才推
  const ahead = git(['rev-list', '@{u}..HEAD', '--count'], { cwd: root });
  if (Number(ahead.stdout.trim() || 0) > 0) git(['push'], { cwd: root });
});
