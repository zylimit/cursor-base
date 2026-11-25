// links-arch.mjs —— 把文件、引用边、接口与第一期的「谁写谁读哪张表」照模块划分汇总成模块一级的事实（第三期契约 B 节「汇总成模块」、末尾 arch 的形状）。
// 同 links.mjs，只依赖 model 与划分：不读磁盘，项目判断由 notes 读好、校验好交进来（map.arch）。
// 「结构上看得出的」（循环依赖、越层引用、特别大的文件、没人引用的文件）都是机械算的，只说算出来的，不下「这是债务」「应当拆分」的判断。
// 输出一律排好序，同一份输入两次逐字节相同。
import { cmp } from './model.mjs';
import { assignByMap, dirModules } from './arch-map.mjs';

export const BIG_LINES = 1000; // B 节：超过 1000 行的文件

const byPair = (a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]);
const byIndex = (a, b) => a - b;

// 有向图的强连通分量（Tarjan）：节点是模块的下标，邻居按下标排好，两个以上模块的分量就是一组循环依赖。
function cycleSets(n, adj) {
  let next = 0;
  const index = Array(n).fill(-1), low = Array(n).fill(0), on = Array(n).fill(false), stack = [], out = [];
  const visit = (v) => {
    index[v] = low[v] = next++; stack.push(v); on[v] = true;
    for (const w of adj[v]) {
      if (index[w] < 0) { visit(w); low[v] = Math.min(low[v], low[w]); }
      else if (on[w]) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] !== index[v]) return;
    const c = [];
    let w;
    do { w = stack.pop(); on[w] = false; c.push(w); } while (w !== v);
    if (c.length > 1) out.push(c.sort(byIndex));
  };
  for (let v = 0; v < n; v++) if (index[v] < 0) visit(v);
  return out.sort((a, b) => a[0] - b[0]);
}

// Python 的 __init__.py 不会被哪条引用语句点到，但它所在的包里任何一个文件被引用时它都会先跑；
// 记它「没人引用」会让读者以为是死文件，所以包里有文件被引用的 __init__.py 不进 idle。
const initDir = (p) => (/(?:^|\/)__init__\.py$/.test(p) ? p.slice(0, Math.max(0, p.lastIndexOf('/'))) : null);

// code：取事实的 code（files、edges、routes）；usage：第一期的写读；am：notes.loadMap 校验过的 map.arch；codeRoots：配置里的。
export function buildArch(code, usage, am, codeRoots) {
  const arch = { source: am.modules ? 'map' : 'dirs', layers: am.layers, modules: [], unassigned: [], cycles: [], upward: [], big: [], idle: [], problems: [] };
  // B 节末尾：没配 codeRoots 的项目 modules 是空数组，不出架构这一份；配了而一个代码文件都没取到的同样——哪怕 map.json 里写了模块：
  // 没有代码文件就没有可汇总的事实，出一份空壳只会让人以为扫过。
  if (!codeRoots.length || !code.files.length) return arch;
  const paths = code.files.map((f) => f.path), byPath = new Map(code.files.map((f) => [f.path, f]));
  let mods, owner;
  const problems = [...am.problems];
  if (am.modules) {
    const a = assignByMap(am.modules, paths);
    owner = a.owner;
    problems.push(...a.problems);
    mods = am.modules.map((m, i) => ({ id: m.id, title: m.title, layer: m.layer, status: m.status, files: paths.filter((p) => owner.get(p) === i) }));
  } else {
    mods = dirModules(codeRoots, paths);
    owner = new Map(mods.flatMap((m, i) => m.files.map((f) => [f, i])));
  }

  // 模块之间的依赖只算跨模块的；从「未归属」发出或指向它的边不计入任何模块（B 节末尾）。整个文件被引用（whole）或 from a import *（star）记名字 *。
  const uses = mods.map(() => new Map()), provides = mods.map(() => new Map());
  for (const e of code.edges) {
    const a = owner.get(e.from), b = owner.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const names = [...e.names, ...(e.whole || e.star ? ['*'] : [])];
    const d = uses[a].get(b) ?? uses[a].set(b, { pairs: [], names: new Set() }).get(b);
    d.pairs.push([e.from, e.to]);
    for (const n of names) {
      d.names.add(n);
      const k = `${e.to}\0${n}`;
      (provides[b].get(k) ?? provides[b].set(k, { name: n, file: e.to, by: new Set() }).get(k)).by.add(a);
    }
  }
  const usedBy = mods.map(() => new Set());
  uses.forEach((m, a) => { for (const b of m.keys()) usedBy[b].add(a); });

  // 读写的表取自第一期的 usage（含项目判断 dynamicTables 补的那几条），按文件归到模块。
  const reads = mods.map(() => new Set()), writes = mods.map(() => new Set());
  for (const t of Object.keys(usage).sort(cmp)) {
    for (const w of usage[t].writes) if (owner.has(w.file)) writes[owner.get(w.file)].add(t);
    for (const r of usage[t].reads) if (owner.has(r.file)) reads[owner.get(r.file)].add(t);
  }

  const ids = (set) => [...set].sort(byIndex).map((i) => mods[i].id);
  arch.modules = mods.map((m, i) => ({
    id: m.id, title: m.title, layer: m.layer, status: m.status,
    files: [...m.files].sort(cmp),
    lines: m.files.reduce((s, f) => s + byPath.get(f).lines, 0),
    routes: code.routes.filter((r) => owner.get(r.file) === i).map((r) => ({ method: r.method, path: r.path, fullPath: r.fullPath, why: r.why, handler: r.handler, file: r.file })),
    uses: [...uses[i]].sort((x, y) => x[0] - y[0]).map(([b, d]) => ({ module: mods[b].id, pairs: d.pairs.sort(byPair), names: [...d.names].sort(cmp) })),
    usedBy: ids(usedBy[i]),
    provides: [...provides[i].values()].sort((x, y) => cmp(x.file, y.file) || cmp(x.name, y.name)).map((p) => ({ name: p.name, file: p.file, by: ids(p.by) })),
    tables: { reads: [...reads[i]].sort(cmp), writes: [...writes[i]].sort(cmp) },
    externals: [...new Set(m.files.flatMap((f) => byPath.get(f).externals))].sort(cmp),
  }));
  arch.unassigned = paths.filter((p) => !owner.has(p));

  // 循环依赖：成环的模块（按模块的先后）与环里各条跨模块的边——强连通分量里的每条边都在某个环上。
  const adj = uses.map((m) => [...m.keys()].sort(byIndex));
  arch.cycles = cycleSets(mods.length, adj).map((c) => {
    const inside = new Set(c);
    return { modules: c.map((i) => mods[i].id), pairs: c.flatMap((a) => adj[a].filter((b) => inside.has(b)).flatMap((b) => uses[a].get(b).pairs)).sort(byPair) };
  });
  // 越层引用：layers 从上到下，下层（下标大的）模块引用上层模块。同层与向下的不算；没有层的模块不判。
  if (arch.layers.length) {
    const lv = mods.map((m) => arch.layers.indexOf(m.layer));
    uses.forEach((m, a) => {
      for (const b of adj[a]) if (lv[a] >= 0 && lv[b] >= 0 && lv[a] > lv[b]) arch.upward.push({ from: mods[a].id, to: mods[b].id, pairs: m.get(b).pairs });
    });
  }
  arch.big = code.files.filter((f) => f.lines > BIG_LINES).map((f) => ({ file: f.path, lines: f.lines }));
  const targets = new Set(code.edges.map((e) => e.to)), pkgs = new Set();
  for (const t of targets) for (let i = t.lastIndexOf('/'); i >= 0; i = t.lastIndexOf('/', i - 1)) { pkgs.add(t.slice(0, i)); if (!i) break; }
  if (targets.size) pkgs.add('');
  arch.idle = code.files.filter((f) => !f.entry && !targets.has(f.path) && !pkgs.has(initDir(f.path))).map((f) => f.path);
  arch.problems = problems;
  return arch;
}
