// lib.mjs -- the CLI and git scaffolding every audit script repeats.
//
// check-syntax, scan-instructions and scan-secrets each need the same few
// things: one flag parser, a stderr contract, and a way to ask git what is in
// scope and what the index holds. Three copies of that drift -- a staged-bytes
// fix that lands in one copy and not the others leaves two scanners disagreeing
// about which bytes they even looked at.
//
// Node builtins only, deliberately: this family has to keep running when the
// engine it audits is broken, so nothing here may reach into harness/lib.
//
// Source is ASCII-only.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const NUL = String.fromCharCode(0);

// Synchronous writes: process.stdout.write to a pipe is async and a following
// exit can truncate it. A truncated JSON line would be an invisible failure.
export function out(s) { try { fs.writeSync(1, s); } catch (_e) { process.stdout.write(s); } }
export function err(s) { try { fs.writeSync(2, s); } catch (_e) { process.stderr.write(s); } }

/** git's own diagnostics are multi-line; a diagnostic line that wraps is unreadable. */
export function oneLine(s) {
  return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * The shared --staged/--paths/--json front end. Bound to the script name so a
 * usage line still names the command the caller actually ran.
 */
export function makeCli(name) {
  const USAGE = '\nusage: ' + name + '.mjs [--staged] [--paths a,b] [--json]\n';

  function parseArgs(argv) {
    const opts = { staged: false, json: false, paths: null };
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--staged') opts.staged = true;
      else if (a === '--json') opts.json = true;
      else if (a === '--paths') {
        // A dangling --paths would mean "check nothing", which prints as a clean
        // run over a file set that was never given. The same trap eats a
        // following flag.
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('-')) return { usage: '--paths needs a comma-separated value' };
        opts.paths = v;
        i++;
      } else if (a.startsWith('--paths=')) {
        opts.paths = a.slice('--paths='.length);
        if (opts.paths === '') return { usage: '--paths= needs a comma-separated value' };
      } else return { error: a };
    }
    if (opts.paths !== null && opts.paths.split(',').map(s => s.trim()).filter(Boolean).length === 0) {
      return { usage: '--paths resolved to an empty file set' };
    }
    return opts;
  }

  function usageExit(msg) {
    err(name + ': ' + msg + USAGE);
    process.exit(2);
  }

  return { parseArgs, usageExit };
}

/** @returns {string|null} absolute repository root, or null if this is not one. */
export function repoRoot() {
  try {
    const r = execFileSync('git', ['rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return r || null;
  } catch (_e) {
    return null;
  }
}

/**
 * Repository-relative and slash-separated, or null when the path is outside.
 * Takes the root explicitly: the caller resolves it once, and a helper that
 * guessed its own would answer for a different tree than the one being scanned.
 */
export function toRepoRelative(root, abs) {
  if (root === null) return null;
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/** @returns {string[]|null} null means git refused to list. */
export function gitFileList(staged) {
  const args = staged
    ? ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']
    : ['-c', 'core.quotePath=false', 'ls-files', '-z'];
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split(NUL).filter(Boolean);
  } catch (_e) {
    return null;
  }
}

/**
 * How many paths HEAD's tree holds. Only used to tell two very different things
 * apart when the listing comes back empty: a repository that genuinely has no
 * tracked file (fine) versus a listing that stopped describing this repository
 * (the subdirectory bug, and anything like it in future).
 * @returns {number} -1 when there is no HEAD to ask.
 */
export function headFileCount() {
  try {
    const raw = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', '-z', 'HEAD'],
      { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
    return raw.split(NUL).filter(Boolean).length;
  } catch (_e) {
    return -1;
  }
}

/** Everything the index holds, for existence questions that must not consult the disk. */
let indexCache = null;
export function indexSet() {
  if (indexCache === null) {
    indexCache = new Set(gitFileList(false) || []);
  }
  return indexCache;
}

/**
 * Contents of a path AS STAGED. Taking names from the index and bytes from the
 * working tree is wrong in both directions at once: a payload staged and then
 * wiped from disk goes unreported, and one that exists only on disk blocks a
 * commit that does not contain it.
 * @returns {Buffer} throws if the blob cannot be read.
 */
export function indexContent(p) {
  return execFileSync('git', ['-c', 'core.quotePath=false', 'show', ':' + p],
    { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}
