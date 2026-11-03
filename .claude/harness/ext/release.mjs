// ext/release.mjs -- S27 release readiness: assemble the evidence for "can this commit
// ship", and never ship it.
//
// THIS COMMAND NEVER PUBLISHES AND NEVER WRITES. It does not tag, does not push, does not
// create a GitHub release, does not touch a single file in the tree. Releasing is a HIGH-tier
// human decision, and a command that can ship on its own gets one accidental invocation and
// is then never run again by anybody. Every subprocess it starts is a read: `git ls-remote`,
// `gh run list`, and `harness.mjs dod`, which itself only reads.
//
// It also replaces nothing that already exists. Three parts of this repository already own a
// piece of releasing and each keeps its job:
//   .claude/hooks/release-gate.sh    the hook: checks the review queue before the skill loads
//   .claude/scripts/make-release.sh  the packer: builds the zip, strips private feedback, scans
//   skills/release-builder           the human workflow
// What was missing between them is the assembly: running the seven judgements that decide
// whether a commit is shippable, once, in one place, and laying them out as a list somebody
// can check rather than a feeling somebody has.
//
// Eight checks, all of them blocking, all of them able to degrade. Degrading is not passing
// and it is not failing: it means the question could not be answered here, it is reported as
// unknown in both channels, and it does not move the exit code. That asymmetry is the whole
// design of the CI check in particular -- see below.
//
//   worktree      uncommitted changes mean what would ship is not what was tested
//   remote        local HEAD vs what origin actually has, asked over the wire
//   dod           every static governance check, by its own exit code
//   manifest      FRAMEWORK-MANIFEST.txt vs what the generator would write right now
//   review-queue  .claude/.needs-review still holding files
//   tier          the fast tier means this batch skipped the review and test gates
//   ci            the CI conclusion for this exact HEAD
//   gate-fresh    a passing gate record bound to this exact working tree
//
// Two of them are here because of specific incidents in this repository.
//
// `remote` asks the network rather than reading `git status`. The ahead/behind counts in
// `git status` come from the remote-tracking ref in .git, which is a cache of the last fetch
// and can be arbitrarily old; this repository has already shipped a decision made on a stale
// one. `git ls-remote` is the only answer that is about the remote rather than about a local
// copy of an old answer.
//
// `ci` exists because CI here was red for over a month while every batch reported "all
// green" locally. Both statements were true: the local runner and the CI runner do not run
// the same thing. So the conclusion is read from CI itself -- and when it cannot be read,
// the output says CI status is UNKNOWN and that unknown is not a pass. Answering "green"
// because the question could not be asked is exactly the failure this check is named after.
//
// The output also carries a trustBoundary block whose four fields are hardcoded false, and
// they are hardcoded rather than computed because nothing in this process can ever make them
// true. This command does not authenticate who produced the artifact, does not establish that
// a CI system rather than somebody's laptop built it, verifies no external signature, and
// authorizes nothing. An absent field reads as "not applicable"; false reads as "asked, and
// no". A green readiness report is precisely the artifact a hurried reader downstream would
// otherwise quote as though it were a release approval, so the boundary travels inside the
// output where it cannot be left behind -- structure rather than a sentence in a README.
//
// Depends on core / catalog and evidence (the ledger gate-fresh reads) / spec (dodStatus, so
// the three states are mapped in one place rather than two) / memory (the tier and
// review-queue state, same semantics the stop gate and `invariants` already use). Nothing
// imports it except harness.mjs and selftest.
//
// Source is ASCII-only like the rest of the runtime.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  HARNESS_DIR, changedPaths, emit, git, gitFingerprint, headCommit, isGitRepo, isStateExcluded,
  projectRoot, sha256, toPosixPath, whichCmd,
} from '../lib/core.mjs';
import { loadCatalog } from './catalog.mjs';
import { readLedgerState } from './evidence.mjs';
import { dodStatus } from './spec.mjs';
import { fastModeState, pendingReviewCount } from './memory.mjs';

// ===========================================================================
// S27.1 shared shapes
// ===========================================================================

// Network and subprocess ceilings. A readiness command that can hang is a readiness command
// people learn to interrupt, and an interrupted one reports nothing at all.
const REMOTE_TIMEOUT_MS = 20000;
const CI_TIMEOUT_MS = 25000;
const DOD_TIMEOUT_MS = 300000;
// Findings are named, not summarised -- but a list of four hundred paths is a wall nobody
// reads, so each list is capped and the full count travels beside it.
const LIST_CAP = 10;

/**
 * One check result. `nextStep` is a command the reader can actually run, and it is required
 * on FAIL: a blocker without one is a diagnosis with empty hands, which is how a gate stops
 * being used. Pure.
 */
function result(id, status, summary, evidence, nextStep) {
  return {
    id,
    status,
    blocking: true,
    summary,
    evidence: evidence === undefined ? null : evidence,
    nextStep: nextStep || null,
  };
}

/** Cap a name list for display; the count beside it is never capped. */
function capped(list) {
  return list.length <= LIST_CAP ? list.slice() : list.slice(0, LIST_CAP).concat(['... ' + (list.length - LIST_CAP) + ' more']);
}

/** First line of a subprocess's stderr, trimmed -- enough to tell a refusal from a crash. */
function errHead(r) {
  const s = String((r && r.stderr) || '').split('\n').map(l => l.trim()).filter(Boolean);
  return s.length ? s[0].slice(0, 200) : null;
}

// ===========================================================================
// S27.2 check 1 -- worktree
// ===========================================================================
// Runtime state is excluded by the same rule the diff fingerprint uses (isStateExcluded), so
// an open fast window or a fresh evidence log is not "uncommitted work". Everything else
// is: what would ship is the commit, and anything sitting beside it was never tested by the
// thing that tested the commit.

function checkWorktree() {
  const changed = changedPaths();
  if (changed && changed.nonGit) {
    return result('worktree', 'DEGRADED', 'not a git repository, so there is no commit to judge', null, null);
  }
  const dirty = changed.filter(p => !isStateExcluded(p)).map(toPosixPath).sort();
  if (dirty.length === 0) {
    return result('worktree', 'PASS', 'no uncommitted changes outside runtime state', { dirty: 0 }, null);
  }
  return result('worktree', 'FAIL',
    dirty.length + ' uncommitted path(s); what would ship is not what was tested',
    { dirty: dirty.length, paths: capped(dirty) },
    'git status --porcelain');
}

// ===========================================================================
// S27.3 check 2 -- remote
// ===========================================================================
// Deliberately not `git status`'s ahead/behind: those read .git/refs/remotes, which is a
// cache of the last fetch. The question here is what origin has right now.

/** Current branch name, or null on a detached HEAD (where "the branch" is not a thing). */
function currentBranch() {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (r.status !== 0) return null;
  const name = r.stdout.toString('utf8').trim();
  return (!name || name === 'HEAD') ? null : name;
}

/** True if a remote called origin is configured. Local, so the no-remote case costs nothing. */
function hasOrigin() {
  const r = git(['remote']);
  if (r.status !== 0) return false;
  return r.stdout.toString('utf8').split('\n').map(s => s.trim()).includes('origin');
}

/**
 * Ask origin for one branch ref. Own spawnSync rather than core's git(), because this is the
 * only call in the module that goes over the wire and it needs a ceiling core's helper has no
 * reason to carry. `--exit-code` is what separates "origin does not have that branch" (2)
 * from "origin could not be reached" (anything else) -- one is a blocker, the other is not
 * knowable from here.
 */
function lsRemoteBranch(branch) {
  const r = spawnSync('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/' + branch], {
    cwd: projectRoot(), input: '', encoding: 'utf8', timeout: REMOTE_TIMEOUT_MS,
  });
  if (r.error || r.signal) {
    return { reachable: false, detail: r.signal ? ('timed out after ' + REMOTE_TIMEOUT_MS + 'ms') : String(r.error.message) };
  }
  if (r.status === 2) return { reachable: true, missing: true };
  if (r.status !== 0) return { reachable: false, detail: errHead(r) || ('git ls-remote exited ' + r.status) };
  const line = String(r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
  const sha = line.split(/\s+/)[0] || '';
  if (!/^[0-9a-f]{40}$/.test(sha)) return { reachable: false, detail: 'unreadable ls-remote output' };
  return { reachable: true, sha };
}

/** Why local and remote differ, expressed as the command that resolves it. Local reads only. */
function divergenceStep(remoteSha, branch) {
  const known = git(['cat-file', '-e', remoteSha + '^{commit}']);
  if (known.status !== 0) return 'git fetch origin  # origin has a commit this clone has never seen';
  const ancestor = git(['merge-base', '--is-ancestor', remoteSha, 'HEAD']);
  if (ancestor.status === 0) return 'git push origin ' + branch + '  # local is ahead of origin';
  return 'git fetch origin && git log --oneline HEAD..origin/' + branch + '  # the two have diverged';
}

function checkRemote() {
  const head = headCommit();
  if (!head) return result('remote', 'DEGRADED', 'no HEAD commit to compare', null, null);
  const branch = currentBranch();
  if (!branch) {
    return result('remote', 'DEGRADED', 'detached HEAD, so there is no branch to compare against origin',
      { head }, null);
  }
  if (!hasOrigin()) {
    return result('remote', 'DEGRADED', 'no origin remote; local vs remote is UNKNOWN, which is not a pass',
      { branch }, null);
  }
  const remote = lsRemoteBranch(branch);
  if (!remote.reachable) {
    return result('remote', 'DEGRADED',
      'origin could not be reached; local vs remote is UNKNOWN, which is not a pass',
      { branch, detail: remote.detail }, null);
  }
  if (remote.missing) {
    return result('remote', 'FAIL', 'origin has no branch ' + branch + '; this commit exists nowhere but here',
      { branch, head }, 'git push -u origin ' + branch);
  }
  if (remote.sha === head) {
    return result('remote', 'PASS', 'origin/' + branch + ' is this exact commit', { branch, head }, null);
  }
  return result('remote', 'FAIL', 'origin/' + branch + ' is a different commit than local HEAD',
    { branch, head, remote: remote.sha }, divergenceStep(remote.sha, branch));
}

// ===========================================================================
// S27.4 check 3 -- dod
// ===========================================================================
// The verdict is dod's own exit code, mapped through dod's own mapper. Re-deriving it from
// the JSON body would be a second opinion about a command that already has one.

function harnessEntry() {
  return path.join(HARNESS_DIR, 'harness.mjs');
}

function checkDod() {
  const r = spawnSync(process.execPath, [harnessEntry(), 'dod'], {
    cwd: projectRoot(),
    input: '',
    encoding: 'utf8',
    timeout: DOD_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot() },
  });
  if (r.error || r.signal) {
    return result('dod', 'DEGRADED', 'dod could not be run to a verdict',
      { detail: r.signal ? ('timed out after ' + DOD_TIMEOUT_MS + 'ms') : String(r.error.message) },
      'node .claude/harness/harness.mjs dod');
  }
  let body = null;
  try { body = JSON.parse(String(r.stdout || '').trim()); } catch (_e) { body = null; }
  const code = typeof r.status === 'number' ? r.status : null;
  const status = code === null ? 'FAIL' : dodStatus(code);
  const failures = (body && Array.isArray(body.blockingFailures)) ? body.blockingFailures : [];
  const steps = (body && Array.isArray(body.steps)) ? body.steps.length : null;
  if (status === 'PASS') {
    return result('dod', 'PASS', 'every blocking governance step passed', { exit: code, steps }, null);
  }
  if (status === 'DEGRADED') {
    return result('dod', 'DEGRADED', 'no blocking step reached a verdict, so nothing was established',
      { exit: code, steps }, null);
  }
  return result('dod', 'FAIL',
    failures.length ? ('blocking step(s) failed: ' + failures.join(', ')) : 'dod did not reach a satisfied verdict',
    { exit: code, steps, blockingFailures: capped(failures) },
    'node .claude/harness/harness.mjs dod' + (failures.length ? ' --only ' + failures.join(',') : ''));
}

// ===========================================================================
// S27.5 check 4 -- manifest
// ===========================================================================
// The question is not "does every listed file still hash the same". It is "is this manifest
// what gen-manifest.sh would write right now", because that is the property the installer
// depends on: setup.sh copies the same set with the same exclusion list, and a framework file
// with no manifest row is treated as user-modified and never overwritten on upgrade. A stale
// manifest therefore does not break loudly -- it makes an upgrade quietly skip files.
//
// The enumeration below reproduces gen-manifest.sh's `case` arms in their order, and two of
// that construct's properties are reproduced with them: `*` matches `/` in a shell case
// pattern, and the first matching arm wins. Approximating either would make this check
// disagree with the generator it is auditing, which is worse than not having it.
//
// Line order is deliberately not compared: gen-manifest pipes through `sort` under whatever
// locale the machine has, so byte order is not a property of the content. Sets are compared.
//
// Four hand-synced copies of this one exclusion set exist: gen-manifest.sh (the generator),
// setup.sh copy_claude_tree and setup.ps1 (the two installers), and this one (the auditor).
// None of them share a source, for two different reasons -- an installer has to run standalone
// against a source tree (setup.sh does not even dare depend on jq), and an auditor that reads
// the generator's own table cannot detect the generator drifting. The cost is manual sync, so
// the wording is held by tests: .claude/tests/test-release-manifest.sh makes real files and
// locks this table against gen-manifest.sh behaviourally, and .claude/tests/test-setup.sh
// section (6) compares the arms of all four literally. Junk files that .claude/.gitignore
// excludes (.DS_Store / Thumbs.db / *.swp) belong here too: unexcluded they get registered as
// framework files and installed into other people's projects.
// So does .claude/worktrees/, where Claude Code isolates a sub-agent by checking out a whole
// copy of the repo -- file for file the same names as the framework's own, one .claude/ deeper.

const MANIFEST_FILE = 'FRAMEWORK-MANIFEST.txt';

const MANIFEST_RULES = [
  { pattern: 'FRAMEWORK-MANIFEST.txt', keep: false },
  { pattern: 'settings.json', keep: false },
  { pattern: 'settings-windows.json', keep: false },
  { pattern: 'settings.local.json', keep: false },
  { pattern: '.needs-review', keep: false },
  { pattern: '.needs-review.lock', keep: false },
  { pattern: '.tdd-exempt', keep: false },
  { pattern: '.red-verified', keep: false },
  { pattern: '.static-gate', keep: false },
  { pattern: '.degraded-review', keep: false },
  { pattern: '.fast-mode', keep: false },
  { pattern: '.subagent-reminded', keep: false },
  { pattern: '.stop-gate-strikes', keep: false },
  { pattern: '.stop-gate-advised', keep: false },
  { pattern: '.precompact-block-epoch', keep: false },
  { pattern: '.async-verify-last', keep: false },
  { pattern: 'signals.jsonl', keep: false },
  { pattern: '*/signals.jsonl', keep: false },
  { pattern: 'evidence/*', keep: false },
  { pattern: 'harness/receipts/*', keep: false },
  { pattern: 'harness/state/*', keep: false },
  { pattern: 'harness/waivers/*', keep: false },
  { pattern: 'harness/trend/*', keep: false },
  { pattern: 'harness/evidence/*', keep: false },
  { pattern: 'harness/ext/*', keep: false },
  { pattern: '.runtime/*', keep: false },
  { pattern: 'worktrees/*', keep: false },
  { pattern: 'tests/*', keep: false },
  { pattern: 'research/*', keep: false },
  { pattern: 'agent-memory/*', keep: false },
  { pattern: '*.bak', keep: false },
  { pattern: '*.framework-new', keep: false },
  { pattern: '.DS_Store', keep: false },
  { pattern: '*/.DS_Store', keep: false },
  { pattern: 'Thumbs.db', keep: false },
  { pattern: '*/Thumbs.db', keep: false },
  { pattern: '*.swp', keep: false },
  { pattern: 'feedback/templates/*', keep: true },
  { pattern: 'feedback/*/*', keep: true },
  { pattern: 'feedback/*.md', keep: false },
];

/** Shell `case` glob semantics: `*` spans `/`, `?` is one character, everything else literal. */
function caseGlobToRegExp(pattern) {
  let re = '^';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$');
}

const MANIFEST_MATCHERS = MANIFEST_RULES.map(r => ({ re: caseGlobToRegExp(r.pattern), keep: r.keep }));

/** Would gen-manifest.sh put this path (relative to .claude/) in the manifest? Pure. */
function manifestIncludes(rel) {
  for (const m of MANIFEST_MATCHERS) {
    if (m.re.test(rel)) return m.keep;
  }
  return true;
}

/**
 * sha256 of the file with CR bytes removed, which is what `tr -d '\r' | sha256sum` computes.
 * Bytes, not text: the generator's tr is byte-oriented and a utf8 round-trip through a string
 * would not be.
 */
function normalizedSha(file) {
  const buf = fs.readFileSync(file);
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0d) out[n++] = buf[i];
  }
  return sha256(out.subarray(0, n));
}

/** Every regular file under .claude/, relative and POSIX-separated. Symlinks are not files here. */
function walkClaudeTree(dir, base, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return out; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkClaudeTree(abs, base, out);
    else if (e.isFile()) out.push(toPosixPath(path.relative(base, abs)));
  }
  return out;
}

/** Parse the manifest into path -> sha. Comment lines and blanks are skipped, as the readers do. */
function parseManifest(text) {
  const map = new Map();
  for (const line of String(text).split('\n')) {
    const s = line.replace(/\r$/, '');
    if (!s || s.startsWith('#')) continue;
    const tab = s.indexOf('\t');
    if (tab < 0) continue;
    map.set(s.slice(0, tab), s.slice(tab + 1).trim());
  }
  return map;
}

/** Compare a parsed manifest against a live listing. Pure, so the three finding kinds are testable. */
function manifestFindings(declared, actual) {
  const missing = [];
  const stale = [];
  const changed = [];
  for (const [rel, sha] of actual) {
    if (!declared.has(rel)) missing.push(rel);
    else if (declared.get(rel) !== sha) changed.push(rel);
  }
  for (const rel of declared.keys()) {
    if (!actual.has(rel)) stale.push(rel);
  }
  return { missing: missing.sort(), stale: stale.sort(), changed: changed.sort() };
}

function checkManifest() {
  const claudeDir = path.join(projectRoot(), '.claude');
  const manifestPath = path.join(claudeDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return result('manifest', 'DEGRADED',
      'no .claude/' + MANIFEST_FILE + '; this tree does not distribute a framework layer', null, null);
  }
  let declared;
  try { declared = parseManifest(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {
    return result('manifest', 'DEGRADED', 'manifest present but unreadable',
      { detail: String(e && e.message || e) }, null);
  }
  const actual = new Map();
  for (const rel of walkClaudeTree(claudeDir, claudeDir, [])) {
    if (!manifestIncludes(rel)) continue;
    try { actual.set(rel, normalizedSha(path.join(claudeDir, rel))); } catch (_e) { /* vanished mid-walk */ }
  }
  const f = manifestFindings(declared, actual);
  const total = f.missing.length + f.stale.length + f.changed.length;
  if (total === 0) {
    return result('manifest', 'PASS', declared.size + ' framework file(s) match the manifest',
      { declared: declared.size, onDisk: actual.size }, null);
  }
  return result('manifest', 'FAIL',
    'manifest is not what gen-manifest.sh would write: ' + f.missing.length + ' unlisted, '
      + f.stale.length + ' listed but absent, ' + f.changed.length + ' with a different digest',
    {
      declared: declared.size, onDisk: actual.size,
      missingFromManifest: capped(f.missing), staleInManifest: capped(f.stale), digestChanged: capped(f.changed),
    },
    'bash .claude/scripts/gen-manifest.sh');
}

// ===========================================================================
// S27.6 checks 5 and 6 -- review queue and fast mode
// ===========================================================================
// Both read state through memory.mjs rather than re-reading the flag files, so the stop
// gate, `invariants` and this command cannot drift into three readings of one fact.

function checkReviewQueue() {
  const pending = pendingReviewCount();
  if (pending === 0) {
    return result('review-queue', 'PASS', 'nothing waiting for review', { pending: 0 }, null);
  }
  return result('review-queue', 'FAIL', pending + ' file(s) still queued for review',
    { pending }, 'cat .claude/.needs-review');
}

// The fast tier is debt, not a mode. An open window means this batch skipped the review and
// test gates, so there is deliberately no flag here to wave it through -- a release-side
// exemption would be a waiver with none of a waiver's owner, expiry or compensation. Closing
// it is one command, and if the batch really was reviewed, closing it costs nothing.
// Anything other than fast passes: standard is the normal posture and strict is stricter than
// normal, so the only question this check has is whether the gates were lowered for this batch.
function checkTier() {
  const state = fastModeState();
  if (!state.active) {
    return result('tier', 'PASS', state.tier + '; the review and test gates were in force',
      { tier: state.tier, source: state.source, active: false }, null);
  }
  return result('tier', 'FAIL',
    'fast, so this batch skipped the review and test gates -- that is debt, not a state',
    { tier: state.tier, source: state.source, active: true, remainingHours: state.remainingHours },
    'bash .claude/scripts/fast-mode.sh off');
}

// ===========================================================================
// S27.7 check 7 -- ci
// ===========================================================================
// The order of the guards is load-bearing. No origin is answered before gh is ever looked
// for, so a tree with no remote gives the same answer on a machine with gh and on one
// without -- which is what makes this command's output reproducible.
//
// UNKNOWN is said out loud in every degraded branch. This check exists because CI was red
// here for over a month while the local runner reported green, and the way that repeats is a
// CI probe that cannot reach CI and reports nothing rather than reporting that it knows
// nothing.

const CI_BAD = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
const CI_GOOD = new Set(['success']);

/** Ask gh for the runs attached to one commit. Read-only; gh has no side effect here. */
function ghRunsForCommit(sha) {
  const r = spawnSync('gh',
    ['run', 'list', '--commit', sha, '--limit', '20', '--json', 'databaseId,status,conclusion,workflowName'], {
      cwd: projectRoot(), input: '', encoding: 'utf8', timeout: CI_TIMEOUT_MS,
      env: { ...process.env, GH_PAGER: 'cat', GH_NO_UPDATE_NOTIFIER: '1', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
    });
  if (r.error || r.signal) {
    return { ok: false, detail: r.signal ? ('timed out after ' + CI_TIMEOUT_MS + 'ms') : String(r.error.message) };
  }
  if (r.status !== 0) return { ok: false, detail: errHead(r) || ('gh exited ' + r.status) };
  let runs = null;
  try { runs = JSON.parse(String(r.stdout || '').trim()); } catch (_e) { runs = null; }
  if (!Array.isArray(runs)) return { ok: false, detail: 'gh returned output this could not read as JSON' };
  return { ok: true, runs };
}

/** Split runs into the three buckets a verdict is made from. Pure. */
function ciBuckets(runs) {
  const bad = [];
  const good = [];
  const inconclusive = [];
  for (const run of runs) {
    const name = String((run && run.workflowName) || 'workflow');
    const conclusion = String((run && run.conclusion) || '');
    if (String((run && run.status) || '') !== 'completed') inconclusive.push(name + ': ' + (run.status || 'unknown'));
    else if (CI_BAD.has(conclusion)) bad.push(name + ': ' + conclusion);
    else if (CI_GOOD.has(conclusion)) good.push(name + ': ' + conclusion);
    else inconclusive.push(name + ': ' + (conclusion || 'no conclusion'));
  }
  return { bad, good, inconclusive };
}

function checkCi() {
  const head = headCommit();
  if (!head) return result('ci', 'DEGRADED', 'no HEAD commit, so CI status is UNKNOWN -- unknown is not a pass', null, null);
  if (!hasOrigin()) {
    return result('ci', 'DEGRADED', 'no origin remote, so CI status is UNKNOWN -- unknown is not a pass',
      { head }, null);
  }
  if (!whichCmd('gh')) {
    return result('ci', 'DEGRADED', 'gh is not installed, so CI status is UNKNOWN -- unknown is not a pass',
      { head }, 'install gh, then: gh run list --commit ' + head);
  }
  const q = ghRunsForCommit(head);
  if (!q.ok) {
    return result('ci', 'DEGRADED', 'CI could not be queried, so its status is UNKNOWN -- unknown is not a pass',
      { head, detail: q.detail }, 'gh auth status && gh run list --commit ' + head);
  }
  if (q.runs.length === 0) {
    return result('ci', 'DEGRADED',
      'CI has never run this commit (unpushed, or no workflow matched), so its status is UNKNOWN -- unknown is not a pass',
      { head, runs: 0 }, 'git push && gh run list --commit ' + head);
  }
  const b = ciBuckets(q.runs);
  if (b.bad.length) {
    return result('ci', 'FAIL', 'CI failed on this commit: ' + b.bad.join('; '),
      { head, runs: q.runs.length, failed: capped(b.bad) },
      'gh run list --commit ' + head);
  }
  if (b.inconclusive.length) {
    return result('ci', 'DEGRADED',
      'CI reached no conclusion for ' + b.inconclusive.length + ' run(s), so its status is UNKNOWN -- unknown is not a pass',
      { head, runs: q.runs.length, inconclusive: capped(b.inconclusive) },
      'gh run list --commit ' + head);
  }
  return result('ci', 'PASS', 'CI passed on this commit: ' + b.good.join('; '),
    { head, runs: q.runs.length }, null);
}

// ===========================================================================
// S27.8 check 8 -- gate-fresh
// ===========================================================================
// Every other check reads a fact about the tree; this one asks whether the tree was ever
// verified at all. Without it, `release` can report seven greens over a working tree no gate
// has ever seen: `dod` covers the static governance checks and says so in its own note, and
// nothing else in the list runs a single project check. "Ready to ship" would then mean "the
// paperwork is in order".
//
// The binding is the diff fingerprint, the same one receipts use. A gate record establishes
// something about the tree it ran against and nothing about any other, so one edit after the
// gate and the record describes a tree that no longer exists.
//
// Two shapes of PASS are refused, because both established nothing. A Fast Mode run where
// every check was skipped aggregates to gate:'PASS' with exit 0 -- inherited semantics, not a
// bug -- so without this one empty Fast Mode run would feed the release gate forever. And a
// run whose scope the caller chose (`gate --changed ...`) carries a real tree fingerprint
// beside a scope somebody picked, which is the same forgery `task complete` refuses for the
// same reason: the signature is genuine, the thing signed is not.
//
// A run that affected no module is accepted. Nothing needed checking, and since `release`
// already blocks on a dirty worktree, that is the honest shape of a gate run at release time
// -- refusing it would leave this check unsatisfiable at exactly the moment it is consulted.
//
// No catalog means there is no gate for the tree to be fresh against: DEGRADED, reported as
// UNKNOWN, and not a blocker. cc-base itself is such a tree, and a check that stopped it from
// releasing would be deleted inside a week.

const GATE_STEP = 'node .claude/harness/harness.mjs gate';

/** Did this gate record establish anything about the tree it is bound to? Pure. */
function gateEstablished(rec) {
  if (!rec || rec.reason === 'every-check-skipped') return false;
  if (rec.scopeSource === 'caller') return false;
  const results = Array.isArray(rec.results) ? rec.results : [];
  if (results.length === 0) return true;                 // no affected module: nothing to run
  return results.some(r => r && r.state !== 'SKIPPED');
}

function checkGateFresh() {
  if (!isGitRepo()) {
    return result('gate-fresh', 'DEGRADED',
      'not a git repository, so there is no working tree for a gate to be bound to', null, null);
  }
  const loaded = loadCatalog();
  if (!loaded.ok) {
    return result('gate-fresh', 'DEGRADED',
      'no module catalog, so there is no verification gate for this tree to be fresh against',
      { catalog: loaded.error }, null);
  }
  const state = readLedgerState();
  if (state.unreadable) {
    return result('gate-fresh', 'FAIL',
      'the verification ledger exists but could not be read (' + state.unreadable
        + '), so whether this tree was ever gated cannot be established',
      { detail: state.unreadable }, GATE_STEP);
  }
  const diffHash = gitFingerprint();
  const gates = state.entries.filter(e => e && !e.corrupt && e.command === 'gate');
  const bound = gates.filter(e => e.diffHash === diffHash && e.gate === 'PASS');
  const established = bound.filter(gateEstablished);
  if (established.length) {
    const latest = established[established.length - 1];
    return result('gate-fresh', 'PASS', 'a passing gate ran against this exact working tree',
      { diffHash, planHash: latest.planHash || null, gateRecords: gates.length }, null);
  }
  if (bound.length) {
    return result('gate-fresh', 'FAIL',
      bound.length + ' passing gate record(s) bind this tree, but none of them ran a check: '
        + 'a skipped or caller-scoped pass established nothing',
      { diffHash, boundToThisTree: bound.length, gateRecords: gates.length }, GATE_STEP);
  }
  return result('gate-fresh', 'FAIL',
    'no passing gate record is bound to this working tree, so what would ship was never verified',
    { diffHash, gateRecords: gates.length }, GATE_STEP);
}

// ===========================================================================
// S27.9 verdict and entry point
// ===========================================================================

const RELEASE_CHECKS = [
  checkWorktree, checkRemote, checkDod, checkManifest, checkReviewQueue, checkTier, checkCi,
  checkGateFresh,
];

/**
 * Aggregate the checks into a verdict. Same shape of rule dod uses, for the same reason: a
 * run where nothing was established is not a run that passed, so it exits 3 rather than 0.
 * Pure; the exit code follows from it.
 */
function releaseVerdict(checks) {
  const failed = checks.filter(c => c.status === 'FAIL');
  const established = checks.filter(c => c.status !== 'DEGRADED').length;
  if (failed.length) {
    return { ok: false, exit: 1, blockers: failed.map(c => ({ id: c.id, why: c.summary, nextStep: c.nextStep })), established };
  }
  if (checks.length && established === 0) return { ok: false, exit: 3, blockers: [], established, degraded: true };
  return { ok: true, exit: 0, blockers: [], established };
}

const NOTE = 'assembly only: this command never tags, pushes, publishes or writes -- releasing stays a human decision';

// Hardcoded false, on purpose and permanently: see the module header. These are the four
// things a local assembly cannot establish, stated as answers rather than omitted, so that
// nobody downstream has to infer them from what the output does not say.
const TRUST_BOUNDARY = {
  producerIdentityAuthenticated: false,
  ciProvenanceVerified: false,
  externalSignatureVerified: false,
  releaseAuthorized: false,
};

const TRUST_NOTE = 'Trust boundary: this is a release candidate attestation, not a release '
  + 'authorization -- producer identity, CI provenance and external signatures are all unverified here';

function cmdRelease() {
  if (!isGitRepo()) {
    process.stderr.write('Release readiness: cannot be assessed (not a git repository)\n');
    process.stderr.write(TRUST_NOTE + '\n');
    return emit({
      ok: false, degraded: true, error: 'non-git', checks: [], blockers: [], established: 0,
      trustBoundary: { ...TRUST_BOUNDARY }, note: NOTE,
    }, 3);
  }
  const checks = RELEASE_CHECKS.map(fn => fn());
  for (const c of checks) {
    process.stderr.write(' ' + c.status.padEnd(9) + c.id.padEnd(14) + c.summary + '\n');
  }
  const verdict = releaseVerdict(checks);
  const degraded = checks.filter(c => c.status === 'DEGRADED').map(c => c.id);
  if (verdict.ok) {
    process.stderr.write('Release readiness: every blocking check passed'
      + (degraded.length ? ' (UNKNOWN, not passed: ' + degraded.join(', ') + ')' : '') + '\n');
  } else if (verdict.blockers.length) {
    process.stderr.write('Release readiness: NOT ready (' + verdict.blockers.map(b => b.id).join(', ') + ')\n');
    for (const b of verdict.blockers) process.stderr.write('   ' + b.id + ' -> ' + b.nextStep + '\n');
  } else {
    process.stderr.write('Release readiness: nothing could be established (every check is UNKNOWN)\n');
  }
  process.stderr.write(TRUST_NOTE + '\n');
  return emit({
    ok: verdict.ok,
    ...(verdict.degraded ? { degraded: true } : {}),
    checks,
    blockers: verdict.blockers,
    degradedChecks: degraded,
    established: verdict.established,
    trustBoundary: { ...TRUST_BOUNDARY },
    note: NOTE,
  }, verdict.exit);
}

export {
  MANIFEST_RULES, RELEASE_CHECKS, NOTE, TRUST_BOUNDARY, TRUST_NOTE,
  caseGlobToRegExp, manifestIncludes, normalizedSha, parseManifest, manifestFindings,
  ciBuckets, releaseVerdict, result, capped,
  checkWorktree, checkRemote, checkDod, checkManifest, checkReviewQueue, checkTier, checkCi,
  gateEstablished, checkGateFresh,
  cmdRelease,
};
