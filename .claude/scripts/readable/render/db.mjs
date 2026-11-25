// db.mjs —— 数据库设计的页面（契约 docs/readable-spec/phase1-db-contract.md C 节、F 节「页面」；架构稿 §2 render）。
// 为什么有它：接手团队第一步就看数据库设计，要能只看文档、不问原作者，说清任意一张表存的是什么、谁写谁读（规格 SC-1）。
// 只读文档模型（build --facts-json 那份），不回头读来源文件；出 [{path, html}]，落盘在 publish.mjs。表页在 db-table.mjs。
// 没有注释的地方留空，不编。
import { cmp } from '../model.mjs';
import { esc, code, at, origin, judged, fileSlug, page, table, diagram, LEGEND, DIAGRAM_MAX } from './layout.mjs';
import { DOC, tableFile, tLink, crumbs, title, outRefs, erNode, tablePage, src, isCodeFile } from './db-table.mjs';
import { noteSection, firstPara, staleMark } from './note.mjs';
import { scrub } from './db-scrub.mjs';
import { REDACTED } from '../sensitive.mjs';

export { tableFile };
export const GROUP_MAX = DIAGRAM_MAX; // 契约 C 节：一组超过 12 张表的切成几页，每页的关系图最多 12 张表
export const GROUP_DIAGRAM_MAX = 20; // 契约 F 节：组超过 20 个就不画分组关系图，只留清单

// 分组在文档模型里只有一份 groups（契约 F 节），成员以它为准；这里只管怎么切页：
// 超过 12 张的按组内顺序（模型里已按表名排好）均分成几页（15 张 → 8 + 7），免得最后一页只剩一两张；文件名 g-<组 id>，切页的接 -1、-2。
export function groupPages(groups) {
  return groups.flatMap((grp) => {
    const list = grp.tables, parts = Math.max(1, Math.ceil(list.length / GROUP_MAX)), small = Math.floor(list.length / parts), extra = list.length % parts;
    let from = 0;
    return Array.from({ length: parts }, (_, i) => {
      const size = small + (i < extra ? 1 : 0), suf = parts > 1 ? `-${i + 1}` : '';
      const pg = { label: grp.title + suf, grp, status: grp.status, part: i + 1, parts, file: `g-${fileSlug(grp.id)}${suf}.html`, tables: list.slice(from, from + size) };
      from += size;
      return pg;
    });
  });
}

const firstSentence = (s) => {
  if (!s) return '';
  const line = s.split('\n')[0], k = line.indexOf('。'), t = Array.from(k >= 0 ? line.slice(0, k + 1) : line);
  return t.length > 120 ? `${t.slice(0, 119).join('')}…` : t.join('');
};
// 组名后面的档位：项目判断的组标「AI 提议」/「人已确认」，按前缀分出来的（default）不标。
const withStatus = (html, status) => (judged(status) ? `${html} ${judged(status)}` : html);
// 清单里每张表那一行（契约 G 节「页面」）：有表说明用它的第一段、标「说明」（过期的另标「待更新」），没有用来源里的表注释，都没有留空。
const purpose = (name, ctx) => {
  const t = ctx.tables.get(name), n = t && ctx.notes[t.anchor];
  if (n) return `${firstPara(n.text)} ${origin('note')}${staleMark(n)}`;
  return t?.comment ? `${esc(firstSentence(t.comment))} ${origin('comment')}` : '';
};
// 清单页与组页里一组一张的小表，各栏定宽，几张表的列对得齐（契约 C 节「读得全」）。
const LIST_W = ['32%', null], GROUP_W = ['26%', '56px', '24%', '76px', null];

function index(model, cfg) {
  const tables = new Map(model.tables.map((t) => [t.name, t]));
  const pages = groupPages(model.groups), groupOf = new Map();
  for (const g of pages) for (const n of g.tables) if (!groupOf.has(n)) groupOf.set(n, g);
  const out = new Map(), inc = new Map(), unfoldedBy = new Map();
  for (const t of model.tables) {
    out.set(t.name, outRefs(t));
    for (const r of out.get(t.name)) (inc.get(r.to) || inc.set(r.to, []).get(r.to)).push(r);
  }
  for (const u of model.unfolded) {
    for (const n of new Set(u.tables)) if (tables.has(n)) (unfoldedBy.get(n) || unfoldedBy.set(n, []).get(n)).push(u);
  }
  for (const list of inc.values()) list.sort((a, b) => cmp(a.from, b.from) || cmp(a.cols.join(','), b.cols.join(',')));
  // 没归属的运行时表名：表页上「没有找到写（读）这张表的代码」后面补一句「另有 N 处……见清单」（契约 F 节）。
  const dynamicOpen = model.dynamic.filter((d) => !d.assigned).length;
  // 没扫成的文件：同处再补一句「另有 N 个文件没扫成，见清单」——那些文件里的写读不在任何一张表的页面上（契约 F 节）。
  const unscannedN = model.unscanned.length;
  // 说明：取事实那边还没并进 notes 时没有这个键，按「全都没写」出。
  return { cfg, tables, pages, groupOf, out, inc, unfoldedBy, usage: model.usage, dynamicOpen, unscannedN, notes: model.notes || {} };
}

function groupPage(g, ctx) {
  const set = new Set(g.tables);
  const nodes = g.tables.map((name) => erNode(name, ctx, set));
  const sib = ctx.pages.filter((x) => x.grp === g.grp);
  const parts = g.parts > 1
    ? `<p>${esc(g.grp.title)} 组共 ${g.grp.tables.length} 张表，按名字顺序分成 ${g.parts} 页：${sib.map((x) => (x === g ? `<strong>${esc(x.label)}</strong>` : `<a href="${x.file}">${esc(x.label)}</a>`)).join('、')}</p>`
    : '';
  const why = g.status !== 'default' ? '这一组是项目判断分的，组名后面标着是谁的判断。'
    : g.grp.id === '_other' ? '这里是表名前缀只有一张表的那些。'
      : g.grp.id === '_ungrouped' ? '项目判断的分组没有收进去的表。'
        : `表名都以 <code>${esc(g.grp.id)}_</code> 开头。`;
  const rows = g.tables.map((n) => {
    const t = ctx.tables.get(n), to = [...new Set(ctx.out.get(n).map((r) => r.to))].sort(cmp), ins = new Set((ctx.inc.get(n) || []).map((r) => r.from));
    return [tLink(n, ctx, true), String(t.columns.length), to.map((x) => tLink(x, ctx, true)).join(', '), ins.size ? `<span class="nw">${ins.size} 张表</span>` : '', purpose(n, ctx)];
  });
  const body = [
    `<h1>${withStatus(esc(g.label), g.status)}</h1>`,
    `<p class="lead">${DOC}的一个分组，${g.tables.length} 张表。${why}</p>`,
    parts,
    noteSection(`group:${g.grp.id}`, ctx.notes[`group:${g.grp.id}`]),
    `<h2>关系图 ${origin('fact')}</h2>`,
    nodes.length
      ? '<p class="muted">一个方框是一张表，写主键（PK）与外键（FK）列，每条外键后面写着「→ 被引用的表」；被引用的表也在这一页的，另画一条连线，箭头指向它。点方框看那张表。</p>\n'
        + `<div class="scroll">${diagram(nodes, `${g.label} 组的关系图`)}</div>`
      : '<p class="muted">这一组没有表。</p>',
    `<h2>组内各表 ${origin('fact')}</h2>`,
    table(['表', '列数', '它引用了', '被引用', '一句话用途'], rows, GROUP_W),
  ].filter(Boolean).join('\n');
  return { path: `db/${g.file}`, html: page({ title: title(ctx, g.label), depth: 1, crumbs: crumbs([g.label]), body }) };
}

// 分组关系图（契约 F 节「页面」）：接手的人先要看到整个库分成哪几块、块与块怎么连，然后才是一张张表。
// 一个方框一个组，写组名与表数，点方框到那一组（切了页的到第一页）；两组之间有外键的画一条线，线上写几条外键，
// 箭头指向被引用的那一组；组内的外键不画。一张表恰在一组（links 保证），引用了建表定义里没有的表的外键不算。
function groupDiagram(model, ctx) {
  const gs = model.groups;
  if (gs.length > GROUP_DIAGRAM_MAX) return `<p class="muted">共 ${gs.length} 个组，超过 ${GROUP_DIAGRAM_MAX} 个不画分组关系图，只留下面的清单。</p>`;
  if (gs.length < 2) return '';
  const home = new Map(), count = new Map(gs.map((g) => [g.id, new Map()]));
  for (const g of gs) for (const n of g.tables) if (!home.has(n)) home.set(n, g.id);
  for (const t of model.tables) for (const r of ctx.out.get(t.name)) {
    const a = home.get(r.from), b = home.get(r.to);
    if (a && b && a !== b) count.get(a).set(b, (count.get(a).get(b) || 0) + 1);
  }
  const first = new Map(ctx.pages.filter((p) => p.part === 1).map((p) => [p.grp.id, p.file]));
  // 枢纽：被一半以上的组引用的那一组（契约 F 节）。几乎每个组都连着它，线画出来只是一捆，盖住别的组之间怎么连；
  // 指向它的线不画，改在图下用一句话写明谁引用了它、各几条。方框照旧画。
  const hubs = gs.filter((g) => gs.filter((o) => count.get(o.id).has(g.id)).length * 2 > gs.length);
  const hubIds = new Set(hubs.map((g) => g.id));
  const nodes = gs.map((g) => {
    const to = [...count.get(g.id).keys()].filter((b) => !hubIds.has(b)).sort(cmp);
    const lines = [`${g.tables.length} 张表`];
    if (hubIds.has(g.id)) lines.push('几乎每个组都引用');
    return { name: g.id, label: g.title, href: first.get(g.id), lines, parents: to, counts: Object.fromEntries(to.map((b) => [b, count.get(g.id).get(b)])) };
  });
  const gLink = (g) => `<a href="${esc(first.get(g.id))}">${esc(g.title)}</a>`;
  const hubNotes = hubs.map((h) => {
    const who = gs.filter((o) => count.get(o.id).has(h.id)).map((o) => `${gLink(o)}（${count.get(o.id).get(h.id)} 条）`);
    return `<p>这些组都引用 ${gLink(h)}：${who.join('、')}。指向它的线没画。</p>`;
  });
  return [
    `<h2>分组关系图 ${origin('fact')}</h2>`,
    '<p class="muted">一个方框是一组，写组名与表数；两组之间有外键的画一条线，线上的数是几条外键，箭头指向被引用的那一组。组内的外键不画。点方框看那一组。</p>',
    `<div class="scroll">${diagram(nodes, `${DOC}的分组关系图`, GROUP_DIAGRAM_MAX)}</div>`,
    ...hubNotes,
  ].join('\n');
}

// 隐去了几处、各在哪（契约 G 节「不带出去的东西」）：只写位置与哪一项，不写原文。配置与项目判断没有行号，只写文件；
// 代码文件（含 ddl 里列的）的行号不上页面（F 节），也只写文件。
function redactions(hits) {
  if (!hits.length) return '';
  const n = hits.reduce((s, h) => s + h.n, 0);
  const rows = hits.map((h) => [h.anchor ? `说明 ${code(h.anchor)}` : h.line == null || isCodeFile(h.file) ? code(h.file) : at(h.file, h.line), esc(h.what), String(h.n)]);
  return `<div class="notice" role="note"><p>隐去了 ${n} 处：来源或说明里形如内网地址、带口令的地址或密钥的字样，页面上换成了「${REDACTED}」，原文只在来源里。</p>\n${table(['在哪', '哪一项', '处数'], rows, ['34%', null, '64px'])}</div>`;
}

// 建表定义的四张问题清单形状不尽相同，按已知的键出列，其余简单值并进「原因」，不丢。
const KNOWN = new Set(['file', 'line', 'head', 'text', 'tables', 'table', 'column', 'reason']);
function issues(list, ctx) {
  const rows = list.map((x) => {
    const tabs = x.tables ? x.tables.map((n) => tLink(n, ctx)).join(', ') : x.table ? tLink(x.table, ctx) + (x.column ? `.${esc(x.column)}` : '') : '';
    const rest = Object.keys(x).filter((k) => !KNOWN.has(k) && x[k] != null && typeof x[k] !== 'object').sort(cmp).map((k) => `${esc(k)}：${esc(x[k])}`);
    return [src(x.file, x.line), tabs, code(x.head ?? x.text ?? ''), [x.reason ? esc(x.reason) : '', ...rest].filter(Boolean).join('<br>')];
  });
  const withWhy = rows.some((r) => r[3]);
  return table(['出处', '涉及的表', '原文开头', ...(withWhy ? ['原因'] : [])], withWhy ? rows : rows.map((r) => r.slice(0, 3)));
}

const ISSUES = [
  ['unfolded', '未合并的动态定义', '写在 DO 块里、要到库里运行时才生效的改动，静态读不出结果，没有并进上面的表结构。被点到的表，表页顶上有提示。'],
  ['unparsed', '未解析的语句', '形状是建表定义、却解析不了的语句。没有猜，原文开头列在这里。'],
  ['conflicts', '定义冲突', '同一样东西定义了两遍，或要删的约束找不到名字；文档保留先前的定义。'],
  ['orphanAlters', '改了不存在的表', '修改的是一张在建表定义里从没建过的表。'],
];

// 谁写谁读这一侧的四张清单（契约 F 节），空的不显示。每项 [模型里的键, 页内锚点, 标题, 说明, 表头, 一行]。
const CODE_LISTS = [
  ['dynamic', 'dynamic', '表名是运行时拼的', '代码里的 SQL 动词后面跟的是占位（如 <code>{table}</code>、<code>%s</code>），或字符串到动词就结束、后面接着拼接，或写表接口的第一个实参不是字符串——静态看不出是哪张表，表页上「取自来源」的写读里没有这几处。项目判断（<code>docs/readable-src/map.json</code> 的 <code>dynamicTables</code>）把这个文件归到具体表上的标「已归属」，那些表的页面上列着这个文件。',
    ['文件', '动作', '原文开头', '归属'], (d) => [code(d.file), esc(String(d.verb ?? '').toUpperCase()), code(d.head), d.assigned ? '<span class="o">已归属</span>' : '']],
  ['ambiguous', 'ambiguous', '提到了表名、像 SQL 又不像的', '代码的字符串里，动词不是全大写、后面跟着建表定义里的表名，再往后却不像一条 SQL 语句（比如日志、报错里的「failed to delete from orders, will retry」）——没有算进任何一张表的谁写谁读。列在这里而不丢掉，万一是一种没见过的写法。',
    ['文件', '动作', '表', '原文开头'], (a, ctx) => [code(a.file), esc(String(a.verb ?? '').toUpperCase()), ctx.tables.has(a.table) ? tLink(a.table, ctx) : code(a.table), code(a.head)]],
  ['codeTables', 'code-tables', '代码里建的表', '代码的字符串里出现的 <code>CREATE TABLE</code>（带 <code>TEMP</code> 的不算），没有并进上面的表结构。配置的 <code>ddl</code> 列了的代码文件，里面的建表语句会并进来，不在这里。',
    ['文件', '表名'], (c, ctx) => [code(c.file), ctx.tables.has(c.name) ? tLink(c.name, ctx) : code(c.name)]],
  ['mapProblems', 'map-problems', '项目判断里对不上的', '<code>docs/readable-src/map.json</code> 里点到不存在的表或文件、一张表进了两个组、档位写错的，不拦生成，列在这里。',
    ['在哪', '怎么对不上'], (p) => [code(p.where), esc(p.problem)]],
  ['unscanned', 'unscanned', '没扫成的文件', '切到末尾还有没闭合的字符串，整个文件没扫，不出半截结果；这些文件里的写读不在任何一张表的页面上。',
    ['文件', '原因'], (u) => [code(u.file), esc(u.reason)]],
];

function indexPage(model, ctx) {
  const ncol = model.tables.reduce((s, t) => s + t.columns.length, 0), nidx = model.tables.reduce((s, t) => s + t.indexes.length, 0);
  const extra = [`${model.views.length} 个视图`, `${model.functions.length} 个数据库函数`];
  const judgedGroups = model.groups.some((g) => g.status !== 'default' || g.id === '_ungrouped');
  const basis = judgedGroups
    ? '按项目判断（<code>docs/readable-src/map.json</code>）分组，组名后面标着是谁的判断；没被收进任何组的表在「未分组」。一组超过 12 张的按名字顺序分成几页。每组一页，有关系图。'
    : '按表名第一个下划线之前的那一段分组；只有一张表的前缀并进「其它」；一组超过 12 张的按名字顺序分成几页。每组一页，有关系图。';
  const groups = model.groups.map((grp) => {
    const pgs = ctx.pages.filter((p) => p.grp === grp);
    const split = pgs.length > 1 ? `<p class="muted">分成 ${pgs.length} 页：${pgs.map((p) => `<a href="${p.file}">${esc(p.label)}</a>`).join('、')}</p>\n` : '';
    return `<h3>${withStatus(`<a href="${pgs[0].file}">${esc(grp.title)}</a>`, grp.status)} <span class="muted">${grp.tables.length} 张表</span></h3>\n${split}`
      + table(['表', '一句话用途'], grp.tables.map((n) => [tLink(n, ctx, true), purpose(n, ctx)]), LIST_W);
  });
  const objs = (list, label, none, head, row) => `<h2>${label} ${origin('fact')}</h2>\n${list.length ? table(head, list.map(row)) : `<p class="muted">${none}</p>`}`;
  const body = [
    redactions(ctx.hits),
    `<h1>${DOC}</h1>`,
    `<p>来源（按执行顺序）：${ctx.cfg.ddl.map(code).join('、')} ${origin('fact')}</p>`,
    `<p class="lead">${[`${model.tables.length} 张表`, `${ncol} 列`, `${nidx} 个索引`, ...extra].join('、')}。一张表一页，下面先分组列出。</p>`,
    noteSection('doc:db', ctx.notes['doc:db']),
    groupDiagram(model, ctx),
    `<h2>分组${judgedGroups ? '' : ` ${origin('fact')}`}</h2>`, // 项目判断的组各自在组名后面标档位
    `<p class="muted">${basis}</p>`,
    ...groups,
    objs(model.views, '视图', '建表定义里没有视图。', ['名字', '出处', '定义原文'], (v) => [`<span id="${esc(v.anchor)}">${code(v.name)}</span>${v.materialized === true ? '<br><span class="muted">物化视图</span>' : ''}`, src(v.file, v.line), `<pre>${esc(v.sql)}</pre>`]),
    objs(model.functions, '数据库函数', '建表定义里没有数据库函数。', ['名字', '出处', '签名'], (f) => [`<span id="${esc(f.anchor)}">${code(f.name)}</span>`, src(f.file, f.line), code(f.signature)]),
    ...ISSUES.filter(([k]) => model[k].length).map(([k, label, what]) => `<h2>${label}（${model[k].length} 处）${origin('fact')}</h2>\n<p class="muted">${what}</p>\n${issues(model[k], ctx)}`),
    ...CODE_LISTS.filter(([k]) => model[k].length).map(([k, id, label, what, head, row]) => {
      const n = model[k].length, unit = k === 'mapProblems' ? '条' : k === 'unscanned' ? '个' : '处'; // 各张清单的键 scrub 都给齐了（没有的是空数组）
      const tail = k === 'dynamic' ? `，已归属 ${model[k].filter((d) => d.assigned).length} 处` : '';
      return `<h2 id="${id}">${label}（${n} ${unit}${tail}）${origin(k === 'mapProblems' ? 'fact' : 'code')}</h2>\n<p class="muted">${what}</p>\n${table(head, model[k].map((x) => row(x, ctx)))}`;
    }),
    LEGEND,
  ].filter(Boolean).join('\n');
  return { path: 'db/index.html', html: page({ title: title(ctx), depth: 1, crumbs: [['文档首页', 'index.html'], [DOC]], body }) };
}

// 入口：模型 → 数据库设计的全部页面，外加首页上那一条目录项。stats 给命令行报数用。
// 各页用隐去过的模型与配置副本（db-scrub.mjs），传进来的不动；title 是隐去过的配置标题，文档集首页也用它。
// moduleOf（可不给）：架构那一份交来的「文件路径 → {id, title}」，表页上「谁在写、谁在读」的文件标出所属的模块
// （第三期契约 D 节）；不给就不标，页面与加这个参数之前逐字节相同。
export function renderDb(source, cfg, { moduleOf } = {}) {
  const { model, cfg: shownCfg, hits } = scrub(source, cfg);
  const ctx = { ...index(model, shownCfg), hits, moduleOf };
  const files = [indexPage(model, ctx), ...ctx.pages.map((g) => groupPage(g, ctx)), ...model.tables.map((t) => tablePage(t, ctx))];
  return {
    title: shownCfg.title,
    entry: { href: 'db/index.html', label: DOC, summary: `${model.tables.length} 张表，分成 ${model.groups.length} 组` },
    files,
    stats: { tables: model.tables.length, groups: model.groups.length, groupPages: ctx.pages.length, largest: Math.max(0, ...ctx.pages.map((g) => g.tables.length)) },
  };
}
