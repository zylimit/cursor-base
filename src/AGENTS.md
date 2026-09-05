# Runtime module

## Purpose

The harness engine: every command, hook handler, and check the repository runs. Written in
TypeScript here, compiled to `.cursor/runtime/*.mjs`, which is what hooks and installed
repositories execute. Module map and ownership: `docs/ARCHITECTURE.md`.

## Boundaries

- Node built-ins only. No dependency may be added to the runtime; the compiled output must run
  in a repository that never ran `npm install`.
- The import graph is acyclic. `core` imports nothing local; nothing imports `cli`. A new
  cross-module import goes downward (toward `core`) or the function moves.
- Never edit `.cursor/runtime/*.mjs` by hand; `npm run build` regenerates it and
  `npm run runtime-sync` fails on any difference.
- Hooks are fail-closed for security events (`beforeShellExecution`, `beforeMCPExecution`,
  `beforeReadFile`, `preToolUse`) and fail-open for observational ones; do not swap them.

## Invariants

- A check that could not run is `BLOCKED`, never `PASS`; a deferred check is `SKIPPED` with
  `deferred: true` and a debt entry.
- Security, safety, and privacy evidence is never deferred, waived, or downgraded by a profile.
- Every receipt binds base commit, canonical diff hash, and plan hash; the plan hash carries the
  module set, the risk, and the effective assurance controls.
- State files are written atomically and read-modify-writes hold the state lock.
- Nothing here commits, pushes, tags, publishes, deploys, or terminates a process it did not
  start.

## Verification

`npm run typecheck`, `npm run build`, `node scripts/harness.mjs validate --sync-only`, then
`node --test` (`tests/harness.test.mjs`, `tests/assurance.test.mjs`). Behavior changes need a
test that drives the compiled runtime through the CLI. Run `node scripts/harness.mjs gate` before
reporting the change as verified.
