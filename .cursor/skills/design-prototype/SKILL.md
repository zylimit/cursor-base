---
name: design-prototype
description: Builds a self-contained offline interactive HTML prototype from the spec and design brief so stakeholders can walk their task and implementers have a reference. Use when a clickable mock-up is wanted.
disable-model-invocation: true
---

# Design Prototype

One artefact, two uses: implementers code against it, stakeholders open it in a browser and try
their task.

## Task

Write a self-contained offline HTML prototype (default `demo/index.html`) directly in the
repository. No generator service, no external design tool, no new dependency.

## Preconditions

- Product spec and design brief (or the agreed sources). Without `DESIGN.md`, derive a
  temporary token set from the brief, mark the prototype "without DESIGN.md", and recommend
  completing the brief.
- Invoke by name.

## Invariants

- Real content from the spec and brief, never lorem ipsum. Long titles, units, empty values,
  and error text included on purpose.
- A simulated request that has no confirmed outcome does not turn green on click. A stale
  response arriving after the user edited does not overwrite the edit.
- The files outrank the prototype. A prototype that disagrees with the brief comes back to
  `design-brief`; it is never coded against.

## Method

1. Write the envelope. Build the **coverage matrix** — requirement → screen → interaction →
   state → acceptance anchor. Every UI-bearing requirement and every brief screen is named.
2. Plan in two passes before writing. Pass one, `demo/design-plan.md` (tokens, text wireframes,
   first-screen content, one bold move, one motion, component reuse). Pass two, the cliché
   self-review against the brief's don'ts. Only then generate.
3. When direction is still open, produce three complete first-screen samples in
   `demo/directions/` — three personalities, not three recolours. One redo at most.
4. Build key screen → tokens → components → states → remaining screens. Tokens become CSS
   custom properties. Every core action has an **action contract** and a reset path.

Accept: a stakeholder can walk the user's own case without a network. Reject: a screenshot
gallery; a new npm dependency "just for the mock".

## Handoff

Implementers and `code-review` use the prototype as the most concrete reference, with the
brief and DESIGN.md as authority when they disagree.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**.
