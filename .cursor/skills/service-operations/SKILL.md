---
name: service-operations
description: Runs development services under harness supervision with crash restart, health probes, and a restart-storm breaker; diagnoses crashed or dead services. Use for dev servers, watchers, and local daemons.
disable-model-invocation: true
---

# Service Operations

## Task

Run a declared development service under the supervisor, or diagnose one that is crashed or
dead. This is not a production init system.

## Preconditions

- Service declared in `harness/services.json`: command, optional health probe URL, restart
  budget. Configuration errors fail at load.
- Invoke by name. Killing a process always stops for the user.

## Invariants

- The supervisor only terminates processes it started itself.
- Success is reported only after the supervisor's pid answers a liveness check. "Started" with
  a dead pid is a false green.
- `crashed` means the breaker tripped. The fault is not transient. Do not restart until the
  cause is fixed.
- Production supervision belongs to the platform.

## Method

1. Declare the service. `node scripts/harness.mjs service start <name>`.
2. Observe with `service status` (pids, never recorded state) and `service logs <name>`.
3. On `crashed`, read the log, follow `root-cause-debugging`, then restart.
4. `service stop <name>` confirms both supervisor and child are dead before reporting stopped.

Accept: pid-true status, a named probe. Reject: `kill` of an unrelated pid; treating a port
release as the diagnosis.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the state model, breaker, and incident playbooks.
