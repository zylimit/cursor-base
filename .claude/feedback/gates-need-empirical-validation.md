---
type: feedback
description: 审查/验收/测试闸要靠数据验证有效性——记录它判过几次 FIX_REQUIRED/红，长期全过/全绿就是纯成本，简化或删掉；加新闸先想清怎么知道它有用
created: 2026-06-15
updated: 2026-06-15
graduated: true  # 毕业→CLAUDE.md [开发测试规则]；本文件留作细则参照
source_skill: 无（框架级规则）
---

# 审查/验收闸要量化验证，无效就砍

**问题描述**：
加了审查/验收/测试闸（重型 review 循环、五步闸、各 Stage、回归等），凭"感觉应该有效"就一直留着，从不回头核它到底挡住过什么。结果某些闸长期全过/全绿、从没产出过 FIX_REQUIRED 或红，纯耗时间和 token，却被当成"安全感"保留。

**触发场景**：
- 新增或评估一道审查/验收/测试闸时。
- 某闸跑了很多轮但从没拦下过问题，仍照跑不误。

**教训/建议**：

Why：Superpowers 实测（RELEASE-NOTES v5.0.6）——重型 subagent review 循环把执行耗时翻倍，但 5 个版本 × 5 次试验下来缺陷率完全一样（"doubled execution time without measurably improving plan quality"），于是砍掉换成 30 秒 inline 自检。教训：闸的价值要靠数据证（缺陷率 vs 耗时），不靠"感觉应该有效"；总是全过/全绿的闸不是保险，是纯成本。

How to apply：
1. **记录闸的产出**：这道闸判过几次 FIX_REQUIRED / 出过几次红 / 拦下过什么具体问题，留痕。
2. **定期审有效性**：周期性问"这闸挡住过问题吗"——没挡过就简化或删掉，别为感觉安全养无效成本。
3. **加新闸先想验证口径**：上一道新闸前先回答"我怎么知道它有用"（拿什么数据证它降了缺陷率、代价是多少），答不上就别急着加。

进化信号（给 evolution-engine）：CLAUDE.md [开发测试规则] 已固化「闸靠数据留，不靠感觉留」一条。可进一步在 red-blue-review / code-review / test-builder 的闸里加产出留痕字段（判过几次 FIX_REQUIRED/红），供定期审有效性时取数。
