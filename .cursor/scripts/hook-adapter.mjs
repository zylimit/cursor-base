#!/usr/bin/env node
// hook-adapter.mjs — Cursor 原生事件适配器（与 .claude/settings.json 零重叠互补）。
// 覆盖 5 个原生事件：
//   - sessionStart：毫秒级自愈 .cursor/skills 联接、.claude/settings.json string form、cc-base-claude.mdc 与 agents/*.md 联合指纹，
//     并注入子代理身份桥接 NODE_OPTIONS 与外层未追踪父仓 GIT_CEILING_DIRECTORIES；
//   - subagentStart / subagentStop：维护 .claude/evidence/.cursor-subagents/ 原子状态表；
//   - beforeReadFile：failClosed: true 多跳悬空软链与密钥文件读取硬护栏；
//   - beforeShellExecution：前置 ps-floor.mjs Bash + PowerShell 双壳危险命令与密钥外泄硬拦截（deny + exit 2）及发布命令 ask 确认。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isatty } from 'node:tty';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeCursorGenFingerprint, generateAgents } from './gen-agents.mjs';
import { generateRules } from './gen-rules.mjs';
import { checkDangerousCommand, checkSecretExfil } from './ps-floor.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STDIN_WAIT_MAX_MS = 3000;
const STDIN_RETRY_MS = 5;
const SUBAGENT_TTL_MS = 30 * 60 * 1000;
const MAX_SYMLINK_HOPS = 40;

const SENSITIVE_ROOT_BASENAMES = new Set(['secrets', '.ssh', '.aws', '.gnupg', '.kube']);
const SENSITIVE_ROOT_ANCESTOR_RE = /(^|\/)(\.ssh|\.aws|\.gnupg|\.kube)(\/|$)/i;
const SECRET_READ_PATTERNS = [
  /(^|\/)\.env($|\/|\.(?!(example|sample|template|schema)$))/i,
  /(^|\/)secrets(\/|$)/i,
  /(^|\/)(id_rsa|id_ed25519|id_ecdsa)($|[._-])/i,
  /(^|\/)(\.ssh|\.aws|\.gnupg|\.kube)(\/|$)/i,
  /(^|\/)(credentials\.json|\.netrc|\.npmrc|\.pypirc)$/i,
  /\.(pem|key|p12|pfx)$/i,
];
const ASK_PUBLISH_RE = /(^|[\s;&|()])(gh(?:\.exe)?\s+release\b|npm(?:\.cmd|\.exe)?\s+publish\b|docker(?:\.exe)?\s+push\b)/i;

const NODE_BIN_RE = /^["']?node(?:\.exe)?["']?$/i;
const CLAUDE_EXEC_HOOK_ARG_RE = /^(?:\$\{CLAUDE_PROJECT_DIR\}[/\\]|\.[/\\])?\.claude[/\\]hooks[/\\]([A-Za-z0-9_-]+)\.mjs$/;

const emit = (obj) => { fs.writeSync(1, JSON.stringify(obj) + '\n'); };
const say = (text) => { fs.writeSync(2, String(text) + '\n'); };
const trimStr = (v) => (typeof v === 'string' ? v.trim() : '');

function safeLstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function resolveRealOrNull(p) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  }
}

function normRealKey(realPath) {
  if (!realPath) return '';
  const posix = String(realPath).replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return process.platform === 'win32' ? posix.toLowerCase() : posix;
}

function sameRealDir(a, b) {
  const ra = resolveRealOrNull(a);
  const rb = resolveRealOrNull(b);
  return Boolean(ra && rb && normRealKey(ra) === normRealKey(rb));
}

function detachLinkOnly(absLink) {
  const lst = safeLstat(absLink);
  if (!lst) return;
  if (!lst.isSymbolicLink()) {
    throw new Error(`拒绝拆除物理非链接路径：${absLink}`);
  }
  if (process.platform === 'win32') {
    try {
      fs.rmdirSync(absLink);
      return;
    } catch {
      try {
        fs.unlinkSync(absLink);
        return;
      } catch (e2) {
        if (e2 && e2.code === 'ENOENT') return;
        throw e2;
      }
    }
  }
  try {
    fs.unlinkSync(absLink);
  } catch (e) {
    if (e && e.code === 'ENOENT') return;
    throw e;
  }
}

function createOsDirLink(absLink, absTarget) {
  fs.mkdirSync(path.dirname(absLink), { recursive: true });
  if (process.platform === 'win32') {
    fs.symlinkSync(absTarget, absLink, 'junction');
  } else {
    const rel = path.relative(path.dirname(absLink), absTarget).replace(/\\/g, '/');
    fs.symlinkSync(rel, absLink, 'dir');
  }
}

function readStdinRaw() {
  if (isatty(0)) return '';
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let waited = 0; ;) {
    try {
      const n = fs.readSync(0, buf, 0, buf.length, null);
      if (n === 0) break;
      chunks.push(Buffer.from(buf.subarray(0, n)));
    } catch (e) {
      if (!e || (e.code !== 'EAGAIN' && e.code !== 'EWOULDBLOCK') || waited >= STDIN_WAIT_MAX_MS) break;
      Atomics.wait(sleeper, 0, 0, STDIN_RETRY_MS);
      waited += STDIN_RETRY_MS;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseStdin() {
  const raw = readStdinRaw();
  if (!raw.trim()) return { raw, empty: true, ok: false, value: null };
  try {
    const v = JSON.parse(raw);
    const isObj = Boolean(v && typeof v === 'object' && !Array.isArray(v));
    return { raw, empty: false, ok: isObj, value: isObj ? v : null };
  } catch {
    return { raw, empty: false, ok: false, value: null };
  }
}

function resolveProjectRoot(ev) {
  const ws0 = ev && Array.isArray(ev.workspace_roots) ? ev.workspace_roots[0] : '';
  for (const c of [process.env.CLAUDE_PROJECT_DIR, process.env.CURSOR_PROJECT_DIR, ws0, ev && ev.cwd]) {
    if (trimStr(c)) return path.resolve(trimStr(c));
  }
  return path.resolve(SCRIPT_DIR, '..', '..');
}

// ---------------------------------------------------------------------------
// SessionStart Millisecond Self-Healing & Git Ceiling Guard
// ---------------------------------------------------------------------------

function selfHealSkillsLink(root) {
  const cursorDir = path.join(root, '.cursor');
  const absLink = path.join(cursorDir, 'skills');
  const absTarget = path.join(root, '.claude', 'skills');

  if (safeLstat(cursorDir)?.isSymbolicLink()) return;
  if (!statOrNull(absTarget)?.isDirectory()) return;

  const lst = safeLstat(absLink);
  if (!lst) {
    try {
      createOsDirLink(absLink, absTarget);
    } catch (e) {
      say(`[cursor-hook-adapter] sessionStart 建立 .cursor/skills 联接失败：${e?.message || e}`);
    }
    return;
  }

  if (lst.isSymbolicLink()) {
    const st = statOrNull(absLink);
    if (st && st.isDirectory() && sameRealDir(absLink, absTarget)) {
      return;
    }
    try {
      detachLinkOnly(absLink);
      createOsDirLink(absLink, absTarget);
    } catch (e) {
      say(`[cursor-hook-adapter] sessionStart 修复 .cursor/skills 联接失败：${e?.message || e}`);
    }
    return;
  }

  // Physical non-link directory: guard against same-realpath before archiving to .cursor/.runtime/
  if (sameRealDir(absLink, absTarget)) return;
  try {
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    let backupDest = path.join(cursorDir, '.runtime', `migrated-standalone-${stamp}`, 'skills');
    let seq = 1;
    while (fs.existsSync(backupDest)) {
      backupDest = path.join(cursorDir, '.runtime', `migrated-standalone-${stamp}-${seq}`, 'skills');
      seq++;
    }
    fs.mkdirSync(path.dirname(backupDest), { recursive: true });
    fs.renameSync(absLink, backupDest);
    createOsDirLink(absLink, absTarget);
  } catch (e) {
    say(`[cursor-hook-adapter] sessionStart 归档迁移实体 .cursor/skills 失败：${e?.message || e}`);
  }
}

function selfHealClaudeSettingsStringForm(root) {
  const settingsPath = path.join(root, '.claude', 'settings.json');
  const lst = safeLstat(settingsPath);
  if (!lst || lst.isSymbolicLink() || !lst.isFile()) return;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return;
  }

  const hooks = data && typeof data === 'object' && !Array.isArray(data) ? data.hooks : null;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return;

  let execCount = 0;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) continue;
      for (const h of g.hooks) {
        if (
          h &&
          typeof h === 'object' &&
          typeof h.command === 'string' &&
          NODE_BIN_RE.test(h.command.trim()) &&
          Array.isArray(h.args) &&
          h.args.length === 1 &&
          CLAUDE_EXEC_HOOK_ARG_RE.test(String(h.args[0] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2'))
        ) {
          execCount++;
        }
      }
    }
  }
  if (execCount === 0) return;

  const hookFormScript = path.join(root, '.claude', 'scripts', 'hook-form.mjs');
  if (statOrNull(hookFormScript)?.isFile()) {
    const r = spawnSync(
      process.execPath,
      [hookFormScript, '--to', 'string', '--file', settingsPath],
      {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      },
    );
    if (r.status === 0) {
      try {
        data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {
        return;
      }
    }
  }

  let converted = 0;
  for (const groups of Object.values(data.hooks || {})) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) continue;
      g.hooks = g.hooks.map((h) => {
        if (
          !h ||
          typeof h !== 'object' ||
          typeof h.command !== 'string' ||
          !NODE_BIN_RE.test(h.command.trim()) ||
          !Array.isArray(h.args) ||
          h.args.length !== 1
        ) {
          return h;
        }
        const rawArg = String(h.args[0] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
        const m = CLAUDE_EXEC_HOOK_ARG_RE.exec(rawArg);
        if (!m) return h;
        converted++;
        const rebuilt = { type: h.type ?? 'command', command: `node .claude/hooks/${m[1]}.mjs` };
        for (const [k, v] of Object.entries(h)) {
          if (k === 'type' || k === 'command' || k === 'args') continue;
          rebuilt[k] = v;
        }
        return rebuilt;
      });
    }
  }

  if (converted > 0) {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    } catch (e) {
      say(`[cursor-hook-adapter] sessionStart 转换 .claude/settings.json string form 失败：${e?.message || e}`);
    }
  }
}

function selfHealGeneratedCursorAssets(root) {
  const cursorDir = path.join(root, '.cursor');
  if (safeLstat(cursorDir)?.isSymbolicLink()) return;

  const claudeMdPath = path.join(root, '.claude', 'CLAUDE.md');
  const claudeAgentsDir = path.join(root, '.claude', 'agents');
  const hasClaudeMd = Boolean(statOrNull(claudeMdPath)?.isFile() && statOrNull(claudeMdPath)?.size > 0);
  let srcAgentFiles = [];
  if (statOrNull(claudeAgentsDir)?.isDirectory()) {
    try {
      srcAgentFiles = fs.readdirSync(claudeAgentsDir).filter((f) => f.endsWith('.md')).sort();
    } catch {
      srcAgentFiles = [];
    }
  }
  if (!hasClaudeMd && srcAgentFiles.length === 0) return;

  const fpFile = path.join(cursorDir, '.runtime', 'cursor-gen.sha256');
  let storedFp = '';
  try {
    storedFp = fs.readFileSync(fpFile, 'utf8').trim();
  } catch {
    storedFp = '';
  }

  const expectedFp = computeCursorGenFingerprint(root);
  const dstRule = path.join(cursorDir, 'rules', 'cc-base-claude.mdc');
  const dstRuleOk = !hasClaudeMd || Boolean(statOrNull(dstRule)?.isFile() && statOrNull(dstRule)?.size > 0);
  const dstAgentsDir = path.join(cursorDir, 'agents');
  const dstAgentsOk = srcAgentFiles.length === 0 || (
    !safeLstat(dstAgentsDir)?.isSymbolicLink() &&
    srcAgentFiles.every((f) => Boolean(statOrNull(path.join(dstAgentsDir, f))?.isFile()))
  );

  if (storedFp === expectedFp && dstRuleOk && dstAgentsOk) {
    return;
  }

  let okAll = true;
  if (hasClaudeMd) {
    const rr = generateRules(root, { quiet: true });
    if (!rr.ok) {
      okAll = false;
      say(`[cursor-hook-adapter] sessionStart 自愈 cc-base-claude.mdc 失败：${rr.error}`);
    }
  }
  if (srcAgentFiles.length > 0) {
    const ar = generateAgents(root, { quiet: true });
    if (!ar.ok) {
      okAll = false;
      say(`[cursor-hook-adapter] sessionStart 自愈 .cursor/agents 失败：${ar.error}`);
    }
  }

  if (okAll) {
    try {
      const rtDir = path.join(cursorDir, '.runtime');
      if (!safeLstat(rtDir)?.isSymbolicLink()) {
        fs.mkdirSync(rtDir, { recursive: true });
        fs.writeFileSync(fpFile, `${computeCursorGenFingerprint(root)}\n`, 'utf8');
      }
    } catch {
      /* ignore fingerprint write failure */
    }
  }
}

function hasAncestorGitExcludingSelf(root) {
  const abs = path.resolve(root);
  if (fs.existsSync(path.join(abs, '.git'))) return false;
  const checkChain = (startDir) => {
    let cur = path.dirname(startDir);
    while (cur && cur !== startDir) {
      if (fs.existsSync(path.join(cur, '.git'))) return true;
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    return false;
  };
  if (checkChain(abs)) return true;
  const real = resolveRealOrNull(abs);
  if (real && real !== abs && checkChain(real)) return true;
  return false;
}

function needsUnownedParentGitCeiling(root) {
  if (!hasAncestorGitExcludingSelf(root)) return false;
  const r = spawnSync('git', ['ls-files', '--error-unmatch', '.'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 3000,
  });
  if (r.error && r.error.code === 'ENOENT') return false;
  return r.status !== 0;
}

function computeGitCeiling(root, existingCeiling = '') {
  const candidates = [];
  const realRoot = resolveRealOrNull(root) || path.resolve(root);
  const realParent = path.dirname(realRoot);
  const lexParent = path.dirname(path.resolve(root));
  if (realParent) candidates.push(realParent);
  if (lexParent && lexParent !== realParent) candidates.push(lexParent);

  const parts = String(existingCeiling || '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const cand of candidates) {
    const exists = parts.some((p) =>
      process.platform === 'win32' ? p.toLowerCase() === cand.toLowerCase() : p === cand,
    );
    if (!exists) parts.push(cand);
  }
  return parts.join(path.delimiter);
}

// ---------------------------------------------------------------------------
// Subagent Active State Table
// ---------------------------------------------------------------------------

const subagentStateDir = (root) => path.join(root, '.claude', 'evidence', '.cursor-subagents');
const subagentEntryPath = (dir, id) => path.join(dir, `${crypto.createHash('sha256').update(id).digest('hex').slice(0, 32)}.json`);

function pruneExpiredSubagents(stateDir, now) {
  let names;
  try { names = fs.readdirSync(stateDir); } catch { return; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const fp = path.join(stateDir, name);
    try {
      const v = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!v || typeof v.ts !== 'number' || (now - v.ts) > SUBAGENT_TTL_MS) fs.unlinkSync(fp);
    } catch (e) {
      if (!e || e.code === 'ENOENT') continue;
      say(`[cursor-hook-adapter] 清理异常子代理状态项 ${name}：${e.message || e}`);
      try { fs.unlinkSync(fp); } catch { /* 已被并发清理 */ }
    }
  }
}

function writeSubagentEntryAtomic(stateDir, id, record) {
  const entryFile = subagentEntryPath(stateDir, id);
  const payload = JSON.stringify(record) + '\n';
  for (let attempt = 0; attempt < 2; attempt++) {
    fs.mkdirSync(stateDir, { recursive: true });
    const tmpFile = `${entryFile}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmpFile, payload, 'utf8');
      fs.renameSync(tmpFile, entryFile);
      return;
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch { /* 忽略清理失败 */ }
      if (attempt === 0 && e && e.code === 'ENOENT') continue;
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// beforeReadFile Multi-Hop Symlink & Secret Read Guard
// ---------------------------------------------------------------------------

export function cleanPath(p) {
  let s = String(p || '').replace(/\\/g, '/');
  if (!s) return '';
  if (/^\/\/[?.]\/unc\//i.test(s)) s = '//' + s.slice(8);
  else if (/^\/\/[?.]\/[a-z]:/i.test(s)) s = s.slice(4);
  while (/^[a-z]:(?![/])/i.test(s)) s = s.slice(2);
  const driveAbs = /^([a-z]):\/(.*)$/i.exec(s);
  let prefix = '';
  if (driveAbs) { prefix = `${driveAbs[1].toLowerCase()}:/`; s = driveAbs[2]; }
  else if (s.startsWith('//')) { prefix = '//'; s = s.slice(2); }
  else if (s.startsWith('/')) { prefix = '/'; s = s.slice(1); }
  const segs = s.split('/').map((seg) => ((seg === '' || seg === '.' || seg === '..') ? seg : seg.replace(/[. ]+$/, '')));
  if (!prefix && segs.every((seg) => seg === '')) return '';
  let norm = prefix.endsWith(':/') ? prefix.slice(0, 2) + path.posix.normalize('/' + segs.join('/'))
    : (prefix === '//' ? '/' + path.posix.normalize('/' + segs.join('/')) : path.posix.normalize(prefix + segs.join('/')));
  if (norm.length > 1 && !/^[a-z]:\/$/i.test(norm) && norm !== '//') norm = norm.replace(/\/+$/, '');
  return norm;
}

function isUnsafeRoot(cleanedRoot) {
  const lower = String(cleanedRoot || '').toLowerCase();
  if (!lower || lower === '/' || lower === '//' || lower === '.' || /^[a-z]:\/?$/.test(lower)) return true;
  return SENSITIVE_ROOT_BASENAMES.has(path.posix.basename(lower)) || SENSITIVE_ROOT_ANCESTOR_RE.test(lower);
}

function buildSafeRoots(rawRoots) {
  const seen = new Set();
  const safe = [];
  const add = (c) => { if (c && !isUnsafeRoot(c) && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); safe.push(c); } };
  for (const r of rawRoots) {
    const cleaned = cleanPath(r);
    if (!cleaned || isUnsafeRoot(cleaned)) continue;
    let realCleaned = '';
    try { realCleaned = cleanPath(fs.realpathSync(r)); } catch { /* 根不存在时按字面判定 */ }
    if (realCleaned && isUnsafeRoot(realCleaned)) continue;
    add(cleaned);
    add(realCleaned);
  }
  return safe.sort((a, b) => b.length - a.length);
}

function stripSafeRoot(cleanedTarget, safeRoots) {
  const lowerTarget = cleanedTarget.toLowerCase();
  for (const root of safeRoots) {
    const lowerRoot = root.toLowerCase();
    if (lowerTarget === lowerRoot) return '';
    if (lowerTarget.startsWith(lowerRoot + '/')) return cleanedTarget.slice(root.length + 1);
  }
  return cleanedTarget;
}

const matchesSecretPattern = (target) => Boolean(target) && SECRET_READ_PATTERNS.some((re) => re.test(target));

function pickFilePath(ev) {
  const ti = (ev.tool_input && typeof ev.tool_input === 'object' && !Array.isArray(ev.tool_input)) ? ev.tool_input : null;
  return [ev.file_path, ev.path, ti && ti.file_path, ti && ti.path].find((c) => trimStr(c)) || null;
}

function denyRead(userMsg, diagMsg) {
  emit({ permission: 'deny', user_message: userMsg });
  say(`[cursor-hook-adapter] ${diagMsg}`);
  process.exitCode = 2;
}

function inspectFsSymlinks(startAbs, safeRoots, rawLabel) {
  let cur = startAbs;
  for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop++) {
    let realErr = null;
    try {
      const real = fs.realpathSync(cur);
      return matchesSecretPattern(stripSafeRoot(cleanPath(real), safeRoots)) ? `beforeReadFile 拦截软链敏感目标 (${rawLabel} -> ${real})` : null;
    } catch (e) { realErr = e; }
    const code = realErr && realErr.code;
    if (code === 'ELOOP') return `beforeReadFile 符号链接环 (${rawLabel})`;
    const root = path.parse(cur).root || path.sep;
    const segs = cur.slice(root.length).split(path.sep).filter((s) => s && s !== '.');
    let prefix = root;
    let stepped = false;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] === '..') { prefix = path.dirname(prefix); continue; }
      prefix = prefix.endsWith(path.sep) ? prefix + segs[i] : prefix + path.sep + segs[i];
      let st;
      try { st = fs.lstatSync(prefix); } catch (le) {
        const lc = le && le.code;
        if (lc === 'ENOENT' || lc === 'ENOTDIR') break;
        return `beforeReadFile 路径元数据不可读 fail-closed (${rawLabel}: ${lc || 'ERR'})`;
      }
      if (!st.isSymbolicLink()) continue;
      let target;
      try { target = fs.readlinkSync(prefix); } catch (re) { return `beforeReadFile 软链读取失败 fail-closed (${rawLabel}: ${(re && re.code) || 'ERR'})`; }
      const resolvedPrefix = path.resolve(path.dirname(prefix), target);
      const rest = segs.slice(i + 1);
      cur = rest.length > 0 ? [resolvedPrefix, ...rest].join(path.sep) : resolvedPrefix;
      if (matchesSecretPattern(stripSafeRoot(cleanPath(cur), safeRoots))) return `beforeReadFile 拦截软链敏感目标 (${rawLabel} -> ${cur})`;
      stepped = true;
      break;
    }
    if (!stepped) return (code === 'EACCES' || code === 'EPERM') ? `beforeReadFile 权限拒绝 fail-closed (${rawLabel}: ${code})` : null;
  }
  return `beforeReadFile 软链跳数超限 ELOOP (${rawLabel})`;
}

function handleBeforeReadFile(stdin) {
  try {
    if (!stdin.ok) return denyRead('安全护栏：禁止读取密钥或凭据文件（输入异常）', 'beforeReadFile 输入为空或非对象，fail-closed');
    const ev = stdin.value;
    const rawFilePath = pickFilePath(ev);
    if (!rawFilePath) return denyRead('安全护栏：禁止读取密钥或凭据文件（输入异常）', 'beforeReadFile 缺少非空 file_path，fail-closed');
    const cleanedRaw = cleanPath(rawFilePath);
    if (!cleanedRaw) return denyRead('安全护栏：禁止读取密钥或凭据文件（输入异常）', `beforeReadFile 归一化后为空 (${rawFilePath})`);

    const rawRoots = [process.env.CURSOR_PROJECT_DIR, process.env.CLAUDE_PROJECT_DIR, ...(Array.isArray(ev.workspace_roots) ? ev.workspace_roots : [])].filter(trimStr);
    const cwdRaw = trimStr(ev.cwd);
    const safeRoots = buildSafeRoots(rawRoots);
    const literalTargets = new Set([cleanedRaw]);
    if (!(cleanedRaw.startsWith('/') || /^[a-z]:\//i.test(cleanedRaw))) {
      for (const b of [cwdRaw, ...rawRoots]) { const cb = cleanPath(b); if (cb) literalTargets.add(cleanPath(`${cb}/${cleanedRaw}`)); }
    }
    for (const t of literalTargets) {
      if (t && matchesSecretPattern(stripSafeRoot(t, safeRoots))) return denyRead('安全护栏：禁止读取密钥或凭据文件', `beforeReadFile 拦截敏感路径 (${rawFilePath})`);
    }

    const fsCandidates = new Set();
    const hasDotDot = /(^|[\\/])\.\.([\\/]|$)/.test(rawFilePath);
    if (path.isAbsolute(rawFilePath)) {
      if (hasDotDot) fsCandidates.add(rawFilePath);
      fsCandidates.add(path.resolve(rawFilePath));
    } else {
      for (const base of new Set([cwdRaw, ...rawRoots, process.cwd()].filter(Boolean))) {
        if (hasDotDot) fsCandidates.add(`${path.resolve(base).replace(/[\\/]+$/, '')}${path.sep}${rawFilePath}`);
        fsCandidates.add(path.resolve(base, rawFilePath));
      }
    }
    for (const cand of fsCandidates) {
      const hitReason = inspectFsSymlinks(cand, safeRoots, rawFilePath);
      if (hitReason) return denyRead('安全护栏：禁止读取密钥或凭据文件', hitReason);
    }
    emit({ permission: 'allow' });
    process.exitCode = 0;
  } catch (e) {
    denyRead('安全护栏：禁止读取密钥或凭据文件（输入异常）', `beforeReadFile 内部异常：${e && (e.message || e)}`);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle & Shell Handlers
// ---------------------------------------------------------------------------

function handleSessionStart(ev) {
  const root = resolveProjectRoot(ev);
  const claudeDir = path.join(root, '.claude');
  if (statOrNull(claudeDir)?.isDirectory()) {
    selfHealSkillsLink(root);
    selfHealClaudeSettingsStringForm(root);
    selfHealGeneratedCursorAssets(root);
  }

  const inRoot = path.join(root, '.cursor', 'scripts', 'cursor-hook-preload.mjs');
  const preloadUrl = pathToFileURL(path.resolve(fs.existsSync(inRoot) ? inRoot : path.join(SCRIPT_DIR, 'cursor-hook-preload.mjs'))).href;
  const flag = `--import ${preloadUrl}`;
  const existing = trimStr(process.env.NODE_OPTIONS);
  const hasFlag = existing.includes(flag) || existing.includes(`--import=${preloadUrl}`);
  const envOut = {
    NODE_OPTIONS: !existing ? flag : (hasFlag ? existing : `${existing} ${flag}`),
  };

  if (needsUnownedParentGitCeiling(root)) {
    envOut.GIT_CEILING_DIRECTORIES = computeGitCeiling(root, process.env.GIT_CEILING_DIRECTORIES);
  }

  emit({ env: envOut });
  process.exitCode = 0;
}

function handleSubagentStart(ev) {
  const id = trimStr(ev.subagent_id || ev.agent_id);
  if (id) {
    const now = Date.now();
    const stateDir = subagentStateDir(resolveProjectRoot(ev));
    writeSubagentEntryAtomic(stateDir, id, {
      subagent_id: id,
      subagent_type: trimStr(ev.subagent_type),
      conversation_id: trimStr(ev.conversation_id),
      parent_conversation_id: trimStr(ev.parent_conversation_id),
      ts: now,
    });
    pruneExpiredSubagents(stateDir, now);
  }
  emit({ permission: 'allow' });
  process.exitCode = 0;
}

function handleSubagentStop(ev) {
  const id = trimStr(ev.subagent_id || ev.agent_id);
  const stateDir = subagentStateDir(resolveProjectRoot(ev));
  if (id) {
    try {
      fs.unlinkSync(subagentEntryPath(stateDir, id));
    } catch (e) {
      if (e && e.code !== 'ENOENT') say(`[cursor-hook-adapter] 删除子代理状态项失败：${e.message || e}`);
    }
  }
  pruneExpiredSubagents(stateDir, Date.now());
  try {
    if (!fs.readdirSync(stateDir).some((n) => n.endsWith('.json'))) fs.rmdirSync(stateDir);
  } catch (e) {
    if (e && e.code !== 'ENOENT' && e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') {
      say(`[cursor-hook-adapter] 回收子代理目录失败：${e.message || e}`);
    }
  }
  emit({});
  process.exitCode = 0;
}

function handleBeforeShellExecution(ev) {
  const cmd = typeof ev.command === 'string'
    ? ev.command
    : (ev.tool_input && typeof ev.tool_input.command === 'string' ? ev.tool_input.command : '');

  const dangerReason = checkDangerousCommand(cmd);
  if (dangerReason) {
    emit({
      permission: 'deny',
      user_message: `安全护栏（dangerous-command）：${dangerReason}`,
    });
    say(`[cursor-hook-adapter] beforeShellExecution 拦截高危命令：${dangerReason}`);
    process.exitCode = 2;
    return;
  }

  const secretReason = checkSecretExfil(cmd);
  if (secretReason) {
    emit({
      permission: 'deny',
      user_message: `安全护栏（secret-exfil）：${secretReason}`,
    });
    say(`[cursor-hook-adapter] beforeShellExecution 拦截密钥读取/外传命令：${secretReason}`);
    process.exitCode = 2;
    return;
  }

  if (ASK_PUBLISH_RE.test(cmd)) {
    emit({
      permission: 'ask',
      user_message: 'HIGH 档发布命令（gh release / npm publish / docker push），对齐 cc-base permissions.ask，须用户显式批准。',
    });
    process.exitCode = 0;
    return;
  }

  emit({ permission: 'allow' });
  process.exitCode = 0;
}

const isMain = process.argv[1] && (
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]) ||
  path.basename(process.argv[1]) === 'hook-adapter.mjs'
);

if (isMain) {
  const stdin = parseStdin();
  const mode = process.argv[2] || (stdin.ok ? String(stdin.value.hook_event_name || stdin.value.hookEventName || '') : '');
  if (mode === 'beforeReadFile') {
    handleBeforeReadFile(stdin);
  } else {
    try {
      if (!stdin.ok && !stdin.empty) say(`[cursor-hook-adapter] ${mode || 'unknown'} 收到坏 JSON，按空对象降级`);
      const ev = stdin.ok ? stdin.value : {};
      if (mode === 'sessionStart') handleSessionStart(ev);
      else if (mode === 'subagentStart') handleSubagentStart(ev);
      else if (mode === 'subagentStop') handleSubagentStop(ev);
      else if (mode === 'beforeShellExecution') handleBeforeShellExecution(ev);
      else { emit({}); process.exitCode = 0; }
    } catch (e) {
      say(`[cursor-hook-adapter] ${mode || 'unknown'} 内部异常，fail-open 放行：${e && (e.message || e)}`);
      emit(mode === 'subagentStart' || mode === 'beforeShellExecution' ? { permission: 'allow' } : {});
      process.exitCode = 0;
    }
  }
}
