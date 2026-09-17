# Product Workflow

How the on-demand skills compose into a product development lifecycle, from an idea to a
verified release. This is a workflow, not a persona and not a fixed number of phases: each stage
is a skill the agent loads when the documents say it is the next thing to do, and the assurance
profile — not the stage — decides how much evidence a change must carry. The rule
`.cursor/rules/60-product-workflow.mdc` activates when the product documents are touched.

## Stages and their artefacts

```text
idea ──► product-spec ──► [architecture-design] ─► [dfx-design] ─► [design-brief ─► design-prototype]
                 │                                                             │
                 └──────────────────────────► dev-plan ◄───────────────────────┘
                                                 │
                                                 ▼
                              phase-build ──► per task: scoped-implementation
                                    │            ├─ code-review | structured-review   (by tier)
                                    │            └─ test-design                      (by tier)
                                    │            ↺ root-cause-debugging on defects
                                    ▼
                              finish-branch ──► release-readiness ──► release-build (explicit)
```

| Stage | Skill | Produces | Reads |
| --- | --- | --- | --- |
| requirements | `product-spec` | `Product-Spec.md`, `Product-Spec-CHANGELOG.md` | the user's real cases; existing PRDs |
| architecture (optional) | `architecture-design` | `Architecture-Design.md`, `harness/module-catalog.json` skeleton, `docs/adr/*` | spec; existing code; DFX scenarios |
| quality attributes (optional) | `dfx-design` | `DFX-Spec.md`, catalog `attributes`, matrix checks | spec; architecture; design brief |
| design (optional, UI products) | `design-brief` → `design-prototype` | `Design-Brief.md`, `DESIGN.md`, `demo/index.html` | spec; brand assets |
| plan | `dev-plan` | `DEV-PLAN.md` | spec; architecture; DFX; brief; code |
| build | `phase-build` (orchestrating `scoped-implementation`, `code-review`, `structured-review`, `test-design`, `root-cause-debugging`) | code, commits, residue in `progress.md` | plan; spec; brief; `DESIGN.md`; `domain/` |
| close | `finish-branch` → `release-readiness` → `release-build` | merged branch, readiness report, artefact | everything above |
| byproducts | `domain-rulings`, `record-lesson`, `project-memory` | `domain/*.md`, `docs/feedback/*.md`, `progress.md` | receipts, corrections, decisions |

Optional stages are decided by three lines the spec skill writes on delivery — architecture (do /
may skip, with the reason drawn from the spec's size and risk), DFX (money, personal data, health,
physical equipment, or a P0 non-functional number → do), design brief (UI → do). Skipping is
recorded in `progress.md` with its reason.

## Routing by project state

The agent routes by which documents exist, never by what it assumes the user wants:

| Present | Next |
| --- | --- |
| nothing | `product-spec` 0-1 mode |
| spec only | offer architecture / DFX / design, then `dev-plan` |
| spec and plan, no code | `phase-build` initialisation mode |
| spec and code, no plan | `dev-plan` |
| spec, plan, code | `phase-build` continuous mode; review, fix, or release as asked |

A change request during development is `product-spec` iteration mode first (spec and changelog
together), then `dev-plan` iteration mode (affected phases and tasks), then `phase-build`; a
product that was already packaged is reminded that `release-build` must run again.

## Sign-off gates

- **Spec**: the agent replays the user's own case — who opens what, sees what, what the system
  does, how the exception runs, how the failure recovers — and the user finds no fault. There is
  no separate "please approve". A spec that fails its self-review is fixed before the replay so
  the user is never asked to catch what a checklist could.
- **Phase**: four steps with fresh evidence — code review against the delivery list, test
  completeness by a non-author, compile per stack, functional end to end — then PASS / CONCERNS /
  FAIL / WAIVED, where WAIVED has a reason and an approver and never covers security or data loss
  (`node scripts/harness.mjs waiver` refuses what `docs/PROTOCOLS.md` §Waiver binding lists by
  construction; the data-loss refusal is the workflow's rule), and the user confirms the phase.
- **Release**: `release readiness` proves the conditions and stops; `release-build` is invoked by
  name, performs exactly the authorised action, and verifies a deployment by three facts (image
  tag and creation time, health, live smoke) — never by the deployer's word.

## Task tiers and the assurance profile

Every task is tiered mechanically from the expected diff and the path classes it touches, and the
tier selects the profile the floors may only raise (`docs/ASSURANCE-PROFILES.md`):

| Tier | Criteria (any one raises it; unsure means higher) | Profile | Independence |
| --- | --- | --- | --- |
| LOW | < 50 lines; no contract, parser, authentication, migration, payment, or hook path; no new dependency | `rapid` | none: implementer, orchestrator accepts on diff and runner output |
| MEDIUM | 50–300 lines, or one such path, or a new dependency | `balanced` | none required to close (passing gate); a human or Bugbot review is welcome |
| HIGH | > 300 lines, or two or more such paths, or a production bug, data migration, security change | `strict` | structured review across convened lenses, tester who did not write the code |

One round converges on high findings; medium and low are residue in `progress.md` for later
tasks. A floor raised by a protected attribute or a governance path is the change telling you its
cost; the answer is to lower the risk or split the change, never to argue with the floor.

## Dispatch and receipts

Every coding, review, or test dispatch on product work uses the seven-field pack — **Goal / Scope
/ Out of Scope / Existing Pattern / Business Context / Verification / Escalation** — and returns
the receipt with the three product fields — **Business assumptions / Counter-examples / Domain
findings** — described in `docs/PROTOCOLS.md`. A fresh delegate inherits no history; the pack
carries paths and quoted rules, not summaries.

## Back-flows

- **Requirement in doubt** — code matches the spec, the spec fails the business (an exception
  would route wrongly, an `[inferred]` item meets contrary evidence, the beneficiary gets a worse
  result than the "why" promised). Raised by `code-review`, `test-design`, `root-cause-debugging`,
  `dev-plan`, or `scoped-implementation` as a counter-example in the one format `docs/PROTOCOLS.md`
  defines (scenario → what the spec gives → what the business needs → basis); handled only by
  `product-spec` iteration mode; never patched in code, never edited into
  the spec by a reviewer.
- **Domain clue** — a fact about how something is counted in the field, met while working, with
  its measured evidence; reported under Domain findings, triaged by `domain-rulings` (who knew it
  originally?), recorded only with two basis kinds. Structured review's red lenses produce these
  too; they are routed, not dismissed.
- **Method lesson** — a user correction of how the agent works; applied immediately, then
  recorded by `record-lesson` with scope, exceptions, supersession, and where it landed; graduated
  when already codified or when it has cost something real.
- **Business fact** — a user correction of what the business is; goes into the spec's rules and
  exceptions and into `progress.md` Decisions with basis, scope, and supersession.

## Memory and recovery

`progress.md` holds decisions (three elements: basis, scope, supersession), constraints,
completions, hazards, open work; the spec and its changelog hold requirements and why they
changed; `domain/` holds rulings. Recovery reads the set — `recap`, `task status`, `quality
status`, then the spec, changelog, and plan; a missing document is named and the recovery
degraded. Rulings are read at dispatch time, when the task is known, never at session start.

## Project root

```text
project/
├── Product-Spec.md               requirements, the source of truth for scope and acceptance
├── Product-Spec-CHANGELOG.md     why each requirement changed, which judgement was wrong
├── Architecture-Design.md        optional; invariants only
├── DFX-Spec.md                   optional; measurable quality targets
├── Design-Brief.md               optional; how it works
├── DESIGN.md                     optional; how it looks (tokens + prose)
├── DEV-PLAN.md                   phases and tasks
├── demo/                         optional; the offline prototype and its design plan
├── domain/                       optional; rulings by domain
├── progress.md                   project memory
├── docs/adr/                     decisions with Enforced-by, Revisit-if, Reversal
├── <project-name>/               the code, when planning documents live at the root
└── .cursor/                      harness, rules, skills, agents
```

Default filenames; a project that already has a PRD keeps its own names and structure —
`sync-check` recognises `Product-Spec.md`, `spec.md`, and `docs/requirements/*.md` as
specifications and their `-CHANGELOG` companions.

## What this workflow is not

Not a persona, not a brand, not a fixed sequence the agent walks regardless of the documents, not
a licence to invent requirements the user never confirmed, not a substitute for the assurance
profile and the gate — every stage still ends in a receipt whose `Verified` lists only what ran.
