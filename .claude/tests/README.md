# cc-base 框架自测 harness

借鉴 Superpowers 的 `tests/`，验证 cc-base 自己的铁律会触发——尤其是
「匹配触发条件时先调 Skill 再动手，不偷跑」这条。

## 测什么

两层断言，对应两个失败模式：

1. **该调的 Skill 真被调了**——喂一个 naive prompt（如「我想做个 todo 应用」），
   断言事件日志里出现对应 Skill 的工具调用。验的是路由规则（CLAUDE.md [Skill 调用规则]）
   确实触发，而不是被 agent 忽略。
2. **调 Skill 之前没有偷跑**——在 invoke Skill 之前就出现 Edit/Write/Bash 等动作工具，
   说明 agent 跳过流程自己干了，判 FAIL。允许清单：`Skill`、`TodoWrite`、`Read`
   （规划与只读无副作用，不算偷跑）。

机制借 Superpowers：`claude -p --output-format stream-json` 把每个事件输出成一行 JSON，
再用 grep 在日志上做断言。

## 怎么跑

```bash
# 脚手架自测：无依赖、不耗 token、秒级返回。优先跑这个。
bash .claude/tests/selftest.sh

# 全量（三段）：[1] selftest → [2] 静态自测 7 个（test-setup/routing/gate-audit/three-file-sync/fast-mode/fix-platform/hook-parity，无需 claude CLI）→ [3] 真触发 cases（需 claude CLI）。
bash .claude/tests/cases/run-all.sh
```

`run-all.sh` 三段：先 selftest（断言库本身可信），再静态自测（安装器/路由/闸回归，无需 CLI），最后真触发 cases——**默认不跑**，`CCBASE_RUN_CLAUDE_CASES=1` 才跑（跳过时汇总行点名，未执行 != 通过）。harness 自测（`cases/test-harness.sh`）只需 node、归第二段。

第二段末尾另跑 `dod` 和 `release` 两个一键闸——最外层的闸自己不在回归网里，是最容易烂掉的那种。
`dod` 断 rc 0；`release` **不断 rc 0**：工作树脏 / Fast Mode 开着 / CI 红都会让它正确地判「未就绪」，
断 rc 0 等于把它做成恒红。它断的是「引擎跑出了结构完整的清单」（七个装配项齐、状态在枚举内、
每条 blocker 带 nextStep）——引擎崩了同样给 rc 1 却吐不出 JSON，正好被这层区分开。

- **selftest.sh** 用 `fixtures/` 里手造的 stream-json 样例跑断言库本身，
  **不需要 claude CLI、不调真 LLM**。验证：good-run 全 PASS、premature-run 的偷跑
  断言被正确判 FAIL（「预期失败」也算 selftest 通过——断言库正确识别偷跑才对）。
- **test-ps1-behavior.ps1** 是唯一真跑 `.ps1` hook 的回归：喂真实 JSON，断言退出码、stdout、
  以及 `.needs-review` / `gate-block.log` 的副作用。`run-all.sh` 第二段带 `command -v pwsh`
  守卫跑它（Linux 开发机没有 pwsh → 明示 SKIP 不假绿）；CI 的 `ps1 (windows)` 那格另跑一遍，
  且把「没跑全」（rc 3）直接判失败——那台 runner 一定有 pwsh 和 node，跑不全就是它自己坏了。
  本机跑法：
  ```bash
  pwsh -NoProfile -File .claude/tests/test-ps1-behavior.ps1
  ```
  退出码 0=断言全过 / 1=有断言红 / 3=有整组没跑成（缺 node 或 git，未执行 != 通过）。
  CI 跑的是 pwsh 7、真实用户跑的是 powershell.exe 5.1，绿了只说明逻辑对——两者在
  Console 编码默认值和 stderr 处理上不同，差在哪写在脚本头。
- **test-predev-lint.sh / test-ui-audit.sh** 锁前期文档闸与设计稿审计两支脚本（`scripts/predev-lint.mjs`、
  `scripts/ui-audit.mjs`）：夹具在 mktemp 沙箱里现造，五份随 skill 发布的范例拼成一个 root 做 dogfood；
  ui-audit 靠 cwd 下植入的 `playwright-core` 桩把渲染路径整条跑通，真渲染那条（U5）没有引擎只能 SKIPPED，
  套件 FAIL=0 但 SKIPPED>0 时退 3，`run-all.sh` 把 3 记进汇总行的 SKIPPED 注记而不判失败——未执行 != 通过。
- **cases/*.sh** 是真触发测试，**需要真 claude CLI，会耗 token**（多 Agent 路由实测）。
  `run-all.sh` 会 `command -v claude` 探测：没有 CLI 就明确打印
  `SKIPPED: 无 claude CLI` 并只跑 selftest——**绝不因缺 CLI 静默假绿**
  （呼应框架反静默失败的铁律：未执行 != 通过）。

- **cases/test-skill-behavior.sh** 是聚合多路由对的 headless 烟囱测试，**opt-in 默认 SKIP**
  （不挂进 run-all 默认；`run-all.sh` 显式 continue 跳过它）。需要 `RUN_LIVE_SKILL=1` 才跑：
  ```bash
  RUN_LIVE_SKILL=1 bash .claude/tests/cases/test-skill-behavior.sh
  ```
  跑法：第一个路由对兼做环境探针——认证失败（OAuth 过期）或无任何 `"name":"Skill"`
  事件时 SKIP 剩余对（带诊断），换真 Anthropic API 环境重跑。use-local/LiteLLM OAuth
  环境已知不产 Skill 事件，框架到位即交付（SKIP 不算 fail）。

  两个落地约束（踩过的坑）：
  - **必须在能加载到 cc-base `.claude/CLAUDE.md` 的目录里跑**——case 脚本 `cd` 到仓库根
    （`git rev-parse --show-toplevel`，失败回退相对路径）。在空临时目录里跑框架路由规则
    根本不生效，Skill 不会触发，测出来是假阴。
  - **`--verbose` 是当前 claude CLI 对 `-p` + `--output-format stream-json` 的硬性要求**，
    少了会直接报 `requires --verbose` 并退出、日志只剩一行错误。

## 文件结构

```
.claude/tests/
├── test-helpers.sh                       # 可 source 的断言库
├── selftest.sh                           # 脚手架自测（无依赖，验断言库本身）
├── test-setup.sh                         # 安装器回归 + 幂等 + MANIFEST 分层 + harness 安装断言
├── test-routing.sh                       # agent(7) / skill(15) 双向一致
├── test-gate-audit.sh                    # 死闸审计回归
├── test-three-file-sync-gate.sh          # 三文件同步闸回归
├── test-fast-mode.sh                     # Fast Mode 总闸回归
├── test-fix-platform.sh                  # fix-platform 跨平台归一回归（6 断言）
├── test-hook-parity.sh                   # .sh / .ps1 hook 对等回归（5 断言）
├── test-ps1-behavior.ps1                 # .ps1 hook 真跑回归（需真 PowerShell，无 pwsh 则 SKIP）
├── README.md
├── fixtures/                             # 手造样例（让断言库脱离真 LLM 自测）
│   ├── good-run.jsonl                    # 先 Skill 再 Edit —— 应两个断言全过
│   ├── premature-run.jsonl              # 先 Edit/Bash 再 Skill —— premature 断言应判 FAIL
│   ├── cross-line-decoupled.jsonl       # 跨行解耦 fixture（锁 selftest 假绿 bug）
│   └── harness/                         # catalog fixture（test-harness 用）
└── cases/                                # harness 自测（仅需 node）+ 真触发测试（需 claude CLI）
    ├── run-all.sh                        # 三段：selftest → 静态自测 7 个 → 真触发 cases（opt-in）
    ├── test-harness.sh                   # harness.mjs 自测（doctor/selftest/context-pack/waiver，只需 node）
    ├── test-skill-behavior.sh            # opt-in 聚合路由对烟囱（RUN_LIVE_SKILL=1，默认 SKIP）
    ├── todo-app-triggers-product-spec.sh # naive prompt → product-spec-builder
    └── bug-report-triggers-bug-fixer.sh  # naive prompt → bug-fixer
```

## 断言含义（test-helpers.sh）

| 断言 | 含义 |
|------|------|
| `assert_skill_invoked <log> <skill>` | 日志里有 `"name":"Skill"` 且 skill 参数匹配（裸名或 `namespace:名`）|
| `assert_no_premature_action <log>` | 第一个 Skill 调用之前的 tool_use，剔除允许清单后无残留；全程无 Skill 调用也判 FAIL |
| `assert_contains <log> <pattern>` | 日志匹配到 grep 扩展正则 pattern |
| `assert_order <log> <p1> <p2>` | p1 首次出现的行号早于 p2 首次出现的行号 |

每个断言打印 `[PASS]`/`[FAIL]` + 证据行，并累加 `TESTS_PASS`/`TESTS_FAIL`。
`print_summary` 打印计数小结。

## 怎么加新 case

1. 在 `cases/` 下照 `todo-app-triggers-product-spec.sh` 复制一份。
2. 改三处：`PROMPT`（naive 触发语）、`SKILL`（期望触发的 skill 名）、文件名。
3. 通常断言就是 `assert_skill_invoked` + `assert_no_premature_action` 两条；
   需要顺序/包含校验时再加 `assert_order` / `assert_contains`。
4. 无需改 `run-all.sh`——它自动遍历 `cases/*.sh`（除自己）。
5. 想顺手扩 selftest 的脱机覆盖，往 `fixtures/` 加一条 `.jsonl` 样例，
   再到 `selftest.sh` 里加对应的 `expect_pass`/`expect_fail` 行。

## 用例分级与老化

- 分级：测试脚本头部写一行 `# risk: high|medium|low`（紧跟 shebang 那几行内）；没打级的按 high 跑。
- 选级：`run-all.sh` 默认只跑 high，`--level medium` 跑 high+medium，`--level all` 全跑（CI 走 all）；
  被跳过的按级别计数打进汇总行——未执行 != 通过。
- 账本：每次运行把各用例的 `[PASS]/[FAIL]/[SKIPPED]` 追加进 `.claude/evidence/test-ledger.jsonl`
  （目录进 .gitignore，不入库）；没有逐条标记的套件按整套记一行。
- 老化：`node .claude/scripts/test-age.mjs [--min-runs N]` 列「跑过 ≥20 次、一次没红过」的退休候选。
  发版前过一遍删掉；密钥 / 危险命令 / 安装器那三份是地板，从不红也留着。

## 与框架铁律的关系

- 反静默失败：缺 CLI → SKIP 并明示，不假绿。
- 验证即证据：selftest/cases 的判定都基于事件日志的客观 grep 结果，不靠自述。
- 风格仿 `make-release.sh`：`set -eu`、中文头注释、`mktemp`+`trap` 清理、命令失败兜底。
- 脚手架自检类闸（本 selftest：验断言库没坏）不适用 CLAUDE.md「闸长期全绿就砍」——那条针对的是从不产出 FIX_REQUIRED 的**缺陷探测闸**，脚手架自检本就该常绿。
```
