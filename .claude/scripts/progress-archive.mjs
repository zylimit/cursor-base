#!/usr/bin/env node
// progress-archive.mjs —— 以前归档靠 progress-recorder（无 Bash）把上千字条目当参数逐字重敲，
// 2026-09-19 一天两次撞 25 轮上限：上午先删正文后写归档，丢了三条决策；下午改成先写后删，零丢失但只做完一半，
// 各花二十多万 token。机械原文搬迁交给这段脚本：先写归档、从磁盘重读核对、再删正文，失败时正文一个字节不动
// （TODO #75，用户 2026-09-19 拍板）。
// 用法：node .claude/scripts/progress-archive.mjs [--root <目录>] [--check] [--json]
//   --root   目标目录，默认 $CLAUDE_PROJECT_DIR，再默认当前目录
//   --check  只算不写，两份文件一个字节不动
//   --json   只输出机器可读 JSON（不带此参数输出人读文本，二者互斥）
// 退出码：0 = 没东西要搬，或写完且核对通过（含 --check）；1 = 读写/核对失败，progress.md 未改；2 = 参数错
// 环境变量 PROGRESS_ARCHIVE_FAIL_AT（只给测试用，其余取值或不设都无效果）：
//   archive-write  在写归档那一步模拟写失败；verify  归档已写完，在核对那一步模拟有一行没找到。
//   两种注入都走真失败时的 throw → exit(1) 那条路，progress.md 不会被动。误设的后果只是脚本什么都不改就退出。
// 2026-11-22 活文档契约（docs/living-docs-contract-2026-11.md 第 1 节）加四条，上面的契约一条不变：
//   P-1 认缩进写法：一行符合条目形状就是一条独立条目，不看缩进深浅、不看上一行（TODO 里已关闭条目下挂的更深未关闭条目
//       也是独立的，不跟着搬）。不符合形状的非空行紧跟条目、中间无空行且缩进比该条目更深是续行，否则它不属于任何条目、
//       不搬；空行结束本条。缩进按字符数比。搬时原文连缩进一个字符不改，归档侧（判重、核对、插入位置）同样认。
//   P-2 体积线：一段的体积 = 全部条目行（含续行）的 UTF-8 字节数、每行另加 1；TODO 只算已关闭的。先按条数线定留几条，
//       留下的体积仍超线就从其中最旧的一条起接着搬，到 ≤ 线或只剩地板为止；只因体积要搬的段同样判方向、同日整次拒绝。
//   --json 多一个 bytes：{ done: { before, after, ceiling }, … }，after 是搬完留下的体积（--check 时是预计值）。
//   P-3 最旧按日期认：先比日期、早的先搬；同日再比位置（最旧在上时靠前的算旧，最新在上时靠后的算旧），体积线接着搬也按这个序。
//       方向仍按首末两条判、同日整次拒绝；段内日期单调时与按位置切的结果一样。留下的与本批归档都按正文原有相对顺序。TODO 仍按编号。
//   P-4 机器指针只认含「累计搬出 N 条」的，被新指针替换、累计数接着算；其它 `（归档指针：` 开头的行是人手写的，原位一个字符不改，
//       机器指针另起一行写在段末。
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// ---- 阈值（全文只此一处；用户 2026-09-19 当面定） ----
const TRIGGER_DONE_NOTES = 100;   // Done + Notes 合计条数
const RETAIN_DONE = 35;
const RETAIN_NOTES = 35;
const TRIGGER_DECISIONS = 30;
const RETAIN_DECISIONS = 24;
const TRIGGER_TODO_CLOSED = 20;   // 已关闭（DONE / 完成）条数
const RETAIN_TODO_CLOSED = 10;    // 留编号最大的 N 条
// Pinned 封顶：progress-recorder SKILL 里写着 15 条却没有机器查，下游实数到过 51 条，多数是地址 / 端口 /
// docker 细节这类环境事实。这里只数、只报一行，不自动搬——哪条是硬约束、哪条该挪走得人判。
const PINNED_CAP = 15;
// 体积线（字节）与地板（条数），2026-11-22 活文档契约 P-2：OFR-ARIANE 的 progress.md 630KB，Done 81 条共 15 万字
// （平均一条 1850 字），条数线（Done + Notes 合计超 100）碰不到、一条不搬，recap 每次读的却是这 630KB。
// 地板拦住「超线就一直搬」：Decisions 15 条每条约 5KB 时搬到剩 12 条即停，不把现行决策搬空。
const CEILING = { done: 16384, notes: 16384, decisions: 32768, todo: 8192 };   // todo 只算已关闭的
const FLOOR = { done: 10, notes: 10, decisions: 12, todo: 5 };

// 条目形状允许前导缩进（P-1）：digifiber-conflation 608KB 的条目全是四空格（照 recorder 模板的排版缩进抄的），
// 旧正则只认第 0 列，--check 各段报「现有 0 条」——那个项目是在本地把这份脚本改了才搬得动，补丁没回流。第 1 组是缩进，日期 / 状态 / 编号在后面几组。
const DATE_RE = /^([ \t]*)- (\d{4}-\d{2}-\d{2})/;
const TODO_RE = /^([ \t]*)-\s\[P\d+\]\[([^\]]*)\]\[#([^\]]+)\]/;
const INDENT_RE = /^[ \t]*/;
const POINTER_PREFIX = '（归档指针：';
const LABEL = { done: 'Done', notes: 'Notes', decisions: 'Decisions', todo: 'TODO' };
const SRC_TABLE = [['Done', 'done'], ['Notes', 'notes'], ['Decisions', 'decisions'], ['TODO', 'todo']];
const ARCH_TABLE = [['Archived Done', 'done'], ['Archived Notes', 'notes'], ['Archived Decisions', 'decisions'], ['Archived TODO', 'todo']];
const PIN_TOP_RE = /^- /;          // 顶层写法
const PIN_INDENT_RE = /^ {4}- /;   // recorder 模板的四空格缩进写法
const RETAIN = { done: RETAIN_DONE, notes: RETAIN_NOTES, decisions: RETAIN_DECISIONS, todo: RETAIN_TODO_CLOSED };

function usageError(msg) {
  console.error(`progress-archive: ${msg}（用法：progress-archive.mjs [--root <dir>] [--check] [--json]）`);
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

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const entryReFor = (k) => (k === 'todo' ? TODO_RE : DATE_RE);

function kindOfTitle(title, table) {
  // 整个相等，或目标名后紧跟全角（/半角(，才算；"## TODO 归档说明" 这类不算，当无关区块。
  for (const [p, k] of table) {
    if (title === p || (title.startsWith(p) && (title[p.length] === '（' || title[p.length] === '('))) return k;
  }
  return null;
}
function findSections(lines, table) {
  const hdrs = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('## ')) hdrs.push(i);
  const res = {};
  hdrs.forEach((idx, hi) => {
    const kind = kindOfTitle(lines[idx].slice(3), table);
    if (!kind || res[kind]) return;
    res[kind] = { headerIdx: idx, bodyStart: idx + 1, bodyEnd: hi + 1 < hdrs.length ? hdrs[hi + 1] : lines.length };
  });
  return res;
}
// 认条目（P-1，2026-11-22 改写）：一行符合条目形状就是一条独立条目，不看缩进深浅，也不看上一行是什么。
// 最早的认法是「段内有顶格就只认顶格，一条没有才取最浅一档缩进」：OFR-ARIANE 的 Decisions 是 29 条顶格新决策在上，
// 空一行后 160 条四空格缩进的老决策（每条挂三行更深的「依据 / 适用范围 / 取代」），只认顶格时那 160 条既不算条目
// 也不算续行，永远搬不走，副本归档后这段仍有 148KB。中间一版又把「紧跟、更深、带日期」的行当上一条的子项：OFR 的
// Done 段一条顶格条目后面不隔空行跟着 120 条四空格老条目，全被吞成一条，一吞整段就永远搬不动、也不报待归档；往后
// 新条目一律顶格写，这种「顶格压在缩进块上」只会越来越多，而四个仓四个段里真正挂在某条下面的带日期子项一处都没有。
// TODO 同理：已关闭条目下面挂着一条更深的未关闭条目，那是独立条目，不跟着搬。
// 不符合形状的非空行：紧跟条目（中间不隔空行）且缩进比该条目更深是续行，否则本条到此为止、这行不属于任何条目、不搬
// （如段中间顶格的手写指针）；空行结束本条。缩进按前导空白字符数比，制表符算一个。e.bytes 是该条（含续行）的
// UTF-8 字节数、每行另加 1。
function parseEntries(lines, bodyStart, bodyEnd, re) {
  const out = []; let cur = null;
  for (let i = bodyStart; i < bodyEnd; i++) {
    const line = lines[i];
    if (line.trim() === '') { cur = null; continue; }
    const m = line.match(re);
    if (m) { cur = { startIdx: i, endIdx: i + 1, m, depth: m[1].length }; out.push(cur); }
    else if (cur !== null && line.match(INDENT_RE)[0].length > cur.depth) cur.endIdx = i + 1;   // 续行跟上一条
    else cur = null;
  }
  for (const e of out) { e.bytes = 0; for (let i = e.startIdx; i < e.endIdx; i++) e.bytes += Buffer.byteLength(lines[i], 'utf8') + 1; }
  return out;
}
const entryLines = (lines, e) => lines.slice(e.startIdx, e.endIdx);
// 判重（已在归档）与核对（写完后真的在）用同一把尺：条目每一行都以整行相等出现在归档对应段里，
// 不用子串包含——条目首行恰好是归档里某一行的前缀时，子串判法与整行核对会打架。
const sectionLineSet = (lines, section) => (section ? new Set(lines.slice(section.bodyStart, section.bodyEnd)) : new Set());
const entryAlreadyArchived = (lineSet, entryLineArr) => entryLineArr.every((l) => lineSet.has(l));
// 机器指针只认含「累计搬出 N 条」的（P-4，本脚本 2026-09-20 起写的指针都带这四个字）。OFR-ARIANE 的 Decisions 段中间
// 有一行 2026-11-04 手工搬时留下的指针，写着「其中仍在生效的四条：…」，别处没有；此前见 `（归档指针：` 开头就整行替换，
// 一搬这句话就在两份文件里都找不到了。手写的不认、不删，留在 body 里原位，新机器指针照旧接在段末最后一个非空行之后。
const MACHINE_PTR_RE = /累计搬出\s*(\d+)\s*条/;
function findPointer(lines, bodyStart, bodyEnd) {
  for (let i = bodyStart; i < bodyEnd; i++) if (lines[i].startsWith(POINTER_PREFIX) && MACHINE_PTR_RE.test(lines[i])) return i;
  return -1;
}
function parsePointerCounts(line) {
  const c = line && line.match(MACHINE_PTR_RE);
  const m = line && line.match(/已归档最大编号\s*#(\d+)/);
  return { cum: c ? parseInt(c[1], 10) : 0, maxId: m ? parseInt(m[1], 10) : 0 };
}
function parseTodoMeta(m) {   // m 是 TODO_RE 的匹配结果：1 缩进 / 2 状态 / 3 编号
  const idm = m[3].match(/^(\d+)(.*)$/);
  return { status: m[2], idInt: idm ? parseInt(idm[1], 10) : 0, idSuffix: idm ? idm[2] : '' };
}
function updateLastUpdated(lines) {
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (/^_Last updated:\s*\d{4}-\d{2}-\d{2}_\s*$/.test(lines[i])) { lines[i] = `_Last updated: ${today()}_`; return; }
  }
}
function atomicWrite(path, text) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text);
  try { renameSync(tmp, path); } catch (e) { try { unlinkSync(tmp); } catch { /* 尽力清理，失败不影响原错误 */ } throw e; }
}

const progPath = join(root, 'progress.md');
const archPath = join(root, 'progress.archive.md');

if (!existsSync(progPath)) {
  const out = { command: 'progress-archive', ok: true, root, moved: { done: 0, notes: 0, decisions: 0, todo: 0 }, alreadyArchived: { done: 0, notes: 0, decisions: 0, todo: 0 }, nothingDue: true, maxArchivedTodoId: 0 };
  out.bytes = Object.fromEntries(Object.entries(CEILING).map(([k, c]) => [k, { before: 0, after: 0, ceiling: c }]));
  if (json) console.log(JSON.stringify(out)); else console.log(`无 progress.md（${progPath}），不处理。`);
  process.exit(0);
}

const progRaw = readFileSync(progPath, 'utf8');
const progEol = progRaw.includes('\r\n') ? '\r\n' : '\n';
const progLines = progRaw.split(/\r?\n/);

// Pinned 条目数：文件里有顶层 `- ` 就只数顶层（这时四空格那几行是它们的子项，不该另算一条）；
// 一条顶层都没有才数四空格缩进写法。两种写法都认，但不在同一份文件里叠加计数。
function countPinned(lines) {
  const s = findSections(lines, [['Pinned', 'pinned']]).pinned;
  if (!s) return 0;
  const body = lines.slice(s.bodyStart, s.bodyEnd);
  const top = body.filter((l) => PIN_TOP_RE.test(l)).length;
  return top > 0 ? top : body.filter((l) => PIN_INDENT_RE.test(l)).length;
}
const pinnedCount = countPinned(progLines);
const pinnedOver = pinnedCount > PINNED_CAP;
if (pinnedOver) {
  const warn = `progress-archive: Pinned ${pinnedCount} 条超封顶 ${PINNED_CAP}——环境事实（地址 / 端口 / 路径 / 基准数据）挪 Context Index，弱约束降 Decision；本脚本不自动搬`;
  // --json 的 stdout 只许一份 JSON（契约），告警行改走 stderr，JSON 里另带 pinned 字段；人读模式照报在 stdout。
  if (json) console.error(warn); else console.log(warn);
}
const srcSections = findSections(progLines, SRC_TABLE);
const entriesOf = (kind) => { const s = srcSections[kind]; return s ? parseEntries(progLines, s.bodyStart, s.bodyEnd, entryReFor(kind)) : []; };

const doneEntries = entriesOf('done');
const notesEntries = entriesOf('notes');
const decisionsEntries = entriesOf('decisions');
const todoAll = entriesOf('todo').map((e) => Object.assign(e, parseTodoMeta(e.m)));
const closedTodo = todoAll.filter((e) => e.status === 'DONE' || e.status === '完成');

const sumBytes = (arr) => arr.reduce((s, e) => s + e.bytes, 0);
// 体积线（P-2）：从条数线定下的保留数 keep 起步，newestFirst 前 keep 条的体积超线，就把其中最旧的一条也搬走，
// 到 ≤ 线或 keep 等于地板为止。条数线没过时 keep 起步就是全部条目。
function shrinkKeep(kind, newestFirst, keep) {
  let bytes = sumBytes(newestFirst.slice(0, keep));
  while (keep > FLOOR[kind] && bytes > CEILING[kind]) bytes -= newestFirst[--keep].bytes;
  return keep;
}

// 方向：搬走的永远是最旧的、留下的永远是最新的 N 条。progress-recorder 模板写「Decisions（按时间顺序追加）」
// 「Done（最近完成的放前面）」，两种写法下游都真有——lutetia 2026-11-07 实测 Decisions / Notes 最旧在上，
// 一律留前 N 条把 15 条现行决策搬进了归档。所以每段按首条与末条日期各判各的；首末同日判断不出就不猜，
// 记下段名，后面在任何写盘之前整次拒绝。只判会搬的段（条数线或体积线任一要搬）：没过线的段（下游 Notes 常只有一条）不判。
// 会不会搬与方向无关（条数线看条数，体积线先看全段），所以先判要不要搬、再判方向。
const undecidable = [];
function planDated(kind, entries, countOver) {
  const keep0 = countOver ? Math.min(RETAIN[kind], entries.length) : entries.length;
  const volOver = sumBytes(entries) > CEILING[kind] && entries.length > FLOOR[kind];
  if (keep0 === entries.length && !volOver) return [];
  const first = entries[0].m[2], last = entries[entries.length - 1].m[2];
  if (first === last) { undecidable.push(LABEL[kind]); return []; }
  // 「最旧」按日期实判（P-3），方向只用来给同日条目排先后。此前按方向整段正序 / 倒序后按位置切，段内日期不单调就切错：
  // digifiber-conflation 的 Decisions 首条 11-02、末条 11-17，中间夹着 11-19、11-20，按位置切走前 66 条会把 11-20 那条现行
  // 决策搬进归档、把更早的留在正文；OFR-ARIANE 搬走的 18 条全是 11-18，留下的里面倒有 9 条 11-17（2026-11-22 副本实测）。
  // 同日：最新在上（首条更新）时靠前的算新，最旧在上时靠后的算新。日期单调时排出来与旧的正序 / 倒序一模一样。
  const newestOnTop = first > last;
  const pos = new Map(entries.map((e, i) => [e, i]));
  const newestFirst = [...entries].sort((a, b) => (a.m[2] !== b.m[2] ? (a.m[2] < b.m[2] ? 1 : -1)
    : newestOnTop ? pos.get(a) - pos.get(b) : pos.get(b) - pos.get(a)));
  const keep = new Set(newestFirst.slice(0, shrinkKeep(kind, newestFirst, keep0)));
  return entries.filter((e) => !keep.has(e));   // 按文件原序，归档里本批的相对顺序与正文一致
}
const doneNotesOver = doneEntries.length + notesEntries.length > TRIGGER_DONE_NOTES;
const doneToArchive = planDated('done', doneEntries, doneNotesOver);
const notesToArchive = planDated('notes', notesEntries, doneNotesOver);
const decisionsToArchive = planDated('decisions', decisionsEntries, decisionsEntries.length > TRIGGER_DECISIONS);
// 判断不出方向时不做「能搬的先搬」：部分搬迁后人更难看清哪段动过，两份文件一个字节不动、--check 同样拒绝。
if (undecidable.length) {
  console.error(`progress-archive: ${undecidable.join(' / ')} 首条与末条同日，判断不出排列方向（最旧在上还是最新在上），不搬；请人工核对该段顺序后重跑`);
  process.exit(1);
}
// 已关闭 TODO 的「最旧」是编号最小：按编号从大到小排，留前 keep 条（字母后缀按前导整数排、同号再比后缀）。
const todoNewestFirst = [...closedTodo].sort((a, b) => b.idInt - a.idInt || (a.idSuffix < b.idSuffix ? 1 : a.idSuffix > b.idSuffix ? -1 : 0));
const todoKeep0 = closedTodo.length > TRIGGER_TODO_CLOSED ? RETAIN_TODO_CLOSED : closedTodo.length;
const todoKeep = new Set(todoNewestFirst.slice(0, shrinkKeep('todo', todoNewestFirst, todoKeep0)));
const todoToArchive = closedTodo.filter((e) => !todoKeep.has(e));

const groups = [
  { kind: 'done', entries: doneEntries, toArchive: doneToArchive },
  { kind: 'notes', entries: notesEntries, toArchive: notesToArchive },
  { kind: 'decisions', entries: decisionsEntries, toArchive: decisionsToArchive },
  { kind: 'todo', entries: closedTodo, toArchive: todoToArchive },
];
const movedTotal = groups.reduce((s, g) => s + g.toArchive.length, 0);
for (const g of groups) { g.before = sumBytes(g.entries); g.after = g.before - sumBytes(g.toArchive); }
const kb = (b) => (b / 1024).toFixed(1);

let archLines, archEol;
try {
  if (existsSync(archPath)) {
    const raw = readFileSync(archPath, 'utf8');
    archEol = raw.includes('\r\n') ? '\r\n' : '\n';
    archLines = raw.split(/\r?\n/);
  } else {
    archEol = '\n';
    archLines = ['# progress 归档', `_Last updated: ${today()}_`, ''];
  }
} catch (e) {
  console.error(`progress-archive: 读归档失败（${archPath}）：${e.message}`);
  process.exit(1);
}
const archSectionsInit = findSections(archLines, ARCH_TABLE);
for (const g of groups) {
  const lineSet = sectionLineSet(archLines, archSectionsInit[g.kind]);
  g.already = []; g.needInsert = [];
  for (const e of g.toArchive) {
    (entryAlreadyArchived(lineSet, entryLines(progLines, e)) ? g.already : g.needInsert).push(e);
  }
}

const todoPtrIdx = srcSections.todo ? findPointer(progLines, srcSections.todo.bodyStart, srcSections.todo.bodyEnd) : -1;
const todoPtrCounts = parsePointerCounts(todoPtrIdx >= 0 ? progLines[todoPtrIdx] : null);
const maxArchivedTodoId = Math.max(todoPtrCounts.maxId, 0, ...todoToArchive.map((e) => e.idInt));

function report() {
  const out = { command: 'progress-archive', ok: true, root, moved: {}, alreadyArchived: {}, nothingDue: movedTotal === 0, maxArchivedTodoId };
  out.bytes = {};
  for (const g of groups) {
    out.moved[g.kind] = g.toArchive.length; out.alreadyArchived[g.kind] = g.already.length;
    out.bytes[g.kind] = { before: g.before, after: g.after, ceiling: CEILING[g.kind] };
  }
  if (check) out.check = true;
  out.pinned = { count: pinnedCount, cap: PINNED_CAP, overCap: pinnedOver };
  return out;
}
function printHuman() {
  console.log(`root: ${root}`);
  for (const g of groups) {
    console.log(`${LABEL[g.kind]}${g.kind === 'todo' ? '（已关闭）' : ''}：现有 ${g.entries.length} 条 / ${kb(g.before)}KB，保留线 ${RETAIN[g.kind]} 条 / ${kb(CEILING[g.kind])}KB，搬出 ${g.toArchive.length} 条（归档里已有 ${g.already.length} 条）`);
  }
  console.log(movedTotal === 0 ? '没有条目需要搬迁。' : `共 ${movedTotal} 条${check ? '待搬（--check，未写）' : '已搬迁'}。`);
}
function emit() { if (json) console.log(JSON.stringify(report())); else printHuman(); }

if (check || movedTotal === 0) { emit(); process.exit(0); }

try {
  // 步骤 1：候选已在上面算出。步骤 2：写归档（临时文件 + rename）。
  let newArch = archLines.slice();
  updateLastUpdated(newArch);
  const archSections = findSections(newArch, ARCH_TABLE);
  const existingKinds = groups.filter((g) => g.needInsert.length && archSections[g.kind])
    .sort((a, b) => archSections[b.kind].headerIdx - archSections[a.kind].headerIdx);
  for (const g of existingKinds) {
    const s = archSections[g.kind];
    // 本批插在该段第一条条目之前；归档里的缩进写法条目同样认（P-1），段里一条条目都没有就接在段尾。
    const firstEntry = parseEntries(newArch, s.bodyStart, s.bodyEnd, entryReFor(g.kind))[0];
    newArch.splice(firstEntry ? firstEntry.startIdx : s.bodyEnd, 0, ...g.needInsert.flatMap((e) => entryLines(progLines, e)));
  }
  for (const g of groups.filter((g) => g.needInsert.length && !archSections[g.kind])) {
    // newArch 末尾本就是原文件收尾换行留下的空字符串，直接接标题即产生一行空行分隔；
    // 不是空字符串（如上一个新建区块刚写完正文）才需要显式补一行。
    if (newArch[newArch.length - 1] !== '') newArch.push('');
    newArch.push(`## Archived ${LABEL[g.kind]}`, ...g.needInsert.flatMap((e) => entryLines(progLines, e)));
  }
  try {
    if (process.env.PROGRESS_ARCHIVE_FAIL_AT === 'archive-write') throw new Error('测试注入 PROGRESS_ARCHIVE_FAIL_AT=archive-write');
    atomicWrite(archPath, newArch.join(archEol));
  } catch (e) { throw new Error(`写归档失败（${archPath}）：${e.message}`); }

  // 步骤 3：重新从磁盘读归档，逐行核对要搬的每一行都在归档的对应段里（同上一把尺）。
  let verifyRaw;
  try { verifyRaw = readFileSync(archPath, 'utf8'); }
  catch (e) { throw new Error(`归档核对失败：重读 ${archPath} 出错：${e.message}`); }
  const verifyLines = verifyRaw.split(/\r?\n/);
  const verifySections = findSections(verifyLines, ARCH_TABLE);
  for (const g of groups) {
    const lineSet = sectionLineSet(verifyLines, verifySections[g.kind]);
    for (const e of g.toArchive) {
      const eLines = entryLines(progLines, e);
      const injected = process.env.PROGRESS_ARCHIVE_FAIL_AT === 'verify';
      if (injected || !entryAlreadyArchived(lineSet, eLines)) {
        const missing = injected ? eLines[0] : eLines.find((l) => !lineSet.has(l));
        throw new Error(`归档核对失败（${LABEL[g.kind]}）：有一行未在归档中找到 — ${missing.slice(0, 60)}`);
      }
    }
  }

  // 步骤 4：核对通过，写精简后的 progress.md（临时文件 + rename）。
  let newProg = progLines.slice();
  updateLastUpdated(newProg);
  const order = groups.filter((g) => g.toArchive.length).sort((a, b) => srcSections[b.kind].bodyStart - srcSections[a.kind].bodyStart);
  for (const g of order) {
    const s = srcSections[g.kind];
    const removeSet = new Set();
    for (const e of g.toArchive) for (let i = e.startIdx; i < e.endIdx; i++) removeSet.add(i);
    const ptrIdx = findPointer(newProg, s.bodyStart, s.bodyEnd);
    if (ptrIdx >= 0) removeSet.add(ptrIdx);
    const oldCum = parsePointerCounts(ptrIdx >= 0 ? newProg[ptrIdx] : null).cum;
    const body = newProg.slice(s.bodyStart, s.bodyEnd).filter((_, rel) => !removeSet.has(rel + s.bodyStart));
    let lastNonBlank = -1;
    body.forEach((l, i) => { if (l.trim() !== '') lastNonBlank = i; });
    const tail = g.kind === 'todo'
      ? `原文见 progress.archive.md「Archived TODO」，已归档最大编号 #${maxArchivedTodoId}）`
      : `原文见 progress.archive.md「Archived ${LABEL[g.kind]}」）`;
    body.splice(lastNonBlank + 1, 0, `${POINTER_PREFIX}累计搬出 ${oldCum + g.toArchive.length} 条，最近一次 ${today()} 搬 ${g.toArchive.length} 条；${tail}`);
    newProg.splice(s.bodyStart, s.bodyEnd - s.bodyStart, ...body);
  }
  try { atomicWrite(progPath, newProg.join(progEol)); }
  catch (e) { throw new Error(`写 progress.md 失败：${e.message}`); }
} catch (e) {
  console.error(`progress-archive: ${e.message}`);
  process.exit(1);
}

emit();
process.exit(0);
