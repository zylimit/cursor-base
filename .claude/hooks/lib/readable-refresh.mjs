// readable-refresh.mjs — pre-commit-check 里「提交前重出人读文档」那一段（2026-11-23 加）。
// 行为照 docs/readable-spec/phase1-db-contract.md I 节第 1、5 条。为什么挂在提交前：人读文档是入库的生成物，
// 写给没有 AI 编程工具的接手团队看，靠人记得「改完代码重出一遍」迟早会忘，忘了仓里的文档就悄悄落后于代码；
// 提交是每次改动必经的一步，机器在这里重出，不占人。
//   - 没有 docs/readable-src/config.json：什么都不做、什么都不说。
//   - 重出后 docs/readable/ 有没暂存的变化 → 告诉调用方要拦（退出码 2 由调用方定），提示 git add 之后重提。
//     不替人暂存：钩子改暂存区，会把人没打算提交的东西带进提交；拦一下、给一条 git add，是可预期的。
//   - 重出自己失败（配置错、落盘前自检没过、超时）→ 不拦，原因照原样报出来——出文档的毛病不该把
//     所有提交都卡死，那样人很快就会把这道闸关掉。失败要大声说，但放行。
//   - 有待更新或成了孤儿的说明 → 不拦，报数：补说明是任务验收的事，提交这一刻只提醒。
//   - 配置没跟上项目（init --suggest 报出漏列的建表文件、代码目录、需求规格或架构文档）→ 不拦，一句话列出漏的。
//     配置是在还没有代码时起草的，之后冒出来的建表文件与代码目录没人填，数据库设计与架构设计就一直是空的；
//     没有漏项时一个字不多，它自己出错、超时同 build 失败一样报出来、放行。
//   - 结构变坏（2026-11-24 加，契约 I 节第 14 条）：只在放行的那一回比——页面都已暂存、不再拦；被拦的那一回不比，
//     免得同一次改动提醒两遍、日志记两行。拿上一个提交里的架构首页与刚重出的一张各跑一次 structure --page --json，比条目不比个数，
//     多出来的提醒一句、记一行 [advise]，只提醒不拦，任何档都一样——数从 3 变成 4 没人会去翻页面，提交这一刻点名是哪次改动弄坏的。
//     上一个提交里没有这一页（第一次出）、哪一张是旧格式或项目没出架构设计（structure 退出码 2）：不比、一个字不多；
//     真没跑成（超时、别的退出码、输出不对）只带一句原因，不记账、不拦。
// 超时压得比 settings.json 给整道闸的 30 秒小得多：tsc 与大仓门也在这 30 秒里，重出占满了，
// 宿主会把整道闸杀掉，编译门的判决也跟着丢。真项目上 build 不到一秒、check 约 0.3 秒，十倍余量还有富余；
// init --suggest 只走一遍文件清单，给得最少；structure 只读一页，两张页面一字不差时一次都不跑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, git, say, errText } from './io.mjs';
import { gateLog } from './gatelog.mjs';

const CONFIG = 'docs/readable-src/config.json';
const SCRIPT = '.claude/scripts/readable-docs.mjs';
const OUT = 'docs/readable';
const BUILD_TIMEOUT_MS = 10000;
const CHECK_TIMEOUT_MS = 5000;
const SUGGEST_TIMEOUT_MS = 3000;
const STRUCT_TIMEOUT_MS = 3000;
// 核对的 JSON 全文要读进来再数，spawnSync 默认 1MB 截断会让子进程被杀、解析失败
const MAX_BUFFER = 64 * 1024 * 1024;
const LIST_CAP = 5;
const OUT_OF_SYNC = '人读文档这次没重出，现在与来源不同步';
const ARCH_INDEX = `${OUT}/arch/index.html`;
const NAME_CAP = 3; // 结构变坏每样最多点名三条，其余给个数（契约 I 节第 14 条）
const WORSE_HEAD = '人读文档·结构：这次提交多了';
const WORSE_LOG = '[advise] 结构变坏：'; // 不带「人读文档」四个字，免得被回流那一行（第 13 条）数成提交被拦

/** 相对项目根的正斜杠路径 → 本机路径（Windows 上换成反斜杠）。 */
const local = (root, rel) => path.join(root, ...rel.split('/'));

function runDocs(root, sub, timeout) {
  return run(process.execPath, [local(root, SCRIPT), ...sub, '--root', root], { cwd: root, timeout, maxBuffer: MAX_BUFFER });
}

/** 子命令没跑成的原因：超时、起不来、非零退出码，后者把它自己的输出照原样带上。 */
function failReason(r, timeout) {
  if (r.error && r.error.code === 'ETIMEDOUT') return `超过 ${timeout / 1000} 秒没跑完，已中止`;
  if (r.error) return `起不来：${errText(r.error)}`;
  const text = `${r.stderr}${r.stdout}`.trimEnd();
  return `退出码 ${r.status}${text ? `：\n${text}` : '（无输出）'}`;
}

/**
 * docs/readable/ 下没暂存的变化：已跟踪的看工作树对暂存区（改动、删掉），未跟踪的另算新增。
 * 被 .gitignore 掉的目录两条都看不到，自然为空——那是项目自己决定不入库。
 * 路径一律相对项目根（diff 加 --relative，与 ls-files 同口径），项目是父仓子目录时也不带仓根前缀。
 */
function unstagedPages(root) {
  const diff = git(['diff', '--relative', '--no-renames', '--name-status', '-z', '--', OUT], { cwd: root });
  const others = git(['ls-files', '--others', '--exclude-standard', '-z', '--', OUT], { cwd: root });
  for (const r of [diff, others]) {
    if (r.status !== 0) return { error: r.error ? errText(r.error) : (r.stderr.trim() || `git 退出码 ${r.status}`) };
  }
  const changed = new Map();
  const recs = diff.stdout.split('\0');
  for (let i = 0; i + 1 < recs.length; i += 2) {
    if (recs[i]) changed.set(recs[i + 1], recs[i] === 'D' ? '删掉' : '改动');
  }
  for (const p of others.stdout.split('\0')) if (p) changed.set(p, '新增');
  return { paths: [...changed.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)) };
}

/** 待更新、成了孤儿的说明各几段：读 check --json（契约 H 节的机器口径），不去猜 build 给人看的那行。 */
function noteDebt(root) {
  const r = runDocs(root, ['check', '--json'], CHECK_TIMEOUT_MS);
  if (r.error || (r.status !== 0 && r.status !== 1)) return { error: `readable-docs.mjs check --json ${failReason(r, CHECK_TIMEOUT_MS)}` };
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch (e) { return { error: `check --json 的输出不是 JSON：${errText(e)}` }; }
  const problems = parsed && Array.isArray(parsed.problems) ? parsed.problems : null;
  if (!problems) return { error: 'check --json 的输出里没有 problems 清单' };
  const count = (kind) => problems.filter((p) => p && p.kind === kind).length;
  return { stale: count('note-stale'), orphan: count('note-orphan') };
}

/** 配置漏了什么：读 init --suggest --json（契约 I 节第 5 条）。退出码 0 没漏、1 有漏，别的都是没查成。每样最多列 LIST_CAP 个。 */
function configGaps(root) {
  const r = runDocs(root, ['init', '--suggest', '--json'], SUGGEST_TIMEOUT_MS);
  if (r.error || (r.status !== 0 && r.status !== 1)) return { error: `readable-docs.mjs init --suggest --json ${failReason(r, SUGGEST_TIMEOUT_MS)}` };
  if (r.status === 0) return { gaps: [] };
  let m;
  try { m = JSON.parse(r.stdout).missing; } catch (e) { return { error: `init --suggest --json 的输出不是 JSON：${errText(e)}` }; }
  const list = (key, xs) => (Array.isArray(xs) && xs.length
    ? `${key} 漏了 ${xs.slice(0, LIST_CAP).join('、')}${xs.length > LIST_CAP ? ` 等 ${xs.length} 个` : ''}` : null);
  const gaps = m && typeof m === 'object'
    ? [list('ddl', m.ddl), list('codeRoots', m.codeRoots), m.spec ? `spec 是 null 而根目录有 ${m.spec}` : null, list('archDocs', m.archDocs)].filter(Boolean) : [];
  // 退出码说有漏、却一样都认不出来：输出的形状不对，不当成「没漏」
  return gaps.length ? { gaps } : { error: 'init --suggest --json 退出码 1，输出里却认不出漏了什么' };
}

/** 一张架构首页的结构：{ s } 取到了；{ skip } 退出码 2（旧格式、没出架构设计、生成器没有这条子命令）；{ error } 没跑成。 */
function structureOf(root, page) {
  const r = runDocs(root, ['structure', '--page', page, '--json'], STRUCT_TIMEOUT_MS);
  if (!r.error && r.status === 2) return { skip: true };
  if (r.error) return { error: `readable-docs.mjs structure ${failReason(r, STRUCT_TIMEOUT_MS)}` };
  if (r.status !== 0) {
    const first = `${r.stderr}${r.stdout}`.split(/\r?\n/).find((l) => l.trim());
    return { error: `readable-docs.mjs structure 退出码 ${r.status}${first ? `：${first.trim()}` : '（无输出）'}` };
  }
  let s;
  try { s = JSON.parse(r.stdout); } catch (e) { return { error: `structure --json 的输出不是 JSON：${errText(e)}` }; }
  const ok = s && ['cycles', 'upward', 'unassigned', 'big'].every((k) => Array.isArray(s[k])) && Number.isInteger(s.problems)
    && [...s.cycles, ...s.upward].every((u) => u && typeof u.key === 'string' && Number.isInteger(u.pairs));
  return ok ? { s } : { error: 'structure --json 的输出里五样不全或形状不对' };
}

/**
 * 这一张比上一张多出来的，逐样一句；没有多出来的是空清单。循环依赖与越层引用多出来的是新的一条，或同一条的文件对数变多——
 * 存量项目多半不是新出一个环，是在已有的环里越缠越紧。循环依赖按排过序的成员认，不看页面上成员的先后（模块清单换了顺序不算新的一组）。
 */
function worsened(prev, cur) {
  const members = (c) => c.split(' ').sort().join(' ');
  const fresh = (was, now) => { const had = new Set(was); return now.filter((x) => !had.has(x)); };
  const grew = (was, now, norm, what) => {
    const before = new Map(was.map((x) => [norm(x.key), x.pairs]));
    return now.filter((x) => !before.has(norm(x.key)) || x.pairs > before.get(norm(x.key)))
      .map((x) => `「${x.key}」${before.has(norm(x.key)) ? `文件对 ${before.get(norm(x.key))}→${x.pairs}` : `${what}、${x.pairs} 对文件`}`);
  };
  const cycles = grew(prev.cycles, cur.cycles, members, '新的一组'), upward = grew(prev.upward, cur.upward, (k) => k, '新的一对');
  const named = (what, unit, list) => (list.length ? `${what} ${list.length} ${unit}：${list.slice(0, NAME_CAP).join('、')}${list.length > NAME_CAP ? `，另 ${list.length - NAME_CAP} ${unit}` : ''}` : null);
  const q = (xs) => xs.map((x) => `「${x}」`);
  return [
    named('循环依赖', '组', cycles),
    named('越层引用', '对模块', upward),
    named('未归属的文件', '个', q(fresh(prev.unassigned, cur.unassigned))),
    named('超过 1000 行的文件', '个', q(fresh(prev.big, cur.big))),
    cur.problems > prev.problems ? `项目判断里对不上的 ${prev.problems}→${cur.problems} 条` : null,
  ].filter(Boolean);
}

/** 上一个提交里的架构首页：{ text } 有；{ skip } 没有上一个提交或那里没有这一页；{ error } git 没跑成。HEAD:./ 照项目根算，项目是父仓子目录时也对。 */
function headPage(root) {
  const v = git(['rev-parse', '-q', '--verify', `HEAD:./${ARCH_INDEX}`], { cwd: root });
  if (!v.error && v.status === 1) return { skip: true };
  const c = v.status === 0 ? git(['cat-file', 'blob', v.stdout.trim()], { cwd: root, maxBuffer: MAX_BUFFER }) : v;
  if (c.error || c.status !== 0) return { error: `git 取不出上一个提交里的 ${ARCH_INDEX}（${c.error ? errText(c.error) : (c.stderr.trim() || `退出码 ${c.status}`)}）` };
  return { text: c.stdout };
}

/** 结构变坏当场提醒（见文件头）。只说、只记账，不改拦不拦；自身的意外也在这里接住，不让它冲掉前面几段的判决与提醒。 */
function structureWatch(root) {
  let tmp = null;
  try {
    const curFile = local(root, ARCH_INDEX);
    if (!fs.existsSync(curFile)) return;
    const head = headPage(root);
    if (head.skip) return;
    // 比不成的原因只留首行、最多 120 个字（契约「原因首行」）：structure 以异常退出时标准错误是一整段栈，不往提交的输出里倒
    const brief = (why) => Array.from(String(why).split(/\r?\n/)[0]).slice(0, 120).join('');
    const cannot = (why) => say(`⚠️ 人读文档已重出，但没比成结构（${brief(why)}）——不拦这次提交。`);
    if (head.error) { cannot(head.error); return; }
    if (head.text === fs.readFileSync(curFile, 'utf8')) return;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readable-structure-'));
    const prevFile = path.join(tmp, 'index.html');
    fs.writeFileSync(prevFile, head.text);
    const prev = structureOf(root, prevFile), cur = structureOf(root, curFile);
    if (prev.error || cur.error) { cannot(prev.error || cur.error); return; }
    if (prev.skip || cur.skip) return;
    const more = worsened(prev.s, cur.s);
    if (!more.length) return;
    say(`${WORSE_HEAD} ${more.join('；')}——是有意的在提交说明里写明原因，不是就先理顺再提交。`);
    gateLog('pre-commit-check', `${WORSE_LOG}${more.join('；')}`);
  } catch (e) {
    say(`⚠️ 人读文档已重出，但比结构那一步自身出错（${Array.from(errText(e).split(/\r?\n/)[0]).slice(0, 120).join('')}）——不拦这次提交。`);
  } finally {
    if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { say(`⚠️ 比结构用的临时目录没删掉（${tmp}：${errText(e)}）`); }
  }
}

function reportChanges(paths, mode) {
  const n = (what) => paths.filter(([, k]) => k === what).length;
  const head = `docs/readable/ 有 ${paths.length} 页重出后变了、还没暂存（改动 ${n('改动')}、新增 ${n('新增')}、删掉 ${n('删掉')}）`;
  const list = paths.slice(0, LIST_CAP).map(([p, k]) => `  ${k} ${p}`);
  if (paths.length > LIST_CAP) list.push(`  另有 ${paths.length - LIST_CAP} 页`);
  const hint = 'git add docs/readable 之后重提——生成是确定的，暂存后再提交这一段就过。';
  if (mode === 'advise') {
    say(`⚠️ 人读文档：${head}：\n${list.join('\n')}\n${hint}`);
    say('[fast] fast 档不拦本次 commit——不 git add，这些页就不在这次提交里，仓里的文档落后于代码。');
    gateLog('pre-commit-check', `[fast] 人读文档 ${paths.length} 页没暂存，advise 档放行 commit`);
    return false;
  }
  say(`❌ 人读文档：${head}，commit 被阻止：\n${list.join('\n')}\n${hint}`);
  gateLog('pre-commit-check', `人读文档 ${paths.length} 页重出后没暂存，commit 被阻止`);
  return true;
}

function refresh(root, mode) {
  if (!fs.existsSync(local(root, SCRIPT))) {
    say(`⚠️ 有 ${CONFIG} 但没装 ${SCRIPT}，${OUT_OF_SYNC}——不拦这次提交，补装框架后重出。`);
    gateLog('pre-commit-check', `人读文档没重出（没装 ${SCRIPT}），放行 commit`);
    return false;
  }
  const b = runDocs(root, ['build'], BUILD_TIMEOUT_MS);
  if (b.error || b.status !== 0) {
    say(`⚠️ 人读文档重出失败（readable-docs.mjs build ${failReason(b, BUILD_TIMEOUT_MS)}）\n${OUT_OF_SYNC}——不拦这次提交，修好后手跑 build 再提交一次。`);
    const short = b.error ? (b.error.code === 'ETIMEDOUT' ? '超时' : errText(b.error)) : `退出码 ${b.status}`;
    gateLog('pre-commit-check', `人读文档没重出（build ${short}），放行 commit`);
    return false;
  }
  // 成功时 build 也可能在标准错误上说话（如清掉了上一次被打断留下的临时目录），它想让人看见的照转
  if (b.stderr.trim()) say(b.stderr.trimEnd());

  const ch = unstagedPages(root);
  const held = ch.error ? false : (ch.paths.length > 0 && reportChanges(ch.paths, mode));
  if (ch.error) say(`⚠️ 人读文档已重出，但查不了 docs/readable/ 的暂存状态（${ch.error}）——不拦这次提交，提交前自己 git status 看一眼。`);

  const debt = noteDebt(root);
  if (debt.error) say(`⚠️ 人读文档已重出，但没数成说明的状态（${debt.error}）——不拦这次提交。`);
  else if (debt.stale || debt.orphan) {
    say(`⚠️ 人读文档有 ${debt.stale} 段说明待更新、${debt.orphan} 段成了孤儿——不拦这次提交，任务验收前补齐（node ${SCRIPT} pending 看清单）。`);
  }

  const cfg = configGaps(root);
  if (cfg.error) say(`⚠️ 人读文档已重出，但没查成配置有没有漏项（${cfg.error}）——不拦这次提交。`);
  else if (cfg.gaps.length) {
    say(`⚠️ 人读文档的配置没跟上项目：${cfg.gaps.join('；')}——不拦这次提交，填进 ${CONFIG}（不该算的写进 ignore）后重出（node ${SCRIPT} init --suggest 看清单）。`);
  }

  // 结构变坏只在放行的那一回比：页面都已暂存（查不了暂存状态的、fast 档页面没暂存而放行的都不算，页面不在这次提交里）。
  if (!ch.error && !ch.paths.length) structureWatch(root);
  return held;
}

/**
 * 提交前重出人读文档。返回 true = 页面有没暂存的变化、本档要拦（调用方设退出码 2）；其余一律 false。
 * 这一段自己出了意外也不拦：它的毛病属于「出文档的毛病」，同 build 失败一样大声说、放行。
 */
export function refreshReadableDocs(root, mode) {
  if (!fs.existsSync(local(root, CONFIG))) return false;
  try {
    return refresh(root, mode);
  } catch (e) {
    say(`⚠️ 人读文档那一段自身出错（${errText(e)}），${OUT_OF_SYNC}——不拦这次提交。`);
    gateLog('pre-commit-check', `人读文档那一段自身出错，放行 commit：${errText(e)}`);
    return false;
  }
}
