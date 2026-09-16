# Code Review Reference

## Binding

Record the full base Git object ID, the SHA-256 of the canonical reviewed diff, the paths, and the
exclusions; prefer the harness canonicalisation (`review-pack`, `receipt`). A branch name, a pull
request number, or a working-tree label is not an immutable binding. Any changed diff byte, base,
scope, or exclusion invalidates the receipt; a re-review after fixes focuses on the fix, its
regression impact, and the open items, stating which unchanged judgements still rest on the earlier
evidence — it does not copy the old receipt onto the new binding.

The reviewer's identity is a claim recorded per conversation (`authorship record/show`); it is
honest about not being an authenticated identity, and the verdict says when authorship could not be
checked.

## Adversarial method

Default to guilty. Construct the input, boundary, concurrency, or exception path that would break
the change and actually run it; "it might…" without a reproduction is not a finding, and "passed"
without an attack is negligence. The spec is a target too: a concrete situation in which the code
matches the spec and the spec fails the business is a **requirement in doubt**, reported as a
counter-example, never as a defect and never as a reviewer's edit to the spec.

Follow the user's promise, not the event handler: control or copy → real entry point → allowed
input → state change → what the user can observe. For tests, check that the fixture is reachable
under production preconditions, that the units are right, and that the `expected` has an
independent source — a round trip can hide two cancelling errors. Compare a new page with a
rendered neighbour, and tie visual findings to a design reference or a usability consequence;
personal taste never becomes a blocker.

## Truthfulness checks

- **Test truthfulness**: does a green prove behaviour? Premise matches production (dimension,
  unit, input reachability, assertion direction); the declared error, empty, and boundary states
  are reached by a case; a test present but not run is missing.
- **Guidance truthfulness**: placeholders, hints, and empty-state copy point at behaviour that
  exists; a placeholder that says "type X to run" while nothing handles X is a missing function.
- **Evidence truthfulness**: when consuming another tool's report — object and ownership,
  environment and parameters, completion (samples reached, process finished), which findings
  entered the pass condition, the raw exit and protocol; exit 0 may mean the script never touched
  the object (the `test-design` skill's reference, §Reading another tool's report, has the five
  questions in full).
- **Security grep**: dynamic evaluation, raw HTML injection, browser-visible variables carrying
  keys or tokens, absolute personal paths, key-shaped literals, string-concatenated SQL; a critical
  dependency advisory is recorded with them.

## Finding format

```text
ID: stable identifier
Severity: high | medium | low
Location: path:line (symbol or narrow range)
Basis: the rule or requirement and its source
Evidence: minimal initial state, action, expected vs actual; reproduced or reasoned
Impact: the observable consequence for a user or consumer
Direction: bounded remediation, not a rewrite
```

Example of a finding that carries its business meaning: the rule says "repaired but unpaid tickets
stay on the settlement list"; the implementation filters them out — say which tickets vanish and
whose work is affected, not "enum handling error".

Report defects introduced or exposed by the change. State explicitly when there are no actionable
findings, and list the paths attacked and the gaps in testing.

## Review receipt

Include reviewer, decision, base commit, diff hash, scope, exclusions, findings, and `Not
reviewed` — the latter lists only real gaps inside the assigned scope; out-of-scope or unrun
verification belongs under `Not verified`. Neither is emptied to obtain an approval. Testing
evidence supplements review; it does not replace code reasoning.

## Convergence

The first review covers every required stage and lens once and reports the substantive,
evidenced problems together — not a trickle of small points over several rounds. Only high
findings block; the same reviewer re-checks the fix once; medium and low are residue in
`progress.md` unless they affect acceptance. Three rejected rounds mean the change or the standard
is wrong (`structured-review` escalates); the reviewer never resets the count, changes a FAIL to a
PASS, or downgrades a severity to fit a budget.
