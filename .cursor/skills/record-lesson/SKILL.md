---
name: record-lesson
description: Records a correction, incident, or recurring pattern as a lesson with scope, exceptions, supersession, and landing point; proposes graduation once codified or costly. Use after a user correction or a general defect.
---

# Record Lesson

## Task

Record a method lesson so the next session does not repeat it, after applying the correction
now. Prefer missing a marginal lesson over flooding the corpus.

## Preconditions

- A user's correction splits: a **business fact** goes to the spec and to `progress.md`
  Decisions; a **method lesson** goes here. Same event, two records, each pointing at the
  other.
- Teaching new facts, changing a requirement, or a productive back-and-forth are not method
  failures.
- Body contract: `docs/feedback/README.md` wins where this skill and the README differ.

## Invariants

- Recording a lesson is not the fix. Apply the correction to the current artefact first, then
  say what changed.
- Re-reading, restating, or several roles citing the same event do not increment `occurrences`.
- Graduate by two questions — already codified? real cost? — not by a count. The count remains
  the candidate trigger (`feedback list`).
- Prefer an executable check over more always-applied prose.

## Method

1. Decide whether it is a lesson and which kind. Accept: "the agent kept asking what it had
   already been told". Reject: "complete means accepted" as a method lesson (that is a
   business fact).
2. Apply the correction now. Then `node scripts/harness.mjs feedback list`. Update an existing
   lesson with this occurrence's *scenario*, `last_seen`, and `occurrences` only for an
   independent new event. A conflicting old lesson is superseded by name.
3. Otherwise copy `docs/feedback/TEMPLATE.md` to `docs/feedback/<kebab-case-id>.md`. Frontmatter
   `id` equals the filename; `graduated: false`.
4. Score a skill only after a real run and only with evidence per score. Omit any dimension
   without a basis. Never fill a zero.
5. `node scripts/harness.mjs feedback lint`. A malformed lesson fails validation for the whole
   repository.
6. When graduating: grep `AGENTS.md`, the rules, the skills, and the agents. Already codified
   → mark graduated with the file and section. Not yet, but a recorded rework, stall, or
   repeated dispute exists → propose (check first, skill step second, rule text last) with
   the user's confirmation. No recorded cost → write "not yet codified" so the next scan does
   not re-judge it.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the writing contract and the graduation scan.
