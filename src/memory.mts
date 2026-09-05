// Project memory: what survives a context boundary, and what it costs to come back.
//
// Compaction does not dilute a governance constraint, it deletes it, and the summary that
// replaces the conversation carries drift forward instead of correcting it. So nothing here
// reads a summary. `recap` derives the situation from the memory files on a budget, `invariants`
// re-derives the non-negotiable set plus the live state small enough to re-inject, `sync-check`
// decides the machine-checkable half of "memory keeps up with code", `archive` moves old entries
// out whole and never rewrites them, and the feedback corpus counts lessons toward graduation.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { openDebts, readLoan } from "./assurance.mjs";
import { catalog, classifyPath } from "./catalog.mjs";
import {
  EXIT,
  boolOption,
  changedPaths,
  errorMessage,
  git,
  gitAvailable,
  gitBase,
  parseFrontmatter,
  posix,
  printJson,
  targetFrom,
} from "./core.mjs";
import type { CliOptions } from "./core.mjs";
import { readQualityLedger, verifyLedgerChain } from "./quality.mjs";
import { activeTask } from "./state.mjs";

// ============================== Memory contract ==============================

export interface MemoryConfig {
  ledger: string;
  archive: string;
  maxLedgerBytes: number;
  keepDone: number;
  keepNotes: number;
  recapBudget: number;
}

export const MEMORY_DEFAULTS: MemoryConfig = Object.freeze({
  ledger: "progress.md",
  archive: "progress.archive.md",
  maxLedgerBytes: 24_000,
  keepDone: 40,
  keepNotes: 30,
  recapBudget: 6_000,
});

export function memoryConfig(root: string): MemoryConfig {
  let declared: Partial<MemoryConfig> = {};
  try {
    declared = catalog(root).memory || {};
  } catch {
    declared = {};
  }
  return { ...MEMORY_DEFAULTS, ...declared };
}

export interface LedgerSection {
  title: string;
  /** Raw lines under the heading, heading excluded. */
  lines: string[];
}

/** Splits a memory file into its `## ` sections, preserving order and raw bodies. */
export function parseLedger(text: string): LedgerSection[] {
  const sections: LedgerSection[] = [];
  let current: LedgerSection | null = null;
  for (const line of String(text || "").split("\n")) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      current = { title: match[1], lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

/**
 * One entry is a `- ` bullet plus its indented continuation lines. Entries are the unit that
 * moves during archiving, so a multi-line decision travels whole.
 */
export function ledgerEntries(section: LedgerSection | null): string[][] {
  if (!section) return [];
  const entries: string[][] = [];
  for (const line of section.lines) {
    if (/^-\s+\S/.test(line)) entries.push([line]);
    else if (entries.length > 0 && /^\s+\S/.test(line)) entries[entries.length - 1].push(line);
  }
  return entries;
}

export function sectionNamed(sections: LedgerSection[], name: string): LedgerSection | null {
  const lower = name.toLowerCase();
  return sections.find((section) => section.title.toLowerCase().startsWith(lower)) ?? null;
}

const clip = (line: string, max = 220): string =>
  line.length <= max ? line : `${line.slice(0, max - 3).trimEnd()}...`;

const firstLines = (entries: string[][], limit: number): string[] =>
  entries.slice(0, limit).map((entry) => clip(entry[0]));

export function ledgerHealth(root: string) {
  const config = memoryConfig(root);
  const path = resolve(root, config.ledger);
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const bytes = Buffer.byteLength(text, "utf8");
  const sections = parseLedger(text);
  const done = ledgerEntries(sectionNamed(sections, "Done")).length;
  const notes = ledgerEntries(sectionNamed(sections, "Notes")).length;
  const over = bytes > config.maxLedgerBytes || done > config.keepDone;
  return {
    ledger: config.ledger,
    present: existsSync(path),
    bytes,
    max_ledger_bytes: config.maxLedgerBytes,
    done_entries: done,
    keep_done: config.keepDone,
    note_entries: notes,
    ok: !over,
    advice: over
      ? `Memory exceeds its budget; run \`node scripts/harness.mjs archive --apply\` to move the oldest entries into ${config.archive}. Nothing is deleted.`
      : "Memory is within budget.",
  };
}

// ============================== recap ==============================

/** Live facts that do not come from the memory file: they are read from state, never guessed. */
function liveState(root: string) {
  const task = activeTask(root);
  const loan = readLoan(root);
  const debts = openDebts(root);
  const integrity = verifyLedgerChain(root);
  const ledger = integrity.ok ? readQualityLedger(root) : [];
  const latest = ledger[ledger.length - 1];
  const latestDiff = latest?.diff_sha256;
  const latestRun = latestDiff ? ledger.filter((receipt) => receipt.diff_sha256 === latestDiff) : [];
  const gateStatus = latestRun.length === 0
    ? "never run"
    : latestRun.some((receipt) => receipt.status === "FAIL")
      ? "FAIL"
      : latestRun.some((receipt) => receipt.status === "BLOCKED")
        ? "BLOCKED"
        : latestRun.every((receipt) => receipt.deferred)
          ? "BLOCKED (every check deferred)"
          : "PASS";
  const branch = gitAvailable(root) ? git(root, ["rev-parse", "--abbrev-ref", "HEAD"], true).stdout.trim() : "";
  const dirty = gitAvailable(root) ? changedPaths(root, gitBase(root)).length : 0;
  return {
    task,
    loan,
    debts,
    integrity,
    gate: latestRun.length
      ? { status: gateStatus, at: latest!.created_at, checks: latestRun.map((receipt) => receipt.check_id), deferred: latestRun.some((receipt) => receipt.deferred) }
      : null,
    branch,
    dirty,
    base: gitAvailable(root) ? gitBase(root) : "NO_GIT",
  };
}

export function recap(root: string, budget: number | null = null) {
  const config = memoryConfig(root);
  const cap = budget || config.recapBudget;
  const path = resolve(root, config.ledger);
  const present = existsSync(path);
  const sections = parseLedger(present ? readFileSync(path, "utf8") : "");
  const live = liveState(root);

  const blocks: string[] = [];
  const push = (title: string, lines: string[]) => {
    if (lines.length) blocks.push(`## ${title}\n${lines.join("\n")}`);
  };
  push("Position", [
    `- branch ${live.branch || "unknown"} at ${live.base}, ${live.dirty} changed path(s) against the base`,
    `- active task: ${live.task ? `${live.task.id} (${live.task.risk} risk) - ${live.task.goal}` : "none"}`,
    `- last gate: ${live.gate ? `${live.gate.status} at ${live.gate.at} over [${live.gate.checks.join(", ")}]${live.gate.deferred ? " (fast loan)" : ""}` : "never run"}`,
    `- fast loan: ${live.loan.active ? `OPEN until ${live.loan.loan?.expires_at} (${live.loan.loan?.reason})` : "closed"}; open evidence debts: ${live.debts.length}`,
    ...(live.integrity.ok ? [] : [`- LEDGER BROKEN: ${live.integrity.reason}`]),
  ]);
  if (!present) push("Memory", [`- ${config.ledger} is absent; nothing to recall. Create it from the project-memory skill contract.`]);
  push("Pinned", firstLines(ledgerEntries(sectionNamed(sections, "Pinned")), 12));
  push("In progress", firstLines(ledgerEntries(sectionNamed(sections, "In progress")), 8));
  // The section name is data from the memory contract, not a deferral marker in this code.
  const pending = ledgerEntries(sectionNamed(sections, "TODO")); // harness-fitness:ignore
  push("Next (P0/P1)", firstLines(pending.filter((entry) => /\bP[01]\b/.test(entry[0])), 10));
  push("Recent decisions", firstLines(ledgerEntries(sectionNamed(sections, "Decisions")), 5));
  push("Recently done", firstLines(ledgerEntries(sectionNamed(sections, "Done")), 6));
  push("Not doing", firstLines(ledgerEntries(sectionNamed(sections, "Not doing")), 5));
  push("Risks", firstLines(ledgerEntries(sectionNamed(sections, "Risks")), 8));

  let text = `# Recap - ${new Date().toISOString()}\n\n${blocks.join("\n\n")}\n`;
  let truncated = false;
  if (text.length > cap) {
    text = `${text.slice(0, cap)}\n\n...[recap truncated at ${cap} chars; open ${config.ledger} for the rest]\n`;
    truncated = true;
  }
  return {
    ok: true,
    chars: text.length,
    budget: cap,
    truncated,
    sources: [config.ledger, ".cursor/harness-state (task, ledger, loan, debt)"],
    health: ledgerHealth(root),
    text,
  };
}

// ============================== invariants ==============================

const LAWS = [
  "# Invariants - re-read after any compaction and at every phase boundary",
  "",
  "1. EVIDENCE. Name the command that proves a claim, run it fresh, read output and exit code, then speak. `Verified` lists only what executed.",
  "2. STATES. PASS | FAIL | BLOCKED | SKIPPED. A missing tool is BLOCKED, an empty plan is BLOCKED, SKIPPED is not evidence. Exit 3 (degraded) is never a pass.",
  "3. FLOOR. Safety controls are non-waivable. security, safety, privacy are never fast-skipped, never waived, never downgraded by a profile.",
  "4. SCOPE. Change only what the task envelope names. Missing information is not permission. Preserve changes you did not make.",
  "5. APPROVAL. Commit, push, publish, deploy, dependency installation, destructive commands, process termination, machine configuration, and credential access stop for the user.",
];

export function invariants(root: string, budget = 1200) {
  const live = liveState(root);
  const state = [
    `- assurance selection: ${live.task ? `task ${live.task.id}` : "project"} -> see \`profile show\`; floors apply per change`,
    `- task: ${live.task ? `${live.task.id} (${live.task.risk}) scope ${live.task.owned_paths.join(", ")}` : "none open"}`,
    live.loan.active ? `- FAST LOAN OPEN until ${live.loan.loan?.expires_at} (${live.loan.loan?.reason}): evidence is deferred, not waived` : "- fast loan: closed",
    live.debts.length ? `- EVIDENCE DEBT: ${live.debts.length} deferred check(s) unpaid; only a later PASS repays them` : "- evidence debt: none",
    `- last gate: ${live.gate ? `${live.gate.status} at ${live.gate.at}` : "never run"}`,
    ...(live.integrity.ok ? [] : ["- LEDGER BROKEN: every prior verification is unproven until re-run"]),
  ];
  let text = `${LAWS.join("\n")}\n\n## Live state\n${state.join("\n")}\n`;
  let truncated = false;
  if (text.length > budget) {
    text = `${text.slice(0, budget)}\n...[truncated]\n`;
    truncated = true;
  }
  return { ok: true, chars: text.length, budget, truncated, text };
}

// ============================== sync-check ==============================

export interface SyncFinding {
  severity: "error" | "warning";
  code: "MEMORY_BEHIND_CODE" | "SPEC_WITHOUT_CHANGELOG" | "CHANGELOG_WITHOUT_SPEC";
  message: string;
  sample?: string[];
}

/**
 * Governed code and the memory ledger move in the same change, and a specification edit carries
 * its changelog entry. This decides only whether the files moved together; it cannot tell whether
 * what was written is true.
 */
export function syncCheck(root: string, changed: string[]) {
  const config = memoryConfig(root);
  const definition = catalog(root);
  const ledgerPresent = existsSync(resolve(root, config.ledger));
  const codeChanged = changed.filter((path) => {
    const entry = classifyPath(definition, path);
    return entry.classification === "mapped" || entry.classification === "overlap";
  });
  const findings: SyncFinding[] = [];
  if (ledgerPresent && codeChanged.length > 0 && !changed.includes(config.ledger)) {
    findings.push({
      severity: "error",
      code: "MEMORY_BEHIND_CODE",
      sample: codeChanged.slice(0, 5),
      message: `${codeChanged.length} governed file(s) changed but ${config.ledger} did not. Record what changed and its evidence, or the next session cannot resume from this change.`,
    });
  }
  const specs = changed.filter((path) => /(^|\/)(product-spec|spec)\.md$/i.test(path) || /^docs\/requirements\/.+\.md$/i.test(path));
  const specBodies = specs.filter((path) => !/changelog/i.test(path));
  const specLogs = changed.filter((path) => /(^|\/)(product-spec-changelog|spec-changelog)\.md$/i.test(path) || (/^docs\/requirements\//i.test(path) && /changelog/i.test(path)));
  if (specBodies.length > 0 && specLogs.length === 0) {
    findings.push({
      severity: "error",
      code: "SPEC_WITHOUT_CHANGELOG",
      sample: specBodies,
      message: "the specification changed with no changelog entry in the same change; a requirement that moved without a recorded reason is unreviewable",
    });
  }
  if (specLogs.length > 0 && specBodies.length === 0) {
    findings.push({
      severity: "warning",
      code: "CHANGELOG_WITHOUT_SPEC",
      message: "the specification changelog changed with no specification edit; confirm the entry describes something that happened",
    });
  }
  const errors = findings.filter((finding) => finding.severity === "error");
  return {
    ok: errors.length === 0,
    ledger: config.ledger,
    ledger_present: ledgerPresent,
    changed: changed.length,
    code_changed: codeChanged.length,
    ledger_in_change: changed.includes(config.ledger),
    findings,
  };
}

// ============================== archive ==============================

export function archiveLedger(root: string, apply: boolean) {
  const config = memoryConfig(root);
  const path = resolve(root, config.ledger);
  if (!existsSync(path)) return { ok: false, degraded: true, reason: `no ledger at ${config.ledger}` };
  const text = readFileSync(path, "utf8");
  const sections = parseLedger(text);
  const plan: Array<{ section: string; total: number; keep: number; moving: number }> = [];
  const moving = new Map<string, string[][]>();
  for (const [name, keep] of [["Done", config.keepDone], ["Notes", config.keepNotes]] as const) {
    const section = sectionNamed(sections, name);
    if (!section) continue;
    const entries = ledgerEntries(section);
    if (entries.length <= keep) continue;
    // Newest-first is the section contract, so the tail holds the oldest entries.
    moving.set(name, entries.slice(keep));
    plan.push({ section: name, total: entries.length, keep, moving: entries.length - keep });
  }
  const total = plan.reduce((sum, entry) => sum + entry.moving, 0);
  if (total === 0) return { ok: true, applied: false, moved: 0, plan, health: ledgerHealth(root) };
  if (!apply) return { ok: true, applied: false, moved: total, plan, health: ledgerHealth(root) };

  const stamp = new Date().toISOString().slice(0, 10);
  const archivePath = resolve(root, config.archive);
  let archive = existsSync(archivePath) ? readFileSync(archivePath, "utf8") : "";
  if (!archive) {
    archive = "# Archived project memory\n\nAppend-only. An archived entry is never rewritten; a correction is a new entry in the live ledger.\n";
  }
  archive += `\n## Archived ${stamp}\n`;
  for (const [name, entries] of moving) {
    archive += `\n### ${name}\n\n${entries.map((entry) => entry.join("\n")).join("\n")}\n`;
  }
  // Archive first, ledger second: a crash between the two leaves entries present in both files,
  // which is recoverable; the reverse order would lose them.
  writeFileSync(archivePath, archive, "utf8");

  const movedLines = new Set<string>();
  for (const entries of moving.values()) for (const entry of entries) for (const line of entry) movedLines.add(line);
  const pointer = `- Older entries are in [${config.archive}](${config.archive}).`;
  const output: string[] = [];
  let placed = false;
  for (const line of text.split("\n")) {
    if (movedLines.has(line)) {
      if (!placed) {
        output.push(pointer);
        placed = true;
      }
      continue;
    }
    output.push(line);
  }
  writeFileSync(path, output.join("\n"), "utf8");
  return { ok: true, applied: true, moved: total, plan, archive: config.archive, health: ledgerHealth(root) };
}

// ============================== CLI ==============================

export function recapCommand(options: CliOptions): void {
  const root = targetFrom(options);
  const result = recap(root, options.budget === undefined ? null : Number(options.budget));
  printJson({ command: "recap", target: root, ...result });
}

export function invariantsCommand(options: CliOptions): void {
  const root = targetFrom(options);
  const result = invariants(root, options.budget === undefined ? 1200 : Number(options.budget));
  printJson({ command: "invariants", target: root, ...result });
}

export function syncCheckCommand(options: CliOptions): void {
  const root = targetFrom(options);
  if (!gitAvailable(root) && options.paths === undefined) {
    printJson({ command: "sync-check", target: root, ok: false, degraded: true, reason: "not a git repository and no --paths were given; the change set cannot be measured" });
    process.exitCode = EXIT.DEGRADED;
    return;
  }
  const changed = options.paths === undefined
    ? changedPaths(root, gitBase(root, options.base))
    : String(options.paths).split(",").map((path) => path.trim()).filter(Boolean);
  const result = syncCheck(root, changed);
  printJson({ command: "sync-check", target: root, ...result });
  if (!result.ok) process.exitCode = EXIT.VIOLATION;
}

export function archiveCommand(options: CliOptions): void {
  const root = targetFrom(options);
  const result = archiveLedger(root, boolOption(options, "apply"));
  printJson({ command: "archive", target: root, ...result });
  if ("degraded" in result && result.degraded) process.exitCode = EXIT.DEGRADED;
}

// ============================== Feedback corpus ==============================
// Lessons are recorded as reviewable files with an occurrence count. A lesson that recurs three
// times is a rule the repository has already paid for; the scan proposes graduating it.

export const FEEDBACK_DIR_REL = "docs/feedback";

export interface FeedbackLesson {
  id: string;
  path: string;
  occurrences: number;
  graduated: boolean;
  title: string;
  errors: string[];
}

export function feedbackLessons(root: string): FeedbackLesson[] {
  const dir = resolve(root, FEEDBACK_DIR_REL);
  if (!existsSync(dir)) return [];
  const lessons: FeedbackLesson[] = [];
  for (const name of readdirSync(dir)) {
    // Lesson files are lowercase kebab-case; README and TEMPLATE are contract files, not data.
    if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(name)) continue;
    const path = resolve(dir, name);
    const errors: string[] = [];
    let fields: Record<string, string> = {};
    let title = "";
    try {
      const contents = readFileSync(path, "utf8");
      fields = parseFrontmatter(contents);
      title = (/^#\s+(.+)$/m.exec(contents)?.[1] || "").trim();
    } catch (error) {
      errors.push(errorMessage(error));
    }
    const id = name.replace(/\.md$/, "");
    if (fields.id !== id) errors.push(`frontmatter id ${JSON.stringify(fields.id || "")} must equal the filename ${id}.`);
    const occurrences = Number(fields.occurrences);
    if (!Number.isInteger(occurrences) || occurrences < 1) {
      errors.push("frontmatter occurrences must be a positive integer.");
    }
    if (fields.graduated !== "true" && fields.graduated !== "false") {
      errors.push("frontmatter graduated must be true or false.");
    }
    if (!title) errors.push("a lesson needs a # title line.");
    lessons.push({
      id,
      path: posix(relative(root, path)),
      occurrences: Number.isInteger(occurrences) ? occurrences : 0,
      graduated: fields.graduated === "true",
      title,
      errors,
    });
  }
  return lessons;
}

export function feedbackCommand(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const subcommand = positional[0] || "list";
  const lessons = feedbackLessons(root);
  if (subcommand === "lint") {
    const failures = lessons.filter((lesson) => lesson.errors.length > 0);
    const duplicates = lessons.filter(
      (lesson, index) => lessons.findIndex((other) => other.id === lesson.id) !== index,
    );
    const ok = failures.length === 0 && duplicates.length === 0;
    printJson({
      command: "feedback lint",
      target: root,
      ok,
      lessons: lessons.length,
      failures: failures.map((lesson) => ({ id: lesson.id, errors: lesson.errors })),
      duplicates: duplicates.map((lesson) => lesson.id),
      note: lessons.length === 0 ? `No corpus at ${FEEDBACK_DIR_REL}; nothing to lint.` : undefined,
    });
    if (!ok) process.exitCode = 1;
    return;
  }
  if (subcommand !== "list") throw new Error("feedback supports list or lint.");
  const candidates = lessons.filter(
    (lesson) => lesson.errors.length === 0 && lesson.occurrences >= 3 && !lesson.graduated,
  );
  printJson({
    command: "feedback list",
    target: root,
    lessons: lessons.map(({ id, occurrences, graduated, title }) => ({ id, occurrences, graduated, title })),
    graduation_candidates: candidates.map((lesson) => lesson.id),
    note:
      candidates.length > 0
        ? "A lesson that recurred three times is a rule the repository already paid for. Propose graduating it into a rule or skill, with the user's confirmation."
        : undefined,
  });
}
