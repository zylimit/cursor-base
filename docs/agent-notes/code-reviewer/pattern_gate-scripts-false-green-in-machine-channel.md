---
name: gate-scripts-false-green-in-machine-channel
description: cc-base 闸脚本的高发缺陷——覆盖缺口只写进 findings，退出码和 ok 字段仍报绿
metadata:
  type: project
---

本仓每写一个新闸脚本，都要按同一条线攻："有没有一条路径，是**没检查成**却报绿的？"
2026-09-01 审 `.claude/harness/audit/` 三只脚本时，三只全中同一模式：
跳过的类 / 超限没扫的文件 / 参数错导致扫了 0 个文件，都老老实实写进了人读输出和
findings 数组，但 **exit code 与 JSON 的 `ok` 字段只由 error 级命中决定**，一律 0/true。

**Why:** 人读那行只有人看；CI 和 git hook 消费的是 `$?` 和 `jq -e .ok`。
两个机器判据都报绿 = 覆盖缺口对唯一会拦人的那一方不可见。这跟本仓自己的
「缺命令 = BLOCKED，绝不假绿」「未执行 != 通过」立场自相矛盾。

**How to apply:** 审任何新闸时固定造这四个样例，逐个看 rc 和 ok：
① 检查器缺失（PATH 上拿掉 bash/pwsh）② 文件超 size 上限 ③ 文件读不了（权限/坏符号链接）
④ 参数写错或文件集为空。凡是「记录了但 rc=0 且 ok=true」的，就是一条 finding。
本仓已有的正解可以引用：harness 的四态门用 BLOCKED、rc 3 表降级，别让降级挤进 rc 0。

2026-09-02 复审同三只脚本，rc/ok 那层修好了，假绿换了三个新落点，都要单独造：
⑤ **换 cwd**。脚本靠 `git ls-files` 取清单、靠相对路径正则认文件。在子目录里跑，
   清单变成子目录相对路径，模式全不匹配，三只齐报 `rc 0 ok:true`、计数全 0——
   「一个文件都没扫」被印成通过。固定实验：`cd .claude && node <脚本>`，比对根目录结果。
⑥ **flag 组合把已修的路径开回来**。`--staged --paths X` 里 `--paths` 赢、`--staged`
   被静默丢掉，内容重新从工作树读——正是刚修掉的「名单来自索引、内容来自工作树」。
   审任何带互斥 flag 的脚本，把 flag 两两组合跑一遍，看 source 字段。
⑦ **降级路径永远为真 = 降级信号作废**。submodule gitlink（`ls-files` 列它、`statSync`
   不是普通文件、`git show :path` 直接失败）让每次运行恒 rc 3。恒红等于没红，
   接闸的人下一步就是忽略 rc 3。「本该出范围」和「该扫没扫成」必须分成两个桶。
相关：[[project_cc-base-is-a-framework-repo]]

2026-09-10 又添一个落点：⑧ **rc 诚实、证据文件不诚实**。`ui-audit.mjs` 引擎缺席时老实退 3、
stdout 不出 JSON，但**上一轮的 `.claude/evidence/ui-audit/ui-audit.json` 原样留着**（`pass:true`），
而 code-review skill 明写「有该文件则引用其 pass 作证据」——报告里还没有时间戳 / run id，
陈旧不可辨。凡是「闸写一份证据文件、别人读那份文件」的设计，固定造：先跑一次成功留档 → 再制造
失败/缺席 → 看那份文件是被覆盖成失败态、被删、还是原样躺着。三选一里只有前两种是诚实的。

⑩ **把一堆能力拆成「可选包」时，旧开关会原地变成假绿开关**（2026-09-15，引擎拆 `harness/ext/`）。
拆之前 catalog 在 = 能力在；拆之后还得先 `--with-harness` 装包。两者脱节那一格（catalog 在、包没装）
上游读的是同一个 rc 3——原义「降级但有结论」，新义「压根没装」——`stop-gate` / `pre-commit-check` /
`harness-async-verify` 三个闸一齐 rc 0 零输出静默放行，而用户按细则文档以为治理开着。固定攻法：
把「启用开关」和「新前置条件」列成二维表，**四格各跑一次**，看有没有哪格是「以为开着、实际静默」；
再看退出码有没有被塞进第二个含义（同一个码两种因果 = 上游无从分辨）。配套查：随包搬走的细则文件
往往一个字没改（`git status` 显示 `R ` 而非 `RM` 就是证据），里面「唯一开关」那句会继续教错人。

⑨ **修了一个退出码的旧证据，别的退出码照留**（2026-09-10，⑧ 的续）。`ui-audit.mjs` 把
「引擎缺席」修成了会把旧报告覆写为 `absent:true / pass:false`，但只挂在 rc 3 那一条路上：
目标路径写错走 `usageExit` rc 2，直接 `process.exit` 在覆写之前，上一轮的 `pass:true` 原样躺着。
查检：把「没跑成」的**每一个**出口（用法错 / 目标不存在 / flag 解析失败 / 中途异常 rc 2）
各走一遍，每次都 `cat` 那份证据文件——只验缺席那一条等于只修了一个门。
