// ext/init.mjs -- S25: infer a module-catalog draft from what the repository already looks like.
// Depends on core, catalog and graph (graph imports catalog, so this cannot live in catalog.mjs
// without making that edge a cycle). Nothing imports this one.
//
// Why it exists: the only switch on the whole large-repo layer is "a compliant
// module-catalog.json is present", and writing that first one by hand against a tree nobody
// has mapped yet is the step where adoption stops. This command turns it into "run one
// command, then read what it guessed" -- and the reading is not optional, which is why the
// draft is printed rather than written unless --apply is passed.
//
// What it deliberately refuses to guess is the more important half:
//   riskTier      every module comes out `low`. A machine that reads a directory name and
//                 answers "high" has manufactured a tier nobody decided, and a tier nobody
//                 decided reads downstream as a judgement that was made -- attributes,
//                 claude-md-lint and the whole blocking half of the quality gate hang off it.
//                 An honest placeholder is worth more than a plausible invention.
//   attributes    same argument, one level worse: an attribute declaration is a claim that
//                 evidence is required, and inventing one produces either false comfort or a
//                 gate the reader switches off on day two.
//   dependsOn     left unwritten even though the real import edges are right there and are
//                 reported below. The declared graph is a statement of intent; the import
//                 graph is a statement of fact. Copying the second into the first makes
//                 arch-check compare the code against itself, `undeclaredDependencies` is
//                 empty by construction from then on, and the anti-corrosion gate reads green
//                 forever while measuring nothing. The edges are reported for a human to
//                 accept, reject or split -- that acceptance is the whole value.
//   layer / forbiddenDependencies   both are boundaries somebody chose. There is nothing in a
//                 file tree that implies either.
//
// The one hard guarantee: whatever comes out passes catalog-lint. A draft that fails the
// first check its reader runs sends them into a red light on step one and teaches them the
// layer is broken. Coverage is therefore closed by construction (every tracked path is
// claimed) and then verified by actually running the linter over the draft before answering.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  SOURCE_EXTS, catalogFilePath, emit, isGitRepo, projectRoot, repoRelative,
} from '../lib/core.mjs';
import { classifyPath, lintCatalog, moduleForPath, trackedFiles } from './catalog.mjs';
import { extractImports, resolveRelativeImport } from './graph.mjs';
import { writeAtomic } from './evidence.mjs';

// ===========================================================================
// S25 init
// ===========================================================================
// Thresholds. All of them are review-budget numbers rather than truths about code: a draft
// nobody reads is worth exactly as much as no draft, and 300 modules is a draft nobody reads.
const MAX_MODULES = 50;
const MIN_MODULE_FILES = 2;
const CONTAINER_MIN_CHILD_DIRS = 3;
const CONTAINER_MIN_FILES = 24;
const REFERENCE_MAX_FILES = 20000;
const REFERENCE_MAX_BYTES = 1500000;
const MAX_REPORTED_ERRORS = 20;

// Directories whose name says "these are the parts" rather than "this is a part". Split one
// level so `packages/` does not become a single module holding the entire product.
const CONTAINER_NAMES = new Set([
  'apps', 'cmd', 'crates', 'libs', 'modules', 'packages', 'plugins', 'services', 'src',
]);

// Directories that hold no module: build output, dependency trees, editor and tool caches,
// documentation, and the fixture trees whose files exist to be read by tests rather than to
// be shipped. Hidden directories are NOT excluded as a class -- a cache is not tracked by
// git, so a hidden directory that reached this list was committed on purpose, and this
// framework's own tree lives entirely under .claude/.
const NON_SOURCE_DIRS = new Set([
  '.cache', '.git', '.github', '.gradle', '.idea', '.mypy_cache', '.next', '.nyc_output',
  '.pytest_cache', '.ruff_cache', '.tox', '.venv', '.vscode',
  'build', 'coverage', 'dist', 'doc', 'docs', 'documentation', 'fixtures', 'htmlcov',
  'node_modules', 'out', 'target', 'testdata', 'third_party', 'vendor', '__pycache__',
]);

// Loose files whose change plausibly reaches everything: manifests, lockfiles, compiler and
// build configuration. Anything else loose is documentation until a human says otherwise.
const GLOBAL_FILE_PATTERNS = [
  /^package(-lock)?\.json$/, /^yarn\.lock$/, /^pnpm-lock\.yaml$/, /^[jt]sconfig.*\.json$/,
  /^go\.(mod|sum)$/, /^Cargo\.(toml|lock)$/, /^pyproject\.toml$/, /^setup\.(py|cfg)$/,
  /^requirements.*\.txt$/, /^Gemfile(\.lock)?$/, /^composer\.(json|lock)$/, /^pom\.xml$/,
  /^(build|settings)\.gradle(\.kts)?$/, /^Makefile$/, /^CMakeLists\.txt$/, /^Dockerfile$/,
  /^\.gitignore$/, /^\.editorconfig$/,
];

// Wider than core's SOURCE_EXTS on purpose. That set answers "can imports be extracted from
// this", which is a smaller question than "did somebody write this by hand": a shell installer
// or a migration dropped into ignored is exactly as much of a hole in the coverage report, and
// counting only the extensions the import parser knows would under-report it.
const AUTHORED_EXTS = new Set([
  ...SOURCE_EXTS,
  '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd', '.sql', '.vue', '.svelte',
]);

const DRAFT_NOTE = 'drafted by harness.mjs init from the tracked file tree; riskTier is a '
  + 'placeholder, attributes / dependsOn / layer / forbiddenDependencies are decisions a '
  + 'human still owes this file';

/** Catalog id for a directory: separators and anything outside [A-Za-z0-9._-] become dashes. */
function moduleIdFor(dir) {
  const id = String(dir)
    .replace(/\//g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[.\-]+/, '')
    .replace(/[.\-]+$/, '');
  return id || 'module';
}

/** Extension of a path, lowercased, or '' when the basename carries none. */
function extensionOf(p) {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Where a loose file goes: `global` when its change plausibly reaches every module (manifests,
 * lockfiles, build configuration, and source sitting loose above every module), `ignored`
 * otherwise. Pure.
 * @param {string} p  project-relative path
 * @returns {'global'|'ignored'}
 */
function looseFileKind(p) {
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (GLOBAL_FILE_PATTERNS.some(r => r.test(base))) return 'global';
  return AUTHORED_EXTS.has(extensionOf(p)) ? 'global' : 'ignored';
}

/**
 * Group tracked paths by first segment. Returns loose repository-root files separately --
 * they have no directory to belong to and are decided one by one.
 * @param {string[]} paths
 * @returns {{dirs:Map<string,string[]>,loose:string[]}}
 */
function groupByTopDir(paths) {
  const dirs = new Map();
  const loose = [];
  for (const p of paths) {
    const slash = p.indexOf('/');
    if (slash <= 0) { loose.push(p); continue; }
    const head = p.slice(0, slash);
    const bucket = dirs.get(head);
    if (bucket) bucket.push(p);
    else dirs.set(head, [p]);
  }
  return { dirs, loose };
}

/**
 * Immediate subdirectory names under `dir`, given the paths it owns.
 * @param {string} dir
 * @param {string[]} paths
 */
function childDirsOf(dir, paths) {
  const kids = new Set();
  const prefix = dir + '/';
  for (const p of paths) {
    const rest = p.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash > 0) kids.add(rest.slice(0, slash));
  }
  return kids;
}

/**
 * Infer module / global / ignored membership for every tracked path. Pure: takes a path list,
 * returns a plan. `expand` false is the coarse retry -- top-level directories only, used when
 * the fine pass produced more modules than anybody will read.
 * @param {string[]} trackedPaths
 * @param {{expand?:boolean}} [opts]
 */
function planModules(trackedPaths, { expand = true } = {}) {
  const sorted = [...(trackedPaths || [])].sort();
  const { dirs, loose } = groupByTopDir(sorted);

  // Candidate directories, one level of expansion at most. Recursing further would break the
  // property the overlap check depends on: candidates are siblings, so no glob can contain
  // another, so no tracked path is ever claimed twice.
  const candidates = [];
  const looseFiles = [...loose];
  for (const dir of [...dirs.keys()].sort()) {
    const owned = dirs.get(dir);
    const name = dir;
    if (NON_SOURCE_DIRS.has(name)) { candidates.push({ dir, paths: owned }); continue; }
    const kids = childDirsOf(dir, owned);
    const isContainer = expand && (CONTAINER_NAMES.has(name)
      ? kids.size >= 2
      : (kids.size >= CONTAINER_MIN_CHILD_DIRS && owned.length > CONTAINER_MIN_FILES));
    if (!isContainer) { candidates.push({ dir, paths: owned }); continue; }
    const prefix = dir + '/';
    const byKid = new Map();
    for (const p of owned) {
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) { looseFiles.push(p); continue; }
      const kid = prefix + rest.slice(0, slash);
      const bucket = byKid.get(kid);
      if (bucket) bucket.push(p);
      else byKid.set(kid, [p]);
    }
    for (const kid of [...byKid.keys()].sort()) candidates.push({ dir: kid, paths: byKid.get(kid) });
  }

  const modules = [];
  const ignored = [];
  const globals = [];
  const usedIds = new Map();
  for (const c of candidates) {
    const name = c.dir.slice(c.dir.lastIndexOf('/') + 1);
    if (NON_SOURCE_DIRS.has(name)) {
      ignored.push({ glob: c.dir + '/**', reason: 'non-source-directory', files: c.paths.length });
      continue;
    }
    // A directory holding one file is not yet a module boundary; declaring it as one produces
    // a catalog of singletons that says nothing. It goes to ignored, and the count of source
    // files that landed there is reported so promoting the real ones is a visible task rather
    // than a silent loss.
    if (c.paths.length < MIN_MODULE_FILES) {
      ignored.push({ glob: c.dir + '/**', reason: 'single-file-directory', files: c.paths.length });
      continue;
    }
    let id = moduleIdFor(c.dir);
    if (usedIds.has(id)) {
      const n = usedIds.get(id) + 1;
      usedIds.set(id, n);
      id = id + '-' + n;
    } else usedIds.set(id, 1);
    modules.push({ id, dir: c.dir, glob: c.dir + '/**', files: c.paths.length });
  }

  for (const p of looseFiles.sort()) {
    if (looseFileKind(p) === 'global') globals.push(p);
    else ignored.push({ glob: p, reason: 'loose-document', files: 1 });
  }

  const sourceIgnored = countSourceUnder(sorted, ignored);
  return {
    modules,
    globals: globals.sort(),
    ignored: ignored.sort((a, b) => (a.glob < b.glob ? -1 : a.glob > b.glob ? 1 : 0)),
    sourceIgnored,
    granularity: expand ? 'fine' : 'coarse',
  };
}

/** How many hand-written files a plan's ignored entries swallow. Pure. */
function countSourceUnder(sortedPaths, ignored) {
  const globs = ignored.map(i => i.glob);
  if (!globs.length) return 0;
  const dirs = globs.filter(g => g.endsWith('/**')).map(g => g.slice(0, -2));
  const files = new Set(globs.filter(g => !g.endsWith('/**')));
  let n = 0;
  for (const p of sortedPaths) {
    if (!AUTHORED_EXTS.has(extensionOf(p))) continue;
    if (files.has(p) || dirs.some(d => p.startsWith(d))) n++;
  }
  return n;
}

/**
 * Render a plan as a catalog object. Key order is fixed so two runs over one tree produce
 * byte-identical output, and nothing derived from the clock or from an absolute path goes in.
 * @param {ReturnType<planModules>} plan
 */
function draftCatalog(plan) {
  return {
    version: 1,
    _generated: { by: 'harness.mjs init', reviewed: false, note: DRAFT_NOTE },
    modules: plan.modules.map(m => ({ id: m.id, paths: [m.glob], riskTier: 'low' })),
    global: [...plan.globals],
    ignored: plan.ignored.map(i => i.glob),
  };
}

/**
 * Add a literal ignored entry for every tracked path the draft failed to claim. The plan is
 * meant to be exhaustive; this is the belt that keeps a gap in it from shipping as an UNMAPPED
 * error in the reader's first lint run. The rescued count is reported, never hidden.
 * @returns {number} how many paths had to be rescued
 */
function closeCoverage(draft, trackedPaths) {
  const rescued = [];
  for (const p of trackedPaths) {
    if (classifyPath(p, draft).kind === 'unmapped') rescued.push(p);
  }
  if (rescued.length) draft.ignored = [...new Set([...draft.ignored, ...rescued])].sort();
  return rescued.length;
}

/**
 * Real import edges between the drafted modules, for a human to read before writing any
 * dependsOn by hand. Only relative specifiers are resolved: a bare specifier needs a
 * `provides` prefix, which a draft has no basis to invent.
 * @returns {{edges:Array,scanned:number,unresolved:number,truncated:boolean}}
 */
function referenceEdges(root, catalog, trackedPaths, maxFiles = REFERENCE_MAX_FILES) {
  const edges = new Map();
  let scanned = 0;
  let unresolved = 0;
  let truncated = false;
  for (const rel of trackedPaths) {
    if (scanned >= maxFiles) { truncated = true; break; }
    if (!SOURCE_EXTS.has(extensionOf(rel))) continue;
    const owner = moduleForPath(rel, catalog);
    if (!owner) continue;
    let content;
    try {
      const st = fs.statSync(path.join(root, rel));
      if (!st.isFile() || st.size > REFERENCE_MAX_BYTES) continue;
      content = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (_e) { continue; }
    scanned++;
    for (const spec of extractImports(rel, content)) {
      if (!spec.startsWith('.')) { unresolved++; continue; }
      const resolved = resolveRelativeImport(root, rel, spec);
      if (!resolved) { unresolved++; continue; }
      const target = moduleForPath(resolved, catalog);
      if (!target || target === owner) continue;
      const key = owner + '->' + target;
      const entry = edges.get(key) || { from: owner, to: target, evidence: [] };
      if (entry.evidence.length < 3) entry.evidence.push(rel + ': ' + spec);
      edges.set(key, entry);
    }
  }
  const list = [...edges.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(e => e[1]);
  return { edges: list, scanned, unresolved, truncated };
}

function positiveInt(v, fallback) {
  const n = parseInt(v, 10);
  return (!Number.isNaN(n) && n > 0) ? n : fallback;
}

function cmdInit(flags = {}) {
  if (!isGitRepo()) {
    const detail = 'init reads the tracked file list through git ls-files';
    process.stderr.write('init: not a git repository; ' + detail + '\n');
    return emit({ ok: false, degraded: true, error: 'non-git', detail }, 3);
  }
  const t = trackedFiles();
  if (!t.paths.length) {
    const detail = 'git ls-files returned nothing; there is no tree to infer a catalog from';
    process.stderr.write('init: ' + detail + '\n');
    return emit({ ok: false, degraded: true, error: 'no-tracked-paths', detail }, 3);
  }
  if (t.truncated) {
    // A draft over a truncated listing claims coverage it does not have: everything past the
    // cap would land as UNMAPPED the first time the reader lints it. Same reading as
    // everywhere else in this engine -- a truncated listing is a broken measurement.
    const detail = 'tracked listing hit the maxTrackedPaths cap; a draft over part of the tree '
      + 'would leave the rest unmapped';
    process.stderr.write('init: ' + detail + '\n');
    return emit({ ok: false, degraded: true, error: 'tracked-truncated', detail, trackedPaths: t.paths.length }, 3);
  }

  const maxModules = positiveInt(flags['max-modules'], MAX_MODULES);
  let plan = planModules(t.paths, { expand: true });
  if (plan.modules.length > maxModules) plan = planModules(t.paths, { expand: false });
  const overBudget = plan.modules.length > maxModules;

  const draft = draftCatalog(plan);
  const rescued = closeCoverage(draft, t.paths);
  const lint = lintCatalog(draft, t.paths);
  const refs = referenceEdges(projectRoot(), draft, t.paths);

  const target = typeof flags.catalog === 'string' ? flags.catalog : catalogFilePath();
  const rel = repoRelative(target);
  const exists = fs.existsSync(target);
  const wantApply = Boolean(flags.apply);

  const report = {
    ok: lint.ok,
    applied: false,
    path: rel,
    catalogPresent: exists,
    trackedPaths: t.paths.length,
    granularity: plan.granularity,
    maxModules,
    overBudget,
    modules: plan.modules.length,
    globalPaths: draft.global.length,
    ignoredPaths: draft.ignored.length,
    sourceIgnored: plan.sourceIgnored,
    rescued,
    referenceEdges: refs.edges,
    referenceScan: { scanned: refs.scanned, unresolved: refs.unresolved, truncated: refs.truncated },
    lint: {
      ok: lint.ok,
      errors: lint.errors.slice(0, MAX_REPORTED_ERRORS),
      errorsOmitted: Math.max(0, lint.errors.length - MAX_REPORTED_ERRORS),
      warnings: lint.warnings,
      stats: lint.stats,
    },
    draft,
    note: '',
  };

  writeInitSummary(report, plan);

  // A draft that does not survive the reader's first lint is worse than no draft: it teaches
  // them the layer is broken before they have seen it work. Self-check by running the real
  // linter, not by trusting the construction above.
  if (!lint.ok) {
    process.stderr.write('init: the inferred draft does not pass catalog-lint, so it is not offered; '
      + lint.errors.length + ' error(s), first: ' + (lint.errors[0] ? lint.errors[0].code + ' ' + lint.errors[0].detail : '') + '\n');
    report.ok = false;
    report.error = 'draft-not-lint-clean';
    report.note = 'the inference left ' + lint.errors.length + ' catalog-lint error(s); nothing was written';
    return emit(report, 1);
  }

  if (wantApply && exists) {
    // No --force. Overwriting a catalog somebody wrote by hand destroys module boundaries,
    // attribute tiers and forbidden edges that no draft can reconstruct, and a flag that does
    // it is a flag somebody will pass while meaning "yes, show me the draft".
    process.stderr.write('init: ' + rel + ' already exists and is not overwritten; '
      + 'read the draft above, and delete the file yourself if you really mean to replace it\n');
    report.error = 'catalog-exists';
    report.note = rel + ' already exists; the draft was printed but nothing was written';
    return emit(report, 1);
  }

  if (wantApply) {
    try {
      writeAtomic(path.resolve(projectRoot(), target), JSON.stringify(draft, null, 2) + '\n');
    } catch (e) {
      const detail = String((e && e.message) || e);
      process.stderr.write('init: could not write ' + rel + ': ' + detail + '\n');
      report.ok = false;
      report.error = 'write-failed';
      report.note = detail;
      return emit(report, 1);
    }
    report.applied = true;
    report.note = 'wrote ' + rel + '; the large-repo layer is now on -- review riskTier, '
      + 'attributes and dependsOn before trusting any gate that reads them';
    process.stderr.write('init: wrote ' + rel + '\n');
    return emit(report, 0);
  }

  report.note = 'dry run; rerun with --apply to write ' + rel;
  return emit(report, 0);
}

/** The human half of the answer: what was guessed, and the two things that were not. */
function writeInitSummary(report, plan) {
  process.stderr.write('init: ' + report.modules + ' module(s), ' + report.globalPaths
    + ' global path(s), ' + report.ignoredPaths + ' ignored path(s), from '
    + report.trackedPaths + ' tracked path(s) [' + report.granularity + ']\n');
  for (const m of plan.modules) {
    process.stderr.write('  module ' + m.id + '  ' + m.glob + '  ' + m.files + ' file(s)\n');
  }
  process.stderr.write('init: riskTier is low on every module and attributes are absent on purpose -- '
    + 'both are judgements, and a guessed high reads downstream as safety somebody established\n');
  process.stderr.write('init: dependsOn is left unwritten; ' + report.referenceEdges.length
    + ' real import edge(s) are reported for reference only -- writing them in would make '
    + 'arch-check compare the code against its own reflection\n');
  for (const e of report.referenceEdges) {
    process.stderr.write('  edge ' + e.from + ' -> ' + e.to + '  ' + (e.evidence[0] || '') + '\n');
  }
  if (plan.sourceIgnored) {
    process.stderr.write('init: ' + plan.sourceIgnored + ' source file(s) landed in ignored '
      + '(single-file or non-source directories); promote the ones that are really modules\n');
  }
  if (report.rescued) {
    process.stderr.write('init: ' + report.rescued + ' path(s) the inference did not place were '
      + 'added to ignored literally; each one is a directory worth looking at\n');
  }
  if (report.overBudget) {
    process.stderr.write('init: ' + report.modules + ' modules is past --max-modules '
      + report.maxModules + ' even at the coarsest granularity; the draft is complete but nobody '
      + 'will read it as it stands\n');
  }
}

export {
  CONTAINER_NAMES, GLOBAL_FILE_PATTERNS, MAX_MODULES, NON_SOURCE_DIRS,
  closeCoverage, countSourceUnder, draftCatalog, extensionOf, looseFileKind, moduleIdFor,
  planModules, referenceEdges, cmdInit,
};
