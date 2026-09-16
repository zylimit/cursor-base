# Domain Rulings Reference

## Why a separate carrier

A downstream project that ran for two months and 130k lines accumulated a 600-line spec and a
2,500-line changelog with 535 entries. The model hallucinated business facts from them for three
reasons: two contradicting versions of one ruling coexisted in the same document with no
supersession link (v2.31 "outer contour" and v2.44 "convex hull"); the documents could not be read
in one pass, so each session read a different fragment; narrative phrasing ("usually the IP") left
room for the model to complete the sentence. A criterion-style entry with explicit supersession in
a file small enough to read whole is the answer to all three — which is why the rulings do not
live in the spec or the changelog.

The seven columns were forced by backfilling real entries, not designed: *depended on by* appeared
because a boundary algorithm was referenced from four places nobody would remember to re-check;
*known contamination* appeared because a topology ruling was correct while the production data did
not satisfy its premise, and there was nowhere to say so. Of 36 backfilled candidates, 24 were
rulings, 8 mixed a ruling with a batch scope limit and had to be split, 2 were pure scope limits,
2 were current-data facts. Of eight backfilled rulings only four could fill every column — the
empty cells mark where knowledge had already leaked away.

## Entry format

One file per domain (`domain/optical-power.md`, `domain/cluster.md`, `domain/industry-standards.md`,
`domain/how-the-organisation-works.md`), the domain taken from the field, not from this project's
module map; entries that fit nowhere yet go to `domain/_unsorted.md` until a class accumulates.

```markdown
### R-CLU-002 Cluster boundary = convex hull of the whole cluster

- Current value: boundary = convex hull of all points in the cluster; FAT outline and concave hull are not used
- Basis: measured — 74,586 rows, concave hull produced 12% self-intersections (2026-08-14 run); internal — planning department confirmed the hull is what the coverage report expects (user, 2026-08-20)
- Applies to: coverage health, responsibility area, remediation export; not to the map preview layer
- Supersedes: R-CLU-001 (FAT outline, v2.31) → superseded 2026-08-20
- Expires when: cluster membership rules change, or the coverage report changes its expectation
- Depended on by: R-COV-004 coverage health; R-RESP-002 responsibility area; export "remediation list"
- Known contamination: session 2026-09-03 has `connectivity` all NULL; boundaries computed from it are wrong until the reload
- Source: CHANGELOG v2.44, 2026-08-20; user decision
```

The ID carries the domain (`R-<DOMAIN>-<nnn>`); the title is the criterion in one line; the
source (changelog version and date, or the user's decision) closes the basis column.

## Sorting classes

- **Ruling** — still true after the work is done → record.
- **Scope limit** — constrains this batch (no new persistent table, no new dependency, this batch
  does not touch X); expires when the batch ends → do not record.
- **Fact record** — the current state of data, time-bound, will be repaired, but anyone reading
  the ruling before the repair must know → *known contamination* under the ruling, never its own
  entry.
- **Mixed** — one sentence with a scope limit and a permanent criterion ("do not change rulings ①–⑤
  and the default tab; loading, failure, and empty states are independently visible") → split.
  Mixed entries are not carelessness; a changelog is a container for "what this batch did" and
  people writing batch constraints put permanent criteria in the same paragraph — which is itself
  the evidence that rulings need their own carrier.

## Three change kinds and four ageing kinds

Revision: same criterion, new value — one ruling in versions ("concave outline → FAT outline →
convex hull" is one ruling three times, not three contradicting truths). Supersession: a new
ruling replaces the old one; the old is marked and kept. Narrowing or widening: same value,
different scope — easiest to miss because nothing looks changed. No home-made versioning: the file
holds the current state, git holds the history; only supersession is written into the entry.

Condition expiry, dependency expiry, bulk expiry, contamination — see the skill entry. Entering the
review queue is not permission to edit: changing a ruling needs new basis of the three admitted
kinds, exactly as admission did.

## Trigger sources, by reliability

1. **Machine-detected** — a field, table, or interface the entry references no longer exists →
   review queue. The only thing a machine can judge is whether a reference resolves, on the model
   of `adr-check`; it cannot judge whether the ruling is right.
2. **Event-driven** — a ruling was revised → its dependants enter the queue; works only if
   *depended on by* is accurate.
3. **Met while working** — the least reliable and the widest: the same path as code review, test
   design, and debugging reporting **requirement in doubt**, ending in the library instead of the
   spec. Structured review sits on this path too: the red side attacks corners and some of what it
   finds is not a defect but "so that is how this domain works" — judged as a defect it is
   dismissed; it should be routed here as a clue.

## Two hard constraints and the destinations of a finding

**Collection must ride on an existing action.** Adding a "remember to record" step does not work:
of 38 lessons in one corpus, 20 were never referenced by any rule, skill, or agent — writing them
required a separate act — while the progress recorder stayed alive only because the constitution
hard-wired its trigger. The parasitic host is the receipt's **Domain findings** field: a subagent
writes a receipt anyway and fills one more line. An empty field is `None`, never a fabrication;
riding on an action solves "conveniently", not "nagged" — a by-product that is nagged for produces
padding, padding has no basis, and unfounded entries are exactly what this library guards against.

**Clue and ruling are two levels.** A subagent that met something has a clue — the phenomenon is
real, the explanation may not be, and its only basis kind is measurement. Clues do not enter the
library; the agent goes to public sources and the user goes inside the organisation, and the
verdict is the orchestrator's and the user's, never the subagent's. So the field asks "report the
evidence in your hands", not "report an established ruling".

The Domain findings channel carries three kinds; sort on arrival:

- a **domain ruling** with its basis complete → record here;
- a **framework practice problem** (our own tools, checks, or process — nothing to do with the
  business) → fix on the spot if it can be fixed now, and record a lesson when the pit will be
  stepped in again; never into `domain/`, or the library becomes a junk drawer;
- a **requirement in doubt** (code matches spec, spec does not match business) → `product-spec`
  iteration mode, the path that already exists.

The sorting question: "in an unrelated project, does this still hold?" — holds and has nothing to
do with the business: framework problem; holds and describes a domain: ruling; does not hold:
this project's requirement problem.

Retrieval is structured, never by embedding: by domain, by the technical object referenced
(`pon_links`, `box_chain_summary`), by status (current / superseded / contaminated). Vector
similarity pulls "join key is the IP" and "IP allowlist" together — literally alike, semantically
unrelated — which is a source of hallucination, not a cure.

## Not doing

- No index until the library passes about a hundred entries: under twenty entries the whole file
  is two hundred lines and fits in a dispatch pack; the index is what would make task-level
  retrieval possible at scale, and a machine lint follows the index, not the other way round.
- No periodic review (see ageing).
- No knowledge graph, no vector store, no automatic extraction from changelogs — splitting the
  eight mixed entries was pure human judgement; a machine would sweep scope limits and fact
  records in with them.

## Worked dialogues

**Triage — looks like a ruling, lives in quadrant one**

> User: record this: OLT joins must use the IP; names are not unique and mix the data.
> Agent: who knew this originally — have you always worked this way, or did it surface just now?
> User: always; everyone in the field knows names repeat.
> Agent: then its home is the spec's *Rules and exceptions*, not the library: a business rule you knew and I did not, and the dispatch pack copies only the spec. I will route it to product-spec iteration and mark the join-key item's source. Nothing recorded here.

**Manual intake — quadrant four, one basis kind missing**

> User: record this. We just found that `olt_ip` in `pon_links` is NULL in seventy-odd thousand rows, so joining on IP loses most of the data.
> Agent: neither of us knew this before today?
> User: right, it came out of the run this morning.
> Agent: that is the library's quadrant. Both admission questions pass — the next dispatch changes its join strategy because of it, and it holds in another codebase. The basis so far is measurement only (the NULL count); the second kind is missing: are these NULLs a collection defect or is empty allowed? That is an internal norm — you would have to ask the collection team; public sources will not have it.
> User: I'll ask them.
> Agent: I will fill the columns I can (current value, scope, the NULLs as known contamination) and leave your half of the basis open. When it comes back, I record it.

**Anti-examples**

- "We have always joined on IP" recorded as a ruling — quadrant one; its home is the spec, and a
  dispatcher who copies only the spec would never see it.
- "PostgreSQL text has no length limit" recorded — quadrant two, technical direction; a library
  full of general technical facts is one nobody reads.
- "Exports carry a header row" recorded — quadrant three, a functional requirement; rulings say
  how to count, not what to build.
- Offering the answer during triage — "this one you already knew, I guess?" — the user nods and
  the four quadrants become one.
- Recording from one measurement — that is a clue; the ruling needs the second basis kind.
- Recording this batch's scope limits — expired the moment the batch ended.
- A second entry on a topic that already has a current value — two truths in one library; use
  revision or supersession.
- Treating "connectivity all NULL in this session" as expiry — that is contamination; treating it
  as expiry sends someone to edit a correct ruling.
