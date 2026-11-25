// arch-kit.mjs —— 架构这一份几页都要用的小件：页名与面包屑、项目判断与「待写」的标记、说明区、可展开的长清单、标记的图例
// （第三期契约 docs/readable-spec/phase3-arch-contract.md D 节）。只出字符串。
// 读回标记照 D 节末尾那张表：一行一条带 data-row（值是这一行的键），要比的格子带 data-k，各段的容器带 data-section，
// 段里没有内容时容器照样在。data-k 那个元素里显示的字就是要比的值；显示键的那一格（路径、表名、包名、模块 id）也带 data-k——
// data-row 只给核对器配行，读者看的是格子里的字，键只放在属性里，显示错了核对看不出来。模块只认 id：id 单放在一个
// <code data-k="module"> 里，标题另写在旁边。核对器（check-arch.mjs）不借这里的任何东西就读得回来。
import { esc, attrs, fileSlug, table, origin } from './layout.mjs';
import { noteMark, noteHtml, noteState, STALE_TEXT } from './note.mjs';
import { REDACTED } from '../sensitive.mjs';

export const ARCH = '架构设计';
export const LIST_TOP = 8; // 长清单前 8 条列出，其余收进可展开的区（同数据库设计「谁引用了它」）
export const modFile = (id) => `m-${fileSlug(id)}.html`;
export const crumbs = (...rest) => [['文档首页', 'index.html'], [ARCH, 'arch/index.html'], ...rest];
export const pageTitle = (v, ...parts) => [...parts, ARCH, v.title].join(' · ');
// 模块怎么分是项目判断（D 节「每一块内容照旧标来历」）；没有 modules 时按目录分出来的标「按目录分的」。
const JUDGED = { proposed: '项目判断 · AI 提议', confirmed: '项目判断 · 人已确认', default: '项目判断 · 按目录分的' };
export const judgedMark = (status) => `<span class="o o-judged">${JUDGED[status] ?? JUDGED.proposed}</span>`;
export const TODO = '<span class="o o-todo">待写</span>';
// 这一份多要的样式，只接在这几页后面（layout 的 page 的 css 参数），数据库设计与需求规格的页面一个字节不变。
export const CSS = [
  '.o-todo{border-style:dashed;color:var(--fg)}',
  'svg.er rect.band{fill:var(--soft);stroke:var(--line)}',
  'svg.er text.band{font-size:13px;font-weight:600;fill:var(--muted)}',
  '.pairs{margin:4px 0;padding-left:18px;font-size:13px}',
].join('\n');

// 确切的行数不上页面（D 节）：页面是入库的生成物，代码随便加三行，模块页与首页就跟着变，每次提交都带一批没有内容的页面差异——
// 与「代码文件的行号不上页面」同一个道理。文件按四档写规模（恰好 100、500、1000 行的归上面一档）；
// 模块与全库写「约 N 行」，模块取一位有效数字、全库取两位，满千写「千」、满万写「万」。核对器在 check-arch.mjs 里另有一份分档与取整的规矩，
// 首页模块清单的「约 N 行」它照那一份自己算、比（data-k="lines"）。
export const sizeBand = (n) => (n < 100 ? '不到 100 行' : n < 500 ? '100–500 行' : n < 1000 ? '500–1000 行' : '1000 行以上');
// 不到 100 行的一律照文件最低一档写「不到 100 行」，0 行的（没匹配到文件的空模块）也是（D 节原话「一律」）：
// 两位数取两位有效数字就是确切的数，加三行照样变，留着它等于没改。
export function approxLines(n, digits = 1) {
  if (n < 100) return '不到 100 行';
  const step = 10 ** Math.max(0, String(Math.floor(n)).length - digits), v = Math.round(n / step) * step;
  return v >= 10000 ? `约 ${v / 10000} 万行` : v >= 1000 ? `约 ${v / 1000} 千行` : `约 ${v} 行`;
}

// 路径在斜杠后面给折行点，窄格子里折在目录之间（同表页）。
export const pathCode = (p) => `<code>${esc(p).replace(/\//g, '/<wbr>')}</code>`;
export const k = (key, html) => ({ attrs: { 'data-k': key }, html });
export const row = (key, cells) => ({ attrs: { 'data-row': key }, cells });
export const section = (name, html) => `<section data-section="${esc(name)}">\n${html}\n</section>`;
export const none = (text = '没有') => `<p class="muted">${text}</p>`;
// 不成表的短清单（依赖它的模块、外部包）排成一句话：一项一个 <span data-row>，项与项之间用顿号。items：[{key, html}]。
export const inlineRows = (items) => `<p>${items.map((x) => `<span${attrs({ 'data-row': x.key })}>${x.html}</span>`).join('、')}</p>`;
// 为打印另备的那一份去掉 data-row / data-k，免得核对器把同一行数两遍、把同一格读成两处。属性值都转义过，里面不会有引号。
const unmark = (html) => html.replace(/ data-(?:row|k)="[^"]*"/g, '');

// 接口拼不出完整路径时标原因（契约 B 节「接口」、D 节接口总表）：runtime 是一路上有一段前缀算不准，unmounted 是路由器没找到挂在哪。
// 拼不出完整路径而原因不是这两个的（包括缺这一栏、记了 null），是取事实的错，直接报错，不替它猜一个。
export const WHY = { runtime: '前缀是运行时定的', unmounted: '没找到它挂在哪，前面可能还有一段前缀' };
export function routeWhy(r) {
  if (r.fullPath != null) return null;
  if (!Object.hasOwn(WHY, r.why ?? '')) throw new Error(`接口 ${r.method} ${r.path}（${r.file}）拼不出完整路径，原因却不是 runtime 或 unmounted：${r.why}`);
  return WHY[r.why];
}
// 链到模块页：标题是链接，id 单放一个等宽块（kOn 给了就带 data-k="module"，格子要比的就是这个 id）。prefix 是从别的目录链过来时的 ../arch/。
export const mRef = (v, id, { prefix = '', kOn = false, br = true } = {}) => {
  const m = v.byId.get(id);
  return `<a href="${prefix}${modFile(id)}">${esc(m ? m.title : id)}</a>${br ? '<br>' : ' '}<code${kOn ? ' data-k="module"' : ''}>${esc(id)}</code>`;
};

// 说明区（契约 C、D 节）：module:<id> 在模块页顶上，doc:arch 在架构首页。没写的写明 missing 并带「待写」；
// 过期的照第一期的办法原文照显、上面加横条；横条在第一期那句后面补半句为什么过期（契约 C 节：模块多了文件、接口、依赖才算），
// 读者知道该先对照哪几段。带 data-note / data-state，正文带 data-k="note"，核对器按它读回。
const STALE_WHY = { module: '写完之后这个模块的文件、接口或依赖变了，这段说明可能已经过期', doc: '写完之后模块、标题或层变了，这段导读可能已经过期' };
export function archNote(anchor, n, heading, missing) {
  const why = STALE_WHY[anchor.startsWith('doc:') ? 'doc' : 'module'];
  const body = !n ? `<p class="muted">${missing}</p>`
    : `${noteState(n) === 'stale' ? `<div class="notice" role="note"><p>${STALE_TEXT}（${why}）</p></div>\n` : ''}<div class="note" data-k="note">\n${noteHtml(n.text)}\n</div>`;
  return `<section${attrs({ 'data-note': anchor, 'data-state': noteState(n) })}>\n<h2>${heading} ${n ? noteMark(n) : TODO}</h2>\n${body}\n</section>`;
}

// 前 LIST_TOP 行列出，其余收进 <details>（不用脚本）；打印时合着的不出，另备一份只在打印时显示的，纸上不丢。
export function fold(head, rows, widths, unit = '条') {
  if (rows.length <= LIST_TOP) return table(head, rows, widths);
  const rest = rows.slice(LIST_TOP);
  return `${table(head, rows.slice(0, LIST_TOP), widths)}\n<details class="more"><summary>还有 ${rest.length} ${unit}</summary>\n${table(head, rest, widths)}\n</details>\n<div class="print-only">${unmark(table(head, rest, widths))}</div>`;
}
// 整段收起来：明细很长、首页上只要一个数的（循环依赖里几百对文件）。
export const folded = (summary, html) => `<details class="more"><summary>${summary}</summary>\n${html}\n</details>\n<div class="print-only">${unmark(html)}</div>`;
// 文件对：「甲 → 乙」一对一行。
export const pairList = (pairs) => `<ul class="pairs">${pairs.map(([a, b]) => `<li>${pathCode(a)} → ${pathCode(b)}</li>`).join('\n')}</ul>`;

// 隐去了几处、各在哪（D 节末段：架构首页顶上写明）：只写位置与哪一项，不写原文。
export function redactions(hits) {
  if (!hits.length) return '';
  const n = hits.reduce((s, h) => s + h.n, 0);
  const rows = hits.map((h) => [pathCode(h.where), esc(h.what), String(h.n)]);
  return `<div class="notice" role="note"><p>隐去了 ${n} 处：来源或说明里形如内网地址、带口令的地址或密钥的字样，这一份的页面上换成了「${REDACTED}」，原文只在来源里。</p>\n${fold(['在哪', '哪一项', '处数'], rows, ['40%', null, '64px'], '处')}</div>`;
}

export const LEGEND = `<h2>页面上的标记</h2>
<dl class="legend">
<dt>${origin('fact')}</dt><dd>从代码里机械取出来的：文件与行数、文件之间的引用、接口、读写的表（查的是代码里的 SQL）。模块之间的依赖、循环依赖这些是照引用关系算出来的。</dd>
<dt>${origin('comment')}</dt><dd>作者写在代码里的：文件头说明（文件开头那一段）与处理函数的说明，原文完整照录，不截断、不改写。</dd>
<dt>${origin('note')} ${TODO}</dt><dd>AI 写的解释，不是来源本身：模块管什么、整个系统怎么读。「说明 · 草稿」还没有人抽审过；「待写」是还没写。</dd>
<dt><span class="o o-stale">待更新</span></dt><dd>这段说明写于代码的旧版本（模块后来多了文件、接口或依赖），原文照显；取自来源的部分仍是现行的。</dd>
<dt>${judgedMark('proposed')} ${judgedMark('confirmed')} ${judgedMark('default')}</dt><dd>文件怎么归成模块、模块在哪一层，是项目判断（<code>docs/readable-src/map.json</code>），不是从代码里查出来的。「按目录分的」是还没有项目判断时，按每个代码根目录下的一级子目录机械分的。</dd>
<dt>${REDACTED}</dt><dd>来源或说明里形如内网地址、带口令的地址或密钥的字样，页面上换掉了，原文只在来源里；架构首页顶上列着各在哪里。</dd>
</dl>`;
