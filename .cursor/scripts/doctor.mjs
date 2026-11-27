#!/usr/bin/env node
// .cursor/scripts/doctor.mjs — Dual-mode health & integrity checker for cursor-base.
// - Mode A (`--source-check` or inside `cursor-base` source repo): validates adapter repo integrity,
//   `.cursor/rules/cc-base-cursor-host.mdc` (`alwaysApply: true`), 5-event `hooks.json` + `cli.json`,
//   core `.cursor/scripts/*.mjs` syntax, and `FRAMEWORK-MANIFEST.json` LF-SHA256 parity.
// - Mode B (downstream business project): validates all of the above PLUS `.claude/` presence,
//   `.claude/settings.json` `string` form, `.cursor/skills -> .claude/skills` OS link & enumerated skill count,
//   `.cursor/rules/cc-base-claude.mdc` (`alwaysApply: true`), and `.cursor/agents/*.md` generated roles!
// Self-contained (Node >= 20 built-ins only). Smart `selfRoot` fallback when invoked with no target arg from external cwd.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SELF_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const EXPECTED_CURSOR_EVENTS = [
  'sessionStart',
  'subagentStart',
  'subagentStop',
  'beforeReadFile',
  'beforeShellExecution',
];

const CORE_ADAPTER_SCRIPTS = [
  '.cursor/scripts/hook-adapter.mjs',
  '.cursor/scripts/cursor-hook-preload.mjs',
  '.cursor/scripts/ps-floor.mjs',
  '.cursor/scripts/gen-rules.mjs',
  '.cursor/scripts/gen-agents.mjs',
  '.cursor/scripts/doctor.mjs',
];

const CORE_CLI_DENY_RULES = [
  'Read(**/.env)',
  'Read(**/*.key)',
  'Read(**/*.pem)',
];

const NODE_BIN_RE = /^["']?node(?:\.exe)?["']?$/i;
const CLAUDE_EXEC_HOOK_ARG_RE = /^(?:\$\{CLAUDE_PROJECT_DIR\}[/\\]|\.[/\\])?\.claude[/\\]hooks[/\\]([A-Za-z0-9_-]+)\.mjs$/;
const CLAUDE_STRING_HOOK_CMD_RE = /^node \.claude\/hooks\/([A-Za-z0-9_-]+)\.mjs$/;
const CURSOR_ADAPTER_CMD_RE = /^(?:["']?node(?:\.exe)?["']?)\s+(?:["']?(?:\.[/\\])?\.cursor[/\\]scripts[/\\]hook-adapter\.mjs["']?)\s+([A-Za-z0-9_-]+)\s*$/i;

const MAN_MAX_NAMED = 20;

function toPosix(p) {
  return String(p ?? '').replace(/\\/g, '/');
}

function safeLstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function hashLfFile(fullPath) {
  const buf = fs.readFileSync(fullPath);
  let hasCr = false;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d) {
      hasCr = true;
      break;
    }
  }
  let norm = buf;
  if (hasCr) {
    const tmp = Buffer.allocUnsafe(buf.length);
    let n = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 0x0d) tmp[n++] = buf[i];
    }
    norm = tmp.subarray(0, n);
  }
  return createHash('sha256').update(norm).digest('hex');
}

function resolveRealOrNull(p) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  }
}

function sameRealDir(a, b) {
  const ra = resolveRealOrNull(a);
  const rb = resolveRealOrNull(b);
  if (!ra || !rb) return false;
  const pa = toPosix(ra).replace(/\/+$/, '') || '/';
  const pb = toPosix(rb).replace(/\/+$/, '') || '/';
  return process.platform === 'win32' ? pa.toLowerCase() === pb.toLowerCase() : pa === pb;
}

function hasAlwaysApplyFrontmatter(rawText) {
  const lines = String(rawText ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return false;
  const end = lines.indexOf('---', 1);
  if (end < 0) return false;
  return lines.slice(1, end).some((l) => /^alwaysApply:\s*true\s*$/.test(l.trim()));
}

function detectClaudeHookFormLocal(settingsObj) {
  const forms = new Set();
  const hooks = settingsObj && typeof settingsObj === 'object' ? settingsObj.hooks : null;
  if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
    for (const groups of Object.values(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        if (!g || !Array.isArray(g.hooks)) continue;
        for (const h of g.hooks) {
          if (!h || typeof h !== 'object') continue;
          if (typeof h.command === 'string' && NODE_BIN_RE.test(h.command.trim()) && Array.isArray(h.args) && h.args.length === 1) {
            const rawArg = String(h.args[0] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
            if (CLAUDE_EXEC_HOOK_ARG_RE.test(rawArg)) forms.add('exec');
          } else if (!('args' in h) && typeof h.command === 'string') {
            if (CLAUDE_STRING_HOOK_CMD_RE.test(h.command.trim())) forms.add('string');
          }
        }
      }
    }
  }
  if (forms.size === 0) return 'none';
  if (forms.size > 1) return 'mixed';
  return [...forms][0];
}

function whichCmd(exe) {
  if (!exe) return null;
  if (exe.includes('/') || exe.includes('\\')) {
    return statOrNull(exe)?.isFile() ? exe : null;
  }
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const localBin = path.join(os.homedir(), '.local', 'bin');
  if (!dirs.includes(localBin)) dirs.push(localBin);

  const exts = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.PS1').split(';').map((s) => s.trim()).filter(Boolean)
    : [''];
  for (const d of dirs) {
    if (process.platform === 'win32') {
      const direct = path.join(d, exe);
      if (statOrNull(direct)?.isFile()) return direct;
    }
    for (const ext of exts) {
      const cand = path.join(d, exe + ext);
      if (statOrNull(cand)?.isFile()) return cand;
    }
  }
  return null;
}

function probeCliVersion(binPath) {
  if (!binPath || String(binPath).includes('"')) return '';
  try {
    const vr = (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(binPath))
      ? spawnSync(
          process.env.ComSpec || 'cmd.exe',
          ['/d', '/s', '/c', `""${binPath}" --version"`],
          {
            shell: false,
            windowsHide: true,
            windowsVerbatimArguments: true,
            encoding: 'utf8',
            timeout: 5000,
          },
        )
      : spawnSync(binPath, ['--version'], {
          shell: false,
          windowsHide: true,
          encoding: 'utf8',
          timeout: 5000,
        });
    if (!vr.error && vr.stdout) {
      return String(vr.stdout).trim().split(/\r?\n/)[0] || '';
    }
  } catch {
    // Best-effort version probe
  }
  return '';
}

function parseDoctorArgs(argv) {
  let jsonMode = false;
  let sourceCheck = false;
  let rootArg = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      jsonMode = true;
    } else if (a === '--source-check') {
      sourceCheck = true;
    } else if (a === '--root') {
      const next = argv[++i];
      if (!next || next.startsWith('-')) {
        process.stderr.write('doctor: --root requires a directory path\n');
        process.exit(2);
      }
      rootArg = next;
    } else if (a.startsWith('--root=')) {
      rootArg = a.slice(7);
      if (!rootArg) {
        process.stderr.write('doctor: --root= requires a directory path\n');
        process.exit(2);
      }
    } else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: node .cursor/scripts/doctor.mjs [target-dir] [--root <dir>] [--source-check] [--json]\n');
      process.exit(0);
    } else if (a.startsWith('-')) {
      process.stderr.write(`doctor: unknown option: ${a}\n`);
      process.exit(2);
    } else if (rootArg === null) {
      rootArg = a;
    } else {
      process.stderr.write(`doctor: unexpected extra argument: ${a}\n`);
      process.exit(2);
    }
  }

  let resolvedTarget = rootArg;
  if (resolvedTarget === null) {
    const cwd = process.cwd();
    const cwdHasCursor = Boolean(
      statOrNull(path.join(cwd, '.cursor'))?.isDirectory() ||
      statOrNull(path.join(cwd, 'scripts', 'cursor-base.mjs'))?.isFile(),
    );
    resolvedTarget = cwdHasCursor ? cwd : SELF_ROOT;
  }
  return { jsonMode, sourceCheck, rootArg: resolvedTarget };
}

function verifyManifestFile(root, relManifestPath, { ok, bad, note }) {
  const fullManifest = path.join(root, relManifestPath);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(fullManifest, 'utf8'));
  } catch (e) {
    bad(`FRAMEWORK-MANIFEST.json 不是合法 JSON（${e.message}）`);
    return;
  }
  if (!data || data.version !== 1 || data.engine !== 'cursor-base' || !Array.isArray(data.files)) {
    bad('FRAMEWORK-MANIFEST.json 结构不合法（期望 version=1, engine="cursor-base", files=[]）');
    return;
  }
  if (Array.isArray(data.seeded) && data.seeded.length > 0) {
    bad(`FRAMEWORK-MANIFEST.json seeded 必须为空数组（零根文件侵入），实际包含 ${data.seeded.length} 项`);
  }

  let checked = 0;
  let missing = 0;
  let mismatch = 0;
  for (const item of data.files) {
    if (!item || typeof item.path !== 'string' || typeof item.sha256 !== 'string') continue;
    const rel = toPosix(item.path);
    const full = path.join(root, rel);
    const lst = safeLstat(full);
    if (!lst || lst.isSymbolicLink() || !lst.isFile()) {
      missing++;
      if (missing <= MAN_MAX_NAMED) {
        bad(`FRAMEWORK-MANIFEST.json 缺件：${rel} 已登记但本地缺失（期望 ${item.sha256.slice(0, 8)}）`);
      }
      continue;
    }
    checked++;
    const actual = hashLfFile(full);
    if (actual !== item.sha256) {
      mismatch++;
      if (mismatch <= MAN_MAX_NAMED) {
        bad(`FRAMEWORK-MANIFEST.json 漂移/篡改：${rel} 期望 ${item.sha256.slice(0, 8)} 实际 ${actual.slice(0, 8)}`);
      }
    }
  }
  if (checked === 0 && missing === 0) {
    note('FRAMEWORK-MANIFEST.json 包含 0 条受管文件记录');
  } else if (mismatch === 0 && missing === 0) {
    ok(`FRAMEWORK-MANIFEST.json 全量比对 ${checked} 条 LF-SHA256 一致`);
  } else {
    if (mismatch > 0) bad(`FRAMEWORK-MANIFEST.json 全量比对 ${checked} 条，${mismatch} 条 LF-SHA256 不符`);
    if (missing > 0) bad(`FRAMEWORK-MANIFEST.json 另有 ${missing} 条登记文件在本地缺失`);
  }
}

export function runDoctor(rawTarget, { jsonMode = false, sourceCheck = false } = {}) {
  const segs = String(rawTarget).split(/[\\/]+/);
  if (segs.includes('..')) {
    process.stderr.write(`doctor: 路径不安全（含 '..'）：${rawTarget}\n`);
    process.exit(2);
  }
  const root = path.resolve(rawTarget);
  if (!statOrNull(root)?.isDirectory()) {
    process.stderr.write(`doctor: 目标目录不存在：${rawTarget}\n`);
    process.exit(2);
  }

  const isSourceRepo =
    Boolean(sourceCheck) ||
    (Boolean(statOrNull(path.join(root, 'scripts', 'cursor-base.mjs'))?.isFile()) &&
      Boolean(statOrNull(path.join(root, 'setup.ps1'))?.isFile()) &&
      !statOrNull(path.join(root, '.claude', 'CLAUDE.md'))?.isFile());

  const mode = isSourceRepo ? 'source' : 'downstream';
  const items = [];
  const errors = [];
  const warnings = [];
  let okCount = 0;
  let badCount = 0;
  let noteCount = 0;
  let skillsCount = 0;
  let agentsCount = 0;

  const ok = (msg) => {
    okCount++;
    items.push({ level: 'ok', message: msg });
    if (!jsonMode) process.stdout.write(`✓ ${msg}\n`);
  };
  const bad = (msg) => {
    badCount++;
    errors.push(msg);
    items.push({ level: 'bad', message: msg });
    if (!jsonMode) process.stderr.write(`✗ ${msg}\n`);
  };
  const note = (msg) => {
    noteCount++;
    warnings.push(msg);
    items.push({ level: 'note', message: msg });
    if (!jsonMode) process.stderr.write(`! ${msg}\n`);
  };

  // 1. Transaction marker check
  const markerPath = path.join(root, '.cursor', '.runtime', 'install.marker');
  if (fs.existsSync(markerPath)) {
    let rawMarker = '';
    try {
      rawMarker = fs.readFileSync(markerPath, 'utf8');
    } catch {
      rawMarker = 'interrupted';
    }
    if (rawMarker.includes('interrupted')) {
      bad('上次安装未完成（.cursor/.runtime/install.marker 状态为 interrupted）：请重跑 setup 补装');
    } else {
      note('存在 .cursor/.runtime/install.marker（可能有安装进程正在执行）');
    }
  } else {
    ok('安装事务状态干净（无残留 install.marker）');
  }

  // 2. Static host rule `.cursor/rules/cc-base-cursor-host.mdc` check
  const hostRulePath = path.join(root, '.cursor', 'rules', 'cc-base-cursor-host.mdc');
  const hostRuleSt = statOrNull(hostRulePath);
  if (hostRuleSt && hostRuleSt.isFile() && hostRuleSt.size > 0) {
    const text = fs.readFileSync(hostRulePath, 'utf8');
    if (!hasAlwaysApplyFrontmatter(text)) {
      bad('.cursor/rules/cc-base-cursor-host.mdc 缺少 alwaysApply: true frontmatter');
    } else {
      ok('.cursor/rules/cc-base-cursor-host.mdc 存在且声明 alwaysApply: true');
    }
  } else {
    bad('.cursor/rules/cc-base-cursor-host.mdc 缺失或为空');
  }

  // 3. Core adapter scripts & syntax check
  let syntaxBad = 0;
  let checkedJs = 0;
  for (const rel of CORE_ADAPTER_SCRIPTS) {
    const full = path.join(root, rel);
    if (!statOrNull(full)?.isFile()) {
      bad(`${rel} 缺失`);
      continue;
    }
    checkedJs++;
    const r = spawnSync(process.execPath, ['--check', full], {
      cwd: root,
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000,
    });
    if (r.status !== 0) {
      syntaxBad++;
      bad(`语法校验失败：${rel}`);
    }
  }
  if (checkedJs === CORE_ADAPTER_SCRIPTS.length && syntaxBad === 0) {
    ok(`适配层核心脚本齐全且语法校验通过（共 ${checkedJs} 个 .mjs 文件）`);
  }

  // 4. `.cursor/hooks.json` 5-event integrity check
  const hooksJsonPath = path.join(root, '.cursor', 'hooks.json');
  if (!statOrNull(hooksJsonPath)?.isFile()) {
    bad('.cursor/hooks.json 缺失');
  } else {
    const buf = fs.readFileSync(hooksJsonPath);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      bad('.cursor/hooks.json 含非法 UTF-8 BOM');
    } else {
      let hooksObj = null;
      try {
        hooksObj = JSON.parse(buf.toString('utf8'));
      } catch (e) {
        bad(`.cursor/hooks.json 不是合法 JSON（${e.message}）`);
      }
      if (hooksObj && typeof hooksObj === 'object') {
        const missingEvents = [];
        let beforeReadFailClosed = false;
        for (const evName of EXPECTED_CURSOR_EVENTS) {
          const arr = hooksObj.hooks && Array.isArray(hooksObj.hooks[evName]) ? hooksObj.hooks[evName] : [];
          const hit = arr.find((item) => {
            if (!item || typeof item.command !== 'string') return false;
            const m = CURSOR_ADAPTER_CMD_RE.exec(item.command.trim());
            return Boolean(m && m[1] === evName);
          });
          if (!hit) {
            missingEvents.push(evName);
          } else if (evName === 'beforeReadFile' && hit.failClosed === true) {
            beforeReadFailClosed = true;
          }
        }
        if (missingEvents.length > 0) {
          bad(`.cursor/hooks.json 缺少原生互补事件注册：${missingEvents.join(', ')}`);
        } else if (!beforeReadFailClosed) {
          bad('.cursor/hooks.json 中 beforeReadFile 必须保持 failClosed: true');
        } else {
          ok(`.cursor/hooks.json 全部 ${EXPECTED_CURSOR_EVENTS.length} 个正交事件注册完整（beforeReadFile failClosed: true）`);
        }
      }
    }
  }

  // 5. `.cursor/cli.json` integrity check
  const cliJsonPath = path.join(root, '.cursor', 'cli.json');
  if (!statOrNull(cliJsonPath)?.isFile()) {
    bad('.cursor/cli.json 缺失');
  } else {
    const buf = fs.readFileSync(cliJsonPath);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      bad('.cursor/cli.json 含非法 UTF-8 BOM');
    } else {
      try {
        const cliObj = JSON.parse(buf.toString('utf8'));
        const denyArr = Array.isArray(cliObj?.permissions?.deny) ? cliObj.permissions.deny.map(String) : [];
        const missingDeny = CORE_CLI_DENY_RULES.filter((r) => !denyArr.includes(r));
        if (missingDeny.length > 0) {
          bad(`.cursor/cli.json 缺少核心密钥保护 deny 规则：${missingDeny.join(', ')}`);
        } else {
          ok('.cursor/cli.json 合法且核心密钥 deny 规则齐全');
        }
      } catch (e) {
        bad(`.cursor/cli.json 不是合法 JSON（${e.message}）`);
      }
    }
  }

  // 6. `.cursor/FRAMEWORK-MANIFEST.json` parity check
  const manifestPath = path.join(root, '.cursor', 'FRAMEWORK-MANIFEST.json');
  if (!statOrNull(manifestPath)?.isFile()) {
    bad('.cursor/FRAMEWORK-MANIFEST.json 缺失');
  } else {
    verifyManifestFile(root, '.cursor/FRAMEWORK-MANIFEST.json', { ok, bad, note });
  }

  // 7. Mode-specific checks
  if (mode === 'source') {
    const sourceRequired = [
      'setup.ps1',
      'setup.sh',
      'setup-cursor.sh',
      'cc-base-contract.json',
      'package.json',
      'scripts/cursor-base.mjs',
      'scripts/lib/path-guard.mjs',
      'scripts/lib/link-manager.mjs',
      'scripts/lib/cc-dep.mjs',
      'scripts/lib/config-merge.mjs',
      'scripts/lib/manifest.mjs',
    ];
    for (const rel of sourceRequired) {
      if (statOrNull(path.join(root, rel))?.isFile()) {
        ok(`源仓组件 ${rel} 存在`);
      } else {
        bad(`源仓组件 ${rel} 缺失`);
      }
    }
  } else {
    // Mode B: Downstream project checks
    const ccClaudeMd = path.join(root, '.claude', 'CLAUDE.md');
    const ccSkillsDir = path.join(root, '.claude', 'skills');
    const ccAgentsDir = path.join(root, '.claude', 'agents');
    const ccHooksDir = path.join(root, '.claude', 'hooks');
    const ccSettingsPath = path.join(root, '.claude', 'settings.json');

    if (statOrNull(ccClaudeMd)?.isFile() && statOrNull(ccClaudeMd)?.size > 0) {
      ok('.claude/CLAUDE.md 主控宪法存在');
    } else {
      bad('.claude/CLAUDE.md 缺失（尚未安装 cc-base 或安装不完整）');
    }

    for (const [label, dirPath] of [
      ['.claude/skills', ccSkillsDir],
      ['.claude/agents', ccAgentsDir],
      ['.claude/hooks', ccHooksDir],
    ]) {
      if (statOrNull(dirPath)?.isDirectory()) {
        ok(`${label} 目录存在`);
      } else {
        bad(`${label} 目录缺失`);
      }
    }

    // Check `.claude/settings.json` hook registration form (`string` required!)
    if (!statOrNull(ccSettingsPath)?.isFile()) {
      bad('.claude/settings.json 缺失');
    } else {
      try {
        const ccSettings = JSON.parse(fs.readFileSync(ccSettingsPath, 'utf8'));
        const form = detectClaudeHookFormLocal(ccSettings);
        if (form === 'exec' || form === 'mixed') {
          bad(`.claude/settings.json 的 hook 形态为 ${form}（Cursor 要求 string form；请运行 cursor-base upgrade 或打开新会话由 sessionStart 自动自愈）`);
        } else {
          ok(`.claude/settings.json hook 形态合规（${form}）`);
        }
      } catch (e) {
        bad(`.claude/settings.json 不是合法 JSON（${e.message}）`);
      }
    }

    // Verify `.cursor/skills -> .claude/skills` OS directory link & enumerate SKILL.md count
    const cursorSkillsLink = path.join(root, '.cursor', 'skills');
    const skillsLst = safeLstat(cursorSkillsLink);
    if (!skillsLst) {
      bad('.cursor/skills 联接不存在（请重跑 setup 或触发 sessionStart 自动修复）');
    } else if (!skillsLst.isSymbolicLink()) {
      bad('.cursor/skills 是实体目录而非符号链接/Junction（请重跑 setup 自动备份迁移为桥接链接）');
    } else if (!statOrNull(ccSkillsDir)?.isDirectory() || !sameRealDir(cursorSkillsLink, ccSkillsDir)) {
      bad('.cursor/skills 链接损坏或未指向当前项目的 .claude/skills');
    } else {
      const skillDirs = fs.readdirSync(cursorSkillsLink, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
      for (const s of skillDirs) {
        const skMd = path.join(cursorSkillsLink, s, 'SKILL.md');
        if (statOrNull(skMd)?.isFile() && statOrNull(skMd)?.size > 0) skillsCount++;
      }
      if (skillsCount === 0) {
        bad('.cursor/skills 已链接至 .claude/skills，但未枚举到任何非空 SKILL.md');
      } else {
        ok(`.cursor/skills -> .claude/skills 联接正常（可枚举 ${skillsCount} 套技能 SKILL.md）`);
      }
    }

    // Verify generated `.cursor/rules/cc-base-claude.mdc`
    const genRulePath = path.join(root, '.cursor', 'rules', 'cc-base-claude.mdc');
    const genRuleSt = statOrNull(genRulePath);
    if (!genRuleSt || !genRuleSt.isFile() || genRuleSt.size === 0) {
      bad('.cursor/rules/cc-base-claude.mdc 缺失或为空（请运行 gen-rules.mjs 或触发 sessionStart 自愈）');
    } else {
      const text = fs.readFileSync(genRulePath, 'utf8');
      if (!hasAlwaysApplyFrontmatter(text)) {
        bad('.cursor/rules/cc-base-claude.mdc 缺少 alwaysApply: true frontmatter');
      } else {
        ok('.cursor/rules/cc-base-claude.mdc 已生成且声明 alwaysApply: true');
      }
    }

    // Verify generated `.cursor/agents/*.md`
    const cursorAgentsDir = path.join(root, '.cursor', 'agents');
    const agentsLst = safeLstat(cursorAgentsDir);
    if (!agentsLst || agentsLst.isSymbolicLink() || !agentsLst.isDirectory()) {
      bad('.cursor/agents 生成目录缺失或类型异常（期望由 gen-agents.mjs 生成的实体目录）');
    } else {
      const roleFiles = fs.readdirSync(cursorAgentsDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
      for (const rf of roleFiles) {
        const fp = path.join(cursorAgentsDir, rf);
        if (statOrNull(fp)?.size > 0) agentsCount++;
      }
      if (agentsCount === 0) {
        bad('.cursor/agents 下未找到任何已生成的角色定义 *.md');
      } else {
        ok(`.cursor/agents 角色生成完整（共 ${agentsCount} 个角色 *.md）`);
      }
    }

    // Optional legacy v2 root AGENTS.md hint
    const rootAgentsMd = path.join(root, 'AGENTS.md');
    if (safeLstat(rootAgentsMd)?.isFile()) {
      try {
        const head = fs.readFileSync(rootAgentsMd, 'utf8');
        if (/^#\s*cursor-base\b/.test(head.trim()) && head.includes('本仓是 cc-base（Claude Code 产品开发框架）的 Cursor 发行版')) {
          note('项目根仍保留旧版 v2.x cursor-base AGENTS.md（运行 cursor-base upgrade 可自动归档至 .cursor/.runtime/ 释放干净根目录）');
        }
      } catch {
        /* ignore */
      }
    }
  }

  // 8. Runtime checks (node >= 20, git, cursor-agent CLI)
  const nodeMajor = parseInt(String(process.versions.node || '0').split('.')[0], 10);
  if (Number.isInteger(nodeMajor) && nodeMajor >= 20) {
    ok(`node 运行时可用（${process.version} >= v20）`);
  } else {
    bad(`node 版本过低（当前 ${process.version}，要求 >= v20.0.0）`);
  }

  if (whichCmd('git')) {
    ok('git 可用');
  } else {
    note('未检测到 git；git 相关治理与提交钩子能力受限');
  }

  const cursorCliBin = whichCmd('cursor-agent');
  if (cursorCliBin) {
    const ver = probeCliVersion(cursorCliBin);
    ok(`cursor-agent CLI 可用${ver ? `（${ver}）` : ''}`);
  } else {
    note('未检测到 cursor-agent CLI（仅使用 Cursor IDE 时可忽略，仅提示不判红）');
  }

  const code = badCount > 0 ? 1 : 0;
  const status = badCount > 0 ? 'violation' : 'ok';
  const summary = badCount > 0
    ? `doctor(${mode}): 自检失败（${badCount} 项错误，${noteCount} 项提示）`
    : noteCount > 0
      ? `doctor(${mode}): 通过（${okCount} 项正常，有 ${noteCount} 项告警提示）`
      : `doctor(${mode}): 通过（${okCount} 项全部正常）`;

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({
        status,
        code,
        ok: code === 0,
        mode,
        summary,
        detail: {
          root: toPosix(root),
          mode,
          counts: { ok: okCount, bad: badCount, note: noteCount },
          skillsCount,
          agentsCount,
          errors,
          warnings,
        },
      }) + '\n',
    );
  } else {
    process.stdout.write(`${summary}\n`);
  }

  return code;
}

const isMain = process.argv[1] && (
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]) ||
  path.basename(process.argv[1]) === 'doctor.mjs'
);
if (isMain) {
  const { jsonMode, sourceCheck, rootArg } = parseDoctorArgs(process.argv.slice(2));
  const exitCode = runDoctor(rootArg, { jsonMode, sourceCheck });
  process.exit(exitCode);
}
