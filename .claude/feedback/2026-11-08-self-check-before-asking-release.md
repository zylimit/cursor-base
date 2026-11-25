---
type: feedback
description: 请用户敲 /release-builder 之前，主 Agent 先自己核审查标记、工作区、远端三项并写明结果，任一不满足不让用户敲
created: 2026-11-08
updated: 2026-11-08
graduated: true  # 2026-11-22 毕业→.claude/rules/dev-workflow-details.md [发布阶段]「回指之前」一句（用户 2026-11-22「毕业进框架」）
origin: lutetia
source_skill: release-builder
scope: 所有需要用户亲敲 /release-builder 的发版（release-builder 设了 disable-model-invocation，只能用户敲）；主 Agent 每次说「请你敲 /release-builder」之前
exceptions: none
supersedes: none
applied_to: 2026-11-22 .claude/rules/dev-workflow-details.md [发布阶段]「回指之前：主 Agent 先核三项并把结果写进回复」；mac-ts 的 lutetia 此前已在本地副本的同一处加过这句
---

# 让用户敲 /release-builder 之前先自检

**问题描述**：2026-11-08 同一会话里用户两次亲敲 `/release-builder` 都被 release-gate 拦下，理由都是 `.claude/.needs-review` 里还有待审文件。第一次（v0.3.0）确有未复核的增量，闸拦得对；第二次（v0.3.1 登录锁定开关）审查与复核其实已经 ACCEPT，但主 Agent 还没写 `echo clean > .claude/.needs-review`、改动也没提交，就提前告诉用户「接下来请你敲 /release-builder」。用户原话：「你能不能每次检查一下」。

**触发场景**：审查闭环刚收口、progress 记账与提交还在进行中时，主 Agent 在汇报里把「请你敲 /release-builder」当作下一步预告抛给用户，用户照做就撞闸。第二次的样子是：reviewer 复核 ACCEPT 后，主 Agent 并行做升版本号与派 progress-recorder，回复里已经写了让用户敲，而标记文件与工作区都还没就绪。

**教训/建议**：用户的每一次敲命令都是成本，撞闸等于主 Agent 的验收没做完。请用户敲之前必须先自己跑并在回复里写明三项结果：
1. `cat .claude/.needs-review` 为 `clean`——且只有审查闭环真完成（reviewer ACCEPT、HIGH 收口）后才写 clean，不为放行而写；
2. `git status --short` 为空——progress 等账已随提交入库；
3. `git ls-remote origin refs/heads/main` 等于本地 `git rev-parse HEAD`。
三项任一不满足，只说「还差什么、我正在做」，不让用户敲。预告下一步时也不提前写「请你敲」，等三项都过了再说。

**适用范围与例外**：每次需要用户亲敲 /release-builder 时都适用，包括小版本、配置类发版；没有例外。

**本次落地**：pending——主 Agent 尚未把这三项自检写进 release-builder 或 dev-workflow-details 的对应段；本次 v0.3.1 的三项自检由主 Agent 在下一条回复里补做。
