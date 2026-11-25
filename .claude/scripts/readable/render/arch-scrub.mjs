// arch-scrub.mjs —— 架构这一份页面用的模型副本：凡取自来源的字过隐去，换掉的记下在哪（第三期契约 docs/readable-spec/phase3-arch-contract.md D 节末段）。
// 为什么有它：文件头说明是这几页上最有用的原文，也最容易夹着内网地址、带口令的地址（下游一个后端九成以上的文件开头有一段）；
// 规格把「生成物里不出现密钥、内网地址」定为 P0。隐去的规则只有一份，在 ../sensitive.mjs；这里只管哪些字过它、记在哪，
// 给 arch/index.html 顶上列出来。传进来的事实不动——核对器要拿同一份事实在内存里重出一遍来比。
// 过的：路径（文件、文件对、接口所在的文件）、名字（引用的名字、对外提供的名字、处理函数名）、接口路径、文件头说明、处理函数的说明、
// 引用语句的原文、外部包名、模块的标题与层名、项目判断里对不上的描述、说明的正文、配置的标题。模块 id 只许小写字母、数字与连字符，
// 表名是数据库设计那一份的锚点与文件名，同第一期不过。漏了哪一处，落盘前的兜底（check.mjs 的 leaks）拦下并点名那一页。
// 同一段原文在几处出现（一个路径在文件清单、文件对、未归属里各一次）只记一处：顶上报的是「几段原文里有要隐去的」。
import { redact } from '../sensitive.mjs';

const MAP_FILE = 'docs/readable-src/map.json', CONFIG_FILE = 'docs/readable-src/config.json';
// 名字带 .test.、.spec. 或在 __tests__/ 下的文件（契约 D 节第 6 条）：测试文件进了模块图，提醒可以在 ignore 里排掉。
export const TEST_FILE = /\.(?:test|spec)\.|(?:^|\/)__tests__\//;

export function archView(facts, cfgTitle) {
  const hits = [], memo = new Map();
  // where：给人看的位置（文件路径或项目判断文件），what：哪一项。
  const r = (s, where, what) => {
    if (typeof s !== 'string') return s;
    if (memo.has(s)) return memo.get(s);
    const o = redact(s);
    if (o.hits) hits.push({ where: redact(where).text, what, n: o.hits });
    memo.set(s, o.text);
    return o.text;
  };
  const P = (p) => r(p, p, '路径');
  const { code, arch } = facts, notes = facts.notes || {};
  const byPath = new Map(code.files.map((f) => [f.path, f])), owner = new Map();
  for (const m of arch.modules) for (const f of m.files) owner.set(f, m.id);
  const note = (anchor) => {
    const n = notes[anchor];
    return n ? { ...n, text: r(n.text, `说明 ${anchor}`, '说明的正文') } : undefined;
  };
  // 接口取自 code.routes（带处理函数的说明），按所在文件归到模块；核对器另拿 arch 里各模块的 routes 比，两边对得上才算。
  // why（完整路径拼不出的原因）是两个定好的词，不过隐去；认不认得由 arch-kit 的 routeWhy 管。
  const routes = code.routes.map((x) => ({
    method: x.method, path: r(x.path, x.file, '接口路径'), fullPath: x.fullPath == null ? null : r(x.fullPath, x.file, '接口路径'), why: x.why,
    handler: r(x.handler, x.file, '处理函数名'), file: P(x.file), doc: x.doc == null ? null : r(x.doc, x.file, '处理函数的说明'), module: owner.get(x.file) ?? null,
  }));
  const pairs = (list) => list.map(([a, b]) => [P(a), P(b)]);
  const modules = arch.modules.map((m) => ({
    id: m.id, title: r(m.title, MAP_FILE, '模块的标题'), layer: m.layer == null ? null : r(m.layer, MAP_FILE, '层名'), status: m.status,
    files: m.files.map((p) => {
      const f = byPath.get(p);
      if (!f) throw new Error(`模块 ${m.id} 的文件 ${p} 不在 code.files 里`); // 汇总保证模块的文件都来自 code.files；对不上是模型的错，不悄悄漏一行
      return { path: P(p), lines: f.lines, entry: f.entry, head: f.head == null ? null : r(f.head, p, '文件头说明'), headAt: f.headAt };
    }),
    lines: m.lines,
    routes: routes.filter((x) => x.module === m.id),
    uses: m.uses.map((u) => ({ module: u.module, pairs: pairs(u.pairs), names: u.names.map((n) => r(n, `模块 ${m.id}`, '引用的名字')) })),
    usedBy: m.usedBy,
    provides: m.provides.map((p) => ({ name: r(p.name, p.file, '对外提供的名字'), file: P(p.file), by: p.by })),
    tables: m.tables,
    externals: m.externals.map((x) => r(x, `模块 ${m.id}`, '外部包名')),
    note: note(`module:${m.id}`),
  }));
  const at = (x) => ({ ...x, file: P(x.file), text: r(x.text, x.file, '引用语句的原文') });
  return {
    title: r(cfgTitle, CONFIG_FILE, '配置的 title'),
    source: arch.source,
    layers: arch.layers.map((x) => r(x, MAP_FILE, '层名')),
    modules,
    byId: new Map(modules.map((m) => [m.id, m])),
    owner, // 原始路径 → 模块 id（表页上标模块用）
    routes,
    files: code.files.length,
    lines: code.files.reduce((s, f) => s + f.lines, 0),
    unassigned: arch.unassigned.map(P),
    cycles: arch.cycles.map((c) => ({ modules: c.modules, pairs: pairs(c.pairs), raw: c.pairs })),
    upward: arch.upward.map((u) => ({ from: u.from, to: u.to, pairs: pairs(u.pairs), raw: u.pairs })),
    big: arch.big.map((b) => ({ file: P(b.file), module: owner.get(b.file) ?? null })), // 行数不上页面（D 节），这里不带
    idle: arch.idle.map((p) => ({ file: P(p), module: owner.get(p) ?? null })),
    unresolved: code.unresolved.map(at),
    dynamic: code.dynamic.map(at),
    skipped: code.skipped.map((s) => ({ ext: r(s.ext, CONFIG_FILE, '没扫的扩展名'), count: s.count })),
    problems: arch.problems.map((p) => ({ kind: p.kind, module: p.module == null ? null : r(p.module, MAP_FILE, '项目判断里对不上的位置'), detail: r(p.detail, MAP_FILE, '项目判断里对不上的描述') })),
    tests: code.files.filter((f) => TEST_FILE.test(f.path)).length,
    tables: new Set(facts.tables.map((t) => t.name)),
    docNote: note('doc:arch'),
    hits,
  };
}
