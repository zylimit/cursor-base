# Phase Build Reference

## Tiers, profiles, and who must be independent

The criteria and the profile each tier selects are the table in `docs/PRODUCT-WORKFLOW.md`; what
this table adds is the chain each tier runs, so the thresholds are not restated here.

| Tier | Chain | Independence |
| --- | --- | --- |
| LOW | implementer → self-check, static check, existing tests → orchestrator accepts on the diff and runner output → commit | none required |
| MEDIUM | implementer → `code-review` stage 0 + 1 → high findings fixed, one re-check by the same reviewer → commit | reviewer ≠ author; approving receipt |
| HIGH | implementer → `structured-review` (all convened lenses) → fixes and re-check → `test-design` by a tester who did not write the code → commit | reviewer and tester ≠ author |

Applying the heaviest chain to every task costs three to five times more for a self-review the
constitution already says is not load-bearing; applying the lightest to a payment path is how
defects ship. The tier is a mechanical reading of the diff, and the profile floors
(`profile show`) may only raise it. Findings below the blocking severity are residue in
`progress.md`, fixed opportunistically, never a new review round — `medium` and `low` from a
whole-diff review at MEDIUM, `warning` and `info` from a lens at HIGH, since the two scales are
different (`docs/PROTOCOLS.md` §Tier vocabulary).

## The dispatch pack

Defined once in `docs/PROTOCOLS.md` §Task envelope and dispatch pack; what follows is what each
field means at the moment of dispatching a phase task. Seven fields, every time: **Goal** (the
concrete result that must hold; first line names the
tier), **Scope** (files, modules, behaviours it may read and change), **Out of Scope** (what it
must not touch, even if the spec mentions it), **Existing Pattern** (implementation, types,
naming, documents to follow), **Business Context**, **Verification** (the minimal objective check
this task allows and needs; an explicit user exemption is written), **Escalation** (what must come
back to the orchestrator instead of widening scope or permission).

**Business Context** is copied, not composed: from the spec, the function's why, who benefits,
and the rules and exceptions that apply; from `progress.md`, the Pinned and Decisions entries that
apply, cited by date; from the feedback corpus, the lessons the user taught that apply; from
`domain/`, the rulings that match this task's domain and the technical objects it touches. Coding,
review, and test dispatches never write `N/A`; internal maintenance states its scope ("fixes an
internal documentation link; no product behaviour changes"). A pack that quotes an earlier task's
summary instead of a file path is mostly noise — pass paths, not history.

Budget: a LOW or MEDIUM pack expects about six tool calls; a HIGH pack writes its budget (tool
calls or minutes) under Verification; an agent's turn limit is a circuit breaker, not a target. A
dispatch expected to run over an hour is a decomposition failure — split it, do not let a
subagent run long.

## Acceptance

- Judge against the diff and the runner's raw output, not the report. Reading evidence in full
  may be delegated to a fresh role; "pass or fail" stays with the orchestrator.
- New files: `git diff` returns nothing and exit 0 for a file that is untracked, exactly as for a
  file nobody touched. Prove new files with `git status --short` (`??`), `wc -l`, and a content
  anchor.
- Every claim of "done / passed / fixed" walks five steps first: decide which command would prove
  it → run it fresh and in full → read the whole output and the exit code → confirm the output
  supports the claim → speak. "Should", "probably", and "looks like" are not verification words.
- A receipt's **Counter-examples** (scenario → what the spec gives → what the business needs →
  basis) or a review's **requirement in doubt** never gets patched in code; it goes to
  `product-spec` iteration mode and returns as a spec change. **Domain findings** carry their
  evidence to `domain-rulings`; without evidence they are not recorded.
- BLOCKED or NEEDS_CONTEXT re-dispatch changes at least one variable — context, scope, role, or
  model — in this order: supply what was missing and re-dispatch fresh; cut the scope; switch a
  defect to `root-cause-debugging`; escalate to the user. Re-sending the same prompt to the same
  configuration is gambling.

## Building discipline

**Modification.** Before changing anything, list the existing behaviours the change reaches.
Before deleting or changing a constant, export, built-in datum, component, interface, or copy that
is referenced in several places, grep the whole project and clean every reference in one pass.
After the change run the full stack of checks — type check, unit, end to end; a green type check
proves nothing about the other two. Anything persisted (database, local storage, cache, config)
takes its existing data with it: add a startup migration or compatibility, or the old data becomes
a zombie the code no longer knows how to delete; a change that deletes persisted data ships with
a migration test. Style changes check `overflow: hidden` clipping popovers, z-index stacking, and
`flex-shrink` layouts.

**Existing values and read paths.** Deleting a definition does not delete the values already
saved, cached, imported, or configured. Follow create, load, edit, save, reopen, and display
entry points; record each object's identity and origin (stable ID, kind, user-made or built-in);
same display name is not same identity. Then branch on the confirmed rule: only forbid creating
new ones while old ones stay readable; convert old ones (mapping, failure handling, kept data,
authorisation — verified through load and save); hide or remove built-ins of one origin while
protecting similar user objects; unknown handling goes back to the orchestrator with sources and
candidates. Enough when new, representative old, and similar-but-kept objects pass through the
real entry points and survive save and reopen.

**Success response → the result the user actually gets.** Follow input → transient edit →
request → domain handling → response → applied or written back → saved and reopened. A 200 or a
function's existence proves nothing about downstream. At the write boundary check which object and
request the result belongs to, which input it was based on, whether the current edit changed, and
whether the user completed the confirmation the rule requires. Success shown, result received,
applied, saved are four observable facts. Run the timeline that exposes overwrites: send the
request, change the edit, let the old response arrive; keep, reject, or merge by the confirmed
conflict rule; retries and duplicate callbacks are checked for double writes.

**Test isolation.** Tests and scripts that start the real application, connect a real database,
or launch the real client use a dedicated data directory and never the user's production store or
configuration. Every entry point that participates consumes the isolated directory — prove it with
a safe diagnostic value or a behaviour contrast, because creating a temporary directory nobody
reads proves nothing. Temporary directories are removed at teardown, not merely closed.

**Real first.** Buttons, numbers, and cards show real data and real behaviour; nothing
hard-coded, faked, or decorative. Grep for a precedent before introducing a UI element the project
has never used; no precedent means it does not go in.

**SDK first.** Before writing a capability, confirm the framework or SDK does not already provide
it.

**Verification as evidence.** A completion claim carries the command just run and its output in
the same message; "it compiled earlier" is not evidence. Give the orchestrator command, exit code,
and where the output lives — not a paragraph of reassurance.

**Files.** Split by responsibility, coupling, complexity, and testability; a file that has grown
past easy navigation is split, but no mechanical line limit decides it. Three plain lines beat one
premature abstraction.

**Model-facing output.** A summary for a person may be truncated; a tool result fed to a model or
an agent is not — when the input is too large, compact the format (one line per item), never the
item count.

**Dependencies and lockfiles.** New or upgraded dependencies, data migrations, package-manager
switches, and CI changes need authorisation first. Before regenerating a lockfile read the exact
package-manager version from its header and use that one; rewriting it with the machine's default
version is unauthorised toolchain drift.

**Failure visibility.** No empty catch, no silent retry, no silent fallback to a default
success. A necessary fallback is narrow (one exact scenario), observable (logged or flagged), and
reported as a concern in the receipt.

**Documents follow.** A requirement or design change discovered while coding goes back through
`product-spec` or `design-brief` first; code and documents do not drift apart.

**Design reference order.** Read most-concrete first — the prototype (`demo/index.html` or the
design tool's mock-up) → `DESIGN.md` → `Design-Brief.md` → `Product-Spec.md` — because the
prototype carries exact values and the spec carries none. Authority runs the other way: the brief
and `DESIGN.md` are the source of truth for behaviour and visuals, and a prototype that disagrees
with them is a defect in the prototype, routed through `design-brief` iteration mode (file first,
then the prototype regenerated), never coded against. With a design tool connected, read the
exact values (size, padding, gap, type, weight, colour, radius, shadow) for each task's screens
before coding — every task, never from memory — and compare the code's actual values after;
without a tool, the tokens and screen specifications are the reference; with neither, inherit the
nearest existing page. Before committing UI: contrast ≥ 4.5:1, focus visible, touch targets large enough,
every required state of that screen present; new pages inherit the semantics, interactions, and
danger-action rules of their neighbours and are compared against a rendered neighbour, not against
a component name; buttons and text stay inside their containers at the narrowest width; danger
actions leave the primary action row and confirm as the brief says.

**Long-running batches.** Designed from the start with a per-item timeout and a cheap input
pre-check that skips pathological inputs with one log line — added after the fact means the
pipeline already stalled once.

## Conventions the plan may adopt

Technology-neutral defaults a plan can state and a project can override in its own `AGENTS.md`:
strict typing (no untyped escape hatches; type guards over casts); one responsibility per file,
side effects (database, filesystem, network) isolated in their own layer, routing layers that
parse and respond only; no bare catch-all exception handling; the project's existing style wins
over personal preference; no code for imagined future needs. Every feature ships its happy path,
error message, loading state, empty state, basic input validation, and no hard-coded secrets,
absolute paths, or personal data; secrets never enter browser-visible variables and model calls go
through the server; an example environment file is committed and the real one is ignored by
git. Database tables
use snake_case, carry `id`, `created_at`, `updated_at`, declare defaults in the schema; migrations
alter in place after checking existence; queries are parameterised; indexes only where a query
needs one. Commits are atomic per logical change with the prefixes above; a repository containing
several independent repositories commits and pushes each on its own and verifies each remote
separately.

## Initialisation mode

Project code lives in a subfolder named after the project (lowercase, digits, hyphens); planning
documents stay at the root. Configure the plan's stack and enable strict typing; **stop for the
user's approval before installing the listed dependencies** (dependency installation is in the
stop tier whatever the plan says); wire environment variables; `git init` with an ignore file
covering planning documents, design assets, environment values, and build output; announce and
then create the private remote the user named and make the first commit (announce-and-continue
tier); then enter phase 1.

## Four-step close and the gate

1. **Code review** against the phase's delivery list, item by item; out-of-scope changes named.
2. **Test completeness** — planned features present, nothing half-built; the tester, never the
   author, writes and runs; coverage reaches interaction and failure paths, not only pure functions
   and the happy path; every green is checked for a true premise (units, reachable inputs,
   assertion direction) — a green on a false premise hides the defect as expected behaviour; every
   declared error, empty, and boundary state has a test that reaches it; a test that exists but did
   not run counts as missing.
3. **Compile** — front-end type check zero errors; back-end lint zero errors or a syntax compile
   of every file; mixed stacks verify each stack with its own evidence.
4. **Functional** — dev server starts with no error output; new capability usable; existing
   capability unbroken; core interaction flows driven end to end by a browser driver when one is
   installed, otherwise the API is exercised and the user is asked to confirm the UI.

Any change restarts the four steps; fixes commit as `fix:`. A large batch across phases or
directories also gets one duplicate-code and extractable-logic scan at close, recorded with tool,
window, and clone count, done or not done with a written reason.

Gate: **PASS** all four clean; **CONCERNS** proceed with the residue list written; **FAIL** stop
and fix; **WAIVED** only with a reason and an approver, and never for a security or data-loss gap.
`node scripts/harness.mjs waiver` refuses by construction exactly what
`docs/PROTOCOLS.md` §Waiver binding lists — security-class checks, checks evidencing a
critical-tier attribute, and safety or external-side-effect words in the reason or scope — and
nothing else, so a data-loss gap (which has no class of its own in the matrix) is refused by this
skill's rule and the approver's responsibility, not by the tool.
