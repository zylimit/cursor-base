// code-heads.mjs —— 一个代码文件的文件头说明与「是不是入口」（第三期契约 docs/readable-spec/phase3-arch-contract.md B 节「文件」）。
// 为什么有它：模块页上每个文件一行，接手的人看一个文件是干什么的就看它的文件头说明；入口认不全，服务的启动文件会被列进
// 「没有被项目里别的文件引用的」，读的人以为是死文件。原在 code-imports.mjs，那边只留引用。
// 文件头说明是「来源里的注释」：原文照搬，只去掉引号与注释记号、统一缩进，不改写、不摘要（转义不解，\n 照原样两个字）。
// 只在 code-lex.mjs 切出的「代码」里认——注释、字符串里长得像的不算；不跑被扫的代码。
import { sticky } from './code-lex.mjs';
import { PY_NAME, JS_IMPORT, JS_EXPORT, pyMain, cleandoc } from './code-resolve.mjs';

// ---- Python ----
// 文件头说明：第一条语句是字符串字面量（前面只有空行与注释——编码声明、#! 也是注释；o 里它们已是空格）。
// b 串、f 串不是说明（同 Python 自己的口径）；紧挨着的几个字面量是隐式拼接，算一个。统一缩进照 inspect.cleandoc 的做法。
export function pyHead(src, sp) {
  const o = sp.other;
  let p = sticky(/\s*/y, o, 0).length, body = '', l;
  while ((l = sp.byStart.get(p))) {
    if (/[fb]/i.test(src.slice(l.start, l.bs).replace(/["']/g, ''))) return null;
    body += src.slice(l.bs, l.be);
    p = l.end + sticky(/[ \t]*/y, o, l.end).length;
  }
  if (p === sticky(/\s*/y, o, 0).length || (p < o.length && !/[\r\n;]/.test(o[p]))) return null;
  return cleandoc(body.split(/\r?\n/), true);
}

// 入口：有 if __name__ == "__main__":（pyMain），或者模块级（不缩进）定义了应用对象 <名字> = FastAPI(…)——服务器进程按「文件:对象」拉起它，
// 没有 __main__ 那一段。可带类型标注、可写成 fastapi.FastAPI(…)；写在函数里、条件分支里的缩进了，不算。else: x = … 这类关键字后面紧跟冒号的不是标注。
const PY_APP = new RegExp(`(?:^|\\n)(${PY_NAME})[ \\t]*(?::[^=\\n]*)?=(?!=)[ \\t]*(?:${PY_NAME}[ \\t]*\\.[ \\t]*)*FastAPI[ \\t]*\\(`, 'g');
const PY_BLOCK_KW = new Set(['else', 'try', 'finally', 'except']);
export const pyEntry = (src, sp) => pyMain(src, sp) || [...sp.other.matchAll(PY_APP)].some((m) => !PY_BLOCK_KW.has(m[1]));

// ---- JS 一族 ----
// 一块注释：一个 /* … */，或连着的 // 行（空行就断；行尾的 \r 与 /* */ 一样去掉）。返回 { text, end }，end 一定在 i 之后。文件已切得动，/* 一定闭合。
function commentAt(src, i) {
  if (src.startsWith('/*', i)) {
    const e = src.indexOf('*/', i + 2);
    const ls = src.slice(i + 2, e).replace(/^\*+/, '').split(/\r?\n/).map((x, k) => (k ? x.replace(/^[ \t]*\*(?!\/) ?/, '') : x).trimEnd());
    return { text: cleandoc(ls, true), end: e + 2 };
  }
  const ls = [], re = /[ \t]*\/\/([^\n]*)(?:\n|$)/y;
  let k = i, m;
  while ((re.lastIndex = k, m = re.exec(src))) { ls.push(m[1].trimEnd()); k = re.lastIndex; }
  return { text: cleandoc(ls, false), end: k };
}

// i 处是一条引用语句（import … from '…'、import '…'、export … from '…'，可以跨行）或指令（单独成句的 'use client' 一类）时，
// 返回它的结尾（连同分号）；别的语句返回 -1。import(…)、import.meta 是表达式，不是引用语句。
const LEAD_KW = /(import|export)(?![\w$\u0080-￿])/y;
function leadEnd(src, sp, i) {
  const o = sp.other, kw = sticky(LEAD_KW, o, i);
  let l;
  if (kw) {
    const after = i + kw.length;
    if (kw === 'import' && sticky(/\s*[(.]/y, o, after) !== null) return -1;
    let p = kw === 'import' ? sticky(/\s*(?=["'])/y, o, after) : null;
    if (p !== null) p = after + p.length;
    else { const re = kw === 'import' ? JS_IMPORT : JS_EXPORT; re.lastIndex = after; if (!re.exec(o)) return -1; p = re.lastIndex; }
    l = sp.byStart.get(p);
  } else {
    l = sp.byStart.get(i);
    if (l && sticky(/[ \t]*(?:;|\r?\n|$)/y, o, l.end) === null) return -1;
  }
  if (!l || src[l.start] === '`') return -1;
  return l.end + (sticky(/[ \t]*;/y, o, l.end)?.length ?? 0);
}

// 文件头说明取两处里先有的那一处：① 文件最前面、任何语句之前的那一块注释；② 没有 ① 时，开头那一串引用语句与指令之后、
// 第一条别的语句之前的第一块注释——前端常见的写法是先引用、再在组件上方写说明。夹在两条引用语句之间的注释不算，那多半是写给
// 下一行引用看的检查指令；写在一条引用同一行后面的注释是那条引用的，也不算。#! 那一行跳过。
// 返回 { head, headAt }：headAt 记取的是哪一处（① 是 top，② 是 after-imports，没有说明的为 null）——② 那块注释说的有时只是
// 紧跟着的那一条定义而不是整个文件，页面上要标得出它是从哪儿取的。
const at = (text, where) => ({ head: text, headAt: text === null ? null : where });
export function jsHead(src, sp) {
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (src.startsWith('#!', i)) { const e = src.indexOf('\n', i); if (e < 0) return at(null); i = e + 1; }
  i += sticky(/\s*/y, src, i).length;
  const isComment = () => src.startsWith('/*', i) || src.startsWith('//', i);
  if (isComment()) return at(commentAt(src, i).text, 'top');
  let head = null, last = 0; // last：上一条引用或指令的最后一个字
  for (;;) {
    i += sticky(/\s*/y, src, i).length;
    if (isComment()) {
      if (sp.lineAt(i) === sp.lineAt(last)) { const e = src[i + 1] === '/' ? src.indexOf('\n', i) : src.indexOf('*/', i + 2) + 2; i = e < 0 ? src.length : e; continue; }
      const c = commentAt(src, i);
      head ??= c;
      i = c.end;
      continue;
    }
    const e = leadEnd(src, sp, i);
    if (e < 0) return at(head?.text ?? null, 'after-imports');
    head = null; last = e - 1; i = e;
  }
}
