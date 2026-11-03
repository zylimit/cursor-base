---
type: feedback
description: 视觉敏感产物（cluster 边界 / 地图渲染 / UI 布局）全量落地前置闸 = 用户亲眼看到小样，不是数据验证
created: 2026-08-08
updated: 2026-08-08
occurrences: 1
graduated: true  # 2026-10-30 毕业→dev-builder/SKILL.md [视觉与复用]（全量落地前用户亲眼看小样）
source_skill: dev-builder
origin: digifiber-conflation-claude,digifiber-optical-evidence
---

# 视觉敏感产物全量落地前必须让用户亲眼看到小样

**问题描述**：2026-08-08 做 cluster 边界 A 方案（FAT 面 union + buffer0.5，砍后处理）。完整跑了数据验证——okota_c1_z4 单 cluster rebuild：75 块 / 2.247M m²，对比旧版 1 块 / 1.892M，亲查不虚胖不漏。用户说"继续"，我据此推到全量 rebuild（1219 cluster）+ 部署容器 + 改测试 + 记 progress。结果用户在地图上一看：大量碎块 + 触手 + 碎屑，"非常乱"，全部回退。用户原话："问题很大，非常乱"、"蒙圈这个状态很不好，之前发生过"、"不管了回退吧，cluster 感觉很难搞定了"。

**触发场景**：cluster 边界 / 地图渲染 / UI 布局这类**视觉敏感产物**的全量落地。数据指标（块数 / 面积 / 不虚胖不漏）全部正确，但产物最终是给人眼看的，数据对 ≠ 看着对。用户口头"继续"被当成"看过 OK"。

**教训/建议**：
- 视觉敏感产物的全量落地，**前置闸 = 用户在地图 / 界面上实际看到小样并确认**，不是数据验证。数据验证是必要非充分——块数面积再对，地图上乱就是乱。
- 改动影响全量 / 全局显示时，先单点或小范围让用户**亲眼**确认视觉，再推全量。"继续"不等于"看过了"——要明确引导用户去看（指坐标 / 区域 / 截图），把"用户实际看地图确认小样"作为全量闸，而不是靠"继续"推断授权。
- 反复在同一方向撞墙要识别"数据本质决定的死路"：cluster 边界已经凸包→凹包→形态学→union 连试四版都翻车，这个方向很可能就是数据噪声本身决定的，止损建议搁置，而不是再换算法试第 N 版。
- 关联：[[destructive-ops-recheck-live-state-and-require-direct-evidence]]（证据基线——数据验证是证据，但证据类型要匹配产物性质）、[[receiving-review-no-performative-agreement]]（反馈不表演认同——用户说乱了就动手回退，不复述"你说得对"）。
