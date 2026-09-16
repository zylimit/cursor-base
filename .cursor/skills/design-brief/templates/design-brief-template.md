# Design Brief template

Default filename `Design-Brief.md` at the project root, paired with `DESIGN.md`. This file says how
the product works; `DESIGN.md` says how it looks. Colours, sizes, and radii are referenced here by
token name (`{colors.primary}`), never by value. Both files outrank any mock-up; when they
disagree, change the file first. Keep only the sections that apply; GUI forms fill §2 §3 §4 §7,
terminal and conversational-agent forms fill §A instead, combinations fill both.

---

# Design Brief: <product>

## 0. How agents read this document

- Structure, behaviour, states, and interaction rules live here; the visual identity lives in
  `DESIGN.md`. The product spec owns scope; this document adds no core capability the spec does
  not define.
- Design P0 flows and screens first; every screen covers its states; screens, components, and
  interactions use `DESIGN.md` tokens.

## 1. Design direction

### 1.0 Form and context of use

| Dimension | Direction |
| --- | --- |
| Form | GUI / terminal / conversational agent / embedded / combination |
| First-version surface | which surface ships first; how the other degrades |
| Context of use | per surface: standing or sitting, one or two hands, duration, interruption, device and light |
| Primary action | per surface: the one action that matters most |

### 1.1 Design goal

One sentence, derived from the primary action.

### 1.2 Character and principles

| Dimension | Direction |
| --- | --- |
| Mood words (≤5, non-contradicting) | |
| Concrete reference | product / place / object; what is right about it; the don'ts it implies |
| Density | comfortable / medium / compact — from audience and content |
| The one bold move | one element; everything else quiet |

- DP-1: an operational principle that says what it rules out
- DP-2:
- DP-3:

### 1.3 References and anti-references

| Reference | What exactly is admired (as attributes) | Load-bearing? |
| --- | --- | --- |

- Anti-reference: which product or style, and what is wrong with it
- Cliché list checked: which items were hit and excluded

## 2. Information architecture

### 2.1 Navigation

Top / side / bottom tabs / wizard / command palette — per surface.

### 2.2 Screen list

| ID | Screen | Purpose | Flow / scope item | Surface | Priority |
| --- | --- | --- | --- | --- | --- |
| SCREEN-1 | | | FLOW-1 / SCOPE-1 | | P0 |

### 2.3 Relations and surface closure

How screens connect, main path and side paths. Check: every P0 requirement has a screen; every
screen has a flow that lands on it. Gaps are written here and sent back to the spec.

## 3. Screen specifications

### SCREEN-1: <name>

**Purpose**: **Primary action**: / secondary actions:
**First screen opens on**: the most characteristic thing in this product's world (a number, an
image, an action in progress, a directly usable input)
**Layout**: top / main task area (incompressible) / auxiliary (reuse an existing sidebar, tab,
drawer, or context panel before adding a second sidebar) / fixed action area
**Content hierarchy**:

| Rank | Element | Note |
| --- | --- | --- |
| 1 | | |

**Components**: CMP-1, CMP-2…
**States** (one line each; empty is an invitation, error names the next step):
- empty:
- loading: skeleton mirroring the final layout / spinner / typewriter
- success:
- error: what happened + next step
- conflict: how "someone else changed this" is shown
- offline: what still works, what queues
- no permission / disabled:
- AI working: only when there is AI, else N/A
**Responsive**: mobile / tablet / desktop / ultra-wide max width
**Accessibility**: keyboard path, focus, semantics, contrast, screen reader

## 4. Component specifications

UI system inherited: <library or none>. With a system, write only the delta; visual values
reference `DESIGN.md` component tokens.

### CMP-1: <name>

**Purpose**: **Used on**: SCREEN-1, SCREEN-2
**Variants**: primary / secondary / danger
**States**: default / hover (no displacement) / focus (visible ring) / active / disabled / loading
(label kept + progress) / error — visual by token reference
**Content rules**: **Accessibility**:

## 5. Interaction and feedback

### 5.1 Primitives

| Pattern | Rule |
| --- | --- |
| primary action | one primary call to action per screen; where it sits |
| secondary action | |
| destructive action | confirmation or undo window |
| saving | auto / manual / draft; warn before leaving unsaved |
| navigation | URL reflects state; back restores |
| dialogs and drawers | when; at most one layer |
| keyboard | the core path by keyboard; shortcuts |

### 5.2 Feedback

| Situation | UI | Copy rule |
| --- | --- | --- |
| success | | state the result, do not celebrate |
| error | | what happened + next step; no apology, no vagueness |
| warning | | |
| empty | | one line of reason + next step |
| loading | | ends with "…" |

### 5.3 Motion

- The one choreographed moment: where; everything else responds only to the user's action
- Durations and easing from `DESIGN.md` motion tokens; reduced motion degrades everything

## 6. Copy

- Tone: clear / friendly / professional / encouraging — for whom
- Buttons: verb first, name the result ("Save changes", not "Submit"); one name per action
- Forms: label / placeholder / helper / error rules
- Empty states: one line of reason + next step
- Terms: one name per thing, identical to the spec

## 7. Accessibility and responsiveness

- Target: baseline / WCAG 2.2 AA
- Breakpoints: mobile | tablet | desktop | ultra-wide

Each requirement gets an id, because downstream documents cite it: the DFX spec's interaction
capability row and a review's quality-floor spot-check reference `A11Y-n`, as screens are
referenced by `SCREEN-n`.

| ID | Requirement | How it is checked | Applies to |
| --- | --- | --- | --- |
| A11Y-1 | keyboard reachable, focus visible | | all screens |
| A11Y-2 | fields labelled, errors tied to their field | | |
| A11Y-3 | meaning never by colour alone; contrast passes | | |
| A11Y-4 | alt text, heading hierarchy | | |
| A11Y-5 | reduced motion honoured | | |

## A. Terminal and conversational-agent form

Only when the form includes a terminal or a conversational agent; replaces §2 §3 §7. A.4 is
mandatory.

### A.1 Interaction skeleton and modes

| Dimension | Direction |
| --- | --- |
| driving | natural language / slash commands / shortcuts |
| wayfinding | examples / templates / suggestions / surprise — how the empty prompt is not empty |
| modes | plan / read-only / auto / background; default |
| one turn | from initiation to close |

### A.2 Rendering units

| Unit | Presentation |
| --- | --- |
| user message / agent reply / tool call / code and diff / command output / thinking and plan / error / citations | how each is shown, folded, highlighted |

### A.3 Running states

| State | Presentation |
| --- | --- |
| streaming / thinking / running tool / awaiting approval / interrupted / background / long-task progress | interrupted is a redirect, not a failure |

### A.4 Transparency and authorisation

| Dimension | Rule |
| --- | --- |
| reasoning shown | all / conclusion only / expandable |
| action trail | |
| authorisation granularity | per call / per session / permanent |
| action classes | direct / ask first / forbidden — by irreversibility, scope, confidence, cost |
| approval surface | shows the diff, editable before approval, batchable, gates only at publish, send, pay, delete |
| interruptible | |
| AI-only visual | the one visual that belongs to AI; human actions never use it |

### A.5 Terminal visuals and multiple surfaces

| Dimension | Direction |
| --- | --- |
| rendering primitives / colour depth / semantic colour / font / column degradation / surfaces | |

## 8. Implementation notes

- Token source: `DESIGN.md` (no scattered hex, sizes, or radii in code)
- UI system: presence and inheritance boundary
- Dark mode: which is default; both designed together
- Patterns to use and avoid:

## 9. Assumptions and open questions

### 9.1 Assumptions

| ID | Assumption | Basis | Risk if wrong |
| --- | --- | --- | --- |
| DASM-1 | | | |

### 9.2 Open questions

| ID | Question | Blocking? | Who can answer | Meanwhile do |
| --- | --- | --- | --- | --- |
| DQ-1 | | | | |
