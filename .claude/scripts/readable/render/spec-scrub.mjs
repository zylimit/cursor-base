// spec-scrub.mjs —— 需求规格页面上不带出去的东西（契约 docs/readable-spec/phase2-spec-contract.md C 节「不带出去的东西」）。
// 隐去的规则只有一份，在 ../sensitive.mjs，与第一期同一份；这里只管哪些字过它、换掉的记在来源的第几行、换掉了多少个字，给 spec/index.html 顶上列出来。
// 过的：每块的文字（表格行按格）、围栏起始行后面的字（info）、锚点（锚点里有章节路径，标题里的字会带进 data-anchor）、来源文件名。
// 出一份换过的副本给各页用，传进来的模型不动——核对器要拿同一份模型在内存里重出一遍来比。
// 落盘前的兜底（check.mjs 的 leaks）照旧扫每一页：这里漏了哪一处，那里拦下并点名那一页。
import { redact, REDACTED } from '../sensitive.mjs';

// 换掉了多少个字（按码点）：每一处都是把一段原文换成一个「〔已隐去〕」、别的字原样留着，
// 所以换掉的字数 = 原文的字数 − 换后的字数 + 处数 × 「〔已隐去〕」的字数。规则的返回值只有文字与处数，不为数字数另开口子。
const cps = (s) => Array.from(s).length;
const MARK_LEN = cps(REDACTED);
function scrub(s) {
  const r = redact(s);
  return { text: r.text, hits: r.hits, chars: r.hits ? cps(s) - cps(r.text) + r.hits * MARK_LEN : 0 };
}

// 一块里换了几处、各在哪一行：按行各过一遍，加起来与整块过一遍的处数相同就按行记；
// 不同（一处口令的写法跨了行）就整块记在起始行，处数与字数以整块为准。围栏的文字从起始行的下一行开始。
function perLine(b, whole, add) {
  const first = b.kind === 'fence' ? b.line + 1 : b.line, per = b.text.split('\n').map(scrub);
  if (per.reduce((s, r) => s + r.hits, 0) === whole.hits) per.forEach((r, k) => add(first + k, r));
  else add(b.line, whole);
}

export function scrubSpec(spec) {
  const hits = [];
  const blocks = spec.blocks.map((b) => {
    const add = (line, r) => { if (r.hits) hits.push({ line, n: r.hits, chars: r.chars, block: b.n }); };
    const anchor = redact(b.anchor).text;
    if (b.kind === 'table') {
      const cells = b.cells.map(scrub);
      add(b.line, { hits: cells.reduce((s, c) => s + c.hits, 0), chars: cells.reduce((s, c) => s + c.chars, 0) });
      const shown = cells.map((c) => c.text);
      return { ...b, anchor, cells: shown, text: shown.join(' | ') };
    }
    const out = { ...b, anchor };
    if (b.info) { const i = scrub(b.info); add(b.line, i); out.info = i.text; }
    const r = scrub(b.text);
    if (r.hits) perLine(b, r, add);
    out.text = r.text;
    return out;
  });
  return { ...spec, file: redact(spec.file).text, blocks, hits };
}
