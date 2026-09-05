// Task state read side: the owning task and its ownership predicate, shared by quality,
// hooks, and operations without pulling the task command in.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { STATE_REL, matchesPath, readJson } from "./core.mjs";

export const TASKS_REL = `${STATE_REL}/tasks.json`;

export interface HarnessTask {
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

export interface TaskState {
  version: 1;
  tasks: HarnessTask[];
}

export function readTasks(root: string): TaskState {
  const path = resolve(root, TASKS_REL);
  if (!existsSync(path)) return { version: 1, tasks: [] };
  const value = readJson(path);
  return { version: 1, tasks: Array.isArray(value?.tasks) ? value.tasks : [] };
}

export function activeTask(root: string): HarnessTask | null {
  return readTasks(root).tasks.find((task) => task.status === "active") ?? null;
}

export function ownsPath(task: HarnessTask, rel: string): boolean {
  return matchesPath(rel, task.owned_paths);
}
