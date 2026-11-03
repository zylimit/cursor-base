// lib/core.mjs -- the bottom layer of the harness runtime: it imports nothing but node
// builtins, and every other module may import it. That one-way rule is what keeps the
// module graph acyclic now that the sections live in separate files.
//
// Carries S1 common / S2 git / S3 glob / S9 config, plus the vocabulary that more than one
// section needs and therefore cannot stay inside any single one of them:
//   - the JSDoc typedefs (Catalog / Module / Receipt / CheckResult / Waiver)
//   - ATTRIBUTES / TIERS / TIER_ENFORCEMENT / TIER_RANK / normalizeTier: declared for S11,
//     but read by S4 catalog-lint and S13 fitness too; leaving them in S11 would make
//     catalog.mjs and quality.mjs import each other
//   - parseCsv (from S4), DENY / isDenied (S6), SOURCE_EXTS (S12), whichCmd (S8): each
//     written for one section and consumed by another that now lives in a different file
// Source is ASCII-only, same as the rest of the runtime.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Directory of the harness root (.claude/harness), used to resolve checked-in fixtures and
// the shipped adapters table. ESM has no __dirname, and this file sits one level down in
// lib/, so the path goes up twice -- deriving it from process.cwd() instead would break
// every caller that runs the harness against another tree (the golden matrix does exactly
// that on every scenario).
const HARNESS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// JSDoc typedefs (centralized; only fields relevant to current + near Tasks).
// ---------------------------------------------------------------------------
/**
 * @typedef {Object} Module
 * @property {string} id                     unique module id
 * @property {string[]} paths                glob patterns owned by this module
 * @property {string[]} [dependsOn]          module ids this one depends on
 * @property {string[]} [owners]             owner handles
 * @property {('low'|'medium'|'high')} [riskTier]
 * @property {Object<string,(string|{tier:string,reason?:string})>} [attributes]
 *           quality attributes this module must hold evidence for (S11)
 * @property {string[]} [forbiddenDependencies]  module ids this one must never import (S12)
 * @property {string} [layer]                architectural layer name from catalog.layers
 * @property {string[]} [provides]           import-specifier prefixes resolving to this module
 */
/**
 * @typedef {Object} Catalog
 * @property {number} version
 * @property {Module[]} modules
 * @property {string[]} [global]             paths that force full-fanout on change
 * @property {string[]} [ignored]            paths excluded from impact
 * @property {Object<string,string[]>} [riskChecks]
 * @property {Object<string,Object>} [checks]  check may declare attributes:[] it evidences
 * @property {ContextPackBudget} [contextPack]
 * @property {string[]} [layers]             layer names outermost-first; deps may only point inward (later entries)
 * @property {number} [maxTrackedPaths]      tracked-listing cap before truncated degradation
 */
/**
 * @typedef {Object} ContextPackBudget
 * @property {number} maxTotalChars
 * @property {number} maxFiles
 * @property {number} maxFileChars
 * @property {number} maxDiffChars
 */
/**
 * @typedef {Object} Receipt
 * @property {string} taskId
 * @property {string} baseCommit
 * @property {string} diffHash
 * @property {string} reviewer
 * @property {string} verdict
 * @property {Object} scope
 * @property {string} timestamp
 * @property {string} contentHash
 */
/**
 * @typedef {Object} CheckResult
 * @property {string} id
 * @property {string} [class]
 * @property {('PASS'|'FAIL'|'BLOCKED'|'SKIPPED')} state
 * @property {number} [exit]
 * @property {string} [reason]   may carry waiver:<scope> prefix when SKIPPED via S10
 * @property {string} [cmd]
 */
/**
 * @typedef {Object} Waiver
 * @property {number} version
 * @property {string} owner
 * @property {string} reason
 * @property {string} scope          check id this waiver covers
 * @property {string} expiry         ISO timestamp
 * @property {string} compensation
 * @property {string} created_at     ISO timestamp
 * @property {string} [contentHash]
 */
// ===========================================================================
// S1 common
// ===========================================================================
/** Read process.stdin fully to a string; returns '' when there is no input. */
function readStdin() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch (_e) {
    return '';
  }
}

/**
 * The one exit every path leaves this engine through. stdout JSON is a machine contract --
 * hooks, git hooks, CI and downstream tools all read it -- so a path that reads
 * `.claude/CLAUDE.md` on one platform and `.claude\CLAUDE.md` on another makes every one of
 * those consumers carry the difference, and the ones that do not carry it break on Windows
 * only, where nobody is looking. Normalizing where the path is produced costs one call;
 * leaving it to the consumers costs one bug per consumer.
 * Unconditional, not keyed off path.sep: a Windows-shaped path can reach a POSIX run through
 * a checked-in fixture or a recorded baseline, and a normalizer that only works on the
 * platform that has the problem cannot be tested on the platform that does not.
 */
function toPosixPath(p) {
  return String(p).replace(/\\/g, '/');
}

/** Deterministic JSON: recursive key sort. Null/non-object -> JSON.stringify; arrays recurse. */
function stableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}

/** @param {string|Buffer} data */
function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** Write single-line JSON to stdout, then exit. */
function emit(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(code);
}

/** Write a human diagnostic to stderr, then exit. */
function die(msg, code = 1) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code);
}

/**
 * Sleep without burning a core. Atomics.wait on a private buffer is the only synchronous
 * sleep node has without a dependency, and a Date.now() spin would be measurably worse with
 * a dozen processes queued behind the same lock.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, Number(ms) || 0));
}

/**
 * Run fn while holding an exclusive lock. The lock is a directory, because mkdir is the one
 * filesystem call that creates and tests in a single atomic step; O_APPEND is deliberately
 * not used in its place, since the atomicity that offers stops at PIPE_BUF (4096 bytes on
 * Linux) and the records this guards are routinely larger than that.
 * A lock older than staleMs is reclaimed -- a process killed mid-write must not brick the
 * file for everyone after it -- and waiting past timeoutMs throws instead of blocking
 * forever, so the caller degrades loudly rather than hanging.
 * @param {string} lockPath   directory to create; its parent must already exist
 * @param {Function} fn       runs with the lock held
 * @param {{timeoutMs?:number,staleMs?:number,pollMs?:number}} [opts]
 */
function withDirLock(lockPath, fn, { timeoutMs = 10000, staleMs = 60000, pollMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      let ageMs = 0;
      try { ageMs = Date.now() - fs.statSync(lockPath).mtimeMs; } catch (_e) { continue; }
      if (ageMs > staleMs) {
        // Another waiter may win the reclaim; losing it just means going round again.
        try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch (_e) { /* retry */ }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error('could not acquire lock ' + lockPath + ' within ' + timeoutMs
          + 'ms (current holder is ' + ageMs + 'ms old)');
      }
      sleepSync(pollMs);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
  }
}

// ===========================================================================
// S2 git  (all git calls: spawnSync + maxBuffer 1<<28; diff stdout stays Buffer)
// ===========================================================================
function git(args) {
  return spawnSync('git', args, { maxBuffer: 1 << 28 });
}

function isGitRepo() {
  return git(['rev-parse', '--is-inside-work-tree']).status === 0;
}

/** @returns {string|null} */
function headCommit() {
  if (!isGitRepo()) return null;
  const r = git(['rev-parse', 'HEAD']);
  if (r.status !== 0) return null;
  return r.stdout.toString('utf8').trim();
}

// State files that must not perturb the diff fingerprint (runtime state, not code).
// The three lists below, the DENY entry further down and .claude/.gitignore are exclusions of
// the same set, and they are written per DIRECTORY rather than per file on purpose: everything
// the runtime writes lands under one of these prefixes, so a new kind of state -- the review
// session and the authorship ledger under harness/state/, for instance -- is covered by all
// four the moment it is put there. A per-file rule would have to be added in four places, and
// missing one of them is a fresh source of false green.
// Every directory .claude/.gitignore lists as runtime belongs here, .runtime/ (supervisor pid,
// state and service logs) included; being gitignored is not on its own enough, because a path
// that was once tracked, or force-added, still reaches changedPaths(). The single-file markers
// .gitignore also carries (signals.jsonl, .subagent-reminded, .stop-gate-strikes,
// .precompact-block-epoch, .async-verify-last, settings.local.json) are deliberately NOT here:
// this list is what the fingerprint ignores, and quietly ignoring more files than necessary is
// how a real change stops being noticed.
// .claude/worktrees/ is the one entry that is not runtime state: Claude Code isolates a sub-agent
// by checking out a whole copy of the repo there, so those paths are another repo's files that
// happen to sit under this one -- not this repo's, and never this repo's diff.
const STATE_EXCLUDE = [
  ':(exclude).claude/.needs-review',
  ':(exclude).claude/.needs-review.lock',
  ':(exclude).claude/.fast-mode',
  ':(exclude).claude/.tdd-exempt',
  ':(exclude).claude/.red-verified',
  ':(exclude).claude/.runtime/**',
  ':(exclude).claude/evidence/**',
  ':(exclude).claude/harness/receipts/**',
  ':(exclude).claude/harness/waivers/**',
  ':(exclude).claude/harness/trend/**',
  ':(exclude).claude/harness/state/**',
  ':(exclude).claude/harness/evidence/**',
  ':(exclude).claude/worktrees/**',
];
const STATE_EXCLUDE_PATHS = [
  '.claude/.needs-review',
  '.claude/.needs-review.lock',
  '.claude/.fast-mode',
  '.claude/.tdd-exempt',
  '.claude/.red-verified',
];
const STATE_EXCLUDE_PREFIXES = [
  '.claude/.runtime/',
  '.claude/evidence/',
  '.claude/harness/receipts/',
  '.claude/harness/waivers/',
  '.claude/harness/trend/',
  '.claude/harness/state/',
  '.claude/harness/evidence/',
  '.claude/worktrees/',
];
function isStateExcluded(p) {
  const n = toPosixPath(p);
  if (STATE_EXCLUDE_PATHS.includes(n)) return true;
  return STATE_EXCLUDE_PREFIXES.some(pre => n.startsWith(pre));
}

/** Split NUL-separated git output into a clean path list (non-ASCII names survive). */
function splitNul(buf) {
  return buf.toString('utf8').split('\0').map(s => s.trim()).filter(Boolean);
}

/**
 * Changed paths vs HEAD (tracked diff + untracked), deduped. Listings are NUL-separated
 * (-z) with quotePath off: the default quoting turns a CJK filename into an octal string
 * no catalog glob can ever match, which silently reclassifies it as unmapped.
 * @returns {string[]|{paths:string[],nonGit:true}}
 */
function changedPaths() {
  if (!isGitRepo()) return { paths: [], nonGit: true };
  const tracked = splitNul(git(['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', 'HEAD']).stdout);
  const untracked = splitNul(git(['-c', 'core.quotePath=false', 'ls-files', '-z', '--others', '--exclude-standard']).stdout);
  const seen = new Set();
  const out = [];
  for (const p of tracked.concat(untracked)) {
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

/** Untracked files as a stable Buffer of "U <path> <contentHash>\n" lines (sorted, state files excluded). */
function hashUntracked() {
  const list = splitNul(git(['-c', 'core.quotePath=false', 'ls-files', '-z', '--others', '--exclude-standard']).stdout)
    .filter(p => !isStateExcluded(p))
    .sort();
  const parts = [];
  for (const p of list) {
    let content;
    try { content = fs.readFileSync(p); } catch (_e) { continue; }
    parts.push(Buffer.from('U ' + p + ' ' + sha256(content) + '\n', 'utf8'));
  }
  return Buffer.concat(parts);
}

/**
 * Canonical git diff as a Buffer (never stringified -- guards against encoding/truncation
 * corruption of binary diffs). Non-git -> Buffer.from('NON_GIT').
 * @returns {{buf:Buffer,nonGit:boolean}}
 */
function canonicalDiff() {
  if (!isGitRepo()) return { buf: Buffer.from('NON_GIT'), nonGit: true };
  const tracked = git(['diff', '--binary', '--no-ext-diff', 'HEAD', '--', ...STATE_EXCLUDE]).stdout || Buffer.alloc(0);
  const untracked = hashUntracked();
  return { buf: Buffer.concat([tracked, untracked]), nonGit: false };
}

/** sha256 of the canonical diff buffer. */
function gitFingerprint() {
  return sha256(canonicalDiff().buf);
}

// ===========================================================================
// S3 glob  (zero-dep; supports ** * ? and literal /; no {a,b}/[..])
// ===========================================================================
// Compiled globs are cached: classifying N tracked paths against M module globs is the
// hot loop of catalog-lint/impact on a 600k-LOC repository, and recompiling the same
// RegExp N*M times dominated the runtime before this cache existed.
const GLOB_CACHE = new Map();

/** glob -> anchored RegExp (cached). Supports ** * ? and literal /; no {a,b}/[..]. */
function globToRegExp(glob) {
  const hit = GLOB_CACHE.get(glob);
  if (hit) return hit;
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {                              // **
        i++;                                                  // consume second *
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; }   // **/ -> zero-or-more path segments (prefix may be empty)
        else re += '.*';                                      // trailing ** (or **x) -> anything, crosses /
      } else re += '[^/]*';                                   // * -> within a segment, no /
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const compiled = new RegExp(re + '$');
  GLOB_CACHE.set(glob, compiled);
  return compiled;
}

/** True if `p` matches any glob in `globs`. */
function matchAny(p, globs) {
  return (globs || []).some(g => globToRegExp(g).test(p));
}

/** Literal-char count after stripping wildcards; most specific glob wins on multi-match. */
function specificity(glob) {
  return glob.replace(/[*?]/g, '').length;
}

// ===========================================================================
// S9 config
// ===========================================================================
const DEFAULTS = {
  contextPack: { maxTotalChars: 120000, maxFiles: 40, maxFileChars: 6000, maxDiffChars: 40000 },
  maxTrackedPaths: 100000,
};

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
function catalogFilePath() {
  return path.join(projectRoot(), '.claude', 'harness', 'module-catalog.json');
}

/**
 * Resolve an absolute path through symlinks without requiring that it exist. realpathSync on a
 * missing path throws ENOENT, and a missing path is the normal case here -- `catalog-lint
 * --catalog nope.json` probes a file whose absence is the whole answer -- so the longest
 * existing prefix is resolved and the missing tail is joined back onto it. That resolves the
 * part of the path the filesystem can speak for and leaves the rest spelled as it arrived.
 * A path with no resolvable ancestor at all falls back to the plain resolve, so this call can
 * only ever narrow the answer: it never throws and never returns nothing.
 * realpathSync rather than realpathSync.native, and the same function on both sides of every
 * comparison: on Windows the native variant expands 8.3 short names and normalizes case, so
 * resolving one side with one variant and the other side with the other invents a mismatch
 * between two spellings of the same directory.
 */
function resolveThroughLinks(p) {
  const abs = path.resolve(String(p));
  let cur = abs;
  const tail = [];
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      return tail.length ? path.join(real, ...tail) : real;
    } catch (_e) {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;      // walked out to the volume root and nothing resolved
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * True when path.relative()'s answer does not actually stay under the base it was measured
 * from -- it has to climb out (`..`), or, across Windows drives, there is no relative route at
 * all and relative() hands back an absolute path instead. Named once because repoRelative asks
 * this of two different bases and the two tests must not drift apart.
 */
function escapesBase(rel) {
  if (rel === '..' || rel.startsWith('..' + path.sep) || rel.startsWith('../')) return true;
  return path.isAbsolute(rel);
}

/**
 * Name a path the way stdout names paths: repo-relative when it is inside the project root,
 * verbatim when it is not. A bare path.relative() produces a third thing for the outside
 * case and that third thing is useless -- `catalog-lint --catalog /etc/nope/x.json` answered
 * `../../etc/nope/x.json`, which is neither the file the caller named nor a path that exists
 * in this repo, and it leaks how deep the checkout sits on top. The test is path.relative()'s
 * own answer: a route that has to climb out of the root, or (on Windows, across drives) no
 * route at all, means that base yields no repo-relative name -- which base gets asked, and in
 * what order, is the two-question rule below.
 * Relative input is resolved against the cwd first and then judged like anything else, because
 * the cwd is where fs opened it: `--catalog nope.json` run from .claude/ reads .claude/nope.json,
 * and echoing the bare `nope.json` hands every reader of this output a repo-relative name for
 * <root>/nope.json -- a different file than the one the command probed. Absolute input is never
 * rewritten, so a path outside the root still comes back exactly as the caller spelled it.
 * Spelling first, identity only as a fallback. The question gets asked twice and the first
 * answer wins: path.relative() on the two spellings as they arrived, with no link followed on
 * either side, so a link the caller chose to go through keeps the name they used. `<root>/linkout/nope.json` is
 * named `linkout/nope.json` whether or not linkout leads back out of the tree, and a link that
 * stays inside is not unfolded into the name of whatever sits behind it -- answering with a
 * path the caller never probed is the same failure as answering with an absolute one, since
 * either way the reader cannot get back to the file that was opened.
 * Only when the spelling already points out of the root does the pair get resolved through
 * symlinks and the question asked again, and that second question exists for one shape: a
 * checkout reached through a linked parent, where the argument and projectRoot() name the same
 * directory two different ways -- process.cwd() is already physical, CLAUDE_PROJECT_DIR is
 * whatever the caller exported -- so comparing the raw spellings reads a file that sits in this
 * repo as being outside it. Resolving one of the two sides fixes one direction of that and
 * leaves the mirror case leaking, which is why the fallback normalizes the pair rather than the
 * input. A path that is outside under both questions is echoed as the caller spelled it and
 * never in its resolved form, which would unfold those same links and print the real directory
 * behind them.
 */
function repoRelative(p) {
  const raw = String(p);
  const abs = path.isAbsolute(raw) ? raw : path.resolve(raw);
  const relSpelling = path.relative(path.resolve(projectRoot()), abs);
  if (relSpelling === '') return '.';
  if (!escapesBase(relSpelling)) return toPosixPath(relSpelling);
  const relIdentity = path.relative(resolveThroughLinks(projectRoot()), resolveThroughLinks(abs));
  if (relIdentity === '') return '.';
  if (!escapesBase(relIdentity)) return toPosixPath(relIdentity);
  return toPosixPath(abs);
}

/**
 * Load harness config. Catalog present -> shallow-merge its contextPack over DEFAULTS.
 * Not present -> DEFAULTS + {catalogPresent:false}. This Task only checks existence,
 * not schema validity (T1.2 catalog-lint owns schema validation).
 */
function loadHarnessConfig() {
  const cp = catalogFilePath();
  const present = fs.existsSync(cp);
  if (!present) {
    return { contextPack: { ...DEFAULTS.contextPack }, catalogPresent: false };
  }
  let contextPack = { ...DEFAULTS.contextPack };
  try {
    const raw = JSON.parse(fs.readFileSync(cp, 'utf8'));
    if (raw && typeof raw.contextPack === 'object' && raw.contextPack) {
      contextPack = { ...DEFAULTS.contextPack, ...raw.contextPack };
    }
  } catch (_e) {
    // Catalog present but unreadable/invalid; keep defaults, T1.2 catalog-lint will report.
  }
  return { contextPack, catalogPresent: true };
}

// ---------------------------------------------------------------------------
// reading state  (ENOENT is the only error that means "there is nothing here")
// ---------------------------------------------------------------------------
/**
 * Read a file as text, keeping "nobody ever wrote one" apart from "this one cannot be read".
 * ENOENT is the only absence. Every other errno -- a mode bit that denies the read, a
 * directory standing where a file belongs, a name that is not the kind of thing the reader
 * expected -- leaves the artefact on disk with its contents unknown, which is the situation
 * a damaged file is in and not the situation an unwritten one is in. The two get opposite
 * next moves, and one catch answering both is what makes "start a fresh record" the reply
 * to a record somebody needs to go and read.
 * @returns {{text:(string|null),absent:boolean,error:(Error|null)}}
 */
function readTextFile(file) {
  try { return { text: fs.readFileSync(file, 'utf8'), absent: false, error: null }; } catch (e) {
    if (e && e.code === 'ENOENT') return { text: null, absent: true, error: null };
    return { text: null, absent: false, error: e };
  }
}

/**
 * List a directory, the same distinction one level out. A directory nobody can list is
 * every file inside it unreadable at once, and an empty listing answers "there is nothing
 * in here" about a place nobody was able to look into.
 * @returns {{names:(string[]|null),absent:boolean,error:(Error|null)}}
 */
function readDirNames(dir) {
  try { return { names: fs.readdirSync(dir), absent: false, error: null }; } catch (e) {
    if (e && e.code === 'ENOENT') return { names: null, absent: true, error: null };
    return { names: null, absent: false, error: e };
  }
}

/**
 * The message of a failed read or write, with this checkout's own path folded back to the
 * repo-relative one. Node puts the path it was handed into every errno message, and these
 * details go on stdout and into the quarantine ledger, both of which get pasted into reports
 * read on other machines -- the same reason nothing else here prints anything but
 * repoRelative(). Best effort by construction: a message that does not contain the root
 * comes back unchanged, which is no worse than not looking.
 */
function errDetail(e) {
  const msg = String((e && e.message) || e);
  const root = projectRoot();
  if (!root) return msg;
  return msg.split(root + path.sep).join('').split(root).join('.');
}

// ---------------------------------------------------------------------------
// quarantine  (a damaged artefact is recorded, never moved and never repaired)
// ---------------------------------------------------------------------------
/** Where corruption detections are appended; state-dir state, git-ignored like its siblings. */
function quarantineFilePath() {
  return path.join(projectRoot(), '.claude', 'harness', 'state', 'quarantine.jsonl');
}

/**
 * Note that an artefact was found damaged: one JSON line, append-only, and nothing else.
 * The file itself is not moved, renamed or rewritten -- relocating evidence is a decision for
 * a person, and a checker that tidies up destroys the only copy of what went wrong.
 * What the line buys is counting. A command that noticed a damaged file and then exited is
 * the only record that it ever noticed: the next run starts from the same nothing, and one
 * bad file and forty read exactly alike. `risk` reads the pile back.
 * Never throws and never changes the caller's answer: this runs beside a path that is
 * already reporting a failure, and a write error here must not replace the report.
 * @param {{kind:string,path:string,reason:string}} entry
 */
function recordCorruptState({ kind, path: file, reason }) {
  const rel = repoRelative(file);
  const fp = quarantineFilePath();
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.appendFileSync(fp, JSON.stringify({
      ts: new Date().toISOString(),
      kind: String(kind),
      path: rel,
      reason: String(reason).slice(0, 500),
    }) + '\n', 'utf8');
  } catch (e) {
    process.stderr.write('could not record the damaged state of ' + rel + ': '
      + String((e && e.message) || e) + '\n');
  }
}

// ===========================================================================
// S* shared vocabulary  (defined once here because two or more sections read it)
// ===========================================================================
/** Parse a comma-separated flag value into a trimmed, non-empty string list. */
function parseCsv(v) {
  if (typeof v !== 'string') return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

const ATTRIBUTES = ['security', 'resilience', 'privacy', 'safety', 'reliability', 'availability', 'performance', 'maintainability'];

// Six strengths: uniform strictness is its own defect -- applied everywhere it makes a
// throwaway prototype as expensive as a payments service, and the usual response is to
// disable checks wholesale rather than tune them.
const TIERS = ['critical', 'high', 'medium', 'low', 'minimal', 'none'];
const TIER_ENFORCEMENT = {
  critical: 'block',      // absence of evidence blocks; cannot be waived
  high: 'block',          // absence of evidence blocks; an attribute waiver may defer it
  medium: 'warn',
  low: 'record',
  minimal: 'listed',      // requires a written reason
  none: 'opted-out',      // requires a written reason
};
const TIER_RANK = { critical: 5, high: 4, medium: 3, low: 2, minimal: 1, none: 0 };

/** Accepts "high" or {tier:"high",reason:"..."}; returns {tier,reason}. */
function normalizeTier(req) {
  if (typeof req === 'string') return { tier: req, reason: '' };
  if (req && typeof req === 'object') return { tier: String(req.tier || ''), reason: String(req.reason || '') };
  return { tier: '', reason: '' };
}

// DENY: paths that must never enter a pack, evaluated before any priority tier.
// Covers VCS/build dirs, harness runtime state, and secret material. A narrow
// whitelist (.env.example|sample|template) is checked first so shareable templates
// stay includable.
// This is the second layer, not the first. Changed files are already dropped by
// isStateExcluded before context-pack ever offers them as candidates, so the runtime-state
// rows below exist for the paths that never pass through that filter: catalog-authored
// strings such as modules[].verification, which arrive from a JSON file the author typed
// rather than from a git listing. Both layers are kept because the overlap costs one regex
// test, while a single choke point is something every future non-git path source can walk
// around without anyone noticing it did.
const DENY = [
  /(^|\/)\.git\//, /(^|\/)node_modules\//, /(^|\/)(dist|build|out|\.next|\.venv)\//,
  /(^|\/)\.claude\/(\.runtime|evidence|worktrees|harness\/receipts|harness\/waivers|harness\/trend|harness\/state|harness\/evidence)\//,
  /(^|\/)\.env(\.|$)/,
  /\.(pem|key|p12|pfx)$/, /(^|\/)id_rsa/, /(^|\/)\.(ssh|aws|azure|gnupg|kube)\//,
];

/** True if a path must never be packed. Path is forward-slashed before matching. */
function isDenied(p) {
  const n = toPosixPath(p);
  if (/(^|\/)\.env\.(example|sample|template)$/.test(n)) return false;   // whitelist first
  return DENY.some(r => r.test(n));
}

const SOURCE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '.py', '.go', '.java', '.kt', '.kts', '.cs', '.rs', '.rb', '.php', '.swift', '.scala',
]);

/**
 * Resolve whether an executable is reachable, without running it. Zero-dep, cross-platform:
 * scans PATH entries; on win32 appends PATHEXT suffixes. A path-qualified exe is tested directly.
 * @param {string} exe
 * @returns {boolean}
 */
function whichCmd(exe) {
  if (!exe) return false;
  if (exe.includes('/') || exe.includes('\\')) return fs.existsSync(exe);
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(s => s.trim()).filter(Boolean)
    : [''];
  for (const d of dirs) {
    if (process.platform === 'win32' && fs.existsSync(path.join(d, exe))) return true;
    for (const ext of exts) {
      if (fs.existsSync(path.join(d, exe + ext))) return true;
    }
  }
  return false;
}

export {
  HARNESS_DIR,
  readStdin, toPosixPath, stableJson, sha256, emit, die, sleepSync, withDirLock,
  git, isGitRepo, headCommit, isStateExcluded, splitNul, changedPaths, canonicalDiff, gitFingerprint,
  globToRegExp, matchAny, specificity,
  DEFAULTS, projectRoot, catalogFilePath, repoRelative, loadHarnessConfig,
  readTextFile, readDirNames, errDetail, quarantineFilePath, recordCorruptState,
  parseCsv,
  ATTRIBUTES, TIERS, TIER_ENFORCEMENT, TIER_RANK, normalizeTier,
  isDenied, SOURCE_EXTS, whichCmd,
};
