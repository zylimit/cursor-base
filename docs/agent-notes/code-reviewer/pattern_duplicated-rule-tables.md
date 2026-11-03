---
name: duplicated-rule-tables
description: 本仓「同一张规则表抄成 N 份」的固定审法——先数清到底几份，再对每一份单独做删除突变看有没有闸
metadata:
  type: project
---

本仓有意不共用来源的重复表（排除表 / 规则表）不止一处，作者在注释里会写「另有两份，改这里必须
同改」。**那句注释是待验证的断言，不是事实**。2026-09-03 审 #27 排除表时四条全中：

1. **先自己数一遍有几份，别信注释里的数字**。#27 注释写「三处」，实际是四处
   （`setup.sh` / `gen-manifest.sh` / `setup.ps1` / `release.mjs MANIFEST_RULES`），
   加上 `core.mjs` 的 `STATE_EXCLUDE` + `STATE_EXCLUDE_PREFIXES`（同一批运行态目录、另一个用途）就是六份。
   查检：拿表里一个**独有**条目（如 `harness/trend`）全仓 grep，命中几个文件就是几份。
2. **逐份做删除突变，每份单独跑闸**。四份里只要有一份没有任何测试盯着，它就是唯一会漂的那份。
   本轮 `release.mjs` 那份删掉全部 8 条新规则后 selftest 267 + golden 20127 全绿——真修复零覆盖。
3. **对齐要双向查**：不光「该排的排了没」，还要「排过头了没」。正向用 `git ls-files` 看被排除的
   前缀下有没有 tracked 文件；反向拿一个真框架文件（`harness/harness.mjs`）过一遍membership 函数。
4. **表的补集也要查**：把 `.gitignore` 逐条对着排除表比。本轮 `.DS_Store` / `Thumbs.db` / `*.swp`
   在 gitignore 里、不在排除表里 → Mac 上跑一次生成器就把机器垃圾写进 tracked 清单。

2026-09-03 复审「四份表对齐」的补测（作者补了 `test-setup.sh ⑥` 逐臂对照 + `⑥b` 行为面）时又中三条：

5. **「逐臂对照」若是整文件 `grep -F` 子串匹配，就等于给部分臂发免检**。臂名在同一文件别处出现过
   （注释、别的逻辑、或它自己是另一条臂的子串）就永远查得到。本轮 `settings.json` 在 setup.sh 出现
   13 行、`FRAMEWORK-MANIFEST.txt` 5 行，删掉这两条 case 臂 ⑥ 照绿；`.DS_Store` 是 `*/.DS_Store`
   的子串，删前者也绿。查检：对每条臂做删除突变（不是读代码），并先数 `grep -cF <臂> <文件>`，>1 的都是裸奔位。
6. **集合相等 ≠ 表相等，臂序才是语义**（`case` 与 `manifestIncludes` 都首中即返回）。⑥ 只查成员
   不查序。必须有一条「keep 臂目录下的垃圾文件」用例（本仓 `feedback/templates/.DS_Store`）才锁得住序——
   有它的两侧（release.mjs / gen-manifest+setup.sh）reorder 会红，没它的那侧（setup.ps1）不会。
7. **不同实现的表不能只比 token，要比语义**。`setup.ps1` 用 `$skip -contains (Split-Path $rel -Leaf)`
   = 任意层级 leaf 匹配，另三份是根锚定；34 臂里 16 条（settings*.json / 各运行态标记 /
   FRAMEWORK-MANIFEST.txt）不等价，⑥ 的映射表却把它们注成「语义等价」。后果是嵌套同名文件
   进清单、setup.sh 装、setup.ps1 静默跳过 = Windows「在清单但没装」。**`setup.ps1` 的拷贝逻辑
   全仓零行为测试**（`test-ps1-behavior.ps1` 不含 setup），字面 grep 是它唯一的守卫。

**测试夹具依赖开发机脏状态 = CI 上恒绿**（同轮抓到的第二类）：`test-setup.sh` 新增的「运行态目录
不入装」断言不自己造夹具，靠源树**碰巧**有 `harness/state/` 才有力。dev 机脏树上删排除项会红，
CI 干净 checkout 上删同样的排除项全绿——闸只在不需要它的地方响。
固定实验：把源树复制一份、删光运行态文件（模拟 CI checkout），再做突变，看还红不红。
（⑥b 是正解范式：自己在 mktemp 里搭迷你源码树跑真安装器，与源树脏净无关。）

2026-09-04 审「一张表拆成两半、只补了一半的覆盖」时又中两条：

8. **同一批排除规则常拆成两半各管一种输入**（本仓 `core.mjs` 的 `STATE_EXCLUDE` 是 git pathspec、
   只对 tracked/force-add 生效；`STATE_EXCLUDE_PATHS`+`STATE_EXCLUDE_PREFIXES` 是 `isStateExcluded`、
   管 untracked 与其余九个调用点）。补了 tracked 那半的逐条覆盖，**不等于** untracked 那半有覆盖。
   实测：删 `':(exclude).claude/harness/state/**'` → 新测试恰红 2 条；删 `'.claude/harness/state/'`
   → selftest 268 / release-manifest 49 / test-harness 82 **三套全绿**。裸奔在姊妹半边。
9. **新测试的头注释会把姊妹半说成「已被某条老用例覆盖」——那句同样是待验证断言**。
   本轮注释写「③ 走的是 `STATE_EXCLUDE_PREFIXES`」，实际 ③ 只造了 `.runtime/` 一条。
   查检：拿姊妹半的每一条做删除突变，别信「走的是同一条路径所以顺带覆盖了」。
   另：逐条表驱动的测试要有**条数对拍闸**（臂数 vs 源码表长度），否则表加第 11 条时静默失覆盖——
   同 ⑥ 那条 `-ge 20` 下限失守的同型。

10. **表驱动测试的完备性闸要「条数写死 + 成员集合双向差集」，不是 `-ge N` 下限**。正解范式：
    从被测源码里正则抠出数组字面量成员，与测试自己的用例表 `comm -23 / -13` 双向比，抽取失败要
    单独 fail（防「正则半坏 → 空转全绿」）。验它用两次突变：加第 11 条（④/⑤ 全程沉默、只有对拍闸响）
    与条数不变改名（差集报出 core 独有 / 本文件独有）。
11. **行为面的红锁也会给单臂免检——夹具把两条臂塞进同一次跑，断言只是个 `||`**。2026-09-06 D-R2：
    `three-file-sync-gate` 的扩展名表补了 `mjs|cjs`，TF-17 的夹具同时改 `src/a.mjs` 与 `src/a.cjs`，
    只删 `mjs` 那一臂套件 **248/0 全绿**（`cjs` 顶上了），两臂同删才红。这不是 grep 匹配的锅，是夹具
    一次改多条臂。查检：每条臂单独一个夹具（一个仓只放一种扩展名），或至少对每条臂各做一次删除突变。
相关：[[pattern_gate-scripts-false-green-in-machine-channel]]、[[pattern_golden-baseline-rulers]]、[[pattern_path-naming-contract]]
