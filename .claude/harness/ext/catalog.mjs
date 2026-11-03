// ext/catalog.mjs -- S4: reading, validating and classifying against module-catalog.json.
// Depends on core.mjs only. moduleForPath() is filed here rather than in S12 arch-check
// where it was written: it is a one-line reading of classifyPath, and both arch-check and
// fitness need it, so the catalog layer is the only home that keeps the graph acyclic.

import fs from 'node:fs';
import {
  ATTRIBUTES, DEFAULTS, TIERS,
  catalogFilePath, emit, git, globToRegExp, isGitRepo, matchAny, normalizeTier, parseCsv,
  repoRelative, specificity, splitNul,
} from '../lib/core.mjs';

// ===========================================================================
// S4 catalog
// ===========================================================================
// Path globs that swallow the whole tree; forbidden as a module's paths entry
// (a root catch-all hides unmapped files from the UNMAPPED gate).
const CATCH_ALL_GLOBS = ['', '.', '*', '**', '**/*'];

/**
 * Read + parse the catalog file. Never throws: on missing/unreadable/invalid JSON
 * it returns {ok:false,error,detail} so callers can degrade instead of crashing.
 * catalog-missing names the file repo-relative: every degraded command echoes this detail
 * onto stdout, and the one thing a reader needs from it is which file to create, not which
 * machine the answer came from. A --catalog pointing outside the repo has no repo-relative
 * name and comes back as given (repoRelative), not as a climb-out chain.
 * @param {string} [catalogPath]  defaults to catalogFilePath()
 * @returns {{ok:true,catalog:Catalog}|{ok:false,error:string,detail:string}}
 */
function loadCatalog(catalogPath) {
  const cp = catalogPath || catalogFilePath();
  if (!fs.existsSync(cp)) {
    return { ok: false, error: 'catalog-missing', detail: repoRelative(cp) };
  }
  let raw;
  try {
    raw = fs.readFileSync(cp, 'utf8');
  } catch (e) {
    return { ok: false, error: 'catalog-unreadable', detail: String(e && e.message || e) };
  }
  try {
    return { ok: true, catalog: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: 'catalog-parse-error', detail: String(e && e.message || e) };
  }
}

/** Resolve the --catalog flag into a loadCatalog call: a string path, else the default. */
function loadCatalogFlag(flags) {
  return loadCatalog(typeof flags.catalog === 'string' ? flags.catalog : undefined);
}

/**
 * Shallow structural validation: version present, modules is an array, each module
 * has a non-empty id and a paths array. Does not run the linter's cross-checks.
 * @param {Catalog} catalog
 * @returns {{ok:boolean,errors:string[]}}
 */
function validateSchema(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object') {
    return { ok: false, errors: ['catalog is not an object'] };
  }
  if (catalog.version === undefined) errors.push('missing version');
  if (!Array.isArray(catalog.modules)) {
    errors.push('modules is not an array');
    return { ok: errors.length === 0, errors };
  }
  catalog.modules.forEach((m, i) => {
    if (!m || typeof m !== 'object') { errors.push('module[' + i + '] is not an object'); return; }
    if (!m.id || typeof m.id !== 'string') errors.push('module[' + i + '] missing id');
    if (!Array.isArray(m.paths)) errors.push('module[' + (m.id || i) + '] missing paths array');
  });
  return { ok: errors.length === 0, errors };
}

/**
 * Classify a path against the catalog. Priority module > ignored > global > unmapped
 * (ignored beats global/unmapped so broad ignores never mask a module file; but a module
 * match still wins over ignored). On multiple module matches the most specific glob wins.
 * @param {string} p
 * @param {Catalog} catalog
 * @returns {{kind:('module'|'global'|'ignored'|'unmapped'),moduleId?:string}}
 */
function classifyPath(p, catalog) {
  let best = null;
  let bestScore = -1;
  for (const m of (catalog.modules || [])) {
    for (const g of (m.paths || [])) {
      if (globToRegExp(g).test(p)) {
        const s = specificity(g);
        if (s > bestScore) { bestScore = s; best = m.id; }
      }
    }
  }
  if (best !== null) return { kind: 'module', moduleId: best };
  if (matchAny(p, catalog.ignored)) return { kind: 'ignored' };
  if (matchAny(p, catalog.global)) return { kind: 'global' };
  return { kind: 'unmapped' };
}

/** Owning module id for a path, or null (classifyPath module priority applies). */
function moduleForPath(p, catalog) {
  const cls = classifyPath(p, catalog);
  return cls.kind === 'module' ? cls.moduleId : null;
}

/**
 * Detect a dependsOn cycle among modules. Returns true if any cycle exists.
 * @param {Catalog} catalog
 */
function hasDependencyCycle(catalog) {
  const graph = new Map();
  for (const m of (catalog.modules || [])) graph.set(m.id, m.dependsOn || []);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const id of graph.keys()) color.set(id, WHITE);
  const visit = (id) => {
    color.set(id, GRAY);
    for (const dep of (graph.get(id) || [])) {
      if (!graph.has(dep)) continue;              // dangling dep is a separate error
      const c = color.get(dep);
      if (c === GRAY) return true;
      if (c === WHITE && visit(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const id of graph.keys()) {
    if (color.get(id) === WHITE && visit(id)) return true;
  }
  return false;
}

/**
 * Lint a catalog against a full tracked-path list. Enforces: valid schema, no catch-all
 * module paths, every tracked path claimed (UNMAPPED), no path claimed by >1 module
 * (OVERLAP), no dangling dependsOn. Cycles are warnings, not errors.
 * @param {Catalog} catalog
 * @param {string[]} trackedPaths
 * @returns {{ok,errors,warnings,stats}}
 */
function lintCatalog(catalog, trackedPaths) {
  const errors = [];
  const warnings = [];

  const schema = validateSchema(catalog);
  for (const detail of schema.errors) errors.push({ code: 'SCHEMA', path: null, detail });

  const modules = Array.isArray(catalog.modules) ? catalog.modules : [];

  // CATCH_ALL: a module path that swallows the whole tree.
  for (const m of modules) {
    for (const g of (m.paths || [])) {
      if (CATCH_ALL_GLOBS.includes(g)) {
        errors.push({ code: 'CATCH_ALL', path: g, detail: 'module ' + m.id + ' has catch-all path "' + g + '"' });
      }
    }
  }

  // DANGLING_DEP: dependsOn references a module id that does not exist.
  const ids = new Set(modules.map(m => m.id));
  for (const m of modules) {
    for (const dep of (m.dependsOn || [])) {
      if (!ids.has(dep)) {
        errors.push({ code: 'DANGLING_DEP', path: null, detail: 'module ' + m.id + ' dependsOn missing id "' + dep + '"' });
      }
    }
  }

  // S11 attributes + S12 boundary declarations. Opting out (none|minimal) must carry a
  // written reason: silence is the state every attribute drifts toward when it costs nothing.
  const layerNames = Array.isArray(catalog.layers) ? catalog.layers : [];
  for (const m of modules) {
    for (const [attr, req] of Object.entries(m.attributes || {})) {
      if (!ATTRIBUTES.includes(attr)) {
        errors.push({ code: 'UNKNOWN_ATTRIBUTE', path: null, detail: 'module ' + m.id + ' declares unknown attribute "' + attr + '"' });
        continue;
      }
      const { tier, reason } = normalizeTier(req);
      if (!TIERS.includes(tier)) {
        errors.push({ code: 'UNKNOWN_TIER', path: null, detail: 'module ' + m.id + ' sets ' + attr + ' to unknown tier "' + tier + '"' });
        continue;
      }
      if ((tier === 'none' || tier === 'minimal') && !reason.trim()) {
        errors.push({ code: 'UNJUSTIFIED_TIER', path: null, detail: 'module ' + m.id + ' sets ' + attr + ' to "' + tier + '" without a reason ({"tier":"' + tier + '","reason":"..."})' });
      }
    }
    for (const f of (m.forbiddenDependencies || [])) {
      if (f === m.id) {
        errors.push({ code: 'SELF_FORBIDDEN', path: null, detail: 'module ' + m.id + ' forbids depending on itself' });
      } else if (!ids.has(f)) {
        errors.push({ code: 'DANGLING_DEP', path: null, detail: 'module ' + m.id + ' forbiddenDependencies missing id "' + f + '"' });
      }
      // Declaring and forbidding the same edge is a contradiction; the prohibition wins,
      // but the catalog must not carry both statements.
      if ((m.dependsOn || []).includes(f)) {
        errors.push({ code: 'FORBIDDEN_DECLARED', path: null, detail: 'module ' + m.id + ' both declares and forbids dependency "' + f + '"' });
      }
    }
    if (m.layer && !layerNames.includes(m.layer)) {
      errors.push({ code: 'UNKNOWN_LAYER', path: null, detail: 'module ' + m.id + ' is in layer "' + m.layer + '" which catalog.layers does not declare' });
    }
  }

  // OVERLAP + UNMAPPED: per tracked path, count matching modules and require a claim.
  let unmapped = 0;
  let overlaps = 0;
  for (const p of (trackedPaths || [])) {
    const hits = [];
    for (const m of modules) {
      if (matchAny(p, m.paths)) hits.push(m.id);
    }
    if (hits.length > 1) {
      overlaps++;
      errors.push({ code: 'OVERLAP', path: p, detail: 'path claimed by modules: ' + hits.join(', ') });
    }
    if (hits.length === 0) {
      const cls = classifyPath(p, catalog);   // module already excluded (hits==0), so global|ignored|unmapped
      if (cls.kind === 'unmapped') {
        unmapped++;
        errors.push({ code: 'UNMAPPED', path: p, detail: 'tracked path not claimed by any module/global/ignored' });
      }
    }
  }

  if (hasDependencyCycle(catalog)) {
    warnings.push({ code: 'CYCLE', path: null, detail: 'dependsOn graph contains a cycle' });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      modules: modules.length,
      trackedPaths: (trackedPaths || []).length,
      unmapped,
      overlaps,
    },
  };
}

/**
 * git ls-files -> tracked path list, NUL-separated, capped at maxTrackedPaths.
 * A truncated listing is a broken measurement, not a smaller one: callers must surface
 * `truncated` (catalog-lint warns; impact treats it as a degraded full-fanout signal).
 * @param {number} [cap]  catalog.maxTrackedPaths or the 100k default
 * @returns {{paths:string[],truncated:boolean}}
 */
function trackedFiles(cap) {
  if (!isGitRepo()) return { paths: [], truncated: false };
  const r = git(['-c', 'core.quotePath=false', 'ls-files', '-z']);
  if (r.status !== 0) return { paths: [], truncated: false };
  const all = splitNul(r.stdout);
  const limit = (typeof cap === 'number' && cap > 0) ? cap : DEFAULTS.maxTrackedPaths;
  return { paths: all.slice(0, limit), truncated: all.length > limit };
}

function cmdCatalogLint(flags) {
  const loaded = loadCatalogFlag(flags);
  if (!loaded.ok) {
    return emit({ ok: false, degraded: true, error: loaded.error, detail: loaded.detail }, 3);
  }
  let tracked;
  let truncated = false;
  if (typeof flags.tracked === 'string') {
    tracked = parseCsv(flags.tracked);
  } else {
    const t = trackedFiles(loaded.catalog.maxTrackedPaths);
    tracked = t.paths;
    truncated = t.truncated;
  }
  const result = lintCatalog(loaded.catalog, tracked);
  if (truncated) {
    result.warnings.push({ code: 'TRUNCATED', path: null, detail: 'tracked listing hit maxTrackedPaths; coverage is incomplete' });
  }
  return emit(result, result.ok ? 0 : 1);
}

export {
  CATCH_ALL_GLOBS,
  loadCatalog, loadCatalogFlag, validateSchema, classifyPath, moduleForPath, hasDependencyCycle, lintCatalog,
  trackedFiles, cmdCatalogLint,
};
