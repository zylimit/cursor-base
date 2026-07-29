---
name: scoped-implementation
description: Implements a bounded code change while preserving user work, following existing patterns, and verifying affected behavior. Use when the goal and writable scope are known.
---

# Scoped Implementation

1. Confirm **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Inspect status, relevant code, tests, and the nearest pattern.
3. Make the smallest coherent edit; keep writes serial by default.
4. Inspect the diff and run affected checks.
5. Stop on scope conflict, destructive work, or a required unmade decision.

Never install, commit, push, publish, kill ports, or overwrite user changes without explicit authorization.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for ownership, edit, and handoff details.
