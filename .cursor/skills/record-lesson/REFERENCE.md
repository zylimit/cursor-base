# Record Lesson Reference

## What qualifies

- A user correction of agent behavior ("I said X, you did Y") — the strongest signal there is.
- A defect whose cause generalizes beyond the specific file ("configuration defects recur in
  sibling instances", not "line 42 had the wrong timeout").
- A workflow gap hit twice: the second occurrence is the lesson.
- A gate or check that fired on a real problem in a way worth institutionalizing — or that
  demonstrably never fires and should be questioned.

What does not qualify: one-off environment noise, preferences without an incident behind them,
and anything already covered by an existing lesson (increment that one instead).

## Writing contract

The lint (`feedback lint`) enforces structure; these rules keep the content useful:

- Title states the instruction, not the story: "Re-read live state before destructive
  operations", not "The incident of August 7th".
- Body: what happened (2–3 sentences), what to do instead (imperative, usable without this
  context), evidence (command, output, diff, or conversation reference).
- Conclusions and constraints only. Debugging narrative slows every future recovery read.
- No secrets, no personal data, no internal URLs that would leak if the file were ever shared.
  The corpus never ships with the installer, but write as if it might be read aloud.

## Honesty rules

- `occurrences` counts independent events, not restatements in the same session.
- Recording a lesson is not the fix. If the incident broke something, the fix and its receipt
  are separate work; the lesson records the class, not the instance.
- Do not inflate: a lesson recorded to justify a decision already made is advocacy, not memory.

## Graduation targets, in order of preference

1. **Executable check** — a fitness rule, verification-matrix check, or hook behavior. Fires
   only when violated; costs nothing otherwise.
2. **Skill step** — when the lesson changes how a workflow should run.
3. **Rule text** (`.cursor/rules/`, `AGENTS.md`) — last resort, because always-applied prose
   costs context on every request. Reserve it for invariants that checks cannot see.

Graduation requires the user's confirmation: promotion changes repository policy, and policy
changes are theirs to approve. After promotion set `graduated: true`; the risk scan stops
proposing it, and the file remains as the recorded rationale.
