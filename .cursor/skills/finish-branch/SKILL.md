---
name: finish-branch
description: Prepares a branch for human handoff by checking scope, affected verification, review binding, and remaining risk. Use when implementation is complete or before requesting merge.
---

# Finish Branch

1. Confirm **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Inspect status and the complete diff for unrelated or unsafe changes.
3. Run affected verification and record gaps or valid quality waivers.
4. Obtain read-only review bound to base commit plus diff hash.
5. Summarize merge readiness and leave commit/push to explicit user instruction.

Never automatically commit, push, publish, kill ports, install dependencies, or overwrite user changes.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for readiness criteria and handoff format.
