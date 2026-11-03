// ext/spec.mjs -- S19 the specification layer: spec-lint (is the requirement document
// decidable), trace (does anything verify each requirement), spec (a budgeted view of the
// requirements a change actually touches) and dod (run every static governance check once).
//
// What this layer deliberately does NOT do, and why: the obvious move was to port the EARS
// lint from the sibling harness -- require a `REQ-XXX-001` id, a `SHALL`, a `WHEN/WHILE/IF`
// trigger. That grammar belongs to a repository whose requirements are written in it. The
// documents this framework actually produces are prose: product-spec-builder's template
// fixes the shape of a functional requirement as
//     <name>: <what the user does> -> <what the system does> -> <what comes out>
// which is already the trigger/response/outcome of EARS, minus the ceremony. A lint written
// against the other grammar would match nothing here, pass forever, and leave everyone
// believing the specification had been checked. A gate that cannot fail is worse than no
// gate, so this one is written against the shape that exists.
//
// Requirement ids are optional for the same reason and with the opposite consequence.
// Traceability needs a stable anchor; inventing one (line numbers, heading text, a hash of
// the prose) would produce links that break on the next edit and read as coverage. So
// `trace` degrades and says the anchor is missing rather than pretending. Five-minute
// prototypes keep writing prose; a project that wants traceability adds `[REQ-<mod>-<nnn>]`
// in front of each item and the capability turns on.
//
// TODO/TBD count as unfinished requirement text only in marker shape -- bracketed, suffixed
// with a colon, or standing alone as the whole item. In running prose they are subject matter:
// a specification for a to-do application is a thing people write, and a check that fires on
// the product's own topic is a check everyone learns to skip.
//
// Depends on core / catalog / graph. Nothing imports this module except harness.mjs and
// selftest, so the graph stays acyclic. dod runs the other subcommands as child processes
// instead of calling their cmd* functions, because every one of those ends in emit(), which
// exits the process -- and shelling out has the side benefit that dod asserts on the exit
// code contract the hooks consume rather than on some private return value.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  HARNESS_DIR,
  changedPaths, emit, isDenied, isGitRepo, isStateExcluded, matchAny, parseCsv, projectRoot,
  toPosixPath,
} from '../lib/core.mjs';
import { loadCatalogFlag, moduleForPath, trackedFiles } from './catalog.mjs';
import { analyzeImpact } from './graph.mjs';

// ===========================================================================
// S19.1 document model  (fence-aware line scanning; everything below is pure)
// ===========================================================================

const DEFAULT_SPEC_FILE = 'Product-Spec.md';

// The four sections a Product Spec cannot be read without. UI/flow/AI sections are real but
// optional -- a CLI tool has no UI section -- so their absence is not a finding.
// Source is ASCII-only like the rest of the runtime, so the labels are escaped; the comment
// after each one is what it says.
const REQUIRED_SECTIONS = [
  '\u4ea7\u54c1\u6982\u8ff0',   // product overview
  '\u5e94\u7528\u573a\u666f',   // usage scenarios
  '\u529f\u80fd\u9700\u6c42',   // functional requirements
  '\u6280\u672f\u65b9\u5411',   // technical direction
];
const REQUIREMENT_SECTION = '\u529f\u80fd\u9700\u6c42';

// Unfinished-text markers. The ASCII pair is matched case-sensitively -- lowercase "todo" is
// ordinary English prose -- and on top of that only in marker shape, because uppercase TODO is
// also what a to-do application is called. The Chinese pair never names a product, so a bare
// occurrence of those is marker enough.
const PLACEHOLDER_TOKENS = ['TBD', 'TODO', '\u5f85\u5b9a', '\u5f85\u8865'];
const MARKER_SHAPE_TOKENS = new Set(['TBD', 'TODO']);

// The other half of template residue: a double-brace slot copied from the template and never
// replaced. Same shape predev-lint reports, so the two gates cannot disagree about what an
// unfilled slot looks like. Brace-free and single-line, because a slot spanning lines is prose
// that happens to start with a brace, not a slot anyone forgot to fill.
const TEMPLATE_SLOT_RE = /\{\{[^{}\n]*\}\}/g;

/** What an unfilled slot says, in one place: the fenced scan and the open-text scan share it. */
function slotMessage(slot) {
  return 'unfilled template slot ' + JSON.stringify(slot)
    + ' copied from the template and never replaced; a slot is the template asking a question, not an answer';
}

// Whether a fence is an example or a deliverable is told by its info string, not by the file it
// sits in. A fence tagged with one of these is showing how the syntax works, and the slot inside
// it is the demonstration. An untagged fence, or one tagged markdown or yaml, is content someone
// still has to fill in, so the slot scan goes in there.
const TEMPLATE_FENCE_LANGS = new Set([
  'html', 'vue', 'jinja', 'hbs', 'handlebars', 'mustache', 'njk', 'liquid',
  'js', 'ts', 'jsx', 'tsx', 'svelte', 'php',
]);

// The fence marker plus whatever the opening line carries after it; the first word of that is the
// language the block is written in.
const FENCE_RE = /^\s{0,3}(?:```|~~~)(.*)$/;

/** The language a fence opens with, lowercased; '' when the fence is untagged. Pure. */
function fenceLanguage(info) {
  return String(info || '').trim().split(/\s+/)[0].toLowerCase();
}

// The one place a deferral token is subject matter rather than an unfinished sentence: the
// pending-questions section the new Product-Spec template gives it. Composed from the token
// instead of hand-escaped, so the section name and the token cannot drift apart. Five cells is
// what the template promises of a row -- question, area, who decides, when needed, interim
// default -- and that promise is what makes the deferral legible to the next reader.
const PENDING_TOKEN = PLACEHOLDER_TOKENS[2];
const PENDING_SECTION = PENDING_TOKEN + '\u95ee\u9898';   // pending questions
const PENDING_ROW_CELLS = 5;

// Terms that cannot be decided, and therefore cannot be accepted. Scanned inside requirement
// items only: the overview and the scenarios are sales prose, where "quickly" is a fair thing
// to say and flagging it would train everyone to ignore the whole check.
const AMBIGUOUS_TERMS = [
  '\u9002\u5f53', '\u5408\u7406', '\u5feb\u901f', '\u53cb\u597d',
  '\u5c3d\u91cf', '\u7b49\u7b49', '\u82e5\u5e72', '\u4f18\u5316\u4f53\u9a8c',
];

// Angle brackets in a specification are template residue unless they are real markup, so the
// discriminator is an allowlist of tag names rather than a guess about the contents.
const HTML_TAGS = new Set([
  'a', 'abbr', 'audio', 'b', 'blockquote', 'br', 'button', 'code', 'details', 'div', 'em',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'iframe', 'img', 'input', 'kbd',
  'label', 'li', 'main', 'nav', 'ol', 'option', 'p', 'path', 'pre', 'script', 'section',
  'select', 'small', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'svg', 'table',
  'tbody', 'td', 'textarea', 'th', 'thead', 'tr', 'ul', 'video',
]);

// Declaration form: the id leads the item, in brackets. Reference form: the bare token,
// anywhere. Keeping them apart is what makes "declared here, referenced there" meaningful.
const REQ_ID_DECL_RE = /^\s{0,1}(?:[-*+]|\d+[.)])\s*\[(REQ-[A-Za-z0-9]{1,16}-\d{2,4})\]\s*/;
const REQ_ID_REF_RE = /\bREQ-[A-Za-z0-9]{1,16}-\d{2,4}\b/g;

// An arrow is the whole structural assertion: without one the item states no transition from
// what the user does to what comes out.
const ARROW_RE = /(?:\u2192|->|=>)/g;

const BULLET_RE = /^\s{0,1}(?:[-*+]|\d+[.)])\s+/;

// A heading is written for a reader, so it may carry numbering and an aside the section name
// itself does not have: "3.2 <name> (fill in after review)" announces <name>. Neither part
// belongs to the name. The numbering is typed with whatever punctuation the keyboard is in, so
// the full-width stop and parenthesis come off with their ASCII twins -- the same set the
// pre-development gate strips, or one file gets two verdicts.
const SECTION_NUMBER_RE = /^\d+(?:\.\d+)*[.\u3001\uff0e)\uff09]?\s*/;
const SECTION_ASIDE_RE = /\s*[(\uff08][^()\uff08\uff09]*[)\uff09]\s*$/;

/** Inline code spans hide type parameters and tag examples that are not placeholders. */
function stripCodeSpans(line) {
  return String(line).replace(/`[^`]*`/g, '``');
}

/**
 * Split a markdown document into level-2 sections, ignoring headings inside fenced blocks.
 * Content before the first `## ` heading belongs to no section (preamble). Pure.
 * @param {string} text
 * @returns {{lines:string[],fenced:boolean[],fenceLang:Array<string|null>,unclosedFences:number[],sections:Array<{title:string,line:number,from:number,to:number}>}}
 */
function splitSections(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const fenced = [];
  const fenceLang = [];
  const unclosedFences = [];
  const sections = [];
  let inFence = false;
  let lang = null;
  let openedAt = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fm = FENCE_RE.exec(l);
    if (fm) {
      if (!inFence) { lang = fenceLanguage(fm[1]); openedAt = i + 1; }
      fenced.push(true);           // the fence marker itself counts as fenced
      fenceLang.push(lang);        // and belongs to the block it opens or closes
      inFence = !inFence;
      if (!inFence) { lang = null; openedAt = 0; }
      continue;
    }
    fenced.push(inFence);
    fenceLang.push(inFence ? lang : null);
    if (inFence) continue;
    const m = /^##\s+(.+?)\s*$/.exec(l);
    if (m) {
      if (sections.length) sections[sections.length - 1].to = i;
      sections.push({ title: m[1].replace(/[*`#]/g, '').trim(), line: i + 1, from: i + 1, to: lines.length });
    }
  }
  if (inFence) unclosedFences.push(openedAt);
  return { lines, fenced, fenceLang, unclosedFences, sections };
}

/** A heading title reduced to the section name it announces. Pure. */
function sectionTitleName(title) {
  return String(title).replace(SECTION_NUMBER_RE, '').replace(SECTION_ASIDE_RE, '').trim();
}

/**
 * The section named `label`, or null. A title that is the name -- once numbering and a trailing
 * aside are set aside -- wins over one that merely contains it, because a section written about
 * another one ("how to fill in <name>") is usually written first and would otherwise take the
 * anchor from it. Containment stays as the fallback: it is what lets a title of the shape
 * "<name>: a story about the work today" answer for <name>. Pure.
 */
function sectionNamed(doc, label) {
  return doc.sections.find(s => sectionTitleName(s.title) === label)
    || doc.sections.find(s => s.title.includes(label))
    || null;
}

/** True when a section carries no content of its own (headings and blanks do not count). */
function sectionEmpty(doc, section) {
  for (let i = section.from; i < section.to; i++) {
    const l = doc.lines[i];
    if (doc.fenced[i]) return false;
    if (!l || !l.trim()) continue;
    if (/^#{1,6}\s/.test(l)) continue;
    return false;
  }
  return true;
}

/**
 * Requirement items = top-level bullets inside the functional-requirements section. Nested
 * bullets are detail lines of the item above them, so they are not items in their own right
 * and are not asked to carry the arrow shape. Pure.
 * @returns {Array<{line:number,raw:string,body:string,id:(string|null),arrows:number}>}
 */
function parseRequirements(doc) {
  const section = sectionNamed(doc, REQUIREMENT_SECTION);
  if (!section) return [];
  const out = [];
  for (let i = section.from; i < section.to; i++) {
    if (doc.fenced[i]) continue;
    const raw = doc.lines[i];
    if (!BULLET_RE.test(raw)) continue;
    const decl = REQ_ID_DECL_RE.exec(raw);
    const body = raw.replace(REQ_ID_DECL_RE, '').replace(BULLET_RE, '').trim();
    ARROW_RE.lastIndex = 0;
    const arrows = (raw.match(ARROW_RE) || []).length;
    out.push({ line: i + 1, raw: raw.trim(), body, id: decl ? decl[1] : null, arrows });
  }
  return out;
}

// ===========================================================================
// S19.2 spec-lint  (structure, residue, undecidable wording)
// ===========================================================================

// A threshold is written with the same two characters a template slot is: "first paint <1s |
// concurrency >100" hands the scan the span between a less-than and the greater-than of the next
// comparison, and every latency budget in a specification becomes an unfilled hole. Two shapes
// say comparison rather than slot -- a candidate carrying a table divider, and one that opens on
// a digit, an equals sign or a minus once its leading blanks are set aside and picks the
// measurement back up past the closing bracket. One side alone settles nothing: a prompt reading
// <2-3 cases that actually happened> opens on a digit just the same, and what gives it away is
// that the line ends at the bracket. Room around the operator is still a measurement, and room
// around a slot does not fill the slot in: whitespace decides nothing on its own, so
// < database choice > stays the hole it looks like.
const COMPARISON_SPAN_RE = /^[0-9=-]/;
// What may pick the measurement back up on the far side of the greater-than: the same three,
// plus the currency mark a price budget opens on.
const COMPARISON_TAIL_RE = /^[0-9=$-]/;

/** Angle-bracket runs that are neither recognizable markup nor a comparison. Pure. */
function placeholderBrackets(line) {
  const out = [];
  const re = /<([^<>\n]{1,200})>/g;
  let m = re.exec(line);
  while (m) {
    const inner = m[1].trim();
    const head = inner.replace(/^\//, '').split(/[\s/>]/)[0].toLowerCase();
    const tail = line.slice(m.index + m[0].length).trimStart();
    const comparison = m[1].includes('|')
      || (COMPARISON_SPAN_RE.test(m[1].trimStart()) && COMPARISON_TAIL_RE.test(tail));
    if (!HTML_TAGS.has(head) && !comparison) out.push('<' + inner + '>');
    m = re.exec(line);
  }
  return out;
}

/**
 * True when `tok` sits on the line as a deferral marker rather than as subject matter. The
 * three shapes a marker takes: wrapped in angle brackets, followed by a colon, or standing
 * alone as the whole item. Tokens outside MARKER_SHAPE_TOKENS still match bare. Pure.
 */
function placeholderMarker(line, tok) {
  const text = String(line);
  if (!MARKER_SHAPE_TOKENS.has(tok)) return text.includes(tok);
  return new RegExp('<\\s*' + tok + '\\s*>').test(text)
    || new RegExp('\\b' + tok + '\\s*[:\\uff1a]').test(text)
    || new RegExp('^\\s*(?:[-*+]|\\d+[.)])?\\s*' + tok + '\\s*[.\\u3002]?\\s*$').test(text);
}

// An escaped pipe is content, not a divider: "A \| B, which one" is one question in one cell,
// and splitting on it turns a five-cell row into six and then reports the row that answered
// everything. Set aside before the split and restored as a plain pipe after, so a row that reads
// as five cells to whoever wrote it is five cells here.
const CELL_PIPE_SENTINEL = '\u0000';

/** The cells of a markdown table row, trimmed; null when the line is not a row. Pure. */
function tableCells(line) {
  const t = String(line).trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/\\\|/g, CELL_PIPE_SENTINEL)
    .replace(/^\|/, '').replace(/\|$/, '')
    .split('|')
    .map(c => c.split(CELL_PIPE_SENTINEL).join('|').trim());
}

/**
 * Lint one requirement document. Errors: a required section missing or empty, template
 * residue, a requirement item with no arrow. Warnings: undecidable wording, partial
 * numbering. Pure over the text, so selftest exercises it without a filesystem.
 * @param {string} text
 * @param {string} file   reported in findings; not read
 */
function lintSpecDoc(text, file) {
  const doc = splitSections(text);
  const findings = [];
  const add = (severity, code, line, message, extra = {}) => {
    findings.push({ severity, code, file, line, message, ...extra });
  };

  // A fence nobody closed is not a formatting nit: every line after it is read as code, so the
  // rest of the document quietly stops being checked. Reported at the opener, because that is the
  // line someone has to go fix.
  for (const line of doc.unclosedFences) {
    add('error', 'UNCLOSED_FENCE', line, 'fence opened at line ' + line
      + ' is never closed; everything after it is skipped as code -- close it');
  }

  const present = [];
  const missing = [];
  const empty = [];
  for (const label of REQUIRED_SECTIONS) {
    const s = sectionNamed(doc, label);
    if (!s) {
      missing.push(label);
      add('error', 'MISSING_SECTION', 0, 'required section "' + label + '" is absent; the document cannot be read as a specification without it');
      continue;
    }
    present.push(s.title);
    if (sectionEmpty(doc, s)) {
      empty.push(label);
      add('error', 'EMPTY_SECTION', s.line, 'section "' + s.title + '" has a heading and no content; an empty section reads as answered');
    }
  }

  // The pending-questions section exempts the deferral word, not the section. Its heading names
  // the section, so it carries the token as subject matter; its rows are judged by shape on top
  // of wording -- five cells, none empty, since a question nobody owns and nobody dated defers
  // nothing and only records that someone typed the heading. Every other marker keeps its meaning
  // inside a row: one whose question only says TBD, or names the other bare token, has its five
  // cells and still records nothing. Every other line in there is an ordinary line of the
  // document: the markers and unfilled angle brackets are reported exactly as they are anywhere
  // else, so a sub-heading inside is no hiding place.
  const pending = sectionNamed(doc, PENDING_SECTION);
  for (let i = 0; i < doc.lines.length; i++) {
    if (doc.fenced[i]) {
      // Inside a fence only the slots are read, and only where the fence is not itself showing
      // how the syntax works. The rest of the residue stays unread in there: an angle bracket in
      // a code block is code, and a deferral marker is a note someone wrote into an example.
      if (TEMPLATE_FENCE_LANGS.has(doc.fenceLang[i])) continue;
      for (const slot of doc.lines[i].match(TEMPLATE_SLOT_RE) || []) {
        add('error', 'PLACEHOLDER', i + 1, slotMessage(slot));
      }
      continue;
    }
    const line = stripCodeSpans(doc.lines[i]);
    for (const ph of placeholderBrackets(line)) {
      add('error', 'PLACEHOLDER', i + 1, 'template placeholder ' + JSON.stringify(ph) + ' was never filled in; a half-written requirement is worse than an absent one');
    }
    for (const slot of line.match(TEMPLATE_SLOT_RE) || []) {
      add('error', 'PLACEHOLDER', i + 1, slotMessage(slot));
    }
    const inPending = !!pending && i >= pending.from - 1 && i < pending.to;
    if (inPending && i === pending.from - 1) continue;
    if (inPending) {
      const cells = tableCells(line);
      if (cells) {
        const shaped = cells.length === PENDING_ROW_CELLS;
        if (!shaped || cells.some(c => !c)) {
          add('error', 'PLACEHOLDER', i + 1, shaped
            ? 'pending question row leaves a cell empty (question, area, who decides, when needed,'
              + ' interim default); a question nobody owns defers nothing'
            : 'pending question row has ' + cells.length + ' cells, not the ' + PENDING_ROW_CELLS
              + ' the template asks for (question, area, who decides, when needed, interim default);'
              + ' a row of another shape defers nothing legibly');
        }
      }
    }
    for (const tok of PLACEHOLDER_TOKENS) {
      if (inPending && tok === PENDING_TOKEN) continue;
      if (placeholderMarker(line, tok)) {
        add('error', 'PLACEHOLDER', i + 1, 'unfinished marker "' + tok + '" in a requirement document; decide it or delete it');
      }
    }
  }

  const requirements = parseRequirements(doc);
  const ids = [];
  const seen = new Map();
  for (const r of requirements) {
    if (r.arrows === 0) {
      add('error', 'NO_FLOW', r.line, 'requirement states no flow (expected "<what the user does> ' + '\u2192'
        + ' <what the system does> ' + '\u2192' + ' <what comes out>"); as written it says neither what triggers it nor what it produces',
      { excerpt: r.raw.slice(0, 160) });
    }
    const hits = AMBIGUOUS_TERMS.filter(t => r.body.includes(t));
    if (hits.length) {
      add('warning', 'AMBIGUOUS', r.line, 'undecidable wording (' + hits.join(', ') + '); nobody can tell whether the built thing satisfies it',
        { excerpt: r.raw.slice(0, 160) });
    }
    if (r.id) {
      if (seen.has(r.id)) {
        add('error', 'DUPLICATE_ID', r.line, 'requirement id ' + r.id + ' is already declared at line ' + seen.get(r.id) + '; ids anchor traceability and cannot be reused');
      } else {
        seen.set(r.id, r.line);
        ids.push({ id: r.id, line: r.line });
      }
    }
  }
  if (ids.length && ids.length < requirements.length) {
    add('warning', 'PARTIAL_ID', 0, ids.length + ' of ' + requirements.length
      + ' requirements carry an id; trace would report coverage over the numbered subset only, which reads as coverage of all of them');
  }

  const errors = findings.filter(f => f.severity === 'error');
  return {
    ok: errors.length === 0,
    file,
    sections: { present, missing, empty },
    requirements: requirements.length,
    ids,
    counts: { error: errors.length, warning: findings.length - errors.length },
    findings: findings.slice(0, 200),
  };
}

/** Absolute path of the requirement document under test (--file overrides). */
function specFilePath(flags) {
  const rel = typeof flags.file === 'string' ? flags.file : DEFAULT_SPEC_FILE;
  return path.isAbsolute(rel) ? rel : path.join(projectRoot(), rel);
}

/** Read the spec document, or explain why there is nothing to lint. */
function readSpecDoc(flags) {
  const abs = specFilePath(flags);
  const rel = typeof flags.file === 'string' ? flags.file : DEFAULT_SPEC_FILE;
  if (!fs.existsSync(abs)) {
    return { ok: false, error: 'spec-missing', detail: rel, file: rel };
  }
  try {
    return { ok: true, file: rel, text: fs.readFileSync(abs, 'utf8') };
  } catch (e) {
    return { ok: false, error: 'spec-unreadable', detail: String(e && e.message || e), file: rel };
  }
}

function cmdSpecLint(flags) {
  const src = readSpecDoc(flags);
  if (!src.ok) {
    return emit({
      ok: false, degraded: true, error: src.error, detail: src.detail,
      note: 'no requirement document found at ' + src.file + '; nothing was checked (use --file to point elsewhere)',
    }, 3);
  }
  const r = lintSpecDoc(src.text, src.file);
  for (const f of r.findings) {
    process.stderr.write((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.code + '  '
      + f.file + (f.line ? ':' + f.line : '') + ' :: ' + f.message + '\n');
  }
  return emit(r, r.ok ? 0 : 1);
}

// ===========================================================================
// S19.3 trace  (requirement id <-> test reference; no anchor, no answer)
// ===========================================================================

const DEFAULT_TEST_GLOBS = [
  '**/test/**', '**/tests/**', '**/*.test.*', '**/*_test.*', '**/*Test.*',
  '**/*.spec.*', '**/*_spec.*', '**/spec/**',
];

// Extensions whose bytes cannot carry a requirement reference worth reading.
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.svgz', '.pdf', '.zip', '.gz',
  '.tgz', '.bz2', '.xz', '.7z', '.rar', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3',
  '.mp4', '.mov', '.avi', '.wasm', '.so', '.dylib', '.dll', '.exe', '.class', '.jar', '.pyc',
]);

const MAX_SCAN_BYTES = 512 * 1024;

/**
 * Collect requirement-id references out of already-read files (pure; injectable).
 * @param {Array<{path:string,content:string}>} files
 * @param {string[]} testGlobs
 * @param {Catalog|null} catalog     module attribution for the spec view
 * @returns {{refs:Map<string,{tests:string[],code:string[],modules:Set<string>}>,docs:Map<string,string[]>}}
 */
function collectReferences(files, testGlobs, catalog) {
  const refs = new Map();
  const docs = new Map();
  for (const f of files) {
    REQ_ID_REF_RE.lastIndex = 0;
    const hits = new Set();
    let m = REQ_ID_REF_RE.exec(f.content);
    while (m) { hits.add(m[0]); m = REQ_ID_REF_RE.exec(f.content); }
    if (!hits.size) continue;
    const isDoc = /\.(?:md|markdown|txt|rst)$/i.test(f.path);
    const isTest = matchAny(f.path, testGlobs);
    const moduleId = catalog ? moduleForPath(f.path, catalog) : null;
    for (const id of hits) {
      if (isDoc && !isTest) {
        if (!docs.has(id)) docs.set(id, []);
        docs.get(id).push(f.path);
        continue;
      }
      if (!refs.has(id)) refs.set(id, { tests: [], code: [], modules: new Set() });
      const rec = refs.get(id);
      if (isTest) rec.tests.push(f.path);
      else rec.code.push(f.path);
      if (moduleId) rec.modules.add(moduleId);
    }
  }
  return { refs, docs };
}

/**
 * Build the traceability report from declared ids and collected references (pure).
 * A reference from prose is reported, never failed: documentation legitimately cites an
 * example id. A reference from code or a test naming an id the specification does not
 * declare is a real break -- it points at a requirement that no longer exists.
 * @param {Array<{id:string,line:number}>} declared
 * @param {{refs:Map,docs:Map}} collected
 * @param {number} minCoverage
 */
function traceReport(declared, collected, minCoverage = 1) {
  const declaredIds = new Set(declared.map(d => d.id));
  const rows = declared.map(d => {
    const rec = collected.refs.get(d.id) || { tests: [], code: [], modules: new Set() };
    return {
      id: d.id, line: d.line,
      tests: rec.tests.slice(0, 10), testCount: rec.tests.length,
      codeCount: rec.code.length, modules: [...rec.modules],
      verified: rec.tests.length > 0,
      implemented: rec.code.length > 0,
    };
  });
  const dangling = [];
  for (const [id, rec] of collected.refs) {
    if (declaredIds.has(id)) continue;
    for (const p of rec.tests.concat(rec.code)) dangling.push({ id, file: p });
  }
  const danglingInDocs = [];
  for (const [id, files] of collected.docs) {
    if (declaredIds.has(id)) continue;
    for (const p of files) danglingInDocs.push({ id, file: p });
  }
  const unverified = rows.filter(r => !r.verified);
  const coverage = rows.length ? (rows.length - unverified.length) / rows.length : 0;
  return {
    ok: coverage >= minCoverage && dangling.length === 0,
    coverage: Number(coverage.toFixed(4)), minCoverage,
    total: rows.length, verified: rows.length - unverified.length,
    unverified: unverified.map(r => r.id),
    unimplemented: rows.filter(r => !r.implemented && !r.verified).map(r => r.id),
    dangling: dangling.slice(0, 50), danglingCount: dangling.length,
    danglingInDocs: danglingInDocs.slice(0, 50), danglingInDocsCount: danglingInDocs.length,
    rows,
  };
}

/** Read every tracked file that could carry a reference, minus the spec document itself. */
function referenceCorpus(catalog, specRel) {
  const root = projectRoot();
  const t = trackedFiles(catalog && catalog.maxTrackedPaths);
  const files = [];
  for (const p of t.paths) {
    const norm = toPosixPath(p);
    if (norm === specRel) continue;
    if (isDenied(norm) || isStateExcluded(norm)) continue;
    if (BINARY_EXTS.has(path.extname(norm).toLowerCase())) continue;
    let content;
    try {
      const st = fs.statSync(path.join(root, p));
      if (!st.isFile() || st.size > MAX_SCAN_BYTES) continue;
      const buf = fs.readFileSync(path.join(root, p));
      if (buf.includes(0)) continue;
      content = buf.toString('utf8');
    } catch (_e) { continue; }
    files.push({ path: norm, content });
  }
  return { files, truncated: t.truncated };
}

/** Shared by trace and spec: ids plus their references, or the reason there are none. */
function loadTrace(flags) {
  const src = readSpecDoc(flags);
  if (!src.ok) {
    return { ok: false, error: src.error, detail: src.detail, file: src.file,
      note: 'no requirement document found at ' + src.file + '; nothing to trace' };
  }
  const lint = lintSpecDoc(src.text, src.file);
  if (lint.ids.length === 0) {
    return { ok: false, error: 'no-requirement-ids', detail: src.file, file: src.file, lint,
      note: 'this specification declares no requirement ids, so traceability is unavailable and '
        + 'is not being approximated. To enable it, prefix each item under '
        + REQUIREMENT_SECTION + ' with [REQ-<module>-<nnn>].' };
  }
  if (!isGitRepo()) {
    return { ok: false, error: 'non-git', detail: 'trace enumerates references via git ls-files', file: src.file, lint,
      note: 'not a git repository; the set of files that could reference a requirement cannot be enumerated' };
  }
  const loaded = loadCatalogFlag(flags);
  const catalog = loaded.ok ? loaded.catalog : null;
  const testGlobs = typeof flags.tests === 'string' ? parseCsv(flags.tests) : DEFAULT_TEST_GLOBS;
  const corpus = referenceCorpus(catalog, src.file);
  const collected = collectReferences(corpus.files, testGlobs, catalog);
  return { ok: true, file: src.file, lint, catalog, collected, truncated: corpus.truncated, scanned: corpus.files.length };
}

function cmdTrace(flags) {
  const t = loadTrace(flags);
  if (!t.ok) {
    process.stderr.write(t.note + '\n');
    return emit({ ok: false, degraded: true, error: t.error, detail: t.detail, note: t.note }, 3);
  }
  const min = typeof flags['min-coverage'] === 'string' ? Number(flags['min-coverage']) : 1;
  const r = traceReport(t.lint.ids, t.collected, Number.isFinite(min) ? min : 1);
  for (const id of r.unverified) process.stderr.write(' UNVERIFIED  ' + id + ' :: no test file references this id\n');
  for (const d of r.dangling) process.stderr.write(' DANGLING    ' + d.id + ' :: referenced in ' + d.file + ' but never declared\n');
  // A corpus the budget cut short is a degraded measurement, not a smaller one: the files
  // that would have verified a requirement were never read, so "unverified" here diagnoses
  // the repository for something the cap did. Same 3 every other command uses to say that
  // it could not measure, rather than the 1 that says it measured and found a gap.
  if (t.truncated) {
    process.stderr.write('trace read ' + t.scanned + ' file(s) before the tracked-path cap ended the listing; '
      + 'the coverage below describes that fragment, not this repository\n');
  }
  return emit({ ...r, file: t.file, scanned: t.scanned, truncated: t.truncated, degraded: !!t.truncated },
    t.truncated ? 3 : (r.ok ? 0 : 1));
}

// ===========================================================================
// S19.4 spec  (a budgeted view: the requirements a change touches, not the document)
// ===========================================================================
// A requirement written three years ago still binds today, so the specification is the one
// document that only grows, and the only way to keep reading it affordable is to stop reading
// all of it. Narrowing runs through the same route the gate uses -- impact picks modules,
// trace maps ids onto modules, the intersection is rendered.
//
// Narrowing needs both an anchor and a catalog. When either is absent the whole requirement
// section is rendered within budget and `narrowed:false` says so, in the JSON and in the
// header of the rendered text. That is still the product asked for; what it is not allowed to
// do is stay quiet about having skipped the selection.

const SPEC_VIEW_BUDGET = 6000;

/**
 * Render the selected requirement items into a budgeted markdown block (pure).
 * @param {Array<{line:number,raw:string,id:(string|null)}>} items
 * @param {Map<string,{verified:boolean,tests:string[]}>} verification
 * @param {{budget:number,header:string}} opts
 */
function renderSpecView(items, verification, { budget = SPEC_VIEW_BUDGET, header = '' } = {}) {
  const blocks = [];
  let used = header.length;
  let omitted = 0;
  for (const it of items) {
    let block = '- ' + it.raw.replace(BULLET_RE, '') + '\n';
    const v = it.id ? verification.get(it.id) : null;
    if (v) block += '  _verified by: ' + (v.tests.join(', ') || 'NOTHING - unverified') + '_\n';
    if (used + block.length > budget) { omitted++; continue; }
    blocks.push(block);
    used += block.length;
  }
  return { view: header + blocks.join(''), rendered: blocks.length, omitted, chars: used };
}

function cmdSpec(flags) {
  const src = readSpecDoc(flags);
  if (!src.ok) {
    return emit({
      ok: false, degraded: true, error: src.error, detail: src.detail,
      note: 'no requirement document found at ' + src.file + '; there is no view to render',
    }, 3);
  }
  const budget = typeof flags.budget === 'string' && Number(flags.budget) > 0
    ? Math.floor(Number(flags.budget)) : SPEC_VIEW_BUDGET;
  const doc = splitSections(src.text);
  const items = parseRequirements(doc);
  const all = flags.all === true;

  let selected = items;
  let narrowed = false;
  let reason = '';
  let affected = [];
  // Whether the corpus the verification marks were drawn from was cut short by the
  // tracked-path cap. Only set on the route that reads one, so --all carries no such claim.
  let truncated = false;
  let scanned = 0;
  const verification = new Map();

  if (all) {
    reason = '--all requested; the whole requirement section is in scope';
  } else {
    const t = loadTrace(flags);
    if (t.ok) { truncated = !!t.truncated; scanned = t.scanned; }
    if (!t.ok) {
      reason = 'cannot narrow (' + t.error + '); rendering every requirement instead. ' + t.note;
    } else if (!t.catalog) {
      reason = 'cannot narrow (no module catalog); requirements cannot be mapped onto the changed modules';
    } else {
      const changed = typeof flags.paths === 'string' ? parseCsv(flags.paths)
        : (() => { const cp = changedPaths(); return Array.isArray(cp) ? cp : cp.paths; })();
      const imp = analyzeImpact(changed, t.catalog, { nonGit: !isGitRepo() });
      affected = imp.affected;
      const report = traceReport(t.lint.ids, t.collected, 1);
      for (const row of report.rows) verification.set(row.id, { verified: row.verified, tests: row.tests });
      if (imp.degraded) {
        reason = 'impact degraded (' + imp.expansionReasons.slice(0, 3).join(', ') + '); a degraded impact means every module, which would defeat the purpose of narrowing';
      } else {
        const set = new Set(affected);
        const byId = new Map(report.rows.map(r => [r.id, r]));
        selected = items.filter(it => it.id && byId.has(it.id) && byId.get(it.id).modules.some(m => set.has(m)));
        narrowed = true;
        reason = selected.length === 0
          ? 'no requirement id is cited by the code or tests of [' + affected.join(', ')
            + ']; put the id in what implements it, or this change cannot be traced to anything it was asked to do'
          : 'narrowed to the requirements cited by [' + affected.join(', ') + ']';
      }
    }
  }

  // The view is the product here, so the truncation goes into it and not only into the JSON:
  // an agent handed "0 of 1 requirement(s) selected" reads that the repository failed to cite
  // its ids, when the file that cites them was never opened. Rendering less is allowed;
  // saying nothing about it is what turns a budget into a wrong measurement. Only when it
  // happened -- a line that is always there is a line nobody reads.
  const truncationNote = truncated
    ? '> The corpus this view was drawn from was truncated at the tracked-path cap after '
      + scanned + ' file(s) were read, so a requirement may appear here unverified, or not appear '
      + 'at all, because the file that would have cited it was never opened.\n\n'
    : '';
  const header = '# Requirements in scope' + (narrowed ? ' for [' + affected.join(', ') + ']' : ' (all)') + '\n\n'
    + selected.length + ' of ' + items.length + ' requirement(s) selected; ' + reason + '.\n\n'
    + truncationNote;
  const rendered = renderSpecView(selected, verification, { budget, header });
  return emit({
    ok: true, file: src.file, total: items.length, narrowed, reason,
    affected, selected: selected.map(it => it.id || ('line:' + it.line)),
    ...(truncated ? { truncated: true, scanned } : {}),
    budget, chars: rendered.chars, rendered: rendered.rendered, omitted: rendered.omitted,
    view: rendered.view,
  }, 0);
}

// ===========================================================================
// S19.5 dod  (every static governance check, once, with one verdict)
// ===========================================================================
// Static only: nothing here executes a project's own test suite, so a satisfied Definition of
// Done means the governance surface is clean, not that the code works. `gate` still owns that
// half, and the note in the output says so rather than leaving it to be assumed.
//
// DEGRADED is not FAIL and does not block -- a repository without a catalog is not a
// repository that failed its architecture check. But a run in which no blocking step ever
// reached a verdict established nothing, and reporting that as satisfied is the same false
// green the empty verification plan already fails on, so it exits 3 rather than 0.

const DOD_STEPS = [
  { id: 'catalog-lint', argv: ['catalog-lint'], blocking: true },
  { id: 'spec-lint', argv: ['spec-lint'], blocking: true },
  { id: 'trace', argv: ['trace'], blocking: true },
  { id: 'attributes', argv: ['attributes'], blocking: true },
  { id: 'arch-check', argv: ['arch-check'], blocking: true },
  { id: 'adr-check', argv: ['adr-check'], blocking: true },
  { id: 'fitness', argv: ['fitness', '--all'], blocking: true },
  { id: 'ledger', argv: ['ledger'], blocking: true },
  { id: 'arch-trend', argv: ['arch-trend', '--gate'], blocking: true },
  // The constitution layer. All three fail on the same shape of defect: a rule, a skill or a
  // module boundary that reads as enforced and is not. `rules-audit` blocks on phantom
  // references only -- its unclassified count is a worklist for a human and must not decide
  // a build. The other two block on their findings, and all three degrade rather than fail
  // where their source is absent, which is why a repository with no catalog still passes.
  { id: 'rules-audit', argv: ['rules-audit'], blocking: true },
  { id: 'skills-lint', argv: ['skills-lint'], blocking: true },
  { id: 'claude-md-lint', argv: ['claude-md-lint'], blocking: true },
  // The dial's own configuration, in the same group for the same reason: a profile that lists
  // a hook nothing registers, or that is stricter at fast than at standard, changes which
  // gates run and says nothing while doing it. Appended rather than inserted -- every entry
  // added mid-list renumbers the rest of a recorded baseline, and a hundred lines of
  // positional churn is where a real change hides. Degrades where no profile is installed.
  { id: 'tier', argv: ['tier', 'validate'], blocking: true },
  // Signals, not verdicts. `budget` is documented as a split-or-escalate prompt and `risk`
  // reports decay that may be entirely expected; failing the build on either would get the
  // whole command switched off, which costs more than the two findings are worth.
  { id: 'risk', argv: ['risk'], blocking: false },
  { id: 'budget', argv: ['budget'], blocking: false },
];

function harnessEntry() {
  return path.join(HARNESS_DIR, 'harness.mjs');
}

/** Map one child exit code onto the three states dod reports. Pure. */
function dodStatus(code) {
  if (code === 0) return 'PASS';
  if (code === 3) return 'DEGRADED';
  return 'FAIL';
}

/** Aggregate the step list into a verdict (pure; the exit code follows from it). */
function dodVerdict(steps) {
  const blocking = steps.filter(s => s.blocking);
  const failed = blocking.filter(s => s.status === 'FAIL').map(s => s.id);
  const established = blocking.filter(s => s.status !== 'DEGRADED').length;
  if (failed.length) return { ok: false, exit: 2, blockingFailures: failed, established };
  if (blocking.length && established === 0) {
    return { ok: false, exit: 3, blockingFailures: [], established, degraded: true };
  }
  return { ok: true, exit: 0, blockingFailures: [], established };
}

function runDodStep(step) {
  const r = spawnSync(process.execPath, [harnessEntry(), ...step.argv], {
    cwd: projectRoot(),
    input: '',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot() },
  });
  if (r.error) {
    return { id: step.id, argv: step.argv, blocking: step.blocking, status: 'FAIL', exit: null,
      error: 'spawn-failed', counts: null, detail: String(r.error.message) };
  }
  let out = null;
  try { out = JSON.parse(String(r.stdout || '').trim()); } catch (_e) { out = null; }
  const code = typeof r.status === 'number' ? r.status : null;
  return {
    id: step.id, argv: step.argv, blocking: step.blocking,
    status: code === null ? 'FAIL' : dodStatus(code),
    exit: code,
    error: out && typeof out.error === 'string' ? out.error : null,
    counts: out && out.counts && typeof out.counts === 'object' ? out.counts : null,
  };
}

function cmdDod(flags) {
  const only = typeof flags.only === 'string' ? new Set(parseCsv(flags.only)) : null;
  const steps = [];
  for (const step of DOD_STEPS) {
    if (only && !only.has(step.id)) continue;
    const r = runDodStep(step);
    steps.push(r);
    process.stderr.write(' ' + r.status.padEnd(9) + r.id
      + (r.error ? ' :: ' + r.error : '') + '\n');
  }
  const verdict = dodVerdict(steps);
  process.stderr.write(verdict.ok
    ? 'Definition of Done: satisfied (static governance only; behavioural proof is `gate`)\n'
    : 'Definition of Done: NOT satisfied'
      + (verdict.blockingFailures.length ? ' (' + verdict.blockingFailures.join(', ') + ')' : ' (no blocking step reached a verdict)') + '\n');
  return emit({
    ok: verdict.ok,
    ...(verdict.degraded ? { degraded: true } : {}),
    steps,
    blockingFailures: verdict.blockingFailures,
    established: verdict.established,
    note: 'static governance only; a satisfied result does not establish that the code works -- that is `gate`',
  }, verdict.exit);
}

export {
  DEFAULT_SPEC_FILE, REQUIRED_SECTIONS, REQUIREMENT_SECTION, PLACEHOLDER_TOKENS,
  AMBIGUOUS_TERMS, HTML_TAGS, DEFAULT_TEST_GLOBS, SPEC_VIEW_BUDGET, DOD_STEPS,
  stripCodeSpans, splitSections, sectionNamed, sectionEmpty, parseRequirements,
  placeholderBrackets, lintSpecDoc, specFilePath, readSpecDoc, cmdSpecLint,
  collectReferences, traceReport, referenceCorpus, loadTrace, cmdTrace,
  renderSpecView, cmdSpec,
  dodStatus, dodVerdict, runDodStep, cmdDod,
};
