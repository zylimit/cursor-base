// ext/context.mjs -- S6 context-pack: the budgeted packing of a task envelope, the
// canonical diff and the changed files. The DENY list and isDenied() that guard it live in
// core.mjs, because S13 fitness applies the same exclusion to the files it reads.

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULTS,
  canonicalDiff, changedPaths, emit, isDenied, isStateExcluded, loadHarnessConfig, parseCsv,
  projectRoot, sha256, stableJson, toPosixPath,
} from '../lib/core.mjs';
import { loadCatalogFlag } from './catalog.mjs';
import { analyzeImpact } from './graph.mjs';

// ===========================================================================
// S6 context-pack
// ===========================================================================
/**
 * Budgeted context pack. Pure + injectable so selftest exercises it without real git/fs:
 * pass diffHash + candidateFiles directly. Priority order (blueprint sec.4):
 *   1 task envelope + Spec/Plan pointers (always first)
 *   2 canonical diff (truncated to maxDiffChars)
 *   3 changed files themselves (each truncated to maxFileChars)
 *   4-6 affected/dependency module summaries (Phase 0-2 catalogs carry no such field -> empty)
 * DENY files are dropped before packing at every tier and recorded in `denied`.
 * Fill stops when maxFiles or maxTotalChars is reached. packHash hashes only the
 * {path,bytes} manifest (path-sorted) + budgets + diffHash -> stable across whitespace churn.
 * @returns {{budgets,diffHash,included,denied,affected,degraded,packHash}}
 */
function buildPack({ budgets, diffHash = '', diffChars = 0, candidateFiles = [], envelope = null,
  specPointers = [], affected = [], moduleSummaries = [], degraded = false } = {}) {
  const b = { ...DEFAULTS.contextPack, ...(budgets || {}) };
  const { maxTotalChars, maxFiles, maxFileChars, maxDiffChars } = b;

  const denied = [];
  const candidates = [];

  // P1: task envelope, then Spec/Plan pointers (pointers are path strings, not full content).
  if (envelope) candidates.push({ path: '<task-envelope>', bytes: stableJson(envelope).length, reason: 'envelope' });
  for (const sp of specPointers) { const s = String(sp); candidates.push({ path: s, bytes: s.length, reason: 'spec-pointer' }); }

  // P2: canonical diff, truncated to maxDiffChars.
  if (diffHash || diffChars > 0) {
    const entry = { path: '<canonical-diff>', bytes: Math.min(diffChars, maxDiffChars), reason: 'diff' };
    if (diffChars > maxDiffChars) entry.omitted = 'truncated';
    candidates.push(entry);
  }

  // P3: changed files, each truncated to maxFileChars; DENY never enters.
  for (const f of candidateFiles) {
    const norm = toPosixPath(f.path);
    if (isDenied(norm)) { denied.push(norm); continue; }
    const rawBytes = typeof f.bytes === 'number' ? f.bytes : (typeof f.content === 'string' ? f.content.length : 0);
    const entry = { path: norm, bytes: Math.min(rawBytes, maxFileChars), reason: 'changed-file' };
    if (rawBytes > maxFileChars) entry.omitted = 'truncated';
    candidates.push(entry);
  }

  // P4-6: affected/dependency module summaries (test entries etc.).
  for (const s of moduleSummaries) {
    const norm = toPosixPath(s.path);
    if (isDenied(norm)) { denied.push(norm); continue; }
    candidates.push({ path: norm, bytes: typeof s.bytes === 'number' ? s.bytes : 0, reason: s.reason || 'module-summary' });
  }

  // Fill in priority order; stop when full (file count or total chars).
  const included = [];
  let total = 0;
  for (const c of candidates) {
    if (included.length >= maxFiles) break;
    if (total + c.bytes > maxTotalChars) break;
    included.push(c);
    total += c.bytes;
  }

  const packHash = sha256(stableJson({
    budgets: b,
    diffHash,
    included: included.map(f => ({ path: f.path, bytes: f.bytes }))
      .sort((a, z) => (a.path < z.path ? -1 : a.path > z.path ? 1 : 0)),
  }));

  return { budgets: b, diffHash, included, denied, affected, degraded, packHash };
}

/** Minimal task envelope from flags (--task id); stdin envelope support is a later Task. */
function buildEnvelope(flags) {
  return { task: typeof flags.task === 'string' ? flags.task : null };
}

/** Spec/Plan pointers = existing doc paths at project root (path strings, never full content). */
function specPlanPointers() {
  const root = projectRoot();
  const out = [];
  for (const rel of ['Product-Spec.md', 'DEV-PLAN.md', 'Design-Brief.md']) {
    if (fs.existsSync(path.join(root, rel))) out.push(rel);
  }
  return out;
}

function cmdContextPack(flags) {
  const cfg = loadHarnessConfig();
  const budgets = { ...cfg.contextPack };
  if (typeof flags['budget-chars'] === 'string') {
    const n = parseInt(flags['budget-chars'], 10);
    if (!Number.isNaN(n) && n > 0) budgets.maxTotalChars = n;
  }

  // Catalog optional: present -> compute affected modules; absent -> degraded, no affected.
  const loaded = loadCatalogFlag(flags);
  const catalog = loaded.ok ? loaded.catalog : null;

  // Changed paths: --changed csv override, else real working-tree diff.
  let changed;
  let nonGit = false;
  if (typeof flags.changed === 'string') {
    changed = parseCsv(flags.changed);
  } else {
    const cp = changedPaths();
    if (Array.isArray(cp)) { changed = cp; }
    else { changed = cp.paths; nonGit = !!cp.nonGit; }
  }

  let affected = [];
  let degraded = nonGit;
  const moduleSummaries = [];
  if (catalog) {
    const imp = analyzeImpact(changed, catalog, { nonGit });
    affected = imp.affected;
    degraded = imp.degraded || nonGit;
    // P5: affected module test entries -- only module-level path-like verification strings
    // (Phase 0-2 catalogs carry none, so this stays empty in practice).
    const byId = new Map((catalog.modules || []).map(m => [m.id, m]));
    for (const id of affected) {
      const m = byId.get(id);
      if (m && Array.isArray(m.verification)) {
        for (const v of m.verification) {
          if (typeof v === 'string' && v.includes('/')) moduleSummaries.push({ path: v, bytes: v.length, reason: 'test-entry' });
        }
      }
    }
  } else {
    degraded = true;   // no catalog -> cannot resolve affected modules
  }

  // Canonical diff fingerprint + size (never stringified; size drives budget accounting).
  const { buf } = canonicalDiff();
  const diffHash = sha256(buf);
  const diffChars = buf.length;

  // Candidate changed files: drop runtime-state files, read on-disk size for budgeting.
  const candidateFiles = [];
  for (const p of changed) {
    if (isStateExcluded(p)) continue;
    const norm = toPosixPath(p);
    let bytes = 0;
    try { bytes = fs.statSync(path.join(projectRoot(), p)).size; } catch (_e) { bytes = 0; }
    candidateFiles.push({ path: norm, bytes });
  }

  const pack = buildPack({
    budgets, diffHash, diffChars, candidateFiles,
    envelope: buildEnvelope(flags), specPointers: specPlanPointers(),
    affected, moduleSummaries, degraded,
  });
  return emit(pack, nonGit ? 3 : 0);
}

export { buildPack, buildEnvelope, specPlanPointers, cmdContextPack };
