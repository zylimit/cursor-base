# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog, and versions use Semantic Versioning.

## [2.0.0] - 2026-09-05

Tiered assurance, structured review, memory that survives compaction, and governance integrity,
following a line-by-line study of `dsh-base` and `cc-base` and a review of `codex-base`
(see `docs/CAPABILITY-MATRIX.md` for every accept/adapt/reject decision).

### Added

- **Assurance profiles** (`profile show|set|list|explain`, `harness/assurance-policy.json`):
  four built-in strengths `explore < rapid < balanced < strict` over eight monotonic controls
  (verification breadth, deferral, review mode, attribute gaps, memory sync, budget, context
  depth, completion) plus the review-lens set. Named profiles may only tighten their parent.
  Floors from task risk, impact, protected attributes, and governance paths only raise the
  effective profile. The effective controls are part of the plan hash, so a profile change
  stales receipts. Profiles never touch the capability axis (hooks, `cli.json`, sandbox).
- **Fast loan and evidence debt** (`fast on|off|status`, `debt list`): a dated, reasoned loan
  defers only checks the matrix pre-declared `allowFastSkip`, never protected evidence; each
  deferral is a `SKIPPED (deferred)` receipt and a debt entry repaid only by a later `PASS`. A
  loaned gate keeps `quality status` green but never `closable`; an all-deferred gate is
  `BLOCKED`; `risk` reports open loans and debt that outlived them.
- **Structured review** (`review start|blue|lens|verdict|status|team|backlog`, `review-pack`,
  `authorship record|show`): nine lenses in three cost-ordered stages, convened by the profile
  and shrunk by the attributes affected modules declare; every finding located; the verdict is
  computed (one error is never outvoted), refused when a convened lens is silent, stale when
  the tree moves, escalated after three rejected rounds, and a final `ACCEPT` writes the
  approving receipt with lens coverage that `reviewMode: structured` requires. The reviewer is
  never the author where authorship was recorded.
- **Project memory** (`recap`, `invariants`, `sync-check`, `archive`): a budgeted digest and
  the non-negotiable invariants derived from files and live state, re-injected on the first
  tool call after a compaction (`postToolUse`); governed code moving without `progress.md`
  is a finding and blocks the stop hook under `strict`; archiving moves entries whole.
- **Governance integrity** (`instructions`, `rules-audit`, `skills-lint`, `agents-lint`):
  instruction files scanned as untrusted input (endpoint override, embedded credential,
  instruction override, exfiltration, silent execution, hidden characters, gate-disable);
  every constitution rule classified enforced / prompt-only / phantom / unenforced with
  phantoms failing; skill frontmatter checked against what the loader reads; nested
  `AGENTS.md` contracts required where a protected attribute blocks.
- **Catalog discovery** (`catalog discover [--write]`): modules from the tree, `dependsOn` from
  real import edges, checks from build manifests, attribute *proposals* with evidence; tiers,
  forbidden edges, and layers are never guessed.
- **Release readiness** (`release readiness`): every release condition under the strict floor,
  `PASS | FAIL | BLOCKED`, CI observed through `gh` or reported `BLOCKED`; trust-boundary
  fields false by construction; no release action is ever taken.
- **Exit-code contract**: `0` ok, `1` violation, `2` gate, `3` degraded (never a pass), `4` stale.
- Blast-radius budget: the catalog's `budget` (`maxChangedFiles`, `maxChangedLines`,
  `maxModulesTouched`, `maxNewFiles`) is measured per change and enforced as the profile's
  `budget` control says — advisory under `balanced`, blocking under `strict` (`quality budget`,
  `quality status`, the `stop` hook).
- Nested `AGENTS.md` contracts for this repository's own modules (`src/`, `tests/`, `docs/`,
  `harness/`); `agents-lint` accepts a contract in any directory a multi-root module spans.
- `afterFileEdit` records authorship per conversation for the review verdict's independence check.
- `quality status` reports `closable`, `blockers`, `assurance`, `review`, `budget`, and `open_debts`
  alongside `complete`; `task complete` requires `closable` and a completion control that
  matches the task's risk; `receipt --lenses` records lens coverage by hand.
- Session and delegation hooks announce the effective profile, open loan, and unpaid debt.
- New skills: `assurance-profile`, `fast-lane`, `structured-review`, `release-readiness`,
  `catalog-discovery`; the `reviewer` agent reports a single lens when delegated one.
- `tests/assurance.test.mjs`: end-to-end tests for the above through the compiled runtime.

### Changed

- The engine is split from one 5,860-line file into 18 modules plus an entry point, with an
  acyclic import graph that a test asserts (`docs/ARCHITECTURE.md`); runtime parity is checked
  over the whole tree.
- `AGENTS.md` and every rule now name the mechanism that enforces them or say `(prompt-only)`;
  `rules-audit` reports 0 phantoms and 0 unenforced rules for this repository (was 0 enforced
  of 44).
- Closing a task under `balanced` (the default) requires an approving review receipt bound to
  the diff, as in every sibling harness; `rapid` closes low-risk work on a passing gate alone.
- `preCompact` emits a `user_message` (Cursor's hook is observational) and arms the
  `postToolUse` re-injection instead of returning context the host ignores.
- The `rm` deny pattern is anchored to argument boundaries: `rm -rf build/`, `rm dir/*.log`,
  and `rm .gitignore` ask; `rm -rf /`, `rm -rf "/"`, `rm -rf /*`, `rm -rf ../x`, and any `.git`
  directory still deny.
- Skill descriptions trimmed under 220 characters; every request pays for them.
- `validate`/`doctor` no longer warn about bootstrap defaults inside the harness source
  checkout, where the catalog is the template by definition.
- CI uses `actions/checkout@v5` and `actions/setup-node@v5`.
- A review opened with `review start --base <ref>` stays fresh against that range instead of
  going stale against HEAD, writes its receipt bound to that base, and counts authorship
  recorded anywhere inside the range.
- From the structured self-review of 2.0.0 (three lens reports, five errors): review rounds
  reset on an `ACCEPT` or a new base instead of accumulating across unrelated changes;
  `archive` removes entries by position, never by text; `contextDepth` now drives how far
  `context-pack` reaches; lenses are convened from the impact closure, not from the plan's
  widened module set, through one shared function; `memorySync: warn` reports drift through
  `recap` and `risk`; `fast on` refuses under a profile that forbids deferral; only an
  engine-written receipt (`source: "review-engine"`) satisfies structured review; a plan that
  reaches modules but selects no check is not `complete`; a root deletion followed by another
  command and a machine command behind `sudo` options are denied; a UTF-8 BOM is not a hidden
  character; `catalog discover` no longer crashes when only the template catalog exists; a fresh
  `install` into a committed repository discovers the target's catalog instead of shipping this
  repository's (`--no-discover` keeps the template); the reviewer agent's read-only relay
  protocol is documented.
- From round 2 of the same review (two errors, ten warnings): the rm-root deny pattern anchors
  on an argument boundary, so a root deletion followed by more arguments or a redirection is
  denied; a service or check command with an unquoted variable, glob, brace, tilde, or
  redirection runs through the shell again (`requiresShell`) instead of receiving them literally;
  the live contracts (`harness/module-catalog.json`, `verification-matrix.json`,
  `assurance-policy.json`) are no longer distributed — a target's are seeded from neutral
  `default-*` templates (a single `app` module over `src/**`, no checks, no tiers) and then
  discovered, so this repository's risk posture never reaches a target; structured review reads
  the newest engine receipt rather than the newest approval of any source; re-opening an
  unchanged diff no longer counts a round; authorship paths are NUL-separated; the installer and
  `catalog discover` share one writer that never overwrites an edited file; `diffStats` in core
  measures the budget with the same scoping as `changedPaths`; the denied-directory predicate
  lives in core; `receipt check` accepts a range base that is an ancestor of HEAD; the stop hook
  reports a plan with no checks; the compaction note records the affected closure; `release
  readiness` names optional conditions it could not evaluate instead of claiming every condition
  holds; `setup.ps1 -NoDiscover`; install-time discovery documented where adopters read.

### Fixed

- Windows CI had been red since 1.1.0: the service-supervision test killed only the `cmd.exe`
  that `shell: true` records as the child pid, orphaning the node process beneath it, whose
  working directory then kept the fixture from being removed (`EBUSY`). Three defects behind it:
  a service whose command is one program is now spawned directly, so the recorded pid is the
  service itself (the shell is used only for pipelines, chains, substitutions, and `.cmd`/`.bat`
  wrappers); `service stop` on Windows asks the supervisor to shut down through the stop flag
  instead of `TerminateProcess`, which skipped its handler and left the child tree behind, and
  it re-reads the last recorded child before confirming; `killTree` passed `/T /T` instead of a
  polite `/T` to `taskkill`. The test kills the tree, names any leaked process in the log, and
  fixture cleanup retries on handle-release lag.
- Machine-level commands (`shutdown`, `reboot`, `halt`, `poweroff`, `mkfs`, `diskpart`) are
  denied in command position only; a commit message or an `echo` that mentions the word is no
  longer blocked as "obviously destructive".

## [1.1.0] - 2026-08-07

Resilience, integrity, privacy lifecycle, and design-time governance, distilled from a
cross-pollination review of the sibling harnesses (`cc-base`, `codex-base`, `pi-base`).

### Added

- `service start|stop|status|list|logs`: development services run under a supervisor with
  crash restart and exponential backoff, a restart-storm breaker that marks the service
  `crashed` and preserves the log instead of restarting forever, an optional health probe that
  treats "alive but not serving" as an outage, and status synthesized from live pids rather
  than recorded state. Start reports success only after the supervisor's pid answers a
  liveness check. The supervisor only terminates processes it started itself.
- `risk`: proactive scan of harness state — broken ledger chain, stale active task, repeated
  check failures, crashed or dead services, quarantined state, expired waivers, and lessons due
  for graduation. The sessionStart hook surfaces the worst findings; `--strict` fails on high.
- Hash-chained quality ledger. Each receipt carries a chain hash, rotation carries an anchor,
  and deleting, editing, or truncating history is detectable. A broken chain fails closed:
  completion is assessed as if nothing was verified. `quality verify` additionally re-hashes
  referenced evidence files and reports tampered or missing evidence for the current diff.
- `retention`: destroys aged evidence and context packs on the schedule declared in the module
  catalog, never deleting evidence referenced by a current-diff receipt or the newest receipt
  per check; `--dry-run` previews. Completes the collect-redacted / store-bounded /
  destroy-on-schedule lifecycle.
- Risk-tiered verification: the matrix's `riskChecks` lists join the plan cumulatively from the
  active task's declared risk or an explicit `--risk`, and the risk level is part of the plan
  hash, so narrowing risk invalidates receipts.
- Waivers are bound to one check and one diff, require approval evidence, and defer only checks
  that could not run: an executed `FAIL` is never waivable, security-class checks and
  critical-tier attributes refuse waivers at creation, and `assessQuality` consumes valid
  waivers visibly (`waived` on the check; `high`-tier attribute gaps defer only when every
  claiming check is waived).
- A check failing three consecutive runs has its reason rewritten to stop re-running and follow
  root-cause debugging, and the streak appears as a risk finding.
- Feedback corpus (`docs/feedback/`) with `feedback list|lint`: lessons carry an occurrence
  count and graduate into enforced rules after three recurrences, with the initial corpus
  distilled from the sibling-harness review. `validate` lints the corpus when present.
- Skills: `architecture-design` (the seven principles — open-closed, dependency inversion,
  single responsibility, interface segregation, least knowledge, Liskov substitution, composite
  reuse — each mapped to catalog/arch-check/ADR enforcement), `dfx-design` (DFX dimension
  ratings with measurable target, design means, and wired verification; cost symmetry),
  `service-operations` (supervision runbook and incident playbooks), and `record-lesson`
  (feedback capture and graduation).
- Scale: compiled glob patterns are cached, and the regression suite pins a generated
  600k-line, 30k-file, 120-module repository. Measured: `catalog lint` ~3.2s for 30,001
  tracked paths, `affected` ~60ms.
- Schemas for services configuration, and schema updates for waiver binding, `riskChecks`, and
  the retention policy. `doctor` reports ledger-chain and services-config health.

## [1.0.0] - 2026-08-06

### Added

- Quality attributes as first-class declarations. A module declares attributes drawn from
  ISO/IEC 25010 at one of six strengths (`critical`, `high`, `medium`, `low`, `minimal`, `none`),
  checks declare which attributes they evidence, and `quality attributes` reports coverage. A
  failing claim outweighs a passing one; `minimal` and `none` require a written reason.
- `arch-check` enforces `forbiddenDependencies` and layer direction against real import edges, so
  a privacy or security boundary is executable rather than documented.
- `fitness` runs built-in pattern rules needing no external tool: credential literals, personal
  data in logs, empty exception handlers, unbounded retries, unreferenced deferral markers. Rule
  strength follows the declared tier, and `harness-fitness:ignore` suppresses a single finding.
- `adapters list|add` curates external quality tools with their attributes and availability, and
  wires a chosen one into the verification matrix without bundling or installing anything.
- `adr-check` requires every decision record that is not explicitly retired to name an existing
  verification check or fitness rule in an `Enforced-by:` line.
- `class: runtime` evidence binds to a time window rather than a diff, because a load test or SLO
  probe measures a deployed system, and is labelled so it is never read as diff-bound.
- `gate` executes the affected verification plan and records a receipt bound to the base commit
  and canonical diff hash. Checks resolve to `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED`; a missing
  executable is `BLOCKED` and never counts as a pass. Passing checks print status only, and full
  output goes to an evidence file with credentials redacted.
- `quality status` reports which checks still lack a passing receipt for the current diff.
- `arch-check` extracts real import edges and fails when code crosses a boundary the module
  catalog never declared, and reports declared dependencies no import supports.
- `catalog lint` requires every tracked path to be mapped to a module, listed in `globalPaths`,
  or ignored with a written reason, and rejects catch-all module patterns.
- `context-pack` builds a budgeted context pack on disk and prints only its manifest.
- `task start|status|complete|cancel` owns a writable scope. Writes to an owned file that changed
  outside the task are blocked, and completion requires passing receipts.
- `gate-audit` reports which hooks have actually intervened and which never have.
- `afterShellExecution`, `subagentStart`, and `preCompact` hooks record what ran, constrain
  delegation, and persist state before context is compacted.
- Cross-process state locking and atomic writes for concurrent hook processes.
- Approval-tier rule, project-memory contract, and the `project-memory` skill.
- Technology-neutral Cursor rules, specialized agents, and workflow skills.
- Task envelope, completion receipt, quality-waiver, and review-receipt contracts.
- Large-repository guidance for module-scoped discovery, implementation, review, and verification.
- Safety defaults covering user changes, external side effects, and sandbox limitations.

### Changed

- The harness is now real TypeScript. `src/harness.mts` compiles to the checked-in
  `.cursor/runtime/harness.mjs`, and `validate --sync-only` recompiles the source into a scratch
  directory and compares bytes, so the runtime cannot be edited by hand. Previously the two files
  were hand-maintained byte-identical copies and the compiler never ran.
- An unmapped or overlapping changed path, a `globalPaths` change, a `shared` module change, or
  unavailable Git now expands verification to every module and reports why, instead of selecting
  a single fallback check.

### Fixed

- The diff binding no longer collapses on a large change. Git output was read through a pipe with
  Node's 1 MiB default limit, so any diff above that size was silently truncated to nothing and
  `diff_sha256` became the hash of the empty string — a constant. Two unrelated changes over
  1 MiB therefore shared one binding, and a receipt from either satisfied the gate for the other.
  On a repository of the size this harness targets, that was the normal case. The diff is now
  written to a file and hashed in chunks, git output limits are explicit, and a truncated or
  failed enumeration raises an error instead of reporting an empty change set.
- A verification plan that selected no checks reports `BLOCKED` instead of `PASS`. An over-broad
  `ignored` rule could otherwise turn the gate permanently green.
- `gate --dry-run` no longer executes the checks. It previously ran every command in the matrix
  and skipped only the ledger write, which is the opposite of what the flag means everywhere else
  in the CLI and is especially dangerous given that the matrix is a repository file.
- A check that ran and failed is never acceptable, whether or not it was `required`. `gate` and
  `quality status` previously disagreed about the same evidence for an optional failing check.
- Wrapper commands no longer hide the program being run. `timeout 5 git restore .` parsed as a
  program named `5`, so it was allowed while the unwrapped form was denied; the same applied to
  `nice -n`, `ionice`, `stdbuf`, and `sudo -u`.
- Git classification defaults to requiring approval for any subcommand not on a read-only list,
  rather than allowing everything not explicitly enumerated. `git checkout <path>`,
  `git restore --staged --worktree`, `git branch -D`, `git reflog expire`, and abbreviated long
  options such as `--har` for `--hard` were all previously allowed. Branch and path arguments are
  now distinguished by checking the filesystem, so `git switch -c feature/x` stays unblocked.
- Credential paths fused to an option value are detected: `curl -d@.env`, `curl -T.env`, and
  `curl -F file=@.env` were allowed because the basename was unrecognizable. Bare `credentials`,
  `.netrc`, `.npmrc`, and a credential directory named without a trailing separator now match.
- A module pattern no longer claims a sibling directory sharing its prefix; the pattern `src`
  matched `srcbackup/` and silently took ownership of it.
- The harness's own test-directory exclusion no longer leaks into task baselines or `arch-check`.
  A task owning `tests/**` recorded an empty baseline, which denied every write to an existing
  test file, and test code was invisible to the dependency graph.
- `moduleForPath` honours `module.root`, so a root-based module is visible to `arch-check` rather
  than reporting a clean graph it never scanned.
- `gitAvailable` distinguishes "not a repository" from "the git command failed", and is memoized
  instead of spawning a subprocess on every call.
- Conservative expansion no longer fires because Git is unavailable when the caller supplied the
  paths explicitly, since Git played no part in discovering them.
- `arch-check` resolves TypeScript NodeNext specifiers, where `./x.js` refers to a file named
  `x.ts`. Every such edge previously counted as unresolved, which silently hid the graph in the
  projects most likely to declare one.
- `catalog lint` reports the full unmapped and overlapping path lists and warns when the detail
  listing is truncated, instead of capping at fifty entries without saying so.
- The runtime-parity test no longer mutates the repository's own runtime file, which every other
  test executes; a failure before cleanup previously left the working tree broken.
- `validate` no longer records a verified diff. Structural validation of the harness never
  executed project checks, yet it satisfied the completion gate, so a knowingly broken file could
  be reported as verified.
- The completion gate now triggers on the working tree moving away from the session baseline
  rather than on file-edit events, which writes made through shell commands bypassed.
- Destructive command detection parses the command instead of matching the raw string.
  `git -C . reset --hard`, `git --work-tree=. reset --hard`, `git -c k=v clean -fd`, and the same
  commands behind `sudo` or environment assignments were previously allowed.
- `git checkout -- <path>` and `git restore <path>` are blocked. The previous pattern required a
  word boundary after `--`, so it matched `checkout --force` but not the form that actually
  discards uncommitted work.
- Shell and MCP calls that reach credential files are gated. The read guard covered only the file
  tools, so `cat .env` was allowed; sending a credential file outward is now denied outright,
  including across a pipe.
