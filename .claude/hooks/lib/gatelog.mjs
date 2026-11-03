// gatelog.mjs — 拦停账本（gate-audit.sh 靠它统计「哪些闸从没拦下过东西」）。
// 追加一行 `<ISO-8601 UTC>\t<hook>\t<reason 首行>` 到 .claude/evidence/gate-block.log。
// 任何一步失败都吞掉直接返回：账本是旁路记录，绝不改变调用方的判决——
// 记不上账最多是审计少一条，让写账本的异常翻出去把闸掀了才是真事故。
import fs from 'node:fs';
import path from 'node:path';

// root 只有引擎侧会传：hook 一律由宿主起、CLAUDE_PROJECT_DIR 必有，而 `tier set` 是人在命令行
// 敲的，那个变量常常不在——账本少记的正是「档位被谁调过」这一类最该留痕的行。
export function gateLog(hook, reason, root = process.env.CLAUDE_PROJECT_DIR) {
  try {
    if (!root) return;
    const firstLine = String(reason === undefined || reason === null ? '' : reason).split(/\r?\n/)[0];
    const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const dir = path.join(root, '.claude', 'evidence');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'gate-block.log'), `${ts}\t${hook || 'unknown'}\t${firstLine}\n`);
  } catch (_e) {
    /* 账本写不成不影响调用方 */
  }
}
