# .claude/githooks —— Claude Code 之外的强制层

cc-base 的 19 个注册 hook **只在 Claude Code 会话内生效**。用户自己手敲 `git commit`、用别的编辑器提交、脚本或别的 Agent 提交、CI 上跑——全部零防护。这一层堵的就是这个缺口。

## 三层分工

| 层 | 位置 | 管到哪 | 管不到哪 |
|---|---|---|---|
| Claude Code hook | `.claude/hooks/` | 会话内的每一次工具调用（能拦 Write/Edit、能改入参、能在 Stop 时拦停） | 会话外的一切 |
| git hook | `.claude/githooks/`（本目录） | 凡是走 git 的提交与推送路径，不管谁发起 | 没装这层的机器；`--no-verify` |
| CI | `.github/workflows/gate.yml` | 所有人、所有分支、所有机器，没人能靠不装绕开 | 没推上去的东西 |

三层互补，谁都不替代谁。会话内的拦截（改文件之前就拦住）git 拿不到；跨机器的一致性只有 CI 给得了；而 git 这层是唯一一个「无论谁提交都在」的位置。

## 默认不开，显式开

setup 一律不碰 `core.hooksPath`——悄悄改它会把用户自己的 `.git/hooks` 整个顶掉，这种事不替人做决定。

```bash
bash .claude/scripts/install-githooks.sh on       # 开（只写本仓库的 .git/config）
bash .claude/scripts/install-githooks.sh status   # 看状态 + 三个 hook 的执行位
bash .claude/scripts/install-githooks.sh off      # 关
```

```powershell
pwsh .claude/scripts/install-githooks.ps1 on|off|status
```

手工等价：`git config core.hooksPath .claude/githooks` / `git config --unset core.hooksPath`。

`core.hooksPath` 已被别的工具（husky、lefthook）占着时，`on` 会拒绝并让你自己拍板——覆盖等于把那套 hook 整个停掉，属于「停用现有资产」那一档。

Windows 侧不需要 `.ps1` 版本的 hook：git 按**文件名**挑 hook，不看扩展名，Git for Windows 用它自带的 sh 跑这三个 POSIX 脚本。所以本目录只有一套。

这一层**不认 fast-mode**。`.claude/.fast-mode` 是会话内的放水开关，`.claude/hooks/` 那层看它；提交路径上的密钥扫描不在放水范围（Fast Mode 自己的边界就写着「不豁免危险命令 / 密钥隐私」）。要临时绕就 `--no-verify`，那是显式的、留在 reflog 里的、要向人交代的动作，比一个 24 小时静默生效的开关诚实。

## 每个 hook 跑什么

### pre-commit —— 只跑快的静态检查

行为证明归 pre-push，别让每次 commit 等几分钟。

| 检查 | 命令 | 前提 |
|---|---|---|
| secrets | `node .claude/harness/audit/scan-secrets.mjs --staged` | 有 node |
| instructions | `node .claude/harness/audit/scan-instructions.mjs --staged` | 有 node |
| syntax | `node .claude/harness/audit/check-syntax.mjs --staged` | 有 node |
| catalog-lint | `node .claude/harness/harness.mjs catalog-lint` | 有 catalog |
| fitness | `node .claude/harness/harness.mjs fitness --paths <staged 文件>` | 有 catalog |

三只审计脚本**不看 catalog**——它们故意不 import 引擎，引擎坏了、catalog 没配，它们照样跑。大仓那两条才是 catalog 门控（catalog 不在 = 大仓能力默认关闭，小项目零负担）。

`--staged` 的意思是文件名和内容**都取自索引**，判的是「正在提交的东西」，不是工作树里顺手改了还没 add 的东西。

两处已知边界，都是出声降级不是静默：

- `fitness --paths` 收逗号分隔清单，所以文件名里带逗号或换行时切不开——检测到就退回不带 `--paths` 的 changed 作用域并打印说明，不拿切错的清单假装扫过。staged 超 500 个文件时同样退回。
- `fitness` 读的是**工作树**内容，不是索引。文件 add 之后又改了，它看到的是改之后的。真要卡索引内容的是那三只 `--staged` 脚本。

### commit-msg —— 拒绝什么都没说的 subject

本仓风格（`git log --format=%s -20`）：`type(scope): 中文主题`。

- 放行：`Merge ` / `Revert ` / `fixup!` / `squash!` / `amend!` / `#` 开头。后三个是 `rebase --autosquash` 认的字面前缀，拦了等于把 rebase 弄坏。
- 拒：显示宽度 < 12。
- 拒：无信息词（`wip` / `fix` / `update` / `misc` / `temp` / `test` / `.` 这类）。整条命中算，剥掉 `type(scope):` 前缀后剩下的余部命中也算——`chore: update` 属于后者。
- 告警不拒：显示宽度 > 72。

**宽度按显示列算，不按字节、也不按字符个数。** 这是本仓最容易踩的一脚：

- 按字节：UTF-8 一个汉字 3 字节，`修复登录` 是 12 字节，「< 12」这条闸对中文等于完全放空；72 那条则反过来，正常中文标题全部超线。
- 按字符个数：`fix: 修好登录崩溃` 是 11 个字符，会被「< 12」误拒；它的显示宽度是 17，正常通过。

算法：字节数 - UTF-8 续字节数（0x80-0xBF）= 字符数，再把 3/4 字节序列（0xE0-0xF4 打头，CJK、CJK 标点、全角、emoji）各 +1 计两列。全程 `LC_ALL=C` 按字节数——git 跑 hook 时 locale 常是 C，`wc -m` 那类依赖 locale 的算法在这里会悄悄退化成按字节。

空消息不接管：交给 git 自己中止，免得把 `--allow-empty-message` 这类显式流程弄坏。

### pre-push —— 最后一道自动闸

先按这次推的是什么分两条路：读 git 喂进 stdin 的 ref 列表算出改了哪些文件，全落在 `progress.md` /
`docs/` / `.claude/feedback/` / 任何 `*.md` 里就是纯文档推送，打一行放行；判不出改了什么（算不出
diff、一条 ref 都没读到）一律按代码推送办。

代码推送只跑两项：

- `node .claude/harness/harness.mjs selftest`（rc 非 0 → 阻断）
- `node .claude/harness/audit/scan-secrets.mjs`（rc 1 → 阻断；rc 3 降级出声，不阻断）

**全量回归不在这一层**：`bash .claude/tests/cases/run-all.sh` 人自己跑或 CI 跑。挂在每次 push 上要等
几分钟，人第一天就会 `--no-verify`，闸整个废掉。阻断时会把这条自查命令打出来。

## 退出码怎么读

**逐条检查各判各的，不共用一张想当然的表。** 审计脚本与引擎的契约不一样，混成一张表会把「引擎崩了」读成「用法错」，两者该采取的行动完全不同。

| 契约 | 用在 | 0 | 1 | 2 | 3 | 其余 |
|---|---|---|---|---|---|---|
| audit | 审计脚本（`scan-secrets` / `check-syntax`） | 干净 → 放行 | 有命中 → **阻断** | 用法错 → **阻断** | 降级 → 告警 | SKIPPED |
| lint | `catalog-lint` / `fitness` / `selftest` | 干净 → 放行 | 有错 → **阻断** | （不在契约内） | 降级 → 告警 | SKIPPED |

引擎完整的退出码契约表见 `.claude/harness/ext/rules/harness-large-repo.md`（装了 `--with-harness` 的项目在 `.claude/rules/` 下另有一份）。

### 为什么 `2`（用法错）要阻断

引擎的 `parseArgs` 会**静默吞掉未知 flag**——写错的 flag 既不报错也不生效，闸就成了摆设。审计脚本对未知 flag 明确返回 2，这是唯一能把「hook 写错了」照出来的信号，所以它必须刺眼。

### 为什么 `3`（降级）只告警不阻断

`check-syntax` 在没装 pwsh 的机器上恒 rc 3（安装器与脚本那几个 `.ps1` 一整类压根没验）。拿这个拦住每一次 commit，人第一天就会 `--no-verify`，闸直接废掉。

但**降级不是通过**——每一条降级都在 stderr 留一行，汇总里单独列成「降级项（该跑没跑成）」。真要把 `.ps1` 验成，靠的是 CI 的 windows-latest 那格（runner 自带 pwsh）。

### 为什么命令崩了打 SKIPPED 而不阻断

node 缺失、脚本不在、引擎异常退出——这类是「工具跑不起来」，不是「你的改动有问题」。打印 SKIPPED + 「未执行 != 通过」并放行，与仓里 `harness_node_ok` 的降级哲学一致，区别是那边静默、这边出声。

**这一条与 Claude Code hook 层的立场是不同的**：那层对契约外退出码是 fail-closed（`stop-gate` 出 block、`pre-commit-check` exit 2，见 `.claude/harness/ext/rules/harness-large-repo.md`）。区别在于会话内的拦停可以当场解释、当场重试，而一个会因为环境缺工具就拦住每次提交的 git hook，结局只有被卸掉。这一层放行，CI 那层对所有人 fail-closed。

**绝不会出现「跑失败了却当通过」**：上面每一类都在 stderr 留一行，末尾还有汇总。放行时如果一条都没跑成，汇总会明说「本次提交没有任何检查跑成」。

## `--no-verify` 是 HIGH 档行为

`git commit --no-verify` / `git push --no-verify` 一次性关掉这一层的全部检查。按 CLAUDE.md 的审批三档，这是 **HIGH 档**——必停等用户明确批准，并且要向人说清为什么绕。

绕过不是罪，糊弄才是。合理的绕过场景（正在修 hook 自己、紧急回滚、明知某条降级）说一句就行；不说而绕，下一个人读 git log 时就只能猜。

CI 那层绕不过去：`--no-verify` 只影响本机 git，`.github/workflows/gate.yml` 照跑。

## 回归测试

`.claude/tests/test-githooks.sh` 覆盖这三个 hook：干净树放行 / 注入密钥被拦 / 无信息 commit message 被拒 / 中文标题不被误拒 / rc 3 降级不阻断 / 命令缺失打 SKIPPED 不阻断 / pre-push 纯文档放行与代码推送两项。全部在 `mktemp -d` 出来的临时仓里跑，对 cc-base 只读。已挂进 `.claude/tests/cases/run-all.sh` 第二段（带 node 守卫）。
