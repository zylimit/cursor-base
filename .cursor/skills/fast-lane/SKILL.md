---
name: fast-lane
description: Opens a dated fast loan that defers pre-declared checks as recorded debt, then repays it. Use under deadline pressure; never to skip security, safety, or privacy evidence.
disable-model-invocation: true
---

# Fast Lane

A loan buys time, not permission. Every deferred check is recorded and must be repaid by
running it.

## Task

Open a dated loan, work, repay with a later PASS. Never close a task or a release on borrowed
evidence.

## Preconditions

- A reason and a window. Policy cap `maxLoanMinutes` (≤ 24h).
- The effective profile's `deferral` is `loan`. `strict` refuses the loan.
- Invoke by name. Announce the loan to the user before opening it.

## Invariants

- Only checks the matrix pre-declared `allowFastSkip` defer. Protected checks still run.
- A gate in which everything was deferred is `BLOCKED`.
- A loaned gate is complete for the window and never `closable`.
- Only a later PASS of the same check repays the debt.

## Method

1. `node scripts/harness.mjs fast on --minutes 60 --reason "demo at 15:00"`.
2. `gate`. Read `loan.deferred`. Work. Do not `task complete` or `release readiness` as if
   evidence existed.
3. Repay: `fast off`, then `gate` again. `debt list` shows what is still owed.
4. If the loan expires with debt open, `risk` reports it at high severity. Repay first.

Accept: a named reason, a finite window, a debt list. Reject: using this to skip security /
safety / privacy; treating a loaned green as closable.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, listing
deferred checks under `Not verified` until they are repaid.
