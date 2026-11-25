// check.mjs —— 核对：逐项比对文档与来源，出一份不一致清单（契约 docs/readable-spec/phase1-db-contract.md H 节；规格 REQ-DOC-007）。
// 为什么有它：接手的人没有 AI 编程工具、拿文档当真，字段类型写错一个，他们会照着错的去写代码；清单为空才算同步
// （FLOW-2：AI 改了来源、重出、重写过期的说明之后，核对报不一致 0 条，这次改动才算完）。四项：
//   1 页面是不是现行的：入口用出页面的函数在内存里重出一遍交进来，这里与 docs/readable/ 逐文件逐字节比；
//   2 页面上显示的与事实一致：不信出页面的代码，用 check-read.mjs 自带的读取器把磁盘上的页面读回来，与重新取的事实比——
//     出页面的代码吞了字、串了行，第 1 项两边错得一样看不出来，靠这一项（数据库设计那一半在 check-db.mjs）；
//   3 说明：指纹对不上的、锚点已经不存在的；4 指向不存在的东西：map.json 里对不上的、站内链接的目标文件不在的。
// 配了需求规格的再多一项（第二期契约 D 节，check-spec.mjs 的 specFacts）：重新切的块与 spec/ 下各页读回的 data-block 一块不少、一字不差。
// 架构稿 §3 禁边：这里不 import render/ 下的任何东西；第 1 项要的重出结果由入口交进来（与 build 落盘用的是同一个出页面的函数）。
// build 落盘前对临时目录跑第 2 项，再把每一页的文字过一遍隐去规则（selfCheck），不过就抛 CheckFailed，
// publish 删掉临时目录、原有页面不动，入口报退出码 3。
// 测试注入点：READABLE_FAIL_AT=selfcheck 时，自检拿到的事实里第一张表多一个列，模拟「出页面的代码少出了一个列」；
// READABLE_FAIL_AT=leak 在出页面那一侧（render/db-scrub.mjs），模拟某个上页面的字段忘了过隐去，由这里的兜底拦下；
// READABLE_FAIL_AT=spec-render 也在出页面那一侧（render/spec.mjs），由这里跑的需求规格那一项（check-spec.mjs）拦下；
// arch-render、arch-show-key、arch-show-head、arch-drop-section 在 render/arch-module.mjs 与 render/arch.mjs，由架构那一项拦下。
// 有模块的再多一项（第三期契约 E 节，check-arch.mjs）：架构这一份各页与表页上的模块标记读回来与事实比，项目判断里对不上的各算一条。
// 有模块又配了现有的架构文档（archDocs）的，每一份照需求规格那一项比（check-spec.mjs 的 archDocsFacts），build 落盘前的自检也跑。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cmp } from './model.mjs';
import { redact } from './sensitive.mjs';
import { segments, reader, danglingLinks } from './check-read.mjs';
import { pageFacts, noteRegions } from './check-db.mjs';
import { specFacts, archDocsFacts } from './check-spec.mjs';
import { archFacts, archProblems, archSummary, archLine } from './check-arch.mjs';

export class CheckFailed extends Error {
  constructor(problems) {
    super(`build 落盘前的自检不过（核对第 2 项「页面上显示的与事实一致」，以及隐去的兜底），新页面没有换上，原有页面一个字节没动：\n${lines(problems).join('\n')}`);
    this.problems = problems;
  }
}

function firstDiffLine(got, want) {
  const a = got.split('\n'), b = want.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `第 ${i + 1} 行起`;
}

// 目录读取（reader）与第 4 项的站内链接（danglingLinks）在 check-read.mjs。
// 第 1 项：重出的与磁盘上的逐文件逐字节比。
function pagesCurrent(rd, rendered, label) {
  const out = [], want = new Map(rendered.map((f) => [f.path, f.html])), disk = new Set(rd.files);
  for (const rel of [...want.keys()].sort(cmp)) {
    if (!disk.has(rel)) { out.push({ kind: 'missing-page', where: label + rel, detail: '重出有这一页，磁盘上没有（改了来源或配置之后没重出，或者这一页被删了）' }); continue; }
    const got = readFileSync(join(rd.dir, rel)), html = want.get(rel);
    if (!got.equals(Buffer.from(html))) out.push({ kind: 'stale-page', where: label + rel, detail: `与重出的不同（${firstDiffLine(got.toString('utf8'), html)}）：来源、配置、项目判断或说明改了没重出，或者有人手改了这一页` });
  }
  for (const rel of rd.files) if (!want.has(rel)) out.push({ kind: 'extra-page', where: label + rel, detail: '磁盘上有这一页，重出没有它（表删了或改名了没重出，或者是别处放进来的）' });
  return out;
}

// 第 2 项的数据库设计那一半（表页、组页、清单页）在 check-db.mjs 的 pageFacts，说明区的读回 noteRegions 也在那里。

// 同一处同一类只留一条：第 1、2 项都会点到缺的页与多的页，留第 1 项的说法。
function dedupe(list) {
  const seen = new Set();
  return list.filter((p) => {
    const k = ['missing-page', 'extra-page'].includes(p.kind) ? `${p.kind}\0${p.where}` : `${p.kind}\0${p.where}\0${p.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 外键列：列上的 REFERENCES，或表级 FOREIGN KEY 里点到它（契约 G 节：外键列的含义由引用关系给出，不算缺含义）。
const isFk = (t, c) => !!c.references || t.constraints.some((k) => k.type === 'foreign key' && (k.columns || []).includes(c.name));

function summarize(facts, rd, rendered, problems, specRead, docsRead) {
  const notes = facts.notes || {}, byKind = {};
  for (const p of problems) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  // 需求规格这一项只在配了 spec 时报数；没配的项目摘要与加这一项之前逐字相同。
  const spec = facts.spec ? { spec: { blocks: facts.spec.blocks.length, read: specRead } } : {};
  // 现有的架构文档同理（第三期契约 D 节末段）：配了才报几份、几块、页面上读回几块；没有架构这一份的不出页面，shown 为 false。
  const docs = facts.archDocs ?? [], archDocs = docs.length
    ? { archDocs: { docs: docs.length, blocks: docs.reduce((s, d) => s + d.blocks.length, 0), read: docsRead, shown: !!facts.arch?.modules?.length } } : {};
  return {
    ...spec,
    ...archSummary(facts),
    ...archDocs,
    pages: rendered.length,
    pagesOnDisk: rd.files.length,
    tables: facts.tables.length,
    columns: facts.tables.reduce((s, t) => s + t.columns.length, 0),
    notes: { written: Object.keys(notes).length, stale: Object.values(notes).filter((n) => n.state === 'stale').length, orphans: facts.orphanNotes.length },
    // 没写说明不算不一致（H 节第 3 项），只在这里报数；缺含义的列同 pending：既没有来源注释也没有说明、又不是外键的。
    unwritten: {
      tables: facts.tables.filter((t) => !notes[t.anchor]).length,
      columns: facts.tables.reduce((s, t) => s + t.columns.filter((c) => !c.comment && !notes[c.anchor] && !isFk(t, c)).length, 0),
      groups: facts.groups.filter((g) => !notes[`group:${g.id}`]).length,
      doc: !notes['doc:db'],
    },
    // 文档自己已经明说了的，不算不一致（H 节），只报数。
    declared: { unfolded: facts.unfolded.length, unparsed: facts.unparsed.length, dynamic: facts.dynamic.length, dynamicUnassigned: facts.dynamic.filter((d) => !d.assigned).length },
    byKind,
  };
}

// 整套核对。dir：docs/readable/ 的绝对路径；label：给人看的位置前缀；facts：入口重新取的文档模型（带说明）；
// rendered：入口用出页面的函数在内存里重出的 [{path, html}]。
export function runCheck({ dir, label, facts, rendered }) {
  const rd = reader(dir), spec = specFacts(rd, facts.spec, label), docs = archDocsFacts(rd, facts, label);
  const problems = dedupe([
    ...pagesCurrent(rd, rendered, label),
    ...pageFacts(rd, facts, label),
    ...spec.problems,
    ...docs.problems,
    ...archFacts(rd, facts, label, noteRegions),
    ...archProblems(facts),
    ...Object.keys(facts.notes || {}).sort(cmp).filter((a) => facts.notes[a].state === 'stale')
      .map((a) => ({ kind: 'note-stale', where: a, detail: '说明的指纹对不上：写于来源的旧版本，要按现在的来源重写后 note put' })),
    ...facts.orphanNotes.map((x) => ({ kind: 'note-orphan', where: x.anchor, detail: '说明的锚点已经不存在：改挂到新锚点（note put）或删掉（note drop）' })),
    ...facts.mapProblems.map((x) => ({ kind: 'dangling', where: `docs/readable-src/map.json ${x.where}`, detail: x.problem })),
    ...danglingLinks(rd, label),
  ]);
  return { ok: problems.length === 0, problems, summary: summarize(facts, rd, rendered, problems, spec.read, docs.read) };
}

// 隐去的兜底（契约 G 节末段）：逐个字段点名去隐总会漏字段，漏了的那一处两边都没隐、第 2 项比对一致，看不出来。
// 所以落盘前把每一页连着显示的每段文字与每个属性值再过一遍隐去规则，有命中就点名那一页、在哪一节。
// 只报位置与处数，不把命中的原文打出来——标准错误进日志，日志也是带出去的地方；点名用的标题与锚点同样先隐去。
// 现有的架构文档的页（arch/doc-NN/）虽在 arch/ 下，隐去走的是需求规格那一份（spec-scrub）。
const scrubFile = (rel) => (/^spec\/|^arch\/doc-\d+\//.test(rel) ? 'spec' : rel.startsWith('arch/') ? 'arch' : 'db');
function leaks(rd, label) {
  const out = [];
  for (const rel of rd.html) {
    const at = new Map();
    for (const s of segments(rd.tree(rel))) {
      const n = redact(s.text).hits;
      if (!n) continue;
      const k = redact([s.heading ? `「${s.heading}」一节` : '页首', s.anchor].filter(Boolean).join(' · ')).text;
      at.set(k, (at.get(k) || 0) + n);
    }
    if (!at.size) continue;
    const total = [...at.values()].reduce((a, b) => a + b, 0);
    out.push({ kind: 'leak', where: label + rel, detail: `页面上有 ${total} 处形如内网地址、带口令的地址或密钥的字样没有隐去（${[...at].map(([k, n]) => `${k} ${n} 处`).join('；')}）：出页面时有一个字段没过隐去，要在 render/${scrubFile(rel)}-scrub.mjs 里补上` });
  }
  return out;
}

// build 落盘前的自检：跑第 2 项，再过一遍隐去的兜底，对的是写好的临时目录。
export function selfCheck(dir, facts) {
  const rd = reader(dir);
  const problems = dedupe([...pageFacts(rd, injected(facts), '新出的 '), ...specFacts(rd, facts.spec, '新出的 ').problems, ...archDocsFacts(rd, facts, '新出的 ').problems,
    ...archFacts(rd, facts, '新出的 ', noteRegions), ...leaks(rd, '新出的 ')]);
  if (problems.length) throw new CheckFailed(problems);
}

// READABLE_FAIL_AT=selfcheck：第一张表多一个列（没有表就多一张表），页面上自然没有它。
function injected(facts) {
  if (process.env.READABLE_FAIL_AT !== 'selfcheck') return facts;
  const name = '__selfcheck_injected__', [t, ...rest] = facts.tables;
  if (!t) return { ...facts, tables: [{ anchor: `table:${name}`, name, columns: [], constraints: [] }] };
  return { ...facts, tables: [{ ...t, columns: [...t.columns, { anchor: `column:${t.name}.${name}`, name, type: 'TEXT', nullable: true, default: null }] }, ...rest] };
}

// 给人看的：一条一行「在哪：怎么不一致」，末行「不一致 N 条」（H 节「输出」）。
// pageCap 给了时（check 的人读输出给 10），不是现行的页（第 1 项：内容不同、缺的、多的）超过这个数只列前几张，
// 接一行「另有 N 页」与先重出再核对的提示——建表文件靠前处加一行，后面几十张表的出处行号都变，清单会很长，淹掉别的几条。
// --json 与 build 自检的报错照旧全列。末行的条数始终是全部。
export const PAGE_KINDS = new Set(['stale-page', 'missing-page', 'extra-page']);
export function lines(problems, pageCap = Infinity) {
  const pagesAll = problems.filter((p) => PAGE_KINDS.has(p.kind)), keep = new Set(pagesAll.slice(0, pageCap));
  const out = [];
  for (const p of problems) {
    if (PAGE_KINDS.has(p.kind) && !keep.has(p)) continue;
    out.push(`${p.where}：${p.detail}`);
    if (p === pagesAll[keep.size - 1] && pagesAll.length > keep.size) {
      out.push(`另有 ${pagesAll.length - keep.size} 页不是现行的，没有逐条列出（--json 里全有）：先 build 重出一遍再核对，剩下的才是要查的`);
    }
  }
  return [...out, `不一致 ${problems.length} 条`];
}

export function summaryLine(s) {
  const u = s.unwritten, d = s.declared;
  return `核对了 ${s.pages} 页（磁盘上 ${s.pagesOnDisk} 个文件）、表 ${s.tables} 张、列 ${s.columns} 个；说明 ${s.notes.written} 段（待更新 ${s.notes.stale}、孤儿 ${s.notes.orphans}）；`
    + `没写说明的（不算不一致）：表 ${u.tables} 张、缺含义的列 ${u.columns} 个、组 ${u.groups} 个、doc:db ${u.doc ? '没写' : '已写'}；`
    + `文档已明说、不算不一致的：未合并的动态定义 ${d.unfolded}、未解析的语句 ${d.unparsed}、表名运行时拼的 ${d.dynamic}（未归属 ${d.dynamicUnassigned}）`
    + (s.spec ? `；需求规格 ${s.spec.blocks} 块，页面上读回 ${s.spec.read} 块` : '') + archLine(s) + docsLine(s.archDocs);
}
const docsLine = (d) => (!d ? '' : `；现有架构文档 ${d.docs} 份、${d.blocks} 块，${d.shown ? `页面上读回 ${d.read} 块` : '这个项目没有架构这一份，没出页面、不比'}`);
