# Architecture Design Reference

## The seven principles, with review questions and enforcement

For each principle: what it demands, the question to ask of a concrete design, and how the
decision becomes machine-checkable here. A principle that cannot be tied to a check is recorded
in the ADR as review guidance, not claimed as enforced.

### 1. Open-closed (开闭原则)

Open for extension, closed for modification: new behavior arrives as new code behind a stable
contract, not as edits to working code.

- Ask: when the next variant of this behavior arrives, which files change? If the answer is
  "the core module", the extension point is missing.
- Enforce: keep extension points in a contract module that variant modules depend on;
  `forbiddenDependencies` stops the core from reaching back into variants. Record the intended
  extension mechanism in an ADR so a review can see when an edit should have been an extension.

### 2. Dependency inversion (依赖倒置)

High-level policy and low-level detail both depend on abstractions; nothing depends downward on
a concrete implementation.

- Ask: does the policy module import the detail module, or the contract between them?
- Enforce: declare `layers` in the catalog from the outermost inward; `arch-check` fails any
  real import that flows outward. Put shared contracts in an inner module that both sides
  declare with `provides`.

### 3. Single responsibility (单一职责)

One module, one reason to change.

- Ask: name the actors who can force this module to change. More than one actor means the
  module will be edited for unrelated reasons and every edit risks the other responsibility.
- Enforce: split the catalog entry. The catalog is the unit of impact analysis, so an
  overloaded module widens every verification plan that touches it — visible as `affected`
  fan-out that keeps growing.

### 4. Interface segregation (接口隔离)

Clients depend on the narrowest contract that serves them; no client is forced to know methods
it never calls.

- Ask: which consumers break if this contract gains or changes a member? If the honest answer
  is "all of them, including ones that never use it", the contract is too wide.
- Enforce: expose narrow entry modules via `provides` prefixes rather than one catch-all
  export surface; consumers then declare edges only to what they use, and `arch-check` keeps
  the declared graph honest.

### 5. Least knowledge / Law of Demeter (迪米特法则)

Talk to your direct collaborators, not to the collaborators of your collaborators.

- Ask: does this module reach through a neighbor into a stranger — an import of a module it has
  no declared relationship with?
- Enforce: `arch-check` fails undeclared real edges outright, and `forbiddenDependencies` turns
  "must never know about" into a failing check — this is how a privacy boundary such as
  "analytics must not reach the PII store" becomes executable.

### 6. Liskov substitution (里氏替换)

Anywhere the base contract is accepted, every implementation of it must work: preconditions may
not be strengthened, postconditions may not be weakened, and the base's non-abstract behavior
is not overridden into surprise.

- Ask: can a caller written against the contract be handed any implementation without checking
  which one it got?
- Enforce: contract tests run against every implementation, wired as a check in the
  verification matrix and listed by each implementing module. A substitution defect is then a
  failing receipt, not a runtime surprise. Favor implementing abstract contracts over
  overriding concrete behavior.

### 7. Composite reuse (合成/聚合复用)

Reuse through composition (has-a) before inheritance (is-a): a new object delegates to owned
parts rather than inheriting a parent's implementation.

- Ask: does this reuse need the parent's interface, or only its behavior? Inheritance couples
  the child to every future change of the parent's internals; composition couples it only to a
  contract.
- Enforce: review-time question recorded in the ADR, plus dependency direction — a composition
  edge is an ordinary declared `dependsOn`, while deep inheritance across module boundaries
  usually surfaces as a layering violation `arch-check` can see.

## Working brownfield

Run `arch-check` before changing the design. Existing violations are recorded debt: fix them,
or record them deliberately (the catalog describes what is, an ADR describes what should be and
when the gap closes). New violations fail immediately either way. Never widen a declared edge
just to make a failing check pass — that converts the check into documentation of the decay it
was built to stop.

## Outputs

- Updated `harness/module-catalog.json` (modules, `dependsOn`, `forbiddenDependencies`,
  `layers`, `provides`).
- One ADR per decision under `docs/adr/`, each with an `Enforced-by:` line naming an existing
  check or fitness rule; `adr-check` fails on phantom references.
- Passing `arch-check`, `catalog lint`, and `adr-check` runs as receipt evidence.
