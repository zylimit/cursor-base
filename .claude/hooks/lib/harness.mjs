// harness.mjs — 大仓治理引擎的调用面（hook 侧）。
// 默认关闭：开关是 catalog 文件 .claude/harness/module-catalog.json——存在才算启用，
// 不存在时调用方跳过 harness 分支、走原逻辑、零行为变化。
// 启用要两件事都齐：catalog（开关）+ .claude/harness/ext/（引擎包，setup.sh --with-harness 才装）。
// 只齐一半时闸跑不成，调用方须用 harnessExtInstalled() 判出来并当场说一句，不许静默放行。
//
// 调引擎一律起**独立子进程**、只看退出码与 stdout，绝不 import 引擎代码：引擎的 lib/ 被删时
// hook 还得起得来并判出「引擎跑不成」。node 定位直接用 process.execPath（自己就是 node 起的，
// 不必再 command -v 探一遍）。
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, run } from './io.mjs';

/** catalog 开关文件路径。 */
export function harnessCatalogPath() {
  return path.join(projectDir(), '.claude', 'harness', 'module-catalog.json');
}

/** 大仓治理是否启用（唯一开关）。 */
export function harnessEnabled() {
  try { return fs.existsSync(harnessCatalogPath()); } catch (_e) { return false; }
}

/**
 * 引擎包（.claude/harness/ext/）装没装。目标项目默认不装，`setup.sh --with-harness` 才有。
 * catalog 是开关、ext 是引擎：只放开关不装引擎时子命令一律 rc 3 + stderr `not installed`、stdout 空，
 * 各闸把 rc 3 读成「没建立结论」就静默放行——与「验过了没问题」长得一模一样，正是假绿那一格。
 */
export function harnessExtInstalled() {
  try { return fs.existsSync(path.join(projectDir(), '.claude', 'harness', 'ext')); } catch (_e) { return false; }
}

/** catalog 在、引擎包不在时三道闸共用的同一句话，只有闸名不同（各闸出口形态不同，文案不许各写各的）。 */
export function harnessExtMissingNotice(gateName) {
  return `大仓治理已开启（module-catalog.json 在）但引擎包未装，本次 ${gateName} 未验；`
    + '跑 `bash setup.sh --with-harness` 装包，或删掉 catalog 关闭大仓治理';
}

/** 引擎入口路径。 */
export function harnessEntry() {
  return path.join(projectDir(), '.claude', 'harness', 'harness.mjs');
}

/** 跑引擎子命令，透传 argv；返回 {status, stdout, stderr, error}。 */
export function harnessRun(argv, opts = {}) {
  return run(process.execPath, [harnessEntry(), ...argv], opts);
}

/**
 * 退出码是否在契约内。契约外 = 引擎自己崩了（缺 lib/ / 内部异常），不是闸给出的结论——
 * 「引擎跑不起来」和「门真没过」该做的事完全不同，混为一谈就会把崩溃读成通过。
 * 契约表见 harness-large-repo.md 退出码契约段（随 --with-harness 装进 .claude/rules/，源在 .claude/harness/ext/rules/）。
 */
export function rcInContract(rc, ...codes) {
  return codes.some((c) => Number(c) === Number(rc));
}

/** 引擎 stderr 的头几行（去空行、取前 3 行、拼成一行、截到 400 字符）；无内容返回空串。 */
export function errHead(stderr) {
  return String(stderr || '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 3)
    .join(' ')
    .slice(0, 400);
}
