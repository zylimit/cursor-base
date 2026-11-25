// spec-blocks.mjs —— 需求规格的块怎么排（契约 docs/readable-spec/phase2-spec-contract.md C 节）：一块一个带 data-block 与 id 的元素，照来源的先后；
// 列表照树嵌套、表格行成表、引用收进可展开的区、围栏原样等宽；同一层连着三步以上的有序列表前面加一张步骤图，
// 用「→」连着三段以上的短句后面加一条流程链图（图在 spec-figures.mjs）。
// 核对器按 data-block 把每块读回来（文字不含嵌在里面的子块与图），所以块里只放这一块的字：另加的导读——目录、引用的标题、
// 打印用的那一份引用——都不带 data-block，也不放进带 data-block 的元素里；图带 data-fig，嵌在块里的（子列表的步骤图、句子后面的流程链）
// 读回时整个跳过；打印用的那一份带 data-print-of，核对器另比它的字。每块开头一个指向自己的链接记号，自己不带字。
// 引用为什么另备一份打印用的：合着的 <details> 打印时里面的字不出，不用脚本又没有各家浏览器都认的办法让它打印时自己展开
// （::details-content 太新，内网的旧浏览器不认）；两份是同一个字符串，只有屏幕上那份带 data-block，同一块读回来只有一次。
import { esc, attrs } from './layout.mjs';
import { inline, SPLIT_OVER } from './spec-inline.mjs';
import { flat, cut, selfLink, stepsFigure, chainFigs, STEP_MIN } from './spec-figures.mjs';

const QUOTE_HEAD = 60; // 引用的标题后面接它的第一行，屏幕上一行放得下的长度；全文在展开的区里

// ids：这一页各块的 id（spec-figures.mjs 的 blockIds），一页一份，同页不重。
const mark = (b, ids) => attrs({ id: ids.get(b.n), 'data-block': String(b.n), 'data-anchor': b.anchor });
const self = (b, ids) => selfLink(ids.get(b.n));
const long = (s) => Array.from(s).length > SPLIT_OVER;
// 列表项的记号（模型的 marker，如「-」「3.」「2)」）：数字加「.」或「)」的是有序的。没有 marker 的一律按无序排。
const ordered = (b) => /^\d+[.)]$/.test(String(b.marker ?? '').trim());
// 同一张表：紧挨着上一行表格行；表头那一行下面隔着分隔行。
export const sameTable = (prev, b) => prev?.kind === 'table' && b.kind === 'table' && (b.line === prev.endLine + 1 || (prev.header && b.line === prev.line + 2));

// 一串连着的列表项成树：parent 指向的项在这一串里就挂在它下面，否则是这一串的顶层。
function tree(run) {
  const inRun = new Set(run.map((b) => b.n)), kids = new Map(), roots = [];
  for (const b of run) {
    if (b.parent != null && inRun.has(b.parent)) { if (!kids.has(b.parent)) kids.set(b.parent, []); kids.get(b.parent).push(b); }
    else roots.push(b);
  }
  return { kids, roots };
}
// 同一层里有序与无序连着的各成一段；有序的一段够三步就是一张步骤图（不管前面是不是标题、是不是嵌在某一条下面，契约 C 节）。
function runs(list) {
  const out = [];
  for (let k = 0; k < list.length;) {
    const ord = ordered(list[k]);
    let e = k;
    while (e < list.length && ordered(list[e]) === ord) e++;
    out.push({ ord, items: list.slice(k, e), steps: ord && e - k >= STEP_MIN });
    k = e;
  }
  return out;
}

// 有序的项把记号原文显示在前面（data-k="marker"，核对器连序号一起比），不用浏览器自动编的号：
// 来源里偷懒写成三个「1.」的，页面上照原文是三个「1.」，不替人改成 1、2、3（契约 C 节）。
// 子列表的步骤图放在父项里、子列表前面，带 data-fig，父项读回来的字不含图里的字。
// 已经画进步骤图的那几步不再各自画流程链图：同一件事不画两遍（契约 C 节；下游一段六步，每一步自己又是一条箭头链，
// 两样都画时一屏里一张步骤图加五条链图）。没画步骤图的有序项（只有两步的）里面的箭头链照旧画。
function listHtml(run, ids) {
  const { kids, roots } = tree(run);
  const item = (inSteps) => (b) => {
    const mk = ordered(b) ? `<span class="mk" data-k="marker">${esc(b.marker)}</span>` : '';
    return `<li${mark(b, ids)}>${self(b, ids)}${mk}${inline(b.text, { split: long(b.text), term: true, figs: inSteps ? null : chainFigs(b) })}${kids.has(b.n) ? `\n${group(kids.get(b.n))}` : ''}</li>`;
  };
  const group = (list) => runs(list).map((r) => {
    const body = r.items.map(item(r.steps)).join('\n');
    return r.ord ? `${r.steps ? `${stepsFigure(r.items)}\n` : ''}<ol class="om">\n${body}\n</ol>` : `<ul>\n${body}\n</ul>`;
  }).join('\n');
  return group(roots);
}

// 一页的块里画了的各张步骤图，每张是它那几步的块：清单页的导读只在真有步骤图时才提它，数流程链图时除开这几步。
export function stepFigures(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length;) {
    let j = i + 1;
    if (blocks[i].kind === 'list') {
      while (j < blocks.length && blocks[j].kind === 'list') j++;
      const { kids, roots } = tree(blocks.slice(i, j));
      for (const list of [roots, ...kids.values()]) for (const r of runs(list)) if (r.steps) out.push(r.items);
    }
    i = j;
  }
  return out;
}

function tableHtml(rows, ids) {
  const tr = (b, cell) => `<tr${mark(b, ids)}>${b.cells.map((c, x) => `<${cell}>${x ? '' : self(b, ids)}${inline(c)}</${cell}>`).join('')}</tr>`;
  const head = rows.filter((b) => b.header), body = rows.filter((b) => !b.header);
  return `<div class="scroll"><table class="st">\n${head.length ? `<thead>${head.map((b) => tr(b, 'th')).join('\n')}</thead>\n` : ''}${body.length ? `<tbody>\n${body.map((b) => tr(b, 'td')).join('\n')}\n</tbody>` : ''}</table></div>`;
}

// 引用：屏幕上收进 <details>，标题写「引用（N 行）」加它的第一行；行与行照原文分开（样式 pre-line），所以块里的 HTML 不许多出换行。
// 超过 200 个字的行各自分句（契约 C 节「引用里的每一行都算」），短的行照原样。打印用的那一份另出一遍：流程链图里箭头记号的 id 换一个前缀，同页不重。
function quoteHtml(b, ids) {
  const label = `引用（${b.endLine - b.line + 1} 行）`, head = cut(flat(b.text.split('\n')[0]), QUOTE_HEAD);
  const body = (tag) => inline(b.text, { split: 'line', figs: chainFigs(b, tag) });
  return `<details class="q"><summary>${label}${head ? `<span class="qt">：${esc(head)}</span>` : ''}</summary><div class="qb"${mark(b, ids)}>${self(b, ids)}${body('ca')}</div></details>\n`
    + `<div class="print-only"><p class="qt">${label}</p><div class="qb"${attrs({ 'data-print-of': String(b.n) })}>${body('cp')}</div></div>`;
}

// 围栏：原样等宽显示；起始行后面的字（info：text、json，或者一句说明）是来源里的字，显示在它上面、带 data-k="info"，
// 核对器连它一起比（契约 C、D 节）。没有 info 的照旧只是一个 <pre>。
function fenceHtml(b, ids) {
  const code = `<code>${esc(b.text)}</code>`;
  return b.info ? `<div class="fence"${mark(b, ids)}>${self(b, ids)}<p class="fi" data-k="info">${esc(b.info)}</p><pre>${code}</pre></div>` : `<pre${mark(b, ids)}>${self(b, ids)}${code}</pre>`;
}

const ONE = {
  // 标题用与来源同级的标签（来源的二级标题就是 <h2>），核对器按标签读级数（契约 C、D 节）。
  heading: (b, ids) => { const L = Math.min(6, Math.max(1, b.level ?? 1)); return `<h${L}${mark(b, ids)}>${self(b, ids)}${inline(b.text)}</h${L}>`; },
  quote: quoteHtml,
  fence: fenceHtml,
  // 分隔线：<hr> 里放不了链接记号，外面包一层带 data-block 的 <div>。
  hr: (b, ids) => `<div class="hr"${mark(b, ids)}>${self(b, ids)}<hr></div>`,
  paragraph: (b, ids) => `<p${mark(b, ids)}>${self(b, ids)}${inline(b.text, { split: long(b.text), figs: chainFigs(b) })}</p>`,
};

// 一页的块 → HTML，照来源的先后。toc（本章目录）放在第一块是标题时它的后面，否则放最前面。认不得的种类按段落排，不丢。
export function renderBlocks(blocks, toc, ids) {
  const out = toc && blocks[0]?.kind !== 'heading' ? [toc] : [];
  for (let i = 0; i < blocks.length;) {
    const b = blocks[i];
    let j = i + 1;
    if (b.kind === 'list') {
      while (j < blocks.length && blocks[j].kind === 'list') j++;
      out.push(listHtml(blocks.slice(i, j), ids));
    } else if (b.kind === 'table') {
      while (j < blocks.length && sameTable(blocks[j - 1], blocks[j])) j++;
      out.push(tableHtml(blocks.slice(i, j), ids));
    } else out.push((ONE[b.kind] || ONE.paragraph)(b, ids));
    if (i === 0 && toc && b.kind === 'heading') out.push(toc);
    i = j;
  }
  return out.join('\n');
}

// 需求规格的页面多要的样式，接在共用样式后面（layout.mjs 的 page 的 css）。
// 有序列表不要浏览器的号，记号原文挂在每一项左边的留白里、对齐第一行，序号长了往左伸，不挤正文。
// 链接记号挂在每块左边的留白里、不占位：列表项的挪到圆点或序号的左边，表格、围栏、引用的挪进自己的内边距里。
export const SPEC_CSS = `
.src{color:var(--muted);font-size:14px;border-left:3px solid var(--line);padding:2px 10px;margin:12px 0 20px}
.spec h1{font-size:26px}
.spec ul,.spec ol{padding-left:24px;margin:8px 0}
.spec ol.om{list-style:none;padding-left:40px}
.spec ol.om>li{position:relative}
.spec ol.om>li>.mk{position:absolute;right:calc(100% + 8px);top:0;white-space:nowrap;font-weight:600;color:var(--accent);font-variant-numeric:tabular-nums}
.spec li{margin:8px 0}
.spec li>ul,.spec li>ol{margin:6px 0}
.term{display:block;margin-bottom:2px}
.sb{display:block;height:4px}
.pl{position:absolute;transform:translateX(calc(-100% - 4px));padding:0 2px;color:var(--muted);font-weight:400;text-decoration:none;opacity:0}
.pl::before{content:"#"}
li>.pl{transform:translateX(calc(-100% - 20px))}
ol.om>li>.pl{transform:translateX(calc(-100% - 36px))}
td>.pl,th>.pl,pre>.pl,.qb>.pl{transform:translateX(-100%)}
[data-block]:hover>.pl,[data-block]:hover>td>.pl,[data-block]:hover>th>.pl,.pl:focus-visible{opacity:1}
details.q{margin:2px 0;padding:0 10px;border-left:3px solid var(--line)}
details.q summary{cursor:pointer;color:var(--fg)}
.qt{color:var(--muted)}
.qb{white-space:pre-line;font-size:15px;padding:2px 0 8px}
.fence .fi{margin:12px 0 2px;font-size:14px;color:var(--muted)}
.fence>pre{margin-top:0}
table.st th,table.st td:first-child{white-space:normal}
table.st th{color:var(--fg);background:var(--soft)}
nav.toc{border:1px solid var(--line);border-radius:4px;padding:6px 16px;margin:12px 0 20px;font-size:15px}
nav.toc ul{list-style:none;padding-left:0;margin:4px 0}
nav.toc li.l4{padding-left:16px}
nav.toc li.l5,nav.toc li.l6{padding-left:32px}
nav.toc ul.it{column-width:20em;column-gap:28px;font-size:14px;margin:2px 0 8px}
nav.toc li>ul.it{padding-left:16px}
nav.toc ul.it>li{break-inside:avoid;margin:1px 0}
figure.steps{margin:12px 0 4px}
figure.steps figcaption{font-size:13px;color:var(--muted)}
.chain{display:block;overflow-x:auto;max-width:100%;margin:6px 0 8px;white-space:normal}
svg.steps{display:block}
svg.steps rect{fill:var(--soft);stroke:var(--accent);stroke-width:1.2}
svg.steps text{font:14px system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;fill:var(--fg)}
svg.steps .no{font-weight:700;fill:var(--accent)}
svg.steps path.e{fill:none;stroke:var(--muted);stroke-width:1.2}
svg.steps path.ah{fill:var(--muted)}
@media print{details.q{display:none}.print-only .qb{border-left:3px solid var(--line);padding-left:10px}svg.steps{max-width:100%;height:auto}.chain{overflow:visible}.pl{display:none}}
`.trim();
