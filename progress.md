# Progress

cursor-base 的项目记忆。本仓 = cc-base 原件 + Cursor 适配层，cc-base 侧的决策不在这里重记，看 cc-base 的 progress.md；这里只记适配层与同步相关的事。2.1.1 之前（治理引擎时代）的记忆原样留在 progress.archive.md。

## Pinned（必守）

- `.claude/` 下的每个文件都是 cc-base 原件：不手改，要改回 cc-base 改完再同步。同步脚本按 cc-base **HEAD** 清单覆盖，手改必丢。
- `.claude/settings.json` 必须是 string form（`node .claude/scripts/hook-form.mjs --check` 打印 `string`）。Cursor 不认 exec form 的 `args`，exec form 下一个 hook 都不跑（2026-11-04 实测）。
- `.cursor/agents/` 是生成物（`gen-agents.mjs`），`model: inherit`；钉模型只写 `.cursor/agents-models.json`。
- `.gitignore` 从 `/*` 起到 `# === Cursor 适配层 ===` 之前与 cc-base 逐字相同，同步脚本核对，不同即退 1。
- 新增任何适配层控制之前先在 Cursor 里证明它会响：`cursor-agent -p` 只响 sessionStart 与工具类事件，拦不住 / 证不出的闸不进家底（cc-base 四条「避免过度」同样适用）。
- `.cursor/tests/test-adapter.sh` 不碰所在仓的工作树：要跑真同步的用例一律先 `cp -a` 到临时副本。

## Done

- 2026-11-04 **重建为 cc-base 全量 + 薄适配层**（b80ba52）。旧引擎打 tag `v2.1.1-legacy` 推送后清空 main；旧 progress.md 整体搬成 progress.archive.md；旧 docs/feedback 的 11 篇教训逐篇并进 cc-base/.claude/feedback（新建 3、追加 2、6 篇已覆盖），本仓不再留第二套教训库。
- 2026-11-04 适配层落地：`sync-from-cc-base.sh`（HEAD 清单、自有文件排除、按上次清单删旧文件、.gitignore 白名单核对、转 string form、重生成 agents，两次同步幂等）、`setup-cursor.sh`（setup.sh --hook-form string + 铺 .cursor/ 与 AGENTS.md，已有同名不覆盖落 .framework-new）、`.cursor/scripts/gen-agents.mjs`、`.cursor/tests/test-adapter.sh`。
- 2026-11-04 最终验收（装到空项目后 `cursor-agent -p`）：人设 SiteMaster 中文 ✓；子代理清单含 8 个 cc-base 角色 ✓；编辑工具写 src/ 被 no-direct-code-guard 拦 ✓；启动注入含「核心铁律」✓；`model: inherit` 的 tester 子代理真起来并回报 ✓（证明 `.cursor/agents/` 压过 `.claude/agents/`，生成格式 Cursor 认）。
- 2026-11-04 首次 code review（Stage 0+1）残留全部修完（B2）：白名单核对挪到拷贝前；幂等用例改在临时副本跑、测试不再动工作树；自测补正文逐字比对与假 cc-base 夹具（45 条，review 的 7 个突变各有断言变红）；gen-agents 与 setup-cursor 清理失源的生成物；版本文件去时间戳；`disallowedTools` 里 Task / Agent 任一都插「不要再派子代理」，其它被禁工具写成「不要用 X 工具」。同步基线更新到 cc-base 9467190。

## Decisions

- 2026-11-04 **同步只认 cc-base HEAD，不认工作树**。依据：同步是发行动作，拷一份半成品进来下次就分不清哪些是 cc-base 的；cc-base 工作树不干净时拒绝（`--allow-dirty` 可放行并提示）。适用范围：sync-from-cc-base.sh。取代：无。
- 2026-11-04 **子代理一律 `model: inherit`**。依据：cc-base 的 `model: sonnet / opus` 在 Cursor 里解析成 Claude 模型，用户账号 Claude 周配额用尽时子代理起不来（实测报 not included in your weekly usage）；inherit 跟主 agent 走，用户在 Cursor 里选什么它就用什么。适用范围：`.cursor/agents/` 全部；要钉模型写 `agents-models.json`。取代：无。
- 2026-11-04 **不加 beforeSubmitPrompt 桥接 release-gate**。依据：`cursor-agent -p` 下连原生 beforeSubmitPrompt / stop / afterAgentResponse 都不触发，本机证明不了桥接会响；AGENTS.md 写明 Cursor 下发布前主 Agent 自查 `.claude/.needs-review`。适用范围：本仓适配层。取代：无。交互模式 / IDE 验证后可重开（TODO #2）。
- 2026-11-04 **cc-base 专有 agent 字段的落法**：`skills:` → 正文首句「先完整读技能文件」；`disallowedTools` 含 Task 或 Agent → 「不要再派子代理」，其它被禁工具各一句「不要用 X 工具」（Bash 写作 Shell（Bash））；`memory: project` → 「记忆在 agent-memory/<角色>/MEMORY.md」；color / maxTurns 丢弃。依据：Cursor 子代理 frontmatter 只认 name / description / model / readonly / is_background（官方文档），技能不预载就等于没派单上下文，禁用的工具没有对应字段只能写进正文。适用范围：gen-agents.mjs。取代：首版「disallowedTools 其它项直接丢弃」。
- 2026-11-04 **`.cursor/cli.json` 只做密钥 deny + 只读命令 allow，不搬旧引擎的 shell-policy**。依据：cc-base 的 dangerous-pkill-guard / secret-exfil-guard 经 settings.json 在 Cursor 下照跑；旧 shell-policy 那 700 行 TS 是另一套机制，留着就是两套口径。适用范围：本仓。取代：旧引擎的 beforeShellExecution 策略（随 v2.1.1-legacy 退役）。
- 2026-11-04 **失源的生成物要清**：`.cursor/agents/` 里带生成注释、但 `.claude/agents/` 已没有同名源的文件，gen-agents 与 setup-cursor 都删；没带注释的手写文件不动。依据：Cursor 优先读 `.cursor/agents/`，残留等于一个已删的角色继续存在。适用范围：gen-agents.mjs / setup-cursor.sh。取代：无。

## 当前断点（2026-11-04）

重建完成、首轮审查残留修完，待 B2 复核后提交。cc-base 同步基线：9467190。

## TODO

- [ ] #1 P2 交互模式 / IDE 下验证 Stop / UserPromptSubmit / SubagentStop 是否触发（print 模式不触发已实测）；验证结果写进 AGENTS.md「不一样的」那段。
- [ ] #2 P3 beforeSubmitPrompt 桥接 release-gate——等 #1 证明 beforeSubmitPrompt 在交互模式会响再加。
- [ ] #3 P3 Windows 上跑一遍 `setup-cursor.sh` 对应的 ps1 路径（本机无 pwsh）；Cursor 在 Windows 下 hook 命令经哪个 shell 执行没查证，string form 的相对路径写法是否成立要实测。
- [ ] #4 P3 `.cursor/cli.json` 的 allow / deny 列表在 IDE 的 allowlist 模式下实际效果未验（CLI 用 --force 跑的）。
- [x] #5 P2 首次提交前 code review 残留（M1–M4 / L1–L2 / 存疑）——2026-11-04 B2 全部修完，见 Done。
- [ ] #6 P2 B2 复核冒出的：N1 Medium——`gen-agents.mjs:74` 与 `setup-cursor.sh:90` 判「失源生成物」只看文件里有没有生成注释子串，用户把 `.cursor/agents/code-reviewer.md` 复制成 `my-reviewer.md` 定制后，下次 sync / setup-cursor 会把它当失源产物删掉；改法是判据绑定注释里写的源文件名必须等于本文件名。Low——test-adapter 缺 `disallowedTools: Agent` 夹具（M10 突变不红）；本仓只读断言只比 `git status --short`，已是 M 状态的文件内容再变看不出来。

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
