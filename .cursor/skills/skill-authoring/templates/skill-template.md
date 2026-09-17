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

## Task
[What this skill produces. Modes, if several. What it refuses to do.]

## Preconditions
[Files, user input, repository state. How a missing one degrades. Escalation versus guessing.]

## Invariants
- [A first principle. Accept / reject in the same bullet when it helps.]
- [Another. Name the command that enforces it, or say it is prompt-only.]

## Method
1. [Decision: when this applies, what evidence, how to judge.]
   Accept: [the answer that counts]. Reject: [the plausible wrong move].
2. [Next decision, with the harness command it uses.]
3. [Convergence: what "done" looks like, stated so someone else could check it.]

## Handoff
[What goes to which skill, role, or file. Receipt line.]

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

## Example
[Optional. One short dialogue or anti-example. Long examples go to REFERENCE.md.]

Load [REFERENCE.md](REFERENCE.md) for [the tables it holds].
```

Optional front-matter key for side-effecting or sleeping workflows the user must invoke by name:

```yaml
disable-model-invocation: true
```

`skills-lint` requires `## Task`, `## Preconditions`, `## Invariants`, and `## Method`.

## REFERENCE.md

```markdown
# [Title] Reference

## Principles
[Three to five, each one sentence with its reason.]

## [Domain checklist or dimension table]
[What to look at; where each item becomes enforceable, if anywhere.]

## Method notes
[Evidence, judgement, branches, convergence — detail the SKILL.md pointed at.]

## Worked examples
[One good dialogue; a short list of anti-examples.]
```

## Quick check

| Item | Rule |
| --- | --- |
| folder | `.cursor/skills/<name>/` |
| entry | `SKILL.md`; detail in `REFERENCE.md`; artefacts in `templates/` |
| front matter | `name`, `description`; `disable-model-invocation` only when needed |
| description | trigger conditions, < 220 characters, no unquoted `: ` |
| body | Task / Preconditions / Invariants / Method; accept and reject in Method |
| language | technology-neutral; repository-relative POSIX paths |
| checks | `node scripts/harness.mjs skills-lint`, `node scripts/harness.mjs instructions` |
