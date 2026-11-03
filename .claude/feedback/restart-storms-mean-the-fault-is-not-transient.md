---
type: feedback
description: 服务崩溃循环意味着故障不是瞬时的：崩溃重启带退避但在时间窗内封顶，超限就停、标崩溃、留日志，下一步是诊断不是再试；活着但健康探针不过是同一种故障
created: 2026-11-04
updated: 2026-11-04
graduated: false
origin: cursor-base（docs/feedback/restart-storms-mean-the-fault-is-not-transient，2026-08-07）
source_skill: N/A
scope: 带守护重启的服务与进程监督（含 cc-base 的 scripts/supervisor 这类守护脚本）
exceptions: 一次性、有明确外因的崩溃（依赖刚重启、端口被占用后释放）可在预算内重试，预算用完照样停
supersedes: none
applied_to: pending（自 cursor-base docs/feedback 迁入，待进化引擎评估）
---

# 重启风暴意味着故障不是瞬时的，要显式失败并留证据

**问题描述**：被守护的服务崩溃循环，被无限重启。机器空转烧算力，原始崩溃原因随日志轮转被冲掉，从远处看循环就是「在运行」。无限重启把一个能诊断的故障变成了看不见的故障。

**触发场景**：cursor-base 原文说明是从各兄弟库的守护设计与崩溃循环记录里提炼的（2026-08 交叉吸收审查，2026-08-07），未给出单次事件的提交或日期。

**教训/建议**：
1. 崩溃就重启，带指数退避，但在时间窗内封顶次数。
2. 超限后停止重启、把服务标成崩溃、保留日志：故障是结构性的，下一步是诊断，不是再试一次。
3. 进程活着但健康探针不过，是同一场故障的安静版本，按故障处理，不按「在跑」放过。
4. 状态以进程实况（pid）为准，不以记录的状态为准。

**适用范围与例外**：见 frontmatter。cursor-base 侧已有机械兜底（熔断器、按 pid 报活、会话开始时风险扫描）；cc-base 的 supervisor 脚本是否带重启预算、是否按 pid 报活，本次未核对，不在此下结论。

**本次落地**：pending。落点建议：核对 .claude/scripts/ 下 supervisor 的重启上限与日志保留，缺什么补什么；本条不动规则本体，等进化引擎评估。
