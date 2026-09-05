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

`node scripts/harness.mjs gate` performs steps 2–5 for the affected modules and records a
diff-bound receipt for each check. Passing checks print nothing beyond their status; only
failures carry output, and full output always goes to an evidence file rather than the
transcript. `node scripts/harness.mjs quality status` reports which checks still lack a passing
receipt for the current diff.

Stop expanding when evidence covers the stated risk, unless a required gate remains. Record skipped levels under `Not verified`.

The breadth of step 2–5 is set by the effective assurance profile (`verify-plan` shows it):
`rapid` runs the changed modules' checks, `balanced` their reverse-dependency closure, `strict`
every module. Floors from task risk, impact, protected attributes, and governance paths only
widen it. Under a fast loan (`fast on`), checks the matrix pre-declared `allowFastSkip` are
deferred and recorded as debt; run the gate again with the loan closed to repay them. See
`docs/ASSURANCE-PROFILES.md`.

## Working at a chosen strength

```sh
node scripts/harness.mjs profile show            # effective profile, floors, open loan, debt
node scripts/harness.mjs profile set rapid       # or balanced, strict, explore, adaptive; --task ID for one task
node scripts/harness.mjs fast on --minutes 60 --reason "..."   # loan; announce it to the user first
node scripts/harness.mjs fast off && node scripts/harness.mjs gate   # repay
node scripts/harness.mjs debt list
```

## Structured review

```sh
node scripts/harness.mjs review-pack
node scripts/harness.mjs review start
node scripts/harness.mjs review blue  < claims.json
node scripts/harness.mjs review lens correctness --agent <id> < findings.json
node scripts/harness.mjs review verdict --reviewer <name>
```

Delegate one `reviewer` subagent per convened lens of the open stage; each returns findings
JSON (reviewers are read-only) and the orchestrator submits it with `review lens ... --agent`.
The verdict is computed from what was recorded. Rules and input contracts: `docs/REVIEW.md`.

## Memory

```sh
node scripts/harness.mjs recap            # resume from files, not from a summary
node scripts/harness.mjs invariants       # what is re-injected after a compaction
node scripts/harness.mjs sync-check       # did progress.md move with the governed code?
node scripts/harness.mjs archive --apply  # move old Done/Notes entries whole into progress.archive.md
```

## Governance integrity

```sh
node scripts/harness.mjs instructions     # instruction files as untrusted input (security class)
node scripts/harness.mjs rules-audit      # enforced / prompt-only / phantom / unenforced rules
node scripts/harness.mjs skills-lint      # frontmatter the loader can read
node scripts/harness.mjs agents-lint      # nested AGENTS.md where a protected attribute blocks
node scripts/harness.mjs catalog discover # propose a catalog and matrix; --write to save
```

## Release

`node scripts/harness.mjs release readiness` evaluates every release condition under the strict
floor — clean tree, remote sync, gate, review, loans and debt, open tasks, memory, manifest,
changelog, CI — and reports `PASS | FAIL | BLOCKED`. It performs no release action; its
`trust_boundary` fields are false by construction.

## Failure handling

- Reproduce before fixing.
- Distinguish product defects from environment, flaky tests, and missing prerequisites.
- Do not kill an unknown process to reclaim a port; identify it and ask.
- Do not install a missing tool or dependency without approval.
- Preserve logs needed as evidence, but exclude secrets and unnecessary repository content.
- Return a partial receipt when blocked.
- A check that has failed three consecutive runs is a diagnosis problem, not a retry problem;
  `quality status` says so explicitly. Follow root-cause-debugging before running it again.

## Supervised services

`node scripts/harness.mjs service start|stop|status|list|logs` runs development services under
a supervisor: crash restart with exponential backoff, a restart-storm breaker (a service that
keeps crashing is marked `crashed` and left down with its log intact — the fault is not
transient), and an optional health probe that treats "alive but not serving" as an outage.
`status` reports liveness from pids, never from recorded state, so a supervisor lost to a
reboot shows as `dead` rather than `running`.

The supervisor only terminates processes it started itself, start/stop are explicit commands,
and it is a development-time guardian — production supervision belongs to the platform. See the
`service-operations` skill for incident playbooks.

## Risk scan

`node scripts/harness.mjs risk` turns silent state decay into findings with severities: a
broken ledger chain, a task active past its useful life, a check failing repeatedly, crashed or
dead services, quarantined state files, expired waivers, and lessons that recurred enough to
graduate. The sessionStart hook surfaces the worst findings automatically; `--strict` makes
high findings fail the command for use in CI.

## Retention

Evidence is collected redacted and destroyed on schedule: `node scripts/harness.mjs retention`
applies the policy in the module catalog (`retention` section; defaults: 30 days, 200 evidence
files, 50 context packs). Evidence referenced by a current-diff receipt or the newest receipt
per check is never deleted, so fresh receipts stay verifiable — destroying history is the
policy's job, destroying the ability to verify the present would be a defect. `--dry-run`
previews. Quarantined `*.corrupt-*` files are forensic evidence and are left alone.

## Branch finish

Before handoff, inspect status and diff, run affected verification, request read-only review, and bind review evidence to the base commit plus canonical diff hash. Never automatically commit or push.
