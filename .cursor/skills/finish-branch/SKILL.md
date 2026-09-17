---
name: finish-branch
description: Closes a branch cleanly — probes the git environment, passes the test gate, offers the merge, PR, or keep options the environment allows, executes what was authorised, cleans up safely. Use when a feature is complete.
disable-model-invocation: true
---

# Finish Branch

Nothing moves until the environment is known and the tests are green. Finishing a branch never
implies commit, push, rebase, merge, or worktree removal on its own — each is an authorised
action.

## Task

Probe, gate, offer at most three real options, execute what was authorised, clean up without
losing work.

## Preconditions

- Recover what the user already chose in this session so an already-made decision is not
  turned back into a menu.
- Invoke by name.

## Invariants

- Never merge from detached HEAD. Never carry a dirty tree into a merge.
- A `git push` of authorised work does not ask again; a force push always does.
- Delete a branch only when it is merged (`git branch -d`, never `-D`). A branch with an open
  PR stays.
- A test PASS is never dressed as a human confirmation. HUMAN and AGENT sections stay apart.

## Method

1. Write the envelope. **Probe**: branch or detached; linked worktree or ordinary; clean or
   dirty; commits ahead of main; upstream. One line: "ordinary branch `x`, tree clean, 4
   commits to land on `main`".
2. **Test gate**: `review-pack`, `gate`, `quality status` (`closable` true). A red is triaged
   (`root-cause-debugging` or `test-design`) and re-run. A repository with no tests gets the
   infrastructure first or an explicit unprotected close.
3. Record in `progress.md`. For a release, `release readiness`.
4. **Offer only what the environment allows** (merge, PR, keep; worktree adds cleanup;
   detached HEAD creates a branch first). Execute the authorised action and verify each step
   against reality. A conflict stops; the agent never picks sides.
5. **Clean up**. Baseline before and after: `git status`, `git worktree list`, the expected
   branch.

Accept: an option the environment can actually perform. Reject: rebase on a dirty tree;
bulk-discard as "cleanup"; publishing because the branch finished.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the environment table and the handoff format.
