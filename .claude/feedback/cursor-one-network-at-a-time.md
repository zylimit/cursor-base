---
type: feedback
description: Cursor 一次只能连外网或内网，靠用户手动切 xgate VPN；升级说明按网络环境拆成两份，各自写明 VPN 前提，在切换点停下交还用户
created: 2026-11-03
updated: 2026-11-03
graduated: false
skipped: true  # 2026-11-08 裁定：绑定 OFR-ARIANE 的 ai-ts 内网拓扑，产物已在下游落地，不是框架通用流程
source_skill: release-builder
scope: 给外部执行者（Cursor 等）写的交付物与操作说明，凡涉及多个目标、而目标分处不同网络（内网 feilan-node / 外网 ai-ts）的发版与运维；派单前要弄清执行者的网络可达性与切换方式
exceptions: 所有目标都在同一网络、执行者一轮就能连到全部时不适用；其余未说明
supersedes: none（修正 2026-11-03 CURSOR-PROMPT 模板「一份说明同时覆盖内网与 ai-ts」中「同一轮连续执行」的部分，同时覆盖两边的要求不变）
applied_to: ~/ariane-release/CURSOR-PROMPT-1-ai-ts.md、CURSOR-PROMPT-2-intranet.md（原合并版挪进 superseded/）；progress.md Decisions 2026-11-03「Cursor 一次只能连外网或内网」；TODO #30 生成器与 RELEASE.md 第 6 步（pending，下次发版前做）
origin: OFR-ARIANE-claude
---

# Cursor 一次只能连一边网络：升级说明按 VPN 状态拆开

**问题描述**：主 Agent 用模板生成了 0.17.0 的 CURSOR-PROMPT.md，一份说明里先做 ai-ts，ai-ts 通过后在同一轮接着做内网。主 Agent 向用户也是这样描述的：「先升 ai-ts，ai-ts 通过后再升内网」，默认 Cursor 一轮里两边都连得上。用户纠正：「不对，cursor同时只能连内网，或者外网，需要我控制vpn，连内网要打开xgate vpn，外网要关闭」。

**触发场景**：用户问「什么时候可以内网部署了？」，主 Agent 回答「现在就可以」，并列出交给 Cursor 的文件和「先 ai-ts 再内网」的执行顺序。主 Agent 写模板时只核实了 ai-ts 与内网的路径、账号、起停方式，没问过执行者在两种网络之间怎么切换。

**教训/建议**：
- 交付物要交给外部执行者跨网络操作时，先问清三件事：它能连到哪些目标、一次能连几个、谁来切换、怎么切换。不要默认它一轮就能连到全部目标。
- 交付物按网络环境拆开，每份开头写明前提条件，例如「开始前确认 xgate VPN 已关闭 / 已打开」，不满足就停下问用户。
- 在需要切换网络的地方停下：这一份做完写汇总交还用户，由用户切换网络后再开下一份，不在一份里跨网接着做。
- 顺序约束放进每份的前提里：内网那份要求「ai-ts 已按第 1 份升级通过、用户同意继续」。

**适用范围与例外**：凡是有多个目标、而目标分处不同网络、执行者又要靠人工切换才能连到的交付，都按这条拆开写。本项目里 ai-ts 在外网（关 xgate VPN），内网 feilan-node 要开 xgate VPN。所有目标都在同一网络时不适用。

**本次落地**：
- 0.17.0 的说明由主 Agent 手工拆成两份：`~/ariane-release/CURSOR-PROMPT-1-ai-ts.md`（VPN 关，只做 ai-ts，做完即停）和 `CURSOR-PROMPT-2-intranet.md`（VPN 开，先确认 ai-ts 已通过，只做内网）。正文步骤不动，原合并版挪进 `~/ariane-release/superseded/`。
- progress.md Decisions 2026-11-03 记了「Cursor 一次只能连外网或内网……任何一份都不跨网操作」。
- TODO #30（pending）：`make_cursor_prompt.py` 加 `--target ai-ts|intranet` 按目标各出一份，并同步 docs/RELEASE.md 第 6 步，下次发版前做。
- skill / rule 本体未动。
