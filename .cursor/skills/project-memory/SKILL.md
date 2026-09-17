---
name: project-memory
description: Records decisions (basis, scope, supersession), constraints, and in-flight work to progress.md within budget, and recovers a cleared or compacted session from files. Use after a decision or to recover context.
---

# Project Memory

## Task

Keep `progress.md` truthful within budget, and recover a cleared or compacted session from
files rather than from a summary.

## Preconditions

- Read `progress.md` before writing. For a product project also read the spec, its changelog,
  and the plan when they exist.
- Contract: `docs/PROJECT-MEMORY.md` wins where this skill and the file differ.

## Invariants

- A **Decision** carries basis (why, and the alternative rejected), scope (where it applies
  and where it does not), and supersession (or "none"). A status update belongs under `Done`.
- The text of an existing Pinned or Decisions entry is never altered or deleted. The one
  permitted touch is appending `→ superseded <date>`.
- Hedged language ("maybe", "probably", "consider") is `Risks` or `In progress`, never a
  Decision.
- Secrets, long command output, machine paths, and diff restatements stay out of the file.

## Method

1. File each item under **Pinned / Decisions / Done / In progress / Not doing / Risks** at the
   moment the language appears — "we decided", "must", "finished", "needs" — not at the end of
   the turn.
2. Before appending a Decision, run the supersession check: which existing entry does this
   conflict with, overturn, or narrow? Mark the old one in place. A user's correction always
   names what it supersedes.
3. Pinned holds at most about fifteen entries. To add a sixteenth, demote the weakest. Decisions
   past thirty are moved whole, oldest first, with a one-line pointer left behind (`archive
   --apply` for Done and Notes).
4. To recover: `node scripts/harness.mjs recap`, then `task status`, then `quality status`.
   After a compaction the invariants are re-injected; `invariants` prints the same set on
   demand. Before ending a turn that changed governed code, `sync-check`.

Accept: a three-element Decision recorded the same turn as the language. Reject: logging every
code edit; inventing a missing spec or plan during recovery.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the section contract, entry shapes, and archiving rules.
