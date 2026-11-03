// ext/quality.mjs -- the verification half of the runtime: S7 diff-bound review receipts,
// S8 the four-state quality gate, S10 structured waivers and S11 quality-attribute
// coverage. They ship together because verifyPlan() runs checks, applies waivers and
// assesses attributes in one pass. Depends on core.mjs + catalog.mjs + graph.mjs.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  HARNESS_DIR, TIER_ENFORCEMENT,
  changedPaths, emit, gitFingerprint, headCommit, isGitRepo, isStateExcluded, normalizeTier,
  errDetail, parseCsv, projectRoot, readDirNames, readStdin, readTextFile, recordCorruptState,
  repoRelative,
  sha256, stableJson, whichCmd,
} from '../lib/core.mjs';
import { loadCatalogFlag } from './catalog.mjs';
import { analyzeImpact } from './graph.mjs';
import { tierState } from '../lib/tier.mjs';

// ===========================================================================
// S7 receipt  (diff-bound review receipts; stale/tamper -> exit 4)
// ===========================================================================
// Receipts live under .claude/harness/receipts/<taskId>.json (git-ignored runtime state).
// The receipt binds a review verdict to the exact working-tree diff it reviewed via
// diffHash = gitFingerprint(). If code moves past that diff, the receipt goes stale.

/** Where receipts are stored (project-relative, git-ignored). */
function receiptsDir() {
  return path.join(projectRoot(), '.claude', 'harness', 'receipts');
}

/** Sanitize a taskId into a safe single filename segment (guards path traversal). */
function safeTaskId(id) {
  const s = String(id == null ? '' : id).replace(/[^A-Za-z0-9._-]/g, '_');
  return (s === '' || s === '.' || s === '..') ? '' : s;
}

/**
 * Tamper-evident content hash: stable JSON of the receipt with contentHash blanked out,
 * then sha256. Recompute on verify; any field mutation changes the hash. Pure + injectable
 * so selftest exercises round-trip / tamper detection without touching fs.
 * @param {Object} r
 * @returns {string}
 */
function contentHash(r) {
  return sha256(stableJson({ ...r, contentHash: undefined }));
}

/**
 * harness.mjs plus every *.mjs under lib/ and ext/, named relative to HARNESS_DIR, sorted.
 * Both directories, because both are the engine: the split into core (lib/) and the optional
 * large-repo package (ext/) is a packaging decision, and hashing only lib/ would leave a
 * receipt valid across a rewrite of the very section that produced its verdict.
 */
function engineFiles() {
  const names = [];
  for (const dir of ['lib', 'ext']) {
    try {
      for (const f of fs.readdirSync(path.join(HARNESS_DIR, dir))) {
        if (f.endsWith('.mjs')) names.push(dir + '/' + f);
      }
    } catch (_e) { /* a missing half is not an engine that cannot name itself */ }
  }
  return ['harness.mjs'].concat(names).sort();
}

/**
 * Digest of the engine that is running right now: each engine file's sha256, concatenated in
 * name order and hashed again. The directory comes from this module's own URL (HARNESS_DIR),
 * never from the project root, so an engine run against somebody else's tree hashes itself
 * rather than whatever engine that tree happens to ship.
 *
 * It is a fact about content, not about location. The same bytes in two directories are the
 * same engine; one comment line added to one lib file is a different one. That is the
 * property a receipt needs, because "this verdict was produced by an engine that no longer
 * exists here" is exactly the case where the verdict has stopped meaning what it said -- the
 * rules that produced it are not the rules in force.
 *
 * A read error is not swallowed. An engine that cannot read its own source cannot say which
 * engine it is, and answering anything there would be an invention; the caller turns the
 * throw into a visible refusal (receipt write exits 3).
 * @returns {string}
 */
function engineHash() {
  const digests = engineFiles().map(rel => sha256(fs.readFileSync(path.join(HARNESS_DIR, ...rel.split('/')))));
  return sha256(digests.join(''));
}

/** True if the working tree carries code changes vs HEAD (state files excluded). */
function hasCodeChange() {
  const cp = changedPaths();
  const list = Array.isArray(cp) ? cp : cp.paths;
  return list.some(p => !isStateExcluded(p));
}

/**
 * Build + persist a receipt bound to the current working-tree diff. taskId is required.
 * baseCommit/diffHash are captured live; timestamp is injectable for deterministic tests.
 * @param {Object} input   { taskId, reviewer?, verdict?, scope? }
 * @param {{timestamp?:string}} [opts]
 * @returns {Receipt}
 */
function writeReceipt(input, { timestamp } = {}) {
  const input0 = input && typeof input === 'object' ? input : {};
  const taskId = safeTaskId(input0.taskId);
  if (!taskId) throw new Error('writeReceipt: taskId required (allowed chars: A-Za-z0-9._-)');
  const receipt = {
    taskId,
    baseCommit: headCommit(),
    diffHash: gitFingerprint(),
    engineHash: engineHash(),
    reviewer: typeof input0.reviewer === 'string' ? input0.reviewer : 'unknown',
    verdict: typeof input0.verdict === 'string' ? input0.verdict : 'pass',
    scope: input0.scope === undefined ? null : input0.scope,
    timestamp: timestamp || new Date().toISOString(),
  };
  receipt.contentHash = contentHash(receipt);
  const dir = receiptsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, taskId + '.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  return receipt;
}

/** True if a receipt object's stored contentHash matches a fresh recompute (untampered). */
function receiptIntact(r) {
  return !!r && typeof r === 'object' && typeof r.contentHash === 'string'
    && contentHash(r) === r.contentHash;
}

/**
 * Pure matcher (fs-free, injectable): does any intact receipt bind to diffHash D, and to the
 * engine asking? `engine` is optional -- called without it the engine binding is not
 * consulted at all, which keeps the unit tests about diff binding about diff binding. A
 * receipt carrying no engineHash predates that binding and still matches.
 * @param {Receipt[]} receipts
 * @param {string} D  current gitFingerprint()
 * @param {string|null} [engine]  current engineHash()
 * @returns {{matched:string|null,hadReceipts:boolean}}
 */
function matchReceipts(receipts, D, engine = null) {
  const list = Array.isArray(receipts) ? receipts : [];
  for (const r of list) {
    if (!receiptIntact(r) || r.diffHash !== D) continue;
    if (engine && typeof r.engineHash === 'string' && r.engineHash !== engine) continue;
    return { matched: r.taskId || true, hadReceipts: true };
  }
  return { matched: null, hadReceipts: list.length > 0 };
}

/**
 * Every receipt JSON in the receipts dir, and the ones that could not be read. A receipt
 * nobody can read is not a receipt that is not there: it may be the tampered one, so it is
 * named rather than skipped and the caller decides what it is worth. No receipts dir at all
 * is a genuine absence and answers empty; a receipts dir that will not list is every receipt
 * inside it unreadable at once, and is named as the directory it is.
 * @returns {{receipts:Receipt[],unreadable:string[]}}
 */
function loadReceipts() {
  const dir = receiptsDir();
  const listing = readDirNames(dir);
  if (listing.error) {
    const detail = errDetail(listing.error);
    recordCorruptState({ kind: 'receipt', path: dir, reason: detail });
    return { receipts: [], unreadable: [repoRelative(dir)] };
  }
  if (listing.absent) return { receipts: [], unreadable: [] };
  const receipts = [];
  const unreadable = [];
  for (const n of listing.names.sort()) {
    if (!n.endsWith('.json')) continue;
    const fp = path.join(dir, n);
    try { receipts.push(JSON.parse(fs.readFileSync(fp, 'utf8'))); } catch (e) {
      unreadable.push(repoRelative(fp));
      recordCorruptState({ kind: 'receipt', path: fp, reason: errDetail(e) });
    }
  }
  return { receipts, unreadable };
}

/**
 * Diff-centric verification. Semantics (no active-task concept):
 *  - non-git            -> DEGRADED, exit 3 (cannot compute a trustworthy diff; do not block).
 *  - --task <id>        -> that receipt must be readable + intact + written by this engine +
 *                          bind to current diff, else exit 4.
 *  - no --task (stop-gate default):
 *      * any receipt unreadable    -> STALE exit 4, note:"receipt-unreadable" (fail closed).
 *      * no code change            -> PASS exit 0 (nothing to review).
 *      * no receipts yet           -> PASS exit 0, note:"no-receipts" (adoption grace, never over-block).
 *      * some receipt binds diff   -> PASS exit 0.
 *      * receipts exist, none bind -> STALE exit 4 (code moved past every reviewed diff).
 * @param {{task?:string}} [flags]
 * @returns {{result:Object,code:number}}
 */
function verifyReceipt(flags = {}) {
  if (!isGitRepo()) {
    return { result: { state: 'DEGRADED', note: 'non-git', diffHash: null, degraded: true }, code: 3 };
  }
  const D = gitFingerprint();

  if (typeof flags.task === 'string' && flags.task) {
    const id = safeTaskId(flags.task);
    const file = path.join(receiptsDir(), id + '.json');
    const read = readTextFile(file);
    if (read.absent) {
      return { result: { state: 'STALE', note: 'receipt-missing', task: flags.task, diffHash: D }, code: 4 };
    }
    let receipt = null;
    let detail = read.error ? errDetail(read.error) : null;
    if (!detail) {
      try { receipt = JSON.parse(read.text); } catch (e) { detail = errDetail(e); }
    }
    if (detail) {
      // Not "receipt-missing": that answer sends the reader off to write a receipt which is
      // already sitting there, and the fix for a file that cannot be read is a different one.
      // A mode bit and a truncated line are the same situation here -- the receipt exists and
      // nobody knows what it says.
      recordCorruptState({ kind: 'receipt', path: file, reason: detail });
      process.stderr.write('receipt verify: ' + repoRelative(file) + ' exists and cannot be read (' + detail + ')\n');
      return {
        result: { state: 'STALE', note: 'receipt-unreadable', task: flags.task, diffHash: D, unreadable: [repoRelative(file)] },
        code: 4,
      };
    }
    if (!receiptIntact(receipt)) {
      return { result: { state: 'STALE', note: 'tampered', task: flags.task, diffHash: D }, code: 4 };
    }
    // The engine is checked before the diff, because the diffHash the receipt carries was
    // computed by that engine: if the engine is no longer this one, the two fingerprints
    // beside each other were produced by two different rulers. A receipt with no engineHash
    // was written before this binding existed and is let through -- an upgrade that bricked
    // every receipt already on disk would be paid for by re-reviewing work nobody touched.
    // It is checked after unreadable and after tampered, because a receipt nobody can read
    // and a receipt somebody edited are both worse news than a ruler that moved, and the
    // three send the reader somewhere different: open the file, investigate, re-run.
    const engineNow = engineHash();
    const boundEngine = typeof receipt.engineHash === 'string' ? receipt.engineHash : null;
    if (boundEngine && boundEngine !== engineNow) {
      return {
        result: {
          state: 'STALE', note: 'engine-moved', task: flags.task, diffHash: D,
          engineHash: boundEngine, currentEngineHash: engineNow,
        },
        code: 4,
      };
    }
    if (receipt.diffHash === D) {
      return { result: { state: 'PASS', matched: receipt.taskId, diffHash: D, engineHash: boundEngine }, code: 0 };
    }
    return { result: { state: 'STALE', note: 'diff-moved', task: flags.task, diffHash: D, receiptDiffHash: receipt.diffHash }, code: 4 };
  }

  // Read the directory before anything else answers, because an unreadable receipt outranks
  // every other result here -- including a sibling that binds the current diff. The file that
  // would not parse may be the tampered one, and "some other receipt is fine" says nothing
  // about it. It stays on disk: a person has to open it.
  const loaded = loadReceipts();
  if (loaded.unreadable.length) {
    process.stderr.write('receipt verify: ' + loaded.unreadable.length + ' receipt path(s) exist and cannot be read ('
      + loaded.unreadable.join(', ') + '); this tree is not reviewed until somebody reads them\n');
    return { result: { state: 'STALE', note: 'receipt-unreadable', diffHash: D, unreadable: loaded.unreadable }, code: 4 };
  }
  if (!hasCodeChange()) {
    return { result: { state: 'PASS', note: 'no-change', diffHash: D }, code: 0 };
  }
  if (loaded.receipts.length === 0) {
    return { result: { state: 'PASS', note: 'no-receipts', diffHash: D }, code: 0 };
  }
  const engineNow = engineHash();
  const m = matchReceipts(loaded.receipts, D, engineNow);
  if (m.matched) {
    return { result: { state: 'PASS', matched: m.matched, diffHash: D }, code: 0 };
  }
  // A receipt that binds this exact diff but was written by another engine is a different
  // miss from "code moved past every review", and the note has to say which: one is
  // re-review the change, the other is re-run the review under the engine that ships.
  const engineMoved = loaded.receipts.some(r => receiptIntact(r) && r.diffHash === D
    && typeof r.engineHash === 'string' && r.engineHash !== engineNow);
  return {
    result: { state: 'STALE', note: engineMoved ? 'engine-moved' : 'no-matching-receipt', diffHash: D },
    code: 4,
  };
}

function cmdReceipt(flags, positional = []) {
  const sub = positional[0];   // parseArgs: cmd=argv[0], positional=argv[1..], so sub is positional[0]
  if (sub === 'write') {
    const raw = readStdin();
    let input;
    try { input = raw.trim() ? JSON.parse(raw) : {}; } catch (e) {
      return emit({ error: 'receipt-parse-error', detail: String(e && e.message || e) }, 3);
    }
    let receipt;
    try { receipt = writeReceipt(input); } catch (e) {
      return emit({ error: 'receipt-write-error', detail: String(e && e.message || e) }, 3);
    }
    return emit(receipt, 0);
  }
  if (sub === 'verify') {
    const { result, code } = verifyReceipt(flags);
    return emit(result, code);
  }
  return emit({ error: 'receipt-subcommand', detail: 'usage: receipt write|verify', got: sub || null }, 3);
}

function cmdVerify(flags) {
  const { result, code } = verifyPlanCmd(flags);
  return emit(result, code);
}

// ===========================================================================
// S8 quality  (four-state verification gate; command-missing -> BLOCKED, never fake green)
// ===========================================================================
// runCheck maps one declared check to PASS/FAIL/BLOCKED/SKIPPED. A missing binary is
// BLOCKED (not a silent pass); fast-mode may SKIP a non-security/safety/privacy check that
// opts in, but security/safety/privacy checks always run for real. Aggregation: any FAIL ->
// FAIL; else any BLOCKED -> BLOCKED; else PASS (SKIPPED counts toward the report but does
// not block). An empty plan with affected modules is BLOCKED (config failure, not green).
// Shim discovery: the tool is installed, just not on this process's PATH. Windows package
// managers install into a shim directory that an interactive shell picks up and a git hook,
// a service or an editor-spawned process frequently does not, so the same machine reports
// BLOCKED command-missing for a binary the developer runs by hand two seconds later. That
// reads as "the harness is broken", and a gate people believe is broken is a gate people
// switch off.
// The fallback is a scan, never a pass: a command that is in none of these directories stays
// BLOCKED. CC_HARNESS_SHIM_DIRS overrides the defaults on any platform (path.delimiter
// separated), which is also the only way this is testable anywhere but Windows.
const WIN_SHIM_DIRS = [
  ['LOCALAPPDATA', ['Microsoft', 'WinGet', 'Links']],
  ['USERPROFILE', ['scoop', 'shims']],
  ['ChocolateyInstall', ['bin']],
];

/** Directories to scan once PATH has no answer. An explicit override wins on every platform. */
function shimDirs() {
  const override = String(process.env.CC_HARNESS_SHIM_DIRS || '').trim();
  if (override) return override.split(path.delimiter).map(d => d.trim()).filter(Boolean);
  if (process.platform !== 'win32') return [];
  const out = [];
  for (const [envVar, parts] of WIN_SHIM_DIRS) {
    const base = process.env[envVar];
    if (base) out.push(path.join(base, ...parts));
  }
  return out;
}

/**
 * Which shim directory holds `exe`, or null. Name resolution is whichCmd's (PATHEXT on
 * win32, the bare name elsewhere), so a hit here means what a PATH hit means.
 * @param {string} exe
 * @returns {string|null}
 */
function findShim(exe) {
  if (!exe || exe.includes('/') || exe.includes('\\')) return null;
  const exts = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.trim()).filter(Boolean)
    : [];
  for (const dir of shimDirs()) {
    for (const name of [exe].concat(exts.map(e => exe + e))) {
      try {
        if (fs.statSync(path.join(dir, name)).isFile()) return dir;
      } catch (_e) { /* not this one */ }
    }
  }
  return null;
}

/**
 * process.env with one directory prepended to PATH. The key is looked up case-insensitively
 * because Windows spells it Path: adding a second 'PATH' beside an existing 'Path' hands the
 * child two of them, and which one it reads is not something to leave to chance.
 * @param {string} dir
 * @returns {Object}
 */
function pathPrefixedEnv(dir) {
  const env = { ...process.env };
  const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = dir + path.delimiter + (env[key] || '');
  return env;
}

/**
 * Run one shell command, returning its exit code. win32 uses cmd /c with
 * windowsVerbatimArguments so nested quotes in the command survive to the child
 * (plain cmd /c mangles e.g. node -e "process.exit(3)" into a 0 exit -- a false green).
 * Both streams are returned alongside the code; spawnSync captures them either way, and
 * S17 gate needs them to write the evidence log. runCheck ignores them unless asked.
 * `pathPrefix` puts one directory in front of the child's PATH, which is how a command found
 * in a shim directory becomes runnable in the child without this process editing its own
 * environment -- a mutation that would then apply to every later check too.
 * @param {string} command
 * @param {{pathPrefix?:string|null}} [opts]
 * @returns {{code:number,stdout:string,stderr:string}}
 */
function spawnCmd(command, { pathPrefix = null } = {}) {
  const extra = pathPrefix ? { env: pathPrefixedEnv(pathPrefix) } : {};
  const r = process.platform === 'win32'
    ? spawnSync('cmd', ['/c', command], { maxBuffer: 1 << 28, windowsVerbatimArguments: true, ...extra })
    : spawnSync('sh', ['-c', command], { maxBuffer: 1 << 28, ...extra });
  return {
    code: r.status,
    stdout: r.stdout ? r.stdout.toString('utf8') : '',
    stderr: r.stderr ? r.stderr.toString('utf8') : '',
  };
}

/**
 * The three classes no exemption path may excuse -- fast-mode skips them, waivers do not
 * reach them. One definition rather than the same triple spelled out at each gate, because
 * two copies of "what is protected" is one copy away from a class that is protected in one
 * place and waivable in the other.
 * @param {string|undefined} cls
 * @returns {boolean}
 */
function isProtectedClass(cls) {
  return cls === 'security' || cls === 'safety' || cls === 'privacy';
}

/**
 * How a check names itself in every result, whether it ran or not. The waiver plan has to
 * key on exactly the id runCheck would report, or a waiver would match the check the plan
 * looked up and miss the one the runner named. Pure.
 * @param {{id?:string,command?:string,class?:string}} check
 * @returns {{id:string,class:string|undefined,cmd:string|undefined}}
 */
function checkIdentity(check) {
  return {
    id: check && check.id ? check.id : (check && check.command) || 'check',
    class: check && check.class,
    cmd: check && check.command,
  };
}

/**
 * Evaluate one check to a four-state result. Never fakes green: a binary that is neither on
 * PATH nor in a shim directory is BLOCKED. A binary found in a shim directory runs with that
 * directory in front of the child's PATH and the result names where it came from, so a green
 * can be traced back to which copy of the tool produced it.
 * Security checks ignore fast-mode entirely (always run). Non-security opt-in checks may SKIP
 * under fast-mode.
 * `capture` adds the command's stdout/stderr to the result; it is off by default so the
 * shape verify emits is unchanged, and only S17 gate (which persists them) asks for it.
 * @param {{id?:string,command?:string,class?:string,allowFastSkip?:boolean}} check
 * @param {{fastActive?:boolean,capture?:boolean}} [opts]
 * @returns {CheckResult}
 */
function runCheck(check, { fastActive = false, capture = false } = {}) {
  const base = checkIdentity(check);
  const cls = base.class;
  if (!check || !check.command) return { ...base, state: 'BLOCKED', reason: 'no-command' };
  const exe = String(check.command).trim().split(/\s+/)[0];
  let shim = null;
  if (!whichCmd(exe)) {
    shim = findShim(exe);
    if (!shim) return { ...base, state: 'BLOCKED', reason: 'command-missing:' + exe };
  }
  if (fastActive && !isProtectedClass(cls) && check.allowFastSkip) {
    return { ...base, state: 'SKIPPED', reason: 'fast-mode' };
  }
  const r = spawnCmd(check.command, { pathPrefix: shim });
  const found = shim ? { shim: repoRelative(shim) } : {};
  const res = r.code === 0
    ? { ...base, ...found, state: 'PASS', exit: 0 }
    : { ...base, ...found, state: 'FAIL', exit: r.code };
  return capture ? { ...res, stdout: r.stdout, stderr: r.stderr } : res;
}

/** Aggregate check states: any FAIL -> FAIL; else any BLOCKED -> BLOCKED; else PASS. */
function aggregateStates(states) {
  if (states.some(s => s === 'FAIL')) return 'FAIL';
  if (states.some(s => s === 'BLOCKED')) return 'BLOCKED';
  return 'PASS';
}

/**
 * Required checks for a module: module-level `verification` overrides the catalog's
 * per-risk-tier default (catalog.riskChecks[risk]). Returns an array of check ids/specs.
 * @param {string} risk
 * @param {Module} module
 * @param {Catalog} catalog
 * @returns {any[]}
 */
function requiredChecks(risk, module, catalog) {
  if (module && Array.isArray(module.verification)) return module.verification;
  const riskChecks = (catalog && catalog.riskChecks && typeof catalog.riskChecks === 'object') ? catalog.riskChecks : {};
  return (risk && Array.isArray(riskChecks[risk])) ? riskChecks[risk] : [];
}

/** Resolve a check ref (string id or inline object) against catalog.checks. */
function resolveCheck(ref, catalog) {
  if (ref && typeof ref === 'object') return ref;
  const defs = (catalog && catalog.checks && typeof catalog.checks === 'object') ? catalog.checks : {};
  const def = defs[ref];
  if (def && typeof def === 'object') return { id: ref, ...def };
  return { id: String(ref), command: undefined };   // unresolved -> BLOCKED no-command
}

/**
 * Plan + run verification for a changed-path set: compute impact, gather each affected
 * module's required checks, run them four-state, aggregate. Missing catalog fields degrade
 * gracefully (empty check list per module).
 * `runCheckFn` swaps in a different per-check runner and defaults to runCheck, so S17 gate
 * can persist each check's output without a second copy of the aggregation, the waiver
 * rules and the attribute assessment living somewhere else and drifting away from these.
 * @param {string[]} changed
 * @param {Catalog} catalog
 * @param {{fastActive?:boolean,nonGit?:boolean,runCheckFn?:Function}} [opts]
 * @returns {{state:string,checks:CheckResult[],affected:string[],degraded:boolean}}
 */
function verifyPlan(changed, catalog, { fastActive = false, nonGit = false, runCheckFn = null } = {}) {
  const run = typeof runCheckFn === 'function' ? runCheckFn : runCheck;
  const imp = analyzeImpact(changed, catalog, { nonGit });
  const byId = new Map((catalog.modules || []).map(m => [m.id, m]));
  const entries = [];
  const seen = new Set();
  for (const id of imp.affected) {
    const m = byId.get(id);
    if (!m) continue;
    const risk = m.riskTier;
    for (const ref of requiredChecks(risk, m, catalog)) {
      const spec = resolveCheck(ref, catalog);
      const key = id + '::' + (spec.id || spec.command || JSON.stringify(ref));
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ module: id, spec });
    }
  }
  // S10: waivers are resolved here, before the first command starts, and never again after.
  // An excused check is not run at all; a check that ran keeps the verdict it produced.
  const waiverState = loadWaiverState();
  const waivers = waiverState.waivers;
  const { plan, waiversBlocked } = waivePlan(entries, waivers);
  const checks = [];
  for (const p of plan) {
    if (p.waiver) {
      checks.push({
        module: p.module, ...checkIdentity(p.spec),
        state: 'SKIPPED', reason: 'waiver:' + p.waiver.scope,
      });
      continue;
    }
    checks.push({ module: p.module, ...run(p.spec, { fastActive }) });
  }
  // S11: attribute coverage over the executed results. Blocking gaps (critical/high
  // declared, no passing claiming check, no attribute waiver) close the gate alongside
  // FAIL/BLOCKED so "all checks green but nothing evidenced security" stops reading as done.
  // A waived check is SKIPPED here, which neither covers an attribute nor contradicts one:
  // excusing the check buys the exemption at the price of its evidence, and a critical or
  // high attribute left with none closes the gate through the attribute layer instead.
  const attrs = assessAttributes(imp.affected, catalog, checks, waivers);
  // Empty verification plan while modules ARE affected is a configuration failure, not a
  // green: nothing ran, so nothing was established. BLOCKED (never fake green), same class
  // as command-missing. No affected modules (no changes) still aggregates to PASS.
  const emptyPlan = imp.affected.length > 0 && checks.length === 0;
  return {
    state: emptyPlan ? 'BLOCKED' : aggregateStates(checks.map(c => c.state)),
    checks, affected: imp.affected, degraded: imp.degraded,
    emptyPlan,
    attributes: attrs.attributes, attributeGaps: attrs.blockingGaps,
    // Only when there are any: the gate output is where a reviewer actually looks, and a
    // field that is always there is a field nobody reads.
    ...(waiversBlocked.length ? { waiversBlocked } : {}),
    ...(waiverState.corrupt.length ? { corruptWaivers: waiverState.corrupt } : {}),
  };
}

/**
 * True when the fast tier is in force. The reading comes from the one resolver
 * (.claude/hooks/lib/tier.mjs, through lib/tier.mjs) rather than from a flag file opened here:
 * this function used to parse .claude/.fast-mode itself, which is how one switch came to be
 * read open by the engine and closed by every bash hook (#38). The name is kept because three
 * sections and a golden baseline call it, and what it answers is unchanged -- fast is now a
 * tier rather than a flag.
 */
function fastModeActive() {
  return tierState().fast;
}

/**
 * `verify` subcommand driver. Exit convention:
 *   PASS with at least one check executed, no blocking attribute gap -> 0
 *   FAIL or BLOCKED, or a critical/high attribute lacks evidence -> 2 (never fake green)
 *   no catalog / non-git, or every check skipped -> 3 (degraded, nothing was established)
 */
function verifyPlanCmd(flags) {
  const loaded = loadCatalogFlag(flags);
  if (!loaded.ok) {
    return { result: { state: 'DEGRADED', degraded: true, error: loaded.error, detail: loaded.detail, checks: [], affected: [] }, code: 3 };
  }
  let changed;
  let nonGit = false;
  if (typeof flags.changed === 'string') {
    changed = parseCsv(flags.changed);
  } else {
    const cp = changedPaths();
    if (Array.isArray(cp)) { changed = cp; }
    else { changed = cp.paths; nonGit = !!cp.nonGit; }
  }
  if (nonGit) {
    return { result: { state: 'DEGRADED', degraded: true, note: 'non-git', checks: [], affected: [] }, code: 3 };
  }
  const fastActive = fastModeActive();
  const plan = verifyPlan(changed, loaded.catalog, { fastActive, nonGit });
  const attrBlocked = Array.isArray(plan.attributeGaps) && plan.attributeGaps.length > 0;
  const gate = (plan.state === 'FAIL' || plan.state === 'BLOCKED') ? plan.state
    : attrBlocked ? 'BLOCKED_BY_ATTRIBUTES' : 'PASS';
  // A run in which every check was skipped ran nothing, so it established nothing, and 0 is
  // the answer a caller reads as "verified". The same nothing is already a 3 in dod (every
  // blocking step degraded) and in release (all seven checks degraded). Blocking still wins:
  // a FAIL or a missing attribute is a verdict, and 2 is stronger news than 3.
  const everySkipped = plan.checks.length > 0 && plan.checks.every(c => c.state === 'SKIPPED');
  const code = gate !== 'PASS' ? 2 : everySkipped ? 3 : 0;
  return {
    result: { ...plan, gate, fastActive, ...(everySkipped ? { note: 'every-check-skipped' } : {}) },
    code,
  };
}

// ===========================================================================
// S10 waiver  (structured per-check exemptions; security never waivable)
// ===========================================================================
// Waivers live under .claude/harness/waivers/*.json (git-ignored runtime state).
// A valid waiver can demote a non-security FAIL/BLOCKED check to SKIPPED with
// reason "waiver:<scope>". Security-class checks are never rewritten, even if a
// file claims their id. Fast Mode remains a bulk sugar path orthogonal to this.
// Forbidden keywords in reason|scope block create/validate (safety net for HIGH gates).

/** Forbidden whole-word tokens in reason+scope (case-insensitive). */
const WAIVER_FORBIDDEN_RE = /\b(safety|security|privacy|pii|secret|credential|destructive|push|deploy|production)\b/i;

/** Where waiver JSON files are stored (project-relative, git-ignored). */
function waiversDir() {
  return path.join(projectRoot(), '.claude', 'harness', 'waivers');
}

/**
 * Validate a waiver object. Returns a list of human-readable error strings
 * (empty => valid). Does not touch fs. Expired expiry is an error.
 * @param {any} w
 * @returns {string[]}
 */
function validateWaiver(w) {
  const errors = [];
  if (!w || typeof w !== 'object' || Array.isArray(w)) return ['waiver must be an object'];
  if (w.version !== 1) errors.push('version must be 1');
  for (const k of ['owner', 'reason', 'scope', 'expiry', 'compensation', 'created_at']) {
    if (typeof w[k] !== 'string' || !String(w[k]).trim()) errors.push(k + ' required (non-empty string)');
  }
  const createdMs = Date.parse(w.created_at);
  if (typeof w.created_at === 'string' && Number.isNaN(createdMs)) {
    errors.push('created_at must be ISO timestamp');
  }
  const expMs = Date.parse(w.expiry);
  if (typeof w.expiry === 'string') {
    if (Number.isNaN(expMs)) errors.push('expiry must be ISO timestamp');
    else if (expMs <= Date.now()) errors.push('expiry must be in the future (not expired)');
  }
  const blob = (String(w.reason || '') + ' ' + String(w.scope || '')).toLowerCase();
  if (WAIVER_FORBIDDEN_RE.test(blob)) {
    errors.push('forbidden keyword in reason|scope (safety|security|privacy|pii|secret|credential|destructive|push|deploy|production)');
  }
  return errors;
}

/**
 * Load *.json waivers that pass validateWaiver, and name the files that could not be read
 * at all -- including the waivers directory itself, when that is what will not list. Dropping an unreadable waiver is the strict direction and stays -- it exempts
 * nothing -- but an empty list also reads as "nobody has waived anything", which is a
 * different fact from "somebody filed a waiver nobody can read", and only one of the two
 * has an owner. A file that parses and fails validation is not corruption: validateWaiver
 * already names what is wrong with it and `waiver check` reads it back.
 * Each entry is annotated with _path (absolute) so callers can reach the file; what goes
 * on stdout is the repo-relative rendering, never this one.
 * @returns {{waivers:Array<Waiver & {_path?:string}>,corrupt:string[]}}
 */
function loadWaiverState() {
  const dir = waiversDir();
  const listing = readDirNames(dir);
  if (listing.error) {
    const detail = errDetail(listing.error);
    recordCorruptState({ kind: 'waiver', path: dir, reason: detail });
    return { waivers: [], corrupt: [repoRelative(dir)] };
  }
  if (listing.absent) return { waivers: [], corrupt: [] };
  const out = [];
  const corrupt = [];
  for (const n of listing.names.sort()) {
    if (!n.endsWith('.json')) continue;
    const fp = path.join(dir, n);
    let obj;
    try { obj = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) {
      corrupt.push(repoRelative(fp));
      recordCorruptState({ kind: 'waiver', path: fp, reason: errDetail(e) });
      continue;
    }
    if (validateWaiver(obj).length) continue;
    out.push({ ...obj, _path: fp });
  }
  return { waivers: out, corrupt };
}

/** The valid waivers alone, for callers that only apply them. */
function loadWaivers() {
  return loadWaiverState().waivers;
}

/**
 * First waiver whose scope exactly equals checkId, or null.
 * @param {string} checkId
 * @param {Array<{scope?:string}>} waivers
 */
function findWaiverForCheck(checkId, waivers) {
  const id = String(checkId == null ? '' : checkId);
  const list = Array.isArray(waivers) ? waivers : [];
  for (const w of list) {
    if (w && w.scope === id) return w;
  }
  return null;
}

/**
 * Decide which checks a waiver excuses BEFORE any of them runs. The order is the whole
 * point. Deciding afterwards means a check ran, produced FAIL, and the record then said
 * SKIPPED -- and "this failed and somebody signed for it" is not a fact a record is allowed
 * to lose, because everything downstream reads SKIPPED as "no verdict here": the aggregate
 * stops seeing a FAIL, the gate goes green, and the failure survives only as a state nobody
 * queries. Excusing the check up front says the honest thing instead -- nobody looked --
 * and it says it in the one place where it is still true, before the command exists.
 *
 * A waiver over a protected-class check excuses nothing: it is recorded in waiversBlocked
 * and the check runs for real. That is the same rule as before, moved earlier; a waiver
 * file claiming a security id could never rewrite that verdict, and now it cannot stop it
 * from being produced either.
 *
 * Pure + injectable (waivers array passed in) so selftest stays fs-free.
 * @param {Array<{module?:string,spec:Object}>} entries  resolved checks, in run order
 * @param {Array<Waiver>} waivers
 * @returns {{plan:Array<{module:string|undefined,spec:Object,waiver:Waiver|null}>,
 *            waiversBlocked:Array<{check:string,module:string|null,class:string,scope:string}>}}
 */
function waivePlan(entries, waivers) {
  const plan = [];
  const waiversBlocked = [];
  for (const e of (Array.isArray(entries) ? entries : [])) {
    const spec = (e && e.spec) || {};
    const { id } = checkIdentity(spec);
    const hit = findWaiverForCheck(id, waivers);
    if (hit && isProtectedClass(spec.class)) {
      waiversBlocked.push({
        check: id, module: (e && e.module !== undefined) ? e.module : null,
        class: spec.class, scope: hit.scope,
      });
      plan.push({ module: e && e.module, spec, waiver: null });
      continue;
    }
    plan.push({ module: e && e.module, spec, waiver: hit || null });
  }
  return { plan, waiversBlocked };
}

/**
 * If result is FAIL|BLOCKED, class is not security/safety, and a waiver matches scope==id,
 * rewrite to SKIPPED with reason waiver:<scope>. Otherwise return result unchanged.
 * Safety-class checks sit beside security: a failing functional-safety gate must never be
 * waived into green, for the same reason a security gate must not.
 * No longer on any execution path -- waivePlan decides before the runner is reached, and an
 * executed verdict is final wherever it came from. Kept because the unit lanes still pin
 * what it did; a caller that reintroduces it reintroduces the rewrite.
 * Pure + injectable (waivers array passed in) so selftest stays fs-free.
 * @param {CheckResult} result
 * @param {Array<Waiver>} waivers
 * @returns {CheckResult}
 */
function applyWaiver(result, waivers) {
  if (!result || typeof result !== 'object') return result;
  const state = result.state;
  if (state !== 'FAIL' && state !== 'BLOCKED') return result;
  if (isProtectedClass(result.class)) return result;
  const hit = findWaiverForCheck(result.id, waivers);
  if (!hit) return result;
  return { ...result, state: 'SKIPPED', reason: 'waiver:' + hit.scope };
}

/**
 * CLI: waiver list | check | create.
 *   list (default)                         -> {ok, waivers:[{path,...fields}]} exit 0
 *   check --file path | positional path    -> {ok, valid, errors, waiver} exit 0/1
 *   create --owner --reason --scope --expiry --compensation [--dry-run]
 *                                          -> validate then write waivers/<ts>-<hash10>.json
 * @param {Object} flags
 * @param {string[]} positional
 */
function cmdWaiver(flags = {}, positional = []) {
  const sub = (positional[0] || flags.sub || 'list');
  if (sub === 'list') {
    const state = loadWaiverState();
    const list = state.waivers.map(w => {
      const { _path, ...rest } = w;
      return { path: _path ? repoRelative(_path) : null, ...rest };
    });
    return emit({
      ok: true, waivers: list,
      ...(state.corrupt.length ? { corruptWaivers: state.corrupt } : {}),
    }, 0);
  }
  if (sub === 'check') {
    const file = (typeof flags.file === 'string' && flags.file) || positional[1] || '';
    if (!file) return emit({ ok: false, valid: false, errors: ['--file or path required'], waiver: null }, 1);
    let obj;
    try { obj = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return emit({ ok: false, valid: false, errors: ['read/parse: ' + String(e && e.message || e)], waiver: null }, 1); }
    const errors = validateWaiver(obj);
    const valid = errors.length === 0;
    return emit({ ok: valid, valid, errors, waiver: obj }, valid ? 0 : 1);
  }
  if (sub === 'create') {
    const now = new Date().toISOString();
    const waiver = {
      version: 1,
      owner: typeof flags.owner === 'string' ? flags.owner : '',
      reason: typeof flags.reason === 'string' ? flags.reason : '',
      scope: typeof flags.scope === 'string' ? flags.scope : '',
      expiry: typeof flags.expiry === 'string' ? flags.expiry : '',
      compensation: typeof flags.compensation === 'string' ? flags.compensation : '',
      created_at: now,
    };
    const errors = validateWaiver(waiver);
    if (errors.length) {
      process.stderr.write('waiver create rejected: ' + errors.join('; ') + '\n');
      return emit({ ok: false, errors, waiver }, 1);
    }
    waiver.contentHash = contentHash(waiver);
    if (flags['dry-run'] === true || flags.dryRun === true) {
      return emit({ ok: true, dryRun: true, path: null, waiver }, 0);
    }
    const dir = waiversDir();
    fs.mkdirSync(dir, { recursive: true });
    const ts = now.replace(/[:.]/g, '-');
    const h10 = String(waiver.contentHash).slice(0, 10);
    const fname = ts + '-' + h10 + '.json';
    const fp = path.join(dir, fname);
    fs.writeFileSync(fp, JSON.stringify(waiver, null, 2) + '\n', 'utf8');
    return emit({ ok: true, path: repoRelative(fp), waiver }, 0);
  }
  return emit({ error: 'waiver-subcommand', detail: 'usage: waiver list|check|create', got: sub || null }, 3);
}

// ===========================================================================
// S11 attributes  (quality attributes per module: the five-property governance layer)
// ===========================================================================
// A passing check proves it ran; it does not say what property it established. This layer
// closes the gap: modules declare which attributes they must hold evidence for (and how
// strongly), checks declare which attributes a passing run evidences, and coverage becomes
// decidable. Drawn from ISO/IEC 25010, narrowed to what a repository can hold evidence for.
/** Check ids in a module's resolved verification list whose spec claims `attr`. */
function claimingChecks(module, catalog, attr) {
  const out = [];
  for (const ref of requiredChecks(module && module.riskTier, module, catalog)) {
    const spec = resolveCheck(ref, catalog);
    if (Array.isArray(spec.attributes) && spec.attributes.includes(attr)) out.push(spec.id);
  }
  return out;
}

/**
 * Attribute coverage over executed check results (pure + injectable for selftest).
 * Coverage rules: an attribute is covered when a check the module itself selected claims
 * it and PASSed, and no claiming check FAILed/BLOCKED -- a demonstration of absence is
 * stronger evidence than a partial demonstration of presence. SKIPPED neither covers nor
 * contradicts. Declaring without wiring produces a visible gap, not silent success.
 * A `high` gap may be deferred by a waiver with scope "attribute:<module>/<attr>"
 * (the forbidden-keyword rule makes security/safety attribute waivers unrepresentable);
 * `critical` is beyond waiver.
 * @param {string[]} affectedIds
 * @param {Catalog} catalog
 * @param {Array<{module:string,id:string,state:string}>} checkResults
 * @param {Array<Waiver>} [waivers]
 * @returns {{attributes:Array,blockingGaps:Array}}
 */
function assessAttributes(affectedIds, catalog, checkResults, waivers = []) {
  const byId = new Map((catalog.modules || []).map(m => [m.id, m]));
  const attributes = [];
  const blockingGaps = [];
  for (const moduleId of (affectedIds || [])) {
    const m = byId.get(moduleId);
    if (!m || !m.attributes) continue;
    for (const [attr, req] of Object.entries(m.attributes)) {
      const { tier, reason } = normalizeTier(req);
      const enforcement = TIER_ENFORCEMENT[tier] || 'warn';
      if (tier === 'none') {
        attributes.push({ module: moduleId, attribute: attr, tier, enforcement, covered: true, evidence: [], reason: 'opted out: ' + reason });
        continue;
      }
      const claiming = claimingChecks(m, catalog, attr);
      const evidence = claiming.map(id => {
        const r = checkResults.find(c => c.module === moduleId && c.id === id);
        return { check: id, state: r ? r.state : 'MISSING' };
      });
      const passing = evidence.filter(e => e.state === 'PASS');
      const contradicting = evidence.filter(e => e.state === 'FAIL' || e.state === 'BLOCKED');
      const covered = passing.length > 0 && contradicting.length === 0;
      const entry = {
        module: moduleId, attribute: attr, tier, enforcement, covered, evidence,
        reason: contradicting.length > 0 ? 'contradicted by ' + contradicting.map(e => e.check + '(' + e.state + ')').join(',')
          : covered ? 'evidenced by ' + passing.map(e => e.check).join(',')
          : claiming.length === 0 ? 'no check in this module verification list claims ' + attr
          : 'claiming checks have not passed for the current change',
      };
      if (!covered && enforcement === 'block') {
        const w = tier === 'high' ? findWaiverForCheck('attribute:' + moduleId + '/' + attr, waivers) : null;
        if (w) {
          entry.waived = true;
          entry.reason = entry.reason + '; deferred by waiver:' + w.scope;
        } else {
          blockingGaps.push({ module: moduleId, attribute: attr, tier, reason: entry.reason });
        }
      }
      attributes.push(entry);
    }
  }
  return { attributes, blockingGaps };
}

/**
 * `attributes` subcommand: static wiring audit, no execution. For every module (or
 * --module <id>), report declared attributes, tier, enforcement, and which checks claim
 * them. A blocking-tier attribute with no claiming check is a visible gap -> exit 1.
 */
function cmdAttributes(flags) {
  const loaded = loadCatalogFlag(flags);
  if (!loaded.ok) {
    return emit({ ok: false, degraded: true, error: loaded.error, detail: loaded.detail }, 3);
  }
  const catalog = loaded.catalog;
  const only = typeof flags.module === 'string' ? flags.module : null;
  const report = [];
  let unwiredBlocking = 0;
  const byTier = {};
  for (const m of (catalog.modules || [])) {
    if (only && m.id !== only) continue;
    for (const [attr, req] of Object.entries(m.attributes || {})) {
      const { tier, reason } = normalizeTier(req);
      const enforcement = TIER_ENFORCEMENT[tier] || 'warn';
      byTier[tier] = (byTier[tier] || 0) + 1;
      if (tier === 'none') {
        report.push({ module: m.id, attribute: attr, tier, enforcement, wired: [], reason });
        continue;
      }
      const wired = claimingChecks(m, catalog, attr);
      const entry = { module: m.id, attribute: attr, tier, enforcement, wired };
      if (wired.length === 0) {
        entry.gap = 'declared but no claiming check is wired';
        if (enforcement === 'block') unwiredBlocking++;
      }
      report.push(entry);
    }
  }
  return emit({ ok: unwiredBlocking === 0, declared: report.length, byTier, unwiredBlocking, attributes: report }, unwiredBlocking === 0 ? 0 : 1);
}

export {
  receiptsDir, safeTaskId, contentHash, engineFiles, engineHash, hasCodeChange, writeReceipt,
  receiptIntact, matchReceipts, loadReceipts, verifyReceipt, cmdReceipt, cmdVerify,
  shimDirs, findShim, pathPrefixedEnv,
  isProtectedClass, checkIdentity,
  runCheck, aggregateStates, requiredChecks, resolveCheck, verifyPlan, fastModeActive, verifyPlanCmd,
  WAIVER_FORBIDDEN_RE, waiversDir, validateWaiver, loadWaiverState, loadWaivers, findWaiverForCheck,
  waivePlan, applyWaiver, cmdWaiver,
  claimingChecks, assessAttributes, cmdAttributes,
};
