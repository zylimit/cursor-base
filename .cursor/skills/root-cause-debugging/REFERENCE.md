# Root Cause Debugging Reference

## Evidence loop

Record:

| Hypothesis | Prediction | Observation | Result |
| --- | --- | --- | --- |
| Specific causal claim | What differs if true | Command, path, trace, or value | supported / weakened / open |

Prefer one discriminating check over repeated broad test runs. Trace backward from the visible failure through data and control flow until reaching the earliest violated invariant.

## Classify correctly

- **Root cause**: earliest defect or invalid assumption sufficient to produce the failure.
- **Trigger**: input, timing, or environment that exposes it.
- **Symptom**: downstream observable effect.
- **Environment failure**: unavailable dependency, permission, configuration, or host constraint.
- **Suspected flaky**: inconsistent outcome with captured repetition evidence; suspicion alone is insufficient.

## Fix handoff

Provide the minimal causal explanation, affected paths/symbols, recommended change boundary, and a test that fails before the fix and passes after it. Escalate when reproduction requires destructive actions, secrets, production access, unknown process termination, or scope expansion.
