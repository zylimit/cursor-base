# Architecture

## Design goals

This harness is a technology-neutral governance layer designed for repositories of 600k lines and beyond. It minimizes always-loaded context while making discovery, impact analysis, implementation, debugging, review, and verification repeatable. The scale claim is measured, not aspirational: on a generated 600k-line, 30,000-file, 120-module repository, `catalog lint` classifies every tracked path in ~3.2s and `affected` resolves impact in ~60ms (see `docs/LARGE-REPO-GUIDE.md`).

## Layers

1. **Stable constitution** — root `AGENTS.md` contains only durable, repository-wide invariants.
2. **Contextual policy** — `.cursor/rules/*.mdc` activates focused policy by topic or path.
3. **Role isolation** — `.cursor/agents` separates read-only analysis from scoped writers and testers.
4. **Workflow guidance** — `.cursor/skills` provides short entrypoints with progressively loaded references.
5. **Executable checks** — the `scripts/harness.mjs` entrypoint owns deterministic doctor, validate, and test behavior. Its behavior is written once in `src/harness.mts` and compiled to the checked-in `.cursor/runtime/harness.mjs`, so hooks and installed repositories need no build step while parity stays machine-verifiable.
6. **Evidence contracts** — task envelopes, completion receipts, review bindings, and waivers make handoffs auditable. The quality ledger is hash-chained, so deleting or editing a receipt is detectable rather than silent.
7. **Operational resilience** — supervised development services (crash restart with backoff, restart-storm breaker, health probes), a proactive risk scan at session start, and a retention schedule that destroys aged evidence without breaking current receipts.

## Scaling model

Discovery begins from manifests, ownership boundaries, dependency declarations, entrypoints, and targeted searches. Agents build a module-sized context set, not a repository dump. Impact follows contracts and direct dependents. Verification starts with the changed diff and affected module, then expands according to risk.

Parallel reads reduce latency. Writes remain serial unless the task envelope assigns disjoint paths and names an integration owner. Generated files and shared manifests are treated as overlapping ownership.

## Portability

Policies describe intent and evidence rather than ecosystem-specific commands. Repository adapters may map generic check classes—format, static analysis, unit, integration, build—to local commands. Paths in governance assets use repository-relative POSIX form.

## Provenance and adaptation

The design was informed by patterns observed in `cc-base`, `codex-base`, `grok-base`, and `pi-base`: concise constitutions, role separation, staged validation, bounded delegation, and explicit evidence. Only general lessons were adapted. Provider-specific prompts, private conventions, command wrappers, identity assumptions, and proprietary content were not copied.

See `CAPABILITY-MATRIX.md` for explicit accept/reject decisions.
