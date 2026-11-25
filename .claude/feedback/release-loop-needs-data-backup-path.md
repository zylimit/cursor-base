---
type: feedback
description: 发版流程只闭了程序升级，没问数据的备份 / 回流路径；叫「生产镜像」的 ai-ts 数据从未与内网同步，主 Agent 一直没核实
created: 2026-11-05
updated: 2026-11-05
graduated: false
skipped: true  # 2026-11-08 裁定：同上，备份脚本已在下游；「镜像不是事实」只此一例不够成文
source_skill: release-builder
scope: 发版流程设计与发版收尾；任何被称作「镜像 / 副本 / 备份」的环境；给外部执行者（Cursor）出升级说明时
exceptions: 无数据落地的纯程序发布；用户明说本次不需要备份
supersedes: none
applied_to: scripts/release/CURSOR-PROMPT-3-backup-intranet.md（新增第 3 份升级说明，与版本无关）；docs/RELEASE.md 第 6 步（加复制第 3 份的说明）；progress.md Decisions（已记）；skill / rule 本体未动
origin: OFR-ARIANE-claude
---

# 发版闭环要问清数据的备份 / 回流路径，「镜像」要核实数据来源

**问题描述**：ARIANE 发版流程（docs/RELEASE.md）只出两份 Cursor 升级说明（ai-ts、内网），升级完就算收尾，从没有把内网数据带回来的步骤。ai-ts 一直被叫作「生产镜像」，实际它的数据与内网从未同步（ai-ts 22 站，内网 26 站），主 Agent 沿用「镜像」这个叫法，一直没核实，也没发现缺口。用户在 0.19.0 发版后指出：「其实还少了一步，就是内网部署完了以后，把内网数据拉到本地，然后关VPN，同步数据到ai-ts，才闭环了」；并补充真实目的：「我其实就像数据备份一下，避免内网服务器挂了」。

**触发场景**：0.19.0 发版后收尾。流程文档只覆盖程序升级，没人问过「数据怎么备份、怎么回流」。

**教训/建议**：
1. 环境名字（镜像 / 副本 / 备份）不是事实。沿用这类叫法前，核实它的数据是怎么来的、现在与源是否一致（至少对一次站点数、记录数）。
2. 设计或复核发版流程时，问一句：数据的备份 / 回流路径是什么？万一源服务器挂了，从哪里恢复？不要只看程序升级。
3. 用户一句话的流程补充，先追问背后的真实目的（这次是异地备份），再设计步骤，选项（只同步库 / 可以覆盖）交用户确认。
4. 与 cursor-one-network-at-a-time.md 配合：回流涉及 VPN 切换，已按网络拆成 A 段（开 VPN 内网拷库）与 B 段（关 VPN 换库校验），切换点停下交还用户。

**适用范围与例外**：发版流程设计、发版收尾自检、任何带「镜像 / 副本」叫法的环境。无数据落地的纯程序发布，或用户明说不要备份时不按。

**本次落地**：主 Agent 新增 scripts/release/CURSOR-PROMPT-3-backup-intranet.md（A 段开 VPN 内网在线拷库到本机 ~/ariane-release/intranet-db/；B 段关 VPN 在 ai-ts 备份原库后换库并校验 SYNC-MATCH；用户选「只同步库」「可以覆盖」）；docs/RELEASE.md 第 6 步加复制第 3 份的说明；progress.md Decisions 已记；提交已推送。skill / rule 本体未动，release-builder 的发版收尾清单尚未加「数据备份 / 回流」一问。
