---
id: completion-claims-need-fresh-verification
occurrences: 3
first_seen: 2026-08-07
last_seen: 2026-08-07
graduated: true
---

# A completion claim needs a check that ran in this session, on this diff

Sessions across multiple harnesses reported "done, tests pass" based on an earlier run, a
partial run, or no run at all. Every one of those claims was worthless the moment the diff
moved, and some were false when made.

Before claiming completion: decide which command proves the claim, run it now, read the full
output and exit code, and only then speak. "Should", "probably", and "looks like" are not
verification outcomes. A check that could not run is BLOCKED, never a pass.

Graduated: enforced mechanically — `gate` records diff-bound receipts, any edit invalidates
them, and the `stop` hook holds completion until a passing receipt exists for the current diff.
This file records why that machinery exists.

Evidence: distilled from repeated incidents recorded in the sibling harness corpora
(cc-base, codex-base) during the 2026-08 cross-pollination review.
