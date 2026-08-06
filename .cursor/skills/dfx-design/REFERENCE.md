# DFX Design Reference

## First principles

- **Measurable**: a `critical`/`high` rating without a number or an observable criterion is a
  wish. "P99 under 200ms at 500 rps", "restarts within 5s after a crash", "no personal data in
  any log line" are targets; "fast", "robust", "secure" are not.
- **Verifiable**: a target with no named verification is treated as unmet. The verification is
  a check in the matrix — built-in (`fitness`, `arch-check`) or an adapter tool — that claims
  the attribute.
- **Contradiction outranks confirmation**: one check proving the property absent outweighs
  another suggesting it present. Coverage requires a pass and no contradicting failure.
- **Honest degradation**: when the target cannot be met, lower the declared tier with a written
  reason. Rewriting the target to match the current behavior is falsification, not iteration.
- **Cost symmetry**: each raised tier must state what it adds to per-change verification cost.
  If a gate never fires, `gate-audit` will say so; remove it or justify it.

## Dimension checklist

Rate each dimension; the mapping column shows where the rating becomes enforceable. Dimensions
marked "review" have no runtime check here — they are evaluated in design review and recorded
in the ADR or the plan, which is an honest boundary, not a gap to hide.

| DFX dimension | Core question | Where it becomes enforceable |
| --- | --- | --- |
| Reliability (可靠性) | Does it keep working, and fail predictably under stated conditions? | `reliability` attribute; tests, mutation, contract checks |
| Availability / resilience | Does it recover — restart, backoff, breaker, degradation path? | `resilience`, `availability`; supervised services, runtime probes, load checks |
| Serviceability (可服务性) | Can an operator see state, read logs, and intervene safely? | `service status`/`logs`, health probes, `risk` scan; review for product services |
| Installability (可安装性) | Clean install, upgrade, uninstall — without clobbering user state? | install/upgrade preserved-file behavior; `manifest --check` integrity |
| Testability (可测试性) | Can each requirement be exercised deterministically and in isolation? | `reliability`; module boundaries in the catalog, per-module `verification` |
| Modifiability / extensibility (可修改性) | Can the next change land without touching working code? | `maintainability`; `arch-check`, `layers`, `forbiddenDependencies` |
| Repairability (可维修性) | When it breaks, how fast to isolate the fault? Evidence preserved? | evidence files, quarantined state, breaker semantics; review |
| Normalization (归一化) | Does it reuse the platform's existing patterns instead of inventing parallel ones? | review against the module catalog and existing contracts |
| Manufacturability (可制造性) | Is the build reproducible and the artifact verifiable? | `manifest --check`, `runtime-sync`; CI matrix |
| Cost (成本) | What does each raised tier cost per change, and who pays it? | review; `gate-audit` retires gates that never earn their cost |
| Security (安全性 – Security) | Unauthorized access, tampering, exfiltration prevented and evidenced? | `security` attribute; fitness secret rules, SAST/SCA/secret adapters, hooks |
| Functional safety (安全性 – Safety) | On failure, is harm to people, environment, or equipment bounded? | `safety` attribute; destructive-op gating, fail-closed hooks, approval tiers |
| Privacy (隐私) | Data minimized, redacted, retained on schedule, destroyed on schedule? | `privacy` attribute; PII fitness rule, `forbiddenDependencies` boundaries, `retention` |
| Performance (性能) | Stated latency/throughput/footprint targets under stated load? | `performance` attribute; load adapters (runtime-class, time-window bound) |

## Rating output format

For each module, record in the plan or ADR:

```text
Module: <catalog id>
Dimension ratings:
  reliability: high — target: <measurable>; means: <design>; verify: <check id>
  security: critical — target: ...; means: ...; verify: ...
  availability: none — reason: library module with no service surface
  ...
Cost note: what the raised tiers add to each change's verification.
```

Then declare the tiers in `harness/module-catalog.json` and confirm with
`node scripts/harness.mjs quality attributes` that every blocking tier has a claiming check.
`none` and `minimal` require the written reason in the catalog itself — opting out is allowed,
silent drift is not.

## Pressure cases

- "Make everything critical": refuse with the cost table. Tier inflation is how check systems
  die; the tiers exist so a prototype and a payments module are not held to the same bar.
- "We will add the checks later": declare the tier now anyway — the uncovered gap is then
  visible in `quality attributes` output instead of living in a document nobody re-reads.
- "The tool for this attribute is not installed": wire it anyway; the check reports BLOCKED,
  which is the true state. A missing tool must never read as a pass.
