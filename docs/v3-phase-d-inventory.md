# Phase D 盘点：22 对 hook + 3 对 lib 的契约卡与全部 .sh/.ps1 引用面

> 2026-09-05 由 Explore 只读盘点产出，主 Agent 原样落盘供 tester / implementer / code-reviewer 读。行号以 `feat/v3-tiered` 分支 `9d709ff` 为准。表头写「25 对」是含 3 对 lib 的口径。

---

盘点完成。仓库 `<repo>`，分支 `feat/v3-tiered`，只读。

---

# A. 25 对契约卡

事实校正三条（派单底本先对齐）：
1. **25 对 = 22 个 hook 对 + 3 个 lib 对**（`ls .claude/hooks/` 共 50 个 `.sh`/`.ps1` 文件 + 1 个 `feedback-signals.txt`）。
2. **settings.json 实际注册 21 条 = 21 个不同 hook 文件**（`.claude/settings.json`，脚本枚举核实）。`ARCHITECTURE.md:145,201` 写「19 个」已过期（漏 `postcompact-reinject`、`record-authorship`）。
3. **未注册的只有 `static-check`**（1 对）。`lib-*` 3 对是被 dot-source 的库，不是 hook。

| # | 文件 | 事件 / matcher / timeout | 读 stdin 字段 | 读写状态文件 | 外部命令 | 输出形态 | 退出码契约 | 用了哪些 lib |
|---|---|---|---|---|---|---|---|---|
| 1 | `auto-push` | PostToolUse / `Bash` / 15 | `tool_input.command` | 无 | python3(sh)、`git rev-parse @{u}`、`git rev-list`、`git push` | 无输出 | 恒 0（fail-open） | fast-mode |
| 2 | `check-evolution` | SessionStart / — / 10 | **不读 stdin** | 读 `.claude/feedback/FEEDBACK-INDEX.md` | grep | 裸 stdout 文本（SessionStart 进 context） | 恒 0 | fast-mode |
| 3 | `dangerous-pkill-guard` | PreToolUse / `Bash` / 5 | `tool_input.command` | 写 `.claude/evidence/gate-block.log` | python3(sh) | 纯 stderr | **2=拦**，其余 0；`.sh` 有 `set -euo pipefail` | fast-mode + gate-log |
| 4 | `detect-feedback-signal` | UserPromptSubmit / — / 5 | `.prompt` | `.ps1` 读 `hooks/feedback-signals.txt` | jq(**sh 必需**，缺则 exit 0) | **顶层** `{"additionalContext":…}`（非 hookSpecificOutput） | 恒 0 | fast-mode |
| 5 | `harness-async-verify` | PostToolUse / `Edit\|Write` / 300 / **`asyncRewake:true`** | 消费后丢弃 | 读写 `.claude/.async-verify-last`（180s 防抖，先写后跑）；写 gate-block.log | `node harness.mjs verify`、python3 摘要(sh) | 纯 stderr | **契约 {0,2,3}**；rc=2 或契约外 → **exit 2 唤醒**；其余 0 | fast-mode + harness + gate-log |
| 6 | `kill-dev-ports` | PreToolUse / `Bash` / 10 | `tool_input.command` | 无 | jq(可选)、`lsof`+`kill -9`(sh) / `netstat -ano`+`taskkill`(ps1)、sleep 1 | 无输出 | 恒 0 | fast-mode |
| 7 | `mark-review-needed` | PostToolUse / `Edit\|Write` / 3 | `tool_input.file_path` | **写 `.claude/.needs-review`** + `.needs-review.lock`(sh flock) | jq(**sh 必需**)、flock(可选) | 仅 `.ps1`/`.sh` 各一行 stderr 诊断 | 恒 0（记账 hook） | fast-mode |
| 8 | `no-direct-code-guard` | PreToolUse / `Edit\|Write` / 5 | `tool_input.file_path` ‖ `tool_input.path` | 写 gate-block.log | python3(sh) | 纯 stderr | **2=拦**；`set -euo pipefail` | fast-mode + gate-log |
| 9 | `notify` | Notification / `agent_needs_input\|agent_completed\|permission_prompt` / 5 | `.message` | 无 | python3(sh，缺则固定串兜底) | `{"terminalSequence":…}` | 恒 0（Notification 忽略退出码） | **无**（不吃 fast-mode） |
| 10 | `postcompact-reinject` | PostCompact / — / 15 | `compact_trigger` / `compaction_ratio` / `messages_before` / `messages_after` | 无（引擎读 CLAUDE.md、progress.md） | `node harness.mjs invariants` + `node -e` 拼 JSON(sh) | `{systemMessage, additionalContext}`；降级只给 `{systemMessage}` | 引擎契约 **{0,3}**；本 hook 恒 0（PostCompact 无 decision control） | **无**（不吃 fast-mode、不看 catalog） |
| 11 | `pre-commit-check` | PreToolUse / `Bash` / 30 | `tool_input.command`（匹配 `git\s+commit`，比 auto-push 宽） | 写 gate-block.log | python3(sh)、`git diff --cached`、`npx --no-install tsc`、`ruff`/`py_compile`、`node harness.mjs verify` | 纯 stderr | **verify 契约 {0,2,3}**；rc=2 或契约外 → **exit 2 拦 commit** | fast-mode + harness + gate-log |
| 12 | `precompact-gate` | PreCompact / — / 10 | 消费后丢弃 | 读写 `.claude/.precompact-block-epoch`（600s 冷却，干净时删）；读 `.claude/.needs-review` | jq(可选，缺则硬编码文案)、`git status --porcelain -z -- .` | `{"decision":"block","reason":…}` | **fail-open**：`trap 'exit 0' ERR; set -E`（sh:18-19）/ `trap { exit 0 }`（ps1:23）；恒 exit 0 | fast-mode + gate-log |
| 13 | `recap-on-dirty` | SessionStart / — / 5 | **不读 stdin** | 无 | git、python3(**sh 必需**) | `hookSpecificOutput.additionalContext`（`hookEventName:"SessionStart"`） | 恒 0 | fast-mode |
| 14 | `record-authorship` | PostToolUse / `Edit\|Write\|NotebookEdit` / 10 | `tool_input.file_path` ‖ `tool_input.notebook_path`、`agent_type`、`agent_id` | 引擎写 `.claude/harness/state/authorship.jsonl` | jq(**sh 必需**)、`timeout 10 node harness.mjs authorship record`（stdin 喂 payload） | 失败时一行 stderr | **恒 0**（PostToolUse 非 0 会回灌工具结果） | fast-mode + harness |
| 15 | `release-gate` | UserPromptExpansion / `release-builder` / 10 | `.command_name` | 读 `.claude/.needs-review`；写 gate-block.log | jq(可选) | `{decision:block}` 或 `hookSpecificOutput.additionalContext`（`hookEventName:"UserPromptExpansion"`） | **fail-open** `trap 'exit 0' ERR`；恒 0 | gate-log（**故意不吃 fast-mode**，sh:8） |
| 16 | `secret-exfil-guard` | PreToolUse / `Bash` / 5 | `tool_input.command` | 写 gate-block.log | python3(sh，缺则放行)、sed 剥壳 | 纯 stderr | **2=拦**；`set -euo pipefail` | gate-log（**安全护栏，故意不吃 fast-mode**，sh:11） |
| 17 | `session-rules-banner` | SessionStart / — / 5 | `.source`（compact/resume→静默） | 读 `.claude/.runtime/install.marker`、`.claude/.fast-mode` | python3(sh) | 裸 stdout banner | 恒 0 | fast-mode（**反向用法：播报，不静默**） |
| 18 | `static-check` | **未注册** | 无 stdin，取 `$1=project_dir` | 无 | shellcheck / ruff / `python3 -m py_compile` / `npx tsc` / `node --check` | 裸 stdout | **0=全绿 / 1=有红**（唯一非 hook 语义的退出码） | 无 |
| 19 | `stop-gate` | Stop / — / 5 | **不读 stdin** | 读 `.claude/.needs-review`；读写/删 `.claude/.stop-gate-strikes`；释放时删 `.needs-review` + `.needs-review.lock`；写 gate-block.log | jq(可选)、`node harness.mjs receipt verify`、`cksum`(sh) / SHA256(ps1) | `{decision:block}` / `{systemMessage}`（三振熔断） | **receipt verify 契约 {0,3,4}**；**fail-closed**（`trap _fail_closed ERR`，sh:23）；本体恒 exit 0 | fast-mode + harness + gate-log |
| 20 | `subagent-acceptance-reminder` | SubagentStop / `implementer\|code-reviewer\|tester\|deployer` / 5 | `agent_type` ‖ `subagent_type`、`agent_id`、`session_id`、`transcript_path` | 读写 `.claude/.subagent-reminded`（保留 50 条） | python3(**sh 必需**) | `hookSpecificOutput.additionalContext`（`hookEventName:"SubagentStop"`） | 恒 0 | fast-mode |
| 21 | `tdd-gate` | PreToolUse / `Bash` / 5 | `tool_input.command` | 读 `.claude/.red-verified`、`.claude/.tdd-exempt`（git root 或 pwd） | python3(sh)、`git rev-parse --show-toplevel` | 纯 stderr | **恒 0（建议性，不硬拦）** | fast-mode |
| 22 | `three-file-sync-gate` | Stop / — / 5 | **不读 stdin** | 读 `progress.md`、`Product-Spec.md`、`Product-Spec-CHANGELOG.md`；写 gate-block.log | jq(可选)、`git status --porcelain -z -- .`、`git rev-parse --show-prefix` | `{decision:block}` | **fail-closed**（`trap _fail_closed ERR`，sh:25）；本体恒 0 | fast-mode + gate-log |
| 23 | `lib-fast-mode` | 库（被 15 个 `.sh` dot-source） | — | 读 `.claude/.fast-mode` | `tr -d '\r'`、sed、date(sh) | 无 | 返回值 0=放行 / 非 0=严格（**fail-closed**） | — |
| 24 | `lib-gate-log` | 库（被 9 个 `.sh` source） | — | **追加** `.claude/evidence/gate-block.log`（mkdir -p） | date -u | 无 | 恒 return 0（绝不影响调用方） | — |
| 25 | `lib-harness` | 库（被 5 个 `.sh` source） | — | 探测 `.claude/harness/module-catalog.json` | `command -v node`、`node harness.mjs <sub>` | 无 | `harness_run` 透传引擎 rc | — |

**不吃 fast-mode 的 hook（`grep -L 'lib-fast-mode' *.sh` 实测）**：`notify` / `release-gate` / `secret-exfil-guard` / `postcompact-reinject` / `static-check`。

**用 gate-log 的 9 个**：dangerous-pkill-guard、precompact-gate、three-file-sync-gate、harness-async-verify、release-gate、secret-exfil-guard、no-direct-code-guard、pre-commit-check、stop-gate。
**用 lib-harness 的 4 个 hook**：harness-async-verify、record-authorship、pre-commit-check、stop-gate。

## A' `.sh` / `.ps1` 已知行为差异（逐条，含注释里明写的）

| hook | 差异 |
|---|---|
| `auto-push` | `.sh:24` 用 `git rev-parse --abbrev-ref '@{u}'`；`.ps1:28` **必须**用 `--verify --quiet`，注释（ps1:25-27）明写：5.1 下 `@{u}` 不可解析会往 stderr 写 → `EAP='Stop'` 提升为终止错误 |
| `check-evolution` | **TOTAL 计数口径不同**：`.sh:20` `grep -cE "^- (✅\[已毕业\] )?\["`；`.ps1:17` 是「`^-\s` 且含 `](`」。同一份 INDEX 两边可能报不同总数。`.sh:10` 无 `CLAUDE_PROJECT_DIR` 空值守卫，`.ps1:9` 有 |
| `detect-feedback-signal` | `.sh:23` 中文正则**内联**；`.ps1:19-22` 读 sidecar `hooks/feedback-signals.txt`（UTF8、锚 `$PSScriptRoot`）。**文件丢了 `.ps1` 静默 exit 0 永不触发**，`.sh` 不受影响 |
| `harness-async-verify` | `.ps1:20` 有 `trap { exit 0 }`（内部错 fail-open）；`.sh` 无 trap。`.ps1` 走 `Invoke-Harness`（临时文件收 stderr），`.sh` 用 `mktemp` |
| `kill-dev-ports` | `lsof+kill -9` vs `netstat -ano+taskkill /F`。`.sh:11-13` 无 jq 时 `CMD="$INPUT"`（整个 JSON 串做子串匹配）；`.ps1:13` 解析失败也回退 `$cmd = $raw`，同一取舍 |
| `mark-review-needed` | **`.sh:42-66` 手工逐段折 `.`/`..`**（#49 修复），`.ps1:38-41` 由 **`[System.IO.Path]::GetFullPath`** 折。`.ps1:36-37` 注释：两侧都过 GetFullPath 以展开 **8.3 短名**（`C:\Users\ABC123~1`），比对用 `OrdinalIgnoreCase`。锁：`.sh` flock fd9 + `.needs-review.lock` 文件 / `.ps1` `Global\cc-base-mark-review` Mutex 2000ms，**`.ps1` 不产生 `.lock` 文件**。写法：`.sh` 追加，`.ps1:78` `Set-Content` 整表重写。`.ps1` 在 8.3 短名根下 stderr 诊断会落空（progress.md:25 记） |
| `no-direct-code-guard` | `.ps1:17` 先 `-replace '\\','/'` 再套同一正则 |
| `notify` | `.ps1:13-16` `trap` 输出固定兜底 JSON；`.sh:21` 用 `\|\|` 兜底 |
| `postcompact-reinject` | `.sh:46-68` 用 `node -e` 拼 JSON（输入经环境变量传）；`.ps1:95-98` 用 `ConvertTo-Json`（顺带把非 ASCII 转 `\uXXXX`）。`.ps1:37` 还设了 `OutputEncoding` UTF8 |
| `pre-commit-check` | **Python 分支形态完全不同**：`.sh:50` 直接 `python3 -m py_compile $PY_FILES`；`.ps1:63-119` 依次探 `py -3`/`python`/`python3` 并校验 `--version` 含 `Python 3`（挡 Microsoft Store stub）、**逐文件循环**（避 Error 206 命令行长度）、**只有输出含 `SyntaxError` 才拦**、其余非零一律降级跳过。TS 分支 `.ps1:34-40` 局部 `EAP='Continue'` |
| `precompact-gate` | `.sh` fail-open 靠 `trap 'exit 0' ERR` + `set -E`；`.ps1` 靠 `trap { exit 0 }`。`.ps1:99` `Remove-Item $mark -Force` 已带 `-Force` |
| `recap-on-dirty` | `.sh` 需 python3 生成 JSON；`.ps1` 用 `ConvertTo-Json`。`.ps1:17` git 调用套 try/catch（5.1 fatal→ErrorRecord） |
| `record-authorship` | **`.sh:60-62` 遇任何 `..` 段直接 exit 0 不记**；`.ps1:55-59` GetFullPath 折叠后再比前缀（能记住折完仍在仓内的路径）。`.sh` 需 jq 造 payload + `timeout 10` 包裹；`.ps1` 无 jq，payload 由三段 `ConvertTo-Json` 手拼（ps1:68-74 注释：单元素数组会被 ConvertTo-Json 塌成标量），**无 timeout 包裹**，只靠 settings 的 `timeout:10` |
| `release-gate` | `.sh:27` 待审文件用「、」拼接，`.ps1:35` 用 `, ` |
| `secret-exfil-guard` | 正则字面等价，`.sh` 用 `[^[:space:]]`，`.ps1:48,51` 用 `\S`。剥壳循环同为 5 层 |
| `session-rules-banner` | **提示文案不同且被测试断言**：`.sh:18` 「跑 `bash .claude/scripts/fast-mode.sh off`」，`.ps1:23` 「Run `pwsh .claude/scripts/fast-mode.ps1 off`」——`test-hook-parity.sh:34-43` 断言 `.ps1` 含 `pwsh` + `fast-mode.ps1` 且**不含** `bash fast-mode.sh`。banner 正文：`.sh:31-39` 中文 6 条 heredoc；`.ps1:35-53` ASCII 版。`.sh:17` 用 `command -v fast_mode_active` 判库是否加载 |
| `static-check` | `.ps1` 是 **2026-09-04 才新建的（#45）**，`test-static-check.sh:135-138` 明写「`.ps1` 侧行为无人守」。`.ps1:19` 额外关 `$PSNativeCommandUseErrorActionPreference`；`.ps1:42-63` 自己实现目录级剪枝（跳 ReparsePoint）以模拟 `find -not -path` |
| `stop-gate` | **`.ps1` 六处 `Remove-Item` 必须带 `-Force`**（历史缺陷 `81c63c9`，见第 10 节）。清单指纹算法不同：`.sh:98` `sort \| cksum` → `"$1-$2"`；`.ps1:91-92` SHA256 十六进制。`.sh:44` 用 `if RV_ERR=$(...)` 捕获 rc（`set -E`+ERR trap 下裸赋值会误触 fail-closed，注释 sh:42 明写） |
| `subagent-acceptance-reminder` | **`.sh:14` 读 `agent_type` 失败回退 `subagent_type`；`.ps1:20` 只读 `agent_type`**（单边缺口）。去重键：`.sh` 用 python3 sha256，`.ps1` 用 .NET SHA256；`.sh:26` `tail -50 > tmp && mv`，`.ps1:37` 数组切片 |
| `tdd-gate` | `.ps1:23` 中文触发词写成 `\u7f16\u7801\u5b9e\u73b0`（Pinned 铁律）；`.ps1:19` git 调用套 try/catch |
| `three-file-sync-gate` | 分类逻辑等价（`.sh:44-64` case / `.ps1:57-74` 正则）；rename/copy 两段读取 `.sh:83-91` while-read-d '' vs `.ps1:94-107` 按 `` `0 `` split |
| `lib-fast-mode` | `.sh:20` **先 `tr -d '\r'` 再 sed**（CRLF 兼容，#38）；`.ps1:17` `Select-String '^expires_epoch=(\d+)$'`（.NET 正则 `$` 本就容忍 `\r`） |
| `lib-gate-log` | `.sh:11` 取首行用 `sed -n '1p'`；`.ps1:13` 用 `-split "\`r?\`n"` 取 [0] |
| `lib-harness` | `.ps1:30-46` `Invoke-Harness` 必须局部把 `EAP` 降为 `Continue` + stderr 重定向到临时文件（注释明写 5.1 会把 native stderr 变终止错误吞掉 stdout JSON）；`.sh:28` 直接 `node ... "$@"`。**`.ps1` node 缺失时返回 `$null`**，`.sh` 是 `harness_node_ok` 返回非 0 |

---

# B. 三个 lib + fast-mode 开关文件格式

### `lib-fast-mode.sh` / `.ps1`
| | `.sh` | `.ps1` |
|---|---|---|
| 导出 | `fast_mode_flag()` → 打印 `$CLAUDE_PROJECT_DIR/.claude/.fast-mode`，缺环境变量 return 1；`fast_mode_active()` → rc 0=放行 | `Get-FastModeFlagPath` → 路径或 `$null`；`Test-FastModeActive` → `$true/$false` |
| 副作用 | 无 | 无（整体包 try/catch，`.ps1:19`） |
| 读文件 | `.claude/.fast-mode` | 同 |
| 判定 | `tr -d '\r'` → `sed -n 's/^expires_epoch=\([0-9]\{1,\}\)$/\1/p' \| head -1` → `[ "$exp" -gt "$(date +%s)" ]` | `Select-String '^expires_epoch=(\d+)$'` → `[int64] > [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()` |
| 缺文件/缺行/非数字/过期 | 一律 fail-closed（严格模式） | 同 |
| 调用方式 | 各 hook 前 4 行：`_FM_LIB="$(dirname "$0")/lib-fast-mode.sh"; [ -f ... ] && . ... && fast_mode_active && exit 0` | `try { . (Join-Path $PSScriptRoot 'lib-fast-mode.ps1'); if (Test-FastModeActive) { exit 0 } } catch {}` |

### `lib-gate-log.sh` / `.ps1`
- 导出 `gate_log <hook> <reason>` / `Write-GateLog -Hook -Reason`。
- 副作用：`mkdir -p $CLAUDE_PROJECT_DIR/.claude/evidence` → **追加**一行 `<ISO8601Z>\t<hook>\t<reason 首行>` 到 `gate-block.log`。
- 失败一律吞（`.sh:10,12,14,15` 每步 `|| return 0`；`.ps1:10` 整体 try/catch）——**绝不改变调用方的判决**。
- 消费方：`.claude/scripts/gate-audit.sh:22`（find 全仓 gate-block.log）、`test-ps1-behavior.ps1:244`（A3 断言 stop-gate 写了账本）。

### `lib-harness.sh` / `.ps1`
| 函数 | 签名 / 返回 | 副作用 |
|---|---|---|
| `harness_catalog` / `Get-HarnessCatalogPath` | 打印 `$CLAUDE_PROJECT_DIR/.claude/harness/module-catalog.json` | 无 |
| `harness_enabled` / `Test-HarnessEnabled` | catalog 存在 → 0/`$true` | 无（**这是全部 harness 能力的唯一开关**） |
| `harness_node` / `Get-HarnessNode` | `command -v node` / `(Get-Command node).Source` | 无 |
| `harness_node_ok` | rc 0/非 0 | 无 |
| `harness_run <args…>` / `Invoke-Harness -HarnessArgs` | `.sh` 直接透传 rc + stdout；`.ps1` 返回 `[pscustomobject]@{Out;Code;Err}`，**node 缺失返回 `$null`** | `.ps1` 建/删临时 stderr 文件（`lib-harness.ps1:39,44`，`Remove-Item … -Force`） |
| `harness_rc_in_contract <rc> <c…>` / `Test-HarnessRcInContract` | 契约内 0/`$true` | 无 |
| `harness_err_head <text>` / `Get-HarnessErrHead` | 去空行 → 前 3 行 → 拼一行 → 截 400 字符 | 无 |
- 契约表引用：`.claude/rules/harness-large-repo.md` 退出码契约段（`lib-harness.sh:33`、`lib-harness.ps1:54` 都指过去）。

### `.claude/scripts/fast-mode.sh` / `.ps1` 写 `.fast-mode` 的格式
```
enabled_epoch=<unix秒>
expires_epoch=<unix秒>
hours=<正整数>
```
- 路径解析：`fast-mode.sh:8` `cd "$(dirname "$0")/../.."`；`fast-mode.ps1:12` `Resolve-Path (Join-Path $PSScriptRoot '../..')`。
- 时间戳：`.sh:36` `date +%s`（本地 epoch）；`.ps1:33` `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()`。
- **CRLF 处理（#38 修复）**：`fast-mode.ps1:38-39` 显式 `"…`n…"` + `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`——**必须写 LF、必须无 BOM**，注释明写「Set-Content 在 Windows 写 CRLF，sed 的 `$` 不跨 `\r`，会导致引擎判开、bash hook 判关」。读侧三处：`lib-fast-mode.sh:20`、`fast-mode.sh:17` 都 `tr -d '\r'`；引擎侧 `quality.mjs:565`、`memory.mjs:246` 都 `raw.replace(/\r\n/g,'\n')`。
- `on` 默认 24h（`.sh:10` / `.ps1:8`）；非法 hours → **exit 2**（`.sh:34` / `.ps1:28-31`，`test-fast-mode.sh:63-67` 断言 `abc/0/-1/1.5` 全 rc 2）。
- `off` = 删文件（`.ps1:43` `Remove-Item -LiteralPath $flag -Force`）。

---

# C. 所有引用 hook 文件名 / `.sh`·`.ps1` 形态的地方

### C1. `.claude/settings.json`
21 条 `command`，全部形态 `"$CLAUDE_PROJECT_DIR"/.claude/hooks/<name>.sh`，行号：`38, 50, 61, 66, 71, 83, 88, 93, 98, 103, 113, 125, 135, 140`（+ record-authorship / precompact / postcompact / notify / stop-gate ×2 / subagent）。statusLine 在 `settings.json:29`：`"$CLAUDE_PROJECT_DIR"/.claude/scripts/statusline.sh`。

### C2. `setup.ps1`（**改写规则原文**）
```
setup.ps1:303  # 3. Rewrite each hook command: .sh -> <pwsh> -Command "& \"\$env:CLAUDE_PROJECT_DIR\.claude\hooks\<name>.ps1\""
setup.ps1:308  $pwsh7Path = 'C:\Program Files\PowerShell\7\pwsh.exe'
setup.ps1:309-315  解释器探测：pwsh7 绝对路径（引号+正斜杠）→ Get-Command pwsh → 回退 powershell.exe
setup.ps1:317-326  function Convert-ToPs1Command([string]$cmd) {
setup.ps1:318      if ($cmd -match '[/\\]\.claude[/\\]hooks[/\\]([A-Za-z0-9_-]+)\.sh') {
setup.ps1:320        return $hookInterp + ' -NoProfile -ExecutionPolicy Bypass -Command "& \"\$env:CLAUDE_PROJECT_DIR\.claude\hooks\' + $name + '.ps1\""'
setup.ps1:322      if ($cmd -match '[/\\]\.claude[/\\]scripts[/\\]statusline\.sh') {
setup.ps1:323        return $hookInterp + ' … \.claude\scripts\statusline.ps1\""'
setup.ps1:328-336  遍历 $src.hooks 各 event/group/hook：$h.command = Convert-ToPs1Command;  if timeout 存在 → 强制改 30
setup.ps1:337-340  statusLine.command 同一改写
```
其余相关点：
- `setup.ps1:6` 文件头注释复述同一改写规则。
- `setup.ps1:238-242` `$skip` / `$skipAnyDepth` 排除表（**四份手工同步表之一**，含 `.fast-mode` `.stop-gate-strikes` `.precompact-block-epoch` `.async-verify-last` `.subagent-reminded` `.needs-review(.lock)`）。
- `setup.ps1:362-383` `Test-IsShResidue` + `Remove-ShResidue`：判据「含 `.claude/hooks/<name>.sh` **且不含** powershell/pwsh **且不含** `$env`/`-Command`」。
- `setup.ps1:455-457` 收尾计数 `$hooksCount = (Get-ChildItem hooks -Filter *.ps1).Count`，打印 `installed: ps1_hooks=$hooksCount`（**`test-installer-parity.ps1:214` 断言这行文本**）。

### C3. `setup.sh`
- `setup.sh:295` `case "$rel" in hooks/*.sh) mode=0755 ;;`（**唯一给执行位的地方**）。
- `setup.sh:266-291` copy_claude_tree 排除表（四份之一）。
- `setup.sh:340-372` 无 jq→降级；有 jq→`jq -s` 合并：`setup.sh:346-348` `def is_ps1_residue:` 判据「command 同时匹配 `powershell|pwsh` **与** `\.claude[/\\]hooks[/\\][A-Za-z0-9_-]+\.ps1`」；`:370` target 无 statusLine 才采纳。
- `setup.sh:400-411` Windows 平台 `exec pwsh -File setup.ps1`。
- `setup.sh:470` `hooks_count=$(find .../hooks -name '*.sh' | wc -l)`；`:479` 打印 `installed: hooks=%s`（**`test-installer-parity.ps1:210` 断言 `installed: hooks=`**）。
- `setup.sh:473-477` 装完自动跑 `fix-platform.sh`。
- `setup.sh:480-481` 收尾文案「加载 hooks（.sh，需 Git Bash 环境）」「Windows 纯 PowerShell 环境改用 setup.ps1」。

### C4. `.claude/scripts/fix-platform.sh` / `.ps1`
- `fix-platform.sh:37-39` 逻辑注释；`:50-52` 三条正则 `PS1_RESIDUE_RE` / `PS1_HOOK_RE` / `SH_HOOK_RE`；`:55` `SH_FORM = '"$CLAUDE_PROJECT_DIR"/.claude/hooks/'`；`:60-100` 删 `.ps1` 残留并补 `.sh`；`:103-110` statusLine 归一为 `statusline.sh`；`:122-130` **`chmod 0755` 全部 `hooks/*.sh` 与 `scripts/*.sh`**（`find -maxdepth 1 -name '*.sh'`）。
- `fix-platform.ps1:20-30` 解释器探测（移植自 setup.ps1:113-121）；`:34-40` `Convert-ToPs1Command`（移植 setup.ps1:122-128）；`:45-51` `Test-IsShResidue`（移植 setup.ps1:164-170）；`:54-57` `Get-HookName`；`:102` 「if timeout exists, normalize to 30」；`:112-121` statusLine 归一为 `statusline.ps1`；`:124` 写回前 `Copy-Item $settings "$settings.bak"`。

### C5. `.claude/scripts/doctor.sh`
- `:53-58` 遍历 **`.claude/hooks/*.sh`** 逐个判 `-x` 执行位（`hook 可执行 / hook 缺可执行位`）。
- `:61-62` 硬点名 `lib-harness.sh` **和** `lib-harness.ps1` 必须都存在，缺任一即 `bad`。
- `:91-93` `for s in doctor.sh plan-lint.sh skill-description-lint.sh`。

### C6. `.claude/scripts/gen-manifest.sh`
- `:36-60` 排除表（四份之一）；hooks 目录**不在排除表**——所有 `hooks/*` 都进清单。
- `:9-12` 注释点名另三份表：`setup.sh copy_claude_tree` / `setup.ps1 $skip+正则` / `harness/lib/release.mjs MANIFEST_RULES`。
- 第四份：`.claude/harness/lib/release.mjs:296-330` `MANIFEST_RULES`（35 条 pattern）。
- 第五、六处同源：`core.mjs:233-245` `STATE_EXCLUDE` / `:246-260` `STATE_EXCLUDE_PATHS`+`STATE_EXCLUDE_PREFIXES`。
- 另有 `static-check.sh:15-17` `PRUNE` 与 `:64-66` `JS_PRUNE` 两张表（`agent-memory/code-reviewer/pattern_installer-and-selfcheck-attacks.md:31,35` 记「实际七处」）。

### C7. `.claude/scripts/gate-audit.sh`（**最隐蔽的一处**）
```
gate-audit.sh:27-29
registered=()
while IFS= read -r f; do registered+=("$(basename "$f" .sh)"); done \
  < <(grep -lE 'lib-gate-log' "$scan_root/.claude/hooks/"*.sh 2>/dev/null | sort -u)
```
闸的注册清单是**从 `hooks/*.sh` 里 grep `lib-gate-log` 现算的**。改 `.mjs` 后这行匹配 0 个文件 → 「零记录死闸」段永远为空。

### C8. `.claude/tests/` 逐文件

| 测试文件 | 断言什么 | 怎么调 hook |
|---|---|---|
| `test-hook-parity.sh` | ① `tdd-gate.ps1` 中文触发词有输出、非触发无输出；② `mark-review-needed.ps1` Mutex 路径 exit 0；③ **静态 grep** `session-rules-banner.ps1` 含 `pwsh`+`fast-mode.ps1`、不含 `bash fast-mode.sh`（`:34-43`）。无 pwsh → ①② SKIP | `printf '{"tool_input":{...}}' \| pwsh -NoProfile -File "$HOOKS/tdd-gate.ps1"`（`:65-67, 97-99`）；`HOOKS="$ROOT/.claude/hooks"`（`:14`） |
| `test-hook-failopen.sh` | 28 条红锁：引擎契约外退出码时 `stop-gate` 必 `decision:block` 且**保留 `.needs-review`**（S1-S4）、诊断带实际退出码（S7/S8）、rc4 与契约外文案不同（S9）、三振熔断不砖机（S10/S11）、rc 0/3 照常放行（S12）；`pre-commit-check` 契约外 → exit 2（P1-P5），rc 0/3 → 0，rc2 → 2 | `bash "$STOP_GATE"`（`:114`，无 stdin）；`echo '{"tool_input":{"command":"git commit -m t"}}' \| bash "$PRECOMMIT"`（`:121-122`）。路径常量 `:33-34`。`:373-378` 显式 SKIP `.ps1` 侧 |
| `test-ps1-behavior.ps1` | 468 行 28 条。组 0：**全仓 `*.ps1` 必须纯 ASCII**（`:211-224`）；A：stop-gate 拦/放、点名待审文件、**写 gate-block.log**（`:234-255`）；B：引擎不可用必拦、保留 `.needs-review`、exit 7/9 诊断各带自己的码（`:264-305`）；C：pre-commit-check 干净仓静默过、门跑不成 exit 2（`:324-345`）；D：tdd-gate 中文触发 + `.tdd-exempt` 静默（`:364-372`）；E：mark-review-needed 源码入表、`.md`/`.claude/hooks/x.ps1` 不入表（`:382-402`）；F：fast-mode.ps1 on/status/off + banner 播报/静默（`:412-444`） | `Invoke-Script`（`:88`）独立进程跑，stdin/stdout/stderr 落文件。退出码：0 全过 / 1 有红 / **3 有整组没跑成**（`:459-467`） |
| `test-fix-platform.sh` | ① `fix-platform.sh`：`.ps1` 残留清空、`.sh` 齐全、**`hooks/*.sh` 全带执行位**、幂等；② `fix-platform.ps1` 对称路径 | fixture settings.json 由 python3 生成，`sh_cmd='"$CLAUDE_PROJECT_DIR"/.claude/hooks/tdd-gate.sh'`、`ps1_cmd='pwsh -File .claude/hooks/tdd-gate.ps1'`（`:31-32`）；造真文件 `$CL/hooks/tdd-gate.sh`、`pre-commit-check.sh` 并先 `chmod -x`（`:87-89`） |
| `test-setup.sh` | ① 关键文件装齐（`:36-37` 硬点名 `hooks/lib-harness.sh` **与** `.ps1`；`:52-58` **`hooks/*.sh` 装齐且带可执行位**，`hook_count > 0`）；②私有 feedback 排除；③幂等；③b 无 jq 路径；④ MANIFEST 分层；⑤运行态隔离；**⑥ 四份排除表逐臂对照（含臂序与 drop/keep）+ 抽取条数写死自检（`:262-263`）**；⑦-⑩ dry-run/锁/marker/路径边界 | 直接 `bash setup.sh` 装到 mktemp |
| `test-installer-parity.ps1` | 真跑两个安装器装到两个临时目录逐文件 diff：`installed: hooks=` 与 `installed: ps1_hooks=` 各自 rc 0（`:210,214`）、两侧列表 ≥100（`:223`）、`onlySh`/`onlyPs` 均为 0（`:232,236`）、planted fixture（`skills/_probe/settings.json` 等根锚定名下沉一层必须都装、`.DS_Store`/`signals.jsonl`/`Thumbs.db` 都不许装）、第二组 dry-run/marker/保留段扰动点用 **`hooks/notify.ps1`**（`:275,279`） | pwsh 直跑；rc 0/1/3 |
| `test-static-check.sh` | `static-check` 必须认 `.mjs/.cjs/.js`（`node --check` 逐个校验、点名 文件:行）、全对 rc 0 且输出含 `node --check`、node_modules 不算 | `bash "$CHECK" "$1"`，`CHECK=${1:-"$SRC/hooks/static-check.sh"}`（`:21,48`）。`:135-138` 显式 NOTE：`.ps1` 侧无人守 |
| `test-fast-mode.sh` | ①-⑤ 开关文件与 status/exit 2；⑥ 抽 `tdd-gate.sh`：有效 flag 静默放行、过期/坏 flag 走严格；⑦ **lib 缺失 → fail-closed 且不崩** | **把 `hooks/tdd-gate.sh` + `hooks/lib-fast-mode.sh` 拷进临时项目根**（`:26-27`），`printf '{"tool_input":{"command":"claude agent implementer write code"}}' \| bash "$ROOT/.claude/hooks/tdd-gate.sh"`（`:72-73`）；`:101,109` mv 走/放回 lib |
| `test-three-file-sync-gate.sh` | 家底 `.claude/**` 改动未同步 progress.md 必拦；`.claude/evidence/` 不拦 | `HOOK=…/hooks/three-file-sync-gate.sh`（`:13`），**`[ -x "$HOOK" ]` 硬要求执行位**（`:14`） |
| `test-gate-audit.sh` | 「零记录死闸」段不许出现信息类 hook | `:29-33` 遍历 `hooks/*.sh`，`basename .sh`，**`grep -qE "${base}\.(sh\|ps1)" settings.json` 双栖探测**，`grep -q 'gate_log'` 判是否真闸 |
| `test-release-manifest.sh` | manifest 生成/审计两侧一致 | 造真文件 `hooks/demo.sh`（`:45,379,457`）、`hooks/orphan.sh`（`:191-197`）、`hooks/probe.sh`、`hooks/untracked-probe.sh`、`hooks/staged-probe.sh`、`hooks/wt-probe.sh`、`worktrees/agent-x/.claude/hooks/notify.sh`（`:508`）；`:123` `hooks/demo.sh.swp\|*.swp` |
| `cases/run-all.sh` | 三段编排 | `:41` 第二段列表：`test-setup.sh test-routing.sh test-fix-platform.sh test-hook-parity.sh test-gate-audit.sh test-three-file-sync-gate.sh test-fast-mode.sh test-supervisor.sh`；`:86-87` 有 node 才跑 `test-hook-failopen.sh`；`:191` `test-doctor.sh test-scan-secrets-userinfo.sh test-static-check.sh test-release-binding.sh test-golden-mutate.sh`；`:206-214` 有 pwsh 才跑 `test-ps1-behavior.ps1`；`:18-19` `export PYTHONIOENCODING/PYTHONUTF8` |
| `test-doctor.sh` | 无 hook 引用（grep 0 命中） | — |

### C9. `.github/workflows/gate.yml` —— `ps1 (windows)` job 原文（`:263-344`）
```yaml
  ps1:
    # 单独一格，三层：解析 + 真跑 hook + 真跑安装器。      (:264-271 注释)
    name: ps1 (windows)                                    (:272)
    runs-on: windows-latest                                (:273)
    defaults: { run: { shell: pwsh } }                     (:274-276)
    steps:
      - uses: actions/checkout@v4                          (:278)
      - uses: actions/setup-node@v4  with node-version: 22 (:282-284)
      - name: Parse every .ps1 with the PowerShell parser  (:286-306)
          Get-ChildItem -Recurse -Filter *.ps1 (排除 node_modules/.git)
          files.Count -eq 0 → ::error:: 判失败
          [Parser]::ParseFile 逐个，$bad>0 → exit 1
      - name: Behaviour test -- 真跑 .ps1 hook，断言退出码与副作用  (:312-324)
          & pwsh -NoProfile -File .claude/tests/test-ps1-behavior.ps1
          rc 0 过；rc 3 判失败（"没跑成不是通过"）；其余判失败
      - name: Installer parity -- setup.ps1 与 setup.sh 装出来的清单必须逐文件一致 (:332-344)
          & pwsh -NoProfile -File .claude/tests/test-installer-parity.ps1
          rc 0 过；rc 3 判失败；其余判失败
```
`gate` job 侧同样相关：`:8-10` 注释「26 个 `.ps1` 至今没在真机跑过」；`:85-104` check-syntax **Windows 上 rc 3 也判失败**（「pwsh 一定在，.ps1 必须真验成」）；`:164-172` 注释说明 Windows 格不跑 `.sh` run-all 的理由（「双形态分发，Windows 用户手上根本没有 .sh hook」）。

### C10. 文档
| 位置 | 原文要点 |
|---|---|
| **`.claude/hooks/README.md`** | **不存在**（该目录下只有脚本 + `feedback-signals.txt`）。目录说明在 `ARCHITECTURE.md:143-169` |
| `ARCHITECTURE.md:145` | 「settings.json 实际注册 19 个 hook（每个均 `.sh` + `.ps1` 双平台）」+ `:146-168` 逐 hook 表（表内文件名全写 `.sh`） |
| `ARCHITECTURE.md:169` | 「`hooks/static-check.sh` **不是注册 hook**，是 code-review Stage 0 静态闸主动调用的工具」 |
| `ARCHITECTURE.md:173` | statusLine「`.claude/scripts/statusline.sh\|.ps1`」 |
| `ARCHITECTURE.md:201` | 目录树「hooks/ # 19 个注册闸门 + static-check 工具」 |
| `README.md:93-103` | **`## .sh / .ps1 双写机制`** 整节；`:95`「每个 hook 同时提供 `.sh` 和 `.ps1` 两份等价实现……相同输入 → 相同 exit code（0=放行 / 2=拦截）」；`:100` 给出改写后的 command 原文；`:103` 解释器优先 pwsh 7 的理由 + Git Bash bug #22700 |
| `README.md:105-122` | fix-platform 整节（`:107` 平台绑定、`:109` 归一 + chmod、`:117` `pwsh -File .claude/scripts/fix-platform.ps1`、`:120` 「`.sh` 用 python3，`.ps1` 用 pwsh 内置」、`:122` 重跑 setup 也行） |
| `README.md:31` | hooks/ 目录说明列举各闸 |
| `README.md:88` | statusLine `.sh\|.ps1` |
| `README.md:126-131` | 三层强制层表（`.claude/hooks/` 只在会话内生效） |
| `README.md:147` | 「CI 那格是唯一能真验 **26 个 `.ps1`** 的地方」 |
| `.claude/rules/file-structure.md:20` | 目录树「hooks/ # 闸门钩子（…），**.sh + .ps1 成对**」 |
| `.claude/rules/harness-large-repo.md:10` | 「hook 通过 `lib-harness.sh\|.ps1` 的 `harness_node_ok` 守卫跳过」 |
| `.claude/rules/harness-large-repo.md:81` | record-authorship 接线段：「`record-authorship.sh\|.ps1`（PostToolUse，matcher `Edit\|Write\|NotebookEdit`）」 |
| `.claude/rules/harness-large-repo.md:82` | 「`PostCompact` 钩子（`.claude/hooks/postcompact-reinject.sh\|.ps1`）」 |
| `.claude/rules/harness-large-repo.md:169-173` | 守卫库 + 四处接线，**含带行号的定位**：`stop-gate.sh:32-50 / stop-gate.ps1 对应段`、`pre-commit-check.sh:61-74 / .ps1 对应段`、`harness-async-verify.sh\|.ps1`、`record-authorship.sh\|.ps1` |
| `.claude/rules/dev-workflow-details.md:127` | 「Stage 0 静态闸（static-check.sh 识栈跑 linter）」 |
| `.claude/CLAUDE.md:42` | 「Stop 阶段 `three-file-sync-gate.sh` 按工作树实际未提交改动兜底拦停」 |
| `.claude/CLAUDE.md:59` | 「`bash .claude/scripts/fast-mode.sh on [hours]\|off\|status`（Windows：`pwsh .claude/scripts/fast-mode.ps1` 同参）」 |
| `.claude/CLAUDE.md:66` | 「静态检查（`static-check.sh` 之类廉价闸）……不在跳过范围」 |
| `.claude/CLAUDE.md:268` | 「Stage 0 跑 `static-check.sh`，commit 侧 `pre-commit-check.sh` 按栈卡编译/语法，待审清单没清空 `stop-gate.sh` 不让停」 |
| `.claude/skills/code-review/SKILL.md:62` | 「执行： `bash .claude/hooks/static-check.sh .`」——**唯一的 static-check 实际调用点** |
| `.claude/githooks/README.md:33` | 「Windows 侧不需要 `.ps1` 版本的 hook：git 按文件名挑 hook」（githooks 层不受影响） |
| `.claude/githooks/README.md:114,116` | 「`check-syntax` 在没装 pwsh 的机器上恒 rc 3（26 个 `.ps1` 一整类压根没验）」 |
| `docs/v3-tiered-harness-proposal.md:110` | L4 原文，含「**动**：`setup.ps1:322-337` 的 `.sh→.ps1` 改写逻辑整段删除，`fix-platform` 大半失效，Pinned「.ps1 纯 ASCII」对 hook 不再适用」 |
| `docs/v3-tiered-harness-proposal.md:186` | ADR：「执法方式：`test-hook-parity` 改为断言 settings.json 无 `.sh`/`.ps1` 命令」 |
| `docs/v3-tiered-harness-proposal.md:111` | L5：「`install-githooks.ps1` / `statusline.ps1` 随 L4 消失；`statusline.ps1` 被 `setup.ps1:322` 按名改写」 |
| `.claude/harness/audit/check-syntax.mjs:4` | 「hooks are .sh/.ps1, the engine is .mjs」；`:228-231` 三类分流 `jsFiles`/`shFiles`/`ps1Files`；`:31` 「26 .ps1 files nobody parsed」 |

### C11. `FRAMEWORK-MANIFEST.txt`
- **`hooks/` 条目共 51 行**（22×2 + 3×2 + `feedback-signals.txt`）。
- `scripts/` 条目 14 行（含 `statusline.sh` + `statusline.ps1`、`fast-mode` 两份、`fix-platform` 两份、`install-githooks` 两份、`supervisor.mjs`）。
- 全清单 **241 行**（不含 4 行 `#` 头）。改 `.mjs` 后 hooks 条目 22+3+1 = **26 行**，全清单 −25，`scripts/` 若删 `statusline.ps1` 再 −1。

---

# D. Pinned 里与 `.ps1` 相关的条目（`progress.md:6-18`）

| 行 | 条目 | hook 改 `.mjs` 后 |
|---|---|---|
| `:7` | **`.ps1` hooks 纯 ASCII**（5.1 按 GBK 读无 BOM UTF-8，含中文即解析崩） | **对 hook 不再适用**；仍适用于 `setup.ps1` / `fix-platform.ps1` / `install-githooks.ps1` / `fast-mode.ps1` / `statusline.ps1`(若留) / `test-ps1-behavior.ps1` / `test-installer-parity.ps1`。用户 2026-09-05 拍板（`progress.md:81`）：**理由从「5.1 会崩」改为「兼容性面会变」，铁律不放开**，`#requires -Version 7.0` 仍拒绝 |
| `:8` | hook 命令用 `\$env:CLAUDE_PROJECT_DIR` 转义形式（Git Bash 外层会吞裸 `$env`） | **只对 `.ps1` 形态 command 适用**；改 `node .claude/hooks/x.mjs` 后这条对 hook 失效，但 `setup.ps1` 若还改写 statusline 就仍适用 |
| `:13` | **5.1 下 native 命令 stderr → ErrorRecord，`EAP='Stop'` 提升为终止错误**；修法用 `2>$null` / try-catch / 局部 `Continue`；`$PSNativeCommandUseErrorActionPreference` 是 7.3+ 无效 | **对 hook 不再适用**；仍适用于 `setup.ps1`、`fix-platform.ps1`、`static-check.ps1`(若留)、两个 `.ps1` 测试 |
| `:16` | **`.ps1` 补中文触发词须用 `\uXXXX`**（tdd-gate.ps1 的历史取舍） | **只对 hook 适用，随 hook 消失**（`.mjs` 里可直接写中文，但 `test-ps1-behavior.ps1` 组 0 的 ASCII 断言仍管着所有 `.ps1`） |
| `:18` | **`.ps1` 读 stdin 须先设 UTF-8 InputEncoding**（中文 Windows 默认 936） | **只对 hook 适用，随 hook 消失**（node 读 stdin 无此问题） |
| `:17` | **v2/v3 每 Phase 收口闸**：selftest 全绿 + `harness-golden.mjs --check` 零差异 + `run-all.sh` 全绿 + 该 Phase 新增测试，四项齐；15 个子命令的 stdout JSON 与退出码是**对外契约**（stop-gate / pre-commit-check / harness-async-verify 三个 hook 在消费），零行为回归；**每条新闸同批出一条反向验证** | **仍适用，且直接约束本次改造** |
| `:11` | 压缩边界两端都有闸，`postcompact-reinject.sh\|.ps1` 挂 PostCompact | **仍适用**（文件名要跟着改） |
| `:9` `:10` `:12` `:14` `:15` | 权限 bypassPermissions / 单模型审查承重墙 / 打 tag 先查远程 / 验收五步闸 / 禁表演式认同 | 与 `.ps1` 无关，全部仍适用 |

关联 TODO：`progress.md:240` `[P3][明确不做][#30]` pwsh 5.1 无机器可验，已按「用户不使用 5.1」合账，但**明确写着「注意不要连带放开纯 ASCII」**。

---

# E. 现有 node 侧可复用的东西

### E1. `.claude/harness/lib/core.mjs`（661 行，末尾统一 `export {}`）
| 能力 | 位置 | 可复用于 |
|---|---|---|
| `toPosixPath(p)` | `:119-121`（无条件 `\\`→`/`；`:113-118` 注释解释为何不按 `path.sep` 分支） | mark-review-needed / record-authorship 的路径归一 |
| `repoRelative(p)` | `:448-458`（先按拼写算 relative，逃逸则用 `resolveThroughLinks` 两侧再算，都逃逸才回显绝对路径；配 `escapesBase():411`、`resolveThroughLinks():388`） | **直接替掉 `.sh` 手工折 `.`/`..`（mark-review-needed.sh:42-66）与 `.ps1` 的 GetFullPath 那套**，含 symlink/8.3 两个坑 |
| `projectRoot()` / `catalogFilePath()` | `:368-371` | harness_enabled 等价物 |
| `isStateExcluded(p)` | `:261-265`，表在 `:246-260`（`STATE_EXCLUDE_PATHS` 3 条 + `STATE_EXCLUDE_PREFIXES` 8 条）；git pathspec 版 `STATE_EXCLUDE:233-245` | 判「这个改动算不算运行态」 |
| `readTextFile` / `readDirNames` | `:496-514`（**只有 ENOENT 算 absent，其余 I/O 错返回 error**——`progress.md:82` 的裁定） | 所有状态文件读；`.needs-review` / `.stop-gate-strikes` 读不出来时区分「没有」与「读不了」 |
| `recordCorruptState({kind,path,reason})` + `quarantineFilePath()` | `:535-565`（append-only 到 `.claude/harness/state/quarantine.jsonl`，**永不抛、永不改调用方答案、永不移动坏文件**） | hook 遇坏状态文件时留痕 |
| `withDirLock(lockPath, fn, {timeoutMs,staleMs,pollMs})` | `:168-198` | **直接替掉 `.sh` 的 flock 与 `.ps1` 的 Global Mutex 两套锁** |
| `git(args)` / `isGitRepo()` / `headCommit()` / `changedPaths()` / `splitNul()` / `canonicalDiff()` / `gitFingerprint()` | `:200-325` | three-file-sync-gate、precompact-gate 的 `git status --porcelain -z` 解析 |
| `emit(obj, code)` / `die(msg, code)` / `readStdin()` / `stableJson` / `sha256` | `:99-150` | hook 的 stdout JSON 输出与 stdin 读取 |
| `errDetail(e)` | `:524-529`（把本机绝对路径折成仓相对再入报告） | 诊断文案 |
| `whichCmd(exe)` | `:635-` （Windows 侧带 PATHEXT） | 替 `command -v` / `Get-Command` |

### E2. fast-mode 解析——**现状三处，形态各异**
| 处 | 位置 | 行为 |
|---|---|---|
| 引擎判定 | `quality.mjs:557-576` `fastModeActive()` | `readFileSync` → catch 一律 false → `raw.replace(/\r\n/g,'\n')` → `/^expires_epoch=(\d+)$/m` → 无匹配则 **`recordCorruptState({kind:'fast-mode'})`** 并 false → `Number*1000 > Date.now()` |
| 剩余时长 | `memory.mjs:239-250` `fastModeState()` | 调 `fastModeActive()` 再**自己重读一遍同一文件**算 `remainingHours`（注释明写「active:true 配 remainingHours:null 会是同一文件两个答案」） |
| bash 侧 | `lib-fast-mode.sh:20` + `fast-mode.sh:17` | `tr -d '\r'` + sed，**无 quarantine 留痕** |
消费方还有 `evidence.mjs:557,1143`、`quality.mjs:428-447,601`（安全类 check 无视 fast-mode）、`release.mjs:74` `import { fastModeState, pendingReviewCount }`。
`docs/v3-tiered-harness-proposal.md:97` 已把「三处解析点合并为一处」列为 L2 收益（−30 行）。
`pendingReviewCount()` 在 `memory.mjs:253-258`：`split(/\r?\n/)` → trim → 去空 → 去 `'clean'` → `.length`，**与 stop-gate / precompact-gate / release-gate / statusline 四处 shell 实现口径相同**，可直接复用。

### E3. `.claude/scripts/supervisor.mjs`（19224 字节，纯 node builtins）的写法
- `projectRoot():30` / `baseDir():33-35`（`.claude/.runtime/supervisor`）/ `idDir():36` / `safeId():39`
- `parseArgs(argv):44`、`num(v,dflt):249`
- `statePath():61` / `readStateResult():69` / `readState():76` / `writeState():80` —— **`readStateResult` 是「读不出来 ≠ 不存在」在脚本侧的既有实现范式**
- `pidAlive(pid):87` / `killTree(pid):109` / `probe(url,timeoutMs):124`
- `logPath():92` / `rotateIfLarge(file):95`（`LOG_MAX_BYTES = 5MB`，`:28`）/ `logLine():102`
- `rel(p):408` / `emit(obj):411` / `die(msg,code):414` / `usage():419`
> supervisor.mjs 与 core.mjs **不共享代码**（它显式不 import 引擎）——这是仓里已有的「脚本不依赖引擎」范式先例。

### E4. hook 对引擎的依赖面 & 失败降级（改 `.mjs` 后若 import 引擎 lib，这层要重算）
现状是 **进程级隔离，不是 import 级**：
| 依赖点 | 怎么调 | 引擎坏了怎么降级 |
|---|---|---|
| `lib-harness.sh:15-19` `harness_enabled` | 只 `[ -f module-catalog.json ]` | 无 catalog → 整个 harness 分支跳过，**零行为变化**（本仓默认无 catalog，所以四个接线 hook 现在全都不走引擎） |
| `lib-harness.sh:22-25` `harness_node_ok` | `command -v node` | node 不在 → `harness-async-verify.sh:23` / `record-authorship.sh:27` / `pre-commit-check.sh:65` / `stop-gate.sh:41` **全部静默跳过**（`progress.md:103` 明确「保留不动，node 缺失静默降级是有意设计」） |
| `lib-harness.sh:28` `harness_run` | `node harness.mjs <sub>` 起**独立进程**，只看 rc + stdout | 引擎抛异常 → node 给契约外 rc → `harness_rc_in_contract` 判出 → **stop-gate/pre-commit-check 拦并点名实际码，harness-async-verify 发诊断，record-authorship 只写一行 stderr** |
| `postcompact-reinject.sh:35-43` | 不经 lib，直接 `command -v node` + `[ -f "$HARNESS" ]` + `node "$HARNESS" invariants`，契约 `{0,3}` | 三种 degrade 文案（`:26,28,30`），**固定常量串**——注释 `:21-22` 明写「此路径上 node 可能根本不在，没法拿它拼 JSON」 |
| `record-authorship.sh:73-79` | `timeout 10 node …`（无 timeout 命令则裸跑） | rc≠0 → 一行 stderr，**恒 exit 0** |
> 关键事实：**今天 22 个 hook 里没有一个 import 引擎代码**，最强的耦合也只是「起一个 node 子进程、读它的退出码」。`lib-harness.sh:6` 注释把这条写成了设计意图：「找不到 node 时返回非 0（可判定的降级信号，非 crash、非假绿）……绝不 block 小项目」。改 `.mjs` 后若直接 `import { repoRelative } from '../harness/lib/core.mjs'`，`.claude/harness/lib/` 缺失（`test-hook-failopen.sh:89-92` 造的正是这个故障形态：只搬 `harness.mjs`、删 `lib/`）会让 **hook 本身起不来**，而不再是「hook 起来了、判定引擎跑不成」——这正是 `test-hook-failopen.sh` 与 `test-ps1-behavior.ps1` B 组现在区分的两件事。

---

# 改写时最容易漏的 10 处（只列事实）

1. **`stop-gate.ps1` 六处 `Remove-Item` 必须 `-Force`**（`progress.md:45`、`:208` commit `81c63c9`）：PowerShell 在 Unix 侧把前导点映射成 Hidden，不加 `-Force` 拒删且被 `-ErrorAction SilentlyContinue` 静默吞掉；后果不止残留——`.stop-gate-strikes` 删不掉 → **三振熔断计数在放行时不重置 → 同一清单再来一次立刻又撞上限提前放行，闸把自己关了**。仓里另四个删点文件的站点（`pre-commit-check.ps1` / `precompact-gate.ps1:99` / `fast-mode.ps1:43` / `lib-harness.ps1:44`）全都带了 `-Force`。`.mjs` 里对应的是 `fs.rmSync(p,{force:true})` 三个删点：`stop-gate.sh:90` 的 `.needs-review` + `.needs-review.lock` + `.stop-gate-strikes`，另加 `:27,108` 的 strike 文件、`precompact-gate.sh:86` 的 epoch 文件。
2. **`gate-audit.sh:27-29` 从 `hooks/*.sh` grep `lib-gate-log` 现算「注册闸清单」**——改 `.mjs` 后匹配 0 个，「(b) 零记录死闸」段恒空；`test-gate-audit.sh:29-33` 同样遍历 `hooks/*.sh` 并 `grep -qE "${base}\.(sh|ps1)" settings.json` 做双栖探测，两处都会静默失灵而不报错。
3. **`doctor.sh:53-58` 逐个判 `hooks/*.sh` 的执行位**、`:61-62` 硬点名 `lib-harness.sh` **和** `lib-harness.ps1` 二者必须都在——后者缺一即 `bad`，doctor 会因为「删掉了 lib-harness.ps1」而红。
4. **执行位只在 `setup.sh:295`（`hooks/*.sh) mode=0755`）与 `fix-platform.sh:122-130` 两处发放**；`test-setup.sh:52-58`、`test-fix-platform.sh:106-114`、`test-three-file-sync-gate.sh:14`（`[ -x "$HOOK" ]`）三处断言执行位。`.mjs` 由 `node` 拉起不需要执行位，但这五处逻辑不改就会变成恒红或恒空转。
5. **`test-fast-mode.sh:26-27` 把 `tdd-gate.sh` + `lib-fast-mode.sh` 物理拷进临时项目根再跑**，`:101/:109` 靠 mv 走 lib 制造「lib 缺失 fail-closed」用例——依赖的是「hook 与 lib 同目录、相对 `dirname $0` dot-source」这个具体机制，`.mjs` 的 import 解析路径不同，这条红锁的造法要重写。
6. **`.fast-mode` 的 CRLF 三处解析点分叉是有案底的（#38，`progress.md:248`）**：`fast-mode.ps1:38-39` 之所以用 `[System.IO.File]::WriteAllText` 而不是 `Set-Content`，就是为了写 LF；引擎侧 `quality.mjs:565` / `memory.mjs:246` 与 bash 侧 `lib-fast-mode.sh:20` / `fast-mode.sh:17` 四处各有一套剥 `\r`。收成一处时若丢掉剥 `\r`，会复活「引擎判开、hook 判关」这个比两边都关更糟的状态。
7. **`mark-review-needed` 的路径归一是两套不同实现修同一个洞**（#49，`progress.md:25,255`）：`.sh:42-66` 手工折 `.`/`..`，`.ps1:38-41` 靠 `GetFullPath`（顺带展开 8.3 短名 `C:\Users\ABC123~1`，`.ps1:36-37` 注释）。同类归一在 `record-authorship.sh:59-62` 是**遇 `..` 直接不记**、`record-authorship.ps1:55-59` 是**折叠后再判**——两个 hook 的口径本身就不一致。`core.mjs:448` `repoRelative` 是现成的第三套。
8. **`.ps1` 侧的锁不产生 `.needs-review.lock` 文件**（`.sh` flock fd9 会创建，`.ps1` 用命名 Mutex 不会），而 `stop-gate.sh:90` / `stop-gate.ps1:80` 释放时都去删这个文件，`setup.sh:271` / `gen-manifest.sh:40` / `release.mjs:300-301` / `core.mjs:235,248` 四处排除表也都各列了 `.needs-review.lock` 一条。
9. **`subagent-acceptance-reminder.sh:14` 读 `agent_type` 失败会回退 `subagent_type`，`.ps1:20` 只读 `agent_type`**；`detect-feedback-signal.ps1:19-22` 的触发词在 sidecar `hooks/feedback-signals.txt` 里而 `.sh:23` 是内联；`check-evolution` 两侧 TOTAL 计数口径不同（`.sh:20` vs `.ps1:17`）。这三处是「两份实现本来就不等价」，不是照抄哪一份就完事——`docs/v3-tiered-harness-proposal.md:24` 引 dsh 台账记「cc 的 ps1 曾 16/34 臂不等价、静默装漏」。
10. **`test-ps1-behavior.ps1` 组 0（`:211-224`）是「`.ps1` 必须纯 ASCII」这条 Pinned 的**唯一**机器闸**（`progress.md:46` 记「此前只靠自觉」），它扫的是**全仓 `*.ps1`**；`gate.yml:286-306` 的 Parser 步同样是「全仓 `*.ps1`，`files.Count -eq 0` → 判失败」。hook 全改 `.mjs` 后仓里仍有 7 个 `.ps1`（`setup.ps1` / `fix-platform.ps1` / `install-githooks.ps1` / `fast-mode.ps1` / `statusline.ps1` / 两个测试），Parser 那步不会空转；但若连 `statusline.ps1` 也删，要重新核对 `test-installer-parity.ps1:275` 用 `hooks/notify.ps1` 当扰动点、`test-hook-parity.sh:30` 用 `session-rules-banner.ps1` 当静态 grep 对象这两个具体文件名。
