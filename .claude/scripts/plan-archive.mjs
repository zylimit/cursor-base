#!/usr/bin/env node
// plan-archive.mjs —— 把做完的 Phase 从 DEV-PLAN.md 原文搬到 DEV-PLAN.archive.md，原文件只留一行带 REQ 编号的指针。
// 2026-10-30 定过「已完成 Phase 超 20 个就手工搬」，三周没有一个项目搬过：2026-11-22 下游 digifiber-conflation 的
// DEV-PLAN.md 658KB / 135 个 Phase，OFR-ARIANE 232KB / 29 个，lutetia 147KB / 13 个。手工搬上千字原文正是 2026-09-19
// 丢过三条决策的那种活，所以照 progress-archive.mjs 的路数交给脚本：先写归档、从磁盘重读核对、再改正文，
// 任何一步失败 DEV-PLAN.md 一个字节不动。行为契约见 docs/living-docs-contract-2026-11.md 第 2 节。
// 用法：node .claude/scripts/plan-archive.mjs [--root <目录>] [--check] [--json]
//   --root   目标目录，默认 $CLAUDE_PROJECT_DIR，再默认当前目录
//   --check  只算不写，两份文件一个字节不动
//   --json   只输出一份机器可读 JSON（不带此参数输出人读文本，二者互斥）
// 退出码：0 = 没东西要搬，或搬完且核对通过（含 --check、含无 DEV-PLAN.md）；1 = 读写/核对失败，DEV-PLAN.md 未改；2 = 参数错
// 环境变量 PLAN_ARCHIVE_FAIL_AT（只给测试用，其余取值或不设都无效果）：
//   archive-write  在写归档那一步模拟写失败；verify  归档已写完，在核对那一步模拟有一行没找到。
//   两种注入都走真失败时的 throw → exit(1) 那条路，DEV-PLAN.md 不会被动。误设的后果只是脚本什么都不改就退出。
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// ---- 阈值（全文只此一处；活文档契约 2026-11-22 第 2 节） ----
const RETAIN_COMPLETED = 20;   // 已完成小节超过这个数，搬编号最小的、留编号最大的这么多个
const CEILING_BYTES = 65536;   // 留下的已完成小节合计体积线（UTF-8 字节，每行另加 1）
const FLOOR_COMPLETED = 3;     // 按体积线往下搬时，已完成小节至少留这么多个

const PHASE_RE = /^## Phase\s+(\d+)[:：]/;
const PHASE_PREFIX = '## Phase';  // 以它开头却不符合 PHASE_RE 的标题（`## Phase 5.x`、`## Phase A`）不认不搬，只报个数
const ARCHIVED_HEADING = '## 已归档 Phase';
const ARCHIVED_HEADING_RE = /^## 已归档 Phase\s*$/;
// 契约写的是 \bREQ-…\b。plan-lint.sh 用 Python 跑同一条正则，Python 的 \b 按 Unicode 算，汉字也是「字」：
// 「对应REQ-X-001」Python 认不出、JS 的 ASCII \b 认得出。指针行里的编号要和 plan-lint 看到的是同一批，
// 否则搬完多出 plan-lint 原先没见过的编号，可能凭空冒出悬空引用；所以这里用 Unicode 边界复刻 Python 的口径。
const REQ_RE = /(?<![\p{L}\p{N}_])REQ-[A-Za-z0-9]{1,16}-\p{Nd}{2,4}(?![\p{L}\p{N}_])/gu;
const FENCE_RE = /^\s*(```|~~~)/;
const DONE_MARK = '✅';
const ARCHIVE_NAME = 'DEV-PLAN.archive.md';
const ARCHIVE_TITLE = '# DEV-PLAN 归档';

function usageError(msg) {
  console.error(`plan-archive: ${msg}（用法：plan-archive.mjs [--root <dir>] [--check] [--json]）`);
  process.exit(2);
}

let root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let check = false, json = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--root') { root = argv[++i]; if (root === undefined) usageError('--root 缺值'); }
  else if (a === '--check') check = true;
  else if (a === '--json') json = true;
  else usageError(`未知参数：${a}`);
}

const kb = (n) => (n / 1024).toFixed(1);
const bytesOf = (arr) => arr.reduce((s, l) => s + Buffer.byteLength(l, 'utf8') + 1, 0);
function atomicWrite(path, text) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text);
  try { renameSync(tmp, path); } catch (e) { try { unlinkSync(tmp); } catch { /* 尽力清理，失败不影响原错误 */ } throw e; }
}

// 切小节：`## ` 开头的行是小节边界，围栏里的行不当标题（围栏用同一种记号收口）。
// Phase 小节从标题行到下一个 `## ` 之前，中间的空行与 `---` 分隔线跟着它走；`### ` 不是边界。
function parsePlan(lines) {
  const heads = []; const fenced = new Set(); let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FENCE_RE);
    if (fence) { fenced.add(i); if (m && m[1] === fence) fence = null; continue; }
    if (m) { fence = m[1]; fenced.add(i); continue; }
    if (lines[i].startsWith('## ')) heads.push(i);
  }
  // split 出来的最后一个空串只是文件收尾的换行，不算最后一节的内容
  const end = lines.length - (lines.length && lines[lines.length - 1] === '' ? 1 : 0);
  const phases = []; let archived = null; let unrecognized = 0;
  heads.forEach((idx, hi) => {
    const next = hi + 1 < heads.length ? heads[hi + 1] : end;
    const m = lines[idx].match(PHASE_RE);
    if (m) {
      const sec = { start: idx, end: next, n: Number(m[1]), title: lines[idx].slice(3), done: lines[idx].includes(DONE_MARK) };
      sec.bytes = bytesOf(lines.slice(idx, next));
      phases.push(sec);
    } else if (lines[idx].startsWith(PHASE_PREFIX)) unrecognized++;
    else if (!archived && ARCHIVED_HEADING_RE.test(lines[idx])) archived = { start: idx, end: next };
  });
  const hasRule = lines.some((l, i) => l === '---' && !fenced.has(i));
  return { phases, archived, fenced, end, hasRule, unrecognized };
}

const planPath = join(root, 'DEV-PLAN.md');
const archPath = join(root, ARCHIVE_NAME);

if (!existsSync(planPath)) {
  const out = { command: 'plan-archive', ok: true, root, total: 0, completed: 0, completedBytes: 0, moved: 0, alreadyArchived: 0, unmarked: 0, unrecognized: 0, nothingDue: true };
  if (check) out.check = true;
  if (json) console.log(JSON.stringify(out)); else console.log(`无 DEV-PLAN.md（${planPath}），不处理。`);
  process.exit(0);
}

let planRaw;
try { planRaw = readFileSync(planPath, 'utf8'); }
catch (e) { console.error(`plan-archive: 读 DEV-PLAN.md 失败（${planPath}）：${e.message}`); process.exit(1); }
const planEol = planRaw.includes('\r\n') ? '\r\n' : '\n';
const lines = planRaw.split(/\r?\n/);
const { phases, archived, fenced, end, hasRule, unrecognized } = parsePlan(lines);
const completed = phases.filter((s) => s.done);
const completedBytes = completed.reduce((s, x) => s + x.bytes, 0);

// 触发与保留按 Phase 编号，不按文档位置：conflation 的 DEV-PLAN 里 Phase 59 排在 54 前面、68 排在 67 前面，最新写在上面的
// 计划按位置搬会先把最新的搬走。先按条数留编号最大的 20 个；留下的合计体积还超线，就从编号最小的起继续搬，
// 到线下或只剩地板 3 个为止。sort 是稳定的，编号相同的保持文档顺序。
const byNum = [...completed].sort((a, b) => a.n - b.n);
let k = byNum.length > RETAIN_COMPLETED ? byNum.length - RETAIN_COMPLETED : 0;
let keptBytes = byNum.slice(k).reduce((s, x) => s + x.bytes, 0);
while (keptBytes > CEILING_BYTES && byNum.length - k > FLOOR_COMPLETED) { keptBytes -= byNum[k].bytes; k++; }
// 选出来之后回到文档顺序：归档按文档顺序追加，指针也按文档顺序排
const toMove = byNum.slice(0, k).sort((a, b) => a.start - b.start);

// 做完没标：只数编号比最大的已完成编号小、自己却没带 ✅ 的；编号更大的是还没做的，不算。
const maxDoneN = completed.reduce((m, s) => Math.max(m, s.n), -Infinity);
const unmarked = phases.filter((s) => !s.done && s.n < maxDoneN).length;

let archLines = null, archEol = planEol;
try {
  if (existsSync(archPath)) {
    const raw = readFileSync(archPath, 'utf8');
    archEol = raw.includes('\r\n') ? '\r\n' : '\n';
    archLines = raw.split(/\r?\n/);
  }
} catch (e) {
  console.error(`plan-archive: 读归档失败（${archPath}）：${e.message}`);
  process.exit(1);
}
// 判重与核对用同一把尺：小节的每一行都以整行相等出现在归档里，不用子串包含。
const secLines = (s) => lines.slice(s.start, s.end);
const archSet = new Set(archLines || []);
const already = [], needInsert = [];
for (const s of toMove) (secLines(s).every((l) => archSet.has(l)) ? already : needInsert).push(s);

function report() {
  const out = { command: 'plan-archive', ok: true, root, total: phases.length, completed: completed.length, completedBytes, moved: toMove.length, alreadyArchived: already.length, unmarked, unrecognized, nothingDue: toMove.length === 0 };
  if (check) out.check = true;
  return out;
}
function emit() {
  if (json) { console.log(JSON.stringify(report())); return; }
  console.log(`DEV-PLAN：Phase 共 ${phases.length} 个，已完成 ${completed.length} 个 / ${kb(completedBytes)}KB，保留线 ${RETAIN_COMPLETED} 个 / ${kb(CEILING_BYTES)}KB，搬出 ${toMove.length} 个（归档里已有 ${already.length} 个）`);
  if (unmarked > 0) console.log(`没标 ✅ 的 Phase：${unmarked} 个（编号在最后一个 ✅ 之前，脚本不搬）`);
  if (unrecognized > 0) console.log(`编号认不出的 Phase 标题：${unrecognized} 个（脚本不搬）`);
}

if (check || toMove.length === 0) { emit(); process.exit(0); }

// 指针行：标题原文 + 固定后缀；只取小节里 Task 条目行（围栏外）出现的 REQ 编号，去重、按出现顺序。
// 正文别处提到的编号多半是「本期不做」，带进指针行会被 plan-lint 算成已安排，归档后多出「范围外声明与 Task 矛盾」
// （OFR-ARIANE 副本实测多 3 条）；围栏里的编号 plan-lint 本来就不看，同样跳过。口径与 plan-lint.sh 的 TASK_ITEM_RE 一致。
const TASK_ITEM_RE = /^\s*-\s*\*\*Task\s+\d+\.\d+[:：]/;
function pointerLine(s) {
  const reqs = [];
  for (let i = s.start + 1; i < s.end; i++) {
    if (fenced.has(i) || !TASK_ITEM_RE.test(lines[i])) continue;
    for (const m of lines[i].matchAll(REQ_RE)) if (!reqs.includes(m[0])) reqs.push(m[0]);
  }
  return `- ${s.title} → ${ARCHIVE_NAME}${reqs.length ? `（REQ：${reqs.join(', ')}）` : ''}`;
}

try {
  // 步骤 1：要搬的小节原文按文档顺序追加到归档末尾（临时文件 + rename）；归档里已有的不重复追加。
  if (needInsert.length) {
    const base = archLines ? archLines.slice() : [ARCHIVE_TITLE, ''];
    if (archLines) {
      if (base.length && base[base.length - 1] === '') base.pop();          // 去掉收尾换行留下的空串
      if (base.length && base[base.length - 1].trim() !== '') base.push(''); // 与上一节之间空一行
    }
    for (const s of needInsert) base.push(...secLines(s));
    base.push('');
    try {
      if (process.env.PLAN_ARCHIVE_FAIL_AT === 'archive-write') throw new Error('测试注入 PLAN_ARCHIVE_FAIL_AT=archive-write');
      atomicWrite(archPath, base.join(archEol));
    } catch (e) { throw new Error(`写归档失败（${archPath}）：${e.message}`); }
  }

  // 步骤 2：从磁盘重读归档，要搬的每一行都整行找得到才往下走。
  let verifyRaw;
  try { verifyRaw = readFileSync(archPath, 'utf8'); }
  catch (e) { throw new Error(`归档核对失败：重读 ${archPath} 出错：${e.message}`); }
  const verifySet = new Set(verifyRaw.split(/\r?\n/));
  const injected = process.env.PLAN_ARCHIVE_FAIL_AT === 'verify';
  for (const s of toMove) {
    const missing = injected ? lines[s.start] : secLines(s).find((l) => !verifySet.has(l));
    if (missing !== undefined) throw new Error(`归档核对失败（${s.title.slice(0, 40)}）：有一行未在归档中找到 — ${missing.slice(0, 60)}`);
  }

  // 步骤 3：核对通过才改 DEV-PLAN.md：删掉这些小节，在「## 已归档 Phase」末尾逐个追加指针；
  // 这一节不存在就新建在留下的第一个 Phase 标题之前。
  const moveIdx = new Set();
  for (const s of toMove) for (let i = s.start; i < s.end; i++) moveIdx.add(i);
  const pointers = toMove.map(pointerLine);
  let insertAt, block;
  if (archived) {
    let last = archived.start;
    for (let i = archived.start + 1; i < archived.end; i++) if (lines[i].trim() !== '' && lines[i].trim() !== '---') last = i;
    insertAt = last + 1;
    block = last === archived.start ? ['', ...pointers] : pointers;
    if (insertAt === archived.end && archived.end < end) block = [...block, ''];  // 紧贴下一个标题时补一行空行
  } else {
    const firstKept = phases.find((s) => !moveIdx.has(s.start));
    insertAt = firstKept ? firstKept.start : end;
    block = [ARCHIVED_HEADING, '', ...pointers, '', ...(hasRule ? ['---', ''] : [])];
  }
  const out = [];
  for (let i = 0; i <= lines.length; i++) {
    if (i === insertAt) {
      if (!archived && out.length && out[out.length - 1] !== '') out.push('');
      out.push(...block);
    }
    if (i < lines.length && !moveIdx.has(i)) out.push(lines[i]);
  }
  try { atomicWrite(planPath, out.join(planEol)); }
  catch (e) { throw new Error(`写 DEV-PLAN.md 失败：${e.message}`); }
} catch (e) {
  console.error(`plan-archive: ${e.message}`);
  process.exit(1);
}

emit();
process.exit(0);
