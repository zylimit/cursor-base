# Affected Verification Reference

## Verification ladder

1. Inspect status, changed paths, and complete diff.
2. Run file/module syntax, formatting, lint, or static checks.
3. Run nearest unit and regression tests.
4. Run changed contract and direct-consumer tests.
5. Run relevant integration, build, and end-to-end checks.
6. Run repository-wide gates when required or justified by cross-cutting impact.

Do not skip a required gate merely because a broader unrelated check passed. Do not run a costly broad suite when focused failures still need diagnosis.

## Evidence

For every command record working directory, command, exit outcome, and concise relevant output. Separate product, test, environment, prerequisite, and suspected flaky failures.

## Waivers

A non-safety quality check may be deferred only with:

```text
Owner:
Reason:
Scope:
Expiry:
Compensation:
```

Report it under `Not verified`. Missing or expired fields invalidate the waiver. Safety cannot be waived.
