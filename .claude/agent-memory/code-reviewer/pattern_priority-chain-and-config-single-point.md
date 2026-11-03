---
name: priority-chain-and-config-single-point
description: 审「优先级链判定函数」（floor → overrides → 表 → 兜底）与「用户可改配置文件」的四条攻法；突变全绿常因兜底答案与被删分支恰好相同
metadata:
  type: project
---

审档位 / 权限 / 策略这类**优先级链**判定函数（本仓 `hooks/lib/tier.mjs` 的 `gateMode`：floor → overrides → 档位表 → 未登记兜底），以及随之而来的「用户可改的 JSON 配置」时，固定这四刀。

**Why:** Phase A 审查用 10 条突变打，9 条被红锁抓住，唯一漏网的正是「删掉 floor 分支」——因为地板闸不在档位表里，删了 floor 后落到「未登记→最严」兜底，**答案一模一样**，两套红锁（71 条 + 277 条）一条都没响。同一轮还挖出引擎侧 `selftest.mjs` 顶层 `JSON.parse(readFileSync(profile.json))` 把 40 个子命令一起带崩。

**How to apply:**

1. **兜底与分支答案撞车 = 突变免疫。** 删任一优先级分支后跑全套红锁；全绿**不代表分支是死代码**，先问「有没有输入能让这条分支和它下游的兜底给出不同答案」。本仓的分叉输入是 `overrides` 压在地板闸上：有 floor 分支 → `block`，没有 → `off`。造出分叉输入再判它有没有红锁。
2. **声明面与执法面要逐个对表。** 配置表里登记了 N 个条目，就 `grep -c` 每个执法点是否真的调了判定函数。本仓 16 个表内 hook 里 `session-rules-banner` 一个不调——于是 `tier status` 报它 `off`、它照喊，报的模式没人执行。判据：**「谁报」和「谁执行」必须是同一份读数**。
3. **可选/可选缺的配置文件，查它在哪被顶层读。** `grep -n "^const .*JSON.parse(fs.readFileSync" lib/*.mjs` —— 模块顶层的读盘 = 整个进程的单点故障。特征反差最能说明问题：读侧（hook）写了完整的 ENOENT/坏 JSON 降级，写侧（引擎）一个顶层读就把降级全废，而**为这件事写的错误分支恰好在这件事发生时不可达**。连带查：出事后 `doctor` 还能不能跑（自诊工具跟着崩=没救）、commit 闸会不会因为「契约外退出码」硬拦。
4. **复核「配置缺/坏已修好」用四变体矩阵，别只试一种坏。** 空目录 `git init` 沙箱拷引擎 + 被 import 的 lib，配置文件依次换成：不存在 / 语法坏 / 空文件 / **合法 JSON 但不是对象**（`[1,2,3]` 这支最常漏，它过得了 `JSON.parse`），每种再乘「校验子命令 + 自诊 doctor + 只读 status」。三条判据一起看：rc 合不合退出码契约、**stdout 是不是仍为纯 JSON**（人话必须走 stderr，混进 stdout 就是机器通道被污染）、stderr 有没有 `SyntaxError|at .*\.mjs:\d+` 栈泄漏。修法认惰性读 + catch 退内置默认表，不认「顶层挪个位置」。
5. **校验器的「规则跳过」要进 ok/rc。** 校验器依赖第二份文件（本仓 `settings.json` 推注册 hook 名单）时，那份读不出就有若干条规则静默不跑。查 `ok` 与退出码有没有消费「读得出吗」这个字段——只把 `readable:false` 放进 JSON 而 rc 仍 0，就是 [[pattern_gate-scripts-false-green-in-machine-channel]] 的同一张脸。

配套：子串断言锁不住字段。`hasq 'override'` 分不清 `override:` 字段和 `source:"override"`，删掉字段仍全绿——锁 JSON 就解析 JSON 断字段，别 grep 整段文本（同 [[pattern_duplicated-rule-tables]] 的「字面 grep 会发免检」）。
