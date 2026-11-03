# cc-base 架构文档

> SiteMaster 全栈开发框架的**纯 Claude Code 基础设施**。本仓库不是产品代码，交付物是 `.claude/`（CLAUDE.md / agents / skills / hooks / feedback）这套可复现的编排配置。它是 [ccb-base](https://github.com/zylimit/ccb-base) 的纯 CC 派生版——去掉 CCB 多进程编排与外部 codex/gemini worker，全部改用 Claude Code 原生能力。

---

## 1. 这是什么

一套让单个 Claude Code 主 Agent 扮演「资深产品经理 + 全栈开发教练」（角色名 SiteMaster），带用户从模糊想法走到可发布产品的框架。编排不依赖任何外部进程：无 daemon、无 tmux、无 codex/gemini 外驱。所有委派走 Claude Code 原生的 **Sub-Agent（Task/Agent 工具）** 与 **Dynamic Workflows**。

与 ccb-base 的唯一本质差异 = **编排层**：

| | ccb-base | cc-base |
|---|---|---|
| 编排 | CCB daemon + tmux 多进程 | Claude Code 原生 Sub-Agent / Workflow |
| worker | 异构（claude / codex / gemini） | 同构（全 Claude） |
| 派单 | `ccb ask` 异步 + 轮询 | Task 工具派发（v2.1.198+ 默认后台、完成自动回传）/ Workflow 引擎 |
| 上下文保护 | coordinator 协调员中间层 | Sub-Agent 本就隔离，无需中间层 |
| fan-out | coordinator 串外部 agent | **Dynamic Workflows（纯 CC 红利）** |

技能体系 / hook / feedback / 进化引擎 / 项目记忆与 ccb-base **完全一致**。

---

## 2. 两类角色 —— 谁干什么

### 2.1 主 Agent = 唯一编排者

负责 **需求分析 / 任务分解 / 排序 / 派发 / 验收**。四个执行环节（编码 / 审查 / 测试 / 部署）**一律不亲自动手**，只「写提示词 + 委派 + 验收」。仅文档类（Product-Spec / CHANGELOG / DEV-PLAN / 本架构文档）可直接写。

### 2.2 专职 Sub-Agent = 工人（`.claude/agents/`）

每次派发都是 **fresh 实例**，不继承 session 历史，互不串扰。

| Agent | Skill | 职责 |
|-------|-------|------|
| `implementer` | dev-builder | 编码实现 + 编译验证 + 自检 |
| `code-reviewer` | code-review | 三阶段审查（静态闸 / 规格符合性 / 代码质量）+ 报告 |
| `tester` | test-builder | 写/跑测试（独立于实现者）+ 运行证据 |
| `deployer` | release-builder | 打包/部署执行 + 结果 |
| `feedback-observer` | feedback-writer | 记录用户反馈到 `.claude/feedback/` |
| `evolution-runner` | evolution-engine | 扫描 feedback + 生成进化建议 |
| `progress-recorder` | progress-recorder | 增量维护 `progress.md` 项目记忆 + 归档 |
| `domain-recorder` | 无 | 按七栏收录领域口径到项目根 `domain/` + 维护依赖关系 |

### 2.3 扁平编排（铁律）

主 Agent 是唯一编排者：**Sub-Agent 不再拉 Sub-Agent**；Workflow 由主 Agent 编写、其内 `workflow()` 嵌套仅一层。纯 CC 的 Sub-Agent 本就上下文隔离（只回传最终结论进主 Agent），**不需要 ccb-base 那种 coordinator 协调员中间层**——那是 CCB 为驱动外部 codex worker 才有的，纯 CC 不照搬。

---

## 3. 两种派发形态

| 形态 | 何时用 | 工人 |
|------|--------|------|
| **直接 Task 派单**（默认） | 单 Task / 一问一答 | 一次一个专职 Sub-Agent |
| **Workflow 编排**（规模化上层） | 多个无依赖单位的 fan-out / pipeline | 同一批专职 Sub-Agent，由脚本编排 |

两者工人相同，只是编排粒度不同。Task 工具派发在 Claude Code v2.1.198+ **默认后台运行**：spawn 立即返回 async_launched，Sub-Agent 完成时结果自动回传进主 Agent 上下文（无需手工轮询；notify hook 会同步给用户桌面通知）。验收时序不变——结果到手才验收，"已派发"不等于"已完成"。

---

## 4. Workflow 编排模式 —— 纯 CC 的核心红利

> 本节结论基于业界实践（见 §10 引用），不是凭空设计。

### 4.1 为什么 cc-base 能用、ccb-base 不能

Dynamic Workflows 的 `agent()` **只能 spawn Claude subagent**。ccb-base 要驱动外部 codex worker，被这条挡在门外（其架构文档 §3.7 的结论是"用 coordinator 不用 workflow"）。**cc-base 全是 Claude worker，这道门是开的**——这是纯 CC 相对 CCB 最该吃下的红利。

### 4.2 判据轴 = 单元的决策要不要自洽（不是"任务多少"）

| 工作类型 | 决策需自洽? | 业界结论 | cc-base 处理 |
|---------|:---:|---------|------------|
| **只读广度**（审查维度 / 代码库探索 / 测试目标普查 / 研究） | 否，结果汇总 | ✅ 多 Agent 甜区 | **Workflow fan-out** |
| **逐条验证/评判** | 否，独立投票 | ✅ voting / evaluator | **Workflow** 多视角 verify |
| **单 Task review→fix** | 串行 | ✅ evaluator-optimizer | 现有循环，workflow 只形式化 |
| **跨 Task 编码** | **是，共享契约** | ⚠️「not a good fit」 | **默认串行**，并行是窄例外 |

**关键修正**：编码是**最不该并行**的环节。Anthropic 实证「most coding tasks involve fewer truly parallelizable tasks than research」；Cognition 的「Flappy Bird」证明并行编码会因不共享上下文而决策冲突（共享类型/契约/命名各写各的）。所以把 workflow 并行红利用在**审查 / 测试 / 研究**这些只读广度上，**编码保持串行**。

### 4.3 三个推荐场景

1. **code-review 多维 + 对抗验证**：`pipeline(维度, 审查, 逐条 verify)`，verify 用**多视角 lens**（correctness / security / repro）。以视角多样性**补回纯 CC 失去的「codex/claude 异构互照」**——这是纯 CC 对同源盲区的正面解法。**已落地脚本** `.claude/workflows/code-review-fanout.js`（主 Agent 显式 opt-in 调用，schema 回传「结论 + 证据句柄」由主 Agent 定夺）。
2. **test-builder 批量写测**：`parallel` 多个高价值逻辑（契约 / 解析器 / 边界）各派 tester。`agent()` 每次 fresh，天然独立于 implementer 作者，写测独立性免费保住。
3. **代码库探索 / 研究**：breadth-first 普查，多 agent 各搜一个角度。

### 4.4 集成点：`agentType`

```js
agent(prompt, { agentType: 'code-reviewer', schema })
agent(prompt, { agentType: 'tester', schema })
agent(prompt, { agentType: 'implementer', isolation: 'worktree', schema })  // 仅并行写文件时
```

`agentType` 从与 Task 工具同一个注册表解析，直接复用框架现有专职 Agent（带各自 skill + system prompt）。**编排换成脚本，工人不变**——隔离 / 职责边界 / 写测独立全保住。

### 4.5 三铁律 + 成本闸门

- **主 Agent 仍是唯一编排者**：workflow 是主 Agent 写的脚本，不是 Sub-Agent 自拉 Sub-Agent；`workflow()` 嵌套仅一层（压死扁平原则）。
- **验收判断权留主 Agent**：workflow 用 `schema` 回传「结论 + 证据句柄」，主 Agent 凭证据定夺（= 翻证据外包 / 下判断自留，与验收铁律协同）。
- **写测独立性**：`agent()` fresh + 不同 agentType 保证。
- **成本闸门（硬约束）**：多 Agent 耗 token **~15x**（Anthropic 实证），只对高价值任务划算。**必须用户显式 opt-in**，不静默触发——达到 fan-out 规模时主 Agent 先提议、用户确认再跑。worktree 隔离有 ~200-500ms+磁盘/agent 成本，只在并行写文件时用；单 Phase 仅 1-2 个单位时不划算，直接 Task 直派。

---

## 5. 行为铁律（已固化 feedback）

带血教训固化的硬规则。完整细则各见 `.claude/feedback/<name>.md`，索引见 `FEEDBACK-INDEX.md`。

| 铁律 | 一句话 |
|------|--------|
| **主 Agent 职责边界** | 编码/审查/测试/部署一律委派专职 Sub-Agent，主 Agent 只「写提示词 + 委派 + 验收」 |
| **验收以客观证据为准** | 子 Agent 自报状态 ≠ 任务结果；验收核查客观证据（部署三件套 / 测试运行器真实输出 / 编译输出） |
| **测试独立性** | 写测者 ≠ 被测代码作者，避免自码自测的 confirmation bias |
| **测试卡点** | 测试通过是打包/交付前的强制前置闸门，「部署/打包」指令不豁免测试 |
| **多 repo 提交隔离** | 多个独立 repo 各自分开提交，禁止耦合进同一脚本（认证不同会掩盖单点失败） |

### 异构互照的丢失（cc-base 固有风险）

ccb-base 实证：codex reviewer 照出过会话内 claude reviewer 漏判的真 bug——**同源模型有共同盲区**。纯 CC 全是 Claude worker，**失去这层异构交叉验证**。缓解（非根除）：① 审查用 §4.3 的**多视角对抗 verify** 补回部分交叉性；② 写测独立 + fresh 实例减少作者偏见；③ 高风险改动多轮审查。根除需引入异构 worker——那就回到 ccb-base 的路线了，是两版的本质取舍。

---

## 6. SiteMaster 开发工作流

需求 → 交付全流程（详见 `.claude/CLAUDE.md` [工作流程]）：

```
需求收集 → 架构设计 → DFX设计 → 设计规范 → 设计图 → 开发计划 → 项目开发 → Bug修复 → 代码审查 → 系统测试 → 构建发布
  product-spec  arch-designer  dfx-designer  design-brief  design-maker  dev-planner  dev-builder  bug-fixer  code-review  test-builder  release-builder
```

架构设计与 DFX 设计为可选层（M/L 档项目推荐）：arch-designer 用七大设计原则（开闭/依赖倒置/单一职责/接口隔离/迪米特/里氏替换/合成聚合）做模块划分推演与自检，产出 Architecture-Design.md + ADR，L 档同步产出 module-catalog.json 骨架接通 arch-check 防腐闸；dfx-designer 把 12 维 DFX（可靠性/韧性/安全/功能安全/隐私/性能/可服务性/可安装性/可测试性/可修改性/归一化/成本）过堂成可度量场景并按模块定档，落进 harness 五性质量门。

**per-Task 闭环**（dev-builder 核心，evaluator-optimizer 模式）：编码 → code-reviewer 三阶段审查（Stage0 静态闸 / Stage1 规格符合性 / Stage2 代码质量）→ 通过则 `echo clean > .claude/.needs-review` + commit → 下一个 Task；失败则 bug-fixer 修复后重审。

**Phase 完成四步走验证**：Code Review → 测试完整性（test-builder 真卡点）→ 编译验证 → 功能测试。全过才算 Phase 完成。

18 个 Skill 全清单见 README / CLAUDE.md [可用技能]。

---

## 7. Hook 闸门（`.claude/hooks/`）

settings.json 实际注册 21 个 hook（每个一份 `.mjs`，node 单运行时，三个平台同一条命令）：

| Hook | 触发 | 作用 |
|------|------|------|
| `detect-feedback-signal.mjs` | UserPromptSubmit | 检测用户修正信号 → 提示派 feedback-observer |
| `check-evolution.mjs` | SessionStart | 报告待处理 feedback 数 |
| `session-rules-banner.mjs` | SessionStart | 会话开始打印框架核心铁律横幅 |
| `recap-on-dirty.mjs` | SessionStart | 工作树有未提交改动时注入提醒：先 /recap 校准 progress.md 再继续（防上个 session 中断/压缩致状态漂移） |
| `pre-commit-check.mjs` | PreToolUse(Bash) | git commit 前按技术栈编译/语法门禁（tsc / ruff / py_compile） |
| `kill-dev-ports.mjs` | PreToolUse(Bash) | 启动开发服务器前清理占用端口 |
| `dangerous-pkill-guard.mjs` | PreToolUse(Bash) | 拦截 `pkill -f` 等粗暴杀进程命令 |
| `secret-exfil-guard.mjs` | PreToolUse(Bash) | 拦截密钥文件读/拷/网络外传（.env/id_rsa/*.pem/credentials），带 sudo/timeout/bash -c 套壳剥离再判；Fast Mode 不豁免 |
| `tdd-gate.mjs` | PreToolUse(Agent) | 派 implementer 前查两小时内的 `.red-verified` / `.tdd-exempt`，没有则 standard 提醒、strict 拦（挂 Agent 工具不挂 Bash：派单从不经过命令行） |
| `no-direct-code-guard.mjs` | PreToolUse(Edit\|Write) | 拦主 Agent 直接改业务代码，强制委派 implementer；事件带 `agent_id`（子 Agent 内触发）一律放行 |
| `mark-review-needed.mjs` | PostToolUse(Edit/Write) | 业务代码改动登记进待审清单（豁免 .claude/ 框架自身、文档类） |
| `auto-push.mjs` | PostToolUse(Bash) | git commit 后本地领先上游则自动 push |
| `harness-async-verify.mjs` | PostToolUse(Edit/Write，asyncRewake 后台) | 大仓启用时编辑期后台跑 verify，FAIL/BLOCKED 唤醒主 Agent 早警（不硬拦，commit 硬门仍是 pre-commit-check；180s 防抖） |
| `release-gate.mjs` | UserPromptExpansion(release-builder) | /release-builder 展开前查待审清单——未清则拦，干净则注入发布卡点提醒（测试卡点/三件套验收） |
| `precompact-gate.mjs` | PreCompact | 压缩前守门：待审未清或 progress.md 未同步则拦一次压缩，提示先 /record 固化（10 分钟冷却窗防砖，出错 fail-open） |
| `notify.mjs` | Notification(agent_needs_input/agent_completed/permission_prompt) | 后台 subagent 完成/需输入/待审批时发终端桌面通知（OSC 777+BEL，经 terminalSequence 官方通道） |
| `stop-gate.mjs` | Stop | 有未审业务代码则列出待审文件：standard 只提醒（放行契约是 `echo clean`，本质是提醒），strict 阻止停止 |
| `three-file-sync-gate.mjs` | Stop | 家底/代码改动但 progress.md 未同步、或 Spec 与 CHANGELOG 未成对更新则阻止停止（三文件同步铁律） |
| `record-authorship.mjs` | PostToolUse(Edit\|Write\|NotebookEdit) | 大仓启用时把「哪个 agent 写了哪个文件」喂给引擎作者台账，`review verdict` 据此拒自审（无 catalog 完全 no-op） |
| `postcompact-reinject.mjs` | PostCompact | 压缩完成后跑 `invariants`，把铁律与活跃状态从文件重新派生注回（治 Governance Decay） |
| `subagent-acceptance-reminder.mjs` | SubagentStop(implementer\|code-reviewer\|tester\|deployer) | 执行类 Sub-Agent 返回时，把收工前的取证要求注回**子 Agent 自己**（实测：SubagentStop 的 additionalContext 落在刚停下的那个子 Agent 上下文，主 Agent 这侧收不到）；回执里真报了领域发现的，多一句「写清证据是哪一类、定论归主 Agent」 |

> `hooks/static-check.mjs` **不是注册 hook**，是 code-review Stage 0 静态闸主动调用的工具（识栈跑 shellcheck / ruff / tsc / `node --check`），同放此目录仅为聚拢。

**设计要点**：hook 不依赖 jq / python3，只要 node；共用逻辑在 `hooks/lib/`，hook 不 import 引擎（进程级隔离，引擎坏了 hook 判出「引擎跑不成」而不是假绿）；review 闸门按文件登记（非全局布尔）+ 独占创建锁防并发 + 优先级反转（clean 与待审混存时正确 block）。

settings.json 同时带三层原生配置（hook 之外的机器执法）：**permissions deny/ask**——密钥文件 Read deny（连带挡 Edit/Write 与 Bash 内 cat/head/sed），`git push`/`gh release`/`npm publish`/`docker push` ask（bypassPermissions 下 ask 规则照样弹审批，HIGH 档机器化）；**statusLine**——`.claude/scripts/statusline.mjs` 常驻显示模型/context%/成本/档位（fast 剩余）/待审数/harness 开关；**env**——`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=25`（Stop 闸原生 8 次强制放行上限提额；stop-gate 自身三振熔断先触发，此为兜底边界）。

---

## 8. 项目记忆 + 反馈进化（多套记忆系统各司其职）

- **项目记忆**：`progress-recorder` agent 维护项目根目录的 `progress.md`（决策/约束/完成/待办/风险），Notes 与 Done 合计 >100 或 Decisions >30 即归档到 `progress.archive.md`，Pinned 封顶 15 条。指令 `/record` `/archive` `/recap`。记录类角色（progress-recorder / feedback-observer）可用 fork 形态派发（`subagent_type:"fork"` 继承主对话全文），免主 Agent 转述失真。
- **反馈进化**：用户修正 AI 行为 → `feedback-observer` 写 `.claude/feedback/` → `evolution-runner`（session 初始化自动派发；skill 已声明 `context: fork` 后台运行不阻塞开场）扫描并生成进化建议 → 用户逐条确认后改进 Skill/规则。
- **领域口径**：项目根 `domain/`（可选，副产品）记「这个域里事情怎么算」，跟领域走不跟仓库走——采集寄生在 Sub-Agent 回执的 Domain findings 栏（真有发现才提醒），收录派 `domain-recorder`，人机入口 `/domain-rulings`（四象限分诊 / 查现行值 / 待复核 / 看依赖 / 手工收录）。框架本体没有领域，没有 `domain/` 是正常的。细则 `.claude/rules/domain-rulings.md`。
- **角色记忆**：code-reviewer / tester 挂 `memory: project`（Claude Code 原生 agent memory）——跨会话积累本项目高发缺陷模式 / flaky 区，审查测试越用越准；角色自维护，不承载框架规则与项目事实。

> ⚠️ feedback（改进框架）、memory（跨 session 用户偏好）、agent memory（角色战术笔记）、原生 auto memory（机器本地琐碎）是四套系统：用户修正行为必须走 feedback；决策/约束/完成只认 progress.md（auto memory 不豁免三文件同步铁律）。

---

## 9. 目录结构

```
project/
├── Product-Spec.md / -CHANGELOG.md      # 需求文档 + 变更记录
├── Design-Brief.md                       # 设计规范（可选）
├── DEV-PLAN.md                           # 分阶段开发计划
├── progress.md / progress.archive.md     # 项目记忆（根目录）
├── <project-name>/                       # 项目代码子文件夹
└── .claude/
    ├── CLAUDE.md                         # 主控
    ├── rules/                            # 主控下沉细则（file-structure / workflow-orchestration / dev-workflow-details / subagent-dispatch / memory-systems / domain-rulings；harness 两份随 --with-harness 装入）
    ├── agents/                           # 8 个专职 Sub-Agent
    ├── skills/                           # 18 个 Skill
    ├── hooks/                            # 21 个注册闸门（.mjs）+ static-check 工具 + lib/
    ├── harness/                          # 核心 harness.mjs + lib/{core,tier}.mjs + profile.json + audit/；引擎在 harness/ext/（可选包，--with-harness 才装，放 module-catalog.json 才启用）
    ├── workflows/                        # Workflow 脚本（code-review-fanout.js）
    ├── scripts/                          # 质量脚本（doctor / plan-lint / skill-lint / fast-mode（tier set 薄壳）/ fix-platform / gen-manifest / gate-audit / collect-feedback 收下游 feedback / statusline 状态行 / supervisor 进程守护）
    ├── tests/                            # 框架自测（selftest / test-setup / test-routing / 闸回归 / test-supervisor / cases）
    ├── feedback/                         # 已固化铁律 + 索引 + templates
    └── EVOLUTION.md                      # 进化引擎
```

运行时文件（`.claude/.needs-review`、`.claude/.runtime/`、`settings.local.json`）由 `.gitignore` 排除，不入库。**无安装步骤**——Claude Code 原生读 `.claude/`，无 daemon/tmux/CLI 工具要装。

---

## 9.5 大仓治理 harness（60 万行级 + 五性证据化）

引擎是可选包（`.claude/harness/ext/`，`setup.sh --with-harness` 才装；核心 `harness.mjs` 只静态加载 tier / doctor，其余子命令按需 import，没装以 rc 3 报 not installed），装后 catalog 存在才启用（唯一开关），十三个子命令三层展开：

- **定向层**（花小钱看清爆炸半径）：`impact` 反向依赖闭包 / `context-pack` 预算化上下文（DENY 密钥路径永不入包）/ `catalog-lint` 全量归类（UNMAPPED/OVERLAP/CATCH_ALL 全拦）。unmapped / global / 非 git / truncated 一律保守全 fanout——宁可全跑，不可漏测。
- **证据层**（口头承诺升级为机器可验证）：`receipt` diff-bound 审查回执（diff 变一字节即 stale，stop-gate 拦停）/ `verify` 四态质量门（缺命令 BLOCKED 不假绿）+ **五性覆盖门**（受影响模块声明的 critical/high 属性必须有 PASS 的认领 check，反证压过佐证）/ `waiver` 结构化豁免（security/safety 永不可豁免）。
- **防腐层**（架构不靠自觉守）：`arch-check` 真实 import 边对照声明图（越禁边 / 分层违规 / 依赖漂移 / 虚边 / 环）/ `adr-check` ADR 执法引用校验（幽灵引用 fail，manual 显式留痕）/ `arch-trend` 漂移棘轮（--record 快照 + --gate 新债零容忍，老仓带债接入路径）/ `attributes` 五性接线静态审计 / `fitness` 内置五性反模式规则 / `adapters` 外部工具按属性接线。

开发态韧性由 `scripts/supervisor.mjs` 兜底：长驻服务宕机自动拉起（指数退避）、健康探针治假活、重启风暴熔断 fail-visible。设计蓝本吸收自 cursor-base（五性分级 + arch-check + fitness）、codex-base（planHash/四态门审计法）、pi-base（有界扫描 + evidence 台账）四仓交叉授粉，取舍记录见 `.claude/research/`。

---

## 10. 设计原则速览

1. **最简优先**：默认直接 Task 派单；只在 fan-out 规模 + 高价值 + 用户 opt-in 时才上 Workflow。（Anthropic：「find the simplest solution possible, only increasing complexity when needed」）
2. **扁平编排**：主 Agent 唯一编排者，Sub-Agent 不自拉 Sub-Agent，workflow 嵌套仅一层。
3. **决策自洽轴定并行**：只读广度才并行；编码这类共享契约的串行。（Anthropic：coding「not a good fit」for multi-agent；Cognition「Flappy Bird」）
4. **验收以客观证据为准**：翻证据可外包，下判断留主 Agent。
5. **隔离即正确性**：fresh 实例 + 完整任务上下文（objective / 输出格式 / 工具与文件范围 / 边界）防错误假设跨 Task 传染。

**引用**：
- Anthropic《Building Effective Agents》——5 工作流模式 + 最简优先 — https://www.anthropic.com/research/building-effective-agents
- Anthropic《How we built our multi-agent research system》——15x token / 编码不适合多 Agent / orchestrator-worker — https://www.anthropic.com/engineering/multi-agent-research-system
- Cognition《Don't Build Multi-Agents》——并行 subagent 上下文割裂致决策冲突（Flappy Bird）
