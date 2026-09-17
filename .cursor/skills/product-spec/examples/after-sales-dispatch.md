# After-sales dispatch — marked spec fragment

Worked example for `product-spec`. Internal exposure. Shows four markers, a contradiction
the user resolved, open questions that live only in the table, and a named failure path.
Not a product to build in this repository.

## 0. How agents read this document

- Source of truth for scope, behaviour, and acceptance.
- Implement P0 first. Do not implement *Non-goals*. Judge completion by *Success criteria*.
- `[inferred]` / `[default]` that contradict field evidence return as **requirement in doubt**.

## Overview

- What it is: a tool for logging, dispatching, and closing after-sales repair tickets for
  support, a repair lead, and technicians.
- Why now: support logs in Excel, WeChats the lead, the lead picks whoever is free. Last month
  a job went to a technician who cannot repair that model; the customer waited two extra days;
  a complaint was how anyone found out. `[confirmed]` (source: user, last month's wrong-skill
  dispatch)
- Who benefits: support (no more chasing the group chat), the customer (less waiting). Who
  pays: the lead (must click a name instead of shouting). Who may lose: Zhang (VIP jobs that
  used to reach him with no record). `[inferred]` (source: as-is story; Zhang not interviewed)
- Core value: at dispatch, who can repair the model is visible, so that class of miss stops.
- Exposure class: internal (a dozen people, not public). `[confirmed]`

## Scenarios: how the work is done today

**Case 1: last month's wrong-skill dispatch** (source: witnessed by the user)

Li in support takes the call → logs model X-200 and the address in Excel → WeChats lead Zhou
→ Zhou forwards to Wang because Wang is free → Wang arrives, cannot repair X-200 → Zhou
reassigns Zhang → the customer is repaired on day three → the customer complains to support;
Li learns there was a reassignment.

**Case 2: an ordinary Tuesday** (source: told by the user)

Li takes six morning calls, one Excel row each, dumps them to the group at 11:00; Zhou reads
the group at noon and assigns from memory; the technician posts one photo in the group; Li
backfills "repaired" into Excel at night.

**Exception**: VIP tickets skip Zhou; Li WeChats Zhang directly. The week Zhang was on leave
(May), one ticket waited four days because nobody knew who should take it.

## Success criteria

| ID | Criterion (countable, technology-free) | Baseline | Target | Guard | Source |
| --- | --- | --- | --- | --- | --- |
| SC-1 | Wrong-model dispatches per month | ~2 (user estimate) | 0 | Lead's dispatch time no worse than 2× a shout in the group | `[confirmed]` case 1; baseline `[inferred]` |
| SC-2 | Time from call to technician holding the ticket | half a day (batch at 11:00) | under 10 minutes | at most six log fields | `[confirmed]` case 2 |
| SC-3 | Minutes Li spends backfilling the group at night | ~30 / day | 0 | technician photo upload at most two steps | `[confirmed]` case 2 |

## Scope and non-goals

**This version**

| ID | Item | Priority | Source |
| --- | --- | --- | --- |
| SCOPE-1 | Support logs customer, model, address, phone, symptom | P0 | `[confirmed]` case 1 |
| SCOPE-2 | Lead picks from technicians who can repair that model | P0 | `[confirmed]` wrong-skill case |
| SCOPE-3 | Technician uploads a completion photo; support is notified | P0 | `[confirmed]` case 2; notify-support corrected 09-10 |
| SCOPE-4 | VIP goes to Zhang; if Zhang is away, return to the lead | P1 | `[confirmed]` exception; return-to-lead `[default]` see Q-1 |

**Non-goals**

| ID | Item | Reason |
| --- | --- | --- |
| OUT-1 | Automatic dispatch by skill and load | Lead keeps discretion ("some customers only accept one person") |
| OUT-2 | Customer-facing status | This round is internal hand-off; support still phones the customer |
| OUT-3 | Parts and billing | Separate process, finance owns it |

## Functional requirements

- Log: support selects model (required), fills address, phone, symptom → system issues a ticket
  id and lists who can repair that model → lead sees a pending list `[confirmed]` (case 1)
- Dispatch: lead taps one capable technician → system pushes the ticket and records who
  dispatched, when → support sees "assigned · Zhang" `[confirmed]` (wrong-skill case)
- Close: technician uploads a photo and taps complete → support is notified; they do not
  scrape the group `[confirmed]` (case 2; notify-support, user correction 09-10)
- VIP: marked VIP skips the lead and goes to Zhang → if Zhang is on leave, return to the lead
  `[confirmed]` skip; return `[default]` (see Q-1)

## Rules and exceptions

| Rule | Example | Exception | Source |
| --- | --- | --- | --- |
| Dispatch only to someone who can repair the model | X-200 → Zhang or Senior Zhang | none | `[confirmed]` wrong-skill case |
| VIP goes to Zhang | customer A | Zhang on leave → lead | `[confirmed]`; return is `[default]` Q-1 |

## Key flow

**FLOW-1: Li logs, Zhang arrives** (SCOPE-1 / 2 / 3)

1. Li selects X-200, fills address and phone, taps dispatch.
2. System lists only Zhang and Senior Zhang; Zhou taps Zhang.
3. Zhang sees the ticket, repairs, photos, completes.
4. Peak: Li's desk shows "ticket 1032 complete" — no group scrape.

Failure: nobody who can repair X-200 is available → list empty with "none available" → wait or
VIP-channel Senior Zhang → ticket stays pending, not dropped.

## Decision basis

| Decision | Rejected | Why | Who |
| --- | --- | --- | --- |
| No auto-dispatch in v1 | algorithm by skill and load | lead keeps discretion; they catch the miss | user |
| Completion notify support, not the customer | notify the customer | photo is for support to close; customer still gets a phone call | user (09-10 correction) |
| Prefer dispatch accuracy over log speed | "as fast as possible" with no trade-off | "faster" was no choice; after the knife, accuracy wins, six-field cap guards speed | user |
| Soft-delete, keep the record | physical delete | after-sales needs an audit trail | agent suggestion, user adopted |

Contradiction recorded then resolved: user said both "faster logging" and "never miss a model".
Put both lines in front of them; they kept accuracy.

## Open questions

| Question | Touches | Who can answer | Meanwhile |
| --- | --- | --- | --- |
| Q-1 Formal path when Zhang is away (return-to-lead, 24h unacked reminder) | SCOPE-4, FLOW-2 | user or Zhang | return to lead; remind lead at 24h |
| Q-2 May the technician see the customer phone? | privacy | user | technician sees phone (they must call on site); support can hide it |

## Clarification log

| Date | Q | A (source) | Changed |
| --- | --- | --- | --- |
| 2026-09-08 | Is the model known at log time? | Customer names it; unknown if they cannot (witnessed) | model required / unknown |
| 2026-09-08 | Keep only one: log speed or dispatch accuracy? | Accuracy (user) | decision 3; SC-2 guard |
| 2026-09-10 | Is the photo for the customer or for support to close? | For support to close (user correction) | close function; decision 2 |
