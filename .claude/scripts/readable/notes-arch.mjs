// notes-arch.mjs —— 架构这一份的说明：锚点 module:<id> 与 doc:arch、它们绑定的来源切片、pending 给的上下文（第三期契约 C 节）。
// 走第一期同一条路（notes.mjs 的 anchorIndex / bindNotes / putNotes / pendingList），只把这两种锚点的切片与上下文放在这里。
// 什么时候算过期：改函数体不算；加了文件、多了接口、多依赖了一个模块才算。判得太勤，维护者每次提交都要重写一批说明，
// 很快就不理它了；判得太松，页面上的话跟不上代码。所以切片里没有行数、文件头说明与表。
import { cmp, docAnchor, excerpt, fingerprint, moduleAnchor } from './model.mjs';
import { fileFor } from './notes-store.mjs';
import { redact } from './sensitive.mjs';

export const ARCH_DOC = 'arch'; // 锚点 doc:arch，落在 notes/doc/arch.md
export const MODULE_CONTEXT_BUDGET = 4096; // C 节：pending --json 给每个模块的上下文在 4KB 以内

// 模块：id 与标题、排序后的文件清单、接口（方法加完整路径；完整路径算不出的用源码里的写法）、它依赖的模块（排序）。
const moduleSlice = (m) => ({
  id: m.id, title: m.title, files: [...m.files].sort(cmp),
  routes: [...new Set(m.routes.map((r) => `${r.method} ${r.fullPath ?? r.path}`))].sort(cmp),
  uses: m.uses.map((u) => u.module).sort(cmp),
});
// doc:arch：各模块的 id、标题与所在的层（按 id 排序，同 doc:db 的切片）。加一个模块、改一个标题或层，导读才算过期。
const archSlice = (mods) => ({ modules: mods.map((m) => ({ id: m.id, title: m.title, layer: m.layer })).sort((a, b) => cmp(a.id, b.id)) });

// 往 anchorIndex 里加这两种锚点。没有模块（没配 codeRoots）就不出架构这一份，也就没有这两种锚点。
export function archAnchors(arch, idx) {
  const mods = arch?.modules ?? [];
  if (!mods.length) return;
  for (const m of mods) idx.set(moduleAnchor(m.id), { fp: fingerprint(moduleSlice(m)), file: fileFor('module', m.id) });
  idx.set(docAnchor(ARCH_DOC), { fp: fingerprint(archSlice(mods)), file: fileFor('doc', ARCH_DOC) });
}

const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
// 上下文会被贴进派单与日志，取自来源的字（路径、名字、接口的路径与完整路径、文件头说明）都先过隐去（C 节）。
const red = (s) => redact(String(s)).text;
const clean = (s) => red(String(s).replace(/\s+/g, ' ').trim());
const WHY = { runtime: '前缀是运行时定的', unmounted: '没找到它挂在哪，前面可能还有一段前缀' }; // 完整路径拼不出时，同页面上的标记
// 文件头说明的头一句：第一行有字的，切到第一个句号（中文句号、问号、叹号，或英文的后面跟空白），再截到 80 个字。先过隐去。
function firstSentence(head) {
  if (head == null) return null;
  const line = head.split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const m = /^.*?(?:[。！？]|[.!?](?=\s|$))/u.exec(line);
  return excerpt(clean(m ? m[0] : line));
}

// 一个模块的上下文：文件（行数、入口、文件头说明的头一句）、接口、依赖与被依赖、读写的表、外部包。
// 过了 4KB 每次从当下最长的那张清单的末尾截一条（一样长的按文件、接口、依赖、外部包、被依赖、读的表、写的表的先后），
// 截了几条记在 omitted 里，不悄悄少。不按先后整张截：几百个文件的模块会先把文件截光，写说明的人一个文件都看不到。
// 大小边截边算（清单里都是字符串：去掉末一条少它自己的字节，前面还有别的再少一个逗号），不每截一条就把整个对象重新序列化一遍。
function moduleContext(m, byPath) {
  const ctx = {
    module: m.id, title: clean(m.title), layer: m.layer, status: m.status, lines: m.lines,
    files: m.files.map((f) => {
      const x = byPath.get(f), h = firstSentence(x.head);
      return `${red(f)}（${x.lines} 行${x.entry ? '，入口' : ''}）${h ? `：${h}` : ''}`;
    }),
    routes: m.routes.map((r) => `${r.method} ${r.fullPath === null ? `${clean(r.path)}（${WHY[r.why] ?? WHY.runtime}）` : red(r.fullPath)} → ${red(r.handler)}（${red(r.file)}）`),
    uses: m.uses.map((u) => `${u.module}：${u.pairs.length} 对文件，用到 ${u.names.map(red).join('、') || '（没点名）'}`),
    usedBy: [...m.usedBy], externals: m.externals.map(red), reads: m.tables.reads.map(red), writes: m.tables.writes.map(red),
    omitted: {},
  };
  const order = ['files', 'routes', 'uses', 'externals', 'usedBy', 'reads', 'writes'];
  let size = bytes(ctx), om = bytes(ctx.omitted);
  while (size > MODULE_CONTEXT_BUDGET) {
    const k = order.reduce((best, x) => (ctx[x].length > (best ? ctx[best].length : 0) ? x : best), null);
    if (!k) break;
    size -= bytes(ctx[k].pop()) + (ctx[k].length ? 1 : 0);
    ctx.omitted[k] = (ctx.omitted[k] ?? 0) + 1;
    const now = bytes(ctx.omitted);
    size += now - om; om = now;
  }
  return ctx;
}

// pending 里架构的两样（C 节）：要补的模块（没写的、指纹对不上的，后者带着旧正文）各附一份上下文；doc:arch 没写或过期时列出来，
// 带各模块的 id、标题、层、文件数与现行说明的第一段。stored：侧车；stale(a)：过期时给 {anchor, text}，否则 null。
// 上下文里写模块的 id、不写锚点：一个模块的说明写好了，pending 里就不再出现它的锚点。
export function pendingArch(model, stored, stale) {
  const mods = model.arch?.modules ?? [];
  if (!mods.length) return { modules: [], archDoc: null };
  const byPath = new Map(model.code.files.map((f) => [f.path, f]));
  const modules = [];
  for (const m of mods) {
    const a = moduleAnchor(m.id), st = stale(a), missing = !stored.has(a);
    if (!missing && !st) continue;
    const context = moduleContext(m, byPath);
    modules.push({ anchor: a, id: m.id, title: m.title, missing, stale: st, context, contextBytes: bytes(context) });
  }
  const da = docAnchor(ARCH_DOC), dst = stale(da);
  const purpose = (id) => { const a = moduleAnchor(id); return stored.has(a) && !stale(a) ? stored.get(a).text.split('\n\n')[0] : null; };
  const archDoc = stored.has(da) && !dst ? null : {
    anchor: da, missing: !stored.has(da), stale: dst, source: model.arch.source, layers: model.arch.layers,
    modules: mods.map((m) => ({ id: m.id, title: m.title, layer: m.layer, files: m.files.length, purpose: purpose(m.id) })),
  };
  return { modules, archDoc };
}
