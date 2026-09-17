# Capability Matrix

The source names below identify comparative baselines, not dependencies. This project records reusable lessons and deliberate rejections without copying provider-specific content.

| Baseline | General experience absorbed | Deliberately rejected |
| --- | --- | --- |
| `cc-base` | A small stable constitution; explicit delegation and handoff contracts; progressive disclosure; measuring whether a gate has ever caught anything; project memory that separates decisions from completed work; approval tiers instead of a single approval list; supervisor liftoff confirmation and breaker semantics; the feedback-to-graduation lesson pipeline | Provider-specific lifecycle hooks, branded personas, private command names, dual shell/PowerShell hook implementations, and assumptions about one model's tool semantics |
| `codex-base` | Scoped implementation, evidence-first verification, diff-aware review, clear writable boundaries, four-state check results where a missing tool is blocked rather than passing, coverage linting that refuses to call an unmapped path safe, hash-chained receipts with evidence re-verification, proactive state risk scanning, retention that protects referenced evidence, risk-tiered check selection, and waivers bound to check plus diff with approval evidence | Runtime-specific approval syntax, sandbox claims stronger than the host can guarantee, automatic publication behavior, and cross-worktree advisory path leases without an integration owner |
| `grok-base` | Fast parallel research, independent challenge of assumptions, and concise outcome reporting | Unbounded breadth, speculative edits, provider-tuned voice, and treating speed as stronger than verification |
| `pi-base` | Minimal composable workflows, portable conventions, low context overhead, baseline hashing so an edit made outside the task blocks rather than overwrites, and the supervisor pattern where status comes from live pids and a health probe treats "alive but not serving" as an outage | Environment-specific shortcuts, implicit state, personal paths or identities, opaque orchestration, and a required-check set that can deadlock when a gate is declared but has no command |

## 2026-09 review: dsh-base, cc-base, codex-base

The 2.0 refactor followed a line-by-line study of `dsh-base` and `cc-base` and a review of
`codex-base`. Decisions, with the mechanism each became:

| Mechanism | Source | Decision | Where it lives |
| --- | --- | --- | --- |
| Assurance profiles on one axis with floors that only raise | `codex-base` (15 controls, 5 floor kinds) | **Adapted** to eight controls and five floor kinds (risk, impact, protected attributes, other critical/high attributes, paths); selection is a request, floors are minimums | `src/assurance.mts`, `docs/ASSURANCE-PROFILES.md` |
| Fast mode as a repayable loan with pre-declared skippable checks and a protected floor | `dsh-base` (loan), `codex-base` (debt persists past the window) | **Absorbed**, merged: predeclared `allowFastSkip`, protected attributes never deferred, debt repaid only by a later PASS | `fast`, `debt`, `gate` |
| Boolean fast mode that silences hooks | `cc-base` | **Rejected**: a flag that hides which evidence was skipped is the state that outlives its excuse | — |
| Structured review: lenses, stages, computed verdict, round cap | `dsh-base` (verdict engine), `cc-base` (stage blocks on errors) | **Absorbed** with attribute-driven lens exclusion and the profile setting the team | `src/review.mts`, `docs/REVIEW.md` |
| Reviewer is never the author | `cc-base` | **Adapted** as best effort: recorded per conversation, enforced when identities exist, honest when not | `authorship`, `review verdict` |
| Review evidence pack with deletions set apart | `dsh-base` | **Absorbed** | `review-pack` |
| Memory: recap from files, invariants re-injected after compaction, archive without rewriting | `dsh-base`, `cc-base` | **Absorbed**; re-injection through `postToolUse` because Cursor's `preCompact` is observational | `src/memory.mts`, hooks |
| Three-file sync (code ↔ ledger, spec ↔ changelog) | `cc-base`, `dsh-base` | **Adapted** as `sync-check`; blocks the stop hook only under `strict` | `sync-check`, `stop` |
| Instruction files as untrusted input | `dsh-base` (`scan-instructions`) | **Absorbed** for Cursor's file set (`AGENTS.md`, rules, skills, agents, `.cursorrules`) and wired as a security-class check | `instructions` |
| Constitution audit: enforced / prompt-only / phantom | `cc-base` (`rules-audit`) | **Absorbed**; only phantoms fail | `rules-audit` |
| Skills lint against the loader's parser | `dsh-base`, `cc-base` | **Adapted** to Cursor's frontmatter (`name` = folder, `description`, `disable-model-invocation`); an unquoted description with `: ` or a YAML structural character is `YAML_UNQUOTED_COLON` | `skills-lint` |
| Nested module contracts (`AGENTS.md` per high-risk module) | `dsh-base` | **Adapted**: required where a protected attribute blocks, derived from the module's root | `agents-lint` |
| Catalog discovery from tree, real imports, and manifests, refusing to guess tiers | `dsh-base`, `cc-base` (`init`) | **Absorbed** | `catalog discover` |
| Release readiness with hard-false trust-boundary fields | `cc-base`, `codex-base` | **Absorbed**; CI observed through `gh`, `BLOCKED` when unobservable | `release readiness` |
| Exit-code contract 0/1/2/3/4 | `dsh-base` | **Absorbed** | `core.EXIT` |
| Engine split into cohesive modules with an acyclic graph | `cc-base`, `dsh-base` | **Absorbed** (18 modules plus the entry; the graph is asserted by a test) | `src/*.mts` |
| Nine-phase operating model with four sign-off gates | `dsh-base` | **Rejected** as fixed process; the profile decides what a change needs | — |
| Cross-worktree path leases | `codex-base` | **Rejected** again: ownership is per task; advisory leases without an integration owner reintroduce parallel writes | — |
| Auto-push, auto-tag, auto-deploy on green | `cc-base` (trust-boundary discussion) | **Rejected**; readiness reports and stops | — |
| Persona and product-development workflow | `cc-base` | **Rejected** in 2026-09 as a persona and a fixed process; **superseded 2026-09-16** — the *skills* of the workflow are absorbed below as on-demand skills routed by documents, while the persona, the brand, and the fixed sequence stay rejected | `docs/PRODUCT-WORKFLOW.md` |

## 2026-09-16 review: the cc-base and codex-base skill families

Every skill in both siblings was read line by line (cc-base at `61347b1`, eighteen skills with
their references, templates, examples, six rules, eight agents; codex-base at the 2026-09-15
autonomy refactor, seventeen skills with their references and templates, nine agent contracts,
the role, review, and cross-pollination documents). One row per mechanism; where the two siblings
diverged, the row says whose version won and why.

| Mechanism | Source | Decision | Where it lives |
| --- | --- | --- | --- |
| Learn the business from one real event along four lines (as-is, who benefits, rules and exceptions, who decides); four statement kinds `[confirmed]`/`[inferred]`/`[default]`/`[open]`; question budget by exposure class; depth tiers direct / confirm / explore / delegated; sign-off by replaying the user's case | `cc-base` product-spec-builder | **Absorbed** | `product-spec` |
| Interview rules (five rules, four knives, model failure modes, replay formula, anti-evasion), 13-dimension question bank, companion-requirement triggers, requirements self-review, elicitation menu | `cc-base` references | **Absorbed**, then **thickened 2026-09-17**: hearing answers, answer→next-step, five-part bank (intent / main / follow-up / accept / reject), marked fragment — still one reference, not seven files | `product-spec/REFERENCE.md` |
| Discovery methods for hard unknowns: problem vs workaround, outcome vs proxy metric, complete minimal result chain, object lifecycle and permissions, partial success / unknown result / same intent, AI necessity litmus, agent action boundaries; requirements depth research / brief / structured / formal | `codex-base` product-spec-builder | **Absorbed**, merged with the cc-base method; depth follows the profile | `product-spec/REFERENCE.md` |
| Iteration mode: change classes, seven follow-ups, conflict detection, impact matrix and return stage, correction propagation that distinguishes the user's new requirement from the agent's misreading; changelog answering why / which judgement was wrong / affects | both | **Absorbed**; `sync-check` already pairs spec and changelog | `product-spec`, `templates/spec-changelog-template.md` |
| Spec and changelog templates with markers, open-questions table (only home of `[open]`), clarification log, decision basis | `cc-base` templates; `codex-base` assurance input block | **Adapted**: cc-base structure, codex-base risk / release-intent / attribute rows | `product-spec/templates/*` |
| Architecture from business events: fact ownership and invariants, break-point walkthrough (duplicate, concurrent, external success / local unknown, half done, undo), same-scenario candidate comparison, sensitive assumptions, refutation-first experiments, state ownership, conditional decision | `codex-base` arch-designer + references | **Absorbed** with the worked bookings case | `architecture-design/REFERENCE.md` |
| Invariant test, S / M / L sizing, consequence-and-team questions first, coaching vs fast path, deployment envelope in three states, deferred decisions, ADR `Revisit-if` (condition, never a date) and `Reversal` (or one-way door) | `cc-base` arch-designer | **Absorbed**; `adr-check` still validates `Enforced-by` only — the two new fields are prompt-only until the check learns them (follow-up) | `architecture-design`, `templates/adr-template.md` |
| Architecture document template with C4 views, conventions, extension points, over-tier table, self-check | `cc-base` template; `codex-base` drivers / walkthrough / acceptance sections | **Adapted**, merged | `architecture-design/templates/architecture-design-template.md` |
| Thirteen DFX dimensions with ISO/IEC 25010:2023 mapping, six-element scenarios, implicit-compliance scan, nine-trigger threat table, latency and retry budget (one retrying layer; multiplicative fan-out), three arithmetic pre-checks, AI product addendum (autonomy L0–L3, gates, breaker, cost cap, traceability), per-module tiers with three questions, priority stack, review scorecard | `cc-base` dfx-designer | **Absorbed** | `dfx-design`, `templates/dfx-spec-template.md` |
| Loss-derived targets; commitment / candidate / baseline kept apart; measurement semantics (observation unit, denominator, windows, blind spots); cross-attribute costs; service / usability / accessibility as three evaluations | `codex-base` dfx-designer + measurement-methods | **Absorbed** | `dfx-design/REFERENCE.md` |
| Predev machine lints (`spec-lint`, `predev-lint`, `plan-lint`, `ui-audit`, `ui-slop-scan`, `dfx check`) | `cc-base` scripts, `codex-base` `plan lint` / `dfx check` | **Deferred**: the methods are in the skills as checklists; engine checks are listed as follow-ups so they arrive as tested code, not as prose that claims a check exists | `progress.md` TODO |
| Design brief: form first (GUI / terminal / agent / embedded), task and environment before colour, feeling → attribute table, one concrete reference, binary axes with anchors and no middle values, two search passes, six interview stages, eight states, surface closure, `Design-Brief.md` + `DESIGN.md` (token front matter + eight prose sections) | `cc-base` design-brief-builder + references + templates | **Absorbed** | `design-brief`, `templates/*` |
| AI-generated-interface cliché clusters, UI quality floor (MUST / SHOULD / NEVER), agent UX patterns (six moments, when to interrupt, approval surface, running states, AI-only visual) | `cc-base` references | **Absorbed** | `design-brief/REFERENCE.md` |
| Task-first composition: surface recognition table, skeleton from real content, composition-by-evidence table, same-content two-candidate comparison, conditional recommendation | `codex-base` design-brief-builder + visual-methods | **Absorbed** | `design-brief/REFERENCE.md` |
| Offline self-contained HTML prototype written by the agent; coverage matrix; two-pass plan and cliché review; direction samples; action contract; async and stale-result handling; render / keyboard / content checks; acceptance checklist; task walkthrough; prompt mode | `codex-base` design-maker (in-repo generation) + `cc-base` design-maker (two passes, acceptance, prompt mode) | **Adapted**: codex-base's in-repo generation replaces cc-base's generator daemon and hosted fallback | `design-prototype` |
| Generator-service integration (`odc` daemon, design-system registry, hosted studio fallback) | `cc-base` design-maker | **Rejected**: provider-specific tooling; the method is kept, the tool is not | — |
| Plan by value and unknowns first (dependencies correct, never lead), assumptions verified per phase, granularity calibration, no placeholders, worst-executor standard (path + change + verify command), pre-flight section, iteration mode leaving ✅ phases alone | `cc-base` dev-planner + template | **Absorbed** | `dev-plan`, `templates/dev-plan-template.md` |
| Every result has an evidence producer; functional vs verification dependency; integration owner; research tasks end unknowns; handoff check | `codex-base` dev-planner + acceptance-and-dependencies | **Absorbed** | `dev-plan/REFERENCE.md` |
| Per-task tiering LOW / MEDIUM / HIGH by diff size, path classes, new dependencies → three chains; medium and low findings as residue; one-round convergence | `cc-base` 2026-09-15 three-tier table | **Adapted**: the tiers select cursor-base's existing profiles `rapid` / `balanced` / `strict`, which the floors may only raise — no second assurance axis | `phase-build`, `assurance-profile`, `docs/PROTOCOLS.md` |
| Seven-field dispatch pack (Business Context added: spec rules, `progress.md` entries by date, lessons, domain rulings; never `N/A`); receipt fields Business assumptions / Counter-examples / Domain findings; ≤6 tool calls for small packs; 60-minute rule; fresh instances; escalation ladder; new files not proved by `git diff` | `cc-base` subagent-dispatch; `codex-base` ROLE-CONTRACTS | **Absorbed** | `docs/PROTOCOLS.md`, agents |
| Four-step phase close (review, test completeness by a non-author, compile, functional) and PASS / CONCERNS / FAIL / WAIVED gate; WAIVED never for security or data loss | `cc-base` dev-builder | **Absorbed**; `waiver` already refuses security-class checks and critical tiers, the data-loss refusal is the skill's rule | `phase-build` |
| Building discipline: grep all references before changing shared things, migrate persisted data, test isolation consumed by real entry points, real data only, SDK first, verification in the same message, model-facing output never truncated, documents follow, lockfile regenerated with the recorded tool version, no silent fallback | `cc-base` dev-builder; `codex-base` dev-builder + state-and-result-chain | **Absorbed** | `phase-build/REFERENCE.md`, `scoped-implementation/REFERENCE.md` |
| Mechanical 300-line file limit | `cc-base` dev-builder | **Rejected** in favour of codex-base's responsibility-based split; a line count is not a reason | — |
| "Main agent never codes" hard rule and its hook | `cc-base` no-direct-code-guard | **Rejected**: cursor-base lets the profile decide independence (codex-base's 2026-09-15 stance); the orchestrator may implement, but never certifies its own work | — |
| Define the expected behaviour before the stack trace (spec item, Business Context, user's words; `[inferred]` gets a question first); questions the user can answer from experience; normal-path comparison and first observable divergence; one-condition experiments; negative results count; stop-loss vs root fix; three-miss breaker; red-lock before fix | `cc-base` bug-fixer; `codex-base` bug-fixer + comparison-and-experiments | **Absorbed** | `root-cause-debugging` |
| Stage 0 / 1 / 2 review (static gate, spec conformance with four verdicts incl. requirement in doubt, quality), adversarial stance with real reproduction, decidable questions, report grouping, fix routing, one-round convergence, `notReviewed` vs `Not verified` | `cc-base` code-review; `codex-base` code-review | **Absorbed** | `code-review` |
| Red-blue-review as a separate skill and report template | `cc-base` | **Adapted**: already the structured review; blue / red / judge naming, deletions-first reading for governance assets, and domain-clue routing added | `structured-review` |
| Test design from business scenarios (rule → positive case, exception → case, `[open]` → skipped), contract-first budget, must / recommended / not lists, `# risk:` header and P0 / P1 / P2, three-way triage (code / test / spec), independent oracles (one-way before round trip), fixtures reaching the production entry, reading other tools' reports, ratio as maintenance diagnostic, event-driven ageing, four floor classes never retire, red-lock rule | `cc-base` test-builder; `codex-base` test-builder + two references | **Absorbed** as a new skill; `affected-verification` keeps running the plan | `test-design`, `templates/test-scaffold.md` |
| Test-code ratio (one third to one half) as a completion criterion | `cc-base` Pinned | **Rejected** as a gate; **adapted** as a maintenance diagnostic per codex-base ("never for a diff, never a reason to add or delete cases") | `test-design/REFERENCE.md` |
| Release: explicit-only invocation, gate before build, artefact-level privacy audit, install-from-package testing, three-fact deployment verification, per-action evidence table, artefact → loaded-instance tracing, failure-after-the-fact triage, rollback vs forward fix | `cc-base` release-builder; `codex-base` release-builder + artifact-and-recovery | **Absorbed** as a new skill beside `release-readiness`; the harness engine still performs no release action — `release readiness` reports and stops, and an authorised action is carried out by the agent through this skill, invoked by name | `release-build` |
| Branch finishing: environment probe (branch / worktree / detached, submodule false positive), test gate first, conditional menu, authorisation per action, HUMAN / AGENT description sections, cleanup without deleting unmerged work | `cc-base` branch-finisher; `codex-base` branch-finisher | **Absorbed** | `finish-branch` |
| Skill authoring: template first, pattern by interaction type, minimal sections, scenario design with honest RED→GREEN, provenance and copy treatment, source / runtime separation, no auto-install, registration | `cc-base` skill-builder; `codex-base` skill-builder + interaction-design | **Absorbed** as a new skill; the loader constraints are `skills-lint`'s | `skill-authoring` |
| Feedback: five signals, split business fact / method lesson, apply the correction before recording it, scope / exceptions / supersedes / applied to, scores only with evidence (teaching ≠ inefficiency, silence ≠ satisfaction), what each stage proves | `cc-base` feedback-writer + template; `codex-base` feedback-writer + adoption reference | **Absorbed** | `record-lesson` |
| Graduation by two questions — already codified? real cost? — instead of an occurrence counter (39 of 43 lessons in one corpus stayed at one) | `cc-base` 2026-09-12 | **Adapted**: `feedback list` keeps the three-occurrence hint; the two questions decide | `record-lesson/REFERENCE.md` |
| Evolution engine as a session-start subagent scan | both | **Adapted**: folded into `record-lesson` as the graduation scan; no session-start scan and no runner agent | `record-lesson/REFERENCE.md` |
| Decisions with three elements (basis, scope, supersedes), supersession marks on old entries, Pinned ≤ 15, Decisions ≤ 30 then archive, `Done` states the evidence boundary, recovery reads spec + changelog + plan too | `cc-base` progress-recorder + 2026-09-15 memory caps; `codex-base` progress-recorder | **Absorbed** | `project-memory`, `docs/PROJECT-MEMORY.md` |
| Domain rulings library: seven columns, four-quadrant triage ("who knew it originally?"), two admission questions, three basis kinds, three change kinds, four ageing kinds, three trigger sources, parasitic collection on the receipt, clue vs ruling, structured retrieval, task-level reading | `cc-base` domain-rulings skill + rule + backfill trials | **Absorbed** as a new skill; the agent records directly (no recorder agent) | `domain-rulings` |
| Semantic consumers beyond the import graph, pointer-only packs need excerpts, fan-out economics | `codex-base` large-repo-harness | **Absorbed** into the existing guide | `docs/LARGE-REPO-GUIDE.md` |
| A catalog field declaring unknown or dynamic dependencies (`dependencyUncertainty`) | `codex-base` large-repo-harness | **Adapted**: no new schema field; the existing `shared: true` / `globalPaths` fan-out is the honest carrier for "not fully mapped" | `docs/LARGE-REPO-GUIDE.md` |
| Workflow scripting with a native `agent()` fan-out API | `cc-base` workflow-orchestration | **Rejected**: not a Cursor capability; the economics (read-only only, opt-in, ~15× cost) are kept as protocol | `docs/PROTOCOLS.md` |
| Agent memory per role with size caps | `cc-base` memory-systems | **Rejected**: Cursor subagents have no persistent role memory; nothing to cap | — |
| Recorder, observer, runner, and deployer subagents | both | **Rejected**: the orchestrator writes `progress.md`, the corpus, and `domain/` directly; a deployer would carry an authorisation the harness refuses to hold | — |
| "Four avoid-overs" (over-design, over-testing, over-review, over-trust) as a constitutional test for any new gate, test, review layer, or memory layer | `cc-base` 2026-09-15 Pinned; `codex-base` 2026-09-15 | **Absorbed** | `AGENTS.md` §Product work, `progress.md` Pinned |
| Documents-first routing and the stage machine; sign-off gates; project root layout | `cc-base` dev-workflow-details + file-structure; `codex-base` AGENTS.md routing | **Adapted** as a path-scoped rule plus a document, never always-applied | `.cursor/rules/60-product-workflow.mdc`, `docs/PRODUCT-WORKFLOW.md` |
| Fifteen-chapter user guide | `cc-base` docs/guide | **Deferred**: worth writing once the workflow has run on a real project; a guide written before use documents intentions | `progress.md` TODO |

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
| Write ownership | `node scripts/harness.mjs task start` | Writes outside owned paths are denied; owned-path drift is warned and adopted |
| Gate effectiveness | `node scripts/harness.mjs gate-audit` | Inert gates are named, not assumed useful |
| Service resilience | `node scripts/harness.mjs service <sub>` | Backoff restart, breaker, health probe, pid-true status |
| Proactive risk | `node scripts/harness.mjs risk` | State decay becomes findings; sessionStart stays a short safety/assurance banner |
| Evidence integrity | hash-chained ledger, `quality verify` | Deleted or edited receipts are detectable |
| Data lifecycle | `node scripts/harness.mjs retention` | Aged evidence destroyed; referenced evidence protected |
| Lesson capture | `docs/feedback/`, `record-lesson` skill, `feedback lint` | `feedback list` hints candidates by count; two questions — already codified? real cost? — decide graduation |
| Boundary design | `architecture-design` skill | Seven principles mapped to enforceable checks; ADRs with revisit and reversal |
| Attribute design | `dfx-design` skill | Thirteen dimensions; measurable target, design means, wired verification |
| Requirements | `product-spec` skill | Learn the business from a real event; sign off by replaying the user's case |
| Design | `design-brief`, `design-prototype` skills | Task first; tokens and prose; an offline walkable mock-up |
| Planning a product | `dev-plan` skill | Value and unknowns first; every task has path, change, verify command |
| Building a phase | `phase-build` skill | Tiered tasks select the profile; four-step close, four-state gate |
| Testing | `test-design` skill | Business scenarios, independent oracles, three-way triage |
| Releasing | `release-build` skill (explicit-only) | Artefact audited, installed form tested, deployment verified by three facts |
| Domain knowledge | `domain-rulings` skill, `domain/` | How things are counted in the field, triaged and sourced, read at dispatch time |
| Skill authoring | `skill-authoring` skill | Template, pattern by interaction type, scenarios, provenance |
| Evidence strength | `profile <sub>`, `harness/assurance-policy.json` | `explore < rapid < balanced < strict`; floors only raise |
| Deadline pressure | `fast on/off`, `debt list` | Pre-declared checks deferred as dated, repayable debt |
| Structured review | `review <sub>`, `review-pack`, `reviewer` agent per lens | Staged lenses, located findings, computed verdict |
| Memory recovery | `recap`, `invariants`, `sync-check`, `archive`, `postToolUse` hook | Derived from files; re-injected after compaction |
| Governance integrity | `instructions`, `rules-audit`, `skills-lint`, `agents-lint` | Untrusted instruction files; no phantom rules; loadable skills |
| Catalog bootstrap | `catalog discover` | Modules and edges proposed; tiers never guessed |
| Release proof | `release readiness` | Every condition reported under strict; claimed independence cannot close a release |

## 2026-09-17 model-capability cut

Hard safety stays machine-enforced and few. Always-on text shrinks. Closing is an affected gate
plus an observable check, not a review receipt. Product-factory skills sleep. Remaining skills
are formal methods (Task / Preconditions / Invariants / Method with accept-reject).

| Mechanism | Decision | Where it lives |
| --- | --- | --- |
| Always-applied rules | Only `00-safety.mdc`; the rest are path-triggered | `.cursor/rules/` |
| `balanced` close | Passing affected gate; no review receipt | `src/assurance.mts`, `src/quality.mts` |
| `strict` lenses | correctness + security, not all nine | `BUILTIN_PROFILES` |
| Runtime attributes | No `shared: true`; security/privacy/safety low; path floor on hooks and shell-policy | `harness/module-catalog.json`, `DEFAULT_POLICY` |
| Check tags | Honest classes; `node-test` claims reliability and resilience; fitness/arch-check/catalog-lint/adr-check are not a security bag | `harness/verification-matrix.json` |
| Task lease | Deny outside owned paths; warn-and-adopt on owned drift | `src/task.mts` |
| sessionStart | Safety + optional task + short assurance banner | `src/hooks.mts` |
| `afterShellExecution` | Optional in `hooks.json`; handler stays for tests | `REQUIRED_HOOK_EVENTS` |
| Model-facing CLI | Eight verbs; `help --for-model` | `MODEL_COMMANDS` |
| Review input | JSON or `--file findings.md` | `parseReviewPayload` |
| Release independence | `claimed` cannot close `--operation release` | `src/release.mts` |
| Skill form | Required headings; product factory sleeps except `product-spec` | `skills-lint`, `.cursor/skills/` |

## 2026-09-16 engine cost-model cut

Four mechanical changes, no fifth profile, no second review engine, hash-bound receipts stay.

| Mechanism | Decision | Where it lives |
| --- | --- | --- |
| Stop hook on a clean tracked tree, and gate paired with a memory write | Untracked tooling is not unverified work; missing receipts ask for `gate` only; memory sync waits until receipts exist | `src/hooks.mts`, `trackedChangedPaths` |
| Governance path floor | Executable harness and delivery surface only; skills, rules, docs, `AGENTS.md` follow the module's attributes | `DEFAULT_POLICY`, `harness/assurance-policy.json` |
| `FRAMEWORK-MANIFEST.json` as a global path | Moved onto the `distribution` module so a docs or skill edit that rewrites it does not convene every module | `harness/module-catalog.json` |
| Skill descriptions the host YAML loader drops | `skills-lint` errors `YAML_UNQUOTED_COLON` | `src/scan.mts` |

## Non-goals

- Emulating another agent provider or importing its proprietary assets
- Encoding framework-, language-, package-manager-, or CI-specific policy
- Treating a review, test, worktree, ignore file, or Windows sandbox as proof of complete safety
- Maximizing automation at the expense of explicit user control
