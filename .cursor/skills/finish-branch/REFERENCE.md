# Finish Branch Reference

## Readiness criteria

- Diff matches the task envelope and preserves unrelated user changes.
- No unresolved conflict markers, secrets, debug artifacts, or accidental generated files.
- Changed behavior has focused tests or an explicit evidence-based reason.
- Required checks ran, or each deferred quality check has owner, reason, exact scope, expiry, and compensation.
- Safety checks are satisfied; safety cannot be waived.
- Review receipt matches the current full base commit and canonical diff hash.
- Remaining compatibility, rollout, migration, and operational risks are visible.

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
Suggested next action:
```

If the diff changes after review, mark review stale. Do not silently regenerate or claim approval. A ready handoff does not authorize commit, push, merge, release, or external messaging.
