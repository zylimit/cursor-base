// code-lex.mjs —— 把一个代码文件切成「代码 / 字符串字面量 / 注释」（第一期契约 docs/readable-spec/phase1-db-contract.md F 节「只看字符串里的 SQL」）。
// 两个取事实器共用这一套切法：code-scan.mjs 只在字面量里认 SQL，code-imports.mjs 只在代码里认引用语句（第三期契约 B 节「引用」）。
// 只许有这一份：两边各切各的，迟早一边修了 JSX、正则、f 串的切法而另一边没修，同一个文件在两份文档里被读成两个样子
// （2026-11-23 Task 3.1 从 code-scan.mjs 原样搬来，行为一个字节没变）。切到末尾还有没闭合的串抛 Unclosed，由调用方决定怎么明说。
const isPy = (f) => /\.py$/.test(f);

export class Unclosed extends Error { constructor(at, what) { super(what); this.at = at; } }
export const sticky = (re, s, i) => { re.lastIndex = i; const m = re.exec(s); return m ? m[0] : null; };

// ---- 切字面量：Python ----
// 认单引号、双引号、三引号与 r / b / f / u 前缀（及 rb、fr 一类两字母组合），# 注释不算。
// 反斜杠在 r 串里也挡住紧跟的引号（r"\"" 是合法的一个串），所以两种串都跳过反斜杠后的那个字符。
// f 串的 {…} 数到配对的 }，里面的字符串照切（3.12 起可以复用外层的引号）；{{ 是字面的花括号。
const PY_ID = /[A-Za-z_\u0080-￿][\w\u0080-￿]*/y;
const PY_PREFIX = /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/;
function pyString(src, start, q, pre, out) {
  const ch = src[q], triple = src.startsWith(ch.repeat(3), q), close = triple ? ch.repeat(3) : ch;
  const fmt = /f/i.test(pre), bs = q + close.length;
  let k = bs;
  for (;;) {
    if (k >= src.length) throw new Unclosed(start, triple ? '三引号字符串' : '引号字符串');
    const c = src[k];
    if (c === '\\') { k += 2; continue; }
    if (!triple && c === '\n') throw new Unclosed(start, '引号字符串（到行尾还没闭合）');
    if (src.startsWith(close, k)) break;
    if (fmt && c === '{') { if (src[k + 1] === '{') k += 2; else k = pyExpr(src, k + 1, start); continue; }
    k++;
  }
  if (out) { out.lits.push({ start, bs, be: k, end: k + close.length }); out.mask.push([bs, k]); }
  return k + close.length;
}
// {…} 里数括号、串照切；括号外的第一个 : 之后是格式说明——f"{x:'>10}" 里的 ' 是填充字符，不是串的开头（契约 F 节点名的三种写法之一），
// 说明读到配对的 } 为止，里面的 {…} 是嵌套的替换字段。字典、切片、带括号的 lambda 里的 : 在括号里，不算。
function pyExpr(src, k, start) {
  for (let depth = 0; k < src.length;) {
    const c = src[k];
    if (c === '"' || c === "'") { k = pyString(src, k, k, '', null); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '}') { if (depth === 0) return k + 1; depth--; }
    else if (c === ':' && depth === 0) return pySpec(src, k + 1, start);
    k++;
  }
  throw new Unclosed(start, 'f 串里的 {…}');
}
function pySpec(src, k, start) {
  while (k < src.length) {
    if (src[k] === '{') { k = pyExpr(src, k + 1, start); continue; }
    if (src[k] === '}') return k + 1;
    k++;
  }
  throw new Unclosed(start, 'f 串里的 {…}');
}
function lexPy(src) {
  const out = { lits: [], mask: [] }, n = src.length;
  for (let i = 0; i < n;) {
    const c = src[i];
    if (c === '#') { let e = src.indexOf('\n', i); if (e < 0) e = n; out.mask.push([i, e]); i = e; continue; }
    if (c === '"' || c === "'") { i = pyString(src, i, i, '', out); continue; }
    const w = sticky(PY_ID, src, i);
    if (!w) { i++; continue; }
    const q = src[i + w.length];
    if ((q === '"' || q === "'") && PY_PREFIX.test(w)) i = pyString(src, i, i + w.length, w, out);
    else i += w.length;
  }
  return out;
}

// ---- 切字面量：JS 一族（.js / .jsx / .mjs / .ts / .tsx）----
// 认单引号、双引号、反引号模板（${…} 里照切），// 与 /* */ 注释不算。正则字面量 /…/ 必须认出来，
// 否则 /'/ 这种会被当成一个没闭合的串：前一个记号是值（名字、数、右括号、串）时 / 是除号，否则试着按正则读到行尾，读不成再当除号。
// JSX 的闭合标签 </p> 里那个 / 不是正则的开头（JS 里 < 后面紧跟 / 只有这一种写法）——不认这条，组件文件的串全会切错位。
// if / while / for / with 的条件括号之后是语句的开头，那里的 / 是正则：if (s) /'/.test(s) 里的 ' 不是串（契约 F 节点名的三种写法之一）。
const JS_ID = /[A-Za-z_$\u0080-￿][\w$\u0080-￿]*/y;
const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const COND_PAREN = new Set(['if', 'while', 'for', 'with']);
const hasJsx = (f) => /\.(?:jsx|tsx|js)$/.test(f); // .ts 里 <T>x 是类型断言，不认 JSX；.js 常写 React 组件，认

// JSX 元素：在该是值的地方出现的 <名 或 <>。标签之间的文字原样跳过——<p>Don't refresh</p> 里的撇号是字，不是串的开头；
// {…} 是表达式（里面的串照记），属性值的引号串照记。读不成元素（TSX 里的泛型箭头 <T,>(x) => x 一类）返回 -1，调用方把 < 当运算符接着读，
// 这一趟记下的字面量撤回。
const JSX_NAME = /[A-Za-z_$][\w$.:-]*/y;
const JSX_ATTR = /[A-Za-z_$][\w$:-]*/y;
const JSX_CLOSE = /<\/\s*([A-Za-z_$][\w$.:-]*)?\s*>/y;
const ws = (src, k) => k + sticky(/\s*/y, src, k).length;
function jsxElement(src, i, out) {
  const mark = out && [out.lits.length, out.mask.length];
  let e;
  try { e = jsxTry(src, i, out); } catch (err) { if (!(err instanceof Unclosed)) throw err; e = -1; }
  if (e < 0 && out) { out.lits.length = mark[0]; out.mask.length = mark[1]; }
  return e;
}
function jsxTry(src, i, out) {
  const name = src[i + 1] === '>' ? '' : sticky(JSX_NAME, src, i + 1);
  if (name === null) return -1;
  let k = i + 1 + name.length;
  for (;;) { // 属性
    k = ws(src, k);
    if (src.startsWith('/>', k)) return k + 2;
    if (src[k] === '>') { k++; break; }
    if (src[k] === '{') { k = jsScan(src, k + 1, out, k, true); continue; }
    const a = sticky(JSX_ATTR, src, k); if (!a) return -1;
    k = ws(src, k + a.length);
    if (src[k] !== '=') continue;
    k = ws(src, k + 1);
    if (src[k] === '"' || src[k] === "'") {
      const e = src.indexOf(src[k], k + 1); if (e < 0) return -1;
      if (out) { out.lits.push({ start: k, bs: k + 1, be: e, end: e + 1 }); out.mask.push([k + 1, e]); }
      k = e + 1;
    } else if (src[k] === '{') k = jsScan(src, k + 1, out, k, true);
    else if (src[k] === '<') { k = jsxTry(src, k, out); if (k < 0) return -1; }
    else return -1;
  }
  while (k < src.length) { // 子节点
    if (src[k] === '{') { k = jsScan(src, k + 1, out, k, true); continue; }
    if (src[k] !== '<') { k++; continue; }
    const m = JSX_CLOSE.exec((JSX_CLOSE.lastIndex = k, src));
    if (m) return (m[1] ?? '') === name ? JSX_CLOSE.lastIndex : -1;
    k = jsxTry(src, k, out); if (k < 0) return -1;
  }
  return -1;
}
function jsComment(src, i) {
  if (src[i + 1] === '/') { const e = src.indexOf('\n', i); return e < 0 ? src.length : e; }
  const e = src.indexOf('*/', i + 2); if (e < 0) throw new Unclosed(i, '块注释'); return e + 2;
}
function jsString(src, i, out) {
  const q = src[i];
  let k = i + 1;
  for (;;) {
    if (k >= src.length) throw new Unclosed(i, q === '`' ? '反引号模板' : '引号字符串');
    const c = src[k];
    if (c === '\\') { k += 2; continue; }
    if (c === q) break;
    if (q !== '`' && c === '\n') throw new Unclosed(i, '引号字符串（到行尾还没闭合）');
    if (q === '`' && c === '$' && src[k + 1] === '{') { k = jsScan(src, k + 2, null, i); continue; }
    k++;
  }
  if (out) { out.lits.push({ start: i, bs: i + 1, be: k, end: k + 1 }); out.mask.push([i + 1, k]); }
  return k + 1;
}
function jsRegex(src, i) { // 读成正则返回结尾，读不成（遇到换行或到头）返回 -1
  for (let k = i + 1, cls = false; k < src.length; k++) {
    const c = src[k];
    if (c === '\n') return -1;
    if (c === '\\') k++;
    else if (c === '[') cls = true;
    else if (c === ']') cls = false;
    else if (c === '/' && !cls) { k++; while (/[A-Za-z]/.test(src[k] ?? '')) k++; return k; }
  }
  return -1;
}
// 主循环；tpl 不为 null 时是在模板的 ${…} 里（tpl 是那个模板的起点），读到配对的 } 返回其后的位置。
// ${…} 里的串、注释、正则同样要认（真数据里有 ${s.replace(/[."]/g, …)} 这种），所以与外层共用一个循环；里面的字面量不单记。
// jsx 为真时认 JSX 元素（见 hasJsx）；parens 记每个左括号前面紧挨着的词，配对的右括号之后是不是语句开头靠它。
function jsScan(src, i, out, tpl, jsx) {
  let prevVal = false, depth = 0, lastOp = '', lastWord = '';
  const parens = [];
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && (d === '/' || d === '*')) { const e = jsComment(src, i); if (out) out.mask.push([i, e]); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') { i = jsString(src, i, out); prevVal = true; lastWord = ''; continue; }
    if (c === '/' && !prevVal && lastOp !== '<') { const e = jsRegex(src, i); if (e > 0) { i = e; prevVal = true; lastWord = ''; continue; } }
    if (c === '<' && !prevVal && jsx) { const e = jsxElement(src, i, out); if (e > 0) { i = e; prevVal = true; lastWord = ''; lastOp = ''; continue; } }
    const w = sticky(JS_ID, src, i);
    if (w) { i += w.length; prevVal = !REGEX_AFTER.has(w); lastOp = ''; lastWord = w; continue; }
    if (c >= '0' && c <= '9') { i += sticky(/[\w.]+/y, src, i).length; prevVal = true; lastOp = ''; lastWord = ''; continue; }
    if (c === '{') depth++;
    else if (c === '}' && tpl !== null && depth-- === 0) return i + 1;
    if (c === '(') parens.push(lastWord);
    if (c === ')') prevVal = !COND_PAREN.has(parens.pop());
    else if (c === ']' || c === '}') prevVal = true;
    else if (c > ' ') prevVal = false;
    if (c > ' ') { lastOp = c; lastWord = ''; }
    i++;
  }
  if (tpl !== null) throw new Unclosed(tpl, '反引号模板里的 ${…}');
  return i;
}
function lexJs(src, jsx) {
  const out = { lits: [], mask: [] };
  jsScan(src, 0, out, null, jsx);
  return out;
}

// 切好的文件：字面量清单、把注释与字面量正文抹成空格的「其它」、按偏移查行号。切不动抛 Unclosed。
export function split(file, src) {
  const { lits, mask } = isPy(file) ? lexPy(src) : lexJs(src, hasJsx(file));
  let other = '', p = 0;
  for (const [s, e] of mask) { other += src.slice(p, s) + src.slice(s, e).replace(/[^\n]/g, ' '); p = e; }
  other += src.slice(p);
  const nl = []; for (let k = src.indexOf('\n'); k >= 0; k = src.indexOf('\n', k + 1)) nl.push(k);
  const lineAt = (off) => { let lo = 0, hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < off) lo = m + 1; else hi = m; } return lo + 1; };
  return { lits, other, lineAt, byStart: new Map(lits.map((l) => [l.start, l])) };
}
export const lineOf = (src, off) => src.slice(0, off).split('\n').length;
