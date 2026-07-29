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

Use `node scripts/harness.mjs validate` or `node scripts/harness.mjs test` only when the repository harness is available and the check is in scope.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the verification ladder and waiver rules.
