// check-spec.mjs —— 核对的一项：需求规格一块不少、一字不差（第二期契约 docs/readable-spec/phase2-spec-contract.md D 节；规格 REQ-DOC-004、007）。
// 为什么单独一个文件：check.mjs 管数据库设计那几项已经够长；这一项的对齐算法自成一体，放在一起谁也读不完。
// 不信出页面的代码：入口重新切的块（facts.spec）与 check-read.mjs 从 spec/ 下各页读回的 data-block 逐块比。
// 架构稿 §3 禁边：这里不 import render/ 下的任何东西；去记号、认有序列表的规矩照契约自己写一份。
// 两边都压空白、去行内记号（plainMarks，核对器自己的一份）、过隐去规则之后比；围栏页面上原样显示，不去记号；表格行按格比；
// 有序列表的项连序号一起比——序号从页面上 data-k="marker" 读回来，与重新切块得到的 marker 比，无序的两边都没有序号；
// 围栏起始行后面的字（info）同样从页面上 data-k="info" 读回来一起比。
// 认块靠文字不靠序号：来源里删了一条而没重出，后面几百块的序号全挪一位，按序号比会报几百条，按文字对齐只报多出来的那一块。
// 对齐用最长公共子序列（两头相同的先剥掉）；没对上的，别的空隙里有同样文字的是先后不对，同一段空隙里的一一配成文字不同，
// 配剩下的是缺的或多的。中间两段块数之积超过上限时不求公共子序列，按位置一一配，也不报先后（D 节末段）——
// 不然两头各改一个字，中间几千块全被当成「先后不对」。分句的断行是空标记、步骤图与打印用的那份引用不带 data-block，读回来的字不因排法变。
// 配上的块（文字相同的、先后不对的、文字不同的）再看两样：结构（列表子项挂在谁下面、标题的标签级数，spec-structure）
// 与引用为打印另备的那一份（缺了、多了、字不同都报 spec-mismatch）。字一个没少、层次却没了，或打印出来的与屏幕上的不同，都是给人看错了。
// 现有的架构文档（第三期契约 D 节末段、E 节）照同一项逐份比（archDocsFacts）：页面在 arch/doc-<两位序号>/ 下，kind 沿用这七种，
// where 里写明是哪一份的路径。没有架构这一份的项目不出这些页面，也就不比。
import { cmp } from './model.mjs';
import { redact } from './sensitive.mjs';
import { squash, specBlocks, specPrints, specFigs, plainMarks } from './check-read.mjs';

// 契约 C 节：文件名只用序号。需求规格在 spec/ 下；第 i 份现有的架构文档（照配置的先后，从 01 起）在 arch/doc-<两位序号>/ 下——照契约自己推，不借出页面的代码。
const pageRe = (dir) => new RegExp(`^${dir}/s-(\\d+)\\.html$`);
const docDir = (i) => `arch/doc-${String(i + 1).padStart(2, '0')}`;
const KIND = { heading: '标题', list: '列表项', table: '表格行', quote: '引用', fence: '围栏', hr: '分隔线', paragraph: '段落' };
const LCS_CAP = 4e6; // 中间对不上的两段块数之积超过它就不求公共子序列（四百万格约 16MB），按位置一一配
const ORDERED = /^\d{1,9}[.)]$/; // 有序列表的记号：数字加「.」或「)」（契约 B 节）；页面上只有它们显示序号
const HEAD_TAG = /^h([1-6])$/;
const specNorm = (s) => squash(redact(squash(s)).text);
const srcNorm = (kind, s) => { const r = redact(s).text; return specNorm(kind === 'fence' ? r : plainMarks(r)); };
const specKey = (text, cells, marker, info) => `${cells ? `T\u0001${cells.join('\u0001')}` : `B\u0001${text}`}${marker == null ? '' : `\u0002${marker}`}${info == null ? '' : `\u0003${info}`}`;
const clip = (s, n = 30) => { const a = Array.from(s); return a.length > n ? `${a.slice(0, n).join('')}…` : s; };
function cpDiff(got, want) {
  const g = Array.from(got), w = Array.from(want);
  let i = 0;
  while (i < g.length && i < w.length && g[i] === w[i]) i++;
  const cut = (a) => `${i > 12 ? '…' : ''}${a.slice(Math.max(0, i - 12), i + 24).join('')}${a.length > i + 24 ? '…' : ''}`;
  return `第 ${i + 1} 个字起不同，页面上「${cut(g)}」，来源「${cut(w)}」`;
}
// 配对：两头相同的先剥掉，中间求最长公共子序列；中间太大时按位置一一配（只把位置相同、文字也相同的当作配上，
// 其余留在空隙里，后面按位置配成文字不同或缺、多），positional 为 true，调用方不再报先后。
function lcs(a, b) {
  const pairs = [];
  let s = 0, e = 0, positional = false;
  while (s < a.length && s < b.length && a[s] === b[s]) { pairs.push([s, s]); s++; }
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const A = a.length - s - e, B = b.length - s - e;
  if (A && B && A * B <= LCS_CAP) {
    const W = B + 1, L = new Uint32Array((A + 1) * W);
    for (let i = A - 1; i >= 0; i--) for (let j = B - 1; j >= 0; j--) L[i * W + j] = a[s + i] === b[s + j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    for (let i = 0, j = 0; i < A && j < B;) {
      if (a[s + i] === b[s + j]) { pairs.push([s + i, s + j]); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++; else j++;
    }
  } else if (A && B) {
    positional = true;
    for (let k = 0; k < Math.min(A, B); k++) if (a[s + k] === b[s + k]) pairs.push([s + k, s + k]);
  }
  for (let k = e; k > 0; k--) pairs.push([a.length - k, b.length - k]);
  return { pairs, positional };
}
const range = (from, to) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

// 一对配上的块哪里不同：序号不同先说序号，起始行后面的字不同再说它，文字也不同再接着说文字；表格行点到第几格。
function what(s, p) {
  const mk = s.marker === p.marker ? '' : `序号：页面上是「${p.marker ?? '（没有）'}」，来源是「${s.marker ?? '（没有）'}」`;
  const inf = s.info === p.info ? '' : `围栏起始行后面的字：页面上是「${p.info ?? '（没有）'}」，来源是「${s.info ?? '（没有）'}」`;
  const same = s.cells && p.cells ? s.cells.length === p.cells.length && s.cells.every((c, x) => c === p.cells[x]) : s.text === p.text;
  let t = '';
  if (same) t = '';
  else if (!s.cells || !p.cells) t = cpDiff(p.text, s.text);
  else if (s.cells.length !== p.cells.length) t = `页面上 ${p.cells.length} 格，来源 ${s.cells.length} 格`;
  else { const k = s.cells.findIndex((c, x) => c !== p.cells[x]); t = `第 ${k + 1} 格${cpDiff(p.cells[k], s.cells[k])}`; }
  return [mk, inf, t].filter(Boolean).join('；');
}

// 结构（D 节 spec-structure）：配上的每一对，页面上的标签级数与来源的标题级数相同，页面上包着它的那一块与来源里的父项是同一块。
// 页面上包着它的那一块用配对换回来源的序号再比；那一块没配上（来源里没有、或在页面上重复出现）也算挂错了地方。
function structure(S, P, matched, out) {
  const pToS = new Map(matched.map(([i, j]) => [j, i]));
  const srcAt = (i) => `第 ${S[i].line} 行的${KIND[S[i].kind] ?? S[i].kind}`;
  for (const [i, j] of matched) {
    const s = S[i], p = P[j];
    if (s.level !== p.level) {
      const got = p.level ? `<h${p.level}>` : `<${p.tag}>，不是标题的标签`, want = s.level ? `${s.level} 级标题，该用 <h${s.level}>` : '不是标题';
      out.push({ kind: 'spec-structure', where: p.where, detail: `${s.at}，标签级数与来源不同：页面上是 ${got}，来源是${want}` });
    }
    const got = p.up == null ? null : pToS.get(p.up);
    if (got === s.parent) continue;
    const pageSide = p.up == null ? '页面上在最外层' : got === undefined ? `页面上挂在第 ${p.up < 0 ? '?' : P[p.up].n} 块下面（那一块在来源里对不上）` : `页面上挂在来源${srcAt(got)}下面`;
    const srcSide = s.parent == null ? '来源里它在最外层' : `来源里该挂在${srcAt(s.parent)}下面`;
    out.push({ kind: 'spec-structure', where: p.where, detail: `${s.at}，挂的位置与来源不同：${pageSide}，${srcSide}` });
  }
}

// 引用为打印另备的那一份（C、D 节）：配上的每一块引用，页面上恰有一份 data-print-of 指着它屏幕上的那一块，字与来源相同。
// 指着别的块、或没有引用对得上的打印副本算多出来的。都报 spec-mismatch，说明里写明是打印用的那一份。
function prints(S, P, matched, all, out) {
  const by = new Map(), used = new Set();
  for (const x of all) { if (!by.has(x.of)) by.set(x.of, []); by.get(x.of).push(x); }
  for (const [i, j] of matched) {
    const s = S[i], p = P[j];
    if (s.kind !== 'quote') continue;
    used.add(p.n);
    const got = by.get(p.n) ?? [];
    if (!got.length) out.push({ kind: 'spec-mismatch', where: p.where, detail: `${s.at}，打印用的那一份页面上没有（没有 data-print-of="${p.n}" 的元素），打印出来少了这一段` });
    else if (got.length > 1) out.push({ kind: 'spec-mismatch', where: p.where, detail: `${s.at}，打印用的那一份有 ${got.length} 份（data-print-of="${p.n}"），该恰好一份` });
    for (const g of got) if (g.text !== s.text) out.push({ kind: 'spec-mismatch', where: g.where, detail: `${s.at}，打印用的那一份文字与来源不同：${cpDiff(g.text, s.text)}` });
  }
  for (const [of, list] of by) {
    if (used.has(of)) continue;
    for (const g of list) out.push({ kind: 'spec-mismatch', where: g.where, detail: `打印用的那一份（data-print-of="${of}"）对不上页面上任何一块与来源相配的引用（「${clip(g.text)}」）：来源改了没重出，或者有人手改了页面` });
  }
}

// 图里的字取自来源（D 节 spec-figure）：每张图点名的块要在来源里，每个方框的字（去掉末尾表示截断的「…」，压空白、过隐去）
// 必须是点名的那几块在来源里的文字（去记号、压空白、隐去之后，就是上面配对用的那一份）里的一段。读回各块时图已整个跳过，
// 所以只改了图里的字，报的是这一项、不是 spec-mismatch。方框与点名的块一样多（步骤图一步一块）时，点到对应的那一块的行。
function figures(S, all, out) {
  for (const f of all) {
    const ns = f.of.split(',').map((x) => x.trim()), idx = ns.map((x) => (/^\d{1,9}$/.test(x) ? Number(x) - 1 : -1));
    const bad = ns.filter((_, k) => idx[k] < 0 || idx[k] >= S.length);
    if (!f.of.trim() || bad.length) { out.push({ kind: 'spec-figure', where: f.where, detail: `图点名的第 ${bad.join('、') || '（空）'} 块来源里没有：来源改了没重出，或者有人手改了页面` }); continue; }
    f.boxes.forEach((box, k) => {
      let t = squash(box);
      if (t.endsWith('…')) t = t.slice(0, -1);
      t = specNorm(t);
      if (idx.some((i) => S[i].text.includes(t))) return;
      const at = (f.boxes.length === idx.length ? [idx[k]] : idx).map((i) => S[i].at).join('、');
      out.push({ kind: 'spec-figure', where: f.where, detail: `图里的方框「${clip(t)}」不是它点名的${at}里的字：图里只许出现来源里的字` });
    });
  }
}

// rd：核对器的目录读取器（check.mjs 的 reader）；spec：重新切的块，没配需求规格的是 null；label：给人看的位置前缀。
// dir：这一份的页面所在的目录（需求规格是 spec）；tag：接在页面路径后面、点名是哪一份的字（需求规格不加，与加这个参数之前逐字相同）。
export function specFacts(rd, spec, label, { dir = 'spec', tag = '' } = {}) {
  const out = [];
  if (!spec) return { problems: out, read: 0 };
  const PAGE = pageRe(dir), num = (rel) => { const m = PAGE.exec(rel); return m ? Number(m[1]) : Infinity; };
  const rels = rd.html.filter((r) => r.startsWith(`${dir}/`)).sort((a, b) => num(a) - num(b) || cmp(a, b));
  const seen = new Map(), P = [], at = new Map(), printAll = [], figAll = [];
  let read = 0;
  for (const rel of rels) {
    const tree = rd.tree(rel), page = `${label}${rel}${tag}`;
    for (const b of specBlocks(tree)) {
      read++;
      const where = `${page} · 第 ${b.n} 块`;
      if (seen.has(b.n)) { out.push({ kind: 'spec-duplicate', where, detail: `第 ${b.n} 块在页面上不止一处（${seen.get(b.n)} 里已经有它）` }); continue; }
      seen.set(b.n, rel);
      at.set(b, P.length);
      const cells = b.cells ? b.cells.map(specNorm) : null, text = cells ? cells.join(' | ') : specNorm(b.text), marker = b.marker ?? null, info = b.info == null ? null : specNorm(b.info);
      const h = HEAD_TAG.exec(b.tag);
      P.push({ where, n: b.n, tag: b.tag, level: h ? Number(h[1]) : null, up: b.up, text, cells, marker, info, key: specKey(text, cells, marker, info) });
    }
    for (const x of specPrints(tree)) printAll.push({ of: x.of, where: `${page} · 打印用的那一份（data-print-of="${x.of}"）`, text: specNorm(x.text) });
    for (const x of specFigs(tree)) figAll.push({ ...x, where: `${page} · 图（data-fig="${x.of}"）` });
  }
  // 包着它的那一块换成 P 里的下标；那一块在页面上是重复的（没进 P）记 -1。
  for (const p of P) p.up = p.up == null ? null : (at.get(p.up) ?? -1);
  const S = spec.blocks.map((b) => {
    const cells = b.kind === 'table' ? b.cells.map((c) => srcNorm(b.kind, c)) : null, text = cells ? cells.join(' | ') : srcNorm(b.kind, b.text);
    const marker = b.kind === 'list' && ORDERED.test(b.marker ?? '') ? b.marker : null, info = b.kind === 'fence' && b.info ? srcNorm('fence', b.info) : null;
    return {
      where: `${label}${dir}/ · 来源 ${spec.file} 第 ${b.line} 行`, at: `来源 ${spec.file} 第 ${b.line} 行的${KIND[b.kind] ?? b.kind}`,
      kind: b.kind, line: b.line, level: b.kind === 'heading' ? b.level : null, parent: b.parent == null ? null : b.parent - 1,
      text, cells, marker, info, key: specKey(text, cells, marker, info),
    };
  });
  const { pairs, positional } = lcs(S.map((x) => x.key), P.map((x) => x.key)), matched = [...pairs], gaps = [];
  let i0 = -1, j0 = -1;
  for (const [i, j] of [...pairs, [S.length, P.length]]) { gaps.push({ s: range(i0 + 1, i), p: range(j0 + 1, j) }); i0 = i; j0 = j; }
  const moved = new Set();
  if (!positional) {
    const loose = new Map();
    for (const g of gaps) for (const j of g.p) { if (!loose.has(P[j].key)) loose.set(P[j].key, []); loose.get(P[j].key).push(j); }
    for (const g of gaps) {
      g.s = g.s.filter((i) => {
        const j = loose.get(S[i].key)?.find((x) => !moved.has(x));
        if (j === undefined) return true;
        moved.add(j);
        matched.push([i, j]);
        out.push({ kind: 'spec-order', where: P[j].where, detail: `${S[i].at}在页面上的先后与来源不一致（「${clip(S[i].text)}」）` });
        return false;
      });
    }
  }
  for (const g of gaps) {
    const p = g.p.filter((j) => !moved.has(j));
    g.s.forEach((i, k) => {
      if (k < p.length) { matched.push([i, p[k]]); out.push({ kind: 'spec-mismatch', where: P[p[k]].where, detail: `${S[i].at}，文字与页面上的不同：${what(S[i], P[p[k]])}` }); }
      else out.push({ kind: 'spec-missing', where: S[i].where, detail: `${S[i].at}页面上没有（「${clip(S[i].text)}」）` });
    });
    for (const j of p.slice(g.s.length)) out.push({ kind: 'spec-extra', where: P[j].where, detail: `页面上的这一块来源里没有（「${clip(P[j].text)}」）：来源改了没重出，或者有人手改了页面` });
  }
  structure(S, P, matched, out);
  prints(S, P, matched, printAll, out);
  figures(S, figAll, out);
  return { problems: out, read };
}

// 现有的架构文档一块不少、一字不差（第三期契约 E 节最后一条）：每一份跑上面那一项，页面在它自己的目录下，where 里接上「现有架构文档 <路径>」。
// 这些页面只在有架构这一份时出（D 节末段），没有模块的项目一份都不比、读回 0 块；read 是各份页面上读回的块数之和。
export function archDocsFacts(rd, facts, label) {
  const docs = facts.archDocs ?? [], problems = [];
  let read = 0;
  if (!facts.arch?.modules?.length) return { problems, read };
  docs.forEach((d, i) => {
    const r = specFacts(rd, d, label, { dir: docDir(i), tag: ` · 现有架构文档 ${d.file}` });
    problems.push(...r.problems);
    read += r.read;
  });
  return { problems, read };
}
