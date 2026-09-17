---
name: dev-plan
description: Turns an approved spec into a phased plan ordered by value and risky unknowns, each task naming files, change, and verify command. Use after spec approval or when a spec change must be replanned.
disable-model-invocation: true
---

# Dev Plan

A plan is a sequence of independently acceptable slices, each of which compiles, runs, and
shows something — never a phase that writes a lot of code but nothing runs.

## Task

Write or revise `DEV-PLAN.md` (or the existing path). A change that fits in one sentence needs
no plan — go to `scoped-implementation`. Bounded-repo planning is `plan-change`.

## Preconditions

- Approved product spec (replay passed). Architecture, DFX, design brief, and existing code
  are constraints when they exist.
- Spec gaps found while planning are **requirement in doubt**, not requirements invented here.
- Invoke by name.

## Invariants

- Order by **value and unknowns first**. Dependencies correct that order; they are not the
  axis.
- Every task names a file path, a concrete change, and one verify command. Never "implement
  the feature", "handle errors appropriately", "similar to task N", or `TBD`.
- Every `[inferred]` / `[open]` / `[default]` core item sits in some phase's assumptions or in
  *Pre-flight*.
- Completed phases (✅) are not rewritten. A completed record never certifies a new behaviour
  — add a correction task.

## Method

1. Write the envelope. Read the open-questions table and `[inferred]` / `[default]` items
   first. Questions due before this plan must be answered or built as "meanwhile do" says.
2. Verify the stack against current documentation. Record versions, never `latest`.
3. Core value flow with only the skeleton it needs, then the phases that test the riskiest
   assumptions, then important, then supporting, then closing work. One feature at a time,
   finished.
4. Calibrate granularity: two to four items, three to eight key files. Over five items, over
   ten files, or three unrelated features → split.
5. Worst-executor standard plus **Business Context** on every task. Name the single writer and
   the integration owner for shared schemas, migrations, lockfiles, and generated files.
6. Self-check: no placeholders; one name per function across phases; every spec function has a
   task. Formal `REQ-` IDs checked both ways.

Accept: a slice a stranger could ship. Reject: a phase whose only exit is "code exists".

## Handoff

`phase-build` runs the next phase. Remind that phases with written code must be resynced —
never edit code from here.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for slicing, evidence producers, and the template.
