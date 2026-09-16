---
name: design-prototype
description: Builds a self-contained offline interactive HTML prototype from the spec and design brief so stakeholders can walk their task and implementers have a reference. Use when a clickable mock-up is wanted.
---

# Design Prototype

One artefact, two uses: implementers code against it, stakeholders open it in a browser and try
their task. Default location `demo/index.html`; an existing prototype keeps its path. The
prototype is written directly into the repository by the agent — no generator service, no
external design tool, no new dependency.

1. Write the envelope: **Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation**.
   Requires the product spec and the design brief (or the agreed sources); `DESIGN.md` supplies
   tokens — without it, derive a temporary token set from the brief, mark the prototype
   "without DESIGN.md", and recommend completing the brief.
2. Build the **coverage matrix** — requirement or task → screen or region → interaction → state →
   acceptance anchor — from the spec's flows and the brief's screens (`SCREEN-n`, `CMP-n`, the
   eight states). Every UI-bearing requirement and every brief screen is named in it; the anchors
   come from confirmed rules, the sample data is representative but explicitly fictional.
3. Plan in two passes before writing. Pass one, the **design plan** (`demo/design-plan.md`):
   token excerpt (four to six named colours, type roles, radius and spacing scale), a text
   wireframe per screen with alignment notes, what the first screen opens on, where the one bold
   move goes, the single choreographed motion, the component reuse list. Pass two, the **cliché
   self-review**: walk the AI-cliché list and the brief's don'ts (the `design-brief` skill's
   reference carries both);
   anything that is "what any page of this kind would get" rather than a choice for this product
   is changed and the change written down. Only then generate.
4. When direction is still open, produce three complete first-screen **direction samples** in
   `demo/directions/` — three personalities (density, weight, motion hint, character), not three
   recolours — for the user to pick; one redo at most on their feedback.
5. Build key screen → tokens → components → states → remaining screens. Tokens become CSS custom
   properties; components are semantic HTML (buttons act, links navigate, labels bind inputs,
   tables hold two-dimensional data); every core action has an **action contract** — execution
   boundary (real local interaction / simulated backend / not implemented), trigger, visible
   feedback, retained data, available actions, exit or recovery — and a reset path so a
   walkthrough can be repeated. Real content from the spec and brief, never lorem ipsum; long
   titles, units, empty values, and error text included on purpose.
6. Treat unknown results honestly: a simulated request that has no confirmed outcome does not
   turn green on click; a stale response arriving after the user edited does not overwrite the
   edit; cancel means what the rule says (stop waiting, discard a draft, or request a backend
   cancel) and a fact already formed does not vanish when a dialog closes.
7. Accept with the checklist in [REFERENCE.md](REFERENCE.md): document complete and balanced;
   no runtime network dependency (check what each URL is for — an SVG namespace is not a
   download); every matrix cell present and locatable; states reachable through their triggers;
   token consistency (`grep -o '#[0-9a-fA-F]\{6\}' | sort -u` against `DESIGN.md`); keyboard,
   narrow width, reduced motion, long content actually exercised; cliché list walked. Where a
   browser is available and its use is authorised, open the file, look at the key screens and
   states, save the screenshots as evidence; where it is not, deliver the file with "rendering
   unverified" — never a fake screenshot, never an installed tool nobody approved.
8. Optionally run a **task walkthrough**: give a participant the goal, not the clicks; watch
   whether they find the entry, the deciding information, understand the action's consequence
   and the result, and recover from one relevant anomaly; record actions, quotes, and stalls —
   an agent's own dry run is labelled as such. Findings return to their source: layout and
   readability to the brief, meaning and permissions to the spec, cross-module promises to
   architecture-design and dfx-design.

Deliver the path, how to open it, the coverage summary (screens n/n, states n/n), the walkable
scenarios, the simulation boundaries, and what was and was not verified. Reading order for
downstream, most concrete first: `demo/index.html` → `DESIGN.md` → `Design-Brief.md` →
`Product-Spec.md`; authority runs the other way — where the prototype disagrees with the brief or
the tokens, the prototype is wrong and comes back here after `design-brief` has ruled.

Return **Status / Changed / Verified / Not verified / Needs review by / Evidence**; for product
work add **Business assumptions / Counter-examples / Domain findings**.

Load [REFERENCE.md](REFERENCE.md) for the construction method, the action-contract table, the
render-and-keyboard checks, the acceptance checklist, the walkthrough method, and the prompt mode
for when the HTML is generated elsewhere.
