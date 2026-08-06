# Large Repository Guide

The harness scales by reducing the active scope, not by loading more repository text.

## Partition the repository

Define each bounded module in `harness/module-catalog.json` with:

- stable ID and path globs;
- direct dependencies;
- owners;
- verification check IDs;
- optionally `provides` (import specifiers that resolve to the module), `root`, and `shared`.

Paths the catalog cannot place belong in `globalPaths` (a change fans out to everything) or in
`ignored`, which requires a written reason. `node scripts/harness.mjs catalog lint` fails while
any tracked path is unclaimed and rejects a module that claims the whole tree, because a
catch-all makes coverage look complete while proving nothing.

Keep the graph honest, not just explicit: `node scripts/harness.mjs arch-check` reads the real
import edges and fails when code crosses a boundary the catalog never declared. A stale
`dependsOn` under-reports impact, so the tests that should have run silently do not.

## Build a context pack

`node scripts/harness.mjs context-pack` assembles the pack under an explicit budget
(`contextPack` in the catalog) and writes it to disk, printing only a manifest. Inclusion order
is module summaries, then the changed files, then the canonical diff; anything that does not fit
is listed under `omitted` with a reason rather than dropped quietly. Credential paths, vendored
trees, build output, and symlinks are excluded before the budget is even considered.

Print the manifest, not the pack. A command that dumps the pack into the transcript spends the
exact context budget the pack exists to protect.

Use read-only explorers in parallel. Do not dump whole directories into the main context.

## Bound writes

Default to one writer for shared contracts, manifests, schemas, migrations, and generated outputs. Parallel writers require disjoint path ownership or isolated worktrees plus an integration owner. Split a change when its module count, file count, or risk no longer fits a reviewable unit.

`node scripts/harness.mjs task start --goal ... --owned "src/payments/**"` makes that ownership
enforceable. The task records a hash of every owned file at the moment it starts and updates it
on each accepted write, so a file edited from outside the task blocks the next agent write
instead of being silently overwritten. This is the difference between preserving user work as a
policy and preserving it as a mechanism.

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
- Measure false positives and hook latency with `node scripts/harness.mjs gate-audit`, and remove
  gates it reports as inert. A control that has never intervened is cost plus false confidence.
- Generate large synthetic fixtures during tests instead of committing them.
