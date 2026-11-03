---
type: feedback
description: 长目录或复杂材料学习应使用 Claude Code 原生 fresh Sub-Agent（Task/Agent 工具），不调用本地 ask gemini 桥；Sub-Agent 负责辅助翻材料，主 Agent 仍须亲自阅读关键材料并独立判断改进点
created: 2026-07-19
updated: 2026-07-19
graduated: true  # 2026-09-10 逐条比对后判定：两半都已逐字成文且重复三处：CLAUDE.md [运行模型]「纯 Claude Code 方案，无外部驱动」、rules/subagent-dispatch.md [回传与验收]「翻证据可外包，判断权留主 Agent」、rules/workflow-orchestration.md 三铁律②
source_skill: N/A
---

# 调研使用 Claude Code 原生 Sub-Agent，主 Agent 保留独立判断

**问题描述**：用户明确否定了用本地 `ask gemini` / Gemini 桥学习长目录的做法，认为该工具不可用或质量不足，要求此类工作改用 Claude Code 原生的 Task/Agent 工具派发 fresh Sub-Agent。用户同时强调，Sub-Agent 只能辅助读取和分析，主 Agent 自己也必须阅读关键材料、核对事实并独立判断哪些改进值得吸收，不能把 Sub-Agent 的结论直接当成最终判断。

**触发场景**：对本仓库或参考仓库进行长目录学习、规则梳理、脚手架对比、复杂材料分析或改进点提炼时，需要扩大阅读覆盖面，但最终结论会影响框架规则、Skill、Agent 或脚手架资产。

**教训/建议**：此类项目调研优先派发 Claude Code 原生 fresh Sub-Agent，提供明确的读取范围、问题和证据句柄要求；不得擅自调用本地 Gemini/`ask` 桥等外部工具替代。Sub-Agent 回传后，主 Agent 必须亲自读取决定结论所需的关键源文件和证据，区分事实、推断与建议，再独立决定采纳、修改或拒绝；遵循「翻证据可委派，下判断不外包」。
