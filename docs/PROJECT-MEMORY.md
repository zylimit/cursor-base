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

`Decisions` is the section that is most often skipped and most expensive to lose. A recovered
session can read `Done` and see what happened, but without `Decisions` it cannot tell why, so it
re-litigates settled questions or silently violates a constraint.

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

## Recovery

To resume cold: read `progress.md`, then `node scripts/harness.mjs task status`, then
`node scripts/harness.mjs quality status`. The first tells you the intent, the second tells you
what was in flight, and the third tells you what is still unproven.
