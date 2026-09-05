// Static scanners: built-in fitness rules, curated external adapters, the ADR enforcement audit,
// the instruction-file scan, skills lint, module contract lint, and the rules audit.

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { TIER_RANK, catalog, matrix, moduleDirectories, moduleForPath, normalizeRequirement } from "./catalog.mjs";
import type { AttributeTier, ModuleDefinition, QualityAttribute } from "./catalog.mjs";
import { contextDenied } from "./context.mjs";
import {
  EVENTS,
  EXIT,
  HARNESS_ROOT,
  boolOption,
  boundedText,
  git,
  gitAvailable,
  matchesPath,
  normalizeLf,
  parseFrontmatter,
  posix,
  printJson,
  readJson,
  redactSecrets,
  splitNulPaths,
  targetFrom,
  walkFiles,
  whichCommand,
  writeJson,
} from "./core.mjs";
import type { CliOptions } from "./core.mjs";
import { SOURCE_EXTENSIONS, requestedPaths } from "./graph.mjs";

export interface FitnessRule {
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

/** Suppression marker, placed on the offending line or the line above it. */
export const FITNESS_IGNORE = "harness-fitness:ignore";

// Rules that need no external tool and no language server, so they work on day one in any
// repository. Anything needing real analysis belongs in an adapter, not here.
export const DEFAULT_FITNESS_RULES: FitnessRule[] = [
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

export function fitnessRules(root: string): FitnessRule[] {
  const local = resolve(root, "harness/fitness-rules.json");
  if (!existsSync(local)) return DEFAULT_FITNESS_RULES;
  const value = readJson(local);
  if (!Array.isArray(value?.rules)) throw new Error("fitness-rules.json must define a rules array.");
  return value.replace === true ? value.rules : [...DEFAULT_FITNESS_RULES, ...value.rules];
}

export interface FitnessFinding {
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

export function fitness(options: CliOptions): void {
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
export function meetsMinimumTier(module: ModuleDefinition | null, rule: FitnessRule): boolean {
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
export function ruleOptedOut(module: ModuleDefinition, rule: FitnessRule): boolean {
  if (rule.attributes.length === 0) return false;
  const declared = module.attributes || {};
  return rule.attributes.every((attribute) => {
    const requirement = declared[attribute];
    if (requirement === undefined) return false;
    return normalizeRequirement(requirement).tier === "none";
  });
}

export interface AdapterDefinition {
  id: string;
  attributes: QualityAttribute[];
  class: string;
  executable: string;
  command: string;
  install: string;
  rationale: string;
  timeoutMs?: number;
}

export function adapterCatalog(root: string): AdapterDefinition[] {
  const local = resolve(root, "harness/adapters.json");
  const source = existsSync(local) ? local : resolve(HARNESS_ROOT, "harness/adapters.json");
  if (!existsSync(source)) return [];
  const value = readJson(source);
  return Array.isArray(value?.adapters) ? value.adapters : [];
}

export function adapters(positional: string[], options: CliOptions): void {
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
export function adrCheck(options: CliOptions): void {
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

// ============================== Instruction files as untrusted input ==============================
// Instruction files are executable-adjacent: a cloned repository can carry them and the agent
// loads them without anyone reading them first. Credential leakage, base-URL redirection, and
// injected "ignore previous instructions" have all been found in the wild inside such files.
// This scan claims the security attribute, so it is never fast-skipped and never waived.

export const INSTRUCTION_FILE_PATTERNS = [
  /(^|\/)AGENTS(\.local)?\.md$/i,
  /(^|\/)CLAUDE(\.local)?\.md$/i,
  /(^|\/)GEMINI\.md$/i,
  /(^|\/)\.cursorrules$/i,
  /(^|\/)\.cursor\/rules\//i,
  /(^|\/)\.cursor\/agents\//i,
  /(^|\/)\.cursor\/skills\//i,
  /(^|\/)\.cursor\/commands\//i,
  /(^|\/)\.agents\//i,
  /(^|\/)\.github\/copilot-instructions\.md$/i,
  /(^|\/)\.windsurfrules$/i,
];

export interface InstructionRule {
  id: string;
  severity: "error" | "warning";
  message: string;
  pattern: RegExp;
}

export const INSTRUCTION_RULES: InstructionRule[] = [
  {
    id: "endpoint-override",
    severity: "error",
    message: "redirects the model or tool endpoint; an instruction file that moves the API base URL sends every prompt and credential somewhere the reader did not choose.",
    pattern: /\b(ANTHROPIC_BASE_URL|OPENAI_BASE_URL|OPENAI_API_BASE|GEMINI_BASE_URL|LLM_BASE_URL|CURSOR_API_URL|HTTPS?_PROXY|ALL_PROXY)\b\s*[:=]/i,
  },
  {
    id: "embedded-credential",
    severity: "error",
    message: "carries credential-shaped material; instruction files are copied between repositories, so a key here is a key published.",
    pattern: /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: "instruction-override",
    severity: "error",
    message: "argues for overriding higher-authority instructions; repository text is the lowest authority there is.",
    pattern: /\b(ignore (all )?(previous|prior|above|earlier) (instructions|rules|prompts)|disregard (the )?(system|previous|above)|you are now [a-z]|forget (everything|all previous)|override (the )?(system|safety))\b/i,
  },
  {
    id: "exfiltration-command",
    severity: "error",
    message: "instructs the agent to send repository content to a network endpoint; an instruction file may describe how to build, never how to upload.",
    pattern: /\b(curl|wget|Invoke-WebRequest|iwr)\b[^\n]{0,120}\s(-d|--data|--upload-file|-F|-T|-Method\s+Post)\b|\bnc\b\s+-[a-z]*\s*\d{1,5}\b/i,
  },
  {
    id: "silent-execution",
    severity: "error",
    message: "pipes a downloaded script straight into a shell; nothing that must be read before it runs should arrive this way.",
    pattern: /\b(curl|wget)\b[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z)?sh\b|\biex\s*\(\s*(new-object|iwr|invoke-webrequest)/i,
  },
  {
    id: "hidden-characters",
    severity: "error",
    message: "contains zero-width or bidirectional control characters; text a human cannot see but a model reads is an instruction meant to escape review.",
    pattern: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/,
  },
  {
    id: "gate-disable-instruction",
    severity: "error",
    message: "instructs the agent to bypass verification; a repository that tells an agent to skip its own gates is describing the exploit.",
    pattern: /(^|[^\w`-])(--no-verify|skip[- ]?(the )?(hook|gate|check|test)s?\b|disable (the )?(hook|gate|lint|check)s?\b)/i,
  },
  {
    id: "secret-file-read",
    severity: "warning",
    message: "names a secret-bearing path; an instruction file should never need to point at one.",
    pattern: /(^|[\s"'`(])(\.env(\.[a-z]+)?|id_rsa|id_ed25519|\.ssh\/|\.aws\/credentials|\.npmrc)\b(?!\.example|\.sample|\.template)/i,
  },
];

export const INSTRUCTION_IGNORE = "harness-instructions:ignore";

export interface InstructionFinding {
  file: string;
  line: number;
  rule: string;
  severity: "error" | "warning";
  message: string;
  excerpt: string;
}

export function instructionFiles(root: string, staged: boolean): string[] | null {
  const listing = staged
    ? git(root, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], true)
    : git(root, ["ls-files", "-z"], true);
  if (!gitAvailable(root) || !listing.ok) return null;
  return splitNulPaths(listing.stdout).filter((path) => INSTRUCTION_FILE_PATTERNS.some((pattern) => pattern.test(path)));
}

export function scanInstructions(root: string, files: string[]): InstructionFinding[] {
  const findings: InstructionFinding[] = [];
  for (const file of files) {
    const absolute = resolve(root, file);
    if (!existsSync(absolute)) continue;
    let text: string;
    try {
      const raw = readFileSync(absolute);
      if (raw.length > 1024 * 1024 || raw.includes(0)) continue;
      // A UTF-8 byte-order mark is an encoding artefact, not a hidden character.
      text = normalizeLf(raw.toString("utf8").replace(/^\uFEFF/, ""));
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.includes(INSTRUCTION_IGNORE) || (index > 0 && lines[index - 1].includes(INSTRUCTION_IGNORE))) continue;
      for (const rule of INSTRUCTION_RULES) {
        if (!rule.pattern.test(line)) continue;
        findings.push({
          file,
          line: index + 1,
          rule: rule.id,
          severity: rule.severity,
          message: rule.message,
          excerpt: boundedText(redactSecrets(line.trim()), 160),
        });
      }
    }
  }
  return findings;
}

export function instructionsCommand(options: CliOptions): void {
  const root = targetFrom(options);
  const staged = boolOption(options, "staged");
  const files = options.paths === undefined
    ? instructionFiles(root, staged)
    : String(options.paths).split(",").map((path) => path.trim()).filter(Boolean);
  if (files === null) {
    printJson({ command: "instructions", target: root, ok: false, degraded: true, reason: "not a git repository; refusing to guess the file set" });
    process.exitCode = EXIT.DEGRADED;
    return;
  }
  const findings = scanInstructions(root, files);
  const errors = findings.filter((finding) => finding.severity === "error");
  printJson({
    command: "instructions",
    target: root,
    ok: errors.length === 0,
    scanned: files.length,
    staged,
    findings: findings.slice(0, 100),
    counts: { error: errors.length, warning: findings.length - errors.length },
    note: "Instruction files are treated as untrusted input. Suppress one finding with `harness-instructions:ignore` on the line or the line above.",
  });
  if (errors.length > 0) process.exitCode = EXIT.VIOLATION;
}

// ============================== Skills lint ==============================
// A malformed SKILL.md is dropped by the loader without a visible error, and the skill most
// likely to be dropped is the one that enforces something. Cursor reads `name` (kebab-case,
// equal to the folder), `description`, `paths`, `disable-model-invocation`, `metadata`.

export const SKILL_ROOTS = [".cursor/skills", ".agents/skills"];

export interface SkillFinding {
  file: string;
  severity: "error" | "warning";
  code: string;
  message: string;
}

export function skillsLint(root: string): { skills: Array<{ name: string; file: string; bytes: number; description: string }>; findings: SkillFinding[] } {
  const findings: SkillFinding[] = [];
  const skills: Array<{ name: string; file: string; bytes: number; description: string }> = [];
  for (const skillRoot of SKILL_ROOTS) {
    const dir = resolve(root, skillRoot);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = `${skillRoot}/${entry.name}/SKILL.md`;
      const absolute = resolve(root, file);
      if (!existsSync(absolute)) {
        findings.push({ file: `${skillRoot}/${entry.name}`, severity: "error", code: "NO_SKILL_MD", message: "skill directory has no SKILL.md; the loader discovers only <root>/<name>/SKILL.md" });
        continue;
      }
      const text = readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
      const normalized = normalizeLf(text);
      if (!normalized.startsWith("---\n") || !/\n---\n/.test(normalized.slice(4))) {
        findings.push({ file, severity: "error", code: "BAD_FRONTMATTER", message: "SKILL.md must open with a --- frontmatter block" });
        continue;
      }
      const meta = parseFrontmatter(text);
      const name = meta.name ?? "";
      if (!name) findings.push({ file, severity: "error", code: "NO_NAME", message: "frontmatter requires name" });
      else {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) findings.push({ file, severity: "error", code: "NAME_NOT_KEBAB", message: `skill name ${JSON.stringify(name)} must be lowercase letters, numbers, and hyphens` });
        if (name !== entry.name) findings.push({ file, severity: "error", code: "NAME_MISMATCH", message: `frontmatter name ${JSON.stringify(name)} does not match the folder ${JSON.stringify(entry.name)}` });
      }
      const description = meta.description ?? "";
      if (!description) findings.push({ file, severity: "error", code: "NO_DESCRIPTION", message: "frontmatter requires description; it is the only routing signal the agent sees before loading the skill" });
      else if (description.length > 500) findings.push({ file, severity: "error", code: "DESCRIPTION_TOO_LONG", message: `description is ${description.length} characters; keep it under 500` });
      else if (description.length > 220) findings.push({ file, severity: "warning", code: "DESCRIPTION_LONG", message: `description is ${description.length} characters; every session pays for it on every request` });
      for (const key of Object.keys(meta)) {
        if (key === "disableModelInvocation" || key === "userInvocable") {
          findings.push({ file, severity: "error", code: "CAMEL_CASE_KEY", message: `frontmatter key ${key} is camelCase; the loader reads disable-model-invocation` });
        }
      }
      if (meta["disable-model-invocation"] !== undefined && !["true", "false"].includes(meta["disable-model-invocation"])) {
        findings.push({ file, severity: "error", code: "NON_BOOLEAN_INVOCATION", message: "disable-model-invocation must be a bare true or false" });
      }
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > 24_000) findings.push({ file, severity: "warning", code: "SKILL_LARGE", message: `skill body is ${bytes} bytes and is paid in full on load; move detail into a REFERENCE.md` });
      skills.push({ name: name || entry.name, file, bytes, description });
    }
  }
  const names = skills.map((skill) => skill.name);
  for (const duplicate of [...new Set(names.filter((name, index) => names.indexOf(name) !== index))]) {
    findings.push({ file: "", severity: "error", code: "DUPLICATE_SKILL", message: `duplicate skill name ${JSON.stringify(duplicate)}; one silently shadows the other` });
  }
  return { skills, findings };
}

export function skillsLintCommand(options: CliOptions): void {
  const root = targetFrom(options);
  const result = skillsLint(root);
  const errors = result.findings.filter((finding) => finding.severity === "error");
  printJson({
    command: "skills-lint",
    target: root,
    ok: errors.length === 0,
    skills: result.skills.length,
    findings: result.findings,
    counts: { error: errors.length, warning: result.findings.length - errors.length },
  });
  if (errors.length > 0) process.exitCode = EXIT.VIOLATION;
}

// ============================== Module contracts (nested AGENTS.md) ==============================
// Cursor loads a nested AGENTS.md when the agent works in that directory, so it is the cheapest
// boundary contract available: it costs nothing until someone touches the module. A module that
// holds a protected attribute at a blocking tier must state its boundaries where the work happens.

export const MODULE_CONTRACT_SECTIONS = ["Purpose", "Boundaries", "Invariants", "Verification"];

export const ROOT_AGENTS_BUDGET_BYTES = 12_000;

export interface AgentsFinding {
  module?: string;
  file?: string;
  severity: "error" | "warning";
  code: string;
  message: string;
}

export function agentsLint(root: string): { contracts: Array<{ module: string; file: string; bytes: number }>; findings: AgentsFinding[] } {
  const findings: AgentsFinding[] = [];
  const contracts: Array<{ module: string; file: string; bytes: number }> = [];
  const rootFile = resolve(root, "AGENTS.md");
  if (!existsSync(rootFile)) {
    findings.push({ file: "AGENTS.md", severity: "error", code: "NO_ROOT_AGENTS", message: "no AGENTS.md at the repository root; the agent has no constitution to load" });
  } else {
    const bytes = Buffer.byteLength(readFileSync(rootFile, "utf8"), "utf8");
    if (bytes > ROOT_AGENTS_BUDGET_BYTES) {
      findings.push({ file: "AGENTS.md", severity: "warning", code: "ROOT_AGENTS_LARGE", message: `root AGENTS.md is ${bytes} bytes and is loaded on every request; keep invariants here and push procedure into skills and rules` });
    }
  }
  for (const module of catalog(root).modules) {
    const tiers = Object.entries(module.attributes || {}).map(([attribute, requirement]) => ({ attribute, tier: normalizeRequirement(requirement).tier }));
    const blocking = tiers.filter((entry) => entry.tier === "critical" || entry.tier === "high");
    if (blocking.length === 0) continue;
    const candidates = moduleDirectories(module);
    if (candidates.length === 0) {
      findings.push({ module: module.id, severity: "warning", code: "MODULE_ROOT_UNDECIDABLE", message: `module ${module.id} claims only repository-root files, so no contract directory can be derived` });
      continue;
    }
    // The first candidate is the conventional location; an existing contract anywhere in the
    // module's directories is accepted, because the agent loads it wherever it works.
    const existing = candidates.find((candidate) => existsSync(resolve(root, `${candidate}/AGENTS.md`)));
    const file = `${existing ?? candidates[0]}/AGENTS.md`;
    const absolute = resolve(root, file);
    const protectedAttributes = blocking.filter((entry) => ["security", "safety", "privacy"].includes(entry.attribute));
    if (!existsSync(absolute)) {
      findings.push({
        module: module.id,
        file,
        severity: protectedAttributes.length ? "error" : "warning",
        code: "NO_MODULE_AGENTS",
        message: `module ${module.id} declares ${blocking.map((entry) => `${entry.attribute}=${entry.tier}`).join(", ")} but has no ${file}${candidates.length > 1 ? ` (or in ${candidates.slice(1).join(", ")})` : ""}; the agent loads that file whenever it works in the module, so it is the cheapest boundary contract available`,
      });
      continue;
    }
    const text = readFileSync(absolute, "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    contracts.push({ module: module.id, file, bytes });
    const missing = MODULE_CONTRACT_SECTIONS.filter((section) => !new RegExp(`^#{1,4}\\s*${section}`, "im").test(text));
    if (missing.length) findings.push({ module: module.id, file, severity: "warning", code: "MODULE_AGENTS_INCOMPLETE", message: `${file} is missing section(s): ${missing.join(", ")}` });
    if (bytes > ROOT_AGENTS_BUDGET_BYTES) findings.push({ module: module.id, file, severity: "warning", code: "MODULE_AGENTS_LARGE", message: `${file} is ${bytes} bytes` });
  }
  return { contracts, findings };
}

export function agentsLintCommand(options: CliOptions): void {
  const root = targetFrom(options);
  const result = agentsLint(root);
  const errors = result.findings.filter((finding) => finding.severity === "error");
  printJson({
    command: "agents-lint",
    target: root,
    ok: errors.length === 0,
    contracts: result.contracts,
    findings: result.findings,
    counts: { error: errors.length, warning: result.findings.length - errors.length },
  });
  if (errors.length > 0) process.exitCode = EXIT.VIOLATION;
}

// ============================== Rules audit ==============================
// The quantity to minimise in a constitution is not bytes. It is rules that name no enforcement
// and do not admit to being unenforced: an unenforced rule competes for attention with the
// enforced ones, and restraint rules degrade fastest under pressure. A phantom - a token shaped
// like an enforcement point that does not exist - is worse than silence, because it reads as
// enforced. Only phantoms fail the command; the unenforced count is a worklist, not a gate.

export interface RuleRow {
  file: string;
  line: number;
  section: string;
  state: "enforced" | "prompt-only" | "phantom" | "unenforced";
  enforced_by: string[];
  phantoms: string[];
  text: string;
}

const RULE_LINE = /^\s*(?:\d+\.|-|\*|\|)\s+\S/;
const PROMPT_ONLY = /\b(prompt-only|prompt only|\(P\)|on the honou?r system|靠自觉)\b/i;
const SECTION = /^#{1,3}\s+(.+?)\s*$/;

export function rulesAudit(root: string, knownCommands: string[], files: string[] | null = null) {
  const known = new Set<string>(knownCommands);
  for (const id of Object.keys(matrix(root).checks || {})) known.add(id);
  for (const rule of fitnessRules(root)) known.add(rule.id);
  for (const event of EVENTS) known.add(event);
  const targets = files ?? ["AGENTS.md", ...listRuleFiles(root)];
  const rows: RuleRow[] = [];
  const tokenOf = (raw: string): string =>
    raw
      .trim()
      .replace(/^node\s+(scripts\/harness\.mjs|\.cursor\/runtime\/harness\.mjs)\s+/, "")
      .replace(/^\.\//, "")
      .split(/[\s|]/)[0] ?? "";
  for (const file of targets) {
    const absolute = resolve(root, file);
    if (!existsSync(absolute)) continue;
    const lines = normalizeLf(readFileSync(absolute, "utf8")).split("\n");
    let section = "(preamble)";
    let fenced = false;
    let inFrontmatter = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (index === 0 && line.trim() === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        if (line.trim() === "---") inFrontmatter = false;
        continue;
      }
      if (/^```/.test(line.trim())) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      const heading = SECTION.exec(line);
      if (heading) {
        section = heading[1];
        continue;
      }
      if (!RULE_LINE.test(line)) continue;
      // A rule is the bullet plus its indented continuation lines; the enforcement token is
      // often on the second line of a wrapped sentence.
      let rule = line;
      let cursor = index + 1;
      while (cursor < lines.length && /^\s+\S/.test(lines[cursor]) && !RULE_LINE.test(lines[cursor])) {
        rule += ` ${lines[cursor].trim()}`;
        cursor += 1;
      }
      if (rule.trim().length < 25) continue;
      const enforcedBy: string[] = [];
      const phantoms: string[] = [];
      for (const match of rule.matchAll(/`([^`]{2,90})`/g)) {
        const raw = match[1];
        const token = tokenOf(raw);
        // Placeholders (`<sub>`, `...`) and bare flags describe a shape, not an enforcement point.
        if (!token || token.includes("<") || raw.includes("...") || token.startsWith("--")) continue;
        if (known.has(token)) {
          enforcedBy.push(token);
          continue;
        }
        if (existsSync(resolve(root, token)) || existsSync(resolve(root, ".cursor", token))) continue;
        // Something spelled like a harness command or a script path that does not exist.
        if (/^node\s+(scripts\/harness\.mjs|\.cursor\/runtime\/harness\.mjs)\s+/.test(raw.trim())) phantoms.push(raw);
        else if (/^(\.cursor|scripts|harness)\//.test(token) || /\.(sh|ps1|mjs|js|ya?ml)$/.test(token)) phantoms.push(raw);
      }
      const declared = PROMPT_ONLY.test(rule) || PROMPT_ONLY.test(section);
      rows.push({
        file,
        line: index + 1,
        section,
        state: enforcedBy.length ? "enforced" : phantoms.length ? "phantom" : declared ? "prompt-only" : "unenforced",
        enforced_by: enforcedBy,
        phantoms,
        text: boundedText(rule.trim(), 140),
      });
      index = cursor - 1;
    }
  }
  const counts = {
    total: rows.length,
    enforced: rows.filter((row) => row.state === "enforced").length,
    prompt_only: rows.filter((row) => row.state === "prompt-only").length,
    phantom: rows.filter((row) => row.state === "phantom").length,
    unenforced: rows.filter((row) => row.state === "unenforced").length,
  };
  return {
    ok: counts.phantom === 0,
    files: targets.filter((file) => existsSync(resolve(root, file))),
    counts,
    enforcement_ratio: rows.length ? Number((counts.enforced / rows.length).toFixed(3)) : 1,
    phantoms: rows.filter((row) => row.state === "phantom"),
    unenforced: rows.filter((row) => row.state === "unenforced"),
    rows,
  };
}

function listRuleFiles(root: string): string[] {
  const dir = resolve(root, ".cursor/rules");
  if (!existsSync(dir)) return [];
  return walkFiles(dir)
    .filter((absolute) => absolute.endsWith(".mdc"))
    .map((absolute) => posix(relative(root, absolute)))
    .sort();
}

export function rulesAuditCommand(options: CliOptions, knownCommands: string[]): void {
  const root = targetFrom(options);
  const files = options.files === undefined ? null : String(options.files).split(",").map((file) => file.trim()).filter(Boolean);
  const result = rulesAudit(root, knownCommands, files);
  printJson({
    command: "rules-audit",
    target: root,
    ok: result.ok,
    files: result.files,
    counts: result.counts,
    enforcement_ratio: result.enforcement_ratio,
    phantoms: result.phantoms,
    unenforced: boolOption(options, "verbose") ? result.unenforced : result.unenforced.map((row) => `${row.file}:${row.line} ${row.text}`),
    advice: result.phantoms.length
      ? "A phantom names an enforcement point that does not exist and reads as enforced. Fix the reference, build the command, or mark the rule prompt-only."
      : result.unenforced.length
        ? `${result.unenforced.length} rule(s) name no enforcement and do not admit it. Bind each to a command, mark it prompt-only, or delete it.`
        : "Every rule either names its enforcement or admits it has none.",
  });
  if (!result.ok) process.exitCode = EXIT.VIOLATION;
}
