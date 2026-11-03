#!/usr/bin/env node
// hook-form.mjs — settings.json 里框架 hook 的注册形态在 exec form 与 string form 之间互转。
// 用法：node .claude/scripts/hook-form.mjs --to exec|string [--file <settings.json>]
//       node .claude/scripts/hook-form.mjs --check [--file <settings.json>]
//   --file 不给时取 $CLAUDE_PROJECT_DIR（没有就 cwd）下的 .claude/settings.json。
//   --check 只打印 exec / string / mixed / none 之一；mixed 退 1，其余退 0。参数用错、文件读不了退 2。
//
// 由来：Cursor 也读 .claude/settings.json 的 hooks，但不认 args 键——exec form 下 command 只剩光杆
//   node，读着 stdin 空转，一个闸都没跑；换成 string form 才全跑（2026-11-04 实测）。Claude Code 两种都认。
//   exec form 不经 shell、三平台逐字相同，所以框架默认仍是它，string form 只在显式要求时生成。
//   两种形态：
//     exec form   {"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/<name>.mjs"], …}
//     string form {"type":"command","command":"node .claude/hooks/<name>.mjs", …}   没有 args 键
// 取舍：只认这两个逐字模板。路径写法有别的（绝对路径、加了参数、指 .sh/.ps1 的历史条目）一律当用户条目原样不动——
//   认得宽了就转不回原样，往返无损是这个脚本唯一的硬约束。statusLine 不是 hook，不碰。
//   其余键（timeout / asyncRewake …）原样保留，键序 type, command, [args], 其余按原序；写回 2 空格缩进 + 末尾换行，
//   与 fix-platform.sh 的 json.dump 同一个样子。没有要改的就不写文件。
//   「往返逐字节无损」的前提是输入已是 2 空格缩进的规范格式（本仓 settings.json 就是）；单行 JSON 往返只保证语义相同。
//   string form 走相对路径，是因为它是唯一不依赖 shell 展开语法的写法（$VAR / $env:VAR / %VAR% 三家各不相同），
//   前提是宿主以项目根为 hook 进程的 cwd——Claude Code 与 Cursor 都如此（2026-11-04 实测）。
import fs from 'node:fs';
import path from 'node:path';

const EXEC_PREFIX = '${CLAUDE_PROJECT_DIR}/.claude/hooks/';
const EXEC_ARG_RE = /^\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/hooks\/([A-Za-z0-9_-]+)\.mjs$/;
const STRING_CMD_RE = /^node \.claude\/hooks\/([A-Za-z0-9_-]+)\.mjs$/;

function die(msg) {
  process.stderr.write(`hook-form: ${msg}\n`);
  process.exit(2);
}

// 认形态：返回 { form, name }，不是框架 hook 条目返回 null。
function classify(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  if (h.command === 'node' && Array.isArray(h.args) && h.args.length === 1) {
    const m = EXEC_ARG_RE.exec(String(h.args[0]));
    if (m) return { form: 'exec', name: m[1] };
  }
  if (!('args' in h) && typeof h.command === 'string') {
    const m = STRING_CMD_RE.exec(h.command);
    if (m) return { form: 'string', name: m[1] };
  }
  return null;
}

function rebuild(h, form, name) {
  const out = { type: h.type ?? 'command' };
  if (form === 'exec') {
    out.command = 'node';
    out.args = [EXEC_PREFIX + name + '.mjs'];
  } else {
    out.command = 'node .claude/hooks/' + name + '.mjs';
  }
  for (const [k, v] of Object.entries(h)) {
    if (k === 'type' || k === 'command' || k === 'args') continue;
    out[k] = v;
  }
  return out;
}

function* hookLists(data) {
  const hooks = data && data.hooks;
  if (!hooks || typeof hooks !== 'object') return;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (g && Array.isArray(g.hooks)) yield g;
    }
  }
}

function check(data) {
  const forms = new Set();
  for (const g of hookLists(data)) {
    for (const h of g.hooks) {
      const c = classify(h);
      if (c) forms.add(c.form);
    }
  }
  if (forms.size === 0) return 'none';
  if (forms.size > 1) return 'mixed';
  return [...forms][0];
}

function convert(data, to) {
  let changed = 0;
  for (const g of hookLists(data)) {
    g.hooks = g.hooks.map((h) => {
      const c = classify(h);
      if (!c || c.form === to) return h;
      changed++;
      return rebuild(h, to, c.name);
    });
  }
  return changed;
}

function main(argv) {
  let to = null;
  let doCheck = false;
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') doCheck = true;
    else if (a === '--to') to = argv[++i];
    else if (a === '--file') file = argv[++i];
    else die(`未知参数：${a}（用法：--to exec|string [--file <settings.json>] 或 --check [--file <settings.json>]）`);
  }
  if (doCheck === (to !== null)) die('--to 与 --check 必须且只能给一个');
  if (to !== null && to !== 'exec' && to !== 'string') die(`--to 只认 exec 或 string，收到：${to}`);
  if (file === undefined) die('--file 后面缺路径');
  if (!file) file = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'settings.json');

  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    die(`读不了 ${file}：${e.message}`);
  }

  if (doCheck) {
    const r = check(data);
    process.stdout.write(r + '\n');
    process.exit(r === 'mixed' ? 1 : 0);
  }

  const n = convert(data, to);
  if (n > 0) fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  process.stdout.write(`hook-form: --to ${to} converted=${n} file=${file}\n`);
}

main(process.argv.slice(2));
