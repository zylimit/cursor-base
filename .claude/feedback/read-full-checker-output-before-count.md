---
type: feedback
description: 汇报 plan-lint 结果只看了输出结尾就说「两条」，实际 21 条；报任何检查器结果前要读完整输出并先数条数
created: 2026-11-18
updated: 2026-11-18
graduated: false
source_skill: N/A
scope: 主 Agent 汇报任何检查器 / 校验脚本 / 测试运行器的结果时（plan-lint、doctor、tier validate、design-trace 等）；发版准备类汇报尤其适用
exceptions: 未说明
supersedes: none
applied_to: pending
origin: OFR-ARIANE-claude
---

# 检查器结果只看结尾就下结论，少报了 19 条

**问题描述**：0.26.2 发版准备的汇报里，主 Agent 写「plan-lint 仍报两条早先就有的问题（REQ-INT-006 没有 Task、REQ-SUP-007 范围外与 Task 矛盾）」。用户经笔记本主 Agent 转来的原话：「出包时 plan-lint 实际报 21 条（Phase 19 缺 5 个字段；REQ-RPT-002、REQ-DSH-012、REQ-UI-003、REQ-INT-001 到 006 没有 Task；REQ-SUP-007 范围外与 Task 矛盾），不拦装配；记进 TODO，按文档债处理。」

主 Agent 在 rog-ts 重跑 `bash .claude/scripts/plan-lint.sh`：exit 1，「plan-lint: 失败」下面确是 21 条，分布为 Phase 12 缺 5 个字段、Phase 13 没有可执行的 Task 条目 1 条、Phase 19 缺 5 个字段、9 条需求没有任何 Task 引用（REQ-RPT-002、REQ-DSH-012、REQ-UI-003、REQ-INT-001 至 006）、REQ-SUP-007 范围外声明与 Task 矛盾 1 条。

**触发场景**：发版准备阶段汇报门禁 / 静态检查状态。当时报的那两条正好是这份输出的最后两行。原因是主 Agent 自己的推断（依据只有「那两条恰是末两行」，未做对照）：只看了输出结尾，没有读完整输出就下了「两条」的结论。

**教训/建议**：违反 CLAUDE.md 铁律 2「验收以客观证据为准」五步里的第三步「读完整输出与 exit code」。主 Agent 打算的改法：报任何检查器的结果时，先数「失败」段的条数再开口，不拿 tail 的几行当全貌；条数写进汇报。另外，「早先就有的」这类对存量问题的定性，也要建立在完整清单上，不能从末尾几行外推。

**适用范围与例外**：按 frontmatter：凡主 Agent 向用户汇报检查器 / 校验脚本 / 测试运行器结果，一律先数条数、读 exit code，再写进汇报。例外未说明。用户这次没有说「以后都」，所以只作记录，不改任何 skill / rule / hook。

**本次落地**：pending——主 Agent 已重跑 plan-lint 核实为 21 条，用户要求把这批问题记进 TODO、按文档债处理；但「先数条数再汇报」的做法尚未写进任何产物，skill / rule / hook 均未动（用户未说「以后都」）。
