// Task envelope command: owned write scope, baseline hashes, write preflight, and completion.
import { relative, resolve } from "node:path";
import { binding, changedPaths, fileHash, matchesPath, posix, printJson, sha256, targetFrom, walkFiles, withStateLock, writeJson, } from "./core.mjs";
import { assessQuality, buildVerifyPlan } from "./quality.mjs";
import { decision } from "./shell-policy.mjs";
import { TASKS_REL, activeTask, ownsPath, readTasks } from "./state.mjs";
// A task is an optional write lease. No task: only safety hooks run. With a task: writes
// outside owned paths are denied. A hash mismatch on an owned path is someone else (or a
// shell) editing underneath us — warn, adopt the new baseline, and allow, so parallel tools
// are not a deadlock. Restarting the task is not the fix.
export function preflightTaskWrite(root, rel) {
    const task = activeTask(root);
    if (!task)
        return null;
    if (!ownsPath(task, rel)) {
        return decision("deny", `Task ${task.id} is active; ${rel} is outside writable scope (${task.owned_paths.join(", ")}).`, rel);
    }
    const current = fileHash(resolve(root, rel));
    if (!Object.hasOwn(task.known_hashes, rel)) {
        if (current === null)
            return null;
        adoptOwnedHash(root, rel, current);
        return {
            permission: "allow",
            additional_context: `Owned path ${rel} existed outside the task baseline; the baseline was updated and the write is allowed. Re-read it before overlaying.`,
        };
    }
    if (current !== task.known_hashes[rel]) {
        adoptOwnedHash(root, rel, current);
        return {
            permission: "allow",
            additional_context: `${rel} changed since this task last wrote it; the baseline was updated and the write is allowed. Re-read the file before overlaying it.`,
        };
    }
    return null;
}
function adoptOwnedHash(root, rel, hash) {
    withStateLock(root, "tasks", () => {
        const state = readTasks(root);
        const task = state.tasks.find((entry) => entry.status === "active");
        if (!task || !ownsPath(task, rel))
            return;
        task.known_hashes[rel] = hash;
        writeJson(resolve(root, TASKS_REL), state);
    });
}
export function recordTaskWrite(root, rel) {
    withStateLock(root, "tasks", () => {
        const state = readTasks(root);
        const task = state.tasks.find((entry) => entry.status === "active");
        if (!task || !ownsPath(task, rel))
            return;
        task.known_hashes[rel] = fileHash(resolve(root, rel));
        writeJson(resolve(root, TASKS_REL), state);
    });
}
export function taskCommand(positional, options) {
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
        if (!options.goal)
            throw new Error("task start requires --goal.");
        if (owned.length === 0)
            throw new Error("task start requires --owned with at least one path glob.");
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
            const knownHashes = {};
            for (const absolute of walkFiles(root)) {
                const rel = posix(relative(root, absolute));
                if (matchesPath(rel, owned))
                    knownHashes[rel] = fileHash(absolute);
            }
            const task = {
                version: 1,
                id: `task-${Date.now()}-${sha256(String(options.goal)).slice(0, 8)}`,
                goal: String(options.goal),
                scope: String(options.scope || owned.join(", ")),
                out_of_scope: String(options["out-of-scope"] || ""),
                risk: risk,
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
        const completionAssessment = subcommand === "complete" ? assessQuality(root, buildVerifyPlan(root, [], options)) : null;
        return withStateLock(root, "tasks", () => {
            const state = readTasks(root);
            const task = state.tasks.find((entry) => entry.status === "active");
            if (!task)
                throw new Error("No task is active.");
            if (subcommand === "complete") {
                // Assessed above, before the lock was taken; inside the lock only state is read.
                const assessment = completionAssessment;
                // The profile's completion control says what a passing gate may close. A rapid gate may
                // close low-risk work; medium and high risk demand at least a delivery-capable profile.
                const completion = assessment.assurance.controls.completion;
                const needed = {
                    low: ["low-risk", "delivery", "release-capable"],
                    medium: ["delivery", "release-capable"],
                    high: ["delivery", "release-capable"],
                };
                const blockers = [...assessment.blockers.filter((entry) => !entry.startsWith("advisory:"))];
                if (!needed[task.risk]?.includes(completion)) {
                    blockers.push(`the ${assessment.assurance.effective} profile may close ${completion} work only; this task is ${task.risk} risk`);
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
