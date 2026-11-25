---
type: feedback
description: 免确认模式下后台子 Agent 的 Bash 里带 shell 变量路径的 rm 仍弹确认，子 Agent 停下等人点，复核被拖 6 小时；用户「不都是危险模式了，还弹框」
created: 2026-11-18
updated: 2026-11-18
graduated: false
source_skill: N/A
scope: 免确认模式启动的会话里，主 Agent 编排后台 tester / implementer / code-reviewer 的派单与等待阶段
exceptions: 未说明（根因是推断，没做对照实验；其他类命令是否也会弹框未查）
supersedes: none
applied_to: 主 Agent 自己的记忆（命令与派单里不写带变量或通配符的 rm）；progress.md Done 记了这件事；hook / skill / rule / settings 未动（用户指令：不动 rog-ts 的 hooks / skills / rules）。派单规则与 agent 定义落地 pending
origin: OFR-ARIANE-claude
---

# 免确认模式下后台子 Agent 卡在 rm 确认框上，没人知道

**问题描述**：用户原话「每次弹啥框，让后确认，不都是危险模式了，还弹框」。会话以免确认模式启动，用户仍反复看到确认框，而主 Agent 正在编排还债，tester / implementer / code-reviewer 在后台跑，用户在等结果。主 Agent 起初推断是「往 .claude/ 目录写东西触发的」，查官方文档与记录后否定，已向用户更正。

**触发场景**：主 Agent 翻了近三天全部子 Agent 记录，等待时间远超命令自身超时的命令只有两条，都是 Bash 里带 shell 变量路径的 rm。一条是审查者的 `SP=<scratchpad 目录>; rm -f $SP/*.py.out; …pytest…`，发出到拿到结果隔了约 6 小时，那次复核因此拖了 6 小时。另一条 `rm -rf $S…` 隔了 17 分钟。项目 settings.json 里没有会要求确认的钩子，ask 规则只有发版类三条命令且这一轮没用过。「免确认模式不跳过这一类 rm 的确认，后台子 Agent 碰到就停下等用户点」是主 Agent 的推断，没有对照实验。

**教训/建议**：
- 子 Agent 迟迟不回，先想到它可能卡在确认框上，并告诉用户去看，不要只等。
- 命令与派单里不写带变量或通配符的 rm；临时文件放 scratchpad，不靠 rm 清理。
- 可供进化引擎参考（只记录，不执行）：subagent-dispatch.md 或 tester / code-reviewer 的 agent 定义里加一句「临时文件放 scratchpad，不用带变量或通配符的 rm 清理」；主 Agent「静默任务先预告」补一条「子 Agent 超出预算时长两倍仍没回，提醒用户看有没有确认框」。

**适用范围与例外**：免确认模式 + 后台子 Agent 的场景按此条来。根因未经对照实验验证，不要当成已证实的平台行为；前台命令与其他类命令是否弹框未说明。

**本次落地**：主 Agent 记了一条自己的记忆（命令与派单里不写带变量或通配符的 rm；子 Agent 迟迟不回时先想到确认框并告诉用户），progress.md Done 记了这件事。skill / rule / agent 定义 / settings 没动，上面两条改进点 pending，待用户拍板。
