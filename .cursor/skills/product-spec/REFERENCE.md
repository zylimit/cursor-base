# Product Spec Reference

## Interview rules

These are the constraints under every question, not a script. Return here when tempted to
accept a vague answer, stop early, or ask from a template.

**Five rules**

- Talk about their life, not your solution. Open with "when did this last happen — walk me
  through it", never with a description of what you intend to build; once the solution is on
  the table every answer is polluted by politeness.
- Ask about concrete past events, not hypothetical futures. "How did you do it last time" beats
  "would you use this". Rewrite every "would you…" into "last time, did you…". People are
  systematically over-optimistic about imagined futures and willingness to pay.
- One question per turn (at most one sub-question about the same decision). Bundled questions
  get the easiest one answered and the important one dropped.
- Open context-free: who uses it, what problem, what does success look like — the least biased
  opening there is.
- Close every stage with the meta-question: "what should I have asked and did not; who else
  should I talk to?"

**Four knives for abstract words** — simple, fast, clean, flexible, premium, modern, "I would
use it", "pretty good" — cut in order until the answer is an instance, a number, an observable
fact, or a picture:

1. Anchor to the past: "when was the last time? what exactly were you doing?"
2. Ask for an example: "give me one concrete example, or show me a product you think is right."
3. Ask for a number: "how fast, in seconds? how often? what does it cost you today?"
4. Offer a binary: "by premium do you mean A or B?"

"The system is slow" becomes "responses over 5 seconds, about 30% of the time, between 14:00
and 15:00".

**Failure modes of an interviewing model** — scan for them at the end of every stage:

- Flattery, the number one failure: "great idea", treating the user's vague framing as
  confirmed, following instead of digging. Defence: never say "great idea"; offer a competing
  explanation for the user to correct; treat enthusiasm as noise, not validation.
- Fabrication: filling in requirements, facts, or numbers the user never said. Defence: separate
  "the user said" from "I inferred"; every inference is marked and read back.
- Premature convergence: stopping at the first surface answer. Defence: coverage scan, the
  meta-question, and "anything else?" before generating.
- Asking from priors: interviewing from your domain template instead of their situation.
  Defence: context-free opening, follow their answers, not a fixed script.
- Bundled questions. Defence: one per turn.
- Leading questions ("wouldn't a dashboard be better?"). Defence: neutral how/what/walk-me-through
  about current behaviour, never opinions about your proposal.
- Praise as data ("I like it, I would use it"). Defence: only commitments and past behaviour
  count — time, money, reputation, real examples.
- Ghost-writing: quietly choosing the MVP cut, the phases, the features, the colours. Defence:
  stop the moment you notice, hand the pen back; infer if you must, but read it back.

**Replay formula** — the default shape of a turn, no internal stage labels shown:

```text
My current understanding is: [the scattered facts strung into one flow].
One decision that would change the first version is still missing: [specific unknown].
[Main question]? Why it matters: [one sentence]. Recommendation: [answer], because [reason].
```

When a companion requirement appears: "you asked for X, so Y is not an extra — it is what keeps
that flow from breaking. For the first version I suggest [recommendation]; if you care more about
[other trade-off] it could be [option]." When two statements conflict: "you want both A and B; in
[scenario] they collide. Which matters more?"

**Anti-evasion**

- "Either is fine" → offer two concrete experiences with their costs; for low-risk items just
  declare a default and move on.
- "The more the better / all of it" → "which one, if missing, makes the first version unusable?
  The rest goes on the later list."
- "Like WeChat / Figma / Notion" → which specific action or experience; never accept a whole
  product as an answer.
- "Make it smart / add AI" → at what moment, on what context, deciding what for the user, who
  catches the error.
- "Real-time" → acceptable wait and feedback form; do not assume zero latency.
- "Support everything" → real first-version samples, scale, and format boundaries.
- "Just make it secure / compliant" → which data, who may see it, how bad is a loss, which law
  or industry rule.
- "Show it normally / handle it" → an empty result must not look like an error; describe both.
- "That's enough" while information is clearly missing → keep going and name the one decision
  that would still change the first version.

**Words not used in front of the user** (unless the user is the expert and raises them):
idempotent, optimistic concurrency, CSP, sandbox policy, schema, RPC, host bridge. Translate:
"will a double click create two records", "will the AI's old result overwrite what you just
changed", "which sites may it reach", "what may the system read and write". Internal labels —
phase, dimension numbers, P0, budget, question-bank names — stay internal; the user hears
natural transitions.

When the host offers a structured question tool, keep titles short, two to four options per
question, at most four questions at once, and let the tool add its own free-text choice.
Multi-select only for freely combinable items. Without such a tool, list numbered options in the
message.

Stay conversational: rotate direction (up to value, down to specifics, sideways to alternatives
tried); mirror the user's words ("by 'stuck' you mean…"); step back when the user gets
defensive; park new ideas — "good one, it goes on the later list so it is not lost; let us pin
the core first".

## Hearing answers

Treat the reply as evidence to classify, not as a requirement to write down.

- "Usually / generally / should / normally" → inference, not fact. Mark `[inferred]` and ask for
  one dated instance.
- "All of it / the more the better / everything is important" → no trade-off. Ask "if you can
  keep only one, which?" — that answer is the priority.
- Two earlier statements that cannot both hold → put both lines in front of the user; do not
  smooth them. The choice goes under decision basis.
- Emotion ("the old one was terrible") → a real pain. Ask which time, and what it cost that time.
- Cannot name a "last time" → the need may be imagined. Say so, mark `[inferred]`, and suggest
  validating before building.
- Answers a different question → the question was at the wrong level. Re-ask about a concrete
  object they already named; do not repeat the original wording.
- Names another product as the answer ("like WeChat") → which one action or experience; never
  accept a whole product.
- Relayed speech ("ops will…", "customers usually…") → "did you see that, or are you estimating?"
  Relayed and guessed stay `[inferred]`.
- Dashboards, reports, or metric cards while data or the core flow is still unstable → park them
  on the later list. They look finished and are not; do not design them in the first version.
- A heavy-compute item before sign-off needs a cost guess at realistic volume, or a sample
  measurement; if neither exists it goes to the open-questions table, not into a signed P0.

## This answer changes the next step

- Manual hand-off, double entry, or "someone remembers" in the as-is story → that is the core
  value candidate; later trade-offs are judged against it.
- More than three exceptions to one rule → not one feature; split the flow or cut the exceptions.
- Beneficiary and payer are different people → two user flows, one each.
- "Already decided, not up for discussion" → decision basis as *settled, user will not reopen*;
  do not offer alternatives again.
- "You decide" → delegated tier; write the decision and stop asking.
- Upload, canvas, generation, long jobs, external APIs, delete or overwrite → raise one or two
  companion requirements from the companion-requirements table under Question bank and name
  their cost; the rest goes later.
- The industry itself carries implied rules (health, payments, personal data, physical equipment)
  → name the gap even if the user did not; `[open]` for dfx-design, never answered on their
  behalf.
- All four foundation lines have a replayable case and every open question has an owner →
  generate the spec from the template; run the requirements self-review on that file (a
  rework gap goes back to the interview); open dimensions 12–13 only when the product uses
  AI or is an agent; then replay the written spec (SKILL.md steps 7–8).

## Question bank

Thirteen dimensions. Five parts each: **Intent** (the em-dash after the heading), Main,
Follow-up, Accept, Reject. Use the main question when about to ask at random; the follow-up
when about to accept a vague answer; the accept line when about to stop; the reject line when
the answer must be sent back. Dimension numbers stay internal. Dimensions 1–4 must pass; 5–11
are trimmed to the product and absorbed when the user already covered them; 12–13 open only
when the product uses AI or is itself an agent.

**1. How it is done today** — Lock one named person and one real event. Core value hides in
hand-offs, re-entry, and "someone remembers".
- Main: "When did this last happen? Who moved first, with what, then what, how did it end?"
- Follow-up: "I generally…" → "not generally — when was the last time, walk that one."
  "Everyone will use it" → "everyone is no one; who is the first version for, and who is it
  not for?" A judgement with no story → "give me one time it actually happened."
  "Nobody handles this" → "what is the workaround today — which tool or spreadsheet? if there
  is none, this may not hurt."
- Accept: a named protagonist, one dated instance, tools and steps, and where it stuck.
- Reject: "everyone / users"; a hypothesis with no instance; a description of their solution.

**2. Why, and who benefits** — Who pays decides whether to build; who gains decides for whom;
who loses is where hidden rules live.
- Main: "Who breathes easier when this works? Who will be unhappy? Who pays today in time,
  money, or risk?"
- Follow-up: "it takes time" → "how long last time, how often, what is that per month?"
  "everyone benefits" → "who gains a step? how does the person who used to shout in a group
  feel about clicking?" "they would pay" → "have they already spent money or built a
  workaround? if not, why not?"
- Accept: beneficiary, payer, and possible loser named apart; a number on the cost; evidence
  of effort or money already spent.
- Reject: future willingness with no past behaviour; "would pay" as validation; "annoying /
  slow" with no number.

**3. Rules and exceptions** — The rule is the bone; the exception is its edge. The first
undocumented exception is the first wrong routing.
- Main: "Was there a time this was not handled this way? Why? Who decided to break the rule?"
- Follow-up: "basically always" → "what was the time it was not?" More than three exceptions
  → "this is a class of flows — split them or cut the exceptions." "special cases by hand" →
  "whose hand, and must the system know the case left the happy path?"
- Accept: every rule has an example and an exception, or an explicit "none"; exceptions have
  a trigger and an owner.
- Reject: "by the book" with no book; an exception nobody can date.

**4. Who decides, history** — Settled decisions are off the table; failed attempts are not
retried; a spec nobody can sign never closes.
- Main: "Was this tried before? Where did it stall? What is settled and not up for discussion?
  Who signs?"
- Follow-up: "leadership decided" → "the goal or the method? which part can still move?"
  "the old one was terrible" → "which time, what did it cost, what must this version avoid?"
- Accept: a settled-decision list; a failed attempt with a cause; a signer and anyone who
  must be heard but cannot decide.
- Reject: "no history" on a second attempt; nobody can name the signer.

**5. Success criteria** — Uncountable success is a feeling; vanity metrics steer the product.
- Main: "Three months after launch, which number must have moved? What is it today?"
- Follow-up: a pile of metrics → "one north star tied to the job the user finishes — not
  sign-ups." "it should feel smooth" → "how many steps, how many seconds, how long did the
  last unsmooth time take?" Only a positive metric → "what rising number would hide a worse
  job? give a guard metric."
- Accept: one to three countable, technology-free criteria from the user's or the business's
  view, with a baseline, and at least one guard.
- Reject: "better / smarter"; sign-ups or downloads as the star; anything uncountable.

**6. Scope and non-goals** — Nail what this version will not do; a first version that is all
P0 has no first version.
- Main: "What does this version deliberately not do — at least three things? If only one
  feature ships, which?"
- Follow-up: "do it all first" → "then it never ships; which one stays, which are you willing
  to wait for?" A new idea mid-interview → later list, pin the core. Everything marked P0 →
  "which absence makes launch impossible?"
- Accept: at least three explicit non-goals; each P0 is a usable, testable slice on its own;
  later-list and non-goals kept apart.
- Reject: "all of it"; no not-doing list; no minimum set.

**7. Key flow and failure path** — Replay last month's case after launch; failure is product
behaviour, and the likeliest fail has a recovery.
- Main: "After launch, how will last month's case run, step by step, until they breathe out?
  Where does it most likely fail, what do they see, how do they continue without losing
  anything?"
- Follow-up: "and then they are done" → "the middle step — what did they click or type?"
  Happy path only → "they typed it wrong, data is empty, the network drops — then what?"
  "show an error" → "retry, edit, restore, or exit? is what they just typed still there?"
- Accept: one unbroken flow with a named protagonist and a climax; at least one failure with
  trigger, message, data protection, and a next step.
- Reject: skipped steps; only the happy path; "friendly message / try later" with no next step.

**8. Data and permissions** — Functions read and write; without objects, writers, and a
delete path, implementers guess. Anything creatable is removable.
- Main: "What are the core objects, how do they relate, who changes each, who only reads,
  what happens on delete or archive, who can undo a wrong change?"
- Follow-up: features with no data → "what is stored, which fields?" No delete → "everything
  that can be created or imported must be removable; what happens to references?"
  "everyone can see it" → "who sees the phone number? still, after they leave?"
- Accept: entities, relations, a single writer, visibility, delete or archive (skippable for
  a pure front-end).
- Reject: building with no structure; create-only with no way out.

**9. Product shape and context of use** — Form follows where it is used, not taste. Context
and the primary action start design; colour and layout do not belong here.
- Main: "Standing or sitting, one hand or two, seconds or hours, focused or interrupted,
  which device? What is the one action that matters most on this screen?"
- Follow-up: "web and phone" → "which one must work in the first version?" "you pick the UI"
  → "layout is design-brief; here only where they use it and the one action."
- Accept: form (web / desktop / CLI / mobile / conversational / embedded) derived from
  context; a first-version platform; one sentence each for context and primary action.
- Reject: a platform chosen to look premium; colours before context.

**10. Non-functional and implicit compliance** — Six classes each get a number or "not
required". Industry rules the user did not mention are still gaps.
- Main: "How fast is fast enough? How many at once? How does it recover, can data be lost?
  Which devices? Does this industry carry rules — personal data, payments, health, physical
  equipment?"
- Follow-up: "fast and secure" → "seconds, concurrency, login or encryption or permission —
  a number we can accept." A personal tool plus "full security" → protect secrets and local
  data; do not invent a compliance console. Health / payments / personal data / equipment
  unmentioned → name the usual rule, mark `[open]` for dfx-design, do not answer it.
- Accept: each of the six classes required or explicitly not; implied compliance named as
  `[confirmed]` or `[open]`.
- Reject: "fast and secure" with no number; six empty rows; a security console for a
  personal tool; compliance invented on the user's behalf.

**11. Terms and contradictions** — Two names for one thing split the downstream work; two
requirements that cannot both hold must be chosen now.
- Main: "What do you call this internally? Any other names? You want A and B; in X they
  conflict — which wins?"
- Follow-up: "both matter" → "keep only one — which?"
- Accept: one name per thing in the spec; every contradiction has the user's choice in
  decision basis.
- Reject: "depends" with no rule; a contradiction left standing.

**12. AI capability** (only if the product uses AI) — Probability needs a quality bar, a
trigger, a never-do list, and a cost. Litmus first.
- Main: "If the AI were replaced by fixed rules or a search box, does the core value
  survive?" Then five good and five embarrassing outputs; the hit rate you would ship at and
  the alarm line; suggest-then-confirm or act; the most expensive error and what it must
  never do; latency and cost per day.
- Follow-up: "just use AI" → "generate, see, or answer from your own documents? the last
  needs retrieval." "we want an agent" → "does it act across tools, or only suggest?"
- Accept: litmus passed; quality bar; trigger; never-do; uncertainty behaviour; degradation;
  latency and cost.
- Reject: "more accurate" with no number; no fallback; no trigger; "use AI" with no kind.

**13. Agent specifics** (only if the product is an agent) — The first decision is the
autonomy boundary; evaluation and cost are the usual omissions.
- Main: autonomy per action class (suggest / confirm / auto-reversible / auto-irreversible);
  tools and permission levels; context and memory; one agent or sub-agents; evaluation set
  and observability; cost cap and runaway control; stuck-loop detection and hand-back;
  session resume.
- Follow-up: "fully automatic" → "deletes, spends, or sends too? the most expensive step
  gets a gate." No eval → "what re-runnable set tells you it got worse?" No cost → "what
  is the per-task cap, and does it trip a breaker?"
- Accept: a classed autonomy map; tools with permissions; eval and a cap; a hand-back
  condition.
- Reject: "fully automatic" with no classes; no evaluation; no cost cap; the agent always
  recovers itself.

Companion requirements: when the user names a main action, raise only the one or two most
relevant companions with their cost; the rest goes on the later list.

| User mentions | Ask about |
| --- | --- |
| upload / import | format allowlist, size and count limits, progress, partial success, where it is kept, whether it can be deleted |
| canvas / timeline / drag | selection model, undo, autosave, recovery from mistakes, keyboard alternative |
| AI generation or edits | versions and original kept, cancel, retry without duplicate side effects, where results land, provenance |
| long tasks | task identity, progress, cancel, find it again after closing, duplicate-submit protection, logs |
| external interfaces | where credentials live, allowed hosts, what data leaves the machine, rate limits and failure |
| delete / overwrite / publish / send | confirmation or undo window, preview, backup, audit trail |
| multiple people or roles | who sees what, concurrent edits to one record, departures and handover |
| money | rounding rules, reconciliation basis, who may change a submitted figure |

## Discovery methods for hard unknowns

Open the branch that matches the gap; none of these is a checklist to walk in full.

**1. The problem, the current workaround, and the reason to adopt.** Use when all you have is a
solution name ("a platform", "add approvals", "AI to save time") or the plan deletes a step that
looks redundant. Find the last real event, the current tool or spreadsheet, waiting and rework,
and de-identified work products; separate the direct user, the receiver of the result, and the
person who decides to adopt. Ask "when this got stuck last time, who patched it and how did it
end?" and split the answer into trigger, loss, remedy. Ask "whose mind does this signature put at
rest — what happened when it was missing?": accountability stays, notification finds a cheaper
form, policy points at its source. Enough when participants, the concrete difficulty, why the
workaround falls short, and the outcome to change are written with basis and inference apart.

**2. Outcomes versus proxy metrics.** Use when "more efficient / smarter / satisfied" would steer
the design. Ask "when it is done, what does the next colleague rely on to continue? If the system
says success but that thing never appears?" — the outcome is the fact, not the click. Ask "if this
number rises, could the task be done worse?" — clicks can come from retries, generations from poor
quality; keep those as diagnostics, write the outcome separately. Unmeasured baselines are
written "unmeasured", never zero or a guess.

**3. A complete but minimal result chain.** Use when scope is a list of feature names, page names,
or buttons. Walk purpose → object → action and input → judgement → fact change and where the
output goes → visible feedback → exit or recovery. Ask "after submit, who receives what, so they
no longer have to watch the page?" and "if this capability is removed, can the person still finish
by the rules?" — if not, it belongs to the minimal chain. Compound actions get per-part outcomes
(save succeeded, notify failed is not "all failed"). Do not amputate the necessary check or
recovery to keep "one feature", and do not grow a whole admin console to compensate.

**4. Object lifecycle and permissions.** Use when save, delete, publish, cancel carry several
business meanings, or different roles change one object. Ask "does cancel mean the slot is freed,
or that the history disappears too?"; "A can see this record — can A change it for B? who must
know afterwards?" Same object, different states with different meanings become separate facts
(booking state and notification state coexist). Same name never proves same person or same
intent.

**5. Partial success, unknown results, same intent.** Use for compound actions, network calls,
retries, long jobs, batches, or unexamined claims like "on timeout, redo" and "dedupe by name".
Ask "the first step is saved and the second got no reply — what still counts?"; "trying again:
find the earlier result, or start another? may two people with identical details each have one?"
A request that timed out only means no reply — the server may have executed. Write what the
person knows, does not know, and may check, continue, or leave.

**6. AI necessity, quality, and failure control.** Use only when the user asked for AI or the task
evidence supports it. Compare the no-AI approach (rules, search, template, a person) in the same
task. Ask for one output usable as-is, one that needs editing, one that must never ship, and what
distinguishes them; "if it looks right but is wrong, at which step is it still catchable?" —
place preview, source check, human confirm, or a narrowed use there. Latency and cost each get
their own basis (start/stop points, typical and tail wait, per-call or periodic cost, input and
output sizes, retry cost); no vendor marketing numbers.

**7. Action boundaries, only for real agent products.** Use only when the product acts or calls
tools on the person's behalf. Which actions run directly, which are shown before running, which
are forbidden; source and result retention, running state, what already happened after cancel
or interruption, human takeover. A product spec grants no permissions to the current session.

## Coverage scan

Before each turn, silently rate ten classes as clear / partial / missing: core outcome and
people; current state and its cost; rules and exceptions; who decides; success criteria; scope
and non-goals; key flows and failure paths; data and permissions; product shape and
non-functionals; terms and contradictions. Ask only about a gap that would change what is built,
ordered by impact × uncertainty, one at a time, in the fixed shape: one complete question, one
sentence on why it matters, a recommended answer (two to four options when discrete, the
recommendation first with a reason). Write each answer straight into the section and the
clarification log, replacing the stale sentence so no contradiction remains in the text.

Stop asking when the key classes are clear, the user says enough, or the budget is reached; a
remaining high-risk gap goes to the open-questions table with its due date and the interim
default.

## Requirements self-review (the spec's unit test)

Each item asks "is it written clearly?", never "does the system behave correctly?" — that is the
test-design skill's job. An unanswered item is a gap: one that would cause rework goes back to the
interview; a cheap one goes to the open-questions table.

- Completeness: overview names why, who benefits, who pays, who may lose, with one real case; at
  least one as-is story with a name, an order, and tools, exceptions written separately; every
  core function in three parts (user does → system does → gets); every rule with an example and
  an exception or an explicit "none"; at least one flow with a named protagonist, a climax, and
  a failure path with trigger, message, data protection, next step; entities, relations, single
  writer, visibility, delete path (skippable for pure front-ends); at least three explicit
  non-goals with the later list kept separate.
- Clarity: no "fast, simple, intuitive, seamless, smart, reasonable, appropriate, optimised" left
  in functional items; one name per thing; every function traceable to a case or a quote;
  product shape written.
- Consistency: no exception that the functional item would route wrongly; every flow step has a
  function; success criteria depend only on P0 items; every contradiction shows the user's
  choice and matches the body.
- Measurability: success criteria countable, technology-free, baselined, with at least one
  guard metric; six non-functional classes each with a number or "not required"; AI items with
  quality bar, trigger, never-do list, uncertainty behaviour, degradation, latency and cost.
- Marker discipline: no `[open]` in functional items; every open-questions row has impact, who
  can answer, due, interim default; every `[confirmed]` points at a case or a quote and no relay
  or guess slipped in; every `[default]` is low-risk, vetoable, and gives its basis.
- Implicit compliance named (personal data, payments, health, physical equipment, minors) as
  `[confirmed]` or `[open]` for dfx-design — never invented on the user's behalf.
- Handoff: design-brief can start from context of use, primary action, personas, and named flows;
  architecture-design and dfx-design can tier from data ownership, failure consequence, and
  compliance; a dispatcher can copy each function's why / who benefits / rules into a Business
  Context field.

Two closing tests. **Handoff test**: an engineer who was not in the conversation can start
without guessing; wherever they would guess, the spec is not done. **Marginal test**: would one
more question change what gets built? If not, stop. **Asymmetry**: what would cause rework
(foundation, scope, key flows, rules and exceptions, data ownership) is asked to the end; what is
cheap to add later (edge styling, phase-two features) goes to the table and ships.

## Elicitation menu (optional pressure test)

Offer three to five methods that fit the spec's risk, one line each, plus "none, continue"; run
at most two; each yields "revealed → proposed"; nothing enters the spec without the user
accepting it, accepted items are `[confirmed]` with source "elicitation + user".

| Method | One line | Best when |
| --- | --- | --- |
| Pre-mortem | Assume it failed six months after launch; work back to "if only we had…" | external product, core flow rebuilt |
| Inversion | "How would we guarantee failure?" then invert | scope creep, vague goals |
| Assumption audit | List every `[inferred]`/`[default]`, score confidence × impact, stress the weakest three | many inferences or open items |
| Stakeholder rotation | Re-read as beneficiary, payer, loser, operator | beneficiary and payer differ |
| Steelmanning | Write the strongest version of the option the user rejected and compare | user insists, agent disagrees |
| Hindsight | Imagine success; which step was decisive, which nearly sank it | unclear success criteria |
| Five whys | Ask why five times on the as-is pain | as-is story is only symptoms |
| Reframe | Is the stated problem the real problem? | user leads with a solution |
| Boundary sweep | Zero, empty, huge, concurrent, wrong type, offline | money, data, external interfaces |
| Cascading failure | Where does one failure propagate through dependencies? | external systems, multi-role flows |

## Iteration mode

Triggered by a change request during development or by a downstream **requirement in doubt**
counter-example from code review, test design, or debugging. No preamble; pick up the request
directly, still under the interview rules.

Change classes decide the depth and the rollback point: clarification (no behaviour change);
scope added; scope removed; behaviour change (same capability, different rule or outcome);
data or permission change; acceptance change; correction (the old spec misread the user —
most downstream counter-examples are this).

Ask only the highest-risk unknowns the change introduces, never the whole bank again:

1. Why change — what event triggered it.
2. Which earlier judgement was wrong — spec item, its basis then, why it is wrong now; a pure
   addition is "new, no prior judgement".
3. Does the new behaviour replace the old or coexist.
4. Which confirmed items and which flow steps are affected.
5. Input, output, data, permissions, platform affected?
6. Old data or old flows to stay compatible?
7. Success criteria or acceptance to add, change, or retire.

Conflict detection before editing: explicit non-goals, settled decisions, confirmed rules and
exceptions, data ownership and visibility, success and guard metrics, answered clarification
entries. A hit is shown as two lines side by side for the user to choose; never a silent pick.

Impact matrix, one line per change: spec sections → design brief screens and components →
dev-plan phases and tasks → code modules → tests that go stale → the stage to return to.
Description only: no rollback. User flow, screen structure, data, permission, platform: back to
design-brief or architecture-design, then dev-plan. Design unchanged, effort changed: dev-plan.
A code defect with no requirement change: root-cause-debugging, spec untouched. The skill only
names the return stage; the orchestrator routes.

Editing: change in place, keep the structure, touch only what moved; update markers and sources;
counter-examples enter *Rules and exceptions* with their source; append to the clarification log;
overruled items are marked "→ superseded <date>" and never deleted or renumbered; a new AI
capability gets the dimension-12 questions. The changelog entry answers four things — what
changed, why, which judgement was wrong, which confirmed items are affected — plus class and
rollback stage, and distinguishes a user's new requirement from the agent's earlier
misunderstanding (the latter is never booked as the user widening scope). Then replay the
changed case; passing the replay is completion.

Correction propagation: when the user corrects a misreading, first restate the corrected meaning
and the concrete error the old reading would have caused; trace from the affected item to
architecture boundaries, quality targets, UI copy and states, tasks, and acceptance; update what
this skill owns and return the rest to the orchestrator with source, old and new reading, and
impact; pause only the work that depends on the corrected rule.

Forbidden: editing one description and leaving flows, acceptance, or the changelog stale;
deleting history without a changelog line; disguising an implementation bug as a requirement
change; re-running the whole bank for a local change; declaring the plan valid while its
downstream products are stale.

## Requirements depth

The assurance profile in force and the task's risk decide how formal the document gets; the
method above does not change, only the artefact:

- **research** — deliver the problem, known facts, evidence, and unknowns; never call research a
  buildable spec.
- **brief** — goal, scope, key behaviours, acceptance, constraints; one short page is allowed.
- **structured** — organised by function and flow, with affected inputs and outputs, error and
  boundary cases, acceptance conditions.
- **formal** — structured plus stable requirement IDs (`REQ-<area>-<nnn>` at the start of the
  list item), public contracts, failure behaviour, traceable acceptance, and the quality
  attributes that apply; the IDs are what a plan or a test can cite.

An existing document is extended only where the change reaches. Existing filenames, structure,
and IDs are kept; `Product-Spec.md` and `Product-Spec-CHANGELOG.md` are defaults for a new
document, not requirements to rename a project's PRD.

## Next-step triage on delivery

Three lines, each "do" or "may skip" with one reason drawn only from the spec:

- Architecture design: do if the exposure class is external, money, or regulated, or core functions
  ≥ 6, or data entities ≥ 4, or the user asked for modules; else may skip — the risk is module
  boundaries improvised while coding.
- DFX: do if money, personal data, health, or physical equipment appears, or a P0 non-functional
  number already exists; else may skip — the risk is quality attributes that stay adjectives.
- Design brief: do if the product has a UI; pure CLI or backend may skip.

These are judgements, not orders; a skipped line and its reason go to `progress.md`.

## Worked dialogues

**Explore tier — the user thinks it is clear.**

> User: an after-sales ticket system — support logs a ticket, dispatches to repair, repair reports back.
> Agent: first a real one: the most troublesome ticket last week — how did support log it, whom did it go to, how did the report come back?
> User: support keeps a spreadsheet, messages the repair lead, the lead forwards to whoever is free, the technician posts a photo in the group when done.
> Agent: so "dispatch" today is the lead's memory and "report" is a photo in a group. Has the lead ever dispatched wrongly? How was it noticed?
> User: last month, to someone who could not repair that model; the customer waited two more days. We found out from the complaint.
> Agent: noted — `[confirmed]` dispatch must see which models each technician can repair (source: last month's case); `[inferred]` customer waiting time is a core metric (source: the complaint was the detection channel, please confirm). Is there any ticket that does not go through the lead?
> User: VIP customers go straight to Zhang.
> Agent: that is an exception: rule "lead dispatches", exception "VIP straight to Zhang". What if Zhang is away?
> User: …never thought about it.
> Agent: it changes how the dispatch rule is written but does not block logging tickets. I will write "fall back to the lead" as a `[default]` and add an open-questions row: "VIP when Zhang is away — you or Zhang can answer, due before phase 2". Right?

**Direct and confirm tiers.**

> User: rename the "Submit" button to "Dispatch".
> Agent: done — ticket page primary button "Submit" → "Dispatch", spec 4.2 updated. *(direct: no question.)*
> User: add an export.
> Agent: export the current filtered tickets or all of them? Why it matters: it decides whether the export carries the filter. Recommendation: current filter, because you look at tickets per technician — say so if not. *(confirm: one question with a recommendation.)*

**Anti-examples**

- Five questions at once (positioning, users, features, flows, platform) — a questionnaire; the
  user answers the easy ones and drops the important one.
- Turning "customers usually phone to chase" into "the system shall support phone chasing" —
  "usually" is an inference with no case; mark `[inferred]` and ask for one.
- Asking "React or Vue" after the user said "you pick the stack" — delegated is settled; decide
  and record it.
- Answering "as fast as possible" with "OK, performance is a priority" — no trade-off was made;
  ask "if you can keep only one: fast logging or accurate dispatch?"
- Interrupting the as-is story to pitch AI dispatch — hear the current state first; raise AI once
  the dispatch rules are clear and say who catches a wrong dispatch.
- Writing "export format `[open]`" inside a functional item — write the `[default]` (CSV, source:
  today's spreadsheet) and put the open row in the table.
- Asking "what UI do you want" — layout belongs to design-brief; here only context of use and
  the primary action.

**Marked fragment** (how a spec section looks after the dialogue above — not a full spec):

```text
### Dispatch
[confirmed] Lead picks a capable free technician → system records the assignment and the
skill used → the ticket reaches that technician (source: last month's wrong-model
dispatch; the customer waited two more days; found via complaint).
[confirmed] VIP ticket arrives → system assigns Zhang → Zhang sees it first (source:
user, same session).
[default] Zhang is away → system assigns the lead → VIP is still logged (basis: keeps
logging unblocked; user may veto).
[inferred] Customer wait time is a core success metric (basis: complaint was the
detection channel — confirm).

## Open questions
| ID | Question | Impacts | Who can answer | Due | Meanwhile do |
| --- | --- | --- | --- | --- | --- |
| Q-1 | VIP when Zhang is away | dispatch fallback | user or Zhang | before phase 2 | the default above |
```

A functional item never carries `[open]`. The open row lives only in the table. Unmarked
prose in a generated spec is treated as `[inferred]` and is a defect in the self-review.
