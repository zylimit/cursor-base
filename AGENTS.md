# cursor-base

本仓是 cc-base（Claude Code 产品开发框架）的 Cursor 发行版：`.claude/` 整套就是 cc-base 的原件，`.cursor/`、`setup-cursor.sh`、`sync-from-cc-base.sh` 和本文件是适配层。人设、铁律、流程、技能、子代理全在 `.claude/CLAUDE.md` 和它指向的 `.claude/rules/`、`.claude/skills/`、`.claude/agents/`——**先完整读 `.claude/CLAUDE.md`，再按它办事**，本文件只写 Cursor 这个宿主跟 Claude Code 不一样的地方。

## Cursor 里照常的（原生读取，不用转换）

- `.claude/CLAUDE.md`：开场人设、路由、铁律、审批三档。
- `.claude/skills/*`：斜杠 `/技能名` 可调，`disable-model-invocation: true` 的（release-builder / branch-finisher）照样只许用户亲自敲。
- `.claude/agents/*`：Task 工具派发，fresh 上下文、可并行、子代理只许再嵌套一层——跟 cc-base 的派单模型一致。实际生效的是 `.cursor/agents/` 下的同名生成版（见下）。
- `.claude/settings.json` 的 hooks：事件自动映射 SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop / SubagentStop / PreCompact；exit 2 拦截生效，`hookSpecificOutput.additionalContext` 注入生效，Stop 的 `decision: block` 变成追问。

## Cursor 里不一样的

- **hook 注册是 string form**：`"command": "node .claude/hooks/<name>.mjs"`，没有 `args`。Cursor 不认 cc-base 默认的 exec form（`"command": "node"` + `args`），那种写法在 Cursor 下一个 hook 都不会跑。本仓的 settings.json 已是 string form；从 cc-base 同步过来之后要跑 `node .claude/scripts/hook-form.mjs --to string`（`sync-from-cc-base.sh` 会做）。
- **工具名映射**：Bash → Shell、Edit → Write，matcher 照常匹配；hook 收到的 stdin 是 Cursor 的形状（`tool_name: "Shell"`、`workspace_roots`），`CLAUDE_PROJECT_DIR` Cursor 也会设。
- **三个事件 Cursor 没有**：Notification（notify.mjs，完成通知）、PostCompact（postcompact-reinject.mjs，压缩后回注不变量）、UserPromptExpansion（release-gate.mjs）。release-gate 在 Cursor 下不会跑：用户敲 `/release-builder` 之前，主 Agent 自己先看 `.claude/.needs-review` 是不是 clean、待审清单清完才进发布流程，这一步在 Cursor 里靠自觉。压缩后回注没有替代——上下文被压缩后先 `/recap-project` 再继续。
- **拦截能力弱一截**：preToolUse 只认 allow / deny，`ask` 不生效；preCompact 只能观察不能拦。precompact-gate 在 Cursor 下只是提醒，压缩前自己先把决策写进 progress.md。
- **`cursor-agent -p`（print 模式）只响 sessionStart 和工具类事件**：UserPromptSubmit / Stop / SubagentStop 在 print 模式下不触发（2026-11-04 实测），stop-gate、three-file-sync-gate、subagent-acceptance-reminder 在脚本化调用里不会提醒；交互模式与 IDE 里的触发情况还没验证过。
- **派子代理的工具名是 Task**：它的 tool_input 跟 Claude Code 的 Agent 同名（description / prompt / subagent_type），tdd-gate 挂在 `PreToolUse` 的 `Agent|Task` 组上，两边都命中。
- **纯文本 stdout 不进上下文**：hook 要注入提示只能走嵌套 JSON（cc-base 的 `io.mjs` 的 `context()`）。
- **子代理模型**：cc-base 的 `model: sonnet / opus` 在 Cursor 里解析成 Claude 模型，账号没有 Claude 配额时子代理起不来。`.cursor/agents/` 下有一套同名文件，由 `.cursor/scripts/gen-agents.mjs` 从 `.claude/agents/` 生成，`model: inherit` 跟主 agent 走；`.cursor/agents/` 优先级高于 `.claude/agents/`。要给某个角色钉模型，写 `.cursor/agents-models.json`（形如 `{"code-reviewer": "auto"}`），生成器读它；`.cursor/agents/` 里的文件是生成物，同步会重写，别手改，也别改 `.claude/agents/`（同步会覆盖）；要定制角色，复制一份改名即可，生成器只清理注释里源名等于自己文件名的失源文件。
- **技能预载与记忆**：Claude Code 靠 agent frontmatter 的 `skills:` / `memory:` 把技能和持久记忆接给子代理，Cursor 没有这两个字段——生成版把它们写成正文开头的三句：有 `skills:` 的加「开工前先完整读 `.claude/skills/<技能>/SKILL.md`（Cursor 不会像 Claude Code 那样把技能预载给子代理），再按下文行事」；有 `disallowedTools: Task` 的加「不要再派子代理」；有 `memory: project` 的加「你的持久记忆在 `.claude/agent-memory/<角色>/MEMORY.md`，先读它，改动也写回那里」。`disallowedTools` 里 Task / Agent 之外的每一项写成正文一句「不要用 X 工具」（Bash 写 Shell（Bash））；`color` / `maxTurns` 这类 Claude Code 专有字段直接丢弃。
- **权限**：Claude Code 的 `permissions` 块 Cursor 不读，等价配置在 `.cursor/cli.json`（密钥文件读写一律 deny）。
- **已知口子**：主 Agent 用 shell 重定向写文件（`> file`、`tee`、`sed -i`）绕得过 no-direct-code-guard。这是闸的漏洞，不是许可：写业务代码一律派 implementer（feedback：edit-files-through-edit-tool-not-shell-writes）。

## 装到目标项目

`./setup-cursor.sh <目标目录>`：先跑 cc-base 的 `setup.sh <目标目录> --hook-form string`，再铺 `.cursor/agents/`、`.cursor/scripts/`、`.cursor/cli.json`（有 `agents-models.json` 也带上）与本文件；目标已有同名文件不覆盖，落 `<文件>.framework-new`。`.cursor/tests/` 是本仓的自测，不装进目标。装完在目标项目里 `cursor-agent` 开场应看到 SiteMaster 横幅。详见 README.md。

## 跟 cc-base 同步

`./sync-from-cc-base.sh <cc-base 仓路径>`：按 cc-base **HEAD** 的 git 清单覆盖本仓的 cc-base 原件（cc-base 工作树必须干净），然后转 string form、重新生成 `.cursor/agents/`，并写 `.cursor/cc-base-files.txt`（本次清单，下次据此删掉 cc-base 已经没有的文件）与 `.cursor/cc-base-version.txt`。不碰的：README.md、progress.md、progress.archive.md、.gitignore、AGENTS.md、`.cursor/cli.json`、`.cursor/agents-models.json`、`.cursor/scripts/`、`.cursor/tests/`、两个适配脚本。本仓 `.gitignore` 从 `/*` 起到 `# === Cursor 适配层 ===` 之前那段必须与 cc-base 的 `.gitignore` 逐字相同，不同时同步退 1，手工对齐后再跑。同步后跑 `bash .claude/tests/cases/run-all.sh` 再提交。
