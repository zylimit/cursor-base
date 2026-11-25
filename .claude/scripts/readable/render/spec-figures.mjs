// spec-figures.mjs —— 需求规格页面上的图与条目的地址（契约 docs/readable-spec/phase2-spec-contract.md C 节「条目的地址」「步骤图」「流程链图」「图不许编字」）。
// 图只从来源已有的结构画，一个字不加：步骤图的方框写有序列表一步的序号与开头，流程链图的方框写一句话里「→」隔开的一段原文。
// 每张图放在带 data-fig="<它画的那几块的全局序号>" 的元素里、不带 data-block：核对器读回各块的字时整个跳过它，
// 另把每个方框（SVG 里的一个 <text>）的字拿去比——必须是点名的那几块的文字里的一段（D 节 spec-figure）。图的说明、无障碍标签是固定的版面用语。
// 流程链图插在一块的字中间（这句话后面），所以整张图没有换行符、外面是一个 <span>：段落里放 <figure> 浏览器会把段落提前收尾，
// 引用的区按 pre-line 排，多一个换行符就多一个空行。
import { esc, attrs, textW } from './layout.mjs';
import { plain, sentences } from './spec-inline.mjs';
import { fingerprint } from '../model.mjs';

export const flat = (s) => plain(s).replace(/\s+/g, ' ').trim();
export const cut = (s, n) => { const cs = Array.from(s); return cs.length > n ? `${cs.slice(0, n).join('')}…` : s; };
const squash = (s) => s.replace(/\s+/g, ' ').trim();

// ---- 条目的地址 ----
// 锚点是 req:<编号> 的（重了的接 ~2，见切块那一层），id 就是那个编号；编号里有 id 里不好用的字，或别的锚点，取「a- 加锚点指纹的前 8 位」——
// 指纹与块的指纹同一个算法，算的是锚点本身（页面上的 data-anchor，已过隐去），不是这一块的字：字改了地址不变，
// 只有章节路径或开头的粗体词改了才变。同一页里重了的接 -2、-3。图里箭头的记号另用 sa- / ca- / cp- 开头，与这两种撞不上。
const REQ_ID = /^req:(REQ-[A-Za-z0-9._-]+)(?:~\d+)?$/;
export function blockIds(blocks) {
  const out = new Map(), used = new Set();
  for (const b of blocks) {
    const m = REQ_ID.exec(b.anchor ?? ''), base = m ? m[1] : `a-${fingerprint(b.anchor ?? '').slice(0, 8)}`;
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    out.set(b.n, id);
  }
  return out;
}
// 每块开头指向自己的链接记号：自己不带字，「#」由样式补（鼠标移上去才显示、打印时不显示），读回页面时没有它的字。
// tabindex="-1"：键盘的 Tab 不停在它上面——一页几百个记号，用键盘的人不能一个个跳过去；本章目录里的链接照旧能用键盘到（契约 C 节）。
export const selfLink = (id) => `<a class="pl" href="#${esc(id)}" tabindex="-1" aria-label="本条的链接"></a>`;

// ---- 步骤图 ----
export const STEP_MIN = 3; // 契约 C 节：同一层连着三步以上的有序列表画步骤图
const STEP_HEAD = 24; // 方框里写这一步的开头，到第一个标点为止、最多 24 个字
// 这一步的开头到哪儿为止：中英文的逗号、句号、顿号、分号、冒号、问号、感叹号与左括号；半角句点后面跟空白才算。
// 引号与书名号不算：它们框的是按钮名、文件名（「点「开始」」截在引号前只剩一个「点」字）。
const HEAD_END = /[，。、；：？！,;:?!（(【]|\.(?=\s|$)/u;
function stepHead(text) {
  const p = flat(text), m = HEAD_END.exec(p.slice(1));
  return cut(m ? p.slice(0, m.index + 1) : p, STEP_HEAD);
}

// 步骤图：一个方框一步，从左到右排，一行放不下折到下一行；箭头从上一步指到下一步，折行的从上一行末尾绕到下一行开头。
// 方框里的序号同列表，写记号的原文，带 data-k="marker"（核对图里的字时除开它）。
const ROW_W = 1040, S_PAD = 12, S_H = 40, S_GX = 36, S_GY = 36, S_M = 8, S_FONT = 14;
const defs = (id) => `<defs><marker id="${id}" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path class="ah" d="M0 0L8 4L0 8z"/></marker></defs>`;
// 上一个方框 a 到下一个方框 b 的箭头：同一行横着连；折行的从 a 的底边往下、在行间空隙里横走到 b 的上方、再往下。
const edge = (a, b, h, gy, id) => `<path class="e" d="${a.y === b.y ? `M${a.x + a.w} ${a.y + h / 2}H${b.x - 2}` : `M${a.x + a.w / 2} ${a.y + h}V${a.y + h + gy / 2}H${b.x + b.w / 2}V${b.y - 2}`}" marker-end="url(#${id})"/>`;
function stepsSvg(items) {
  const labels = items.map((b) => ({ no: String(b.marker).trim(), head: stepHead(b.text) }));
  const w = Math.ceil(Math.min(ROW_W - 2 * S_M, Math.max(120, ...labels.map((l) => textW(`${l.no}  ${l.head}`, S_FONT))) + S_PAD * 2));
  const per = Math.max(1, Math.floor((ROW_W - 2 * S_M + S_GX) / (w + S_GX))), rows = Math.ceil(items.length / per);
  const W = Math.min(per, items.length) * (w + S_GX) - S_GX + 2 * S_M, H = rows * (S_H + S_GY) - S_GY + 2 * S_M;
  const at = (i) => ({ x: S_M + (i % per) * (w + S_GX), y: S_M + Math.floor(i / per) * (S_H + S_GY), w });
  const id = `sa-${items[0].n}`, label = `${items.length} 步的步骤图`;
  const paths = items.slice(1).map((_, k) => edge(at(k), at(k + 1), S_H, S_GY, id));
  const boxes = labels.map((l, i) => {
    const { x, y } = at(i);
    return `<rect x="${x}" y="${y}" width="${w}" height="${S_H}" rx="4"/><text x="${x + S_PAD}" y="${y + S_H / 2 + 5}"><tspan class="no" data-k="marker">${esc(l.no)}</tspan><tspan dx="8">${esc(l.head)}</tspan></text>`;
  });
  return `<svg class="steps" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">\n<title>${label}</title>\n${defs(id)}\n${paths.join('\n')}\n${boxes.join('\n')}\n</svg>`;
}
export const stepsFigure = (items) => `<figure class="steps"${attrs({ 'data-fig': items.map((b) => b.n).join(',') })}><div class="scroll">${stepsSvg(items)}</div>\n<figcaption>下面 ${items.length} 步的示意：一个方框一步，写序号与这一步的开头；每一步的全文在图下面的列表里。</figcaption></figure>`;

// ---- 流程链图 ----
// 契约 C 节：一句话在括号、引号、等宽之外用「→」连着三段以上、每段去掉首尾空白与行内记号后不超过 30 个字，才画。
// 有一段超过 30 个字的是带箭头的叙述（2026-11-23 真数据：最长一段超过 60 字的有 31 句），画出来是一串长条，不画。
// 第一段里最后一个冒号之前的话是引子（「链路参考：」、条目开头的小标题），不进方框；最后一段末尾的句末标点不进方框。
// 量的是进方框的字（引子已去掉）：小标题长短不该决定后面这串是不是流程。哪一段是空的（箭头打头、两个箭头挨着）也不画。
const CHAIN_MIN = 3, CHAIN_SEG = 30, TRAIL = /[。；？！;?!.\s]+$/u;
const CHAIN_KINDS = new Set(['list', 'paragraph', 'quote']); // 表格里的不画，标题、围栏不算「一句话」
function chainBoxes(sn) {
  if (sn.parts.length < CHAIN_MIN) return null;
  const boxes = sn.parts.map((p, i) => squash(i === 0 ? p.slice(sn.intro) : p));
  boxes[boxes.length - 1] = boxes[boxes.length - 1].replace(TRAIL, '');
  return boxes.every((t) => t && Array.from(t).length <= CHAIN_SEG) ? boxes : null;
}
// 一块里各句的流程链图：{原文的位置 → 图的 HTML}，交给 inline 插在这句话后面；一张都没有给 null。
// tag 区分同一块的两份（引用屏幕上那份与打印用的那份）：箭头记号的 id 在同一页里不许重。
export function chainFigs(b, tag = 'ca') {
  if (!CHAIN_KINDS.has(b.kind)) return null;
  const out = new Map();
  for (const sn of sentences(b.text, { lines: b.kind === 'quote' })) {
    const boxes = chainBoxes(sn);
    if (boxes) out.set(sn.at, chainSvg(boxes, `${tag}-${b.n}-${out.size + 1}`, b.n));
  }
  return out.size ? out : null;
}
// 一页的块里画了几条流程链：清单页的导读只在真有流程链图时才提它。
export const chainCount = (blocks) => blocks.reduce((s, b) => s + (chainFigs(b)?.size ?? 0), 0);

// 流程链：一个方框一段，宽随字，从左往右排，一行排不下就折行；箭头照先后连，画法同步骤图，只是没有序号。
// 一行最宽 760：链图嵌在条目里，四级缩进下也放得下，不把页面撑出横向滚动条；更窄的屏在自己的框里横向滚。
const C_ROW = 760, C_PAD = 10, C_H = 32, C_GX = 30, C_GY = 26, C_M = 6, C_FONT = 14;
function chainSvg(boxes, id, n) {
  const pos = [];
  let x = C_M, y = C_M, right = 0;
  for (const t of boxes) {
    const w = Math.ceil(Math.max(40, textW(t, C_FONT)) + 2 * C_PAD);
    if (pos.length && x + w > C_ROW - C_M) { x = C_M; y += C_H + C_GY; }
    pos.push({ x, y, w, t });
    right = Math.max(right, x + w);
    x += w + C_GX;
  }
  const W = right + C_M, H = y + C_H + C_M, label = `${boxes.length} 段的流程链`;
  const paths = pos.slice(1).map((b, k) => edge(pos[k], b, C_H, C_GY, id)).join('');
  const rects = pos.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${C_H}" rx="4"/><text x="${b.x + C_PAD}" y="${b.y + C_H / 2 + 5}">${esc(b.t)}</text>`).join('');
  return `<span class="chain"${attrs({ 'data-fig': String(n) })}><svg class="steps" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}"><title>${label}</title>${defs(id)}${paths}${rects}</svg></span>`;
}
