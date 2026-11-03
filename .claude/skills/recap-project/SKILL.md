---
name: recap-project
description: 当用户敲 /recap-project、说 recap 或"恢复上下文"、"现在做到哪了"，或新 session 开头、/clear 之后要接上项目状态时使用。
---

[任务]
    恢复项目上下文：把磁盘上的项目记忆读回来，回用户一段「现在在哪」。只读，不改任何文件，不派 Sub-Agent。
    接住就干——不开场白、不先复述本 skill 会做什么。

[为什么叫这个名字]
    Claude Code 自带一条 /recap（给当前会话出一行摘要），带斜杠的 /recap 会被它接走、到不了模型，新 session 第一句敲它只会得到「Nothing to recap yet」。本 skill 是框架自己的入口，名字避开自带命令。不带斜杠的 recap 照常可用，走的也是这里。

[读什么]
    存在即读，不存在的跳过不报错：
    - progress.md → Pinned、现存 Decisions、当前断点、TODO；文件过大读不完时按区块分段读，不拿前半截当全文
    - Product-Spec.md → 需求现在长什么样
    - Product-Spec-CHANGELOG.md → 需求最近怎么变的
    不读 progress.archive.md。只读 progress.md 不算恢复完成。

[回什么]
    - 现在在哪：分支与工作树状态、最近一批完成的事、断点停在哪
    - 仍在生效的约束：Pinned 与近期 Decisions 里影响下一步的那几条，不全文照抄
    - 还开着的：未关闭的 TODO，按优先级
    - 对不上的地方：断点段过期、工作树有未提交改动而 progress.md 没记、归档触发线已过——看到就点名
    - 下一步：给一条建议，等用户定
    用户确认的事实、自己的推断、建议分开说。三份文件都不存在时回一句「还没有项目记忆」，转 [项目状态检测与路由]。
