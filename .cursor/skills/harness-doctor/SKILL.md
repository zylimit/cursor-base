---
name: harness-doctor
description: Diagnoses Cursor harness prerequisites, asset integrity, and expected command availability without changing machine state. Use for setup problems, validation failures, or harness health checks.
---

# Harness Doctor

## Task

Report whether this machine and this tree can run the harness. Change nothing.

## Preconditions

- Repository root. Node.js 22+ is the floor (`doctor` says so if it is not).
- `node scripts/harness.mjs doctor` when the CLI is present. `validate` only when validation
  was requested.

## Invariants

- Do not install, globally configure, or infer success from documentation.
- Windows sandboxing is not an absolute boundary.
- A missing prerequisite is `BLOCKED` / reported missing, never a pass.

## Method

1. Write the envelope. Check Node.js 22+, repository root, Git availability, and governance
   asset structure.
2. Run `node scripts/harness.mjs doctor`. Quote its JSON. Accept: named missing items.
   Reject: "looks fine" without the command; running `npm install` as a "fix".
3. Run `validate` only if asked. Runtime parity failures mean edit `src/*.mts` and
   `npm run build`, not the generated `.cursor/runtime/*.mjs`.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, with
`Changed: none`.

Load [REFERENCE.md](REFERENCE.md) for diagnostics and safe remediation boundaries.
