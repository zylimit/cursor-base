// io.mjs — hook 侧最小 I/O 契约（stdin / stdout / stderr / 退出码 / 外部命令 / 路径 / 档位总闸）。
//
// 故意不 import .claude/harness/lib/*：hook 与引擎是**进程级隔离**，引擎的 lib/ 被删时
// hook 必须还起得来、还能判出「引擎跑不成」——若直接 import 引擎代码，缺 lib/ 会让 hook
// 自己 ERR_MODULE_NOT_FOUND 起不来，「闸跑起来了但引擎坏了」与「闸自己没起来」这两件
// 完全不同的事就混成一件。core.mjs 里好用的东西只许在本目录抄精简版，不许 import。
//
// 输出一律 fs.writeSync：管道下 process.stdout.write 是异步的，写完立刻退出会丢内容。
// 退出码一律只设 process.exitCode 后自然退出，唯一例外是 runFailClosed 的 catch 分支
// （闸自身崩了必须当场把拦停 JSON 落出去，不能指望后续代码还有机会跑）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isatty } from 'node:tty';

/** 反斜杠→正斜杠。无条件替换，不按 path.sep 分支：Windows 形态的路径会经夹具/事件流到任何平台。 */
export function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

/**
 * 读文本文件：只有 ENOENT 算「不存在」，其余 I/O 错单独报。
 * 读不出来 ≠ 没有——两者的下一步动作相反，一个 catch 全吞掉就分不出来了。
 * @returns {{text:(string|null),absent:boolean,error:(Error|null)}}
 */
export function readTextFile(file) {
  try { return { text: fs.readFileSync(file, 'utf8'), absent: false, error: null }; } catch (e) {
    if (e && e.code === 'ENOENT') return { text: null, absent: true, error: null };
    return { text: null, absent: false, error: e };
  }
}

/**
 * 读完 stdin 的原始文本，一直读到 EOF；没有输入（终端 / 无 stdin）返回空串。
 *
 * 为什么不再是一句 readFileSync(0) + catch 全吞（2026-11-08 reviewer 第四轮 P1）：大事件经管道分块到达时，
 * fd 0 是非阻塞的，读到一半撞上 EAGAIN 会抛错，原写法把它吞成空串——所有 hook 都把「没读完」当「空输入」
 * 静默放行。reviewer 用 node 异步 spawn 喂 300KB 事件稳定复现；主 Agent 两次「跑完套件后第一条探针 rc 0」
 * 不可复现的放行也归因于此。现在 readSync 循环累积到返回 0（EOF）；EAGAIN / EWOULDBLOCK（Windows 管道码
 * 可能不同，两种都认）就用 Atomics.wait 睡 5ms 再试，累计等待封顶 3 秒；超时或别的读错把已读到的部分原样
 * 返回——残缺文本在解析层会被判坏，由调用方决定降级形态，不在这里伪装成「空」。
 * 判终端用 isatty(0) 而不碰 process.stdin：访问 process.stdin 会给管道 fd 建流、顺手把它设成非阻塞。
 */
const STDIN_WAIT_MAX_MS = 3000;
const STDIN_RETRY_MS = 5;
export function readStdinRaw() {
  if (isatty(0)) return '';
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let waited = 0;
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      const again = e && (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK');
      if (again && waited < STDIN_WAIT_MAX_MS) {
        Atomics.wait(sleeper, 0, 0, STDIN_RETRY_MS);
        waited += STDIN_RETRY_MS;
        continue;
      }
      // EOF（Windows 管道读到尾会抛 code 'EOF'）、EBADF（根本没有 stdin）、等待超时：返回已读部分
      break;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 读完 stdin 并解析：空输入 → {}；解析失败或不是对象 → null（不抛，由调用方决定降级形态）。 */
export function readStdinJson() {
  const raw = readStdinRaw();
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
  } catch (_e) {
    return null;
  }
}

/** 项目根：CLAUDE_PROJECT_DIR → git 顶层 → cwd。 */
export function projectDir() {
  const env = process.env.CLAUDE_PROJECT_DIR;
  if (env) return env;
  const top = git(['rev-parse', '--show-toplevel']);
  if (top.status === 0 && top.stdout.trim()) return top.stdout.trim();
  return process.cwd();
}

/**
 * 待审清单文本 → 还欠着的文件行。先 trim 再判空、再判 clean：同一行 " clean " 一边算欠账、
 * 另一边算干净，会造出「状态栏说干净、Stop 闸却不放人」这种最难自查的死胡同。
 */
export function pendingReviewLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && l !== 'clean');
}

/**
 * 读 .claude/.needs-review 取欠账文件；读不出来（不存在 / I/O 错）一律空数组。
 * 要分「不存在」与「读不出」的调用方（stop-gate 靠这个差别 fail-closed）先用 readTextFile 判完，
 * 再把文本交给 pendingReviewLines——口径仍是同一份。
 */
export function pendingReviewFiles(root) {
  return pendingReviewLines(readTextFile(path.join(root, '.claude', '.needs-review')).text);
}

/** 单行 JSON 到 stdout（hook 与宿主之间的机器契约，多行会被记成 hook error）。 */
export function emit(obj) {
  fs.writeSync(1, JSON.stringify(obj) + '\n');
}

/** 裸文本到 stdout（给人看的报告类输出；要进 context 的注入用 context()）。 */
export function out(text) {
  fs.writeSync(1, String(text) + '\n');
}

/**
 * 注入上下文：嵌套 JSON 形态。Claude Code 纯文本 stdout 与嵌套 JSON 都收，Cursor 只认嵌套形态、
 * 纯文本直接丢弃，所以 SessionStart 这类要进 context 的输出走这里，别再用 out()。
 */
export function context(hookEventName, text) {
  emit({ hookSpecificOutput: { hookEventName, additionalContext: String(text) } });
}

/** 一行诊断到 stderr。 */
export function say(text) {
  fs.writeSync(2, String(text) + '\n');
}

/** 拦停：靠 stdout 的 decision JSON，不靠退出码（Stop / PreCompact / UserPromptExpansion 的契约）。 */
export function block(reason) {
  emit({ decision: 'block', reason: String(reason) });
  process.exitCode = 0;
}

/** 跑外部命令：一律 shell:false + argv 数组，禁字符串拼命令。 */
export function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { shell: false, encoding: 'utf8', ...opts });
  return {
    status: (r.status === null || r.status === undefined) ? -1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error || null,
  };
}

/** git 子命令。git 不在 / 起不来时 status = -1（可判定的降级信号，不是「命令成功了」）。 */
export function git(args, opts = {}) {
  return run('git', args, opts);
}

/**
 * `git status --porcelain -z` 的记录解析：按 NUL 切段，R/C 记录后跟的那条裸旧路径也算进改动集。
 * -z 形态每条记录是 `XY <path>`、路径不加引号，必须按 NUL 切不能按行读——按行读会把含空格/
 * 换行的路径切碎，rename 的旧路径还会整条漏掉。三个闸原先各抄一份，抄漏一处就是一处静默漏判。
 * 只解析、不替调用方判成败：status / error / stderr 原样带出——git 跑不成时有的闸静默放行、
 * 有的 fail-closed 拦停、有的要点名 ENOENT，在这里替它们决定就把这三种处境抹成一种。
 * @param {string} root 仓内目录（作 cwd）
 * @param {string[]} extraArgs 追加参数（如 ['--', '.'] 限定项目子树、['-uall'] 展开未跟踪目录）
 * @returns {{status:number,error:(Error|null),stderr:string,paths:string[]}}
 */
export function porcelainZ(root, extraArgs = []) {
  const st = git(['status', '--porcelain', '-z', ...extraArgs], { cwd: root });
  const recs = String(st.stdout || '').split('\0');
  const paths = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (!rec) continue;
    const status = rec.slice(0, 2);
    paths.push(rec.slice(3));
    if (/^[RC]/.test(status) || /^.[RC]/.test(status)) {
      i += 1;
      if (recs[i]) paths.push(recs[i]);
    }
  }
  return { status: st.status, error: st.error, stderr: st.stderr, paths };
}

/**
 * 一条改动路径归哪一类（三文档命中 / 不算数 / 代码家底 / 其它）。
 * 判定顺序即优先级：三文档按全名先认，再滤掉不算数的，剩下才按扩展名与 .claude/ 家底算代码。
 *   'ignore' —— evidence 是机器写的旁路账本，node_modules/out/dist 是产物，
 *               .claude/.tdd-exempt|.red-verified 是 tdd-gate 的运行态标记：touch 一下不是改家底。
 * 判「改了要记 progress」的闸共用这一份表，各闸再把 kind 映射回自己的标志。
 * @returns {'progress'|'spec'|'changelog'|'ignore'|'code'|'other'}
 */
export function classifyChange(p) {
  if (p === 'progress.md') return 'progress';
  if (p === 'Product-Spec.md') return 'spec';
  if (p === 'Product-Spec-CHANGELOG.md') return 'changelog';
  if (/(^|\/)(\.claude\/evidence|node_modules|out|dist)\//.test(p)) return 'ignore';
  if (/(^|\/)\.claude\/\.(tdd-exempt|red-verified)$/.test(p)) return 'ignore';
  if (/\.(sh|ps1|mjs|cjs|ts|tsx|js|jsx|py|css|go|rs)$/.test(p) || /(^|\/)\.claude\//.test(p)) return 'code';
  return 'other';
}

/**
 * 剥掉仓根到项目目录的前缀（porcelain 路径恒相对仓根，项目是父仓子目录时带前缀）。
 * 剥不掉 = 这条改动不在项目子树内，返回 null 让调用方跳过——别把仓外改动算进项目账。
 * 项目即仓根时 prefix 为空串，原样直通。
 */
export function relToProject(p, prefix) {
  if (!prefix) return p;
  return p.startsWith(prefix) ? p.slice(prefix.length) : null;
}

/** 异常文本（只取首行，进 stderr 与账本的都是一行）。 */
export function errText(e) {
  return String((e && (e.stack || e.message)) || e || 'unknown').split('\n')[0];
}

/**
 * fail-closed 闸：主体任何异常都当场落一条拦停 JSON。
 * 闸自己崩了 = 它没能证明状态是干净的，此时放行就是假绿。
 */
export function runFailClosed(main, reason) {
  const fail = (e) => {
    try { emit({ decision: 'block', reason: `${reason}（闸自身异常：${errText(e)}）` }); } catch (_e) { /* stdout 都写不出去了，没有别的通道 */ }
    process.exit(0);
  };
  try {
    const r = main();
    if (r && typeof r.then === 'function') r.then(undefined, fail);
  } catch (e) {
    fail(e);
  }
}

/**
 * fail-open 闸/提醒类 hook：主体异常时留一行可见诊断后放行。
 * 留这一行是有意的——静默吞掉异常等于把「hook 坏了」伪装成「没什么可提醒的」。
 */
export function runFailOpen(main) {
  const fail = (e) => {
    try { say(`[hook] 内部异常，已放行：${errText(e)}`); } catch (_e) { /* 连 stderr 都没有就只能放行 */ }
    // 已经定下的拦停码不因为收尾时的异常被降级：判决先落码、再写诊断，写诊断失败不该翻案
    if (!process.exitCode) process.exitCode = 0;
  };
  try {
    const r = main();
    if (r && typeof r.then === 'function') r.then(undefined, fail);
  } catch (e) {
    fail(e);
  }
}

/** 判定库整个加载不了时的兜底口径 = standard 列。只列与「按种类取最严」不同的那几条，别在这里养第二张表。 */
const FALLBACK_GUARDS = new Set([
  'dangerous-pkill-guard', 'harness-async-verify', 'no-direct-code-guard', 'pre-commit-check',
  'precompact-gate', 'release-gate', 'secret-exfil-guard', 'stop-gate', 'tdd-gate', 'three-file-sync-gate', 'design-detail-sync',
]);
const FALLBACK_ADVISE = new Set(['stop-gate', 'tdd-gate', 'three-file-sync-gate', 'design-detail-sync']);

/**
 * 档位总闸：这个闸此刻该怎么跑（'off' 静默 / 'advise' 只提醒 / 'block' 拦停 / 'on' 记账）。
 * 动态 import 而不是静态——tier 判定库缺失/损坏时不许把 hook 自己带崩，退到 standard 列走严格：
 * 不放行，也不把只提醒的闸擅自升成硬拦（少一个文件不该改变闸的性质）。
 * 全部非地板 hook 共用这一份：换档位实现时只改这里，挨个改漏一个就是一个静默走旧档的闸。
 */
export async function gateModeOf(hookId) {
  try {
    const m = await import('./tier.mjs');
    return m.gateMode(hookId);
  } catch (_e) {
    if (FALLBACK_ADVISE.has(hookId)) return 'advise';
    return FALLBACK_GUARDS.has(hookId) ? 'block' : 'on';
  }
}

/** 只关心「要不要静默放行」的闸用这个（= gateModeOf 的 off 分支），三态闸直接用 gateModeOf。 */
export async function fastOff(hookId) {
  return (await gateModeOf(hookId)) === 'off';
}
