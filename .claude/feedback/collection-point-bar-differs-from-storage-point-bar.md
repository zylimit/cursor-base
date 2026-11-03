---
type: feedback
description: 多阶段信息管道（采集→核实→入库）里，采集口只该要求报手上的证据，入库口才要求报已验证的结论，不能用最后一道关的门槛卡第一道关
created: 2026-09-11
updated: 2026-09-12
graduated: true  # 2026-09-12 毕业→rules/subagent-dispatch.md 回执信封 Domain findings 栏「报线索不报结论」+ agents/domain-recorder.md 拒收线索；本文件留作细则参照
source_skill: N/A（领域口径库机制设计阶段）
scope: 任何"采集→核实→定论/入库"式多阶段信息管道的验收标准设计（本例：Sub-Agent 回执栏→domain-recorder 收录）
exceptions: 单阶段直接决策、没有中间"上报—核实"环节的场合不适用
supersedes: 未说明
applied_to: .claude/rules/subagent-dispatch.md 回执信封 Domain findings 栏（改写为"报线索不报结论"）；.claude/agents/domain-recorder.md [Non-goals]"只是「干活时撞见」的线索不收……按拒收处理并说明缺哪类依据"
---

# 采集口与入库口门槛不同——线索报证据，定论报结论

**问题描述**：
domain-rulings 草拟设计让子 Agent 在回执里报"领域口径"，并要求"必须有现场依据"——但子 Agent 干活时撞见的只是线索：现象真、解释未必真。用户纠正：线索与口径要分两级，子 Agent 那一栏只该要求"报你手上的证据"（实测结果、字段真实格式、真库实际状态），不该要求"报一条已经成立的口径"；口径的定论要等 AI 查外网、人查公司内部各自补齐依据之后才下，那不是子 Agent 一个人能做到的事。

**触发场景**：
设计一个多阶段信息管道（本例是"子 Agent 回执栏采集线索→domain-recorder 定论入库"两阶段）的验收标准时，把最后一道关的验收标准直接搬到了第一道关上。

**教训/建议**：
一条信息从产生到定论要经过几道手，就不能在第一道手上套最后一道的验收门槛——第一道手只负责"如实报手上有什么"，门槛定得太高，逼出来的是编造，不是更早的真相。

**适用范围与例外**：
适用于任何有采集/核实/入库分工的多阶段管道；不适用于没有分工、一次性直接判定的场合。

**本次落地**：
.claude/rules/subagent-dispatch.md 回执信封 Domain findings 栏改写为"报线索不报结论"；.claude/agents/domain-recorder.md [Non-goals] 同步写入线索不收、按拒收处理并说明缺哪类依据。
