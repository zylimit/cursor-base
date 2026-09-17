---
name: plan-change
description: Plans a bounded repository change with named files, a verify command, and expected output per step. Use before non-trivial, cross-module, risky, or ambiguous work; not for a change that already fits in one sentence.
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

- Each step is coherent, path-bounded, and testable by a stranger who has the spec (or the
  envelope) and this plan, not the conversation.
- Shared contracts, lockfiles, schemas, migrations, and generated output have one writer and
  an integration owner.
- Planning does not widen scope. Missing information is an open question, not a guessed
  requirement.
- **No placeholders.** A step that says "add appropriate error handling", "similar to step N",
  or "write tests for the above" without the command and expected output is a failed plan, not
  a draft.

## Method

1. Write the envelope. Locate patterns and ownership with read-only search.
2. Trace contracts and direct dependents (`affected`). Accept: named files and a verify
   command per step. Reject: "implement the feature".
3. Map files before tasks: create / modify / test, and what each file is responsible for.
   Split by responsibility the change actually needs, not by layer fashion. Follow the repo's
   existing grain.
4. Divide work into dependency-ordered steps. Put shared contracts before consumers and
   cleanup after behaviour. Each step is the smallest unit a reviewer could reject without
   rejecting its neighbour, and it ends with an independently runnable check.
5. Name risks, decisions, and escalation points. Record rejected alternatives.
6. Self-review the plan against the envelope: every in-scope behaviour has a step; every step
   has Files / Change / Command / Expected; names and types match across steps; no TBD.

**Step shape**

```text
### Step N: <one behaviour>
Files:
- Modify: path:approx-lines
- Test: path
Change: <what is true after this step, in one sentence>
Command: <exact command>
Expected: <exit code and the observable that proves this step, not "tests pass">
```

Fold setup, scaffolding, and docs into the step whose deliverable needs them. Do not schedule
parallel writes to shared manifests or overlapping paths.

| Thought | Reality |
| --- | --- |
| "I'll say similar to step 2" | Repeat the files and command. The executor may read one step. |
| "Add validation" | Name the check, the input, and the finding it must emit. |
| "Test later" | The verify command is part of the step or the step is incomplete. |
| "They know the codebase" | The plan assumes they do not. Paths are exact. |

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**. The next
skill is `scoped-implementation` per step, then `affected-verification`. Offer the user that
sequence; do not start editing from the plan in the same turn.

## Example

Goal: unknown catalog attribute tiers become lint findings.

```text
### Step 1: Reject an unknown tier
Files:
- Modify: src/catalog.mts (attribute-tier parse)
- Test: tests/harness.test.mjs
Change: `security: "bananas"` is a catalog-lint finding; a known tier is unchanged.
Command: node --test tests/harness.test.mjs
Expected: exit 0; the new test name appears as pass; existing catalog-lint cases still pass.
```

Reject: "Step 1: tighten catalog validation (similar to other lints). Verify with the test
suite."

Load [REFERENCE.md](REFERENCE.md) for planning depth, large-repository partitioning, and the
plan format.
