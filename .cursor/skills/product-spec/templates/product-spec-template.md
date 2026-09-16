# Product Spec template

Default filename `Product-Spec.md` at the project root; the spec paths `sync-check` recognises
are listed in `docs/PRODUCT-WORKFLOW.md`. An existing
PRD keeps its own name, structure, and IDs; this template is for a new document only.

Every statement carries a marker and a source: `[confirmed]` a fact the user confirmed (quote or
case number), `[inferred]` the agent's inference (its basis), `[default]` a low-risk default the
user may veto (its basis), `[open]` unresolved — allowed only in the open-questions table. Agent
advice is labelled *suggestion*. Unmarked text is treated as inferred. Trim the sections that do
not apply; never leave an empty table or a placeholder standing in for a decision.

Depth: **brief** may collapse to goal, scope, behaviour and acceptance, constraints;
**structured** uses the sections below; **formal** adds stable IDs (`REQ-<area>-<nnn>` at the
start of the list item), public contracts, failure behaviour, and traceable acceptance.

---

# <Product name> — Product Spec

## 0. How agents read this document

- This document is the source of truth for scope, behaviour, and acceptance; planning,
  implementation, review, and testing start from it.
- Implement P0 first; do not implement anything under *Non-goals*; judge completion by *Success
  criteria* and the "gets" part of each function.
- Items marked `[inferred]` or `[default]` that contradict evidence found while working are
  reported back as **requirement in doubt** with a counter-example; the requirement is not changed
  in place. Items in the open-questions table are built as "meanwhile do" says.

## Overview

- What it is: one plain sentence.
- Why now: who pays for today's state (time, money, risk), told through one real case.
- Who benefits, who pays, who may lose: three groups written separately even when they coincide.
- Core value: which step nobody has to do any more once this ships.
- Exposure class: personal / internal / external, money, or regulated — it sets the depth and the
  acceptance rigour. Not a tier: task tiers, attribute tiers, and intrinsic risk are separate
  scales (`docs/PROTOCOLS.md` §Tier vocabulary).

## Scenarios: how the work is done today

Two or three cases that actually happened, never "in general". Each: who (a name, may be a
pseudonym) → did what → with what → then what → why that way. Exceptions in their own paragraph.

**Case 1: <one-line title>** (source: told by the user / witnessed / relayed)

**Exception**: which time did not follow the above, and why.

## Success criteria

| ID | Criterion (countable, technology-free) | Baseline today | Target | Guard metric (watches the side effect) | Source |
| --- | --- | --- | --- | --- | --- |
| SC-1 | | | | | |

## Scope and non-goals

**This version** (every P0 is a usable step on its own)

| ID | Item | Priority | Source |
| --- | --- | --- | --- |
| SCOPE-1 | | P0 | |

**Non-goals** (deliberately not done this round, at least three)

| ID | Item | Reason |
| --- | --- | --- |
| OUT-1 | | |

**Later** (may be done; this round does not depend on it)

## Functional requirements

Each item: user does → system does → gets, with marker and source. Anything unclear is written
as a `[default]` behaviour with a row in the open-questions table.

**Core**

- <function>: <user does> → <system does> → <gets> `[confirmed]` (source: case 1)
- [REQ-AREA-001] <function>: … `[confirmed]` (source: …)   *(formal depth only)*

**Supporting**

## Rules and exceptions

| Rule | Example | Exception (which time it did not hold, and why; "none" if none) | Source |
| --- | --- | --- | --- |

## Key flows

How "that case" will run after launch: a named protagonist, step by step, a climax (the moment
they breathe out), and a failure path. One flow per beneficiary when beneficiary and payer
differ; the exception case gets its own flow.

**FLOW-1: <name>** (relates to SCOPE-x / function y)

1. <who opens what and sees what>
2. …
n. **Climax**: <what the system did at the moment they stopped worrying>

**Failure path**: most likely to fail at step → they see → they continue by → nothing lost because.

## Data and permissions

| Entity | Key fields | Who may change (single writer) | Who only reads | Delete / archive | Source |
| --- | --- | --- | --- | --- | --- |

For asynchronous or background results: which object and version a request targets, where the
result lands, what happens when the user edited meanwhile.

## Decision basis

| Decision | Alternative | Why (contradictions: both sides and the user's choice) | Decided by |
| --- | --- | --- | --- |
| | | | user / agent (delegated) / agent suggested, user accepted / settled, off-limits |

## UI and context of use

- Context of use: standing or sitting, one hand or two, seconds or hours, focused or interrupted,
  device and light.
- Primary action: the one action that matters most on the screen.
- Layout and controls: direction only when discussed; detail belongs to the design brief.

## AI capability (only if the product uses AI)

Only where a person today judges, generates, recognises, or classifies.

| Function | Kind | Replaces which as-is step | Quality bar (hit rate / alarm line) | Trigger (suggest / act) | When unsure | Degradation | Who catches an error |
| --- | --- | --- | --- | --- | --- | --- | --- |

**Never do**: the most expensive possible error and how it is prevented. Latency and cost each
with their own basis; unmeasured values stay "unmeasured".

Only a product that acts on the person's behalf gets an action-boundary section (direct / show
first / forbidden per action class, budgets, stop conditions, human takeover).

## Technical direction

| Dimension | Choice | Reason and verification |
| --- | --- | --- |
| Product type | Web / desktop / CLI / mobile / conversational agent | derived from the context of use, not from preference |
| First-version platform | | how the other platform degrades |
| Stack | | checked against current documentation before it was written down |
| Data storage | local / cloud / mixed | who owns it, who must see it, how bad is a loss |
| Deployment | | |

## Non-functional and implicit compliance

| Class | Requirement (a number or "not required") | Priority | Source |
| --- | --- | --- | --- |
| Performance | | | |
| Security | | | |
| Privacy | | | |
| Compatibility | | | |
| Reliability | | | |
| Accessibility | | | |
| Implicit compliance | personal data / payments / health / physical equipment / minors — named even when the user did not raise it; tiered by dfx-design | | |

## Risk, quality, and assurance input

- Intrinsic risk: low / medium / high — potential harm, reversibility, unknowns (this is risk,
  not a profile; `profile show` resolves the profile).
- Release intent: prototype / local delivery / package / release / deploy — intent is not
  authorisation.
- Quality attributes that apply, with tier and a decidable target: security, safety, privacy,
  resilience, reliability, availability, performance, maintainability. Applicable security,
  safety, or privacy is never omitted.

## Open questions

The only place `[open]` may appear. Every row fills all six columns, and the id is what the plan
cites (`dev-plan` defers a question by `Q-n`).

| ID | Question | Impacts | Who can answer | Due | Meanwhile do |
| --- | --- | --- | --- | --- | --- |
| Q-1 | | | | | |

## Clarification log

One row per question and answer; an answered question is never asked again. Corrections record
what was believed, what is true, and which item changed.

| Date | Asked | Answered (source) | Changed item |
| --- | --- | --- | --- |
