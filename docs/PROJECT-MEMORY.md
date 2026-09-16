# Project Memory

A long task outlives any single session. Context is compacted, sessions are cleared, and the
agent that resumes has only what was written down. Project memory is the file that survives.

## What to record

Keep `progress.md` at the repository root with these sections:

```text
## Pinned          Constraints that must hold for every future session.
## Decisions       What was decided and why, with the alternative that was rejected.
## Done            Completed work, newest first.
## In progress     Work started but not finished, and where it stopped.
## Not doing       Proposals that were considered and declined, with the reason.
## Risks           Known hazards and unverified areas.
```

Two optional sections are understood as well: `## TODO` (prioritised next steps; `recap` lists
the `P0`/`P1` items) and `## Notes` (observations, newest first; archived like `Done`).

`Decisions` is the section that is most often skipped and most expensive to lose. A recovered
session can read `Done` and see what happened, but without `Decisions` it cannot tell why, so it
re-litigates settled questions or silently violates a constraint.

A decision carries three elements — the **basis** (why, and the alternative rejected), the
**scope** (where it applies and where it does not), and what it **supersedes** — or it is a
status update that belongs under `Done`. Before appending one, find the entry it overturns or
narrows and mark that entry "→ superseded <date>" in place; two unmarked contradicting entries
leave the next session to pick one. A user's correction is the hardest kind of decision and always
names what it supersedes.

Caps keep recovery fast: `Pinned` holds about fifteen entries (the part every recovery reads);
`Decisions` past thirty archive with a pointer, moved by hand, because `archive --apply` moves
the oldest `Done` and `Notes` only — teaching it `Decisions` is a recorded follow-up, and until
then the cap is kept manually. `recap` does not read the archive. A ledger that grew to hundreds
of kilobytes once cost a third of a context window per recovery.

This file is the home of the section contract, the three elements of a decision, and the caps.
The `project-memory` skill carries the method — when to record, how to run the supersession
check, what never to record — and states these rules only as far as its steps need them; where
the two differ, this file is right.

## When to record

Record at the moment the information appears, not at the end:

- a choice between alternatives was made;
- a constraint was stated ("must not", "always", "only when");
- a unit of work finished or was abandoned;
- a hazard was discovered.

## What not to record

No secrets, no long command output, no machine paths, and no restatement of the diff. Memory is
for the reasoning that the code cannot show.

## Relationship to harness state

`.cursor/harness-state/` holds machine state — receipts, baselines, the ledger, the compaction
note. It is regenerated, git-ignored, and meaningless to a human reader. Project memory is
written for the next person and belongs in version control. Neither replaces the other.

## Three memories

Project memory is one of three, each with its own home and its own test:

| Memory | Holds | Home | Test |
| --- | --- | --- | --- |
| project | decisions, constraints, completions, hazards, open work | `progress.md` | "does this project depend on it?" |
| method | how the agent should ask, decide, verify — the user's corrections of behaviour | `docs/feedback/` (`record-lesson`) | "would another project stumble the same way?" |
| domain | how something is counted in the field, independent of this codebase | `domain/` (`domain-rulings`) | "who knew this originally? neither of us, until we looked" |

One user correction often produces a business fact (spec and `progress.md`) and a method lesson
(feedback corpus) at once; record both, pointing at each other, without copying the conversation.
A host's own automatic memory, where it exists, keeps machine-local trivia; decisions are
recognised only in `progress.md`.

## Recovery

To resume cold: read `progress.md`, then `node scripts/harness.mjs task status`, then
`node scripts/harness.mjs quality status`. The first tells you the intent, the second tells you
what was in flight, and the third tells you what is still unproven. A product project adds its
spec, spec changelog, and plan (`Product-Spec.md`, `Product-Spec-CHANGELOG.md`, `DEV-PLAN.md` by
default; a project that chose other names keeps them) — reading `progress.md` alone is not
recovery, and a missing document is named and the recovery degraded, never replaced by a second
copy of a source of truth.
