// ext/memory.mjs -- S21 the memory layer: what survives a context boundary, and what it
// costs to come back.
//
// The problem this layer answers is measured rather than assumed. Compaction does not
// dilute a governance constraint, it deletes it: the summariser optimises for task
// continuity, and a rule nobody has referenced for twenty turns is exactly what it drops
// first. The compaction techniques in the literature -- virtual context management, LLM
// summarisation, structured eviction, KV-cache eviction -- are all evaluated on task
// accuracy or throughput, and not one of them measures whether the constraints survived the
// rewrite. A summary is a claim about a conversation. It is not the conversation, and it is
// certainly not the repository.
//
// So every command here re-derives from files on disk and none of them reads a summary:
//   invariants   the non-negotiable set plus the live state, small enough to be re-injected
//                at a compaction boundary without being eaten by the next one
//   recap        the situation, on a budget, so that returning to a two-year-old project
//                costs what returning to a two-week-old one costs
//   archive      the memory file only grows; entries move out whole and are never rewritten
//   sync-check   the machine-decidable half of "memory keeps up with code"
//
// Two rules run through all four. First, a correction is a new entry, never an edit of an
// old one -- which is why `archive` moves lines and refuses to touch their bytes, and why
// it leaves a pointer per run instead of folding the pointers together. Second, a missing
// source is reported, not rendered around: a confident view of half the evidence is the one
// output this layer must never produce.
//
// Depends on core / evidence / quality / task / spec. Nothing imports it except harness.mjs
// and selftest, so the graph stays acyclic. The document model comes from spec.mjs rather
// than a second copy here: both files read the same flavour of markdown, and two section
// splitters would drift.
//
// Source is ASCII-only like the rest of the runtime. The labels this repository's own memory
// files are written with are Chinese, so they appear escaped with the meaning in a comment.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  SOURCE_EXTS,
  changedPaths, emit, git, gitFingerprint, isDenied, isGitRepo, isStateExcluded, projectRoot,
  splitNul, toPosixPath,
} from '../lib/core.mjs';
import { readLedgerState, readTaskRecord, verifyLedgerChain, writeAtomic } from './evidence.mjs';
import { tierState } from '../lib/tier.mjs';
import { latestGateRecord } from './task.mjs';
import { REQUIREMENT_SECTION, parseRequirements, sectionNamed, splitSections } from './spec.mjs';

// ===========================================================================
// S21.1 the memory files and the shapes they are written in
// ===========================================================================

const DEFAULT_PROGRESS_FILE = 'progress.md';
const DEFAULT_ARCHIVE_FILE = 'progress.archive.md';
// Forward-slashed literal rather than a join: invariants reports this string back in
// `sources.rules` and renders it into the section headings the PostCompact hook feeds back
// into the session, and a Windows separator there is a contract difference nobody asked for.
const DEFAULT_RULES_FILE = '.claude/CLAUDE.md';
const DEFAULT_SPEC_FILE = 'Product-Spec.md';
const DEFAULT_CHANGELOG_FILE = 'Product-Spec-CHANGELOG.md';

// progress.md section labels. "Pinned" and the English ones match verbatim; the breakpoint
// section is titled in Chinese.
const SECTION_PINNED = 'Pinned';
const SECTION_DONE = 'Done';
const SECTION_DECISIONS = 'Decisions';
const SECTION_TODO = 'TODO';
const SECTION_NOTES = 'Notes';
const SECTION_BREAKPOINT = '\u5f53\u524d\u65ad\u70b9';       // "current breakpoint"
const SPEC_OVERVIEW_SECTION = '\u4ea7\u54c1\u6982\u8ff0';    // "product overview"

// Sections `archive` is allowed to move entries out of. Pinned holds standing constraints
// and TODO holds open work: archiving either would hide something still in force, which is
// the opposite of what an archive is for.
const ARCHIVABLE_SECTIONS = [SECTION_DONE, SECTION_NOTES];

// An iron rule in CLAUDE.md is written as a bold label carrying the mark, in the shape
// "- **<name>(mark)**: ..." or "- **<name><mark>**: ...". Matching the label rather than the
// whole line is what keeps a paragraph that merely cites another rule out of the
// non-negotiable set -- there are several of those, and they are references, not rules.
const IRON_LAW_MARK = '\u94c1\u5f8b';                  // "iron rule"
const BOLD_LABEL_RE = /^\s*(?:[-*+]|\d+[.)])\s+\*\*(.+?)\*\*/;
const BULLET_RE = /^\s{0,3}(?:[-*+]|\d+[.)])\s+/;
const ISO_DATE_RE = /(\d{4}-\d{2}-\d{2})/;

// TODO items carry their priority and state in leading brackets: "- [P1][OPEN][#23] ...".
const TODO_PRIORITY_RE = /\[(P[0-9])\]/;
const TODO_CLOSED_RE = /\[(?:DONE|CLOSED|\u5b8c\u6210|\u5df2\u5b8c\u6210)\]/;   // DONE / closed

// A pointer left by a previous archive run. Recognised so it is never counted as an entry
// and never moved a second time; it is not rewritten either, so repeated runs leave one
// honest line each.
const ARCHIVE_POINTER_RE = /^\s*(?:[-*+])\s+_.*progress\.archive\.md.*_\s*$/;

const INVARIANTS_BUDGET = 1200;
const RECAP_BUDGET = 4000;
const ARCHIVE_MAX_ENTRIES = 100;
const TAIL_RESERVE = 96;

function rootJoin(rel) {
  return path.isAbsolute(rel) ? rel : path.join(projectRoot(), rel);
}

/** Read a text file, or report why there is nothing to read. Never throws. */
function readTextFile(rel) {
  const abs = rootJoin(rel);
  if (!fs.existsSync(abs)) return { ok: false, file: rel, error: 'missing' };
  try {
    return { ok: true, file: rel, text: fs.readFileSync(abs, 'utf8') };
  } catch (e) {
    return { ok: false, file: rel, error: 'unreadable', detail: String((e && e.message) || e) };
  }
}

/**
 * Entries of one section: a top-level bullet plus the lines under it that belong to it.
 * Continuation lines travel with their entry, because an entry moved without its detail
 * lines has been edited, not moved. Pure.
 * @param {{lines:string[],fenced:boolean[],sections:Array}} doc
 * @param {string} label
 * @returns {Array<{from:number,to:number,raw:string,text:string,date:(string|null),pointer:boolean}>}
 */
function sectionEntries(doc, label) {
  const section = sectionNamed(doc, label);
  if (!section) return [];
  const starts = [];
  for (let i = section.from; i < section.to; i++) {
    if (doc.fenced[i]) continue;
    if (BULLET_RE.test(doc.lines[i])) starts.push(i);
  }
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k];
    let to = k + 1 < starts.length ? starts[k + 1] : section.to;
    while (to > from + 1 && !String(doc.lines[to - 1]).trim()) to--;   // trailing blanks stay put
    const raw = doc.lines[from];
    const m = ISO_DATE_RE.exec(raw);
    out.push({
      from,
      to,
      raw,
      text: doc.lines.slice(from, to).join('\n'),
      date: m ? m[1] : null,
      pointer: ARCHIVE_POINTER_RE.test(raw),
    });
  }
  return out;
}

/**
 * One readable line out of an entry: the bullet marker goes, a bold label is the headline
 * when there is one, otherwise the text up to the first full stop. Truncation is marked, so
 * a cut is never mistaken for the whole thing. Pure.
 */
function headline(raw, max = 110) {
  let s = String(raw).replace(BULLET_RE, '').trim();
  const bold = /^(.{0,40}?\*\*.+?\*\*)/.exec(s);
  if (bold) {
    s = bold[1];
  } else {
    // Full-width punctuation only: an ASCII colon is far more often inside an inline code
    // span or a URL than it is the end of a headline, and cutting there produces a fragment.
    const stop = /[\uff1a\u3002]|\u2014\u2014/.exec(s);
    if (stop && stop.index > 8) s = s.slice(0, stop.index);
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

// ===========================================================================
// S21.2 rendering on a budget  (the budget is the product, not a safety net)
// ===========================================================================
// Everything this layer emits is going into a context window that just proved it cannot
// hold what it had. Rendering therefore drops whole items rather than cutting one in half,
// and says how many it dropped: a view that quietly stops at the budget reads as complete.

/**
 * Render titled blocks into `budget` characters. An item that does not fit is skipped and
 * counted; a block whose items all skip prints no title. Pure.
 * @param {Array<{title:string,items:string[]}>} blocks
 * @param {number} budget
 */
function renderBlocks(blocks, budget) {
  const parts = [];
  let used = 0;
  let omitted = 0;
  for (const block of blocks) {
    const head = block.title ? block.title + '\n' : '';
    let headWritten = false;
    for (const item of (block.items || [])) {
      const line = String(item) + '\n';
      // The blank line that closes a block is charged with its title, so the total below
      // is exactly what gets printed rather than one character per block more.
      const cost = line.length + (headWritten ? 0 : head.length + 1);
      if (used + cost > budget) { omitted++; continue; }
      if (!headWritten) { parts.push(head); headWritten = true; }
      parts.push(line);
      used += cost;
    }
    if (headWritten) parts.push('\n');
  }
  return { text: parts.join(''), chars: used, omitted };
}

/** Header + blocks + an honest tail when anything was dropped. Pure. */
function renderView(header, blocks, budget) {
  const room = Math.max(0, budget - header.length - TAIL_RESERVE);
  const body = renderBlocks(blocks, room);
  const tail = body.omitted
    ? '(' + body.omitted + ' item(s) omitted by the ' + budget + '-char budget; raise --budget or read the file)\n'
    : '';
  const text = header + body.text + tail;
  return { text, chars: text.length, omitted: body.omitted, budget };
}

// ===========================================================================
// S21.3 invariants  (what cannot be traded away, and where this tree stands)
// ===========================================================================
// Re-derived, never recalled. The state block comes first because it is small, bounded and
// the part a compaction boundary most reliably destroys; the budget eats from the tail, so
// the ordering decides what survives a small budget rather than luck deciding it.

/** Bold labels in CLAUDE.md that carry the iron-rule mark. Pure. */
function extractIronLaws(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')) {
    const m = BOLD_LABEL_RE.exec(line);
    if (!m) continue;
    const label = m[1].trim();
    if (!label.includes(IRON_LAW_MARK)) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * The tier as state rather than as a boolean: a fast window is a debt with a clock on it.
 * Read through the one resolver, so the window this reports and the window the hooks act on
 * are the same window -- the field name stays `fastMode` because `release` and the golden
 * baseline read it, and what it describes is unchanged.
 */
function fastModeState() {
  const t = tierState();
  return {
    tier: t.tier,
    source: t.source,
    active: t.fast,
    remainingHours: t.fast ? t.remainingHours : null,
  };
}

/** Files still waiting for review, by the same list semantics the stop gate uses. */
function pendingReviewCount() {
  try {
    const raw = fs.readFileSync(path.join(projectRoot(), '.claude', '.needs-review'), 'utf8');
    return raw.split(/\r?\n/).map(s => s.trim()).filter(s => s && s !== 'clean').length;
  } catch (_e) { return 0; }
}

/**
 * The live state an injected reminder has to carry. Deliberately free of clock values: this
 * output is compared, cached and re-injected, and a timestamp in it would make every copy
 * differ from every other for no information gained.
 */
function deriveState() {
  const task = readTaskRecord();
  const ledger = readLedgerState();
  const chain = verifyLedgerChain(ledger.entries);
  const gate = latestGateRecord(ledger.entries);
  // Outside a git tree the fingerprint is a constant, so comparing a recorded gate against
  // it would report every one of them as bound to the current change. Null instead.
  const diffHash = isGitRepo() ? gitFingerprint() : null;
  const staleTask = (() => {
    if (!task || task.state !== 'active') return false;
    const started = Date.parse(task.startedAt);
    return !Number.isNaN(started) && (Date.now() - started) > 72 * 3600000;
  })();
  return {
    task: task ? { id: task.id || null, state: task.state || null, stale: staleTask } : null,
    fastMode: fastModeState(),
    gate: gate ? { verdict: gate.gate || null, boundToCurrentDiff: diffHash !== null && gate.diffHash === diffHash } : null,
    ledger: ledger.unreadable ? 'unreadable' : (ledger.entries.length === 0 ? 'empty' : (chain.ok ? 'intact' : 'broken')),
    pendingReview: pendingReviewCount(),
  };
}

/** State rendered as lines a reader can act on. Pure. */
function stateLines(state) {
  const lines = [];
  lines.push('- active task: ' + (state.task
    ? state.task.id + ' (' + state.task.state + (state.task.stale ? ', stale >72h' : '') + ')'
    : 'none'));
  // Named `tier:` rather than `fast mode:` because the dial now has three positions, and the
  // two that are not fast still change which gates block. The debt wording is kept for fast:
  // a lowered gate is deferred evidence, not a setting somebody chose and finished with.
  lines.push('- tier: ' + state.fastMode.tier + ' (' + state.fastMode.source + ')'
    + (state.fastMode.active
      ? (state.fastMode.remainingHours === null ? '' : ', ' + state.fastMode.remainingHours + 'h left')
        + ' -- review/test gates are being skipped, and that is a debt'
      : ''));
  lines.push('- last gate: ' + (state.gate
    ? state.gate.verdict + (state.gate.boundToCurrentDiff ? ' (bound to the current diff)' : ' (NOT bound to the current diff)')
    : 'never run'));
  lines.push('- evidence ledger: ' + state.ledger
    + (state.ledger === 'broken' || state.ledger === 'unreadable'
      ? ' -- every verification it records is unproven until the gates are re-run' : ''));
  lines.push('- pending review: ' + state.pendingReview + ' file(s)');
  return lines;
}

function cmdInvariants(flags = {}) {
  const budget = positiveInt(flags.budget, INVARIANTS_BUDGET);
  const rulesRel = typeof flags.rules === 'string' ? flags.rules : DEFAULT_RULES_FILE;
  const progressRel = typeof flags.file === 'string' ? flags.file : DEFAULT_PROGRESS_FILE;
  const rules = readTextFile(rulesRel);
  const progress = readTextFile(progressRel);

  const laws = rules.ok ? extractIronLaws(rules.text) : [];
  const pinned = progress.ok
    ? sectionEntries(splitSections(progress.text), SECTION_PINNED).filter(e => !e.pointer).map(e => headline(e.raw, 70))
    : [];
  const state = deriveState();

  const missing = [];
  if (!rules.ok) missing.push(rulesRel + ' (' + rules.error + ')');
  if (!progress.ok) missing.push(progressRel + ' (' + progress.error + ')');

  const header = '# INVARIANTS -- re-derived from files, not recalled from context\n\n'
    + (missing.length ? '! not read: ' + missing.join(', ') + '\n\n' : '');
  const view = renderView(header, [
    { title: '## State of this tree now', items: stateLines(state) },
    { title: '## Non-negotiable (' + rulesRel + ')', items: laws.map(l => '- ' + l) },
    { title: '## Pinned (' + progressRel + ')', items: pinned.map(p => '- ' + p) },
  ], budget);

  const nothingDerived = laws.length === 0 && pinned.length === 0;
  return emit({
    ok: !nothingDerived,
    ...(nothingDerived ? { degraded: true } : {}),
    budget, chars: view.chars, omitted: view.omitted,
    sources: { rules: rules.ok ? rulesRel : null, progress: progress.ok ? progressRel : null },
    missing,
    counts: { laws: laws.length, pinned: pinned.length },
    laws, pinned, state,
    text: view.text,
    ...(nothingDerived
      ? { note: 'neither ' + rulesRel + ' nor ' + progressRel + ' yielded a constraint; the state block is all this could re-derive' }
      : {}),
  }, nothingDerived ? 3 : 0);
}

// ===========================================================================
// S21.4 recap  (the situation, derived from artifacts, at a constant price)
// ===========================================================================
// Ordered by what orients a reader fastest, because the budget cuts from the tail: where
// the work stopped, what constrains it, what the product is, what is open, what was decided
// and done lately. A project that has run for two years has a longer progress.md and the
// same recap, which is the whole point -- recovery cost must not grow with project age.

const RECAP_RECENT = { decisions: 5, done: 5, notes: 3 };

/** Specification headline: what the product is, in a couple of lines. Pure. */
function specDigest(text, file) {
  const doc = splitSections(text);
  const overview = sectionNamed(doc, SPEC_OVERVIEW_SECTION);
  const items = [];
  if (overview) {
    for (let i = overview.from; i < overview.to && items.length < 2; i++) {
      const l = String(doc.lines[i]).trim();
      if (!l || /^#{1,6}\s/.test(l) || doc.fenced[i]) continue;
      items.push('- ' + headline(l, 140));
    }
  }
  const reqs = parseRequirements(doc);
  items.push('- ' + reqs.length + ' requirement item(s) under ' + REQUIREMENT_SECTION + ' in ' + file);
  return items;
}

function cmdRecap(flags = {}) {
  const budget = positiveInt(flags.budget, RECAP_BUDGET);
  const progressRel = typeof flags.file === 'string' ? flags.file : DEFAULT_PROGRESS_FILE;
  const progress = readTextFile(progressRel);
  const spec = readTextFile(typeof flags.spec === 'string' ? flags.spec : DEFAULT_SPEC_FILE);
  const changelog = readTextFile(typeof flags.changelog === 'string' ? flags.changelog : DEFAULT_CHANGELOG_FILE);

  if (!progress.ok && !spec.ok && !changelog.ok) {
    const note = 'none of ' + [progressRel, DEFAULT_SPEC_FILE, DEFAULT_CHANGELOG_FILE].join(' / ')
      + ' exists here; there is no artifact to derive a situation from, and a summary is not one';
    process.stderr.write(note + '\n');
    return emit({ ok: false, degraded: true, error: 'no-memory-artifact', budget, note }, 3);
  }

  const doc = progress.ok ? splitSections(progress.text) : null;
  const pick = (label, limit) => (doc ? sectionEntries(doc, label).filter(e => !e.pointer) : []).slice(0, limit);
  const openTodo = (doc ? sectionEntries(doc, SECTION_TODO) : []).filter(e => {
    const m = TODO_PRIORITY_RE.exec(e.raw);
    return !!m && (m[1] === 'P0' || m[1] === 'P1') && !TODO_CLOSED_RE.test(e.raw);
  });

  const blocks = [
    { title: '## Where the work stopped', items: pick(SECTION_BREAKPOINT, 8).map(e => '- ' + headline(e.raw, 150)) },
    { title: '## Pinned constraints', items: pick(SECTION_PINNED, 20).map(e => '- ' + headline(e.raw, 90)) },
    { title: '## The product', items: spec.ok ? specDigest(spec.text, spec.file) : [] },
    { title: '## Requirement changes (latest first)', items: changelog.ok ? changelogDigest(changelog.text) : [] },
    { title: '## Open, P0-P1', items: openTodo.map(e => '- ' + headline(e.raw, 110)) },
    { title: '## Recent decisions', items: pick(SECTION_DECISIONS, RECAP_RECENT.decisions).map(e => '- ' + headline(e.raw, 110)) },
    { title: '## Recently done', items: pick(SECTION_DONE, RECAP_RECENT.done).map(e => '- ' + headline(e.raw, 110)) },
    { title: '## Recent notes and risks', items: pick(SECTION_NOTES, RECAP_RECENT.notes).map(e => '- ' + headline(e.raw, 110)) },
  ];

  const read = [progress, spec, changelog].filter(s => s.ok).map(s => s.file);
  const skipped = [progress, spec, changelog].filter(s => !s.ok).map(s => s.file + ' (' + s.error + ')');
  const header = '# RECAP -- derived from ' + read.join(', ') + ', not from a summary\n\n'
    + (skipped.length ? '! not read: ' + skipped.join(', ') + '\n\n' : '');
  const view = renderView(header, blocks, budget);

  return emit({
    ok: true, budget, chars: view.chars, omitted: view.omitted,
    read, skipped,
    counts: {
      breakpoint: pick(SECTION_BREAKPOINT, 8).length,
      pinned: pick(SECTION_PINNED, 20).length,
      openP0P1: openTodo.length,
      decisions: pick(SECTION_DECISIONS, RECAP_RECENT.decisions).length,
      done: pick(SECTION_DONE, RECAP_RECENT.done).length,
      notes: pick(SECTION_NOTES, RECAP_RECENT.notes).length,
    },
    text: view.text,
  }, 0);
}

/** The newest changelog entries, whatever heading level they are written at. Pure. */
function changelogDigest(text, limit = 3) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const l of lines) {
    if (out.length >= limit) break;
    const t = l.trim();
    if (/^#{2,4}\s+\S/.test(t)) out.push('- ' + headline(t.replace(/^#+\s*/, '- '), 110));
    else if (BULLET_RE.test(t) && t.length > 4) out.push('- ' + headline(t, 110));
  }
  return out;
}

// ===========================================================================
// S21.5 archive  (move entries out; never rewrite one)
// ===========================================================================
// The entries that leave are the oldest, and which end of a section that is depends on how
// the file is ordered. The direction is read off the dates rather than assumed, because
// guessing wrong here archives the newest work and leaves the history that no longer
// matters -- an error the writer would not notice until the recap went strange.

/** newest-first / oldest-first / unknown, from the dates the entries carry. Pure. */
function entryOrder(entries) {
  const dated = entries.filter(e => e.date);
  if (dated.length < 2) return 'unknown';
  const first = dated[0].date;
  const last = dated[dated.length - 1].date;
  if (first > last) return 'newest-first';
  if (first < last) return 'oldest-first';
  return 'unknown';
}

/**
 * Which entries of which sections leave, and where the pointer goes. Pure over the parsed
 * document, so selftest exercises the whole decision without touching a filesystem.
 * @param {string} text
 * @param {{maxEntries:number,sections?:string[]}} opts
 */
function planArchive(text, { maxEntries = ARCHIVE_MAX_ENTRIES, sections = ARCHIVABLE_SECTIONS } = {}) {
  const doc = splitSections(text);
  const plans = [];
  let total = 0;
  for (const label of sections) {
    const all = sectionEntries(doc, label);
    const entries = all.filter(e => !e.pointer);
    total += entries.length;
    const surplus = entries.length - maxEntries;
    if (surplus <= 0) {
      plans.push({ section: label, entries: entries.length, moving: 0, order: entryOrder(entries), at: null, moved: [] });
      continue;
    }
    const order = entryOrder(entries);
    // unknown order falls back to the tail: this file's convention, and the one a reader
    // gets right by default when they append at the top.
    const fromHead = order === 'oldest-first';
    const moved = fromHead ? entries.slice(0, surplus) : entries.slice(entries.length - surplus);
    plans.push({
      section: label,
      entries: entries.length,
      moving: moved.length,
      order,
      at: fromHead ? 'head' : 'tail',
      moved: moved.map(e => ({ from: e.from + 1, to: e.to, date: e.date, headline: headline(e.raw, 90) })),
      _moved: moved,
    });
  }
  return { doc, plans, total, maxEntries, moving: plans.reduce((n, p) => n + p.moving, 0) };
}

/** Pointer line for one move. Chinese, because it is written into a Chinese memory file. */
function pointerLine(count, moved) {
  const dates = moved.map(e => e.date).filter(Boolean).sort();
  const range = dates.length ? ' (' + dates[0] + ' ~ ' + dates[dates.length - 1] + ')' : '';
  // "- _archived N earlier entries into progress.archive.md_"
  return '- _\u5df2\u5f52\u6863 ' + count + ' \u6761\u8f83\u65e9\u6761\u76ee\u5230 '
    + DEFAULT_ARCHIVE_FILE + range + '_';
}

/**
 * Apply a plan to the text: the moved lines come out byte for byte and a pointer goes in
 * their place. Pure -- callers do the writing, and the two documents come back together so
 * neither can be written without the other having been computed. Pure.
 */
function applyArchivePlan(text, plan, { now = new Date().toISOString() } = {}) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const drop = new Set();
  const inserts = new Map();          // line index -> pointer line, inserted before that index
  const chunks = [];
  for (const p of plan.plans) {
    if (!p.moving) continue;
    const moved = p._moved;
    for (const e of moved) for (let i = e.from; i < e.to; i++) drop.add(i);
    const pointer = pointerLine(p.moving, moved);
    const anchor = p.at === 'head' ? moved[0].from : moved[moved.length - 1].to;
    const list = inserts.get(anchor) || [];
    list.push(pointer);
    inserts.set(anchor, list);
    chunks.push({
      section: p.section,
      body: moved.map(e => e.text).join('\n'),
      count: p.moving,
    });
  }
  const kept = [];
  for (let i = 0; i <= lines.length; i++) {
    for (const ins of (inserts.get(i) || [])) kept.push(ins);
    if (i < lines.length && !drop.has(i)) kept.push(lines[i]);
  }
  const heading = chunks.map(c => '## Archived from ' + c.section + ' on ' + now.slice(0, 10)
    + ' (' + c.count + ' entries)\n\n' + c.body + '\n').join('\n');
  return { progress: kept.join('\n'), archiveAppend: heading ? heading + '\n' : '' };
}

function cmdArchive(flags = {}) {
  const progressRel = typeof flags.file === 'string' ? flags.file : DEFAULT_PROGRESS_FILE;
  const archiveRel = typeof flags.archive === 'string' ? flags.archive : DEFAULT_ARCHIVE_FILE;
  const maxEntries = positiveInt(flags['max-entries'], ARCHIVE_MAX_ENTRIES);
  const src = readTextFile(progressRel);
  if (!src.ok) {
    const note = 'no memory file at ' + progressRel + ' (' + src.error + '); nothing to archive';
    process.stderr.write(note + '\n');
    return emit({ ok: false, degraded: true, error: 'progress-' + src.error, file: progressRel, note }, 3);
  }
  const plan = planArchive(src.text, { maxEntries });
  const report = {
    ok: true,
    applied: false,
    file: progressRel,
    archive: archiveRel,
    maxEntries,
    total: plan.total,
    moving: plan.moving,
    sections: plan.plans.map(({ _moved, ...p }) => p),
    note: plan.moving === 0
      ? 'every archivable section is within ' + maxEntries + ' entries; nothing moves'
      : 'dry run: entries move verbatim and a pointer line takes their place; rerun with --apply',
  };
  if (!flags.apply || plan.moving === 0) {
    if (plan.moving === 0 && flags.apply) report.note = 'nothing to move, so --apply did nothing';
    return emit(report, 0);
  }

  const applied = applyArchivePlan(src.text, plan);
  // The archive is written first on purpose. A crash between the two writes then leaves the
  // entries in both files, which a reader can see and fix; the other order loses them.
  try {
    const abs = rootJoin(archiveRel);
    const head = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '# Archived project memory\n\n> Moved out of ' + progressRel + ' verbatim. Corrections belong in a new entry there, never here.\n\n';
    writeAtomic(abs, head.replace(/\n*$/, '\n\n') + applied.archiveAppend);
    writeAtomic(rootJoin(progressRel), applied.progress);
  } catch (e) {
    const detail = String((e && e.message) || e);
    process.stderr.write('archive could not complete: ' + detail + '\n');
    return emit({ ...report, ok: false, error: 'archive-write-failed', detail }, 1);
  }
  return emit({ ...report, applied: true, note: plan.moving + ' entry/entries moved verbatim into ' + archiveRel }, 0);
}

// ===========================================================================
// S21.6 sync-check  (the decidable half of the three-file rule)
// ===========================================================================
// The rule reads: a decision or a completion goes into progress.md as it happens, and a
// requirement change updates the specification and its changelog together. What a machine
// can decide is whether the files moved in the same change set -- not whether what was
// written is true. So the findings name the omission and stop there.

const EXTRA_SOURCE_EXTS = new Set(['.sh', '.ps1', '.css', '.scss', '.sql', '.vue', '.svelte', '.bat', '.psm1']);

/** True when a path is code or a framework asset whose change should be remembered. Pure. */
function isTrackedWork(p) {
  const n = toPosixPath(p);
  if (isDenied(n) || isStateExcluded(n)) return false;
  if (n === DEFAULT_PROGRESS_FILE || n === DEFAULT_ARCHIVE_FILE) return false;
  const ext = path.extname(n).toLowerCase();
  if (SOURCE_EXTS.has(ext) || EXTRA_SOURCE_EXTS.has(ext)) return true;
  return n === '.claude' || n.startsWith('.claude/') || n.includes('/.claude/');
}

/**
 * Decide the two findings from a change set. Pure, so both modes and every awkward
 * combination are exercised without a repository.
 * @param {string[]} paths                 changed paths, project-relative
 * @param {{progressPresent:boolean,specPresent:boolean,changelogPresent:boolean}} present
 */
function syncFindings(paths, present) {
  const set = new Set((paths || []).map(toPosixPath));
  const work = [...set].filter(isTrackedWork);
  const findings = [];
  if (work.length && present.progressPresent && !set.has(DEFAULT_PROGRESS_FILE)) {
    findings.push({
      code: 'MEMORY_BEHIND_CODE',
      detail: work.length + ' code/framework path(s) changed and ' + DEFAULT_PROGRESS_FILE + ' is not in the same change set',
      sample: work.slice(0, 5),
      message: 'a decision or a completion that is only in the conversation is one compaction away from gone; record it now, not later',
    });
  }
  if (set.has(DEFAULT_SPEC_FILE) && !set.has(DEFAULT_CHANGELOG_FILE)) {
    findings.push({
      code: 'SPEC_WITHOUT_CHANGELOG',
      detail: DEFAULT_SPEC_FILE + ' changed and ' + DEFAULT_CHANGELOG_FILE + ' did not'
        + (present.changelogPresent ? '' : ' (and no changelog exists in this tree)'),
      sample: [DEFAULT_SPEC_FILE],
      message: 'a requirement change that leaves no changelog entry cannot be told apart later from a requirement that was always written that way',
    });
  }
  return findings;
}

/** Paths staged in the index, NUL-separated so non-ASCII names survive. */
function stagedPaths() {
  const r = git(['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only', '-z']);
  if (!r || r.status !== 0) return null;
  return splitNul(r.stdout);
}

function cmdSyncCheck(flags = {}) {
  const staged = flags.staged === true;
  if (!isGitRepo()) {
    const note = 'not a git repository, so there is no change set to compare the memory files against';
    process.stderr.write(note + '\n');
    return emit({ ok: false, degraded: true, error: 'non-git', mode: staged ? 'staged' : 'worktree', note }, 3);
  }
  let paths;
  if (staged) {
    paths = stagedPaths();
    if (paths === null) {
      const note = 'git could not list the index; the staged change set is unavailable, which is not the same as empty';
      process.stderr.write(note + '\n');
      return emit({ ok: false, degraded: true, error: 'index-unreadable', mode: 'staged', note }, 3);
    }
  } else {
    const cp = changedPaths();
    paths = Array.isArray(cp) ? cp : cp.paths;
  }
  const present = {
    progressPresent: fs.existsSync(rootJoin(DEFAULT_PROGRESS_FILE)),
    specPresent: fs.existsSync(rootJoin(DEFAULT_SPEC_FILE)),
    changelogPresent: fs.existsSync(rootJoin(DEFAULT_CHANGELOG_FILE)),
  };
  const findings = syncFindings(paths, present);
  for (const f of findings) process.stderr.write(' ' + f.code + '  ' + f.detail + ' :: ' + f.message + '\n');
  return emit({
    ok: findings.length === 0,
    mode: staged ? 'staged' : 'worktree',
    changed: paths.length,
    present,
    findings,
    note: findings.length === 0
      ? 'the memory files moved with the code, or there was nothing that needed remembering'
      : 'the change set is incomplete; add the missing file to it rather than promising to do it after',
  }, findings.length === 0 ? 0 : 1);
}

// ===========================================================================
// shared
// ===========================================================================

/** A positive integer flag value, or the default. Pure. */
function positiveInt(v, fallback) {
  if (typeof v !== 'string') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export {
  DEFAULT_PROGRESS_FILE, DEFAULT_ARCHIVE_FILE, DEFAULT_RULES_FILE, ARCHIVABLE_SECTIONS,
  IRON_LAW_MARK, SECTION_PINNED,
  INVARIANTS_BUDGET, RECAP_BUDGET, ARCHIVE_MAX_ENTRIES,
  sectionEntries, headline, renderBlocks, renderView, positiveInt,
  extractIronLaws, fastModeState, pendingReviewCount, deriveState, stateLines, cmdInvariants,
  specDigest, changelogDigest, cmdRecap,
  entryOrder, planArchive, pointerLine, applyArchivePlan, cmdArchive,
  isTrackedWork, syncFindings, stagedPaths, cmdSyncCheck,
};
