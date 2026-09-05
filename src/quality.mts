// Verification: plan construction, check execution with four-state results, the hash-chained
// receipt ledger, attribute coverage, waivers, and diff-bound review receipts.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { RISK_LEVELS, TIER_ENFORCEMENT, catalog, matrix, normalizeRequirement } from "./catalog.mjs";
import type {
  AttributeEnforcement,
  AttributeTier,
  CheckDefinition,
  ModuleCatalog,
  ModuleDefinition,
  QualityAttribute,
  RiskLevel,
} from "./catalog.mjs";
import {
  STATE_REL,
  binding,
  boolOption,
  boundedText,
  canonicalJson,
  contentHash,
  errorMessage,
  gitBase,
  normalizeLf,
  posix,
  printJson,
  pruneDirectory,
  readJson,
  redactSecrets,
  sha256,
  targetFrom,
  validTimestamp,
  whichCommand,
  withStateLock,
  writeJson,
} from "./core.mjs";
import type { CliOptions, DiffBinding, OptionValue } from "./core.mjs";
import { affectedModules, requestedPaths } from "./graph.mjs";
import { parseShellCommand } from "./shell-policy.mjs";
import { activeTask } from "./state.mjs";
import {
  REVIEW_LENSES,
  assuranceForImpact,
  convenedLenses,
  isProtectedCheck,
  openDebts,
  readLoan,
  recordDebts,
  settleDebts,
} from "./assurance.mjs";
import type { ResolvedAssurance } from "./assurance.mjs";

export type SelectedCheck = CheckDefinition & { id: string; conservative?: boolean; riskSelected?: RiskLevel };

export interface VerifyPlan extends DiffBinding {
  target: string;
  paths: string[];
  unmatched_paths: string[];
  expanded_to_all: boolean;
  expansion_reasons: string[];
  modules: string[];
  /** The risk level that widened this plan, from the active task or an explicit --risk. */
  task_risk: RiskLevel | null;
  /** The assurance profile in force for this change, with every floor that raised it. */
  assurance: ResolvedAssurance;
  checks: SelectedCheck[];
  plan_sha256: string;
}

export function buildVerifyPlan(root: string, positional: string[], options: CliOptions): VerifyPlan {
  const request = requestedPaths(root, positional, options);
  const impact = affectedModules(root, request.paths, !request.explicit);
  const fullMatrix = matrix(root);
  const checks = fullMatrix.checks || {};

  // The declared risk of the work widens the plan. The levels are cumulative, so a high-risk
  // task cannot select less evidence than a medium one, and an unknown ID fails loudly instead
  // of silently verifying nothing.
  const explicitRisk = options.risk === undefined ? null : String(options.risk);
  if (explicitRisk !== null && !RISK_LEVELS.includes(explicitRisk as RiskLevel)) {
    throw new Error("--risk must be low, medium, or high.");
  }
  const taskRisk = (explicitRisk as RiskLevel | null) ?? activeTask(root)?.risk ?? null;

  // Floors are derived from the full impact closure even when the profile later narrows the
  // plan: a rapid change that reaches a payments module still resolves to strict.
  const assurance = assuranceForImpact(root, impact, taskRisk, {
    selection: options.profile === undefined ? undefined : String(options.profile),
  });
  const breadth = assurance.controls.verificationBreadth;
  const definition = catalog(root);
  const planModules: ModuleDefinition[] =
    breadth === "none"
      ? []
      : breadth === "all" || impact.expanded_to_all
        ? definition.modules
        : breadth === "direct"
          ? impact.affected.filter((module) => impact.direct.includes(module.id))
          : impact.affected;

  const selected: SelectedCheck[] = [];
  const seen = new Set<string>();
  for (const module of planModules) {
    for (const checkId of module.verification || []) {
      if (seen.has(checkId)) continue;
      if (!checks[checkId]) throw new Error(`Module ${module.id} references unknown check ${checkId}.`);
      seen.add(checkId);
      selected.push({ id: checkId, ...checks[checkId] });
    }
  }
  if (taskRisk && breadth !== "none") {
    const cumulative = RISK_LEVELS.slice(0, RISK_LEVELS.indexOf(taskRisk) + 1);
    for (const level of cumulative) {
      for (const checkId of fullMatrix.riskChecks?.[level] || []) {
        if (!checks[checkId]) {
          throw new Error(`riskChecks.${level} references unknown check ${checkId}.`);
        }
        if (seen.has(checkId)) continue;
        seen.add(checkId);
        selected.push({ id: checkId, ...checks[checkId], riskSelected: level });
      }
    }
  }
  if (impact.unmatched.length > 0 && breadth !== "none") {
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
  const modules = planModules.map((module: ModuleDefinition) => module.id);
  const bound = binding(root, options.base);
  return {
    target: root,
    paths: impact.paths,
    unmatched_paths: impact.unmatched,
    expanded_to_all: impact.expanded_to_all,
    expansion_reasons: impact.expansion_reasons,
    modules,
    task_risk: taskRisk,
    assurance,
    checks: selected,
    ...bound,
    // The plan hash lets a receipt prove which selection of checks it came from, so adding a
    // module or a check invalidates evidence gathered under the previous plan. The risk level
    // and the effective assurance controls are part of the selection, so changing either
    // invalidates receipts the same way: a PASS earned under `rapid` does not certify `strict`.
    plan_sha256: sha256(
      canonicalJson({
        modules,
        risk: taskRisk,
        assurance: assurance.assurance_sha256,
        checks: selected.map((check) => check.id),
        ...bound,
      }),
    ),
  };
}

export function verifyPlan(positional: string[], options: CliOptions): void {
  printJson(buildVerifyPlan(targetFrom(options), positional, options));
}

export const DEFAULT_CHECK_TIMEOUT_MS = 120_000;

export const SUMMARY_LIMIT = 2000;

export const QUALITY_LEDGER_REL = `${STATE_REL}/quality-ledger.json`;

export type CheckStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";

export interface VerificationReceipt {
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
  /** True when a fast loan stopped this check from running; the debt is recorded separately. */
  deferred?: boolean;
  content_sha256?: string;
  /** Hash chained over the previous entry, so deleting or editing history is detectable. */
  chain_sha256?: string;
}

export const LEDGER_GENESIS = "genesis";

export interface QualityLedgerFile {
  version: 1;
  /** Chain value carried by the last entry that rotation dropped, so trimming keeps the chain verifiable. */
  anchor: string;
  /** Chain value of the newest entry; a mismatch means the tail was rewritten. */
  head: string;
  receipts: VerificationReceipt[];
}

export function chainValue(previous: string, receipt: VerificationReceipt): string {
  return sha256(`${previous}\0${receipt.content_sha256 || ""}`);
}

/** The receipt as it was signed, before the chain field was layered on top. */
export function withoutChain(receipt: VerificationReceipt): Record<string, unknown> {
  const { chain_sha256: _chain, ...rest } = receipt as unknown as Record<string, unknown>;
  return rest;
}

export interface LedgerIntegrity {
  ok: boolean;
  /** True when the ledger predates chaining; honest state, reported rather than failed. */
  legacy: boolean;
  entries: number;
  reason: string;
}

// A plain receipt list lets one deleted FAIL resurrect an old PASS without a trace. The chain
// makes removal, edits, and truncation detectable; it is local tamper evidence, not a signature.
export function verifyLedgerChain(root: string): LedgerIntegrity {
  const path = resolve(root, QUALITY_LEDGER_REL);
  if (!existsSync(path)) return { ok: true, legacy: false, entries: 0, reason: "No ledger exists yet." };
  const value = readJson(path);
  const receipts: VerificationReceipt[] = Array.isArray(value?.receipts) ? value.receipts : [];
  if (receipts.length === 0) return { ok: true, legacy: false, entries: 0, reason: "The ledger is empty." };
  if (!value.head || receipts.some((receipt) => !receipt.chain_sha256)) {
    return {
      ok: true,
      legacy: true,
      entries: receipts.length,
      reason: "The ledger predates hash chaining; the next gate run upgrades it.",
    };
  }
  let previous = String(value.anchor || LEDGER_GENESIS);
  for (const [index, receipt] of receipts.entries()) {
    const expectedContent = contentHash(withoutChain(receipt), "content_sha256");
    if (receipt.content_sha256 !== expectedContent) {
      return {
        ok: false,
        legacy: false,
        entries: receipts.length,
        reason: `Receipt ${index} (${receipt.check_id}) does not match its own content hash; it was edited after signing.`,
      };
    }
    const expectedChain = chainValue(previous, receipt);
    if (receipt.chain_sha256 !== expectedChain) {
      return {
        ok: false,
        legacy: false,
        entries: receipts.length,
        reason: `The chain breaks at receipt ${index} (${receipt.check_id}); an entry was removed, edited, or reordered.`,
      };
    }
    previous = receipt.chain_sha256;
  }
  if (value.head !== previous) {
    return {
      ok: false,
      legacy: false,
      entries: receipts.length,
      reason: "The recorded head does not match the recomputed chain; the tail was rewritten.",
    };
  }
  return { ok: true, legacy: false, entries: receipts.length, reason: "Chain verified." };
}

// A check whose command cannot be found is BLOCKED, never PASS. Reporting a missing tool as
// success is the failure mode that makes every downstream completion claim worthless.
export function executeCheck(root: string, check: SelectedCheck, plan: VerifyPlan): VerificationReceipt {
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

  // Deferral is decided before anything runs. An executed result is a fact the ledger keeps;
  // a loan can only stop a check from starting, never rewrite what it found.
  if (deferrable(check, plan)) {
    receipt.status = "SKIPPED";
    receipt.reason = "Deferred under an open fast loan; recorded as evidence debt until a later run passes.";
    receipt.deferred = true;
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
    const [program, ...args] = parsed.segments[0].rawTokens;
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
    pruneDirectory(directory, 200);
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

/**
 * A check may be deferred only when all four hold: a loan is open, the effective profile still
 * permits loans, the project marked the check `allowFastSkip` in advance, and the check does not
 * evidence a protected attribute. Deciding what is skippable during the emergency is how
 * everything becomes skippable, so the third condition is read from the matrix, never from a flag.
 */
export function deferrable(check: SelectedCheck, plan: VerifyPlan): boolean {
  if (!check.allowFastSkip) return false;
  if (plan.assurance.controls.deferral !== "loan") return false;
  if (isProtectedCheck(check)) return false;
  return readLoan(plan.target).active;
}

export function signReceipt(receipt: VerificationReceipt): VerificationReceipt {
  receipt.content_sha256 = contentHash(receipt as unknown as Record<string, unknown>, "content_sha256");
  return receipt;
}

export function readQualityLedger(root: string): VerificationReceipt[] {
  const path = resolve(root, QUALITY_LEDGER_REL);
  if (!existsSync(path)) return [];
  const value = readJson(path);
  return Array.isArray(value?.receipts) ? value.receipts : [];
}

export function appendQualityLedger(root: string, receipts: VerificationReceipt[]): void {
  withStateLock(root, "quality-ledger", () => {
    const path = resolve(root, QUALITY_LEDGER_REL);
    const existing = existsSync(path) ? readJson(path) : {};
    const current: VerificationReceipt[] = Array.isArray(existing?.receipts) ? existing.receipts : [];
    let anchor = String(existing?.anchor || LEDGER_GENESIS);

    // A ledger written before chaining has no chain fields. Rebuilding from the anchor keeps the
    // old evidence instead of discarding it, and every entry from here on is tamper-evident.
    const needsRebuild = current.some((receipt) => !receipt.chain_sha256) || !existing?.head;
    const combined = [...current, ...receipts];
    let previous = needsRebuild ? anchor : String(existing.head || anchor);
    const chained = needsRebuild
      ? (() => {
          let running = anchor;
          return combined.map((receipt) => {
            const entry = { ...receipt, chain_sha256: chainValue(running, receipt) };
            running = entry.chain_sha256;
            return entry;
          });
        })()
      : [
          ...current,
          ...receipts.map((receipt) => {
            const entry = { ...receipt, chain_sha256: chainValue(previous, receipt) };
            previous = entry.chain_sha256;
            return entry;
          }),
        ];

    // Rotation drops the oldest entries; the anchor carries the last dropped chain value so the
    // retained tail still verifies end to end.
    const trimmed = chained.slice(-500);
    const dropped = chained.length - trimmed.length;
    if (dropped > 0) anchor = String(chained[dropped - 1].chain_sha256);

    const file: QualityLedgerFile = {
      version: 1,
      anchor,
      head: trimmed.length > 0 ? String(trimmed[trimmed.length - 1].chain_sha256) : anchor,
      receipts: trimmed,
    };
    writeJson(path, file);
  });
}

export interface AttributeCoverage {
  module: string;
  attribute: QualityAttribute;
  tier: AttributeTier;
  enforcement: AttributeEnforcement;
  covered: boolean;
  /** True when a valid waiver defers this uncovered gap; critical tiers can never be deferred. */
  deferred?: boolean;
  /** Checks in the plan that claim this attribute, and whether each currently passes. */
  evidence: Array<{ check: string; status: CheckStatus | "MISSING" }>;
  reason: string;
  /** Why this module opted out, recorded so the decision stays reviewable. */
  justification?: string;
}

export interface ReviewRequirement {
  /** From the effective profile: none, receipt, or structured (lens-covered). */
  mode: "none" | "receipt" | "structured";
  satisfied: boolean;
  /** Path of the review receipt that satisfies the requirement, when one does. */
  receipt: string | null;
  /** Lenses the profile requires and the accepting receipt did not record. */
  missing_lenses: string[];
  reason: string;
}

export interface QualityAssessment {
  /** Every selected check passed and every blocking attribute is covered. */
  complete: boolean;
  /**
   * `complete`, plus what the effective profile additionally demands before work may close:
   * the review requirement, no open evidence debt, and no loaned receipts on this diff.
   */
  closable: boolean;
  blockers: string[];
  base_commit: string;
  diff_sha256: string;
  /** The assurance profile the plan resolved to, with the floors that raised it. */
  assurance: {
    effective: string;
    requested: string;
    selection: string;
    floors: string[];
    controls: ResolvedAssurance["controls"];
  };
  review: ReviewRequirement;
  /** Evidence still owed from fast loans, whatever diff it was borrowed on. */
  open_debts: number;
  /** Ledger tamper evidence. When the chain is broken, no receipt in it can be trusted. */
  integrity: LedgerIntegrity;
  checks: Array<{
    id: string;
    required: boolean;
    acceptable: boolean;
    status: CheckStatus | "MISSING";
    /** What the evidence is tied to: the exact diff, or a time window for runtime results. */
    binding: string;
    reason: string;
    /** Set when a valid waiver defers a check that could not run. A FAIL is never waived. */
    waived?: string;
    /** Set when the newest receipt was produced by a fast loan instead of by running the check. */
    deferred?: boolean;
  }>;
  attributes: AttributeCoverage[];
}

export interface StoredWaiver {
  id: string;
  path: string;
  value: Record<string, unknown>;
  errors: string[];
}

export function readWaivers(root: string): StoredWaiver[] {
  const dir = resolve(root, STATE_REL, "waivers");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      let value: Record<string, unknown> = {};
      let errors: string[] = [];
      try {
        value = readJson(resolve(dir, name));
        errors = validateWaiver(value);
      } catch (error) {
        errors = [errorMessage(error)];
      }
      return { id: name.replace(/\.json$/, ""), path: posix(relative(root, resolve(dir, name))), value, errors };
    });
}

// A waiver defers a check that could not run. It never excuses a FAIL: an executed failing
// check is evidence of a defect, and deferring evidence is how completion claims go false.
export const WAIVABLE_STATUSES = new Set<CheckStatus | "MISSING">(["MISSING", "BLOCKED", "SKIPPED"]);

export function waiverFor(
  waivers: StoredWaiver[],
  checkId: string,
  diffSha256: string,
): StoredWaiver | null {
  return (
    waivers.find(
      (entry) =>
        entry.errors.length === 0 &&
        String(entry.value.check || "") === checkId &&
        String(entry.value.diff_sha256 || "") === diffSha256,
    ) ?? null
  );
}

/** True when any affected module holds this check's claimed attributes at critical strength. */
export function checkClaimsCritical(
  definition: ModuleCatalog,
  moduleIds: string[],
  check: SelectedCheck,
): boolean {
  const claimed = new Set(check.attributes || []);
  if (claimed.size === 0) return false;
  for (const moduleId of moduleIds) {
    const module = definition.modules.find((entry) => entry.id === moduleId);
    if (!module || !(module.verification || []).includes(check.id)) continue;
    for (const [attribute, requirement] of Object.entries(module.attributes || {})) {
      if (!claimed.has(attribute as QualityAttribute)) continue;
      if (normalizeRequirement(requirement).tier === "critical") return true;
    }
  }
  return false;
}

/** How many times the newest run of this check has failed in a row, across diffs. */
export function consecutiveFailures(ledger: VerificationReceipt[], checkId: string): number {
  let streak = 0;
  for (let index = ledger.length - 1; index >= 0; index -= 1) {
    if (ledger[index].check_id !== checkId) continue;
    if (ledger[index].status !== "FAIL") break;
    streak += 1;
  }
  return streak;
}

export const FAIL_STREAK_THRESHOLD = 3;

// Completion is decided by receipts bound to the current diff. A structural check that never
// executed the project's own verification can never satisfy this.
export function assessQuality(root: string, plan: VerifyPlan): QualityAssessment {
  // A broken chain means the ledger was edited outside the harness. Every receipt in it is
  // then unusable, because the missing entry could be the FAIL that outweighs them all.
  const integrity = verifyLedgerChain(root);
  const ledger = integrity.ok ? readQualityLedger(root) : [];
  const waivers = readWaivers(root);
  const definitionForWaivers = catalog(root);
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
      // The plan hash is enforced, not merely recorded: adding a module or a check changes which
      // checks were selected, and evidence gathered under a different selection does not carry
      // over. A runtime result is exempt because it describes a deployment, not a plan.
      (timeBound
        ? Date.now() - Date.parse(receipt.created_at) <= validityHours * 3600_000
        : receipt.diff_sha256 === plan.diff_sha256 && receipt.plan_sha256 === plan.plan_sha256),
    );
    const latest = matching[matching.length - 1];
    const binding = timeBound ? (`time-window-${validityHours}h` as const) : ("diff" as const);
    const entry: QualityAssessment["checks"][number] = !latest
      ? {
          id: check.id,
          required,
          acceptable: !required,
          status: "MISSING" as const,
          binding,
          reason: !integrity.ok
            ? `The quality ledger failed integrity verification (${integrity.reason}) Re-run the gate to rebuild trusted receipts.`
            : timeBound
              ? `No runtime result recorded in the last ${validityHours} hours.`
              : "No verification receipt exists for the current diff.",
        }
      : {
          id: check.id,
          required,
          // A check that ran and failed is never acceptable, whether or not it was required.
          // Treating an optional failure as acceptable made `gate` and `quality status` disagree
          // about the same evidence. A deferred check is acceptable for the moment — that is what
          // the loan buys — but it is marked, and `closable` refuses it until the debt is paid.
          acceptable:
            latest.status === "PASS" ||
            (latest.status === "SKIPPED" && (!required || latest.deferred === true)),
          status: latest.status,
          binding,
          reason: timeBound ? `${latest.reason} Recorded at ${latest.created_at}; not bound to the current diff.` : latest.reason,
          ...(latest.deferred ? { deferred: true } : {}),
        };

    // Repeating a failing check without new information is motion, not verification. After the
    // threshold the reason redirects to diagnosis, which is what the receipts say is missing.
    if (entry.status === "FAIL") {
      const streak = consecutiveFailures(ledger, check.id);
      if (streak >= FAIL_STREAK_THRESHOLD) {
        entry.reason +=
          ` This check has failed ${streak} consecutive runs. Stop re-running it and follow` +
          " root-cause-debugging: reproduce, isolate the first bad state, then fix.";
      }
    }

    // A deferral applies only to evidence that could not be produced. It is visible in the
    // receipt, bound to this exact diff, and structurally unable to cover a critical tier.
    if (!entry.acceptable && WAIVABLE_STATUSES.has(entry.status)) {
      const waiver = waiverFor(waivers, check.id, plan.diff_sha256);
      if (
        waiver &&
        check.class !== "security" &&
        !checkClaimsCritical(definitionForWaivers, plan.modules, check)
      ) {
        return {
          ...entry,
          acceptable: true,
          waived: waiver.id,
          reason:
            `${entry.reason} Deferred by waiver ${waiver.id} (owner ${String(waiver.value.owner)},` +
            ` expires ${String(waiver.value.expiry)}); compensation: ${String(waiver.value.compensation)}.`,
        };
      }
    }
    return entry;
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

  // A `high` gap may be deferred when every check that could evidence it holds a valid waiver.
  // `critical` never defers, and a gap with no claiming checks is a wiring defect that a waiver
  // must not paper over — the catalog or the matrix needs fixing, not an exemption.
  const waivedChecks = new Set(checks.filter((check) => check.waived).map((check) => check.id));
  for (const entry of attributes) {
    if (entry.covered || entry.enforcement !== "block" || entry.tier !== "high") continue;
    if (entry.evidence.length === 0) continue;
    if (entry.evidence.every((evidence) => waivedChecks.has(evidence.check))) {
      entry.deferred = true;
      entry.reason += " Deferred: every claiming check carries a valid waiver for this diff.";
    }
  }

  // Only the two strongest tiers close the gate. The rest stay visible without forcing a
  // prototype to meet the same bar as a payments module. Under an advisory profile even those
  // gaps only report; a protected attribute at those tiers has already raised the profile to
  // strict, so advisory never reaches security, safety, or privacy.
  const gapsBlock = plan.assurance.controls.attributeGaps === "blocking";
  const blockingGaps = attributes.filter(
    (entry) => entry.enforcement === "block" && !entry.covered && !entry.deferred,
  );
  const complete =
    integrity.ok && checks.every((check) => check.acceptable) && (!gapsBlock || blockingGaps.length === 0);

  const review = reviewRequirement(root, plan);
  const debts = openDebts(root);
  const loaned = checks.filter((check) => check.deferred);
  const blockers: string[] = [];
  if (!integrity.ok) blockers.push(`ledger integrity: ${integrity.reason}`);
  for (const check of checks) if (!check.acceptable) blockers.push(`check ${check.id} is ${check.status}`);
  if (gapsBlock) for (const gap of blockingGaps) blockers.push(`attribute ${gap.module}/${gap.attribute} (${gap.tier}) is uncovered`);
  else for (const gap of blockingGaps) blockers.push(`advisory: attribute ${gap.module}/${gap.attribute} (${gap.tier}) is uncovered`);
  if (!review.satisfied) blockers.push(`review: ${review.reason}`);
  if (debts.length > 0) blockers.push(`${debts.length} evidence debt(s) from fast loans are unpaid`);
  if (loaned.length > 0) blockers.push(`checks deferred on this diff: ${loaned.map((check) => check.id).join(", ")}`);
  if (plan.assurance.controls.completion === "forbidden") {
    blockers.push(`the ${plan.assurance.effective} profile cannot close work; select rapid or stronger`);
  }

  return {
    complete,
    closable: complete && blockers.filter((entry) => !entry.startsWith("advisory:")).length === 0,
    blockers,
    base_commit: plan.base_commit,
    diff_sha256: plan.diff_sha256,
    assurance: {
      effective: plan.assurance.effective,
      requested: plan.assurance.requested,
      selection: plan.assurance.selection,
      floors: plan.assurance.floors.map((floor) => `${floor.source} -> ${floor.profile}: ${floor.reason}`),
      controls: plan.assurance.controls,
    },
    review,
    open_debts: debts.length,
    integrity,
    checks,
    attributes,
  };
}

/** The newest valid approving review receipt bound to this exact diff, if any. */
export function acceptingReceipt(
  root: string,
  bound: DiffBinding,
): { path: string; value: ReviewReceipt } | null {
  const dir = resolve(root, STATE_REL, "receipts");
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
  for (const name of candidates) {
    let value: ReviewReceipt;
    try {
      value = readJson(resolve(dir, name));
    } catch {
      continue;
    }
    if (validateReceipt(value).length > 0) continue;
    if (value.decision !== "approve") continue;
    if (value.diff_sha256 !== bound.diff_sha256 || value.base_commit !== bound.base_commit) continue;
    return { path: posix(relative(root, resolve(dir, name))), value };
  }
  return null;
}

function reviewRequirement(root: string, plan: VerifyPlan): ReviewRequirement {
  const mode = plan.assurance.controls.reviewMode;
  if (mode === "none") {
    return { mode, satisfied: true, receipt: null, missing_lenses: [], reason: "The effective profile requires no review receipt." };
  }
  const accepting = acceptingReceipt(root, plan);
  if (!accepting) {
    return {
      mode,
      satisfied: false,
      receipt: null,
      missing_lenses: mode === "structured"
        ? convenedLenses(plan.assurance.controls, catalog(root).modules.filter((module) => plan.modules.includes(module.id))).convened
        : [],
      reason: "no approving review receipt is bound to the current diff",
    };
  }
  if (mode === "receipt") {
    return { mode, satisfied: true, receipt: accepting.path, missing_lenses: [], reason: `Approved by ${accepting.value.reviewer}.` };
  }
  const recorded = new Set(Array.isArray(accepting.value.lenses) ? (accepting.value.lenses as string[]) : []);
  const definition = catalog(root);
  const affected = definition.modules.filter((module) => plan.modules.includes(module.id));
  const missing = convenedLenses(plan.assurance.controls, affected).convened.filter((lens) => !recorded.has(lens));
  return {
    mode,
    satisfied: missing.length === 0,
    receipt: accepting.path,
    missing_lenses: missing,
    reason:
      missing.length === 0
        ? `Structured review covered ${[...recorded].sort().join(", ")}.`
        : `the approving receipt records no coverage for lens(es) ${missing.join(", ")}; a verdict reached without structured disagreement is consensus`,
  };
}

export function gate(positional: string[], options: CliOptions): void {
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
      assurance: {
        effective: plan.assurance.effective,
        requested: plan.assurance.requested,
        breadth: plan.assurance.controls.verificationBreadth,
        floors: plan.assurance.floors.map((floor) => `${floor.source} -> ${floor.profile}`),
      },
      would_execute: wanted.map((check) => ({
        id: check.id,
        class: check.class ?? "unspecified",
        attributes: check.attributes ?? [],
        command: check.command ?? "",
        would_defer: deferrable(check, plan),
        executable_available:
          parseShellCommand(String(check.command || "")).segments.length === 1
            ? whichCommand(parseShellCommand(String(check.command || "")).segments[0].rawTokens[0]) !== null
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
        plan.assurance.controls.verificationBreadth === "none"
          ? `The ${plan.assurance.effective} profile runs no verification. Select rapid or stronger before claiming anything is verified.`
          : "The verification plan selected no checks. Either nothing changed, or the catalog excludes the changed paths.",
      results: [],
    });
    process.exitCode = 2;
    return;
  }

  const receipts = wanted.map((check) => executeCheck(root, check, plan));
  appendQualityLedger(root, receipts);

  // Every deferral becomes a dated debt, and every fresh PASS repays whatever it owed. The
  // window closing repays nothing: only the evidence does.
  const deferred = receipts.filter((receipt) => receipt.deferred);
  const loan = readLoan(root);
  recordDebts(
    root,
    deferred.map((receipt) => ({
      check: receipt.check_id,
      modules: receipt.modules,
      diff_sha256: receipt.diff_sha256,
      plan_sha256: receipt.plan_sha256,
      reason: loan.loan?.reason ?? "fast loan",
    })),
  );
  const repaid = settleDebts(root, receipts);

  const everyDeferred = receipts.length > 0 && deferred.length === receipts.length;
  const status: CheckStatus = receipts.some((receipt) => receipt.status === "FAIL")
    ? "FAIL"
    : receipts.some((receipt) => receipt.status === "BLOCKED") || everyDeferred
      ? "BLOCKED"
      : "PASS";

  printJson({
    command: "gate",
    target: root,
    base_commit: plan.base_commit,
    diff_sha256: plan.diff_sha256,
    plan_sha256: plan.plan_sha256,
    modules: plan.modules,
    assurance: {
      effective: plan.assurance.effective,
      requested: plan.assurance.requested,
      breadth: plan.assurance.controls.verificationBreadth,
      floors: plan.assurance.floors.map((floor) => `${floor.source} -> ${floor.profile}`),
    },
    status,
    ...(everyDeferred
      ? { reason: "Every selected check was deferred under the fast loan; nothing ran, so nothing is proven." }
      : {}),
    ...(deferred.length > 0
      ? {
          loan: {
            reason: loan.loan?.reason ?? null,
            expires_at: loan.loan?.expires_at ?? null,
            deferred: deferred.map((receipt) => receipt.check_id),
            note: "A loaned gate cannot close a task or a release. Run the gate again with the window closed to repay the debt.",
          },
        }
      : {}),
    ...(repaid.length > 0 ? { repaid: repaid.map((entry) => `${entry.check} (${entry.id})`) } : {}),
    // Passing checks stay quiet so a green run cannot flood the agent's context with output
    // that pushes the actual task out of view.
    results: receipts.map((receipt) => ({
      id: receipt.check_id,
      status: receipt.status,
      exit_code: receipt.exit_code,
      duration_ms: receipt.duration_ms,
      evidence_path: receipt.evidence_path,
      ...(receipt.deferred ? { deferred: true } : {}),
      ...(receipt.status === "PASS" ? {} : { reason: receipt.reason, summary: receipt.summary }),
    })),
  });
  if (status !== "PASS") process.exitCode = 2;
}

export function quality(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const subcommand = positional[0] || "status";
  if (subcommand !== "status" && subcommand !== "attributes" && subcommand !== "verify") {
    throw new Error("quality supports the status, attributes, or verify subcommand.");
  }
  if (subcommand === "verify") {
    // Chain verification is cheap and runs everywhere; evidence re-hashing reads files, so it
    // lives here rather than inside every hook-time assessment.
    const integrity = verifyLedgerChain(root);
    const current = binding(root, options.base);
    const ledger = integrity.ok ? readQualityLedger(root) : [];
    const evidence = ledger
      .filter((receipt) => receipt.evidence_path)
      .map((receipt) => {
        const absolute = resolve(root, String(receipt.evidence_path));
        const currentDiff = receipt.diff_sha256 === current.diff_sha256;
        if (!existsSync(absolute)) {
          return {
            check: receipt.check_id,
            path: receipt.evidence_path,
            // Retention prunes old evidence by design; only evidence backing the current diff
            // has to still exist for its receipt to stand.
            status: currentDiff ? ("MISSING" as const) : ("PRUNED" as const),
          };
        }
        const contents = readFileSync(absolute);
        const matches =
          sha256(contents) === receipt.evidence_sha256 && contents.length === receipt.evidence_bytes;
        return {
          check: receipt.check_id,
          path: receipt.evidence_path,
          status: matches ? ("VERIFIED" as const) : ("TAMPERED" as const),
        };
      });
    const tampered = evidence.filter((entry) => entry.status === "TAMPERED");
    const missing = evidence.filter((entry) => entry.status === "MISSING");
    const ok = integrity.ok && tampered.length === 0 && missing.length === 0;
    printJson({
      command: "quality verify",
      target: root,
      ok,
      integrity,
      evidence_checked: evidence.length,
      tampered,
      missing_for_current_diff: missing,
    });
    if (!ok) process.exitCode = 1;
    return;
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

export interface ReviewReceipt extends DiffBinding {
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

export function validateReceipt(value: any): string[] {
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

export function receipt(positional: string[], options: CliOptions): void {
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
  // Lens coverage is what turns an approval into structured review evidence. Recording it by
  // hand is allowed, but the review engine is the honest source: it writes only what reported.
  const lenses = options.lenses === undefined
    ? undefined
    : String(options.lenses).split(",").map((entry) => entry.trim()).filter(Boolean);
  const { path, value } = writeReviewReceipt(root, {
    base: options.base,
    scope,
    exclusions: String(options.exclusions || "").split(",").map((entry) => entry.trim()).filter(Boolean),
    reviewer: String(options.reviewer || "unassigned"),
    decision: String(options.decision || "comment"),
    notReviewed: String(options["not-reviewed"] || ""),
    lenses,
    out: options.out === undefined ? undefined : String(options.out),
    dryRun: boolOption(options, "dry-run"),
  });
  printJson({ command: "receipt create", path, dry_run: boolOption(options, "dry-run"), receipt: value });
}

export interface ReceiptRequest {
  base?: OptionValue;
  scope: string[];
  exclusions?: string[];
  reviewer: string;
  decision: string;
  findings?: unknown[];
  notReviewed?: string;
  lenses?: string[];
  out?: string;
  dryRun?: boolean;
}

/** Writes a diff-bound review receipt; the single path every review verdict goes through. */
export function writeReviewReceipt(root: string, request: ReceiptRequest): { path: string; value: ReviewReceipt } {
  const value: ReviewReceipt = {
    version: 1,
    ...binding(root, request.base),
    scope: request.scope.length ? request.scope : ["."],
    exclusions: request.exclusions ?? [],
    reviewer: request.reviewer,
    decision: request.decision,
    findings: request.findings ?? [],
    not_reviewed: request.notReviewed ?? "",
    created_at: new Date().toISOString(),
  };
  if (request.lenses !== undefined) {
    const unknown = request.lenses.filter((lens) => !(lens in REVIEW_LENSES));
    if (unknown.length) throw new Error(`Unknown review lens(es): ${unknown.join(", ")}.`);
    value.lenses = [...new Set(request.lenses)].sort();
  }
  if (!["approve", "comment", "request-changes"].includes(value.decision)) {
    throw new Error("receipt --decision must be approve, comment, or request-changes.");
  }
  value.content_sha256 = contentHash(value, "content_sha256");
  const errors = validateReceipt(value);
  if (errors.length) throw new Error(errors.join(" "));
  const path = request.out
    ? resolve(root, request.out)
    : resolve(root, STATE_REL, "receipts", `${Date.now()}-${value.diff_sha256.slice(0, 12)}.json`);
  if (!request.dryRun) writeJson(path, value);
  return { path, value };
}

export function waiver(positional: string[], options: CliOptions): void {
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
  const checkId = String(options.check || "").trim();
  if (!checkId) throw new Error("waiver create requires --check naming the check being deferred.");
  const checks = matrix(root).checks || {};
  const definition = checks[checkId];
  if (!definition) throw new Error(`Waiver names unknown check ${checkId}; a waiver must defer something real.`);
  // Refusal happens at creation, not consumption, so an invalid waiver never sits in the state
  // directory looking like a plan.
  if (definition.class === "security") {
    throw new Error("Security-class checks cannot be waived.");
  }
  const catalogDefinition = catalog(root);
  const critical = catalogDefinition.modules.some(
    (module) =>
      (module.verification || []).includes(checkId) &&
      Object.entries(module.attributes || {}).some(
        ([attribute, requirement]) =>
          (definition.attributes || []).includes(attribute as QualityAttribute) &&
          normalizeRequirement(requirement).tier === "critical",
      ),
  );
  if (critical) {
    throw new Error(`Check ${checkId} evidences a critical-tier attribute; critical tiers cannot be waived.`);
  }
  const bound = binding(root, options.base);
  const value = {
    version: 1,
    check: checkId,
    owner: options.owner,
    reason: options.reason,
    scope: options.scope,
    expiry: options.expiry,
    compensation: options.compensation,
    /** Where the approval happened — a message, review, or ticket the owner can be held to. */
    approval: options.approval,
    base_commit: bound.base_commit,
    diff_sha256: bound.diff_sha256,
    created_at: new Date().toISOString(),
  };
  const errors = validateWaiver(value);
  if (errors.length) throw new Error(errors.join(" "));
  const id = `${Date.now()}-${sha256(`${value.owner}\0${value.scope}\0${checkId}`).slice(0, 10)}`;
  const path = resolve(dir, `${id}.json`);
  if (!boolOption(options, "dry-run")) writeJson(path, value);
  printJson({ command: "waiver create", path, dry_run: boolOption(options, "dry-run"), waiver: value });
}

export function validateWaiver(value: any): string[] {
  const errors: string[] = [];
  if (value?.version !== 1) errors.push("Waiver version must be 1.");
  for (const field of ["check", "owner", "reason", "scope", "expiry", "compensation", "approval"]) {
    if (!value?.[field] || !String(value[field]).trim()) errors.push(`Missing waiver field: ${field}.`);
  }
  // The binding is what stops one approval from silently covering every future diff. A waiver
  // without it is an opinion, not a deferral.
  if (!/^[0-9a-f]{64}$/.test(String(value?.diff_sha256 || ""))) {
    errors.push("Waiver must be bound to the canonical diff hash it defers (diff_sha256).");
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
