// model.mjs —— 文档模型：实体的形状、锚点、规范形与指纹（架构稿 docs/readable-spec/Architecture-Design.md §2 model、§4）。
// 各取事实器只经这里收尾成实体，保证不同来源产出的实体形状相同（架构稿 §14 里氏替换）；本文件不依赖任何别的模块。
// 规范形不含出处（文件与行）与锚点：2026-11-22 定——表上方插一行注释，下面每张表的行号都会变；行号若进指纹，
// 挂在这些表上的说明会一夜全标「待更新」（架构稿 §11「指纹粒度定错」那条风险）。
import { createHash } from 'node:crypto';

export const FINGERPRINT_LEN = 12; // 契约 B 节：SHA-256 取前 12 位十六进制
export const EXCERPT_LEN = 80; // 契约 B 节：清单里给语句的前 80 个字符
export const OVERLOAD_LEN = 6; // 契约 B 节：同名重载的函数，锚点后面接参数原文指纹的前 6 位

// 按码元比较，不用 localeCompare：后者随 ICU 与系统区域变，两台机器排出的顺序可能不同，违背「两次生成逐字节相同」。
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const tableAnchor = (table) => `table:${table}`;
export const columnAnchor = (table, column) => `column:${table}.${column}`;
export const viewAnchor = (view) => `view:${view}`;
// 说明还挂在这两种锚点上（契约 G 节）：组的 id 取自文档模型的 groups，文档第一期只有 doc:db。
export const groupAnchor = (id) => `group:${id}`;
export const docAnchor = (doc) => `doc:${doc}`;
// 架构设计（第三期契约 C 节）：模块的说明挂在 module:<模块 id> 上，整个系统的导读是 doc:arch。
export const moduleAnchor = (id) => `module:${id}`;
// 需求规格的块（第二期契约 docs/readable-spec/phase2-spec-contract.md B 节）：显式编号 req:<编号>；列表项开头是粗体词的
// spec:<章节路径>/<粗体词>；别的 spec:<章节路径>#<在本章里的序号>。章节路径是它上面各级标题的文字，用 / 连。
// 同一个锚点第 k 次出现（k ≥ 2）接 ~k，第一次的不带后缀——先出现的那条锚点不因为后面多写了一条同名的而变。
export const reqAnchor = (id) => `req:${id}`;
export const specBoldAnchor = (path, word) => `spec:${path.join('/')}/${word}`;
export const specSeqAnchor = (path, n) => `spec:${path.join('/')}#${n}`;
export const nthAnchor = (anchor, k) => (k === 1 ? anchor : `${anchor}~${k}`);

// 按码点截而不按 UTF-16 码元：中文注释里偶有四字节字符，按码元截会切出半个代理对，落进 JSON 成了乱码。
export const excerpt = (text) => Array.from(text.slice(0, EXCERPT_LEN * 2)).slice(0, EXCERPT_LEN).join('');

// 固定键序的序列化：对象的键按码元排序，数组保持原序，undefined 一律当 null。
export function canonical(v) {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    return `{${Object.keys(v).sort(cmp).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export const fingerprint = (v) => createHash('sha256').update(canonical(v), 'utf8').digest('hex').slice(0, FINGERPRINT_LEN);

// args 为 null（不重名）时锚点就是 function:<名>；同名重载的接 #<参数原文指纹前 6 位>，比如 function:order_total#a1b2c3。
export const functionAnchor = (fn, args = null) => (args === null ? `function:${fn}` : `function:${fn}#${fingerprint(args).slice(0, OVERLOAD_LEN)}`);

// build --facts-json 打出的就是这个形状（契约 B 节末尾），键序固定。
export const emptyFacts = () => ({ tables: [], views: [], functions: [], unfolded: [], unparsed: [], conflicts: [], orphanAlters: [] });

// 列的规范形是它自己的定义加注释（契约 B 节「指纹」）；约束与索引的规范形同理，只去掉出处。
// generated（标识列、生成列的原文）只在有的时候进规范形：没有它的列，指纹与加这个键之前逐位相同，挂在上面的东西不会因为本脚本升级全变。
function columnForm(c) {
  const form = {
    name: c.name, type: c.type, nullable: c.nullable, default: c.default, primaryKey: c.primaryKey,
    unique: c.unique, references: c.references, check: c.check, comment: c.comment,
  };
  if (c.generated != null) form.generated = c.generated;
  return form;
}
const constraintForm = (c) => ({
  name: c.name, type: c.type, columns: c.columns, references: c.references, check: c.check, comment: c.comment, raw: c.raw,
});
const indexForm = (x) => ({
  name: x.name, unique: x.unique, method: x.method, columns: x.columns, options: x.options, where: x.where,
});
// 约束与索引按名字排序（契约 B 节）；没名字的排前面，再按规范形定序，保证同样的输入排出同样的顺序。
const byName = (form) => (a, b) => cmp(a.name ?? '', b.name ?? '') || cmp(canonical(form(a)), canonical(form(b)));

// 改动备注（契约 B 节「建表之后的改动」）按出现顺序原样带上；不进表的规范形——它讲的是改动的来由，不是现行结构。
// file 是那条 ALTER 所在的文件，不一定是建表的那份。
const changeForm = (x) => ({ file: x.file ?? null, line: x.line, comment: x.comment, addedColumns: [...x.addedColumns] });

// 取事实器合并完的表（任意可迭代的 {name,file,line,comment,columns,constraints,indexes,changes?}）→ 按名字排好、盖好锚点与指纹的实体。
// 表级约束的 name 只是源码里写了的名字，没写的为 null（补出来的内部名不进这里，契约 B 节）；没有改动备注的表 changes 为空数组。
// maybeDropped（按名字删约束却没对上、之后也没再加同名的）同 changes 不进指纹：它说的是来源里一条语句，不是现行结构。
export function finalizeTables(tables) {
  return [...tables].sort((a, b) => cmp(a.name, b.name)).map((t) => {
    const columns = t.columns.map((c) => {
      const form = columnForm(c);
      return {
        anchor: columnAnchor(t.name, c.name), name: c.name, type: c.type, nullable: c.nullable, default: c.default, primaryKey: c.primaryKey,
        unique: c.unique, references: c.references, check: c.check, generated: c.generated ?? null, comment: c.comment,
        file: c.file, line: c.line, fingerprint: fingerprint(form),
      };
    });
    const constraints = [...t.constraints].sort(byName(constraintForm)).map((c) => ({ ...constraintForm(c), file: c.file, line: c.line }));
    const indexes = [...t.indexes].sort(byName(indexForm)).map((x) => ({ ...indexForm(x), file: x.file, line: x.line }));
    const form = {
      name: t.name, comment: t.comment, columns: t.columns.map(columnForm),
      constraints: constraints.map(constraintForm), indexes: indexes.map(indexForm),
    };
    return {
      anchor: tableAnchor(t.name), name: t.name, file: t.file, line: t.line, comment: t.comment,
      columns, constraints, indexes, changes: (t.changes ?? []).map(changeForm),
      maybeDropped: (t.maybeDropped ?? []).map((d) => ({ file: d.file, line: d.line, name: d.name })), fingerprint: fingerprint(form),
    };
  });
}

// 视图与数据库函数只带名字、出处与原文（契约 B 节末尾的形状），按名字排序；同名的函数（重载）再按签名定序。
// 函数的 args 是参数原文（压成一行），只在同名的不止一个时拿来算锚点后缀；它本身不进输出。视图的 materialized：物化视图为 true。
export const finalizeViews = (views) => [...views].sort((a, b) => cmp(a.name, b.name))
  .map((v) => ({ anchor: viewAnchor(v.name), name: v.name, file: v.file, line: v.line, sql: v.sql, materialized: v.materialized === true }));
export function finalizeFunctions(fns) {
  const list = [...fns], seen = new Map();
  list.forEach((f) => seen.set(f.name, (seen.get(f.name) ?? 0) + 1));
  return list.sort((a, b) => cmp(a.name, b.name) || cmp(a.signature, b.signature)).map((f) => ({
    anchor: functionAnchor(f.name, seen.get(f.name) > 1 ? f.args ?? '' : null), name: f.name, file: f.file, line: f.line, signature: f.signature,
  }));
}
