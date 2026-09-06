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

- 2026-09-05 The engine is split into 18 modules plus an entry point, with an acyclic import
  graph; `core` imports only Node built-ins; a test asserts both.

- 2026-09-05 The live contracts are the target's, not ours. `harness/module-catalog.json`,
  `verification-matrix.json`, and `assurance-policy.json` are excluded from distribution; a
  target's are seeded from neutral `default-*` templates and then discovered from its own tree.
  Rejected: keeping this repository's catalog as the installed template — it shipped
  `security: critical` on `src/**` and `shared: true` to every target, which is exactly the
  guessed tier `catalog discover` refuses to make.
  (Supersedes an earlier wording of this entry that carried the engine-split rejection by
  mistake; the round-3 review caught it. Decisions are append-only, so the correction is here.)

- 2026-09-05 One decision for "may this command be spawned directly": `directSpawnTarget` in
  shell-policy, shared by service supervision and check execution. Direct only for one
  resolvable program with literal arguments; a shell for anything a shell must interpret; a
  `missing` verdict only when a plain program resolves to nothing. Rejected: per-caller
  predicates — round 3 of the review showed them diverging within a day (env assignments and
  `.cmd` shims handled in one place and not the other). Rejected: keeping one 5,860-line file —
  it had outgrown navigation and made ownership of a change unreadable.
  (The last sentence belongs to the engine-split decision above and was pasted here by mistake;
  round 4 of the review caught it. It stays visible because Decisions are append-only — round 5
  caught that the round-4 correction had deleted it instead of annotating it.)

- 2026-09-05 Five floor kinds, not four: the 2026-09-05 assurance decision above names risk,
  impact, protected attributes, and governance paths; the policy also floors any other attribute
  at critical or high to `balanced` (`floors.criticalHighAttributes`). Recorded here because
  Decisions are append-only.

- 2026-09-06 Leading `NAME=value` is process env, not a reason to invoke a shell.
  `directSpawnTarget` peels those prefixes and puts them on a `direct` verdict; check
  execution and service supervision merge them into the child env. Rejected: sending the
  original string through `shell: true` — on Windows that is `cmd.exe`, which does not
  apply POSIX assignments   (`HARNESS_PROBE` is not recognized as a command). A keyword
  (`exit`) and expansion still go through the shell. Supersedes the round-3 wording that
  listed a leading assignment among the cases that require a shell.

- 2026-09-06 Node support floor raised to `>=22`; CI matrix is Node 22 and 24 (was 20 and 22).
  Node 20 enters maintenance and the maintainer runs 24; a "continuously optimized" scaffold
  tracks current runtimes rather than the oldest. `package.json` engines, the `validate` floor,
  and the `doctor` node check all move to 22. Rejected: dropping a version purely to dodge a
  flake — the two Node 20 failures that surfaced (`non-ASCII paths`, `release readiness`) were
  non-deterministic (each job failed a different test; both passed on Node 22 and locally and on
  the same commit 307fe79 earlier), so they are recorded as a risk, not hidden by the version
  change. Made possible by the repository being public: standard runners are free.

- 2026-09-06 Adopted five mechanisms from the codex-base v5 review, each the executable half of
  a lesson: `--no-renames` on all fingerprints (`changedPaths`, `diffArgumentSets`), gate
  `status_counts`/`non_pass`, a stop-hook strike bound keyed by unresolved-state hash (3 blocks
  then a recorded release that never marks complete), `release readiness --operation
  package|release`, and a guard mutation tripwire test.
  Rejected: codex's second control bundle (`targetControls`/`executionControls`) — at resolve
  time the two are byte-identical and the split is only which consumer reads which axis; our
  `complete`/`closable`/debt already carries "what shipped vs what is owed", so a second bundle
  is structure without a decision. Rejected again: spec-trace with a REQ registry (a second
  constitution), path leases without an integration owner, 48-hour loans, and guard-fault epoch
  lineage (disproportionate for a lightweight harness). See `docs/CAPABILITY-MATRIX.md`.

- 2026-09-06 One walker classifies a parsed command. `classifyParsed` applies the whole rule
  set — segment (machine, git), secret exposure, the legacy pattern net, then every recorded
  substitution — at every depth. `shellDecision` only trims and parses. Rejected: keeping
  `classifySubstitutions` as a second walk that can forget a rule (rounds 4–6 of the 2.0
  self-review each closed one forgotten path). Rejected: another review round of the same
  range — three `FIX_REQUIRED` already escalated; the defect class was the split walk, not
  a missing case list.
  Consequence: a command and `echo $(that command)` take the same permission unless quoting
  makes the inner text literal. A test locks that. The pattern net still runs on the outer
  string (quoted `rm` stays as it was) and also on each inner source so a later
  command-position narrowing cannot reopen the substitution hole.

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

- Node matrix modernized (2026-09-06, commit 392e403): CI tests Node 22 and 24 (was 20 and 22);
  `engines`, the `validate` floor, and the `doctor` node check move to `>=22`. Repository made
  public, so the regression matrix runs on free standard runners. CI green on all four jobs
  (ubuntu/windows × 22/24, run 34041063738, 13 steps each). The two Node 20 flakes are recorded
  under Risks, not hidden by the version change.
- Codex v5 lessons adopted (2026-09-06, commit 307fe79): `--no-renames` on `changedPaths` and
  `diffArgumentSets`; gate `status_counts`/`non_pass`; stop-hook strike bound (3 blocks keyed by
  unresolved-state hash, then a recorded release that never marks complete); `release readiness
  --operation package|release`; a guard mutation tripwire. Verified `node --test` 227/227, gate
  PASS 14/14, and CI green on all four matrix jobs (run 34037870782). Rejected the second control
  bundle, spec-trace, and path leases (see the 2026-09-06 Decisions entry and CAPABILITY-MATRIX).
- POSIX `NAME=value` is child env (2026-09-06): `directSpawnTarget` peels assignments and
  check/service spawn merge them. Windows CI had failed because `cmd.exe` does not apply
  them. Local `node --test` 222/222 after the fix.
- One classification walk (2026-09-06): `shellDecision` trims and parses; `classifyParsed`
  applies segments, secrets, the pattern net, and every substitution at every depth. The
  nesting-invariant test locks that a command and `echo $(that command)` take the same
  permission. Gate PASS on this change (validate through arch-check). Independent structured
  review of this slice is still required to close the task; not another self-review of 8017024.
- 2.0.0 follow-ups (2026-09-05, commits 7cd02d5..): Windows CI fixed at the root (service tree)
  kill, stop through the flag, direct spawn), blast-radius budget, nested module contracts,
  authorship hook, 1.x → 2.0 upgrade notes, range reviews, install-time catalog discovery with
  neutral templates and live contracts that are never distributed, and every error the
  structured self-review found in rounds 1 to 3 (see CHANGELOG 2.0.0 "Changed" and "Fixed").
- 2.0.0 (2026-09-05), after a line-by-line study of dsh-base and cc-base and a review of
  codex-base (`docs/CAPABILITY-MATRIX.md` records every accept/adapt/reject):
  - Engine split into 18 modules plus the entry (`docs/ARCHITECTURE.md`); parity over the whole tree.
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

- None.

## Not doing

- A hard Stop gate that blocks on stale project memory under every profile; it blocks only
  under `strict` (`memorySync: block`) and reports elsewhere.
- Parallel writer orchestration and cross-worktree path leases (see Decisions 2026-08-07).
- A global fast-mode bypass window that silences hooks (see Decisions 2026-08-07 and 2026-09-05).
- A product-development persona or nine-phase operating model; this is a governance harness.
- Automatic tag, push, publish, or deploy on green; `release readiness` reports and stops.

## Risks

- `non-ASCII paths are usable` flaked once on Node 20 (run 34040478414) while passing on Node 22,
  Node 24, and locally many times over; the cause looks like Node 20 filesystem-encoding behavior,
  and Node 20 is out of the matrix. Not reproducible on the supported runtimes; left as-is rather
  than masked with a retry. (The release-readiness flake from the same run is fixed: the CI probe
  no longer shells to `gh` without a configured remote.)
- `arch-check` counts bare specifiers without `provides` as unresolved, not as violations; a
  catalog without `provides` sees only part of the graph.
- Import extraction is pattern-based; unusual syntax reduces coverage rather than producing
  false violations.
- Service supervision is exercised on Linux in tests and by design uses `taskkill` on Windows;
  the Windows path is covered by CI's windows-latest matrix, not by local runs here.
- Hook behavior is exercised through the harness CLI and the test suite; in a live Cursor
  session the `postToolUse` re-injection was observed to fire after a compaction on 2026-09-05
  (the invariants block arrived as tool-result context), so that path is verified on the host.
  `afterFileEdit` now records authorship per `subagent_id`/`conversation_id`; whether subagent
  edits arrive with a distinct identity on this host is still unverified.
- Authorship on Cursor is a per-conversation claim, not an authenticated identity; the review
  verdict says `authorship_enforced: false` whenever it could not check.
- `catalog discover` proposes attributes from keyword signals; the proposals are evidence to
  look at, never tiers, and a codebase with unusual vocabulary will get few or none.
- On Windows a `shell: true` child's recorded pid is `cmd.exe`; killing that pid alone orphans
  the real process, and `process.kill(pid, "SIGTERM")` is `TerminateProcess`, so a supervisor
  killed that way never runs its shutdown. Services with a single-program command are now
  spawned directly, `service stop` on Windows goes through the stop flag, and anything that
  terminates a supervised child from outside kills the tree. This was the Windows-only CI
  failure from 1.1.0 (06e436f) through 2.0.0 (9748a24); the CI run for the fix is the evidence
  that the diagnosis was complete, and the test now names any leaked process in its log.
- The health probe treats any 2xx/3xx as healthy; an endpoint that lies about readiness defeats
  it. Choose probe URLs that actually exercise serving behavior.
