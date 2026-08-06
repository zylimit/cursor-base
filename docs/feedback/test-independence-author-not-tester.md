---
id: test-independence-author-not-tester
occurrences: 2
first_seen: 2026-08-07
last_seen: 2026-08-07
graduated: true
---

# The author of a change does not write its acceptance tests

When the implementer also wrote the tests, the author's wrong assumptions were copied straight
into the assertions, and the tests passed against defective behavior. Verification written by
the same mind that wrote the defect verifies the defect.

Tests that gate acceptance are written from the specification by a role that did not implement
the change. On failure, route by fault: a product defect goes back to the implementer; a test
defect goes to the tester. Neither weakens an assertion to go green.

Graduated: embodied in the role contracts — `tester` executes and reports without editing
product code, `implementer` does not certify its own work, and high-risk completion expects
review by a role that did not write the change.

Evidence: distilled from confirmation-bias incidents recorded in the sibling harness corpora
during the 2026-08 cross-pollination review.
