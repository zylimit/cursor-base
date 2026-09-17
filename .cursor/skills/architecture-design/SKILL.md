---
name: architecture-design
description: Designs or reviews module boundaries from business events and the seven principles; each decision becomes an ADR with its enforcing check, revisit condition, and reversal cost. Use for new modules or boundary changes.
disable-model-invocation: true
---

# Architecture Design

The document holds **invariants** only — decisions two independently built units would otherwise
make incompatibly. An architecture the checks cannot see decays silently.

## Task

Write or revise `Architecture-Design.md` (or the project's existing path) and the ADRs that
make each accepted decision enforceable. Evolution mode draws the delta and the migration,
never a rebuild.

## Preconditions

- Spec (functions, data ownership, integrations, failure consequences). Missing DFX is marked
  "pending DFX" and routed at the end; it does not block a one-page S sketch.
- Existing code: `node scripts/harness.mjs repo-map` and `arch-check` first. Ratify what is
  there.
- Invoke this skill by name, or after product documents exist. Do not auto-run on a harness
  maintenance change.

## Invariants

- Departments, pages, tables, and deploy units are not modules by default.
- Every accepted decision names `Enforced-by:` a real check. `Revisit-if:` is an observable
  condition, never a date. `Reversal:` is the undo cost; a reversal nobody can write is a
  **one-way door** and goes in front of the user.
- Modular monolith is the default. Services need an organisational or operational reason.
- Size before style: **S** one page; **M** full document; **L** full document plus a catalog
  skeleton. Going up a tier needs a written reason.

## Method

1. Write the envelope. Ask two things before any style talk: which module hurting for an hour
   hurts whom most, and what the team knows and how many maintain it.
2. Walk a **business event** before drawing modules. Fix **fact ownership** for every shared
   fact. Walk the **break points** (duplicate request, concurrent update, external success with
   no local reply, half-done step, undo). "Unknown result", "rejected", and "completed" are
   three states.
3. Let candidates face the **same scenario**. Write the refutation first ("if we observe X, the
   recommendation shrinks"). Pick the smallest experiment and record it as *proposed* until it
   has run.
4. Judge with the seven principles on real edges. Settle paradigm, module table, dependency
   rules, data ownership, conventions, the runtime envelope (decided / deferred / undecided,
   never blank).
5. Declare decisions in `harness/module-catalog.json`. Write ADRs from `templates/adr-template.md`.
6. Prove: `arch-check`, `catalog lint`, `adr-check`. Record decisions in `progress.md`.

Accept: an invariant that answers "would two independent units choose incompatibly?" Reject: a
directory tree as architecture; a date as `Revisit-if:`; a rebuild of a working brownfield.

## Handoff

`dfx-design` (tiers per module), `dev-plan` (phases along module boundaries).

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the principles, violation signals, and worked trade-offs.
