---
name: skill-authoring
description: Creates or revises a repository skill so it passes the loader, follows the existing pattern, teaches a method not headings, and is judged by scenarios against the version it replaces. Use when adding a skill.
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
  non-boolean `disable-model-invocation`.
- No executable skill scripts. Invoke `node scripts/harness.mjs <command>`.
- Unknown licences, secrets, session state, and hidden install behaviour are excluded.
- RED→GREEN is claimed only for a scenario the old version actually failed.

## Method

1. Write the envelope. Gather trigger, inputs, outputs, and the misleading case.
2. Pick one or two existing skills as the pattern **by interaction type** (elicitation,
   analysis, execution, diagnose-then-fix). Read them for section naming and accept/reject
   density — not for domain colour.
3. Design two or three scenarios before writing: one real ambiguity, one small clear task that
   must not become an interview, and where relevant a delegated "you decide".
4. Fill from `templates/skill-template.md`. Long examples go to `REFERENCE.md` with an
   explicit load moment.
5. Record provenance for anything absorbed. `skills-lint` and `instructions` must pass. Run
   the scenarios when the environment allows.
6. Register in `README.md` and `docs/CAPABILITY-MATRIX.md`; `manifest --write` so new files
   enter the manifest.

Accept: a trigger, a judgement, a handoff, and a scenario that could fail. Reject: numbered
ceremony with no accept/reject; thickening REFERENCE as the answer to a shallow skill;
sleeping a skill that should auto-route (or the reverse).

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**. `Verified`
names the lints and the scenarios actually run.

Load [REFERENCE.md](REFERENCE.md) for interaction types, progressive disclosure, and
provenance.
