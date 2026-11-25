// sql-index.mjs —— 索引：建、补内部名、按名字删、删列与改列名的连带（契约 docs/readable-spec/phase1-db-contract.md B 节）。
// 从 sql-ddl.mjs 拆出来：那边认语句、合并结构，这里管索引这一块。读不懂一律抛 ParseFail，由 sql-ddl.mjs 按语句兜住进「未解析」。
import { Cur, fail, fold, lex, splitTop } from './sql-lex.mjs';
import { checkIdents, conflict, orphan } from './sql-constraints.mjs';

// 没写名字的索引，库里叫 <表>_<列…>_idx（PostgreSQL 的 ChooseIndexName：唯一索引也是 _idx，_key 只给约束）。
// 每一项是列就取列名、是函数调用取函数名（同库里的 FigureIndexColname），别的表达式取 expr。
// 只在内部用，好让后面的 DROP INDEX 对得上：CREATE INDEX ON m (a) 之后的 DROP INDEX IF EXISTS m_a_idx 删的就是它。
// 输出里 name 仍为 null——截到 63 字节、重名接数字不模拟，同约束的补名（sql-constraints.mjs 开头）。
function autoName(c, table, a, b) {
  const part = ([x, y]) => {
    let k = x; while (k < y && c.t[k].k === 'op' && c.t[k].v === '(') k++;
    const t = c.t[k], nx = c.t[k + 1];
    if (!t || (t.k !== 'w' && t.k !== 'q')) return 'expr';
    // 外面套了括号的是表达式：(lower(email)) 取函数名，(a) 取列名，((a + b)) 这类取 expr
    if (k > x && !(k + 1 < y && nx.k === 'op' && (nx.v === '(' || nx.v === ')'))) return 'expr';
    return t.k === 'q' ? t.name : fold(c.x.src.slice(t.s, t.e));
  };
  return [table, ...splitTop(c.t, a, b).map(part), 'idx'].join('_');
}

export function createIndex(st, ctx, at) {
  const c = new Cur(ctx, st.a + 1, st.b);
  const unique = c.eatW('UNIQUE'); c.needW('INDEX'); c.eatW('CONCURRENTLY');
  const ine = c.eatW('IF', 'NOT', 'EXISTS'), name = c.isW('ON') ? null : c.qname().at(-1);
  c.needW('ON'); c.eatW('ONLY');
  const table = c.qname().at(-1), method = c.eatW('USING') ? c.ident() : null;
  const [a, b] = c.group('ON 表名后面该是括号里的索引列'), os = c.i;
  if (a === b) fail('索引的列是空的');
  while (!c.done() && !c.isW('WHERE')) { if (c.isOp('(')) c.group(); else c.i++; }
  const options = c.i > os ? c.raw(os, c.i) : null; let where = null, idents = checkIdents(c, a, b);
  if (c.eatW('WHERE')) { if (c.done()) fail('WHERE 后面是空的'); where = c.raw(c.i, c.j); idents = [...idents, ...checkIdents(c, c.i, c.j)]; }
  const t = ctx.tables.get(table);
  if (!t) return orphan(ctx, at, table);
  // DO 块里守卫着的（at.guarded，sql-do-block.mjs）同 IF NOT EXISTS：已有同名的跳过、不记冲突。
  if (name && ctx.indexNames.has(name)) { if (!ine && !at.guarded) conflict(ctx, at, table, null, 'index-exists', `索引 ${name} 已经有了，保留先前的定义`); return; }
  if (name) ctx.indexNames.add(name);
  // idents 是列与 WHERE 里点到的名字：删列时点到它的索引一并摘掉（库里部分索引的条件点到这一列也算依赖）。
  t.indexes.push({ name, id: name ?? autoName(c, table, a, b), unique, method, columns: c.raw(a, b), options, where, idents, file: ctx.file, line: at.line });
}

// 按名字找索引：先认写了的名字，再认补的内部名——两个没写名字的索引补出同一个内部名时（库里第二个会接数字），删掉先建的那个。
export function findIndex(ctx, n) {
  for (const key of ['name', 'id']) for (const t of ctx.tables.values()) { const x = t.indexes.find((o) => o[key] === n); if (x) return { t, x }; }
  return null;
}
const unlink = (ctx, t, x) => { t.indexes = t.indexes.filter((o) => o !== x); if (x.name) ctx.indexNames.delete(x.name); };

// DROP INDEX [CONCURRENTLY] [IF EXISTS] 名[, …]：按名字摘掉索引；找不到的，带 IF EXISTS 跳过，不带的记冲突。
export function dropIndex(st, ctx, at) {
  const c = new Cur(ctx, st.a + 2, st.b);
  c.eatW('CONCURRENTLY'); const ie = c.eatW('IF', 'EXISTS'), names = [c.qname().at(-1)];
  while (c.isOp(',')) { c.i++; names.push(c.qname().at(-1)); }
  if (!c.eatW('CASCADE')) c.eatW('RESTRICT'); c.end();
  for (const n of names) {
    const hit = findIndex(ctx, n);
    if (hit) unlink(ctx, hit.t, hit.x);
    else if (!ie) conflict(ctx, at, null, null, 'index-missing', `索引 ${n} 不存在，这一步没合并`);
  }
}

// 删一列：列或 WHERE 点到它的索引一并摘掉（契约 B 节）。
export const dropColumnIndexes = (ctx, t, n) => t.indexes.filter((x) => x.idents.includes(n)).forEach((x) => unlink(ctx, t, x));

// 改列名：索引的 columns 就是那段列的原文，只好把里面点到旧名的名字换成新名（后面紧跟左括号的是函数名，不换）；WHERE 同样。
// 换上去的名字照库里显示的规矩：只有小写字母、数字、下划线的不加引号，别的加双引号。
const quoteIdent = (n) => (/^[a-z_][a-z0-9_$]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`);
function renameIn(text, from, to) {
  if (text === null) return null;
  const { toks } = lex(text); let out = text;
  for (let k = toks.length - 1; k >= 0; k--) {
    const t = toks[k], nx = toks[k + 1];
    const hit = t.k === 'w' ? fold(text.slice(t.s, t.e)) === from : t.k === 'q' && t.name === from;
    if (hit && !(nx?.k === 'op' && nx.v === '(')) out = out.slice(0, t.s) + quoteIdent(to) + out.slice(t.e);
  }
  return out;
}
export function renameIndexColumns(t, from, to) {
  for (const x of t.indexes) {
    if (!x.idents.includes(from)) continue;
    x.columns = renameIn(x.columns, from, to); x.where = renameIn(x.where, from, to); x.idents = x.idents.map((n) => (n === from ? to : n));
  }
}
