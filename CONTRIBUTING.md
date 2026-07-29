# Contributing

Keep contributions technology-neutral and useful in repositories ranging from small projects to 200k–300k lines.

## Workflow

1. Open a task envelope using the fields in `docs/PROTOCOLS.md`.
2. Inspect existing patterns before changing governance behavior.
3. Keep policy concise: stable invariants belong in `AGENTS.md`; contextual guidance belongs in `.cursor/rules`; workflows belong in `.cursor/skills`.
4. Make one coherent change at a time. Parallel reads are encouraged; writes are serial unless ownership is explicit and disjoint.
5. Run the narrowest affected checks, then the expected repository checks when available:

   ```sh
   node scripts/harness.mjs doctor
   node scripts/harness.mjs validate
   node scripts/harness.mjs test
   ```

6. Record a completion receipt. Do not report unexecuted checks as passing.

## Content standards

- Use repository-relative POSIX-style paths in documentation and metadata.
- Keep `.mdc` rules focused, with valid frontmatter and narrow globs where possible.
- Keep each `SKILL.md` concise and link directly to one-level-deep references for detail.
- Preserve user changes and avoid generated or ecosystem-specific policy.
- Do not include secrets, personal data, machine-specific paths, or proprietary source material.

## Pull requests

Explain scope, risk, verification evidence, and remaining limitations. Review evidence must identify the base commit and the hash of the reviewed diff; changing either invalidates the receipt.
