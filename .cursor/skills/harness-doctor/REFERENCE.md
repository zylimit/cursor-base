# Harness Doctor Reference

## Diagnostic sequence

1. Confirm the working directory is the intended repository root.
2. Record Node.js and Git availability; Node.js must be version 20 or newer.
3. Check expected setup entrypoints (`setup.ps1` or `setup.sh`) without running them unless requested.
4. Check that `AGENTS.md`, `.cursor/rules`, `.cursor/agents`, `.cursor/skills`, and required documentation exist.
5. Run `node scripts/harness.mjs doctor` when the entrypoint exists.
6. If requested, run `node scripts/harness.mjs validate`, then `node scripts/harness.mjs test`.

Missing scripts or entrypoints are `Not verified` or blocked prerequisites, not passing checks.

## Safe remediation

Suggest exact user-controlled actions. Do not install Node, package managers, dependencies, shells, certificates, or global tools. Do not edit policy to suppress a diagnostic. Never terminate a process to reclaim a port.

On Windows, account for PowerShell execution policy, path quoting, junctions, inherited credentials, and network paths. Sandbox and filesystem controls reduce risk but do not prove isolation.
