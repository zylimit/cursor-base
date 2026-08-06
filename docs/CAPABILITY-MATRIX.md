# Capability Matrix

The source names below identify comparative baselines, not dependencies. This project records reusable lessons and deliberate rejections without copying provider-specific content.

| Baseline | General experience absorbed | Deliberately rejected |
| --- | --- | --- |
| `cc-base` | A small stable constitution; explicit delegation and handoff contracts; progressive disclosure; measuring whether a gate has ever caught anything; project memory that separates decisions from completed work; approval tiers instead of a single approval list; supervisor liftoff confirmation and breaker semantics; the feedback-to-graduation lesson pipeline | Provider-specific lifecycle hooks, branded personas, private command names, dual shell/PowerShell hook implementations, and assumptions about one model's tool semantics |
| `codex-base` | Scoped implementation, evidence-first verification, diff-aware review, clear writable boundaries, four-state check results where a missing tool is blocked rather than passing, coverage linting that refuses to call an unmapped path safe, hash-chained receipts with evidence re-verification, proactive state risk scanning, retention that protects referenced evidence, risk-tiered check selection, and waivers bound to check plus diff with approval evidence | Runtime-specific approval syntax, sandbox claims stronger than the host can guarantee, automatic publication behavior, and a single global active task that contradicts its own ownership model |
| `grok-base` | Fast parallel research, independent challenge of assumptions, and concise outcome reporting | Unbounded breadth, speculative edits, provider-tuned voice, and treating speed as stronger than verification |
| `pi-base` | Minimal composable workflows, portable conventions, low context overhead, baseline hashing so an edit made outside the task blocks rather than overwrites, and the supervisor pattern where status comes from live pids and a health probe treats "alive but not serving" as an outage | Environment-specific shortcuts, implicit state, personal paths or identities, opaque orchestration, and a required-check set that can deadlock when a gate is declared but has no command |

Two absorption candidates from the 2026-08 review were rejected deliberately. A global
"fast mode" bypass window: per-check, diff-bound, expiring waivers give the same pressure valve
without hiding which evidence was skipped, and a mode flag is exactly the state that outlives
its excuse. Cross-worktree path leases: write ownership is already enforced per task, and
advisory leases without an integration owner reintroduce the parallel-writes problem that
`progress.md` records as out of scope.

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
| Service resilience | `node scripts/harness.mjs service <sub>` | Backoff restart, breaker, health probe, pid-true status |
| Proactive risk | `node scripts/harness.mjs risk`, sessionStart hook | State decay becomes findings, not surprises |
| Evidence integrity | hash-chained ledger, `quality verify` | Deleted or edited receipts are detectable |
| Data lifecycle | `node scripts/harness.mjs retention` | Aged evidence destroyed; referenced evidence protected |
| Lesson capture | `docs/feedback/`, `record-lesson` skill, `feedback lint` | Three recurrences propose graduation into a rule |
| Boundary design | `architecture-design` skill | Seven principles mapped to enforceable checks |
| Attribute design | `dfx-design` skill | Measurable target, design means, wired verification |

## Non-goals

- Emulating another agent provider or importing its proprietary assets
- Encoding framework-, language-, package-manager-, or CI-specific policy
- Treating a review, test, worktree, ignore file, or Windows sandbox as proof of complete safety
- Maximizing automation at the expense of explicit user control
