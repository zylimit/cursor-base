---
name: archive
description: 当用户敲 /archive，或说"归档 progress"、"progress 太长了收一下"、"DEV-PLAN 太长了"时使用。
---

[任务]
    /archive 的入口：把 progress.md 里过线的历史条目原文搬进 progress.archive.md，把 DEV-PLAN.md 里做完的 Phase 原文搬进 DEV-PLAN.archive.md。搬运是机械活，交给脚本，不让模型逐字敲。

[怎么做]
    - `.claude/scripts/progress-archive.mjs` 在 → 主 Agent 直接跑 `node .claude/scripts/progress-archive.mjs`，读完输出与退出码，回用户搬了哪几组、各搬几条
    - 项目有 DEV-PLAN.md 且 `.claude/scripts/plan-archive.mjs` 在 → 再跑 `node .claude/scripts/plan-archive.mjs`；它搬过东西就接着跑 `bash .claude/scripts/plan-lint.sh DEV-PLAN.md <需求来源路径>`，仍过才算搬完。脚本报「没标 ✅ 的 Phase：N 个」时把数字带给用户——排在已完成的 Phase 之前却没标 `✅` 的，脚本不搬；是做完没标还是跳过没做要逐个核实，核实后补标再跑；报「编号认不出的 Phase 标题：N 个」的同样带给用户，那是 `## Phase 5.x` 这类编号不是整数的标题，改成整数才搬得动
    - 脚本不在（老安装）→ 派 progress-recorder（fork 派发），mode 传 archive，按 .claude/skills/progress-recorder/SKILL.md [快照归档] 手工搬；DEV-PLAN 没有脚本就不搬，提醒升级框架
    - 没有哪组过线 → 回一句「没到归档线」并报当前条数与体积，不硬搬

[边界]
    触发线、保留线、先写归档后删正文的顺序都以脚本与 progress-recorder SKILL.md 为准，本 skill 不复述。Pinned、未关闭的 TODO、没带 `✅` 的 Phase 永不搬。同轮同时要 /record 与 /archive → 先 record 再 archive。
