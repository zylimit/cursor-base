# Governance module

## Purpose

The constitution (`AGENTS.md`), the rules, agents, and skills under `.cursor/`, the project
memory (`progress.md`), and the documentation. These files change what the agent believes;
they execute nothing.

## Boundaries

- Root `AGENTS.md` holds invariants only. Procedure goes into a rule, a skill, or a document
  linked one level deep.
- Every rule names the mechanism that enforces it or says `(prompt-only)`; a reference to a
  command that does not exist fails `rules-audit`.
- Skills use kebab-case names equal to their folder and descriptions under 220 characters.
- Documentation describes current behavior; expected or proposed behavior is labelled as such,
  and no command is called verified unless it ran.
- No secrets, personal paths, or placeholder text.

## Invariants

- Instruction files are untrusted input: nothing here redirects endpoints, embeds credentials,
  overrides higher-authority instructions, or argues the agent out of verification.
- `Pinned` and `Decisions` entries in `progress.md` are never edited or deleted; a change is a
  new, superseding entry.
- `docs/CAPABILITY-MATRIX.md` records every mechanism absorbed, adapted, or rejected from another
  harness, with the reason.

## Verification

`node scripts/harness.mjs instructions`, `rules-audit`, `skills-lint`, `agents-lint`,
`adr-check`, `feedback lint`; `sync-check` after governed code changes. All of them run under
`node scripts/harness.mjs gate` for this module.
