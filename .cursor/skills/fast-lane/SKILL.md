---
name: fast-lane
description: Opens a dated fast loan that defers pre-declared checks as recorded debt, then repays it. Use under deadline pressure; never to skip security, safety, or privacy evidence.
---

# Fast Lane

A loan buys time, not permission. Every deferred check is recorded and must be repaid by running it.

1. Announce the loan to the user, then open it with a reason and a window:
   `node scripts/harness.mjs fast on --minutes 60 --reason "demo at 15:00"`.
2. Run `node scripts/harness.mjs gate`. Checks the matrix marked `allowFastSkip` are `SKIPPED`
   (deferred) and appear under `loan.deferred`; protected checks still run. A gate in which
   everything was deferred is `BLOCKED`.
3. Work. `quality status` stays green for the window but is never `closable`; do not try to
   complete a task or a release on borrowed evidence.
4. Repay before the window matters: `fast off`, then `gate` again. `repaid` lists the debts a
   fresh PASS settled; `debt list` shows what is still owed.
5. If the loan expires with debt open, `risk` reports it at high severity at the next session
   start. Repay it first.

Under `strict` the loan is refused (`deferral: none`); that is the profile working, not a bug.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, listing
deferred checks under `Not verified` until they are repaid.
