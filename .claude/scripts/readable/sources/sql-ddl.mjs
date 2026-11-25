// sql-ddl.mjs —— 建表定义的取事实器（契约 docs/readable-spec/phase1-db-contract.md B 节；方言以 PostgreSQL 为准）。
// 只出事实：结构原文与源码里的 -- 注释原样带上，不改写、不解释（规格「事实与解释分开」；sources 不碰说明，架构稿 §3）。
// 切词切语句在 sql-lex.mjs，约束的补名与按名字摘除在 sql-constraints.mjs，本文件认语句、合并成现行结构。
// 这一层最贵的错是悄悄漏掉表、列、视图、函数，或把读不出的装作读出来——读者会把文档当真。所以两条：
//   1. 读不懂只抛 ParseFail，按语句（ALTER 按动作）兜住进「未解析」，其余照读；别的异常是本脚本的错，往上抛成退出码 3，不混进清单。
//   2. 契约没认、但会改表结构的语句（DROP TABLE / ALTER INDEX、ALTER 里没认的动作）也进「未解析」，不静默略过。
// 实数（2026-11-22，conflation/api/schema.sql 2856 行）：行首 CREATE TABLE 77 条、ADD COLUMN 117 处、DO $$ 17 处，
// 顶层 DROP CONSTRAINT 4 条、DROP INDEX 3 条、VALIDATE CONSTRAINT 1 条，视图 1 个、函数 2 个。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyFacts, excerpt, finalizeTables, finalizeViews, finalizeFunctions } from '../model.mjs';
import { ParseFail, fail, lex, statements, Cur, splitTop, skipExpr, unquote } from './sql-lex.mjs';
import { nullsDistinct, refs, tableConstraint, checkIdents, nameInline, nameConstraint, checkText, dropConstraint, settleDrop,
  dropColumnRefs, renameColumnRefs, conflict, orphan } from './sql-constraints.mjs';
import { createIndex, dropIndex, dropColumnIndexes, renameIndexColumns } from './sql-index.mjs';
import { doBlock } from './sql-do-block.mjs';
import { isCodeFile, ddlSegments } from './code-scan.mjs';

// ---- 注释归属（契约 B 节「注释从哪来」）----
function lowerBound(cs, off) { let lo = 0, hi = cs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cs[m].s < off) lo = m + 1; else hi = m; } return lo; }
// 紧贴在 line 上方、中间没有空行的连续整行 --（只看 from 之后的）
function above(ctx, from, before, line) {
  const got = []; let want = line - 1;
  for (let j = lowerBound(ctx.comments, before) - 1; j >= 0; j--) {
    const c = ctx.comments[j];
    if (c.s < from || !c.full || c.line !== want) break;
    got.unshift(c.text); want--;
  }
  return got;
}
function within(ctx, from, to, keep) {
  const got = [];
  for (let j = lowerBound(ctx.comments, from); j < ctx.comments.length && ctx.comments[j].s < to; j++) if (keep(ctx.comments[j])) got.push(ctx.comments[j].text);
  return got;
}
// 定义项自己行里的 --（含跨行定义中间的）加最后一行行尾、下一项开始之前的 --
const inline = (ctx, a, b, next) => {
  const first = ctx.toks[a], last = ctx.toks[b - 1];
  return [...within(ctx, first.s, last.e, () => true), ...within(ctx, last.e, next, (c) => c.line === last.endLine)];
};
const joinText = (parts) => { const p = parts.filter(Boolean); return p.length ? p.join('\n') : null; };
const columnNames = (cols) => cols.map((o) => o.name);

// 紧贴在一条 ALTER TABLE 上方的 -- 不归列，记成这张表的一条改动备注（契约 B 节「建表之后的改动」）：它多半在讲这一批改动为什么做，
// 一段话常常管着后面好几条语句——比如 orders 上方两行注释，下面紧跟着三条 ALTER TABLE orders，再往下的 DO 块也是它在讲的。
// 备注管到紧跟其后、中间没有空行、也没有自己那段注释的同表 ALTER 为止；记这几条真正加进来的列（被 IF NOT EXISTS 跳过的不算，一列没加也照记）。
// run 是上一条语句留下的那条备注（只有上一条也是 ALTER 本表时才有），返回本条语句归入的备注，没有为 null。
function changeNote(st, ctx, t, run) {
  const first = ctx.toks[st.a], lead = above(ctx, st.gap, first.s, first.line), comment = joinText(lead);
  // 带 file：建表文件不止一份时，改它的语句可以写在靠后的文件里，光有行号找不到出处（契约 B 节键名清单）。
  if (comment) { const note = { file: ctx.file, line: first.line - lead.length, comment, addedColumns: [] }; t.changes.push(note); return note; }
  if (lead.length || !run || run.table !== t || /\n[ \t\r]*\n/.test(ctx.src.slice(st.gap, first.s))) return null;
  return run.note;
}

// ---- 列定义与约束 ----
const TC_START = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'EXCLUDE']);
const COL_STOP = new Set(['CONSTRAINT', 'NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK', 'GENERATED']);
const USING_STOP = new Set(['USING']);
const MODS = new Set(['GLOBAL', 'LOCAL', 'TEMP', 'TEMPORARY', 'UNLOGGED', 'FOREIGN']);
// 函数签名取到返回类型为止，停在第一个函数选项上
const FN_STOP = new Set(['AS', 'LANGUAGE', 'IMMUTABLE', 'STABLE', 'VOLATILE', 'STRICT', 'CALLED', 'RETURNS', 'SECURITY', 'EXTERNAL',
  'PARALLEL', 'COST', 'ROWS', 'SUPPORT', 'SET', 'WINDOW', 'LEAKPROOF', 'TRANSFORM', 'BEGIN']);

// 类型取列名之后到第一个约束关键字之前的原文；默认值、CHECK 都取原文（契约 B 节「每个列取」）。
function parseColumn(c) {
  const name = c.ident(), ts = c.i;
  skipExpr(c, COL_STOP, false);
  if (c.i === ts) fail(`列 ${name} 没写类型`);
  const col = { name, type: c.raw(ts, c.i), nullable: true, default: null, primaryKey: false, unique: false, references: null, check: null, generated: null, inl: [] };
  while (!c.done()) {
    const cs = c.i; let cn = null;
    if (c.eatW('CONSTRAINT')) cn = c.ident();
    if (c.eatW('NOT', 'NULL')) col.nullable = false;
    else if (c.eatW('NULL')) { /* 显式可空，与默认相同 */ }
    else if (c.eatW('DEFAULT')) { const ds = c.i; skipExpr(c, COL_STOP, true); if (c.i === ds) fail(`列 ${name} 的 DEFAULT 后面是空的`); col.default = c.raw(ds, c.i); }
    else if (c.eatW('PRIMARY', 'KEY')) { col.primaryKey = true; col.nullable = false; col.inl.push({ type: 'primary key', name: cn }); }
    else if (c.eatW('UNIQUE')) { nullsDistinct(c); col.unique = true; col.inl.push({ type: 'unique', name: cn }); }
    else if (c.isW('REFERENCES')) {
      const r = refs(c);
      if (r.columns && r.columns.length !== 1) fail(`列 ${name} 的 REFERENCES 括号里只能有一列`);
      col.references = { table: r.table, column: r.columns ? r.columns[0] : null, onDelete: r.onDelete, onUpdate: r.onUpdate, raw: c.raw(cs, c.i) };
      col.inl.push({ type: 'foreign key', name: cn });
    } else if (c.eatW('CHECK')) {
      const [a, b] = c.group('CHECK 后面该是括号'); c.eatW('NO', 'INHERIT');
      col.inl.push({ type: 'check', name: cn, raw: c.raw(cs, c.i), idents: checkIdents(c, a, b) });
    } else if (c.isW('GENERATED')) {
      // 标识列与生成列是列的属性，原文记进 generated（契约 B 节）；读不懂它从前会让整条 CREATE TABLE 进「未解析」，后面的 ALTER 全成了「改了不存在的表」。
      const gs = c.i++;
      // 标识列在 PostgreSQL 里自动不可空（如 orders.id bigint GENERATED ALWAYS AS IDENTITY），不写 NOT NULL 也一样；生成列（AS (表达式) STORED）不在此列，照原规则。
      if (c.eatW('ALWAYS', 'AS', 'IDENTITY') || c.eatW('BY', 'DEFAULT', 'AS', 'IDENTITY')) { col.nullable = false; if (c.isOp('(')) c.group(); }
      else if (c.eatW('ALWAYS', 'AS')) { c.group('GENERATED ALWAYS AS 后面该是括号里的表达式'); if (!c.eatW('STORED')) c.eatW('VIRTUAL'); }
      else fail(`列 ${name} 的 GENERATED 后面「${c.word()}」读不懂`);
      if (col.generated) fail(`列 ${name} 写了两个 GENERATED`);
      col.generated = c.raw(gs, c.i);
    } else fail(`列 ${name} 里有读不懂的「${c.word()}」`);
  }
  col.check = checkText(col.inl);
  return col;
}

// ---- 各类语句（建索引、删索引在 sql-index.mjs）----
const markPk = (cols, names) => names.forEach((n) => { const o = cols.find((x) => x.name === n); o.primaryKey = true; o.nullable = false; });

function createTable(st, ctx, at) {
  const c = new Cur(ctx, st.a + 2, st.b);
  const ine = c.eatW('IF', 'NOT', 'EXISTS'), name = c.qname().at(-1);
  const [a, b] = c.group('表名后面不是左括号（CREATE TABLE … AS / PARTITION OF 一类不在契约认的范围）');
  if (!c.done()) fail(`右括号后还有「${c.word()}」（PARTITION BY / INHERITS / WITH 一类不在契约认的范围）`);
  const parts = splitTop(ctx.toks, a, b), cols = [], cons = [];
  // 先整条读完再合并：中间任何一项读不懂，整条进「未解析」，不留半张表（契约「不猜」）。
  parts.forEach(([x, y], k) => {
    if (x === y) fail('括号里有空的定义项（多了逗号？）');
    const first = ctx.toks[x], next = ctx.toks[k + 1 < parts.length ? parts[k + 1][0] : b].s;
    const loc = { file: ctx.file, line: first.line, comment: joinText([...above(ctx, ctx.toks[x - 1].e, first.s, first.line), ...inline(ctx, x, y, next)]) };
    const ec = new Cur(ctx, x, y);
    if (TC_START.has(first.up)) cons.push({ ...tableConstraint(ec), ...loc });
    else if (first.up === 'LIKE') fail('LIKE 子句不在契约认的范围');
    else { const col = parseColumn(ec); if (cols.some((o) => o.name === col.name)) fail(`列 ${col.name} 写了两次`); cols.push({ ...col, ...loc }); }
  });
  for (const con of cons) {
    if (con.type !== 'primary key') continue;
    const lack = con.columns.find((n) => !cols.some((o) => o.name === n));
    if (lack) fail(`主键里的 ${lack} 不是本表的列`);
    markPk(cols, con.columns);
  }
  const names = columnNames(cols);
  cols.forEach((col) => nameInline(col, name, names));
  cons.forEach((con) => nameConstraint(con, name, names));
  if (ctx.tables.has(name)) {
    if (!ine) conflict(ctx, at, name, null, 'table-exists', `表 ${name} 已经建过，这条没写 IF NOT EXISTS；保留先前的定义`);
    return;
  }
  // 表的注释：上方紧贴的 -- 行；上方没有时取「CREATE TABLE 名 (」那一行行尾、第一个定义项之前的 --（契约 B 节）。
  const first = ctx.toks[st.a], open = ctx.toks[a - 1], body = ctx.toks[a < b ? a : b].s;
  const comment = joinText(above(ctx, st.gap, first.s, first.line)) ?? joinText(within(ctx, open.e, body, (cm) => !cm.full && cm.line === open.endLine));
  ctx.tables.set(name, { name, file: ctx.file, line: at.line, comment, columns: cols, constraints: cons, indexes: [], changes: [], maybeDropped: [] });
}

function addConstraint(c, t, ctx, at) {
  const x = c.i, con = tableConstraint(c), written = con.name;
  settleDrop(t, written); // 「先 DROP … IF EXISTS x 再 ADD CONSTRAINT x」：这条语句在，前面那笔待定就销掉，合没合并另有清单
  const lack = con.columns.filter((n) => !t.columns.some((o) => o.name === n));
  if (lack.length) return conflict(ctx, at, t.name, lack.join(', '), 'column-missing', `约束里的列 ${lack.join('、')} 不存在，这条约束没合并`);
  // DO 块里守卫着的（at.guarded，sql-do-block.mjs）照守卫的意思办：本表已有同名的约束就跳过、不记冲突——守卫就是按名字查有没有。
  // 表级的与列上的都比，按内部名 id 比（写了名字的 id 就是它）：建表时 order_id 上已写 CONSTRAINT fk_items_order 的，守卫块再加一遍也只留一条。
  if (at.guarded) {
    nameConstraint(con, t.name, columnNames(t.columns));
    if (t.constraints.some((o) => o.id === con.id) || t.columns.some((o) => o.inl.some((x) => x.id === con.id))) return;
  }
  // 写了名字的与已有的、同样写了名字的表级约束同名，记冲突（原有行为）。补上的名字不拿来比：前面的 DO 块可能在运行时删过它
  // （真数据里有 DO 块先删掉某列没写名字的 CHECK，再在后面用补出来的那个名字重加一条更宽的），静态看撞名、库里不撞；照旧两条都显示，由「未合并」的提示兜。
  if (written && t.constraints.some((o) => o.name === written)) return conflict(ctx, at, t.name, null, 'constraint-exists', `约束 ${written} 已经有了，保留先前的定义`);
  if (con.type === 'primary key') {
    if (t.constraints.some((o) => o.type === 'primary key') || t.columns.some((o) => o.primaryKey)) return conflict(ctx, at, t.name, null, 'primary-key-exists', '表上已经有主键，保留先前的');
    markPk(t.columns, con.columns);
  }
  nameConstraint(con, t.name, columnNames(t.columns)); settleDrop(t, con.id);
  t.constraints.push({ ...con, file: ctx.file, line: at.line, comment: joinText(inline(ctx, x, c.j, at.next)) });
}

function alterAction(c, t, ctx, at) {
  const find = (n) => t.columns.findIndex((o) => o.name === n);
  const missing = (n) => conflict(ctx, at, t.name, n, 'column-missing', `列 ${n} 不存在，这一步没合并`);
  if (c.eatW('ADD')) {
    if (TC_START.has(c.peek()?.up)) return addConstraint(c, t, ctx, at);
    c.eatW('COLUMN');
    const ine = c.eatW('IF', 'NOT', 'EXISTS'), x = c.i, col = parseColumn(c);
    // 已有的列：有 IF NOT EXISTS（或在 DO 块的守卫里）跳过、没有记冲突，都保留先前的定义与位置（契约 B 节「合并成现行结构」）。
    if (find(col.name) >= 0) { if (!ine && !at.guarded) conflict(ctx, at, t.name, col.name, 'column-exists', `列 ${col.name} 已经有了，这条没写 IF NOT EXISTS；保留先前的定义`); return; }
    if (col.primaryKey && (t.columns.some((o) => o.primaryKey) || t.constraints.some((o) => o.type === 'primary key'))) return conflict(ctx, at, t.name, col.name, 'primary-key-exists', '表上已经有主键，这一列没合并');
    nameInline(col, t.name, [...columnNames(t.columns), col.name]); col.inl.forEach((o) => settleDrop(t, o.id));
    // 这一行行尾的 -- 归这一列；语句上方紧贴的 -- 不归列，这一列记进那条改动备注的 addedColumns（被跳过的上面已经返回了）。
    t.columns.push({ ...col, file: ctx.file, line: at.line, comment: joinText(inline(ctx, x, c.j, at.next)) });
    at.note?.addedColumns.push(col.name);
    return;
  }
  if (c.eatW('DROP')) {
    if (c.eatW('CONSTRAINT')) {
      const ie = c.eatW('IF', 'EXISTS'), n = c.ident(); if (!c.eatW('CASCADE')) c.eatW('RESTRICT'); c.end();
      if (dropConstraint(t, n)) return;
      if (!ie) conflict(ctx, at, t.name, null, 'constraint-missing', `约束 ${n} 不存在，这一步没合并`);
      else t.maybeDropped.push({ file: ctx.file, line: at.line, name: n }); // 之后再加了同名的会被 settleDrop 销掉
      return;
    }
    c.eatW('COLUMN');
    const ie = c.eatW('IF', 'EXISTS'), n = c.ident(); if (!c.eatW('CASCADE')) c.eatW('RESTRICT'); c.end();
    const k = find(n); if (k < 0) { if (!ie) missing(n); return; }
    t.columns.splice(k, 1); dropColumnRefs(t, n); dropColumnIndexes(ctx, t, n); return;
  }
  if (c.eatW('VALIDATE', 'CONSTRAINT')) { c.ident(); c.end(); return; } // 只是校验存量行，不改结构
  if (c.eatW('ALTER')) {
    if (c.isW('CONSTRAINT')) fail('ALTER CONSTRAINT 不在契约认的语句里');
    c.eatW('COLUMN');
    const n = c.ident(); let apply;
    if (c.eatW('SET', 'NOT', 'NULL')) apply = (o) => { o.nullable = false; };
    else if (c.eatW('DROP', 'NOT', 'NULL')) apply = (o) => { o.nullable = true; };
    else if (c.eatW('SET', 'DEFAULT')) { if (c.done()) fail('SET DEFAULT 后面没有值'); const v = c.raw(c.i, c.j); c.i = c.j; apply = (o) => { o.default = v; }; }
    else if (c.eatW('DROP', 'DEFAULT')) apply = (o) => { o.default = null; };
    else if (c.eatW('SET', 'DATA', 'TYPE') || c.eatW('TYPE')) {
      const x = c.i; skipExpr(c, USING_STOP, false); if (x === c.i) fail('TYPE 后面没有类型');
      const v = c.raw(x, c.i); if (c.eatW('USING')) { if (c.done()) fail('USING 后面是空的'); c.i = c.j; }
      apply = (o) => { o.type = v; };
    } else fail(`ALTER COLUMN 后的「${c.word()}」不在契约认的范围`);
    c.end();
    const k = find(n); if (k < 0) return missing(n);
    apply(t.columns[k]); return;
  }
  if (c.eatW('RENAME')) {
    if (c.isW('TO') || c.isW('CONSTRAINT')) fail('只认 RENAME [COLUMN] 旧 TO 新；改表名、改约束名不在契约认的范围');
    c.eatW('COLUMN');
    const from = c.ident(); c.needW('TO'); const to = c.ident(); c.end();
    const k = find(from); if (k < 0) return missing(from);
    if (find(to) >= 0) return conflict(ctx, at, t.name, to, 'column-exists', `改名的目标 ${to} 已经有了，这一步没合并`);
    t.columns[k].name = to; renameColumnRefs(ctx.tables.values(), t, from, to); renameIndexColumns(t, from, to); return;
  }
  fail(`ALTER TABLE 的动作「${c.word()}」不在契约认的范围`);
}

function alterTable(st, ctx, at, run) {
  const c = new Cur(ctx, st.a + 2, st.b);
  c.eatW('IF', 'EXISTS'); c.eatW('ONLY');
  const name = c.qname().at(-1); if (c.isOp('*')) c.i++;
  const t = ctx.tables.get(name);
  if (!t) return orphan(ctx, at, name);
  if (c.done()) fail('ALTER TABLE 后面没有动作');
  const acts = splitTop(ctx.toks, c.i, c.j), note = changeNote(st, ctx, t, run);
  if (note) ctx.run = { table: t, note };
  // 一条 ALTER 里逗号连着的动作逐个处理；读不懂的那个动作单独进「未解析」，不连累同一条里读得懂的。
  acts.forEach(([x, y], k) => {
    const line = ctx.toks[x]?.line ?? at.line, next = k + 1 < acts.length ? ctx.toks[acts[k + 1][0]].s : st.next;
    try { if (x === y) fail('空的动作（多了逗号？）'); alterAction(new Cur(ctx, x, y), t, ctx, { ...at, line, next, note }); }
    catch (e) { if (!(e instanceof ParseFail)) throw e; ctx.facts.unparsed.push({ file: ctx.file, line, table: name, text: at.text, reason: e.message }); }
  });
}

// CREATE [OR REPLACE] VIEW / CREATE MATERIALIZED VIEW / CREATE [OR REPLACE] FUNCTION：只记名字、出处与原文（视图取整条定义，函数取到返回类型为止的签名、压成一行）。
// 同名再建：带 OR REPLACE 换成后一份；不带的库里会报错，记冲突、保留先前的（物化视图带 IF NOT EXISTS 的跳过）。函数按「名字 + 参数」认同一个，重载各记一条。
function defineObject(st, ctx, at, kind, from, replace, materialized = false) {
  const c = new Cur(ctx, st.a + from, st.b), ine = materialized && c.eatW('IF', 'NOT', 'EXISTS'), name = c.qname().at(-1), first = ctx.toks[st.a];
  let key = name, item;
  if (kind === 'VIEW') {
    if (c.isOp('(')) c.group();
    if (materialized && c.eatW('USING')) c.ident();
    if (c.eatW('WITH')) c.group('WITH 后面该是括号里的选项');
    if (materialized && c.eatW('TABLESPACE')) c.ident();
    c.needW('AS'); if (c.done()) fail('AS 后面是空的');
    item = { name, file: ctx.file, line: at.line, sql: ctx.src.slice(first.s, ctx.toks[st.b - 1].e), materialized };
  } else {
    const [a, b] = c.group('函数名后面该是括号里的参数');
    if (c.eatW('RETURNS')) { const rs = c.i; skipExpr(c, FN_STOP, false); if (c.i === rs) fail('RETURNS 后面没有类型'); }
    const args = a < b ? c.raw(a, b).replace(/\s+/g, ' ') : ''; // 参数原文压成一行：认同一个函数用它，重载的锚点后缀也拿它算
    key = `${name}(${args})`;
    item = { name, args, file: ctx.file, line: at.line, signature: c.raw(st.a, c.i).replace(/\s+/g, ' ') };
  }
  const store = kind === 'VIEW' ? ctx.views : ctx.functions, what = kind === 'VIEW' ? '视图' : '函数';
  if (store.has(key) && ine) return;
  if (store.has(key) && !replace) return conflict(ctx, at, null, null, kind === 'VIEW' ? 'view-exists' : 'function-exists', `${what} ${name} 已经建过，这条没写 OR REPLACE；保留先前的定义`);
  store.set(key, item);
}

// COMMENT ON 覆盖 -- 注释；IS NULL 是删掉注释。别的对象（索引、函数……）的注释不属于表结构，返回 false 交给分拣。
function commentOn(st, ctx, at) {
  const c = new Cur(ctx, st.a + 2, st.b);
  const kind = c.eatW('TABLE') ? 'table' : c.eatW('COLUMN') ? 'column' : null;
  if (!kind) return false;
  const parts = c.qname(); if (kind === 'column' && parts.length < 2) fail('COMMENT ON COLUMN 要写成 表.列');
  c.needW('IS');
  const v = c.eatW('NULL') ? null : unquote(c.next(), c); c.end();
  const table = parts.at(kind === 'table' ? -1 : -2), t = ctx.tables.get(table);
  if (!t) { orphan(ctx, at, table); return true; }
  if (kind === 'table') { t.comment = v; return true; }
  const col = t.columns.find((o) => o.name === parts.at(-1));
  if (col) col.comment = v; else conflict(ctx, at, table, parts.at(-1), 'column-missing', `列 ${parts.at(-1)} 不存在，这条注释没合并`);
  return true;
}

// DO 块（守卫着的静态语句并进来、其余记进「未合并」）在 sql-do-block.mjs；它认出的语句交回这里，跟顶层语句走同一条路。
// 改动备注只在同一个守卫里往下接（那边每进一个守卫把 ctx.run 清掉），同 dispatch。
const guarded = (st, ctx, at) => { const run = ctx.run; ctx.run = null; return ctx.toks[st.a].up === 'ALTER' ? alterTable(st, ctx, at, run) : createIndex(st, ctx, at); };

// 语句开头认不得、里面却有 CREATE TABLE / ALTER TABLE 的词（比如前面粘着一行没分号的 psql 命令）：照「未解析」报，免得一整张表被当成别的语句略过。
function hidesTable(st, ctx) {
  for (let k = st.a + 1; k < st.b; k++) {
    const u = ctx.toks[k].up; if (u !== 'CREATE' && u !== 'ALTER') continue;
    let p = k + 1; while (u === 'CREATE' && p < st.b && MODS.has(ctx.toks[p].up)) p++;
    if (p < st.b && ctx.toks[p].up === 'TABLE') return true;
  }
  return false;
}

function dispatch(st, ctx) {
  const w = (o) => (st.a + o < st.b ? ctx.toks[st.a + o].up ?? '' : '');
  const at = { line: ctx.toks[st.a].line, text: excerpt(ctx.src.slice(ctx.toks[st.a].s, ctx.toks[st.b - 1].e)), next: st.next };
  const [w0, w1] = [w(0), w(1)], run = ctx.run;
  ctx.run = null; // 改动备注只往下管紧跟着的同表 ALTER：别的语句一插进来就断，alterTable 认得接上的再放回去
  if (w0 === 'ALTER' && w1 === 'TABLE') return alterTable(st, ctx, at, run);
  if (w0 === 'CREATE') {
    const k0 = w1 === 'OR' && w(2) === 'REPLACE' ? 3 : 1;
    if (w(k0) === 'VIEW' || w(k0) === 'FUNCTION') return defineObject(st, ctx, at, w(k0), k0 + 1, k0 === 3);
    if (w1 === 'MATERIALIZED' && w(2) === 'VIEW') return defineObject(st, ctx, at, 'VIEW', 3, false, true); // 从前悄悄进了「略过」
    let k = 1; while (MODS.has(w(k))) k++;
    if (w(k) === 'TABLE') { if (k > 1) fail('CREATE 后面带 TEMP / UNLOGGED / FOREIGN 一类修饰，不在契约认的范围'); return createTable(st, ctx, at); }
    if (w1 === 'INDEX' || (w1 === 'UNIQUE' && w(2) === 'INDEX')) return createIndex(st, ctx, at);
  } else if (w0 === 'DROP' && w1 === 'INDEX') return dropIndex(st, ctx, at);
  else if (w0 === 'COMMENT' && w1 === 'ON') { if (commentOn(st, ctx, at)) return; }
  else if (w0 === 'DO') { if (doBlock(st, ctx, at, guarded)) return; }
  if ((w0 === 'DROP' && w1 === 'TABLE') || (w0 === 'ALTER' && w1 === 'INDEX')) fail(`${w0} ${w1} 会改表结构，但不在契约认的语句里，没合并`);
  if (hidesTable(st, ctx)) fail('语句开头认不得，里面却有 CREATE TABLE / ALTER TABLE');
  const key = ['CREATE', 'DROP', 'ALTER'].includes(w0) ? `${w0} ${w1}` : w0 || '（非单词开头）';
  ctx.skipped[key] = (ctx.skipped[key] || 0) + 1;
}

function parseFile(file, text, startLine, ctx) {
  const src = text.replace(/^﻿/, ''), { toks, comments, bad } = lex(src, startLine);
  Object.assign(ctx, { file, src, toks, comments, run: null });
  for (const st of statements(toks)) {
    try { dispatch(st, ctx); }
    catch (e) {
      if (!(e instanceof ParseFail)) throw e;
      const t0 = toks[st.a];
      ctx.facts.unparsed.push({ file, line: t0.line, table: null, text: excerpt(src.slice(t0.s, toks[st.b - 1].e)), reason: e.message });
    }
  }
  if (bad) ctx.facts.unparsed.push({ file, line: bad.line, table: null, text: excerpt(src.slice(bad.s)), reason: `${bad.what}没有闭合，从这里到文件末尾都没读` });
}

// 纯函数入口，测试可直接喂文本：sources = [{file, text, startLine?}]，按数组顺序执行（契约 A 节「后面的文件能改前面建的表」）。
// startLine 缺省 1：建表定义是代码文件里的一段字符串时（比如 app/db.py 第 108 行起的 CREATE TABLE orders …），取出的行号都加上 startLine - 1，对回那个代码文件。
// stats 可选：收集略过的非结构语句条数（按开头一两个词计），给入口打提示用。
export function parseSources(sources, stats = {}) {
  const ctx = { facts: emptyFacts(), tables: new Map(), views: new Map(), functions: new Map(), indexNames: new Set(), skipped: stats };
  for (const { file, text, startLine = 1 } of sources) {
    // 传错是调用方的错，不是建表定义读不懂：直接抛，入口按脚本自身出错报退出码 3，不混进「未解析」。
    if (!Number.isInteger(startLine) || startLine < 1) throw new TypeError(`来源 ${file} 的 startLine 该是不小于 1 的整数，现在是 ${JSON.stringify(startLine)}`);
    parseFile(file, text, startLine, ctx);
  }
  ctx.facts.tables = finalizeTables(ctx.tables.values());
  ctx.facts.views = finalizeViews(ctx.views.values());
  ctx.facts.functions = finalizeFunctions(ctx.functions.values());
  return ctx.facts;
}

// 架构稿 §2 的 extract(配置) → 实体：按 config.ddl 的顺序读文件；路径是否存在由入口先查过。
// ddl 里列的代码文件（契约 F 节）排在所有 .sql 之后、按 ddl 里的顺序：它里面含 CREATE TABLE / ALTER TABLE / CREATE INDEX 的字符串字面量
// 逐段当建表定义读，行号对回那个代码文件（切字面量在 code-scan.mjs）；切不动的整个文件记一条「未解析的语句」，不出半截。
export function extract(config, root, stats = {}) {
  const files = config.ddl.map((f) => f.replace(/\\/g, '/')), read = (f) => readFileSync(join(root, f), 'utf8');
  const sources = files.filter((f) => !isCodeFile(f)).map((f) => ({ file: f, text: read(f) })), cut = [];
  for (const f of files.filter(isCodeFile)) {
    const { segments, error } = ddlSegments(f, read(f));
    sources.push(...segments);
    if (error) cut.push({ file: f, line: error.line, table: null, text: error.text, reason: error.reason });
  }
  const facts = parseSources(sources, stats);
  facts.unparsed.push(...cut);
  return facts;
}
