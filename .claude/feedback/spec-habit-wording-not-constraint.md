---
type: feedback
description: 转写原规格时，描述角色习惯的措辞（「只是修正」）不等于系统约束，不得据此派生反向指标，应在复述里单独确认
created: 2026-10-28
updated: 2026-10-28
graduated: true  # 2026-10-30 毕业→product-spec-builder/SKILL.md [复述理解]（习惯措辞≠系统约束，复述里单独确认）
source_skill: product-spec-builder
scope: product-spec-builder 把已有文档（docs/需求规格.md 等）转写为 Product-Spec.md 的复述确认环节；凡原文含角色操作习惯、主次关系的措辞
exceptions: 用户明确说该措辞就是系统约束（如「页面只许改不许导入」）时按用户说的办；其余未说明
supersedes: none
applied_to: Product-Spec.md v1.2（产品概述、SC-3、规则与例外、数据与权限）；Product-Spec-CHANGELOG.md v1.2；skill / rule 本体未动
origin: OFR-ARIANE-claude
---

# 转写原规格时，把角色习惯措辞当成了系统约束

**问题描述**：product-spec-builder 把 docs/需求规格.md 转写为 Product-Spec.md，沿用原规格 §3 字面「页面上的编辑是对导入结果的修正」，把页面编辑当作次要修正路径，并据此把「页面修改被导入覆盖」设成反向指标。复述时问用户「POI 是不是录入员先改 Excel 再整表更新导入，页面上只做临时修正？」，用户纠正：「POI可以全部覆盖导入，也可以在页面修改」。

**触发场景**：已有原始需求文档转写成 Product-Spec 的复述确认。原文里描述录入员习惯、主次关系的话（「只是修正」），被 AI 当成了产品规则，复述问题本身也是带着这个预设提问（引导式的是非问句）。

**教训/建议**：
- 原文里描述角色习惯、主次关系的措辞，不等于系统约束；转写时先在复述里单独确认「这是习惯还是约束」，再写进 Spec。
- 不要从习惯类措辞派生反向指标（「X 被覆盖 = 失败」）；反向指标要有用户确认过的「这件事不该发生」作依据。
- 实际事实：导入（整体覆盖）与页面修改是并列的正常维护路径，导入冲掉页面改动是接受的代价，不是缺陷。
- 复述提问尽量开放（「有哪几种维护方式？」），少用带预设的是非问句。

**适用范围与例外**：同 frontmatter。适用于转写已有文档、且文档含多路径并存的数据维护方式的场景；用户明说是约束时不适用。

**本次落地**：Product-Spec.md 已改到 v1.2（产品概述、SC-3、规则与例外、数据与权限四处改为导入与页面修改并列，去掉「页面修改被导入覆盖」反向指标），CHANGELOG 记 v1.2。skill / rule 本体未动；是否在 product-spec-builder 的转写复述段补一条「习惯措辞单独确认」待用户说「以后都」或 evolution-engine 积累后再定。
