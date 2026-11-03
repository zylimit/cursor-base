# 03 第一个项目：从想法到发布走一遍

这章解决：用一个小项目把框架的主路径走通。读完你能独立完成「想法 → Spec → 计划 → 开发 → 审查 → 发布」，并知道每一步框架会问你什么、给你什么、在哪里等你签字。贯穿示例是一个个人待办应用，记作 todo。

## 项目状态检测

在装好框架的项目根启动 Claude Code，横幅之后主 Agent 会按文件存在性判断你在哪一步：

```
📊 项目进度检测

- Product Spec：未完成
- Design Brief：未创建
- DEV-PLAN：未生成
- 项目代码：未创建

当前阶段：全新项目
下一步：描述你的想法，或直接调用 /product-spec-builder
```

判定规则只看四个文件是否存在：

| Product-Spec.md | DEV-PLAN.md | 代码目录 | 判定 | 下一步 |
|---|---|---|---|---|
| 无 | | | 全新项目 | 描述想法或 /product-spec-builder |
| 有 | 无 | 无 | Spec 已完成 | 交付指南，引导 /dev-planner |
| 有 | 有 | 无 | Plan 已完成 | /dev-builder |
| 有 | 无 | 有 | 缺计划 | 建议 /dev-planner |
| 有 | 有 | 有 | 开发中 | 继续开发、审查、修复或发布 |

## 第一步：说出想法，写出 Spec

直接用一句话开始：

```
我想做一个个人待办应用，能加任务、标完成、按日期看。
```

这句话会自动触发 product-spec-builder 的 0-1 模式。它不是问卷，流程是：

1. **先 WebSearch 领域与竞品**，不凭印象。
2. **问风险档位**：自用、内部、还是对外或涉钱涉合规。这一句决定后面问多少问题和 Spec 的长度：自用两页够，内部五到八页，对外按需求条目走。todo 自用，答「自用」。
3. **向你学业务**：它会追问现在你怎么记待办、什么情况下会漏、哪些例外。回答尽量给真实案例，不给抽象描述。
4. **写 Product-Spec.md**：按模板填「产品概述 → 应用场景 → 成功判据 → 功能需求 → 规则与例外 → 非目标 → 待定问题」。功能用「用户做什么 → 系统做什么 → 得到什么」写；每条标 `[确认]`、`[推断]` 或 `[默认]`。
5. **跑两道静态闸**：`node .claude/harness/harness.mjs spec-lint --file Product-Spec.md`（需装大仓包，没装会以 rc 3 报 not installed 并跳过）与 `node .claude/scripts/predev-lint.mjs`。红了先修。
6. **复述**：用你给的案例讲一遍上线后那次会怎么发生，末尾一句「那次是不是这样」。

你会看到：

```
✅ Product Spec 已生成！

文件：Product-Spec.md

---

[复述：明天早上你打开 todo，看到昨天没做完的三条自动排在最上面……那次是不是这样]
Spec 里 [推断] 2 条、[待定] 1 条（列出），不影响开工的已标押后。

## 📘 接下来

- 调用 /arch-designer 做架构设计（多模块 / 中大型项目推荐）
- 调用 /dfx-designer 做 DFX 设计
- 调用 /design-brief-builder 确定视觉方向（可选）
- 调用 /design-maker 生成完整设计稿（可选，需先完成 Design Brief）
- 调用 /dev-planner 制定开发计划（需先批准 Spec）
- 直接对话可以改 UI、加功能
```

**签字就是复述通过。** 你挑不出错等于批准，不会再来一句「请批准」。挑出错就说「第 X 条不对，实际是……」，它改完再复述一次。

todo 这种自用、功能不到六条、数据实体不到四个的项目，架构与 DFX 都可以跳过，直接下一步。判据在 Spec 生成完的建议里，也在 [04 需求与设计](04-requirements-and-design.md)。

## 第二步：开发计划

```
/dev-planner
```

它读 Spec，WebSearch 验证技术选型，按模板输出 DEV-PLAN.md：技术栈表、Phase 拆分（每个 Phase 能编译、能运行、能看到效果）、每个 Phase 的交付清单与要创建或修改的具体文件路径。不许 TBD、TODO、「待补充」这类占位符。

生成后它会跑：

```bash
bash .claude/scripts/plan-lint.sh
```

plan-lint 卡占位符残留、Phase 无验收标准、Spec 功能条目没被任何 Phase 覆盖。红了它自己修。你要做的是读一遍 Phase 顺序是否先交付核心价值。todo 的合理顺序是：Phase 1 加任务与列表、Phase 2 完成状态与按日期看、Phase 3 持久化与打包。

## 第三步：开发

```
/dev-builder
```

无代码目录时进初始化模式：按技术栈表建项目骨架（以项目名命名的子文件夹）、装依赖、开 TypeScript strict、`git init` 与首次提交，然后直接进 Phase 1。

每个 Phase 的过程是固定的，你会反复看到这个节奏：

1. 主 Agent 进 Plan Mode 列出本 Phase 的 TaskList，每个页面、组件或功能一个 Task。
2. **每个 Task 先定档**。判据机械：改动不到 50 行、不碰契约 / 解析器 / 鉴权 / 迁移 / 支付 / hooks 类路径、不引新依赖是 LOW；50 到 300 行或碰上述一类或引新依赖是 MEDIUM；超 300 行、碰两类以上、线上 bug、迁移、安全相关是 HIGH。拿不准按高一档。
3. **派 implementer**。主 Agent 会先说一句「派 implementer 静默运行，预计 N 分钟，完成会通知」，然后派单。派单包七字段（Goal / Scope / Out of Scope / Existing Pattern / Business Context / Verification / Escalation）你不需要写，但可以看：它决定了 implementer 能不能一次做对。
4. **验收**。LOW：主 Agent 读 diff 与运行器输出直接验收。MEDIUM：再派 code-reviewer 跑 Stage 0 与 Stage 1，只有 HIGH finding 阻断，修完同一轮复核一次即收口。HIGH：reviewer 全三 Stage，再派 tester 补关键逻辑测试。
5. `echo clean > .claude/.needs-review` 清待审清单，提交，下一个 Task。

Task 全部完成后过 **四步走**：Code Review 对照交付清单、测试完整性（派 tester）、编译验证（`tsc --noEmit` 零错或 `ruff check`）、功能测试（起 dev server、新功能可用、旧功能没坏）。中间有改动四步重来。收尾四态：PASS、CONCERNS（带残留清单前进）、FAIL（停下修）、WAIVED（写明理由与批准人）。然后它会问你确认 Phase 完成，再进下一个 Phase。

这一步里你最常做的三件事：

- **看派单包与回执**。回执首行是四态自评（DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED），后面是改了什么、验了什么、没验什么、业务假设、反例。`Not verified` 那一栏是你该多看一眼的。
- **回答反例**。implementer 或 reviewer 发现代码对得上 Spec 但 Spec 对不上业务时，回执会报「需求存疑」并给一个反例。主 Agent 会把它回流到 product-spec-builder 的迭代模式，改 Spec 与 CHANGELOG，签字后再继续。
- **改需求**。开发中说「加一个标签功能」会自动进迭代模式：问清为什么改、原来哪条判断错了、影响哪些已确认条目，改 Spec 并记 CHANGELOG，再更新 DEV-PLAN，再回到开发链。

## 第四步：审查、修复、测试

三个按需入口：

```
/code-review      主 Agent 派 code-reviewer 审一轮，报告给你，你定修复范围
/bug-fixer        报 bug 或说「报错了」会自动触发；定位、修复、建议再 /code-review 验证
/test-builder     为高价值逻辑补可重跑的回归测试；写测的实例与写代码的不同
```

审查的收敛规则：一轮只 HIGH 阻断，修完由同一位 reviewer 复核一次即收口；Medium 与 Low 记进 progress.md 残留，随后续 Task 顺手修。不会有第二位 reviewer 再开一轮。细节在 [06 审查、测试、修复](06-review-test-fix.md)。

线上行为的 bug 与核心解析器、契约的缺陷走 red-locks-the-bug：先派 tester 写一条失败测试锁定缺陷，主 Agent 亲眼看到它红，`touch .claude/.red-verified`（两小时内有效），再派 implementer 修绿。边角输入、参数花样、文案类不开红锁。

## 第五步：发布

```
/release-builder
```

这一条只能你亲自敲。主 Agent 口头听到「发布 / 打包 / 上线」会回指这个命令请你敲，因为发布是有副作用的动作，Skill 声明了 `disable-model-invocation`。

展开前 release-gate 会查待审清单：有没审的代码就拦；干净则注入发布卡点提醒。流程：问清打包还是发布、什么渠道、什么平台 → 确认版本号 → 构建打包 → 用实际产物目录跑隐私审计 → 从安装包装到系统目录测（Desktop）或部署后在线测（Web）→ 对照 Spec 冒烟。

部署派 deployer 执行，主 Agent 独立核查三件套后才算成功：容器创建时间戳与镜像 tag（不看 Up 时长）、健康检查端点、live 冒烟验证新功能产物。deployer 说「完成」不算数。细节在 [07 发布](07-release.md)。

## 贯穿始终的两件事

**记忆**。每出现决策、约束、完成事项，主 Agent 就派 progress-recorder 写 progress.md。你换了会话或 `/clear` 后敲 `/recap`，它读 progress.md、Product-Spec.md、CHANGELOG 三份恢复处境。看到「recap-on-dirty」提醒是因为工作树有未提交改动，先 recap 再继续。

**反馈**。你纠正它的工作方法时（「以后都先跑测试再说完成」），它会先把纠正落到当前产物与 progress.md，再派 feedback-observer 写进 `.claude/feedback/`，回你一句「这次纠正改了 X 文件 Y 段」。积累到一定程度 evolution-runner 会在会话开始时提议把反馈升级成规则。

## 常见坑

- **跳过 Spec 直接让它写代码**。它会先引导你写需求。硬要跳过，派出去的 implementer 缺 Business Context 只能猜，猜错的成本比写 Spec 高。
- **在派单还没回来时催**。派单是后台静默的，完成有桌面通知。主 Agent 确认挂死（CPU 0% 而时长仍涨）会主动报告，不需要你盯。
- **把「已派发」当「已完成」**。验收只认回执到手并核过证据。
- **在 strict 档派 implementer 被 tdd-gate 拦**。你改过 `.claude/` 下的文件本轮就是 strict。派单 prompt 不含 red-lock 关键词（bug / 修复 / 解析器 / 契约 …）的单子它不响；含关键词的红锁任务先验红，确实不该红锁的 `touch .claude/.tdd-exempt`（两小时内有效）。
- **发布时主 Agent 说「请你敲 /release-builder」**。这是设计，不是它偷懒。
