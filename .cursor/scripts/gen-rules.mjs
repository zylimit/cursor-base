#!/usr/bin/env node
// gen-rules.mjs — 从 .claude/CLAUDE.md 生成 .cursor/rules/cc-base-claude.mdc。
// 用法：node .cursor/scripts/gen-rules.mjs        从哪里跑都行，项目根取 $CLAUDE_PROJECT_DIR，没有就按脚本位置推。
//   没有 .claude/CLAUDE.md 或文件为空时退 1。覆盖写、幂等：同样的输入两次产出逐字节相同。
//
// 由来：Cursor 的 .cursor/rules/*.mdc 支持 alwaysApply: true 在每轮对话强制注入主控规则，
//   但不会自动内联 @file 正文，所以由本脚本把 .claude/CLAUDE.md 全文写入生成物，同步时自动刷新零漂移。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CLAUDE_PROJECT_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, '.claude', 'CLAUDE.md');
const DST_DIR = path.join(ROOT, '.cursor', 'rules');
const DST = path.join(DST_DIR, 'cc-base-claude.mdc');

function die(msg) {
  process.stderr.write(`gen-rules: ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(SRC) || !fs.statSync(SRC).isFile()) {
  die(`没有 ${SRC}——先跑 sync-from-cc-base.sh，或确认在 cc-base 原件所在的项目里`);
}

const raw = fs.readFileSync(SRC, 'utf8');
if (!raw.trim()) {
  die(`${SRC} 为空，无法生成主控规则`);
}

const body = raw.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
const out = [
  '---',
  'description: cc-base 主控规则（SiteMaster 人设、十条铁律、技能与子代理调度）',
  'globs:',
  'alwaysApply: true',
  '---',
  '',
  '<!-- 由 .cursor/scripts/gen-rules.mjs 从 .claude/CLAUDE.md 生成，别手改 -->',
  '',
  body,
  '',
].join('\n');

fs.mkdirSync(DST_DIR, { recursive: true, mode: 0o755 });
fs.chmodSync(DST_DIR, 0o755);
fs.writeFileSync(DST, out);
fs.chmodSync(DST, 0o644);
process.stdout.write('gen-rules: 生成 1 个到 .cursor/rules/cc-base-claude.mdc\n');
