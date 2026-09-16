---
name: test-design
description: Designs and runs regression tests from business scenarios and contracts under a risk budget, with implementation-independent expectations and three-way failure triage. Use when tests are needed or a phase closes.
---

# Test Design

A test earns its place by catching a real regression, not by raising a coverage number. The
expectations come from the spec, the rules, and independent fixtures — never from the code under
test. How much independence that buys follows the tier (`docs/PRODUCT-WORKFLOW.md`): at LOW and
MEDIUM the implementer may write the tests, provided the expectations come from the spec and not
from the diff; at HIGH, under `strict`, the author of the code does not write its acceptance
tests — a `tester` delegate does. Running the plan is `affected-verification`; this skill decides
what to test and how to know a green is true.

1. Write the envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
   Requires the behaviour under test, its acceptance, the diff and impact, and the project's
   runner, fixtures, and directory conventions; on product work the dispatch's Business Context
   (rule source, distinguishing example, open items). A missing runner is scaffolded minimally
   (`templates/test-scaffold.md`) only with authorisation — no silent installs.
2. Take material from the business first: each rule in the spec's *Rules and exceptions* gets one
   positive case, each exception one case, each `[open]` branch a skipped test that names the
   open question. Exceptions are where counter-examples hide — a case that runs wrong under the
   code is usually a spec that was never written, not code that was written wrong. Then add the
   engineering dimensions in [REFERENCE.md](REFERENCE.md).
3. Spend the budget where an error costs most, in this order: cross-boundary contracts
   (export↔import round trips, serialisation, request↔response), parsers and data cleaning,
   dedupe and merge keys, state transitions, key boundaries (null, NaN/inf, out of range, huge,
   negative — especially defensive early returns). Recommended: pure utilities, enum mappings,
   endpoint validation, core interaction flows where a browser driver exists. Explicitly not:
   pixel snapshots, third-party behaviour, pass-through getters.
4. Grade every test file by consequence, chance, spread, and existing defences — `P0` (breach,
   data corruption, irreversible side effect, core result or recovery promise), `P1` (this
   change's main behaviour and contract), `P2` (low-consequence long tail) — in a header line
   (`# risk: high|medium|low` or the runner's tag); risk, level, and duration are separate axes
   and a slow end-to-end test may well be `P0`. Grades steer selection inside the plan; they never
   remove a required check.
5. Fix expectations independently: a one-way expected value from the confirmed rule, an
   independently confirmed external fixture, then the round trip as a third check — two opposite
   errors cancel in a round trip and the implementation must never compute its own `expected`.
   Make fixtures reach the production entry point (identity, permission, state, order); a green
   on an unreachable input or a wrong unit hides the defect as expected behaviour.
6. Run it, and quote the runner's raw output (passed / failed counts, case names, exit) from this
   message — a run before the last edit does not count. Tests that exist but did not run are
   missing. Under `strict` the author of the tests is a `tester` delegate who did not write the
   code; its write scope is the test paths only.
7. Triage every failure three ways before touching anything, using the failure text, the
   contract, and the Business Context: **code wrong** → `root-cause-debugging` fixes the product;
   **test wrong** → the tester fixes the assertion or fixture; **spec wrong** (the assertion
   follows the spec but contradicts a rule or exception, or an `[inferred]` item meets contrary
   evidence) → report **requirement in doubt** with the counter-example, skip the case with the
   reason, and change neither the assertion nor the spec.
8. Report: raw runner output; each new or changed case and the regression it prevents; untested
   items with the reason; the boundary between "verified against the confirmed rule" and
   "business meaning still undecided". Never commit for the user; never weaken an assertion,
   widen a timeout, add a fixed sleep, or retry to green.

Done when the suite runs with real output, the must-test items this change touches are covered
and green, no red is left unresolved, and the new cases are re-runnable and ready to commit (the
orchestrator commits inside the approval tier already granted).

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**.

Load [REFERENCE.md](REFERENCE.md) for the dimension checklist, the level-selection table,
independent oracles, reading other tools' reports, ratio and ageing as maintenance diagnostics,
and the red-lock rule for defects.
