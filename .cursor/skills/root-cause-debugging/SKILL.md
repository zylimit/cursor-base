---
name: root-cause-debugging
description: Diagnoses failures by expected behaviour, reproduction, and competing hypotheses before any fix. Use for bugs, regressions, flakes, unexplained errors; not for a missing feature that was never specified.
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

- **No fix without a root-cause investigation first.** Completing Phase 1 (expected behaviour,
  reproduction, evidence at the failing boundary) is what makes a patch legal. Seeing a
  symptom is not understanding a cause.
- State expected behaviour *before* reading the stack trace. An `[inferred]` expectation, or
  one nobody can state, gets one question first — "what should this do in the business?"
- One change at a time. A failed fix is reverted before the next hypothesis.
- Three misses trip the breaker: the same defect still red after three fixes, or two
  consecutive attempts with no new evidence, stops the fourth. Three misses on one mechanism
  is an architecture question, not a fourth patch.
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
   behaviour. Measured facts found on the way go under Domain findings. Close the easy-outs:
   commenting out the assertion, xfail, or hard-coding the expected output is not a fix.
7. After three misses, go back to the assumptions and escalate with what was tried, why each
   failed, where the suspicion sits, and the red test. Ask whether the pattern itself is
   wrong. `quality status` and `risk` flag the same streak from the outside.
8. When fixing to the spec would make the exception run wrong or hand the beneficiary a worse
   result, stop: **requirement in doubt** to `product-spec`. Do not fix the "correct" bug.

| Thought | Reality |
| --- | --- |
| "Quick fix now, investigate later" | The first patch sets the pattern. Investigate first. |
| "It's probably X, I'll change it" | A hypothesis is written, then one experiment, then a result. |
| "Emergency, no time for process" | Guess-and-check is slower than one discriminating check. |
| "I'll write the test after it looks fixed" | The lock must fail for the stated reason before the fix. |
| "One more try" after two misses | The third miss stops the fourth. Question the architecture. |
| "The log will tell me; ask for all of it" | Name the screen, the window, and the safe fields. |

Human signals you are guessing, not investigating: "is that not happening?", "will it show
us…?", "stop guessing", "we're stuck?". Return to expected behaviour and evidence. Do not
add another patch.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence** plus **Root
cause**. Diagnosis-only work returns `Changed: none`.

## Example

Failing test: catalog lint accepts `attributes.security: "bananas"`. Expected: unknown tier is
a finding. Hypothesis A: parser never validates enum. Hypothesis B: fixture never hits that
field. Discriminating check: one unit with `security: "bananas"` and nothing else changed.
A supported → red-lock that case → one parser change → re-run the lock (PASS) and a known-good
catalog (still PASS).

Reject: adding `|| true` to the lint script; deleting the fixture so the suite is green;
asking the user to "paste the full CI log".

Load [REFERENCE.md](REFERENCE.md) for the evidence table and failure classification.
