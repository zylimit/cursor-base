# 01 总览：这套框架是什么、不是什么

这章解决一个问题：装之前先知道它会怎么改变你和 Claude Code 的协作方式。读完你能说清四件事：它把工作分给谁、它靠什么拦住模型失控、它怎么让下一次会话接得上、以及它不替你做什么。

## 一句话

cc-base 是一套装进项目 `.claude/` 目录的 Claude Code 配置：主控提示词、18 个工作流 Skill、8 个专职 Sub-Agent、21 个注册 hook、一份项目记忆规则和一个可选的大仓治理引擎。它不依赖任何外部进程，Claude Code 原生读 `.claude/` 就生效。

## 它把工作分给谁

框架里只有一个编排者，其余都是工人。

| 角色 | 做什么 | 不做什么 |
|---|---|---|
| 主 Agent（你正在对话的那个） | 需求分析、拆 Task、写派单包、验收、写文档与记忆 | 不亲自写业务代码、不亲自审查、不亲自写测试跑测试、不亲自部署 |
| implementer | 按派单编码、编译验证、自检 | 不判「可提交」，不顺手改范围外的东西 |
| code-reviewer | 对照 Spec 审查，出 finding 与复现 | 只审不改 |
| tester | 写测、跑测、贴运行器输出 | 必须与写代码的实例不同 |
| deployer | 打包、部署、给产物清单 | 部署结果由主 Agent 独立核查 |
| progress-recorder / feedback-observer / evolution-runner / domain-recorder | 记忆、反馈、进化、领域口径 | 不碰业务代码 |

每次派发都是一个全新的 Sub-Agent 实例，不继承对话历史。主 Agent 必须在派单包里把上下文写全，这是隔离保证，不是习惯。细节在 [10 Sub-Agent 派发精通](10-subagents.md)。

## 它靠什么拦住失控

三层，由内到外：

1. **提示词**：`.claude/CLAUDE.md` 十条铁律，每条都写明「谁在守」。有机器闸的写闸名，没有的写「靠自觉」，不假装有闸。
2. **hook 闸**：Claude Code 事件上挂的 21 个 node 脚本。主 Agent 直接写 `src/` 会被拦；没验红就派 implementer 会被提醒或拦；读密钥文件、宽泛杀进程任何档都拦；压缩上下文前后各有一道把规则固化和回注。
3. **git 与 CI**：可选的 githooks 三件（pre-commit 静态检查、commit-msg、pre-push）和 GitHub Actions 五格，兜住不经 Claude Code 的提交路径。

闸有三档强度：`fast` 只提醒并记债、`standard` 是日常、`strict` 人当审批者。改了框架自身文件本轮自动升 strict，提交后回落。细节在 [09 闸门与档位](09-gates-and-tiers.md)。

## 它怎么让下一次会话接得上

项目根的 `progress.md` 是唯一的决策、约束、完成事项来源。规则叫「三文件同步」：决策一出现就写 progress.md，需求变更同时改 Product-Spec.md 与它的 CHANGELOG。`/recap` 读这三份文件恢复处境，`/clear` 之后也一样。上下文被压缩时，一道 hook 会把 Pinned 约束从文件重新派生注回，不靠摘要回忆。细节在 [08 记忆与恢复](08-memory.md)。

## 一个项目走过的路

```
想法
 → /product-spec-builder   向你学业务，写 Product-Spec.md，复述通过即签字
 → /arch-designer /dfx-designer /design-brief-builder /design-maker   （可选，M / L 档项目）
 → /dev-planner            写 DEV-PLAN.md，plan-lint 卡占位符
 → /dev-builder            每个 Task 先定 LOW / MEDIUM / HIGH，再派 implementer
                           LOW 主 Agent 自己验收；MEDIUM 加一轮 code-reviewer；HIGH 全套加 tester
                           每个 Phase 过四步走：审查 → 测试完整性 → 编译 → 功能
 → /code-review /bug-fixer /test-builder   （按需）
 → /release-builder        只能你亲自敲；部署后主 Agent 独立核查三件套
```

每一步的话术、签字点、产物在 [03 第一个项目](03-first-project.md) 里逐步走一遍。

## 它不是什么

- 不是代码生成器。它管的是「谁做、怎么验、怎么记」，代码质量仍取决于 Spec 写得清不清、派单包给得全不全。
- 不是外部编排器。没有守护进程、没有 tmux、没有第二个模型驱动。所有派发都是 Claude Code 原生的 Agent 工具。
- 不替你拍板。架构选型、不可逆操作、需求歧义、发版，框架会停下来等你。
- 不是越多越好。它自己的纲领是避免过度设计、过度测试、过度检视、过度可信：一条规则要么点名机器闸，要么明标靠自觉；一个闸要能说出它挡过什么；一条测试要能说出它防的回归。

## 目录里有什么

```
你的项目/
├── Product-Spec.md / Product-Spec-CHANGELOG.md   需求与变更
├── DEV-PLAN.md                                   分阶段计划
├── progress.md / progress.archive.md             项目记忆
├── <project-name>/                               代码
└── .claude/
    ├── CLAUDE.md          主控，126 行
    ├── settings.json      hook 注册与权限
    ├── rules/             主控下沉的细则，按路径自动加载
    ├── skills/            18 个工作流 Skill
    ├── agents/            8 个 Sub-Agent 定义
    ├── hooks/             21 个注册闸 + 共用库
    ├── harness/           档位表、审计脚本；ext/ 是可选的大仓引擎
    ├── scripts/           doctor、plan-lint、gate-audit、fast-mode 等
    ├── feedback/          你纠正过 AI 的记录与索引
    └── evidence/          闸的拦截账本、测试账本（运行态）
```

完整目录树在 `.claude/rules/file-structure.md`。

## 常见坑

- 把它当成「装了就自动变好」。没有 Product-Spec.md 时框架只会引导你先写需求，不会替你猜。
- 以为主 Agent 不能改任何文件。文档类（Spec、CHANGELOG、DEV-PLAN、progress、rules、skills）它可以直接写，拦的是业务源码路径。
- 在别的目录启动 Claude Code。`.claude/` 是按项目加载的，必须在装了框架的项目根启动。
