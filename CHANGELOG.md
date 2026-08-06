# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog, and versions use Semantic Versioning.

## [Unreleased]

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
