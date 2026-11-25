// sql-constraints.mjs —— 约束：读约束子句、补名、按名字摘除（契约 docs/readable-spec/phase1-db-contract.md B 节「没写名字的约束」）。
// 从 sql-ddl.mjs 拆出来：那边读语句、合并结构，这里管约束子句怎么读、没写名字的约束库里叫什么、按名字删掉一条该清哪个标记。
// 补的名字只在内部用，好让后面的 DROP CONSTRAINT 对得上；它不进输出——库里实际的名字还会被截到 63 字节以内、重名的在后面接数字，
// 静态算不准，写出来就是把推断当事实。所以表级约束的 name 只留源码里写了的名字（没写为 null），补的名字放在 id 上。
// 规矩照 PostgreSQL：主键 <表>_pkey；唯一 <表>_<列…>_key、外键 <表>_<列…>_fkey，多列的把列名用下划线连起来；
// CHECK 出自源码 heap.c 的 AddRelationNewConstraints——表达式恰好点到本表一列的叫 <表>_<列>_check，点到几列或一列都没点到的叫 <表>_check。
// 库只看表达式、不看 CHECK 写在列上还是表上，所以行内的也按这条算：orders 表 qty int CHECK (qty > 0) 叫 orders_qty_check，
// 写在 qty 上的 CHECK (qty <= max_qty) 点到两列，叫 orders_check。截断与重名加数字不模拟：撞上了，按名字删的那条落进「定义冲突」，看得见。
import { fail, fold, Cur, splitTop } from './sql-lex.mjs';

// 删列与改列名时约束跟着走（dropColumnRefs / renameColumnRefs）也在这里；索引那一份在 sql-index.mjs。
// ---- 读约束子句（列上的行内约束由 sql-ddl.mjs 的 parseColumn 读，借用这里的 refs 与 nullsDistinct）----
export const nullsDistinct = (c) => c.eatW('NULLS', 'DISTINCT') || c.eatW('NULLS', 'NOT', 'DISTINCT');
function identList(c) {
  const [a, b] = c.group('这里该是括号里的列名');
  return splitTop(c.t, a, b).map(([x, y]) => { if (y - x !== 1) fail('括号里该是一串列名'); return new Cur(c.x, x, y).ident(); });
}
function refAction(c) {
  const a = c.i;
  if (c.eatW('NO', 'ACTION') || c.eatW('CASCADE') || c.eatW('RESTRICT')) { /* 动作只有一两个词 */ }
  else if (c.eatW('SET', 'NULL') || c.eatW('SET', 'DEFAULT')) { if (c.isOp('(')) c.group(); }
  else fail(`ON DELETE / ON UPDATE 后的「${c.word()}」读不懂`);
  return c.raw(a, c.i).replace(/\s+/g, ' ').toUpperCase();
}
export function refs(c) {
  c.needW('REFERENCES');
  const table = c.qname().at(-1), columns = c.isOp('(') ? identList(c) : null;
  let onDelete = null, onUpdate = null;
  for (;;) {
    if (c.eatW('MATCH')) c.next();
    else if (c.eatW('ON', 'DELETE')) onDelete = refAction(c);
    else if (c.eatW('ON', 'UPDATE')) onUpdate = refAction(c);
    else if (c.eatW('INITIALLY')) c.next();
    else if (!(c.eatW('DEFERRABLE') || c.eatW('NOT', 'DEFERRABLE'))) break;
  }
  return { table, columns, onDelete, onUpdate };
}

// CHECK 括号 [a,b) 里的名字：不带引号的折小写、带引号的原样。补名时拿来数点到了本表哪几列；函数名、关键字不是本表的列，数的时候自然滤掉。
export const checkIdents = (c, a, b) => c.t.slice(a, b).filter((t) => t.k === 'w' || t.k === 'q')
  .map((t) => (t.k === 'q' ? t.name : fold(c.x.src.slice(t.s, t.e))));

export function tableConstraint(c) {
  const cs = c.i; let name = null;
  if (c.eatW('CONSTRAINT')) name = c.ident();
  const con = { name, type: null, columns: [], references: null, check: null };
  if (c.eatW('PRIMARY', 'KEY')) { con.type = 'primary key'; con.columns = identList(c); }
  else if (c.eatW('UNIQUE')) { nullsDistinct(c); con.type = 'unique'; con.columns = identList(c); }
  else if (c.eatW('FOREIGN', 'KEY')) { con.type = 'foreign key'; con.columns = identList(c); con.references = refs(c); }
  else if (c.isW('CHECK')) {
    const ks = c.i++, [a, b] = c.group('CHECK 后面该是括号'); c.eatW('NO', 'INHERIT'); con.type = 'check'; con.check = c.raw(ks, c.i);
    con.idents = checkIdents(c, a, b);
  } else fail(`表级约束「${c.word()}」不在契约认的范围（只认 PRIMARY KEY / UNIQUE / FOREIGN KEY / CHECK）`);
  while (c.eatW('NOT', 'VALID') || c.eatW('DEFERRABLE') || c.eatW('NOT', 'DEFERRABLE') || (c.eatW('INITIALLY') && c.next())) { /* 不改结构的修饰 */ }
  c.end();
  con.raw = c.raw(cs, c.i);
  return con;
}

// ---- 补名与摘除 ----
const SUFFIX = { unique: 'key', 'foreign key': 'fkey' };

// names 是本表此刻的全部列名（ALTER TABLE … ADD COLUMN 时含正在加的这一列）。
function autoName(table, type, cols, idents, names) {
  if (type === 'primary key') return `${table}_pkey`;
  if (type !== 'check') return [table, ...cols, SUFFIX[type]].join('_');
  const hit = [...new Set(idents.filter((n) => names.includes(n)))];
  return hit.length === 1 ? `${table}_${hit[0]}_check` : `${table}_check`;
}

// 列上的行内约束各自留一份（类型、写了的名字、内部名 id、CHECK 原文），按名字摘掉一条时才知道该清哪个标记。行内约束的名字本来就不进输出。
export const nameInline = (col, table, names) => col.inl.forEach((x) => { x.id = x.name ?? autoName(table, x.type, [col.name], x.idents, names); });
export const nameConstraint = (con, table, names) => { con.id = con.name ?? autoName(table, con.type, con.columns, con.idents, names); };
export const checkText = (inl) => { const p = inl.filter((x) => x.type === 'check').map((x) => x.raw); return p.length ? p.join(' ') : null; };

// 按名字摘约束：先找表级的，再找列上的行内约束，都按内部名 id 比；摘到返回 true。主键摘掉后可空性不动（库里列上的 NOT NULL 留着）。
export function dropConstraint(t, n) {
  const k = t.constraints.findIndex((o) => o.id === n);
  if (k >= 0) {
    const [o] = t.constraints.splice(k, 1);
    if (o.type === 'primary key') o.columns.forEach((cn) => { const col = t.columns.find((x) => x.name === cn); if (col) col.primaryKey = false; });
    return true;
  }
  for (const col of t.columns) {
    const j = col.inl.findIndex((x) => x.id === n); if (j < 0) continue;
    const [x] = col.inl.splice(j, 1);
    if (x.type === 'primary key') col.primaryKey = false;
    else if (x.type === 'unique') col.unique = col.inl.some((y) => y.type === 'unique');
    else if (x.type === 'foreign key') col.references = null;
    else col.check = checkText(col.inl);
    return true;
  }
  return false;
}

// DROP CONSTRAINT IF EXISTS 名 没对上任何约束：先记一笔待定；之后本表又加了同名的约束（「先删再加」的幂等写法），这笔就销掉。
// 剩下的进那张表的 maybeDropped（契约 B 节）——库里自动起的名字可能被截短或加了数字，这条语句也许真删掉了什么，静态看不出来。
export const settleDrop = (t, id) => { if (id) t.maybeDropped = t.maybeDropped.filter((d) => d.name !== id); };

// ---- 删列、改列名的连带（契约 B 节）：库里就是这么做的，不跟着改就是把不存在的约束、改掉的列名标成「取自来源」 ----
const has = (list, n) => (list ?? []).includes(n);
const swap = (list, from, to) => list && list.map((x) => (x === from ? to : x));

// 删一列：点到它的表级约束（列清单里有它，或 CHECK 的表达式点到它）一并摘掉，被摘的是主键时其余列的主键标记也清掉；
// 别的列上的行内 CHECK 点到它的同样摘掉——库只看表达式、不看 CHECK 写在哪（同上面补名那条）。可空性不动，理由同 dropConstraint。
export function dropColumnRefs(t, n) {
  const gone = t.constraints.filter((o) => has(o.columns, n) || (o.type === 'check' && has(o.idents, n)));
  t.constraints = t.constraints.filter((o) => !gone.includes(o));
  for (const o of gone) if (o.type === 'primary key') o.columns.forEach((cn) => { const col = t.columns.find((x) => x.name === cn); if (col) col.primaryKey = false; });
  for (const col of t.columns) {
    const keep = col.inl.filter((x) => !(x.type === 'check' && has(x.idents, n)));
    if (keep.length !== col.inl.length) { col.inl = keep; col.check = checkText(keep); }
  }
}

// 改列名：本表约束的列清单与 CHECK 点到的名字、别的表（含本表自引用）外键指向它的列名一并改。补出来的内部名 id 不动——库里也不改它。
// 约束的 raw 与列上 references.raw、CHECK 原文是源码原文，照旧不改。
export function renameColumnRefs(tables, t, from, to) {
  for (const o of t.constraints) { o.columns = swap(o.columns, from, to); o.idents = swap(o.idents, from, to); }
  for (const col of t.columns) for (const x of col.inl) x.idents = swap(x.idents, from, to);
  for (const o of tables) {
    for (const k of o.constraints) if (k.references?.table === t.name && has(k.references.columns, from)) k.references = { ...k.references, columns: swap(k.references.columns, from, to) };
    for (const col of o.columns) if (col.references?.table === t.name && col.references.column === from) col.references = { ...col.references, column: to };
  }
}

// ---- 记清单（sql-ddl.mjs 与 sql-index.mjs 共用）----
export const conflict = (ctx, at, table, column, kind, reason) => ctx.facts.conflicts.push({ file: ctx.file, line: at.line, table, column, kind, reason, text: at.text });
export const orphan = (ctx, at, table) => ctx.facts.orphanAlters.push({ file: ctx.file, line: at.line, table, text: at.text });
