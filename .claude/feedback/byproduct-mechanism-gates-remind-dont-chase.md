---
type: feedback
description: 给副产品性质的新机制配验收闸时，先判它是流程必经还是副产品——副产品闸只在回执确有发现时提醒一句，不因缺栏目催报；催出来的是凑数，进库即噪音
created: 2026-09-11
updated: 2026-09-12
graduated: true  # 2026-09-12 毕业→CLAUDE.md [领域口径库] + rules/domain-rulings.md [定位与边界]「它是副产品，不是流程环节」；hook 方向已反转并红锁；本文件留作细则参照
source_skill: N/A（领域口径库机制设计阶段）
scope: 给任何"有最好、没有也不算数"的副产品性质机制设计验收闸/提醒规则时
exceptions: 流程必经的硬性节点（四步走、发布卡点、Spec 签字门等）不适用——这类该催缺、该拦停，机制目的就是不允许缺
supersedes: 未说明（本条是对本 session 内刚起草、尚未单独成文的旧设计的当场纠正，没有旧 feedback 文件可取代）
applied_to: .claude/hooks/subagent-acceptance-reminder.mjs（方向已反转：缺栏目不点名，有发现才提醒；tester 补三条红锁验证、主 Agent 验红、implementer 修绿，test-hooks-node 跑出 PASS=25 FAIL=0，后续补齐 None 六臂与真发现两臂后为 31/0）；.claude/rules/domain-rulings.md [定位与边界]"它是副产品，不是流程环节"一条与 [两条硬约束与回流去向]"该栏填不出就写 None，不逼着凑"一条；.claude/CLAUDE.md 新增 [领域口径库] 段；.claude/rules/subagent-dispatch.md 回执信封 Domain findings 栏的 None 解析边界说明
---

# 副产品机制配闸：只在有发现时提醒，不因缺栏目催报

**问题描述**：
上个会话把领域口径库接成了开发流程的一环，采集闸（subagent-acceptance-reminder.mjs）写成"子 Agent 回执缺 Domain findings 栏就点名"——缺栏目即催报。用户纠正：口径库是需求分析/澄清/方案设计过程中的副产品，有最好、没有也不能强制报错；闸要反过来，只在回执里确实有领域发现时才提醒一句该不该收。用户的理由："副产品不该催，催出来的是凑数，而凑的没有依据，进库即噪音，那正是规则自己要防的东西。"

**触发场景**：
为新增的、非流程必经的"副产品"性质机制（本例是领域口径采集）设计配套的验收闸/提醒钩子时，习惯性照搬了"缺项就点名"这种适用于必经节点的闸门逻辑。

**教训/建议**：
给新机制上闸前先问一句：这是"流程必经"还是"副产品"？必经步骤该催缺、该拦停；副产品只该在"确有产出"时提醒一句，不该因为"没产出"就点名——催缺等于逼着子 Agent 为了不被点名而现编一条，编出来的东西没有真实依据，反而污染了机制本来要保护的东西。
落地这条时顺带核实、决定了两处实现细节，记在这里备查：① 官方文档（2026-09-11 核证，https://code.claude.com/docs/en/hooks；旧地址 docs.claude.com/en/docs/claude-code/hooks 已 301 到新域）确认 SubagentStop 与 Stop 一样带 `last_assistant_message` 字段，可直接用它取子 Agent 回执，不必读 transcript。② 闸对该字段是按字面判的——回执把该栏写成 `None（本次纯只读）` 会被当成"有发现"从而多触发一句提醒；取舍是不放宽解析（放宽会连带吞掉写在括注里的真发现），改而要求回执信封侧写裸 `None`。这个取舍本身也可泛化：字面匹配的闸遇到边界案例，优先靠"约定生产者怎么写"解决，不靠"放宽消费者的解析"解决——放宽通常连带牺牲了原本要保护的精度。

**适用范围与例外**：
适用于设计任何"有最好、没有不算数"的副产品机制的验收/提醒闸；不适用于流程必经节点（四步走、发布卡点、Spec 签字门等），这些该催缺、该拦停。

**本次落地**：
.claude/hooks/subagent-acceptance-reminder.mjs 方向已反转；.claude/rules/domain-rulings.md 的 [定位与边界] 与 [两条硬约束与回流去向] 两段写入该判断；.claude/CLAUDE.md 新增 [领域口径库] 一段总述这一定位；.claude/rules/subagent-dispatch.md 回执信封 Domain findings 栏写入 None 的括注解析边界。
