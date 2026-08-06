---
id: long-batch-needs-watchdog-and-stop-loss
occurrences: 1
first_seen: 2026-08-07
last_seen: 2026-08-07
graduated: false
---

# Long-running batch work needs a per-item timeout, an input precheck, and a stop-loss

One pathological input stalled a batch pipeline; the run was observed rather than stopped, and
a job estimated in minutes consumed hours before anyone intervened. Watching a hung process is
the most expensive form of hope.

Design batch work with a per-item watchdog timeout that kills and quarantines the offending
input rather than the run; add a cheap malformed-input precheck as the first line of defense;
and when the hang signals appear — log output frozen beyond the worst-case retry window, output
counts not advancing — stop, record the evidence, and report immediately. "The process is still
alive" is not progress.

Evidence: distilled from a multi-hour batch stall recorded in a sibling harness corpus during
the 2026-08 cross-pollination review.
