# Architecture

## Design goals

This harness is a technology-neutral governance layer for repositories of 600k lines and beyond.
It minimizes always-loaded context while making discovery, impact analysis, implementation,
debugging, review, and verification repeatable, and it lets a team dial how much evidence a change
must carry without ever dialing down safety. The scale claim is measured, not aspirational: on a
generated 600k-line, 30,000-file, 120-module repository, `catalog lint` classifies every tracked
path in ~3.2s and `affected` resolves impact in ~60ms (see `docs/LARGE-REPO-GUIDE.md`).

## Two axes, kept apart

- **Capability** — what the agent may do: command policy, secret protection, the sandbox,
  `cli.json`, write ownership. Owned by the hooks and host configuration. Identical under every
  profile; nothing in this axis is waivable.
- **Assurance** — how much evidence a change must carry before it is done: verification breadth,
  review requirement, attribute enforcement, memory sync, budget, deferral, completion. Owned by
  `harness/assurance-policy.json` and resolved per change as one of `explore < rapid < balanced
  < strict`, with floors (task risk, impact, protected attributes, other critical/high
  attributes, governance paths) that only raise. See `docs/ASSURANCE-PROFILES.md`.

Conflating the two is how "fast mode" becomes "unsafe mode". Keeping them apart is what makes a
rapid profile safe to offer.

## Layers

1. **Stable constitution** — root `AGENTS.md` holds only durable invariants, each naming the
   mechanism that enforces it or admitting it is prompt-only (`rules-audit` keeps that honest).
2. **Contextual policy** — `.cursor/rules/*.mdc` activates focused policy by topic or path.
3. **Role isolation** — `.cursor/agents` separates read-only analysis and review from scoped
   writers and testers; a reviewer can be delegated one lens of a structured review.
4. **Workflow guidance** — `.cursor/skills` provides short entrypoints with progressively loaded
   references (`skills-lint` catches what the loader would drop silently).
5. **Executable checks** — `scripts/harness.mjs` is the single entrypoint. Behavior is written
   in `src/*.mts` and compiled to the checked-in `.cursor/runtime/*.mjs`, so hooks and installed
   repositories need no build step while parity stays machine-verifiable (`runtime-sync`).
6. **Evidence contracts** — task envelopes, completion receipts, review receipts, waivers, and
   evidence debt are diff-bound records; a fast loan is time-bound (a window with a reason), and
   the debts it creates are the diff-bound part. The quality ledger is hash-chained; the plan
   hash carries the module set, the risk, and the effective assurance controls.
7. **Memory across boundaries** — `progress.md` is the ledger that survives; `recap` and
   `invariants` derive state from files, never from a summary, and the first tool call after a
   compaction re-injects the invariants.
8. **Operational resilience** — supervised development services, a proactive risk scan at
   session start (including open loans and unpaid debt), and a retention schedule that destroys
   aged evidence without breaking current receipts.

## Engine modules

The engine is eighteen modules plus the entry point `src/harness.mts`, with an acyclic import
graph: every module may import `core`, `core` imports only Node built-ins, and only the entry
point imports `cli`. `tests/assurance.test.mjs` asserts all three properties on every run.

| Module | Owns |
| --- | --- |
| `core` | repository discovery, atomic state IO, hashing, globs, git, the canonical diff binding, secret redaction, hook vocabulary, exit codes, argument parsing |
| `catalog` | module catalog loading and lint, path classification, module contract directories, attribute vocabulary, verification matrix |
| `graph` | impact closure, real import edges, architecture check, catalog discovery |
| `state` | task state read side |
| `assurance` | profiles, controls, floors, policy compilation, selection, fast loans, evidence debt, lens convening |
| `quality` | verification plan, check execution, hash-chained ledger, attribute coverage, waivers, review receipts, the assessment |
| `task` | task envelope command and write preflight |
| `context` | budgeted context packs whose reach follows the profile's `contextDepth` |
| `review` | structured review sessions, stages, verdicts, authorship, review packs |
| `memory` | recap, invariants, sync-check, archive, feedback corpus |
| `scan` | fitness rules, adapters, ADR check, instruction-file scan, skills lint, agents lint, rules audit |
| `services` | development service supervision |
| `ops` | hook ledger, gate audit, risk scan, retention |
| `release` | release readiness (report only) |
| `shell-policy` | command semantics and the capability axis: shell parsing and wrapper stripping, git classification, credential exposure, allow/ask/deny decisions for shell and MCP calls, read-only tool vocabulary, one classification walk (`classifyParsed`) that applies the full rule set at every substitution depth, and the spawn-target decision (`directSpawnTarget`) that check execution and service supervision share |
| `install` | install/upgrade/uninstall (with catalog discovery on a fresh install), manifests, runtime parity, validate, doctor |
| `hooks` | Cursor hook event handling |
| `cli` | the command table and usage text |

## Exit-code contract

`0` ok · `1` violation or invalid input · `2` gate failure or refused completion · `3` degraded
(the harness refused to guess: no git, no catalog, nothing to review) · `4` stale (evidence exists
but no longer binds the current tree). `3` is never a pass.

## Scaling model

Discovery begins from manifests, ownership boundaries, dependency declarations, entrypoints, and
targeted searches (`catalog discover` proposes the map from the tree and the real import edges).
Agents build a module-sized context set, not a repository dump. Impact follows contracts and
direct dependents. Verification starts with the changed diff and affected module, then expands
according to dependency, risk, and profile.

Parallel reads reduce latency. Writes remain serial unless the task envelope assigns disjoint
paths and names an integration owner. Generated files and shared manifests are treated as
overlapping ownership.

## Portability

Policies describe intent and evidence rather than ecosystem-specific commands. Repository
adapters map generic check classes — format, static analysis, unit, integration, build — to local
commands. Paths in governance assets use repository-relative POSIX form.

## Provenance and adaptation

The 2.0 design was informed by a line-by-line study of `dsh-base` and `cc-base` and a review of
`codex-base`, and by the published state of practice on harness engineering: profiles with
monotonic floors, a fast lane modelled as a repayable loan, structured review with stages and
computed verdicts, memory that survives compaction, instruction files as untrusted input, and a
constitution audited for enforcement. Only general lessons were adapted; see
`CAPABILITY-MATRIX.md` for the explicit accept/adapt/reject ledger.
