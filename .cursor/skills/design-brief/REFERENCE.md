# Design Brief Reference

The interview rules (five rules, four knives, failure modes, replay formula) are shared with the
`product-spec` skill and documented once there, in its reference under §Interview rules; read
them before interviewing.

## Feeling → attribute translation

Never accept an adjective as a decision; translate, then read back.

| The user says | Translate into | Follow-up |
| --- | --- | --- |
| clean / simple | more whitespace, restrained palette, fewer weights | fewer things, more space, fewer colours, or simpler type? |
| premium | high contrast, generous negative space, one restrained accent, precise serif or sans, slower and looser spacing | Apple's whitespace or Hermès' dark-and-gold? name a premium object, not a product |
| modern | flat surfaces, sans-serif, bright saturated accent, simplified icons | modern as in this year — which product looks "like now" to you? |
| fashionable / trendy | one bold move (a strong colour, a large type, one motion), everything else very quiet | reference this year's products, not three years ago |
| compact professional tool | compact density, 4px spacing step; alerts, forms, and small hit areas do not shrink | which information must be visible at once? |
| playful | pill radii, warm bright colours, expressive motion | for whom, and where does seriousness still matter? |
| technical / engineering | mono or near-mono type, restrained palette, high information density, functional motion, square precise borders | which values are compared side by side? |
| transparent, trustworthy (agent) | shows what it is doing, previews before acting, interruptible, never a black box; AI activity has its own visual language not lent to ordinary controls | which actions must be seen before they run? |
| quiet / calm | low saturation, small size steps, slow sparse motion, no decorative graphics | — |
| alive | one motion that responds to the user's action (open, expand, confirm), not every paragraph fading in | — |
| professional | which kind: a TED speaker's warm authority, a keynote's reverence, a consultancy's cold data? | — |
| handmade / human | warm base, humanist type, irregular whitespace — not a handwriting font | — |

## Interview stages and question bank

Six stages, business before visuals; labels stay internal. Each item has an intent, a main
question, an evasive-answer follow-up, an acceptance bar, and rejected answers. Anything already
in the spec (context of use, primary action, flows, non-functionals) is absorbed, not re-asked.

**Stage 1 — form, audience, context.** Form (GUI / terminal / conversational agent / embedded /
combination; "a terminal coding assistant" is terminal + agent, no side navigation to place);
context and primary action per surface ("what were they holding, how often were they
interrupted last time?"; "all important" → "the one thing you most want them to do within three
seconds"); single goal, product type (reading, dashboard, transaction, marketing, workbench;
one-shot command or long-running agent), audience and its aesthetic expectation (developers dark
and dense, consumers warm and guided, field operators large type and large buttons). Reject: a
default assumption of "web app"; "normal use"; "everyone"; colours first.

**Stage 2 — mood and personality.** Three to five non-contradicting mood words (eight given →
cut; "lively and steady both" is neither); one concrete reference object with what is right about
it and the three don'ts it implies ("a Swiss watch manual": restrained, precise, mostly
monochrome, structure by hairlines not shadows, small size steps → no gradients, no glow, no
rounded cards); three operational design principles that each say what they rule out ("density
over decoration"). Reject: wish lists; abstract words without a picture; "good-looking" as a
principle.

**Stage 3 — references and anti-references.** Three to five admired products with the specific
thing admired, form and content separated ("strip the colours and animation — what must remain?");
a dense data tool borrowing Apple's marketing whitespace is a mismatch — density follows audience
and content, not taste; terminal and agent products anchor on same-form products, borrowing mood
but never layout. Two or three anti-references with what is wrong ("no attitude" → "which screen
do you close immediately?"); the cliché list below is shown and defaults to anti-reference.
Search twice: before the stage for industry and cross-industry references and current trends;
again the moment the user names a style or product, as a query not an answer, bringing back two
to four same-tone references for a forced choice, then narrowing across spacing, colour, type,
motion, tone. With a rendering path available, close the stage with three complete-personality
first-screen samples (not recolours) for the user to pick; without one, describe three pictures
in words.

**Stage 4 — axes and tokens.** First: existing logo, brand colour, or visual identity to keep?
Then one axis per question with real anchors and no middle value: density (comfortable vs
compact; can power users switch?), colour mode (light, dark, both — which default, is dark
first-class?), temperature (cool vs warm vs neutral), type character (geometric sans vs humanist
serif vs mono; one or two families, clearly different), personality (1 bold-with-opinion to 5 safe;
where does the one bold move go?), radius (sharp 0–2px, soft 8–12px, pill), motion (snappy and
invisible, expressive, none; one choreographed moment or everywhere?). Terminal and agent forms
mark radius, shadow, breakpoints N/A and add: rendering primitives (ASCII vs box-drawing), colour
depth (16, 256, true colour), degradation by column width (what collapses at 80 columns). WCAG AA
and reduced motion are answered here. Reject: middle values; dark mode or compact as a later skin;
accessibility left blank.

**Stage 5 — core presentation and states.** GUI: each screen with design latitude gets a visual
direction and a reference; the first screen opens on the most characteristic thing in this
product's world (a number, an image, an action in progress, a directly usable input) — "big title
plus three numbers" is a default, used only if it is truly best. Eight states one at a time: empty
is an invitation, loading mirrors the final layout, error says what happened and the next step,
conflict says who changed it, offline says what still works, no permission says what they see, AI
working when applicable. Terminal and agent: interaction skeleton (natural language, slash
commands, shortcuts; modes such as plan / read-only / auto / background; one turn's shape; how the
empty prompt is not empty — examples, templates, suggestions); rendering units (user message,
agent reply, tool call, diff, command output, thinking, plan, to-dos, citations; highlight,
colour, fold); running states (streaming, thinking, running tool X, awaiting approval,
interrupted — a redirect, not a failure —, background, long-task progress; AI's own visual
language); transparency (how much reasoning, action trail, sources); authorisation (action
classes, granularity per call / per session / permanent, dangerous-action interception, approval
surface); multi-surface consistency (which shells, which is first, what stays identical).

**Stage 6 — structure and specification.** Navigation and screen list, each screen tied to a
spec flow or scope item, surface closure checked; per screen: layout regions (a workbench marks
the incompressible main task area; auxiliary panels reuse an existing sidebar, tab, drawer, or
context panel before a second sidebar appears), content hierarchy, components, eight states,
responsive direction; components once, with variants and states, inheriting an existing UI
system and writing only the delta; copy tone and rules (verb-first buttons that name the result,
one name per action throughout, errors that give a next step without apology, empty states that
invite); breakpoints for mobile, tablet, desktop, and a max width for ultra-wide.

## Style vocabulary and anchors

Each style: character, fits, does not fit, caution. When the user names one, ask which single
aspect they want; learn one thing, never copy the set.

| Style | Character | Fits | Does not fit | Caution |
| --- | --- | --- | --- | --- |
| Swiss / editorial grid | strict grid, generous space, restrained weight, structure by alignment | reading, docs, brand, professional tools | consumer flows needing strong guidance | easily bland; the bold move needs a home |
| Dense workbench | 32px rows, hairline tiers, tabular numerals, status dots | dashboards, admin, operations, finance | first-time consumers | density follows content and audience |
| Paper / e-ink | warm paper base, single ink, hierarchy by lightness, no shadow | desk tools, review, annotation | real-time monitoring needing many semantic colours | meaning by shape, not colour |
| OLED dark workspace | near-black, hairlines, very little colour | developer tools, editing, long sessions | field operation in bright light | pure black glares; dark is not inverted light; test contrast separately |
| Glass | translucent layers, refraction, depth | system chrome, hero areas, media | dense content, low-end devices, text-heavy pages | costs GPU; contrast hard to hold; chrome and hero moments only, flat underneath |
| Expressive material | motion tokens, dynamic colour, expressive shape | native mobile, consumer apps | desktop professional tools | motion has a physical model; not a pile of transitions |
| Neo-brutalist | thick black borders, high contrast, huge type, hard alignment | creative brands, events | back offices, finance | "ugly on purpose" needs total control |
| Bento grid | modular cards, uneven grid | feature aggregation, marketing | long flows, forms | falls straight into the "SaaS card kit" cliché |
| Soft / clay | rounded volumes, soft shadows | children, education, light consumer | professional tools | large radii need a hierarchy, never uniform |
| Aurora gradient | one gradient as the only accent | marking AI activity, brand punctuation | full-screen gradient backgrounds | one role only (for example only the AI's actions), never a background |
| Terminal | mono, ANSI colour, box-drawing, column degradation | CLIs, coding agents | consumers | decide what collapses at 80 columns |

Anchor pairs, checked against current versions before use: density Linear vs Notion; temperature
Stripe vs Airbnb; formality a trading terminal vs Figma; hierarchy Apple vs a dense-but-clean
dashboard; navigation sidebar vs bottom tabs vs command palette; theme GitHub (dark default) vs
Google Docs (light default); radius iOS vs Windows; illustration Dropbox vs none; developer tools
a warm cream editor with one orange vs a dark terminal with an aurora; AI products conversation
plus canvas vs citation-first.

Trend notes (calibration, never answers): flat foundation with glass or expressive motion only in
chrome and hero moments; tokens in three layers (primitive → semantic → component) named by
intent (`color-action-primary`, not `blue-500`) with accessibility constraints inside — the
DESIGN.md is read by machines; AA is the floor, not a bonus; agent products have non-linear
flows, autonomy as a dial, approvals only at irreversible points, and their own visual language;
one or two type families, and a ubiquitous default sans used as "personality" is no personality.

## AI-generated-interface clichés

These are defaults, not choices, and appear on any subject. An axis the brief pinned follows the
brief; an axis it did not pin may not land here. After generating, walk the list and name each
change made.

Five clusters: (1) cream base near `#F4F1EA`, high-contrast serif headline, terracotta accent
near `#D97757`; (2) near-black base with a single acid green or vermilion accent; (3) newspaper —
hairlines, zero radius, dense columns; (4) the SaaS card kit — content sliced into same-radius,
same-grey-shadow cards, gradients as decoration; (5) template ornaments — letter-spaced ALL-CAPS
eyebrows over every heading, "A · B · C" middle-dot metadata, "WORD — fragment" labels, `#0B0B0B`
or `#111` posing as black, mono for small data labels, "→" tails on links and buttons.

Typography: one word in a heading recoloured or italicised; all-caps labels; explanatory labels
above content; "01 / 02 / 03" numbering on non-sequences. Motion: every paragraph fading up, every
card lifting on hover — keep one choreographed moment, everything else responds only to the user.
Layout: over-centering, purple gradients, uniform radius, a default sans as personality. First
screen: big number + small label + supporting stats + gradient accent — only if truly best; ask
what the most characteristic thing in this product's world is.

## UI quality floor

Style is a choice; the floor is not. Any style, any industry, mock-ups and code alike — read as a
graphical-interface floor: the items below are CSS and DOM shaped, and a focus ring or a hit area
means nothing in a stream of text. For a terminal or conversational-agent form the equivalents are
§Agent UX patterns here and §A of the brief template. Audit
output is `file:line — issue`, one per line, explanation only when the fix is not obvious; a clean
pass is "✓ pass".

- Keyboard and focus — MUST fully operable by keyboard with tab order matching visual order;
  focus ring visible and not hidden under sticky or fixed elements; focus trapped inside a modal
  and returned on close. NEVER `outline: none` without a replacement.
- Hit areas and input — MUST ≥24px, ≥44px on touch (enlarge the hit area when the visual is
  smaller); ≥16px input text on mobile; `touch-action: manipulation`. NEVER disable browser zoom.
- Forms — MUST allow paste; submit stays enabled until the request starts, then disables with
  progress and the original label kept; Enter submits a focused input, Ctrl/Cmd+Enter a textarea;
  accept free input first and validate after; inline errors beside the field, focus moves to the
  first error on submit; `autocomplete`, meaningful `name`, correct `type` and `inputmode`; warn
  before leaving unsaved; label and control share one hit area. SHOULD turn off spellcheck for
  emails, codes, usernames; placeholders end with "…" and show the format.
- State and navigation — MUST URL reflects state (filters, tabs, pages, expanded panels are
  deep-linkable); back restores scroll; navigation uses real links (modifier-click, middle-click
  work). NEVER `<div onClick>` as navigation.
- Feedback — MUST destructive actions confirm or offer an undo window; toasts and inline
  validation use polite live regions. SHOULD optimistic updates roll back or offer undo; options
  that open a follow-up dialog end with "…".
- Touch and drag — MUST generous targets, first tooltip delayed then immediate, `overscroll-behavior:
  contain` inside popovers, no text selection during drag, pointer and keyboard alternatives for
  every gesture, anything that looks clickable is.
- Motion — MUST respect reduced motion; animate only `transform` and `opacity`; interruptible by
  input; anything auto-playing over 5s can pause, stop, or hide. NEVER animate top/left/width/height
  or use `transition: all`.
- Layout — MUST deliberate alignment to a grid, baseline, or edge; verified on mobile, laptop, and
  ultra-wide; safe-area insets respected; no accidental scrollbars.
- Content and accessibility — MUST skeletons mirror final content; `<title>` matches context; no
  dead ends; empty, sparse, dense, and error content states designed; tabular numerals for
  comparison; meaning never by colour alone, icons have text; visible-label omission still leaves
  an accessible name; the ellipsis character, not three dots; heading hierarchy and a skip link;
  robust to user-generated content of any length; localised dates and numbers; accurate labels,
  decorative elements hidden from assistive technology; native semantics before ARIA; captions or
  transcripts for media; non-breaking spaces before units, shortcuts, brand names.
- Content handling — MUST long text truncates, clamps, or breaks; flex children get `min-width: 0`
  to truncate; empty strings and arrays do not break the layout.
- Performance — MUST mutations target < 500ms; lists over 50 items virtualise; first-screen images
  preloaded, the rest lazy; images carry dimensions.
- Dark mode — MUST `color-scheme: dark` on the root; native selects get explicit colours; base from
  `#121212`, never pure black; hierarchy by white overlay, not by darker; primaries desaturated;
  deepest layer to white text ≥ 15.8:1.
- Design — MUST colour-blind-safe charts; contrast passes (APCA preferred, WCAG 2 accepted);
  hover, active, focus increase contrast rather than reduce it.

Anti-patterns to name on sight: `user-scalable=no`, paste blocked, `transition: all`, outline
removed, a div as a button, images without size, an unvirtualised large map, unlabelled inputs,
icon buttons without a name, hard-coded date formats, unexplained autofocus, GIF where video
would do, a gesture with no click or keyboard path.

## Agent UX patterns

For products with AI features or that are conversational agents.

Vocabulary by the six moments of the relationship — offer the user names to point at, never the
whole set: **wayfinders** (help them start: example galleries, clarifying questions, a large open
input, nudges about what is possible, "surprise me", suggestion chips, fillable templates — the
blank input is where AI products fail first); **inputs** (autofill, chained actions, describe,
expand, act-in-place, partial regenerate, fixed-format repeat, regenerate, restructure, restyle,
summarise, synthesise, cross-modal); **tuners** (attachments, connectors, filters by source or
type, model, mode, parameters, presets, prompt enhancement, saved styles, tone); **governors**
(plan before acting, branches that keep the way back, citations, pausable and redirectable, cost
estimate, draft mode, memory controls, sample confirmation before a complex prompt, live shared
canvas, visible thinking and tool stream, variants to choose from, confirm before executing);
**trust builders** (state limits, ask consent, data ownership, label AI output, trace every step,
incognito, watermark); **identifiers** (avatar, colour, icon, name, personality). Failing agent
products almost always fail at wayfinding, governance, or tuning.

When to interrupt — four criteria, not every action: irreversibility (delete, send, pay, publish:
always; read, search: never); scope (external systems and other people's things more than local);
confidence (low grasp of intent → ask first); cost (large calls, long computation → confirm).
Autonomy is a dial — suggest → confirm → auto-reversible → auto-irreversible — earned by
performance, not demanded at launch. Asking on every step trains users to approve blindly.

Approval surface: show the diff, not the result; let them edit the 10% then approve, instead of a
binary approve/reject; batch approvals for lists; gate only at publish, send, pay, delete;
propose before committing (an approval after the side effect is an incident log); synchronous
for decisions needed now, a queue for later ones.

Running states: streaming, thinking, running tool X (name it), awaiting approval, interrupted (a
redirect is normal input, not a failure and not "cancelled"), background, compacting, read-only
plan mode, auto mode paused; each recognisable at a glance, long tasks with progress and a stop.

Visual language: one visual belongs only to AI (one gradient, one ink) and appears only on AI
output, progress, and undo range; never on human actions; the moment a person takes over editing,
it drops to ordinary. Deletion always wears the error colour even when AI did it. Meaning by
shape first (solid, hollow, dashed, striped), colour as redundancy. AI motion suggests "happening"
(breathe, sweep), never celebrates.

## Composition methods

**Recognise the surface.** GUI: comparison or step-by-step, input devices, existing navigation —
draw content-to-action relations before choosing density and components. Terminal: interactive
or pipeline, column width, long paths, colour support, machine-readable output — stable columns
and hierarchy, meaning without colour, copyable content; the machine contract and the human view
are separate. Conversation: what judgement one turn must support, which context must stay
visible, where results land — scannable summaries with an explicit next step, original results
and sources kept; long chat and hidden reasoning are not progress. Embedded: host space,
existing components, focus and scroll, input conflicts — change only the allowed area, never take
over the page or clone host navigation. Combination: which surface carries which part of the
task and how state continues; identical meaning of objects, results, actions, layouts may differ.

**Build the skeleton from real content.** Choose the one screen or task segment that most
affects judgement; place representative content (long titles, mixed text and numbers with
units, empty values, explanations, states) so the risky cases can appear; order it as first
recognise the object → compare the deciding factors → identify the action → judge the result.
Separate main content from auxiliary explanation without hiding what the decision needs. The
skeleton must still read correctly with colour and decoration removed (a hierarchy self-check,
not an accessibility pass).

**Choose composition from evidence**:

| Composition | Judge from | Do | Failure to check |
| --- | --- | --- | --- |
| type and rhythm | viewing distance, continuous reading vs scanning, digit ratio, existing fonts | readable body first, then open up heading, group, label tiers; align like numbers, keep units next to values; control reading by line length and leading, not by shrinking everything secondary | long titles push actions out; explanations too faint; unit separated from value; fallback font overflows |
| density | what must be compared at once, frequency, touch and keyboard | dense tasks get stable alignment and clear grouping; rare single tasks get focused blocks; explain different densities per task | too dense misclicks; too sparse scrolls to compare; hidden fields load memory |
| whitespace and grouping | which content belongs to one object, which to the next item | intra-group closer than inter-group; consistent rhythm per tier; primary action apart from dangerous and auxiliary ones | equal spacing flattens relations; big gaps split state from object; nested borders make noise |
| semantic colour and emphasis | brand constraints, business states, selection, keyboard focus | define roles before values; primary only where needed; success, failure, unknown with text or shape; selection and focus distinguishable at once | a failed notification turns the whole booking red; yellow means selected and warning |
| image and icon | recognise, explain, or set mood; content and rights available | images that help judgement; decoration limited in area; icons follow the existing language, unclear actions keep labels | decoration steals focus; icons guessed; cropping loses content; the image is the only source |
| material and depth | content layer vs chrome, background complexity, platform | surfaces, edges, weight first; translucency only when the background relation matters, with an opaque fallback | glass over content; contrast swings with background; unclear card/dialog tiers |
| motion | does the user need to locate change, understand space, know an action happened | one state change per animation with a stable end; interruptible; reduced-motion shows the end state | decoration distracts; animation delays availability; a spinner hides the unknown; cancelling an animation is mistaken for cancelling the action |

**Compare the same content, then decide conditionally.** When direction is open and a comparison
would change the judgement, produce visible candidates with identical objects, text lengths,
data, states, and primary action, varying the one variable under discussion; never give the
favourite a full anomaly design and the alternative a rough happy path. A text sketch can rule out
wrong information order; real weight, whitespace, contrast, and material need a rendered sample —
without a renderer, say so and keep structure decisions only. Walk each candidate with the same
task (first seen, sought, back-and-forth, result understood); recommend with basis and cost; a
delegating user gets the reversible recommendation applied plus the observation that would
trigger a change.

Example, one admin task ("find bookings that succeeded but whose notification still needs
handling, and compare their sessions"): A is a two-dimensional table aligning session, booking
state, notification state; B is one group per record with fields stacked. For a dense comparison,
recommend A — fixed columns, tight rows, clear header tier, the notification problem marked with
text plus a local accent, never the whole row painted "failed". B reads more easily record by
record but forces the eye to hunt the same field across rows. If A needs horizontal scrolling at
the real width or misaligns states across rows in observation, adjust or switch to B. Until
observed, this is a conditional judgement, not "A is faster".

## Iteration mode

Pick up the request directly. One token or one region: direct — change and restate. Density,
theme, form, navigation: full follow-up. A new reference triggers the second search pass and a
forced choice; vague words go through the translation table and are read back; conflicts with
the existing brief (new direction vs settled density, colour mode, principles, anti-references)
are stated for the user to choose and recorded under assumptions or decisions. A spec change:
read the spec changelog first, touch only the affected screens, components, and flows; a
requirement with no screen gets one; a screen with no flow gets a question. Both files change
together (behaviour in the brief, visuals and tokens in DESIGN.md; a token change updates the
sentence that explains why it exists); superseded directions are marked "→ superseded <date>";
existing mock-ups are flagged for regeneration and written styles flagged for phase-build to
resync — flagged only. Finish by replaying what the changed screen looks like.

## Worked dialogues

**Start from context, not colour**

> User: I want it premium and simple.
> Agent: style later. The team lead picks a technician on a phone in the workshop — seconds, one hand, uneven light. Support sits at a desk, one or two minutes per ticket, interrupted by calls. What is the one action that matters most on each?
> User: the lead just taps a person; support dispatches the ticket.
> Agent: then the two ends want different things: the phone needs "find the person at a glance, thumb reaches it" — looser density than desktop, type never under 16px; the desktop needs "pick up where you left off after an interruption". Now premium: Apple's whitespace or Hermès' dark-and-gold? Give me a premium object, not necessarily software.
> User: like a Swiss watch manual.
> Agent: noted — restrained, precise, mostly monochrome, structure by hairlines not shadows, small size steps. It also brings three don'ts for free: no gradients, no glow, no rounded cards. Right?

**Anti-reference and a real conflict**

> User: not one of those card-heavy back offices.
> Agent: anti-reference recorded: no arrays of same-radius, same-grey-shadow cards. But you also want "every technician's status on one screen" — that amount of information needs a table or a list if not cards. Linear's dense table with status dots, or Notion's list with tags?

**Anti-examples**

- Asking for the primary colour first — colour is earned last.
- Writing "minimalist style" because the user said "simple" — translate and read back.
- Proposing "let's go with blue" — never ghost-write; give options or a vetoable default.
- Placing side navigation in a conversational agent — wrong form.
- Writing "radius 8px, shadow 0 2px 8px" in the brief — direction in the brief, values in tokens.
- Three direction samples that are all cream-serif-terracotta or all near-black-acid-green — those
  are AI defaults, not choices for this product.
