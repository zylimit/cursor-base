#!/usr/bin/env node
// collect-feedback-docs.mjs — collect-feedback.sh 的帮手：给一个下游项目出一行「人读文档」状态。
// 用法：node collect-feedback-docs.mjs <下游项目绝对路径>   只读，永远退出 0，结果是 stdout 一行。
// 为什么不在 shell 里做：要解析两份 JSON，要给子进程 60 秒超时，而 macOS 没有 timeout 命令；
//   Node 的 spawnSync 自带 timeout，跨平台一致。
// 数从哪来（都用项目自己装的那一份脚本，看的是它手上的生成器怎么说）：
//   页数 / 没写说明的表与模块 / 待更新与孤儿 / 配置漏项 ← <项目>/.claude/scripts/project-status.mjs --json 的 readable
//   核对不一致 ← <项目>/.claude/scripts/readable-docs.mjs check --json 的 problems 条数（有不一致时非零退出，不算跑不成）
//   近 7 天提交前被拦 ← <项目>/.claude/evidence/gate-block.log 里闸名 pre-commit-check、原因带「人读文档」的行
//   末尾那一截「结构」（2026-11-24 加，契约 I 节第 14 条末项）← <项目>/.claude/scripts/readable-docs.mjs structure --json 的循环依赖组数、
//     越层引用（各对的文件对数之和）、未归属的文件个数；近 7 天变坏提醒 ← 同一本账里闸名 pre-commit-check、原因以「[advise] 结构变坏：」开头的行。
//     装的生成器没有这条子命令、或项目没出架构设计（退出码 2）时这一截整个不出，不算取不到。
// 核对不一致、待更新、配置漏项、近 7 天变坏提醒任一非零，行首是 `! `，否则两个空格。
// 任何一步跑不成，那一行是「取不到（<原因首行>）」，不抛、不改退出码。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 60000;
const WEEK_MS = 7 * 24 * 3600 * 1000;

const proj = path.resolve(process.argv[2] || '.');
const name = path.basename(proj);
const out = (rest) => console.log(`  人读文档  ${name}：${rest}`);

// 返回解析后的 JSON；跑不成就抛带原因的 Error。非零退出只要 stdout 是 JSON 就认。
// absentOn2：退出码 2 表示「这一项本来就没有」（structure：生成器没有这条子命令、或项目没出架构设计），返回 null。
function runJson(script, args, what, absentOn2 = false) {
  const r = spawnSync(process.execPath, [script, ...args, '--root', proj], {
    cwd: proj, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(r.error.code === 'ETIMEDOUT' ? `${what} 超过 60 秒` : `${what} 起不来：${r.error.message}`);
  if (absentOn2 && r.status === 2) return null;
  try {
    return JSON.parse(r.stdout);
  } catch (_e) {
    const hint = (String(r.stderr || '').trim() || String(r.stdout || '').trim()).split(/\r?\n/)[0].slice(0, 120);
    throw new Error(`${what} 输出不是 JSON（退出码 ${r.status}${hint ? '：' + hint : ''}）`);
  }
}

// 近 7 天闸名 pre-commit-check、原因合 match 的行数；没有账本算 0，读不了账本是真错、往上抛。
function logged7d(match) {
  const log = path.join(proj, '.claude', 'evidence', 'gate-block.log');
  if (!fs.existsSync(log)) return 0;
  const since = Date.now() - WEEK_MS;
  let k = 0;
  for (const line of fs.readFileSync(log, 'utf8').split(/\r?\n/)) {
    const [ts, gate, ...reason] = line.split('\t');
    const t = Date.parse(ts);
    if (gate === 'pre-commit-check' && match(reason.join('\t')) && !Number.isNaN(t) && t >= since) k++;
  }
  return k;
}
const blocked7d = () => logged7d((r) => r.includes('人读文档'));

// 结构那一截与近 7 天变坏提醒的次数；项目装的生成器取不到结构（退出码 2）时 null，这一截整个不出。
function structureTail(docs) {
  const st = runJson(docs, ['structure', '--json'], 'readable-docs structure', true);
  if (st === null) return null;
  const pairs = st && Array.isArray(st.upward) ? st.upward.reduce((s, u) => s + (u && u.pairs), 0) : NaN;
  if (!Array.isArray(st.cycles) || !Array.isArray(st.unassigned) || !Number.isInteger(pairs)) throw new Error('readable-docs structure 的输出里循环依赖、越层引用或未归属的文件读不出');
  const j = logged7d((r) => r.startsWith('[advise] 结构变坏：'));
  return { j, text: `；结构：循环依赖 ${st.cycles.length} 组、越层引用 ${pairs} 处、未归属的文件 ${st.unassigned.length} 个，近 7 天变坏提醒 ${j} 次` };
}

try {
  const scripts = path.join(proj, '.claude', 'scripts');
  const docs = path.join(scripts, 'readable-docs.mjs');
  if (!fs.existsSync(docs)) {
    out('没有生成器（框架太旧）');
  } else if (!fs.existsSync(path.join(proj, 'docs', 'readable-src', 'config.json'))) {
    out('未初始化');
  } else {
    const status = runJson(path.join(scripts, 'project-status.mjs'), ['--json'], 'project-status');
    const rd = status && status.readable;
    if (!rd || typeof rd !== 'object') throw new Error('project-status 的输出里没有 readable');
    const check = runJson(docs, ['check', '--json'], 'readable-docs check');
    if (!Array.isArray(check.problems)) throw new Error('readable-docs check 的输出里没有 problems');
    // 配置漏项读不出时 project-status 给的是 suggest.error，不能当 0 报成「没漏」
    if (!rd.suggest || rd.suggest.error || !rd.suggest.missing) throw new Error(`配置漏项读不出：${(rd.suggest && rd.suggest.error) || 'suggest 缺失'}`);
    const m = rd.suggest.missing;
    const len = (a) => (Array.isArray(a) ? a.length : 0);
    const f = len(m.ddl) + len(m.codeRoots) + len(m.archDocs) + (m.spec ? 1 : 0);
    const a = check.problems.length;
    const d = (rd.notes && rd.notes.stale) || 0;
    const e = (rd.notes && rd.notes.orphans) || 0;
    const b = (rd.unwritten && rd.unwritten.tables) || 0;
    const c = (rd.unwritten && rd.unwritten.modules) || 0;
    const st = structureTail(docs);
    const mark = a || d || f || (st && st.j) ? '! ' : '  ';
    console.log(`${mark}人读文档  ${name}：${rd.pages} 页，核对不一致 ${a} 条，没写说明的表 ${b} 张、模块 ${c} 个，待更新 ${d} 段、孤儿 ${e} 段，配置漏项 ${f} 处，近 7 天提交前被拦 ${blocked7d()} 次${st ? st.text : ''}`);
  }
} catch (e) {
  out(`取不到（${String(e && e.message).split(/\r?\n/)[0]}）`);
}
