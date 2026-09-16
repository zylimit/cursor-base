---
name: structured-review
description: Runs the staged multi-lens review whose verdict the harness computes from located findings. Use under the strict profile, for releases, or when a change touches a trust boundary.
---

# Structured Review

1. Build the review pack and read it, deletions first: `node scripts/harness.mjs review-pack`.
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

The three passes are blue, red, judge. Blue's self-account is a target for the red lenses, never
grounds for passing anything; red defaults to disproving — boundaries, rollback, the second
platform, security corners — and "no finding" is true only after the attack was made; the judge
(the engine, from the lens reports) admits only located evidence and never a role's wording. When
the change touches this repository's own governance assets — hooks, rules, skills, agents — read
the pack's deletions section for rules removed by accident. Findings that are not defects but
"so that is how this domain works" are domain clues: route them to `domain-rulings`, do not dismiss
them as invalid. Fixes go back through the normal chain; a re-review binds the new diff and
focuses on the fix, its regression impact, and open items.

Stop after three rejected rounds (`escalate: true`) and take the disagreement to the user — the
change or the standard is wrong; nobody resets the count or votes with a fresh reviewer.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, with the
verdict and receipt path in `Evidence`.

Lens ownership, stage rules, and input contracts: `docs/REVIEW.md`.
