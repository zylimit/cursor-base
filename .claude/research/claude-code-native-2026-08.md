# Claude Code 原生能力盘点（2026-08，v2.1.224+）与 cc-base 差距分析

> 调研日期：2026-08-16。证据来源：code.claude.com 官方文档（hooks.md / sub-agents.md / skills.md / memory.md / sandboxing.md / statusline.md / workflows.md / agent-teams.md）+ 官方 changelog 全文（截至 v2.1.224+）。逐条给出「cc-base 现状 → 原生新能力 → 建议落法」。用户约束：避免 Cursor 化、不上 CCB 复杂度、一切扩展以 Claude Code 原生能力为载体。

---

## A. 已失真的 cc-base 假设（比加新功能更优先——防治理层自身漂移）

### A1. Subagent 默认后台运行（v2.1.198 起）
- 官方：非 teammate 的 Agent spawn 在交互会话里**默认后台运行**，Task 工具立即返回 `status: "async_launched"`；前台完成才是 `completed`。（hooks.md PreToolUse tool_response 字段说明；changelog "non-teammate agent spawns in interactive sessions now run in the background by default"）
- cc-base 失真点：CLAUDE.md [运行模型]「Sub-Agent 是同步返回的，不存在提交后轮询」、ARCHITECTURE §3「Task 工具同步返回」。
- 影响：per-Task 闭环的验收时序、回传信封的到达方式、「派发→等待→验收」话术全部要适配异步形态；配套 Notification hook 的 `agent_completed`/`agent_needs_input` matcher 可作完成/需输入信号。
- 建议：更新 CLAUDE.md/ARCHITECTURE/workflow-orchestration 措辞；验收铁律不变（等完成信号→核证据），只改时序描述。

### A2. `.claude/rules/` 已是原生机制，无 `paths:` 的规则**启动即全量加载**
- 官方：memory.md「Rules without `paths` frontmatter are loaded at launch with the same priority as `.claude/CLAUDE.md`」；带 `paths:` glob 的规则只在 Claude 读到匹配文件时才载入。
- cc-base 失真点：5 个 rules 文件（dev-workflow-details / file-structure / workflow-orchestration / harness-large-repo / quality-attributes）均无 frontmatter，设计意图是「主控留指针、按需 Read」——现实是**每个 session 全量进上下文**，指针行与「必须先读」指令成了冗余，上下文双份消耗。
- 建议（二选一，先跑 `/context` 实测确认加载态再动）：
  1. 接受 eager-load：删「必须先读」指针话术，rules 瘦身；
  2. 恢复按需：给 harness-large-repo 挂 `paths: [".claude/harness/**"]`、quality-attributes 挂 harness/catalog 相关路径、workflow-orchestration 挂 `.claude/workflows/**`，dev-workflow-details/file-structure 保持常驻。
- 注意：nested CLAUDE.md 与 path-scoped rules 在 compact 后不自动重注入（下次匹配才回来），常驻规则反而抗压缩——取舍要写进规则头。

### A3. PreCompact 现在可以 block（Pinned 条目过时）
- 官方 changelog：「Added PreCompact hook support: hooks can now block compaction by exiting with code 2 or returning {"decision":"block"}」；且 compact 后**项目根 CLAUDE.md 会重新注入**（memory.md「What survives compaction」）。
- cc-base Pinned：「PreCompact hook 不可用于注入提醒……洞在当前机制下无轻量解法」——block 能力已补上：可在 `.needs-review` 非空或 progress.md 未同步时**拦截压缩**，把「session 内压缩丢决策」变成可拦事件（拦停后主 Agent 先 /record 再放行压缩）。
- 建议：新增 precompact-gate hook（.sh/.ps1 双写）：待审非空或三文件脏 → exit 2。

### A4. Stop hook 连续 block 上限 8 次（闸会「泄」）
- 官方 changelog：「stop hooks that block repeatedly looping forever — the turn now ends with a warning after 8 consecutive blocks (override via CLAUDE_CODE_STOP_HOOK_BLOCK_CAP)」。
- 影响：stop-gate / three-file-sync-gate 连拦 8 次后 turn 强制结束——防跑飞视角这是闸的边界条件，harness-large-repo/gate 文档需注明，必要时 settings env 提高上限。

### A5. 权限默认态：auto mode 已成新会话默认（2026-08-14 起，Pro/Max/Team）
- 官方：auto mode = 权限分类器（危险 git 命令 / rm -rf 变量 / transcript 篡改等自动拦，安全动作放行）；`permissions.deny` 不可被 hook 降级；hook 的 `ask` 决定在 auto mode 下仍落为提问。
- cc-base 现状：settings.json 钉死 `defaultMode: bypassPermissions`（Pinned「永不询问」）。bypass 跳过一切提示但也跳过分类器兜底。
- 建议：保留 bypass 为默认（尊重既有决策），但在 README/quality-attributes 增补「auto mode 档」说明：想要「不打扰 + 有兜底」的用户可改 `defaultMode: "auto"`——这与危险命令 hook 互补不冲突。

### A6. hook matcher/if 语义更新
- matcher 由 substring 改精确匹配（hyphenated 名修复）；新增 handler 级 `if:`（permission-rule 语法，仅 tool 事件，best-effort fail-open——硬拦仍要用 permissions）。现有 hook 可用 `if` 前移过滤减少空转 spawn（如 pre-commit-check 只在 `Bash(git commit*)`、tdd-gate 只在测试命令）。

---

## B. 高价值原生扩展点（cc-base 未使用）

### B1. 原生沙箱（Security/Privacy 的执行层）★★★
- sandboxing.md：macOS(Seatbelt)/Linux/WSL2(bubblewrap+socat)；`sandbox.enabled`、`filesystem.allowWrite/denyWrite/denyRead/allowRead`、`network.allowedDomains/strictAllowlist/tlsTerminate`、`sandbox.credentials`（deny/mask，mask=哨兵值+代理出口替换真值，JWT/AWS SigV4 感知）、违规详情回传给模型。原生 Windows 不支持（须 WSL2）。
- 价值：五性的 Security/Privacy 从「fitness 静态扫描 + 自觉」升级为 OS 级强制；「analytics 永不许碰 pii-store」这类禁令有了运行时孪生。
- 落法：`settings` 增可选片段模板（默认关）+ doctor 检测依赖 + quality-attributes.md 把 sandbox 列为 security/privacy 属性的原生 adapter；README 写清 Windows 例外。

### B2. permissions deny/ask 规则（审批三档 HIGH 档机器化）★★★
- `permissions.deny`: `Read(./.env)`、`Read(./secrets/**)`（隐私红线）；`permissions.ask`: `Bash(git push*)`、`Bash(gh release*)`（HIGH 档必停等）。deny 优先级高于任何 hook/auto 分类器。
- 价值：CLAUDE.md「审批三档」的 HIGH 档从文字变成机器闸，零代码零 hook。
- 落法：settings.json 增量合并模板（setup 侧同步）；与 bypassPermissions 并存有效（deny 规则仍强制）。

### B3. prompt/agent 型 hook（语义闸）★★
- hooks.md：五种 hook type=`command|http|mcp_tool|prompt|agent`；prompt=单轮 LLM 评估返回决策 JSON；agent=可用 Read/Grep/Glob 查证后再裁决（实验）。Stop/SubagentStop 还可回 `additionalContext` 给反馈继续跑而非硬拦。
- 候选落点：① SubagentStop 挂 agent-hook 校验回执信封六字段完备性（把 subagent-acceptance-reminder 从「提醒」升级为「查证」）；② three-file-sync 的语义判断（progress.md 新条目是否真覆盖本轮决策）。
- 克制点：单模型自校历史上被 cc-base 判为「不是承重墙」（Pinned）——prompt-hook 只做**完备性/格式**判断，不做正确性担保；标注实验特性。

### B4. async / asyncRewake hook（大仓长检查不阻塞）★★
- `async: true` 后台跑；`asyncRewake: true` 退出码 2 时唤醒 Claude 读 stderr。
- 落点：catalog 启用时 PostToolUse 触发 harness `verify`/`arch-check --record` 用 asyncRewake——大仓定向门不再挤占交互时延，失败仍可见（fail-visible 哲学一致）。

### B5. Subagent `memory` 字段（角色跨会话学习）★★
- sub-agents.md：`memory: user|project|local`，agent 自维护独立记忆目录。主对话 auto memory 不进 subagent（fork 例外）。
- 落点：code-reviewer 挂 `memory: project`——跨会话积累「本项目高发缺陷模式/薄弱模块」，审查越用越准；tester 记 flaky 区。与 fresh 实例隔离不冲突（记忆=角色战术笔记，非会话续接）。
- 边界：与 feedback 系统划界——feedback=框架级铁律的原料（人确认后进规则）；agent memory=角色私有笔记（无人审）。CLAUDE.md「feedback vs memory 两套系统」段落需加第三行。

### B6. Fork subagent（`subagent_type: "fork"`，继承全量对话+prompt cache）★★
- 落点：progress-recorder / feedback-observer 天然适配——它们的任务就是「看见对话再记录」，当前靠主 Agent 手工转述 delta（有失真）；fork 后直接读原始对话，转述层消失。
- 边界：fork 继承主对话工具池与上下文，成本高于裸 fresh 实例；只给「需要对话可见性」的角色，执行类（implementer/tester/deployer/code-reviewer）保持 fresh 隔离铁律不变。

### B7. Skills frontmatter 升级（零逻辑变化，纯声明收紧）★★★
- `disable-model-invocation: true` → release-builder、branch-finisher（官方明确 deploy 类勿让模型自触发；与「发布是 HIGH 档」一致）。
- `user-invocable: false` → feedback-writer、evolution-engine、progress-recorder（本就「不由用户直接触发」，现在可从 / 菜单隐藏，防误触）。
- `context: fork` + `agent:` + `background: true` → evolution-engine 的 session 启动扫描转后台 fork，不再挤占开场延迟。
- `paths:` → harness 强相关 skill（arch-designer/dfx-designer 的 catalog 操作段落可拆 path-scoped 知识 skill）。
- `argument-hint`、`when_to_use` → 全量 skill 补齐可用性。
- `allowed-tools`/`disallowed-tools` → 收紧只读型 skill 的工具面。

### B8. statusLine（治理状态常驻可见）★★★
- statusline.md：settings `statusLine: {type:"command", command:"…"}`，脚本吃 JSON（model、cwd、context used_percentage、cost）。
- 落点：一个 `.claude/scripts/statusline.sh`（+.ps1）显示：Fast Mode 状态与剩余时间 / `.needs-review` 待审数 / harness 开关（catalog 在否）/ context 百分比。治「忘了 fast-mode 开着」「不知道欠几个审」——session-rules-banner 只在开场播一次，statusline 全程在场。

### B9. 原生 scheduled tasks（CronCreate、/schedule、/loop）★
- 落点：长 session「漂移哨兵」——周期性跑 `arch-trend --gate` / `fitness` / gate-audit 摘要。不新增运行时，纯提示模板/skill 文档即可。（Stop hook 输入已带 `session_crons` 字段，闸可感知。）

### B10. Agent teams（实验，默认关；带 TaskCreated/TaskCompleted/TeammateIdle 治理钩子）★（观察层）
- agent-teams.md：env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`；teammate=独立会话（载 CLAUDE.md/skills，不继承 lead 历史）；共享任务列表（依赖阻塞）；**TaskCompleted exit 2 可阻止任务标完成**——四态质量门可接进原生任务系统；teammate 可复用 `.claude/agents/` 定义（tools+model 生效，body 追加）。
- 定位：与「编码默认串行」哲学冲突面最大，token 重；仅作 L 档大仓「多模块真独立并行」的 opt-in 路线记录，默认不开。已有 workflow fan-out 覆盖只读广度场景（且 fan-out 内同型 agent 现在共享 prompt cache——workflows.md，15x 成本论有缓和）。

### B11. 原生 worktree 体系（替换手工纪律）★
- `isolation: worktree`（agent frontmatter）+ EnterWorktree/ExitWorktree + `.claude/worktrees/` + `worktree.baseRef`；隔离由 Claude Code 强制（git -C/GIT_DIR 逃逸都拦）。workflow-orchestration.md 的手工 worktree 操作纪律可下沉为原生字段。

### B12. auto memory 治理（双真相源防漂移）★★
- memory.md：auto memory 默认开，仓库级目录 `~/.claude/projects/<repo>/memory/MEMORY.md`（启动载入前 200 行/25KB）。
- 风险：与 progress.md 形成第二真相源（cc-base 审计法：双真相源必漂移）。
- 建议（表态式治理，不引运行时）：CLAUDE.md 记忆规则加一行——决策/约束/完成**只认 progress.md**（三文件同步铁律不变），auto memory 仅存机器本地琐碎（构建命令、调试线索），不承载项目事实；或项目 settings `autoMemoryEnabled: false` 一刀关。doctor 补检测项报告当前态。

### B13. 大仓上下文治理原生件（1M+ LOC）★★
- 嵌套 CLAUDE.md（子目录按需载入）、path-scoped rules、`claudeMdExcludes`（monorepo 跳过他队规则）、嵌套 `.claude/skills`（进入模块目录才出现的技能）、嵌套 `.claude/workflows`（按包放编排）。
- 落点：harness-large-repo.md 增「上下文分层」节：module-catalog 的模块 → 各挂嵌套 CLAUDE.md/rules 的布局建议；与 context-pack 互补（一个管「Claude 自动看见什么」，一个管「派单塞什么」）。

### B14. 防跑飞小件 ★
- `maxTurns`（agent frontmatter）：implementer/tester 上限圈死，防单派单长跑（与「>60min 拆任务」铁律呼应）。
- `CLAUDE_CODE_TOOL_MEMORY_LIMIT`（Linux cgroup）：防跑飞 build 拖死会话（Reliability）。
- `/usage`、`/context` per-skill/agent 成本分解：为「闸靠数据留」提供 token 面数据。

### B15. UserPromptExpansion hook（斜杠命令前置闸）★
- 命令展开前可拦：`/release-builder` 在测试卡点标记未过时直接 block（官方示例即 deploy 审批文件模式）。把「打包前先过测试卡点」从 skill 文字升级为机器闸。

### B16. 插件化分发（第二通道，尊重既有否决谨慎重评）
- 2026-06-14 曾否决「迁 Plugin」。现状变化：插件支持 `archive` 源（zip over HTTPS + SHA-256 pinning）、`.claude/skills` 目录插件免 marketplace、`claude plugin init/validate` 脚手架。
- 建议：不迁移。仅在 make-release.sh 增补一个 `.claude-plugin/plugin.json` 清单与 sha256 输出，让高级用户可 `claude plugin install` 直装——setup.sh 仍是主路径。是否做交用户拍板。

### B17. 官方 bundled 技能/插件与 cc-base 的共存
- bundled：`/verify`、`/code-review`、`/checkup`、`/run`；插件：`/security-review`（多 agent 漏洞扫描）。项目 skill 会遮蔽同名 bundled（官方已修相关 bug）。
- 落点：① adapters.json 增 `claude-security-review` 条目（security 属性证据工具，工具存在性=已装插件）；② doctor 增「重名遮蔽」检查（cc-base 的 code-review 与 bundled /code-review 同名——确认遮蔽方向符合预期）；③ 可选 `disableBundledSkills` 说明。

---

## C. 与五性/目标映射速查

| 目标 | 原生件 | cc-base 既有 |
|---|---|---|
| Security | 沙箱 network/credentials、permissions.deny、secret redaction、/security-review 插件 | fitness 密钥规则、adapters(gitleaks/semgrep)、waiver 禁词 |
| Privacy | credentials mask、denyRead(.env)、auto memory 治理 | fitness 日志 PII、DENY 密钥路径不入 context-pack |
| Reliability | cgroup 内存限额、maxTurns、后台会话恢复 | supervisor、四态门 |
| Resilience | checkpoint//rewind、pinned 后台会话、asyncRewake fail-visible | supervisor 熔断、stop-gate |
| 防跑飞 | auto mode 分类器、stop-hook cap 感知、maxTurns、scheduled 哨兵 | 审批三档、时长红线、gate-audit |
| 1M+ LOC | 嵌套 CLAUDE.md/rules/skills/workflows、claudeMdExcludes、LSP 插件、fan-out prompt cache | harness impact/context-pack/arch-check/棘轮 |
| 需求/架构质量 | （不变——product-spec/arch-designer/dfx-designer 已是文档层强项） | 17 skills + ADR 执法 + adr-check |

## D. 明确不建议引入
- **Cursor 专属机制**（用户红线）：不搬任何 .cursor 形态。
- **Agent teams 默认开启**：实验态 + 与编码串行哲学冲突 + token 重——只留 opt-in 文档。
- **Cross-session messaging / self-hosted runner**：多会话协同与企业云基建，超出单机脚手架定位；记录存在即可。
- **computer use / Chrome / voice / Cowork**：与开发治理脚手架无交集。
- **迁 Plugin 作为主分发**：维持 2026-06-14 决策，仅评估 zip 清单补充。
- **用 prompt-hook 承担正确性担保**：违反「单模型审查承重墙」Pinned——只用于格式/完备性闸。
