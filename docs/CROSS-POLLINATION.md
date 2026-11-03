# 跨仓借鉴台账

> 兄弟仓（deepseek-base / codex-base 等）每轮摸底的机制清单与判定。一条机制一个判定，判定要带证据句柄。
> 规则：**拒绝**的条目在出现新证据前保持拒绝，不反复重评；**吸收**的条目在回归证明它错之前保持吸收；**观察**是未决，要写清缺什么证据才能定。
> 与 progress.md 的分工：这里只记「机制 → 判定 → 落点」，取舍理由与过程进 progress.md 的 Decisions。
> 本文件不进分发包（make-release.sh 只打 `.claude/` 与安装器），是框架自己的维护记录。

## 摸底记录

| 日期 | 仓 | 基准 | 方式 |
|---|---|---|---|
| 2026-09-04 | deepseek-base（`/mnt/d/code/deepseek-base`） | HEAD `ea0d815`，2026-07-31 后 57 个 commit | Explore 只读 + 主 Agent 对每条指控在 cc-base 源码逐一核实 |
| 2026-09-04 | codex-base（`~/code/codex-base`） | HEAD `f4e8790`，v3→v4→v5 共 12 个 commit | 同上 |
| 2026-09-21 起 | ccb-base（ai-node `~/code/ccb-base`，十四席四线集群） | 分支 `fix/install-path-and-floor-gates`，集成提交 `d9e700e` | 不是摸底，是实战回流：主 Agent 当外部顾问盯它修安装路径与地板闸，过程中凡照出 cc-base 自己毛病的、或它做得比本仓好的，记在「ccb-base 实战回流」一节；用户 2026-09-21 指示「过程中可以 cc-base 整改的都记录，后面一起清理」 |

## 他们对 cc-base 的判定，以及核实结果

deepseek-base 的 `docs/CROSS-POLLINATION.md:40-58` 把 cc-base 定性为「a deliberate dsh fork」，给了六条拒绝/指控；codex-base 的 `docs/CROSS-POLLINATION.md:13,20-32,94` 另给了五条。逐条在本仓核过，属实的记属实，不属实的写出反证。

| 指控 | 核实 | 处置 |
|---|---|---|
| 全 SKIPPED 聚合成 PASS（dsh :58；codex :26「skip 假绿」） | **属实**。`quality.mjs:340` 注释明写 `PASS or all-SKIPPED -> 0`；`evidence.mjs:444` 只把它当 reason 字符串 `every-check-skipped`，退出码照 0。本仓 `dod` / `release` 早就是「什么都没建立 = rc 3 不是 0」（`release.mjs:550`），只有 `verify` / `gate` 没对齐 | 吸收（本轮）：all-SKIPPED → rc 3 降级，与 dod / release 口径一致；不照 dsh 做成 BLOCK，本仓退出码契约里 3 就是「没建立」 |
| waiver 把跑过的 FAIL 改写成 SKIPPED（dsh :57） | **属实**，且 progress.md 早记为 `[P1][OPEN][#20b]`，推迟原因是它改既有 `verify` 行为、会让 golden 重录差异不可解释 | 吸收（排期）：dsh 的 `waivePlan` 形态（跑之前解析 waiver、跑过的结果不可变）可直接参照，独立成批 |
| 作者≠评审「只建了一半，真实 session 里 authorshipEnforced 恒 false」（dsh :54） | **属实**。`review.mjs:18` 写明台账为空就 `enforced:false`；全仓 hooks / scripts / agents / skills **没有任何一处调用 `authorship record`**，台账永远是空的 | 观察：要么给 SubagentStop 接线自动记作者（先查官方 hook 输入里有没有 agent 身份字段），要么在 rules 里如实写「大仓启用后由主 Agent 派单时手动 record」。缺的证据：hook 输入 schema |
| `bypassPermissions` 默认 + 密钥守卫 fail-open（dsh :56） | 前半是用户明确决定（progress Pinned「权限永不询问」，只跳工具权限提示，框架 guard hook 照跑）；后半**部分属实**：`secret-exfil-guard.sh` 用 `set -euo pipefail`，脚本内部出错会以 rc 1 退出，PreToolUse 的 rc 1 是「非阻断错误、工具照跑」 | 前半拒绝（用户决策）。后半观察：改成任何内部错误都 exit 2 会把「hook 自己有 bug」变成「所有 Bash 被拦」，可能砖机，需要用户拍板；stop-gate 的三振熔断是可参照的缓冲 |
| auto-push / kill-dev-ports 违反最小副作用（dsh :55；codex :94） | 两个 hook 都挂着（`settings.json:88,125`）。auto-push 只在 `git commit` 后、本地领先上游时静默 push，fast-mode 下停用 | 拒绝：这是用户有意设计的「提交即推送」，本仓 CI 靠它每批必跑；代价是每次 commit 都是对外动作，主 Agent 只在验证齐全后 commit |
| `.needs-review` 登记簿已被 diff-bound receipt 取代；三文件同步 Stop 硬闸误报多（codex :94） | 本仓两者并存：登记簿是无 catalog 时的轻量闸，receipt 是大仓启用后的闸；三文件闸按工作树实际未提交改动拦 | 拒绝：轻量项目没有 catalog，登记簿是唯一闸；误报率由 `gate-audit` 数据说话，不凭感觉删 |
| TDD 软提醒 hook 是提示噪音（codex :94） | 属实是软提醒（`tdd-gate.sh` 只出提醒不拦） | 拒绝：red-locks 铁律的机器提醒，删了就只剩自觉；同样交给 gate-audit 数据 |
| live-tree manifest 漂移——清单从工作树生成、工作树脏时清单带脏（codex :13,31） | **部分属实**。`gen-manifest.sh` 确从工作树生成；但 `release` 的 manifest 项会比对，脏了会 FAIL 而不是静默过 | 观察：codex 的对策是安装事务启动前重建分发面并与 source manifest 逐字比对，随安装器事务化一起看 |
| spec trace「截断仍可成功」（codex :27） | **属实**。`spec.mjs:482` 的退出码只看 `r.ok`，`truncated` 只是回显字段 | 吸收（本轮）：truncated → rc 3，坏测量不许读成通过 |
| shell-string gate（用 `sh -c` 跑未结构化的验证串）不得复制（codex :13,41） | 本仓 check 的 `cmd` 确实是字符串交 shell 执行 | 观察：改成 argv 数组是 catalog schema 变更，影响所有已有 catalog；先记着 |

## deepseek-base 机制表

| 机制 | 它在哪 | cc-base 现状 | 判定 | 落点 |
|---|---|---|---|---|
| 不可读 receipt fail-closed + 隔离（改名 `*.corrupt-<ts>` + `state/quarantine.jsonl`，verdict 判红，返回体列 `unreadable`） | `.dsh/base/lib/quality.mjs:514`、`core.mjs:390` | `quality.mjs:108` `catch { /* skip bad file */ }`——手改一个回执成非法 JSON 它就凭空消失 | **吸收（本轮）** | `core.mjs` 新增 `quarantine()`，`loadReceipts` 返回 `unreadable[]`，`receipt verify` 有 unreadable 即 STALE |
| `quarantine()` 通用原语：受损运行态（task / fast-mode / review session / waiver）不静默重建也不静默保留 | `core.mjs:390-406`，接线四处 | 全仓无 quarantine 概念；ledger 层有 `{corrupt:true,raw}` 保留，运行态 state 仍 `catch → null` | **吸收（本轮）** | 同上，`risk` 加 `QUARANTINED_STATE` |
| supervisor 受损 state fail-visible（读成 `{corrupt:true}`、status 报 corrupt 且 exit 1，防第二个 supervisor 接管同一子进程） | `.dsh/base/supervisor.mjs:53-63` | `scripts/supervisor.mjs:61-62` `catch → null`，`:247` 的「already running」判定建在这个 null 上 | **吸收（本轮）** | `supervisor.mjs` 单文件 |
| arch-trend 坏行不丢：`corruptLines>0` 时 `--gate` 直接红（「有洞的历史分不清新债和忘掉的债」） | `graph.mjs:462-506` | gate-log 侧已有 `corruptLines`（`review.mjs:1129`）；`graph.mjs:407` 的 trend 仍 `skip bad line` | **吸收（本轮）** | `graph.mjs` 单点 |
| golden 突变尺子自动化：`MUTANTS.json` 声明式突变 + `--mutate` 报 killRate，exit 时全量还原、目标文件脏则拒跑 | `tests/golden/MUTANTS.json`、`tests/golden-baseline.mjs:321-369` | `harness-golden.mjs` 只有 `--record/--check/--probe`，「尺子能咬住」靠人工突变（2026-09-02 那次 29 条是手跑的） | **吸收（本轮）** | `harness-golden.mjs` 加 `--mutate` + 清单文件 |
| release 两条阻断：`gate-fresh`（存在一次绑定当前 diffHash 的完整 PASS gate，fast-mode 跑的不算）+ `review-depth`（lens 覆盖达发版底线） | `context.mjs:706-736` | `release.mjs:545` 七项里没有 gate；`dod` 十四步里也没有 gate / verify | **吸收（本轮）gate-fresh；review-depth 观察**（本仓 lens 模型是 backlog 保护集，不是覆盖底线，先不硬套） | `release.mjs` 加一项 |
| Windows 包管理器 shim 发现（`where` 找不到时扫 WinGet / scoop / chocolatey，命中则前置注入 PATH 而非判 BLOCKED） | `quality.mjs:43-120` | 无 | **吸收（本轮）** | `quality.mjs` 的 `whichCmd` 侧 |
| doctor 分发完整性全量比对、spawn 独立审计脚本 | `context.mjs:156-183` | `doctor.sh:104` 只从清单**前 20 行随机抽 3 个** | **吸收（本轮）** | `doctor.sh` 改全量 |
| waiver 前置声明 `waivePlan`（跑之前解析，命中即 SKIPPED 不执行；受保护 check 照跑并计 `waiversBlocked`） | `quality.mjs:221-240` | 即 #20b | **吸收（排期）** | 独立批，含 golden 重录 |
| 跨仓借鉴台账（absorbed / adapted / rejected / watching 四态，拒绝也留痕） | `docs/CROSS-POLLINATION.md` | 无，结论散在 progress.md | **吸收（本轮）** | 本文件 |
| 运行时表跨表契约测试（指纹排除表 ↔ pack 拒绝表穷举双向迭代） | `tests/table-consistency.test.mjs` | 四份排除表已有 `test-setup.sh ⑥` 表范围比对 + 行为锁 | 拒绝：等价物已有，形态不同 | — |
| `url-userinfo` 密钥模式（`http(s)://user:pass@host`） | `audit/scan-secrets.mjs:30` | 15 条模式里没这条 | **吸收（本轮）** | `scan-secrets.mjs` 加一条 + 一对正反用例 |
| `run-tests.mjs` 版本安全启动器、零文件 exit 3 | `audit/run-tests.mjs` | CI 矩阵 22/24 无 Node 20 | 拒绝：不需要；「零文件 = 什么都没证明」语义本仓 run-all 已有 | — |
| 强制 PowerShell 7（`#requires -Version 7.0`） | `setup.ps1:1-16` | Pinned 明写兼容 5.1，28 条 ps1 行为断言锁 5.1 语义 | 拒绝：与 Pinned 冲突；#30 记着 5.1 无机器可验，是承认缺口不是放弃兼容 | — |
| macOS CI 格 / actions v7 / gitleaks+semgrep 独立 job / 覆盖率 advisory 格 | `.github/workflows/gate.yml` | Decisions 2026-09-03 明确不做 macOS 格与 SHA pin | 拒绝 macOS 与 pin；gitleaks / semgrep 观察（本仓 adapters 表已能按属性接外部扫描器，CI 侧加不加看 gate-audit 数据） | — |
| 窗口绑定豁免 / rules-audit 分类 / per-edge 棘轮 / review-pack 删除段 / 突变尺子 / supervisor | 它的 :46-52 自认从 cc-base 吸收 | 本仓原创 | 不回收 | — |

## codex-base 机制表

| 机制 | 它在哪 | cc-base 现状 | 判定 | 落点 |
|---|---|---|---|---|
| 事务式安装器：零写 dry-run → 独占锁 + maintenance marker → 全量 staging + backup 各自 post-hash → `link()` 不覆盖落地 → 依赖序 apply、manifest 最后写 → 逆序回滚且回滚自身 CAS → 失败留证不留残、后续命令 fail-closed；`*_FAIL_AFTER=N` 故障注入让回滚路径可测 | `scripts/lib/installer.mjs`（1068 行）、`files.mjs` | `setup.sh:26-90` 逐文件顺序 `cp`，中途失败留一半新一半旧；无 dry-run、无锁、无 marker、无回滚 | **吸收（排期）最小切片**：`--dry-run` 零写 + 锁 + marker + doctor/hook 见 marker 即拒；完整 staging/回滚是大改，等切片跑稳 | `setup.sh` / `setup.ps1` 成对 + `doctor.sh` |
| `readiness check` 只读聚合 + **信任边界四个硬 false 字段**（`producerIdentityAuthenticated / ciProvenanceVerified / externalSignatureVerified / releaseAuthorized` 必须为 false，否则候选证明非法）+ 每个 blocked gate 带 `nextAction` + release 强制 clean worktree 与显式 `base..HEAD` | `.codex/runtime/lib/readiness.mjs:81-89,120-122,150` | `release` 已是只读聚合、blocker 已带下一步命令；缺信任边界字段 | **吸收（本轮）信任边界字段**；range 绑定观察 | `release.mjs` 输出加 `trustBoundary` 块 |
| Assurance profile 四档 + 15 控制轴 + floors 只抬不降 + 单调性静态校验 + `floors.paths` 治理面自动升 strict | `.codex/harness/assurance-policy.json`、`assurance.mjs` | 五性档位是「模块属性多重要」，fast-mode 是布尔；没有统一工作流档位 | 完整档位拒绝（本仓刻意轻量，见 Decisions 2026-06-14 / 07-30）；**吸收（本轮）治理面自动升档**：改 `.claude/hooks|harness|skills|agents/**`、`.github/**` 时 `risk` 抬到 high 并点名 | `evidence.mjs` 的 risk |
| Rapid evidence loan + 持久 evidence debt（关窗不清债；只有债务产生**之后**的 fresh PASS 才算偿还；DEFERRED ≠ PASS ≠ SKIPPED） | `rapid.mjs`、`debt.mjs` | 有 `FAST_MODE_DEBT` / `FAST_MODE_OPEN` 两个 risk finding | 观察：要核本仓关窗后债务是否还在、偿还是否要求债后 fresh PASS；缺的证据是一次实跑 | — |
| 显式 requirement-trace 文件（REQ → paths + checks → fresh PASS），spec lint 只认 fence 外 heading | `.codex/harness/requirement-trace.json`、`spec.mjs:355-442` | `trace` 是启发式推断；截断仍报成功 | 截断 → rc 3 **吸收（本轮）**；显式 trace 文件观察（多一份要手工维护的映射表，轻量项目未必划算） | `spec.mjs` |
| Review v2：三阶段固定序、UNABLE 必须结构化、前序失败阻断后续 APPROVE、范围不可自缩、`reviewer.claim` 只是自报 | `reviews.mjs:168-207` | `review` 有 lens / backlog / 轮次上限 | 观察：值得抄的是「UNABLE 必须结构化」与「范围不可自缩」两条约束，等 review 引擎下次动时一起 | — |
| Rule registry：闸门声明 `enforcement / bindings / gateKinds`，静态可达 + 运行时命中双向审计，死闸机器可见 | `rule-registry.json`、`guard-registry.mjs`、`audit.mjs` | `rules-audit` + `gate-audit` 各管一半 | 观察：本仓「闸靠数据留」已有 gate-audit；把二十余个 hook 登记进表再和 gate log 对上是中等改动，先看 gate-audit 能否直接扩 | — |
| runtime 树哈希进证据身份（harness 自己改了 → 旧 receipt 自动失效） | `identity.mjs:63-89` | receipt 绑 diffHash / contentHash，不绑引擎版本 | **吸收（本轮）** | `quality.mjs` receipt 加 `engineHash`，verify 时不等即 STALE |
| 受管路径安全边界：逐段拒 symlink / `..` / NFC 不定形 / Windows 保留名 / 尾点尾空格，NFC+lowercase 碰撞检测 | `files.mjs:86-142` | `setup.sh:19-23` `validate_target` 只查 `..` | **吸收（本轮）** | `setup.sh` / `setup.ps1` 的 `validate_target` |
| `pack-check` 分发面双向闭包（missing / unexpected / forbidden / duplicates） | `scripts/codex-base.mjs:138-181` | `release` 的 manifest 项 + `test-release-manifest.sh` 已是双向 | 拒绝：等价物已有 | — |
| hook 引导 fail-closed + 崩溃进 gate log + Stop 事件查 `stop_hook_active` 防死循环 | `bootstrap.mjs:26-63,195-243` | 契约外退出码已 block 并点名；三振熔断已有 | 拒绝：等价物已有；`stop_hook_active` 本仓 stop-gate 用 strikes 文件承担同一职责 | — |
| `never` 模式下 `prompt` 即死锁 → 无应答通道的闸不是保护是死锁 | `b547f30`、ADR-0005 | 本仓 headless / CI 下 hook 的 block 路径没专门审过 | 观察：#10 headless 烟囱测试做了才有证据 | — |
| PermissionRequest 精确 argv 放行 | `config.toml:55-63` | 本仓 `bypassPermissions`，不走 PermissionRequest | 拒绝：前提不成立 | — |
| Codex 原生面（execpolicy Starlark / `[auto_review]` / `codex exec --output-schema` / `/hooks` 信任哈希） | — | — | 拒绝：平台特有 | — |

## ccb-base 实战回流（2026-09-21 起，随盯梢持续追加，统一清理时再排批）

ccb-base 的 Claude 侧单兵层就是照本仓抄的，所以它在实战里撞出来的毛病，多半本仓也有。下表的「判定」一律还没动手：**吸收（待排期）** = 已有实证、等统一清理；**观察** = 缺一块证据，写明缺什么；**已挂账** = progress.md 里已有 TODO，这里只留句柄不重复。家底类（hooks / skills / rules / `.github`）动之前照旧要用户拍板。

用户 2026-09-21 19:05 前后已点头、随统一清理落地的三条（原话「我这边都同意，按照你建议走」）：单兵 Git 工作流补「宿主已绑定分支时不得另开或切换」的边界注记；「谁在守」再标接没接线（doctor 那一半仍是观察，缺的证据不变）；读密钥闸按 ccb-base 线 4 最终版的两层判据修（#76）。同一句话里用户还签了 ccb-base 的 B2 方案 D（逐进程 bubblewrap），那条不归本仓。

| 机制 / 发现 | 它在哪（证据） | cc-base 现状 | 判定 | 落点 |
|---|---|---|---|---|
| 读密钥闸的判据从「命令是不是读取器」翻成「argv 里有没有密钥路径」：命中即拦，只对一张很短的、封闭的元数据命令表（`ls` / `stat` / `test` / `chmod` / `chown` / `rm` 一级）放行；`$()` 与反引号同一处理、递归同一判据；解析不了的**只看原始命令文本里有没有密钥路径 token，有就拦、没有就放行，不因为「看不懂」而拦** | ccb-base `ccb/group/line4`：`22eb92c`（翻判据）→ `4399baf`（有界静态兜底），`.claude/hooks/lib/floor-policy.py`；顾问探测 43 条（20 必拦 / 23 必放）两侧重放 86/86；Codex 原生调用的记录器落盘：读假 `.env` rc=2、界外 `rm -rf` rc=2、哨兵目录完好 | `secret-exfil-guard.mjs:22-29` 按命令名枚举，实测 `tac .env` / `paste .env` / `jq -R . .env` rc=0 | **已挂账 #76**；修法直接参照 `4399baf`，不必另行设计 | `secret-exfil-guard.mjs` + `test-hooks-floor.sh` |
| 地板闸必须同时有「必须放行」断言：一道会拦日常命令的地板闸，结局是被人关掉，比没有还糟 | ccb-base `2686999` 为拦命令替换读密钥，一度把 `export PATH="$(ls -d …)"`、`cd $(git rev-parse --show-toplevel)`、`` echo `date` ``、`grep … $(git ls-files)` 全拦了，且同一写法换个外层命令行为就不同；`4399baf` 修复后 14/14 | `test-hooks-floor.sh` 读密钥闸的放行侧只有 SE-1（普通命令）与 SE-5（`.env.example`）两条，没有元数据命令、没有命令替换 | **吸收（待排期）**，随 #76 一起：放行侧补两三条代表用例（元数据命令一条、不含密钥路径的命令替换一条），不铺开 | `test-hooks-floor.sh` |
| 本仓读密钥闸对**引号 / heredoc 里的字样**也拦：命令本身不读任何密钥，只是正文里提到了「读取器 + `.env`」就被拒 | 2026-09-21 11:55 主 Agent 用 Bash heredoc 写一条给 ccb-base 指挥官的消息，正文含 `cat .env` 字样，被本仓 `secret-exfil-guard` 拦下（未绕闸，改用写文件工具落盘后再发） | 规则是对整条命令串做正则，不区分「要执行的命令」与「数据」 | **观察**：#76 改成 argv 级判定后第一层自然不再误拦；但上一行的第二层文本兜底会保留这类误拦——取舍留到修 #76 时定，缺的证据是这类误拦在日常里多不多 | `secret-exfil-guard.mjs` |
| 安全文档承诺得不许比实现强 | PR #2 去掉了 README 里并不存在的 `Bash(git push*)` ask 规则；同一行还剩一句「任意子进程绕读由 secret-exfil-guard hook 补拦」，实测不成立 | `README.md:89` | **已挂账 #76**（末尾已补一句，修 #76 时一并改） | `README.md` |
| 单兵 Git 工作流的边界注记：「动手前先开分支」只在单一工作树下成立；宿主或编排层已把工作树钉在某个分支上时，不得另开或切换，以编排层规则为准 | ccb-base 2026-09-21 09:39：线 1、线 2 的编码席（两家不同模型）几分钟内各自按单兵 skill 开了工作分支，CCB 启动校验 `workspace branch mismatch`，整队起不来；ccb-base 为此加了编队规则第 7 条（`302901b`）。cc-base 差距报告 R3 与 codex-base 差距报告「反向」一节独立给出同一建议 | `dev-builder/SKILL.md` [开发规则清单] 的 Git 工作流没有这条前提 | **已吸收（2026-09-24）**：一句话边界注记，不引入任何集群概念；落在 dev-builder [开发规则清单] [Git 工作流]，codex-base 同日在其 dev-builder 同步（其 progress #26） | `.claude/skills/dev-builder/SKILL.md`（家底） |
| 「谁在守」再细一层：不光标闸名，还标这道闸**接没接线、验没验过**；没验过的如实写「仍靠自觉，不能宣称机器闸已生效」 | ccb-base `.ccb/ccb_memory.md` 第 7 条的写法；当天的实证——Codex / Grok / AGY 三种 CLI 上闸文件都装了，但未经人工信任前 Codex 显示 Installed 2 / **Active 0**、Grok `Hooks(0)`、AGY 加载 0，静默跳过、无任何报错 | `.claude/CLAUDE.md` 铁律每条末尾标闸名，不标接线状态；`doctor.sh` 核 hooks 目录、语法、lib 齐全，是否逐条核 `settings.json` 挂的命令指向的文件存在——未查证 | **观察**：缺的证据是在一个全新克隆的目标项目里首次启动 Claude Code，看未确认工作区信任前项目 hook 是否执行；若同样静默跳过，则 `docs/guide` 安装章要写明这一步、doctor 要报「装了但未生效」 | `doctor.sh` + `docs/guide` 安装章 |
| 本仓装出的 `.claude/settings.json` 会被别家 CLI 吃到 | Grok 1.0.34 自带文档 `~/.grok/docs/user-guide/10-hooks.md:70` 把 `<project>/.claude/settings.json` 列为「Claude compatibility」的项目级 hook 来源；实测信任后 `/hooks` 显示 `Custom: …/.claude (2 hooks)`。但工具名不同：读密钥闸的 matcher 要写成 `Bash|Read|ReadFile|read_file|view_file|run_terminal_command` 才盖得住 | 本仓 matcher 只写 Claude Code 的工具名 | **观察**：属 grok-base / ccb-base 的事；本仓只需知道有这条通路，别在 settings 里放只对 Claude 成立的假设。等 ccb-base 的 Grok 原生反测出结果再定 | — |
| 只在我们没有的环境里才执行的测试分支，等于从没被测过 | PR #2：`test-ui-audit.sh` 的 U4 在 `HAS_ENGINE=1` 时走隔离分支，本机与 CI 都没装 playwright-core，该分支从未执行，装了引擎的机器上恒红（假红）；修复后本机重跑仍未覆盖到那条分支。同日 ccb-base 三个席位各自注明「本机无 shellcheck，静态检查只做了 `bash -n`」，副官的回归驱动把临时目录放错位置导致误报红——都是换个环境才露馅 | CI 矩阵是 ubuntu / windows × node 22 / 24，无「引擎在场」的格子 | **吸收（待排期）**：CI 加一个装 playwright-core 的格子；或至少让套件在输出里点名「本环境未覆盖的分支」，别让 PASS 冒充覆盖 | `.github/workflows`（家底）+ `test-ui-audit.sh` |
| `run-all` 失败汇总点名到具体套件 | PR #2 正文；`run-all.sh:324` | 四个套件共用一句写死的「安装器 / 路由一致性不过」 | **已挂账 #77** | `.claude/tests/cases/run-all.sh` |
| 验收时对新写的红锁用例亲手做一次变异（把实现改坏一处，看用例红不红） | 2026-09-21 对 ccb-base 两个测试席交的用例各做一两个变异：线 3 退出码恒 0 → 7 红、去掉 grok 检查 → 恰好 1 红并点名；线 4 密钥路径永不命中 → 4 红涨到 14 红。本仓 #75 当时 A5 没牙，也是主 Agent 自己做变异才发现的 | harness 层 golden 有 `--mutate`；验收五步闸与 test-builder 里没有「对红锁用例做一次变异」 | **观察**：只给 red-locks 与 HIGH 档、每次一处、主 Agent 亲手做，做完还原——防的是「测试全绿但没牙」；缺的证据是它会不会沦为又一道形式，先在下两次红锁里手工试 | `.claude/rules/dev-workflow-details.md` 验收段 |
| 两条测试反模式点名：①用测试把实现里的名单重新枚举一遍（实现漏一个命令名，测试就锁一个，永远差一个）；②测试比被测代码还长 | ccb-base：线 4 测试席锁 `nl`、编码席补 `nl`，下一个是 `tac`；顾问列了 11 种绕过读法，明确要求「只锁一条红，不许铺成 11 条」。线 3 的 `test-env-check.sh` 449 行，被测脚本约 310 行，退回后砍到每个验收项一条（`71f9f2d`） | test-builder 有「按风险给预算、不做全量覆盖」，没有点名这两条 | **吸收（待排期）**：各一句话 | `.claude/skills/test-builder/SKILL.md`（家底） |
| 「闸靠数据留」现在是空转的：下游项目的拦停记录从未回流 | PR #2 正文的题外话，属实：本仓 `gate-audit` 十个闸全零记录、0 份 `gate-block.log`，脚本自己诚实标了「零拦停无从评价」 | Pinned 有「闸靠数据留」原则，无回流通道 | **观察**：ccb-base 十四席真跑起来之后是第一批真数据；缺的是回流通道怎么做（谁把下游的 `gate-block.log` 带回来、隐私怎么处理）。留到与用户谈 ccb-base 第 3 步范围时一起定 | `gate-audit.sh` |
| 上游 → 下游编队层的同步：记上游提交与文件哈希，三方比对（上次上游 / 最新上游 / 下游现状），**只出差异报告、不自动覆盖**；清单三层标记 `upstream` / `forked` / `local` | ccb-base `.ccb/evidence/step3-base-sync/cc-base-gap.md` 与 `codex-base-gap.md` 两份报告各自独立得出同一方案；活证据是 ccb-base 的 `.claude/` 停在 2026-08-11、`.claude/agents` 停在 06-15，本仓 09-15 的重构一点没吃到 | 有 `FRAMEWORK-MANIFEST` 与 `gen-manifest.sh`（#71 排除表从头锚定的毛病会直接影响这件事） | **观察**：属 ccb-base 第 3 步；本仓这一侧可能要提供一个只读的 `sync-check` 报告，先修 #71 | 待定 |
| `.sh` 的静态检查 | ccb-base 当天装了 shellcheck 0.11.0 后，顾问对三条线已提交的 7 个 shell 文件跑 `-S warning`，0 告警 | 本仓 CI 与 doctor 都不跑 shellcheck（全仓无引用），`.sh` 只靠各自的用例 | **观察**：0 告警说明它在那批文件上没增量价值；缺的证据是在本仓自己的 `.sh` 上跑一次看有没有真问题，有再谈进 CI | — |
| 闸认不出输入载荷时：不静默放行、也不一律拒绝——对**整段原始 stdin 文本**跑第二层（出现密钥路径 token / 「递归删除 + 界外路径」就拦，否则放行），并把「收到过不认识的输入」写一条 gate log | ccb-base 2026-09-21 AGY 原生反测：hook 被真实调用四次、两道闸全部返回 0，假 `.env` 被读出——AGY 喂的是 `{"toolCall":{"name":"view_file","args":{"AbsolutePath":…}}}` / `args.CommandLine`，闸只认 `tool_name` / `tool_input.command`，认不出来就当成没什么可查的放行了；而载荷原文里明写着 `…/.env` 与 `rm -rf -- /var/tmp/…`。同一批动作在 Codex 上两道闸各返回 2。这是「规则钉在一种精确形态上」的第七次 | 本仓只面向 Claude Code，载荷形态单一；但 `test-hooks-floor.sh:124` DP-6 明写「损坏输入 → fail-open 静默 exit 0」，读密钥闸对解析不了的输入同样静默放行、不留痕 | **观察**：本仓不需要多形态适配；值得抄的只有后半——解析失败时扫原文兜底 + 留一条 gate log。随 #76 一起看；缺的证据是 Claude Code 升级改过 hook 载荷字段没有（改过一次就值得做） | `secret-exfil-guard.mjs` / `dangerous-pkill-guard.mjs` |
| 发版产物名取自仓库目录名，测试却把名字写死 | ccb-base 2026-09-22：顾问在 `/tmp` 隔离克隆里对合并版本跑全部 59 套。克隆目录叫 `fix` / `main` 时 make-release / release-provenance / release / test-release 四套红（产物成了 `/tmp/fix-v0.0.0-test.tar.gz`，断言找的是 `/tmp/ccb-base-…`）；目录改叫 `ccb-base` 重跑，四套全绿、其余结果不变。它的 `make-release.sh` 就是照本仓抄的 `REPO=$(basename "$ROOT")` | 本仓 `make-release.sh:12` 同一句，产物 `/tmp/<目录名>-<版本>.zip`；两份发版用例不跑 make-release、也没写死 `cc-base`，所以测试不红——但用户把仓库克隆成别的目录名，发出来的包名与包内顶层目录就跟着变 | **观察**：本仓没有因此失败的用例；缺的证据是有没有人真在别名目录里发过版、release-builder 或文档里有没有按固定包名去找产物的地方 | `make-release.sh` |
| 档位校验器只认 `entry.args`：下游 settings 用 `entry.command` 写 hook 时，`tier validate` 返回 ok 却报 `registeredHooks:0`，`tier status` 列的 off / advise / block 证明不了任何一道 hook 真按档位跑 | ccb-base 2026-09-23 把本仓 `.claude/harness/lib/tier.mjs` 字节照搬过去，reviewer1 实跑 `tier validate` 得 `registeredHooks:0`（ccb-base `.claude/settings.json` 全用 `entry.command`）；证据 ccb-base `.ccb/evidence/closure-20260923/review-c5-reviewer1/report.md` M1 | `tier.mjs:68` 只遍历 `entry.args`；本仓自己的 settings 有 21 处 `args`，所以本仓不露馅 | **观察**：缺的证据是安装到目标项目后，用户自己加的 hook 走 `command` 写法时档位是否静默失效；若是，validator 至少要报「有 N 条 hook 未登记」而不是 ok | `.claude/harness/lib/tier.mjs` |
| 交接步骤里让接手的 Agent 自己降档 / 拉取框架仓：自动模式会判成「改自己的护栏」拦下 | 2026-09-23 接手 ai-node 会话：交接单「开工前三步」的 `tier set fast` 与 `git -C ~/code/cc-base pull --ff-only` 两条都被 auto mode 以 Self-Modification 拒绝，只能请用户亲敲 | 交接 / 恢复类文档默认 Agent 能自己做这两步 | **吸收（待排期）**：交接模板把「降档、拉取框架仓本身」标成用户亲手执行项，别写进 Agent 的开工步骤 | 交接模板 / `docs/guide` |
| 读密钥闸误拦一条不含任何密钥路径的只读命令 | 2026-09-23 主 Agent 用一条 Bash 统计 cc-base / codex-base 脚本行数与 import（`wc -l`、`ls`、`grep -n`，涉及 `.claude/harness`、`.codex/runtime` 等路径），被 `secret-exfil-guard` 以「命令参数是密钥文件路径」拦下；同样内容写成脚本文件再 `bash` 执行即放行。命中的是哪个 token 没查出来 | 规则对整条命令串做正则 | **观察**：与上面「引号 / heredoc 里的字样也拦」同类，随 #76 一起看；缺的证据是具体命中 token，下次复现时带 `CLAUDE_HOOK_DEBUG` 取一次 | `secret-exfil-guard.mjs` |
| skill 文件里的行尾空格会原样漂到下游，下游一跑 `git diff --check` 就红 | ccb-base 2026-09-23 字节保真复制前段技能后，合并时 `git diff --check` rc2，四处全在 `product-spec-builder/references/third-party-questionnaire.md`（引用块里的 `> ` 行）；下游因为要求字节一致不能自己修 | 本仓该文件同样 4 行行尾空格；static-check 不跑 `diff --check`，也不查行尾空格 | **吸收（待排期）**：源头删掉这 4 处；static-check 对 `.claude/skills/**` 加一条行尾空格检查（Markdown 硬换行确需保留的另列白名单） | `.claude/skills/product-spec-builder/references/third-party-questionnaire.md`（家底）+ static-check |
| 追踪表「结构全绿」不等于需求被验证：运行时只查 ID 存在、路径是普通文件、check 已注册，不查挂上去的检查是否真在验那条需求 | ccb-base 2026-09-23：deputy 为让 `spec trace` 转绿，给「对抗式 Pair」挂了密钥 / 删除地板测试、给「红测先行」挂了无关 selftest，trace rc0 且 7/7；reviewer1 逐条读才判为假追踪，第二轮改成「如实 > 变绿」后如实报 2 条 missing。证据 ccb-base `.ccb/evidence/closure-20260923/review-c6-reviewer1/report.md` | 本仓 harness 的 `spec-lint` / `trace` 同一性质：只做结构校验 | **观察**：机器闸补不了语义；可做的是在 dev-planner / code-review 的验收话术里点名「trace 绿 ≠ 需求有验证，挂载理由逐条写一句」。缺的证据是本仓自己的项目里有没有出现过同类挂载 | `code-review` / `dev-planner` skill（家底） |
| 「N 条历史失败」要有点名到套件与断言的名单，否则每个验收者都得自己重核一遍 | ccb-base 2026-09-21 收尾：集群报「组合回归 343 过 / 9 条历史失败」，且回归是两个旧版本分段跑的拼合证据；顾问只能在隔离克隆里对最终版本与旧 main 各整跑一遍才敢签——结果那 9 条属实，另外还照出 5 套不在回归集里的也长期红着、没人登记过。已列入它第 3 步第 5 项 | 本仓 CI 全绿、没有已知红，`run-all` 任何一条红都直接挡推送 | **观察**：本仓现在用不上；哪天出现「先挂着的红」再立名单。与 #77（失败汇总不点名）同源 | — |

正向验证（无需动作，记一笔免得下次重评）：本仓的七字段派单包与回执信封被下游证明有用——ccb-base 线 2 的回执缺 SHA / AC 对应 / 证据路径 / 复现入口，是副官独立复核才发现的，它的差距报告把「统一回执信封」排在最值得吸收的第一位；「归档搬运交给脚本」（#72 / #75）排第二；「压缩两端的闸」排第三。ccb-base 判**不适用**的一项也值得记：agent-memory 封顶机制是给每次 fresh 的子 Agent 攒跨次记忆用的，常驻席位的问题是上下文会涨、不是记不住——同一个机制换了运行模型未必成立。

## 本轮吸收批次

按落地顺序，每批 tester 造红 → implementer 修绿 → code-reviewer 复审 → commit（本仓 commit 即 push、即触发 CI）。commit 落定后回填。

| 批 | 内容 | commit |
|---|---|---|
| 0 | 审查清单挂账 #31 `.runtime` pathspec 裸奔 / #32 软链路径 / #33 DENY 注释（连同本台账首版、feedback 索引重建） | `f3cd449` |
| 1 | 「读不出来 ≠ 不存在」：留痕原语、receipt 不可读 fail-closed、supervisor 坏 state fail-visible、arch-trend 坏行判红、verify all-SKIPPED → rc 3、trace 截断 → rc 3；第二轮把目录级 / 权限级 I/O 失败也收进来（只有 ENOENT 算不存在） | `66f7725` |
| 2 | golden `--mutate` + `MUTANTS.json`（13 条，本仓 13/13 killed） | `c60ea14` |
| 3 | 发版与证据绑定：release `gate-fresh` 项 + 信任边界字段、receipt 绑 `engineHash`、治理面改动 risk 告警、shim 发现 | `c60ea14` |
| 4 | 小修：doctor 清单全量比对、`url-userinfo` 密钥模式、static-check 补 `node --check`（shim 与 validate_target 分别并入批 3 / 批 5） | `c60ea14` |
| 5 | 安装器事务化最小切片（dry-run + 锁 + marker + 路径边界，.sh/.ps1 成对） | `c60ea14` |
| 6 | `.claude/worktrees/` 进六份排除表——本轮并行时发现 Claude Code 隔离副本会被当框架文件登记与安装 | `c60ea14` |
| 收口 | golden 掩码 `engineHash`、doctor 目标项目可用、setup 未知选项拒绝、豁免重绑、擦开发者路径；**v1.13.0 发版** | `2380d28` |
