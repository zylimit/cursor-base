# 02 安装与初始化

这章解决：把框架装进一个项目、确认它真的在跑、以及升级和卸载。读完你能在十分钟内完成安装并看到第一条框架横幅。

## 前置条件

| 依赖 | 用途 | 缺了会怎样 |
|---|---|---|
| Node.js 22 或 24 | 21 个 hook 全靠它跑 | 装得上，但没有任何闸生效，pre-commit 会打「PATH 上没有 node」 |
| git | 档位判断、待审清单、闸账本都以仓库根为准 | 大部分闸静默退出 |
| bash | 跑 `setup.sh`、脚本与测试 | Windows 纯 PowerShell 用 `setup.ps1` |
| jq | `settings.json` 自动合并 | 可选。没有时新项目直接复制；已有 settings 备份 `.bak` 并打印手工合并指引 |
| python3 | `fix-platform.sh`、部分测试 | 可选 |
| Claude Code 2.1.x 以上 | hook 用 exec form 注册、Agent 工具事件带 `subagent_type` | 太旧的版本 hook 不触发 |

## 拿到框架

从 GitHub Release 下载 zip，或直接 clone 仓库：

```bash
gh release list -R zylimit/cc-base --limit 3          # 看最新版本号
gh release download <版本号> -R zylimit/cc-base -p '*.zip'
unzip cc-base-<版本号>.zip
```

zip 里不含 `progress*.md`、`docs/`、`.claude/research/`、`.claude/agent-memory/`，含 `.claude/tests/`。clone 仓库拿到的是全量。

## 装到你的项目

```bash
bash cc-base/setup.sh /path/to/your-project
```

不给目标路径就是装到当前目录。装的是 `.claude/` 整棵树加 `settings.json` 合并，不碰你项目的其他文件。

安装器选项：

| 选项 | 作用 |
|---|---|
| `--dry-run` | 一个字节都不写，只打 create / update / conflict / skip 四类计划 |
| `--with-tests` | 把框架自测 `.claude/tests/` 整目录装进去（默认不装） |
| `--with-harness` | 把大仓治理引擎 `.claude/harness/ext/` 与它的两份细则装进去（默认不装，见 [11 大仓治理](11-large-repo.md)） |
| `-win` `-mac` `-ubt` | 平台提示；`-win` 会转交给 `setup.ps1` |

先演练一次再真装是好习惯：

```bash
bash cc-base/setup.sh --dry-run /path/to/your-project
```

你会看到：

```
dry-run: 只算不写，/path/to/your-project 一个字节都不动
  create   .claude/agents/deployer.md
  create   .claude/agents/evolution-runner.md
  ...
  create   .claude/CLAUDE.md
  create   .claude/settings.json
  create   .claude/FRAMEWORK-MANIFEST.txt
  create   .claude/feedback/FEEDBACK-INDEX.md
dry-run: create=130 update=0 conflict=0 skip=0（conflict 真装时会落 <文件>.framework-new）
```

真装完最后两行是：

```
installed: hooks=22 skills=18 target=/path/to/your-project
完成。Claude Code 会从 /path/to/your-project/.claude/settings.json 加载 hooks（node 跑 .mjs，三平台同一份）。
```

Windows 纯 PowerShell：

```powershell
pwsh -File cc-base\setup.ps1 -Target C:\path\to\project [-DryRun] [-WithTests] [-WithHarness] [-Force]
```

跑的是 PowerShell 7（pwsh）。装出来的 hook 与 bash 侧逐字节同一份 `.mjs`，Windows 只要 `node.exe` 在 PATH 上。

## 安装器做了什么

1. 校验目标路径每一段（拒绝 `..`、控制字符、Windows 非法字符与保留设备名）。
2. 加独占锁，防两个 setup 同时写一棵树；上一次崩在半路留下的陈旧锁会被接管并打印说明。
3. 按 `.claude/FRAMEWORK-MANIFEST.txt` 逐文件分层：目标没有的 create；目标内容等于旧版本框架的 update（安全覆盖，留 `.bak`）；目标被你改过的 conflict，新版本落成 `<文件>.framework-new` 供手工合并，你的文件不动；不在清单里的目标侧文件是你的私有层，一律不碰。
4. `settings.json` 走合并：有 jq 就把框架的 hooks 追加进你已有的各事件下，已有的不重复；先清掉老版本装的 `.sh` / `.ps1` 形态 hook。
5. 清掉运行态标记与锁，跑 `fix-platform.sh` 把历史遗留的 `.sh` / `.ps1` hook 归一到 node 单运行时。

排除表在 `.claude/harness/exclusions.json`，它是安装器、清单生成器、Windows 安装器三处 skip 规则的唯一来源。

## 验证安装

```bash
cd /path/to/your-project
bash .claude/scripts/doctor.sh .
```

你会看到一串 `✓`，末尾：

```
✓ harness.mjs 存在
✓ harness lib/ 存在（引擎拆库后 harness.mjs 单文件跑不起来）
- harness ext/ 未装（大仓治理引擎默认不装，setup --with-harness 才有）
- module-catalog.json 未配置（大仓治理默认关闭，接线走原逻辑）
✓ FRAMEWORK-MANIFEST 全量比对 127 条 SHA 一致
doctor: 通过
```

doctor 会核对：每个 hook 文件存在且 `node --check` 通过、`settings.json` 每条 hook 的 `args[0]` 指向真实文件、agents 名单与 CLAUDE.md 调度表一致、rules 地板文件齐全、清单 SHA 全量一致。任何一条 `✗` 都说明装歪了，按它点名的文件补。

然后在项目根启动 Claude Code。SessionStart 会打两段：

```
tier: standard（来源 default）
🔒 CC框架核心铁律：
1. 主 Agent 不亲自编码/审查/测试/部署——一律派 Sub-Agent（implementer / code-reviewer / tester / deployer）
2. 按档审查：Task 先定 LOW / MEDIUM / HIGH，MEDIUM 起派 code-reviewer fresh 实例审，不同 session 自审
...
```

再看状态行（终端底部）：`[模型] | ctx N% | $成本 | tier: standard | 待审 0`。看到这两样就是装好了。主 Agent 随后会按 [项目状态检测](03-first-project.md#项目状态检测) 判断你处在哪个阶段。

## 可选：开 git 侧的闸

Claude Code 的 hook 只在会话内生效。你自己手敲 `git commit`、别的编辑器提交、CI 脚本提交，都绕得过去。想让静态检查挂在 git 上：

```bash
bash .claude/scripts/install-githooks.sh on       # 只改本仓库的 core.hooksPath
bash .claude/scripts/install-githooks.sh status
bash .claude/scripts/install-githooks.sh off
```

三个 hook：pre-commit 跑密钥扫描、指令注入扫描、语法检查（秒级）；commit-msg 拒绝空 subject；pre-push 跑引擎自测。`core.hooksPath` 已被 husky 或 lefthook 占着时 `on` 会拒绝，让你自己拍板。细节在 [12 框架自测与 CI](12-selftest-ci.md)。

## 升级

重跑同一条安装命令。清单分层保证：你没改过的框架文件被安全覆盖，你改过的留原样并落 `.framework-new`。装完看安装器末尾这一段：

```
setup: N 个文件用户侧有改动，未覆盖；新版本已放 <文件>.framework-new 供手工合并：
setup:   - .claude/hooks/xxx.mjs
```

逐个 diff 后合并，合并完删掉 `.framework-new`。跨大版本升级后跑一次 `bash .claude/scripts/fix-platform.sh` 清历史残留，再跑 doctor。

## 卸载

框架只占 `.claude/` 和 `settings.json` 里的 hooks 段。要干净卸载：

```bash
rm -rf .claude/agents .claude/skills .claude/hooks .claude/harness .claude/rules .claude/scripts .claude/feedback .claude/tests
rm -f .claude/CLAUDE.md .claude/FRAMEWORK-MANIFEST.txt .claude/EVOLUTION.md
```

然后手工把 `settings.json` 的 `hooks` 段删掉，`git config --unset core.hooksPath` 关掉 githooks。`progress.md` 是你项目的记忆，留不留自己定。

## 常见坑

- **装完没横幅**：多半没在项目根启动，或者 `settings.json` 合并失败（无 jq 时看安装器 stderr 的手工合并指引）。跑 doctor 看第一条 `✗`。
- **每次事件报 hook error**：老版本装的 `.sh` / `.ps1` hook 还挂在 `settings.json` 里而文件已经没了。跑 `bash .claude/scripts/fix-platform.sh`。
- **Windows PowerShell 5.1 报编码错**：仓里剩余的 `.ps1` 是纯 ASCII，能在 5.1 上跑；但 hook 一律走 `node`，不再有 `.ps1` hook。
- **`--dryrun` 拼错**：安装器只认 `--dry-run`，拼错以 rc 2 拒绝并打印合法选项，不会把它当目标路径装进去。
- **把 `.claude/tests/` 当成必须装**：默认不装，只有维护框架本身或想在目标项目里跑自测才 `--with-tests`。
