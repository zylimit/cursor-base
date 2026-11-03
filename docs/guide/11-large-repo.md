# 11 大仓治理可选包

这章解决的问题：仓库大到「改一处不知道要跑哪些检查」「审查说通过了但代码又动过」「检查全绿却没人证明过支付模块是安全的」这三件事靠人记不住的时候，怎么把它们交给引擎。读完你能判断自己的项目值不值得开、按两步把包装起来、写出一份过 lint 的 `module-catalog.json`、读懂四十个子命令的退出码并知道三道闸是怎么消费它们的。

不开这个包，框架对项目零行为变化；这章讲的一切都以 `.claude/harness/module-catalog.json` 存在为前提。

## 入门：什么时候值得开

| 信号 | 没有大仓包时的现状 | 大仓包给的答案 |
|---|---|---|
| 一次改动跨多个模块，不知道该跑哪些检查 | 全量跑或凭记忆挑 | `impact` 算反向依赖闭包，`verify` 只跑受影响模块的 verification |
| reviewer 说「通过」之后代码又改过，没人发现 | `.needs-review` 清空就放行 | `receipt` 把回执绑到 diff 的 SHA256，diff 变一个字节回执就 stale，stop-gate 拦停 |
| 检查全绿，但没人能说出哪条检查证明了 security | 靠自觉 | 模块声明 `attributes`，check 认领属性，`verify` 判覆盖，缺证据 `BLOCKED_BY_ATTRIBUTES` |
| 架构边界只在设计文档里 | 靠 code review 眼看 | `arch-check` 拿真实 import 边对照 catalog，越禁边 / 分层违规 / 未声明边机器可见 |
| 老仓带债接入，一开闸全红 | 关闸 | `arch-check --record` 立基线，`arch-trend --gate` 只拦新债 |

引擎的规模目标写在 `.claude/harness/ext/rules/harness-large-repo.md` [规模目标] 段：面向 60 万行以上，glob 编译缓存、NUL 分隔路径、tracked 清单上限 `maxTrackedPaths`（默认 10 万）、截断按坏测量处理。几千行的项目开它不会坏，但每次 commit 多跑一轮 `verify`、每次 Edit 后台多跑一轮早警，收益抵不过成本。

判断标准就一条：如果上表左列有两项以上是你每周都在手工做的事，开。

## 入门：两步启用

引擎默认不装。`.claude/harness/` 核心只有 `harness.mjs` + `lib/{core,tier}.mjs` + `profile.json` + `exclusions.json` + `audit/`；四十个子命令里只有 `doctor` / `diff-hash` / `selftest` / `tier` 四个靠核心就能跑，其余全在 `.claude/harness/ext/`，按需 `import`，装了才有（`harness.mjs` 头注释）。

### 第一步：装包

```bash
bash setup.sh --with-harness /path/to/your-project
```

Windows：`setup.ps1 -WithHarness`。

`setup.sh` 的 `--with-harness` 段做两件事（`setup.sh` 第 345 行起）：整目录拷 `harness/ext/**`；把 `harness/ext/rules/harness-large-repo.md` 与 `quality-attributes.md` 另拷一份进目标项目的 `.claude/rules/`——这两份细则的 frontmatter 是 `paths: [".claude/harness/**"]`，只有放在 `.claude/rules/` 下 Claude Code 才会按路径自动加载。

装没装用 `doctor` 看：

```bash
node .claude/harness/harness.mjs doctor
```

你会看到（本仓，装了包、没放 catalog）：

```
{"node":"v24.14.1","catalogPresent":false,"gitRepo":true,"headCommit":"db95ae03…","harnessDir":".claude/harness","extInstalled":true,"subcommands":[…40 个…],"waiversDirExists":false,"activeWaivers":0,"attributesDeclared":0,"modulesWithLayer":0,"forbiddenEdges":0,"adaptersPresent":true}
```

`extInstalled` 是包、`catalogPresent` 是开关，两个字段分开读。

### 第二步：放 catalog

```bash
node .claude/harness/harness.mjs init          # 打草案到 stdout，不写盘
node .claude/harness/harness.mjs init --apply  # 写 .claude/harness/module-catalog.json，已有则 rc 1 拒绝覆盖
node .claude/harness/harness.mjs catalog-lint  # 全量归类校验
```

`init` 只推 `id` / `paths` / `ignored` / `global`，`riskTier` 一律 `low` 占位，`attributes` / `dependsOn` / `layer` / `forbiddenDependencies` 一概不生成——机器猜出来的 high 会被下游当成有人定过档。真实 import 边只报在 `referenceEdges` 里供人过目，写进 `dependsOn` 就是让 `arch-check` 对着自己的倒影检查。草案产出前会用真 `lintCatalog` 自检，UNMAPPED / OVERLAP / CATCH_ALL 任一不过就 rc 1 不给出。

catalog 文件存在即启用，删掉即关闭，不动 `settings.json`、不动任何 hook。

### 只放 catalog、不装包会怎样

这是最容易踩的一格：开关开了、引擎不在，三道闸跑不成，但如果它们静默放行，看起来和「验过了没问题」一模一样。框架的处理是**当场出声、不拦、不静默**（`.claude/hooks/lib/harness.mjs` 的 `harnessExtInstalled` / `harnessExtMissingNotice`）：

| 位置 | 行为 |
|---|---|
| 任一 ext 子命令 | rc 3 + stderr `large-repo engine not installed: .claude/harness/ext missing (run setup.sh --with-harness)`，stdout 空 |
| `stop-gate.mjs` | `.needs-review` 清空后本该跑 `receipt verify`，改为出 `systemMessage`「大仓治理已开启（module-catalog.json 在）但引擎包未装，本次 回执绑定校验（harness receipt verify） 未验」，记一行 `gate-block.log`，放行 |
| `pre-commit-check.mjs` | 同一句话走 stderr，记账，不阻断 commit |
| `harness-async-verify.mjs` | 同一句话走 stderr（放在 180 秒防抖之后，不然每次 Edit 刷一句），不唤醒 |
| `bash .claude/scripts/doctor.sh` | 判 ✗：`module-catalog.json 在但 harness ext/ 未装：stop-gate / pre-commit-check / harness-async-verify 三道闸只会当场提示未验、验不成` |

在 `/tmp` 拷一份核心（`harness.mjs` + `lib/` + `profile.json` + `hooks/lib/`）、放一份空 catalog 实跑：

```
$ node .claude/harness/harness.mjs verify
large-repo engine not installed: .claude/harness/ext missing (run setup.sh --with-harness)
rc=3
$ node .claude/harness/harness.mjs selftest
{"ok":true,"tests":1,"ext":"not installed"}
$ echo '{}' | node .claude/hooks/stop-gate.mjs        # .needs-review 内容为 clean
{"systemMessage":"大仓治理已开启（module-catalog.json 在）但引擎包未装，本次 回执绑定校验（harness receipt verify） 未验；跑 `bash setup.sh --with-harness` 装包，或删掉 catalog 关闭大仓治理"}
```

`selftest` 没装包时只跑一条 core glob 断言并明写 `ext: "not installed"`，装了包是 141 条——绿一条不许被读成绿一百四十一条。

## 进阶：catalog schema

顶层字段（`harness-large-repo.md` [module-catalog.json schema]）：

| 字段 | 必填 | 含义 |
|---|---|---|
| `version` | 是 | schema 版本 |
| `modules` | 是 | 模块数组 |
| `global[]` | 否 | 变更即全模块 fanout 的路径（package.json / tsconfig.json） |
| `ignored[]` | 否 | impact 排除路径（README / docs） |
| `riskChecks{low,medium,high:[checkId]}` | 否 | 按 riskTier 给的默认 verification |
| `checks{id:{command,class?,allowFastSkip?,attributes?}}` | 否 | check 定义；`class` 为 security / safety / privacy 的永不可豁免；`attributes` 声明它认领哪些属性 |
| `contextPack` | 否 | 预算覆盖，默认 maxTotalChars=120000 / maxFiles=40 / maxFileChars=6000 / maxDiffChars=40000 |
| `layers[]` | 否 | 分层名，最外层在前，依赖只许指向同层或更靠后的内层 |
| `maxTrackedPaths` | 否 | tracked 清单上限，默认 10 万 |
| `budget` | 否 | `maxChangedFiles` / `maxChangedLines` / `maxModulesTouched` / `maxNewFiles`，缺省 30 / 1000 / 5 / 15 |
| `review` | 否 | `lenses[]` 显式召集清单 / `profile`（personal / team / production / regulated，默认 team）/ `maxRounds`（默认 3） |

模块字段：

| 字段 | 必填 | 含义 |
|---|---|---|
| `id` | 是 | 唯一，`[A-Za-z0-9._-]` |
| `paths[]` | 是 | glob；禁 `''` `'.'` `'*'` `'**'` `'**/*'`（CATCH_ALL） |
| `dependsOn[]` | 否 | 声明依赖，impact 反向闭包据此算 |
| `owners[]` | 否 | 人 |
| `riskTier` | 否 | low / medium / high；`claude-md-lint` 只查 high（写 critical 按不低于 high 读） |
| `verification[]` | 否 | 声明即覆盖 `riskChecks` 默认 |
| `attributes{属性:档位}` | 否 | 五性证据要求，见下文 |
| `forbiddenDependencies[]` | 否 | 永不许 import 的模块，`arch-check` 零容忍 |
| `layer` | 否 | 必须在 `catalog.layers` 里 |
| `provides[]` | 否 | 裸 import 说明符前缀（`@acme/db`），arch-check 用它归属包名 import |

路径分类优先级 **module > ignored > global > unmapped**；多模块命中按 glob 字面字符数最高者赢。`catalog-lint` 要求每条 tracked path 都有归处，错误码：`CATCH_ALL` / `UNMAPPED` / `OVERLAP` / `DANGLING_DEP` / `UNKNOWN_ATTRIBUTE` / `UNKNOWN_TIER` / `UNJUSTIFIED_TIER` / `SELF_FORBIDDEN` / `FORBIDDEN_DECLARED` / `UNKNOWN_LAYER`；`CYCLE` 与 `TRUNCATED` 是 warning。

保守扩张铁律：unmapped 命中 / global 命中 / 非 git / truncated → 全模块 fanout + `degraded:true`。宁可全跑，不可漏测。

一份最小可过 lint 的 catalog 参照 `.claude/tests/fixtures/harness/catalog-good.json`。

## 进阶：四十个子命令按层分组

载体一律 `node .claude/harness/harness.mjs <subcommand> [--flag value] [positional]`，stdout 单行 JSON、stderr 人读诊断。无参看 usage：

```
$ node .claude/harness/harness.mjs
missing subcommand
usage: node harness.mjs <subcommand>
implemented: doctor, diff-hash, selftest, catalog-lint, impact, context-pack, receipt, verify, waiver, attributes, arch-check, fitness, adapters, adr-check, arch-trend, gate, ledger, gate-audit, retention, risk, task, budget, spec-lint, trace, spec, dod, review, review-pack, authorship, invariants, recap, archive, sync-check, rules-audit, skills-lint, claude-md-lint, init, cochange, release, tier
  attributes  static wiring audit: declared quality attributes vs claiming checks
  …
rc=3
```

每个子命令有一张 flag 白名单（`harness.mjs` 的 `SUBCOMMAND_FLAGS`），不读的 flag 一律 rc 2 并点名：

```
$ node .claude/harness/harness.mjs impact --paths x
unknown flag for impact: --paths
impact reads: --catalog, --changed
rc=2
```

| 层 | 子命令 | 一句话 |
|---|---|---|
| 核心（无包可跑） | `doctor` | 环境自检 JSON，始终 rc 0 |
| | `diff-hash` | 当前工作树 canonical diff 的 SHA256，排除运行态 |
| | `selftest` | 内置回归，装包 141 条，没装 1 条并标 `ext: "not installed"` |
| | `tier` | `status|set|explain|validate`，档位盘，见第 09 章 |
| 定向 | `catalog-lint` | schema + 全量归类 |
| | `impact` | 反向依赖闭包：`affected` / `direct` / `verification` / `degraded` |
| | `context-pack` | 预算化打包给 delegate；DENY 路径永不入包 |
| | `budget` | 爆炸半径对 `catalog.budget`，超限 rc 1 是「拆分或升级」信号不是禁令 |
| | `init` | 从 tracked 树推 catalog 草案，`--apply` 写盘且不覆盖 |
| | `cochange` | git 历史里总一起改却没 `dependsOn` 的模块对；默认只报，`--gate` 才判 |
| 证据 | `receipt write|verify` | diff-bound 审查回执 |
| | `verify` | 四态质量门 + 五性覆盖判定 |
| | `gate` | `verify` 的带证据版：每条 check 输出落盘 + 账本一行 |
| | `ledger` | 重算哈希链与证据摘要，任一断裂 rc 1 |
| | `gate-audit` | 从未 FAIL/BLOCKED 过的 check（`neverIntervened`）与从未跑过的（`neverExecuted`），被 waiver 压制的单列 |
| | `retention` | 按龄与数修剪证据；账本引用到的永不删；链断拒绝清扫 |
| | `risk` | 状态衰变：LEDGER_BROKEN / EXPIRED_WAIVER / UNWIRED_ATTRIBUTE / FAIL_STREAK / FAST_MODE_DEBT / STALE_TASK … |
| | `task start|status|complete` | 七字段信封；`complete` 是硬闸 |
| | `waiver list|check|create` | 结构化豁免 |
| 防腐 | `arch-check` | 真实 import 边 vs 声明图；`--record` 快照 |
| | `arch-trend` | 漂移棘轮；`--gate` 新债即 rc 1 |
| | `adr-check` | 每条活跃 ADR 必须指向真实执法点 |
| | `fitness` | 五条内置五性规则，无 catalog 也能跑 |
| | `adapters list|add` | 外部工具表，无 catalog 可 list |
| | `attributes` | 五性静态接线审计 |
| 规格 | `spec-lint` | Product-Spec 可判定性 |
| | `trace` | `[REQ-…]` 编号 ↔ 测试引用；没编号 rc 3 明说不可用 |
| | `spec` | 按变更取相关需求的预算化视图 |
| | `dod` | 十四步静态治理一次跑完；阻断步 FAIL rc 2、全降级 rc 3 |
| 评审 | `review start|blue|lens|verdict|backlog|status|team` | 结构化分歧评审，**不依赖 catalog** |
| | `review-pack` | 评审证据包，删除与重命名单独成节 |
| | `authorship record|show` | 作者账本，`record-authorship.mjs` 自动记 |
| 记忆 | `invariants` | 从 CLAUDE.md 粗体铁律 + progress.md Pinned + 运行态派生不可交易集，约 1200 字符 |
| | `recap` | 从三份 artifact 派生处境，默认 4000 字符 |
| | `archive` | progress.md 老条目搬进 progress.archive.md，默认 dry-run |
| | `sync-check` | MEMORY_BEHIND_CODE / SPEC_WITHOUT_CHANGELOG |
| 规则 | `rules-audit` | 每条规则行归 M / P / phantom / U 四类，只有 phantom 判失败 |
| | `skills-lint` | SKILL.md frontmatter 五件事 |
| | `claude-md-lint` | high 模块目录须有四节齐全的 CLAUDE.md |
| 发布 | `release` | 八条发版判据装配，自己什么都不做，没有任何豁免 flag |

四类子命令无 catalog 就 rc 3 降级（`impact` / `verify` / `arch-check` / `attributes` 等），两类不需要 catalog（`fitness` / `adapters list`），评审引擎无 catalog 按默认 profile 跑并记 `catalogPresent:false`。本仓无 catalog 实跑：

```
$ node .claude/harness/harness.mjs verify
{"state":"DEGRADED","degraded":true,"error":"catalog-missing","detail":".claude/harness/module-catalog.json","checks":[],"affected":[]}
rc=3
$ node .claude/harness/harness.mjs fitness
{"ok":true,"scope":"changed","scannedFiles":0,"rules":5,"counts":{"error":0,"warning":0,"info":0},"findings":[]}
rc=0
```

## 进阶：退出码契约

完整表在 `harness-large-repo.md` [退出码契约] 段，每个子命令一行。五个码的通用含义：

| 码 | 含义 | 举例 |
|---|---|---|
| 0 | 建立了结论且干净 | `verify` PASS 且至少跑过一条 check |
| 1 | 建立了结论且有发现 | `catalog-lint` 有错、`ledger` 链断、`arch-check` 有越禁边 |
| 2 | 门没过（阻断级）或用法错 | `verify` FAIL/BLOCKED/属性缺口；任一子命令收到不读的 flag |
| 3 | 降级，什么都没建立 | 无 catalog / 非 git / 包没装 / 全 SKIPPED / 账本读不出来 |
| 4 | STALE | `receipt verify` 回执不绑当前 diff 或读不出来；`review` 系列树已移动 |

hook 侧用 `rcInContract(rc, ...codes)`（`.claude/hooks/lib/harness.mjs`）判码在不在契约内，契约外一律当「引擎崩了」处理，不当结论：

| hook | 调用 | 契约 | 契约内怎么办 | 契约外怎么办 |
|---|---|---|---|---|
| `stop-gate.mjs` | `receipt verify` | 0 / 3 / 4 | 4 → 拦停强制重审、保留 `.needs-review`；0 / 3 → 清理放行 | 拦停并点名退出码，走 `.stop-gate-strikes` 三振后放行但点名欠账 |
| `pre-commit-check.mjs` | `verify` | 0 / 2 / 3 | 2 → 阻断 commit；3 → 静默跳过；0 → 放行 | 阻断 commit，stderr 带引擎 stderr 头三行 |
| `harness-async-verify.mjs` | `verify` | 0 / 2 / 3 | 2 → exit 2 唤醒主 Agent 读摘要 | 同唤醒形态发诊断 |

`rc 3` 在三处都是「没建立结论、按原逻辑走」，与 `rc 0` 走同一条放行路径——所以包没装时才必须另出一句话，见上文。

## 精通：receipt 与 diff-bound

`receipt write` 从 stdin 读 JSON（`taskId` / `reviewer` / `verdict` / `scope`）写 `.claude/harness/receipts/<taskId>.json`，同时记三样哈希：

| 字段 | 绑什么 | 变了怎么判 |
|---|---|---|
| `diffHash` | 当前工作树 canonical diff 的 SHA256（`diff-hash` 同一算法） | `diff-moved`，rc 4 |
| `engineHash` | 运行中的 `harness.mjs` + `lib/*.mjs` 逐文件 sha256 串接再 sha256 | `engine-moved`，rc 4；老回执没这字段照常放行、输出 `engineHash: null` |
| `contentHash` | 回执 JSON 本身 | `tampered`，rc 4 |

判定顺序 `receipt-unreadable` > `tampered` > `engine-moved` > `diff-moved`。目录里任一 `*.json` 解析不了也是 rc 4（`receipt-unreadable` + `unreadable[]` 点名），受损文件原地不动，只往 `.claude/harness/state/quarantine.jsonl` 记一行。

回执谁来写：手写 `receipt write` 是轻量路子；走评审引擎时 `review verdict` 判出 ACCEPT 且到最终阶段自动写。两条路产出同一份回执，stop-gate 只认这一件事。

## 精通：verify 四态与聚合

verification 解析优先级 `module.verification` > `catalog.riskChecks[module.riskTier]`。单 check 四态：

| 态 | 条件 |
|---|---|
| `PASS` | 命令 exit 0 |
| `FAIL` | 命令 exit ≠ 0 |
| `BLOCKED` | 缺 command 定义 / 二进制 PATH 与 shim 目录里都找不到（`command-missing:<exe>`） |
| `SKIPPED` | 命中有效 waiver 的非保护类 check；或 fast 档 + 非 security/safety/privacy + `allowFastSkip:true` |

聚合：任一 FAIL → FAIL；任一 BLOCKED → BLOCKED；否则 PASS。**空验证计划 = BLOCKED**（`emptyPlan:true`）：受影响模块存在但一条 check 都没解析出来，配置缺口必须可见。全 SKIPPED → rc 3 不是 0。

判 BLOCKED 之前先扫 shim 目录：win32 默认 `%LOCALAPPDATA%\Microsoft\WinGet\Links` / `%USERPROFILE%\scoop\shims` / `%ChocolateyInstall%\bin`，任何平台可用 `CC_HARNESS_SHIM_DIRS` 覆盖；命中就把该目录前置进子进程 PATH 并记 `shim:<目录>`，扫不到仍 BLOCKED。

check 聚合之上叠五性覆盖门：受影响模块声明的 critical / high 属性若无 PASS 的认领 check（或有认领 check FAIL / BLOCKED 反证），`gate=BLOCKED_BY_ATTRIBUTES`、rc 2。输出 `gate` 字段三态：PASS / FAIL|BLOCKED / BLOCKED_BY_ATTRIBUTES。

## 精通：gate、ledger 与哈希链

`gate` 与 `verify` 同一套 verifyPlan，多做四件事：每条执行过的 check 的 stdout+stderr 落 `.claude/harness/evidence/<check>-<epoch>.log` 并记 `evidenceSha256`（LF 归一后算）；算 `planHash`；记 `scopeSource`（`computed` 引擎自算 / `caller` 用了 `--changed`）；整条记录追加进 `.claude/harness/state/ledger.jsonl`。PASS 但账本追加失败 = rc 3——没记下来的验证不是证据。没跑的 check 不写证据文件。

账本每行的链：

```
contentHash = sha256(LF(JSON.stringify(record)))
chain       = sha256(prev + NUL + contentHash)
prev        = 上一行的 chain（首行 64 个 0）
```

`ledger` 重算整条链并重读每个 `evidence` 日志比对摘要，报 `unparseable-line` / `content-hash-mismatch` / `chain-predecessor-mismatch` / `chain-hash-mismatch` / `evidence-tampered` / `evidence-missing`，任一 rc 1。**没有也不会有「修复账本」的命令**——能改成自洽的工具就是伪造工具；链断了要么人来决定退役 `ledger.jsonl`（同时作废它记过的全部证明），要么去查是谁改的。`ledger.lock` 是追加期间的跨进程互斥目录，超 60 秒视为陈旧锁回收。

`task complete` 消费账本：要有绑当前 diffHash 的 PASS gate 记录，且 `scopeSource=computed`、`planHash` 等于当前重算、至少一条 check 真跑过；要有绑同一 diffHash 的新鲜完整 accept 回执；账本链完好；证据摘要相符；计划非空。缺任一 rc 2 + `blockers[]`。`complete` 自己不收 `--changed`（rc 3）——完成的范围永远不是调用方说了算。

## 精通：waiver 规则

schema（`.claude/harness/waivers/*.json`，git 忽略）：`version:1` / `owner` / `reason` / `scope` / `expiry`（ISO，必须未来）/ `compensation` / `created_at` / `contentHash`。

| 规则 | 内容 |
|---|---|
| 事前生效 | scope == check id 且非保护类 → 该 check 根本不执行，记 SKIPPED（`waiver:<scope>`）。跑出来的 PASS / FAIL / BLOCKED 此后不可改写 |
| 保护类永不可豁免 | `class` 为 security / safety / privacy 的 check 命中 waiver 时记进 `waiversBlocked` 并照常执行 |
| 属性豁免 | scope 写 `attribute:<module>/<属性>` 只能推迟 **high** 档缺口，critical 不行；`attribute:x/security` 这类被禁词天然挡住 |
| 禁词 | reason + scope 联合正则 `safety|security|privacy|pii|secret|credential|destructive|push|deploy|production`，命中即 create / validate 拒绝 |
| 与 fast 档的关系 | 两者都在命令启动前跳过；fast 是批量语法糖随窗口过期，waiver 是指名到 check 带 owner / 到期 / 补偿的签字决定；同时命中记 waiver |

豁免掉的 check 不产生任何方向的证据，它认领的属性因此拿不到覆盖——豁免买断的是这条检查，不是它本该证明的性质。

## 精通：五性属性档位与 fitness

细则在 `.claude/harness/ext/rules/quality-attributes.md`。八项属性：`security` / `safety` / `privacy` / `resilience` / `reliability` / `availability` / `performance` / `maintainability`，前五项对应五性。

六档强度：

| 档位 | 执法 | 备注 |
|---|---|---|
| `critical` | 阻断 | 永不可豁免 |
| `high` | 阻断 | 可用属性 waiver 推迟，security / safety / privacy 除外 |
| `medium` | 告警 | 报缺口不阻断 |
| `low` | 记录 | |
| `minimal` | 列示 | 必须给 reason |
| `none` | 退出 | 必须给 reason，`catalog-lint` 的 `UNJUSTIFIED_TIER` 拦裸退出 |

声明写法：

```json
{ "id": "payments",
  "attributes": { "security": "critical", "privacy": "high",
                  "availability": { "tier": "none", "reason": "纯库模块，无服务面" } } }
```

check 认领：

```json
{ "sec-scan": { "command": "semgrep scan --error --config auto", "class": "security", "attributes": ["security"] } }
```

覆盖判定三条铁则：反证压过佐证；声明而未接线 = 可见缺口（`attributes` 子命令静态审计，blocking 档无认领 rc 1）；SKIPPED 不覆盖也不反证。

`fitness` 五条内置规则零外部工具：

| 规则 | 属性 | 级别 | 抓什么 |
|---|---|---|---|
| `no-secret-literal` | security | error | 密钥 / token / 私钥字面量 |
| `no-pii-in-logs` | privacy | error | 日志语句带 email / ssn / 卡号 / 生日 |
| `no-silent-failure` | reliability | error | 空 catch / except-pass |
| `no-unbounded-retry` | resilience | warning | 无界重试 |
| `no-unreferenced-deferral` | safety | warning，`minimumTier=high` | high 档 safety 模块里未挂单的 TODO / FIXME |

默认扫变更文件，`--all` 全 tracked，`--paths a,b` 指定；行内 `harness-fitness:ignore`（本行或上一行）压单条；`.claude/harness/fitness-rules.json` 增补或 `replace:true` 替换。error 级命中 rc 1。它们是文本启发式，能减少「没人查过」，不能证明属性成立。

## 精通：adapters 接外部扫描器

`.claude/harness/adapters.json` 是十一个工具的表：`sast-semgrep` / `sca-osv-scanner` / `scan-trivy` / `secrets-gitleaks` / `sbom-syft` / `pii-presidio` / `mutation-stryker` / `contract-schemathesis` / `load-k6` / `iac-checkov` / `slo-openslo`，每条有 `attributes` / `class` / `executable` / `command` / `install` / `rationale`。引擎不捆绑不安装任何工具。

```bash
node .claude/harness/harness.mjs adapters list --attribute security   # available（PATH 有没有）+ wired（catalog 接没接）
node .claude/harness/harness.mjs adapters add sast-semgrep             # 写进 catalog.checks
```

接线只是半步：模块 `verification` 引用它才会被选中。可执行文件缺失时该 check 报 BLOCKED。`class:runtime` 的检查（k6）度量的是部署后的系统，没有 diff hash 能描述它，不当作当前工作树代码的证据。

## 精通：架构防腐三件

`arch-check` 从 JS / TS / Python / Go / Java / Kotlin / C# / Rust / Ruby / PHP / Swift / Scala 提取 import 边对照 catalog，报 `forbiddenDependencies`（越禁边，含 layer 违规）/ `undeclaredDependencies`（漂移，会让 impact 少算）/ `unusedDeclarations`（虚边）/ `cycles`。声明与禁令冲突时禁令赢。

`arch-check --record` 把指标连同每条边的身份快照进 `.claude/harness/trend/arch-trend.jsonl`；`arch-trend --gate` 比的是边的身份集合不是计数（还一条旧债同时添一条新债计数不变，per-edge 才抓得住），历史最优是各先验快照的交集；老台账只有 count 的记录标 count-only 降级比较；`forbidden > 0` 不进棘轮、任何快照命中即 rc 1；台账有解析不了的行 `--gate` 也 rc 1（`trend-history-corrupt`）。

`adr-check` 扫 `Architecture-Design.md` 的 `### ADR-xxx` 块与 `docs/adr/*.md`，每条活跃 ADR 的「执法方式 / Enforced-by」必须解析出至少一个真实执法点（catalog check id / fitness 规则 id / harness 能力名 / 显式人工标记），零可识别 token 判 fail。

## 精通：三份规则闸

| 子命令 | 扫什么 | 判失败的条件 |
|---|---|---|
| `rules-audit` | `.claude/CLAUDE.md` + `.claude/rules/*.md` 每条规则行，归 **M**（行内反引号 token 解析出真实子命令 / hook / script / test）/ **P**（写明靠自觉、prompt-only）/ **phantom**（token 长得像执法点但不存在）/ **U**（其余） | 只有 phantom rc 1；U 多少不改退出码，是给人的清单 |
| `skills-lint` | `.claude/skills/*/SKILL.md` 五件：frontmatter 可解析、`name` kebab-case 且与目录同名、`description` 非空 ≤180 字且触发式（含「当…时」或「由…调用」）、不重名、布尔字段裸 true/false | 有 finding rc 1；形态判不了 rc 3；无 skills 目录 rc 0 |
| `claude-md-lint` | catalog 里 `riskTier` high 的模块目录须有 `CLAUDE.md`，四节 Purpose / Boundaries / Invariants / Verification（中英标题都认），有壳没肉算空节 | 缺文件 / 缺节 / 空节 rc 1；无 catalog rc 3 |

本仓实跑 `rules-audit`，`.claude/CLAUDE.md` 50 条规则行 machine 2 / prompt 3 / phantom 0 / unclassified 45；`skills-lint` 18 个 skill 全过；`claude-md-lint` 无 catalog rc 3。

## 精通：recap 与 archive

两者都在 memory 分节，无 catalog 也能跑（它们读的是 progress.md / Product-Spec.md / Product-Spec-CHANGELOG.md）：

```
$ node .claude/harness/harness.mjs recap --budget 500
{"ok":true,"budget":500,"chars":478,"omitted":23,"read":["progress.md"],"skipped":["Product-Spec.md (missing)","Product-Spec-CHANGELOG.md (missing)"],"counts":{"breakpoint":0,"pinned":15,"openP0P1":2,"decisions":5,"done":5,"notes":3},"text":"# RECAP -- derived from progress.md, not from a summary\n…"}
$ node .claude/harness/harness.mjs archive
{"ok":true,"applied":false,"file":"progress.md","archive":"progress.archive.md","maxEntries":100,"total":114,"moving":0,"sections":[{"section":"Done","entries":58,"moving":0,…},{"section":"Notes","entries":56,"moving":0,…}],"note":"every archivable section is within 100 entries; nothing moves"}
```

`recap` 渲染顺序就是优先级——断点 / Pinned / TODO P0-P1 / 近期 Decisions / Done / Notes，预算从尾巴吃，「工作停在哪」先出；三份都不存在 rc 3。`archive` 默认 dry-run，`--apply` 才动，`--max-entries` 每段默认 100；只搬不改写，Pinned 与 TODO 永不归档，先写 archive 后写 progress。

`invariants` 与 `postcompact-reinject.mjs` 配套：压缩后从 CLAUDE.md 粗体铁律 + progress.md Pinned + 运行态重新派生不可交易集经 `additionalContext` 注回；包没装时 hook 走自带的最小派生（Pinned + 待审 + 档位），不吊在可选包上。

## 精通：接线点与 CI

| 接线 | 位置 | 触发 |
|---|---|---|
| `stop-gate` ↔ `receipt verify` | `.claude/hooks/stop-gate.mjs` | `.needs-review` 清空后 |
| `pre-commit-check` ↔ `verify` | `.claude/hooks/pre-commit-check.mjs` | PreToolUse(Bash) 命中 `git commit` |
| `harness-async-verify` ↔ `verify` | `.claude/hooks/harness-async-verify.mjs`，settings 里 `asyncRewake: true` | PostToolUse(Edit\|Write)，180 秒防抖 |
| `record-authorship` ↔ `authorship record` | `.claude/hooks/record-authorship.mjs` | PostToolUse(Edit\|Write\|NotebookEdit)，记账不是闸 |
| git `pre-commit` | `.claude/githooks/pre-commit` | catalog 在才跑 `catalog-lint` + `fitness --paths <staged>` |
| CI | `.github/workflows/gate.yml`「大仓 catalog-lint / arch-trend --gate」步 | catalog 在才跑，不在打一句「本步跳过（不是通过）」 |

`arch-check` / `fitness` / `attributes` 不走 hook 自动触发，推荐进 catalog checks 由 `verify` 定向带跑，或 code-review Stage 0 / 发版前手动跑。

## 常见坑

- **只放 catalog 不装包**：三道闸每次出一句「未验」、doctor 判 ✗。要么 `bash setup.sh --with-harness`，要么删 catalog。
- **只拷 `harness.mjs` 搬引擎**：`lib/` 与 `ext/` 都不在会 `ERR_MODULE_NOT_FOUND`；引擎 `lib/tier.mjs` 还 import `.claude/hooks/lib/tier.mjs`，搬引擎必须连 `.claude/hooks/lib/` 与 `profile.json` 一起搬。
- **把 `--flag=value` 当合法拼法**：parser 只认 `--flag value`，`--changed=x` 整个 token 被当未知 flag rc 2。
- **`init` 之后不审草案直接 `--apply`**：`riskTier` 全是 `low` 占位，`attributes` 一个没有——五性证据门等于没开。
- **`verify` rc 3 当绿**：全 SKIPPED / 无 catalog / 包没装都是 3，什么都没建立。pre-commit-check 对 3 静默放行是设计，看 `gate` 字段和 stderr 才知道原因。
- **手工编辑 `ledger.jsonl`**：改一行整条链断，此前全部验证按未证明处理；没有修复命令。
- **给 security 类 check 写 waiver**：`waiversBlocked` 记下、check 照跑，豁免不生效。
- **老仓一开 `arch-check` 就全红于是关掉**：先 `arch-check --record` 立基线，把 `arch-trend --gate` 而不是 `arch-check` 挂进闸。
- **把 `gate --changed <路径>` 的 PASS 当完成证据**：`task complete` 与 `release` 的 `gate-fresh` 都拒收 `scopeSource=caller` 的记录。
- **两个同名 `doctor`**：`node .claude/harness/harness.mjs doctor` 出 JSON，`bash .claude/scripts/doctor.sh` 出人读结论且不调用前者；两个 `gate-audit` 同理，子命令审 catalog check、`gate-audit.sh` 审 hook 闸。
