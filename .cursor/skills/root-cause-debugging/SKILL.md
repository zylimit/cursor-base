---
name: root-cause-debugging
description: Diagnoses failures — expected behaviour first, reproduction, competing hypotheses against a normal path, a red-lock, one fix, a stop after three misses. Use for bugs, regressions, flaky tests, unexplained errors.
---

# Root Cause Debugging

Restarting, clearing a cache, widening a timeout, or swallowing the exception is not a fix. One
change at a time, the impact assessed before and regression verified after; three failed fixes
mean the hypothesis is wrong, not the parameters.

1. Establish **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**; protect
   the scene — read status and the diff, separate the user's uncommitted work from the defect.
   "This ticket looks wrong" is enough to start; a stack trace and a minimal reproduction are the
   work, not the entry fee.
2. **Fix the expected behaviour before reading the stack trace**, from one of three sources: the
   spec item (with its `[confirmed]`/`[inferred]` marker), the dispatch's Business Context rules
   and exceptions, or the user's words. An `[inferred]` expectation, or one nobody can state, gets
   one question first — "what should this do in the business?" — because fixing the *right* bug
   costs less than fixing well. Questions for the user come from their experience (which
   de-identified record, when, what was displayed, by which rule it should have differed, when it
   last worked), never "send me the full log". "Refund shows complete" may mean fulfilment or
   accounting: check both meanings before touching code.
3. Reproduce and minimise: full error text, environment, recent changes (`git log`, diff),
   relevant logs; in a multi-component system add a diagnostic at each boundary (client, API,
   store, third party) to learn *which layer* fails before editing any; for service defects check
   for leftover processes on the port first and, with the user's authorisation and a pid confirmed
   to be this project's, clear them — a duplicate instance is behind many ghosts. Run
   `node scripts/harness.mjs affected` to bound the blast radius; no unbounded scans in a large
   repository.
4. Test competing hypotheses, at most three, ranked, each with the observation that would refute
   it; find a **comparable normal path** (same input, permission, state, time) and locate the
   first observable divergence — it bounds the search but is not automatically the cause (a wrong
   unit upstream shows up at rendering). Change one condition per experiment; a negative result
   rules out only what the experiment covered; separate "the code departs from a confirmed rule"
   from "the rule is ambiguous" — the latter goes back with the source conflict, never a fabricated
   root cause. Look up unfamiliar errors and third-party behaviour in current sources first.
5. **Red-lock** a production-behaviour bug or a core parser or contract defect: a test that fails
   now, for the expected reason, before the fix; the fix turns it green and the original
   reproduction is re-run. Edge inputs and copy defects are residue, not locks. The lock's inputs
   and assertions are never weakened to pass.
6. Fix the root cause with the smallest change — no neighbouring refactor, no silent fallback, no
   unauthorised dependency or contract change; then compile, re-run the lock and the reproduction,
   and regression-check the related behaviour; a failed fix is reverted before the next hypothesis.
   Measured facts found on the way (a table empty in the real store, a field's actual format, an
   interface's real behaviour) are the strongest basis a domain ruling can have — report them under
   Domain findings with their evidence.
7. **Three misses trip the breaker**: the same defect still red after three fixes, or two
   consecutive attempts with no new evidence, stops the fourth. Go back to the assumptions (data
   flow, concurrency model, dependencies, the expected behaviour itself), re-collect the evidence,
   and escalate with what was tried, why each failed, where the suspicion sits, and the red test as
   a reproducible target. `quality status` and `risk` flag the same streak from the outside.
8. When fixing to the spec would make the exception case run wrong or hand the beneficiary a worse
   result, stop: report **requirement in doubt** with the counter-example (scenario → what the
   spec gives → what the business needs → basis) to `product-spec`; do not fix the "correct" bug.

Emergency stop-loss runs only within existing authorisation and preserves the scene; recovery,
temporary bypass, and root fix are reported separately — a recovered service does not erase an
unlocated cause. Killing a process needs the user's authorisation and a confirmed pid of this
project; a port release or restart is a diagnostic step, never the conclusion.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence** plus **Root
cause**; diagnosis-only work returns `Changed: none`; for product work add **Business assumptions
/ Counter-examples / Domain findings**.

Load [REFERENCE.md](REFERENCE.md) for the evidence table, the comparison-and-experiment method,
and failure classification.
