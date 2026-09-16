# Skill template

Copy, replace the brackets, delete what the skill does not need. The loader reads only
`<root>/<name>/SKILL.md`; detail goes to `REFERENCE.md` beside it; artefact shapes go to
`templates/`. No executable scripts — invoke `node scripts/harness.mjs <command>` instead.

## SKILL.md

```markdown
---
name: skill-name-in-kebab-case-equal-to-the-folder
description: Trigger conditions in one or two sentences, under 220 characters — what situation, what it produces; not a summary of the steps; a plain YAML scalar with no colon-space and no leading bracket, hash, or quote.
---

# [Title]

[One or two sentences: what this skill does and what it refuses to do. Modes, if several.]

1. Write the envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
   [Preconditions: which sources or files it needs; how a missing one degrades; what is
   escalated rather than guessed.]
2. [Method step as a decision: when this applies, what evidence to gather, how to judge, what a
   wrong answer looks like.]
3. [Method step.]
4. [Method step with the harness command it uses, e.g. `node scripts/harness.mjs affected`.]
5. [Convergence: what "done" looks like, stated so someone else could check it.]

[Handoff: what goes to which skill, role, or file (`progress.md`, `docs/…`).]

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**[; for product
work add **Business assumptions / Counter-examples / Domain findings**].

Load [REFERENCE.md](REFERENCE.md) for [the tables, examples, and rules it holds].
```

Optional front-matter key for side-effecting workflows the user must invoke by name:

```yaml
disable-model-invocation: true
```

## REFERENCE.md

```markdown
# [Title] Reference

## Principles
[Three to five, each one sentence with its reason.]

## [Domain checklist or dimension table]
[What to look at; where each item becomes enforceable, if anywhere.]

## [Method]
[How: the evidence, the judgement, the branches, the convergence.]

## Worked examples
[One good dialogue or walk-through; a short list of anti-examples.]
```

## Optional sections

- **Sufficiency judgement** (collection and analysis skills): what must be known before producing;
  what may stay open and where it is parked.
- **Iteration mode** (skills with a living artefact): how a change is located, what is touched,
  what is only flagged for another skill.
- **Pressure cases**: the requests that push toward over-design, tier inflation, or skipping
  evidence, and the refusal each gets.
- **Rollback** (release and deployment skills).
- **Scenarios** (kept while authoring, not shipped in the skill): trigger sentence; facts known at
  that turn; behaviour to keep or edge to watch; checkable expectation; actual result on the old
  and the new version, or "not run".

## Quick check

| Item | Rule |
| --- | --- |
| folder | `.cursor/skills/<name>/` |
| entry | `SKILL.md`; detail in `REFERENCE.md`; artefacts in `templates/` |
| front matter | `name`, `description`; `disable-model-invocation` only when needed |
| description | trigger conditions, < 220 characters |
| body | one screen; numbered steps; commands as `node scripts/harness.mjs …` |
| language | technology-neutral; repository-relative POSIX paths; no secrets, personal paths, placeholders |
| checks | `node scripts/harness.mjs skills-lint`, `node scripts/harness.mjs instructions` |
