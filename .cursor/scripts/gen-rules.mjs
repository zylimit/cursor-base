#!/usr/bin/env node
// gen-rules.mjs — 从 .claude/CLAUDE.md 生成 .cursor/rules/cc-base-claude.mdc。
// 用法：node .cursor/scripts/gen-rules.mjs [--root <dir>]
//   未传 --root 时项目根取 $CLAUDE_PROJECT_DIR，没有就按脚本位置推。
//   没有 .claude/CLAUDE.md 或文件为空时退 1。覆盖写、幂等：同样的输入两次产出逐字节相同。
//
// 由来：Cursor 的 .cursor/rules/*.mdc 支持 alwaysApply: true 在每轮对话强制注入主控规则，
//   但不会自动内联 @file 正文，所以由本脚本把 .claude/CLAUDE.md 全文写入生成物，随安装器与 sessionStart 自动刷新零漂移。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const GEN_RULES_MARKER = '由 .cursor/scripts/gen-rules.mjs 从 .claude/CLAUDE.md 生成，别手改';

function safeLstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function detachSymlinkSafe(p) {
  const lst = safeLstat(p);
  if (!lst || !lst.isSymbolicLink()) return;
  if (process.platform === 'win32') {
    try {
      fs.rmdirSync(p);
      return;
    } catch {
      fs.unlinkSync(p);
      return;
    }
  }
  fs.unlinkSync(p);
}

function tryChmod(p, mode) {
  try {
    fs.chmodSync(p, mode);
  } catch {
    /* Windows NTFS ACLs ignore POSIX mode bits */
  }
}

/**
 * Generate `<rootDir>/.cursor/rules/cc-base-claude.mdc` from `<rootDir>/.claude/CLAUDE.md`.
 * @param {string} rootDir
 * @param {{ quiet?: boolean }} [opts]
 * @returns {{ ok: true, dst: string } | { ok: false, error: string }}
 */
export function generateRules(rootDir, opts = {}) {
  const root = path.resolve(rootDir);
  const src = path.join(root, '.claude', 'CLAUDE.md');
  const dstDir = path.join(root, '.cursor', 'rules');
  const dst = path.join(dstDir, 'cc-base-claude.mdc');

  let srcSt = null;
  try {
    srcSt = fs.statSync(src);
  } catch {
    srcSt = null;
  }
  if (!srcSt || !srcSt.isFile()) {
    return {
      ok: false,
      error: `没有 ${src}——请先安装 cc-base（或运行 node scripts/cursor-base.mjs install <target> 自动联装）`,
    };
  }

  const raw = fs.readFileSync(src, 'utf8');
  if (!raw.trim()) {
    return { ok: false, error: `${src} 为空，无法生成主控规则` };
  }

  const body = raw.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
  const out = [
    '---',
    'description: cc-base 主控规则（SiteMaster 人设、十条铁律、技能与子代理调度）',
    'globs:',
    'alwaysApply: true',
    '---',
    '',
    `<!-- ${GEN_RULES_MARKER} -->`,
    '',
    body,
    '',
  ].join('\n');

  // Guard against symlinked .cursor/rules or leaf file so we never write through into external dirs
  detachSymlinkSafe(dstDir);
  fs.mkdirSync(dstDir, { recursive: true, mode: 0o755 });
  tryChmod(dstDir, 0o755);
  detachSymlinkSafe(dst);
  fs.writeFileSync(dst, out, 'utf8');
  tryChmod(dst, 0o644);

  if (!opts.quiet) {
    process.stdout.write('gen-rules: 生成 1 个到 .cursor/rules/cc-base-claude.mdc\n');
  }
  return { ok: true, dst };
}

function parseRootArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      const next = argv[++i];
      if (!next) {
        process.stderr.write('gen-rules: --root 缺少目录参数\n');
        process.exit(2);
      }
      return path.resolve(next);
    }
    if (a.startsWith('--root=')) {
      const val = a.slice(7);
      if (!val) {
        process.stderr.write('gen-rules: --root= 缺少目录参数\n');
        process.exit(2);
      }
      return path.resolve(val);
    }
  }
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || path.resolve(SCRIPT_DIR, '..', '..'));
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const root = parseRootArg(process.argv.slice(2));
  const res = generateRules(root, { quiet: false });
  if (!res.ok) {
    process.stderr.write(`gen-rules: ${res.error}\n`);
    process.exit(1);
  }
}
