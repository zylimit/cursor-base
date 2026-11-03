# 同类框架横向调研（2026-09-10）

调研 11 个 GitHub 上的 Claude Code 框架 / 工程方法，读的是真文件不是 README 概述，每条结论带 URL。抽取稿在 `/tmp/gh-study/A~E`。
判断尺子（贯穿全文）：纯 Claude Code + 原生 Sub-Agent，无 daemon / tmux / 外部 worker；主 Agent 唯一编排者、扁平；单人开发者；反过度设计；闸要说得出挡住过什么。

## 0. 一句话结论

看完之后**没有一个框架值得整体照搬**，但有 11 个具体机制值得拿。真正的收获是三条：
1. 我们的分工判断被独立验证了——Dive-into-Claude-Code 拆完 Claude Code 源码给出的四个必答题之一就是「Where does reasoning live? → **Model reasons; harness enforces.**」，与我们「主 Agent 不亲自动手、闸负责强制」是同一句话。
2. **四态回执缺一态**：预算 / 轮次耗尽既不是 DONE 也不是 BLOCKED，今天没有诚实的位置放它。
3. 最扎心的一条冲着我们自己：Ruflo 548 MB、SuperClaude 单命令 32 KB，都是我们今天刚从 2667 行砍到 1126 行要躲的病——而我们的 `harness/` 18,020 行占全框架 55%，服务的是一个**默认关闭**的能力。

## 1. 样本与活性（GitHub API 取数，2026-09-10）

| 项目 | star | 最近提交 | 体量 | 判定 |
|---|---|---|---|---|
| [ruvnet/ruflo](https://github.com/ruvnet/ruflo)（前 claude-flow） | 71,883 | 当天 | 548 MB / 965 open issues / 100+ agent | 活得过头 |
| [SuperClaude-Org/SuperClaude_Framework](https://github.com/SuperClaude-Org/SuperClaude_Framework) | 23,873 | 3 周前 | 4 MB / 30 命令 / 20 agent | 活，节奏慢 |
| [gastownhall/gastown](https://github.com/gastownhall/gastown) | 17,998 | 当天 | Go 1563 文件 / 448 open issues | 非常活 |
| [buildermethods/agent-os](https://github.com/buildermethods/agent-os) | 5,388 | 2026-08-29 | 24 文件 / 5 命令 | 活 |
| [VILA-Lab/Dive-into-Claude-Code](https://github.com/VILA-Lab/Dive-into-Claude-Code) | 2,103 | 2026-09-07 | 论文 + 设计目录 | 活 |
| [GWUDCAP/cc-sessions](https://github.com/GWUDCAP/cc-sessions) | 1,552 | main 2025-10-17 | Python hooks + protocol 模板 | 半死 |
| [dlorenc/multiclaude](https://github.com/dlorenc/multiclaude) | 566 | 2026-01-28 | Go daemon + tmux | 静止 |
| [barkain/claude-code-workflow-orchestration](https://github.com/barkain/claude-code-workflow-orchestration) | 84 | 2026-08-03 | Python 插件 | 活 |

另有三个「大而全配置集合」类（Everything Claude Code / awesome-claude-code-toolkit / claude-code-infrastructure-showcase）单列在 §6。

## 2. 三个流派

- **外挂编排型**（Ruflo / Gas Town / Multiclaude）：daemon、tmux、Go 二进制、raft 共识、几十个常驻工人。它们解决的是「跨仓协调几十个 Agent」，我们明令不做。可迁移的是**原则**，不是机器。
- **纯提示词型**（SuperClaude / Agent OS）：不写编排代码，靠行为注入与标准注入。离我们最近。
- **纪律层型**（cc-sessions / barkain）：用机器闸锁住计划边界。cc-sessions 的实现最硬，但已半死。

## 3. 值得拿的机制（①～⑧，另有 ⑨～⑪ 在 §6）

按证据强度排序，前四条我认为该做。

**① 补一态：预算耗尽 ≠ 完成**（Dive-into-Claude-Code）
原文：`Reaching a budget limit is a stop reason, not proof of completion.`
我们的回执信封是 DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED 四态，派单包写着「每单 ≤ 6 次工具调用」「预算 ≤ 35 次」。子 Agent 撞上限时，今天最可能自评 DONE_WITH_CONCERNS——**把「没做完」说成「做完了但有顾虑」**。落地：加 `BUDGET_EXCEEDED` 一态，或在 BLOCKED 里明确点名这一种，并禁止自评成 PASS。
同源还有一句该抄进验收铁律：`进度摘要、预测结果、小样本回归都不足以证明成功`。

**② CI 红的三条互斥出口**（Multiclaude）
它把 CI 当唯一真值，红了只有三个去处：派新工人到同一分支修 / main 红则全局停并派急修 / 打 `needs-human-input` 标签停止重试并上报人。原文：`Some PRs get stuck on human decisions. Don't waste cycles retrying.`
**不存在「红着挂那儿」这个状态**——正是今天连红四次的病。我们今天已落地「推送后读 CI 结论」，缺的是红了之后的去处。

**③ 规则条目自带 `Detection:` 命令**（SuperClaude RULES.md）
它少数规则在正反例之后直接给一行 grep，例如 `Detection: grep -r "skip\|disable\|TODO" tests/`。
我们的 `rules-audit` 现在报 390 条规则里 **306 条 unclassified**，主控里六条铁律自己标着「靠自觉、没有机器闸」。给规则加一行「怎么检出违规」，是提示词闸 → 机器闸的最短路径：先有命令，攒够证据再决定要不要做成 hook。这条和我们「闸靠数据留」是同一套逻辑的上下游。

**④ 规则索引 + 按任务注入 2-5 条**（Agent OS `index.yml`）
它的索引只存一行描述，存在理由写得很直白：`enables /inject-standards to suggest relevant standards without reading all files`。
我们相反：`.claude/rules/` 720 行整份读，其中 `harness-large-repo.md` 236 行是**默认关闭**能力的细则却挂着「必须先读」。落地：给 rules 建一行描述的索引，派单时按任务匹配 2-5 条注进派单包。

**⑤ 计划锁 = 名单 diff**（cc-sessions）
PreToolUse 逐字比对新旧 todo 名单，改了就清空并踢回讨论模式。我们没有任何闸盯着「批准过的 TaskList 被悄悄改了」。
抄「把原清单和新清单并排贴出来让用户裁决」，**不抄**它的 SHAME RITUAL 强制忏悔文本——那是表演式认同的镜像版，与我们「接收反馈不表演式认同」直接冲突。

**⑥ `SubagentStart` 注入回执契约**（原生能力，非某框架）
平台约 30 个 hook 事件我们只挂了 10 个。`SubagentStart` 能给每个新派子 Agent 注入 context——回执信封、四态自评、Business Context 缺就回 NEEDS_CONTEXT，今天全靠我写派单时记得写。挂上就变成接收侧一律收到。
同族还有 `TaskCompleted`（**能拦**），是「报完成必须有当场跑出的证据」唯一能机器化的挂点。

**⑦ 注入形态先问「引用还是拷贝」**（Agent OS `inject-standards`）
把标准放进 skill 或 plan 时，先问用户要 `@路径` 引用（保持同步）还是拷贝正文（自包含）。这正好解我们 skill 之间抄来抄去产生重复段的老毛病——今天刚删掉 8 个重复语态块。

**⑧ 并行安全三句判据**（Ruflo CLAUDE.md）
`Never allow two writers in one worktree` / `Read-only agents may share a checkout; writing agents may not` / `A lease or work claim coordinates ownership; it never grants authority.`
我们 `subagent-dispatch.md` 的并行段现在只说「跨 Task 编码默认串行、只读才并行」，这三句更锋利，可直接替换。

## 4. 明确不该抄的

| 来源 | 不抄什么 | 为什么 |
|---|---|---|
| Ruflo | daemon + 10 个 cron worker、swarm/hive-mind 共识层、agent 内再 spawn agent | 违反扁平编排铁律；纯 CC 的 Sub-Agent 本就上下文隔离，套中间层只增失控面 |
| Ruflo / SuperClaude | truth score / confidence 分数当验收依据 | 分数是模型读自己填的 flag 算出来的自评；我们的铁律是客观证据 |
| SuperClaude | 靠 7 个 MCP 服务器堆能力、单命令 32 KB | 没装对应 MCP 就整段空转且框架自己不检测；体量正是我们要躲的 |
| Gas Town | 常驻编排 + 50 字段 bead schema + 黑话术语层 | 样本里绝大多数字段全是空串——字段是为几十个并行工人准备的，单人永远为空 |
| cc-sessions | Bash 白名单 extrasafe、SHAME RITUAL | 闸需要天天开后门说明它挡的不是真风险；羞辱仪式与我们的反表演式认同冲突 |
| Agent OS | profiles 多档继承、每步 AskUserQuestion 停等 | 与我们已有三档打架；与「授权连续执行」冲突 |
| barkain | 「连 Read/grep 都必须委派」、8 并发默认值 | 作者自己正在往回收 |

## 5. 被独立验证的地方（不用改）

- **模型推理、harness 强制**的分工（Dive-into-Claude-Code 四个必答题之一）。
- **隔离的是对话，不是文件系统 / 进程 / 权限**——原文 `Separate context windows also do not imply separate filesystems, processes, or permissions.` 我们的 fresh 实例 + 显式给上下文正是这个理解。
- **策略要带依据与管辖边界**：Ruflo 的 `mcp-policy.json` 带 `rationale` + `references.adr` + 一句「哪些不归本策略管」，等于我们 Decisions 的三要素（依据 / 适用范围 / 取代）。
- **运行态不进 git**：cc-sessions 把 state 写进 .gitignore，Gas Town 把 session/tmux 归纯运行态——与我们「三层不得混写」一致。
- **判空转要看客观产出物**：Multiclaude 的 supervisor 判据是「CI 绿但 PR 不动」，不是看 agent 自己说什么。

## 6. 大而全配置集合类：三个仓在同一处塌方

| 项目 | star | forks | 最近 push | 体量 | open issues |
|---|---|---|---|---|---|
| [affaan-m/ECC](https://github.com/affaan-m/ECC) | 255,458 | 38,250 | 2026-09-09 | 50 MB | 188 |
| [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | 2,605 | 940 | 2026-05-12 | 1.1 MB | 310 |
| [diet103/claude-code-infrastructure-showcase](https://github.com/diet103/claude-code-infrastructure-showcase) | 10,013 | 1,228 | 2026-07-13 | 264 KB | 18 |

（数字用带认证的 GitHub API 当场复核过，不是转述。）

**三个都在同一处塌方：没有 manifest、没有覆盖保护、没有淘汰机制。**
- ECC 实测 68 agents / 286 skills / 94 个 legacy command shim（外界流传的 28/59/116 是旧数），得专门开一间 `legacy-command-shims/` 放死掉的东西；skill 选择纯靠 description，没有任何激活 hook。
- toolkit 的 README 自称 135 agents / 42 commands / 35 skills，实测 89 / 36 / **`skills/` 目录根本不存在**；装完 25 个 hook 一个都不生效，脚本里自己承认路径要手改；停更 4 个月、310 个 open issue。
- showcase 是三个里唯一小而深的（作者真实项目沉淀，11 个 hook 脚本 1100+ 行 TS），但招牌功能出厂即 `"skill_activation_mode": "disabled"`，且 skill 有两个真源。

**结论：堆量路线不值得学**，我们砍行数的方向是对的。但从这一堆里挑出了三个真机制：

**⑨ 同一件事只拦第一次**（showcase `skipConditions.sessionSkillUsed`）
它的闸有三重逃生阀，其中一条是「本 session 已经用过该 skill 就不再拦」。我们的 `three-file-sync-gate` 是每次 Stop 都提醒，同一轮工作里重复喊；加一个 session 级去重能把噪音降下来而不削弱它。
配套：它的 `enforcement: suggest|block|warn` 是**数据字段**不是代码分支（与我们 `profile.json` 的三档同构），且每条 block 自带 `blockMessage`，内容是「怎么解锁」的五步操作而不是「你被拦了」。我们的闸大多只报原因，不报出路。

**⑩ 安装先出计划再预演**（ECC `previewInstallPlan` → `applyInstallPlan`，`--with/--without` 组件级选装）
这是我们真实的短板：`setup.sh` / `setup.ps1` 共 974 行，装到已有 `.claude/` 的项目上时，覆盖保护靠 manifest 三分支，但**没有「先出计划让人看一眼」这一步**。这三个几万 star 的仓全都栽在覆盖上，我们至少该有 dry-run。

**⑪ 别另起一套权限系统**（toolkit smart-approve）
它的自动审批有三态——允许 / 拒绝 / **弃权**，而且判据直接复用用户自己 `settings.json` 里已有的允许与拒绝清单，不另立一套规则。原则值得记：**框架不该发明第二套权限语义**。我们的审批三档是流程约定、settings 里的询问清单是机器约束，两者今天各写各的，值得对一次账。

## 7. 冲着我们自己的一条

Ruflo 548 MB / 965 open issues / 1493 行 CLAUDE.md，SuperClaude 单个命令 32 KB——两个几万 star 的项目都在同一个坑里：**堆量到没人能验证它挡住过什么**。

我们今天刚把六个 skill 从 2667 行砍到 1126 行，但同一把尺子量自己：

| 区 | 行数 | 占比 |
|---|---|---|
| harness | 18,020 | 55% |
| tests | 6,487 | 20% |
| skills | 5,152 | 16% |
| scripts | 2,778 | 8% |
| hooks | 2,239 | 7% |
| rules | 720 | 2% |
| agents | 248 | 1% |

`harness/` 服务的是「大仓能力（可选——按需开启）」，主控明写「默认关闭，不启用对项目零行为变化」，本仓没有 `module-catalog.json`。日常路径（hooks / githooks / scripts / CI / tests）实际调用的子命令只有 13 个：tier / verify / selftest / receipt / skills-lint / import / gate / fitness / catalog-lint / dod / doctor / arch-trend。
这不等于该删——它是为 60 万行级仓库准备的，删了就没了。但**该有一个决定**：是继续养，还是拆成可选包按需装。这个判断权在用户，不在我。
