#!/usr/bin/env node
// scripts/lib/manifest.mjs — Framework manifest builder, drift checker, and anti-leak scanner for cursor-base.
// Manages .cursor/FRAMEWORK-MANIFEST.json (`engine: "cursor-base"`, `seeded: []` zero root file intrusion).
// Zero npm dependencies (Node >= 20 built-ins only).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './path-guard.mjs';

export const MANIFEST_REL_PATH = '.cursor/FRAMEWORK-MANIFEST.json';
export const OPTIONAL_MANIFEST_REL_PATH = '.cursor/FRAMEWORK-MANIFEST-OPTIONAL.json';
export const ENGINE_NAME = 'cursor-base';

/**
 * Root-level files that must NEVER be copied into a target project under any circumstances
 * (zero root file intrusion!).
 */
export const NEVER_INSTALL_ROOT = new Set([
  'AGENTS.md',
  'AGENTS.local.md',
  'CLAUDE.md',
  'GEMINI.md',
  'progress.md',
  'progress.archive.md',
  'CHANGELOG.md',
  'Product-Spec.md',
  'Product-Spec-CHANGELOG.md',
  'Architecture-Design.md',
  'DFX-Spec.md',
  'Design-Brief.md',
  'DESIGN.md',
  'DEV-PLAN.md',
  'DEV-PLAN.archive.md',
  'README.md',
  'ARCHITECTURE.md',
  'LICENSE',
  'package.json',
  'package-lock.json',
  'cc-base-contract.json',
  'setup.sh',
  'setup.ps1',
  'setup-cursor.sh',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
]);

/**
 * Canonical ordered rules for paths relative to `.cursor/` (first match wins, `*` spans `/`).
 * Excludes OS links (`skills`), generated files (`agents/**`, `rules/cc-base-claude.mdc`),
 * losslessly merged JSON configs (`hooks.json`, `cli.json`), user model overrides (`agents-models.json`),
 * runtime/state dirs (`.runtime/**`, `harness-state/**`), `tests/**`, and installer sidecars.
 */
export const CURSOR_MANIFEST_RULES = [
  { pattern: 'FRAMEWORK-MANIFEST.json', keep: false },
  { pattern: 'FRAMEWORK-MANIFEST-OPTIONAL.json', keep: false },
  { pattern: 'hooks.json', keep: false },
  { pattern: 'cli.json', keep: false },
  { pattern: 'agents-models.json', keep: false },
  { pattern: 'worktrees.json', keep: false },
  { pattern: 'cc-base-files.txt', keep: false },
  { pattern: 'cc-base-version.txt', keep: false },
  { pattern: 'skills', keep: false },
  { pattern: 'skills/*', keep: false },
  { pattern: 'agents', keep: false },
  { pattern: 'agents/*', keep: false },
  { pattern: 'rules/cc-base-claude.mdc', keep: false },
  { pattern: '.runtime', keep: false },
  { pattern: '.runtime/*', keep: false },
  { pattern: 'harness-state', keep: false },
  { pattern: 'harness-state/*', keep: false },
  { pattern: 'local/*', keep: false },
  { pattern: 'evidence/*', keep: false },
  { pattern: 'tests', keep: false },
  { pattern: 'tests/*', keep: false },
  { pattern: 'worktrees/*', keep: false },
  { pattern: 'agent-memory/*', keep: false },
  { pattern: 'feedback/*', keep: false },
  { pattern: 'EVOLUTION.md', keep: false },
  { pattern: '*.bak', keep: false },
  { pattern: '*.bak-*', keep: false },
  { pattern: '*.bak.*', keep: false },
  { pattern: '*.cursor-new', keep: false },
  { pattern: '*.framework-new', keep: false },
  { pattern: '*.cac-link-new', keep: false },
  { pattern: '*.cac-base-new', keep: false },
  { pattern: '.DS_Store', keep: false },
  { pattern: '*/.DS_Store', keep: false },
  { pattern: 'Thumbs.db', keep: false },
  { pattern: '*/Thumbs.db', keep: false },
  { pattern: '*.swp', keep: false },
];

export function casePatternToRegExp(pattern) {
  const alts = String(pattern).split('|').map((part) => {
    let re = '';
    for (const ch of part) {
      if (ch === '*') re += '.*';
      else if (ch === '?') re += '.';
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return re;
  });
  return new RegExp(`^(?:${alts.join('|')})$`);
}

const COMPILED_MAIN_RULES = CURSOR_MANIFEST_RULES.map((r) => ({
  re: casePatternToRegExp(r.pattern),
  keep: r.keep,
}));

/**
 * Strip CR (0x0d) bytes from a Buffer for cross-platform LF-normalized hashing.
 * @param {Buffer} buf
 * @returns {Buffer}
 */
export function stripCrBytes(buf) {
  let hasCr = false;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d) {
      hasCr = true;
      break;
    }
  }
  if (!hasCr) return buf;
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0d) out[n++] = buf[i];
  }
  return out.subarray(0, n);
}

/**
 * Compute LF-normalized SHA256 and normalized byte length from a Buffer or string.
 * @param {Buffer | string} input
 * @returns {{ sha256: string, bytes: number }}
 */
export function hashLfBuffer(input) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const norm = stripCrBytes(raw);
  const sha256 = createHash('sha256').update(norm).digest('hex');
  return { sha256, bytes: norm.length };
}

/**
 * Compute LF-normalized SHA256 and normalized byte count of a file on disk.
 * @param {string} filePath
 * @returns {{ sha256: string, bytes: number }}
 */
export function hashLfFile(filePath) {
  return hashLfBuffer(fs.readFileSync(filePath));
}

/**
 * Determine whether a `.cursor/`-relative path belongs in `.cursor/FRAMEWORK-MANIFEST.json`.
 * @param {string} relInCursor
 * @returns {boolean}
 */
export function isCoreManifestFile(relInCursor) {
  const rel = toPosix(relInCursor).replace(/^\/+/, '');
  if (!rel) return false;
  for (const r of COMPILED_MAIN_RULES) {
    if (r.re.test(rel)) return r.keep;
  }
  return true;
}

/**
 * Recursively walk regular files under `dir` (NEVER traversing symlinks or NTFS Junctions),
 * returning paths relative to `baseDir` with POSIX slashes.
 * @param {string} dir
 * @param {string} [baseDir]
 * @returns {string[]}
 */
export function walkRegularFiles(dir, baseDir = dir) {
  const out = [];
  const visit = (cur) => {
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) visit(full);
      else if (ent.isFile()) out.push(toPosix(path.relative(baseDir, full)));
    }
  };
  if (fs.existsSync(dir)) visit(dir);
  return out;
}

/**
 * Build the core manifest object from a `cursor-base` source root (`seeded: []` always).
 * @param {string} root
 */
export function buildCoreManifest(root) {
  const cursorDir = path.join(root, '.cursor');
  const files = [];
  if (fs.existsSync(cursorDir)) {
    for (const relInCursor of walkRegularFiles(cursorDir, cursorDir)) {
      if (!isCoreManifestFile(relInCursor)) continue;
      const full = path.join(cursorDir, relInCursor);
      const { sha256, bytes } = hashLfFile(full);
      files.push({ path: `.cursor/${relInCursor}`, sha256, bytes });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    version: 1,
    engine: ENGINE_NAME,
    seeded: [],
    files,
  };
}

/**
 * Write `.cursor/FRAMEWORK-MANIFEST.json` atomically.
 * @param {string} root
 */
export function writeManifest(root) {
  const manifest = buildCoreManifest(root);
  const outPath = path.join(root, MANIFEST_REL_PATH);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, outPath);
  return {
    status: 'ok',
    code: 0,
    summary: `manifest write: ${manifest.files.length} managed files, 0 seeded files`,
    path: MANIFEST_REL_PATH,
    files: manifest.files.length,
    seeded: 0,
  };
}

/**
 * Check `.cursor/FRAMEWORK-MANIFEST.json` against live source tree.
 * @param {string} root
 */
export function checkManifest(root) {
  const manifestPath = path.join(root, MANIFEST_REL_PATH);
  if (!fs.existsSync(manifestPath)) {
    return {
      status: 'blocked',
      code: 2,
      summary: `missing ${MANIFEST_REL_PATH}; run: node scripts/cursor-base.mjs manifest --write`,
      problems: [`missing: ${MANIFEST_REL_PATH}`],
    };
  }
  let recorded;
  try {
    recorded = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return {
      status: 'violation',
      code: 1,
      summary: `${MANIFEST_REL_PATH} is not valid JSON: ${e.message}`,
      problems: [`corrupt: ${MANIFEST_REL_PATH}`],
    };
  }
  if (!recorded || recorded.version !== 1 || recorded.engine !== ENGINE_NAME || !Array.isArray(recorded.files)) {
    return {
      status: 'violation',
      code: 1,
      summary: `${MANIFEST_REL_PATH} has invalid schema (expected version=1, engine="${ENGINE_NAME}", files=[])`,
      problems: ['schema-mismatch'],
    };
  }

  const live = buildCoreManifest(root);
  const problems = [];

  const recMap = new Map(recorded.files.map((f) => [f.path, f]));
  const liveMap = new Map(live.files.map((f) => [f.path, f]));

  for (const [p, lf] of liveMap) {
    const rf = recMap.get(p);
    if (!rf) problems.push(`unlisted file on disk: ${p}`);
    else if (rf.sha256 !== lf.sha256) {
      problems.push(`sha256 drift: ${p} (manifest=${String(rf.sha256).slice(0, 8)} actual=${lf.sha256.slice(0, 8)})`);
    }
  }
  for (const p of recMap.keys()) {
    if (!liveMap.has(p)) problems.push(`missing file on disk: ${p}`);
  }
  if (Array.isArray(recorded.seeded) && recorded.seeded.length > 0) {
    problems.push(`unexpected non-empty seeded array (${recorded.seeded.length})`);
  }

  const code = problems.length > 0 ? 1 : 0;
  return {
    status: code === 0 ? 'ok' : 'violation',
    code,
    summary: code === 0
      ? `manifest check: ${live.files.length} files match ${MANIFEST_REL_PATH}`
      : `manifest check: ${problems.length} drift item(s) detected`,
    checked: live.files.length,
    problems,
  };
}

// ---------------------------------------------------------------------------
// Anti-leak scanner (--leak)
// ---------------------------------------------------------------------------

const IGNORE_MARKER_RE = /(?:cursor-leak:ignore|cac-leak:ignore|harness-fitness:ignore)/i;

const PLACEHOLDER_USER_NAMES = new Set([
  'user', 'username', 'users', 'your-name', 'your_name', 'yourname', 'you',
  'alice', 'bob', 'charlie', 'demo', 'example', 'sample', 'test', 'tester',
  'runner', 'ubuntu', 'admin', 'administrator', 'developer', 'dev', 'ci', 'foo', 'bar', 'xxx',
  'me', 'name', 'owner', 'placeholder',
]);

const PLACEHOLDER_VALUE_RE = /\b(?:example|sample|dummy|placeholder|changeme|your[_-]|xxx+|lorem|test|demo|replace[_-]?me|fake|mock|redacted|todo|localhost|127\.0\.0\.1)\b|<[a-z0-9_-]+>|\*{3,}/i;

const POSIX_DEV_PATH_RE = /(?:^|[\s"'`=(])\/(home|Users)\/([A-Za-z0-9._-]{2,})(?=\/|$|[\s"'`),:;])/g;
const WIN_DEV_PATH_RE = /\b[A-Za-z]:[\\/]{1,2}(?:Users|Documents and Settings)[\\/]{1,2}([A-Za-z0-9._-]{2,})(?=[\\/]|$|[\s"'`),:;])/gi;
const PRIVATE_DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:corp|internal|intranet|lan|localdomain|priv)\b/gi;
const DB_CONN_RE = /\b(?:mongodb(?:\+srv)?|postgresql|postgres|mysql|mariadb|redis|rediss|mssql|amqp|amqps):\/\/[A-Za-z0-9_][^\s"'`<>,;)]+/gi;
const PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const SECRET_TOKEN_RE = /(?:\bAKIA[0-9A-Z]{16}\b|\bsk-(?:live-|proj-)?[A-Za-z0-9]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bxox[baprs]-[A-Za-z0-9-]{12,}\b)/g;
const CRED_ASSIGN_RE = /\b(?:password|passwd|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|refresh[_-]?token|x[_-]?auth[_-]?token)\s*[:=]\s*["']([^"'\r\n]{12,})["']/gi;
const CRED_FILENAME_RE = /(?:^|\/)\.(?:env|credentials\.json)$|\.(?:pem|p12|pfx|key|keystore|jks)$/i;

/**
 * Scan a single file's text + relative path for leaks.
 * @param {string} relPath
 * @param {string} text
 */
export function scanTextForLeaks(relPath, text) {
  const hits = [];
  const normPath = toPosix(relPath);
  if (!/(?:^|\/)\.env\.(?:example|sample|template)$/i.test(normPath) && CRED_FILENAME_RE.test(normPath)) {
    hits.push({ file: normPath, line: 0, rule: 'credentials-file', message: '疑似凭据文件进入分发范围' });
  }
  if (!text || text.includes('\0')) return hits;

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    if (IGNORE_MARKER_RE.test(line) || IGNORE_MARKER_RE.test(prev)) continue;

    POSIX_DEV_PATH_RE.lastIndex = 0;
    let m;
    while ((m = POSIX_DEV_PATH_RE.exec(line)) !== null) {
      const user = m[2];
      if (/^\.+$/.test(user) || PLACEHOLDER_USER_NAMES.has(user.toLowerCase())) continue;
      hits.push({
        file: normPath,
        line: i + 1,
        rule: 'dev-path-posix',
        message: '开发者本机绝对路径泄漏',
        match: `/${m[1]}/${user}`,
      });
    }

    WIN_DEV_PATH_RE.lastIndex = 0;
    while ((m = WIN_DEV_PATH_RE.exec(line)) !== null) {
      const user = m[1];
      if (/^\.+$/.test(user) || PLACEHOLDER_USER_NAMES.has(user.toLowerCase())) continue;
      hits.push({
        file: normPath,
        line: i + 1,
        rule: 'dev-path-win',
        message: 'Windows 开发者本机绝对路径泄漏',
        match: m[0].slice(0, 80),
      });
    }

    PRIVATE_DOMAIN_RE.lastIndex = 0;
    while ((m = PRIVATE_DOMAIN_RE.exec(line)) !== null) {
      if (PLACEHOLDER_VALUE_RE.test(m[0]) || PLACEHOLDER_VALUE_RE.test(line)) continue;
      hits.push({
        file: normPath,
        line: i + 1,
        rule: 'internal-domain',
        message: '内网私有域名泄漏',
        match: m[0].slice(0, 80),
      });
    }

    DB_CONN_RE.lastIndex = 0;
    while ((m = DB_CONN_RE.exec(line)) !== null) {
      if (PLACEHOLDER_VALUE_RE.test(m[0]) || PLACEHOLDER_VALUE_RE.test(line)) continue;
      hits.push({
        file: normPath,
        line: i + 1,
        rule: 'db-conn',
        message: '数据库连接串泄漏',
        match: m[0].slice(0, 80),
      });
    }

    if (PRIVATE_KEY_RE.test(line)) {
      hits.push({
        file: normPath,
        line: i + 1,
        rule: 'private-key',
        message: '硬编码私钥块泄漏',
        match: '-----BEGIN * PRIVATE KEY-----',
      });
    }

    SECRET_TOKEN_RE.lastIndex = 0;
    while ((m = SECRET_TOKEN_RE.exec(line)) !== null) {
      if (PLACEHOLDER_VALUE_RE.test(m[0]) || PLACEHOLDER_VALUE_RE.test(line)) continue;
      hits.push({
        file: normPath,
        line: i + 1,
        rule: 'secret-token',
        message: '疑似硬编码密钥/Token 泄漏',
        match: `${m[0].slice(0, 8)}...`,
      });
    }

    CRED_ASSIGN_RE.lastIndex = 0;
    while ((m = CRED_ASSIGN_RE.exec(line)) !== null) {
      const val = m[1];
      if (PLACEHOLDER_VALUE_RE.test(val) || PLACEHOLDER_VALUE_RE.test(line) || /^\$\{/.test(val)) continue;
      hits.push({
        file: normPath,
        line: i + 1,
        rule: 'credential-assign',
        message: '疑似硬编码凭证赋值泄漏',
        match: `${m[0].slice(0, 20)}...`,
      });
    }
  }

  return hits;
}

/**
 * Scan all distributable files in `root` for privacy/secret leaks.
 * @param {string} root
 * @param {{ requireManifestOnDisk?: boolean }} [opts]
 */
export function leakScanManifest(root, { requireManifestOnDisk = false } = {}) {
  const manifestPath = path.join(root, MANIFEST_REL_PATH);
  const unpack = [];
  let targetPaths = [];

  if (fs.existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const listed = [
        ...(Array.isArray(parsed.files) ? parsed.files.map((f) => f.path) : []),
        ...(Array.isArray(parsed.seeded) ? parsed.seeded.map((f) => f.path) : []),
      ];
      for (const rel of listed) {
        if (!fs.existsSync(path.join(root, rel))) {
          unpack.push({ type: 'UNPACK_MISSING', file: rel, message: '清单登记文件在磁盘缺失' });
        } else {
          targetPaths.push(rel);
        }
      }
    } catch (e) {
      unpack.push({ type: 'UNPACK_CORRUPT_MANIFEST', file: MANIFEST_REL_PATH, message: e.message });
    }
  } else if (requireManifestOnDisk) {
    unpack.push({ type: 'UNPACK_NO_MANIFEST', file: MANIFEST_REL_PATH, message: '缺失 FRAMEWORK-MANIFEST.json' });
  } else {
    const live = buildCoreManifest(root);
    targetPaths = live.files.map((f) => f.path);
  }

  for (const extraRel of [
    '.cursor/hooks.json',
    '.cursor/cli.json',
    'cc-base-contract.json',
    'setup.ps1',
    'setup.sh',
    'setup-cursor.sh',
    'package.json',
    'README.md',
    'ARCHITECTURE.md',
  ]) {
    if (fs.existsSync(path.join(root, extraRel))) targetPaths.push(extraRel);
  }
  for (const extraDir of ['scripts', '.github']) {
    const fullDir = path.join(root, extraDir);
    if (fs.existsSync(fullDir)) {
      for (const rel of walkRegularFiles(fullDir, root)) targetPaths.push(rel);
    }
  }

  const uniquePaths = [...new Set(targetPaths)].sort();
  const hits = [];
  for (const rel of uniquePaths) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;
    hits.push(...scanTextForLeaks(rel, buf.toString('utf8')));
  }

  const code = unpack.length > 0 || hits.length > 0 ? 1 : 0;
  return {
    status: code === 0 ? 'ok' : 'violation',
    code,
    summary: `manifest leak: scanned ${uniquePaths.length} files, unpackMissing=${unpack.length}, leakHits=${hits.length}`,
    scanned: uniquePaths.length,
    unpack,
    hits,
  };
}

function runSelftest() {
  const lf = hashLfBuffer('line1\nline2\n');
  const crlf = hashLfBuffer('line1\r\nline2\r\n');
  if (lf.sha256 !== crlf.sha256 || lf.bytes !== crlf.bytes) {
    throw new Error('LF and CRLF buffers must yield identical sha256 and bytes');
  }

  if (isCoreManifestFile('FRAMEWORK-MANIFEST.json')) throw new Error('manifest must exclude itself');
  if (isCoreManifestFile('hooks.json')) throw new Error('hooks.json must be excluded from core manifest');
  if (isCoreManifestFile('cli.json')) throw new Error('cli.json must be excluded from core manifest');
  if (isCoreManifestFile('skills')) throw new Error('skills OS link must be excluded');
  if (isCoreManifestFile('skills/dev-builder/SKILL.md')) throw new Error('skills/* must be excluded');
  if (isCoreManifestFile('agents/implementer.md')) throw new Error('agents/* generated outputs must be excluded');
  if (isCoreManifestFile('rules/cc-base-claude.mdc')) throw new Error('generated cc-base-claude.mdc must be excluded');
  if (isCoreManifestFile('.runtime/cursor-gen.sha256')) throw new Error('.runtime/* must be excluded');
  if (isCoreManifestFile('harness-state/foo.json')) throw new Error('harness-state/* must be excluded');
  if (isCoreManifestFile('tests/run-all.mjs')) throw new Error('tests/* must be excluded');
  if (isCoreManifestFile('scripts/foo.mjs.bak-123')) throw new Error('*.bak-* must be excluded');
  if (isCoreManifestFile('rules/cc-base-cursor-host.mdc.cursor-new')) throw new Error('*.cursor-new must be excluded');
  if (!isCoreManifestFile('rules/cc-base-cursor-host.mdc')) throw new Error('rules/cc-base-cursor-host.mdc must be included');
  if (!isCoreManifestFile('scripts/hook-adapter.mjs')) throw new Error('scripts/hook-adapter.mjs must be included');

  const cleanHits = scanTextForLeaks(
    '.cursor/rules/cc-base-cursor-host.mdc',
    [
      'Fetch from https://api.github.com/repos and wss://stream.example.com/socket.',
      'Example path: /home/user/project and C:\\Users\\Administrator\\app and /Users/<user>/code.',
      'Supported protocols: postgres://, mysql://, redis://.',
      'Ignored line: /home/real_dev_99/secret # cursor-leak:ignore',
    ].join('\n'),
  );
  if (cleanHits.length !== 0) {
    throw new Error(`expected 0 false-positive hits on clean text, got ${JSON.stringify(cleanHits)}`);
  }

  const dirtyText = [
    'const p1 = "/home/' + 'dev_john88/work";', // cursor-leak:ignore
    'const p2 = "C:\\\\Users\\\\' + 'real_alice99\\\\repo";', // cursor-leak:ignore
    'const db = "postgres://' + 'admin:S3cr3tP4ss@db.prod.acme.io:5432/orders";', // cursor-leak:ignore
    'const host = "gitlab.eng.' + 'megacorp.internal";', // cursor-leak:ignore
    '-----BEGIN RSA ' + 'PRIVATE KEY-----', // cursor-leak:ignore
  ].join('\n');
  const dirtyHits = scanTextForLeaks('.cursor/scripts/bad.mjs', dirtyText);
  if (dirtyHits.length !== 5) {
    throw new Error(`expected 5 leak hits on dirty text, got ${dirtyHits.length}: ${JSON.stringify(dirtyHits)}`);
  }

  process.stdout.write(JSON.stringify({ ok: true, tests: 4 }) + '\n');
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    runSelftest();
    process.exit(0);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (argv.includes('--print')) {
    process.stdout.write(JSON.stringify(buildCoreManifest(root), null, 2) + '\n');
    process.exit(0);
  }
  let res;
  if (argv.includes('--write')) {
    res = writeManifest(root);
  } else if (argv.includes('--leak')) {
    res = leakScanManifest(root);
  } else if (argv.includes('--check') || argv.length === 0) {
    res = checkManifest(root);
  } else {
    process.stderr.write('usage: node scripts/lib/manifest.mjs (--write | --check | --leak | --print | --selftest)\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(res) + '\n');
  process.exit(res.code);
}
