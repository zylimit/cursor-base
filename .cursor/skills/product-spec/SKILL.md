---
name: product-spec
description: Learns the user's business from a real event and writes a Product Spec both sides can check line by line; revises it when requirements, UI, or understanding change. Use when someone wants to build a product or feature.
---

# Product Spec

The agent does not know the user's industry, organisation, history, or unwritten rules. Learn
the business first, then play it back through the user's own case until they cannot find a
fault. A spec is a record of what was learned, not a questionnaire that was filled in.

**0-1 mode**: from an idea to the first `Product-Spec.md`. **Iteration mode**: a change during
development — find out why it changed, which earlier judgement was wrong, and which confirmed
items it touches; edit the spec and record the change in `Product-Spec-CHANGELOG.md`
(`sync-check` reports a spec edit without its changelog).

1. Write the envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
   Locate existing requirement sources first (`Product-Spec.md`, then `*spec*`, `*prd*`,
   `docs/requirements/`); one found is used, several found are listed, none means 0-1 mode.
2. Classify the depth before speaking. The axis is *uncertainty × cost of being wrong*, never
   the user's enthusiasm or the size of the change:
   - **direct** — clear, backed by the spec, cheap to undo (a label, a default): change it and
     say what changed in one sentence.
   - **confirm** — the inference would change behaviour: one question with an inference and a
     recommendation the user can answer in a word. One question per turn, at most one sub-question
     on the same decision (`product-spec/REFERENCE.md` §Interview rules).
   - **explore** — why, who benefits, how it is done today, or where the exceptions are is
     unclear *and* being wrong is expensive: learn the business (step 3) within a question
     budget set by the exposure class asked in the first turn (personal tool 6–8, internal 8–12,
     external or money or regulated at most 15; audit the remaining unknowns at question 12).
   - **delegated** — "you decide": decide, record it under decision basis as *agent decided
     (delegated)*, and never ask again.
3. Learn the business along four lines, one at a time, each until it can be replayed as one
   concrete case. Ask about *the last time*, not *in general*; one question per turn, at most one
   sub-question on the same decision:
   - **how it is done today** — who, did what, with what, then what, and why that way;
   - **why, and who benefits** — who pays for today's state (time, money, risk), who gains,
     who may lose (losers are where the hidden rules live);
   - **rules and exceptions** — every rule gets an example and an exception; an exception shows
     the rule's edge or shows it was never a rule;
   - **who decides, and history** — what was tried, why it failed, what is settled and off the
     table, who signs.
   Mark the source of everything heard: witnessed / relayed / guessed. Relayed and guessed are
   inferences, never confirmations. Before treating a reply as a fact, load
   [REFERENCE.md](REFERENCE.md) §Hearing answers. Before choosing the next question, load
   §This answer changes the next step. The question bank is five-part per dimension (intent,
   main question, follow-up, accept, reject), not a table to walk in order.
4. Keep four kinds of statement apart, in conversation and in the document: `[confirmed]` a fact
   the user confirmed with a source, `[inferred]` the agent's inference with its basis,
   `[default]` a low-risk default the user may veto, `[open]` an unresolved question that lives
   only in the open-questions table. Unmarked text is treated as inferred. Two requirements that
   cannot both hold are listed as a **contradiction** for the user to choose, never smoothed
   over. Agent advice is labelled *suggestion* and is not a requirement.
5. Ask only questions that change what will be built or how it will be accepted. Infer what the
   current state implies (`[inferred]`), default what is low-risk (`[default]`), never push
   implementation detail onto the user, attach a recommended answer to every question, and never
   re-ask what the clarification log already answers unless a new fact contradicts it.
6. Bring expertise, not sales: research the domain and comparable products before the interview
   and again before generating; point out what is missing (failure paths, rollback, permission
   boundaries, delete for anything that can be created) as *suggestions*; when the user wants X
   and Y is better, say the reason and cost once, then do X and record the disagreement. Do not
   add AI features unless the as-is story contains judgement, generation, recognition, or
   classification done by a person today, and only after saying who catches the error.
7. Generate from `templates/product-spec-template.md`; the changelog follows
   `templates/spec-changelog-template.md`. Missing "how it is done today" or "who benefits"
   blocks generation.
8. Run the requirements self-review in [REFERENCE.md](REFERENCE.md) on that file; a rework
   gap goes back to the interview. For external, money, or regulated products offer three to
   five elicitation methods and run at most two. Then sign off by **replaying the written
   spec**: tell how the user's own case will happen after launch — who opens what, sees what,
   the system does what, how the exception runs, how the failure recovers — ending each part
   with a concrete "is that what happens?". No fault found is approval; there is no separate
   approval ceremony. Then hand off: dev-plan gets the value order and the
   `[inferred]`/`[default]`/`[open]` list to test first; design-brief gets context of use, the
   primary action, personas, and named flows; architecture-design and dfx-design get data
   ownership, failure consequences, and implicit compliance; `progress.md` gets the decisions
   (with rejected alternative and scope) and anything settled as off-limits under Pinned.

Converged when the open-questions table is empty or every row names who can answer, when it is
due, and what to do meanwhile; no `[open]` inside functional items; every core item has a source
and every `[confirmed]` a real case; contradictions are all resolved by the user; the replay
passed. Missing layout or stack preferences never block generation; missing "how it is done
today" or "who benefits" does — those are the foundation.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings** (`docs/PROTOCOLS.md`).

Load [REFERENCE.md](REFERENCE.md) for §Interview rules, §Hearing answers, §This answer
changes the next step, §Question bank, the discovery methods for hard unknowns, the
requirements self-review, iteration-mode rules, and worked dialogues.
