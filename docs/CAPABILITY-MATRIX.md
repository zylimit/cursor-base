# Capability Matrix

The source names below identify comparative baselines, not dependencies. This project records reusable lessons and deliberate rejections without copying provider-specific content.

| Baseline | General experience absorbed | Deliberately rejected |
| --- | --- | --- |
| `cc-base` | A small stable constitution; explicit delegation and handoff contracts; progressive disclosure; measuring whether a gate has ever caught anything; project memory that separates decisions from completed work; approval tiers instead of a single approval list | Provider-specific lifecycle hooks, branded personas, private command names, dual shell/PowerShell hook implementations, and assumptions about one model's tool semantics |
| `codex-base` | Scoped implementation, evidence-first verification, diff-aware review, clear writable boundaries, four-state check results where a missing tool is blocked rather than passing, and coverage linting that refuses to call an unmapped path safe | Runtime-specific approval syntax, sandbox claims stronger than the host can guarantee, automatic publication behavior, and a single global active task that contradicts its own ownership model |
| `grok-base` | Fast parallel research, independent challenge of assumptions, and concise outcome reporting | Unbounded breadth, speculative edits, provider-tuned voice, and treating speed as stronger than verification |
| `pi-base` | Minimal composable workflows, portable conventions, low context overhead, and baseline hashing so an edit made outside the task blocks rather than overwrites | Environment-specific shortcuts, implicit state, personal paths or identities, opaque orchestration, and a required-check set that can deadlock when a gate is declared but has no command |

Two findings from these baselines were adopted as constraints rather than features. Reviews that
rely on a second pass from the same model are a cheap supplement, not the load-bearing check;
machine-executable evidence is. And published measurements of agent context files show that
adding instructions usually costs more than it returns, so new capability is added as an
executable check or an on-demand skill rather than as more always-applied text.

## Cursor-native mapping

| Need | Asset | Default |
| --- | --- | --- |
| Durable invariants | `AGENTS.md` | Always present, intentionally short |
| Topic/path policy | `.cursor/rules/*.mdc` | Activated by frontmatter |
| Discovery | `explorer` agent | Read-only |
| Change impact | `impact-analyst` agent | Read-only |
| Scoped writes | `implementer` agent | Serial writer |
| Diagnosis | `debugger` agent | Evidence-first, no edits |
| Defect review | `reviewer` agent | Read-only, receipt-bound |
| Verification | `tester` agent | Executes checks; avoids product edits |
| Repeatable workflow | `.cursor/skills/*` | Concise entrypoint plus reference |
| Deterministic validation | `node scripts/harness.mjs validate` | Structure only; never evidence of behavior |
| Executed verification | `node scripts/harness.mjs gate` | Four-state result, diff-bound receipt |
| Completion decision | `quality status`, `stop` hook | Requires a passing receipt for the current diff |
| Architecture guardrail | `node scripts/harness.mjs arch-check` | Real imports compared to declared graph |
| Coverage guarantee | `node scripts/harness.mjs catalog lint` | Every tracked path mapped, global, or excused |
| Context budget | `node scripts/harness.mjs context-pack` | Manifest to the model, pack to disk |
| Write ownership | `node scripts/harness.mjs task start` | Outside edits block the next agent write |
| Gate effectiveness | `node scripts/harness.mjs gate-audit` | Inert gates are named, not assumed useful |

## Non-goals

- Emulating another agent provider or importing its proprietary assets
- Encoding framework-, language-, package-manager-, or CI-specific policy
- Treating a review, test, worktree, ignore file, or Windows sandbox as proof of complete safety
- Maximizing automation at the expense of explicit user control
