---
type: feedback
description: 多个独立 git repo 的提交必须分开、各自独立处理，不能为图省事耦合进同一个脚本——尤其当它们归属不同、远程协议/认证方式不同（ssh vs https）时，耦合会掩盖单点失败，造成"半成功"烂局
created: 2026-06-04
updated: 2026-06-04
graduated: true
source_skill: N/A  # 框架维护/提交流程，非某产品 Skill 执行中
scores:
  accuracy: 3
  coverage: 3
  efficiency: 3
  satisfaction: 3
  evidence: "精准度3：把两个独立 repo 的提交耦合进一个脚本是方向性错误，被用户当场否定（『不对吧』『我两个是分开的』），非微调。覆盖度3：CLAUDE.md/dev-builder 的 Git 工作流未覆盖『本项目含两个独立 repo（主仓 https + .claude=sitemaster-config ssh）』这一拓扑，AI 临时发明了单脚本耦合做法。效率3：耦合脚本导致 https 主仓 push 失败、本地卡 ahead 1，需额外来回收拾。满意度3：用户提出明确修改意见（两者必须分开处理）。"
---

# 多 repo 提交隔离：独立 repo 各自提交，禁止耦合进同一脚本

**问题描述**：
本项目工作目录 `/home/ubuntu/code/pre-survey-map` 实际包含两个**完全独立**的 git repo：
- 主仓 `pre-survey-map`：项目代码 + 文档（Product-Spec / DEV-PLAN / progress.md 等），origin = **https**；
- 配置库 `.claude/` = `sitemaster-config`：框架定义（CLAUDE.md / skills / agents / feedback），单独 push 到 `github.com/zylimit/sitemaster-config`，origin = **ssh**。

主 Agent 为「一次提交两边改动」（框架改动→sitemaster-config、progress.md→主仓）图省事，写了一个 `/tmp/commit_progress.sh`，把两个独立 repo 的 `add/commit/push` 全耦合进同一个脚本一次跑。结果：sitemaster-config（ssh，有 key）push 成功；主仓（https，无凭证）push 失败——progress.md 已 commit 但卡在本地 `ahead 1`。"半成功"烂局，用户当场指出："不对吧""我两个是分开的""`.claude` 是单独一个项目"。

**触发场景**：
需要同时提交框架改动（落入 .claude=sitemaster-config）与项目文件改动（落入主仓 pre-survey-map）时。两 repo 归属不同、远程协议/认证方式不同（ssh vs https）。

**教训/建议**：
核心原则「独立 repo，独立提交」：涉及多个独立 git repo 时，每个 repo 的 add/commit/push 必须分开、各自独立成步处理，不得为省事耦合进同一个脚本/同一条命令链。

为什么不能耦合：
1. **掩盖单点失败**：脚本串行跑，前一个 repo 成功、后一个失败时，整体看似"跑完了"，实际半成功，失败被噪声淹没；
2. **认证差异放大风险**：ssh 与 https 的凭证就绪状态不同，耦合脚本无法对各自的认证失败分别给出清晰反馈；
3. **回滚/重试粒度错位**：一个脚本里两 repo 状态交织，出错后难以判断该重试哪一个、各自处于什么状态。

How to apply：
1. 先明确改动落在哪个 repo（框架文件 → .claude=sitemaster-config / 项目文件+文档 → 主仓 pre-survey-map），分桶；
2. **逐 repo 独立执行** add → commit → push，每个 repo 跑完即核验该 repo 的真实状态（`git status` 干净、`git log` 有新提交、远程已同步无 `ahead`）后再处理下一个；
3. 不写"一锅端"脚本把多个独立 repo 的提交串在一起；确需脚本也要按 repo 分段、每段独立判定成败并在失败处停下报错；
4. push 后逐个验收：https 主仓需确认凭证可用、push 真正落到远程（勿停在本地 ahead）；ssh 配置库确认 key 可用、远程已更新。

evolution-engine 信号：CLAUDE.md / dev-builder SKILL.md 的 [开发规则清单] / Git 工作流目前未声明"本项目含两个独立 repo（主仓 https + .claude=sitemaster-config ssh）"这一拓扑，也未规定"多 repo 独立提交、禁止耦合"。建议进化时：① 在 CLAUDE.md 或 dev-builder Git 规则中显式记录双 repo 拓扑与各自远程/认证方式；② 增加"独立 repo 独立提交、逐个验收远程同步状态、不耦合进单脚本"的硬规则。
