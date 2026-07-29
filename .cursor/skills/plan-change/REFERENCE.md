# Plan Change Reference

## Evidence pass

Start from ownership files, manifests, entrypoints, public contracts, relevant tests, and recent history. In a large repository, partition investigation by module and record only paths, symbols, dependency edges, and unresolved questions.

Use `explorer` when the pattern is unknown. Use `impact-analyst` when behavior, schema, API, events, persistence, configuration, or more than one module may change.

## Plan format

```text
Outcome:
Known evidence:
Decisions:
Risks and mitigations:
Steps:
  1. Owned paths/symbols
     Change
     Dependencies
     Verification
Escalation points:
Not included:
```

Each step must be coherent, path-bounded, and testable. Put shared contracts before consumers and cleanup after behavior. Do not schedule parallel writes to shared manifests, generated output, migrations, or overlapping paths.

## Verification design

Map each changed behavior to a check. Begin with diff inspection and module-local checks; add direct dependents, contract tests, integration boundaries, or broad checks according to impact. Identify unavailable checks under `Not verified`, not as assumed success.
