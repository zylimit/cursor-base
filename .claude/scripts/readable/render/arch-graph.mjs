// arch-graph.mjs —— 架构这一份的两张图：首页的总图、模块页的邻居图（第三期契约 docs/readable-spec/phase3-arch-contract.md D 节「总图」）。
// 为什么有它：架构师第一眼要看清系统分成哪几块、块与块谁用谁（规格 FLOW-1 第 3 步）。一张图只画一件事：
// 模块不超过 12 个时画模块之间的线（共用 layout 的 diagram，有层就按层排行）；超过 12 个时线一多就成了一团，
// 只画层与层之间的线、线上写跨层的文件对数，模块自己的关系看它那一页的邻居图（只画一跳）。只出字符串。
import { esc, diagram, textW, DIAGRAM_MAX } from './layout.mjs';
import { modFile, mRef } from './arch-kit.mjs';

const filesLine = (m) => `${m.files.length} 个文件`;
const node = (m, parents, counts, focus = false) => ({
  name: m.id, label: m.title, href: modFile(m.id), lines: [`${filesLine(m)}${m.layer ? ` · ${m.layer}` : ''}`], parents, counts, focus,
});
const NO_LAYER = '（没有层）';

// 按层分带：layers 的先后从上到下，没有层的（layer 为 null）放最后一带；没有 layers 时只有一带、不写带名。空的层不画。
function bands(v) {
  const out = v.layers.map((name) => ({ name, mods: v.modules.filter((m) => m.layer === name) })).filter((b) => b.mods.length);
  const rest = v.modules.filter((m) => m.layer == null || !v.layers.includes(m.layer));
  if (rest.length) out.push({ name: v.layers.length ? NO_LAYER : '', mods: rest });
  return out;
}

export function overallGraph(v) {
  const mods = v.modules;
  if (mods.length > DIAGRAM_MAX) return layered(v);
  const nodes = new Map(mods.map((m) => [m.id, node(m, m.uses.map((u) => u.module), Object.fromEntries(m.uses.map((u) => [u.module, u.pairs.length])))]));
  const rows = v.layers.length ? bands(v).map((b) => b.mods.map((m) => nodes.get(m.id))) : undefined;
  const how = v.layers.length ? '按层从上到下排（方框里写着层名）；' : '';
  return `<p class="muted">一个方框是一个模块，写标题与文件数；${how}两个模块之间有引用的画一条线，箭头指向被依赖的一方，线上的数是引用它的文件对数。点方框看那个模块。</p>\n`
    + `<div class="scroll">${diagram([...nodes.values()], '模块总图', DIAGRAM_MAX, rows ? { rows } : {})}</div>`;
}

// 超过 12 个模块：每层一条带子，带名写在左边，模块的方框在带子里折行排；层与层之间的线走右边的竖道，
// 从出发那一层的右边出去、进到目标那一层的右边，箭头指向被依赖的一层，出发那一段上写文件对数。同一层里的引用不画。
const W = 1040, M = 8, PAD = 10, BOX_H = 42, GX = 12, GY = 10, BAND_GAP = 18, LANE0 = 34, LANE = 12, SLOT = 16;
const r1 = (x) => Math.round(x * 10) / 10;
function layered(v) {
  const bs = bands(v), labelW = v.layers.length ? Math.ceil(Math.max(96, ...bs.map((b) => textW(b.name, 13) + 24))) : 0;
  const at = new Map();
  bs.forEach((b, i) => b.mods.forEach((m) => at.set(m.id, i)));
  const count = new Map();
  if (v.layers.length) {
    for (const m of v.modules) for (const u of m.uses) {
      const a = at.get(m.id), b = at.get(u.module);
      if (a !== b) count.set(`${a}>${b}`, (count.get(`${a}>${b}`) || 0) + u.pairs.length);
    }
  }
  const edges = [...count].map(([key, n]) => { const [a, b] = key.split('>').map(Number); return { a, b, n }; }).sort((x, y) => x.a - y.a || x.b - y.b);
  const lanes = edges.length ? LANE0 + edges.length * LANE : 0, inner = W - M * 2 - labelW - lanes - PAD * 2, right = M + labelW + inner + PAD * 2;
  const boxes = [], band = [];
  let y = M;
  bs.forEach((b, bi) => {
    const rows = [];
    let cur = [], w = 0;
    for (const m of b.mods) {
      const bw = Math.ceil(Math.max(96, textW(m.title, 13), textW(filesLine(m), 12)) + PAD * 2);
      if (cur.length && w + GX + bw > inner) { rows.push(cur); cur = []; w = 0; }
      w += (cur.length ? GX : 0) + bw;
      cur.push({ m, w: bw });
    }
    rows.push(cur);
    const ends = edges.filter((e) => e.a === bi || e.b === bi).length, content = rows.length * BOX_H + (rows.length - 1) * GY;
    const h = Math.max(content, ends * SLOT) + PAD * 2;
    let ry = y + PAD + Math.round((h - PAD * 2 - content) / 2);
    for (const r of rows) {
      let x = M + labelW + PAD;
      for (const bx of r) { boxes.push({ ...bx, x, y: ry }); x += bx.w + GX; }
      ry += BOX_H + GY;
    }
    band.push({ top: y, h, name: b.name, ends: [] });
    y += h + BAND_GAP;
  });
  const H = y - BAND_GAP + M;
  edges.forEach((e, i) => { band[e.a].ends.push({ i, out: true }); band[e.b].ends.push({ i, out: false }); });
  const pos = edges.map(() => ({}));
  for (const b of band) b.ends.forEach((s, j) => { pos[s.i][s.out ? 'from' : 'to'] = r1(b.top + (b.h * (j + 1)) / (b.ends.length + 1)); });
  const paths = edges.map((e, i) => {
    const x = right + LANE0 + i * LANE, { from, to } = pos[i];
    return `<path class="e" d="M${right} ${from}H${x}V${to}H${right + 1}" marker-end="url(#ah)"/><text class="n" x="${right + 4}" y="${r1(from - 4)}">${e.n}</text>`;
  });
  const rects = band.map((b) => `<rect class="band" x="${M}" y="${b.top}" width="${right - M}" height="${b.h}" rx="4"/>${b.name ? `<text class="band" x="${M + 10}" y="${b.top + 22}">${esc(b.name)}</text>` : ''}`);
  const items = boxes.map(({ m, w, x, y: by }) => `<a href="${esc(modFile(m.id))}"><rect x="${x}" y="${by}" width="${w}" height="${BOX_H}" rx="3"/><text class="tt" x="${x + PAD}" y="${by + 17}">${esc(m.title)}</text><text x="${x + PAD}" y="${by + 34}">${esc(filesLine(m))}</text></a>`);
  const label = v.layers.length ? '模块总图：按层排，只画层与层之间的引用' : '模块总图：只排方框';
  const svg = `<svg class="er" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">\n<title>${label}</title>\n<defs><marker id="ah" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path class="ah" d="M0 0L8 4L0 8z"/></marker></defs>\n${rects.join('\n')}\n${paths.join('\n')}\n${items.join('\n')}\n</svg>`;
  const lead = v.layers.length
    ? `<p class="muted">模块有 ${v.modules.length} 个，超过 12 个就不画模块之间的线：一层一条带子，从上到下是 ${bs.map((b) => esc(b.name)).join('、')}；层与层之间有引用的在右边画一条线，箭头指向被依赖的那一层，线上的数是跨这两层的文件对数。同一层里的引用不画。模块自己依赖谁、谁依赖它，点方框看那个模块的邻居图。</p>`
    : `<p class="muted">模块有 ${v.modules.length} 个，又没有分层，只排方框、不画线。模块自己依赖谁、谁依赖它，点方框看那个模块的邻居图。</p>`;
  const list = edges.length ? `<p>跨层的引用（文件对数）：${edges.map((e) => `${esc(bs[e.a].name)} → ${esc(bs[e.b].name)} ${e.n}`).join('；')}。</p>` : '';
  return `${lead}\n<div class="scroll">${svg}</div>\n${list}`;
}

// 邻居图（D 节模块页）：这个模块居中，它依赖的在上、依赖它的在下，只画它与它们之间的线，线上写文件对数；最多 12 个方框，多的在图下列出。
// 既依赖它、又被它依赖的（成环）画在上面，两条线都画。
export function neighbors(v, m) {
  const uses = m.uses.map((u) => u.module), all = [...uses, ...m.usedBy.filter((x) => !uses.includes(x))];
  if (!all.length) return '<p class="muted">不依赖别的模块，也没有别的模块依赖它，没有邻居图。</p>';
  const drawn = all.slice(0, DIAGRAM_MAX - 1), left = all.slice(DIAGRAM_MAX - 1), set = new Set(drawn);
  const pairsOf = (a, b) => v.byId.get(a).uses.find((u) => u.module === b)?.pairs.length;
  const up = uses.filter((x) => set.has(x));
  const nodes = [node(m, up, Object.fromEntries(up.map((x) => [x, pairsOf(m.id, x)])), true),
    ...drawn.map((id) => { const back = m.usedBy.includes(id); return node(v.byId.get(id), back ? [m.id] : [], back ? { [m.id]: pairsOf(id, m.id) } : {}); })];
  return [
    '<p class="muted">粗框的是这个模块。它依赖的模块在上面，依赖它的在下面；只画它与它们之间的线，箭头指向被依赖的一方，线上的数是引用的文件对数。点方框看那个模块。</p>',
    `<div class="scroll">${diagram(nodes, `${m.title} 与它依赖的、依赖它的模块`)}</div>`,
    left.length ? `<p>图里最多画 ${DIAGRAM_MAX} 个模块，另有 ${left.length} 个与它有依赖关系的没画进去：${left.map((id) => mRef(v, id, { br: false })).join('、')}</p>` : '',
  ].filter(Boolean).join('\n');
}
