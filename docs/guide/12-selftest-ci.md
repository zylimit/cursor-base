# 12 框架自测与 CI

这章解决的问题：改了框架本身（hook / harness / 脚本 / 安装器）之后，怎么知道没改坏——本地跑什么、git 提交路径上跑什么、CI 跑什么，三层各管什么、为什么本地绿不等于 CI 绿。读完你能按风险跑对那一批用例、读懂三个 git hook 的退出码、看懂 CI 五格的分工、知道什么时候该重跑 `gen-manifest.sh`。

## 入门：三层强制层

| 层 | 位置 | 管到哪 | 管不到哪 |
|---|---|---|---|
| Claude Code hook | `.claude/hooks/` | 会话内每一次工具调用 | 会话外的一切 |
| git hook | `.claude/githooks/` | 凡是走 git 的提交与推送路径 | 没装这层的机器；`--no-verify` |
| CI | `.github/workflows/gate.yml` | 所有人、所有分支、所有机器 | 没推上去的东西 |

（`.claude/githooks/README.md`「三层分工」表。）三层互补，谁都不替代谁。这章讲后两层，加上把它们串起来的本地自测入口 `run-all.sh`。

## 入门：run-all 三段式

```bash
bash .claude/tests/cases/run-all.sh                 # 默认 --level high
bash .claude/tests/cases/run-all.sh --level medium  # high + medium
bash .claude/tests/cases/run-all.sh --level all     # 全跑，CI 走这个
bash .claude/tests/cases/run-all.sh --help
```

你会看到：

```
用法：run-all.sh [--level high|medium|all]
```

三段（`run-all.sh` 头注释与正文）：

| 段 | 内容 | 前提 | 失败即停 |
|---|---|---|---|
| [1/3] selftest | `.claude/tests/selftest.sh`，用 `fixtures/` 里手造的 stream-json 跑断言库本身 | 无 | 是——断言库不可信，后面全不算数 |
| [2/3] 静态自测 | `test-setup` / `test-routing` / `test-fix-platform` / `test-hook-parity` / `test-gate-audit` / `test-three-file-sync-gate` / `test-fast-mode` / `test-supervisor`，然后 `cases/test-harness.sh`、audit 两套、前期闸四套、hook 行为与注册面七套、证据层红锁、`test-githooks`、`dod`、`release` 结构断言、`test-release-manifest`、`test-doctor` / `test-scan-secrets-userinfo` / `test-static-check` / `test-release-binding`，最后 `test-ps1-behavior.ps1`（有 pwsh 才跑） | 大多数只需 node + git | 是 |
| [3/3] 真触发 cases | `cases/*.sh` 拉真 `claude -p`，耗 token | `CCBASE_RUN_CLAUDE_CASES=1` 且有 claude CLI | 默认**不跑**，汇总行明写 `SKIPPED: 真触发 case 默认不跑` |

`dod` 断 rc 0；`release` 不断 rc 0（工作树脏 / fast 档 / CI 红都会让它正确地判「未就绪」），只断「引擎跑出了结构完整的清单」：八个装配项齐、状态在 PASS / FAIL / DEGRADED 内、每条 blocker 带 `nextStep`。引擎崩了也给 rc 1 但吐不出 JSON，结构断言把两者分开。

每种跳过都在最后一行汇总里点名（`AUDIT_NOTE` / `HOOKS_NOTE` / `PS1_NOTE` / `LEVEL_NOTE` …）——未执行 != 通过。

Windows：`run-all.sh` 在 Git Bash 下能跑第一、二段，但 CI 的 Windows 格故意不跑它（见下文），本机 Windows 上以 `bash .claude/tests/test-hooks-node.sh` 与 `pwsh -NoProfile -File .claude/tests/test-ps1-behavior.ps1` 为准。

## 入门：`# risk:` 头行与分级

每个测试脚本头部十行内写一行：

```bash
#!/usr/bin/env bash
# risk: low
# test-hooks-node.sh — 提醒类 hook 的存活回归……
```

`run-all.sh` 的 `risk_of()` 用 `sed -n '1,10p' | grep -m1 -E '^# risk: *(high|medium|low)'` 取级；没打级的按 high 跑——宁可多跑，不许悄悄少跑。`--level` 与级别的关系：

| `--level` | 跑 |
|---|---|
| `high`（默认） | 只跑 high 与未打级的 |
| `medium` | high + medium |
| `all` | 全部 |

被跳过的按级别计数进汇总行：`跳过 N 套 medium / M 套 low 用例（--level high，未执行 != 通过）`。

分级的取舍写在各脚本头注释里，如 `test-hooks-node.sh`：地板闸（secret-exfil-guard / dangerous-pkill-guard）的用例全份在 `test-hooks-floor.sh` 一条不减；留在提醒类文件里的每个 hook 只保一条主路径。

## 进阶：test-ledger 与 test-age

每次 `run-all.sh` 把各套的 `[PASS]` / `[FAIL]` / `[SKIPPED]` 逐条追加进 `.claude/evidence/test-ledger.jsonl`，一条一行：

```json
{"t":"2026-09-10T03:43:42Z","file":"test-setup.sh","case":"⑦-1 --dry-run 是被识别的开关、正常退出","result":"PASS"}
```

字段固定四个：`t`（UTC）/ `file` / `case`（截到 80 字符）/ `result`。没有逐条标记的套件（selftest / dod）按整套记一行 `"case":"<整套>"`。`.claude/evidence/` 在根 `.gitignore` 里，是本机流水不入库。同目录另一份 `gate-block.log` 是 hook 拦停账本，格式 `<ISO UTC>\t<hook>\t<reason 首行>`，由 `.claude/hooks/lib/gatelog.mjs` 写、`bash .claude/scripts/gate-audit.sh` 读。

```bash
node .claude/scripts/test-age.mjs               # 默认 --min-runs 20
node .claude/scripts/test-age.mjs --min-runs 30
```

你会看到（本仓，头几行）：

```
账本 /home/z00632348/code/cc-base/.claude/evidence/test-ledger.jsonl
用例 468 条，退休门槛 --min-runs 20（地板文件不列入：test-scan-secrets-userinfo.sh / test-setup.sh / test-hooks-floor.sh）

file                          runs  firstSeen             case
test-audit-scripts.sh         48    2026-09-10T03:44:10Z  干净仓 exit 0
test-audit-scripts.sh         48    2026-09-10T03:44:10Z  非 git 目录 exit 3
selftest.sh                   25    2026-09-10T03:43:22Z  selftest
```

`runs` 只数 PASS 与 FAIL，SKIPPED 不凑次数——拿它凑等于给从没跑过的用例发退休证。列出的是「跑够次数且一次没红过」的候选，发版前过一遍，删掉哪条记进 progress.md。

**地板用例不退休**。`test-age.mjs` 的 `FLOOR_FILES` 硬编码三个文件：`test-scan-secrets-userinfo.sh`（密钥）/ `test-setup.sh`（安装器）/ `test-hooks-floor.sh`（危险命令与密钥闸）。`.claude/CLAUDE.md` [开发测试规则] 写的是四类——密钥 / 危险命令 / 安装器 / 发版装配，第四类（`test-release-manifest.sh` / `test-release-binding.sh`）脚本里没列进 `FLOOR_FILES`，靠规则守：退休前先对照这四类。

## 进阶：githooks 三件

默认不开，显式开：

```bash
bash .claude/scripts/install-githooks.sh on      # 只写本仓 .git/config 的 core.hooksPath
bash .claude/scripts/install-githooks.sh status
bash .claude/scripts/install-githooks.sh off
```

Windows：`pwsh .claude/scripts/install-githooks.ps1 on|off|status`。hook 本身只有一套 POSIX 脚本，Git for Windows 用自带 sh 跑。

你会看到（本仓）：

```
install-githooks: on（core.hooksPath = .claude/githooks）
  pre-commit：在，有执行位
  commit-msg：在，有执行位
  pre-push：在，有执行位
```

`core.hooksPath` 已被 husky / lefthook 占着时 `on` 拒绝并让你自己拍板——覆盖等于停用别人的 hook，属存量资产那一档。

| hook | 跑什么 | 前提 |
|---|---|---|
| `pre-commit` | `node .claude/harness/audit/scan-secrets.mjs --staged` / `scan-instructions.mjs --staged` / `check-syntax.mjs --staged`；catalog 在时再跑 `harness.mjs catalog-lint` 与 `harness.mjs fitness --paths <staged>` | 有 node；三只审计脚本不看 catalog、不 import 引擎 |
| `commit-msg` | subject 显示宽度 < 12 拒；无信息词（`wip` / `fix` / `update` / `misc` / `temp` / `test` / `.`，剥掉 `type(scope):` 后余部命中也算）拒；> 72 告警不拒；`Merge ` / `Revert ` / `fixup!` / `squash!` / `amend!` / `#` 开头放行 | 无 |
| `pre-push` | 改动全落在 `progress.md` / `docs/` / `.claude/feedback/` / `*.md` 就是纯文档推送直接放行；代码推送跑 `harness.mjs selftest`（非 0 阻断）+ `scan-secrets.mjs`（rc 1 阻断 / rc 3 降级出声） | 有 node |

宽度按显示列算：字节数减 UTF-8 续字节数得字符数，再把 3 / 4 字节序列各 +1。按字节算 `修复登录` 是 12 字节让「< 12」对中文完全放空；按字符数算 `fix: 修好登录崩溃` 11 个字符会被误拒，显示宽度 17 正常通过。

全量回归不在 git 这层：挂在每次 push 上要等几分钟，人第一天就会 `--no-verify`。

### 退出码怎么读

逐条检查各判各的，不共用一张表（`.claude/githooks/README.md`「退出码怎么读」）：

| 契约 | 用在 | 0 | 1 | 2 | 3 | 其余 |
|---|---|---|---|---|---|---|
| audit | `scan-secrets` / `scan-instructions` / `check-syntax` | 干净 → 放行 | 有命中 → **阻断** | 用法错 → **阻断** | 降级 → 告警 | SKIPPED |
| lint | `catalog-lint` / `fitness` / `selftest` | 干净 → 放行 | 有错 → **阻断** | （不在契约内） | 降级 → 告警 | SKIPPED |

`2` 要阻断：那是 hook 自己把参数写错了，必须刺眼。`3` 只告警：`check-syntax` 在没装 pwsh 的机器上恒 rc 3，拦每次 commit 的结局是闸被卸掉；但降级不是通过，每条降级在 stderr 留一行，汇总单列「降级项（该跑没跑成）」。契约外（node 缺失 / 脚本不在 / 引擎异常）打 SKIPPED 并放行——与 Claude Code hook 层对契约外退出码 fail-closed 的立场不同，理由是会话内拦停能当场解释重试，git hook 拦住每次提交只会被卸掉；CI 那层对所有人 fail-closed。

放行时如果一条都没跑成，汇总明说「本次提交没有任何检查跑成」。

### `--no-verify` 是 HIGH 档行为

`git commit --no-verify` / `git push --no-verify` 一次性关掉这层全部检查。按 `.claude/CLAUDE.md` [审批三档]，这是 HIGH 档——必停等用户明确批准，并说清为什么绕。CI 绕不过去。这一层不认 fast 档：提交路径上的密钥扫描不在放水范围。

回归：`.claude/tests/test-githooks.sh` 在 `mktemp -d` 的临时仓里覆盖三个 hook，已挂进 `run-all.sh` 第二段。

## 进阶：CI 五格

`.github/workflows/gate.yml` 两个 job：

| 格 | runner | 跑什么 |
|---|---|---|
| gate (ubuntu-latest, node 22) | Linux | selftest → scan-secrets → scan-instructions → check-syntax（rc 3 告警放行）→ `run-all.sh --level all`（断言第三段显式 SKIPPED）→ catalog 步（无 catalog 打一句跳过）→ 汇总判定 → doctor（永远跑）→ 失败上传 `runall.log` |
| gate (ubuntu-latest, node 24) | Linux | 同上 |
| gate (windows-latest, node 22) | Git Bash | 同上，但 check-syntax rc 3 判失败（runner 一定有 pwsh），**不跑 run-all** |
| gate (windows-latest, node 24) | Git Bash | 同上 |
| ps1 (windows) | pwsh | ① `Parser::ParseFile` 逐个解析清单里六个 `.ps1`，多一个少一个都失败 ② Git Bash 跑 `test-hooks-node.sh`（hook 的唯一 Windows 真机覆盖）③ `test-ps1-behavior.ps1`（rc 3 判失败）④ `test-installer-parity.ps1`（setup.ps1 与 setup.sh 装出来逐文件比对） |

触发：push 到 main、pull_request、手动、每周一 03:17 UTC（`cron: '17 3 * * 1'`）。定时跑是为了让 runner 镜像换代、node 大版本漂移这类不改一行代码就能让闸失效的腐烂提前现形；17 分是错开 GitHub 整点高负载；公开仓 60 天无活动会自动停掉定时任务。

gate 格每步 `continue-on-error: true`，末尾「汇总判定」任一步 `outcome=failure` 整格失败——一次 run 暴露全部问题，不用修一个看一个。

Windows 格为什么不跑 `run-all`（`gate.yml` 注释）：里面大量断言假设 POSIX 语义（`chmod 000` 的权限位、`kill -9`、进程组、mktemp 挂载点），硬改只会把测试扭曲成迁就 CI。Windows 真正该验的三样都在别的格里：引擎（selftest / 审计各步，gate 格内）、hook 行为（ps1 格用 Git Bash 跑 `test-hooks-node.sh`，hook 单运行时后两平台同一份 `.mjs`）、剩余 `.ps1` 的语法与行为（ps1 格）。

Windows 格前置两件：checkout 之前 `git config --global core.autocrlf false`（否则 `.sh` 全转 CRLF，bash 报 `$'\r': command not found`）；job 级 `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1`（Windows 上 python stdout 默认 cp1252，内嵌 python 打中文崩）。`run-all.sh` 顶部也 export 了同样两个变量，两处覆盖面不同。

## 进阶：本地绿不等于 CI 绿

`.claude/CLAUDE.md` [开发测试规则]：本地绿只是必要条件，推送后另跑一次 `gh run list` 读 CI 自己的结论再报完成，读不到写「未知」不写「通过」。本地默认只跑 high 档、CI 跑 all，两边跑的根本不是同一套。

本仓 2026-09-15 的例子：`.claude/harness/audit/scan-instructions.mjs` 的白名单条目绑着行号，一批改动让行号漂移、豁免失效；本地 `pre-commit` githook 当时只跑 secrets 与 syntax 两只审计脚本，没人跑 instructions，红在 CI 四格上才发现。修复是提交 `6602147`「fix(audit): 白名单条目随行号漂移重签 + pre-commit 补跑指令注入扫描」，`.claude/githooks/pre-commit` 头注释留了一句：

```
#（指令注入那项 2026-09-15 补进来：白名单条目随行号漂移失效，本地没人跑它，红在 CI 四格上才发现。）
```

更早一次记在 `.claude/feedback/local-green-is-not-ci-green-check-before-closeout.md`（已毕业进 CLAUDE.md）：v2 收官十余批每批本地 `run-all` RC=0，CI 却自一个月前起持续 failure，四格三红——CI 额外跑审计脚本、Windows 真机 selftest，本地全 SKIP。

`release` 子命令把这条机器化了：`ci` 项从 `gh run list` 读当前 HEAD 的结论，读不到降级写「CI 状态未知，不等于通过」，查到 failure 阻断。

```bash
gh run list --limit 5
gh run view <run-id> --log-failed
```

## 精通：FRAMEWORK-MANIFEST

`.claude/FRAMEWORK-MANIFEST.txt` 是框架核心文件清单，每行 `<相对 .claude/ 的路径>TAB<sha256>`，`#` 开头是注释。哈希算法是 LF 归一化后 SHA256（`tr -d '\r'` 再 `sha256sum`），跨 autocrlf 稳定。

它给谁用：`setup.sh` 装到目标项目时用同一套排除逻辑拷同一批文件，**没有清单行的框架文件会被当成用户改过、升级时不覆盖**；`bash .claude/scripts/doctor.sh` 全量比对每条的 SHA；`release` 的 `manifest` 项判「这份清单是不是 gen-manifest.sh 现在会写出来的那份」（漏列 / 列了树上没有 / 哈希不符三类都算，行序不比）。

```bash
bash .claude/scripts/gen-manifest.sh           # 重写清单
bash .claude/scripts/gen-manifest.sh --check   # 只比对，漂移 rc 1
```

你会看到（本仓）：

```
gen-manifest --check: 清单与源码树一致（127 个框架文件）
```

何时重跑：改了任何会分发的框架文件（hooks / harness 核心 / skills / agents / rules / scripts / CLAUDE.md …）之后、发版之前。清单不再逐次提交刷新——`pre-commit` githook 头注释：每次 commit 都要重跑生成器，人只会 `--no-verify`；改由发版时 `gen-manifest.sh` 重生一次，`release` 装配与 `test-setup.sh ⑨` 兜底。

### 排除表四份同步

哪些文件不入清单、不随装，真相源是 `.claude/harness/exclusions.json`（`$schema: "cc-base exclusions v1"`），每条 `pattern` / `keep` / `note` / `ps1{kind,token}`。`node .claude/scripts/gen-exclusions.mjs` 据此重写三处标记区：

| 消费方 | 位置 | 生成还是手写 |
|---|---|---|
| `gen-manifest.sh` | `# @exclusions:begin` 到 `end` 之间的 `case` 臂 | 生成 |
| `setup.sh` | `copy_claude_tree` 的 `case` 臂 | 生成 |
| `setup.ps1` | `$skip` / `$skipAnyDepth` 两行与 `-match` 正则区（纯 ASCII，中文 note 不进 ps1） | 生成 |
| `harness/ext/release.mjs` `MANIFEST_RULES` | release 的 manifest 检查 | **手写**，故意不共用来源——审计者和被审者对同一份表点头就审不出漂移 |

```bash
node .claude/scripts/gen-exclusions.mjs           # 重写三处
node .claude/scripts/gen-exclusions.mjs --check   # 有差异打印文件名 rc 1
```

本仓 `--check` rc 0 无输出。口径由测试兜：`test-release-manifest.sh` 造真文件锁 `gen-manifest.sh` + `MANIFEST_RULES` 行为一致，`test-setup.sh ⑥` 逐臂比对四份表的字面。

不抽单一来源是权衡：两个安装器要能被单独取走对着源码树跑（`setup.sh` 连 jq 都不敢依赖），多一个 source / parse 依赖就多一条装不上的路。

## 精通：闸靠数据留

`.claude/CLAUDE.md` [开发测试规则]：长期全绿、从没拦过东西的闸就简化或删，`gate-audit.sh` 报的就是这个。它读 `gate-block.log`，不跑任何检查：

```bash
bash .claude/scripts/gate-audit.sh
```

你会看到（本仓）：

```
── (a) 有战绩的钩子（按拦截次数降序）──
钩子名                      拦截次数  首次                末次
stop-gate                            40  2026-09-03T06:45:24Z  2026-09-15T08:15:53Z
three-file-sync-gate                 33  2026-09-01T15:29:14Z  2026-09-12T07:21:00Z
tdd-gate                             20  2026-09-05T21:58:31Z  2026-09-15T06:37:49Z
secret-exfil-guard                   17  …
dangerous-pkill-guard                10  …
tier                                  8  …
precompact-gate                       2  …
release-gate                          1  …

── (b) 零记录钩子（注册了但从没拦过：前置条件不在本仓，或威慑生效）──
  • harness-async-verify
  • no-direct-code-guard
  • pre-commit-check
```

零记录不等于该删：`harness-async-verify` 与 `pre-commit-check` 的大仓分支在本仓没 catalog 根本不跑，`no-direct-code-guard` 守的是主 Agent 不写 `src/`，本仓没有 `src/`。删之前先问它在你的项目里有没有前置条件，再看账本。脚手架自检类（selftest）不适用这条——它本就该常绿（`.claude/tests/README.md`）。

大仓包另有同名子命令 `node .claude/harness/harness.mjs gate-audit`，审的是 catalog check 而不是 hook，读的是 harness 账本，两者不合并。

## 精通：测试比例口径

`progress.md` Pinned（2026-09-15 那条，取代 2026-09-10 的分母口径）只引口径：核心测试占核心有效代码三分之一到二分之一之间。有效代码 = hooks / harness 核心（`harness.mjs` + `lib` + `audit`）/ scripts / githooks / 安装器；`.claude/harness/ext/` 与它的测试（`cases/test-harness.sh` / `test-evidence-defects.sh` / `test-release-binding.sh`）另成一对各自算。清点命令写死在 Pinned 里，2026-09-15 实测 5360 / 10726 = 0.50。

同日 Decisions：比例 0.509 用户裁定「测试可以了，范围合理」，不再压；区间仍是规则，超出个位数百分点由用户看范围拍板，不自动触发再砍。

预算按风险给：泄密 / 毁数据 / 装坏别人项目的（密钥与危险命令闸、安装器与 manifest、发布装配）可到二分之一；引擎子命令只守退出码契约加一条真实场景；提醒类 hook、档位、工具脚本各留一两条。

## 常见坑

- **只跑 `run-all.sh` 默认档就报「全绿」**：默认 `--level high`，medium / low 全跳过，汇总行写着跳了几套。报绿附运行清单。
- **把「SKIPPED」当过**：run-all 每种跳过都在最后一行点名；CI 上第三段必须是显式 SKIPPED，静默没跑照旧判红。
- **改了框架文件不重跑 `gen-manifest.sh`**：清单里是旧哈希，装到别人项目那份被当「用户改过」永不覆盖；`release` 的 manifest 项 FAIL、`test-setup ⑨` 红、doctor 报「FRAMEWORK-MANIFEST 不符」。
- **手改 `gen-manifest.sh` / `setup.sh` 的排除臂**：`gen-exclusions.mjs --check` 抓出来 rc 1；改 `exclusions.json` 再生成。
- **githook 没装以为有防护**：`install-githooks.sh status` 看 `core.hooksPath`；setup 一律不碰它。
- **中文 commit 标题被拒**：看是不是余部命中无信息词（`chore: update`），宽度按显示列算不会误拒中文。
- **`check-syntax` 本机 rc 3 当没事**：Linux / WSL 没 pwsh 就验不了 `.ps1`，只有 CI 的 Windows 格真验；Pinned 要求剩余 `.ps1` 纯 ASCII，本机改了 `.ps1` 推上去看 ps1 格。
- **Windows runner 上 `.sh` 报 `$'\r': command not found`**：`autocrlf` 没在 checkout 前关；本仓没有 `.gitattributes` 兜底。
- **退休用例时删了地板**：`FLOOR_FILES` 三个文件脚本挡住，发版装配那类靠人对照 CLAUDE.md 四类清单。
- **`.claude/evidence/` 被 commit**：它在根 `.gitignore`；两份账本都是本机流水。
