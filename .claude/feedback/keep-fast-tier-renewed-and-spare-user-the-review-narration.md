---
type: feedback
description: 快速档到期就直接续，不用每次向用户报告；审查与各道闸的过程不要念给用户听，只说结论
created: 2026-10-12
updated: 2026-10-12
graduated: true  # 2026-10-30 毕业→dev-builder/SKILL.md fast 档段 + harness tier set fast --sticky（到撤销为止；过程不念只报结论）
source_skill: dev-builder
scope: 光功率独立项目这一轮连续开发期间，主 Agent 对档位的处理与向用户汇报的写法
exceptions: 地板闸（密钥外泄、危险 kill、发版）任何档都照跑；发版装配时 fast 档会直接判不过，那时要先回到标准档
supersedes: none
applied_to: progress.md Decisions 2026-10-12「快速档持续续期」；用户 memory `fast-dev-mode-minimal-testing.md` 补了续期一条
origin: digifiber-conflation-claude,digifiber-optical-evidence
---

# 快速档到期就续，过程别念给用户

**问题描述**：2026-10-12 这一天，主 Agent 两次在汇报里专门写「快速档我按原理由续到了几点，不同意说一声」，并在一天之内向用户逐条转述了多轮代码审查的过程（审查者攻了哪六处、谁算错了 16 行、Medium 第几条）。用户原话：「持续蓄快速吧，太无聊这些检视」。

**触发场景**：快速档有 8 小时硬上限，连续开发超过 8 小时就会到期；主 Agent 每次续期都当成一件要用户知情的事来报。同一天里审查出了实打实的问题，主 Agent 于是把审查过程也当成了值得细说的内容。

**教训/建议**（以下为主 Agent 的解读，不是用户原话）：
- 用户明确要的是：快速档一直续下去。到期前主 Agent 自己续，理由沿用，不再向用户报告、不再问。每次开工先看一眼剩余时间，不足两小时就续。
- 「太无聊这些检视」主 Agent 理解为两层：框架各道闸的检查过程无聊；主 Agent 转述的审查过程也无聊。所以向用户只说结论——有没有拦住东西、数字因此变了多少、要他定什么——不说审查者怎么攻的、哪条是 Medium。
- 这句话**没有**要求取消代码审查：当天的审查坐实了 5 个会让结果算错的问题（第一版质检里没照片的 16%、没照片却判 Pass 的 21% 是错报）。会影响结果对错的改动，主 Agent 仍然派审查，只是不把过程念给用户。这一条是主 Agent 的判断，若用户的意思是连审查也少做，需要他再说一句。

**适用范围与例外**：见 frontmatter。不改 skill / rule 本体；档位表 `profile.json` 也不动（改它会让本轮自动升到最严一档）。
