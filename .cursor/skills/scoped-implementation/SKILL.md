---
name: scoped-implementation
description: Implements one bounded code change while preserving user work, following existing patterns, honouring the business context, and verifying affected behavior with evidence. Use when goal and writable scope are known.
---

# Scoped Implementation

1. Confirm **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation** and, on
   product work, **Business Context** — why, who benefits, the rule and exception, the one example
   that separates a right reading from a wrong one. Missing context is `NEEDS_CONTEXT` with what
   was read, what is missing, and what can proceed; never a guess from a file name or from the
   existing implementation.
2. Inspect status, the diff, relevant code, tests, and the nearest pattern; open the owning task
   (`node scripts/harness.mjs task start --goal … --owned … --risk …`) when it is not already open
   — writes outside the owned paths and to files changed underneath the task are refused.
3. Walk the Business Context example to an observable result before typing; make the smallest
   coherent edit that follows the nearest existing pattern; keep writes serial by default. A shared
   thing (constant, export, built-in datum, component, contract, copy) is changed at every
   reference in one pass, found by grep, not at its definition alone; persisted data moves with the
   code that changes its shape; a real duplication or a responsibility tangle is refactored as a
   group, never patched a third time.
4. No empty catch, no silent retry, no fallback to a default success, no compatibility layer with
   no caller. Behaviour changes carry their error, empty, boundary, permission, transaction, or
   concurrency path. Files split by responsibility and testability, not by a line count. A new or
   upgraded dependency, a migration, a package-manager switch, or a CI change needs authorisation
   first; a lockfile is regenerated with the exact tool version recorded in its header.
5. Inspect the final diff and run the affected checks (`node scripts/harness.mjs affected`, then
   `gate`); prove new files with `git status` and content, not with an empty `git diff`. The
   completion claim carries the commands and their output from this message — "it compiled
   earlier" is not evidence; a preview, a filtered subset, or watching a run is not the gate's
   receipt.
6. Stop and return on a scope conflict, destructive work, a required decision nobody made, or a
   **counter-example**: the code would match the spec while the spec fails the business (the
   exception case runs wrong, the beneficiary gets a worse result). Report it under
   Counter-examples with scenario → what the spec gives → what the business needs → basis and let
   `product-spec` change
   the requirement; never edit the requirement from here, never book the agent's misreading as the
   user widening scope. Domain facts met on the way (a field's real format, a store's real state,
   an interface's real behaviour) go under Domain findings with their evidence.

Never install, publish, force-push, kill ports, or overwrite user changes without explicit
authorisation. The implementer does not certify its own work: independent review and testing are
decided by the profile in force, not by the author.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**.

Load [REFERENCE.md](REFERENCE.md) for ownership, edit, verification, and handoff details, and the
state-and-result-chain method for persisted values and asynchronous write-backs.
