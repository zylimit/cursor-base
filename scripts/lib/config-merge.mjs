#!/usr/bin/env node
// scripts/lib/config-merge.mjs — Pure-Node lossless merger & uninstaller stripper for
// `<target>/.cursor/hooks.json` and `<target>/.cursor/cli.json`, PLUS `ensureClaudeSettingsStringForm(targetRoot)`
// for `<target>/.claude/settings.json` (NEVER touching `.cac/settings.json` or non-`.claude/hooks/` user hooks!).
// Zero npm / jq dependencies (Node >= 20 built-ins only).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURSOR_ADAPTER_RE = /^(?:["']?node(?:\.exe)?["']?)\s+(?:["']?(?:\.[/\\])?\.cursor[/\\]scripts[/\\]hook-adapter\.mjs["']?)\s+([A-Za-z0-9_-]+)\s*$/i;
const CURSOR_LEGACY_HOOK_RE = /(?:^|[/\\]|["'\s])\.cursor[/\\](?:runtime[/\\]harness\.mjs|scripts[/\\]read-secret-guard\.mjs)(?:$|["'\s])/i;

const NODE_BIN_RE = /^["']?node(?:\.exe)?["']?$/i;
const CLAUDE_EXEC_HOOK_ARG_RE = /^(?:\$\{CLAUDE_PROJECT_DIR\}[/\\]|\.[/\\])?\.claude[/\\]hooks[/\\]([A-Za-z0-9_-]+)\.mjs$/;
const CLAUDE_STRING_HOOK_CMD_RE = /^node \.claude\/hooks\/([A-Za-z0-9_-]+)\.mjs$/;

function cloneJson(val) {
  return JSON.parse(JSON.stringify(val));
}

export function formatJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// 1. `.cursor/hooks.json` Lossless Merge & Strip
// ---------------------------------------------------------------------------

/**
 * Identify whether a `.cursor/hooks.json` hook item is a `cursor-base` `hook-adapter.mjs <action>` entry.
 * @param {any} entry
 * @returns {{ action: string } | null}
 */
export function classifyCursorHookEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (typeof entry.command !== 'string') return null;
  const m = CURSOR_ADAPTER_RE.exec(entry.command.trim());
  if (!m) return null;
  return { action: m[1] };
}

/**
 * Identify obsolete `cursor-base` hooks from v2.1.1-legacy or early v2.2 drafts.
 * @param {any} entry
 * @returns {boolean}
 */
export function isLegacyCursorHookEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (typeof entry.command !== 'string') return false;
  return CURSOR_LEGACY_HOOK_RE.test(entry.command.trim());
}

function cursorHookKey(entry) {
  const cls = classifyCursorHookEntry(entry);
  if (cls) return `cursor-adapter:${cls.action}`;
  const cmd = typeof entry?.command === 'string' ? entry.command.trim() : JSON.stringify(entry);
  return `custom:${cmd}`;
}

/**
 * Losslessly merge `cursor-base` `sourceObj` (`.cursor/hooks.json`) into `targetObj`.
 * Preserves all user custom events, custom hook commands, and custom top-level keys!
 * @param {Record<string, any> | null} targetObj
 * @param {Record<string, any>} sourceObj
 */
export function mergeCursorHooks(targetObj, sourceObj) {
  const src = cloneJson(sourceObj || { version: 1, hooks: {} });
  if (!targetObj) {
    let addedHooks = 0;
    for (const arr of Object.values(src.hooks || {})) {
      if (Array.isArray(arr)) addedHooks += arr.length;
    }
    return { config: src, addedHooks, updatedHooks: 0, removedLegacy: 0 };
  }

  const merged = cloneJson(targetObj);
  if (!('version' in merged)) {
    merged.version = src.version ?? 1;
  }
  for (const [k, v] of Object.entries(src)) {
    if (k === 'hooks') continue;
    if (!(k in merged)) merged[k] = v;
  }

  if (!merged.hooks || typeof merged.hooks !== 'object' || Array.isArray(merged.hooks)) {
    merged.hooks = {};
  }

  const validSrcActionsByEvent = new Map();
  for (const [ev, list] of Object.entries(src.hooks || {})) {
    if (!Array.isArray(list)) continue;
    const set = new Set();
    for (const h of list) {
      const cls = classifyCursorHookEntry(h);
      if (cls) set.add(cls.action);
    }
    validSrcActionsByEvent.set(ev, set);
  }

  let removedLegacy = 0;
  for (const [ev, list] of Object.entries(merged.hooks)) {
    if (!Array.isArray(list)) continue;
    const validActions = validSrcActionsByEvent.get(ev);
    const seenKeys = new Set();
    const filtered = [];
    for (const h of list) {
      if (isLegacyCursorHookEntry(h)) {
        removedLegacy++;
        continue;
      }
      const cls = classifyCursorHookEntry(h);
      if (cls && (!validActions || !validActions.has(cls.action))) {
        removedLegacy++;
        continue;
      }
      const key = cursorHookKey(h);
      if (seenKeys.has(key)) {
        removedLegacy++;
        continue;
      }
      seenKeys.add(key);
      filtered.push(h);
    }
    if (filtered.length > 0) merged.hooks[ev] = filtered;
    else delete merged.hooks[ev];
  }

  let addedHooks = 0;
  let updatedHooks = 0;
  for (const [ev, srcList] of Object.entries(src.hooks || {})) {
    if (!Array.isArray(srcList)) continue;
    if (!Array.isArray(merged.hooks[ev])) merged.hooks[ev] = [];
    for (const sh of srcList) {
      const sKey = cursorHookKey(sh);
      const idx = merged.hooks[ev].findIndex((th) => cursorHookKey(th) === sKey);
      if (idx === -1) {
        merged.hooks[ev].push(cloneJson(sh));
        addedHooks++;
      } else if (JSON.stringify(merged.hooks[ev][idx]) !== JSON.stringify(sh)) {
        merged.hooks[ev][idx] = cloneJson(sh);
        updatedHooks++;
      }
    }
  }

  return { config: merged, addedHooks, updatedHooks, removedLegacy };
}

/**
 * Strip `cursor-base` framework hooks from `.cursor/hooks.json` on uninstall,
 * preserving any user custom hooks or custom top-level keys.
 * @param {Record<string, any>} targetObj
 */
export function stripCursorHooks(targetObj) {
  const copy = cloneJson(targetObj || {});
  let removedHooks = 0;
  if (copy.hooks && typeof copy.hooks === 'object' && !Array.isArray(copy.hooks)) {
    for (const [ev, list] of Object.entries(copy.hooks)) {
      if (!Array.isArray(list)) continue;
      const kept = list.filter((h) => {
        if (classifyCursorHookEntry(h) || isLegacyCursorHookEntry(h)) {
          removedHooks++;
          return false;
        }
        return true;
      });
      if (kept.length > 0) copy.hooks[ev] = kept;
      else delete copy.hooks[ev];
    }
    if (Object.keys(copy.hooks).length === 0) delete copy.hooks;
  }
  const remainingKeys = Object.keys(copy).filter((k) => k !== 'version');
  const empty = remainingKeys.length === 0;
  return { config: empty ? {} : copy, removedHooks, empty };
}

// ---------------------------------------------------------------------------
// 2. `.cursor/cli.json` Lossless Merge & Strip
// ---------------------------------------------------------------------------

function unionStrings(targetArr, sourceArr) {
  const out = Array.isArray(targetArr) ? [...targetArr] : [];
  const seen = new Set(out.map((x) => String(x)));
  let added = 0;
  for (const item of Array.isArray(sourceArr) ? sourceArr : []) {
    const k = String(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
      added++;
    }
  }
  return { merged: out, added };
}

/**
 * Losslessly merge `cursor-base` `sourceObj` (`.cursor/cli.json`) into `targetObj`.
 * Preserves all user custom `allow` / `deny` entries and custom fields.
 * @param {Record<string, any> | null} targetObj
 * @param {Record<string, any>} sourceObj
 */
export function mergeCursorCli(targetObj, sourceObj) {
  const src = cloneJson(sourceObj || { permissions: { allow: [], deny: [] } });
  if (!targetObj) {
    const addedAllow = Array.isArray(src.permissions?.allow) ? src.permissions.allow.length : 0;
    const addedDeny = Array.isArray(src.permissions?.deny) ? src.permissions.deny.length : 0;
    return { config: src, addedAllow, addedDeny };
  }

  const merged = cloneJson(targetObj);
  for (const [k, v] of Object.entries(src)) {
    if (k === 'permissions') continue;
    if (!(k in merged)) merged[k] = v;
  }

  let addedAllow = 0;
  let addedDeny = 0;
  if (src.permissions && typeof src.permissions === 'object' && !Array.isArray(src.permissions)) {
    if (!merged.permissions || typeof merged.permissions !== 'object' || Array.isArray(merged.permissions)) {
      merged.permissions = cloneJson(src.permissions);
    } else {
      if (Array.isArray(src.permissions.allow)) {
        const u = unionStrings(merged.permissions.allow, src.permissions.allow);
        merged.permissions.allow = u.merged;
        addedAllow = u.added;
      }
      if (Array.isArray(src.permissions.deny)) {
        const u = unionStrings(merged.permissions.deny, src.permissions.deny);
        merged.permissions.deny = u.merged;
        addedDeny = u.added;
      }
      for (const [pk, pv] of Object.entries(src.permissions)) {
        if (pk === 'allow' || pk === 'deny') continue;
        if (!(pk in merged.permissions)) merged.permissions[pk] = pv;
      }
    }
  }

  return { config: merged, addedAllow, addedDeny };
}

/**
 * Strip only framework-injected `permissions.allow` and `permissions.deny` entries from `.cursor/cli.json`,
 * preserving any user-added `allow` / `deny` or custom keys.
 * @param {Record<string, any>} targetObj
 * @param {Record<string, any>} sourceObj
 */
export function stripCursorCli(targetObj, sourceObj) {
  const copy = cloneJson(targetObj || {});
  let removedEntries = 0;
  const perms = copy && typeof copy.permissions === 'object' && !Array.isArray(copy.permissions)
    ? copy.permissions
    : null;
  if (perms) {
    const srcAllow = new Set(Array.isArray(sourceObj?.permissions?.allow) ? sourceObj.permissions.allow.map(String) : []);
    const srcDeny = new Set(Array.isArray(sourceObj?.permissions?.deny) ? sourceObj.permissions.deny.map(String) : []);

    if (Array.isArray(perms.allow)) {
      const before = perms.allow.length;
      perms.allow = perms.allow.filter((x) => !srcAllow.has(String(x)));
      removedEntries += before - perms.allow.length;
      if (perms.allow.length === 0) delete perms.allow;
    }
    if (Array.isArray(perms.deny)) {
      const before = perms.deny.length;
      perms.deny = perms.deny.filter((x) => !srcDeny.has(String(x)));
      removedEntries += before - perms.deny.length;
      if (perms.deny.length === 0) delete perms.deny;
    }
    if (Object.keys(perms).length === 0) {
      delete copy.permissions;
    }
  }
  const empty = Object.keys(copy).length === 0;
  return { config: copy, removedEntries, empty };
}

// ---------------------------------------------------------------------------
// 3. `.claude/settings.json` Pure-Node String Form Converter
// ---------------------------------------------------------------------------

function classifyClaudeHookEntry(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  if (typeof h.command === 'string' && NODE_BIN_RE.test(h.command.trim()) && Array.isArray(h.args) && h.args.length === 1) {
    const rawArg = String(h.args[0] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
    const m = CLAUDE_EXEC_HOOK_ARG_RE.exec(rawArg);
    if (m) return { form: 'exec', name: m[1] };
  }
  if (!('args' in h) && typeof h.command === 'string') {
    const m = CLAUDE_STRING_HOOK_CMD_RE.exec(h.command.trim());
    if (m) return { form: 'string', name: m[1] };
  }
  return null;
}

function rebuildClaudeHookToString(h, name) {
  const out = { type: h.type ?? 'command', command: `node .claude/hooks/${name}.mjs` };
  for (const [k, v] of Object.entries(h)) {
    if (k === 'type' || k === 'command' || k === 'args') continue;
    out[k] = v;
  }
  return out;
}

function* iterClaudeHookGroups(data) {
  const hooks = data && typeof data === 'object' ? data.hooks : null;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (g && typeof g === 'object' && Array.isArray(g.hooks)) yield g;
    }
  }
}

/**
 * Detect hook registration form of `.claude/hooks/<name>.mjs` entries in `.claude/settings.json`.
 * @param {any} settingsObj
 * @returns {'string' | 'exec' | 'mixed' | 'none'}
 */
export function detectClaudeHookForm(settingsObj) {
  const forms = new Set();
  for (const g of iterClaudeHookGroups(settingsObj)) {
    for (const h of g.hooks) {
      const c = classifyClaudeHookEntry(h);
      if (c) forms.add(c.form);
    }
  }
  if (forms.size === 0) return 'none';
  if (forms.size > 1) return 'mixed';
  return [...forms][0];
}

/**
 * Pure-Node conversion of `.claude/hooks/<name>.mjs` entries from `exec` form
 * (`command: "node", args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/x.mjs"]` or `args: [".claude/hooks/x.mjs"]`)
 * into `string` form (`command: "node .claude/hooks/x.mjs"`), preserving all custom user hooks untouched.
 * @param {Record<string, any>} settingsObj
 */
export function convertClaudeSettingsToStringForm(settingsObj) {
  const copy = cloneJson(settingsObj);
  let converted = 0;
  for (const g of iterClaudeHookGroups(copy)) {
    g.hooks = g.hooks.map((h) => {
      const c = classifyClaudeHookEntry(h);
      if (!c || c.form === 'string') return h;
      converted++;
      return rebuildClaudeHookToString(h, c.name);
    });
  }
  return { settings: copy, converted };
}

/**
 * Ensure `<targetRoot>/.claude/settings.json` uses `string` hook form:
 * - Invokes `<targetRoot>/.claude/scripts/hook-form.mjs --to string --file <settingsPath>` when present;
 * - Applies pure-Node `convertClaudeSettingsToStringForm` fallback for any `.claude/hooks/<name>.mjs` exec entries;
 * - NEVER touches `.cac/settings.json` or any non-`.claude/hooks/` custom user hooks!
 * @param {string} targetRoot
 */
export function ensureClaudeSettingsStringForm(targetRoot) {
  const root = path.resolve(targetRoot);
  const settingsPath = path.join(root, '.claude', 'settings.json');
  try {
    if (!fs.existsSync(settingsPath) || !fs.lstatSync(settingsPath).isFile()) {
      return { ok: true, status: 'missing', converted: 0, form: 'none' };
    }
  } catch {
    return { ok: true, status: 'missing', converted: 0, form: 'none' };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    return { ok: false, status: 'invalid-json', converted: 0, error: e.message };
  }

  const initialForm = detectClaudeHookForm(data);
  if (initialForm === 'string' || initialForm === 'none') {
    return { ok: true, status: 'unchanged', converted: 0, form: initialForm };
  }

  let usedHookFormScript = false;
  const hookFormScript = path.join(root, '.claude', 'scripts', 'hook-form.mjs');
  if (fs.existsSync(hookFormScript) && fs.statSync(hookFormScript).isFile()) {
    const r = spawnSync(
      process.execPath,
      [hookFormScript, '--to', 'string', '--file', settingsPath],
      {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      },
    );
    if (r.status === 0) {
      usedHookFormScript = true;
      try {
        data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {
        // fallback below
      }
    }
  }

  const pureRes = convertClaudeSettingsToStringForm(data);
  if (pureRes.converted > 0) {
    fs.writeFileSync(settingsPath, formatJson(pureRes.settings), 'utf8');
  }

  const finalData = pureRes.converted > 0 ? pureRes.settings : data;
  const finalForm = detectClaudeHookForm(finalData);
  return {
    ok: finalForm === 'string' || finalForm === 'none',
    status: 'converted',
    usedHookFormScript,
    converted: pureRes.converted,
    form: finalForm,
  };
}

function runSelftest() {
  // 1. `.cursor/hooks.json` lossless merge, legacy cleanup, idempotency, and uninstall strip
  const srcHooks = {
    version: 1,
    hooks: {
      sessionStart: [{ command: 'node .cursor/scripts/hook-adapter.mjs sessionStart', timeout: 15, failClosed: false }],
      beforeReadFile: [{ command: 'node .cursor/scripts/hook-adapter.mjs beforeReadFile', timeout: 10, failClosed: true }],
    },
  };
  const userTargetHooks = {
    version: 1,
    customMeta: 'keep',
    hooks: {
      sessionStart: [
        { command: 'node .cursor/runtime/harness.mjs sessionStart', timeout: 5, failClosed: true },
        { command: 'python3 scripts/my-audit.py', timeout: 3 },
      ],
      beforeReadFile: [
        { command: 'node .cursor/scripts/read-secret-guard.mjs', timeout: 5, failClosed: true },
      ],
      stop: [
        { command: 'node scripts/custom-stop.mjs', timeout: 5 },
      ],
    },
  };

  const hm1 = mergeCursorHooks(userTargetHooks, srcHooks);
  if (hm1.removedLegacy !== 2 || hm1.addedHooks !== 2) {
    throw new Error(`step 1 expected removedLegacy=2 addedHooks=2, got ${JSON.stringify(hm1)}`);
  }
  if (hm1.config.customMeta !== 'keep') throw new Error('step 1 customMeta lost');
  if (!hm1.config.hooks.sessionStart.some((h) => h.command === 'python3 scripts/my-audit.py')) {
    throw new Error('step 1 custom sessionStart hook lost');
  }
  if (!hm1.config.hooks.stop.some((h) => h.command === 'node scripts/custom-stop.mjs')) {
    throw new Error('step 1 custom stop event lost');
  }

  const hm2 = mergeCursorHooks(hm1.config, srcHooks);
  if (hm2.addedHooks !== 0 || hm2.updatedHooks !== 0 || formatJson(hm2.config) !== formatJson(hm1.config)) {
    throw new Error('step 2 repeated mergeCursorHooks must be 100% idempotent');
  }

  const hStripUser = stripCursorHooks(hm2.config);
  if (hStripUser.empty || hStripUser.removedHooks !== 2) {
    throw new Error(`step 3 stripCursorHooks with user hooks must not be empty, got ${JSON.stringify(hStripUser)}`);
  }
  const hStripFresh = stripCursorHooks(mergeCursorHooks(null, srcHooks).config);
  if (!hStripFresh.empty || hStripFresh.removedHooks !== 2) {
    throw new Error(`step 3 stripCursorHooks on pure framework hooks must be empty=true, got ${JSON.stringify(hStripFresh)}`);
  }

  // 2. `.cursor/cli.json` lossless merge & strip
  const srcCli = {
    permissions: {
      allow: ['Read(**)'],
      deny: ['Read(**/.env)', 'Read(**/*.key)'],
    },
  };
  const userCli = {
    permissions: {
      allow: ['Shell(npm:test*)'],
      deny: ['Read(**/.env)', 'Read(**/my-secret.txt)'],
    },
  };
  const cm1 = mergeCursorCli(userCli, srcCli);
  if (cm1.addedAllow !== 1 || cm1.addedDeny !== 1) {
    throw new Error(`step 4 expected addedAllow=1 addedDeny=1, got ${JSON.stringify(cm1)}`);
  }
  const cStripUser = stripCursorCli(cm1.config, srcCli);
  if (cStripUser.empty || !cStripUser.config.permissions.deny.includes('Read(**/my-secret.txt)')) {
    throw new Error('step 4 user custom cli.json deny rule lost on strip');
  }
  const cStripFresh = stripCursorCli(mergeCursorCli(null, srcCli).config, srcCli);
  if (!cStripFresh.empty) {
    throw new Error('step 4 pure framework cli.json must strip to empty=true');
  }

  // 3. `ensureClaudeSettingsStringForm` converts both `${CLAUDE_PROJECT_DIR}/.claude/hooks/x.mjs` and `.claude/hooks/x.mjs`,
  //    while NEVER touching `.cac/settings.json` or non-`.claude/hooks/` custom commands!
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-cfg-merge-test-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.cac'), { recursive: true });
    const cacRaw = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: ['.cac/hooks/cc-bridge.mjs', 'session-start'] }] }] } }, null, 2) + '\n';
    fs.writeFileSync(path.join(tmpDir, '.cac', 'settings.json'), cacRaw, 'utf8');

    const claudeSettings = {
      statusLine: { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/scripts/statusline.mjs"' },
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/session-rules-banner.mjs'], timeout: 5 },
              { type: 'command', command: 'node', args: ['.claude/hooks/recap-on-dirty.mjs'], timeout: 5 },
              { type: 'command', command: 'node', args: ['scripts/custom-user-hook.mjs'], timeout: 3 },
            ],
          },
        ],
      },
    };
    fs.writeFileSync(path.join(tmpDir, '.claude', 'settings.json'), formatJson(claudeSettings), 'utf8');

    const conv = ensureClaudeSettingsStringForm(tmpDir);
    if (!conv.ok || conv.form !== 'string' || conv.converted !== 2) {
      throw new Error(`step 5 expected converted=2 form=string, got ${JSON.stringify(conv)}`);
    }
    const afterClaude = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8'));
    const hs = afterClaude.hooks.SessionStart[0].hooks;
    if (hs[0].command !== 'node .claude/hooks/session-rules-banner.mjs' || 'args' in hs[0]) {
      throw new Error(`step 5 first hook not converted properly: ${JSON.stringify(hs[0])}`);
    }
    if (hs[1].command !== 'node .claude/hooks/recap-on-dirty.mjs' || 'args' in hs[1]) {
      throw new Error(`step 5 second hook not converted properly: ${JSON.stringify(hs[1])}`);
    }
    if (hs[2].command !== 'node' || hs[2].args[0] !== 'scripts/custom-user-hook.mjs') {
      throw new Error('step 5 custom non-.claude/hooks entry was mutated!');
    }
    if (fs.readFileSync(path.join(tmpDir, '.cac', 'settings.json'), 'utf8') !== cacRaw) {
      throw new Error('step 5 CRITICAL: .cac/settings.json was mutated!');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  process.stdout.write(JSON.stringify({ ok: true, tests: 5 }) + '\n');
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  if (process.argv.includes('--selftest')) {
    runSelftest();
    process.exit(0);
  }
  process.stderr.write('usage: node scripts/lib/config-merge.mjs --selftest\n');
  process.exit(2);
}
