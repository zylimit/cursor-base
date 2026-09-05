# Adoption

## New repository

Clone `cursor-base`, create the target repository, then run the installer with an explicit target:

```powershell
.\setup.ps1 D:\Code\my-project -DryRun
.\setup.ps1 D:\Code\my-project
```

```sh
./setup.sh /work/my-project --dry-run
./setup.sh /work/my-project
```

Review every `*.cursor-harness-new` sidecar before replacing an existing project file. The installer never commits, pushes, installs dependencies, or changes user-level Cursor settings.

## Existing repository

1. Capture the current Git status and preserve unrelated work.
2. Run a dry-run and review create/preserve operations.
3. Install, then customize `harness/module-catalog.json` and `harness/verification-matrix.json`.
4. Add nested `AGENTS.md` files and path-scoped rules only where a subsystem needs stronger local policy.
5. Run `node scripts/harness.mjs validate`, `doctor`, and the affected verification plan.
6. Review project hooks as executable code before trusting the workspace.

## Upgrades

Run:

```sh
node scripts/harness.mjs upgrade --target /path/to/project --dry-run
node scripts/harness.mjs upgrade --target /path/to/project
```

Files that still match the previous normalized SHA-256 are updated. Modified files are preserved and the new framework version is written beside them with the `.cursor-harness-new` suffix. Obsolete unmodified framework files may be removed; modified obsolete files remain.

### Upgrading from 1.x to 2.0

What changes for a repository that already runs the harness:

- **Completion needs review by default.** The default assurance profile is `balanced`, under
  which `task complete` requires an approving review receipt bound to the diff
  (`receipt --reviewer NAME --decision approve`, or the structured review's final `ACCEPT`).
  Teams that want the 1.x behavior for small work select `rapid`
  (`node scripts/harness.mjs profile set rapid`), which closes low-risk tasks on a passing gate
  alone. Floors still apply: medium risk, protected attributes, and governance paths raise the
  profile regardless of the selection.
- **New hook event.** `.cursor/hooks.json` gains `postToolUse` (invariant re-injection after a
  compaction), and `validate` requires exactly one hook per event. If your `hooks.json` was
  modified, `upgrade` leaves it in place and writes `hooks.json.cursor-harness-new` beside it;
  merge the `postToolUse` entry by hand.
- **New contract file.** `harness/assurance-policy.json` is installed with the defaults. Every
  field is optional; delete it to run on built-in defaults, or edit it to add named profiles,
  raise floors, or change the path floors (`docs/ASSURANCE-PROFILES.md`).
- **Matrix and catalog fields.** Checks may declare `allowFastSkip` (deferrable under a fast
  loan; never for security, safety, or privacy evidence). The catalog accepts `memory`,
  `budget`, and `review` sections; none is required.
- **Receipts are re-bound.** The plan hash now carries the effective assurance controls, so
  receipts recorded under 1.x do not satisfy a 2.0 plan for the same diff. Run
  `node scripts/harness.mjs gate` once after upgrading.
- **Runtime is a directory.** `.cursor/runtime/` holds one compiled module per concern instead
  of a single `harness.mjs`; the entry point and the hook commands are unchanged.
- **Exit codes.** `3` (degraded) and `4` (stale) join `0`, `1`, and `2`; scripts that treated
  every non-zero exit as a failure keep working, and scripts that keyed on `1` should read
  `docs/PROTOCOLS.md`.

## Team rollout

Pilot the harness on one bounded subsystem. Measure hook latency, false positives, verification time, and review escapes before enabling stricter policies repository-wide. Keep secrets outside the workspace and enforce production permissions in CI, cloud credentials, and organization controls rather than prompts alone.
