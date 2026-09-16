---
name: phase-build
description: Executes one DEV-PLAN phase — tiers each task, dispatches it with business context, verifies by the profile the tier deserves, closes the phase through four steps and a four-state gate. Use to build from a plan.
---

# Phase Build

The plan says what; this skill runs it one task at a time and refuses to call a phase done on
anyone's word. **Initialisation mode**: a plan and no code — scaffold the project, install what
the plan's stack table lists (dependency installation stops for the user's approval; it is never
implied by the plan), and run phase 1. **Continuous mode**: code exists — run the next phase.

1. Write the envelope for the phase: **Goal / Scope / Out of Scope / Existing Pattern /
   Verification / Escalation**. Requires the spec and `DEV-PLAN.md`; read the design brief and
   `DESIGN.md` when the phase has UI (tokens go into the theme, never eyeballed colours); an
   existing project's own `AGENTS.md` conventions win over defaults.
2. List the phase's tasks and for each one **tier before dispatching**, mechanically, from the
   expected diff and the paths it touches (any criterion met raises the tier; unsure means the
   higher tier). This is the table in `docs/PRODUCT-WORKFLOW.md`, restated here because it is the
   step where it is used; if the two ever differ, that table is right:
   - **LOW** — under 50 lines, touches no contract, parser, authentication, migration, payment,
     or hook path, adds no dependency → `rapid`: implementer runs, orchestrator accepts against
     the diff and the runner's output; no reviewer, no tester.
   - **MEDIUM** — 50–300 lines, or one of those paths, or a new dependency → `balanced`:
     implementer, then one independent review (static gate plus spec conformance), high
     findings fixed and re-checked once, approving receipt required to close.
   - **HIGH** — over 300 lines, two or more of those paths, or a production bug, data migration,
     or security change → `strict`: implementer, structured review across every convened lens,
     and an independent tester who did not write the code.
   The profile floors still apply on top (`profile show`); a floor raised by a protected
   attribute or a governance path is the change telling you its cost.
3. Open the task and dispatch: `node scripts/harness.mjs task start --goal … --owned <paths>
   --risk low|medium|high` (the tier's lowercase risk; the engine accepts no other spelling),
   then `profile set rapid|balanced|strict --task <id>` for the profile the tier selected —
   without it the task runs under the project default, `balanced`, whatever the tier says, and a
   LOW task would still owe an approving receipt; the floors may still raise it. One task is
   active at a time: the previous task is closed with `task complete` (or `task cancel`) before
   the next `task start`, or the engine refuses. Write the pack with all seven fields — **Goal /
   Scope / Out of Scope / Existing Pattern / Business Context / Verification / Escalation** —
   copying Business Context
   from the spec (why, who benefits, the rule and exception), `progress.md` (applicable Pinned
   and Decisions, by date), recorded lessons, and `domain/` rulings that match the task; never
   `N/A` on a coding, review, or test dispatch. A LOW or MEDIUM pack fits in "file:line, change
   to what, one verify command"; a fresh implementer with a pack that quotes history instead of
   sources is guessing. Implement through `scoped-implementation`, then run the chain the tier
   requires (`code-review` or `structured-review`, `test-design`).
4. Accept against the diff and the runner's raw output, never against the implementer's report.
   New files are not proved by `git diff` (empty output and exit 0 look identical to "unchanged")
   — use `git status` (`??`), line counts, and content anchors. Reading long evidence may be
   delegated; the pass/fail judgement is not. A receipt with **Counter-examples** (code matches
   the spec, spec does not match the business) or a review marked **requirement in doubt** goes to
   `product-spec` iteration mode; **Domain findings** with evidence go to `domain-rulings`.
5. After every task, medium and low findings are recorded as residue in `progress.md` and fixed
   opportunistically by later tasks — one round converges on high findings only. Close the task
   when `quality status` reports it `closable` (`node scripts/harness.mjs task complete`), commit
   per task with the stack's compile or lint passing (`phase-N:` / `feat:` / `fix:` / `refactor:`
   / `chore:`); pushing follows the approval tier already granted.
6. Close the phase through **four steps**, each with evidence run on the spot: (1) code review
   against the phase's delivery list, including out-of-scope drift; (2) test completeness —
   the tester (not the author) covers cross-task imports, dependencies, naming consistency,
   interaction and failure paths, and every declared error, empty, and boundary state; a green
   built on a false premise or an unreachable input is not a test; (3) compile — every stack
   present, zero errors, evidence per stack; (4) functional — dev server starts clean, the new
   capability works, existing capability unbroken, core interactions driven end to end where a
   browser driver exists. Any change during the four steps restarts them; fixes commit as `fix:`.
   A multi-phase or cross-directory batch also gets one duplicate-code scan at close, with the
   numbers and the do-or-don't reason written down.
7. Gate the phase with four states — **PASS**, **CONCERNS** (proceed with a residue list),
   **FAIL** (stop and fix), **WAIVED** (reason and approver written; never for security or
   data-loss gaps — `waiver` refuses what `docs/PROTOCOLS.md` §Waiver binding lists by
   construction, the data-loss refusal is this skill's rule) — ask the user to confirm the phase,
   then move to the next one. After the last phase the chain leaves this skill: `finish-branch`
   closes the branch, `release-readiness` proves the release conditions, `release-build` performs
   only what the user authorised.

Discipline while building, detail in [REFERENCE.md](REFERENCE.md): grep every reference before
changing anything shared; migrate persisted data with the code that changes its shape; real data
and real behaviour only; the SDK's capability before a hand-rolled one; verification evidence in
the same message as the completion claim; tests and scripts that run the real app use isolated
data directories; tool output fed to a model is never truncated, only compacted; a requirement
or design change goes back to `product-spec` or `design-brief` before code moves.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**.
