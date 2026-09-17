---
name: root-cause-debugging
description: Diagnoses failures — expected behaviour first, reproduction, competing hypotheses against a normal path, a red-lock, one fix, a stop after three misses. Use for bugs, regressions, flaky tests, unexplained errors.
---

# Root Cause Debugging

## Task

Find the first cause that explains the failure, lock it red, fix that cause, and stop after
three misses. Restarting, clearing a cache, widening a timeout, or swallowing the exception
is not a fix.

## Preconditions

- "This ticket looks wrong" is enough to start. A stack trace and a minimal reproduction are
  the work, not the entry fee.
- Protect the scene: separate the user's uncommitted work from the defect.
- On product work, expected behaviour comes from the spec item (with its marker), the
  dispatch's Business Context, or the user's words.

## Invariants

- Fix the expected behaviour *before* reading the stack trace. An `[inferred]` expectation, or
  one nobody can state, gets one question first — "what should this do in the business?"
- One change at a time. A failed fix is reverted before the next hypothesis.
- Three misses trip the breaker: the same defect still red after three fixes, or two
  consecutive attempts with no new evidence, stops the fourth.
- Killing a process needs the user's authorisation and a confirmed pid of this project.

## Method

1. Write the envelope. Bound the blast radius with `node scripts/harness.mjs affected`. No
   unbounded scans.
2. State expected behaviour from spec / Business Context / the user. Accept: a named record,
   a time, a displayed result, the rule that should have differed. Reject: "send me the full
   log"; treating "complete" as one meaning when the field uses two.
3. Reproduce and minimise. In a multi-component system, a diagnostic at each boundary first
   (client, API, store, third party). For service ghosts, leftover processes on the port —
   with authorisation.
4. At most three competing hypotheses, ranked, each with the observation that would refute it.
   Find a comparable normal path and the first observable divergence. Change one condition per
   experiment. A negative result rules out only what the experiment covered.
5. **Red-lock** a production-behaviour bug or a core parser or contract defect: a test that
   fails now, for the expected reason, before the fix. Edge inputs and copy defects are
   residue, not locks. Never weaken the lock to pass.
6. Smallest fix. Compile, re-run the lock and the reproduction, regression-check related
   behaviour. Measured facts found on the way go under Domain findings.
7. After three misses, go back to the assumptions and escalate with what was tried, why each
   failed, where the suspicion sits, and the red test. `quality status` and `risk` flag the
   same streak from the outside.
8. When fixing to the spec would make the exception run wrong or hand the beneficiary a worse
   result, stop: **requirement in doubt** to `product-spec`. Do not fix the "correct" bug.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence** plus **Root
cause**. Diagnosis-only work returns `Changed: none`.

Load [REFERENCE.md](REFERENCE.md) for the evidence table and failure classification.
