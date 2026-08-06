# Architecture

## Design goals

This harness is a technology-neutral governance layer for repositories up to roughly 200k–300k lines. It minimizes always-loaded context while making discovery, impact analysis, implementation, debugging, review, and verification repeatable.

## Layers

1. **Stable constitution** — root `AGENTS.md` contains only durable, repository-wide invariants.
2. **Contextual policy** — `.cursor/rules/*.mdc` activates focused policy by topic or path.
3. **Role isolation** — `.cursor/agents` separates read-only analysis from scoped writers and testers.
4. **Workflow guidance** — `.cursor/skills` provides short entrypoints with progressively loaded references.
5. **Executable checks** — the `scripts/harness.mjs` entrypoint owns deterministic doctor, validate, and test behavior. Its behavior is written once in `src/harness.mts` and compiled to the checked-in `.cursor/runtime/harness.mjs`, so hooks and installed repositories need no build step while parity stays machine-verifiable.
6. **Evidence contracts** — task envelopes, completion receipts, review bindings, and waivers make handoffs auditable.

## Scaling model

Discovery begins from manifests, ownership boundaries, dependency declarations, entrypoints, and targeted searches. Agents build a module-sized context set, not a repository dump. Impact follows contracts and direct dependents. Verification starts with the changed diff and affected module, then expands according to risk.

Parallel reads reduce latency. Writes remain serial unless the task envelope assigns disjoint paths and names an integration owner. Generated files and shared manifests are treated as overlapping ownership.

## Portability

Policies describe intent and evidence rather than ecosystem-specific commands. Repository adapters may map generic check classes—format, static analysis, unit, integration, build—to local commands. Paths in governance assets use repository-relative POSIX form.

## Provenance and adaptation

The design was informed by patterns observed in `cc-base`, `codex-base`, `grok-base`, and `pi-base`: concise constitutions, role separation, staged validation, bounded delegation, and explicit evidence. Only general lessons were adapted. Provider-specific prompts, private conventions, command wrappers, identity assumptions, and proprietary content were not copied.

See `CAPABILITY-MATRIX.md` for explicit accept/reject decisions.
