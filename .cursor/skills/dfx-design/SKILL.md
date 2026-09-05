---
name: dfx-design
description: Rates a design against the DFX dimensions (reliability, serviceability, testability, security, cost) and turns each into a measurable target with a wired check. Use at design time, before implementation.
---

# DFX Design

DFX (Design for eXcellence) is an evaluation methodology, not a design generator: it does not
produce the design, it decides whether the design is good enough on each dimension and what
evidence will prove it. Quality attributes are cheapest at design time and most expensive
retrofitted.

1. Write the task envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
2. Rate every DFX dimension for the module under design: `critical`, `high`, `medium`/`low`, or
   `none` with a written reason. Not rating a dimension is a rating — it means nobody looked.
3. For every `critical` or `high` rating produce the triple: a **measurable target** ("highly
   reliable" is not a specification), the **design means** that achieves it, and the
   **verification** that will evidence it.
4. Wire the result: declare the tiers in `harness/module-catalog.json` `attributes`, and make
   sure a check in the verification matrix claims each attribute — `adapters list` shows
   curated external tools. A declared attribute no check claims is a visible gap, not a plan.
5. Prove the wiring: `node scripts/harness.mjs quality attributes` must show the declared
   tiers covered or honestly uncovered, and `catalog lint` must accept the declarations.

Cost symmetry is part of the method: every tier raised adds verification cost to every future
change of that module. Raising everything to critical is not rigor; it is how teams end up
disabling the checks wholesale.

Return the standard receipt: **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the dimension checklist, the rating rules, and the
mapping from DFX dimensions to enforceable quality attributes.
