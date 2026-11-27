// # risk: high
// Unified cross-platform test runner for cursor-base (Node >= 20, zero external dependencies).
// Usage: node .cursor/tests/run-all.mjs [--level smoke|unit|integration|high|medium|low|all] [--dir <testsDir>] [--ledger <jsonlPath>]
// Exit codes:
//   0 = all matched tests passed (with >= 1 real PASS execution and 0 FAIL)
//   1 = one or more test cases or suites failed
//   2 = invalid arguments OR empty/all-skipped execution set (never fake green)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..', '..');
const DEFAULT_TMP_LEDGER = path.join(os.tmpdir(), 'cursor-base-test-ledger.jsonl');

const ALLOWED_LEVELS = new Set([
  'smoke',
  'unit',
  'integration',
  'high',
  'medium',
  'low',
  'all',
]);

const EXPECTED_TYPO_SUBCOMMANDS = [
  'package',
  'pack',
  'bundle',
  'check',
  'verify',
  'test',
  'tests',
  'lint',
  'audit',
  'status',
  'init',
  'update',
  'remove',
  'clean',
  'version',
];

function usageText() {
  return [
    'Usage: node .cursor/tests/run-all.mjs [--level smoke|unit|integration|high|medium|low|all] [--dir <testsDir>] [--ledger <jsonlPath>]',
    'Exit codes: 0=pass  1=fail  2=usage/empty-set',
  ].join('\n');
}

function parseArgs(argv) {
  let level = 'all';
  let dir = THIS_DIR;
  let ledger = process.env.CURSOR_TEST_LEDGER || DEFAULT_TMP_LEDGER;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      help = true;
    } else if (a === '--level') {
      const v = argv[++i];
      if (!v || v.startsWith('-')) {
        return { error: '--level requires a value (smoke|unit|integration|high|medium|low|all)' };
      }
      level = v.toLowerCase();
    } else if (a.startsWith('--level=')) {
      level = a.slice('--level='.length).toLowerCase();
    } else if (a === '--dir') {
      const v = argv[++i];
      if (!v || v.startsWith('-')) return { error: '--dir requires a directory path' };
      dir = path.resolve(v);
    } else if (a.startsWith('--dir=')) {
      const v = a.slice('--dir='.length);
      if (!v) return { error: '--dir= requires a non-empty directory path' };
      dir = path.resolve(v);
    } else if (a === '--ledger') {
      const v = argv[++i];
      if (!v || v.startsWith('-')) return { error: '--ledger requires a file path' };
      ledger = path.resolve(v);
    } else if (a.startsWith('--ledger=')) {
      const v = a.slice('--ledger='.length);
      if (!v) return { error: '--ledger= requires a non-empty file path' };
      ledger = path.resolve(v);
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }

  if (help) return { help: true };
  if (!ALLOWED_LEVELS.has(level)) {
    return { error: `invalid --level "${level}" (expected smoke|unit|integration|high|medium|low|all)` };
  }
  return { level, dir, ledger, help: false };
}

function extractHeaderMeta(filePath) {
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { risk: 'high', levels: null };
  }
  const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const headLines = clean.split(/\r?\n/).slice(0, 8);
  let risk = 'high';
  let levels = null;
  for (const line of headLines) {
    const rm = /^\s*(?:\/\/\s*#?\s*|#\s*#?\s*)risk\s*:\s*(high|medium|low)\b/i.exec(line);
    if (rm) risk = rm[1].toLowerCase();
    const lm = /^\s*(?:\/\/\s*#?\s*|#\s*#?\s*)levels\s*:\s*([a-z,\s]+)$/i.exec(line);
    if (lm) {
      levels = new Set(
        lm[1]
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      );
    }
  }
  return { risk, levels };
}

function matchesLevel(meta, requestedLevel) {
  if (requestedLevel === 'all' || requestedLevel === 'low') return true;
  if (requestedLevel === 'smoke' || requestedLevel === 'unit' || requestedLevel === 'integration') {
    if (meta.levels && meta.levels.size > 0) {
      return meta.levels.has(requestedLevel);
    }
    return true;
  }
  if (requestedLevel === 'medium') return meta.risk === 'high' || meta.risk === 'medium';
  return meta.risk === 'high';
}

function parseTapCases(tapOutput) {
  const lines = String(tapOutput || '').replace(/\r\n/g, '\n').split('\n');
  const cases = [];
  const suiteStack = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const subMatch = /^(\s*)# Subtest:\s*(.+)$/.exec(line);
    if (subMatch) {
      const depth = Math.floor(subMatch[1].length / 4);
      suiteStack.length = depth;
      suiteStack[depth] = subMatch[2].trim();
      continue;
    }

    const resMatch = /^(\s*)(ok|not ok)\s+\d+(?:\s+-\s+(.*))?$/.exec(line);
    if (!resMatch) continue;

    const indent = resMatch[1].length;
    const depth = Math.floor(indent / 4);
    const ok = resMatch[2] === 'ok';
    const rawDesc = (resMatch[3] || '').trim();

    let isSuite = false;
    let durationMs = null;
    if (i + 1 < lines.length && /^\s*---\s*$/.test(lines[i + 1])) {
      let j = i + 2;
      while (j < lines.length && !/^\s*\.\.\.\s*$/.test(lines[j])) {
        const typeMatch = /^\s*type:\s*['"]?([A-Za-z0-9_-]+)['"]?\s*$/.exec(lines[j]);
        if (typeMatch && typeMatch[1] === 'suite') isSuite = true;
        const durMatch = /^\s*duration_ms:\s*([0-9.]+)\s*$/.exec(lines[j]);
        if (durMatch) durationMs = Number(durMatch[1]);
        j += 1;
      }
      i = j;
    }

    if (isSuite) continue;

    const skipMatch = /^(.*?)\s+#\s*(SKIP|TODO)\b(.*)$/i.exec(rawDesc);
    let cleanDesc = skipMatch ? skipMatch[1].trim() : rawDesc;
    cleanDesc = cleanDesc.replace(/\s+#\s*time=[0-9.]+m?s$/i, '').trim() || '(unnamed)';

    const parents = suiteStack.slice(0, depth).filter(Boolean);
    const fullCaseName = parents.length > 0 ? `${parents.join(' > ')} > ${cleanDesc}` : cleanDesc;

    let result;
    if (skipMatch && ok) {
      result = 'SKIPPED';
    } else if (ok) {
      result = 'PASS';
    } else {
      result = 'FAIL';
    }

    cases.push({
      case: fullCaseName,
      result,
      ...(durationMs !== null && Number.isFinite(durationMs) ? { durationMs } : {}),
    });
  }

  return cases;
}

function findPowerShellBin() {
  const candidates = process.platform === 'win32'
    ? ['pwsh', 'powershell', 'powershell.exe']
    : ['pwsh'];
  for (const cand of candidates) {
    const probe = spawnSync(cand, ['-NoProfile', '-Command', 'exit 0'], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 10000,
    });
    if (!probe.error && probe.status === 0) {
      return cand;
    }
  }
  return null;
}

/**
 * Pure-Node static contract verifier for `setup.ps1` and `ps1-shell.test.ps1` when `pwsh` is absent on POSIX.
 * Performs real assertions (never counted as skip) over UTF-8 BOM, 7-bit ASCII encoding, ParamBlock parity,
 * bare-word typo subcommand guards, mutually exclusive flag guards, and Node >= 20 forwarding.
 */
function runSetupPs1StaticContract(repoRoot, psTestPath) {
  const cases = [];
  const setupPs1Path = path.join(repoRoot, 'setup.ps1');
  const cursorCliPath = path.join(repoRoot, 'scripts', 'cursor-base.mjs');

  const recordCase = (name, fn) => {
    const t0 = Date.now();
    try {
      fn();
      cases.push({ case: name, result: 'PASS', durationMs: Date.now() - t0 });
    } catch (err) {
      cases.push({
        case: name,
        result: 'FAIL',
        durationMs: Date.now() - t0,
        error: String(err?.message || err),
      });
    }
  };

  const verifyPureAsciiNoBom = (filePath, label) => {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`missing PowerShell file: ${label} (${filePath})`);
    }
    const buf = fs.readFileSync(filePath);
    if (buf.length === 0) {
      throw new Error(`${label} is empty`);
    }
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      throw new Error(`${label} contains forbidden UTF-8 BOM`);
    }
    for (let i = 0; i < buf.length; i += 1) {
      if (buf[i] > 0x7f) {
        throw new Error(`${label} contains non-ASCII byte 0x${buf[i].toString(16)} at offset ${i}`);
      }
    }
    return buf.toString('utf8');
  };

  let setupText = '';
  recordCase('setup.ps1 is non-empty pure 7-bit ASCII without UTF-8 BOM', () => {
    setupText = verifyPureAsciiNoBom(setupPs1Path, 'setup.ps1');
  });

  recordCase('ps1-shell.test.ps1 is non-empty pure 7-bit ASCII without UTF-8 BOM', () => {
    verifyPureAsciiNoBom(psTestPath, '.cursor/tests/ps1-shell.test.ps1');
  });

  recordCase('setup.ps1 [CmdletBinding()] param(...) declares all required CLI parameters', () => {
    if (!/\[CmdletBinding\(\)\]/.test(setupText)) {
      throw new Error('setup.ps1 missing [CmdletBinding()] attribute');
    }
    const paramBlockMatch = /param\s*\(([\s\S]*?)\r?\n\)/.exec(setupText);
    if (!paramBlockMatch) {
      throw new Error('setup.ps1 missing param(...) block');
    }
    const paramBody = paramBlockMatch[1];
    const requiredParams = [
      'Command',
      'Target',
      'DryRun',
      'Force',
      'Uninstall',
      'SourceCheck',
      'WithCc',
      'NoAutoCc',
      'CcBase',
      'BundleCc',
      'Out',
      'HookForm',
      'Json',
      'ExtraArgs',
    ];
    for (const p of requiredParams) {
      const re = new RegExp(`\\$${p}\\b`);
      if (!re.test(paramBody)) {
        throw new Error(`setup.ps1 param(...) block missing $${p}`);
      }
    }
  });

  recordCase('setup.ps1 $KnownCommands covers all cursor-base subcommands', () => {
    const knownMatch = /\$KnownCommands\s*=\s*@\(([\s\S]*?)\)/.exec(setupText);
    if (!knownMatch) {
      throw new Error('setup.ps1 missing $KnownCommands array');
    }
    const expectedCmds = ['install', 'upgrade', 'uninstall', 'doctor', 'manifest', 'pack-check', 'release', 'help'];
    for (const cmd of expectedCmds) {
      if (!knownMatch[1].includes(`'${cmd}'`)) {
        throw new Error(`setup.ps1 $KnownCommands missing '${cmd}'`);
      }
    }
  });

  recordCase('setup.ps1 $CommonTypoCommands matches cursor-base.mjs bare-word typo interception with exit 2', () => {
    const typoMatch = /\$CommonTypoCommands\s*=\s*@\(([\s\S]*?)\)/.exec(setupText);
    if (!typoMatch) {
      throw new Error('setup.ps1 missing $CommonTypoCommands list');
    }
    const cliText = fs.readFileSync(cursorCliPath, 'utf8');
    for (const typoWord of EXPECTED_TYPO_SUBCOMMANDS) {
      if (!typoMatch[1].includes(`'${typoWord}'`)) {
        throw new Error(`setup.ps1 $CommonTypoCommands missing bare word '${typoWord}'`);
      }
      if (!cliText.includes(`['${typoWord}',`)) {
        throw new Error(`cursor-base.mjs COMMON_TYPO_SUBCOMMANDS missing '${typoWord}'`);
      }
    }
    if (!/\$CommonTypoCommands\s+-contains\s+\$Command/.test(setupText)) {
      throw new Error('setup.ps1 missing positional $Command bare-word typo interception');
    }
    if (!/function\s+Exit-Usage[\s\S]*?exit\s+2\b/.test(setupText)) {
      throw new Error('setup.ps1 Exit-Usage must exit with code 2');
    }
  });

  recordCase('setup.ps1 enforces mutually exclusive -WithCc/-NoAutoCc, --hook-form validation, duplicate target, and unknown flag guards', () => {
    if (!/\$WithCc[\s\S]{0,80}\$NoAutoCc[\s\S]{0,80}Exit-Usage/.test(setupText)) {
      throw new Error('setup.ps1 missing -WithCc / -NoAutoCc mutual exclusion guard');
    }
    if (!/\$arg\.StartsWith\('-'\)[\s\S]{0,80}Exit-Usage/.test(setupText)) {
      throw new Error('setup.ps1 missing unknown -* option Exit-Usage guard');
    }
    if (!/ValidateSet\('',\s*'string',\s*'exec'\)/.test(setupText)) {
      throw new Error('setup.ps1 missing ValidateSet for $HookForm');
    }
    for (const flag of ['--with-cc', '--no-auto-cc', '--cc-base', '--bundle-cc', '--hook-form', '--dry-run', '--force', '--json']) {
      if (!setupText.includes(`'${flag}'`)) {
        throw new Error(`setup.ps1 missing forwarded CLI flag '${flag}'`);
      }
    }
  });

  recordCase('setup.ps1 verifies node >= 20 integer major version (exit 3) and forwards to scripts/cursor-base.mjs', () => {
    if (!/Get-Command\s+node\b[\s\S]{0,200}exit\s+3\b/.test(setupText)) {
      throw new Error('setup.ps1 missing node runtime existence check with exit 3');
    }
    if (!/\[int\]::TryParse\([\s\S]{0,120}-lt\s+20\)[\s\S]{0,200}exit\s+3\b/.test(setupText)) {
      throw new Error('setup.ps1 missing integer major < 20 check with exit 3');
    }
    if (!setupText.includes('scripts\\cursor-base.mjs') || !setupText.includes('exit $LASTEXITCODE')) {
      throw new Error('setup.ps1 must invoke scripts\\cursor-base.mjs and exit $LASTEXITCODE');
    }
  });

  return cases;
}

function writeLedgerSafe(ledgerPath, rows) {
  if (rows.length === 0) return;
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, payload, 'utf8');
  } catch (e) {
    try {
      fs.writeFileSync(DEFAULT_TMP_LEDGER, payload, 'utf8');
    } catch {
      process.stderr.write(`[run-all] warning: failed to write ledger ${ledgerPath}: ${(e && e.message) || e}\n`);
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${usageText()}\n`);
    process.exit(0);
  }
  if (opts.error) {
    process.stderr.write(`[run-all] ${opts.error}\n${usageText()}\n`);
    process.exit(2);
  }

  if (!fs.existsSync(opts.dir) || !fs.statSync(opts.dir).isDirectory()) {
    process.stderr.write(`[run-all] BLOCKED: test directory does not exist: ${opts.dir}\n`);
    process.exit(2);
  }

  const allMjsEntries = fs.readdirSync(opts.dir)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort();

  const selected = [];
  for (const name of allMjsEntries) {
    const fullPath = path.join(opts.dir, name);
    let st;
    try {
      st = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const meta = extractHeaderMeta(fullPath);
    if (matchesLevel(meta, opts.level)) {
      selected.push({ kind: 'node', name, fullPath, risk: meta.risk });
    }
  }

  const psTestPath = path.join(opts.dir, 'ps1-shell.test.ps1');
  if (fs.existsSync(psTestPath) && fs.statSync(psTestPath).isFile()) {
    const psMeta = extractHeaderMeta(psTestPath);
    if (matchesLevel(psMeta, opts.level)) {
      selected.push({ kind: 'ps1', name: 'ps1-shell.test.ps1', fullPath: psTestPath, risk: psMeta.risk });
    }
  }

  if (selected.length === 0) {
    process.stderr.write(`[run-all] BLOCKED: 0 test files matched --level ${opts.level} in ${opts.dir} (refusing fake green).\n`);
    process.exit(2);
  }

  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;
  let anyFileFailed = false;
  const ledgerRows = [];
  const nowIso = new Date().toISOString();
  const suiteStartMs = Date.now();

  process.stdout.write(`cursor-base test runner (--level ${opts.level}): ${selected.length} suite(s)\n`);

  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;

  for (const item of selected) {
    if (item.kind === 'ps1') {
      const psBin = findPowerShellBin();
      if (psBin) {
        const t0 = Date.now();
        const r = spawnSync(
          psBin,
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', item.fullPath],
          {
            cwd: os.tmpdir(),
            env: childEnv,
            shell: false,
            windowsHide: true,
            encoding: 'utf8',
            timeout: 180000,
            maxBuffer: 64 * 1024 * 1024,
          },
        );
        const elapsedMs = Date.now() - t0;
        const parsedCases = parseTapCases(r.stdout);
        let filePass = 0;
        let fileFail = 0;
        let fileSkip = 0;
        for (const c of parsedCases) {
          if (c.result === 'PASS') filePass += 1;
          else if (c.result === 'FAIL') fileFail += 1;
          else fileSkip += 1;
          ledgerRows.push({
            t: nowIso,
            file: item.name,
            case: c.case,
            risk: item.risk,
            result: c.result,
          });
        }
        if (r.status !== 0 && fileFail === 0) {
          fileFail += 1;
          ledgerRows.push({
            t: nowIso,
            file: item.name,
            case: '(pwsh-non-zero-exit)',
            risk: item.risk,
            result: 'FAIL',
            durationMs: elapsedMs,
          });
        }
        if (filePass === 0 && fileFail === 0) {
          fileFail += 1;
        }
        totalPass += filePass;
        totalFail += fileFail;
        totalSkip += fileSkip;
        const okFile = r.status === 0 && fileFail === 0 && filePass > 0;
        if (!okFile) anyFileFailed = true;
        const badge = okFile ? 'PASS' : 'FAIL';
        process.stdout.write(
          `  [${badge}] ${`${item.name} (${psBin})`.padEnd(36)} (risk=${item.risk.padEnd(6)}) pass=${filePass} fail=${fileFail} skip=${fileSkip} (${elapsedMs}ms)\n`,
        );
        if (!okFile) {
          const dump = [r.stdout || '', r.stderr || ''].filter(Boolean).join('\n').slice(0, 2500);
          if (dump.trim()) {
            process.stderr.write(`--- failure output: ${item.name} (exit ${r.status}) ---\n${dump}\n`);
          }
        }
      } else {
        const t0 = Date.now();
        const candidateRepoRoot = fs.existsSync(path.join(path.resolve(opts.dir, '..', '..'), 'setup.ps1'))
          ? path.resolve(opts.dir, '..', '..')
          : REPO_ROOT;
        const staticCases = runSetupPs1StaticContract(candidateRepoRoot, item.fullPath);
        const elapsedMs = Date.now() - t0;
        let filePass = 0;
        let fileFail = 0;
        const errors = [];
        for (const c of staticCases) {
          if (c.result === 'PASS') filePass += 1;
          else {
            fileFail += 1;
            errors.push(`not ok - ${c.case}: ${c.error}`);
          }
          ledgerRows.push({
            t: nowIso,
            file: 'setup.ps1-static-contract',
            case: c.case,
            risk: item.risk,
            result: c.result,
            durationMs: c.durationMs,
          });
        }
        totalPass += filePass;
        totalFail += fileFail;
        const okFile = fileFail === 0 && filePass > 0;
        if (!okFile) anyFileFailed = true;
        const badge = okFile ? 'PASS' : 'FAIL';
        process.stdout.write(
          `  [${badge}] ${'setup.ps1 (static-contract, no pwsh)'.padEnd(36)} (risk=${item.risk.padEnd(6)}) pass=${filePass} fail=${fileFail} skip=0 (${elapsedMs}ms)\n`,
        );
        if (!okFile && errors.length > 0) {
          process.stderr.write(`--- failure output: setup.ps1 static contract ---\n${errors.join('\n')}\n`);
        }
      }
      continue;
    }

    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', item.fullPath], {
      cwd: os.tmpdir(),
      env: childEnv,
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 240000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const elapsedMs = Date.now() - t0;
    const parsedCases = parseTapCases(r.stdout);

    let filePass = 0;
    let fileFail = 0;
    let fileSkip = 0;

    if (parsedCases.length === 0 && r.status !== 0) {
      fileFail = 1;
      ledgerRows.push({
        t: nowIso,
        file: item.name,
        case: '(suite-execution)',
        risk: item.risk,
        result: 'FAIL',
        durationMs: elapsedMs,
      });
    } else {
      for (const c of parsedCases) {
        if (c.result === 'PASS') filePass += 1;
        else if (c.result === 'FAIL') fileFail += 1;
        else fileSkip += 1;
        ledgerRows.push({
          t: nowIso,
          file: item.name,
          case: c.case,
          risk: item.risk,
          result: c.result,
          ...(c.durationMs !== undefined ? { durationMs: c.durationMs } : {}),
        });
      }
      if (r.status !== 0 && fileFail === 0) {
        fileFail += 1;
        ledgerRows.push({
          t: nowIso,
          file: item.name,
          case: '(non-zero-exit)',
          risk: item.risk,
          result: 'FAIL',
          durationMs: elapsedMs,
        });
      }
    }

    totalPass += filePass;
    totalFail += fileFail;
    totalSkip += fileSkip;

    const okFile = r.status === 0 && fileFail === 0;
    if (!okFile) anyFileFailed = true;

    const badge = okFile ? 'PASS' : 'FAIL';
    process.stdout.write(
      `  [${badge}] ${item.name.padEnd(36)} (risk=${item.risk.padEnd(6)}) pass=${filePass} fail=${fileFail} skip=${fileSkip} (${elapsedMs}ms)\n`,
    );

    if (!okFile) {
      const diag = [r.stdout || '', r.stderr || ''].filter(Boolean).join('\n');
      const relevant = diag
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter((l) => /^(?:\s*not ok\b|\s*#\s|\s*Error:|\s*AssertionError|\s*actual:|\s*expected:|\s*operator:|\s*at\s)/.test(l))
        .slice(0, 60);
      const dump = relevant.length > 0 ? relevant.join('\n') : diag.slice(0, 2500);
      if (dump.trim()) {
        process.stderr.write(`--- failure output: ${item.name} (exit ${r.status}) ---\n${dump}\n`);
      }
    }
  }

  const shouldPersistLedger = Boolean(process.env.CURSOR_TEST_LEDGER || opts.ledger !== DEFAULT_TMP_LEDGER);
  if (shouldPersistLedger) {
    writeLedgerSafe(opts.ledger, ledgerRows);
  }

  const totalElapsedMs = Date.now() - suiteStartMs;
  process.stdout.write(
    `summary: files=${selected.length} pass=${totalPass} fail=${totalFail} skip=${totalSkip} durationMs=${totalElapsedMs}\n`,
  );

  if (anyFileFailed || totalFail > 0) {
    process.exit(1);
  }

  if (totalPass === 0) {
    process.stderr.write('[run-all] BLOCKED: 0 test cases actually executed (all skipped or empty files) -- refusing fake green.\n');
    process.exit(2);
  }

  process.exit(0);
}

main();
