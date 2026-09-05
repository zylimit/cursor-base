# Progress

Project memory for `cursor-base`. See [docs/PROJECT-MEMORY.md](docs/PROJECT-MEMORY.md) for the
section contract.

## Pinned

- Safety controls are non-waivable. No deadline, waiver, or instruction removes them.
- The checked-in `.cursor/runtime/*.mjs` is compiler output. Edit `src/*.mts` and run
  `npm run build`; hand-edited runtimes fail `npm run runtime-sync`.
- Capability and assurance are separate axes. A profile, a fast loan, or a waiver never changes
  what the hooks deny or ask, and security/safety/privacy evidence is never deferred.
- Every rule in `AGENTS.md` and `.cursor/rules/` names its enforcement or says `(prompt-only)`;
  `rules-audit` must report zero phantoms.
- A check that could not run is `BLOCKED`, never `PASS`. Reporting a missing tool as success
  invalidates every completion claim downstream.
- Structural validation of the harness proves nothing about the host project's behavior and must
  never satisfy the completion gate.
- The quality ledger is hash-chained. State migrations must re-sign (see `rechainLedger` in the
  tests); an unsigned mutation is indistinguishable from tampering, by design.

## Decisions

- 2026-09-05 One assurance axis with monotonic floors, instead of separate "modes" or a fixed
  nine-phase process. `explore < rapid < balanced < strict`; eight controls; selection is a
  request, floors (risk, impact, protected attributes, governance paths) are minimums.
  Rejected: codex-base's fifteen controls (too many independent knobs for a lightweight harness)
  and dsh-base's four-gate operating model (the profile decides what a change needs; a fixed
  process is what "avoid over-complexity" excludes).
  Consequence: `balanced` is the default and requires an approving review receipt to close a
  task, as every sibling harness does; `rapid` closes low-risk work on a passing gate alone.

- 2026-09-05 Fast mode is a loan, not a waiver and not a flag. `fast on` needs a reason and a
  window (policy cap ≤ 24h); only checks pre-declared `allowFastSkip` defer; each deferral is a
  `SKIPPED (deferred)` receipt plus a debt entry; only a later PASS repays; a loaned gate is
  `complete` but never `closable`; all-deferred is `BLOCKED`. Supersedes the 2026-08-07
  rejection of a "global fast-mode window": what was rejected there (hidden skipped evidence, a
  mode that outlives its excuse) is exactly what the loan design forbids.
  Rejected: cc-base's boolean fast mode that silences hooks.

- 2026-09-05 Structured review computes the verdict; nobody asserts it. Lenses in three
  cost-ordered stages, convened by the profile and shrunk by declared attributes (correctness
  never excluded); a finding needs a location; one error is never outvoted; a silent convened
  lens refuses the verdict; three rejected rounds escalate. Authorship is best effort on Cursor
  (per conversation) and the verdict says when it was not checked.
  Rejected: a second pass by the same model as the load-bearing check.

- 2026-09-05 The impact floor is `balanced`, not `strict`. An unmapped path already fans
  verification out to every module; forcing a nine-lens review on a stray file would make the
  floor theatre. Protected attributes and governance paths stay `strict`.

- 2026-09-05 Compaction re-injection goes through `postToolUse`, because Cursor's `preCompact`
  hook is observational (only `user_message`). The note is written before compaction and the
  invariants are re-derived from files on the first tool call after it.

- 2026-09-05 Instruction files (`AGENTS.md`, rules, skills, agents, `.cursorrules`) are
  untrusted input scanned by a security-class check that is never deferrable.

- 2026-09-05 The engine is split into 16 modules with an acyclic import graph; `core` imports
  only Node built-ins. Rejected: keeping one 5,860-line file — it had outgrown navigation and
  made ownership of a change unreadable.

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

- 2.0.0 (2026-09-05), after a line-by-line study of dsh-base and cc-base and a review of
  codex-base (`docs/CAPABILITY-MATRIX.md` records every accept/adapt/reject):
  - Engine split into 16 modules (`docs/ARCHITECTURE.md`); parity over the whole tree.
  - `assurance`: profiles, controls, floors, policy compilation with hard minima, selection per
    project/task, fast loan + evidence debt, lens convening; wired into plan hash, gate,
    assessment (`closable`, `blockers`, `review`, `open_debts`), task completion, hooks, risk.
  - `review`: sessions, blue, staged lenses, verdict, receipt with lenses, rounds/escalation,
    backlog (protected findings refused), authorship, `review-pack` with deletion audit.
  - `memory`: `recap`, `invariants`, `sync-check`, `archive`; `postToolUse` re-injection.
  - `scan`: `instructions`, `skills-lint`, `agents-lint`, `rules-audit` (0 phantoms, 0
    unenforced for this repo, 59 enforced / 22 prompt-only of 81 rules; was 0 enforced of 44).
  - `catalog discover`, `release readiness`, exit-code contract, `rm` deny-pattern anchoring.
  - Governance assets rewritten: `AGENTS.md`, 8 rules (2 new), 5 new skills, `reviewer` agent
    per lens, docs (`ASSURANCE-PROFILES.md`, `REVIEW.md`, and updates), CHANGELOG, manifest.
  - Verified: `npm run typecheck`, `npm run build`, `validate` (ok), `doctor` (ok), `node --test`
    194/194, `fitness --all` clean, `manifest --check` ok, `rules-audit` ok, `instructions` ok,
    `skills-lint` ok, `agents-lint` ok (4 warnings), `catalog lint` ok, `arch-check` ok.
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

- None. 2.0.0 is implemented and verified locally; it is uncommitted and awaits the user's review
  and an independent model review (the user said other models will re-review).

## Not doing

- A hard Stop gate that blocks on stale project memory under every profile; it blocks only
  under `strict` (`memorySync: block`) and reports elsewhere.
- Parallel writer orchestration and cross-worktree path leases (see Decisions 2026-08-07).
- A global fast-mode bypass window that silences hooks (see Decisions 2026-08-07 and 2026-09-05).
- A product-development persona or nine-phase operating model; this is a governance harness.
- Automatic tag, push, publish, or deploy on green; `release readiness` reports and stops.

## Risks

- `arch-check` counts bare specifiers without `provides` as unresolved, not as violations; a
  catalog without `provides` sees only part of the graph.
- Import extraction is pattern-based; unusual syntax reduces coverage rather than producing
  false violations.
- Service supervision is exercised on Linux in tests and by design uses `taskkill` on Windows;
  the Windows path is covered by CI's windows-latest matrix, not by local runs here.
- Hook behavior has been exercised through the harness CLI and the test suite, not inside a
  live Cursor session. In particular, whether `postToolUse` fires with the payload shape assumed
  for re-injection, and whether subagent edits arrive with a distinct `conversation_id` for
  authorship, is unverified against a live host.
- Authorship on Cursor is a per-conversation claim, not an authenticated identity; the review
  verdict says `authorship_enforced: false` whenever it could not check.
- The `budget` control is resolved and reported but no blast-radius budget check consumes it yet
  (the catalog `budget` section is accepted by the schema for that purpose).
- `catalog discover` proposes attributes from keyword signals; the proposals are evidence to
  look at, never tiers, and a codebase with unusual vocabulary will get few or none.
- origin/main's CI run for HEAD (`8017024`) reports `Harness regression=failure` per `gh`; this
  pre-dates the 2.0 work and was not investigated here.
- The health probe treats any 2xx/3xx as healthy; an endpoint that lies about readiness defeats
  it. Choose probe URLs that actually exercise serving behavior.
