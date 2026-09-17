---
name: product-spec
description: Learns the user's business from a real event and writes a Product Spec both sides can check line by line. Use when someone wants to build a product or feature; not for a one-line copy tweak.
---

# Product Spec

The agent does not know the user's industry, organisation, history, or unwritten rules. Learn
the business first, then play it back through the user's own case until they cannot find a
fault. A spec is a record of what was learned, not a questionnaire that was filled in.

## Task

Turn the business in the user's head into a `Product-Spec.md` both sides can check line by line.

- **0-1 mode** — from an idea to the first spec.
- **Iteration mode** — a change during development. Find why it changed, which earlier judgement
  was wrong, and which confirmed items it touches; edit the spec and record the change in
  `Product-Spec-CHANGELOG.md` (`sync-check` pairs the two).

## Preconditions

- 0-1: no spec required. Locate existing sources first (`Product-Spec.md`, then `*spec*`,
  `*prd*`, `docs/requirements/`). One found is used; several found are listed; none means 0-1.
- Iteration: `Product-Spec.md` must exist. Missing changelog for a spec edit is a sync finding,
  not a reason to skip the edit.
- No external tools. Load [REFERENCE.md](REFERENCE.md) before accepting a vague answer, before
  choosing the next question, and before generating.

## Invariants

- **Four kinds of statement stay apart.** `[confirmed]` a fact the user confirmed with a source;
  `[inferred]` the agent's inference with its basis; `[default]` a low-risk default the user may
  veto; `[open]` an unresolved question that lives only in the open-questions table. Unmarked
  text is inferred. Two requirements that cannot both hold are listed as a **contradiction** for
  the user to choose, never smoothed over. Agent advice is labelled *suggestion* and is not a
  requirement.
- **Asked once.** The clarification log stores each Q and A. Re-ask only when a new fact
  contradicts the stored answer, and put the contradiction first.
- **Questions cost.** Ask only what changes what will be built or how it will be accepted. Infer
  what the current state implies; default what is low-risk; never push implementation detail onto
  the user. Every question carries a recommended answer the user can take in one word.
- **Facts versus decisions.** A fact from the repo, the filesystem, or a public source is looked
  up, never asked. A decision is the user's. Relayed speech ("ops will…") is not a fact until
  someone who saw it says so.
- **Draw out, do not insert.** Stop if you find yourself picking the MVP cut, the phases, or the
  feature list. Do not add AI features unless the as-is story contains judgement, generation,
  recognition, or classification done by a person today, and only after saying who catches the
  error.
- **Foundation before dashboards.** If the data is not yet true and the core flow is not yet
  stable, reporting and metric-card requests default to a later list. A heavy-compute item needs
  a cost estimate or a sample measurement before sign-off; otherwise it stays `[open]`.
- **Verification is an end state, not activity.** "The spec exists" is not done. Done is: the
  user's own case replays without a fault they can name, every core item has a source, and each
  success criterion is countable without a technology word.

## Method

1. Write the envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification /
   Escalation**. Classify depth *before speaking* and say the class out loud so the user can
   override it. The axis is uncertainty × cost of being wrong, never the user's enthusiasm.
   Hidden complexity upgrades the class mid-session; nothing downgrades it.
   - **direct** — clear, backed by the spec, cheap to undo. Change it; say what changed in one
     sentence. Accept: a label, a default, a copy tweak. Reject: turning this into an interview.
   - **confirm** — the inference would change behaviour. One question with an inference and a
     recommendation. One question per turn, at most one sub-question on the same decision.
     Accept: a one-word answer. Reject: two unrelated questions in the same turn.
   - **explore** — why, who benefits, how it is done today, or where the exceptions are is
     unclear *and* being wrong is expensive. Learn the business (step 2) as a **design tree**,
     in frontier rounds, within a question budget set by the exposure class asked in the first
     turn (personal tool 6–8, internal 8–12, external or money or regulated at most 15; audit
     remaining unknowns at question 12).
   - **delegated** — "you decide": decide, record it as *agent decided (delegated)*, never ask
     again. Accept: one recorded decision. Reject: re-asking a delegated stack or cut.

2. **Explore: design tree, frontier rounds.** Map decisions as a tree. The **frontier** is every
   question whose prerequisites are already settled — what you can ask *now* without guessing
   at answers you have not heard. Ask the whole frontier in one round; wait for the answers
   before the next. A question that depends on another still open in this round belongs to a
   later round.

   Format a round:

   ```text
   Q1 — <title>: <body, including choices if they help>
   Recommendation: <one-word or one-line answer>, because <reason>.

   Q2 — …
   Recommendation: …
   ```

   First round is almost always the as-is story alone; later rounds open who-benefits, rules
   and exceptions, and history together when they no longer depend on an unanswered question.
   Count each numbered Q against the budget. Load REFERENCE.md §Hearing answers before treating
   a reply as a fact; load §This answer changes the next step before computing the next frontier.
   The question bank is five-part per dimension (intent, main, follow-up, accept, reject), not
   a table to walk in order.

   Learn along four lines, each until it can be replayed as one concrete case. Ask about *the
   last time*, not *in general*:
   - **how it is done today** — who, did what, with what, then what, and why that way.
     Accept: a named (or aliased) person, a real tool, an ending. Reject: "usually we…".
   - **why, and who benefits** — who pays for today's state, who gains, who may lose (losers
     are where the hidden rules live). Accept: a named winner and a named loser. Reject: "it
     would be nicer".
   - **rules and exceptions** — every rule gets an example and an exception. Accept: one
     exception that shows the edge. Reject: a rule with no case.
   - **who decides, and history** — what was tried, why it failed, what is settled, who signs.
     Accept: a settled item marked off-limits. Reject: proposing alternatives to a settled item.

   Mark the source of everything heard: witnessed / relayed / guessed. Relayed and guessed are
   inferences, never confirmations. Challenge a term that conflicts with a confirmed glossary
   entry the moment it appears: "your spec defines cancellation as X; you just used it as Y."

3. Bring expertise, not sales. Research the domain and comparable products before the interview
   and again before generating. Point out missing failure paths, rollback, permission
   boundaries, and delete-for-create as *suggestions*. When the user wants X and Y is better,
   say the reason and cost once, then do X and record the disagreement.

4. Generate from `templates/product-spec-template.md`; the changelog follows
   `templates/spec-changelog-template.md`. Missing "how it is done today" or "who benefits"
   **blocks generation**. Missing layout or stack preferences never blocks; they go to the
   open-questions table. Close the cheap ways to fake a spec: no as-is story, success criteria
   that are only "feels smooth", or a flow with no named person and no failure path.

5. Run the requirements self-review in REFERENCE.md on that file; a rework gap goes back to
   the interview. For external, money, or regulated products offer three to five elicitation
   methods and run at most two. Then **replay the written spec**: tell how the user's own case
   will happen after launch — who opens what, sees what, the system does what, how the
   exception runs, how the failure recovers — ending each part with a concrete "is that what
   happens?". No fault found is approval; there is no separate approval ceremony.

   After a substantial spec, once per conversation, append two or three short questions the
   user could send back, each tied to a number, assumption, or missing context in what you just
   wrote. Skip this on a direct copy tweak, when they already asked you to verify, or when they
   asked for the short version.

Converged when the open-questions table is empty or every row names who can answer, when it is
due, and what to do meanwhile; no `[open]` inside functional items; every core item has a
source and every `[confirmed]` a real case; contradictions are all resolved by the user; the
replay passed.

| Thought | Reality |
| --- | --- |
| "This is too small to interview" | Direct means one sentence, not a silent start on a product. |
| "I'll ask five things so we finish faster" | Bundled questions get the easy one answered. Confirm stays one; explore uses a frontier. |
| "They said usually, that's the rule" | "Usually" is `[inferred]`. Ask for the dated instance. |
| "I'll pick the MVP, they can correct it" | That is inserting. Stop and hand the pen back. |
| "The spec file existing is sign-off" | Sign-off is a replay the user could not fault. |

## Handoff

- `dev-plan` gets the value order and the `[inferred]` / `[default]` / `[open]` list to test
  first.
- `design-brief` gets context of use, the primary action, personas, and named flows.
- `architecture-design` and `dfx-design` get data ownership, failure consequences, and implicit
  compliance (those skills sleep until invoked).
- `progress.md` gets the decisions (rejected alternative and scope) and anything settled as
  off-limits under Pinned.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**.

## Example

User: "Build an after-sales ticket system. Support records, dispatches to repair, repair
feeds back."

Class: explore (internal). Round 1 frontier is the as-is story only.

Accept:

```text
Q1 — Last bad ticket: When did dispatch last go wrong? Who logged it, with what, who chose
the technician, how did it end?
Recommendation: walk last month's wrong-skill dispatch, because a dated miss beats a workflow
diagram.
```

User: "Support logs it in Excel, WeChats the lead, the lead picks whoever is free, the tech
photos the group chat. Last month a unit went to someone who cannot repair that model."

Accept: mark `[confirmed]` dispatch is the lead's memory (source: last month's wrong-skill
dispatch); `[inferred]` wait-time is the metric. Round 2 frontier (independent once as-is
exists):

```text
Q2 — Who loses: Who gains a step, and who now has to click instead of shouting in the group?
Recommendation: the lead pays; support and the customer gain.
Q3 — Exception: Any ticket that skips the lead?
Recommendation: VIP straight to a named senior, because that is where hidden rules live.
Q4 — Settled: What was tried and must not be reopened?
Recommendation: no auto-dispatch; the lead keeps the choice.
```

Reject: five topic questions in one turn (position, users, features, flow, platform) that do
not form a frontier. Reject: writing "customers generally phone" as a requirement for in-app
calling. Reject: asking React versus Vue after "you pick the stack".

A fully marked spec for this case is [examples/after-sales-dispatch.md](examples/after-sales-dispatch.md).

Load [REFERENCE.md](REFERENCE.md) for interview rules, hearing answers, the question bank,
discovery methods, the self-review, iteration-mode rules, and worked dialogues.
