---
name: code-review
description: Adversarial, defect-first, read-only review bound to a base commit and diff hash — static gate, spec conformance, then quality; every finding located. Use for pull requests, branch diffs, and pre-merge review.
disable-model-invocation: true
---

# Code Review

The change is guilty until an attempt to break it fails. "Already implemented" and "roughly
matches" are not accepted. The reviewer did not write the change.

## Task

Produce a located findings report. This skill stops at the report. The orchestrator writes any
receipt. Daily `balanced` work may skip this skill; a human or Bugbot review is welcome, not a
close condition.

## Preconditions

- Bound target: full base commit and canonical diff hash (`review-pack`).
- Product work: Business Context. Without it write "business context not checked", which is
  not "no problem".
- Invoke by name. LOW-tier changes are not reviewed by this skill.

## Invariants

- A function either has code at `file:line` or it does not. "Passed" without compiler output,
  a response, or a numeric comparison is no review.
- Requirement in doubt is not a stage failure and never becomes a spec edit by the reviewer.
- Report only what affects correctness or an agreed requirement. Style preferences and
  "potential issue on a specific input" are not reported.
- A self-review cannot carry an approval (`authorship show`).

## Method

1. Write the envelope. Bind the pack. Read Business Context.
2. **Stage 0.** Project static checks first. Errors stop here. A missing tool is `BLOCKED`
   under `Not verified`, not a skip.
3. **Stage 1 — was the right thing built.** Every spec item in scope: complete / partial /
   missing / requirement in doubt (counter-example format). Placeholder copy that points at
   missing behaviour is missing, not cosmetic.
4. **Stage 2 — was it built well.** Test truthfulness, security grep, spec drift, visual
   comparison against a rendered neighbour. Turn each suspicion into a decidable question with
   an external hook. What cannot be evidenced is *unconfirmed*, not a finding.
5. Group findings. High (core missing, security) / medium / low. One round converges on high.

Accept: a finding with `file:line`, the rule, expected versus actual, reproduced or reasoned.
Reject: "the rest looks fine"; chasing every nit into an abstraction layer.

## Handoff

Stage 1 failures → implementer. Stage 2 defects → `root-cause-debugging`. Requirement in
doubt → `product-spec`. Orchestrator records the receipt if the profile asks for one.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, with
`Changed: none`.

Load [REFERENCE.md](REFERENCE.md) for binding, finding format, and the adversarial method.
