# ARCHITECTURE — cursor-base v3.0.0 架构设计

## 1. 设计定位与核心不变量

`cursor-base` v3.0.0 是面向 Cursor IDE 与 `cursor-agent` CLI 的**零拷贝纯软链（Zero-Copy Link）跨平台治理适配发行版**：

1. **单一真相源（Single Source of Truth）**：上游 `.claude/`（由 `cc-base` 提供）唯一持有主控宪法 `CLAUDE.md`、按需细则 `rules/`、全流程技能 `skills/*/SKILL.md`、8 个标准角色 `agents/*.md` 与主干治理钩子 `hooks/*.mjs`。本仓不再复制任何 `.claude/` 资产。
2. **根目录零文件侵入（Zero Root File Intrusion）**：`FRAMEWORK-MANIFEST.json` 中 `seeded: []` 恒为空；原根级 `AGENTS.md` 中的宿主差异协议完整迁入 `.cursor/rules/cc-base-cursor-host.mdc`（`alwaysApply: true`）；从旧版 v2.x 升级时自动识别并归档旧框架生成的根级 `AGENTS.md`（对用户自定义或其它工具的 `AGENTS.md` 绝不触碰）。
3. **跨平台一等公民与零依赖**：仅使用 Node.js `>= 20.0.0` 内置模块；Windows 走免管理员 NTFS Junction + PowerShell 薄壳 `setup.ps1`（纯 7-bit ASCII 无 BOM），POSIX（Linux / WSL / macOS）走相对符号链接 `../.claude/skills` + `setup.sh`；全部子进程调用强制 `shell: false, windowsHide: true`。
4. **五事件正交互补与双壳安全地板**：`.claude/settings.json`（强制转为 `string` form）承接主干钩子；`.cursor/hooks.json` 仅注册 `.claude/settings.json` 无法覆盖的 5 个原生事件，零重复执行，并由 `ps-floor.mjs` 补齐 Windows PowerShell / CMD 危险命令与密钥外泄硬护栏。

## 2. 模块拓扑

```text
cursor-base/
├── cc-base-contract.json              # 声明对上游 .claude/ 的文件、目录、最低技能数与核心角色/钩子契约
├── setup.ps1 / setup.sh               # 跨平台参数校验与 Node >= 20 版本门禁薄壳
├── setup-cursor.sh                    # 向后兼容薄壳 -> setup.sh
├── scripts/
│   ├── cursor-base.mjs                # 事务安装内核（install | upgrade | uninstall | doctor | manifest | pack-check | release）
│   └── lib/
│       ├── path-guard.mjs             # 逐段拦截 Windows 保留设备名、非法字符、尾随点/空格、系统保护目录与 .. 越界
│       ├── link-manager.mjs           # .cursor/skills 跨平台 Junction/symlink 生命周期管理与防穿透安全拆链
│       ├── cc-dep.mjs                 # 三层解耦 cc-base 寻源联装 (--hook-form string) 与 --bundle-cc 离线合包清洗
│       ├── config-merge.mjs           # hooks.json / cli.json 无损合并剥离 + .claude/settings.json 纯 Node string form 转换
│       └── manifest.mjs               # LF 归一化 SHA256 清单对账与本机路径/凭据反泄漏扫描
└── .cursor/
    ├── FRAMEWORK-MANIFEST.json        # 9 个静态受管适配文件的 LF-SHA256 清单
    ├── hooks.json / cli.json          # 5 事件正交互补钩子与 CLI 侧密钥 deny 权限表
    ├── rules/
    │   ├── cc-base-cursor-host.mdc    # 静态受管：Cursor 宿主差异与自觉守则（alwaysApply: true）
    │   └── cc-base-claude.mdc         # 动态生成（不入库）：从 .claude/CLAUDE.md 全文注入主控宪法（alwaysApply: true）
    ├── skills                         # 动态 OS 联接（不入库）：指向 .claude/skills（Windows Junction / POSIX 相对软链）
    ├── agents/*.md                    # 动态生成（不入库）：model: inherit + readonly: true + 技能/记忆/禁令前缀内联
    └── scripts/
        ├── hook-adapter.mjs           # 5 事件统一调度、sessionStart 毫秒级自愈与 beforeReadFile 多跳软链守卫
        ├── cursor-hook-preload.mjs    # 窄作用域 NODE_OPTIONS 预加载模块（为子代理补齐 agent_id / agent_type）
        ├── ps-floor.mjs               # Bash + PowerShell + CMD 双壳危险命令与密钥外泄纯函数检测库
        ├── gen-rules.mjs              # 主控规则生成器（含防软链穿透写保护）
        ├── gen-agents.mjs             # 角色生成器与 cursor-gen.sha256 联合指纹计算
        └── doctor.mjs                 # 双模式健康自检（源仓 Mode A / 下游项目 Mode B，支持外部 cwd 回退 selfRoot）
```

## 3. 五事件正交互补矩阵（`.cursor/hooks.json` × `.claude/settings.json`）

| Cursor 原生事件 | 注册位置 | 超时 / `failClosed` | 职责与安全边界 |
|---|---|---|---|
| `sessionStart` | `.cursor/hooks.json` + `.claude/settings.json` | `15s` / `false` | `hook-adapter.mjs`：① 存在 `.claude/` 时毫秒级自愈 `.cursor/skills` 联接、`.claude/settings.json` `string` form 及 `cc-base-claude.mdc` / `agents/*.md`（核对 `.cursor/.runtime/cursor-gen.sha256` 联合指纹，无变化 0ms 跳过）；② 返回 `env.NODE_OPTIONS` 挂载 `cursor-hook-preload.mjs`；③ 外层存在未追踪父 `.git` 且本目录无 `.git` 时注入 `env.GIT_CEILING_DIRECTORIES`。主干横幅与进化检查仍由 `.claude/settings.json` 执行。 |
| `subagentStart` | `.cursor/hooks.json` | `10s` / `false` | 在 `.claude/evidence/.cursor-subagents/<hash>.json` 原子写入活跃子代理记录并清理超期项。 |
| `subagentStop` | `.cursor/hooks.json` + `.claude/settings.json` | `10s` / `false` | 精确删除已结束子代理状态文件并在空目录时回收目录；验收提醒仍由 `.claude/settings.json` 执行。 |
| `beforeReadFile` | `.cursor/hooks.json` | `10s` / `true` | 弥补 Cursor 不读 Claude `permissions.deny` 的缺口：多根路径归一化 + 40 跳悬空软链与 `EACCES` 解析，命中 `.env`、私钥或凭据文件立即返回 `permission: "deny"` + exit `2`。 |
| `beforeShellExecution` | `.cursor/hooks.json` | `15s` / `false` | ① 前置执行 `ps-floor.mjs` 的 `checkDangerousCommand` 与 `checkSecretExfil`（覆盖 PowerShell `Remove-Item -Recurse -Force`、`Get-Content .env`、`-EncodedCommand`、环境变量管道外传等 POSIX 钩子盲区），命中即 `permission: "deny"` + exit `2`；② 命中 `gh release` / `npm publish` / `docker push` 返回原生 `permission: "ask"`；其余放行交由 `.claude/settings.json` `PreToolUse` 主干闸门继续检查。 |

## 4. 三层 `cc-base` 联装与六重事务可靠性保障

1. **三层解耦寻源**：
   - **Tier 1**：下游已有合规（或完整可用）`.claude/` 时直接零拷贝复用；显式传 `--with-cc` / `--cc-base` 时触发底座升级。
   - **Tier 2**：下游缺 `.claude/` 且未禁自动联装时，按 `--cc-base` → `.bundled-cc-base` → `$CC_BASE_DIR` → `../cc-base` 寻源并调用 `setup.ps1 -HookForm string` / `setup.sh --hook-form string`。
   - **Tier 3**：无源或 `--no-auto-cc` 时退 `0` 先落 `.cursor/` 适配壳，待后续 `.claude/` 就位后由 `sessionStart` 自动完成全部建链与生成。
2. **锁前防软链穿透与陈旧锁回收**：抢锁前先校验并安全脱开符号链接态的 `.cursor` / `.cursor/.runtime`，`install.lock` 支持死进程（`ESRCH`）、10 分钟超时与目录锁（`EISDIR`）自动接管。
3. **三路无损升级与配置合并**：静态受管文件按 `FRAMEWORK-MANIFEST.json` SHA256 三路判定（用户改过不覆盖，旁落 `*.cursor-new`）；`hooks.json` 与 `cli.json` 走 AST/JSON 级无损合并，100% 保留用户自定义钩子与权限。
4. **旧版 v2.x 无感净化迁移**：精准指纹识别旧版框架投放的根级 `AGENTS.md` 并归档至 `.cursor/.runtime/migrated-v2-<ts>/`，清理废弃的 `cc-base-files.txt` / `cc-base-version.txt`。
5. **跨端无损 `string` form 转换**：优先调用 `.claude/scripts/hook-form.mjs --to string`，内置纯 Node 兜底转换 `.claude/hooks/<name>.mjs` 条目，绝不触碰 `.cac/settings.json` 或非 `.claude/hooks/` 的用户自定义钩子。
6. **零误伤安全卸载**：校验 `engine === "cursor-base"`，仅通过 `rmdirSync`/`unlinkSync` 摘除 `.cursor/skills` 联接本身、清理带生成标记的 `cc-base-claude.mdc` 与 `agents/*.md`、剥离框架注入配置项，**对 `.claude/` 零写入零删除**。
