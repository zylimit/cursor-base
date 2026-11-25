// notes-store.mjs —— 说明侧车 docs/readable-src/notes/ 的读写（契约 docs/readable-spec/phase1-db-contract.md G 节「存放」）。
// 只有命令写这个目录（架构稿 §3「数据所有权」）：notes.mjs 判好了写什么，落盘只经这里。
// 侧车是命令写的，读到对不上格式的只可能是有人手改过——抛 ConfigError 点名哪个文件哪一行，不猜、不跳过：
// 跳过了，那段说明在页面上就悄悄没了；猜了，手改的指纹可能被当成命令盖的。
import { existsSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync, mkdirSync, rmdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { cmp, FINGERPRINT_LEN } from './model.mjs';

export const NOTES = 'docs/readable-src/notes';
export const STATES = ['draft', 'reviewed']; // 草稿 / 已抽审；已抽审只由 note confirm 记
export const MARKER_RE = /<!--\s*readable-docs\s*:/i; // 交进来的正文里带着它就拒收（指纹只由命令算）
// 第三期加模块：module:<id> 落在 module/<id>.md，doc:arch 同 doc:db 落在 doc/ 下（第三期契约 C 节）。
const KIND_DIR = { table: 'table', column: 'table', group: 'group', doc: 'doc', module: 'module' };
const KIND_RANK = { table: 0, column: 1, group: 2, doc: 3, module: 4 }; // 一个文件里表的说明在前，列的按列名（同一前缀下即按锚点）
const FP_RE = new RegExp(`^[0-9a-f]{${FINGERPRINT_LEN}}$`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 配置、项目判断、说明侧车的格式错都是用法错，入口报退出码 2（notes.mjs 从这里转出去，入口照旧从 notes.mjs 取）。
export class ConfigError extends Error {}

export const anchorKind = (anchor) => anchor.slice(0, anchor.indexOf(':'));

// 文件名的写法同页面（契约 C 节）：小写字母、数字、下划线、连字符以外的写成「~码点」，中文名离线拷贝不乱码；
// 大写字母也转码，只差大小写的两个表名在不分大小写的文件系统上才不会落进同一个文件。
// 不需要从文件名解回名字：锚点就写在文件里，两个名字碰巧落进同一个文件也只是同住，各段仍按锚点认。
// 改推法之前按旧名落的侧车照旧读得到（loadNotes 读整个目录、按锚点认），下次 note put 那段时搬进新名的文件、旧文件里摘掉。
const slug = (name) => String(name).replace(/[^a-z0-9_-]/gu, (c) => `~${c.codePointAt(0).toString(16)}`);

// 锚点落在哪个文件（相对 notes/）：表与它各列在 table/<表>.md，组在 group/<id>.md，doc:db 在 doc/db.md，模块在 module/<id>.md。
// owner 是表名（表与列的说明）、组 id 或文档名，由调用方从文档模型里给——列锚点里的表名与列名靠点分不开。
export const fileFor = (kind, owner) => `${KIND_DIR[kind]}/${slug(owner)}.md`;

// 标记行里 by 的值：没有空白与引号的照写，否则写成 JSON 字符串；读的时候两种都认。
const attrValue = (v) => (/^[^\s"]+$/.test(v) ? v : JSON.stringify(v));
const marker = (e) => {
  const parts = [`fp=${e.fp}`, `status=${e.status}`];
  if (e.by != null) parts.push(`by=${attrValue(e.by)}`);
  if (e.on != null) parts.push(`on=${e.on}`);
  return `<!-- readable-docs: ${parts.join(' ')} -->`;
};

// 同一批说明以任何顺序交进来，落到盘上的文件逐字节相同：一个文件的内容只由其中各段排好序后决定。
export function serialize(entries) {
  return [...entries]
    .sort((a, b) => KIND_RANK[anchorKind(a.anchor)] - KIND_RANK[anchorKind(b.anchor)] || cmp(a.anchor, b.anchor))
    .map((e) => `## ${e.anchor}\n${marker(e)}\n\n${e.text}\n`).join('\n');
}

// 正文的归一：换行统一成 LF、行尾空白去掉、首尾空行去掉、连着的几个空行压成一个——空行只用来分段，几个都是一段之隔。
export function normalizeText(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/u, ''))
    .join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

function parseAttrs(s, where) {
  const out = {};
  const re = /(\w+)=("(?:[^"\\]|\\.)*"|[^\s"]+)/g;
  let m, rest = s;
  while ((m = re.exec(s))) {
    out[m[1]] = m[2].startsWith('"') ? JSON.parse(m[2]) : m[2];
    rest = rest.replace(m[0], '');
  }
  if (rest.trim()) throw new ConfigError(`${where}：标记行里有认不出的字样「${rest.trim()}」`);
  if (!FP_RE.test(out.fp ?? '')) throw new ConfigError(`${where}：fp 该是 ${FINGERPRINT_LEN} 位十六进制，现在是 ${JSON.stringify(out.fp ?? null)}`);
  if (!STATES.includes(out.status)) throw new ConfigError(`${where}：status 只认 draft 或 reviewed，现在是 ${JSON.stringify(out.status ?? null)}`);
  if (out.on != null && !DATE_RE.test(out.on)) throw new ConfigError(`${where}：on 该是 YYYY-MM-DD，现在是 ${JSON.stringify(out.on)}`);
  return { fp: out.fp, status: out.status, by: out.by ?? null, on: out.on ?? null };
}

// 一个侧车文件 → 各段 {anchor, fp, status, by, on, text, file}。rel 是相对 notes/ 的路径。
export function parseFile(text, rel) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), out = [];
  const where = (i) => `${NOTES}/${rel} 第 ${i + 1} 行`;
  let cur = null;
  const close = () => {
    if (!cur) return;
    cur.text = normalizeText(cur.body.join('\n'));
    if (!cur.text) throw new ConfigError(`${where(cur.line)}：${cur.anchor} 的正文是空的`);
    delete cur.body; delete cur.line;
    out.push(cur);
  };
  for (let i = 0; i < lines.length; i++) {
    const h = /^## (.*)$/.exec(lines[i]);
    if (!h) {
      if (cur) cur.body.push(lines[i]);
      else if (lines[i].trim()) throw new ConfigError(`${where(i)}：第一段说明之前有不属于任何锚点的文字`);
      continue;
    }
    close();
    const anchor = h[1].trim(), kind = anchorKind(anchor);
    if (!Object.hasOwn(KIND_DIR, kind) || anchor.length <= kind.length + 1) throw new ConfigError(`${where(i)}：认不出的锚点「${anchor}」`);
    if (KIND_DIR[kind] !== rel.split('/')[0]) throw new ConfigError(`${where(i)}：${anchor} 不该放在 ${rel.split('/')[0]}/ 下`);
    const mk = /^<!--\s*readable-docs:(.*)-->\s*$/.exec(lines[i + 1] ?? '');
    if (!mk) throw new ConfigError(`${where(i + 1)}：${anchor} 下面缺标记行 <!-- readable-docs: fp=… status=… -->`);
    cur = { anchor, ...parseAttrs(mk[1], where(i + 1)), text: '', file: rel, body: [], line: i };
    i++;
  }
  close();
  return out;
}

// 读整个侧车：锚点 → 那一段。目录不存在就是还没有说明。不认的文件不读，但要在标准错误上说一声。
export function loadNotes(root) {
  const base = join(root, NOTES), all = new Map();
  if (!existsSync(base)) return all;
  for (const d of readdirSync(base, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
    if (d.name.startsWith('.')) continue;
    if (!d.isDirectory() || !Object.values(KIND_DIR).includes(d.name)) { console.error(`readable-docs: ${NOTES}/${d.name} 不是说明侧车认的位置，没读`); continue; }
    for (const f of readdirSync(join(base, d.name), { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
      if (f.name.startsWith('.')) continue;
      const rel = `${d.name}/${f.name}`;
      if (!f.isFile() || !f.name.endsWith('.md')) { console.error(`readable-docs: ${NOTES}/${rel} 不是说明文件，没读`); continue; }
      for (const e of parseFile(readFileSync(join(base, rel), 'utf8'), rel)) {
        if (all.has(e.anchor)) throw new ConfigError(`${e.anchor} 的说明出现了两次：${NOTES}/${all.get(e.anchor).file} 与 ${NOTES}/${rel}`);
        all.set(e.anchor, e);
      }
    }
  }
  return all;
}

// 把 all（锚点 → 段）里落在 files 这几个文件上的内容写回去：有内容的先写临时文件再改名替换，
// 一段都不剩的删掉文件，删空的目录一并删（含 notes/ 本身），不留空文件与空目录。
// 先把所有临时文件写完、核对字节数，再逐个改名；写临时文件这一步失败，临时文件全删、原文件一个字节不动。
export function saveNotes(root, all, files) {
  const base = join(root, NOTES), byFile = new Map([...files].map((f) => [f, []]));
  for (const e of all.values()) byFile.get(e.file)?.push(e);
  const temps = [];
  try {
    for (const [rel, entries] of [...byFile].sort((a, b) => cmp(a[0], b[0]))) {
      if (!entries.length) continue;
      const abs = join(base, rel), tmp = join(dirname(abs), `.${basename(abs)}.tmp-${process.pid}`), text = serialize(entries);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(tmp, text);
      temps.push([tmp, abs]);
      if (statSync(tmp).size !== Buffer.byteLength(text)) throw new Error(`落盘核对不过：${NOTES}/${rel} 的字节数与要写的不同`);
    }
  } catch (e) {
    for (const [tmp] of temps) rmSync(tmp, { force: true });
    throw e;
  }
  for (const [tmp, abs] of temps) renameSync(tmp, abs);
  for (const [rel, entries] of byFile) if (!entries.length) rmSync(join(base, rel), { force: true });
  for (const dir of [...new Set([...byFile.keys()].map((rel) => join(base, dirname(rel))))].sort(cmp).concat(base)) {
    if (existsSync(dir) && !readdirSync(dir).length) rmdirSync(dir);
  }
}
