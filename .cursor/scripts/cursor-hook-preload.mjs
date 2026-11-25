// cursor-hook-preload.mjs — Cursor 子代理身份桥接预加载模块（由 sessionStart 经 NODE_OPTIONS --import 注入）。
//
// 精确作用面：仅当入口脚本归一化后匹配 /.claude/hooks/(no-direct-code-guard|record-authorship).mjs 时启用；
// 其余任何 Node 进程（含 harness.mjs）零副作用立即返回。
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const TARGET_HOOK_RE = /\/\.claude\/hooks\/(no-direct-code-guard|record-authorship)\.mjs$/;
const SUBAGENT_TTL_MS = 30 * 60 * 1000;
const STDIN_WAIT_MAX_MS = 3000;
const STDIN_RETRY_MS = 5;

function resolveRoot(entryPosix) {
  const claudeDir = (process.env.CLAUDE_PROJECT_DIR || '').trim();
  const cursorDir = (process.env.CURSOR_PROJECT_DIR || '').trim();
  const envRoot = claudeDir || cursorDir;
  if (envRoot) return path.resolve(envRoot);

  const cwd = process.cwd();
  try {
    if (fs.statSync(path.join(cwd, '.claude', 'evidence', '.cursor-subagents')).isDirectory()) {
      return cwd;
    }
  } catch (_e) { /* 目录不存在时继续回退 */ }
  return path.resolve(path.dirname(entryPosix), '..', '..');
}

function loadActiveSubagents(root) {
  const stateDir = path.join(root, '.claude', 'evidence', '.cursor-subagents');
  let names;
  try {
    names = fs.readdirSync(stateDir);
  } catch (_e) {
    return [];
  }
  const now = Date.now();
  const active = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const v = JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8'));
      if (v && typeof v === 'object' && !Array.isArray(v)
        && typeof v.subagent_id === 'string' && v.subagent_id.trim() !== ''
        && typeof v.ts === 'number' && (now - v.ts) <= SUBAGENT_TTL_MS) {
        active.push(v);
      }
    } catch (_e) { /* 单文件并发删除或损坏时跳过 */ }
  }
  return active.sort((a, b) => b.ts - a.ts);
}

function readAllStdinBuffer(origReadSync) {
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let waited = 0;
  for (;;) {
    let n;
    try {
      n = origReadSync.call(fs, 0, buf, 0, buf.length, null);
    } catch (e) {
      const again = e && (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK');
      if (again && waited < STDIN_WAIT_MAX_MS) {
        Atomics.wait(sleeper, 0, 0, STDIN_RETRY_MS);
        waited += STDIN_RETRY_MS;
        continue;
      }
      break;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}

function transformStdinBuffer(rawBuf, activeList) {
  if (rawBuf.length === 0) return rawBuf;
  try {
    const parsed = JSON.parse(rawBuf.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.agent_id) {
      return rawBuf;
    }
    const cid = typeof parsed.conversation_id === 'string' ? parsed.conversation_id.trim() : '';
    if (!cid) return rawBuf;
    const hit = activeList.find((item) => item.subagent_id === cid)
      || activeList.find((item) => typeof item.conversation_id === 'string' && item.conversation_id.trim() === cid);
    if (!hit) return rawBuf;
    parsed.agent_id = hit.subagent_id;
    if (hit.subagent_type && !parsed.agent_type) {
      parsed.agent_type = hit.subagent_type;
    }
    return Buffer.from(JSON.stringify(parsed), 'utf8');
  } catch (_e) {
    // JSON 解析失败时原样按原始字节返回，交由下游 hook 自身错误处理，绝不吞错
    return rawBuf;
  }
}

function installPreload() {
  const rawArg1 = process.argv[1];
  if (typeof rawArg1 !== 'string' || !rawArg1) return;
  const entryPosix = path.resolve(rawArg1).replace(/\\/g, '/');
  if (!TARGET_HOOK_RE.test(entryPosix)) return;

  const root = resolveRoot(entryPosix);
  const activeList = loadActiveSubagents(root);
  if (activeList.length === 0) return;

  const origReadSync = fs.readSync;
  let cachedBuf = null;
  let cachedOffset = 0;

  fs.readSync = function wrappedReadSync(fd, buffer, offsetOrOpts, length, position) {
    if (fd !== 0) {
      return origReadSync.call(this, fd, buffer, offsetOrOpts, length, position);
    }
    let offset = 0;
    let len = buffer.byteLength;
    if (typeof offsetOrOpts === 'object' && offsetOrOpts !== null) {
      offset = offsetOrOpts.offset ?? 0;
      len = offsetOrOpts.length ?? (buffer.byteLength - offset);
    } else if (typeof offsetOrOpts === 'number') {
      offset = offsetOrOpts;
      len = typeof length === 'number' ? length : (buffer.byteLength - offset);
    }
    if (cachedBuf === null) {
      cachedBuf = transformStdinBuffer(readAllStdinBuffer(origReadSync), activeList);
      cachedOffset = 0;
    }
    if (len <= 0 || cachedOffset >= cachedBuf.length) return 0;
    const toCopy = Math.min(len, cachedBuf.length - cachedOffset);
    cachedBuf.copy(buffer, offset, cachedOffset, cachedOffset + toCopy);
    cachedOffset += toCopy;
    return toCopy;
  };
  syncBuiltinESMExports();
}

installPreload();
