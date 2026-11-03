// ext/task.mjs -- S18 the task envelope and the blast-radius budget: the two places where
// "what am I allowed to do here" stops being a paragraph in a prompt and becomes something
// a command can answer.
//
// The envelope is CLAUDE.md's seven fields (Goal / Scope / Out of Scope / Existing Pattern /
// Business Context / Verification / Escalation) plus an id, checked by the engine rather than
// by whoever remembers to check it. A missing field is named, not summarised: "incomplete envelope"
// tells a fresh instance nothing it can act on. Fields that genuinely do not apply are
// written "N/A" -- an explicit nothing, which is a decision, unlike an absent key.
//
// `task complete` is the hard end of it. Every condition must hold before a task may be
// called done, and each one that does not is returned by name in blockers[]. This is the
// machine form of the acceptance rule: a subagent reporting DONE is a claim about itself,
// while a PASS gate bound to this exact diff -- one that chose its own scope, ran the plan
// this change surface resolves to, and executed at least one check -- plus an accepting
// receipt bound to the same diff, an intact chain, evidence that still matches its digests
// and a non-empty plan are claims that can be re-checked by someone else.
// The scope conditions are not decoration: a gate handed its own scope produces a real
// signature over a made-up subject, which is the failure mode this file exists to stop.
//
// `budget` is deliberately the softest thing in the file. Going over is not a violation to
// be punished; it is a signal to split the work or to escalate it on purpose. Wide changes
// are sometimes correct, and a budget that forbids them just teaches people to disable it.
//
// Depends on core / catalog / graph / quality / evidence. Nothing imports this module
// except the CLI and selftest, so the graph stays acyclic.

import process from 'node:process';
import {
  changedPaths, emit, git, gitFingerprint, headCommit, isGitRepo, isStateExcluded,
  readStdin, splitNul,
} from '../lib/core.mjs';
import { loadCatalogFlag } from './catalog.mjs';
import { analyzeImpact } from './graph.mjs';
import { loadReceipts, receiptIntact, safeTaskId } from './quality.mjs';
import {
  buildPlan, evidenceFindings, readLedgerState, readTaskState, relFromRoot, taskFilePath,
  verifyLedgerChain, writeAtomic,
} from './evidence.mjs';

// ---------------------------------------------------------------------------
// S18.1 task envelope
// ---------------------------------------------------------------------------

// existingPattern is required here even though the sibling engine this borrows from treats
// it as prompt-only. The whole point of the envelope is that a fresh instance with no
// session history is told which existing implementation to follow; leaving that field
// optional is how a delegate ends up inventing a second way to do something the repository
// already does. "N/A" satisfies it when there genuinely is no precedent.
const TASK_REQUIRED_FIELDS = ['id', 'goal', 'scope', 'outOfScope', 'existingPattern', 'businessContext', 'verification', 'escalation'];

/**
 * Validate an envelope. Pure. Returns which required fields are missing, by name.
 * @param {any} input
 * @returns {{ok:boolean,missing:string[],detail:string|null}}
 */
function validateEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, missing: TASK_REQUIRED_FIELDS.slice(), detail: 'envelope must be a JSON object' };
  }
  const missing = TASK_REQUIRED_FIELDS.filter(f => typeof input[f] !== 'string' || !input[f].trim());
  if (missing.length === 0 && !safeTaskId(input.id)) {
    return { ok: false, missing: ['id'], detail: 'id must contain at least one of [A-Za-z0-9._-]' };
  }
  return { ok: missing.length === 0, missing, detail: null };
}

/**
 * The record the engine stores: the caller's envelope with a sanitized id and the three
 * fields only the engine can know. Caller-supplied extras are kept -- dropping them would
 * silently discard context somebody chose to write down.
 * @param {Object} envelope
 * @param {{now:string,baseCommit:string|null}} ctx
 */
function buildTaskRecord(envelope, { now, baseCommit }) {
  return {
    ...envelope,
    // Sanitized and length-capped even though the id is not a filename today: it is echoed
    // into the ledger and read back by other tools, and an id that can carry a separator is
    // a path traversal waiting for the first tool that does turn it into a filename.
    id: safeTaskId(envelope.id).slice(0, 120),
    state: 'active',
    baseCommit,
    startedAt: now,
  };
}

/** True if a receipt accepts the review of exactly this diff. */
function acceptingReceipt(receipts, diffHash) {
  const accepting = new Set(['accept', 'pass']);
  for (const r of (receipts || [])) {
    if (!receiptIntact(r)) continue;
    if (r.diffHash !== diffHash) continue;
    if (accepting.has(String(r.verdict || '').trim().toLowerCase())) return r;
  }
  return null;
}

/**
 * The blocking conditions of `task complete`, each returned by name when it fails.
 * Pure + injectable so selftest can trip them one at a time.
 *
 * Four of them are about the gate record itself, because a PASS is not one fact but four:
 * it has to be bound to this diff, it has to have decided its own scope, the plan it ran
 * has to be the plan this change surface resolves to, and at least one check in it has to
 * have actually executed. Drop any one and a green becomes forgeable -- `gate --changed
 * <path the catalog ignores>` produces PASS with an empty module list and a perfectly real
 * diffHash beside it, which is a true signature over a scope the caller chose.
 * @param {{latestGate?:Object|null,currentDiffHash?:string,currentPlanHash?:string|null,
 *          receipts?:Array,receiptsUnreadable?:string[],ledgerOk?:boolean,evidenceOk?:boolean,
 *          planEmpty?:boolean}} [input]
 * @returns {string[]}
 */
function completeBlockers({ latestGate = null, currentDiffHash = '', currentPlanHash = null,
  receipts = [], receiptsUnreadable = [], ledgerOk = true, evidenceOk = true, planEmpty = true } = {}) {
  const blockers = [];
  const gateFresh = !!latestGate && latestGate.gate === 'PASS' && latestGate.diffHash === currentDiffHash;
  if (!gateFresh) {
    blockers.push('no PASS gate record bound to the current diffHash'
      + (latestGate ? ' (newest gate: ' + latestGate.gate + ' on ' + String(latestGate.diffHash).slice(0, 12) + ')' : ' (no gate has ever run)')
      + '; run: harness.mjs gate');
  } else {
    if (latestGate.scopeSource !== 'computed') {
      blockers.push('that PASS gate ran over '
        + (latestGate.scopeSource === 'caller'
          ? 'a scope the caller supplied with --changed'
          : 'a scope of unrecorded provenance (the record predates scope tracking)')
        + ', so it says nothing about the real change surface; run: harness.mjs gate with no --changed');
    }
    if (currentPlanHash !== null && latestGate.planHash !== currentPlanHash) {
      blockers.push('that PASS gate verified plan ' + String(latestGate.planHash).slice(0, 12)
        + ', but the current change surface resolves to plan ' + String(currentPlanHash).slice(0, 12)
        + '; run: harness.mjs gate with no --changed');
    }
    const results = Array.isArray(latestGate.results) ? latestGate.results : [];
    if (results.length > 0 && results.every(r => r && r.state === 'SKIPPED')) {
      blockers.push('every check in that PASS gate was skipped (fast mode or a waiver), so it '
        + 'established nothing: the evidence was deferred, not obtained');
    }
  }
  // Ahead of the "no accepting receipt" test on purpose, and never folded into it: an
  // unreadable receipt outranks every sibling that binds, because the file nobody can read
  // may be the tampered one and a receipt that does bind says nothing about it. `receipt
  // verify` already refuses this tree at exit 4; the gate documented as the hard one must
  // not be the softer of the two.
  if (receiptsUnreadable.length) {
    blockers.push('receipt-unreadable: ' + receiptsUnreadable.length + ' receipt file(s) exist and '
      + 'cannot be read (' + receiptsUnreadable.join(', ') + '), so the receipt pile cannot be judged '
      + 'at all; read them, then repair or remove them by hand');
  }
  if (!acceptingReceipt(receipts, currentDiffHash)) {
    blockers.push('no fresh accepting review receipt bound to the current diffHash; '
      + 'have the reviewer write one: harness.mjs receipt write');
  }
  if (!ledgerOk) {
    // No command is named here on purpose. A break is permanent -- records only append past
    // it -- so pointing at the gates would recommend a road that ends where it started.
    blockers.push('the ledger chain is broken, so every recorded verification is unproven, and '
      + 'running more gates cannot mend it: a person has to decide whether to retire '
      + '.claude/harness/state/ledger.jsonl (which discards every proof it held) and rebuild '
      + 'from there, or to find out who edited it');
  }
  if (!evidenceOk) {
    blockers.push('an evidence log the ledger points at is missing or no longer matches its '
      + 'recorded digest, so the verdict resting on it is unproven; see: harness.mjs ledger');
  }
  if (planEmpty) {
    blockers.push('the verification plan is empty: nothing would have run, so nothing was established');
  }
  return blockers;
}

/** The newest gate record in the ledger, or null. */
function latestGateRecord(entries) {
  const gates = (entries || []).filter(e => e && !e.corrupt && e.command === 'gate');
  return gates.length ? gates[gates.length - 1] : null;
}

/**
 * The refusal both readers share. "no active task" is the answer for a tree where nobody
 * started one; here somebody did and the record went bad, and the two need different next
 * moves -- one is "start one", the other is "find out who wrote this".
 */
function corruptTask(sub, corrupt) {
  process.stderr.write('task ' + sub + ': ' + corrupt.path + ' exists and cannot be read ('
    + corrupt.detail + '); the record is damaged, not absent -- do not start a fresh one over it\n');
  return emit({ ok: false, error: 'corrupt-state', path: corrupt.path, detail: corrupt.detail }, 3);
}

/**
 * Write the record, or hand back why it could not be written. Nothing here is allowed to
 * throw its way out: a rename onto a path that is a directory comes back EISDIR from
 * writeAtomic, and an uncaught one prints a node stack carrying this machine's absolute
 * paths while stdout stays empty -- the two things every other answer in this engine takes
 * care not to do.
 * @returns {{path:string,detail:string}|null} null when it landed
 */
function writeTaskRecord(record) {
  const fp = taskFilePath();
  try {
    writeAtomic(fp, JSON.stringify(record, null, 2) + '\n');
    return null;
  } catch (e) {
    return { path: relFromRoot(fp), detail: errDetail(e) };
  }
}

/** The refusal both writes share. Nothing was recorded, so nothing may read as recorded. */
function unwritableTask(sub, failed) {
  process.stderr.write('task ' + sub + ': ' + failed.path + ' could not be written ('
    + failed.detail + '); nothing was recorded\n');
  return emit({ ok: false, error: 'corrupt-state', path: failed.path, detail: failed.detail }, 3);
}

/**
 * CLI: task start | status | complete.
 *   start     stdin JSON envelope -> writes state/task.json (exit 3 names missing fields,
 *             and refuses outright when a record is already there and cannot be read)
 *   status    the record plus the current diffHash (exit 0; 3 when the record is corrupt)
 *   complete  exit 0 only when all four conditions hold; otherwise exit 2 + blockers[]
 */
function cmdTask(flags = {}, positional = []) {
  const sub = positional[0] || 'status';

  if (sub === 'start') {
    const raw = readStdin();
    let input;
    try { input = raw.trim() ? JSON.parse(raw) : {}; } catch (e) {
      return emit({ error: 'task-parse-error', detail: String(e && e.message || e) }, 3);
    }
    const v = validateEnvelope(input);
    if (!v.ok) {
      process.stderr.write('task envelope is incomplete; missing: ' + v.missing.join(', ')
        + (v.detail ? ' (' + v.detail + ')' : '') + '\n');
      return emit({ error: 'task-envelope-incomplete', missing: v.missing, detail: v.detail }, 3);
    }
    // Look before writing. status and complete already refuse a damaged record; start is the
    // one verb that writes over it, so a writer that never looks turns their refusal into
    // advice nobody has to take -- and the damaged record is the only copy of what happened.
    const prior = readTaskState();
    if (prior.corrupt) return corruptTask('start', prior.corrupt);
    const record = buildTaskRecord(input, { now: new Date().toISOString(), baseCommit: headCommit() });
    const failed = writeTaskRecord(record);
    if (failed) return unwritableTask('start', failed);
    return emit({ ok: true, path: relFromRoot(taskFilePath()), task: record }, 0);
  }

  if (sub === 'status') {
    const state = readTaskState();
    if (state.corrupt) return corruptTask('status', state.corrupt);
    const task = state.task;
    return emit({
      ok: !!task,
      active: !!(task && task.state === 'active'),
      task,
      diffHash: isGitRepo() ? gitFingerprint() : null,
      note: task ? null : 'no-task-record',
    }, 0);
  }

  if (sub === 'complete') {
    const loaded = loadCatalogFlag(flags);
    if (!loaded.ok) {
      return emit({ ok: false, degraded: true, error: loaded.error, detail: loaded.detail }, 3);
    }
    const state = readTaskState();
    if (state.corrupt) return corruptTask('complete', state.corrupt);
    const task = state.task;
    if (!task || task.state !== 'active') {
      return emit({
        ok: false, task: task ? task.id : null,
        blockers: ['no active task: run "harness.mjs task start" with a six-field envelope first'],
      }, 2);
    }
    // The scope of a completion is never the caller's to state. Accepting --changed here
    // would hand back exactly what the gate-record scope check takes away: a way to close a
    // task against a change surface chosen for the purpose.
    if (typeof flags.changed === 'string') {
      process.stderr.write('task complete does not take --changed: the whole point of this gate is that '
        + 'the change surface is measured, not supplied\n');
      return emit({
        ok: false, task: task.id, error: 'task-scope-not-caller-specified',
        detail: 'run it with no --changed; use gate --changed to verify a subset without closing anything',
      }, 3);
    }
    // Non-git degrades here for the same reason it degrades in gate, verify and receipt
    // verify: gitFingerprint() answers a constant for every non-git tree, so "bound to this
    // diff" would be true of any tree anywhere. Blocking with advice would be worse than
    // saying so -- every command that advice could name degrades in this tree too.
    if (!isGitRepo()) {
      process.stderr.write('task complete: this tree is not a git repository, so there is no diff to bind '
        + 'evidence to and the gate and receipt bindings this command checks cannot be trusted here\n');
      return emit({
        ok: false, degraded: true, reason: 'non-git', task: task.id, diffHash: null, blockers: [],
      }, 3);
    }
    const ledger = readLedgerState();
    // An unreadable ledger is not a blocker with a name, it is the absence of the file every
    // one of these conditions is read out of. Degrade rather than report four conditions
    // that were never actually evaluated.
    if (ledger.unreadable) {
      process.stderr.write('task complete: the ledger exists but cannot be read (' + ledger.unreadable
        + '), so no recorded verification can be checked here\n');
      return emit({
        ok: false, degraded: true, reason: 'ledger-unreadable', task: task.id,
        diffHash: gitFingerprint(), blockers: [],
      }, 3);
    }
    const cp = changedPaths();
    const changed = Array.isArray(cp) ? cp : cp.paths;
    const imp = analyzeImpact(changed, loaded.catalog, {});
    const plan = buildPlan(imp.affected, loaded.catalog);
    const currentDiffHash = gitFingerprint();
    const receiptLedger = loadReceipts();
    const blockers = completeBlockers({
      latestGate: latestGateRecord(ledger.entries),
      currentDiffHash,
      currentPlanHash: plan.hash,
      receipts: receiptLedger.receipts,
      receiptsUnreadable: receiptLedger.unreadable,
      ledgerOk: verifyLedgerChain(ledger.entries).ok,
      evidenceOk: evidenceFindings(ledger.entries).ok,
      planEmpty: plan.empty,
    });
    if (blockers.length) {
      for (const b of blockers) process.stderr.write('task complete blocked: ' + b + '\n');
      return emit({ ok: false, task: task.id, diffHash: currentDiffHash, blockers }, 2);
    }
    const done = { ...task, state: 'complete', completedAt: new Date().toISOString() };
    const failed = writeTaskRecord(done);
    if (failed) return unwritableTask('complete', failed);
    return emit({ ok: true, task: done.id, diffHash: currentDiffHash, blockers: [] }, 0);
  }

  return emit({ error: 'task-subcommand', detail: 'usage: task start|status|complete', got: sub || null }, 3);
}

// ---------------------------------------------------------------------------
// S18.2 budget  (blast radius: a signal to split or escalate, never a prohibition)
// ---------------------------------------------------------------------------

// Defaults sized as "stop and think" rather than "stop". catalog.budget overrides any of
// them, and setting one to null turns that metric into a report-only number.
const BUDGET_DEFAULTS = {
  maxChangedFiles: 30,
  maxChangedLines: 1000,
  maxModulesTouched: 5,
  maxNewFiles: 15,
};

const BUDGET_METRICS = [
  ['changedFiles', 'maxChangedFiles'],
  ['changedLines', 'maxChangedLines'],
  ['modulesTouched', 'maxModulesTouched'],
  ['newFiles', 'maxNewFiles'],
];

/**
 * Compare measured blast radius against the declared limits. Pure.
 * @param {Object} metrics
 * @param {Object} limits
 * @returns {{ok:boolean,findings:Array<{metric:string,actual:number,limit:number}>}}
 */
function assessBudget(metrics, limits) {
  const findings = [];
  for (const [metric, key] of BUDGET_METRICS) {
    const limit = limits ? limits[key] : undefined;
    const actual = metrics ? metrics[metric] : undefined;
    if (typeof limit !== 'number' || typeof actual !== 'number') continue;
    if (actual > limit) findings.push({ metric, actual, limit });
  }
  return { ok: findings.length === 0, findings };
}

/** Added + removed line counts from git numstat (binary files report '-' and are skipped). */
function countDiffLines() {
  let added = 0;
  let removed = 0;
  const args = ['diff', '--numstat'];
  if (headCommit()) args.push('HEAD');
  const out = (git(args).stdout || Buffer.alloc(0)).toString('utf8');
  for (const line of out.split('\n')) {
    const m = /^(\d+)\t(\d+)\t/.exec(line);
    if (m) { added += Number(m[1]); removed += Number(m[2]); }
  }
  return { added, removed };
}

/**
 * `budget` subcommand: measure the blast radius of the working tree and compare it with
 * catalog.budget. Over a limit exits 1 -- read that as "split this, or escalate it on
 * purpose", not as a refusal.
 */
function cmdBudget(flags) {
  const loaded = loadCatalogFlag(flags);
  if (!loaded.ok) {
    return emit({ ok: false, degraded: true, error: loaded.error, detail: loaded.detail }, 3);
  }
  if (!isGitRepo()) {
    return emit({ ok: false, degraded: true, reason: 'non-git' }, 3);
  }
  const cp = changedPaths();
  const changed = (Array.isArray(cp) ? cp : cp.paths).filter(p => !isStateExcluded(p));
  const untracked = splitNul(git(['-c', 'core.quotePath=false', 'ls-files', '-z', '--others', '--exclude-standard']).stdout)
    .filter(p => !isStateExcluded(p));
  const imp = analyzeImpact(changed, loaded.catalog, {});
  const { added, removed } = countDiffLines();
  const metrics = {
    changedFiles: changed.length,
    changedLines: added + removed,
    added,
    removed,
    modulesTouched: imp.direct.length,
    newFiles: untracked.length,
    affectedModules: imp.affected.length,
  };
  const limits = { ...BUDGET_DEFAULTS, ...(loaded.catalog.budget || {}) };
  const res = assessBudget(metrics, limits);
  if (!res.ok) {
    for (const f of res.findings) {
      process.stderr.write('budget: ' + f.metric + ' = ' + f.actual + ' (limit ' + f.limit + ')\n');
    }
  }
  return emit({
    ...res,
    metrics,
    limits,
    degraded: !!imp.degraded,
    advice: res.ok
      ? 'blast radius is within the declared budget'
      : 'blast radius is past the declared budget: split this into smaller tasks, or widen the '
        + 'scope deliberately (plan + ADR + owner). This is a signal to stop and think for a '
        + 'second, not a prohibition -- a wide change is sometimes the right one.',
  }, res.ok ? 0 : 1);
}

export {
  TASK_REQUIRED_FIELDS, validateEnvelope, buildTaskRecord, acceptingReceipt, completeBlockers,
  latestGateRecord, cmdTask,
  BUDGET_DEFAULTS, BUDGET_METRICS, assessBudget, countDiffLines, cmdBudget,
};
