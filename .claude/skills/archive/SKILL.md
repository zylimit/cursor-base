---
name: archive
description: 当用户敲 /archive，或说"归档 progress"、"progress 太长了收一下"时使用。
---

[任务]
    /archive 的入口：把 progress.md 里过线的历史条目原文搬进 progress.archive.md。搬运是机械活，交给脚本，不让模型逐字敲。

[怎么做]
    - `.claude/scripts/progress-archive.mjs` 在 → 主 Agent 直接跑 `node .claude/scripts/progress-archive.mjs`，读完输出与退出码，回用户搬了哪几组、各搬几条
    - 脚本不在（老安装）→ 派 progress-recorder（fork 派发），mode 传 archive，按 .claude/skills/progress-recorder/SKILL.md [快照归档] 手工搬
    - 没有哪组过线 → 回一句「没到归档线」并报当前条数，不硬搬

[边界]
    触发线、保留线、先写归档后删正文的顺序都以脚本与 progress-recorder SKILL.md 为准，本 skill 不复述。Pinned 与未关闭的 TODO 永不搬。同轮同时要 /record 与 /archive → 先 record 再 archive。
