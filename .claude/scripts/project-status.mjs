#!/usr/bin/env node
// project-status.mjs —— 「现在到哪了」「三份活文档有多重」「人读文档到哪了」一条命令答完，只读、不写任何文件、不是闸。
// 为什么有它：下游要读 Spec / DEV-PLAN / progress 三份才答得出现状，而这三份已涨到几百 KB（OFR-ARIANE 的 Spec 416KB、
// progress 630KB；conflation 的 DEV-PLAN 658KB）。2026-11-22 决策：现状现算，不另养手工台账；recap 先跑它、报待归档先归档。
// 用法：node .claude/scripts/project-status.mjs [--root <目录>] [--table] [--json]
//   --root   目标目录，默认 $CLAUDE_PROJECT_DIR，再默认当前目录
//   --table  两行之后再出逐条需求表（需求 | 标记 | 阶段 | 状态）
//   --json   只输出一份 JSON（与 --table 同给时以 JSON 为准）
// 退出码：0 = 报告已出（文档不存在的那项写「无」）；2 = 参数错
// 「当前 Phase」按编号算：没带 ✅ 的小节里、编号比最大的已完成编号大的当中编号最小的一个（不是第一个没带的：下游 133 个只标了 23 个；
// 也不按位置：conflation 的 Phase 59 排在 54 前面）；编号更小却没标 ✅ 的报 u 个（只陈述事实，做完没标还是被跳过判不了）。
// 口径全在 docs/living-docs-contract-2026-11.md 第 3 节。待归档数不 import 两个归档脚本，调子进程 --check --json 取；
// 调不成写「未知：<原因>」，不猜——归档脚本整次拒绝（比如首末同日判不出方向）正是要人去理的情形，原因吞掉就没人理。
// 第三行「人读文档」（docs/readable-spec/phase1-db-contract.md I 节第 10 条）同理：数取同目录生成器的 check --json 与
// init --suggest --json（都只读），没有配置报「未初始化」，取不到报「读不出」带原因，不当 0。--json 里是 readable 一项。
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

function usageError(msg) {
    console.error(`project-status: ${msg}（用法：project-status.mjs [--root <dir>] [--table] [--json]）`);
    process.exit(2);
}

let root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let table = false, json = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') { root = argv[++i]; if (root === undefined) usageError('--root 缺值'); }
    else if (a === '--table') table = true;
    else if (a === '--json') json = true;
    else usageError(`未知参数：${a}`);
}

// 与 plan-lint.sh 同口径的两条正则（声明 / 引用）。引用用 Unicode 边界复刻 Python 的 \b：
// 「对应REQ-X-001」紧贴汉字，Python 认不出，这里也不认（同 plan-archive.mjs），否则阶段列会比 plan-lint 多认。
const REQ_DECL = /^\s{0,1}(?:[-*+]|\d+[.)])\s*\[(REQ-[A-Za-z0-9]{1,16}-\d{2,4})\]/;
const REQ_REF = /(?<![\p{L}\p{N}_])REQ-[A-Za-z0-9]{1,16}-\p{Nd}{2,4}(?![\p{L}\p{N}_])/gu;
const TASK_LINE = /^\s*-\s*\*\*Task\s+\d+\.\d+[:：]/;
const FENCE_RE = /^\s*(```|~~~)/;
const PHASE_RE = /^## Phase\s+(\d+)[:：]\s*/;
const TOP_ITEM = /^ {0,1}(?:[-*+]|\d+[.)])(?:\s|$)/;
// 指针行与 plan-lint.sh 同口径：「## 已归档 Phase」一节里带箭头的列表行才算；编号只取最后一个箭头之后「（REQ：…）」后缀里的，
// 前半标题原文常写「REQ-X 推到下期」，整行读会把它算成已归档（2026-11-22 审查复现）。
const POINTER_LINE = /^\s*-\s.*→\s*DEV-PLAN\.archive\.md/;
const POINTER_ARROW = /→\s*DEV-PLAN\.archive\.md/;
const POINTER_SUFFIX = /^\s*（REQ：([^）]*)）/;
const WEIGHT_LINE = 65536;
const REASON_CHARS = 60;

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
const chars = (s) => [...s].length;
const here = dirname(fileURLToPath(import.meta.url));

function readDoc(name) {
    const p = join(root, name);
    if (!existsSync(p)) return null;
    return readFileSync(p, 'utf8');
}

// 围栏里的行（含围栏记号行）都不算：与 plan-lint 一致。
function unfenced(text) {
    const out = [];
    let inFence = false;
    for (const l of text.replace(/\r/g, '').split('\n')) {
        if (FENCE_RE.test(l)) { inFence = !inFence; continue; }
        if (!inFence) out.push(l);
    }
    return out;
}

// 从 lines[i]（一个顶层条目首行）起收续行：缩进 ≥2 的非空行；空行先挂着，后面真有缩进行才并进去；顶格正文或下一条目收口。
function itemText(lines, i) {
    const parts = [lines[i]];
    let blanks = [];
    for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^\s*$/.test(l)) { blanks.push(l); continue; }
        if (TOP_ITEM.test(l) || /^#{1,6}\s/.test(l) || !/^\s{2,}/.test(l)) break;
        parts.push(...blanks, l); blanks = [];
    }
    return parts.join('\n');
}

// 按 `## ` 切段，返回 [{name(整行标题), lines}]；第一个标题之前的内容 name 为 null。
function sections(lines) {
    const secs = [{ heading: null, lines: [] }];
    for (const l of lines) {
        if (l.startsWith('## ')) secs.push({ heading: l, lines: [l] });
        else secs[secs.length - 1].lines.push(l);
    }
    return secs;
}

const reqsIn = (s) => [...s.matchAll(REQ_REF)].map((m) => m[0]);
function pointerReqs(l) {
    const m = POINTER_SUFFIX.exec(l.split(POINTER_ARROW).pop());
    return m ? reqsIn(m[1]) : [];
}

// ---------------- Spec ----------------
function analyzeSpec(text) {
    const lines = unfenced(text);
    const secs = sections(lines);
    const feat = secs.find((s) => s.heading && s.heading.startsWith('## 功能需求'));
    const entries = [];
    if (feat) {
        for (let i = 0; i < feat.lines.length; i++) {
            if (TOP_ITEM.test(feat.lines[i])) entries.push(itemText(feat.lines, i));
        }
    }
    const hist = (t) => t.includes('~~') || t.includes('修订：') || t.includes('修订:') || t.includes('取代');
    let pending = 0;
    const pend = secs.find((s) => s.heading && s.heading.startsWith('## 待定问题'));
    if (pend) {
        const rows = pend.lines.filter((l) => l.trim().startsWith('|'));
        const isSep = (l) => /^\s*\|[\s|:\-]+\|?\s*$/.test(l);
        const seps = rows.filter(isSep).length;
        // 表头 = 紧贴分隔行上方的那一行；表头行与分隔行不算数据行
        const heads = rows.filter((l, i) => i + 1 < rows.length && isSep(rows[i + 1]) && !isSep(l)).length;
        pending = Math.max(0, rows.length - seps - heads);
    }
    // 声明：每条一个 id，文本 = 声明行 + 续行；所属段名用来认「范围外」
    const decls = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) cur = lines[i];
        const m = REQ_DECL.exec(lines[i]);
        if (m) decls.push({ id: m[1], text: itemText(lines, i), outOfScope: !!(cur && cur.startsWith('## 范围外')) });
    }
    return {
        bytes: Buffer.byteLength(text, 'utf8'),
        entries: entries.length,
        inferred: entries.filter((t) => t.includes('[推断]')).length,
        defaulted: entries.filter((t) => t.includes('[默认]')).length,
        pending,
        withHistory: entries.filter(hist).length,
        longest: entries.reduce((m, t) => Math.max(m, chars(t)), 0),
        hasFeat: !!feat,
        decls,
    };
}

// ---------------- DEV-PLAN ----------------
function analyzePlan(text) {
    const lines = unfenced(text);
    const secs = sections(lines);
    const phases = [];       // {n, heading, done, taskIds:Set}
    let pointers = [];       // 已归档指针行
    let outScope = new Set();
    for (const s of secs) {
        if (!s.heading) continue;
        if (/^## 已归档 Phase\s*$/.test(s.heading)) {
            pointers = s.lines.slice(1).filter((l) => POINTER_LINE.test(l));
        } else if (s.heading.startsWith('## 范围外')) {
            for (const l of s.lines) for (const id of reqsIn(l)) outScope.add(id);
        } else if (PHASE_RE.test(s.heading)) {
            const ids = new Set();
            for (const l of s.lines) if (TASK_LINE.test(l)) for (const id of reqsIn(l)) ids.add(id);
            phases.push({ n: Number(PHASE_RE.exec(s.heading)[1]), heading: s.heading, done: s.heading.includes('✅'), ids });
        }
    }
    const total = phases.length + pointers.length;
    const done = phases.filter((p) => p.done).length + pointers.length;
    // 「当前」= 没 ✅ 的小节里编号比最大的已完成编号大的当中编号最小的，一个 ✅ 都没有时是编号最小的小节；编号相同取文档里靠前的。
    // 编号比最大的已完成编号小、自己没 ✅ 的记为没标——与 plan-archive 的 unmarked 同一个数，都只看现存小节、不看指针行。
    const maxDoneN = phases.reduce((m, p) => (p.done ? Math.max(m, p.n) : m), -Infinity);
    const cur = phases.filter((p) => !p.done && p.n > maxDoneN).reduce((b, p) => (b === null || p.n < b.n ? p : b), null);
    const unmarked = phases.filter((p) => !p.done && p.n < maxDoneN).length;
    const replay = phases.filter((p) => p.done && p.heading.includes('回放')).length
        + pointers.filter((l) => l.includes('回放')).length;
    const longTitles = phases.filter((p) => chars(p.heading.trim()) > 60).length;
    return {
        bytes: Buffer.byteLength(text, 'utf8'), phases, pointers, outScope, total, done, replay, longTitles, unmarked,
        current: cur ? { n: cur.n, title: cur.heading.replace(PHASE_RE, '').trim() } : null,
    };
}

// ---------------- progress ----------------
function heaviestSections(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const secs = [{ name: '文首', bytes: 0 }];
    let inFence = false;
    lines.forEach((l, idx) => {
        const size = Buffer.byteLength(l, 'utf8') + (idx < lines.length - 1 ? 1 : 0);
        if (FENCE_RE.test(l)) inFence = !inFence;
        else if (!inFence && l.startsWith('## ')) {
            const name = l.slice(3).split(/[（(]/)[0].trim();
            secs.push({ name, bytes: 0 });
        }
        secs[secs.length - 1].bytes += size;
    });
    return secs.filter((s) => s.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 2);
}

// 调归档脚本的 --check --json，返回 { data } 或 { error: 原因 }；调不成不当 0 处理，原因原样带给人看。
// 契约三种原因：脚本不存在「脚本不在」；退出码非 0 取 stderr 第一行（跳过空行）截到 60 字；输出不是 JSON「输出读不懂」。
// 契约没列的两种窄兜底：非 0 退出却没写 stderr 时写「退出码 N」，被信号杀掉或起不来时写 node 给的错误首行。
const clip = (s) => [...s].slice(0, REASON_CHARS).join('');
function callArchive(script) {
    const p = join(here, script);
    if (!existsSync(p)) return { error: '脚本不在' };
    let out;
    try {
        out = execFileSync(process.execPath, [p, '--root', root, '--check', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        const first = String(e.stderr || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '');
        if (first) return { error: clip(first) };
        if (Number.isInteger(e.status) && e.status !== 0) return { error: `退出码 ${e.status}` };
        return { error: clip(String(e.message || e).split(/\r?\n/)[0]) };
    }
    try { return { data: JSON.parse(out) }; } catch { return { error: '输出读不懂' }; }
}

const specText = readDoc('Product-Spec.md');
const planText = readDoc('DEV-PLAN.md');
const progText = readDoc('progress.md');
const spec = specText === null ? null : analyzeSpec(specText);
const plan = planText === null ? null : analyzePlan(planText);

// 调得成但 JSON 里缺该有的数，同样算「输出读不懂」，不当 0。
let planDue = null, planErr = null, progDue = null, progErr = null, pinned = null, heaviest = [];
if (plan) {
    const { data: r, error } = callArchive('plan-archive.mjs');
    if (error) planErr = error;
    else if (r && Number.isInteger(r.moved)) planDue = r.moved;
    else planErr = '输出读不懂';
}
let progBytes = 0;
if (progText !== null) {
    progBytes = Buffer.byteLength(progText, 'utf8');
    const { data: r, error } = callArchive('progress-archive.mjs');
    const sum = r && r.moved && typeof r.moved === 'object' ? ['done', 'notes', 'decisions', 'todo'].map((k) => r.moved[k]) : null;
    if (error) progErr = error;
    else if (sum && sum.every(Number.isInteger)) progDue = sum.reduce((a, b) => a + b, 0);
    else progErr = '输出读不懂';
    if (r && r.pinned) pinned = r.pinned;
    if (progBytes > WEIGHT_LINE) heaviest = heaviestSections(progText);
}

// ---------------- 逐条需求（reqs） ----------------
function buildReqs() {
    if (!spec) return [];
    return spec.decls.map((d) => {
        const tag = d.text.includes('[推断]') ? '推断' : d.text.includes('[默认]') ? '默认' : d.text.includes('[确认]') ? '确认' : '未标';
        const phases = [], marks = [];
        if (plan) {
            for (const p of plan.phases) if (p.ids.has(d.id)) { phases.push(`Phase ${p.n}`); marks.push(p.done); }
            for (const l of plan.pointers) {
                if (pointerReqs(l).includes(d.id)) {
                    const m = /Phase\s+(\d+)/.exec(l);
                    phases.push(m ? `Phase ${m[1]}（已归档）` : '已归档'); marks.push(true);
                }
            }
        }
        let state = '—';
        if (phases.length === 0) {
            if (d.outOfScope || (plan && plan.outScope.has(d.id))) phases.push('范围外');
            else phases.push('未排');
        } else {
            state = marks.every(Boolean) ? '完成' : marks.some(Boolean) ? '进行中' : '未开始';
        }
        return { id: d.id, tag, phases, state };
    });
}
const reqs = buildReqs();

// ---------------- 人读文档 ----------------
// 生成器的退出码 0、1 都是答出来了（1 = 有不一致 / 有漏项），别的取 stderr 第一行当原因，同 callArchive 截到 60 字。
function callDocs(args) {
    const p = join(here, 'readable-docs.mjs');
    if (!existsSync(p)) return { error: '没装生成器' };
    const r = spawnSync(process.execPath, [p, ...args, '--root', root], { encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 26 });
    if (r.error) return { error: clip(r.error.code === 'ETIMEDOUT' ? '超过 60 秒没跑完' : String(r.error.message).split(/\r?\n/)[0]) };
    const first = String(r.stderr || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '');
    if (r.status !== 0 && r.status !== 1) return { error: first ? clip(first) : `退出码 ${r.status ?? r.signal}` };
    try { return { data: JSON.parse(r.stdout) }; } catch { return { error: '输出读不懂' }; }
}
function readableStatus() {
    if (!existsSync(join(root, 'docs/readable-src/config.json'))) return { exists: false };
    const { data: c, error } = callDocs(['check', '--json']);
    const s = c && c.summary;
    const n = s && s.unwritten && s.notes ? { pages: s.pagesOnDisk, tables: s.unwritten.tables, modules: s.arch ? s.arch.unwrittenModules : 0, stale: s.notes.stale, orphans: s.notes.orphans } : null;
    if (error || !n || !Object.values(n).every(Number.isInteger)) return { exists: true, error: error || '输出读不懂' };
    const g = callDocs(['init', '--suggest', '--json']);
    const suggest = g.error ? { error: g.error } : g.data && typeof g.data.ok === 'boolean' && g.data.missing ? { ok: g.data.ok, missing: g.data.missing } : { error: '输出读不懂' };
    return { exists: true, pages: n.pages, unwritten: { tables: n.tables, modules: n.modules }, notes: { stale: n.stale, orphans: n.orphans }, suggest };
}
const readable = readableStatus();
function readableLine(d) {
    if (!d.exists) return '人读文档：未初始化';
    if (d.error) return `人读文档：读不出（${d.error}）`;
    const m = d.suggest.missing, gaps = m ? ['ddl', 'codeRoots', 'archDocs'].filter((k) => m[k] && m[k].length).map((k) => `${k} ${m[k].length} 个`).concat(m.spec ? ['spec'] : []) : [];
    const sg = d.suggest.error ? `配置有没有漏项读不出（${d.suggest.error}）` : d.suggest.ok ? '配置没有漏项' : `配置有漏项：${gaps.join('、')}（readable-docs.mjs init --suggest 看清单）`;
    return `人读文档：${d.pages} 页 · 没写说明的表 ${d.unwritten.tables} 张、模块 ${d.unwritten.modules} 个 · 待更新 ${d.notes.stale} 段、孤儿 ${d.notes.orphans} 段 · ${sg}`;
}

// ---------------- 输出 ----------------
const unk = (n, err, fmt) => (err !== null ? `（待归档未知：${err}）` : n > 0 ? fmt(n) : '');
const withErr = (o, err) => (err !== null ? { ...o, archiveError: err } : o);

if (json) {
    const out = {
        command: 'project-status', root,
        spec: spec ? { exists: true, bytes: spec.bytes, entries: spec.entries, inferred: spec.inferred, defaulted: spec.defaulted, pending: spec.pending, withHistory: spec.withHistory, longest: spec.longest } : { exists: false },
        plan: plan ? withErr({ exists: true, bytes: plan.bytes, total: plan.total, done: plan.done, current: plan.current, replay: plan.replay, unmarked: plan.unmarked, longTitles: plan.longTitles, archiveDue: planDue }, planErr) : { exists: false },
        progress: progText === null ? { exists: false } : withErr({ exists: true, bytes: progBytes, archiveDue: progDue, pinned: pinned || null, heaviest: heaviest.map((h) => ({ section: h.name, bytes: h.bytes })) }, progErr),
        reqs: reqs.map((r) => ({ id: r.id, tag: r.tag, phases: r.phases, state: r.state })),
        readable,
    };
    console.log(JSON.stringify(out));
    process.exit(0);
}

const l1 = [];
if (spec) {
    let s = `需求 ${spec.entries} 条（含推断 ${spec.inferred}、默认 ${spec.defaulted}）`;
    if (spec.pending > 0) s += ` · 待定 ${spec.pending} 项`;
    l1.push(s);
}
if (plan && plan.phases.length === 0 && plan.pointers.length === 0) {
    // 比如写成了 `### Phase 1:`：报「Phase 0/0 完成，全部完成」是拿错的数字误导人，recap 会原样念给用户
    l1.push('DEV-PLAN 里没认出 ## Phase 小节');
} else if (plan) {
    const cur = plan.current ? `当前 Phase ${plan.current.n}：${chars(plan.current.title) > 30 ? [...plan.current.title].slice(0, 30).join('') + '…' : plan.current.title}` : null;
    const tail = plan.unmarked > 0 ? `前面 ${plan.unmarked} 个没标 ✅` : null;
    const t = [cur || (tail ? null : '全部完成'), tail].filter(Boolean).join('，');
    let s = `Phase ${plan.done}/${plan.total} 完成，${t}`;
    if (plan.replay > 0) s += ` · ${plan.replay} 个带回放待重验`;
    l1.push(s);
}
console.log(!spec && !plan ? '现在到哪：还没有 Product-Spec.md 与 DEV-PLAN.md' : `现在到哪：${l1.join(' · ')}`);

if (!spec && !plan && progText === null) {
    console.log('活文档：无');
} else {
    const l2 = [];
    if (!spec) l2.push('Spec 无');
    else {
        let s = `Spec ${kb(spec.bytes)}`;
        if (spec.withHistory > 0 || spec.longest > 1500) s += `（带修订史 ${spec.withHistory} 条，最长一条 ${spec.longest} 字）`;
        l2.push(s);
    }
    if (!plan) l2.push('DEV-PLAN 无');
    else {
        let s = `DEV-PLAN ${kb(plan.bytes)}` + unk(planDue, planErr, (n) => `（待归档 ${n} 个 Phase）`);
        if (plan.longTitles > 0) s += `（${plan.longTitles} 个标题超 60 字）`;
        l2.push(s);
    }
    if (progText === null) l2.push('progress 无');
    else {
        let s = `progress ${kb(progBytes)}` + unk(progDue, progErr, (n) => `（待归档 ${n} 条）`);
        if (pinned && pinned.overCap) s += `（Pinned ${pinned.count}/${pinned.cap}）`;
        if (heaviest.length > 0) s += `（最重两段：${heaviest.map((h) => `${h.name} ${kb(h.bytes)}`).join('、')}）`;
        l2.push(s);
    }
    const due = (planDue || 0) > 0 || (progDue || 0) > 0;
    console.log(`活文档：${l2.join(' · ')}${due ? '——先跑 /archive' : ''}`);
}
console.log(readableLine(readable));

if (table) {
    if (reqs.length === 0) {
        if (spec) console.log('（Spec 未用 REQ 编号，出不了逐条表）');
    } else {
        console.log('| 需求 | 标记 | 阶段 | 状态 |');
        console.log('|---|---|---|---|');
        for (const r of reqs) console.log(`| ${r.id} | ${r.tag} | ${r.phases.join('、')} | ${r.state} |`);
    }
}
