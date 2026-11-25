# cursor-base

cc-base 的 Cursor 发行版。cc-base 是一套给 Claude Code 用的产品开发框架——SiteMaster 人设、从需求到发布的全流程 Skill、主 Agent 只派单不编码的 Sub-Agent 模型、hook 闸门与档位。Cursor（IDE 与 `cursor-agent` CLI）原生会读 `.claude/` 下的 CLAUDE.md、skills、agents 和 settings.json 的 hooks，所以本仓不另写一套，就是 cc-base 原件加一层很薄的适配：

```
cursor-base/
├── .claude/                 # cc-base 原件（CLAUDE.md / rules / skills / agents / hooks / scripts / tests …）
│   └── settings.json        # 已转成 Cursor 认的 string form（hook 命令是单字符串）
├── .cursor/
│   ├── agents/              # 从 .claude/agents 生成：model: inherit、同时禁 Write+Edit 带 readonly: true、正文开头多三句
│   ├── rules/               # 从 .claude/CLAUDE.md 生成：cc-base-claude.mdc（alwaysApply: true 强注入主控规则）
│   ├── skills               # 本地相对软链 -> ../.claude/skills（setup/sync 建链，经 .cursor/.gitignore 不入库）
│   ├── .gitignore           # 忽略本地目录软链 /skills 与运行态（防 git 跟踪目录软链让 scan-secrets 退 3）
│   ├── agents-models.json   # 要给某个角色钉模型就写这里，gen-agents 读它（没有就全部 inherit）
│   ├── scripts/             # gen-agents.mjs、gen-rules.mjs、hook-adapter.mjs、cursor-hook-preload.mjs
│   ├── hooks.json           # 原生互补 hooks（beforeReadFile / beforeShellExecution / sessionStart / subagentStart / subagentStop，与 settings.json 零重复）
│   ├── tests/               # 适配层自测（不装进目标项目）
│   ├── cc-base-files.txt    # 上次同步的 cc-base 清单（同步脚本写，据此删 cc-base 已没有的文件）
│   ├── cc-base-version.txt  # 上次同步的 cc-base 提交与日期
│   └── cli.json             # Cursor CLI 侧权限：密钥文件读写一律 deny
├── AGENTS.md                # Cursor 每次请求都读：指向 .claude/CLAUDE.md，只写宿主差异
├── setup.sh / setup.ps1     # cc-base 原件的安装器（支持 --hook-form string）
├── setup-cursor.sh          # 装到目标项目：setup.sh --hook-form string + 铺 .cursor/（含 skills 软链）与 AGENTS.md
├── sync-from-cc-base.sh     # 从 cc-base 仓同步原件，转 string form，重生成 agents / rules 并确保 skills 软链
├── docs/                    # cc-base 原件
├── progress.md              # 本仓的项目记忆
└── README.md
```

## 要求

- Node.js 22 或更新（hook 与脚本都是 .mjs，单运行时）
- Git
- Cursor IDE，或 Cursor CLI（`curl https://cursor.com/install -fsS | bash`，命令名 `cursor-agent`；安装脚本会把 `~/.local/bin/agent` 也指向它，机器上有别的工具占着这个名字的话装完改回去）
- Cursor 的「Include Third-Party Plugins, Skills, and Other Configs」保持默认开启（用于加载 `.claude/settings.json` 的主干 hooks；即使关闭，`.cursor/rules`、`.cursor/skills`、`.cursor/agents` 与 `.cursor/hooks.json` 仍原生生效，开启时 `.cursor/skills` 按 `realpath` 自动去重零重复）

## 装到一个项目

```sh
git clone https://github.com/zylimit/cursor-base.git
cd cursor-base
./setup-cursor.sh /path/to/your-project
```

装完进项目目录敲 `cursor-agent`（或在 IDE 里打开），开场应看到 SiteMaster 横幅和「🔒 CC框架核心铁律」。没看到横幅先跑 `bash .claude/scripts/doctor.sh`，再核对 `node .claude/scripts/hook-form.mjs --check` 打印的是 `string`。

同一个项目也能继续用 Claude Code（或叠加 Antigravity `agy-base`）：string form 的 hook 两个宿主都认，`.claude/` 原件一个字没改。

**拉框架更新或重装之后，退出 Cursor 重开一个新会话。** Cursor 的会话只用进程启动那一刻读到的 hook 列表，配置文件后来改了也不重新加载，`--resume` 接回的旧会话同样不行。从 `v2.1.1-legacy` 升上来时这一条最要紧：旧会话里还挂着 `node .cursor/runtime/harness.mjs` 且 fail closed，那个文件一删，每次工具调用都报 `Cannot find module .cursor/runtime/harness.mjs` 被拦，会话里的 AI 自己也修不了（修复动作走同一条工具通道）。重开新会话即恢复，不用改任何文件。

## Cursor 下跟 Claude Code 的差异

全在 AGENTS.md，装进目标项目后那份就在项目根。要点：hook 必须是 string form；Notification / PostCompact / UserPromptExpansion 三个事件 Cursor 没有；`.cursor/hooks.json` + `hook-adapter.mjs` + `cursor-hook-preload.mjs` 正交补齐 `beforeReadFile`（`failClosed: true` 密钥读取硬护栏）、`beforeShellExecution`（发布类命令弹 `ask` 确认）与子代理 `preToolUse`/`postToolUse` 缺 `agent_id` 的身份桥接；子代理模型走 `.cursor/agents/` 的 `inherit`（仅同时禁 `Write` 与 `Edit` 时输出 `readonly: true`），要钉模型写 `.cursor/agents-models.json`。

## 跟 cc-base 同步

```sh
./sync-from-cc-base.sh /path/to/cc-base
bash .claude/tests/cases/run-all.sh
bash .cursor/tests/test-adapter.sh
git add -A && git commit
```

同步按 cc-base HEAD 的清单覆盖原件，显式绑定 `CLAUDE_PROJECT_DIR` 转 string form，重写 `.cursor/agents/` 与 `.cursor/rules/cc-base-claude.mdc`，确保本地 `.cursor/skills -> ../.claude/skills` 软链（经 `.cursor/.gitignore` 排除不进 git 索引，防目录软链让 `scan-secrets` 报 `not-a-regular-file` 退 3）并写两份同步记录；不碰本仓的 README.md、progress.md、progress.archive.md、.gitignore、AGENTS.md、`.cursor/.gitignore`、`.cursor/cli.json`、`.cursor/hooks.json`、`.cursor/agents-models.json`、`.cursor/scripts/`（`gen-agents.mjs`、`gen-rules.mjs`、`hook-adapter.mjs`、`cursor-hook-preload.mjs`）、`.cursor/skills`、`.cursor/tests/` 和两个适配脚本。

## 旧版本

2.1.1 之前的 cursor-base 是一套独立的治理引擎（TypeScript harness、assurance profile、hash 链账本），2026-11-04 起停止维护，完整保留在 tag `v2.1.1-legacy`。
