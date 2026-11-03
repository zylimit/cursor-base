# cc-base 使用指南

这套指南面向第一次用 cc-base 的工程师，按「入门 → 进阶 → 精通」三段编排。每章开头说明它解决什么问题、读完你能做什么；每条命令都能在仓库里找到出处，照抄就能跑。

## 怎么读

| 你是谁 | 从哪读 | 读完能做什么 |
|---|---|---|
| 第一次装、想半天内跑通一个小项目 | 01 → 02 → 03 | 装好框架、走完从想法到发布的最短路径 |
| 已经跑通一个项目，想用得对 | 04 → 05 → 06 → 07 → 08 | 需求迭代、Task 分档派单、审查测试收敛、发布验收、记忆恢复 |
| 要维护框架本身、接大仓、写自己的 skill 和 hook | 09 → 10 → 11 → 12 → 13 | 读懂每道闸与档位、精通派单、开大仓治理、改造与扩展、排障 |

## 目录

入门

- [01 总览：这套框架是什么、不是什么](01-overview.md)
- [02 安装与初始化](02-install.md)
- [03 第一个项目：从想法到发布走一遍](03-first-project.md)

进阶

- [04 需求与设计：Spec 迭代、架构、DFX、设计稿](04-requirements-and-design.md)
- [05 开发精讲：Task 三档、派单包、四步走、Git 工作流](05-development.md)
- [06 审查、测试、修复](06-review-test-fix.md)
- [07 发布与部署验收](07-release.md)
- [08 记忆与恢复：progress.md、feedback、口径库](08-memory.md)

精通

- [09 闸门与档位：每道 hook 什么时候响、怎么放行](09-gates-and-tiers.md)
- [10 Sub-Agent 派发精通](10-subagents.md)
- [11 大仓治理可选包](11-large-repo.md)
- [12 框架自测与 CI](12-selftest-ci.md)
- [13 定制与扩展：改主控、加 skill、加 hook、进化引擎](13-customize.md)
- [14 故障排查](14-troubleshooting.md)
- [15 术语表](15-glossary.md)

## 约定

- 命令默认 bash（Mac / Linux / WSL / Git Bash）；Windows PowerShell 有差异的地方单独标出。
- 「你会看到」后面的输出是真跑出来的，版本不同细节可能略有出入。
- 路径以项目根为基准，框架自身文件都在 `.claude/` 下。
- 指南随仓库走，不随 `setup.sh` 装进目标项目；在线读 GitHub 上的 `docs/guide/`。
