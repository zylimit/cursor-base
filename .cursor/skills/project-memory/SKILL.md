---
name: project-memory
description: Records decisions, constraints, and in-flight work to progress.md so a cleared or compacted session can resume. Use after a decision, at the end of a work unit, or when recovering context.
---

# Project Memory

1. Read `progress.md` before writing so entries merge rather than duplicate.
2. File each item under **Pinned / Decisions / Done / In progress / Not doing / Risks**.
3. Record a decision with its rejected alternative and the reason, not just the outcome.
4. Downgrade anything hedged ("maybe", "probably") to a note marked as unconfirmed.
5. Never edit or delete existing `Pinned` or `Decisions` entries; append a superseding one instead.

Keep secrets, long command output, machine paths, and diff restatements out of the file.

To recover context, derive it from files rather than from a summary:
`node scripts/harness.mjs recap`, then `task status`, then `quality status`. After a compaction
the invariants are re-injected on the next tool call; `node scripts/harness.mjs invariants`
prints the same set on demand.

Before ending a turn that changed governed code, `node scripts/harness.mjs sync-check` confirms
the ledger moved with it. When `recap` reports the ledger over budget, `archive --apply` moves
the oldest entries whole into `progress.archive.md`; nothing is deleted.

Load [REFERENCE.md](REFERENCE.md) for the section contract and archiving rules.
