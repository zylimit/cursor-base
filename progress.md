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
- The quality ledger is hash-chained. State migrations must re-sign (see `rechainLedger` in the
  tests); an unsigned mutation is indistinguishable from tampering, by design.

## Decisions

- 2026-08-07 Waivers defer only checks that could not run (`MISSING`/`BLOCKED`/`SKIPPED`), bound
  to one check and one diff, with approval evidence.
  Rejected: waiving executed failures — a demonstrated defect deferred by paperwork is a false
  completion; and a global fast-mode window — it hides which evidence was skipped, while
  per-check expiring waivers give the same pressure valve auditable.
  Consequence: legacy waivers without a check/diff binding are listed but never consumed.

- 2026-08-07 Service supervision is development-time only and kills only what it started.
  Rejected: a general process manager — reclaiming unknown pids or ports crosses the safety
  boundary that requires approval for terminating processes.
  Consequence: production supervision explicitly belongs to the platform (systemd, k8s).

- 2026-08-07 A restart storm trips a breaker and stays `crashed` with the log intact.
  Rejected: unlimited backoff-restart — it converts a diagnosable fault into hidden load and the
  log rotates the original cause away.

- 2026-08-07 Risk-tier check selection is cumulative (high ⊇ medium ⊇ low) and part of the plan
  hash. Rejected: per-level exclusive lists — raising declared risk could then remove evidence.

- 2026-08-07 Lessons graduate into enforced mechanisms after three recurrences, preferring an
  executable check over rule prose. Rejected: auto-graduation without user confirmation —
  promotion changes repository policy, which is the user's to approve.

- 2026-08-07 Cross-worktree path leases stay out (with parallel writer orchestration). Ownership
  is enforced per task; advisory leases without an integration owner reintroduce the problem.

- 2026-08-06 Real TypeScript with a build step, replacing hand-maintained byte-identical
  `.ts`/`.mjs` copies.
- 2026-08-06 Command classification parses the command line instead of matching the raw string;
  legacy patterns retained as a second layer, strictest verdict wins.
- 2026-08-06 Credential access through a shell command is `ask`; sending a credential outward is
  `deny`.
- 2026-08-06 An unmapped, overlapping, global, or shared-module change expands verification to
  every module.

## Done

- 1.1.0 (2026-08-07), distilled from the cc-base/codex-base/pi-base cross-pollination review:
  - `service` supervision: backoff restart, restart-storm breaker, health probe ("alive but not
    serving" is an outage), pid-true `status`, liftoff-confirmed `start`, double-dead-confirmed
    `stop`. Verified by a lifecycle test including SIGKILL restart and breaker trip.
  - `risk` scan + sessionStart surfacing; `--strict` for CI.
  - Hash-chained ledger with anchor-carrying rotation; `quality verify` re-hashes evidence;
    broken chain fails completion closed. Legacy ledgers upgrade on the next gate run.
  - `retention` with referenced-evidence protection and `--dry-run`.
  - Waiver binding upgrade and assessment consumption; `high` attribute gaps defer only when
    every claiming check is waived; `critical` never defers.
  - `riskChecks` in the matrix driven by task risk; FAIL-streak (≥3) rewrites the reason toward
    root-cause debugging.
  - Feedback corpus + `feedback list|lint` + `record-lesson` skill; 8 seed lessons, 4 marked
    graduated because the mechanism they demand now exists.
  - Skills: `architecture-design` (seven principles → enforcement mapping), `dfx-design`
    (dimension ratings → measurable target/means/wired verification), `service-operations`.
  - Scale: glob regex cache; 600k-line/30k-file/120-module generated repo pinned in tests;
    measured `catalog lint` ~3.2s, `affected` ~60ms.
- 1.0.0 (2026-08-06): TypeScript migration, semantic command classification, credential gating,
  gate/receipts/attributes, arch-check/catalog lint/adr-check, context-pack, task ownership,
  hooks with fail-closed security events, gate-audit, project memory.

## In progress

- None.

## Not doing

- A hard Stop gate that blocks on stale project memory (a gate must show what it caught first).
- Parallel writer orchestration and cross-worktree path leases (see Decisions 2026-08-07).
- A global fast-mode bypass window (see Decisions 2026-08-07).

## Risks

- `arch-check` counts bare specifiers without `provides` as unresolved, not as violations; a
  catalog without `provides` sees only part of the graph.
- Import extraction is pattern-based; unusual syntax reduces coverage rather than producing
  false violations.
- Service supervision is exercised on Linux in tests and by design uses `taskkill` on Windows;
  the Windows path is covered by CI's windows-latest matrix, not by local runs here.
- Hook behavior has been exercised through the harness CLI and the test suite, not inside a
  live Cursor session.
- The health probe treats any 2xx/3xx as healthy; an endpoint that lies about readiness defeats
  it. Choose probe URLs that actually exercise serving behavior.
