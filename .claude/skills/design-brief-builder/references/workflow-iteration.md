---
name: workflow-iteration
description: design-brief-builder 迭代模式启动时读。用户调整设计方向时的追问、冲突检测、两份文件同步与下游提醒。
---

[使用时机]
    已有 Design-Brief.md（多半也有 DESIGN.md），用户要调整视觉方向、改页面、换组件风格，或 Spec 变更波及设计。

[顶层规则]
    接住需求直接问，不开场白。守 interview-principles：先问上游能并才并、逼出具体、反失败自检。别一听就照单全收。
    先判轻重：只改一个 token 值或一页的一个区域 → 直推，改完复述一句；换密度、换主题、换形态、换导航 → 走完整追问。

[流程]
    用户报新风格或参考 → 触发搜索增强第二遍，立刻搜同调性参考带回做二选一收窄。
    模糊词按 SKILL 的 [感受翻译表] 逼成属性，recap 确认。
    检测与现有 brief 的冲突——新方向和已定的密度、色彩模式、设计原则、反参考冲突时，直接指出让用户取舍；取舍写进「假设与待确认」或决策记录。
    Spec 变更触发的：先读 Product-Spec-CHANGELOG 定位变更，只动受影响的 SCREEN / CMP / 流程；新需求没有页面接的补页面，页面没有流程落到的问用户。

[更新]
    按实际影响范围决定改几份文件：只影响某页 / 组件 / 局部视觉细节的改动，只改受影响的那份载体（行为类改 Design-Brief.md，视觉与 token 类改 DESIGN.md，不强制联动另一份）；涉及信息架构、状态语义变化或新增页面时两份一起改——行为改 Design-Brief.md，视觉与 token 改 DESIGN.md；一处 token 变了，prose 里说它为什么存在的那句也要跟着改。
    被推翻的方向标「→ 被 <日期> 取代」，不删历史。
    跑 `node .claude/scripts/predev-lint.mjs`；能跑 `npx @google/design.md lint` 就跑。
    涉及设计稿已生成的，提醒重生（design-maker）；涉及已写代码的样式实现的，提醒回 dev-builder 同步 token；只提醒不自动改。
    改完复述改后那一屏长什么样，用户点头即完成。
