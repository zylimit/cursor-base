---
name: catalog-discovery
description: Bootstraps or repairs the module catalog and verification matrix from the tree, real import edges, and build manifests. Use when adopting the harness or when catalog lint reports unmapped paths.
---

# Catalog Discovery

## Task

Produce a catalog and matrix that match this tree's real import edges, with attribute tiers
the engine refused to guess decided by a person.

## Preconditions

- A fresh `install` into a committed git repository already runs discovery
  (`catalog.source: "discovered"`). Use this skill to preview, to redo after the tree changed
  shape, or when install reported `source: "template"`.
- Live contracts (`harness/module-catalog.json`, `verification-matrix.json`) are never
  overwritten in place when they have been edited; drafts land beside them.

## Invariants

- Attribute proposals are a reason to look, never a tier. Guessed `security: critical` on
  `src/**` and `shared: true` on every module are exactly what discovery refuses to ship.
- An unmapped tracked path escapes every targeted gate.
- Drafts are never distributed.

## Method

1. Preview: `node scripts/harness.mjs catalog discover`. Read `proposed_modules`, `real_edges`,
   `detected_commands`, `attribute_proposals`, and `needs_decision`.
2. Decide what the engine refused to guess: attribute tiers (from what a failure would cost),
   forbidden dependencies (commitments, not observations), layer order. Accept: a written
   reason per tier. Reject: copying this harness's own runtime attributes into a target.
3. Write the draft: `catalog discover --write`. Merge by hand.
4. Prove coverage: `catalog lint` must report every tracked path as mapped, global, or ignored
   with a reason. Then `arch-check`.
5. Record the decisions in `progress.md`.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.
