#!/usr/bin/env node
// hook-adapter.mjs — Cursor 原生事件适配器（与 .claude/settings.json 零重叠互补）。
// 覆盖 5 个原生事件：sessionStart / subagentStart / subagentStop / beforeReadFile / beforeShellExecution。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isatty } from 'node:tty';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STDIN_WAIT_MAX_MS = 3000, STDIN_RETRY_MS = 5, SUBAGENT_TTL_MS = 30 * 60 * 1000, MAX_SYMLINK_HOPS = 40;
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
const ASK_PUBLISH_RE = /(^|[\s;&|()])(gh\s+release\b|npm\s+publish\b|docker\s+push\b)/;
const emit = (obj) => { fs.writeSync(1, JSON.stringify(obj) + '\n'); };
const say = (text) => { fs.writeSync(2, String(text) + '\n'); };
const trimStr = (v) => (typeof v === 'string' ? v.trim() : '');

function readStdinRaw() {
  if (isatty(0)) return '';
  const chunks = [], buf = Buffer.alloc(64 * 1024), sleeper = new Int32Array(new SharedArrayBuffer(4));
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
  } catch (_e) { return { raw, empty: false, ok: false, value: null }; }
}

function resolveProjectRoot(ev) {
  const ws0 = ev && Array.isArray(ev.workspace_roots) ? ev.workspace_roots[0] : '';
  for (const c of [process.env.CLAUDE_PROJECT_DIR, process.env.CURSOR_PROJECT_DIR, ws0, ev && ev.cwd]) {
    if (trimStr(c)) return path.resolve(trimStr(c));
  }
  return path.resolve(SCRIPT_DIR, '..', '..');
}

const subagentStateDir = (root) => path.join(root, '.claude', 'evidence', '.cursor-subagents');
const subagentEntryPath = (dir, id) => path.join(dir, `${crypto.createHash('sha256').update(id).digest('hex').slice(0, 32)}.json`);

function pruneExpiredSubagents(stateDir, now) {
  let names;
  try { names = fs.readdirSync(stateDir); } catch (_e) { return; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const fp = path.join(stateDir, name);
    try {
      const v = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!v || typeof v.ts !== 'number' || (now - v.ts) > SUBAGENT_TTL_MS) fs.unlinkSync(fp);
    } catch (e) {
      if (!e || e.code === 'ENOENT') continue;
      say(`[cursor-hook-adapter] 清理异常子代理状态项 ${name}：${e.message || e}`);
      try { fs.unlinkSync(fp); } catch (_e2) { /* 已被并发清理 */ }
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
      try { fs.unlinkSync(tmpFile); } catch (_e2) { /* 忽略清理失败 */ }
      if (attempt === 0 && e && e.code === 'ENOENT') continue;
      throw e;
    }
  }
}

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
  const seen = new Set(), safe = [];
  const add = (c) => { if (c && !isUnsafeRoot(c) && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); safe.push(c); } };
  for (const r of rawRoots) {
    const cleaned = cleanPath(r);
    if (!cleaned || isUnsafeRoot(cleaned)) continue;
    let realCleaned = '';
    try { realCleaned = cleanPath(fs.realpathSync(r)); } catch (_e) { /* 根不存在时按字面判定 */ }
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
    let prefix = root, stepped = false;
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
      const resolvedPrefix = path.resolve(path.dirname(prefix), target), rest = segs.slice(i + 1);
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
    const ev = stdin.value, rawFilePath = pickFilePath(ev);
    if (!rawFilePath) return denyRead('安全护栏：禁止读取密钥或凭据文件（输入异常）', 'beforeReadFile 缺少非空 file_path，fail-closed');
    const cleanedRaw = cleanPath(rawFilePath);
    if (!cleanedRaw) return denyRead('安全护栏：禁止读取密钥或凭据文件（输入异常）', `beforeReadFile 归一化后为空 (${rawFilePath})`);

    const rawRoots = [process.env.CURSOR_PROJECT_DIR, process.env.CLAUDE_PROJECT_DIR, ...(Array.isArray(ev.workspace_roots) ? ev.workspace_roots : [])].filter(trimStr);
    const cwdRaw = trimStr(ev.cwd), safeRoots = buildSafeRoots(rawRoots), literalTargets = new Set([cleanedRaw]);
    if (!(cleanedRaw.startsWith('/') || /^[a-z]:\//i.test(cleanedRaw))) {
      for (const b of [cwdRaw, ...rawRoots]) { const cb = cleanPath(b); if (cb) literalTargets.add(cleanPath(`${cb}/${cleanedRaw}`)); }
    }
    for (const t of literalTargets) {
      if (t && matchesSecretPattern(stripSafeRoot(t, safeRoots))) return denyRead('安全护栏：禁止读取密钥或凭据文件', `beforeReadFile 拦截敏感路径 (${rawFilePath})`);
    }

    const fsCandidates = new Set(), hasDotDot = /(^|[\\/])\.\.([\\/]|$)/.test(rawFilePath);
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
  } catch (e) { denyRead('安全护栏：禁止读取密钥或凭据文件（输入异常）', `beforeReadFile 内部异常：${e && (e.message || e)}`); }
}

function handleSessionStart(ev) {
  const inRoot = path.join(resolveProjectRoot(ev), '.cursor', 'scripts', 'cursor-hook-preload.mjs');
  const preloadUrl = pathToFileURL(path.resolve(fs.existsSync(inRoot) ? inRoot : path.join(SCRIPT_DIR, 'cursor-hook-preload.mjs'))).href;
  const flag = `--import ${preloadUrl}`, existing = trimStr(process.env.NODE_OPTIONS);
  const hasFlag = existing.includes(flag) || existing.includes(`--import=${preloadUrl}`);
  emit({ env: { NODE_OPTIONS: !existing ? flag : (hasFlag ? existing : `${existing} ${flag}`) } });
  process.exitCode = 0;
}

function handleSubagentStart(ev) {
  const id = trimStr(ev.subagent_id || ev.agent_id);
  if (id) {
    const now = Date.now(), stateDir = subagentStateDir(resolveProjectRoot(ev));
    writeSubagentEntryAtomic(stateDir, id, {
      subagent_id: id, subagent_type: trimStr(ev.subagent_type),
      conversation_id: trimStr(ev.conversation_id), parent_conversation_id: trimStr(ev.parent_conversation_id), ts: now,
    });
    pruneExpiredSubagents(stateDir, now);
  }
  emit({ permission: 'allow' });
  process.exitCode = 0;
}

function handleSubagentStop(ev) {
  const id = trimStr(ev.subagent_id || ev.agent_id), stateDir = subagentStateDir(resolveProjectRoot(ev));
  if (id) {
    try { fs.unlinkSync(subagentEntryPath(stateDir, id)); } catch (e) { if (e && e.code !== 'ENOENT') say(`[cursor-hook-adapter] 删除子代理状态项失败：${e.message || e}`); }
  }
  pruneExpiredSubagents(stateDir, Date.now());
  try {
    if (!fs.readdirSync(stateDir).some((n) => n.endsWith('.json'))) fs.rmdirSync(stateDir);
  } catch (e) {
    if (e && e.code !== 'ENOENT' && e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') say(`[cursor-hook-adapter] 回收子代理目录失败：${e.message || e}`);
  }
  emit({});
  process.exitCode = 0;
}

function handleBeforeShellExecution(ev) {
  const cmd = typeof ev.command === 'string' ? ev.command : (ev.tool_input && typeof ev.tool_input.command === 'string' ? ev.tool_input.command : '');
  emit(ASK_PUBLISH_RE.test(cmd)
    ? { permission: 'ask', user_message: 'HIGH 档发布命令（gh release / npm publish / docker push），对齐 cc-base permissions.ask，须用户显式批准。' }
    : { permission: 'allow' });
  process.exitCode = 0;
}

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
