// init.mjs —— 入口的两件独立的事：走项目里的文件（walk），与 init 起草 docs/readable-src/config.json（契约 docs/readable-spec/phase1-db-contract.md A 节）。
// 原在入口 readable-docs.mjs，2026-11-23 第三期 Task 3.4 原样搬来：入口要给架构这一份腾地方，单个文件别超过三百行。
// walk 也给 build 用（取代码文件、建表定义）；init 与 init --suggest（配置跟上项目，契约 I 节第 5 条）只在这里，两者共用同一套找法。
import { existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, basename, dirname, posix } from 'node:path';
import { cmp } from './model.mjs';
import { CONFIG, loadConfig } from './config.mjs';
import { globRe } from './arch-map.mjs'; // ignore 与模块的 paths 同一套通配（第三期契约 A 节）

// 后三条是测试文件与代码放在一起的写法（第三期契约 A 节）：不排掉，模块图上全是测试库。已有的配置不替人改。
const DEFAULT_IGNORE = ['**/tests/**', '**/node_modules/**', '**/*.test.*', '**/*.spec.*', '**/__tests__/**'];
const ARCH_DOC_FILE = 'Architecture-Design.md'; // init 在根目录有它时填进 archDocs
const CODE_EXT = /\.(py|ts|tsx)$/;
// 契约 A 节：ddl 依次找这三类，同一目录按文件名排序；三类都收、按这个先后排、去重——
// 只取先找到的一类会漏掉排在后面的迁移文件，漏表是这一层最贵的错；多收的在配置里一眼看得见、可删。
// sql/ 与 migrations/ 在任意深度都认：有的项目的建表文件在 <项目名>/sql/ 下按编号排（001_*.sql、002_*.sql…），只找根目录下的 sql/ 一张表都找不到。
const DDL_PATTERNS = [
  ['**/schema.sql', (f) => f.split('/').pop() === 'schema.sql'],
  ['**/sql/*.sql', (f) => /(?:^|\/)sql\/[^/]+\.sql$/.test(f)],
  ['**/migrations/*.sql', (f) => /(?:^|\/)migrations\/[^/]+\.sql$/.test(f)],
];

// 项目里的文件（相对路径、/ 分隔、按名字定序）。点开头的文件与目录、__pycache__ 目录不进，也不报数：.git、.venv、.claude 里的
// 不是项目的来源（cc-base 自己的 .claude/tests 里就有 SQL 夹具）；编译缓存不入库，算进去的话同一份代码在跑过与没跑过的副本上
// 出两样的页面（第三期契约 B 节「文件」）。符号链接不跟，免得绕圈。sub 给了就只走那个子目录，路径仍相对 root。
export function walk(root, ignore, sub = '') {
  const res = ignore.map(globRe), skip = (rel) => res.some((r) => r.test(rel)), out = [];
  const visit = (dir, rel) => {
    for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
      if (d.name.startsWith('.') || (d.name === '__pycache__' && d.isDirectory())) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { if (!skip(`${r}/`)) visit(join(dir, d.name), r); }
      else if (d.isFile() && !skip(r)) out.push(r);
    }
  };
  const start = sub.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
  visit(start ? join(root, start) : root, start);
  return out;
}

// 每个顶层目录里有几个 .py / .ts / .tsx（根目录下直接放的不算进任何目录）。
function codeCounts(files) {
  const n = new Map();
  for (const f of files) {
    const k = f.indexOf('/');
    if (k > 0 && CODE_EXT.test(f)) n.set(f.slice(0, k), (n.get(f.slice(0, k)) || 0) + 1);
  }
  return n;
}

// codeRoots：含 .py / .ts / .tsx 最多的两个顶层目录（契约 A 节），同数按名字。
const topCodeDirs = (files) => [...codeCounts(files)].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 2).map(([d]) => d);
// ddl：三类依次找、各自按文件名排、去重（契约 A 节）。
const findDdl = (files) => [...new Set(DDL_PATTERNS.flatMap(([, hit]) => files.filter(hit).sort(cmp)))];

export function cmdInit(o) {
  const p = join(o.root, CONFIG);
  if (existsSync(p)) {
    if (o.json) process.stdout.write(`${JSON.stringify({ created: false, path: CONFIG, message: '配置已存在' })}\n`);
    else console.log(`配置已存在：${CONFIG}（一个字节没动）`);
    return;
  }
  const files = walk(o.root, DEFAULT_IGNORE);
  const ddl = findDdl(files);
  const spec = existsSync(join(o.root, 'Product-Spec.md')) ? 'Product-Spec.md' : null;
  const archDocs = existsSync(join(o.root, ARCH_DOC_FILE)) ? [ARCH_DOC_FILE] : [];
  const cfg = { version: 1, title: basename(resolve(o.root)), spec, ddl, codeRoots: topCodeDirs(files), ignore: DEFAULT_IGNORE, archDocs };
  const notes = [];
  if (!ddl.length) notes.push(`ddl 没找到建表定义文件（依次找过 ${DDL_PATTERNS.map(([g]) => g).join('、')}），写成空数组，请手填`);
  if (!spec) notes.push('根目录没有 Product-Spec.md，spec 写成 null');
  if (!cfg.codeRoots.length) notes.push('没找到含 .py / .ts / .tsx 文件的顶层目录，codeRoots 写成空数组');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`, { flag: 'wx' }); // wx：万一同时有人建了，宁可报错也不覆盖
  if (o.json) { process.stdout.write(`${JSON.stringify({ created: true, path: CONFIG, config: cfg, notes })}\n`); return; }
  console.log(`已起草 ${CONFIG}（title：${cfg.title}）`);
  console.log(`  ddl（按执行顺序，${ddl.length} 个）：`);
  ddl.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
  console.log(`  codeRoots：${cfg.codeRoots.join('、') || '（空）'}`);
  notes.forEach((t) => console.log(`  提示：${t}`));
}

// init --suggest（契约 I 节第 5 条）：新项目先有需求规格、后有代码，配置是在还没有代码时起草的；建表文件与代码目录后来才冒出来，
// 没人把它们填进配置，数据库设计与架构设计就一直是空的。这里照现在的项目把起草重做一遍、与配置比，只报漏了什么，一个字节不改。
// 误报比漏报伤人：提交前每次都提醒一条不该补的，人就不看了。所以走文件用配置自己的 ignore（排掉的不算漏），
// 顶层目录至少 MIN_CODE_FILES 个代码文件才报，已经有代码根在它里面的不报（多半是有意只取一部分）。
const MIN_CODE_FILES = 3;
const SPEC_FILE = 'Product-Spec.md';
// 配置里手写的路径先规范化再比：./db/schema.sql、db//schema.sql、反斜杠、末尾的 / 与走出来的 db/schema.sql 是同一个。
const norm = (p) => posix.normalize(p.replace(/\\/g, '/')).replace(/(.)\/+$/, '$1');

export function suggest(root) {
  const cfg = loadConfig(root); // 配置不在：ConfigError「先跑 init」，入口报退出码 2
  const files = walk(root, cfg.ignore);
  const listed = new Set(cfg.ddl.map(norm)), roots = cfg.codeRoots.map(norm);
  const ddl = findDdl(files).filter((f) => !listed.has(f)).sort(cmp);
  // 代码根是 . 时整个项目都扫到了，哪个顶层目录都不算漏。
  const covered = (d) => roots.some((r) => r === '.' || r === d || r.startsWith(`${d}/`));
  const codeRoots = [...codeCounts(files)].filter(([d, n]) => n >= MIN_CODE_FILES && !covered(d)).map(([d]) => d).sort(cmp);
  const spec = cfg.spec == null && files.includes(SPEC_FILE) ? SPEC_FILE : null;
  const archDocs = files.includes(ARCH_DOC_FILE) && !cfg.archDocs.map(norm).includes(ARCH_DOC_FILE) ? [ARCH_DOC_FILE] : [];
  return { ok: !ddl.length && !codeRoots.length && !spec && !archDocs.length, missing: { ddl, codeRoots, spec, archDocs } };
}

// 人读输出一样一行，每行写清漏的是哪个文件、哪个目录、该填进配置的哪一项；退出码 0 没有差别、1 有差别。
export function cmdSuggest(o) {
  const r = suggest(o.root), m = r.missing;
  if (o.json) process.stdout.write(`${JSON.stringify(r)}\n`);
  else if (r.ok) console.log('配置跟得上项目，没有漏项');
  else {
    if (m.ddl.length) console.log(`ddl 漏了 ${m.ddl.length} 个建表定义文件：${m.ddl.join('、')}（按执行顺序填进 ${CONFIG} 的 ddl；不该算的写进 ignore）`);
    if (m.codeRoots.length) console.log(`codeRoots 漏了 ${m.codeRoots.length} 个顶层目录：${m.codeRoots.join('、')}（里面有 ${MIN_CODE_FILES} 个以上代码文件、没有代码根；填进 ${CONFIG} 的 codeRoots，不该算的写进 ignore）`);
    const docs = [m.spec ? `spec 是 null，根目录却有 ${m.spec}（填进 spec）` : null, ...m.archDocs.map((f) => `archDocs 里没有根目录的 ${f}（填进 archDocs）`)].filter(Boolean);
    if (docs.length) console.log(`${docs.join('；')}（都在 ${CONFIG}）`);
  }
  process.exitCode = r.ok ? 0 : 1;
}
