# agy-base 深度架构分析

> 分析对象：`~/code/agy-base`（Google Antigravity 平台的 SiteMaster 脚手架移植版，自称 v2.0.0，单 initial commit，2026-08-09）
> 分析目的：为 cc-base（纯 Claude Code 框架脚手架 v1.10.0）提炼可借鉴的扩展能力
> 分析日期：2026-08-16 ｜ 分析者：只读研究 Sub-Agent
> 约束遵守：对 agy-base 零写操作；本文件是唯一产出

---

## 1. 定位与运行时

**目标 agent**：Google Antigravity（AGY，Gemini 系 agent 平台，含 CLI / IDE 两形态）。agy-base 是 SiteMaster 家族（cc-base / codex-base / cursor-base / pi-base）向 Antigravity 的移植版，自认「解构并吸收 codex-base, cc-base, pi-base, cursor-base, opencode-base 的核心工程经验」（`progress.md:8`、`README.md:10`）——**它是从 cc-base 等吸收出来的后代，不是独立演化的旁支**。

**如何运行**：完全走 Antigravity 官方原生规范（已联网核实为真实机制，antigravity.google/docs/hooks）：
- 工作区约定 `.agents/`（skills / rules / hooks.json / mcp_config.json），全局约定 `~/.gemini/config/`；
- 主控 prompt 双文件：`AGENTS.md`（编排协议全文）+ `GEMINI.md`（Antigravity 读取的 workspace rules 精简版，`AGENTS.md:17-23`）；
- hook 事件模型：PreToolUse / PostToolUse / PreInvocation（每次调模型前）/ PostInvocation / Stop，hooks.json 顶层按**命名分组**组织且每组带官方 `enabled` 布尔开关（agy-base 用了前四类中的 4 个事件，`.agents/hooks.json:2-52`）；
- matcher 用 Antigravity 工具名（`run_command|write_to_file|replace_file_content|multi_replace_file_content`，`hooks.json:6`、`hooks.json:21`）。

**技术栈**：CommonJS Node 脚本（`package.json:6`），单一 hook dispatcher `hook-handlers.js` + 5 个 harness 引擎 JS + 2 个 JSON 配置；npm scripts 做命令门面（`package.json:7-15`）；setup.sh/ps1 仅 chmod + 跑 doctor（`setup.sh:6-14`、`setup.ps1:1-9`）。

**成熟度（本报告最重要的定性）**：配置面完整、引擎面是**演示级骨架**。整仓 2026-08-08 一天写完、次日单 commit 提交；Node 引擎普遍是 stub：dfx-validator 的 Security 扫描注释自认 `// Dummy scan for demonstration`（`dfx-validator.js:20`）、context-packer 宣称「Context Budget Pack created under .task/context-pack.json」但代码从未写该文件（`context-packer.js:25`）、Stop 完成闸无条件放行（`hook-handlers.js:59-63`）、MCP server 模式只打印一行文字不是真 server（`arch-checker.js:135-136`）、fast-mode 状态无任何 hook 或流程消费。**对 cc-base 而言它整体是降配子集，价值在于个别新纪律条目 + Antigravity 原生接口对照表，不在实现。**

---

## 2. 核心机制全清单（附 file:line 证据）

### 2.1 主控 prompt 与规则分层
- **AGENTS.md 单页主控**（约 8KB）：SiteMaster 角色 + 全流程（需求→架构→DFX→计划→编码→审查测试→发布）`AGENTS.md:5-6`；中文交流 `AGENTS.md:8`；运行信任面三项（AGENTS.md / GEMINI.md / .agents/）`AGENTS.md:17-23`；**八大铁律**（安全边界不可豁免 / 保护现有工作区 / 主 Agent 唯一编排 / 职责隔离写测独立 / Verification Before Completion / Red-Locks-The-Bug / **Lockfile 版本锁纪律** / 三文件同步）`AGENTS.md:29-38`；派单契约六字段 `AGENTS.md:44-53`；回执信封六字段 `AGENTS.md:55-64`；ASCII 初始化标识 `AGENTS.md:127-140`。
- **GEMINI.md 第二规则面**：Antigravity 平台自动读取的 workspace rules，仅 17 行英文——安全底线（密钥/破坏操作/工作区保护/验证先行）`GEMINI.md:3-6`、架构与质量 `GEMINI.md:8-11`、编排三条 `GEMINI.md:13-16`。分层思路 = 主控叙事进 AGENTS.md、机器必守底线进 GEMINI.md。
- **rules/ 细则 5 份**：anti-performativity（五步验证门 `anti-performativity.md:5` + 红转绿五步 `anti-performativity.md:10-15`）、architecture-governance（依赖方向 / 棘轮零容忍 `architecture-governance.md:4-14`）、harness-large-repo（禁全仓灌入 / 4000 token 预算 / 串并行纪律 `harness-large-repo.md:4-15`）、quality-attributes（5-D 各维要求，含 risk scan `quality-attributes.md:6`、Secondary Sign-off `quality-attributes.md:15`、state prune `quality-attributes.md:20`、lockfile `quality-attributes.md:24`）、subagent-contracts（扁平编排 / 四角色 / 信封 `subagent-contracts.md:3-15`）。

### 2.2 角色 / 子代理
- 四执行角色 implementer / code-reviewer / tester / deployer + progress-recorder / feedback-observer / evolution-runner，仅存在于 prompt 文本（`subagent-contracts.md:8-12`、`AGENTS.md:33-34`、`EVOLUTION.md:4`）。**没有任何角色定义文件**（无 `.agents/agents/` 或等价物）——对比 cc-base 有 7 个 agents/*.md，这是缺失而非特色。
- 扁平编排 + fresh 实例 + 写测独立照搬家族铁律（`subagent-contracts.md:3-6`、`AGENTS.md:33-34`）。

### 2.3 Hook / 事件（4 组接线，单 Node dispatcher）
- **security-gate（PreToolUse）**：匹配 `run_command|write_to_file`，15s 超时（`hooks.json:2-16`）。实现只拦两个字面量：`rm -rf /` 与 `DROP DATABASE`（`hook-handlers.js:30-36`），其余一律 `{decision:'allow'}`（`hook-handlers.js:39`）。对比 cc-base 的 dangerous-pkill-guard / no-direct-code-guard / tdd-gate 组合弱一个量级。
- **arch-audit（PostToolUse）**：匹配写文件工具（`hooks.json:17-31`），实现是 no-op 返回 `{}`（`hook-handlers.js:42-46`）——宣称的「每写即查架构」没有实现。
- **context-reminder（PreInvocation）**：每次调模型前注入 `ephemeralMessage`「Enforce 5-D DFX, Arch Anti-Rot & Verification Before Completion」（`hooks.json:32-41`、`hook-handlers.js:48-57`）。这是 Antigravity 独有事件（每轮模型调用前），Claude Code 无直接对应（最近似 UserPromptSubmit additionalContext）。
- **completion-gate（Stop）**：无条件 `{decision:'allow'}`（`hook-handlers.js:59-63`）——完成闸是空壳。
- **fail-open 隐患**：stdin 坏 JSON 时 `resolve({})` 继续走 allow 分支（`hook-handlers.js:13-17`），与 codex-base 的 malformed fail-closed 相反，属反面教材。

### 2.4 质量闸门与验证矩阵
- `verification-matrix.json`：按模块声明测试命令 + `requiredPassRate: 100` + `timeoutSeconds: 30`（`verification-matrix.json:3-28`）。**没有执行器消费它**——dfx-validator 只检查该文件存在（`dfx-validator.js:37-46`）。
- 红转绿 / 五步验证门 / 回执信封均为 prompt 规则，无机械 hook 承接（cc-base 的 tdd-gate / stop-gate / subagent-acceptance-reminder 在这里全部缺位）。

### 2.5 架构防腐（arch-checker.js）
- `scan`：DFS 找循环依赖（`arch-checker.js:24-60`；ARCHITECTURE.md:68 宣称 Tarjan，实为普通 DFS）+ 分层违规检查（只查 domain→application/presentation 一种，`arch-checker.js:75-77`；定义了 LAYER_ORDER 却没用上，`arch-checker.js:10-15`），违规 exit(1)（`arch-checker.js:108-110`）。
- `baseline`：把当前 cycles/violations 快照进 arch-baseline.json 做债务棘轮（`arch-checker.js:114-128`）——**但 scan 不读 baseline**，「旧债不挡路、新债零容忍」没实现比对逻辑。
- 关键局限：只校验 catalog 里**声明的**依赖关系，从不扫真实源码 import——cc-base 的 arch-check 拿真实 import 边对照声明图，能力覆盖 agy 版的全部且更强。

### 2.6 5-D DFX 体系
- module-catalog 每模块声明 `dfxTiers`（resilience/security/safety/privacy/reliability 各 LOW→CRITICAL，`module-catalog.json:9-15`）。
- `dfx-validator.js validate`：五维「校验」中三维是纯打印通过（Security `dfx-validator.js:18-23`、Safety `:25-29`、Privacy `:31-35`），两维只查文件存在（Resilience 查 supervisor.js 存在 `:7-16`、Reliability 查 matrix 存在 `:37-46`）。
- `dfx-validator.js prune`：隐私向的运行态清理——按 retention 策略销毁日志与历史证据的入口，实现为删 `.task/` 目录（`dfx-validator.js:67-75`；叙事见 `ARCHITECTURE.md:55`、`README.md:20`）。
- 对照：cc-base 五性治理（12 维定档 + attributeGaps 机器判定 + fitness 五规则 + adapters 外部工具表）完整覆盖并远超此处。

### 2.7 大仓能力（600K+ LOC 叙事）
- 流程链宣称 `catalog lint → affected scan → baseline check → context packing → scoped implementation → verification gate → receipt completion`（`AGENTS.md:96-99`）。
- 实际 context-packer 只做：从 catalog 找到目标模块、打印它的 layer 和依赖列表、宣称已写 `.task/context-pack.json`（实际没写，`context-packer.js:7-26`）。无 catalog lint、无反向依赖闭包、无 diff 分析、无预算执行。
- 4000 token 预算、打包内容清单（目标文件+契约+依赖+测试+diff）、超预算剪裁策略只存在于规则文本（`harness-large-repo.md:8-11`）。
- 对照：cc-base harness 的 impact / context-pack / catalog-lint 是带真实实现的，此处无任何可搬代码。

### 2.8 记忆 / 反馈 / 进化
- 三文件同步铁律（`AGENTS.md:38`）+ progress.md 紧凑记忆原则（「不记机械调试细节」，`skills/progress-recorder/SKILL.md:10-11`）。
- feedback 三条种子（Verification / Red-Locks / **Lockfile Discipline**，`feedback/FEEDBACK-INDEX.md:5-7`）；EVOLUTION 三步流程（Observer→Runner→Proposer，用户批准后合入，`EVOLUTION.md:8-12`）。与 cc-base 同源同构，无新增。

### 2.9 韧性 / Fast Mode / doctor / 安装
- supervisor.js：指数退避（`supervisor.js:43-45`）+ 重试上限熔断（`supervisor.js:34-41`）+ 可 `require` 复用的类导出（`supervisor.js:56`）。宣称的健康探针（`README.md:17`）代码里不存在。cc-base supervisor.mjs 更全。
- fast-mode.js：on/off/status + TTL 自动过期（`fast-mode.js:9-38`），但无消费者。cc-base 已有同物且接进 hook。
- doctor.sh：查 node/git/主控文件/hooks.json 存在（`doctor.sh:8-38`）后**顺跑 arch scan + dfx validate**（`doctor.sh:40-45`）——「一键体检合并质量扫描」是它比 cc-base doctor 多的一个小编排思路。
- FRAMEWORK-MANIFEST.json：`sha256-lf-v1` LF 归一化哈希 + bytes 字段，覆盖 36 个受管文件（`FRAMEWORK-MANIFEST.json:5-187`）——但没有任何安装器/校验器消费它（setup.sh 不读 manifest）。cc-base 的 FRAMEWORK-MANIFEST 分层升级机制更完整。

### 2.10 MCP 接线
- `mcp_config.json` 把 arch-checker 以 `mcp-server` 模式挂为工作区 MCP server「agy-harness-tools」（`mcp_config.json:2-13`）。实现是假的：该模式只 `console.log('...running...')` 即退出（`arch-checker.js:135-136`）。思路（把 harness 能力暴露为模型可发现的工具）成立，实现为零。

### 2.11 运行态隔离
- `.gitignore` 把 `.agents/harness-state/`、`.agents/logs/`、`.agents/task/`、`.task/` 全部排除（`.gitignore:1-6`），与 cc-base「运行态只进 git 忽略文件」同规。

---

## 3. cc-base 没有的机制/思路——可借鉴项评估

按价值排序。每条给出 Claude Code 原生承载方式判断。

### 3.1 Lockfile 版本锁纪律 ★ 高价值，成本≈0
- **是什么**：「生成/更新 lockfile（package-lock.json / poetry.lock / uv.lock）时，必须提取并使用原 lockfile 头部标注的精确工具版本」，列为八大铁律第 7 条（`AGENTS.md:37`），Reliability 规则重申（`quality-attributes.md:24`），且是三条种子 feedback 之一（FB-003，`feedback/FEEDBACK-INDEX.md:7`）——说明这是家族实践中真踩过的坑（不同 npm/poetry 版本重写 lockfile 会产生巨量无关 diff、破坏 CI 复现）。
- **cc-base 现状**：全库无此规则（唯一相关是 cursor-base 研究报告把 lockfile 列为共享资产单写者，未落地成规则）。
- **CC 原生承载**：纯文本规则即可——implementer agent 定义或 dev-builder/bug-fixer SKILL 加一行铁律；可选配套一条 feedback 条目让 evolution 体系可追溯。不需要任何 hook。

### 3.2 PR 描述 HUMAN/AGENT 分区 ★ 中价值，成本≈0
- **是什么**：branch-finisher 生成 PR 摘要时带「HUMAN/AGENT 分区与测试标记」（`skills/branch-finisher/SKILL.md:10`）——PR 正文显式区分哪些段落是 agent 自动生成（Summary / 测试证据）、哪些留给人类填写（意图 / 风险判断），人类 reviewer 一眼知道该重点核什么。
- **cc-base 现状**：branch-finisher 有提 PR 分支，但无此模板约定（grep 无 HUMAN/AGENT 分区）。
- **CC 原生承载**：branch-finisher SKILL.md 增加一小节 PR body 模板。纯 skill 文本，零运行时。

### 3.3 每轮「状态性」微提醒（PreInvocation 思路的 CC 翻译）☆ 中低价值，可选
- **是什么**：Antigravity 独有 PreInvocation 事件在**每次调模型前**注入 ephemeralMessage（`hooks.json:32-41`、`hook-handlers.js:48-57`），对抗长 session 规则漂移。
- **cc-base 现状**：只有 SessionStart 一次性 banner（session-rules-banner）；UserPromptSubmit 挂了 detect-feedback-signal。
- **CC 原生承载**：CC 没有 PreInvocation，最近似是 **UserPromptSubmit hook 输出 additionalContext**（每用户轮触发）。若采纳，建议翻译成**状态性**内容而非口号：fast-mode 剩余时长 / `.needs-review` 未清个数 / 待确认进化建议数，一行即止，可并入现有 detect-feedback-signal 顺路输出避免新增 hook。**警示**：agy 原版注入的是空泛口号（「Enforce 5-D DFX...」），这种内容每轮烧 token 无增益——CLAUDE.md 本就常驻上下文，重复口号不解决漂移。只有动态状态值得注入。
- 采纳与否建议由 gate-audit 数据说话（cc-base 已有「闸靠数据留」原则）。

### 3.4 运行态 retention 清理（state prune）☆ 低-中价值，可选
- **是什么**：隐私/整洁向的「按保留策略销毁日志与历史证据」入口（`dfx-validator.js:67-75`；叙事 `ARCHITECTURE.md:55`）。agy 实现只是 `rm -rf .task/`，但「运行态有 TTL、可一键清」的思路成立。
- **cc-base 现状**：progress.md 有 100 条自动归档；但 gate log / evidence 日志 / harness 运行态无 retention 机制（grep 仅 fitness 规则文案提到 retention）。
- **CC 原生承载**：scripts 下加 prune 子命令（或 harness.mjs 子命令），按天龄清 `.claude` 运行态目录；不建议挂 hook 自动跑（删除类操作留给用户显式触发，符合 cc-base 安全观）。

### 3.5 doctor 并入只读质量体检 ☆ 低价值，可选
- **是什么**：agy 的 doctor 在完整性检查后顺跑 arch scan + dfx validate（`doctor.sh:40-45`），一条命令出「安装完整 + 架构干净 + 质量态」全景。
- **cc-base 现状**：doctor.sh 查安装完整性；arch-check / verify 单独跑。
- **CC 原生承载**：doctor.sh 尾部在 catalog 存在时顺跑 `harness.mjs arch-check`（只读、不写回执）。纯脚本编排，几行改动。注意保持 codex-base 报告里的教训：结构自检永不写质量 PASS 回执。

---

## 4. 不建议搬的清单（附理由）

1. **整个 Node harness 引擎**（arch-checker / dfx-validator / context-packer / hook-handlers）——演示级 stub：dummy 扫描（`dfx-validator.js:20`）、不落盘的 context pack（`context-packer.js:25`）、恒放行的 Stop 闸（`hook-handlers.js:59-63`）、不比对 baseline 的「棘轮」（`arch-checker.js:114-128` 只写不读）、只查声明不扫真实 import 的架构检查。cc-base harness 每一项都已有真实现且更强，搬 = 倒退。
2. **Antigravity provider 专属形态**——GEMINI.md 文件名、`.agents/` 目录规范、hooks.json schema（命名分组 / `enabled` 字段 / PreInvocation / PostInvocation 事件）、Antigravity 工具名 matcher（`run_command|write_to_file|multi_replace_file_content`）。这些是平台契约不是可移植机制；CC 对应物（CLAUDE.md / .claude/ / settings.json hooks / CC 工具名）cc-base 已用满。唯一价值是当 cc-base 家族未来要出 agy 版时，本仓可当**接口对照表**。
3. **hooks 命名分组 + enabled 开关**——CC settings.json 无此字段；cc-base 已用运行态文件（fast-mode state）+ hook 内自检实现同效开关，且 hook 文件名本就语义化。无增益。
4. **MCP 挂载 harness 工具**（`mcp_config.json:2-13`）——思路可用 CC 原生 `.mcp.json` 承载，但与 cc-base 现有 Bash 直调 harness.mjs 完全重复，还多一个常驻进程维护面；agy 自己的 mcp-server 也是假的。除非未来 harness 要跨仓/跨 agent 复用才值得重估。
5. **PostToolUse 每写即查架构**（`hooks.json:17-31`）——agy 实现为空；即便实现，每次写文件跑全量架构扫描成本高。cc-base 把 arch-check 接在 stop-gate / pre-commit-check 的位置更合理（改动批次边界处校验）。
6. **npm scripts 命令门面**（`package.json:7-15`）——cc-base 是注入式脚手架，往目标项目塞/改 package.json 会与宿主项目冲突。cc-base 的 bash 直调路径更干净。
7. **与 cc-base 已有机制重复的一切**——八大铁律、派单契约/回执信封、扁平编排、写测独立、红转绿、三文件同步、feedback/EVOLUTION 体系、fast-mode、supervisor、FRAMEWORK-MANIFEST、adversarial-review（= cc-base red-blue-review 的缩水版，无 Judge 证据裁定、无四 lens）、verification-matrix（cc-base verify 四态门 + 五性证据门覆盖）、dfxTiers（cc-base 五性 attributes 覆盖且维度更全）。agy-base 是这些机制的**缩水复述**，源头就是 cc-base 家族。
8. **反面教材，不搬且引以为戒**：① hook stdin 坏 JSON fail-open（`hook-handlers.js:13-17`）——cc-base 若有类似解析路径应保持 fail-closed；② 文档宣称与代码脱节（Tarjan 实为 DFS、健康探针不存在、context pack 不落盘、`risk scan` 全仓无实现）——印证 cc-base「验收以客观证据为准」铁律同样适用于评估外部框架；③ 空壳完成闸比没有闸更危险（给人「有 Stop 闸」的错觉）。

---

## 5. 与 cc-base 的关系速记

agy-base 是 SiteMaster 家族向 Antigravity 的**一日速成移植**（2026-08-08 编写、08-09 单 commit），叙事层（八大铁律、派单/回执、5-D DFX、大仓流程链）完整继承家族基因，实现层全面缩水：4 组 hook 里 2 组是空壳、5 个引擎里 3 个是演示 stub、无角色定义文件、无安装器。对 cc-base 的净新增只有三样小东西：**lockfile 版本锁纪律**（唯一建议必采）、**PR HUMAN/AGENT 分区模板**、以及 Antigravity 独有 **PreInvocation 每轮注入**这个事件思路（CC 翻译为 UserPromptSubmit 状态行，采纳与否看数据）。其余机制 cc-base 均已有更完整的实现。本仓的长期价值是 Antigravity 原生接口对照表（`.agents/` 布局、hooks.json schema、GEMINI.md、mcp_config.json），供家族未来出 agy 版时对接。
