# Capability Matrix

The source names below identify comparative baselines, not dependencies. This project records reusable lessons and deliberate rejections without copying provider-specific content.

| Baseline | General experience absorbed | Deliberately rejected |
| --- | --- | --- |
| `cc-base` | A small stable constitution; explicit delegation and handoff contracts; progressive disclosure | Provider-specific lifecycle hooks, branded personas, private command names, and assumptions about one model's tool semantics |
| `codex-base` | Scoped implementation, evidence-first verification, diff-aware review, and clear writable boundaries | Runtime-specific approval syntax, sandbox claims stronger than the host can guarantee, and automatic publication behavior |
| `grok-base` | Fast parallel research, independent challenge of assumptions, and concise outcome reporting | Unbounded breadth, speculative edits, provider-tuned voice, and treating speed as stronger than verification |
| `pi-base` | Minimal composable workflows, portable conventions, and low context overhead | Environment-specific shortcuts, implicit state, personal paths or identities, and opaque orchestration |

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
| Deterministic validation | `node scripts/harness.mjs ...` | Expected external implementation |

## Non-goals

- Emulating another agent provider or importing its proprietary assets
- Encoding framework-, language-, package-manager-, or CI-specific policy
- Treating a review, test, worktree, ignore file, or Windows sandbox as proof of complete safety
- Maximizing automation at the expense of explicit user control
