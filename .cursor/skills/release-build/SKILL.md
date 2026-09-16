---
name: release-build
description: Builds, packages, and under explicit authorisation publishes or deploys; audits the real artefact for leaks, tests the installed form, verifies deployment independently. Invoke by name only.
disable-model-invocation: true
---

# Release Build

Release is a side-effecting workflow, so the user invokes this skill by name; a spoken "ship it"
is answered by pointing at the command, not by running it. `release-readiness` assembles the
proof and stops; this skill performs the authorised steps and verifies each one against the world,
not against a report.

Nothing here weakens the approval tier. The harness engine performs no release action of its own —
`release readiness` reports and stops — and publish and deploy stay in the Stop-for-approval tier
(`.cursor/rules/30-approval-tiers.mdc`). What this skill adds is the method for carrying out the
one action the user has already authorised, in their name and one step at a time. Without that
authorisation, naming the skill changes nothing.

1. Ask first what is wanted — build only, package, publish, or deploy — and to which channel and
   platform; authorisation covers exactly that action ("release" never implies force-push,
   production migration, version overwrite, or external notification). Write the envelope:
   **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**. Detect the
   tools the chosen channel needs; sign-in and signing certificates are the user's to supply.
2. Gate before building: `node scripts/harness.mjs release readiness --operation package|release`
   must have nothing failing — strict-floor gate, review receipt, no open loan or debt, no active
   task, clean tree and upstream for `release`. The test gate is not exempt because the
   instruction was "package": a regression run with fresh runner output for the changed
   behaviour is the same gate `phase-build` closes a phase with (its step 6, the four steps) and
   `finish-branch` runs before offering a merge — reused, not reinvented.
3. Confirm the version: package version bumped semantically, changelog updated, working tree
   clean for a release. Read the build script's full lifecycle before running it — same-named
   `build`, `install`, and `package` steps may install, upload, overwrite, or start processes;
   a tool's presence is not an authorisation. Check the actual dependency layout, not the
   declaration (a package-manager setting that says "hoisted" does not make the installed tree
   flat after an incremental install; packagers that walk symlinked trees care).
4. Build, then audit the **actual artefact** (the unpacked package, image, or bundle — never the
   source tree): personal paths (`/Users/`, home directories, machine names), databases and their
   journals, environment and credential files, keys and certificates, user data directories,
   API-key patterns, plaintext passwords, harness state or private evidence. One hit stops the
   release: fix, rebuild, re-audit; a bad package never leaves. Dependency audit shows no
   critical advisories; the build log shows no module-not-found; git author metadata exposes no
   personal information. A large batch earlier in the cycle had its duplicate-code scan
   (`phase-build` close); if not, do it now.
5. Test from the installed form, not the build directory: a desktop package installed into the
   system location and launched; a CLI installed globally and each core command smoked; a web
   deployment reached at its URL with no blank screen and a spec-driven smoke. Development
   passing is not package passing — paths, bundling, and permissions all differ.
6. Execute only the authorised action, one step at a time, checking the real state after each: a
   tag is preceded by `git ls-remote --tags` (local absence is not remote absence); a push, publish,
   or deploy that times out, disconnects, or returns a server error is treated as *possibly
   executed* — inspect the target before deciding whether to retry; never re-run the whole script
   for luck.
7. Verify a deployment with three independent facts, and never with the deployer's word: (1)
   the running instance's image tag and container creation timestamp are newer than the last
   commit (not "Up N minutes" — that can be a stale container's uptime); (2) the health endpoint
   returns success; (3) a live smoke against a real endpoint proves the new behaviour is present.
   Then clean temporary artefacts and confirm the version file is committed.
8. On failure of a step that changed an environment, roll back by the pre-agreed route and
   re-verify; a route with no authorisation goes back to the user. Web rolls back to the previous
   successful deployment; a distributed desktop package cannot be recalled — fix, bump, and
   republish; a published CLI version is deprecated and, when severe, unpublished within the
   registry's window, then republished under a new version. Data migrations and already-shipped
   binaries may only be fixed forward; say so instead of promising a rollback.

Forbidden: pushing, tagging, publishing, or deploying beyond the authorised action; printing or
storing secrets; unauthorised production migrations or deletions; backing the current artefact
with an older test result; blind repetition of a remote command; a dry run presented as a release.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, with the
commands, exit codes, versions or commits, artefact paths and digests, gate results, remote state,
health, and rollback entry points under `Evidence`.

Load [REFERENCE.md](REFERENCE.md) for the per-action evidence table, artefact-to-loaded-instance
tracing, the privacy audit list, failure recovery, and platform strategies.
