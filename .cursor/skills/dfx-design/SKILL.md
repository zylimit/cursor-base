---
name: dfx-design
description: Derives measurable quality targets (DFX) from business loss across thirteen dimensions, with threat and compliance tables, latency budgets, and wired checks, or scores a design. Use at design time.
---

# DFX Design

DFX (Design for eXcellence) evaluates a design; it does not generate one. It decides whether the
design is good enough on each dimension and what evidence will prove it. Quality attributes are
cheapest at design time and most expensive retrofitted. **Design-in mode** produces `DFX-Spec.md`
and wires the tiers into the catalog; **review mode** scores an existing design and changes no
file.

1. Write the envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
   Requires the spec; the architecture design lets tiers be set per module (without it, tier
   globally and mark "refine per module after architecture"); the design brief carries the
   interaction-capability floor (accessibility, responsiveness, the eight states) so DFX cites it
   rather than restating it; `harness/module-catalog.json` receives the tiers when it exists.
2. Scan for **implicit compliance** before any dimension: personal data, phone numbers, identity
   documents, location → data-protection law; payments, funds, invoices, reconciliation → card
   and anti-money-laundering rules; health, diagnosis, devices → medical software standards;
   minors → consent and time-limit rules; public services → accessibility law; approvals,
   signatures, audit → electronic-signature and record-keeping law; open-source redistribution →
   licence terms; cryptography → export and national rules. A word appearing makes the law a
   requirement the user did not have to state; confirm current versions against official sources;
   hits enter the compliance table and are written back to the spec with its changelog.
3. Walk the **thirteen dimensions** — reliability, resilience, security, functional safety,
   privacy, performance, serviceability, installability, testability, modifiability,
   normalisation, cost, energy efficiency — one at a time, each as a six-element scenario (source,
   stimulus, environment, artefact, response, response measure) with a measurable target, the
   design means that achieves it, and the verification that will evidence it; "highly reliable"
   is a wish, "error rate < 0.1% weekly" is a target. Not applicable is written as N/A with a
   reason; small projects write one line per dimension ("stimulus → response → measure") and
   expand only `critical` and `high`. Derive targets from **loss**: who is hurt, in which
   business window, what they lose, what the current remedy is — "how many nines" is not a
   question a business person can answer, "which step of waiting makes staff fall back to the
   phone" is.
4. Fill the tables the dimensions demand: the **threat table** when any of nine triggers appears
   (file access outside the project, network or external API, secrets, user- or AI-generated
   HTML, command execution, delete / overwrite / publish, large-file or media parsing, iframe or
   message bridges, long tasks with concurrent write-back) — one row per hit (asset, entry,
   threat, impact, mitigation, verification, linked id); the **latency and retry budget** for
   resilience — every layer's budget sums to at most the end-to-end budget, exactly one layer
   retries (retries multiply across layers: five layers × three attempts is 243 calls), each
   layer's attempts × timeout fits its own budget; the **AI addendum** when the spec has an AI
   section — autonomy level (L0 suggest / L1 draft then confirm / L2 act, reversible / L3 act,
   irreversible; L3 needs a written reason and its own approval gate), approval gates (send
   externally, spend, alter data, reach third parties — the same list as the design brief's
   approval surface), circuit breaker (error rate, cost per call, consecutive failures, runtime),
   cost cap (per call and per day, and what happens past it), traceability (input, output, model
   and prompt versions, replayable). Before performance, do the three sums: capacity (QPS = daily
   requests / 86400, peak ≈ 10×, storage = row bytes × daily writes × retention × replicas),
   queueing (tail latency ≈ 1/(1−ρ) — at 80% utilisation five times the idle value), fan-out
   (P(at least one slow) = 1 − (1−p)^N; N = 50, p = 1% gives 39%) — and mark each number as
   computed or guessed.
5. Tier **per module × dimension** (`critical`, `high`, `medium`, `low`, `minimal`, `none`; the
   last two with a written reason) using three questions — "this module down for an hour: what is
   lost?", "its data leaks: which headline?", "who gets up at night to fix it?" — then order the
   **priority stack** (for example security > reliability > cost > performance) the user confirms,
   so later conflicts resolve without renegotiation. Raising a tier states the verification cost
   it adds to every future change of that module; lowering a target to match current behaviour is
   falsification, not iteration.
6. Wire it — but map first: the catalog's vocabulary is eight attributes (`security`, `safety`,
   `privacy`, `reliability`, `resilience`, `availability`, `performance`, `maintainability`), not
   thirteen dimensions, and any other name is an `UNKNOWN_ATTRIBUTE` finding that `catalog lint`
   and `validate` reject. Map each dimension onto its attribute using the dimension table's last
   column in [REFERENCE.md](REFERENCE.md); a dimension with no attribute (installability, cost,
   energy efficiency) stays in `DFX-Spec.md` with its acceptance test and is never declared.
   Then declare tiers in `harness/module-catalog.json` `attributes`; make a matrix check claim
   each `critical`/`high` attribute (`node scripts/harness.mjs adapters list --attribute <x>`
   shows curated tools; `adapters add` wires one); `node scripts/harness.mjs quality attributes`
   must show the tiers covered or honestly uncovered; `catalog lint` accepts the declarations. A
   declared attribute no check claims is a visible gap, not a plan; a missing tool is `BLOCKED`,
   never a pass.
7. Generate `DFX-Spec.md` from `templates/dfx-spec-template.md` (a compliance table with no hits
   says "scanned, none: <words scanned>" rather than standing empty); tier decisions and the
   priority stack go to `progress.md`; hand to `dev-plan` so each dimension's verification lands
   in the phase that delivers it, never all in the last phase. **Review mode** instead scores each
   dimension *met* (means and verification exist) / *at risk* (means without verification, or no
   measure) / *gap* (no means), one minimal remediation per gap pointed at a module and a landing
   point; it evaluates and never edits — remediation belongs to `architecture-design` or
   `dev-plan`; with a catalog, `quality attributes`, `arch-check`, and `fitness --all` supply the
   machine facts first.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**.

Load [REFERENCE.md](REFERENCE.md) for the dimension table with definitions, measures, means and
landing points, the ISO/IEC 25010:2023 mapping, the loss-to-target method, measurement semantics
(denominators, windows, blind spots), cross-attribute costs, and pressure cases.
