// arch-module.mjs —— 架构这一份的模块页 arch/m-<id>.html（第三期契约 docs/readable-spec/phase3-arch-contract.md D 节）。
// 为什么有它：架构师点进一个模块，要看到它管什么、有哪些文件（每个文件干什么——文件头说明是这一页上最有用的原文）、
// 对外提供哪些接口、依赖谁、谁依赖它、碰哪些表（规格 FLOW-1 第 3 步）。自成一体，自上而下：
// 说明 → 邻居图 → 接口 → 文件 → 它依赖的模块 → 依赖它的模块 → 对外提供的名字 → 读写的表 → 用到的外部包；哪一段没有内容就写「没有」。
// 文件头说明与处理函数的说明是「来源里的注释」，原文完整上页面，不截断、不改写；代码文件的行号不上页面。
// 读回标记照 D 节末尾那张表（各段 data-section，一行一条 data-row，要比的格子 data-k；显示键的那一格也带 data-k，见 arch-kit.mjs）。
// 测试注入点（E 节末尾）：出页面的代码故意出错，落盘前的自检（check-arch.mjs）该拦下，build 退出码 3、原有页面不动、点名哪一页哪一项。
// 这里管三个——arch-render 第一个有文件的模块页漏掉第一个文件那一行；arch-show-key 同一页第一个文件显示的路径写错、data-row 不动；
// arch-show-head 第一条文件头说明（照模块的先后、模块里文件的先后）少最后一个字。arch-drop-section 在 arch.mjs。
// 找不到可下手的地方（没有文件、没有文件头说明）直接报错：悄悄什么都不做，测试会把「没注入」当成「自检拦下了」或「自检漏了」。
import { esc, code, codeBreak, fileSlug, page, table, origin } from './layout.mjs';
import { CSS, crumbs, pageTitle, judgedMark, pathCode, k, row, section, none, inlineRows, mRef, archNote, folded, pairList, modFile, sizeBand, approxLines, routeWhy } from './arch-kit.mjs';
import { neighbors } from './arch-graph.mjs';

const PAIRS_INLINE = 3; // 文件对不超过 3 对的直接列出，多的收进可展开的区

// 接口这一行的键与路径（D 节那张表）：方法加空格加完整路径，拼不出完整路径的用源码里的写法。模块页与接口总表同一个写法。
export const routeKey = (r) => `${r.method} ${r.fullPath ?? r.path}`;
const urlCode = (p) => `<code>${esc(p).replace(/\//g, '/<wbr>')}</code>`;
// 路径那一格：data-k="path" 只包着路径本身；拼不出完整路径的另起一行照原因标（data-k="why"），不算进路径的字。
export const routePath = (r) => {
  const why = routeWhy(r);
  return `<span data-k="path">${urlCode(r.fullPath ?? r.path)}</span>${why ? `<br><span class="muted" data-k="why">${why}</span>` : ''}`;
};
export const routeCells = (r) => [k('method', esc(r.method)), routePath(r), k('handler', codeBreak(r.handler)), k('file', pathCode(r.file))];
// 处理函数的说明（只在模块页上，接口总表不放）：有就原文全文带 data-k="doc"，没有的写「没有说明」、不带 data-k。
const docCell = (r) => (r.doc == null ? '<span class="muted">没有说明</span>' : k('doc', `<span class="pre">${esc(r.doc)}</span>`));

// 读写的表：每张表一行，rw 写「读」「写」或「读写」（D 节那张表）；表名链到数据库设计里那张表的页面（文件名照第一期的推法）。
// 不在建表定义里的（视图等）没有表页，只写名字。
const rwOf = (t, m) => (m.tables.reads.includes(t) ? '读' : '') + (m.tables.writes.includes(t) ? '写' : '');
const tableRef = (v, t) => (v.tables.has(t) ? `<a href="../db/t-${fileSlug(t)}.html">${codeBreak(t)}</a>` : codeBreak(t));

function pairsCell(pairs) {
  const n = pairs.length;
  return n <= PAIRS_INLINE ? `${n} 对${pairList(pairs)}` : folded(`${n} 对文件`, pairList(pairs));
}

// 注入点落在哪：{ at, module, file }；没设注入点或设的不归这里管，at 为 null 或别的名字，modulePage 不动。
export function injection(v) {
  const at = process.env.READABLE_FAIL_AT;
  if (at === 'arch-render' || at === 'arch-show-key') {
    const m = v.modules.find((x) => x.files.length);
    if (!m) throw new Error(`READABLE_FAIL_AT=${at}：没有一个模块有文件，没有可下手的地方`);
    return { at, module: m.id };
  }
  if (at === 'arch-show-head') {
    for (const m of v.modules) for (const f of m.files) if (f.head != null && /\S/.test(f.head)) return { at, module: m.id, file: f.path };
    throw new Error('READABLE_FAIL_AT=arch-show-head：没有一条文件头说明，没有可下手的地方');
  }
  return { at: at ?? null };
}

// 文件头说明取自哪一处（契约 B 节「文件」的 headAt）：JS 一族写在开头那串引用语句之后的那块注释，说的有时只是紧跟着的那一条定义、
// 不是整个文件，所以在说明上方标一句，由读的人判断；取自文件最前面的不标。事实里还没有 headAt 这一栏的（键不在；取事实那边
// 2026-11-23 起才出）按文件最前面算；键在而值不认识的（含有说明却记 null 的）直接报错，不猜。
const AFTER_IMPORTS = '写在引用语句之后的第一块注释';
function headMark(f) {
  if (f.headAt === undefined || f.headAt === 'top') return '';
  if (f.headAt === 'after-imports') return `<span class="muted" data-k="headAt">${AFTER_IMPORTS}</span><br>`;
  throw new Error(`文件 ${f.path} 有文件头说明，取自哪一处却不认识：${f.headAt}`);
}

// 文件那一段的一行：路径（data-k="key"）、规模档、是不是入口、文件头说明全文（data-k="head"，没有的不带），
// 说明取自引用语句之后的，说明上方另有一句标记（data-k="headAt"），两样各包各的，不算进对方的字。
function fileRow(f, inj, m, i) {
  const here = inj.module === m.id;
  const shownPath = here && inj.at === 'arch-show-key' && i === 0 ? `${f.path}~` : f.path;
  const head = here && inj.at === 'arch-show-head' && f.path === inj.file ? f.head.replace(/\S(\s*)$/u, '$1') : f.head;
  return row(f.path, [k('key', pathCode(shownPath)), k('size', sizeBand(f.lines)), k('entry', f.entry ? '是' : ''),
    head == null ? '<span class="muted">没有文件头说明</span>' : `${headMark(f)}<span class="pre" data-k="head">${esc(head)}</span>`]);
}

export function modulePage(v, m, inj = { at: null }) {
  const files = inj.at === 'arch-render' && inj.module === m.id ? m.files.slice(1) : m.files;
  const tables = [...new Set([...m.tables.reads, ...m.tables.writes])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const head = (title, n, mark) => `<h2>${title}${n == null ? '' : `（${n}）`} ${mark}</h2>`;
  const routes = m.routes.map((r) => row(routeKey(r), [...routeCells(r), docCell(r)]));
  const uses = m.uses.map((u) => row(u.module, [mRef(v, u.module, { kOn: true }), pairsCell(u.pairs), k('names', u.names.map(code).join(', '))]));
  const provides = m.provides.map((p) => row(`${p.file}#${p.name}`, [k('name', code(p.name)), k('file', pathCode(p.file)),
    k('by', p.by.map((id) => `<a href="${modFile(id)}">${esc(id)}</a>`).join(' '))]));
  const body = [
    `<h1>${esc(m.title)}</h1>`,
    `<p>模块 ${code(m.id)}${m.layer ? ` · 所在的层：${esc(m.layer)}` : ''} ${judgedMark(m.status)}</p>`,
    `<p class="lead">${m.files.length} 个文件、${approxLines(m.lines)}；${m.routes.length} 个接口；依赖 ${m.uses.length} 个模块、被 ${m.usedBy.length} 个模块依赖；读 ${m.tables.reads.length} 张表、写 ${m.tables.writes.length} 张表。${origin('fact')}</p>`,
    archNote(`module:${m.id}`, m.note, '说明', '还没有说明。这个模块管什么，先看下面的文件与它们的文件头说明。'),
    `<h2>它与别的模块 ${origin('fact')}</h2>`,
    neighbors(v, m),
    section('routes', `${head('接口', m.routes.length, origin('fact'))}\n${routes.length
      ? `<p class="muted">处理函数的说明是函数开头那一段，原文照录${origin('comment')}。完整路径是一路挂载的前缀加上装饰器里写的路径。</p>\n${table(['方法', '完整路径', '处理函数', '所在文件', '处理函数的说明'], routes, ['72px', '24%', '16%', '20%', null])}`
      : none('没有（只认装饰器写法的路由）')}`),
    section('files', `${head('文件', files.length, origin('fact'))}\n${files.length
      ? `<p class="muted">文件头说明是文件开头的那一段注释或文档字符串，原文完整照录${origin('comment')}；标着「${AFTER_IMPORTS}」的，取自 JS 文件开头那串引用语句后面，说的有时只是紧跟着的那一条定义，不一定是整个文件。入口是带 <code>if __name__ == "__main__":</code> 的文件，或者在模块级定义了 <code>FastAPI(…)</code> 应用的文件。</p>\n${table(['文件', '规模', '入口', '文件头说明'], files.map((f, i) => fileRow(f, inj, m, i)), ['26%', '112px', '48px', null])}`
      : none()}`),
    section('uses', `${head('它依赖的模块', m.uses.length, origin('fact'))}\n${uses.length
      ? `<p class="muted">本模块的文件引用了对方模块的文件。文件对写成「本模块的文件 → 对方的文件」；名字是引用到的名字，<code>*</code> 是引用了整个文件。</p>\n${table(['模块', '通过哪几对文件', '用了哪些名字'], uses, ['22%', '38%', null])}`
      : none()}`),
    section('usedBy', `${head('依赖它的模块', m.usedBy.length, origin('fact'))}\n${m.usedBy.length
      ? `<p class="muted">对方模块的文件引用了本模块的文件；通过哪几对文件、用了哪些名字，见下面「对外提供的名字」与对方那一页。</p>\n${inlineRows(m.usedBy.map((id) => ({ key: id, html: mRef(v, id, { kOn: true, br: false }) })))}`
      : none()}`),
    section('provides', `${head('对外提供的名字', m.provides.length, origin('fact'))}\n${provides.length
      ? `<p class="muted">本模块的文件里被别的模块引用到的名字；<code>*</code> 是整个文件被引用。</p>\n${table(['名字', '在哪个文件', '被哪几个模块用'], provides, ['26%', '38%', null])}`
      : none()}`),
    section('tables', `${head('读写的表', tables.length, origin('code'))}\n${tables.length
      ? table(['表', '读写'], tables.map((t) => row(t, [k('key', tableRef(v, t)), k('rw', rwOf(t, m))])), ['50%', null])
      : none()}`),
    section('externals', `${head('用到的外部包', m.externals.length, origin('fact'))}\n${m.externals.length
      ? inlineRows(m.externals.map((x) => ({ key: x, html: `<code data-k="key">${esc(x)}</code>` })))
      : none()}`),
  ].join('\n');
  return { path: `arch/${modFile(m.id)}`, html: page({ title: pageTitle(v, m.title), depth: 1, crumbs: crumbs([m.title]), body, main: { 'data-anchor': `module:${m.id}` }, css: CSS }) };
}
