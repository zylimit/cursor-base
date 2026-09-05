---
name: release-readiness
description: Assembles the proof a release depends on (clean tree, gate under strict, review, no loans or debt, memory, manifest, CI) and stops. Use before tagging, publishing, or asking for a release; never performs the release.
---

# Release Readiness

1. Run `node scripts/harness.mjs release readiness`. Every condition reports
   `PASS | FAIL | BLOCKED`; a condition that could not be evaluated is `BLOCKED`, never assumed.
2. Resolve failures at their source: commit or revert a dirty tree, run `gate` under the strict
   floor, complete or cancel open tasks, repay loans with `gate`, run the structured review.
3. Treat `BLOCKED` honestly: no upstream, no CI tooling, or no version means the proof is
   incomplete, and the report says so.
4. Hand the report to the user. Tagging, pushing, publishing, and deploying are their actions;
   `trust_boundary` in the output is false by construction.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, with
`Changed: none` and the readiness JSON summarized under `Evidence`.
