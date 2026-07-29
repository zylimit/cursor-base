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
node scripts/harness.mjs doctor
node scripts/harness.mjs validate
node scripts/harness.mjs test
node scripts/harness.mjs manifest --check
```

See [docs/ADOPTION.md](docs/ADOPTION.md) for existing repositories and upgrades.

## How to use

1. Start with a task envelope: **Goal, Scope, Out of Scope, Existing Pattern, Verification, Escalation**.
2. Use `explorer` for discovery and `impact-analyst` before cross-module or contract changes.
3. Use the matching skill for the workflow; keep writes serialized unless file ownership is explicitly disjoint.
4. Finish with a receipt: **Status, Changed, Verified, Not verified, Needs review by, Evidence**.
5. Run affected checks first, then broader validation when risk justifies it.

For operating policy, see [docs/GOVERNANCE.md](docs/GOVERNANCE.md). For the structure and scaling model, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/LARGE-REPO-GUIDE.md](docs/LARGE-REPO-GUIDE.md).

## Safety defaults

- Safety policy cannot be waived.
- Quality waivers require owner, reason, exact scope, and expiry.
- Review receipts are bound to a base commit and diff hash.
- The harness never automatically pushes, kills a port, or overwrites user changes.
- Windows sandboxing reduces risk but is not an absolute boundary.

## License

MIT. See [LICENSE](LICENSE).
