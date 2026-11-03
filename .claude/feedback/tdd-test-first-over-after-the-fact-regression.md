---
type: feedback
description: 当前测试价值有限（事后补回归测试=为打勾、覆盖低、价值有限），用户希望引入 TDD（学习 obra/superpowers 的 test-driven-development 方法论：强制 red-green-refactor、先写失败测试再写实现）；务实落地——高价值逻辑测试先行，UI 保持渲染/视觉对照
created: 2026-06-10
updated: 2026-06-10
graduated: true
source_skill: test-builder
---

> **毕业 2026-06-10**：TDD 测试先行已全面落地并经 （实测） 端到端实跑验证（red→green→cross-review 闭环，commander 亲见红/亲见绿）。落点：① `test-builder/SKILL.md` [第一性原则] 测试先行 TDD 纪律（实现前没失败测试不许写实现 / 必亲见 fail / 禁事后补测）+ [TDD 适用判据] 段（契约/解析器/状态机/去重/参数替换/schema/驱动适配层 必 TDD；UI/样式不 TDD）+ [工作流程] red-green-refactor 分流；② CLAUDE.md/AGENTS.md [开发测试规则] + [项目开发阶段] per-Task 循环嵌 RED（tester 出红→commander 验红）→GREEN（coder 最简到绿不改测试）→异模型审→REFACTOR；③ 配套 feedback：测试侧缺陷归属分流 tdd-per-task-test-side-defect-routing.md。

# 测试方法论升级：从事后补回归测试转向 TDD（测试先行，学习 obra/superpowers）

**用户原话**：
"我们的测试感觉很价值有限，能不能学习 Superpower 玩 TDD 啊"

**问题描述**：
当前 test-builder 走**"务实回归"**路线——在 dev-builder 四步走验证第 2 步**事后补**回归测试。用户觉得价值有限：事后补测往往沦为"为打勾"，覆盖率低、价值有限，无法证明测试的有效性。

用户诉求：把**事后补测升级为 TDD（测试先行）**。

**外部参照（已 WebSearch 确认）**：
- `obra/superpowers` 是一套知名的 Claude Code agentic skills 框架。仓库：https://github.com/obra/superpowers
- 其 `test-driven-development` skill 强制 **red-green-refactor** 纪律——**要求先写失败测试，再写任何实现代码**；明确反对"30 分钟事后补测 ≠ TDD（你得到的是覆盖率，但失去了测试有效性的证明）"。
- TDD skill 原文：https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md

**触发场景**：
test-builder / dev-builder 四步走验证第 2 步「测试完整性」——当前在功能实现完成后才补回归测试，用户认为该环节价值低、形同打勾。

**Why（为什么用户要这么做）**：
- 事后补测 = 先有实现、再照着实现写断言 → 测试只是把实现"复述"一遍，无法暴露实现本身的逻辑错误（confirmation bias）；得到的是覆盖率数字，不是测试有效性的证明。
- TDD 测试先行 = 测试先定义契约（期望行为）→ 实现去满足契约 → 测试天然独立于实现细节，能真正捕捉回归与逻辑错误。
- red-green-refactor 纪律强制"先看到测试红、再实现到绿、再重构"，每一步都验证测试确实在测真东西。

**改进方向（候选，供 evolution-engine 评估，务实落地、本次不落地）**：
1. **TDD 不必全量铺开**——**高价值逻辑**（契约 / 解析器 / 状态机 / 去重 / 参数替换 / JSON schema 校验 / 驱动适配层 抽象等）先写失败测试定义契约 → 实现到绿 → 重构；与项目已有的"高价值逻辑聚焦"原则对齐。
2. **UI 组件 / 样式保持渲染验证 / 视觉对照**——这类 TDD 价值低，不强上测试先行。
3. **强化"写测≠作者"独立性**：可由 tester 角色（codex，写测≠被测作者）先出测试契约（红），coder 再实现到绿——既上 TDD，又保住测试独立性铁律。
4. **可能调整角色协作顺序**：从"coder 先实现 → tester 后补测"调整为"tester 先出契约测试 → coder 实现"（测试先行）。

**落地范围提示（给 evolution-engine）**：
- 涉及改 `dev-builder` SKILL.md（四步走第 2 步从事后补测改为测试先行卡点）+ `test-builder` SKILL.md（务实回归 → TDD red-green-refactor）+ CLAUDE.md [开发测试规则] + 可能调整 [Sub-Agent 调度规则] / 工作流程中的角色协作顺序（测试先行）。
- 可参考 obra/superpowers test-driven-development SKILL.md 的 red-green-refactor 纪律具体写法。

**约束（改进时绝不能破坏的）**：
- 务实，不教条全量 TDD——只对高价值逻辑测试先行，UI/样式保持原渲染/视觉对照路线，避免为 TDD 而 TDD 拖慢交付。
- 仍守"写测≠被测作者"测试独立性铁律——TDD 下由 tester（异方）出契约测试，coder 实现，不退化为作者自码自测。
- 这是 CLAUDE.md / SKILL 级的流程进化（涉及铁律级改动），不能主观臆断改——必须经 evolution-engine 评估、用户逐条确认后再落地。
