// tier.mjs — 档位（fast / standard / strict）的**单一解析器**：一个闸此刻是 off / advise / block / on
// 只在这里算一次。hook 从这里取，引擎（quality / memory / evidence）也从这里 import——
// 依赖方向只许「引擎 → hook lib」，反过来不行（hook 与引擎是进程级隔离，见 io.mjs 头注释）。
// #38 的根因就是同一个开关被三处各解析一遍，一边判开一边判关；这份文件的存在就是不让它重演。
//
// 三个输入，合并规则「只抬不降」（秩 fast < standard < strict，取高者）：
//   ① profile.default      —— .claude/harness/profile.json 的默认档
//   ② 会话覆盖             —— .claude/.runtime/tier.json（未过期才算数，只有 `tier set` 写）
//   ③ 治理面自动升档       —— 工作树里改了 raise.paths 命中的家底文件 → 抬到 raise.to
// 地板（floor）在这三者之外：安全护栏 / 发布授权 / 压缩后回注 / 通知，profile 只能往里加、不能往外拿。
//
// **profile.json 缺席不等于没有档位**：缺文件就按下面这份内置默认表跑（与照原样装了一份同义），
// 旧的 .claude/.fast-mode 一概不读——两个开关文件并存过一次就够了（#38），留着的老开关
// 不许还能悄悄放水；要放水就走 `tier set fast`，那条路留理由、有上限、会过期。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { porcelainZ } from './io.mjs';

export const TIERS = ['fast', 'standard', 'strict'];
export const MAX_FAST_SECONDS = 8 * 3600;   // fast 档硬上限，写侧截断、读侧再夹一次

/** 档位秩：越大越严。不认识的档返回 -1（调用方按未知处理，不当成 fast）。 */
export function rank(tier) {
  return TIERS.indexOf(String(tier));
}

/** 分发包里的 profile.json 内容；缺文件 / 坏 JSON 时用它，行为与「照原样装了一份」一致。 */
export const DEFAULT_PROFILE = {
  version: 1,
  default: 'standard',
  floor: ['secret-exfil-guard', 'dangerous-pkill-guard', 'release-gate', 'postcompact-reinject', 'notify'],
  hooks: {
    'stop-gate': { kind: 'guard', fast: 'off', standard: 'advise', strict: 'block' },
    'three-file-sync-gate': { kind: 'guard', fast: 'advise', standard: 'advise', strict: 'advise' },
    'design-detail-sync': { kind: 'guard', fast: 'advise', standard: 'advise', strict: 'block' },
    'precompact-gate': { kind: 'guard', fast: 'advise', standard: 'block', strict: 'block' },
    'pre-commit-check': { kind: 'guard', fast: 'advise', standard: 'block', strict: 'block' },
    'no-direct-code-guard': { kind: 'guard', fast: 'advise', standard: 'block', strict: 'block' },
    'tdd-gate': { kind: 'guard', fast: 'off', standard: 'advise', strict: 'block' },
    'harness-async-verify': { kind: 'guard', fast: 'off', standard: 'block', strict: 'block' },
    'mark-review-needed': { kind: 'recorder', fast: 'on', standard: 'on', strict: 'on' },
    'record-authorship': { kind: 'recorder', fast: 'on', standard: 'on', strict: 'on' },
    'auto-push': { kind: 'recorder', fast: 'off', standard: 'on', strict: 'on' },
    'kill-dev-ports': { kind: 'recorder', fast: 'off', standard: 'on', strict: 'on' },
    'subagent-acceptance-reminder': { kind: 'recorder', fast: 'off', standard: 'on', strict: 'on' },
    'detect-feedback-signal': { kind: 'recorder', fast: 'off', standard: 'on', strict: 'on' },
    'check-evolution': { kind: 'recorder', fast: 'off', standard: 'on', strict: 'on' },
    'recap-on-dirty': { kind: 'recorder', fast: 'off', standard: 'on', strict: 'on' },
    'session-rules-banner': { kind: 'recorder', fast: 'on', standard: 'on', strict: 'on' },
  },
  raise: {
    to: 'strict',
    paths: ['.claude/hooks/**', '.claude/harness/**', '.claude/skills/**', '.claude/agents/**',
      '.claude/CLAUDE.md', '.claude/rules/**', '.claude/settings.json', '.github/**'],
  },
  overrides: {},
};

/**
 * 结构上的地板：任何 profile 都拿不掉。profile.floor 只能在此基础上**再加**——
 * 用户把某闸从 floor 里删掉就能让它吃 fast，那 floor 就只是一句措辞而不是地板了。
 */
const BUILTIN_FLOOR = new Set(DEFAULT_PROFILE.floor);

/** 以 decision:block 或 exit 2 表态的闸；其余是记账/提醒类。未登记 id 按种类取最严值时要用它。 */
const GUARDS = new Set([
  'dangerous-pkill-guard',
  'harness-async-verify',
  'no-direct-code-guard',
  'pre-commit-check',
  'precompact-gate',
  'release-gate',
  'secret-exfil-guard',
  'stop-gate',
  'tdd-gate',
  'three-file-sync-gate',
  'design-detail-sync',
]);

const GUARD_MODES = new Set(['off', 'advise', 'block']);
const RECORDER_MODES = new Set(['off', 'on']);

/** 把任意仓内目录归一到 git 顶层；不在 git 仓里或 git 不可用就原样返回。 */
const rootCache = new Map();
function repoRootOf(dir) {
  if (rootCache.has(dir)) return rootCache.get(dir);
  let out = dir;
  try {
    const top = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { shell: false, encoding: 'utf8' });
    if (top.status === 0 && String(top.stdout || '').trim()) out = String(top.stdout).trim();
  } catch (_e) { /* 原样 */ }
  rootCache.set(dir, out);
  return out;
}

/** 项目根：CLAUDE_PROJECT_DIR → git 顶层 → cwd（与 io.projectDir 同语义，但本模块不 import io，避免环）。 */
function defaultRoot() {
  const env = process.env.CLAUDE_PROJECT_DIR;
  if (env) return env;
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { shell: false, encoding: 'utf8' });
  if (top.status === 0 && String(top.stdout || '').trim()) return String(top.stdout).trim();
  return process.cwd();
}

/**
 * 隔离账本：坏掉的状态文件记一行就走，绝不改变调用方的判决，也绝不抛
 * （抄 core.mjs recordCorruptState 的形态，不 import）。
 * 同一进程同一文件只记一次：一次 hook 里判定会被问好几遍，一份坏文件记成三条会把
 * 「坏了几个文件」这个数直接算错。
 */
const quarantined = new Set();
function quarantine(root, kind, file, reason) {
  if (quarantined.has(file)) return;
  quarantined.add(file);
  try {
    const fp = path.join(root, '.claude', 'harness', 'state', 'quarantine.jsonl');
    const rel = path.relative(root, file).split(path.sep).join('/') || file;
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.appendFileSync(fp, JSON.stringify({
      ts: new Date().toISOString(),
      kind: String(kind),
      path: rel,
      reason: String(reason).slice(0, 500),
    }) + '\n', 'utf8');
  } catch (_e) {
    /* 账本写不成最多少一条审计，不能让它把判定掀了 */
  }
}

/**
 * 读 profile.json。
 * @returns {{profile:object, present:boolean, corrupt:boolean, path:string}}
 *   present = 档位是否启用（文件在不在）。坏 JSON 仍算「在」：一份读不懂的 profile 不该悄悄
 *   把旧 .fast-mode 通道打开——那正好是「以为自己在严格档、其实全放行」的形态。
 */
export function loadProfile(root = defaultRoot()) {
  const fp = path.join(root, '.claude', 'harness', 'profile.json');
  let raw;
  try {
    raw = fs.readFileSync(fp, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { profile: DEFAULT_PROFILE, present: false, corrupt: false, path: fp };
    quarantine(root, 'profile', fp, `读不出来：${(e && e.code) || 'IO'}`);
    return { profile: DEFAULT_PROFILE, present: true, corrupt: true, path: fp };
  }
  try {
    const v = JSON.parse(raw.replace(/\r/g, ''));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('不是 JSON 对象');
    return { profile: v, present: true, corrupt: false, path: fp };
  } catch (e) {
    quarantine(root, 'profile', fp, `坏 JSON，按内置默认档位表跑：${(e && e.message) || e}`);
    return { profile: DEFAULT_PROFILE, present: true, corrupt: true, path: fp };
  }
}

/**
 * 读运行态会话覆盖 .claude/.runtime/tier.json。
 * 缺文件 / 已过期 / 档名非法 → null（视为无覆盖，回默认档）；坏 JSON → null + quarantine 留痕。
 * 读之前先剥 \r：Windows 侧写出的 CRLF 是合法输入，不许因为行尾把整份判成坏文件（#38）。
 * @returns {{tier:string,reason?:string,by?:string,set_epoch?:number,expires_epoch?:number|null,sticky?:true}|null}
 */
export function readSession(root = defaultRoot(), now = Date.now()) {
  const fp = path.join(root, '.claude', '.runtime', 'tier.json');
  let raw;
  try {
    raw = fs.readFileSync(fp, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    quarantine(root, 'tier', fp, `读不出来：${(e && e.code) || 'IO'}`);
    return null;
  }
  let v;
  try {
    v = JSON.parse(raw.replace(/\r/g, ''));
  } catch (e) {
    quarantine(root, 'tier', fp, `坏 JSON，本次视为无覆盖回默认档：${(e && e.message) || e}`);
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v) || rank(v.tier) < 0) {
    quarantine(root, 'tier', fp, `档位字段非法（tier=${v && v.tier}），本次视为无覆盖回默认档`);
    return null;
  }
  let exp = Number(v.expires_epoch);
  // sticky：用户明说「到撤销为止」的 fast（tier set fast --sticky），不按 8h 夹、不按过期回落，
  // 只认 tier set standard|strict 撤销。只认写侧那份完整形状——sticky 严格为 true、set_epoch 仍在、
  // expires_epoch 为 null、reason 非空：手写一份半截的 sticky 不能换来无限期放水，缺哪样都按普通 fast
  // 走下面的夹与过期（缺 set_epoch 照旧 quarantine 拒收，红蓝 High #2 的硬化不退）。
  if (v.tier === 'fast' && v.sticky === true && v.expires_epoch === null
      && Number.isFinite(Number(v.set_epoch)) && v.set_epoch !== null
      && typeof v.reason === 'string' && v.reason.trim()) {
    return v;
  }
  if (v.tier === 'fast') {
    // 8h 硬上限在读侧也夹：写侧的截断只是礼貌，手写一份 720h 的 tier.json 不能换来 720h 的放水。
    // 夹的锚点是 set_epoch——缺了它上限就没处算，这份 fast 覆盖不认（红蓝审查 v2.0.0 High #2：
    // 缺 set_epoch 曾换来 642713 小时的 fast）。
    const setAt = Number(v.set_epoch);
    if (!Number.isFinite(setAt) || !Number.isFinite(exp)) {
      quarantine(root, 'tier', fp, `fast 会话缺 set_epoch/expires_epoch（8h 上限无处算），本次视为无覆盖回默认档`);
      return null;
    }
    // 锚点取 min(set_epoch, now)：set_epoch 写到未来会把 8h 窗口整体平移（红蓝复核 Medium：曾换来 30 天）
    const cap = Math.min(setAt, Math.floor(now / 1000)) + MAX_FAST_SECONDS;
    if (exp > cap) { exp = cap; v = { ...v, expires_epoch: cap }; }
  }
  if (Number.isFinite(exp) && exp * 1000 <= now) return null;   // 到期自动失效，不靠人记得关
  return v;
}

/** glob 转正则：两个星号加斜杠跨目录、结尾两个星号全匹、单星号只吃一段、`?` 单字符，其余字面量转义。 */
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * 运行态目录：工具自己写出来的东西，不算「有人改了治理面」。
 * 少了这一条，跑一次 gate 落一行账本、读到一份坏状态记一条 quarantine，工作树就永远脏在
 * `.claude/harness/**` 上，档位从此钉在 strict 再也下不来——一直响的警报等于没有警报。
 * 与引擎 core.mjs 的 STATE_EXCLUDE 同一份集合（按目录写，新增一种运行态自动被覆盖）；
 * hook 不 import 引擎，所以这里抄一份精简版。
 */
const STATE_PREFIXES = [
  '.claude/.runtime/',
  '.claude/evidence/',
  '.claude/harness/receipts/',
  '.claude/harness/waivers/',
  '.claude/harness/trend/',
  '.claude/harness/state/',
  '.claude/harness/evidence/',
  '.claude/worktrees/',
];
const STATE_FILES = ['.claude/.needs-review', '.claude/.needs-review.lock', '.claude/.fast-mode'];
function isRuntimeState(p) {
  return STATE_FILES.includes(p) || STATE_PREFIXES.some((pre) => p.startsWith(pre));
}

/** 工作树改动路径（含未跟踪，去掉运行态）。git 不可用 / 跑不成 → 空数组（不抬，不是抬）。 */
const dirtyCache = new Map();
function dirtyPaths(root) {
  if (dirtyCache.has(root)) return dirtyCache.get(root);
  // -uall 不能省：未跟踪目录默认会被折叠成一条 `?? .claude/`，`.claude/hooks/**` 就永远命不中，
  // 治理面升档在「家底目录整个还没进版本库」的项目里等于不存在。
  const st = porcelainZ(root, ['-uall']);
  const out = [];
  if (st.error && st.error.code === 'ENOENT' && !dirtyCache.has('__git_warned__')) {
    // git 二进制不在：按设计不抬（不是抬），但要出声——静默等于「今天家底改动不算数」没人知道。
    // 「在但不是仓」不算异常（框架允许装在非 git 目录），那种情况照常不抬、不喊。
    dirtyCache.set('__git_warned__', true);
    process.stderr.write('[tier] 找不到 git，治理面自动升档本轮跳过（按当前档跑）\n');
  }
  // 只有 git 真跑成了才算「看过工作树」：非 0 退出时不拿半截 stdout 当改动集。
  if (st.status === 0) {
    for (const p of st.paths) if (!isRuntimeState(p)) out.push(p);
  }
  dirtyCache.set(root, out);
  return out;
}

/** 工作树里命中 raise.paths 的路径（点名用；空数组 = 不抬）。 */
function raisedBy(root, profile) {
  const raise = (profile && profile.raise) || {};
  const pats = Array.isArray(raise.paths) ? raise.paths : [];
  if (!pats.length || rank(raise.to) < 0) return [];
  const res = pats.map(globToRe);
  return dirtyPaths(root).filter((p) => res.some((re) => re.test(p)));
}

/**
 * 当前生效档位。
 * @returns {{tier:string, source:'default'|'session'|'raise', raisedBy?:string[], expiresEpoch?:number, sticky?:true}}
 */
export function effectiveTier({ projectDir = defaultRoot(), now = Date.now() } = {}) {
  // 传进来的可能是仓内某个子目录（调用方拿 cwd 当项目根）：profile / tier.json / git status 都得
  // 以仓根为准，否则家底改动一条命不中、档位静默回默认（红蓝审查 v2.0.0 High #1）。
  projectDir = repoRootOf(projectDir);
  const { profile } = loadProfile(projectDir);
  const session = readSession(projectDir, now);
  const def = rank(profile.default) >= 0 ? profile.default : DEFAULT_PROFILE.default;
  const tier = session ? session.tier : def;
  // 与默认同档的会话记录不算覆盖：`tier set standard`（`fast-mode.sh off` 走的就是它）写的是
  // 一份「回到默认」的记录，关掉之后 source 还报 session，就再也分不出「用户把档位钉住了」
  // 和「刚把 fast 关掉」——而这两种处境下该说的话完全不同。
  const source = session && session.tier !== def ? 'session' : 'default';
  const out = { tier, source };
  // sticky 对外契约：sticky:true + expiresEpoch:null（消费方按 null 判「到撤销」，别 Number(null) 算成 0）。
  if (session && session.sticky === true) { out.sticky = true; out.expiresEpoch = null; }
  else if (session && Number.isFinite(Number(session.expires_epoch))) out.expiresEpoch = Number(session.expires_epoch);

  const raise = (profile.raise || {});
  if (rank(raise.to) > rank(tier)) {
    const hits = raisedBy(projectDir, profile);
    if (hits.length) {
      out.tier = raise.to;
      out.source = 'raise';
      out.raisedBy = hits;
    }
  }
  return out;
}

/** 某 hook 的种类（登记表优先，未登记按 GUARDS 兜底）。 */
function isGuard(id, profile) {
  const row = profile && profile.hooks && profile.hooks[id];
  if (row && row.kind) return row.kind === 'guard';
  return GUARDS.has(id);
}

/** 某 hook 是拦停闸还是记账闸（引擎的 `tier explain` 要说清它是哪一类才谈得上取值域）。 */
export function kindOf(id, root = defaultRoot()) {
  const { profile } = loadProfile(root);
  return isGuard(id, profile) ? 'guard' : 'recorder';
}

/** 某种类的最严值：未登记的闸按最严跑，不会因为漏登记就静默。 */
function strictestFor(guard) {
  return guard ? 'block' : 'on';
}

const warned = new Set();
function warnUnregistered(id) {
  if (warned.has(id)) return;
  warned.add(id);
  try { fs.writeSync(2, `[tier] 闸 ${id} 不在 profile.hooks 表里，本次按最严档跑；请补登记或确认它是否属于 floor。\n`); } catch (_e) { /* 提醒发不出去不影响判定 */ }
}

/**
 * 这个闸此刻该怎么跑：'off' 静默放行 / 'advise' 只提醒记账不拦 / 'block' 按拦停闸跑 / 'on' 按记账跑。
 * 优先级：floor → overrides → 档位表；floor 永远拦，overrides 是用户的最终话语权（explain 会标出来）。
 * @param {string} id hook id（= 文件名去后缀）
 * @param {{projectDir?:string, now?:number}} [ctx]
 */
export function gateMode(id, ctx = {}) {
  const root = ctx.projectDir || defaultRoot();
  const { profile } = loadProfile(root);
  const guard = isGuard(id, profile);

  const floor = Array.isArray(profile.floor) ? profile.floor : [];
  if (BUILTIN_FLOOR.has(id) || floor.includes(id)) return strictestFor(guard);

  const legal = guard ? GUARD_MODES : RECORDER_MODES;
  const ov = profile.overrides && profile.overrides[id];
  if (typeof ov === 'string' && legal.has(ov)) return ov;

  const row = profile.hooks && profile.hooks[id];
  if (!row) { warnUnregistered(id); return strictestFor(guard); }

  // 省掉一次 git status：raise 只会往上抬，若本闸在「当前档」与「可能被抬到的档」上取值相同，
  // 探不探工作树都是同一个答案。默认档下这一条让绝大多数 PostToolUse hook 完全不碰 git。
  const session = readSession(root, ctx.now);
  const base = session ? session.tier : (rank(profile.default) >= 0 ? profile.default : DEFAULT_PROFILE.default);
  const to = (profile.raise || {}).to;
  const pick = (t) => {
    const v = row[t];
    return (typeof v === 'string' && legal.has(v)) ? v : strictestFor(guard);
  };
  if (rank(to) <= rank(base) || pick(to) === pick(base)) return pick(base);

  return pick(effectiveTier({ projectDir: root, now: ctx.now }).tier);
}

/** 兼容旧调用方：现在「fast 档」就是过去的「fast-mode 开着」。 */
export function fastModeActive(ctx = {}) {
  return effectiveTier(ctx).tier === 'fast';
}
