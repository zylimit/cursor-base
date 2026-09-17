---
name: assurance-profile
description: Reads, selects, or explains the assurance profile (explore, rapid, balanced, strict) that decides how much evidence a change needs. Use before planning verification or when a gate refuses.
disable-model-invocation: true
---

# Assurance Profile

## Task

Read, select, or explain the profile in force. Do not argue with a floor.

## Preconditions

- `node scripts/harness.mjs profile show` is the source of truth. Floors list why the
  effective profile is stronger than the selection.
- Invoke by name. Everyday work uses the default plus floors; this skill is for an explicit
  selection or a refused gate.

## Invariants

- Four profiles, no fifth. Floors only raise.
- `balanced` closes on a passing affected gate. `strict` is for governance, trust boundaries,
  and releases (correctness + security lenses).
- Security, safety, and privacy evidence is never deferred.
- Changing the profile stales receipts. Re-run `gate` after `profile set`.

## Method

1. `profile show`. Read `floors`.
2. Pick the strength the work deserves:
   - `explore` — reading, spiking. No gate; nothing closes.
   - `rapid` — small, low-risk. Changed modules only.
   - `balanced` — default delivery. Dependents verified; gate closes the task.
   - `strict` — trust and release. Structured review.
   Product tiers (LOW / MEDIUM / HIGH) select `rapid` / `balanced` / `strict`. Table in
   `docs/PRODUCT-WORKFLOW.md`. Unsure means higher.
3. `profile set NAME` or `profile set NAME --task ID`. `adaptive` returns to the policy
   default plus floors.
4. If a floor raised the profile, lower the risk or split the change. Do not request a weaker
   profile to dodge it.
5. Under time pressure use `fast-lane`, not a weaker profile.

Accept: a named effective profile with its floors. Reject: a second assurance axis; treating
`rapid` as a waiver of safety hooks.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, naming the
effective profile in `Evidence`.

Full table: `docs/ASSURANCE-PROFILES.md`.
