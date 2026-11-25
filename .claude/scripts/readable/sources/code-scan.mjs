// code-scan.mjs —— 代码里的 SQL：谁写谁读、表名是运行时拼的、代码里建的表（契约 docs/readable-spec/phase1-db-contract.md F 节）。
// 先把源码切成字符串字面量与其它，只在字面量里认 SQL：注释、import 行里碰巧出现的表名不算——读者会照着去改一个不相干的文件，
// 这是这一层最贵的错之一；另一种是悄悄漏掉一类写法，所以切不动的文件整个进「没扫成的文件」，不出半截结果。
// 只出事实（文件、行、动作、名字）；写读归到哪张表、同名的别处的表怎么标、项目判断怎么套，在 links.mjs。
// 实数（2026-11-23，conflation 后端非测试代码）：SQL 全写在字符串里、关键字全大写——INSERT INTO 161 处、FROM 约 1287 处、
// JOIN 447 处，copy_records_to_table( 写表 11 处（表名常在下一行），表名运行时拼的 18 处。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { excerpt } from '../model.mjs';
import { lex, statements } from './sql-lex.mjs'; // 只给 ddlSegments 切语句用，同建表定义的取事实器一个切法
// 切字面量（Python 与 JS 一族分清代码、字符串、注释）在 code-lex.mjs，与认引用的 code-imports.mjs 共用一份（2026-11-23 Task 3.1 搬出）
import { Unclosed, sticky, split, lineOf } from './code-lex.mjs';

export const isCodeFile = (f) => /\.(?:py|tsx?|jsx?|mjs)$/.test(f);

// ---- 字面量里的 SQL ----
// 一个正则认全部动词，交替的先后让 DELETE FROM 先于 FROM 被认走（DELETE FROM 里的 FROM 不算读）。关键字不分大小写（别的项目的 SQL 可能是小写）。
const VERB = /\b(?:(INSERT\s+INTO)|(UPDATE)|(DELETE\s+FROM)|(TRUNCATE(?:\s+TABLE)?)|(COPY)|(MERGE\s+INTO)|(FROM)|(JOIN)|CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(TEMP|TEMPORARY)\s+|UNLOGGED\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?)(?![\w$])/gi;
const VERBS = ['insert', 'update', 'delete', 'truncate', 'copy', 'merge', 'select', 'select'];
// UPDATE 前面是这些词时不是「改表」：FOR [NO KEY] UPDATE 是加锁、ON CONFLICT … DO UPDATE SET 后面是 SET、ON UPDATE 是外键动作、触发器的 BEFORE / AFTER / OR / OF UPDATE。
const NOT_UPDATE = new Set(['FOR', 'KEY', 'DO', 'ON', 'BEFORE', 'AFTER', 'OR', 'OF']);
const NOT_FROM = new Set(['DISTINCT']); // IS [NOT] DISTINCT FROM 是比较，不是读表
const prevWord = (s, i) => /([A-Za-z_]+)\s*$/.exec(s.slice(Math.max(0, i - 40), i))?.[1].toUpperCase() ?? '';
const NAME_PART = /\\?"([^"\\]+)\\?"|([A-Za-z_\u0080-￿][\w$\u0080-￿]*)/y;
const DOT = /\s*\.\s*/y;
const fold = (s) => s.replace(/[A-Z]+/g, (x) => x.toLowerCase()); // 同 PostgreSQL：不带引号的名字只折 ASCII 字母

// 名字（可带双引号与模式前缀，前缀丢弃）：返回 {name, p}，不是名字返回 null。
function qname(s, p) {
  let name = null;
  for (;;) {
    NAME_PART.lastIndex = p; const m = NAME_PART.exec(s); if (!m) return name && { name, p };
    name = m[1] ?? fold(m[2]); p = NAME_PART.lastIndex;
    DOT.lastIndex = p; if (!DOT.exec(s)) return { name, p };
    p = DOT.lastIndex;
  }
}
// 占位：{…}（f 串与 .format）、${…}（模板）、%s、%(名)s。返回占位之后的位置，不是占位返回 -1。
function placeholder(s, p) {
  const b = s.startsWith('${', p) ? p + 1 : s[p] === '{' ? p : -1;
  if (b >= 0) { for (let k = b, d = 0; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}' && --d === 0) return k + 1; } return s.length; }
  const m = sticky(/%(?:\([^)\s]*\))?s/y, s, p);
  return m ? p + m.length : -1;
}
// 动词后面的东西：{kind:'name',name,p} / {kind:'ph',p}（占位；占位后面紧跟 .名字 的是运行时的模式前缀，名字照认）/ {kind:'end'} / null
function target(s, p) {
  p += sticky(/\s*/y, s, p).length;
  const only = sticky(/ONLY\s+/iy, s, p); if (only) p += only.length;
  if (p >= s.length) return { kind: 'end' };
  const ph = placeholder(s, p);
  if (ph >= 0) {
    const dot = sticky(DOT, s, ph), r = dot && qname(s, ph + dot.length);
    return r ? { kind: 'name', ...r } : { kind: 'ph', p: ph };
  }
  const r = qname(s, p);
  return r && { kind: 'name', ...r };
}
const LIST_ALIAS = /\s*(?:(?:AS\s+)?(?!(?:WHERE|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|ON|USING|GROUP|ORDER|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|WINDOW|HAVING|FOR|RETURNING|SET|VALUES|LATERAL)\b)[A-Za-z_][\w$]*)?\s*,/iy;
const COPY_FROM = /\s*(?:\([^)]*\)\s*)?FROM\b/iy;

// ---- 小写的动词要像 SQL 才算（契约 F 节）----
// 动词全大写的照认：DELETE FROM orders 出现在散文里的可能很小。小写或大小写混写的，可能是真 SQL，也可能是日志、报错、文档串里的一句话
// （log.info("failed to delete from orders, will retry")），所以要看表名之后像不像语句的下文；不像的进 ambiguous，不悄悄丢——万一是没见过的写法。
// 下文按 PostgreSQL 的语法逐个动词收窄：UPDATE 表 [别名] 之后只能是 SET，INSERT INTO 表 的别名必须带 AS，MERGE INTO 表 之后是 USING……
// 「Never update orders here; reads only.」里 here 读成别名，分号也接不上 UPDATE。逗号只在读的表清单里算，逗号后面还得是名字、再接下文；
// 清单里带了别名的那一项不许以字面量结尾收场（「from orders, will retry」里 will 后面跟 retry 就到头了，是一句话）。COPY 表 FROM 另有 COPY_FROM 卡着。
const WS = String.raw`(?:\s|\\[ntr])`; // 字面量是源码原文，里面的 \n 转义也算空白
const RESERVED = 'WHERE|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|ON|USING|GROUP|ORDER|LIMIT|OFFSET|FETCH|UNION|EXCEPT|INTERSECT|WINDOW|HAVING|FOR|'
  + 'RETURNING|SET|VALUES|SELECT|DEFAULT|OVERRIDING|WITH|TABLESAMPLE|RESTART|CONTINUE|CASCADE|RESTRICT|AND|OR|NOT|AS|TABLE|FROM|INTO|IS|IN|BY|WHEN|THEN|ELSE|END';
const ALIAS_WORD = `(?!(?:${RESERVED})\\b)[A-Za-z_][\\w$]*`;
const ALIAS = new RegExp(`(?:${WS}+(?:AS${WS}+)?${ALIAS_WORD})?`, 'iy'), ALIAS_AS = new RegExp(`(?:${WS}+AS${WS}+${ALIAS_WORD})?`, 'iy');
const re = (s) => new RegExp(`(?:${s})`, 'iy');
const FOLLOW = {
  insert: { alias: ALIAS_AS, next: re(`${WS}*\\(|${WS}+(?:VALUES|SELECT|DEFAULT|OVERRIDING|WITH)\\b`) },
  update: { alias: ALIAS, next: re(`${WS}+SET\\b`) },
  delete: { alias: ALIAS, next: re(`${WS}*[;)]|${WS}+(?:WHERE|USING|RETURNING)\\b`) },
  truncate: { alias: re(''), next: re(`${WS}*;|${WS}+(?:RESTART|CONTINUE|CASCADE|RESTRICT)\\b`) },
  merge: { alias: ALIAS, next: re(`${WS}+USING\\b`) },
  select: { alias: ALIAS, next: re(`${WS}*[;()]|${WS}+(?:WHERE|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|ON|USING|GROUP|ORDER|LIMIT|OFFSET|FETCH|UNION|EXCEPT|INTERSECT|WINDOW|HAVING|FOR|RETURNING|TABLESAMPLE)\\b`) },
};
const LIT_END = new RegExp(`${WS}*$`, 'y');
const SQL_NAME = String.raw`(?:"[^"\\]+"|[A-Za-z_][\w$]*)`;
const COMMA_NAME = new RegExp(`${WS}*,${WS}*${SQL_NAME}(?:${WS}*\\.${WS}*${SQL_NAME})*`, 'iy');
function sqlLike(verb, s, p) {
  const f = FOLLOW[verb]; if (!f) return true;
  for (let first = true; ;first = false) {
    const a = sticky(f.alias, s, p) ?? '', q = p + a.length;
    if (sticky(f.next, s, q) !== null) return true;
    if (sticky(LIT_END, s, q) !== null) return first || !a;
    const c = verb === 'select' && sticky(COMMA_NAME, s, q);
    if (!c) return false;
    p = q + c.length;
  }
}

// 一个文件的事实：refs（已知表的写读）、dynamic（表名运行时拼的）、creates（字面量里的 CREATE TABLE，带 temp 标记）、
// ambiguous（小写的动词提到了已知的表、后面却不像 SQL 的）。
function scanSplit(file, src, sp, known) {
  const refs = [], dynamic = [], creates = [], ambiguous = [];
  const flat = (a, b) => excerpt(src.slice(a, Math.min(b, a + 400)).replace(/\s+/g, ' ').trim());
  const ref = (off, verb, name, read) => { const t = known.get(name.toLowerCase()); if (t) refs.push({ file, line: sp.lineAt(off), verb, table: t, read }); };
  // 那一段的开头：字面量的开头，或动词所在那一行的行首（长文档串里动词在第几行，从串头截八十个字看不到它）
  const amb = (off, verb, name, lit) => { const t = known.get(name.toLowerCase()); if (t) ambiguous.push({ file, line: sp.lineAt(off), verb, table: t, head: flat(Math.max(lit.start, src.lastIndexOf('\n', off - 1) + 1), lit.end) }); };
  const dyn = (off, verb, lit) => dynamic.push({ file, line: sp.lineAt(off), verb, head: flat(lit.start, lit.end) });
  for (const lit of sp.lits) {
    const s = src.slice(lit.bs, lit.be);
    if (!/[A-Za-z]/.test(s)) continue;
    for (const m of s.matchAll(VERB)) {
      const k = m.slice(1, 9).findIndex((g) => g !== undefined), off = lit.bs + m.index, after = m.index + m[0].length;
      if (k < 0) { const t = target(s, after); if (t?.kind === 'name') creates.push({ file, line: sp.lineAt(off), name: t.name, temp: m[9] !== undefined }); continue; }
      const verb = VERBS[k], read = k >= 6, upper = m[0] === m[0].toUpperCase();
      if (k === 1 && NOT_UPDATE.has(prevWord(s, m.index))) continue;
      if (k === 6 && NOT_FROM.has(prevWord(s, m.index))) continue;
      let t = target(s, after);
      if (t?.kind === 'end') {
        // 字面量到动词就结束：后面接 + 或紧挨着另一个字面量（Python 的隐式拼接）才算拼接；接的是字面量就接着在它开头认名字。
        // 别的（比如整个串就是 'update'、或者 … FOR UPDATE 收尾）不是在拼表名，不记。
        let p = lit.end + sticky(/(?:\s|\\\n)*/y, sp.other, lit.end).length;
        const plus = sp.other[p] === '+';
        if (plus) p += 1 + sticky(/(?:\s|\\\n)*/y, sp.other, p + 1).length;
        const nx = sp.byStart.get(p);
        if (!plus && !nx) continue;
        const nxs = nx && src.slice(nx.bs, nx.be);
        t = nx ? target(nxs, 0) : { kind: 'ph' };
        if (t?.kind === 'end') t = { kind: 'ph' };
        if (t) { t.fs = nxs; t.fp = t.p; t.p = Infinity; } // 名字在下一个字面量里：逗号续表、COPY 后面的 FROM 都不往下追；像不像 SQL 在那个字面量里看
      }
      if (!t) continue;
      if (k === 4 && Number.isFinite(t.p) && !sticky(COPY_FROM, s, t.p)) continue; // 只认 COPY 表 FROM；COPY 表 TO 是导出
      if (t.kind === 'ph') { dyn(off, verb, lit); continue; }
      if (!upper && !sqlLike(verb, t.fs ?? s, t.fs ? t.fp : t.p)) { amb(off, verb, t.name, lit); continue; }
      ref(off, verb, t.name, read);
      // FROM 后面逗号连着的几张表都算；TRUNCATE 可以一次清几张
      if (k !== 3 && k !== 6) continue;
      for (let p = t.p; p < s.length;) {
        const sep = k === 6 ? sticky(LIST_ALIAS, s, p) : sticky(/\s*,/y, s, p); if (!sep) break;
        const nt = target(s, p + sep.length); if (!nt || nt.kind === 'end') break;
        if (nt.kind === 'ph') { dyn(off, verb, lit); break; }
        ref(off, verb, nt.name, read); p = nt.p;
      }
    }
  }
  // 接口调用（写在代码里，不在字面量里）：第一个实参是字面量的算对那张表的写（copy_from_table 算读），不是字面量的进「运行时拼的」。
  for (const m of sp.other.matchAll(/\b(copy_records_to_table|copy_to_table|copy_from_table)\s*\(/g)) {
    let p = m.index + m[0].length;
    p += sticky(/\s*(?:table_name\s*=\s*)?/y, sp.other, p).length;
    const lit = sp.byStart.get(p), read = m[1] === 'copy_from_table', off = m.index;
    const t = lit && target(src.slice(lit.bs, lit.be), 0);
    if (t?.kind === 'name') ref(off, read ? 'select' : 'copy', t.name, read);
    else dynamic.push({ file, line: sp.lineAt(off), verb: read ? 'select' : 'copy', head: flat(off, src.indexOf(')', off) + 1 || src.length) });
  }
  return { refs, dynamic, creates, ambiguous };
}

// 架构稿 §2 的 extract：files 是 codeRoots 下去掉 ignore 的代码文件（入口列好），names 是建表定义里有的表名与视图名。
export function extract(config, root, files, names) {
  const known = new Map(names.map((n) => [n.toLowerCase(), n]));
  const res = { refs: [], dynamic: [], creates: [], ambiguous: [], unscanned: [] };
  for (const file of files) {
    const src = readFileSync(join(root, file), 'utf8');
    let sp;
    try { sp = split(file, src); }
    catch (e) {
      if (!(e instanceof Unclosed)) throw e;
      res.unscanned.push({ file, reason: `有一处${e.message}没有闭合，整个文件没扫` }); // 原因要上页面，不带代码的行号（第一期契约 F 节）
      continue;
    }
    const r = scanSplit(file, src, sp, known);
    res.refs.push(...r.refs); res.dynamic.push(...r.dynamic); res.creates.push(...r.creates); res.ambiguous.push(...r.ambiguous);
  }
  return res;
}

// 配置的 ddl 列了代码文件时（契约 F 节）：含 CREATE TABLE / ALTER TABLE / CREATE INDEX 的字面量切成语句，
// 只把以 CREATE TABLE / ALTER TABLE / CREATE [UNIQUE] INDEX 开头的语句交给建表定义的取事实器——一段说明文字里顺口提到这几个词的，
// 整段交过去只会在「未解析的语句」里平添一条噪声。别的语句原地换成空格（换行与分号留着）：行号、上方注释的归属与整段交时一样。
// 每段带上它在代码文件里起始的行号。切不动返回 error，由调用方记进「未解析的语句」。
const DDL_IN = /\b(?:CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+TABLE|ALTER\s+TABLE)\b/i;
const DDL_HEAD = [['CREATE', 'TABLE'], ['CREATE', 'INDEX'], ['CREATE', 'UNIQUE', 'INDEX'], ['ALTER', 'TABLE']];
export function ddlSegments(file, text) {
  let sp;
  try { sp = split(file, text); }
  catch (e) {
    if (!(e instanceof Unclosed)) throw e;
    const line = lineOf(text, e.at);
    // 原因要上页面，不带代码的行号（第一期契约 F 节）；行号留在 line 一栏
    return { segments: [], error: { line, text: excerpt(text.slice(e.at)), reason: `有一处${e.message}没有闭合，整个文件没扫` } };
  }
  const segments = [];
  for (const l of sp.lits) {
    const s = text.slice(l.bs, l.be);
    if (!DDL_IN.test(s)) continue;
    const { toks, bad } = lex(s), sts = statements(toks);
    const isDdl = (st) => DDL_HEAD.some((h) => h.every((w, j) => st.a + j < st.b && toks[st.a + j].up === w));
    // 切词在一个没闭合的引号上停住、后面还有建表的字样：拿不准哪段是语句，整段照旧交过去，让「未解析的语句」露出来，不悄悄丢。
    if (bad && DDL_IN.test(s.slice(bad.s))) { segments.push({ file, text: s, startLine: sp.lineAt(l.bs) }); continue; }
    if (!sts.some(isDdl)) continue;
    let body = '', p = 0;
    for (const st of sts.filter((x) => !isDdl(x))) {
      const a = toks[st.a].s, b = toks[st.b - 1].e;
      body += s.slice(p, a) + s.slice(a, b).replace(/[^\n]/g, ' '); p = b;
    }
    segments.push({ file, text: body + s.slice(p), startLine: sp.lineAt(l.bs) });
  }
  return { segments, error: null };
}
