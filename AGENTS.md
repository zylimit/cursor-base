# Repository Instructions

- Protect user work: never discard, overwrite, or reformat unrelated changes.
- Safety controls are never waivable. Stop on destructive, secret-bearing, privileged, or unclear operations.
- Inspect before editing; follow the nearest existing pattern and keep changes within the task scope.
- Parallelize independent reads. Serialize writes unless ownership boundaries are explicit and disjoint.
- Verify the smallest affected module and diff first; expand only when risk or evidence requires it.
- Never push, commit, kill processes or ports, install dependencies, or change machine configuration without explicit approval.
- Report what changed, what was verified, what was not verified, and evidence. Never claim a check ran when it did not.
- Treat Windows sandboxing and path isolation as defense in depth, not an absolute security boundary.
