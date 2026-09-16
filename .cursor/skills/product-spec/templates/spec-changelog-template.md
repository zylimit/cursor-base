# Spec changelog template

Default filename `Product-Spec-CHANGELOG.md` beside the spec; `sync-check` reports a spec edit
that arrives without a changelog edit in the same change, and a changelog edit without a spec
edit. A project with its own change-record convention keeps it.

One entry answers four things: what changed, why, which earlier judgement was wrong, which
confirmed items are affected. An entry that only says what changed leaves nobody able to tell,
later, why it was decided.

```markdown
# Spec changelog

## [<version or change id>] - YYYY-MM-DD

**Why**: what triggered it — a new fact from the user, a downstream counter-example, an external constraint.
**Which judgement was wrong**: spec item, its basis at the time, why it is wrong now; a pure addition is "new, no prior judgement".
**Affects**: confirmed items that must follow; plan phases or tasks touched.
**Class and return stage**: clarification / scope added / scope removed / behaviour change / data or permission change / acceptance change / correction; return to design-brief / architecture-design / dev-plan / none.

### Added
- <behaviour, where it applies, source marker>

### Changed
- <old behaviour or reading → new behaviour or reading; source; affected IDs or sections>

### Removed
- <capability, scope, reason; history is kept in the spec as "→ superseded <date>">

### Understanding corrected (when it happened)
- <the misreading and the current reading; the user's correction or the fact that exposed it. The agent's misunderstanding is never booked as the user widening scope.>
- <design, tasks, and acceptance that must follow, and whether each is already synchronised>
```

Rules:

- Version numbers follow the project's convention; without one, a dated change id is enough.
- *Why* and *Which judgement was wrong* are never empty; they are the user's evidence for their
  own judgement later and the source of `progress.md` decisions.
- Added / Changed / Removed are separate; omit an empty heading; one entry per change point. New
  controls state their position; changed numbers show before and after; AI capability changes get
  their own line.
- A change triggered by a downstream **requirement in doubt** names the counter-example under
  *Why*.
- The current rule lives in the spec body; the changelog keeps the reason and the supersession.
  Two contradicting versions are never both current.

Example (fictional):

```markdown
## [v1.2] - 2026-09-15

**Why**: while writing the "VIP ticket, Zhang on leave" test the tester found the spec had no path and reported requirement in doubt; the user confirmed it falls back to the lead.
**Which judgement was wrong**: rules-and-exceptions row 2 only said "VIP straight to Zhang"; at the time Zhang's presence was taken as a fact, in reality he is away twice a year.
**Affects**: function "VIP direct"; phase 2 dispatch rules.
**Class and return stage**: behaviour change; dev-plan updates the phase-2 task, design unchanged.

### Changed
- VIP direct: when Zhang is marked away the ticket falls back to the lead's queue `[confirmed]` (source: user, 2026-09-15)

### Removed
- Open question "VIP ticket when Zhang is away" (resolved)
```
