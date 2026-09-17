---
name: test-design
description: Designs and runs regression tests from business scenarios and contracts under a risk budget, with implementation-independent expectations and three-way failure triage. Use when tests are needed or a phase closes.
disable-model-invocation: true
---

# Test Design

A test earns its place by catching a real regression, not by raising a coverage number.
Expectations come from the spec, the rules, and independent fixtures — never from the code
under test.

## Task

Decide what to test, write or extend the cases, run them, and triage every failure three ways.
Running an existing plan is `affected-verification`.

## Preconditions

- Behaviour under test, its acceptance, the diff, and the project's runner. A missing runner
  is scaffolded only with authorisation — no silent installs.
- On product work, the dispatch's Business Context.
- At HIGH / `strict`, the author of the code does not write its acceptance tests — a `tester`
  delegate does. At LOW and MEDIUM the implementer may write tests if expectations come from
  the spec, not from the diff.
- Invoke by name.

## Invariants

- The implementation must never compute its own `expected`. Two opposite errors cancel in a
  round trip; use a one-way expected value, then the round trip as a third check.
- A green on an unreachable input or a wrong unit hides the defect as expected behaviour.
- Never weaken an assertion, widen a timeout, add a fixed sleep, or retry to green.

## Method

1. Write the envelope. Take material from the business first: each rule one positive case,
   each exception one case, each `[open]` branch a skipped test that names the question.
2. Spend the budget where an error costs most: cross-boundary contracts, parsers, dedupe keys,
   state transitions, key boundaries. Not: pixel snapshots, third-party behaviour, pass-through
   getters.
3. Grade files P0 / P1 / P2. Grades steer selection; they never remove a required check.
4. Run it. Quote the runner's raw output from this message. Tests that exist but did not run
   are missing.
5. Triage: **code wrong** → `root-cause-debugging`; **test wrong** → fix the assertion;
   **spec wrong** → requirement in doubt to `product-spec`, skip the case, change neither the
   assertion nor the spec.

Accept: a case that would have failed before the fix for the expected reason. Reject: a
coverage number as the goal; committing for the user.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for dimensions, oracle construction, and ageing.
