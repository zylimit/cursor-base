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
  Scope: the harness runtime; a host project may still choose a database for its own data.
  Supersedes: none.
  Consequence: concurrent writers need a lock, added in the state layer.
```

A decision entry without a rejected alternative is a status update; file it under `Done`. A
decision without a scope gets applied where it should not be; a decision without a supersession
line leaves the old entry standing as a second truth. A superseded entry is marked in place:

```text
- 2026-04-02 Receipts are plain JSON files, one per check. → superseded 2026-05-12
```

## Supersession check

Before appending a Decision or a Pinned entry: read the existing entries for the one this
conflicts with, overturns, or narrows; mark it "→ superseded <date>" at its end without altering
its text; write the new entry with its scope. In one sibling ledger, 3 of 149 decisions had ever
been marked superseded — that is what skipping this step looks like from the outside. An append
without the check is not finished.

## Caps

Pinned holds about fifteen entries: it is read on every recovery, and a long one is read by
nobody. The sixteenth demotes the weakest to a Decision or merges with its kin. Decisions past
thirty archive with a one-line pointer (count, date range, "hard constraints still in force are in
Pinned"). A ledger that had grown to 286KB cost a third of a context window per recovery; the caps
exist for the moment reading speed matters most.

## Three memories

`progress.md` holds project decisions, constraints, completions, hazards, and open work. The
feedback corpus (`docs/feedback/`, `record-lesson`) holds method lessons — how the agent should
ask, decide, verify. `domain/` (`domain-rulings`) holds how things are counted in the field,
independent of this project. One user correction often produces one entry in two of them, each
pointing at the other. The host's own automatic memory, where it exists, keeps machine-local
trivia; decisions are recognised only here, and recovery reads files, never that memory.

## Recovery reads a set, not a file

`recap` → `task status` → `quality status`, then the product project's spec, spec changelog, and
plan (their default names are `Product-Spec.md`, `Product-Spec-CHANGELOG.md`, `DEV-PLAN.md`; a
project that chose others keeps them). A missing document is named and the recovery degraded; no
second copy of a source of truth is created because a filename differed. Reading `progress.md`
alone does not count as recovered; the same holds after a cleared session.

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
