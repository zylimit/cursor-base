---
paths:
  - "Product-Spec.md"
  - "Product-Spec-CHANGELOG.md"
  - "DEV-PLAN.md"
  - "Architecture-Design.md"
  - "DFX-Spec.md"
  - "Design-Brief.md"
---

本文件由 CLAUDE.md 下沉；主控命中指针时必须完整读取本文件再行动，不得凭指针行猜测内容。

[工作流程]
    [需求收集阶段]
        触发：用户表达产品想法（自动）或调用 /product-spec-builder（手动）
        
        执行：调用 product-spec-builder skill
        
        完成后：输出交付指南，引导下一步

    [交付阶段]
        触发：Product Spec 生成完成后自动执行

        用户签字闸：签字的形式是 product-spec-builder 的 [复述理解]——用用户自己的案例讲一遍上线后那次会怎么发生，用户挑不出错即为批准；挑出错回 product-spec-builder 改完再复述。不另发「请批准」。没过复述不进 dev-planner。
        复述前先跑 `node .claude/harness/harness.mjs spec-lint --file Product-Spec.md` 与 `node .claude/scripts/predev-lint.mjs`（必需段齐、功能条目带 `[确认]/[推断]/[默认]`、待定问题表五格齐、无占位残留），红了先修再复述——机器能挑的错不拿给用户挑。

        输出：
            "✅ **Product Spec 已生成！**
            
            文件：Product-Spec.md
            
            ---
            
            [复述：按 Spec 用用户的案例讲一遍那次会怎么发生，末尾一个具体的「那次是不是这样」]
            Spec 里 `[推断]` N 条、`[待定]` M 条（列出），不影响开工的已标押后。
            
            ## 📘 接下来
            
            - 调用 /arch-designer 做架构设计（多模块 / 中大型项目推荐）
            - 调用 /dfx-designer 做 DFX 设计（把可靠性/安全性这些质量属性定成可验收指标）
            - 调用 /design-brief-builder 确定视觉方向（可选）
            - 调用 /design-maker 生成完整设计稿（可选，需先完成 Design Brief）
            - 调用 /dev-planner 制定开发计划（需先批准 Spec）
            - 直接对话可以改 UI、加功能"

    [架构设计阶段]
        触发：用户调用 /arch-designer，或 Spec 批准后主 Agent 判为 M/L 档（多模块 / 有边界诉求 / 大规模）时建议

        执行：调用 arch-designer skill（文档类，主 Agent 直接执行）——规模判档 → 模块划分推演 → 七大原则自检 + 关键场景走查 → 产出 Architecture-Design.md；L 档同步产出 .claude/harness/module-catalog.json 骨架并跑 catalog-lint

        完成后：
            "✅ **架构设计已生成！**

            文件：Architecture-Design.md[ + module-catalog.json 骨架]

            接下来：
            - 调用 /dfx-designer 做 DFX 设计（推荐）
            - 调用 /design-brief-builder 确定视觉方向（可选）
            - 调用 /dev-planner 制定开发计划（Phase 将按模块边界拆）"

    [DFX 设计阶段]
        触发：用户调用 /dfx-designer，或 arch-designer 完成后顺路建议

        执行：调用 dfx-designer skill（文档类，主 Agent 直接执行）——隐含合规扫描（行业词一出现法规就是需求）→ 13 维过堂（场景六要素 + 度量 + 对策 + 验证落点；S 档一行短式）→ 安全维威胁表（九类触发命中即必填）、Spec 有 AI 能力段则加自主性 / 审批门 / 熔断 / 成本上限 / 可追溯附加表 → 按模块定档 → 优先级栈排序 → 产出 DFX-Spec.md，跑 `node .claude/scripts/predev-lint.mjs` 不过先修；有 catalog 则写 modules[].attributes + adapters 接线建议 + 跑 attributes 子命令确认缺口。用户说"DFX 评审"则走评审模式只出评分卡

        完成后：
            "✅ **DFX-Spec 已生成！**

            文件：DFX-Spec.md[ + module-catalog attributes 已定档]

            接下来：
            - 调用 /design-brief-builder 确定视觉方向（可选）
            - 调用 /dev-planner 制定开发计划（DFX 验证手段会进各 Phase 验收）"

    [设计规范阶段]
        触发：用户调用 /design-brief-builder
        
        执行：调用 design-brief-builder skill（文档类，主 Agent 直接执行）——从使用情境与首要动作出发采访，形态先于视觉，方向样张让用户选；两份产物：Design-Brief.md（体验脊柱：信息架构 / SCREEN 规格与八态 / 交互原语 / 文案 / 可访问性与响应式）+ DESIGN.md（Google design.md 规范：前言 token + 八段视觉规则，下游代码直接读 token）；生成后跑 `node .claude/scripts/predev-lint.mjs`（SCREEN 编号、必需状态与响应式、DESIGN.md 前言与段顺序、记号可解析），不过先修
        
        完成后：
            "✅ **Design Brief 已生成！**
            
            文件：Design-Brief.md + DESIGN.md
            
            接下来：
            - 调用 /design-maker 生成完整设计稿（可选）
            - 调用 /dev-planner 制定开发计划
            - 跳过设计稿也可以，后续按 DESIGN.md 的 token 与 Brief 的页面规格开发"

    [设计图制作阶段]
        触发：用户调用 /design-maker
        
        执行：调用 design-maker skill——先出 3 个首屏方向样张让用户选，再两遍法（token 计划 → 对照 Brief 查「默认」→ 生成），DESIGN.md 的 token 进 prompt，每个 SCREEN 覆盖八态；验收跑 `node .claude/scripts/ui-audit.mjs <设计稿目录> --strict`（空白 / 溢出 / 折行 / 对比度判红，本机无浏览器引擎时 rc 3「UI 审计缺席」不算通过）+ AI 通病自检 + 质量地板抽查
        
        完成后：
            "✅ **设计稿已完成！**
            
            设计文件已通过设计工具生成，覆盖所有页面和状态变体。
            
            调用 /dev-planner 制定开发计划。设计稿会作为 Phase 拆分和编码实现的核心参照。"

    [开发计划阶段]
        触发：用户调用 /dev-planner
        
        执行：调用 dev-planner skill
        
        生成后跑 `.claude/scripts/plan-lint.sh` 静态校验（禁 placeholder / Phase 结构 / Task 粒度），不过先修再往下走
        
        完成后：
            "✅ **DEV-PLAN 已生成！**
            
            文件：DEV-PLAN.md
            共 N 个 Phase。
            
            调用 /dev-builder 开始开发。"

    [项目开发阶段]
        触发：用户调用 /dev-builder
        一条链：dev-builder skill 进 Plan Mode 列出当前 Phase 的 TaskList → 每个 Task 先定档再派发（主 Agent 按 `git diff --stat` 与触及路径机械判，三条任一命中即升到对应档，拿不准按高一档；派单包 Goal 首行写明档位）：
          · **LOW**（改动 < 50 行，不碰契约 / 解析器 / 鉴权 / 迁移 / 支付 / hooks 类路径，不引新依赖）：派 implementer 一单 → 它自检 + static-check + 跑现有测试 → 主 Agent 对着 diff 与运行器输出验收 → commit。不派 reviewer，不派 tester。
          · **MEDIUM**（50 到 300 行，或碰上述路径之一，或引新依赖）：implementer → code-reviewer 一轮只跑 Stage 0 + Stage 1（做对了没有）→ 只 HIGH 阻断，修完由同一轮复核一次即收口 → commit。
          · **HIGH**（> 300 行，或碰两类以上上述路径，或线上 bug / 数据迁移 / 安全相关）：implementer（派单传 `model: opus`）→ code-reviewer 全三 Stage → 有 HIGH 派修 + 同一轮复核 → tester 补关键逻辑测试（写测 ≠ 作者）→ commit。
        任何档的 Medium / Low finding 记进 progress.md 残留随后续 Task 顺手修，不开新一轮；回执带反例或报告含「❓ 需求存疑」则调 product-spec-builder 迭代模式（反例进 Spec 的规则与例外，签字后回流本链）。同一套流水线一律套全档是 2026-09-15 前的写法，被这张表取代：审一个小 diff 便宜，贵的是仪式。
        所有 Task 完成 → Phase 四步走验证（dev-builder SKILL.md [Phase 完成度判断]；第 2 步「测试完整性」派 tester，重点看跨 Task 的导入关系、文件依赖、命名一致性；发现问题派 bug-fixer 修、`fix:` 提交、四步重来）→ 四态门收尾（PASS / CONCERNS / FAIL / WAIVED）→ 用户确认 Phase 完成 → 进入下一个 Phase，或提示可调用 /release-builder。
        手动入口：用户调 /code-review → 派 code-reviewer 审一轮 → 报告给用户，由用户定修复范围；用户调 /bug-fixer 或报 bug → bug-fixer skill 修复 → 修完建议 /code-review 验证。用户可随时介入切手动模式。

    [发布阶段]
        触发：用户调用 /release-builder（skill 设 disable-model-invocation，主 Agent 不代触发，回指该命令请用户亲自敲）
        执行：release-gate 先查待审清单与测试卡点，未过不许打包；打包 / 构建 / 部署派 deployer Sub-Agent 执行。
        验收：主 Agent 独立核查三件套（镜像 tag + 容器创建时间戳、健康检查端点响应、live 冒烟验证新功能产物），deployer 的自报状态不作判据；通过后展示发布结果。

    [本地运行阶段]
        触发：用户说"帮我跑起来"、"启动项目"、"运行一下"等
        执行：自动检测项目类型，安装依赖，启动项目
        输出："🚀 **项目已启动！** **访问地址**：http://localhost:[端口号] [根据 Product Spec 生成简要使用说明]"

    [内容修订]
        当用户提出修改意见：调 product-spec-builder 迭代模式按其 [交互深度分档] 判档，确认档以上先问三件事（为什么改、原来哪条判断错了、影响哪些已确认条目）→ 成对更新 Product-Spec.md（标记与来源、澄清记录）与 Product-Spec-CHANGELOG.md（为什么改、原判断哪里错、影响）→ **用户签字闸**：复述改后那次会怎么发生，用户挑不出错即批准，直推档复述一句即过；没过复述不更新开发计划。
        签字后：调 dev-planner 迭代模式更新 DEV-PLAN.md（不存在则创建）并点明影响哪些 Phase / Task → 派 implementer 改码 → 走 [项目开发阶段] 同一条 review → fix 链 → 四步走验证 → 用户确认完成；之前已打包发布过的，提醒重新 /release-builder。

[各 Skill 执行方式]
    由 CLAUDE.md [Skill 调用规则] 下沉：触发条件在主控一行一个，这里是每个 Skill 的自动 / 手动入口、前置条件与执行方式原文。

    [product-spec-builder]
        **自动调用**：
        - 用户表达想要开发产品、应用、工具时
        - 用户描述产品想法、功能需求时
        - 用户要修改 UI、改界面、调整布局时（迭代模式）
        - 用户要增加功能、新增功能时（迭代模式）
        - 用户要改需求、调整功能、修改逻辑时（迭代模式）
        **手动调用**：/product-spec-builder

    [arch-designer]
        **自动调用**：
        - Product-Spec 批准后判为 M/L 档（多模块 / 有边界诉求 / 大规模）时建议调用
        - 用户说"架构设计"、"模块划分"、"技术架构"、"分层"、"架构评审"时
        **手动调用**：/arch-designer
        前置条件：Product-Spec.md 必须存在
        执行方式：文档类 skill，主 Agent 直接执行（同 product-spec-builder）；产出 Architecture-Design.md，L 档同步产出 `.claude/harness/module-catalog.json` 骨架接通 arch-check 架构防腐闸

    [dfx-designer]
        **自动调用**：
        - arch-designer 完成后建议顺路做 DFX 定档
        - 用户说"DFX"、"非功能需求"、"质量属性"、"可靠性/可测试性/可服务性设计"、"威胁建模"、"DFX 评审"时
        **手动调用**：/dfx-designer
        前置条件：Product-Spec.md 必须存在（Architecture-Design.md 可选，有则按模块定档；Design-Brief.md 可选，有则交互能力引用它的地板）
        执行方式：文档类 skill，主 Agent 直接执行；设计模式产出 DFX-Spec.md（13 维 + 合规表 + 威胁表）并把档位落进 catalog attributes + adapters 接线；评审模式只出评分卡不改文件

    [design-brief-builder]
        **手动调用**：/design-brief-builder
        前置条件：Product-Spec.md 必须存在
        执行方式：文档类 skill，主 Agent 直接执行；两份产物 Design-Brief.md + DESIGN.md，迭代模式按 Spec 变更分类回改对应段；生成后跑 predev-lint

    [design-maker]
        **手动调用**：/design-maker
        前置条件：Product-Spec.md 和 Design-Brief.md 必须存在（DESIGN.md 有则 token 进 prompt）；只做逻辑沙盘时有 Product-Spec.md 或会话里已确认的规则片段即可
        执行方式：方向样张 → 两遍法生成 → 八态覆盖 → `ui-audit.mjs --strict` 验收；无浏览器引擎时报「UI 审计缺席」，人工核对截图不冒充机器通过；逻辑沙盘按 SKILL.md [逻辑沙盘入口] 单独走，只回答一个业务状态或规则问题，不出方向样张、不跑八态；生成路 odc 优先，用户主动点名 Claude Design 才走画布模式（画完把画布文件全部拉回 `demo/canvas/` 入库，源文件算编码的一部分），主动要提示词才走提示词模式

    [dev-planner]
        **手动调用**：/dev-planner
        前置条件：Product-Spec.md 必须存在

    [dev-builder]
        **手动调用**：/dev-builder
        前置条件：Product-Spec.md 和 DEV-PLAN.md 必须存在

    [bug-fixer]
        **自动调用**：
        - code-review 发现问题后，自动调用修复（review → fix 闭环的一部分）
        - 用户报告 bug、功能异常、编译错误、运行时错误时
        - 用户说"这个功能坏了"、"报错了"、"不正常"时
        **手动调用**：/bug-fixer
        前置条件：项目代码已创建

    [code-review]
        **自动调用**：
        - 每个功能开发完成后，自动进入 review → fix 闭环
        - 用户要求代码审查、检查代码质量时
        **手动调用**：/code-review
        前置条件：Product-Spec.md 必须存在，项目代码已创建
        执行方式：派发 code-reviewer Sub-Agent 执行三阶段审查（Stage 0 静态闸 → Stage 1 规格合规 → Stage 2 代码质量），主 Agent 不自己审查（见 [Sub-Agent 调度规则]）

    [test-builder]
        **自动调用**：
        - dev-builder 四步走验证第2步「测试完整性」时，调用 test-builder 跑/补回归测试（真卡点）
        - per-Task review → fix 闭环中，Stage 1 规格通过后补关键逻辑测试（可选，按价值取舍）
        **手动调用**：/test-builder
        前置条件：项目代码已创建
        执行方式：务实回归——主 Agent 写测试提示词，**测试代码交独立方编写（写测≠被测作者：派 tester Sub-Agent，或非该功能作者的另一 implementer fresh 实例）**，主 Agent 独立复核运行输出后验收；测试失败按代码错/测试错分流（bug-fixer 修代码 / tester 修测试）

    [release-builder]
        **手动调用**：/release-builder（skill 设 disable-model-invocation——发布是副作用工作流，主 Agent 不能代触发；用户口头说"发布/打包/上线"时，主 Agent 回指该命令请用户亲自敲，这是 HIGH 档显式人触发的机器化）
        前置条件：项目代码已创建
        执行方式：用户敲命令时 release-gate hook 先查待审清单（未清直接拦、干净则注入卡点提醒）；打包前先过测试卡点（复用 test-builder 作前置闸门，证据=运行器真实输出，卡点未过不许打包交付）；部署派发 deployer Sub-Agent 执行，主 Agent 不亲自执行、只验收（独立核查三件套，见 [总体规则] 验收铁律）

    [red-blue-review]
        **自动调用**：
        - 发版 / 合并分支前，对高风险或家底（hooks / skills / CLAUDE.md / agents）改动建议过一遍
        - 用户说"红蓝审查"、"对抗审查"、"检视改动"时
        **手动调用**：/red-blue-review
        前置条件：有一批已成型的改动（已 commit 或工作树未提交）
        执行方式：主 Agent 编排 Blue → Red → Judge 三遍——跑 red-blue-review.sh 凑证据包 → 派 implementer 做 Blue 自证（仅作靶子）→ 派 code-reviewer（fresh，独立于 Blue）做 Red 四 lens 攻击（correctness / security / release / windows，每 finding 须附复现路径或 file:line）→ 主 Agent 自己 Judge 裁定（只看证据），出 ACCEPT / FIX_REQUIRED / NEEDS_MORE_EVIDENCE 填进 RED-BLUE-REVIEW.md

    [branch-finisher]
        **自动建议**（skill 设 disable-model-invocation，主 Agent 只建议不能代触发——合并/清分支是副作用工作流，须用户亲自敲命令）：
        - Phase / 功能完成后，建议用户敲 /branch-finisher 收尾当前开发分支
        - 用户说"收尾"、"合并分支"、"这个分支弄完了"时，回指 /branch-finisher 请用户确认触发
        **手动调用**：/branch-finisher
        前置条件：项目代码已创建
        执行方式：先检测环境状态，测试全绿为前置闸门；据状态给出条件化菜单（合并 / 提 PR / 清理分支），按用户选择执行

    [skill-builder]
        **自动调用**：
        - EVOLUTION.md 第四层提议创建新 Skill，用户确认后
        **手动调用**：/skill-builder
        前置条件：无
        新建或改 skill 后跑 `node .claude/harness/harness.mjs skills-lint` 校验 description（CSO，触发式开头、≤180 字），不过先修

    [domain-rulings]
        **自动调用**：用户说"记一条"、问"现在按什么算"、要列待复核或看某条被谁依赖时
        **手动调用**：/domain-rulings
        前置条件：无（domain/ 不存在就是库还没开张，查询回一句「还没有条目」，不报错）
        执行方式：主 Agent 自己走这个 skill——四象限分诊要对着人一问一答，派 sub-agent 就问不成了；要写库一律派 domain-recorder，本 skill 不碰 domain/ 里的文件。不进四步走、不在任何验收链路上

    [feedback-writer]
        由 feedback-observer sub-agent 调用，不由用户直接触发
        执行方式：永远通过 feedback-observer sub-agent 执行

    [evolution-engine]
        **自动调用**：session 初始化时自动派发 evolution-runner sub-agent
        **手动调用**：/evolution-engine
        执行方式：永远通过 evolution-runner sub-agent 执行（skill 已声明 `context: fork` + `agent: evolution-runner`——直接调 skill 也会自动落到该 sub-agent 后台运行，不阻塞开场；建议返回后仍逐条展示给用户确认）

    [progress-recorder]
        **自动调用**：出现决策/约束/完成/新任务语言时立即触发（条件见 [项目记忆规则]）
        **手动调用**：/record /archive /recap-project，三条各有同名 skill 作入口；不带斜杠的 recap 仍可用，带斜杠的 /recap 是 Claude Code 自带命令、到不了框架
        执行方式：record 派 progress-recorder sub-agent 执行，archive 主 Agent 跑 progress-archive.mjs（脚本不在才派 sub-agent 手工搬），recap-project 主 Agent 直接读 progress.md + Product-Spec.md + Product-Spec-CHANGELOG.md（只读 progress.md 不算恢复完成；三份存在即读，不存在的跳过不报错）

[项目进度检测显示格式]
    显示格式：
        "📊 **项目进度检测**
        
        - Product Spec：[已完成/未完成]
        - Design Brief：[已生成/未生成/未创建]
        - DEV-PLAN：[已生成/未生成]
        - 项目代码：[已创建/未创建]
        
        **当前阶段**：[阶段名称]
        **下一步**：[具体指令或操作]"

