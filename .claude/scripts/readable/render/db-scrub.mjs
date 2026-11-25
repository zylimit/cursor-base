// db-scrub.mjs —— 数据库设计页面上不带出去的东西（契约 docs/readable-spec/phase1-db-contract.md G 节「不带出去的东西」，
// 取代 C 节「原样照出、只在顶上警告」的做法）。规格把「生成物里不出现密钥、内网地址与账号」定为 P0。
// 隐去的规则只有一份，在 ../sensitive.mjs；这里只管哪些字段过它、换掉的记在哪个文件哪一行（说明记锚点），给 db/index.html 顶上列出来。
// 出一份换过的模型副本给各页用，传进来的模型不动——核对器要拿同一份模型在内存里重出一遍来比。
// 过的字段：页面上凡是取自来源或配置的文字——来源里的注释（表、列、改动备注）、类型、默认值、CHECK 与 GENERATED 原文、
// 表级约束与索引的名字和原文、视图定义、函数签名、建表定义四张问题清单里的原文开头与原因、按名字删约束没对上的名字、
// 代码一侧各张清单的原文开头与原因、项目判断里对不上的问题描述、配置的标题与 ddl 路径，以及说明的正文。
// 只有表名、列名不过：它们是锚点、文件名与说明的键，换掉就对不上了；真有命中，落盘前的兜底（check.mjs 的 leaks）拦下并点名那一页。
// 逐个字段点名总会漏（2026-11-23 审查漏了函数签名与清单里的原因两处），所以兜底是必须的，这里不是唯一一道。
import { redact } from '../sensitive.mjs';
import { cmp } from '../model.mjs';

const CONFIG_FILE = 'docs/readable-src/config.json', MAP_FILE = 'docs/readable-src/map.json';
// 问题清单里这几个键是位置与名字，其余的字符串都照录在页面上（db.mjs issues 的「原因」一栏），一律过隐去。
const PLACE_KEYS = new Set(['file', 'line', 'table', 'tables', 'column']);
// 测试注入点 READABLE_FAIL_AT=leak：模拟「某个上页面的字段忘了过隐去」——第一张表的注释后面接一个没隐去的内网地址，
// 只出在那张表的表页上；落盘前的兜底该拦下、点名那一页，原有页面不动。
const LEAK_SAMPLE = '10.0.0.1';

export function scrub(model, cfg) {
  const hits = [];
  // where：{file, line}（line 为 null 的只写文件）或 {anchor}；what：哪一项。count 为 false 的只换不记——同一段原文在模型里存了两份、页面只显示其中一份时用。
  const r = (s, where, what, count = true) => {
    if (typeof s !== 'string') return s;
    const o = redact(s);
    if (o.hits && count) hits.push({ ...where, what, n: o.hits });
    return o.text;
  };
  const at = (x) => ({ file: x.file, line: x.line ?? null });
  // 代码文件的行号不上页面（契约 F 节「页面」）：代码一改行号就挪，页面跟着变；隐去清单里代码一侧的条目只记文件。
  const atCode = (x) => ({ file: x.file, line: null });
  const tables = model.tables.map((t) => ({
    ...t,
    comment: r(t.comment, at(t), `表 ${t.name} 的注释`),
    columns: t.columns.map((c) => {
      const w = at(c.file ? c : t), who = `列 ${t.name}.${c.name}`;
      return {
        ...c,
        type: r(c.type, w, `${who} 的类型`),
        comment: r(c.comment, w, `${who} 的注释`),
        default: r(c.default, w, `${who} 的默认值`),
        check: r(c.check, w, `${who} 的 CHECK`),
        generated: r(c.generated, w, `${who} 的 GENERATED`),
      };
    }),
    // 页面上的约束原文显示 raw，没有 raw 才显示 check：只记显示的那一份。
    constraints: t.constraints.map((c) => ({
      ...c,
      name: r(c.name, at(c), `表 ${t.name} 的表级约束名`),
      raw: r(c.raw, at(c), `表 ${t.name} 的表级约束原文`),
      check: r(c.check, at(c), `表 ${t.name} 的表级约束原文`, c.raw == null),
      comment: r(c.comment, at(c), '', false),
    })),
    indexes: t.indexes.map((x) => ({
      ...x,
      name: r(x.name, at(x), '索引名'),
      columns: r(x.columns, at(x), `索引 ${x.name ?? ''} 的列`),
      options: r(x.options, at(x), `索引 ${x.name ?? ''} 的选项`),
      where: r(x.where, at(x), `索引 ${x.name ?? ''} 的条件`),
    })),
    changes: (t.changes || []).map((x) => ({ ...x, comment: r(x.comment, at(x), `表 ${t.name} 的改动备注`) })),
    maybeDropped: (t.maybeDropped || []).map((x) => ({ ...x, name: r(x.name, at(x), `表 ${t.name} 按名字删约束的名字`) })),
  }));
  if (process.env.READABLE_FAIL_AT === 'leak' && tables.length) tables[0] = { ...tables[0], comment: `${tables[0].comment ?? ''}\n${LEAK_SAMPLE}` };
  const views = model.views.map((v) => ({ ...v, sql: r(v.sql, at(v), `视图 ${v.name} 的定义`) }));
  const functions = model.functions.map((f) => ({ ...f, signature: r(f.signature, at(f), `函数 ${f.name} 的签名`) }));
  // 问题清单：原文开头（head，没有 head 的显示 text）与其余照录的字符串（原因等）。页面只显示 head 与 text 中的一份，只记那一份。
  const issues = (list, what) => list.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => {
    if (PLACE_KEYS.has(k)) return [k, v];
    if (k === 'head' || k === 'text') return [k, r(v, at(x), `${what}的原文开头`, k === 'head' || x.head == null)];
    return [k, r(v, at(x), `${what}的${k === 'reason' ? '原因' : k}`)];
  })));
  const notes = {};
  for (const k of Object.keys(model.notes || {}).sort(cmp)) {
    const n = model.notes[k];
    notes[k] = { ...n, text: r(n.text, { anchor: k }, '说明的正文') };
  }
  const conf = { file: CONFIG_FILE, line: null }, map = { file: MAP_FILE, line: null };
  const page = { ...cfg, title: r(cfg.title, conf, '配置的 title'), ddl: (cfg.ddl || []).map((p) => r(p, conf, '配置的 ddl 路径')) };
  return {
    model: {
      ...model, tables, views, functions, notes,
      unfolded: issues(model.unfolded, '未合并的动态定义'),
      unparsed: issues(model.unparsed, '未解析的语句'),
      conflicts: issues(model.conflicts, '定义冲突'),
      orphanAlters: issues(model.orphanAlters, '改了不存在的表'),
      dynamic: model.dynamic.map((d) => ({ ...d, head: r(d.head, atCode(d), '表名是运行时拼的原文开头') })),
      // 取事实那边还没出这个键时按「没有」处理（契约 F 节，2026-11-23 另一位在加），页面上这张清单就不显示。
      ambiguous: (model.ambiguous || []).map((a) => ({ ...a, head: r(a.head, atCode(a), '提到了表名、像 SQL 又不像的原文开头') })),
      unscanned: model.unscanned.map((u) => ({ ...u, reason: r(u.reason, atCode(u), '没扫成的原因') })),
      mapProblems: model.mapProblems.map((p) => ({ ...p, where: r(p.where, map, '项目判断里对不上的位置'), problem: r(p.problem, map, '项目判断里对不上的问题描述') })),
    },
    cfg: page,
    hits,
  };
}
