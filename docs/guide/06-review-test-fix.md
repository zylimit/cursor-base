# 06 审查、测试、修复

这章解决的问题：代码写出来之后，谁来判它对不对、测什么不测什么、坏了怎么修、什么时候该上对抗审查而不是普通审查，以及待审清单与 Stop 闸是怎么把「审过了」变成机器状态的。

读完你能做到：看懂 code-reviewer 报告的三个 Stage 与四态输出，知道哪条 finding 阻断、哪条记残留；给 tester 派一份有风险预算的单子，读懂它回来的运行器输出；把失败分流到 bug-fixer / tester / product-spec-builder；决定一批改动走 code-review、red-blue-review 还是 code-review-fanout；解释 `.claude/.needs-review` 里每一行从哪来、怎么清。

前置：[05 开发精讲](05-development.md) 的 Task 三档与派单包七字段。本章四个环节都派 Sub-Agent：审查 = code-reviewer，测试 = tester，修复走 bug-fixer skill（由 implementer 类 fresh 实例执行），主 Agent 只写单、验收、裁定。

---

## 入门：做什么

### 三件事的入口

| 环节 | 自动触发 | 手动入口 | 执行者 | 产出 |
|---|---|---|---|---|
| 审查 | MEDIUM / HIGH 档 Task 完成后自动进 review → fix 闭环 | `/code-review` | code-reviewer Sub-Agent（opus，只审不改） | 结构化报告，到报告为止 |
| 测试 | 四步走第 2 步「测试完整性」；HIGH 档 Task 补关键逻辑测试 | `/test-builder` | tester Sub-Agent（sonnet，与实现者不同实例） | 可重跑的用例 + 运行器真实输出 |
| 修复 | code-review 报缺陷后；用户报 bug | `/bug-fixer` | bug-fixer skill | 根因 / 改动 / 验证证据，`fix:` 提交 |
| 对抗审查 | 不自动建议 | `/red-blue-review` | 主 Agent 编排 Blue / Red / Judge | RED-BLUE-REVIEW.md 副本 + 三态结论 |

### 三 Stage 各审什么

code-review skill（`.claude/skills/code-review/SKILL.md`）一轮跑 Stage 0 → 1 → 2，范围按派单包 Goal 首行的 Task 档位来：MEDIUM 只跑 Stage 0 + 1，HIGH 跑全三 Stage，没写档位按 HIGH；LOW 档不派本 skill。

| Stage | 问什么 | 审什么 | 停在哪 |
|---|---|---|---|
| 0 机器先说话 | 静态干净吗 | 跑 `node .claude/hooks/static-check.mjs .`；linter 能抓的别让人和模型去挑 | 有错停下列出，修绿后从 Stage 0 重审 |
| 1 做对了没有 | 功能对得上 Spec 与业务吗 | 功能完整性（Spec 每条 + 当前 Phase / Task 交付清单逐项对照，四态输出）；业务含义核对（对照派单包 Business Context）；引导真实性（占位符 / 提示文案指向已实现的行为）；UI 一致性（有设计稿时按 设计稿 → DESIGN.md → Brief → Spec 参照，token 逐项比，八态逐个找） | 有 HIGH 就停在 Stage 1，报告标「Stage 2 未执行」 |
| 2 做好了没有 | 质量与安全 | 代码质量（命名、无 any / @ts-ignore、文件 ≤ 300 行、单一职责、异步有 catch）；测试真实性（用例前提与生产一致、断言方向对、错误态 / 空态 / 边界真走到）；安全扫描（grep `eval(`、`dangerouslySetInnerHTML`、`innerHTML`、`VITE_.*KEY|SECRET|TOKEN`、`/Users/`、`password.*=.*['"]`、`sk-ant-|sk-proj-|ANTHROPIC_API_KEY|OPENAI_API_KEY`、字符串拼接 SQL；npm audit critical）；Spec 漂移（代码里有 Spec 没写的页面 / 路由 / endpoint / 表，标 ⚡）；视觉对比（打开新页面和邻居基准页面实际比） | — |

Stage 1 功能完整性的四态输出：

| 态 | 含义 | 附什么 |
|---|---|---|
| ✅ 完整实现 | Spec 条目有对应代码 | Spec 条目 + 代码位置 + 验证方式 |
| ⚠️ 部分实现 | 缺一部分 | 缺什么 |
| ❌ 未实现 | 没有代码 | 引 Spec 原文 |
| ❓ 需求存疑 | 代码对得上 Spec、Spec 对不上业务 | 反例：情境 → 按 Spec 会怎样 → 业务上应怎样 → 依据 |

需求存疑不算 Stage 1 失败、不阻塞 Stage 2，报告里单列；改需求归 product-spec-builder，审查者不替用户改 Spec。派单没给 Business Context，reviewer 写「未核」——没核不等于没问题。

### HIGH 才阻断，同一轮复核即收口

报告 Priority 三级：

| 级 | 定义 | 处置 |
|---|---|---|
| HIGH | 核心功能缺失或安全问题 | 阻断；派修，修完由**同一轮** reviewer 复核一次即收口 |
| MEDIUM | 辅助功能、UI 细节、代码质量 | 记进 progress.md 残留，随后续 Task 顺手修，不开新一轮 |
| LOW | 增强建议 | 同上 |

「同一轮复核」的意思是不派 fresh reviewer 开新一轮——审一个小 diff 便宜，贵的是仪式。修复路由（skill [修复路由]）：

| 报告结论 | 派谁 |
|---|---|
| Stage 1 失败（功能缺失 / 不符合 Spec） | implementer 补实现 |
| Stage 2 质量与重构 | dev-builder 自修（即 implementer 类实例） |
| Stage 2 缺陷与安全 | bug-fixer |
| ❓ 需求存疑 | product-spec-builder 迭代模式；Spec 改了重审对应条目，没改则关闭存疑并记进澄清记录 |

### Stage 0 的静态闸

`static-check.mjs` 不是 hook：不读 stdin、不注册进 settings，退出码是「有没有红」。识别技术栈并跑 shellcheck / ruff（或 py_compile）/ tsc / `node --check`，全绿 exit 0，任一红 exit 1 并打印错误，工具未装跳过该栈。它排除 `node_modules` / `.git` / `dist` / `build` / `.venv` 等，业务栈扫描排掉 `.claude`，但 JS 语法检查会扫 `.claude` 下框架自己的 `.mjs`（只挡 `.claude/worktrees/`）。

在本仓跑，你会看到：

```bash
node .claude/hooks/static-check.mjs .
```

```
static-check: 全绿（shellcheck node --check(55)）。
```

括号里是跑了哪些工具、检查了多少文件。项目自带静态命令时优先用项目的。

### test-builder：三类与预算

tester 用 test-builder skill（`.claude/skills/test-builder/SKILL.md`）做「务实回归」，不追覆盖率：

| 类 | 内容 | 理由 |
|---|---|---|
| 必须测 | 跨边界契约（导出↔导入往返、序列化↔反序列化、API 请求↔响应）；解析器与数据清洗（多源格式、字段名规范化、表头探测、坏编码）；去重与合并主键；关键边界与异常（null、nan / inf、越界、超大与负数，尤其防御性 return 分支） | 破了是契约级 / 数据级灾难 |
| 推荐测 | 纯函数工具、状态迁移与枚举映射、关键 endpoint 入参校验与回落；有 Playwright 时的核心交互流程 | 性价比高 |
| 明确不测 | UI 像素与快照、三方库自身行为、getter / setter 与无分支透传样板 | 脆、维护重、没信息量 |

用例先从 Spec 取材：「工作现状故事」和「规则与例外」——每条规则一个正例、每个例外一个用例、`[待定]` 对应分支 skip 并注明原因。例外用例最容易抓到反例：例外那次按代码会走错，多半是 Spec 没写清。

预算：测试代码占有效代码 1/3～1/2（按行数），按风险给——高风险五种优先吃预算：泄密、毁数据、装坏别人项目、发错版、签字闸误放行。每个测试文件头标 `# risk: high|medium|low`，跑测顺序与老化退休按它取舍。

### 失败三分流

测试红了先看失败信息、Spec 契约和 Business Context，别条件反射改测试迁就代码：

| 判定 | 特征 | 派谁 |
|---|---|---|
| 代码错 | 测试发现真 bug | bug-fixer 修业务代码 → 重跑 |
| 测试错 | 断言 / 夹具写错 | tester 修测试 → 重跑 |
| Spec 错 | 断言按 Spec 写没错，但与 Business Context 的规则 / 例外矛盾，或它是 `[推断]` 条目而现场证据相反 | 报「需求存疑」+ 反例，回流 product-spec-builder；这条用例先 skip 并注明原因，既不改断言迁就代码，也不迁就 Spec |

tester 的 Non-goal：不判「功能正确」（只报运行器输出与覆盖缺口）、不修业务代码、不为凑绿放宽断言。

### bug-fixer：定位与修复

bug-fixer skill（`.claude/skills/bug-fixer/SKILL.md`）两个入口：用户直接报 bug（修完建议 `/code-review` 验证）；code-review 报缺陷（主 Agent 传入失败项，修完重派 code-review 从 Stage 1 起）。

路径：

1. **先定预期**：进 stack trace 之前先把「期望行为」定下来，来源三选一——Spec 条目（引编号与标记）、派单包 Business Context 的规则与例外、用户原话。来源标 `[推断]` 或没人说得清的，先问一句「这个行为在业务上应该是什么」，修「正确的 bug」比修不好更贵。
2. **收证据**：完整报错与 stack trace（不截断）、复现步骤、环境、最近代码变更（git log / diff）、日志。
3. **假设**：一次最多 3 个，按可能性排序，每个配验证方法；被否定就记原因，不重复验。
4. **修复**：一次一个逻辑点 → `tsc --noEmit` 零错误 → bug 不再复现 → 相关功能回归正常。失败就回退，重新假设。
5. **汇报**：根因 / 改动 / 验证证据（编译 + 功能 + 回归）/ 是否 commit（`fix:` 前缀）。

多组件系统先在每个边界（前端 / API / 数据库 / 第三方）加诊断确认问题在哪一层，不在猜的那层修。服务类 bug 先清占用端口的残留进程，多实例是很多灵异 bug 的根因。

---

## 进阶：为什么、怎么判

### 关键条件验证法：审查怎么不变成读后感

code-review 的 [关键条件验证法]：每个风险点不直接下「有问题 / 没问题」，先拆成具体可判定的验证问题——「X 处数组访问是否越界」「第 N 条 Spec 的行为是否真的匹配」——能用一条命令或一段代码回答的才算问题，「代码质量好不好」不算。逐条独立核验，每条挂一个外部证据：grep 命中行 / 测试运行器输出 / 编译输出 / Spec 原文比对。核不到证据的疑点降级为「待确认」，不算实锤。

配合 code-reviewer agent 的对抗立场：默认有罪，构造能让它出错的输入 / 边界 / 并发 / 异常路径并**真去复现**，没真攻过就报「通过」= 失职。攻的对象包括 Spec 本身。

### 「不确定就不报」

skill [输出报告] 里的一句话决定了报告的信噪比：只报影响正确性或既定需求的缺口。不确定就不报，误报侵蚀信任；风格偏好、「依赖特定输入的潜在问题」一律不报——被要求找缺口的审查者总能找出点什么，追每一条换来的是多余抽象层、防御代码和为不可能情况写的测试。

这和 Priority 三级配合：HIGH 必须是「核心功能缺失或安全问题」这种能指到 file:line 的硬伤；模糊的疑虑要么降级 MEDIUM / LOW 记残留，要么不写。

### 测试量与分级怎么落地

CLAUDE.md [开发测试规则] 把预算说得更细：密钥与危险命令闸、安装器与 manifest、发布装配这类「坏了会泄密、毁数据、装坏别人项目」的可到 1/2；引擎子命令只守退出码契约加一条真实场景；提醒类 hook、档位、工具脚本各留一两条；不做全量覆盖。低了补、高了删。

分级与老化：日常只跑 `# risk: high`，`run-all --level medium|all` 才跑其余、CI 跑 all；每次运行记进 `.claude/evidence/test-ledger.jsonl`，`test-age` 列出跑过 20 次以上从未失败的作退休候选，发版前过一遍删掉（密钥 / 危险命令 / 安装器三类地板用例除外）。报「绿」须附运行清单（跑了哪些文件、各自绿 / 红 / 跳过原因）。

本地绿只是必要条件：仓库有 CI 的，推送后另跑 `gh run list` 读 CI 自己的结论再报完成，读不到写「未知」——本地默认只跑 high 档、CI 跑 all，两边跑的不是同一套。

### 测试基建从零开始

无基建时 tester 先按 `templates/test-scaffold.md` 最小化 scaffold，主 Agent 验「空套件能跑」再继续。后端 pytest：`api/tests/test_*.py`，`pytest.ini` 三行（`testpaths = tests`，用 pytest-asyncio 才加 `asyncio_mode = auto`），跑 `cd api && python -m pytest -q`。前端 vitest：就近 `*.test.ts` 或 `web/src/__tests__/`，`vitest.config.ts` 一行 `test: { environment: "node" }`（测组件改 jsdom），跑 `cd web && npm run test`。不引入覆盖率门禁、不接 CI，除非用户要求。

数据库依赖优先构造数据喂纯函数，不起真库；必须真库时用最小 fixture + 测试库，绝不碰生产或基线数据。测试跑真实 app 必须用独立数据目录。

### 修复熔断

bug-fixer [修复熔断]：同一个 bug 累计 3 次改完仍不绿（锁定它的红测试没转绿）即熔断，不许第四次打补丁——三次没好多半是根因没找对。熔断动作：回到根因层质疑此前的设计假设，把证据重新收一遍；向主 Agent 升级时说明试过哪几种修法、各自为什么没成、当前怀疑卡在哪，并把红测试一并交出去。「同一 failure 连续两轮修复没产出新证据」同样算熔断信号。

主 Agent 这侧对应 [05 开发精讲](05-development.md#升级阶梯blocked--needs_context-怎么办) 的升级阶梯：换 bug-fixer 路线是第三步，再不通升级用户。

### red-blue-review：Blue / Red / Judge

`/red-blue-review` 是发版 / 合并前的对抗闸（`.claude/skills/red-blue-review/SKILL.md`）。定位：比 code-review 三阶段更对抗（红队默认证伪、专挑死角），比 code-review-fanout 省（不走 Workflow、不并行、不吃约 15 倍 token）。不自动建议，你说「红蓝审查」「对抗审查」才调。

三遍：

| 遍 | 谁 | 做什么 | 作数吗 |
|---|---|---|---|
| Blue 自证 | implementer（fresh） | 逐条自证：改了什么 / 验证了什么 / 证据在哪（file:line） | 不作数，只作红队靶子 |
| Red 攻击 | code-reviewer（fresh，独立于 Blue） | 四 lens 逐个往死里挑：correctness（逻辑 / 边界 / 与既有规则矛盾）、security（注入 / 越权 / 泄露 / 破坏性操作无防护）、release（打包 / 版本 / 产物缺漏 / 回滚难 / 漏排除私人内容）、windows（PowerShell 5.1 / 路径 / CRLF / BOM、GBK） | 每个 finding 必须附复现路径或 file:line，否则不算；挑不出如实报「该 lens 无 finding」 |
| Judge 裁定 | 主 Agent 自己，不派子 Agent | 逐条采信（证据成立）/ 驳回（证据不足、复现不出，写明理由） | 只看证据不看自述 |

三态结论：

| 结论 | 含义 | 下一步 |
|---|---|---|
| ACCEPT | 无采信的硬伤 | 放行，可 commit / 合并 / 发版 |
| FIX_REQUIRED | 有采信的须修问题 | 主 Agent 按清单（每条 file:line + 修复建议）派 bug-fixer / implementer 修，修完重跑本流程 |
| NEEDS_MORE_EVIDENCE | 证据不足以判 | 补测试 / 补复现，回到对应遍重判 |

操作步骤：

```bash
# 第零步：拷模板到 per-review 路径（skill 目录那份永远保持空，就地填会污染模板并被 make-release 打进包）
REPORT=/tmp/red-blue-review-<标识>.md
cp .claude/skills/red-blue-review/RED-BLUE-REVIEW.md "$REPORT"

# 第一步：凑证据包（审查范围 / 改动清单 / 删除审计 / 新文件 / 完整 diff）
bash .claude/skills/red-blue-review/red-blue-review.sh [BASE] [HEAD]   # BASE 默认最近 tag，HEAD 默认 HEAD
bash .claude/skills/red-blue-review/red-blue-review.sh --working        # 审未提交工作树
```

BASE / HEAD ref 无效会非零退出 + stderr 报错，不会静默产空包；见到报错先核对参数。家底审查时删除审计重点看：diff 里删除行落在 hook / skill / CLAUDE.md / agents 上，确认是不是误删既有规则。

Blue 与 Red 都把内容直接写进 `$REPORT`，回传只给「已写入 $REPORT」+ 一句话摘要——产物文件才是交付，主 Agent 验收读 `$REPORT` 不读回传措辞。

驳回不等于扔掉：Red 攻死角攻出来的东西，一部分是缺陷，另一部分是「原来这个域是这样的」——后者按缺陷判必被驳回，却恰是该留的领域线索，依据齐了派 domain-recorder 收录，没齐记进 progress.md 残留。

**何时用它而不是 code-review**：

| 场景 | 用哪个 |
|---|---|
| 每个 MEDIUM / HIGH Task 完成后 | code-review（per-Task 闭环，自动） |
| 发版 / 合并分支前，对一批已成型的改动 | red-blue-review |
| 改了家底（hooks / skills / CLAUDE.md / agents） | red-blue-review（`dev-workflow-details.md` 建议过一遍） |
| 改动面大、要多维度并行 + 对抗验证，且愿意付约 15 倍 token | code-review-fanout（需 opt-in） |

Windows：`red-blue-review.sh` 不是 hook，不会被 `setup.ps1` 转 `.ps1`，须在 Git Bash 内跑。

### code-review-fanout：Workflow，需 opt-in

`.claude/workflows/code-review-fanout.js` 是已落地的 Workflow 脚本：多维 fan-out 审查 + 逐条 CoVe 多视角对抗验证。默认三维度 correctness / security / spec 各派一个 code-reviewer 出 findings（带 `verificationQuestion` 与 `evidence` 句柄的 schema），每条 finding 再派一个 code-reviewer 用不同视角 lens（correctness / repro / security）对抗核验，默认怀疑，证据不足即 `isReal=false`；只留被独立核验确认为真的缺陷，回传「结论 + 证据句柄」给主 Agent 定夺。

它受 `.claude/rules/workflow-orchestration.md` 的成本闸门约束：多 Agent 耗 token 约 15 倍（Anthropic 实证），**必须用户显式 opt-in**，不静默触发——达到 fan-out 规模时主 Agent 先提议、用户确认再跑。同一 workflow 里同型 agent 共享 prompt cache，实际成本低于裸 15 倍上限，但 opt-in 闸不变。单 1-2 处改动用 Task 直派更划算。

三铁律不动：主 Agent 仍是唯一编排者（workflow 是主 Agent 写的脚本，`workflow()` 嵌套仅一层）；验收判断权留主 Agent；写测独立性靠 `agent()` 每次 fresh + 不同 agentType。

### 待审清单与 stop-gate

`.claude/.needs-review` 是审查状态的机器载体，两个 hook 一写一读：

**写：`mark-review-needed.mjs`**（PostToolUse on Edit|Write，recorder 类，三档都 on——fast 下也记，债留到撤销时由 stop-gate 提）

- 项目业务代码被编辑 / 创建后，把文件相对项目根的路径登记一行；按文件登记，不是全局布尔。
- 豁免基于相对项目根路径并顶层锚定：仅根级 `tools/` 与 `.claude/` 框架自身豁免，不会误伤 `src/tools/`、`packages/x/tools/`。
- 登记前归一路径（反斜杠转正斜杠 + 折叠 `./..`），折完出根的不登记；Windows 8.3 短名与 symlink 两侧同过 `realpathSync.native` 再判是否在项目内。
- 读改写加锁串行（`.needs-review.lock`，陈旧锁可回收），防并发 PostToolUse 互相截断。
- 恒 exit 0，记账 hook 不拦工具。

**读：`stop-gate.mjs`**（Stop，guard 类）

- 去掉空行与 `clean` 行后仍有文件 = 有欠账；只剩 `clean` / 全空 / 不存在 = 放行并清理状态文件与锁。
- 档位：off 静默放行；**advise（fast / standard 档，默认档就是它）照判照记账，但出 `systemMessage` 提醒而不是 `decision: block`**，也不动 `.needs-review` 与连拦计数；block（strict 档）真拦。
- 连拦上限：`.claude/.stop-gate-strikes` 记同一待审清单（按排序后文件列表的 sha256 指纹）被连拦的次数，同一清单连拦 3 次后第 4 次放行并醒目提示欠账仍在；清单一变即清零重计。advise 档不累计。
- fail-closed：闸自身出错（含状态文件读不出）绝不静默放行，一律拦停。
- 大仓启用（catalog 存在）后，清单清空时另跑 `harness.mjs receipt verify`：rc 4（代码越过所有已审回执）强制重审；契约外退出码按引擎异常拦停并走同一套三振。

默认档只提醒的理由写在文件头：放行契约本就是被约束方自己 `echo clean`、外加三振自动放行，本质是提醒；2026-09-03 一天拦 38 次、单小时 12 次，纯空转。

放行契约：审查通过后

```bash
echo clean > .claude/.needs-review
```

它同时是 `release-gate` 的前置（见 [07 发布与部署验收](07-release.md)）：待审清单未清，`/release-builder` 直接被拦。

---

## 精通：内部机制与边界

### code-reviewer 为什么是 opus 且带记忆

`.claude/agents/code-reviewer.md`：`model: opus`、`memory: project`、`disallowedTools: NotebookEdit, Task`。只审不改是铁律——项目文件一个字都不许动，Edit / Write 只用于维护自己的 agent memory：开审前查记忆里本项目的高发缺陷模式与薄弱模块列入本轮重点，审完把新模式浓缩写回，记模式不记流水账、单条一行。tester 同样 `memory: project`，写测前查 flaky 区、历史回归点、基建约定，跑完把易碎边界写回。

这两份记忆是 agent memory，与用户 memory、feedback 三套各有边界（`.claude/rules/memory-systems.md`）；决策 / 约束 / 完成事项只认 progress.md，不因任何 memory 存了什么而豁免。

### 审查也审 Spec

code-review Stage 1 的「业务含义核对」与 tester 的「Spec 错」分流、bug-fixer 的「需求存疑」是同一条通道的三个入口：代码对得上 Spec、Spec 对不上业务。判据来自派单包 Business Context——为什么做、谁受益、规则与例外。所以 Business Context 不许 N/A 不只是为了实现者，也是为了让审查者有另一半判据：Spec 说这个字段要出现，口径说它该按什么算，只拿一半判据审出来的是形不是实（`domain-rulings.md` [四个读取时机] 审查时）。

### 三个审查形态的成本与对抗度

| | code-review（Task 直派） | red-blue-review | code-review-fanout |
|---|---|---|---|
| 派几个 Sub-Agent | 1（HIGH 档再加 tester） | 2（Blue implementer + Red code-reviewer） | N 维度 + 每条 finding 1 个 verify |
| 对抗度 | 对抗立场、关键条件验证法 | 红队证伪、四 lens、Judge 只看证据 | CoVe 逐条多视角核验 |
| token | 基线 | 约 2-3 单 | 约 15 倍 |
| 触发 | 自动（按档） | 手动 | 手动 + 用户 opt-in |
| 产物 | 报告 | `$REPORT` 三态 | schema 化 confirmed 清单 |

### 闸靠数据留

CLAUDE.md：某闸长期全过 / 全绿、从没产出过 FIX_REQUIRED 或红，就简化或删掉；加闸要能说出它挡住过什么。`stop-gate` / `tdd-gate` 的 advise 档照样写 `gate-block.log`（前缀 `[advise]`），就是为了让 `gate-audit` 统计得出「提醒过多少次」，不至于把唯一守着某条规则的闸当死闸删掉。「验证验证者」那类机制（突变矩阵）默认不进发版链与高频路径。

### 边界

- code-reviewer 不判「可合并 / 可发布」，tester 不判「功能正确」，bug-fixer 不替用户改需求——三个都只交证据，结论归主 Agent。
- 审查者不扩大范围到派单外的文件；tester 不修被测的业务代码；bug-fixer 一次只改一处。
- red-lock 只给线上行为的 bug 与核心解析器 / 契约缺陷，边角输入不锁；`tdd-gate` 在任何档都只提醒不拦（strict 除外）。
- fast 档下不自动派 tester / code-reviewer、不进 per-Task 闭环，用户显式要求时照做；`static-check` 之类廉价闸不在跳过范围。
- 主 Agent 收到审查意见不表演式认同（「你说得对 / 这就改」），要么复述技术要求确认理解，要么问清，要么有理由顶回去，行动优先于表态。

---

## 常见坑

| 坑 | 表现 | 怎么办 |
|---|---|---|
| 报告没写档位 | reviewer 按 HIGH 跑了全三 Stage，MEDIUM Task 多花一倍 | 派单包 Goal 首行写档位 |
| Stage 0 没跑就进 Stage 1 | 人和模型在挑 linter 能抓的错 | 先 `node .claude/hooks/static-check.mjs .`，红了修绿再审 |
| 「其余看起来正常」 | 报告笼统收尾 | Spec 每条都要被检查到，四态逐条 |
| 「通过」没证据 | 没有编译输出 / API 响应 / 数值对比 | 没证据的通过等于没审查，退回 |
| MEDIUM finding 开新一轮 | fresh reviewer 又审一遍 | 同一轮复核一次即收口；Medium / Low 记残留 |
| 需求存疑当缺陷修 | 修成 Spec 说的行为，例外那次走错 | 停，报反例回流 product-spec-builder |
| 派单没给 Business Context | reviewer 写「未核」 | 没核 ≠ 没问题，补 Business Context 重审业务含义 |
| 测试为凑绿放宽断言 | 用假前提或不可达输入把缺陷盖成预期 | Stage 2 测试真实性抽查用例前提与生产一致、断言方向 |
| 存在但没跑的测试 | 目录里有 test 文件，报告说「有测试」 | 算缺；证据是运行器输出 |
| 贴上一条消息的运行输出 | 「前面跑过了」 | 时效性：贴的输出必须是同一条消息里刚跑的 |
| 测试写到生产库 | 跑真实 app 的测试没用独立数据目录 | 测试隔离铁律；临时目录收尾删掉 |
| 本地绿就报完成 | CI 跑 all 红了四次才发现 | 推送后 `gh run list` 读 CI 结论，读不到写「未知」 |
| 第四次打补丁 | 同一 bug 改了三次还红 | 修复熔断：回根因层重收证据，带红测试升级 |
| 在猜的那层修 | 多组件系统直接改前端 | 每个边界先加诊断确认在哪一层 |
| 端口残留 | 服务类 bug 灵异复现 | 先清占用端口的残留进程 |
| 就地填 RED-BLUE-REVIEW.md | skill 目录模板被污染，随 make-release 进包 | 先 `cp` 到 `/tmp/red-blue-review-<标识>.md` 再填 |
| Red finding 没有 file:line | 「感觉这里可能有问题」 | 不算 finding；Judge 直接驳回 |
| 靠回传消息承载 findings | 子 Agent 回传空壳 | 产物文件 `$REPORT` 才是交付，主 Agent 读文件 |
| red-blue-review.sh 参数错当没东西可审 | ref 无效 | 脚本会非零退出 + stderr 报错，先核对 BASE / HEAD |
| 静默跑 fanout | 一批改动 15 倍 token 没人批 | Workflow 必须用户显式 opt-in |
| `.needs-review` 混着 clean 与路径 | 以为 clean 了 | 优先级反转：去掉 clean 行后仍有文件就是有欠账 |
| 手删 `.needs-review` 想绕闸 | strict 档删不干净时 strikes 残留 | 用 `echo clean > .claude/.needs-review`，让闸自己清理状态与锁 |
| 三振放行当通过 | strict 档第 4 次放行了 | 那是「欠账带着放行」，systemMessage 会点名欠账仍在，条件允许尽快审 |

下一章：[07 发布与部署验收](07-release.md)——为什么发布只能你亲自敲、release-gate 查什么、部署后主 Agent 独立核查三件套。
