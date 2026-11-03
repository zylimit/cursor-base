#!/usr/bin/env node
// predev-lint.mjs — 前期五份文档的静态闸（把 product-spec-builder / design-brief-builder /
// design-maker / arch-designer / dfx-designer 的模板规则自动化）。
// 用法： node .claude/scripts/predev-lint.mjs [--root <目录>] [--json]   默认 root 为当前目录
// 五份按存在性检查，缺哪份跳过哪份（前期文档本就分批产出，缺席不是错）；五份都没有就整体跳过。
// 退出码：0 通过或跳过 / 1 有 error / 2 参数用法错。warning 只报不拦。
// 只依赖 node 内置模块、不 import .claude/harness——引擎坏了这道闸也要能跑，规则在这里重写一遍。

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// 文档模型：围栏感知的行扫描 + 二级段切分（围栏内不扫，行内反引号里不算）
// ---------------------------------------------------------------------------

const FENCE_RE = /^\s{0,3}(?:```|~~~)/;
const FENCE_INFO_RE = /^\s{0,3}(?:```|~~~)(.*)$/;
// 标了模板 / 代码语言的围栏是在演示写法，里面的 {{…}} 是语法不是没填的槽；其余（无标签 /
// markdown / yaml / css / text…）都是交付内容，槽照扫。
const TEMPLATE_LANGS = new Set(['html', 'vue', 'jinja', 'hbs', 'handlebars', 'mustache',
  'njk', 'liquid', 'js', 'ts', 'jsx', 'tsx', 'svelte', 'php']);

function loadDoc(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const fenced = [];
  const fenceLang = [];        // 该行所属围栏的信息串首词（小写），围栏外为 null
  const fenceOpen = [];        // 这一行是不是开栏那根线
  const unclosedFences = [];   // 到文末还开着的围栏，记开栏行号
  const sections = [];
  let inFence = false;
  let lang = null;
  let openLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fm = FENCE_INFO_RE.exec(l);
    if (fm) {
      if (!inFence) { lang = (fm[1].trim().split(/\s+/)[0] || '').toLowerCase(); openLine = i + 1; }
      fenced.push(true); fenceLang.push(lang); fenceOpen.push(!inFence);
      inFence = !inFence;
      if (!inFence) lang = null;
      continue;
    }
    fenced.push(inFence); fenceLang.push(inFence ? lang : null); fenceOpen.push(false);
    if (inFence) continue;
    const m = /^##\s+(.+?)\s*$/.exec(l);
    if (!m) continue;
    if (sections.length) sections[sections.length - 1].to = i;
    sections.push({ title: m[1].replace(/[*`#]/g, '').trim(), line: i + 1, from: i + 1, to: lines.length });
  }
  if (inFence) unclosedFences.push(openLine);
  return { text, lines, fenced, fenceLang, fenceOpen, unclosedFences, sections };
}

const NUM_PREFIX = /^\d+(?:\.\d+)*[.、．)）]?\s*/;
/** 段名比对前先归一化标题：去掉前导编号（2. / 2.1 / 1)）与结尾括注（（十三维））。 */
const normTitle = t => t.replace(NUM_PREFIX, '').replace(/[（(][^（()）]*[)）]$/, '').trim();
/** 判重名只去编号、留括注：括注是内容的一部分，一并去掉「Colors（浅色）」和「Colors（深色）」就成了同一段。 */
const sectionKey = t => t.replace(NUM_PREFIX, '').trim().toLowerCase();

// 先认归一化后相等的那一段，没有再退回包含匹配——不然「待定问题的填法说明」会把「待定问题」的锚点抢走。
const sectionNamed = (doc, label) =>
  doc.sections.find(s => normTitle(s.title) === label)
  || doc.sections.find(s => s.title.includes(label))
  || null;

/** 段内正文行（0 基下标），围栏内的跳过。 */
function* bodyLines(doc, section) {
  for (let i = section.from; i < section.to; i++) {
    if (doc.fenced[i]) continue;
    yield { i, raw: doc.lines[i] };
  }
}

/** `### 前缀` 起头的块，到下一个同级块或任一 `##` 为止。 */
function collectBlocks(doc, re) {
  const blocks = [];
  const open = () => (blocks.length && blocks[blocks.length - 1].to === doc.lines.length ? blocks[blocks.length - 1] : null);
  for (let i = 0; i < doc.lines.length; i++) {
    if (doc.fenced[i]) continue;
    const m = re.exec(doc.lines[i].trim());
    if (m) {
      const cur = open();
      if (cur) cur.to = i;
      blocks.push({ title: m[1].trim(), line: i + 1, from: i + 1, to: doc.lines.length });
    } else if (/^##\s+/.test(doc.lines[i])) {
      const cur = open();
      if (cur) cur.to = i;
    }
  }
  return blocks;
}

/** 行内反引号里的东西是举例，不是没写完。 */
const stripCode = line => String(line).replace(/`[^`]*`/g, '``');

/** markdown 表行的单元格（已 trim）；前面带反斜杠的竖线是格子里的字，不当分隔符。不是表行返回 null。 */
function cells(line) {
  const t = String(line).trim();
  if (!t.startsWith('|')) return null;
  const out = [];
  let cur = '';
  let closed = false;   // 末尾那根竖线是收尾，不是又一个空格子
  for (let i = 1; i < t.length; i++) {
    const ch = t[i];
    if (ch === '|' && t[i - 1] !== '\\') { out.push(cur.trim()); cur = ''; closed = true; continue; }
    cur += ch;
    closed = false;
  }
  if (!closed) out.push(cur.trim());
  return out;
}

// GFM 的分隔单元格是 :?-+:?，一个连字符也算：|:-:|、|:--|--:| 都是分隔行，认不出这一行整张表就跟着失灵。
const isSepCell = c => /^:?-+:?$/.test(c);
const isSepRow = line => { const c = cells(line); return !!c && c.length > 0 && c.every(isSepCell); };

const BULLET_RE = /^\s{0,1}(?:[-*+]|\d+[.)])\s+/;
const NUMBERED_RE = /^\s{0,3}\d+[.)]\s+/;

// ---------------------------------------------------------------------------
// 占位残留：尖括号模板残渣 + 没写完的标记
// ---------------------------------------------------------------------------

// 尖括号在文档里默认是模板残渣，除非它是真的标签，所以判据是标签白名单而不是猜内容。
const HTML_TAGS = new Set([
  'a', 'abbr', 'audio', 'b', 'blockquote', 'br', 'button', 'code', 'details', 'div', 'em',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'iframe', 'img', 'input', 'kbd',
  'label', 'li', 'main', 'nav', 'ol', 'option', 'p', 'path', 'pre', 'script', 'section',
  'select', 'small', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'svg', 'table',
  'tbody', 'td', 'textarea', 'th', 'thead', 'tr', 'ul', 'video',
]);

// 中文的两个从不是产品名，裸着出现就算标记；TBD/TODO 大写也可能是正题（待办应用），只认标记形状。
const BARE_TOKENS = ['待定', '待补'];
const MARK_TOKENS = ['TBD', 'TODO'];
// 填槽语法统一成 {{…}}：照模板抄下来的槽长得像正文，比空着更容易被当成已经定好的内容。
const SLOT_RE = /\{\{[^{}\n]*\}\}/g;
// 「待定」的去处随文档走：Spec 有「待定问题」表可搬，别的文档没有，只能当场定或明写押后。
const PENDING_TAIL = '定下来；真要押后就写「押后」并给回来定的条件';
const SPEC_PENDING_TAIL = '定下来、或者搬进「待定问题」表里给它一个主';

function angleResidue(line) {
  const out = [];
  const re = /<([^<>\n]{1,200})>/g;
  let m = re.exec(line);
  while (m) {
    const inner = m[1].trim();
    const head = inner.replace(/^\//, '').split(/[\s/>]/)[0].toLowerCase();
    // 「首屏 <1s」「数据量 <10 万行，单表 >」是阈值比较式：跨了格子（候选里有 |），
    // 或两侧都是阈值——跳过 < 后的空白首字符是数字 / = / -，且配对的 > 后跳过空白的首字符是
    // 数字 / = / - / $（$ 是货币符号，如「月账 >$X」）。只看左边，会把模板自带的
    // 「<2-3 个真实发生过的案例…>」当成比较式放过；「< 数据库选型 >」空着一格照报。
    const rest = line.slice(m.index + m[0].length).replace(/^\s+/, '');
    const compare = inner.includes('|') || (/^[\d=-]/.test(inner) && /^[\d=$-]/.test(rest));
    if (!compare && !HTML_TAGS.has(head)) out.push('<' + inner + '>');
    m = re.exec(line);
  }
  return out;
}

function markerShape(line, tok) {
  return new RegExp('<\\s*' + tok + '\\s*>').test(line)
    || new RegExp('\\b' + tok + '\\s*[:：]').test(line)
    || new RegExp('^\\s*(?:[-*+]|\\d+[.)])?\\s*' + tok + '\\s*[.。]?\\s*$').test(line);
}

/** 这一行的围栏扫不扫槽：看围栏的用途（信息串首词），模板 / 代码语言的不扫；开栏那根线自带的槽照算，
 *  收尾那根线不是内容。 */
function fenceScannable(doc, i) {
  if (!doc.fenceOpen[i] && FENCE_RE.test(doc.lines[i])) return false;
  return !TEMPLATE_LANGS.has(doc.fenceLang[i] || '');
}

/** 全文占位扫描；skip(i) 返回 true 整行不扫（是正题、或同一行已按更准的规则报过），返回 'pending' 只放过「待定」二字。
 *  opts.tail 是「待定」那条的去处。 */
function scanPlaceholders(doc, sink, skip, opts = {}) {
  const tail = opts.tail || PENDING_TAIL;
  for (let i = 0; i < doc.lines.length; i++) {
    // 无标签 / markdown / css / yaml 这类围栏是交付物本身，里面的槽照样是没填的槽；围栏里的尖括号 /
    // TBD / 待补 仍是在教人怎么写，照旧免检。收尾那根线不是内容。
    const fence = doc.fenced[i];
    if (fence && !fenceScannable(doc, i)) continue;
    const mode = skip ? skip(i) : false;
    if (mode === true) continue;
    // 围栏里没有「行内代码跨度」这回事：那一对反引号就是两个普通字符，夹着的槽照样是没填的槽；
    // 围栏外的反引号才是在教人怎么写，免检。
    const line = fence ? doc.lines[i] : stripCode(doc.lines[i]);
    for (const s of line.match(SLOT_RE) || []) {
      sink.err('PLACEHOLDER', i + 1, `没填的槽 ${s}——照模板抄来还没填的内容比空着更坏`);
    }
    if (fence) continue;
    for (const b of angleResidue(line)) {
      sink.err('PLACEHOLDER', i + 1, `尖括号占位 ${b} 一直没填——半截的需求比没有更坏`);
    }
    for (const t of BARE_TOKENS) {
      if (mode === 'pending' && t === '待定') continue;
      if (line.includes(t)) sink.err('PLACEHOLDER', i + 1, `正文里的「${t}」是没写完的标记——${tail}`);
    }
    for (const t of MARK_TOKENS) {
      if (markerShape(line, t)) sink.err('PLACEHOLDER', i + 1, `未完成标记「${t}」——定下来或删掉`);
    }
  }
}

// ---------------------------------------------------------------------------
// Product-Spec.md
// ---------------------------------------------------------------------------

const SPEC_SECTIONS = ['产品概述', '应用场景', '成功判据', '范围与非目标', '功能需求',
  '规则与例外', '关键流程', '决策依据', '技术方向', '待定问题', '澄清记录'];
const SOURCE_MARKS = ['[确认]', '[推断]', '[默认]'];
const PENDING_MARK = '[待定]';
const PENDING_SECTION = '待定问题';
const PENDING_ROW_CELLS = 5;

function lintSpec(doc, sink) {
  for (const label of SPEC_SECTIONS) {
    if (!sectionNamed(doc, label)) sink.err('MISSING_SECTION', 0, `缺必需段「${label}」——少这一段，这份文档当不了下游的事实来源`);
  }

  // 功能条目：来源标记决定下游遇到反例时是顶回来还是照做；[待定] 不许挂在条目上，未决只住表里。
  const req = sectionNamed(doc, '功能需求');
  const reported = new Set();
  if (req) {
    for (const { i, raw } of bodyLines(doc, req)) {
      if (!BULLET_RE.test(raw)) continue;
      // 标记本身常写在反引号里（模板就是这么写的），所以按原行判，不去反引号。
      if (!SOURCE_MARKS.some(m => raw.includes(m))) {
        sink.err('NO_SOURCE_MARK', i + 1, '功能条目没有来源标记（[确认] / [推断] / [默认]）——实现时无从判断这条能不能顶回去');
      }
      if (raw.includes(PENDING_MARK)) {
        reported.add(i);
        sink.err('PENDING_IN_REQUIREMENT', i + 1, '功能条目挂着 [待定]——改写成 [默认] 做法，未决的那条进「待定问题」表并写明谁能答');
      }
    }
  }

  // 待定问题表：五格齐才叫押后。缺人缺时限的一行只是记了句「以后再说」。
  const pending = sectionNamed(doc, PENDING_SECTION);
  if (pending) {
    for (const { i, raw } of bodyLines(doc, pending)) {
      const c = cells(stripCode(raw));
      if (!c) continue;
      const short = c.length !== PENDING_ROW_CELLS;
      const blank = c.some(x => !x);
      if (short || blank) {
        const how = short && blank ? `这行 ${c.length} 格、还有空格子` : short ? `这行 ${c.length} 格` : '这行有空格子';
        sink.err('PENDING_ROW_INCOMPLETE', i + 1,
          `待定问题表行要五格齐（问题 / 影响什么 / 谁能答 / 押后到 / 不答先按什么做），${how}——没人认领的问题押不住`);
      }
    }
  }

  // 成功判据只有表头，等于没有「做完了」的定义。
  const crit = sectionNamed(doc, '成功判据');
  if (crit) {
    const body = [...bodyLines(doc, crit)].filter(({ raw }) => raw.trim() && !/^#{1,6}\s/.test(raw));
    const sep = body.findIndex(({ raw }) => isSepRow(raw));
    const rows = sep >= 0 ? body.slice(sep + 1) : body;
    if (!rows.length) sink.err('NO_SUCCESS_CRITERIA', crit.line, '成功判据只有表头没有数据行——没有判据就没有验收');
  }

  // 待定问题段里只有段标题是正题；表行连同其余行照常扫尖括号 / TBD / TODO / 待补，只放过「待定」二字
  // （表行的格数另有五格齐那条规则管）——整行免检等于给未填内容开了条后门。
  const inPending = i => !!pending && i >= pending.from - 1 && i < pending.to;
  scanPlaceholders(doc, sink, i => {
    if (reported.has(i)) return true;
    if (!inPending(i)) return false;
    return i === pending.from - 1 ? true : 'pending';
  }, { tail: SPEC_PENDING_TAIL });
}

// ---------------------------------------------------------------------------
// Design-Brief.md
// ---------------------------------------------------------------------------

const SCREEN_PARTS = ['**必需状态**', '**响应式**'];

function lintBrief(doc, sink, ctx) {
  const ia = sectionNamed(doc, '信息架构');
  const scope = ia ? [...bodyLines(doc, ia)].map(x => x.raw).join('\n') : doc.text;
  if (!/SCREEN-\d+/.test(scope)) {
    sink.err('NO_SCREEN', ia ? ia.line : 0, '信息架构里一个 SCREEN-n 都没有——页面没编号，Brief、Spec、设计稿三头对不上号');
  }

  for (const b of collectBlocks(doc, /^###\s+(SCREEN-\d+.*)$/)) {
    const body = doc.lines.slice(b.from, b.to).join('\n');
    const missing = SCREEN_PARTS.filter(k => !body.includes(k));
    if (missing.length) sink.err('SCREEN_INCOMPLETE', b.line, `${b.title} 缺 ${missing.join(' 与 ')}——状态与断点没写，实现只能靠猜`);
  }

  // Brief 引 Spec 的编号：对不上只是提醒（Spec 可能还没写到），不阻断。
  if (ctx.spec) {
    const declared = new Set(ctx.spec.text.match(/\b(?:FLOW|SCOPE)-\d+/g) || []);
    const seen = new Set();
    for (let i = 0; i < doc.lines.length; i++) {
      if (doc.fenced[i]) continue;
      for (const ref of doc.lines[i].match(/\b(?:FLOW|SCOPE)-\d+/g) || []) {
        if (declared.has(ref) || seen.has(ref)) continue;
        seen.add(ref);
        sink.warn('DANGLING_REF', i + 1, `引用了 Product-Spec 里没有的 ${ref}——编号悬空，Spec 改了这一处不会跟着动`);
      }
    }
  }
  scanPlaceholders(doc, sink);
}

// ---------------------------------------------------------------------------
// DESIGN.md（前言用最简 YAML 子集自己解析：两三级缩进的键值，值可带引号）
// ---------------------------------------------------------------------------

// 八段名按整词认，不按前缀：「Downloads」不是 Do's and Don'ts，前缀匹配会把它当成末段，后面正经的段全成了乱序。
const DESIGN_ORDER = [/^overview\b/, /^colors\b/, /^typography\b/, /^layout\b/, /^elevation\b/,
  /^shapes\b/, /^components\b/, /^do'?s?\s*(?:and|&|\/)?\s*don/];
const DESIGN_ORDER_TEXT = "Overview → Colors → Typography → Layout → Elevation → Shapes → Components → Do's and Don'ts";
const DESIGN_TOKENS = ['colors.primary', 'colors.surface'];

function parseYamlBlock(lines) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const raw of lines) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const m = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const val = m[3].trim();
    if (val === '') {
      const child = {};
      parent[m[2]] = child;
      stack.push({ indent, node: child });
    } else {
      parent[m[2]] = val.replace(/^["']/, '').replace(/["']$/, '');
    }
  }
  return root;
}

function frontMatter(doc) {
  if (!doc.lines.length || doc.lines[0].trim() !== '---') return null;
  const end = doc.lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return null;
  return parseYamlBlock(doc.lines.slice(1, end));
}

/** 前言里取一个点分路径的节点；只有路径不存在才返回 undefined——值是复合结构（{typography.body}）也算解析得到。 */
function lookup(node, dotted) {
  let cur = node;
  for (const key of dotted.split('.')) {
    if (!cur || typeof cur !== 'object' || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function lintDesign(doc, sink) {
  const fm = frontMatter(doc);
  if (!fm) {
    sink.err('NO_FRONTMATTER', 1, 'DESIGN.md 没有 YAML 前言——{colors.primary} 这类记号无处可解，设计稿与代码只能各写各的');
  } else {
    for (const t of DESIGN_TOKENS) {
      if (typeof lookup(fm, t) !== 'string') sink.err('MISSING_TOKEN', 1, `前言缺 ${t}——正文引用它时解析不到`);
    }
    // 同一个写错的记号常复制到好几处，一处一条只是噪音：按记号名去重，报第一处并带上还有几处。
    // 反引号里的记号是正文在教写法，不是引用，扫之前先去掉。
    const bad = new Map();
    for (let i = 0; i < doc.lines.length; i++) {
      if (doc.fenced[i]) continue;
      // 槽的内层花括号不是记号：`{{px}}` 已经按「没填的槽」报过，再报一条 {px} 解析不到是同一处毛病数两遍。
      for (const m of stripCode(doc.lines[i]).replace(SLOT_RE, '').matchAll(/\{([A-Za-z][A-Za-z0-9_.-]*)\}/g)) {
        if (lookup(fm, m[1]) !== undefined) continue;
        const hit = bad.get(m[1]);
        if (hit) hit.more += 1;
        else bad.set(m[1], { line: i + 1, more: 0 });
      }
    }
    for (const [name, { line, more }] of bad) {
      sink.err('UNRESOLVED_TOKEN', line,
        `{${name}} 在前言里解析不到——记号写错了，或前言漏了这一项${more ? `（另 ${more} 处）` : ''}`);
    }
  }

  // 段名带编号（## 2. Colors）也是同一段：顺序与重名都在去掉编号之后比，括注留着不算同名。
  const seen = new Map();
  let last = -1;
  for (const s of doc.sections) {
    const key = sectionKey(s.title);
    if (seen.has(key)) sink.err('DUPLICATE_SECTION', s.line, `重复的段标题「${s.title}」（第 ${seen.get(key)} 行已有一段）——同名两段，读的人不知道以谁为准`);
    else seen.set(key, s.line);
    const idx = DESIGN_ORDER.findIndex(re => re.test(key));
    if (idx < 0) continue;   // 不在八段里的自定义段（Downloads / 附录）不参与段序
    if (idx < last) sink.err('SECTION_ORDER', s.line, `「${s.title}」排在了规范顺序之外（应为 ${DESIGN_ORDER_TEXT}）`);
    else last = idx;
  }
  scanPlaceholders(doc, sink);
}

// ---------------------------------------------------------------------------
// Architecture-Design.md / DFX-Spec.md
// ---------------------------------------------------------------------------

const ARCH_SECTIONS = ['架构概览', '模块划分', '依赖规则', '运行与部署包络', '关键决策记录'];
// 模板的 MADR 写法是「**背景与问题**」「**被拒备选与理由**」，这两条按前缀认；「**决策**」只认精确，
// 不然一个只写了「**决策驱动**」的块会冒充做过决策。
const ADR_PARTS = [
  { needle: '**背景', name: '**背景**' },
  { needle: '**决策**', name: '**决策**' },
  { needle: '**被拒备选', name: '**被拒备选**' },
  { needle: '**执法方式**', name: '**执法方式**' },
];

function lintArch(doc, sink) {
  for (const label of ARCH_SECTIONS) {
    if (!sectionNamed(doc, label)) sink.err('MISSING_SECTION', 0, `缺必需段「${label}」——少这一段，边界与部署只能各人凭印象猜`);
  }

  for (const b of collectBlocks(doc, /^###\s+(ADR-\S+.*)$/)) {
    const body = doc.lines.slice(b.from, b.to).join('\n');
    const missing = ADR_PARTS.filter(p => !body.includes(p.needle)).map(p => p.name);
    if (missing.length) sink.err('ADR_INCOMPLETE', b.line, `${b.title} 缺 ${missing.join(' / ')}——不落地的决策等于没决策`);
  }
  scanPlaceholders(doc, sink);
}

// 延迟与重试预算表：超时不自上而下分解，每层都觉得自己不慢、端到端却是各层之和；重试不指定层，
// 就在链路上逐层相乘，5 层各 3 次是 243 次。表按档位选填，认表头不认段号——没有这张表就不查。
const BUDGET_END = '端到端';

/** 「120」「120ms」「≤120」「1.2s」都读得出毫秒数；读不出返回 null，由调用方点名这一行，不当 0 混进求和。 */
function parseMs(cell) {
  const m = /^[≤＜<≈约~]*\s*(\d+(?:\.\d+)?)\s*(ms|毫秒|s|秒)?$/.exec(String(cell == null ? '' : cell).trim().replace(/[,，]/g, ''));
  if (!m) return null;
  // 列头写的是 ms，一个「5s」被读成 5 就是差一千倍的假通过——单位写秒的乘回去。
  return Math.round(Number(m[1]) * (m[2] === 's' || m[2] === '秒' ? 1000 : 1));
}

// 明确的零：留白、0、破折号、N/A、「无」「不重试」——这些是写的人表过态了。
const RETRY_ZERO = /^(?:0\s*次?|—|–|-|n\s*\/\s*a|无|不重试|不做重试)$/i;

/** 重试次数三态：读出数字 / 明确的零 / 读不出（返回 null，由调用方点名，绝不当 0）。
 *  带括注是正常写法（`3（指数退避）`、`最多 3 次`、`3x`），先认数字再放过尾注，不逼人删注释；
 *  真读不出的必须出声——把解析失败当成「没有重试」，就是拿一个不可达的输入把缺陷盖成预期，比不检查更坏。 */
function parseRetry(cell) {
  const t = String(cell == null ? '' : cell).trim();
  if (!t || RETRY_ZERO.test(t)) return 0;
  const m = /^(?:最多|至多|重试|retry|[≤＜<])?\s*(\d+)\s*(?:次|x|times?)?(?:\s*[（(].*[)）])?$/i.exec(t);
  return m ? Number(m[1]) : null;
}

/** 按表头认这张表（同时有「预算」列与「重试」列），返回表头行号、列位与数据行。 */
function findBudgetTable(doc) {
  for (let i = 0; i < doc.lines.length; i++) {
    if (doc.fenced[i]) continue;
    const head = cells(stripCode(doc.lines[i]));
    if (!head || head.every(isSepCell)) continue;
    const budget = head.findIndex(h => h.includes('预算'));
    const retry = head.findIndex(h => h.includes('重试'));
    if (budget < 0 || retry < 0) continue;
    if (i + 1 >= doc.lines.length || !isSepRow(doc.lines[i + 1])) continue;
    const fallback = head.findIndex(h => /fallback/i.test(h) || h.includes('兜底') || h.includes('失败时'));
    const rows = [];
    for (let k = i + 2; k < doc.lines.length && !doc.fenced[k]; k++) {
      const c = cells(stripCode(doc.lines[k]));
      if (!c) break;
      if (!c.every(isSepCell)) rows.push({ line: k + 1, c });
    }
    return { line: i + 1, budget, retry, fallback, rows };
  }
  return null;
}

const NO_RETRY_NOTE = /不重试|不做重试|不自动重试|零重试|无重试/;

/** 零重试是正当设计（人工重提交 + 幂等键往往比自动重试安全），闸只挡重试放大，不逼人编造一层重试；
 *  但「想过了不重试」与「忘了填」在表里长得一样，所以看端到端行和表下紧跟的那段注解里有没有明写这个决定。
 *  理由充不充分机器判不了，只判有没有写。 */
function hasNoRetryNote(doc, t) {
  const parts = [];
  for (const { c } of t.rows) if ((c[0] || '').includes(BUDGET_END)) parts.push(c.join(' '));
  let seen = false;
  for (let i = t.rows.length ? t.rows[t.rows.length - 1].line : t.line + 1; i < doc.lines.length; i++) {
    const l = doc.lines[i];
    if (/^#{1,6}\s+/.test(l)) break;
    if (!l.trim()) { if (seen) break; continue; }
    if (doc.fenced[i] || cells(l)) break;   // 又一张表或围栏，表下的注解到此为止
    seen = true;
    parts.push(l);
  }
  return NO_RETRY_NOTE.test(parts.join('\n'));
}

function lintBudgetTable(doc, sink) {
  const t = findBudgetTable(doc);
  if (!t) return;   // 这张表按档位选填，没写就没写，不在这里逼

  let sum = 0;
  let end = null;
  let endLine = t.line;
  let unreadableRetry = 0;
  const retrying = [];
  for (const { line, c } of t.rows) {
    const name = c[0] || '这一行';
    const isEnd = name.includes(BUDGET_END);
    const ms = parseMs(c[t.budget]);
    if (ms === null) {
      sink.warn('BUDGET_UNREADABLE', line, `「${name}」的预算「${c[t.budget] || ''}」读不出毫秒数，这一行不参与求和——写成 120 / 120ms / ≤120 都认`);
    } else if (isEnd) {
      if (end === null) { end = ms; endLine = line; }
    } else sum += ms;

    const n = parseRetry(c[t.retry]);
    if (n === null) {
      unreadableRetry += 1;
      sink.warn('RETRY_UNREADABLE', line, `「${name}」的重试次数「${c[t.retry] || ''}」读不出数字，这一行没算进重试层数——写 0 / 1 / 3 次 / 3（指数退避）都认；读不出还当它没重试，正是假绿的来路`);
    } else if (!isEnd && n) retrying.push(`${name} ${n} 次`);

    if (t.fallback >= 0 && !(c[t.fallback] || '').trim()) {
      sink.warn('BUDGET_NO_FALLBACK', line, `「${name}」没写失败时的 fallback——超时之后干什么，不写就是出事当天现编`);
    }
  }

  if (end === null) {
    sink.warn('BUDGET_NO_END_TO_END', t.line, '预算表没有「端到端」行，各层之和没有对照物——末行补一行端到端预算，这条算术才校得动');
  } else if (sum > end) {
    sink.err('BUDGET_OVER_END_TO_END', endLine,
      `各层预算之和 ${sum}ms 超过端到端 ${end}ms（多 ${sum - end}ms）——分不下去的预算，上线后就是每层都说自己不慢、端到端照样超`);
  }

  if (retrying.length > 1) {
    sink.err('RETRY_LAYERS_OVER_ONE', t.line,
      `${retrying.length} 层都在重试（${retrying.join('、')}）——重试逐层相乘，5 层各 3 次就是 243 次；不许两层以上，最多留一层、其余写 0`);
  } else if (!retrying.length && !unreadableRetry && !hasNoRetryNote(doc, t)) {
    sink.warn('RETRY_NONE_UNEXPLAINED', t.line,
      '一层都没写重试，也没说为什么——不重试本身是正当选择，但要在端到端行或表下写明这个决定，别让下游把它当成漏填');
  }
}

function lintDfx(doc, sink) {
  const stack = sectionNamed(doc, '优先级栈');
  if (stack) {
    const items = [...bodyLines(doc, stack)].filter(({ raw }) => NUMBERED_RE.test(raw));
    if (items.length < 2) {
      sink.err('PRIORITY_STACK_TOO_SHORT', stack.line, `优先级栈只有 ${items.length} 项——没有排序就没有取舍，冲突时不知道先保谁`);
    }
  }

  const table = sectionNamed(doc, '维度总表');
  if (table) {
    const rows = [...bodyLines(doc, table)].map(({ i, raw }) => ({ i, c: cells(stripCode(raw)) })).filter(x => x.c);
    // 段里常不止一张表（总表后面跟一张两列小注表），按「表头行 + 紧跟的分隔行」逐张认，
    // 每张表只用自己表头上的度量列：总表表头没写「度量」才退回最后一列，后面的注表没写就不是维度表。
    let at = -1;
    let judging = false;
    let tables = 0;
    for (let k = 0; k < rows.length; k++) {
      const { i, c } = rows[k];
      if (c.every(isSepCell)) continue;
      const next = rows[k + 1];
      if (next && next.c.every(isSepCell)) {
        tables += 1;
        const named = c.findIndex(h => h.includes('度量'));
        at = named >= 0 ? named : (tables === 1 ? c.length - 1 : -1);
        judging = at >= 0;
        continue;
      }
      if (!judging || c.length <= at) continue;   // 注表、或比度量列还短的行，都不是维度行
      const metric = c[at] || '';
      if (!/\d/.test(metric) && !/n\s*\/\s*a/i.test(metric) && !metric.includes('不适用')) {
        sink.err('UNMEASURED', i + 1, `「${c[0] || '这一行'}」的度量「${metric}」不含数字、也不是 N/A——验收时说不清达没达到`);
      }
    }
  }

  lintBudgetTable(doc, sink);
  scanPlaceholders(doc, sink);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

const DOCS = [
  ['Product-Spec.md', lintSpec],
  ['Design-Brief.md', lintBrief],
  ['DESIGN.md', lintDesign],
  ['Architecture-Design.md', lintArch],
  ['DFX-Spec.md', lintDfx],
];

const USAGE = '用法： node .claude/scripts/predev-lint.mjs [--root <目录>] [--json]';

function parseArgs(argv) {
  const opts = { root: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--root') {
      if (i + 1 >= argv.length) return { error: '--root 后面要跟目录' };
      opts.root = argv[++i];
    } else if (a.startsWith('--root=')) opts.root = a.slice('--root='.length);
    else return { error: '未知参数：' + a };
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error('predev-lint: ' + opts.error);
    console.error(USAGE);
    process.exit(2);
  }

  const root = path.resolve(opts.root);
  const findings = [];
  const checked = [];
  const skipped = [];
  const loaded = new Map();
  for (const [name] of DOCS) {
    const file = path.join(root, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) loaded.set(name, loadDoc(file));
    else skipped.push(name);
  }

  const ctx = { spec: loaded.get('Product-Spec.md') || null };
  for (const [name, lint] of DOCS) {
    const doc = loaded.get(name);
    if (!doc) continue;
    checked.push(name);
    const sink = {
      err: (code, line, message) => findings.push({ severity: 'error', code, file: name, line, message }),
      warn: (code, line, message) => findings.push({ severity: 'warning', code, file: name, line, message }),
    };
    for (const line of doc.unclosedFences) {
      sink.err('UNCLOSED_FENCE', line, '第 ' + line + ' 行的围栏没有闭合——其后整段都会被当代码跳过检查，先补上收尾的 ```');
    }
    lint(doc, sink, ctx);
  }

  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');
  const ok = errors.length === 0;

  if (opts.json) {
    console.log(JSON.stringify({ ok, root, checked, skipped, errors: errors.length, warnings: warnings.length, findings }, null, 2));
  } else if (!checked.length) {
    console.log('predev-lint: 五份前期文档一份都没有，跳过。');
  } else {
    if (skipped.length) console.log('predev-lint: 跳过（文件不存在）：' + skipped.join('、'));
    for (const f of findings) {
      console.log(`  ${f.severity === 'error' ? '✗' : '!'} ${f.file}:${f.line} [${f.code}] ${f.message}`);
    }
    console.log(ok
      ? `predev-lint: 通过（检查 ${checked.length} 份，warning ${warnings.length}）`
      : `predev-lint: 未通过（error ${errors.length}，warning ${warnings.length}）`);
  }
  process.exit(ok ? 0 : 1);
}

main();
