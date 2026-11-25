// check-read.mjs —— 核对器自带的最小页面读取器（契约 docs/readable-spec/phase1-db-contract.md H 节第 2、4 项；架构稿 §3 禁边）。
// 为什么自带：第 2 项要把磁盘上页面显示的东西读回来、与重新取的事实比；借出页面的代码去读，那段代码吞了一个列、串了一行，
// 读回来的会跟着错，两边错得一样看不出来。所以这里不 import render/ 下的任何东西，也不是完整的 HTML 解析器：
// 只认标签、属性与文字，够读 C 节「机器读得回来」的 data-anchor / data-k / data-note / data-state，以及第 4 项要的站内链接。
// 读不懂的写法不抛错，照字面当文字留着——宁可让比对报一条对不上，也不让一页读不出来就整次失败。
// 目录读取（reader）与站内链接（danglingLinks）原在 check.mjs，2026-11-23 第三期 Task 3.4 搬来给架构那一项腾地方；
// 架构这一份的行（sectionRows）照第三期契约 D 节末尾那张表读：data-section 里的 data-row 与 data-k。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { cmp } from './model.mjs';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
// 显示时自成一块的元素：读文字时前后补一个空白，免得两段贴成一个词；行内的（code、span、a、strong、wbr）不补。
const BLOCK = new Set(['address', 'article', 'blockquote', 'br', 'caption', 'dd', 'details', 'div', 'dl', 'dt', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// 字符引用：五个常用的名字、十进制与十六进制码点；不认识的照字面留着。
export function decode(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    const k = e.toLowerCase();
    return Object.hasOwn(NAMED, k) ? NAMED[k] : m;
  });
}

function attrsOf(raw) {
  const out = Object.create(null);
  for (const m of raw.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const k = m[1].toLowerCase();
    if (!Object.hasOwn(out, k)) out[k] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

// 读成一棵树：元素 {tag, attrs, children}，文字 {text}（字符引用已解开）。注释与 <!doctype> 丢掉；
// <style> / <script> 的内容不进树；关闭标签往上找同名的开着的元素，找不到就不理（手改坏的页面也读得下去）。
export function parse(src) {
  const root = { tag: '#root', attrs: Object.create(null), children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const text = (s) => { if (s) top().children.push({ text: decode(s) }); };
  const token = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/([A-Za-z][\w:-]*)[^>]*>|<([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0, m;
  while ((m = token.exec(src))) {
    text(src.slice(last, m.index));
    last = token.lastIndex;
    if (m[1]) {
      const i = stack.map((n) => n.tag).lastIndexOf(m[1].toLowerCase());
      if (i > 0) stack.length = i;
    } else if (m[2]) {
      const tag = m[2].toLowerCase(), raw = m[3] || '', selfClose = /\/\s*$/.test(raw);
      const node = { tag, attrs: attrsOf(raw.replace(/\/\s*$/, '')), children: [] };
      top().children.push(node);
      if (RAW.has(tag)) {
        const end = new RegExp(`</${tag}\\s*>`, 'gi');
        end.lastIndex = last;
        last = end.exec(src) ? end.lastIndex : src.length;
        token.lastIndex = last;
      } else if (!VOID.has(tag) && !selfClose) stack.push(node);
    }
  }
  text(src.slice(last));
  return root;
}

// 子孙里满足 pred 的元素，按文档先后。
export function findAll(node, pred, out = []) {
  for (const c of node.children || []) {
    if (!c.tag) continue;
    if (pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}

export const hasClass = (n, c) => String(n.attrs.class || '').split(/\s+/).includes(c);
// 空白归一：连续空白压成一个空格、去掉两头——页面显示时浏览器也是这样压的。
export const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// 一页上连着显示的一段段文字，给落盘前的隐去兜底用（契约 G 节末段、H 节「build 落盘之前」）：块与块之间断开、行内的连着——
// 名字里的 <wbr>、格子里的 <code> 把一串字切成几个文字节点，连起来才是读者看到的那一串；可也不能把相邻两格并成一句，
// 「password:」一格接着下一格的值会凑出原文里没有的命中。<title>、SVG 里的一行字各自成段；属性值各算一段（aria-label 等也是带出去的字）。
// 每段带着它在哪：最近的上一个标题与最近的 data-anchor，给人点名用。
const SEG_BREAK = new Set([...BLOCK, 'html', 'head', 'body', 'title', 'svg', 'text']);
export function segments(root) {
  const out = [];
  let buf = [], heading = '';
  const flush = (anchor) => { const s = squash(buf.join('')); buf = []; if (s) out.push({ text: s, heading, anchor }); };
  const walk = (n, anchor) => {
    for (const c of n.children) {
      if (!c.tag) { buf.push(c.text); continue; }
      const a = c.attrs['data-anchor'] ?? c.attrs['data-note'] ?? anchor;
      for (const v of Object.values(c.attrs)) if (v) out.push({ text: v, heading, anchor: a });
      if (RAW.has(c.tag)) continue;
      const b = SEG_BREAK.has(c.tag);
      if (b) flush(anchor);
      walk(c, a);
      if (b) flush(a);
      if (/^h[1-6]$/.test(c.tag)) heading = textOf(c);
    }
  };
  walk(root, null);
  flush(null);
  return out;
}

// 显示出来的纯文字：去掉标签、块与块之间隔一个空白、空白归一。skip 命中的元素连同里面的文字都不算。
export function textOf(node, skip = () => false) {
  const parts = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (!c.tag) { parts.push(c.text); continue; }
      if (RAW.has(c.tag) || skip(c)) continue;
      const b = BLOCK.has(c.tag);
      if (b) parts.push(' ');
      walk(c);
      if (b) parts.push(' ');
    }
  };
  walk(node);
  return squash(parts.join(''));
}

// 需求规格页上的块（第二期契约 docs/readable-spec/phase2-spec-contract.md C、D 节）：带 data-block 的元素按文档先后各读一块。
// 一块的文字不含嵌在它里面的别的块（列表项里嵌着子项）；表格行（tr）另按格读，一个 th / td 一格。
// 有序列表项前面显示的序号（data-k="marker"）另读进 marker、围栏起始行后面的字（data-k="info"）另读进 info，都不算进文字——
// 核对连它们一起比（D 节）；不止一处的用空格连起来，比的时候自然对不上。
// 结构（D 节 spec-structure）也从页面上读：tag 是这一块的标签（标题的级数看它），up 是包着它的最近一个带 data-block 的元素读出的那一块——
// 列表子项挂在谁下面按元素的嵌套读，不看出页面的代码写的任何父项属性。
// 只认 data-block / data-anchor / data-k / data-fig 与表格的标签，不认样式类名。
// 图（data-fig 的元素，步骤图与流程链图）整个跳过：嵌在某一块里面的图（子列表的步骤图、句子后面的流程链），它的字不算进那一块，
// 它的序号（data-k="marker"）也不当那一块的序号；图里的字另由 specFigs 读、核对器另比（D 节 spec-figure）。
const isFig = (n) => n.attrs['data-fig'] !== undefined;
export function specBlocks(root) {
  const isBlock = (n) => n.attrs['data-block'] !== undefined, isMark = (n) => n.attrs['data-k'] === 'marker', isInfo = (n) => n.attrs['data-k'] === 'info';
  const own = (n, pred, out = []) => { for (const c of n.children) { if (!c.tag || isBlock(c) || isFig(c)) continue; if (pred(c)) out.push(c); else own(c, pred, out); } return out; };
  const out = [];
  const walk = (n, up) => {
    for (const c of n.children) {
      if (!c.tag || isFig(c)) continue;
      if (!isBlock(c)) { walk(c, up); continue; }
      const b = { n: c.attrs['data-block'], anchor: c.attrs['data-anchor'] ?? null, tag: c.tag, up, text: textOf(c, (x) => isBlock(x) || isMark(x) || isInfo(x) || isFig(x)) };
      const mk = own(c, isMark), inf = own(c, isInfo);
      if (mk.length) b.marker = mk.map((m) => textOf(m)).join(' ');
      if (inf.length) b.info = inf.map((m) => textOf(m)).join(' ');
      if (c.tag === 'tr') b.cells = c.children.filter((x) => x.tag === 'td' || x.tag === 'th').map((x) => textOf(x, (y) => isBlock(y) || isFig(y)));
      out.push(b);
      walk(c, b);
    }
  };
  walk(root, null);
  return out;
}

// 引用为打印另备的那一份（第二期契约 C、D 节）：带 data-print-of 的元素，of 是它对着的那块屏幕上的 data-block。
export const specPrints = (root) => findAll(root, (n) => n.attrs['data-print-of'] !== undefined).map((n) => ({ of: n.attrs['data-print-of'], text: textOf(n, isFig) }));

// 页面上的图（第二期契约 C、D 节「图不许编字」）：带 data-fig 的元素，of 是它点名的那几块的全局序号（逗号隔开的原文）；
// 方框是图里的每一个 SVG <text>，读它显示的字，序号（data-k="marker"）除外。图的说明（<figcaption>、<title>）不是方框。
export const specFigs = (root) => findAll(root, isFig).map((n) => ({
  of: n.attrs['data-fig'], boxes: findAll(n, (x) => x.tag === 'text').map((t) => textOf(t, (x) => x.attrs['data-k'] === 'marker')),
}));

// 目录下的文件（相对路径、/ 分隔、按名字定序）与按需读成树的页面。
export function reader(dir) {
  const files = [];
  const visit = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visit(join(d, e.name), r);
      else if (e.isFile()) files.push(r);
    }
  };
  if (existsSync(dir)) visit(dir, '');
  const cache = new Map();
  const tree = (rel) => { if (!cache.has(rel)) cache.set(rel, parse(readFileSync(join(dir, rel), 'utf8'))); return cache.get(rel); };
  return { dir, files, html: files.filter((f) => f.endsWith('.html')), tree };
}

// 第 4 项的后一半（第一期契约 H 节）：站内链接的目标文件不在的。带协议的、只有 # 的不是站内的页。
export function danglingLinks(rd, label) {
  const out = [], files = new Set(rd.files);
  for (const rel of rd.html) {
    for (const a of findAll(rd.tree(rel), (n) => n.tag === 'a' && n.attrs.href !== undefined)) {
      const href = a.attrs.href.trim(), path = href.split('#')[0].split('?')[0];
      if (!path || href.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(href)) continue;
      const add = (detail) => out.push({ kind: 'dangling', where: label + rel, detail });
      let dec;
      try { dec = decodeURIComponent(path); } catch (e) { if (!(e instanceof URIError)) throw e; add(`链接「${href}」的写法读不懂`); continue; }
      const target = posix.normalize(posix.join(posix.dirname(rel), dec));
      if (posix.isAbsolute(dec) || target === '..' || target.startsWith('../')) add(`链接「${href}」指到了文档集外面`);
      else if (!files.has(target)) add(`链接「${href}」指向的 ${target} 不存在`);
    }
  }
  return out;
}

// 架构这一份的一段（第三期契约 D 节末尾）：name 为 null 时读整页的行。每行 {key, k}：key 是 data-row 的值，
// k 是行里各个 data-k 的文字（同一个 data-k 出现几处的，文字用「 | 」连起来，比的时候自然对不上）。
// 段出现了几处（sections）一并交回：缺了这一段或重了，调用方要点名。
export function sectionRows(tree, name) {
  const secs = name == null ? [tree] : findAll(tree, (n) => n.attrs['data-section'] === name);
  const rows = secs.flatMap((s) => findAll(s, (n) => n.attrs['data-row'] !== undefined)).map((r) => {
    const k = {};
    for (const c of findAll(r, (n) => n.attrs['data-k'] !== undefined)) k[c.attrs['data-k']] = k[c.attrs['data-k']] === undefined ? textOf(c) : `${k[c.attrs['data-k']]} | ${textOf(c)}`;
    return { key: r.attrs['data-row'], k, node: r };
  });
  return { sections: secs.length, rows };
}

// 来源里一段文字去掉行内记号之后显示出来的样子（第二期契约 D 节）。出页面那边也有一份同样的规矩（render/spec-inline.mjs），
// 禁边不许这里借它的，照规矩自己写一份，两份对同样的输入出同样的纯文字：
// `等宽` 是 N 个反引号起、到下一串恰好 N 个反引号止，里面原样、不再认记号；收不了尾的反引号照字面。
// ** 与 ~~ 在等宽之外从左往右配：后面紧跟非空白的能起；前面紧跟非空白、与起的之间隔着东西的能收；
// 收的时候夹在中间没配上的起记号作废。配上的不显示，配不上的照字面。
export function plainMarks(s) {
  const parts = [];
  let i = 0, text = '';
  const keep = () => { if (text) parts.push({ lit: text }); text = ''; };
  while (i < s.length) {
    if (s[i] === '`') {
      let j = i;
      while (s[j] === '`') j++;
      const run = j - i;
      let k = j, close = -1;
      while (k < s.length) {
        if (s[k] !== '`') { k++; continue; }
        let e = k;
        while (s[e] === '`') e++;
        if (e - k === run) { close = k; break; }
        k = e;
      }
      if (close < 0) { text += s.slice(i, j); i = j; } else { text += s.slice(j, close); i = close + run; }
      continue;
    }
    const d = s.slice(i, i + 2);
    if (d === '**' || d === '~~') { keep(); parts.push({ mark: d, at: i }); i += 2; continue; }
    text += s[i++];
  }
  keep();
  const stack = [];
  parts.forEach((p, k) => {
    if (!p.mark) return;
    const before = s[p.at - 1], after = s[p.at + 2];
    let o = stack.length - 1;
    while (o >= 0 && parts[stack[o]].mark !== p.mark) o--;
    if (o >= 0 && before !== undefined && /\S/.test(before) && stack[o] !== k - 1) { parts[stack[o]].gone = true; p.gone = true; stack.splice(o); return; }
    if (after !== undefined && /\S/.test(after)) stack.push(k);
  });
  return parts.map((p) => (p.mark ? (p.gone ? '' : p.mark) : p.lit)).join('');
}
