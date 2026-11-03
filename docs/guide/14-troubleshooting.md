# 14 故障排查

这章解决的问题：闸响了不知道为什么、闸该响没响、命令报了个码不知道该修引擎还是修代码、跨平台跑出编码错、推送与打 tag 假死。每条按「症状 → 先查什么 → 原因 → 处置」四段，每段指到仓里真实的文件或命令。排查顺序照 `~/.claude/CLAUDE.md` 的调试顺序：先看日志（`.claude/evidence/gate-block.log` / hook stderr），再用命令复现，再缩小范围。

通用第一步：

```bash
bash .claude/scripts/doctor.sh .
node .claude/harness/harness.mjs tier status
tail -20 .claude/evidence/gate-block.log
```

## hook 完全不触发

**症状**：SessionStart 没有铁律横幅；改 `src/` 没被 `no-direct-code-guard` 拦；Stop 从不提醒待审。

**先查**：

```bash
bash .claude/scripts/doctor.sh .          # 看「settings.json 每条 hook 的 args[0] 都指向真实存在的文件」「hook 语法」「node 可用」三行
node --check .claude/hooks/stop-gate.mjs
claude --version
```

**原因**（`doctor.sh` 逐项对应）：`node` 不在 PATH（22 个 hook 全靠它）；`settings.json` 不是合法 JSON；某条 hook 的 `args[0]` 指向不存在的文件（老版本装出来的 `.sh/.ps1` 还挂着）；hook 语法错，注册着却起不来，每次事件报一次 hook error 而那行小字没人读；Claude Code 版本太老不认 exec form（`command: node` + `args`）；在错误目录启动导致 `.claude/settings.json` 没被加载。

**处置**：`doctor.sh` 报什么修什么。老安装升级上来的跑 `bash .claude/scripts/fix-platform.sh`（删 hooks/ 下遗留 `.sh/.ps1`、把 settings 里指向它们的 command 改写成 exec form、补 scripts 执行位，幂等）；Windows 跑 `fix-platform.ps1`。`SessionStart` 横幅在 `source=compact/resume` 时静默是设计（`session-rules-banner.mjs`），不算故障。

## tdd-gate 拦了 implementer 派单

**症状**：派 implementer 时 stderr 出 `[block] TDD 闸门：派 implementer 做 GREEN 实现前须先完成 RED。` 且工具调用被拒。

**先查**：

```bash
node .claude/harness/harness.mjs tier explain tdd-gate
ls -la .claude/.red-verified .claude/.tdd-exempt
grep tdd-gate .claude/evidence/gate-block.log | tail -3
```

**原因**（`.claude/hooks/tdd-gate.mjs`）：它挂在 PreToolUse(Agent)，看 `tool_input.subagent_type === 'implementer'` 和 prompt 里有没有 red-lock 关键词（没有就静默放行）；strict 档 block、standard advise、fast off；放行靠 `.claude/.red-verified` 或 `.claude/.tdd-exempt`，且标记有两小时保质期（`MARK_TTL_MS`），过期的当场删掉——本仓一枚 9 月 11 日留下的空标记让闸静默放行了四天。改家底自动升 strict，所以正在改 hooks / skills 时含 red-lock 关键词的派单必被拦（不含关键词的单子静默放行，见 05 章）。

**处置**：高价值逻辑（契约 / 解析器 / 状态机 / schema 校验）先派 tester 出红、亲见 fail、`touch .claude/.red-verified` 再派；UI / 样式 / 非 TDD 逻辑 `touch .claude/.tdd-exempt`。旧版本按 Bash 命令文本匹配 `implementer` 字样会误伤 `cat …implementer.md`，2026-09-15 起改挂 Agent 事件，命令文本不再触发。

## no-direct-code-guard 拦了主 Agent 写文件

**症状**：主 Agent 用 Edit / Write 写 `src/…` 时 exit 2，stderr `主 Agent 不应直接写业务源码`。

**先查**：路径是否命中 `SOURCE` 正则 `(src|app|lib|components|pages|api|server|client|utils|models|services)/`，是否被 `EXEMPT`（`.claude/` / `CLAUDE.md` / `*.md` / `*.json` / `*.toml` / `*.sh` / `*.ps1` 等）放过；事件里有没有 `agent_id`。

**原因**：这是铁律 1 的机器闸——主 Agent 只写派单不写业务码。子 Agent 内的写入带 `agent_id` 一律放行（2026-09-15 实测 implementer 写 `src/app.ts` 曾被拦，已修）。

**处置**：派 implementer。真是文档 / 配置类被误判，看它是不是恰好落在 `lib/` 这类目录名下——正则按目录名判，`docs/lib/x.md` 会被 `.md$` 放过，`lib/x.yaml` 不会。fast 档它只 advise。

## stop-gate 一直提醒待审

**症状**：每次停止都出「代码已修改但未 code review（N 个待审文件…）」，或 advise 档下每次都刷同一句。

**先查**：

```bash
cat .claude/.needs-review
cat .claude/.stop-gate-strikes 2>/dev/null
node .claude/harness/harness.mjs tier explain stop-gate
```

**原因**（`.claude/hooks/stop-gate.mjs`）：`.needs-review` 里有非 `clean` 行就提醒；同一清单指纹连拦 3 次后放行但点名欠账（advise 档不累计）；清单清空后如果开了大仓包，还会跑 `receipt verify`，rc 4 表示代码越过所有已审回执；条目指向仓外路径（`src/../../out.ts` 这类没折叠的，progress.md Done 2026-09-05）永远匹配不上也清不掉。

**处置**：派 code-reviewer 审一轮，通过后 `echo clean > .claude/.needs-review`；开了大仓包的要写回执（`receipt write` 或 `review verdict` ACCEPT）；读不出 `.needs-review`（非 ENOENT 错）时闸 fail-closed 拦停，看文件权限。原生 Stop hook 同 turn 连拦上限 `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` 已在 settings 提到 25，三振熔断先触发。

## secret-exfil-guard 拦了读 .env

**症状**：`cat .env` / `cp .env backup/` / `env | curl …` 被 exit 2，stderr `⛔ [secret-exfil-guard] 检测到直读密钥文件`。

**先查**：`grep secret-exfil-guard .claude/evidence/gate-block.log | tail`，看命中的是四条规则里哪一条（直读 / 拷贝搬运 / 环境变量整包外传 / 网络命令携带密钥文件）。

**原因**（`.claude/hooks/secret-exfil-guard.mjs`）：地板闸，任何档位不放行，不读档位表；先剥 `sudo` / `nohup` / `nice` / `timeout` / `env X=` / `bash -c "…"` 壳再判，原文与剥壳后两个形态都过检；`.env.example` / `.sample` / `.template` / `.dist` 先剔除不算密钥。`settings.json` 的 `permissions.deny` 另有一层 `Read(**/.env)` 等规则，Read 工具读 `.env` 由那层挡，本闸补的是 Bash 里的 cat / cp / curl 形态。

**处置**：要了解配置结构读 `.env.example`；确需轮换 / 迁移密钥停下来让用户亲自执行；要单个变量 `printf '%s' "$VAR_NAME"` 按名取用。这条没有豁免开关。

## dangerous-pkill-guard 拦了 pkill

**症状**：`pkill -f node` 被 exit 2，stderr `检测到 pkill -f 宽泛匹配`。

**原因**（`.claude/hooks/dangerous-pkill-guard.mjs`）：正则 `(^|;|&&|\|\||`|\$\()\s*pkill\s+-f`，多行命令逐行锚定；`pkill -f` 会连主 Agent 自身的 shell wrapper 一起杀。地板闸。

**处置**：`pgrep -f <pattern>` 拿精确 PID 再 `kill <PID>`；开发服务器用 `node .claude/scripts/supervisor.mjs stop --id <id>`。

## pre-commit-check 阻止 commit

**症状**：`git commit` 被 PreToolUse(Bash) exit 2，stderr 以 `❌` 开头。

**先查**：stderr 第一行是哪一类：`TypeScript 类型检查` / `Python` / `JavaScript 语法检查（node --check）` / `大仓四态质量门未通过` / `大仓四态质量门跑不起来` / `pre-commit-check 自身异常`。

**原因**（`.claude/hooks/pre-commit-check.mjs`）：只检查本次 staged 涉及的栈；TS 跑 `tsc --noEmit`，Python 优先 `ruff check` 降级 `py_compile`（逐个候选解释器探 `--version`，Windows 上裸 `python3` 常是 Store stub）且只有输出含 `SyntaxError` 才拦；catalog 在时跑 `harness verify`，rc 2 阻断，契约外退出码（不是 0/2/3）按引擎崩了处理同样阻断；闸自身崩了 exit 2 不静默。advise 档（fast）照报不拦并记账。

**处置**：按 stderr 修代码；「跑不起来」那类去 `node .claude/harness/harness.mjs verify` 看真实报错；这是会话内的闸，git 层还有 `.claude/githooks/pre-commit` 另一套（第 12 章）。

## `large-repo engine not installed`

**症状**：任一 ext 子命令 stderr `large-repo engine not installed: .claude/harness/ext missing (run setup.sh --with-harness)`，rc 3。

**原因**（`harness.mjs` `EXT_MISSING` / `tryExt`）：`.claude/harness/ext/` 目录不存在。只有目录缺席才给这句；目录在但某个分节 import 抛错是引擎坏了，会原样抛栈不给这句。

**处置**：`bash setup.sh --with-harness <target>`（Windows `setup.ps1 -WithHarness`）；不打算用大仓能力就别放 catalog。`doctor` JSON 的 `extInstalled` 看装没装。

## catalog 在但 ext 没装

**症状**：每次 Stop 出 `systemMessage`「大仓治理已开启（module-catalog.json 在）但引擎包未装，本次 回执绑定校验（harness receipt verify） 未验」；commit 时 stderr 同一句；`doctor.sh` 判 ✗。

**原因**：开关（catalog）与引擎（ext）只齐一半，三道闸跑不成但不许静默（`.claude/hooks/lib/harness.mjs` `harnessExtMissingNotice`）。

**处置**：二选一——装包，或删 `.claude/harness/module-catalog.json`。不拦不改退出码，但会一直出声。

## doctor 报 manifest SHA 不符

**症状**：`✗ FRAMEWORK-MANIFEST 不符：hooks/stop-gate.mjs 期望 xxxxxxxx 实际 yyyyyyyy` 或 `✗ FRAMEWORK-MANIFEST 缺失：…登记了但本地没有`。

**先查**：

```bash
bash .claude/scripts/gen-manifest.sh --check
git status --short .claude/
```

**原因**：在框架仓——改了框架文件没重跑生成器；在目标项目——你改过框架文件（升级时那份会被当「用户改过」不覆盖），或清单来自另一个版本。`doctor.sh` 全量比对不抽样，缺件另算一档。

**处置**：框架仓 `bash .claude/scripts/gen-manifest.sh` 重生；目标项目确认改动是有意的（保留）还是误改（用 `setup.sh` 重装那份），不要为了让 doctor 绿去手改清单里的哈希。

## CI 红本地绿

**症状**：本地 `run-all.sh` RC=0，GitHub Actions 某格 failure。

**先查**：

```bash
gh run list --limit 5
gh run view <run-id> --log-failed
```

看红的是哪格（ubuntu / windows × node 22 / 24 / ps1）和哪一步。

**原因**：本地默认 `--level high`，CI `--level all`；本地没 pwsh `check-syntax` rc 3 放行，Windows 格 rc 3 判失败；`scan-instructions` 本地 githook 2026-09-15 前不跑；Windows 格的 `autocrlf` / cp1252 编码问题本机不会出现。细节见第 12 章「本地绿不等于 CI 绿」。

**处置**：本地补跑红的那一步的同一条命令（`node .claude/harness/audit/scan-instructions.mjs`、`bash .claude/tests/cases/run-all.sh --level all`）；修完推送后再读一次 `gh run list`；失败的 run 有 `runall-<os>-node<ver>` artifact 可下载看完整日志。

## Windows PowerShell 5.1 读 .ps1 报编码错

**症状**：`setup.ps1` / `fix-platform.ps1` / `fast-mode.ps1` / `install-githooks.ps1` 在 Windows 自带 PowerShell 5.1 下报解析错误或乱码；native 命令的 stderr 让脚本整个中止。

**原因**（progress.md Pinned 三条）：5.1 按 GBK 读无 BOM UTF-8，文件含中文即解析崩——所以剩余 `.ps1` 必须纯 ASCII，中文只能 `\uXXXX` 转义；5.1 下 git / npx 写 stderr 会生成 ErrorRecord，`$ErrorActionPreference='Stop'` 把它提升为 terminating error，`*>$null` 拦不住；`$PSNativeCommandUseErrorActionPreference` 是 7.3+ 变量对 5.1 无效。hook 自 2026-09-06 起全是 `.mjs`，不受此影响。

**处置**：改 `.ps1` 前 `.claude/tests/test-ps1-behavior.ps1` 组 0 有纯 ASCII 断言，CI ps1 格用 `Parser::ParseFile` 逐个解析；本机若有 pwsh 7 用它跑一遍只说明逻辑对，不代表 5.1 安全；调可能写 stderr 的 native 命令用 `--quiet` / `2>$null` / `try/catch` / 局部 `$ErrorActionPreference='Continue'`。

## WSL 与 Windows 混用路径

**症状**：hook 在一边正常另一边不响；事件里的路径是 `src\app.ts` 形态；`.sh` 报 `$'\r': command not found`。

**先查**：`echo $CLAUDE_PROJECT_DIR`；`git config core.autocrlf`；`file .claude/tests/cases/run-all.sh` 看行尾。

**原因**：hook 的路径判定靠 `io.mjs` 的 `toPosix()` 先把反斜杠归一再匹配（`no-direct-code-guard.mjs` 注释：不归一这条闸在 Windows 等于不存在）；`tier.mjs` 读 `tier.json` / `profile.json` 先剥 `\r`；`.sh` 脚本被 autocrlf 转成 CRLF 后 bash 跑不了（`gate.yml` 在 checkout 前 `git config --global core.autocrlf false`，本仓没有 `.gitattributes` 兜底）。项目根解析顺序 `CLAUDE_PROJECT_DIR` → git 顶层 → cwd，两边启动 Claude Code 的目录不同就是两个项目。

**处置**：同一个 checkout 只从一边跑；Windows 侧 `git config core.autocrlf false` 后重新 checkout；不确定路径归一是否覆盖到你的场景，用 `bash .claude/tests/test-hooks-node.sh` 在 Git Bash 里跑一遍（CI ps1 格跑的就是它）。这条本仓没有专门用例，属经验总结。

## git push 假死

**症状**：`git push` 卡十几分钟后 `curl 28 Recv failure` / `the remote end hung up unexpectedly`，`git status` 显示 ahead 1。

**先查**：

```bash
git ls-remote origin refs/heads/main
git rev-parse HEAD
```

**原因**（维护者 2026-09-10 在本机记录到的偶发现象）：对象往往已送达，只是回包丢了，本地 `origin/main` 指针没刷新；真因未查明，属偶发。按铁律 4，被中断的远程调用一律按「可能已执行」对待。

**处置**：推送写成 `timeout 120 git push`；超时后 `ls-remote` 与 `HEAD` 一致就 `git fetch origin main` 刷新指针，不一致再重推。`release` 子命令的 `remote` 项实查 `git ls-remote`，不读 `git status` 的 ahead/behind 缓存。

## 打 tag 与远端冲突

**症状**：`git push --tags` 被拒，或打出的 tag 名远端早有。

**原因**（progress.md Pinned 2026-06-14）：只查本地 `git tag` 判「首个 tag」，本地无 tag ≠ 远程无 tag——v1.0.1 就这样误判过。

**处置**：

```bash
git ls-remote --tags origin
git -c user.name=<name> -c user.email=<email> tag -a vX.Y.Z -m "…"
```

本机没有全局 git 身份时 `commit` / `tag -a` 带 `-c` 标志（本仓 memory 记录）。发版是 HIGH 档，`release-builder` 设 `disable-model-invocation`，用户亲自敲。

## 上下文压缩后规则「忘了」

**症状**：`/compact` 或自动压缩后主 Agent 开始直接写业务码、不派 reviewer、不记 progress。

**先查**：压缩后有没有出现 `PostCompact: …` 开头的 systemMessage 或 additionalContext；`.claude/harness/harness.mjs` 在不在。

**原因**（`.claude/hooks/postcompact-reinject.mjs` 头注释）：压缩不是稀释约束，是删除——二十轮没被引用过的铁律正是摘要器最先丢的。框架在压缩边界两端各有一闸：`precompact-gate.mjs` 压缩前检查 `.needs-review` 有欠账或工作树有改动但 progress.md 不在改动集，命中拦一次让人先 `/record`（同 session 10 分钟内不拦第二次）；`postcompact-reinject.mjs` 压缩后跑 `harness invariants` 把不可交易集 + 活跃状态经 `additionalContext` 注回，约 1200 字符预算；包没装走自带最小派生（Pinned + 待审 + 档位）。两者都是地板闸。

**处置**：看到 `PostCompact: .claude/harness/harness.mjs is missing` 或 `the harness failed` 这两句降级说明，说明没注回，手动 `/recap-project`（读 progress.md + Product-Spec.md + CHANGELOG 三份）；引擎报错去 `node .claude/harness/harness.mjs invariants` 看。

## 子 Agent 撞 maxTurns 没回执

**症状**：派出去的 implementer / tester 停了，回来的不是回执信封（没有 Status / Changed / Verified 四态开头），或工具报轮次上限。

**先查**：`.claude/agents/<role>.md` 的 `maxTurns`（implementer 100 / tester、code-reviewer、deployer 60 / evolution-runner 30 / 其余 25）；派单包是不是七字段齐全、Business Context 有没有写 N/A。

**原因**（`.claude/rules/subagent-dispatch.md`）：`maxTurns` 是熔断线不是目标；LOW / MEDIUM 单子应 ≤ 6 次工具调用，预期 > 60 分钟说明任务分解不合理；缺上下文的 fresh 实例只能猜，猜就烧轮次。progress.md Done 2026-09-06 记过撞 60 / 100 轮上限四次。

**处置**：`SendMessage` 续跑同一实例（那次记录里均成功）；重派走升级阶梯——① 补齐上下文重派 fresh ② 补不齐砍范围重切 ③ 缺陷定位类换 bug-fixer ④ 三步不通升级用户；重派必须至少变一项（上下文 / 范围 / 角色 / 模型），同 prompt 同模型原样重发属于赌运气。回执缺栏时 `subagent-acceptance-reminder.mjs` 只注给子 Agent 自己，主 Agent 这侧靠读回执正文验收。

## fast 档到期自动回落

**症状**：`tier set fast --hours 4 --reason …` 之后过了几小时闸又开始拦；`tier status` 显示 `source=default`。

**先查**：

```bash
node .claude/harness/harness.mjs tier status
cat .claude/.runtime/tier.json
grep -P '\ttier\t' .claude/evidence/gate-block.log | tail -3
```

**原因**（`.claude/hooks/lib/tier.mjs` `readSession`）：fast 硬上限 8 小时，写侧截断、读侧再夹一次（锚点取 `min(set_epoch, now)`，缺 `set_epoch` / `expires_epoch` 的 fast 记录不认）；`expires_epoch` 到期即视为无覆盖回默认档，不靠人记得关；旧的 `.claude/.fast-mode` 文件一概不读。每次 `tier set` 往 `gate-block.log` 记一行 `tier`。

**处置**：这是设计不是故障。要继续放水再 `tier set fast --hours N --reason "…"`；`fast-mode.sh on [hours]` 是它的薄壳。改了家底文件时会被 `raise` 抬到 strict 压过 session 的 fast（合并规则只抬不降）。

## dev server 被莫名杀掉

**症状**：另一个终端里跑着的 Vite / Next 突然退出，时间点正好是 Claude Code 里跑了 `pnpm dev`。

**先查**：`echo $CC_DEV_PORTS`；`node .claude/harness/harness.mjs tier explain kill-dev-ports`。

**原因**（`.claude/hooks/kill-dev-ports.mjs`）：PreToolUse(Bash) 命中 `pnpm dev` 时清掉默认端口 3000 / 3001 / 4173 / 5173 / 8080 上的进程（POSIX `lsof` + `kill -9`，Windows `netstat -ano` + `taskkill /F`），恒 exit 0 零输出——它是顺手清场不是闸。

**处置**：`CC_DEV_PORTS=4000,4001` 限定靶子（逗号分隔整数；给了却一个合法值都没有时本次一个都不清并出一行 stderr，不退回默认表）；fast 档它 off。

## githook 装了但 status 说没有执行位

**症状**：`install-githooks.sh status` 输出 `pre-commit：在，但**没有执行位**——git 不会跑它`。

**原因**：`core.hooksPath` 指对了，但 hook 文件失去了执行位（跨平台拷贝、某些 checkout 方式会丢 mode）；git 按文件名找 hook 且要求可执行。

**处置**：重跑 `bash .claude/scripts/install-githooks.sh on`（它会 `chmod 0755` 三个文件再写 config）。Windows 的 Git for Windows 用自带 sh 跑同一套脚本，不需要 `.ps1` 版本。

## 引擎给了契约外退出码

**症状**：stop-gate 出「harness receipt verify 以契约外退出码 1 退出（契约只有 0/3/4）」；pre-commit-check 出「大仓四态质量门跑不起来」。

**先查**：手动跑同一条命令看真实 stderr：

```bash
node .claude/harness/harness.mjs receipt verify
node .claude/harness/harness.mjs verify
ls .claude/harness/lib .claude/harness/ext
```

**原因**：`ext/` 半装或损坏、`lib/` 缺失、node 版本问题——是引擎崩了不是门没过。三道闸对契约外码都不静默放行（stop-gate 三振后放行但点名欠账）。

**处置**：修引擎——重跑 `setup.sh --with-harness` 整目录覆盖；`node .claude/harness/harness.mjs selftest` 绿了再停止 / 提交。
