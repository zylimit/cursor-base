---
name: dfx-design
description: Derives measurable quality targets (DFX) from business loss across thirteen dimensions, with threat and compliance tables, latency budgets, and wired checks, or scores a design. Use at design time.
disable-model-invocation: true
---

# DFX Design

DFX evaluates a design; it does not generate one. Quality attributes are cheapest at design
time and most expensive retrofitted.

## Task

**Design-in mode** produces `DFX-Spec.md` and wires tiers into the catalog. **Review mode**
scores an existing design and changes no file.

## Preconditions

- Spec required. Architecture lets tiers be set per module; without it, tier globally and mark
  "refine per module after architecture".
- Design brief carries the interaction floor so DFX cites it rather than restating it.
- Invoke by name. Do not auto-run on a harness-only change.

## Invariants

- "Highly reliable" is a wish. "Error rate < 0.1% weekly" is a target.
- Targets come from **loss**: who is hurt, in which business window, what they lose, what the
  current remedy is.
- A compliance word appearing (personal data, payments, health, minors, public services,
  signatures, cryptography, open-source redistribution) makes the law a requirement the user
  did not have to state. Confirm current versions against official sources.
- Not applicable is `N/A` with a reason. Small projects write one line per dimension and
  expand only `critical` and `high`.

## Method

1. Write the envelope. Scan for implicit compliance before any dimension. Hits enter the
   compliance table and are written back to the spec with its changelog.
2. Walk the thirteen dimensions one at a time as a six-element scenario (source, stimulus,
   environment, artefact, response, response measure) with a measurable target, the design
   means, and the verification that will evidence it.
3. Fill the tables the dimensions demand (threat, compliance, latency budget) when their
   triggers appear. Wire tiers into `harness/module-catalog.json` when it exists.
4. Review mode: score only; do not edit the design to make the score nicer.

Accept: a wired check for every `critical` / `high` target. Reject: nines asked of a business
person; a dimension left blank; inventing a law version from memory.

## Handoff

`dev-plan` gets each dimension's verification in the phase that delivers it; critical and high
verification never wait for the last phase.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the dimension table and threat triggers.
