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

- **Scenarios, not adjectives**: a quality requirement is six elements — source, stimulus,
  environment, artefact, response, response measure ("at payment peak, when the downstream times
  out, the order module degrades to a queue and recovers within 30s with error rate below 0.1%").
  A scenario is testable; an adjective is not.
- **Loss first**: targets are derived from who is hurt, when, how much, and how they cope today —
  not from a generic SLA. "How many nines?" is not a question a business person can answer;
  "after how long a wait do staff fall back to the phone?" is.
- **Tier economics**: uniform strictness is a defect. Tier per module × dimension; `none` and
  `minimal` carry a written reason; a prototype does not pay a payment system's bill; an empty
  row is good news, not a gap to fill with invented measures.
- **Trade-offs made visible**: dimensions fight (performance ↔ modifiability, cost ↔ reliability,
  security ↔ serviceability). Conflicts force an ordering; the sacrificed side and its reason are
  recorded; "all of them" is refused.
- **Implicit compliance first**: the law is a requirement the moment the word appears (personal
  data, money, health, minors, accessibility); the user did not omit it, they assumed you knew.

## Thirteen dimensions

Definition in software terms, typical measures, design means, verification landing point, and the
catalog attribute it becomes. A project without a catalog skips the attribute column and keeps
tier, measure, means, landing point. Walk each one; N/A with a reason is a valid answer.

| # | Dimension | Meaning | Typical measures | Design means | Verification | Attribute |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Reliability | continuous, stable, fault-free execution under stated conditions and time | MTBF, error rate, data-consistency pass rate | idempotency, transaction boundaries, input validation, no swallowed errors | regression, mutation, contract checks; `fitness` no-silent-failure | `reliability` |
| 2 | Resilience | recovery after faults: early detection, fast recovery, concurrency tolerance, auto-restart | MTTR, RPO/RTO, error rate at peak concurrency | the latency and retry budget (below), breaker, rate limit, supervised services | budget arithmetic, load adapters, breaker tests, `service` supervision | `resilience` |
| 3 | Security | prevention of unauthorised access, damage, eavesdropping, tampering | critical vulnerabilities = 0, secret-scan hits = 0, CVE closure time | least privilege, input sanitising, externalised secrets, audit log | SAST / SCA / secret adapters; `fitness` secret rules; the threat table | `security` |
| 4 | Functional safety | failure does not harm people, environment, or equipment | dangerous-failure rate, fail-safe coverage | failure-mode analysis ("what does it hurt when it breaks?"), double confirmation, safe defaults | fail-closed hooks, approval tiers, dedicated tests | `safety` |
| 5 | Privacy | lawful collection, use, storage, destruction of personal and business data | PII inventory coverage, PII in logs = 0, deletion SLA | data classification, minimisation, anonymisation, a privacy boundary module | `fitness` PII rule, `forbiddenDependencies`, `retention` | `privacy` |
| 6 | Performance | latency, throughput, footprint | P95/P99, QPS, memory and CPU caps | budget decomposition per layer, caching, batching | load adapters (runtime class, time-window bound) | `performance` |
| 7 | Serviceability | operators can see, locate, intervene | time to locate a fault, logs/metrics/traces coverage, alert false-positive rate | structured logs, health endpoints, diagnostic commands | health probes, `service status`/`logs`, `risk` scan, drills | `availability` or a custom check |
| 8 | Installability | installs, upgrades, uninstalls cleanly | fresh-install steps and time, upgrade success rate, rollback feasibility | one-command install, idempotent install, externalised config, replayable migrations | clean-environment install test; `manifest --check` | — (acceptance table) |
| 9 | Testability | state injectable, results observable, behaviour deterministic | mockable-boundary ratio, test runtime | dependency injection, injectable clock and randomness, pure core, seams | `test-design` infrastructure probe, coverage trend | `maintainability` (supporting) |
| 10 | Modifiability / extensibility | change cost does not grow with time | files touched per typical change; undeclared-edge trend (ratchet: only down) | the seven principles, stable contracts | `arch-check`, layers, forbidden edges; review | `maintainability` |
| 11 | Normalisation | one solution per class of problem | duplicate wheels, stack count, component variants per function | shared library sinks, a technology radar, one scaffold | review; SBOM / dependency audit adapters | `maintainability` |
| 12 | Cost | development, run, maintenance cost visible and bounded | monthly cloud bill, full CI build time, modules per maintainer | tier economics, scale on demand, hot/cold tiers | bill dashboard, CI time trend; `gate-audit` names hook gates that never intervened | — |
| 13 | Energy efficiency | compute and power per unit of work | CPU-seconds per thousand requests, idle footprint, batch completion within window | scale on demand, idle throttling, batching, push over poll | resource monitoring trend | — |

Normalisation is not the elimination of every similar implementation: two things that look alike
but change for different reasons stay separate; the metric is a clue, not a target. Installability
never promises universal rollback: an irreversible transformation states its stop point, backup or
forward-fix path, the data that may be lost, and the verification.

## ISO/IEC 25010:2023 mapping

One word means one thing across spec, architecture, and gates. DFX keeps what it can measure;
function and interaction belong to the spec and the design brief.

| 25010 characteristic | Sub-characteristics | Kept by |
| --- | --- | --- |
| functional suitability | completeness, correctness, appropriateness | spec success criteria and functions; DFX does not repeat |
| performance efficiency | time behaviour, resource use, capacity | dimensions 6 and 13 |
| compatibility | co-existence, interoperability | interoperability → architecture contracts; co-existence → dimension 8 |
| interaction capability (was usability) | recognisability, learnability, operability, error protection, engagement, inclusivity, assistance, self-descriptiveness | design brief accessibility floor, eight states, copy — DFX cites the brief's ids |
| reliability | faultlessness, availability, fault tolerance, recoverability | dimensions 1, 2, 7 |
| security | confidentiality, integrity, non-repudiation, accountability, authenticity, resistance | dimension 3 and the threat table; accountability → audit log |
| maintainability | modularity, reusability, analysability, modifiability, testability | dimensions 9, 10, 11 |
| flexibility (was portability) | adaptability, scalability, installability, replaceability | dimensions 8 and 10; scaling numbers into the performance budget or resilience scenarios |
| safety (new in 2023) | operational constraint, risk identification, fail safe, hazard warning, safe integration | dimension 4 — the five sub-characteristics are its checklist |

Privacy (5) and cost (12) are not 25010 characteristics: privacy is driven by law, cost is the
DFX tradition's own — both kept, mapped as "—".

## From loss to a target

**Find the situation that hurts someone.** From the real task: the user gets no feedback, the
result is unclear, key data is lost, someone sees what they must not, an upgrade stops work. Name
the affected people, the business window, the loss, the current remedy; separate redoable work,
unrebuildable data, wrong external actions, unacceptable harm. No incident record is not zero
risk.

**Write the scenario as a decidable condition.** "Under environment or load → stimulus → which
business result must hold → observed how". Performance descends from one task's acceptable wait
to the chain that serves it; recovery from what can be remedied to a recovery time and an
acceptable loss window. Security, safety, and privacy may be stated as assertions (a given role
cannot read data outside its permission); nobody invents a vulnerability count to look
quantitative.

**Separate commitment, candidate, baseline.** A commitment cites the requirement, contract, or
user decision; a baseline cites the measurement command, time, environment; an agent's proposal
says "candidate" with basis and cost. Unmeasured is written "unmeasured", never zero; an unknown
target is not "currently failing"; an executed FAIL is never rewritten as "target unknown".

**Let the measurement answer the question.** Sample and data size, concurrency or business
window, hardware and network, start and stop events, statistical window, denominator, pass
condition, result ownership. "Saving is fast" separates keeping a local draft from server
acceptance; a fast button does not prove the data is safe. Define the user outcome first, then
choose the collection: a server log cannot see requests that never arrived; a provider's "accepted"
may not be delivery. State collection point, how retries, cancellations, and unknown results are
counted, late events, sampling, and blind spots; an empty sample or a broken denominator never
reports 100%.

**Denominators and windows that keep the failures.** Observation unit — a user intent, a request
attempt, a record, a time slice — are different counts; retries add attempts but not intents.
Correct-result set — a rule-based rejection can be correct service, a wrongly rejected valid
request cannot be excluded by its status code. Start and stop — user starts, request sent, server
receives, transaction commits, user can query, provider receives, device receives, person reads.
Window attribution — by start or by completion; late completions after recovery; never move
unfinished work out of the denominator. Cancellation, timeout, unknown — counted as they were
defined in advance; a timeout may have saved. Collection blind spots and sampling bias — devices,
low-frequency high-importance tasks, failure paths that vanish in aggregates; personal data
collection obeys privacy.

**Compare improvement with its cost.** Map each target to the concrete mechanism and its owning
module; say which loss it reduces and what waiting, resources, maintenance, or privacy it adds
and which failures it still leaves. Check normal, stress, failure, recovery, and change conditions
where they distinguish; check whether retries, caches, persisted jobs, logs, or fallbacks damage
other attributes. Shared dependencies correlate failures — availabilities do not multiply. Error
budgets and fast-lane evidence loans are different things; a protected attribute never becomes
"a little breach allowed".

## Cross-attribute costs

Caching reduces waiting but stale data changes human decisions and can leak across permission
boundaries. Retries increase the chance of completion but amplify fault traffic, cost, and
duplicate external effects. Persisted tasks preserve obligations but add state maintenance,
backlog diagnosis, cleanup, and shared-database load, and never imply exactly-once delivery. Finer
logging helps diagnosis but may capture personal data and secrets and extend retention. Shared
components cut the cost of changing a common rule but bind unrelated reasons to change together.

## Service, task experience, and accessibility are three things

Service availability asks whether a legitimate task gets the correct service result under the
agreed conditions; usability asks whether a representative person recognises the entry, completes
the task, understands the result, recovers from errors; accessibility asks whether users with
disabilities meet barriers on the actual task. They get separate observations and evidence; none
proves another. They stay evaluation viewpoints inside the DFX document — the catalog keeps its
eight attributes and six tiers.

## Dimension checklist (enforcement view)

The same thirteen dimensions, same numbers, read from the enforcement side; dimensions marked
"review" have no runtime check here — they are evaluated in design review and recorded in the ADR
or the plan, which is an honest boundary, not a gap to hide. A dimension appears in exactly one
row: repairability is serviceability read at fault time, reproducible builds are part of
installability.

| # | DFX dimension | Core question | Where it becomes enforceable |
| --- | --- | --- | --- |
| 1 | Reliability | Does it keep working, and fail predictably under stated conditions? | `reliability` attribute; tests, mutation, contract checks |
| 2 | Resilience | Does it recover — restart, backoff, breaker, degradation path? | `resilience`, `availability`; supervised services, runtime probes, load checks |
| 3 | Security | Unauthorized access, tampering, exfiltration prevented and evidenced? | `security` attribute; fitness secret rules, SAST/SCA/secret adapters, hooks |
| 4 | Functional safety | On failure, is harm to people, environment, or equipment bounded? | `safety` attribute; destructive-op gating, fail-closed hooks, approval tiers |
| 5 | Privacy | Data minimized, redacted, retained on schedule, destroyed on schedule? | `privacy` attribute; PII fitness rule, `forbiddenDependencies` boundaries, `retention` |
| 6 | Performance | Stated latency/throughput/footprint targets under stated load? | `performance` attribute; load adapters (runtime-class, time-window bound) |
| 7 | Serviceability | Can an operator see state, read logs, intervene safely — and how fast is a fault isolated with its evidence preserved? | `service status`/`logs`, health probes, `risk` scan, evidence files, quarantined state, breaker semantics; review for product services |
| 8 | Installability | Clean install, upgrade, uninstall without clobbering user state — from a reproducible build of a verifiable artifact? | install/upgrade preserved-file behavior; `manifest --check` integrity, `runtime-sync`; CI matrix |
| 9 | Testability | Can each requirement be exercised deterministically and in isolation? | `maintainability` (supporting); module boundaries in the catalog, per-module `verification` |
| 10 | Modifiability / extensibility | Can the next change land without touching working code? | `maintainability`; `arch-check`, `layers`, `forbiddenDependencies` |
| 11 | Normalisation | Does it reuse the platform's existing patterns instead of inventing parallel ones? | review against the module catalog and existing contracts |
| 12 | Cost | What does each raised tier cost per change, and who pays it? | review; `gate-audit` names hook gates that ran without ever intervening — removal stays a human decision |
| 13 | Energy efficiency | Compute and power per unit of work bounded? | review; resource monitoring trend |

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

## Review mode scorecard

Per dimension: **met** (means and a verification landing point exist), **at risk** (means without
verification, or no measure), **gap** (no means). Each risk or gap gets one minimal remediation
pointed at a concrete module and landing point. The review evaluates and never edits; remediation
belongs to `architecture-design` (means) or `dev-plan` (schedule). With a catalog, run `quality
attributes`, `arch-check`, and `fitness --all` first and lay the human judgement on top of the
machine facts.

## Pressure cases

- "Make everything critical": refuse with the cost table. Tier inflation is how check systems
  die; the tiers exist so a prototype and a payments module are not held to the same bar. If the
  user insists, do it and record the cost in the DFX spec.
- "We will add the checks later": declare the tier now anyway — the uncovered gap is then
  visible in `quality attributes` output instead of living in a document nobody re-reads.
- "The tool for this attribute is not installed": wire it anyway; the check reports BLOCKED,
  which is the true state. A missing tool must never read as a pass.
- "It just has to be usable": pick a real task; define whether the person recognises the next
  step, knows the result, recovers from an error; discuss completion rates only with real
  samples; a `manual:` note is a pending check, never the fresh PASS an attribute gate needs.
- "Most dimensions fail on the existing project": record baselines and gaps honestly into the
  plan's backlog; never lower a target to exactly the current behaviour to "pass".
- "Small project, no catalog": record the overall targets and the module-ownership gap in the
  spec; no invented modules, no claim that an unenabled attribute gate verified anything.
