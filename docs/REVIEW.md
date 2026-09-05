# Structured Review

A review loop is the one lever in this field with a large measured effect, and consensus is its
failure mode: reviewers who agree cheaply have not reviewed anything. The review engine counts
what actually happened and computes the verdict; nobody asserts it.

## Lenses and stages

Nine lenses, each owning one failure mode, grouped into three stages ordered by cost. A stage
opens only when every convened lens of the previous stage has reported without an error finding
and without declaring itself unable. A security lens is not spent on code that has not passed
correctness.

| Stage | Name | Lenses | Attribute that convenes it |
| --- | --- | --- | --- |
| 1 | code | correctness, architecture, maintainability | correctness always; the others: maintainability |
| 2 | functional | testing, performance | reliability; performance |
| 3 | trust | reliability, resilience, security, privacy | the attribute of the same name |

The effective assurance profile sets the team (`reviewLenses`); an attribute then removes a lens
when no affected module declares that attribute above `minimal`. Attributes only ever shrink the
team; risk and impact have already raised the profile before this runs. Correctness is never
removed. `review team` shows the convened lenses and why each excluded one was left out.

## Protocol

```text
node scripts/harness.mjs review-pack                       # 1. evidence pack, deletions and renames in their own sections
node scripts/harness.mjs review start                      # 2. bind the session to the current diff
node scripts/harness.mjs review blue  < claims.json        # 3. the author states what was verified, with evidence
node scripts/harness.mjs review lens correctness --agent ID < findings.json   # 4. one report per convened lens
node scripts/harness.mjs review verdict --reviewer panel   # 5. computed, never asserted
```

Input contracts (stdin JSON):

- `blue`: `{"claims": [{"claim": "...", "evidence": "command / path / exit code"}]}`. A claim
  without evidence is refused.
- `lens`: `{"findings": [{"severity": "error|warning|info", "location": "path:line", "summary": "..."}], "unable": false, "unableReason": null}`.
  A finding needs a `file:line` location or a `reproduction` someone else can run. A lens that
  cannot reach a conclusion sets `unable: true` and says exactly what it needs.

## Verdict rules

- One `error` finding anywhere → `FIX_REQUIRED`. It is never outvoted by clean lenses.
- Any lens `unable` → `NEEDS_MORE_EVIDENCE`.
- A convened lens of the open stage has not reported → the verdict is refused (exit 1), not guessed.
- Blue has not reported → refused.
- Otherwise `ACCEPT`. When every convened stage has passed the verdict is final and writes an
  approving review receipt bound to the diff, with `lenses` recorded, into
  `.cursor/harness-state/receipts/`. That receipt is what `reviewMode: structured` requires for
  completion.

The session binds `base_commit` and `diff_sha256` at `review start`. Any change to the working
tree makes it stale (exit 4): re-open the review and re-run the lenses on the new diff. Each
`FIX_REQUIRED` verdict counts a round; at `review.maxRounds` (default 3) the verdict sets
`escalate: true` and says to stop, because another round cannot tell whether the change or the
standard is wrong.

## Independence

The reviewer is never the author. `afterFileEdit` records which conversation edited which file;
`authorship record` can add identities explicitly. A lens that names its `--agent` and matches an
author of the diff cannot carry an `ACCEPT`. When no identity was recorded the verdict reports
`authorship_enforced: false` and says so, rather than pretending it checked. On this host the
recorded identity is a claim about who edited, not an authenticated one.

## Backlog

`review backlog add` records a finding deliberately left for later with `owner`, a future
`expiry`, `lens`, and `summary`. Security, safety, and privacy findings cannot be backlogged; the
backlog must not become the waiver this design refuses.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok / ACCEPT |
| 1 | invalid input, refused verdict, self-review |
| 2 | FIX_REQUIRED or NEEDS_MORE_EVIDENCE |
| 3 | degraded: nothing to review |
| 4 | stale: the tree moved since the session opened |
