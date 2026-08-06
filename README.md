# cursor-base

A technology-neutral Cursor governance harness for large repositories. It keeps durable policy small, delegates specialized work to scoped agents and skills, and records evidence for planning, implementation, review, and verification.

## Requirements

- Node.js 20 or newer
- Git
- PowerShell 7+ on Windows, or a POSIX shell on macOS/Linux
- Cursor with project rules, agents, and skills support

## Install into a repository

Clone this repository, preview the merge, then install into an explicit target:

```powershell
.\setup.ps1 D:\Code\my-project -DryRun
.\setup.ps1 D:\Code\my-project
```

```sh
./setup.sh /work/my-project --dry-run
./setup.sh /work/my-project
```

The installer preserves existing files and writes conflicting framework content as `*.cursor-harness-new`. It does not install dependencies, modify user-level Cursor settings, commit, or push.

## Develop and verify the harness

```sh
npm install
npm run typecheck
npm run build
node scripts/harness.mjs doctor
node scripts/harness.mjs validate
node scripts/harness.mjs test
node scripts/harness.mjs manifest --check
```

Working commands for a repository that has the harness installed:

```sh
node scripts/harness.mjs catalog lint      # every tracked path must have an owner
node scripts/harness.mjs affected          # which modules a change reaches
node scripts/harness.mjs arch-check        # do real imports match the declared graph
node scripts/harness.mjs context-pack      # budgeted context, written to disk
node scripts/harness.mjs gate              # execute the affected checks, record receipts
node scripts/harness.mjs quality status    # what is still unproven for this diff
node scripts/harness.mjs task start ...    # own a writable scope for the change
node scripts/harness.mjs gate-audit        # which hooks have ever caught anything
```

Quality attributes, for building code that is secure, private, resilient, and reliable rather
than merely tested:

```sh
node scripts/harness.mjs quality attributes   # per-attribute evidence coverage and gaps
node scripts/harness.mjs quality verify       # ledger chain and evidence-file integrity
node scripts/harness.mjs fitness --all        # built-in rules, no external tool required
node scripts/harness.mjs adapters list        # curated external tools and whether they exist
node scripts/harness.mjs adapters add sast-semgrep
node scripts/harness.mjs adr-check           # every live decision names the check enforcing it
```

Operations: supervised services, proactive risk findings, and evidence lifecycle:

```sh
node scripts/harness.mjs service start dev-server   # crash restart, breaker, health probe
node scripts/harness.mjs service status             # liveness from pids, not from records
node scripts/harness.mjs risk                       # stale tasks, broken chains, dead services
node scripts/harness.mjs retention --dry-run        # what the destruction schedule would remove
node scripts/harness.mjs feedback list              # recorded lessons and graduation candidates
```

See [docs/QUALITY-ATTRIBUTES.md](docs/QUALITY-ATTRIBUTES.md) for the six strength tiers, the
coverage rules, and the boundary between what this proves and what it does not. See
[docs/OPERATIONS.md](docs/OPERATIONS.md) for service supervision, risk scanning, and retention.

Behavior lives in `src/harness.mts`. The checked-in `.cursor/runtime/harness.mjs` is compiler
output so hooks and installed repositories run without a build step; `npm run runtime-sync`
recompiles the source and fails if the two differ.

See [docs/ADOPTION.md](docs/ADOPTION.md) for existing repositories and upgrades.

## How to use

1. Start with a task envelope: **Goal, Scope, Out of Scope, Existing Pattern, Verification, Escalation**.
2. Use `explorer` for discovery and `impact-analyst` before cross-module or contract changes.
3. Use the matching skill for the workflow; keep writes serialized unless file ownership is explicitly disjoint.
4. Finish with a receipt: **Status, Changed, Verified, Not verified, Needs review by, Evidence**.
5. Run `node scripts/harness.mjs gate` to execute the affected checks; it records a receipt bound
   to the current diff, and the completion gate stays closed until those receipts pass.

For operating policy, see [docs/GOVERNANCE.md](docs/GOVERNANCE.md). For the structure and scaling model, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/LARGE-REPO-GUIDE.md](docs/LARGE-REPO-GUIDE.md).

## Safety defaults

- Safety policy cannot be waived.
- Quality waivers require owner, reason, exact scope, and expiry.
- Review receipts are bound to a base commit and diff hash.
- The harness never automatically pushes, kills a port, or overwrites user changes.
- Windows sandboxing reduces risk but is not an absolute boundary.

## License

MIT. See [LICENSE](LICENSE).
