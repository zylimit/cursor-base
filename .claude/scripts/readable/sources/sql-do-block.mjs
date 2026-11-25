// sql-do-block.mjs —— DO 块（契约 docs/readable-spec/phase1-db-contract.md B 节「DO 块里读得出的那一种要并进来」「读不出的要说」）。
// 从 sql-ddl.mjs 拆出来：那边认顶层语句、合并结构，这里认 DO 块——哪几条守卫着的静态语句交回那边并进来，剩下的记进「未合并的动态定义」。
// DO 块是运行时才执行的过程代码，一般静态合并不了；但 PostgreSQL 的 ADD CONSTRAINT 没有 IF NOT EXISTS，常见的幂等写法是
//   IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_items_order') THEN ALTER TABLE order_items ADD CONSTRAINT fk_items_order …; END IF;
// 守卫只为重复执行不报错，执行完那条约束一定在。所以只认这一种形状：块最外层语句序列里的 IF，条件恰是 NOT EXISTS (查系统表)、
// 没有 ELSIF / ELSE、里面不再套判断或循环；其中自身完整、静态的 ALTER TABLE / CREATE [UNIQUE] INDEX 照顶层语句并进来，已有同名的跳过。
// 别的一律不并：EXECUTE 拼的、循环里的、按条件删的（IF EXISTS）、守卫查的不是系统表的、嵌了两层判断的、外层带 EXCEPTION 的（出错被吞掉，
// 执行完那条在不在说不准）。拿不准的宁可不并——进「未合并」是明着告诉读者，并错了是把推断当事实。
// 实数（2026-11-23）：下游一个项目的建表文件里 102 条 ADD CONSTRAINT 有 87 条是守卫式写的（47 外键、30 唯一、9 CHECK），不并时整组表的关系图是空的。
import { excerpt } from '../model.mjs';
import { ParseFail, lex, fold, unquote, Cur } from './sql-lex.mjs';
import { findIndex } from './sql-index.mjs';

// ---- 认块的结构：只为找出最外层的守卫。读不懂抛 Odd，整块一条不并，照旧整块进「未合并」——Odd 只在本文件里抛、本文件里接 ----
class Odd extends Error {}
const odd = () => { throw new Odd('DO 块的结构读不懂'); };
const ENDERS = new Set(['END', 'ELSIF', 'ELSEIF', 'ELSE', 'EXCEPTION', 'WHEN']);

function blockShape(T) {
  const n = T.length, up = (k) => T[k]?.up, isOp = (k, v) => T[k]?.k === 'op' && T[k].v === v;
  // 从 k 起找深度 0 的 stop（一个词或分号）；找的是词却先撞上分号，就是读不懂
  const until = (k, stop) => {
    for (let d = 0; k < n; k++) {
      const t = T[k];
      if (t.k === 'op') {
        if (t.v === '(' || t.v === '[') d++;
        else if (t.v === ')' || t.v === ']') d--;
        else if (!d && t.v === ';') return stop === ';' ? k : odd();
      } else if (!d && stop !== ';' && t.up === stop) return k;
    }
    return odd();
  };
  const label = (k) => (isOp(k, '<') && isOp(k + 1, '<') && T[k + 2]?.k === 'w' && isOp(k + 3, '>') && isOp(k + 4, '>') ? k + 5 : k);
  // END [IF | LOOP | CASE] [标签] ;——最外层块的 END 后面可以直接是块尾
  const close = (k, word, last = false) => {
    if (up(k) !== 'END') odd(); k++;
    if (word) { if (up(k) !== word) odd(); k++; } else if (['IF', 'LOOP', 'CASE'].includes(up(k))) odd();
    if (word !== 'IF' && word !== 'CASE' && T[k]?.k === 'w') k++;
    if (isOp(k, ';')) return k + 1;
    return last && k === n ? k : odd();
  };
  // 一串语句，停在语句开头的 END / ELSIF / ELSE / EXCEPTION / WHEN 上；out 收这一层的每条
  const seq = (k, out) => { while (k < n && !ENDERS.has(up(k))) { const s = stmt(k); out?.push(s); k = s.next; } return k; };
  function block(k, last) {
    if (up(k) === 'DECLARE') { k++; while (k < n && up(k) !== 'BEGIN') k = until(k, ';') + 1; }
    if (up(k) !== 'BEGIN') odd();
    const items = []; let e = seq(k + 1, items), caught = false;
    if (up(e) === 'EXCEPTION') { caught = true; e++; while (up(e) === 'WHEN') e = seq(until(e + 1, 'THEN') + 1); }
    return { items, caught, next: close(e, null, last) };
  }
  function stmt(a) {
    const k = label(a), u = up(k);
    if (u === 'IF') {
      const h = until(k + 1, 'THEN'), body = []; let e = seq(h + 1, body), arms = 1;
      while (up(e) === 'ELSIF' || up(e) === 'ELSEIF') { arms++; e = seq(until(e + 1, 'THEN') + 1); }
      if (up(e) === 'ELSE') { arms++; e = seq(e + 1); }
      return { kind: 'if', cond: [k + 1, h], body, arms, next: close(e, 'IF') };
    }
    if (u === 'CASE') {
      let e = until(k + 1, 'WHEN');
      while (up(e) === 'WHEN') e = seq(until(e + 1, 'THEN') + 1);
      if (up(e) === 'ELSE') e = seq(e + 1);
      return { kind: 'case', next: close(e, 'CASE') };
    }
    if (u === 'LOOP') return { kind: 'loop', next: close(seq(k + 1), 'LOOP') };
    if (u === 'FOR' || u === 'WHILE' || u === 'FOREACH') return { kind: 'loop', next: close(seq(until(k + 1, 'LOOP') + 1), 'LOOP') };
    if (u === 'DECLARE' || u === 'BEGIN') return { kind: 'block', next: block(k, false).next };
    const b = until(k, ';');
    return { kind: 'simple', a: k, b, next: b + 1 };
  }
  const top = block(label(0), true);
  if (top.next !== n) odd();
  return top;
}
function shapeOf(T) {
  try { return blockShape(T); } catch (e) { if (e instanceof Odd) return null; throw e; }
}

// ---- 认守卫与静态语句 ----
const SYS = new Set(['pg_constraint', 'pg_indexes', 'pg_class']);
// 条件恰是 NOT EXISTS ( SELECT … )，里面每个 FROM 后面都是认的系统表（information_schema 下的任一张也算）、没有 JOIN、FROM 后面不跟逗号。
// pg_catalog.pg_constraint 这类带前缀的、FROM 里连着别的表的都不认（契约只写了这几张）。
function sysGuard(T, src, [x, y]) {
  const isOp = (k, v) => T[k]?.k === 'op' && T[k].v === v;
  const name = (t) => (t?.k === 'w' ? fold(src.slice(t.s, t.e)) : t?.k === 'q' ? t.name : null);
  if (T[x]?.up !== 'NOT' || T[x + 1]?.up !== 'EXISTS' || !isOp(x + 2, '(') || !isOp(y - 1, ')')) return false;
  for (let k = x + 2, d = 0; k < y - 1; k++) {
    if (isOp(k, '(') || isOp(k, '[')) d++; else if ((isOp(k, ')') || isOp(k, ']')) && --d === 0) return false; // 括号在 y-1 之前就合上了
  }
  if (T[x + 3]?.up !== 'SELECT') return false;
  let froms = 0;
  for (let k = x + 3; k < y - 1; k++) {
    if (T[k].up === 'JOIN') return false;
    if (T[k].up !== 'FROM') continue;
    froms++; let m = k + 1; const nm = name(T[m]);
    if (nm === 'information_schema' && isOp(m + 1, '.') && name(T[m + 2])) m += 3;
    else if (SYS.has(nm) && !isOp(m + 1, '.')) m++;
    else return false;
    if (T[m]?.up === 'AS') m++;
    if (T[m]?.k === 'w' && T[m].up !== 'WHERE') m++; // 别名
    if (m < y - 1 && T[m].up !== 'WHERE' && !isOp(m, ')')) return false;
  }
  return froms > 0;
}
// 自身完整的静态 ALTER TABLE / CREATE [UNIQUE] INDEX：不带 %I / %s 一类占位、不带 $1 一类参数
function staticDdl(T, a, b) {
  const [u0, u1, u2] = [T[a]?.up, T[a + 1]?.up, T[a + 2]?.up];
  if (!((u0 === 'ALTER' && u1 === 'TABLE') || (u0 === 'CREATE' && (u1 === 'INDEX' || (u1 === 'UNIQUE' && u2 === 'INDEX'))))) return false;
  for (let k = a; k < b; k++) {
    const t = T[k];
    if (t.k === 'w' && t.up[0] === '$') return false;
    if (t.k === 'op' && t.v === '%' && T[k + 1]?.k === 'w' && T[k + 1].s === t.e) return false;
  }
  return true;
}

// 守卫着的静态语句逐条交给 apply（sql-ddl.mjs 那条跟顶层一样的路，at.guarded 为真：已有同名的跳过、不记冲突），返回真正并进来的那几条在块体里的区间。
// 读不懂的（整条或其中一个动作进了「未解析」）不算并进来：块照旧进「未合并」，head 落在它上面。改了不存在的表、定义冲突照顶层记，算处理过。
// 交回去之前把 ctx 的原文、词、注释换成块体的：块体从引号那一行起切词，行号就是它在文件里的真实行号；完了换回来。
function mergeGuarded(ctx, body, L, apply) {
  const top = L.bad ? null : shapeOf(L.toks);
  if (!top || top.caught) return [];
  const T = L.toks, done = [], saved = { src: ctx.src, toks: ctx.toks, comments: ctx.comments };
  Object.assign(ctx, { src: body, toks: T, comments: L.comments });
  try {
    for (const g of top.items) {
      if (g.kind !== 'if' || g.arms !== 1 || !sysGuard(T, body, g.cond) || g.body.some((s) => s.kind !== 'simple')) continue;
      ctx.run = null; // 改动备注只在同一个守卫里往下接
      for (const s of g.body) {
        if (!staticDdl(T, s.a, s.b)) continue;
        const first = T[s.a], was = ctx.facts.unparsed.length, next = s.b + 1 < T.length ? T[s.b + 1].s : Infinity;
        const at = { line: first.line, text: excerpt(body.slice(first.s, T[s.b - 1].e)), next, guarded: true };
        try { apply({ a: s.a, b: s.b, gap: T[s.a - 1].e, next }, ctx, at); }
        catch (e) { if (!(e instanceof ParseFail)) throw e; ctx.facts.unparsed.push({ file: ctx.file, line: first.line, table: null, text: at.text, reason: e.message }); }
        if (ctx.facts.unparsed.length === was) done.push([first.s, T[s.b].e]);
      }
    }
  } finally { Object.assign(ctx, saved); ctx.run = null; }
  return done;
}

// ---- 没并进来的：块里出现契约列的五种碰表结构的语句（ALTER / CREATE / DROP TABLE、CREATE / DROP INDEX）才进「未合并的动态定义」，
// 带上点到的表名，页面好在那几张表上挂提示；只有 CREATE ROLE 一类的块不是表结构，照旧计进「略过」（契约 B 节）。
// 动态 SQL 写在字符串里（EXECUTE format('ALTER TABLE %I …')），所以扫块的正文原文，只把 -- 注释与并进来的语句抹成空格。
const DYNAMIC = '动态表名';
const DO_HIT = /\b(ALTER|CREATE|DROP)\s+(?:(TABLE)|(?:UNIQUE\s+)?INDEX)\b/gi;
const DO_NAME = /\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:ONLY\s+)?((?:"(?:[^"]|"")*"|[^\s"(),;'])+)/iy;
function nameAt(s, from) { // 名字是 %I / %s / $1 / 字符串拼接一类占位的记成「动态表名」；模式前缀丢弃
  DO_NAME.lastIndex = from; const m = DO_NAME.exec(s);
  if (!m || /[%$|]/.test(m[1].replace(/"(?:[^"]|"")*"/g, ''))) return DYNAMIC;
  const last = m[1].match(/(?:"(?:[^"]|"")*"|[^."]+)$/)?.[0] ?? '';
  return (last.startsWith('"') ? last.slice(1, -1).replace(/""/g, '"') : fold(last)) || DYNAMIC;
}
const blank = (s, a, b) => s.slice(0, a) + ' '.repeat(b - a) + s.slice(b);

// 返回 true 表示这条 DO 语句处理过了（并进来了、或进了「未合并」），false 交回分拣计进「略过」。
export function doBlock(st, ctx, at, apply) {
  const q = ctx.toks.slice(st.a + 1, st.b).find((t) => t.k === 'dollar' || t.k === 'str');
  const body = q ? unquote(q, new Cur(ctx, st.a, st.b)) : ctx.src.slice(ctx.toks[st.a].e, ctx.toks[st.b - 1].e);
  // 只有 $…$ 引起来、语言是 plpgsql 的块体才逐字对得上原文（'…' 里有 '' 转义），行号从引号那一行起算
  const rest = ctx.toks.slice(st.a + 1, st.b).filter((t) => t !== q);
  const plpgsql = !rest.length || (rest.length === 2 && rest[0].up === 'LANGUAGE' && /^'?plpgsql'?$/i.test(ctx.src.slice(rest[1].s, rest[1].e)));
  const L = q?.k === 'dollar' && plpgsql ? lex(body, q.line) : null;
  const merged = L ? mergeGuarded(ctx, body, L, apply) : [];
  let scan = body;
  for (const cm of (L ?? lex(body)).comments) scan = blank(scan, cm.s, cm.e);
  for (const [a, b] of merged) scan = blank(scan, a, b);
  const tables = [], add = (n) => { if (n && !tables.includes(n)) tables.push(n); };
  let head = -1;
  for (const m of scan.matchAll(DO_HIT)) {
    const verb = m[1].toUpperCase(), end = m.index + m[0].length;
    if (verb === 'ALTER' && !m[2]) continue; // ALTER INDEX 不在契约列的五种里
    if (head < 0) head = m.index;
    if (m[2]) add(nameAt(scan, end));
    else if (verb === 'DROP') { const n = nameAt(scan, end); add(n === DYNAMIC ? n : findIndex(ctx, n)?.t.name); }
    else { const on = /\bON\b/gi; on.lastIndex = end; const o = on.exec(scan); add(o ? nameAt(scan, o.index + 2) : DYNAMIC); }
  }
  if (head < 0) return merged.length > 0;
  ctx.facts.unfolded.push({ file: ctx.file, line: at.line, head: excerpt(body.slice(head)), tables });
  return true;
}
