---
id: restart-storms-mean-the-fault-is-not-transient
occurrences: 2
first_seen: 2026-08-07
last_seen: 2026-08-07
graduated: true
---

# A restart storm means the fault is not transient; fail visibly and keep the evidence

Supervised services that crash-looped were restarted indefinitely. The machine burned cycles,
the log rotated the original cause away, and the loop read as "running" from a distance.
Unlimited restarts convert a diagnosable fault into a hidden one.

Restart on crash with exponential backoff, but bound restarts within a time window. When the
bound is exceeded, stop restarting, mark the service crashed, and preserve the log: the fault
is structural, and the correct next step is diagnosis, not another attempt. A process that is
alive but failing its health probe is the same outage in a quieter form.

Graduated: enforced mechanically — the service supervisor's breaker trips after the configured
restart budget, `service status` reports liveness from pids rather than recorded state, and the
risk scan flags crashed and dead services at session start.

Evidence: distilled from supervisor designs and crash-loop incidents recorded across the
sibling harness corpora during the 2026-08 cross-pollination review.
