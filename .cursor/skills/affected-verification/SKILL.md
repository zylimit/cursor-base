---
name: affected-verification
description: Selects and executes diff- and module-focused checks, then expands by dependency risk. Use after changes, during regression verification, or when broad suites are costly.
---

# Affected Verification

## Task

Run the smallest honest check set for this diff and report four-state results. Expand only when
dependency risk says so.

## Preconditions

- A complete diff (or named paths). Git unavailable → impact floor raises the profile; say so.
- Catalog and matrix present. Missing either is `BLOCKED`, not a skip.

## Invariants

- `validate` checks harness structure only and is never evidence that project behaviour works.
- A missing tool is `BLOCKED`. `SKIPPED` under a loan is debt. Neither is a pass.
- Security, safety, and privacy checks are never fast-skipped.

## Method

1. Confirm the envelope. Inspect the complete diff and impact map
   (`node scripts/harness.mjs affected`).
2. Read the plan before running it: `verify-plan` shows the selected checks, the effective
   profile, and every floor that widened the plan. Accept: the plan names commands. Reject:
   running a remembered suite instead of the plan.
3. Run `node scripts/harness.mjs gate`, then `quality status`. Quote exit codes and receipts
   from this turn.
4. Classify failures. A FAIL-streak of three on one check goes to `root-cause-debugging`, not
   a fourth run.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**. Unrun checks
belong under `Not verified`.

Load [REFERENCE.md](REFERENCE.md) for the verification ladder and waiver rules.
