# Progress

cursor-base 的项目记忆。自 v3.0.0（2026-11-27）起，本仓升级为 `cc-base` 的纯软链（Zero-Copy Link）跨平台发行版：不再在仓内拷贝 `.claude/` 文件，cc-base 侧的决策看 cc-base 的 progress.md；这里只记 Cursor 适配层、跨平台安装器与联装契约相关的事。2.1.1 之前（独立治理引擎时代）的记忆原样留在 progress.archive.md。

## Pinned（必守）

- **单一真相源（Zero-Copy Link）**：`.claude/` 由上游 `cc-base` 唯一提供与管理，本仓严禁重新拷贝 `.claude/` 文件入库；下游通过跨平台 OS 目录联接（`.cursor/skills -> .claude/skills`）与按需生成物桥接。
- **根目录零文件侵入**：`FRAMEWORK-MANIFEST.json` 中 `seeded: []` 恒为空，严禁在下游项目根目录投放 `AGENTS.md` 或 `CLAUDE.md`；Cursor 宿主说明统一维护在 `.cursor/rules/cc-base-cursor-host.mdc`（`alwaysApply: true`）。
- **`.claude/settings.json` 必须是 `string` form**：Cursor 不认 `exec` form 的 `args`（会导致一个 hook 都不跑）；安装器与 `sessionStart` 自动确保 `.claude/settings.json` 转为 `string` form，且绝不触碰 `.cac/settings.json` 或用户自定义非 `.claude/hooks/` 条目。
- **生成物与软链不入库**：`.cursor/skills`、`.cursor/agents/*.md` 与 `.cursor/rules/cc-base-claude.mdc` 均为本地联接或生成物（由安装器与 `sessionStart` 联合指纹 `cursor-gen.sha256` 自动维护），经 `.gitignore` 与 `manifest.mjs` 严格排除；钉子代理模型只写 `.cursor/agents-models.json`。
- **零外部依赖与 Windows PowerShell 一等公民**：仅用 Node `>= 20.0.0` 内置模块；子进程调用一律 `shell: false, windowsHide: true`；URL 转路径一律 `fileURLToPath`；`setup.ps1` 必须保持纯 7-bit ASCII 无 UTF-8 BOM；卸载与拆链严禁递归删除链接目标，确保 `.claude/` 100% 完好无损。
- **可证性原则**：新增任何适配层控制之前先在 Cursor 里证明它会响；拦不住 / 证不出的闸不进家底。测试全程在临时副本目录运行，绝不污染源仓工作树。

## Done

- 2026-11-27 **原地升级为 v3.0.0 纯软链（Zero-Copy Link）全平台发行版（对齐 `cac-base-link` 架构）**：① 退役 521 个拷贝入库的 `.claude/` 文件与 `sync-from-cc-base.sh`（旧快照保留于 tag `v2.2.0-bundled-backup`），落地 `cc-base-contract.json` 与 `scripts/cursor-base.mjs` + `scripts/lib/{path-guard,link-manager,cc-dep,config-merge,manifest}.mjs` 零依赖跨平台事务安装内核，配齐纯 ASCII 无 BOM `setup.ps1`、`setup.sh` 及向后兼容薄壳 `setup-cursor.sh`；② 实现三层解耦 `cc-base` 自动寻源联装（Tier 1 复用已有 `.claude/` 或 `--with-cc` 升级；Tier 2 按 `--cc-base` → `.bundled-cc-base` → `$CC_BASE_DIR` → `../cc-base` 自动调上游 `setup.ps1 -HookForm string` / `setup.sh --hook-form string` 一步联装；Tier 3 无源或 `--no-auto-cc` 退 `0` 延迟自愈）及 `release <ver> --bundle-cc <dir>` 单包离线制品能力；③ 实现根目录零文件侵入，原根级 `AGENTS.md` 宿主差异协议完整迁入 `.cursor/rules/cc-base-cursor-host.mdc`（`alwaysApply: true`），升级时自动将旧版 v2 框架生成的根级 `AGENTS.md` 归档至 `.cursor/.runtime/migrated-v2-<ts>/`（保留用户自定义 `AGENTS.md` 不动）；④ 落地 `config-merge.mjs` 无损合并/卸载剥离 `.cursor/hooks.json` 与 `.cursor/cli.json`，并提供纯 Node 兜底的 `ensureClaudeSettingsStringForm`；⑤ 增强 `hook-adapter.mjs`：`sessionStart` 毫秒级自愈 `.cursor/skills` 联接（Windows NTFS Junction / POSIX 相对软链）、`.claude/settings.json` `string` form、`cc-base-claude.mdc` 与 `.cursor/agents/*.md`（核对 `.cursor/.runtime/cursor-gen.sha256` 联合指纹）及未追踪外层父仓 `GIT_CEILING_DIRECTORIES` 隔离；`beforeShellExecution` 前置接入 `ps-floor.mjs`（含 F-05.1 `isSafePowerShellEnvCommand`）双壳安全硬地板，补齐 Windows PowerShell 危险删除、`-EncodedCommand` 与密钥外泄拦截；⑥ 新增双模式 `.cursor/scripts/doctor.mjs`（支持 `--source-check`、`--json` 与无参外部 `cwd` 智能回退 `selfRoot`）及跨平台 GitHub Actions `gate.yml`。

- 2026-11-25 **对齐 `cursor-agent` `2026.11.22` 源码契约与两轮全三阶段对抗审查闭环，完成适配层彻底重构并同步 cc-base ce100eb**：① `gen-rules.mjs` 从 `.claude/CLAUDE.md` 生成 `.cursor/rules/cc-base-claude.mdc`（`alwaysApply: true` 全文强注入，`0755`/`0644` 权限加固）；② 新增 `.cursor/skills -> ../.claude/skills` 相对软链（关闭第三方 `.claude/` 导入时仍发现全部技能，开启时按 `realpath` 自动去重），`setup-cursor.sh` 前置源仓校验并加 `link_skills`，`sync-from-cc-base.sh` 显式绑定 `CLAUDE_PROJECT_DIR="$HERE"` 与 `--file` 堵死跨仓环境变量污染；③ `.cursor/hooks.json` + `hook-adapter.mjs` + `cursor-hook-preload.mjs` 正交覆盖 5 个原生事件（`beforeReadFile` `failClosed: true` 多根/`cwd`/多跳悬空软链与 `EACCES` 硬护栏、`beforeShellExecution` 发布命令 `ask` 确认、`sessionStart` + `subagentStart`/`subagentStop` 经 `.claude/evidence/.cursor-subagents/` 每子代理独立原子文件与 `NODE_OPTIONS` 窄作用域预加载补齐子代理 `agent_id`，`CLAUDE_PROJECT_DIR` 优先隔离，彻底解决 `no-direct-code-guard` 误拦 `implementer`），与 `.claude/settings.json` 零重复执行；④ `gen-agents.mjs` 补齐引号剥离、YAML 行尾 `:` 与行内 ` #` 转义、仅同时禁 `Write`+`Edit` 时输出 `readonly: true` 及可执行脚本统一 `0755`；⑤ 同步 cc-base `ce100eb`（521 文件），`AGENTS.md` 通过 `scan-instructions.mjs` 零误差零告警，`test-adapter.sh` 67/67 全绿。

- 2026-11-04 **重建为 cc-base 全量 + 薄适配层**（b80ba52）。旧引擎打 tag `v2.1.1-legacy` 推送后清空 main；旧 progress.md 整体搬成 progress.archive.md；旧 docs/feedback 的 11 篇教训逐篇并进 cc-base/.claude/feedback（新建 3、追加 2、6 篇已覆盖），本仓不再留第二套教训库。
- 2026-11-04 适配层落地：`sync-from-cc-base.sh`（HEAD 清单、自有文件排除、按上次清单删旧文件、.gitignore 白名单核对、转 string form、重生成 agents，两次同步幂等）、`setup-cursor.sh`（setup.sh --hook-form string + 铺 .cursor/ 与 AGENTS.md，已有同名不覆盖落 .framework-new）、`.cursor/scripts/gen-agents.mjs`、`.cursor/tests/test-adapter.sh`。
- 2026-11-04 最终验收（装到空项目后 `cursor-agent -p`）：人设 SiteMaster 中文 ✓；子代理清单含 8 个 cc-base 角色 ✓；编辑工具写 src/ 被 no-direct-code-guard 拦 ✓；启动注入含「核心铁律」✓；`model: inherit` 的 tester 子代理真起来并回报 ✓（证明 `.cursor/agents/` 压过 `.claude/agents/`，生成格式 Cursor 认）。
- 2026-11-04 首次 code review（Stage 0+1）残留全部修完（B2）：白名单核对挪到拷贝前；幂等用例改在临时副本跑、测试不再动工作树；自测补正文逐字比对与假 cc-base 夹具（45 条，review 的 7 个突变各有断言变红）；gen-agents 与 setup-cursor 清理失源的生成物；版本文件去时间戳；`disallowedTools` 里 Task / Agent 任一都插「不要再派子代理」，其它被禁工具写成「不要用 X 工具」。同步基线更新到 cc-base 9467190。

## Decisions

- 2026-11-27 **原地升级为 v3.0.0 纯软链（Zero-Copy Link）+ 三层解耦 `cc-base` 自动寻源联装 + `--bundle-cc` 离线合包**。依据：彻底消除本仓重复拷贝 521 个 `.claude/` 文件与人工跑 `sync-from-cc-base.sh` 的版本漂移负担；通过三层寻源（已有复用 → 自动发现联装并传 `--hook-form string` → 无源延迟交由 `sessionStart` 自愈）兼顾本机一键体验与离线合包交付。适用范围：全仓安装与运行时架构。取代：2026-11-04「重建为 cc-base 全量拷贝 + `sync-from-cc-base.sh`」方案。
- 2026-11-27 **根目录零文件侵入（宿主说明迁入 `.cursor/rules/cc-base-cursor-host.mdc`）与旧版 v2 `AGENTS.md` 指纹归档**。依据：多宿主（Claude Code / Cursor / CodeAgent CLI / Antigravity）同仓协作时，根目录投放 `AGENTS.md` 会与其它宿主或用户自定义 `AGENTS.md` 冲突；Cursor 原生支持 `.cursor/rules/*.mdc` 的 `alwaysApply: true` 全自动注入，迁入后根目录 100% 干净。适用范围：`manifest.mjs`（`seeded: []`）、`cc-base-cursor-host.mdc`、`cursor-base.mjs`。取代：向目标项目根目录复制 `AGENTS.md` 的做法。
- 2026-11-27 **`beforeShellExecution` 前置接入 `ps-floor.mjs` 双壳安全硬地板**。依据：`.claude/settings.json` 中的 `dangerous-pkill-guard` 与 `secret-exfil-guard` 主要针对 POSIX Bash 语法编写，Windows PowerShell 下的 `Remove-Item -Recurse -Force`、`Get-Content .env`、`-EncodedCommand` 与 `Env:` 管道外传存在逃逸盲区；在 `hook-adapter.mjs` `beforeShellExecution` 前置运行纯函数 `ps-floor.mjs` 并在命中时返回 `permission: "deny"` + exit `2`，即使尚未安装 `.claude/` 亦能守住底线。适用范围：`.cursor/scripts/ps-floor.mjs`、`.cursor/scripts/hook-adapter.mjs`。取代：2026-11-04 决策中 `beforeShellExecution` 仅管发布 `ask` 不拦 PowerShell 高危命令的边界。
- 2026-11-04 **同步只认 cc-base HEAD，不认工作树**（历史归档，v3.0.0 已由 Zero-Copy Link 取代 `sync-from-cc-base.sh`）。
- 2026-11-04 **子代理一律 `model: inherit`**。依据：cc-base 的 `model: sonnet / opus` 在 Cursor 里解析成 Claude 模型，用户账号 Claude 周配额用尽时子代理起不来（实测报 not included in your weekly usage）；inherit 跟主 agent 走，用户在 Cursor 里选什么它就用什么。适用范围：`.cursor/agents/` 全部；要钉模型写 `agents-models.json`。取代：无。
- 2026-11-04 **不加 beforeSubmitPrompt 桥接 release-gate**。依据：`cursor-agent -p` 下连原生 beforeSubmitPrompt / stop / afterAgentResponse 都不触发，本机证明不了桥接会响；宿主规则写明 Cursor 下发布前主 Agent 自查 `.claude/.needs-review`。适用范围：本仓适配层。取代：无。交互模式 / IDE 验证后可重开（TODO #2）。
- 2026-11-04 **cc-base 专有 agent 字段的落法**：`skills:` → 正文首句「先完整读技能文件」；`disallowedTools` 含 Task 或 Agent → 「不要再派子代理」，其它被禁工具各一句「不要用 X 工具」（Bash 写作 Shell（Bash））；`memory: project` → 「记忆在 agent-memory/<角色>/MEMORY.md」；color / maxTurns 丢弃。依据：Cursor 子代理 frontmatter 只认 name / description / model / readonly / is_background（官方文档），技能不预载就等于没派单上下文，禁用的工具没有对应字段只能写进正文。适用范围：gen-agents.mjs。取代：首版「disallowedTools 其它项直接丢弃」。
- 2026-11-04 **`.cursor/cli.json` 只做密钥 deny + 只读命令 allow，不搬旧引擎的 shell-policy**。依据：cc-base 主干闸门与 `ps-floor.mjs` 在 Cursor 下照跑；旧 shell-policy 那 700 行 TS 是另一套机制，留着就是两套口径。适用范围：本仓。取代：旧引擎的 beforeShellExecution 策略（随 v2.1.1-legacy 退役）。
- 2026-11-04 **失源的生成物要清**：`.cursor/agents/` 里带生成注释、但 `.claude/agents/` 已没有同名源的文件，gen-agents 与安装器都删；没带注释的手写文件不动。依据：Cursor 优先读 `.cursor/agents/`，残留等于一个已删的角色继续存在。适用范围：gen-agents.mjs / cursor-base.mjs。取代：无。
- 2026-11-25 **新增 `.cursor/rules/cc-base-claude.mdc`（`alwaysApply: true`）强制全文注入主控规则**。依据：实测内网弱模型（如 Grok）或未开启第三方 `.claude/` 导入时，模型会跳过口头读文件指示导致失控；且 Cursor `.mdc` 中的 `@file` 引用不会自动全文内联，因此由 `gen-rules.mjs` 从 `.claude/CLAUDE.md` 直接生成全文，由安装器与 `sessionStart` 自动刷新零漂移。适用范围：`.cursor/rules/cc-base-claude.mdc`、`gen-rules.mjs`、`hook-adapter.mjs`、`cursor-base.mjs`。取代：仅靠口头指引模型自己调 `Read` 读 `.claude/CLAUDE.md` 的做法。
- 2026-11-25 **用原生 `.cursor/hooks.json` 的 `beforeReadFile` 守住密钥读取，且不重复注册其它事件**。→ 被同日「`.cursor/hooks.json` 五事件正交互补架构」吸收扩展。
- 2026-11-25 **`gen-agents.mjs` 补齐引号剥离、YAML 边界转义与只读角色 `readonly: true` 硬约束**。依据：修复源 frontmatter 已带引号时被二次 `JSON.stringify`、行尾 `:` 或行内 ` #` 被 YAML 截断/报错及 `0777`/`0666` 过宽权限问题；并利用 Cursor 原生 `readonly: true` 让**同时禁 `Write` 与 `Edit`** 的纯只读角色由运行时硬禁写操作（内置 `code-reviewer` 需用 `Edit/Write` 写 `agent-memory` 故不输出）。适用范围：`.cursor/scripts/gen-agents.mjs`、`.cursor/scripts/gen-rules.mjs`。取代：2026-11-04 决策中只读角色仅靠正文提示「不要用 Write/Edit 工具」的部分。
- 2026-11-25 **`.cursor/hooks.json` 五事件正交互补架构（`hook-adapter.mjs` + `cursor-hook-preload.mjs`）**。依据：反查 `cursor-agent` `2026.11.22` 源码契约确认三处缺口：① `preToolUse`/`postToolUse` 在子代理内不传 `agent_id`，导致 `no-direct-code-guard` 误拦 `implementer`；② `preToolUse` 忽略 `ask`，发布命令无法弹确认；③ `settings.json` 无文件读取钩子。由 `hooks.json` 挂 `sessionStart`、`subagentStart`/`subagentStop`、`beforeReadFile`（`failClosed: true`）、`beforeShellExecution`，与 `.claude/settings.json` 主干闸门职责正交、零重复执行。适用范围：`.cursor/hooks.json`、`.cursor/scripts/hook-adapter.mjs`、`.cursor/scripts/cursor-hook-preload.mjs`。
- 2026-11-25 **铺设 `.cursor/skills -> .claude/skills` 跨平台联接并固化环境变量隔离**。依据：Cursor 关闭第三方 `.claude/` 导入时仍扫描原生 `.cursor/skills`，开启时按 `realpath` 自动去重零重复；同时显式绑定 `CLAUDE_PROJECT_DIR` 与 `--file` 防止改坏外部项目配置。适用范围：`link-manager.mjs`、`cc-dep.mjs`、`config-merge.mjs`、`hook-adapter.mjs`。

## 当前断点（2026-11-27）

v3.0.0 纯软链（Zero-Copy Link）跨平台安装器内核、三层 `cc-base` 自动联装与 `--bundle-cc` 离线合包、`sessionStart` 毫秒级指纹自愈、`ps-floor.mjs` 双壳安全地板与 `doctor.mjs` 已全部落地并通过 `pack-check` 与 `/tmp` 全生命周期实测；待独立 `cac-tester` 编写 `.cursor/tests/` 测试套件与 `cac-reviewer` 审查收口。

## TODO

- [ ] #1 P2 交互模式 / IDE 下验证 Stop / UserPromptSubmit / SubagentStop 是否触发（print 模式不触发已实测）；验证结果写进 `.cursor/rules/cc-base-cursor-host.mdc`。
- [ ] #2 P3 beforeSubmitPrompt 桥接 release-gate——等 #1 证明 beforeSubmitPrompt 在交互模式会响再加。
- [x] #3 P3 Windows PowerShell 安装器与跨平台路径/钩子链路——2026-11-27 v3.0.0 已落地纯 ASCII 无 BOM `setup.ps1` + Node 零依赖 `scripts/cursor-base.mjs`（Windows 免管理员 NTFS Junction、`ps-floor.mjs` 双壳安全地板与 GitHub Actions `windows-latest` + `ubuntu-latest` 双平台矩阵门禁）。
- [x] #4 P3 IDE 下密钥读取拦截——2026-11-25 由原生 `.cursor/hooks.json` `beforeReadFile`（`failClosed: true`）+ `hook-adapter.mjs` 焊死（deny JSON + exit 2），不再单靠 CLI 专用的 `.cursor/cli.json`。
- [x] #5 P2 首次提交前 code review 残留（M1–M4 / L1–L2 / 存疑）——2026-11-04 B2 全部修完，见 Done。
- [x] #6 P2 B2 复核冒出的 N1（失源判据只认注释子串，复制改名的定制 agent 会被误删）——2026-11-04 B3 修完：判据绑定注释里的源文件名必须等于本文件名，gen-agents 与安装器两条路都对齐。

## In Progress

- 无。

## 明确不做（防过度工程）

- 不在本仓拷贝或维护 `.claude/` 原件（形态转换由 `config-merge.mjs` / `hook-form.mjs` 在下游完成）。
- 不为 Cursor 另写一套 skills / rules / agents；不维护第二套 feedback。
- 不在下游项目根目录投放 `AGENTS.md`（零根文件侵入）。
- 不复活旧引擎的任何部件（assurance profile、hash 链账本、700 行 TS shell-policy、module catalog）。

## Notes

- Cursor 的「Include Third-Party Plugins, Skills, and Other Configs」默认开启，用于加载 `.claude/settings.json` 的主干 hooks；即使关闭，`.cursor/rules/cc-base-claude.mdc`、`.cursor/rules/cc-base-cursor-host.mdc`、`.cursor/skills` 联接、`.cursor/agents/` 与 `.cursor/hooks.json` 仍原生生效（开启时 `.cursor/skills` 按 `realpath` 自动去重）。
- Cursor CLI 装完会把 `~/.local/bin/agent` 指向自己；`cursor-agent` 是不冲突的显式命令入口。
- 跟 cc-base 的 Cursor 兼容实测全在 cc-base 的 progress.md（2026-11-04 Decisions）：args 键不认、纯文本 stdout 丢弃、Task 工具名与字段、`-p` 模式事件触发面。
