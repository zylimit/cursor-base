# Release Build Reference

## What each action must establish

| Action | Determine | Evidence that counts |
| --- | --- | --- |
| local build | build command, configuration and platform, output location, source version | the command and its exit status, the output actually exists, a local start or load check where applicable |
| local package | package type, version or source identifier, content scope, output location | final package path and digest, content listing and leak audit, the package-operation gate evidence |
| publish / release | channel, target version, assets, draft or final, overwrite policy | the channel's real state, assets fetchable with matching digest and origin; the tag checked only when the flow uses tags |
| deploy | target environment, exact artefact, affected users, configuration and migration boundary, health and rollback route | the environment's running version, health, a representative business smoke; the recovery result on failure |

Current evidence, unverified items, and risks travel with the artefact. A rollback plan applies to
actions that change an existing version or environment; producing a local file does not acquire a
production rollback, a remote tag, a formal release, or a service-health condition.

## Trace the object the user actually loads

| Link | Relation to establish | Not implied by it |
| --- | --- | --- |
| source tree / build | this build's source identifier, workspace scope, configuration, actual output | "the output directory exists" proves this build produced it; "the source changed" changes an old archive |
| final package | final path and digest, actual member set, key entry points and resources, version and content rules | a valid manifest proves the archive is complete; a passing build proves the filtered package still works |
| registered or installed copy | actual copy or link relation, resolved target, filter and rewrite steps, what the registration points at | a name in a list proves this source is used; a source hash represents a rewritten copy |
| loaded instance | the source and version this process or session actually uses, the real user entry, the necessary business observation | registration succeeded proves old sessions reloaded; a local mock entry proves the real host |

Work backwards from real references and confirmed functions: an entry point reads a resource →
confirm that resource survives packaging and installation filters, is reachable, and belongs to
this version. Check inside an authorised isolated unpack directory so the runtime cannot borrow a
file from the source workspace. When a filter, manifest rewrite, signature, or copy changes the
object, record the new identity; updating a manifest does not regenerate an archive — regenerate,
then audit the new artefact. Old staging beside a new archive, or new staging beside an old
archive, are both possible; never pick by filename or existence. If only `package` was authorised,
verify the package and state that installation and loading are unverified — do not install to
fill in the table.

## Privacy audit

Run on the unpacked artefact directory, never on the source tree:

- `grep -rn "/Users/"` and the equivalent home-directory and machine-name patterns for developer
  paths and personal information.
- `find` for `*.db`, `.db-shm`, `.db-wal`, environment files, `credentials*`, `*.pem`, `*.key`,
  user data directories, harness state, private evidence, session logs.
- `grep` for API-key prefixes, cloud access-key shapes, plaintext passwords, and the project's
  own secret patterns (`node scripts/harness.mjs fitness --all` runs the built-in secret rules).

Any hit stops the release. Fix the ignore or filter rules, rebuild, re-audit the new artefact. A
package that shipped with a personal path once was found only by auditing the artefact from the
archive — never the staging directory.

## Failure after the fact

Failure may land before checks, after copy, after registration, or after the remote commit.
Preserve the actual result, then sort: which actions certainly did not happen, which have readable
facts proving completion, which remain unknown.

- No side effect yet: fix the precondition, retry that step within the original authorisation.
- Partly done: check remaining dependencies, user customisations, and data state before
  continuing, compensating, or restoring. "A later step failed" is not "nothing earlier happened";
  partial success is not overall completion.
- Interrupted, timed out, or unclear response: query the channel's real state for the target
  version, object, or request ownership; keep unknowns unknown. Regaining network is not
  authorisation to recreate, overwrite, or delete.

Retry safety depends on current state, real idempotency, and the original authorisation — never
on the last exit code alone. Rollback and forward fix each need their own basis: shipped binaries,
irreversible data migrations, and channels that forbid version reuse may only be fixed forward;
removing a page, deleting a release, or uninstalling does not return every user and datum to the
old state. State the actual channel rule, not a generic "unpublish and it is fine".

## Platform strategies

- **Web**: build → privacy audit → production configuration (secrets in the platform, never in
  the code) → deploy and record the URL → open it, no blank screen → smoke against the spec.
  Rollback: the platform's previous successful deployment.
- **Desktop**: build → package per platform and check signing configuration (explain the bypass
  when there is no certificate) → privacy audit → the user installs from the package into the
  system location and launches → smoke. Rollback: none for distributed installers; fix, bump,
  repackage.
- **CLI**: build → privacy audit → publish or produce binaries → install globally and run each
  core command → smoke. Rollback: deprecate the version; unpublish within the registry's window
  when severe; republish under a new version.

## Stuck processes

A process at 0% CPU whose elapsed time keeps rising is deadlocked, not slow and not the network;
diagnose, do not wait. Packagers are sensitive to dependency layout; declaration and reality drift
after incremental installs — verify the real layout before packaging.

## Deployment acceptance, three facts

1. Image tag and container creation timestamp — the timestamp is later than the last commit and
   the tag is the target version. Never read the uptime column; it can belong to the container
   that was replaced.
2. Health endpoint returns success.
3. Live smoke: a request against a real endpoint shows the new behaviour's output exists, not
   merely that the process is up.

Any one missing means the deployment is not accepted, whatever the deployer reported.
