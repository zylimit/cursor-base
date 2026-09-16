# DESIGN.md template

Default filename `DESIGN.md` at the project root, following the open `design.md` convention: a
YAML front matter of tokens (machine-readable, referenced as `{path.to.token}`) and a prose body
in eight fixed sections (human-readable). The prose is the substance, the tokens are its context.
Sections may be omitted but their order is fixed; extra sections such as Motion go at the end.

Two writing rules: **one concrete reference beats a list of adjectives** ("a 1970s university
lecture handout", not "modern, clean, trustworthy"); **every token says why it exists, where it
is used, and where it is not**. Do's and Don'ts collect the reference's negatives, the
anti-references, and the AI clichés.

---

```markdown
---
version: alpha
name: <product or system>
description: "<one sentence — what this visual is, told through one concrete reference; keep the quotes, a colon inside an unquoted value breaks the block>"
colors:
  primary: "<#hex — the single accent, only for the most important action>"
  on-primary: "<#hex>"
  secondary: "<#hex — borders, metadata, secondary text>"
  neutral: "<#hex — base>"
  surface: "<#hex — cards, panels>"
  on-surface: "<#hex — body text>"
  on-surface-muted: "<#hex — secondary text, contrast ≥ 4.5:1>"
  border: "<#hex>"
  success: "<#hex>"
  warning: "<#hex>"
  error: "<#hex — also the colour of destructive actions>"
  agent: "<#hex or delete — only when there is AI, and only for AI activity>"
typography:
  display:  { fontFamily: <family>, fontSize: <px/rem>, fontWeight: <n>, lineHeight: <ratio>, letterSpacing: <em> }
  headline-md: { fontFamily: <family>, fontSize: <…>, fontWeight: <…>, lineHeight: <…> }
  body-md:  { fontFamily: <family>, fontSize: <≥16px on mobile>, fontWeight: 400, lineHeight: <1.5–1.7> }
  label-sm: { fontFamily: <family>, fontSize: <…>, fontWeight: <…>, lineHeight: <…> }
  mono:     { fontFamily: <monospace family — code, IDs, timecodes>, fontSize: <…>, fontWeight: 400, lineHeight: 1.5 }
rounded:
  none: 0px
  sm: <px>
  md: <px>
  lg: <px>
  full: 9999px
spacing:
  xs: <px>
  sm: <px>
  md: <px>
  lg: <px>
  xl: <px>
  gutter: <px>
  section: <px>
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    padding: <px px>
    height: <px>
  button-primary-hover:
    backgroundColor: "<#hex or token>"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: <px px>
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: <px>
    height: <≥44px on mobile>
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
---

## Overview

<One paragraph of concrete reference: what this visual is like — an object, a print, a place —
who the audience is, the emotional response, dense or sparse. Write a picture, not adjectives.>

## Colors

<One sentence of system: single accent or two, warm or cool, light or dark. Then one line per colour:>
- **Primary ({colors.primary})**: used only for the single most important action and …; not used for …
- **Secondary ({colors.secondary})**: borders, explanations, metadata; not used for …
- **Neutral ({colors.neutral}) / Surface ({colors.surface})**: base and surface tiers by lightness, not by shadow
- **Error ({colors.error})**: errors and destructive actions only, never an accent
- **Agent ({colors.agent})**: appears only on AI output, progress, and undo range; never on human actions; drops to ordinary the moment a person takes over
<Dark mode: a second token set or a second file; not an inversion; contrast tested separately.>

## Typography

<One or two families and their roles, clearly different if two. Line length limit, size steps large or small, headings loud or quiet.>
- **Display (typography.display)**: where used, where not
- **Body (typography.body-md)**: body copy, line length < 80 characters
- **Label (typography.label-sm)**: buttons, table headers; not all-caps without a reason
- **Mono (typography.mono)**: code, IDs, timecodes; not decoration for small data labels

## Layout

<Grid model: fluid or fixed max width; spacing scale ({spacing.xs} to {spacing.xl}) and rhythm; section spacing {spacing.section}; a workbench names its incompressible main task area.>

## Elevation & Depth

<What carries hierarchy: lightness steps, hairlines, or shadow. With shadow, the shadow language (ambient + direct); flat designs name their substitute.>

## Shapes

<Radius language and its logic: {rounded.sm} controls, {rounded.md} cards, {rounded.lg} dialogs; nested radii child ≤ parent; sharp and rounded never mixed on one screen.>

## Components

<One paragraph per core component: anatomy, colour use, size, states (default / hover / focus / disabled / loading / error); hover never displaces; focus ring visible.>
- **Button**:
- **Input**:
- **Card / table row**:
- **Status dot / badge**: meaning by shape, not only by colour

## Do's and Don'ts

- Do: <the practice the reference brings>
- Do: primary only on the single main action per screen
- Do: contrast ≥ 4.5:1; motion degrades under reduced motion
- Don't: <the reference's negatives — no gradients / glow / skeuomorphism / uniform radius …>
- Don't: <the anti-references>
- Don't: <AI clichés — ALL-CAPS eyebrows, middle-dot metadata, "WORD — fragment" labels, "→" button tails, every paragraph fading in, uniform grey-shadow cards, near-black posing as black>

## Motion

```yaml
motion:
  feedback: <ms>
  content: <ms>
  easing: "<cubic-bezier>"
```
<Motion explains cause and effect only: interaction feedback <ms>, content transitions <ms>, one easing curve; one choreographed moment; anything over <ms> is cut; reduced motion zeroes everything.>

## Hard constraints

| Item | Constraint |
| --- | --- |
| Primary | not purple or indigo; not the cream-base / serif-headline / terracotta set |
| Colour count | total ≤ 5, gradient stops ≤ 3, no single hue dominating the screen |
| Fonts | families ≤ 2; body ≥ 14px; letter-spacing not negative; sizes do not scale with viewport |
| Line length and leading | body `max-width: 65ch`; `line-height` 1.4–1.6 |
| Radius | the brief's chosen radius axis (sharp 0–2px / soft 8–12px / pill) as a range, not one value everywhere; no card inside a card; no floating card for a section |

The table constrains generation and gives reviewers something decidable; its values are filled
from the brief's own axis decisions, never copied from this template. A deliberate violation is
written next to the code with its reason, so a review can tell a choice from a default.
```

Writing notes:

1. Front matter needs at least `name` and `colors.primary`; tokens are named by intent
   (`primary`, `on-surface`), never by value (`blue-500`).
2. The eight sections keep their order (Overview / Colors / Typography / Layout / Elevation &
   Depth / Shapes / Components / Do's and Don'ts); Motion and other custom sections come last.
3. Prose references tokens as `{colors.primary}` so a linter can check the references.
4. With a UI system (any component library or native controls) write only the delta; tokens that
   inherit system defaults say "inherits …".
5. Do's and Don'ts are the generator's guard rails: reference negatives + anti-references + AI
   clichés in one place.
6. Design both themes together; pure black and near-black posing as black each need a reason.
