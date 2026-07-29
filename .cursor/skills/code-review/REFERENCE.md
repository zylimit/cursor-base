# Code Review Reference

## Binding

Record the full base Git object ID, SHA-256 hash of the canonical reviewed diff, paths, and exclusions. Prefer repository harness canonicalization when available. A branch name, pull-request number, or working-tree label is not an immutable binding.

Any changed diff byte, base, scope, or exclusion invalidates the receipt.

## Finding format

```text
ID: stable identifier
Severity: blocker | high | medium | low
Location: path and symbol or narrow line range
Trigger: concrete input/state/sequence
Impact: observable consequence
Evidence: why the changed code causes it
Direction: bounded remediation, not a full rewrite
```

Report defects introduced or exposed by the change. Avoid style preferences unless they create a concrete maintenance or correctness risk. State when there are no actionable findings and list review gaps.

## Review receipt

Include reviewer, decision, base commit, diff hash, scope, exclusions, findings, and `Not reviewed`. Testing evidence supplements review; it does not replace code reasoning.
