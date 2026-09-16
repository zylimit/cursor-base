# Architecture Design Reference

## First principles

- **Proportionate**: the enemy of architecture is over-design. Size first (S / M / L); a
  single-module tool gets a one-page sketch, not a hexagon. Going up a tier is written down with
  its reason; an empty "over-tier" table is good news.
- **The invariant test**: a sentence enters the document only if two independently built units
  would otherwise choose incompatibly, the choice is not obvious, and it is a real trade-off.
  Everything else goes to *Deferred* in one line — the deferred section is the other half of the
  contract and is what keeps the document thin.
- **One-way dependencies**: every edge has a direction and a reason; a cycle or a two-way edge is
  a boundary drawn in the wrong place.
- **Decisions leave a trail**: every significant trade-off is an ADR with context, drivers,
  options, decision, consequences, rejected alternatives, enforcement, revisit condition,
  reversal. A decision without a rejected option was never considered; one without enforcement
  drifts; one without a revisit condition keeps being built on a premise that stopped holding;
  one without a reversal gets treated as cheap when it is not. An ADR records an architectural
  trade-off; a domain ruling records how something is counted (`domain-rulings`) — "did it choose
  between candidates?" tells them apart, and one ADR may spawn several rulings but never the
  reverse.
- **Executable first**: what can be a check becomes a check — `forbiddenDependencies` and
  `layers` in the catalog, watched by `arch-check` on every change; a boundary that lives only in
  prose is waste paper in three months.
- **The envelope is never silent**: environments, deployment topology, infrastructure and
  vendors, operations (logs, monitoring, backup, release and rollback) — each item is decided,
  deferred with a return condition, or undecided. A blank section is the failure a review must
  catch.
- **Current sources**: styles, framework capabilities, middleware, and starter templates are
  checked against current documentation before they are decided; no architecture from stale
  memory.

## Walk the business event before drawing modules

Pick one representative path from the spec. Start at the initiator and the trigger; write who
judges, who changes which fact, who receives the result, what downstream does with it — as a short
collaboration line in business verbs and objects — and only then map it to code responsibilities.
Departments, pages, database tables, and deployment units are not modules by default. When the
business meaning is missing, say how each possible answer would move the boundary and let the
orchestrator fetch the answer; never ask a business person to choose a message queue.

**Fact ownership.** For every shared business fact: the authoritative source; the roles or
external systems allowed to initiate a change; the module that validates and writes; the read-only
consumers; the history and derived views. The catalog's `owners` is maintenance responsibility,
not business permission — two modules reading one table does not make both writers. One decidable
invariant explains each coordination need ("the same resource cannot hold two valid bookings";
"a state change requires the confirmed precondition"); take the project's real rule first, then
decide whether a transaction, a version check, or an explicit cross-module protocol protects it —
and never downgrade a promise to eventual consistency for technical convenience.

**Break points.** On that path, pick the break points this change touches — duplicate request,
concurrent update, external success with no local reply, a step half done, undo or correction —
and write, step by step, what was saved at that moment, who knows what, what the user sees, how
a retry or a person continues. "Result unknown", "rejected", and "completed" are three states.
Compensation, undo, and appended correction have different business meanings; only what the
business allows to be reversed gets automatic compensation. Where the data is missing, keep the
unknown and its impact — never cover it with an arbitrary retry.

**Alternatives worth comparing.** Give a recommendation, and along the same path say what each
real alternative costs in consistency, waiting, fault isolation, maintainability, migration, and
rollback. If in-process modules already hold the boundary, do not split a service to draw a
prettier picture; when a split is right, write the real driver and who operates it. Reversible
technical detail is decided within the mandate; only data ownership, failure promises, visible
cost, and public contracts go back to the user.

## Evaluate with distinguishing scenarios

**Drivers.** From the spec, the cases, the quality material, the existing architecture, and the
team: the invariants that must hold (which fact breaks, who bears it, where the rule comes from);
the quality targets (under which condition, which result; committed, candidate, or pending);
the constraints (existing data and callers, environment, maintenance capacity, cost, change
windows); the unknowns that would change boundary, deployment, recovery, or an external promise.
"Cloud", "microservices", "a queue" are never goals — recover the constraint they were meant to
solve; when the status quo already meets it, change nothing.

**Scenarios.** For each situation that would change the decision: source and stimulus,
environment, affected artefact, expected response, and how it is judged — usage, failure,
recovery, or a confirmed future change. The point is that scenarios separate options, not how many
there are. "The system must be reliable" is not a scenario; "the save committed, the response was
lost, the user retries the same intent — what happens to the booking and the slot" is. Business
stakeholders judge consequences with concrete losses and sources, never with a technical score
sheet.

**Same scenario, every candidate.** Draw the shortest fact path first: where the judgement
happens, which write becomes authoritative, when the outside is told, what the return value is
based on, who can continue after an exception. Then put the status quo or the minimal option and
each candidate through identical inputs and break points. Modules and deployment units are judged
separately; several responsibilities may share one application with clear boundaries. An existing
reliable job mechanism counts as status-quo capability; do not rebuild one to demonstrate a
pattern.

| Candidate | Cause-and-effect on the same scenario | Rule kept or broken | Cost and conditions | Kind of evidence |
| --- | --- | --- | --- | --- |
| status quo / minimal | actual or proposed steps | the rule and the concrete consequence | what exists, what must be added | implementation fact / paper trace / measured — each named |
| real alternative | what happens after the same break point | same criteria as row one | waiting, resources, maintenance, migration, failure | nothing unrun is written as passing |

**Sensitive assumptions and cross-attribute cost.** Write each "it depends on…" as the condition
that flips the judgement: the external service supports idempotency and result lookup (semantics,
lifetime, coverage may differ → retry recovery vs duplicate side effects, confirmation and manual
cost); one database carries business and jobs (load or shared fault beyond tolerance →
consistency and simplicity vs performance and isolation); cached business views (a stale view
changes a human decision → speed vs freshness; never cache across a permission boundary for
speed); more logging for diagnosis (personal data or over-retention → diagnosability vs privacy,
storage, access control); automatic retries (a persistent fault with synchronised retriers →
resilience vs amplification, cost, repeated external actions). Shared dependencies correlate
failures; availabilities do not multiply. An architecture argument gives causal reasons, not a
production P95.

**Refutation first, then the smallest experiment.** Turn the question into an observation that
would refute the recommendation ("a retry of the same intent yields a second valid booking";
"the booking committed but no pending-notification item exists"; "a user's new edit is overwritten
by an old result"). Then choose: a document or contract check (does the provider really support
the needed idempotency — product names and SDK method names are not proof); a paper event trace
(finds every gap between steps; not a persistence or concurrency test); a local operable
prototype (input, selection, state, focus, stale results; not backend consistency); an isolated
fault or load test (real commit boundaries, recovery, capacity — with a reproducible
environment, inputs, criteria, and never a destructive act on a live service). Record input and
environment, criterion, executor, observation, and design impact; proposing an experiment grants
no authorisation to install, to act externally, or to test destructively.

**A conditional decision.** The recommendation connects to its drivers, the same-scenario
comparison, the reasons alternatives lost, the remaining unknowns, and the revisit trigger. What
facts and mandate already settle is written down now; an unknown blocks only the promise that
depends on it. The most important unverified assumption is handed to dfx-design and dev-plan to
schedule — writing the ADR is not the same as having verified it.

## A worked case: bookings and notifications

Facts (fictional, shared with the product-spec, design, and DFX references): a booking exists once
its fact is saved — button feedback and notification delivery do not count (R1); a retry of the
same submission intent finds the same result, and a name is not an intent (R2); a saved booking is
notified automatically, a failed notification never cancels the booking, and staff can find
unfinished notifications (R3); cancellation frees the slot and keeps the history (R4). Two people
maintain one application and one relational database.

From R1 and R3 the driver is "a notification fault must not rewrite a booking fact": one
responsibility keeps occupancy and same-intent results, another consumes results and keeps
pending items — in one process if that already holds the boundary; not a service, a queue, or a
deployment unit by default.

Break point: "the booking is saved, the response is lost in the network, the user clicks again."
Who knows the booking exists; is the second click a lookup, a retry of the same intent, or a new
booking, and from what basis; what does the user see and how do they check, continue, or reach a
person; who prevents double occupancy under two simultaneous requests. Reusing an existing request
identifier and a uniqueness constraint is a reasonable recommendation — but the identifier's scope
and what a retry *means* in the business come from the sources, not from a default.

Same scenario, three candidates ("commit happened, process died before the notification call,
application restarts"; the criterion is R3):

| Candidate | Result after the break point | Cost | Judgement |
| --- | --- | --- | --- |
| A — transactional save, then notify inside the request, no persisted pending item | booking survives; the in-memory "still to notify" is gone and cannot be recovered from the success path | smallest change; if another recovery record exists, recount A with it | fails the concrete rule as defined; a design counter-example, not a measured one |
| B — save the booking and a pending-notification item in one transaction; an in-app worker sends later | the obligation is queryable after restart; a failed send never becomes a failed booking | pending and attempt state, duplicate handling, backlog diagnosis, cleanup, maintenance; the shared database still fails both | recommended to verify first under the two-maintainer constraint; reuse an existing job mechanism, do not add a messaging platform by default |
| C — a separate notification service or message infrastructure | if booking commit and notification obligation still have no reliable link, moving deployment keeps the same gap | operations, releases, identity and data boundaries, a longer diagnostic chain; needs a real scale or isolation driver | does not win by name; unknown load does not justify the complexity |

A lost on that specific window, not because synchronous calls are wrong. B buys "booking and
obligation persist together", not "the outside receives exactly one message" — B's own break point
is "provider sent, local record not written, process died": resend may duplicate, not resending
may lose; with the provider's idempotency and lookup unknown, "exactly once" is not promised.

Refutations for B: booking and pending item are not in one atomic commit → a booking without its
record, or an item without its booking; two people cannot operate the in-app worker → lifecycle,
contention, or backlog invisible; extra writes hurt the core result under representative load →
measure before comparing isolation options; the provider cannot handle or look up duplicates →
narrow the automatic retry, add a manual review path. Proposed experiments, none run: two intents
race for the last slot; retry after a lost response; restart between commit and external call;
restart between provider success and local record; cancel and rebook. Notification latency and
real load stay unknown and cap the promises. The interface shows booking and notification as two
results and gives a confirmed way to check after a lost response; DFX measures booking
correctness, obligation retention, and delivery separately.

## State ownership

When the scope involves interaction or asynchronous results, name each kind of state — the
authoritative business fact, transient UI state (drafts, selection, focus), view preferences,
request or task state, and resource assets — with its owner, lifetime, writer, and consumers. No
rule says each kind needs its own store; the point is that business state is never inferred from
the DOM, a chat summary, or "the request returned", and preferences are never persisted as domain
facts. Trace the timeline: submit version 7 of object A; while waiting the user produces version 8;
version 7's success says only what happened to the original submission and neither marks version
8 saved nor overwrites object B. Whether the next submit is a check of the original intent or a
new one comes from the confirmed rule; a name, an object title, or arrival order never decides
it. Uploads, generation, deletion, and external actions add asset ownership, input trust, access,
retention, and irreversibility — and a plain query page gets none of the machinery.

## The seven principles, with review questions and enforcement

For each principle: what it demands, the question to ask of a concrete design, and how the
decision becomes machine-checkable here. A principle that cannot be tied to a check is recorded
in the ADR as review guidance, not claimed as enforced.

### 1. Open-closed

Open for extension, closed for modification: new behavior arrives as new code behind a stable
contract, not as edits to working code.

- Ask: when the next variant of this behavior arrives, which files change? If the answer is
  "the core module", the extension point is missing.
- Enforce: keep extension points in a contract module that variant modules depend on;
  `forbiddenDependencies` stops the core from reaching back into variants. Record the intended
  extension mechanism in an ADR so a review can see when an edit should have been an extension.

### 2. Dependency inversion

High-level policy and low-level detail both depend on abstractions; nothing depends downward on
a concrete implementation.

- Ask: does the policy module import the detail module, or the contract between them?
- Enforce: declare `layers` in the catalog from the outermost inward; `arch-check` fails any
  real import that flows outward. Put shared contracts in an inner module that both sides
  declare with `provides`.

### 3. Single responsibility

One module, one reason to change.

- Ask: name the actors who can force this module to change. More than one actor means the
  module will be edited for unrelated reasons and every edit risks the other responsibility.
- Enforce: split the catalog entry. The catalog is the unit of impact analysis, so an
  overloaded module widens every verification plan that touches it — visible as `affected`
  fan-out that keeps growing.

### 4. Interface segregation

Clients depend on the narrowest contract that serves them; no client is forced to know methods
it never calls.

- Ask: which consumers break if this contract gains or changes a member? If the honest answer
  is "all of them, including ones that never use it", the contract is too wide.
- Enforce: expose narrow entry modules via `provides` prefixes rather than one catch-all
  export surface; consumers then declare edges only to what they use, and `arch-check` keeps
  the declared graph honest.

### 5. Least knowledge / Law of Demeter

Talk to your direct collaborators, not to the collaborators of your collaborators.

- Ask: does this module reach through a neighbor into a stranger — an import of a module it has
  no declared relationship with?
- Enforce: `arch-check` fails undeclared real edges outright, and `forbiddenDependencies` turns
  "must never know about" into a failing check — this is how a privacy boundary such as
  "analytics must not reach the PII store" becomes executable.

### 6. Liskov substitution

Anywhere the base contract is accepted, every implementation of it must work: preconditions may
not be strengthened, postconditions may not be weakened, and the base's non-abstract behavior
is not overridden into surprise.

- Ask: can a caller written against the contract be handed any implementation without checking
  which one it got?
- Enforce: contract tests run against every implementation, wired as a check in the
  verification matrix and listed by each implementing module. A substitution defect is then a
  failing receipt, not a runtime surprise. Favor implementing abstract contracts over
  overriding concrete behavior.

### 7. Composite reuse

Reuse through composition (has-a) before inheritance (is-a): a new object delegates to owned
parts rather than inheriting a parent's implementation.

- Ask: does this reuse need the parent's interface, or only its behavior? Inheritance couples
  the child to every future change of the parent's internals; composition couples it only to a
  contract.
- Enforce: review-time question recorded in the ADR, plus dependency direction — a composition
  edge is an ordinary declared `dependsOn`, while deep inheritance across module boundaries
  usually surfaces as a layering violation `arch-check` can see.

Violation signals per principle, for the review pass: *open-closed* — "add one more kind of X"
spreads edits across many existing files. *Dependency inversion* — domain logic imports a
database driver, HTTP client, or UI framework; changing the store means changing business code.
*Single responsibility* — one module's history mixes two unrelated requesters; changing A keeps
breaking B; names like `…AndManager`, `Util`. *Interface segregation* — changing one contract
member rebuilds consumers that never used it; implementations full of empty or "not supported"
methods. *Least knowledge* — imports reaching into another module's internal directories;
`a.b().c().d()` chains; changing C's internals breaks A. *Liskov* — "mostly compatible except a
few cases"; `instanceof` branches in callers; an override that throws. *Composite reuse* —
inheritance trees deeper than two; every field added to a "base" ripples through every child.

## Working brownfield

Run `arch-check` before changing the design. `arch-check` has no baseline or allowlist: every
undeclared real edge, every forbidden edge, and every cycle fails. Existing violations are
therefore recorded debt in two places — the catalog declares the edge that *is* there (so
`affected` sees the true impact), and an ADR records what *should* be there and the condition
under which the edge is removed. That is the only sanctioned way an inherited edge passes, and it
is done once, deliberately, at adoption; a *new* edge is never declared into `dependsOn` to make a
failing check pass — that converts the check into documentation of the decay it was built to
stop. Cycles and explicit `forbiddenDependencies` cannot be declared away at all: they stay
failing until the code changes, with the removal plan in the ADR.

Read enough real code first; `arch-check`'s undeclared dependencies are the factual boundary.
Ratify what exists, draw the migration arrow from facts, do not build a castle in the air.

## The ADR fields

`Status` and `Enforced-by` are read by `adr-check` (a retired ADR — superseded, deprecated,
rejected — is exempt; a live one must name at least one matrix check id or fitness rule id and
nothing unknown — there is no "manual review" token, so a decision no check can see goes to
`progress.md` Decisions or earns a check first). `Date`, `Revisit-if`, and `Reversal` are read by
people in this repository until the check learns them (prompt-only today): write the revisit
condition as an observable fact
("daily actives above 50k", "multi-tenancy required", "team above three", "this dependency is
abandoned") and never as a date ("look again in three months" — whether the premise still holds
has nothing to do with the calendar); write the reversal as the concrete work and its rough
duration, or the words **one-way door** when no reversal can be written, which lists the decision
for the user to take at an irreversible decision's pace.

## Pressure cases

- "Let's do microservices, it scales." — Do not pick a style yet: who hurts most when the dispatch
  path is down for an hour, and how many people maintain this? Two maintainers on services is
  three deployments, three log streams, and cross-service debugging; recommend a modular monolith
  with the dispatch module isolated in-process until it is the bottleneck; the rejected option
  and its reason go into the ADR; the user may insist, and the operational cost goes into the
  consequences.
- "Put every API's response format in the architecture document." — The envelope (error shape,
  pagination fields) goes in: two people would write it differently. Per-endpoint field lists do
  not: that is the code's business, one deferred line says so.
- A hexagon recommended in the first sentence; "deployment: later" as a blank section; an ADR with
  a conclusion and no candidates; enforcement written as "everyone be careful"; revisit written as a
  date; reversal skipped because it was hard to write — each is the anti-example of one field above.
- "The spec is tiny." — Do not split modules for form; describe the boundary in the plan and keep
  a single-module catalog or ADR only where something real depends on it.
- "The user insists on a design with a known compromise." — Explain the maintenance and business
  consequence once with an alternative; an accepted trade-off within the mandate is recorded as an
  ADR and built. Protected attributes, dangerous operations, and non-waivable violations keep their
  boundaries; accepting a risk is not passing a check.

## Outputs

- Updated `harness/module-catalog.json` (modules, `dependsOn`, `forbiddenDependencies`,
  `layers`, `provides`); a new project's paths pre-filled from the directory skeleton and noted
  "calibrate while coding".
- `Architecture-Design.md` from `templates/architecture-design-template.md` (S tier: §1, §2 short
  table, §7 one line, §8 ≤3 ADRs, §9 one line; the rest deleted). Diagrams are valid, never empty
  placeholders; template comments do not survive into the product.
- One ADR per decision under `docs/adr/` from `templates/adr-template.md`, each with an
  `Enforced-by:` line naming an existing check or fitness rule; `adr-check` fails on phantom
  references. The decisions no check can see (kept in `progress.md`, not in `docs/adr/`) and the
  one-way doors are both reported to the user.
- Passing `arch-check`, `catalog lint`, and `adr-check` runs as receipt evidence; the decisions in
  `progress.md` with rejected alternatives and scope.
