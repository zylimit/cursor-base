---
name: architecture-design
description: Designs or reviews module boundaries from business events and the seven principles; each decision becomes an ADR with its enforcing check, revisit condition, and reversal cost. Use for new modules or boundary changes.
---

# Architecture Design

The document holds **invariants** only — the decisions two independently built units would
otherwise make incompatibly. Everything else (stack details, directory trees, full data shapes) is
seed material that belongs to the code once code exists. An architecture the checks cannot see
decays silently; the catalog and `arch-check` keep design and code from drifting apart.

1. Write the envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
   Read the spec (functions, data ownership, integrations, failure consequences, scale, implicit
   compliance); with existing code, run `node scripts/harness.mjs repo-map` and `arch-check`
   first and ratify what is there — evolution mode draws the delta and the migration, never a
   rebuild. The DFX spec supplies quality scenarios as drivers (missing: mark "pending DFX" and
   route there at the end); the design brief supplies screen counts and complex interactions.
2. Size before designing (**S** single module, ≤5 functions, one person: a one-page sketch —
   paradigm, stack, directories, ≤3 decisions, one envelope line, one deferred line; **M** two to
   six modules with boundary needs: the full document, catalog optional; **L** seven or more
   modules, several people, or heading for hundreds of thousands of lines: the full document and
   a mandatory catalog skeleton wired to `arch-check`). Going up a tier needs a written reason.
   Ask two things before any style talk: *which module hurting for an hour hurts whom most*
   (failure consequence places the isolation boundary) and *what the team knows and how many
   maintain it* (team capability caps the style; two people on microservices is debt, not
   architecture). Choose coaching (draw decisions out with options) or fast (draft everything,
   mark inferences, let the user correct) — neither silently decides for the user.
3. Walk a **business event** before drawing modules: from the initiator and the trigger — who
   judges, who changes which fact, who receives the result, what downstream does with it — in
   business verbs first, then map to code responsibilities; departments, pages, tables, and
   deploy units are not modules by default. Fix **fact ownership**: for every shared fact the
   authoritative source, who may initiate a change, which module validates and writes, who only
   reads, which views derive from it; one decidable invariant per coordination need ("one slot
   cannot hold two valid bookings"). Then walk the **break points** on that path — duplicate
   request, concurrent update, external success with no local reply, half-done step, undo or
   correction — writing what was saved, who knows what, what the user sees, how a retry or a
   person continues; "unknown result", "rejected", and "completed" are three states, and
   compensation, undo, and appended correction are not one "rollback".
4. Let the candidates face the **same scenario**: extract the drivers (invariants, quality
   targets and their sources, team and legacy constraints, the unknowns that would change the
   choice), write the distinguishing scenarios (trigger, stimulus, environment, artefact,
   response, measure), and run the status quo or minimal option and each real alternative through
   identical inputs, load, faults, writes, and user outcomes. Name the **sensitive assumptions**
   (which load, capability, or maintenance condition flips the conclusion) and the cross-attribute
   costs (reliability bought with waiting, duplicate side effects, storage, privacy, operations);
   shared databases and control planes make failures correlated. Write the **refutation first**
   ("if we observe X, the recommendation shrinks or falls"), then pick the smallest experiment —
   document check, paper trace, local prototype, isolated fault or load test — and record it as
   *proposed* until it has actually run.
5. Judge with the **seven principles** — open-closed, dependency inversion, single responsibility,
   interface segregation, least knowledge, Liskov substitution, composite reuse — on real
   dependency edges and the violation signals in [REFERENCE.md](REFERENCE.md), and settle every
   dimension: paradigm with two or three named candidates and their trade-offs (modular monolith
   is the right default; services need an organisational or operational reason); module table
   (id, one-line responsibility, contract, depends on, forbidden, reason to change, intrinsic
   risk — the scale `docs/PROTOCOLS.md` §Tier vocabulary names, not an attribute tier);
   dependency rules and layers; data ownership; consistency conventions (naming, id and date
   formats, error envelope, logging, config, auth — one line each, reviewable); the **runtime and
   deployment envelope** in three states per item — decided / deferred / undecided — never blank;
   extension points for the known axes of change; deferred decisions with the condition to return.
6. Make every accepted decision enforceable: declare it in `harness/module-catalog.json`
   (`dependsOn`, `forbiddenDependencies`, `layers`, `provides`), and write one ADR per decision
   (`templates/adr-template.md`) with context, drivers, options and their costs, the decision,
   consequences, rejected options with reasons, `Enforced-by:` naming a real check (`adr-check`
   fails phantoms), `Revisit-if:` as an observable condition ("daily actives above 50k", "a third
   maintainer joins", "the vendor stops maintaining it" — never a date), and `Reversal:` as what
   undoing costs ("swap the ORM: twelve files in storage plus one data migration, about three
   days"); a reversal nobody can write is a **one-way door** — say so, list it, and put it in
   front of the user, because irreversible choices are not made at reversible speed.
7. Prove it holds: `node scripts/harness.mjs arch-check`, `catalog lint`, and `adr-check` must
   pass (a new project's unmapped paths are expected and said so); `progress.md` receives the
   decisions with their rejected alternatives. Then point at `dfx-design` (tiers per module) and
   `dev-plan` (phases along module boundaries).

Sufficient when: style chosen with a rejected alternative; every module passes the
reason-to-change test; the dependency graph is acyclic with forbidden edges listed; conventions
cover at least naming, data format, and error handling; the envelope has a state per item; at
least three ADRs carry all their fields; every invariant answers "would two independent units
choose incompatibly?" and everything that does not has moved to deferred. A brownfield
architecture that is a mess is registered honestly: inherited edges are declared as what is, with
an ADR naming the condition for their removal; cycles and forbidden edges are never declared away
and stay failing until the code changes (`arch-check` has no baseline).

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**.

Load [REFERENCE.md](REFERENCE.md) for the principles with review questions and enforcement, the
walkthrough and evaluation methods with a worked case, state ownership, brownfield rules, and
pressure cases; the document shape is `templates/architecture-design-template.md`.
