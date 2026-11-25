---
type: feedback
description: 交 DigiFiber 导入文件时，每份文件的同一行写明在 DigiFiber 里用哪种导入（删除表用「删除导入」先导，导入表必须用「新增导入」后导，不是修改导入），只写先后顺序不够；汇报、提示词、页面上的导入顺序三处同一写法；用户报导入失败，先看错误报告的表头再下结论
created: 2026-11-04
updated: 2026-11-04
graduated: false
skipped: true  # 2026-11-22 裁定：数字光纤项目的产品操作口径，归项目 domain/，不进框架
source_skill: N/A
scope: 传统段还原所有 DigiFiber 导入文件的交付（汇报、提示词）与页面上写导入顺序的文字（progress.md Decisions 2026-11-04 条所定范围）
exceptions: 未说明
supersedes: none
applied_to: progress.md Decisions「2026-11-04（交 DigiFiber 导入文件必须写明导入方式…）」；用户 memory digifiber-import-mode-explicit.md；页面上写导入顺序的几处文字已重派 implementer（回执未到，未验收）；观察员另核到 Product-Spec.md REQ-TRAD-011 末尾「2026-11-04 补」；skill / rule 本体未动
origin: digifiber-conflation-claude
---

# 交 DigiFiber 导入文件：每份文件同一行写明导入方式，不只讲先后顺序

**问题描述**：2026-11-04 传统段还原 T0668 机房，主 Agent 把 DigiFiber删除表和 DigiFiber导入表交给用户去导，只说了「系统里写的顺序是先导删除表、再导导入表」，没写这两份在 DigiFiber 里各用哪种导入。用户对导入表用了「修改导入」，回报「删除成功，修改导入失败」，接着说「看看怎么失败了」「错误信息已经下载」。错误报告的表头以「ID*」开头，3 张表共 396 行（光缆段 8、光缆段路由 346、纤芯-熔接 42）全报「找不到关联的数据」。原因有两条：一，导入表是照新增导入模板（ImportAddTemplate）出的，没有记录 ID，而修改导入要按 ID 找已有记录；二，这几段光缆刚被删除表删掉，按 ID 也找不到。用户纠正：「你以后说清楚，必须是新增导入啊。。。」

**触发场景**：把生成好的文件交给用户去另一个系统（DigiFiber）手工导入。DigiFiber 有新增、修改、删除几种导入，交付说明只给了先后顺序，用户在导入入口前只能自己选，选错整批报错、白跑一趟。同一份导入表改用「新增导入」后导入成功，主 Agent 用新的全量导出逐行核：光缆段 8、熔接 42、成端 246、盒子出口 168 全部一致、没有重复；路由 346 行点与先后一致，只是 DigiFiber 把每段最后一个点的排序存成 10000。文件本身没毛病，毛病全在交付时没写明用哪种导入。

**教训/建议**：

（用户的原话只有最后一句；以下两条是主 Agent 落地时定的做法，不是用户原话）
- 交导入文件、写提示词、页面上写导入顺序时，导入方式与文件名写在同一行：DigiFiber删除表用「删除导入」，先导；DigiFiber导入表用「新增导入」，后导。只写「先导删除表、再导导入表」不够——顺序答的是先后，方式答的是点哪个入口。
- 用户报导入失败时，先看错误报告的表头再下结论：表头以「ID*」开头，说明是按修改导入跑的，不是文件内容错。

（以下为观察员注，不是用户原话；取自主 Agent 的描述与仓库文件）
- 按主 Agent 的描述，那句话是转述系统里写的顺序，页面当时写的也只是先后、没有导入方式，所以漏口在汇报和页面两处同时有；页面上的一句已改成同一句写明两种导入（见「本次落地」）。
- Product-Spec.md REQ-TRAD-007 还留着 10-12 的一句：DigiFiber 那边怎么导、重名怎么处理「现阶段不考虑」（来源引文里用户说「有覆盖导入，新建导入，删除导入」）。按来源引文看，它管的是产品不处理导入侧的重名与覆盖；11-04 之后交付文字要写明入口，两句并存。观察员推测：只读到 007 的实例可能把「不考虑」当成不用写入口；要不要在 007 那句后指向 011 的 11-04 补记，由主 Agent 定。
- progress.md TODO #181（T0511 补导，已押后）里仍写「用户在 DigiFiber 先导删除表、再导导入表」，没带导入方式；重启时那两份文件的交付照本条补。
- 「先看错误报告表头」属于用户全局指令「调试顺序：先看日志」已覆盖的做法，不另立。要不要把本条推到别的外部系统的导入，用户没说，本条不外推，推广前先问用户。

**适用范围与例外**：见 frontmatter。范围是传统段还原所有 DigiFiber 导入文件的交付与页面文字；例外未说明。不改 skill / rule 本体：这条主体是项目业务口径（哪份文件走哪种导入），按 .claude/rules/memory-systems.md 的分法已进 progress.md Decisions，下一角色靠派单包 Business Context 拿到——派单触及传统段还原的导出 / 导入页面文字或交付说明时，引 progress.md Decisions 2026-11-04 条和本条；用户说的是「你以后说清楚」，没说「以后都」要推成通用做法，按 CLAUDE.md 铁律 8 先不动本体。若用户要把它推成通用的交付话术，自然的落点是 `.claude/skills/dev-builder/SKILL.md` 的 [Phase 完成度判断] 收口项：给用户的文件类交付物，逐份写明在哪个系统、点哪个入口或用哪种模式、第几步；这与 rule-change-sweep-all-views-as-people-read-them-point-devices-still-check-port-pairs.md 的落点建议是同一处，两条合并评估（段名取自那条所记，本次未重读 dev-builder 本体）。

**本次落地**：主 Agent 已改：progress.md Decisions「2026-11-04（交 DigiFiber 导入文件必须写明导入方式：删除表用「删除导入」，导入表用「新增导入」）」（适用范围：传统段还原所有 DigiFiber 导入文件的交付与页面文字；取代：无）；用户 memory `digifiber-import-mode-explicit.md`；页面上写导入顺序的几处文字已重派 implementer，回执未到。skill / rule 本体未动。观察员核对：progress.md 的该条在位（读到时在第 686 行），内容与主 Agent 报告一致；用户 memory 文件在位；Product-Spec.md REQ-TRAD-011 末尾另有「2026-11-04 补」写明同一做法（主 Agent 未列入已落地清单，观察员读到）；`conflation/web/src/components/tradFeeder/RoomHeader.tsx` 的 `DELETE_ORDER_TEXT` 读到时已是「先用「删除导入」导 DigiFiber删除表，再用「新增导入」导 DigiFiber导入表（不是修改导入）」，其余几处（测试与替身数据里的同类文字）未逐处核对，页面这一项按「已重派、未验收」记。还没了结的两处：一，Product-Spec-CHANGELOG.md 里按「新增导入 / 删除导入 / 修改导入」搜不到 11-04 的对应条，Spec 与 CHANGELOG 成对改（铁律 6）的另一半看起来还没写，这条算不算需求变更由主 Agent 定；二，页面文字的验收。
