# Project Memory Reference

## Section contract

| Section | Holds | Mutability |
| --- | --- | --- |
| Pinned | Constraints every future session must respect | Append only; supersede rather than edit |
| Decisions | Choice, rejected alternative, reason, date | Append only |
| Done | Finished work, newest first | Append; archive when long |
| In progress | Started work and where it stopped | Rewrite as work moves |
| Not doing | Declined proposals and why | Append |
| Risks | Known hazards and unverified areas | Rewrite as risks close |
| TODO (optional) | Prioritised next steps; `P0`/`P1` items surface in `recap` | Rewrite as work is picked up |
| Notes (optional) | Observations that fit nowhere else, newest first | Append; archived like Done |

## Entry shape

```text
- 2026-05-12 Chose file-based receipts over a database.
  Rejected: embedded SQLite — adds a dependency the runtime is designed not to have.
  Consequence: concurrent writers need a lock, added in the state layer.
```

A decision entry without a rejected alternative is a status update; file it under `Done`.

## Confidence

Hedged statements are not decisions. If the wording contains "maybe", "probably", "we could", or
"consider", record it under `Risks` or `In progress` and mark it unconfirmed. Promoting a guess
to `Decisions` is worse than not recording it, because later sessions treat that section as
settled.

## Archiving

`node scripts/harness.mjs archive --apply` moves the oldest `Done` entries beyond `keepDone`
(default 40; `keepNotes` 30 for the optional Notes section) into `progress.archive.md` whole and
leaves a pointer; `recap` reports when the ledger is over its byte or entry budget. The limits
live under `memory` in `harness/module-catalog.json`. An unbounded file slows every recovery,
which is exactly when reading speed matters most.

## What the harness records instead

`.cursor/harness-state/` holds verification receipts, the session baseline, the hook ledger, the
shell log, and the pre-compaction note. Those are machine-checkable facts, regenerated and
git-ignored. Do not copy them into project memory; reference the command that reproduces them.
