// # risk: high
// # levels: smoke, unit, all
// Independent unit & runtime contract test suite for cursor-base adapter scripts (.cursor/scripts/*).
// Covers:
//   1. gen-rules.mjs: generates .cursor/rules/cc-base-claude.mdc (alwaysApply: true), LF idempotency, missing/empty errors, symlink guard
//   2. gen-agents.mjs: model: inherit default, readonly: true ONLY when both Write+Edit disabled, agents-models.json pinning,
//      quote stripping & YAML escaping, orphan pruning vs copied-renamed/handwritten preservation, symlink guard
//   3. hook-adapter.mjs + cursor-hook-preload.mjs:
//      - sessionStart: env.NODE_OPTIONS preload + unowned parent .git GIT_CEILING_DIRECTORIES + broken link/rules/agents/string-form self-healing
//      - subagentStart -> NODE_OPTIONS preload into .claude/hooks/no-direct-code-guard.mjs (allows subagent src/foo.ts) -> subagentStop (blocks main agent src/foo.ts)
//      - beforeReadFile (failClosed: true): blocks .env / private keys / multi-hop live & dangling symlinks / ELOOP / empty or bad stdin
//      - beforeShellExecution + ps-floor.mjs: blocks Remove-Item -Recurse -Force / Get-Content .env / -EncodedCommand (deny + exit 2),
//        allows Test-Path .env & Copy-Item .env.example .env, returns ask for gh release / npm publish / docker push
//   4. doctor.mjs: Mode A (--source-check), Mode B (downstream), failure detection, and zero-arg selfRoot smart fallback from external cwd

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  GEN_AGENTS_MARK,
  computeCursorGenFingerprint,
  generateAgents,
} from '../scripts/gen-agents.mjs';
import {
  GEN_RULES_MARKER,
  generateRules,
} from '../scripts/gen-rules.mjs';
import {
  checkDangerousCommand,
  checkSecretExfil,
  isSafePowerShellEnvCommand,
} from '../scripts/ps-floor.mjs';
import { loadCcBaseContract } from '../../scripts/lib/cc-dep.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..', '..');
const SIBLING_CC_BASE = path.resolve(REPO_ROOT, '..', 'cc-base');
const CONTRACT = loadCcBaseContract(REPO_ROOT);

const GEN_RULES_CLI = path.join(REPO_ROOT, '.cursor', 'scripts', 'gen-rules.mjs');
const GEN_AGENTS_CLI = path.join(REPO_ROOT, '.cursor', 'scripts', 'gen-agents.mjs');
const HOOK_ADAPTER_CLI = path.join(REPO_ROOT, '.cursor', 'scripts', 'hook-adapter.mjs');
const DOCTOR_CLI = path.join(REPO_ROOT, '.cursor', 'scripts', 'doctor.mjs');
const CURSOR_CLI = path.join(REPO_ROOT, 'scripts', 'cursor-base.mjs');

function createOsDirLink(absLink, absTarget) {
  fs.mkdirSync(path.dirname(absLink), { recursive: true });
  if (process.platform === 'win32') {
    fs.symlinkSync(absTarget, absLink, 'junction');
  } else {
    fs.symlinkSync(path.relative(path.dirname(absLink), absTarget), absLink, 'dir');
  }
}

function createOsFileLink(absLink, absTargetOrRaw, isRelativeRaw = false) {
  fs.mkdirSync(path.dirname(absLink), { recursive: true });
  const target = isRelativeRaw
    ? absTargetOrRaw
    : (process.platform === 'win32' ? absTargetOrRaw : path.relative(path.dirname(absLink), absTargetOrRaw));
  fs.symlinkSync(target, absLink, 'file');
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
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = String(r.stdout || '');
  const stderr = String(r.stderr || '');
  const firstJsonLine = stdout.trim().split(/\r?\n/).find((l) => l.trim().startsWith('{')) || '';
  let json = null;
  if (firstJsonLine) {
    try {
      json = JSON.parse(firstJsonLine);
    } catch {
      json = null;
    }
  }
  return { status: r.status ?? -1, stdout, stderr, json };
}

function encodePwshBase64(psScript) {
  return Buffer.from(psScript, 'utf16le').toString('base64');
}

function seedMinimalClaudeProject(rootDir, { hookForm = 'string' } = {}) {
  const claudeDir = path.join(rootDir, '.claude');
  fs.mkdirSync(path.join(claudeDir, 'rules'), { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'CLAUDE.md'),
    '# SiteMaster Constitution\n\n Ten core governance rules.\n',
    'utf8',
  );
  fs.writeFileSync(path.join(claudeDir, 'rules', 'core.md'), '# Core rule\n', 'utf8');

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
    path.join(claudeDir, 'settings.json'),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [hookEntry] }] } }, null, 2) + '\n',
    'utf8',
  );

  for (let i = 1; i <= (CONTRACT.minSkills || 15); i += 1) {
    const sk = path.join(claudeDir, 'skills', `skill-${String(i).padStart(2, '0')}`, 'SKILL.md');
    fs.mkdirSync(path.dirname(sk), { recursive: true });
    fs.writeFileSync(sk, `---\nname: skill-${String(i).padStart(2, '0')}\n---\n# Skill ${i}\n`, 'utf8');
  }

  fs.mkdirSync(path.join(claudeDir, 'agents'), { recursive: true });
  for (const role of CONTRACT.requiredAgents) {
    fs.writeFileSync(
      path.join(claudeDir, 'agents', `${role}.md`),
      `---\nname: ${role}\ndescription: Core ${role} role\nmodel: sonnet\ndisallowedTools: Task\n---\n\nExecute ${role} duties.\n`,
      'utf8',
    );
  }

  fs.mkdirSync(path.join(claudeDir, 'hooks'), { recursive: true });
  if (fs.existsSync(path.join(SIBLING_CC_BASE, '.claude', 'hooks', 'no-direct-code-guard.mjs'))) {
    fs.cpSync(path.join(SIBLING_CC_BASE, '.claude', 'hooks'), path.join(claudeDir, 'hooks'), { recursive: true });
  } else {
    for (const h of CONTRACT.requiredHooks) {
      if (h === 'no-direct-code-guard.mjs') {
        fs.writeFileSync(
          path.join(claudeDir, 'hooks', h),
          [
            "import fs from 'node:fs';",
            'const raw = fs.readFileSync(0, "utf8");',
            'const ev = raw.trim() ? JSON.parse(raw) : {};',
            'if (ev.agent_id) process.exit(0);',
            'const fp = String(ev?.tool_input?.file_path || "").replace(/\\\\/g, "/");',
            'if (/(^|\\/)src\\//.test(fp)) process.exit(2);',
          ].join('\n') + '\n',
          'utf8',
        );
      } else {
        fs.writeFileSync(path.join(claudeDir, 'hooks', h), `// ${h}\n`, 'utf8');
      }
    }
  }
}

describe('cursor-base Adapter Scripts & Runtime Bridge Suite', () => {
  let tmpRoot = '';
  let seq = 0;
  const nextDir = (label) => path.join(tmpRoot, `${String(++seq).padStart(2, '0')}-${label}`);

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-bridge-test-'));
  });

  after(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  describe('1. gen-rules.mjs: Main Constitution Rule Generation & Symlink Safety', () => {
    it('generates .cursor/rules/cc-base-claude.mdc with alwaysApply: true and is byte-for-byte idempotent', () => {
      const proj = nextDir('gen-rules-basic');
      fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(proj, '.claude', 'CLAUDE.md'),
        '\r\n# Main Governance Rules\r\n\r\nRule 1: Never fake green.\r\n\r\n',
        'utf8',
      );

      const r1 = runNode(GEN_RULES_CLI, ['--root', proj]);
      assert.equal(r1.status, 0, r1.stderr);

      const outMdc = path.join(proj, '.cursor', 'rules', 'cc-base-claude.mdc');
      assert.equal(fs.existsSync(outMdc), true);
      const firstBytes = fs.readFileSync(outMdc, 'utf8');
      assert.equal(firstBytes.includes('\r'), false, 'output must be LF-normalized');
      assert.match(firstBytes, /^---\ndescription: .+\nglobs:\nalwaysApply: true\n---\n/);
      assert.equal(firstBytes.includes(`<!-- ${GEN_RULES_MARKER} -->`), true);
      assert.equal(firstBytes.includes('# Main Governance Rules\n\nRule 1: Never fake green.'), true);

      const r2 = generateRules(proj, { quiet: true });
      assert.equal(r2.ok, true);
      assert.equal(fs.readFileSync(outMdc, 'utf8'), firstBytes, 'second run must be byte-identical');
    });

    it('exits 1 when .claude/CLAUDE.md is missing or empty, and exits 2 on missing --root argument', () => {
      const emptyProj = nextDir('gen-rules-missing');
      fs.mkdirSync(emptyProj, { recursive: true });

      const rMissing = runNode(GEN_RULES_CLI, ['--root', emptyProj]);
      assert.equal(rMissing.status, 1);

      fs.mkdirSync(path.join(emptyProj, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(emptyProj, '.claude', 'CLAUDE.md'), '   \n\t\n', 'utf8');
      const rBlank = runNode(GEN_RULES_CLI, ['--root', emptyProj]);
      assert.equal(rBlank.status, 1);

      const rBadArg = runNode(GEN_RULES_CLI, ['--root']);
      assert.equal(rBadArg.status, 2);
    });

    it('detaches symlinked .cursor/rules or leaf symlink without overwriting external target', () => {
      const proj = nextDir('gen-rules-symlink-guard');
      const extDir = nextDir('gen-rules-external');
      fs.mkdirSync(extDir, { recursive: true });
      const extFile = path.join(extDir, 'cc-base-claude.mdc');
      fs.writeFileSync(extFile, 'EXTERNAL_DO_NOT_TOUCH\n', 'utf8');

      fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(proj, '.claude', 'CLAUDE.md'), '# Safe Constitution\n', 'utf8');
      createOsDirLink(path.join(proj, '.cursor', 'rules'), extDir);

      const res = generateRules(proj, { quiet: true });
      assert.equal(res.ok, true);
      assert.equal(fs.lstatSync(path.join(proj, '.cursor', 'rules')).isSymbolicLink(), false);
      assert.equal(fs.readFileSync(extFile, 'utf8'), 'EXTERNAL_DO_NOT_TOUCH\n');
    });
  });

  describe('2. gen-agents.mjs: Role Generation, readonly Semantics, Model Pinning, Escaping & Orphan Pruning', () => {
    it('enforces model: inherit, sets readonly: true ONLY when both Write+Edit are disallowed, and honors agents-models.json', () => {
      const proj = nextDir('gen-agents-matrix');
      const agentsSrc = path.join(proj, '.claude', 'agents');
      fs.mkdirSync(agentsSrc, { recursive: true });

      // 1. Both Write + Edit disallowed -> readonly: true
      fs.writeFileSync(
        path.join(agentsSrc, 'researcher.md'),
        [
          '---',
          'name: researcher',
          'description: Read-only researcher',
          'model: opus',
          'skills: impact-analysis, arch-designer',
          'disallowedTools: Write, Edit, Bash, Task, Agent',
          '---',
          '',
          'Investigate repository evidence.',
        ].join('\n') + '\n',
        'utf8',
      );

      // 2. Only Write disallowed (Edit NOT disallowed) -> NO readonly: true
      fs.writeFileSync(
        path.join(agentsSrc, 'partial-writer.md'),
        [
          '---',
          'name: partial-writer',
          'description: Can Edit but not Write new files',
          'model: sonnet',
          'disallowedTools: Write, Task',
          '---',
          '',
          'Edit existing files only.',
        ].join('\n') + '\n',
        'utf8',
      );

      // 3. code-reviewer with memory: project (needs Write for agent-memory) -> NO readonly: true, pinned via agents-models.json
      fs.writeFileSync(
        path.join(agentsSrc, 'code-reviewer.md'),
        [
          '---',
          'name: code-reviewer',
          'description: Defect-first reviewer',
          'model: opus',
          'memory: project',
          'disallowedTools: Task',
          '---',
          '',
          'Review diffs strictly.',
        ].join('\n') + '\n',
        'utf8',
      );

      fs.mkdirSync(path.join(proj, '.cursor'), { recursive: true });
      fs.writeFileSync(
        path.join(proj, '.cursor', 'agents-models.json'),
        JSON.stringify({ 'code-reviewer': 'auto' }, null, 2) + '\n',
        'utf8',
      );

      const res = generateAgents(proj, { quiet: true });
      assert.equal(res.ok, true);
      assert.equal(res.generated, 3);

      const researcherOut = fs.readFileSync(path.join(proj, '.cursor', 'agents', 'researcher.md'), 'utf8');
      assert.match(researcherOut, /\nmodel: inherit\nreadonly: true\n---\n/);
      assert.equal(researcherOut.includes('`.claude/skills/impact-analysis/SKILL.md`、`.claude/skills/arch-designer/SKILL.md`'), true);
      assert.equal(researcherOut.includes('不要用 Shell（Bash）工具。'), true);
      assert.equal(researcherOut.includes('不要用 Write 工具。'), true);
      assert.equal(researcherOut.includes('不要用 Edit 工具。'), true);
      assert.equal(researcherOut.split('不要再派子代理。').length - 1, 1, 'Task + Agent must deduplicate to a single no-subagent line');

      const partialOut = fs.readFileSync(path.join(proj, '.cursor', 'agents', 'partial-writer.md'), 'utf8');
      assert.match(partialOut, /\nmodel: inherit\n---\n/);
      assert.equal(partialOut.includes('readonly: true'), false, 'readonly: true must NOT be emitted when Edit is allowed');

      const reviewerOut = fs.readFileSync(path.join(proj, '.cursor', 'agents', 'code-reviewer.md'), 'utf8');
      assert.match(reviewerOut, /\nmodel: auto\n---\n/);
      assert.equal(reviewerOut.includes('readonly: true'), false);
      assert.equal(reviewerOut.includes('`.claude/agent-memory/code-reviewer/MEMORY.md`'), true);
    });

    it('strips outer quotes and YAML-escapes descriptions with colons,inline comments, or YAML indicator prefixes', () => {
      const proj = nextDir('gen-agents-escaping');
      const agentsSrc = path.join(proj, '.claude', 'agents');
      fs.mkdirSync(agentsSrc, { recursive: true });

      fs.writeFileSync(
        path.join(agentsSrc, 'colon-role.md'),
        [
          '---',
          'name: colon-role',
          "description: 'Role ''alpha'': handles edge cases #important'",
          '---',
          '',
          'Body A.',
        ].join('\n') + '\n',
        'utf8',
      );

      fs.writeFileSync(
        path.join(agentsSrc, 'bracket-role.md'),
        [
          '---',
          'name: bracket-role',
          'description: "[Strict] bracket-prefixed role"',
          '---',
          '',
          'Body B.',
        ].join('\n') + '\n',
        'utf8',
      );

      const res = generateAgents(proj, { quiet: true });
      assert.equal(res.ok, true);

      const colonOut = fs.readFileSync(path.join(proj, '.cursor', 'agents', 'colon-role.md'), 'utf8');
      assert.equal(
        colonOut.includes(`description: ${JSON.stringify("Role 'alpha': handles edge cases #important")}`),
        true,
      );

      const bracketOut = fs.readFileSync(path.join(proj, '.cursor', 'agents', 'bracket-role.md'), 'utf8');
      assert.equal(
        bracketOut.includes(`description: ${JSON.stringify('[Strict] bracket-prefixed role')}`),
        true,
      );
    });

    it('prunes deleted upstream generated agents while preserving copied-and-renamed and hand-written custom agents', () => {
      const proj = nextDir('gen-agents-prune');
      const agentsSrc = path.join(proj, '.claude', 'agents');
      const agentsDst = path.join(proj, '.cursor', 'agents');
      fs.mkdirSync(agentsSrc, { recursive: true });

      fs.writeFileSync(
        path.join(agentsSrc, 'keep-role.md'),
        '---\nname: keep-role\ndescription: Kept role\n---\n\nKeep.\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(agentsSrc, 'temp-role.md'),
        '---\nname: temp-role\ndescription: Temporary role\n---\n\nTemp.\n',
        'utf8',
      );

      const r1 = generateAgents(proj, { quiet: true });
      assert.equal(r1.ok, true);
      assert.equal(r1.generated, 2);

      // User copies generated temp-role.md to custom-renamed.md AND adds a handwritten-agent.md
      fs.copyFileSync(
        path.join(agentsDst, 'temp-role.md'),
        path.join(agentsDst, 'custom-renamed.md'),
      );
      fs.writeFileSync(
        path.join(agentsDst, 'handwritten-agent.md'),
        '---\nname: handwritten-agent\ndescription: Custom team agent\nmodel: inherit\n---\n\nCustom body.\n',
        'utf8',
      );

      // Upstream deletes temp-role.md
      fs.unlinkSync(path.join(agentsSrc, 'temp-role.md'));

      const r2 = runNode(GEN_AGENTS_CLI, ['--root', proj]);
      assert.equal(r2.status, 0, r2.stderr);
      assert.equal(fs.existsSync(path.join(agentsDst, 'temp-role.md')), false, 'orphaned generated agent must be pruned');
      assert.equal(fs.existsSync(path.join(agentsDst, 'keep-role.md')), true);
      assert.equal(
        fs.existsSync(path.join(agentsDst, 'custom-renamed.md')),
        true,
        'copied-and-renamed agent (source marker != own filename) must be preserved',
      );
      assert.equal(
        fs.existsSync(path.join(agentsDst, 'handwritten-agent.md')),
        true,
        'hand-written agent without generator marker must be preserved',
      );
      assert.equal(
        fs.readFileSync(path.join(agentsDst, 'keep-role.md'), 'utf8').includes(GEN_AGENTS_MARK),
        true,
      );
    });

    it('detaches symlinked .cursor/agents before writing so .claude/agents/*.md is never overwritten', () => {
      const proj = nextDir('gen-agents-symlink-guard');
      const agentsSrc = path.join(proj, '.claude', 'agents');
      fs.mkdirSync(agentsSrc, { recursive: true });
      const srcFile = path.join(agentsSrc, 'implementer.md');
      const origContent = '---\nname: implementer\ndescription: Original sonnet role\nmodel: sonnet\n---\n\nOriginal.\n';
      fs.writeFileSync(srcFile, origContent, 'utf8');

      createOsDirLink(path.join(proj, '.cursor', 'agents'), agentsSrc);
      const res = generateAgents(proj, { quiet: true });
      assert.equal(res.ok, true);
      assert.equal(fs.lstatSync(path.join(proj, '.cursor', 'agents')).isSymbolicLink(), false);
      assert.equal(fs.readFileSync(srcFile, 'utf8'), origContent, '.claude/agents/implementer.md must remain untouched');
    });
  });

  describe('3. hook-adapter.mjs + cursor-hook-preload.mjs: Lifecycle, Preload Identity Bridge & Security Guards', () => {
    it('sessionStart outputs env.NODE_OPTIONS, emits GIT_CEILING_DIRECTORIES under unowned parent .git, and heals broken links/assets/string-form', () => {
      const outerGit = nextDir('outer-unowned-git');
      fs.mkdirSync(outerGit, { recursive: true });
      const gitInit = spawnSync('git', ['init'], { cwd: outerGit, encoding: 'utf8', shell: false, windowsHide: true });

      const subProj = path.join(outerGit, 'workspace', 'child-app');
      seedMinimalClaudeProject(subProj, { hookForm: 'exec' });
      const inst = runNode(CURSOR_CLI, ['install', '--target', subProj, '--json']);
      assert.equal(inst.status, 0, inst.stderr);

      // Corrupt state to verify sessionStart self-healing:
      // 1) break .cursor/skills into a dangling symlink
      const skillsLink = path.join(subProj, '.cursor', 'skills');
      fs.unlinkSync(skillsLink);
      createOsDirLink(skillsLink, path.join(subProj, 'nonexistent-skills'));
      // 2) remove generated cc-base-claude.mdc & one generated agent + corrupt fingerprint
      fs.unlinkSync(path.join(subProj, '.cursor', 'rules', 'cc-base-claude.mdc'));
      fs.unlinkSync(path.join(subProj, '.cursor', 'agents', 'tester.md'));
      // 3) revert .claude/settings.json back to exec form
      fs.writeFileSync(
        path.join(subProj, '.claude', 'settings.json'),
        JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: 'command', command: 'node', args: ['.claude/hooks/session-rules-banner.mjs'] },
                ],
              },
            ],
          },
        }, null, 2) + '\n',
        'utf8',
      );

      const adapterInProj = path.join(subProj, '.cursor', 'scripts', 'hook-adapter.mjs');
      const rSs = runNode(adapterInProj, ['sessionStart'], {
        cwd: subProj,
        input: JSON.stringify({ workspace_roots: [subProj], cwd: subProj }),
        env: { NODE_OPTIONS: '--no-warnings' },
        unsetEnv: ['CLAUDE_PROJECT_DIR', 'CURSOR_PROJECT_DIR', 'GIT_CEILING_DIRECTORIES'],
      });
      assert.equal(rSs.status, 0, rSs.stderr);
      assert.ok(rSs.json && rSs.json.env, `expected { env: ... }, got ${rSs.stdout}`);
      assert.match(rSs.json.env.NODE_OPTIONS, /^--no-warnings --import file:\/\/\/.*cursor-hook-preload\.mjs$/);

      // Calling sessionStart again with that NODE_OPTIONS must NOT duplicate --import
      const rSsIdem = runNode(adapterInProj, ['sessionStart'], {
        cwd: subProj,
        input: JSON.stringify({ cwd: subProj }),
        env: { NODE_OPTIONS: rSs.json.env.NODE_OPTIONS },
        unsetEnv: ['CLAUDE_PROJECT_DIR', 'CURSOR_PROJECT_DIR'],
      });
      assert.equal(rSsIdem.json.env.NODE_OPTIONS, rSs.json.env.NODE_OPTIONS);

      if (gitInit.status === 0) {
        assert.ok(
          typeof rSs.json.env.GIT_CEILING_DIRECTORIES === 'string' &&
            rSs.json.env.GIT_CEILING_DIRECTORIES.length > 0,
          'untracked project under parent .git must emit GIT_CEILING_DIRECTORIES',
        );
        // Verify git inside subProj stops at ceiling instead of climbing into outerGit
        const probeGit = spawnSync('git', ['rev-parse', '--show-toplevel'], {
          cwd: subProj,
          env: { ...process.env, GIT_CEILING_DIRECTORIES: rSs.json.env.GIT_CEILING_DIRECTORIES },
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
        });
        assert.notEqual(probeGit.status, 0, 'GIT_CEILING_DIRECTORIES must prevent escaping to unowned parent .git');

        // Once subProj has its own .git, GIT_CEILING_DIRECTORIES is no longer needed
        spawnSync('git', ['init'], { cwd: subProj, encoding: 'utf8', shell: false, windowsHide: true });
        const rOwnGit = runNode(adapterInProj, ['sessionStart'], {
          cwd: subProj,
          input: JSON.stringify({ cwd: subProj }),
          unsetEnv: ['CLAUDE_PROJECT_DIR', 'CURSOR_PROJECT_DIR', 'GIT_CEILING_DIRECTORIES'],
        });
        assert.equal(rOwnGit.json.env.GIT_CEILING_DIRECTORIES, undefined);
      }

      // Verify all broken assets were healed by sessionStart
      assert.equal(
        fs.realpathSync.native(skillsLink),
        fs.realpathSync.native(path.join(subProj, '.claude', 'skills')),
      );
      assert.equal(fs.existsSync(path.join(subProj, '.cursor', 'rules', 'cc-base-claude.mdc')), true);
      assert.equal(fs.existsSync(path.join(subProj, '.cursor', 'agents', 'tester.md')), true);
      const healedSettings = JSON.parse(fs.readFileSync(path.join(subProj, '.claude', 'settings.json'), 'utf8'));
      assert.equal(healedSettings.hooks.SessionStart[0].hooks[0].command, 'node .claude/hooks/session-rules-banner.mjs');
      assert.equal('args' in healedSettings.hooks.SessionStart[0].hooks[0], false);
      assert.equal(
        fs.readFileSync(path.join(subProj, '.cursor', '.runtime', 'cursor-gen.sha256'), 'utf8').trim(),
        computeCursorGenFingerprint(subProj),
      );
    });

    it('subagentStart -> NODE_OPTIONS preload into no-direct-code-guard.mjs allows subagent src/foo.ts -> subagentStop restores main-agent block', () => {
      const proj = nextDir('subagent-preload-bridge');
      seedMinimalClaudeProject(proj);
      assert.equal(runNode(CURSOR_CLI, ['install', '--target', proj, '--json']).status, 0);

      const adapter = path.join(proj, '.cursor', 'scripts', 'hook-adapter.mjs');
      const guardHook = path.join(proj, '.claude', 'hooks', 'no-direct-code-guard.mjs');

      // 1. Obtain NODE_OPTIONS from sessionStart
      const rSs = runNode(adapter, ['sessionStart'], {
        cwd: proj,
        input: JSON.stringify({ cwd: proj }),
        unsetEnv: ['NODE_OPTIONS', 'CLAUDE_PROJECT_DIR', 'CURSOR_PROJECT_DIR'],
      });
      assert.equal(rSs.status, 0);
      const preloadNodeOptions = rSs.json.env.NODE_OPTIONS;
      assert.match(preloadNodeOptions, /--import file:\/\/\/.*cursor-hook-preload\.mjs/);

      const toolPayloadWithoutAgentId = JSON.stringify({
        conversation_id: 'conv-impl-99',
        tool_name: 'Write',
        tool_input: { file_path: 'src/foo.ts' },
      });

      const hookEnv = {
        NODE_OPTIONS: preloadNodeOptions,
        CLAUDE_PROJECT_DIR: proj,
        CURSOR_PROJECT_DIR: proj,
      };

      // 2. Before subagentStart: main agent writing src/foo.ts is BLOCKED (exit 2)
      const rMainBefore = runNode(guardHook, [], {
        cwd: proj,
        input: toolPayloadWithoutAgentId,
        env: hookEnv,
      });
      assert.equal(rMainBefore.status, 2, `expected main agent block (2), got ${rMainBefore.status}: ${rMainBefore.stderr}`);

      // 3. subagentStart registers active implementer for conversation_id "conv-impl-99"
      const rSubStart = runNode(adapter, ['subagentStart'], {
        cwd: proj,
        input: JSON.stringify({
          subagent_id: 'subagent-uuid-99',
          subagent_type: 'implementer',
          conversation_id: 'conv-impl-99',
          parent_conversation_id: 'conv-main-1',
        }),
        env: { CLAUDE_PROJECT_DIR: proj },
      });
      assert.equal(rSubStart.status, 0);
      assert.equal(rSubStart.json?.permission, 'allow');

      // 4. During active subagent: preload injects agent_id & agent_type -> no-direct-code-guard.mjs ALLOWS src/foo.ts (exit 0)!
      const rSubWrite = runNode(guardHook, [], {
        cwd: proj,
        input: toolPayloadWithoutAgentId,
        env: hookEnv,
      });
      assert.equal(rSubWrite.status, 0, `expected active subagent write to be allowed (0), got ${rSubWrite.status}: ${rSubWrite.stderr}`);

      // Unrelated conversation_id is still treated as main agent and BLOCKED (exit 2)
      const rOtherConv = runNode(guardHook, [], {
        cwd: proj,
        input: JSON.stringify({
          conversation_id: 'conv-main-other',
          tool_name: 'Write',
          tool_input: { file_path: 'src/foo.ts' },
        }),
        env: hookEnv,
      });
      assert.equal(rOtherConv.status, 2, 'non-matching conversation_id must NOT receive subagent identity');

      // Non-target Node script under same NODE_OPTIONS must have ZERO preload mutation on stdin
      const echoStdinScript = path.join(proj, 'echo-stdin.mjs');
      fs.writeFileSync(echoStdinScript, 'import fs from "node:fs"; process.stdout.write(fs.readFileSync(0, "utf8"));\n', 'utf8');
      const rNonTarget = runNode(echoStdinScript, [], {
        cwd: proj,
        input: toolPayloadWithoutAgentId,
        env: hookEnv,
      });
      assert.equal(rNonTarget.status, 0);
      assert.equal(JSON.parse(rNonTarget.stdout).agent_id, undefined, 'non-target script stdin must not be mutated by preload');

      // 5. subagentStop cleans up active subagent state & prunes empty state directory
      const rSubStop = runNode(adapter, ['subagentStop'], {
        cwd: proj,
        input: JSON.stringify({
          subagent_id: 'subagent-uuid-99',
          conversation_id: 'conv-impl-99',
        }),
        env: { CLAUDE_PROJECT_DIR: proj },
      });
      assert.equal(rSubStop.status, 0);
      assert.equal(fs.existsSync(path.join(proj, '.claude', 'evidence', '.cursor-subagents')), false);

      // 6. After subagentStop: writing src/foo.ts with same payload is BLOCKED again (exit 2)!
      const rMainAfter = runNode(guardHook, [], {
        cwd: proj,
        input: toolPayloadWithoutAgentId,
        env: hookEnv,
      });
      assert.equal(rMainAfter.status, 2, 'after subagentStop, main agent write to src/foo.ts must be blocked again');
    });

    it('[MEDIUM-02 RED-LOCK] NODE_OPTIONS cursor-hook-preload.mjs exempts .cursor/rules/custom.mdc in mark-review-needed.mjs while recording src/app.ts', () => {
      const proj = nextDir('medium-02-mark-review-preload');
      seedMinimalClaudeProject(proj);
      const markReviewHook = path.join(proj, '.claude', 'hooks', 'mark-review-needed.mjs');
      if (!fs.existsSync(path.join(SIBLING_CC_BASE, '.claude', 'hooks', 'mark-review-needed.mjs'))) {
        // Standalone CI fallback matching cc-base mark-review-needed.mjs contract (does NOT exempt .cursor/ or .mdc!)
        fs.writeFileSync(
          markReviewHook,
          [
            "import fs from 'node:fs';",
            "import path from 'node:path';",
            "const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());",
            "const raw = fs.readFileSync(0, 'utf8');",
            "const ev = raw.trim() ? JSON.parse(raw) : null;",
            "const fp = ev?.tool_input?.file_path;",
            "if (!fp || typeof fp !== 'string') process.exit(0);",
            "const normRoot = root.replace(/\\\\/g, '/').replace(/\\/+$/, '');",
            "const normFp = fp.replace(/\\\\/g, '/');",
            "const rel = normFp.startsWith(normRoot + '/') ? normFp.slice(normRoot.length + 1) : normFp;",
            "if (/^(tools|\\.claude)\\//.test(rel) || /\\.(md|txt|json|yaml|yml)$/.test(rel)) process.exit(0);",
            "const sf = path.join(root, '.claude', '.needs-review');",
            "fs.mkdirSync(path.dirname(sf), { recursive: true });",
            "const prior = fs.existsSync(sf) ? fs.readFileSync(sf, 'utf8').split(/\\r?\\n/).filter(Boolean) : [];",
            "if (!prior.includes(rel)) prior.push(rel);",
            "fs.writeFileSync(sf, prior.join('\\n') + '\\n', 'utf8');",
          ].join('\n') + '\n',
          'utf8',
        );
      }

      assert.equal(runNode(CURSOR_CLI, ['install', '--target', proj, '--json']).status, 0);

      const adapter = path.join(proj, '.cursor', 'scripts', 'hook-adapter.mjs');
      const rSs = runNode(adapter, ['sessionStart'], {
        cwd: proj,
        input: JSON.stringify({ cwd: proj }),
        unsetEnv: ['NODE_OPTIONS', 'CLAUDE_PROJECT_DIR', 'CURSOR_PROJECT_DIR'],
      });
      assert.equal(rSs.status, 0, rSs.stderr);
      const preloadNodeOptions = rSs.json.env.NODE_OPTIONS;
      assert.match(preloadNodeOptions, /--import file:\/\/\/.*cursor-hook-preload\.mjs/);

      const hookEnv = {
        NODE_OPTIONS: preloadNodeOptions,
        CLAUDE_PROJECT_DIR: proj,
        CURSOR_PROJECT_DIR: proj,
      };
      const needsReviewPath = path.join(proj, '.claude', '.needs-review');
      fs.rmSync(needsReviewPath, { force: true });

      // 1. Writing .cursor/rules/custom.mdc (both relative and absolute) + sibling scaffold dirs (.cac/, .agents/)
      //    MUST NOT pollute .claude/.needs-review (even with zero active subagents)!
      for (const exemptPath of [
        '.cursor/rules/custom.mdc',
        path.join(proj, '.cursor', 'rules', 'custom.mdc'),
        '.cac/hooks/custom-helper.mjs',
        '.agents/scripts/custom-helper.mjs',
      ]) {
        const rEx = runNode(markReviewHook, [], {
          cwd: proj,
          input: JSON.stringify({
            workspace_roots: [proj],
            cwd: proj,
            tool_name: 'Write',
            tool_input: { file_path: exemptPath },
          }),
          env: hookEnv,
        });
        assert.equal(rEx.status, 0, `mark-review-needed failed on ${exemptPath}: ${rEx.stderr}`);
        assert.equal(
          fs.existsSync(needsReviewPath),
          false,
          `Host scaffold write "${exemptPath}" must NOT create or pollute .claude/.needs-review`,
        );
      }

      // 2. Writing business code `src/app.ts` under the same NODE_OPTIONS MUST record `src/app.ts` in `.claude/.needs-review`!
      const rBiz = runNode(markReviewHook, [], {
        cwd: proj,
        input: JSON.stringify({
          workspace_roots: [proj],
          cwd: proj,
          tool_name: 'Write',
          tool_input: { file_path: 'src/app.ts' },
        }),
        env: hookEnv,
      });
      assert.equal(rBiz.status, 0, rBiz.stderr);
      assert.equal(fs.existsSync(needsReviewPath), true, 'src/app.ts write must create .claude/.needs-review');
      const reviewLines = fs.readFileSync(needsReviewPath, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      assert.deepEqual(reviewLines, ['src/app.ts']);
    });

    it('beforeReadFile (failClosed: true) blocks .env, private keys, multi-hop live & dangling symlinks, ELOOP, and empty/malformed stdin', () => {
      const hooksCfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.cursor', 'hooks.json'), 'utf8'));
      assert.equal(hooksCfg.hooks.beforeReadFile[0].failClosed, true);

      const ws = nextDir('before-read-ws');
      fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.env'), 'DB_SECRET=1\n', 'utf8');
      fs.writeFileSync(path.join(ws, '.env.example'), 'DB_SECRET=placeholder\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'src', 'index.ts'), 'export const x = 1;\n', 'utf8');

      // Multi-hop LIVE symlink: hop-live-1 -> hop-live-2 -> ../.env
      createOsFileLink(path.join(ws, 'src', 'hop-live-2.txt'), path.join(ws, '.env'));
      createOsFileLink(path.join(ws, 'hop-live-1.txt'), path.join(ws, 'src', 'hop-live-2.txt'));

      // Multi-hop DANGLING symlink: hop-dangling-1 -> hop-dangling-2 -> missing-dir/.env (target does NOT exist!)
      createOsFileLink(path.join(ws, 'src', 'hop-dangling-2.txt'), '../missing-dir/.env', true);
      createOsFileLink(path.join(ws, 'hop-dangling-1.txt'), path.join(ws, 'src', 'hop-dangling-2.txt'));

      // Multi-hop DANGLING private key symlink: key-hop-1 -> key-hop-2 -> missing-ssh/id_ed25519
      createOsFileLink(path.join(ws, 'src', 'key-hop-2'), '../missing-ssh/id_ed25519', true);
      createOsFileLink(path.join(ws, 'key-hop-1'), path.join(ws, 'src', 'key-hop-2'));

      // Symlink loop: loop-a <-> loop-b (ELOOP)
      createOsFileLink(path.join(ws, 'loop-a'), 'loop-b', true);
      createOsFileLink(path.join(ws, 'loop-b'), 'loop-a', true);

      const checkRead = (payloadObjOrRaw, isRaw = false) =>
        runNode(HOOK_ADAPTER_CLI, ['beforeReadFile'], {
          cwd: ws,
          input: isRaw ? payloadObjOrRaw : JSON.stringify({ workspace_roots: [ws], cwd: ws, ...payloadObjOrRaw }),
          unsetEnv: ['CLAUDE_PROJECT_DIR', 'CURSOR_PROJECT_DIR'],
        });

      // Blocked sensitive files & symlinks
      for (const badPath of [
        '.env',
        '.env.local',
        'config/.env.production',
        'id_rsa',
        '.ssh/id_ed25519',
        'certs/server.key',
        'certs/ca.pem',
        'secrets/token.json',
        'credentials.json',
        'hop-live-1.txt',
        'hop-dangling-1.txt',
        'key-hop-1',
        'loop-a',
      ]) {
        const r = checkRead({ file_path: badPath });
        assert.equal(r.status, 2, `expected exit 2 for "${badPath}", got ${r.status}`);
        assert.equal(r.json?.permission, 'deny', `expected deny for "${badPath}", got ${r.stdout}`);
      }

      // Fail-closed on empty / malformed / missing file_path inputs
      for (const badRaw of ['', '   ', '{bad-json', '[]', '{}', '{"file_path":"   "}']) {
        const r = checkRead(badRaw, true);
        assert.equal(r.status, 2, `expected fail-closed exit 2 for raw input ${JSON.stringify(badRaw)}`);
        assert.equal(r.json?.permission, 'deny');
      }

      // Allowed template & normal source files
      for (const safePath of ['.env.example', '.env.sample', '.env.template', '.env.schema', 'src/index.ts']) {
        const r = checkRead({ file_path: safePath });
        assert.equal(r.status, 0, `expected exit 0 for "${safePath}", got ${r.status}: ${r.stderr}`);
        assert.equal(r.json?.permission, 'allow');
      }
    });

    it('beforeShellExecution + ps-floor.mjs blocks destructive/secret/EncodedCommand, allows Test-Path & Copy-Item .env.example .env, and asks on publish', () => {
      const runShellHook = (command) =>
        runNode(HOOK_ADAPTER_CLI, ['beforeShellExecution'], {
          input: JSON.stringify({ command }),
        });

      const encDanger = encodePwshBase64('Remove-Item -Recurse -Force ~');
      const encSecret = encodePwshBase64('Get-Content .env');

      const mustDeny = [
        'Remove-Item -Recurse -Force ~',
        'Remove-Item -Path .. -Recurse -Force',
        'Remove-Item C:\\ -Recurse -Force',
        'rm -rf /',
        'git reset --hard HEAD~1',
        'git push --force origin main',
        'pkill -f node',
        'Get-Content .env',
        'gc .env.production',
        'cat ~/.ssh/id_rsa',
        `pwsh -NoProfile -EncodedCommand ${encDanger}`,
        `powershell.exe -ec ${encSecret}`,
      ];
      for (const cmd of mustDeny) {
        const r = runShellHook(cmd);
        assert.equal(r.status, 2, `expected exit 2 deny for: ${cmd}`);
        assert.equal(r.json?.permission, 'deny', `expected permission=deny for: ${cmd}`);
      }

      const mustAllow = [
        'Test-Path .env',
        'Test-Path -LiteralPath .env.local',
        'Copy-Item .env.example .env',
        'Copy-Item -Path .env.sample -Destination .env.local -Force',
        'cp .env.example .env',
        'git status',
      ];
      for (const cmd of mustAllow) {
        const r = runShellHook(cmd);
        assert.equal(r.status, 0, `expected exit 0 allow for: ${cmd} (stderr=${r.stderr})`);
        assert.equal(r.json?.permission, 'allow', `expected permission=allow for: ${cmd}`);
      }

      assert.equal(isSafePowerShellEnvCommand('Test-Path .env'), true);
      assert.equal(isSafePowerShellEnvCommand('Copy-Item .env.example .env'), true);
      assert.equal(isSafePowerShellEnvCommand('Get-Content .env'), false);
      assert.equal(isSafePowerShellEnvCommand('Test-Path .env; Get-Content .env'), false);
      assert.notEqual(checkDangerousCommand('Remove-Item -Recurse -Force ~'), null);
      assert.notEqual(checkSecretExfil('Get-Content .env'), null);

      const mustAsk = [
        'gh release create v3.0.0 --generate-notes',
        'npm publish --access public',
        'docker push acme/web:3.0.0',
      ];
      for (const cmd of mustAsk) {
        const r = runShellHook(cmd);
        assert.equal(r.status, 0, `expected exit 0 ask for: ${cmd}`);
        assert.equal(r.json?.permission, 'ask', `expected permission=ask for: ${cmd}`);
      }
    });
  });

  describe('4. doctor.mjs: Mode A (Source), Mode B (Downstream), Fault Detection & Zero-Arg selfRoot Fallback', () => {
    it('passes Mode A (--source-check), Mode B (downstream), and zero-arg selfRoot fallback from external /tmp cwd', () => {
      const extEmptyCwd = nextDir('doctor-ext-empty-cwd');
      fs.mkdirSync(extEmptyCwd, { recursive: true });

      // 1. Source repo doctor with ZERO target arg from external empty /tmp cwd
      const rSrc = runNode(DOCTOR_CLI, ['--source-check', '--json'], { cwd: extEmptyCwd });
      assert.equal(rSrc.status, 0, rSrc.stderr + rSrc.stdout);
      assert.equal(rSrc.json?.ok, true);
      assert.equal(rSrc.json?.mode, 'source');
      assert.equal(fs.realpathSync.native(rSrc.json.detail.root), fs.realpathSync.native(REPO_ROOT));

      // 2. Downstream installed project doctor with ZERO target arg from external empty /tmp cwd
      const downProj = nextDir('doctor-downstream-proj');
      seedMinimalClaudeProject(downProj);
      assert.equal(runNode(CURSOR_CLI, ['install', '--target', downProj, '--json']).status, 0);

      const downDoctor = path.join(downProj, '.cursor', 'scripts', 'doctor.mjs');
      const rDown = runNode(downDoctor, ['--json'], { cwd: extEmptyCwd });
      assert.equal(rDown.status, 0, rDown.stderr + rDown.stdout);
      assert.equal(rDown.json?.ok, true);
      assert.equal(rDown.json?.mode, 'downstream');
      assert.ok(rDown.json.detail.skillsCount >= 15);
      assert.ok(rDown.json.detail.agentsCount >= 8);

      // 3. ~/.local/bin/cursor-agent discovery when ~/.local/bin is not in PATH
      const fakeHome = nextDir('doctor-fake-home');
      const localBin = path.join(fakeHome, '.local', 'bin');
      fs.mkdirSync(localBin, { recursive: true });
      if (process.platform === 'win32') {
        fs.writeFileSync(path.join(localBin, 'cursor-agent.cmd'), '@echo off\r\necho cursor-agent 3.0.0-mock\r\n', 'utf8');
      } else {
        fs.writeFileSync(
          path.join(localBin, 'cursor-agent'),
          `#!${process.execPath}\nprocess.stdout.write('cursor-agent 3.0.0-mock\\n');\n`,
          { encoding: 'utf8', mode: 0o755 },
        );
      }
      const rCliProbe = runNode(DOCTOR_CLI, ['--source-check'], {
        cwd: extEmptyCwd,
        env: {
          HOME: fakeHome,
          USERPROFILE: fakeHome,
          PATH: path.dirname(process.execPath),
        },
      });
      assert.equal(rCliProbe.status, 0, rCliProbe.stderr);
      assert.match(rCliProbe.stdout, /cursor-agent CLI 可用（cursor-agent 3\.0\.0-mock）/);

      // 4. Detects exec-form .claude/settings.json and interrupted install.marker in Mode B (exit 1)
      fs.writeFileSync(
        path.join(downProj, '.claude', 'settings.json'),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: ['.claude/hooks/session-rules-banner.mjs'] }] }],
          },
        }) + '\n',
        'utf8',
      );
      fs.mkdirSync(path.join(downProj, '.cursor', '.runtime'), { recursive: true });
      fs.writeFileSync(
        path.join(downProj, '.cursor', '.runtime', 'install.marker'),
        JSON.stringify({ status: 'interrupted' }) + '\n',
        'utf8',
      );

      const rBroken = runNode(downDoctor, [downProj, '--json'], { cwd: extEmptyCwd });
      assert.equal(rBroken.status, 1);
      assert.equal(rBroken.json?.ok, false);
      assert.ok(rBroken.json.detail.errors.some((e) => e.includes('string form')));
      assert.ok(rBroken.json.detail.errors.some((e) => e.includes('interrupted')));
    });
  });
});
