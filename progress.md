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
- Four avoid-overs — over-design, over-testing, over-review, over-trust (the user's standard, put
  to both siblings on 2026-09-15 and adopted here 2026-09-16): every new gate, test, review layer,
  or memory layer names what it catches; a control that never fires is removed (`gate-audit`,
  `feedback list`). Scope: all future changes to this repository and the workflow it installs.

## Decisions

- 2026-09-16 The product-development workflow of cc-base and codex-base enters as **on-demand
  skills routed by documents**, not as a persona and not as a fixed sequence. Basis: the user asked
  for both siblings' skills to be learned in full, nothing skipped; the previous rejection
  ("this is a governance harness, not a product framework") targeted a persona, a brand, and a
  nine-phase process — all still rejected — while the skills themselves are exactly the "new
  capability as an on-demand skill" the 2026-09 review preferred over always-applied text. Scope:
  nine new skills, ten upgraded ones, one path-scoped rule, `docs/PRODUCT-WORKFLOW.md`; `AGENTS.md`
  gains three lines. Supersedes: the *Not doing* entry "A product-development persona or
  nine-phase operating model" (persona and fixed process remain out; the skills are in) and the
  2026-09 CAPABILITY-MATRIX row, now marked superseded. Rejected: a Chinese-language skill set
  mirroring the siblings — the repository is English throughout and the agent speaks the user's
  language regardless.

- 2026-09-16 Task tiers select the existing profiles instead of adding a second assurance axis:
  LOW (< 50 lines, no contract / parser / auth / migration / payment / hook path, no new
  dependency) → `rapid`; MEDIUM → `balanced`; HIGH (> 300 lines, two such paths, production bug,
  migration, security) → `strict`; floors only raise. Basis: cc-base's 2026-09-15 three-chain
  table is the same decision cursor-base already makes with profiles — the tier is the mechanical
  reading of the diff that picks the profile, and the independence requirement (none / approving
  receipt from a non-author / structured review plus non-author tester) is what the profiles
  already demand. Scope: `phase-build`, `assurance-profile`, `docs/PROTOCOLS.md`. Rejected: a
  separate tier table with its own review and test rules (two axes that would drift apart).

- 2026-09-16 The dispatch pack gains a seventh field, **Business Context**, and the receipt three
  optional product fields — Business assumptions, Counter-examples, Domain findings. Basis: a fresh
  delegate has no history; both siblings found that packs without the spec's why / who / rules
  made implementers guess and that counter-examples ("code matches the spec, spec fails the
  business") need a channel that is not a defect report. Scope: product work; internal maintenance
  states its scope instead. Supersedes: the six-field envelope as the only shape (`PROTOCOLS.md`
  keeps it for non-product work). Rejected: adding the fields to the harness task JSON — the
  context is prose for a reader, not state for a machine.

- 2026-09-16 Requirement in doubt is a first-class back-flow: review, test design, debugging,
  planning, and implementation report a counter-example to `product-spec` iteration mode; nobody
  patches the code to the spec or edits the spec from a review. Basis: cc-base's downstream
  three-state exit and codex-base's correction propagation both exist to stop the agent from
  building a "correct" wrong thing. Scope: all product skills. Rejected: letting the reviewer fix
  the spec (the reviewer is never the author of the requirement either).

- 2026-09-16 Lessons graduate by two questions — already codified? real cost? — with the
  three-occurrence count kept as a hint. Basis: cc-base deleted its occurrence counter on
  2026-09-12 after 39 of 43 lessons sat at one forever; a threshold nobody maintains is a rule
  nobody applies. Scope: `record-lesson`; `feedback list` output unchanged. Supersedes the
  2026-08-07 "three recurrences" wording as the sole criterion (the count remains the candidate
  trigger). Rejected: removing occurrences from the frontmatter (the lint and the risk scan read
  it; an unused field is cheaper than a migration).

- 2026-09-16 Domain rulings live in `domain/` at the project root as a by-product, never a gate:
  four-quadrant triage by "who knew this originally?", two admission questions, three basis
  kinds, seven columns, task-level reading. Basis: cc-base's backfill trials (36 candidates: 24
  rulings, 8 mixed, 2 scope limits, 2 fact records; 8 backfilled rulings, 4 with every column
  filled) showed both why a separate carrier is needed and which columns experience forced.
  Scope: product projects with domain knowledge; the harness repository has no domain and no
  `domain/`. Rejected: a recorder subagent, a session-start load, a vector index.

- 2026-09-16 No engine change in this round. The siblings' machine checks — `spec-lint`,
  `predev-lint`, `plan-lint`, `ui-audit`, `ui-slop-scan`, `dfx check`, ADR `Revisit-if` /
  `Reversal` validation, `recap` reading the spec set — are recorded as follow-ups under TODO.
  Basis: a check named in a skill before it exists is a phantom; the methods arrive as checklists
  now and as tested code later. Scope: this task. Rejected: writing the checks in the same batch
  (the batch is already the largest governance change since 2.0; engine work gets its own
  strict task with its own tests).

- 2026-09-16 Owned files are edited through the editor tools only. Basis: a shell script that
  rewrote nine skill descriptions bypassed `afterFileEdit`, the baseline no longer matched, and
  the next tool write was refused as "changed outside this task" — the mechanism worked as
  designed and cost a task restart. Scope: any session with an owning task open. Rejected: a
  harness escape hatch to re-baseline a file (it would make the protection optional).

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

- 2026-09-07 A lock's age is read from its body when readable and from the file's mtime when
  not; an unreadable lock is held, not stale, and only a token-matched lock is released. The
  create-then-write window of `writeFileSync(..., { flag: "wx" })` let a concurrent waiter read an
  empty lock, call it infinitely old, and steal it — a lost update the concurrency test caught on
  a Windows runner right after v2.1.0 was tagged. Rejected: writing the lock body atomically via a
  temp file and rename — rename cannot give exclusive-create semantics portably, so readers must
  tolerate an empty body anyway; mtime is the honest clock for that state. Shipped as 2.1.1
  (the defect predates 2.0).

- 2026-09-06 `git push` no longer asks; a force push still does. The user decided it (the same
  decision was made in cc-base the same day: after authorization the agent executes normal git
  lifecycle actions instead of bouncing them back). Push is an approval tier, not a safety
  control, so a user instruction may waive it; rewriting remote history is destructive and stays
  on the safety floor (`--force`, `-f` ask; `--force-with-lease` passes). The engine itself still
  never pushes.
  Rejected: dropping the force-push gate too — "push" as a category was waived, destruction of
  shared history was not.

- 2026-09-06 Fast-loan window is enforced on read, not only on write: `readLoan` clamps to
  `min(opened_at, now) + maxLoanMinutes` and refuses a loan with no readable `opened_at`.
  Learned from cc-base PX-7 ("a future set_epoch once bought 30 days"). The file is a claim; the
  policy is the bound.

- 2026-09-06 Meta-tests are opt-in. The guard mutation test moved to `tests/guard-mutations.mjs`
  behind `npm run test:mutation`, per the user's rule that the release chain carries only checks
  that prove the code itself (cc-base deleted a 65-minute mutation matrix the same day). Kept
  rather than deleted: two mutants, half a second, aimed at the walker that took six review rounds.

- 2026-09-06 `npm run build` writes the manifest. The manifest hashes the compiled runtime, so
  the two cannot be allowed to drift by a forgotten command; cc-base reached for a pre-commit
  hook after failing twice in a day, this repository folds the refresh into the build instead of
  managing git hooks.

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
  → superseded 2026-09-16 (the count became a hint; two questions decide)

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

- cc-base and codex-base skill families absorbed (2026-09-16, task `task-1789546034211-45136ab7`,
  unreleased): nine new skills (`product-spec`, `design-brief`, `design-prototype`, `dev-plan`,
  `phase-build`, `test-design`, `release-build`, `domain-rulings`, `skill-authoring`) with
  references and seven templates; ten upgraded (`architecture-design` + two templates,
  `dfx-design` + template, `code-review`, `structured-review`, `root-cause-debugging`,
  `scoped-implementation`, `finish-branch`, `record-lesson`, `project-memory`,
  `assurance-profile`); rule `60-product-workflow.mdc`; `docs/PRODUCT-WORKFLOW.md`; `PROTOCOLS`
  (seventh field, receipt extras, escalation ladder, tiers), `PROJECT-MEMORY`, `LARGE-REPO-GUIDE`,
  `CAPABILITY-MATRIX` (45 rows for this round); agents `implementer`, `tester`, `reviewer`;
  `AGENTS.md` §Product work; README; manifest 85 → 114 files. Read in full: cc-base at
  `61347b1` (18 skills, references, templates, examples, 6 rules, 8 agents, CROSS-POLLINATION,
  its analysis of this repository, recent Decisions) and codex-base at the 2026-09-15 autonomy
  refactor (17 skills with references and templates, 9 agent contracts, ROLE-CONTRACTS,
  RED-BLUE-REVIEW, CROSS-POLLINATION, recent Decisions). Verified so far: `skills-lint` 26 skills
  0 findings, `rules-audit` 95 rules 0 phantoms 0 unenforced, `agents-lint` 0, `instructions` 0
  over 77 files, `validate` ok, `manifest --check` ok, `sync-check` ok; the strict gate and the
  structured review are recorded below when they run.
- 2.1.1 released (2026-09-07): state-lock lost-update race fixed (unreadable lock judged by
  mtime, never stolen; token-matched release only); `CURSOR_HARNESS_LOCK_WAIT_MS` knob; lock
  test covers empty-fresh and empty-abandoned and runs 3.7s instead of 10s. Found by the
  concurrency test on windows/Node 22 in the v2.1.0 CI run (one of eight concurrent writers lost).
- 2.1.0 released (2026-09-07): Unreleased folded into the 2.1.0 entry; `package.json`, `VERSION`,
  and the manifest's `harness_version` agree; tag `v2.1.0` on `main`. First tag in the repository
  (2.0.0 shipped untagged on 2026-09-05). Verified 230/230, gate 14/14 before tagging.
- cc-base v3 absorption (2026-09-06, commit 71107cc): `git push` no longer asks (force push
  still does), fast-loan window clamped on read, `npm run build` refreshes the manifest, guard
  mutation test opt-in (`npm run test:mutation`), two feedback lessons recorded. Studied ~40 v3
  commits; verified cursor-base already had the tier/auto-raise/single-runtime/exclusions
  mechanisms by construction, and that the public-switch scrub patterns (`proxysg`, gateway IPs,
  netentsec) appear nowhere in this repository or its history. Verified 230/230, gate 14/14, CI
  green on all four jobs (run 34043625305).
- Release-readiness CI probe gated on a remote (2026-09-06, commit b540801): a remoteless repo
  reports `ci` BLOCKED without shelling to `gh`, removing the network-latency flake vector seen on
  a Windows Node 20 runner. Verified 227/227, gate 14/14, CI green on all four jobs (run
  34041843085). The `non-ASCII paths` flake was not reproducible on the supported matrix (22/24) or
  locally and is left recorded under Risks rather than masked.
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

- 2026-09-16 Closing the absorption task `task-1789546034211-45136ab7`: all files written and
  the governance scanners clean; remaining are the strict gate (14 checks), the structured review
  (a `reviewer` delegate per convened lens; the author of this diff cannot carry the verdict),
  `task complete`, and the commit. Not pushed until the user says so.
- 2026-09-16 Review round 1's architecture and maintainability lenses returned; their findings
  are fixed in the tree, which stales the session, so the review restarts on the new diff hash.
  Fixed: the two Chinese fragments in English files; the enforcement-view DFX table reduced to the
  same thirteen dimensions (repairability folded into serviceability, reproducible build into
  installability, one spelling of normalisation); `docs/feedback/README.md` and `TEMPLATE.md`
  brought to the two-question graduation and the new lesson body; one home each for the tier
  criteria (`docs/PRODUCT-WORKFLOW.md`), the waiver refusal list and the counter-example format
  (`docs/PROTOCOLS.md`), and the fault-class routing (`test-design/REFERENCE.md`); `A11Y-n` and
  `Q-n` given the tables they were cited from; `envelope` (six fields) and `pack` (seven) defined
  once; `Risk tier` renamed where it meant something else; the interview's six segments called
  stages everywhere; the receipt written by the orchestrator, not the read-only reviewer.
- 2026-09-16 Review round 2's maintainability lens returned no errors; its five warnings and two
  info items are fixed: the tier thresholds cut from `phase-build/REFERENCE.md` so only
  `docs/PRODUCT-WORKFLOW.md` carries the numbers; the two finding-severity scales
  (`error`/`warning`/`info` for a lens, `high`/`medium`/`low` for a whole diff) given a row in
  §Tier vocabulary and the reviewer contract scoped by mode; the "nothing else is called a pack"
  absolute narrowed so `context-pack` and `review-pack` output keeps its own name; the feedback
  corpus contract given a history boundary for the ten pre-2026-09-16 lessons; the last relative
  cross-skill pointer converted; the matrix row count corrected to 45; `applied-to` de-hyphenated
  in the changelog and the matrix. Recorded as lesson
  `edit-owned-files-through-the-tracked-write-path` (occurrences 2): `sed` and `python3` edits to a
  path the active task owns do not update the task's baseline hash, so the next tracked write to
  that file is denied — twice in this session, once costing a task restart.
- 2026-09-16 Gate re-run after the round-2 fixes moved the diff: PASS under the `strict` effective
  profile, 14 of 14 checks (validate, fitness, adr-check, feedback-lint, instructions, skills-lint,
  agents-lint, rules-audit, runtime-sync, node-test, doctor, manifest-check, catalog-lint,
  arch-check), FAIL 0, BLOCKED 0, SKIPPED 0, bound to base `1bc5e38b` and diff
  `e431a27003a8c6a1cadc5294c0ed465ab024aea24391f20dabe2d0b52c21af6a`. `quality status`:
  `complete: true`, `closable: false`, one blocker — no approving review receipt on this diff.
  Decision: hold further edits until the architecture and correctness lenses return, fix their
  findings in one batch, then run one final gate and one fresh review session so all eight
  convened lenses are recorded against the same hash. Each intermediate fix stales both the
  receipts and the session, so chasing them per-finding buys nothing but re-runs.
- 2026-09-16 Review round 2's architecture lens returned one error and six warnings. Fixed in
  scope: `dfx-design` step 6 now maps the thirteen dimensions onto the catalog's eight attributes
  before declaring any (the previous wording would have produced `UNKNOWN_ATTRIBUTE` and failed
  `catalog lint`); `release-readiness` step 4 names `release-build`, which cannot be
  model-invoked, so the readiness report is where the user learns the name; rule
  `60-product-workflow.mdc` gained `spec.md` and PRD globs and its `sync-check` claim is now
  qualified to the three paths `src/memory.mts:300` actually pairs; `docs/PROJECT-MEMORY.md` is
  declared the home of the memory contract with the skill keeping the method; `phase-build`'s
  dispatch-pack restatement points at `docs/PROTOCOLS.md`; the matrix row that listed "a single
  global active task" as rejected is corrected, since `src/task.mts:81` refuses a second active
  task and `phase-build` depends on that. **Escalated, not edited:** the lens is right that
  `.cursor/rules/30-approval-tiers.mdc` reads "Release actions are never taken by the harness" as
  an absolute that the new `release-build` skill appears to violate. That file is outside this
  task's owned scope, so `release-build` was given a preamble resolving the conflict in the
  skill's own words (the engine still performs nothing; publish and deploy stay
  Stop-for-approval; the skill carries out only what the user already authorised) and the rule
  wording is put to the user as a scope extension rather than widened silently.
- 2026-09-16 The user authorised the scope extension, so `.cursor/rules/30-approval-tiers.mdc` is
  added to this task's writable paths for one edit: the release bullet now says the harness
  *engine* takes no release action and that an authorised action is carried out only through
  `release-build`, invoked by name, one approved action at a time, in the user's name. Basis: the
  absolute reading made the last link of the release chain unreachable for any agent that loads
  the always-applied rule; the narrower wording keeps publish and deploy in the
  Stop-for-approval tier, which is the control that actually matters. Scope: the one bullet; the
  tiers themselves are unchanged. Supersedes the 2026-09-16 entry above that recorded it as
  escalated-not-edited.
- 2026-09-16 Review round 2's correctness lens returned three errors, three warnings, one info;
  all verified against the engine before fixing, all fixed. Errors: `docs/feedback/README.md`
  claimed the session banner surfaces graduation candidates, but `riskScan` emits them at
  `severity: "info"` (`src/ops.mts:190`) and `sessionStart` drops `info` (`src/hooks.mts:196`), so
  it never could — now it names `risk` and says why the banner is silent; `gate-audit` was said
  to *retire* idle gates twice in `dfx-design/REFERENCE.md`, but `gateAudit` (`src/ops.mts:348`)
  iterates the twelve hook events, writes nothing, and cannot see matrix checks at all — both rows
  now say it names hook gates that never intervened and that removal is a human decision, and
  `AGENTS.md` §Product work is tightened the same way; the DFX tables mapped dimension 9
  (testability) to `reliability` in one and `maintainability` in the other — now `maintainability`
  (supporting) in both. Warnings: "risk tier" used for the exposure class in `product-spec`
  `SKILL.md`, `REFERENCE.md`, and the matrix row; the `tester` agent description was 305
  characters against the 220 standard that `agents-lint` does not enforce for agent files (it
  only inspects `AGENTS.md` contracts), now 219. Info, and outside this change: both
  `harness-doctor` files stated a Node 20 floor while the engine requires 22
  (`src/install.mts:585`, `doctor`'s `major >= 22`, `package.json` `>=22`) — a diagnosis on Node 20
  would have reported healthy and then failed `doctor`. Fixed deliberately and declared here
  rather than left as a known-false claim in an owned skill; it is the only edit in this diff that
  predates the absorption work.
- 2026-09-16 The user chose to commit and push the absorption now and finish the structured
  review afterwards, so the task stays open and `task complete` is not attempted. What the commit
  carries: a PASS gate, 14 of 14 checks under the `strict` effective profile, bound to its own
  diff; seven clean governance scanners; three rounds of lens findings (architecture,
  correctness, maintainability) verified against engine source and fixed. **What is owed:** the
  structured review is incomplete — stage 1's three lenses were re-dispatched and had not
  reported when the commit was made, and stage 2 (`testing`) and stage 3 (`reliability`,
  `resilience`, `security`, `privacy`) have never run on this change at all. There is no
  approving review receipt, so `quality status` stays `closable: false` and this work is not
  release-capable until the review completes. Basis for committing anyway: the change is
  governance assets and documentation with no engine source, the machine-checkable evidence is
  green, and the remaining lenses mostly examine attributes this diff cannot move. Rejected:
  lowering the profile to make the block disappear — `strict` is floored by the governance paths
  and a floor is not an opinion.
- 2026-09-16 Two process costs from this session, recorded because the repository's own rule is
  that a control which never fires gets questioned. First, `gate` ran five times at about a
  minute each, because each fix round ended a turn and the stop hook asked for a fresh receipt;
  batching the fixes and gating once is the cheaper order and is the orchestrator's job, not the
  protocol's requirement. Second, and structural: this change touches no engine code, but
  `FRAMEWORK-MANIFEST.json` is a global path, so the impact closure covers all four modules and
  convenes the four trust lenses (`security`, `privacy`, `reliability`, `resilience`) to review a
  documentation diff. See the TODO below.

## TODO

- [P1] `skills-lint` parses the front matter as YAML, or at least refuses an unquoted
  `description` containing `: ` or starting with a YAML structural character: six skills in the
  2026-09-16 batch (phase-build, design-brief, domain-rulings, code-review, finish-branch,
  root-cause-debugging) had their descriptions dropped by the host loader while the lint, which
  splits at the first colon, reported zero findings — the correctness lens of the structured
  review caught it, not the lint. Regression test: a description with `: ` must fail.
- [P1] Engine follow-ups from the 2026-09-16 absorption, each its own strict task with tests:
  `adr-check` reads `Revisit-if` (a date-only value warns) and `Reversal` (missing warns; "one-way
  door" is listed); a `plan-lint` that checks `DEV-PLAN.md` for placeholders, the mandatory
  section anchors, and `REQ-` coverage both ways against a formal spec; a `spec-lint` for the
  spec's mandatory sections, marker discipline, and the five-column open-questions table; `recap`
  surfacing the presence of `Product-Spec.md`, its changelog, and `DEV-PLAN.md` for product
  projects; a static UI cliché scan over `demo/` and `DESIGN.md`'s hard-constraints table.
- [P1] Finish the deferred structured review of the 2026-09-16 absorption: re-bind to the
  committed base, run stage 1 (`architecture`, `correctness`, `maintainability`), then stage 2
  (`testing`) and stage 3 (`reliability`, `resilience`, `security`, `privacy`), and record the
  verdict. Until then there is no approving receipt on this work and the task cannot close.
- [P2] Decide whether a diff that changes no engine source should have its impact fanned out to
  every module by `FRAMEWORK-MANIFEST.json` alone. The manifest is correctly a global path — it
  describes every asset — but the consequence is that a documentation-only change convenes the
  four trust lenses, which is the `gate-audit` question asked of the review layer instead: name
  what those lenses catch on such a diff, or let the manifest fan out to verification breadth
  without convening the trust stage. Evidence when deciding: whether any trust lens has ever
  raised a finding on a docs-only change.
- [P2] Five `SKILL.md` files from the 2026-09-16 batch (architecture-design 7.5KB, dfx-design,
  phase-build, domain-rulings, product-spec, each 6–7KB) run three to five times the size of the
  house pattern (`affected-verification`, `fast-lane`, 1–2KB), well under the 24KB loader limit
  but against progressive disclosure; both the architecture and the maintainability lens flagged
  it. Sink the explanatory paragraphs into each `REFERENCE.md` and leave numbered steps — after
  the workflow has run once, so the trimming is guided by which lines were actually used.
- [P2] A user guide (install → first project → requirements and design → build → review, test,
  fix → release → memory → gates and profiles) once the workflow has run on a real project, so it
  documents behaviour rather than intention.
- [P2] Run the product workflow end to end on one real project and record what the tiers, the
  dispatch pack, and the four-step close feel like in practice; adjust the skills from that
  evidence, not from more reading.
- [P1] `archive` learns to move the oldest `Decisions` whole once the section passes a cap
  (cc-base archives past 30 with a one-line pointer), or the byte budget is raised in the
  catalog's `memory` block: the ledger is over its 24KB byte budget (33KB) while under its
  entry cap, because `Decisions` alone is 18KB and append-only; `recap` stays within its own
  6,000-character budget, so recovery cost is bounded — the file budget is the maintenance signal.

## Not doing

- A hard Stop gate that blocks on stale project memory under every profile; it blocks only
  under `strict` (`memorySync: block`) and reports elsewhere.
- Parallel writer orchestration and cross-worktree path leases (see Decisions 2026-08-07).
- A global fast-mode bypass window that silences hooks (see Decisions 2026-08-07 and 2026-09-05).
- A product-development persona or nine-phase operating model; this is a governance harness.
  → superseded 2026-09-16 in part: the persona, the brand, and the fixed sequence stay out; the
  workflow's skills are in as document-routed on-demand skills (Decisions 2026-09-16).
- A product-development persona, an initialisation banner, or a fixed stage sequence the agent
  walks regardless of the documents (2026-09-16).
- Provider-specific generator services, hosted design studios, or workflow-scripting APIs the
  host does not offer; the methods are kept, the tools are not (2026-09-16).
- Recorder, observer, runner, or deployer subagents; the orchestrator writes memory, lessons, and
  rulings itself, and no role holds a release authorisation (2026-09-16).
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
