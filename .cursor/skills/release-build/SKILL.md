---
name: release-build
description: Builds, packages, and under explicit authorisation publishes or deploys; audits the real artefact for leaks, tests the installed form, verifies deployment independently. Invoke by name only.
disable-model-invocation: true
---

# Release Build

Release is a side-effecting workflow. A spoken "ship it" is answered by pointing at the
command, not by running it. `release-readiness` assembles the proof and stops; this skill
performs the one authorised action and verifies it against the world.

## Task

Carry out exactly the action the user authorised — build, package, publish, or deploy — in
their name, one step at a time.

## Preconditions

- Explicit authorisation for this action, this channel, this platform. "Release" never implies
  force-push, production migration, version overwrite, or external notification.
- `node scripts/harness.mjs release readiness --operation package|release` has nothing failing.
- Sign-in and signing certificates are the user's to supply.

## Invariants

- The harness engine performs no release action. This skill does not weaken the approval tier.
- Audit the **actual artefact** (unpacked package, image, or bundle), never the source tree.
  One leak hit stops the release.
- Deployment is verified by three independent facts, never by the deployer's word.
- A claimed (not machine-checked) review independence cannot close `--operation release`.

## Method

1. Ask what is wanted and to which channel. Write the envelope. Detect the tools; do not
   install them.
2. Gate. Confirm the version bump, changelog, and a clean tree for a release. Read the build
   script's full lifecycle before running it — same-named `build` / `install` / `package` steps
   may upload or start processes.
3. Build. Audit the artefact for personal paths, databases, credentials, keys, user data,
   API-key patterns, harness state.
4. Test the installed form, not the working tree.
5. If publish or deploy was authorised, perform that one action, then verify independently.
   Report rollback versus forward-fix options; do not choose.

Accept: authorisation, a clean readiness report, an artefact audit with zero hits, three-fact
verification. Reject: tagging because the gate was green; publishing because the skill was
named.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.
