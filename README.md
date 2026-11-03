# cursor-base

cc-base 的 Cursor 发行版。cc-base 是一套给 Claude Code 用的产品开发框架——SiteMaster 人设、从需求到发布的全流程 Skill、主 Agent 只派单不编码的 Sub-Agent 模型、hook 闸门与档位。Cursor（IDE 与 `cursor-agent` CLI）原生会读 `.claude/` 下的 CLAUDE.md、skills、agents 和 settings.json 的 hooks，所以本仓不另写一套，就是 cc-base 原件加一层很薄的适配：

```
cursor-base/
├── .claude/                 # cc-base 原件（CLAUDE.md / rules / skills / agents / hooks / scripts / tests …）
│   └── settings.json        # 已转成 Cursor 认的 string form（hook 命令是单字符串）
├── .cursor/
│   ├── agents/              # 从 .claude/agents 生成：model: inherit，正文开头多三句（先读技能 / 不再派子代理 / 记忆位置）
│   ├── agents-models.json   # 要给某个角色钉模型就写这里，gen-agents 读它（没有就全部 inherit）
│   ├── scripts/gen-agents.mjs
│   ├── tests/               # 适配层自测（不装进目标项目）
│   ├── cc-base-files.txt    # 上次同步的 cc-base 清单（同步脚本写，据此删 cc-base 已没有的文件）
│   ├── cc-base-version.txt  # 上次同步的 cc-base 提交与时间
│   └── cli.json             # Cursor 侧权限：密钥文件读写一律 deny
├── AGENTS.md                # Cursor 每次请求都读：指向 .claude/CLAUDE.md，只写宿主差异
├── setup.sh / setup.ps1     # cc-base 原件的安装器（支持 --hook-form string）
├── setup-cursor.sh          # 装到目标项目：setup.sh --hook-form string + 铺 .cursor/ 与 AGENTS.md
├── sync-from-cc-base.sh     # 从 cc-base 仓同步原件，转 string form，重新生成 .cursor/agents
├── docs/                    # cc-base 原件
├── progress.md              # 本仓的项目记忆
└── README.md
```

## 要求

- Node.js 22 或更新（hook 与脚本都是 .mjs，单运行时）
- Git
- Cursor IDE，或 Cursor CLI（`curl https://cursor.com/install -fsS | bash`，命令名 `cursor-agent`；安装脚本会把 `~/.local/bin/agent` 也指向它，机器上有别的工具占着这个名字的话装完改回去）
- Cursor 的「Include Third-Party Plugins, Skills, and Other Configs」保持默认开启（关掉就读不到 `.claude/`）

## 装到一个项目

```sh
git clone https://github.com/zylimit/cursor-base.git
cd cursor-base
./setup-cursor.sh /path/to/your-project
```

装完进项目目录敲 `cursor-agent`（或在 IDE 里打开），开场应看到 SiteMaster 横幅和「🔒 CC框架核心铁律」。没看到横幅先跑 `bash .claude/scripts/doctor.sh`，再核对 `node .claude/scripts/hook-form.mjs --check` 打印的是 `string`。

同一个项目也能继续用 Claude Code：string form 的 hook 两个宿主都认，`.claude/` 原件一个字没改。

## Cursor 下跟 Claude Code 的差异

全在 AGENTS.md，装进目标项目后那份就在项目根。要点：hook 必须是 string form；Notification / PostCompact / UserPromptExpansion 三个事件 Cursor 没有；preToolUse 的 `ask` 不生效；子代理模型走 `.cursor/agents/` 的 `inherit`，要钉模型写 `.cursor/agents-models.json`。

## 跟 cc-base 同步

```sh
./sync-from-cc-base.sh /path/to/cc-base
bash .claude/tests/cases/run-all.sh
git add -A && git commit
```

同步按 cc-base HEAD 的清单覆盖原件，并重写 `.cursor/agents/` 与两份同步记录；不碰本仓的 README.md、progress.md、progress.archive.md、.gitignore、AGENTS.md、`.cursor/cli.json`、`.cursor/agents-models.json`、`.cursor/scripts/`、`.cursor/tests/` 和两个适配脚本。

## 旧版本

2.1.1 之前的 cursor-base 是一套独立的治理引擎（TypeScript harness、assurance profile、hash 链账本），2026-11-04 起停止维护，完整保留在 tag `v2.1.1-legacy`。
