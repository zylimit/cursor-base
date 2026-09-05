// Task state read side: the owning task and its ownership predicate, shared by quality,
// hooks, and operations without pulling the task command in.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { STATE_REL, matchesPath, readJson } from "./core.mjs";
export const TASKS_REL = `${STATE_REL}/tasks.json`;
export function readTasks(root) {
    const path = resolve(root, TASKS_REL);
    if (!existsSync(path))
        return { version: 1, tasks: [] };
    const value = readJson(path);
    return { version: 1, tasks: Array.isArray(value?.tasks) ? value.tasks : [] };
}
export function activeTask(root) {
    return readTasks(root).tasks.find((task) => task.status === "active") ?? null;
}
export function ownsPath(task, rel) {
    return matchesPath(rel, task.owned_paths);
}
