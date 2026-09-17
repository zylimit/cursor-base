---
name: scoped-implementation
description: Implements one bounded code change when the goal and writable scope are known. Use after a plan or a clear one-file fix; not to invent requirements or to start coding while the user is still reading the design.
---

# Scoped Implementation

## Task

Ship one bounded change that matches the envelope and the nearest existing pattern, with
evidence from this turn.

## Preconditions

- Envelope present: **Goal / Scope / Out of Scope / Existing Pattern / Verification /
  Escalation**. On product work, **Business Context** — why, who benefits, the rule and
  exception, the example that separates a right reading from a wrong one.
- Missing context is `NEEDS_CONTEXT` (what was read, what is missing, what can proceed). Accept
  a one-file fix with a clear goal. Reject guessing from a file name or from the current
  implementation.
- Bounded means the flow you are changing already exists in this repo to read. No existing
  flow → `product-spec` or `plan-change`, not a silent start here.

## Invariants

- Writes outside owned paths are denied. Owned-path drift is re-read, then overlaid
  (`task start`, `preToolUse`).
- No empty catch, no silent retry, no fallback to a default success, no compatibility layer
  with no caller.
- A shared thing is changed at every reference in one pass, found by grep, not at its
  definition alone.
- The implementer does not certify its own work. Independent review is decided by the profile,
  not by the author.
- A counter-example (code would match the spec, spec fails the business) stops implementation
  and returns to `product-spec`. Never edit the requirement from here.
- **Design before the first edit, unless already delegated.** Present the intended change and
  stop until the user says yes. "Simple" scales the artefact (two sentences), never the gate.
  "You decide" / "just do it" is delegated: record the design in one sentence and proceed.

## Method

1. Confirm the envelope. Open the owning task when it is not already open
   (`node scripts/harness.mjs task start --goal … --owned … --risk …`).
2. Inspect status, the diff, relevant code, tests, and the nearest pattern. Walk the Business
   Context example to an observable result before typing.
3. **Present, then stop.** In chat, not a spec file: approach, files touched, the verify
   command and what its output must show. Wait for an explicit yes. Presenting the design and
   starting in the same breath is skipping the gate. Accept: "yes", "do it", a named correction
   to the design. Reject: starting because the design "looks obvious"; implementing a
   neighbouring cleanup in the same pass.
4. Make the smallest coherent edit. Persist data moves with the code that changes its shape. A
   real duplication or a responsibility tangle is refactored as a group, never patched a third
   time. Accept: one behaviour with its error, empty, boundary, permission, or concurrency
   path. Reject: an unauthorised dependency, a lockfile regenerated with a different tool
   version than its header.
5. Inspect the final diff. Run `node scripts/harness.mjs affected`, then `gate`. Prove new
   files with `git status` and content, not with an empty `git diff`. Close the easy-outs:
   "it compiled earlier" is not evidence; a passing suite that never exercised the new path is
   not evidence; deleting the caller so the search for the old symbol is empty is not a
   migration.
6. Stop on a scope conflict, destructive work, a required decision nobody made, or a
   counter-example. Report Domain findings with their evidence.

| Thought | Reality |
| --- | --- |
| "Too small to need a design" | Two sentences in chat, then a yes. |
| "I'll start while they read it" | The gate is the approval, not the length. |
| "I know this kind of app, so it's bounded" | Bounded measures the repo. No existing flow is not this skill. |
| "Tests passed last hour" | Run the command that proves *this* change, this turn. |

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**. Profile in force decides
whether a reviewer or tester runs next.

## Example

Goal: "Reject unknown attributes in catalog lint." Existing flow: `catalog lint` already walks
attributes. Design in chat: "Add the unknown name to the finding list in `src/catalog.mts`;
extend the fixture in `tests/harness.test.mjs`; `node --test tests/harness.test.mjs` must show
the new case PASS." Stop. After yes, edit those files only.

Reject: opening a new `src/validate-catalog.mts` because a dedicated validator "will be
cleaner"; starting the edit in the same message as the design.

Load [REFERENCE.md](REFERENCE.md) for ownership, edit, verification, and the
state-and-result-chain method.
