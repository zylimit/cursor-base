---
name: installer-and-selfcheck-attacks
description: 审安装器 / 自检工具（setup.sh·ps1、doctor）的八条固定攻法——分母缩水、装完自检、锁、trap 标记、可选包绕过三层保护、字节签名怕 CRLF
metadata:
  type: project
---

本仓凡是「往别人项目里装」或「装完自查完整性」的工具，照这八条打。

1. **「全量比对」的分母会自己缩水**。固定实验：移走 10 个清单登记的文件 → 看 rc 和 ✓ 那行的数字；同族：清单删掉 / 清空 / 路径变目录。`doctor.sh` 已修成缺件计 ✗（2026-09-19 复核），但比对仍**单向**：盘上有、清单没登记的（`--with-harness` 装出的 ext/ 与 rules/ 副本）永远不查、升级也不刷新。

2. **自检工具必须装到干净目标再跑**：`setup.sh /tmp/x && doctor.sh /tmp/x` 看 rc。当年 doctor 硬判仓根 `make-release.sh`、每个下游恒 rc 1，已修（现为 `!` 跳过）。**测试会用桩文件绕过而不是修**——读夹具注释能直接捡到 finding。

3. **锁是 `[ -f ] … > lock` 的一律不是锁**。test-then-write 中间没有原子原语。
   固定实验：原样脚本跑 24~36 轮 × 2 并发装同一 mktemp 目标，数「两边都 rc 0」的轮数（当年约 8%）。setup.sh 已改 `set -o noclobber`（2026-09-19 仍是）；范式另见 `core.mjs` 的 `withDirLock()`。

4. **trap 写的「中断标记」扛不住 trap 跑不了的场景**，而那恰恰是标记存在的理由。
   `setup.sh` 的 EXIT trap 把 marker 翻 `interrupted`（doctor 判 ✗ rc 1）；`kill -9` 后 marker 停在 `active` + 死 pid，doctor 只给 `!` warn、rc 0。marker 里已经记了 pid、`acquire_lock` 里已经有 `kill -0`，消费方却不用。
   查检：每个「状态标记」都问一句「写它的那条路径跑不了时，标记停在哪个值，消费方怎么判」。
   附带：`written` 清单只在 start 时写一次（空的），硬崩后永远是 `[]`。

5. **`case` 里的 `*) target="$1"` = 未知参数被静默当参数**。`setup.sh --dryrun /tmp/x` 真装 240 个文件、rc 0、零告警——零写入安全开关拼错一个连字符就变成完整写入。
   查检：安全类 flag 一律白名单，未知参数 die。

6. **多份排除表要自己数，注释里的数字不算**。注释写「另有三份/四份」，实际七处。
   验法不是读表：源树里造**真实形态**样本（worktree 副本里还有一层 `.claude/`），两个安装器 + 生成器都跑一遍比 `comm` 双向差集；`manifestIncludes` / `isStateExcluded` / `isDenied` 三个纯函数直接 import 探针。
   主循环那七处对齐过一次，但**可选包分支根本不过表**：`--with-harness` 实测把 `ext/.DS_Store`、`scan.mjs.bak`、`ext/state/run.json` 一起拷出去。

7. **可选包分支也绕过 manifest 三层保护**（2026-09-19 发现，2026-09-22 复审：`.bak`/`dry-run` 动作名/排除表/rules 顶层四项已修，见 `review-hotspots-installers.md` 详情）。`--with-tests` / `--with-harness` 不走 manifest 分层是有意设计（测试/引擎不算用户文件），但**永不拒绝覆盖**——manifest 分层对核心文件的语义是「不确定就不碰 live，落 `.framework-new`」，可选包分支就算内容完全是用户自己改的也一律覆盖 live（留 `.bak`）；dry-run 复用 `update` 这个词汇报告，跟核心文件真正安全升级时的 `update` 同名不同质，掩盖了「这条 update 其实在吃掉用户改动」。连续两轮「改动→重装」会把第一轮的 `.bak` 也覆盖掉——`.bak` 只有一代。实验：装完改一行再装一次，比 sha + 数 `.bak`；反复两轮改会证明单代 `.bak` 丢失。
8. **按字节签名的表都要问 CRLF**。manifest 归一（`tr -d '\r'`），`instructions-allowlist.json` 不归一 → Windows autocrlf 检出当场豁免失效 rc 1；仓里没 `.gitattributes`，`gate.yml` 给 Windows 格设 `core.autocrlf false` 把这条盖住了。

**同一个文件里两张排除表口径不一致 = 其中一张裸奔**：`static-check.mjs` 给 JS 写了第二张不排 `.claude/` 的表，`.sh` 那张原样排掉整个 `.claude/` —— shellcheck 面只覆盖 46 个 `.sh` 里的 2 个（2026-09-19 复核仍如此）。凡是审 `.claude/**/*.sh` 的改动，Stage 0 那行「全绿（shellcheck）」不覆盖它，自己手跑一遍再下结论。
9. **「对等语义」查manifest 缺席会让 update 分支永死**（2026-09-22 审 #81/#82）：装一次 → 只改 SRC 的某 ext/tests 文件（target 不动）→ 重装，该文件仍报 conflict 不报 update——因为 `harness/ext/*`/`tests/*` 故意不入 FRAMEWORK-MANIFEST.txt，`old_sha` 永远查不到，靠「target sha == 旧 manifest sha」判定的 update 分支对这两棵子树是死代码；对照改主树文件走同一函数会正确 update。详情见 [[../../../docs/agent-notes/code-reviewer/review-hotspots-installers.md]]。
相关：[[pattern_gate-scripts-false-green-in-machine-channel]]、[[pattern_duplicated-rule-tables]]、[[pattern_evidence-ledger-attacks]]
