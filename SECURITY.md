# Security Policy

## Reporting

Do not open a public issue containing exploit details, credentials, personal data, or sensitive repository content. Report vulnerabilities through the repository host's private security-reporting channel. If no private channel is configured, contact the maintainers privately before disclosure.

Include the affected version or commit, impact, reproduction steps, and a minimal remediation suggestion when possible.

## Operating guarantees

Safety controls are not quality gates and cannot be waived. Agents must stop or escalate before destructive operations, privilege changes, secret exposure, unapproved network publication, or ambiguous ownership.

Quality checks may be temporarily waived only under the recorded contract in `docs/GOVERNANCE.md`; a waiver never permits bypassing safety controls.

The harness does not automatically push, commit, kill processes or ports, overwrite user work, install dependencies, or change global configuration. Windows sandboxing, filesystem permissions, ignore files, and worktrees are defense-in-depth controls, not absolute isolation boundaries.

## Supported versions

Security fixes are applied to the current maintained release line. Users should reproduce findings against the latest available revision before reporting.
