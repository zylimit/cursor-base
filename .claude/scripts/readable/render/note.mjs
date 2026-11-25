// note.mjs —— 说明（AI 写的解释）在页面上的样子（契约 docs/readable-spec/phase1-db-contract.md G 节「存放」「页面」）。
// 为什么有它：事实与解释要分开（规格「事实与解释分开」），过期的说明自动标出、不冒充现行（REQ-DOC-006）——
// 读者看到「待更新」要明白这段写于来源的旧版本，机械取出的部分仍是现行的，于是先看结构与代码位置（FLOW-1 的失败路径），
// 所以过期的说明照显、一个字不少，只是看着和现行的不一样。表页、组页、清单页顶上与字段表的「含义」一栏都用这一份。只出字符串。
// 说明 n 是文档模型 notes 里的一条 {text, status, by, on, state}；没有就是 undefined，按「说明：未写」出。
import { esc, attrs, origin } from './layout.mjs';

export const STALE_TEXT = '这段说明写于来源的旧版本，机械取出的部分仍是现行的';
const STATUS = new Set(['draft', 'reviewed']), STATE = new Set(['current', 'stale']);

// 状态对不上是模型的错（落盘命令只写这几个值），不悄悄当草稿出。
function check(n) {
  if (!STATUS.has(n.status) || !STATE.has(n.state)) throw new Error(`说明的状态不认识：status=${n.status} state=${n.state}`);
  return n;
}

// 读回标记（契约 C 节「机器读得回来」）：none / draft / reviewed / stale，过期压过草稿与已抽审。
export const noteState = (n) => (!n ? 'none' : check(n).state === 'stale' ? 'stale' : n.status);

// 正文（G 节「存放」）：空行分段；「- 」开头的连续几行是列表；反引号里的是等宽字；别的原样显示，段内换行照留；尖括号一律转义。
const inline = (s) => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>');
const blocks = (text) => String(text ?? '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/).map((b) => b.replace(/^\n+|\n+$/g, '')).filter((b) => b.trim());
function block(b) {
  const runs = [];
  for (const line of b.split('\n')) {
    const li = line.startsWith('- '), last = runs[runs.length - 1], s = li ? line.slice(2) : line;
    if (last && last.li === li) last.lines.push(s);
    else runs.push({ li, lines: [s] });
  }
  return runs.map((r) => (r.li ? `<ul>${r.lines.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>` : `<p>${r.lines.map(inline).join('<br>')}</p>`)).join('\n');
}
export const noteHtml = (text) => blocks(text).map(block).join('\n');
// 第一段：表说明的第一段是「一句话用途」，清单里拿它当这张表的那一行（G 节）；段内的几行并成一行。
export const firstPara = (text) => (blocks(text)[0] || '').split('\n').map(inline).join(' ');

export const staleMark = (n) => (noteState(n) === 'stale' ? ' <span class="o o-stale">待更新</span>' : '');
// 「说明 · 草稿」或「说明 · 已抽审（谁，哪天）」，过期的后面再标「待更新」。
export function noteMark(n) {
  const who = [n.by, n.on].filter(Boolean).join('，');
  const s = check(n).status === 'reviewed' ? `说明 · 已抽审${who ? `（${who}）` : ''}` : '说明 · 草稿';
  return `<span class="o o-note">${esc(s)}</span>${staleMark(n)}`;
}

// 说明区：表页、组页顶上（group:<组 id>）、清单页顶上（doc:db）。过期的在正文上面加一条横条，正文照显。
// 正文那一块带 data-k="note"，核对器按它读回（契约 C 节「机器读得回来」，不认样式类名）。
export function noteSection(anchor, n) {
  const body = !n ? '<p class="muted">说明：未写</p>'
    : `${noteState(n) === 'stale' ? `<div class="notice" role="note"><p>${STALE_TEXT}</p></div>\n` : ''}<div class="note" data-k="note">\n${noteHtml(n.text)}\n</div>`;
  return `<section${attrs({ 'data-note': anchor, 'data-state': noteState(n) })}>\n<h2>说明 ${n ? noteMark(n) : origin('note')}</h2>\n${body}\n</section>`;
}
