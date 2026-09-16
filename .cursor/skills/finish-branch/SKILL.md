---
name: finish-branch
description: Closes a branch cleanly — probes the git environment, passes the test gate, offers the merge, PR, or keep options the environment allows, executes what was authorised, cleans up safely. Use when a feature is complete.
---

# Finish Branch

Closing actions rewrite history or delete things, so nothing moves until the environment is known
and the tests are green; and finishing a branch never implies commit, push, rebase, merge, or
worktree removal on its own — each is an authorised action.

1. Confirm **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**; recover
   what the user already chose in this session so an already-made decision is not turned back
   into a menu.
2. **Probe before acting**: on a branch or detached (`git symbolic-ref -q HEAD`); in a linked
   worktree (`git rev-parse --git-dir` differs from `--git-common-dir`, excluding the submodule
   false positive — a `.git` file pointing into `modules/` or a parent `.gitmodules` entry means
   "ordinary branch"); clean or dirty (`git status --porcelain`); commits ahead of the main
   branch (`git log --oneline <main>..HEAD`); upstream and ahead/behind. Report it in one line —
   "ordinary branch `x`, tree clean, 4 commits to land on `main`" — and never carry a dirty tree
   into a merge.
3. **Test gate**: inspect the complete diff (`review-pack` shows deletions and renames apart);
   run `node scripts/harness.mjs gate`, then `quality status` — `closable` must be true and its
   `blockers` name what is missing (a receipt, an unpaid loan, an uncovered attribute); obtain
   the review the profile demands (approving receipt at `balanced`, structured-review verdict at
   `strict`). Runner output is the evidence; "it should pass" is not. A red is triaged — code
   defect to `root-cause-debugging`, test defect to `test-design` — and re-run to green; a
   repository with no test infrastructure gets the infrastructure first or the user's explicit,
   recorded release of an unprotected close.
4. Record the outcome in `progress.md` (`sync-check` confirms the ledger moved with the code);
   for a release run `release readiness`.
5. **Offer only what the environment allows**, at most three real options: ordinary branch —
   merge into main and push, open a pull request (needs the forge CLI), or keep working; linked
   worktree — the same three plus cleanup afterwards, remembering the main worktree may already
   have the target branch checked out (merge there, or push and pull); detached HEAD — create a
   branch first (`git switch -c`), then the ordinary menu; never merge from detached HEAD, the
   commits have no name to return to. An option the user already chose is executed, not re-asked.
6. **Execute the authorised action and verify each step against reality**: a commit — new HEAD and
   the committed file set; a push — the remote ref; a PR — base, head, contents, state; a merge —
   target branch and conflict state (a conflict stops and reports; the agent never picks sides);
   a `git push` of authorised work does not ask again, a force push always does. Commit and PR
   descriptions keep a **HUMAN** section (the user's stated intent, corrections, and what a person
   verified or did not) apart from an **AGENT** section (the changes against the current rules,
   the evidence, the limits) — a test PASS is never dressed as a human confirmation.
7. **Clean up without losing work**: delete a branch only when it is merged (`git branch -d`,
   never `-D`; a branch with an open PR stays); remove a worktree only when its changes are merged
   or pushed and its tree is clean; run the baseline before and after — `git status`, `git
   worktree list`, the expected branch — and report "tree clean, no stray worktrees, on `main`".

Never publish, force-push, kill ports, install dependencies, rebase or switch branches on a dirty
tree, use bulk-discard commands as "cleanup", or overwrite user changes without explicit
authorisation. A remote operation that times out or breaks off is checked on the remote before any
retry.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, naming the
action taken, the cleanup, and the baseline.

Load [REFERENCE.md](REFERENCE.md) for readiness criteria, the environment table, and the handoff
format.
