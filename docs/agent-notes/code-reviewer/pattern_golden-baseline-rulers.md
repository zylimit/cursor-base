---
name: golden-baseline-rulers
description: 审 golden/基线快照类工具（尺子）的固定攻法——覆盖矩阵不进机器判据、transitive selftest 撑绿、环境耦合字段入库
metadata:
  type: project
---

本仓凡是「录一份基线再回放比对」的工具（`harness-golden.mjs` 一类），照这四条打，2026-09-02
审 golden 基线时四条全中：

1. **矩阵本身不是断言**。删掉一个 scenario / 一个 command 条目，`--check` 照样 rc 0，只有人读那行
   的计数变了（`GOLDEN OK: 7 scenarios`）。命令 id 列表有比对、**scenario 列表没有**。
   固定实验：注释掉一个 scenario 跑 `--check`，看 rc。
2. **transitive selftest 撑绿会掩盖矩阵缺口**。golden 里录了 `selftest` 的 `{ok, tests:N}`，很多突变
   是被 selftest 的断言抓到的、不是被 8 场景输出抓到的。判据：FAIL 出现在**全部**场景且差异数一致
   （本仓是 7 diffs/场景）= selftest 抓的；只在部分场景 FAIL = 矩阵真抓的。
   所以问"覆盖率"时要分开算：矩阵覆盖 vs selftest 覆盖。selftest 也要跟着拆库走，别当独立第二意见。
3. **环境探测字段入库 = 假红源**。`adapters list` 的 `available` 是真 PATH 探测，录进了 git 的基线。
   往 pinned PATH 里放一个同名可执行文件，8 个场景全红。查检：`grep` 基线里有没有
   available/present/installed/version 这类描述机器而非描述行为的字段。
4. **正则大 alternation 只测一支**。fitness / 提取器这类规则，fixture 通常只命中第一支；
   逐支置换成 NEVERMATCH 跑 `--check`，没红的就是裸奔支。本仓 12 语言 import 提取器里 7 个
   可静默删除，secret 规则 6 支里 3 支（AKIA/ghp_/PRIVATE KEY）可静默删除。

5. **断言用被测函数算期望 = 同义反复**。`assert.equal(line.chain, chainHash(GENESIS, line.contentHash))`——
   把 `chainHash` 改成不折 prev，两边一起变，断言照过。查检：每条哈希/编码断言的期望值是不是
   硬编码常量或另一条独立算路；不是就等于没测。
6. **cmd\* 包装层的退出码没人测**。selftest 只测纯函数（`verifyLedgerChain`），golden 的 COMMANDS
   条目只跑 happy path，于是「断裂 → rc 1」「删不掉 → rc 1」「超限 → rc 1」三处 translation 全裸奔：
   把 `cmdLedger`/`cmdRetention`/`cmdBudget` 改成恒 rc 0，两把尺子都不响。
   **每个非零退出分支都要在 golden 矩阵里有一个真进入该分支的场景**，否则 rc 只测了 0。
7. **sandbox 的兜底排除会遮住被测的精确排除**。golden 沙箱写 `.git/info/exclude` = `.claude/`，
   整棵 `.claude/` 对 git 隐形——于是 `STATE_EXCLUDE` / `STATE_EXCLUDE_PREFIXES` / `DENY` 里任何
   `.claude/harness/**` 条目被删掉，9 个场景全绿。凡是「路径排除表」类代码，矩阵里必须有一个
   **不做兜底排除**的场景。

8. **沙箱夹具里恒 DEGRADED 的 check = 那条 check 的全部规则零覆盖**。golden 沙箱由
   `readFixtureTree()` 造，里面没有 `FRAMEWORK-MANIFEST.txt`，于是 9 个场景的 `release`
   全部报 `manifest: DEGRADED`——`MANIFEST_RULES` 整张表在 golden 里一次都没被查询过。
   查检：把每个 command 的录制输出扫一遍 `DEGRADED` / `SKIPPED` / `blocked`，凡是**全场景同一态**的，
   就当它没覆盖，去问「那这段实现谁在盯」。

9. **多批并行时判「基线脏没脏」不靠推理，靠 revert 后重跑**。基线在别的批改动在树上时录的，
   形式上不干净。做法：复制一份仓 → 把其他批的文件 `git show HEAD:<path>` 覆盖回去 → 只留本批 →
   跑 `--check --strict`。仍然 rc 0 就证明基线与其他批无关。本轮 A/B/C 三批这样验过，20127 全中。

**攻法的正确姿势（别改被审仓）**：`cp -a .claude $HOME/playground/.claude`，工具用 `import.meta.url`
推 REPO_ROOT，整套在 playground 里跑，突变随便做，被审仓零写入。先跑一次确认 playground 断言数与
原仓一致（本仓 5188）再开打。
**量化两把尺子的独立性**：每次突变分别跑 selftest 和 golden 并分开记 CAUGHT。2026-09-02 对 P1 的
65 次突变结果 both=37 / golden-only=14 / **selftest-only=0** / NAKED=14——selftest 对 golden 零增量，
「152 条断言」不代表 152 份独立证据。报覆盖率必须报这个交叉表，不报单边计数。
相关：[[pattern_gate-scripts-false-green-in-machine-channel]]、[[project_cc-base-is-a-framework-repo]]
