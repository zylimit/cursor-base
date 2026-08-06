---
id: deploy-acceptance-needs-independent-verification
occurrences: 2
first_seen: 2026-08-07
last_seen: 2026-08-07
graduated: false
---

# Deployment acceptance is read from the host, not from the deployer's reply

A deployment was accepted because the delegated deployer reported success; the running system
was still the previous version. The inverse also occurred: an "incomplete" reply was treated as
failure while the deployment had in fact succeeded.

Accept a deployment only on independently read host state: the artifact identity actually
running (creation timestamp and image or build tag — uptime readings are misleading when an old
process lingers), a passing health endpoint, and a live probe that exercises the newly deployed
behavior. A subagent's self-report, silence, or error text is never the acceptance evidence.

Evidence: distilled from deployment incidents recorded in the sibling harness corpora during
the 2026-08 cross-pollination review.
