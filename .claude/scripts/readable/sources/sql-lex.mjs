// sql-lex.mjs —— 建表定义的切词与切语句（契约 docs/readable-spec/phase1-db-contract.md B 节「切语句」；方言以 PostgreSQL 为准）。
// 只管把原文切成词与语句、给解析器一个游标；认哪些语句、怎么合并在 sql-ddl.mjs。
// 读不懂一律抛 ParseFail，由调用方按语句兜住进「未解析」；别的异常是本脚本的错，不在这里吞。

export class ParseFail extends Error {}
export const fail = (why) => { throw new ParseFail(why); };

// ---- 切词：-- 与 /* */（可嵌套）注释、'…'（'' 转义，E'…' 另认反斜杠）、"…" 名字、$$…$$ 与 $标签$…$标签$ ----
const DOLLAR = /\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/y;
const WORD = /[A-Za-z_\u0080-￿][\w$\u0080-￿]*|\$\d+/y;
const NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

// line0 是原文第一行的行号（缺省 1）：建表定义取自代码文件里的一段字符串时，从那段字符串所在的行数起，取出的行号才对得回那个代码文件。
export function lex(src, line0 = 1) {
  const toks = [], comments = [], n = src.length;
  let i = 0, line = line0, bad = null;
  const skipTo = (end) => { for (let p = i; p < end; p++) if (src.charCodeAt(p) === 10) line++; i = end; };
  const sticky = (re) => { re.lastIndex = i; const m = re.exec(src); return m ? m[0] : null; };
  const unclosed = (what) => { bad ??= { line, s: i, what }; return n; };
  const closeQuote = (q, from, backslash) => {
    for (let p = from; p < n; p++) {
      if (backslash && src[p] === '\\') { p++; continue; }
      if (src[p] === q) { if (src[p + 1] === q) { p++; continue; } return p + 1; }
    }
    return -1;
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (c <= ' ' || c === '﻿') { i++; continue; }
    if (c === '-' && d === '-') {
      let e = src.indexOf('\n', i); if (e < 0) e = n;
      let p = i - 1; while (p >= 0 && (src[p] === ' ' || src[p] === '\t')) p--;
      comments.push({ s: i, e, line, full: p < 0 || src[p] === '\n', text: src.slice(i + 2, e).trim() });
      i = e; continue;
    }
    if (c === '/' && d === '*') {
      let depth = 0, p = i;
      while (p < n) {
        if (src[p] === '/' && src[p + 1] === '*') { depth++; p += 2; }
        else if (src[p] === '*' && src[p + 1] === '/') { depth--; p += 2; if (!depth) break; }
        else p++;
      }
      skipTo(depth ? unclosed('块注释') : p); continue;
    }
    let k = 'op', end, m;
    if (c === "'" || ((c === 'E' || c === 'e') && d === "'")) {
      const p = closeQuote("'", i + (c === "'" ? 1 : 2), c !== "'"); end = p < 0 ? unclosed('单引号字符串') : p; k = 'str';
    } else if (c === '"') {
      const p = closeQuote('"', i + 1, false); end = p < 0 ? unclosed('双引号名字') : p; k = 'q';
    } else if (c === '$' && (m = sticky(DOLLAR))) {
      const p = src.indexOf(m, i + m.length); end = p < 0 ? unclosed('$ 引号块') : p + m.length; k = 'dollar';
    } else if ((m = sticky(WORD))) { end = i + m.length; k = 'w'; }
    else if ((m = sticky(NUM))) { end = i + m.length; k = 'num'; }
    else end = i + (c === ':' && d === ':' ? 2 : 1);
    const t = { k, s: i, e: end, line };
    if (k === 'w') t.up = src.slice(i, end).toUpperCase();
    else if (k === 'q') t.name = src.slice(i + 1, end - 1).replace(/""/g, '"');
    else if (k === 'op') t.v = src.slice(i, end);
    skipTo(end); t.endLine = line; toks.push(t);
  }
  return { toks, comments, bad };
}

// 以分号切语句；每条记下标区间 [a,b)、上一个分号之后的位置（找语句上方注释用）、下一条语句的开头（找行尾注释用）。
export function statements(toks) {
  const out = []; let a = 0, gap = 0;
  for (let k = 0; k <= toks.length; k++) {
    if (k < toks.length && !(toks[k].k === 'op' && toks[k].v === ';')) continue;
    if (k > a) out.push({ a, b: k, gap });
    if (k < toks.length) { gap = toks[k].e; a = k + 1; }
  }
  out.forEach((st, j) => { st.next = j + 1 < out.length ? toks[out[j + 1].a].s : Infinity; });
  return out;
}

// PostgreSQL 只把不带引号名字里的 ASCII 字母折成小写，带引号的原样。
export const fold = (s) => s.replace(/[A-Z]+/g, (x) => x.toLowerCase());

export class Cur {
  constructor(ctx, i, j) { this.x = ctx; this.t = ctx.toks; this.i = i; this.j = j; }
  done() { return this.i >= this.j; }
  peek() { return this.i < this.j ? this.t[this.i] : null; }
  isW(...ws) { return ws.every((w, o) => this.i + o < this.j && this.t[this.i + o].up === w); }
  eatW(...ws) { if (!this.isW(...ws)) return false; this.i += ws.length; return true; }
  needW(...ws) { if (!this.eatW(...ws)) fail(`这里该是 ${ws.join(' ')}，却是「${this.word()}」`); }
  isOp(v) { const t = this.peek(); return t?.k === 'op' && t.v === v; }
  next() { if (this.done()) fail('语句提前结束'); return this.t[this.i++]; }
  raw(a, b) { return this.x.src.slice(this.t[a].s, this.t[b - 1].e); }
  word() { return this.done() ? '语句末尾' : this.raw(this.i, this.i + 1).slice(0, 40); }
  end() { if (!this.done()) fail(`后面多出「${this.word()}」`); }
  ident() {
    const t = this.next();
    if (t.k === 'w') return fold(this.x.src.slice(t.s, t.e));
    if (t.k === 'q') return t.name;
    return fail(`这里该是名字，却是「${this.raw(this.i - 1, this.i)}」`);
  }
  qname() { const p = [this.ident()]; while (this.isOp('.')) { this.i++; p.push(this.ident()); } return p; } // 模式前缀由调用方丢
  group(why = '缺左括号') { // 停在 '(' 上：返回括号内的区间 [a,b)，游标移到配对的 ')' 之后
    if (!this.isOp('(')) fail(why);
    for (let k = this.i, d = 0; k < this.j; k++) {
      const t = this.t[k]; if (t.k !== 'op') continue;
      if (t.v === '(' || t.v === '[') d++;
      else if ((t.v === ')' || t.v === ']') && --d === 0) { const r = [this.i + 1, k]; this.i = k + 1; return r; }
    }
    return fail('括号不配对');
  }
}

// 深度 0 的逗号切开 [a,b)；空区间返回空数组。
export function splitTop(toks, a, b) {
  if (a >= b) return [];
  const parts = []; let d = 0, s = a;
  for (let k = a; k < b; k++) {
    const t = toks[k]; if (t.k !== 'op') continue;
    if (t.v === '(' || t.v === '[') d++;
    else if (t.v === ')' || t.v === ']') d--;
    else if (t.v === ',' && d === 0) { parts.push([s, k]); s = k + 1; }
  }
  parts.push([s, b]);
  return parts;
}

// 向后扫一段表达式，停在深度 0 的停止词上（NOT 只在后面跟 NULL 时算）；first 为真时第一个词无论是什么都吃掉（DEFAULT NULL）。
export function skipExpr(c, stop, first) {
  let d = 0, k = c.i;
  for (; k < c.j; k++) {
    const t = c.t[k];
    if (t.k === 'op') { if (t.v === '(' || t.v === '[') d++; else if (t.v === ')' || t.v === ']') d--; continue; }
    if (d || t.k !== 'w' || !stop.has(t.up) || (first && k === c.i)) continue;
    if (t.up !== 'NOT' || c.t[k + 1]?.up === 'NULL') break;
  }
  c.i = k;
}

// 字符串字面量（'…'、E'…'、$标签$…$标签$）取出正文；别的词抛 ParseFail。
export function unquote(tok, c) {
  const raw = c.x.src.slice(tok.s, tok.e);
  if (tok.k === 'dollar') { const tag = raw.match(/^\$[^$]*\$/)[0]; return raw.slice(tag.length, raw.length - tag.length); }
  if (tok.k !== 'str') fail('IS 后面该是字符串或 NULL');
  const esc = raw[0] !== "'", body = raw.slice(esc ? 2 : 1, -1); let out = '';
  for (let p = 0; p < body.length; p++) {
    const ch = body[p];
    if (esc && ch === '\\') { const nx = body[++p]; out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[nx] ?? nx; }
    else if (ch === "'") { out += "'"; p++; }
    else out += ch;
  }
  return out;
}
