# Root Cause Debugging Reference

## Evidence loop

Record:

| Hypothesis | Prediction | Observation | Result |
| --- | --- | --- | --- |
| Specific causal claim | What differs if true | Command, path, trace, or value | supported / weakened / open |

Prefer one discriminating check over repeated broad test runs. Trace backward from the visible failure through data and control flow until reaching the earliest violated invariant.

## Fix the expectation first

Before the stack trace, write down what the behaviour *should* be and where that comes from: the
spec item and its marker, the dispatch's Business Context (rule and exception), or the user's own
words. An `[inferred]` expectation or one nobody can state gets one question — phrased so a
business person can answer it from experience: which de-identified record, when, what was on the
screen, which rule says it should differ, when did it last work. Never demand the whole log, a
credential, or production data; when a log is genuinely needed, name the screen or the shortest
action, the time range, and the fields that are safe to share.

Two meanings of one word are the commonest trap: "complete" may be fulfilment or accounting,
"cancel" may free a slot or erase history. Check both in the sources before choosing a fix.

## Comparison and experiments

Keep the anomalous input, timing, permission, version, and result; then find the nearest normal
record or a similar normal path and list what is identical and what differs — a success under a
different account or object does not exclude permission, state, or data differences. Align the
same meaning step by step through input parsing, domain judgement, state write, output boundary,
and locate the **first observable divergence**. It bounds the investigation; it is not necessarily
the cause. With no normal sample, construct a minimal comparison from the confirmed contract and
say it is synthetic.

For each surviving hypothesis:

| Hypothesis | Support so far | Observation that refutes it | Minimal discriminating experiment | Actual observation, next step |
| --- | --- | --- | --- | --- |
| a concrete explanation from this call chain | a locatable output or state | an observable result incompatible with it | change one relevant condition; write the expected difference | filled after running; unrun stays unknown |

A wrong numeric output may be a unit misread at the entry or a duplicated aggregation: keep the
same object and input and compare values and counts before and after the aggregation; do not
change the fixture, the formatter, and the cache at once, or the experiment separates nothing.
Fixed expectations come from the business rule, never from the implementation.

Negative results update the judgement too: an unchanged anomaly after one change rules out only
what that change covered. An experiment whose environment differs or that never reached the
failing path fixes its premise first and is never counted as a product pass. "Current suspicion"
is allowed when it carries support, a refutation condition, and a next step — an early root-cause
announcement is not.

## Stop-loss versus fix

With loss ongoing and emergency authorisation in hand, stop the bleeding within scope, preserve
what can be preserved, verify the effect. Recovery, temporary bypass, and root fix are three
reports; a recovered service does not remove an unlocated cause. A restart, a cache clear, or a
longer timeout is an experiment or a stop-loss only when its hypothesis and authorisation exist;
"slow" or "CPU at zero" alone does not prove a deadlock — 0% CPU with elapsed time still rising
does.

The evidence sufficient for a fix: the confirmed rule, a reproducible divergence, a cause that
explains the key observations, and a lock that fails for that cause before the fix. No
reproduction means returning the excluded conditions and the concrete gap, not a promise that the
cause was found. If a new fact shows the test's premise was wrong, the orchestrator recalibrates
the basis explicitly; nobody weakens the lock to go green.

## Handing to the re-verifier

Deliver the original reproduction, the normal comparison, the effective refutations, the minimal
fix, the lock and its result, and the environments and concurrency paths that were not tested.
Re-verification confirms the anomaly is gone and then that the normal comparison still holds; the
profile and the verification plan decide the breadth. A defect that turns out to be a business
misreading returns the earliest failing source, the concrete example, and the affected tasks and
acceptance for the orchestrator to propagate.

## Classify correctly

- **Root cause**: earliest defect or invalid assumption sufficient to produce the failure.
- **Trigger**: input, timing, or environment that exposes it.
- **Symptom**: downstream observable effect.
- **Environment failure**: unavailable dependency, permission, configuration, or host constraint.
- **Suspected flaky**: inconsistent outcome with captured repetition evidence; suspicion alone is insufficient.

## Fix handoff

Provide the minimal causal explanation, affected paths/symbols, recommended change boundary, and a test that fails before the fix and passes after it. Escalate when reproduction requires destructive actions, secrets, production access, unknown process termination, or scope expansion.
