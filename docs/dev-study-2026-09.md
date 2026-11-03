# 开发阶段吃透与改造设计（2026-09-10）

范围：开发计划 → 编码 → 修复 → 审查 → 测试 → 发布，对应 dev-planner / dev-builder / bug-fixer / code-review / test-builder / release-builder 六个 skill、四个执行型 agent、subagent-dispatch 与 dev-workflow-details 两份 rules。前期四步的报告见 docs/predev-study-2026-09.md，本篇方法相同。

前提（用户拍板，progress.md 2026-09-10 Decisions）：向 5.0 的体量靠，但有底线——主 Agent 不亲自编码 / 审查 / 测试 / 部署、完成只认当场证据、安全护栏、业务理解桥梁（派单包 Business Context 与回执反例）、联网优先与查证后再结论、记账随代码提交、家底改动由用户拍板、测试 1/3～1/2 按风险、审查一轮收敛。

## 0. 结论

1. **我们是 4.0 的血统，5.0 已经替我们做过一次减法。** 同一作者从 4.0 到 5.0 把五个开发 skill 从 1412 行砍到 310 行，主控从 364 到 166，砍的是分步剧本、面向用户的话术模板、输出风格三段式、通用工程教科书（目录树 / 默认技术栈 / 拆分信号）、反合理化清单、宿主工具名、能 hook 化的叮嘱；留的是每条第一性原则、每个带数字的标准、事故沉淀的具体反模式，hook 反而变长。我们的开发 skill 现在 1546 行、主控加 rules 数千行，与 4.0 同一层的东西一样不少，还多了三层后来长出来的：桥梁改造（派单包七字段、回执信封、反例回流）、五步闸与红锁、大仓治理的接线。
2. **业界一手源在核心机制上高度一致，差别只在编排的重量。** Superpowers、BMAD、Spec Kit、Anthropic 官方、插件经理五家都做到：spec / brief 是子代理唯一的需求来源（不给摘要）；fresh 子代理执行、fresh 子代理审查、控制者只裁定；完成只认当场跑出的证据；诊断先于修复、三次不绿停下质疑架构；修复回路有硬上限；审查发现分级、只有真缺陷进回路、其余记账不追。差别在：Superpowers 用 5 轮修复上限 + 控制者裁决的账本；BMAD 用 spec 冻结区 + 四类路由（意图缺口 / 坏 spec / 补丁 / 押后）+ 5 次回环上限；插件经理用「两轮无新证据即停」+ 角色封顶结论词；5.0 用 3 次失败停 + Stop hook 兜底。我们现有的「red-lock → 修 → fresh reviewer → 再红锁」无上限循环是五家里最重的，今天已按用户纠正收成「一轮、只 HIGH 阻断、复核一次即收口」。
3. **改造方向**：每个 skill 只留「原则 + 标准 + 事故反模式 + 一行箭头链」，目标行数向 5.0 靠但不追平（我们比它多的底线机制要占行）；流程编排只在 dev-workflow-details 写一遍，skill 不复述；agents 保留四个执行角色（这是底线，不是 5.0 的两个），但每个压到 30 行内；机器闸不增反减，已在减重第一批做完。

## 1. 材料与证据

| 源 | 读法 | 抽取 |
|---|---|---|
| 毒舌产品经理 5.0（claude / codex 两版） | 主 Agent 亲读主控 166 行、五个开发 skill 310 行、六个 hook 170 行、agent 与 settings；Explore 代理逐 skill 对照 4.0 | /tmp/dev-study/A-5.0-vs-4.0.md |
| 毒蛇产品经理 4.0 / 3.0 | 代理逐行读五个开发 skill 与主控；3.0 看开发最初的样子 | A、B |
| 插件经理三版（claude / codex / DeepSeek harness） | 代理读四个开发阶段 skill 及 references / templates、146 行 harness 守卫、状态机、checklist 110 条、review-protocol | /tmp/dev-study/B-plugin-harness-others.md |
| script-breakdown | 长任务分块、重做协议、run-log、阶段报告模板 | B §4 |
| Superpowers | 主 Agent 亲读 verification-before-completion / systematic-debugging / test-driven-development / writing-plans / executing-plans / subagent-driven-development / finishing-a-development-branch 原文 | /tmp/dev-study/raw/sp-*.md |
| BMAD v6 bmad-build | 亲读 spec-template、step-02 plan、step-03 implement、step-04 review、verification-gap 审查层 | raw/bmad-build-*.md |
| Spec Kit | 亲读 plan / implement 命令 | raw/speckit-cmd-*.md |
| Anthropic 官方 | 亲读 best-practices「给 Claude 一个能跑的检查」「先探索再计划再编码」「加一步对抗审查」「常见失败模式」，sub-agents 文档结构；官方插件 feature-dev、code-review、silent-failure-hunter、pr-test-analyzer、ralph-loop、commit-push-pr | raw/anthropic-*.md、raw/cc-plugin-*.md |
| 我们自己 | 亲读六个 skill、四个 agent、dispatch 与 workflow 两份 rules | /tmp/dev-study/D-ours-inventory.md |

## 2. 4.0 → 5.0 的刀法（按内容类型）

| 内容类型 | 4.0 | 5.0 | 我们现状 |
|---|---|---|---|
| 分步剧本（第 N 步 / 阶段 / 子步） | 每 skill 40～90 行 | 一行箭头链 | dev-builder 两套工作流程 13 子步、dev-planner 五阶段 17 步、release 八步、bug-fixer 四阶段 + 三段工作流程 |
| 面向用户的话术模板 | 每 skill 1～2 个 | 0 | dev-planner / dev-builder / bug-fixer / release 各留有「✅ / 🔧 / 🚀」模板 |
| 输出风格三段式 | 15～20 行 | 1～3 行或删 | 09-09 bridge-D 已删语态块 |
| 通用工程教科书（目录树、默认栈、拆分信号、扩展性） | dev-builder 100+ 行 | 0 | dev-builder 五棵目录树 60 行、技术栈默认表两处、拆分 / 不拆信号、扩展性五条 |
| 反合理化 / 借口清单 | 26 行 | 0，改一句禁令 + Stop hook | dev-builder 反合理化 27 行；主控「逃逸借口拦截」 |
| 宿主工具名 | 有 | 无（两宿主 skill 逐字节同） | TaskCreate / TaskUpdate / Grep output_mode / gh auth login 散见 |
| 可 hook 化的叮嘱（进程清理、push、编译门槛） | 散文 | hook + 一句「由 hook 处理」 | 我们两边都有：hook 也有、散文也有 |
| 第一性原则 | 4～6 条 | 4～10 条 | 保留 |
| 带数字的标准 | 有 | 逐条保留 | 保留 |
| 事故沉淀反模式 | 少 | 净增长 | 我们的 feedback/ 目录是同一件事 |

5.0 新增而我们没有的具体条目（全是事故沉淀，每条一句，值得原样吸收）：
- 修改纪律：改被多处引用的东西先 grep 全项目一次清理；改完跑全套测试不只 typecheck；持久化数据的存量迁移 + 迁移测试（`5.0 dev-builder:23`）
- 测试隔离：跑真实 app 的测试必须独立数据目录，收尾清理（`:26`）
- 真实优先：不写死、不假数据、不留装饰；零先例 UI 元素默认不引入（`:28`）
- 喂模型不截断：给人看的可截，喂模型的全量（`:33`）
- 进已有项目先读它的 AGENTS.md / CLAUDE.md（`:16`）
- 四步走第二步「测试真实性」：核对用例前提与生产一致（量纲、输入可达、断言方向），错误态空态边界要真走到（`:92`）
- 审查加「引导真实性」（死引导算未实现）、「测试真实性」、「视觉对比」打开邻居页面实比（`code-review:31,36,39`）
- 修复路由：Stage 2 的质量与重构回 dev-builder 自修，缺陷与安全才回 bug-fixer（`:50`）
- 发布：卡住先诊断——CPU 0% 而运行时长涨即死锁；pnpm 符号链接依赖树；.npmrc 声明 ≠ node_modules 实际布局（`release:23`）
- dev-planner 命名纪律：Phase 编号只指技术阶段，对用户说业务阶段用功能名（`:44`）

## 3. 业界一手源的核心机制（原文 + 位置）

### 3.1 完成的定义
- Superpowers `verification-before-completion:17`「NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE」，五步闸 `:25-35`（IDENTIFY → RUN → READ → VERIFY → ONLY THEN），「Agent completed 要看 VCS diff，不看 agent 说 success」`:47`。我们的五步闸就是这个。
- Anthropic best-practices `:27-50`：给 Claude 一个能跑的检查（测试 / 构建退出码 / 截图对比），四档卡法——同一 prompt 内迭代 / `/goal` 条件 / Stop hook（连续 8 次 block 后系统放行）/ fresh 子代理反驳；「要证据不要断言」。
- BMAD `step-03-implement`「Judge against the diff, not against the implementation subagent's report」；矩阵里每行要有跑过且通过的测试，「存在但没跑的测试算缺」；「测试与矩阵不一致永不改期望迁就代码」。
- 插件经理：builder 只能到 Task done、reviewer 只能到候选、主 Agent 依真机证据判 SHIPPABLE（B §1.3、F3）；每份证据六字段、每条 Check 九字段。

### 3.2 派单与上下文
- Superpowers `subagent-driven-development:251-271`：派单只给「一句定位 + brief 文件路径 + 前序任务的接口决定 + 歧义裁定 + 报告文件路径」，精确值只在 brief 里；「不要把前面 1-3 个 Task 的总结贴进后面的派单——真实会话里一份派单 42k 字符 99% 是粘贴的历史」。
- BMAD `step-03`「spec 是子代理唯一的真相源……不要往派单里加目标复述、文件清单、验收标准、house-style 规则」；子代理自己加载 `context:` 文件。
- 插件经理派单包五件：Spec / Design 原文、Task ID + 完成标准、允许改的文件、禁止改的契约、验证命令（B §1.1）。
- Anthropic sub-agents：子代理有自己的上下文窗口；`skills:` 字段把 skill 全文注入子代理启动上下文。
- 我们的七字段派单包与此一致，多出的 Business Context 是底线；「每单 ≤ 6 次工具调用、只给文件:行 + 改成什么 + 一条验证命令」是用户 09-06 纠正，与 Superpowers 的 brief 精神同向。

### 3.3 审查与修复回路
- Superpowers `:354-429`：Minor 记账不进回路；每轮 = 一次修 + 一次范围化复审；五轮上限，1-3 轮 resume 原实现者、4-5 轮换更强模型 fresh；到顶后控制者逐条裁决（reviewer 错就 park、真但不承重就 park、承重就裁最小改动继续），每条裁决进账本，「静默丢弃是禁止的」；最终整分支审查只给一次修 + 一次复审，「per-finding 各派一个修复者的成本超过全部 Task 之和」。
- BMAD `step-04`：所有审查层同时跑；每条 finding 由控制者亲自核实（去看那一行到底发不发生）并给唯一裁定 high / medium / low / false / maybe-false；按根因分组；四类路由——intent_gap 回人、bad_spec 改 spec 重推、patch 让同一实现者最小改、defer 记 deferred-work.md；「review_loop_iteration 超过 5 次 HALT」；「审查子代理给的严重度一律无视，它们没有上下文分级」。
- Anthropic best-practices `:551`：「被要求找缺口的 reviewer 通常会报一些，哪怕工作没问题；追每条会导致过度工程——多余抽象层、防御代码、为不可能的情况写测试。告诉 reviewer 只报影响正确性或既定需求的缺口，其余可选」。官方 code-review 插件 `:41-51`「只要 HIGH SIGNAL：编译不过、逻辑必错、可引用原文的 CLAUDE.md 违反；不确定就不报，误报侵蚀信任」；每条 finding 再派子代理验证后才保留。
- 插件经理：「同一 failure 连续两轮修复仍无新证据 → 停」；Finding 六要素、REQUIRED / IMPORTANT / SUGGESTION 不许混。
- 5.0：HIGH 停 Stage 1；Stage 2 质量自修、缺陷才 bug-fixer；Stop hook 兜底。

### 3.4 调试
- Superpowers `systematic-debugging:17`「NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST」；四阶段（根因调查 / 模式分析 / 假设验证 / 实施）；多组件系统先在每个边界加诊断再修 `:70-106`；「≥3 次修复失败停下质疑架构，不许第四次」`:191-212`；「95% 的『无根因』是调查没做完」`:275`。
- 5.0 与我们的 bug-fixer 同源（3 假设、3 次失败停、一次一个）；我们多「先定预期再进代码」（业务桥梁）与「修复熔断把红测试一并交出去」。

### 3.5 测试
- Superpowers TDD `:33`「NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST」；必须亲眼看它红（`:113-128`）；「先写后测的测试一次就绿，什么都证明不了」。
- BMAD `rp-verification-gap`：审查层专门找「改了行为却没有测试能挡住回归」——回归缺口 / 缺采用缺口 / 断裂验证缺口；「一个测试只有在正常跑且断言观察到变化时才算数」，跳过 / flaky / 只断言不抛 / mock 调用计数 / 快照 都不算。
- 官方 pr-test-analyzer：按行为覆盖不按行覆盖，每条建议给「它能抓住什么失败」并 1-10 评级，「不追学术完整性」。
- 用户今天的纠正：测试 1/3～1/2 按风险、分级执行、老化退休——与 pr-test-analyzer 的「关键路径优先、不追指标」同向，与 Superpowers 的「一切都 TDD」相反；红锁按用户裁定只给线上 bug 与核心解析器。

### 3.6 计划
- Superpowers `writing-plans`：假设执行者零上下文、品味存疑；每 Task 给文件（含行号）、Interfaces（Consumes / Produces 精确签名）、TDD 五步、commit；「No Placeholders」六条；自审三项（Spec 覆盖 / 占位扫描 / 类型一致）。我们的 dev-planner「可执行性标准」「命名一致性检查」就是从它来的。
- BMAD spec 模板：`<frozen-after-approval>` 冻结区（Intent / Boundaries / I/O 矩阵）只有人能改；Open Questions 必须清零才能离开 draft；Code Map 由代理调查填写「不要在实现时再讲一遍调查」；目标 900～1300 token，「超过 1600 上下文腐烂风险高」；route 分 oneshot（无意图缺口、无不可逆、改动小 → 只写 Intent 直接做）与 dispatch。
- Spec Kit implement：先查 checklists 有没有未勾项、有就停下问；tasks 分 Setup / Tests / Core / Integration / Polish，`[P]` 标并行，同文件必串行；每完成一项在 tasks.md 勾 `[X]`。
- Anthropic best-practices `:56-113`：探索 → 计划 → 实现 → 提交；「能用一句话描述 diff 的就跳过计划」。

### 3.7 长任务与恢复
- Superpowers `subagent-driven-development:131-153`：「对话记忆不会活过压缩，真实会话里丢了位置的控制者重派了整段已完成的 Task——观察到的最贵失败」；账本文件 `progress.md` 首行写计划名，`Task N: complete` 行即完成，「压缩后信任账本与 git log 而不是自己的记忆」。
- script-breakdown：run-log 一行一动作只记路径；重做协议固定顺序（备份 → 重生成 → 记账 → 汇报）；已有产物先报再问不静默覆盖；上游重做不级联下游只标失效（B §4）。
- ralph-loop 插件：Stop hook 把同一 prompt 喂回去直到完成承诺为真，「不许为了退出循环说假承诺」。
- 我们的 progress.md + precompact / postcompact 两 hook 是同一件事；今天已把「三文件同步」改为随代码提交、Stop 只提醒。

### 3.8 收尾
- Superpowers `finishing-a-development-branch`：先跑全套测试红了就停；三选一（本地合并 / 推 PR / 保留）由人定；丢弃只在人明说时且要键入 `discard`；合并后在合并结果上再跑一次测试。
- 官方 commit-push-pr：一条消息内完成建分支、提交、推送、开 PR。
- 5.0：auto-push hook，保护分支不自动推、失败必报。


### 3.9 C 抽取补充的三件事实（/tmp/dev-study/C-industry-dev.md）
- BMAD v4 的 QA gate 是四态门：PASS / CONCERNS / FAIL / WAIVED，「WAIVED only when waiver.active: true with reason/approver」，「security/data-loss P0 test missing → FAIL」；审查者只许写 story 的 QA Results 段、不改状态（`raw/bmad-v4-qa-gate.md:30-106`、`bmad-v4-review-story.md:88-111,242-263`）。C 的判断：四态门放在 Phase 收尾而非每个 Task，CONCERNS 允许带记录前进——这正对应用户「P2 / P3 顺手修、Medium / Low 记残留」的偏好。
- Anthropic 官方把三层分清：「CLAUDE.md instructions are advisory, hooks are deterministic」（best-practices `:231`）；「If Claude already does something correctly without the instruction, delete it or convert it to a hook」（`:564`）；Stop hook 「blocks eight times in a row without progress」后系统放行（hooks-guide `:1007-1018`）；「主控过长 Claude 会忽略一半」（`:563`）。
- 官方 code-review 插件与 feature-dev 的 reviewer 用置信度阈值：「Only report issues with confidence ≥ 80」（feature-dev-code-reviewer `:25-33`）；review-pr 按改动类型选审查器（测试文件改了才派 pr-test-analyzer、错误处理改了才派 silent-failure-hunter）（review-pr-cmd `:38-43`）。
- 跨源分歧里对我们最有用的一条：并行实现——Spec Kit 允许 `[P]`、Superpowers「Never dispatch multiple implementation subagents in parallel」、BMAD「Sequential execution only」；我们的 dispatch 规则已是「跨 Task 编码默认串行」，保留。

## 4. 对照现状：删什么、留什么、吸收什么

### 4.1 整层删（5.0 删了且没回补，我们也没有底线依赖）
- dev-builder：五棵逐栈目录树、技术栈默认表、拆分 / 不拆信号、扩展性五条、反合理化清单、两套工作流程的逐步复述、Phase 完成话术、进程管理散文（kill-dev-ports hook 已有）、多 repo 隔离段（feedback 已有，一句指针）。
- dev-planner：五阶段十七步的工作流程复述、话术模板、WebSearch 四条搜索词模板、技术栈默认表；模板里 90 行 Forge 示例。
- bug-fixer：四阶段 + 规则清单双写（合成一份调试标准）、进程 kill 代码块、每阶段汇报话术、完成模板。
- code-review：33 行报告模板、审查范围三种、宿主 Grep 说明、安全 grep 两处重复。
- release-builder：逐渠道命令、按框架产物目录表、按 OS 安装话术、八步工作流程与「🚀 发布就绪」模板；回退策略压成三行。
- test-builder：文件结构段、工作流程复述策略；scaffold 模板保留但压到一屏。
- 所有 skill 的 [文件结构] 段与 [初始化] 的重复路由。
- rules/dev-workflow-details 开发段：只留一份流程（一行箭头链 + 收敛判据），话术模板全删。

### 4.2 留（底线与带数字的标准）
- 主 Agent 不亲自编码 / 审查 / 测试 / 部署；四个执行 agent；写测 ≠ 被测作者；派单包七字段（Business Context 不许 N/A）；回执信封（业务假设 + 反例回流 Spec）；禁原样重试的升级阶梯。
- 五步闸；四步走（Code Review / 测试 / 编译 / 功能）与「中间有改动四步重来」。
- 审查一轮收敛只 HIGH 阻断（今天定）；red-lock 只给线上 bug 与核心解析器；修复熔断 3 次；测试 1/3～1/2 按风险、分级、老化；三分流（代码错 / 测试错 / Spec 错）。
- 发布：测试卡点、隐私审计绝对底线、安装后测试、部署验收三件套、`disable-model-invocation` 由人敲。
- 数字：300 行、3 假设、3 次失败、HIGH 停 Stage 1、tsc 零错误、4.5:1 对比度、72 小时 unpublish。
- dev-planner：价值与未知先行、每 Phase「验证的假设」、可执行性标准、待定表押后检查、Arch / DFX 输入、命名一致性、Spec 覆盖率。

### 4.3 吸收（每条一句，进对应 skill 的原则或标准）
- 5.0 的十条事故反模式（§2 末）。
- Superpowers：派单只给 brief 路径 + 接口决定 + 歧义裁定，不贴历史；Minor 记账不进回路；控制者裁决每条进账本、禁静默丢弃；「压缩后信任账本与 git log」；收尾三选一由人定、丢弃要键入 discard。
- BMAD：控制者亲自核实每条 finding 再裁定、子代理给的严重度不采信；finding 按根因分组、四类路由（意图缺口回人 / 坏 spec 改 spec / 补丁最小改 / 押后记账）；「对着 diff 判，不对着实现者的报告判」；存在但没跑的测试算缺。
- Anthropic：reviewer 只报影响正确性或既定需求的缺口，其余可选；能一句话描述 diff 的改动跳过计划；「主控过长 Claude 会忽略一半——已经做对的指令删掉或转成 hook」。
- 官方 code-review 插件：finding 再派一次验证才保留；置信度 ≥ 80 才报；不报「依赖特定输入的潜在问题」与风格；按改动类型选审查视角（改了错误处理才看静默失败、改了测试才看覆盖）。
- BMAD v4 四态门：Phase 收尾用 PASS / CONCERNS / FAIL / WAIVED，WAIVED 必带 reason 与 approved_by，安全 / 数据丢失类缺口不许 WAIVED——替换现在四步走的二值「通过 / 不通过」。
- 插件经理：角色封顶结论词（implementer 不许说「通过审查」、reviewer 不许说「可发布」）——写进 agents 的 Non-goals 各一句；「两轮无新证据即停」作为熔断的补充判据。
- script-breakdown：Phase 重做不级联下游、只标受影响 Task；已有产物先报再问。

### 4.4 不采纳（记理由）
- Superpowers 全量 TDD「没有失败测试不许写生产代码、写了就删掉重来」——与用户「测试 1/3～1/2 按风险」相反；红锁只给线上 bug 与核心解析器。
- Superpowers 五轮修复上限与 BMAD 五次回环——用户已定一轮收敛只 HIGH 阻断，三次熔断够用。
- BMAD 的 spec 冻结区与 900～1300 token 上限——我们的 Spec 是对话产物、有澄清记录与 CHANGELOG 成对改，不引入第二套冻结机制。
- Spec Kit 的 extensions.yml 钩子体系与逐语言 ignore 文件清单——通用教科书，联网优先能查。
- 插件经理的九字段 Check、110 条 checklist、七层测试金字塔、evidence/ 目录树——为插件宿主验证设计，对我们是过度防御；只取「角色封顶」与「两轮无新证据」。
- ralph-loop 式 Stop hook 无限喂回——与「一轮收敛」相悖；/goal 由用户显式用。
- 5.0 的「默认主 Agent 直做、临时派执行型子 Agent」——底线：编码 / 审查 / 测试 / 部署一律派 fresh 子代理。

## 5. 改造设计

### 5.1 体量目标
| 文件 | 现在 | 目标 | 说明 |
|---|---|---|---|
| dev-planner/SKILL.md | 314 | ≤ 110 | 原则七条 + 分析维度三层 + 策略四法一行一法 + 充足度 + 工作流程一行 + 迭代一行 + 命名纪律 |
| dev-planner/templates/dev-plan-template.md | 220 | ≤ 90 | 删 Forge 示例，模板 + 写作要点 |
| dev-builder/SKILL.md | 476 | ≤ 150 | 原则（含 5.0 六条事故反模式）+ 规则清单压缩 + 设计参照 + Phase 执行一行链 + 四步走 + 初始化模式四条 |
| bug-fixer/SKILL.md | 170 | ≤ 70 | 原则 + 调试标准（四阶段一段）+ 熔断 + 先定预期 + 工作流程一行 |
| code-review/SKILL.md | 220 | ≤ 110 | 原则 + Stage 0/1/2 维度（加引导真实性 / 测试真实性 / 视觉对比）+ 业务含义核对 + 报告分组与 Priority + 修复路由 |
| test-builder/SKILL.md | 136 | ≤ 90 | 原则 + 维度清单（必测 / 推荐 / 不测）+ 三分流 + 完成度 + 区间与分级一句 |
| test-builder/templates/test-scaffold.md | 98 | ≤ 60 | |
| release-builder/SKILL.md | 230 | ≤ 100 | 原则（加卡住先诊断）+ 检查清单五类各一行 + 隐私审计三条 + 三渠道各一行 + 部署验收三件套 + 回退三行 + 工作流程一行 |
| agents/implementer,code-reviewer,tester,deployer | 61/69/55/51 | 各 ≤ 35 | 角色两句 + 任务 + Non-goals（加封顶结论词）+ 回执信封字段名 |
| rules/subagent-dispatch.md | 51 | ≤ 35 | 派单包七字段 + 回执信封 + 四态 + 升级阶梯 + 串行原则；fork / 模型分档 / 并行判据压成三行 |
| rules/dev-workflow-details.md 开发段 | 约 90 | ≤ 40 | 一行链 + 收敛判据 + 发布卡点；话术全删 |
| 合计 | 约 2100 | ≤ 900 | |

### 5.2 分批
- 批 1：dev-planner + 模板、dev-builder（最厚的两个）。
- 批 2：bug-fixer、code-review、test-builder + scaffold、release-builder。
- 批 3：四个 agents、两份 rules、CLAUDE.md 的 [开发测试规则] 与 [Sub-Agent 调度规则] 段只留指针；skills-lint、test-routing、run-all 跑绿；FRAMEWORK-MANIFEST 重生。
- 每批一个实现者按本设计改，主 Agent 亲读改后全文对照 §4.2 底线清单逐条核；不派 reviewer 轮（这是文档，不是代码；底线核对由主 Agent 做）。

### 5.3 验收判据
- 每个文件行数在目标内；§4.2 的每一条在改后文件里能指到原句；§4.3 每条吸收能指到落点。
- `node .claude/harness/harness.mjs skills-lint` 零发现；`bash .claude/tests/test-routing.sh` 通过；`bash .claude/tests/cases/run-all.sh` rc 0。
- 拿售后派单范例 Spec 走一遍 dev-planner 生成 DEV-PLAN（不写代码），plan-lint 通过——这是唯一的行为验证。

### 5.4 执行结果（2026-09-10）
| 文件 | 改前 | 改后 |
|---|---|---|
| dev-planner SKILL / 模板 | 314 / 219 | 84 / 77 |
| dev-builder SKILL | 476 | 91 |
| bug-fixer / code-review | 170 / 220 | 49 / 56 |
| test-builder SKILL / scaffold | 136 / 98 | 51 / 51 |
| release-builder SKILL | 230 | 57 |
| agents ×4 | 61 / 69 / 55 / 51 | 34 / 34 / 35 / 34 |
| rules/subagent-dispatch | 51 | 31 |
| rules/dev-workflow-details（整文件） | 327 | 260 |
| CLAUDE.md（整文件） | 190 | 182 |
| 合计 | 2667 | 1126 |

三批各一个实现者，主 Agent 亲读全文对 §4.2 逐条核，不派 reviewer 轮。裁决：dev-planner 充足度六条保留；模板补 **Task 清单**（plan-lint 锚点，旧模板从没给过，照抄必红）；主控调度表删 Allowed Skills 列（agents frontmatter 的 skills 字段才是真绑定）；主控两段没压到一半，七行表格 + 六条铁律是硬下限。闸：skills-lint 0、test-routing 过、rules-audit phantom 0、run-all high rc 0。
