// layout.mjs —— 各类文档共用的版式件：页面骨架与内联样式、出处标记、表格、文档集首页、关系图的排布与 SVG
// （架构稿 docs/readable-spec/Architecture-Design.md §2 render、§5「渲染器按文档种类分文件，共用版式件」）。
// 只产字符串、不碰磁盘：落盘（临时目录 + 整目录替换）在同目录的 publish.mjs。每页自成一体——样式内联、不引外部文件、不联网；
// 页面里不写生成时间、机器名、绝对路径，同样的模型两次出的字节相同（契约 docs/readable-spec/phase1-db-contract.md C 节）。
// 版式从朴素出发：系统无衬线字体、宽行距、细线分行、只用一种强调色；字段表这类宽表定列宽、长内容折行，1280 宽下不出横向滚动条，
// 窄屏才在自己的框里横向滚，页面本身不出横向滚动条；打印时定宽表不保底宽度、长内容一律折行，不被纸边裁掉。
import { cmp } from '../model.mjs';

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c]);
export const code = (s) => `<code>${esc(s)}</code>`;
// 名字与表达式：下划线后面给一个折行点（<wbr> 不改文字），定宽的窄格子里折在词缝上，不从一个词中间断开。
export const codeBreak = (s) => `<code>${esc(s).replace(/_/g, '_<wbr>')}</code>`;
// 来源里的原文（注释、视图定义）保留换行，长行在格子里折。
export const multi = (s) => `<span class="pre">${esc(s)}</span>`;
export const at = (file, line) => `${esc(file)} 第 ${esc(line)} 行`;

// 出处标记（契约 C 节）：第一期三种，谁写谁读从代码里查出来的也是「取自来源」，括号里点明是代码里的 SQL（契约 F 节）。
// 标签用这几个现成说法，不另起名字。
const ORIGINS = { fact: '取自来源', code: '取自来源（代码里的 SQL）', comment: '来源里的注释', note: '说明' };
export const origin = (kind) => `<span class="o o-${kind === 'code' ? 'fact' : kind}">${ORIGINS[kind]}</span>`;
// 项目判断（docs/readable-src/map.json，人和 AI 编辑）补的东西不是从来源里查出来的，标明是谁的判断（契约 F 节）。
// 按前缀机械分出来的组档位是 default，不标——那不是谁的判断。
const JUDGED = { proposed: '项目判断 · AI 提议', confirmed: '项目判断 · 人已确认' };
export const judged = (status) => (JUDGED[status] ? `<span class="o o-judged">${JUDGED[status]}</span>` : '');

// 文件名由名字推出，同一个名字永远落在同一个地址：只留小写字母、数字、下划线、连字符，其余写成「~码点」，
// 免得带引号的表名里的斜杠、空格或中文在别的系统上解压出乱码或断链。大写字母也转码：带引号建的 "Orders" 与 orders
// 在不分大小写的文件系统上（Windows、macOS 默认）会互相覆盖（契约 C 节「分组」）。
export const fileSlug = (name) => String(name).replace(/[^a-z0-9_-]/gu, (c) => `~${c.codePointAt(0).toString(16)}`);

// 属性按给的顺序写出，值转义。核对器靠 data-anchor / data-k / data-note 从页面上把显示的东西读回来（契约 C 节「机器读得回来」）。
export const attrs = (o) => (o ? Object.entries(o).map(([k, v]) => ` ${k}="${esc(v)}"`).join('') : '');
// 格子是 HTML 字符串，或 {attrs, html}；行是格子数组，或 {attrs, cells}。
const td = (c) => (c && typeof c === 'object' ? `<td${attrs(c.attrs)}>${c.html}</td>` : `<td>${c}</td>`);
const tr = (r) => (Array.isArray(r) ? `<tr>${r.map(td).join('')}</tr>` : `<tr${attrs(r.attrs)}>${r.cells.map(td).join('')}</tr>`);
// widths 给了就定列宽（null 的列分剩下的宽度）：列宽不随内容撑开，长内容在格子里折行，表格不比外框宽——
// 第一版按内容撑宽，15 个字段的表在 1280 宽下把注释一栏挤出了可见区。窄屏表格保底一个宽度，在自己的框里横向滚。
export const table = (head, rows, widths) => {
  const cg = widths ? `<colgroup>${widths.map((w) => (w ? `<col style="width:${w}">` : '<col>')).join('')}</colgroup>\n` : '';
  return `<div class="scroll"><table${widths ? ' class="fixed"' : ''}>\n${cg}<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>\n<tbody>\n${rows.map(tr).join('\n')}\n</tbody></table></div>`;
};

const CSS = `
:root{--fg:#1f2328;--muted:#59636e;--line:#d8dee4;--bg:#fff;--soft:#f6f8fa;--accent:#0b5cad;--warn:#fff8e1;--warn-line:#d4a72c}
@media (prefers-color-scheme:dark){:root{--fg:#e6e8eb;--muted:#9ba5b0;--line:#3a424b;--bg:#15181c;--soft:#1e2328;--accent:#76adf0;--warn:#33291a;--warn-line:#9a7a26}}
@media print{:root{--fg:#000;--muted:#444;--line:#bbb;--bg:#fff;--soft:#f4f4f4;--accent:#000;--warn:#fff;--warn-line:#888}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;overflow-wrap:break-word}
main{max-width:1100px;margin:0 auto;padding:20px 16px 64px}
a{color:var(--accent);text-underline-position:under}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.crumbs{font-size:14px;color:var(--muted)}
h1{font-size:28px;line-height:1.3;margin:12px 0 4px}
h2{font-size:20px;line-height:1.4;margin:40px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:17px;margin:28px 0 6px}
p{margin:8px 0}
.lead{color:var(--muted)}
.muted{color:var(--muted)}
.nw{white-space:nowrap}
.o{display:inline-block;font-size:12px;font-weight:400;line-height:1.6;padding:0 6px;margin-left:8px;border:1px solid var(--line);border-radius:3px;color:var(--muted);vertical-align:middle;white-space:nowrap}
.o-comment{border-style:dashed}
.o-note{border-color:var(--accent);color:var(--accent)}
.o-judged{border-style:dotted;border-color:var(--fg);color:var(--fg)}
details.more{margin:8px 0}
details.more summary{cursor:pointer;color:var(--accent)}
.print-only{display:none}
.scroll{overflow-x:auto;max-width:100%;margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.55}
th,td{text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
th{font-weight:600;color:var(--muted);white-space:nowrap}
td:first-child{white-space:nowrap}
table.fixed{table-layout:fixed;min-width:860px}
table.fixed th,table.fixed td:first-child{white-space:normal}
table.fixed td{overflow-wrap:anywhere}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:13px}
td code{white-space:pre-wrap}
.pre{white-space:pre-wrap}
pre{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;background:var(--soft);padding:10px 12px;margin:0;overflow-x:auto}
ul{padding-left:22px}
.notice{border:1px solid var(--warn-line);background:var(--warn);padding:10px 16px;margin:16px 0;border-radius:4px}
.notice ul{margin:6px 0}
dl.legend dt{margin-top:8px}
dl.legend dd{margin:2px 0 0 0;color:var(--muted)}
svg.er{display:block}
svg.er text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:12px;fill:var(--fg)}
svg.er text.tt{font-size:13px;font-weight:700;fill:var(--accent)}
svg.er rect{fill:var(--bg);stroke:var(--muted);stroke-width:1}
svg.er rect.f{stroke:var(--accent);stroke-width:2.5}
svg.er line{stroke:var(--line)}
svg.er path.e{fill:none;stroke:var(--muted);stroke-width:1.2}
svg.er path.ah{fill:var(--muted)}
svg.er text.n{font-size:11px;fill:var(--muted);stroke:var(--bg);stroke-width:3px;paint-order:stroke}
.o-stale{border-color:var(--warn-line);background:var(--warn);color:var(--fg)}
.note ul{margin:6px 0}
td .m p,td .m ul{margin:2px 0}
td .m ul{padding-left:18px}
td .m+.m{margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)}
.m>.o:first-child{margin-left:0}
@media print{main{max-width:none;padding:0}.scroll{overflow:visible}table.fixed{min-width:0}td{overflow-wrap:anywhere}.nw{white-space:normal}pre{white-space:pre-wrap}svg.er{max-width:100%;height:auto}a{text-decoration:none}h2{break-after:avoid}tr{break-inside:avoid}details.more{display:none}.print-only{display:block}}
`.trim();

// 页面骨架。crumbs 的地址都相对文档集根目录写，这里按页所在深度补 ../。
// main 是 <main> 上的属性（表页的 data-anchor）。css 是某一类文档自己多要的样式，接在共用样式后面；
// 不给就一个字节不多——数据库设计的页面不给，加这个参数之前出的页面与之后逐字节相同。
export function page({ title, depth = 0, crumbs = [], body, main, css }) {
  const up = '../'.repeat(depth);
  const nav = crumbs.length
    ? `<nav class="crumbs">${crumbs.map(([t, h]) => (h ? `<a href="${esc(up + h)}">${esc(t)}</a>` : `<span>${esc(t)}</span>`)).join(' › ')}</nav>\n`
    : '';
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>\n${CSS}${css ? `\n${css}` : ''}\n</style>\n</head>\n<body>\n<main${attrs(main)}>\n${nav}${body}\n</main>\n</body>\n</html>\n`;
}

export const LEGEND = `<h2>页面上的标记</h2>
<dl class="legend">
<dt>${origin('fact')}</dt><dd>结构直接取自项目的来源文件（建表定义等），由命令机械生成；谁写谁读查的是代码里的 SQL，标「取自来源（代码里的 SQL）」。</dd>
<dt>${origin('comment')}</dt><dd>来源文件里作者写的注释（<code>--</code> 与 <code>COMMENT ON</code>），原样照录；来源里没写的地方留空。</dd>
<dt>${origin('note')}</dt><dd>AI 写的解释，不是来源本身；还没写的地方标「说明：未写」。「说明 · 草稿」还没有人抽审过；「说明 · 已抽审」写着是谁、哪天对着来源看过。</dd>
<dt><span class="o o-stale">待更新</span></dt><dd>这段说明写于来源的旧版本：写完之后来源改过，说明可能过时，原文照显；机械取出的部分仍是现行的，先看结构与代码位置。</dd>
<dt>〔已隐去〕</dt><dd>来源或说明里形如内网地址、带口令的地址或密钥的字样，页面上换掉了，原文只在来源里；数据库设计清单页顶上列着各在哪里。</dd>
<dt>${judged('proposed')} ${judged('confirmed')}</dt><dd>项目判断：人和 AI 补的判断（<code>docs/readable-src/map.json</code>），比如表怎么分组、运行时拼的表名归到哪张表，不是从来源里查出来的。「AI 提议」还没有人确认过。</dd>
</dl>`;

// 文档集首页（契约 C 节 index.html）：列出已经生成的各份文档。docs：[{href,label,summary}]
export function renderHome(title, docs) {
  const items = docs.map((d) => `<li><a href="${esc(d.href)}">${esc(d.label)}</a> <span class="muted">${esc(d.summary)}</span></li>`).join('\n');
  const body = `<h1>${esc(title)}</h1>\n<p class="lead">工程文档。各份文档都由项目的来源文件生成，页面上每段内容都标了来历。</p>\n<h2>文档</h2>\n<ul>\n${items}\n</ul>\n${LEGEND}`;
  return { path: 'index.html', html: page({ title: `${title} · 工程文档`, body }) };
}

// ---- 关系图（契约 C 节）----
// 一张表一个方框，写表名与 lines（主键、外键列）；parents 是组内被它引用的表，画成连线，箭头指向被引用的一方。
// focus 的方框框线加粗、用强调色：表页的小关系图里那是这一页讲的表。
// 简单分层：被引用的在上、引用别人的在下，层号 = 沿组内外键往上走的最长步数，遇环截断；层内按上一层父表的平均位置排、同位按名字。
// 组内没有任何连线的表单独放最后一层。一层放不下就折行，每行不超过 ROW_W，桌面宽度内放得下；窄屏在外框里横向滚。
// 隔行的连线不从中间那行的方框背后穿（2026-11-23 小样里看出来，穿过去像是中间那张表在引用）：先进行间空隙，走左边的竖道，再进目标行的空隙。
export const DIAGRAM_MAX = 12;
const ROW_W = 1040, GAP_X = 36, GAP_Y = 60, M = 8, PAD = 10, TITLE_H = 24, LINE_H = 17, FONT = 12, LANE = 10;
const r1 = (v) => Math.round(v * 10) / 10;
// 等宽字体下的估宽：西文约 0.62em，中日韩按满格算。宁宽勿窄，免得字压到框线上。
export const textW = (s, px) => Array.from(s).reduce((w, c) => w + (c.codePointAt(0) > 0x2e7f ? px : px * 0.62), 0);

function layers(nodes) {
  const by = new Map(nodes.map((n) => [n.name, n])), depth = new Map(), busy = new Set();
  const linked = new Set(nodes.flatMap((n) => (n.parents.length ? [n.name, ...n.parents] : [])));
  const d = (n) => {
    if (depth.has(n.name)) return depth.get(n.name);
    if (busy.has(n.name)) return 0; // 成环：从这里截断
    busy.add(n.name);
    const v = n.parents.length ? 1 + Math.max(...n.parents.map((p) => d(by.get(p)))) : 0;
    busy.delete(n.name);
    depth.set(n.name, v);
    return v;
  };
  const sorted = [...nodes].sort((a, b) => cmp(a.name, b.name));
  const out = [];
  for (const n of sorted) if (linked.has(n.name)) (out[d(n)] ||= []).push(n);
  const pos = new Map();
  const ordered = out.filter(Boolean).map((L, k) => {
    const bary = (n) => {
      const ps = n.parents.filter((p) => pos.has(p)).map((p) => pos.get(p));
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
    };
    const order = k === 0 ? L : [...L].sort((a, b) => bary(a) - bary(b) || cmp(a.name, b.name));
    order.forEach((n) => pos.set(n.name, pos.size));
    return order;
  });
  const alone = sorted.filter((n) => !linked.has(n.name));
  return alone.length ? [...ordered, alone] : ordered;
}

// 方框可以另给 label（显示的名字，不给就显示 name；name 只当键用，分组关系图里是组 id）与 counts（{被引用的 name: 条数}，写在那条线上）；
// max 是这张图最多几个方框，默认同组页的 12（分组关系图是 20，契约 F 节）。
// rowGap 给了就用它当行距、底下不留绕线的半格：没有连线的图（需求规格的章节地图）用不着给连线留的大空隙。
// 不给就照旧——数据库设计的各张图不给，加这个参数之前出的页面与之后逐字节相同。
// rows 给了就按它排行（方框的数组的数组，从上到下），不按引用的深浅分层：架构总图按项目判断的层排模块（第三期契约 D 节）。
// 一行放不下照旧折行，连线的画法不变。不给就照旧，同上。
export function diagram(nodes, label, max = DIAGRAM_MAX, { rowGap, rows: fixedRows } = {}) {
  const rowStep = rowGap ?? GAP_Y;
  if (nodes.length > max) throw new Error(`关系图最多 ${max} 个方框，这里给了 ${nodes.length} 个`);
  const box = new Map(nodes.map((n) => {
    const w = Math.ceil(Math.max(120, textW(n.label ?? n.name, FONT + 1), ...n.lines.map((l) => textW(l, FONT))) + PAD * 2);
    return [n.name, { n, w, h: TITLE_H + (n.lines.length ? n.lines.length * LINE_H + PAD : 4) }];
  }));
  const pack = (budget) => {
    const rows = [];
    for (const L of fixedRows ?? layers(nodes)) {
      let row = [], w = 0;
      for (const n of L) {
        const b = box.get(n.name);
        if (row.length && w + GAP_X + b.w > budget) { rows.push(row); row = []; w = 0; }
        w += (row.length ? GAP_X : 0) + b.w;
        row.push(b);
      }
      rows.push(row);
    }
    rows.forEach((r, ri) => r.forEach((b) => { b.row = ri; }));
    return rows;
  };
  const named = [...box.values()].sort((p, q) => cmp(p.n.name, q.n.name));
  const pairs = named.flatMap((b) => b.n.parents.map((pn) => [b, box.get(pn)]));
  const lanes = () => { const k = pairs.filter(([c, p]) => Math.abs(c.row - p.row) > 1).length; return k ? k * LANE + 12 : 0; };
  const rowW = (r) => r.reduce((s, b) => s + b.w, 0) + GAP_X * (r.length - 1);
  // 隔行连线的竖道占左边一条宽度：行宽加竖道超了 ROW_W 就把竖道让出来重新折行，最多试几遍（表页小关系图里引用它的表一多就会这样，
  // 2026-11-23 真数据上一张被 30 张表引用的表，图比正文宽、右边的方框被框裁掉）。实在让不出来的，仍在外框里横向滚。
  let rows = pack(ROW_W), left = lanes();
  for (let k = 0; k < 3 && Math.max(...rows.map(rowW)) + left > ROW_W; k++) { rows = pack(ROW_W - left); left = lanes(); }
  const W = Math.max(...rows.map(rowW)) + M * 2 + left, top = [], bot = [];
  let y = M;
  rows.forEach((r, ri) => {
    let x = M + left + Math.round((W - M * 2 - left - rowW(r)) / 2);
    for (const b of r) { Object.assign(b, { x, y }); x += b.w + GAP_X; }
    top[ri] = y; bot[ri] = y + Math.max(...r.map((b) => b.h)); y = bot[ri] + rowStep;
  });
  const H = bot[rows.length - 1] + M + (rowGap == null ? GAP_Y / 2 : 0); // 底下留半格，给同一行之间绕下去的连线
  // 连线两端：父表在上就从子表顶边连到父表底边；父表在下（成环）反过来；同一行从两个底边往下绕。
  // 同一条边上的多个端点按对端的横向位置均匀摊开，免得箭头叠成一个。
  const ends = new Map(), edges = [];
  const end = (b, side, other) => {
    const k = `${b.n.name}\u0000${side}`, e = { b, side, other };
    (ends.get(k) || ends.set(k, []).get(k)).push(e);
    return e;
  };
  for (const [b, p] of pairs) {
    const up = p.row < b.row, down = p.row > b.row;
    edges.push({ c: end(b, up ? 'top' : 'bottom', p), t: end(p, down ? 'top' : 'bottom', b), same: !up && !down, long: Math.abs(p.row - b.row) > 1, n: b.n.counts?.[p.n.name] });
  }
  for (const list of ends.values()) {
    list.sort((a, b) => a.other.x + a.other.w / 2 - (b.other.x + b.other.w / 2) || cmp(a.other.n.name, b.other.n.name));
    list.forEach((e, i) => { e.x = r1(e.b.x + (e.b.w * (i + 1)) / (list.length + 1)); e.y = e.side === 'top' ? e.b.y : e.b.y + e.b.h; });
  }
  let lane = 0;
  const gapY = (e, off) => (e.side === 'top' ? top[e.b.row] - off : bot[e.b.row] + off);
  // 线上的条数：短线写在曲线正中；隔行的长线左边竖道挤，写在出发那一端的竖段旁边。
  const tag = (n, x, y, anchor) => (n == null ? '' : `<text class="n" x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}">${esc(n)}</text>`);
  const paths = edges.map(({ c, t, same, long, n }) => {
    if (long) {
      const k = lane++, x = M + k * LANE, off = 12 + (k % 5) * 7;
      return `<path class="e" d="M${c.x} ${c.y}V${gapY(c, off)}H${x}V${gapY(t, off)}H${t.x}V${t.y}" marker-end="url(#ah)"/>${tag(n, c.x + 4, (c.y + gapY(c, off)) / 2 + 4, 'start')}`;
    }
    const m1 = same ? c.y + GAP_Y * 0.6 : r1((c.y + t.y) / 2), m2 = same ? t.y + GAP_Y * 0.6 : m1;
    return `<path class="e" d="M${c.x} ${c.y}C${c.x} ${m1} ${t.x} ${m2} ${t.x} ${t.y}" marker-end="url(#ah)"/>${tag(n, (c.x + t.x) / 2, (c.y + 3 * m1 + 3 * m2 + t.y) / 8 + 4, 'middle')}`;
  });
  const boxes = named.map(({ n, x, y: by, w, h }) => {
    const lines = n.lines.map((l, i) => `<text x="${x + PAD}" y="${by + TITLE_H + PAD - 2 + LINE_H * i + 10}">${esc(l)}</text>`).join('');
    const sep = n.lines.length ? `<line x1="${x}" y1="${by + TITLE_H}" x2="${x + w}" y2="${by + TITLE_H}"/>` : '';
    return `<a href="${esc(n.href)}"><rect${n.focus ? ' class="f"' : ''} x="${x}" y="${by}" width="${w}" height="${h}" rx="3"/><text class="tt" x="${x + PAD}" y="${by + 17}">${esc(n.label ?? n.name)}</text>${sep}${lines}</a>`;
  });
  return `<svg class="er" width="${W}" height="${r1(H)}" viewBox="0 0 ${W} ${r1(H)}" role="img" aria-label="${esc(label)}">\n<title>${esc(label)}</title>\n<defs><marker id="ah" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path class="ah" d="M0 0L8 4L0 8z"/></marker></defs>\n${paths.join('\n')}\n${boxes.join('\n')}\n</svg>`;
}
