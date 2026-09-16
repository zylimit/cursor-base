# Design Prototype Reference

## Principles

- **Complete coverage**: every UI-bearing requirement and every brief screen is named in the
  generation plan; one missing screen is one missing reference for the implementer.
- **State completeness**: default is one of eight states, not the only one; each screen's states
  are reachable from their triggers and exit by their rules. Eight state cards in a sidebar prove
  nothing.
- **Document-driven**: behaviour from the spec, visuals from the brief and `DESIGN.md`, nothing
  the documents do not describe; business decisions, design assumptions, and pure demo mechanics
  are kept apart.
- **Real content**: names, models, addresses, and numbers from the spec's cases, at realistic
  lengths, with units and empty values; fictional samples are labelled; no real sensitive records.
- **Offline and self-contained**: one file, CSS/JS/SVG inlined, no CDN, remote font, remote
  image, or runtime request; double-click opens it.
- **Quality floor without announcement**: keyboard reachable, focus visible, reduced motion
  respected, contrast met, hit areas sized, empty and error states with a next step
  (the `design-brief` skill's reference, §UI quality floor, is the full list).
- **Two passes**: a compact plan, then a cliché review, then generation — generating first and
  fixing later reproduces the defaults.

## Construction

**Pick the screen that changes the judgement.** Not necessarily the home page: the densest
comparison, the unknown-result moment, the complex edit, or the error recovery — whichever hides
the biggest unknown. Put the task's objects, states, explanations, and actions at real size and
settle reading order, grouping, alignment, density, and spatial relations first. Real or clearly
fictional content with long titles, numbers with units, and anomalous text; a few tidy short
words prove nothing about fit.

**Distil tokens from the key screen, then components.** Existing brand values and component
semantics first. New tokens come from distinctions the key screen already needs, not from a large
theme library: text and surface roles (body, secondary, boundary, floating; contrast re-checked
against every background), type and space (body/heading/number relations, in-group vs
between-group rhythm, how narrow widths and long content extend), colour roles (primary action;
success, error, unknown; selected; focus — a business result is never expressed by a hex value
alone), material and motion (surface tiers, the one necessary motion and its reduced-motion
substitute; no texture, translucency, or continuous animation without a task reason). Tokens
become CSS custom properties; then the components that truly repeat, as semantic HTML. A
component's consistency is its role: "booking state" means the same in list and detail;
"notification state" is a different fact that may sit beside it but never merges into one
unexplainable colour tag.

**Action contract** — for every action that changes a result or is easy to misread (a sentence is
enough for simple ones):

| Item | State |
| --- | --- |
| Execution boundary | real local interaction / simulated backend or external / not implemented; does the simulation survive a reload |
| Trigger | object, input, preconditions; pointer, keyboard, direct manipulation |
| Visible feedback | what the user knows immediately, which facts are still unknown, how assistive technology perceives the change |
| Retained data | input, selection, scroll position, existing results, pending items — where kept, when lost |
| Available actions | what can actually be queried, changed, retried, cancelled, left; disabled states and their rule source |
| Exit / recovery | end, return, correct, reset; what already happened and cannot be undone |

A real local tab switch is simply implemented; an external notification is labelled simulated;
unimplemented send, save, or undo is not hidden behind a success toast — a clear note or no
executable promise. The notes need not sit on every button; demo controls and boundaries are
findable, the task area speaks business language. An unknown result does not become success
without basis and a spinner does not hide the absence of a way to check.

**Asynchronous results and edits in progress.** Only when the product has background or async
work. Write the timeline first: which object and version the request targeted, what the page
changed meanwhile, what the response may change on arrival. A suggestion requested for object A
arrives after the user switched to B or edited A: keep the old suggestion with its version
label, or ask to reapply — never paste it into the field being typed in. Cancel is disambiguated
(stop waiting / drop draft / request backend cancel). Complex drag, canvas, timeline, or
multi-select is proved on the one most uncertain point (is the selection unambiguous, is the
result right after drag, is there a keyboard equivalent) with a minimal operable fragment.

**Then the remaining screens and navigation.** Extend the same rules across the matrix; a new
region must serve a confirmed task, not show off components. Track the same object across screens;
back keeps context; errors correct in place; narrow widths keep necessary content and actions,
fold the rest, and a dense table that must scroll keeps its relations rather than hiding the
deciding columns.

## Render, keyboard, and content checks

Open the file as a single file in an authorised browser or preview tool; record path, browser,
viewport or zoom, state, and action; a screenshot must be generated and looked at — a file's
existence or an exit code is not a look.

| Check | Do | Common failure |
| --- | --- | --- |
| hierarchy and visuals | key screen in default and anomalous states; reading order of object, result, explanation, actions | failure colour covers an established fact; a long title pushes the primary action out; the explanation outshouts the content |
| long content, narrow width, zoom | swap in representative long text and numbers; target narrow widths and zoom; wrapping, occlusion, scrolling, action visibility | the only identifier truncated "for cleanliness"; a fixed footer covers the error; deciding columns hidden |
| full keyboard task | entry to result to exit by keyboard; order, visibility, activation, return | Tab reaches a button that cannot be activated; focus leaves the page; a closed dialog returns focus nowhere |
| modal focus | enters the right place, stays inside, returns to the opener; allowed close paths and their data consequences | `aria-modal` without focus management; background still operable; a non-modal card traps focus |
| semantics and feedback | names, labels, error associations; state changes perceivable by assistive technology; background feedback does not steal focus | icon buttons without a name; errors only turn red; async state has no perceivable feedback |
| motion and input | reduced motion shows an equivalent end state; touch and non-hover paths where relevant | completion invisible with motion off; a key action only appears on hover |
| offline self-containment | observe real resources and requests; inlined CSS/JS/SVG; no network for any core action | inline CSS still imports a font; a script still fetches; a resource URL hides in a style |

`xmlns="http://www.w3.org/2000/svg"` is a namespace, not a download; a documentation link is not a
runtime dependency — judge by purpose and by actual requests, not by scanning for `http`.

Semantic elements, ARIA, or a passing colour pair do not equal accessibility; placeholder text has
its own readability; sizing every button identically is not a conformance claim. When the
browser is missing, will not start, or its use was declined, report the reason and the unexecuted
items; deliver the source and a reproducible walkthrough note. Static reading, rendering, keyboard
operation, assistive technology, and real-user observation are reported separately.

## Acceptance checklist

- Complete: `</html>` present, `<style>`/`<script>` balanced, no truncation (a hard criterion,
  unlike size).
- Offline: no `cdn.`, `unpkg.`, `googleapis`, remote fonts or images; no runtime requests.
- Screen coverage: every brief screen's name or defining content present.
- State coverage: the state copy the brief specifies present per screen and reachable.
- Token consistency: every hex in the file appears in `DESIGN.md` colors, or the exception is
  explained.
- Quality floor: keyboard through the main flow with visible focus; no horizontal scroll at
  390px; no animation under reduced motion.
- Clichés: ALL-CAPS eyebrows, middle-dot strings, "→" button tails, uniform radius, every
  paragraph fading in, cream-and-terracotta — each hit is kept with a reason or changed.
- Size is only a hint: multi-screen prototypes are usually over 20KB, a minimal page may be a few
  KB; under 3KB is worth a look, not a failure.

A failed acceptance means adjusting the plan and regenerating; two rounds of the same failure with
no new evidence stop and report the blocker.

## Task walkthrough

Give the goal, the starting data, and the constraints — not the clicks ("find a suitable Sunday
afternoon session, book it, and decide whether the booking succeeded"). A participant following
"click the second row, then the blue button" only proves they can follow orders. An agent's own
dry run may follow a preset route and is labelled a self-check.

| Observation | Evidence gained | Not a licence to claim |
| --- | --- | --- |
| did they find the right session | information used, search or compare route, stalls | every user finds it |
| did they understand the booking feedback | their explanation of result and next step | the backend accepted or notified |
| could they continue after a wrong head count | error copy, retained input, correction route | all business rules are right |
| could they resume after an interruption | state actually retained and the recovery path | cross-device or persistence reliability |

Unknown results are never dressed as success or failure: if the spec allows "submitted, result
pending", the demo triggers it and shows only what the person can know and the confirmed next
actions. A still-undecided rule is shown as "under discussion" with the question, and the rest
of the prototype proceeds. Simulated confirmation numbers, sends, and saves are labelled demo;
the task area keeps business language.

One finding travels: "the participant saw the red 'send failed', assumed the booking failed, and
prepared to book again; the rule says a failed notification never cancels a booking." Check the
rule's source first; never change the success condition to make one state disappear. Propose
separating booking result from notification follow-up in hierarchy and copy with the confirmed
check-in entry; disagreements about the rule go back to the spec. Corrections update the
requirement, the brief's state text, the prototype region, the implementation task, and the
acceptance example together — a recoloured button alone lets the next code inherit the old
reading.

Record: scenario, version and path, data, real participant or agent self-check; what was done and
seen, de-identified quotes; which assumption was supported or refuted, what is still uncertain;
where it was revised, on what business basis, and which routes were not walked. No observation →
"not observed"; "all buttons work" and "no complaints" are not satisfaction.

## Prompt mode

When the HTML will be generated by a tool outside this session, the preparation does not change:
matrix, design plan, cliché review, and then one prompt (`demo/design-prompt.md`) that carries
the `DESIGN.md` front matter and prose with its hard-constraints table, the design plan
(wireframes, the bold move, the one motion), per screen its ID, regions, hierarchy, real content,
interactions ("click X → Y"), eight states, breakpoints, and navigation, the component list with
variants, the copy rules, the quality-floor summary, and this fixed tail:

```text
Output: single self-contained index.html, all CSS and JS inlined.
ZERO external dependencies — no CDN, no unpkg, no googleapis. Must work fully offline.
Cover every page and all required state variants. Use the provided real data, no Lorem ipsum.
Use only the color / type / radius / spacing tokens given above; do not invent new hex values.
Respect prefers-reduced-motion; all interactive elements keyboard-reachable with visible focus.
```

The returned HTML lands in `demo/index.html` and goes through the same acceptance checklist.
