// links.mjs —— 把取出的事实连起来（架构稿 §2 links，只依赖 model）：写读归到表上、套项目判断的 dynamicTables、
// 标「同名的别处的表」、算分组（契约 docs/readable-spec/phase1-db-contract.md F 节）。不读磁盘：项目判断由 notes 读好、校验好交进来。
// 输出一律排好序，同一份输入两次逐字节相同（契约 C 节「确定性」）。
import { cmp } from './model.mjs';

const OTHER = { id: '_other', title: '其它' };
const UNGROUPED = { id: '_ungrouped', title: '未分组' };

// 没有分组判断时按表名第一个下划线之前的那一段分（契约 C 节，与页面现有的分法同一口径）；只有一张表的并进「其它」。
// 下划线打头的名字整段算前缀，免得前缀是空串。
export function prefixGroups(names) {
  const by = new Map();
  for (const n of [...names].sort(cmp)) {
    const i = n.indexOf('_'), k = i > 0 ? n.slice(0, i) : n;
    (by.get(k) || by.set(k, []).get(k)).push(n);
  }
  // 按 id 排序，「其它」放最后（契约 F 节）：它的 id 以下划线打头，按码点排会夹在大写与小写前缀之间。
  const groups = [...by].filter(([, v]) => v.length > 1).map(([k, v]) => ({ id: k, title: k, status: 'default', tables: v })).sort((a, b) => cmp(a.id, b.id));
  const other = [...by.values()].filter((v) => v.length === 1).flat();
  if (other.length) groups.push({ ...OTHER, status: 'default', tables: other.sort(cmp) });
  return groups;
}

// 组的先后照 tableGroups 写的先后——那是写的人排的阅读顺序，不重排；「未分组」放最后（契约 F 节）。
function mapGroups(tableGroups, names) {
  const seen = new Set(tableGroups.flatMap((g) => g.tables));
  const groups = tableGroups.map((g) => ({ id: g.id, title: g.title, status: g.status, tables: [...g.tables].sort(cmp) }));
  const rest = names.filter((n) => !seen.has(n)).sort(cmp);
  // 未分组的表是机械归进来的，不是谁的判断，档位同前缀分组记 default。
  if (rest.length) groups.push({ ...UNGROUPED, status: 'default', tables: rest });
  return groups;
}

// 同一文件里先按行，再按动作；项目判断补的条目没有行号，排在该文件的机械条目之后。
const byPlace = (a, b) => cmp(a.file, b.file) || (a.line ?? Infinity) - (b.line ?? Infinity) || cmp(a.verb ?? '', b.verb ?? '');

// facts：建表定义的事实（含代码文件里并进来的表）；scan：code-scan 的 {refs, dynamic, creates}；
// map：notes.loadMap 校验过的项目判断；ddl：配置里的 ddl 清单（这些文件里的建表语句不算「同名的别处的表」）。
export function link(facts, scan, map, ddl) {
  const tables = facts.tables.map((t) => t.name), inDdl = new Set(ddl.map((f) => f.replace(/\\/g, '/')));
  // 同名的别处的表：一个不在 ddl 里的文件自己建了同名的表（带 TEMP 的也算——会话里它遮住主库那张），它对这个名字的读写照记、带上标记。
  const same = new Set(scan.creates.filter((c) => !inDdl.has(c.file)).map((c) => `${c.file}\0${c.name.toLowerCase()}`));
  const sameName = (file, table) => same.has(`${file}\0${table.toLowerCase()}`);

  const usage = {};
  for (const n of [...tables, ...facts.views.map((v) => v.name)].sort(cmp)) usage[n] = { writes: [], reads: [] };
  const dedup = new Set();
  for (const r of scan.refs) {
    // 同一行同一动作点了同一张表两次（比如自连接）只记一处：页面按行号列，重复的行号只添乱。
    const key = `${r.file}\0${r.line}\0${r.verb}\0${r.table}\0${r.read}`;
    if (dedup.has(key) || !usage[r.table]) continue;
    dedup.add(key);
    const e = r.read ? { file: r.file, line: r.line, sameNameDdl: sameName(r.file, r.table) }
      : { file: r.file, line: r.line, verb: r.verb, sameNameDdl: sameName(r.file, r.table) };
    usage[r.table][r.read ? 'reads' : 'writes'].push(e);
  }
  // 项目判断把一个文件里运行时拼的表名归到具体的表上：契约给的条目形状里没有档位，这里多带一个 judged（proposed / confirmed），
  // 只有这种条目带；没有行号与动作，写 null。
  for (const d of map.dynamicTables) {
    for (const t of d.writes) usage[t]?.writes.push({ file: d.file, line: null, verb: null, sameNameDdl: sameName(d.file, t), judged: d.status });
    for (const t of d.reads) usage[t]?.reads.push({ file: d.file, line: null, sameNameDdl: sameName(d.file, t), judged: d.status });
  }
  for (const u of Object.values(usage)) { u.writes.sort(byPlace); u.reads.sort(byPlace); }

  const assigned = new Set(map.dynamicTables.map((d) => d.file));
  const dynamic = scan.dynamic.map((d) => ({ file: d.file, line: d.line, verb: d.verb, head: d.head, assigned: assigned.has(d.file) }))
    .sort((a, b) => byPlace(a, b) || cmp(a.head, b.head));

  // 代码里建的表：带 TEMP 的不算；ddl 里列了的代码文件，并进表清单的那几条（同文件、同行、同名）不再列。
  const merged = new Set(facts.tables.map((t) => `${t.file}\0${t.line}\0${t.name}`));
  const ct = new Set();
  const codeTables = scan.creates.filter((c) => !c.temp && !merged.has(`${c.file}\0${c.line}\0${c.name}`))
    .map((c) => ({ file: c.file, line: c.line, name: c.name }))
    .filter((c) => { const k = `${c.file}\0${c.line}\0${c.name}`; if (ct.has(k)) return false; ct.add(k); return true; })
    .sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.name, b.name));

  // 提到了表名、像 SQL 又不像的（契约 F 节）：不算进写读，同一行同一动作同一张表只留一条，同样排好序。
  const seen = new Set();
  const ambiguous = (scan.ambiguous ?? []).map((a) => ({ file: a.file, line: a.line, verb: a.verb, table: a.table, head: a.head }))
    .filter((a) => { const k = `${a.file}\0${a.line}\0${a.verb}\0${a.table}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => byPlace(a, b) || cmp(a.table, b.table) || cmp(a.head, b.head));

  const groups = map.tableGroups ? mapGroups(map.tableGroups, tables) : prefixGroups(tables);
  return { groups, usage, dynamic, codeTables, ambiguous };
}
