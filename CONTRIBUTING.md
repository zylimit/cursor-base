# Contributing

Keep contributions technology-neutral and useful in repositories ranging from small projects to 200k–300k lines.

## Workflow

1. Open a task envelope using the fields in `docs/PROTOCOLS.md`.
2. Inspect existing patterns before changing governance behavior.
3. Keep policy concise: stable invariants belong in `AGENTS.md`; contextual guidance belongs in `.cursor/rules`; workflows belong in `.cursor/skills`.
4. Make one coherent change at a time. Parallel reads are encouraged; writes are serial unless ownership is explicit and disjoint.
5. Run the narrowest affected checks, then the expected repository checks when available:

   ```sh
   npm run typecheck
   npm run build
   node scripts/harness.mjs doctor
   node scripts/harness.mjs validate
   node scripts/harness.mjs test
   ```

6. Record a completion receipt. Do not report unexecuted checks as passing.

## Runtime source of truth

`src/*.mts` is the only place to edit harness behavior — one module per concern with an acyclic
import graph (`docs/ARCHITECTURE.md` lists what each owns; `src/harness.mts` is only the entry).
`.cursor/runtime/*.mjs` is compiler output that is checked in so hooks and installed repositories
can run without a build step. Never hand-edit the runtime: `npm run runtime-sync` recompiles the
source into a scratch directory and fails if any checked-in file differs by a single byte.

Every rule added to `AGENTS.md` or `.cursor/rules/` names the mechanism that enforces it or says
`(prompt-only)`; `node scripts/harness.mjs rules-audit` fails on a rule that names a mechanism
which does not exist.

Run `npm install` once before contributing; the type checker and the parity check both require
the local TypeScript toolchain. The runtime itself has no dependencies.

## Content standards

- Use repository-relative POSIX-style paths in documentation and metadata.
- Keep `.mdc` rules focused, with valid frontmatter and narrow globs where possible.
- Keep each `SKILL.md` concise and link directly to one-level-deep references for detail.
- Preserve user changes and avoid generated or ecosystem-specific policy.
- Do not include secrets, personal data, machine-specific paths, or proprietary source material.

## Pull requests

Explain scope, risk, verification evidence, and remaining limitations. Review evidence must identify the base commit and the hash of the reviewed diff; changing either invalidates the receipt.
