// arch-map.mjs —— 项目判断 map.json 里的 modules 与 layers：逐条校验、把文件归到模块（第三期契约 docs/readable-spec/phase3-arch-contract.md A 节）。
// 文件怎么归成模块是项目判断、不是事实：下游一个后端 165 个文件平铺在同一个目录下，按目录分只得一个大模块，
// 按文件名前缀猜就是把推断当事实——所以划分由 AI 提议（proposed）、人确认（confirmed），生成器只读、只校验、照划分把事实汇总准。
// 对不上的不拦生成，记进 arch.problems（kind：double / empty / layer / id，形状不对的记 format）——拦了，读者连架构页都拿不到；
// 不记，读者会把一条写错的划分当真。没有 modules 时按目录分，status 记 default，页面上标明还没有项目判断。
import { cmp } from './model.mjs';

export const MODULE_ID = /^[a-z0-9-]+$/; // A 节：id 只许小写字母、数字与连字符，页面地址由它推出

// 通配只有一套（A 节：modules 的 paths 与 ignore 同一套）：**（含 **/ 前缀，可为空）跨目录、* 不跨目录、?。
// 原在入口 readable-docs.mjs，2026-11-23 Task 3.3 原样搬来，入口的 walk 从这里取。
export function globRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*' && g[i + 1] === '*') { if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i++; } }
    else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const normPath = (p) => p.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');

// m 是读好的 map.json 顶层对象；statuses 是 proposed / confirmed（notes.mjs 的 STATUSES，传进来免得两处各写一份）。
// 返回 {modules, layers, problems}：modules 为 null 表示没有划分的判断（按目录分）；每个模块 {id, title, layer, status, paths, res}。
// 问题按在文件里出现的先后：先 layers，再逐个模块。
export function readArchMap(m, statuses) {
  const problems = [], add = (kind, module, detail) => problems.push({ kind, module, detail });
  let layers = [];
  const noLayers = m.layers === undefined || (Array.isArray(m.layers) && !m.layers.length);
  if (m.layers !== undefined) {
    if (!Array.isArray(m.layers) || m.layers.some((x) => typeof x !== 'string' || !x)) add('format', null, 'layers 该是层名（非空字符串）的数组，整项没用，不判层');
    else {
      layers = [...new Set(m.layers)];
      if (layers.length < m.layers.length) add('format', null, 'layers 里有重复的层名，按先出现的算');
    }
  }
  // 空数组与没写同样处理（同表的分组）：还没有划分的判断时，按目录分比一个模块都没有有用。
  if (m.modules === undefined || (Array.isArray(m.modules) && !m.modules.length)) return { modules: null, layers, problems };
  if (!Array.isArray(m.modules)) { add('format', null, 'modules 该是数组，整项没用，按目录分'); return { modules: null, layers, problems }; }
  const modules = [], ids = new Set();
  m.modules.forEach((x, i) => {
    const w = `modules[${i}]`;
    if (!isObj(x)) return add('format', w, `${w} 该是对象，这个模块没用`);
    // id 不合写法或重复的模块整个不用：页面地址由 id 推出，推不出；它匹配的文件归后面的模块或「未归属」，在首页看得见。
    if (typeof x.id !== 'string' || !MODULE_ID.test(x.id)) {
      return add('id', typeof x.id === 'string' && x.id ? x.id : w, `${w} 的 id ${JSON.stringify(x.id ?? null)} 不合写法（只许小写字母、数字与连字符），这个模块没用，它匹配的文件归后面的模块或「未归属」`);
    }
    if (ids.has(x.id)) return add('id', x.id, `${w} 的 id ${x.id} 与前面的模块重复，按先出现的算，这个模块没用`);
    ids.add(x.id);
    const title = typeof x.title === 'string' && x.title.trim() ? x.title : x.id;
    if (title === x.id && x.title !== x.id) add('format', x.id, `模块 ${x.id} 没写标题，用 id 当标题`);
    let status = x.status;
    if (!statuses.includes(status)) { add('format', x.id, `模块 ${x.id} 的 status 是 ${JSON.stringify(status ?? null)}，只认 proposed 或 confirmed；按 proposed（AI 提议）算`); status = 'proposed'; }
    const paths = Array.isArray(x.paths) ? x.paths.filter((p) => typeof p === 'string' && p).map(normPath) : [];
    const badPaths = !Array.isArray(x.paths) || paths.length < x.paths.length;
    if (badPaths) add('format', x.id, `模块 ${x.id} 的 paths 该是通配写法（非空字符串）的数组，${paths.length ? '认不出的几项没用' : '整项没用'}`);
    // 有 layers 时每个模块的 layer 必须是其中一个（A 节）；不是的按没有层算，不进越层的判断。没有 layers（没写或写成空数组）而模块写了 layer 的
    // 同样对不上：写了层却没处可对，读的人会以为层已经判过。layers 写得不成形的已记 format、整项不用，这时不判层，layer 照写。
    let layer = typeof x.layer === 'string' && x.layer ? x.layer : null;
    if (layers.length && !layers.includes(layer)) {
      add('layer', x.id, `模块 ${x.id} 的 layer ${JSON.stringify(x.layer ?? null)} 不在 layers（${layers.join('、')}）里，按没有层算`);
      layer = null;
    } else if (noLayers && x.layer != null) {
      add('layer', x.id, `模块 ${x.id} 写了 layer ${JSON.stringify(x.layer)}，但没有 layers 可对，按没有层算`);
      layer = null;
    } else if (!layers.length && x.layer != null && layer === null) add('format', x.id, `模块 ${x.id} 的 layer 该是层名（字符串），按没有层算`);
    // paths 整项没用的（一项也认不出）：文件为空，只记上面那条 format，不再顺带记 empty（A 节）。
    modules.push({ id: x.id, title, layer, status, paths, res: paths.map(globRe), unformed: badPaths && !paths.length });
  });
  return { modules, layers, problems };
}

// 一个文件按清单的先后归到第一个匹配它的模块（A 节）。也被后面的模块匹配到的：每一对模块记一条 double，两个都点名，
// 举头几个文件、报总数（重叠的写法一错常是几百个文件，逐个列只会把别的问题淹掉）。一个文件也没匹配到的模块记 empty，模块照留。
export function assignByMap(modules, files) {
  const owner = new Map(), hits = modules.map(() => 0), doubles = new Map();
  for (const f of files) {
    const at = [];
    modules.forEach((m, i) => { if (m.res.some((r) => r.test(f))) at.push(i); });
    at.forEach((i) => { hits[i]++; });
    if (!at.length) continue;
    owner.set(f, at[0]);
    for (const j of at.slice(1)) {
      const k = at[0] * modules.length + j;
      (doubles.get(k) ?? doubles.set(k, []).get(k)).push(f);
    }
  }
  const problems = [...doubles].sort((a, b) => a[0] - b[0]).map(([k, list]) => {
    const a = modules[Math.floor(k / modules.length)].id, b = modules[k % modules.length].id;
    return { kind: 'double', module: a, detail: `${list.length} 个文件同时被模块 ${a} 与 ${b} 匹配，按先后归 ${a}：${list.slice(0, 3).join('、')}${list.length > 3 ? ' 等' : ''}` };
  });
  modules.forEach((m, i) => {
    if (!hits[i] && !m.unformed) problems.push({ kind: 'empty', module: m.id, detail: `模块 ${m.id} 的 paths（${m.paths.join('、') || '空'}）一个文件也没匹配到` });
  });
  return { owner, problems };
}

const slugId = (s) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const normRoot = (r) => normPath(r).replace(/\/+$/, '').replace(/^\.$/, '');

// 没有 modules 时按目录分（A 节）：每个代码根目录下的每个一级子目录一个模块（连同它下面各层），直接放在根下的文件合成一个。
// 模块只由文件推出，没有代码文件的目录不成模块；几个代码根重叠时一个文件按最深的那个根算。按路径排。
// id 由目录名推出（根下的文件取根目录的末一段）；几个推出同一个 id 的（两个代码根下都有 utils/）都改用整条路径推，
// 不让先排到的那个占着短名——否则加一个同名目录，原来那个模块的 id 会变、说明成孤儿。还撞的接 -2、-3。
export function dirModules(codeRoots, files) {
  const roots = [...new Set(codeRoots.map(normRoot))].sort((a, b) => b.length - a.length || cmp(a, b)), by = new Map();
  for (const f of files) {
    const r = roots.find((x) => x === '' || f.startsWith(`${x}/`));
    if (r === undefined) continue;
    const rest = r ? f.slice(r.length + 1) : f, k = rest.indexOf('/');
    const path = k < 0 ? r : r ? `${r}/${rest.slice(0, k)}` : rest.slice(0, k);
    (by.get(path) ?? by.set(path, { path, top: k < 0, files: [] }).get(path)).files.push(f);
  }
  const list = [...by.values()].sort((a, b) => cmp(a.path, b.path));
  const short = (x) => slugId(x.path.split('/').pop()) || 'root', n = new Map(), used = new Set();
  list.forEach((x) => n.set(short(x), (n.get(short(x)) ?? 0) + 1));
  return list.map((x) => {
    const base = (n.get(short(x)) > 1 ? slugId(x.path) : short(x)) || 'root';
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    return { id, title: x.top ? `${x.path || '.'}（根下的文件）` : x.path, layer: null, status: 'default', files: x.files };
  });
}
