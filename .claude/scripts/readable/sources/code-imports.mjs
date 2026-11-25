// code-imports.mjs —— 代码文件的清单、文件头说明与文件之间的引用（第三期契约 docs/readable-spec/phase3-arch-contract.md B 节「文件」「引用」）。
// 为什么有它：接手的人看完数据库设计，第二步看架构；模块之间谁依赖谁、循环依赖、对外提供的名字，全从这里的边汇总（需求 REQ-DOC-002）。
// 错一条边，模块图上就多一条或少一条线：把字符串里的 import 当真（多报）与漏掉括号里换行的名字、上两层的相对引用（漏报）一样贵。
// 所以只在 code-lex.mjs 切出的「代码」里认引用语句——注释、字符串、文档串的正文在那里已抹成空格；读不出的进「没解析到的引用」
// 「运行时才定的引用」，不悄悄丢。不跑被扫的代码、不调语言自带的解析器，只读文本。
// 宁可不成边也不给猜的边：对上的文件不在文件清单里的、两种读法都说得通的，都进「没解析到的引用」并写明为什么，页面上看得见。
// 「没解析到的引用」的原文是要上页面的字，里面不带代码的行号（行号只在 line 一栏）：代码一改行号就挪，入库的页面跟着变却没有读者在意的变化。
// 实数（2026-11-23，一个下游项目）：后端两个 Python 代码根下非测试文件 371 个，文件之间的引用 1058 对；相对写法 806 处，
// 带项目全路径的与以代码根为起点的各三百多处；服务端 336 个文件里 332 个开头有说明，中位 191 个字。前端 484 个 TypeScript 文件，引用全是相对路径。
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { cmp } from '../model.mjs';
import { Unclosed, sticky, split, lineOf } from './code-lex.mjs';
// 认语句的位置、解析到文件、标准库名单在 code-resolve.mjs，与认接口的 code-routes.mjs 共用一份（2026-11-23 Task 3.2 搬出）；文件头说明与入口在 code-heads.mjs
import { langOf, PY_STDLIB, PY_NAME, PY_DOTTED, PY_IMPORT, PY_FROM, JS_NAME, JS_IMPORT, JS_EXPORT, dotted, pyStatements, resolver } from './code-resolve.mjs';
import { pyHead, pyEntry, jsHead } from './code-heads.mjs';

export { langOf };

// ---- Python：引用语句 ----
const PY_IMPORT_ITEM = new RegExp(`^(${PY_DOTTED})(?:\\s+as\\s+${PY_NAME})?$`);
const PY_FROM_ITEM = new RegExp(`^(${PY_NAME})(?:\\s+as\\s+${PY_NAME})?$`);
const PY_DYN = /(?<![\w.\u0080-￿])(?:importlib\s*\.\s*)?(?:import_module|__import__)\s*\(/g;
const PY_MODULE = new RegExp(`^${PY_DOTTED}$`); // import_module 的字面量实参要像一个模块名才当 import 解析

// 一条语句 → 交给 pyAbs / pyRel；认不出写法的返回 false，由调用方记进「没解析到的引用」。
// what：null 是 import a.b（整个文件），'*' 是 from a import *，数组是点了名的名字（as 之前的原名）。
function pyStatement(t, line, text, rec) {
  let m = PY_IMPORT.exec(t);
  if (m) {
    const items = m[1].split(',').map((x) => PY_IMPORT_ITEM.exec(x.trim()));
    if (items.some((x) => !x)) return false;
    for (const x of items) rec.pyAbs(line, dotted(x[1]), null, text);
    return true;
  }
  if (!(m = PY_FROM.exec(t))) return false;
  const dots = m[1].length, parts = m[2] ? dotted(m[2]) : [];
  let rest = m[3].trim();
  if (!dots && !parts.length) return false;
  let what = '*';
  if (rest !== '*') {
    if (rest.startsWith('(')) { if (!rest.endsWith(')')) return false; rest = rest.slice(1, -1).trim().replace(/,$/, ''); }
    what = rest.split(',').map((x) => PY_FROM_ITEM.exec(x.trim())?.[1]);
    if (!what.length || what.some((x) => !x)) return false;
  }
  if (dots) rec.pyRel(line, dots, parts, what, text); else rec.pyAbs(line, parts, what, text);
  return true;
}

// 调用的第一个实参是不是字符串字面量（后面紧跟 ) 或 ,）：是就返回它的原文，不是返回 null。f 串、带 ${…} 的模板是运行时拼的，不算。
function callLiteral(src, sp, p) {
  const o = sp.other, l = sp.byStart.get(p + sticky(/\s*/y, o, p).length);
  if (!l) return null;
  const v = src.slice(l.bs, l.be), pre = src.slice(l.start, l.bs).replace(/["'`]/g, '');
  if (/[fb]/i.test(pre) || (src[l.start] === '`' && v.includes('${'))) return null;
  const q = l.end + sticky(/\s*/y, o, l.end).length;
  return o[q] === ')' || o[q] === ',' ? v : null;
}
function callEnd(o, open) { // 配对的 ) 之后；配不上就到那一行的行尾
  for (let d = 0, k = open; k < o.length; k++) { if (o[k] === '(') d++; else if (o[k] === ')' && --d === 0) return k + 1; }
  const e = o.indexOf('\n', open); return e < 0 ? o.length : e;
}

function pyRefs(src, sp, rec) {
  const o = sp.other;
  for (const [s, e] of pyStatements(o)) {
    let end = e; while (end > s && /\s/.test(o[end - 1])) end--;
    const line = sp.lineAt(s), text = src.slice(s, end);
    if (!pyStatement(o.slice(s, end).replace(/\\\r?\n/g, ' '), line, text, rec)) rec.unresolved(line, text);
  }
  // importlib.import_module(…)、__import__(…)：实参是字面量的当 import <它> 解析（相对写法要看 package 实参，算运行时定的）；别的进「运行时才定的引用」。
  for (const m of o.matchAll(PY_DYN)) {
    if (/\bdef\s+$/.test(o.slice(Math.max(0, m.index - 12), m.index))) continue;
    const open = m.index + m[0].length - 1, line = sp.lineAt(m.index), text = src.slice(m.index, callEnd(o, open));
    const v = callLiteral(src, sp, open + 1);
    if (v === null || v.startsWith('.') || !PY_MODULE.test(v)) rec.dynamic(line, text);
    else rec.pyAbs(line, dotted(v), null, text);
  }
}

// ---- JS 一族：引用语句 ----
// import … from '…'、import '…'、export … from '…'、require('…')、import('…')；import.meta 与别的 import 写法（TS 的 import x = 名字）不是引用。
// 模块名必须是切词认出的字面量：JSX 标签之间的文字里写着 import x from 'y' 的，那个 'y' 不是字面量，不算。
const JS_KW = /(?<![\w$.\u0080-￿])(?:import|export|require)(?![\w$\u0080-￿])/g;
const JS_SPEC_NAME = new RegExp(`^(?:type\\s+)?(${JS_NAME})`); // { a, b as c, type D } 里的一项：取 as 之前的原名
const braceNames = (s) => s.split(',').map((x) => JS_SPEC_NAME.exec(x.trim())?.[1]).filter(Boolean);

function jsRefs(src, sp, rec) {
  const o = sp.other;
  for (const m of o.matchAll(JS_KW)) {
    const kw = m[0], at = m.index, after = at + kw.length, line = sp.lineAt(at), call = sticky(/\s*\(/y, o, after) !== null;
    if (kw === 'require' && (!call || /\bfunction\s*$/.test(o.slice(Math.max(0, at - 20), at)))) continue;
    if (kw === 'require' || (kw === 'import' && call)) {
      const open = o.indexOf('(', after), text = src.slice(at, callEnd(o, open)), v = callLiteral(src, sp, open + 1);
      if (v === null) rec.dynamic(line, text); else rec.js(line, v, [], true, text);
      continue;
    }
    if (kw === 'import' && sticky(/\s*\./y, o, after) !== null) continue;
    let p, names = [], whole = false;
    const bare = kw === 'import' ? sticky(/\s*(?=["'])/y, o, after) : null;
    if (bare !== null) { p = after + bare.length; whole = true; }
    else {
      const re = kw === 'import' ? JS_IMPORT : JS_EXPORT, c = (re.lastIndex = after, re.exec(o));
      if (!c) continue;
      p = re.lastIndex;
      if (kw === 'import') {
        if (!c[1] && c[2] === undefined && !c[3]) continue;
        if (c[1]) names.push('default');
        if (c[2] !== undefined) names.push(...braceNames(c[2]));
        whole = !!c[3];
      } else if (c[1]) whole = true;
      else names = braceNames(c[2]);
    }
    const l = sp.byStart.get(p);
    if (!l || src[l.start] === '`') continue;
    rec.js(line, src.slice(l.bs, l.be), names, whole, src.slice(at, l.end));
  }
}

// 一个文件的记录器：边并进全项目的 edges，外部包记在这个文件上，没解析到的与运行时定的进全项目的清单。
function recorder(R, file, res, edges, externals) {
  const unresolved = (line, text) => res.unresolved.push({ file, line, text });
  const outside = new Set(); // 同一行对上同一个清单外的文件只记一条
  const edge = (to, line, names, whole, star, text) => {
    // 对上的文件不在文件清单里（代码根之外、被 ignore 排掉的）：一条指向清单外的边在页面上哪儿都看不见，不成边、明说
    if (!R.listed(to)) { if (!outside.has(`${line}\n${to}`)) { outside.add(`${line}\n${to}`); unresolved(line, `${text}（对上了 ${to}，但它不在扫的范围里）`); } return; }
    if (to === file) return; // 文件引用自己的不算
    const k = `${file}\n${to}`;
    if (!edges.has(k)) edges.set(k, { from: file, to, lines: new Set(), names: new Set(), whole: false, star: false });
    const e = edges.get(k);
    e.lines.add(line); names.forEach((n) => e.names.add(n)); e.whole ||= whole; e.star ||= star;
  };
  // 绝对引用一个文件都没对上：包式的代码根里第一段与根下直接放着的文件或目录同名的，两种读法都说得通，不猜、明说；别的是外部包，只记第一段。
  const external = (line, first, text) => {
    const near = R.shadow(file, first);
    if (near) unresolved(line, `${text}（按包里的绝对引用它指外部的 ${first}；同目录下有同名的 ${near}，这个目录要是直接从里面启动的，引用的就是那个文件）`);
    else if (!PY_STDLIB.has(first)) externals.add(first);
  };
  return {
    unresolved,
    dynamic: (line, text) => res.dynamic.push({ file, line, text }),
    // 不是相对写法：取最长前缀；from a import b 而 a/b 是文件的，指向它（整个文件）。
    // 同一条 from 里有的名字对上了、有的没对上的，没对上的那部分算没解析到——第一段是项目里的目录，不是外部包。
    pyAbs(line, parts, what, text) {
      if (what === null || what === '*') { const h = R.longest(parts, file); if (h) edge(h.f, line, [], what === null, what === '*', text); else external(line, parts[0], text); return; }
      let hit = false, miss = false;
      for (const n of what) {
        const h = R.longest([...parts, n], file);
        if (!h) { miss = true; continue; }
        hit = true;
        if (h.j > parts.length) edge(h.f, line, [], true, false, text); else edge(h.f, line, [n], false, false, text);
      }
      if (miss) { if (hit) unresolved(line, text); else external(line, parts[0], text); }
    },
    // 相对写法：一个点是本目录，每多一个点上一层；对不上文件的进「没解析到的引用」。
    pyRel(line, dots, parts, what, text) {
      const dir = posix.dirname(file) === '.' ? [] : posix.dirname(file).split('/');
      if (dots - 1 > dir.length) { unresolved(line, text); return; }
      const base = dir.slice(0, dir.length - (dots - 1)).join('/'), mod = R.pyFile(base, parts);
      if (what === '*') { if (mod) edge(mod, line, [], false, true, text); else unresolved(line, text); return; }
      let miss = false;
      for (const n of what) {
        const sub = R.pyFile(base, [...parts, n]);
        if (sub) edge(sub, line, [], true, false, text); else if (mod) edge(mod, line, [n], false, false, text); else miss = true;
      }
      if (miss) unresolved(line, text);
    },
    js(line, spec, names, whole, text) {
      const t = R.jsTarget(file, spec);
      if ('ext' in t) { if (t.ext) externals.add(t.ext); return; }
      if (t.asset) return;
      if (t.near) unresolved(line, `${text}（不是相对写法，但代码根下有同名的 ${t.near}）`);
      else if (t.to) edge(t.to, line, names, whole, false, text); else unresolved(line, text);
    },
  };
}

const countLines = (src) => (src === '' ? 0 : src.split('\n').length - (src.endsWith('\n') ? 1 : 0));

// files：codeRoots 下去掉 ignore 的全部文件（不只代码文件，别的扩展名在这里按扩展名报数）。routes 在这里留空，由 code-routes.mjs 填。
// 先把文件全切一遍再解析：Python 绝对引用的起点要看全项目（哪些目录是脚本目录、哪些代码根是包式的），见 code-resolve.mjs。
export function extract(config, root, files) {
  const res = { files: [], edges: [], unresolved: [], dynamic: [], skipped: [], routes: [] };
  const edges = new Map(), skipped = new Map(), cut = [];
  for (const file of files) {
    const lang = langOf(file);
    if (!lang) { const x = posix.extname(file); skipped.set(x, (skipped.get(x) ?? 0) + 1); continue; }
    const src = readFileSync(join(root, file), 'utf8');
    const f = { path: file, lang, lines: countLines(src), head: null, headAt: null, entry: false, externals: [] }; // headAt：说明取自哪一处（code-heads.mjs）
    res.files.push(f);
    try { cut.push({ file, src, sp: split(file, src), f }); }
    catch (e) {
      if (!(e instanceof Unclosed)) throw e;
      // 切不动的文件不出半截结果，明说在「没解析到的引用」里；原文不带行号（行号在 line 一栏）
      res.unresolved.push({ file, line: lineOf(src, e.at), text: `有一处${e.message}没有闭合，整个文件没扫` });
    }
  }
  const R = resolver(root, config, files, cut.filter((x) => x.f.lang === 'python'));
  for (const { file, src, sp, f } of cut) {
    const externals = new Set(), rec = recorder(R, file, res, edges, externals);
    if (f.lang === 'python') { pyRefs(src, sp, rec); f.head = pyHead(src, sp); f.headAt = f.head === null ? null : 'top'; f.entry = pyEntry(src, sp); }
    else { jsRefs(src, sp, rec); Object.assign(f, jsHead(src, sp)); }
    f.externals = [...externals].sort(cmp);
  }
  res.files.sort((a, b) => cmp(a.path, b.path));
  res.edges = [...edges.values()].map((e) => ({
    from: e.from, to: e.to, lines: [...e.lines].sort((a, b) => a - b), names: [...e.names].sort(cmp), whole: e.whole, star: e.star,
  })).sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
  const byLine = (a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.text, b.text);
  res.unresolved.sort(byLine);
  res.dynamic.sort(byLine);
  res.skipped = [...skipped].map(([ext, count]) => ({ ext, count })).sort((a, b) => cmp(a.ext, b.ext));
  return res;
}
