# Architecture Design template

Default filename `Architecture-Design.md` at the project root. The document holds invariants
only; the machine-executable half of every dependency rule lives in `harness/module-catalog.json`
and is checked by `node scripts/harness.mjs arch-check`; when the two disagree, the check and the
catalog win and the document is corrected. S-tier projects keep §1, a short §2 table, one line in
§7, at most three ADRs in §8, and one line in §9, and delete the rest.

---

# Architecture Design — <project>

> Generated <date> · Tier S / M / L · Path coaching / fast · Status: pending approval
> Related requirements: <spec version and sections, or the agreed source>

## 1. Overview

- **Style and paradigm**: <modular monolith / hexagonal / event-driven / …>, paradigm <name>,
  its layers mapped to directories <api/ → adapters, domain/ → core …> (rejected: <X>, see ADR-1)
- **Stack** (versions checked against current documentation and pinned):

| Name | Version | Role |
| --- | --- | --- |

- **Data flow in one sentence**: where a request enters → which modules → where it lands
- **System context** (C4 level 1): a valid diagram of users, this system, external systems

### Drivers and quality scenarios

Invariants that must hold, negotiable targets, real constraints, and the unknowns that would
change the choice — each with its source. Why these scenarios are analysed first is stated; this
ordering is not an assurance tier and excludes no protected attribute.

| Scenario and rule source | Trigger / stimulus | Environment and affected object | Expected result and how it is judged | Unknowns and their impact |
| --- | --- | --- | --- | --- |

### Business walkthrough and fact ownership

Representative event → business actions → authoritative data changes → consumer and user results,
with rule sources. A single module may do this in one paragraph.

| Business fact / invariant | Authoritative source and who may initiate a change | Validating and writing module | Read-only consumers and their consistency promise |
| --- | --- | --- | --- |

| Exception or correction on the path | What had already happened | What the user sees | Recovery owner and method | Basis / open scope |
| --- | --- | --- | --- | --- |

State ownership when interaction or asynchronous work is involved: authoritative fact, transient
UI, view preference, request or task, asset — owner, lifetime, consumers, version and intent; how
an old result arriving over a new edit is kept, applied, or flagged.

## 2. Modules

| Module id | Responsibility (one line) | Contract | dependsOn | forbidden | Reason to change (SRP test) | Intrinsic risk (low / medium / high) |
| --- | --- | --- | --- | --- | --- | --- |

**Container view** (C4 level 2; the diagram is the rule — who may depend on whom).

## 3. Dependency rules

- **Layers** (outer → inner, dependencies only inward): <api> → <service> → <domain> ← <storage implements domain ports>
- **Forbidden edges**: <analytics ✗→ pii-store (privacy boundary)>, …
- **Data ownership**: <table X belongs to module A as single writer; others read through A's contract>

## 4. Consistency conventions

| Concern | Convention (the defaults two independent builders would otherwise each invent) |
| --- | --- |
| naming (entities / files / interfaces / events) | |
| data and formats (ids / date-time / money / error shape / response envelope) | |
| state and cross-cutting (change method / error handling / logging / config / auth) | |

## 5. Extension points (open-closed)

| Axis of change | Mechanism | What changes when one more kind arrives |
| --- | --- | --- |

## 6. Key scenario walkthroughs

Two or three of the most important or hardest cases traced across the module diagram (data flow
and call chain; a sequence diagram where it helps), proving the boundaries move.

## 7. Runtime and deployment envelope

| Item | State | Content / condition to return |
| --- | --- | --- |
| environments (local / test / production) | decided / deferred / undecided | |
| deployment topology (single host / containers / several instances) | decided / deferred / undecided | |
| infrastructure and vendors (cloud / on-premises / managed database) | decided / deferred / undecided | |
| operations (logs / monitoring / backup / release and rollback) | decided / deferred / undecided | |

## 8. Decisions (ADR index)

Candidates on the same scenario, the rule each keeps or breaks, sensitive assumptions and
cross-attribute cost, the choice and the state of its evidence:

| Candidate (incl. status quo / minimal) | Facts and results on the same scenario and break point | Rule kept or broken | Sensitive assumptions and cross-attribute cost | Choice and evidence state |
| --- | --- | --- | --- | --- |

| ADR | Decision | Enforced-by | Revisit-if | Reversal |
| --- | --- | --- | --- | --- |
| docs/adr/0001-*.md | | | | |

Legacy changes: old and new contract coexistence conditions, data migration and rollback
feasibility, operator, verification — an irreversible business action is never written as a
simple rollback.

## 9. Deferred decisions

| Decision | Why it can wait | Condition to return |
| --- | --- | --- |

## 10. Over-tier justifications

Only when exceeding the tier's default depth; an empty table is good.

| Item | Why needed | Why the simpler option fails |
| --- | --- | --- |

## 11. Risks and technical debt

| Risk / debt | Source (ADR / deferred) | Condition to repay |
| --- | --- | --- |

## 12. Architecture acceptance

Design evaluation and minimal refutation experiments:

| Assumption / scenario | Observation that refutes or narrows the recommendation | Method, input, environment, break point, observation point | Executor / actual state / evidence | Impact on the decision and revisit condition |
| --- | --- | --- | --- | --- |

Engineering checks with the real commands, exit codes, and evidence:

```text
node scripts/harness.mjs catalog lint     # unmapped / overlap / cycle = 0
node scripts/harness.mjs arch-check       # 0 undeclared edges, 0 forbidden edges, 0 cycles (no baseline exists)
node scripts/harness.mjs adr-check        # phantom enforcement references = 0
```

These prove declarations, dependencies, and references; they do not prove the business confirmed
the rules, that the candidate is optimal, or that production performance is met.

## 13. Directory skeleton

Module → top-level directory (for the plan to use directly).

## 14. Glossary

| Term | Meaning | Spec correspondence |
| --- | --- | --- |

## 15. Seven-principle self-check

| Principle | Result | Note (a failing row gets its reason or its remediation) |
| --- | --- | --- |
| open-closed | | |
| dependency inversion | | |
| single responsibility | | |
| interface segregation | | |
| least knowledge | | |
| Liskov substitution | | |
| composite reuse | | |

## 16. Evolution (not in this version, but reserved)

## 17. Open items
