---
name: affected-verification
description: Selects and executes diff- and module-focused checks, then expands by dependency risk. Use after changes, during regression verification, or when broad suites are costly.
---

# Affected Verification

1. Confirm **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Inspect the complete diff and impact map.
3. Run the nearest relevant checks first.
4. Expand to contracts, direct dependents, integrations, or repository checks according to risk.
5. Classify failures and report unrun checks honestly.

Run `node scripts/harness.mjs gate` to execute the affected plan and record diff-bound receipts,
then `node scripts/harness.mjs quality status` to confirm nothing is still missing. `validate`
checks harness structure only and is never evidence that project behavior works.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the verification ladder and waiver rules.
