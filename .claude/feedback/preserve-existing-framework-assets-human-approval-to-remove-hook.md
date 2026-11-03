---
type: feedback
description: 自举/重构现有框架时，存量资产（.claude/hooks 下 17 个 hooks、skills、CLAUDE.md/AGENTS.md、tools）一律「保留复用 + 增量补缺」，绝不一股脑删/推倒重写；任何删除/停用/重写现有 hook 必须先和用户商量给理由、由用户拍板（人工审批闸）；自举 DEV-PLAN P0 必须把存量 hooks/skills/tools 纳入受保护基线 inventory
created: 2026-06-11
updated: 2026-06-11
graduated: true
source_skill: dev-planner
priority: 铁律（用户连说六遍、情绪强烈："每个钩子都是血泪加上的"、"这套算我的家底"）
---

# 存量框架资产保留 · 删 hook 须人工审批

**问题描述**：
commander 自举开发 ccb-base 脚手架，阶段3 DEV-PLAN 评审。DEV-PLAN v0.1 的 P0「干净基线骨架」措辞让用户警觉——担心自举重建时把现有那批 hooks「一股脑全删重写」。用户连续多条递进强调（情绪强烈）：
- "那个钩子我感觉很精妙，不要一股脑全部删了"
- "我感觉你写得都很好，不是哪一个很好"（指**整批** hooks 都好，不是某个明星）
- "那个钩子也是你逐步迭代出来的"
- "你如果有想法，你可以和我商量，去掉某个"
- "这每个钩子，都是血泪加上的"
- "这里面每个 Skill 也是精心设计的，其实这套算我的家底"（范围从 hooks 扩到 **skills**，定性升级为「我的家底」）

现有 `.claude/hooks/` 下 **17 个 hooks** 是逐步迭代、踩坑沉淀的「血泪活资产」，每个堵一个具体坑：
restate-rules-gate（复述闸）、stop-gate（停止验收闸）、ccb-dispatch-guard（派单兜底）、static-gate-pre-dispatch、anti-pattern-subagent-guard、dangerous-pkill-guard、no-direct-code-guard（主Agent不直接写码闸）、tdd-gate（TDD门禁）、no-blocking-wait-guard（防死等）、three-file-sync-gate、detect-feedback-signal、mark-review-needed、session-journal、session-rules-banner、check-evolution、pre-commit-check、auto-push。

**范围不止 hooks——整套是用户的「家底」**：除 17 个 hooks，还包括 **13 个精心设计的 skills**（product-spec-builder / design-brief-builder / design-maker / dev-planner / dev-builder / bug-fixer / code-review / test-builder / release-builder / skill-builder / feedback-writer / evolution-engine / progress-recorder）、**22 条 feedback 经验库**、**5 个 tools**（ccbclean / ccb-ps / ccb-shell / install / test-ccbclean）、**5 个会话内 sub-agents**、CLAUDE.md/AGENTS.md 规则与 .ccb 7-agent 拓扑。这是一个互相咬合的工程方法体系——skills 定义「每步怎么做」、hooks 焊死「不照做就拦」、feedback 记「踩过哪些坑」，三者缺一即散。用户定性为「这套算我的家底」＝最高级别受保护资产。

reviewer-codex 审①已客观印证此风险：DEV-PLAN P0 漏把 hooks/skills 纳入基线 inventory。

**触发场景**：
任何对现有框架资产的「自举 / 重构 / 重建 / 干净基线」类动作。尤其当 DEV-PLAN 出现「干净骨架 / 从零搭 / 重写基线」措辞、或 coder/commander 起意「顺手清理 / 统一重写」存量 hooks、skills、CLAUDE.md/AGENTS.md、tools 时。

**Why（为什么不能一股脑删/重写）**：
- 这 17 个 hooks 是「机制化卡点、不靠自觉」哲学的完整落地——每个堵一个踩过的具体坑，拆开各管一段、合起来才是体系。
- 它们是逐步迭代、血泪沉淀出来的活资产，不是可随意覆盖的样板代码。删任一个 = 把对应那个坑重新踩一遍，体系出现缺口。
- 「干净基线 / 推倒重写」表象诱人（看似整洁），但代价是丢失沉淀，是典型的「为整洁牺牲已验证资产」反模式。

**How to apply（怎么做）**：
1. **存量保留复用 + 增量补缺**：自举/重构默认对现有 hooks/skills/CLAUDE.md/AGENTS.md/tools 等存量框架资产**保留复用**，只在缺口处**增量补**，绝不一股脑删、绝不推倒重写。
2. **删/停/重写走人工审批闸**：若 AI（commander/coder）有想法要去掉、停用或重写**任何一个**现有 hook（或其它存量资产），必须**先和用户商量、给出明确理由、由用户拍板**，不得擅自删除或覆盖。
3. **DEV-PLAN P0 纳入受保护 inventory**：自举类 DEV-PLAN 的 P0/基线阶段必须把存量 hooks/skills/tools **逐项列入基线 inventory，标记为受保护资产**；基线骨架 = 在保留这些资产之上补缺，而非清空重建。
4. **措辞自检**：写「干净基线 / 骨架 / 重写」类 Plan 文案时自问「这会不会被读成把现有 hooks 全删？」——是则显式写明「保留现有 N 个 hooks，仅增量补缺」。

**关联**：
- 与 deploy/test 各 hook 的存在意义直接相关（stop-gate / static-gate / ccb-dispatch-guard / anti-pattern-subagent-guard 等已在多条 feedback 中作为「机制化卡点」落地，本条保护它们不被自举误删）。
- 与 three-file-sync / 「机制化为主」哲学呼应：机制化卡点是「把铁律从 advisory 下沉为 mechanical」的成果，删除即倒退。

**evolution-engine 信号**：
CLAUDE.md / dev-planner skill 目前没有「自举/重构时存量框架资产受保护、删 hook 须人工审批」的显式约束。建议进化时：① 在 dev-planner skill 或 CLAUDE.md 增加「自举/重构铁律：存量框架资产（hooks/skills/CLAUDE.md/AGENTS.md/tools）默认保留复用 + 增量补缺，删除/停用/重写任一资产须先与用户商量并由用户拍板」；② 要求自举类 DEV-PLAN 的基线阶段产出「受保护资产 inventory」清单，把现有 hooks 逐项列出标记保护，基线 = 保留之上补缺；③ 给「干净基线 / 骨架 / 重写」类措辞加自检提示，防被误读为全删。
