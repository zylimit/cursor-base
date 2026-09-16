---
name: dev-plan
description: Turns an approved spec into a phased plan ordered by value and risky unknowns, each task naming files, change, and verify command. Use after spec approval or when a spec change must be replanned.
---

# Dev Plan

A plan is a sequence of independently acceptable slices, each of which compiles, runs, and shows
something — never a phase that "writes a lot of code but nothing runs". The bounded-change planner
is `plan-change`; this skill plans a product from its spec. Default artefact `DEV-PLAN.md`; an
existing plan keeps its path and structure. A change that fits in one sentence needs no plan —
go straight to `scoped-implementation`.

1. Write the envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
   Requires the product spec; reads the architecture design (phases follow module boundaries),
   the DFX spec (each dimension's verification lands in the phase that delivers it; critical and
   high verification never waits for the last phase), the design brief and `DESIGN.md`
   (screen tasks by `SCREEN-n`; token wiring is the first UI task), and existing code (a
   constraint, and the trigger for iteration mode).
2. Read the spec's open-questions table and `[inferred]`/`[default]` items first. Questions due
   before this plan must be answered or, when nobody can be asked, built as "meanwhile do" says
   and listed under *Pre-flight* with the phase they are deferred to. A spec gap or contradiction
   found while planning is a **requirement in doubt** with a counter-example sent back to
   `product-spec`, not a requirement invented here.
3. Verify the stack before writing it down: framework and key dependency versions, compatibility,
   breaking changes — against current documentation, not memory. Record versions, never `latest`.
   A known environment with no selection or upgrade only needs the manifest and lockfile read.
4. Order by **value and unknowns first**: the core value flow (remove it and the product does not
   exist) with only the skeleton it needs, then the phases that test the riskiest assumptions
   (spec `[inferred]`/`[open]`/`[default]` items, an unfamiliar technology, an untried integration,
   a performance-sensitive path), then important, then supporting, then closing work (i18n,
   packaging, deployment). Dependencies are a correction to that order, never the axis: build the
   dependency graph, topologically sort it, and only move a phase when its prerequisite truly must
   come first. One feature at a time, finished, rather than several half-built in parallel.
5. Calibrate granularity: a phase delivers two to four items, touches three to eight key files,
   and is cohesive; over five items, over ten files, or three unrelated features means split;
   one trivial item means merge. The first value-flow skeleton may exceed the limit and says so
   under risks.
6. Write every task to the **worst-executor standard** — someone with no context, questionable
   taste, and no love of tests could still do it right: a concrete file path, the concrete change
   (which function, which field, which call), and one verify command (`tsc --noEmit`, a test
   file, a `curl`); never "implement the feature", "handle errors appropriately", "similar to
   task N", or `TBD`. Each task also carries its **Business Context** (why, who benefits, the
   rule and exception it must respect, one input→output example that separates right from wrong,
   open items and their impact) so a fresh implementer does not guess, and the harness inputs
   the orchestrator will use (`task start --owned … --risk …`, affected modules, attributes).
7. Every phase states the **assumptions it verifies** (or "none") with the evidence that would
   confirm them; every result has a **producer of its evidence** (where it is observed, which
   work makes it hold, who runs what to prove it, which fixtures or isolation it needs).
   Distinguish functional dependency from verification dependency; name the single writer and
   the integration owner for shared schemas, migrations, lockfiles, and generated files; a
   research spike ends an unknown and may conclude "no".
8. Self-check before saving: no placeholders; one name per function, type, field, and file
   across phases; every spec function has a task and every task has a spec basis; every
   `[inferred]`/`[open]` core item sits in some phase's assumptions or in *Pre-flight*. Formal
   specs with `REQ-` IDs: cite them in the task and check both directions (requirement without a
   task, task citing a non-existent ID). Ask the user only for a stack choice among several
   reasonable options, the phase-granularity preference, or an ambiguous priority.

Iteration mode: locate the change from the spec changelog, name the affected phases and tasks,
edit in place, leave completed phases (✅) untouched, re-check dependencies, and only *remind*
that phases with written code must be resynced by `phase-build` — never edit code from here.
Distinguish the user's new requirement from the agent's earlier misreading; a completed record
never certifies a new behaviour — add a correction task instead.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**.

Load [REFERENCE.md](REFERENCE.md) for the analysis dimensions, slicing and ordering methods, the
evidence-producer test, dependency classes, research tasks, and the handoff check; the artefact
template is `templates/dev-plan-template.md`.
