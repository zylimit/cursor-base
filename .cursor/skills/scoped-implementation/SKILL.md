---
name: scoped-implementation
description: Implements one bounded code change while preserving user work, following existing patterns, honouring the business context, and verifying affected behavior with evidence. Use when goal and writable scope are known.
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

## Method

1. Confirm the envelope. Open the owning task when it is not already open
   (`node scripts/harness.mjs task start --goal … --owned … --risk …`).
2. Inspect status, the diff, relevant code, tests, and the nearest pattern. Walk the Business
   Context example to an observable result before typing.
3. Make the smallest coherent edit. Persist data moves with the code that changes its shape. A
   real duplication or a responsibility tangle is refactored as a group, never patched a third
   time. Accept: one behaviour with its error, empty, boundary, permission, or concurrency
   path. Reject: a neighbouring cleanup, an unauthorised dependency, a lockfile regenerated
   with a different tool version than its header.
4. Inspect the final diff. Run `node scripts/harness.mjs affected`, then `gate`. Prove new
   files with `git status` and content, not with an empty `git diff`. "It compiled earlier" is
   not evidence.
5. Stop on a scope conflict, destructive work, a required decision nobody made, or a
   counter-example. Report Domain findings with their evidence.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**. Profile in force decides
whether a reviewer or tester runs next.

Load [REFERENCE.md](REFERENCE.md) for ownership, edit, verification, and the
state-and-result-chain method.
