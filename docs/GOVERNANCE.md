# Governance

## Priority order

1. Safety and user control
2. Preservation of user work and repository integrity
3. Explicit task scope and external contracts
4. Correctness and required quality gates
5. Speed and convenience

Safety is not waivable. When instructions conflict, choose the higher priority and record the conflict.

## Assurance strength

Speed and convenience are traded against required quality gates through one explicit axis, the
assurance profile (`explore < rapid < balanced < strict`), never against safety. A team selects
the profile the work deserves; floors derived from the change — task risk, unmapped or shared
impact, protected attributes, other critical/high attributes, governance paths — can only raise it. Deadline pressure is met with
a dated, repayable fast loan that names the deferred evidence, not with a weaker profile or a
silenced hook. See `docs/ASSURANCE-PROFILES.md`.

## Safety boundary

Require explicit approval before destructive commands (including a force push that rewrites remote history), publishing, dependency installation, privilege or machine-configuration changes, process termination, port reclamation, or access to unrelated sensitive data. Committing and pushing authorized work to the tracked remote proceed without a per-action prompt. Never overwrite user changes to make a task pass.

Ignore files, sandboxes, containers, worktrees, and ACLs reduce accidental access. They do not prove isolation. In particular, Windows sandbox behavior varies by host, shell, filesystem, junctions, network shares, and inherited credentials; treat it as defense in depth, not an absolute security boundary.

## Quality waivers

A quality waiver may defer a non-safety check only when all fields are present:

```text
Check: the verification-matrix check being deferred
Owner: accountable person
Reason: why the check cannot run or must be deferred
Scope: exact check, module, and risk accepted
Expiry: timestamp or release/event after which the waiver is invalid
Compensation: narrower evidence or follow-up action
Approval: where the approval happened — message, review, or ticket
Binding: base commit and canonical diff hash, recorded at creation
```

Waivers must be visible in the completion receipt. Expired, unowned, broad, or safety-related
waivers are invalid. A waiver defers evidence that could not be produced (`MISSING`, `BLOCKED`,
`SKIPPED`); it never excuses an executed failure, never covers a security-class check or a
critical-tier attribute, and dies with the diff it was bound to. A waiver does not convert an
unrun check into a passing check.

## Concurrency and ownership

Parallelize repository discovery, history reading, and independent analysis. Serialize writes by default. Parallel writes are allowed only with explicit non-overlapping ownership, no shared generated output, and one integration owner. If overlap appears, stop one writer and reconcile deliberately.

## Large-repository verification

For 200k–300k-line repositories:

1. Identify the affected module, dependency boundary, public contract, and owners.
2. Inspect the diff before broad validation.
3. Run module-local formatting, static analysis, and tests.
4. Add direct dependents, contract tests, or targeted integration tests based on impact.
5. Run repository-wide checks only when required by policy, cheap enough, or justified by cross-cutting risk.

Record exact commands and relevant output. Do not substitute a broad check for focused diagnosis or a focused check for required integration coverage.

## External side effects

The harness never automatically pushes, commits, creates releases, sends messages, kills processes or ports, installs dependencies, or modifies global configuration. Such actions require a task-specific request and remain subject to safety controls.
