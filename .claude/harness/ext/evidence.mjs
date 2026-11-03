// ext/evidence.mjs -- S17 the evidence layer: a gate that records what it actually ran, a
// hash-chained ledger that makes those records tamper-evident, and three readers that keep
// the pile honest as it ages (gate-audit / retention / risk).
//
// How this differs from S8 verify, and why verify is left untouched: verify answers "does
// the gate pass right now" and three hook pairs consume its stdout and exit codes, so its
// shape is a contract. `gate` answers the same question through the same verifyPlan() --
// four-state aggregation, waivers, the quality-attribute gate -- and additionally leaves
// behind something that can be re-read later: each executed check's raw output on disk
// with its digest, a digest of the resolved plan, and one append-only ledger line binding
// all of it to a diff. A green with no retrievable output is a claim; this is evidence.
//
// The ledger fails closed on purpose, in both directions. A broken chain means every
// earlier verification is treated as unproven (task complete blocks, risk reports
// LEDGER_BROKEN); a ledger that cannot be read is not an empty one either, so it degrades
// rather than reporting an intact chain over nothing. There is deliberately no "repair the
// ledger" command: the chain IS the evidence, so a repair tool would be a forgery tool.
// A break therefore does not clear by running the gates again -- new records only append
// past it -- and saying otherwise sends people down a road that ends where it started. The
// honest recovery is a decision a person makes: retire the file (which discards every proof
// it held) and rebuild from there, or find out who edited it.
//
// Two things the first cut of this file got wrong, both fixed here and both regression-locked
// in .claude/tests/test-evidence-defects.sh: the append was a read-then-append with no lock,
// so a burst of concurrent gates broke the chain permanently; and the evidence digests were
// written and never read, which makes a digest decoration rather than a control.
//
// Depends on core / catalog / graph / quality. Nothing here imports task.mjs (task.mjs
// imports this one for the state paths and the chain check), so the graph stays acyclic.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  TIER_ENFORCEMENT,
  changedPaths, emit, errDetail, gitFingerprint, headCommit, isStateExcluded, matchAny,
  normalizeTier,
  parseCsv, projectRoot, quarantineFilePath, readTextFile, recordCorruptState, repoRelative,
  sha256, toPosixPath, withDirLock,
} from '../lib/core.mjs';
import { loadCatalogFlag } from './catalog.mjs';
import { analyzeImpact } from './graph.mjs';
import {
  claimingChecks, fastModeActive, loadWaivers, requiredChecks, resolveCheck, runCheck,
  verifyPlan, waiversDir,
} from './quality.mjs';
import { governancePaths } from '../lib/tier.mjs';

// ---------------------------------------------------------------------------
// S17.1 runtime state locations + atomic write
// ---------------------------------------------------------------------------
// Both directories are git-ignored, excluded from the diff fingerprint (running the engine
// must not stale its own evidence) and excluded from context-pack (runtime state never
// reaches a delegate). Those three exclusions live in core.mjs beside the existing ones.

function stateDir() {
  return path.join(projectRoot(), '.claude', 'harness', 'state');
}
function ledgerFilePath() {
  return path.join(stateDir(), 'ledger.jsonl');
}
function ledgerLockPath() {
  return path.join(stateDir(), 'ledger.lock');
}
function taskFilePath() {
  return path.join(stateDir(), 'task.json');
}
function evidenceDir() {
  return path.join(projectRoot(), '.claude', 'harness', 'evidence');
}
function contextPackDir() {
  return path.join(stateDir(), 'context');
}

/**
 * Project-relative, forward-slashed path -- what goes into a record a human will read.
 * The rule itself lives in core (repoRelative), so the evidence layer cannot drift into a
 * second spelling of it; the local name stays because eleven call sites read better saying
 * what the path is for than which helper produced it.
 */
function relFromRoot(p) {
  return repoRelative(p);
}

/** Write through a temp file + rename, so a killed process never leaves half a record. */
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * sha256 over LF-normalized text. A CRLF checkout must not produce a different digest for
 * the same content, or the chain would break for a reason that has nothing to do with
 * tampering -- the exact false alarm that gets a control switched off.
 */
function sha256Lf(text) {
  return sha256(String(text).replace(/\r\n/g, '\n'));
}

/** Read a JSON file, or return the fallback (never throws). */
function readJsonFile(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return fallback; }
}

/**
 * The active task record, and the reason there is not one. Lives here because task.json is
 * state-dir state. A record that exists and cannot be read is not the same as no record:
 * "no active task" is advice to start one, and starting one writes straight over the
 * damaged file -- the single move that destroys what went wrong. A mode bit denying the
 * read leaves the record exactly as present as a truncated line does, so both answer here.
 * @returns {{task:Object|null,corrupt:{path:string,detail:string}|null}}
 */
function readTaskState() {
  const fp = taskFilePath();
  const read = readTextFile(fp);
  if (read.absent) return { task: null, corrupt: null };
  let detail = read.error ? errDetail(read.error) : null;
  if (!detail) {
    try { return { task: JSON.parse(read.text), corrupt: null }; } catch (e) {
      detail = errDetail(e);
    }
  }
  recordCorruptState({ kind: 'task', path: fp, reason: detail });
  return { task: null, corrupt: { path: relFromRoot(fp), detail } };
}

/** The active task record, or null -- for readers that only report what is there. */
function readTaskRecord() {
  return readTaskState().task;
}

// ---------------------------------------------------------------------------
// S17.2 ledger  (append-only, hash-chained; a break fails closed)
// ---------------------------------------------------------------------------
//   contentHash = sha256(LF(JSON.stringify(record)))
//   chain       = sha256(prev + NUL + contentHash)
//   prev        = the previous line's chain, 64 zeros for the first line
//   line        = { ...record, contentHash, prev, chain }

const GENESIS = '0'.repeat(64);

/** One chain link. Pure. */
function chainHash(prev, contentHash) {
  return sha256(String(prev) + '\0' + String(contentHash));
}

/** Build the line for a record given the previous line's chain. Pure. */
function ledgerLine(record, prev) {
  const contentHash = sha256Lf(JSON.stringify(record));
  return { ...record, contentHash, prev, chain: chainHash(prev, contentHash) };
}

/**
 * Split the raw file into records. An unparseable line is kept as {corrupt:true,raw} rather
 * than dropped: a ledger that silently discards what it cannot read looks intact, which is
 * the one appearance it must never be able to produce. Pure.
 */
function parseLedgerLines(raw) {
  return String(raw == null ? '' : raw).split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch (_e) { return { corrupt: true, raw: l }; }
  });
}

/**
 * Read the ledger, distinguishing the two failures that used to be one. A file that is not
 * there is an empty ledger and says so; a file that is there and cannot be read is not an
 * empty ledger, it is an unknown one, and every caller has to be able to tell those apart --
 * "unknown" answered as "empty" is how a protected set becomes deletable and a broken chain
 * reads as intact.
 * @returns {{entries:Array<Object>,unreadable:string|null}}
 */
function readLedgerState() {
  let raw;
  try {
    raw = fs.readFileSync(ledgerFilePath(), 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { entries: [], unreadable: null };
    return { entries: [], unreadable: String((e && e.code) || (e && e.message) || e) };
  }
  return { entries: parseLedgerLines(raw), unreadable: null };
}

/**
 * True when the file is absent, empty, or already ends in a newline. A previous write that
 * was killed mid-line leaves a fragment with no terminator, and appending straight onto it
 * glues the next record to the fragment -- one interrupted write would then cost two
 * records, the good one included.
 */
function endsWithNewline(file) {
  let fd;
  try {
    const size = fs.statSync(file).size;
    if (size === 0) return true;
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(1);
    fs.readSync(fd, buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } catch (_e) {
    return true;                                  // nothing readable to repair
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_e) { /* closing a read fd */ } }
  }
}

/**
 * Append one record and return the written line. Read-then-append is not atomic, so the
 * whole sequence runs under a cross-process lock: without it a burst of concurrent gates
 * all read the same tail, all write prev pointing at it, and the chain is broken from then
 * on -- permanently, because later records only append past the break.
 * Throws when the ledger is unreadable or the lock cannot be taken. Both are refusals to
 * write, on purpose: appending onto a tail that cannot be read produces a broken chain, and
 * a broken chain is unrecoverable by design.
 */
function appendLedger(record) {
  fs.mkdirSync(stateDir(), { recursive: true });
  return withDirLock(ledgerLockPath(), () => {
    const state = readLedgerState();
    if (state.unreadable) {
      throw new Error('ledger is present but unreadable (' + state.unreadable
        + '); appending onto a tail nobody can read would break the chain');
    }
    const file = ledgerFilePath();
    const last = state.entries.length ? state.entries[state.entries.length - 1] : null;
    const prev = (last && typeof last.chain === 'string') ? last.chain : GENESIS;
    const line = ledgerLine(record, prev);
    if (!endsWithNewline(file)) fs.appendFileSync(file, '\n', 'utf8');
    fs.appendFileSync(file, JSON.stringify(line) + '\n', 'utf8');
    return line;
  });
}

/**
 * Recompute the whole chain and name every break. Pure + injectable so selftest can feed
 * a forged history without touching disk.
 * Break kinds: unparseable-line / content-hash-mismatch / chain-predecessor-mismatch /
 * chain-hash-mismatch. Line numbers are 1-based, because that is how a person counts them
 * when they open the file.
 * @param {Array<Object>} entries
 * @returns {{ok:boolean,entries:number,breaks:Array,head:string}}
 */
function verifyLedgerChain(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const breaks = [];
  let prev = GENESIS;
  list.forEach((e, i) => {
    const line = i + 1;
    if (!e || typeof e !== 'object' || e.corrupt) {
      breaks.push({ line, reason: 'unparseable-line', at: null });
      return;
    }
    const { contentHash, prev: recordedPrev, chain, ...rest } = e;
    const at = typeof e.at === 'string' ? e.at : null;
    if (sha256Lf(JSON.stringify(rest)) !== contentHash) {
      breaks.push({ line, reason: 'content-hash-mismatch', at });
    }
    if (recordedPrev !== prev) {
      breaks.push({ line, reason: 'chain-predecessor-mismatch', at });
    }
    if (chainHash(prev, contentHash) !== chain) {
      breaks.push({ line, reason: 'chain-hash-mismatch', at });
    }
    prev = typeof chain === 'string' ? chain : prev;
  });
  return { ok: breaks.length === 0, entries: list.length, breaks, head: prev };
}

/**
 * Re-read every evidence log the ledger points at and compare it with the digest recorded
 * beside it. A hash that is written and never read is decoration: without this, the log a
 * green rests on can be rewritten or deleted and every command still reports success.
 * The reader is injectable so selftest can exercise the comparison without a repository.
 * @param {Array<Object>} entries
 * @param {{readFile?:(rel:string)=>string}} [opts]
 * @returns {{ok:boolean,checked:number,breaks:Array}}
 */
function evidenceFindings(entries, { readFile } = {}) {
  const read = typeof readFile === 'function'
    ? readFile
    : (rel) => fs.readFileSync(path.join(projectRoot(), rel), 'utf8');
  const breaks = [];
  let checked = 0;
  (entries || []).forEach((e, i) => {
    if (!e || e.corrupt || e.command !== 'gate') return;
    for (const r of (e.results || [])) {
      if (!r || typeof r.evidence !== 'string' || !r.evidence) continue;
      if (typeof r.evidenceSha256 !== 'string' || !r.evidenceSha256) continue;
      checked++;
      const at = { line: i + 1, check: r.id === undefined ? null : r.id, evidence: r.evidence };
      let content;
      try {
        content = read(r.evidence);
      } catch (err) {
        // The code, never the message: an fs error message carries an absolute path, and
        // that would put the machine's directory layout into a record other tools read.
        breaks.push({ ...at, reason: 'evidence-missing', detail: String((err && err.code) || 'read-error') });
        continue;
      }
      if (sha256Lf(content) !== r.evidenceSha256) {
        breaks.push({ ...at, reason: 'evidence-tampered', detail: sha256Lf(content).slice(0, 12) });
      }
    }
  });
  return { ok: breaks.length === 0, checked, breaks };
}

/**
 * The `ledger` verdict, separated from the process exit so the exit code itself is testable.
 * Three outcomes: unreadable is degraded (3) because an unknown chain is not an intact one,
 * any break is a failure (1), otherwise 0. `evidence: null` means the digests were not
 * checked this run, which stays distinguishable from having checked and found nothing.
 * Pure.
 * @returns {{result:Object,code:number}}
 */
function ledgerReport({ entries = [], unreadable = null, evidence = null, path: file = '' } = {}) {
  if (unreadable) {
    return {
      result: {
        ok: false, entries: null, breaks: [], head: null,
        unreadable, evidence: null, path: file,
      },
      code: 3,
    };
  }
  const chain = verifyLedgerChain(entries);
  const ok = chain.ok && (evidence === null || evidence.ok);
  return {
    result: {
      ok, entries: chain.entries, breaks: chain.breaks, head: chain.head, unreadable: null,
      evidence: evidence === null ? null : { checked: evidence.checked, breaks: evidence.breaks },
      path: file,
    },
    code: ok ? 0 : 1,
  };
}

/**
 * `ledger` subcommand: recompute the chain, re-verify the evidence digests, report every
 * break. Digest verification is on by default -- a check that has to be switched on is a
 * check nobody runs -- and `--no-verify-evidence` turns it off for a ledger large enough
 * that re-reading every log costs real time.
 * There is no repair mode, and that is the design: a command that rewrites the chain into
 * agreement is a forgery tool.
 */
function cmdLedger(flags = {}) {
  const state = readLedgerState();
  const skipEvidence = flags['no-verify-evidence'] === true || flags['no-verify-evidence'] === 'true';
  const evidence = (state.unreadable || skipEvidence) ? null : evidenceFindings(state.entries);
  const { result, code } = ledgerReport({ ...state, evidence, path: relFromRoot(ledgerFilePath()) });
  const where = relFromRoot(ledgerFilePath());
  if (state.unreadable) {
    process.stderr.write('ledger at ' + where + ' exists but could not be read (' + state.unreadable + ')\n');
    process.stderr.write('an unreadable ledger is not an intact one: nothing recorded in it can be checked, '
      + 'so treat every earlier verification as unproven until the file is readable again\n');
  } else if (!result.ok) {
    const total = result.breaks.length + (evidence ? evidence.breaks.length : 0);
    process.stderr.write('ledger integrity broken (' + total + ' break(s)) at ' + where + '\n');
    for (const b of result.breaks.slice(0, 10)) {
      process.stderr.write('  line ' + b.line + ': ' + b.reason + (b.at ? ' (' + b.at + ')' : '') + '\n');
    }
    if (result.breaks.length > 10) process.stderr.write('  ... ' + (result.breaks.length - 10) + ' more chain break(s)\n');
    for (const b of (evidence ? evidence.breaks.slice(0, 10) : [])) {
      process.stderr.write('  line ' + b.line + ': ' + b.reason + ' for check ' + b.check + ' (' + b.evidence + ')\n');
    }
    process.stderr.write('every verification recorded here is unproven; do not hand-repair the file\n');
  }
  return emit(result, code);
}

// ---------------------------------------------------------------------------
// S17.3 gate  (verify + evidence on disk + planHash + one ledger entry)
// ---------------------------------------------------------------------------

/**
 * The resolved verification plan for a set of affected modules: which check ids will run,
 * and for which modules. Sorted by check id with module lists sorted too, so planHash is a
 * function of the plan and not of catalog key order.
 * @returns {{entries:Array<{checkId:string,modules:string[]}>,hash:string,empty:boolean}}
 */
function buildPlan(affected, catalog) {
  const byId = new Map(((catalog && catalog.modules) || []).map(m => [m.id, m]));
  const planned = new Map();
  for (const id of (affected || [])) {
    const m = byId.get(id);
    if (!m) continue;
    for (const ref of requiredChecks(m.riskTier, m, catalog)) {
      const spec = resolveCheck(ref, catalog);
      const checkId = String(spec.id || spec.command || ref);
      if (!planned.has(checkId)) planned.set(checkId, { checkId, modules: [] });
      const entry = planned.get(checkId);
      if (!entry.modules.includes(id)) entry.modules.push(id);
    }
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const entries = [...planned.values()]
    .map(e => ({ checkId: e.checkId, modules: e.modules.slice().sort(cmp) }))
    .sort((a, b) => cmp(a.checkId, b.checkId));
  return {
    entries,
    hash: sha256Lf(JSON.stringify(entries.map(e => [e.checkId, e.modules]))),
    empty: entries.length === 0,
  };
}

// A check id can legitimately run once per affected module, and four of those land in the
// same millisecond, so the epoch alone is not a unique name. The next suffix is claimed by
// creating the file exclusively rather than by testing whether it exists: two gates running
// at once both pass an existsSync test on the same name, and the loser's log is then
// overwritten by the winner -- which, now that the digests are actually re-read, would
// surface as evidence-tampered on a file nobody tampered with. A false alarm in an integrity
// check is how the check ends up switched off.
function evidenceFilePath(id) {
  const safeId = String(id == null ? '' : id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'check';
  const base = path.join(evidenceDir(), safeId + '-' + Date.now());
  fs.mkdirSync(evidenceDir(), { recursive: true });
  for (let n = 0; ; n++) {
    const file = n === 0 ? base + '.log' : base + '-' + n + '.log';
    try {
      fs.closeSync(fs.openSync(file, 'wx'));
      return file;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
    }
  }
}

/**
 * The gate's check runner: the same four-state decision as verify (runCheck is reused
 * verbatim, not reimplemented) plus the raw output written to .claude/harness/evidence/.
 * Checks that never ran -- BLOCKED for a missing binary, SKIPPED by fast-mode -- get no
 * evidence file, because an empty log reads exactly like a command that ran and said
 * nothing, and those two states must stay distinguishable.
 */
function runCheckWithEvidence(spec, opts) {
  const started = Date.now();
  const res = runCheck(spec, { ...opts, capture: true });
  const durationMs = Date.now() - started;
  const { stdout, stderr, ...rest } = res;
  const out = { ...rest, durationMs };
  if (res.state !== 'PASS' && res.state !== 'FAIL') {
    return { ...out, evidence: null, evidenceSha256: null };
  }
  const output = String(stdout || '') + (stderr ? '\n--- stderr ---\n' + String(stderr) : '');
  try {
    const file = evidenceFilePath(res.id);
    writeAtomic(file, output);
    return { ...out, evidence: relFromRoot(file), evidenceSha256: sha256Lf(output) };
  } catch (e) {
    // The check itself already produced its verdict; failing to persist the log must be
    // visible in the record rather than swallowed, and must not rewrite that verdict.
    return { ...out, evidence: null, evidenceSha256: null, evidenceError: String(e && e.message || e) };
  }
}

/** Human-readable why behind a gate state. Pure. */
function gateReason(gate, run) {
  if (gate === 'FAIL') return 'at-least-one-check-failed';
  if (gate === 'BLOCKED') {
    return run.emptyPlan
      ? 'empty-plan: modules were affected but no check resolved, so nothing was established'
      : 'at-least-one-check-blocked';
  }
  if (gate === 'BLOCKED_BY_ATTRIBUTES') {
    return run.attributeGaps.length + ' blocking quality-attribute gap(s): checks that prove '
      + 'nothing about a critical/high attribute do not close the gate';
  }
  if (!run.checks.length) return 'no-affected-module';
  if (run.checks.every(c => c.state === 'SKIPPED')) return 'every-check-skipped';
  return 'all-executed-checks-passed';
}

/**
 * What happened to a check between the runner and the record. The four-state result the
 * runner produced is the fact; the state the record carries may be a rewrite of it, and the
 * two have to stay distinguishable or "a waiver suppressed this failure" and "this check
 * never ran" collapse into the same number.
 * `from` names an earlier verdict when one exists, and nothing produces one any more: a
 * waiver is resolved before the check runs, so an excused check has no verdict to replace,
 * the same as a fast-mode skip. It stays in the shape because ledger records written while
 * waivers still rewrote executed results carry it, and the readers below have to keep
 * counting those correctly -- an old suppressed FAIL really did run and really did fail.
 * Pure.
 * @param {Object} recorded   the check result as verifyPlan returned it
 * @param {Object|null} raw   an earlier verdict for the same check, or null when none exists
 * @returns {{by:string,scope:string|null,from:string|null}|null}
 */
function suppressionOf(recorded, raw) {
  const reason = (recorded && typeof recorded.reason === 'string') ? recorded.reason : '';
  if (reason.startsWith('waiver:')) {
    return {
      by: 'waiver',
      scope: reason.slice('waiver:'.length),
      from: (raw && typeof raw.state === 'string') ? raw.state : null,
    };
  }
  if (reason === 'fast-mode') return { by: 'fast-mode', scope: null, from: null };
  return null;
}

/** Which waivers actually fired, with the file that granted them. */
function waiversApplied(checks, waivers) {
  const out = [];
  for (const c of (checks || [])) {
    if (typeof c.reason !== 'string' || !c.reason.startsWith('waiver:')) continue;
    const scope = c.reason.slice('waiver:'.length);
    const w = (waivers || []).find(x => x && x.scope === scope) || null;
    out.push({
      check: c.id,
      scope,
      waiver: (w && w._path) ? relFromRoot(w._path) : null,
      expiry: (w && typeof w.expiry === 'string') ? w.expiry : null,
    });
  }
  return out;
}

/**
 * `gate` subcommand. Exit convention is verify's, unchanged:
 *   PASS -> 0; FAIL / BLOCKED / blocking attribute gap -> 2; no catalog or non-git -> 3.
 * Note one inherited semantic: cc-base's verifyPlan aggregates an all-SKIPPED run to PASS
 * (fast-mode and waivers do not block), so the gate reports every-check-skipped as the
 * reason while still exiting 0. That debt is surfaced by `risk` (FAST_MODE_DEBT), which is
 * where a deferred-evidence problem belongs -- not silently inside a green.
 */
function cmdGate(flags) {
  const loaded = loadCatalogFlag(flags);
  if (!loaded.ok) {
    return emit({
      gate: 'DEGRADED', degraded: true, reason: loaded.error, detail: loaded.detail,
      modules: [], results: [],
    }, 3);
  }
  const catalog = loaded.catalog;

  // Where the scope came from is part of the record, because a gate over a scope the caller
  // chose answers a different question than a gate over the real change surface -- and the
  // diffHash beside it is a true fingerprint of the whole tree either way, so without this
  // field the two are indistinguishable afterwards. --changed stays supported: verifying a
  // subset on purpose is a legitimate thing to want. What it may no longer do is close a
  // task (see completeBlockers).
  let changed;
  let nonGit = false;
  let scopeSource = 'computed';
  let scopeRequested = null;
  if (typeof flags.changed === 'string') {
    changed = parseCsv(flags.changed);
    scopeSource = 'caller';
    scopeRequested = changed.slice(0, 50);
  } else {
    const cp = changedPaths();
    if (Array.isArray(cp)) { changed = cp; }
    else { changed = cp.paths; nonGit = !!cp.nonGit; }
  }
  if (nonGit) {
    return emit({ gate: 'DEGRADED', degraded: true, reason: 'non-git', modules: [], results: [] }, 3);
  }

  const fastActive = fastModeActive();
  const imp = analyzeImpact(changed, catalog, { nonGit });
  const plan = buildPlan(imp.affected, catalog);
  // What verifyPlan hands back is what the runner produced: waivers are resolved before a
  // command starts, so no result here is a rewrite of an earlier one and there is no second
  // set of verdicts to carry alongside these. An excused check never reached the runner at
  // all, which is why its record has no exit code, no duration and no evidence file.
  const run = verifyPlan(changed, catalog, { fastActive, nonGit, runCheckFn: runCheckWithEvidence });

  const attrBlocked = Array.isArray(run.attributeGaps) && run.attributeGaps.length > 0;
  const gate = (run.state === 'FAIL' || run.state === 'BLOCKED') ? run.state
    : attrBlocked ? 'BLOCKED_BY_ATTRIBUTES' : 'PASS';
  // The record already writes "every-check-skipped" into its reason and then exits 0 beside
  // it. The record being right does not help a caller that only reads the code, and reading
  // 0 there is reading "verified" off a run that executed nothing. Same 3 as `verify`.
  const everySkipped = run.checks.length > 0 && run.checks.every(c => c.state === 'SKIPPED');
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const record = {
    command: 'gate',
    at: new Date().toISOString(),
    gate,
    reason: gateReason(gate, run),
    baseCommit: headCommit(),
    diffHash: gitFingerprint(),
    planHash: plan.hash,
    scopeSource,
    scopeRequested,
    modules: run.affected.slice().sort(cmp),
    degraded: !!run.degraded,
    fastActive,
    skippedByFastMode: run.checks.filter(c => c.reason === 'fast-mode').map(c => c.id),
    results: run.checks.map(c => ({
      id: c.id,
      module: c.module === undefined ? null : c.module,
      state: c.state,
      reason: c.reason === undefined ? null : c.reason,
      exit: c.exit === undefined ? null : c.exit,
      durationMs: c.durationMs === undefined ? null : c.durationMs,
      evidence: c.evidence === undefined ? null : c.evidence,
      evidenceSha256: c.evidenceSha256 === undefined ? null : c.evidenceSha256,
      suppressed: suppressionOf(c, null),
    })),
    attributeCoverage: run.attributes,
    attributeGaps: run.attributeGaps,
    waivers: waiversApplied(run.checks, loadWaivers()),
  };
  let line = null;
  let ledgerError = null;
  try {
    line = appendLedger(record);
  } catch (e) {
    ledgerError = String((e && e.message) || e);
  }
  if (ledgerError) {
    // The checks ran; what failed is recording them. A PASS that left no record is not
    // evidence and must not read like one, so it degrades (3) instead of reporting 0 --
    // while a FAIL still blocks (2), because rc 3 is the code callers skip on.
    process.stderr.write('gate ran but could not append its record to the ledger: ' + ledgerError + '\n');
    process.stderr.write('an unrecorded verification is not evidence; nothing downstream may treat this run as proof\n');
    return emit({ ...record, ledger: { path: relFromRoot(ledgerFilePath()), chain: null, error: ledgerError } },
      gate === 'PASS' ? 3 : 2);
  }
  return emit({ ...record, ledger: { path: relFromRoot(ledgerFilePath()), chain: line.chain, error: null } },
    gate === 'PASS' ? (everySkipped ? 3 : 0) : 2);
}

// ---------------------------------------------------------------------------
// S17.4 gate-audit  (a control that has never intervened is cost plus false confidence)
// ---------------------------------------------------------------------------
// Scope note: this audits CATALOG CHECKS against the harness ledger. The framework also
// ships .claude/scripts/gate-audit.sh, which audits HOOK gates against
// .claude/evidence/gate-block.log. Different subjects, different evidence files, neither
// replaces the other -- and neither should be merged into the other, or the answer to
// "which gate never fired" would quietly cover only half the gates.

/**
 * Pure: fold a ledger into per-check execution/intervention history.
 * A record carrying `suppressed.from` was written while waivers still rewrote executed
 * verdicts: that check ran and caught something, and it is counted by what it did rather
 * than by what the record was rewritten to say. Records written since carry no `from`,
 * because the waiver stopped the check from running at all -- so it genuinely never
 * executed and says so. Either way it lands in suppressed[] as well, which is what keeps
 * an excused check out of the same bucket as one nobody ever wired up before the advice
 * tells the reader both are probably "genuinely stable".
 */
function auditGates(entries, catalog) {
  const declared = Object.keys((catalog && catalog.checks) || {});
  const executed = new Set();
  const intervened = new Set();
  const suppressed = new Map();
  let gateRuns = 0;
  for (const e of (entries || [])) {
    if (!e || e.corrupt || e.command !== 'gate') continue;
    gateRuns++;
    for (const r of (e.results || [])) {
      const supp = (r && r.suppressed) ? r.suppressed : null;
      const state = (supp && supp.from) ? supp.from : r.state;
      if (state === 'PASS' || state === 'FAIL') executed.add(r.id);
      if (state === 'FAIL' || state === 'BLOCKED') intervened.add(r.id);
      if (!supp) continue;
      if (!suppressed.has(r.id)) suppressed.set(r.id, { check: r.id, occurrences: 0, by: new Set(), suppressedStates: new Set() });
      const bucket = suppressed.get(r.id);
      bucket.occurrences++;
      bucket.by.add(supp.by);
      if (supp.from) bucket.suppressedStates.add(supp.from);
    }
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const neverIntervened = declared.filter(id => !intervened.has(id)).sort(cmp);
  const neverExecuted = declared.filter(id => !executed.has(id)).sort(cmp);
  const suppressedList = [...suppressed.values()]
    .map(b => ({ check: b.check, occurrences: b.occurrences, by: [...b.by].sort(cmp), suppressedStates: [...b.suppressedStates].sort(cmp) }))
    .sort((a, b) => cmp(a.check, b.check));
  const advice = neverIntervened.length
    ? 'These checks have never failed or blocked. Either they are genuinely stable, or they never actually run. '
      + 'Confirm with evidence before keeping them -- a gate that has caught nothing is cost plus false confidence.'
    : 'Every declared check has intervened at least once.';
  return {
    scope: 'catalog checks in the harness ledger (hook gates are audited by .claude/scripts/gate-audit.sh)',
    gateRuns,
    declaredChecks: declared.length,
    neverIntervened,
    neverExecuted,
    suppressed: suppressedList,
    advice: suppressedList.length
      ? advice + ' Separately, ' + suppressedList.length + ' check(s) were suppressed rather than silent: see suppressed[].'
      : advice,
  };
}

/**
 * `gate-audit` subcommand: report only, exit 0 (no catalog -> 3, unreadable ledger -> 3).
 * An unreadable ledger cannot answer "which gate never caught anything", and answering it
 * from an empty list would report every check as never-executed -- a confident wrong answer.
 */
function cmdGateAudit(flags) {
  const loaded = loadCatalogFlag(flags);
  if (!loaded.ok) {
    return emit({ ok: false, degraded: true, error: loaded.error, detail: loaded.detail }, 3);
  }
  const state = readLedgerState();
  if (state.unreadable) {
    process.stderr.write('gate-audit cannot read the ledger (' + state.unreadable
      + '); with no history there is nothing to audit, and an empty history would read as "no check ever ran"\n');
    return emit({ ok: false, degraded: true, error: 'ledger-unreadable', detail: state.unreadable }, 3);
  }
  return emit({ ok: true, ...auditGates(state.entries, loaded.catalog) }, 0);
}

// ---------------------------------------------------------------------------
// S17.5 retention  (privacy includes disposal; runtime state must not only accumulate)
// ---------------------------------------------------------------------------

/**
 * Which files a sweep would remove, newest first: the `keep` newest survive on count,
 * anything older than the cutoff goes, and a file the ledger references is never a
 * candidate -- deleting it would destroy the only proof behind a recorded green.
 * Pure + injectable.
 * @param {Array<{path:string,mtimeMs:number}>} files
 * @param {{protectedPaths?:Set<string>,keep?:number,cutoffMs?:number}} [opts]
 */
function planRetention(files, { protectedPaths = new Set(), keep = 0, cutoffMs = 0 } = {}) {
  const sorted = (files || []).slice().sort((a, b) => (b.mtimeMs - a.mtimeMs)
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const out = [];
  sorted.forEach((f, i) => {
    if (protectedPaths.has(f.path)) return;
    const overCount = i >= keep;
    const overAge = f.mtimeMs < cutoffMs;
    if (!overCount && !overAge) return;
    out.push({ path: f.path, reason: overCount ? 'over-count' : 'over-age' });
  });
  return out;
}

/** Every evidence path any ledger record points at. These are never sweep candidates. */
function ledgerReferencedEvidence(entries) {
  const out = new Set();
  for (const e of (entries || [])) {
    if (!e || e.corrupt) continue;
    for (const r of (e.results || [])) {
      if (r && typeof r.evidence === 'string' && r.evidence) out.add(r.evidence);
    }
  }
  return out;
}

/** Files directly inside a directory, as {path (project-relative), mtimeMs}. */
function listDirFiles(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch (_e) { return []; }
  const out = [];
  for (const n of names.sort()) {
    const abs = path.join(dir, n);
    try {
      const st = fs.statSync(abs);
      if (st.isFile()) out.push({ path: relFromRoot(abs), mtimeMs: st.mtimeMs });
    } catch (_e) { /* vanished between readdir and stat; nothing to prune */ }
  }
  return out;
}

function intFlag(v, dflt) {
  if (typeof v !== 'string') return dflt;
  const n = parseInt(v, 10);
  return (Number.isNaN(n) || n < 0) ? dflt : n;
}

/**
 * Whether a sweep is allowed to run at all. The protected set is derived from the ledger,
 * so a ledger that cannot be read or does not verify makes that set unknown -- and an
 * unknown protected set treated as an empty one is exactly how a pruning tool deletes the
 * only proof behind a recorded green. Pure.
 * @returns {{reason:string,detail:string}|null}
 */
function retentionRefusal(unreadable, chain) {
  if (unreadable) return { reason: 'ledger-unreadable', detail: unreadable };
  if (chain && !chain.ok) {
    const first = chain.breaks[0];
    return {
      reason: 'ledger-chain-broken',
      detail: chain.breaks.length + ' break(s), first at line ' + first.line + ': ' + first.reason,
    };
  }
  return null;
}

/**
 * `retention` subcommand: prune evidence logs and context packs by age and count.
 * Dry-run by default -- it reports what it would remove and removes nothing until --apply,
 * because a pruning tool that deletes on the first accidental invocation is worse than the
 * pile it cleans. The chain is verified first and a bad one stops the sweep in both modes:
 * with the protected set unknown even the dry-run plan would be wrong, and a plan that
 * names protected files is what the next --apply acts on.
 * Exit 0, 1 if --apply could not remove something it planned to, 3 if the ledger could not
 * establish what is protected.
 */
function cmdRetention(flags) {
  const apply = flags.apply === true || flags.apply === 'true';
  const maxAgeDays = intFlag(flags['max-age-days'], 30);
  const maxEvidence = intFlag(flags['max-evidence'], 400);
  const maxPacks = intFlag(flags['max-packs'], 60);
  const cutoffMs = Date.now() - maxAgeDays * 86400000;
  const limits = { maxAgeDays, maxEvidence, maxPacks };
  const dirs = {
    evidence: relFromRoot(evidenceDir()),
    // context-pack currently streams to stdout rather than writing packs to disk, so this
    // sweep is a no-op until packs land here. Wired now so the disposal rule does not have
    // to be remembered later.
    contextPacks: relFromRoot(contextPackDir()),
  };

  const state = readLedgerState();
  const refused = retentionRefusal(state.unreadable, state.unreadable ? null : verifyLedgerChain(state.entries));
  if (refused) {
    process.stderr.write('retention refused to sweep: ' + refused.reason + ' (' + refused.detail + ')\n');
    process.stderr.write('the set of files the ledger protects cannot be established, and an unknown '
      + 'protected set is not an empty one; nothing was removed\n');
    return emit({
      ok: false, applied: apply, refused, candidates: 0, removed: 0, protectedByLedger: null,
      limits, dirs, plan: [], errors: [],
    }, 3);
  }
  const protectedPaths = ledgerReferencedEvidence(state.entries);

  const plan = [
    ...planRetention(listDirFiles(evidenceDir()), { protectedPaths, keep: maxEvidence, cutoffMs }),
    ...planRetention(listDirFiles(contextPackDir()), { protectedPaths, keep: maxPacks, cutoffMs }),
  ];

  let removed = 0;
  const errors = [];
  if (apply) {
    for (const item of plan) {
      try { fs.unlinkSync(path.join(projectRoot(), item.path)); removed++; }
      catch (e) { errors.push({ path: item.path, error: String(e && e.message || e) }); }
    }
    for (const err of errors) process.stderr.write('retention could not remove ' + err.path + ': ' + err.error + '\n');
  }
  return emit({
    ok: errors.length === 0,
    applied: apply,
    refused: null,
    candidates: plan.length,
    removed,
    protectedByLedger: protectedPaths.size,
    limits,
    dirs,
    plan: plan.slice(0, 100),
    errors,
  }, errors.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// S17.6 risk  (state decay: the things that rot while nobody is looking at them)
// ---------------------------------------------------------------------------

/** Waiver files as written on disk -- including expired ones, which loadWaivers drops. */
function readWaiverFiles() {
  const dir = waiversDir();
  let names;
  try { names = fs.readdirSync(dir); } catch (_e) { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.json')) continue;
    const fp = path.join(dir, n);
    const obj = readJsonFile(fp, null);
    if (obj && typeof obj === 'object') out.push({ ...obj, _path: fp });
  }
  return out;
}

// The governance surface: the files that decide how everything else gets judged. A change to
// a hook, a skill, an agent, the harness itself, the rules or CI is a change to the judge
// rather than to the code, and it is the one class of change the gates cannot catch, because
// the thing being edited is the thing doing the catching. Naming it is not a verdict -- it is
// a warning that this diff wants the strictest review the repository has, which is a call for
// a person to make.
// Findings are named, not summarised, but a warning that prints two hundred paths is a wall
// nobody reads. The count beside the list is never capped.
const GOVERNANCE_LIST_CAP = 20;

/**
 * Which changed paths are governance surface. Runtime state is dropped first: the gate writes
 * its own ledger and evidence logs under .claude/harness/, and changedPaths() does not filter
 * those (the filtering lives on the fingerprint side, in canonicalDiff / isStateExcluded), so
 * without this line the warning would light up permanently the moment anybody ran a gate --
 * and a warning that is always on is a warning nobody reads twice.
 * The path list is profile.raise.paths, the same table the tier dial raises on: this warning
 * and the automatic raise to strict are two readings of one question ("is this diff editing
 * the judge"), and two hand-maintained copies of that answer drift the day somebody adds a
 * directory to one of them. Injectable so selftest can state the table it is asserting about.
 * @param {string[]} changed
 * @param {string[]} [globs]
 * @returns {string[]}
 */
function governanceSurface(changed, globs = governancePaths()) {
  const out = [];
  for (const p of (changed || [])) {
    const rel = toPosixPath(p);
    if (isStateExcluded(rel)) continue;
    if (matchAny(rel, globs)) out.push(rel);
  }
  return out.sort();
}

/**
 * Decay scan over injected state (pure, so selftest can construct each finding without a
 * repository). Error severity closes the exit code; warnings are reported and do not.
 * @param {{ledgerEntries?:Array,ledgerUnreadable?:string|null,evidenceBreaks?:Array,
 *          catalog?:Object|null,waivers?:Array,task?:Object|null,changed?:string[],
 *          quarantine?:{count:number,files?:number,lastPath?:string|null,lastKind?:string|null,
 *                       unreadable?:{path:string,detail:string}|null}|null,
 *          fastActive?:boolean,now?:number}} [input]
 */
function riskFindings({ ledgerEntries = [], ledgerUnreadable = null, evidenceBreaks = [],
  catalog = null, waivers = [], task = null, changed = [], quarantine = null,
  fastActive = false, now = Date.now() } = {}) {
  const findings = [];

  if (ledgerUnreadable) {
    findings.push({
      severity: 'error', code: 'LEDGER_UNREADABLE',
      message: 'the verification ledger exists but could not be read (' + ledgerUnreadable
        + '); nothing recorded in it can be checked, and an unreadable ledger is not an intact one',
    });
  }

  for (const b of (evidenceBreaks || [])) {
    findings.push({
      severity: 'error',
      code: b.reason === 'evidence-missing' ? 'EVIDENCE_MISSING' : 'EVIDENCE_TAMPERED',
      check: b.check === undefined ? null : b.check,
      message: 'the evidence log for check "' + b.check + '" (' + b.evidence + ') '
        + (b.reason === 'evidence-missing'
          ? 'is gone, so the recorded digest proves nothing about a file nobody can read'
          : 'no longer matches the digest recorded beside it, so its verdict rests on output that has since changed'),
    });
  }

  const chain = verifyLedgerChain(ledgerEntries);
  if (!chain.ok) {
    findings.push({
      severity: 'error', code: 'LEDGER_BROKEN',
      message: 'the verification ledger chain is broken (' + chain.breaks.length
        + ' break(s), first at line ' + chain.breaks[0].line + ': ' + chain.breaks[0].reason
        + '); treat every recorded green as unproven and re-run the gates',
    });
  }

  // Warning, not error: every one of these was already refused where it mattered, and an
  // exit code here would only teach people to stop running risk. It still has to be visible
  // -- a damaged artefact only the command that tripped over it ever saw reaches nobody, and
  // one bad file and forty are different situations.
  if (quarantine && quarantine.unreadable) {
    findings.push({
      severity: 'warning', code: 'QUARANTINE_UNREADABLE', path: quarantine.unreadable.path,
      detail: quarantine.unreadable.detail,
      message: quarantine.unreadable.path + ' exists and cannot be read (' + quarantine.unreadable.detail
        + '), so however many damaged artefacts were recorded in it, none of them are being reported '
        + 'here; read or repair that file before trusting a quiet risk report',
    });
  }
  if (quarantine && quarantine.count > 0) {
    findings.push({
      severity: 'warning', code: 'QUARANTINED_STATE', count: quarantine.count,
      files: quarantine.files, path: quarantine.lastPath || null,
      // Detections, not files: the same damaged file is recorded again every time another
      // command trips over it, and that repetition is the signal that nobody has fixed it.
      // Both numbers go in, because "40 entries" and "40 broken files" are different news.
      message: quarantine.count + ' corruption detection(s) across ' + quarantine.files
        + ' file(s) are recorded in ' + relFromRoot(quarantineFilePath()) + ', most recently '
        + (quarantine.lastKind ? quarantine.lastKind + ' ' : '') + (quarantine.lastPath || 'an unnamed file')
        + '; each was refused where it mattered and left on disk as evidence -- read it, then repair or delete it',
    });
  }

  for (const w of waivers) {
    const expiryMs = Date.parse(w && w.expiry);
    if (!Number.isNaN(expiryMs) && expiryMs <= now) {
      findings.push({
        severity: 'error', code: 'EXPIRED_WAIVER',
        message: 'waiver ' + (w._path ? relFromRoot(w._path) : (w.scope || 'unknown'))
          + ' expired on ' + w.expiry + ' and is now inert; delete it or renew it with a fresh justification',
      });
    }
  }

  if (catalog) {
    for (const m of (catalog.modules || [])) {
      for (const [attr, req] of Object.entries(m.attributes || {})) {
        const { tier } = normalizeTier(req);
        if (TIER_ENFORCEMENT[tier] !== 'block') continue;
        if (claimingChecks(m, catalog, attr).length > 0) continue;
        findings.push({
          severity: 'error', code: 'UNWIRED_ATTRIBUTE', module: m.id, attribute: attr, tier,
          message: 'module "' + m.id + '" declares ' + attr + ' at tier ' + tier
            + ' but no check in its verification plan claims that attribute',
        });
      }
    }
  }

  // Consecutive failures per check over the recent ledger. A PASS resets the streak; a
  // BLOCKED or SKIPPED result establishes nothing either way and leaves it alone. A failure
  // an older record shows a waiver rewriting to SKIPPED still counts: the check failed, the
  // waiver decided to carry it, and a streak that stops being counted the moment it is
  // waived is a streak that can run forever without anyone hearing about it. A waiver now
  // stops the check before it runs, so it produces no failures to count -- and the silence
  // that leaves behind is exactly what SUPPRESSED_FAILURE below is there to break.
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const streak = new Map();
  const suppressedFails = new Map();
  for (const e of ledgerEntries.slice(-30)) {
    if (!e || e.corrupt || e.command !== 'gate') continue;
    for (const r of (e.results || [])) {
      const supp = (r && r.suppressed) ? r.suppressed : null;
      const state = (supp && supp.from) ? supp.from : r.state;
      if (state === 'FAIL') streak.set(r.id, (streak.get(r.id) || 0) + 1);
      else if (state === 'PASS') streak.set(r.id, 0);
      // Every waiver hit, not only the ones that replaced a verdict. Keying this on `from`
      // was keying it on the rewrite, and once the rewrite is gone that reads every waiver
      // in the tree as nothing happening -- the finding would go quiet exactly when the
      // waivers are working.
      if (supp && supp.by === 'waiver') {
        const b = suppressedFails.get(r.id) || { occurrences: 0, executed: 0 };
        b.occurrences++;
        if (supp.from === 'FAIL' || supp.from === 'BLOCKED') b.executed++;
        suppressedFails.set(r.id, b);
      }
    }
  }
  const streakIds = [...streak.keys()].sort(cmp);
  for (const id of streakIds) {
    const n = streak.get(id);
    if (n < 3) continue;
    findings.push({
      severity: 'warning', code: 'FAIL_STREAK', check: id,
      message: 'check "' + id + '" failed ' + n + ' times in a row; stop re-running it and go find the root cause',
    });
  }
  // Warning, not error: a waiver is a signed, expiring, compensated decision, and making it
  // fail the exit code would only teach people to stop filing them. It still has to be
  // visible -- suppression is a state, not the absence of one.
  for (const id of [...suppressedFails.keys()].sort(cmp)) {
    const b = suppressedFails.get(id);
    findings.push({
      severity: 'warning', code: 'SUPPRESSED_FAILURE', check: id, occurrences: b.occurrences,
      message: b.executed > 0
        ? 'check "' + id + '" failed or blocked ' + b.executed + ' time(s) in the recent ledger and a waiver '
          + 'rewrote each one to SKIPPED; that failure is deferred, not absent, and the waiver expires'
        : 'check "' + id + '" was excused by a waiver ' + b.occurrences + ' time(s) in the recent ledger and '
          + 'never ran; nobody knows whether it would pass, and the waiver expires',
    });
  }

  const gates = ledgerEntries.filter(e => e && !e.corrupt && e.command === 'gate');
  const latestGate = gates.length ? gates[gates.length - 1] : null;
  if (latestGate && latestGate.fastActive && (latestGate.skippedByFastMode || []).length) {
    findings.push({
      severity: 'error', code: 'FAST_MODE_DEBT',
      message: 'the newest gate ran under Fast Mode and skipped ['
        + latestGate.skippedByFastMode.join(', ') + ']; that evidence was deferred, not waived -- '
        + 'turn Fast Mode off and run a full gate before treating the work as verified',
    });
  }
  if (fastActive) {
    findings.push({
      severity: 'warning', code: 'FAST_MODE_OPEN',
      message: 'Fast Mode is open; evidence is being deferred, and the window closes on its own expiry, not on the work being done',
    });
  }

  const governance = governanceSurface(changed);
  if (governance.length) {
    findings.push({
      severity: 'warning', code: 'GOVERNANCE_SURFACE_CHANGED', count: governance.length,
      files: governance.slice(0, GOVERNANCE_LIST_CAP),
      message: 'this change edits ' + governance.length + ' file(s) of the governance surface '
        + '(hooks, harness, skills, agents, rules, CLAUDE.md, CI) -- the judge rather than the '
        + 'judged; review it at the strictest tier this repository has, because a gate cannot '
        + 'catch a change to itself',
    });
  }

  if (task && task.state === 'active') {
    const startedMs = Date.parse(task.startedAt);
    if (!Number.isNaN(startedMs)) {
      const ageH = Math.round((now - startedMs) / 3600000);
      if (ageH > 72) {
        findings.push({
          severity: 'warning', code: 'STALE_TASK', task: task.id || null,
          message: 'task "' + (task.id || 'unknown') + '" has been active for ' + ageH
            + 'h; close it or restate the goal -- a task nobody finished is a plan nobody follows',
        });
      }
    }
  }

  const errorCount = findings.filter(f => f.severity === 'error').length;
  return {
    ok: errorCount === 0,
    findings,
    counts: { error: errorCount, warning: findings.length - errorCount },
  };
}

/**
 * The quarantine ledger folded to a count and its most recent entry, or null when nothing
 * has ever been recorded. A line that will not parse still counts, and a ledger that cannot
 * be read at all is reported as itself: this is the file that exists to stop damage from
 * being silent, and it does not get to be silent about itself -- unreadable, it would report
 * the same nothing as a repository where nothing ever went wrong, while every detection it
 * holds stops reaching anybody.
 */
function readQuarantine() {
  const fp = quarantineFilePath();
  const read = readTextFile(fp);
  if (read.absent) return null;
  if (read.error) {
    return {
      count: 0, files: 0, lastPath: null, lastKind: null,
      unreadable: { path: relFromRoot(fp), detail: errDetail(read.error) },
    };
  }
  const lines = read.text.split('\n').filter(Boolean);
  if (!lines.length) return null;
  const paths = new Set();
  let lastPath = null;
  let lastKind = null;
  for (const l of lines) {
    let o = null;
    try { o = JSON.parse(l); } catch (_e) { continue; }
    if (o && typeof o.path === 'string') { paths.add(o.path); lastPath = o.path; lastKind = o.kind || null; }
  }
  return { count: lines.length, files: paths.size, lastPath, lastKind };
}

/** `risk` subcommand: catalog optional; any error-severity finding exits 1. */
function cmdRisk(flags) {
  const loaded = loadCatalogFlag(flags);
  const catalog = loaded.ok ? loaded.catalog : null;
  const state = readLedgerState();
  const cp = changedPaths();
  const waivers = readWaiverFiles();
  const task = readTaskRecord();
  const fastActive = fastModeActive();
  // Read last. The four calls above each read an artefact of their own and may have just
  // recorded one as damaged; a count taken before them would be one run behind the report
  // it is going into.
  const quarantine = readQuarantine();
  const res = riskFindings({
    ledgerEntries: state.entries,
    ledgerUnreadable: state.unreadable,
    evidenceBreaks: state.unreadable ? [] : evidenceFindings(state.entries).breaks,
    catalog,
    waivers,
    task,
    changed: Array.isArray(cp) ? cp : cp.paths,
    quarantine,
    fastActive,
  });
  if (!res.ok) {
    for (const f of res.findings.filter(x => x.severity === 'error')) {
      process.stderr.write(f.code + ': ' + f.message + '\n');
    }
  }
  return emit({ ...res, catalogPresent: loaded.ok }, res.ok ? 0 : 1);
}

export {
  GENESIS,
  stateDir, ledgerFilePath, ledgerLockPath, taskFilePath, evidenceDir, contextPackDir, relFromRoot,
  writeAtomic, sha256Lf, readJsonFile, readTaskState, readTaskRecord,
  chainHash, ledgerLine, parseLedgerLines, readLedgerState, endsWithNewline, appendLedger,
  verifyLedgerChain, evidenceFindings, ledgerReport, cmdLedger,
  buildPlan, evidenceFilePath, runCheckWithEvidence, gateReason, suppressionOf, waiversApplied, cmdGate,
  auditGates, cmdGateAudit,
  planRetention, ledgerReferencedEvidence, listDirFiles, retentionRefusal, cmdRetention,
  readWaiverFiles, readQuarantine, governanceSurface, riskFindings, cmdRisk,
};
