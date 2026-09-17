# Skill Authoring Reference

## Three layers

- **Section** — an atomic capability inside a skill: a checklist ("what to look at"), a method
  ("how"), a workflow ("in what order"), a precondition check. Sections are bricks reused across
  skills; changing one does not disturb another.
- **Skill** — several sections that solve one whole problem. Changing a skill's inputs,
  judgements, or outputs means checking how the downstream skill consumes them.
- **Workflow** — `AGENTS.md`, the rules, and `docs/PRODUCT-WORKFLOW.md` order the skills and name
  their triggers. Changing the workflow does not require changing a skill.

## Method by interaction type

| The next step needs | Fitting method | Checkable output |
| --- | --- | --- |
| learning the current business | reconstruct one real event — participants, steps, judgements, exceptions; ask only what would change the interpretation | current flow and target behaviour, key terms, rule source, one counter-example |
| choosing a design together | compare candidates on the same task; say who gains or loses, cost, reversibility | recommendation, trade-off basis, undecided scope; a delegated user gets the recommendation applied |
| implementing a settled decision | read the real source and the representative example; check input and output; follow the existing pattern | a visible change, its acceptance basis, rule conflicts found and the tasks they touch |
| diagnosing or reviewing | gather evidence first; test with a case that separates hypotheses; separate business disagreement from code defect | trigger, actual versus expected, basis, impact — not a list of terms |
| learning and recovering | split a correction into business fact and behaviour lesson; update the current source; keep the old reading and its supersession | the current rule, its source, and the pending impact the next role can use |

Choose only what helps the current judgement: fixing a broken documentation link needs no
industry interview; an ambiguous "complete" for a ticket touches state, reports, and tests and is
never filled in from habit.

## Progressive disclosure

- `SKILL.md` keeps triggers (including one near-miss not-to-use), preconditions, the decisive
  branches, the continue-or-pause conditions, the handoff targets, and the receipt line.
- Detailed examples, counter-examples from other domains, walkthrough methods, and long tables go
  to `REFERENCE.md`, with the load moment stated in `SKILL.md` ("load for …").
- Templates carry an interpretation that already exists; they never compress a rich method into
  table headers, and a reference file with a path but no load moment is never read.
- On a revision, list what already works and where the concrete gap is, then rewrite that part;
  length is not quality, and load-bearing examples are not cut to save lines.
- **Reader test:** five questions a stranger would ask, answered from the skill files alone.
  A miss is a hole in the skill. This is not an eval harness, not a with-skill subagent farm,
  and not a description-optimizer loop — those stay out of this repository.

## Scenario design

Synthetic situations for the comparison; the tested version gets only that turn's input — never
the observation points or the later turns.

| Turn | Input | Observe |
| --- | --- | --- |
| 1 | "We need to see repair-order completion rate. Technicians submit their result; an inspector accepts it afterwards." | does it separate the known flow from the unknown counting rule and look for an existing definition; can it say what the rule changes; does unrelated work continue |
| 2 | "Complete means accepted only; returned ones are redone; do not count the technician's submission." | does it adopt the explicit rule at once and update the reading of state, report, and acceptance with its source; does it stop re-asking or keep the first-turn guess |

The same input yields different artefacts per skill — a spec skill forms a sourced rule with an
example, an architecture skill explains states and responsibilities, an implementation or test
skill reads the confirmed rule before deciding — and no stage turns into the same interview.

Add one small, clear change to confirm the skill does not force an interview on a plain task, or
a delegated detail to confirm it still gives expert advice and proceeds. Few scenarios, all
relevant to this revision.

Record the comparison honestly: version, input order, visible basis, actual reply and artefact;
what the old did right, what the new does right, regressions, unknowns. An unrun scenario is not
a result; an old failure is never manufactured to prove the revision's value. What is judged is the
decision after the reply — was the basis used, did the unknown limit the right scope, did the
correction reach downstream. The words "root cause", "scenario", "understood" appearing in an
output prove only that those words appeared.

## Provenance and copy treatment

Before copying anything from an external source, build the minimal inventory: location, ref,
access date, licence; what it contains (skills, references, scripts, templates, assets, hooks,
manifests, licences, anything that writes state or installs quietly); the paths to absorb and the
evidence they were read; the treatment per item — `vendored_intact`, `vendored_modified`,
`synthesized`, `referenced_only`, `excluded` — with the modification described; what is excluded
(runtime state, private material, host-specific pieces, unrelated content). Several candidates or
a risky source get the hard gate: licence, secrets and runtime state, maintenance status, host
fit, verifiability, form fit. One clear source gets no ceremony. The repository's
`docs/CAPABILITY-MATRIX.md` is where absorbed, adapted, and rejected mechanisms are recorded with
their reason.

## Loader constraints (mechanical, checked by `skills-lint`)

`SKILL.md` opens with `---` front matter; `name` is kebab-case and equal to the folder;
`description` is present and under 220 characters (the loader tolerates up to 500; every session
pays for the description on every request); `disable-model-invocation`, when present, is the
lowercase key with a bare `true` or `false`; the body stays under 24KB with detail moved to
`REFERENCE.md`; no two skills share a name. The `description` states trigger conditions, not a
summary of the workflow.

One rule `skills-lint` does **not** check yet, learned the hard way in this repository: the
front matter is YAML, and an unquoted `description` that contains `: ` (colon-space) or starts
with a character YAML reads as structure (`#`, `[`, `{`, `*`, `&`, `!`, `|`, `>`, `'`, `"`, `%`,
`@`) is an invalid plain scalar; the host loader then drops the description silently and the skill
stops routing, while the lint's first-colon split still reads it fine. Six of the skills in the
2026-09-16 batch shipped that way until a review caught it. Use an em dash, a semicolon, or
quote the value.

## Anti-examples

- A skill whose body is a table of dimensions with no method — the agent produces a table.
- A reference file listed in the tree with no sentence saying when to load it — never loaded.
- A "scenario test" that greps the output for a keyword and calls it behaviour validation.
- Deleting the old version's working paths to make the comparison look like an improvement.
- A skill directory carrying a task log, a session transcript, or a generated report.
- A skill that installs a tool because it needed one.
- An eval harness, description-optimizer, or with-skill / without-skill farm added "to be sure".
- A description with no near-miss: it will fire on copy tweaks, or never fire at all.
