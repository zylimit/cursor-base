# DFX Spec template

Default filename `DFX-Spec.md` at the project root. Tier semantics are the catalog's (`critical`,
`high` block completion; `medium` warns; `low`, `minimal` are recorded; `none` opts out with a
reason); the machine-executable half is `harness/module-catalog.json` `attributes`, checked by
`node scripts/harness.mjs quality attributes`. Small projects fill §1, §2, §3, §9 and delete the
rest. Numbers in the template are prompts, never project commitments.

---

# DFX Spec — <project>

> Generated <date> · Mode design-in / review · Tier S / M / L · Status: pending approval
> Related: <spec version and sections; architecture source>

## 1. Priority stack (earlier beats later in a conflict)

1. <security>
2. <reliability>
3. <cost>
4. <performance>

Reason: one sentence ("financial data: security beats everything; marketing season: cost beats
peak performance").

## 2. Dimension table (thirteen dimensions)

| # | Dimension | 25010 | Applies | Global tier | Scenario (six elements; S tier: stimulus → response) | Measure (number + unit + method) | Design means | Verification landing point |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Reliability | reliability · faultlessness | ✅ | high | | error rate < 0.1% (weekly report) | | mutation + regression |
| 2 | Resilience | reliability · fault tolerance / recoverability | | | | MTTR < 5 min | §3 budget + breaker + supervision | load adapter + breaker test |
| 3 | Security | security | | | | critical vulnerabilities = 0 (see §5) | | SAST / SCA / secret adapters |
| 4 | Functional safety | safety | N/A: pure information system, reason… | | | N/A | | |
| 5 | Privacy | — | | | | PII in logs = 0 | classification + forbidden edges | PII fitness rule |
| 6 | Performance | performance efficiency | | | | P95 < 200 ms | budget in §3 | load adapter |
| 7 | Serviceability | reliability · availability | | | | locate a fault < 10 min | structured logs + health endpoint | supervisor probe |
| 8 | Installability | flexibility · installability | | | | fresh install ≤ 3 steps | one-command idempotent install | clean-environment install test |
| 9 | Testability | maintainability · testability | | | | core logic 100% mockable at boundaries | injection + pure core | test infrastructure probe |
| 10 | Modifiability / extensibility | maintainability · modifiability | | | | typical change ≤ 3 files | seven principles + extension points | `arch-check` drift = 0 |
| 11 | Normalisation | maintainability · reusability | | | | one component per kind | shared library sinks | dependency audit |
| 12 | Cost | — | | | | full CI < 10 min; monthly bill < X | tier economics | CI trend / bill dashboard |
| 13 | Energy efficiency | performance efficiency · resource use | N/A: local tool, no resident process | | | N/A | | |

Interaction capability (25010): cite the design brief's accessibility and responsiveness items
and the required states per screen by id (`A11Y-n`, `SCREEN-n`); without a brief write "pending
design brief". The measure column carries a number or N/A on every row.

## 3. Latency and retry budget (mandatory for resilience)

| Layer | Budget (ms) | Timeout (ms) | Attempts | Backoff | Fallback on failure |
| --- | --- | --- | --- | --- | --- |
| browser (submit → acknowledgement) | 800 | 4500 | 1 | — | keep the draft, say the network is unreachable |
| API (auth + business rules) | 2200 | 1200 | 1 | — | 500 with a business id, one log line, no retry here |
| database (write + read) | 2000 | 600 | 2 | fixed 300 ms + idempotency key | both failed → raise; health endpoint turns red |
| end to end | 5000 | — | — | — | what the user sees after the total budget |

Exactly one layer retries; every other layer writes 1 attempt. Retries multiply across layers —
five layers × three attempts is 243 calls; "bounded retries" as four words stops nothing. No layer
retrying is a legitimate choice (manual resubmit with an idempotency key is often safer) but is
written on the end-to-end row. Each layer's attempts × timeout + backoff fits inside its own
budget; serial stages add, parallel stages take the longest step.

## 4. Implicit compliance scan

| Law / standard | Triggered by (spec word / field / audience) | Dimensions | Means | Verification | Written back to spec |
| --- | --- | --- | --- | --- | --- |
| <data-protection law> | <collects phone numbers and location> | privacy | <minimisation + separate consent + 90-day deletion> | <PII fitness rule + deletion SLA sampling> | <non-functional §n> |

No hits: one line "scanned, none: <words scanned>" — never an empty table.

## 5. Threat table (mandatory when any of nine triggers is hit)

Triggers: file access outside the project / network or external API / secrets / user- or
AI-generated HTML / command execution / delete · overwrite · publish / large-file or media parsing
/ iframe · postMessage · bridge / long tasks with concurrent write-back.

| THR | Asset | Entry | Threat | Impact | Mitigation | Verification | Linked id |
| --- | --- | --- | --- | --- | --- | --- | --- |
| THR-1 | <customer phone numbers> | <technician API> | <read another technician's tickets> | <privacy breach> | <authorise by ticket ownership> | <dedicated test + SAST rule> | <FLOW-2 / module dispatch> |

## 6. Quality-attribute scenarios (each critical / high dimension in full)

### Scenario R-1: <name>

- Source: · Stimulus: · Environment: · Artefact:
- Response: · Response measure: <number + unit>
- Result definition: <which fact or user result counts; distinct from HTTP success, a write, or provider acceptance>
- Target and basis: <commitment / confirmed new target / agent candidate — with source>
- Current baseline: <measured value, time, environment; "unmeasured" when none — never 0 or N/A>
- Collection: <where, which events, result ownership; who sees which result>
- Measurement conditions: <start and stop, sample, concurrency, hardware and network, window and denominator; observation unit; how retries, cancellations, unknowns, late events count>
- Blind spots: <requests that never arrived, only completed items observed, sampling, rare important flows>
- Refutation and actual state: <what observation overturns the target, means, or coverage claim; the minimal verification's environment, input, observation point; actual result — unrun stays unrun>
- Failure mode and degraded behaviour (safety and resilience): <how it fails without harming people, data, or equipment>

## 7. Tier per module (with an architecture design)

| Module | security | privacy | reliability | resilience | safety | performance | maintainability | availability | none / minimal reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <payments> | critical | high | high | high | minimal | | | | safety: pure information system … |

Only the six catalog tiers enter `attributes`; N/A, unevaluated, candidate, and unknown stay in
this document as status or gap and never delete an existing declaration.

## 8. AI product addendum (mandatory when the spec has an AI section)

| Item | Setting | Measure | Verification |
| --- | --- | --- | --- |
| autonomy level | <L1: draft, person confirms> | <auto-effective actions = 0> | <approval-surface test> |
| approval gates | <send externally / spend / alter data> | <executions without a person = 0> | <audit-log sampling> |
| circuit breaker | <error rate > 5% or 3 consecutive failures → stop> | <back to the manual path within 1 min> | <fault-injection drill> |
| cost cap | <per call ≤ N tokens, per day ≤ X> | <refusal rate past the cap = 100%> | <budget probe> |
| traceability | <input, output, model and prompt versions per action> | <replayable = 100%> | <replay test> |

## 9. Trade-offs (the sacrificed side, its reason, and over-tier justifications)

- <performance P99 relaxed to 500 ms in exchange for modifiability: no cache layer; revisit with v2 data>

## 10. Review scorecard (review mode)

| Dimension | Verdict | Basis | Minimal remediation |
| --- | --- | --- | --- |
| | met / at risk / gap | | |

## 11. Verification closure gaps

| Attribute / target | Gap and impact | Check or remedy and owner | State |
| --- | --- | --- | --- |
| | | | target pending / no check / not run / coverage incomplete / FAIL — none of them a pass |

## 12. Open items

- <adapter wiring: security → SAST adapter, pending the user's approval to install>
