---
name: plan-change
description: Plans a bounded repository change using discovery, impact analysis, explicit scope, and affected verification. Use before non-trivial, cross-module, risky, or ambiguous implementation.
---

# Plan Change

## Task

Produce a dependency-ordered, independently verifiable plan for one bounded repository change.
Do not edit while planning. A change that fits in one sentence needs no plan — go to
`scoped-implementation`. Product-from-spec planning is `dev-plan` (sleeps until invoked).

## Preconditions

- Envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
- Read-only exploration. Catalog present for impact (`repo-map`, `affected`). Missing catalog
  is named; do not invent modules.

## Invariants

- Each step is coherent, path-bounded, and testable.
- Shared contracts, lockfiles, schemas, migrations, and generated output have one writer and
  an integration owner.
- Planning does not widen scope. Missing information is an open question, not a guessed
  requirement.

## Method

1. Write the envelope. Locate patterns and ownership with read-only search.
2. Trace contracts and direct dependents (`affected`). Accept: named files and a verify
   command per step. Reject: "implement the feature", "similar to step N".
3. Divide work into dependency-ordered steps. Put shared contracts before consumers and
   cleanup after behaviour.
4. Name risks, decisions, and escalation points. Record rejected alternatives.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**. The next
skill is `scoped-implementation` per step, then `affected-verification`.

Load [REFERENCE.md](REFERENCE.md) for planning depth, large-repository partitioning, and the
plan format.
