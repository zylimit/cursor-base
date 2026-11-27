// # risk: high
// # levels: smoke, integration, all
// Independent end-to-end installer, security & 4-way coexistence integration test suite for cursor-base v3.0.0.
// Covers:
//   1. CLI strict argv, 15 bare typo subcommands, --no-auto-cc --with-cc / --cc-base mutual exclusion (exit 2),
//      path-guard, --dry-run zero writes, and POSIX setup.sh / setup-cursor.sh wrappers
//   2. 3-Tier decoupled cc-base co-installation:
//      - Tier 1: reuse existing .claude/ + auto-convert exec-form .claude/settings.json to string form (never touching .cac/settings.json) + --with-cc upgrade
//      - Tier 2: empty target auto-discovers ../cc-base (--hook-form string) one-step dual install with zero root files + CC_BASE_DIR priority
//      - Tier 3: --no-auto-cc deferred install + sessionStart self-healing (link, .mdc, agents/*.md, string form)
//      - release --bundle-cc offline single-archive dual install + BOTH success & failure paths asserting zero cursor-base-release-* residue in TMPDIR
//   3. 3x repeated install byte-for-byte idempotency, 3-way lossless upgrade (hooks.json / cli.json custom preservation,
//      .cursor-new conflict sidecar, --force .bak backup), and legacy v2 framework AGENTS.md archival vs user custom AGENTS.md preservation
//   4. F-01 anti-symlink traversal (.cursor -> .claude parent link, reverse same-realpath link, live leaf link into .claude/, dangling links,
//      verified via SHA-256 tree snapshots), stale/dead-PID/timed-out/dir/symlink lock recovery + fault injection, cross-engine uninstall refusal,
//      and zero-damage uninstall (.claude/ 100% SHA-256 intact)
//   5. 4-Way Coexistence Full Matrix Integration Test (Claude Code cc-base + CodeAgent cac-base-link + Antigravity agy-base + Cursor cursor-base
//      + standalone cac-base round-trip switch + all 3 bridge doctors + clean sequential uninstall preserving all 211 .claude/ files)

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { detectClaudeHookForm } from '../../scripts/lib/config-merge.mjs';
import { loadCcBaseContract } from '../../scripts/lib/cc-dep.mjs';
import { hashLfBuffer, walkRegularFiles } from '../../scripts/lib/manifest.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..', '..');
const CURSOR_CLI = path.join(REPO_ROOT, 'scripts', 'cursor-base.mjs');
const SETUP_SH = path.join(REPO_ROOT, 'setup.sh');
const SETUP_CURSOR_SH = path.join(REPO_ROOT, 'setup-cursor.sh');

const WORKSPACE_DIR = path.resolve(REPO_ROOT, '..');
const SIBLING_CC_BASE = path.join(WORKSPACE_DIR, 'cc-base');
const SIBLING_CAC_LINK_CLI = path.join(WORKSPACE_DIR, 'cac-base-link', 'scripts', 'cac-base-link.mjs');
const SIBLING_AGY_CLI = path.join(WORKSPACE_DIR, 'agy-base', 'scripts', 'agy-base.mjs');
const SIBLING_CAC_STANDALONE_CLI = path.join(WORKSPACE_DIR, 'cac-base', 'scripts', 'cac-base.mjs');

const HAS_REAL_CC_BASE = fs.existsSync(path.join(SIBLING_CC_BASE, '.claude', 'CLAUDE.md'));
const HAS_ALL_FOUR_SIBLINGS =
  HAS_REAL_CC_BASE &&
  fs.existsSync(SIBLING_CAC_LINK_CLI) &&
  fs.existsSync(SIBLING_AGY_CLI) &&
  fs.existsSync(SIBLING_CAC_STANDALONE_CLI);

const CONTRACT = loadCcBaseContract(REPO_ROOT);

function createOsDirLink(absLink, absTarget) {
  fs.mkdirSync(path.dirname(absLink), { recursive: true });
  if (process.platform === 'win32') {
    fs.symlinkSync(absTarget, absLink, 'junction');
  } else {
    fs.symlinkSync(path.relative(path.dirname(absLink), absTarget), absLink, 'dir');
  }
}

function createOsFileLink(absLink, absTarget) {
  fs.mkdirSync(path.dirname(absLink), { recursive: true });
  const target = process.platform === 'win32' ? absTarget : path.relative(path.dirname(absLink), absTarget);
  fs.symlinkSync(target, absLink, 'file');
}

function detachLinkSafe(p) {
  const lst = fs.lstatSync(p);
  if (!lst.isSymbolicLink()) throw new Error(`Expected symlink at ${p}`);
  if (process.platform === 'win32') {
    try {
      fs.rmdirSync(p);
      return;
    } catch {
      fs.unlinkSync(p);
      return;
    }
  }
  fs.unlinkSync(p);
}

function runNode(scriptPath, args = [], opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  if (opts.unsetEnv) {
    for (const k of opts.unsetEnv) delete env[k];
  }
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: opts.cwd || os.tmpdir(),
    env,
    input: opts.input,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = String(r.stdout || '');
  const stderr = String(r.stderr || '');
  const lastJsonLine = stdout.trim().split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{')) || '';
  let json = null;
  if (lastJsonLine) {
    try {
      json = JSON.parse(lastJsonLine);
    } catch {
      json = null;
    }
  }
  return { status: r.status ?? -1, stdout, stderr, json };
}

function snapshotTreeSha256(rootDir) {
  const map = new Map();
  if (!fs.existsSync(rootDir)) return map;
  for (const rel of walkRegularFiles(rootDir, rootDir)) {
    const full = path.join(rootDir, rel);
    const hex = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    map.set(rel, hex);
  }
  return map;
}

function assertSnapshotExact(expectedMap, actualDir, label) {
  const actualMap = snapshotTreeSha256(actualDir);
  assert.equal(
    actualMap.size,
    expectedMap.size,
    `File count mismatch (${label}): expected ${expectedMap.size}, got ${actualMap.size}`,
  );
  for (const [rel, expSha] of expectedMap.entries()) {
    assert.equal(actualMap.has(rel), true, `Missing file (${label}): ${rel}`);
    assert.equal(actualMap.get(rel), expSha, `SHA-256 mismatch (${label}): ${rel}`);
  }
}

function rawFileSha256(fp) {
  return createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
}

function findDeadPid() {
  for (let cand = 999991; cand >= 400000; cand -= 7919) {
    try {
      process.kill(cand, 0);
    } catch (e) {
      if (e && e.code === 'ESRCH') return cand;
    }
  }
  return 999999;
}

function resolveTarCommand() {
  if (process.platform === 'win32') {
    const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(sysTar)) return { bin: sysTar, extraFlags: [] };
    const probe = spawnSync('tar', ['--help'], { encoding: 'utf8', shell: false, windowsHide: true });
    if (`${probe.stdout || ''}\n${probe.stderr || ''}`.includes('--force-local')) {
      return { bin: 'tar', extraFlags: ['--force-local'] };
    }
  }
  return { bin: 'tar', extraFlags: [] };
}

function seedSyntheticCcBase(dir, { withInstallers = false, markerTag = 'v1', hookForm = 'string' } = {}) {
  const claude = path.join(dir, '.claude');
  fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'feedback', 'templates'), { recursive: true });
  fs.writeFileSync(
    path.join(claude, 'CLAUDE.md'),
    `# CLAUDE.md (${markerTag})\nSiteMaster constitution.\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(claude, 'rules', 'core.md'), `# Core (${markerTag})\n`, 'utf8');
  fs.writeFileSync(path.join(claude, 'feedback', 'templates', 'feedback-index-template.md'), '# Feedback Index\n', 'utf8');

  const hookEntry = hookForm === 'exec'
    ? {
        type: 'command',
        command: 'node',
        args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/session-rules-banner.mjs'],
        timeout: 5,
      }
    : {
        type: 'command',
        command: 'node .claude/hooks/session-rules-banner.mjs',
        timeout: 5,
      };
  fs.writeFileSync(
    path.join(claude, 'settings.json'),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [hookEntry] }] } }, null, 2) + '\n',
    'utf8',
  );

  for (let i = 1; i <= (CONTRACT.minSkills || 15); i += 1) {
    const name = `skill-${String(i).padStart(2, '0')}`;
    const skDir = path.join(claude, 'skills', name);
    fs.mkdirSync(path.join(skDir, 'refs'), { recursive: true });
    fs.writeFileSync(path.join(skDir, 'SKILL.md'), `---\nname: ${name}\n---\n# ${name} (${markerTag})\n`, 'utf8');
    fs.writeFileSync(path.join(skDir, 'refs', 'guide.md'), `Guide ${i} (${markerTag})\n`, 'utf8');
  }

  fs.mkdirSync(path.join(claude, 'agents'), { recursive: true });
  for (const role of CONTRACT.requiredAgents) {
    fs.writeFileSync(
      path.join(claude, 'agents', `${role}.md`),
      `---\nname: ${role}\ndescription: Role ${role} (${markerTag})\nmodel: sonnet\ndisallowedTools: Task\n---\n\nRole ${role} (${markerTag}).\n`,
      'utf8',
    );
  }

  fs.mkdirSync(path.join(claude, 'hooks'), { recursive: true });
  for (const h of CONTRACT.requiredHooks) {
    fs.writeFileSync(path.join(claude, 'hooks', h), `// hook ${h} (${markerTag})\n`, 'utf8');
  }

  if (withInstallers) {
    fs.writeFileSync(path.join(dir, 'progress.md'), '# Private upstream progress (must be stripped in bundle)\n', 'utf8');
    fs.mkdirSync(path.join(claude, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(claude, 'tests', 'private.test.mjs'), '// strip me\n', 'utf8');
    fs.writeFileSync(path.join(claude, 'feedback', 'private-note.md'), '# strip me\n', 'utf8');

    const shPath = path.join(dir, 'setup.sh');
    fs.writeFileSync(
      shPath,
      [
        '#!/usr/bin/env bash',
        'set -eu',
        'DRY=0',
        'FORM="exec"',
        'TARGET="."',
        'while [ $# -gt 0 ]; do',
        '  case "$1" in',
        '    --dry-run) DRY=1; shift ;;',
        '    --hook-form) FORM="$2"; shift 2 ;;',
        '    *) TARGET="$1"; shift ;;',
        '  esac',
        'done',
        'if [ "$DRY" = "1" ]; then exit 0; fi',
        'SRC="$(cd "$(dirname "$0")" && pwd)"',
        'mkdir -p "$TARGET/.claude"',
        'cp -R "$SRC/.claude/." "$TARGET/.claude/"',
        'if [ "$FORM" = "string" ]; then',
        '  node -e "const fs=require(\'fs\'),p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,\'utf8\'));d.hooks.SessionStart[0].hooks=[{type:\'command\',command:\'node .claude/hooks/session-rules-banner.mjs\',timeout:5}];fs.writeFileSync(p,JSON.stringify(d,null,2)+\'\\n\');" "$TARGET/.claude/settings.json"',
        'fi',
      ].join('\n') + '\n',
      'utf8',
    );
    if (process.platform !== 'win32') fs.chmodSync(shPath, 0o755);

    fs.writeFileSync(
      path.join(dir, 'setup.ps1'),
      [
        'param([string]$Target = ".", [string]$HookForm = "exec", [switch]$DryRun, [switch]$Force)',
        'if ($DryRun) { exit 0 }',
        '$dst = Join-Path $Target ".claude"',
        'New-Item -ItemType Directory -Path $dst -Force | Out-Null',
        'Copy-Item -Path (Join-Path $PSScriptRoot ".claude\\*") -Destination $dst -Recurse -Force',
        'if ($HookForm -eq "string") {',
        '  node -e "const fs=require(\'fs\'),p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,\'utf8\'));d.hooks.SessionStart[0].hooks=[{type:\'command\',command:\'node .claude/hooks/session-rules-banner.mjs\',timeout:5}];fs.writeFileSync(p,JSON.stringify(d,null,2)+\'\\n\');" (Join-Path $dst "settings.json")',
        '}',
      ].join('\r\n') + '\r\n',
      'utf8',
    );
  }
}

describe('cursor-base Zero-Copy Link Installer, Anti-Symlink & 4-Way Coexistence Suite', () => {
  let tmpRoot = '';
  let seq = 0;
  const nextDir = (label) => path.join(tmpRoot, `${String(++seq).padStart(2, '0')}-${label}`);

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-link-installer-test-'));
  });

  after(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  describe('1. CLI Strict Argv, Bare Typo Guards, Mutually Exclusive Flags, Path Guard & Wrappers', () => {
    it('rejects --no-auto-cc combined with --with-cc or --cc-base with exit 2 and zero mkdir', () => {
      const t1 = nextDir('mut-with-cc');
      const r1 = runNode(CURSOR_CLI, ['install', '--target', t1, '--no-auto-cc', '--with-cc']);
      assert.equal(r1.status, 2);
      assert.equal(fs.existsSync(t1), false);

      const t2 = nextDir('mut-cc-base');
      const r2 = runNode(CURSOR_CLI, ['install', '--target', t2, '--no-auto-cc', '--cc-base', tmpRoot]);
      assert.equal(r2.status, 2);
      assert.equal(fs.existsSync(t2), false);
    });

    it('rejects all 15 bare typo subcommands, unknown flags, invalid --hook-form, duplicate target, and self-install with exit 2', () => {
      const cwdGuard = nextDir('typo-cwd');
      fs.mkdirSync(cwdGuard, { recursive: true });

      const typos = [
        'package', 'pack', 'bundle', 'check', 'verify', 'test', 'tests',
        'lint', 'audit', 'status', 'init', 'update', 'remove', 'clean', 'version',
      ];
      for (const word of typos) {
        const r = runNode(CURSOR_CLI, [word], { cwd: cwdGuard });
        assert.equal(r.status, 2, `Expected exit 2 for bare typo "${word}", got ${r.status}`);
        assert.equal(fs.existsSync(path.join(cwdGuard, word)), false, `Must NOT mkdir "${word}"`);
      }

      assert.equal(runNode(CURSOR_CLI, ['--dryrun'], { cwd: cwdGuard }).status, 2);
      assert.equal(fs.existsSync(path.join(cwdGuard, '--dryrun')), false);
      assert.equal(runNode(CURSOR_CLI, ['install', '--hook-form', 'invalid', '--target', nextDir('bad-hf')]).status, 2);
      assert.equal(runNode(CURSOR_CLI, ['install', nextDir('dup-a'), '--target', nextDir('dup-b')]).status, 2);
      assert.equal(runNode(CURSOR_CLI, ['install', '--target', REPO_ROOT]).status, 2);
    });

    it('enforces path-guard (CON/nul/LPT1/../etc) with exit 2 and --dry-run with zero filesystem writes', () => {
      for (const unsafeSeg of ['CON', 'nul', 'LPT1.tar.gz', 'trail.', 'trail ']) {
        const cand = `${tmpRoot}/pg/${unsafeSeg}`;
        const r = runNode(CURSOR_CLI, ['install', '--no-auto-cc', cand]);
        assert.equal(r.status, 2, `Expected exit 2 for unsafe target segment ${JSON.stringify(unsafeSeg)}`);
        assert.equal(fs.existsSync(cand), false);
      }
      assert.equal(runNode(CURSOR_CLI, ['install', '--no-auto-cc', '../escape-outside'], { cwd: tmpRoot }).status, 2);
      assert.equal(runNode(CURSOR_CLI, ['install', '--no-auto-cc', `${tmpRoot}/pg/../escape-outside`]).status, 2);
      assert.equal(runNode(CURSOR_CLI, ['install', '--no-auto-cc', '/etc/cursor-forbidden']).status, 2);

      const dryTarget = nextDir('dry-run-zero');
      const rDry = runNode(CURSOR_CLI, ['install', '--no-auto-cc', '--dry-run', '--target', dryTarget, '--json']);
      assert.equal(rDry.status, 0, rDry.stderr);
      assert.equal(rDry.json?.dryRun, true);
      assert.equal(fs.existsSync(dryTarget), false, '--dry-run must never create target directory');

      if (process.platform !== 'win32') {
        const shHelp = spawnSync('sh', [SETUP_SH, '--help'], { cwd: tmpRoot, encoding: 'utf8', windowsHide: true });
        assert.equal(shHelp.status, 0);
        const shBad = spawnSync('sh', [SETUP_SH, '--dryrun'], { cwd: tmpRoot, encoding: 'utf8', windowsHide: true });
        assert.equal(shBad.status, 2);
        const aliasHelp = spawnSync('sh', [SETUP_CURSOR_SH, '--help'], { cwd: tmpRoot, encoding: 'utf8', windowsHide: true });
        assert.equal(aliasHelp.status, 0);
      }
    });
  });

  describe('2. Three-Tier Decoupled cc-base Co-Install & Offline Bundle Release', () => {
    it('Tier 1: reuses existing .claude/, converts exec-form .claude/settings.json to string form without touching .cac/settings.json, and upgrades via --with-cc', () => {
      const target = nextDir('tier1-reuse-convert');
      seedSyntheticCcBase(target, { hookForm: 'exec', markerTag: 'v1-init' });

      // Seed both a custom user hook in .claude/settings.json AND a .cac/settings.json to verify zero collateral mutation
      const claudeSettingsPath = path.join(target, '.claude', 'settings.json');
      const execSettings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/session-rules-banner.mjs'], timeout: 5 },
                { type: 'command', command: 'node', args: ['.claude/hooks/no-direct-code-guard.mjs'], timeout: 5 },
                { type: 'command', command: 'node', args: ['scripts/user-private-hook.mjs'], timeout: 3 },
              ],
            },
          ],
        },
      };
      fs.writeFileSync(claudeSettingsPath, JSON.stringify(execSettings, null, 2) + '\n', 'utf8');

      const cacSettingsPath = path.join(target, '.cac', 'settings.json');
      fs.mkdirSync(path.dirname(cacSettingsPath), { recursive: true });
      const cacRaw = JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: ['.cac/hooks/cc-bridge.mjs', 'session-start'] }] }] },
      }, null, 2) + '\n';
      fs.writeFileSync(cacSettingsPath, cacRaw, 'utf8');

      const r1 = runNode(CURSOR_CLI, ['install', '--target', target, '--json']);
      assert.equal(r1.status, 0, r1.stderr);
      assert.equal(r1.json?.ccBase?.tier, 1);
      assert.equal(r1.json?.ccBase?.status, 'reused');
      assert.equal(r1.json?.pendingCcBase, false);

      const convertedClaude = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
      assert.equal(detectClaudeHookForm(convertedClaude), 'string');
      const hs = convertedClaude.hooks.SessionStart[0].hooks;
      assert.equal(hs[0].command, 'node .claude/hooks/session-rules-banner.mjs');
      assert.equal('args' in hs[0], false);
      assert.equal(hs[1].command, 'node .claude/hooks/no-direct-code-guard.mjs');
      assert.equal('args' in hs[1], false);
      assert.deepEqual(hs[2].args, ['scripts/user-private-hook.mjs'], 'non-.claude/hooks user hook must stay untouched');
      assert.equal(fs.readFileSync(cacSettingsPath, 'utf8'), cacRaw, '.cac/settings.json must NEVER be mutated');

      // Upgrade .claude/ in-place via --with-cc --cc-base <v2>
      const ccV2 = nextDir('tier1-cc-v2-src');
      seedSyntheticCcBase(ccV2, { withInstallers: true, markerTag: 'v2-upgraded', hookForm: 'exec' });
      const rUpg = runNode(CURSOR_CLI, ['upgrade', '--with-cc', '--cc-base', ccV2, '--target', target, '--json']);
      assert.equal(rUpg.status, 0, rUpg.stderr);
      assert.equal(rUpg.json?.ccBase?.status, 'upgraded');
      assert.equal(rUpg.json?.ccBase?.source, 'explicit');
      assert.match(fs.readFileSync(path.join(target, '.claude', 'CLAUDE.md'), 'utf8'), /v2-upgraded/);
      assert.match(fs.readFileSync(path.join(target, '.cursor', 'rules', 'cc-base-claude.mdc'), 'utf8'), /v2-upgraded/);
    });

    it('Tier 2: empty target auto-discovers ../cc-base (and CC_BASE_DIR override) with --hook-form string and zero root files', () => {
      const autoTarget = nextDir('tier2-empty-auto');
      const fallbackCc = nextDir('tier2-fallback-cc');
      if (!HAS_REAL_CC_BASE) seedSyntheticCcBase(fallbackCc, { withInstallers: true, markerTag: 'env-fallback' });

      const rAuto = runNode(CURSOR_CLI, ['install', '--target', autoTarget, '--json'], {
        env: HAS_REAL_CC_BASE ? {} : { CC_BASE_DIR: fallbackCc },
        unsetEnv: HAS_REAL_CC_BASE ? ['CC_BASE_DIR', 'CURSOR_BASE_NO_AUTO_CC', 'CURSOR_BASE_NO_SIBLING_CC'] : ['CURSOR_BASE_NO_AUTO_CC'],
      });
      assert.equal(rAuto.status, 0, rAuto.stderr);
      assert.equal(rAuto.json?.ccBase?.tier, 2);
      assert.equal(rAuto.json?.ccBase?.status, 'installed');
      assert.equal(rAuto.json?.ccBase?.source, HAS_REAL_CC_BASE ? 'sibling' : 'env');
      assert.equal(rAuto.json?.pendingCcBase, false);

      // Zero visible root files: ONLY .claude and .cursor
      assert.deepEqual(fs.readdirSync(autoTarget).sort(), ['.claude', '.cursor']);
      const claudeSettings = JSON.parse(fs.readFileSync(path.join(autoTarget, '.claude', 'settings.json'), 'utf8'));
      assert.equal(detectClaudeHookForm(claudeSettings), 'string');
      assert.equal(fs.lstatSync(path.join(autoTarget, '.cursor', 'skills')).isSymbolicLink(), true);
      assert.equal(fs.existsSync(path.join(autoTarget, '.cursor', 'rules', 'cc-base-claude.mdc')), true);
      assert.equal(runNode(path.join(autoTarget, '.cursor', 'scripts', 'doctor.mjs'), [autoTarget, '--json']).status, 0);

      // CC_BASE_DIR takes higher priority over ../cc-base (`source: "env"`)
      const envCcSrc = nextDir('tier2-env-override-src');
      seedSyntheticCcBase(envCcSrc, { withInstallers: true, markerTag: 'env-priority-88' });
      const envTarget = nextDir('tier2-env-override-target');
      const rEnv = runNode(CURSOR_CLI, ['install', '--target', envTarget, '--json'], {
        env: { CC_BASE_DIR: envCcSrc },
      });
      assert.equal(rEnv.status, 0, rEnv.stderr);
      assert.equal(rEnv.json?.ccBase?.source, 'env');
      assert.match(fs.readFileSync(path.join(envTarget, '.claude', 'CLAUDE.md'), 'utf8'), /env-priority-88/);

      // Invalid explicit --cc-base fails with exit 2
      const badCc = nextDir('invalid-cc-src');
      fs.mkdirSync(badCc, { recursive: true });
      assert.equal(runNode(CURSOR_CLI, ['install', '--cc-base', badCc, '--target', nextDir('bad-cc-dst')]).status, 2);
    });

    it('Tier 3: --no-auto-cc deferred install + sessionStart auto-heals link, cc-base-claude.mdc, agents/*.md, and string form', () => {
      const target = nextDir('tier3-deferred');
      const rPre = runNode(CURSOR_CLI, ['install', '--no-auto-cc', '--target', target, '--json']);
      assert.equal(rPre.status, 0, rPre.stderr);
      assert.equal(rPre.json?.ccBase?.tier, 3);
      assert.equal(rPre.json?.ccBase?.status, 'deferred');
      assert.equal(rPre.json?.pendingCcBase, true);
      assert.deepEqual(fs.readdirSync(target).sort(), ['.cursor']);
      assert.equal(fs.existsSync(path.join(target, '.cursor', 'skills')), false);
      assert.equal(fs.existsSync(path.join(target, '.cursor', 'rules', 'cc-base-claude.mdc')), false);

      // Now place .claude/ (with exec-form settings.json) and fire sessionStart
      seedSyntheticCcBase(target, { hookForm: 'exec', markerTag: 'arrived-later' });
      const adapter = path.join(target, '.cursor', 'scripts', 'hook-adapter.mjs');
      const rHeal = runNode(adapter, ['sessionStart'], {
        cwd: target,
        input: JSON.stringify({ cwd: target }),
        unsetEnv: ['CLAUDE_PROJECT_DIR', 'CURSOR_PROJECT_DIR'],
      });
      assert.equal(rHeal.status, 0, rHeal.stderr);

      assert.equal(fs.lstatSync(path.join(target, '.cursor', 'skills')).isSymbolicLink(), true);
      assert.equal(fs.existsSync(path.join(target, '.cursor', 'rules', 'cc-base-claude.mdc')), true);
      assert.equal(fs.existsSync(path.join(target, '.cursor', 'agents', 'implementer.md')), true);
      const afterSettings = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'settings.json'), 'utf8'));
      assert.equal(detectClaudeHookForm(afterSettings), 'string');
      assert.equal(runNode(path.join(target, '.cursor', 'scripts', 'doctor.mjs'), [target, '--json']).status, 0);
    });

    it('release --bundle-cc packs offline dual-install archive and cleans TMPDIR cursor-base-release-* on BOTH success and failure', () => {
      const tarCmd = resolveTarCommand();
      const tmpSandbox = nextDir('release-tmp-sandbox');
      fs.mkdirSync(tmpSandbox, { recursive: true });
      const tmpEnv = { TMPDIR: tmpSandbox, TMP: tmpSandbox, TEMP: tmpSandbox };

      const assertZeroReleaseResidue = (ctxLabel) => {
        const leftover = fs.readdirSync(tmpSandbox).filter((n) => n.startsWith('cursor-base-release-'));
        assert.deepEqual(leftover, [], `TMPDIR must have 0 cursor-base-release-* residue (${ctxLabel})`);
      };

      // 1. Success Path A: Slim release (without --bundle-cc)
      const slimOut = path.join(nextDir('slim-out'), 'cursor-base-v3.0.0-slim.tar.gz');
      const rSlim = runNode(CURSOR_CLI, ['release', 'v3.0.0-slim', '--out', slimOut], { env: tmpEnv });
      assert.equal(rSlim.status, 0, `${rSlim.stderr}\n${rSlim.stdout}`);
      assert.equal(rSlim.json?.bundledCcBase, false);
      assertZeroReleaseResidue('after slim release success');

      // 2. Success Path B: Offline bundled release (`release --bundle-cc <src>`) + air-gapped unpack & install
      const ccBundleSrc = nextDir('bundle-cc-src');
      seedSyntheticCcBase(ccBundleSrc, { withInstallers: true, markerTag: 'bundled-offline-v3' });
      const bundleOut = path.join(nextDir('bundle-out'), 'cursor-base-v3.0.0-offline.tar.gz');
      const rBundle = runNode(
        CURSOR_CLI,
        ['release', 'v3.0.0-offline', '--bundle-cc', ccBundleSrc, '--out', bundleOut],
        { env: tmpEnv },
      );
      assert.equal(rBundle.status, 0, `${rBundle.stderr}\n${rBundle.stdout}`);
      assert.equal(rBundle.json?.bundledCcBase, true);
      assertZeroReleaseResidue('after --bundle-cc release success');

      const airgapParent = nextDir('airgap-zone');
      fs.mkdirSync(airgapParent, { recursive: true });
      const untar = spawnSync(tarCmd.bin, [...tarCmd.extraFlags, '-xzf', bundleOut, '-C', airgapParent], {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      assert.equal(untar.status, 0, untar.stderr);

      const unpackedFw = path.join(airgapParent, 'cursor-base-v3.0.0-offline');
      assert.equal(fs.existsSync(path.join(unpackedFw, '.bundled-cc-base', '.claude', 'CLAUDE.md')), true);
      assert.equal(fs.existsSync(path.join(unpackedFw, '.bundled-cc-base', 'progress.md')), false);
      assert.equal(fs.existsSync(path.join(unpackedFw, '.bundled-cc-base', '.claude', 'tests')), false);
      assert.equal(fs.existsSync(path.join(unpackedFw, '.bundled-cc-base', '.claude', 'feedback', 'private-note.md')), false);

      const airgapTarget = nextDir('airgap-target-proj');
      const rOfflineInst = runNode(
        path.join(unpackedFw, 'scripts', 'cursor-base.mjs'),
        ['install', '--target', airgapTarget, '--json'],
        {
          cwd: airgapParent,
          env: { CURSOR_BASE_NO_SIBLING_CC: '1' },
          unsetEnv: ['CC_BASE_DIR', 'CURSOR_BASE_NO_AUTO_CC'],
        },
      );
      assert.equal(rOfflineInst.status, 0, rOfflineInst.stderr);
      assert.equal(rOfflineInst.json?.ccBase?.tier, 2);
      assert.equal(rOfflineInst.json?.ccBase?.source, 'bundled');
      assert.deepEqual(fs.readdirSync(airgapTarget).sort(), ['.claude', '.cursor']);
      assert.equal(runNode(path.join(airgapTarget, '.cursor', 'scripts', 'doctor.mjs'), [airgapTarget, '--json']).status, 0);

      // 3. Failure Path A: Invalid --bundle-cc source directory -> exits 2, zero residue in TMPDIR
      const invalidCc = nextDir('invalid-bundle-cc');
      fs.mkdirSync(invalidCc, { recursive: true });
      const rFailPre = runNode(
        CURSOR_CLI,
        ['release', 'v3.0.0-badcc', '--bundle-cc', invalidCc, '--out', path.join(tmpRoot, 'never.tar.gz')],
        { env: tmpEnv },
      );
      assert.equal(rFailPre.status, 2);
      assertZeroReleaseResidue('after invalid --bundle-cc failure');

      // 4. Failure Path B: Simulated tar archive failure AFTER mkdtempSync('cursor-base-release-*') -> exits 1, finally cleans TMPDIR!
      if (process.platform !== 'win32') {
        const fakeBinDir = nextDir('fake-failing-tar-bin');
        fs.mkdirSync(fakeBinDir, { recursive: true });
        fs.writeFileSync(
          path.join(fakeBinDir, 'tar'),
          `#!${process.execPath}\nprocess.stderr.write('simulated tar failure\\n'); process.exit(1);\n`,
          { encoding: 'utf8', mode: 0o755 },
        );
        const rFailMid = runNode(
          CURSOR_CLI,
          ['release', 'v3.0.0-tarfail', '--out', path.join(tmpRoot, 'tarfail.tar.gz')],
          {
            env: {
              ...tmpEnv,
              PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH || ''}`,
            },
          },
        );
        assert.equal(rFailMid.status, 1);
        assertZeroReleaseResidue('after mid-flight tar failure inside handleRelease');
      }
    });
  });

  describe('3. 3x Idempotency, 3-Way Lossless Upgrade & Legacy v2 AGENTS.md Migration', () => {
    it('is byte-for-byte idempotent across 3x repeated installs and performs lossless 3-way upgrade (.cursor-new + --force .bak)', () => {
      const target = nextDir('idempotent-and-upgrade');
      seedSyntheticCcBase(target);

      // Install #1
      const r1 = runNode(CURSOR_CLI, ['install', '--target', target, '--json']);
      assert.equal(r1.status, 0, r1.stderr);
      const snapCursor1 = snapshotTreeSha256(path.join(target, '.cursor'));

      // Install #2 & #3 -> 0 writes, byte-for-byte identical
      for (const round of [2, 3]) {
        const rr = runNode(CURSOR_CLI, ['install', '--target', target, '--json']);
        assert.equal(rr.status, 0, `round ${round}: ${rr.stderr}`);
        assert.equal(rr.json?.stats?.create, 0);
        assert.equal(rr.json?.stats?.update, 0);
        assert.equal(rr.json?.stats?.conflict, 0);
        assert.equal(rr.json?.writtenCount, 0);
      }
      assertSnapshotExact(snapCursor1, path.join(target, '.cursor'), 'after 3x idempotent install');

      // Prepare 3-way upgrade scenario:
      // a) Add user custom hook + legacy v2 hook into .cursor/hooks.json
      const hooksPath = path.join(target, '.cursor', 'hooks.json');
      const hooksObj = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      hooksObj.customTeamField = 'keep-me';
      hooksObj.hooks.sessionStart.unshift({ command: 'node .cursor/runtime/harness.mjs sessionStart', timeout: 5 });
      hooksObj.hooks.stop = [{ command: 'node scripts/team-stop.mjs', timeout: 5 }];
      fs.writeFileSync(hooksPath, JSON.stringify(hooksObj, null, 2) + '\n', 'utf8');

      // b) Add user custom allow/deny into .cursor/cli.json
      const cliPath = path.join(target, '.cursor', 'cli.json');
      const cliObj = JSON.parse(fs.readFileSync(cliPath, 'utf8'));
      cliObj.permissions.allow.push('Shell(npm:run*)');
      cliObj.permissions.deny.push('Read(**/corp-vault.txt)');
      fs.writeFileSync(cliPath, JSON.stringify(cliObj, null, 2) + '\n', 'utf8');

      // c) Simulate unmodified older framework doctor.mjs + obsolete managed file + v2 cc-base-files.txt
      const docRel = '.cursor/scripts/doctor.mjs';
      const docFull = path.join(target, docRel);
      const latestDocText = fs.readFileSync(docFull, 'utf8');
      const oldDocText = '// older unmodified v3.0.0-rc doctor\nprocess.exit(0);\n';
      fs.writeFileSync(docFull, oldDocText, 'utf8');

      const obsRel = '.cursor/scripts/obsolete-helper.mjs';
      const obsFull = path.join(target, obsRel);
      const obsText = '// obsolete managed script\n';
      fs.writeFileSync(obsFull, obsText, 'utf8');
      fs.writeFileSync(path.join(target, '.cursor', 'cc-base-files.txt'), 'old\n', 'utf8');

      const manPath = path.join(target, '.cursor', 'FRAMEWORK-MANIFEST.json');
      const manObj = JSON.parse(fs.readFileSync(manPath, 'utf8'));
      const docItem = manObj.files.find((f) => f.path === docRel);
      const oldHash = hashLfBuffer(oldDocText);
      docItem.sha256 = oldHash.sha256;
      docItem.bytes = oldHash.bytes;
      const obsHash = hashLfBuffer(obsText);
      manObj.files.push({ path: obsRel, sha256: obsHash.sha256, bytes: obsHash.bytes });
      fs.writeFileSync(manPath, JSON.stringify(manObj, null, 2) + '\n', 'utf8');

      // d) User hand-modifies managed .cursor/rules/cc-base-cursor-host.mdc -> must trigger conflict .cursor-new
      const hostRel = '.cursor/rules/cc-base-cursor-host.mdc';
      const hostFull = path.join(target, hostRel);
      const origHostText = fs.readFileSync(hostFull, 'utf8');
      const userEditedHostText = `${origHostText}\n<!-- Team Custom Cursor Host Note -->\n`;
      fs.writeFileSync(hostFull, userEditedHostText, 'utf8');

      const rUpg = runNode(CURSOR_CLI, ['upgrade', '--target', target, '--json']);
      assert.equal(rUpg.status, 0, rUpg.stderr);
      assert.deepEqual(rUpg.json?.conflicts, [hostRel]);

      // Verify lossless merges, obsolete pruning, .bak on unmodified update, and .cursor-new on conflict
      const mergedHooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      assert.equal(mergedHooks.customTeamField, 'keep-me');
      assert.equal(mergedHooks.hooks.stop[0].command, 'node scripts/team-stop.mjs');
      assert.equal(
        mergedHooks.hooks.sessionStart.some((h) => h.command.includes('runtime/harness.mjs')),
        false,
        'legacy v2 hook must be cleaned during merge',
      );

      const mergedCli = JSON.parse(fs.readFileSync(cliPath, 'utf8'));
      assert.equal(mergedCli.permissions.allow.includes('Shell(npm:run*)'), true);
      assert.equal(mergedCli.permissions.deny.includes('Read(**/corp-vault.txt)'), true);

      assert.equal(fs.readFileSync(docFull, 'utf8'), latestDocText);
      assert.equal(fs.readFileSync(`${docFull}.bak`, 'utf8'), oldDocText);
      assert.equal(fs.existsSync(obsFull), false, 'obsolete managed file must be pruned');
      assert.equal(fs.existsSync(path.join(target, '.cursor', 'cc-base-files.txt')), false);

      assert.equal(fs.readFileSync(hostFull, 'utf8'), userEditedHostText);
      assert.equal(fs.readFileSync(`${hostFull}.cursor-new`, 'utf8'), origHostText);

      // upgrade --force overwrites conflict and backs up user edit to .bak
      fs.unlinkSync(`${hostFull}.cursor-new`);
      const rForce = runNode(CURSOR_CLI, ['upgrade', '--force', '--target', target, '--json']);
      assert.equal(rForce.status, 0, rForce.stderr);
      assert.deepEqual(rForce.json?.conflicts, []);
      assert.equal(fs.readFileSync(hostFull, 'utf8'), origHostText);
      assert.equal(fs.readFileSync(`${hostFull}.bak`, 'utf8'), userEditedHostText);
    });

    it('archives legacy v2 cursor-base AGENTS.md + physical .cursor/skills while preserving user custom AGENTS.md untouched', () => {
      // Case A: Exact v2 framework AGENTS.md signature -> archived into .cursor/.runtime/migrated-v2-*
      const v2Proj = nextDir('v2-agents-archive');
      seedSyntheticCcBase(v2Proj);
      fs.writeFileSync(
        path.join(v2Proj, 'AGENTS.md'),
        '# cursor-base v2.2\n\n本仓是 cc-base（Claude Code 产品开发框架）的 Cursor 发行版。\n',
        'utf8',
      );
      fs.mkdirSync(path.join(v2Proj, '.cursor', 'skills', 'old-v2-skill'), { recursive: true });
      fs.writeFileSync(path.join(v2Proj, '.cursor', 'skills', 'old-v2-skill', 'SKILL.md'), '# v2 skill\n', 'utf8');

      const rV2 = runNode(CURSOR_CLI, ['install', '--target', v2Proj, '--json']);
      assert.equal(rV2.status, 0, rV2.stderr);
      assert.equal(fs.existsSync(path.join(v2Proj, 'AGENTS.md')), false, 'legacy v2 AGENTS.md must be archived out of root');
      assert.deepEqual(fs.readdirSync(v2Proj).sort(), ['.claude', '.cursor']);
      assert.equal(rV2.json?.migratedPaths?.length, 2);
      for (const mp of rV2.json.migratedPaths) {
        assert.equal(fs.existsSync(mp), true, `migrated backup must exist at ${mp}`);
      }

      // Case B: User custom AGENTS.md -> preserved 100% byte-for-byte
      const userProj = nextDir('user-custom-agents');
      seedSyntheticCcBase(userProj);
      const customAgentsText = '# cursor-base notes for our team\n\nCustom project rules — must never be archived!\n';
      fs.writeFileSync(path.join(userProj, 'AGENTS.md'), customAgentsText, 'utf8');

      const rUser = runNode(CURSOR_CLI, ['install', '--target', userProj, '--json']);
      assert.equal(rUser.status, 0, rUser.stderr);
      assert.equal(fs.readFileSync(path.join(userProj, 'AGENTS.md'), 'utf8'), customAgentsText);
    });
  });

  describe('4. F-01 Anti-Symlink Traversal, Crash/Stale Lock Recovery & Cross-Engine / Zero-Damage Uninstall', () => {
    it('F-01: protects .claude/ (verified via SHA-256 tree snapshots) against parent .cursor->.claude, reverse same-realpath, live leaf, and dangling symlinks', () => {
      // 1. Parent symlink `.cursor -> .claude`
      const tParent = nextDir('f01-parent-sym');
      seedSyntheticCcBase(tParent, { hookForm: 'string' });
      const snapParent = snapshotTreeSha256(path.join(tParent, '.claude'));
      createOsDirLink(path.join(tParent, '.cursor'), path.join(tParent, '.claude'));

      const rUnRefuse = runNode(CURSOR_CLI, ['uninstall', '--target', tParent, '--json']);
      assert.equal(rUnRefuse.status, 2, 'non-force uninstall must refuse symlinked .cursor');
      assertSnapshotExact(snapParent, path.join(tParent, '.claude'), 'after refused uninstall on .cursor->.claude');

      const rInstParent = runNode(CURSOR_CLI, ['install', '--target', tParent, '--json']);
      assert.equal(rInstParent.status, 0, rInstParent.stderr);
      assert.equal(fs.lstatSync(path.join(tParent, '.cursor')).isSymbolicLink(), false);
      assert.equal(fs.lstatSync(path.join(tParent, '.cursor', 'skills')).isSymbolicLink(), true);
      assertSnapshotExact(snapParent, path.join(tParent, '.claude'), 'after install over .cursor->.claude');

      // 2. Subdir symlinks `.cursor/rules -> ../.claude/rules` and `.cursor/.runtime -> ../.claude`
      const tSub = nextDir('f01-subdir-sym');
      seedSyntheticCcBase(tSub, { hookForm: 'string' });
      const snapSub = snapshotTreeSha256(path.join(tSub, '.claude'));
      createOsDirLink(path.join(tSub, '.cursor', 'rules'), path.join(tSub, '.claude', 'rules'));
      createOsDirLink(path.join(tSub, '.cursor', '.runtime'), path.join(tSub, '.claude'));

      assert.equal(runNode(CURSOR_CLI, ['install', '--target', tSub, '--json']).status, 0);
      assert.equal(fs.lstatSync(path.join(tSub, '.cursor', 'rules')).isSymbolicLink(), false);
      assertSnapshotExact(snapSub, path.join(tSub, '.claude'), 'after install over .cursor/{rules,.runtime} symlinks');

      // 3. Reverse same-realpath symlink `.claude/skills -> ../.cursor/skills`
      const tRev = nextDir('f01-reverse-sym');
      seedSyntheticCcBase(tRev, { hookForm: 'string' });
      const revClaudeSkills = path.join(tRev, '.claude', 'skills');
      const revCursorSkills = path.join(tRev, '.cursor', 'skills');
      fs.cpSync(revClaudeSkills, revCursorSkills, { recursive: true });
      fs.rmSync(revClaudeSkills, { recursive: true, force: true });
      const preciousFile = path.join(revCursorSkills, 'skill-01', 'SKILL.md');
      createOsDirLink(revClaudeSkills, revCursorSkills);

      const rRev = runNode(CURSOR_CLI, ['install', '--force', '--target', tRev, '--json']);
      assert.notEqual(rRev.status, 0, 'reverse same-realpath symlink must block migration');
      assert.equal(fs.lstatSync(revCursorSkills).isSymbolicLink(), false);
      assert.equal(fs.existsSync(preciousFile), true, 'reverse-linked physical .cursor/skills must not be vacated');

      // 4. Dangling leaf symlinks & live leaf symlink pointing into `.claude/`
      const tLeaf = nextDir('f01-leaf-sym');
      seedSyntheticCcBase(tLeaf, { hookForm: 'string' });
      const snapLeaf = snapshotTreeSha256(path.join(tLeaf, '.claude'));
      const claudeSettingsFile = path.join(tLeaf, '.claude', 'settings.json');
      const claudeMdFile = path.join(tLeaf, '.claude', 'CLAUDE.md');

      fs.mkdirSync(path.join(tLeaf, '.cursor', 'scripts'), { recursive: true });
      fs.symlinkSync(path.join(tmpRoot, 'dangling-cli.json'), path.join(tLeaf, '.cursor', 'cli.json'), 'file');
      fs.symlinkSync(path.join(tmpRoot, 'dangling-manifest.json'), path.join(tLeaf, '.cursor', 'FRAMEWORK-MANIFEST.json'), 'file');

      // Dangling leaf symlinks are cleanly replaced
      assert.equal(runNode(CURSOR_CLI, ['install', '--target', tLeaf, '--json']).status, 0);
      assert.equal(fs.lstatSync(path.join(tLeaf, '.cursor', 'cli.json')).isSymbolicLink(), false);

      // Replace .cursor/hooks.json and .cursor/scripts/doctor.mjs with live symlinks into .claude/
      fs.unlinkSync(path.join(tLeaf, '.cursor', 'hooks.json'));
      fs.unlinkSync(path.join(tLeaf, '.cursor', 'scripts', 'doctor.mjs'));
      createOsFileLink(path.join(tLeaf, '.cursor', 'hooks.json'), claudeSettingsFile);
      createOsFileLink(path.join(tLeaf, '.cursor', 'scripts', 'doctor.mjs'), claudeMdFile);

      // Non-force upgrade treats live symlinks as conflict (.cursor-new) without touching .claude/
      const rConflict = runNode(CURSOR_CLI, ['upgrade', '--target', tLeaf, '--json']);
      assert.equal(rConflict.status, 0, rConflict.stderr);
      assert.ok(rConflict.json?.conflicts?.includes('.cursor/hooks.json'));
      assert.ok(rConflict.json?.conflicts?.includes('.cursor/scripts/doctor.mjs'));
      assertSnapshotExact(snapLeaf, path.join(tLeaf, '.claude'), 'after non-force upgrade with live leaf symlinks');

      // Non-force uninstall keeps live symlinks in keptModified without touching .claude/
      const rUnKeep = runNode(CURSOR_CLI, ['uninstall', '--target', tLeaf, '--json']);
      assert.equal(rUnKeep.status, 0, rUnKeep.stderr);
      assert.ok(rUnKeep.json?.keptModified?.includes('.cursor/hooks.json'));
      assertSnapshotExact(snapLeaf, path.join(tLeaf, '.claude'), 'after non-force uninstall with live leaf symlinks');

      // --force install detaches leaf symlinks and writes regular files while .claude/ stays 100% SHA-256 identical!
      fs.rmSync(path.join(tLeaf, '.cursor', 'hooks.json.cursor-new'), { force: true });
      fs.rmSync(path.join(tLeaf, '.cursor', 'scripts', 'doctor.mjs.cursor-new'), { force: true });
      assert.equal(runNode(CURSOR_CLI, ['install', '--force', '--target', tLeaf, '--json']).status, 0);
      assert.equal(fs.lstatSync(path.join(tLeaf, '.cursor', 'hooks.json')).isSymbolicLink(), false);
      assert.equal(fs.lstatSync(path.join(tLeaf, '.cursor', 'scripts', 'doctor.mjs')).isSymbolicLink(), false);
      assertSnapshotExact(snapLeaf, path.join(tLeaf, '.claude'), 'after --force install over live leaf symlinks');
    });

    it('recovers from CURSOR_SETUP_FAIL_AFTER fault injection, timed-out/dead-PID/directory/symlink locks, and enforces cross-engine & zero-damage uninstall', () => {
      const target = nextDir('locks-and-uninstall');
      seedSyntheticCcBase(target, { hookForm: 'string' });
      const snapClaude = snapshotTreeSha256(path.join(target, '.claude'));

      const runtimeDir = path.join(target, '.cursor', '.runtime');
      const lockPath = path.join(runtimeDir, 'install.lock');
      const markerPath = path.join(runtimeDir, 'install.marker');

      // 1. Fault injection CURSOR_SETUP_FAIL_AFTER=2
      const rFail = runNode(CURSOR_CLI, ['install', '--target', target], {
        env: { CURSOR_SETUP_FAIL_AFTER: '2' },
      });
      assert.equal(rFail.status, 1);
      assert.equal(fs.existsSync(lockPath), false, 'install.lock must be cleaned in finally');
      assert.equal(JSON.parse(fs.readFileSync(markerPath, 'utf8')).status, 'interrupted');

      // 2. Active live PID lock -> rejected with exit 2
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }) + '\n', 'utf8');
      assert.equal(runNode(CURSOR_CLI, ['install', '--target', target]).status, 2);

      // 3. Timed-out (>10m) lock -> reclaimed cleanly
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() - 11 * 60 * 1000 }) + '\n', 'utf8');
      assert.equal(runNode(CURSOR_CLI, ['install', '--target', target, '--json']).status, 0);
      assert.equal(fs.existsSync(lockPath), false);
      assert.equal(fs.existsSync(markerPath), false);

      // 4. Dead PID file lock, directory lock (owner.json & pid), and symlink lock -> all reclaimed cleanly
      const deadPid = findDeadPid();
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({ pid: deadPid, ts: Date.now() }) + '\n', 'utf8');
      assert.equal(runNode(CURSOR_CLI, ['upgrade', '--target', target, '--json']).status, 0);

      fs.mkdirSync(lockPath, { recursive: true });
      fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: deadPid, ts: Date.now() }), 'utf8');
      assert.equal(runNode(CURSOR_CLI, ['upgrade', '--target', target, '--json']).status, 0);

      fs.mkdirSync(lockPath, { recursive: true });
      fs.writeFileSync(path.join(lockPath, 'pid'), `${deadPid}\n`, 'utf8');
      assert.equal(runNode(CURSOR_CLI, ['upgrade', '--target', target, '--json']).status, 0);

      const lockExtTarget = path.join(tmpRoot, 'lock-sentinel.txt');
      fs.writeFileSync(lockExtTarget, 'keep\n', 'utf8');
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.symlinkSync(lockExtTarget, lockPath, 'file');
      assert.equal(runNode(CURSOR_CLI, ['upgrade', '--target', target, '--json']).status, 0);
      assert.equal(fs.existsSync(lockExtTarget), true);

      // 5. Cross-engine uninstall guard (`engine: "agy-base"`) refuses without --force (exit 2)
      const crossTarget = nextDir('cross-engine-refuse');
      fs.mkdirSync(path.join(crossTarget, '.cursor'), { recursive: true });
      fs.writeFileSync(
        path.join(crossTarget, '.cursor', 'FRAMEWORK-MANIFEST.json'),
        JSON.stringify({ version: 1, engine: 'agy-base', seeded: [], files: [] }, null, 2) + '\n',
        'utf8',
      );
      assert.equal(runNode(CURSOR_CLI, ['uninstall', '--target', crossTarget, '--json']).status, 2);

      // 6. Clean uninstall removes .cursor completely and keeps .claude/ 100% SHA-256 intact!
      const rUn = runNode(CURSOR_CLI, ['uninstall', '--target', target, '--json']);
      assert.equal(rUn.status, 0, rUn.stderr);
      assert.equal(fs.existsSync(path.join(target, '.cursor')), false, '.cursor must be cleanly pruned when empty');
      assertSnapshotExact(snapClaude, path.join(target, '.claude'), 'after normal cursor-base uninstall');
    });
  });

  describe('5. Four-Way Coexistence Full Matrix End-to-End Integration Test (cc-base + cac-base-link + agy-base + cursor-base)', () => {
    it('co-installs all 4 frameworks with zero root files, verifies links/forms/doctors, tests cac-base-link<->cac-base round-trip, and cleanly uninstalls preserving all 211 .claude/ files', () => {
      if (!HAS_ALL_FOUR_SIBLINGS) {
        assert.equal(
          process.env.GITHUB_ACTIONS,
          'true',
          'All 4 sibling repositories (cc-base, cac-base-link, agy-base, cac-base) must exist in multi-repo workspace',
        );
        // Single-repo CI runner fallback (never skipped)
        const synProj = nextDir('ci-single-repo-coexist');
        seedSyntheticCcBase(synProj, { hookForm: 'string' });
        assert.equal(runNode(CURSOR_CLI, ['install', '--target', synProj, '--json']).status, 0);
        assert.deepEqual(fs.readdirSync(synProj).sort(), ['.claude', '.cursor']);
        assert.equal(runNode(CURSOR_CLI, ['uninstall', '--target', synProj, '--json']).status, 0);
        assert.deepEqual(fs.readdirSync(synProj).sort(), ['.claude']);
        return;
      }

      const buildFourWayProject = (label) => {
        const proj = nextDir(label);
        // 1st bridge (`cac-base-link`) auto-discovers sibling `../cc-base` (Tier 2) and co-installs `.claude/` + `.cac/`
        const rCacLink = runNode(SIBLING_CAC_LINK_CLI, ['install', '--target', proj, '--json'], {
          unsetEnv: ['CC_BASE_DIR', 'CAC_LINK_NO_AUTO_CC'],
        });
        assert.equal(rCacLink.status, 0, `cac-base-link install failed: ${rCacLink.stderr}`);
        assert.equal(rCacLink.json?.ccBase?.tier, 2);

        const cacSettingsBefore = fs.readFileSync(path.join(proj, '.cac', 'settings.json'), 'utf8');

        // 2nd bridge (`agy-base`) reuses `.claude/` (Tier 1) and installs `.agents/`
        const rAgy = runNode(SIBLING_AGY_CLI, ['install', '--target', proj, '--json'], {
          unsetEnv: ['CC_BASE_DIR', 'AGY_NO_AUTO_CC'],
        });
        assert.equal(rAgy.status, 0, `agy-base install failed: ${rAgy.stderr}`);
        assert.equal(rAgy.json?.ccBase?.tier, 1);

        // 3rd bridge (`cursor-base`) reuses `.claude/` (Tier 1) and installs `.cursor/`
        const rCursor = runNode(CURSOR_CLI, ['install', '--target', proj, '--json'], {
          unsetEnv: ['CC_BASE_DIR', 'CURSOR_BASE_NO_AUTO_CC', 'CURSOR_BASE_NO_SIBLING_CC'],
        });
        assert.equal(rCursor.status, 0, `cursor-base install failed: ${rCursor.stderr}`);
        assert.equal(rCursor.json?.ccBase?.tier, 1);

        return { proj, cacSettingsBefore };
      };

      const { proj, cacSettingsBefore } = buildFourWayProject('four-way-matrix');

      // (1) Assert ONLY ['.agents', '.cac', '.claude', '.cursor'] exist at project root — ZERO root-level visible files!
      assert.deepEqual(
        fs.readdirSync(proj).sort(),
        ['.agents', '.cac', '.claude', '.cursor'],
        'Root directory must contain ONLY the 4 hidden dot-directories and zero visible files (no CLAUDE.md / AGENTS.md / GEMINI.md)',
      );
      for (const forbiddenRoot of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
        assert.equal(fs.existsSync(path.join(proj, forbiddenRoot)), false, `${forbiddenRoot} must NOT exist at root`);
      }

      const claudeSnapInitial = snapshotTreeSha256(path.join(proj, '.claude'));
      assert.equal(claudeSnapInitial.size, 211, `Expected 211 regular files in .claude/, got ${claudeSnapInitial.size}`);
      const agySnapInitial = snapshotTreeSha256(path.join(proj, '.agents'));
      const cursorSnapInitial = snapshotTreeSha256(path.join(proj, '.cursor'));

      // (2) Assert OS links, 22 skills, 8 generated roles, .claude/settings.json string form, and .cac/settings.json untouched!
      const realClaudeSkills = fs.realpathSync.native(path.join(proj, '.claude', 'skills'));
      const realClaudeAgents = fs.realpathSync.native(path.join(proj, '.claude', 'agents'));

      for (const relLink of ['.cac/skills', '.agents/skills', '.cursor/skills']) {
        const lp = path.join(proj, ...relLink.split('/'));
        assert.equal(fs.lstatSync(lp).isSymbolicLink(), true, `${relLink} must be an OS symlink/Junction`);
        assert.equal(fs.realpathSync.native(lp), realClaudeSkills, `${relLink} must resolve to .claude/skills`);
        const enumeratedSkills = fs.readdirSync(lp, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(lp, e.name, 'SKILL.md')));
        assert.equal(enumeratedSkills.length, 22, `${relLink} must enumerate all 22 skills`);
      }

      assert.equal(fs.lstatSync(path.join(proj, '.cac', 'agents')).isSymbolicLink(), true);
      assert.equal(fs.realpathSync.native(path.join(proj, '.cac', 'agents')), realClaudeAgents);

      for (const genDirRel of ['.agents/agents', '.cursor/agents']) {
        const gp = path.join(proj, ...genDirRel.split('/'));
        assert.equal(fs.lstatSync(gp).isSymbolicLink(), false, `${genDirRel} must be a physical directory`);
        const mdRoles = fs.readdirSync(gp).filter((n) => n.endsWith('.md'));
        assert.equal(mdRoles.length, 8, `${genDirRel} must contain 8 generated roles`);
      }

      const claudeSettingsObj = JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.json'), 'utf8'));
      assert.equal(detectClaudeHookForm(claudeSettingsObj), 'string', '.claude/settings.json must be in string form');
      assert.equal(
        fs.readFileSync(path.join(proj, '.cac', 'settings.json'), 'utf8'),
        cacSettingsBefore,
        '.cac/settings.json must NOT be mutated by agy-base or cursor-base',
      );

      // (3) Run all 3 bridge doctors (cac-base-link, agy-base, cursor-base) -> all exit 0!
      for (const [name, cli] of [
        ['cac-base-link', SIBLING_CAC_LINK_CLI],
        ['agy-base', SIBLING_AGY_CLI],
        ['cursor-base', CURSOR_CLI],
      ]) {
        const rd = runNode(cli, ['doctor', '--target', proj, '--json']);
        assert.equal(rd.status, 0, `${name} doctor failed: ${rd.stderr}\n${rd.stdout}`);
        assert.equal(rd.json?.ok, true, `${name} doctor json.ok must be true`);
      }

      // (4) Test `cac-base-link -> standalone cac-base -> cac-base-link` round-trip switch on `proj`:
      //     Assert `.agents/`, `.cursor/`, `.claude/` are 100% untouched and all doctors still exit 0!
      const rToStandalone = runNode(SIBLING_CAC_STANDALONE_CLI, ['install', '--force', '--target', proj, '--json']);
      assert.equal(rToStandalone.status, 0, `switch to standalone cac-base failed: ${rToStandalone.stderr}`);
      assert.equal(fs.lstatSync(path.join(proj, '.cac', 'skills')).isSymbolicLink(), false);
      assert.equal(fs.lstatSync(path.join(proj, '.cac', 'agents')).isSymbolicLink(), false);
      assert.deepEqual(fs.readdirSync(proj).sort(), ['.agents', '.cac', '.claude', '.cursor']);

      assertSnapshotExact(claudeSnapInitial, path.join(proj, '.claude'), '.claude/ after switching to standalone cac-base');
      assertSnapshotExact(agySnapInitial, path.join(proj, '.agents'), '.agents/ after switching to standalone cac-base');
      assertSnapshotExact(cursorSnapInitial, path.join(proj, '.cursor'), '.cursor/ after switching to standalone cac-base');
      assert.equal(runNode(SIBLING_CAC_STANDALONE_CLI, ['doctor', '--target', proj, '--json']).status, 0);
      assert.equal(runNode(SIBLING_AGY_CLI, ['doctor', '--target', proj, '--json']).status, 0);
      assert.equal(runNode(CURSOR_CLI, ['doctor', '--target', proj, '--json']).status, 0);

      // Switch back: `standalone cac-base -> cac-base-link`
      const rBackToLink = runNode(SIBLING_CAC_LINK_CLI, ['install', '--force', '--target', proj, '--json']);
      assert.equal(rBackToLink.status, 0, `switch back to cac-base-link failed: ${rBackToLink.stderr}`);
      assert.equal(fs.lstatSync(path.join(proj, '.cac', 'skills')).isSymbolicLink(), true);
      assert.equal(fs.lstatSync(path.join(proj, '.cac', 'agents')).isSymbolicLink(), true);

      assertSnapshotExact(claudeSnapInitial, path.join(proj, '.claude'), '.claude/ after switching back to cac-base-link');
      assertSnapshotExact(agySnapInitial, path.join(proj, '.agents'), '.agents/ after switching back to cac-base-link');
      assertSnapshotExact(cursorSnapInitial, path.join(proj, '.cursor'), '.cursor/ after switching back to cac-base-link');

      for (const [name, cli] of [
        ['cac-base-link', SIBLING_CAC_LINK_CLI],
        ['agy-base', SIBLING_AGY_CLI],
        ['cursor-base', CURSOR_CLI],
      ]) {
        const rd = runNode(cli, ['doctor', '--target', proj, '--json']);
        assert.equal(rd.status, 0, `${name} doctor after round-trip failed: ${rd.stderr}\n${rd.stdout}`);
      }

      // Also verify uninstall on the switched project removes .agents, .cursor, and all .cac links/managed files while keeping .claude/ 211 files intact
      assert.equal(runNode(SIBLING_CAC_LINK_CLI, ['uninstall', '--force', '--target', proj, '--json']).status, 0);
      assert.equal(runNode(SIBLING_AGY_CLI, ['uninstall', '--force', '--target', proj, '--json']).status, 0);
      assert.equal(runNode(CURSOR_CLI, ['uninstall', '--force', '--target', proj, '--json']).status, 0);
      assert.equal(fs.existsSync(path.join(proj, '.agents')), false);
      assert.equal(fs.existsSync(path.join(proj, '.cursor')), false);
      assert.equal(fs.existsSync(path.join(proj, '.cac', 'skills')), false);
      assert.equal(fs.existsSync(path.join(proj, '.cac', 'agents')), false);
      assert.equal(fs.existsSync(path.join(proj, '.cac', 'FRAMEWORK-MANIFEST.json')), false);
      assertSnapshotExact(claudeSnapInitial, path.join(proj, '.claude'), '.claude/ 211 files after switched project uninstall');

      // (5) Sequential clean `uninstall` of `cac-base-link`, `agy-base`, `cursor-base` on 4-way bridge project:
      //     Assert `.cac`, `.agents`, `.cursor` are 100% removed and ONLY `.claude` (all 211 files intact) remains!
      const { proj: cleanUnProj } = buildFourWayProject('four-way-clean-uninstall');
      assert.deepEqual(fs.readdirSync(cleanUnProj).sort(), ['.agents', '.cac', '.claude', '.cursor']);
      const snapBeforeUn = snapshotTreeSha256(path.join(cleanUnProj, '.claude'));
      assert.equal(snapBeforeUn.size, 211);

      assert.equal(runNode(SIBLING_CAC_LINK_CLI, ['uninstall', '--target', cleanUnProj, '--json']).status, 0);
      assert.equal(fs.existsSync(path.join(cleanUnProj, '.cac')), false, '.cac must be completely removed');

      assert.equal(runNode(SIBLING_AGY_CLI, ['uninstall', '--target', cleanUnProj, '--json']).status, 0);
      assert.equal(fs.existsSync(path.join(cleanUnProj, '.agents')), false, '.agents must be completely removed');

      assert.equal(runNode(CURSOR_CLI, ['uninstall', '--target', cleanUnProj, '--json']).status, 0);
      assert.equal(fs.existsSync(path.join(cleanUnProj, '.cursor')), false, '.cursor must be completely removed');

      assert.deepEqual(
        fs.readdirSync(cleanUnProj).sort(),
        ['.claude'],
        'After uninstalling all 3 bridges, ONLY .claude must remain at project root',
      );
      assertSnapshotExact(
        snapBeforeUn,
        path.join(cleanUnProj, '.claude'),
        'All 211 files in .claude/ must remain 100% byte-for-byte intact after uninstalling cac-base-link, agy-base, and cursor-base',
      );
    });

    it('repairs broken/relocated .cursor/skills link via upgrade without touching old directory files', () => {
      const oldDir = nextDir('relocated-old-proj');
      const newDir = nextDir('relocated-new-proj');
      seedSyntheticCcBase(oldDir);
      seedSyntheticCcBase(newDir);
      assert.equal(runNode(CURSOR_CLI, ['install', '--target', newDir, '--json']).status, 0);

      const oldSentinel = path.join(oldDir, '.claude', 'skills', 'skill-01', 'SKILL.md');
      const rawOld = rawFileSha256(oldSentinel);

      const skillsLink = path.join(newDir, '.cursor', 'skills');
      detachLinkSafe(skillsLink);
      createOsDirLink(skillsLink, path.join(oldDir, '.claude', 'skills'));

      assert.equal(runNode(path.join(newDir, '.cursor', 'scripts', 'doctor.mjs'), [newDir, '--json']).status, 1);
      assert.equal(runNode(CURSOR_CLI, ['upgrade', '--target', newDir, '--json']).status, 0);
      assert.equal(
        fs.realpathSync.native(skillsLink),
        fs.realpathSync.native(path.join(newDir, '.claude', 'skills')),
      );
      assert.equal(rawFileSha256(oldSentinel), rawOld);
    });
  });
});
