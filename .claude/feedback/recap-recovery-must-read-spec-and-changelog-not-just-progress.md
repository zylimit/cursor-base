---
type: feedback
description: recap / Clear 之后的上下文恢复必须读齐 progress.md + Product-Spec.md + Product-Spec-CHANGELOG.md 三份——只读 progress.md 漏掉需求基线与需求变更，不算恢复完成
created: 2026-06-15
updated: 2026-06-15
graduated: true  # 毕业→CLAUDE.md [指令集] recap；本文件留作细则参照
source_skill: N/A  # recap 指令 / Clear 后首次恢复，跨 Skill 通用约束
priority: 用户明确修正
---

# recap 恢复：必须读齐 Spec + CHANGELOG，不止 progress.md

**问题描述**：
用户修正了 recap / Clear 之后的恢复行为。当前 CLAUDE.md 把 recap 定义成「阅读 progress.md，回顾项目当前状态」（[指令集] recap 条目），[项目记忆规则] 也写「recap 主 Agent 直接读 progress.md」——只点名一份 progress.md。用户指出：上下文恢复（recap 或 /clear 之后的首次恢复）必须读齐**三份**：
- **progress.md**（进度 / 决策 / 约束）
- **Product-Spec.md**（当前需求基线）
- **Product-Spec-CHANGELOG.md**（需求变更记录）

只读 progress.md 不算恢复完成。

**触发场景**：
任何上下文恢复时刻——用户敲 /recap，或 /clear 清空上下文后接着干活的第一步。这两种场景都得把三份文件读齐（存在即读）才算恢复就位。

**Why（为什么三份都要读）**：
progress.md 只是进度 / 决策记忆，它不承载需求本身（Spec）和需求怎么变过来的（CHANGELOG）。只读 progress.md 的恢复是残缺的：恢复后的判断会脱离当前需求基线——不知道现在要做的产品到底是什么、哪些需求被改过，等于拿着进度条却不知道终点在哪。三份合起来才构成「进度 + 需求 + 变更」的完整恢复上下文。这也是用户敢于随时 Clear 的前提：恢复链不能漏读。

**How to apply（怎么做）**：
1. **recap 指令**：主 Agent 读 progress.md + Product-Spec.md + Product-Spec-CHANGELOG.md 三份（存在即读，缺哪份说明哪份没有），再综述项目当前状态。
2. **/clear 后首次恢复**：同样主动读齐这三份，不等用户提醒。
3. **判据**：只读到 progress.md 就开始干 = 恢复未完成；读齐三份（存在的都读了）才算恢复就位。
4. 这三份是文档类，主 Agent 可直接读，不必派 subagent。

**关联**：
- 与 feedback/three-file-sync-clearable-context-recap-recovery.md 是同一机制的两面——那条管**写**（三文件即时同步，确保随时可 Clear、靠 recap 恢复），本条管**读**（recap / Clear 后恢复必须把这三份读齐，不止 progress.md）。写得齐还要读得齐，恢复链才闭合。
- 与 CLAUDE.md [项目记忆规则] 直接相关：该节当前 recap 只点名 progress.md，本条把 recap / 恢复扩到三份。

**evolution-engine 信号**：
CLAUDE.md 两处需更新：① [指令集] 的 recap 定义当前是「阅读 progress.md，回顾项目当前状态」，应改为「阅读 progress.md + Product-Spec.md + Product-Spec-CHANGELOG.md，回顾项目当前状态」；② [项目记忆规则] 的「recap 主 Agent 直接读 progress.md」应改为「recap 主 Agent 直接读 progress.md + Product-Spec.md + Product-Spec-CHANGELOG.md（存在即读）」。可一并补一句：/clear 后首次恢复同样读齐这三份。
