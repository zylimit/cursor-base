---
origin: pre-survey-map-claude
graduated: true  # 2026-11-08 毕业（既成事实）→hooks/no-direct-code-guard.mjs 第 16–19 行：事件带 agent_id 的子 Agent 写入一律放行
---
# no-direct-code-guard 误拦被合法派发的 implementer sub-agent

- **类型**：未覆盖场景 / hook 判据缺失
- **关联**：no-direct-code-guard hook、implementer sub-agent、[总体规则] 主 Agent 职责边界铁律
- **occurrences**：1
- **created**：2026-08-23
- **updated**：2026-08-23

## 现象
Phase 20 开发中，主 Agent 通过 Task 工具派发 implementer sub-agent 编码，完全符合「主 Agent 不直接编码、一律委派 implementer」的职责边界铁律。但 implementer 在编辑生产代码文件时，被 no-direct-code-guard hook 拦截/告警。

## 问题本质
no-direct-code-guard 的设计意图是拦截**主 Agent** 直接写生产代码（强制走委派）。它对**被合法派发的 implementer sub-agent** 的编辑同样触发了拦截——这是误拦。implementer 正是委派的正确终点，是这条规则想要的结果，不该被这个 guard 挡。说明该 hook 缺少「区分主 Agent 与 sub-agent 上下文」的判据。

## 影响
implementer 完成了任务（改动落地、编译通过），但过程中触发了本不该触发的 guard，制造了噪音/困惑。guard 误报会消解它的信号价值，长期会训练人忽略它。

## 建议方向（供 evolution-engine 评估，本次不实现）
no-direct-code-guard 应能识别调用方是否为 sub-agent（如通过环境标识 / agent 上下文），对合法派发的 implementer / bug-fixer 放行，只拦主 Agent 的直接编码。落地前需确认 Claude Code 能给 hook 提供可靠的 agent 上下文判据，避免出现「sub-agent 伪装绕过」的反向漏洞。
