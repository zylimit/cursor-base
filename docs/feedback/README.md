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

- The body opens with a `# title` stating the lesson as an instruction, then, in order: what
  happened and how the user corrected it, quoting them; the **scenario** the second occurrence
  looked like; what to do instead; **scope** (which stages, roles, project kinds);
  **exceptions** (when it does not apply — a rule without a range is applied where it should not
  be); **supersedes** (which rule or lesson it replaces — two coexisting rules fight);
  **applied to** (the file and section, the decision date, or the dispatch where the correction
  already landed; `pending` means it has not taken effect yet); the evidence. Conclusions and
  constraints only; debugging narrative is noise that slows recovery. `docs/feedback/TEMPLATE.md`
  is the shape; only the frontmatter and the title are linted, the sections are the contract.
  Lessons written before 2026-09-16 predate the section contract and carry the body and an
  `Evidence:` line only; they are history, not a second shape, and they gain the sections when
  their next occurrence is recorded.
- When the same lesson recurs, increment `occurrences` and update `last_seen` instead of writing
  a duplicate. `occurrences` counts independent events: several roles citing one event count
  once, a re-read counts zero.

## Graduation

Graduation is decided by two questions, not by a count. `feedback list` and
`node scripts/harness.mjs risk` surface lessons at three or more occurrences — the session banner
does not, because it drops `info` findings and the candidate is one — but a count is a hint
either way: an unmaintained counter is not evidence that a rule has been paid for.

1. **Codified already?** Grep `AGENTS.md`, the rules, the skills, and the agents for the
   lesson's substance. Already there → mark it graduated with the file and section, add nothing.
2. **Real cost?** A recorded rework, stall, frozen feature, or repeated dispute justifies a
   proposal. A correction with no recorded cost is written into the file as "not yet codified"
   so the next scan does not re-judge it; the next occurrence with a cost reopens it.

Promotion targets, in order of preference: an executable check, then a skill step, then rule
text. It needs the user's confirmation — it changes repository policy — after which
`graduated: true` is set. The file stays: it is the record of why the rule exists. The method
is the `record-lesson` skill; this file is the corpus contract.

Prefer graduating into an executable check over more always-applied prose. Instruction text
costs context on every request; a check costs nothing until it fires.

## Privacy

This corpus is repository-local. The installer never copies `docs/`, so lessons — which may
reference internal incidents — do not travel with the framework. Anything exported by hand must
be reviewed for names, incidents, and internal paths first.
