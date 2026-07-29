---
name: root-cause-debugging
description: Diagnoses failures through reproduction, competing hypotheses, and first-bad-state evidence. Use for bugs, regressions, flaky behavior, failing tests, and unexplained runtime errors.
---

# Root Cause Debugging

1. Establish **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Capture exact expected and actual behavior.
3. Reproduce safely and minimize the case.
4. Test competing hypotheses with high-information observations.
5. Identify the first incorrect state and a regression check before implementation.

Do not edit during diagnosis, install tools, kill a port, or call a symptom the root cause.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence** with `Changed: none`.

Load [REFERENCE.md](REFERENCE.md) for the evidence table and failure classification.
