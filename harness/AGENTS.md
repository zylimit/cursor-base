# Harness contracts

## Purpose

The machine-readable contracts the harness enforces: `module-catalog.json` (what the modules
are, what they depend on, which attributes they hold), `verification-matrix.json` (which checks
exist and what they evidence), `assurance-policy.json` (how much evidence a change needs), and
their JSON schemas. `default-*.json` are the templates the installer starts a repository from.

## Boundaries

- Edit the non-default files for this repository; the defaults are templates and travel with
  the harness.
- A module's `attributes` state what a failure would cost. Raising a tier adds evidence a gate
  will demand; lowering one removes it. Neither is a formatting change: record the reason.
- `allowFastSkip` may be set only on checks that evidence no security, safety, or privacy
  attribute; `validate` rejects the rest.
- A named assurance profile may only tighten the profile it extends; floors may only be raised
  above the hard minima.
- Every tracked path must be mapped, global, or ignored with a reason (`catalog lint`).

## Invariants

- Changes here are governance changes: the assurance policy floors them to `strict`, so the
  gate runs every module's checks and completion needs lens-covered review.
- `dependsOn` should match the real import edges (`arch-check`); a new edge is drift until it is
  declared or removed.
- The schemas are the contract; a field the schema does not know is a mistake, not an extension.

## Verification

`node scripts/harness.mjs validate`, `catalog lint`, `arch-check`, `profile list` (compiles the
policy), then `gate`. `catalog discover` proposes a fresh draft from the tree when the map has
drifted far.
