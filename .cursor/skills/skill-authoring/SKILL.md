---
name: skill-authoring
description: Creates or revises a repository skill so it passes the loader, follows the existing pattern, teaches a method not headings, and is judged by scenarios against the version it replaces. Use when adding a skill.
---

# Skill Authoring

A skill is loaded only when its `description` matches, then paid for in full; it must route
correctly, load correctly (`skills-lint`), pass the untrusted-input scan (`instructions`), and
leave the agent able to act, not just informed. Revising keeps what already works.

1. Write the envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
   Gather: the problem the skill solves, when it triggers (auto by description, manual by name,
   or `disable-model-invocation: true` for side-effecting workflows), its inputs (files, user
   input, repository state), its outputs (files, report, changes), the situation in which a user
   would be misled or stuck, and — for a revision — what the current version already does right.
   A lesson that graduates from the feedback corpus is read at its source first.
2. Pick one or two existing skills as the pattern **by interaction type**, not by domain:
   elicitation (`product-spec`, `design-brief`), autonomous analysis (`dev-plan`, `code-review`),
   execution (`phase-build`, `release-build`), diagnose-then-fix (`root-cause-debugging`). Read
   them for structure, section naming, method style, and receipt format; the repository format is
   a concise `SKILL.md` (numbered steps, one screen) plus a `REFERENCE.md` one level deep, and
   optional `templates/` — never executable scripts, only `node scripts/harness.mjs <command>`
   invocations (`governance-assets.mdc`).
3. Design two or three **scenarios** before writing: the trigger sentence the user would say, the
   facts known at that turn (later facts arrive turn by turn), the behaviour to keep or the edge
   most likely to go wrong, and the checkable expectation (how the reply or artefact shows
   understanding, expert advice, correction propagation, or the decision to continue). Cover one
   real ambiguity, one small clear task that must not be turned into an interview, and, where
   relevant, a delegated "you decide". Never delete an input the current version needs just to
   manufacture a red.
4. Fill from `templates/skill-template.md`, keeping only the sections the skill needs: what it
   does (modes if several), the envelope, the method as decisions — when to use which step, what
   evidence, how to judge, how disagreement converges, what is handed to whom — the convergence
   condition, the receipt line, and the reference pointer. A dimension name is not a method: "learn
   the roles and flow" still produces a table; "start from one real event; when a term such as
   *complete* appears, check whether the documents already define it; test the edge with two
   adjacent cases" produces behaviour. Long examples and reference material go to `REFERENCE.md`
   with an explicit load moment in `SKILL.md`.
5. Anything absorbed from an external repository, skill, prompt, or template records its
   provenance — location, ref, access date, licence, files actually read — and a copy treatment
   per item: `vendored_intact`, `vendored_modified`, `synthesized`, `referenced_only`, or
   `excluded`. Unknown or incompatible licences, and anything carrying secrets, session state,
   runtime state, or hidden install behaviour, are excluded by default. Skill source holds stable,
   versionable capability only; project tasks, progress, logs, credentials, and generated state
   never enter a skill directory. A skill may detect or suggest a dependency; it never installs
   one.
6. Verify what can be verified and say the rest plainly. `node scripts/harness.mjs skills-lint`
   (name equals folder, kebab-case, description present and under 220 characters, lowercase
   `disable-model-invocation` as a bare boolean, body under 24KB) and `instructions` (no endpoint
   redirects, credentials, verification bypasses, or hidden characters) are mechanical and
   must pass. One check the lint does not make yet is made by eye: the `description` is a YAML
   plain scalar, so it contains no `: ` and does not start with `#`, `[`, `{`, `*`, `&`, `!`,
   `|`, `>`, `'`, `"`, `%`, or `@` — otherwise the host drops it silently and the skill stops
   routing while the lint stays green. Where the environment allows, run the scenarios against
   the current version with
   frozen inputs, then against the revision with the same visible inputs; RED→GREEN is claimed
   only for a scenario the old version actually failed and the new one passes on the same
   assertion; a correct old behaviour is recorded as kept or regressed, never re-judged. A keyword
   smoke ("mentions root cause") proves routing, not understanding; unrun scenarios are reported
   as unrun.
7. Register: the skill list in `README.md` and `docs/CAPABILITY-MATRIX.md`; a rule or
   `docs/PRODUCT-WORKFLOW.md` entry when the skill takes a place in a workflow; a `progress.md`
   decision when it changes what the repository does. Self-check before finishing: every kept
   method has a trigger, a judgement, and a handoff; a user's business correction updates a source
   of truth and the affected tasks, not only a note; mechanical rules reuse existing checks; the
   end state is `complete`, `draft` (dirty paths, unverified items, continuation listed), or
   `blocked`.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; `Verified`
names the lints and the scenarios actually run, `Not verified` the semantics no check can judge.

Load [REFERENCE.md](REFERENCE.md) for the interaction-type method table, progressive disclosure
rules, scenario design with a two-turn example, and the provenance checklist.
