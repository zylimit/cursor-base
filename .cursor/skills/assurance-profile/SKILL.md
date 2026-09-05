---
name: assurance-profile
description: Reads, selects, or explains the assurance profile (explore, rapid, balanced, strict) that decides how much evidence a change needs. Use before planning verification or when a gate refuses.
---

# Assurance Profile

1. Read what is in force and why: `node scripts/harness.mjs profile show`. The `floors` list
   names every reason the effective profile is stronger than the selection.
2. Pick the strength the work deserves, not the convenient one:
   - `explore` — reading, spiking, prototyping. No gate runs; nothing can be closed.
   - `rapid` — small, low-risk, self-contained changes. Changed modules only; no review receipt.
   - `balanced` — the default for delivery. Dependents verified; approving receipt to close.
   - `strict` — governance, trust boundaries, releases. Everything verified; lens-covered review.
3. Set it for the project (`profile set NAME`) or one task (`profile set NAME --task ID`);
   `adaptive` returns to the policy default plus floors.
4. Never argue with a floor. If task risk, a protected attribute, or a governance path raised
   the profile, that is the change telling you what it costs; lower the risk or split the change
   instead.
5. Re-run `node scripts/harness.mjs gate` after changing the profile: receipts are bound to the
   controls that produced them.

Under time pressure use the [fast-lane](../fast-lane/SKILL.md) skill, not a weaker profile.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, naming the
effective profile in `Evidence`.

Full control table, floors, and policy file: `docs/ASSURANCE-PROFILES.md`.
