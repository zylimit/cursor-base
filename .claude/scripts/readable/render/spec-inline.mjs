// spec-inline.mjs —— 需求规格一块文字的行内排法：三种行内记号，与长条目分句（契约 docs/readable-spec/phase2-spec-contract.md C 节）。
// 只改显示、不动文字：记号配上了变成标签（标签里的字照旧是原文），配不上的照字面显示；分句只是在句末插一个空的断行标记，
// 一个字不加、一个字不少。核对器照同一条规矩自己写了一份（check-read.mjs 的 plainMarks，架构稿 §3 禁边不许它 import 这里），
// 两份对同样的输入出同样的纯文字——出页面的代码吞了字，核对器才看得出来。
// 规矩：`等宽` 是 N 个反引号起、到下一串恰好 N 个反引号止，中间原样、不再认别的记号；收不了尾的反引号照字面。
// **粗体** 与 ~~删除线~~ 在等宽之外从左往右配：后面紧跟非空白的能起；前面紧跟非空白、与起的之间隔着东西的能收；
// 收的时候夹在中间还没配上的起记号作废、照字面显示——配出来的标签总是规规矩矩地嵌套。
import { esc } from './layout.mjs';

export const SPLIT_OVER = 200; // 契约 C 节：一条的文字超过 200 个字才分句
const TAG = { '**': 'strong', '~~': 'del' };
const WS = /\s/;
// 括号与引号里面不断句；半角引号不认——英文里的撇号也是它，认了会配错、整条不再断句。
const OPEN = '（([【「『《“‘', CLOSE = '）)]】」』》”’';
// 全角与半角的分号、问号、感叹号见了就断；半角的点后面跟着空白（或在整段末尾）才算句号——紧贴着下一个字的是小数点、版本号、
// 文件名里的点（v1.99、11.98GB、schema.sql），不是句号。2026-11-23 真数据：超过 200 字的列表项里括号与等宽之外的半角点 41 处，全是这种。
const FULL = '。；？！', HALF = ';?!', DOT = '.';
// 小标题后面紧跟的冒号或破折号跟着小标题走，免得下一行以冒号开头。
const TERM_TAIL = /^\s*(?:——|[：:])\s*/u;

// 切成 {t:'text',s,at} / {t:'code',s,at} / {t:'mark',m,at}；配上的记号带 pair（'open' / 'close'）与 mate（另一半的下标）。
// at 是这一段在原文里的起点（码元下标）：判记号前后是不是空白看原文，不看切出来的段；流程链图插在原文的哪个位置也按它算。
export function lex(s) {
  const out = [];
  let buf = '', bufAt = 0, i = 0;
  const flush = () => { if (buf) out.push({ t: 'text', s: buf, at: bufAt }); buf = ''; };
  const put = (t) => { if (!buf) bufAt = i; buf += t; };
  while (i < s.length) {
    if (s[i] === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      let j = i + n, end = -1;
      while (j < s.length) {
        if (s[j] !== '`') { j++; continue; }
        let k = 1;
        while (s[j + k] === '`') k++;
        if (k === n) { end = j; break; }
        j += k;
      }
      if (end < 0) { put(s.slice(i, i + n)); i += n; continue; }
      flush();
      out.push({ t: 'code', s: s.slice(i + n, end), at: i });
      i = end + n;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (TAG[two]) { flush(); out.push({ t: 'mark', m: two, at: i }); i += 2; continue; }
    put(s[i]);
    i++;
  }
  flush();
  const open = [];
  out.forEach((tk, k) => {
    if (tk.t !== 'mark') return;
    const prev = s[tk.at - 1], next = s[tk.at + 2];
    const o = open.map((x) => out[x].m).lastIndexOf(tk.m);
    if (o >= 0 && prev !== undefined && !WS.test(prev) && open[o] !== k - 1) {
      Object.assign(out[open[o]], { pair: 'open', mate: k });
      Object.assign(tk, { pair: 'close', mate: open[o] });
      open.length = o;
      return;
    }
    if (next !== undefined && !WS.test(next)) open.push(k);
  });
  return out;
}

// 页面上显示出来的纯文字（配上的记号不显示），给章名、步骤图的方框、引用的标题用。
const shown = (t) => (t.t === 'mark' ? (t.pair ? '' : t.m) : t.s);
export const plain = (s) => lex(s).map(shown).join('');
const isEnd = (c) => FULL.includes(c) || HALF.includes(c);
// 看得见、又不是句末记号、半角点或右括号的字：断行标记与流程链图都插在这样的字前面（inline 的 go 在同样的地方触发）。
const starts = (c) => !WS.test(c) && !isEnd(c) && c !== DOT && !CLOSE.includes(c);

// 开头配上的粗体（这一条的小标题）显示出来的字；开头不是配上的粗体就是空串。本章条目的索引用它，与页面上当小标题的是同一段。
export function leadTerm(s) {
  const toks = lex(s);
  return toks[0]?.t === 'mark' && toks[0].m === '**' && toks[0].pair === 'open' ? toks.slice(1, toks[0].mate).map(shown).join('') : '';
}

// 一段文字切成句——与分句显示同一套规矩（契约 C 节「流程链图」：与分句同一套规则切出来的一句，不管这一条有没有分句显示）：
// 括号、引号、等宽里面不断，半角的点后面跟着空白（或在整段末尾）才算句号；lines 为 true 时逐行看，换行处也断（引用）。
// 每句给出 at——这一句之后、下一句第一个字之前的位置（原文的码元下标，整段末尾是 s.length），inline 在这里插这一句的流程链图；
// parts——这一句在括号、引号、等宽之外按「→」切开的各段显示出来的字；intro——第一段里括号、引号之外最后一个冒号之后的下标（没有是 0）。
// 冒号：全角的都算；半角的后面跟着空白或在一段末尾才算——紧贴着字的是时刻、端口（10:30、host:8080），不是引子的冒号。
export const ARROW = '→';
export function sentences(s, { lines = false } = {}) {
  const toks = lex(s), out = [];
  let parts = [''], intro = 0, depth = 0, closed = false;
  const add = (t) => { parts[parts.length - 1] += t; };
  const open = (at) => { if (closed) { out.push({ at, parts, intro }); parts = ['']; intro = 0; closed = false; } };
  toks.forEach((tk, k) => {
    if (tk.t === 'code') { open(tk.at); add(tk.s); if (lines && tk.s.includes('\n')) { depth = 0; closed = true; } return; }
    if (tk.t === 'mark') { if (tk.pair !== 'close') open(tk.at); add(shown(tk)); return; }
    const cs = Array.from(tk.s);
    let at = tk.at;
    cs.forEach((c, x) => {
      if (starts(c)) open(at);
      at += c.length;
      if (lines && c === '\n') { depth = 0; closed = true; add(c); return; }
      if (depth === 0 && c === ARROW) { parts.push(''); return; }
      add(c);
      if (OPEN.includes(c)) depth++;
      else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
      else if (depth > 0) return;
      else if (parts.length === 1 && (c === '：' || (c === ':' && (x + 1 >= cs.length || WS.test(cs[x + 1]))))) intro = parts[0].length;
      else if (isEnd(c) || (c === DOT && (x + 1 < cs.length ? WS.test(cs[x + 1]) : k === toks.length - 1))) closed = true;
    });
  });
  out.push({ at: s.length, parts, intro });
  return out;
}

// 一段文字 → 行内的 HTML。split：在句末断行——true 看整条（列表项、段落：整条超过 200 个字就分）；
// 'line' 逐行看（引用：页面上行与行照原文分开，哪一行超过 200 个字只分那一行；换行处本来就断开，不另插断行标记，括号也不跨行算）。
// term：开头配上的粗体当这一条的小标题，自成一行。
// 断行标记是一个空的 <span class="sb">（样式里是块）：读回的文字里它什么都不是，比 <br> 少一个空白。
// 断行不立刻插：等到下一个看得见、又不是句末记号或右括号的字才插，整段末尾的句号后面不会多出一个空行。
// figs：{原文的位置 → 一张流程链图的 HTML}（sentences 给的 at），在那个位置插；万一哪个位置没走到（落在小标题后面挪走的冒号里），
// 放到这一段末尾，图不悄悄丢。
export function inline(s, { split = false, term = false, figs = null } = {}) {
  const toks = lex(s), long = split === 'line' ? s.split('\n').map((l) => Array.from(l).length > SPLIT_OVER) : null;
  if (term && toks[0]?.t === 'mark' && toks[0].m === '**' && toks[0].pair === 'open') {
    const c = toks[0].mate, next = toks[c + 1];
    let tail = '';
    if (next?.t === 'text') { const m = TERM_TAIL.exec(next.s); if (m) { tail = m[0]; next.s = next.s.slice(tail.length); next.at += tail.length; } }
    toks.splice(c + 1, 0, { t: 'raw', s: `${esc(tail)}</span>` });
    toks.unshift({ t: 'raw', s: '<span class="term">' });
  }
  let out = '', depth = 0, pending = false, ln = 0;
  const left = new Map(figs ?? []);
  const go = (at) => {
    if (left.has(at)) { out += left.get(at); left.delete(at); }
    if (pending) { out += '<span class="sb"></span>'; pending = false; }
  };
  const on = () => (long ? long[ln] : split); // 当前这一行分不分句
  const nl = (n) => { if (long && n) { ln += n; depth = 0; pending = false; } };
  toks.forEach((tk, k) => {
    if (tk.t === 'raw') { out += tk.s; return; }
    if (tk.t === 'code') { go(tk.at); out += `<code>${esc(tk.s)}</code>`; nl(tk.s.split('\n').length - 1); return; }
    if (tk.t === 'mark') {
      if (tk.pair === 'close') { out += `</${TAG[tk.m]}>`; return; }
      go(tk.at);
      out += tk.pair === 'open' ? `<${TAG[tk.m]}>` : esc(tk.m);
      return;
    }
    const cs = Array.from(tk.s);
    let at = tk.at;
    cs.forEach((c, x) => {
      if (starts(c)) go(at);
      at += c.length;
      out += esc(c);
      if (!split) return;
      if (c === '\n') nl(1);
      else if (OPEN.includes(c)) depth++;
      else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
      else if (depth === 0 && on() && (isEnd(c) || (c === DOT && (x + 1 < cs.length ? WS.test(cs[x + 1]) : k === toks.length - 1)))) pending = true;
    });
  });
  for (const f of left.values()) out += f;
  return out;
}
