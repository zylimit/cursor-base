// ext/rules.mjs -- S22 the constitution audit: which rules point at something that runs,
// and which ones are only being asked nicely.
//
// Two 2026 results make this measurable rather than aesthetic. The first is that a rule set
// is not free even when it is ignored: agent rule files change behaviour in directions
// nobody wrote down, so a clause that enforces nothing is not neutral, it is a distortion
// with no upside. The second is the ceiling -- instruction adherence falls as the number of
// simultaneous instructions rises. Together they say the thing to minimise is not bytes and
// not clauses. It is the clauses that reach no enforcement point AND do not admit it.
//
// So a constitution where every line names a command is healthy at any length, and a short
// one full of exhortation is not. The four classes:
//
//   machine   the line names a token that resolves to something that exists -- a harness
//             subcommand, a hook, a script, a test. Somebody can run it. Quoting it in
//             backticks is one way to name it; opening the clause with it in bold, the way
//             a capability list does, is the other.
//   prompt    the line says so itself: prompt-only, (P), [P], or the Chinese for "on the
//             honour system". An admitted gap is a managed one.
//   phantom   the line quotes a token shaped exactly like an enforcement point that is not
//             there. This is worse than silence: it reads as enforced, so nobody checks,
//             and the check it names will never run. The only class that fails the command.
//   unclassified  everything else. Not an accusation -- a worklist. Each of these either
//             gets wired to something, gets marked prompt-only, or gets deleted.
//
// The audit is deliberately shy about phantom. A token becomes one only when it could not
// be anything else: an explicit `harness.mjs <word>` whose word is not a subcommand, or a
// literal .sh/.ps1/.mjs path under .claude that is not on disk. Globs, placeholders, JSON
// field names, config keys and data files resolve to nothing and stay out of both machine
// and phantom -- a false phantom would send someone to fix a rule that was never broken,
// and a false machine is an automated phantom, which is the failure this file exists to
// name. When in doubt the token contributes nothing and the line lands in unclassified,
// where a human reads it. The bold form is shyer still and can only ever add machine: a
// backtick says "this is a reference" and is judged both ways, while bold says "this word
// matters" and is read for a reference only because the capability lists happen to open
// with one.
//
// The subcommand table is passed in rather than imported: harness.mjs owns it and imports
// this module, so reaching back for it would close a cycle.
//
// Source is ASCII-only like the rest of the runtime; the one Chinese marker this scanner
// matches is written escaped, with its meaning in the comment beside it.

import fs from 'node:fs';
import path from 'node:path';
import { emit, isGitRepo, projectRoot, toPosixPath } from '../lib/core.mjs';
import { loadCatalogFlag } from './catalog.mjs';

// ===========================================================================
// S22.1 what counts as a rule line, and what the four classes are
// ===========================================================================

// Repository-relative, forward-slashed, and written that way rather than joined: these two
// strings are reported back as `file` and inside every `at`, so building them with path.join
// would print `.claude\CLAUDE.md` on Windows and `.claude/CLAUDE.md` everywhere else.
// path.join(root, rel) still resolves them for the filesystem on either platform.
const RULES_DOC = '.claude/CLAUDE.md';
const RULES_DIR = '.claude/rules';

// Directories whose contents are enforcement points, walked in full: a test helper two
// levels down enforces as much as one at the top. Only the executable extensions are
// indexed -- a fixture sitting beside a script is data, however official the path looks,
// and indexing it would let a rule claim enforcement by naming a JSON file.
const POINT_DIRS = [
  '.claude/hooks',
  '.claude/scripts',
  '.claude/tests',
  '.claude/harness',
];
const POINT_EXTS = ['.sh', '.ps1', '.mjs'];
const WALK_DEPTH = 4;

// A self-declared prompt-only clause. The Chinese marker is \u9760\u81ea\u89c9,
// "on the honour system".
const PROMPT_MARKERS = ['prompt-only', '\u9760\u81ea\u89c9', '(P)', '[P]'];
// A marker directly preceded by one of these is a denial, not an admission.
const NEGATIONS = ['\u4e0d', '\u975e'];

// Command words that precede a script path rather than being one.
const RUNNERS = ['node', 'bash', 'sh', 'pwsh', 'powershell'];

const TEXT_BUDGET = 90;
const DEFAULT_LIMIT = 100;

/**
 * Is this a rule line? List bullets, numbered steps and table rows carry the clauses;
 * headings, prose and fence contents do not. A row of dashes is a table separator and a
 * bullet with nothing after the marker is layout, so both are dropped.
 * Pure.
 * @returns {string|null} the clause text with its marker removed, or null.
 */
function ruleLineText(line) {
  const raw = String(line);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let body = null;
  // \u2022 and \u00b7 are the two bullets this repository's rule files use for nested
  // clauses; a scanner that only knows the ASCII dash would miss whole sub-lists.
  if (/^[-*\u2022\u00b7]\s+/.test(trimmed)) body = trimmed.replace(/^[-*\u2022\u00b7]\s+/, '');
  else if (/^\d+[.)]\s+/.test(trimmed)) body = trimmed.replace(/^\d+[.)]\s+/, '');
  else if (trimmed.startsWith('|')) {
    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length === 0) return null;
    // A separator row is all dashes and colons; it carries no clause.
    if (cells.every(c => /^:?-{2,}:?$/.test(c))) return null;
    body = cells.join(' | ');
  }
  if (body === null) return null;
  // Substance: a marker plus one or two characters of decoration is not a rule.
  const bare = body.replace(/[*`_~#>\s]/g, '');
  if (bare.length < 4) return null;
  return body;
}

/**
 * The bold token a rule line opens with, if it opens with one. `- **catalog-lint**: ...` is
 * how this repository writes a capability list, and the name in that position is the subject
 * of the clause rather than a word being stressed inside it -- so it is worth resolving,
 * while `**must**` halfway down a sentence is not.
 * Only the opening position is read, and only the run up to the closing markers.
 * Pure.
 * @returns {string|null}
 */
function leadingBoldToken(line) {
  const m = /^\*\*([^*]+)\*\*/.exec(String(line).trim());
  if (!m) return null;
  const t = m[1].trim();
  return t ? t : null;
}

/** The `backtick` tokens on a line, in order. Pure. */
function backtickTokens(line) {
  const out = [];
  const re = /`([^`]*)`/g;
  let m;
  while ((m = re.exec(String(line))) !== null) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Does the line admit, in its own words, that nothing enforces it?
 * A negated marker is the opposite claim and must not be counted: this repository writes
 * \u4e0d + the marker ("not on the honour system") on exactly the clauses that were
 * mechanised, and a substring match would file the strongest rules under the weakest class.
 * Pure.
 */
function admitsPromptOnly(line) {
  const s = String(line);
  return PROMPT_MARKERS.some(mk => {
    let from = 0;
    for (;;) {
      const i = s.indexOf(mk, from);
      if (i < 0) return false;
      if (!NEGATIONS.includes(s.slice(Math.max(0, i - 1), i))) return true;
      from = i + 1;
    }
  });
}

// ===========================================================================
// S22.2 resolving one token against the things that actually exist
// ===========================================================================

/**
 * The enforcement points this checkout has: the subcommand table plus every executable
 * under the point directories, indexed by both relative path and bare basename so that
 * `stop-gate.sh` and `.claude/hooks/stop-gate.sh` resolve the same way.
 */
function collectPoints(subcommands, root = projectRoot()) {
  const files = new Set();
  const basenames = new Set();
  const counts = {};
  for (const dir of POINT_DIRS) {
    const rel = toPosixPath(dir);
    const before = files.size;
    walkPoints(path.join(root, dir), rel, files, basenames, WALK_DEPTH);
    counts[path.basename(dir)] = files.size - before;
  }
  return {
    subcommands: new Set(subcommands || []),
    files,
    basenames,
    counts: { subcommands: (subcommands || []).length, ...counts },
  };
}

/** Depth-bounded walk of one point directory. An unreadable directory contributes nothing. */
function walkPoints(abs, rel, files, basenames, depth) {
  if (depth < 0) return;
  let entries = [];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (_e) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      walkPoints(path.join(abs, e.name), rel + '/' + e.name, files, basenames, depth - 1);
      continue;
    }
    if (!POINT_EXTS.includes(path.extname(e.name))) continue;
    files.add(rel + '/' + e.name);
    basenames.add(e.name);
  }
}

/** A token the audit must not judge: a placeholder or a glob stands for many things. */
function isUnresolvable(word) {
  return word.includes('<') || word.includes('>') || word.includes('*') || word.includes('?');
}

/** Does this word name a file that only an enforcement point would be? Pure-ish. */
function looksExecutable(word) {
  const ext = path.extname(word);
  if (ext === '.sh' || ext === '.ps1') return true;
  if (ext === '.mjs' && word.includes('.claude/')) return true;
  return false;
}

/** Trim the decoration a document puts around a path: line ranges, alternates, quotes. */
function normalizeWord(word) {
  let w = word;
  if (w.includes('|')) w = w.slice(0, w.indexOf('|'));
  w = w.replace(/:\d+(-\d+)?$/, '');
  w = w.replace(/^["'(\[]+/, '').replace(/["')\].,;]+$/, '');
  return w;
}

/**
 * Classify one backtick token.
 * Pure given `points`.
 * @returns {{kind:'machine'|'phantom'|'none', target?:string, reason?:string}}
 */
function classifyToken(token, points) {
  const t = String(token).trim();
  if (!t) return { kind: 'none' };

  // An explicit harness invocation names its subcommand, wherever it is embedded -- inside
  // a JSON check definition as often as on its own. This branch is the only one that can
  // call a bare word phantom, because it is the only one where the word's role is stated.
  const inv = /harness\.mjs\s+([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(t);
  if (inv) {
    const word = inv[1];
    if (points.subcommands.has(word)) return { kind: 'machine', target: word, reason: 'subcommand' };
    return { kind: 'phantom', target: word, reason: 'no such harness subcommand' };
  }

  let head = t;
  for (const r of RUNNERS) {
    if (head.startsWith(r + ' ')) { head = head.slice(r.length + 1).trim(); break; }
  }
  head = head.split(/\s+/)[0] || '';
  head = normalizeWord(head);
  if (!head || isUnresolvable(head)) return { kind: 'none' };

  if (points.subcommands.has(head)) return { kind: 'machine', target: head, reason: 'subcommand' };

  // Being under a point directory is not enough to be one: fixtures, catalogs and sample
  // JSON live there too, and calling a real fixture a phantom sends someone to fix a rule
  // that was never broken. Only an executable shape is judged, in either direction.
  const rel = head.replace(/^\.\//, '');
  if (!looksExecutable(rel)) return { kind: 'none' };
  if (points.files.has(rel)) return { kind: 'machine', target: rel, reason: 'file' };
  if (!rel.includes('/') && points.basenames.has(rel)) {
    return { kind: 'machine', target: rel, reason: 'file' };
  }
  return { kind: 'phantom', target: rel, reason: 'no such file' };
}

/**
 * Classify a whole rule line. Phantom outranks machine: a line that names one real check
 * and one imaginary one is a line somebody has to fix. Machine outranks the prompt-only
 * marker, because naming a runnable check is a stronger claim than admitting there is none.
 *
 * The opening bold token counts as machine when it resolves, and never as phantom when it
 * does not. Bold is not a reference syntax: this repository writes it on ordinary emphasis
 * far more often than on a command, so a bold word that resolves to nothing is a word, not
 * a broken reference, and accusing it would bury the real phantoms under a pile of prose.
 * Backticks are the explicit form and keep both directions.
 * Pure given `points`.
 */
function classifyRuleLine(text, points) {
  const tokens = backtickTokens(text);
  const machine = [];
  const phantom = [];
  for (const tok of tokens) {
    const r = classifyToken(tok, points);
    if (r.kind === 'machine') machine.push({ token: tok, target: r.target, reason: r.reason });
    else if (r.kind === 'phantom') phantom.push({ token: tok, target: r.target, reason: r.reason });
  }
  const bold = leadingBoldToken(text);
  if (bold) {
    const r = classifyToken(bold, points);
    if (r.kind === 'machine') machine.push({ token: bold, target: r.target, reason: r.reason });
  }
  let klass;
  if (phantom.length > 0) klass = 'phantom';
  else if (machine.length > 0) klass = 'machine';
  else if (admitsPromptOnly(text)) klass = 'prompt';
  else klass = 'unclassified';
  return { klass, machine, phantom };
}

// ===========================================================================
// S22.3 the documents, the tally, and the command
// ===========================================================================

/** Rule documents in a stable order: the constitution first, then its sections by name. */
function ruleDocs(root = projectRoot()) {
  const docs = [];
  const main = path.join(root, RULES_DOC);
  if (fs.existsSync(main)) docs.push(RULES_DOC);
  const dir = path.join(root, RULES_DIR);
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_e) { names = []; }
  for (const name of names.filter(n => n.endsWith('.md')).sort()) {
    docs.push('.claude/rules/' + name);
  }
  return docs;
}

/** Clause text, shortened for a report that has to stay one line of JSON. Pure. */
function clip(text, budget = TEXT_BUDGET) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length <= budget ? s : s.slice(0, budget) + '...';
}

/**
 * Walk one document's lines and classify each rule line. Fenced code is skipped: a shell
 * snippet inside a fence is an example, not a clause, and counting it would let a file
 * lower its own unclassified ratio by pasting commands.
 * Pure given `points`.
 */
function auditDoc(rel, content, points) {
  const lines = String(content).split(/\r?\n/);
  const rules = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const text = ruleLineText(line);
    if (text === null) continue;
    const c = classifyRuleLine(text, points);
    rules.push({ at: rel + ':' + (i + 1), klass: c.klass, text, machine: c.machine, phantom: c.phantom });
  }
  return rules;
}

/** Tally the four classes and their share of the whole. Pure. */
function tally(rules) {
  const counts = { machine: 0, prompt: 0, phantom: 0, unclassified: 0 };
  for (const r of rules) counts[r.klass]++;
  const total = rules.length;
  const ratio = {};
  for (const k of Object.keys(counts)) {
    ratio[k] = total === 0 ? 0 : Math.round((counts[k] / total) * 1000) / 1000;
  }
  return { total, counts, ratio };
}

function positiveInt(v, fallback) {
  if (typeof v !== 'string') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cmdRulesAudit(flags = {}, subcommands = []) {
  const root = projectRoot();
  const docs = ruleDocs(root);
  if (docs.length === 0) {
    const note = 'no rule documents found (' + RULES_DOC + ' / ' + RULES_DIR
      + '); there is no constitution to audit, which is not the same as a clean one';
    process.stderr.write(note + '\n');
    return emit({ ok: false, degraded: true, error: 'no-rules', files: [], note }, 3);
  }
  const points = collectPoints(subcommands, root);
  const limit = positiveInt(flags.limit, DEFAULT_LIMIT);
  const rules = [];
  const perFile = [];
  const unreadable = [];
  for (const rel of docs) {
    let content = '';
    try {
      content = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (e) {
      unreadable.push({ file: rel, error: String(e && e.message ? e.message : e) });
      continue;
    }
    const found = auditDoc(rel, content, points);
    perFile.push({ file: rel, ...tally(found) });
    for (const r of found) rules.push(r);
  }
  const overall = tally(rules);
  const unclassified = rules.filter(r => r.klass === 'unclassified');
  const phantomRules = rules.filter(r => r.klass === 'phantom');

  for (const r of phantomRules) {
    for (const p of r.phantom) {
      process.stderr.write('PHANTOM ' + r.at + '  `' + p.token + '` -> ' + p.reason + '\n');
    }
  }
  process.stderr.write('rules ' + overall.total
    + '  machine ' + overall.counts.machine + ' (' + overall.ratio.machine + ')'
    + '  prompt ' + overall.counts.prompt + ' (' + overall.ratio.prompt + ')'
    + '  phantom ' + overall.counts.phantom
    + '  unclassified ' + overall.counts.unclassified + ' (' + overall.ratio.unclassified + ')\n');
  for (const r of unclassified.slice(0, 10)) {
    process.stderr.write('  U ' + r.at + '  ' + clip(r.text, 60) + '\n');
  }
  if (unclassified.length > 10) {
    process.stderr.write('  ... ' + (unclassified.length - 10) + ' more unclassified rule(s)\n');
  }

  return emit({
    ok: phantomRules.length === 0,
    files: perFile,
    unreadable,
    enforcementPoints: points.counts,
    rules: overall.total,
    counts: overall.counts,
    ratio: overall.ratio,
    phantom: phantomRules.slice(0, limit).map(r => ({
      at: r.at,
      tokens: r.phantom.map(p => ({ token: p.token, target: p.target, reason: p.reason })),
      text: clip(r.text),
    })),
    phantomOmitted: Math.max(0, phantomRules.length - limit),
    unclassified: unclassified.slice(0, limit).map(r => ({ at: r.at, text: clip(r.text) })),
    unclassifiedOmitted: Math.max(0, unclassified.length - limit),
    note: phantomRules.length === 0
      ? 'no phantom reference; the unclassified count is a worklist for a human, not a gate'
      : 'a rule names an enforcement point that does not exist; it reads as enforced and is not',
  }, phantomRules.length === 0 ? 0 : 1);
}

// ===========================================================================
// S23 skills-lint: the frontmatter that decides whether a skill is loaded at all
// ===========================================================================
//
// A SKILL.md whose frontmatter is malformed is reported nowhere: Claude Code drops the
// skill and says nothing, so a broken one is indistinguishable from one nobody wrote. That
// is the most expensive silence in this repository, because what stops running is the thing
// that was supposed to enforce something -- and the constitution keeps pointing at it. This
// command's whole job is to turn that silence into a red.
//
// There is no YAML parser here, on purpose: hand-rolling one is how a checker ends up
// disagreeing with the loader it is supposed to predict. The subset is drawn tight around
// what Claude Code frontmatter actually uses -- top-level `key: value`, plain or quoted --
// and any shape outside it is reported undecidable and costs exit 3. Declining to rule is
// honest; guessing in either direction is not. The same line was drawn for the audit layer
// in .claude/harness/audit/check-syntax.mjs and the judgements here match it, the sharpest
// one being that a plain value may not contain ": " -- the loader rejects the whole
// document, and a description with one ASCII colon in it is the likeliest way a skill in
// this repository breaks itself. The two files do not import each other: the audit layer
// deliberately does not reach into the engine, and the engine tying its exit codes to a
// script it does not ship with would be the same mistake in reverse.

const SKILLS_DIR = '.claude/skills';
const SKILL_FILE = 'SKILL.md';

// Both halves of the description rule live here now: the shape the loader parses, and the
// wording that decides whether the model ever reaches for the skill. They used to be split
// across a bash gate and this command, which meant a skill could pass one and fail the
// other -- a rule nobody can act on. The bash half is retired; this is the only gate.
const DESCRIPTION_BUDGET = 180;

// A description earns its place by saying WHEN the skill applies, not by summarising what it
// does: a summary gives the model nothing to match a situation against. The two shapes this
// repository writes triggers in are the ones below, and opening on either word counts too.
// Process-summary prose is only held against a description that has no trigger at all -- the
// prose is the symptom there, the missing trigger is the fault.
const TRIGGER_RES = [/当.*?时/, /由.*?调用/];
const SUMMARY_TOKENS = ['生成', '通过', '分阶段', '输出', '支持', '执行', '内置', '维护'];

/** Whether a description states when the skill applies, rather than what it does. */
function isTriggerShaped(description) {
  return TRIGGER_RES.some((re) => re.test(description))
    || description.startsWith('当') || description.startsWith('由');
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Flags whose value the loader reads as a boolean. A quoted "false" is a non-empty string,
// which is truthy, so the flag reads as SET while its text says the opposite.
const BOOLEAN_KEYS = ['disable-model-invocation', 'user-invocable'];
const FM_KEY_RE = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:(?:\s+(.*))?$/;
const BLOCK_SCALAR_RE = /^[|>][+-]?[0-9]*$/;

/** Index just past the closing quote on this line, or -1 when the scalar does not close here. */
function closingQuote(s, ch) {
  for (let i = 1; i < s.length; i++) {
    const c = s.charAt(i);
    if (ch === '"') {
      if (c === '\\') { i++; continue; }
      if (c === '"') return i + 1;
    } else if (c === "'") {
      if (s.charAt(i + 1) === "'") { i++; continue; }
      return i + 1;
    }
  }
  return -1;
}

/**
 * Judge one value after `key:`. Pure.
 * @returns {{kind:'ok'|'error'|'undecidable', value?:string, quoted?:boolean, raw?:string, reason?:string}}
 */
function scalarValue(raw, n) {
  const v = String(raw);
  if (v === '') return { kind: 'ok', value: '', quoted: false, raw: v };
  const ch = v.charAt(0);
  if (ch === '"' || ch === "'") {
    const close = closingQuote(v, ch);
    if (close < 0) {
      return { kind: 'undecidable', reason: 'line ' + n + ' opens a quoted value that does not close on the same line; a multi-line scalar is outside the subset this lint rules on' };
    }
    const rest = v.slice(close).trim();
    if (rest !== '' && !rest.startsWith('#')) {
      return { kind: 'error', reason: 'line ' + n + ' has text after the closing quote, which the loader rejects: ' + clip(rest, 40) };
    }
    const inner = v.slice(1, close - 1);
    return { kind: 'ok', quoted: true, raw: v, value: ch === '"' ? inner.replace(/\\"/g, '"') : inner.replace(/''/g, "'") };
  }
  if (BLOCK_SCALAR_RE.test(v)) {
    return { kind: 'undecidable', reason: 'line ' + n + ' opens a block scalar; its body is outside the subset this lint rules on' };
  }
  if (ch === '{' || ch === '[') {
    return { kind: 'undecidable', reason: 'line ' + n + ' uses a flow collection; outside the subset this lint rules on' };
  }
  if (ch === '&' || ch === '*' || ch === '!') {
    return { kind: 'undecidable', reason: 'line ' + n + ' uses an anchor, alias or tag; outside the subset this lint rules on' };
  }
  if (/^[@`%]/.test(v)) {
    return { kind: 'error', reason: 'line ' + n + ' starts a plain value with the reserved indicator ' + ch + '; the loader rejects it unless the value is quoted' };
  }
  if (/^-(\s|$)/.test(v)) {
    return { kind: 'error', reason: 'line ' + n + ' starts a plain value with "- ", which YAML reads as a sequence entry' };
  }
  if (/^[|>]/.test(v)) {
    return { kind: 'error', reason: 'line ' + n + ' has a malformed block scalar header; the indicator must stand alone on the line' };
  }
  if (/:(\s|$)/.test(v)) {
    return { kind: 'error', reason: 'line ' + n + ' puts ": " inside a plain value; YAML reads that as a second mapping key and rejects the document -- quote the value: ' + clip(v, 40) };
  }
  return { kind: 'ok', value: v, quoted: false, raw: v };
}

/**
 * Parse the frontmatter block of one SKILL.md into top-level fields. Pure.
 * @returns {{kind:'ok', fields:Object}|{kind:'error', code:string, reason:string, line:number}
 *           |{kind:'undecidable', reason:string, line:number}}
 */
function parseFrontmatter(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split('\n').map(l => l.replace(/\r$/, ''));
  if (lines[0] !== '---') {
    return { kind: 'error', code: 'NO_FRONTMATTER', line: 1, reason: 'the file does not open with "---", so the loader reads no frontmatter and never registers the skill' };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { end = i; break; }
  }
  if (end < 0) {
    return { kind: 'error', code: 'UNTERMINATED_FRONTMATTER', line: 1, reason: 'the frontmatter block opened on line 1 is never closed by a second "---"' };
  }
  const fields = {};
  let count = 0;
  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    const n = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    // Indentation means a nested map, a list item or a scalar continued across lines. None
    // of the three appear in this repository's skills, and each needs a parser this file
    // deliberately does not have, so the honest answer is that it was not ruled on.
    if (/^[ \t]/.test(raw)) {
      return { kind: 'undecidable', line: n, reason: 'line ' + n + ' is indented; nested maps, list items and multi-line scalars are outside the subset this lint rules on' };
    }
    const m = FM_KEY_RE.exec(raw);
    if (!m) {
      return { kind: 'error', code: 'MALFORMED_LINE', line: n, reason: 'line ' + n + ' is not a "key: value" pair, and at the top level of the block nothing else is legal: ' + clip(trimmed, 40) };
    }
    const res = scalarValue(String(m[2] === undefined ? '' : m[2]).trim(), n);
    if (res.kind === 'error') return { kind: 'error', code: 'MALFORMED_VALUE', line: n, reason: res.reason };
    if (res.kind === 'undecidable') return { kind: 'undecidable', line: n, reason: res.reason };
    count++;
    // A repeated key is last-one-wins in every YAML reader this has to predict, so the last
    // value is the one the loader sees and therefore the one worth judging.
    fields[m[1]] = { value: res.value, quoted: !!res.quoted, raw: res.raw, line: n };
  }
  if (count === 0) {
    return { kind: 'error', code: 'EMPTY_FRONTMATTER', line: 1, reason: 'the frontmatter block holds no keys, so the skill has neither a name nor a description to be loaded by' };
  }
  return { kind: 'ok', fields };
}

/**
 * Lint one SKILL.md. The directory name is passed in rather than derived, because the
 * question this asks is whether the declared name and the directory agree.
 * Pure.
 */
function lintSkillFile(dirName, relFile, text) {
  const findings = [];
  const undecidable = [];
  const parsed = parseFrontmatter(text);
  if (parsed.kind === 'undecidable') {
    undecidable.push({ at: relFile + ':' + parsed.line, reason: parsed.reason });
    return { findings, undecidable, name: null, descriptionChars: null };
  }
  if (parsed.kind === 'error') {
    findings.push({ at: relFile + ':' + parsed.line, code: parsed.code, detail: parsed.reason });
    return { findings, undecidable, name: null, descriptionChars: null };
  }
  const fields = parsed.fields;
  const at = (f) => relFile + ':' + (f ? f.line : 1);

  const nameField = fields.name;
  const name = nameField ? String(nameField.value).trim() : '';
  if (!name) {
    findings.push({ at: at(nameField), code: 'MISSING_NAME', detail: 'no name in the frontmatter; the loader has nothing to register the skill under' });
  } else if (!NAME_RE.test(name)) {
    findings.push({ at: at(nameField), code: 'BAD_NAME', detail: 'name "' + clip(name, 40) + '" is not kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$)' });
  } else if (name !== dirName) {
    findings.push({ at: at(nameField), code: 'NAME_MISMATCH', detail: 'name "' + name + '" is not the directory it lives in ("' + dirName + '"); the two are read as different skills' });
  }

  const descField = fields.description;
  const description = descField ? String(descField.value).trim() : '';
  let descriptionChars = null;
  if (!description) {
    findings.push({ at: at(descField), code: 'MISSING_DESCRIPTION', detail: 'no description in the frontmatter; nothing tells the model when this skill applies' });
  } else {
    // Code points, not bytes: the budget is written in characters.
    descriptionChars = Array.from(description).length;
    if (descriptionChars > DESCRIPTION_BUDGET) {
      findings.push({ at: at(descField), code: 'LONG_DESCRIPTION', detail: 'description is ' + descriptionChars + ' characters, over the budget of ' + DESCRIPTION_BUDGET });
    }
    if (!isTriggerShaped(description)) {
      const hits = SUMMARY_TOKENS.filter((t) => description.includes(t));
      findings.push({
        at: at(descField), code: 'DESCRIPTION_NOT_TRIGGER_SHAPED',
        detail: 'description 没写触发条件（须含「当…时」或「由…调用」），模型无从判断何时该用这个 skill'
          + (hits.length ? '；且通篇是流程总结词：' + hits.join('、') : ''),
      });
    }
  }

  for (const key of BOOLEAN_KEYS) {
    const f = fields[key];
    if (!f) continue;
    const v = String(f.value);
    if (f.quoted || (v !== 'true' && v !== 'false')) {
      findings.push({
        at: at(f), code: 'STRING_BOOLEAN',
        detail: key + ' is ' + (f.quoted ? 'a quoted string' : 'not a bare true/false') + ' (' + clip(String(f.raw), 30) + '); a non-empty string is truthy, so the flag reads as set whatever it says',
      });
    }
  }

  return { findings, undecidable, name: name || null, descriptionChars };
}

/** The error text worth reporting: the code when there is one, the message otherwise. */
function errText(e) {
  return String((e && e.code) || (e && e.message) || e);
}

/**
 * Walk .claude/skills and lint every SKILL.md under it. Reads the filesystem; the root is a
 * parameter so a fixture tree can be scanned without moving the process.
 */
function scanSkills(root = projectRoot()) {
  const rel = toPosixPath(SKILLS_DIR);
  const abs = path.join(root, SKILLS_DIR);
  const out = { dir: rel, present: false, listed: 0, inScope: 0, skills: [], findings: [], undecidable: [], unreadable: [] };
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (e) {
    // No directory is a normal state -- this framework installs into projects that carry no
    // skills of their own. A directory that is there and cannot be listed is the other
    // answer entirely: the scan did not happen, and saying nothing was wrong would be a
    // claim about files nobody opened.
    if (e && e.code === 'ENOENT') return out;
    out.present = true;
    out.unreadable.push({ at: rel, reason: 'the skills directory could not be listed: ' + errText(e) });
    return out;
  }
  out.present = true;
  const names = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort();
  for (const dirName of names) {
    out.listed++;
    const relFile = rel + '/' + dirName + '/' + SKILL_FILE;
    let text;
    try {
      text = fs.readFileSync(path.join(abs, dirName, SKILL_FILE), 'utf8');
    } catch (e) {
      // A directory holding no SKILL.md holds no skill: it is listed and out of scope, not
      // a defect this command was asked to name.
      if (e && e.code === 'ENOENT') continue;
      out.unreadable.push({ at: relFile, reason: 'the file could not be read: ' + errText(e) });
      continue;
    }
    out.inScope++;
    const r = lintSkillFile(dirName, relFile, text);
    for (const f of r.findings) out.findings.push(f);
    for (const u of r.undecidable) out.undecidable.push(u);
    out.skills.push({ dir: dirName, file: relFile, name: r.name, descriptionChars: r.descriptionChars });
  }

  // A duplicate name is invisible in any single file: both are well-formed, and only one of
  // them ends up being the skill that answers.
  const byName = new Map();
  for (const s of out.skills) {
    if (!s.name) continue;
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
  }
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const dirs = group.map(s => s.dir).join(', ');
    for (const s of group) {
      out.findings.push({ at: s.file + ':1', code: 'DUPLICATE_NAME', detail: 'name "' + name + '" is claimed by ' + group.length + ' skills (' + dirs + '); only one of them can be the skill that answers' });
    }
  }
  return out;
}

/** The single sentence that says what this run established. Pure. */
function skillsNote(r) {
  if (!r.present) return 'no skills directory (' + r.dir + '); a checkout without skills is a normal state, not a failure';
  if (r.unreadable.length > 0) return 'part of the scope could not be read; not checked is not the same as clean';
  if (r.inScope === 0) return 'nothing-in-scope:listed=' + r.listed + ' in-scope=0 (no ' + SKILL_FILE + ' under ' + r.dir + ')';
  if (r.findings.length > 0) return 'a skill whose frontmatter reads like this is dropped in silence by the loader; as written it is not being loaded';
  if (r.undecidable.length > 0) return 'a frontmatter shape outside the decidable subset was not ruled on; declining to rule is not the same as passing';
  return 'every ' + SKILL_FILE + ' frontmatter parses, names itself after its directory and stays inside the description budget';
}

function cmdSkillsLint(flags = {}) {
  const r = scanSkills(projectRoot());
  const limit = positiveInt(flags.limit, DEFAULT_LIMIT);
  for (const f of r.findings.slice(0, limit)) {
    process.stderr.write('SKILL ' + f.at + '  ' + f.code + '  ' + f.detail + '\n');
  }
  for (const u of r.undecidable) {
    process.stderr.write('UNDECIDABLE ' + u.at + '  ' + u.reason + '\n');
  }
  for (const u of r.unreadable) {
    process.stderr.write('UNREADABLE ' + u.at + '  ' + u.reason + '\n');
  }
  const degraded = r.undecidable.length + r.unreadable.length > 0;
  process.stderr.write('skills listed ' + r.listed + '  in-scope ' + r.inScope
    + '  findings ' + r.findings.length
    + '  undecidable ' + r.undecidable.length
    + '  unreadable ' + r.unreadable.length + '\n');
  // A finding outranks a degradation: it is the more actionable answer, and it is the one
  // a caller can block on. Nothing in scope is neither -- a tree with no skills in it is
  // not a tree whose skills are broken.
  const code = r.findings.length > 0 ? 1 : (degraded ? 3 : 0);
  return emit({
    ok: r.findings.length === 0 && !degraded,
    dir: r.dir,
    skillsDirPresent: r.present,
    listed: r.listed,
    inScope: r.inScope,
    degraded,
    skills: r.skills.slice(0, limit),
    skillsOmitted: Math.max(0, r.skills.length - limit),
    findings: r.findings.slice(0, limit),
    findingsOmitted: Math.max(0, r.findings.length - limit),
    undecidable: r.undecidable,
    unreadable: r.unreadable,
    descriptionBudget: DESCRIPTION_BUDGET,
    note: skillsNote(r),
  }, code);
}

// ===========================================================================
// S24 claude-md-lint: the directory constitution a high-risk module has to carry
// ===========================================================================
//
// Claude Code loads a CLAUDE.md that sits in a subdirectory on demand: open a file under
// that directory and its rules arrive with it. That makes the nested file the one place a
// module's boundaries can be stated where the work happens, without being paid for out of
// the root constitution's budget by every other module. The corollary is what this command
// names: a high-risk module with no such file has its boundaries stated nowhere near the
// edit, and "the agent will remember what this module may not do" is precisely the kind of
// self-discipline this framework exists to turn into a check.
//
// Scope is narrow on purpose. Only the modules the catalog itself calls high (or critical)
// are asked for one -- a rule that demanded a constitution per module would be paid for by
// every low-risk directory in the tree and switched off inside a week. The four sections are
// the four a boundary statement needs to be actionable: what this module is for, what it may
// not reach, what may never be traded away, and how a change to it gets proved. Headings may
// be written in English or in Chinese, because both are in use here and a lint that accepted
// only one would be asking for the wrong repair.
//
// Two judgements are deliberately strict. A heading with nothing under it counts as absent:
// a shell with no body reads as covered while stating nothing, which is the failure this
// repository names everywhere else. And a heading credits one section, the first it matches:
// "Boundaries and Verification" over a paragraph about boundaries would otherwise let one
// body answer for two sections, and a false green here is worse than the split heading the
// finding asks for.

const CLAUDE_MD_FILE = 'CLAUDE.md';

// The tiers this command is asked about. `riskTier` is documented low|medium|high and
// catalog-lint validates no tier vocabulary at all, so a catalog reaching for `critical`
// gets read as at least as risky as high rather than silently dropped out of scope.
const SCOPED_RISK_TIERS = ['high', 'critical'];

// The required sections, each with the English keyword and the Chinese one. The Chinese is
// escaped to keep this file ASCII, with its reading beside it.
const CLAUDE_MD_SECTIONS = [
  { id: 'purpose', label: 'Purpose', en: 'purpose', zh: '\u76ee\u7684' },              // mu-di
  { id: 'boundaries', label: 'Boundaries', en: 'boundaries', zh: '\u8fb9\u754c' },      // bian-jie
  { id: 'invariants', label: 'Invariants', en: 'invariants', zh: '\u4e0d\u53d8\u91cf' }, // bu-bian-liang
  { id: 'verification', label: 'Verification', en: 'verification', zh: '\u9a8c\u8bc1' }, // yan-zheng
];

const GLOB_CHARS = /[*?[\]{}]/;

/**
 * The literal directory segments a glob commits to, before its first wildcard. A pattern
 * with no wildcard at all names a file, so its last segment is dropped -- `db/schema.ts`
 * commits to `db`, not to a directory called schema.ts. Pure.
 * @returns {string[]}
 */
function literalDirSegments(glob) {
  let raw = String(glob === undefined || glob === null ? '' : glob).trim();
  if (raw.startsWith('./')) raw = raw.slice(2);
  const trailingSlash = raw.endsWith('/');
  raw = raw.replace(/\/+$/, '');
  if (raw === '') return [];
  const out = [];
  let sawWildcard = false;
  for (const seg of raw.split('/')) {
    if (GLOB_CHARS.test(seg)) { sawWildcard = true; break; }
    out.push(seg);
  }
  if (!sawWildcard && !trailingSlash && out.length > 0) out.pop();
  return out;
}

/**
 * The directory a module's globs agree on: the longest run of literal segments common to
 * all of them. A module spread over two roots, or one whose globs commit to nothing above
 * the repository root, has no directory to ask for a CLAUDE.md -- and answering anyway
 * would mean either asking for one at the root or quietly dropping the module. Pure.
 * @returns {{kind:'ok',dir:string}|{kind:'undecidable',reason:string}}
 */
function moduleRoot(paths) {
  const globs = Array.isArray(paths) ? paths : [];
  if (globs.length === 0) {
    return { kind: 'undecidable', reason: 'the module declares no paths, so it has no directory to carry a ' + CLAUDE_MD_FILE };
  }
  let common = null;
  for (const g of globs) {
    const segs = literalDirSegments(g);
    if (common === null) { common = segs; continue; }
    const next = [];
    for (let i = 0; i < Math.min(common.length, segs.length); i++) {
      if (common[i] !== segs[i]) break;
      next.push(common[i]);
    }
    common = next;
  }
  if (!common || common.length === 0) {
    return {
      kind: 'undecidable',
      reason: 'its path globs (' + globs.map(g => String(g)).join(', ')
        + ') share no directory above the repository root, so the module has no one directory to carry a ' + CLAUDE_MD_FILE,
    };
  }
  return { kind: 'ok', dir: common.join('/') };
}

/** Does this heading name that section, in either language? Pure. */
function sectionMatch(headingText, section) {
  const t = String(headingText);
  return t.toLowerCase().indexOf(section.en) >= 0 || t.indexOf(section.zh) >= 0;
}

/**
 * Which of the four sections a document states, and which are a heading with nothing under
 * it. Fenced code is not scanned for headings -- a `# Purpose` inside a shell block is an
 * example, the same reading auditDoc takes. A section runs to the next heading at its own
 * level or above, so one written as subsections still has a body; what makes it empty is
 * holding no line that is not itself a heading.
 * Pure.
 * @returns {Object<string,{found:boolean,nonEmpty:boolean,line:(number|null)}>}
 */
function documentSections(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const kinds = [];
  const heads = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; kinds.push('content'); continue; }
    if (fenced) { kinds.push(/^\s*$/.test(line) ? 'blank' : 'content'); continue; }
    const m = /^(#{1,4})\s+(\S.*)$/.exec(line);
    if (m) { kinds.push('heading'); heads.push({ level: m[1].length, text: m[2].trim(), index: i }); continue; }
    kinds.push(/^\s*$/.test(line) ? 'blank' : 'content');
  }
  const state = {};
  for (const s of CLAUDE_MD_SECTIONS) state[s.id] = { found: false, nonEmpty: false, line: null };
  for (let h = 0; h < heads.length; h++) {
    const head = heads[h];
    const hit = CLAUDE_MD_SECTIONS.find(s => sectionMatch(head.text, s));
    if (!hit) continue;
    let end = lines.length;
    for (let k = h + 1; k < heads.length; k++) {
      if (heads[k].level <= head.level) { end = heads[k].index; break; }
    }
    let body = false;
    for (let i = head.index + 1; i < end; i++) {
      if (kinds[i] === 'content') { body = true; break; }
    }
    const cur = state[hit.id];
    if (!cur.found) { cur.found = true; cur.line = head.index + 1; }
    if (body) cur.nonEmpty = true;
  }
  return state;
}

/**
 * Lint one module's CLAUDE.md. The module id travels with every finding: the file path
 * alone answers "which document", and the question this command is asked is "which module
 * has no boundaries stated".
 * Pure.
 */
function lintModuleDoc(moduleId, relFile, text) {
  const state = documentSections(text);
  const findings = [];
  const sections = {};
  for (const s of CLAUDE_MD_SECTIONS) {
    const cur = state[s.id];
    if (!cur.found) {
      sections[s.id] = 'absent';
      findings.push({
        at: relFile + ':1', code: 'MISSING_SECTION', module: moduleId, section: s.id,
        detail: 'module "' + moduleId + '" states no ' + s.label + ' section in ' + relFile
          + '; a heading (#..####) containing "' + s.label + '" or "' + s.zh + '" is what this looks for',
      });
    } else if (!cur.nonEmpty) {
      sections[s.id] = 'empty';
      findings.push({
        at: relFile + ':' + cur.line, code: 'EMPTY_SECTION', module: moduleId, section: s.id,
        detail: 'module "' + moduleId + '" opens a ' + s.label + ' heading in ' + relFile
          + ' and puts nothing under it; a section with no body reads as covered while stating nothing',
      });
    } else {
      sections[s.id] = 'stated';
    }
  }
  return { findings, sections };
}

/**
 * Walk the catalog's high-risk modules and lint the CLAUDE.md each one's directory should
 * carry. Reads the filesystem; the root is a parameter so a fixture tree can be scanned
 * without moving the process.
 */
function scanModuleDocs(root, catalog) {
  const modules = Array.isArray(catalog && catalog.modules) ? catalog.modules : [];
  const out = { listed: modules.length, inScope: 0, modules: [], findings: [], undecidable: [], unreadable: [] };
  for (const m of modules) {
    const id = String((m && m.id) || '');
    const tier = String((m && m.riskTier) || '').toLowerCase();
    if (!SCOPED_RISK_TIERS.includes(tier)) continue;
    out.inScope++;
    const rootRes = moduleRoot(m && m.paths);
    if (rootRes.kind !== 'ok') {
      out.undecidable.push({ at: 'module:' + id, reason: 'module "' + id + '": ' + rootRes.reason });
      out.modules.push({ id, riskTier: tier, dir: null, file: null, present: false, sections: null });
      continue;
    }
    const dir = rootRes.dir;
    const relFile = dir + '/' + CLAUDE_MD_FILE;
    let text;
    try {
      text = fs.readFileSync(path.join(root, dir, CLAUDE_MD_FILE), 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        // Which half is missing changes the repair, so it is said rather than left to be
        // guessed: a directory that is not there yet is a catalog written ahead of the code.
        const dirThere = fs.existsSync(path.join(root, dir));
        out.findings.push({
          at: relFile + ':1', code: 'MISSING_CLAUDE_MD', module: id, section: null,
          detail: 'module "' + id + '" is riskTier ' + tier + ' and carries no ' + CLAUDE_MD_FILE + ' at ' + relFile
            + (dirThere ? '' : ' (the directory itself is not on disk)')
            + '; nothing states its boundaries where an edit inside it happens',
        });
        out.modules.push({ id, riskTier: tier, dir, file: relFile, present: false, sections: null });
        continue;
      }
      out.unreadable.push({ at: relFile, reason: 'module "' + id + '": the file could not be read: ' + errText(e) });
      out.modules.push({ id, riskTier: tier, dir, file: relFile, present: true, sections: null });
      continue;
    }
    const r = lintModuleDoc(id, relFile, text);
    for (const f of r.findings) out.findings.push(f);
    out.modules.push({ id, riskTier: tier, dir, file: relFile, present: true, sections: r.sections });
  }
  return out;
}

/** The single sentence that says what this run established. Pure. */
function claudeMdNote(r) {
  if (r.unreadable.length > 0) return 'part of the scope could not be read; not checked is not the same as clean';
  if (r.inScope === 0) {
    return 'nothing-in-scope:listed=' + r.listed + ' in-scope=0 (no module declares riskTier '
      + SCOPED_RISK_TIERS.join(' or ') + '), so no directory constitution is owed';
  }
  if (r.findings.length > 0) {
    return 'a high-risk module whose directory states no boundaries is one every agent has to remember the rules of; that memory is what the nested ' + CLAUDE_MD_FILE + ' replaces';
  }
  if (r.undecidable.length > 0) return 'a module root could not be derived from its path globs; declining to rule is not the same as passing';
  return 'every high-risk module carries a ' + CLAUDE_MD_FILE + ' stating its purpose, boundaries, invariants and verification';
}

function cmdClaudeMdLint(flags = {}) {
  const loaded = loadCatalogFlag(flags);
  if (!loaded.ok) {
    const note = 'no module catalog to read (' + loaded.error + '); nothing declares which modules are high risk, '
      + 'and a scan that never ran is not a clean one';
    process.stderr.write(note + '\n');
    return emit({ ok: false, degraded: true, error: loaded.error, detail: loaded.detail, note }, 3);
  }
  if (!isGitRepo()) {
    // The same boundary every catalog-scoped command takes: the catalog describes a tracked
    // tree, and a directory found outside one is not evidence that it is the module's.
    const note = 'non-git: the catalog describes a tracked tree and this is not one, so which directories it names cannot be established';
    process.stderr.write(note + '\n');
    return emit({ ok: false, degraded: true, error: 'non-git', detail: note, note }, 3);
  }
  const r = scanModuleDocs(projectRoot(), loaded.catalog);
  const limit = positiveInt(flags.limit, DEFAULT_LIMIT);
  for (const f of r.findings.slice(0, limit)) {
    process.stderr.write('MODULE ' + f.at + '  ' + f.code + '  ' + f.detail + '\n');
  }
  for (const u of r.undecidable) {
    process.stderr.write('UNDECIDABLE ' + u.at + '  ' + u.reason + '\n');
  }
  for (const u of r.unreadable) {
    process.stderr.write('UNREADABLE ' + u.at + '  ' + u.reason + '\n');
  }
  const degraded = r.undecidable.length + r.unreadable.length > 0;
  process.stderr.write('modules listed ' + r.listed + '  high-risk ' + r.inScope
    + '  findings ' + r.findings.length
    + '  undecidable ' + r.undecidable.length
    + '  unreadable ' + r.unreadable.length + '\n');
  // A finding outranks a degradation, the same order skills-lint takes: it is the more
  // actionable answer and the one a caller can block on. Nothing in scope is neither -- a
  // catalog with no high-risk module is not a catalog whose modules are undocumented.
  const code = r.findings.length > 0 ? 1 : (degraded ? 3 : 0);
  return emit({
    ok: r.findings.length === 0 && !degraded,
    file: CLAUDE_MD_FILE,
    listed: r.listed,
    inScope: r.inScope,
    degraded,
    modules: r.modules.slice(0, limit),
    modulesOmitted: Math.max(0, r.modules.length - limit),
    findings: r.findings.slice(0, limit),
    findingsOmitted: Math.max(0, r.findings.length - limit),
    undecidable: r.undecidable,
    unreadable: r.unreadable,
    riskTiers: SCOPED_RISK_TIERS,
    requiredSections: CLAUDE_MD_SECTIONS.map(s => s.label),
    note: claudeMdNote(r),
  }, code);
}

export {
  RULES_DOC, RULES_DIR, POINT_DIRS, POINT_EXTS, PROMPT_MARKERS, RUNNERS, TEXT_BUDGET,
  ruleLineText, backtickTokens, leadingBoldToken, admitsPromptOnly, collectPoints, normalizeWord, looksExecutable,
  classifyToken, classifyRuleLine, ruleDocs, clip, auditDoc, tally, positiveInt, cmdRulesAudit,
  SKILLS_DIR, SKILL_FILE, DESCRIPTION_BUDGET, BOOLEAN_KEYS,
  scalarValue, parseFrontmatter, lintSkillFile, scanSkills, skillsNote, cmdSkillsLint,
  CLAUDE_MD_FILE, CLAUDE_MD_SECTIONS, SCOPED_RISK_TIERS,
  literalDirSegments, moduleRoot, sectionMatch, documentSections, lintModuleDoc,
  scanModuleDocs, claudeMdNote, cmdClaudeMdLint,
};
