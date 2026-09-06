---
id: subagent-dispatch-minimal-context
occurrences: 2
first_seen: 2026-09-06
last_seen: 2026-09-06
graduated: false
---

# A delegation names the file, the line, the exact change, and one verifying command

Two harnesses in one day dispatched sub-agents with a goal and a pile of source to read, and
let them re-derive the change, re-review it, run their own cross-checks, and write long
receipts. A four-line fixture fix rolled to sixty tool calls in one repository; a structured
self-review of one change ran six rounds in this one, each round closing the next branch of the
same defect. The user corrected both: "sixty rounds", "why so many rounds".

Give a delegation the conclusion, not the investigation: `file:line`, what it becomes, and the
one command that proves it, with a budget of roughly eight tool calls. If the budget is exceeded
the dispatch was too wide or too thin; narrow it and re-dispatch instead of letting the sub-agent
keep exploring. Review once, in the orchestrating agent. A change under five mechanical lines is
made directly. A reviewer is handed one question at a time.

Evidence: cc-base `.claude/feedback/subagent-dispatch-minimal-context-not-self-derivation.md`
(2026-09-06); this repository's 2.0 self-review, rounds 1–6 (`progress.md`, Decisions
2026-09-06 "One walker classifies a parsed command"), where the fix was to collapse the defect
class rather than open a seventh round. The three-round escalation in `review verdict` is the
executable half of this lesson.
