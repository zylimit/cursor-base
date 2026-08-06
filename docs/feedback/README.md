# Feedback Corpus

Lessons recorded here are the repository's institutional memory: a mistake, correction, or
recurring pattern captured once, with enough context that a future session does not repeat it.
`node scripts/harness.mjs feedback lint` enforces the contract; `feedback list` reports which
lessons have recurred enough to graduate.

## Contract

- One lesson per file, named in lowercase kebab-case: `verify-before-claiming.md`.
- Frontmatter is required:

```text
---
id: verify-before-claiming        # must equal the filename
occurrences: 3                    # how many independent times this bit
first_seen: 2026-08-01
last_seen: 2026-08-07
graduated: false                  # true once promoted into a rule, skill, or executable check
---
```

- The body opens with a `# title`, states the lesson in one paragraph, and records the evidence
  or incident that produced it. Conclusions and constraints only; debugging narrative is noise
  that slows recovery.
- When the same lesson recurs, increment `occurrences` and update `last_seen` instead of writing
  a duplicate.

## Graduation

A lesson that has recurred three times is a rule the repository has already paid for.
`feedback list` and the session-start risk scan surface these candidates. Graduation means
promoting the lesson into something enforced — a `.cursor/rules` entry, a skill step, a fitness
rule, or a verification check — with the user's confirmation, then setting `graduated: true`.
The file stays: it is the record of why the rule exists.

Prefer graduating into an executable check over more always-applied prose. Instruction text
costs context on every request; a check costs nothing until it fires.

## Privacy

This corpus is repository-local. The installer never copies `docs/`, so lessons — which may
reference internal incidents — do not travel with the framework. Anything exported by hand must
be reviewed for names, incidents, and internal paths first.
