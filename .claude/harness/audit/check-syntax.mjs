#!/usr/bin/env node
// check-syntax.mjs -- does every framework asset still parse?
//
// cc-base ships behaviour as configuration: hooks and the engine are both .mjs,
// wiring is .json, and every skill and agent is a Markdown file whose YAML
// frontmatter decides whether it is loaded at all. A file that cannot be parsed
// cannot do its job, and the expensive part is that most of these failures are
// SILENT -- malformed frontmatter does not raise an error, the skill simply stops
// existing. This is the cheapest possible check against that class of failure.
//
// Deliberately standalone: no import of harness.mjs. If the engine breaks, this
// still runs; it is also meant to be callable straight from a git hook or CI.
//
// Usage:
//   node .claude/harness/audit/check-syntax.mjs [--staged] [--paths a,b] [--json]
//     --staged   read every checked byte from the index, not from the working tree
//     --paths    explicit comma-separated candidate set; narrows WHICH files are
//                checked, never WHERE their contents come from
//     --json     machine mode: stdout JSON only, no human lines on stderr
//
// Contract: stdout is always ONE line of JSON; human diagnostics go to stderr.
//   exit 0  everything in scope was checked, and it all parsed
//   exit 1  at least one file failed to parse
//   exit 2  usage error (unknown flag, --paths without a value, --paths naming a
//           path that is not there)
//   exit 3  degraded: not a git repository, nothing in scope at all, or something
//           in scope was never checked -- a whole class SKIPPED for a missing
//           checker, or a frontmatter construct outside the subset this checker
//           can rule on.
// A missing checker (no bash, no pwsh) is SKIPPED, and SKIPPED is not a pass:
// a whole class of .ps1 files nobody parsed used to come out as exit 0 ok:true,
// which is the exact sentence "we checked and it is fine" for a class that was
// never opened.
// Skipped classes are printed, carried in the JSON, and now cost exit 3.
//
// Every path is anchored to the repository root. `git ls-files` run from a
// subdirectory lists only that subtree, so `cd .claude && check-syntax` printed
// js=0 json=0 sh=0 ps1=0 and exit 0 on a repository holding a .mjs that does not
// parse. Which directory the caller happened to be in is not allowed to change
// the verdict, and neither is an empty file set: nothing checked is degraded, not
// clean.
//
// Source is ASCII-only. Node builtins only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  makeCli, out, err, oneLine, repoRoot, toRepoRelative,
  gitFileList, headFileCount, indexSet, indexContent,
} from './lib.mjs';

const BOM = 0xFEFF;
const TAB = String.fromCharCode(9);

const { parseArgs, usageExit } = makeCli('check-syntax');

const opts = parseArgs(process.argv.slice(2));
if (opts.error || opts.usage) {
  process.stderr.write('check-syntax: ' +
    (opts.error ? 'unknown argument ' + opts.error : opts.usage) +
    '\nusage: check-syntax.mjs [--staged] [--paths a,b] [--json]\n');
  process.exit(2);
}

// --paths is written by the caller against the caller's directory, so it has to
// be resolved BEFORE the process moves to the repository root.
const rawPaths = opts.paths === null ? null
  : opts.paths.split(',').map(s => s.trim()).filter(Boolean);
const absPaths = rawPaths === null ? null : rawPaths.map(p => path.resolve(p));

const root = repoRoot();
if (root === null && opts.paths === null) {
  err('check-syntax: not a git repository; refusing to guess the file set (pass --paths to check an explicit list)\n');
  process.exit(3);
}
if (root === null && opts.staged) {
  usageExit('--staged needs a git repository');
}
if (root !== null) {
  try {
    process.chdir(root);
  } catch (e) {
    err('check-syntax: cannot enter repository root ' + root + ': ' + oneLine((e && e.code) || e) + '\n');
    process.exit(3);
  }
}

const failures = [];
const skippedClasses = [];
const undecidable = [];
const degraded = [];
const notes = [];
const missingPaths = [];
const counts = {};

// ---------------------------------------------------------------------------
// File set. --paths narrows WHICH files; --staged decides WHERE bytes come from.
// Letting --paths quietly win over --staged would put the working tree back in
// charge of a staged verdict, which is the defect --staged exists to fix.
// ---------------------------------------------------------------------------
const fromIndex = opts.staged;
let files;
let source;

if (absPaths !== null) {
  files = root === null ? rawPaths : absPaths.map(p => toRepoRelative(root, p) || p);
  source = fromIndex ? 'staged+paths' : 'paths';
  // A named path that is not there is the failure mode this family exists to
  // prevent -- checking nothing and reporting clean. It is a degradation, not a
  // usage error: the paths that ARE there still get checked, and the missing
  // ones are named so nobody reads the run as complete.
  const present = [];
  for (const p of files) {
    if (fromIndex ? indexSet().has(p) : fs.existsSync(p)) { present.push(p); continue; }
    missingPaths.push(p);
  }
  // Split by degree, same rule as scan-instructions. SOME missing is a
  // degradation (the rest still get checked, the missing ones get named); ALL
  // missing means the invocation is addressing a tree that is not this one,
  // which is a usage error.
  if (present.length === 0 && missingPaths.length > 0) {
    usageExit('--paths named ' + missingPaths.length + ' path(s) and the ' +
      (fromIndex ? 'index' : 'working tree') + ' has none of them: ' + missingPaths.slice(0, 5).join(' '));
  }
  files = present;
} else {
  files = gitFileList(opts.staged);
  source = opts.staged ? 'staged' : 'tracked';
  if (files === null) {
    err('check-syntax: git refused to list the file set\n');
    process.exit(3);
  }
}

const jsFiles = files.filter(f => /\.(mjs|cjs|js)$/i.test(f));
const jsonFiles = files.filter(f => /\.json$/i.test(f));
const shFiles = files.filter(f => /\.sh$/i.test(f));
const ps1Files = files.filter(f => /\.ps1$/i.test(f));
const fmFiles = files.filter(f =>
  /(^|\/)skills?\/[^/]+\/SKILL\.md$/i.test(f) || /(^|\/)\.claude\/agents\/[^/]+\.md$/i.test(f));

// ---------------------------------------------------------------------------
// Reading. In --staged mode the bytes come from the index; the external parsers
// (node --check, bash -n, the PowerShell parser) can only read a real file, so
// the staged blob is written to a temp copy that keeps the original extension --
// node decides its parse goal from it.
// ---------------------------------------------------------------------------
let stagedDir = null;
let stagedSeq = 0;

function stagedTemp() {
  if (stagedDir === null) stagedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-audit-staged-'));
  return stagedDir;
}

function cleanupStaged() {
  if (stagedDir === null) return;
  try { fs.rmSync(stagedDir, { recursive: true, force: true }); } catch (_e) { /* temp dir already gone; nothing depends on it */ }
  stagedDir = null;
}
process.on('exit', cleanupStaged);

function readText(f) {
  const t = fromIndex ? indexContent(f).toString('utf8') : fs.readFileSync(f, 'utf8');
  return t.charCodeAt(0) === BOM ? t.slice(1) : t;
}

/**
 * A path on disk holding the bytes under test.
 * @returns {string|null} null means the blob could not be materialised, and the
 * caller has already recorded that as degraded -- never as a pass.
 */
function onDisk(f, kind) {
  if (!fromIndex) return f;
  try {
    const target = path.join(stagedTemp(), String(stagedSeq++) + '_' + path.basename(f));
    fs.writeFileSync(target, indexContent(f));
    return target;
  } catch (e) {
    degraded.push({ file: f, kind, detail: 'staged content could not be read: ' + oneLine((e && e.code) || e).slice(0, 120) });
    return null;
  }
}

function firstLines(s, n) {
  return String(s || '').trim().split('\n').slice(0, n).join(' | ').slice(0, 240);
}

/** An external parser names the file it was handed; in --staged mode that is a temp copy. */
function retarget(text, disk, orig) {
  return disk === orig ? String(text || '') : String(text || '').split(disk).join(orig);
}

// ---------------------------------------------------------------------------
// JavaScript: node --check (workflows/ scripts wrapped first, see checkWorkflowScript). Node decides the parse goal from the extension and
// (for ambiguous .js) from module-syntax detection, so the node version is
// recorded in the output -- a failure here is only interpretable next to it.
// ---------------------------------------------------------------------------
const WORKFLOWS_DIR_RE = /(^|\/)\.claude\/workflows\//;

function checkPlainJs(disk) {
  return spawnSync(process.execPath, ['--check', disk], { encoding: 'utf8', windowsHide: true });
}

/**
 * .claude/workflows/*.js are Workflow-tool scripts: the host runs the body inside an async
 * function, so top-level return / await are legal there. A bare `node --check` treats the file
 * as a module/CJS top level, and whether that rejects `return` depends on the node version
 * (CI's node 24.21 does, 24.14 and 22 do not -- and 24.14 also waves through real syntax errors
 * in such files). Wrap the body in an async function so the verdict no longer depends on the
 * version. `export` is illegal inside a function body, so a line-leading one becomes equal-width
 * spaces. The wrapper adds one head line, so reported line numbers drop by 1 and are clamped to
 * the original file (an EOF error would otherwise land past its last line).
 * Returns { status, stderr } with stderr naming `disk`, like checkPlainJs.
 */
function checkWorkflowScript(disk) {
  const src = fs.readFileSync(disk, 'utf8');
  const neutralized = src.replace(/^export(?=\s)/gm, '      ');
  const body = neutralized.endsWith('\n') ? neutralized : neutralized + '\n';
  const totalLines = src.replace(/\n$/, '').split('\n').length;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-audit-wf-'));
  const tmp = path.join(tmpDir, path.basename(disk));
  try {
    fs.writeFileSync(tmp, 'async function __audit_workflow__() {\n' + body + '}\n');
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return r;
    const lineLine = tmp + ':';
    const stderr = String(r.stderr || '').split('\n').map((l) => {
      if (!l.startsWith(lineLine)) return l;
      const n = Number(l.slice(lineLine.length));
      if (!Number.isInteger(n)) return l.split(tmp).join(disk);
      return disk + ':' + Math.min(Math.max(n - 1, 1), totalLines);
    }).join('\n');
    return { status: r.status, stderr };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { /* scratch dir; the verdict does not depend on it */ }
  }
}

counts.js = jsFiles.length;
for (const f of jsFiles) {
  const disk = onDisk(f, 'js');
  if (disk === null) continue;
  const r = WORKFLOWS_DIR_RE.test(f) ? checkWorkflowScript(disk) : checkPlainJs(disk);
  if (r.status !== 0) failures.push({ file: f, kind: 'js', error: firstLines(retarget(r.stderr, disk, f), 3) });
}

// ---------------------------------------------------------------------------
// JSON: settings.json, adapters.json, the catalog, the test fixtures.
// ---------------------------------------------------------------------------
counts.json = jsonFiles.length;
for (const f of jsonFiles) {
  let text;
  try {
    text = readText(f);
  } catch (e) {
    degraded.push({ file: f, kind: 'json', detail: 'not read: ' + oneLine((e && e.code) || e).slice(0, 120) });
    continue;
  }
  try {
    JSON.parse(text);
  } catch (e) {
    failures.push({ file: f, kind: 'json', error: String(e && e.message || e).slice(0, 240) });
  }
}

// ---------------------------------------------------------------------------
// Shell: bash -n. No bash means the whole class is SKIPPED and said out loud.
// ---------------------------------------------------------------------------
counts.sh = shFiles.length;
const bashOk = spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8', windowsHide: true }).status === 0;
if (!bashOk) {
  if (shFiles.length) skippedClasses.push({ kind: 'sh', count: shFiles.length, reason: 'bash not available on PATH' });
} else {
  for (const f of shFiles) {
    const disk = onDisk(f, 'sh');
    if (disk === null) continue;
    const r = spawnSync('bash', ['-n', disk], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) failures.push({ file: f, kind: 'sh', error: firstLines(retarget(r.stderr, disk, f), 3) });
  }
}

// ---------------------------------------------------------------------------
// PowerShell: the language parser, in one batched invocation (per-file startup
// would cost seconds each). The wrapper always exits 0 and reports bad files on
// stdout, so a parse error cannot be confused with the wrapper itself failing.
// ---------------------------------------------------------------------------
counts.ps1 = ps1Files.length;
function findPwsh() {
  for (const exe of ['pwsh', 'powershell']) {
    const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'],
      { encoding: 'utf8', windowsHide: true });
    if (!r.error && r.status === 0) return exe;
  }
  return null;
}

if (ps1Files.length === 0) {
  // nothing to do
} else {
  const exe = findPwsh();
  if (!exe) {
    skippedClasses.push({ kind: 'ps1', count: ps1Files.length, reason: 'neither pwsh nor powershell available on PATH' });
  } else {
    // Checked path back to reported path: in --staged mode the parser sees a
    // temp copy, and naming the temp file in a failure would be useless.
    const backToSource = new Map();
    const checkList = [];
    for (const f of ps1Files) {
      const disk = onDisk(f, 'ps1');
      if (disk === null) continue;
      backToSource.set(path.resolve(disk), f);
      checkList.push(disk);
    }
    const listFile = path.join(os.tmpdir(), 'cc-audit-ps1-' + process.pid + '.txt');
    try {
      fs.writeFileSync(listFile, checkList.join('\n'), 'utf8');
      const quoted = "'" + listFile.split("'").join("''") + "'";
      const script =
        '$ErrorActionPreference = ' + "'Continue'" + '; ' +
        'foreach ($p in Get-Content -LiteralPath ' + quoted + ') { ' +
        'if (-not $p) { continue }; ' +
        '$t = $null; $e = $null; ' +
        '[void][System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$t, [ref]$e); ' +
        'if ($e -and $e.Count -gt 0) { Write-Output ((' + "'BAD'" + ' + [char]9 + $p + [char]9 + $e[0].Message)) } ' +
        '}';
      const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
      if (r.error || r.status !== 0) {
        // The checker itself failed. That is not a syntax verdict either way, so
        // report it as its own failure instead of pretending the files are fine.
        failures.push({ file: '(ps1 batch)', kind: 'ps1-checker', error: firstLines((r.stderr || '') + ' ' + String(r.error || ''), 3) });
      } else {
        for (const line of String(r.stdout || '').split('\n')) {
          const parts = line.replace(/\r$/, '').split(TAB);
          if (parts[0] === 'BAD' && parts[1]) {
            const reported = backToSource.get(path.resolve(parts[1])) || parts[1];
            failures.push({ file: reported, kind: 'ps1', error: String(parts[2] || '').slice(0, 240) });
          }
        }
      }
    } finally {
      try { fs.unlinkSync(listFile); } catch (_e) { /* temp file already gone; nothing depends on it */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Frontmatter: the silent one. A SKILL.md or agent file whose YAML block is
// malformed is not reported anywhere -- the skill or agent just stops being
// loaded. There is no YAML parser here (no dependencies, and hand-rolling one
// is how you end up disagreeing with the real loader), so the subset is drawn
// tight around what Claude Code frontmatter actually uses: `key: value`, nested
// maps, list items, comments, quoted scalars that may span lines, and block
// scalars. Anything outside it is reported as UNDECIDABLE and costs exit 3 --
// declining to rule is honest; guessing in either direction is not.
//
// The judgements below are the ones a first-character look at the value cannot
// make, and every one of them was a false NEGATIVE -- the direction that makes
// this checker worthless, because it reports ok on a file the real loader will
// drop:
//   * `description: demo skill trigger: when the user asks` -- a plain scalar
//     may not contain ": ", and a long prose description with one ASCII colon
//     in it is the single likeliest way this repository breaks a skill.
//   * a plain value opening with `@`, backtick or `%` (YAML reserved), with
//     "- " (that is a sequence entry), or with a malformed block header.
//   * a dedent to a column no enclosing block ever opened, which needs an
//     indent stack rather than a comparison against the last key alone.
//   * a tab in the indentation of a block scalar body.
// Verified line by line against python yaml.safe_load; see README.
// ---------------------------------------------------------------------------
counts.frontmatter = fmFiles.length;

const KEY_RE = /^(?:[A-Za-z_][A-Za-z0-9_.-]*|"[^"]*"|'[^']*')\s*:(?:\s(.*))?$/;
const BLOCK_SCALAR_RE = /^[|>][+-]?[0-9]*$/;

/**
 * Index just past the closing quote, or -1 if the scalar runs past end of line
 * (legal YAML -- a quoted scalar may span lines -- so the caller keeps looking).
 */
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
 * Everything that makes a PLAIN (unquoted) scalar illegal where it stands.
 * Applies to a value after `key:` and to the continuation lines of a multi-line
 * plain scalar, because YAML judges both the same way.
 * @returns {null | {kind:'error', reason:string}}
 */
function plainScalarProblem(v, n) {
  if (v === '') return null;
  if (/:(\s|$)/.test(v)) {
    return { kind: 'error', reason: 'line ' + n + ' puts ": " inside a plain value; YAML reads that as a second mapping key and rejects it -- quote the value: ' + v.slice(0, 60) };
  }
  if (/^[@`%]/.test(v)) {
    return { kind: 'error', reason: 'line ' + n + ' starts a plain value with a reserved indicator (' + v.charAt(0) + '); quote it: ' + v.slice(0, 60) };
  }
  if (/^-(\s|$)/.test(v)) {
    return { kind: 'error', reason: 'line ' + n + ' starts a plain value with "- ", which YAML reads as a sequence entry: ' + v.slice(0, 60) };
  }
  if (/^[|>]/.test(v) && !BLOCK_SCALAR_RE.test(v)) {
    return { kind: 'error', reason: 'line ' + n + ' has a malformed block scalar header (' + v.slice(0, 8) + '); the indicator must stand alone on the line' };
  }
  return null;
}

/** @returns {null | {kind:'error'|'undecidable', reason:string}} */
function frontmatterCheck(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
  if (lines[0] !== '---') return { kind: 'error', reason: 'first line is not "---" (no frontmatter block; the file will be ignored)' };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { end = i; break; }
  }
  if (end < 0) return { kind: 'error', reason: 'unterminated frontmatter: no closing "---"' };

  let keys = 0;
  let sawKey = false;
  let openQuote = null;   // {ch, line} -- quoted scalar still running
  let block = null;       // {indent} -- literal/folded scalar body still running
  let lastKey = null;     // {indent, hadValue} -- owner of any indented continuation
  let unsure = null;
  // Columns an enclosing block has opened. A dedent to anything else is the
  // "4 spaces then back to 2" shape, which the real parser rejects and a
  // compare-against-the-last-key check cannot see.
  const stack = [0];

  const openColumn = (indent, n, trimmed) => {
    const top = stack[stack.length - 1];
    if (indent > top) { stack.push(indent); return null; }
    if (indent === top) return null;
    while (stack.length && stack[stack.length - 1] > indent) stack.pop();
    if (stack.length === 0 || stack[stack.length - 1] !== indent) {
      return { kind: 'error', reason: 'line ' + n + ' dedents to column ' + indent + ', which no enclosing block opened: ' + trimmed.slice(0, 60) };
    }
    return null;
  };

  // Every value that is not a quoted or block scalar goes through here, so the
  // shapes this checker cannot reason about get named instead of guessed at.
  // @returns {{kind:string, problem:null|object}}
  const classifyValue = (value, n) => {
    if (value === '') return { kind: 'empty', problem: null };
    const ch = value.charAt(0);
    if (ch === '"' || ch === "'") {
      if (closingQuote(value, ch) < 0) openQuote = { ch, line: n };
      return { kind: 'scalar', problem: null };
    }
    if (BLOCK_SCALAR_RE.test(value)) return { kind: 'block', problem: null };
    if (ch === '{' || ch === '[') {
      if (!unsure) unsure = 'line ' + n + ' uses a flow collection; outside the subset this checker can rule on';
      return { kind: 'scalar', problem: null };
    }
    if (ch === '&' || ch === '*' || ch === '!') {
      if (!unsure) unsure = 'line ' + n + ' uses an anchor, alias or tag; outside the subset this checker can rule on';
      return { kind: 'scalar', problem: null };
    }
    return { kind: 'scalar', problem: plainScalarProblem(value, n) };
  };

  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    const n = i + 1;

    if (openQuote) {
      if (closingQuote(openQuote.ch + raw, openQuote.ch) >= 0) openQuote = null;
      continue;
    }

    const lead = /^[ \t]*/.exec(raw)[0];

    // Inside a block scalar the body is literal text: tabs, colons and dashes
    // in there mean nothing to the parser and must not be judged -- except in
    // the indentation itself, where a tab is as illegal as anywhere else.
    if (block) {
      if (raw.trim() === '') continue;
      if (lead.length > block.indent) {
        if (raw.slice(0, block.indent + 1).indexOf(TAB) >= 0) {
          return { kind: 'error', reason: 'line ' + n + ' indents a block scalar body with a tab; YAML forbids tabs in indentation: ' + raw.trim().slice(0, 60) };
        }
        continue;
      }
      block = null;
    }

    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (lead.indexOf(TAB) >= 0) {
      return { kind: 'error', reason: 'line ' + n + ' indents with a tab; YAML forbids tabs in indentation: ' + trimmed.slice(0, 60) };
    }
    const indent = lead.length;
    const content = raw.slice(indent);

    // A key that already carries a scalar value cannot own a nested mapping, so
    // anything indented under it is the continuation of that plain scalar and is
    // judged as one. Indentation of a continuation is free-form, which is why it
    // deliberately does not touch the column stack.
    if (lastKey && lastKey.hadValue && indent > lastKey.indent) {
      const bad = plainScalarProblem(content, n);
      if (bad) return bad;
      continue;
    }

    if (/^\?(\s|$)/.test(content) || /^<<\s*:/.test(content) || /^%/.test(content)) {
      if (!unsure) unsure = 'line ' + n + ' uses an explicit key, merge key or directive; outside the subset this checker can rule on';
      const col = openColumn(indent, n, trimmed);
      if (col) return col;
      lastKey = { indent, hadValue: false };
      continue;
    }

    if (/^-(\s|$)/.test(content)) {
      if (!sawKey) return { kind: 'error', reason: 'line ' + n + ' is a list item with no key above it: ' + trimmed.slice(0, 60) };
      const col = openColumn(indent, n, trimmed);
      if (col) return col;
      const after = content.slice(1);
      const item = after.trim();
      const km = KEY_RE.exec(item);
      const v = km ? String(km[1] === undefined ? '' : km[1]).trim() : item;
      const res = classifyValue(v, n);
      if (res.problem) return res.problem;
      if (res.kind === 'block') block = { indent };
      // The owner of any continuation is the key INSIDE the item, which starts
      // where the dash padding ends -- not at the dash column. Getting this
      // wrong turns the second field of a list-of-maps into a bogus error.
      lastKey = { indent: indent + 1 + (after.length - after.trimStart().length), hadValue: res.kind !== 'empty' };
      continue;
    }

    const m = KEY_RE.exec(content);
    if (m) {
      const col = openColumn(indent, n, trimmed);
      if (col) return col;
      keys++;
      sawKey = true;
      const res = classifyValue(String(m[1] === undefined ? '' : m[1]).trim(), n);
      if (res.problem) return res.problem;
      lastKey = { indent, hadValue: res.kind !== 'empty' };
      if (res.kind === 'block') block = { indent };
      continue;
    }

    // Not a key and not a list item: only legal as the continuation of a
    // multi-line plain scalar, which has to be indented past its own key.
    if (lastKey && indent > lastKey.indent) {
      const bad = plainScalarProblem(content, n);
      if (bad) return bad;
      continue;
    }
    return { kind: 'error', reason: 'line ' + n + ' is neither "key: value", a list item, nor a continuation: ' + trimmed.slice(0, 60) };
  }

  if (openQuote) {
    return { kind: 'error', reason: 'quoted value opened on line ' + openQuote.line + ' is never closed before the frontmatter ends' };
  }
  if (keys === 0) return { kind: 'error', reason: 'frontmatter block contains no keys' };
  if (unsure) return { kind: 'undecidable', reason: unsure };
  return null;
}

for (const f of fmFiles) {
  let text;
  try {
    text = readText(f);
  } catch (e) {
    failures.push({ file: f, kind: 'frontmatter', error: 'unreadable: ' + oneLine((e && e.code) || e).slice(0, 120) });
    continue;
  }
  const problem = frontmatterCheck(text);
  if (!problem) continue;
  if (problem.kind === 'undecidable') undecidable.push({ file: f, kind: 'frontmatter', reason: problem.reason });
  else failures.push({ file: f, kind: 'frontmatter', error: problem.reason });
}

cleanupStaged();

// "Nothing to check" and "did not manage to check" are different answers and
// must not share an exit code. A commit of nothing but Markdown holds no file
// this checker parses, and calling that a degradation would put a warning on
// every documentation commit -- a gate that is always amber gets scrolled past.
for (const p of missingPaths) {
  degraded.push({
    file: p,
    kind: 'path-not-found',
    detail: '--paths named it but the ' + (fromIndex ? 'index' : 'working tree') + ' does not have it; not checked',
  });
}
const inScope = counts.js + counts.json + counts.sh + counts.ps1 + counts.frontmatter;
if (inScope === 0) {
  notes.push({
    file: '(scope)',
    note: 'nothing-in-scope:listed=' + files.length + ' in-scope=0 (no js/json/sh/ps1/frontmatter among them)',
  });
}
// The one empty listing that IS a defect: tracked mode found nothing while the
// repository demonstrably holds files. That is the listing no longer describing
// this repository, which is exactly how the subdirectory bug read from outside.
if (source === 'tracked' && files.length === 0) {
  const head = headFileCount();
  if (head > 0) {
    degraded.push({
      file: '(scope)',
      kind: 'listing-empty-but-repo-nonempty',
      detail: 'git listed 0 tracked paths but HEAD holds ' + head + '; the file list is not describing this repository',
    });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (!opts.json) {
  for (const f of failures) {
    err(' FAIL  ' + f.kind.padEnd(12) + f.file + '  ' + f.error + '\n');
  }
  for (const u of undecidable) {
    err(' UNDECIDABLE  ' + u.kind.padEnd(6) + u.file + '  ' + u.reason + '\n');
  }
  for (const s of skippedClasses) {
    err(' SKIPPED  ' + s.kind.padEnd(10) + s.count + ' file(s): ' + s.reason + '  (not run is not the same as passing)\n');
  }
  for (const d of degraded) {
    err(' DEGR  ' + d.kind.padEnd(16) + '  ' + d.file + '  ' + d.detail +
      '  (not checked is not the same as parsing)\n');
  }
  for (const n of notes) err(' note  ' + n.note.padEnd(16) + '  ' + n.file + '\n');
  err('check-syntax: source=' + source + ' root=' + (root === null ? '(none)' : root) +
    ' listed=' + files.length + ' in-scope=' + inScope +
    ' js=' + counts.js + ' json=' + counts.json + ' sh=' + counts.sh +
    ' ps1=' + counts.ps1 + ' frontmatter=' + counts.frontmatter +
    ' failures=' + failures.length + ' skipped-classes=' + skippedClasses.length +
    ' undecidable=' + undecidable.length + ' degraded=' + degraded.length + '\n');
}

out(JSON.stringify({
  command: 'check-syntax',
  // A skipped class, an undecidable file or an empty scope means part of the
  // scope holds no verdict. "Everything parsed" would be a claim about files
  // nobody opened.
  ok: failures.length === 0 && skippedClasses.length === 0 && undecidable.length === 0 && degraded.length === 0,
  node: process.version,
  source,
  root,
  listed: files.length,
  inScope,
  checked: counts,
  failures,
  skipped: skippedClasses,
  undecidable,
  degraded,
  notes,
}) + '\n');

// A real parse failure outranks degradation: it is the more actionable answer,
// and exit 1 is what callers already block on.
process.exitCode = failures.length > 0
  ? 1
  : ((skippedClasses.length + undecidable.length + degraded.length) > 0 ? 3 : 0);
