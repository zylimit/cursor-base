# Work Protocols

## Task envelope and dispatch pack

Two names, one object: the **envelope** is the six fields every delegated task carries; the
**pack** is the envelope plus **Business Context**, seven fields, required on every coding,
review, and test dispatch of product work. No other *dispatch* artefact is called either name.
The evidence artefacts are named for the command that builds them — the **context pack**
(`context-pack`) and the **review pack** (`review-pack`) — and a bare "the pack" always means
the dispatch pack.

```text
Goal: Observable outcome. On product work the first line names the tier (LOW / MEDIUM / HIGH).
Scope: Owned modules, files, symbols, and allowed side effects.
Out of Scope: Explicit exclusions and unrelated work to preserve.
Existing Pattern: Relevant implementation, convention, or "not yet located".
Business Context: Why this task exists and who benefits; the spec's rules and exceptions that
  apply; the progress.md Pinned and Decisions entries that apply, cited by date; the recorded
  lessons the user taught that apply; the domain rulings that match — copied from those sources,
  never composed from memory. Required on every coding, review, and test dispatch of product
  work; internal maintenance states its scope instead ("fixes an internal documentation link; no
  product behaviour changes"). Never "N/A".
Verification: Commands or evidence required for completion; an explicit user exemption is written.
Escalation: Conditions that require stopping and returning control.
```

Missing information is not permission. A role may inspect read-only context to fill low-risk
gaps; it must escalate when a gap changes scope, safety, public behavior, or ownership. A pack
carries file paths and quoted rules, not a summary of earlier tasks — a fresh delegate inherits no
history, and a pack built from history is mostly noise. A LOW or MEDIUM pack fits in "file:line,
change to what, one verify command" and expects about six tool calls; a HIGH pack writes its
budget under Verification; a delegation expected to run over an hour is a decomposition failure.

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

Product work adds three fields; each is `None` when empty and never padded:

```text
Business assumptions: judgements the spec did not make and the role made itself.
Counter-examples: the code matches the spec while the spec fails the business —
  scenario → what the spec gives → what the business needs → basis. Reported as
  "requirement in doubt"; handled by product-spec iteration mode, never patched in code.
Domain findings: how something is counted in this field, met while working, with the evidence
  in hand (a measured value, a field's real format, a store's real state, an interface's real
  behaviour). A clue, not a ruling: the orchestrator triages it (domain-rulings); without
  evidence it is not written.
```

Do not infer success from silence. `Verified` contains only executed checks. The orchestrator
judges against the diff and the runner's raw output, never against the report; reading evidence
may be delegated, the pass-or-fail judgement is not. A new file is not proved by `git diff`
(empty output and exit 0 look exactly like "unchanged") but by `git status`, a line count, and a
content anchor.

## Escalation ladder

A role that returns `blocked` or asks for context is re-dispatched only after one variable
changes, in this order: supply the missing context and re-dispatch a fresh instance; cut the
scope and re-slice the task; switch a defect to root-cause analysis; escalate to the user. The
same prompt to the same configuration is a wager, not a retry. Three consecutive failures of one
check redirect to root-cause analysis instead of a fourth run (`quality status`, `risk`).

## Task tiers

On product work each task is tiered mechanically before dispatch — LOW, MEDIUM, HIGH — from the
expected diff size, the path classes it touches, and whether it adds a dependency; any criterion
met raises the tier, unsure means higher. The tier selects the profile (`rapid`, `balanced`,
`strict`) and with it the independence required; the floors may only raise it. The criteria, the
profile, and the independence are one table, in `docs/PRODUCT-WORKFLOW.md`; the numbers are not
restated here, so there is one place to change them.

### Tier vocabulary

These scales, one word each, never mixed:

| Scale | Values | Set by | Decides |
| --- | --- | --- | --- |
| task tier | LOW / MEDIUM / HIGH | diff size, path classes, new dependencies | the profile and the independence for one task |
| intrinsic risk | low / medium / high | `task start --risk`, the spec's risk input | the profile floor |
| attribute tier | critical / high / … / none | the module catalog per quality attribute | which gaps block and what may never be waived |
| exposure class | personal / internal / external / money / regulated | the spec's Overview | interview depth and acceptance rigour |
| finding severity | error / warning / info in a review lens; high / medium / low in a whole-diff review | the reviewer, per finding | what blocks: `review lens` accepts only the first set and one `error` sets `FIX_REQUIRED`; a whole-diff review blocks on `high` |
| review stage | `code-review` pass 0 / 1 / 2 (static, spec, quality); structured-review stage 1 / 2 / 3 (code, functional, trust) | the review skill in force | which work that skill runs; the two numberings are not interchangeable |

"S / M / L" in a design document is a sizing estimate, not any of these. The two severity scales
are not interchangeable spellings: submitting `high` to `review lens` is refused.

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

`BLOCKED` means the check could not run — no command configured, or, for a command that is one
program with literal arguments, a program that resolves to nothing. A command a shell must
interpret (pipeline, variable, keyword, `.cmd` shim) runs through the shell, and a program the
shell cannot find is that shell's non-zero exit, recorded as `FAIL`. Neither is ever a pass. Structural validation of the harness itself proves nothing about
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
attribute refuse waivers at creation, and so does a `reason` or `scope` whose words name a
safety or external-side-effect control — `safety`, `security`, `secret`, `credential`,
`destructive`, `push`, `deploy`, `production`. Any edit moves the diff and silently expires the
waiver.

## Service state

Supervised services record `state.json` under `.cursor/harness-state/services/<name>/`.
Liveness is always synthesized from pids at read time; recorded status is trusted only for the
deliberate terminal states `stopped` and `crashed`. A state file claiming supervision whose
supervisor pid is dead reports `dead`, which is a high-severity risk finding.

## Stop-hook strikes

The completion gate blocks a turn that ends with unresolved work, but one unresolved state may
block only a bounded number of times before control is handed back, so a stale gate cannot
deadlock a session. The strike key is the change (`base_commit`, `diff_sha256`) plus the exact
outstanding reasons, so making progress — a different diff or a different blocker — resets the
count rather than spending a strike on new work. At the limit (3) the hook records a
`stop-strike-release` in the ledger and returns without a follow-up; the release never marks the
work complete and says so.

## Readiness operations

`release readiness` reports, and performs nothing. It binds one of two subjects: `--operation
package` binds the working tree (a dirty tree is expected, so the clean-tree and upstream-sync
conditions do not gate), while `--operation release` (the default) ships commits and keeps both.
The strict gate, review, fast-loan, evidence-debt, open-task, and manifest conditions are
identical for both, because a package that cannot pass the release gate is not worth building.

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

## Assurance resolution

Every plan carries the assurance profile that governed it:

```text
Selection: explore | rapid | balanced | strict | adaptive   (project or task; `profile set`)
Requested: the selection, or the policy default under adaptive
Floors:    source -> profile: reason   (risk, impact:<kind>, attribute:<module>/<name>, path:<id>)
Effective: the strongest of requested and every floor
Controls:  the eight resolved controls plus reviewLenses
Hash:      sha256 of effective controls; part of the plan hash
```

A floor may only raise. A named profile may only tighten its parent. Changing the selection
stales receipts exactly as changing the module set or the risk does.

## Fast loan and evidence debt

```text
Loan:  reason, by, minutes (<= policy maxLoanMinutes <= 1440), opened_at, expires_at, task
Debt:  check, modules, diff_sha256, plan_sha256, reason, opened_at, paid_at, paid_by
```

A check is deferred only when a loan is open, the effective profile permits deferral, the matrix
pre-declared the check `allowFastSkip`, and the check evidences no protected attribute. The
deferred receipt is `SKIPPED` with `deferred: true`. A debt is repaid only by a `PASS` of the same
check created after the debt opened; closing or expiring the loan repays nothing. `complete` may
be true under a loan; `closable` never is while debt is open.

## Review session

```text
Binding:   base commit and diff hash at `review start`; any tree change makes the session stale (exit 4)
Convened:  profile reviewLenses minus lenses whose attribute no affected module declares above minimal; correctness always
Blue:      claims with evidence (refused otherwise)
Lens:      findings with severity and file:line or reproduction; `unable` with a reason
Stage:     1 code -> 2 functional -> 3 trust; a stage opens when the previous one reported clean
Verdict:   FIX_REQUIRED (any error) | NEEDS_MORE_EVIDENCE (any unable) | ACCEPT; refused when a convened lens is silent
Receipt:   a final ACCEPT writes an approving review receipt with `lenses` recorded
Rounds:    each FIX_REQUIRED counts; at maxRounds (3) the verdict sets escalate
```

## Exit codes

`0` ok · `1` violation or invalid input · `2` gate failure, refused completion, FIX_REQUIRED ·
`3` degraded (the harness refused to guess) · `4` stale (evidence no longer binds the tree).

## Handoff rules

- Read-only roles return evidence, not edits.
- The implementer owns scoped writes; the tester reports failures without opportunistic production edits.
- Parallel reads are safe by default. Parallel writes require explicit, disjoint path ownership and a stated integration owner.
- A blocked role returns partial evidence immediately rather than widening scope.
- Every delegate is a fresh instance with no session history; what it needs is given explicitly.
  The tester is a different instance from the implementer of the code under test.
- Fan-out is for read-only, independently summarisable work — review lenses, test targets,
  exploration; coding stays serial by default. Parallel delegation multiplies token cost several
  times over and needs the user's explicit opt-in; "faster" is asked for by cutting scope, not
  by spreading writers.
- A role speaks to the orchestrator only; the orchestrator is the single voice to the user, and
  the only one who fetches missing business facts from them.
