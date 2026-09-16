---
name: code-review
description: Adversarial, defect-first, read-only review bound to a base commit and diff hash — static gate, spec conformance, then quality; every finding located. Use for pull requests, branch diffs, and pre-merge review.
---

# Code Review

The change is guilty until an attempt to break it fails. "Already implemented" and "roughly
matches" are not accepted; a function either has code at `file:line` or it does not; "passed"
without compiler output, a response, or a numeric comparison is no review at all. The reviewer
did not write the change — a self-review cannot carry an approval (`authorship show`).

1. Establish **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation** and bind
   the target to the full base commit and canonical diff hash (`review-pack` builds the pack with
   deletions and renames in their own sections). Read the dispatch's Business Context — why, who
   benefits, the rules and exceptions, the distinguishing example; a review without it writes
   "business context not checked", which is not the same as "no problem".
2. **Stage 0 — the machine speaks first.** Run the project's own static checks (type check, lint,
   `node scripts/harness.mjs fitness`); a linter's findings are not for a person to hunt. Errors
   stop the review here until they are green; a stack with no static tool installed is reported
   `BLOCKED` under `Not verified` (a missing tool is never a pass and never "skipped") and the
   review continues with the stacks it can check.
3. **Stage 1 — was the right thing built.** Walk every spec item in scope (plus the current plan
   task's delivery list), one verdict each: ✅ complete (item, `file:line`, how verified),
   ⚠️ partial (what is missing), ❌ missing (quote the spec), ❓ **requirement in doubt** — the code
   matches the spec but the spec does not match the business (an exception would route wrongly,
   an `[inferred]` item meets contrary evidence, the beneficiary gets a worse result than the
   "why" promised); write it as a counter-example (scenario → what the spec gives → what the
   business needs → basis) in its own section; it is not a stage failure and it never becomes an
   edit to the spec by the reviewer. Placeholder copy that points at behaviour that does not exist
   is missing, not cosmetic. With a design reference, compare the theme configuration against
   `DESIGN.md` tokens value by value, find each required state of the screen in the code, and
   spot-check the quality floor (contrast, focus, hit targets, reduced motion).
4. **Stage 2 — was it built well.** Naming, no untyped escape hatches, single responsibility, no
   duplicated logic, every async path with a handler, every user action with an error message;
   **test truthfulness** — not whether tests exist but whether they prove behaviour: fixtures on a
   true premise (units, reachable inputs, assertion direction), error, empty, and boundary states
   actually reached, a test that exists but did not run counts as missing; a security grep
   (`eval`, raw HTML injection, browser-exposed secrets, string-built SQL, personal paths,
   key-shaped literals); **spec drift** — pages, routes, endpoints, tables, or components the spec
   never mentioned, flagged ⚡ (could be a good extension, could be scope creep); visual
   comparison against a rendered neighbour, not against a component count.
5. Turn each suspicion into a **decidable question** ("is the index at X ever out of range", "does
   spec item N's behaviour hold on input Y") answerable by one command or one snippet; verify each
   independently with an external hook — a grep hit, runner output, compiler output, a spec quote —
   never "it reads fine to me". What cannot be evidenced is *unconfirmed*, not a finding. Where a
   browser driver exists, drive the core path, the error path, state changes, and navigation; the
   interaction evidence outranks reading.
6. Report only what affects correctness or an agreed requirement: **high** (core function missing,
   security), **medium** (supporting function, UI detail, code quality), **low** (enhancement);
   style preferences and "potential issue on a specific input" are not reported — a reviewer told
   to find gaps always finds something, and chasing each one buys abstraction layers, defensive
   code, and tests for the impossible. Every finding: `file:line`, the rule and its source, the
   minimal initial state, action, expected versus actual, whether it was reproduced or reasoned,
   the concrete impact, the minimal fix direction. Group by complete / partial / missing / drift /
   requirement in doubt / security / quality; no findings is stated with the paths attacked and the
   test gaps seen.
7. Hand the outcome back for recording: a read-only `reviewer` delegate returns its findings and
   decision, and the orchestrator writes the receipt — `node scripts/harness.mjs receipt
   --reviewer <name> --decision approve|request-changes` — naming the reviewer, since the reviewer
   is never the author and a delegate that writes state is no longer read-only. An agent running
   this skill directly as the orchestrator writes it itself. An approving receipt closes a
   `balanced` task; under
   `strict`, or at a trust boundary, use `structured-review`, whose verdict the engine computes.
   The receipt dies with any change to base, diff bytes, scope, or exclusions.

Routing after the review, for the orchestrator: stage 1 failures return to the implementer; stage
2 quality and refactoring go to `scoped-implementation`, defects and security to
`root-cause-debugging`; requirement in doubt goes to `product-spec` iteration mode (the spec
changes and the item is re-reviewed, or the doubt is closed into the clarification log). One round
converges on **high** findings only; fixes are re-checked once by the same reviewer; medium and low
go to `progress.md` as residue for later tasks. How much review a tier buys lives in one table, in
`docs/PRODUCT-WORKFLOW.md`: a MEDIUM-tier change buys stages 0 and 1 of this skill, a HIGH-tier
change is reviewed by `structured-review` instead, LOW is not reviewed by this skill at all.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**, with
`Changed: none`; for product work add **Business assumptions / Counter-examples / Domain
findings**.

Load [REFERENCE.md](REFERENCE.md) for binding, the finding and receipt formats, the truthfulness
checks, and the adversarial method.
