---
name: gate-vocabulary-vs-artifact-templates
description: 审「占位/残留」类文档闸的第一刀——闸认的槽语法与产物模板真用的槽语法对拍，再数它覆盖了几条退出路径
metadata:
  type: project
---

本仓的 predev-lint / spec-lint 这类「查半截文档」的闸，规则是**闸的作者凭印象写的槽形状**，
产物模板是**另一个人（另一次会话）写的**。两边从不对表，就出现整份文档零覆盖。

1. **拿模板当文档喂进去，看它过不过**。最短的一刀：`cp 模板 $tmp/<正式文件名>` 再跑闸。
   2026-09-10 实测五份模板：Design-Brief / Architecture-Design / DFX-Spec 三份**原封不动 ok=true 0 error**，
   DESIGN 只出 4 条且是别的规则误打误撞。原因是闸只认 `<...>`，而 brief / design-md 模板用 `{{...}}`
   （67 / 79 行），arch / dfx 模板用 `[core]` `[技术]`。**闸装在五份文档上，词汇表只对上一份。**
2. **逐行注入法比整份跑更能定位**：把模板里每一条候选行单独追加到*合法范例*末尾，一行一次跑闸，
   记 HIT/MISS。这样上下文是合法的，报没报只由那一行决定；顺带能分出「行内反引号豁免」
   「围栏内示例」这些本来就该放过的。反向那半也要跑：模板自带的示例数值行（`P95 <200ms`）不许假红。
3. **提修复方案之前先量假红**：`{{...}}` 在五份*已填范例*里出现 0 次 → 加规则零假红，可以直接提；
   `[...]` 在 arch/dfx/spec 范例里各有 1-2 处真内容（还没算 `[确认]` 标记和 markdown 链接）
   → naive 方括号规则会把范例打红，不能照抄。
4. **一条口径要数它落在几条退出路径上**。ui-audit 的「缺席不许留旧报告」只写在
   「目标既不是 URL 也不是目录」那一支：目标为空串、`--themes` 解析空、未知参数三条 rc 2
   与顶层 `main().catch` 的 rc 2 全都把上一轮 `pass:true` 原样留着。查检：把每个
   `process.exit(非0)` 点数出来，逐个问「这条口径在这里执行了吗」。

5. **模板 dogfood 要数到「每个槽」，不是数 rc**。rc 1 只证明这份模板过不去，不证明它把槽都点名了。
   做法：自己用同一条正则（剥行内反引号、跳围栏）独立数一遍每份模板的槽，跟闸输出的 findings 行号
   逐份对拍。2026-09-10 五份实测 75 / 48 / 51 / 3 / 0 条，与闸输出一条不差——对得上才敢说「点名了」。
   顺带能看出哪份模板根本没用这套槽语法（product-spec 是 0 个 `{{…}}`、40 处 `<…>`）。

6. **参数解析异常是一条独立出口，且天然早于配置解析**。「未完成出口不许留旧证据」这条口径，
   作者会在 parseArgs 的 catch 里写「--out 还没解析出来，作废不了」当理由——只有坏的那个正是 --out
   时才成立；`--bogus` / `--widths` 缺值这类，--out 完好却照样把上一轮 pass:true 留在原地。
   同一族还有**过滤式解析静默丢坏值**：`split(",").map(Number).filter(n=>n>0)` 让 `--widths 1280,abc`
   变成只跑一半的矩阵还报 pass，而全坏时反而 rc 2。查检：把每个「拆分—转换—过滤」的入参各喂一次
   「全坏 / 半坏」，两次的口径必须一致。

**Why:** 这类闸的价值全在「半截产物过不去」。词汇表对不上模板 = 闸对那份文档不存在，而它照报绿。

**How to apply:** 审文档闸先做 1 和 4，五分钟出结论，比读实现快得多；报缺陷时附「模板 N 行槽 → 报 0 条」。
相关：[[pattern_gate-scripts-false-green-in-machine-channel]]、[[pattern_exempt-zone-and-section-scoping]]、[[pattern_duplicated-rule-tables]]

7. **「崩了兜底用的预扫」和真解析器必须同一套胜出规则**。ui-audit 为「参数解析失败也要作废旧报告」
   加了 `prescanArgs(argv)` 手扫 `--out`，写成**首位胜**（`if (out === null) out = …`），而
   `node:util` 的 `parseArgs` 无 `multiple` 时是**末位胜**。`ui-audit.mjs site --out A --out B --bogus`
   → rc 2，作废了 A，而真跑会写的 B 原样留着 `pass:true` + 旧 screenshots。
   同族查检：预扫与真解析对**重复 flag / 等号写法 / 末位缺值 / 空值**四种输入逐个对拍，比的是
   「两边算出来的目录是不是同一个」，不是「有没有作废」。`--out=` 空值还有一层：`'' ?? DEFAULT` 不兜底、
   `resolve('')` = cwd，坏值校验管 `--widths` 空项却不管 `--out` 空值，两条入参的口径不一致。

8. **突变要打在「本批新加的那一行」上，不是打在功能上**。第八批七条突变（围栏扫槽 / 剥槽再扫记号 /
   catch 里预扫 --out / widths 坏值 / absent 的 screenshots / prescan 认 --out= / themes 空项）
   逐条改回旧写法，两套契约各红 1-2 条，全 CAUGHT。省事的做法：本仓两套契约都接受
   `bash test-xxx.sh <被测脚本路径>`，`cp` 到 /tmp 改副本即可，一个项目文件都不用碰。

9. **prescan 的「末位胜」修完了，漏的是「值位上站着另一个 flag」**。`site --out --strict`：node
   parseArgs 抛 "argument missing"，prescan 却照 `argv[i+1] !== undefined` 把 `--strict` 当目录名
   （ui-audit.mjs:248）→ 作废了一个叫 `--strict` 的目录，真正会被写的默认目录留着 pass:true。
   对拍矩阵要补一列「值位缺失 / 值位是 flag」，判据仍是「两边算出来的是不是同一个目录」。
   **验作废前必须给每个候选目录各种一份 stale 报告**：markAbsent 只覆写已存在的报告
   （ui-audit.mjs:221 `if (!(await stat(reportPath)…)) return;`），不种就是满屏「没动」，看不出谁被作废。
10. **突变全绿要分两种**：M7（`--out=A --out=B` 等号式末位胜）、M8（emptyOut 去 trim，即全空白目录名）
    突变后套件仍 20/0，但实跑现行代码行为是对的 → 记「测试存疑（覆盖缺口）」，不记缺陷。
    判法：突变全绿之后必须再实跑一次现行代码看真实行为，别把「没测」直接写成「有 bug」。
11. **预扫要对的不是「`--` 前缀」，是 node 的 `isOptionValue`**。实测 node v24.14.1：`--out -x`
    和 `--themes -x` 都抛 "argument is ambiguous"（还教你改用 `--out=-XYZ`），只有单字符 `-` 被当合法值。
    所以自创的 `next.startsWith('--')` 天生漏一整类：`--out -x` 走 catch → 预扫把 `-x` 当目录名 →
    作废了 `./-x`、真正存着 `pass:true` 的默认目录原封不动。正解是照抄 node 的判据
    `next === undefined || (next.startsWith('-') && next !== '-')`。等号分支要同步补同一条，否则
    `--out=--x --bogus`（预扫取字面）与 `--out=--x`（解析后按缺值退默认目录）算出两个目录。
    **固定实验**：先用 `node -e` 拿 parseArgs 对 7 种入参的真实反应做表，再拿表去对预扫，别读代码猜。
12. **突变全绿的第三种：整块新加分支零覆盖**。把 post-parse 的 `flagOut` 改成 `false`，22/0 照绿——
    因为空格写法早被 parseArgs 抛掉了，这块唯一可达的入口是等号写法，而契约一条等号用例都没有。
    连带塌的是它的**理由**：注释写「parseArgs 照吞不误」，实测是抛错。**注释里断言外部库行为的，
    当场跑一条 `node -e` 验；注释错了，整块分支的存在依据就得重问**。

13. **模板 dogfood 数槽时，自己的裸 grep 会比闸少数**（2026-09-10）：`{{`{a.b}`}}` 这种反引号嵌套槽，
    裸 `\{\{[^{}]*\}\}` 数不到，闸先 stripCode 再扫就数到了（Design-Brief 模板 114 行，闸 75 vs 裸数 74）。
    差 1 别急着报缺陷，先逐行 diff 出是哪一行——多半是自己的尺子糙。顺带能看出闸回显的是剥完的
    `{{``}}` 而不是原文，行号在、可定位，算文案 Low。
11. **「缺值→回默认」修完了，漏的是「缺值那次前面还有个有值的同名 flag」**。ui-audit 第十一批把
    值位以 `-` 开头判成缺值，但 prescan 写的是 `if (arg === '--out' && !missing) out = next;`
    （ui-audit.mjs:251）——缺值时 `out` **保留前一个** `--out` 的值，而不是退回 null / 默认目录。
    `site --out A --out -x` → 作废 A、默认目录留 pass:true；同语义走解析成功通道的
    `site --out A --out=--strict` → 作废默认、A 不动：**同一个输入语义，两条通道给出不同目录**，
    正是这批要立的「两通道同判」。对拍矩阵的那一列要写成「重复 flag × 末位缺值」，只测单个 flag 缺值
    （U20）和重复 flag 都有值（U18）会正好跨过它。修法一行：`out = missing ? null : next`。
