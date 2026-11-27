#!/usr/bin/env node
// gen-agents.mjs — 从 .claude/agents/*.md 生成 .cursor/agents/<同名>.md，并提供联合指纹计算供安装器与 sessionStart 自愈复用。
// 用法：node .cursor/scripts/gen-agents.mjs [--root <dir>]
//   未传 --root 时项目根取 $CLAUDE_PROJECT_DIR，没有就按脚本位置推。
//   没有 .claude/agents/ 时退 1。覆盖写、幂等：同样的输入两次产出逐字节相同。
//
// 由来：Cursor 里 .cursor/agents/ 的优先级高于 .claude/agents/，而 cc-base 的 `model: sonnet / opus` 在 Cursor 里解析成
//   Claude 模型，账号没有 Claude 配额时子代理起不来（2026-11-04 实测）。所以生成版一律 `model: inherit` 跟主 agent 走；
//   要钉某个角色的模型写 .cursor/agents-models.json（形如 {"code-reviewer":"auto"}）。
//   Cursor 也不认 skills / memory 字段（Claude Code 靠前者预载技能、靠后者给子代理持久记忆），这两件事改写进正文开头。
//   disallowedTools Cursor 没法在 frontmatter 里按工具名逐个禁，改成正文一句话：含 Task 或 Agent 的写「不要再派子代理。」，
//   其它每项写「不要用 <工具> 工具。」（Bash 写成「不要用 Shell（Bash）工具。」，Cursor 里它叫 Shell）；
//   若同时含 Write 和 Edit，额外在 frontmatter 输出 readonly: true 启用 Cursor 子代理原生只读模式。
//   生成器只写不清会让源头删掉的 agent 在 .cursor/agents/ 里一直留着（Cursor 优先读这里），所以生成前先清：
//   带生成注释、注释里的源名等于本文件名、但 .claude/agents/ 里已没有这个源的删掉；
//   没带注释的手写文件、复制生成物改名定制的文件（注释里源名不是自己）不动。

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const GEN_AGENTS_MARK = '由 .cursor/scripts/gen-agents.mjs';
const GEN_AGENTS_MARK_RE = GEN_AGENTS_MARK.replace(/\./g, '\\.');

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

function hashLfFileOrTag(fp) {
  try {
    const lst = safeLstat(fp);
    if (!lst || !lst.isFile()) return 'absent';
    const raw = fs.readFileSync(fp);
    let hasCr = false;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === 0x0d) {
        hasCr = true;
        break;
      }
    }
    let norm = raw;
    if (hasCr) {
      const buf = Buffer.allocUnsafe(raw.length);
      let n = 0;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== 0x0d) buf[n++] = raw[i];
      }
      norm = buf.subarray(0, n);
    }
    return createHash('sha256').update(norm).digest('hex');
  } catch {
    return 'error';
  }
}

/**
 * Compute joint SHA256 fingerprint over `.claude/CLAUDE.md`, `.claude/agents/*.md`,
 * optional `.cursor/agents-models.json`, and generator scripts (`gen-rules.mjs` + `gen-agents.mjs`).
 * @param {string} rootDir
 * @returns {string}
 */
export function computeCursorGenFingerprint(rootDir) {
  const root = path.resolve(rootDir);
  const parts = [
    `claude-md:${hashLfFileOrTag(path.join(root, '.claude', 'CLAUDE.md'))}`,
    `models:${hashLfFileOrTag(path.join(root, '.cursor', 'agents-models.json'))}`,
    `gen-rules:${hashLfFileOrTag(path.join(root, '.cursor', 'scripts', 'gen-rules.mjs'))}`,
    `gen-agents:${hashLfFileOrTag(path.join(root, '.cursor', 'scripts', 'gen-agents.mjs'))}`,
  ];
  const srcAgentsDir = path.join(root, '.claude', 'agents');
  try {
    const files = fs.readdirSync(srcAgentsDir).filter((f) => f.endsWith('.md')).sort();
    for (const f of files) {
      parts.push(`agent:${f}:${hashLfFileOrTag(path.join(srcAgentsDir, f))}`);
    }
  } catch {
    parts.push('agent:none');
  }
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

// 拆 frontmatter：返回 { fm: {key: value}, body }。不以 --- 开头或没有收尾 --- 就是认不出，返回 null。
function parseFrontmatter(file, text, onWarn) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) {
      onWarn(`gen-agents: ${file} frontmatter 里认不出的行，已丢弃：${line}`);
      continue;
    }
    let val = m[2].trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
      try {
        const parsed = JSON.parse(val);
        val = typeof parsed === 'string' ? parsed : val.slice(1, -1);
      } catch {
        val = val.slice(1, -1);
      }
    } else if (val.length >= 2 && val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1).replace(/''/g, "'");
    }
    fm[m[1]] = val;
  }
  return { fm, body: lines.slice(end + 1).join('\n') };
}

/**
 * Generate `<rootDir>/.cursor/agents/*.md` from `<rootDir>/.claude/agents/*.md`.
 * @param {string} rootDir
 * @param {{ quiet?: boolean }} [opts]
 * @returns {{ ok: true, generated: number, pruned: number } | { ok: false, error: string }}
 */
export function generateAgents(rootDir, opts = {}) {
  const root = path.resolve(rootDir);
  const src = path.join(root, '.claude', 'agents');
  const dst = path.join(root, '.cursor', 'agents');
  const modelsPath = path.join(root, '.cursor', 'agents-models.json');
  const quiet = Boolean(opts.quiet);
  const warn = (msg) => {
    if (!quiet) process.stderr.write(`${msg}\n`);
  };

  let srcSt = null;
  try {
    srcSt = fs.statSync(src);
  } catch {
    srcSt = null;
  }
  if (!srcSt || !srcSt.isDirectory()) {
    return {
      ok: false,
      error: `没有 ${src}——请先安装 cc-base（或运行 node scripts/cursor-base.mjs install <target> 自动联装）`,
    };
  }

  let pinned = {};
  if (fs.existsSync(modelsPath)) {
    try {
      pinned = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
    } catch (e) {
      return { ok: false, error: `${modelsPath} 不是合法 JSON：${e.message}` };
    }
    if (!pinned || typeof pinned !== 'object' || Array.isArray(pinned)) {
      return { ok: false, error: `${modelsPath} 顶层必须是对象，形如 {"code-reviewer":"auto"}` };
    }
  }

  const files = fs.readdirSync(src).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) {
    return { ok: false, error: `${src} 下没有 .md` };
  }

  // CRITICAL: detach if `.cursor/agents` was previously a symlink/Junction so we NEVER overwrite `.claude/agents`!
  detachSymlinkSafe(dst);
  fs.mkdirSync(dst, { recursive: true, mode: 0o755 });
  tryChmod(dst, 0o755);

  let pruned = 0;
  for (const g of fs.readdirSync(dst).filter((x) => x.endsWith('.md')).sort()) {
    if (files.includes(g)) continue;
    const gPath = path.join(dst, g);
    const gLst = safeLstat(gPath);
    if (!gLst || gLst.isSymbolicLink() || !gLst.isFile()) continue;
    const m = new RegExp(`${GEN_AGENTS_MARK_RE} 从 \\.claude/agents/(.+?)\\.md 生成`).exec(
      fs.readFileSync(gPath, 'utf8'),
    );
    if (!m || m[1] !== g.replace(/\.md$/, '')) continue;
    fs.rmSync(gPath);
    pruned++;
    if (!quiet) {
      process.stdout.write(`gen-agents: 源头已删，清掉生成物 ${path.relative(root, gPath).replace(/\\/g, '/')}\n`);
    }
  }

  let bad = 0;
  let generated = 0;
  for (const f of files) {
    const p = parseFrontmatter(f, fs.readFileSync(path.join(src, f), 'utf8'), warn);
    if (!p || !p.fm.name || !p.fm.description) {
      warn(`gen-agents: ${f} 认不出 frontmatter（要有 --- 包着的 name 与 description），跳过`);
      bad++;
      continue;
    }
    const { fm, body } = p;
    const name = fm.name;
    const model = typeof pinned[name] === 'string' && pinned[name] ? pinned[name] : 'inherit';

    const disallowed = fm.disallowedTools
      ? fm.disallowedTools.split(',').map((x) => x.trim()).filter(Boolean)
      : [];
    const disallowedSet = new Set(disallowed);
    const readonly = disallowedSet.has('Write') && disallowedSet.has('Edit');

    const pre = [];
    if (fm.skills) {
      const paths = fm.skills.split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => `\`.claude/skills/${s}/SKILL.md\``).join('、');
      pre.push(`开工前先完整读 ${paths}（Cursor 不会像 Claude Code 那样把技能预载给子代理），再按下文行事。`);
    }
    if (disallowed.length) {
      let noSub = false;
      for (const t of disallowed) {
        if (t === 'Task' || t === 'Agent') {
          if (!noSub) pre.push('不要再派子代理。');
          noSub = true;
        } else {
          pre.push(t === 'Bash' ? '不要用 Shell（Bash）工具。' : `不要用 ${t} 工具。`);
        }
      }
    }
    if (fm.memory === 'project') {
      pre.push(`你的持久记忆在 \`.claude/agent-memory/${name}/MEMORY.md\`，先读它，改动也写回那里。`);
    }

    const desc = /:(\s|$)|\s#/.test(fm.description) || /^["'[\]{}&*!|>%@`#?-]/.test(fm.description)
      ? JSON.stringify(fm.description)
      : fm.description;

    const out = [
      '---',
      `name: ${name}`,
      `description: ${desc}`,
      `model: ${model}`,
      ...(readonly ? ['readonly: true'] : []),
      '---',
      '',
      `<!-- ${GEN_AGENTS_MARK} 从 .claude/agents/${f} 生成，别手改；要钉模型写 .cursor/agents-models.json -->`,
      '',
      ...(pre.length ? [pre.join('\n'), ''] : []),
      body.replace(/^\n+/, ''),
    ].join('\n');

    const dstFile = path.join(dst, f);
    detachSymlinkSafe(dstFile);
    fs.writeFileSync(dstFile, out.endsWith('\n') ? out : `${out}\n`, 'utf8');
    tryChmod(dstFile, 0o644);
    generated++;
  }

  if (bad > 0) {
    return { ok: false, error: `${bad} 个 agent 文件认不出，其余已生成` };
  }
  if (!quiet) {
    process.stdout.write(`gen-agents: 生成 ${generated} 个到 ${path.relative(root, dst).replace(/\\/g, '/')}/\n`);
  }
  return { ok: true, generated, pruned };
}

function parseRootArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      const next = argv[++i];
      if (!next) {
        process.stderr.write('gen-agents: --root 缺少目录参数\n');
        process.exit(2);
      }
      return path.resolve(next);
    }
    if (a.startsWith('--root=')) {
      const val = a.slice(7);
      if (!val) {
        process.stderr.write('gen-agents: --root= 缺少目录参数\n');
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
  const res = generateAgents(root, { quiet: false });
  if (!res.ok) {
    process.stderr.write(`gen-agents: ${res.error}\n`);
    process.exit(1);
  }
}
