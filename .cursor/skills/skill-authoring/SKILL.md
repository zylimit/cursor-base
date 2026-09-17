---
name: skill-authoring
description: Creates or revises a repository skill so it teaches a method, not headings. Use when adding or rewriting a skill; not to fatten REFERENCE, and not to stand up an eval harness.
disable-model-invocation: true
---

# Skill Authoring

A skill is loaded only when its `description` matches, then paid for in full. It must route
correctly, load correctly, and leave the agent able to act.

## Task

Create or revise a skill so `skills-lint` is green, the method is operational (accept / reject),
and scenarios judge it against the version it replaces.

## Preconditions

- The problem, the trigger (auto by description, or `disable-model-invocation: true` for
  side-effecting or sleeping workflows), inputs, outputs, and the situation in which a user
  would be misled.
- For a revision, what the current version already does right. A graduating lesson is read at
  its source first.
- Invoke by name.

## Invariants

- Required headings: `## Task`, `## Preconditions`, `## Invariants`, `## Method`. Handoff and
  Example are optional. A dimension name is not a method.
- Description is a YAML plain scalar: no unquoted `: `, no leading `#` `[` `{`. Quote it if
  a colon-space is required. `skills-lint` errors on a missing section, a camelCase key, or a
  non-boolean `disable-model-invocation`. The description states when to use it **and** one
  near-miss when not to (a copy tweak, a missing feature, an eval harness).
- Explain why a constraint exists. A wall of ALWAYS / NEVER without a reason trains the model
  to follow the letter and miss the spirit. `skills-lint` still needs the mechanical headings;
  the method still needs the reason.
- No executable skill scripts. Invoke `node scripts/harness.mjs <command>`.
- Unknown licences, secrets, session state, and hidden install behaviour are excluded.
- RED→GREEN is claimed only for a scenario the old version actually failed.
- No skill-eval harness, no description-optimizer loop, no with-skill / without-skill
  subagent farm. Those are out of this repository's cut. Scenarios in chat or a short
  comparison note are the judgement.

## Method

1. Write the envelope. Gather trigger, inputs, outputs, and the misleading case. Write
   should-trigger and should-not-trigger phrases into the description, not only into the body.
2. Pick one or two existing skills as the pattern **by interaction type** (elicitation,
   analysis, execution, diagnose-then-fix). Read them for section naming and accept/reject
   density — not for domain colour. Prefer `product-spec` for interview, `scoped-implementation`
   for execution, `root-cause-debugging` for diagnose-then-fix, `plan-change` for planning.
3. Design two or three scenarios before writing: one real ambiguity, one small clear task that
   must not become an interview, and where relevant a delegated "you decide".
4. Fill from `templates/skill-template.md`. Operational accept/reject lives in `SKILL.md`. Long
   tables go to `REFERENCE.md` with an explicit load moment. Thickening REFERENCE is not the
   fix for a shallow skill.
5. Record provenance for anything absorbed. `skills-lint` and `instructions` must pass.
6. **Reader test.** Predict five questions a stranger would ask of the skill (or of an artefact
   it produces). Answer them from the files alone, as if this conversation did not happen. A
   miss is a hole in the skill, not a note to "see the chat". Run the scenarios when the
   environment allows.
7. Register in `README.md` and `docs/CAPABILITY-MATRIX.md`; `manifest --write` so new files
   enter the manifest.

Accept: a trigger, a negative trigger, a judgement with a why, a handoff, and a scenario that
could fail. Reject: numbered ceremony with no accept/reject; MUST-walls with no reason;
sleeping a skill that should auto-route (or the reverse); adding an eval runner.

| Thought | Reality |
| --- | --- |
| "I'll put the method in REFERENCE to keep SKILL.md short" | Short and empty still fails. Load-bearing branches stay in SKILL.md. |
| "ALWAYS / NEVER will make it behave" | Say why. Strong models follow reasons better than volume. |
| "I need an eval harness to know it works" | Two scenarios against the old version. Out of scope here. |
| "Copy cc-base's Chinese sections" | English throughout; synthesise the method, do not paste. |

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**. `Verified`
names the lints and the scenarios actually run.

## Example

Revising a one-page `plan-change` that said "name files and a verify command" but accepted
"similar to step N". Scenario the old version failed: an executor given only Step 3 cannot
run it. New version requires Files / Change / Command / Expected per step. Reader-test
question: "What command proves Step 1, and what must the output show?" — answerable from
SKILL.md without this conversation.

Load [REFERENCE.md](REFERENCE.md) for interaction types, progressive disclosure, and
provenance.
