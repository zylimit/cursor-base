# Quality Attributes

Verification proves that a check ran. It does not, by itself, say what property the check
established. This layer closes that gap: a module declares which quality attributes it must hold
evidence for, checks declare which attributes they evidence, and coverage becomes decidable.

## Attributes

Drawn from ISO/IEC 25010, narrowed to what a repository can hold evidence for:

`security`, `resilience`, `privacy`, `safety`, `reliability`, `availability`, `performance`,
`maintainability`.

## Six strengths

Uniform strictness is its own defect. Applied everywhere it makes a throwaway prototype as
expensive as a payments service, and the usual response is to disable checks wholesale rather than
tune them. So a declaration carries a strength:

| Tier | Enforcement | Meaning |
| --- | --- | --- |
| `critical` | blocks | Absence of evidence blocks completion and cannot be waived |
| `high` | blocks | Absence of evidence blocks completion; a waiver may defer it |
| `medium` | warns | Reported as a gap; does not block |
| `low` | records | Recorded for review only |
| `minimal` | listed | Listed on request; requires a written reason |
| `none` | opted out | Deliberately not enforced; requires a written reason |

`minimal` and `none` require a reason because opting out is the state every attribute drifts
toward when it costs nothing. `catalog lint` rejects a bare `"none"`.

```jsonc
{
  "id": "payments",
  "attributes": {
    "security": "critical",
    "privacy": "high",
    "reliability": "high",
    "availability": { "tier": "none", "reason": "Library module with no service surface." }
  }
}
```

## Coverage

An attribute is covered when a check the module selected claims that attribute and passes.
Two rules matter:

- **A failing claim outweighs a passing one.** If one check says the property holds and another
  demonstrates it does not, the attribute is not covered. A demonstration of absence is stronger
  evidence than a partial demonstration of presence.
- **Declaring without wiring produces a visible gap, not silent success.** An attribute that no
  check claims is reported as uncovered. That is the honest state.

Report with `node scripts/harness.mjs quality attributes`.

## Runtime attributes bind to time, not to a diff

A load test or an SLO probe measures a deployed system. No diff hash describes it. Checks with
`class: "runtime"` are therefore accepted inside `runtimeValidityHours` (24 by default) and
labelled `time-window-<n>h` so the result is never mistaken for evidence about the code currently
in the working tree.

## Evidence integrity and deferral

The receipt ledger is hash-chained; a broken chain means every receipt in it is unusable, and
completion is assessed as if nothing was verified (see `docs/PROTOCOLS.md`, Ledger chain).

A diff-bound waiver can defer a check that could not run. The deferral is visible on the check
(`waived`), a `high`-tier attribute gap defers only when every claiming check holds a valid
waiver, and a `critical` tier never defers. An attribute with no claiming checks cannot be
waived at all — that is a wiring defect in the catalog or matrix, and an exemption must not
paper over it.

## Task risk widens the plan

`task start --risk high` (or `--risk` on `gate`/`verify-plan`) unions the matrix's `riskChecks`
lists into the plan cumulatively: high runs the low and medium lists too, so raising declared
risk can only add evidence. The risk level is part of the plan hash, so changing it invalidates
receipts gathered under a narrower selection.

## Built-in rules

`node scripts/harness.mjs fitness` runs pattern rules that need no external tool, so they work on
day one in any language: credential literals, personal data in log statements, empty exception
handlers, unbounded retry loops, and unreferenced deferral markers.

Rule strength follows the declared tier. A rule with `minimumTier` only fires where the module
asked for that strength, and a rule whose attributes the module set to `none` never fires. Add
`harness-fitness:ignore` on the offending line or the line above to suppress one finding; it
suppresses that finding only, not the rule.

Extend or replace the pack with `harness/fitness-rules.json`. Set `"replace": true` to drop the
defaults instead of appending to them.

These rules are heuristics over text. They reduce the set of defects nobody looked for; they do
not establish that a property holds.

## External tools

The harness bundles nothing and installs nothing. `node scripts/harness.mjs adapters list` shows
curated command templates with their attributes and whether the executable is present;
`adapters add <id>` writes the check into the verification matrix. A check whose executable is
absent is reported `BLOCKED`, never passing.

Wiring a check does not select it. Add the check to the `verification` list of every module that
needs its evidence.

## Boundaries between checks and decisions

`module-catalog.json` can express two prohibitions that `arch-check` enforces against real import
edges rather than intent:

- `forbiddenDependencies` names modules this module must never import. This is how a privacy
  boundary becomes executable: `analytics` must not reach `pii-store`.
- `layers` plus a per-module `layer` restricts dependencies to the same layer or further inward.

A forbidden edge outranks a declared one. Declaring and forbidding the same edge is a
contradiction, and the prohibition is the stronger statement.

`node scripts/harness.mjs adr-check` requires every decision record that has not been explicitly
retired to name, in an `Enforced-by:` line, at least one verification check or fitness rule that
exists. Naming a check that does not exist fails: a phantom reference is worse than none, because
it reads as enforced.

## What this does not do

It establishes that declared attributes have real, executed evidence. It does not establish that
the attributes hold. Personal-data detection misses cases, static analysis misses logic flaws, and
a valid SLO file is not an available system. What it removes is the state where nobody checked.
