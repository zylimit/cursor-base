// check-arch.mjs —— 核对的一项：架构这一份的页面上显示的与重新取的事实逐项相同（第三期契约 docs/readable-spec/phase3-arch-contract.md E 节；规格 REQ-DOC-007）。
// 为什么有它：这一步最贵的错是页面上的模块事实与汇总的事实对不上而看不出来——架构师照着错的依赖去改，
// 开发照着表页上标错的模块去改了别的模块的文件。所以不信出页面的代码：架构稿 §3 禁边，这里不 import render/ 下的任何东西，
// 页面靠 check-read.mjs 照 D 节末尾那张表读回来（data-section 里一行一条的 data-row，要比的格子 data-k），与 facts.arch、facts.code 比。
// 比的就是那张表，一段一行一格都不漏（比法在 check-arch-rows.mjs）：模块页的文件（显示的路径、规模档、入口、文件头说明全文与取自哪一处）、
// 接口（方法、路径、处理函数、所在文件、处理函数的说明全文、拼不出完整路径的原因）、它依赖的模块（显示的 id、用到的名字）、
// 依赖它的模块、对外提供的名字、读写的表、用到的外部包，连同 <h1> 的模块标题；架构首页的模块清单（显示的 id、约多少行与六个数）、
// 未归属的文件、超过 1000 行的、没人引用的、循环依赖、越层引用、没解析到的与运行时才定的引用、没扫的文件、项目判断里对不上的、
// 现有的架构文档（配了 archDocs 才有；它们各自的页面逐块比在 check-spec.mjs 的 archDocsFacts）；
// 接口总表的每一条（连同所属模块，不带处理函数的说明）；表页上每个文件标的模块。键不许只放在属性里——data-row 只配行，显示键的那一格（路径、模块 id、
// 名字、所在文件）也比显示的字：原先只比 data-row，出页面的代码把显示的路径、模块写错了，check 照样报「不一致 0 条」（2026-11-23 整期审查实测）。
// 规模档、约多少行这类由事实算出来的字，照契约自己算，不借出页面的代码。
// 对不上的 kind 都是 arch-mismatch，点到哪一页、哪个模块、哪一项。说明区（module:<id>、doc:arch）的读回借 check-db.mjs 的 noteRegions，
// 由调用方交进来——两边一份规矩。说明的过期与孤儿由 check.mjs 照第一期的办法逐段报。
// 项目判断里对不上的（arch.problems）各算一条、kind 是 arch-map，只在 check 里报，不拦 build 的落盘（不拦生成，契约 A 节）。
import { cmp } from './model.mjs';
import { redact } from './sensitive.mjs';
import { findAll, textOf, sectionRows } from './check-read.mjs';
import { key, shown, opt, differ, section } from './check-arch-rows.mjs';

const INDEX = 'arch/index.html', ROUTES = 'arch/routes.html', MOD_PAGE = /^arch\/m-[^/]*\.html$/, TABLE_PAGE = /^db\/t-[^/]*\.html$/;
const UNASSIGNED = '未归属';
// 文件的规模档（D 节「确切的行数不上页面」）：照契约自己写一份，不借出页面的代码——四档，恰好 100、500、1000 行的归上面一档。
const band = (n) => (n < 100 ? '不到 100 行' : n < 500 ? '100–500 行' : n < 1000 ? '500–1000 行' : '1000 行以上');
// 模块的「约 N 行」（D 节同一段）：取一位有效数字（四舍五入），满千写「千」、满万写「万」；不到 100 行的一律写「不到 100 行」，0 行也是。
function about(n) {
  if (n < 100) return '不到 100 行';
  const step = 10 ** (String(Math.trunc(n)).length - 1), v = Math.round(n / step) * step;
  return v >= 10000 ? `约 ${v / 10000} 万行` : v >= 1000 ? `约 ${v / 1000} 千行` : `约 ${v} 行`;
}
// 拼不出完整路径的原因那一格（B 节「接口」、D 节接口总表），照契约的原话自己写一份。不是这两个原因的（含缺这一栏），
// 写一句永远对不上的，让它露出来——出页面那边遇到它直接报错，走不到这里；核对手改的页面时才用得上。
const WHY = { runtime: '前缀是运行时定的', unmounted: '没找到它挂在哪，前面可能还有一段前缀' };
const whyOf = (r) => (r.fullPath != null ? undefined : Object.hasOwn(WHY, r.why ?? '') ? WHY[r.why] : `（不认识的原因「${r.why}」）`);
// 文件头说明取自哪一处的那句标记（B 节「文件」的 headAt、D 节表里 files 一行），照契约原话自己写一份：只有取自引用语句之后的才有。
// 有说明而事实里还没有 headAt 这一栏的（键不在；取事实那边 2026-11-23 起才出）按文件最前面算；值不认识的写一句永远对不上的，让它露出来。
function headAtOf(f) {
  if (f.head == null || f.headAt === undefined || f.headAt === 'top') return undefined;
  return f.headAt === 'after-imports' ? '写在引用语句之后的第一块注释' : `（不认识的出处「${f.headAt}」）`;
}
// 模块页的接口比这六格；接口总表不放处理函数的说明（D 节），比的是 ROUTE_K 去掉 doc、加上 module。
const ROUTE_K = ['method', 'path', 'handler', 'file', 'doc', 'why'];
const TOTAL_K = ['method', 'path', 'handler', 'file', 'why', 'module'];
// 一份现有的架构文档分几章（第二期契约 C 节的分法，照契约自己数，不借出页面的代码）：一个二级标题一章，
// 第一个二级标题之前有内容的另算一章（s-00）；一块都没有的是 0 章。
function chapterCount(blocks) {
  const h2 = blocks.filter((b) => b.kind === 'heading' && b.level === 2).length, first = blocks.findIndex((b) => b.kind === 'heading' && b.level === 2);
  return h2 + (blocks.length && first !== 0 ? 1 : 0);
}
const routeWant = (r, doc, extra = {}) => ({ key: key(`${r.method} ${r.fullPath ?? r.path}`), k: opt({
  method: shown(r.method), path: shown(r.fullPath ?? r.path), handler: shown(r.handler), file: shown(r.file), doc: doc == null ? undefined : shown(doc), why: whyOf(r), ...extra }) });
// 文件名由 id 推出（同第一期的推法，照契约自己推，不借出页面的代码）；模块 id 只许小写字母、数字与连字符，推出来就是它自己。
const slug = (s) => String(s).replace(/[^a-z0-9_-]/gu, (c) => `~${c.codePointAt(0).toString(16)}`);
const modPage = (id) => `arch/m-${slug(id)}.html`;
const count = (list) => String(list.length);

// 模块页。arch 里各模块的 routes 不带处理函数的说明，说明到 code.routes 里按（文件、方法、路径、完整路径、处理函数）找：docOf。
function modulePage(tree, m, files, docOf, add) {
  const anchors = findAll(tree, (n) => n.tag === 'main').map((n) => n.attrs['data-anchor']);
  if (anchors.length !== 1 || anchors[0] !== `module:${m.id}`) add(`页里的模块锚点是${anchors.length ? anchors.map((a) => `「${a ?? '（没有）'}」`).join('、') : '（没有）'}，按文件名应是「module:${m.id}」`);
  const h1 = findAll(tree, (n) => n.tag === 'h1');
  if (h1.length !== 1) add(`标题（<h1>）${h1.length ? `出现了 ${h1.length} 处` : '不见了'}`);
  else if (textOf(h1[0]) !== shown(m.title)) add(`标题（<h1>）不是模块的标题：${differ(textOf(h1[0]), shown(m.title))}`);
  const tables = [...new Set([...m.tables.reads, ...m.tables.writes])].sort(cmp);
  const rw = (t) => (m.tables.reads.includes(t) ? '读' : '') + (m.tables.writes.includes(t) ? '写' : '');
  section(tree, 'files', '文件', ['key', 'size', 'entry', 'head', 'headAt'], m.files.map((p) => {
    const f = files.get(p);
    if (!f) return { key: key(p), k: { key: shown(p), size: '（code.files 里没有这个文件）' } };
    return { key: key(p), k: opt({ key: shown(p), size: band(f.lines), entry: f.entry ? '是' : '', head: f.head == null ? undefined : shown(f.head), headAt: headAtOf(f) }) };
  }), add);
  section(tree, 'routes', '接口', ROUTE_K, m.routes.map((r) => routeWant(r, docOf(r))), add);
  section(tree, 'uses', '它依赖的模块', ['module', 'names'], m.uses.map((u) => ({ key: u.module, k: { module: u.module, names: [...u.names].sort(cmp).map(shown).join(', ') } })), add);
  section(tree, 'usedBy', '依赖它的模块', ['module'], m.usedBy.map((id) => ({ key: id, k: { module: id } })), add);
  section(tree, 'provides', '对外提供的名字', ['name', 'file', 'by'], m.provides.map((p) => ({ key: key(`${p.file}#${p.name}`), k: { name: shown(p.name), file: shown(p.file), by: p.by.join(' ') } })), add);
  section(tree, 'tables', '读写的表', ['key', 'rw'], tables.map((t) => ({ key: t, k: { key: shown(t), rw: rw(t) } })), add);
  section(tree, 'externals', '用到的外部包', ['key'], m.externals.map((x) => ({ key: key(x), k: { key: shown(x) } })), add);
}

// 架构首页。循环依赖一组的键是成员 id、照模块清单的先后；越层引用有层才有这一段，没有层时页面上不该有它。
// 现有的架构文档（第 7 段）同理：配了 archDocs 才有，每份一行，键是来源的路径，比显示的路径、几章、几块。
function indexPage(tree, A, C, docs, add) {
  const order = new Map(A.modules.map((m, i) => [m.id, i])), at = (id) => order.get(id) ?? A.modules.length;
  section(tree, 'modules', '模块清单', ['module', 'files', 'lines', 'routes', 'reads', 'writes', 'uses', 'usedBy'], A.modules.map((m) => ({ key: m.id, k: {
    module: m.id, files: count(m.files), lines: about(m.lines), routes: count(m.routes), reads: count(m.tables.reads), writes: count(m.tables.writes), uses: count(m.uses), usedBy: count(m.usedBy) } })), add);
  const paths = (name, what, list) => section(tree, name, what, ['key'], list.map((p) => ({ key: key(p), k: { key: shown(p) } })), add);
  paths('unassigned', '未归属的文件', A.unassigned);
  paths('big', '超过 1000 行的文件', A.big.map((b) => b.file));
  paths('idle', '没有被项目里别的文件引用的', A.idle);
  section(tree, 'cycles', '循环依赖', ['pairs'], A.cycles.map((c) => ({ key: [...c.modules].sort((a, b) => at(a) - at(b)).join(' '), k: { pairs: count(c.pairs) } })), add);
  section(tree, 'upward', '越层引用', ['pairs'], A.upward.map((u) => ({ key: `${u.from} ${u.to}`, k: { pairs: count(u.pairs) } })), add, A.layers.length ? 1 : 0);
  const texts = (name, what, list) => section(tree, name, what, ['key', 'text'], list.map((x) => ({ key: key(x.file), k: { key: shown(x.file), text: shown(x.text) } })), add);
  texts('unresolved', '没解析到的引用', C.unresolved);
  texts('dynamic', '运行时才定的引用', C.dynamic);
  section(tree, 'skipped', '没扫的文件', ['count'], C.skipped.map((s) => ({ key: key(s.ext), k: { count: String(s.count) } })), add);
  section(tree, 'problems', '项目判断里对不上的', ['detail'], A.problems.map((p) => ({ key: key(`${p.kind} ${p.module ?? ''}`), k: { detail: shown(p.detail) } })), add);
  section(tree, 'archDocs', '现有的架构文档', ['key', 'chapters', 'blocks'], docs.map((d) => ({ key: key(d.file), k: {
    key: shown(d.file), chapters: String(chapterCount(d.blocks)), blocks: count(d.blocks) } })), add, docs.length ? 1 : 0);
}

// 表页上「谁在写、谁在读」的每个文件标的模块（D 节）：沿用第一期的行（data-row="writer" / "reader"），行里多一格 data-k="module"，
// 文字是模块 id、未归属的写「未归属」；标了模块的还要链到那个模块页。文件取这一行显示的路径（data-k="file"，显示得对不对由 check-db.mjs 比）。
// 没有架构这一份的项目，表页上不该有这一格。
function tableMarks(rd, owner, label, out) {
  for (const rel of rd.html.filter((r) => TABLE_PAGE.test(r))) {
    for (const r of sectionRows(rd.tree(rel), null).rows.filter((x) => x.key === 'writer' || x.key === 'reader')) {
      const file = r.k.file ?? '（读不出文件）', who = `谁在${r.key === 'writer' ? '写' : '读'}这张表的 ${file}`;
      const add = (detail) => out.push({ kind: 'arch-mismatch', where: label + rel, detail: `${who}：${detail}` });
      if (!owner) { if (r.k.module !== undefined) add(`这个项目没有架构这一份，却标了模块「${r.k.module}」`); continue; }
      const want = owner.get(file) ?? UNASSIGNED;
      if (r.k.module === undefined) { add(`没有标模块，应是「${want}」`); continue; }
      if (r.k.module !== want) { add(`标的模块是「${r.k.module}」，应是「${want}」`); continue; }
      const href = `../${modPage(want)}`;
      if (want !== UNASSIGNED && !findAll(r.node, (n) => n.tag === 'a' && n.attrs.href === href).length) add(`标了模块 ${want}，却没有链到 ${href}`);
    }
  }
}

// 处理函数的说明按接口找：同文件、同方法、同路径、同完整路径、同处理函数的几条按先后各取一条（同一个键几条的，比的时候按多重集比）。
function docLookup(routes) {
  const q = new Map(), id = (r) => JSON.stringify([r.file, r.method, r.path, r.fullPath ?? null, r.handler]);
  for (const r of routes) (q.get(id(r)) ?? q.set(id(r), []).get(id(r))).push(r.doc);
  return (r) => q.get(id(r))?.shift();
}

// 整项。rd：check-read 的 reader；facts：重新取的文档模型（带说明）；noteRegions：check-db.mjs 的说明区读回（交进来，见文件头）。
export function archFacts(rd, facts, label, noteRegions) {
  const out = [], mods = facts.arch?.modules ?? [], notes = facts.notes || {}, has = new Set(rd.html);
  const owner = mods.length ? new Map(mods.flatMap((m) => m.files.map((f) => [f, m.id]))) : null;
  tableMarks(rd, owner, label, out);
  if (!mods.length) return out;
  const at = (rel, anchor) => `${label}${rel}${anchor ? ` · ${anchor}` : ''}`;
  const page = (rel, anchor, notesHere, fn) => {
    if (!has.has(rel)) { out.push({ kind: 'missing-page', where: at(rel), detail: `${anchor ?? '架构这一份'}的页不在` }); return; }
    const tree = rd.tree(rel);
    fn(tree, (detail) => out.push({ kind: 'arch-mismatch', where: at(rel, anchor), detail }));
    noteRegions(tree, notesHere, notes, (kind, a, detail) => out.push({ kind, where: at(rel, a), detail }));
  };
  page(INDEX, null, ['doc:arch'], (tree, add) => indexPage(tree, facts.arch, facts.code, facts.archDocs ?? [], add));
  page(ROUTES, null, [], (tree, add) => section(tree, 'routes', '接口总表', TOTAL_K,
    facts.code.routes.map((r) => routeWant(r, null, { module: owner.get(r.file) ?? UNASSIGNED })), add));
  const files = new Map(facts.code.files.map((f) => [f.path, f])), docOf = docLookup(facts.code.routes), want = new Set();
  for (const m of mods) {
    want.add(modPage(m.id));
    page(modPage(m.id), `module:${m.id}`, [`module:${m.id}`], (tree, add) => modulePage(tree, m, files, docOf, add));
  }
  for (const rel of rd.html) if (MOD_PAGE.test(rel) && !want.has(rel)) out.push({ kind: 'extra-page', where: at(rel), detail: '这一页对不上任何一个现行的模块' });
  return out;
}

// 项目判断里对不上的（E 节）：各算一条，kind 是 arch-map——要人去改 map.json，与「页面对不上事实、要重出或查出页面的代码」的
// arch-mismatch 分开。描述先过隐去——标准错误进日志，日志也是带出去的地方。
export const archProblems = (facts) => (facts.arch?.problems ?? []).map((p) => ({
  kind: 'arch-map', where: `docs/readable-src/map.json${p.module ? ` modules · ${redact(p.module).text}` : ''}`, detail: `项目判断里对不上（${p.kind}）：${redact(p.detail).text}`,
}));

// 摘要里架构的几个数（没写说明不算不一致，只报数）；没有模块的项目不出这个键，摘要与加这一项之前逐字相同。
export function archSummary(facts) {
  const mods = facts.arch?.modules ?? [], notes = facts.notes || {};
  if (!mods.length) return {};
  return { arch: { modules: mods.length, routes: facts.code.routes.length, problems: facts.arch.problems.length, unwrittenModules: mods.filter((m) => !notes[`module:${m.id}`]).length, doc: !notes['doc:arch'] } };
}
export const archLine = (s) => (s.arch ? `；架构：模块 ${s.arch.modules} 个、接口 ${s.arch.routes} 个、项目判断里对不上的 ${s.arch.problems} 条；没写说明的（不算不一致）：模块 ${s.arch.unwrittenModules} 个、doc:arch ${s.arch.doc ? '没写' : '已写'}` : '');
