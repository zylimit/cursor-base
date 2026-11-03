#!/usr/bin/env node
// gen-agents.mjs — 从 .claude/agents/*.md 生成 .cursor/agents/<同名>.md。
// 用法：node .cursor/scripts/gen-agents.mjs        从哪里跑都行，项目根取 $CLAUDE_PROJECT_DIR，没有就按脚本位置推。
//   没有 .claude/agents/ 时退 1。覆盖写、幂等：同样的输入两次产出逐字节相同。
//
// 由来：Cursor 里 .cursor/agents/ 的优先级高于 .claude/agents/，而 cc-base 的 `model: sonnet / opus` 在 Cursor 里解析成
//   Claude 模型，账号没有 Claude 配额时子代理起不来（2026-11-04 实测）。所以生成版一律 `model: inherit` 跟主 agent 走；
//   要钉某个角色的模型写 .cursor/agents-models.json（形如 {"code-reviewer":"auto"}）。
//   Cursor 也不认 skills / memory 字段（Claude Code 靠前者预载技能、靠后者给子代理持久记忆），这两件事改写进正文开头。
//   disallowedTools Cursor 没法在 frontmatter 里禁，改成正文一句话：含 Task 或 Agent 的写「不要再派子代理。」，
//   其它每项写「不要用 <工具> 工具。」（Bash 写成「不要用 Shell（Bash）工具。」，Cursor 里它叫 Shell）。
//   生成器只写不清会让源头删掉的 agent 在 .cursor/agents/ 里一直留着（Cursor 优先读这里），所以生成前先清：
//   带下面那行生成注释、注释里的源名等于本文件名、但 .claude/agents/ 里已没有这个源的删掉；
//   没带注释的手写文件、复制生成物改名定制的文件（注释里源名不是自己）不动。
// 取舍：frontmatter 只做逐行 `key: value`——cc-base 的 agent 文件没有嵌套 YAML，上 YAML 库换来的只是一个依赖。
//   认不出的行（缩进续行、没有冒号）原样丢弃并在 stderr 说一句，不猜；其余 Cursor 不认的键（color / tools /
//   maxTurns）静默丢掉。agent 正文不改一个字，只在前面按需加几句。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CLAUDE_PROJECT_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, '.claude', 'agents');
const DST = path.join(ROOT, '.cursor', 'agents');
const MODELS = path.join(ROOT, '.cursor', 'agents-models.json');

function die(msg) {
  process.stderr.write(`gen-agents: ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(SRC) || !fs.statSync(SRC).isDirectory()) {
  die(`没有 ${SRC}——先跑 sync-from-cc-base.sh，或确认在 cc-base 原件所在的项目里`);
}

let pinned = {};
if (fs.existsSync(MODELS)) {
  try {
    pinned = JSON.parse(fs.readFileSync(MODELS, 'utf8'));
  } catch (e) {
    die(`${MODELS} 不是合法 JSON：${e.message}`);
  }
  if (!pinned || typeof pinned !== 'object' || Array.isArray(pinned)) {
    die(`${MODELS} 顶层必须是对象，形如 {"code-reviewer":"auto"}`);
  }
}

// 拆 frontmatter：返回 { fm: {key: value}, body }。不以 --- 开头或没有收尾 --- 就是认不出，返回 null。
function parse(file, text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) {
      process.stderr.write(`gen-agents: ${file} frontmatter 里认不出的行，已丢弃：${line}\n`);
      continue;
    }
    fm[m[1]] = m[2].trim();
  }
  return { fm, body: lines.slice(end + 1).join('\n') };
}

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.md')).sort();
if (files.length === 0) die(`${SRC} 下没有 .md`);

fs.mkdirSync(DST, { recursive: true });
const MARK = '由 .cursor/scripts/gen-agents.mjs';
const MARK_RE = MARK.replace(/\./g, '\\.');
for (const g of fs.readdirSync(DST).filter((x) => x.endsWith('.md')).sort()) {
  if (files.includes(g)) continue;
  // 注释里写的源名等于本文件名才算生成物：复制 code-reviewer.md 改名定制的文件带着别人的注释，不动
  const m = new RegExp(`${MARK_RE} 从 \\.claude/agents/(.+?)\\.md 生成`).exec(fs.readFileSync(path.join(DST, g), 'utf8'));
  if (!m || m[1] !== g.replace(/\.md$/, '')) continue;
  fs.rmSync(path.join(DST, g));
  process.stdout.write(`gen-agents: 源头已删，清掉生成物 ${path.relative(ROOT, path.join(DST, g))}\n`);
}
let bad = 0;
for (const f of files) {
  const p = parse(f, fs.readFileSync(path.join(SRC, f), 'utf8'));
  if (!p || !p.fm.name || !p.fm.description) {
    process.stderr.write(`gen-agents: ${f} 认不出 frontmatter（要有 --- 包着的 name 与 description），跳过\n`);
    bad++;
    continue;
  }
  const { fm, body } = p;
  const name = fm.name;
  const model = typeof pinned[name] === 'string' && pinned[name] ? pinned[name] : 'inherit';

  const pre = [];
  if (fm.skills) {
    const paths = fm.skills.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => `\`.claude/skills/${s}/SKILL.md\``).join('、');
    pre.push(`开工前先完整读 ${paths}（Cursor 不会像 Claude Code 那样把技能预载给子代理），再按下文行事。`);
  }
  if (fm.disallowedTools) {
    let noSub = false;
    for (const t of fm.disallowedTools.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (t === 'Task' || t === 'Agent') {
        if (!noSub) pre.push('不要再派子代理。');
        noSub = true;
      } else {
        pre.push(t === 'Bash' ? '不要用 Shell（Bash）工具。' : `不要用 ${t} 工具。`);
      }
    }
  }
  if (fm.memory === 'project') {
    pre.push(`你的持久记忆在 \`.claude/agent-memory/${name}/MEMORY.md\`，先读它，改动也写回那里。`);
  }

  // frontmatter 必须是文件第一行，Cursor 才认这个 agent；生成标记注释只能放在它后面
  const out = [
    '---',
    `name: ${name}`,
    `description: ${fm.description}`,
    `model: ${model}`,
    '---',
    '',
    `<!-- ${MARK} 从 .claude/agents/${f} 生成，别手改；要钉模型写 .cursor/agents-models.json -->`,
    '',
    ...(pre.length ? [pre.join('\n'), ''] : []),
    body.replace(/^\n+/, ''),
  ].join('\n');
  fs.writeFileSync(path.join(DST, f), out.endsWith('\n') ? out : `${out}\n`);
}
if (bad > 0) die(`${bad} 个 agent 文件认不出，其余已生成`);
process.stdout.write(`gen-agents: 生成 ${files.length} 个到 ${path.relative(ROOT, DST)}/\n`);
