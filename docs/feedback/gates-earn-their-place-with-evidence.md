---
id: gates-earn-their-place-with-evidence
occurrences: 3
first_seen: 2026-08-07
last_seen: 2026-08-07
graduated: true
---

# A gate that has never caught anything is cost plus false confidence

Review and gating layers were added on the assumption that more checking is safer. Measurement
showed some doubled elapsed time without changing the defect rate, and controls that had never
intervened were being maintained and trusted anyway.

Before adding a gate, state how its effectiveness will be observed. Afterwards, check the
interception record: a control with sustained zero catches is a candidate for removal, and
keeping it requires an argument, not a habit. The same discipline applies in reverse — a gate
that fires constantly on false positives is training everyone to override it.

Graduated: enforced mechanically — every hook intervention is recorded in the ledger and
`gate-audit` names the controls that have never intervened.

Evidence: distilled from gate-effectiveness measurements recorded in the sibling harness
corpora during the 2026-08 cross-pollination review.
