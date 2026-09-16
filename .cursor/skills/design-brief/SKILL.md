---
name: design-brief
description: Turns tasks, context of use, and the user's feelings into design decisions — a Design Brief (how it works) and a DESIGN.md (how it looks). Use to settle visual direction or when the user says premium, clean, modern.
---

# Design Brief

Interview the user the way a designer interviews a client: start from the task, the content, and
the environment, translate feelings into attributes, and hand downstream two sister files —
`Design-Brief.md` (information architecture, screens and their states, interaction primitives,
copy, accessibility, flows) and `DESIGN.md` (tokens in front matter plus prose on colour,
typography, layout, depth, shape, components, do's and don'ts; readable by any design tool or
coding agent). Both outrank any mock-up: when they disagree, fix the file first.

**0-1 mode**: from the spec to both files. **Iteration mode**: a direction change — ask, update
both files, remind that mock-ups and written styles must follow (remind only; never edit them).

1. Write the envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
   Requires the product spec (or the agreed requirement source); brand assets, component
   libraries, existing screens, and mock-ups are constraints to read first. No design tool is a
   precondition — the files are complete without one.
2. Identify the **form** before anything else: GUI, terminal, conversational agent, embedded
   panel, or a combination. The form decides the substance — pages and components for a GUI;
   session flow, rendering units, running states, and authorisation for a terminal or an agent.
   Wrong form, every later question is wrong.
3. Start from **task and environment**, never from colour: standing or sitting, one hand or two,
   seconds or hours, focused or interrupted, device and light; and the one action that matters
   most on each screen. Density, contrast, type size, and motion are derived from this;
   reference products only calibrate.
4. Translate every adjective into attributes and read it back. "Clean" is fewer things, more
   space, fewer colours, or simpler type — ask which. One concrete reference (a product, a place,
   an object: "a 1970s university lecture handout") carries a whole set of constraints and its
   negatives for free; "modern, clean, trustworthy" carries nothing. Offer two or three options
   with a picture, a consequence, and a real product, recommendation first; never propose a
   colour yourself.
5. Set each visual axis by a binary with anchors and no middle value — density, colour mode,
   temperature, type character, personality, radius, motion — after checking for existing brand
   assets; decide where the *one bold move* goes and keep the rest quiet. Search before the
   interview for the industry and cross-industry references, and again the moment the user names
   a product, so choices are made against current work and not from memory.
6. Design the substance: the first screen opens on the most characteristic thing in this
   product's world; every core screen gets its eight states (empty, loading, success, error,
   conflict, offline, no permission, and AI working when there is AI); **surface closure** —
   every P0 requirement has a screen, every screen has a flow that lands on it; components are
   listed once with variants and states. Agents and terminals get interaction skeleton, rendering
   units, running states, transparency, authorisation surface, and multi-surface rules instead.
7. Check the two files against the AI-generated-interface clichés and the UI quality floor in
   [REFERENCE.md](REFERENCE.md); any axis the brief did not pin that landed on a default is
   changed and the change named. The quality floor (keyboard, focus, hit targets, reduced motion,
   contrast, non-colour meaning, no dead ends) is met without announcing it.
8. Generate from `templates/design-brief-template.md` and `templates/design-md-template.md`,
   then hand off: design-prototype gets tokens, prose, screens, states, and the don'ts as its
   acceptance list; phase-build and code-review get the reading order (prototype → DESIGN.md →
   Design-Brief.md → spec, most concrete first) with the authority the other way round — a
   prototype that disagrees with the files comes back here, it is never coded against — and the
   rule that code takes colours, sizes, and radii from tokens;
   dev-plan gets screen and component counts and any class-C interaction (canvas, timeline,
   drag) that needs a spike; `progress.md` gets the form, density, theme, and reference
   decisions with their rejected alternatives.

Converged when form, context, primary action, and audience are each one sentence the user
agreed; at most five non-contradicting mood words; positive and negative references with real
products broken into attributes; every axis has a direction; brand assets confirmed present or
absent; WCAG AA and reduced motion answered; surface closure holds; every core screen has
layout, hierarchy, components, eight states, responsive direction; the handoff test passes (a
designer who was not in the room could produce the screens without guessing); and the visual
contract read back was accepted ("high-contrast accent, generous space, sans-serif, restrained
functional motion, the bold move only on the first-screen number — right?").

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**.

Load [REFERENCE.md](REFERENCE.md) for the translation table, the interview stages and question
bank, style vocabulary and reference anchors, the cliché list, the quality floor, agent UX
patterns, composition methods, and worked dialogues.
