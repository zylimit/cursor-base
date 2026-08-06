# Service Operations Reference

## Configuration

`harness/services.json` (schema: `harness/schemas/services.schema.json`):

```jsonc
{
  "version": 1,
  "services": {
    "dev-server": {
      "command": "npm run dev",
      "cwd": ".",
      "health": {
        "url": "http://127.0.0.1:3000/healthz",
        "intervalSec": 15,
        "timeoutMs": 4000,
        "failureThreshold": 3
      },
      "restart": {
        "backoffMs": 500,
        "maxBackoffMs": 30000,
        "maxRestarts": 10,
        "windowSec": 600
      }
    }
  }
}
```

State lives under `.cursor/harness-state/services/<name>/`: `state.json` (atomic writes),
`service.log` (rotated at 5 MB, one generation kept), `stop.flag` (cross-platform stop
channel).

## State model

`service status` synthesizes from live pids, because recorded state can outlive the processes
(power loss, kill -9):

| Reported | Meaning |
| --- | --- |
| `running` | Supervisor and child pids both alive |
| `backoff` | Supervisor alive, child down, restart scheduled |
| `crashed` | Breaker tripped; supervisor exited deliberately; log holds the evidence |
| `stopped` | Stopped through the harness; both confirmed dead |
| `dead` | State says supervised, but the supervisor pid is gone — an abnormal end |
| `not-started` | No recorded state |

`crashed` and `dead` set a non-zero exit code and raise a high-severity finding in
`node scripts/harness.mjs risk`, which the sessionStart hook surfaces.

## Restart and breaker semantics

- Crash restart delays double from `backoffMs` up to `maxBackoffMs`.
- More than `maxRestarts` restarts inside `windowSec` trips the breaker: the service is marked
  `crashed` and the supervisor exits. A restart storm means the fault is not transient;
  failing visibly and keeping the evidence beats hammering the machine while the log rotates
  the cause away.
- A health probe failing `failureThreshold` consecutive times is treated as a crash: alive but
  not serving is an outage the exit handler never sees. The child tree is killed and the same
  backoff-and-breaker path runs.

## Incident playbooks

**Crashed (breaker tripped)**
1. `service logs <name>` — the first failure in the window is the cause; later entries are
   usually the same fault repeating.
2. Follow root-cause-debugging; reproduce the child command in the foreground if needed.
3. Fix, then `service start <name>`. Do not raise `maxRestarts` to make the symptom go away.

**Dead (supervisor gone without stopping)**
1. Check for an OS-level cause (reboot, OOM kill, manual kill).
2. `service status` confirms the child is also gone; if a child survived, `service stop <name>`
   cleans up using the recorded pid.
3. Restart; if it recurs, treat the supervisor exit itself as the defect to diagnose.

**Flapping health probe**
1. Confirm the endpoint is the right liveness signal — probing a route that does real work
   makes load look like death.
2. Tune `timeoutMs`/`failureThreshold` only with evidence from the log timestamps; hiding a
   real stall by widening the threshold converts an outage into a mystery.

## Boundaries

- Start and stop are explicit user-initiated commands; the harness never starts or kills a
  service on its own, and it never touches processes it did not spawn.
- Reclaiming a port owned by an unknown process stays an ask-first operation; identify the
  owner instead of killing by port.
- Production workloads are out of scope by design; supervise them with the platform's init
  system and keep this supervisor for development loops.
