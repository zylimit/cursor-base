---
name: record
description: 当用户敲 /record，或说"记一下"、"把这轮的决定记进 progress"时使用。
---

[任务]
    /record 的入口：把本轮对话里的决策、约束、完成事项、新任务合并进 progress.md。本 skill 只负责派发，合并由 progress-recorder sub-agent 做。

[怎么做]
    - 收齐 delta：本轮或最近若干轮里还没落账的对话增量原文，加必要上下文；用户在 /record 后面跟了话，那句话就是要记的重点
    - 派 progress-recorder（fork 派发），mode 传 record，带项目根路径与 delta
    - 没有可记的东西（本轮没有决策 / 约束 / 完成 / 新任务）→ 直说「这轮没有要记的」，不为了记而派
    - 回执回来后核一眼 progress.md 的实际改动，回用户一句记了哪几条、进了哪个区块

[边界]
    模板、置信度判定、去重规则都在 .claude/skills/progress-recorder/SKILL.md，本 skill 不复述。同轮同时要 /record 与 /archive → 先 record 再 archive。
