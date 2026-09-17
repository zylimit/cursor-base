---
name: design-brief
description: Turns tasks, context of use, and the user's feelings into design decisions — a Design Brief (how it works) and a DESIGN.md (how it looks). Use to settle visual direction or when the user says premium, clean, modern.
disable-model-invocation: true
---

# Design Brief

Interview the way a designer interviews a client. Start from the task, the content, and the
environment. Translate feelings into attributes.

## Task

Hand downstream two sister files: `Design-Brief.md` (how it works) and `DESIGN.md` (how it
looks). Both outrank any mock-up: when they disagree, fix the file first.

- **0-1** from the spec to both files.
- **Iteration** a direction change — ask, update both files, remind that mock-ups must follow
  (remind only; never edit them from here).

## Preconditions

- Product spec (or the agreed requirement source). Brand assets, component libraries, existing
  screens, and mock-ups are constraints to read first.
- No design tool is a precondition. Invoke by name.

## Invariants

- Form before colour: GUI, terminal, conversational agent, embedded panel, or a combination.
  Wrong form, every later question is wrong.
- "Clean" is fewer things, more space, fewer colours, or simpler type — ask which. A concrete
  reference carries constraints; "modern, clean, trustworthy" carries nothing.
- Never propose a colour yourself. Each visual axis is a binary with anchors and no middle
  value.
- Every core screen gets its eight states. Every P0 requirement has a screen; every screen has
  a flow that lands on it (**surface closure**).

## Method

1. Write the envelope. Identify **form**. Start from **task and environment**, never from
   colour.
2. Translate every adjective into attributes and read it back. Offer two or three options with
   a picture, a consequence, and a real product, recommendation first.
3. Set each visual axis. Decide where the *one bold move* goes and keep the rest quiet.
4. Design the substance. Agents and terminals get interaction skeleton, rendering units,
   running states, transparency, and authorisation instead of pages.
5. Check both files against the AI-interface clichés and the UI quality floor in REFERENCE.md.
   Generate from the templates.

Accept: a named form, a named primary action per screen, tokens in DESIGN.md front matter.
Reject: asking "what UI do you want?"; coding against a prototype that disagrees with the
files.

## Handoff

`design-prototype` gets tokens, screens, states, and don'ts. `phase-build` and `code-review`
read prototype → DESIGN.md → Design-Brief.md → spec (most concrete first); authority runs the
other way. `dev-plan` gets screen counts and class-C interactions.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.

Load [REFERENCE.md](REFERENCE.md) for axes, clichés, and the quality floor.
