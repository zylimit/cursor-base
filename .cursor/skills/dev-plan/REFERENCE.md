# Dev Plan Reference

## What to analyse

**Must** — without these the plan is a castle in the air: stack (framework and version, UI
approach, data store, package manager, deployment target, each checked against current
documentation); phase split into ordered, independently acceptable units; per phase a delivery
list written "user can do X → system does Y"; per phase the key files as concrete paths (a new
project derives them from the stack's conventions, an existing one from its tree); the feature
dependency graph and a phase order that never violates it.

**Should** — these make the plan land: database tables with the phase that creates each and its
purpose; per phase acceptance criteria (at minimum compiles, starts, the new feature works;
preferably existing features unbroken); known risks and limits ("phase 4 ships the configuration
UI only, the engine connects in phase 10" — that boundary stays written down and phase 4 is never
called connected).

**Not here** — left to implementation: function signatures and class shapes, CSS specifics,
test-case design, branch strategy. Public contracts and expected results are never left blank.

## Slicing and ordering

**Value first, dependencies as correction.** List the feature points, ask each "can it run alone;
what does it depend on", build the DAG, sort it. The sort gives the order that must not be
violated, not the phase order itself. The skeleton reaches exactly as far as the first value
flow needs; every other piece of infrastructure lands in the phase that first uses it. Then rank:
core value (without it the product is not a product) → important (with it the product is good) →
supporting → closing. Adjust only where a dependency forces it.

**Assumptions first.** Every phase names the assumptions it verifies: spec `[inferred]`,
`[open]`, `[default]` items (a default chosen for the user is also an assumption), a framework
nobody has used, a critical third-party API, a performance-sensitive path — or "none". A phase
carrying a core assumption (if false the whole flow is redone) precedes pure feature stacking,
and its acceptance says what evidence confirms the assumption. An `[inferred]` core behaviour is
tested with real data in the earliest phase that can show it, then written back to the spec as
`[confirmed]` or changed.

**Granularity.** Too big: over five deliverables, over ten key files, three unrelated features.
Too small: one trivial deliverable, one or two files. Right: two to four deliverables, three to
eight files, cohesion. Small projects three to five phases; medium six to eight coarse or ten to
fifteen fine.

**A complete slice.** From one participant's task follow input, judgement, data change, and
observable result; pick a slice that is small but complete ("find a bookable session by the
confirmed rules" before "book it and check the result"). Data, API, and UI may be divided but
serve one acceptable result; an infrastructure task says which result it supports and how it is
checked itself. A configuration UI delivered without its engine keeps that boundary visible.

**Naming.** Phases carry feature names ("chat core + SQLite persistence"), not just numbers. When
speaking to the user about delivery order, use feature names or "user-side / back-office stage",
so plan phase numbers are never confused with product stages.

## Every result has an evidence producer

Take one acceptance criterion and, with the original rule and example, state "given what, who does
what, and gets what". Then trace four things backwards:

1. **Where is the result observed** — page state, API response, reopened after save, a file
   inside the package, behaviour in the target environment? Pick the boundary where the promise to
   the user lives; a green compile is not it.
2. **Which work makes it hold** — the necessary implementation or existing capability along the
   real entry point. If nobody owns the final write-back, two tasks (API and page) do not add up
   to a whole result.
3. **Who produces the evidence, with what** — along the existing runner, commands, and role split:
   the author's checks and the independent acceptance. The plan records how evidence will be
   produced; actual results are filled in after execution.
4. **What the verification needs** — versions, isolated data, a reachable initial state,
   controllable timing, a test entry point. Existing prerequisites are referenced; new ones go
   into the task that owns them; unknown ones name the blocked acceptance and how to unblock it.

The answers live in the task's goal, files and responsibilities, dependencies, verify command, and
expected result — no new mandatory ledger. A task may implement and produce its author evidence;
whether an independent reviewer or tester is required comes from the assurance profile in force,
never from who implemented.

**Enough** when the executor can say why the result holds, can find the real entry point and
inputs, and knows which action produces the evidence. A result with no producer gets the missing
work or is marked unverified; a missing business rule goes back as a source conflict — never an
invented `expected`.

## Functional versus verification dependency

Disjoint directories do not make two tasks parallel. When two ends share object identity, units,
state, or error semantics, check the real contract first: allowed inputs, who writes the
authoritative state, how failure is expressed, how old data is read, who consumes.

| Fact | Plan judgement |
| --- | --- |
| shared contract explicit, write scopes disjoint | may be dispatched in parallel under ownership rules with a named integration owner who verifies the join |
| one end has a mock, the other has no real interface yet | the mock unblocks that layer; the real connection's acceptance depends on the interface — a mock result is never booked as integration done |
| shared schema, migration, or generated manifest still changes | one writer, a consumption order; no two ends inventing plausibly compatible contracts |
| two unrelated strings in the same directory | ordinary ownership and conflict judgement; no shared protocol or integration phase |

Integration responsibility lands on a concrete task and owner who feeds the same input to producer
and consumer and checks the meaning matches. A public-contract change updates the tasks, fixtures,
and acceptance that depend on it, keeping the old evidence's historical scope.

## Research tasks end an unknown

A spike states the interpretations it must separate and what to observe ("does the target
environment allow reading the required resource"), its sources or minimal experiment, allowed
side effects, and exit condition. Its conclusion may be "no". Success supports only what was
observed: a stub, a manual step, or a single-environment result is not a production
implementation. The return changes later decisions: proven, unprovable, the choice adjusted,
which tasks may start. Irreversible operations add data and version baselines, recovery
prerequisites, and an owner; a copy change does not get a production rollback table.

## Pre-flight

The plan opens with what was deferred: open questions pushed to a later phase with the interim
default; the `[inferred]`/`[default]` items to show the user for correction at the first demo; spec
gaps or contradictions already reported as requirement in doubt with the simplest default adopted
meanwhile. Delete the section when there is nothing to say — no empty shell.

## Handoff check

Pick one dispatchable task and ask whether a fresh implementer, from the dispatch pack plus the
named reading, can recover the rule, the distinguishing example, the shared prerequisites, and the
acceptance entry point. If not, add the missing meaning — not the whole project file. After a
correction, run the same check against the new rule so an old task and a new source never guide
the work at once.

The plan is ready when it connects to `phase-build`; the plan's verify commands and expected
results are not evidence of completion, and an independent reviewer or tester is arranged by the
profile, not by the implementer.
