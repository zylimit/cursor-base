// harness.mjs -- cc-base monorepo governance runtime: CLI surface, zero npm deps.
// Node builtins only: node:crypto / node:fs / node:path / node:child_process / node:process.
// Default-off: catalog presence (.claude/harness/module-catalog.json) is the only switch.
// All subcommands: stdout single-line JSON + exit code; human diagnostics -> stderr.
// Source is ASCII-only (matches the .ps1 pure-ASCII convention) to avoid cross-platform encoding traps.
//
// This file holds the CLI only: argument parsing, the dispatch table, and the four
// subcommands that stay available with nothing else installed (doctor / diff-hash / selftest
// / tier). Everything else is the large-repo package under ext/ -- fifteen thousand lines that
// do nothing at all until a module-catalog.json exists, so a project that never governs a
// monorepo has no reason to carry them, read them, or test them. They ship separately
// (setup.sh --with-harness) and their dispatch arms import on demand rather than at load time:
// a static import would put the whole package back in the startup cost of `tier status`.
//
// Module map (import direction is one-way, so nothing has to be resolved at load time):
//   lib/core.mjs      S1 common, S2 git, S3 glob, S9 config + the vocabulary shared across
//                     sections (typedefs, attribute tiers, parseCsv, DENY/isDenied,
//                     SOURCE_EXTS, whichCmd). Imports node builtins only.
//   lib/tier.mjs      S28 tier dial: status / set / explain / validate. The only section that
//                     imports outside the engine -- the judgement lives in the single resolver
//                     .claude/hooks/lib/tier.mjs, and reading it from there is what keeps the
//                     engine from becoming a second answer to "is fast mode on".
//   ext/catalog.mjs   S4 catalog        loadCatalog / validateSchema / classifyPath / lintCatalog
//   ext/graph.mjs     S5 impact + S12 arch-check + S16 arch-trend + S26 cochange
//   ext/quality.mjs   S7 receipt + S8 quality gate + S10 waiver + S11 attributes
//   ext/scan.mjs      S13 fitness + S14 adapters + S15 adr-check
//   ext/context.mjs   S6 context-pack
//   ext/evidence.mjs  S17 gate + ledger + gate-audit + retention + risk
//   ext/task.mjs      S18 task envelope + budget
//   ext/spec.mjs      S19 spec-lint + trace + spec + dod
//   ext/review.mjs    S20 review engine + review-pack + the authorship ledger
//   ext/memory.mjs    S21 invariants + recap + archive + sync-check
//   ext/rules.mjs     S22 rules-audit + S23 skills-lint + S24 claude-md-lint
//   ext/init.mjs      S25 init
//   ext/release.mjs   S27 release readiness (assembly only; publishes nothing)
//   ext/selftest.mjs  selftestCases() and its fixture
//   ext/rules/        the two rule documents that only mean something with the package
//                     installed; setup.sh --with-harness drops them into .claude/rules/ so the
//                     path-scoped frontmatter keeps working where Claude Code looks for it.
// Dependencies: core -> (nothing); tier -> core + hooks/lib/tier.mjs; catalog -> core;
// graph -> core, catalog; context and quality -> core, catalog, graph; scan -> core, catalog;
// evidence -> core, catalog, graph, quality; task -> the same plus evidence; spec -> core,
// catalog, graph; review -> core, catalog, graph, quality, evidence; memory -> core, quality,
// evidence, task, spec; rules -> core, catalog; init -> core, catalog, graph, evidence;
// release -> core, catalog, evidence, spec, memory; quality, memory, evidence and release ->
// tier; selftest -> all of the above; this file -> lib/ at load time and ext/ on demand.
// No cycles, and nothing in lib/ imports ext/ -- that direction would reattach the package.
//
// Scale target: 600k+ LOC repositories. Hot paths (classifyPath / lintCatalog / impact)
// go through a compiled-regex cache; git path listings are NUL-separated so non-ASCII
// names survive; tracked listings are capped (maxTrackedPaths) and a truncated listing
// degrades conservatively instead of under-reporting.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  HARNESS_DIR, canonicalDiff, die, emit, headCommit, isGitRepo, loadHarnessConfig, matchAny, sha256,
} from './lib/core.mjs';
import { cmdTier } from './lib/tier.mjs';

const EXT_DIR = path.join(HARNESS_DIR, 'ext');
const EXT_MISSING = 'large-repo engine not installed: .claude/harness/ext missing (run setup.sh --with-harness)';

/**
 * Load one ext/ section, or null when the package simply is not installed.
 *
 * The two cases have to stay apart. "Not installed" is the default state of every project that
 * does not govern a monorepo, and answering it with a stack trace would make a normal
 * installation look broken; a section that is present but throws on import is a broken engine,
 * and swallowing that into the same answer would hide it behind an install instruction nobody
 * needs to follow. So the directory's absence is the only thing that turns a resolution failure
 * into the friendly answer -- anything else rethrows.
 * @param {string} name  section file name without extension
 */
async function tryExt(name) {
  try {
    return await import('./ext/' + name + '.mjs');
  } catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && !fs.existsSync(EXT_DIR)) return null;
    throw e;
  }
}

/**
 * Same, but a missing package ends the run at exit 3 -- degraded, nothing established. Not 1
 * (that means something was found) and not 2 (the command line was fine); hooks read 3 through
 * `rcInContract(rc, 0, 3)` and carry on with their original logic, which is exactly what a
 * project without the package should see.
 */
async function ext(name) {
  return (await tryExt(name)) || die(EXT_MISSING, 3);
}

// ===========================================================================
// S0 CLI dispatch
// ===========================================================================
const IMPLEMENTED_SUBCOMMANDS = ['doctor', 'diff-hash', 'selftest', 'catalog-lint', 'impact', 'context-pack', 'receipt', 'verify', 'waiver', 'attributes', 'arch-check', 'fitness', 'adapters', 'adr-check', 'arch-trend', 'gate', 'ledger', 'gate-audit', 'retention', 'risk', 'task', 'budget', 'spec-lint', 'trace', 'spec', 'dod', 'review', 'review-pack', 'authorship', 'invariants', 'recap', 'archive', 'sync-check', 'rules-audit', 'skills-lint', 'claude-md-lint', 'init', 'cochange', 'release', 'tier'];
const NOT_IMPLEMENTED_SUBCOMMANDS = [];

// Which flags each subcommand actually reads. parseArgs collects any `--x` it is handed, and
// without this table it collected a misspelling just as happily: `impact --paths x` (--paths
// belongs to fitness, impact's flag is --changed) exited 0 with a full JSON body having
// measured the wrong thing, and a baseline recorded that way looks normal while asserting
// nothing. An unread flag is a usage error, so it exits 2 -- not 3, which means degraded, and
// not 1, which means something was found.
//
// Each row is the set of `flags.<key>` reads reachable from that subcommand's entry point,
// taken from the source rather than from the documentation, and it is a union over the
// sub-forms (`review` covers start/lens/verdict/team, `waiver` covers list/check/create).
// Two spellings of one switch both appear where the source reads both. A row that is missing
// a flag turns a correct invocation into a usage error, which is worse than the silence it
// replaces, so the two directions are pinned in selftest: every implemented subcommand has a
// row, every row names an implemented subcommand, and every flag in every row survives a real
// invocation. A subcommand with no row accepts no flags, which fails loudly on the day one is
// added without its row rather than quietly going back to collecting anything.
//
// There is no global group: no flag is read by every subcommand. `--catalog` comes closest and
// is still absent from eighteen of them, and listing it globally would advertise a switch that
// `doctor`, `ledger` or `recap` would then silently ignore -- the same defect one level up.
const SUBCOMMAND_FLAGS = {
  'doctor': [],
  'diff-hash': [],
  'selftest': [],
  'catalog-lint': ['catalog', 'tracked'],
  'impact': ['catalog', 'changed'],
  'context-pack': ['budget-chars', 'catalog', 'changed', 'task'],
  'receipt': ['task'],
  'verify': ['catalog', 'changed'],
  'waiver': ['compensation', 'dry-run', 'dryRun', 'expiry', 'file', 'owner', 'reason', 'scope', 'sub'],
  'attributes': ['catalog', 'module'],
  'arch-check': ['catalog', 'max-files', 'record'],
  'fitness': ['all', 'catalog', 'paths', 'rules-file'],
  'adapters': ['attribute', 'catalog', 'dry-run', 'dryRun', 'id'],
  'adr-check': ['catalog', 'dir', 'file'],
  'arch-trend': ['gate'],
  'gate': ['catalog', 'changed'],
  'ledger': ['no-verify-evidence'],
  'gate-audit': ['catalog'],
  'retention': ['apply', 'max-age-days', 'max-evidence', 'max-packs'],
  'risk': ['catalog'],
  // `task complete` rejects --changed with its own message and exit 3 (the scope of a
  // completion is not the caller's to state), which is a stricter answer than this table's.
  // Dropping it here would replace that answer with a flat usage error and lose the reason.
  'task': ['catalog', 'changed'],
  'budget': ['catalog'],
  'spec-lint': ['file'],
  'trace': ['catalog', 'file', 'min-coverage', 'tests'],
  'spec': ['all', 'budget', 'catalog', 'file', 'paths', 'tests'],
  'dod': ['only'],
  'review': ['agent', 'catalog', 'notes', 'pack', 'reviewer', 'scope'],
  'review-pack': ['base', 'max-diff-lines'],
  'authorship': [],
  'invariants': ['budget', 'file', 'rules'],
  'recap': ['budget', 'changelog', 'file', 'spec'],
  'archive': ['apply', 'archive', 'file', 'max-entries'],
  'sync-check': ['staged'],
  'rules-audit': ['limit'],
  'skills-lint': ['limit'],
  'claude-md-lint': ['catalog', 'limit'],
  'init': ['apply', 'catalog', 'max-modules'],
  'cochange': ['catalog', 'gate', 'max-commits', 'max-files-per-commit', 'min-support'],
  // Empty on purpose, and it is the one row that has to stay empty. Every switch this
  // subcommand could plausibly grow -- --skip-ci, --allow-dirty, --force -- is a waiver with
  // none of a waiver's owner, expiry or compensation, granted by whoever is in a hurry.
  'release': [],
  // `explain <hook-id>` and `set <tier>` are positional; the two flags below belong to `set`
  // alone, and `set` rejects --hours for a tier that has no expiry rather than dropping it.
  'tier': ['hours', 'reason', 'sticky'],
};

/**
 * Parse `<subcommand> [--flag value ...] [positional ...]`.
 * A flag with no following value (or followed by another --flag) is boolean true.
 * @param {string[]} argv  process.argv.slice(2)
 */
function parseArgs(argv) {
  const cmd = argv[0];
  const flags = {};
  const positional = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd, flags, positional, sub: positional[0] };
}

/**
 * Flags the named subcommand does not read, in the order they were given.
 * An unrecognised subcommand answers nothing here: usage() already names that, and reporting
 * its flags too would bury the one thing wrong with the line.
 * @param {string} cmd
 * @param {Object} flags
 * @returns {string[]}
 */
function unknownFlags(cmd, flags) {
  if (!IMPLEMENTED_SUBCOMMANDS.includes(cmd)) return [];
  const allowed = SUBCOMMAND_FLAGS[cmd] || [];
  return Object.keys(flags).filter(k => !allowed.includes(k));
}

/**
 * Name the flags that were not understood, then name the ones that would have been. The
 * second half is the part that matters: a bare rejection sends the reader to the source,
 * and the flag they wanted is usually one line away from the one they typed.
 */
function flagUsage(cmd, unknown) {
  const allowed = SUBCOMMAND_FLAGS[cmd] || [];
  return (unknown.length === 1 ? 'unknown flag for ' : 'unknown flags for ') + cmd + ': '
    + unknown.map(f => '--' + f).join(', ') + '\n'
    + (allowed.length
      ? cmd + ' reads: ' + allowed.map(f => '--' + f).join(', ') + '\n'
      : cmd + ' reads no flags\n')
    + 'a flag no subcommand reads used to be collected and ignored, which left the command\n'
    + 'running in its no-argument shape and reporting success over something it never measured\n';
}

// The four arms above the divider run with lib/ alone; every arm below it resolves its section
// at call time, so an uninstalled package costs one existsSync and never a load-time failure.
async function main() {
  const { cmd, flags, positional } = parseArgs(process.argv.slice(2));
  const unknown = unknownFlags(cmd, flags);
  if (unknown.length) return die(flagUsage(cmd, unknown), 2);
  switch (cmd) {
    case 'doctor':       return cmdDoctor();
    case 'diff-hash':    return cmdDiffHash();
    case 'selftest':     return cmdSelftest();
    case 'tier':         return cmdTier(flags, positional);
    case 'catalog-lint': return (await ext('catalog')).cmdCatalogLint(flags);
    case 'impact':       return (await ext('graph')).cmdImpact(flags);
    case 'context-pack': return (await ext('context')).cmdContextPack(flags);
    case 'receipt':      return (await ext('quality')).cmdReceipt(flags, positional);
    case 'verify':       return (await ext('quality')).cmdVerify(flags);
    case 'waiver':       return (await ext('quality')).cmdWaiver(flags, positional);
    case 'attributes':   return (await ext('quality')).cmdAttributes(flags);
    case 'arch-check':   return (await ext('graph')).cmdArchCheck(flags);
    case 'fitness':      return (await ext('scan')).cmdFitness(flags);
    case 'adapters':     return (await ext('scan')).cmdAdapters(flags, positional);
    case 'adr-check':    return (await ext('scan')).cmdAdrCheck(flags);
    case 'arch-trend':   return (await ext('graph')).cmdArchTrend(flags);
    case 'gate':         return (await ext('evidence')).cmdGate(flags);
    case 'ledger':       return (await ext('evidence')).cmdLedger(flags);
    case 'gate-audit':   return (await ext('evidence')).cmdGateAudit(flags);
    case 'retention':    return (await ext('evidence')).cmdRetention(flags);
    case 'risk':         return (await ext('evidence')).cmdRisk(flags);
    case 'task':         return (await ext('task')).cmdTask(flags, positional);
    case 'budget':       return (await ext('task')).cmdBudget(flags);
    case 'spec-lint':    return (await ext('spec')).cmdSpecLint(flags);
    case 'trace':        return (await ext('spec')).cmdTrace(flags);
    case 'spec':         return (await ext('spec')).cmdSpec(flags);
    case 'dod':          return (await ext('spec')).cmdDod(flags);
    case 'review':       return (await ext('review')).cmdReview(flags, positional);
    case 'review-pack':  return (await ext('review')).cmdReviewPack(flags);
    case 'authorship':   return (await ext('review')).cmdAuthorship(flags, positional);
    case 'invariants':   return (await ext('memory')).cmdInvariants(flags);
    case 'recap':        return (await ext('memory')).cmdRecap(flags);
    case 'archive':      return (await ext('memory')).cmdArchive(flags);
    case 'sync-check':   return (await ext('memory')).cmdSyncCheck(flags);
    case 'rules-audit':  return (await ext('rules')).cmdRulesAudit(flags, IMPLEMENTED_SUBCOMMANDS);
    case 'skills-lint':  return (await ext('rules')).cmdSkillsLint(flags);
    case 'claude-md-lint': return (await ext('rules')).cmdClaudeMdLint(flags);
    case 'init':         return (await ext('init')).cmdInit(flags);
    case 'cochange':     return (await ext('graph')).cmdCoChange(flags);
    // No flags argument: the row above is empty, so there is nothing to hand it.
    case 'release':      return (await ext('release')).cmdRelease();
    default:
      return die(usage(cmd), 3);
  }
}

function usage(cmd) {
  const prefix = cmd ? ('unknown subcommand: ' + cmd + '\n') : 'missing subcommand\n';
  return prefix +
    'usage: node harness.mjs <subcommand>\n' +
    'implemented: ' + IMPLEMENTED_SUBCOMMANDS.join(', ') + '\n' +
    '  attributes  static wiring audit: declared quality attributes vs claiming checks\n' +
    '  arch-check  real import edges vs declared graph (forbidden deps / layers / cycles); --record snapshots drift\n' +
    '  fitness     built-in day-one rules (secrets/pii/silent-failure/retry/deferral); --rules-file <path> scans by that file\'s rules only (subset gates)\n' +
    '  adapters    list external quality tools, or add one into catalog checks\n' +
    '  adr-check   every active ADR must name a real enforcement (check/rule/harness cap or explicit manual)\n' +
    '  arch-trend  drift ratchet over recorded snapshots; --gate fails on new debt beyond best state\n' +
    '  gate        verify plus evidence: each check output on disk, planHash, scope provenance, one ledger entry\n' +
    '  ledger      recompute the hash chain and re-verify evidence digests (--no-verify-evidence to skip); any break fails closed\n' +
    '  gate-audit  catalog checks that never failed, and the ones a waiver suppressed (hook gates: .claude/scripts/gate-audit.sh)\n' +
    '  retention   prune evidence/packs by age and count; refuses to sweep unless the chain verifies\n' +
    '  risk        state decay: broken chain, expired waiver, unwired attribute, fail streak, fast-tier debt, stale task\n' +
    '  task        start|status|complete: six-field envelope in, four blocking conditions out\n' +
    '  budget      blast radius vs catalog.budget; over the line is a split-or-escalate signal\n' +
    '  spec-lint   requirement document must be decidable: section shape, template residue, arrow form, undecidable wording\n' +
    '  trace       requirement id <-> test reference coverage; no ids declared means traceability is unavailable, not passing\n' +
    '  spec        budgeted view of the requirements a change touches (--paths / --all / --budget)\n' +
    '  dod         every static governance check once; blocking failure exits 2, nothing established exits 3\n' +
    '  review      start|blue|lens <name>|verdict|backlog|status|team: staged structured disagreement, verdict computed not asserted\n' +
    '  review-pack evidence for a reviewer, with what the change removed in a section of its own\n' +
    '  authorship  record|show: who wrote which files, so a verdict can refuse a lens reported by the author\n' +
    '  invariants  re-derive what cannot be traded away plus the live state, inside a small budget\n' +
    '  recap       the situation derived from the memory files, on a budget; never from a summary\n' +
    '  archive     move the oldest entries out of the memory file verbatim; --apply to write\n' +
    '  sync-check  memory behind code / spec changed without its changelog (--staged reads the index)\n' +
    '  rules-audit which rule lines reach a real enforcement point, and which only read as if they do\n' +
    '  skills-lint SKILL.md frontmatter the loader can read: a malformed one drops the skill in silence\n' +
    '  claude-md-lint  a high-risk module states its boundaries in its own directory: purpose / boundaries / invariants / verification\n' +
    '  init        infer a catalog draft from the tracked tree; prints it, --apply writes it, and never overwrites one\n' +
    '  cochange    module pairs history keeps changing together with no dependsOn to explain it; --gate judges, the default reports\n' +
    '  release     is this commit shippable: worktree / remote / dod / manifest / review queue / tier / CI / gate-fresh, assembled and never acted on\n' +
    '  tier        status|set|explain|validate: which gates run at full strength right now, and why\n' +
    'planned (not-implemented): ' + NOT_IMPLEMENTED_SUBCOMMANDS.join(', ');
}

// Five of doctor's fields are answered by ext/ sections, and every one of them reads zero when
// the package is absent. `extInstalled` is what keeps that zero from being read as "installed,
// nothing declared" -- the whole point of an environment check is to say which state you are in.
async function cmdDoctor() {
  const cfg = loadHarnessConfig();
  const extInstalled = fs.existsSync(EXT_DIR);
  let waiverCount = 0;
  let waiversDirExists = false;
  try {
    const quality = await tryExt('quality');
    if (quality) {
      waiversDirExists = fs.existsSync(quality.waiversDir());
      if (waiversDirExists) waiverCount = quality.loadWaivers().length;
    }
  } catch (_e) { /* doctor must not throw */ }
  let attributesDeclared = 0;
  let modulesWithLayer = 0;
  let forbiddenEdges = 0;
  try {
    const catalog = await tryExt('catalog');
    const loaded = catalog && catalog.loadCatalog();
    if (loaded && loaded.ok) {
      for (const m of (loaded.catalog.modules || [])) {
        attributesDeclared += Object.keys(m.attributes || {}).length;
        if (m.layer) modulesWithLayer++;
        forbiddenEdges += (m.forbiddenDependencies || []).length;
      }
    }
  } catch (_e) { /* doctor must not throw */ }
  let adaptersPresent = false;
  try {
    const scan = await tryExt('scan');
    if (scan) adaptersPresent = fs.existsSync(scan.adaptersFilePath());
  } catch (_e) { /* doctor must not throw */ }
  emit({
    node: process.version,
    catalogPresent: cfg.catalogPresent,
    gitRepo: isGitRepo(),
    headCommit: headCommit(),
    harnessDir: '.claude/harness',
    extInstalled,
    subcommands: IMPLEMENTED_SUBCOMMANDS,
    waiversDirExists,
    activeWaivers: waiverCount,
    attributesDeclared,
    modulesWithLayer,
    forbiddenEdges,
    adaptersPresent,
  }, 0);
}

function cmdDiffHash() {
  const { buf, nonGit } = canonicalDiff();
  emit({ diffHash: sha256(buf), baseCommit: headCommit(), nonGit }, 0);
}

/**
 * The one assertion left when ext/ is not installed: core's glob compiler, which every
 * classification in the package is built on. A smoke test is not a suite, so the output says
 * `ext: "not installed"` alongside `tests: 1` -- otherwise a green one would be read as the
 * green hundred-and-forty-one, which is the single worst thing this command could report.
 */
function coreSelftest() {
  if (!matchAny('src/a/b.ts', ['src/**/*.ts'])) throw new Error('src/**/*.ts should match src/a/b.ts');
  if (matchAny('src/a/b.js', ['src/**/*.ts'])) throw new Error('src/**/*.ts should not match src/a/b.js');
}

async function cmdSelftest() {
  const mod = await tryExt('selftest');
  if (!mod) {
    try { coreSelftest(); } catch (e) {
      return emit({ ok: false, tests: 1, ext: 'not installed', failed: [{ name: 'core-glob', error: String(e && e.message || e) }] }, 1);
    }
    return emit({ ok: true, tests: 1, ext: 'not installed' }, 0);
  }
  const cases = mod.selftestCases();
  const failed = [];
  for (const [name, fn] of cases) {
    try { fn(); } catch (e) { failed.push({ name, error: String(e && e.message || e) }); }
  }
  if (failed.length) return emit({ ok: false, tests: cases.length, failed }, 1);
  return emit({ ok: true, tests: cases.length }, 0);
}

main();
