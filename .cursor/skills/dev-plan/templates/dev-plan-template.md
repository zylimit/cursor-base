# DEV-PLAN template

Default filename `DEV-PLAN.md` at the project root; an existing plan keeps its path and shape.
The bold section names (**Delivers**, **Assumptions verified**, **Key files**, **Tasks**,
**Acceptance**) and the task line shape are anchors a reviewer looks for — keep them. A single
complete task is a valid plan; phases exist only when there are several delivery groups. The
brackets are prompts; unknowns state what blocks them and how they unblock, and never hide behind
`TBD`.

```markdown
# Development Plan — <project>

> Phases, current progress, remaining work. A new session reads this file first.
> Related: <spec version and sections; architecture, DFX, and design documents actually used>
> Scope: <what this delivers and what it explicitly does not>
> Status: executable / partly executable (blockers listed) / researching

## Pre-flight

- Open question Q-n: deferred to phase X; meanwhile <interim default>
- `[inferred]` / `[default]` items: <one per line — shown to the user for correction at the first demo>
- Spec gap or contradiction: <item> → reported as requirement in doubt; this plan builds <simplest default> pending an answer

---

## Phase 1: <feature name>

**Delivers**:
- <verb first; one perceptible deliverable per line: user can do X / system does Y>

**Assumptions verified**:
- <none; or one per line: source (spec `[inferred]` / `[open]` / `[default]` item, unfamiliar technology) → the evidence this phase produces>

**Key files**:
- `src/path/to/file.ext` — <purpose>

**Tasks**:
- **Task 1.1: <concrete change>** — file path + which function or field + one verify command
  - Business Context: <why, who benefits, the rule and exception, one input→output example, open items and their impact; internal maintenance states its scope instead>
  - Requirements: <REQ-… IDs when the spec is formal; omit otherwise>
  - Harness: owned paths `<globs>`; risk `<low|medium|high>`; affected modules `<ids>`; attributes `<if any>`
  - Depends on: <prerequisites already in place / tasks that must finish first / shared contract and integration owner>
  - Verify: `<command>` in `<directory>` — expected exit and observation; who produces the evidence; test priority P0/P1/P2 and level
  - Expected: <exit status, entry point observed, behaviour asserted, behaviour that must stay unchanged>

**Acceptance**:
- <compiles, starts, the new capability visible; existing capability unbroken; the evidence that confirms this phase's assumptions>

---

<repeat per phase>

---

## Stack

| Layer | Technology | Version | Reason / verification source |
| --- | --- | --- | --- |

## Data (if any)

| Table | Created in | Purpose |
| --- | --- | --- |

## Design and data changes (if any)

<architecture, DFX, UI, or data contracts this plan relies on; migrations with their task>

## Risks and open items

<concrete condition, affected tasks, what was checked, how it unblocks; research tasks with the interpretations they separate and their exit condition>

## Understanding corrected (when it happened)

<corrected meaning and source → the reading it replaces → affected requirements, design, tasks, acceptance → current handling; completed history kept with its applicability noted; a behaviour that must change gets a correction task>

## Working rules

- Each phase closes through the four steps of `phase-build` (code review → test completeness → compile → functional); all four again after any change
- The orchestrator opens `task start` per task with its owned paths and risk; the profile in force decides review, independent testing, and verification breadth
- Commit messages `phase-N:` / `feat:` / `fix:` / `refactor:` / `chore:`; no commit without the stack's compile or lint passing
- Package manager and versions: <as verified above; no new dependency from the plan>
```

Writing notes:

1. Name phases by feature; deliverables are perceptible, verb-first; an infrastructure phase says
   which value slice it supports.
2. *Assumptions verified* is mandatory per phase (may be "none") and names the confirming
   evidence.
3. Key files are project-relative with a purpose; tests and configuration appear only when they
   are the deliverable.
4. Every task gives the three things — path, change, verify command — plus its Business Context;
   never "similar to task N", "adjust as needed", or a fabricated build step.
5. Acceptance is at least compile + start + feature works; add "existing features unbroken".
6. Stack rows carry the verified version; a table names the phase that creates it and later
   migrations sit in their phase's deliverables.
7. Delete an empty *Pre-flight*.
8. Order: core value flow with its minimal skeleton → verify core assumptions → important →
   supporting → closing; dependencies correct, never lead.
9. Formal specs: cite `REQ-` IDs in the task; a requirement no task cites, or a task citing an ID
   the spec lacks, is a defect of the plan.
