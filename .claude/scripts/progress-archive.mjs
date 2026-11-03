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

const DATE_RE = /^- \d{4}-\d{2}-\d{2}/;
const TODO_RE = /^-\s\[P\d+\]\[([^\]]*)\]\[#([^\]]+)\]/;
const CONT_RE = /^[ \t]/;
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
function parseEntries(lines, bodyStart, bodyEnd, re) {
  const out = []; let cur = null;
  for (let i = bodyStart; i < bodyEnd; i++) {
    const line = lines[i];
    if (re.test(line)) { cur = { startIdx: i, endIdx: i + 1 }; out.push(cur); }
    else if (cur && CONT_RE.test(line) && line.trim() !== '') cur.endIdx = i + 1;
    else cur = null;
  }
  return out;
}
const entryLines = (lines, e) => lines.slice(e.startIdx, e.endIdx);
// 判重（已在归档）与核对（写完后真的在）用同一把尺：条目每一行都以整行相等出现在归档对应段里，
// 不用子串包含——条目首行恰好是归档里某一行的前缀时，子串判法与整行核对会打架。
const sectionLineSet = (lines, section) => (section ? new Set(lines.slice(section.bodyStart, section.bodyEnd)) : new Set());
const entryAlreadyArchived = (lineSet, entryLineArr) => entryLineArr.every((l) => lineSet.has(l));
function findPointer(lines, bodyStart, bodyEnd) {
  for (let i = bodyStart; i < bodyEnd; i++) if (lines[i].startsWith(POINTER_PREFIX)) return i;
  return -1;
}
function parsePointerCounts(line) {
  const c = line && line.match(/累计搬出\s*(\d+)\s*条/);
  const m = line && line.match(/已归档最大编号\s*#(\d+)/);
  return { cum: c ? parseInt(c[1], 10) : 0, maxId: m ? parseInt(m[1], 10) : 0 };
}
function parseTodoMeta(line) {
  const m = line.match(TODO_RE);
  const idm = m[2].match(/^(\d+)(.*)$/);
  return { status: m[1], idInt: idm ? parseInt(idm[1], 10) : 0, idSuffix: idm ? idm[2] : '' };
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
const entriesOf = (kind, re) => { const s = srcSections[kind]; return s ? parseEntries(progLines, s.bodyStart, s.bodyEnd, re) : []; };

const doneEntries = entriesOf('done', DATE_RE);
const notesEntries = entriesOf('notes', DATE_RE);
const decisionsEntries = entriesOf('decisions', DATE_RE);
const todoAll = entriesOf('todo', TODO_RE).map((e) => Object.assign(e, parseTodoMeta(progLines[e.startIdx])));
const closedTodo = todoAll.filter((e) => e.status === 'DONE' || e.status === '完成');

let doneToArchive = [], notesToArchive = [];
if (doneEntries.length + notesEntries.length > TRIGGER_DONE_NOTES) {
  if (doneEntries.length > RETAIN_DONE) doneToArchive = doneEntries.slice(RETAIN_DONE);
  if (notesEntries.length > RETAIN_NOTES) notesToArchive = notesEntries.slice(RETAIN_NOTES);
}
let decisionsToArchive = [];
if (decisionsEntries.length > TRIGGER_DECISIONS) decisionsToArchive = decisionsEntries.slice(RETAIN_DECISIONS);
let todoToArchive = [];
if (closedTodo.length > TRIGGER_TODO_CLOSED) {
  const sorted = [...closedTodo].sort((a, b) => b.idInt - a.idInt || (a.idSuffix < b.idSuffix ? 1 : a.idSuffix > b.idSuffix ? -1 : 0));
  const keep = new Set(sorted.slice(0, RETAIN_TODO_CLOSED).map((e) => e.startIdx));
  todoToArchive = closedTodo.filter((e) => !keep.has(e.startIdx));
}

const groups = [
  { kind: 'done', entries: doneEntries, toArchive: doneToArchive },
  { kind: 'notes', entries: notesEntries, toArchive: notesToArchive },
  { kind: 'decisions', entries: decisionsEntries, toArchive: decisionsToArchive },
  { kind: 'todo', entries: closedTodo, toArchive: todoToArchive },
];
const movedTotal = groups.reduce((s, g) => s + g.toArchive.length, 0);

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
  for (const g of groups) { out.moved[g.kind] = g.toArchive.length; out.alreadyArchived[g.kind] = g.already.length; }
  if (check) out.check = true;
  out.pinned = { count: pinnedCount, cap: PINNED_CAP, overCap: pinnedOver };
  return out;
}
function printHuman() {
  console.log(`root: ${root}`);
  for (const g of groups) {
    console.log(`${LABEL[g.kind]}${g.kind === 'todo' ? '（已关闭）' : ''}：现有 ${g.entries.length} 条，保留线 ${RETAIN[g.kind]}，搬出 ${g.toArchive.length} 条（归档里已有 ${g.already.length} 条）`);
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
    let insertAt = s.bodyEnd;
    for (let i = s.bodyStart; i < s.bodyEnd; i++) if (entryReFor(g.kind).test(newArch[i])) { insertAt = i; break; }
    newArch.splice(insertAt, 0, ...g.needInsert.flatMap((e) => entryLines(progLines, e)));
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
