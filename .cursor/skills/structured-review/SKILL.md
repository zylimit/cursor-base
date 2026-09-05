---
name: structured-review
description: Runs the staged multi-lens review whose verdict the harness computes from located findings. Use under the strict profile, for releases, or when a change touches a trust boundary.
---

# Structured Review

1. Build the evidence pack and read it, deletions first: `node scripts/harness.mjs review-pack`.
2. Open the session on the current diff: `node scripts/harness.mjs review start`. Note the
   convened lenses and why the others were excused (`review team` shows the same).
3. Blue states what was verified, with evidence, as JSON on stdin:
   `node scripts/harness.mjs review blue` ← `{"claims":[{"claim":"...","evidence":"..."}]}`.
4. Delegate one `reviewer` subagent per convened lens of the open stage, in parallel, each told
   its lens and given the pack path. Reviewers are read-only, so each returns its findings JSON
   and you submit it: `node scripts/harness.mjs review lens <lens> --agent <delegation id>` ←
   `{"findings":[...]}`. Every finding carries `severity` and a `file:line` location or a
   reproduction; the engine rejects the rest.
5. When a stage is clean the response says the next stage opened; repeat step 4 until every
   convened lens has reported, then `node scripts/harness.mjs review verdict --reviewer <name>`.
6. `FIX_REQUIRED`: fix the located errors, then re-open on the new diff. `NEEDS_MORE_EVIDENCE`:
   supply exactly what the lens named. `ACCEPT` at the final stage writes the receipt that
   completion requires.

Stop after three rejected rounds (`escalate: true`) and take the disagreement to the user.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, with the
verdict and receipt path in `Evidence`.

Lens ownership, stage rules, and input contracts: `docs/REVIEW.md`.
