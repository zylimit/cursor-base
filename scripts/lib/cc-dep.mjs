#!/usr/bin/env node
// scripts/lib/cc-dep.mjs — 3-tier decoupled upstream `cc-base` discovery, contract verification,
// one-step `--hook-form string` co-installer, and `--bundle-cc` offline bundler for cursor-base.
// Zero npm dependencies (Node >= 20 built-ins only).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './path-guard.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FW_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

export const CC_CONTRACT_FILENAME = 'cc-base-contract.json';
export const BUNDLED_CC_DIRNAME = '.bundled-cc-base';

export const DEFAULT_CONTRACT = {
  version: 1,
  upstream: 'cc-base',
  claudeDir: '.claude',
  defaultHookForm: 'string',
  requiredFiles: ['CLAUDE.md', 'settings.json'],
  requiredDirs: ['rules', 'skills', 'agents', 'hooks'],
  minSkills: 15,
  requiredAgents: [
    'code-reviewer',
    'deployer',
    'domain-recorder',
    'evolution-runner',
    'feedback-observer',
    'implementer',
    'progress-recorder',
    'tester',
  ],
  requiredHooks: [
    'session-rules-banner.mjs',
    'no-direct-code-guard.mjs',
    'record-authorship.mjs',
    'pre-commit-check.mjs',
    'dangerous-pkill-guard.mjs',
    'secret-exfil-guard.mjs',
    'tdd-gate.mjs',
    'mark-review-needed.mjs',
    'stop-gate.mjs',
    'three-file-sync-gate.mjs',
    'subagent-acceptance-reminder.mjs',
  ],
};

/**
 * Load `cc-base-contract.json` from `fwRoot` (falling back to `DEFAULT_CONTRACT`).
 * @param {string} [fwRoot]
 */
export function loadCcBaseContract(fwRoot = DEFAULT_FW_ROOT) {
  const contractPath = path.join(path.resolve(fwRoot), CC_CONTRACT_FILENAME);
  try {
    if (fs.existsSync(contractPath) && fs.statSync(contractPath).isFile()) {
      const parsed = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
      return { ...DEFAULT_CONTRACT, ...parsed };
    }
  } catch {
    // fallback to DEFAULT_CONTRACT
  }
  return { ...DEFAULT_CONTRACT };
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function countValidSkills(skillsDir) {
  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const skMd = path.join(skillsDir, e.name, 'SKILL.md');
    const st = statOrNull(skMd);
    if (st && st.isFile() && st.size > 0) count++;
  }
  return count;
}

function countValidAgents(agentsDir) {
  let entries;
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md') || e.name.startsWith('.')) continue;
    const st = statOrNull(path.join(agentsDir, e.name));
    if (st && st.size > 0) count++;
  }
  return count;
}

function normalizeInClaudeRel(rel) {
  const p = toPosix(rel).replace(/^\/+/, '');
  return p.startsWith('.claude/') ? p.slice('.claude/'.length) : p;
}

/**
 * Verify whether `dirPath` (a project/cc-base root or a `.claude` directory) satisfies `cc-base-contract.json`.
 * @param {string} dirPath
 * @param {{
 *   contract?: typeof DEFAULT_CONTRACT,
 *   fwRoot?: string,
 *   requireInstaller?: boolean
 * }} [opts]
 */
export function verifyCcBaseDir(dirPath, opts = {}) {
  const contract = opts.contract || loadCcBaseContract(opts.fwRoot || DEFAULT_FW_ROOT);
  if (!dirPath || typeof dirPath !== 'string' || !dirPath.trim()) {
    return { ok: false, rootDir: '', claudeDir: '', skillsCount: 0, agentsCount: 0, problems: ['empty path'] };
  }
  const abs = path.resolve(dirPath.trim());
  const directIsClaude = path.basename(abs) === '.claude' && Boolean(statOrNull(path.join(abs, 'CLAUDE.md')));
  const rootDir = directIsClaude ? path.dirname(abs) : abs;
  const claudeDir = directIsClaude ? abs : path.join(abs, contract.claudeDir || '.claude');

  const problems = [];
  const claudeSt = statOrNull(claudeDir);
  if (!claudeSt || !claudeSt.isDirectory()) {
    return {
      ok: false,
      rootDir,
      claudeDir,
      skillsCount: 0,
      agentsCount: 0,
      problems: [`missing ${toPosix(claudeDir)} directory`],
    };
  }

  const markerPath = path.join(claudeDir, '.runtime', 'install.marker');
  if (fs.existsSync(markerPath)) {
    try {
      const mText = fs.readFileSync(markerPath, 'utf8');
      if (mText.includes('interrupted')) {
        problems.push('incomplete .claude install (.claude/.runtime/install.marker is interrupted)');
      }
    } catch {
      problems.push('unreadable .claude/.runtime/install.marker');
    }
  }

  for (const rawRel of contract.requiredFiles || []) {
    const relFile = normalizeInClaudeRel(rawRel);
    const fp = path.join(claudeDir, ...relFile.split('/'));
    const st = statOrNull(fp);
    if (!st || !st.isFile() || st.size === 0) {
      problems.push(`missing or empty .claude/${relFile}`);
    }
  }

  for (const rawDir of contract.requiredDirs || []) {
    const relDir = normalizeInClaudeRel(rawDir);
    const dp = path.join(claudeDir, ...relDir.split('/'));
    const st = statOrNull(dp);
    if (!st || !st.isDirectory()) {
      problems.push(`missing .claude/${relDir}/ directory`);
    }
  }

  const skillsDir = path.join(claudeDir, 'skills');
  const skillsCount = countValidSkills(skillsDir);
  const minSkills = Number(contract.minSkills ?? 15);
  if (skillsCount < minSkills) {
    problems.push(`skills count ${skillsCount} < required ${minSkills}`);
  }

  const agentsDir = path.join(claudeDir, 'agents');
  const agentsCount = countValidAgents(agentsDir);
  for (const role of contract.requiredAgents || []) {
    const ap = path.join(agentsDir, `${role}.md`);
    const st = statOrNull(ap);
    if (!st || !st.isFile() || st.size === 0) {
      problems.push(`missing core agent .claude/agents/${role}.md`);
    }
  }

  const hooksDir = path.join(claudeDir, 'hooks');
  for (const hookName of contract.requiredHooks || []) {
    const hp = path.join(hooksDir, hookName);
    const st = statOrNull(hp);
    if (!st || !st.isFile() || st.size === 0) {
      problems.push(`missing core hook .claude/hooks/${hookName}`);
    }
  }

  if (opts.requireInstaller) {
    for (const installer of ['setup.sh', 'setup.ps1']) {
      if (!statOrNull(path.join(rootDir, installer))?.isFile()) {
        problems.push(`missing upstream installer ${installer}`);
      }
    }
  }

  return {
    ok: problems.length === 0,
    rootDir,
    claudeDir,
    skillsCount,
    agentsCount,
    problems,
  };
}

/**
 * Check if `targetDir` already has a coherent, usable `.claude/` layout (e.g. a lightweight test fixture
 * or custom `.claude/` workspace) that should not be overwritten unless `--with-cc` or `--cc-base` is passed.
 */
function hasUsableLocalClaudeLayout(targetDir) {
  const claudeDir = path.join(path.resolve(targetDir), '.claude');
  if (!statOrNull(claudeDir)?.isDirectory()) return false;
  if (fs.existsSync(path.join(claudeDir, '.runtime', 'install.marker'))) return false;
  const claudeMd = statOrNull(path.join(claudeDir, 'CLAUDE.md'));
  const settings = statOrNull(path.join(claudeDir, 'settings.json'));
  const hooks = statOrNull(path.join(claudeDir, 'hooks'));
  if (!claudeMd?.isFile() || claudeMd.size === 0) return false;
  if (!settings?.isFile() || settings.size === 0) return false;
  if (!hooks?.isDirectory()) return false;
  if (countValidSkills(path.join(claudeDir, 'skills')) < 1) return false;
  if (countValidAgents(path.join(claudeDir, 'agents')) < 1) return false;
  return true;
}

/**
 * Discover upstream `cc-base` source directory following the strict 4-priority chain:
 * 1. Explicit `--cc-base <dir>` (`opts.ccBase`)
 * 2. `<fwRoot>/.bundled-cc-base` (offline bundled package)
 * 3. `$CC_BASE_DIR` environment variable
 * 4. `<fwRoot>/../cc-base` sibling directory
 *
 * @param {string} [fwRoot]
 * @param {{
 *   ccBase?: string,
 *   envCcBase?: string,
 *   skipBundled?: boolean,
 *   skipSibling?: boolean,
 *   contract?: typeof DEFAULT_CONTRACT
 * }} [opts]
 */
export function discoverCcBaseSource(fwRoot = DEFAULT_FW_ROOT, opts = {}) {
  const absFwRoot = path.resolve(fwRoot);
  const contract = opts.contract || loadCcBaseContract(absFwRoot);
  const warnings = [];

  if (opts.ccBase && String(opts.ccBase).trim()) {
    const explicitDir = path.resolve(String(opts.ccBase).trim());
    const v = verifyCcBaseDir(explicitDir, { contract, fwRoot: absFwRoot, requireInstaller: true });
    if (!v.ok) {
      return {
        ok: false,
        code: 2,
        found: false,
        source: 'explicit',
        dir: explicitDir,
        explicitError: `指定的 --cc-base 目录不满足 cc-base 契约（${explicitDir}）：${v.problems.slice(0, 4).join('; ')}`,
        warnings,
      };
    }
    return { ok: true, code: 0, found: true, source: 'explicit', dir: v.rootDir, verification: v, explicitError: null, warnings };
  }

  if (!opts.skipBundled) {
    const bundledDir = path.join(absFwRoot, BUNDLED_CC_DIRNAME);
    if (statOrNull(bundledDir)?.isDirectory()) {
      const v = verifyCcBaseDir(bundledDir, { contract, fwRoot: absFwRoot, requireInstaller: true });
      if (v.ok) {
        return { ok: true, code: 0, found: true, source: 'bundled', dir: v.rootDir, verification: v, explicitError: null, warnings };
      }
      warnings.push(`.bundled-cc-base 存在但未通过契约校验：${v.problems.slice(0, 3).join('; ')}`);
    }
  }

  const rawEnv = opts.envCcBase !== undefined ? opts.envCcBase : (process.env.CC_BASE_DIR || '');
  if (String(rawEnv).trim()) {
    const envDir = path.resolve(String(rawEnv).trim());
    const v = verifyCcBaseDir(envDir, { contract, fwRoot: absFwRoot, requireInstaller: true });
    if (v.ok) {
      return { ok: true, code: 0, found: true, source: 'env', dir: v.rootDir, verification: v, explicitError: null, warnings };
    }
    warnings.push(`CC_BASE_DIR (${envDir}) 未通过契约校验：${v.problems.slice(0, 3).join('; ')}`);
  }

  const noSiblingEnv = process.env.CURSOR_BASE_NO_SIBLING_CC === '1';
  if (!opts.skipSibling && !noSiblingEnv) {
    const siblingDir = path.resolve(absFwRoot, '..', 'cc-base');
    if (statOrNull(siblingDir)?.isDirectory()) {
      const v = verifyCcBaseDir(siblingDir, { contract, fwRoot: absFwRoot, requireInstaller: true });
      if (v.ok) {
        return { ok: true, code: 0, found: true, source: 'sibling', dir: v.rootDir, verification: v, explicitError: null, warnings };
      }
      warnings.push(`同级目录 ../cc-base 存在但未通过契约校验：${v.problems.slice(0, 3).join('; ')}`);
    }
  }

  return { ok: true, code: 0, found: false, source: null, dir: null, explicitError: null, warnings };
}

function resolvePowerShellBin() {
  for (const cand of ['pwsh', 'powershell', 'powershell.exe']) {
    const probe = spawnSync(cand, ['-NoProfile', '-Command', 'exit 0'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (!probe.error || probe.error.code !== 'ENOENT') {
      return cand;
    }
  }
  return null;
}

function resolveBashBin() {
  for (const cand of ['bash', 'sh']) {
    const probe = spawnSync(cand, ['-c', 'exit 0'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (!probe.error || probe.error.code !== 'ENOENT') {
      return cand;
    }
  }
  return null;
}

/**
 * Invoke upstream `cc-base` installer (`setup.ps1 -HookForm string` on win32, `setup.sh --hook-form string` on POSIX).
 * @param {string} ccDir
 * @param {string} targetDir
 * @param {{ dryRun?: boolean, force?: boolean, hookForm?: 'string' | 'exec' }} [opts]
 */
export function invokeCcBaseInstaller(ccDir, targetDir, opts = {}) {
  const absCc = path.resolve(ccDir);
  const absTarget = path.resolve(targetDir);
  const dryRun = Boolean(opts.dryRun);
  const hookForm = opts.hookForm === 'exec' ? 'exec' : 'string';
  const childEnv = {
    ...process.env,
    CLAUDE_PROJECT_DIR: absTarget,
  };
  delete childEnv.CC_SETUP_FAIL_AFTER;

  if (process.platform === 'win32') {
    const psBin = resolvePowerShellBin();
    if (!psBin) {
      return { ok: false, code: 3, error: 'Windows 平台运行上游 cc-base/setup.ps1 需要 pwsh 或 powershell' };
    }
    const psArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(absCc, 'setup.ps1'),
      '-Target',
      absTarget,
      '-HookForm',
      hookForm,
    ];
    if (dryRun) psArgs.push('-DryRun');
    const r = spawnSync(psBin, psArgs, {
      cwd: absCc,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
      windowsHide: true,
      env: childEnv,
    });
    if (r.error) {
      return {
        ok: false,
        code: r.error.code === 'ENOENT' ? 3 : 1,
        error: `调用 cc-base/setup.ps1 失败：${r.error.message}`,
      };
    }
    if (r.status !== 0) {
      const detail = String(r.stderr || r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
      return { ok: false, code: r.status === 2 ? 2 : 1, error: `上游 cc-base/setup.ps1 安装失败：${detail}` };
    }
    return { ok: true, code: 0, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
  }

  const shBin = resolveBashBin();
  if (!shBin) {
    return { ok: false, code: 3, error: '运行上游 cc-base/setup.sh 需要 bash/sh' };
  }
  const shArgs = [path.join(absCc, 'setup.sh')];
  if (dryRun) shArgs.push('--dry-run');
  shArgs.push('--hook-form', hookForm, absTarget);
  const r = spawnSync(shBin, shArgs, {
    cwd: absCc,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    windowsHide: true,
    env: childEnv,
  });
  if (r.error) {
    return {
      ok: false,
      code: r.error.code === 'ENOENT' ? 3 : 1,
      error: `调用 cc-base/setup.sh 失败：${r.error.message}`,
    };
  }
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
    return { ok: false, code: r.status === 2 ? 2 : 1, error: `上游 cc-base/setup.sh 安装失败：${detail}` };
  }
  return { ok: true, code: 0, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

/**
 * 3-Tier decoupled `cc-base` upstream provisioning:
 * - Tier 1: `<target>/.claude/` already present & compliant (or usable local layout when `!withCc && !ccBase`) -> reuse directly (unless `withCc` / `ccBase` requests upgrade).
 * - Tier 2: `<target>` lacks `.claude/` (or `withCc`/`ccBase` set) and `!noAutoCc` -> discover upstream `cc-base` and run `setup.{ps1,sh} --hook-form string`.
 * - Tier 3: `!found` or `noAutoCc` -> return `{ ok: true, tier: 3, status: 'deferred' }` (exit 0, later self-healed by `sessionStart`).
 *
 * @param {string} targetDir
 * @param {{
 *   fwRoot?: string,
 *   withCc?: boolean,
 *   noAutoCc?: boolean,
 *   ccBase?: string,
 *   envCcBase?: string,
 *   skipBundled?: boolean,
 *   skipSibling?: boolean,
 *   dryRun?: boolean,
 *   force?: boolean,
 *   hookForm?: 'string' | 'exec'
 * }} [opts]
 */
export function ensureUpstreamCcBase(targetDir, opts = {}) {
  const fwRoot = path.resolve(opts.fwRoot || DEFAULT_FW_ROOT);
  const absTarget = path.resolve(targetDir);
  const contract = loadCcBaseContract(fwRoot);
  const withCc = Boolean(opts.withCc);
  const flagNoAutoCc = Boolean(opts.noAutoCc);
  const envNoAutoCc = process.env.CURSOR_BASE_NO_AUTO_CC === '1';
  const noAutoCc = flagNoAutoCc || envNoAutoCc;
  const dryRun = Boolean(opts.dryRun);
  const explicitCc = String(opts.ccBase ?? '').trim();
  const hookForm = opts.hookForm === 'exec' ? 'exec' : 'string';

  if (flagNoAutoCc && (withCc || explicitCc)) {
    return {
      ok: false,
      code: 2,
      tier: 0,
      status: 'error',
      error: '--no-auto-cc 不能与 --with-cc 或 --cc-base 同时指定',
    };
  }

  if (!dryRun && absTarget === fwRoot) {
    return {
      ok: false,
      code: 2,
      tier: 0,
      status: 'error',
      error: `target 目录不能指向 cursor-base 框架源仓库自身（${targetDir}）`,
    };
  }

  // Always validate explicit --cc-base upfront
  if (explicitCc) {
    const expDisc = discoverCcBaseSource(fwRoot, { ccBase: explicitCc, contract });
    if (expDisc.explicitError) {
      return {
        ok: false,
        code: 2,
        tier: 2,
        status: 'error',
        error: expDisc.explicitError,
        warnings: expDisc.warnings,
      };
    }
  }

  const targetCheck = verifyCcBaseDir(absTarget, { contract, fwRoot, requireInstaller: false });

  // Tier 1: Target already has compliant (or usable local) .claude/ and no explicit upgrade requested
  if (!withCc && !explicitCc && (targetCheck.ok || hasUsableLocalClaudeLayout(absTarget))) {
    return {
      ok: true,
      code: 0,
      tier: 1,
      status: 'reused',
      action: 'present',
      compliant: targetCheck.ok,
      dryRun,
      source: 'target:.claude',
      ccDir: null,
      warnings: [],
    };
  }

  // Tier 3 (explicit opt-out): --no-auto-cc / CURSOR_BASE_NO_AUTO_CC=1
  if (noAutoCc && !withCc && !explicitCc) {
    return {
      ok: true,
      code: 0,
      tier: 3,
      status: 'deferred',
      action: 'deferred',
      reason: flagNoAutoCc ? 'no-auto-cc' : 'no-auto-cc-env',
      dryRun,
      source: null,
      ccDir: null,
      warnings: [],
    };
  }

  // Tier 2: Discover upstream cc-base source
  const disc = discoverCcBaseSource(fwRoot, {
    ccBase: explicitCc,
    envCcBase: opts.envCcBase,
    skipBundled: opts.skipBundled,
    skipSibling: opts.skipSibling,
    contract,
  });

  if (disc.explicitError) {
    return {
      ok: false,
      code: 2,
      tier: 2,
      status: 'error',
      error: disc.explicitError,
      warnings: disc.warnings,
    };
  }

  if (!disc.found || !disc.dir) {
    if (withCc) {
      return {
        ok: false,
        code: 2,
        tier: 2,
        status: 'error',
        error: '已指定 --with-cc，但未找到可用的上游 cc-base 源（请通过 --cc-base <dir> 或环境变量 CC_BASE_DIR 指定）',
        warnings: disc.warnings,
      };
    }
    return {
      ok: true,
      code: 0,
      tier: 3,
      status: 'deferred',
      action: 'deferred',
      reason: 'no-cc-source',
      dryRun,
      source: null,
      ccDir: null,
      warnings: disc.warnings,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      code: 0,
      tier: 2,
      status: targetCheck.ok ? 'planned-upgrade' : 'planned-install',
      action: targetCheck.ok ? 'upgraded' : 'auto-installed',
      dryRun: true,
      source: disc.source,
      ccDir: disc.dir,
      warnings: disc.warnings,
    };
  }

  const runRes = invokeCcBaseInstaller(disc.dir, absTarget, {
    dryRun: false,
    force: Boolean(opts.force),
    hookForm,
  });
  if (!runRes.ok) {
    return {
      ok: false,
      code: runRes.code || 1,
      tier: 2,
      status: 'error',
      source: disc.source,
      ccDir: disc.dir,
      error: runRes.error,
      warnings: disc.warnings,
    };
  }

  return {
    ok: true,
    code: 0,
    tier: Math.min(targetCheck.ok ? 1 : 2, 2),
    status: targetCheck.ok ? 'upgraded' : 'installed',
    action: targetCheck.ok ? 'upgraded' : 'auto-installed',
    dryRun: false,
    source: disc.source,
    ccDir: disc.dir,
    warnings: disc.warnings,
  };
}

const CC_BUNDLE_SKIP_CLAUDE_ROOT = new Set([
  'settings-windows.json',
  'settings.local.json',
  '.credentials.json',
  '.last-review',
  'EVOLUTION.md',
  '.needs-review',
  '.needs-review.lock',
  '.tdd-exempt',
  '.red-verified',
  '.static-gate',
  '.degraded-review',
  '.fast-mode',
  '.subagent-reminded',
  '.three-file-sync-advised',
  '.tdd-gate-advised',
  '.stop-gate-strikes',
  '.stop-gate-advised',
  '.precompact-block-epoch',
  '.async-verify-last',
  'signals.jsonl',
  '.DS_Store',
  'Thumbs.db',
]);

function isExcludedFromCcBundleClaude(relInClaude) {
  const rel = toPosix(relInClaude).replace(/^\/+/, '');
  if (!rel) return true;
  if (CC_BUNDLE_SKIP_CLAUDE_ROOT.has(rel)) return true;
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  if (base === 'signals.jsonl' || base === '.DS_Store' || base === 'Thumbs.db' || base === '.credentials.json') return true;
  if (/\.(?:bak|framework-new|cursor-new|cac-link-new|cac-base-new|swp)$/.test(rel) || /\.bak-/.test(rel)) return true;
  if (
    rel.startsWith('local/') ||
    rel.startsWith('evidence/') ||
    rel.startsWith('.runtime/') ||
    rel.startsWith('worktrees/') ||
    rel.startsWith('tests/') ||
    rel.startsWith('research/') ||
    rel.startsWith('agent-memory/') ||
    /^harness\/(?:receipts|state|waivers|trend|evidence|ext)\//.test(rel)
  ) {
    return true;
  }
  if (/^feedback\/[^/]+\.md$/.test(rel)) return true;
  return false;
}

/**
 * Bundle a clean, privacy-scrubbed copy of upstream `cc-base` into `<stageRootDir>/.bundled-cc-base`
 * for single-archive offline distribution (`release <ver> --bundle-cc <dir>`).
 * @param {string} ccSrcDir
 * @param {string} stageRootDir
 * @param {{ fwRoot?: string }} [opts]
 */
export function bundleCcBaseIntoDir(ccSrcDir, stageRootDir, opts = {}) {
  const fwRoot = path.resolve(opts.fwRoot || DEFAULT_FW_ROOT);
  const contract = loadCcBaseContract(fwRoot);
  const v = verifyCcBaseDir(ccSrcDir, { contract, fwRoot, requireInstaller: true });
  if (!v.ok) {
    return {
      ok: false,
      code: 2,
      error: `--bundle-cc 源目录不满足 cc-base 契约（${ccSrcDir}）：${v.problems.slice(0, 4).join('; ')}`,
    };
  }

  const srcRoot = v.rootDir;
  const dstBundled = path.join(path.resolve(stageRootDir), BUNDLED_CC_DIRNAME);
  fs.rmSync(dstBundled, { recursive: true, force: true });
  fs.mkdirSync(dstBundled, { recursive: true });

  let copiedFiles = 0;
  for (const rootFile of ['setup.sh', 'setup.ps1', 'README.md', 'ARCHITECTURE.md', '.gitignore']) {
    const srcFp = path.join(srcRoot, rootFile);
    const lst = lstatOrNull(srcFp);
    if (!lst || lst.isSymbolicLink() || !lst.isFile()) continue;
    const dstFp = path.join(dstBundled, rootFile);
    fs.copyFileSync(srcFp, dstFp);
    if (rootFile === 'setup.sh') {
      try {
        fs.chmodSync(dstFp, 0o755);
      } catch {
        /* ignore on Windows */
      }
    }
    copiedFiles++;
  }

  const srcClaude = path.join(srcRoot, '.claude');
  const dstClaude = path.join(dstBundled, '.claude');
  for (const rawDir of contract.requiredDirs || []) {
    const relDir = normalizeInClaudeRel(rawDir);
    fs.mkdirSync(path.join(dstClaude, ...relDir.split('/')), { recursive: true });
  }
  const visitClaude = (curDir) => {
    const entries = fs.readdirSync(curDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(curDir, ent.name);
      const relInClaude = toPosix(path.relative(srcClaude, full));
      if (ent.isDirectory()) {
        if (isExcludedFromCcBundleClaude(`${relInClaude}/x`)) continue;
        visitClaude(full);
      } else if (ent.isFile()) {
        if (isExcludedFromCcBundleClaude(relInClaude)) continue;
        const dstFull = path.join(dstClaude, ...relInClaude.split('/'));
        fs.mkdirSync(path.dirname(dstFull), { recursive: true });
        fs.copyFileSync(full, dstFull);
        if (relInClaude.endsWith('.sh')) {
          try {
            fs.chmodSync(dstFull, 0o755);
          } catch {
            /* ignore on Windows */
          }
        }
        copiedFiles++;
      }
    }
  };
  visitClaude(srcClaude);

  const fbTpl = path.join(srcClaude, 'feedback', 'templates', 'feedback-index-template.md');
  if (fs.existsSync(fbTpl) && statOrNull(fbTpl)?.isFile()) {
    const dstFbIdx = path.join(dstClaude, 'feedback', 'FEEDBACK-INDEX.md');
    fs.mkdirSync(path.dirname(dstFbIdx), { recursive: true });
    fs.copyFileSync(fbTpl, dstFbIdx);
    copiedFiles++;
  }

  const checkBundled = verifyCcBaseDir(dstBundled, { contract, fwRoot, requireInstaller: true });
  if (!checkBundled.ok) {
    return {
      ok: false,
      code: 1,
      error: `合包后的 .bundled-cc-base 未通过契约自检：${checkBundled.problems.join('; ')}`,
    };
  }

  return {
    ok: true,
    code: 0,
    bundledDir: dstBundled,
    copiedFiles,
    skillsCount: checkBundled.skillsCount,
    agentsCount: checkBundled.agentsCount,
  };
}

function buildSyntheticCcBase(dir, contract, markerText = 'v1') {
  const claude = path.join(dir, '.claude');
  fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'feedback', 'templates'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'CLAUDE.md'), `# Synthetic CLAUDE.md (${markerText})\nSiteMaster test constitution.\n`, 'utf8');
  fs.writeFileSync(path.join(claude, 'feedback', 'templates', 'feedback-index-template.md'), '# Feedback Index\n', 'utf8');
  fs.writeFileSync(path.join(claude, 'feedback', 'private-item.md'), '# Private feedback\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'progress.md'), '# Private progress\n', 'utf8');
  fs.writeFileSync(
    path.join(claude, 'settings.json'),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node',
                args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/session-rules-banner.mjs'],
              },
            ],
          },
        ],
      },
    }, null, 2) + '\n',
    'utf8',
  );
  for (let i = 1; i <= (contract.minSkills || 15); i++) {
    const skDir = path.join(claude, 'skills', `skill-${String(i).padStart(2, '0')}`);
    fs.mkdirSync(skDir, { recursive: true });
    fs.writeFileSync(path.join(skDir, 'SKILL.md'), `# Skill ${i}\n`, 'utf8');
  }
  const agentsDir = path.join(claude, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const role of contract.requiredAgents) {
    fs.writeFileSync(
      path.join(agentsDir, `${role}.md`),
      `---\nname: ${role}\ndescription: Role ${role}\nmodel: sonnet\n---\n\nBody for ${role}.\n`,
      'utf8',
    );
  }
  const hooksDir = path.join(claude, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const h of contract.requiredHooks) {
    fs.writeFileSync(path.join(hooksDir, h), '// synthetic hook\n', 'utf8');
  }
  fs.writeFileSync(
    path.join(dir, 'setup.sh'),
    [
      '#!/usr/bin/env bash',
      'set -eu',
      'target="."',
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      '    --hook-form) shift ;;',
      '    --dry-run) exit 0 ;;',
      '    -*) exit 2 ;;',
      '    *) target="$1" ;;',
      '  esac',
      '  shift',
      'done',
      'mkdir -p "$target/.claude"',
      'cp -R "$(dirname "$0")/.claude/." "$target/.claude/"',
      '',
    ].join('\n'),
    'utf8',
  );
  try {
    fs.chmodSync(path.join(dir, 'setup.sh'), 0o755);
  } catch {
    /* ignore on Windows */
  }
  fs.writeFileSync(
    path.join(dir, 'setup.ps1'),
    [
      'param([string]$Target = ".", [string]$HookForm = "", [switch]$DryRun, [switch]$Force)',
      'if ($DryRun) { exit 0 }',
      'New-Item -ItemType Directory -Path (Join-Path $Target ".claude") -Force | Out-Null',
      'Copy-Item -Path (Join-Path $PSScriptRoot ".claude\\*") -Destination (Join-Path $Target ".claude") -Recurse -Force',
      '',
    ].join('\r\n'),
    'utf8',
  );
}

function runSelftest() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-cc-dep-test-'));
  try {
    const contract = loadCcBaseContract(DEFAULT_FW_ROOT);
    const emptyDir = path.join(tmpBase, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });

    // 1. Empty directory fails verifyCcBaseDir
    const vEmpty = verifyCcBaseDir(emptyDir, { contract });
    if (vEmpty.ok) throw new Error('step 1 empty dir must fail verifyCcBaseDir');

    // 2. Synthetic compliant cc-base passes verifyCcBaseDir + bundleCcBaseIntoDir
    const fakeCc = path.join(tmpBase, 'fake-cc-base');
    buildSyntheticCcBase(fakeCc, contract, 'v1');
    const vFake = verifyCcBaseDir(fakeCc, { contract, requireInstaller: true });
    if (!vFake.ok) {
      throw new Error(`step 2 synthetic cc-base failed verifyCcBaseDir: ${vFake.problems.join('; ')}`);
    }

    // 3. Discovery priority: --cc-base -> bundled -> CC_BASE_DIR -> sibling -> deferred
    const fakeFw = path.join(tmpBase, 'ws', 'cursor-base');
    fs.mkdirSync(fakeFw, { recursive: true });
    fs.copyFileSync(path.join(DEFAULT_FW_ROOT, CC_CONTRACT_FILENAME), path.join(fakeFw, CC_CONTRACT_FILENAME));

    const dNone = discoverCcBaseSource(fakeFw, { contract, envCcBase: '', skipSibling: true });
    if (dNone.found) throw new Error('step 3 expected not found when isolated');

    const dEnv = discoverCcBaseSource(fakeFw, { contract, envCcBase: fakeCc, skipSibling: true });
    if (!dEnv.found || dEnv.source !== 'env') {
      throw new Error(`step 3 expected env source, got ${JSON.stringify(dEnv)}`);
    }

    const bundleRes = bundleCcBaseIntoDir(fakeCc, fakeFw, { fwRoot: fakeFw });
    if (!bundleRes.ok) {
      throw new Error(`step 4 bundleCcBaseIntoDir failed: ${bundleRes.error}`);
    }
    if (fs.existsSync(path.join(fakeFw, BUNDLED_CC_DIRNAME, 'progress.md'))) {
      throw new Error('step 4 bundleCcBaseIntoDir must strip progress.md');
    }
    if (fs.existsSync(path.join(fakeFw, BUNDLED_CC_DIRNAME, '.claude', 'feedback', 'private-item.md'))) {
      throw new Error('step 4 bundleCcBaseIntoDir must strip private feedback/*.md');
    }
    const dBundled = discoverCcBaseSource(fakeFw, { contract, envCcBase: fakeCc, skipSibling: true });
    if (!dBundled.found || dBundled.source !== 'bundled') {
      throw new Error(`step 4 expected bundled priority over env, got ${JSON.stringify(dBundled)}`);
    }

    // 5. Tier 3 deferred on --no-auto-cc
    const tDeferred = ensureUpstreamCcBase(emptyDir, {
      fwRoot: fakeFw,
      noAutoCc: true,
    });
    if (!tDeferred.ok || tDeferred.tier !== 3 || tDeferred.status !== 'deferred') {
      throw new Error(`step 5 expected tier 3 deferred, got ${JSON.stringify(tDeferred)}`);
    }

    // 6. Invalid explicit --cc-base fails with exit code 2
    const tBadExplicit = ensureUpstreamCcBase(emptyDir, {
      fwRoot: fakeFw,
      ccBase: path.join(tmpBase, 'does-not-exist'),
    });
    if (tBadExplicit.ok || tBadExplicit.code !== 2) {
      throw new Error(`step 6 expected code 2 on bad --cc-base, got ${JSON.stringify(tBadExplicit)}`);
    }

    // 7. Dry-run writes zero files
    const dryTarget = path.join(tmpBase, 'dry-target');
    const tDry = ensureUpstreamCcBase(dryTarget, {
      fwRoot: fakeFw,
      dryRun: true,
      skipSibling: true,
      envCcBase: '',
    });
    if (!tDry.ok || fs.existsSync(dryTarget)) {
      throw new Error(`step 7 dryRun must leave zero files, got ${JSON.stringify(tDry)}`);
    }

    // 8. Tier 2 install + Tier 1 reuse + --with-cc upgrade
    const targetProj = path.join(tmpBase, 'target-proj');
    const tInstall = ensureUpstreamCcBase(targetProj, {
      fwRoot: fakeFw,
      skipSibling: true,
      envCcBase: '',
    });
    if (!tInstall.ok || tInstall.tier !== 2 || tInstall.status !== 'installed') {
      throw new Error(`step 8 expected tier 2 installed, got ${JSON.stringify(tInstall)}`);
    }
    const tReuse = ensureUpstreamCcBase(targetProj, {
      fwRoot: fakeFw,
      skipSibling: true,
      envCcBase: '',
    });
    if (!tReuse.ok || tReuse.tier !== 1 || tReuse.status !== 'reused') {
      throw new Error(`step 8 expected tier 1 reused, got ${JSON.stringify(tReuse)}`);
    }

    const fakeCcV2 = path.join(tmpBase, 'fake-cc-v2');
    buildSyntheticCcBase(fakeCcV2, contract, 'v2');
    const tUpgrade = ensureUpstreamCcBase(targetProj, {
      fwRoot: fakeFw,
      withCc: true,
      ccBase: fakeCcV2,
    });
    if (!tUpgrade.ok || tUpgrade.status !== 'upgraded') {
      throw new Error(`step 8 expected upgraded with --with-cc, got ${JSON.stringify(tUpgrade)}`);
    }

    process.stdout.write(JSON.stringify({ ok: true, tests: 8 }) + '\n');
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  if (process.argv.includes('--selftest')) {
    runSelftest();
    process.exit(0);
  }
  process.stderr.write('usage: node scripts/lib/cc-dep.mjs --selftest\n');
  process.exit(2);
}
