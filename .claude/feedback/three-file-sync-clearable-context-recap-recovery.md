---
type: feedback
description: 三文件（Product-Spec.md / Product-Spec-CHANGELOG.md / progress.md）最大程度维护、即时同步，确保用户任何时候可 Clear 上下文、靠 recap 完整恢复项目状态；每次出现决策/约束/完成事项/新任务即时同步到对应文件，doc 类由主 Agent 直接维护（符合去中转精神）
created: 2026-06-10
updated: 2026-06-15
graduated: true  # 2026-06-10 毕业→CLAUDE.md [项目记忆规则] 三文件同步铁律（并调和 record 一律派 progress-recorder 的旧表述）；本文件留作细则参照
source_skill: N/A  # 项目记忆维护机制，跨 Skill 通用约束
priority: 铁律（用户连说三遍 + 强制进化，最高置信）
---

# 三文件同步：随时可 Clear 上下文，靠 recap 完整恢复

**问题描述**：
用户下达铁律——三个关键文件必须最大程度维护、即时同步：
- **Product-Spec.md**（产品需求）
- **Product-Spec-CHANGELOG.md**（需求变更记录）
- **progress.md**（项目状态 / 决策 / 约束 / 进度）

目的：用户要能在**任何时候**清空（Clear）上下文重来，恢复项目状态**完全靠这三个文件**（辅以 DEV-PLAN.md / Design-Brief.md / demo 作恢复点）。任何决策、约束、完成事项、新任务一旦产生，就要即时落到对应文件，不能积压在上下文里——上下文一清就丢。

**第 2 次（2026-06-15）——用户再下铁律：「三文件铁律要始终贯彻，不能有丝毫马虎。」**
强调的是**始终贯彻、零马虎**：不许只更新一个文件、不许事后补、不许攒着批量记；每个决策/约束/完成/需求变更发生当下就同步对应文件。
触发自查暴露的真实马虎点：本 session 多数把「决策」（版本号选择、用 Task 不用 Workflow、A1/A2/A3 取舍）记进了 progress.md 的 **Done 段**，没单独进 **Decisions 段**——决策类信息有漏记/混记倾向。决策被混进 Done 里，recap 恢复时看不清"为什么这么定"，判断容易脱基线。这正是"丝毫马虎"要堵的口子。

**触发场景**：
开发全流程任意时刻。只要对话中出现以下任一信号，即时同步对应文件：
- 产品需求变更 → Product-Spec.md + Product-Spec-CHANGELOG.md
- 项目状态 / 决策（决定用 X / 最终选择 / 将采用）/ 约束（必须 / 不能 / 要求）/ 进度（完成了 / 实现了 / 修复了）/ 新任务（需要 / 应该 / 计划）→ progress.md

**Why（为什么三文件即时同步、为什么不能有丝毫马虎）**：
用户的工作方式是「随用随清」——上下文窗口有限，长跑项目里会频繁 Clear 重来。如果关键信息只活在上下文里，Clear 即丢、recap 即残。唯有把决策/约束/完成/任务即时沉淀进这三份磁盘文件，才能保证「Clear → recap → 完整恢复」这条恢复链不断。这是用户敢于随时清空上下文的前提。
三文件是跨 session 恢复的**唯一依据**（呼应 recap 须读齐三份的规则）。少记一类——尤其 Decisions——会让恢复后的判断脱基线：看得到结果（Done）却不知道当初为什么这么定，复原出来的是残缺心智。攒着批量补 = 必然漏、必然失真：时过境迁回忆不全，混记一锅。所以"始终贯彻、零马虎"不是态度要求，是恢复链能不能用的硬前提。

**How to apply（怎么做）**：
1. **当下即同步，不积压、不事后补**：每次出现决策/约束/完成事项/需求变更，**发生当下**就写入对应文件，不攒着等批量、不"等会儿一起记"。
2. **分流落点**：
   - 产品需求变更 → 更新 Product-Spec.md，并在 Product-Spec-CHANGELOG.md 追加变更条目（**成对更新，缺一不可**）。
   - 项目状态/决策/约束/进度 → 更新 progress.md（项目根目录）。
3. **决策进 Decisions 段，别混进 Done**：决策类信息（决定用 X / 最终选择 / 将采用 / 取舍 A 不取 B）独立落到 progress.md 的 Decisions 段，**不混入 Done**——Done 只记"做完了什么"，Decisions 记"为什么这么定"，恢复时两者都要看得清。这是本次自查暴露的高频漏点，重点堵。
4. **doc 类由主 Agent 直接维护**：这三个文件属文档类，主 Agent 可直接写（符合「主 Agent 职责边界」铁律对文档类的豁免，也符合「去中转」精神——**不必每次都派 progress-recorder subagent**）。
   - 注：progress-recorder subagent 仍可用于较重的 record/archive 批处理（如阈值触发的归档），但日常即时小同步主 Agent 直接落盘即可，别为每条小更新起一个 subagent。
5. **每个工作单元收尾自检**：每个任务/回合收尾时自问「三文件都同步了吗？这条信息如果用户现在 Clear，recap 这三份能不能复原？决策有没有进 Decisions 而非混在 Done？」答否就补。

**关联**：
- 与 CLAUDE.md [项目记忆规则] 直接相关：该节已要求 progress-recorder 维护 progress.md 并定义 record/archive/recap 与自动归档阈值；本条**强化为铁律**并补两点——① 三文件（不止 progress.md）即时同步以服务「随时可 Clear + recap 恢复」；② doc 类小同步主 Agent 可直接维护，不必每次派 subagent。
- 与 CLAUDE.md [内容修订] 相关：需求变更流程已要求更新 Product-Spec.md + CHANGELOG，本条把「即时性」与「恢复目的」明确为硬约束。
- 呼应 feedback/ccb-cross-role-dispatch-no-relay-compact-at-source.md 的「去中转」精神：能主 Agent 直接做的轻量文档维护，不绕 subagent。

**evolution-engine 信号**：
CLAUDE.md [项目记忆规则] 当前只点名 progress.md 由 progress-recorder 维护，未把「三文件即时同步以支撑随时 Clear + recap 完整恢复」上升为铁律，也未说明「doc 类即时小同步主 Agent 可直接落盘、不必每次派 progress-recorder」。建议进化时：① 在 [总体规则] 或 [项目记忆规则] 新增「三文件同步铁律」，明确三文件清单、即时同步触发信号、Clear/recap 恢复目的；② 注明 doc 类轻量同步主 Agent 直接维护、重批处理（归档）才派 progress-recorder，避免与「去中转」相悖的过度派单。
③ **（第 2 次新增）三文件要求现散在 [项目记忆规则]/[内容修订]/SessionStart 三处，建议收敛成一条统一强铁律**：用 A1 绝对命令语言（必须/禁止/失败，抹掉"尽量/最好"的理性化空间）写"决策/约束/完成/需求变更**当下即同步**对应文件，不积压不事后补"，并明确 **Decisions 段 vs Done 段分段**（决策记 Decisions、完成记 Done，决策不许混进 Done）+ 需求变更 Product-Spec 与 CHANGELOG **成对更新**；附一条**收尾自检清单**（三文件都同步了吗 / 可 recap 复原吗 / 决策进 Decisions 了吗）。把分散要求合一，避免漏看某处而马虎。
