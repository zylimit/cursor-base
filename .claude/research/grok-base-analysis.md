# grok-base 框架深度剖析

> 分析对象：`D:\code\grok-base`（纯 xAI Grok 脚手架）
> 分析目的：为「下一代支持 20-30 万行规模项目的 harness」挖掘可反哺的实战经验
> 分析日期：2026-07-30

---

## 1. 定位与运行时

**面向的 agent**：xAI Grok CLI。它是 cc-base（Claude Code 版）的姊妹框架，同一套「从想法到可发布产品」的开发脚手架被移植到 Grok 的官方原生表面上。

**运行时载体**（`AGENTS.md:11,39-49`）：
- 主控 = 根目录 `AGENTS.md`（等价于 cc-base 的 `.claude/CLAUDE.md`）。
- 所有能力放在 `.grok/` 下：`skills/ agents/ roles/ personas/ hooks/ scripts/ feedback/`。
- 派发靠 Grok 原生 `spawn_subagent(subagent_type, prompt, capability_mode, isolation)`，**depth 恒为 1**（不能嵌套 spawn）。
- 明确「纯 Grok 方案」：不依赖安装器 daemon、tmux、外部模型桥（`AGENTS.md:11`）。

**技术栈**：Markdown（主控 + skills）+ TOML（roles/personas）+ Bash/PowerShell/CMD 三写 hooks + JSON（hooks 注册）。无编译型代码，纯 prompt/脚本脚手架。

**整体架构**（`docs/ARCHITECTURE.md`）：
```
主 Agent 读 AGENTS.md → 命中 Skill 读 SKILL.md → spawn_subagent(depth 1) → 凭客观证据验收
```
主 Agent 是唯一编排者，7 个项目 Agent 是工人，每次 fresh 实例。规模：14 Skills、7 项目 Agent、1 orchestrator（`docs/CAPABILITY-MATRIX.md:18`）。

**关键血统**：grok-base 是「cc-base 抄作业」的产物。`docs/CC-BASE-LEARNINGS.md` 是一份逐条对照的移植笔记，`docs/INSPIRATION-BOUNDARY.md` 划出边界——「工作流可抄，架构必须 Grok 原生」。所以它的价值不在原创，而在于**验证了一套工程纪律跨 harness 移植时哪些留得下、哪些漏掉了**。

---

## 2. 核心机制全清单

### 2.1 Hooks / 闸门（`.grok/hooks/`）

| 机制 | 作用 | 证据 |
|---|---|---|
| 三写 hook（.sh + .ps1 + .cmd） | 每个 hook 三平台等价实现；Windows 用 `.cmd` 包装真 pwsh7 路径 | `.grok/hooks/bin/*`（8 组×3） |
| `no-direct-code-guard` | PreToolUse 拦主 Agent 直接写业务源码（`src/app/lib/components/...`），命中 deny exit 2；框架/文档路径放行 | `no-direct-code-guard.sh:18-27`；`.ps1:22-30` |
| `block-pkill` | PreToolUse 硬拦 `pkill -f`（安全护栏，Fast Mode 不豁免） | `block-pkill.sh:12-15` |
| `pre-commit-check` | PreToolUse 命中 `git commit` 时按栈跑轻量编译/语法闸（tsc --noEmit / ruff / py_compile），Fast Mode 放行 | `pre-commit-check.sh:11-44` |
| `mark-review` | PostToolUse 把改过的业务文件登记进 `.grok/.needs-review`，跳过 md/json/docs | `mark-review.sh:17-42` |
| `detect-feedback` | UserPromptSubmit 匹配中英文「修正用语」→ 写 `.grok/.feedback-signal` 信号文件 | `detect-feedback.sh:16-18` |
| `session-start` | SessionStart 播报 Fast Mode 状态 / 待审文件数 / feedback 信号 / 脏树 /recap 提醒 / feedback index 待处理 | `session-start.sh:11-47` |
| `session-rules-banner` | SessionStart 打印 6 条核心铁律横幅 | `session-rules-banner.sh:13-24` |
| `stop-reminder` | Stop 事件只能被动提醒（Grok 的 Stop 不能硬拦），把待审提醒写进 `.stop-reminder` | `stop-reminder.sh:1,25-26` |

**平台设计核心**（`lib.sh` / `lib.ps1`）：hook 靠 `GROK_WORKSPACE_ROOT`/`CLAUDE_PROJECT_DIR` 环境变量 + 三级 fallback 定位项目根；PowerShell 侧全程 try/catch 兜底「永不向 host 抛异常」（`lib.ps1:1-5`），`Test-FastModeActive` 读 epoch 判过期。

### 2.2 Sub-Agent 编排（三层角色体系，见亮点章节）

| 机制 | 作用 | 证据 |
|---|---|---|
| 统一派单包 | 每次派发六字段：Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation | `AGENTS.md:83-85`；`docs/ROLE-CONTRACTS.md:21-28` |
| 统一回执信封 | 回传固定：Status / Changed / Verified / Not verified / Needs review by / Evidence | `AGENTS.md:88-90` |
| implementer 四态自评 | DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED；tester 用 PASS/FAIL | `agents/implementer.md:20-26` |
| 扁平编排铁律 | 主 Agent 唯一编排者，Sub 不再拉 Sub（Grok 内建 depth=1 强制） | `AGENTS.md:42`；`docs/ROLE-CONTRACTS.md:17` |
| 编码默认串行 | 只读工作（审查/测试/研究）才并行；编码默认串行 | `docs/CC-BASE-LEARNINGS.md:46` |

### 2.3 记忆系统

| 机制 | 作用 | 证据 |
|---|---|---|
| progress.md 三区块化 | Pinned / Decisions / TODO / In Progress / Done / Risks / Notes / Context Index | `skills/progress-recorder/SKILL.md:46-74` |
| 高置信闸门 | 只有强承诺语言才进 Pinned/Decisions，弱化词自动降级 Notes + "Needs-Confirmation" | `progress-recorder/SKILL.md:37,103` |
| 阈值自动归档 | Notes+Done 合计 >100 条时搬迁到 progress.archive.md，各留最近 50 条，archive 只增不删 | `progress-recorder/SKILL.md:119-129` |
| TODO 单调 ID | #ID 单调递增不复用，语义去重 | `progress-recorder/SKILL.md:33,108` |
| 三文件同步铁律 | 决策/完成即时写 progress；改需求成对更新 Spec+CHANGELOG | `AGENTS.md:48` |
| /recap 恢复 | 同步读三文件（progress + Spec + CHANGELOG），缺则降级说明 | `AGENTS.md:153`；`progress-recorder/SKILL.md:18-22` |

### 2.4 质量卡点

| 机制 | 作用 | 证据 |
|---|---|---|
| 完成声明五步闸 | ①想清证明命令 ②当场重跑 ③读完整输出+exit code ④确认输出支持结论 ⑤才开口；禁「应该/大概/看起来」 | `AGENTS.md:44` |
| 验证即证据（硬门禁） | 完成声明必须与验证命令输出同条消息；「之前编译过了」无效 | `dev-builder/SKILL.md:37,385-386` |
| 三阶段审查 | Stage 0 静态闸 → Stage 1 规格合规 → Stage 2 代码质量，逐级卡 | `code-review/SKILL.md:56-114` |
| 对抗式审查 | 默认有罪，构造边界/并发/异常输入试图击破，findings 钉到 file:line | `personas/code-reviewer.toml:22-26` |
| 四步走验证 | Phase 完成：Code Review → 测试完整性 → 编译验证 → 功能测试 | `dev-builder/SKILL.md:348-392` |
| 写测独立性 | 测试编写者不得是被测代码作者（防 confirmation bias） | `test-builder/SKILL.md:33`；`personas/tester.toml:5` |
| 契约优先测试 | 测试预算砸在「出错最贵」处（跨边界契约/解析器/去重），不追覆盖率虚荣 | `test-builder/SKILL.md:29-32,54-76` |
| 反合理化清单 | 列出 Agent 跳过规则的常见话术 + 正确应对 | `dev-builder/SKILL.md:321-346` |

### 2.5 Feedback / 进化

| 机制 | 作用 | 证据 |
|---|---|---|
| 四层进化路径 | 经验积累 → 规则毕业(3+次) → Skill 优化(评分低) → Skill 自动生成(5+次) | `EVOLUTION.md:7-20` |
| 观察/进化分离 | feedback-observer 只记录，evolution-runner 只提议；改规则须用户逐条确认 | `EVOLUTION.md:1-6,22-30` |
| feedback≠memory | feedback 进 `.grok/feedback/` 供进化，memory 进 progress.md | 隐含于 EVOLUTION + progress-recorder 边界 |
| 养成式非打扰 | 记录/扫描无感，提议轻触一行，执行必确认 | `EVOLUTION.md:22-30` |

### 2.6 Setup / 跨平台

| 机制 | 作用 | 证据 |
|---|---|---|
| setup.ps1 / setup.sh | 注入 AGENTS.md + .grok；跳过运行态与私人 feedback；OS 专属 hooks；装完跑 doctor | `setup.sh:1-211`；`setup.ps1:1-358` |
| FRAMEWORK-MANIFEST | LF-normalized SHA256 清单；升级时用户改过的文件不覆盖，落 `.framework-new` | `setup.sh:47-107`；`FRAMEWORK-MANIFEST.txt:1-83` |
| Windows .cmd 生成器 | setup.ps1 现场生成 hardened `.cmd`：探测 pwsh7 三路径、`!ERRORLEVEL!` 延迟展开、passive/blocking 分别处理 exit code | `setup.ps1:178-245` |
| doctor + spawn smoke | 装后自检 agents/roles/personas/skills/hooks 齐全 + 真跑一个 hook 验 spawn | `doctor.sh:21-55` |
| gen-manifest | 源仓改完刷新清单（norm_sha 去 \r） | `gen-manifest.sh:1-42` |
| gitattributes eol 控制 | `.sh=lf .ps1=crlf .toml/.md/.json=lf` 锁行尾 | `.gitattributes` |

### 2.7 personas / roles / ROLE-CONTRACTS

见第 3 章亮点。

### 2.8 Fast Mode

`.grok/.fast-mode` 文件存 `expires_epoch`，默认 24h 过期（`fast-mode.sh:10-14`）。开启后跳过自动 tester/code-reviewer 与待审登记，但**危险命令/破坏性操作/密钥/远端副作用不豁免**（`AGENTS.md:139-141`）。所有 hook 开头统一 `fast_mode_active && allow`（如 `no-direct-code-guard.sh:8`、`pre-commit-check.sh:12`、`mark-review.sh:11`），但 `block-pkill` 故意不检查 Fast Mode（安全护栏）。

---

## 3. 独特亮点（相对「轻量单机 CC 框架」）

### 3.1 ★ 三层角色契约体系（agents / roles / personas）—— 最大特色

这是 grok-base 相对 cc-base 最结构化的一处。同一个角色被拆成**三个正交文件**（`docs/ROLE-CONTRACTS.md:3-9`）：

| 层 | 文件 | 装什么 | 例子 |
|---|---|---|---|
| Agent type | `.grok/agents/<name>.md` | 可 spawn 类型、description、base prompt、frontmatter | `agents/implementer.md:1-30` |
| Role | `.grok/roles/<name>.toml` | `default_capability_mode` / `default_isolation` 默认能力面与隔离 | `roles/implementer.toml:3-4`（`all`/`none`）、`roles/code-reviewer.toml:4`（`read-write`） |
| Persona | `.grok/personas/<name>.toml` | 行为指令（角色/角色契约/Skill 边界/任务/回执） | `personas/implementer.toml:4-37` |

**为什么这是亮点**：轻量单机 CC 框架通常把「角色人格 + 权限 + 行为」全塞进一个 agent.md 的 system prompt。grok-base 把**权限默认值（role.toml 的 capability_mode/isolation）**和**行为纪律（persona.toml）**分开，权限是机器可读的声明（read-only / read-write / execute / all），行为是自然语言。这让「这个角色最多能干什么」可静态审计，而不埋在散文里。每个 persona 都用统一四段结构：`[角色][角色契约][Skill 边界][任务][派单与回执]`，其中「角色契约」显式列 `Interaction mode / Responsibilities / Non-goals`（如 `personas/tester.toml:8-11`），Non-goals 把「不该干什么」钉死。

`ROLE-CONTRACTS.md:43-52` 还有一张 Owns/Does-not-own 边界矩阵，7 个角色逐行划权责。**注意**：文档诚实标注「Skill allowlists 是路由纪律，不是 sandbox 授权」（`ROLE-CONTRACTS.md:54`）——即这层是行为约束，真实权限仍靠工具授权。

### 3.2 capability_mode 四档能力面

Grok 原生支持 `capability_mode: read-only / read-write / execute / all`（`AGENTS.md:70`），在派发时就声明子 Agent 的能力上限。这是 cc-base 的 Task 工具没有的显式能力分级——CC 靠 agent 定义里的 `tools:` 白名单，grok-base 靠一个正交的 capability 轴 + isolation 轴（none/worktree）。对大规模项目，这种「派发即声明最小权限」的模型更利于防子 Agent 越权。

### 3.3 硬核 Windows hook 适配（血泪凝结的安装器）

`setup.ps1:178-245` 是整个仓库工程含量最高的一段：它**现场生成** `.cmd` 包装器，因为 Grok 在 Windows 上把 hook `command` 当单个可执行路径 spawn，直接跑 `.sh` 会 Win32 error 193（`README.md:94-102`）。生成的 .cmd 依次探测 `%ProgramW6432%` / `%ProgramFiles%` / `C:\Program Files` 三个 pwsh7 路径，用 `setlocal EnableDelayedExpansion` + `!ERRORLEVEL!` 拿真实退出码，并区分 passive hook（永远 exit 0）与 blocking hook（保留 exit 2 = deny，其它非零 fail-open）。这套是从 6+ 次 fix commit 里熬出来的（见第 5 章）。

### 3.4 detect-feedback 双语信号 + 信号文件解耦

`detect-feedback.sh:16` 用一条正则同时匹配中英文修正用语（`不是这样|别这样做|你搞错|wrong|incorrect|stop doing|...`），命中就落一个 `.feedback-signal` 文件；session-start 下次读到它才提醒派 feedback-observer。**信号文件把「检测」和「处理」解耦**——检测在 UserPromptSubmit 廉价完成，处理延迟到主 Agent 有余力时。

---

## 4. 面向大规模项目（20-30 万行）的能力

**总体判断：基本没有为大规模 codebase 专门设计的机制。** grok-base 是「小-中型产品从 0 到 1」的脚手架，它的假设是绿地项目、单人开发、Phase 递进。下面逐项对照：

### 4.1 上下文 / 记忆管理
- **有**：progress.md 阈值自动归档（>100 条搬 archive，`progress-recorder/SKILL.md:120`）、/recap 三文件恢复、Context Index 轻量指针。
- **不足**：归档只是「按条数搬走旧条目」，没有按模块/子系统分片的记忆，没有向量检索或分层索引。20-30 万行项目的决策历史远超 100 条的线性列表能承载。

### 4.2 任务分解
- **有**：dev-planner 的依赖图构建法（DAG + 拓扑排序，`dev-planner/SKILL.md:102-110`）、粒度校准法（Phase 交付清单 2-4 项、Task 30-90 分钟可完成，`dev-planner/SKILL.md:118-130`）、无占位符原则。
- **不足**：Phase/Task 是**线性序列**，不是面向大 codebase 的模块化任务图。「单文件不超过 300 行」（`dev-builder/SKILL.md:38`）这种规则在 20-30 万行项目里既不现实也无法强制。

### 4.3 并行编排
- **有明确立场，但基本是「劝退并行」**：`docs/CC-BASE-LEARNINGS.md:46` 抄了 Anthropic/Cognition 的结论——「编码默认串行，只读工作（审查/测试/研究）才是并行甜区」。Grok 有 `isolation: worktree` 可做隔离并行（`AGENTS.md:71`）。
- **不足**：没有 cc-base 那样的 Workflow fan-out 脚本层（cc-base 有 `.claude/workflows/code-review-fanout.js` 和整份 `workflow-orchestration.md`）。grok-base 的 CC-BASE-LEARNINGS 明确写「不要抄 Dynamic Workflows JS」（`:49,134`），所以规模化并行只能靠主 Agent 手动多次 spawn，无编排原语。**对大规模项目这是硬伤**——并行的甜区（大范围只读审查/普查）恰恰缺工具。

### 4.4 大 codebase 导航
- **无。** 没有代码索引、符号图、依赖分析、探索缓存等任何机制。仅有内建 `explore` agent 可用（`AGENTS.md:72`），但那是通用搜索，非大 codebase 专用。

### 4.5 防失控闸门
- **有**：no-direct-code-guard（主 Agent 不碰业务码）、block-pkill、pre-commit-check、五步闸、审批三档（LOW/MEDIUM/HIGH，`AGENTS.md:51-59`）、Fast Mode 安全护栏不豁免。
- **评价**：这些闸门是「行为纪律」层面的防失控，对任何规模都有用；但没有「大改动爆炸半径检测」「跨模块影响分析」这类针对大 codebase 的失控防护。`no-direct-code-guard` 的业务路径匹配还是硬编码目录名清单（`src|app|lib|...`），大 monorepo 里会误判。

**结论**：grok-base 对 20-30 万行项目**没有专门能力**。它的可迁移价值全在「工程纪律 / 验收铁律 / 角色契约 / 安装适配」这些**规模无关**的层面，而非规模相关的架构。

---

## 5. 血泪教训（progress.md / git history / docs）

### 5.1 Windows hook error 193（6+ 次 fix 熬出来的）
git log 里连续 6 个 commit 全在打这个 boss：
```
6374d3b fix: run hooks via pwsh on Windows (error 193)
a589d7b fix: use .cmd hook entrypoints on Windows (error 193)
4af386e fix: absolute GROK_WORKSPACE_ROOT paths for Windows hook spawn
7f1ce4d fix: harden Windows hooks against exit code 1
2a76e93 fix(hooks): Windows relative bin paths and hardened .cmd exits
```
教训沉淀（`README.md:94-102`、`CC-BASE-LEARNINGS.md:19`）：
- Grok 在 Windows 把 hook command 当单个可执行路径 spawn → `.sh` 直接跑报 error 193。
- 整行 `pwsh -File ...` 也常失败 → 必须 `.cmd` 包装。
- 必须用 **pwsh 7 绝对路径**（`ProgramW6432`），禁裸 `powershell.exe` 5.1（超时/PATH 污染）。
- passive hook 若返回非零会 red-bar 整个 SessionStart/Stop → 强制 exit 0。
- Windows 下 `${GROK_WORKSPACE_ROOT}` 在 JSON command 里展开有问题 → 最终改用**相对 bin 路径**（`setup.ps1:247` 注释）。这是 `2a76e93` 最后一次翻案：从绝对路径（`4af386e`）又改回相对路径。

### 5.2 定位反复横跳（同仓 → 单独可用）
git log 显示架构定位摇摆过：`89b3ecf` 加「Grok+Codex 共存的 shared AGENTS 模板」→ `20e2acb`「双仓组装」→ `23bbd4c`「放弃双仓」→ `e2569f6`「恢复纯单独可用」。progress.md 记了决策（`progress.md:14`）：「与 codex-base 分开维护、单独运行（用户确认撤销同仓方案后恢复）」。**教训**：跨 harness 共享主控是诱人但错误的方向，最终回到「每个 harness 独立仓」。

### 5.3 Grok 的 Stop 不能硬拦
反复强调（`AGENTS.md:170`、`ARCHITECTURE.md:25`、`stop-reminder.sh:1`、`progress.md:9`）：Grok 只有 PreToolUse 能 deny，Stop 是被动的。所以 cc-base 的 stop-gate（待审阻止 Stop）在 Grok 上只能降级成 reminder。**教训**：hook 能力跨 harness 不对等，移植时安全闭环要重新设计而非照搬。

### 5.4 PowerShell 必须 ASCII
`progress.md:9`「PowerShell 脚本 ASCII」。中文/非 ASCII 在某些 PowerShell 编码环境下出问题，脚本内输出一律英文 ASCII。

### 5.5 移植抄作业的自觉
整份 `docs/CC-BASE-LEARNINGS.md` 就是血泪史的正向沉淀——它诚实记录「哪些抄了、哪些待抄、哪些明确不抄」，并把最该毕业进 AGENTS 的 5 条铁律列出（`:90-97`：五步闸 / 主 Agent 不写码 / 审批三档 / 远端先实查 / Skill 1% 即调）。

---

## 6. 反面教材 / 弱点（专家判断，不盲从）

### 6.1 ★ 引用了不存在的脚本（Stage 0 静态闸是空壳）
`code-review/SKILL.md:62` 和 `personas/code-reviewer.toml:17` 都要求 `bash .grok/hooks/static-check.sh .` 作为 Stage 0 静态闸，但**这个文件在整个仓库里不存在**（已 grep 全仓确认）。虽然写了「若存在才跑」fail-open，但意味着整个 Stage 0「机器先说话」的设计**从未真正生效**——这正好撞上框架自己的铁律「加闸要能说出它挡住过什么，长期全过就删掉」。这是一个**声明了但没实现的闸**，是纸面工程。

### 6.2 ★ 路径引用错误
`dev-builder/SKILL.md:95` 写 `见 .grok/hooks/pre-commit-check.sh`，但实际文件在 `.grok/hooks/bin/pre-commit-check.sh`。小错，但暴露文档与实现漂移，无 lint 守护。

### 6.3 ★ 领域泄漏（"conflation" / KMZ）破坏「通用脚手架」宣称
`no-direct-code-guard.sh:24` 和 `.ps1:27` 的业务路径匹配里赫然出现 `conflation`——这是某个具体项目（KMZ/GIS 数据 conflation）的目录名。test-builder 的示例（`:50-52`）也全是 KMZ 导出/导入、SITE ID、NP 点这类特定领域内容。一个宣称「拷两项即用的通用脚手架」（`Product-Spec.md`）里硬编码了前一个项目的领域词，说明**从真实项目反向抽取脚手架时清洗不彻底**。

### 6.4 硬编码业务目录清单不可扩展
no-direct-code-guard 靠一串写死的目录名（`src|app|lib|components|pages|api|...`）判断「是不是业务代码」。任何不叫这些名字的项目（Go 的 `cmd/`、Rust 的 `crates/`、monorepo 的 `packages/`）都会漏判或误判。没有配置化。

### 6.5 双写/三写 hook 的维护税
每个 hook 要维护 .sh + .ps1 + .cmd 三份逻辑等价的实现，靠 FRAMEWORK-MANIFEST 的 SHA 兜底但**不校验三者行为一致**。detect-feedback 的中文正则、no-direct-code-guard 的路径匹配在三份里各写一遍，极易漂移（事实上路径清单在 .sh 用 glob、.ps1 用 regex，已经是两套写法）。

### 6.6 主控偏薄但 Skill 偏厚
AGENTS.md 精简（187 行）是优点，但 dev-builder/SKILL.md 达 505 行、dev-planner 322 行、code-review 254 行。框架自己在 CLAUDE.md 里警告「超过 150 行 AI 会忽略后面内容」，这些 Skill 远超该阈值。大量内容是「反合理化清单」「典型表达」这类劝导性散文，信息密度可疑。

### 6.7 「测试有基建」的乐观假设
test-builder 假设能自主 scaffold pytest/vitest。对 20-30 万行的存量项目，测试基建往往复杂（自定义 runner、fixture 工厂、CI 集成），「派子 Agent scaffold 一个空套件」的假设过于天真。

### 6.8 进化系统零实际使用
FEEDBACK-INDEX.md 是空模板（`:6,10` 全是 `(none)`），feedback/ 下只有 templates。整套四层进化机制**从未在本仓产生过一条真实 feedback**。机制存在不等于被验证——这本身就是框架铁律「gates-need-empirical-validation」的反例。

---

## 7. Top 5 最值得借鉴

### ① 三层角色契约（agents / roles / personas 分离）
**为什么值得**：把「权限默认值」（role.toml 的 capability_mode/isolation，机器可读、可静态审计）与「行为纪律」（persona.toml 的角色契约 + Non-goals）从 base prompt 里剥离出来。相比把一切塞进单个 agent.md，这让「某角色最多能干什么」不再埋在散文里。对大规模多 Agent 系统，可审计的最小权限声明是安全刚需。
**怎么移植**：在下一代 harness 里为每个 sub-agent 建三元组：`capability`（read-only/read-write/execute/all + isolation）声明式权限、`contract`（Interaction mode / Responsibilities / Non-goals）行为边界、`prompt`（角色人格）。capability 层做成运行时真强制（不只是「路由纪律」——这是 grok-base 诚实承认的短板），把 grok 的「声明」升级成 CC 的「工具白名单真授权」。

### ② 统一派单包 + 统一回执信封 + 四态自评
**为什么值得**：`Goal/Scope/Out of Scope/Existing Pattern/Verification/Escalation` 六字段派单 + `Status/Changed/Verified/Not verified/Needs review by/Evidence` 回执，让 fresh 子 Agent 不靠猜、回传不灌爆主 Agent 上下文。implementer 四态自评（DONE_WITH_CONCERNS 等）让主 Agent 在收到 review 前就能预判。这套是**上下文隔离编排的通用协议**，规模越大越值钱。
**怎么移植**：直接把这两个信封做成 harness 的结构化 schema（不是自然语言约定），派发/回传时强制字段校验，缺字段拒绝。cc-base 已有雏形，grok-base 把它显式化了，下一代应做成硬 schema。

### ③ 完成声明五步闸 + 验证即证据硬门禁
**为什么值得**：「完成声明必须与验证命令输出在同一条消息」「禁止引用上一条消息的旧输出」「禁应该/大概/看起来」——这是对 LLM 最大顽疾（幻觉式完成声明）的直接对症。对 20-30 万行项目，一次假「已修复」的代价被放大。
**怎么移植**：做成验收 hook——子 Agent 报「完成/通过」时，harness 校验同一 turn 内是否有对应命令的**新鲜** exit code 与输出，无则拒绝该结论。把散文铁律升级成机器闸。

### ④ 安装器工程闭环（setup + FRAMEWORK-MANIFEST + doctor + gitattributes）
**为什么值得**：`docs/CC-BASE-LEARNINGS.md:155-158` 的总结一针见血——「精华不是多一个 setup 文件，而是注入适配 + 升级分层 + hook 双写 + 装后自检组成的工程闭环」。FRAMEWORK-MANIFEST 的 LF-normalized SHA 让「用户改过的文件升级时不覆盖，落 .framework-new」这一升级安全成为可能；doctor 的 spawn smoke 是「装完真能跑」的最小验证。
**怎么移植**：任何要分发给多项目的 harness 都该有这套。关键点：① SHA 清单区分「框架文件 vs 用户改过的文件」做安全升级；② 跳过运行态与私人 feedback 不进业务仓；③ 装后自检包含一次真实的最小端到端 spawn，而非只查文件存在。

### ⑤ 信号文件解耦 + 阈值自动归档（廉价检测 / 延迟处理 / 自动收敛）
**为什么值得**：detect-feedback 在 UserPromptSubmit 廉价落一个 `.feedback-signal` 文件，处理延迟到 session-start；progress.md 到 100 条自动归档。这类「检测与处理解耦 + 阈值自动收敛」的模式，让长运行、大体量的 session 不会因为每步都做重活而拖垮，也不会让记忆文件无限膨胀。
**怎么移植**：大规模项目的记忆/信号系统应普遍采用——① 廉价 hook 只落信号，重处理延迟批量做；② 所有累积型文件（记忆/日志/待审）设阈值自动分片归档，archive 只增不删 + 主文件留指针。可进一步做成按模块分片而非线性（补足 grok-base 第 4 章的短板）。

---

## 附：文件索引（关键证据位置）

- 主控：`D:\code\grok-base\AGENTS.md`
- 三层角色：`.grok/agents/*.md`、`.grok/roles/*.toml`、`.grok/personas/*.toml`
- 角色契约文档：`docs/ROLE-CONTRACTS.md`
- 移植笔记（血泪史正向沉淀）：`docs/CC-BASE-LEARNINGS.md`
- Hooks：`.grok/hooks/bin/*.{sh,ps1,cmd}` + `project-hooks.json`
- 安装器：`setup.ps1`（Windows .cmd 生成核心 178-245）、`setup.sh`
- 升级安全：`.grok/FRAMEWORK-MANIFEST.txt`、`.grok/scripts/gen-manifest.*`、`doctor.*`
- 记忆：`.grok/skills/progress-recorder/SKILL.md`、根 `progress.md`
- 进化：`.grok/EVOLUTION.md`、`.grok/feedback/`（空模板）
- 弱点证据：`code-review/SKILL.md:62`（引用不存在的 static-check.sh）、`no-direct-code-guard.sh:24`（conflation 领域泄漏）
