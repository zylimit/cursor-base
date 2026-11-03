---
type: feedback
description: 测试独立性——写测者不得是被测代码作者；自码自测会把作者的错误假设原样写进断言（confirmation bias），测试派独立方（tester Sub-Agent 或非作者的另一 implementer fresh 实例）
created: 2026-06-03
updated: 2026-06-03
graduated: true  # 毕业→已落地 test-builder SKILL + tester Sub-Agent + CLAUDE.md [Sub-Agent 调度规则] 写测独立性；本文件留作细则参照
source_skill: test-builder
scores:
  accuracy: 3
  coverage: 3
  efficiency: 4
  satisfaction: 3
  evidence: "精准度3：skill 默认路由（测试派被测代码作者写）被用户当场否定，方向性修正非微调。覆盖度3：skill 原本未覆盖『写测与被测分离』这一角色约束，靠用户指出才补。效率4：一次点破即采纳并落地。满意度3：用户提出明确修改意见（路由必须改），非无负面评价。"
---

# 测试独立性：写测者 ≠ 被测代码作者（自码自测易作弊）

**问题描述**：
test-builder skill 最初默认「测试代码派写该代码的同一实现者写」，未区分写测者与被测代码作者是否同一人。用户在为某后端导出功能补回归测试时指出：让写代码的 Agent 自己写自己代码的测试容易"作弊"——它会把代码作者那套（可能本就错的）假设原样写进断言，测试通过只证明"代码符合作者的想象"，而非"代码符合 Spec"。这是典型的 confirmation bias：自判自卷，无法暴露作者的认知盲区。

**触发场景**：
为某功能补回归测试时，代码刚由一个 implementer 实例写完。把测试编写路由给一个**未参与该代码**的独立 Sub-Agent（tester），验证了"独立方写测"的可行性。

**教训/建议**：
核心原则「写测与被测分离」：测试编写者不得是被测代码的作者。自码自测无法发现作者的认知盲区，约等于自判自卷。

How to apply（角色路由）：
1. 代码刚由 implementer 写完 → 测试派 **tester Sub-Agent** 写（fresh 实例，未见过该代码的实现细节）；
2. 或派非该功能作者的另一 implementer fresh 实例（隔离原则配合，提供完整 Spec 上下文，而非让它读作者的实现去抄假设）；
3. 主 Agent 始终不亲自写测试代码（沿用既有「主 Agent 只写提示词 + 验收」铁律）；
4. 主 Agent 独立复核测试运行的真实输出，不轻信子 Agent 自报"测试通过"。

已落地：新增 tester Sub-Agent（.claude/agents/tester.md），其角色明确「不是被测代码作者，按 Spec 写断言」；test-builder SKILL.md 的 [第一性原则] 写明「写测与被测分离」，[编写与执行（角色路由）] 改为 tester 优先；CLAUDE.md [Sub-Agent 调度规则] 列入「写测独立性」铁律。
