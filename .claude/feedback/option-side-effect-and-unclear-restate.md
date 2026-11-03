---
type: feedback
description: 给用户出选项时，AI 自己的推论不得塞进选项描述；复述影响时引用站点名必须说清是哪一行、哪一列怎么变
created: 2026-10-28
updated: 2026-10-28
graduated: true  # 2026-10-30 毕业→product-spec-builder/SKILL.md [覆盖扫描]「问法固定」与 [复述理解]（选项不塞推论；复述影响点到行列）
source_skill: product-spec-builder
scope: product-spec-builder 迭代模式下给用户出选项、复述改动影响的环节；凡选项描述里夹带 AI 推导出的副作用，或复述用截图 / 数据里的具体实例
exceptions: 选项本身就是用户先提出的方案、无推论成分时不适用；其余未说明
supersedes: none
applied_to: Product-Spec.md v1.3（REQ-PLN-007、REQ-BRD-008、规则与例外、澄清记录）；Product-Spec-CHANGELOG.md v1.3；skill / rule 本体未动
origin: OFR-ARIANE-claude
---

# 选项里夹带自己的推论，复述举例又没讲清

**问题描述**：用户圈出看板「模板 · T0」列说「不要说用什么模板，要按照POI里面的类型来」，并在选项中选了「连排程一起改」。该选项文字是 AI 写的：「不再自动判 Massive，Massive 只能人工指定」。AI 据此把 Spec 改成「Massive 只人工指定」，复述时说 CHATILLON LA PALUD 会按 Transportation 排、搬迁活动消失。用户先问：「你说的是啥啊CHATILLON LA PALUD？」，解释后纠正：「CHATILLON LA PALUD 这个是有搬迁的，要用 Massive+Transportation并集」；追问 x 时答「x不用管，只关注 Total Avg. Weight」。

**触发场景**：用户要的是「排程跟 POI 类型走」这个方向；AI 把「取消自动 Massive」这个自己推出来的副作用写进选项描述，用户选的是方向，AI 却当成他认可了推论。复述时只抛站点名，没说是截图第几行、哪一列、从什么变成什么，用户无从核对，错误推论拖到第二轮才暴露。

**教训/建议**：
- 选项描述只写用户可判断的方向本身；AI 推出的副作用（取消自动判定、某类记录行为改变等）单列成一个独立问题让用户确认，不打包进选项。
- 复述影响时，引用实例要带定位：截图第几行、哪一列、变更前后各是什么；只给站点名等于没复述。
- 用户选「按类型来」后，对「类型 -> 模板」的映射，先拿几个真实例子（含 Transportation 有搬迁、Distribution、无类别）让用户核对，再写 Spec。
- 实际口径：模板跟 POI 类型走；Transportation 有搬迁户数要并上 Massive；x 不算搬迁，只看 Total Avg. Weight；只有 Distribution 不加 Massive；无类别不排程。

**适用范围与例外**：同 frontmatter。选项由用户自己提出、不含 AI 推论时不适用。

**本次落地**：Product-Spec.md 已改到 v1.3（REQ-PLN-007 / REQ-BRD-008 / 规则与例外 / 澄清记录按上述口径改写），CHANGELOG 记 v1.3。skill / rule 本体未动；是否在 product-spec-builder 迭代模式补「选项不夹带推论、复述带定位」两句，待用户说「以后都」或 evolution-engine 积累后再定。
