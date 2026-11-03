# Progress

cursor-base 的项目记忆。本仓 = cc-base 原件 + Cursor 适配层，cc-base 侧的决策不在这里重记，看 cc-base 的 progress.md；这里只记适配层与同步相关的事。2.1.1 之前（治理引擎时代）的记忆原样留在 progress.archive.md。

## Pinned（必守）

- `.claude/` 下的每个文件都是 cc-base 原件：不手改，要改回 cc-base 改完再同步。同步脚本按 cc-base **HEAD** 清单覆盖，手改必丢。
- `.claude/settings.json` 必须是 string form（`node .claude/scripts/hook-form.mjs --check` 打印 `string`）。Cursor 不认 exec form 的 `args`，exec form 下一个 hook 都不跑（2026-11-04 实测）。
- `.cursor/agents/` 是生成物（`gen-agents.mjs`），`model: inherit`；钉模型只写 `.cursor/agents-models.json`。
- `.gitignore` 从 `/*` 起到 `# === Cursor 适配层 ===` 之前与 cc-base 逐字相同，同步脚本核对，不同即退 1。
- 新增任何适配层控制之前先在 Cursor 里证明它会响：`cursor-agent -p` 只响 sessionStart 与工具类事件，拦不住 / 证不出的闸不进家底（cc-base 四条「避免过度」同样适用）。

## Done

- 2026-11-04 **重建为 cc-base 全量 + 薄适配层**。旧引擎打 tag `v2.1.1-legacy` 推送后清空 main；旧 progress.md 整体搬成 progress.archive.md；旧 docs/feedback 的 11 篇教训逐篇并进 cc-base/.claude/feedback（新建 3、追加 2、6 篇已覆盖），本仓不再留第二套教训库。
- 2026-11-04 适配层落地：`sync-from-cc-base.sh`（HEAD 清单、自有文件排除、按上次清单删旧文件、.gitignore 白名单核对、转 string form、重生成 agents，两次同步幂等）、`setup-cursor.sh`（setup.sh --hook-form string + 铺 .cursor/ 与 AGENTS.md，已有同名不覆盖落 .framework-new）、`.cursor/scripts/gen-agents.mjs`、`.cursor/tests/test-adapter.sh`（22 条）。
- 2026-11-04 最终验收（装到空项目后 `cursor-agent -p`）：人设 SiteMaster 中文 ✓；子代理清单含 8 个 cc-base 角色 ✓；编辑工具写 src/ 被 no-direct-code-guard 拦 ✓；启动注入含「核心铁律」✓；`model: inherit` 的 tester 子代理真起来并回报 ✓（证明 `.cursor/agents/` 压过 `.claude/agents/`，生成格式 Cursor 认）。

## Decisions

- 2026-11-04 **同步只认 cc-base HEAD，不认工作树**。依据：同步是发行动作，拷一份半成品进来下次就分不清哪些是 cc-base 的；cc-base 工作树不干净时拒绝（`--allow-dirty` 可放行并提示）。适用范围：sync-from-cc-base.sh。取代：无。
- 2026-11-04 **子代理一律 `model: inherit`**。依据：cc-base 的 `model: sonnet / opus` 在 Cursor 里解析成 Claude 模型，用户账号 Claude 周配额用尽时子代理起不来（实测报 not included in your weekly usage）；inherit 跟主 agent 走，用户在 Cursor 里选什么它就用什么。适用范围：`.cursor/agents/` 全部；要钉模型写 `agents-models.json`。取代：无。
- 2026-11-04 **不加 beforeSubmitPrompt 桥接 release-gate**。依据：`cursor-agent -p` 下连原生 beforeSubmitPrompt / stop / afterAgentResponse 都不触发，本机证明不了桥接会响；AGENTS.md 写明 Cursor 下发布前主 Agent 自查 `.claude/.needs-review`。适用范围：本仓适配层。取代：无。交互模式 / IDE 验证后可重开（TODO #2）。
- 2026-11-04 **cc-base 专有 agent 字段的落法**：`skills:` → 正文首句「先完整读技能文件」；`disallowedTools: Task` → 「不要再派子代理」；`memory: project` → 「记忆在 agent-memory/<角色>/MEMORY.md」；其余（color / maxTurns / disallowedTools 其它项）丢弃。依据：Cursor 子代理 frontmatter 只认 name / description / model / readonly / is_background（官方文档），技能不预载就等于没派单上下文。适用范围：gen-agents.mjs。取代：无。
- 2026-11-04 **`.cursor/cli.json` 只做密钥 deny + 只读命令 allow，不搬旧引擎的 shell-policy**。依据：cc-base 的 dangerous-pkill-guard / secret-exfil-guard 经 settings.json 在 Cursor 下照跑；旧 shell-policy 那 700 行 TS 是另一套机制，留着就是两套口径。适用范围：本仓。取代：旧引擎的 beforeShellExecution 策略（随 v2.1.1-legacy 退役）。

## 当前断点（2026-11-04）

重建完成，待 reviewer Stage 0+1 收口后首次提交。cc-base 同步基线：38627aa。

## TODO

- [ ] #1 P2 交互模式 / IDE 下验证 Stop / UserPromptSubmit / SubagentStop 是否触发（print 模式不触发已实测）；验证结果写进 AGENTS.md「不一样的」那段。
- [ ] #2 P3 beforeSubmitPrompt 桥接 release-gate——等 #1 证明 beforeSubmitPrompt 在交互模式会响再加。
- [ ] #3 P3 Windows 上跑一遍 `setup-cursor.sh` 对应的 ps1 路径（本机无 pwsh）；Cursor 在 Windows 下 hook 命令经哪个 shell 执行没查证，string form 的相对路径写法是否成立要实测。
- [ ] #4 P3 `.cursor/cli.json` 的 allow / deny 列表在 IDE 的 allowlist 模式下实际效果未验（CLI 用 --force 跑的）。
- [ ] #5 P2 首次提交前 code review（Stage 0+1，无 HIGH）留下的残留，随下一个 Task 顺手修：M1 `gen-agents.mjs` 与 `setup-cursor.sh` 都不清理源头已删的 agent（删掉 `.claude/agents/x.md` 后 `.cursor/agents/x.md` 仍在，装进目标的旧文件也不清）；M2 `sync-from-cc-base.sh` 的 .gitignore 白名单核对失败退 1 时，文件已经拷完但 settings.json 还是 exec form，留下半成品——核对要挪到拷贝之前；M3 / M4 `test-adapter.sh` 对 gen-agents 的 7 个突变全绿，断言只看文件存在与关键词、不比内容，是假绿；L1 `cc-base-version.txt` 写了同步时间，每次同步都产生 diff；L2 gen-agents 只认 `disallowedTools: Task` 逐字匹配，cc-base 有三个 agent 写的是 `Bash, Task`，「不要再派子代理」那句没插进去（Bash 被禁这件事 Cursor 侧也没落地）。

## In Progress

- 无。

## 明确不做（防过度工程）

- 不在本仓改 `.claude/` 原件（含 settings.json 的内容——形态转换由脚本做）。
- 不为 Cursor 另写一套 skills / rules / agents；不维护第二套 feedback。
- 不复活旧引擎的任何部件（assurance profile、hash 链账本、shell-policy、module catalog）。

## Notes

- Cursor 读 `.claude/` 的前提是「Include Third-Party Plugins, Skills, and Other Configs」开着（默认开）；关掉就只剩 AGENTS.md，所以 AGENTS.md 第一句是「先完整读 .claude/CLAUDE.md」。
- Cursor CLI 装完会把 `~/.local/bin/agent` 指向自己；本机那个名字原来是 grok 的，装完改回去了，`cursor-agent` 是不冲突的入口。
- 跟 cc-base 的 Cursor 兼容实测全在 cc-base 的 progress.md（2026-11-04 Decisions）：args 键不认、纯文本 stdout 丢弃、Task 工具名与字段、`-p` 模式事件触发面。
