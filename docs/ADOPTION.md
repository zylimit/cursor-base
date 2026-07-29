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

## Team rollout

Pilot the harness on one bounded subsystem. Measure hook latency, false positives, verification time, and review escapes before enabling stricter policies repository-wide. Keep secrets outside the workspace and enforce production permissions in CI, cloud credentials, and organization controls rather than prompts alone.
