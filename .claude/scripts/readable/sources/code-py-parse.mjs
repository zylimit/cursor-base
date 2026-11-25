// code-py-parse.mjs —— 认接口时用的几样 Python 小解析：配对的括号、调用的实参、字符串的值、模块级的字符串常量、引进来的名字、
// 缩进进去的块到哪结束、装饰器后面的处理函数与它的说明（第三期契约 docs/readable-spec/phase3-arch-contract.md B 节「接口」）。
// 为什么单拆出来：code-routes.mjs 只留「哪个名字是哪个路由器、一路挂在哪、完整路径拼不拼得出」，单个文件别超过三百行。
// 都只在 code-lex.mjs 切出的「代码」上做（注释与字符串正文已抹成空格），不跑被扫的代码。
import { posix } from 'node:path';
import { sticky } from './code-lex.mjs';
import { PY_NAME, PY_DOTTED, PY_IMPORT, PY_FROM, dotted, pyStatements, cleandoc } from './code-resolve.mjs';

const N = PY_NAME;
export const KW = new Set(['else', 'try', 'finally', 'except']); // 后面紧跟冒号的关键字：else: x = … 里的冒号不是类型标注
const CONST = new RegExp(`(?:^|\\n)(${N})[ \\t]*(?::[^=\\n]*)?=(?!=)[ \\t]*`, 'g'); // 模块级（不缩进）的赋值
const IDENT = new RegExp(`(?<![\\w.\\u0080-\\uffff])${N}`, 'g'); // 一个名字（属性 a.x 的 x 不算）
const ASSIGN = /[ \t]*(?::[^=\n]*)?(?:[-+*/%@&|^]|\/\/|\*\*|>>|<<)?=(?!=)/y; // 名字后面接 =、+= 一类、或带标注的 =
const GLOBAL = /(?:^|\n)[ \t]*global[ \t]([^\n]*)/g;
const WORDS = /[\w\u0080-￿]+/g;
const HANDLER = new RegExp(`(?:async[ \\t]+)?def[ \\t]+(${N})[ \\t]*\\(`, 'y');
const KWARG = new RegExp(`(${N})\\s*=(?!=)\\s*`, 'y');
const AS_IMPORT = new RegExp(`^(${PY_DOTTED})(?:\\s+as\\s+(${N}))?$`);
const AS_FROM = new RegExp(`^(${N})(?:\\s+as\\s+(${N}))?$`);

// ---- 切分：配对的括号、顶层的逗号与加号 ----
export function matchClose(o, open) {
  for (let d = 0, k = open; k < o.length; k++) { const c = o[k]; if (c === '(' || c === '[' || c === '{') d++; else if ((c === ')' || c === ']' || c === '}') && --d === 0) return k; }
  return o.length;
}
export function splitTop(o, s, e, sep) { // [[起, 止]]，两头的空白已去掉
  const out = [];
  const push = (a, b) => { a += sticky(/\s*/y, o, a).length; while (b > a && /\s/.test(o[b - 1])) b--; out.push([a, b]); };
  let d = 0, a = s;
  for (let k = s; k < e; k++) {
    const c = o[k];
    if (c === '(' || c === '[' || c === '{') d++; else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === sep && d === 0) { push(a, k); a = k + 1; }
  }
  push(a, e);
  return out;
}
export function callArgs(o, open) { // 调用的实参：{ kw: 关键字名 | null（位置参数）| '*'（*args、**kw）, s, e }，s 是值的起点
  const close = matchClose(o, open), args = [];
  for (const [s, e] of splitTop(o, open + 1, close, ',')) {
    if (s >= e) continue;
    KWARG.lastIndex = s;
    const k = KWARG.exec(o);
    args.push(k && KWARG.lastIndex <= e ? { kw: k[1], s: KWARG.lastIndex, e } : { kw: o[s] === '*' ? '*' : null, s, e });
  }
  return { args, close };
}

// ---- 值：字面量、同文件模块级只赋过一次的字符串常量、它们用 + 拼起来的 ----
export function litOf({ src, sp }, a, b) { // 正好是一个字符串字面量（f 串、b 串不算）时返回原文，否则 null
  const l = sp.byStart.get(a);
  if (!l || l.end !== b || /[fb]/i.test(src.slice(l.start, l.bs).replace(/["']/g, ''))) return null;
  return src.slice(l.bs, l.be);
}
export function strVal(ctx, s, e) {
  let out = '';
  for (const [a, b] of splitTop(ctx.o, s, e, '+')) {
    const v = a < b ? litOf(ctx, a, b) ?? constOf(ctx, ctx.o.slice(a, b)) : undefined;
    if (v == null) return null;
    out += v;
  }
  return out;
}
// 同文件的常量；不是的话，从别的文件引进来的跟一层：那个文件里它是模块级只赋过一次的字符串字面量才算，那边又是引进来的不再跟（契约 B 节）。
function constOf(ctx, n) {
  if (ctx.consts.has(n)) return ctx.consts.get(n);
  const t = one(ctx.bind.get(n));
  return t?.file ? ctx.info.get(t.file)?.consts.get(t.name) : undefined;
}
// 契约 B 节：模块级只赋值过一次、赋的是一个字符串字面量。别处（函数里、关键字实参、+=、global 里）再出现「名字 =」的算不准——宁可记 null；
// 由 import 引进来的不算本文件的常量，由 constOf 跟到那个文件去查。全文只扫一遍：逐个名字各扫一遍全文，常量一多就随个数平方涨。
export function constsOf(ctx) {
  const { o, sp } = ctx, seen = new Map(), res = new Map();
  for (const m of o.matchAll(CONST)) {
    if (KW.has(m[1])) continue;
    const p = m.index + m[0].length, l = sp.byStart.get(p);
    const v = l && sticky(/[ \t]*(?:\r?\n|;|$)/y, o, l.end) !== null ? litOf(ctx, p, l.end) : null;
    (seen.get(m[1]) ?? seen.set(m[1], []).get(m[1])).push(v);
  }
  const cands = new Set([...seen].filter(([n, vs]) => vs.length === 1 && vs[0] !== null && !ctx.bind.has(n)).map(([n]) => n));
  if (!cands.size) return res;
  // 每个候选在全文里出现「名字 =」的次数；同一个名字的两处不重叠计（标注里又写了这个名字的，从上一处的等号之后接着数）
  const count = new Map(), from = new Map();
  for (const m of o.matchAll(IDENT)) {
    const n = m[0];
    if (!cands.has(n) || m.index < (from.get(n) ?? 0)) continue;
    const t = sticky(ASSIGN, o, m.index + n.length);
    if (t === null) continue;
    count.set(n, (count.get(n) ?? 0) + 1);
    from.set(n, m.index + n.length + t.length);
  }
  const globals = new Set();
  for (const m of o.matchAll(GLOBAL)) for (const w of m[1].match(WORDS) ?? []) globals.add(w);
  for (const n of cands) if (count.get(n) === 1 && !globals.has(n)) res.set(n, seen.get(n)[0]);
  return res;
}

// ---- 引进来的名字：本地名 → { mod: 文件 } | { file, name } | { pkg: [import a.b 的各段] } | {}（外部的、没对上的）----
// 解析的口径同 code-imports.mjs 的 pyAbs / pyRel：from 包 import 子模块时指向子模块文件；绝对引用的起点按这个文件算（code-resolve.mjs）。
export function bindingsOf(file, o, R) {
  const bind = new Map(), put = (n, t) => bind.set(n, [...(bind.get(n) ?? []), t]);
  const dir = posix.dirname(file) === '.' ? [] : posix.dirname(file).split('/');
  for (const [s, e] of pyStatements(o)) {
    const t = o.slice(s, e).replace(/\\\r?\n/g, ' ').trim();
    let m = PY_IMPORT.exec(t);
    if (m) {
      for (const x of m[1].split(',')) {
        const i = AS_IMPORT.exec(x.trim()); if (!i) continue;
        const parts = dotted(i[1]), h = i[2] && R.longest(parts, file);
        if (!i[2]) put(parts[0], { pkg: parts }); else put(i[2], h && h.j === parts.length ? { mod: h.f } : {});
      }
      continue;
    }
    if (!(m = PY_FROM.exec(t))) continue;
    const dots = m[1].length, parts = m[2] ? dotted(m[2]) : [];
    if (dots - 1 > dir.length) continue;
    const base = dots ? dir.slice(0, dir.length - (dots - 1)).join('/') : null;
    for (const x of m[3].trim().replace(/^\(|\)$/g, '').split(',')) {
      const i = AS_FROM.exec(x.trim()); if (!i) continue;
      let to = {};
      if (base !== null) { const sub = R.pyFile(base, [...parts, i[1]]), mod = R.pyFile(base, parts); to = sub ? { mod: sub } : mod ? { file: mod, name: i[1] } : {}; }
      else { const h = R.longest([...parts, i[1]], file); to = !h ? {} : h.j > parts.length ? { mod: h.f } : h.j === parts.length ? { file: h.f, name: i[1] } : {}; }
      put(i[2] ?? i[1], to);
    }
  }
  return bind;
}
export const one = (ts) => ts && (ts.every((t) => JSON.stringify(t) === JSON.stringify(ts[0])) ? ts[0] : {}); // try / except 两路引进同一个才算数

// 缩进进去的路由器（写在函数里的）只管到它所在的块结束：其后第一行缩进比它浅的代码。字符串整段抹掉再数，免得多行串的收尾引号被当成缩进。
export function blockEnd(ctx, from, indent) {
  if (ctx.flat === undefined) { let r = '', p = 0; for (const l of ctx.sp.lits) { r += ctx.o.slice(p, l.start) + ctx.o.slice(l.start, l.end).replace(/[^\n]/g, ' '); p = l.end; } ctx.flat = r + ctx.o.slice(p); }
  const o = ctx.flat;
  for (let d = 0, k = from; k < o.length; k++) {
    const c = o[k];
    if (c === '(' || c === '[' || c === '{') d++; else if (c === ')' || c === ']' || c === '}') d = Math.max(0, d - 1);
    else if (c === '\\' && o[k + 1] === '\n') k++;
    else if (c === '\n' && d === 0) { const w = sticky(/[ \t]*/y, o, k + 1), n = o[k + 1 + w.length]; if (n !== undefined && n !== '\n' && n !== '\r' && w.length < indent) return k + 1; }
  }
  return o.length;
}

// 装饰器之后（隔着别的装饰器照跳）的 def / async def：{ name, body: 函数体起点 }；不是函数的返回 null。
export function handlerAfter(o, close) {
  let k = o.indexOf('\n', close);
  for (;;) {
    if (k < 0) return null;
    k += sticky(/\s*/y, o, k).length;
    if (o[k] !== '@') break;
    for (let d = 0; k < o.length; k++) { const c = o[k]; if (c === '(' || c === '[' || c === '{') d++; else if (c === ')' || c === ']' || c === '}') d--; else if (c === '\n' && d <= 0) break; }
  }
  HANDLER.lastIndex = k;
  const m = HANDLER.exec(o);
  if (!m) return null;
  let p = matchClose(o, HANDLER.lastIndex - 1) + 1;
  for (let d = 0; p < o.length && !(o[p] === ':' && d === 0); p++) { const c = o[p]; if (c === '(' || c === '[' || c === '{') d++; else if (c === ')' || c === ']' || c === '}') d--; }
  return { name: m[1], body: p + 1 };
}
// 函数体第一条语句是字符串字面量时的说明：与文件头说明同一个取法（紧挨着的字面量算一个，f 串、b 串不算，统一缩进同 inspect.cleandoc）。
export function docAt({ src, sp, o }, p) {
  p += sticky(/[ \t]*/y, o, p).length;
  if (o[p] === '\n' || o[p] === '\r') p += sticky(/\s*/y, o, p).length;
  let body = '', q = p, l;
  while ((l = sp.byStart.get(q))) {
    if (/[fb]/i.test(src.slice(l.start, l.bs).replace(/["']/g, ''))) return null;
    body += src.slice(l.bs, l.be);
    q = l.end + sticky(/[ \t]*/y, o, l.end).length;
  }
  if (q === p || (q < o.length && !/[\r\n;]/.test(o[q]))) return null;
  return cleandoc(body.split(/\r?\n/), true);
}
