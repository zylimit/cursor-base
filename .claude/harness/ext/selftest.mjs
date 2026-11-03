// ext/selftest.mjs -- the inline regression assertions and their fixture. Kept apart from
// the CLI so the case list can grow without pushing the dispatch surface around; cmdSelftest
// in harness.mjs runs them. Imports from the modules it still asserts on, and nothing imports this one.

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { DEFAULT_PROFILE } from '../../hooks/lib/tier.mjs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  HARNESS_DIR, isDenied, matchAny, normalizeTier, specificity, toPosixPath, withDirLock,
} from '../lib/core.mjs';
import { classifyPath, lintCatalog, loadCatalog } from './catalog.mjs';
import {
  analyzeImpact, compareRatchet, extractImports, findCycles, layerViolation, moduleForSpecifier,
} from './graph.mjs';
import { buildPack } from './context.mjs';
import {
  aggregateStates, applyWaiver, assessAttributes, contentHash, matchReceipts, receiptIntact,
  requiredChecks, runCheck, safeTaskId, validateWaiver, verifyPlan,
} from './quality.mjs';
import { DEFAULT_FITNESS_RULES, assessAdrRecords, scanFitness } from './scan.mjs';
import {
  GENESIS, appendLedger, auditGates, buildPlan, chainHash, evidenceFindings, gateReason, ledgerFilePath,
  ledgerLine, ledgerReport, parseLedgerLines, planRetention, retentionRefusal, riskFindings, sha256Lf,
  verifyLedgerChain,
} from './evidence.mjs';
import {
  assessBudget, buildTaskRecord, completeBlockers, latestGateRecord, validateEnvelope,
} from './task.mjs';
import {
  REQUIRED_SECTIONS, collectReferences, dodStatus, lintSpecDoc, placeholderBrackets, traceReport,
} from './spec.mjs';
import {
  REVIEW_PROFILES, authorSetFor, backlogViolations, computeVerdict, currentStage, lensExclusions,
  reviewLenses, selfReviewedLenses, stagePassed, validateFindings,
} from './review.mjs';
import {
  ARCHIVABLE_SECTIONS, IRON_LAW_MARK, applyArchivePlan, extractIronLaws, isTrackedWork, planArchive,
  syncFindings,
} from './memory.mjs';
import { documentSections, lintModuleDoc, parseFrontmatter } from './rules.mjs';
import { manifestFindings, normalizedSha, parseManifest, releaseVerdict, result } from './release.mjs';
import { validateProfile } from '../lib/tier.mjs';

/**
 * Inline regression assertions (node:assert, zero npm). Extensible: later Tasks append
 * more cases to selftestCases(). All pass -> {ok:true,tests:N} exit 0; any fail ->
 * {ok:false,failed:[...]} exit 1.
 */
function selftestCases() {
  // Fixture loader (checked-in tiny catalogs live under .claude/tests/fixtures/harness).
  const fx = (n) => path.join(HARNESS_DIR, '..', 'tests', 'fixtures', 'harness', n);
  const loadFx = (n) => { const r = loadCatalog(fx(n)); assert.ok(r.ok, 'fixture load failed: ' + n + ' ' + (r.detail || '')); return r.catalog; };
  const hasCode = (errors, code) => errors.some(e => e.code === code);
  // The interpreter already running, by absolute path. whichCmd resolves a name containing a
  // separator with existsSync and a bare name against PATH, so a bare "node" here would make
  // these cases depend on where the machine keeps node -- and the golden runner pins PATH to
  // git's directory plus /usr/bin:/bin, which on a hosted runner has no node in it. The PATH
  // lookup branch stays covered by the "missing binary -> BLOCKED" case below.
  const NODE = process.execPath;

  const good = loadFx('catalog-good.json');
  // A tracked set where every path is claimed by a module/global/ignored (no unmapped/overlap).
  const goodTracked = ['core/index.ts', 'db/schema.ts', 'auth/login.ts', 'api/routes.ts', 'package.json', 'README.md', 'docs/guide.md'];

  // S17/S18 fixtures. chainLines() links records exactly the way appendLedger does, so the
  // tamper cases below start from a chain that is genuinely valid rather than one hand-built
  // to pass -- a forgery detector proved against a forged baseline detects nothing.
  const chainLines = (records) => {
    const out = [];
    let prev = GENESIS;
    for (const r of records) { const line = ledgerLine(r, prev); prev = line.chain; out.push(line); }
    return out;
  };
  const gateRec = (over = {}) => ({
    command: 'gate', at: '2020-01-01T00:00:00.000Z', gate: 'PASS',
    reason: 'all-executed-checks-passed', diffHash: 'D0', planHash: 'P0',
    scopeSource: 'computed', scopeRequested: null,
    modules: ['pay'], degraded: false, fastActive: false, skippedByFastMode: [], results: [],
    ...over,
  });
  const envelope = (over = {}) => ({
    id: 'T1', goal: 'g', scope: 's', outOfScope: 'o',
    existingPattern: 'p', businessContext: 'why: a fresh instance needs the reason; who benefits: the next delegate',
    verification: 'v', escalation: 'e', ...over,
  });
  const okReceipt = (over = {}) => {
    const r = { taskId: 'T1', baseCommit: 'c0', diffHash: 'D0', reviewer: 'rev', verdict: 'ACCEPT', scope: 's', timestamp: '2020-01-01T00:00:00.000Z', ...over };
    r.contentHash = contentHash(r);
    return r;
  };
  const budgetCat = { maxChangedFiles: 3, maxChangedLines: 100, maxModulesTouched: 2, maxNewFiles: 1 };

  // S20 fixtures. A session is built from the same shape review start writes, and a lens
  // report from the shape recordLens stores, so a change to either surface breaks these
  // rather than leaving them asserting against a shape nothing produces any more.
  const lensRec = (over = {}) => ({ at: '2020-01-01T00:00:00.000Z', agentId: null, unable: false, unableReason: null, findings: [], ...over });
  const errFinding = { severity: 'error', location: 'src/a.js:12', reproduction: null, summary: 'off by one' };
  const reviewSession = (over = {}) => ({
    version: 1, diffHash: 'D0', baseCommit: 'c0', startedAt: '2020-01-01T00:00:00.000Z',
    scope: '', packPath: null, profile: 'regulated', catalogPresent: true, affected: ['core'],
    requiredLenses: ['correctness', 'architecture', 'testing', 'security'],
    excludedLenses: [], lineage: [], blue: { at: '2020-01-01T00:00:00.000Z', claims: [{ statement: 's', evidence: 'e' }] },
    lenses: {}, backlog: [], verdict: null, ...over,
  });
  const allClean = { correctness: lensRec(), architecture: lensRec(), testing: lensRec(), security: lensRec() };

  // S19 fixture. The section labels come from the module rather than being re-escaped here:
  // the runtime source is ASCII-only, and a second hand-escaped copy of four Chinese headings
  // is a transcription error waiting to happen. What the labels ARE is asserted where it can
  // be read -- the checked-in sample document under tests/fixtures/golden, which the golden
  // matrix runs spec-lint against for real.
  const [S_OVERVIEW, S_SCENARIO, S_REQUIREMENT, S_TECH] = REQUIRED_SECTIONS;
  const specDoc = (requirementLines, over = {}) => [
    '# Product Spec',
    '',
    '## ' + S_OVERVIEW,
    over.overview === undefined ? 'a tool for small teams; the user is the part-time bookkeeper' : over.overview,
    '',
    '## ' + S_SCENARIO,
    over.scenario === undefined ? '- month end: import the statement, read the report' : over.scenario,
    '',
    '## ' + S_REQUIREMENT,
    ...requirementLines,
    '',
    '## ' + S_TECH,
    over.tech === undefined ? '| dimension | choice | reason |' : over.tech,
    '',
  ].join('\n');
  const codesOf = (r) => r.findings.map(f => f.code);

  return [
    // S1 toPosixPath -- the separator the stdout contract is written in. CI on windows-latest
    // caught rules-audit printing `.claude\CLAUDE.md` where every recorded assertion, hook and
    // downstream reader expects `.claude/CLAUDE.md`; on POSIX the two are the same string, so
    // the defect is invisible to every run on this machine. These four cases are the substitute
    // for a Windows box: the first pins the function's contract, the second shows the field CI
    // named, the third pins the constants that reach output, and the fourth is the only one that
    // can fail here for a Windows-only reason.
    ['toPosixPath: a windows separator comes out forward-slashed, and its own output is a fixed point', () => {
      assert.equal(toPosixPath('a\\b\\c'), 'a/b/c');
      assert.equal(toPosixPath('a/b/c'), 'a/b/c');
      assert.equal(toPosixPath(toPosixPath('a\\b\\c')), 'a/b/c');
      assert.equal(toPosixPath('a\\b/c'), 'a/b/c', 'a mixed path is normalized whole, not left half-converted');
      assert.equal(toPosixPath(path.win32.join('.claude', 'CLAUDE.md')), '.claude/CLAUDE.md');
      assert.equal(toPosixPath('C:\\repo\\.claude\\harness\\waivers\\w.json'),
        'C:/repo/.claude/harness/waivers/w.json', 'an absolute windows path normalizes too');
    }],
    ['glob src/auth/** matches src/auth/login.ts', () => assert.ok(matchAny('src/auth/login.ts', ['src/auth/**']))],
    ['glob src/auth/** does not match src/authz/z.ts', () => assert.ok(!matchAny('src/authz/z.ts', ['src/auth/**']))],
    ['glob src/* does not match src/a/b.ts (single * no /)', () => assert.ok(!matchAny('src/a/b.ts', ['src/*']))],
    ['specificity src/auth/** > src/**', () => assert.ok(specificity('src/auth/**') > specificity('src/**'))],

    // S4 classifyPath -- priority module > ignored > global > unmapped.
    ['classify db/schema.ts -> module db', () => { const c = classifyPath('db/schema.ts', good); assert.equal(c.kind, 'module'); assert.equal(c.moduleId, 'db'); }],
    ['classify weird/x -> unmapped', () => assert.equal(classifyPath('weird/x', good).kind, 'unmapped')],

    // S4 catalog-lint -- good catalog with fully-classified tracked set is clean.
    ['lint good catalog (all tracked classified) -> ok, no errors', () => { const r = lintCatalog(good, goodTracked); assert.ok(r.ok); assert.equal(r.errors.length, 0); }],
    ['lint bad-catchall -> CATCH_ALL error', () => { const r = lintCatalog(loadFx('catalog-bad-catchall.json'), []); assert.ok(!r.ok); assert.ok(hasCode(r.errors, 'CATCH_ALL')); }],
    ['lint bad-unmapped -> UNMAPPED error', () => { const r = lintCatalog(loadFx('catalog-bad-unmapped.json'), ['weird/x.ts']); assert.ok(!r.ok); assert.ok(hasCode(r.errors, 'UNMAPPED')); }],
    ['lint bad-overlap -> OVERLAP error', () => { const r = lintCatalog(loadFx('catalog-bad-overlap.json'), ['core/shared/x.ts']); assert.ok(!r.ok); assert.ok(hasCode(r.errors, 'OVERLAP')); }],
    ['lint bad-dangling -> DANGLING_DEP error', () => { const r = lintCatalog(loadFx('catalog-bad-dangling.json'), []); assert.ok(!r.ok); assert.ok(hasCode(r.errors, 'DANGLING_DEP')); }],

    // S5 impact -- reverse closure + conservative fanout.
    ['impact db/x.ts -> affected includes db+auth+api (reverse closure), not degraded', () => {
      const r = analyzeImpact(['db/x.ts'], good, {});
      assert.ok(r.affected.includes('db') && r.affected.includes('auth') && r.affected.includes('api'));
      assert.equal(r.degraded, false);
    }],
    ['isDenied .env / node_modules / id_rsa / receipts / .runtime -> true', () => {
      assert.ok(isDenied('.env'));
      assert.ok(isDenied('config/.env.local'));
      assert.ok(isDenied('node_modules/x.js'));
      assert.ok(isDenied('id_rsa'));
      assert.ok(isDenied('.claude/harness/receipts/foo.json'));
      assert.ok(isDenied('secrets/server.pem'));
      assert.ok(isDenied('.claude/.runtime/supervisor/web/state.json'));   // supervisor pid/state/logs: machine-specific
    }],
    ['buildPack DENY files never in included, recorded in denied', () => {
      const r = buildPack({
        diffHash: 'd', diffChars: 0,
        candidateFiles: [
          { path: '.env', bytes: 10 }, { path: 'node_modules/a.js', bytes: 10 },
          { path: 'id_rsa', bytes: 10 }, { path: '.claude/harness/receipts/x.json', bytes: 10 },
          { path: '.claude/.runtime/supervisor/web/supervisor.json', bytes: 10 },
          { path: 'src/real.ts', bytes: 10 },
        ],
      });
      const inc = r.included.map(f => f.path);
      assert.ok(!inc.includes('.env') && !inc.includes('node_modules/a.js') && !inc.includes('id_rsa'));
      assert.ok(!inc.includes('.claude/.runtime/supervisor/web/supervisor.json'));
      assert.ok(inc.includes('src/real.ts'));
      assert.ok(r.denied.includes('.env') && r.denied.includes('node_modules/a.js'));
      assert.ok(r.denied.includes('.claude/.runtime/supervisor/web/supervisor.json'));
    }],
    ['contentHash changes when any field is mutated (tamper detectable)', () => {
      const r = { taskId: 't1', baseCommit: 'c0', diffHash: 'H1', reviewer: 'rev', verdict: 'pass', scope: 'x', timestamp: '2026-01-01T00:00:00Z' };
      assert.notEqual(contentHash({ ...r, verdict: 'fail' }), contentHash(r));
    }],
    ['receiptIntact true for freshly hashed, false when tampered', () => {
      const r = { taskId: 't1', diffHash: 'H1', reviewer: 'rev', verdict: 'pass', scope: 'x', timestamp: 'T' };
      r.contentHash = contentHash(r);
      assert.ok(receiptIntact(r));
      assert.ok(!receiptIntact({ ...r, diffHash: 'H2' }));
    }],
    ['matchReceipts: current diff H2 does not match receipt bound to H1 (stale)', () => {
      const r = { taskId: 't1', diffHash: 'H1', reviewer: 'rev', verdict: 'pass', scope: 'x', timestamp: 'T' };
      r.contentHash = contentHash(r);
      const m = matchReceipts([r], 'H2');
      assert.equal(m.matched, null);
      assert.equal(m.hadReceipts, true);
    }],
    ['matchReceipts: empty receipts -> no match, hadReceipts false (adoption grace)', () => {
      const m = matchReceipts([], 'H1');
      assert.equal(m.matched, null);
      assert.equal(m.hadReceipts, false);
    }],
    ['safeTaskId strips path traversal / separators', () => {
      assert.equal(safeTaskId('../../etc/passwd'), '.._.._etc_passwd');
      assert.equal(safeTaskId('a/b\\c'), 'a_b_c');
      assert.equal(safeTaskId('..'), '');
    }],

    // S8 quality -- runCheck four-state + fast-mode + aggregation.
    ['runCheck no command -> BLOCKED no-command', () => {
      const r = runCheck({ id: 'x' }, {});
      assert.equal(r.state, 'BLOCKED');
      assert.equal(r.reason, 'no-command');
    }],
    ['runCheck missing binary -> BLOCKED command-missing (never fake green)', () => {
      const r = runCheck({ id: 'x', command: '__no_such_cmd_zzz__ arg' }, {});
      assert.equal(r.state, 'BLOCKED');
      assert.ok(r.reason.startsWith('command-missing:'));
    }],
    ['runCheck present + exit 0 -> PASS', () => {
      const r = runCheck({ id: 'ver', command: NODE + ' --version' }, {});
      assert.equal(r.state, 'PASS');
      assert.equal(r.exit, 0);
    }],
    ['runCheck present + exit != 0 -> FAIL with exit code', () => {
      const r = runCheck({ id: 'boom', command: NODE + ' -e "process.exit(3)"' }, {});
      assert.equal(r.state, 'FAIL');
      assert.equal(r.exit, 3);
    }],
    ['runCheck fast + non-security + allowFastSkip -> SKIPPED', () => {
      const r = runCheck({ id: 'lint', command: NODE + ' --version', allowFastSkip: true }, { fastActive: true });
      assert.equal(r.state, 'SKIPPED');
      assert.equal(r.reason, 'fast-mode');
    }],
    ['runCheck fast + security -> still runs (never SKIPPED)', () => {
      const r = runCheck({ id: 'audit', command: NODE + ' --version', class: 'security', allowFastSkip: true }, { fastActive: true });
      assert.notEqual(r.state, 'SKIPPED');
      assert.equal(r.state, 'PASS');
    }],
    ['aggregateStates: any FAIL -> FAIL', () => assert.equal(aggregateStates(['PASS', 'FAIL', 'BLOCKED']), 'FAIL')],
    ['aggregateStates: no FAIL, has BLOCKED -> BLOCKED', () => assert.equal(aggregateStates(['PASS', 'BLOCKED', 'SKIPPED']), 'BLOCKED')],
    ['aggregateStates: all PASS/SKIPPED -> PASS', () => assert.equal(aggregateStates(['PASS', 'SKIPPED', 'PASS']), 'PASS')],
    ['runCheck fast + privacy class -> never SKIPPED (runs for real)', () => {
      const r = runCheck({ id: 'pii-scan', command: NODE + ' --version', class: 'privacy', allowFastSkip: true }, { fastActive: true });
      assert.notEqual(r.state, 'SKIPPED');
      assert.equal(r.state, 'PASS');
    }],
    ['verifyPlan: affected modules with zero checks -> BLOCKED emptyPlan (config failure, not green)', () => {
      const cat = { modules: [{ id: 'a', paths: ['a/**'] }] };
      const plan = verifyPlan(['a/x.js'], cat);
      assert.equal(plan.state, 'BLOCKED');
      assert.equal(plan.emptyPlan, true);
    }],
    ['verifyPlan: no changes -> PASS (nothing affected, nothing owed)', () => {
      const cat = { modules: [{ id: 'a', paths: ['a/**'] }] };
      const plan = verifyPlan([], cat);
      assert.equal(plan.state, 'PASS');
      assert.equal(plan.emptyPlan, false);
    }],
    ['requiredChecks: module.verification overrides catalog.riskChecks[risk]', () => {
      const cat = { riskChecks: { high: ['a', 'b'] } };
      assert.deepEqual(requiredChecks('high', { verification: ['x'] }, cat), ['x']);
      assert.deepEqual(requiredChecks('high', {}, cat), ['a', 'b']);
      assert.deepEqual(requiredChecks('low', {}, cat), []);
    }],

    // S10 waiver -- validate / apply (fs-free pure functions).
    ['validateWaiver missing fields -> errors non-empty', () => {
      const errs = validateWaiver({});
      assert.ok(errs.length > 0);
    }],
    ['validateWaiver security keyword in reason -> reject', () => {
      const w = {
        version: 1, owner: 't', reason: 'bypass security gate temporarily',
        scope: 'lint', expiry: '2099-01-01T00:00:00.000Z',
        compensation: 'fix later', created_at: '2026-01-01T00:00:00.000Z',
      };
      const errs = validateWaiver(w);
      assert.ok(errs.some(e => /forbidden|security|keyword/i.test(e)));
    }],
    ['validateWaiver expired expiry -> reject', () => {
      const w = {
        version: 1, owner: 't', reason: 'flake',
        scope: 'lint', expiry: '2000-01-01T00:00:00.000Z',
        compensation: 'fix later', created_at: '1999-01-01T00:00:00.000Z',
      };
      const errs = validateWaiver(w);
      assert.ok(errs.some(e => /expir/i.test(e)));
    }],
    ['validateWaiver complete object -> errors empty', () => {
      const w = {
        version: 1, owner: 't', reason: 'flake on CI',
        scope: 'lint', expiry: '2099-01-01T00:00:00.000Z',
        compensation: 'fix in CI', created_at: '2026-01-01T00:00:00.000Z',
      };
      assert.deepEqual(validateWaiver(w), []);
    }],
    ['applyWaiver: FAIL + matching scope + non-security -> SKIPPED waiver:', () => {
      const res = { id: 'lint', class: 'quality', state: 'FAIL', exit: 1 };
      const waivers = [{
        version: 1, owner: 't', reason: 'flake', scope: 'lint',
        expiry: '2099-01-01T00:00:00.000Z', compensation: 'x',
        created_at: '2026-01-01T00:00:00.000Z',
      }];
      const out = applyWaiver(res, waivers);
      assert.equal(out.state, 'SKIPPED');
      assert.ok(String(out.reason).startsWith('waiver:'));
    }],
    ['applyWaiver: FAIL + class security -> still FAIL', () => {
      const res = { id: 'audit', class: 'security', state: 'FAIL', exit: 1 };
      const waivers = [{
        version: 1, owner: 't', reason: 'flake', scope: 'audit',
        expiry: '2099-01-01T00:00:00.000Z', compensation: 'x',
        created_at: '2026-01-01T00:00:00.000Z',
      }];
      const out = applyWaiver(res, waivers);
      assert.equal(out.state, 'FAIL');
    }],
    ['applyWaiver: FAIL + class privacy -> still FAIL (never waivable)', () => {
      const res = { id: 'pii-scan', class: 'privacy', state: 'FAIL', exit: 1 };
      const waivers = [{
        version: 1, owner: 't', reason: 'flake', scope: 'pii-scan',
        expiry: '2099-01-01T00:00:00.000Z', compensation: 'x',
        created_at: '2026-01-01T00:00:00.000Z',
      }];
      assert.equal(applyWaiver(res, waivers).state, 'FAIL');
    }],
    ['runCheck fast + safety class -> still runs (never SKIPPED)', () => {
      const r = runCheck({ id: 'haz', command: NODE + ' --version', class: 'safety', allowFastSkip: true }, { fastActive: true });
      assert.equal(r.state, 'PASS');
    }],
    ['applyWaiver: FAIL + class safety -> still FAIL', () => {
      const res = { id: 'haz', class: 'safety', state: 'FAIL', exit: 1 };
      const waivers = [{ scope: 'haz' }];
      assert.equal(applyWaiver(res, waivers).state, 'FAIL');
    }],

    // S11 -- tier normalization + attribute lint codes.
    ['normalizeTier accepts string and {tier,reason}', () => {
      assert.deepEqual(normalizeTier('high'), { tier: 'high', reason: '' });
      assert.deepEqual(normalizeTier({ tier: 'none', reason: 'lib only' }), { tier: 'none', reason: 'lib only' });
    }],
    ['lint UNKNOWN_ATTRIBUTE / UNKNOWN_TIER / UNJUSTIFIED_TIER', () => {
      const cat = { version: 1, modules: [
        { id: 'a', paths: ['a/**'], attributes: { bogus: 'high' } },
        { id: 'b', paths: ['b/**'], attributes: { security: 'ultra' } },
        { id: 'c', paths: ['c/**'], attributes: { privacy: 'none' } },
      ] };
      const r = lintCatalog(cat, []);
      assert.ok(hasCode(r.errors, 'UNKNOWN_ATTRIBUTE'));
      assert.ok(hasCode(r.errors, 'UNKNOWN_TIER'));
      assert.ok(hasCode(r.errors, 'UNJUSTIFIED_TIER'));
    }],
    ['lint SELF_FORBIDDEN / FORBIDDEN_DECLARED / UNKNOWN_LAYER', () => {
      const cat = { version: 1, layers: ['app'], modules: [
        { id: 'a', paths: ['a/**'], forbiddenDependencies: ['a'] },
        { id: 'b', paths: ['b/**'], dependsOn: ['a'], forbiddenDependencies: ['a'] },
        { id: 'c', paths: ['c/**'], layer: 'ghost' },
      ] };
      const r = lintCatalog(cat, []);
      assert.ok(hasCode(r.errors, 'SELF_FORBIDDEN'));
      assert.ok(hasCode(r.errors, 'FORBIDDEN_DECLARED'));
      assert.ok(hasCode(r.errors, 'UNKNOWN_LAYER'));
    }],

    // S11 -- attribute coverage decisions (pure, fs-free).
    ['attributes: PASS claiming check covers the attribute', () => {
      const cat = attrCatalog();
      const r = assessAttributes(['pay'], cat, [{ module: 'pay', id: 'sec-scan', state: 'PASS' }]);
      const e = r.attributes.find(a => a.attribute === 'security');
      assert.equal(e.covered, true);
      assert.equal(r.blockingGaps.length, 0);
    }],
    ['attributes: failing claim outweighs a passing one', () => {
      const cat = attrCatalog({ verification: ['sec-scan', 'sec-audit'] });
      const r = assessAttributes(['pay'], cat, [
        { module: 'pay', id: 'sec-scan', state: 'PASS' },
        { module: 'pay', id: 'sec-audit', state: 'FAIL' },
      ]);
      const e = r.attributes.find(a => a.attribute === 'security');
      assert.equal(e.covered, false);
      assert.ok(r.blockingGaps.some(g => g.attribute === 'security'));
    }],
    ['attributes: declared but unwired -> visible blocking gap (high)', () => {
      const cat = attrCatalog({ attributes: { security: 'critical', resilience: 'high' } });
      const r = assessAttributes(['pay'], cat, [{ module: 'pay', id: 'sec-scan', state: 'PASS' }]);
      const e = r.attributes.find(a => a.attribute === 'resilience');
      assert.equal(e.covered, false);
      assert.ok(/no check/.test(e.reason));
      assert.ok(r.blockingGaps.some(g => g.attribute === 'resilience'));
    }],
    ['attributes: none tier -> opted out, never a gap', () => {
      const cat = attrCatalog({ attributes: { availability: { tier: 'none', reason: 'no service surface' } } });
      const r = assessAttributes(['pay'], cat, []);
      const e = r.attributes.find(a => a.attribute === 'availability');
      assert.equal(e.covered, true);
      assert.equal(e.enforcement, 'opted-out');
      assert.equal(r.blockingGaps.length, 0);
    }],
    ['attributes: high gap deferred by attribute waiver; critical never', () => {
      const cat = attrCatalog({ attributes: { resilience: 'high', security: 'critical' } });
      const waivers = [{ scope: 'attribute:pay/resilience' }, { scope: 'attribute:pay/security' }];
      const r = assessAttributes(['pay'], cat, [], waivers);
      const res = r.attributes.find(a => a.attribute === 'resilience');
      assert.equal(res.waived, true);
      assert.ok(!r.blockingGaps.some(g => g.attribute === 'resilience'));
      assert.ok(r.blockingGaps.some(g => g.attribute === 'security'));
    }],
    ['attributes: security/safety attribute waiver is unrepresentable (forbidden keyword)', () => {
      const w = {
        version: 1, owner: 't', reason: 'defer evidence', scope: 'attribute:pay/security',
        expiry: '2099-01-01T00:00:00.000Z', compensation: 'wire scanner next sprint',
        created_at: '2026-01-01T00:00:00.000Z',
      };
      assert.ok(validateWaiver(w).some(e => /forbidden|keyword/i.test(e)));
    }],
    ['extractImports: js import/require/dynamic/export-from', () => {
      const src = 'import a from "mod-a";\nexport { x } from "./rel";\nconst b = require("pkg/b");\nawait import("dyn");\n';
      const got = extractImports('src/x.ts', src);
      assert.ok(got.includes('mod-a') && got.includes('./rel') && got.includes('pkg/b') && got.includes('dyn'));
    }],
    ['moduleForSpecifier: longest provides prefix wins', () => {
      const cat = { modules: [
        { id: 'core', paths: ['core/**'], provides: ['@acme'] },
        { id: 'db', paths: ['db/**'], provides: ['@acme/db'] },
      ] };
      assert.equal(moduleForSpecifier(cat, '@acme/db/client'), 'db');
      assert.equal(moduleForSpecifier(cat, '@acme/util'), 'core');
      assert.equal(moduleForSpecifier(cat, 'left-pad'), null);
    }],
    ['layerViolation: outward-reaching dependency flagged, inward ok', () => {
      const cat = { layers: ['app', 'domain', 'infra'] };
      const app = { id: 'a', layer: 'app' };
      const domain = { id: 'd', layer: 'domain' };
      assert.equal(layerViolation(cat, app, domain), null);            // inward ok
      assert.ok(/may not depend/.test(layerViolation(cat, domain, app)));  // outward violation
      assert.equal(layerViolation(cat, app, app), null);               // same layer ok
      assert.equal(layerViolation(cat, app, { id: 'x' }), null);       // missing layer -> null
    }],
    ['findCycles detects a->b->a', () => {
      const edges = new Map([['a', new Set(['b'])], ['b', new Set(['a'])], ['c', new Set()]]);
      const cycles = findCycles(edges);
      assert.ok(cycles.length >= 1);
      assert.ok(cycles[0].includes('a') && cycles[0].includes('b'));
    }],

    // S13 -- fitness rules (pure over injected contents). The fixtures below are the very
    // patterns the rules hunt for, so each one carries an inline suppression marker: without
    // it fitness reports this file on every run, and a gate that is red forever is a gate
    // nobody reads. The marker is per line -- the rules themselves stay in force here.
    ['fitness: secret literal is an error finding', () => {
      const f = scanFitness([{ path: 'src/cfg.ts', content: 'const apiKey = "AKIAABCDEFGHIJKLMNOP";\n' }], null, DEFAULT_FITNESS_RULES);  // scan-secrets:ignore harness-fitness:ignore fixture
      assert.ok(f.some(x => x.rule === 'no-secret-literal' && x.severity === 'error'));
    }],
    ['fitness: suppression marker kills exactly that finding', () => {
      const content = '// harness-fitness:ignore\nconst password = "abcdefghijklmnop123456";\n';  // scan-secrets:ignore fixture
      const f = scanFitness([{ path: 'src/cfg.ts', content }], null, DEFAULT_FITNESS_RULES);
      assert.ok(!f.some(x => x.rule === 'no-secret-literal'));
    }],
    ['fitness: pii in log call flagged', () => {
      const f = scanFitness([{ path: 'src/a.ts', content: 'logger.info("user " + email + " ssn " + ssn)\n' }], null, DEFAULT_FITNESS_RULES);  // harness-fitness:ignore fixture
      assert.ok(f.some(x => x.rule === 'no-pii-in-logs'));
    }],
    ['fitness: empty catch flagged as silent failure', () => {
      const f = scanFitness([{ path: 'src/a.ts', content: 'try { x() } catch (e) {}\n' }], null, DEFAULT_FITNESS_RULES);  // harness-fitness:ignore fixture
      assert.ok(f.some(x => x.rule === 'no-silent-failure'));
    }],
    ['fitness: unbounded retry loop flagged', () => {
      const f = scanFitness([{ path: 'src/a.ts', content: 'while (true) {\n  await fetch(url);\n}\n' }], null, DEFAULT_FITNESS_RULES);  // harness-fitness:ignore fixture
      assert.ok(f.some(x => x.rule === 'no-unbounded-retry'));
    }],
    ['assessAdrRecords: machine ok / manual-only listed / missing fails / phantom fails / retired exempt', () => {
      const recs = [
        { id: 'A1', status: 'accepted', enforcedRaw: 'arch-check / layers', revisitRaw: '\u65e5\u6d3b\u8d85\u8fc7 5 \u4e07', reversalRaw: '\u6539\u56de\u5355\u5e93\uFF0C\u7ea6 2 \u5929' },
        { id: 'A2', status: 'accepted', enforcedRaw: '\u65e0\u6cd5\u673a\u5668\u6267\u6cd5\uFF0C\u9760\u8bc4\u5ba1', revisitRaw: '\u9700\u8981\u591a\u79df\u6237', reversalRaw: '\u62c6\u56de\u5355\u5b9e\u4f8b\uFF0C\u7ea6 1 \u5929' },
        { id: 'A3', status: 'accepted', enforcedRaw: '', revisitRaw: '\u7b2c\u4e09\u65b9\u505c\u6b62\u7ef4\u62a4', reversalRaw: '\u6362\u56de\u539f\u5e93\uFF0C\u7ea6 3 \u5929' },
        { id: 'A4', status: 'accepted', enforcedRaw: 'ghost-check-typo', revisitRaw: '\u4e00\u65e6\u5f15\u5165\u591a\u79df\u6237', reversalRaw: '\u56de\u6eda\u914d\u7f6e\uFF0C\u7ea6\u534a\u5929' },
        { id: 'A5', status: 'superseded', enforcedRaw: '' },
      ];
      const r = assessAdrRecords(recs, [], DEFAULT_FITNESS_RULES.map(x => x.id));
      const by = Object.fromEntries(r.records.map(x => [x.id, x]));
      assert.ok(by.A1.ok && !by.A1.manualOnly);
      assert.ok(by.A2.ok && by.A2.manualOnly);
      assert.ok(!by.A3.ok && /enforcement/i.test(by.A3.reason));
      assert.ok(!by.A4.ok && /phantom|recognizable/.test(by.A4.reason));
      // A5 declares none of the three fields; retirement exempts it from all of them.
      assert.ok(by.A5.ok && by.A5.retired);
      assert.equal(r.failing.length, 2);
    }],
    ['assessAdrRecords: revisit-if is required -- absence fails, and the reason names that field only', () => {
      const r = assessAdrRecords([
        { id: 'B1', status: 'accepted', enforcedRaw: 'arch-check', reversalRaw: '\u6539\u56de\u5355\u5e93\uFF0C\u7ea6 2 \u5929' },
      ], [], []);
      const rec = r.records[0];
      assert.ok(!rec.ok, 'an active ADR that names no expiry condition must not pass');
      assert.ok(/revisit-if|\u5931\u6548\u6761\u4ef6/.test(rec.reason), rec.reason);
      assert.ok(!/reversal/.test(rec.reason), 'a declared reversal must not be reported missing');
      assert.equal(r.failing.length, 1);
    }],
    ['assessAdrRecords: reversal is required -- absence fails, and the reason names that field only', () => {
      const r = assessAdrRecords([
        { id: 'B2', status: 'accepted', enforcedRaw: 'arch-check', revisitRaw: '\u9700\u8981\u591a\u79df\u6237' },
      ], [], []);
      const rec = r.records[0];
      assert.ok(!rec.ok, 'an active ADR that names no reversal cost must not pass');
      assert.ok(/reversal|\u64a4\u56de\u4ee3\u4ef7/.test(rec.reason), rec.reason);
      assert.ok(!/revisit-if|\u5931\u6548\u6761\u4ef6/.test(rec.reason), 'a declared revisit-if must not be reported missing');
      assert.equal(r.failing.length, 1);
    }],
    ['assessAdrRecords: a record missing both fields reports both problems in one reason', () => {
      const r = assessAdrRecords([
        { id: 'B3', status: 'accepted', enforcedRaw: 'arch-check' },
      ], [], []);
      const rec = r.records[0];
      assert.ok(!rec.ok);
      assert.ok(/revisit-if|\u5931\u6548\u6761\u4ef6/.test(rec.reason), rec.reason);
      assert.ok(/reversal|\u64a4\u56de\u4ee3\u4ef7/.test(rec.reason), rec.reason);
    }],
    ['assessAdrRecords: revisit-if written as a calendar reminder is not a condition', () => {
      const recs = [
        { id: 'C1', status: 'accepted', enforcedRaw: 'arch-check', revisitRaw: '\u4e09\u4e2a\u6708\u540e\u518d\u770b', reversalRaw: '\u6539\u56de\u5355\u5e93\uFF0C\u7ea6 2 \u5929' },
        { id: 'C2', status: 'accepted', enforcedRaw: 'arch-check', revisitRaw: '\u89c6\u60c5\u51b5', reversalRaw: '\u6539\u56de\u5355\u5e93\uFF0C\u7ea6 2 \u5929' },
      ];
      const r = assessAdrRecords(recs, [], []);
      const by = Object.fromEntries(r.records.map(x => [x.id, x]));
      assert.ok(!by.C1.ok && /revisit-if/.test(by.C1.reason), by.C1.reason);
      // The refused value is quoted back: the author has to see which words got rejected.
      assert.ok(by.C1.reason.includes('\u4e09\u4e2a\u6708\u540e\u518d\u770b'));
      assert.ok(!by.C2.ok && /revisit-if/.test(by.C2.reason), by.C2.reason);
      assert.equal(r.failing.length, 2);
    }],
    ['assessAdrRecords: a time word riding along a real condition still passes (a false red costs more than a miss)', () => {
      const r = assessAdrRecords([
        { id: 'C3', status: 'accepted', enforcedRaw: 'arch-check', revisitRaw: '\u534a\u5e74\u540e\u4ecd\u65e0\u4e8c\u5f00\u9700\u6c42\uFF0C\u6216\u65e5\u6d3b\u8d85\u8fc7 5 \u4e07', reversalRaw: '\u6539\u56de\u5355\u5e93\uFF0C\u7ea6 2 \u5929' },
      ], [], []);
      assert.ok(r.records[0].ok, r.records[0].reason);
      assert.equal(r.failing.length, 0);
    }],
    ['assessAdrRecords: an explicit one-way-door reversal passes and is listed; a retired one is not', () => {
      const recs = [
        { id: 'D1', status: 'accepted', enforcedRaw: 'arch-check', revisitRaw: '\u9700\u8981\u591a\u79df\u6237', reversalRaw: '\u5355\u5411\u95e8' },
        { id: 'D2', status: 'accepted', enforcedRaw: 'arch-check', revisitRaw: '\u9700\u8981\u591a\u79df\u6237', reversalRaw: 'one-way door' },
        { id: 'D3', status: 'superseded', enforcedRaw: '', reversalRaw: '\u5355\u5411\u95e8' },
      ];
      const r = assessAdrRecords(recs, [], []);
      const by = Object.fromEntries(r.records.map(x => [x.id, x]));
      assert.ok(by.D1.ok, by.D1.reason);
      assert.ok(by.D1.oneWayDoor && by.D2.oneWayDoor);
      assert.ok(!by.D3.oneWayDoor, 'a retired decision is not a live one-way door');
      // The same selection the adr-check report makes when it lists one-way doors.
      assert.deepEqual(r.records.filter(x => x.oneWayDoor).map(x => x.id), ['D1', 'D2']);
      assert.equal(r.failing.length, 0);
    }],
    ['compareRatchet: single record -> baseline, not comparable', () => {
      const r = compareRatchet([{ undeclared: 5, forbidden: 0, cycles: 0 }]);
      assert.equal(r.comparable, false);
      assert.equal(r.regressed.length, 0);
      assert.equal(r.summary.undeclared.baseline, 5);
    }],
    ['compareRatchet: regression beyond best historical value is flagged', () => {
      const r = compareRatchet([
        { undeclared: 5, forbidden: 0, cycles: 0 },
        { undeclared: 2, forbidden: 0, cycles: 0 },
        { undeclared: 4, forbidden: 0, cycles: 0 },
      ]);
      assert.ok(r.regressed.some(x => x.metric === 'undeclared' && x.latest === 4 && x.bestBefore === 2));
    }],
    ['compareRatchet: equal to best -> no regression (ratchet holds)', () => {
      const r = compareRatchet([
        { undeclared: 2, forbidden: 0, cycles: 0 },
        { undeclared: 2, forbidden: 0, cycles: 0 },
      ]);
      assert.equal(r.regressed.length, 0);
    }],
    ['compareRatchet: a forbidden edge violates whatever the history says', () => {
      const r = compareRatchet([
        { undeclared: 0, forbidden: 2, cycles: 0, forbiddenEdges: ['analytics->pii-store', 'web->pii-store'] },
        { undeclared: 0, forbidden: 1, cycles: 0, forbiddenEdges: ['analytics->pii-store'] },
      ]);
      assert.ok(r.forbiddenViolation, 'no baseline may license a declared boundary');
      assert.equal(r.forbiddenViolation.count, 1);
      assert.deepEqual(r.forbiddenViolation.edges, ['analytics->pii-store']);
      assert.ok(!r.regressed.some(x => x.metric === 'forbidden'));
    }],
    ['ledger: chain = sha256(prev + NUL + contentHash)', () => {
      const line = ledgerLine({ a: 1 }, GENESIS);
      assert.equal(line.contentHash, sha256Lf(JSON.stringify({ a: 1 })));
      assert.equal(line.chain, chainHash(GENESIS, line.contentHash));
    }],
    ['ledger: an untouched three-line chain verifies, head is the last link', () => {
      const lines = chainLines([gateRec(), gateRec({ gate: 'FAIL' }), gateRec()]);
      const r = verifyLedgerChain(lines);
      assert.ok(r.ok, JSON.stringify(r.breaks));
      assert.equal(r.entries, 3);
      assert.equal(r.head, lines[2].chain);
    }],
    ['ledger: editing a recorded field -> content-hash-mismatch on that line', () => {
      const lines = chainLines([gateRec(), gateRec({ gate: 'FAIL' }), gateRec()]);
      lines[1].gate = 'PASS';                       // the interesting forgery: turn a red green
      const r = verifyLedgerChain(lines);
      assert.ok(!r.ok);
      assert.ok(r.breaks.some(b => b.line === 2 && b.reason === 'content-hash-mismatch'), JSON.stringify(r.breaks));
    }],
    ['ledger: a forged chain value -> chain-hash-mismatch', () => {
      const lines = chainLines([gateRec(), gateRec()]);
      lines[1].chain = 'f'.repeat(64);
      const r = verifyLedgerChain(lines);
      assert.ok(!r.ok);
      assert.ok(r.breaks.some(b => b.line === 2 && b.reason === 'chain-hash-mismatch'));
    }],
    ['ledger verdict: an intact chain is ok at exit 0', () => {
      const r = ledgerReport({ entries: chainLines([gateRec(), gateRec()]) });
      assert.equal(r.code, 0);
      assert.ok(r.result.ok);
      assert.equal(r.result.evidence, null, 'evidence:null means the digests were not checked this run');
    }],
    ['ledger verdict: a break is a failure at exit 1', () => {
      const lines = chainLines([gateRec(), gateRec()]);
      lines[1].gate = 'FAIL';
      const r = ledgerReport({ entries: lines });
      assert.equal(r.code, 1);
      assert.equal(r.result.ok, false);
    }],
    ['ledger verdict: an unreadable ledger degrades at exit 3, never a clean empty chain', () => {
      const r = ledgerReport({ entries: [], unreadable: 'EACCES' });
      assert.equal(r.code, 3, 'unknown is not intact');
      assert.equal(r.result.ok, false);
      assert.equal(r.result.entries, null, 'and it must not report zero entries as if the file were empty');
      assert.equal(r.result.unreadable, 'EACCES');
    }],
    ['ledger verdict: intact chain + tampered evidence is still a failure', () => {
      const r = ledgerReport({
        entries: chainLines([gateRec()]),
        evidence: { ok: false, checked: 1, breaks: [{ line: 1, reason: 'evidence-tampered' }] },
      });
      assert.equal(r.code, 1);
      assert.equal(r.result.ok, false);
    }],

    // S17.2c evidence digests -- a hash that is written and never read is decoration.
    ['evidence: a log whose bytes moved is evidence-tampered', () => {
      const rec = gateRec({ results: [{ id: 'unit', evidence: 'e/unit.log', evidenceSha256: sha256Lf('original') }] });
      const r = evidenceFindings(chainLines([rec]), { readFile: () => 'rewritten' });
      assert.equal(r.ok, false);
      assert.equal(r.checked, 1);
      assert.equal(r.breaks[0].reason, 'evidence-tampered');
      assert.equal(r.breaks[0].check, 'unit');
    }],
    ['evidence: a log that cannot be read is evidence-missing, not skipped', () => {
      const rec = gateRec({ results: [{ id: 'unit', evidence: 'e/unit.log', evidenceSha256: sha256Lf('original') }] });
      const r = evidenceFindings(chainLines([rec]), {
        readFile: () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; },
      });
      assert.equal(r.ok, false);
      assert.equal(r.breaks[0].reason, 'evidence-missing');
      assert.equal(r.breaks[0].detail, 'ENOENT');
    }],
    ['buildPlan: entries sorted by check id, modules sorted, empty flag', () => {
      const p = buildPlan(['pay'], attrCatalog({ verification: ['sec-audit', 'sec-scan'] }));
      assert.deepEqual(p.entries.map(e => e.checkId), ['sec-audit', 'sec-scan']);
      assert.deepEqual(p.entries[0].modules, ['pay']);
      assert.equal(p.empty, false);
      assert.equal(buildPlan([], attrCatalog()).empty, true);
    }],
    ['gateReason: every gate state gets its own why', () => {
      assert.equal(gateReason('FAIL', { checks: [], attributeGaps: [], emptyPlan: false }), 'at-least-one-check-failed');
      assert.equal(gateReason('BLOCKED', { checks: [], attributeGaps: [], emptyPlan: false }), 'at-least-one-check-blocked');
      assert.ok(gateReason('BLOCKED', { checks: [], attributeGaps: [], emptyPlan: true }).startsWith('empty-plan:'));
      assert.ok(gateReason('BLOCKED_BY_ATTRIBUTES', { checks: [], attributeGaps: [1], emptyPlan: false }).startsWith('1 blocking'));
      assert.equal(gateReason('PASS', { checks: [], attributeGaps: [], emptyPlan: false }), 'no-affected-module');
      assert.equal(gateReason('PASS', { checks: [{ state: 'SKIPPED' }], attributeGaps: [], emptyPlan: false }), 'every-check-skipped');
      assert.equal(gateReason('PASS', { checks: [{ state: 'PASS' }], attributeGaps: [], emptyPlan: false }), 'all-executed-checks-passed');
    }],
    ['gate-audit: a check that never failed is listed as neverIntervened', () => {
      const cat = { checks: { 'sec-scan': {}, 'unit': {} } };
      const r = auditGates(chainLines([gateRec({ results: [{ id: 'sec-scan', state: 'PASS' }] })]), cat);
      assert.equal(r.gateRuns, 1);
      assert.deepEqual(r.neverIntervened, ['sec-scan', 'unit']);
      assert.deepEqual(r.neverExecuted, ['unit']);
    }],
    ['gate-audit: one failure drops a check off neverIntervened', () => {
      const cat = { checks: { 'sec-scan': {} } };
      const r = auditGates(chainLines([gateRec({ results: [{ id: 'sec-scan', state: 'FAIL' }] })]), cat);
      assert.deepEqual(r.neverIntervened, []);
      assert.ok(r.advice.includes('intervened at least once'));
    }],
    ['gate-audit: a fast-mode skip is deferred, not a suppressed verdict', () => {
      const cat = { checks: { unit: {} } };
      const rec = gateRec({ results: [{ id: 'unit', state: 'SKIPPED', reason: 'fast-mode', suppressed: { by: 'fast-mode', scope: null, from: null } }] });
      const r = auditGates(chainLines([rec]), cat);
      assert.deepEqual(r.neverExecuted, ['unit'], 'it genuinely did not run');
      assert.deepEqual(r.suppressed.map(s => s.by), [['fast-mode']], 'but it is still not silence');
    }],
    ['retention: a ledger-referenced evidence file is never a candidate', () => {
      const files = [{ path: 'e/a.log', mtimeMs: 10 }, { path: 'e/b.log', mtimeMs: 5 }];
      const plan = planRetention(files, { protectedPaths: new Set(['e/b.log']), keep: 0, cutoffMs: 0 });
      assert.deepEqual(plan.map(p => p.path), ['e/a.log']);
    }],
    ['retention: the newest `keep` files survive, the rest are over-count', () => {
      const files = [{ path: 'a', mtimeMs: 30 }, { path: 'b', mtimeMs: 20 }, { path: 'c', mtimeMs: 10 }];
      const plan = planRetention(files, { keep: 2, cutoffMs: 0 });
      assert.deepEqual(plan, [{ path: 'c', reason: 'over-count' }]);
    }],
    ['retention: an unreadable ledger stops the sweep before it plans anything', () => {
      const r = retentionRefusal('EACCES', null);
      assert.equal(r.reason, 'ledger-unreadable');
      assert.equal(r.detail, 'EACCES');
    }],
    ['risk: clean state produces no findings', () => {
      const r = riskFindings({ ledgerEntries: chainLines([gateRec()]), catalog: null, waivers: [], task: null });
      assert.ok(r.ok);
      assert.equal(r.findings.length, 0);
    }],
    ['risk: a broken chain is LEDGER_BROKEN at error severity', () => {
      const lines = chainLines([gateRec(), gateRec()]);
      lines[1].gate = 'FAIL';
      const r = riskFindings({ ledgerEntries: lines });
      assert.ok(!r.ok);
      assert.ok(r.findings.some(f => f.code === 'LEDGER_BROKEN' && f.severity === 'error'));
    }],
    ['risk: a blocking attribute with no claiming check is UNWIRED_ATTRIBUTE', () => {
      const gap = riskFindings({ catalog: attrCatalog({ attributes: { privacy: 'critical' } }) });
      assert.ok(gap.findings.some(f => f.code === 'UNWIRED_ATTRIBUTE' && f.attribute === 'privacy'));
      const wired = riskFindings({ catalog: attrCatalog() });    // security:critical, sec-scan claims it
      assert.ok(!wired.findings.some(f => f.code === 'UNWIRED_ATTRIBUTE'));
    }],
    ['risk: three consecutive failures are FAIL_STREAK; a pass resets the count', () => {
      const three = [1, 2, 3].map(() => gateRec({ gate: 'FAIL', results: [{ id: 'unit', state: 'FAIL' }] }));
      assert.ok(riskFindings({ ledgerEntries: chainLines(three) }).findings.some(f => f.code === 'FAIL_STREAK'));
      const reset = chainLines(three.concat([gateRec({ results: [{ id: 'unit', state: 'PASS' }] })]));
      assert.ok(!riskFindings({ ledgerEntries: reset }).findings.some(f => f.code === 'FAIL_STREAK'));
    }],
    ['risk: fast-mode skips in the newest gate are FAST_MODE_DEBT (deferred, not waived)', () => {
      const lines = chainLines([gateRec({ fastActive: true, skippedByFastMode: ['unit'] })]);
      const r = riskFindings({ ledgerEntries: lines });
      assert.ok(!r.ok);
      assert.ok(r.findings.some(f => f.code === 'FAST_MODE_DEBT' && f.severity === 'error'));
    }],
    ['envelope: a complete six-field envelope validates', () => {
      const v = validateEnvelope(envelope());
      assert.ok(v.ok);
      assert.deepEqual(v.missing, []);
    }],
    ['envelope: missing fields are named one by one', () => {
      const v = validateEnvelope(envelope({ outOfScope: undefined, escalation: undefined }));
      assert.ok(!v.ok);
      assert.deepEqual(v.missing, ['outOfScope', 'escalation']);
    }],
    ['envelope: an id of only illegal characters is rejected by name', () => {
      assert.deepEqual(validateEnvelope(envelope({ id: '..' })).missing, ['id']);
    }],
    ['task record: id is sanitized and capped, engine fields are added', () => {
      // Separators are what escape a directory, so those are the characters that die;
      // dots survive, and the result can no longer name anything outside one segment.
      const rec = buildTaskRecord(envelope({ id: '../../etc/passwd' }), { now: 'T', baseCommit: 'c0' });
      assert.equal(rec.id, '.._.._etc_passwd');
      assert.equal(rec.state, 'active');
      assert.equal(rec.baseCommit, 'c0');
      assert.equal(rec.startedAt, 'T');
      const long = buildTaskRecord(envelope({ id: 'a'.repeat(200) }), { now: 'T', baseCommit: null });
      assert.equal(long.id.length, 120);
    }],

    // S18.1 task complete -- four conditions, each blocking on its own.
    ['task complete: all four conditions met -> no blockers', () => {
      const blockers = completeBlockers({
        latestGate: gateRec({ gate: 'PASS', diffHash: 'D0' }), currentDiffHash: 'D0',
        receipts: [okReceipt()], ledgerOk: true, planEmpty: false,
      });
      assert.deepEqual(blockers, []);
    }],
    ['task complete: a gate bound to another diff blocks', () => {
      const blockers = completeBlockers({
        latestGate: gateRec({ gate: 'PASS', diffHash: 'OTHER' }), currentDiffHash: 'D0',
        receipts: [okReceipt()], ledgerOk: true, planEmpty: false,
      });
      assert.equal(blockers.length, 1);
      assert.ok(blockers[0].includes('no PASS gate record bound to the current diffHash'));
    }],
    ['task complete: a failing gate blocks even when it is the current diff', () => {
      const blockers = completeBlockers({
        latestGate: gateRec({ gate: 'FAIL', diffHash: 'D0' }), currentDiffHash: 'D0',
        receipts: [okReceipt()], ledgerOk: true, planEmpty: false,
      });
      assert.equal(blockers.length, 1);
    }],
    ['task complete: no accepting receipt for this diff blocks', () => {
      const stale = completeBlockers({
        latestGate: gateRec(), currentDiffHash: 'D0',
        receipts: [okReceipt({ diffHash: 'OTHER' })], ledgerOk: true, planEmpty: false,
      });
      assert.ok(stale.some(b => b.includes('accepting review receipt')));
      const rejected = completeBlockers({
        latestGate: gateRec(), currentDiffHash: 'D0',
        receipts: [okReceipt({ verdict: 'FIX_REQUIRED' })], ledgerOk: true, planEmpty: false,
      });
      assert.ok(rejected.some(b => b.includes('accepting review receipt')));
    }],
    ['task complete: a PASS in which every check was skipped established nothing', () => {
      const allSkipped = gateRec({ reason: 'every-check-skipped', fastActive: true, skippedByFastMode: ['unit'],
        results: [{ id: 'unit', state: 'SKIPPED', reason: 'fast-mode' }] });
      const blockers = completeBlockers({
        latestGate: allSkipped, currentDiffHash: 'D0', receipts: [okReceipt()],
        ledgerOk: true, planEmpty: false,
      });
      assert.equal(blockers.length, 1);
      assert.ok(blockers[0].includes('deferred, not obtained'));
      // One executed check among the skips is enough to have established something.
      assert.deepEqual(completeBlockers({
        latestGate: gateRec({ results: [{ id: 'unit', state: 'SKIPPED' }, { id: 'lint', state: 'PASS' }] }),
        currentDiffHash: 'D0', receipts: [okReceipt()], ledgerOk: true, planEmpty: false,
      }), []);
    }],
    ['task complete: the newest gate record decides, not the first one', () => {
      const entries = chainLines([
        gateRec({ diffHash: 'OLD' }),
        { command: 'other', at: 'x' },
        gateRec({ diffHash: 'NEW', gate: 'FAIL' }),
      ]);
      const latest = latestGateRecord(entries);
      assert.equal(latest.diffHash, 'NEW');
      assert.equal(latest.gate, 'FAIL');
      assert.equal(latestGateRecord([{ corrupt: true, raw: 'x' }, { command: 'other' }]), null);
    }],

    // S18.2 budget -- over the line is a signal, so the finding must carry the numbers.
    ['budget: within every limit -> ok', () => {
      const r = assessBudget({ changedFiles: 2, changedLines: 10, modulesTouched: 1, newFiles: 0 }, budgetCat);
      assert.ok(r.ok);
      assert.deepEqual(r.findings, []);
    }],
    ['lock: a held lock is not handed out twice, and a waiter gives up instead of hanging', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccbase-selftest-lock-'));
      const lock = path.join(dir, 'x.lock');
      try {
        let second = null;
        const held = withDirLock(lock, () => {
          assert.ok(fs.existsSync(lock), 'the lock exists while it is held');
          try { withDirLock(lock, () => { second = 'acquired twice'; }, { timeoutMs: 40, pollMs: 5 }); }
          catch (e) { second = String(e && e.message || e); }
          return 'body ran';
        });
        assert.equal(held, 'body ran');
        assert.ok(/could not acquire lock/.test(String(second)), 'second acquire must fail: ' + second);
        assert.ok(!fs.existsSync(lock), 'and the lock is released when the body returns');
        assert.throws(() => withDirLock(lock, () => { throw new Error('boom'); }), /boom/);
        assert.ok(!fs.existsSync(lock), 'a throwing body must not leave the lock behind');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }],
    ['ledger append: a killed write costs one line, not the record that follows it', () => {
      // The only case in this file that drives appendLedger end to end, because the bug it
      // locks is in the framing rather than in any of the pure parts: a fragment with no
      // terminator used to have the next record appended straight onto it, so one
      // interrupted write destroyed two records, the good one included.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccbase-selftest-ledger-'));
      const saved = process.env.CLAUDE_PROJECT_DIR;
      try {
        process.env.CLAUDE_PROJECT_DIR = dir;
        appendLedger({ command: 'gate', at: 'T1' });
        fs.appendFileSync(ledgerFilePath(), '{"command":"gate","at":"T2","gate":"PA', 'utf8');
        appendLedger({ command: 'gate', at: 'T3' });
        const entries = parseLedgerLines(fs.readFileSync(ledgerFilePath(), 'utf8'));
        assert.equal(entries.length, 3);
        assert.equal(entries.filter(e => e.corrupt).length, 1, 'exactly one line is unreadable');
        assert.equal(entries[2].at, 'T3', 'the record after the fragment survives intact');
      } finally {
        if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
        else process.env.CLAUDE_PROJECT_DIR = saved;
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }],
    ['spec-lint: a well-formed document is clean, and one arrow is enough', () => {
      const r = lintSpecDoc(specDoc([
        '- import: the user uploads a CSV -> the system parses it -> the row count is shown',
        '- export: the user clicks export -> a CSV is downloaded',
      ]), 'Product-Spec.md');
      assert.ok(r.ok, 'clean document produced ' + JSON.stringify(codesOf(r)));
      assert.equal(r.requirements, 2);
      assert.equal(r.counts.error, 0);
      assert.equal(r.counts.warning, 0);
    }],
    ['spec-lint: a requirement with no arrow states no flow', () => {
      const r = lintSpecDoc(specDoc([
        '- import: the user uploads a CSV -> the row count is shown',
        '- reporting, with several formats',
      ]), 'Product-Spec.md');
      const flow = r.findings.filter(f => f.code === 'NO_FLOW');
      assert.equal(flow.length, 1, 'exactly the arrowless item must be named');
      assert.ok(flow[0].excerpt.includes('reporting'));
      assert.equal(r.ok, false);
    }],
    ['spec-lint: a missing section and an empty one are both errors', () => {
      const withoutScenario = specDoc(['- a: b -> c']).replace('## ' + REQUIRED_SECTIONS[1], '## other');
      assert.ok(codesOf(lintSpecDoc(withoutScenario, 'f.md')).includes('MISSING_SECTION'));
      const emptied = specDoc(['- a: b -> c'], { overview: '' });
      assert.ok(codesOf(lintSpecDoc(emptied, 'f.md')).includes('EMPTY_SECTION'));
    }],
    ['spec-lint: template residue is residue, markup is markup', () => {
      assert.deepEqual(placeholderBrackets('- <target user> uses <br> and <div class="x">'), ['<target user>']);
      assert.deepEqual(placeholderBrackets('closing tags are markup too: </section>'), []);
      const r = lintSpecDoc(specDoc(['- a: b -> c'], { tech: 'product type: <Web / Desktop / CLI>' }), 'f.md');
      assert.ok(codesOf(r).includes('PLACEHOLDER'));
    }],
    ['spec-lint: a fence that is never closed is an error, not a quiet skip', () => {
      const swallowed = 'module list: <not decided yet>';
      const doc = specDoc(['- a: b -> c']) + ['```', swallowed, ''].join('\n');
      const lines = doc.split('\n');
      const fence = lines.indexOf(swallowed);   // 开栏行就在它上面（0 基下标 = 1 基行号）
      const f = lintSpecDoc(doc, 'f.md').findings.filter((x) => x.code === 'UNCLOSED_FENCE');
      assert.deepEqual(f.map((x) => x.line), [fence],
        'the opener at line ' + fence + ' is where the document stopped being read; got ' + JSON.stringify(f));
    }],
    ['spec-lint: ids are optional, partial numbering is a warning, reuse is an error', () => {
      const none = lintSpecDoc(specDoc(['- a: b -> c']), 'f.md');
      assert.equal(none.ids.length, 0);
      assert.ok(none.ok, 'an unnumbered specification is valid; trace is what degrades');
      const partial = lintSpecDoc(specDoc([
        '- [REQ-IMP-001] import: a -> b',
        '- export: a -> b',
      ]), 'f.md');
      assert.deepEqual(partial.ids.map(x => x.id), ['REQ-IMP-001']);
      assert.ok(codesOf(partial).includes('PARTIAL_ID'));
      assert.ok(partial.ok, 'partial numbering is a warning, not a rejection');
      const dup = lintSpecDoc(specDoc([
        '- [REQ-IMP-001] import: a -> b',
        '- [REQ-IMP-001] export: a -> b',
      ]), 'f.md');
      assert.ok(codesOf(dup).includes('DUPLICATE_ID'));
      assert.equal(dup.ok, false);
    }],

    // S19 trace -- an anchor that nothing references is the finding; an anchor that does not
    // exist is a degraded answer, never an invented one (that half is the cmdTrace rc 3 path
    // the golden matrix records).
    ['trace: a test reference verifies, a code reference only implements', () => {
      const collected = collectReferences([
        { path: 'tests/import.test.js', content: '// covers REQ-IMP-001' },
        { path: 'src/report.js', content: '// implements REQ-REP-002' },
      ], ['**/tests/**', '**/*.test.*'], null);
      const r = traceReport([{ id: 'REQ-IMP-001', line: 1 }, { id: 'REQ-REP-002', line: 2 }], collected, 1);
      assert.deepEqual(r.unverified, ['REQ-REP-002']);
      assert.equal(r.verified, 1);
      assert.equal(r.coverage, 0.5);
      assert.equal(r.ok, false);
    }],
    ['dod: exit codes map to the three states', () => {
      assert.equal(dodStatus(0), 'PASS');
      assert.equal(dodStatus(3), 'DEGRADED');
      assert.equal(dodStatus(1), 'FAIL');
      assert.equal(dodStatus(2), 'FAIL');
    }],
    ['review team: an undeclared attribute drops its lens, correctness never drops', () => {
      const cat = {
        version: 1,
        modules: [{ id: 'core', paths: ['src/**'], attributes: { reliability: 'high' } }],
        review: { profile: 'production' },
      };
      const kept = reviewLenses(cat, { affected: ['core'] });
      assert.ok(kept.includes('correctness'), 'correctness is the floor of every review');
      assert.ok(kept.includes('testing'), 'reliability is declared high, so testing stays');
      assert.ok(!kept.includes('security'), 'nothing declares security, so no security lens');
      assert.deepEqual(lensExclusions(cat, ['core']).map(x => x.lens).sort(), ['architecture', 'performance', 'security']);
      // No affected list at all means no basis for subtracting: convene the whole profile.
      assert.deepEqual(reviewLenses(cat, {}), REVIEW_PROFILES.production);
    }],
    ['review stage: reporting is not passing, and a failed stage holds the gate shut', () => {
      const reported = reviewSession({ lenses: { correctness: lensRec(), architecture: lensRec() } });
      assert.equal(stagePassed(reported, 1), true);
      assert.equal(currentStage(reported), 2, 'a clean stage 1 opens stage 2');
      const failed = reviewSession({ lenses: { correctness: lensRec({ findings: [errFinding] }), architecture: lensRec() } });
      assert.equal(stagePassed(failed, 1), false);
      assert.equal(currentStage(failed), 1, 'expensive lenses must not open on code the cheap ones rejected');
      const unable = reviewSession({ lenses: { correctness: lensRec({ unable: true }), architecture: lensRec() } });
      assert.equal(currentStage(unable), 1, 'a lens that could not conclude has not passed either');
      const silent = reviewSession({ lenses: { correctness: lensRec() } });
      assert.equal(currentStage(silent), 1, 'stage 1 is not done while one of its lenses is silent');
    }],
    ['review lens: a finding needs a file:line or a reproduction, or the report is refused', () => {
      const bad = validateFindings({ findings: [{ severity: 'error', summary: 'feels wrong' }] });
      assert.equal(bad.ok, false);
      assert.deepEqual(bad.unlocated, [0]);
      const byLine = validateFindings({ findings: [{ severity: 'warning', location: 'src/a.js:3', summary: 'x' }] });
      assert.equal(byLine.ok, true);
      const byRepro = validateFindings({ findings: [{ severity: 'info', reproduction: 'node t.js -> exit 1', summary: 'x' }] });
      assert.equal(byRepro.ok, true);
      // A path with no line number is not a location: "somewhere in this file" is an impression.
      const noLine = validateFindings({ findings: [{ severity: 'error', location: 'src/a.js', summary: 'x' }] });
      assert.equal(noLine.ok, false);
      const sev = validateFindings({ findings: [{ severity: 'critical', location: 'src/a.js:3', summary: 'x' }] });
      assert.deepEqual([sev.ok, sev.badSeverity], [false, [0]]);
      assert.equal(validateFindings({ findings: [] }).ok, true, 'a clean lens reports nothing, and that is a report');
    }],
    ['review verdict: every lens clean and final gives ACCEPT', () => {
      const v = computeVerdict(reviewSession({ lenses: allClean }));
      assert.deepEqual([v.ok, v.verdict, v.stage, v.isFinal, v.errorCount], [true, 'ACCEPT', 3, true, 0]);
    }],
    ['review verdict: one located error is not outvoted by the lenses that found nothing', () => {
      const s = reviewSession({ lenses: { ...allClean, correctness: lensRec({ findings: [errFinding] }) } });
      const v = computeVerdict(s);
      assert.deepEqual([v.ok, v.verdict, v.errorCount, v.stage], [true, 'FIX_REQUIRED', 1, 1]);
      assert.equal(v.recordedLenses.length, 4, 'three clean reports beside it change nothing');
    }],
    ['review verdict: no blue and no current-stage report are refusals, not verdicts', () => {
      const noBlue = computeVerdict(reviewSession({ blue: null, lenses: allClean }));
      assert.deepEqual([noBlue.ok, noBlue.verdict], [false, null]);
      assert.ok(noBlue.blockers.some(b => b.includes('blue')));
      const silent = computeVerdict(reviewSession({ lenses: { correctness: lensRec() } }));
      assert.deepEqual([silent.ok, silent.verdict, silent.missingLenses], [false, null, ['architecture']]);
    }],
    ['authorship: only a record naming a file this diff touches makes anyone an author', () => {
      const records = [
        { agentId: 'impl-1', agentType: 'implementer', files: ['src/a.js', 'src/b.js'] },
        { agentId: 'impl-2', agentType: 'implementer', files: ['docs/old.md'] },
        { corrupt: true, raw: '{' },
        { agentType: 'implementer', files: ['src/a.js'] },
      ];
      const authors = authorSetFor(records, new Set(['src/a.js']));
      assert.deepEqual([...authors.keys()], ['impl-1'], 'a record about an untouched file says nothing here');
      assert.deepEqual(authors.get('impl-1').files, ['src/a.js']);
    }],
    ['authorship: a lens reported by an author cannot carry an ACCEPT', () => {
      const authors = authorSetFor([{ agentId: 'impl-1', files: ['src/a.js'] }], new Set(['src/a.js']));
      const s = reviewSession({ lenses: { ...allClean, correctness: lensRec({ agentId: 'impl-1' }) } });
      assert.deepEqual(selfReviewedLenses(s, authors).map(x => x.lens), ['correctness']);
      const v = computeVerdict(s, { authors });
      assert.deepEqual([v.ok, v.verdict], [false, null]);
      assert.ok(v.blockers[0].includes('self-review is not independent review'));
      // An outsider reporting the same lens is exactly what the rule asks for.
      const clean = computeVerdict(reviewSession({ lenses: { ...allClean, correctness: lensRec({ agentId: 'red-1' }) } }), { authors });
      assert.equal(clean.verdict, 'ACCEPT');
    }],
    ['review backlog: security, safety and privacy are never backloggable', () => {
      const base = { owner: '@me', expiry: '2099-01-01T00:00:00.000Z', summary: 'a missing bound', lens: 'reliability' };
      assert.deepEqual(backlogViolations(base), []);
      assert.equal(backlogViolations({ ...base, lens: 'security' }).length, 1);
      assert.equal(backlogViolations({ ...base, lens: 'privacy' }).length, 1);
      assert.equal(backlogViolations({ ...base, summary: 'a credential is logged' }).length, 1);
      assert.ok(backlogViolations({ ...base, expiry: '2000-01-01T00:00:00.000Z' })[0].includes('future'));
      assert.ok(backlogViolations({ owner: '@me' })[0].includes('expiry'), 'missing fields are named');
    }],

    // S20 review-pack -- reviewers systematically read what arrived and skip what left, so a
    // rename has to appear beside the deletions rather than only inside the diff.
    ['invariants: an iron rule is a bold label carrying the mark, not any line mentioning it', () => {
      const doc = [
        '# main',
        '    - **flat orchestration(' + IRON_LAW_MARK + ')**: only the main agent orchestrates',
        '    - **two dispatch shapes**: judged by the flat orchestration ' + IRON_LAW_MARK + ' above',
        '    - a plain bullet naming the ' + IRON_LAW_MARK + ' with no label at all',
        '    - **evidence' + IRON_LAW_MARK + '**: ran it or it did not happen',
        '    - **flat orchestration(' + IRON_LAW_MARK + ')**: duplicated verbatim further down',
      ].join('\n');
      const laws = extractIronLaws(doc);
      assert.deepEqual(laws, [
        'flat orchestration(' + IRON_LAW_MARK + ')',
        'evidence' + IRON_LAW_MARK,
      ], 'body citations and unlabelled bullets are not rules, and a repeat is not a second rule');
      assert.deepEqual(extractIronLaws(''), []);
    }],

    // S21 invariants budget -- this text is re-injected at a compaction boundary, so it has
    // to fit inside one. The state block is rendered first on purpose: the budget eats from
    // the tail, and "where this tree stands" is the part a compaction most reliably destroys.
    ['archive: entries move verbatim and leave a pointer, never a rewrite', () => {
      const text = ['# P', '', '## ' + ARCHIVABLE_SECTIONS[0],
        '- 2026-03-03: **newest** stays', '- 2026-02-02: middle goes',
        '  detail line belonging to the middle entry', '- 2026-01-01: oldest goes', ''].join('\n');
      const plan = planArchive(text, { maxEntries: 1 });
      const out = applyArchivePlan(text, plan, { now: '2026-04-04T00:00:00.000Z' });
      assert.ok(out.progress.includes('- 2026-03-03: **newest** stays'), 'the kept entry is byte-identical');
      assert.ok(!out.progress.includes('middle goes'), 'the moved entry left the memory file');
      assert.ok(!out.progress.includes('detail line belonging'), 'its detail line went with it');
      assert.ok(out.archiveAppend.includes('- 2026-02-02: middle goes\n  detail line belonging to the middle entry'),
        'the moved entry arrives byte for byte, detail lines included');
      assert.ok(out.archiveAppend.includes('- 2026-01-01: oldest goes'));
      assert.ok(out.archiveAppend.includes('Archived from ' + ARCHIVABLE_SECTIONS[0] + ' on 2026-04-04'));
      const pointers = out.progress.split('\n').filter(l => l.includes('progress.archive.md'));
      assert.deepEqual(pointers.length, 1, 'exactly one pointer marks the move');
      assert.ok(pointers[0].includes('2026-01-01') && pointers[0].includes('2026-02-02'),
        'the pointer names the range that left, so the reader knows where to look');
      // Every surviving line of the original is still present, unedited.
      for (const l of text.split('\n')) {
        if (!l.trim() || l.includes('goes') || l.includes('detail line')) continue;
        assert.ok(out.progress.split('\n').includes(l), 'line was rewritten: ' + JSON.stringify(l));
      }
      // A second pointer is not counted as an entry, so re-running cannot cascade.
      const again = planArchive(out.progress, { maxEntries: 1 });
      assert.deepEqual(again.plans.find(p => p.section === ARCHIVABLE_SECTIONS[0]).entries, 1);
    }],

    // S21 sync-check -- the decidable half of the three-file rule. It can tell whether the
    // files moved together; it cannot tell whether what was written is true, and it does not
    // pretend to. Runtime state changing is not work anyone has to remember.
    ['sync-check: memory behind code, spec without changelog, and the quiet case', () => {
      const present = { progressPresent: true, specPresent: true, changelogPresent: true };
      const codes = fs => fs.map(f => f.code);

      assert.deepEqual(codes(syncFindings(['src/a.ts'], present)), ['MEMORY_BEHIND_CODE']);
      assert.deepEqual(codes(syncFindings(['src/a.ts', 'progress.md'], present)), [],
        'code and memory in the same change set is the whole point');
      assert.deepEqual(codes(syncFindings(['Product-Spec.md', 'progress.md'], present)),
        ['SPEC_WITHOUT_CHANGELOG']);
      assert.deepEqual(codes(syncFindings(['Product-Spec.md', 'Product-Spec-CHANGELOG.md', 'progress.md'], present)), []);
      assert.deepEqual(codes(syncFindings(['src/a.ts'], { ...present, progressPresent: false })), [],
        'a project with no memory file is not a project behind on its memory');
      assert.deepEqual(codes(syncFindings([], present)), [], 'nothing changed, nothing to record');
      const both = syncFindings(['src/a.ts', 'Product-Spec.md'], present);
      assert.deepEqual(codes(both), ['MEMORY_BEHIND_CODE', 'SPEC_WITHOUT_CHANGELOG']);
      assert.ok(both[0].sample.includes('src/a.ts'), 'the finding names what it saw');

      assert.deepEqual(['src/a.ts', '.claude/hooks/x.sh', 'lib/y.mjs', 'setup.ps1'].filter(isTrackedWork).length, 4);
      assert.deepEqual(['README.md', 'progress.md', '.claude/evidence/log.txt',
        '.claude/harness/state/task.json', 'node_modules/x/index.js', '.env'].filter(isTrackedWork), [],
        'documents and runtime state are not the code the memory has to keep up with');
      assert.deepEqual(codes(syncFindings(['.claude/harness/state/task.json'], present)), [],
        'the harness writing its own state must not fire the gate');
    }],

    // S21 sections -- an entry is its bullet plus the lines under it, and a pointer left by
    // an earlier archive run is bookkeeping rather than a memory entry.
    ['rules-audit: a phantom fails the audit, and dod fails with it', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccbase-selftest-rules-'));
      try {
        fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(root, '.claude', 'CLAUDE.md'), [
          '# Rules',
          '',
          '- **selftest**: the bold opening resolves, so this line is enforced',
          '- **requirements gathering**: bold that resolves to nothing stays on the worklist',
          '- run `node .claude/harness/harness.mjs cc-base-absent-subcommand` before merging',
          '',
        ].join('\n'), 'utf8');
        const run = (argv) => {
          const r = spawnSync(NODE, [path.join(HARNESS_DIR, 'harness.mjs'), ...argv], {
            cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root },
          });
          assert.ok(!r.error, 'spawn failed: ' + (r.error && r.error.message));
          let out = null;
          try { out = JSON.parse(String(r.stdout || '').trim()); } catch (_e) { out = null; }
          assert.ok(out, 'no JSON on stdout: ' + String(r.stdout || '').slice(0, 120));
          return { code: r.status, out, err: String(r.stderr || '') };
        };

        const audit = run(['rules-audit']);
        assert.deepEqual([audit.code, audit.out.ok], [1, false]);
        assert.deepEqual(audit.out.counts, { machine: 1, prompt: 0, phantom: 1, unclassified: 1 },
          'one line each: the bold that resolved, the bold that did not, and the imaginary subcommand');
        assert.deepEqual(audit.out.phantom.map(p => p.tokens[0].target), ['cc-base-absent-subcommand']);
        assert.ok(/PHANTOM \.claude\/CLAUDE\.md:5/.test(audit.err), 'stderr names the line: ' + audit.err);
        // The same run, read as the machine contract it is: no reported location may carry a
        // platform separator. This fixture's rule text has no backslash of its own, so any hit
        // is a path -- which is what the windows-latest CI leg failed on.
        assert.ok(!JSON.stringify(audit.out).includes('\\'),
          'a reported path carries a platform separator: ' + JSON.stringify(audit.out).slice(0, 200));

        const dod = run(['dod', '--only', 'rules-audit,skills-lint,claude-md-lint']);
        assert.deepEqual(dod.code, 2, 'a constitution naming a check that is not there is not a satisfied one');
        assert.deepEqual(dod.out.steps.map(s => s.id + ':' + s.status),
          ['rules-audit:FAIL', 'skills-lint:PASS', 'claude-md-lint:DEGRADED']);
        assert.deepEqual(dod.out.blockingFailures, ['rules-audit']);
        assert.ok(dod.out.steps.every(s => s.blocking), 'all three are blocking steps');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }],

    // S23 frontmatter -- the parse is shy in one direction only. A shape outside the subset
    // costs exit 3, which is loud; calling it fine would be the silent drop this command
    // exists to stop, and calling it broken would send someone to repair valid YAML.
    ['skills-lint: frontmatter parses, refuses, or declines to rule', () => {
      const fm = (...body) => parseFrontmatter(['---', ...body, '---', '', '# Body', ''].join('\n'));
      const ok = fm('name: demo-skill', '# a comment', '', 'description: when the user asks', 'user-invocable: false');
      assert.equal(ok.kind, 'ok');
      assert.deepEqual(Object.keys(ok.fields), ['name', 'description', 'user-invocable']);
      assert.deepEqual(ok.fields.description.value, 'when the user asks');
      assert.deepEqual(fm('name: "quoted-name"').fields.name.value, 'quoted-name');
      assert.deepEqual(fm('name: "quoted-name"').fields.name.quoted, true);

      const verdict = r => (r.kind === 'ok' ? 'ok' : (r.kind === 'undecidable' ? 'undecidable' : r.code));
      assert.deepEqual(verdict(parseFrontmatter('name: demo-skill\n')), 'NO_FRONTMATTER',
        'a file that does not open with --- is never registered as a skill');
      assert.deepEqual(verdict(parseFrontmatter('---\nname: demo-skill\n')), 'UNTERMINATED_FRONTMATTER');
      assert.deepEqual(verdict(fm('# only a comment')), 'EMPTY_FRONTMATTER');
      assert.deepEqual(verdict(fm('description: trigger: when the user asks')), 'MALFORMED_VALUE',
        'a plain value carrying ": " makes the loader reject the whole document');
      assert.deepEqual(verdict(fm('description: "trigger: quoted is fine"')), 'ok');
      assert.deepEqual(verdict(fm('description: - not a list')), 'MALFORMED_VALUE');
      assert.deepEqual(verdict(fm('just some prose')), 'MALFORMED_LINE');
      assert.deepEqual(verdict(fm('name: demo-skill', '  nested: value')), 'undecidable');
      assert.deepEqual(verdict(fm('description: >')), 'undecidable', 'a block scalar body is not ruled on');
      assert.deepEqual(verdict(fm('allowed-tools: [Read, Edit]')), 'undecidable');
      assert.deepEqual(verdict(fm('description: "opened and never closed')), 'undecidable');
    }],

    // S23 the five judgements -- each one is a way the loader ends up with a skill that is
    // not the skill somebody wrote, and none of them is reported anywhere else.
    ['claude-md-lint: four sections, in either language, each with something under it', () => {
      const doc = (...lines) => lines.join('\n');
      const state = (...lines) => {
        const s = documentSections(doc(...lines));
        const out = {};
        for (const k of Object.keys(s)) out[k] = s[k].found ? (s[k].nonEmpty ? 'stated' : 'empty') : 'absent';
        return out;
      };
      assert.deepEqual(
        state('## Purpose', 'charges cards', '## Boundaries', 'never imports pii-store',
          '## Invariants', 'amounts are integers', '## Verification', 'the contract suite'),
        { purpose: 'stated', boundaries: 'stated', invariants: 'stated', verification: 'stated' });
      // mu-di / bian-jie / bu-bian-liang / yan-zheng -- the same four headings in Chinese.
      assert.deepEqual(
        state('# \u76ee\u7684', 'x', '# \u8fb9\u754c', 'x', '# \u4e0d\u53d8\u91cf', 'x', '# \u9a8c\u8bc1', 'x'),
        { purpose: 'stated', boundaries: 'stated', invariants: 'stated', verification: 'stated' });
      assert.deepEqual(
        state('## Purpose / \u76ee\u7684', 'x', '#### \u8fb9\u754c', 'x', '### Invariants', 'x', '## \u9a8c\u8bc1', 'x'),
        { purpose: 'stated', boundaries: 'stated', invariants: 'stated', verification: 'stated' },
        'the two languages mix inside one document, and any heading level from # to #### counts');
      assert.deepEqual(state('## Purpose', 'x', '## Boundaries', '', '## Invariants', 'x', '## Verification', 'x').boundaries,
        'empty', 'a heading with nothing under it states nothing, whatever it is called');
      assert.deepEqual(state('## Boundaries', '### Allowed', 'core only', '## Purpose', 'x').boundaries,
        'stated', 'a section written as subsections still has a body');
      assert.deepEqual(state('## Boundaries', '### Allowed', '## Purpose', 'x').boundaries,
        'empty', 'and a subsection heading with no text under it is not a body');
      assert.deepEqual(state('```', '## Purpose', 'x', '```').purpose, 'absent',
        'a heading inside a fence is a template being shown, not a section being stated');
      assert.deepEqual(state('##### Purpose', 'x').purpose, 'absent', 'the lint reads # through ####');

      const codes = (...lines) => lintModuleDoc('pay', 'pay/CLAUDE.md', doc(...lines))
        .findings.map(f => f.code + ':' + f.section);
      assert.deepEqual(codes('## Purpose', 'x', '## Boundaries', 'x', '## Invariants', 'x', '## Verification', 'x'), []);
      assert.deepEqual(codes('## Purpose', 'x'),
        ['MISSING_SECTION:boundaries', 'MISSING_SECTION:invariants', 'MISSING_SECTION:verification']);
      assert.deepEqual(codes('## Purpose', 'x', '## Boundaries', '## Invariants', 'x', '## Verification', 'x'),
        ['EMPTY_SECTION:boundaries']);
      const named = lintModuleDoc('pay', 'pay/CLAUDE.md', doc('## Purpose', 'x')).findings[0];
      assert.ok(named.detail.includes('module "pay"') && named.detail.includes('"\u8fb9\u754c"'),
        'the finding names the module and both spellings of the heading it wants: ' + named.detail);
    }],

    // S24 the scan -- which modules are even asked. A catalog with no high-risk module owes
    // no directory constitution, and a module whose root cannot be derived is reported as
    // not ruled on rather than quietly dropped out of the count.
    ['init: draft, apply, and the catalog it refuses to overwrite', () => {
      const roots = [];
      const mk = (initGit = true) => {
        const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccbase-selftest-init-')));
        roots.push(d);
        if (initGit) {
          const g = spawnSync('git', ['init', '-q'], { cwd: d, encoding: 'utf8' });
          assert.ok(!g.error && g.status === 0,
            'these lanes need git on PATH: init reads the tracked list through git ls-files');
        }
        return d;
      };
      const seed = (root, files) => {
        for (const [rel, body] of Object.entries(files)) {
          const abs = path.join(root, rel);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, body, 'utf8');
        }
        const g = spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8' });
        assert.ok(!g.error && g.status === 0, 'git add failed: ' + String(g.stderr || ''));
      };
      const run = (root, argv = []) => {
        const r = spawnSync(NODE, [path.join(HARNESS_DIR, 'harness.mjs'), 'init', ...argv], {
          cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        });
        assert.ok(!r.error, 'spawn failed: ' + (r.error && r.error.message));
        let out = null;
        try { out = JSON.parse(String(r.stdout || '').trim()); } catch (_e) { out = null; }
        assert.ok(out, 'no JSON on stdout: ' + String(r.stdout || '').slice(0, 200));
        return { code: r.status, out, err: String(r.stderr || '') };
      };
      const TREE = {
        'api/routes.ts': "import { hash } from '../core/util';\nexport const routes = [hash];\n",
        'api/server.ts': "export const serve = () => null;\n",
        'core/index.ts': "export * from './util';\n",
        'core/util.ts': "export const hash = (s) => s;\n",
        'docs/design.md': '# design\n',
        'package.json': '{"name":"fixture"}\n',
        'README.md': '# fixture\n',
      };
      const catalogAt = (root) => path.join(root, '.claude', 'harness', 'module-catalog.json');
      try {
        const loose = mk(false);
        const a = run(loose);
        assert.deepEqual([a.code, a.out.error], [3, 'non-git'],
          'the tracked list comes from git; outside a repository there is nothing to infer from');

        const empty = mk();
        const b = run(empty);
        assert.deepEqual([b.code, b.out.error], [3, 'no-tracked-paths'],
          'an empty index is nothing to draft over, which is not the same as a draft of nothing');

        const repo = mk();
        seed(repo, TREE);
        const c = run(repo);
        assert.deepEqual([c.code, c.out.ok, c.out.applied], [0, true, false], c.err);
        assert.deepEqual(c.out.modules, 2);
        assert.deepEqual(c.out.draft.modules.map(m => m.id), ['api', 'core']);
        assert.deepEqual([c.out.lint.ok, c.out.lint.stats.unmapped, c.out.lint.stats.overlaps], [true, 0, 0],
          'the draft is checked with the real linter before it is offered, not by construction');
        assert.deepEqual(fs.existsSync(catalogAt(repo)), false, 'a dry run writes nothing');
        // The real import edge is reported for a human to accept, and is nowhere near dependsOn.
        assert.deepEqual(c.out.referenceEdges.map(e => e.from + '->' + e.to), ['api->core']);
        for (const m of c.out.draft.modules) assert.deepEqual(m.dependsOn, undefined);
        assert.ok(/dependsOn is left unwritten/.test(c.err), c.err);
        assert.ok(/riskTier is low on every module/.test(c.err), c.err);

        // Two runs over one tree agree byte for byte, or the golden baseline would go red on
        // its own schedule and stop being read.
        assert.deepEqual(JSON.stringify(run(repo).out), JSON.stringify(c.out));

        const applied = run(repo, ['--apply']);
        assert.deepEqual([applied.code, applied.out.ok, applied.out.applied], [0, true, true], applied.err);
        assert.deepEqual(fs.existsSync(catalogAt(repo)), true);
        const written = fs.readFileSync(catalogAt(repo), 'utf8');
        assert.deepEqual(JSON.parse(written).modules.map(m => m.id), ['api', 'core']);

        const second = run(repo, ['--apply']);
        assert.deepEqual([second.code, second.out.error], [1, 'catalog-exists']);
        assert.deepEqual(fs.readFileSync(catalogAt(repo), 'utf8'), written,
          'refusing has to mean the bytes on disk did not move, not merely that the exit code was 1');
        assert.ok(/already exists and is not overwritten/.test(second.err), second.err);

        // Past the budget the inference coarsens rather than shipping a draft nobody reads.
        const mono = mk();
        seed(mono, {
          'packages/alpha/a.ts': 'export const a = 1;\n', 'packages/alpha/b.ts': 'export const b = 1;\n',
          'packages/beta/a.ts': 'export const a = 2;\n', 'packages/beta/b.ts': 'export const b = 2;\n',
        });
        assert.deepEqual(run(mono).out.draft.modules.map(m => m.id), ['packages-alpha', 'packages-beta']);
        const capped = run(mono, ['--max-modules', '1']);
        assert.deepEqual([capped.code, capped.out.granularity, capped.out.overBudget], [0, 'coarse', false]);
        assert.deepEqual(capped.out.draft.modules.map(m => m.paths[0]), ['packages/**']);

        // A directory name holding a glob wildcard makes one module claim another's files. It
        // cannot be created on Windows, and the judgement itself is pinned above without a
        // filesystem -- what this lane adds is that the refusal reaches the exit code.
        if (process.platform !== 'win32') {
          const clash = mk();
          seed(clash, {
            'a*b/x.ts': 'export const x = 1;\n', 'a*b/y.ts': 'export const y = 1;\n',
            'ab/x.ts': 'export const x = 2;\n', 'ab/y.ts': 'export const y = 2;\n',
          });
          const refused = run(clash);
          assert.deepEqual([refused.code, refused.out.ok, refused.out.error], [1, false, 'draft-not-lint-clean']);
          assert.ok(refused.out.lint.errors.some(e => e.code === 'OVERLAP'),
            'and the reason is in the body, not just in the exit code');
          assert.deepEqual(fs.existsSync(catalogAt(clash)), false);
          const alsoRefused = run(clash, ['--apply']);
          assert.deepEqual([alsoRefused.code, alsoRefused.out.applied], [1, false]);
          assert.deepEqual(fs.existsSync(catalogAt(clash)), false,
            '--apply over a draft that does not lint clean writes nothing at all');
        }
      } finally {
        for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
      }
    }],

    // S26. Co-change is a heuristic, and a heuristic has exactly two ways to be worthless:
    // reporting pairs whose habit is already explained (the reader stops reading), and judging
    // by default (the reader switches it off). Both are pinned here, in that order, against a
    // history built for the purpose -- the measurement reads git, so nothing short of real
    // commits exercises it.
    ['cochange: an undeclared pair is named, a declared one is not, and only --gate judges', () => {
      const roots = [];
      try {
        const root = newGitRepo(roots, 'cochange');
        for (let i = 1; i <= 6; i++) {
          commitFiles(root, {
            ['alpha/f' + i + '.ts']: 'export const a' + i + ' = ' + i + ';\n',
            ['beta/f' + i + '.ts']: 'export const b' + i + ' = ' + i + ';\n',
          }, 'pair ' + i);
        }
        for (let i = 1; i <= 2; i++) {
          commitFiles(root, { 'gamma/g.ts': 'export const g = ' + i + ';\n' }, 'gamma alone ' + i);
        }
        const mods = extra => [
          { id: 'alpha', paths: ['alpha/**'], ...(extra && extra.alpha ? { dependsOn: extra.alpha } : {}) },
          { id: 'beta', paths: ['beta/**'], ...(extra && extra.beta ? { dependsOn: extra.beta } : {}) },
          { id: 'gamma', paths: ['gamma/**'] },
        ];

        writeSideCatalog(root, mods());
        const report = runCoChange(root, []);
        assert.deepEqual([report.code, report.out.gate, report.out.ok], [0, false, true],
          'the default reports: high co-change often has a good reason, and a heuristic that '
          + 'blocks on day one is a heuristic nobody keeps: ' + report.err);
        assert.deepEqual([report.out.commitsScanned, report.out.commitsSkipped, report.out.modulesTouched], [8, 0, 3]);
        assert.deepEqual(report.out.undeclaredCoupling.map(p => p.a + '+' + p.b + '=' + p.cochangeCount),
          ['alpha+beta=6'], 'six commits touched both and nothing declares why');
        assert.deepEqual(report.out.undeclaredCoupling[0].commitsScanned, 8,
          'the denominator travels with the pair, so the count can be judged rather than believed');

        const gated = runCoChange(root, ['--gate']);
        assert.deepEqual([gated.code, gated.out.gate, gated.out.ok], [1, true, false], gated.err);
        assert.deepEqual(gated.out.undeclaredCoupling.map(p => p.a + '+' + p.b), ['alpha+beta']);

        // gamma changed twice on its own, so it pairs with nobody -- an assertion that the
        // count is per pair rather than per module that happened to appear in the window.
        assert.deepEqual(report.out.pairs.filter(p => p.a === 'gamma' || p.b === 'gamma'), []);

        // A declared edge explains the habit. Both directions, because the pair is unordered:
        // reading only alpha.dependsOn would report every consumer that declares its provider.
        for (const extra of [{ alpha: ['beta'] }, { beta: ['alpha'] }]) {
          writeSideCatalog(root, mods(extra));
          const declared = runCoChange(root, ['--gate']);
          assert.deepEqual([declared.code, declared.out.ok, declared.out.undeclaredCoupling.length], [0, true, 0],
            'a declared edge is why they move together: ' + JSON.stringify(extra) + ' ' + declared.err);
          assert.deepEqual(declared.out.pairs.map(p => p.a + '+' + p.b + ':' + p.declared), ['alpha+beta:true'],
            'and the pair stays in the report as supporting data, it is only no longer a finding');
        }
      } finally {
        for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
      }
    }],

    // The bulk commit is the whole measurement's largest source of noise: one reformat, mass
    // rename or initial import touches everything and makes every pair look coupled at once.
    // Skipping it silently would be its own defect -- a reader owed the count is a reader who
    // can tell "the boundaries hold" from "most of the history was dropped".
    ['release: manifest drift is three distinct findings, and the digest ignores CR', () => {
      const declared = parseManifest([
        '# comment header the readers skip',
        'a.md\taaa',
        'b.md\tbbb',
        'gone.md\tccc',
        'malformed-line-without-a-tab',
        '',
      ].join('\n'));
      assert.deepEqual([...declared.keys()].sort(), ['a.md', 'b.md', 'gone.md'],
        'comments, blanks and tab-less lines are not entries');

      const actual = new Map([['a.md', 'aaa'], ['b.md', 'CHANGED'], ['new.md', 'ddd']]);
      const f = manifestFindings(declared, actual);
      assert.deepEqual(f.missing, ['new.md'],
        'a framework file with no row is the defect that makes an upgrade skip it silently');
      assert.deepEqual(f.stale, ['gone.md']);
      assert.deepEqual(f.changed, ['b.md']);

      // The generator hashes `tr -d '\r'` output, so a CRLF checkout must not read as modified.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccbase-selftest-release-sha-'));
      try {
        const lf = path.join(dir, 'lf.txt');
        const crlf = path.join(dir, 'crlf.txt');
        fs.writeFileSync(lf, 'one\ntwo\n', 'utf8');
        fs.writeFileSync(crlf, 'one\r\ntwo\r\n', 'utf8');
        assert.deepEqual(normalizedSha(lf), normalizedSha(crlf),
          'autocrlf must not be reportable as a user modification');
        assert.deepEqual(normalizedSha(lf),
          createHash('sha256').update(Buffer.from('one\ntwo\n', 'utf8')).digest('hex'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }],

    // The CI bucketing is the whole reason this subcommand exists: CI here was red for over a
    // month while the local runner reported green. So the one answer it may never give is
    // "passed" for a question it could not ask, and the one it must give is a refusal that
    // says UNKNOWN out loud.
    ['release: the verdict blocks on failures, refuses to call an all-unknown run green, and never ships empty-handed', () => {
      const pass = id => result(id, 'PASS', 'fine', null, null);
      const degraded = id => result(id, 'DEGRADED', 'could not be asked', null, null);
      const fail = (id, step) => result(id, 'FAIL', 'blocked', null, step);

      const clean = releaseVerdict([pass('worktree'), degraded('ci')]);
      assert.deepEqual([clean.ok, clean.exit, clean.blockers.length], [true, 0, 0],
        'a degraded check reports unknown and does not move the exit code');

      const blocked = releaseVerdict([fail('tier', 'bash .claude/scripts/fast-mode.sh off'), degraded('ci')]);
      assert.deepEqual([blocked.ok, blocked.exit], [false, 1]);
      assert.deepEqual(blocked.blockers.map(b => b.id), ['tier']);
      for (const b of blocked.blockers) {
        assert.ok(typeof b.nextStep === 'string' && b.nextStep.length > 0,
          b.id + ': a blocker without a command to run is a diagnosis with empty hands');
      }

      const nothing = releaseVerdict([degraded('worktree'), degraded('ci')]);
      assert.deepEqual([nothing.ok, nothing.exit, nothing.degraded, nothing.blockers.length], [false, 3, true, 0],
        'a run that established nothing is not a run that passed');
    }],

    // End to end, over one throwaway repository. Three spawns rather than one per condition:
    // each `release` runs `dod` as a child, and this case list is itself replayed nine times
    // by the golden matrix. The three blocking conditions are therefore raised together and
    // asserted individually, which still proves each is detected and named on its own.
    // S28 tier -- the profile validator, over injected profiles so every rule is reachable
    // without a repository. The CLI half (set / status / explain, the eight-hour cap, the
    // runtime file's shape) is covered by .claude/tests/test-tier.sh, which drives the real
    // binary; what is asserted here is the judgement these rules make.
    ['tier: the shipped profile passes its own validator', () => {
      const registered = Object.keys(baseProfile().hooks).concat(baseProfile().floor).sort();
      assert.deepEqual(validateProfile(baseProfile(), registered), [],
        'the profile this framework ships has to survive the rule set it ships with');
    }],

    ['tier: the floor cannot be given a row, and a recorder cannot be given a guard mode', () => {
      const floored = profileWith(p => {
        p.hooks['secret-exfil-guard'] = { kind: 'guard', fast: 'block', standard: 'block', strict: 'block' };
      });
      assert.deepEqual(validateProfile(floored, registeredOf(floored)).map(x => [x.code, x.hook]),
        [['FLOOR_IN_TABLE', 'secret-exfil-guard']],
        'a row for a floor gate is an adjustable dial on something that has none');

      const miscast = profileWith(p => { p.hooks['mark-review-needed'].standard = 'block'; });
      assert.deepEqual(validateProfile(miscast, registeredOf(miscast)).map(x => [x.code, x.hook]),
        [['BAD_MODE', 'mark-review-needed']], 'a recorder has two positions, not three');
    }],

    ['release: a clean tree passes, three defects each get named with a command, and a non-repo establishes nothing', () => {
      const roots = [];
      try {
        const root = newGitRepo(roots, 'release');
        // The profile is committed rather than written afterwards: it is not runtime state, so
        // an untracked one would show up as uncommitted work in the very check being asserted.
        commitFiles(root, {
          'src/app.ts': 'export const APP = 1;\n',
          '.claude/harness/profile.json': FIXTURE_PROFILE,
        }, 'release fixture base');

        const clean = runRelease(root);
        assert.deepEqual([clean.code, clean.out.ok, clean.out.blockers.length], [0, true, 0],
          'a committed tree with nothing pending is shippable as far as this can tell');
        assert.ok(clean.out.note.includes('never tags, pushes, publishes or writes'),
          'the output has to say what the command will not do: ' + clean.out.note);

        // No origin is answered before gh is ever looked for, so this lane reads the same on a
        // machine with gh installed and on one without. That is what keeps the golden baseline
        // reproducible, and it is asserted here rather than assumed.
        // gate-fresh joins them: this fixture ships no catalog, so there is no verification
        // gate for the tree to be fresh against, and an unanswerable question degrades.
        assert.deepEqual(clean.out.degradedChecks, ['remote', 'manifest', 'ci', 'gate-fresh']);
        for (const id of ['remote', 'ci']) {
          const c = clean.out.checks.find(x => x.id === id);
          assert.deepEqual(c.status, 'DEGRADED');
          assert.ok(/UNKNOWN, which is not a pass|UNKNOWN -- unknown is not a pass/.test(c.summary),
            id + ': an unanswerable question must be reported as unknown, not passed: ' + c.summary);
        }

        fs.appendFileSync(path.join(root, 'src', 'app.ts'), 'export const B = 2;\n', 'utf8');
        fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
        writeTierState(root);
        fs.writeFileSync(path.join(root, '.claude', '.needs-review'), 'src/app.ts\nsrc/b.ts\n', 'utf8');

        const dirty = runRelease(root);
        assert.deepEqual([dirty.code, dirty.out.ok], [1, false]);
        assert.deepEqual(dirty.out.blockers.map(b => b.id).sort(), ['review-queue', 'tier', 'worktree']);
        for (const b of dirty.out.blockers) {
          assert.ok(typeof b.nextStep === 'string' && b.nextStep.length > 0,
            b.id + ': every blocker names the command that resolves it');
          assert.ok(dirty.err.includes(b.id + ' -> ' + b.nextStep),
            b.id + ': the human channel carries the same command as the JSON one: ' + dirty.err);
        }
        // The two state files just written are runtime state, and runtime state is not
        // uncommitted work -- counting it would make every fast session look dirty.
        assert.deepEqual(dirty.out.checks.find(c => c.id === 'worktree').evidence.paths, ['src/app.ts']);
        assert.deepEqual(dirty.out.checks.find(c => c.id === 'tier').evidence.active, true);
        assert.deepEqual(dirty.out.checks.find(c => c.id === 'review-queue').evidence.pending, 2);

        const loose = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccbase-selftest-release-loose-')));
        roots.push(loose);
        const nonGit = runRelease(loose);
        assert.deepEqual([nonGit.code, nonGit.out.error, nonGit.out.checks.length, nonGit.out.established],
          [3, 'non-git', 0, 0],
          'outside a repository there is no commit to judge, and an empty checklist is not a clean one');
      } finally {
        for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
      }
    }],

    // -----------------------------------------------------------------------
    // "unreadable" is not "absent". Every path below used to answer a damaged file the way it
    // answers a missing one, which reads a truncated or tampered artefact as a clean tree --
    // the one inference a checker must never make, because corruption is the shape tampering
    // arrives in. Each lane damages exactly one artefact so a failure names which one went
    // quiet, and none of them removes the damaged file: that is evidence for a person.
    // -----------------------------------------------------------------------
    ['verify and gate: a run in which every check was skipped established nothing, and does not answer 0', () => {
      const roots = [];
      try {
        const root = newGitRepo(roots, 'all-skipped');
        commitFiles(root, { 'pay/a.ts': 'export const a = 1;\n' }, 'skip fixture base');
        writeSkippableCatalog(root);
        writeTierState(root);

        const ver = runIn(root, ['verify', '--changed', 'pay/a.ts']);
        assert.deepEqual([ver.out.affected, ver.out.checks.map(c => c.state)], [['pay'], ['SKIPPED']],
          'fixture check: the module resolved and its one check was deferred by fast mode, so '
          + 'this run really is the all-skipped shape: ' + JSON.stringify(ver.out));
        assert.deepEqual([ver.code, ver.out.note], [3, 'every-check-skipped'],
          'nothing ran, so nothing was established, and 0 is the answer a caller reads as '
          + '"verified" -- the same nothing dod and release already report as 3: ' + JSON.stringify(ver.out));

        const gated = runIn(root, ['gate', '--changed', 'pay/a.ts']);
        assert.deepEqual([gated.code, gated.out.reason], [3, 'every-check-skipped'],
          'the gate already writes the reason into its ledger record and then exits 0 beside it; '
          + 'the record being right does not help a caller that only reads the code: '
          + JSON.stringify({ code: gated.code, gate: gated.out.gate, reason: gated.out.reason }));

        // Control: let the fast window expire and the same catalog runs for real. A green here
        // is what proves the two results above come from the skipping and not from the fixture.
        writeTierState(root, JSON.stringify({ tier: 'fast', reason: 'expired fixture', by: 'user', set_epoch: 1, expires_epoch: 2 }) + '\n');
        const real = runIn(root, ['verify', '--changed', 'pay/a.ts']);
        assert.deepEqual([real.code, real.out.state, real.out.checks.map(c => c.state)], [0, 'PASS', ['PASS']],
          'control: with the window shut the check executes and the gate passes for a reason: '
          + JSON.stringify(real.out));
      } finally {
        for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
      }
    }],

    ['task complete: an unreadable receipt blocks the hard gate, not only the checker that reports on receipts', () => {
      const roots = [];
      try {
        const root = newGitRepo(roots, 'task-complete-receipts');
        // Committed, so the catalog is not itself an untracked path in the change surface it
        // is being used to measure.
        const catalog = JSON.stringify({
          version: 1,
          modules: [{ id: 'pay', paths: ['pay/**'], riskTier: 'low', verification: ['unit'] }],
          checks: { unit: { command: process.execPath + ' --version', class: 'quality' } },
        }, null, 2) + '\n';
        commitFiles(root, {
          'pay/a.ts': 'export const a = 1;\n',
          '.claude/harness/module-catalog.json': catalog,
        }, 'task complete fixture base');
        fs.appendFileSync(path.join(root, 'pay', 'a.ts'), 'export const b = 2;\n', 'utf8');
        const envelope = JSON.stringify({
          id: 'NEW', goal: 'g', scope: 'pay/**', outOfScope: 'N/A',
          existingPattern: 'N/A',
          businessContext: 'why: dispatcher must see who can repair which model; who benefits: customer service',
          verification: 'unit', escalation: 'N/A',
        });

        // Every condition of the hard gate satisfied for real: an active task, a PASS gate that
        // chose its own scope and bound this diff, an accepting receipt on the same diff, an
        // intact ledger, a non-empty plan. Without this control the red below could be any one
        // of those four conditions rather than the receipt pile.
        assert.deepEqual(runIn(root, ['task', 'start'], envelope).code, 0, 'fixture: task start');
        assert.deepEqual(runIn(root, ['gate']).code, 0, 'fixture: gate must pass');
        assert.deepEqual(
          runIn(root, ['receipt', 'write'], '{"taskId":"good","reviewer":"selftest","verdict":"accept"}').code, 0,
          'fixture: receipt write');
        const clean = runIn(root, ['task', 'complete']);
        assert.deepEqual([clean.code, clean.out.ok, clean.out.blockers], [0, true, []],
          'control: with an intact pile this task really does complete, so everything below is '
          + 'the damaged receipt talking: ' + JSON.stringify(clean.out));

        assert.deepEqual(runIn(root, ['task', 'start'], envelope).code, 0, 'fixture: re-open the task');
        const badRel = '.claude/harness/receipts/broken.json';
        writeUnder(root, badRel, '{ "taskId": "broken", "diffHash": "trunc');

        // The same loader, read two ways. `receipt verify` treats an unreadable receipt as
        // outranking every sibling that binds, because the file that would not parse may be the
        // tampered one. `task complete` reads .receipts off the same call and drops .unreadable.
        const checker = runIn(root, ['receipt', 'verify']);
        assert.deepEqual([checker.code, checker.out.note], [4, 'receipt-unreadable'],
          'fixture check: the receipt checker does refuse this tree: ' + JSON.stringify(checker.out));

        const done = runIn(root, ['task', 'complete']);
        assert.notDeepEqual(done.code, 0,
          'and the gate documented as the hard one must not be the softer of the two: on this '
          + 'exact tree receipt verify exits 4 and task complete declares the task finished, '
          + 'which makes "a receipt nobody can read may be the tampered one" a rule that stops '
          + 'the checker and not the thing the checker guards: ' + JSON.stringify(done.out));
        assert.ok(JSON.stringify(done.out && done.out.blockers || []).includes('receipt-unreadable'),
          'and it says which condition failed, by the name the rest of the engine uses for it, '
          + 'because a blocker nobody can act on is a wall without a door: ' + JSON.stringify(done.out));
      } finally {
        for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
      }
    }],

    ['flag whitelist: the equals spelling is named rather than dropped', () => {
      const r = spawnSync(NODE, [path.join(HARNESS_DIR, 'harness.mjs'), 'impact', '--changed=core/a.ts'], {
        cwd: HARNESS_DIR, input: '', encoding: 'utf8', env: { ...process.env },
      });
      assert.ok(!r.error, 'spawn failed: ' + (r.error && r.error.message));
      assert.deepEqual(r.status, 2);
      assert.ok(/unknown flag for impact: --changed=core\/a\.ts/.test(String(r.stderr || '')),
        'the whole token is quoted back, so the missing space is visible: ' + String(r.stderr || ''));
    }],

    // Scale smoke -- the glob cache must keep classification linear-ish. 120 modules x
    // 3 globs against 30k paths stays far under the bound on any dev machine; without
    // the cache this same loop recompiled ~10.8M RegExps and blew straight past it.
    ['scale: classify 30k paths against 120-module catalog under 2500ms', () => {
      const mods = [];
      for (let i = 0; i < 120; i++) {
        mods.push({ id: 'm' + i, paths: ['pkg' + i + '/**', 'src/pkg' + i + '/**/*.ts', 'libs/p' + i + '/*'] });
      }
      const cat = { version: 1, modules: mods, global: ['package.json'], ignored: ['**/*.md'] };
      const paths = [];
      for (let i = 0; i < 30000; i++) paths.push('pkg' + (i % 120) + '/f' + i + '.ts');
      const t0 = Date.now();
      const r = lintCatalog(cat, paths);
      const elapsed = Date.now() - t0;
      assert.ok(r.ok, 'synthetic catalog should lint clean');
      assert.ok(elapsed < 2500, 'lint took ' + elapsed + 'ms (>= 2500ms)');
    }],
  ];
}

/**
 * Enforcement points for the S22 selftests, built by hand rather than read off this
 * checkout: these assertions have to mean the same thing inside the golden sandbox, which
 * ships none of these files. A fixture that reaches for the real tree is asserting the
 * tree, not the classifier.
 */

/**
 * Environment for the S26 git fixtures: a pinned identity so `git commit` works without any
 * user config, and global/system config switched off so a developer's gpg signing, hooks or
 * commit template cannot make these lanes fail on one machine and pass on the next.
 * An empty config file rather than a device name: os.devNull is `\\.\nul` on Windows, and the
 * git that runs there is Git for Windows, which reads paths POSIX-style and answers `Invalid
 * argument`. A file with no config entries in it means the same thing on all three platforms.
 */
function fixtureGitEnv(root) {
  const empty = emptyGitConfig(root);
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'selftest', GIT_AUTHOR_EMAIL: 'selftest@example.invalid',
    GIT_COMMITTER_NAME: 'selftest', GIT_COMMITTER_EMAIL: 'selftest@example.invalid',
    GIT_AUTHOR_DATE: '2020-01-01T00:00:00+0000',
    GIT_COMMITTER_DATE: '2020-01-01T00:00:00+0000',
    GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_SYSTEM: empty, GIT_CONFIG_NOSYSTEM: '1',
  };
}

/**
 * The empty config lives inside the fixture's own .git/, so it goes away with the fixture and
 * `git add -A` never sees it -- anywhere else under the work tree it would commit itself into
 * the very history these lanes measure. A fixture that is not a repository has no .git and so
 * no file there, which git reads as "no global config": the same nothing, by another route.
 */
function emptyGitConfig(root) {
  return path.join(root, '.git', 'empty-gitconfig');
}

/** A throwaway repository, registered with the caller's cleanup list; returns its realpath. */
function newGitRepo(roots, label) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccbase-selftest-' + label + '-')));
  roots.push(d);
  fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  fs.writeFileSync(emptyGitConfig(d), '', 'utf8');
  const g = spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], {
    cwd: d, encoding: 'utf8', env: fixtureGitEnv(d),
  });
  assert.ok(!g.error && g.status === 0,
    'these lanes need git on PATH: co-change is read from commit history: ' + String(g.stderr || ''));
  return d;
}

/** Write the files, stage everything, commit. One commit's worth of history per call. */
function commitFiles(root, files, message) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  const env = fixtureGitEnv(root);
  const add = spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8', env });
  assert.ok(!add.error && add.status === 0, 'git add failed: ' + String(add.stderr || ''));
  const commit = spawnSync('git', ['commit', '-q', '-m', message], { cwd: root, encoding: 'utf8', env });
  assert.ok(!commit.error && commit.status === 0, 'git commit failed: ' + String(commit.stderr || ''));
}

/**
 * A catalog beside the tree rather than inside .claude/, and written after the commits: a
 * catalog committed into the fixture would show up in its own history as a changed path.
 */
function writeSideCatalog(root, modules) {
  fs.writeFileSync(path.join(root, 'side-catalog.json'), JSON.stringify({ version: 1, modules }, null, 2), 'utf8');
}

/** Run `cochange` against a fixture repository with the catalog writeSideCatalog left there. */
function runCoChange(root, argv) {
  const r = spawnSync(process.execPath,
    [path.join(HARNESS_DIR, 'harness.mjs'), 'cochange', '--catalog', path.join(root, 'side-catalog.json'), ...argv],
    { cwd: root, encoding: 'utf8', env: { ...fixtureGitEnv(root), CLAUDE_PROJECT_DIR: root } });
  assert.ok(!r.error, 'spawn failed: ' + (r.error && r.error.message));
  let out = null;
  try { out = JSON.parse(String(r.stdout || '').trim()); } catch (_e) { out = null; }
  assert.ok(out, 'no JSON on stdout: ' + String(r.stderr || '').slice(0, 300));
  return { code: r.status, out, err: String(r.stderr || '') };
}

/**
 * Run `release` against a fixture tree. The pinned git env travels with it because the child
 * `dod` inherits this process's environment: without it a machine with commit signing or a
 * commit template configured globally would answer differently from one without.
 */
function runRelease(root) {
  const r = spawnSync(process.execPath, [path.join(HARNESS_DIR, 'harness.mjs'), 'release'],
    { cwd: root, input: '', encoding: 'utf8', env: { ...fixtureGitEnv(root), CLAUDE_PROJECT_DIR: root } });
  assert.ok(!r.error, 'spawn failed: ' + (r.error && r.error.message));
  let out = null;
  try { out = JSON.parse(String(r.stdout || '').trim()); } catch (_e) { out = null; }
  assert.ok(out, 'no JSON on stdout: ' + String(r.stderr || '').slice(0, 300));
  return { code: r.status, out, err: String(r.stderr || '') };
}

/**
 * Write one SKILL.md into a fixture tree. The body is irrelevant to this lint and the
 * frontmatter is the whole subject, so the caller passes only the frontmatter lines.
 */

/**
 * Write one module's CLAUDE.md into a fixture tree. Only the headings and their bodies are
 * the subject, so the caller passes the document's lines and nothing else.
 */

/** Write a minimal catalog into a fixture tree, where the engine's own loader will find it. */

/** Tiny attribute-enabled catalog for S11 selftests (payments module + sec-scan check). */
function attrCatalog(overrides = {}) {
  return {
    version: 1,
    modules: [{
      id: 'pay', paths: ['pay/**'], riskTier: 'high',
      verification: overrides.verification || ['sec-scan'],
      attributes: overrides.attributes || { security: 'critical' },
    }],
    checks: {
      'sec-scan': { command: 'node --version', class: 'security', attributes: ['security'] },
      'sec-audit': { command: 'node --version', class: 'security', attributes: ['security'] },
    },
  };
}

/**
 * Run one harness subcommand against a fixture tree: the real engine, only the project root
 * moves. `out` is null when stdout carried no JSON, which is itself an assertable fact -- a
 * subcommand that dies before emitting is not the same as one that emitted a refusal.
 */
function runIn(root, argv, stdin) {
  const r = spawnSync(process.execPath, [path.join(HARNESS_DIR, 'harness.mjs'), ...argv],
    { cwd: root, input: stdin || '', encoding: 'utf8', env: { ...fixtureGitEnv(root), CLAUDE_PROJECT_DIR: root } });
  assert.ok(!r.error, 'spawn failed: ' + (r.error && r.error.message));
  let out = null;
  try { out = JSON.parse(String(r.stdout || '').trim()); } catch (_e) { out = null; }
  return { code: r.status, out, err: String(r.stderr || ''), raw: String(r.stdout || '') };
}

/**
 * A catalog whose single check is the running interpreter by absolute path, so it resolves
 * under the golden runner's pinned PATH and on Windows alike, and opts into the fast-mode
 * skip. Written where the engine's own loader finds it.
 */
function writeSkippableCatalog(root) {
  const dir = path.join(root, '.claude', 'harness');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'module-catalog.json'), JSON.stringify({
    version: 1,
    modules: [{ id: 'pay', paths: ['pay/**'], riskTier: 'low', verification: ['unit'] }],
    checks: { unit: { command: process.execPath + ' --version', class: 'quality', allowFastSkip: true } },
  }, null, 2) + '\n', 'utf8');
}

/** The profile this framework ships, as the validator cases' starting point. */
// 惰性读：模块顶层读盘会让 profile.json 缺/坏时整台引擎在加载期崩（harness.mjs 静态 import 本文件），
// 而那正是用户可改的文件。读不到就用 hook 侧的内置默认表，selftest 自己跑到这些用例时再决定。
let _baseProfile = null;
function baseProfile() {
  if (_baseProfile) return _baseProfile;
  try {
    _baseProfile = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'profile.json'), 'utf8'));
  } catch (_e) {
    _baseProfile = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
  }
  return _baseProfile;
}

/** A deep copy of the shipped profile with one mutation applied. */
function profileWith(mutate) {
  const p = JSON.parse(JSON.stringify(baseProfile()));
  mutate(p);
  return p;
}

/** The hook ids a profile accounts for, standing in for what settings.json registers. */
function registeredOf(profile) {
  return Object.keys(profile.hooks).concat(profile.floor).sort();
}

/**
 * A profile that enables the tier dial and never raises on its own: these fixtures set the
 * tier explicitly, and an automatic raise on their own untracked files would answer for them.
 */
const FIXTURE_PROFILE = JSON.stringify({
  version: 1, default: 'standard', floor: [], hooks: {},
  raise: { to: 'strict', paths: [] }, overrides: {},
}, null, 2) + '\n';

/** Open the fast window (or damage the file) without going through the shell switch. */
function writeTierState(root, body) {
  const harnessDir = path.join(root, '.claude', 'harness');
  fs.mkdirSync(harnessDir, { recursive: true });
  if (!fs.existsSync(path.join(harnessDir, 'profile.json'))) {
    fs.writeFileSync(path.join(harnessDir, 'profile.json'), FIXTURE_PROFILE, 'utf8');
  }
  fs.mkdirSync(path.join(root, '.claude', '.runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', '.runtime', 'tier.json'),
    body === undefined
      ? JSON.stringify({ tier: 'fast', reason: 'selftest fixture', by: 'user', set_epoch: Math.floor(Date.now() / 1000), expires_epoch: Math.floor(Date.now() / 1000) + 3600 }) + '\n'
      : body, 'utf8');
}

/** Write a file under a fixture root, creating its directory. Returns the absolute path. */
function writeUnder(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  return abs;
}

/**
 * Can a chmod 000 actually deny this process a read? Not as root, and not on Windows, where the
 * mode bits do not carry that meaning. Every lane below builds its core case out of EISDIR /
 * ENOTDIR instead -- a path that exists and is not a readable file, which needs no privilege and
 * reads the same everywhere -- and uses this only to add a permission case where there is one.
 * So there is no platform on which one of these lanes asserts nothing.
 */

/** Run fn with `abs` chmod 000, restoring the mode afterwards whatever happens. */

/** Every line of the quarantine ledger, parsed; [] when nothing has been recorded yet. */

/**
 * Run `fn` with `abs` unreadable by mode, where mode bits can deny this process a read. Where
 * they cannot -- win32, or running as root -- it says so on stderr and returns false instead
 * of running nothing and letting the lane count a case it never exercised as a passing one.
 * Every caller asserts its EISDIR / ENOTDIR case outside this guard, so the guarantee does not
 * depend on the platform; this only adds the permission form where the platform has one.
 */

export { selftestCases, attrCatalog };
