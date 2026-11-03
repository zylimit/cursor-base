---
type: feedback
description: 新增闸/测试/审查层/记忆层/规则前先问是否踩了四个"过度"（过度设计/过度测试/过度检视/过度可信）——四者同根，根是过度可信；落地判据是规则要么点名机器闸要么明标靠自觉，闸能说出挡过什么，测试能说出防的回归，记忆能说出谁会读它
created: 2026-09-15
updated: 2026-09-15
graduated: true  # 2026-09-15 收录当天即落地：CLAUDE.md [铁律——每条写明谁在守] / progress.md Pinned 首条 / dev-workflow-details 三档表 / memory-systems 封顶 / progress-recorder 取代检查，见 applied_to
source_skill: N/A（评估会话，非某个 Skill 执行中）
scope: 给 cc-base 本体或下游项目新增任何闸 / 测试 / 审查层 / 记忆层 / 规则之前，以及评估或重构框架时（如"挑剔工程师"视角审视）
exceptions: 安全护栏（密钥 / 危险命令 / 不可逆操作）不受"避免过度"约束——该多重照样多重，四个"过度"不豁免地板闸
supersedes: 不取代、不删除 review-loop-converge-on-core-behavior-avoid-over-defense.md 与 meta-tests-not-in-release-chain-scaffold-stay-lean.md，两条各管各自机制（review 循环何时收口 / 元测试要不要进发版链）继续有效；本条把它们共享的诉求收编成一条更高层、跨机制的框架宪章级表述，供以后新增机制时先照这条问一遍
applied_to: .claude/CLAUDE.md [铁律——每条写明谁在守]；progress.md Pinned 第一条（2026-09-15）；.claude/rules/dev-workflow-details.md [项目开发阶段] 三档表；.claude/rules/memory-systems.md agent memory 封顶；.claude/skills/progress-recorder 归档与取代检查
---

# 避免过度设计、过度测试、过度检视——根源是过度可信

**问题描述**：用户以"挑剔的资深工程师"视角评估 cc-base 脚手架，中途打断，补了一句纲领："避免过度设计，过度测试，过度检视，过度可信"；随后拍板"不计成本，按照你的建议全部落地，一次彻底搞定"。这不是对某一次具体行为的修正，而是给整套框架划的一条长期方法论边界——四个"过度"点名的正是框架近期反复出现的默认动作：新增闸/测试/审查层，默认越多越安全。

**触发场景**：给 cc-base 本体或下游项目新增任何闸 / 测试 / 审查层 / 记忆层 / 规则之前；评估或重构框架时（如本次"挑剔工程师"式审视）。

**教训/建议**：
四个"过度"共享同一个根——**过度可信**，四种具体表现：
1. **信提示词能自律**：CLAUDE.md 十条铁律里六条标"靠自觉"、没有机器闸兜底，等于把纪律寄托在提示词的自我约束上。
2. **信闸能守**：tdd-gate 曾挂错事件，19 次拦停全部误伤——闸本身也会错，"加了闸"不等于"守住了"。
3. **信同模型复审能承重**：本仓 Pinned 里自己引用过 ICLR 2024 的研究，否定过"同模型自我复核可靠"这个假设，但机制设计上仍反复依赖它。
4. **信 149 条决策模型都能正确加权**：决策条目一多，无论人还是模型都无法保证每条都被正确检索、正确加权——记忆越厚，"每次都能用对"这件事越不可信。

落地判据（可操作、可检验，不是空喊"别过度"）：
- 一条规则要么点名机器闸、要么明标"靠自觉"，不留模糊地带——读者一眼就知道这条有没有兜底。
- 一个闸要能说出它挡过什么（呼应 gates-need-empirical-validation.md 的口径：长期全过/全绿的闸就是纯成本）。
- 一条测试要能说出它防的回归，不是"覆盖率好看"。
- 一段记忆要能说出谁在下一次会读它，读不出来就是给自己囤文档、不是给下一次决策囤证据。

**适用范围与例外**：与 frontmatter 一致——适用于给 cc-base 或下游项目新增闸/测试/审查层/记忆层/规则之前，以及评估或重构框架时；安全护栏（密钥、危险命令、不可逆操作）不受此约束，该多重照样多重；不取代 review-loop-converge-on-core-behavior-avoid-over-defense.md（管 review 循环何时收口）与 meta-tests-not-in-release-chain-scaffold-stay-lean.md（管元测试要不要进发版链），两条各自继续管各自的机制，本条是收编它们共享诉求后的更高层表述。

**本次落地**：纠正已当场应用到五处——① .claude/CLAUDE.md [铁律——每条写明谁在守]：十条铁律逐条标注"闸：xxx"或"靠自觉"，不留模糊地带；② progress.md Pinned 第一条（2026-09-15）记这条纲领本身；③ .claude/rules/dev-workflow-details.md [项目开发阶段] 三档表：Task 按 LOW/MEDIUM/HIGH 定档分配审查/测试强度，不再统一按最高标准跑；④ .claude/rules/memory-systems.md：agent memory 单文件封顶 5KB、每角色合计封顶 30KB，超了搬 docs/agent-notes/，防止"记忆越厚越安全"式无限累积；⑤ .claude/skills/progress-recorder：归档与取代检查落地，Decisions 追加前做取代检查、超阈值自动归档，防止决策条目无限膨胀到没人能正确加权。
