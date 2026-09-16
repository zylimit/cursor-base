---
name: record-lesson
description: Records a correction, incident, or recurring pattern as a lesson with scope, exceptions, supersession, and landing point; proposes graduation once codified or costly. Use after a user correction or a general defect.
---

# Record Lesson

1. Decide whether it is a lesson and which kind. A user's correction splits in two: a **business
   fact** ("complete means accepted, not submitted") goes to the spec and to `progress.md`
   Decisions; a **method lesson** ("the agent kept asking what it had already been told") goes to
   the corpus. Same event, two records, each pointing at the other; teaching new facts, changing
   a requirement, or a productive back-and-forth are not method failures. Prefer missing a
   marginal lesson over flooding the corpus — a corpus nobody trusts records nothing.
2. Apply the correction *now*, before recording it: fix the current artefact, the affected
   dispatch, and the acceptance; recording a lesson is not the fix and never waits for
   graduation. Then say what changed — "this correction changed X in file Y" — so the user can see
   it took.
3. Check `node scripts/harness.mjs feedback list`. An existing lesson is updated with this
   occurrence's *scenario* (the second time it bites, what is valuable is what the second time
   looked like, not a counter), `last_seen`, and `occurrences` only for an independent new event —
   re-reading, restating, or several roles citing the same event add nothing. A conflicting old
   lesson is superseded by name, and the old file notes what corrected it.
4. Otherwise copy `docs/feedback/TEMPLATE.md` to `docs/feedback/<kebab-case-id>.md` with the
   frontmatter (`id` equal to the filename, `occurrences`, dates, `graduated: false`) and a body
   of: one-sentence title as an instruction; what happened and how the user corrected it, quoting
   them; the scenario; what to do instead; **scope** (which stages, roles, project kinds),
   **exceptions** (when it does not apply; a rule without a range is applied where it should not
   be), **supersedes** (which rule or lesson it replaces; two coexisting rules fight); **applied
   to** (the file and section, the decision date, or the dispatch where this correction already
   landed — `pending` means it has not taken effect yet); the evidence.
5. Score a skill's effectiveness only after a real run and only with evidence per score (accuracy
   against what was known at the time — a later fact is not an earlier mistake; coverage by actual
   gaps, not step counts; efficiency by avoidable repetition, not by turns — teaching takes turns;
   satisfaction only from the user's explicit words — silence, moving on, and edit requests are
   not scores). Omit any dimension without a basis; never fill a zero.
6. Run `node scripts/harness.mjs feedback lint`; a malformed lesson fails validation for the
   whole repository, deliberately — unreadable memory is no memory.
7. Graduate by two questions, not by a count. When `feedback list` lists candidates (three or
   more occurrences) — and also for any lesson that keeps mattering — first **check the present
   state**: grep `AGENTS.md`, the rules, the skills, and the agents; if the lesson is already
   codified, mark it graduated with the file and section, adding nothing. If not, ask **what it
   actually cost**: a recorded rework, a stall, a frozen feature, a repeated dispute justifies a
   proposal; a correction with no recorded cost is "not yet codified", written into the file so the
   next scan does not re-judge it. Propose, with the user's confirmation, an executable check
   first, a skill step second, rule text last; then set `graduated: true` and keep the file as the
   record of why the rule exists.

Prefer graduating into an executable check over more always-applied prose: instruction text
costs context on every request, a check costs nothing until it fires.

Return the standard receipt: **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the writing contract, honesty rules, the graduation scan
(codified-already, real cost, skill-optimisation and new-skill signals), and what each stage of a
lesson's life does and does not prove.
