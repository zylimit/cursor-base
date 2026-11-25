// db-table.mjs —— 数据库设计的表页（契约 docs/readable-spec/phase1-db-contract.md C 节、F 节「页面」；从 db.mjs 拆出来，单个文件别超过四百行）。
// 为什么有它：接手的人要能只看文档说清任意一张表存的是什么、谁写谁读（规格 SC-1）；领到「给某张表加一个字段」的活，
// 从这张表的页面找到写它的文件（FLOW-1）。读者最先要知道这张表是干什么的，结构细节往后放（F 节表页从上到下的顺序）。
// 同 db.mjs：只读文档模型、只出字符串。几页都要用的小件（文件名、表名链接、外键文字、关系图的方框、定义的出处）放在这里，db.mjs 从这里取。
import { cmp } from '../model.mjs';
import { esc, code, codeBreak, multi, at, origin, judged, fileSlug, page, table, diagram, DIAGRAM_MAX } from './layout.mjs';
import { noteSection, noteMark, noteHtml, noteState } from './note.mjs';

export const DOC = '数据库设计';
export const USAGE_TOP = 20; // 契约 F 节：谁写谁读超过 20 个文件的，其余收进可展开的区
const CON_TYPE = { 'primary key': '主键', unique: '唯一', 'foreign key': '外键', check: 'CHECK' };
// 没写名字的约束（name 为 null）：库里实际的名字静态算不准，取事实器不给，页面老实写「未命名」。这是常态，灰字不抢眼。
const UNNAMED = '<span class="muted">未命名</span>';
// 写的动作按这个先后列，同一份模型两次出的字节相同。
const VERB_ORDER = ['insert', 'update', 'delete', 'merge', 'copy', 'truncate'];

export const tableFile = (name) => `t-${fileSlug(name)}.html`;
// 约束、索引的原文带着源码里的缩进与换行，在格子里折得很乱：显示前把连续空白压成一个空格（视图定义不压，保留换行）。
export const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
// brk：定宽的窄格子里用，下划线后面给折行点（同 codeBreak），不从一个词中间断开。
export const tLink = (name, ctx, brk = false) => {
  const s = brk ? esc(name).replace(/_/g, '_<wbr>') : esc(name);
  return ctx.tables.has(name) ? `<a href="${tableFile(name)}">${s}</a>` : s;
};
export const LIST_TOP = 8; // 契约 C 节「读得全」：「谁引用了它」这类清单超过 8 条的，其余收进可展开的区
export const cols = (list) => list.map(esc).join(', ');
export const refText = (r, ctx) => `${tLink(r.to, ctx)}${r.toCols.length ? ` (${cols(r.toCols)})` : ''}${r.onDelete ? ` · ON DELETE ${esc(r.onDelete)}` : ''}${r.onUpdate ? ` · ON UPDATE ${esc(r.onUpdate)}` : ''}`;
export const crumbs = (...rest) => [['文档首页', 'index.html'], [DOC, 'db/index.html'], ...rest];
export const title = (ctx, ...parts) => [...parts, DOC, ctx.cfg.title].join(' · ');
// 路径在斜杠后面给折行点，窄格子里折在目录之间。kOn：带 data-k="file"，核对器比这一格显示的路径（契约 H 节第 2 项「键不许只放在属性里」）。
const pathCode = (p, kOn = false) => `<code${kOn ? ' data-k="file"' : ''}>${esc(p).replace(/\//g, '/<wbr>')}</code>`;
// 定义的出处（契约 F 节「代码文件的行号不上页面」）：建表定义文件写「文件 第 N 行」；ddl 里列的代码文件只写文件——
// 代码一改行号就挪，页面跟着变，却没有读者在意的变化。哪些算代码文件照取事实的判法（sources/code-scan.mjs 的 isCodeFile）；
// 禁边不许出页面的代码借取事实的东西，照写一份。
const CODE_FILE = /\.(?:py|tsx?|jsx?|mjs)$/;
export const isCodeFile = (f) => CODE_FILE.test(String(f ?? ''));
export const src = (file, line) => (isCodeFile(file) ? esc(file) : at(file, line));

// 外键两处来：列上的 REFERENCES 与表级 FOREIGN KEY，统一成 {from, cols, to, toCols, onDelete, onUpdate}。
export function outRefs(t) {
  const col = t.columns.filter((c) => c.references).map((c) => [[c.name], c.references]);
  const con = t.constraints.filter((c) => c.type === 'foreign key' && c.references).map((c) => [c.columns || [], c.references]);
  return [...col, ...con].map(([cs, r]) => ({
    from: t.name, cols: cs, to: r.table, toCols: r.columns || (r.column ? [r.column] : []), onDelete: r.onDelete, onUpdate: r.onUpdate,
  }));
}

// 关系图的一个方框：主键一行、每条外键一行；组合外键（a_id, b_id）按一条写，不拆到各列上重复列目标表。
// 每条外键都写「→ 目标表」，图里也有的另画连线：线一多，光看线分不清哪条外键指向谁。set 是这张图里画的表。
export function erNode(name, ctx, set, focus = false) {
  const t = ctx.tables.get(name), refs = ctx.out.get(name), pk = t.columns.filter((c) => c.primaryKey).map((c) => c.name);
  const fk = refs.map((r) => `FK ${r.cols.join(', ')} → ${r.to === name ? '本表' : r.to}`);
  const lines = [...(pk.length ? [`PK ${pk.join(', ')}`] : []), ...new Set(fk)];
  const parents = [...new Set(refs.map((r) => r.to))].filter((x) => x !== name && set.has(x)).sort(cmp);
  return { name, href: tableFile(name), lines, parents, focus };
}

// 小关系图（契约 F 节）：这张表居中，加上它引用的和引用它的表，最多 12 张；先画它引用的，再按名字取引用它的，多的在图下用文字列出。
// 引用的表不在建表定义里的画不出方框（没有页面可点），只在下面「它引用了谁」里写名字。
function miniDiagram(t, ctx) {
  const outs = [...new Set(ctx.out.get(t.name).map((r) => r.to))].filter((n) => n !== t.name && ctx.tables.has(n)).sort(cmp);
  const ins = [...new Set((ctx.inc.get(t.name) || []).map((r) => r.from))].filter((n) => n !== t.name && !outs.includes(n)).sort(cmp);
  const all = [...outs, ...ins];
  if (!all.length) return '<p class="muted">不引用别的表，也没有别的表引用它，没有关系图。</p>';
  const drawn = all.slice(0, DIAGRAM_MAX - 1), left = all.slice(DIAGRAM_MAX - 1), set = new Set([t.name, ...drawn]);
  // 一张图只画一件事：只连这张表与别的表之间的外键；别的表彼此之间的外键照样写在方框里，不另画线——
  // 画上的话引用它的表彼此一连，层数加深、隔行的线挤满左边的竖道。
  const nodes = [t.name, ...drawn].map((n) => {
    const node = erNode(n, ctx, set, n === t.name);
    return { ...node, parents: n === t.name ? node.parents : ins.includes(n) ? [t.name] : [] };
  });
  return [
    '<p class="muted">粗框的是这张表。一个方框是一张表，写主键（PK）与外键（FK）列；只画它与别的表之间的连线，箭头指向被引用的一方：它引用的表在它上面，引用它的在下面。点方框看那张表。</p>',
    `<div class="scroll">${diagram(nodes, `${t.name} 与它有外键关系的表`)}</div>`,
    left.length ? `<p>图里最多画 ${DIAGRAM_MAX} 张表，另有 ${left.length} 张与它有外键关系的没画进去：${left.map((n) => tLink(n, ctx)).join('、')}</p>` : '',
  ].filter(Boolean).join('\n');
}

// 谁写谁读（契约 F 节）：一个文件一行，按引用处数从多到少排、同数按路径。项目判断补的条目（judged）没有行号与动作，
// 只给那个文件标档位；带 sameNameDdl 的文件自己建了同名的表，它读写的多半不是主库那张，要让人看见。
function byFile(entries) {
  const m = new Map();
  for (const e of entries) {
    if (!m.has(e.file)) m.set(e.file, { file: e.file, lines: [], verbs: new Set(), judged: new Set(), same: false });
    const f = m.get(e.file);
    if (e.judged) f.judged.add(e.judged);
    else { f.lines.push(e.line); if (e.verb) f.verbs.add(e.verb); }
    if (e.sameNameDdl) f.same = true;
  }
  return [...m.values()].sort((a, b) => b.lines.length - a.lines.length || cmp(a.file, b.file));
}

// 这个文件所属的模块（第三期契约 docs/readable-spec/phase3-arch-contract.md D 节）：开发领到「给某张表加一个字段」的活，
// 从这里找到写它的模块（FLOW-1 第 4 步）。data-k="module" 那一块只放模块 id（未归属的写「未归属」），核对器按它读回；
// 标题跟在后面，链到模块页。of 是入口从架构那一份交进来的「路径 → {id, title}」（renderDb 的 moduleOf 参数带进 ctx）；
// 没有架构这一份的项目不给，这一块不出，表页与加它之前逐字节相同。
const ARCH_DIR = '../arch/';
function moduleMark(of, file) {
  if (!of) return '';
  const m = of.get(file);
  return m ? `<br><span class="muted">模块：</span><a href="${ARCH_DIR}m-${fileSlug(m.id)}.html"><code data-k="module">${esc(m.id)}</code> ${esc(m.title)}</a>`
    : '<br><span class="muted">模块：<span data-k="module">未归属</span></span>';
}

function usageRow(f, writes, ctx) {
  const marks = [...['proposed', 'confirmed'].filter((s) => f.judged.has(s)).map(judged),
    f.same ? '<span class="muted">这个文件里另有同名的建表语句，它读写的多半不是主库这张表</span>' : ''].filter(Boolean);
  // 只写处数、不写行号：代码文件的行号不上页面（契约 F 节），代码一改行号就挪、页面跟着变。
  // 项目判断补的条目没有处数：这个文件里的表名是运行时拼的，静态数不出来，处数留空、文件格里写明。
  const note = f.lines.length ? '' : '<span class="muted">这个文件里的表名是运行时拼的，由项目判断归到这张表</span>';
  const file = pathCode(f.file, true) + moduleMark(ctx.moduleOf, f.file) + ([...marks, note].filter(Boolean).length ? `<br>${[...marks, note].filter(Boolean).join(' ')}` : '');
  const n = f.lines.length ? String(f.lines.length) : '';
  return writes ? [file, VERB_ORDER.filter((v) => f.verbs.has(v)).map((v) => v.toUpperCase()).join('、'), n] : [file, n];
}

// 「它引用了谁」「谁引用了它」：前 8 条列出，其余收进 <details>，免得把字段表挤到几屏之后；
// 打印时合着的不出，另备一份只在打印时显示的，纸上不丢（同下面「谁在读」的做法）。
function refList(items) {
  const ul = (xs) => `<ul>${xs.map((x) => `<li>${x}</li>`).join('\n')}</ul>`;
  if (items.length <= LIST_TOP) return ul(items);
  const rest = items.slice(LIST_TOP);
  return `${ul(items.slice(0, LIST_TOP))}\n<details class="more"><summary>还有 ${rest.length} 条</summary>\n${ul(rest)}\n</details>\n<div class="print-only">${ul(rest)}</div>`;
}

// 外键列指向哪里：列上的 REFERENCES，或表级 FOREIGN KEY 里这一列对着的那一列（组合外键列数对不上时只写表）。
function fkTarget(t, c, ctx) {
  if (c.references) return `${tLink(c.references.table, ctx)}${c.references.column ? `.${esc(c.references.column)}` : ''}`;
  const k = t.constraints.find((x) => x.type === 'foreign key' && x.references && (x.columns || []).includes(c.name));
  if (!k) return '';
  const to = k.references.columns || (k.references.column ? [k.references.column] : []), col = to.length === k.columns.length ? to[k.columns.indexOf(c.name)] : null;
  return `${tLink(k.references.table, ctx)}${col ? `.${esc(col)}` : ''}`;
}

// 字段表的「含义」一栏（契约 G 节「页面」）：来源里的注释与说明各自带标记，都在；过期的说明标「待更新」。
// 外键列两样都没有时机械给一句「指向 <表>.<列>」，标「取自来源」——它的含义由引用关系给出。
// 格子带 data-note / data-state，核对器按它读回这一列的说明状态；来源里的注释原文带 data-k="comment"、说明的正文带 data-k="note"，
// 标记只包着文字本身、不包出处标记（契约 C 节「机器读得回来」：核对器只认这些标记，不认样式类名）。没有注释的列不出 comment 那一块。
function meaning(t, c, ctx) {
  const n = ctx.notes[c.anchor], parts = [];
  if (c.comment) parts.push(`<div class="m">${origin('comment')}<br><span class="pre" data-k="comment">${esc(c.comment)}</span></div>`);
  if (n) parts.push(`<div class="m">${noteMark(n)}\n<div data-k="note">${noteHtml(n.text)}</div></div>`);
  if (!parts.length) { const to = fkTarget(t, c, ctx); if (to) parts.push(`<div class="m">${origin('fact')}<br>指向 ${to}</div>`); }
  return { attrs: { 'data-note': c.anchor, 'data-state': noteState(n) }, html: parts.join('\n') };
}

function usage(t, kind, ctx) {
  const writes = kind === 'writes', what = writes ? '写' : '读';
  const head = `<h2>谁在${what}这张表 ${origin('code')}</h2>`;
  const files = byFile(ctx.usage[t.name]?.[kind] || []);
  if (!files.length) {
    const n = ctx.dynamicOpen, u = ctx.unscannedN;
    return `${head}\n<p class="muted">没有找到${what}这张表的代码。${n ? `另有 ${n} 处表名是运行时拼的，<a href="index.html#dynamic">见清单</a>。` : ''}${u ? `另有 ${u} 个文件没扫成，<a href="index.html#unscanned">见清单</a>。` : ''}</p>`;
  }
  const hd = writes ? ['文件', '动作', '处数'] : ['文件', '处数'];
  const wd = writes ? [null, '200px', '56px'] : [null, '56px'];
  // 一个文件一行，行带 data-row="writer" / "reader"，行里的路径带 data-k="file"，核对器按它读回、与事实比（契约 C 节「机器读得回来」、H 节第 2 项）；
  // 只在打印时显示的那一份是重复的，行上不带标记，免得同一个文件被数两遍。
  const cells = files.map((f) => usageRow(f, writes, ctx)), mark = (r) => ({ attrs: { 'data-row': writes ? 'writer' : 'reader' }, cells: r });
  const rest = cells.slice(USAGE_TOP);
  // 其余的收进 <details>（不用脚本）；打印时 <details> 合着的内容不出，另备一份只在打印时显示的，纸上不丢。
  const more = rest.length
    ? `<details class="more"><summary>还有 ${rest.length} 个文件</summary>\n${table(hd, rest.map(mark), wd)}\n</details>\n<div class="print-only"><p class="muted">还有 ${rest.length} 个文件：</p>\n${table(hd, rest, wd)}\n</div>`
    : '';
  const lead = `<p class="muted">${files.length} 个文件，按${what}这张表的处数从多到少排${rest.length ? `，前 ${USAGE_TOP} 个列在这里、其余在下面展开` : ''}；处数是这个文件里引用它的 SQL 语句有几处。</p>`;
  return [head, lead, table(hd, cells.slice(0, USAGE_TOP).map(mark), wd), more].filter(Boolean).join('\n');
}

// 按名字删约束、却没对上任何约束的语句（契约 B 节 maybeDropped）：库里自动起的名字可能被截短或加了数字，这条语句也许真删掉了什么，
// 静态看不出来，页面顶上让读者知道下面的约束未必都还在。取事实那边还没出这个键时按「没有」处理。
function droppedHint(t) {
  const list = t.maybeDropped || [];
  if (!list.length) return '';
  return `<div class="notice" role="note"><p>这张表有 ${list.length} 条按名字删约束的语句没对上任何约束，下面的约束里可能有库里已经删掉的</p>\n<ul>${list.map((x) => `<li>${src(x.file, x.line)}：${code(x.name ?? '')}</li>`).join('\n')}</ul></div>`;
}

export function tablePage(t, ctx) {
  const g = ctx.groupOf.get(t.name), unf = ctx.unfoldedBy.get(t.name) || [];
  if (!g) throw new Error(`表 ${t.name} 不在文档模型 groups 的任何一组里`); // links 保证每张表恰在一组；对不上是模型的错，不悄悄出一页没组的
  const hint = unf.length
    ? `<div class="notice" role="note"><p>这张表有 ${unf.length} 处要到库里运行时才生效的改动没有并进来，下面的约束可能与库里不一致</p>\n<ul>${unf.map((u) => `<li>${src(u.file, u.line)}：${code(u.head ?? '')}</li>`).join('\n')}</ul></div>`
    : '';
  // 名字、类型、可空、默认、键与约束、引用六格带 data-k，格子里的文字就是模型里的值（可空写「是」「否」，没有默认值的为空），核对器按它读回。
  // 名字一格是这一行显示的列名：行靠 data-anchor 配，显示的列名写错了也要看得出（H 节第 2 项「键不许只放在属性里」）。
  // 键与约束一格依次是「主键」「唯一」、CHECK 原文、GENERATED 原文（契约 B 节 generated：IDENTITY 或算出来的列），各占一行。
  const k = (key, html) => ({ attrs: { 'data-k': key }, html });
  const fields = t.columns.map((c, i) => ({
    attrs: { 'data-anchor': c.anchor },
    cells: [
      String(i + 1), k('name', codeBreak(c.name)), k('type', code(c.type)), k('nullable', c.nullable ? '是' : '否'), k('default', c.default == null ? '' : code(c.default)),
      k('key', [c.primaryKey && '主键', c.unique && '唯一', c.check && codeBreak(flat(c.check)), c.generated && codeBreak(flat(c.generated))].filter(Boolean).join('<br>')),
      k('ref', c.references ? refText({ to: c.references.table, toCols: c.references.column ? [c.references.column] : [], onDelete: c.references.onDelete, onUpdate: c.references.onUpdate }, ctx) : ''),
      meaning(t, c, ctx),
    ],
  }));
  // 约束与索引多半和表写在同一个文件里，同文件只写行号，不同才写全；在代码文件里的只写文件（见上面 src）。
  const near = (file, line) => (isCodeFile(file) ? esc(file) : file === t.file ? `第 ${esc(line)} 行` : at(file, line));
  // 每一行带 data-row="constraint" / "index"，核对器按它数行（契约 C 节「机器读得回来」）。
  const row = (kind, cells) => ({ attrs: { 'data-row': kind }, cells });
  const cons = t.constraints.map((c) => row('constraint', [esc(CON_TYPE[c.type] || c.type), c.name ? codeBreak(c.name) : UNNAMED, cols(c.columns || []), codeBreak(flat(c.raw ?? c.check ?? '')), near(c.file, c.line)]));
  const idx = t.indexes.map((x) => row('index', [codeBreak(x.name ?? ''), code(flat(x.columns ?? '')) + (x.options ? ` ${code(flat(x.options))}` : ''), x.unique ? '是' : '', esc(x.method ?? ''), x.where ? code(flat(x.where)) : '', near(x.file, x.line)]));
  // 建表之后的改动：紧贴在 ALTER TABLE 上方的注释，讲这一批改动为什么做，归给表、不挂到某一列上（契约 B、C 节）。
  // 改它的语句可以写在靠后的建表文件里，出处一律写全「文件 第 N 行」（代码文件只写文件）。
  const changes = (t.changes || []).map((x) => [
    src(x.file, x.line),
    x.addedColumns.length ? x.addedColumns.map(codeBreak).join('、') : '<span class="muted">没有加列</span>',
    x.comment ? multi(x.comment) : '',
  ]);
  const outs = ctx.out.get(t.name), ins = ctx.inc.get(t.name) || [];
  const body = [
    hint,
    droppedHint(t),
    `<h1>${esc(t.name)}</h1>`,
    `<p>出处：${src(t.file, t.line)} ${origin('fact')}<br>所在的组：<a href="${g.file}">${esc(g.label)}</a>${judged(g.status) ? ` ${judged(g.status)}` : ''}<br>服务的需求：<span class="muted">未关联——需求一侧的关联在后面的阶段接上</span></p>`,
    // 说明区带锚点与状态（none / draft / reviewed / stale），核对器按它读回。
    noteSection(t.anchor, ctx.notes[t.anchor]),
    `<h2>注释 ${origin('comment')}</h2>`,
    t.comment ? `<p>${multi(t.comment)}</p>` : '<p class="muted">来源里没写这张表的注释。</p>',
    `<h2>关系 ${origin('fact')}</h2>`,
    miniDiagram(t, ctx),
    '<h3>它引用了谁</h3>',
    outs.length ? refList(outs.map((r) => `${cols(r.cols)} → ${refText(r, ctx)}`)) : '<p class="muted">不引用别的表。</p>',
    '<h3>谁引用了它</h3>',
    ins.length ? refList(ins.map((r) => `${tLink(r.from, ctx)} 的 ${cols(r.cols)}${r.toCols.length ? ` → 本表 ${cols(r.toCols)}` : ''}${r.onDelete ? ` · ON DELETE ${esc(r.onDelete)}` : ''}`)) : '<p class="muted">没有别的表引用它。</p>',
    `<h2>字段（${t.columns.length} 个）${origin('fact')}</h2>`,
    // 「含义」一栏分剩下的宽度，不窄于表宽的三成（契约 C 节「读得全」：字段的含义是这张表里最要读的字）：
    // 其余定宽合计 58% + 92px，表宽 1068（1280 窗口下正文宽）时含义约 33%，到保底的 860 时约 31%。
    // 原先约四分之一宽，一段十一项的枚举解释折成几十行高（2026-11-23 下游真数据）。
    table(['#', '名字', '类型', '可空', '默认', '键与约束', '引用', '含义'], fields, ['44px', '14%', '11%', '48px', '10%', '12%', '11%', null]),
    usage(t, 'writes', ctx),
    usage(t, 'reads', ctx),
    cons.length ? `<h2>表级约束 ${origin('fact')}</h2>\n${table(['类型', '名字', '列', '原文', '出处'], cons, ['72px', '24%', '16%', null, '120px'])}` : '',
    `<h2>索引 ${origin('fact')}</h2>`,
    idx.length ? table(['名字', '列', '唯一', '方法', '条件', '出处'], idx, ['26%', null, '52px', '64px', '18%', '120px']) : '<p class="muted">没有索引。</p>',
    changes.length ? `<h2>建表之后的改动 ${origin('fact')}</h2>\n<p class="muted">建表之后又改这张表的语句（ALTER TABLE）上方紧贴着的注释，一段一行；出处是注释的第一行，列是紧跟在注释后面那几条语句加进来的。</p>\n${table(['出处', '加了哪些列', `注释 ${origin('comment')}`], changes, ['22%', '22%', null])}` : '',
  ].filter(Boolean).join('\n');
  return { path: `db/${tableFile(t.name)}`, html: page({ title: title(ctx, t.name), depth: 1, crumbs: crumbs([g.label, `db/${g.file}`], [t.name]), body, main: { 'data-anchor': t.anchor } }) };
}
