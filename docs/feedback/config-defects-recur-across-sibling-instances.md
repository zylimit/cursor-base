---
id: config-defects-recur-across-sibling-instances
occurrences: 2
first_seen: 2026-08-07
last_seen: 2026-08-07
graduated: false
---

# A configuration defect recurs in every sibling instance of the same setting

A timeout defect was fixed where it was reported; the identical value in a sibling hook
reproduced the same failure immediately afterwards. Fixing only the reported instance of a
configuration-class defect is whack-a-mole.

When a defect is configuration-shaped — a timeout, a threshold, an interpreter path, a wrapper
pattern — search for every sibling instance of the same shape before claiming the fix: same
event family, same value, same template. The fix is complete when the class is fixed, and the
receipt lists every instance inspected.

Evidence: distilled from a repeated-timeout incident recorded in a sibling harness corpus
during the 2026-08 cross-pollination review.
