---
name: domain-rulings
description: Keeps a domain-rulings library in domain/ (how things are counted in this field, independent of the code) — triages knowledge, records qualified rulings, answers what a value means now. Use to record a ruling.
disable-model-invocation: true
---

# Domain Rulings

A ruling says how something is *calculated* in this domain. It survives a rewrite of the code.
That is what separates it from a project decision (`progress.md`), a method lesson (the
feedback corpus), and a functional requirement (the spec). The library is a by-product, never
a gate. A project without `domain/` is normal.

## Task

Triage knowledge; record a qualified ruling in `domain/<domain>.md`; or answer what a value
means now.

## Preconditions

- Carrier: `domain/<domain>.md` at the project root, one file per domain of the field, not per
  module of this project. `domain/_unsorted.md` for what has no home yet.
- Invoke by name, or when a receipt reports Domain findings that survived triage.

## Invariants

- Triage by **who knew this originally?** User knew, agent did not → spec. Agent knew, user
  did not → ADR or `progress.md`. Both knew → spec body. Neither knew, joint investigation →
  the library, the only entrance. Ask the question and wait; never offer the answer.
- Two admission questions: which step of the next output will differ? Does it still hold once
  this project's work is finished? Fail either → do not record.
- A ruling needs **two basis kinds** (measured, public source, organisational). Memory and
  inference are refused. Measurement alone is a clue, not a ruling.
- Current value is a criterion ("join key = OLT IP, name forbidden"), never a narration
  ("usually the IP").
- Old wording is marked, never deleted. The model cannot read the git log.

## Method

1. Recognise the request (record, look up, review queue, dependants, unsolicited knowledge).
   When unsure, ask "record or look up?"
2. Triage. Fill the seven columns: current value, basis, applicable scope, supersedes, expiry
   condition, depended on by, known contamination. One criterion per ruling.
3. Changes: revision (same criterion, new value → new version); supersession (new ruling
   replaces old, old marked); narrowing or widening (same value, different scope — the one
   most often missed).
4. Read rulings at dispatch time, never at session start.

Accept: two basis kinds and a next-output difference. Reject: recording a batch scope limit;
treating a NULL column this session as a ruling rather than known contamination.

## Handoff

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.
