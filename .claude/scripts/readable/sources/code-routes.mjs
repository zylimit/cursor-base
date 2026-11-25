// code-routes.mjs —— 代码里的 HTTP 接口：方法、路径、一路拼出来的完整路径、处理函数与它的说明（第三期契约 docs/readable-spec/phase3-arch-contract.md B 节「接口」）。
// 为什么有它：前端的人拿着页面上调的地址来找是哪个文件哪个函数，测试的人拿它列用例（需求 REQ-DOC-002）。
// 最贵的错是完整路径少一段前缀而不自知——照着地址去调是 404，照着清单以为没有这个接口。所以拼不准的记 null 并写明原因（why）：
// 路由器一路往上没挂到应用上的是 unmounted（它一定挂在某处才对外，找不到挂在哪，前面有没有前缀就不知道——不当它是最外层），
// 哪一段前缀或路径算不准的是 runtime。找不到乙又会少前缀的挂载、认不出路由器的接口都进「没解析到的引用」，不给猜的地址，也不悄悄漏。
// 其次是漏接口：隔着别的装饰器、路径写成 path=、async def 都照认。
// 只认装饰器写法（FastAPI 与同样写法的框架），只在 code-lex.mjs 切出的「代码」里认——字符串、注释、文档串里长得像的不算；不跑被扫的代码。
// 乙是哪个文件里的路由器，用 code-resolve.mjs 解析引用，与引用边同一个口径；括号、实参、常量这些小解析在 code-py-parse.mjs。
// 实数（2026-11-23，一个下游后端）：路由装饰器 226 处、分在 60 个文件里；include_router 61 处、都不带前缀；路径不是字面量的 17 处，
// 其中 15 处用的是同文件只赋过一次的字符串常量、2 处是从别的文件引进来的这种常量（或它加字面量）——都按值算（契约 B 节），别的记 null。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cmp } from '../model.mjs';
import { Unclosed, sticky, split } from './code-lex.mjs';
import { langOf, resolver, PY_NAME, PY_DOTTED } from './code-resolve.mjs';
import { KW, splitTop, callArgs, matchClose, litOf, strVal, constsOf, bindingsOf, one, blockEnd, handlerAfter, docAt } from './code-py-parse.mjs';

const N = PY_NAME;
// @<名字>.<方法>( ——行首（缩进照认）才是装饰器；<名字>可以带点（@api.router.get）。
const DECO = new RegExp(`(?:^|\\n)[ \\t]*@[ \\t]*(${PY_DOTTED})[ \\t]*\\.[ \\t]*(get|post|put|delete|patch|head|options|trace|api_route|websocket)[ \\t]*\\(`, 'g');
// <名字> = APIRouter( 定义路由器、= FastAPI( 定义应用（可带类型标注、可写成 fastapi.APIRouter）。else: / try: 这类关键字后面紧跟冒号的不是标注。
const DEF = new RegExp(`(?:^|\\n)([ \\t]*)(${N})[ \\t]*(?::[^=\\n]*)?=(?!=)[ \\t]*(?:${N}[ \\t]*\\.[ \\t]*)*(APIRouter|FastAPI)[ \\t]*\\(`, 'g');
// <甲>.include_router(<乙>, prefix=…) 与 <甲>.mount("<前缀>", <乙>)
const MOUNT = new RegExp(`(?<![\\w.\\u0080-\\uffff])(${PY_DOTTED})[ \\t]*\\.[ \\t]*(include_router|mount)[ \\t]*\\(`, 'g');
const NAME_CHAIN = new RegExp(`^${N}(?:\\.${N})*$`);
const FN = new RegExp(`(?:^|\\n)(?:async[ \\t]+)?def[ \\t]+(${N})[ \\t]*\\(`, 'g'); // 模块级（不缩进）的函数
const RETURN = new RegExp(`(?:^|[\\n;:])[ \\t]*return(?![\\w\\u0080-\\uffff])([^\\n;]*)`, 'g');
const NESTED = new RegExp(`\\n([ \\t]+)(?:(?:async[ \\t]+)?def|class)[ \\t]+${N}[ \\t]*[(:]`, 'g'); // 函数体里的函数与类：它们的 return 不是工厂的
const TOP_SET = new RegExp(`(?:^|\\n)(${N})[ \\t]*(?::[^=\\n]*)?=(?!=)[ \\t]*`, 'g'); // 模块级的赋值；右边正好是 <函数>(…) 的在下面另认
const CALL = new RegExp(`(${N})[ \\t]*\\(`, 'y');

// 工厂函数造的路由器（契约 B 节）：模块级的 <名字> = <函数>(…)，<函数> 是同一个文件里的模块级函数、函数体里只定义了一个路由器、
// 每一处 return 返回的都是它——<名字> 就认成那个路由器。同一个工厂调了几次的，几个名字指同一处定义（挂了几次照「挂了多次」办）。
// 函数体里有两个路由器、return 的不是它、函数在别的文件里、名字在模块级赋过不止一次的，都不认。返回 名字 → 路由器。
// 只看工厂自己的 return：函数体里套着的函数（接口的处理函数就写在里面）与类的 return 不算。
function factoryMade(ctx) {
  const { o } = ctx, fns = new Map(), sets = new Map(), made = new Map();
  for (const m of o.matchAll(FN)) {
    const open = m.index + m[0].length - 1, end = blockEnd(ctx, open, 1), body = o.slice(open, end);
    const ds = ctx.defs.filter((d) => !d.mod && d.at > open && d.at < end);
    const inner = [...body.matchAll(NESTED)].map((x) => [open + x.index, blockEnd(ctx, open + x.index + x[0].length - 1, x[1].length + 1)]);
    const own = (r) => { const p = open + r.index + r[0].indexOf('return'); return !inner.some(([a, b]) => p > a && p < b); };
    const rs = [...body.matchAll(RETURN)].filter(own).map((r) => r[1].trim());
    fns.set(m[1], fns.has(m[1]) || ds.length !== 1 || !rs.length || rs.some((r) => r !== ds[0].name) ? null : ds[0]);
  }
  for (const m of o.matchAll(TOP_SET)) { // 右边正好是一次调用（调用之后就到行尾）才算 <名字> = <函数>(…)
    CALL.lastIndex = m.index + m[0].length;
    const c = CALL.exec(o), whole = c && sticky(/[ \t]*(?:\r?\n|;|$)/y, o, matchClose(o, CALL.lastIndex - 1) + 1) !== null;
    (sets.get(m[1]) ?? sets.set(m[1], []).get(m[1])).push(whole ? fns.get(c[1]) ?? null : null);
  }
  for (const [n, vs] of sets) if (vs.length === 1 && vs[0] && !KW.has(n)) made.set(n, vs[0]);
  return made;
}

function parseFile(file, src, sp, R) { // 第一遍：引进来的名字与模块级字符串常量——第二遍算值时要跟到别的文件去查
  const o = sp.other, ctx = { file, src, sp, o, defs: [], decos: [], mounts: [] };
  ctx.bind = bindingsOf(file, o, R);
  ctx.consts = constsOf(ctx);
  return ctx;
}
function readRoutes(ctx, info) { // 第二遍：路由器与应用、装饰器、挂载
  const { file, src, sp, o } = ctx;
  ctx.info = info;
  for (const m of o.matchAll(DEF)) {
    if (KW.has(m[2])) continue;
    const at = m.index + m[0].length - m[0].trimStart().length, open = m.index + m[0].length - 1, { args } = callArgs(o, open);
    const pf = args.find((x) => x.kw === 'prefix');
    // 应用自己没有前缀（FastAPI 登记路由时不加前缀）；路由器的 prefix 没写就是空，写了 **kw 的算不准
    const prefix = m[3] === 'FastAPI' ? '' : pf ? strVal(ctx, pf.s, pf.e) : args.some((x) => x.kw === '*') ? null : '';
    ctx.defs.push({ file, name: m[2], kind: m[3], at, line: sp.lineAt(at), mod: !m[1], end: m[1] ? blockEnd(ctx, open, m[1].length) : Infinity, prefix, mount: null });
  }
  ctx.made = factoryMade(ctx);
  for (const m of o.matchAll(DECO)) {
    const at = m.index + m[0].indexOf('@'), kind = m[2], { args, close } = callArgs(o, m.index + m[0].length - 1);
    const pa = args[0]?.kw === null ? args[0] : args.find((x) => x.kw === 'path'), h = pa && handlerAfter(o, close);
    if (!h) continue;
    const value = strVal(ctx, pa.s, pa.e), ma = args.find((x) => x.kw === 'methods'), lit = litOf(ctx, pa.s, pa.e);
    // api_route 没写 methods 的是框架默认的 GET（契约 B 节，核过 FastAPI 源码）；写了而不是字面量清单的记 ANY
    let methods = [kind === 'websocket' ? 'WS' : kind === 'api_route' ? 'GET' : kind.toUpperCase()];
    if (kind === 'api_route' && ma) {
      const items = /^[[(]/.test(o[ma.s]) && matchClose(o, ma.s) === ma.e - 1 ? splitTop(o, ma.s + 1, ma.e - 1, ',').filter(([a, b]) => a < b) : [];
      const vs = items.map(([a, b]) => litOf(ctx, a, b));
      methods = vs.length && vs.every((v) => v !== null) ? [...new Set(vs.map((v) => v.toUpperCase()))] : ['ANY'];
    }
    ctx.decos.push({ at, line: sp.lineAt(at), recv: m[1].replace(/\s+/g, ''), methods, value, handler: h.name, doc: docAt(ctx, h.body),
      path: value ?? src.slice(pa.s, pa.e).replace(/\s*\r?\n\s*/g, ' '), slash: lit !== null && lit.startsWith('/'), text: src.slice(at, close + 1) });
  }
  for (const m of o.matchAll(MOUNT)) {
    const { args, close } = callArgs(o, m.index + m[0].length - 1), via = m[2], pos = (i) => (args[i]?.kw === null ? args[i] : null);
    // include_router(乙, prefix=…)；mount(前缀, 乙)——前缀是第一个位置参数或 path=，乙是第二个位置参数或 app=
    const ya = via === 'mount' ? pos(1) ?? args.find((x) => x.kw === 'app') : pos(0) ?? args.find((x) => x.kw === 'router');
    const pf = via === 'mount' ? pos(0) ?? args.find((x) => x.kw === 'path') : args.find((x) => x.kw === 'prefix');
    const y = ya ? o.slice(ya.s, ya.e).replace(/\s+/g, '') : '';
    const prefix = pf ? strVal(ctx, pf.s, pf.e) : via === 'mount' || args.some((x) => x.kw === '*') ? null : '';
    ctx.mounts.push({ file, at: m.index, line: sp.lineAt(m.index), via, parent: m[1].replace(/\s+/g, ''), child: NAME_CHAIN.test(y) ? y : null, prefix, text: src.slice(m.index, close + 1) });
  }
  return ctx;
}

// ---- 名字 → 路由器 ----
function exported(info, file, name, depth = 0) { // 别的文件模块级的路由器；那边也是引进来的就再跟一层（最多 5 层）
  const f = info.get(file);
  if (!f || depth > 5) return null;
  const ds = f.defs.filter((d) => d.mod && d.name === name);
  if (ds.length) return ds[ds.length - 1];
  if (f.made.has(name)) return f.made.get(name);
  const t = one(f.bind.get(name));
  return t?.file ? exported(info, t.file, t.name, depth + 1) : null;
}
function lookup(info, R, file, expr, at) {
  const f = info.get(file), parts = expr.split('.');
  const ds = f.defs.filter((d) => d.name === parts[0]);
  if (parts.length === 1) {
    const near = ds.filter((d) => d.at <= at && at < d.end).pop() ?? ds.find((d) => d.mod) ?? (!ds.length && f.made.get(parts[0]));
    if (near) return near;
  }
  if (ds.length) return null;
  const t = one(f.bind.get(parts[0]));
  if (parts.length === 1) return t?.file ? exported(info, t.file, t.name) : null;
  if (t?.mod && parts.length === 2) return exported(info, t.mod, parts[1]);
  if (!t?.pkg) return null;
  const chain = parts.slice(0, -1), h = R.longest(chain, file);
  return h && h.j === chain.length ? exported(info, h.f, parts[parts.length - 1]) : null;
}
// 一路挂载的前缀（从最外层起，每一层是「甲自己的前缀 + 这处挂载写的」）+ 自己的前缀：{ v: 字符串 | null, why }。
// 应用没被挂到别处的是最外层；路由器一路往上没挂到应用上（没被挂、挂到的甲认不出、挂成了环）记 unmounted；哪一段前缀算不准记 runtime；两种都有时记 unmounted。
const UNMOUNTED = { v: null, why: 'unmounted' }, RUNTIME = { v: null, why: 'runtime' };
function full(d, seen = new Set()) {
  if (seen.has(d)) return UNMOUNTED;
  if (!d.mount) return d.kind === 'FastAPI' ? { v: d.prefix, why: null } : UNMOUNTED;
  seen.add(d);
  const m = d.mount, up = m.p ? full(m.p, seen) : UNMOUNTED;
  if (up.why === 'unmounted') return up;
  return up.v === null || m.prefix === null || d.prefix === null ? RUNTIME : { v: up.v + m.prefix + d.prefix, why: null };
}

// 填 code.routes；挂载没解析到、同一个路由器挂了多次、认不出路由器的接口并进 code.unresolved（契约 B 节）。files 同 code-imports.mjs 的 extract。
// 「没解析到的引用」的原文不带代码的行号（行号只在 line 一栏）：代码一改行号就挪，入库的页面跟着变。
export function addRoutes(code, config, root, files) {
  const info = new Map(), unresolved = [], lost = [], cut = [];
  for (const file of files) {
    if (langOf(file) !== 'python') continue;
    const src = readFileSync(join(root, file), 'utf8');
    try { cut.push({ file, src, sp: split(file, src) }); } catch (e) { if (!(e instanceof Unclosed)) throw e; } // 切不动的整个文件 code-imports.mjs 已在「没解析到的引用」里明说
  }
  const R = resolver(root, config, files, cut);
  for (const { file, src, sp } of cut) info.set(file, parseFile(file, src, sp, R));
  for (const f of info.values()) readRoutes(f, info);
  const mounts = [...info.values()].flatMap((f) => f.mounts).sort((a, b) => cmp(a.file, b.file) || a.at - b.at);
  for (const m of mounts) {
    m.p = lookup(info, R, m.file, m.parent, m.at);
    const y = m.child && lookup(info, R, m.file, m.child, m.at);
    if (m.via === 'mount') { if (y?.kind !== 'FastAPI') continue; } // mount 的乙不是本项目的应用（StaticFiles(…) 一类）：不管它，也不报
    else if (!y) { lost.push(m); continue; }
    if (y.mount) unresolved.push({ file: m.file, line: m.line, text: `${m.text}（同一个路由器挂了多次，只取第一处，在 ${y.mount.file}）` });
    else y.mount = m;
  }
  // 乙找不到：这处挂载给它下面加的前缀（甲一路的前缀 + 挂载自己的）确定是空的才不报，别的都报——甲带前缀时同样会少一段。
  for (const m of lost) {
    if (m.prefix === '' && m.p && full(m.p).v === '') continue;
    unresolved.push({ file: m.file, line: m.line, text: `${m.text}（有一处挂载没解析到，它下面的完整路径可能少一段前缀）` });
  }
  const routes = [];
  for (const f of info.values()) for (const x of f.decos) {
    const d = lookup(info, R, f.file, x.recv, x.at);
    // 认不出路由器的（函数的参数、两个分支各定义一次、外部包引进来的、赋成了别的东西的）：路径是以 / 开头的字面量就像接口，明说；
    // 不是的（@mock.patch("a.b")、@cache.get("key")）不是接口，不报。
    if (!d) { if (x.slash) unresolved.push({ file: f.file, line: x.line, text: `${x.text}（像接口，但认不出它的路由器，没进接口清单）` }); continue; }
    const up = full(d), why = up.why ?? (x.value === null ? 'runtime' : null);
    for (const method of x.methods) {
      routes.push({ file: f.file, line: x.line, method, path: x.path, fullPath: why ? null : up.v + x.value, why, handler: x.handler, doc: x.doc });
    }
  }
  code.routes = routes.sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.method, b.method));
  code.unresolved = [...code.unresolved, ...unresolved].sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.text, b.text));
  return code;
}
