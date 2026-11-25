---
type: feedback
description: 用户确认「再花力气认真写说明」值得，并要求借写文档的难处倒逼模块划分更好；随后讲深一层：文档即代码，文档乱就是设计不合理、架构在腐化，结构化之后写代码前要先想清楚
created: 2026-11-24
updated: 2026-11-24
graduated: false
origin:
source_skill: readable-docs
scope: 人读文档的说明撰写（readable-docs），连带开发时新加的表与模块（dev-builder）、模块划分（arch-designer）、人读文档核对（code-review）
exceptions: 未说明
supersedes: none
applied_to: .claude/skills/readable-docs/SKILL.md [写说明]与[架构设计]；.claude/skills/readable-docs/references/dispatch-templates.md；.claude/skills/dev-builder/SKILL.md [人读文档]；.claude/skills/arch-designer/SKILL.md 单一职责违反信号；.claude/skills/code-review/SKILL.md 人读文档核对；docs/guide/16-readable-docs.md；docs/readable-spec/Product-Spec.md（规则与例外一行、澄清记录一行）；progress.md Decisions；追加一轮见「本次落地」第二段
---

# 说明一定要认真写，写不顺是模块没分好的信号

**问题描述**：不是纠错，是方向确认加一条方法要求。用户问「这个就是首次建文档慢，后面就快了吧」，主 Agent 答：对，慢的只是给存量补说明，并列了四种之后还会再花一次力气的情况（某个任务一口气改了很多表或模块、框架升级改了页面格式或说明绑定方式要重出、别的项目以后补存量、后几期新文档种类各有首次成本）。用户回：「你说的这些情况，那是非常值得，而且一定要认真写，这也促使，你去更好划分模块，避免文档难写」。

**触发场景**：readable-docs 的首次建文档与后续重写说明的成本讨论。主 Agent 在回答里把「再花力气」当成要交代的代价，用户的意思是这些力气值得花，且要借它改进划分。

**教训/建议**：以下三条是主 Agent 对用户话的解读，不是用户逐条说的，只有上面那句引文是用户原话。
1. 那几种情况下再花的力气是值得的，不要想办法省掉或绕开。
2. 说明的质量要求是硬的（用户用了「一定要」）：量大也要一段一段照现在的代码认真写，不套话、不把名字翻译一遍交差。
3. 说明写不顺是设计上的信号：一句话说不清一张表存什么、一个模块管什么，多半是表或模块没分好。属于项目判断的（文档里的分组与模块划分）回头调；新写的代码在开发时就把边界划顺；不拿一段绕的说明盖过去。

**用户接着说的（同日，看到落地之后）**：
「文档既代码，文档乱说明代码乱，说明设计不合理，说明架构在腐化，一切都暴露在阳光下，无处躲藏」
「之前混在一起，你想怎么写怎么写，写到哪里是哪，文档结构化以后，你要思考的东西更多」

以下四条是主 Agent 的解读，不是用户逐条说的：
1. 文档是代码结构照出来的镜子：说明写不顺、模块之间绕成环、有文件哪个模块都放不进，都不是文档的毛病，是设计不合理、架构在变坏；文档不能替代码遮丑。
2. 上一段「写不顺就回头改划分」有个口子：调划分也可以被用来让循环依赖之类的数好看。所以补一条：调划分只因为原来分错了，不是为了让数好看。
3. 文档结构化之后，写代码之前就得先想清楚：新加的文件、表归哪个模块、哪个分组、一句话管什么，不能写到哪算哪。
4. 结构的数（循环依赖、越层引用、未归属的文件）不许悄悄变坏：派单前记基线，交回时多出来的修掉或写明原因进 Phase 结论，审查时对照。

**适用范围与例外**：凡是写人读文档的说明、提模块划分、开发中新加表或模块时按这条来。例外用户没说明。代码或表结构本身该拆的，不由文档擅自改，单列出来交给用户。

**本次落地**：主 Agent 同一轮已改：readable-docs SKILL.md [写说明]加两条（认真写；写不顺是信号，项目判断的回头改 map.json，代码或表结构本身该拆的单列交用户）、[架构设计]提模块划分后给每个模块试写一句话职责、写不出的回头重分；dispatch-templates.md 分批写模块说明的派单与收回后的处理各加一句；dev-builder [人读文档]加一条；arch-designer 单一职责违反信号加一句；code-review 人读文档核对加一句（应付的说明按未完成记、绕的标出来）；docs/guide/16-readable-docs.md、readable-spec 的 Product-Spec.md（规则与例外、澄清记录带原话）、progress.md Decisions 同步。本条 feedback 只记录，不再动技能本体。

追加一轮（紧接着的一个提交）：readable-docs SKILL.md [任务]加「文档即代码」一段，[写说明]那条「写不顺是信号」补「调划分不是为了让数好看」，派单模板同步；dev-builder [人读文档]加两条（先想清楚再写；结构的数不许悄悄变坏），Phase 收尾加一句（与开工前比一遍，多出来的写进 Phase 结论与残留）；implementer.md、rules/subagent-dispatch.md、code-review、arch-designer 各补一句；docs/guide/16-readable-docs.md 加「文档即代码」一小节；readable-spec Product-Spec.md 规则表与澄清记录各加一行；progress.md Decisions 加一条、TODO 加一条（#149：提交时结构变坏要有机器当场提醒，还没做）。
