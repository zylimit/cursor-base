// Release readiness: every condition a release depends on, checked and reported, and nothing
// performed. Tagging, pushing, publishing, and deploying are the user's actions; this command
// assembles the proof they would want first and refuses to pretend a condition it could not
// check is satisfied. A condition it could not evaluate is BLOCKED, never PASS.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDebts, readLoan } from "./assurance.mjs";
import {
  EXIT,
  HARNESS_ROOT,
  binding,
  changedPaths,
  git,
  gitAvailable,
  gitBase,
  isHarnessSourceRoot,
  normalizeLf,
  printJson,
  run,
  targetFrom,
  whichCommand,
} from "./core.mjs";
import type { CliOptions } from "./core.mjs";
import { ledgerHealth, syncCheck } from "./memory.mjs";
import { assessQuality, buildVerifyPlan } from "./quality.mjs";
import { readTasks } from "./state.mjs";

export type ConditionStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";

export interface ReleaseCondition {
  id: string;
  status: ConditionStatus;
  detail: string;
  /** True when a failing or blocked condition alone prevents readiness. */
  required: boolean;
}

export type ReadinessOperation = "package" | "release";

export function releaseReadiness(root: string, options: CliOptions): {
  operation: ReadinessOperation;
  ready: boolean;
  conditions: ReleaseCondition[];
  trust_boundary: Record<string, false>;
  base_commit: string;
  diff_sha256: string;
} {
  // `package` binds the working tree (the artifact you would build now), so a dirty tree is
  // expected and not a blocker; `release` ships commits, so it demands a clean tree and a
  // measured position against the upstream. Everything downstream — the strict gate, review,
  // loans, debt, open tasks, manifest — is identical, because a package that cannot pass the
  // release gate is not worth building.
  const operation: ReadinessOperation = String(options.operation || "release") === "package" ? "package" : "release";
  const conditions: ReleaseCondition[] = [];
  const add = (id: string, status: ConditionStatus, detail: string, required = true) => conditions.push({ id, status, detail, required });

  if (!gitAvailable(root)) {
    add("git", "BLOCKED", "not a git repository; a release needs a commit to name");
  } else {
    const dirty = changedPaths(root, gitBase(root));
    if (operation === "package") {
      add(
        "worktree-clean",
        "SKIPPED",
        dirty.length === 0 ? "clean working tree" : `${dirty.length} uncommitted path(s); a package binds the working tree, so this is not a blocker`,
        false,
      );
    } else {
      add("worktree-clean", dirty.length === 0 ? "PASS" : "FAIL", dirty.length === 0 ? "no uncommitted or untracked changes" : `${dirty.length} path(s) differ from HEAD; a release ships commits, not a working tree`);
      const upstream = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], true);
      if (!upstream.ok) {
        add("remote-sync", "BLOCKED", "no upstream branch is configured, so divergence cannot be measured");
      } else {
        const counts = git(root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], true);
        const [ahead, behind] = counts.ok ? counts.stdout.trim().split(/\s+/).map(Number) : [NaN, NaN];
        if (!Number.isFinite(ahead) || !Number.isFinite(behind)) add("remote-sync", "BLOCKED", "git could not count divergence from the upstream");
        else if (behind > 0) add("remote-sync", "FAIL", `HEAD is ${behind} commit(s) behind ${upstream.stdout.trim()}; integrate before releasing`);
        else add("remote-sync", "PASS", ahead > 0 ? `HEAD is ${ahead} commit(s) ahead of ${upstream.stdout.trim()} and not behind (pushing is the user's action)` : `HEAD matches ${upstream.stdout.trim()}`);
      }
    }
  }

  // The gate under the release floor: `--profile strict` cannot be lowered by the selection,
  // and the plan hash carries the controls, so evidence earned under rapid does not count.
  let plan: ReturnType<typeof buildVerifyPlan> | null = null;
  try {
    plan = buildVerifyPlan(root, [], { ...options, profile: "strict" });
    const assessment = assessQuality(root, plan);
    add("gate", assessment.complete ? "PASS" : "FAIL", assessment.complete ? `every selected check passed for ${plan.diff_sha256.slice(0, 12)} under strict` : `blockers: ${assessment.blockers.filter((entry) => !entry.startsWith("review:")).slice(0, 5).join("; ") || "none listed"}`);
    add("review", assessment.review.satisfied ? "PASS" : "FAIL", assessment.review.satisfied ? assessment.review.reason : `${assessment.review.reason}${assessment.review.missing_lenses.length ? ` (missing lenses: ${assessment.review.missing_lenses.join(", ")})` : ""}`);
    if (plan.checks.length === 0) add("plan", "BLOCKED", "the verification plan selected no checks; a release with nothing to verify is not verified");
  } catch (error) {
    add("gate", "BLOCKED", `the verification plan could not be built: ${(error as Error).message}`);
  }

  const loan = readLoan(root);
  add("fast-loan", loan.active ? "FAIL" : "PASS", loan.active ? `a fast loan is open until ${loan.loan?.expires_at}; a release cannot ship on borrowed evidence` : "no fast loan is open");
  const debts = openDebts(root);
  add("evidence-debt", debts.length === 0 ? "PASS" : "FAIL", debts.length === 0 ? "no deferred evidence is outstanding" : `${debts.length} deferred check(s) were never re-run: ${[...new Set(debts.map((entry) => entry.check))].join(", ")}`);

  const openTasks = readTasks(root).tasks.filter((task) => task.status === "active");
  add("tasks-closed", openTasks.length === 0 ? "PASS" : "FAIL", openTasks.length === 0 ? "no task is still active" : `task ${openTasks.map((task) => task.id).join(", ")} is still active; close it or cancel it before releasing`);

  try {
    const health = ledgerHealth(root);
    add("memory", health.present ? "PASS" : "BLOCKED", health.present ? `${health.ledger} present (${health.bytes} bytes)` : `${health.ledger} is absent; the release cannot be described`, false);
    if (gitAvailable(root)) {
      // The base for release is the previous tag when one exists; otherwise the whole history is
      // the change set and the ledger only needs to exist.
      const lastTag = git(root, ["describe", "--tags", "--abbrev=0"], true);
      if (lastTag.ok && lastTag.stdout.trim()) {
        const since = git(root, ["diff", "--name-only", `${lastTag.stdout.trim()}..HEAD`], true);
        const sync = syncCheck(root, since.ok ? since.stdout.split("\n").filter(Boolean) : []);
        const behind = sync.findings.find((finding) => finding.code === "MEMORY_BEHIND_CODE");
        add("memory-sync", behind ? "FAIL" : "PASS", behind ? `since ${lastTag.stdout.trim()}: ${behind.message}` : `memory moved with the code since ${lastTag.stdout.trim()}`, false);
      }
    }
  } catch (error) {
    add("memory", "BLOCKED", `memory could not be read: ${(error as Error).message}`, false);
  }

  if (isHarnessSourceRoot(root) || existsSync(resolve(root, "FRAMEWORK-MANIFEST.json"))) {
    const result = run(process.execPath, [resolve(HARNESS_ROOT, "scripts/harness.mjs"), "manifest", "--check", "--target", root], root, true);
    add("manifest", result.ok ? "PASS" : "FAIL", result.ok ? "FRAMEWORK-MANIFEST.json matches the distributed files" : `manifest --check failed: ${normalizeLf(result.stdout + result.stderr).trim().slice(0, 300)}`);
  }

  const changelog = resolve(root, "CHANGELOG.md");
  if (existsSync(changelog)) {
    const text = readFileSync(changelog, "utf8");
    const version = readVersion(root);
    add("changelog", version && text.includes(version) ? "PASS" : version ? "FAIL" : "BLOCKED", version ? (text.includes(version) ? `CHANGELOG.md mentions ${version}` : `CHANGELOG.md does not mention the current version ${version}`) : "no version could be read from the manifest", false);
  }

  // CI is observed, never assumed. Without the tooling it stays BLOCKED, which is the honest
  // reading of "I could not look".
  if (gitAvailable(root)) {
    if (!whichCommand("gh")) add("ci", "BLOCKED", "gh is not installed, so the CI status of HEAD could not be read", false);
    else {
      const sha = git(root, ["rev-parse", "HEAD"], true).stdout.trim();
      const result = run("gh", ["run", "list", "--commit", sha, "--limit", "5", "--json", "status,conclusion,name"], root, true);
      if (!result.ok) add("ci", "BLOCKED", `gh could not list runs for ${sha.slice(0, 12)}: ${normalizeLf(result.stderr).trim().slice(0, 200)}`, false);
      else {
        let runs: Array<{ status: string; conclusion: string; name: string }> = [];
        try {
          runs = JSON.parse(result.stdout);
        } catch {
          runs = [];
        }
        if (runs.length === 0) add("ci", "BLOCKED", `no CI run exists for ${sha.slice(0, 12)}`, false);
        else if (runs.some((entry) => entry.status !== "completed")) add("ci", "BLOCKED", "a CI run for HEAD is still in progress", false);
        else if (runs.every((entry) => entry.conclusion === "success")) add("ci", "PASS", `${runs.length} CI run(s) succeeded for HEAD`, false);
        else add("ci", "FAIL", `CI did not succeed for HEAD: ${runs.filter((entry) => entry.conclusion !== "success").map((entry) => `${entry.name}=${entry.conclusion}`).join(", ")}`, false);
      }
    }
  }

  const bound = gitAvailable(root) ? binding(root) : { base_commit: "NO_GIT", diff_sha256: "" };
  const ready = conditions.every((condition) => condition.status === "PASS" || (!condition.required && condition.status !== "FAIL"));
  return {
    operation,
    ready,
    conditions,
    // Fields that are false by construction. A reader can verify at a glance that readiness is
    // a report about state, not an action taken on it.
    trust_boundary: { tagged: false, pushed: false, published: false, deployed: false, ci_triggered: false },
    base_commit: bound.base_commit,
    diff_sha256: bound.diff_sha256,
  };
}

function readVersion(root: string): string | null {
  for (const candidate of ["package.json", "FRAMEWORK-MANIFEST.json"]) {
    const path = resolve(root, candidate);
    if (!existsSync(path)) continue;
    try {
      const value = JSON.parse(readFileSync(path, "utf8"));
      const version = value.version ?? value.harness_version;
      if (typeof version === "string" && version) return version;
    } catch {
      continue;
    }
  }
  return null;
}

export function releaseCommand(positional: string[], options: CliOptions): void {
  const root = targetFrom(options);
  const subcommand = positional[0] || "readiness";
  if (subcommand !== "readiness") throw new Error("release supports the readiness subcommand. Tagging, pushing, and publishing are the user's actions.");
  const operationArg = positional[1] ?? options.operation;
  if (operationArg !== undefined && operationArg !== "package" && operationArg !== "release") {
    throw new Error("release readiness --operation must be package or release.");
  }
  const result = releaseReadiness(root, { ...options, operation: operationArg });
  const failing = result.conditions.filter((condition) => condition.status === "FAIL");
  const blocked = result.conditions.filter((condition) => condition.status === "BLOCKED" && condition.required);
  const unobserved = result.conditions.filter((condition) => condition.status === "BLOCKED" && !condition.required);
  printJson({
    command: `release readiness (${result.operation})`,
    target: root,
    ...result,
    note: result.ready
      ? unobserved.length
        ? `Every required condition holds; ${unobserved.length} optional condition(s) could not be evaluated (${unobserved.map((condition) => condition.id).join(", ")}), so the proof is incomplete there. Releasing is still the user's decision and action.`
        : "Every condition holds. Releasing is still the user's decision and action."
      : `${failing.length} condition(s) fail and ${blocked.length} required condition(s) could not be checked.`,
  });
  if (!result.ready) process.exitCode = failing.length > 0 ? EXIT.GATE : EXIT.DEGRADED;
}
