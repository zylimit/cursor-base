# Scoped Implementation Reference

## Before editing

- Inspect repository status and current contents immediately before each edit; dirty paths at
  session start are someone else's work until proven otherwise.
- Locate the closest existing implementation and its tests; the project's own `AGENTS.md`
  conventions outrank any default in this skill.
- Resolve whether files are generated, vendored, migrated, or user-modified.
- Name owned paths; treat shared configuration, lockfiles, schemas, migrations, and generated
  output as shared ownership with one writer and an integration owner.
- Read the Business Context to its sources when the pack only points at them; a pointer read is
  not a rule understood. Example: "repaired but unpaid tickets stay on the settlement list" and its
  source must travel with a task that says "implement the completed-status filter", or the filter
  condition is a guess.

## During editing

Preserve external behaviour outside the goal. Avoid broad renames, opportunistic cleanup,
dependency changes, or formatting unrelated files. Prefer a small complete slice over partial edits
across many modules. Keep public interfaces stable; a breaking change checks its consumers and the
user's decision first.

Real duplication or mixed responsibilities that the change meets are refactored as a group —
extract the common rule and construction, keep the behaviours that really differ; do not stack a
patch, copy a near-duplicate, or add an abstraction, layer, or framework for an imagined future.

Parallel reads are encouraged. Parallel writes require disjoint path ownership and one integration
owner; otherwise serialize them.

## Existing values and the read path

Deleting a definition does not delete the values already saved, cached, imported, or configured.
From the changed object, find the create, load, edit, save, reopen, and display entry points and
follow callers, not only the constant's definition — a serialised old value, a cache, an import
file, or a historic configuration comes back by another path. Record identity and origin (stable
id, kind marker, user-made or system-provided, which data belongs to the user); the same display
name is not the same identity. Then branch on the confirmed rule: forbid only creation while old
objects stay readable; convert old objects (mapping, failure handling, kept data, authorisation;
verified through load and save); hide or remove built-ins of one origin while protecting similar
user objects and their history; an unknown rule returns to the orchestrator with the source, the
candidates, and the concrete impact. Enough when a new object, a representative old one, and a
similar-but-kept one pass through the real entry points under the confirmed rule and survive save
and reopen; checking an in-memory array or deleting the definition covers no persistence promise.

## Success response → the result the user gets

Follow one real task: input → transient edit → request → domain handling → returned result →
applied or written back → saved and reopened. Skip stages the project lacks; never treat a
function's existence or a 200 as downstream completion. With asynchronous, cross-end, or
multi-editor work, check at the boundary that decides the write: which object and request the
result belongs to, which input it was based on, whether the current edit changed, whether the user
completed the confirmation the rule requires. Success shown, result received, applied, and saved
are four observations; a success toast never hides a failed write-back. Run the overwrite
timeline once: send the request, change the current edit, let the old request return; keep,
reject, or merge by the confirmed conflict rule — an unknown rule goes back, not into the code.
Retries and duplicate callbacks are checked for double writes and for overwriting newer state.
Local mock, bridge, service, and target host each certify only their own range; only the real
target entry completing the required action certifies that entry.

## Isolation the entry points actually consume

Fixtures satisfy the production path's preconditions — legitimate identity, permission, state,
order. Skipping validation to call an inner function tests the inner rule only; say so and cover
the real entry with a contract or integration check. Anything that writes user state uses the
project's isolation mechanism and its own temporary data, and every participating entry point (UI,
CLI, background process) is shown to read the isolated directory or configuration — a temporary
directory nobody reads and a variable nobody consumes prove nothing. Pause anything that would
write real data until isolation is in place; clean only what this run created.

## UI changes

Walk the changed page and its neighbours with the design reference: real content lengths, narrow
containers, scrolling and overflow, loading and error states, and the keyboard, focus, and
danger-action behaviour this change touched. Judge whether the user can see, reach, and understand
the next step; a screenshot's existence or a similar colour is not a completed task. No browser
means "not rendered", stated, rather than a guess about visual quality.

## Before handoff

Inspect the complete diff for scope drift, debug artifacts, secrets, and accidental generated
changes. Run the narrowest affected checks, then expand according to contract and impact
(`affected`, `verify-plan`, `gate`). Freeze the implementation, its documents, and the manifest
before the full gate runs; run it once; repeat only for a change, a failure, doubtful evidence, or
the user's explicit request — never to "hand over" to the next role. Request read-only review for
material behaviour changes as the profile demands.

The receipt carries the rule source, the real entry point, identity and state distinctions, the
isolation used, the observed before-and-after states, and the boundaries not walked — not "handled"
as a chat conclusion.

A quality waiver needs owner, reason, exact scope, and expiry. It cannot waive safety and must
appear under `Not verified` and `Evidence`.
