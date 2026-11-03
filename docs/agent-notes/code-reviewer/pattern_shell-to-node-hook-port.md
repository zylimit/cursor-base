---
name: shell-to-node-hook-port
description: 审 .sh/.ps1 → .mjs 单运行时移植（Phase D 这类）的六条固定攻法，含三条真命中的缺陷形态
metadata:
  type: project
---

`.sh`/`.ps1` 成对 hook 收成单份 `.mjs` 时，红锁一般钉得住退出码/状态文件/JSON 字段（突变一改就红），
真漏的都在**红锁的视野之外**。按这六条攻，2026-09-06 的 D-R 靠它们出了 3 个 P2。

**Why:** 移植类改动的红锁是照契约卡写的，契约卡只描述「输入→输出」，不描述并发、宿主副作用、
降级路径的**量级**。这三处正是 shell 换 node 时语义悄悄变掉的地方。

**How to apply:** 逐条真跑，别读代码下判断。

1. **锁：release 有没有检查自己是不是锁的主人。** shell 的 flock 绑 fd、进程一死自动放；node 换成
   `openSync(lock,'wx')` 后，`finally` 里那句 `rmSync(lock)` 常常是**无条件**的——拿不到锁走裸跑
   的进程出门时会把别人的活锁删掉。攻法：A 真持锁 → B 起（必然拿不到）→ B 退出后断言锁**仍在**。
2. **「失败了照跑」的 catch 要问量级，不问方向。** 防抖标记/缓存写失败时注释常写「最多多跑一次」；
   实测往往是**永久失效**（读不到标记 = 永远判没跑过）。攻法：把标记文件做成目录让写恒 EISDIR，
   数 N 次事件触发了几次真活。
3. **回归夹具会不会让守卫真动手。** 沙箱只隔状态文件，隔不了端口/进程/网络。`kill-dev-ports` 那条
   夹具喂真 `pnpm dev`，于是每跑一次 run-all 就 `kill -9` 宿主机上占 3000/5173/8080 的进程
   （Windows 上是 `taskkill /F`）。攻法：起个自己的靶子进程监听表内端口，跑一遍夹具看它还在不在。
4. **平台分支函数没 export = Linux 侧零覆盖。** `killWindows(port, netstatOut)` 这种纯函数本可以
   在 Linux 上喂样例单测，但内联在 `if (process.platform==='win32')` 里且不导出，就成了「Windows CI
   上执行了但没有任何断言」。数 `grep -c 'netstat|LISTENING|taskkill' 测试文件` 即知。
5. **同一口径抄成 N 份时要逐份对拍字面，不是数份数。** 「待审计数」四份实现里三份 `l !== 'clean'`、
   一份 `l.trim() !== 'clean'` —— `" clean "` 下状态栏报干净而 Stop 闸拦着不放。攻法：造带首尾空格
   的边界值，四个消费方各跑一遍比答案。
6. **`.sh` 里的扩展名/路径表逐字搬过来后，意义会变。** `three-file-sync-gate` 的代码扩展名表原本有
   `.sh`（框架自己就是 .sh），移植后框架全成 `.mjs` 而表里没有 `mjs|cjs` —— 本仓被 `.claude/` 那一
   支兜住，**目标项目的 `server.mjs` 不兜**。攻法：沙箱里改已跟踪文件（改未跟踪文件会被 git 折成
   目录名 `src/`，测不出扩展名分支）。

**复核轮（D-R2）的固定动作：每条修复各来一次突变，专找「修了但没锁」。** 2026-09-06 七条修复逐条
复现全过，突变却查出三处裸奔：TF-17 给 `.mjs` 那一臂免检（见 [[pattern_duplicated-rule-tables]] 11）、
待审清单 trim 归一零锁（去掉 trim 套件 248/0 全绿）、`projectDir()` 统一零锁（退回 `env || cwd` 也全绿——
测试夹具每次都注入 `CLAUDE_PROJECT_DIR`，两级与三级兜底在测试里根本不可区分）。查检：拿修复前那版
（`git archive <修复前 commit>` 整棵拉出来）跑同一夹具对拍，能证明「修的是真行为」；再把修复反着突变一次，
才知道有没有锁。突变别在真仓做——`cp -a` 出 playground（含 .git）改副本，真仓 `git status` 全程为空，
比「改完再还原」更硬。

已守住、攻不破的（别重复攻）：`gate.yml` 与 `test-ps1-behavior.ps1` 的 `.ps1` 递归扫描都带 `-Force`
并加了「扫到的少于点名清单即判失败」的空转防线；`Atomics.wait` 在 node 主线程真能睡（实测 1001ms），
不是可移植性问题。相关：[[pattern_installer-and-selfcheck-attacks]]、[[pattern_duplicated-rule-tables]]、
[[pattern_cross-platform-coverage-claims]]。
