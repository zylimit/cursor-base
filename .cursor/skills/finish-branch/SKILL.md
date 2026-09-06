---
name: finish-branch
description: Prepares a branch for human handoff by checking scope, affected verification, review binding, and remaining risk. Use when implementation is complete or before requesting merge.
---

# Finish Branch

1. Confirm **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Inspect status and the complete diff for unrelated or unsafe changes (`review-pack` shows
   deletions and renames separately).
3. Run `node scripts/harness.mjs gate`, then `quality status`: `closable` must be true. Its
   `blockers` name what is missing — a receipt, an unpaid loan, an uncovered attribute.
4. Obtain the review the effective profile demands: an approving receipt at `balanced`, the
   structured-review verdict at `strict`.
5. Record the outcome in `progress.md` (`sync-check` confirms it moved with the code) and, for a
   release, run `release readiness`.
6. Summarize merge readiness; commit and push authorized work to the tracked remote, and leave tagging and publishing to the user.

Never publish, force-push, kill ports, install dependencies, or overwrite user changes without explicit authorization.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for readiness criteria and handoff format.
