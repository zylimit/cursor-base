---
type: feedback
description: 新开一块功能、决定代码放哪之前，先把 Pinned / TODO / Decisions 里关于这块「边界与归属」的既有约定找出来对照，再派单
created: 2026-10-11
updated: 2026-10-11
graduated: true  # 2026-10-30 毕业→既成事实：rules/subagent-dispatch.md [派单包七字段] Business Context 已要求写入 Pinned / Decisions 里适用本 Task 的规则
source_skill: dev-builder
scope: 主 Agent 为新功能 / 新工具 / 新 Phase 决定代码落点、写派单之前；尤其是 progress.md 里已有「独立工程 / 只定义契约 / 不进主仓库」类记录的功能块
exceptions: 未说明（既有记录里没有相关约定的全新功能块，无可对照，不适用）
supersedes: none
applied_to: progress.md Decisions 2026-10-11「光功率做成单独的服务，不进主仓库」；DEV-PLAN.md Phase 118 修订段（落点说明）；在途 implementer 已被通知改放 ~/code/digifiber-optical-evidence/，主仓库不留其代码
origin: digifiber-conflation-claude,digifiber-optical-evidence
---

# 决定代码落点前，先对照既有的边界与归属记录

**问题描述**：既有记录早已写明光功率是独立工程：progress.md TODO #116「主系统未来仅定义数据契约/对接」；Pinned 2026-07-28「光功率属于相对独立的 QA 工程」；D 盘另有独立目录 `D:\Code\optical-power-toolkit`。2026-10-11 用户说「接下来就是光功率了」，主 Agent 读了 progress.md 与 DEV-PLAN Phase 118、做了抽样实测，随后派 implementer 在主仓库 `conflation/tools/optical_evidence/` 下新建解析工具。派单前没有拿这两条既有记录来决定代码落点。实现者开工约二十分钟后，用户纠正：「这个光功率，我之前说，做成一个单独的服务」。

**触发场景**：用户用一句简短的话切换到下一块功能（「接下来就是 X 了」），主 Agent 沿着当前仓库与当前 Phase 的惯性，默认把代码放进主仓库。这次的特点是：相关记录主 Agent 实际读到了，但读完只用来理解「做什么」，没有用来约束「放哪里」。读到了却没拿来约束落点，等于没读。代价是约二十分钟的实现者工时作废、需要中途改道。

**教训/建议**（以下为主 Agent 的解读，不是用户原话）：
- 新开一块功能、决定代码放哪之前，先在 Pinned / TODO / Decisions 里检索这块功能的名字与别名，把关于「边界与归属」的既有约定（独立工程 / 只定义契约 / 不进主仓库 / 单独服务）单独摘出来，写进派单包 Business Context，并在落点那一栏明确引用。
- 派单的「落点」字段要能回答「依据哪条既有记录」；回答不出来，先问用户或再查，不凭惯性放进当前仓库。
- 服务的具体形态（是否带页面与接口、部署位置）用户尚未说明，不编，需要时单独问。

**适用范围与例外**：见 frontmatter。范围是主 Agent 写派单、决定落点的那一刻；例外是没有任何既有约定可对照的全新功能块。不改 skill / rule 本体；若同类情况再出现，再评估是否在 dev-builder 派单步骤或 subagent-dispatch.md 的七字段派单包里加一条「落点依据」检查。同日同一环节另出一类缺口（业务用途与用户已有规格没问没读），见 scope-a-block-from-business-purpose-and-prior-spec-not-from-task-title.md，两条合看，规则若要改放同一处一并评估。

**本次落地**：progress.md Decisions 新增「光功率做成单独的服务，不进主仓库」；DEV-PLAN.md Phase 118 修订段补了落点说明；在途 implementer 被通知把代码改放到独立项目 `~/code/digifiber-optical-evidence/`，主仓库不留其代码。skill / rule 本体未动。
