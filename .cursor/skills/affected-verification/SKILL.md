---
name: affected-verification
description: Selects and executes diff- and module-focused checks, then expands by dependency risk. Use after changes, during regression verification, or when broad suites are costly.
---

# Affected Verification

1. Confirm **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Inspect the complete diff and impact map (`node scripts/harness.mjs affected`).
3. Read the plan before running it: `verify-plan` shows the selected checks, the effective
   assurance profile, and every floor that widened the plan.
4. Run `node scripts/harness.mjs gate` to execute the plan and record diff-bound receipts, then
   `quality status` to confirm nothing is still missing.
5. Classify failures and report unrun checks honestly: `BLOCKED` is a missing tool, `SKIPPED`
   under a loan is debt, neither is a pass.

`validate` checks harness structure only and is never evidence that project behavior works.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the verification ladder and waiver rules.
