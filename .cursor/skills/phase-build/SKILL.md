---
name: phase-build
description: Executes one DEV-PLAN phase — tiers each task, dispatches it with business context, verifies by the profile the tier deserves, closes the phase through four steps and a four-state gate. Use to build from a plan.
disable-model-invocation: true
---

# Phase Build

The plan says what; this skill runs it one task at a time and refuses to call a phase done on
anyone's word.

## Task

**Initialisation** — a plan and no code: scaffold, install only what the user approved, run
phase 1. **Continuous** — code exists: run the next phase.

## Preconditions

- Spec and `DEV-PLAN.md`. UI phases also read the design brief and `DESIGN.md` (tokens into
  the theme, never eyeballed colours).
- Dependency installation stops for approval. It is never implied by the plan.
- Invoke by name.

## Invariants

- One task is active at a time. Close or cancel before the next `task start`.
- Business Context is never `N/A` on a coding, review, or test dispatch.
- Accept against the diff and the runner's raw output, never against the implementer's report.
  New files are not proved by `git diff`.
- `WAIVED` never covers security or data loss.
- `balanced` closes a task on a passing gate. `strict` needs structured review. Do not demand
  a review receipt to close a MEDIUM task.

## Method

1. Write the envelope for the phase. List tasks and **tier before dispatching** (any criterion
   met raises it; unsure means higher). Table in `docs/PRODUCT-WORKFLOW.md` wins if this
   restatement drifts:
   - **LOW** (< 50 lines, no contract / parser / auth / migration / payment / hook path, no new
     dependency) → `rapid`.
   - **MEDIUM** (50–300 lines, or one such path, or a new dependency) → `balanced`.
   - **HIGH** (> 300 lines, two such paths, production bug, migration, security) → `strict`.
2. `task start --goal … --owned … --risk …` then `profile set rapid|balanced|strict --task
   <id>` for the profile the tier selected. Floors may still raise it. Dispatch through
   `scoped-implementation` with the seven-field pack.
3. After each task, record medium and low findings as residue. Close when `quality status`
   reports `closable`.
4. Close the phase through four steps with fresh evidence: code review against the delivery
   list; test completeness by a non-author at HIGH; compile; functional. Any change during the
   four steps restarts them.
5. Gate **PASS / CONCERNS / FAIL / WAIVED**. Ask the user to confirm the phase.

Accept: a phase a stranger can demo. Reject: calling it done on the implementer's word;
running `strict` on every LOW task "to be safe"; installing because the plan listed a package.

## Handoff

Counter-examples → `product-spec`. Domain findings → `domain-rulings`. Last phase →
`finish-branch` then `release-readiness`.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for building discipline and the four-step close.
