---
name: code-review
description: Performs defect-first, read-only review bound to a base commit and canonical diff hash. Use for pull requests, branch diffs, patches, and pre-merge review.
---

# Code Review

1. Establish **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Bind the target to the full base commit and canonical diff hash.
3. Inspect the complete diff plus enough context to prove findings.
4. Prioritize actionable correctness, safety, security, data, compatibility, concurrency, and test gaps.
5. Invalidate the receipt when base, diff, scope, or exclusions change.

Do not edit during review or equate passing tests with correctness.

Record the outcome as a receipt: `node scripts/harness.mjs receipt --reviewer <name> --decision approve|request-changes`.
An approving receipt is what the `balanced` profile requires to close a task; under `strict`, or
whenever the change touches a trust boundary, use the [structured-review](../structured-review/SKILL.md)
skill instead, whose verdict the engine computes from lens reports.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, with `Changed: none`.

Load [REFERENCE.md](REFERENCE.md) for finding and receipt formats.
