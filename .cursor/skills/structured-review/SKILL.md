---
name: structured-review
description: Runs the staged multi-lens review whose verdict the harness computes from located findings. Use under the strict profile, for releases, or when a change touches a trust boundary.
disable-model-invocation: true
---

# Structured Review

The engine counts what happened and computes the verdict. Nobody asserts it. Daily `balanced`
work does not run this skill.

## Task

Bind a review to the current diff, collect located findings per convened lens, and let
`review verdict` write the receipt.

## Preconditions

- Effective profile `strict`, a release, or a trust-boundary path. Convened lenses default to
  correctness and security; attributes may shrink the team, never grow it past the profile.
- Invoke by name.

## Invariants

- Every finding has a `file:line` location or a reproduction. One `error` is never outvoted.
- Blue's self-account is a target for the red lenses, never grounds for passing anything.
- Reviewers are read-only. The orchestrator submits `review lens`. A self-review cannot carry
  ACCEPT where authorship was recorded.
- Three rejected rounds escalate. Nobody resets the count with a fresh reviewer.
- A claimed independence cannot close a release (`release readiness`).

## Method

1. `node scripts/harness.mjs review-pack` — deletions first.
2. `review start`. Note convened lenses (`review team`).
3. `review blue` with claims that name evidence. JSON stdin or a claims file.
4. One `reviewer` subagent per convened lens of the open stage, in parallel. Submit with
   `review lens <lens> --agent <id>` from JSON stdin or `--file findings.md` (lines
   `- error path:line summary`). Empty stages are skipped.
5. When a stage is clean the next opens. Then `review verdict --reviewer <name>`.
6. `FIX_REQUIRED`: fix, re-open on the new diff. `NEEDS_MORE_EVIDENCE`: supply exactly what
   the lens named. `ACCEPT` at the final stage writes the engine receipt.

Accept: located findings, a computed verdict, authorship recorded when it can be. Reject:
hand-writing `receipt --lenses` to satisfy `reviewMode: structured`; running nine lenses on a
docs-only change.

## Handoff

Fixes through the normal chain. Domain clues to `domain-rulings`. Return **Status / Changed /
Verified / Not verified / Needs review by / Evidence** with the verdict and receipt path in
`Evidence`.

Lens ownership and contracts: `docs/REVIEW.md`.
