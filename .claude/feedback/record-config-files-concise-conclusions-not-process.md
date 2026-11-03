---
type: feedback
description: 记录/配置类文件（progress.md / ccb.config 注释 / 各类记录文件）要简洁、结论导向——只记决策结论/约束/可 recap 恢复状态的精炼信息/最终方案（含一句话关键原因），不写调试来龙去脉/多次失败试错过程/源码追踪逐步细节/长篇推导；过程是噪音，拖慢 recap、占 context
created: 2026-06-10
updated: 2026-06-10
graduated: true
source_skill: N/A  # 项目记忆/配置文件维护机制，跨 Skill 通用约束（主要落点 progress-recorder skill + 三文件同步规则）
---

# 记录/配置文件要简洁结论导向，不记过程

**问题描述**：
用户原话："这些配置文件后面要清理好，要简洁，过程的描述不要"。
本 session 在排查一个配置问题（claude provider 自动更新导致卡死）时，主 Agent 在 progress.md 和 ccb.config 注释里记了大量**过程描述**——多次配置失败的来龙去脉、源码追踪的每一步、调试细节。用户指出这些记录文件要简洁。

**用户偏好的实质**：
progress.md、ccb.config 注释、以及各类记录/配置文件，要**简洁、结论导向**：
- **保留**：决策结论、必须遵守的约束、可 recap 恢复项目状态的精炼信息、最终方案（含「为什么」的一句话关键原因）。
- **删除/不写**：调试来龙去脉、多次失败试错的过程、源码追踪的逐步细节、长篇推导。

**Why（为什么不记过程）**：
这些文件是**状态恢复 / 配置用**的，不是调试日志。过程流水账只会增噪音、拖慢 recap、占用 context。一句结论 + 关键原因，胜过十行调试过程。

**反例（本 session 实际发生）**：
autoupdate 排查在 progress 的 Decisions/Notes 里记了多条过程——顶层 env 失败 → provider_profile.env 失败 → 追 filtered_api_env 源码 → provider_command_template 方案，每一步细节都写进去了。
应精简为一句结论：
> 「claude 禁 autoupdate 用 provider_command_template 注入 env（claude launcher 用 filtered_api_env 过滤掉非 API env、故 env 字段无效），已实测生效。」

**How to apply（怎么做）**：
1. **写 progress / 配置注释前先自问**：「这是 recap 恢复状态需要的结论，还是调试过程？」——过程一律不进正文。
2. **结论 + 一句话关键原因**：留「是什么决策 / 什么约束 / 最终怎么做 + 为什么（一句话）」，砍掉「怎么一步步试出来的」。
3. **过程证据需留则另放**：调试细节如确需留证据，放 CCB artifact 或单独的调试日志文件，不进 progress.md / 配置注释正文。
4. **progress-recorder 增量合并时主动压缩**：record 时主动剔除 / 压缩过程性描述，只沉淀结论与约束。

**与既有 feedback 的关系（互补非重复）**：
- 与 `three-file-sync-clearable-context-recap-recovery.md`（已毕业铁律）是**正交两轴**：那条管「**即时性 / 完整性**」——决策/约束/完成/任务要即时同步进三文件，保证 recap 能完整恢复；本条管「**简洁性 / 质量**」——同步进去的内容要是精炼结论而非过程流水账。一个说「该记的别漏」，一个说「记的别啰嗦」，配合用：即时沉淀**结论**，不即时沉淀**过程**。

**evolution-engine 信号（供评估是否毕业）**：
建议进化时落到两处：
① **progress-recorder skill / CLAUDE.md [项目记忆规则] 三文件同步铁律**：补一条「记结论与约束、不记过程；过程细节如需留证据放 CCB artifact 或单独调试日志，不进 progress.md 正文」；progress-recorder 增量合并时主动压缩/剔除过程性描述。
② **主 Agent 写 progress / 配置注释的心智**：先问「这是 recap 恢复状态需要的结论，还是调试过程？」——过程一律不进。
**graduated: true（2026-06-12 进化落地）**，已毕业到 progress-recorder skill「记结论不记过程」原则 + CLAUDE.md/AGENTS.md 三文件同步铁律（双侧）。
