#!/usr/bin/env node
// scan-secrets.mjs -- credential literals across the commit surface.
//
// Division of labour with the engine's `fitness` rule `no-secret-literal`:
//   fitness        graded five-attribute scan, runs INSIDE the verify gate, obeys
//                  module risk tiers from module-catalog.json, and goes silent for
//                  a module that declared the attribute `none`. It answers
//                  "does this module hold the evidence its tier demands?".
//   scan-secrets   ungraded, catalog-free backstop for git hooks and CI. It has no
//                  tiers to obey and nothing to turn it off, and it still runs when
//                  the catalog is absent or the engine is broken. It answers
//                  "is a credential about to be committed, yes or no?".
// The overlap is deliberate: the graded scan can be tuned down per module, so the
// ungraded one exists to make sure nothing can tune the floor away.
//
// Usage:
//   node .claude/harness/audit/scan-secrets.mjs [--staged] [--json]
//     --staged   scan the staged set: names AND contents come from the index
//     --json     machine mode: stdout JSON only, no human lines on stderr
//
// Contract: stdout is always ONE line of JSON; human diagnostics go to stderr.
//   exit 0  everything in scope was scanned and no credential-shaped literal found
//   exit 1  at least one found
//   exit 2  usage error (unknown flag)
//   exit 3  degraded: not a git repository, nothing in scope at all, or something
//           in scope could not be scanned (oversized, unreadable). A file nobody
//           read is not a clean file, and the two must not share an exit code.
//
// Every path is anchored to the repository root, not to the caller's directory.
// `git ls-files` run from a subdirectory lists only that subtree and names it
// relative to that subdirectory, so running this from `.claude/` used to report
// exit 0 ok:true on a repository holding a committed token. Working directory is
// not supposed to be part of a security verdict.
//
// The inline `scan-secrets:ignore` marker stays -- unlike an instruction file, a
// source file is not itself the threat model here -- but every line it silences
// is counted and listed. Suppression that leaves no trace is a hole nobody can
// audit, and a repository that looks clean because of it is lying quietly.
//
// Source is ASCII-only. Node builtins only. No import of harness.mjs, on purpose:
// this must keep working when the engine does not.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { out, err, oneLine, repoRoot, gitFileList, headFileCount, indexContent } from './lib.mjs';

const NUL = String.fromCharCode(0);

// ---------------------------------------------------------------------------
// Patterns. `confident` shapes are credential formats that have no innocent
// reading; the single `heuristic` shape is a name/value guess and needs both
// context filtering and a judgement about the VALUE (see literalValue).
//
// The confident table is where the value of this scanner actually lives, so it
// tracks the formats currently in circulation rather than the 2021 shortlist:
// a table that knows `ghp_` but not `sk-ant-` or `github_pat_` reports clean on
// most of what leaks today.
// ---------------------------------------------------------------------------
const SECRET_PATTERNS = [
  { id: 'private-key-block', confident: true, re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'github-token', confident: true, re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { id: 'github-fine-grained-pat', confident: true, re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { id: 'gitlab-token', confident: true, re: /\bglpat-[A-Za-z0-9_-]{16,}/ },
  { id: 'anthropic-key', confident: true, re: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { id: 'openai-project-key', confident: true, re: /\bsk-proj-[A-Za-z0-9_-]{16,}/ },
  { id: 'openai-style-key', confident: true, re: /\bsk-[A-Za-z0-9]{20,}/ },
  { id: 'google-api-key', confident: true, re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { id: 'huggingface-token', confident: true, re: /\bhf_[A-Za-z0-9]{30,}/ },
  { id: 'npm-token', confident: true, re: /\bnpm_[A-Za-z0-9]{30,}/ },
  { id: 'aws-access-key-id', confident: true, re: /\bAKIA[0-9A-Z]{16}\b/ },
  // The 40-character secret has no prefix of its own -- only the name it is
  // filed under makes it recognisable, which is why it needs its own entry
  // instead of leaning on the generic rule.
  { id: 'aws-secret-access-key', confident: true, re: /aws_secret_access_key\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})/i, valueGroup: 1 },
  { id: 'slack-token', confident: true, re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'stripe-live-key', confident: true, re: /\b(?:sk|pk|rk)_live_[A-Za-z0-9]{12,}/ },
  // A JWT is three dot-separated base64url segments starting from a JSON header,
  // and it is also the reason the generic rule below refuses values containing a
  // dot: without this entry, excluding dots would open a hole instead of closing
  // false positives.
  { id: 'jwt', confident: true, re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // A URL that carries the credential inside itself: the userinfo segment that
  // sits between the scheme and the host. It leaks the same way a token does and
  // is the shape a connection string arrives in, which is why the format table
  // needs it explicitly -- none of the prefix rules above sees it.
  // The scheme is any scheme, not http(s): the credential-bearing URL that reaches
  // a repository is far more often postgres://, mongodb://, redis:// or amqp://
  // than it is a web address, and a rule spelled `https?` reads clean on every one
  // of them. An explicit scheme is still required, so the SSH form git@host:path
  // and the protocol-relative //user:pass@host stay out of this rule's reach.
  // The user part excludes ':' and the password part excludes '/', so a plain
  // host, a host with a user and no password, and a port followed by a path
  // holding an at-sign all stay quiet; the lazy \S+:\S+@ spelling reports the
  // port form as a credential and gets switched off within a week.
  { id: 'url-userinfo', confident: true, re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s@:"]+:[^/\s@"]+@/i },
  {
    id: 'generic-assignment',
    confident: false,
    // Name and value are captured separately because the whole judgement is
    // about the value: group 2 is a quoted string, group 3 a bare token.
    re: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*(?:(["'])([^"'\s]{12,})\1|([^"'\s]{12,}))/i,
    valueGroup: [2, 3],
    literalOnly: true,
  },
];

// Context words that mark a value as illustrative rather than real. Applied ONLY to
// heuristic patterns: a real ghp_ token does not stop being a token because the word
// "example" appears elsewhere on the line, and the reference implementation this was
// modelled on lets exactly that false negative through.
const PLACEHOLDER_CONTEXT = /example|sample|placeholder|dummy|redacted|changeme|xxxx|your[-_]|<[^>]+>|\$\{|process\.env|os\.environ|getenv|System\.getenv/i;

// ---------------------------------------------------------------------------
// Is this value a literal, or is it an expression that READS a secret?
//
// `configuration.credentials`, `derive_secret(master, salt)`, `readFromVault()`,
// `/run/secrets/api_key_file` and `os.environ["X"]` are all the correct way to
// handle a credential, and none of them is one. The old rule approximated this
// with "the value must be quoted"; relaxing the quotes without replacing the
// approximation is what took this rule from 62 to 351 hits on 1.9M lines of
// secret-free code, with zero true positives in the sample.
//
// Measured on 2.5M lines of python stdlib / dist-packages / node_modules with no
// credentials in it: 277 hits before, 4 after (see README).
// ---------------------------------------------------------------------------
const BARE_LITERAL = /^[A-Za-z0-9_+=-]+$/;

/** Letters AND digits AND enough distinct characters: a cheap stand-in for entropy. */
function credentialShaped(v) {
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return false;
  const seen = new Set();
  for (const ch of v.split('')) seen.add(ch);
  return seen.size >= 6;
}

/** @returns {string|null} the value if it is a credential-shaped literal. */
function literalValue(m) {
  const quoted = m[2] !== undefined;
  const v = quoted ? m[2] : m[3];
  if (v === undefined) return null;
  // A bare value carrying `.` `(` `[` `$` `/` and friends is an expression, a
  // path or a variable reference, never a token somebody pasted.
  if (!quoted && !BARE_LITERAL.test(v)) return null;
  // Prose examples ("the-value-you-copied") are words, not credentials.
  if (!credentialShaped(v)) return null;
  return v;
}

// Files whose whole purpose is to carry a fake value.
const ALLOWLIST_FILE = [
  /\.example$/i, /\.sample$/i, /\.template$/i,
  /(^|\/)\.env\.example$/i,
];

// Extensions never worth reading as text; NUL sniffing catches the rest.
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf',
  '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.jar', '.war',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.webm',
  '.bin', '.exe', '.dll', '.so', '.dylib', '.class', '.wasm',
]);

const SUPPRESS = /scan-secrets:ignore/;
const MAX_BYTES = 1024 * 1024;
const MAX_REPORTED = 200;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { staged: false, json: false };
  for (const a of argv) {
    if (a === '--staged') opts.staged = true;
    else if (a === '--json') opts.json = true;
    else return { error: a };
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.error) {
  process.stderr.write('scan-secrets: unknown argument ' + opts.error +
    '\nusage: scan-secrets.mjs [--staged] [--json]\n');
  process.exit(2);
}

const root = repoRoot();
if (root === null) {
  err('scan-secrets: not a git repository; refusing to guess the file set\n');
  process.exit(3);
}
// Everything downstream -- listing, reading, reporting -- now shares one origin.
try {
  process.chdir(root);
} catch (e) {
  err('scan-secrets: cannot enter repository root ' + root + ': ' + oneLine((e && e.code) || e) + '\n');
  process.exit(3);
}

/**
 * Paths recorded with mode 160000: submodules. A gitlink has no bytes in this
 * repository at all, so it is out of scope in the same way a binary is -- not
 * something that failed to be scanned. Reported as degraded it made every run of
 * a repository with a submodule exit 3 forever, and a gate that is always red is
 * a gate everybody learns to ignore. Resolved lazily: only a candidate that
 * already looks odd is worth a second git call.
 */
let gitlinkCache = null;
function isGitlink(p) {
  if (gitlinkCache === null) {
    gitlinkCache = new Set();
    try {
      const raw = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-s', '-z'],
        { encoding: 'utf8', maxBuffer: 1 << 28 });
      for (const rec of raw.split(NUL)) {
        if (!rec.startsWith('160000 ')) continue;
        const tab = rec.indexOf('\t');
        if (tab > 0) gitlinkCache.add(rec.slice(tab + 1));
      }
    } catch (_e) {
      // No listing means no gitlink knowledge; callers fall back to degraded,
      // which is the conservative direction.
    }
  }
  return gitlinkCache.has(p);
}

const files = gitFileList(opts.staged);
if (files === null) {
  err('scan-secrets: git refused to list the file set\n');
  process.exit(3);
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------
/** A scanner that prints the secret it found has published it a second time. */
function redactMatch(line, re) {
  const m = re.exec(line);
  if (!m) return line;
  const hit = m[0];
  return line.split(hit).join(hit.slice(0, 4) + '<REDACTED:' + hit.length + '>');
}

/**
 * Mask the VALUE and keep the name. Redacting the whole `name=value` match left
 * excerpts like `pass<REDACTED:44>`: a blocking error nobody can locate, which
 * is how a real finding gets waved through as noise.
 */
function redactValue(line, m, value) {
  const rel = m[0].lastIndexOf(value);
  if (rel < 0) return line.split(m[0]).join('<REDACTED:' + m[0].length + '>');
  const at = m.index + rel;
  return line.slice(0, at) + '<REDACTED:' + value.length + '>' + line.slice(at + value.length);
}

const findings = [];
const suppressed = [];
const degraded = [];
const notes = [];
let scanned = 0;
let skippedBinary = 0;
let skippedAllowlisted = 0;
let skippedSubmodule = 0;

for (const f of files) {
  if (ALLOWLIST_FILE.some(re => re.test(f))) { skippedAllowlisted++; continue; }
  if (BINARY_EXT.has(path.extname(f).toLowerCase())) { skippedBinary++; continue; }

  let text;
  try {
    if (opts.staged) {
      if (isGitlink(f)) { skippedSubmodule++; continue; }
      const buf = indexContent(f);
      if (buf.length > MAX_BYTES) {
        degraded.push({ file: f, kind: 'oversized-file', detail: buf.length + ' bytes, over 1 MB, not scanned' });
        continue;
      }
      if (buf.indexOf(0) >= 0) { skippedBinary++; continue; }
      text = buf.toString('utf8');
    } else {
      const st = fs.statSync(f);
      if (!st.isFile()) {
        if (isGitlink(f)) { skippedSubmodule++; continue; }
        degraded.push({ file: f, kind: 'not-a-regular-file', detail: 'listed but not a regular file, not scanned' });
        continue;
      }
      if (st.size > MAX_BYTES) {
        // Degraded, not swallowed and not a warning either: a 2 MB file holding
        // a live token used to come out as exit 0 ok:true, which reads as "this
        // repository is clean" when what happened is that nobody looked.
        degraded.push({ file: f, kind: 'oversized-file', detail: st.size + ' bytes, over 1 MB, not scanned' });
        continue;
      }
      text = fs.readFileSync(f, 'utf8');
      if (text.indexOf(NUL) >= 0) { skippedBinary++; continue; }
    }
  } catch (e) {
    if (isGitlink(f)) { skippedSubmodule++; continue; }
    degraded.push({ file: f, kind: 'unreadable-file', detail: oneLine((e && e.code) || e).slice(0, 120) });
    continue;
  }

  scanned++;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const muted = SUPPRESS.test(line) || (i > 0 && SUPPRESS.test(lines[i - 1]));
    for (const p of SECRET_PATTERNS) {
      const m = p.re.exec(line);
      if (!m) continue;
      if (!p.confident && PLACEHOLDER_CONTEXT.test(line)) continue;
      let value = null;
      if (p.literalOnly) {
        value = literalValue(m);
        if (value === null) continue;
      } else if (typeof p.valueGroup === 'number') {
        value = m[p.valueGroup];
      }
      if (muted) {
        // Recorded without the excerpt: the point is that someone silenced this
        // line, not to reprint the credential that got silenced.
        suppressed.push({ file: f, line: i + 1, rule: p.id });
        continue;
      }
      findings.push({
        file: f,
        line: i + 1,
        rule: p.id,
        severity: 'error',
        excerpt: (value === null || value === undefined
          ? redactMatch(line, p.re)
          : redactValue(line, m, value)).trim().slice(0, 160),
      });
    }
  }
}

// "Nothing to scan" and "did not manage to scan" are different answers and must
// not share an exit code. An empty staged set is what a commit that stages
// nothing looks like, and a repository of nothing but images has no text to
// read -- neither is a governance failure, and marking them degraded would put
// a permanent amber light on ordinary work.
const inScope = files.length - skippedAllowlisted - skippedBinary - skippedSubmodule;
if (inScope <= 0) {
  notes.push({ file: '(scope)', note: 'nothing-in-scope:listed=' + files.length + ' in-scope=0' });
}
// The one empty listing that IS a defect: tracked mode found nothing while the
// repository demonstrably holds files. That is the listing no longer describing
// this repository, which is exactly how the subdirectory bug read from outside.
if (!opts.staged && files.length === 0) {
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
const errors = findings.filter(f => f.severity === 'error');
const warnings = findings.length - errors.length;

if (!opts.json) {
  for (const f of findings) {
    err((f.severity === 'error' ? ' ERR  ' : ' warn ') + f.rule.padEnd(24) +
      f.file + ':' + f.line + '  ' + f.excerpt + '\n');
  }
  for (const s of suppressed) {
    err(' mute  ' + s.rule.padEnd(24) + s.file + ':' + s.line +
      '  silenced by scan-secrets:ignore\n');
  }
  for (const d of degraded) {
    err(' DEGR  ' + d.kind.padEnd(24) + '  ' + d.file + '  ' + d.detail +
      '  (not scanned is not the same as clean)\n');
  }
  for (const n of notes) err(' note  ' + n.note.padEnd(24) + '  ' + n.file + '\n');
  err('scan-secrets: source=' + (opts.staged ? 'staged' : 'tracked') +
    ' root=' + root +
    ' listed=' + files.length + ' in-scope=' + inScope + ' scanned=' + scanned +
    ' skipped-binary=' + skippedBinary + ' skipped-allowlisted=' + skippedAllowlisted +
    ' skipped-submodule=' + skippedSubmodule +
    ' errors=' + errors.length + ' warnings=' + warnings +
    ' suppressed=' + suppressed.length + ' degraded=' + degraded.length + '\n');
}

const truncatedLists = [];
if (suppressed.length > MAX_REPORTED) truncatedLists.push('suppressed');
if (degraded.length > MAX_REPORTED) truncatedLists.push('degraded');

out(JSON.stringify({
  command: 'scan-secrets',
  // Degraded counts against ok: "no credential found" is only an answer if the
  // scope was actually read.
  ok: errors.length === 0 && degraded.length === 0,
  source: opts.staged ? 'staged' : 'tracked',
  root,
  listed: files.length,
  inScope,
  scanned,
  skipped: { binary: skippedBinary, allowlisted: skippedAllowlisted, submodule: skippedSubmodule },
  findings: findings.slice(0, MAX_REPORTED),
  truncated: findings.length > MAX_REPORTED,
  truncatedLists,
  suppressed: suppressed.slice(0, MAX_REPORTED),
  degraded: degraded.slice(0, MAX_REPORTED),
  notes: notes.slice(0, MAX_REPORTED),
  counts: {
    error: errors.length,
    warning: warnings,
    suppressed: suppressed.length,
    degraded: degraded.length,
  },
}) + '\n');

// Findings outrank degradation: a real hit is the more actionable answer, and
// exit 1 is what the git hook already blocks on.
process.exitCode = errors.length > 0 ? 1 : (degraded.length > 0 ? 3 : 0);
