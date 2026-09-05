---
name: catalog-discovery
description: Bootstraps or repairs the module catalog and verification matrix from the tree, real import edges, and build manifests. Use when adopting the harness or when catalog lint reports unmapped paths.
---

# Catalog Discovery

A fresh `install` into a committed git repository already runs discovery and writes the result
(`catalog.source: "discovered"`); use this skill to preview first, to redo it after the tree
changed shape, or when the install reported `source: "template"`.

1. Preview: `node scripts/harness.mjs catalog discover`. Read `proposed_modules`, `real_edges`,
   `detected_commands`, `attribute_proposals`, and `needs_decision`.
2. Decide what the engine refused to guess: attribute tiers (from what a failure would cost),
   forbidden dependencies (commitments, not observations), layer order. Start with the modules
   under `attribute_proposals`; the evidence there is a reason to look, not a decision.
3. Write the draft: `catalog discover --write`. An edited catalog is never overwritten; the draft
   lands beside it as `harness/module-catalog.draft.json` for a merge.
4. Prove coverage: `node scripts/harness.mjs catalog lint` must report every tracked path as
   mapped, global, or ignored with a reason. Then `arch-check` starts clean because `dependsOn`
   came from the real edges.
5. Record the decisions and their reasons in `progress.md`.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.
