---
name: domain-rulings
description: Keeps a domain-rulings library in domain/ (how things are counted in this field, independent of the code) — triages knowledge, records qualified rulings, answers what a value means now. Use to record a ruling.
---

# Domain Rulings

A ruling says how something is *calculated* in this domain ("the join key is the OLT IP address,
never its name"). It survives a rewrite of the code and a change of implementer; that is what
separates it from a project decision (`progress.md`), an AI behaviour lesson (the feedback
corpus), and a functional requirement (the spec). The library is a by-product of requirements,
clarification, and design conversations — never a gate, never on any acceptance path, never
nagged for. It exists so the agent's next spec, architecture, and interface come out more
accurate; a project without `domain/` is normal. Carrier: `domain/<domain>.md` at the project
root, one file per domain of the field (not per module of this project), `domain/_unsorted.md`
for what has no home yet.

1. Recognise the request: "record this" → manual intake; "what does X count as now / which
   version" → look up the current value; "what needs re-checking / is this still valid" → list
   the review queue; "what depends on this" → dependants; a piece of knowledge told without a
   request → triage first. When unsure, ask "record or look up?" rather than guess.
2. **Triage by one question — who knew this originally?** Four quadrants, one exit each: the
   user knew, the agent did not → the spec's *Rules and exceptions* (route to `product-spec`
   iteration; do not record here); the agent knew, the user did not → technical direction or a
   decision (architecture ADR or `progress.md`); both knew → a functional requirement (spec
   body); neither knew and it took joint investigation to establish → the library, the only
   entrance. Ask the question and wait; never offer the answer ("this is one you already knew,
   right?") — the user will nod and the four quadrants collapse into one. A machine cannot do
   this triage: the four look identical; only where each came from differs.
3. Two admission questions, in order: (a) *which step of the agent's next output will differ
   because of this?* — no answer, no record, even if it is true (a library of correct noise is
   still noise); (b) does it still hold once this project's work is finished and does the next
   person need to read it? Scope limits of this batch ("do not add tables this round") fail (b)
   and are not recorded; a current data state that will be repaired ("the connectivity column is
   all NULL in this session") is *known contamination* attached to its ruling, not a ruling.
4. Fill the **seven columns**: current value (as a criterion — "join key = OLT IP, name forbidden"
   — never a narration like "usually the IP", which leaves room for the model to fill); basis
   (one of three kinds only — measured on real data, found by the agent in public sources, found
   by the user inside the organisation; memory and inference are refused however confident; a
   ruling needs two kinds to stand — a measurement alone explains the phenomenon, not the reason,
   and stays a clue); applicable scope; supersedes; expiry condition;
   depended on by; known contamination. One criterion per ruling — a sentence with two criteria is
   split. Basis gaps are named with who must go and look (the agent to public sources, the user
   to internal ones); the agent never invents the missing half.
5. Changes are of three kinds: **revision** (same criterion, new value → a new version of the same
   ruling, not a new ruling); **supersession** (a new ruling replaces an old one → the old one is
   marked, never deleted, or the model will retrieve the old wording); **narrowing or widening**
   (same value, different scope — the one most often missed). History lives in git; only
   supersession is written into the entry, because the model cannot read the log.
6. Ageing comes in four kinds and only one is repair: condition expiry (the expiry condition
   fired), dependency expiry (a ruling this one depends on changed → this one enters the review
   queue — the most important and most forgotten path, so *depended on by* must be accurate),
   bulk expiry (a module retired), and contamination (ruling right, data wrong; fixed when the
   data is — never confused with expiry, or someone edits a correct ruling). No periodic sweep:
   twenty entries can be re-read, two hundred cannot, and most rulings are definitions that do not
   change.
7. Write the entry into `domain/` yourself — the intake gate and the qualification gate stay two
   separate judgements even when one agent makes both: first "is it worth recording?" (step 3),
   then "does it qualify?" (basis kinds, seven columns, no collision with an existing entry). A
   collision is a revision, a supersession, or a scope change, never a second truth. Update the
   reverse links in the entries it depends on; mark dependants of a revised ruling for review.
   Record the triage outcome as a decision in `progress.md` when a candidate was refused or sent
   to the spec; the library's own edits are not logged there.

Read at task level, not session level: when dispatching, copy matching rulings into the pack's
Business Context alongside the spec's rules; when reviewing, a ruling is the other half of the
criterion (the spec says the field appears, the ruling says how it is computed); before a spec
change, read the current rulings so the new requirement does not contradict one; when setting a
debugging expectation, a ruling is one source of "expected". Never attached to `recap`, session
start, or the opening of every conversation — most rulings are irrelevant to the task at hand and
loading them all trades context for noise.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; a lookup
answers current value, scope, expiry, superseded status, and contamination; a triage that records
nothing is complete when its quadrant is named and the correct destination pointed at.

Load [REFERENCE.md](REFERENCE.md) for the entry format, the sorting classes with their evidence
from real backfills, the trigger sources, the destinations for the three kinds of finding a
receipt's Domain findings field carries, and worked dialogues.
