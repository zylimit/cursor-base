# cursor-base 深度剖析

> 分析对象：`D:\code\cursor-base`（Cursor 版治理型 harness）
> 分析目的：为"下一代支持 20-30 万行代码规模项目的 harness"提炼可借鉴实战经验
> 分析日期：2026-07-30

---

## 0. 一句话定性

cursor-base 与它的姊妹框架（cc-base / codex-base…）**根本不是同一类东西**。cc-base 是"从想法到发布"的**产品开发引导流程**（SiteMaster 人格 + 需求/设计/开发/发布阶段机）；cursor-base 是一个**技术中立的仓库治理层（governance harness）**，专为 **200k–300k 行大仓库**设计，核心卖点是"用确定性的 Node 运行时把安全闸门、影响面分析、验证计划、审查回执做成可审计、可测试、可校验的机制"。它几乎没有"引导用户做产品"的成分，而是"约束 AI agent 在大仓库里安全、可验证地干活"。

---

## 1. 定位与运行时

### 面向的 agent
Cursor（`.cursor/` 目录约定：`rules/*.mdc`、`agents/*.md`、`skills/*`、`hooks.json`、`cli.json`、`sandbox.json`、`worktrees.json`）。根 `AGENTS.md` 是 Cursor 读取的"仓库指令"文件。

### 怎么运行 / 技术栈
- **Node.js ≥ 20**，纯 ESM（`package.json:5` `"type":"module"`，`engines.node ">=20"` at `package.json:10-12`）。
- **TypeScript 是"打字稿"而非"编译产物源"**：`tsconfig.json` 用 `"noEmit": true` + `"allowJs": true` + `"strict": true`（`tsconfig.json:9,7,5`）。它**不编译**——TS 仅用于类型检查。
- **真正的运行时是 `.cursor/runtime/harness.mjs`（51,132 字节）**，而 `src/harness.ts`（1493 行，同样 51,132 字节）与它**逐字节 LF-normalized 相同**（我实测 `diff` 确认 IDENTICAL）。也就是说 `.ts` 和 `.mjs` 是**同一份代码的两个副本**：`.ts` 供 `tsc` 类型检查，`.mjs` 供 Node 直接执行（无构建步骤）。
- `src/harness.ts` 里没有任何 TS 类型注解（无 `: string`、无 `interface`）——它是"能通过 strict tsc 的纯 JS"。所以"TypeScript 实现"名不副实：**它是带类型检查关卡的 JS，不是类型化代码库**。
- `scripts/harness.mjs`（185 字节）只是一个 shim：`import { main } from "../.cursor/runtime/harness.mjs"`（`scripts/harness.mjs:2`）。
- **零运行时依赖**（无 `node_modules`；`devDependencies` 只有 `typescript`，`package.json:22-24`）。全部用 Node 内置模块（`node:crypto/fs/os/path/child_process`）。

### 整体架构（6 层，见 `docs/ARCHITECTURE.md:8-14`）
1. **稳定宪法** — 根 `AGENTS.md`，只放不变量（8 行，`AGENTS.md:1-11`）。
2. **情境策略** — `.cursor/rules/*.mdc`，按 topic/path 用 frontmatter `globs`/`alwaysApply` 激活。
3. **角色隔离** — `.cursor/agents/*.md`：只读分析者 vs 有写权限的实现者。
4. **工作流指引** — `.cursor/skills/*`：短 `SKILL.md` 入口 + 一层深 `REFERENCE.md`（渐进式披露）。
5. **可执行检查** — `scripts/harness.mjs` 提供确定性的 doctor/validate/test/affected/verify-plan…
6. **证据契约** — task envelope、completion receipt、review binding、waiver，使交接可审计。

### src/harness 到底实现了什么（一个 CLI + 8 个 hook handler）
一个命令分发器（`main()` at `src/harness.ts:1433`），13 个子命令：`hook / doctor / validate / test / manifest / install / upgrade / uninstall / repo-map / affected / verify-plan / receipt / waiver`（usage at `:1413-1431`）。这就是整个 harness 的"运行时能力"。

---

## 2. 核心机制全清单（机制名 + 作用 + 证据）

### A. 安全闸门（fail-closed hooks，这是全框架最硬的部分）
| 机制 | 作用 | 证据 file:line |
|---|---|---|
| 8 个 Cursor hook 事件接线 | beforeShellExecution / beforeMCPExecution / beforeReadFile / preToolUse / afterFileEdit / subagentStop / stop / sessionStart | `src/harness.ts:25-34`；`.cursor/hooks.json:3-58` |
| **fail-closed 强制**：4 个安全 hook 必须 `failClosed:true` 且必须恰好 1 个、且必须调 checked-in runtime | validate 会因缺失而报错 | `src/harness.ts:1038-1053`；`.cursor/hooks.json:8,15,22,29` |
| **shell 命令三态分类器**（allow/ask/deny，纯正则） | deny 明显破坏性（`git reset --hard`、`rm -rf .git`、`mkfs`、`diskpart`…）；ask 有外部/破坏/提权/安装副作用（push、publish、`npm install`、`pip install`、`kill`、`sudo`、`rm`、动态 `sh -c`/`node -e`/`python -c`…） | `shellDecision()` at `src/harness.ts:703-749`（denyPatterns `:708-717`，askPatterns `:721-742`） |
| **MCP 工具分类器** | 按工具名/入参猜"读/写/破坏"：delete/drop/purge/prod 写操作 → deny；write/create/update/deploy/publish… → ask | `mcpDecision()` at `src/harness.ts:751-775` |
| **敏感文件读取拦截** | `.env`（放行 `.example/.sample/.template`）、`*.pem/*.key/*.p12`、`id_rsa`、`.ssh/.aws/.azure/.gnupg/.kube` 目录 | `sensitivePath()` at `src/harness.ts:692-701`；`beforeReadFile` `:823-829`；`preToolUse` `:830-843` |
| **JSON 解析失败即 fail-closed** | hook stdin 非法 JSON → 抛错、exit 1、stdout 为空（测试验证） | `stdinJson()` at `src/harness.ts:785-795`；test `tests/harness.test.mjs:216-236` |
| **纵深防御声明（诚实性）** | 反复声明 Windows sandbox / ignore / worktree 不是绝对边界 | `AGENTS.md:10`；`docs/GOVERNANCE.md:17`；多处 |
| sandbox 网络策略 | 默认 deny，显式拦截 metadata 端点 169.254.169.254 与私网段 | `.cursor/sandbox.json:6-17` |
| cli.json 权限 allow/deny | 与 hook 冗余的第二道声明式闸（只读 git、`rm/del/push` deny、`.env/.key/.pem` deny） | `.cursor/cli.json:3-28` |

### B. 大仓库导航 / 影响面分析（第二硬核）
| 机制 | 作用 | 证据 file:line |
|---|---|---|
| **module-catalog（模块图）** | 声明式定义模块：id + path globs + `dependsOn` + `verification` + `owners` | `harness/default-module-catalog.json`；schema `harness/schemas/module-catalog.schema.json` |
| **affected（反向依赖闭包）** | 从改动路径 → 直接命中模块 → 沿 `dependsOn` 传递闭包求"受影响模块" | `affectedModules()` at `src/harness.ts:584-615` |
| **verify-plan（按影响选检查）** | 只对受影响模块选它们声明的 verification 检查；**未匹配路径回退到"保守检查"**（conservative fallback） | `verifyPlan()` at `src/harness.ts:654-690` |
| **verification-matrix（检查矩阵）** | 把抽象检查 id 映射到具体命令 + class（format/static/test/integration/build/diagnostic/integrity）+ required | `harness/default-verification-matrix.json`；schema `verification-matrix.schema.json` |
| **repo-map** | 打印声明的模块与依赖边界 | `repoMap()` at `src/harness.ts:627-640` |
| **20 万行规模实测** | 测试生成 24 模块 × 9000 行 = 21.6 万行合成仓库，断言 `affected` <5s 且反向依赖闭包正确 | `tests/harness.test.mjs:844-888` |
| git-diff 驱动的变更路径 | 支持 base commit diff / 未提交 status / untracked，排除 harness-state | `changedPaths()` at `src/harness.ts:160-189` |

### C. 证据契约 / 质量卡点
| 机制 | 作用 | 证据 file:line |
|---|---|---|
| **Task Envelope（派单六字段）** | Goal / Scope / Out of Scope / Existing Pattern / Verification / Escalation | `.cursor/rules/10-task-contract.mdc:8-17`；`docs/PROTOCOLS.md:4-16` |
| **Completion Receipt（回执六字段）** | Status / Changed / Verified / Not verified / Needs review by / Evidence；"只有真跑过的检查进 Verified" | `10-task-contract.mdc:19-28`；`docs/PROTOCOLS.md:19-31` |
| **Review Receipt（diff 绑定审查回执）** | 绑定 base commit + **canonical diff 的 SHA-256**；任何 diff 字节/base/scope/exclusion 变更即失效 | `receipt()` at `src/harness.ts:1288-1348`；`canonicalDiff()` `:191-256`；`binding()` `:258-264` |
| **回执内容完整性哈希** | 回执自身有 `content_sha256`（排除该字段后规范化 JSON 的哈希），篡改任一字段即失效 | `contentHash()` at `src/harness.ts:1222-1226`；`validateReceipt()` `:1236-1286`；test `:263-322` |
| **canonical diff 规范化** | 用 `git diff --binary --no-ext-diff --relative` + untracked 文件哈希拼接 + LF 归一，保证跨机器/跨行尾一致的 diff 指纹 | `canonicalDiff()` at `src/harness.ts:191-256` |
| **Quality Waiver（质量豁免）** | 必须 owner+reason+scope+expiry+compensation 全字段；过期无效；**含 safety/security/secret/push/deploy/production 词即拒绝**（安全不可豁免） | `waiver()` at `src/harness.ts:1350-1388`；`validateWaiver()` `:1390-1407`；test `:352-446` |
| **stale evidence 检测** | afterFileEdit 记 `pending_diff_sha256`，validate 记 `validated_diff_sha256`，stop hook 比对：diff 变了但没重新验证 → 追加提醒 | `afterFileEdit` `:857-873`；`stop` `:886-901`；`validate` `:1076-1086` |

### D. Sub-agent 编排（声明式，非运行时驱动）
| 机制 | 作用 | 证据 file:line |
|---|---|---|
| **6 个专职 agent（能力隔离）** | explorer / impact-analyst（只读发现&影响）、implementer（唯一可写）、reviewer / tester / debugger（只读） | `.cursor/agents/*.md`；`readonly:true/false` frontmatter |
| **readonly frontmatter 硬隔离** | 5/6 agent 标 `readonly:true`，只有 implementer `readonly:false` | 如 `explorer.md:5`、`implementer.md:5` |
| **subagentStop follow-up 注入** | 子 agent 完成且改了文件且 loop<1 → 注入"检查完整 diff+跑影响验证，别扩范围"的 follow-up | `src/harness.ts:874-885` |
| **写测独立性 / 只读角色不 edit** | 契约层强制 reviewer/tester `Changed:none`，tester 不改产品码 | `reviewer.md:21`、`tester.md:5,21`、`docs/PROTOCOLS.md:51-52` |
| **并行读、串行写** | 除非 ownership 显式不相交 + 指定 integration owner | `AGENTS.md:6`；`docs/GOVERNANCE.md:34-36`；`LARGE-REPO-GUIDE.md:28-31` |
| worktree 集成点 | `.cursor/worktrees.json` 声明 setup-worktree 时跑 doctor | `.cursor/worktrees.json:2-4` |

**注意**：编排是**声明式的**（Cursor 自己按 `.cursor/agents/*.md` 调度），harness 运行时**不主动 spawn agent、无 fan-out 脚本、无 workflow 引擎**。cc-base 有 `code-review-fanout.js` 那种主 Agent 写脚本 fan-out，cursor-base 没有对应物。

### E. 记忆 / 状态系统
| 机制 | 作用 | 证据 file:line |
|---|---|---|
| **ledger.jsonl（append-only 审计日志）** | 每次 hook 触发追加一行：timestamp/event/conversation_id/subject/outcome | `appendLedger()` at `src/harness.ts:797-812`；实例 `.cursor/harness-state/ledger.jsonl` |
| **session baseline** | sessionStart 快照 base commit + 当前脏路径，区分"会话前已有改动"与"本会话 agent 改动" | `sessionStart` `:844-856`；test `:238-261` |
| **quality.json（运行态）** | 记 pending/validated diff hash、session_edited_files、preexisting_changed_paths | `afterFileEdit` `:857-873` |
| **harness-state 全部 git-ignore** | `.cursor/harness-state/` 除 `.gitignore` 外全忽略；三层不混（源码/项目态/运行态分离） | `.cursor/harness-state/.gitignore`；`.gitignore:34-37` |

**关键区别**：cursor-base **没有 progress.md 式的项目记忆/决策叙事**（我搜了 progress/feedback/evolution，全无）。它的"记忆"是机器可读的运行态（ledger/quality/baseline），不是给人读的项目历史。**也没有 feedback/进化系统**——cc-base 的 feedback-observer + evolution-engine + EVOLUTION.md 那套自我进化机制，cursor-base 完全没有。

### F. 安装 / 跨平台 / 分发
| 机制 | 作用 | 证据 file:line |
|---|---|---|
| **manifest 驱动安装（sha256 内容寻址）** | `FRAMEWORK-MANIFEST.json` 列每个可安装文件的 LF-normalized sha256+bytes+总 digest | `sourceManifest()` `:340-349`；`manifestDigest()` `:351-353`；实例 `FRAMEWORK-MANIFEST.json` |
| **三态安装（create/update/preserve）** | 目标已存在且非上版内容 → 不覆盖，写 `*.cursor-harness-new` 旁车文件 | `installLike()` `:485-545`；test `:516-541` |
| **幂等 upgrade + 移除废弃文件** | 只更新仍匹配上版 sha 的文件；用户改过的保留；废弃且未改的删除 | `installLike()` upgrade 分支 `:524-535`；test `:587-622` |
| **uninstall 只删未改的托管文件** | 用户改过的标 preserve-modified | `uninstall()` `:547-570`；test `:624-640` |
| **路径逃逸防护（安全安装）** | 拒绝绝对路径、`..`、盘符、UNC、符号链接逃出 target；拒绝管理文件系统根/home | `safeManagedPath()` `:370-414`；`assertSafeTarget()` `:355-363`；test `:678-732` |
| **runtime-sync 校验** | 强制 `src/harness.ts` 与 `.cursor/runtime/harness.mjs` LF-normalized 逐字节相同 | `validateRuntimeSync()` `:926-952` |
| **manifest --check（供应链完整性）** | 校验保存的 manifest digest 与文件一致、各字段无 stale | `manifest()` `:1135-1198`；test `:785-821` |
| 跨平台安装脚本 | `setup.sh`（POSIX）+ `setup.ps1`（PowerShell 7+），都只是转发到 harness install | `setup.sh:8`；`setup.ps1:10-20` |
| LF 归一贯穿 | `.gitattributes` 强制 `*.{json,md,mdc,mjs,sh,ts,yml} eol=lf`；代码里到处 `normalizeLf` | `.gitattributes:1-8`；`normalizeLf()` `:65-67` |

### G. CI / 工程化配套
| 机制 | 作用 | 证据 file:line |
|---|---|---|
| **CI 矩阵回归** | GitHub Actions：ubuntu+windows × Node 20+22，跑 validate/doctor/`node --test`/manifest --check | `.github/workflows/harness-regression.yml:11-45` |
| **确定性测试套件** | 26 个 `node:test` 用例，覆盖安全分类、回执、豁免、影响面、安装/升级/卸载、路径逃逸、20 万行规模 | `tests/harness.test.mjs`（889 行） |
| SECURITY.md / CONTRIBUTING.md / CHANGELOG.md | 报告渠道、内容标准、Keep-a-Changelog | 三文件 |
| `.cursorignore` / `.cursorindexingignore` | 把 generated/vendored/secret/大 fixtures 挡在 agent context 与语义索引之外 | 两文件 |

---

## 3. 独特亮点（纯 prompt+脚本 的 CC 框架很可能没有的）

按"越靠 TS 运行时越独特"排序：

1. **canonical diff 指纹 + diff 绑定审查回执**（`canonicalDiff()`/`binding()`/`receipt()`）。审查结论被密码学绑定到 `base_commit + diff_sha256`；改一个字节，回执自动失效、强制重审。这是把"审查过了吗？审的是这版吗？"从口头承诺变成可验证事实。**纯 prompt 框架做不到**——它只能"提醒 AI 记得重审"。

2. **回执内容完整性哈希（`content_sha256`）**。回执自身防篡改：删/改任一字段，`contentHash` 对不上即无效（test `:297-311`）。把治理产物本身做成 tamper-evident。

3. **affected + verify-plan 的声明式影响面引擎**。module graph + 反向依赖闭包 + 未匹配路径的保守回退，机器算出"这次改动该跑哪些检查"。CC 框架的"影响面"靠 AI 现场推理，不可复现、不可测试；这里是纯函数 + 26 个断言 + 20 万行 benchmark。

4. **manifest 驱动的内容寻址安装/升级/卸载**。sha256 三态（create/update/preserve）+ `.cursor-harness-new` 旁车 + 废弃文件回收 + 路径逃逸防护。CC 框架的 setup.sh 一般是 `cp -r` + 手写冲突处理；这里是可测试、可 dry-run、防覆盖用户改动的确定性安装器。

5. **fail-closed 安全 hook 的机器强制 + 自校验**。不仅有分类器，validate 还强制 hooks.json 里 4 个安全 hook 必须 `failClosed:true`（`:1047-1052`）——**策略自身被策略检查**。非法 JSON 直接 exit-1、空 stdout（deny 语义）。CC 框架 hook 是 shell/ps1 脚本，通常没有"hook 配置被校验器验证"这一层。

6. **quality-waiver 作为一等对象**。豁免有 schema、有过期、有 owner/compensation、**且从数据层禁止豁免安全**（正则拦 safety/secret/push/deploy 词，`:1397-1400`）。把"临时放水"这件事结构化、可审计、可过期——比 cc-base 的 Fast Mode（一个 24h 开关）更细粒度、更可控。

7. **session baseline 区分"会话前脏改动"与"本会话 agent 改动"**（`:844-873`, test `:238-261`）。这解决了大仓库里"验收时怎么知道哪些是 AI 干的"这个真问题。

8. **确定性运行时 + 26 个测试 + CI 矩阵**。治理逻辑本身是被单测和跨平台 CI 守护的软件产品，不是"希望 AI 照做"的散文。

---

## 4. 面向大规模项目（20-30 万行）的能力

这是 cursor-base **明确的设计目标**（README、ARCHITECTURE、GOVERNANCE、CONTRIBUTING 反复写 "200k–300k lines"）。逐项：

| 能力维度 | 有无 | 证据 file:line |
|---|---|---|
| **大 codebase 导航** | ✅ 声明式 module-catalog（path globs + owners + 依赖图）；explorer agent 只读建"证据地图"不 dump 目录 | `harness/default-module-catalog.json`；`explorer.md`；`docs/LARGE-REPO-GUIDE.md:6-14` |
| **影响面/blast-radius 分析** | ✅ `affected` 反向依赖闭包 + impact-analyst agent（required/possible/excluded 分级） | `affectedModules()` `:584-615`；`impact-analyst.md:16` |
| **按影响的分层验证（防全量套件）** | ✅ verify-plan 只跑受影响模块的检查；验证阶梯（syntax→module→dependents→integration→repo-wide） | `verifyPlan()` `:654-690`；`docs/OPERATIONS.md:22-30`；`GOVERNANCE.md:38-47` |
| **上下文管理（防上下文爆炸）** | ✅ 三层策略（宪法/情境规则/skill 渐进披露）+ `.cursorindexingignore` 排除 generated/vendored + "build a context pack, 别 dump" | `docs/ARCHITECTURE.md:5`；`LARGE-REPO-GUIDE.md:16-26`；`.cursorindexingignore` |
| **任务分解** | ✅ plan-change skill 把工作切成"依赖排序、可独立验证"的步骤；plan format 明确 owned paths/顺序 | `plan-change/REFERENCE.md:10-25` |
| **并行编排** | ⚠️ 有原则（并行读/串行写/worktree 隔离 + integration owner），但**无 fan-out 运行时**——靠 Cursor 自身调度 + 契约约束，非框架主动 spawn | `GOVERNANCE.md:34-36`；`LARGE-REPO-GUIDE.md:28-31` |
| **防失控闸门** | ✅ fail-closed 安全 hook + subagentStop/stop follow-up 防"改完不验证"+ loop_limit 防 hook 打转 + stale-evidence 检测 | `.cursor/hooks.json:38-51`（loop_limit 1/2）；`:874-901` |
| **性能实证** | ✅ 20 万行合成仓库 affected <5s benchmark；hooks 只算影响面不扫全源码（明确规约） | `tests/harness.test.mjs:844-888`；`LARGE-REPO-GUIDE.md:41` |
| **共享资产写冲突** | ✅ 明确 lockfile/manifest/generated/migration 算"重叠 ownership"，默认单写者 | `20-large-repository.mdc:14`；`GOVERNANCE.md:35` |

**结论**：大规模能力是 cursor-base 最成熟的维度，且**大部分被单测和 benchmark 固化**。唯一的短板是**并行编排没有运行时**（只有原则，没有 cc-base 那种主 Agent 写 workflow 脚本 fan-out 的机制）。它把"并行"下放给 Cursor 平台 + 人工约束。

---

## 5. 工程化成熟度评估

**相对纯脚本框架，cursor-base 工程化明显更高，且是"真软件工程"而非"文档工程"：**

优势：
- **确定性 + 可测试**：治理逻辑是纯函数（`affected`/`shellDecision`/`canonicalDiff`），有 889 行、26 用例的 `node:test` 套件，覆盖安全/回执/豁免/安装/路径逃逸/20 万行规模。CC 框架的 hook 是 shell/ps1，测试覆盖通常薄。
- **跨平台 CI 矩阵**：ubuntu+windows × Node 20/22（`.github/workflows/harness-regression.yml`）。Windows 路径/junction/CRLF 都进了测试（`:703-732`、LF 归一贯穿）。
- **供应链完整性**：FRAMEWORK-MANIFEST.json + `manifest --check` + runtime-sync，保证分发内容与源一致、runtime 与 src 一致。
- **零依赖**：只用 Node 内置模块，无供应链攻击面，无 `node_modules` 体积。
- **策略自校验**：validate 校验 hooks.json 结构、module-catalog 依赖完整性、runtime 同步——"守护者也被守护"。
- **诚实性文化制度化**："never claim a check ran when it did not"（`AGENTS.md:9`）、"Verified 只放真跑过的"、Windows sandbox 非绝对边界——反复在规则、文档、SECURITY 里强制。

代价：
- **需要 Node 运行时**（CC 框架的 bash/ps1 在更多裸环境能跑；这里强制 Node≥20）。
- **TS 是"假 TS"**：既然 `src/harness.ts` 无任何类型注解、且与 `.mjs` 逐字节相同，`tsconfig` 的价值只剩"strict tsc 当 linter"。这层是**象征性工程化**（详见 §7）。

**评级**：作为"harness 软件产品"，工程化成熟度显著高于典型纯 prompt+脚本框架（有 SECURITY/CONTRIBUTING/CHANGELOG/CI/schema/单测/benchmark/供应链校验）。但成熟度集中在"确定性机制"这一薄核心（~1500 行），**产品开发引导、记忆叙事、自我进化几乎为零**——它是"深而窄"，不是"全而厚"。

---

## 6. 血泪教训 / 决策记录

cursor-base **没有 progress.md / feedback / EVOLUTION.md**（全搜无），git 历史只有 3 个 commit（`a277c7a` refresh manifest / `c7e8b23` add exclusions / `e4ee456` feat: add harness），**没有迭代踩坑叙事**。它的"经验"以两种形式沉淀：

1. **`docs/CAPABILITY-MATRIX.md`（最有价值）**——显式记录从 4 个姊妹框架"吸收什么 / 拒绝什么"：
   - 从 cc-base 吸收：小而稳的宪法、显式委派/交接契约、渐进披露；**拒绝**：provider 专属 hook、品牌人格、私有命令名、对单一模型工具语义的假设（`CAPABILITY-MATRIX.md:7`）。
   - 从 codex-base 吸收：scoped implementation、证据优先验证、diff-aware review；**拒绝**：sandbox 声明强于宿主能保证的、自动发布行为（`:8`）。
   - 从 grok-base 吸收：快速并行研究、独立挑战假设；**拒绝**：无边界铺开、投机式编辑、"speed > verification"（`:9`）。
   - 从 pi-base 吸收：最小可组合工作流、可移植约定、低上下文开销；**拒绝**：环境专属捷径、隐式状态、不透明编排（`:10`）。

2. **规则/文档里反复出现的"防御性教训"**（说明作者踩过或预见的坑）：
   - "Windows sandbox 不是绝对边界"（至少 5 处）——对隔离机制的清醒。
   - "别把广检查当聚焦诊断的替代，也别把聚焦检查当必需集成覆盖的替代"（`GOVERNANCE.md:47`）——验证的两种误用。
   - "diff 变了就作废回执，别默默重生成/声称已批准"（`finish-branch/REFERENCE.md:30`）——stale evidence。
   - "hooks 只算影响面 + 守安全，绝不每次编辑后扫全源码/跑全套件"（`LARGE-REPO-GUIDE.md:41`）——大仓库 hook 性能红线。
   - "measure false positives and hook latency; remove ineffective gates"（`LARGE-REPO-GUIDE.md:49`）——与 cc-base 的"闸靠数据留"英雄所见略同。

---

## 7. 反面教材 / 弱点（专家判断，不盲从）

1. **TS 层是"仪式性工程化"**。`src/harness.ts` 没有一个类型注解，与 `.cursor/runtime/harness.mjs` **逐字节相同**，靠 runtime-sync 校验强制"两份副本手工保持一致"。这意味着：
   - **同一份代码维护两处**（改 runtime 必须同步改 src，否则 validate 报错）——是**自造的负担**，不是收益。
   - `tsconfig` 的真实价值只是"用 tsc --strict 当 JS linter"。要 TS 的好处（类型安全）就该真写类型 + 真编译；要零构建就该老实叫它 JS。**当前状态两头不靠**。
   - **不该学**：别为了"看起来工程化"引入一个不编译、无类型、还要手工双写同步的 `.ts`。要么真 TS（编译产出 `.mjs`），要么纯 `.mjs` + JSDoc。

2. **正则安全分类器的固有脆弱**。`shellDecision` 用正则判危险命令，天然可绕过。ledger 实证显示漏网：`git -C . reset --hard HEAD` 和 `git --work-tree=. reset --hard HEAD` 都被判 `allow`（`.cursor/harness-state/ledger.jsonl:1,7`），因为 denyPatterns 里 `git reset --hard` 前缀被 `-C .` 隔开没匹配上；`bash -lc "rm..."` 只判到 `ask`（`:9`）。**正则黑名单对 shell 是猫鼠游戏**——文档诚实承认"defense in depth 非绝对边界"，但把它当主闸仍有风险。真正的边界应是 OS 级 sandbox/权限，正则只是廉价预筛。

3. **无并行编排运行时**。声称面向大仓库，却把并行完全下放给平台 + 人工约束，没有 fan-out/pipeline 机制。对 20-30 万行、需要多 agent 协作的场景，"只有原则没有工具"是能力缺口。

4. **无自我进化 / 无项目记忆叙事**。没有 feedback→evolution 回路，没有 progress.md。框架靠人工改 catalog/rules 演进。对"持续学习型 harness"是空白（cc-base 在这点更强）。

5. **完全不是产品开发框架**。如果目标像 cc-base 那样"引导用户从想法到发布"，cursor-base 几乎不可用——它没有需求/设计/发布阶段机、没有人格、没有用户对话流。它是"给 AI 上镣铐"的治理层，不是"陪用户造产品"的搭档。**定位不同，别混用**。

6. **module-catalog 需人工维护且易腐化**。20-30 万行仓库的模块图/依赖边界靠手写 JSON，随代码演进易 stale（validate 只校验图自洽，不校验图与真实代码一致）。有 `isDefaultBootstrapConfig` 警告提醒定制（`:966-980`），但没有"从代码自动推导/校验模块边界"的机制。

---

## 8. Top 5 最值得借鉴（排序 + 为什么 + 怎么移植到 CC 单机框架）

### #1 diff 绑定的审查/验证回执（canonical diff hash + content hash）
- **为什么**：把"审查过了吗？审的是这版吗？改完有没有失效？"从 AI 的口头承诺变成密码学可验证事实。这直击大规模项目最大痛点——**证据的可信度**。cc-base 的验收铁律（"五步闸""fresh 证据"）是**靠 prompt 约束 AI 自觉**；cursor-base 用哈希**机器强制**。
- **怎么移植**：给 cc-base 加一个 `.claude/scripts/receipt.sh`（bash/ps1 已有生态），用 `git diff --binary --no-ext-diff | sha256sum` 产 canonical diff 指纹，把 code-reviewer 的结论写成带 `base_commit + diff_sha256` 的 JSON 回执；per-Task review→fix 循环里，commit 前跑一个 gate 比对"当前 diff hash == 回执绑定的 hash"，不符就强制重审。**纯脚本可实现，不需要 Node 运行时**。这能把 cc-base 现有的"reviewer 自报通过"升级为"哈希绑定的通过"。

### #2 affected + verify-plan 声明式影响面引擎
- **为什么**：20-30 万行仓库跑全量检查不可行。用 module graph 反向依赖闭包机器算出"该跑哪些检查"，可复现、可测试、有 20 万行 <5s benchmark。cc-base 现在的影响面靠 implementer/tester 现场推理，不可复现。
- **怎么移植**：加 `harness/module-catalog.json`（模块 path globs + dependsOn + verification）+ 一个 `affected.sh`（`git diff --name-only` → 匹配 globs → 传递闭包）。派 tester 前，主 Agent 先跑 affected 得出"最小验证集"，写进派单包的 Verification 字段。CC 框架已有 tester/派单机制，这只是给它喂"该测什么"的确定性输入。可先用 bash + `jq` 实现，规模大了再考虑 Node。

### #3 Task Envelope + Completion Receipt 的强契约（六字段派单/回执）
- **为什么**：cc-base 已有类似"统一派单包"（Goal/Scope/Out of Scope/Existing Pattern/Verification/Escalation）和"回执信封"——**这正是 cursor-base 从 cc-base 吸收的**（CAPABILITY-MATRIX 明说）。cursor-base 的价值在于把它**写成 alwaysApply 规则 + 每个 agent frontmatter 强制 + "Verified 只放真跑过的"**，比 CC 的散文约束更硬。
- **怎么移植**：cc-base 已有雏形，可借鉴 cursor-base 把它固化为：① 每个 sub-agent 定义里显式列六字段 return 契约；② 一个廉价的 stop-hook 检查回执格式是否齐全（Verified/Not verified 是否分开）。属于"强化已有资产"，非新增。

### #4 manifest 驱动、防覆盖用户改动的确定性安装器
- **为什么**：cc-base 有 setup.sh 的平台参数化（recent commit "加 -win/-mac/-ubt"），但内容寻址 + 三态（create/update/preserve）+ `.cursor-harness-new` 旁车 + 幂等 upgrade + 路径逃逸防护这套，能让"升级框架不毁用户改动"变成可测试的确定性行为。对"框架本身要迭代分发到多个项目"的场景价值大。
- **怎么移植**：给 cc-base 的 setup 加一个 `FRAMEWORK-MANIFEST.json`（各文件 sha256），升级时比对"目标文件 sha == 上版 sha"决定 update/preserve，冲突写旁车。bash 里 `sha256sum` + `jq` 够用。cc-base 的家底保留铁律（"存量资产人工审批才删"）与这个机制天然契合——旁车 + preserve 正是"保留复用+增量补缺"的自动化实现。

### #5 quality-waiver 作为结构化、可过期、安全不可豁免的一等对象
- **为什么**：cc-base 的 Fast Mode 是"一个 24h 全局开关"，粒度粗。cursor-base 的 waiver 是"针对具体检查、带 owner/reason/scope/expiry/compensation、且数据层禁止豁免安全"的细粒度豁免。对大项目"某个 flaky 检查临时放行但留痕、到期自动失效、绝不放行安全"更可控。
- **怎么移植**：把 cc-base 的 Fast Mode 从"全局布尔"升级为"waiver 列表"：`.claude/waivers/*.json`，每条带 scope+expiry+owner，session-rules-banner 播报未过期 waiver；一个校验脚本拒绝含 safety/secret/push/deploy 词的 waiver（正则，bash 可实现）。保留 Fast Mode 作为"批量 waiver"的语法糖即可。

---

## 附：与 cc-base 的关键差异速查

| 维度 | cc-base | cursor-base |
|---|---|---|
| 定位 | 产品开发引导（想法→发布） | 大仓库治理层（约束 AI 安全干活） |
| 人格 | SiteMaster（毒舌 PM） | 无人格（8 行中立指令） |
| 运行时 | bash/ps1 hooks + prompt | Node ≥20 确定性 CLI（~1500 行） |
| 测试 | 框架自测脚本 | 26 用例 node:test + CI 矩阵 |
| 影响面分析 | AI 现场推理 | 声明式 module graph + 纯函数闭包 |
| 审查证据 | prompt 约束"fresh 证据" | canonical diff hash 密码学绑定 |
| 记忆 | progress.md 项目叙事 | ledger/quality/baseline 运行态 |
| 自我进化 | feedback→evolution→EVOLUTION.md | 无 |
| 并行编排 | 主 Agent 写 workflow fan-out 脚本 | 无运行时，仅原则 + 平台调度 |
| 大规模目标 | 未显式 | 明确 200k–300k 行，有 benchmark |
| 安全豁免 | Fast Mode 全局开关 | 结构化 waiver（可过期/安全不可豁免） |
