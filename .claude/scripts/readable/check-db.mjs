// check-db.mjs —— 核对第 2 项的数据库设计那一半：表页、组页、清单页上显示的与重新取的事实一致（契约 docs/readable-spec/phase1-db-contract.md H 节第 2 项；规格 REQ-DOC-007）。
// 为什么有它：出页面的代码吞了字、串了行，第 1 项（重出的与磁盘上的逐字节比）两边错得一样看不出来，靠这一项。
// 所以不信出页面的代码：架构稿 §3 禁边，这里不 import render/ 下的任何东西，页面靠 check-read.mjs 照 C 节「机器读得回来」的标记读回来。
// 键不许只放在属性里：字段行靠 data-anchor 配、谁写谁读的行靠 data-row 数，读者看的却是格子里显示的列名与路径，
// 所以列名（data-k="name"）、路径（data-k="file"）显示的字也与事实比（2026-11-23 第三期审查在架构页上实测出同一类假绿后补）。
// 说明区的读回（noteRegions）也在这里，架构那一项（check-arch.mjs）由 check.mjs 交过去用，两边一份规矩。
// 原在 check.mjs，2026-11-23 第三期审查修复时搬来，给 check.mjs 腾地方。
import { cmp } from './model.mjs';
import { redact } from './sensitive.mjs';
import { findAll, textOf, squash, sectionRows } from './check-read.mjs';

// 文件名由表名推出（契约 C 节）：小写字母、数字、下划线、连字符以外的字符（大写字母也算）写成「~十六进制码点」。
// 照契约自己推，不借出页面的代码。
const slug = (name) => String(name).replace(/[^a-z0-9_-]/gu, (c) => `~${c.codePointAt(0).toString(16)}`);
const tablePath = (name) => `db/t-${slug(name)}.html`;
const TABLE_PAGE = /^db\/t-[^/]*\.html$/;
const GROUP_MAX = 12; // 契约 C 节：一组超过 12 张表的切成几页
// 页面上显示的是隐去后的文字（契约 G 节「不带出去的东西」）：契约点名要隐去的默认值与说明正文，比对前事实一侧也过一遍。
const shown = (s) => squash(redact(s).text);
// 说明正文显示成的纯文字（契约 G 节「存放」的写法）：「- 」开头的行是列表项，前缀不显示；反引号里的是等宽字，反引号不显示。
const notePlain = (text) => squash(redact(text).text.replace(/\r\n?/g, '\n').split('\n')
  .map((l) => (l.startsWith('- ') ? l.slice(2) : l)).join('\n').replace(/`([^`\n]+)`/g, '$1'));
// 说明区的读回标记（契约 C 节）：没有说明是 none，过期的是 stale，其余是侧车里记的 draft / reviewed。
const wantState = (n) => (!n ? 'none' : n.state === 'stale' ? 'stale' : n.status);
const groupBy = (xs, key) => { const m = new Map(); for (const x of xs) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
// 两段文字从哪里开始不同，各取一小截给人看。
function diffAt(got, want) {
  let i = 0;
  while (i < got.length && i < want.length && got[i] === want[i]) i++;
  const cut = (s) => `${i > 12 ? '…' : ''}${s.slice(Math.max(0, i - 12), i + 24)}${s.length > i + 24 ? '…' : ''}`;
  return `第 ${i + 1} 个字起不同，页面上「${cut(got)}」，侧车「${cut(want)}」`;
}

// 一个说明区：状态与侧车一致；有说明时正文的纯文字与侧车的一致，没有说明时不该有正文。
// 正文在哪：说明区里带 data-k="note" 的那一块（表页、组页、清单页顶上的说明区，字段表「含义」格里的说明都是）——
// 只认契约 C 节的读回标记，不认样式类名；格子里并排的「来源里的注释」带的是 data-k="comment"，不算说明的正文。
function noteRegion(r, anchor, n, add) {
  const state = r.attrs['data-state'], want = wantState(n);
  if (state !== want) { add('note-mismatch', anchor, `说明的状态：页面上是「${state ?? '（没标）'}」，侧车是「${want}」`); return; }
  const bodies = findAll(r, (x) => x.attrs['data-k'] === 'note');
  if (!n) { if (bodies.length) add('note-mismatch', anchor, '侧车里没有这段说明，页面上却有说明的正文'); return; }
  if (bodies.length !== 1) { add('note-mismatch', anchor, bodies.length ? `说明的正文出现了 ${bodies.length} 处` : '页面上看不到说明的正文'); return; }
  const got = textOf(bodies[0]), plain = notePlain(n.text);
  if (got !== plain) add('note-mismatch', anchor, `说明的正文与侧车不同：${diffAt(got, plain)}`);
}

// 一页上的说明区恰好是 anchors 这几个，各一处。
export function noteRegions(tree, anchors, notes, add) {
  const regions = groupBy(findAll(tree, (n) => n.attrs['data-note'] !== undefined), (n) => n.attrs['data-note']);
  for (const a of regions.keys()) if (!anchors.includes(a)) add('note-mismatch', a, '这一页不该有这个锚点的说明区');
  for (const a of anchors) {
    const list = regions.get(a) || [];
    if (list.length !== 1) add('note-mismatch', a, list.length ? `说明区出现了 ${list.length} 处` : '页面上没有这个锚点的说明区');
    else noteRegion(list[0], a, notes[a], add);
  }
}

// 字段行里七格应显示的文字（契约 C 节「机器读得回来」、H 节第 2 项）。照契约与页面的显示约定自己写一份，不借出页面的代码：
// 名字是列名本身（列名是锚点与说明的键，不过隐去，同出页面那边）；
// 键与约束是「主键」「唯一」、CHECK 原文、GENERATED 原文依次各占一行；引用是「表 (列) · ON DELETE 动作 · ON UPDATE 动作」；
// 来源注释是注释原文，没有注释的列这一块不出（读回为空）。取自来源的文字页面上显示的是隐去后的，这里也先过一遍。
function cellWants(c) {
  const r = c.references;
  return [
    ['name', '名字', squash(c.name)],
    ['type', '类型', shown(c.type)],
    ['nullable', '可空', c.nullable ? '是' : '否'],
    ['default', '默认', c.default == null ? '' : shown(c.default)],
    ['key', '键与约束', squash([c.primaryKey && '主键', c.unique && '唯一', c.check && shown(c.check), c.generated && shown(c.generated)].filter(Boolean).join(' '))],
    ['ref', '引用', r ? squash(`${r.table}${r.column ? ` (${r.column})` : ''}${r.onDelete ? ` · ON DELETE ${r.onDelete}` : ''}${r.onUpdate ? ` · ON UPDATE ${r.onUpdate}` : ''}`) : ''],
  ];
}

// 表级约束、索引：页面上带 data-row 的行数与事实一致。
function rowCounts(tree, t, add) {
  for (const [kind, what, n] of [['constraint', '表级约束', (t.constraints || []).length], ['index', '索引', (t.indexes || []).length]]) {
    const got = findAll(tree, (x) => x.attrs['data-row'] === kind).length;
    if (got !== n) add('fact-mismatch', null, `${what}：页面上 ${got} 行，来源里 ${n} 条${got < n ? `，少了 ${n - got} 条` : `，多了 ${got - n} 条`}`);
  }
}

// 写它的文件、读它的文件（契约 F 节，一个文件一行）：每行显示一个路径（data-k="file"），页面上的路径与事实里写（读）这张表的文件逐个比，
// 少了的、多了的都点名；行里只许有 file 与 module（第三期契约 D 节表页那一行）两格，模块标得对不对由 check-arch.mjs 管。
const USAGE_K = new Set(['file', 'module']);
const clip = (list) => `${list.slice(0, 5).map((x) => `「${x}」`).join('、')}${list.length > 5 ? ` 等 ${list.length} 个` : ''}`;
function usageFiles(tree, t, usage, add) {
  const rows = sectionRows(tree, null).rows;
  for (const [kind, what, src] of [['writer', '写它的文件', 'writes'], ['reader', '读它的文件', 'reads']]) {
    const want = [...new Set((usage?.[t.name]?.[src] || []).map((e) => e.file))].sort(cmp), mine = rows.filter((r) => r.key === kind), got = [];
    for (const r of mine) {
      const cells = findAll(r.node, (n) => n.attrs['data-k'] === 'file');
      const odd = Object.keys(r.k).filter((x) => !USAGE_K.has(x));
      if (odd.length) add('fact-mismatch', null, `${what}：有一行带了表里没列的格子 ${odd.map((x) => `data-k="${x}"`).join('、')}`);
      if (cells.length === 1) got.push(textOf(cells[0]));
      else add('fact-mismatch', null, `${what}：有一行${cells.length ? `显示了 ${cells.length} 个路径` : '没有显示路径（data-k="file"）'}`);
    }
    const left = [...want];
    const extra = got.filter((f) => { const i = left.indexOf(f); if (i < 0) return true; left.splice(i, 1); return false; });
    if (left.length || extra.length || mine.length !== want.length) {
      add('fact-mismatch', null, `${what}：页面上 ${mine.length} 行，来源里 ${want.length} 个文件${left.length ? `；页面上少了${clip(left)}` : ''}${extra.length ? `；页面上多了${clip(extra)}，来源里没有` : ''}`);
    }
  }
}

// 表页：表锚点与文件名对得上；每个列恰有一行，七格与事实一致，没有事实里没有的列；约束与索引的行数、写读的文件一致；说明区一致。
function tablePage(tree, t, notes, usage, add) {
  const anchors = findAll(tree, (n) => n.tag === 'main').map((m) => m.attrs['data-anchor']).filter((a) => a !== undefined);
  if (anchors.length !== 1 || anchors[0] !== t.anchor) add('fact-mismatch', null, `页里的表锚点是${anchors.length ? anchors.map((a) => `「${a}」`).join('、') : '（没有）'}，按文件名应是「${t.anchor}」`);
  const rows = groupBy(findAll(tree, (n) => String(n.attrs['data-anchor'] ?? '').startsWith('column:')), (n) => n.attrs['data-anchor']);
  const mine = new Set(t.columns.map((c) => c.anchor));
  for (const a of rows.keys()) if (!mine.has(a)) add('fact-mismatch', a, '页面上有这一列，来源里这张表没有它');
  for (const c of t.columns) {
    const list = rows.get(c.anchor) || [];
    if (list.length !== 1) { add('fact-mismatch', c.anchor, list.length ? `页面上这一列出现了 ${list.length} 行` : '页面上少了这一列'); continue; }
    for (const [k, what, want] of cellWants(c)) {
      const found = findAll(list[0], (n) => n.attrs['data-k'] === k);
      if (found.length !== 1) { add('fact-mismatch', c.anchor, `${what}格${found.length ? `出现了 ${found.length} 个` : '不见了'}`); continue; }
      const got = textOf(found[0]);
      if (got !== want) add('fact-mismatch', c.anchor, `${what}：页面上是「${got}」，来源是「${want}」`);
    }
    // 来源注释：有注释的列恰有一块，没有的一块都没有；块里的文字就是注释原文（隐去后）。
    const com = findAll(list[0], (n) => n.attrs['data-k'] === 'comment'), want = c.comment == null || c.comment === '' ? '' : shown(c.comment);
    if (com.length > 1) add('fact-mismatch', c.anchor, `来源注释出现了 ${com.length} 处`);
    else if ((com.length ? textOf(com[0]) : '') !== want) add('fact-mismatch', c.anchor, `来源注释：页面上是「${com.length ? textOf(com[0]) : '（没有）'}」，来源是「${want || '（没有）'}」`);
  }
  rowCounts(tree, t, add);
  usageFiles(tree, t, usage, add);
  // 少了的列上面已经报过，它的说明区不再另报一条「没有」。
  noteRegions(tree, [t.anchor, ...t.columns.filter((c) => rows.has(c.anchor)).map((c) => c.anchor)], notes, add);
}

// 第 2 项的数据库设计那一半：把 dir 下的页面读回来与事实比。label 是给人看的位置前缀。
export function pageFacts(rd, facts, label) {
  const out = [], notes = facts.notes || {};
  const at = (rel, anchor) => `${label}${rel}${anchor ? ` · ${anchor}` : ''}`;
  const has = new Set(rd.html), expected = new Map();
  for (const t of facts.tables) {
    const p = tablePath(t.name);
    if (expected.has(p)) out.push({ kind: 'fact-mismatch', where: at(p), detail: `表 ${expected.get(p).name} 与 ${t.name} 推出的文件名相同，只有一页` });
    else expected.set(p, t);
  }
  for (const rel of rd.html) if (TABLE_PAGE.test(rel) && !expected.has(rel)) out.push({ kind: 'extra-page', where: at(rel), detail: '这一页对不上任何一张现行的表' });
  for (const [rel, t] of expected) {
    if (!has.has(rel)) { out.push({ kind: 'missing-page', where: at(rel), detail: `表 ${t.name} 没有页面` }); continue; }
    tablePage(rd.tree(rel), t, notes, facts.usage, (kind, anchor, detail) => out.push({ kind, where: at(rel, anchor), detail }));
  }
  // 别的页上的说明区：数据库设计清单页一个 doc:db；组页每页一个本组的（契约 C、F 节：g-<组 id>.html，超过 12 张表的均分成几页、接 -1、-2）。
  const hosts = new Map([['db/index.html', ['doc:db']]]);
  for (const g of facts.groups) {
    const parts = Math.max(1, Math.ceil(g.tables.length / GROUP_MAX));
    for (let i = 1; i <= parts; i++) {
      const p = `db/g-${slug(g.id)}${parts > 1 ? `-${i}` : ''}.html`;
      hosts.set(p, [...(hosts.get(p) || []), `group:${g.id}`]);
    }
  }
  for (const [rel, anchors] of hosts) {
    if (!has.has(rel)) { out.push({ kind: 'missing-page', where: at(rel), detail: `${anchors.join('、')} 的说明区所在的页不在` }); continue; }
    noteRegions(rd.tree(rel), anchors, notes, (kind, anchor, detail) => out.push({ kind, where: at(rel, anchor), detail }));
  }
  for (const rel of rd.html) {
    if (TABLE_PAGE.test(rel) || hosts.has(rel) || rel.startsWith('arch/')) continue; // arch/ 下的说明区由 check-arch.mjs 读回
    if (/^db\/g-[^/]*\.html$/.test(rel)) { out.push({ kind: 'extra-page', where: at(rel), detail: '这一页对不上任何一个现行的组' }); continue; }
    for (const r of findAll(rd.tree(rel), (n) => n.attrs['data-note'] !== undefined)) out.push({ kind: 'note-mismatch', where: at(rel, r.attrs['data-note']), detail: '这一页不该有这个锚点的说明区' });
  }
  return out;
}
