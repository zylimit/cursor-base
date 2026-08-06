# Work Protocols

## Task envelope

Every delegated task uses the same envelope:

```text
Goal: Observable outcome.
Scope: Owned modules, files, symbols, and allowed side effects.
Out of Scope: Explicit exclusions and unrelated work to preserve.
Existing Pattern: Relevant implementation, convention, or "not yet located".
Verification: Commands or evidence required for completion.
Escalation: Conditions that require stopping and returning control.
```

Missing information is not permission. A role may inspect read-only context to fill low-risk gaps; it must escalate when a gap changes scope, safety, public behavior, or ownership.

## Completion receipt

Every role returns:

```text
Status: complete | partial | blocked
Changed: Files/symbols changed, or "none".
Verified: Checks actually run and their outcomes.
Not verified: Required or relevant checks not run, with reason.
Needs review by: Human or role required next, or "none".
Evidence: Commands, focused output, paths, commits, hashes, or reproduced behavior.
```

Do not infer success from silence. `Verified` contains only executed checks.

## Verification receipt

`node scripts/harness.mjs gate` executes the affected verification plan and records one receipt
per check:

```text
Check: id and class from the verification matrix
Binding: base commit, canonical diff hash, and plan hash
Status: PASS | FAIL | BLOCKED | SKIPPED
Exit code: process result, or null when the command never ran
Evidence: path, byte count, and hash of the captured output
```

`BLOCKED` means the check could not run — no command configured, or the executable is absent.
A blocked check is never a pass. Structural validation of the harness itself proves nothing about
project behavior and never produces a verification receipt.

A receipt is valid only for the diff it was bound to. Any edit invalidates every receipt, and the
completion gate reports the affected checks as missing until the gate runs again.

## Ledger chain

Receipts are stored in a hash-chained ledger: each entry carries
`chain_sha256 = sha256(previous_chain + content_sha256)`, rotation carries the last dropped
chain value as an anchor, and the file records the expected head. Deleting a FAIL to resurrect
an old PASS, editing a signed receipt, or rewriting the tail all break verification. A broken
chain fails closed: `quality status` treats every check as unverified until the gate rebuilds
trusted receipts. `quality verify` additionally re-hashes referenced evidence files and reports
`TAMPERED` or `MISSING` for the current diff. This is local tamper evidence, not a
cryptographic identity claim.

## Waiver binding

A waiver defers one named check on one exact diff: it records `check`, `diff_sha256`,
`base_commit`, `owner`, `reason`, `scope`, `expiry`, `compensation`, and `approval` (where the
approval happened — an audit record, not an identity proof). A waiver applies only to a check
that could not run (`MISSING`, `BLOCKED`, `SKIPPED`); an executed `FAIL` is evidence of a
defect and is never waivable. Security-class checks and checks evidencing a critical-tier
attribute refuse waivers at creation. Any edit moves the diff and silently expires the waiver.

## Service state

Supervised services record `state.json` under `.cursor/harness-state/services/<name>/`.
Liveness is always synthesized from pids at read time; recorded status is trusted only for the
deliberate terminal states `stopped` and `crashed`. A state file claiming supervision whose
supervisor pid is dead reports `dead`, which is a high-severity risk finding.

## Review receipt

A review receipt is valid only for one immutable review target:

```text
Base commit: full Git object ID
Diff hash: SHA-256 of the canonical reviewed diff
Scope: paths and exclusions
Reviewer: identity or agent role
Decision: approve | comment | request-changes
Findings: stable IDs with severity and evidence
Not reviewed: explicit gaps
```

Canonicalize the diff using the repository harness when available. If the base commit, diff bytes, scope, or exclusions change, invalidate the receipt and review again. A branch name or working-tree description alone is not a stable binding.

## Handoff rules

- Read-only roles return evidence, not edits.
- The implementer owns scoped writes; the tester reports failures without opportunistic production edits.
- Parallel reads are safe by default. Parallel writes require explicit, disjoint path ownership and a stated integration owner.
- A blocked role returns partial evidence immediately rather than widening scope.
