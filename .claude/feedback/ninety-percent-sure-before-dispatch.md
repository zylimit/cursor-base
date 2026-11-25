---
type: feedback
description: 用户原话「你搞清楚就开始，没考清楚问我，90%把握才能开工」；主 Agent 在 Operation-info 适配里两处只有六七成把握就按 [默认] 派了 implementer，开工后才补问，其中一处用户的答案与默认相反
created: 2026-11-02
updated: 2026-11-02
graduated: true  # 2026-11-08 毕业→skills/dev-builder/SKILL.md 派单段（把握不到九成先合并提问再派）
source_skill: dev-builder（派 implementer 前的需求确认）
scope: ARIANE 项目；用户提了需求、主 Agent 要派 implementer 开工之前，需求里有自己补的判断（Spec 里会标 `[默认]` 的那类）时
exceptions: 有约定俗成默认、改错代价很小的细节（文案措辞、显示单位这类）可以先做并在汇报里说明；用户当轮说「按你的推荐」或已授权自定时按铁律 7、10 办；安全护栏不在此列（未说明）
supersedes: 无
applied_to: Operation-info 适配的派单已按用户答复改（未知 Category 改为该行忽略 + 弹出警告）；progress.md Decisions 同日条由主 Agent 负责（本记录写入时未核实）；skill / rule 本体未动（pending，见落点）
origin: OFR-ARIANE-claude
---

# 九成把握才开工：没想清楚的先问，再派 implementer

**问题描述**：用户发来新的 Operation-info 样表，接连说了「Category 支持三种类型」「POI 还是只支持1个，不能放多个，放多个，不让导入」等几条。主 Agent 复述理解后就派了 implementer，其中两处是自己补的、只有六七成把握：① Category 写了三种以外的值，是拒收还是照常导入只提示；② Category 为 Retassage 的行填了 Cable Type 怎么处理。用户随后说「你搞清楚就开始，没考清楚问我，90%把握才能开工」。主 Agent 开工后才补问：①用户答「还是让导入，但是要弹出一个警告，某一行不符合规范，被忽略」——该行不存，与主 Agent 默认的「照常导入只提示」不同；②与 Volume 写 X 两项用户选了主 Agent 的推荐。

**触发场景**：用户需求是分几条消息陆续给的，主 Agent 为了快，在第二条消息后就带着 `[默认]` 派单，后面每来一条就用 SendMessage 给 implementer 追加规则。

**教训/建议**：
- 派 implementer 之前过一遍自己补的判断：每一处问自己「用户答案和我默认的不一样的可能有没有一成以上」，有就先问，问清再派。
- 判据看改错的代价：改的是导入规则、拒收与否、数据存不存这类，答错要返工且可能写坏数据，必须先问；文案、显示单位这类小事可以先做、汇报里说明。
- 一次问齐：把没把握的几处合成一次提问（AskUserQuestion 一次最多 4 问），每问给推荐项和代价，不要边做边问。
- 用户需求还在陆续补充时，先等他说完、复述确认，再开工。

**适用范围与例外**：按这条来：用户提需求后主 Agent 要派 implementer 时，需求里有自己补的判断。不按这条：判断有九成以上把握，或改错代价很小（文案、显示）；用户当轮说「按你的推荐 / 你定」时。

**本次落地**：Operation-info 适配：已开工的派单按用户答复改（未知 Category 改为该行忽略、预览与导入后弹出警告）。落点建议：dev-builder 的派单前检查加一句「需求里有 `[默认]` 判断且把握不到九成时，先合并成一次提问再派 implementer」——属改 skill 本体，交 evolution-engine 出建议、用户拍板，本次不动。
