#!/usr/bin/env node
// scan-instructions.mjs -- treat instruction files as UNTRUSTED input.
//
// Why this exists: CLAUDE.md, .claude/rules/*.md, every skills/*/SKILL.md and
// .claude/agents/*.md are loaded into the model's context automatically, before a
// human necessarily opens them. That makes them executable-adjacent input, and an
// active attack surface: leaked API keys and rewritten model base URLs have been
// found inside AI instruction files in the wild, and README/instruction injection
// is a documented technique for hijacking a coding assistant.
// cc-base loads all of the above and, until this script, scanned none of it.
//
// Deliberately standalone: no import of harness.mjs. If the engine breaks, this
// still runs; it is also meant to be callable straight from a git hook or CI.
//
// Usage:
//   node .claude/harness/audit/scan-instructions.mjs [--staged] [--paths a,b] [--json]
//     --staged   read every scanned byte from the index, not from the working tree
//     --paths    explicit comma-separated candidate set; narrows WHICH files are
//                looked at, never WHERE their contents come from
//     --json     machine mode: stdout JSON only, no human lines on stderr
//
// Contract: stdout is always ONE line of JSON; human diagnostics go to stderr.
//   exit 0  everything in scope was scanned and nothing error-severity came out
//   exit 1  at least one error-severity finding
//   exit 2  usage error (unknown flag, --paths without a value, --paths naming a
//           path that is not there)
//   exit 3  degraded: not a git repository, nothing in scope at all, or something
//           in scope could not be scanned (oversized, unreadable, broken
//           allowlist). "Not scanned" is never allowed to read as "clean", so it
//           gets its own exit code.
//
// Every path is anchored to the repository root. `git ls-files` run from a
// subdirectory lists only that subtree, and names it relative to that
// subdirectory -- so `cd .claude && scan-instructions` used to report exit 0
// ok:true on a repository whose CLAUDE.md carried a prompt injection, purely
// because `rules/demo.md` no longer looked like `.claude/rules/demo.md`. Which
// directory the caller happened to be in is not allowed to change the verdict.
//
// Suppression is EXTERNAL, on purpose. The whole premise of this script is that
// the files it reads are untrusted; a line inside one of them that switches off
// the scan of that same file is self-defeating -- an attacker who can write the
// payload can write the mute. Exemptions live in
// .claude/harness/audit/instructions-allowlist.json (relative to the scanned
// repository), each entry bound to {file, line, rule, sha256-of-that-line} plus a
// required {context} hash over the surrounding lines -- an entry that binds only
// this line's bytes is reported, never honoured. In --staged mode the
// allowlist itself is read from the index: an exemption that is not part of the
// commit must not be able to unlock it. Every exemption that fires is printed and
// carried in the JSON: a silent exemption is a blind spot.
//
// Source is ASCII-only, matching harness.mjs and the .ps1 convention, so the file
// survives every cross-platform encoding trap. Node builtins only.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import {
  makeCli, out, err, oneLine, repoRoot, toRepoRelative,
  gitFileList, headFileCount, indexSet, indexContent,
} from './lib.mjs';

const NUL = String.fromCharCode(0);

// ---------------------------------------------------------------------------
// What counts as an instruction file: anything a harness may load as guidance
// without a human choosing to open it.
// ---------------------------------------------------------------------------
const INSTRUCTION_PATTERNS = [
  /(^|\/)CLAUDE(\.local)?\.md$/i,
  /(^|\/)AGENTS\.md$/i,
  /(^|\/)GEMINI\.md$/i,
  /(^|\/)\.claude\/rules\/.+\.md$/i,
  // Same documents, at their pre-install home: the large-repo package ships them under
  // harness/ext/rules/ and setup lands them in .claude/rules/. Scanning only the installed
  // path would leave the source of a loaded instruction file unscanned in this repo.
  /(^|\/)\.claude\/harness\/ext\/rules\/.+\.md$/i,
  /(^|\/)skills?\/[^/]+\/SKILL\.md$/i,
  /(^|\/)\.claude\/agents\/[^/]+\.md$/i,
  // settings.json is not prose, but its env block is exactly where a rewritten
  // base URL would land, and Claude Code reads it without anyone opening it.
  /(^|\/)\.claude\/settings(\.local)?\.json$/i,
  /(^|\/)\.cursorrules$/i,
  /(^|\/)\.cursor\/rules\//i,
  /(^|\/)\.github\/copilot-instructions\.md$/i,
  /(^|\/)\.windsurfrules$/i,
];

// Zero-width and bidirectional control characters, written as escapes on purpose:
// a scanner that carries the very bytes it hunts for would flag itself and would
// break the ASCII-only source rule.
const HIDDEN_CLASS = '[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]';

// Environment names that move the endpoint or hold the credential. Spelled as a
// vendor token with anything around it, because the exact-name list missed the
// infix forms: \bANTHROPIC_BASE_URL\b does not see ANTHROPIC_BEDROCK_BASE_URL,
// and ANTHROPIC_AUTH_TOKEN -- a credential landing spot with no key prefix for
// embedded-credential to recognise -- was not on the list at all.
const ENDPOINT_NAME =
  '[A-Z0-9_]*(?:ANTHROPIC|OPENAI|GEMINI|CLAUDE|VERTEX|BEDROCK|LLM)[A-Z0-9_]*' +
  '(?:BASE_URL|API_BASE|API_KEY|AUTH_TOKEN|API_TOKEN|ENDPOINT)' +
  '|HTTPS?_PROXY|ALL_PROXY';

// A prohibition is not an instruction to do the thing. "Never skip the tests" and
// "you are forbidden from passing --no-verify" are what a careful repository says;
// firing on them made gate-disable-instruction report 7 of 8 sample sentences,
// nearly all of them bans, and a rule at that noise level gets switched off.
// The Chinese alternatives and the full-width clause terminators are written as
// \u escapes on purpose: this file has to stay ASCII-only like harness.mjs and the
// .ps1 hooks, because Windows PowerShell 5.1 reads a BOM-less UTF-8 file as GBK and
// mangles every non-ASCII byte in it. Escapes are the repository's existing answer
// to that (same trick the .ps1 hooks use for their Chinese trigger words), and a
// JS regex treats \uXXXX and the literal character as the same thing.
//   \u7981\u6b62 jinzhi  \u4e0d\u8bb8 buxu    \u4e0d\u5f97 bude
//   \u4e0d\u8981 buyao   \u4e25\u7981 yanjin  \u4e0d\u80fd buneng
const PROHIBITION = /\b(?:never|do\s+not|don't|must\s+not|shall\s+not|should\s+not|cannot|can't|forbidden|prohibited|refuses?\s+to)\b|\u7981\u6b62|\u4e0d\u8bb8|\u4e0d\u5f97|\u4e0d\u8981|\u4e25\u7981|\u4e0d\u80fd/i;
const CLAUSE_BREAK = /[.;:!?\u3002\uff1b\uff01\uff1f]/;

// ---------------------------------------------------------------------------
// Rule table. Each rule owns its own regex flags on purpose: the exfiltration
// rule stays case-SENSITIVE on its flag alternation, otherwise `-F` also matches
// the extremely common `curl -f` and the rule drowns in false positives.
// ---------------------------------------------------------------------------
const RULES = [
  {
    id: 'endpoint-override',
    severity: 'error',
    message: 'redirects the model or tool endpoint. Moving the base URL sends every prompt and every credential somewhere the reader did not choose.',
    // The optional quote between name and separator is what makes this fire on
    // JSON ("ANTHROPIC_BASE_URL": "...") as well as on shell and dotenv forms;
    // the setx branch covers the Windows shape, where the separator is a space.
    re: new RegExp('\\b(?:' + ENDPOINT_NAME + ')\\b["\']?\\s*[:=]' +
      '|\\bsetx\\s+["\']?(?:' + ENDPOINT_NAME + ')\\b', 'i'),
    // scan-secrets:ignore -- next line names the shape maskUrl exists for
    // The line is echoed, and HTTPS_PROXY=https://user:token@host would echo a
    // credential straight into a CI log.
    maskUrl: true,
  },
  {
    id: 'embedded-credential',
    severity: 'error',
    message: 'carries credential-shaped material. Instruction files get copied between repositories and pasted into issues; a key here is a key published.',
    // Same format table as scan-secrets: an instruction file that leaks a
    // sk-ant- or github_pat_ key leaks it exactly as hard as source code does.
    re: /\bsk-ant-[A-Za-z0-9_-]{16,}|\bsk-proj-[A-Za-z0-9_-]{16,}|\bsk-[A-Za-z0-9]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bglpat-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}|\bhf_[A-Za-z0-9]{30,}|\bnpm_[A-Za-z0-9]{30,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    redact: true,
  },
  {
    id: 'instruction-override',
    severity: 'error',
    message: 'claims authority over higher-level instructions. Repository-supplied text is the lowest authority there is; text arguing otherwise is an injection attempt.',
    // Each alternative carries its own boundaries. Wrapping the whole group in a
    // single trailing \b would break "you are now root" -- there is no boundary
    // after the single [a-z] the pattern consumes.
    re: /\bignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|prompts)\b|\bdisregard\s+(?:the\s+)?(?:system|previous|above)\b|\byou\s+are\s+now\s+[a-z]|\bforget\s+(?:everything|all\s+previous)\b|\boverride\s+(?:the\s+)?(?:system|safety)\b/i,
  },
  {
    id: 'exfiltration-command',
    severity: 'error',
    message: 'tells the agent to send repository content to a network endpoint. An instruction file may describe how to build; it has no reason to describe how to upload.',
    // Upload flags are per-tool, not shared. Judging wget by curl's alphabet is
    // how `wget URL -T 30` (a timeout) got reported as exfiltration, which is the
    // same collision the case-sensitive `-F` handling already guards against.
    re: /\b(?:curl|CURL|Curl|Invoke-WebRequest|Invoke-Webrequest|invoke-webrequest|iwr|IWR|Iwr)\b[^\n]{0,120}(?:\s-d\b|\s--data\b|\s--data-binary\b|\s--data-raw\b|\s--upload-file\b|\s-F\b|\s-T\b|-Method\s+Post\b|-Body\b)|\b(?:wget|WGET|Wget)\b[^\n]{0,120}(?:\s--post-data\b|\s--post-file\b|\s--body-data\b|\s--body-file\b|\s--method=POST\b)|\bnc\b\s+-[a-z]*\s*\d{1,5}\b/,
  },
  {
    id: 'silent-execution',
    severity: 'error',
    message: 'pipes a downloaded script straight into a shell. Nothing that must be read before it runs should arrive this way.',
    re: /\b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba)?sh\b|\biex\s*\(\s*(?:new-object|iwr|invoke-webrequest)/i,
  },
  {
    id: 'hidden-characters',
    severity: 'error',
    message: 'contains zero-width or bidirectional control characters. Text a human cannot see but a model reads is, by construction, meant to escape review.',
    re: new RegExp(HIDDEN_CLASS),
  },
  {
    id: 'gate-disable-instruction',
    severity: 'error',
    message: 'instructs the agent to bypass its own verification. A repository telling an agent to skip its gates is describing the exploit, not the build.',
    re: /--no-verify|\bskip[- ]?(?:the\s+)?(?:hook|gate|check|test)s?\b|\bdisable\s+(?:the\s+)?(?:hook|gate|lint|check)s?\b/i,
    // Only the affirmative form is an instruction. See PROHIBITION.
    affirmativeOnly: true,
  },
  {
    id: 'secret-file-read',
    severity: 'warning',
    message: 'names a secret-bearing path. An instruction file should never need to point at one.',
    re: /(?:^|[\s"'\x60(\[])(?:\.env(?:\.[a-z]+)?|id_rsa|id_ed25519|\.ssh\/|\.aws\/credentials|\.npmrc)\b/i,
    // Narrow, documented exception: the .example / .sample / .template forms are
    // the committed placeholder convention, not a secret-bearing path.
    except: /\.env\.(?:example|sample|template)\b/i,
  },
];

// The exception is removed from the line before re-testing, so it has to remove
// EVERY occurrence: a line naming .env.example twice used to keep matching after
// the first was stripped and got reported anyway. Kept separate from `except`
// because a /g regex is stateful and `except.test()` runs on every line.
for (const r of RULES) {
  if (r.except) r.exceptAll = new RegExp(r.except.source, r.except.flags.replace(/g/g, '') + 'g');
}

const ALLOWLIST_PATH = '.claude/harness/audit/instructions-allowlist.json';
const README_PATH = '.claude/harness/audit/README.md';
// A lapsed entry needs three values recomputed, and "re-hash the line" names the
// job without saying how it is done -- so the diagnostic carries the command.
// This one lapses on every insertion above the exempted line, in a file that is
// edited every time the engine grows a subcommand, so it is a diagnostic its
// owner reads often. Re-reading the line comes first and is not automatable:
// hashes handed over without looking at what they now bind would turn the one
// checkpoint this binding exists to create into a rubber stamp.
// The split() here has to strip a leading UTF-8 BOM and normalize \r\n -> \n,
// in the same order the scanner uses below (TODO #73): a line re-hashed
// straight off a CRLF checkout, or off the first line of a file that opens
// with a BOM, used to land on a different sha256 than the one the scanner
// computes, so a re-signed entry would lapse again on the very next scan.
// Lone \r bytes are left alone, same reasoning as the scanner's.
const REHASH_CMD = 'node -e "const f=process.argv[1],i=+process.argv[2]-1,'
  + 'h=s=>require(\'crypto\').createHash(\'sha256\').update(s).digest(\'hex\'),'
  + 'L=require(\'fs\').readFileSync(f,\'utf8\').replace(/^\\uFEFF/,\'\').replace(/\\r\\n/g,\'\\n\').split(\'\\n\');'
  + 'console.log(JSON.stringify({line:i+1,sha256:h(L[i]),'
  + 'context:h((L[i-1]||\'\')+\'\\n\'+L[i]+\'\\n\'+(L[i+1]||\'\'))}))" <file> <line>';
const MAX_BYTES = 1024 * 1024;
const MAX_REPORTED = 200;
const HIDDEN_GLOBAL = new RegExp(HIDDEN_CLASS, 'g');
const RULE_IDS = new Set(RULES.map(r => r.id));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const { parseArgs, usageExit } = makeCli('scan-instructions');

const opts = parseArgs(process.argv.slice(2));
if (opts.error || opts.usage) {
  process.stderr.write('scan-instructions: ' +
    (opts.error ? 'unknown argument ' + opts.error : opts.usage) +
    '\nusage: scan-instructions.mjs [--staged] [--paths a,b] [--json]\n');
  process.exit(2);
}

// --paths is written by the caller against the caller's directory, so it has to
// be resolved BEFORE the process moves to the repository root.
const rawPaths = opts.paths === null ? null
  : opts.paths.split(',').map(s => s.trim()).filter(Boolean);
const absPaths = rawPaths === null ? null : rawPaths.map(p => path.resolve(p));

const root = repoRoot();
if (root === null && opts.paths === null) {
  err('scan-instructions: not a git repository; refusing to guess the file set (pass --paths to scan an explicit list)\n');
  process.exit(3);
}
if (root === null && opts.staged) {
  usageExit('--staged needs a git repository');
}
if (root !== null) {
  try {
    process.chdir(root);
  } catch (e) {
    err('scan-instructions: cannot enter repository root ' + root + ': ' + oneLine((e && e.code) || e) + '\n');
    process.exit(3);
  }
}

// ---------------------------------------------------------------------------
// File set. --paths narrows WHICH files; --staged decides WHERE bytes come from.
// They used to be mutually exclusive, with --paths silently winning, so
// `--staged --paths CLAUDE.md` read the working tree and reported a payload that
// was never staged -- the exact defect --staged was added to fix, reachable by
// adding a second flag.
// ---------------------------------------------------------------------------
let candidates;
let source;
const fromIndex = opts.staged;
const missingPaths = [];

if (absPaths !== null) {
  candidates = root === null ? rawPaths : absPaths.map(p => toRepoRelative(root, p) || p);
  source = opts.staged ? 'staged+paths' : 'paths';
  // An explicit list naming something that is not there is a typo, not a repo
  // state: scanning zero of the files the caller asked for and reporting clean
  // is the false green this whole family exists to prevent.
  // A named path that is not there is the failure mode this family exists to
  // prevent -- scanning nothing and reporting clean. It is a degradation, not a
  // usage error: the paths that ARE there still get scanned, and the missing
  // ones are named so nobody reads the run as complete.
  const present = [];
  for (const p of candidates) {
    if (fromIndex ? indexSet().has(p) : fs.existsSync(p)) { present.push(p); continue; }
    missingPaths.push(p);
  }
  // Split by degree, because the two cases mean different things. SOME of the
  // named paths missing is a degradation: the rest still get scanned, and the
  // missing ones are named so the run cannot be read as complete. ALL of them
  // missing means the invocation is addressing a tree that is not this one --
  // wrong directory, wrong argument, stale list -- and that is a usage error,
  // which is also what the regression lock on this flag has pinned since before
  // --paths existed here.
  if (present.length === 0 && missingPaths.length > 0) {
    usageExit('--paths named ' + missingPaths.length + ' path(s) and the ' +
      (fromIndex ? 'index' : 'working tree') + ' has none of them: ' + missingPaths.slice(0, 5).join(' '));
  }
  candidates = present;
} else {
  candidates = gitFileList(opts.staged);
  source = opts.staged ? 'staged' : 'tracked';
  if (candidates === null) {
    err('scan-instructions: git refused to list the file set\n');
    process.exit(3);
  }
}

const isInstruction = f => INSTRUCTION_PATTERNS.some(re => re.test(f));
const targets = candidates.filter(isInstruction);
const skipped = candidates.filter(f => !isInstruction(f));

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------
/** Never echo a matched secret back out; a scanner that prints secrets into CI logs is itself a leak. */
function redactMatch(line, re) {
  const m = re.exec(line);
  if (!m) return line;
  const hit = m[0];
  return line.split(hit).join(hit.slice(0, 4) + '<REDACTED:' + hit.length + '>');
}

/**
 * Enough of the line to locate the problem, none of the credential in it. A
 * rewritten endpoint is reported by echoing its line, and the line that carries
 * a proxy override is exactly the line that tends to carry the token too.
 */
function maskUrlCredentials(s) {
  return s
    .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1<REDACTED>@')
    .replace(/([?&](?:token|key|api[-_]?key|access[-_]?token|password|secret)=)[^&\s"'\x60]+/gi, '$1<REDACTED>');
}

/** Make invisible characters visible, otherwise the finding reads as an empty complaint. */
function reveal(s) {
  return s.replace(HIDDEN_GLOBAL, ch =>
    '<U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + '>');
}

function sha256(s) {
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

/**
 * Hash of the exempted line together with the line above and below it. The line
 * hash alone binds bytes but not meaning: deleting the ``` fence around a
 * documented counter-example leaves the exempted line byte-identical while
 * turning "never do this" into "do this" -- and the README's own example of a
 * legitimate exemption is a counter-example inside a fence, so that is the
 * common case, not an exotic one. Which is why this binding is mandatory rather
 * than an opt-in hardening: an optional defence that the most common use never
 * opts into defends nobody.
 */
function windowSha(lines, i) {
  const prev = i > 0 ? lines[i - 1] : '';
  const next = i + 1 < lines.length ? lines[i + 1] : '';
  return sha256(prev + '\n' + lines[i] + '\n' + next);
}

const degraded = [];
const notes = [];

// ---------------------------------------------------------------------------
// External allowlist. Read from the scanned repository, not from next to this
// script: the exemptions are that repository's ledger and travel with it. In
// --staged mode it is read from the index for the same reason the scanned files
// are -- an exemption sitting in the working tree (or, worse, gitignored)
// unlocked a staged payload while leaving no trace in the commit at all.
// A file that cannot be parsed is a degradation, not a shrug -- exemptions
// vanishing quietly would look like the scanner suddenly getting stricter for
// no stated reason.
// ---------------------------------------------------------------------------
function readAllowlistText() {
  if (fromIndex) {
    // Absent from the index is not an error: it means this commit grants no
    // exemptions, which is a complete answer.
    if (!indexSet().has(ALLOWLIST_PATH)) return null;
    return indexContent(ALLOWLIST_PATH).toString('utf8');
  }
  return fs.readFileSync(ALLOWLIST_PATH, 'utf8');
}

function loadAllowlist() {
  let raw;
  try {
    raw = readAllowlistText();
    if (raw === null) return new Map();
  } catch (e) {
    if (e && e.code === 'ENOENT') return new Map();
    degraded.push({ file: ALLOWLIST_PATH, kind: 'allowlist-unreadable', detail: oneLine((e && e.code) || e).slice(0, 120) });
    return new Map();
  }
  let doc;
  try {
    doc = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
  } catch (e) {
    degraded.push({ file: ALLOWLIST_PATH, kind: 'allowlist-malformed', detail: oneLine((e && e.message) || e).slice(0, 160) });
    return new Map();
  }
  if (!doc || typeof doc !== 'object' || doc.version !== 1 || !Array.isArray(doc.entries)) {
    // The version is checked rather than ignored: reading a future schema with
    // today's rules would grant exemptions nobody wrote.
    degraded.push({ file: ALLOWLIST_PATH, kind: 'allowlist-malformed', detail: 'expected {"version":1,"entries":[...]}' });
    return new Map();
  }
  const index = new Map();
  doc.entries.forEach((e, i) => {
    const bad = !e || typeof e !== 'object' ||
      typeof e.file !== 'string' || e.file === '' ||
      !Number.isInteger(e.line) || e.line < 1 ||
      typeof e.rule !== 'string' || e.rule === '' ||
      typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(e.sha256) ||
      (e.context !== undefined && (typeof e.context !== 'string' || !/^[0-9a-f]{64}$/i.test(e.context)));
    if (bad) {
      degraded.push({ file: ALLOWLIST_PATH, kind: 'allowlist-entry-invalid', detail: 'entries[' + i + '] needs {file, line>=1, rule, 64-hex sha256, 64-hex context}' });
      return;
    }
    // A missing context is not a parse error, it is an entry that can never
    // fire -- kept in the index on purpose so the line it points at is named by
    // number when it matches, instead of vanishing into a generic complaint
    // about the file. Degradation means "did not manage to scan"; this scan ran
    // fine, one exemption in it is simply inert.

    // A rule id nobody implements can never fire. It reads like an exemption and
    // is one only in the ledger, so it accumulates silently forever.
    if (!RULE_IDS.has(e.rule)) {
      degraded.push({ file: ALLOWLIST_PATH, kind: 'allowlist-entry-invalid', detail: 'entries[' + i + '] names rule "' + e.rule.slice(0, 40) + '", which does not exist' });
      return;
    }
    const key = e.file + NUL + e.line + NUL + e.rule;
    if (index.has(key)) {
      // The second copy used to overwrite the first without a word, so two
      // entries disagreeing about the same line resolved by file order.
      degraded.push({ file: ALLOWLIST_PATH, kind: 'allowlist-entry-duplicate', detail: 'entries[' + i + '] repeats ' + e.file + ':' + e.line + ' ' + e.rule });
      return;
    }
    index.set(key, {
      sha256: e.sha256.toLowerCase(),
      context: typeof e.context === 'string' ? e.context.toLowerCase() : null,
      reason: typeof e.reason === 'string' ? e.reason : '',
      used: false,
      matched: false,
    });
  });
  return index;
}

const allowIndex = loadAllowlist();

const findings = [];
const allowlisted = [];
const scannedFiles = new Set();
let scanned = 0;
let prohibitionSkips = 0;
let crlfNormalizedFiles = 0;

for (const f of targets) {
  let text;
  try {
    if (fromIndex) {
      const buf = indexContent(f);
      if (buf.length > MAX_BYTES) {
        degraded.push({ file: f, kind: 'oversized-file', detail: buf.length + ' bytes, over 1 MB, not scanned' });
        continue;
      }
      text = buf.toString('utf8');
    } else {
      const st = fs.statSync(f);
      if (!st.isFile()) {
        degraded.push({ file: f, kind: 'not-a-regular-file', detail: 'listed but not a regular file, not scanned' });
        continue;
      }
      if (st.size > MAX_BYTES) {
        degraded.push({ file: f, kind: 'oversized-file', detail: st.size + ' bytes, over 1 MB, not scanned' });
        continue;
      }
      text = fs.readFileSync(f, 'utf8');
    }
  } catch (e) {
    degraded.push({ file: f, kind: 'unreadable-file', detail: oneLine((e && e.code) || e).slice(0, 120) });
    continue;
  }
  scanned++;
  scannedFiles.add(f);

  // A UTF-8 BOM at offset 0 is an editor encoding artifact, not hidden content.
  // Stripped before scanning so hidden-characters stays a real signal -- and
  // recorded in notes, because a silent strip is a silent behaviour change.
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
    notes.push({ file: f, note: 'utf8-bom-stripped-before-scan' });
  }

  // core.autocrlf=true (the Git for Windows install default) checks every line
  // out with a trailing \r, and hashing that byte into the allowlist binding
  // made every entry in this file fail on such a checkout (TODO #73) -- the
  // scan itself stayed correct, only the exemptions stopped applying, so a
  // clean repository read as broken. Normalized here, before the line split, so
  // the finding line numbers, the allowlist sha256/context and REHASH_CMD all
  // agree regardless of checkout line endings. Only the \r\n pair is touched: a
  // lone \r with nothing after it is left on the line on purpose and still
  // counts toward its hash, so a line whose exemption was signed before that
  // byte landed in it stops matching and the exemption lapses -- erring toward
  // blocking a changed line rather than quietly keeping its old signature. Counted
  // rather than noted per file, because on a CRLF checkout every scanned file
  // hits this -- one note per file would bury the notes that are actually
  // informative; the tally goes out as a single summary note below.
  if (text.indexOf('\r\n') !== -1) {
    text = text.replace(/\r\n/g, '\n');
    crlfNormalizedFiles++;
  }

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      // An exception only clears the finding if removing the excepted text also
      // removes the match; anything else in the line still counts.
      if (rule.except && rule.except.test(line) && !rule.re.test(line.replace(rule.exceptAll, ''))) continue;
      if (rule.affirmativeOnly) {
        const clause = line.slice(0, m.index).split(CLAUSE_BREAK).pop();
        if (PROHIBITION.test(clause)) { prohibitionSkips++; continue; }
      }
      let raw = line;
      if (rule.redact) raw = redactMatch(line, rule.re);
      else if (rule.maskUrl) raw = maskUrlCredentials(line);
      const hit = {
        file: f,
        line: i + 1,
        rule: rule.id,
        severity: rule.severity,
        excerpt: reveal(raw.trim()).slice(0, 160),
      };
      // The hash is of this line's exact bytes, so an exemption survives the
      // file moving around it but never survives the line itself changing; the
      // context hash extends that to the lines on either side, and both have to
      // hold. An entry that binds only the bytes gets its note and then the
      // finding: it says "this line was reviewed", which stops being true the
      // moment the fence around it is deleted, so it is not an exemption any
      // more -- and a note beside a still-silent finding would be a warning
      // nobody has to act on.
      const entry = allowIndex.get(f + NUL + (i + 1) + NUL + rule.id);
      if (entry && entry.sha256 === sha256(line)) {
        entry.matched = true;
        if (entry.context === null) {
          notes.push({ file: f, note: 'allowlist-entry-not-context-bound:' + (i + 1) + ':' + rule.id });
        } else if (entry.context !== windowSha(lines, i)) {
          notes.push({ file: f, note: 'allowlist-context-changed:' + (i + 1) + ':' + rule.id });
        } else {
          entry.used = true;
          hit.reason = entry.reason;
          allowlisted.push(hit);
          continue;
        }
      }
      findings.push(hit);
    }
  }
}

// One summary note for the whole run, not one per file: see the comment at the
// normalization site above for why per-file would drown out everything else.
if (crlfNormalizedFiles > 0) {
  notes.push({ file: '(scope)', note: 'crlf-normalized-before-scan:files=' + crlfNormalizedFiles });
}

// "Nothing to scan" and "did not manage to scan" are different answers and must
// not share an exit code in either direction. A commit that touches only source
// files carries no instruction file, and calling that a degradation would put a
// warning on every such commit -- a gate that is always amber is a gate people
// learn to scroll past.
for (const p of missingPaths) {
  degraded.push({
    file: p,
    kind: 'path-not-found',
    detail: '--paths named it but the ' + (fromIndex ? 'index' : 'working tree') + ' does not have it; not scanned',
  });
}
if (targets.length === 0) {
  notes.push({ file: '(scope)', note: 'nothing-in-scope:listed=' + candidates.length + ' in-scope=0' });
}
// The one empty listing that IS a defect: tracked mode found nothing while the
// repository demonstrably holds files. That is the listing no longer describing
// this repository, which is exactly how the subdirectory bug read from outside.
if (source === 'tracked' && candidates.length === 0) {
  const head = headFileCount();
  if (head > 0) {
    degraded.push({
      file: '(scope)',
      kind: 'listing-empty-but-repo-nonempty',
      detail: 'git listed 0 tracked paths but HEAD holds ' + head + '; the file list is not describing this repository',
    });
  }
}

// Stale only counts for files this run actually read. In --staged mode most of
// the ledger is simply out of scope, and calling that "no longer matches" would
// train the reader to skip the one note that means something. An entry whose
// line still matches but whose binding did not hold is not stale either: it was
// named by line number in the notes, and telling its owner to re-hash the line
// would send them to fix the one thing that is still correct.
const allowUnused = [];
for (const [key, entry] of allowIndex) {
  if (entry.used || entry.matched) continue;
  const parts = key.split(NUL);
  if (!scannedFiles.has(parts[0])) {
    // An entry pointing at a file the repository does not have can never fire
    // and can never go stale either, so it used to be invisible in both
    // directions. Only decidable when the full tracked list is in hand.
    if (source === 'tracked' && !candidates.includes(parts[0])) {
      notes.push({ file: parts[0], note: 'allowlist-entry-orphan:' + parts[1] + ':' + parts[2] });
    }
    continue;
  }
  allowUnused.push({ file: parts[0], line: Number(parts[1]), rule: parts[2], nextStep: REHASH_CMD });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const errors = findings.filter(f => f.severity === 'error');
const warnings = findings.length - errors.length;
const messageById = Object.fromEntries(RULES.map(r => [r.id, r.message]));

if (!opts.json) {
  for (const f of findings) {
    err((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.rule.padEnd(26) +
      f.file + ':' + f.line + '  ' + f.excerpt + '\n');
    if (messageById[f.rule]) err('       ^ ' + messageById[f.rule] + '\n');
  }
  // Exemptions are printed at the same volume as findings. An exemption nobody
  // sees is indistinguishable from a rule that never fired.
  for (const a of allowlisted) {
    err(' allow ' + a.rule.padEnd(25) + a.file + ':' + a.line + '  ' + a.excerpt + '\n');
    err('       ^ exempted by ' + ALLOWLIST_PATH + (a.reason ? ' -- ' + a.reason : '') + '\n');
  }
  for (const d of degraded) {
    err(' DEGR  ' + d.kind.padEnd(26) + '  ' + d.file + '  ' + d.detail +
      '  (not scanned is not the same as clean)\n');
  }
  for (const u of allowUnused) {
    err(' note  ' + 'allowlist-entry-unused'.padEnd(26) + u.file + ':' + u.line +
      '  ' + u.rule + ' no longer matches; delete the entry, or re-read the line where it now sits'
      + ' and re-sign it with all three of {line, sha256, context}\n');
    err('       ^ ' + u.nextStep + '\n');
    err('       ^ ' + README_PATH + ' -- see the allowlist section\n');
  }
  for (const n of notes) err(' note  ' + n.note.padEnd(26) + '  ' + n.file + '\n');
  if ((source === 'paths' || source === 'staged+paths') && skipped.length) {
    err(' note  ' + 'not-an-instruction-file'.padEnd(26) + skipped.length +
      ' given path(s) skipped: ' + skipped.slice(0, 5).join(' ') + (skipped.length > 5 ? ' ...' : '') + '\n');
  }
  err('scan-instructions: source=' + source + ' root=' + (root === null ? '(none)' : root) +
    ' listed=' + candidates.length + ' in-scope=' + targets.length +
    ' scanned=' + scanned + ' errors=' + errors.length + ' warnings=' + warnings +
    ' allowlisted=' + allowlisted.length + ' prohibition-skips=' + prohibitionSkips +
    ' degraded=' + degraded.length + '\n');
}

// Every list is capped, not just findings: an unbounded degraded or notes array
// is the same denial-of-reading problem in a different field.
const truncatedLists = [];
for (const [name, list] of [['allowlisted', allowlisted], ['allowlistUnused', allowUnused],
  ['degraded', degraded], ['notes', notes]]) {
  if (list.length > MAX_REPORTED) truncatedLists.push(name);
}

out(JSON.stringify({
  command: 'scan-instructions',
  // Degraded counts against ok for the same reason a skipped class does: the
  // question this script answers is "was the scope scanned and clean", and an
  // unscanned file makes the first half false.
  ok: errors.length === 0 && degraded.length === 0,
  source,
  root,
  listed: candidates.length,
  inScope: targets.length,
  scanned,
  findings: findings.slice(0, MAX_REPORTED),
  truncated: findings.length > MAX_REPORTED,
  truncatedLists,
  allowlisted: allowlisted.slice(0, MAX_REPORTED),
  allowlistUnused: allowUnused.slice(0, MAX_REPORTED),
  degraded: degraded.slice(0, MAX_REPORTED),
  notes: notes.slice(0, MAX_REPORTED),
  counts: {
    error: errors.length,
    warning: warnings,
    allowlisted: allowlisted.length,
    prohibitionSkips,
    degraded: degraded.length,
  },
}) + '\n');

// Findings outrank degradation: a real hit is the more actionable answer, and
// exit 1 is what the git hook already blocks on.
process.exitCode = errors.length > 0 ? 1 : (degraded.length > 0 ? 3 : 0);
