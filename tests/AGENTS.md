# Tests module

## Purpose

End-to-end tests that drive the compiled runtime through `scripts/harness.mjs` in temporary
repositories. What passes here is what an installed repository runs.

## Boundaries

- Tests spawn the CLI; they do not import engine modules. A behavior that cannot be reached
  through the CLI or a hook payload is not covered here.
- Fixtures live under the OS temp directory and are removed in `t.after`; nothing is written
  into this repository's working tree.
- Do not weaken an assertion, delete coverage, or mark a failure flaky without evidence in the
  same change.

## Invariants

- Supervised processes started by a test are stopped as a tree before the fixture is removed;
  a leaked process is named in the log, not hidden by a retry.
- Windows and POSIX both run every test (CI matrix); a fix that only holds on one host is not
  a fix.
- Test names state the guarantee under test, so a failure reads as a broken guarantee.

## Verification

`node --test` from the repository root, or `node --test --test-name-pattern="<name>"` for one
test. Both files run in CI on Ubuntu and Windows, Node 22 and 24.
