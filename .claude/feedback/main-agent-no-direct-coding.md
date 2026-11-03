---
type: feedback
description: 主 Agent 只写提示词 + 委派 + 验收，不亲自写代码/审查/测试/部署；编码=implementer、审查=code-reviewer、测试=tester、部署=deployer（全部 Claude Code Sub-Agent）
created: 2026-06-03
updated: 2026-06-03
graduated: true  # 毕业→CLAUDE.md [总体规则] 职责边界铁律 + 收口开发/修订两节；本文件留作细则参照
source_skill: product-spec-builder
---

# 主 Agent 职责边界：编码/审查/测试/部署一律委派专职 Sub-Agent，主 Agent 只写提示词 + 验收

**问题描述**：
用户对主 Agent（SiteMaster 编排者）的工作方式给出明确纠正：
1. "你不能写代码只能下命令和验收"
2. "你要写代码，也必须先给提示词，然后启动子 Agent 来搞，你再验收"

核心诉求：到了**代码实现环节**，主 Agent 一律不亲自动手，必须严格执行闭环——
先写好提示词 → 派发 Sub-Agent 实现 → 主 Agent 对照 Spec 验收。
用户特别强调要严格执行、不可图省事自己写代码。

补充纠正：用户把「只写提示词 + 验收」的边界从**编码**扩展到**审查**、**测试**、**部署**：
1. "审查别自己来，效果不好，派审查的子 Agent"
2. "测试要找没写这段代码的另一个去写"（写测≠被测作者）
3. "部署也派子 Agent，你只验收"

含义：编码 / 审查 / 测试 / 部署四个环节，主 Agent 全程只「写提示词 + 验收」，一律派发对应的 **Claude Code Sub-Agent**（用 Task/Agent 工具，fresh 实例）。

**触发场景**：
处于需求迭代（product-spec-builder 迭代模式）。主 Agent 直接编辑了 Product-Spec.md 和 Product-Spec-CHANGELOG.md（文档更新，属 PM 本职，在用户认可范围内），随后用户抛出上述纠正，把约束指向「即将进入的代码实现环节」。

**边界澄清（用户意图核实后）**：
- **受约束**：编码 / 审查 / 测试 / 部署四个环节 → 一律派发专职 Sub-Agent，主 Agent 只写提示词 + 验收，不亲自动手。
- **不受约束**：文档类工作（Product-Spec.md / Product-Spec-CHANGELOG.md / DEV-PLAN.md）属 PM 本职，主 Agent 可直接写。

**环节 → 派发目标对照表**（全部为 Claude Code Sub-Agent，Task/Agent 工具派发 fresh 实例）：

| 环节 | 派发目标 Sub-Agent | 主 Agent 职责 |
|------|------|--------------|
| 编码 | implementer | 写提示词 + 验收 |
| 审查 | code-reviewer | 写提示词 + 验收（不自己审查） |
| 测试 | tester（写测≠被测作者，须与实现者不同的 fresh 实例） | 写提示词 + 独立复核运行输出 |
| 部署 | deployer | 下命令 + 验收（不自己执行部署，独立核查三件套） |
| 文档 | 主 Agent 自己 | 不受约束 |

**Why（为什么用户要这么做）**：
- 隔离保证：主 Agent 上下文长、易被历史污染；用 fresh Sub-Agent 实例做编码/审查/测试，配合主 Agent 独立验收，形成「实现-审查」分权，质量更可控。
- 既有规则曾给主 Agent「自主判断是否亲自开发」的口子，用户的纠正等于**收紧该口子**：编码一律委派，不再给主 Agent 自己写的选项。

**教训/建议（How to apply）**：
1. **编码**：进入任何编码环节（含需求迭代「执行代码变更」），默认派发 implementer Sub-Agent，不再走「主 Agent 直接开发」分支。
2. **审查**：进入任何 code review 环节（功能完成后的 review→fix 闭环、手动 /code-review），派发 code-reviewer Sub-Agent。不再让主 Agent 自己审查——用户明确「自己审查效果不好」。
3. **测试**：进入测试环节，派发 tester Sub-Agent，且必须是与写该代码的 implementer **不同**的 fresh 实例（写测≠被测作者，见 test-independence-author-not-tester.md）。
4. **部署**：进入任何 release/deploy 环节，派发 deployer Sub-Agent，主 Agent 不亲自跑部署命令，只下命令 + 验收（独立核查三件套，见 deploy-acceptance-independent-verification.md）。
5. 派发前主 Agent 必须先产出**明确的提示词**（任务上下文：变更的 Spec 条目、交付清单、涉及文件、项目结构）——Sub-Agent 不继承 session 历史，缺上下文会瞎猜。
6. 四个环节的 Sub-Agent 完成后，主 Agent 只做**验收**：对照 Spec + 核查客观证据，不亲手改源码、不亲手审查、不亲手部署。
7. 区分清楚边界：文档（Spec/CHANGELOG/DEV-PLAN）主 Agent 直接写，编码/审查/测试/部署一律委派。
