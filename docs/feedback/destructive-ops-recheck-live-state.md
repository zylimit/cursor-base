---
id: destructive-ops-recheck-live-state
occurrences: 2
first_seen: 2026-08-07
last_seen: 2026-08-07
graduated: false
---

# Re-read live state immediately before any destructive or remote operation

A production resource was deleted based on an earlier snapshot and a time-based inference; the
resource was in active use. Separately, a rejected tool call was assumed to mean the remote
command never ran — it had run, and the retry created a duplicate.

Before a destructive or remote-side-effect operation: query the target's current state at that
moment (a snapshot from earlier in the session does not count), require direct evidence for the
attribution, and treat any interrupted or rejected remote call as possibly executed — verify
remotely before retrying. When the evidence is indirect, stop and escalate instead of acting.

Evidence: distilled from destructive-operation incidents recorded in the sibling harness
corpora during the 2026-08 cross-pollination review.
