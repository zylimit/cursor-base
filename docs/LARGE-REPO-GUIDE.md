# Large Repository Guide

The harness scales by reducing the active scope, not by loading more repository text.

## Partition the repository

Define each bounded module in `harness/module-catalog.json` with:

- stable ID and path globs;
- direct dependencies;
- owners;
- verification check IDs.

Keep the graph explicit. Generated code, vendors, caches, large snapshots, and runtime state should be excluded from indexing. Put subsystem-specific instructions in the nearest `AGENTS.md` and path-scoped `.cursor/rules/*.mdc`.

## Build a context pack

For each task, collect only:

1. the task envelope and architecture decision;
2. changed module manifests and public contracts;
3. direct callers and dependents;
4. matching tests and verification commands;
5. relevant ownership and migration constraints.

Use read-only explorers in parallel. Do not dump whole directories into the main context.

## Bound writes

Default to one writer for shared contracts, manifests, schemas, migrations, and generated outputs. Parallel writers require disjoint path ownership or isolated worktrees plus an integration owner. Split a change when its module count, file count, or risk no longer fits a reviewable unit.

## Verify by impact

Run checks in this order:

1. syntax and static checks for changed files;
2. focused module tests;
3. direct dependent contract and integration tests;
4. broader build or repository CI for cross-cutting/high-risk changes.

Hooks only calculate impact and protect safety boundaries. They must not scan all source content or run the full suite after every edit.

## Operational targets

- Keep always-applied governance short and stable.
- Keep deterministic safety hooks fast enough for interactive use.
- Bind review/test receipts to the current base commit and canonical diff hash.
- Treat stale evidence as invalid after any diff change.
- Measure false positives and hook latency; remove ineffective gates.
- Generate large synthetic fixtures during tests instead of committing them.
