# cursor-base (v3.0.0 — Zero-Copy Link Edition)

`cc-base` 的全平台零拷贝软链（Zero-Copy Link）Cursor 发行版，全面支持 **Windows PowerShell + WSL + Linux + macOS**。

自 v3.0.0 起，`cursor-base` 彻底告别拷贝 500+ 个 `.claude/` 文件与手工运行 `sync-from-cc-base.sh` 的旧模式：上游 `.claude/`（`cc-base`）作为唯一规则/技能/角色/钩子真相源，`.cursor/` 仅持有 9 个轻量级适配文件 + 2 份无损合并配置（`hooks.json` / `cli.json`）+ 跨平台 OS 目录软链（`.cursor/skills`）+ 自动自愈生成物（`cc-base-claude.mdc` 与 `.cursor/agents/*.md`），且做到**下游项目根目录零文件侵入**（原根级宿主说明已迁入 `.cursor/rules/cc-base-cursor-host.mdc`）。

## 目录结构

```text
cursor-base/
├── setup.ps1                         # 纯 7-bit ASCII 无 BOM PowerShell 安装入口 -> scripts/cursor-base.mjs
├── setup.sh                          # POSIX sh 安装入口 -> scripts/cursor-base.mjs
├── setup-cursor.sh                   # 向后兼容入口（薄壳转发至 setup.sh）
├── cc-base-contract.json             # 对上游 cc-base (.claude/) 的能力契约声明
├── package.json                      # Node >= 20 ESM 工程脚本定义（零 npm 依赖）
├── scripts/
│   ├── cursor-base.mjs               # 事务安装/升级/v2迁移/卸载/自检/清单/离线合包 CLI 内核
│   └── lib/
│       ├── path-guard.mjs            # Windows 保留名/系统目录/越界路径前置护栏
│       ├── link-manager.mjs          # Windows NTFS Junction + POSIX 相对软链幂等管理与安全拆链
│       ├── cc-dep.mjs                # 三层解耦 cc-base 寻源联装 (--hook-form string) 与 --bundle-cc 合包
│       ├── config-merge.mjs          # hooks.json / cli.json 无损合并及 .claude/settings.json string form 转换
│       └── manifest.mjs              # LF-SHA256 清单校验与开发者路径/密钥反泄漏扫描
└── .cursor/                          # 注入下游项目的轻量级适配壳
    ├── .gitattributes / .gitignore   # 忽略本地 OS 软链 skills、生成物与运行态 .runtime/
    ├── FRAMEWORK-MANIFEST.json       # 受管适配文件的 LF-SHA256 清单（seeded: [] 零根文件侵入）
    ├── hooks.json                    # 五事件正交互补钩子（与 .claude/settings.json 零重复）
    ├── cli.json                      # Cursor CLI 权限护栏（密钥读写一律 deny）
    ├── rules/
    │   └── cc-base-cursor-host.mdc   # 宿主适配协议（alwaysApply: true，承接原根级 AGENTS.md）
    └── scripts/
        ├── hook-adapter.mjs          # 5 事件适配器（含 sessionStart 毫秒级指纹自愈 + beforeShellExecution 双壳地板）
        ├── cursor-hook-preload.mjs   # 窄作用域 NODE_OPTIONS 子代理 agent_id 身份桥接
        ├── ps-floor.mjs              # Bash + PowerShell + CMD 跨平台危险命令与密钥外泄硬地板
        ├── gen-rules.mjs             # .claude/CLAUDE.md -> .cursor/rules/cc-base-claude.mdc 生成器
        ├── gen-agents.mjs            # .claude/agents/*.md -> .cursor/agents/*.md 生成与联合指纹计算
        └── doctor.mjs                # 双模式（源仓 / 下游项目）完整性与形态健康自检
```

## 环境要求

- **Node.js >= 20.0.0**（零第三方 npm 依赖，单运行时）
- **Git**
- **Cursor IDE** 或 **Cursor CLI**（`cursor-agent`）
- Cursor 设置中「Include Third-Party Plugins, Skills, and Other Configs」保持默认开启（即使关闭，`.cursor/rules`、`.cursor/skills` 联接、`.cursor/agents` 与 `.cursor/hooks.json` 仍 100% 原生生效；开启时 Cursor 按 `realpath` 自动去重零重复）

## 一键安装与三层 `cc-base` 自动联装

### Linux / macOS / WSL / Git Bash

```sh
./setup.sh /path/to/your-project
# 或指定上游 cc-base 路径并同步升级底座：
./setup.sh /path/to/your-project --with-cc --cc-base /path/to/cc-base
```

### Windows PowerShell

```powershell
pwsh -File .\setup.ps1 D:\work\your-project
# 或指定上游 cc-base 路径：
pwsh -File .\setup.ps1 -Target D:\work\your-project -WithCc -CcBase D:\work\cc-base
```

安装器内置**三层解耦 `cc-base` 寻源策略**：
1. **Tier 1（复用已有底座）**：目标项目已有合规 `.claude/` 时直接零拷贝复用（传 `--with-cc` 则同步升级 `.claude/`）。
2. **Tier 2（一步自动联装）**：目标缺 `.claude/` 且未设 `--no-auto-cc` 时，按 `--cc-base <dir>` → `.bundled-cc-base` → `$CC_BASE_DIR` → `../cc-base` 顺序自动调用上游 `cc-base` 安装器并默认传 `--hook-form string`，一步装齐 `.claude/` + `.cursor/`。
3. **Tier 3（先装壳后自愈）**：无可用源或显式传 `--no-auto-cc` 时先装入 `.cursor/` 适配壳并正常退出（exit `0`）；后续装好 `cc-base` 后打开新 Cursor 会话即由 `sessionStart` 毫秒级自动补齐软链、生成物与 `string` form 转换。

> **重要提示**：升级框架或重装后，请**退出并重开新 Cursor 会话**（Cursor 仅在会话启动时读取一次 hook 注册表，`--resume` 旧会话不会重新加载新路径）。

## 常用运维与离线合包命令

```sh
# 预览安装计划（零磁盘写入）
node scripts/cursor-base.mjs install /path/to/your-project --dry-run

# 下游项目健康自检（校验 string form、skills 软链枚举数、生成物与 SHA256 清单）
node /path/to/your-project/.cursor/scripts/doctor.mjs

# 升级适配层（用户手工改过的文件保留原件并旁落 *.cursor-new；旧版 v2 根级 AGENTS.md 自动归档至 .cursor/.runtime/）
node scripts/cursor-base.mjs upgrade /path/to/your-project

# 安全卸载（仅摘除 .cursor/skills 联接与受管生成物，100% 不触碰 .claude/）
node scripts/cursor-base.mjs uninstall /path/to/your-project

# 源仓全量打包门禁自检
node scripts/cursor-base.mjs pack-check

# 构建含离线 .bundled-cc-base 的单包发行制品
node scripts/cursor-base.mjs release v3.0.0 --bundle-cc /path/to/cc-base --out /tmp/cursor-base-v3.0.0.tar.gz
```

## 多端零冲突共存

同一代码仓库可同时安装 `cc-base`（Claude Code）+ `cursor-base`（Cursor）+ `cac-base-link`（CodeAgent CLI）+ `agy-base`（Antigravity）：
- `cursor-base` 将 `.claude/settings.json` 保持为 `string` form（Claude Code / Antigravity / CodeAgent 均完全兼容），且绝不修改 `.cac/settings.json`；
- 根目录零文件侵入（`seeded: []`），各宿主规则在各自隐藏目录内正交生效。

## 历史版本

- `v2.2.0-bundled-backup`：v3.0.0 纯软链化之前的最后一版全量内嵌 `.claude/` 快照。
- `v2.1.1-legacy`：早期独立 TypeScript harness 治理引擎归档快照。
