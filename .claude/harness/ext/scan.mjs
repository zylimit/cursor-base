// ext/scan.mjs -- the three capabilities that read source and documents rather than the
// module graph: S13 fitness (built-in pattern rules), S14 adapters (the external tool
// table) and S15 adr-check (every active decision must name a real enforcement).
// adr-check sits here because it resolves enforcement references against fitness rule ids.
// Depends on core.mjs + catalog.mjs.

import fs from 'node:fs';
import path from 'node:path';
import {
  HARNESS_DIR, SOURCE_EXTS, TIER_RANK,
  catalogFilePath, changedPaths, emit, isDenied, isGitRepo, isStateExcluded, matchAny,
  normalizeTier, parseCsv, projectRoot, repoRelative, toPosixPath, whichCmd,
} from '../lib/core.mjs';
import { loadCatalog, loadCatalogFlag, moduleForPath, trackedFiles } from './catalog.mjs';

// ===========================================================================
// S13 fitness  (built-in day-one quality-attribute rules; no external tools)
// ===========================================================================
// Pattern rules that need no toolchain, so they work immediately in any language:
// credential literals, personal data in logs, silent failure handlers, unbounded retry
// loops, unreferenced deferral markers. Heuristics over text -- they reduce the set of
// defects nobody looked for; they do not establish that a property holds. Suppress one
// finding with `harness-fitness:ignore` on the line or the line above.

const FITNESS_IGNORE = 'harness-fitness:ignore';

const DEFAULT_FITNESS_RULES = [
  {
    id: 'no-secret-literal', attributes: ['security'], severity: 'error',
    forbid: '(?:api[_-]?key|secret|password|passwd|token|private[_-]?key|credential)\\s*[:=]\\s*["\'][A-Za-z0-9/+_\\-]{16,}["\']'
      + '|["\'](?:sk|pk|rk)[_-]live[_-][A-Za-z0-9]{12,}["\']'
      + '|["\']gh[pousr]_[A-Za-z0-9]{16,}["\']'
      + '|["\']xox[abposr]-[A-Za-z0-9-]{10,}["\']'
      + '|["\']AKIA[0-9A-Z]{16}["\']'
      + '|-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----',
    rationale: 'a credential written into source is published the moment the repository is shared',
    fix: 'read the value from the environment or a secrets manager; keep only a placeholder in code',
  },
  {
    id: 'no-pii-in-logs', attributes: ['privacy'], severity: 'error',
    forbid: '(?:log|logger|console|print|println|fmt\\.Print\\w*)[.\\w]*\\s*\\([^)\\n]*\\b(?:email|e_mail|ssn|social_security|passport|credit_card|card_number|phone_number|date_of_birth|dob|national_id|id_card)\\b',
    rationale: 'personal data in logs spreads to systems with weaker access control and longer retention',
    fix: 'log a stable pseudonymous identifier instead of the personal field',
  },
  {
    id: 'no-silent-failure', attributes: ['reliability'], severity: 'error',
    forbid: 'catch\\s*(?:\\([^)]*\\))?\\s*\\{\\s*\\}|except[^:\\n]*:\\s*(?:pass|\\.\\.\\.)\\s*$',
    rationale: 'an empty handler converts a failure into a wrong answer that nothing reports',
    fix: 'handle the error, rethrow it, or log it with enough context to diagnose',
  },
  {
    id: 'no-unbounded-retry', attributes: ['resilience'], severity: 'warning',
    forbid: '(?:while\\s*\\(\\s*true\\s*\\)|while\\s+True\\s*:|for\\s*\\(\\s*;\\s*;\\s*\\))[\\s\\S]{0,240}?\\b(?:retry|reconnect|fetch|request|poll)\\b',
    rationale: 'a retry loop with no bound or backoff turns a transient fault into a sustained outage',
    fix: 'add a maximum attempt count and exponential backoff with jitter',
  },
  {
    id: 'no-unreferenced-deferral', attributes: ['safety'], severity: 'warning', minimumTier: 'high',
    forbid: '\\b(?:TODO|FIXME|XXX|HACK)\\b(?![^\\n]*\\b(?:issue|ticket|#\\d+)\\b)',
    rationale: 'an unreferenced marker in a high-tier module is work nobody has agreed to do',
    fix: 'link the marker to a tracked issue, or resolve it',
  },
];

/**
 * Built-in rules, optionally extended/replaced by a rules file. With no path handed in the
 * file is .claude/harness/fitness-rules.json, and its absence -- or a body that will not
 * parse -- leaves the built-in set standing, because nobody asked for those rules. A path
 * handed in is the opposite case: a gate was pointed at that rule set, so a file that is not
 * there, does not parse, or yields no rule at all, is named and nothing is scanned. Swapping in the built-ins there
 * would let a gate report green over rules it never read, which is the shape of failure this
 * capability exists to catch.
 * @param {string} [rulesFile] --rules-file value; a relative path resolves against the project root
 * @throws {Error} carrying .fitnessRules {error,detail} when a named file is missing or unusable
 */
function loadFitnessRules(rulesFile) {
  const given = rulesFile !== undefined && rulesFile !== null && rulesFile !== false;
  const refuse = (code, detail, note) => {
    const err = new Error(note);
    err.fitnessRules = { error: code, detail };
    return err;
  };
  if (given && (typeof rulesFile !== 'string' || rulesFile.trim() === '')) {
    throw refuse('rules-file-empty', String(rulesFile),
      '--rules-file was given without a path; nothing was scanned');
  }
  const fp = given
    ? (path.isAbsolute(rulesFile) ? rulesFile : path.join(projectRoot(), rulesFile))
    : path.join(projectRoot(), '.claude', 'harness', 'fitness-rules.json');
  if (!fs.existsSync(fp)) {
    if (given) throw refuse('rules-file-missing', fp, 'no fitness rules file at ' + fp + '; nothing was scanned');
    return DEFAULT_FITNESS_RULES;
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) {
    if (given) throw refuse('rules-file-unreadable', fp, 'fitness rules file at ' + fp + ' does not parse (' + e.message + '); nothing was scanned');
    return DEFAULT_FITNESS_RULES;
  }
  if (!raw || !Array.isArray(raw.rules)) {
    if (given) throw refuse('rules-file-malformed', fp, 'fitness rules file at ' + fp + ' carries no rules array; nothing was scanned');
    return DEFAULT_FITNESS_RULES;
  }
  const extra = raw.rules.filter(r => r && typeof r.id === 'string' && typeof r.forbid === 'string');
  if (given && extra.length === 0) {
    throw refuse('rules-file-empty-rules', fp, 'fitness rules file at ' + fp + ' parses to 0 rules; nothing it names was scanned');
  }
  return raw.replace === true ? extra : [...DEFAULT_FITNESS_RULES, ...extra];
}

/** True when the owner module declared one of the rule's attributes at >= rule.minimumTier. */
function meetsMinimumTier(module, rule) {
  if (!module) return false;
  const floor = TIER_RANK[rule.minimumTier] || 0;
  const declared = module.attributes || {};
  return (rule.attributes || []).some(attr => {
    const req = declared[attr];
    if (req === undefined) return false;
    return (TIER_RANK[normalizeTier(req).tier] || 0) >= floor;
  });
}

/** True when the owner module set every one of the rule's attributes to none. */
function ruleOptedOut(module, rule) {
  if (!module || !(rule.attributes || []).length) return false;
  const declared = module.attributes || {};
  return rule.attributes.every(attr => {
    const req = declared[attr];
    if (req === undefined) return false;
    return normalizeTier(req).tier === 'none';
  });
}

/**
 * Scan file contents against fitness rules (pure over provided contents; injectable for
 * selftest). Suppression marker on the finding line or the line above kills one finding.
 * @param {Array<{path:string,content:string}>} files
 * @param {Catalog|null} catalog     module scoping (minimumTier/opt-out); null = no scoping
 * @param {Array} rules
 * @returns {Array} findings
 */
function scanFitness(files, catalog, rules) {
  const findings = [];
  for (const f of files) {
    const owner = catalog ? (() => {
      const id = moduleForPath(f.path, catalog);
      return id ? (catalog.modules || []).find(m => m.id === id) : null;
    })() : null;
    const lines = f.content.split('\n');
    for (const rule of rules) {
      if (rule.appliesTo && rule.appliesTo.length && !matchAny(f.path, rule.appliesTo)) continue;
      if (owner && ruleOptedOut(owner, rule)) continue;
      if (rule.minimumTier && !meetsMinimumTier(owner, rule)) continue;
      let pattern;
      try { pattern = new RegExp(rule.forbid, 'gmi'); } catch (_e) { continue; }
      let m = pattern.exec(f.content);
      while (m) {
        const line = f.content.slice(0, m.index).split('\n').length;
        const suppressed = (lines[line - 1] || '').includes(FITNESS_IGNORE) || (lines[line - 2] || '').includes(FITNESS_IGNORE);
        if (!suppressed) {
          findings.push({
            rule: rule.id, attributes: rule.attributes || [], severity: rule.severity || 'warning',
            module: owner ? owner.id : null, path: f.path, line,
            excerpt: String(lines[line - 1] || '').trim().slice(0, 200),
            rationale: rule.rationale || '', fix: rule.fix || '',
          });
        }
        if (m.index === pattern.lastIndex) pattern.lastIndex++;
        m = pattern.exec(f.content);
      }
    }
  }
  return findings;
}

function cmdFitness(flags) {
  const loaded = loadCatalogFlag(flags);
  const catalog = loaded.ok ? loaded.catalog : null;
  let rules;
  try { rules = loadFitnessRules(flags['rules-file']); } catch (e) {
    if (!e || !e.fitnessRules) throw e;
    return emit({ ok: false, degraded: true, error: e.fitnessRules.error, detail: e.fitnessRules.detail, note: e.message }, 3);
  }
  const root = projectRoot();
  let subjects;
  if (typeof flags.paths === 'string') {
    subjects = parseCsv(flags.paths);
  } else if (flags.all === true) {
    if (!isGitRepo()) return emit({ ok: false, degraded: true, error: 'non-git', detail: 'fitness --all enumerates tracked files via git' }, 3);
    subjects = trackedFiles(catalog && catalog.maxTrackedPaths).paths;
  } else {
    const cp = changedPaths();
    subjects = Array.isArray(cp) ? cp : cp.paths;
  }
  const files = [];
  for (const p of subjects) {
    const ext = p.slice(p.lastIndexOf('.'));
    if (!SOURCE_EXTS.has(ext)) continue;
    if (isDenied(p) || isStateExcluded(p)) continue;
    let content;
    try {
      const st = fs.statSync(path.join(root, p));
      if (!st.isFile() || st.size > 1000000) continue;
      const buf = fs.readFileSync(path.join(root, p));
      if (buf.includes(0)) continue;   // binary
      content = buf.toString('utf8');
    } catch (_e) { continue; }
    files.push({ path: toPosixPath(p), content });
  }
  const findings = scanFitness(files, catalog, rules);
  const errors = findings.filter(f => f.severity === 'error');
  return emit({
    ok: errors.length === 0,
    scope: flags.all === true ? 'all-tracked' : (typeof flags.paths === 'string' ? 'explicit' : 'changed'),
    scannedFiles: files.length, rules: rules.length,
    counts: {
      error: errors.length,
      warning: findings.filter(f => f.severity === 'warning').length,
      info: findings.filter(f => f.severity === 'info').length,
    },
    findings: findings.slice(0, 200),
  }, errors.length === 0 ? 0 : 1);
}

// ===========================================================================
// S14 adapters  (curated external tools mapped to attributes; nothing bundled)
// ===========================================================================
// The harness installs nothing. `adapters list` shows curated command templates with the
// attributes they evidence and whether the executable is on PATH; `adapters add <id>`
// wires the check into catalog.checks. Wiring is only half the job: nothing selects the
// check until a module lists it in `verification` (or a riskChecks tier includes it).

function adaptersFilePath() {
  const local = path.join(projectRoot(), '.claude', 'harness', 'adapters.json');
  if (fs.existsSync(local)) return local;
  return path.join(HARNESS_DIR, 'adapters.json');
}

function loadAdapters() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(adaptersFilePath(), 'utf8')); } catch (_e) { return []; }
  return (raw && Array.isArray(raw.adapters)) ? raw.adapters : [];
}

function cmdAdapters(flags, positional = []) {
  const sub = positional[0] || 'list';
  const catalogue = loadAdapters();
  if (sub === 'list') {
    const want = typeof flags.attribute === 'string' ? flags.attribute : null;
    const loaded = loadCatalogFlag(flags);
    const wiredIds = loaded.ok ? Object.keys(loaded.catalog.checks || {}) : [];
    const list = catalogue
      .filter(a => !want || (a.attributes || []).includes(want))
      .map(a => ({
        id: a.id, attributes: a.attributes || [], class: a.class, executable: a.executable,
        available: whichCmd(a.executable), wired: wiredIds.includes(a.id),
        install: a.install, rationale: a.rationale,
      }));
    return emit({ ok: true, adapters: list }, 0);
  }
  if (sub === 'add') {
    const id = positional[1] || (typeof flags.id === 'string' ? flags.id : '');
    const adapter = catalogue.find(a => a.id === id);
    if (!adapter) return emit({ ok: false, error: 'adapter-unknown', detail: id || null }, 1);
    const cp = typeof flags.catalog === 'string' ? flags.catalog : catalogFilePath();
    const loaded = loadCatalog(cp);
    if (!loaded.ok) return emit({ ok: false, degraded: true, error: loaded.error, detail: loaded.detail }, 3);
    const catalog = loaded.catalog;
    catalog.checks = catalog.checks || {};
    const already = !!catalog.checks[adapter.id];
    catalog.checks[adapter.id] = {
      command: adapter.command, class: adapter.class,
      ...(Array.isArray(adapter.attributes) ? { attributes: adapter.attributes } : {}),
    };
    if (flags['dry-run'] !== true && flags.dryRun !== true) {
      fs.writeFileSync(cp, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
    }
    return emit({
      ok: true, id: adapter.id, changed: !already, dryRun: flags['dry-run'] === true || flags.dryRun === true,
      executableAvailable: whichCmd(adapter.executable), install: adapter.install,
      nextStep: 'add "' + adapter.id + '" to the verification list of every module that needs ' + (adapter.attributes || []).join('/') + ' evidence',
    }, 0);
  }
  return emit({ error: 'adapters-subcommand', detail: 'usage: adapters list|add <id>', got: sub || null }, 3);
}

// ===========================================================================
// S15 adr-check  (an architecture decision nothing checks is one the codebase drifts from)
// ===========================================================================
// Every active ADR must name how it is enforced. A phantom reference (naming a check or
// rule that does not exist) is worse than none, because it reads as enforced. Explicitly
// manual enforcement is accepted but reported separately -- an honest "a human guards
// this" beats a fake machine claim. Retired ADRs (superseded/deprecated/rejected) are
// exempt: they no longer bind anyone.
//
// Sources scanned: inline `### ADR-xxx` blocks in Architecture-Design.md (arch-designer
// format) and standalone docs/adr/*.md files (one record per file). Both optional.

// Two more fields are required for the same reason enforcement is. `revisit-if` names the
// condition that ends the decision -- a premise that quietly expired is still being built on
// until someone writes down what would falsify it. `reversal` names what undoing it costs;
// a decision nobody can undo gets waved through at the speed of a reversible one unless the
// cost is on the page. Writing "\u5355\u5411\u95e8" instead of steps is accepted, not failed, and listed
// separately -- an honest one-way door is a fact to count, a hidden one is the accident.

const ADR_RETIRED_RE = /superseded|deprecated|rejected|retired|\u5df2\u5e9f\u5f03|\u5e9f\u5f03|\u5df2\u53d6\u4ee3|\u5df2\u5426\u51b3|\u5df2\u66ff\u4ee3/i;
const ADR_ONEWAY_RE = /\u5355\u5411\u95e8|one-?way\s*door/i;
// "in three months" is a calendar reminder, not a condition: it fires whether or not the
// premise moved, and it goes stale the day it is written. Two shapes are flagged, and keeping
// them apart is the whole point. Self-contained phrases ("wait and see", "as appropriate")
// mean the same wherever they sit. A time window does not: the characters for "after a year"
// are also the opening of "backend from 2026 on", so matching the window on its own reds a
// perfectly good condition. The window therefore only counts when it ends the value or is
// followed by a re-evaluation verb; otherwise it is just a sentence those characters pass
// through. Even then, a value naming any real trigger is let through -- a false red on a
// judgement call costs more here than a miss, because the field only works if people trust it.
const ADR_REVISIT_VAGUE_RE = /(\u4ee5\u540e\u518d|\u4e4b\u540e\u518d|\u518d\u770b|\u518d\u8bf4|\u518d\u8bae|\u5230\u65f6\u5019|\u89c6\u60c5\u51b5|\u770b\u60c5\u51b5|\u914c\u60c5|\u6301\u7eed\u5173\u6ce8|\u4fdd\u6301\u5173\u6ce8|\u5b9a\u671f(\u8bc4\u5ba1|\u56de\u987e|\u68c0\u67e5|\u590d\u76d8)|\u5f85\u5b9a|TBD|later|as needed|periodically|keep an eye)/i;
const ADR_REVISIT_STALE_RE = /(\u4e2a\u6708|\u4e2a\u661f\u671f|\u661f\u671f|\u5468|\u5b63\u5ea6|\u5e74|\u5929)(\u4e4b|\u4ee5)?\u540e(\s*$|[\s\uff0c,\u3001;\uff1b]*(\u518d\u770b|\u518d\u8bf4|\u518d\u8bae|\u518d\u5b9a|\u518d\u8bc4\u4f30|\u518d\u8ba8\u8bba|\u518d\u51b3\u5b9a|\u518d\u786e\u8ba4|\u91cd\u65b0\u8bc4\u4f30|\u91cd\u65b0\u8bc4\u5ba1|\u91cd\u65b0\u5ba1\u89c6|\u91cd\u65b0\u8003\u8651|\u91cd\u65b0\u8ba8\u8bba|\u91cd\u4f30|\u56de\u987e|\u590d\u76d8|\u590d\u5ba1|revisit|re-?evaluate|reassess|review))/i;
const ADR_REVISIT_CONDITION_RE = /(\u8d85\u8fc7|\u8d85\u51fa|\u5927\u4e8e|\u5c0f\u4e8e|\u4f4e\u4e8e|\u9ad8\u4e8e|\u8fbe\u5230|\u4e0d\u8db3|\u4e0d\u518d|\u4e00\u65e6|\u5982\u679c|\u82e5|\u5f53|\u9700\u8981|\u8981\u6c42|\u51fa\u73b0|\u65b0\u589e|\u5f15\u5165|\u63a5\u5165|\u5207\u6362|\u6362\u6210|\u505c\u6b62\u7ef4\u62a4|\u505c\u670d|\u4e0b\u7ebf|\u4e0a\u7ebf|\u5931\u8d25|\u53d1\u751f|\u5230\u671f|\u671f\u6ee1|\u8fc7\u671f|>|<|\u2265|\u2264|exceed|more than|over |when |if |need|require|reach|drop|stop|EOL|deprecat)/i;
const ADR_MANUAL_RE = /\u4eba\u5de5|\u8bc4\u5ba1|manual|review/i;
// Harness capabilities that ARE machine enforcement when named directly.
const ADR_HARNESS_CAPS = ['arch-check', 'forbiddendependencies', 'layers', 'catalog-lint', 'fitness', 'verify', 'receipt', 'attributes', 'stop-gate', 'pre-commit', 'supervisor', 'arch-trend'];

/** Strip markdown decoration and template brackets from a field value. */
function stripMdDecoration(s) {
  return String(s == null ? '' : s).replace(/\*\*|`|\[|\]/g, '').trim();
}

/** First `- **字段**：value` / `字段: value` style line for any of the given labels. */
function adrField(block, labels) {
  for (const label of labels) {
    const re = new RegExp('(?:^|\\n)\\s*[-*]?\\s*(?:\\*\\*)?' + label + '(?:\\*\\*)?\\s*[:\\uFF1A]\\s*([^\\n]+)', 'i');
    const m = re.exec(block);
    if (m) return stripMdDecoration(m[1]);
  }
  return '';
}

/**
 * Parse inline `### ADR-xxx` blocks out of a markdown document (pure; injectable).
 * @param {string} content
 * @returns {Array<{id:string,title:string,status:string,enforcedRaw:string}>}
 */
function parseInlineAdrs(content) {
  const text = String(content == null ? '' : content).replace(/\r\n?/g, '\n');
  const out = [];
  const heading = /^###\s*(ADR-[A-Za-z0-9._-]+)\s*[:\uFF1A]?\s*(.*)$/gm;
  const starts = [];
  let m = heading.exec(text);
  while (m) {
    starts.push({ id: m[1], title: stripMdDecoration(m[2]), at: m.index, bodyFrom: m.index + m[0].length });
    m = heading.exec(text);
  }
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].bodyFrom;
    // Block ends at the next heading of ### or shallower (##, #), or EOF.
    const nextHeading = text.slice(from).search(/\n#{1,3}\s/);
    const block = nextHeading === -1 ? text.slice(from) : text.slice(from, from + nextHeading);
    out.push({
      id: starts[i].id,
      title: starts[i].title,
      status: adrField(block, ['\u72b6\u6001', 'Status']) || 'accepted',
      enforcedRaw: adrField(block, ['\u6267\u6cd5\u65b9\u5f0f', 'Enforced-by', 'Enforced by']),
      revisitRaw: adrField(block, ['revisit-if', 'revisit if', '\u5931\u6548\u6761\u4ef6', '\u91cd\u65b0\u8bc4\u4f30\u6761\u4ef6']),
      reversalRaw: adrField(block, ['reversal', '\u64a4\u56de\u4ee3\u4ef7', '\u64a4\u56de\u6210\u672c']),
    });
  }
  return out;
}

/**
 * Resolve one enforcement fragment against known ids (pure).
 * Longest known token wins so "arch-check 禁边" resolves to arch-check, and a catalog
 * check id embedded in prose still counts.
 * @returns {{kind:('check'|'fitness-rule'|'harness'|'manual'|'unknown'),id?:string,text:string}|null}
 */
function resolveEnforcement(fragment, knownChecks, knownRules) {
  const f = stripMdDecoration(fragment);
  if (!f) return null;
  const lower = f.toLowerCase();
  let best = null;
  const consider = (kind, id) => {
    if (!id) return;
    if (lower.includes(String(id).toLowerCase())) {
      if (!best || String(id).length > String(best.id).length) best = { kind, id: String(id), text: f };
    }
  };
  for (const id of (knownChecks || [])) consider('check', id);
  for (const id of (knownRules || [])) consider('fitness-rule', id);
  for (const cap of ADR_HARNESS_CAPS) consider('harness', cap);
  if (best) return best;
  if (ADR_MANUAL_RE.test(f)) return { kind: 'manual', text: f };
  return { kind: 'unknown', text: f };
}

/**
 * Assess ADR records (pure): an active record passes when its enforcement resolves to at
 * least one known machine token or an explicit manual marker; zero recognizable tokens
 * (missing field, or only phantom names) fails. Unrecognized fragments riding along a
 * known one are surfaced, not failed -- prose is allowed, silence about it is not.
 * It must also declare revisit-if and reversal. All problems of one record are reported
 * together in `reason` rather than one per pass, so a single read tells the author
 * everything that record needs.
 * @param {Array<{id,title?,status,enforcedRaw,source?}>} records
 * @param {string[]} knownChecks
 * @param {string[]} knownRules
 */
function assessAdrRecords(records, knownChecks, knownRules) {
  const out = [];
  for (const r of (records || [])) {
    const retired = ADR_RETIRED_RE.test(String(r.status || ''));
    const fragments = String(r.enforcedRaw || '').split(/[,\uFF0C\u3001;\uFF1B/]+/).map(s => s.trim()).filter(Boolean);
    const resolved = fragments.map(f => resolveEnforcement(f, knownChecks, knownRules)).filter(Boolean);
    const machine = resolved.filter(t => t.kind === 'check' || t.kind === 'fitness-rule' || t.kind === 'harness');
    const manual = resolved.filter(t => t.kind === 'manual');
    const unknown = resolved.filter(t => t.kind === 'unknown');
    const recognized = machine.length + manual.length;
    const revisit = stripMdDecoration(r.revisitRaw || '');
    const reversal = stripMdDecoration(r.reversalRaw || '');
    const oneWayDoor = !retired && ADR_ONEWAY_RE.test(reversal);
    const problems = [];
    if (!retired) {
      if (recognized === 0 && fragments.length === 0) problems.push('no enforcement declared (\u6267\u6cd5\u65b9\u5f0f/Enforced-by missing)');
      else if (recognized === 0) problems.push('names nothing recognizable (phantom reference reads as enforced but is not)');
      if (!revisit) problems.push('no expiry condition declared (revisit-if/\u5931\u6548\u6761\u4ef6 missing)');
      else if ((ADR_REVISIT_VAGUE_RE.test(revisit) || ADR_REVISIT_STALE_RE.test(revisit)) && !ADR_REVISIT_CONDITION_RE.test(revisit)) {
        problems.push('revisit-if is a date or a wait-and-see note, not a condition ("' + revisit + '"); name what has to happen instead (\u65e5\u6d3b\u8d85\u8fc7 5 \u4e07 / \u9700\u8981\u591a\u79df\u6237 / \u7b2c\u4e09\u65b9\u505c\u6b62\u7ef4\u62a4)');
      }
      if (!reversal) problems.push('no reversal cost declared (reversal/\u64a4\u56de\u4ee3\u4ef7 missing; write the steps and rough duration, or declare \u5355\u5411\u95e8)');
    }
    const ok = retired || problems.length === 0;
    out.push({
      id: r.id, title: r.title || null, source: r.source || null, status: r.status || 'accepted', retired,
      ok,
      machineEnforced: machine.map(t => ({ kind: t.kind, id: t.id })),
      manualOnly: !retired && machine.length === 0 && manual.length > 0,
      unrecognized: unknown.map(t => t.text),
      oneWayDoor,
      revisit: revisit || null,
      reversal: reversal || null,
      reason: retired ? 'retired; exempt'
        : problems.length > 0 ? problems.join('; ')
        : machine.length > 0 ? 'machine-enforced'
        : 'manual enforcement declared',
    });
  }
  return { records: out, failing: out.filter(r => !r.ok) };
}

/**
 * Standalone ADR files: docs/adr/*.md, one record per file (cursor-style layout).
 * `dir` is normally repo-relative and `root` only locates it on disk, so `source` comes out
 * repo-relative -- the same shape the inline records carry. The alternative reads back
 * one machine's directory layout in a field the inline half already answers relatively,
 * and stdout here is a machine contract.
 * path.resolve, not path.join: `--dir /somewhere/else` is an absolute path the caller means
 * literally, and joining it onto the root reads a directory nobody named (root + /somewhere)
 * while still echoing the one they did -- the report then describes a place it never looked.
 * repoRelative gives such a directory back verbatim, since it has no repo-relative name.
 */
function parseAdrDir(root, dir) {
  const abs = path.resolve(root, dir);
  let names;
  try { names = fs.readdirSync(abs); } catch (_e) { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.md')) continue;
    let content;
    try { content = fs.readFileSync(path.join(abs, n), 'utf8'); } catch (_e) { continue; }
    out.push({
      id: n.replace(/\.md$/, ''),
      source: repoRelative(path.join(abs, n)),
      status: adrField(content, ['\u72b6\u6001', 'Status']) || 'accepted',
      enforcedRaw: adrField(content, ['\u6267\u6cd5\u65b9\u5f0f', 'Enforced-by', 'Enforced by']),
      revisitRaw: adrField(content, ['revisit-if', 'revisit if', '\u5931\u6548\u6761\u4ef6', '\u91cd\u65b0\u8bc4\u4f30\u6761\u4ef6']),
      reversalRaw: adrField(content, ['reversal', '\u64a4\u56de\u4ee3\u4ef7', '\u64a4\u56de\u6210\u672c']),
    });
  }
  return out;
}

function cmdAdrCheck(flags) {
  const root = projectRoot();
  const file = typeof flags.file === 'string' ? flags.file : 'Architecture-Design.md';
  const dir = typeof flags.dir === 'string' ? flags.dir : 'docs/adr';
  const records = [];
  // Same resolve-then-name pair as parseAdrDir, for the same reason: an absolute --file is
  // where the caller says it is, and the name reported back is the one that was read.
  const filePath = path.resolve(root, file);
  const fileName = repoRelative(filePath);
  const dirName = repoRelative(path.resolve(root, dir));
  if (fs.existsSync(filePath)) {
    let content = '';
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (_e) { /* unreadable -> no records */ }
    for (const r of parseInlineAdrs(content)) records.push({ ...r, source: fileName });
  }
  for (const r of parseAdrDir(root, dir)) records.push(r);
  if (records.length === 0) {
    return emit({ ok: true, records: 0, note: 'no ADR records found (' + fileName + ' / ' + dirName + '); nothing to enforce' }, 0);
  }
  const loaded = loadCatalogFlag(flags);
  const knownChecks = loaded.ok ? Object.keys(loaded.catalog.checks || {}) : [];
  const knownRules = loadFitnessRules().map(r => r.id);
  const assessed = assessAdrRecords(records, knownChecks, knownRules);
  return emit({
    ok: assessed.failing.length === 0,
    records: assessed.records.length,
    machineEnforced: assessed.records.filter(r => r.ok && !r.retired && !r.manualOnly).length,
    manualOnly: assessed.records.filter(r => r.manualOnly).map(r => r.id),
    retired: assessed.records.filter(r => r.retired).map(r => r.id),
    // Not a failure and not buried in details either: how many doors this project cannot walk
    // back through is a number the owner should be able to read off the top of the report.
    oneWayDoors: assessed.records.filter(r => r.oneWayDoor).map(r => ({ id: r.id, title: r.title, source: r.source, reversal: r.reversal })),
    failing: assessed.failing.map(r => ({ id: r.id, title: r.title, source: r.source, reason: r.reason, unrecognized: r.unrecognized })),
    details: assessed.records,
  }, assessed.failing.length === 0 ? 0 : 1);
}

export {
  FITNESS_IGNORE, DEFAULT_FITNESS_RULES, loadFitnessRules, meetsMinimumTier, ruleOptedOut,
  scanFitness, cmdFitness,
  adaptersFilePath, loadAdapters, cmdAdapters,
  parseInlineAdrs, resolveEnforcement, assessAdrRecords, parseAdrDir, cmdAdrCheck,
};
