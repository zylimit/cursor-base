// notes.mjs —— docs/readable-src/ 的读者（架构稿 §2 notes、§3「数据所有权」）：项目配置 config.json 与项目判断 map.json。
// 这两份是人和 AI 直接编辑的，生成器只读、只校验，一个字节不写。
// 两种「不对」分开处理（契约 A 节、F 节）：配置错、map.json 不是合法 JSON，是用法错，抛 ConfigError 由入口报退出码 2；
// map.json 的内容对不上（点到不存在的表或文件、一张表进了两个组、status 写错）不拦生成，逐条记进 mapProblems——
// 拦了，读者连页面都拿不到；不记，读者会把一条点错的判断当真。
// 说明（notes/，契约 G 节，2026-11-23 Task 1.4）：每段说明绑它所依据的那段来源的切片，指纹只由命令按当时的切片盖——
// 写说明的是 AI，指纹若能由交进来的内容自带，过期的说明照抄一个新指纹就冒充现行了（架构稿 ADR-2）。
// 切片的内容变了说明才算过期；绑整张表，加个索引全表的说明都标「待更新」，读者很快就学会无视它。侧车的读写在 notes-store.mjs。
// 第三期（2026-11-23 Task 3.3）：modules / layers 在 arch-map.mjs 校验，模块的切片在 notes-arch.mjs；配置的读取搬到 config.mjs，这里照旧转出。
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, cmp, docAnchor, fingerprint, groupAnchor, tableAnchor } from './model.mjs';
import { ConfigError, MARKER_RE, anchorKind, fileFor, loadNotes, normalizeText, saveNotes } from './notes-store.mjs';
import { redact, sensitiveKinds } from './sensitive.mjs';
import { readJson } from './config.mjs';
import { readArchMap } from './arch-map.mjs';
import { archAnchors, pendingArch } from './notes-arch.mjs';

export { ConfigError };
export { CONFIG, loadConfig } from './config.mjs';
export const MAP = 'docs/readable-src/map.json';
export const STATUSES = ['proposed', 'confirmed']; // AI 提议 / 人已确认；confirmed 只由人改
export const UNGROUPED_ID = '_ungrouped';
export const DB_DOC = 'db'; // 第一期只有数据库设计这一份文档，锚点 doc:db
export const CONTEXT_BUDGET = 4096; // pending --json 每张表的上下文控制在 4KB 左右（契约 G 节），超了先截读它的文件
export const TOP_FILES = 5; // 上下文里写它、读它的文件各给引用处最多的这么几个

const bad = (msg) => { throw new ConfigError(msg); };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => typeof v === 'string' && v !== '';

// 项目判断（契约 F 节）。tables 是建表定义里有的表名；点名不分大小写，落到建表定义里的写法上。
// 返回校验过的一份：tableGroups 为 null 表示没有分组判断（照前缀分），每组只剩存在的、先出现的表；
// dynamicTables 只剩文件存在的条目与存在的表。对不上的每一条进 problems：{where, problem}，按在文件里出现的先后。
// arch 是 modules 与 layers 的校验结果（arch-map.mjs）：它对不上的另进 arch.problems，上架构那一份，不进数据库设计的清单。
export function loadMap(root, tables) {
  const out = { tableGroups: null, dynamicTables: [], problems: [], arch: { modules: null, layers: [], problems: [] } };
  if (!existsSync(join(root, MAP))) return out;
  const m = readJson(root, MAP, '项目判断');
  if (!isObj(m)) bad(`项目判断的顶层该是对象：${MAP}`);
  if (m.version !== 1) bad(`项目判断的 version 只认 1，现在是 ${JSON.stringify(m.version)}：${MAP}`);
  out.arch = readArchMap(m, STATUSES);
  const known = new Map(tables.map((n) => [n.toLowerCase(), n]));
  const problem = (where, text) => out.problems.push({ where, problem: text });
  const status = (where, v) => {
    if (STATUSES.includes(v)) return v;
    problem(`${where}.status`, `status 是 ${JSON.stringify(v ?? null)}，只认 proposed 或 confirmed；按 proposed（AI 提议）算`);
    return 'proposed';
  };
  const names = (where, v, kind) => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) { problem(where, `${kind}该是表名的数组，整项没用`); return []; }
    const got = [];
    v.forEach((n, i) => {
      const t = typeof n === 'string' ? known.get(n.toLowerCase()) : undefined;
      if (!t) problem(`${where}[${i}]`, `点到的表 ${JSON.stringify(n)} 在建表定义里不存在`);
      else if (got.includes(t)) problem(`${where}[${i}]`, `表 ${t} 在这一项里列了两次`);
      else got.push(t);
    });
    return got;
  };

  // 空数组与没写同样处理：还没分组的判断不该把所有表都扔进「未分组」，照前缀分更有用。
  if (m.tableGroups !== undefined && !Array.isArray(m.tableGroups)) problem('tableGroups', 'tableGroups 该是数组，整段没用，照表名前缀分组');
  else if (m.tableGroups?.length) {
    const ids = new Set(), owner = new Map();
    out.tableGroups = [];
    m.tableGroups.forEach((g, i) => {
      const w = `tableGroups[${i}]`;
      if (!isObj(g)) return problem(w, '该是对象，这一组没用');
      if (!str(g.id)) return problem(`${w}.id`, '组没写 id，这一组没用');
      if (g.id === UNGROUPED_ID) return problem(`${w}.id`, `id ${UNGROUPED_ID} 留给「未分组」，这一组没用`);
      if (ids.has(g.id)) return problem(`${w}.id`, `组 id ${g.id} 重复，按先出现的那组算，这一组没用`);
      ids.add(g.id);
      if (!str(g.title)) problem(`${w}.title`, `组 ${g.id} 没写标题，用 id 当标题`);
      const st = status(w, g.status), mine = [];
      for (const t of names(`${w}.tables`, g.tables, 'tables ')) {
        if (owner.has(t)) problem(`${w}.tables`, `表 ${t} 已在组 ${owner.get(t)} 里，按先出现的算，这里不再收`);
        else { owner.set(t, g.id); mine.push(t); }
      }
      out.tableGroups.push({ id: g.id, title: str(g.title) ? g.title : g.id, status: st, tables: mine });
    });
  }

  if (m.dynamicTables !== undefined && !Array.isArray(m.dynamicTables)) problem('dynamicTables', 'dynamicTables 该是数组，整段没用');
  else (m.dynamicTables ?? []).forEach((d, i) => {
    const w = `dynamicTables[${i}]`;
    if (!isObj(d)) return problem(w, '该是对象，这一项没用');
    const file = str(d.file) ? d.file.replace(/\\/g, '/') : null;
    if (!file) return problem(`${w}.file`, '没写 file，这一项没用');
    if (!existsSync(join(root, file)) || !statSync(join(root, file)).isFile()) return problem(`${w}.file`, `点到的文件 ${file} 不存在，这一项没用`);
    const st = status(w, d.status);
    out.dynamicTables.push({ file, reads: names(`${w}.reads`, d.reads, 'reads '), writes: names(`${w}.writes`, d.writes, 'writes '), status: st });
  });
  return out;
}

// ———— 说明绑定的来源切片（契约 G 节）————

// 外键：列上的 REFERENCES 与表级 FOREIGN KEY 一样看待，只取「哪几列指向哪张表的哪几列」；约束名、ON DELETE 不进表的切片。
const foreignKeys = (t) => [
  ...t.columns.filter((c) => c.references).map((c) => ({ columns: [c.name], table: c.references.table, refColumns: c.references.column == null ? [] : [c.references.column] })),
  ...t.constraints.filter((k) => k.type === 'foreign key').map((k) => ({ columns: k.columns ?? [], table: k.references?.table ?? null, refColumns: k.references?.columns ?? [] })),
];
// 按规范形去重、定序：同一条外键改成表级写法、几条约束换个先后，切片不变。
const uniqSorted = (list) => [...new Map(list.map((x) => [canonical(x), x]))].sort((a, b) => cmp(a[0], b[0])).map(([, x]) => x);

// 表：表名、来源里的表注释、各列的名字与类型（按序）、主键与外键。加索引、改默认值不让表的说明过期。
const tableSlice = (t) => ({
  name: t.name, comment: t.comment, columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
  primaryKey: t.columns.filter((c) => c.primaryKey).map((c) => c.name), foreignKeys: uniqSorted(foreignKeys(t)),
});
// 列：这一列的定义全文（类型、可空、默认、键、引用、CHECK）与来源里的注释；写在表级、管着这一列的约束
// （FOREIGN KEY (a) REFERENCES …、UNIQUE (a, b)）也是它的键与引用，只取类型、列、引用、CHECK，约束名与原文的写法不进。
const columnSlice = (t, c) => ({
  name: c.name, type: c.type, nullable: c.nullable, default: c.default, primaryKey: c.primaryKey, unique: c.unique,
  references: c.references, check: c.check, comment: c.comment,
  tableKeys: uniqSorted(t.constraints.filter((k) => (k.columns ?? []).includes(c.name))
    .map((k) => ({ type: k.type, columns: k.columns, references: k.references, check: k.check }))),
});
// 组：标题与成员表名（排序后）。doc:db：各组的 id、标题与成员表名（按 id 排序）；加表、删表、表挪组，导读都要重看。
const groupSlice = (g) => ({ title: g.title, tables: [...g.tables].sort(cmp) });
const docSlice = (groups) => ({ groups: groups.map((g) => ({ id: g.id, ...groupSlice(g) })).sort((a, b) => cmp(a.id, b.id)) });

// 现行文档模型里能挂说明的每个锚点 → {fp：当前切片的指纹, file：它的说明落在哪个侧车文件}。
export function anchorIndex(model) {
  const idx = new Map();
  for (const t of model.tables) {
    idx.set(t.anchor, { fp: fingerprint(tableSlice(t)), file: fileFor('table', t.name) });
    for (const c of t.columns) idx.set(c.anchor, { fp: fingerprint(columnSlice(t, c)), file: fileFor('column', t.name) });
  }
  for (const g of model.groups) idx.set(groupAnchor(g.id), { fp: fingerprint(groupSlice(g)), file: fileFor('group', g.id) });
  idx.set(docAnchor(DB_DOC), { fp: fingerprint(docSlice(model.groups)), file: fileFor('doc', DB_DOC) });
  archAnchors(model.arch, idx); // module:<id> 与 doc:arch（第三期契约 C 节），切片在 notes-arch.mjs
  return idx;
}

const stateOf = (e, idx) => (idx.get(e.anchor)?.fp === e.fp ? 'current' : 'stale');

// build 并进模型的两样（契约 G 节）：notes 只含锚点现存的说明，按锚点排序；锚点已经不存在的进 orphanNotes，不上任何页面。
export function bindNotes(root, model) {
  const idx = anchorIndex(model), stored = loadNotes(root), notes = {}, orphanNotes = [];
  for (const a of [...stored.keys()].sort(cmp)) {
    const e = stored.get(a);
    if (!idx.has(a)) orphanNotes.push({ anchor: a, text: e.text });
    else notes[a] = { text: e.text, status: e.status, by: e.by, on: e.on, state: stateOf(e, idx) };
  }
  return { notes, orphanNotes };
}

// ———— note put / confirm / drop（契约 G 节「命令」）————

const KINDS = ['table', 'column', 'group', 'doc', 'module'];
function anchorProblem(anchor, idx) {
  if (!anchor) return '「## 」后面没写锚点';
  if (!KINDS.includes(anchorKind(anchor))) return `认不出锚点「${anchor}」：第一期只认 table:<表>、column:<表>.<列>、group:<组 id>、doc:db，第三期加 module:<模块 id>、doc:arch`;
  const near = [...idx.keys()].find((k) => k.toLowerCase() === anchor.toLowerCase());
  return `锚点 ${anchor} 在现行的文档模型里不存在${near ? `（大小写不同的有 ${near}）` : ''}`;
}

// 输入是若干段「## <锚点>」一行加正文。逐段校验，全部通过才落盘、按当时的切片盖指纹、状态记 draft；
// 有一段不过，整批不落盘，返回每段不过的原因。重新 put 的说明回到 draft：抽审看的是上一版正文。
export function putNotes(root, model, input) {
  const idx = anchorIndex(model), lines = input.replace(/\r\n?/g, '\n').split('\n'), segs = [], pre = [], problems = [];
  lines.forEach((l, i) => {
    const h = /^## (.*)$/.exec(l);
    if (h) segs.push({ anchor: h[1].trim(), line: i + 1, body: [] });
    else (segs.length ? segs[segs.length - 1].body : pre).push(l);
  });
  if (pre.join('').trim()) problems.push({ where: '第一段之前', reasons: ['有不属于任何锚点的文字：每段要以「## <锚点>」一行开头'] });
  if (!segs.length) problems.push({ where: '整份输入', reasons: ['一段都没有：每段以「## <锚点>」一行开头，下面是正文'] });
  const seen = new Map();
  segs.forEach((s, i) => {
    const raw = s.body.join('\n'), reasons = [];
    s.text = normalizeText(raw);
    if (!idx.has(s.anchor)) reasons.push(anchorProblem(s.anchor, idx));
    if (seen.has(s.anchor)) reasons.push(`这个锚点在这一批里已经交过（第 ${seen.get(s.anchor)} 段），一个锚点只交一段`);
    else seen.set(s.anchor, i + 1);
    if (MARKER_RE.test(raw)) reasons.push('正文里带着 <!-- readable-docs: … --> 标记：指纹与状态只由命令盖，带着它的一律拒收');
    if (!s.text) reasons.push('正文是空的');
    const kinds = sensitiveKinds(s.text);
    if (kinds.length) reasons.push(`正文里有${kinds.join('、')}的字样：生成物里不许出现，去掉再交`);
    if (reasons.length) problems.push({ where: `第 ${i + 1} 段 ${s.anchor || '（没写锚点）'}（输入第 ${s.line} 行）`, reasons });
  });
  if (problems.length) return { ok: false, problems };
  const stored = loadNotes(root), files = new Set();
  for (const s of segs) {
    const { fp, file } = idx.get(s.anchor), old = stored.get(s.anchor);
    if (old) files.add(old.file);
    files.add(file);
    stored.set(s.anchor, { anchor: s.anchor, fp, status: 'draft', by: null, on: null, text: s.text, file });
  }
  saveNotes(root, stored, files);
  return { ok: true, written: segs.map((s) => s.anchor).sort(cmp) };
}

// anchors 为 null 即 --all。点名的锚点里有没写说明的：一段都不改，交 missing 回去（入口报用法错）。
// 指纹对得上的记成 reviewed，带上名字与日期；对不上的与孤儿不改、进 mismatched。
// --all 不碰已经 reviewed 的：抽审人与日期是「谁哪天看过这一版」的记录，批量重盖会把别人看过的记到自己名下；点名的照盖。
export function confirmNotes(root, model, anchors, by, today) {
  const idx = anchorIndex(model), stored = loadNotes(root);
  const targets = anchors === null ? [...stored.keys()].sort(cmp) : [...new Set(anchors)];
  const missing = targets.filter((a) => !stored.has(a));
  const res = { missing, confirmed: [], kept: [], mismatched: [] };
  if (missing.length) return res;
  const files = new Set();
  for (const a of targets) {
    const e = stored.get(a);
    if (!idx.has(a)) res.mismatched.push({ anchor: a, why: '锚点已经不存在（孤儿说明），改挂到新锚点要重新 put' });
    else if (stateOf(e, idx) === 'stale') res.mismatched.push({ anchor: a, why: '来源变了，这段说明写于旧版本，重写后 put 再抽审' });
    else if (anchors === null && e.status === 'reviewed') res.kept.push(a);
    else { stored.set(a, { ...e, status: 'reviewed', by, on: today }); files.add(e.file); res.confirmed.push(a); }
  }
  if (files.size) saveNotes(root, stored, files);
  return res;
}

// 删掉这几段说明（孤儿也删得掉，不需要锚点现存）；点名的里有没写说明的，一段都不删。
export function dropNotes(root, anchors) {
  const stored = loadNotes(root), targets = [...new Set(anchors)].sort(cmp);
  const missing = targets.filter((a) => !stored.has(a));
  if (missing.length) return { missing, dropped: [] };
  const files = new Set(targets.map((a) => stored.get(a).file));
  targets.forEach((a) => stored.delete(a));
  saveNotes(root, stored, files);
  return { missing: [], dropped: targets };
}

// ———— pending：按表列出要补的（契约 G 节）————

const oneLine = (s) => (s == null ? null : redact(String(s).replace(/\s+/g, ' ').trim()).text);
const firstPara = (text) => text.split('\n\n')[0];
const topFiles = (list) => [...list.reduce((m, x) => m.set(x.file, (m.get(x.file) ?? 0) + 1), new Map())]
  .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([f, n]) => `${f} ×${n}`);
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

// 一张表的上下文：列清单不截（一列压成一行），来源注释、引用与被引用、改动备注、所在的组照给；
// 写它、读它的文件给最多的几个，总量过了 4KB 先一个个截读它的文件，再截写它的，截了多少写在 files 里，不悄悄少。
// 来源里的注释、默认值、CHECK 先过一遍隐去规则：照抄进说明的话 note put 反正要拒。
function tableContext(t, group, refBy, use) {
  const col = (c) => [c.name, c.type, c.nullable ? null : 'NOT NULL', c.primaryKey ? 'PK' : null, c.unique ? 'UNIQUE' : null,
    c.default != null ? `DEFAULT ${oneLine(c.default)}` : null, c.check ? `CHECK ${oneLine(c.check)}` : null,
    c.comment ? `-- ${oneLine(c.comment)}` : null].filter(Boolean).join(' ');
  const fk = (k) => `${k.columns.join(', ')} → ${k.table}${k.refColumns.length ? `(${k.refColumns.join(', ')})` : ''}`;
  const writers = topFiles(use?.writes ?? []), readers = topFiles(use?.reads ?? []);
  const ctx = {
    table: t.name, group, comment: oneLine(t.comment), columns: t.columns.map(col),
    references: uniqSorted(foreignKeys(t)).map(fk), referencedBy: refBy,
    changes: t.changes.map((x) => `${x.file}:${x.line}${x.addedColumns.length ? ` 加 ${x.addedColumns.join('、')}` : ''}：${oneLine(x.comment)}`),
    writers: writers.slice(0, TOP_FILES), readers: readers.slice(0, TOP_FILES),
    files: { writers: writers.length, readers: readers.length },
  };
  while (bytes(ctx) > CONTEXT_BUDGET && (ctx.readers.length || ctx.writers.length)) (ctx.readers.length ? ctx.readers : ctx.writers).pop();
  return ctx;
}

// 返回 {summary, tables, groups, doc, orphans}。要补的表：没有表说明、有缺含义的列（既没来源注释也没说明，外键列不算——
// 它的含义由引用关系给出）、有指纹对不上的说明，三者占一样就列。指纹对不上的与孤儿都带着正文，方便改写或改挂。
export function pendingList(root, model) {
  const idx = anchorIndex(model), stored = loadNotes(root);
  const stale = (a) => (stored.has(a) && stateOf(stored.get(a), idx) === 'stale' ? { anchor: a, text: stored.get(a).text } : null);
  const groupOf = new Map(model.groups.flatMap((g) => g.tables.map((n) => [n, { id: g.id, title: g.title }])));
  const refBy = new Map();
  for (const t of model.tables) for (const k of foreignKeys(t)) (refBy.get(k.table) ?? refBy.set(k.table, []).get(k.table)).push(`${t.name}.${k.columns.join(', ')}`);
  const tables = [];
  for (const t of model.tables) {
    const fkCols = new Set(foreignKeys(t).flatMap((k) => k.columns));
    // 给锚点不给列名：照着它写「## column:<表>.<列>」就能交给 note put。
    const missingColumns = t.columns.filter((c) => !fkCols.has(c.name) && !c.comment && !stored.has(c.anchor)).map((c) => c.anchor);
    const stales = [t.anchor, ...t.columns.map((c) => c.anchor)].map(stale).filter(Boolean);
    const missingTable = !stored.has(t.anchor);
    if (!missingTable && !missingColumns.length && !stales.length) continue;
    const context = tableContext(t, groupOf.get(t.name) ?? null, [...new Set(refBy.get(t.name) ?? [])].sort(cmp), model.usage?.[t.name]);
    tables.push({ anchor: t.anchor, table: t.name, missingTable, missingColumns, stale: stales, context, contextBytes: bytes(context) });
  }
  const comments = new Map(model.tables.map((t) => [t.name, t.comment]));
  const purpose = (n) => {
    const e = stored.get(tableAnchor(n));
    return e && stateOf(e, idx) === 'current' ? firstPara(e.text) : oneLine(comments.get(n) ?? null);
  };
  const groups = model.groups.map((g) => {
    const a = groupAnchor(g.id);
    return { anchor: a, id: g.id, title: g.title, missing: !stored.has(a), stale: stale(a), members: g.tables.map((n) => ({ table: n, purpose: purpose(n) })) };
  }).filter((g) => g.missing || g.stale);
  const da = docAnchor(DB_DOC);
  const doc = !stored.has(da) || stale(da)
    ? { anchor: da, missing: !stored.has(da), stale: stale(da), groups: model.groups.map((g) => ({ id: g.id, title: g.title, tables: g.tables.length })) } : null;
  const orphans = [...stored.keys()].filter((a) => !idx.has(a)).sort(cmp).map((a) => ({ anchor: a, text: stored.get(a).text }));
  const arch = pendingArch(model, stored, stale); // 第三期：要补的模块与 doc:arch，接在原有各项后面，原有的键与值不变
  const summary = {
    tables: tables.length, missingTables: tables.filter((t) => t.missingTable).length, groups: groups.length, doc: doc !== null,
    columns: tables.reduce((s, t) => s + t.missingColumns.length, 0),
    stale: tables.reduce((s, t) => s + t.stale.length, 0) + groups.filter((g) => g.stale).length + (doc?.stale ? 1 : 0)
      + arch.modules.filter((x) => x.stale).length + (arch.archDoc?.stale ? 1 : 0),
    orphans: orphans.length, maxContextBytes: tables.reduce((m, t) => Math.max(m, t.contextBytes), 0),
    modules: arch.modules.length, missingModules: arch.modules.filter((x) => x.missing).length, archDoc: arch.archDoc !== null,
    maxModuleContextBytes: arch.modules.reduce((m, x) => Math.max(m, x.contextBytes), 0),
  };
  return { summary, tables, groups, doc, orphans, ...arch };
}
