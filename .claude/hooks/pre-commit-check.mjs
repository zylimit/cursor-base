// Hook: PreToolUse (Bash) if git commit*
// commit 前按技术栈分发编译/语法门禁，任一栈不通过则阻止 commit（exit 2）。
// 设计原则（对齐 dev-builder「工具缺失降级」）：
//   - 只检查本次 staged 改动涉及的栈，不全量误伤（改 .md 不会触发 tsc）
//   - 工具未安装 → 降级或跳过该栈，绝不因环境缺工具而卡死 commit
//   - TS：tsc --noEmit（整项目类型检查）
//   - Python：优先 ruff check，降级到 py_compile。降级路径要先探出一个**真**解释器：
//     Windows 上裸 python3 常是 Microsoft Store 的 stub，--version 什么都不打印也编译不了，
//     选中它会把每次 commit 都误拦——逐个候选探、只认 --version 报出 Python 3 的那个；
//     逐文件循环编译（一次塞完整列表会撞命令行长度上限），且**只有输出含 SyntaxError 才拦**，
//     其余非零（stub、文件没了、环境坏）一律降级跳过。
//   - 大仓四态门：catalog 存在才启用，契约外退出码 = 引擎崩了，放行就是假绿
//   - 档位（profile.json）：off 静默放行；advise（fast 档）照跑照报但不 exit 2；block 走原逻辑
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, readStdinJson, git, run, say, errText, gateModeOf } from './lib/io.mjs';
import { gateLog } from './lib/gatelog.mjs';
import { harnessEnabled, harnessExtInstalled, harnessExtMissingNotice, harnessRun, rcInContract, errHead } from './lib/harness.mjs';

const TSCONFIG_MAX_DEPTH = 3;

/** 广度优先找最浅的 tsconfig.json（不下 node_modules / .next），找不到返回 null。 */
function findTsconfig(root) {
  let level = [root];
  for (let depth = 0; depth <= TSCONFIG_MAX_DEPTH && level.length; depth++) {
    const next = [];
    for (const dir of level) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { continue; }
      for (const e of entries) {
        if (e.isFile() && e.name === 'tsconfig.json') return path.join(dir, e.name);
      }
      for (const e of entries) {
        if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.next') next.push(path.join(dir, e.name));
      }
    }
    level = next;
  }
  return null;
}

/** 命令根本不在这台机器上（与「命令跑了但失败了」是两回事，后者要拦，前者只能降级）。 */
function missing(r) {
  return !!(r.error && r.error.code === 'ENOENT');
}

/** 探一个真 Python 3 解释器；一个都探不到返回 null（跳过 Python 检查，不拦 commit）。 */
function probePython(cwd) {
  for (const cand of [['python3'], ['python'], ['py', '-3']]) {
    const [exe, ...pre] = cand;
    const v = run(exe, [...pre, '--version'], { cwd });
    if (missing(v)) continue;
    if (v.status === 0 && /Python 3/.test(`${v.stdout}\n${v.stderr}`)) return { exe, pre };
  }
  return null;
}

async function main() {
  const mode = await gateModeOf('pre-commit-check');
  let engineBroken = false;
  if (mode === 'off') return;

  // 脚本内自判触发命令：非 git commit 输入直接放行
  const ev = readStdinJson();
  if (!ev) return;
  const cmd = String((ev.tool_input && ev.tool_input.command) || '');
  if (!/git\s+commit/.test(cmd)) return;

  const root = projectDir();

  // 本次提交涉及的文件（新增/复制/修改）
  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACM'], { cwd: root });
  const files = staged.stdout.split('\n').map((s) => s.trim()).filter((s) => s !== '');
  if (staged.status !== 0 || files.length === 0) return;

  let fail = false;

  // ---------- TypeScript ----------
  if (files.some((f) => /\.(ts|tsx)$/.test(f))) {
    const tsconfig = findTsconfig(root);
    if (tsconfig) {
      const r = run('npx', ['--no-install', 'tsc', '--noEmit'], { cwd: path.dirname(tsconfig) });
      if (!missing(r) && r.status !== 0) {
        say('❌ TypeScript 编译检查未通过，commit 被阻止：');
        say(`${r.stdout}${r.stderr}`.trimEnd());
        fail = true;
      }
    }
  }

  // ---------- Python ----------
  const pyFiles = files.filter((f) => /\.py$/.test(f));
  if (pyFiles.length) {
    const ruff = run('ruff', ['check', ...pyFiles], { cwd: root });
    if (!missing(ruff)) {
      if (ruff.status !== 0) {
        say('❌ Python 检查未通过（ruff check），commit 被阻止：');
        say(`${ruff.stdout}${ruff.stderr}`.trimEnd());
        fail = true;
      }
    } else {
      const py = probePython(root);
      if (py) {
        const tool = `${py.exe} -m py_compile（未装 ruff，降级语法检查）`;
        const bad = [];
        for (const f of pyFiles) {
          const c = run(py.exe, [...py.pre, '-m', 'py_compile', f], { cwd: root });
          const all = `${c.stdout}\n${c.stderr}`;
          // 非语法错的非零（stub / 文件已删 / 环境坏）一律降级跳过，不拿环境问题拦 commit
          if (!missing(c) && c.status !== 0 && /SyntaxError/.test(all)) bad.push(`${f}\n${all.trim()}`);
        }
        if (bad.length) {
          say(`❌ Python 检查未通过（${tool}），commit 被阻止：`);
          say(bad.join('\n'));
          fail = true;
        }
      }
      // 一个真解释器都没有 → 跳过 Python 检查，不拦 commit
    }
  }

  // ---------- JavaScript ----------
  const jsFiles = files.filter((f) => /\.(mjs|cjs|js)$/.test(f));
  if (jsFiles.length) {
    const bad = [];
    for (const f of jsFiles) {
      // node --check 自己就打 <文件>:<行>，原样透出去、不另造格式；只滤掉纯噪音的调用栈
      const c = run(process.execPath, ['--check', f], { cwd: root });
      if (c.status !== 0) {
        bad.push(`${c.stdout}${c.stderr}`.split('\n')
          .filter((l) => !l.startsWith('    at ') && !l.startsWith('Node.js v'))
          .join('\n').trim());
      }
    }
    if (bad.length) {
      say('❌ JavaScript 语法检查未通过（node --check），commit 被阻止：');
      say(bad.join('\n'));
      fail = true;
    }
  }

  // ---------- 大仓四态门（catalog 存在才启用，零行为变化）----------
  if (harnessEnabled() && !harnessExtInstalled()) {
    // catalog 在、引擎包（harness/ext）不在：verify 只会 rc 3 降级，定向门一条都没跑过。
    // 不拦 commit（装不装包是人的决定，不拿它卡住提交），但绝不零输出——那格静默正是假绿。
    const notice = harnessExtMissingNotice('大仓四态质量门（harness verify）');
    say(notice);
    gateLog('pre-commit-check', notice);
  } else if (harnessEnabled()) {
    const r = harnessRun(['verify'], { cwd: root });
    // rc=2 → 受影响模块的定向门未过（FAIL/BLOCKED），阻断 commit；rc=3 降级（无 catalog/非 git）静默跳过；rc=0 放行
    if (r.status === 2) {
      say('❌ 大仓四态质量门未通过（受影响模块定向检查 FAIL/BLOCKED），commit 被阻止：');
      say(r.stdout.trimEnd());
      fail = true;
    } else if (!rcInContract(r.status, 0, 3)) {
      engineBroken = true;
      // 契约外退出码（verify 契约只有 0/2/3）= 引擎自己崩了、门压根没跑成，放行就是假绿
      say(`❌ 大仓四态质量门跑不起来（harness verify 以契约外退出码 ${r.status} 退出，契约只有 0/2/3），commit 被阻止：`);
      say(errHead(r.stderr) || '（引擎无 stderr 输出）');
      say('这是引擎异常（如 .claude/harness/ext/ 半装或损坏、node 出岔），不是门未过——跑 node .claude/harness/harness.mjs verify 看真实报错。');
      fail = true;
    }
  }

  if (fail) {
    // 记账要说清是「门没过」还是「门没跑成」——两件事的下一步不一样（去修代码 / 去看引擎），
    // 混成一句话，gate-audit 事后就分不出这道闸到底拦下过什么。
    const why = engineBroken ? '大仓质量门跑不起来（引擎契约外退出码）' : '编译/语法门禁未通过';
    // advise 档（fast）：门跑了、也说了不过，但不拦这次 commit——欠账记账本，别悄悄咽下去。
    // 引擎崩了也照此办理：advise 的语义是「本档不拦 commit」，不因失败原因不同临时变硬拦；
    // 但绝不静默——诊断照出、账本照记，欠的账在那儿。
    if (mode === 'advise') {
      say(`[fast] 以上${why}，fast 档不拦本次 commit——欠账仍在，回 standard 前请修掉。`);
      gateLog('pre-commit-check', `[fast] ${why}，advise 档放行 commit`);
      return;
    }
    gateLog('pre-commit-check', `${why}，commit 被阻止`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  // 闸自身崩了 = 它没能证明这次 commit 过了编译门。本 hook 的输出形态是纯 stderr + exit 2，
  // 没有 decision 通道；静默 exit 0 会把「门没跑成」伪装成「门过了」。
  say(`❌ pre-commit-check 自身异常，commit 被阻止：${errText(e)}`);
  process.exitCode = 2;
});
