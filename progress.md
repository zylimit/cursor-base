# Progress

Project memory for `cursor-base`. See [docs/PROJECT-MEMORY.md](docs/PROJECT-MEMORY.md) for the
section contract.

## Pinned

- Safety controls are non-waivable. No deadline, waiver, or instruction removes them.
- The checked-in `.cursor/runtime/harness.mjs` is compiler output. Edit `src/harness.mts` and run
  `npm run build`; hand-edited runtimes fail `npm run runtime-sync`.
- A check that could not run is `BLOCKED`, never `PASS`. Reporting a missing tool as success
  invalidates every completion claim downstream.
- Structural validation of the harness proves nothing about the host project's behavior and must
  never satisfy the completion gate.

## Decisions

- 2026-08-06 Real TypeScript with a build step, replacing hand-maintained byte-identical
  `.ts`/`.mjs` copies.
  Rejected: keeping a single `.mjs` with JSDoc — cheaper, but leaves no compiler to catch the
  class of defect found on the first `strict` run.
  Consequence: contributors need `npm install`; the runtime itself still has no dependencies, and
  installed repositories still run without a toolchain.

- 2026-08-06 Command classification parses the command line instead of matching the raw string.
  Rejected: adding more patterns to the existing deny list — the bypasses found were structural
  (global options, wrapper commands), so any pattern list stays one rewrite behind.
  Consequence: the legacy patterns are retained as a second layer and the strictest verdict wins,
  so the change can only tighten behavior.

- 2026-08-06 Credential access through a shell command is `ask`, not `deny`; sending a credential
  outward is `deny`.
  Rejected: denying every mention — blocks legitimate work such as creating `.env` from
  `.env.example`, and the goal is removing the silent path, not the path.

- 2026-08-06 An unmapped, overlapping, global, or shared-module change expands verification to
  every module.
  Rejected: the previous single conservative fallback check — it under-verifies exactly when the
  catalog has already admitted it cannot describe the blast radius.
  Consequence: an incomplete catalog is expensive to run against, which is the intended pressure.

## Done

- Real TypeScript migration: `strict` passes, compile-parity check with positive and negative
  tests, CI runs `npm ci`, `typecheck`, and `runtime-sync`.
- Semantic command classification; `git` global-option bypasses and the `checkout -- <path>`
  pattern defect closed.
- Credential gating extended to shell and MCP, including across pipelines.
- `gate`, `quality status`, verification receipts, evidence files with redaction.
- `validate` no longer records a verified diff; the completion gate consumes real receipts and
  triggers on working-tree movement rather than edit events.
- `arch-check`, `catalog lint`, `globalPaths`, `ignored` with reasons, `shared`, module `root`,
  `provides`, conservative expansion with stated reasons.
- `context-pack` budget engine.
- Cross-process state locks, atomic writes, `task` ownership with write-preflight blocking.
- `afterShellExecution`, `subagentStart`, `preCompact` hooks; observational hooks degrade while
  security hooks stay fail-closed.
- `gate-audit`, approval-tier rule, project-memory contract and skill.

## In progress

- None.

## Not doing

- A hard Stop gate that blocks on stale project memory. The repository's own rule is that a gate
  must be able to show what it caught; adding one before that evidence exists contradicts it.
- Parallel writer orchestration. Ownership is enforced, but coordinating concurrent writers needs
  worktree isolation that is not built yet, and shared-context coding is the least suitable work
  to parallelize.

## Risks

- `arch-check` resolves relative imports and `provides` prefixes. Bare specifiers with no
  `provides` entry are counted as unresolved rather than as violations, so a catalog without
  `provides` sees only part of the graph.
- Import extraction is pattern-based. It is sufficient for comparing declared to actual edges and
  is not a parser; unusual syntax reduces coverage rather than producing false violations.
- No timing measurements exist for `catalog lint` or `arch-check` on a real 400k-line repository.
  The synthetic benchmark covers path counts, not file reads.
- Hook behavior has been exercised through the harness CLI, not inside a live Cursor session.
