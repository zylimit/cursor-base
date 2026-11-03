# opencode-base 深度架构分析

> 分析对象：`~/code/opencode-base`（SST OpenCode CLI 的产品开发框架脚手架，v1.1.0，commit d49f8bb 2026-08-07「harness v2 大仓治理全量落地」）
> 分析目的：为 cc-base（纯 Claude Code 框架脚手架 v1.10.0）提炼可借鉴的扩展能力——**只报差异，不报同构**
> 分析日期：2026-08-16 ｜ 分析者：只读研究 Sub-Agent
> 对标基线：cc-base v1.10.0（17 skills / 7 agents / 14 hooks×双写 / harness v2 十五子命令 / supervisor / setup+FRAMEWORK-MANIFEST）

---

## 0. 结论速览

opencode-base 是 cc-base 的 OpenCode 移植姊妹仓（2026-06-16 吸收 cc-base，2026-08-07 又整体移植 cc-base harness v2）。**harness v2 引擎层是逐字节机械移植、零功能补强**（见 §4），它的独有价值集中在三处：
1. **OpenCode 原生配置面的用法示范**——原生 command 注册表、per-agent 声明式权限、instructions 外置——其中两项在 Claude Code 有更原生的对应物（`.claude/commands/`、agents frontmatter `tools:`）而 cc-base 至今没用；
2. **两轮外部借鉴沉淀**（v1.0.7 OpenHands、v1.0.8 Superpowers）——TDD-for-Skills、Model Selection 分档、BLOCKED 升级阶梯、lockfile 纪律、PR HUMAN/AGENT 分区、.task/ 规范、brainstorming 闸——这批 cc-base 从未回收；
3. **对抗审查的另一种取舍**——红蓝对抗下沉到 per-Task 高风险改动（cc-base 是发版/合并级）、蓝队做防守方对称审理 false positive（cc-base 的 Blue 只是自证靶子）、攻击面扩到 Spec/Plan 文档。

同时它有 6 处死接线/半成品（§7），照抄会把坑一起搬回来。

---

## 1. 定位与运行时（任务 1：OpenCode 原生机制及其用法）

**目标 agent**：SST OpenCode CLI（Linux 实测 v1.16.2，`progress.md:19`）。交付面 = 根 `AGENTS.md`（主控，47KB）+ `opencode.json`（原生配置）+ `.opencode/`（agents/skills/plugins/hooks/rules/harness/scripts/tests/feedback）。无 daemon / 无 tmux / 无外部多模型（`ARCHITECTURE.md:9`）。

### 1.1 OpenCode 原生机制清单与 opencode-base 的用法

| OpenCode 原生机制 | opencode-base 用法 | Claude Code 对应物 |
|---|---|---|
| **plugin 体系**（`@opencode-ai/plugin`，JS，事件 `tool.execute.before/after`、`event(session.created/session.idle)`、`chat.message`；能力：throw 硬拦、`client.tui.showToast`、`client.session.prompt` 注入消息） | 单文件 `plugins/workflow-gates.js` 做「事件路由 + 取参 + 退出码翻译」，shell 逻辑留在 `.opencode/hooks/*.sh` 复用（`workflow-gates.js:1-31`）。hook 协议从 Claude 的 stdin JSON+`{decision:block}` 改为 argv+退出码（10=拦停/2=阻断，`CROSS-POLLINATION.md:46`） | hooks 事件体系（更强：Stop 可 `decision:"block"` 静默阻断、UserPromptSubmit 可注入 additionalContext——OpenCode 两者都做不到，见下） |
| **`permission`（工具权限全局配置）** | 顶层 `"permission": "allow"` 永不询问，只放行工具权限、不压制 agent 决策提问（`opencode.json:3`、`progress.md:9,12`） | `settings.json` permissions——cc-base 已用 `defaultMode: bypassPermissions`（`settings.json:2-4`），同构 |
| **`instructions` 数组（外置指令文件）** | 框架规则装到目标项目 `.opencode/AGENTS.md`、经 instructions 加载，**不占用/不覆盖用户自己的根 AGENTS.md**（`opencode.json:4`、`setup.sh:142-143`） | CLAUDE.md `@path` import。cc-base setup 直接写 `.claude/CLAUDE.md`，Claude Code 对 `.claude/CLAUDE.md` 与用户根 CLAUDE.md 天然分层，无此痛点 |
| **`command` 注册表（原生自定义命令：template + `$ARGUMENTS` + description + 可绑定 agent）** | 注册 6 条：`/review`（绑 code-reviewer）、`/verify`、`/evolve`（绑 evolution-runner）、`/record`（绑 progress-recorder）、`/arch-check`、`/impact`（带「先读 rules 再跑 harness 再解读」前导，`opencode.json:38-66`）；setup 给目标项目也生成这 6 条（`setup.sh:89-117`） | **`.claude/commands/*.md` 自定义 slash command（支持 $ARGUMENTS、frontmatter、`!` 预执行）——cc-base 完全没用**，`/record` `/recap` 等全靠 CLAUDE.md 文本约定（cc-base 无 commands 目录，实查确认） |
| **`agent` 注册表（声明式 subagent + per-agent permission + mode/color）** | 7 个 subagent 全部声明 per-agent 工具权限：code-reviewer `edit:deny`、evolution-runner `edit:deny`、feedback-observer/progress-recorder `bash:deny`（`opencode.json:81-146`） | agents frontmatter `tools:` 白名单——**cc-base 的 7 个 agent 只有 name/description/skills/model/color，没限工具**（`agents/implementer.md:1-7` 实查），审查者可写、记录员可跑 bash |
| **agent .md frontmatter `temperature` / `steps`** | implementer temperature 0.3 / steps 50，code-reviewer temperature 0.1 / steps 30（`agents/implementer.md:4-5`、`agents/code-reviewer.md:4-5`） | Claude Code agent frontmatter 不支持 temperature/steps，无法搬 |
| **`compaction`（auto/prune/tail_turns）、`tool_output`（max_lines/max_bytes）、`watcher.ignore`** | 自动压缩保尾 3 轮、工具输出截断 1000 行/32KB、watcher 忽略全部运行态标记与 harness 运行态（`opencode.json:9-35`） | Claude Code auto-compact 内建不可配、无工具输出上限配置面；无需模拟 |
| **skill frontmatter 硬要求（name 必须=目录名，否则拒载）+ `triggers` 字段** | doctor.sh 逐 skill 校验 name=目录名（`doctor.sh:59-74`）；skills 带 triggers 触发词表（`brainstorming/SKILL.md:7-15`） | Claude Code skill name 缺省即目录名，无此风险；触发靠 description CSO（cc-base 已有 skill-description-lint） |
| **已知缺口（反向差距）** | `session.idle` 是事件通知、**无法阻断停止**（社区 FR anomalyco/opencode#16626 未实现），stop-gate 被迫拆成「git commit 时 throw 硬拦 + idle 时 `client.session.prompt` 注入续命（封顶 3 次防循环、可见非静默）」（`workflow-gates.js:20-31,42-43,196-217`）；`chat.message` **无法注入 additionalContext**，detect-feedback 只能 toast，靠 AGENTS.md 文本规则兜底（`ARCHITECTURE.md:148-151`、`AGENTS.md:92`） | Claude Code 的 Stop `decision:block` 与 UserPromptSubmit additionalContext 天然更强——cc-base 现状即是 opencode-base 想要而不得的形态，**此方向零可借鉴** |

### 1.2 平台适配之外的结构差异

- **杂项 hooks 归并**：cc-base 的 kill-dev-ports 被内联进 plugin（`workflow-gates.js:102-110`）、subagent-acceptance-reminder 内联为 PostToolUse(Task) toast（`workflow-gates.js:169-179`）。形态差异，无借鉴价值。
- **无 .ps1 双写**：plugin 走 JS、hooks 统一 bash，Windows 靠 Git Bash（`CAPABILITY-MATRIX.md:48`）。cc-base 双写是 Claude Code Windows 原生 PowerShell 场景决定的，不可比。
- **防黑屏 vendored stub**：`node_modules/@opencode-ai/plugin/package.json` stub + lock stub 跳过 OpenCode 启动器强制联网装 57MB SDK 的两道闸（`progress.md:28`、`doctor.sh:98-102`）。OpenCode 专属启动器 bug 的补丁，CC 无此问题。

---

## 2. opencode-base 独有机制清单（任务 2，附证据）

### 2.1 原生 command 快捷入口（cc-base 缺对应形态）

6 条命令模板不是简单别名——`/arch-check`、`/impact` 内置「**先读 `.opencode/rules/harness-large-repo.md` → 跑 harness 子命令 → 按固定框架解读输出（越禁边/虚边/环逐条列、rc=3 时解释启用方法）**」的三段式前导（`opencode.json:58-65`），把「命中指针必须先读规则」从自觉变成命令模板自带；`/review`、`/evolve`、`/record` 直接绑定对应 subagent（`opencode.json:39-57`）。harness 接线决策明确记录「不新增 plugin 事件，只走既有事件 + 原生 command」（`progress.md:15-16`）。

### 2.2 per-agent 声明式权限（cc-base 缺）

审查者不能改代码（`edit:deny`，`opencode.json:87`）、反馈/记忆记录员不能跑命令（`bash:deny`，`opencode.json:124,144`）、进化扫描器只读（`edit:deny`，`opencode.json:133`）——把「只读角色」从 prompt 描述升级为配置强制。cc-base agents 无 `tools:` 限制，全部默认继承全工具。

### 2.3 独有 hooks（3 个）

- **test-guard.sh（发布构建后测试闸）**：PostToolUse 检测 `npm/pnpm/yarn build|release|deploy|package` 命令后，自动探测测试基建（package.json scripts / pytest）并真跑，失败 exit 10 → toast 告警（`test-guard.sh:12-48`、`workflow-gates.js:151-157`）。把 cc-base release-builder 的 prompt 级测试卡点补了一道机械触发。
- **file-conflict.sh（commit 时并行冲突检测）**：git commit 前查 `diff --diff-filter=U` 未合并文件，命中 exit 10 硬拦 commit 并记录冲突历史（`file-conflict.sh:12-23`、`workflow-gates.js:130-134`）。注意其第二段启发式是半成品（见 §7.3）。
- **session-journal.sh（会话台账）**：session.created 时写 `feedback/journal/session-<ts>.json`（时间戳/sessionId/Spec-Plan-代码存在性/待审状态，`session-journal.sh:16-27`）。**无消费方**（见 §7.2）。

### 2.4 独有 skills（3 个）与审查体系差异

- **brainstorming（设计先行硬闸）**：`<HARD-GATE>` 设计未获批不得调任何实现 skill/写任何代码；「**"太简单不需要设计"是反模式**——待办列表、单函数工具、配置修改全部走流程，设计可短不可跳」（`brainstorming/SKILL.md:22-28`）；8 步 checklist：探索上下文→逐一提问（一次一个）→2-3 方案带推荐→分段呈现设计→写 spec 到 `.task/`→placeholder/矛盾/歧义自审→用户审书面 spec→转实现（`SKILL.md:30-41,76-93`）。主控里挂成总体规则（`AGENTS.md:106`）。
- **using-git-worktrees（worktree 操作 skill）**：Step0 检测现有隔离 + **submodule 误判守卫**（`git rev-parse --show-superproject-working-tree`，`SKILL.md:30-37`）、原生工具优先、项目本地 worktree 必须 `git check-ignore` 验证被忽略否则先补 .gitignore（`SKILL.md:76-86`）、**创建后先跑测试验证干净基线，失败先报告再继续**（`SKILL.md:118-134`）。cc-base 已把前三点吸进 `rules/workflow-orchestration.md:12`，**缺的只有「干净基线测试」一步**。
- **adversarial-review + code-review 内嵌红蓝循环**：与 cc-base red-blue-review 同源但四点取舍不同——
  ① **触发层级下沉**：高风险改动（架构/安全/核心逻辑重写/跨 3+ 文件接口/性能关键路径）在 **per-Task 开发循环内**必走红蓝，不是等发版（`code-review/SKILL.md:67-75`；cc-base red-blue-review 触发是「发版/合并分支前」）；
  ② **蓝队=防守方**：顺序为红攻→蓝防→裁判，蓝队职责是「承认命中 + **用证据反驳误判** + 补充红队不知道的设计决策 + 提替代方案」（`adversarial-review/SKILL.md:87-112`）——对称审理压 false positive；cc-base 的 Blue 是先行自证、只作靶子；
  ③ **攻击面扩到文档**：红队维度含 **Spec 攻击**（可测试性/歧义/成功标准可量化/遗漏约束/范围合理性）与 **Plan 攻击**（依赖顺序/遗漏模块/选型缺陷/测试策略覆盖）（`adversarial-review/SKILL.md:50-62`）；cc-base 红队四 lens 只打代码与发布工程；
  ④ **封顶 2 轮 + 人担责放过**：第 3 次只记残留 deferred（`code-review/SKILL.md:111,126`）；输出模板带 Taste Rating 🟢🟡🔴 + Linus 三问（真问题?更简方案?破坏什么?）（`code-review/SKILL.md:130-141`）；红/蓝/裁判三份 prompt 模板文件化可复用（`code-review/prompts/red-team-prompt.md` 等）。

### 2.5 主控独有纪律（AGENTS.md，cc-base CLAUDE.md 无对应）

- **[快速上手] 3 行导航**置顶（`AGENTS.md:1-5`）。
- **Model Selection 策略**：机械实现（隔离函数/清晰 spec/1-2 文件）→快速便宜模型；集成与调试→标准模型；架构/设计/审查→最强模型；附任务复杂度信号判据（`AGENTS.md:253-260`）。
- **Implementer Status 处理手册**：四态各配处置——DONE_WITH_CONCERNS 分「正确性先解决 vs 观察性备注记下继续」；**BLOCKED 四路升级阶梯**（补上下文同模型重派 / 需更多推理换强模型 / 任务太大拆小 / plan 有误上报人类），并钉死「**永远不要忽略升级或强制同模型重试无变化**——implementer 说卡住了，就必须有东西改变」（`AGENTS.md:262-266`）。cc-base 只有四态定义 + 一句「据此前置决策」。
- **派单提示词纪律**：完成条件必须写成 subagent 输出里**能自证**的形式（贴命令输出/列产出物/逐项打勾），验收人只判已 surfaced 的内容；边界只写真实约束、禁「保持兼容性」空话；不带信息的段不写（`AGENTS.md:251`）。
- **Verification Before Completion 禁止词表**：「应该能过/大概没问题/看起来正确/Great!/Perfect!/Done!」+ IDENTIFY→RUN→READ→VERIFY→THEN claim 五步（`AGENTS.md:102`、`feedback/verification-before-completion.md`）。与 cc-base 五步闸同源，**禁止词表**是它多出的表述。
- **环境变量布尔双格式容错**：门控布尔必须同时接受 `'true'` 和 `'1'`（Helm 默认 `'1'`，只接受一种会静默禁用功能）（`AGENTS.md:99`）。
- **路由显示加「大仓治理：已启用/未启用」行**（`AGENTS.md:291`）。

### 2.6 独有 feedback 条目（4 条，cc-base feedback 库无）

- **lockfile-version-discipline**：再生 lockfile 必须先从 lockfile 头部提取原工具版本、装该精确版本再 lock（poetry/uv/npm 各给命令），避免工具版本迁移的 diff 噪声（`feedback/lockfile-version-discipline.md:17-61`）。
- **pr-commit-template（HUMAN/AGENT 分区 + 环境披露）**：PR 必含 HUMAN 段（人类自述）+ 人类已测试 checkbox + **环境披露表**（模型+版本 / harness+版本 / 插件 / 审查此 diff 的人类），「隐藏 authoring 环境是关闭 PR 的理由」；commit 带 `[HUMAN-TESTED]` 标记（`feedback/pr-commit-template.md:9-50,66-74`）。
- **task-dir-spec（.task/ 临时目录）**：session 临时产物（设计草稿/分析脚本/调试日志）进 `.task/`，任务完成即清理；与长期 feedback 职责分离；session 结束存在即提醒清理（`feedback/task-dir-spec.md:9-49`）。与 cc-base「记结论不记过程」互补——过程性草稿有了去处。
- **agent-memory-spec（repo.md 项目知识库）**：OpenHands microagents 私搬，含「先征求用户确认再写入」的写入规则（`feedback/agent-memory-spec.md:29-35`）。**但在 OpenCode 里是死文件**（见 §7.4），仅写入纪律可参考。

### 2.7 skill 内容差异

- **skill-builder 的 TDD-for-Skills**：写技能=对过程文档做 TDD——RED（不写 skill 先派 subagent 跑压力场景、**记录 agent 违规用的确切借口**）→ GREEN（写最小 skill 只针对记录到的违规）→ REFACTOR（重派验证、发现新借口→堵→再验），含 TDD 概念逐项映射表与适用/不适用边界（`skill-builder/SKILL.md:33-63`）。cc-base skill-builder 无此方法论（实查无 TDD 字样）——而这正是 cc-base「red-locks-the-bug」哲学在 skill 域的镜像。
- **product-spec-builder references/ 渐进披露**：`references/interview-principles.md`（追问到底/给方案不等开口/记录约束/访谈四轮节奏/常见陷阱）+ `references/question-bank.md` 问题库。cc-base 的 product-spec-builder 只有 SKILL.md + templates，无 references 层。

---

## 3. harness v2 落地对比（任务 2 重点：它有没有自己的变化）

**结论：引擎层零补强，接线层三点自有取舍，另有移植不完整的残留（§7）。**

- **引擎逐字节一致**：`harness.mjs` 两边均 3033 行，把 `.opencode→.claude`、`OPENCODE_PROJECT_DIR→CLAUDE_PROJECT_DIR` 归一化后 **diff 为空**；`adapters.json`、`supervisor.mjs` 同样零差异；selftest 同为 101 例、`test-harness.sh` 同为 72 例（1213 vs 1212 行，纯路径改名）。它自己的文档也如实承认「机械替换零 claude 残留」（`progress.md:36`）。
- **接线自有取舍 ①——不新增事件面**：pre-commit-check 接 verify（rc=2 throw 拦 commit）、stop-gate 接 receipt verify（rc=4 commit 硬拦 + idle 续命），全走 workflow-gates 既有事件（`progress.md:15`、`stop-gate.sh:22-40`）。与 cc-base 语义等价，是降级适配不是补强。
- **接线自有取舍 ②——/arch-check /impact 注册为原生 command**（`progress.md:16`、`opencode.json:58-65`）：cc-base 没有等价物，这是唯一「harness 入口体验」上的真增量。
- **接线自有取舍 ③——catalog/fitness-rules 不从 base 播种**：setup 显式跳过 module-catalog.json / fitness-rules.json / receipts / waivers / trend / .runtime，「大仓治理由目标项目自行启用（唯一开关铁律）」（`setup.sh:56-58`、`progress.md:17`）。cc-base 的 base 仓本就不含 catalog（等价行为），但 opencode-base 把它写成 setup 的显式排除清单 + 决策记录，形式更防呆。
- **反向差距**：cc-base 的 EVOLUTION.md 多「同族失败模式跨文件聚类计数毕业」条款（`cc-base/.claude/EVOLUTION.md:15`，opencode 版无）；cc-base make-release.sh 多 Windows 路径处理 + **打包后泄漏扫描**（opencode 版无）；cc-base 有 FRAMEWORK-MANIFEST 分层升级、gate-audit、plan-lint、hook-parity 测试、workflows fan-out 脚本（opencode 明确记「等 fan-out 需求真出现再做」，`progress.md:48`）。opencode-base 整体落后 cc-base 一个身位。

---

## 4. 差异条目的 Claude Code 原生承载评估（任务 3）

原则：全部走 CC 原生（hooks / skills / sub-agents / settings.json permissions / slash commands / CLAUDE.md / agents frontmatter），不引 Cursor 化、不引 CCB 复杂度。

| # | 机制 | CC 原生承载 | 价值 | 成本 |
|---|------|------------|------|------|
| 1 | 原生 command 注册表（含「先读规则→跑 harness→解读」前导模板） | **`.claude/commands/*.md` 自定义 slash command**：`/impact`、`/arch-check`、`/verify`、`/review` 各一个 md，正文即 opencode 的 template（支持 `$ARGUMENTS`；可用 `!`&#96;node .claude/harness/harness.mjs impact $ARGUMENTS&#96; 预执行注入输出）。cc-base 目前零使用，纯增量 | 高 | 低（每条 ≤15 行 md） |
| 2 | per-agent 声明式权限 | **agents frontmatter `tools:` 白名单**：code-reviewer 去掉 Edit/Write、feedback-observer/progress-recorder 去掉 Bash、evolution-runner 只读。配置强制替代 prompt 约束 | 高 | 极低（7 个 md 各加一行） |
| 3 | skill-builder TDD-for-Skills | **skill-builder SKILL.md 加段** + 用 Task 派 fresh sub-agent 跑 RED 基线压力场景、记录借口后再写 skill；与既有 skill-description-lint、「劝服工程」feedback 直接衔接 | 高 | 低（纯文档） |
| 4 | Model Selection 按复杂度分档 | **agents frontmatter `model:`（haiku/sonnet/opus/inherit）+ CLAUDE.md 派单判据三行**。cc-base 现在 implementer 固定 opus，机械小任务纯浪费 | 中高 | 低 |
| 5 | Implementer BLOCKED 升级阶梯 | **CLAUDE.md [Sub-Agent 调度规则] 补一段**（四路阶梯 + 禁同模型无变化重试）；与 model 分档联动（换强模型重派） | 中高 | 极低 |
| 6 | 红蓝对抗三点差分（per-Task 高风险下沉 / 蓝队防守方 / Spec-Plan 文档攻击） | **改造现有 red-blue-review skill**：触发条件加「高风险改动在 dev 循环内即走」；Red 报告后加 Blue 防守轮（implementer fresh 实例反驳误判）；四 lens 外加 spec/plan lens。不新增 skill，防双份漂移 | 中高 | 中 |
| 7 | 发布构建后测试闸 test-guard | **PostToolUse hook（matcher Bash）**识别 build/release 命令→跑测试→输出进 additionalContext（CC 比 opencode 的 toast 更强，能直接进模型上下文）。或并入 release-builder skill 前置卡点的机械化版本 | 中 | 低 |
| 8 | lockfile 版本锁定纪律 | **feedback 条目 + dev-builder/bug-fixer skill 各一行**（再生 lockfile 前先提头部版本） | 中 | 极低 |
| 9 | PR/Commit HUMAN/AGENT 分区 + 环境披露 | **release-builder / branch-finisher skill 模板段**；可选 PreToolUse(git commit) 检查 HUMAN 段非空。单人自用价值有限，开源/协作项目价值高——建议做成模板可选项 | 中（场景依赖） | 低 |
| 10 | .task/ 临时目录规范 | **CLAUDE.md 规则一条 + .gitignore 排除 + stop-gate 顺带提醒清理**。与「记结论不记过程」互补 | 中 | 低 |
| 11 | brainstorming 设计先行硬闸 | **不新增 skill**（与 product-spec-builder 迭代模式 + Spec 签字闸 + Plan Mode 高度重叠）；只吸收其**反模式条款**——把「太简单不需要设计=反模式，小改动也要 2-3 方案过一遍」并进 product-spec-builder 或 CLAUDE.md 逃逸借口拦截清单 | 中 | 极低 |
| 12 | commit 时 unmerged 文件检测 | **pre-commit-check.sh 加 4 行**（`git diff --diff-filter=U` 非空即 rc=2 阻断）。只搬 unmerged 检查，不搬其启发式段（§7.3） | 低中 | 极低 |
| 13 | worktree 干净基线测试 | **rules/workflow-orchestration.md worktree 纪律补第 ④ 条**：建完 worktree 先跑测试验基线，失败先报告 | 低中 | 极低 |
| 14 | product-spec-builder references/ 渐进披露 | **skills 子目录 references/**（CC skills 原生支持附属文件按需读取） | 低中 | 低 |
| 15 | 环境变量布尔双格式容错 | dev-builder skill 编码规则一行 | 低 | 极低 |
| 16 | [快速上手] 3 行导航 / 路由加大仓状态行 | CLAUDE.md 文本 | 低 | 极低 |
| 17 | Verification 禁止词表 | CLAUDE.md 五步闸处补一行禁止词 | 低（已有同源闸） | 极低 |

---

## 5. 不建议搬的清单（任务 4）

1. **plugin 桥 / session.prompt 续命 / toast 三件套**（`workflow-gates.js` 整体形态）——这是 OpenCode 缺 Stop block、缺 additionalContext 注入的**降级适配**。Claude Code 原生 Stop `decision:block` 静默硬闸 + UserPromptSubmit 注入全面更强，cc-base 现状即优于其目标态（`workflow-gates.js:20-31`、`ARCHITECTURE.md:148-151` 自认「残留近似」）。
2. **vendored stub + lock 防黑屏**（`doctor.sh:98-102`、`progress.md:28`）——OpenCode 启动器强制联网装 SDK 的平台 bug 补丁，Claude Code 无此问题，搬=货物崇拜。
3. **microagents/repo.md 项目知识库**（`agent-memory-spec.md:77-80`）——与 CLAUDE.md memory 功能完全重复；且它声称「文件存在时自动加载」，实际 OpenCode 无 microagents 机制、该文件无任何加载引用（§7.4）。cc-base 已有 CLAUDE.md + progress.md 双层，再加一层=三真相源必漂移。唯一可取的是其「写入前列条目征求用户确认」纪律，可并进 progress-recorder 已有规则。
4. **opencode.json compaction / tool_output / watcher 配置面**——Claude Code 无对应可配面（auto-compact 内建；工具输出上限不可配），模拟无意义。cc-base 的回传纪律（结论+证据句柄）已从 prompt 层解决同一问题。
5. **per-agent temperature/steps**（`agents/implementer.md:4-5`）——CC agent frontmatter 不支持；其意图（审查更冷、步数封顶）由 model 分档 + 任务时长红线覆盖。
6. **session-journal hook**——写了没人读（§7.2）。cc-base 已有 session-rules-banner + lib-gate-log 拦截台账 + gate-audit 消费链，闭环比它完整。若要会话台账，先定义消费方再落 hook（「闸靠数据留」原则反对无消费的数据收集）。
7. **adversarial-review 独立 skill 与 code-review 内嵌红蓝并存的形态**——同一机制三处定义（adversarial-review/SKILL.md + code-review/SKILL.md 红蓝循环 + prompts/ 三文件），已现措辞漂移（适用范围两处清单不一致）。cc-base 保持 red-blue-review 单点定义，只吸收差分（§4#6）。
8. **skill frontmatter triggers/type/version/compatibility 字段**——OpenCode 加载器专属，CC 靠 description CSO 触发，搬入即死字段。
9. **file-conflict.sh 的「5 分钟内 >5 个 .needs-review-* 标记」启发式**（`file-conflict.sh:25-32`）——引用了根本不存在的文件模式（实际机制是单文件 `.needs-review` 多行清单，不是 `.needs-review-*` 多文件），阈值拍脑袋、假阳性高，是半成品（§7.3）。
10. **「主 Agent 唯一编排者」之外的任何 coordinator/中间层**——两仓一致结论：那是 CCB 驱动外部 worker 的产物，纯原生 sub-agent 上下文本就隔离（`ARCHITECTURE.md:47`）。维持现状。

---

## 6. opencode-base 自身弱点（独立判断，供避坑）

1. **fast-mode 移植不完整**：`scripts/fast-mode.sh` 与 harness verify 的 allowFastSkip 通了，但 **AGENTS.md 无 [Fast Mode] 章节、所有 hooks 不读 `.fast-mode`**（全仓 rg 证实 hooks 零命中；cc-base 是 lib-fast-mode.sh 贯穿 hooks + 主控专节 + banner 播报）。用户开了 fast-mode，流程侧照旧派 reviewer——开关只剩半边生效。
2. **journal 无消费方**：session-journal.sh 声称「用于进化引擎扫描」（`session-journal.sh:3`），但 evolution-engine skill 与 harness 均不读 journal/（全仓 rg 仅 4 处命中且全是写入方/忽略清单）。死数据收集。
3. **死运行态标记**：`.red-verified`、`.static-gate`、`.degraded-review` 只出现在 .gitignore/watcher/setup 排除清单（`.gitignore:24-26`、`setup.sh:52`），全仓无任何读写方——从 cc-base 移植时把忽略清单搬了、把产生和消费这些标记的机制丢了（cc-base 的 tdd-gate 真用 `.red-verified`，opencode 的 tdd-gate 改成了测试文件存在性启发式，`tdd-gate.sh:32-39`）。
4. **microagents/repo.md 是死文件**：无 instructions 引用、无 AGENTS.md 引用、OpenCode 无该机制（全仓 rg 仅自引用），却在 CAPABILITY-MATRIX 里列为能力项。
5. **对抗审查三处定义并存**（§5#7），已现漂移。
6. **落后 cc-base 的部分未回收**：无 Fast Mode 主控节、无审批三档、无查证后再结论/远端实查铁律、无 three-file-sync-gate hook、无 gate-audit/plan-lint、EVOLUTION 缺聚类毕业条款、make-release 缺泄漏扫描。姊妹仓授粉是单向滞后的。

---

## 7. Top 5 最值得借鉴（排序）

**#1 `.claude/commands/` 原生 slash command 注册表**（§4#1）
为什么：cc-base 的 `/record` `/recap` `/impact` 语义全靠 CLAUDE.md 文本约定——模型记不牢就漏；CC 原生 commands 支持 $ARGUMENTS、`!` 预执行注入，opencode-base 的 6 条模板（尤其「先读规则→跑 harness→解读」三段式）可近乎原样落成 md。这是 CC 原生能力的纯增量，零风险。

**#2 agents frontmatter `tools:` 权限收紧**（§4#2）
为什么：code-reviewer 能写代码、progress-recorder 能跑 bash 是当前 cc-base 的真实敞口；「只读角色」应像 opencode-base 那样配置强制而非 prompt 约束。7 行改动，立刻把「审查者不改码、记录员不执行」变成机制。

**#3 skill-builder TDD-for-Skills**（§4#3）
为什么：cc-base 的进化引擎产出 skill 优化建议，但没有「怎么验证 skill 真的改变了行为」的方法论。RED（先记录 agent 违规借口）→GREEN（最小 skill 堵它）→REFACTOR 与 cc-base red-locks-the-bug 哲学同构，补齐 skill 域闭环。

**#4 Model Selection 分档 + BLOCKED 升级阶梯**（§4#4/#5）
为什么：implementer 固定 opus 在机械小任务上纯烧钱；BLOCKED 的四路阶梯（尤其「禁同模型无变化重试」）把 cc-base 四态自评从「有信号」升到「有处置手册」。CC 原生 model 字段直接承载。

**#5 红蓝对抗三点差分**（§4#6）
为什么：蓝队防守方对称审理是对 cc-base「Red 单向攻击」的真补强——false positive 也有成本，误判该有人用证据顶回去；高风险改动 per-Task 下沉让对抗不必等到发版；Spec/Plan 文档攻击把对抗前移到最便宜的层。全部落在现有 red-blue-review skill 内改造，不加新件。

---

## 附：证据核查方法备注

harness.mjs / adapters.json / supervisor.mjs / EVOLUTION.md / test-harness.sh 的「零差异/单向滞后」结论均来自归一化 sed（`.opencode→.claude` 等）后 diff 实测；「死接线」结论（journal / microagents / .red-verified 族 / fast-mode hooks）均来自全仓 ripgrep 读写方清点，非推断。
