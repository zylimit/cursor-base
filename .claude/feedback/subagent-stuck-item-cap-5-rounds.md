---
type: feedback
description: 审查员为一项渲染截图核查耗满 60 轮上限、没交报告；用户「审查员跑满了 60 轮上限，什么玩意，3轮就要跳过」，随即改口「最多5轮」。Sub-Agent 单项核查卡住，同一项最多试 5 轮工具调用，没结果就跳过，记入回执 Not verified
created: 2026-11-10
updated: 2026-11-10
graduated: true  # 2026-11-22 毕业→.claude/rules/subagent-dispatch.md [派单包七字段] Escalation 说明
source_skill: code-review（派 code-reviewer 的派单包 Escalation 字段）；同样适用其他角色派单
scope: ARIANE 项目此后所有派单（implementer / code-reviewer / tester / deployer），以及主 Agent 写派单包
exceptions: 其余未说明
supersedes: none（已查 tests-capped-at-half-run-once.md、review-before-deploy-even-in-fast-mode.md、ninety-percent-sure-before-dispatch.md，无「尽量做完核查」「必须拿到截图」类冲突条目）
applied_to: progress.md Decisions 2026-11-10「Sub-Agent 单项核查卡住最多试 5 轮就跳过……」；当次给在跑审查员的收尾消息（「这次收尾总共最多 5 轮工具调用，到了就按已有结论出报告」）。skill / rule / agent 本体未改（pending）：用户没说「以后都」要改家底，候选落点 .claude/rules/subagent-dispatch.md [派单包七字段] 的 Escalation 说明
origin: OFR-ARIANE-claude
---

# Sub-Agent 单项核查卡住：同一项最多试 5 轮，跳过并写 Not verified

**问题描述**：
- 主 Agent 派 code-reviewer 审 Task 11.11（看板 Retassage 卡拆两张，MEDIUM 档，只跑 Stage 0 + 1）。派单里有一项 KPI 卡渲染核查：搭静态页，调 Windows 端无头 Chrome 截图，量 1920 / 1569 / 1366 三档宽度。
- 派单只写了「需要装新依赖或起 vite 才能做就跳过，写进 Not verified」，没写试几次就停。
- 审查员跑满 60 轮上限，只留下一句「先查本项目的审查记忆，再看改动」，没交报告。
- 同一会话里 Task 11.9 的审查员也跑满过一次 60 轮，当时主 Agent 用 SendMessage 让它不等全量就收尾。同类事故第二次。
- 用户看到后说：「审查员跑满了 60 轮上限，什么玩意，3轮就要跳过」，随即打断补一句「最多5轮」。最终口径是 5。

**触发场景**：派单里有一项依赖外部环境的核查（截图、起旁路实例、装工具），环境一卡住，Sub-Agent 就在这一项上反复试，吃光轮次预算，连主体审查结论都没交。派单只给了「需要装依赖就跳过」的条件，没给次数上限，所以「试了又试」不算违规。

**教训/建议**：
1. Sub-Agent 的某一项核查卡住时，同一项最多试 5 轮（以工具调用轮次计），没结果就跳过，写进回执的 Not verified 交回主 Agent。不许耗到 60 轮上限。
2. 典型的卡住项：截图、起旁路实例、工具装不上、命令反复失败。
3. 主 Agent 每张派单的 Escalation 字段都要写明这条（5 轮、跳过、写 Not verified）。
4. 跳过的项补不补、怎么补，由主 Agent 决定，Sub-Agent 不自行加码。
5. 主体结论优先：卡住项不能挤掉报告，哪怕只剩已有结论也要出报告。

**适用范围与例外**：同 frontmatter。适用于所有角色、所有派单；其中一项卡住不影响其余项继续做。例外用户未说明，不编。

**和已有 feedback 的关系**：
- tests-capped-at-half-run-once.md：互补。那条限制「同一批改动每个角色跑几次」，这条限制「同一个卡住项试几轮」，都是收敛执行次数，不冲突。
- review-before-deploy-even-in-fast-mode.md：不冲突。那条要求部署前必审（审查本身是硬的），这条只允许审查中的单个外部环境核查项被跳过并如实写 Not verified，审查本身不省。
- 没有与「尽量做完核查」「必须拿到截图」类的旧条目冲突，故无取代关系。

**本次落地**：
- progress.md Decisions 2026-11-10 记了「Sub-Agent 单项核查卡住最多试 5 轮就跳过……」。
- 对在跑的 Task 11.11 审查员已发收尾消息：这次收尾总共最多 5 轮工具调用，到了就按已有结论出报告。
- skill / rule / agent 本体未动，pending。

**落点建议**（只建议，不改）：`.claude/rules/subagent-dispatch.md` [派单包七字段] 的 Escalation 说明补一句「单项核查卡住同一项最多 5 轮工具调用，没结果即跳过并写进回执 Not verified，不耗到轮次上限」。这是家底改动，按 CLAUDE.md 铁律 5 由用户拍板；用户说「以后都」或确认后再改，各 agent 定义是否同步写，一并问。
