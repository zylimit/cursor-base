# Capability Matrix

The source names below identify comparative baselines, not dependencies. This project records reusable lessons and deliberate rejections without copying provider-specific content.

| Baseline | General experience absorbed | Deliberately rejected |
| --- | --- | --- |
| `cc-base` | A small stable constitution; explicit delegation and handoff contracts; progressive disclosure; measuring whether a gate has ever caught anything; project memory that separates decisions from completed work; approval tiers instead of a single approval list; supervisor liftoff confirmation and breaker semantics; the feedback-to-graduation lesson pipeline | Provider-specific lifecycle hooks, branded personas, private command names, dual shell/PowerShell hook implementations, and assumptions about one model's tool semantics |
| `codex-base` | Scoped implementation, evidence-first verification, diff-aware review, clear writable boundaries, four-state check results where a missing tool is blocked rather than passing, coverage linting that refuses to call an unmapped path safe, hash-chained receipts with evidence re-verification, proactive state risk scanning, retention that protects referenced evidence, risk-tiered check selection, and waivers bound to check plus diff with approval evidence | Runtime-specific approval syntax, sandbox claims stronger than the host can guarantee, automatic publication behavior, and a single global active task that contradicts its own ownership model |
| `grok-base` | Fast parallel research, independent challenge of assumptions, and concise outcome reporting | Unbounded breadth, speculative edits, provider-tuned voice, and treating speed as stronger than verification |
| `pi-base` | Minimal composable workflows, portable conventions, low context overhead, baseline hashing so an edit made outside the task blocks rather than overwrites, and the supervisor pattern where status comes from live pids and a health probe treats "alive but not serving" as an outage | Environment-specific shortcuts, implicit state, personal paths or identities, opaque orchestration, and a required-check set that can deadlock when a gate is declared but has no command |

## 2026-09 review: dsh-base, cc-base, codex-base

The 2.0 refactor followed a line-by-line study of `dsh-base` and `cc-base` and a review of
`codex-base`. Decisions, with the mechanism each became:

| Mechanism | Source | Decision | Where it lives |
| --- | --- | --- | --- |
| Assurance profiles on one axis with floors that only raise | `codex-base` (15 controls, 5 floor kinds) | **Adapted** to eight controls and four floor kinds; selection is a request, floors are minimums | `src/assurance.mts`, `docs/ASSURANCE-PROFILES.md` |
| Fast mode as a repayable loan with pre-declared skippable checks and a protected floor | `dsh-base` (loan), `codex-base` (debt persists past the window) | **Absorbed**, merged: predeclared `allowFastSkip`, protected attributes never deferred, debt repaid only by a later PASS | `fast`, `debt`, `gate` |
| Boolean fast mode that silences hooks | `cc-base` | **Rejected**: a flag that hides which evidence was skipped is the state that outlives its excuse | — |
| Structured review: lenses, stages, computed verdict, round cap | `dsh-base` (verdict engine), `cc-base` (stage blocks on errors) | **Absorbed** with attribute-driven lens exclusion and the profile setting the team | `src/review.mts`, `docs/REVIEW.md` |
| Reviewer is never the author | `cc-base` | **Adapted** as best effort: recorded per conversation, enforced when identities exist, honest when not | `authorship`, `review verdict` |
| Review evidence pack with deletions set apart | `dsh-base` | **Absorbed** | `review-pack` |
| Memory: recap from files, invariants re-injected after compaction, archive without rewriting | `dsh-base`, `cc-base` | **Absorbed**; re-injection through `postToolUse` because Cursor's `preCompact` is observational | `src/memory.mts`, hooks |
| Three-file sync (code ↔ ledger, spec ↔ changelog) | `cc-base`, `dsh-base` | **Adapted** as `sync-check`; blocks the stop hook only under `strict` | `sync-check`, `stop` |
| Instruction files as untrusted input | `dsh-base` (`scan-instructions`) | **Absorbed** for Cursor's file set (`AGENTS.md`, rules, skills, agents, `.cursorrules`) and wired as a security-class check | `instructions` |
| Constitution audit: enforced / prompt-only / phantom | `cc-base` (`rules-audit`) | **Absorbed**; only phantoms fail | `rules-audit` |
| Skills lint against the loader's parser | `dsh-base`, `cc-base` | **Adapted** to Cursor's frontmatter (`name` = folder, `description`, `disable-model-invocation`) | `skills-lint` |
| Nested module contracts (`AGENTS.md` per high-risk module) | `dsh-base` | **Adapted**: required where a protected attribute blocks, derived from the module's root | `agents-lint` |
| Catalog discovery from tree, real imports, and manifests, refusing to guess tiers | `dsh-base`, `cc-base` (`init`) | **Absorbed** | `catalog discover` |
| Release readiness with hard-false trust-boundary fields | `cc-base`, `codex-base` | **Absorbed**; CI observed through `gh`, `BLOCKED` when unobservable | `release readiness` |
| Exit-code contract 0/1/2/3/4 | `dsh-base` | **Absorbed** | `core.EXIT` |
| Engine split into cohesive modules with an acyclic graph | `cc-base`, `dsh-base` | **Absorbed** (18 modules plus the entry; the graph is asserted by a test) | `src/*.mts` |
| Nine-phase operating model with four sign-off gates | `dsh-base` | **Rejected** as fixed process; the profile decides what a change needs | — |
| Cross-worktree path leases | `codex-base` | **Rejected** again: ownership is per task; advisory leases without an integration owner reintroduce parallel writes | — |
| Auto-push, auto-tag, auto-deploy on green | `cc-base` (trust-boundary discussion) | **Rejected**; readiness reports and stops | — |
| Persona and product-development workflow | `cc-base` | **Rejected**: this is a governance harness, not a product framework | — |

The earlier rejection of a global "fast mode" bypass stands in spirit: what was accepted is not a
mode but a loan, with the skipped evidence named, dated, and owed. Cross-worktree path leases
remain rejected: write ownership is already enforced per task, and advisory leases without an
integration owner reintroduce the parallel-writes problem that `progress.md` records as out of
scope.

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
| Evidence strength | `profile <sub>`, `harness/assurance-policy.json` | `explore < rapid < balanced < strict`; floors only raise |
| Deadline pressure | `fast on/off`, `debt list` | Pre-declared checks deferred as dated, repayable debt |
| Structured review | `review <sub>`, `review-pack`, `reviewer` agent per lens | Staged lenses, located findings, computed verdict |
| Memory recovery | `recap`, `invariants`, `sync-check`, `archive`, `postToolUse` hook | Derived from files; re-injected after compaction |
| Governance integrity | `instructions`, `rules-audit`, `skills-lint`, `agents-lint` | Untrusted instruction files; no phantom rules; loadable skills |
| Catalog bootstrap | `catalog discover` | Modules and edges proposed; tiers never guessed |
| Release proof | `release readiness` | Every condition reported under strict; nothing performed |

## Non-goals

- Emulating another agent provider or importing its proprietary assets
- Encoding framework-, language-, package-manager-, or CI-specific policy
- Treating a review, test, worktree, ignore file, or Windows sandbox as proof of complete safety
- Maximizing automation at the expense of explicit user control
