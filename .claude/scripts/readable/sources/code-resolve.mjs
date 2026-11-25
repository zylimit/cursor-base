// code-resolve.mjs —— 代码文件的两个取事实器共用的几样：Python 引用语句在哪、一条引用解析到哪个文件、说明的统一缩进
// （第三期契约 docs/readable-spec/phase3-arch-contract.md B 节「引用」「接口」）。
// 为什么单拆出来：code-imports.mjs 靠它们出引用边，code-routes.mjs 靠同一套找「挂上来的乙是哪个文件里的路由器」、取处理函数的说明。
// 只许有这一份：两边各写一份，迟早一边改了「from a import b 指向谁」而另一边没改，接口挂到的文件与模块图上的边就对不上
// （2026-11-23 Task 3.2 从 code-imports.mjs 搬来）。
// Python 绝对引用从哪几个起点找，照解释器自己找模块的先后（契约 B 节「Python 绝对引用的起点」）：脚本目录、自己的代码根、别的代码根、项目根。
// 代码根本身是个包、又被按包的写法引用时，它自己不当起点——否则包里的 import logging、from celery import … 会被接到同目录下同名的文件上；
// 自己的代码根排在别的前面——否则两个代码根下有同名文件时，引用会被接到另一个根的那个上。这两样都要先看全项目才定得下来，所以解析器拿着全部文件建。
import { statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { builtinModules } from 'node:module';
import { sticky } from './code-lex.mjs';

export const langOf = (f) => (/\.py$/.test(f) ? 'python' : /\.(?:js|jsx|mjs|cjs|ts|tsx)$/.test(f) ? 'js' : null);
const JS_TRY = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']; // 契约 B 节：原样之后依次试这些，再试 /index 加这些
// Python 标准库的顶层模块：本机 Python 3.14.4 的 sys.stdlib_module_names 去掉下划线开头的，194 个（2026-11-23 取）。
// 另补 __future__：它在 stdlib_module_names 里，跟着下划线开头的一起被去掉了，而 from __future__ import annotations 几乎每个文件都有。
export const PY_STDLIB = new Set(`abc annotationlib antigravity argparse array ast asyncio atexit base64 bdb binascii bisect builtins bz2 cProfile calendar
cmath cmd code codecs codeop collections colorsys compileall compression concurrent configparser contextlib contextvars copy copyreg csv ctypes
curses dataclasses datetime dbm decimal difflib dis doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch
fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib importlib
inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox marshal math mimetypes mmap modulefinder msvcrt multiprocessing
netrc nt ntpath nturl2path numbers opcode operator optparse os pathlib pdb pickle pickletools pkgutil platform plistlib poplib posix posixpath
pprint profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource rlcompleter runpy sched
secrets select selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 sre_compile sre_constants sre_parse ssl stat
statistics string stringprep struct subprocess symtable sys sysconfig syslog tabnanny tarfile tempfile termios textwrap this threading time
timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uuid venv
warnings wave weakref webbrowser winreg winsound wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo __future__`.split(/\s+/));
const NODE_BUILTIN = new Set(builtinModules);

// ---- Python：引用语句 ----
// 只认语句开头的 import / from：行首（括号里换行、反斜杠续行的不算新行）、分号之后、括号外的冒号之后（if TYPE_CHECKING: import x）。
// yield from、raise … from 里的 from 不在语句开头，自然不认。写在函数里、try 里、条件分支里的照认——它们也在语句开头。
export const PY_NAME = '[A-Za-z_\\u0080-\\uffff][\\w\\u0080-\\uffff]*';
export const PY_DOTTED = `${PY_NAME}(?:\\s*\\.\\s*${PY_NAME})*`;
const PY_KW = /(?:import|from)(?![\w\u0080-￿])/y;
export const PY_IMPORT = /^import\s+([\s\S]+)$/;
export const PY_FROM = new RegExp(`^from\\s*(\\.*)\\s*(${PY_DOTTED})?\\s*import(?![\\w\\u0080-\\uffff])\\s*([\\s\\S]*)$`);
export const dotted = (s) => s.replace(/\s+/g, '').split('.');

// ---- JS 一族：引用语句的样子（认引用的 code-imports.mjs 与取文件头说明的 code-heads.mjs 共用）----
// 从关键字之后起，读到模块名的字面量之前；只在抹掉了注释与字符串正文的源码上用。
export const JS_NAME = '[A-Za-z_$\\u0080-\\uffff][\\w$\\u0080-\\uffff]*';
export const JS_IMPORT = new RegExp(`\\s*(?:type\\s+)?(?:(${JS_NAME})\\s*,?\\s*)?(?:\\{([^}]*)\\}|(\\*)\\s*as\\s+${JS_NAME})?\\s*from\\s*(?=["'])`, 'y');
export const JS_EXPORT = new RegExp(`\\s*(?:type\\s+)?(?:(\\*)(?:\\s*as\\s+${JS_NAME})?|\\{([^}]*)\\})\\s*from\\s*(?=["'])`, 'y');

export function pyStatements(o) { // 以 import / from 开头的简单语句：[[起, 止]]，o 是抹掉了注释与字符串正文的源码
  const res = [];
  let depth = 0, atStart = true, cur = -1;
  const close = (i) => { if (cur >= 0) res.push([cur, i]); cur = -1; atStart = true; };
  for (let i = 0; i < o.length; i++) {
    const c = o[i];
    if (c === '\\' && (o[i + 1] === '\n' || (o[i + 1] === '\r' && o[i + 2] === '\n'))) { i += o[i + 1] === '\r' ? 2 : 1; continue; }
    if (c === '\n') { if (depth === 0) close(i); continue; }
    if (/\s/.test(c)) continue;
    if (depth === 0 && c === ';') { close(i); continue; }
    if (atStart) {
      atStart = false;
      const w = sticky(PY_KW, o, i);
      if (w) { cur = i; i += w.length - 1; continue; }
    }
    if (depth === 0 && c === ':' && cur < 0) atStart = true;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
  }
  close(o.length);
  return res;
}

// 入口：代码里有 if __name__ == "__main__":（两边倒过来写的也认）。脚本目录由它认，所以与解析放在一起。
export function pyMain(src, sp) {
  const o = sp.other, isMain = (p) => { const l = sp.byStart.get(p); return !!l && src.slice(l.bs, l.be) === '__main__' ? l : null; };
  for (const m of o.matchAll(/(?:^|\n)[ \t]*if[ \t(]+__name__\s*==\s*/g)) if (isMain(m.index + m[0].length)) return true;
  for (const m of o.matchAll(/(?:^|\n)[ \t]*if[ \t(]+(?=["'])/g)) {
    const l = isMain(m.index + m[0].length);
    if (l && sticky(/\s*==\s*__name__(?![\w\u0080-￿])/y, o, l.end)) return true;
  }
  return false;
}

// ---- 说明：统一缩进 ----
const expandTabs = (s) => { let r = ''; for (const ch of s) r += ch === '\t' ? ' '.repeat(8 - (r.length % 8)) : ch; return r; };
// first 为真时同 inspect.cleandoc：第一行只去行首空白，公共缩进只从第二行起算；为假时所有行一起算。全空返回 null。
export function cleandoc(lines, first) {
  const ls = lines.map(expandTabs);
  let margin = Infinity;
  ls.forEach((x, i) => { const t = x.trimStart(); if (t && (i > 0 || !first)) margin = Math.min(margin, x.length - t.length); });
  if (first) ls[0] = ls[0].trimStart();
  if (margin < Infinity) for (let i = first ? 1 : 0; i < ls.length; i++) ls[i] = ls[i].slice(margin);
  while (ls.length && !ls[ls.length - 1]) ls.pop();
  while (ls.length && !ls[0]) ls.shift();
  return ls.length ? ls.join('\n') : null;
}

// ---- 解析到文件 ----
// TypeScript 的引用里写的是编译后的扩展名（./a.js 指 a.ts）：原样没有这个文件时换成这几个再试（契约 B 节）。
const JS_SWAP = new Map([['.js', ['.ts', '.tsx']], ['.jsx', ['.ts', '.tsx']], ['.mjs', ['.mts']], ['.cjs', ['.cts']]]);
const TS_ONLY = /\.[mc]ts$/; // 是代码、却不在扫的扩展名里：对上了不当样式表一类放过，调用方按「不在扫的范围里」记
const CODE_EXT = [...JS_TRY, '.py']; // 代码文件的扩展名（同 langOf）

// files：codeRoots 下去掉 ignore 的全部文件——对上的代码文件不在这里面的（代码根之外、被 ignore 排掉的）不成边，由调用方用 listed 判。
// py：切得动的 Python 文件 [{ file, src, sp }]，用来定哪些目录是脚本目录、哪些代码根是包式的。
export function resolver(root, config, files, py) {
  const seen = new Map(), stat = (rel) => statSync(join(root, rel), { throwIfNoEntry: false });
  const isFile = (rel) => { const k = `f:${rel}`; if (!seen.has(k)) seen.set(k, stat(rel)?.isFile() ?? false); return seen.get(k); };
  const isDir = (rel) => { const k = `d:${rel}`; if (!seen.has(k)) seen.set(k, stat(rel)?.isDirectory() ?? false); return seen.get(k); };
  const norm = (d) => { const x = posix.normalize(String(d).replace(/\\/g, '/')).replace(/\/+$/, ''); return x === '.' ? '' : x; };
  const cat = (...xs) => xs.filter((x) => x !== '').join('/');
  const dirOf = (f) => { const d = posix.dirname(f); return d === '.' ? '' : d; };
  const inDir = (d, r) => r === '' || d === r || d.startsWith(`${r}/`);
  const hasInit = (d) => isFile(cat(d, '__init__.py'));
  const listed = new Set(files.filter(langOf));
  const roots = [...new Set((config.codeRoots ?? []).map(norm))], deep = [...roots].sort((a, b) => b.length - a.length);
  const ownRoot = (d) => deep.find((r) => inDir(d, r)); // 几个代码根互相套着时取最深的那个
  // 同一个名字既有 a/ 包又有 a.py 时 Python 先认包，这里同它。
  const pyFile = (dir, parts) => { const b = cat(dir, ...parts), init = cat(b, '__init__.py'); return isFile(init) ? init : parts.length && isFile(`${b}.py`) ? `${b}.py` : null; };

  // 脚本目录：没有 __init__.py、里面有带 __main__ 的文件——脚本直接运行时，解释器先在脚本自己的目录里找。
  const mainDirs = new Set(py.filter((x) => pyMain(x.src, x.sp)).map((x) => dirOf(x.file)));
  // 包式的代码根：有 __init__.py，并且项目里有一处引用按包的写法指进它——直接放在它下面的文件用了相对引用、子目录里的相对引用退到了它这一层，
  // 或者拿它的目录名当包名引用。有 __init__.py 而全用平铺写法的照旧是平铺的：起点是它自己。
  const pkg = new Set(), cands = roots.filter((r) => r !== '' && hasInit(r));
  for (const { file, sp } of cands.length ? py : []) {
    const d = dirOf(file);
    for (const [s, e] of pyStatements(sp.other)) {
      const t = sp.other.slice(s, e).replace(/\\\r?\n/g, ' ').trim(), m = PY_FROM.exec(t), dots = m ? m[1].length : 0;
      const firsts = m ? (dots || !m[2] ? [] : [dotted(m[2])[0]]) : (PY_IMPORT.exec(t)?.[1].split(',').map((x) => dotted(x.trim().split(/\s+as\s+/)[0])[0]) ?? []);
      for (const r of cands) {
        if (dots && inDir(d, r) && dots - 1 >= (d === r ? 0 : d.slice(r.length + 1).split('/').length)) pkg.add(r);
        if (firsts.includes(posix.basename(r))) pkg.add(r);
      }
    }
  }
  // 包式的代码根不当起点，起点是它上面第一个不含 __init__.py 的目录（最远到项目根）。
  const startOf = (r) => { if (!pkg.has(r)) return r; let d = dirOf(r); while (d !== '' && hasInit(d)) d = dirOf(d); return d; };
  const startsAt = new Map();
  const starts = (file) => { // 脚本目录 → 自己的代码根 → 别的代码根（照配置的先后）→ 项目根
    const d = dirOf(file);
    if (!startsAt.has(d)) {
      const own = ownRoot(d), list = mainDirs.has(d) && !hasInit(d) ? [d] : [];
      if (own !== undefined) list.push(startOf(own));
      startsAt.set(d, [...new Set([...list, ...roots.map(startOf), ''])]);
    }
    return startsAt.get(d);
  };
  // 能对上文件的最长前缀；几个起点都对得上时取最长的，一样长取先试的起点。
  const longest = (parts, file) => {
    let best = null;
    for (const s of starts(file)) for (let j = parts.length; j > (best?.j ?? 0); j--) { const f = pyFile(s, parts.slice(0, j)); if (f) { best = { j, f }; break; } }
    return best;
  };
  // 包式的代码根里没对上的绝对引用：第一段与这个根下直接放着的目录或 .py 同名、又不是标准库的，返回那个路径——
  // 它按包读指外部的包，从这个目录里直接启动时指那个文件，两种读法由调用方都摆出来，不猜。
  const shadow = (file, first) => {
    const own = ownRoot(dirOf(file));
    if (own === undefined || !pkg.has(own) || PY_STDLIB.has(first)) return null;
    const p = cat(own, first);
    return isDir(p) ? p : isFile(`${p}.py`) ? `${p}.py` : null;
  };
  const jsTarget = (file, spec) => {
    if (!/^\.\.?(?:\/|$)/.test(spec)) {
      if (/^[@~]\//.test(spec) || spec.startsWith('/')) return { to: null }; // 别名开头的现在不解析（契约 B 节）
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (spec.startsWith('node:') || NODE_BUILTIN.has(spec) || NODE_BUILTIN.has(name)) return { ext: null };
      // 第一段与某个代码根下直接放着的目录或代码文件（去掉扩展名）同名：多半是配了基准目录的项目内引用，不记成外部包，
      // 由调用方记进「没解析到的引用」。几个代码根照配置的先后，同一个根里先认目录。
      const near = roots.map((r) => cat(r, spec.split('/')[0])).map((p) => (isDir(p) ? p : CODE_EXT.map((x) => p + x).find(isFile))).find(Boolean);
      return near ? { to: null, near } : { ext: name };
    }
    const b = norm(posix.join(posix.dirname(file), spec));
    if (b === '..' || b.startsWith('../')) return { to: null };
    const x = posix.extname(b), swap = (JS_SWAP.get(x) ?? []).map((t) => b.slice(0, -x.length) + t);
    for (const c of [b, ...swap, ...JS_TRY.map((t) => `${b}${t}`), ...JS_TRY.map((t) => cat(b, `index${t}`))]) {
      if (c && isFile(c)) return langOf(c) || TS_ONLY.test(c) ? { to: c } : { asset: true }; // 样式表、JSON、图片：不成边，也不算没解析到
    }
    return { to: null };
  };
  return { pyFile, longest, shadow, jsTarget, listed: (f) => listed.has(f) };
}
