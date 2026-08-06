---
name: service-operations
description: Runs development services under harness supervision with crash restart, health probes, and a restart-storm breaker; diagnoses crashed or dead services from their state and logs. Use for dev servers, watchers, local daemons, or when a supervised service is reported crashed or dead.
---

# Service Operations

1. Declare the service in `harness/services.json`: command, optional health probe URL, restart
   budget. Configuration errors fail at load, not at restart number seven.
2. Start with `node scripts/harness.mjs service start <name>`. Success is reported only after
   the supervisor's pid answers a liveness check — "started" with a dead pid is a false green.
3. Observe with `service status` (liveness is read from pids, never from recorded state) and
   `service logs <name>`; supervisor events are interleaved in the same log with timestamps.
4. When a service is `crashed`, the breaker tripped: the fault is not transient. Read the log,
   follow root-cause-debugging, and only restart after the cause is fixed.
5. Stop with `service stop <name>`; it confirms both supervisor and child are dead before
   reporting stopped.

The supervisor only terminates processes it started itself. It is a development-time guardian,
not a production init system — production supervision belongs to the platform (systemd,
Kubernetes, or equivalent).

Return the standard receipt: **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the state model, breaker semantics, health-probe rules,
and incident playbooks.
