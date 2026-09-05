// Budgeted context packs: deny-listed, size-capped bundles written to disk with a manifest
// printed to the transcript.

import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { catalog, moduleDirectories } from "./catalog.mjs";
import type { ContextBudget, ModuleDefinition } from "./catalog.mjs";
import {
  STATE_REL,
  binding,
  boolOption,
  canonicalDiffText,
  canonicalJson,
  normalizeLf,
  posix,
  printJson,
  pruneDirectory,
  sha256,
  targetFrom,
} from "./core.mjs";
import { contextDenied } from "./core.mjs";
import type { CliOptions } from "./core.mjs";
import { affectedModules, extractImports, requestedPaths, resolveRelativeImport } from "./graph.mjs";
import { assuranceForImpact } from "./assurance.mjs";
import { activeTask } from "./state.mjs";

export const DEFAULT_CONTEXT_BUDGET: Required<ContextBudget> = {
  totalChars: 120_000,
  fileChars: 20_000,
  diffChars: 40_000,
  maxFiles: 40,
};

export interface PackEntry {
  path: string;
  priority: number;
  chars: number;
  sha256: string;
  contents: string;
  truncated: boolean;
}

export function readForContext(root: string, rel: string, limit: number): PackEntry | null {
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

export function contextPack(positional: string[], options: CliOptions): void {
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

  // The assurance profile's `contextDepth` decides how far beyond the changed files the pack
  // reaches: `changed` packs the change itself, `affected` adds the contracts of every module
  // the change reaches, `conservative` also follows the changed files' imports one hop. The
  // budget still bounds everything; depth changes what is offered to it, not its size.
  const assurance = assuranceForImpact(root, impact, activeTask(root)?.risk ?? null, {
    selection: options.profile === undefined ? undefined : String(options.profile),
  });
  const depth = assurance.controls.contextDepth;
  const depthRank = ["changed", "affected", "conservative"].indexOf(depth);
  const directIds = new Set(impact.direct);
  const contractModules = depthRank >= 1 ? impact.affected : impact.affected.filter((module) => directIds.has(module.id));

  const omitted: Array<{ path: string; reason: string }> = [];
  const candidates: PackEntry[] = [];

  // Priority 1: each module's own summary and nested contract, which is the cheapest way to
  // explain a subsystem without reading its source.
  for (const module of contractModules) {
    const base = (module.root || "").replace(/\/+$/, "");
    const roots = new Set([base || module.id, ...moduleDirectories(module)]);
    for (const directory of roots) {
      for (const name of ["MODULE-CAPSULE.md", "AGENTS.md"]) {
        const entry = readForContext(root, `${directory}/${name}`, budget.fileChars);
        if (entry && !candidates.some((existing) => existing.path === entry.path)) candidates.push({ ...entry, priority: 1 });
      }
    }
  }

  // Priority 4 (conservative only): files the changed files import, one hop, inside the
  // repository and outside the deny list. These are what a reviewer opens next.
  if (depthRank >= 2) {
    for (const path of impact.paths) {
      const absolute = resolve(root, path);
      if (contextDenied(path) || !existsSync(absolute)) continue;
      let contents: string;
      try {
        contents = readFileSync(absolute, "utf8");
      } catch {
        continue;
      }
      for (const specifier of extractImports(path, contents)) {
        if (!specifier.startsWith(".")) continue;
        const resolved = resolveRelativeImport(root, path, specifier);
        if (!resolved || contextDenied(resolved) || impact.paths.includes(resolved)) continue;
        if (candidates.some((existing) => existing.path === resolved)) continue;
        const entry = readForContext(root, resolved, budget.fileChars);
        if (entry) candidates.push({ ...entry, priority: 4 });
      }
    }
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
  pruneDirectory(directory, 50);
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
    assurance: { effective: assurance.effective, context_depth: depth },
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
