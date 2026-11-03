---
type: feedback
description: 用户拿一个外部 skill 仓问「对我们的 skill 有什么启发」时，问的是 SKILL.md 正文层面的写法与内容借鉴；不把范围扩到调用方式、子 Agent 接线、CLAUDE.md 调度段这些流程层
created: 2026-09-18
updated: 2026-09-18
graduated: false
source_skill: N/A（对照调研会话，非某个 Skill 执行中）
scope: 主 Agent 对照外部仓库 / 参考项目给本框架提借鉴建议时；对象词是「skill」就按 skill 正文与其 references 取范围
exceptions: 对照中查出的实锤缺陷（如 #69 deployer 预加载失效）照样如实报一次并挂 TODO，但不混进借鉴清单、不据此推流程改造；用户明说要看流程或接线时不受本条限
supersedes: none
applied_to: progress.md Decisions 2026-09-18「借鉴 mattpocock/skills 只取 SKILL.md 正文与其 references，现有流程不动」；progress.md TODO #69 修法句改为不动流程的那种；当前产物已转为只对照 grill-me / grilling 与需求、设计类 skill 正文（进行中）；skill / rule 本体未动
---

# 对照外部 skill 仓找借鉴，范围是 skill 正文，不是流程

**问题描述**：用户说「看看我们的skill, 在这里 /home/z00632348/code/other/skills 有什么启发和学习」。主 Agent 读完 mattpocock/skills 后给了四项建议，其中两项动的是流程层——把 release-builder 拆成用户入口与可预加载正文两层；给四个标「手动」的 skill 关模型调用并去掉 CLAUDE.md 里重复的触发词。用户纠正：「我关注的是Skill里面的借鉴，之前的流程不想变」，随后收窄为「先看看grill-me 在需求，设计，上有什么借鉴」。

**触发场景**：拿外部 skill 仓、参考项目与本框架对照找借鉴；用户的提问对象是「skill」，没有提流程、调用方式或接线。

**教训/建议**：对象词定范围。问的是 skill，就对照 SKILL.md 正文与 references 里的写法和内容：怎么问、怎么收敛、步骤有没有完成判据、哪段该下沉。skill 之间的先后与路由、谁能触发、子 Agent 怎么拿到 skill、CLAUDE.md 调度段，这些是流程，用户没问就不进建议清单。先给窄范围里最贴的一两个 skill 的对照，用户要再展开，不一上来铺全仓四项。

**适用范围与例外**：适用于一切「对照外部做法给本框架提建议」的调研。对照里顺带查出的实锤缺陷不算扩范围，报一次、挂 TODO、修法另议；但不借缺陷之名把流程改造带进来。用户明说要评流程或接线时按用户说的范围来。同族旧条：repository-refresh-follow-explicit-scope.md（用户给了范围，主 Agent 擅自加重）。

**本次落地**：progress.md Decisions 记了 2026-09-18 这条范围约束，三要素齐；动流程的两项建议未入库即撤回；TODO #69 的候选修法从「拆两层」改成「deployer.md 正文加一句先读 SKILL.md」这类不动流程的修法。主 Agent 已转去只对照 grilling 与 product-spec-builder / design-brief-builder / arch-designer 的正文。skill 与 rule 本体这次没有改动。
