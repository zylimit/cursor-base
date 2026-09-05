# Assurance Profiles

An assurance profile answers one question: how much evidence must a change carry before it may
be called done? The harness has four built-in answers, ordered from least to most demanding, and a
small set of floors that raise the answer when the change itself says it deserves more.

```text
explore  <  rapid  <  balanced  <  strict
```

A profile never changes what the safety hooks deny or ask. Command policy, secret protection,
the sandbox, and `cli.json` are the *capability* axis and are the same under every profile. A
profile also never changes the model. It changes verification breadth, review requirements,
what blocks completion, and whether evidence may be borrowed.

## The controls

Every profile is a bundle of eight controls. Later values on each scale are stronger, and every
stronger profile is at least as strong on every control (the built-ins are asserted to form this
lattice when the policy compiles).

| Control | Scale (weak → strong) | What it decides |
| --- | --- | --- |
| `verificationBreadth` | `none` → `direct` → `affected` → `all` | Which modules' checks the gate runs: none, the changed modules, their reverse-dependency closure, or every module |
| `deferral` | `loan` → `none` | Whether an open fast loan may defer `allowFastSkip` checks |
| `reviewMode` | `none` → `receipt` → `structured` | What closing a task needs: nothing, an approving diff-bound receipt, or a receipt with lens coverage from the review engine |
| `attributeGaps` | `advisory` → `blocking` | Whether uncovered critical/high attribute gaps block completion or are only reported |
| `memorySync` | `off` → `warn` → `block` | Whether governed code changing without `progress.md` is ignored, reported by `recap`/`risk`, or blocks the stop hook |
| `budget` | `off` → `warn` → `block` | Whether exceeding the blast-radius budget warns or blocks |
| `contextDepth` | `changed` → `affected` → `conservative` | How much of the repository a context pack pulls in |
| `completion` | `forbidden` → `low-risk` → `delivery` → `release-capable` | The strongest work a passing gate under this profile may close |
| `reviewLenses` | set; a superset is stronger | Lenses a structured review convenes before attribute exclusions |

## The built-in profiles

| Control | explore | rapid | balanced | strict |
| --- | --- | --- | --- | --- |
| verificationBreadth | none | direct | affected | all |
| deferral | loan | loan | loan | none |
| reviewMode | none | none | receipt | structured |
| attributeGaps | advisory | advisory | blocking | blocking |
| memorySync | off | warn | warn | block |
| budget | off | warn | warn | block |
| contextDepth | changed | changed | affected | conservative |
| completion | forbidden | low-risk | delivery | release-capable |
| reviewLenses | – | correctness | correctness, testing, architecture | all nine |

- **explore** is for reading and prototyping. The gate refuses to run (`BLOCKED`, "runs no
  verification"), `quality status` is never `closable`, and `risk` reports the selection so it
  is not forgotten.
- **rapid** is for small, low-risk work. Only the changed modules' checks run; a low-risk task
  closes on a passing gate without a review receipt.
- **balanced** is the default. The reverse-dependency closure is verified, critical/high
  attribute gaps block, and closing a task needs an approving review receipt bound to the diff.
- **strict** verifies every module, convenes every applicable review lens, refuses fast loans,
  blocks the stop hook when memory falls behind the code, and is the only profile whose passing
  gate may close a release.

## Selection

```text
node scripts/harness.mjs profile show                 # what is in force, and why
node scripts/harness.mjs profile set rapid            # project selection
node scripts/harness.mjs profile set strict --task T  # one task only
node scripts/harness.mjs profile set adaptive         # back to the policy default plus floors
node scripts/harness.mjs profile list                 # every profile with its controls
```

The selection is the *requested* profile. The *effective* profile is the strongest of the request
and every floor the change triggers, so a request can only ever lower the answer down to the
floors, never below them. `--profile NAME` on `gate`, `verify-plan`, `quality`, and `review start`
overrides the selection for one invocation under the same rule.

## Floors

Floors are derived per change by the gate and the assessment, from facts about the change rather
than from anyone's judgement at the time:

| Floor | Default | Hard minimum | Trigger |
| --- | --- | --- | --- |
| `risk.low` | rapid | rapid | active task or `--risk` |
| `risk.medium` | balanced | balanced | |
| `risk.high` | strict | strict | |
| `impact` | balanced | balanced | a changed path is unmapped, global, overlapping, or in a shared module; or Git is unavailable |
| `protectedAttributes` | strict | strict | an affected module declares security, safety, or privacy at critical or high |
| `criticalHighAttributes` | balanced | balanced | an affected module declares any other attribute at critical or high |
| `paths` | see below | – | glob patterns over changed paths |

Default path floors: the governance surface (`.cursor/**`, `AGENTS.md`, `harness/**`,
`scripts/**`, setup scripts, CI, manifests and lockfiles) and trust boundaries
(`**/auth/**`, `**/security/**`, `**/secrets/**`, `**/privacy/**`) raise to strict. A project may
replace the list, or set it to `[]` to disable path floors.

## Fast loans and evidence debt

Speed is bought by deferring evidence, never by pretending it exists.

```text
node scripts/harness.mjs fast on --minutes 60 --reason "demo at 15:00"
node scripts/harness.mjs gate          # allowFastSkip checks are SKIPPED (deferred) and recorded as debt
node scripts/harness.mjs fast off      # closes the window; repays nothing
node scripts/harness.mjs gate          # a fresh PASS of each deferred check repays its debt
node scripts/harness.mjs debt list
```

Four conditions must all hold for a check to be deferred: a loan is open, the effective profile's
`deferral` is `loan` (strict forbids it), the matrix marked the check `allowFastSkip` in advance,
and the check does not evidence security, safety, or privacy (`validate` rejects a matrix that
marks such a check deferrable). A gate in which every check was deferred is `BLOCKED`, because
nothing ran. A loaned gate satisfies `quality status` (`complete: true`) so the agent is not
looped, but never `closable`: `task complete` and `release readiness` refuse until every debt is
repaid by a later PASS. `risk` reports an open loan and, at high severity, debt that outlived its
loan. The loan ceiling is `maxLoanMinutes` in the policy, capped at 24 hours.

## Binding

The effective controls hash into the plan hash. A receipt earned under `rapid` therefore does not
satisfy a `strict` plan for the same diff: changing the profile stales the evidence, exactly as
changing the risk level or the module set does.

## Policy file

`harness/assurance-policy.json` (schema: `harness/schemas/assurance-policy.schema.json`). Every
field is optional; the built-in defaults apply when the file is absent.

```json
{
  "version": 1,
  "default": "balanced",
  "maxLoanMinutes": 480,
  "profiles": {
    "team": { "extends": "balanced", "controls": { "memorySync": "block", "reviewLenses": ["security"] } }
  },
  "floors": {
    "risk": { "low": "rapid", "medium": "balanced", "high": "strict" },
    "impact": "balanced",
    "protectedAttributes": "strict",
    "criticalHighAttributes": "balanced",
    "paths": [
      { "id": "governance", "patterns": [".cursor/**", "harness/**"], "profile": "strict", "reason": "the governance surface changed" }
    ]
  }
}
```

A named profile extends a built-in or another named profile and may only tighten it; the policy
fails to compile otherwise, `validate` reports it, and `risk` flags it. Floors may be raised above
the hard minima and never lowered below them.

## Where the profile appears

- `sessionStart` and `subagentStart` hooks announce the effective profile, an open loan, and
  unpaid debt.
- `verify-plan`, `gate`, and `quality status` report `assurance` with the floors that raised it.
- `stop` names the profile in its follow-up and blocks on stale memory only under `memorySync: block`.
- `review start` convenes the lenses the profile requires, minus those whose attribute no
  affected module declares (see `docs/REVIEW.md`).
- `release readiness` always evaluates under the strict floor.
