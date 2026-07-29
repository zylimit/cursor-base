# Operations

## Expected commands

From the repository root with Node.js 20+:

```sh
node scripts/harness.mjs doctor
node scripts/harness.mjs validate
node scripts/harness.mjs test
```

`doctor` should diagnose prerequisites and governance integrity without changing machine state. `validate` should check asset structure, metadata, links, and policy invariants. `test` should run the harness's own deterministic tests. Command availability and success must be reported from actual execution; documentation is not evidence that they passed.

## Repository exploration

Start from the task's module and inspect manifests, owners, entrypoints, dependency edges, public contracts, nearby tests, and recent relevant history. Search narrowly, summarize evidence, and avoid loading vendored/generated trees.

For large repositories, partition by module or ownership boundary. Maintain a small evidence map containing paths, symbols, dependencies, and open questions.

## Verification ladder

1. Inspect changed paths and the complete diff.
2. Run syntax/format/static checks for affected files or module.
3. Run nearest unit or contract tests.
4. Test direct dependents and relevant integration boundaries.
5. Run broader build or repository checks when policy or risk requires.

Stop expanding when evidence covers the stated risk, unless a required gate remains. Record skipped levels under `Not verified`.

## Failure handling

- Reproduce before fixing.
- Distinguish product defects from environment, flaky tests, and missing prerequisites.
- Do not kill an unknown process to reclaim a port; identify it and ask.
- Do not install a missing tool or dependency without approval.
- Preserve logs needed as evidence, but exclude secrets and unnecessary repository content.
- Return a partial receipt when blocked.

## Branch finish

Before handoff, inspect status and diff, run affected verification, request read-only review, and bind review evidence to the base commit plus canonical diff hash. Never automatically commit or push.
