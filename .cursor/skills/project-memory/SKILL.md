---
name: project-memory
description: Records decisions (basis, scope, supersession), constraints, and in-flight work to progress.md within budget, and recovers a cleared or compacted session from files. Use after a decision or to recover context.
---

# Project Memory

1. Read `progress.md` before writing so entries merge rather than duplicate; the project's spec,
   spec changelog, and plan are read alongside it when they exist — recovery from `progress.md`
   alone is not recovery.
2. File each item under **Pinned / Decisions / Done / In progress / Not doing / Risks** (optional
   **TODO** with `P0`/`P1` and stable ids, **Notes**). Record at the moment the language appears —
   "we decided", "must", "finished", "needs" — not at the end of the turn; `sync-check` reports
   governed code that moved without the ledger.
3. A **Decision** carries three elements or it is a status update that belongs under `Done`: the
   **basis** (why, and the alternative rejected), the **scope** (where it applies and where it does
   not), and what it **supersedes** (or "none"). Before appending, run the supersession check —
   which existing entry does this conflict with, overturn, or narrow? — and mark the old one
   "→ superseded <date>" in place; an unmarked contradiction leaves two truths for the next
   session to choose between. A user's correction is the hardest decision there is and always
   names what it supersedes.
4. **Pinned** holds at most about fifteen entries: it is the part every recovery reads, and a long
   Pinned is read by nobody. To add a sixteenth, demote the weakest to a Decision or merge it with
   its kin. **Decisions** past thirty are moved whole — by hand, oldest first, with a one-line
   pointer left behind; `recap` does not read the archive. The contract these steps apply — the
   sections, the three elements, the caps — is defined in `docs/PROJECT-MEMORY.md`, which wins
   where the two differ.
5. Downgrade anything hedged ("maybe", "probably", "consider") to `Risks` or `In progress`,
   marked unconfirmed — never to `Decisions`, which later sessions read as settled;
   `Done` says what finished and the evidence boundary — an implementer's "implemented" is not
   "tested" and not "accepted"; an unfinished whole stays `In progress` with an owner. The text of
   an existing `Pinned` or `Decisions` entry is never altered or deleted; the one permitted touch is
   appending the "→ superseded <date>" mark at its end, and the new reading is a new entry.

Keep secrets, long command output, machine paths, and diff restatements out of the file; do not
log every code edit — decisions, constraints, completions, hazards, and open work only.

To recover context, derive it from files rather than from a summary: `node scripts/harness.mjs
recap`, then `task status`, then `quality status`; then the spec, its changelog, and the plan for
a product project (a missing one is named and degraded, never invented). After a compaction the
invariants are re-injected on the next tool call; `node scripts/harness.mjs invariants` prints the
same set on demand.

Before ending a turn that changed governed code, `node scripts/harness.mjs sync-check` confirms
the ledger moved with it. When `recap` reports the ledger over budget, `archive --apply` moves the
oldest `Done` and `Notes` entries beyond their caps whole into `progress.archive.md`; nothing is
deleted. A correction that still lives only in an old Note is moved into a Decision before the
archive takes the Note.

Return the standard receipt: **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the section contract, entry shapes, the supersession
check, the three memories and their boundaries, and archiving rules.
