# pi-base 深度剖析：为下一代支持 20-30 万行仓库的 harness 提炼实战经验

> 剖析对象：`D:\code\pi-base`（pi-base-scaffold v1.0.0）
> 剖析时间：2026-07-30
> 剖析目的：为"打造下一代支持 20-30 万行代码规模项目的 harness"提炼可借鉴实战经验
> 证据形式：全部用 `file:line` 句柄，不贴大段原文

---

## 1. 定位与运行模型（Pi 是什么 / 怎么跑 / 技术栈 / 架构 / 主控在哪）

**Pi 是什么。** "Pi" = **Pi Coding Agent**（npm 包 `@earendil-works/pi-coding-agent`，版本 0.82.1，需 Node 20+）。它是一个类似 Claude Code / Codex CLI 的终端型 AI 编码 agent，带 TUI，并提供一套**原生扩展 API**：TypeScript 模块通过 `pi.registerTool` / `pi.registerCommand` / `pi.on(事件)` 注册工具、斜杠命令和事件钩子。pi-base 就是构建在这套扩展 API 之上的**项目级 harness 脚手架**（不是新 runtime，不改内核，不承诺 OS sandbox —— `Product-Spec.md:5-7`, `README.md:22`）。

**技术栈。** 纯 TypeScript + Node 20+ 原生能力。扩展直接用 `--experimental-strip-types` 跑 `.ts`，无编译步骤（`package.json:9`）。peer deps 是 Pi 生态四件套 `pi-ai` / `pi-agent-core` / `pi-coding-agent` / `pi-tui` + `typebox`（`package.json:22-28`）。测试用 `node --test`（`package.json:9`）。**零第三方运行时依赖**——无 daemon、无 tmux、无 DB、无向量库、不驱动外部 agent CLI（`Product-Spec.md:30-33, 110`）。

**怎么跑。** 控制面 = **Extensions + Prompt Templates + Themes + fresh `pi` 子进程**。Sub-Agent 通过 spawn `pi --mode json -p --no-session` 全新子进程实现（`Product-Spec.md:129`）。状态存 `.pi/runtime/` 的 JSON/JSONL，原子写，Git+npm 双忽略。

**架构（三层分离，这是全框架的骨架）。**
- **稳定框架层**：`.pi/` 下受 `FRAMEWORK-MANIFEST.json`（LF 规范化 SHA-256 清单）管理的资产 —— APPEND_SYSTEM、harness.json、extensions、agents、skills、prompts、templates、themes。
- **项目事实层**：`Product-Spec.md` / `DEV-PLAN.md` / `progress.md` / ADR / Module Capsule —— 长期产品/架构事实。
- **运行态层**：`.pi/runtime/`（task/evidence ledger、receipt、waiver、lease、fast-mode、install-receipt、命令日志）—— Git 忽略、打包排除。
三层"不得混写"是硬约束（`Product-Spec.md:52-53`，`scripts/pi-base.mjs:17-28` 的 `isStable()` 就是这条线的代码执行）。

**主控 prompt 在哪。** `.pi/APPEND_SYSTEM.md`（相当于 cc-base 的 CLAUDE.md）。这是 SiteMaster 人格（中文 PM/全栈教练，与 cc-base 同源），追加进 Pi 的 system prompt。它只留**路由 + 安全 + 验收铁律**，详细流程下沉到按需加载的 Skill（渐进披露，`APPEND_SYSTEM.md:29-42` 十条核心纪律 / `Product-Spec.md:34-36`）。

---

## 2. 完整机制清单（名称 + 作用 + file:line 证据）

**A. 主控与角色**
- **SiteMaster 主控**（`.pi/APPEND_SYSTEM.md`）：10 条核心纪律——主 Agent 唯一编排、角色隔离、证据优先(DONE≠正确)、写测独立、任务证据绑定、分层质量门等（`APPEND_SYSTEM.md:29-42`）。
- **8 个 fresh 角色**（`.pi/agents/*.md`）：implementer/code-reviewer/tester/deployer/researcher/feedback-observer/evolution-runner/progress-recorder，各带 `mode: read|write|test|deploy`（`harness.json:32-44`；doctor 强制恰好 8 个且 frontmatter 合法 `scripts/pi-base.mjs:289-295`）。
- **14 个渐进 Skill**（`.pi/skills/*/SKILL.md`）：需求/设计/计划/开发/修复/审查/测试/发布/进化/记忆等工作流。

**B. 安全门（`.pi/extensions/safety.ts`）**
- `classifyBashCommand()`：正则分类 DESTRUCTIVE / LOCAL_SIDE_EFFECT / REMOTE_SIDE_EFFECT（`safety.test.ts:22-60` 是行为证据；force-push 归 destructive 不降级 `safety.test.ts:57-59`）。
- 双 Bash 入口：`tool_call`（模型 Bash）+ `user_bash`（用户 `!`/`!!`）都挂钩。
- `approveRisk()`：非 TUI 或 block 级 → 拒绝（**fail-closed**，`harness.json:5` `blockWithoutTui:true`）。
- **路径策略**（`.pi/extensions/harness/path-policy.ts`）：`canonicalizeWritePath()` 先规范化到已存在祖先再判仓库边界（`path-policy.ts:12-50`）；拦截仓库外(`77-84`)、protected 目录(`86-96`)、敏感文件确认(`98-106`)、**未解析 symlink 直接 block**(`108-116`)。

**C. 任务/证据账本（`.pi/extensions/harness/`）**
- `git-state.ts`：`getGitFingerprint()` = HEAD + staged diff + unstaged diff + untracked 路径与内容 的 SHA-256；非 git 降级为工作区身份 hash（直接 spawn git，注释明确警告不要走 pi.exec 以免编码/截断污染 hash）。
- `runtime.ts`：版本化 JSON store（v3），临时文件 + rename 原子写，损坏文件显式报错，`acquireRuntimeFileLock` 文件锁（`ledger.test.ts:104-125` 证明并发更新不丢写）。
- `ledger.ts`：startTask/preflightTaskWrite（同路径外部变化即冲突）/completeTask（**要求 fresh evidence + exit 0 + assertTaskQuality**）；`recordEvidence` 带 `redact()` 密钥脱敏 + 长输出转存证据文件（`ledger.test.ts:141-161` 证明命令/摘要/输出三处都脱敏）。
- `baseline.ts`：**DirtyBaselineV2**——HEAD/index/worktree/untracked 分层路径 hash + 会话前已有脏路径 + owned-path token（`ledger.test.ts:70-86` 证明 legacy v2→v3 迁移不臆造 dirty 数据）。

**D. 大仓库能力（`.pi/extensions/harness/`）** —— 见第 4 节详述
- `repo-map.ts` 有界模块发现；`impact.ts` 变更→最深模块映射 + 扩散策略；`context-pack.ts` 预算化上下文包。

**E. 分层质量门 + 验证回执**
- `gates.ts`：`runQualityGates()` 产出 **PASS/FAIL/BLOCKED/SKIPPED** 四态；DAG 依赖排序 + 环检测；资源锁；win32 用固定 cmd.exe 调用；`readFastMode` 带 TTL；**fast-skip 仅当 allowFastSkip 且 kind≠security**；缺命令=BLOCKED 绝不臆测 PASS（`Product-Spec.md:59`, `harness.json:114` security 为空数组）。
- `quality.ts`：**VerificationReceipt(v2)** + **QualityWaiver(v1)**，`contentHash` 稳定排序 JSON 防篡改；`createQualityWaiver` 对 security checkId **抛错**"cannot be waived"，且要求未来 expiresAt（`quality.test.ts:191-205`）。
- `quality-ledger.ts`：`requiredKindsForRisk`（low/medium/high 分层）+ `assertTaskQuality`（缺 fresh receipt / FAIL / 仅 SKIPPED 无 waiver 均拒绝完成）。
- `harness/index.ts`：9 个 `harness_*` 工具 + 斜杠命令。`harness_gate` 强制链：project trust(`290`) → active task → **gate risk 必须匹配 task risk**(`184,300`) → **运行前锁定 fingerprint**(`185`) → 记录 receipt(`192,306`)。`tool_result` 钩子在有活动 task 时**自动记录 bash 证据**（`index.ts:383`）。

**F. Sub-Agent 编排（`.pi/extensions/subagent/`）**
- `index.ts`：spawn fresh `pi --mode json -p --no-session`；**depth guard**——读 `PI_BASE_AGENT_DEPTH`，≥1 则不注册 subagent 工具（禁递归派发）；MAX_PARALLEL_TASKS=8 / MAX_CONCURRENCY=4；`assertParallelAgentModes` 拒绝 >1 非 read 角色共享工作区；single/parallel/chain 三模式；chain handoff 截断标记；SIGTERM→SIGKILL 超时升级；非 TUI 下项目 agent 需显式 `confirmProjectAgents` 否则抛错。
- `agents.ts`：`discoverAgents`（user/project/both scope），解析 frontmatter（name/description/mode/tools/model）。
- **路径租约**（`.pi/extensions/harness/lease.ts`）：`acquireLease` 带 owner token hash、重叠检测、TTL 自动过期、原子 + 文件锁（`lease.ts:107-133`）——为未来 worktree 并行写预留的协调层。

**G. Session / 恢复 / 工作流**
- `compaction.ts`：`session_before_compact` 定制摘要，固定保留 Goal/约束/task ID/baseline/已读改文件/决策/风险/证据/下一命令，并注入 ledger 上下文（`compaction.ts:4-13, 26-28`）。
- `plan-mode/index.ts`：**branch-safe** Plan Mode——从 `getBranch()` 恢复，`session_tree` 后重建，禁止跨 `/tree` 分支串状态（`plan-mode/index.ts:374-388`）；plan 模式禁写工具 + Bash 白名单。
- `workflow.ts`：`/project-status`（阶段 + ledger + 影响摘要，`workflow.ts:52-94`）、`/fast on|off|status`（0-720h 上限，`workflow.ts:106-119`）、Fast Mode 前置消息注入且明确"安全门仍生效"（`workflow.ts:128-138`）。

**H. 安装 / 自检 / 打包（`scripts/pi-base.mjs`）**
- `install`：LF 规范化 SHA-256 清单比对 → staging/backup → 逆序 rollback → post-hash 校验 → 脱敏 install-receipt；用户定制冲突写 `.pi-base-new`；obsolete 文件仅当仍等旧基线才删（`pi-base.mjs:139-247`）。
- `doctor`：结构/JSON/manifest 漂移/角色/Skill/package 泄漏检查；**执行面漂移(extensions/APPEND_SYSTEM/harness.json)当 error，普通定制当 warning**（`pi-base.mjs:283-284`）→ fail-closed。
- `manifest` / `pack-check`：打包卫生，禁止 runtime/session/evidence/私密 feedback 泄漏（`pi-base.mjs:361-364`）。

**I. 进化引擎（`.pi/EVOLUTION.md`）** 四层：经验积累 → 规则毕业(3+次) → Skill 优化 → Skill 自动生成(5+次)；每条需用户确认（`EVOLUTION.md:7-30`）。

---

## 3. 相对"轻量单机 Claude Code 框架"的独特亮点

cc-base 这类框架把编排纪律**写在 prompt 里靠 Agent 自觉**；pi-base 的根本差异是**把纪律下沉成 TypeScript 代码去强制执行**：

1. **验收从"自述"变"密码学证据"**：VerificationReceipt/Waiver 有 contentHash 防篡改，篡改即 parse 失败（`quality.test.ts:90-103, 176-189`）。cc-base 靠"主 Agent 独立核查三件套"的 prompt 铁律；pi-base 让"DONE≠正确"变成运行时不可绕过的门。
2. **fresh/stale 证据机制**：证据绑 Git fingerprint，代码一变旧证据自动 stale、不能为新代码背书（`ledger.test.ts:127-139`）。这是轻量框架完全没有的时间维度。
3. **安全门是代码 fail-closed，不是提示**：非 TUI 环境危险命令默认阻断（`harness.json:5`），双 Bash 入口全覆盖，symlink/仓库外写死拒。
4. **writer 并发由 runtime 强制**：`assertParallelAgentModes` 直接拒绝两个 writer，而非"提示词提醒不要并行写"（`Product-Spec.md:64-66`）。
5. **depth guard 用环境变量物理阻断递归派发**（`PI_BASE_AGENT_DEPTH`），扁平编排是机制而非约定。
6. **安装/升级是带 rollback 的事务**，manifest 区分原版与定制，升级不覆盖用户改动。
7. **面向大仓的三件套**（repo-map/impact/context-pack）——轻量框架默认全仓丢给 Agent，pi-base 显式做有界导航与预算化上下文。

---

## 4. 大规模（20-30 万行）能力评估（逐项给 file:line 或明确"无"）

**这是 pi-base 最值得看的部分——它是极少数把"大仓"当一等公民设计的脚手架。**

- **上下文/记忆管理：有。** `context-pack.ts` 预算化上下文包（defaultBudgetChars 12000 / maxFileChars 6000 / maxTotalChars 24000，`harness.json:154-158`），按 contract(10)/capsule(20)/test-entry(30)/owned-summary(40) 优先级只读必要内容，contextDenied 目录永不读（`.env` 特判），产出 packHash + included/omitted/degraded。compaction 定制摘要保留执行面关键字段（`compaction.ts:4-13`）。三层文档分离长期记忆（progress/ADR/Capsule）与运行态。

- **任务分解：有（但刻意保守）。** DEV-PLAN 按 Phase→Task 切，任务粒度 30-90min（`LARGE-REPO-GUIDE.md`），六字段派单包（Goal/Scope/Out of Scope/Existing Pattern/Verification/Escalation，`APPEND_SYSTEM.md:64-69`）。单次派单 >60min 视为分解不合理。

- **并行编排：有，但按业界结论收紧到"只读甜区"。** 只读研究可并行（MAX_CONCURRENCY=4）；**共享工作区 writer 默认串行**，多 writer 直接被调度器拒绝（`Product-Spec.md:64-66`）。worktree 独立并行写是 **P2 OPEN 未落地**，首版明确不冒险（`progress.md:40`, `DEV-PLAN.md:339`）。lease.ts 已备好路径租约协调层但尚未接并行 writer。

- **大仓库导航：有。** `repo-map.ts` 有界扫描（maxModules 100 / maxScanEntries 20000 / maxDepth 6 / maxOutputChars 16000，`harness.json:122-127`），模块发现顺序 explicit>workspace(package.json/pnpm/Cargo/go.work)>manifest 语言推断，跳过生成/依赖目录，超限截断带 DEGRADED。`impact.ts` 把 changed paths 映射到**最深匹配模块**，root/shared/unmapped/truncated → `expandAll`（无法判定时安全升级到全模块，不漏测）。`/catalog` 强制每条 tracked/changed path 归类为 fine-module/global/ignored/unmapped，防 root global 掩盖模块缺口。

- **失控防护门：有，多重。** 分层质量门四态 PASS/FAIL/BLOCKED/SKIPPED（缺命令=BLOCKED 不假绿）；风险分层 gate（low=[static,unit] / medium=[+integration,build] / high=[+security,smoke]，`harness.json:117-120`）——**质量成本按风险分层而非按 LOC**，只对受影响模块跑定向门，release/CI 才跑全量（`DEV-PLAN.md:340`）；Completion Gate 要求风险层全部 required gate 有 fresh receipt；red-locks（缺陷先补失败测试再修）。

**大仓短板（诚实标注）：** 自动 repo map 是"有界启发式"，root manifest 可能把变更安全地扩散到全模块，需项目配置优化（`progress.md:45`）；**尚无真实大型 monorepo 上的性能基准与调校**（`progress.md:37,39` P1 OPEN）。即"机制齐备，大规模实测欠缺"。

---

## 5. 成熟度判断（完整产品 / 半成品 / 模板？）

**结论：机制完备、经过自检与首批测试验证的"高完成度脚手架/模板"，但尚未经真实大仓实战检验——介于半成品与产品之间，偏向"可用的 v1 参考实现"。**

支撑证据：
- **正面**：核心机制全部落地并自洽（Phase 1-8 全部实现，`progress.md:16-31`）；21 个 Node 原生回归测试覆盖 safety/path/ledger/receipt/waiver 的关键不变量，且**接入了 unit gate**（`package.json:9`, `harness.json:74-84`）；doctor/pack-check/manifest 自检链完整且对执行面漂移 fail-closed；Windows 兼容已专门处理（cmd.exe 固定调用 `pi-base.mjs:338-343`）。
- **保留**：测试覆盖仍有明显缺口——impact/gate/installer/catalog nested 仍待覆盖（`progress.md:34` P1 PARTIAL）；**真实 Windows TUI/RPC 模式、真实大型 monorepo 调校都是 P1 OPEN 未验证**（`progress.md:38-39`）；worktree 并行写 P2 未做（`progress.md:40`）。feedback 索引为空（`FEEDBACK-INDEX.md:6-7`，尚无真实使用反馈沉淀）。
- 它是**脚手架产品本身**（`pi-base-scaffold`），目标项目的业务 Spec/Plan/质量命令由目标项目维护（`Product-Spec.md:137`）——所以"成熟度"要分两层看：脚手架框架本体成熟度高，作为大仓 harness 的实战成熟度未验证。

---

## 6. 血泪教训（来自 progress.md / feedback / 跨基座审计）

pi-base 是**站在 cc-base/codex-base/grok-base/cursor-base 四套前作的尸体上**造的（`README.md:3`, `progress.md:20,27`），`docs/CROSS-POLLINATION.md` 专门审计前作失败模式。提炼出的血泪教训：

1. **"有一条成功 Bash"≠任务完成**——升级为"风险层全部 required gate 有 fresh receipt"（吸收自 Cursor Base 的 receipt/waiver，`progress.md:28`, `DEV-PLAN.md:288`）。这是对"假证明/full validate 假绿"的直接反制（`progress.md:27` 识别出 Cursor Base 的"full validate 假证明"）。
2. **旧证据为新代码背书是隐形杀手**——所以证据/receipt 全部绑 fingerprint，代码一变即 stale。
3. **安全正则会被绕过**——审计 Cursor Base 发现"安全正则绕过"（`progress.md:27`），故 pi-base 双 Bash 入口全覆盖、force-push 不降级、路径规范化到祖先再判定。
4. **runtime 会变成秘密仓库**——evidence 长日志必须脱敏（`redact()`）+ 转存，`ledger.test.ts:141-161` 锁死这条。
5. **compaction API 不能想当然**——Pi 0.82.1 的 `session_before_compact` 不能只返回 customInstructions，必须调官方 `compact()`，升级需重新核验（`progress.md:44`, `DEV-PLAN.md:217`）。这正是 CLAUDE.md "查证后再结论"铁律的实证。
6. **Windows 进程/spawn 语义是反复踩的坑**——Node 拒绝直接 spawn npm.cmd(EINVAL)，必须固定 cmd.exe 字面命令（`pi-base.mjs:338`）；SIGTERM/SIGKILL 跨平台语义不同必须显式清理 child（`DEV-PLAN.md:338`）。
7. **自动模块发现会误判**——显式配置优先，无法映射时升级到 root/shared 风险而非静默漏测（`DEV-PLAN.md:341`）。
8. **脚手架自我升级会与用户定制冲突**——安装器只更新仍等旧基线的文件，定制写 `.pi-base-new`，事务 rollback（`DEV-PLAN.md:342`）。
9. **扩展不是 sandbox**——Extensions 拥有用户权限，恶意仓库/无人值守必须外部隔离（`progress.md:46`, `README.md:22`），文档绝不夸大权限边界。

---

## 7. 反模式 / 弱点（过度设计、脆弱、不要照抄的部分）

1. **机制密度对轻量项目是过度设计。** receipt+waiver+DirtyBaselineV2+lease+catalog coverage 这套对 20-30 万行仓库是投资，对几千行项目是纯负担。下一代 harness 应让这套**按仓库规模/风险分层渐进开启**，而非默认全开。
2. **大量机制"实现了但没被真实负载验证"。** worktree 并行(P2 未做)、大 monorepo 调校、Windows TUI/RPC 全是 OPEN——**lease.ts 是典型的"为未落地的并行写预建的协调层"**，属于超前抽象，照抄有 YAGNI 风险。
3. **repo-map 是启发式，脆弱点集中在此。** root manifest 变更→全模块扩散是已知假阳性放大器；maxScanEntries/maxDepth 的硬上限在超大仓可能过早截断（`harness.json:122-127`），需谨慎调参而非照搬默认值。
4. **测试覆盖与机制复杂度不匹配。** 21 个测试主要覆盖 safety/ledger/quality 的纯函数不变量，而最容易出错的 impact/gate/installer/catalog 交互路径仍未覆盖（`progress.md:34`）——照抄机制时不要连"测试已足够"的错觉一起抄。
5. **`node --experimental-strip-types` 直接跑 .ts 是版本敏感的赌注。** 无编译步骤省事，但绑死 Node 版本行为，Node 升级可能破坏；生产级 harness 可能需要真正的构建产物。
6. **进化引擎 + feedback 目前是空转的架子。** `FEEDBACK-INDEX.md` 为空、四层进化路径无任何实际毕业记录——这套元框架在没有真实使用数据前是**成本无产出**（正是 cc-base `gates-need-empirical-validation` 反模式的镜像）。
7. **单机语义的历史包袱。** CLAUDE.md 全局指令里的 Java 8 / 飞书 / n8n / pgvector 坑与 pi-base 无关——说明这些"base"框架共享一套人格但混入了大量宿主特定内容，跨栈复制时要清洗（`DEV-PLAN.md:270-274` P6-T3 就是在清洗 Codex/Claude/Grok 专用工具名）。

---

## 8. 最值得借鉴的 Top 5（排序，每条 why + how to port）

**#1 — Fingerprint 绑定的 fresh/stale 证据账本 + 防篡改 Verification Receipt。**
- **why**：这是对"AI 自报完成"最根本的反制，把"DONE≠正确"从 prompt 铁律变成运行时不可绕过的门；20-30 万行仓库里旧证据背书新代码是最隐蔽的质量事故。
- **how to port**：移植 `git-state.ts`（HEAD+staged+unstaged+untracked 的 SHA-256）+ `quality.ts`（contentHash 稳定 JSON）+ `quality-ledger.ts`（assertTaskQuality）。cc-base 当前靠"主 Agent 独立核查三件套"的 prompt——可保留 prompt 层，追加一个 `.claude/` 下的证据账本让 marker 变成 fingerprinted receipt。security check 不可豁免这条直接抄（`quality.ts` THROW）。

**#2 — 大仓三件套：有界 repo-map + 最深模块 impact + 预算化 context-pack。**
- **why**：这是"支持 20-30 万行"的核心答案——不让 Agent 全仓扫描，而是"定位受影响模块→只加载该模块 capsule+契约+调用方+相关测试+当前 diff"（`README.md:88`）。
- **how to port**：三个文件相对独立可整体移植（`repo-map.ts`/`impact.ts`/`context-pack.ts`）。关键是把 `harness.json` 的 `modules`/`repoMap`/`contextPack` 配置段一起搬——**显式配置优先于自动发现**是防误判的命门。impact 的"无法判定→安全升级到全模块"策略是防漏测的正确 default。

**#3 — 分层质量门四态（PASS/FAIL/BLOCKED/SKIPPED）+ 风险分层成本控制。**
- **why**：解决大仓"质量成本爆炸"——成本按**风险层**（low/medium/high）而非按 LOC，只跑受影响模块的定向门，release/CI 才全量。四态区分让"缺命令"不再伪装成"通过"（假绿是最贵的 bug）。
- **how to port**：移植 `gates.ts` 的四态语义 + `qualityGateRisks` 配置映射。cc-base 已有 red-locks/static-check，可把"命令缺失=BLOCKED 不假绿"和"Fast Mode SKIPPED 必须可见且 security 不跳过"两条语义补进现有 gate。

**#4 — 三层严格分离（框架 manifest / 项目事实 / 运行态）+ 事务化安装升级。**
- **why**：脚手架要"复制到多个仓库还能安全升级"，就必须把稳定框架、项目绑定、运行态物理隔离；manifest 让升级能区分原版与用户定制、不覆盖改动。这直接对应 cc-base "三层不得混写"铁律，但 pi-base 把它做成了**代码执行的 isStable() + 事务 rollback**。
- **how to port**：移植 `scripts/pi-base.mjs` 的 manifest/install/doctor/pack-check（LF 规范化 SHA-256、staging+逆序 rollback、`.pi-base-new` 冲突旁路、执行面漂移 fail-closed）。这套对任何需要分发的 harness 都通用。

**#5 — 机制化的扁平编排：env-var depth guard + runtime 强制的 writer 串行 + fresh 子进程隔离。**
- **why**：cc-base 的"主 Agent 唯一编排/写测独立/编码默认串行"全靠 prompt；pi-base 用 `PI_BASE_AGENT_DEPTH` 物理阻断递归、用 `assertParallelAgentModes` 直接拒绝多 writer，把纪律从"自觉"变"机制"。并行只在只读甜区放开，与 Anthropic/Cognition 的"编码不该并行"实证一致。
- **how to port**：概念可移植到 Claude Code 的 Task/Agent——在派发层加"深度计数环境变量 + 拒绝多 writer 并行"的守卫脚本。**但注意**：lease.ts 那套 worktree 并行协调层是超前抽象（P2 未落地），移植时先做守卫、暂缓租约层，避免 YAGNI。

---

*（本分析全部基于只读审计，未修改 pi-base 任何文件。证据句柄均为 `D:\code\pi-base` 下相对路径 file:line。）*
