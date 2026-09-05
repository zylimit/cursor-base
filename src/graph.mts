// Dependency graph: impact closure over declared dependencies, real import-edge extraction,
// and the architecture check (forbidden edges, layer direction, drift).

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { catalog, classifyPath, detectCycles, moduleForPath, trackedPaths } from "./catalog.mjs";
import type { ClassifiedPath, ModuleCatalog, ModuleDefinition, QualityAttribute } from "./catalog.mjs";
import {
  EXIT,
  LIVE_CONTRACTS,
  boolOption,
  changedPaths,
  draftPath,
  gitAvailable,
  gitBase,
  isWithin,
  matchesPath,
  normalizeLf,
  posix,
  printJson,
  readJson,
  targetFrom,
  templatePath,
  walkFiles,
  writeJson,
} from "./core.mjs";
import type { CliOptions } from "./core.mjs";

export interface ImpactResult {
  paths: string[];
  classifications: ClassifiedPath[];
  unmatched: string[];
  direct: string[];
  affected: ModuleDefinition[];
  expanded_to_all: boolean;
  expansion_reasons: string[];
}

// Widening costs verification time; missing a dependent costs a silent regression. Every
// condition that makes the mapping untrustworthy therefore fans out to the whole graph.
export function affectedModules(root: string, paths: string[], discovered = true): ImpactResult {
  const definition = catalog(root);
  const unique = [...new Set(paths.map(posix))].sort();
  const classifications = unique.map((path) => classifyPath(definition, path));
  const direct = new Set<string>();
  for (const entry of classifications) {
    if (entry.module && (entry.classification === "mapped" || entry.classification === "overlap")) {
      direct.add(entry.module);
    }
  }

  const reasons: string[] = [];
  if (classifications.some((entry) => entry.classification === "global")) {
    reasons.push("a repository-wide path changed");
  }
  if (classifications.some((entry) => entry.classification === "unmapped")) {
    reasons.push("a changed path is not covered by the module catalog");
  }
  if (classifications.some((entry) => entry.classification === "overlap")) {
    reasons.push("a changed path is claimed by more than one module");
  }
  if (definition.modules.some((module) => module.shared && direct.has(module.id))) {
    reasons.push("a shared module changed");
  }
  // Only relevant when Git was the source of the path list. If the caller named the paths,
  // Git's availability says nothing about whether that list is complete.
  if (discovered && unique.length > 0 && !gitAvailable(root)) {
    reasons.push("Git is unavailable, so change discovery cannot be trusted");
  }

  const affected = new Set(direct);
  if (reasons.length > 0) {
    for (const module of definition.modules) affected.add(module.id);
  } else {
    let changed = true;
    while (changed) {
      changed = false;
      for (const module of definition.modules) {
        if (
          !affected.has(module.id) &&
          (module.dependsOn || []).some((dependency: string) => affected.has(dependency))
        ) {
          affected.add(module.id);
          changed = true;
        }
      }
    }
  }
  return {
    paths: unique,
    classifications,
    unmatched: classifications
      .filter((entry) => entry.classification === "unmapped")
      .map((entry) => entry.path),
    direct: [...direct].sort(),
    affected: definition.modules.filter((module: ModuleDefinition) => affected.has(module.id)),
    expanded_to_all: reasons.length > 0,
    expansion_reasons: reasons,
  };
}

export interface RequestedPaths {
  paths: string[];
  /** True when the caller named the paths, so Git played no part in discovering them. */
  explicit: boolean;
}

export function requestedPaths(root: string, positional: string[], options: CliOptions): RequestedPaths {
  const named = [
    ...positional,
    ...String(options.paths || "")
      .split(",")
      .filter(Boolean),
  ];
  if (named.length > 0) return { paths: named.map(posix), explicit: true };
  return { paths: changedPaths(root, gitBase(root, options.base)), explicit: false };
}

export function repoMap(options: CliOptions): void {
  const root = targetFrom(options);
  const definition = catalog(root);
  printJson({
    version: definition.version,
    modules: definition.modules.map((module: ModuleDefinition) => ({
      id: module.id,
      paths: module.paths,
      dependsOn: module.dependsOn || [],
      verification: module.verification || [],
      owners: module.owners || [],
    })),
  });
}

export function affected(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const request = requestedPaths(root, positional, options);
  const result = affectedModules(root, request.paths, !request.explicit);
  printJson({
    target: root,
    paths: result.paths,
    classifications: result.classifications,
    direct: result.direct,
    affected: result.affected.map((module: ModuleDefinition) => module.id),
    expanded_to_all: result.expanded_to_all,
    expansion_reasons: result.expansion_reasons,
  });
}

export const SOURCE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx",
  ".py", ".go", ".java", ".kt", ".kts", ".cs", ".rs", ".rb", ".php", ".swift", ".scala",
]);

export const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export const IMPORT_PATTERNS: Array<{ extensions: RegExp; patterns: RegExp[] }> = [
  {
    extensions: /\.(m|c)?(j|t)sx?$/,
    patterns: [
      /\bimport\s+(?:[\w*{}\n\r\t, ]+\s+from\s+)?["']([^"']+)["']/g,
      /\bexport\s+(?:[\w*{}\n\r\t, ]+\s+)?from\s+["']([^"']+)["']/g,
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    ],
  },
  {
    extensions: /\.py$/,
    patterns: [
      /^[ \t]*from[ \t]+([.\w]+)[ \t]+import\b/gm,
      /^[ \t]*import[ \t]+([.\w]+)/gm,
    ],
  },
  { extensions: /\.go$/, patterns: [/^[ \t]*(?:[\w.]+[ \t]+)?"([^"]+)"/gm] },
  { extensions: /\.(java|kt|kts|scala)$/, patterns: [/^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+)/gm] },
  { extensions: /\.cs$/, patterns: [/^[ \t]*using[ \t]+(?:static[ \t]+)?([\w.]+)[ \t]*;/gm] },
  { extensions: /\.rs$/, patterns: [/^[ \t]*use[ \t]+([\w:]+)/gm] },
  { extensions: /\.rb$/, patterns: [/\brequire(?:_relative)?\s+["']([^"']+)["']/g] },
  { extensions: /\.php$/, patterns: [/^[ \t]*use[ \t]+([\w\\]+)/gm] },
  { extensions: /\.swift$/, patterns: [/^[ \t]*import[ \t]+([\w.]+)/gm] },
];

export function extractImports(file: string, contents: string): string[] {
  const found = new Set<string>();
  for (const group of IMPORT_PATTERNS) {
    if (!group.extensions.test(file)) continue;
    for (const pattern of group.patterns) {
      pattern.lastIndex = 0;
      let match = pattern.exec(contents);
      while (match) {
        if (match[1]) found.add(match[1]);
        match = pattern.exec(contents);
      }
    }
  }
  return [...found];
}

export function resolveRelativeImport(root: string, fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(resolve(root, fromFile)), specifier);
  const candidates = [base, ...JS_EXTENSIONS.map((extension) => `${base}${extension}`)];
  // TypeScript under NodeNext writes the emitted extension in the specifier, so `./x.js`
  // is how a file named `x.ts` is imported. Without this the whole graph reads as unresolved.
  const rewritten = base.replace(/\.(js|mjs|cjs|jsx)$/, "");
  if (rewritten !== base) {
    for (const extension of JS_EXTENSIONS) candidates.push(`${rewritten}${extension}`);
  }
  for (const extension of JS_EXTENSIONS) candidates.push(resolve(base, `index${extension}`));
  candidates.push(`${base}.py`, resolve(base, "__init__.py"));
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile() && isWithin(root, candidate)) {
      return posix(relative(root, candidate));
    }
  }
  return null;
}

export function moduleForSpecifier(definition: ModuleCatalog, specifier: string): ModuleDefinition | null {
  let best: ModuleDefinition | null = null;
  let bestLength = -1;
  for (const module of definition.modules) {
    for (const provided of module.provides || []) {
      if (specifier !== provided && !specifier.startsWith(`${provided}/`) && !specifier.startsWith(`${provided}.`)) {
        continue;
      }
      if (provided.length > bestLength) {
        best = module;
        bestLength = provided.length;
      }
    }
  }
  return best;
}

export interface ArchViolation {
  from: string;
  to: string;
  evidence: string[];
  rule?: string;
}

// A layer may depend on itself or on anything further inward. Reaching outward inverts the
// architecture, which is the failure that boundary documents never catch on their own.
export function layerViolation(
  definition: ModuleCatalog,
  from: ModuleDefinition,
  to: ModuleDefinition,
): string | null {
  const order = definition.layers || [];
  if (order.length === 0 || !from.layer || !to.layer) return null;
  const fromIndex = order.indexOf(from.layer);
  const toIndex = order.indexOf(to.layer);
  if (fromIndex === -1 || toIndex === -1 || toIndex >= fromIndex) return null;
  return `layer ${from.layer} may not depend on the outer layer ${to.layer}`;
}

// The module graph is only a guardrail if the declaration is checked against what the code
// actually imports. A stale `dependsOn` under-reports impact, which loses tests silently.
export function archCheck(options: CliOptions): void {
  const root = targetFrom(options);
  const definition = catalog(root);
  const maxFiles = Number(options["max-files"]) > 0 ? Number(options["max-files"]) : 20_000;
  const declared = new Map<string, Set<string>>(
    definition.modules.map((module) => [module.id, new Set(module.dependsOn || [])]),
  );
  const actual = new Map<string, Set<string>>(definition.modules.map((module) => [module.id, new Set<string>()]));
  const violations = new Map<string, ArchViolation>();
  const forbidden = new Map<string, ArchViolation>();

  let scanned = 0;
  let unresolved = 0;
  let truncated = false;
  for (const absolute of walkFiles(root)) {
    if (scanned >= maxFiles) {
      truncated = true;
      break;
    }
    const rel = posix(relative(root, absolute));
    const extension = rel.slice(rel.lastIndexOf("."));
    if (!SOURCE_EXTENSIONS.has(extension)) continue;
    const owner = moduleForPath(definition, rel);
    if (!owner) continue;
    scanned += 1;
    let contents: string;
    try {
      contents = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    for (const specifier of extractImports(rel, contents)) {
      let target: ModuleDefinition | null = null;
      if (specifier.startsWith(".")) {
        const resolved = resolveRelativeImport(root, rel, specifier);
        target = resolved ? moduleForPath(definition, resolved) : null;
        if (!resolved) unresolved += 1;
      } else {
        target = moduleForSpecifier(definition, specifier);
        if (!target) unresolved += 1;
      }
      if (!target || target.id === owner.id) continue;
      actual.get(owner.id)?.add(target.id);
      const key = `${owner.id}->${target.id}`;
      const site = `${rel}: ${specifier}`;

      // A forbidden edge outranks a declared one: declaring a dependency the catalog also
      // forbids is a contradiction, and the prohibition is the stronger statement.
      const forbiddenRule = (owner.forbiddenDependencies || []).includes(target.id)
        ? `${owner.id} forbids depending on ${target.id}`
        : layerViolation(definition, owner, target);
      if (forbiddenRule) {
        const existing = forbidden.get(key) ?? {
          from: owner.id,
          to: target.id,
          evidence: [],
          rule: forbiddenRule,
        };
        if (existing.evidence.length < 5) existing.evidence.push(site);
        forbidden.set(key, existing);
        continue;
      }
      if (declared.get(owner.id)?.has(target.id)) continue;
      const existing = violations.get(key) ?? { from: owner.id, to: target.id, evidence: [] };
      if (existing.evidence.length < 5) existing.evidence.push(site);
      violations.set(key, existing);
    }
  }

  const unusedDeclarations: Array<{ from: string; to: string }> = [];
  for (const [id, targets] of declared) {
    for (const target of targets) {
      if (!actual.get(id)?.has(target)) unusedDeclarations.push({ from: id, to: target });
    }
  }
  const cycles = detectCycles(actual);
  const resolvedEdges = [...actual.values()].reduce((total, targets) => total + targets.size, 0);
  const ok = violations.size === 0 && forbidden.size === 0 && cycles.length === 0;

  // Passing with no resolved edges means nothing was actually checked. That is a legitimate
  // result for a single-module repository and a silent blind spot for any other, so it is
  // reported rather than left to look like a clean bill of health.
  const notes: string[] = [];
  if (scanned > 0 && resolvedEdges === 0) {
    notes.push(
      `No cross-module import edge was resolved across ${scanned} scanned files, so the declared graph was not exercised. ` +
        (unresolved > 0
          ? `${unresolved} import specifiers could not be attributed to a module; add \`provides\` prefixes for languages that import by package name rather than by relative path.`
          : "This is expected only when every module is genuinely self-contained."),
    );
  } else if (unresolved > resolvedEdges * 10 && unresolved > 100) {
    notes.push(
      `${unresolved} import specifiers were unattributed against ${resolvedEdges} resolved edges, so coverage of the declared graph is partial.`,
    );
  }
  if (truncated) notes.push(`Scanning stopped at ${maxFiles} files; coverage is incomplete.`);

  printJson({
    command: "arch-check",
    target: root,
    ok,
    scanned_files: scanned,
    truncated,
    unresolved_imports: unresolved,
    resolved_edges: resolvedEdges,
    notes,
    edges: [...actual].map(([id, targets]) => ({ module: id, dependsOn: [...targets].sort() })),
    // Kept separate from undeclared edges: one means the map is out of date, the other means a
    // boundary the repository deliberately drew has been crossed.
    forbidden_dependencies: [...forbidden.values()].sort((left, right) =>
      `${left.from}->${left.to}`.localeCompare(`${right.from}->${right.to}`),
    ),
    undeclared_dependencies: [...violations.values()].sort((left, right) =>
      `${left.from}->${left.to}`.localeCompare(`${right.from}->${right.to}`),
    ),
    // A declaration with no matching import over-reports impact: safe for testing, but it hides
    // that the boundary is no longer real, so it is reported without failing the check.
    unused_declarations: unusedDeclarations.sort((left, right) =>
      `${left.from}->${left.to}`.localeCompare(`${right.from}->${right.to}`),
    ),
    cycles,
  });
  if (!ok) process.exitCode = 1;
}

// ============================== Catalog discovery ==============================
// Asking a human to hand-write a module map is asking them to transcribe facts the repository
// already contains. Directory structure, real import edges, and build manifests are readable, so
// the engine proposes a complete draft and the human corrects a proposal instead of authoring a
// blank one. What it refuses to guess is the more important half: an attribute tier or a
// forbidden edge is a statement about what a failure costs, which no file tree implies. Those
// are listed under `needs_decision`, and the draft is only written when asked.

const SOURCE_ROOTS = ["src", "lib", "app", "apps", "packages", "services", "internal", "cmd", "pkg", "modules", "components"];

const NON_SOURCE = new Set(["node_modules", "dist", "build", "out", "target", "vendor", "coverage", ".git", ".cursor", ".github", ".venv", "venv", "__pycache__"]);

const GLOBAL_CANDIDATES = [
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "tsconfig.json", "go.mod", "go.sum",
  "Cargo.toml", "Cargo.lock", "pyproject.toml", "poetry.lock", "requirements.txt", "pom.xml", "build.gradle",
  "build.gradle.kts", "Makefile", "Dockerfile", "docker-compose.yml", ".gitignore", ".gitattributes", ".editorconfig",
];

const IGNORE_CANDIDATES: Array<{ paths: string[]; reason: string; always?: boolean }> = [
  { paths: [".cursor/rules/**", ".cursor/skills/**", ".cursor/agents/**"], reason: "Governance assets change no product behavior; the harness lints them directly.", always: true },
  { paths: [".cursor/runtime/**", ".cursor/harness-state/**", ".cursor/hooks.json", ".cursor/cli.json", ".cursor/sandbox.json", ".cursor/worktrees.json", ".cursorignore", ".cursorindexingignore"], reason: "Harness runtime, state, and host configuration, distributed with the harness.", always: true },
  { paths: [".github/**", ".gitlab-ci.yml", ".circleci/**"], reason: "CI configuration is verified by the CI run itself." },
  { paths: ["scripts/harness.mjs", "harness/**", "AGENTS.md", "FRAMEWORK-MANIFEST.json"], reason: "Harness entrypoint, contracts, and constitution; governed by validate and the manifest check.", always: true },
  { paths: ["progress.md", "progress.archive.md"], reason: "Project memory changes every session and would fan out every gate.", always: true },
  { paths: ["README.md", "CHANGELOG.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md"], reason: "Human-facing prose with no executable behavior." },
  { paths: ["docs/**"], reason: "Prose; governed by adr-check rather than by impact." },
];

const CODE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".mts", ".cts", ".py", ".go", ".rs", ".java", ".kt", ".cs", ".rb", ".php", ".swift", ".scala", ".c", ".h", ".cc", ".cpp", ".sql"]);

const NON_PRODUCTION = /(^|\/)(tests?|__tests__|spec|fixtures?|mocks?|examples?|docs?)(\/|$)|\.(test|spec)\.[a-z]+$/i;

// Signals that a module handles something whose failure has consequences. These are proposals
// with evidence, never decisions: a guessed tier is worse than an absent one, because it is
// believed.
const ATTRIBUTE_SIGNALS: Array<{ attribute: QualityAttribute; pattern: RegExp }> = [
  { attribute: "security", pattern: /\b(auth|authn|authz|jwt|oauth|token|password|passwd|credential|secret|crypto|cipher|permission|rbac|acl|session|signin|login|payment|billing|invoice|refund)\b/i },
  { attribute: "privacy", pattern: /\b(email|phone|mobile|address|birthday|birthdate|ssn|passport|personal|gdpr|consent|pii)\b/i },
  { attribute: "safety", pattern: /\b(actuator|motor|valve|relay|dispense|dose|throttle|brake|servo|emergency_?stop|interlock|watchdog)\b/i },
  { attribute: "reliability", pattern: /\b(transaction|idempoten|exactly_?once|consistency|reconcil|ledger|balance)\b/i },
  { attribute: "resilience", pattern: /\b(circuit_?break|backoff|jitter|bulkhead|fallback|degrade|rate_?limit|throttl)\b/i },
];

export function detectCommands(root: string): Array<{ id: string; command: string; class: string; source: string }> {
  const found: Array<{ id: string; command: string; class: string; source: string }> = [];
  const exists = (rel: string) => existsSync(resolve(root, rel));
  if (exists("package.json")) {
    let scripts: Record<string, string> = {};
    try {
      scripts = readJson(resolve(root, "package.json")).scripts || {};
    } catch {
      scripts = {};
    }
    const runner = exists("pnpm-lock.yaml") ? "pnpm" : exists("yarn.lock") ? "yarn" : "npm run";
    const wanted: Array<[string, string[], string]> = [
      ["unit", ["test", "tests", "jest", "vitest"], "test"],
      ["lint", ["lint", "eslint"], "static"],
      ["types", ["typecheck", "tsc", "types"], "static"],
      ["build", ["build", "compile"], "build"],
    ];
    for (const [id, names, cls] of wanted) {
      const hit = names.find((name) => scripts[name]);
      if (hit) found.push({ id, command: `${runner} ${hit}`, class: cls, source: `package.json scripts.${hit}` });
    }
  }
  if (exists("pyproject.toml") || exists("pytest.ini") || exists("setup.cfg")) {
    found.push({ id: "unit", command: "pytest -q", class: "test", source: "python project layout" });
    found.push({ id: "lint", command: "ruff check .", class: "static", source: "python project layout (replace if you use another linter)" });
  }
  if (exists("go.mod")) {
    found.push({ id: "unit", command: "go test ./...", class: "test", source: "go.mod" });
    found.push({ id: "lint", command: "go vet ./...", class: "static", source: "go.mod" });
  }
  if (exists("Cargo.toml")) {
    found.push({ id: "unit", command: "cargo test", class: "test", source: "Cargo.toml" });
    found.push({ id: "lint", command: "cargo clippy -- -D warnings", class: "static", source: "Cargo.toml" });
  }
  if (exists("Makefile")) {
    const text = readFileSync(resolve(root, "Makefile"), "utf8");
    for (const target of ["test", "lint", "build"]) {
      if (new RegExp(`^${target}:`, "m").test(text)) {
        found.push({ id: target === "test" ? "unit" : target, command: `make ${target}`, class: target === "test" ? "test" : target === "lint" ? "static" : "build", source: `Makefile target ${target}` });
      }
    }
  }
  const seen = new Set<string>();
  return found.filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)));
}

function proposeModules(paths: string[], depth: number): Array<{ id: string; paths: string[]; files: string[] }> {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const parts = path.split("/");
    if (parts.length < 2 || NON_SOURCE.has(parts[0])) continue;
    let prefix: string | null = null;
    if (SOURCE_ROOTS.includes(parts[0]) && parts.length > 2) prefix = parts.slice(0, Math.min(depth + 1, parts.length - 1)).join("/");
    else if (SOURCE_ROOTS.includes(parts[0])) prefix = parts[0];
    else if (parts.length > 2 && !parts[0].startsWith(".")) prefix = parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
    if (!prefix) continue;
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(path);
  }
  const grouped = [...groups.entries()]
    .filter(([, files]) => files.length >= 2)
    .map(([prefix, files]) => ({
      id: prefix.split("/").filter((segment) => !SOURCE_ROOTS.includes(segment)).join("-") || prefix.replace(/\//g, "-"),
      paths: [`${prefix}/**`],
      files,
    }));
  // Any remaining file under a directory becomes part of a module too: an unmapped path escapes
  // every targeted gate, which is the exact failure catalog lint exists to catch. A directory
  // that already holds grouped subdirectories claims only its direct children (`dir/*`), so the
  // draft never proposes two modules for one path.
  const covered = new Set(grouped.flatMap((group) => group.files));
  const prefixes = grouped.map((group) => group.paths[0].replace(/\/\*\*$/, ""));
  const rest = new Map<string, { patterns: Set<string>; files: string[] }>();
  for (const path of paths) {
    if (covered.has(path)) continue;
    const parts = path.split("/");
    if (parts.length < 2 || NON_SOURCE.has(parts[0]) || parts[0].startsWith(".")) continue;
    if (prefixes.some((prefix) => path.startsWith(`${prefix}/`))) continue;
    const top = parts[0];
    const parent = parts.slice(0, -1).join("/");
    const ancestorOfGroup = prefixes.some((prefix) => prefix.startsWith(`${parent}/`));
    if (!rest.has(top)) rest.set(top, { patterns: new Set(), files: [] });
    const entry = rest.get(top)!;
    entry.patterns.add(ancestorOfGroup ? `${parent}/*` : parent === top ? `${top}/**` : `${parent}/**`);
    entry.files.push(path);
  }
  for (const [dir, entry] of rest) {
    // `dir/**` subsumes every deeper pattern unless the directory is an ancestor of a group.
    const patterns = entry.patterns.has(`${dir}/**`) ? [`${dir}/**`] : [...entry.patterns].sort();
    grouped.push({ id: dir.replace(/\//g, "-"), paths: patterns, files: entry.files });
  }
  return grouped;
}

export function proposeAttributes(root: string, modules: Array<{ id: string; files: string[] }>) {
  const proposals: Record<string, Record<string, { files: number; terms: string[]; evidence: string[]; note: string }>> = {};
  for (const module of modules) {
    const hits = new Map<string, { files: Set<string>; terms: Set<string>; evidence: string[] }>();
    for (const file of module.files.slice(0, 300)) {
      if (!CODE_EXTENSIONS.has(extname(file).toLowerCase()) || NON_PRODUCTION.test(file)) continue;
      let text: string;
      try {
        const raw = readFileSync(resolve(root, file));
        if (raw.length > 200_000 || raw.includes(0)) continue;
        text = raw.toString("utf8").slice(0, 20_000);
      } catch {
        continue;
      }
      const haystack = `${file}\n${text}`;
      for (const signal of ATTRIBUTE_SIGNALS) {
        const match = signal.pattern.exec(haystack);
        if (!match) continue;
        if (!hits.has(signal.attribute)) hits.set(signal.attribute, { files: new Set(), terms: new Set(), evidence: [] });
        const entry = hits.get(signal.attribute)!;
        entry.files.add(file);
        entry.terms.add(match[0].toLowerCase());
        if (entry.evidence.length < 3) entry.evidence.push(`${file}: ${match[0]}`);
      }
    }
    for (const [attribute, entry] of hits) {
      // One term in one file is a hint, not a signal.
      if (entry.files.size < 2 && entry.terms.size < 2) continue;
      proposals[module.id] ??= {};
      proposals[module.id][attribute] = {
        files: entry.files.size,
        terms: [...entry.terms],
        evidence: entry.evidence,
        note: "A keyword match is a reason to look, never a decision. Confirm the tier from what a failure here would cost.",
      };
    }
  }
  return proposals;
}

export function discoverCatalog(root: string, depth = 2) {
  const tracked = trackedPaths(root);
  if (!tracked.isGit) return { ok: false, degraded: true, reason: "not a git repository; the file set cannot be established" };
  if (tracked.paths.length === 0) return { ok: false, degraded: true, reason: "no tracked files; commit the project before discovering its structure" };
  // Paths the draft will already excuse or fan out never become modules of their own.
  const preIgnored = IGNORE_CANDIDATES.flatMap((entry) => entry.paths);
  const candidates = tracked.paths.filter((path) => !matchesPath(path, preIgnored) && !GLOBAL_CANDIDATES.includes(path));
  const modules = proposeModules(candidates, depth);
  if (modules.length === 0) {
    return { ok: false, degraded: true, reason: "no directory holds two or more tracked source files, so no module can be proposed; pass --depth 1 or write the catalog by hand" };
  }
  // Real import edges between the proposed modules become dependsOn, so the draft graph
  // matches the code on the first run. From then on a new edge is drift for arch-check.
  const probe: ModuleCatalog = { version: 1, modules: modules.map((module) => ({ id: module.id, paths: module.paths })) };
  const edges = new Map<string, Set<string>>(modules.map((module) => [module.id, new Set<string>()]));
  for (const module of modules) {
    for (const file of module.files) {
      if (!SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
      let contents: string;
      try {
        contents = readFileSync(resolve(root, file), "utf8");
      } catch {
        continue;
      }
      for (const specifier of extractImports(file, contents)) {
        const target = specifier.startsWith(".")
          ? (() => {
              const resolved = resolveRelativeImport(root, file, specifier);
              return resolved ? moduleForPath(probe, resolved) : null;
            })()
          : moduleForSpecifier(probe, specifier);
        if (target && target.id !== module.id) edges.get(module.id)!.add(target.id);
      }
    }
  }
  const commands = detectCommands(root);
  const checks: Record<string, { command: string; class: string; required: boolean; attributes: QualityAttribute[] }> = {};
  for (const command of commands) {
    checks[command.id] = {
      command: command.command,
      class: command.class,
      required: true,
      attributes: command.class === "test" ? ["reliability"] : ["maintainability"],
    };
  }
  const covered = new Set(modules.flatMap((module) => module.files));
  const globalPaths = GLOBAL_CANDIDATES.filter((path) => tracked.paths.includes(path));
  const ignored = IGNORE_CANDIDATES
    .map((entry) => ({ ...entry, paths: entry.paths.filter((pattern) => entry.always || tracked.paths.some((path) => matchesPath(path, [pattern]))) }))
    .filter((entry) => entry.paths.length > 0)
    .map(({ paths, reason }) => ({ paths, reason }));
  const draftBase: ModuleCatalog = { version: 1, modules: [], globalPaths, ignored };
  let unmapped = tracked.paths.filter((path) => !covered.has(path) && classifyPath(draftBase, path).classification === "unmapped");
  // A root-level file nothing claimed fans out to everything rather than escaping every gate.
  for (const path of unmapped.filter((candidate) => !candidate.includes("/"))) globalPaths.push(path);
  unmapped = unmapped.filter((path) => path.includes("/"));
  const draft: ModuleCatalog = {
    version: 1,
    globalPaths: [...new Set(globalPaths)].sort(),
    ignored,
    modules: modules.map((module) => ({
      id: module.id,
      paths: module.paths,
      dependsOn: [...edges.get(module.id)!].sort(),
      verification: Object.keys(checks),
      owners: [],
    })),
  };
  return {
    ok: true,
    draft,
    matrix: { version: 1, checks },
    tracked_paths: tracked.paths.length,
    truncated: tracked.truncated,
    proposed_modules: modules.length,
    real_edges: [...edges.values()].reduce((sum, set) => sum + set.size, 0),
    detected_commands: commands,
    attribute_proposals: proposeAttributes(root, modules),
    still_unmapped: unmapped.slice(0, 50),
    still_unmapped_count: unmapped.length,
    needs_decision: [
      ...(commands.length === 0 ? [{ field: "checks", why: "no build manifest was recognised, so no check command could be detected; until a check exists every gate reports BLOCKED, which is correct." }] : []),
      { field: "modules[].attributes", why: "no quality attribute was assigned. Guessing security=critical would block the gate arbitrarily; guessing low would make it theatre. Start with the modules under attribute_proposals." },
      { field: "modules[].forbiddenDependencies", why: "no edge was forbidden. A prohibition is a commitment about what must never happen, not an observation about what has not happened yet." },
      { field: "layers", why: "no layer order was proposed. Name the layers in your own vocabulary and confirm the direction you intend." },
      { field: "modules[].dependsOn", why: "declared from the real import edges so arch-check starts clean; every later undeclared edge is drift. Delete any edge you do not intend to keep." },
    ],
  };
}

/**
 * True when the live file is absent or still equals its template apart from line endings. The
 * template comes from `templatePath`, the same resolver the installer's seed step used, so the
 * comparison and the seed can never disagree about which file the template is.
 */
export function isUneditedTemplate(root: string, live: string): boolean {
  const livePath = resolve(root, live);
  if (!existsSync(livePath)) return true;
  const template = templatePath(root, live);
  if (!template) return false;
  return normalizeLf(readFileSync(livePath, "utf8")) === normalizeLf(readFileSync(template, "utf8"));
}

const CONTRACT_SCHEMAS: Record<string, string> = {
  "harness/module-catalog.json": "./schemas/module-catalog.schema.json",
  "harness/verification-matrix.json": "./schemas/verification-matrix.schema.json",
};

/**
 * Persists a discovered catalog and matrix. The one rule every caller shares: a file someone
 * edited is never overwritten; the draft lands beside it as `*.draft.json` for a merge. Each
 * file is judged on its own, so an edited matrix survives a fresh catalog and vice versa.
 */
export function writeDiscoveredCatalog(
  root: string,
  result: { draft: ModuleCatalog; matrix: { version: number; checks: Record<string, unknown> } },
  options: { only?: string[] } = {},
): string[] {
  const written: string[] = [];
  const values: Record<string, unknown> = {
    "harness/module-catalog.json": result.draft,
    "harness/verification-matrix.json": result.matrix,
  };
  for (const [live] of LIVE_CONTRACTS) {
    if (!(live in values)) continue;
    if (options.only && !options.only.includes(live)) continue;
    const target = isUneditedTemplate(root, live) ? live : draftPath(live);
    writeJson(resolve(root, target), { $schema: CONTRACT_SCHEMAS[live], ...(values[live] as Record<string, unknown>) });
    written.push(target);
  }
  return written;
}

export function catalogDiscover(options: CliOptions): void {
  const root = targetFrom(options);
  const result = discoverCatalog(root, options.depth === undefined ? 2 : Number(options.depth));
  if (!result.ok || !result.draft || !result.matrix) {
    printJson({ command: "catalog discover", target: root, ...result });
    process.exitCode = EXIT.DEGRADED;
    return;
  }
  const written: string[] = boolOption(options, "write")
    ? writeDiscoveredCatalog(root, { draft: result.draft, matrix: result.matrix })
    : [];
  printJson({
    command: "catalog discover",
    target: root,
    ...result,
    written,
    next: written.length ? "node scripts/harness.mjs catalog lint" : "re-run with --write to save the draft",
  });
}
