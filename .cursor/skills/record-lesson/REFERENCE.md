# Record Lesson Reference

## What qualifies

- A user correction of agent behavior ("I said X, you did Y") — the strongest signal there is.
- A defect whose cause generalizes beyond the specific file ("configuration defects recur in
  sibling instances", not "line 42 had the wrong timeout").
- A workflow gap hit twice: the second occurrence is the lesson.
- A gate or check that fired on a real problem in a way worth institutionalizing — or that
  demonstrably never fires and should be questioned.

What does not qualify: one-off environment noise, preferences without an incident behind them,
and anything already covered by an existing lesson (increment that one instead).

## Writing contract

The lint (`feedback lint`) enforces structure; these rules keep the content useful:

- Title states the instruction, not the story: "Re-read live state before destructive
  operations", not "The incident of August 7th".
- Body: what happened (2–3 sentences), what to do instead (imperative, usable without this
  context), evidence (command, output, diff, or conversation reference).
- Conclusions and constraints only. Debugging narrative slows every future recovery read.
- No secrets, no personal data, no internal URLs that would leak if the file were ever shared.
  The corpus never ships with the installer, but write as if it might be read aloud.

## Three memories, one event

- **Business facts** — how this project's business works, what was decided, what is settled —
  live in the spec (rules and exceptions) and `progress.md` (Pinned, Decisions); the next role
  receives them through the dispatch pack's Business Context.
- **Method lessons** — how the agent should ask, decide, verify — live in the feedback corpus,
  with **applied to** saying where the correction landed and `pending` saying it has not yet.
- **Domain rulings** — how something is counted in the field, independent of this codebase — live
  in `domain/` (the `domain-rulings` skill). The test: "who knew this originally?" — the user
  alone → spec; the agent alone → architecture or a decision; both → requirement; neither, until
  investigated → ruling.

A user correction usually carries a business fact *and* a method lesson; record both, in their
own homes, pointing at each other, without copying the conversation into either. The host's own
automatic memory, when it exists, holds machine-local trivia only (build commands, debugging
hints); decisions, constraints, and completed work are recognised only in `progress.md`, and
recovery reads files, never that memory.

## Five signals

1. **User correction** — "not like that", "you got it wrong", a hand edit of the agent's output.
   Check what the agent already knew and what was actually corrected; a hand edit alone does not
   prove the skill failed — it may be a new fact, a changed requirement, or normal co-editing.
2. **Uncovered situation** — the skill gave no guidance and the agent improvised or skipped a
   step; state how the missing method changed a real decision; professional judgement the skill
   allows is not a gap.
3. **Repeated request** — the same kind of task asked in natural language three or more times
   with no skill behind it.
4. **Recurring quality defect** — the same class of error across several phases (types, naming,
   style side effects).
5. **Skill effectiveness** — only after a real run, with a basis per score.

## Honesty rules

- `occurrences` counts independent events, not restatements in the same session; several roles
  citing one event count once; a re-read counts zero.
- Recording a lesson is not the fix. If the incident broke something, the fix and its receipt
  are separate work; the lesson records the class, not the instance.
- Do not inflate: a lesson recorded to justify a decision already made is advocacy, not memory.
- Scores: never a zero for "unknown", never a copy of another dimension, never a high score for
  silence. Existing scores stay as written; a score later found to rest on a silence assumption or
  on turn counting gets a note in the body and is excluded from the next scan's sample — the
  history is not rewritten.

## What each stage proves

| What happened | May be said | May not be said |
| --- | --- | --- |
| the lesson is written in its home | recorded, with location, scope, supersession | the behaviour changed, anything was verified, the user is satisfied |
| a skill, rule, or dispatch was changed | landed in that artefact, with the current diff | independently verified; the next role adopted it |
| an independent re-verification ran | that scenario passed in that environment, with failures and unverified edges kept | every scenario works; a real user accepted it |
| the next role decided differently because of it | adopted — cite its artefact, decision, or re-run and the behaviour that changed | habit formed, from "read it", "will comply", a role's DONE, or silence |

`progress.md` `Done` entries name what was finished and the evidence boundary; unfinished wholes
stay `In progress` with an owner. A lesson written and a source updated do not stop the current
task from following the correction immediately.

## Graduation scan

Run over the corpus when `feedback list` reports candidates, when a lesson keeps mattering, or
when the user asks. Counting was the first design; in one sibling corpus 39 of 43 lessons stayed
at one occurrence because nobody maintained the counter, and every threshold rule rode on it —
so the count is a hint and two questions decide:

1. **Codified already?** For each `graduated: false` lesson not marked skipped, grep `AGENTS.md`,
   the rules, the skills, and the agents for its substance (wording may differ). Fully codified →
   graduate as a fact, cite file and section, add nothing. Partly → name the codified half and
   the missing half. Absent → continue.
2. **Real cost?** The body records a rework, a stall, a frozen feature, or a repeated dispute →
   propose a landing. Only "the user corrected it once" → "not yet codified", with the reason in
   the file and the index so the next scan does not re-judge it; the next occurrence with a cost
   reopens it. Gates and rules are kept by evidence, not by feeling; a rule without a real cost
   behind it is one more clause nobody keeps.

Then the two lesser signals: **skill optimisation** — three or more open lessons pointing at one
step of one skill (clustered by theme, not by count; graduated lessons are out), or effectiveness
scores that are consistently low with a basis; **new skill** — a repeated operation pattern with
no home in any skill. Each proposal explains which behaviour went wrong in which situation, the
minimal change, which correct behaviour to keep, and a falsifiable re-check scenario. Fewer
questions or more automation are not goals; accepting facts, corrections, and handoffs accurately
is. A project-specific business definition never graduates into a rule for all projects — it stays
a project fact.

Retiring a rule states what it protected, whether the failure condition still exists, where the
replacement coverage is, the residual risk, and the recovery; zero hits, no complaints, or "the
model has internalised it" justify nothing; safety, secrets, permissions, and remote-effect
boundaries are never retired by a proposal.

## Graduation targets, in order of preference

1. **Executable check** — a fitness rule, verification-matrix check, or hook behavior. Fires
   only when violated; costs nothing otherwise.
2. **Skill step** — when the lesson changes how a workflow should run.
3. **Rule text** (`.cursor/rules/`, `AGENTS.md`) — last resort, because always-applied prose
   costs context on every request. Reserve it for invariants that checks cannot see.

Graduation requires the user's confirmation: promotion changes repository policy, and policy
changes are theirs to approve. After promotion set `graduated: true`; the risk scan stops
proposing it, and the file remains as the recorded rationale.
