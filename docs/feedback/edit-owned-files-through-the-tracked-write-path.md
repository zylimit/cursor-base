---
id: edit-owned-files-through-the-tracked-write-path
occurrences: 2
first_seen: 2026-09-16
last_seen: 2026-09-16
graduated: false
---

# Edit files an active task owns through the tracked write path, never through a shell script

While an owning task was active, files under its scope were edited with `sed` and `python3`
heredocs instead of the agent's file-write tool. The task's `known_hashes` baseline is updated
only by the tracked write path, so the next legitimate edit to the same file was denied with
"changed outside this task since it was last written" — the guard could no longer tell a
deliberate edit from someone else's work, which is exactly its job.

Scenario: the second occurrence was a batch rename across one reference file, done with a
`python3` heredoc because seven headings needed the same substitution. The rename itself was
correct and desirable; the cost arrived one edit later, when a follow-up line-wrap on the same
file was blocked and could not be reconciled without restarting the task.

What to do instead: apply every edit to a path the active task owns through the agent's
file-editing tool, one edit per occurrence, even when a regex would be shorter. Use shell text
tools for reading and searching only. When a bulk substitution is genuinely needed, do it before
`task start`, or accept that the file is then frozen for the rest of the task.

Scope: any session with an active owning task, for every path inside its `--owned` scope.
Applies to `sed -i`, `python3` writes, `awk` redirects, `tee`, `>` and `>>`, and any other
out-of-band writer.

Exceptions: paths outside the task's owned scope are not tracked and not affected. Generated
artefacts written by a harness command that is itself the tracked writer — `manifest --write`,
`gate` evidence, review session state — are expected and do not trip the guard.

Supersedes: none.

Applied to: pending. Both occurrences were worked around in-session (once by cancelling and
restarting the task, once by abandoning a cosmetic edit); no rule, skill step, or check yet
carries it.

Evidence: two denials in one session from `preflightTaskWrite` (`src/task.mts:38-41`), on
`.cursor/skills/release-build/SKILL.md` and `docs/LARGE-REPO-GUIDE.md`, under task
`task-1789546034211-45136ab7`; the first is recorded in `progress.md` under the 2026-09-16
absorption work.
