---
type: feedback
description: 扫码数据只和竣工比对，LLD 是未来设计不和扫码关联；「都要暴露」指有逻辑的问题，放出任何一类前先核它的比较对象是否合已定口径
created: 2026-10-25
updated: 2026-10-25
graduated: false
skipped: true  # 2026-10-30 裁定：数字光纤项目的领域口径，归项目 domain/，不进框架
source_skill: N/A
scope: 质量看板以及一切把扫码与其他数据源作比对的功能
exceptions: FAT 边界取竣工 + SBC + LLD 并集，是另一回事，不受本条影响；LLD 只在 FAT 边界池里用
supersedes: none（落实并重申用户 2026-10-22「不比较设计和竣工、只看竣工」的口径；与 expose-issues-only-no-responsibility-assignment.md、issue-list-goal-is-discovery-not-lower-count-no-self-invented-filter-rules.md 不冲突，那两条管怎么写、怎么过滤，本条管比较对象选谁）
applied_to: Product-Spec.md v2.60 段「数据质量全部露出」那句改为「4 类 LLD 对比仍隐藏，漏扫改为竣工有、网管没扫码」；正在做的实现任务已同步
origin: digifiber-conflation-claude
---

# 扫码只和竣工比，LLD 不与扫码关联

**问题描述**：用户说「都要暴露出来」后，AI 把扫码数据分析里隐藏的 6 类全部放出，其中 4 类是网管扫码与 LLD 的比对（LLD 归属存疑 / LLD 漏扫 / LLD 名不符 / 容量核对），一类就有十几万条。用户纠正：「等等，只有竣工和漏扫有关系，LLD不用扫码的，LLD可能是未来的设计，不用和扫码关联，这个和之前FAT边界不一样」。

**触发场景**：用户一句宽泛的「都要暴露」，AI 当成「后台算过的全部放出来」，没有逐类核对每类的比较对象。用户 10-22 已定过「不比较设计和竣工、只看竣工」，AI 放出前没有对照。

**教训/建议**：
- 「都要暴露」指暴露有逻辑的问题，不是把后台算过的东西一股脑放出来。
- 放出任何一类之前，先看它的比较对象是否符合用户已定口径：扫码只对竣工比；漏扫只指「竣工有、网管没扫码」；LLD 只在 FAT 边界池（竣工 + SBC + LLD 并集）里用。
- 宽泛指令遇到数量大（十几万条）的类别，是该停下来核口径的信号。

**适用范围与例外**：质量看板以及一切把扫码与其他数据源比对的功能按本条来。FAT 边界并集不受影响。

**本次落地**：Product-Spec.md v2.60 段「数据质量全部露出」改为「4 类 LLD 对比仍隐藏，漏扫改为竣工有、网管没扫码」；正在做的实现任务已同步。skill / rule 本体未动。
