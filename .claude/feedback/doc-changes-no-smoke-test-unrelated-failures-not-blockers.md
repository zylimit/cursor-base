---
type: feedback
description: 纯文档改动不跑冒烟测试；hook 自动报的门禁失败先判它和本次改了什么有没有因果关系，无关的不是阻塞
created: 2026-09-11
updated: 2026-09-11
occurrences: 1
graduated: false
source_skill: N/A
scope: 只动 .md / 文档目录的改动；以及任何阶段——用户已圈定当前该做什么时，AI 自己撞见的旁支问题
exceptions: 文档改动若会被机器闸真正拦住交付（如 pre-commit-check 硬拦提交），仍要处理，但处理的是「让这次交付过去」，不是「把既有债清干净」
supersedes: none
applied_to: 当场停止诊断 gate、照常提交（77786eb / ef15e0c 均在 gate=FAIL 状态下正常入库）；progress.md 由另派 progress-recorder 记录
origin: digifiber-conflation-claude,digifiber-optical-evidence
---

# 文档改动不跑冒烟测试，无关的门禁失败不是阻塞

**问题描述**：2026-09-11 做 ODN 业务知识对齐，用户连续投喂 19 份资料，明确说「你先只管吸收，我们再讨论」。期间每次 Write/Edit 落 MD，Stop hook 的 `harness-async-verify` 就报 `gate=FAIL`（web/api 的 `arch-boundary` + `governance-smoke`），并附一句「commit 前会被 pre-commit-check 硬拦，建议现在就修或派 bug-fixer」。主 Agent 被这句话牵着走，连着好几轮去跑 `catalog-lint`、`arch-check` 做诊断，还准备改 `module-catalog.json`。查到最后两条失败是既有债——`docs/` 下 9 个文件没在 catalog 里归类、`demo→api` 与 `web→api` 两条越禁边，跟正在写的那份 MD 一个字都不沾。用户两句话定规矩：「文档不搞冒烟测试」、「你先只管吸收」。

**触发场景**：两种情形叠在一起——① 本次改动只碰文档；② 用户已经明确圈定当前阶段该干什么，而 AI 自己撞见了一个旁支问题（hook 报错、扫描告警、顺手发现的债）。hook 的措辞天然带紧迫感（「硬拦」「建议现在就修」），最容易让人把「机器报了个红」当成「我必须现在解决」。

**教训/建议**：
- **改动性质决定该不该过质量门**。纯文档改动不跑冒烟/回归测试——没有可测的行为，跑了也只是把既有债的红重放一遍。
- **门禁红灯先判因果，再判要不要动**：问一句「这条失败和我这次改的文件有没有因果关系」。没有，就是既有债，记下来、告诉用户、继续手上的活；有，才是本次的阻塞。诊断既有债本身不是错，错在把它插进用户已经圈定的阶段里。
- **hook 的「建议现在就修」是默认话术，不是对本次改动的判断**。它不知道你改了什么，所以那句话对任何改动都一样说。判断权在主 Agent。
- **用户给了阶段性节奏指令（「先只管吸收」「暂时先这样」），就把该阶段做完再抬头**。撞见的旁支问题攒着一次性报，不要每撞见一个就停下来处理一个——那等于用自己发现的问题覆盖掉用户安排的顺序。
- 反过来也成立：既有债该报还是要报，只是报的方式是「一句话告诉用户有这么回事、等你安排」，不是「停下来先修」。

**适用范围与例外**：适用于文档类改动与「用户已圈定阶段」的任何改动。例外是这条债真的会卡住本次交付（比如提交被硬拦），这时要处理，但目标限定在「让这次交付过去」，不扩大成「把债清干净」。

**本次落地**：主 Agent 停止 gate 诊断，MD 照常提交——`77786eb`（ODN 知识基线 1085 行）与 `ef15e0c`（捞回的缺陷记录）都是在 `gate=FAIL` 状态下正常入库的，`pre-commit-check` 并未拦纯文档改动，说明当初那句「commit 前会被硬拦」对文档场景本就不成立。两条既有债（`docs/` 未归类、2 条越禁边）原样记着，等清代码债时一并处理。

**关联**：[[gates-need-empirical-validation]]（闸靠数据留——一条对文档改动恒红的闸就是这类无效成本）、[[scaffold-development-skip-quality-gates]]（按改动性质放水的同一思路）、[[repository-refresh-follow-explicit-scope]]（用户圈定范围时以当前指令为准）。
