---
name: record-lesson
description: Records a correction, incident, or recurring pattern as a lesson in the feedback corpus, and proposes graduation into an enforced rule once it recurs. Use after a user correction, a defect with a generalizable cause, or when the risk scan reports graduation candidates.
---

# Record Lesson

1. Decide whether it is a lesson: a user correction, an incident with a generalizable cause, or
   the same friction seen again. Prefer missing a marginal lesson over flooding the corpus —
   a corpus nobody trusts records nothing.
2. Check `node scripts/harness.mjs feedback list` first. If the lesson exists, increment its
   `occurrences` and update `last_seen` instead of writing a duplicate.
3. Otherwise copy `docs/feedback/TEMPLATE.md` to `docs/feedback/<kebab-case-id>.md`: frontmatter
   (`id` equal to the filename, `occurrences`, dates, `graduated: false`), a one-sentence
   title, what happened, what to do instead, and the evidence.
4. Run `node scripts/harness.mjs feedback lint`; a malformed lesson fails validation for the
   whole repository, which is deliberate — unreadable memory is no memory.
5. When `feedback list` reports a graduation candidate (three or more occurrences), propose —
   with the user's confirmation — promoting it into something enforced: a rule, a skill step, a
   fitness rule, or a verification check. Then set `graduated: true` and keep the file as the
   record of why the rule exists.

Prefer graduating into an executable check over more always-applied prose: instruction text
costs context on every request, a check costs nothing until it fires.

Return the standard receipt: **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for the writing contract, scoring honesty rules, and
graduation targets.
