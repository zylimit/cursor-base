# ADR template

One file per decision under `docs/adr/NNNN-<kebab-title>.md`. `node scripts/harness.mjs adr-check`
reads `Status:` and `Enforced-by:` and fails a live decision whose `Enforced-by` names anything
other than a verification-matrix check id or a built-in fitness rule id, or names nothing; a
`superseded`, `deprecated`, or `rejected` status exempts the record. There is no "manual review"
token: a decision no check can see is recorded in `progress.md` Decisions, or earns a fitness
rule or a matrix check first — an ADR that claims enforcement it does not have reads as enforced,
which is worse than silence. `Revisit-if:` and `Reversal:` are read by people (prompt-only until
the check learns them) and are still mandatory: a decision without a revisit condition keeps
being built on a premise that stopped holding, and one without a reversal is treated as cheap when
it is not.

```markdown
# <N>. <Decision in one sentence>

Status: accepted
Date: YYYY-MM-DD
Enforced-by: <verification-matrix check id, e.g. arch-check, catalog-lint | built-in fitness rule id>
Revisit-if: <an observable condition — "daily actives above 50k", "multi-tenancy required", "team above three maintainers", "the vendor stops maintaining it"; never a date>
Reversal: <what undoing costs and roughly how long — "swap the ORM: twelve files in storage plus one data migration, about three days"; or "one-way door" when no reversal can be written>

## Context

<Two or three sentences or a short story; scope down to the concrete modules or connections.>

## Drivers

<Quality attributes, constraints, team capability, failure consequences — with sources.>

## Options

- <A>: good — …; bad — …
- <B>: good — …; bad — …

## Decision

<Chosen option and which driver it satisfies.>

## Consequences

<Good and bad; the bad ones also appear under risks and technical debt.>

## Rejected alternatives

<Each with its reason. A decision without a rejected alternative was never considered.>
```

Rules of thumb: at least the style, the storage, and the inter-module communication get an ADR;
the enforcement token must be real (`node scripts/harness.mjs adr-check` lists the unknown
references; the matrix's check ids and `fitness` rule ids are the only valid values); the one-way
doors are listed for the user before the design is approved.
