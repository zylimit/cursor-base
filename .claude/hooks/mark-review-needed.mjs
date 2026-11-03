// PostToolUse hook: 项目业务代码被编辑/创建后，把文件登记进待审清单
// 设计（15W 规模优化）：
//   - 全局布尔 → 按文件登记：.needs-review 每行一个待审文件（相对项目根）
//   - 豁免判断基于「相对项目根路径」并顶层锚定：仅根级 tools/ 与 .claude/ 框架自身豁免，
//     不会误伤 src/tools/、packages/x/tools/ 这类业务目录
//   - 扩展名豁免用白名单末段，不用 *.env.* 中段通配（避免误伤 db.env.ts 源码）
//   - 登记前先归一路径（反斜杠转正斜杠 + 折叠 ./..）：src/../../out.ts 这类折完出根的不登记，
//     免得留下一条永远匹配不上、也就永远清不掉的脏行，把 stop-gate 卡死
//   - 拼法说「在根外」时再问一次身份：两侧同过 realpathSync.native 展开 8.3 短名
//     （C:\Users\ABC123~1 与 C:\Users\Administrator 是同一处）与 symlink 后重判，
//     免得项目内的文件被当成项目外——那等于跳过审查
//   - 读改写加锁串行（独占创建 .needs-review.lock，陈旧锁可回收），防并发 PostToolUse 互相截断；
//     等不到锁就裸跑登记，但出门时绝不删自己没拿到的那把锁——删了持锁方还在临界区，两边并发写会丢登记
//   - 无 file_path / 输入损坏 → 优雅降级退出，恒 exit 0（记账 hook，不为一条怪路径拦住工具）
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, readStdinJson, toPosix, say, fastOff, runFailOpen } from './lib/io.mjs';

const LOCK_STALE_MS = 5000;   // 锁超过这么久没释放视为持锁进程已死，可回收
const LOCK_WAIT_MS = 1000;    // 总等待上限（PostToolUse timeout 只有 3s，等不起更久）

/**
 * 身份形态：从存在的最近祖先开始展开真实路径，剩下的按字面拼回去。
 * 两侧必须同用 realpathSync.native——Windows 上它展开 8.3 短名并归一大小写，
 * 一侧用它、另一侧不用，会把同一个目录的两种拼法读成两个地方（core.mjs:388 同理）。
 */
function realish(p) {
  const abs = path.resolve(String(p));
  let cur = abs;
  const tail = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return tail.length ? path.join(real, ...tail) : real;
    } catch (_e) {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;   // 走到卷根都没有一段能解析
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/** path.relative 的答案是否根本没待在 base 底下（要往上爬，或跨盘符压根没有相对路线）。 */
function escapes(rel) {
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
}

/** 独占创建锁；被别人持着且未陈旧就等，陈旧则回收。拿不到锁返回 -1（裸跑，登记比串行重要）。 */
function acquireLock(lockFile) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      return fs.openSync(lockFile, 'wx');
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return -1;
      let age = 0;
      try { age = Date.now() - fs.statSync(lockFile).mtimeMs; } catch (_e) { age = LOCK_STALE_MS + 1; }
      if (age >= LOCK_STALE_MS) {
        // 持锁者已死（或上一次跑被 kill）——回收，否则这条锁会把后续所有登记挡到天荒地老
        try { fs.rmSync(lockFile, { force: true }); } catch (_e2) { /* 回收失败下一轮再试 */ }
        continue;
      }
      if (Date.now() >= deadline) return -1;
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); } catch (_e2) { /* 等不了就直接再试 */ }
    }
  }
}

/** 释放锁：只有真拿到锁（fd >= 0）的那一趟才删锁文件——裸跑那趟删掉的会是别人的活锁。 */
function releaseLock(fd, lockFile) {
  if (fd < 0) return;                                    // 没拿到锁就没有可释放的东西，动了就是删别人的
  try { fs.closeSync(fd); } catch (_e) { /* 已经关了 */ }
  try { fs.rmSync(lockFile, { force: true }); } catch (_e) { /* 残留锁下次按陈旧回收 */ }
}

runFailOpen(async () => {
  if (await fastOff('mark-review-needed')) return;

  const input = readStdinJson();
  if (!input) return;                                   // 输入损坏：记账 hook 静默放行，不凭空建清单
  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath || typeof filePath !== 'string') return;

  const rootAbs = path.resolve(projectDir());
  const rootPosix = toPosix(rootAbs).replace(/\/+$/, '');
  const raw = toPosix(filePath);
  const isAbs = path.isAbsolute(raw) || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw);
  // 相对路径按项目根解析；此处只做字面拼接，折叠留到下一步（先分清「项目外」与「折完出根」两件事）
  const litAbs = isAbs ? raw : `${rootPosix}/${raw}`;

  let rel;
  if (litAbs === rootPosix || litAbs.startsWith(rootPosix + '/')) {
    rel = litAbs.slice(rootPosix.length + 1);
  } else {
    // 拼法说在根外：再问一次身份（8.3 短名 / symlink 展开后可能其实同一处）。
    // 两次都说在外面 → 项目外的一次性脚本，不是项目代码，静默不登记
    const relId = path.relative(realish(rootAbs), realish(litAbs));
    if (relId === '' || escapes(relId)) return;
    rel = toPosix(relId);
  }

  // 前缀比对挡得住 /tmp/x.ts，挡不住 src/../../out.ts——那条拼出来的字面量照样以项目根开头，
  // 原样登记就是一行谁也匹配不上、谁也清不掉的脏行，stop-gate 从此拦停不放。
  const folded = path.posix.normalize(rel);
  if (folded === '' || folded === '.' || folded === '..' || folded.startsWith('../')) {
    say(`[mark-review-needed] 未登记 ${litAbs}：折完 ./.. 落在项目根外（${folded || '空'}），登记了也永远清不掉`);
    return;
  }
  rel = folded;

  // 豁免 1：基础设施/框架自身（顶层锚定，由独立 code-reviewer 手动审，不进自动闸门）
  if (/^(tools|\.claude)\//.test(rel)) return;
  // 豁免 2：文档/配置类（按最终扩展名白名单）
  if (/\.(md|txt|json|yaml|yml|toml|lock|log|gitignore|prettierrc|eslintrc)$/.test(rel)) return;
  if (/\.env(\.(local|development|production|test))?$/.test(rel)) return;

  const stateFile = path.join(rootAbs, '.claude', '.needs-review');
  const lockFile = `${stateFile}.lock`;
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); } catch (_e) { /* 建不出来下面写也会报，交给 fail-open */ }

  const fd = acquireLock(lockFile);
  try {
    let lines = [];
    let prior = null;
    try { prior = fs.readFileSync(stateFile, 'utf8'); } catch (_e) { prior = null; }
    if (prior !== null) {
      lines = prior.replace(/\r/g, '').split('\n').filter((l) => l !== '');
      // 上一轮已 clean（或文件不存在）→ 开新清单，别与待审路径混存
      if (lines.includes('clean')) lines = [];
    }
    if (!lines.includes(rel)) lines.push(rel);           // 去重登记
    fs.writeFileSync(stateFile, lines.length ? lines.join('\n') + '\n' : '');
  } finally {
    releaseLock(fd, lockFile);
  }
});
