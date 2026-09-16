# Finish Branch Reference

## Readiness criteria

- Diff matches the task envelope and preserves unrelated user changes.
- No unresolved conflict markers, secrets, debug artifacts, or accidental generated files.
- Changed behavior has focused tests or an explicit evidence-based reason.
- Required checks ran, or each deferred quality check has owner, reason, exact scope, expiry, and compensation.
- Safety checks are satisfied; safety cannot be waived.
- Review receipt matches the current full base commit and canonical diff hash.
- Remaining compatibility, rollout, migration, and operational risks are visible.

## Environment table

| Environment | Detect | Menu |
| --- | --- | --- |
| ordinary branch | `git symbolic-ref -q HEAD` prints a ref; git-dir equals common-dir | merge into main and push / open a PR / keep working |
| linked worktree | git-dir differs from common-dir, and it is not a submodule | the three above, plus worktree removal after the change has landed; the main worktree may hold the target branch — merge there, or push and pull |
| detached HEAD | `git symbolic-ref -q HEAD` prints nothing | `git switch -c <name>` first, then the ordinary menu; never merge or leave from detached HEAD |

Dirty tree in any environment: commit or stash first, on the user's word; never rebase, switch,
or merge over it.

## Cleanup rules

- Delete a branch only when `git branch --merged <main>` lists it; use `-d`, whose refusal on an
  unmerged branch is the protection; a branch with an open PR stays until the PR is merged.
- Remove a worktree only when its changes are merged or pushed and `git status --porcelain` is
  empty; prefer the host's own worktree tooling, fall back to `git worktree remove`.
- Baseline before and after: `git status`, `git worktree list`, the expected current branch.

## Authorisation

Finishing a branch authorises nothing by itself. Commit, push, tag, PR, merge, and remote deletion
each need an authorisation that covers the target and the action; one explicit instruction that
covers several of them is not split into repeated confirmations; a plain push of authorised work
does not ask again (approval tiers); a force push and remote history rewrites always do. After a
timeout or an interruption, inspect the local and remote state before retrying — a local success
is not a remote fact.

## HUMAN / AGENT sections

Commit bodies and PR descriptions keep two sections. **HUMAN**: the user's stated intent, the
corrections they made, and what a person actually verified or explicitly did not. **AGENT**: the
changes under the current rules, the evidence (commands, exit codes, receipt hashes), the known
limits. Superseded readings cite the new decision; an AI summary or a green test never poses as a
human confirmation.

## Handoff

```text
Status:
Changed:
Verified:
Not verified:
Needs review by:
Evidence:

Base commit:
Diff hash:
Review decision:
Waivers:
Action taken / cleanup / baseline:
Suggested next action:
```

If the diff changes after review, mark review stale. Do not silently regenerate or claim approval.
A clean tree is not a business acceptance; the report says what the user can now use or review,
where it lives, and what remains unverified.
