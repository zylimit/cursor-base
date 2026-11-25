// check-arch-rows.mjs —— 架构那一项核对的比法：一段一段地把页面读回的行与事实算出来的行比（第三期契约 docs/readable-spec/phase3-arch-contract.md E 节）。
// 为什么单放：比法只有一份，模块页、架构首页、接口总表各段都照它比，不许哪一段各写各的、松紧不一。
// 一段（data-section）恰有一处——表里列了的段不见了、重了都报；段里的行按 data-row 配，同一个键几行的按个数比（多重集），
// 少了、多了各报；配上的行逐格比表里列的格子（data-k），要求有的没有、不该有的有、显示的字不同都报；行里出现了表里没列的 data-k 也报——
// 出页面的代码新加一格而核对没跟上，在这里露出来。不借出页面的任何东西（架构稿 §3 禁边）。
import { cmp } from './model.mjs';
import { redact } from './sensitive.mjs';
import { squash, sectionRows } from './check-read.mjs';

// 页面上显示的是隐去后的字（D 节末段）：键（data-row 的值）照原样比，格子里的字空白归一后比。
export const key = (s) => redact(String(s)).text;
export const shown = (s) => squash(redact(String(s)).text);
// 只挑有值的格子：没有文件头说明、没有处理函数说明、拼得出完整路径的，那一格不该带 data-k。
export const opt = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const FIELD = {
  key: '显示的字', size: '规模', entry: '入口', head: '文件头说明', headAt: '文件头说明取自哪一处', method: '方法', path: '路径', handler: '处理函数', file: '所在文件',
  doc: '处理函数的说明', why: '拼不出完整路径的原因', module: '模块', names: '用到的名字', name: '名字', by: '被哪几个模块用', rw: '读写',
  files: '文件数', lines: '约多少行', routes: '接口数', reads: '读几张表', writes: '写几张表', uses: '依赖几个模块', usedBy: '被几个模块依赖', pairs: '文件对数',
  text: '原文', count: '个数', detail: '怎么对不上', chapters: '几章', blocks: '几块',
};
const NO_CELL = '（没有这一格）';
const clip = (list) => `${list.slice(0, 5).map((x) => `「${x}」`).join('、')}${list.length > 5 ? ` 等 ${list.length} 条` : ''}`;
const group = (xs) => { const m = new Map(); for (const x of xs) (m.get(x.key) ?? m.set(x.key, []).get(x.key)).push(x); return m; };
// 两段字哪里不同：短的整段给出；长的（文件头说明、处理函数的说明）从第一个不同的字起各取一小截，不把几百字打进日志。
export function differ(got, want) {
  if (got.length <= 60 && want.length <= 60) return `页面上是「${got}」，来源是「${want}」`;
  const a = Array.from(got), b = Array.from(want);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const cut = (s) => `${i > 12 ? '…' : ''}${s.slice(Math.max(0, i - 12), i + 24).join('')}${s.length > i + 24 ? '…' : ''}`;
  return `第 ${i + 1} 个字起不同，页面上「${cut(a)}」，来源「${cut(b)}」`;
}

// 一段里的行与事实比（见文件头）。got：sectionRows 读回的行；want：[{key, k}]，k 只放该有的格子。
function compare(got, want, fields, what, add) {
  const g = group(got), w = group(want), tup = (x) => fields.map((f) => x.k[f] ?? NO_CELL), byTup = (a, b) => cmp(a.join('\u0001'), b.join('\u0001'));
  const missing = [], extra = [];
  for (const [k, list] of w) {
    const have = g.get(k) || [];
    for (let i = have.length; i < list.length; i++) missing.push(k);
    const ws = list.map(tup).sort(byTup), gs = have.map(tup).sort(byTup);
    for (let i = 0; i < Math.min(ws.length, gs.length); i++) {
      const diff = fields.map((f, j) => (gs[i][j] === ws[i][j] ? null : `${FIELD[f] ?? f}：${differ(gs[i][j], ws[i][j])}`)).filter(Boolean);
      if (diff.length) add(`${what}「${k}」的${diff.join('；')}`);
    }
  }
  for (const [k, list] of g) for (let i = w.get(k)?.length ?? 0; i < list.length; i++) extra.push(k);
  if (missing.length) add(`${what}少了 ${missing.length} 条：${clip(missing)}`);
  if (extra.length) add(`${what}多了 ${extra.length} 条，来源里没有：${clip(extra)}`);
}

// 一段：name 是 data-section 的值，what 是给人看的段名，fields 是表里给这一段列的格子；expect 是页面上应有几处（越层引用没有层时是 0）。
export function section(tree, name, what, fields, want, add, expect = 1) {
  const s = sectionRows(tree, name);
  if (!expect) { if (s.sections) add(`「${what}」这一段（data-section="${name}"）不该出现：${name === 'upward' ? '项目判断里没有层' : '这一页没有这一段'}`); return; }
  if (s.sections !== expect) add(`「${what}」这一段（data-section="${name}"）${s.sections ? `出现了 ${s.sections} 处` : '不见了'}`);
  if (!s.sections) return;
  const odd = new Set(s.rows.flatMap((r) => Object.keys(r.k).filter((f) => !fields.includes(f)).map((f) => `data-k="${f}"`)));
  if (odd.size) add(`「${what}」这一段的行里有表里没列的格子：${[...odd].sort(cmp).join('、')}`);
  compare(s.rows, want, fields, what, add);
}
