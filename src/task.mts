// Task envelope command: owned write scope, baseline hashes, write preflight, and completion.

import { relative, resolve } from "node:path";
import {
  binding,
  changedPaths,
  fileHash,
  matchesPath,
  posix,
  printJson,
  sha256,
  targetFrom,
  walkFiles,
  withStateLock,
  writeJson,
} from "./core.mjs";
import type { CliOptions, HookOutput } from "./core.mjs";
import { assessQuality, buildVerifyPlan } from "./quality.mjs";
import { decision } from "./shell-policy.mjs";
import { TASKS_REL, activeTask, ownsPath, readTasks } from "./state.mjs";
import type { HarnessTask } from "./state.mjs";

// Blocking is only correct if we can tell the agent's own edits from someone else's. The
// baseline records what each owned file looked like at task start, and every accepted write
// updates it, so a mismatch means a third party changed the file underneath us.
export function preflightTaskWrite(root: string, rel: string): HookOutput | null {
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

export function recordTaskWrite(root: string, rel: string): void {
  withStateLock(root, "tasks", () => {
    const state = readTasks(root);
    const task = state.tasks.find((entry) => entry.status === "active");
    if (!task || !ownsPath(task, rel)) return;
    task.known_hashes[rel] = fileHash(resolve(root, rel));
    writeJson(resolve(root, TASKS_REL), state);
  });
}

export function taskCommand(positional: string[], options: CliOptions): void {
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
    // Plan building runs a repository-wide git diff. Doing it inside the lock could exceed the
    // stale-takeover window, at which point a concurrent writer takes the lock and both writes
    // are based on stale state.
    const completionAssessment =
      subcommand === "complete" ? assessQuality(root, buildVerifyPlan(root, [], options)) : null;
    return withStateLock(root, "tasks", () => {
      const state = readTasks(root);
      const task = state.tasks.find((entry) => entry.status === "active");
      if (!task) throw new Error("No task is active.");
      if (subcommand === "complete") {
        // Assessed above, before the lock was taken; inside the lock only state is read.
        const assessment = completionAssessment!;
        // The profile's completion control says what a passing gate may close. A rapid gate may
        // close low-risk work; medium and high risk demand at least a delivery-capable profile.
        const completion = assessment.assurance.controls.completion;
        const needed: Record<string, string[]> = {
          low: ["low-risk", "delivery", "release-capable"],
          medium: ["delivery", "release-capable"],
          high: ["delivery", "release-capable"],
        };
        const blockers = [...assessment.blockers.filter((entry) => !entry.startsWith("advisory:"))];
        if (!needed[task.risk]?.includes(completion)) {
          blockers.push(
            `the ${assessment.assurance.effective} profile may close ${completion} work only; this task is ${task.risk} risk`,
          );
        }
        if (!assessment.closable || blockers.length > 0) {
          printJson({
            command: "task complete",
            target: root,
            ok: false,
            assurance: assessment.assurance,
            blockers,
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
