---
name: harness-doctor
description: Diagnoses Cursor harness prerequisites, asset integrity, and expected command availability without changing machine state. Use for setup problems, validation failures, or harness health checks.
---

# Harness Doctor

1. Establish **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Check Node.js 20+, repository root, Git availability, and governance asset structure.
3. When available, run `node scripts/harness.mjs doctor`.
4. Use `node scripts/harness.mjs validate` only when validation is requested.
5. Report missing prerequisites; do not install or globally configure them.

Never infer success from this documentation or treat Windows sandboxing as an absolute boundary.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, with `Changed: none`.

Load [REFERENCE.md](REFERENCE.md) for diagnostics and safe remediation boundaries.
