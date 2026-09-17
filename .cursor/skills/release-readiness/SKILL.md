---
name: release-readiness
description: Assembles the proof a release depends on (clean tree, gate under strict, review, no loans or debt, memory, manifest, CI) and stops. Use before tagging, publishing, or asking for a release; never performs the release.
disable-model-invocation: true
---

# Release Readiness

## Task

Report every release condition as `PASS | FAIL | BLOCKED` and stop. Tagging, pushing,
publishing, and deploying remain the user's actions.

## Preconditions

- Default `--operation release`. `--operation package` is the other subject (`release-build`
  uses it) and may emit `SKIPPED` for `worktree-clean`.
- Invoke by name. A spoken "is it ready?" may run this skill; it still performs no release.

## Invariants

- A condition that could not be evaluated is `BLOCKED`, never assumed.
- `trust_boundary` in the output is false by construction.
- For `--operation release`, a satisfied review with `independence: claimed` is FAIL
  (`review-independence`). Enforced independence is PASS. Not-required does not appear.
- This report is where the user learns `release-build` exists.

## Method

1. `node scripts/harness.mjs release readiness` (optionally `--operation package`).
2. Resolve failures at their source: commit or revert a dirty tree, `gate` under strict,
   complete or cancel open tasks, repay loans, run structured review until independence is
   enforced or the user accepts that a release cannot close.
3. Treat `BLOCKED` honestly (no upstream, no CI tooling, no version).
4. Hand the report to the user. When they authorise one action, `release-build` carries it
   out, invoked by name.

Accept: every required condition PASS or an honest BLOCKED. Reject: tagging because this
report was green; ignoring `review-independence: claimed`.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, with
`Changed: none` and the readiness JSON summarized under `Evidence`.
