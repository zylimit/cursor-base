// tier.mjs -- S28 tier: the fast / standard / strict dial, and the only place the engine
// asks what tier is in force.
//
// The judgement itself lives in .claude/hooks/lib/tier.mjs and is imported from there, not
// reimplemented here. That import direction (engine -> hook lib) is the one that is allowed:
// hooks must survive a broken engine, so they may never import lib/*.mjs, while the engine
// may read the hook side's single resolver. Defect #38 was one switch parsed in three places
// answering open here and closed there; this file exists so the engine has no second reading.
//
// This module owns the write side. `tier set` is the only writer of .claude/.runtime/tier.json
// anywhere in the framework -- hooks read that file and never touch it, and the shell switches
// (.claude/scripts/fast-mode.sh/.ps1) are thin forwarders onto this subcommand. One writer is
// what keeps the file's shape a contract rather than a convention: a second one drifts on the
// day somebody adds a field.
//
// Exit codes (see harness-large-repo.md (source .claude/harness/ext/rules/, installed into .claude/rules/ by --with-harness)):
//   status / explain    0
//   explain <unknown>   2   the id is not a hook this repository registers
//   set                 0, or 2 for a usage error (unknown tier, fast without a reason,
//                             --hours that is not a positive number or is given for a tier
//                             that has no expiry, --sticky on a tier other than fast, or
//                             --sticky together with --hours)
//
// Runtime record (.claude/.runtime/tier.json, data model docs/v3-work-packs.md A.1) gains one
// field beside the A.1 set: `sticky: true` on a fast record written by `tier set fast --sticky`,
// written with `expires_epoch: null`. The hook-side reader honours it only in that exact shape
// (sticky === true, expires_epoch === null, non-empty reason); `tier status` reports it as
// `sticky: true, expiresEpoch: null`. Any later `tier set standard|strict` overwrites the record
// and is the revocation -- there is no separate "unstick".
//   validate            0 compliant / 1 violations / 3 no profile.json (the built-in table is
//                             in force and there is nothing to validate -- not a pass)
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PROFILE, TIERS, effectiveTier, gateMode, kindOf, loadProfile, rank, readSession,
} from '../../hooks/lib/tier.mjs';
import { gateLog } from '../../hooks/lib/gatelog.mjs';
import { die, emit, projectRoot, repoRelative } from './core.mjs';

// A fast window is capped rather than trusted: the switch it replaces defaulted to 24 hours
// and was routinely found still open days later. Eight hours is one working day, and a window
// that has to be renewed is a window somebody is still deciding to keep open.
//
// 为什么又加了 --sticky（到撤销为止的 fast，progress.md TODO #91，用户 2026-10-30 拍板）：
// 上限在连续开发里成了仪式——两个下游项目把「开工先切快速档并持续续期」写进 progress Pinned，
// 两天续了 4 次，一个项目干脆把续期命令写进 settings.local 白名单，续期没人再「决定」什么。
// 更要紧的是过期回落到 standard 那一刻 tdd-gate / stop-gate 立刻开响，账本里一个月 113 + 326
// 条提醒多数出自这个缝：提醒响在没人改主意的时候，等于噪声。sticky 不放宽上限本身：不带
// --sticky 的 fast 照旧 8 小时；sticky 必须带 reason、只对 fast 合法、与 --hours 互斥，
// 由 tier set standard|strict 撤销；家底一动自动升 strict 照旧只抬不降，release 侧照旧对 fast FAIL。
const MAX_FAST_HOURS = 8;
const GUARD_MODES = ['off', 'advise', 'block'];
const RECORDER_MODES = ['off', 'on'];
const PROFILE_KEYS = ['version', 'default', 'floor', 'hooks', 'raise', 'overrides'];
const HOOK_ROW_KEYS = ['kind', 'fast', 'standard', 'strict'];
const RAISE_KEYS = ['to', 'paths'];

function runtimeFile(root) {
  return path.join(root, '.claude', '.runtime', 'tier.json');
}

/** 同一个 hook 文件里的子闸：自己没有 .mjs，随宿主闸注册（宿主在 settings.json 里就算它注册了）。 */
const SUB_GATES = { 'design-detail-sync': 'three-file-sync-gate' };

/**
 * Hook ids this repository actually registers, read from settings.json (`args[0]` of every
 * command entry). Derived rather than listed: a hard-coded roster is a second copy of the
 * registration table, and the day they disagree the validator either demands a row for a hook
 * that no longer runs or accepts the absence of one that does.
 * The hooks directory is deliberately not the source -- static-check.mjs lives there and is
 * invoked by the review skill, never by the host, so a listing would report it as unregistered.
 * @returns {{ids:string[], readable:boolean}}
 */
function registeredHooks(root) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8');
  } catch (_e) {
    return { ids: [], readable: false };
  }
  let settings;
  try { settings = JSON.parse(raw.replace(/\r/g, '')); } catch (_e) { return { ids: [], readable: false }; }
  const ids = new Set();
  for (const matchers of Object.values((settings && settings.hooks) || {})) {
    for (const matcher of (Array.isArray(matchers) ? matchers : [])) {
      for (const entry of ((matcher && matcher.hooks) || [])) {
        for (const arg of (Array.isArray(entry && entry.args) ? entry.args : [])) {
          const m = /([^/\\]+)\.mjs$/.exec(String(arg));
          if (m) ids.add(m[1]);
        }
      }
    }
  }
  for (const [sub, host] of Object.entries(SUB_GATES)) if (ids.has(host)) ids.add(sub);
  return { ids: [...ids].sort(), readable: true };
}

/** Every id the dial can speak about: registered hooks plus whatever the profile names. */
function knownHooks(root, profile) {
  const reg = registeredHooks(root);
  const ids = new Set(reg.ids);
  for (const id of Object.keys((profile && profile.hooks) || {})) ids.add(id);
  for (const id of (Array.isArray(profile && profile.floor) ? profile.floor : [])) ids.add(id);
  return { ids: [...ids].sort(), registered: reg };
}

/** Is this id on the floor -- structurally out of the tier table, always at full strength. */
function isFloor(id, profile) {
  const declared = Array.isArray(profile && profile.floor) ? profile.floor : [];
  return DEFAULT_PROFILE.floor.includes(id) || declared.includes(id);
}

/**
 * Validate a profile against the rules a wrong one would otherwise break in silence.
 * Pure over (profile, registered ids) so selftest can run every rule without a repository.
 * Each finding names the hook it is about: a validator that reports "not monotonic" without
 * saying where sends the reader through sixteen rows by hand.
 * @param {object} profile
 * @param {string[]} registered
 * @returns {{code:string,hook?:string,message:string}[]}
 */
function validateProfile(profile, registered) {
  const v = [];
  const add = (code, message, hook) => v.push(hook ? { code, hook, message } : { code, message });

  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    add('NOT_AN_OBJECT', 'profile.json must be a JSON object');
    return v;
  }
  for (const key of Object.keys(profile)) {
    if (!PROFILE_KEYS.includes(key)) {
      add('UNKNOWN_FIELD', 'unknown top-level field "' + key + '"; a misspelled key is read as '
        + 'nothing at all, so the setting it was meant to be never takes effect');
    }
  }
  if (rank(profile.default) < 0) {
    add('BAD_DEFAULT', 'default must be one of ' + TIERS.join(' / ') + ', got ' + JSON.stringify(profile.default));
  }

  const floor = Array.isArray(profile.floor) ? profile.floor : null;
  if (!floor) {
    add('BAD_FLOOR', 'floor must be an array of hook ids');
  } else {
    for (const id of floor) {
      if (registered.length && !registered.includes(id)) {
        add('FLOOR_NOT_A_HOOK', 'floor names "' + id + '", which no registered hook answers to', id);
      }
    }
  }

  const hooks = profile.hooks && typeof profile.hooks === 'object' && !Array.isArray(profile.hooks)
    ? profile.hooks : null;
  if (!hooks) {
    add('BAD_HOOKS', 'hooks must be an object keyed by hook id');
  } else {
    for (const [id, row] of Object.entries(hooks)) {
      if (floor && isFloor(id, profile)) {
        add('FLOOR_IN_TABLE', 'floor hook "' + id + '" also appears in the tier table; the floor is '
          + 'what no tier can lower, and a row for it is an adjustable dial on a gate that has none', id);
        continue;
      }
      if (registered.length && !registered.includes(id)) {
        add('NOT_A_HOOK', 'the table has a row for "' + id + '", which no registered hook answers to; '
          + 'a row nothing reads is worse than no row, because it reads as configured', id);
        continue;
      }
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        add('BAD_ROW', 'the row for "' + id + '" is not an object', id);
        continue;
      }
      for (const key of Object.keys(row)) {
        if (!HOOK_ROW_KEYS.includes(key)) {
          add('UNKNOWN_ROW_FIELD', 'the row for "' + id + '" has an unknown field "' + key
            + '"; a misspelled tier name is silently ignored and the tier it meant keeps its default', id);
        }
      }
      const kind = row.kind;
      if (kind !== 'guard' && kind !== 'recorder') {
        add('BAD_KIND', 'the row for "' + id + '" declares kind ' + JSON.stringify(kind)
          + '; it must be guard or recorder', id);
        continue;
      }
      const legal = kind === 'guard' ? GUARD_MODES : RECORDER_MODES;
      let monotonic = true;
      let previous = -1;
      for (const tier of TIERS) {
        const value = row[tier];
        const at = legal.indexOf(value);
        if (at < 0) {
          add('BAD_MODE', 'the row for "' + id + '" sets ' + tier + '=' + JSON.stringify(value)
            + '; a ' + kind + ' may only be ' + legal.join(' or '), id);
          monotonic = false;
          break;
        }
        if (at < previous) monotonic = false;
        previous = at;
      }
      if (!monotonic && !v.some(f => f.hook === id && f.code === 'BAD_MODE')) {
        add('NOT_MONOTONIC', 'the row for "' + id + '" is stricter at a lower tier ('
          + TIERS.map(t => t + '=' + row[t]).join(', ') + '); fast <= standard <= strict is what makes '
          + '"the tier was lowered" mean the same thing for every gate', id);
      }
    }
    for (const id of registered) {
      if (!hooks[id] && !isFloor(id, profile)) {
        add('UNREGISTERED', 'registered hook "' + id + '" is in neither the tier table nor the floor; '
          + 'it will run at full strength as a fallback, which is a backstop and not a decision', id);
      }
    }
  }

  const raise = profile.raise;
  if (!raise || typeof raise !== 'object' || Array.isArray(raise)) {
    add('BAD_RAISE', 'raise must be an object with to / paths');
  } else {
    for (const key of Object.keys(raise)) {
      if (!RAISE_KEYS.includes(key)) add('UNKNOWN_RAISE_FIELD', 'raise has an unknown field "' + key + '"');
    }
    if (rank(raise.to) < 0) {
      add('BAD_RAISE_TO', 'raise.to must be one of ' + TIERS.join(' / ') + ', got '
        + JSON.stringify(raise.to) + '; an unknown target tier makes the automatic raise a no-op');
    }
    if (!Array.isArray(raise.paths) || raise.paths.some(p => typeof p !== 'string')) {
      add('BAD_RAISE_PATHS', 'raise.paths must be an array of glob strings');
    }
  }

  const overrides = profile.overrides;
  if (overrides !== undefined) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      add('BAD_OVERRIDES', 'overrides must be an object keyed by hook id');
    } else {
      for (const [id, value] of Object.entries(overrides)) {
        if (isFloor(id, profile)) {
          add('OVERRIDE_ON_FLOOR', 'overrides names floor hook "' + id + '", which no override reaches', id);
          continue;
        }
        const legal = (hooks && hooks[id] && hooks[id].kind === 'recorder') ? RECORDER_MODES : GUARD_MODES;
        if (!legal.includes(value)) {
          add('BAD_OVERRIDE', 'overrides sets "' + id + '" to ' + JSON.stringify(value)
            + '; it must be one of ' + legal.join(' / '), id);
        }
      }
    }
  }
  return v;
}

/**
 * The paths that make a diff governance surface. One table, two readers: the dial raises to
 * strict on them and `risk` warns about them, and a second hand-maintained copy of "which
 * files are the judge rather than the judged" drifts the first time somebody adds a directory
 * to one of them. Falls back to the shipped default when no profile is installed, so a repo
 * without the dial still gets the warning it got before.
 */
function governancePaths(root = projectRoot()) {
  const { profile } = loadProfile(root);
  const paths = (profile && profile.raise && profile.raise.paths) || null;
  return Array.isArray(paths) && paths.every(p => typeof p === 'string')
    ? paths : DEFAULT_PROFILE.raise.paths;
}

/** The live dial, in the shape every other section of the engine reads it. */
function tierState(root = projectRoot()) {
  const eff = effectiveTier({ projectDir: root });
  // sticky 时 eff.expiresEpoch 是 null，Number(null) 是 0——不先挡住就会报成「1970 年到期、剩 0h」。
  const expires = eff.sticky === true || eff.expiresEpoch === null ? NaN : Number(eff.expiresEpoch);
  // sticky 窗口没有剩余小时可报，人读那行要带上当初为什么开着它——到撤销为止的放水，理由比时长更该被看见。
  const session = eff.sticky === true ? readSession(root) : null;
  return {
    reason: session && typeof session.reason === 'string' ? session.reason : null,
    tier: eff.tier,
    source: eff.source,
    fast: eff.tier === 'fast',
    sticky: eff.sticky === true,
    raisedBy: eff.raisedBy || null,
    expiresEpoch: Number.isFinite(expires) ? expires : null,
    remainingHours: Number.isFinite(expires)
      ? Math.max(0, Math.round((expires * 1000 - Date.now()) / 360000) / 10)
      : null,
  };
}

/** The mode every known hook runs at right now, as one object. */
function modeTable(root, profile) {
  const out = {};
  for (const id of knownHooks(root, profile).ids) out[id] = gateMode(id, { projectDir: root });
  return out;
}

function humanState(state) {
  // sticky 只在它真在起作用时说（有效档位就是 fast）；被家底改动抬成 strict 时报的是 strict。
  const bits = [state.sticky && state.tier === 'fast' ? 'fast (sticky, until revoked)' : state.tier,
    'source=' + state.source];
  if (state.remainingHours !== null) bits.push(state.remainingHours + 'h left');
  if (state.raisedBy && state.raisedBy.length) {
    bits.push('raised by ' + state.raisedBy.slice(0, 3).join(', ')
      + (state.raisedBy.length > 3 ? ' and ' + (state.raisedBy.length - 3) + ' more' : ''));
  }
  return 'tier: ' + bits.join(', ') + (state.sticky && state.reason ? ' -- ' + state.reason : '');
}

function cmdTierStatus(root) {
  const { profile, present } = loadProfile(root);
  const state = tierState(root);
  process.stderr.write(humanState(state)
    + (present ? '' : ' (no profile.json installed; running on the built-in default table)') + '\n');
  return emit({
    tier: state.tier,
    source: state.source,
    ...(state.raisedBy && state.raisedBy.length ? { raisedBy: state.raisedBy } : {}),
    ...(state.sticky ? { sticky: true, expiresEpoch: null } : {}),
    ...(state.expiresEpoch === null ? {} : { expiresEpoch: state.expiresEpoch, remainingHours: state.remainingHours }),
    default: present && rank(profile.default) >= 0 ? profile.default : DEFAULT_PROFILE.default,
    profilePresent: present,
    hooks: modeTable(root, profile),
  }, 0);
}

function cmdTierExplain(root, id) {
  const { profile } = loadProfile(root);
  const known = knownHooks(root, profile);
  if (!id) {
    return die('usage: tier explain <hook-id>\nknown: ' + known.ids.join(', ') + '\n', 2);
  }
  if (!known.ids.includes(id)) {
    return die('unknown hook id: ' + id + '\nknown: ' + known.ids.join(', ') + '\n'
      + 'explaining an id nothing registers would describe a gate that never runs\n', 2);
  }
  const kind = kindOf(id, root);
  const floor = isFloor(id, profile);
  const row = (profile.hooks || {})[id];
  const strongest = kind === 'guard' ? 'block' : 'on';
  const tiers = {};
  for (const t of TIERS) tiers[t] = floor ? strongest : ((row && row[t]) || strongest);
  const ov = (profile.overrides || {})[id];
  const state = tierState(root);
  const effective = gateMode(id, { projectDir: root });
  const source = floor ? 'floor' : (typeof ov === 'string' ? 'override' : state.source);
  const out = {
    hook: id,
    kind,
    floor,
    tiers,
    effective,
    tier: state.tier,
    source,
    ...(typeof ov === 'string' ? { override: ov } : {}),
    ...(state.raisedBy && state.raisedBy.length ? { raisedBy: state.raisedBy } : {}),
  };
  process.stderr.write(id + ': ' + effective + ' now (' + kind + ', source ' + source + ') -- '
    + TIERS.map(t => t + '=' + tiers[t]).join(', ') + '\n');
  return emit(out, 0);
}

/**
 * Write the session tier. Refuses more than it accepts on purpose: every rejected form here is
 * a state somebody would otherwise have to explain later -- an unknown tier nothing can read, a
 * lowered gate with no reason recorded beside it, an expiry the caller thinks they set.
 */
function cmdTierSet(root, target, flags) {
  const usage = 'usage: tier set <' + TIERS.join('|') + '> [--hours N | --sticky] [--reason "why"]\n';
  if (!target) return die('missing tier\n' + usage, 2);
  if (rank(target) < 0) {
    return die('unknown tier: ' + target + '\n' + usage
      + 'a tier nothing recognises would be written to disk and then read as no override at all\n', 2);
  }
  const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
  if (target === 'fast' && !reason) {
    return die('tier set fast requires --reason\n' + usage
      + 'lowering the gates is a decision, and a decision with no reason recorded beside it is\n'
      + 'indistinguishable from an accident the next time somebody reads this file\n', 2);
  }
  const hoursGiven = Object.prototype.hasOwnProperty.call(flags, 'hours');
  if (hoursGiven && target !== 'fast') {
    return die('--hours applies to fast only\n' + usage
      + 'standard and strict do not expire, so an hour count here would be silently dropped\n', 2);
  }
  const sticky = Object.prototype.hasOwnProperty.call(flags, 'sticky');
  if (sticky && target !== 'fast') {
    return die('--sticky applies to fast only\n' + usage
      + 'standard and strict never expire, so there is nothing for sticky to hold open\n', 2);
  }
  if (sticky && hoursGiven) {
    return die('--sticky and --hours are mutually exclusive\n' + usage
      + 'a window that lasts N hours and one that lasts until revoked cannot both be what was meant\n', 2);
  }
  let hours = MAX_FAST_HOURS;
  let clamped = false;
  if (hoursGiven) {
    const n = Number(flags.hours);
    if (typeof flags.hours !== 'string' || !Number.isFinite(n) || n <= 0) {
      return die('--hours must be a positive number of hours\n' + usage, 2);
    }
    hours = n;
    if (hours > MAX_FAST_HOURS) { hours = MAX_FAST_HOURS; clamped = true; }
  }

  const now = Math.floor(Date.now() / 1000);
  const record = {
    tier: target,
    reason,
    by: 'user',
    set_epoch: now,
    ...(target === 'fast' && sticky ? { sticky: true, expires_epoch: null } : {}),
    ...(target === 'fast' && !sticky ? { expires_epoch: now + Math.round(hours * 3600) } : {}),
  };
  const file = runtimeFile(root);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // LF and no BOM, written whole: this file is read by every hook on every event, and a
    // half-written or CRLF copy is the shape #38 came in -- open to one reader, closed to another.
    fs.writeFileSync(file, JSON.stringify(record) + '\n', { encoding: 'utf8' });
  } catch (e) {
    return die('could not write ' + repoRelative(file) + ': ' + String((e && e.message) || e) + '\n', 1);
  }

  const until = record.expires_epoch ? new Date(record.expires_epoch * 1000).toISOString()
    : (sticky ? 'sticky, until revoked' : 'no expiry');
  gateLog('tier', 'set ' + target + ' (' + until + ')' + (reason ? ' -- ' + reason : ''), root);
  if (clamped) {
    process.stderr.write('--hours ' + flags.hours + ' capped at ' + MAX_FAST_HOURS + 'h: the window is '
      + 'a working day at most, and one that outlives the work it was opened for is the whole failure mode\n');
  }
  process.stderr.write('tier: ' + target + (record.expires_epoch ? ' until ' + until : '')
    + (sticky ? ' (sticky, until revoked; tier set standard to revoke)' : '')
    + (reason ? ' -- ' + reason : '') + '\n');
  return emit({
    tier: target,
    path: repoRelative(file),
    expiresEpoch: record.expires_epoch === undefined ? null : record.expires_epoch,
    ...(sticky ? { sticky: true } : {}),
    hours: target === 'fast' && !sticky ? hours : null,
    clamped,
    effective: tierState(root).tier,
  }, 0);
}

function cmdTierValidate(root) {
  const { profile, present, corrupt, path: file } = loadProfile(root);
  if (!present) {
    // Not a pass: the dial still runs (on the built-in table), there is simply no file whose
    // rules could be checked, and reporting that as compliant would be a verdict on nothing.
    process.stderr.write('no ' + repoRelative(file)
      + ': the built-in default table is in force and there is nothing to validate\n');
    return emit({ ok: null, note: 'no-profile', file: repoRelative(file), violations: [] }, 3);
  }
  if (corrupt) {
    process.stderr.write(repoRelative(file) + ' could not be parsed; a profile nobody can read is not a valid one\n');
    return emit({
      ok: false,
      file: repoRelative(file),
      violations: [{ code: 'UNREADABLE', message: 'profile.json could not be read as JSON' }],
    }, 1);
  }
  const reg = registeredHooks(root);
  const violations = validateProfile(profile, reg.ids);
  for (const [id, mode] of Object.entries((profile && profile.overrides) || {})) {
    if (Array.isArray(profile.floor) && profile.floor.includes(id)) {
      violations.push({ code: 'FLOOR_OVERRIDE', hook: id, message: `overrides.${id}=${mode}: floor hooks cannot be overridden` });
    }
  }
  for (const f of violations) process.stderr.write(f.code + ': ' + f.message + '\n');
  if (!reg.readable) {
    // 登记表读不出来，三条对照 settings 的规则一条没跑：这是打了折的判决，不是合规。
    process.stderr.write('.claude/settings.json could not be read; hook-registration rules were skipped\n');
    return emit({
      ok: null,
      degraded: true,
      degradedReason: 'settings-unreadable',
      degradedFile: '.claude/settings.json',
      file: repoRelative(file),
      registeredHooks: 0,
      registeredHooksReadable: false,
      violations,
    }, 3);
  }
  return emit({
    ok: violations.length === 0,
    degraded: false,
    file: repoRelative(file),
    registeredHooks: reg.ids.length,
    registeredHooksReadable: reg.readable,
    violations,
  }, violations.length ? 1 : 0);
}

/**
 * `tier` subcommand. status / set / explain / validate; anything else is a usage error rather
 * than a default, because a mistyped sub-form falling through to `status` would report the dial
 * without ever having changed it.
 */
function cmdTier(flags, positional) {
  const root = projectRoot();
  const sub = positional[0];
  switch (sub) {
    case 'status':   return cmdTierStatus(root);
    case 'explain':  return cmdTierExplain(root, positional[1]);
    case 'set':      return cmdTierSet(root, positional[1], flags);
    case 'validate': return cmdTierValidate(root);
    default:
      return die((sub ? 'unknown tier sub-command: ' + sub + '\n' : 'missing tier sub-command\n')
        + 'usage: tier status | set <' + TIERS.join('|') + '> [--hours N | --sticky] [--reason "why"] | '
        + 'explain <hook-id> | validate\n', 2);
  }
}

export {
  MAX_FAST_HOURS, validateProfile, registeredHooks, knownHooks, modeTable, tierState,
  governancePaths, cmdTier, readSession,
};
