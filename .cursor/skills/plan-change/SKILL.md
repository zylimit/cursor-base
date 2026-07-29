---
name: plan-change
description: Plans a bounded repository change using discovery, impact analysis, explicit scope, and affected verification. Use before non-trivial, cross-module, risky, or ambiguous implementation.
---

# Plan Change

1. Write the task envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Use read-only exploration to locate patterns and ownership.
3. Trace contracts and direct dependents for impact.
4. Divide work into dependency-ordered, independently verifiable steps.
5. Name risks, decisions, and escalation points; do not edit while planning.

Return the standard receipt: **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for planning depth, large-repository partitioning, and the plan format.
