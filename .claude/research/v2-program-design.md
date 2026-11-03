# cc-base v2 总纲——把规则编译成命令，再把「靠自觉」换成「机器拦」

> 产出日期：2026-09-01。分支 `feat/v2-engine`。
> 触发：用户要求「深度学习 dsh-base，不惜成本最大化重构 cc-base，全力超越 dsh-base」，并追加「不能盲从，主动上网找优秀实践，最大化引入但不许凑数」「多关注 codex-base / cursor-base / ccb-base」。
> 本文是后续所有派单包的引用底本。每条主张都带证据句柄；没有证据的不写进来。

---

## 一、定位：超越的确切含义

dsh-base（zylimit/dsh-base，MIT，同作者，2026-08-31 建仓，25 commits）是 DeepSeek Harness 的开发脚手架。它的核心主张写在 `AGENTS.md:11`：**每条规则要么被一个具名命令强制，要么显式标注 prompt-only**。40 个 `dsb` 子命令把宪法编译成了可执行物。

cc-base 的 harness 现有 15 个子命令，是 dsb 的**真子集**（唯一多出的是 `adapters`）。单看引擎，cc-base 落后一整代。

但 dsh-base 自己的 `.dsh/docs/CAPABILITY-MATRIX.md` 是一份自曝短板的清单——52 行里 8 行判 **Rejected**，理由高度一致：

| 矩阵行 | 被拒能力 | dsh 的理由（原文摘要） |
|---|---|---|
| #35 | Dev-service supervisor | dsh has no daemon and no hook to reap processes |
| #37 | Stop-gate with strike breaker | dsh has no hook system, so nothing can intercept a tool call and halt the agent |
| #39 | No-direct-code guard | Blocking the write tool needs a hook; dsh has none |
| #46 | Skill behaviour regression | 运行模型跑 fixture 不确定、无固定 oracle |
| #47 | Checked-in compiled runtime artifact | 需要自己的 parity gate |
| #50 | Hooks (pre/post tool events) | **dsh has no hook system. Anything described as intercepting a tool call would be fiction** |
| #51 | Project settings file | dsh has no project settings file |
| #52 | Output styles | dsh has no output-style mechanism |

**这 8 条里有 6 条，cc-base 全都有原生承载。** 所以「超越」不是把 dsb 抄一遍再多堆几个子命令，而是两件事叠加：

1. **补齐引擎**：吃下 dsb 那 25 个 cc-base 没有的子命令（它们是被验证过的 M 层）。
2. **把 P 变 M**：dsh 宪法里凡是标 prompt-only 的规则，cc-base 用 Claude Code 原生 hook 事件做成机器强制。这是 dsh 结构上拿不到的。

第 2 条才是超越。第 1 条只是追平。

---

## 二、Claude Code hook 面盘点（官方文档核证，2026-09-01）

来源：<https://code.claude.com/docs/en/hooks>、<https://code.claude.com/docs/en/changelog>、<https://code.claude.com/docs/en/agent-teams>。

官方现有 30+ 个 hook 事件。cc-base `.claude/settings.json` 目前只用了 9 个：
`UserPromptSubmit` / `UserPromptExpansion` / `SessionStart` / `PreToolUse` / `PostToolUse` / `PreCompact` / `Notification` / `Stop` / `SubagentStop`。

**未用、且直接对应治理需求的事件**（含官方给出的输入字段与可返回的决策字段）：

| 事件 | 关键输入字段 | 可返回 | 对 cc-base 的治理价值 |
|---|---|---|---|
| `PostCompact` | `compaction_ratio` | `additionalContext` | **压缩边界后回注不变量**——见 §四.1，本轮最高价值的一条 |
| `SubagentStart` | `agent_id` `agent_type` `prompt` | `systemMessage` | 记派单账：谁被派了、派了什么。作者身份账本的写入点 |
| `SubagentStop` | `agent_id` `agent_type` `last_assistant_message` `duration_ms` | **`permissionDecision:"deny"`** | 机器解析六字段回执信封，不合格直接拦住不许收工 |
| `TaskCompleted` | `task_id` `task_name` | **`permissionDecision:"deny"`** | 没有 PASS 门 + 新鲜回执，不许标完成 |
| `TaskCreated` | `task_name` `task_description` | **`permissionDecision:"deny"`** | 任务信封六字段不全，创建即拒 |
| `InstructionsLoaded` | `file_path` `reason`（`session_start`/`nested_traversal`/`path_glob_match`/`include`/`compact`） | `systemMessage` | 指令文件当**载入时**扫，不是等 commit 才扫 |
| `ConfigChange` | `source` `changed_settings` | **`permissionDecision:"deny"`** | 存量资产铁律机器化：改 settings/skills 当场拦 |
| `PermissionRequest` | `permission_scope` `request_id` | **`decision: allow/deny/deferToUser`** | 审批三档（LOW/MEDIUM/HIGH）从散文变成判定 |
| `PermissionDenied` | `reason` | `retry:true` | 被拒后的正确升级路径 |
| `PostToolBatch` | `tool_calls[]` | **`permissionDecision:"deny"`** | 整批工具调用后、下一次模型调用前掐断 |
| `PostToolUseFailure` | `error_message` | `additionalContext` | 连败计数（fail-streak → 强制转根因） |
| `SessionEnd` | matcher `clear/resume/logout/...` | — | 收尾：retention 修剪、账本落盘 |
| `Setup` | matcher `init/maintenance` | — | `--init-only` 一次性接入，CI 用 |
| `FileChanged` | `file_path`（字面名匹配，无正则） | `additionalContext` | 盯 catalog / CLAUDE.md 落盘变化 |
| `WorktreeCreate` / `WorktreeRemove` | `worktree_path` `base_branch` | 可改 path / 可 abort | 并行 implementer 的隔离承载 |
| `PreModelSwitch` | `from_model` `to_model` | **`permissionDecision:"deny"`** | 关键阶段禁止降档 |
| `StopFailure` | `error_type`（`rate_limit`/`overloaded`/…） | `terminalSequence` | API 错误与「任务失败」区分开，不误判 |

另外两条已存在但 cc-base 未吃满的语义：
- `Stop` 与 `SubagentStop` 均带 `last_assistant_message`（**直接读最后一条助手消息，不必解析 transcript**）——证据法的「禁用『应该/大概/看起来』」可以在这里做成真检测。
- `PreToolUse` 可返回 `updatedInput`（改写工具入参），不只是 allow/deny。

**边界（必须知道，不许当无限次的闸）**：`Stop` hook 同 turn 连拦 8 次后 Claude Code 强制放行（防死循环）。cc-base 已把 `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` 提到 25（`settings.json:25`），且 stop-gate 自身三振熔断先触发，正常碰不到；但这层「泄闸」真实存在。

**Agent Teams（实验特性，默认关）**：`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 开启后，**Claude 自己命名的 subagent 会变成 teammate**，团队可能在你没要求时自己形成。cc-base 的扁平编排铁律与之冲突。**结论：显式在 settings.json 里把该变量设为 `"0"`**，把「不会意外起队」变成配置事实而不是运气。这是一条防御性发现，不是新增能力。

---

## 三、引擎缺口：dsb 40 vs harness 15

`dsb` 全量子命令（`node .dsh/base/dsb.mjs help` 实跑）：
`adr-check agents-lint arch-check arch-trend archive attributes budget catalog catalog-lint cochange context-pack diff-hash doctor dod fast fitness fleet gate gate-audit help impact init invariants ledger recap receipt release retention review review-pack risk rules-audit selftest skills-lint spec spec-lint sync-check task trace verify waiver`

cc-base 已有：`doctor diff-hash selftest catalog-lint impact context-pack receipt verify waiver attributes arch-check fitness adapters adr-check arch-trend`

**缺 25 个**，按目标模块与 Phase 归置：

| 子命令 | 作用（dsb 语义） | 目标模块 | Phase |
|---|---|---|---|
| `gate` | verify + 证据落盘（每 check 的 stdout/stderr 存文件 + sha256）+ planHash + 账本追加 | `lib/quality.mjs` + `lib/evidence.mjs` | P1 |
| `ledger` | 哈希链账本 `chain=sha256(prev+NUL+contentHash)`，链断 = 此前全部验证按未证明处理 | `lib/evidence.mjs` | P1 |
| `gate-audit` | 列出「从未失败过」的 check——没拦过任何东西的闸是成本+假安全 | `lib/evidence.mjs` | P1 |
| `retention` | 按龄/数修剪证据与上下文包，**账本引用到的文件永不删** | `lib/evidence.mjs` | P1 |
| `risk` | 状态衰变扫描：链断 / 过期 waiver / 未接线属性 / 连败 / fast-mode 欠债 | `lib/evidence.mjs` | P1 |
| `task start\|status\|complete` | 六字段信封机器校验；`complete` 四项阻断条件（PASS 门绑当前 diff、新鲜 ACCEPT 回执、链完好、验证计划非空） | `lib/task.mjs` | P1 |
| `budget` | 爆炸半径：maxChangedFiles / Lines / ModulesTouched / NewFiles。**是拆分信号不是禁令** | `lib/task.mjs` | P1 |
| `spec-lint` | EARS 规格校验：`NOT_NORMATIVE`(缺 SHALL) / `NO_TRIGGER`(缺 WHEN\|WHILE\|IF\|WHERE) / `NO_METRIC`(NFR 无可测目标) / `NO_ACCEPTANCE` / `PLACEHOLDER` | `lib/spec.mjs` | P2 |
| `trace` | 需求 id ↔ 测试引用覆盖率，悬空 id 报错 | `lib/spec.mjs` | P2 |
| `spec` | 按变更路径取相关需求的预算化视图（`--paths` / `--all` / `--budget`） | `lib/spec.mjs` | P2 |
| `dod` | 所有静态治理检查一次跑完 | `harness.mjs` 编排 | P2 |
| `review start\|blue\|lens\|verdict\|backlog` | 结构化分歧评审引擎：分阶段 lens、每 finding 必须带 `file:line` 或复现路径、裁决由引擎算不由人断言、轮次上限、backlog 可背不可删 | `lib/review.mjs` | P3 |
| `review-pack` | 评审证据包，**删除文件单独成节**（评审者系统性漏看删了什么） | `lib/review.mjs` | P3 |
| `recap` | 从 artifact 派生的预算化现状（位置/钉住项/在办/P0-P1/近期决策/风险/衰变），**不读压缩摘要** | `lib/memory.mjs` | P4 |
| `invariants` | 重新派生不可交易集 + 活跃状态，~1200 字符预算 | `lib/memory.mjs` | P4 |
| `archive` | 账本/进度超预算时归档最老条目并留指针，**归档不改写** | `lib/memory.mjs` | P4 |
| `sync-check --staged` | 三文件同步机器判定：`MEMORY_BEHIND_CODE` / `SPEC_WITHOUT_CHANGELOG` | `lib/memory.mjs` | P4 |
| `skills-lint` | skill frontmatter 结构校验（畸形 frontmatter 会让整个 skill 被静默丢弃） | `lib/scan.mjs` | P5 |
| `agents-lint` → **`claude-md-lint`** | 高风险模块的**嵌套 CLAUDE.md** 必须有 Purpose/Boundaries/Invariants/Verification 四节 | `lib/scan.mjs` | P5 |
| `rules-audit` | 数宪法里有多少条规则指向真实执法点——量化 M/P 比例 | `lib/scan.mjs` | P5 |
| `fast on\|off\|status` | fast mode 当**可偿还债务**：必填 reason、有上限窗口、保护属性永不跳、跳过的记 SKIPPED 且该记录不能关闭任务 | `lib/quality.mjs` | P5 |
| `cochange` | 用共同变更频率判边界画得对不对（高耦合无声明边 = 边界错） | `lib/graph.mjs` | P6 |
| `fleet lint\|impact\|status\|recap` | 多仓契约层：`provides`/`consumes`、契约不可原地改版、`coordinationCost` | `lib/fleet.mjs` | P6 |
| `init` / `catalog --discover` | **自动生成 catalog** 而不是要求人手写：目录发现 + 命令探测 + 属性建议 | `lib/discover.mjs` | P6 |
| `release` | 发布就绪证据装配器，**永不打 tag** | `lib/memory.mjs` | P6 |

命名对齐：`verify` 保留为 `gate` 的别名（现有 hook 接线消费 `verify`，不许破坏）。

---

## 四、P→M 转换表（超越 dsh 的实质）

dsh 宪法与 OPERATING-MODEL 里显式标 **(P)** 或注明「引擎做不到」的规则，逐条给 cc-base 的机器承载：

| # | dsh 的 P 规则（出处） | dsh 自陈的限制 | cc-base 的 M 承载 | Phase |
|---|---|---|---|---|
| 1 | 「评审者永远不是作者」（`AGENTS.md:98` 5b.6） | *Prompt-only: the engine counts lenses, it cannot tell who wrote the code* | `SubagentStart`/`SubagentStop` 的 `agent_id`+`agent_type` 落**作者账本**；`PostToolUse(Edit\|Write)` 把改动文件记到当前 `agent_id` 名下；`review verdict` 校验 lens 的 agent_id ∉ 该 diff 的作者集，命中即拒 | P3 |
| 2 | 六字段结果信封（`PROTOCOLS.md:39`） | *Text, not JSON. No command parses it* | `SubagentStop` 解析 `last_assistant_message`，六字段缺任一 / `Verified` 行无「命令→退出码」→ `permissionDecision:"deny"`，退回让它补 | P3 |
| 3 | 「压缩后与每个阶段边界重读不变量」（`AGENTS.md:126`） | 只能靠 agent 记得跑 `dsb invariants` | `PostCompact` hook 自动跑 `invariants` 并经 `additionalContext` 回注 | P4 |
| 4 | 审批三档（`AGENTS.md:42`「Prompt-only」） | 靠自觉分档 | `PermissionRequest` 返回 `decision`：HIGH 档 → `deferToUser`；LOW → `allow`；模糊 → 高一档 | P5 |
| 5 | 「只改 Scope 内文件，无顺手重构」（`AGENTS.md:44` §3） | 事后靠 `impact`/`budget` 兜 | `PreToolUse(Edit\|Write)` 对照活跃 task 的 Scope，越界直接 deny（矩阵 #39 dsh 判 Rejected） | P1 |
| 6 | 指令文件当不可信输入扫描 | 只能在 git hook / CI 扫（离载入很远） | `InstructionsLoaded` 在**载入瞬间**扫 `file_path`；同时保留 git hook 那份做提交面 | P5 |
| 7 | 「编辑 catalog 的 risk/attribute 字段是 HIGH 档」（`AGENTS.md:40`） | 靠自觉 | `ConfigChange` + `PreToolUse(Edit)` 对 catalog 保护字段 deny 并要求显式授权 | P5 |
| 8 | 「task complete 需四项条件」 | dsb 内部判定，但没人强制在标完成时跑 | `TaskCompleted` hook `deny` + 回报缺哪一项 | P1 |
| 9 | 「delegate 拿证据、judgement 自留」 | 靠自觉 | `Task(agent_type)` 权限约束 + `SubagentStop` 校验回执只含证据句柄不含裁决 | P3 |
| 10 | 禁用「should work / probably fine / looks correct」 | 靠自觉 | `Stop` hook 读 `last_assistant_message` 做措辞检测，命中且无命令+退出码 → 拦并要求补证据 | P4 |
| 11 | Spec/Design 签字闸「no hash binds the approval」（`OPERATING-MODEL.md:48`） | 只能记进 progress.md | 把批准做成绑 spec 文件内容哈希的 receipt，文件一动即失效 | P2 |

**这 11 条就是 cc-base 相对 dsh-base 的结构性优势清单。** 它们不是「多几个功能」，是同一批规则从概率变成闸门。

---

## 五、从独立联网调研补进来的（dsh 那份研究没有的）

dsh 的 `docs/research/ai-coding-agents-state-of-practice-2026.md` 是一份高质量、自陈方法论局限的检索式综述（只做搜索结果挖掘、未取全文，自己标注「treat every number as reported-by-source」）。我复核了它的两条主引用确实存在且描述准确（[Adversarial Review, arXiv:2608.18167](https://arxiv.org/abs/2608.18167)；[SWE-Review, arXiv:2607.06065](https://arxiv.org/abs/2607.06065)）。以下是它**没有**、而本轮独立检索到的：

**1. Governance Decay（arXiv:2606.22528）——本轮最重要的一条**
标题即结论：*How Context Compaction Silently Erases Safety Constraints in Long-Horizon LLM Agents*。它对既有压缩研究的批评是：虚拟上下文管理、LLM 摘要、结构化驱逐、KV-cache 驱逐——**全部只优化任务准确率或吞吐，没有一个测量治理约束是否在重写中存活**，也没人测约束被删后是否导致不安全的工具调用。并且它把「压缩导致的主动删除」与「长上下文的一般性衰减」明确区分开（后者是注意力稀释，前者是删除）。
dsh 引的 ContextEcho（2605.24279）只说到「压缩不修正漂移」；这篇说的是更强的「压缩会删掉约束」。
**对策（文献收敛的三种，可叠加）**：预留预算层（guardrail 不可被挤出）／固定控制态（pin）／**边界后回注**。cc-base 的 `PostCompact` 就是第三种的原生承载。→ 落 P4。

**2. 指令文件是活跃攻击面**
dsh 已有 `audit/scan-instructions.mjs`（扫 AGENTS.md/CLAUDE.md/SKILL.md 等，七条 error 规则：端点改写 / 内嵌凭据 / 指令覆盖 / 外传命令 / 管道执行 / 零宽与双向控制字符 / 教唆绕闸）。这份实现值得直接对齐吸收，**并加一层 dsh 拿不到的**：`InstructionsLoaded` 在载入时扫，而不只在 commit 时扫。→ 落 P5。

**3. EARS 的真实边界（防止过度承诺）**
EARS 给的是**可 lint 的形式**（关键词大写、强制 SHALL、固定子句序、拒 should/must/will/can/may、拒「适当」「快速」这类模糊词），**不是可执行规格、不是行为测试**。所以 `spec-lint` 只该断言形式，内容正确性仍归测试层。这条要写进 `spec-lint` 的文档，避免把「规格 lint 通过」误读成「需求对」。

**4. Claude Code 本体的新事实**（见 §二）——这是 dsh 结构上不可能有的一整块。

**明确不引入（避免凑数，逐条给理由）**：
- **C2PA / SLSA / Sigstore 的 AI 作者身份签名**：确有 2026 标准动向（C2PA v2.4 加了 `c2pa.ai-disclosure`），但对单人本地框架是纯负担，且「AI 作者身份字段」本身仍是公认的标准空白。记为将来事。
- **Weft 那类外部执行账本服务**：cc-base 的立仓原则是零外部进程、零 daemon。自持哈希链账本已覆盖「证据不可被静默改写」这一核心，不引入服务依赖。
- **Agent Teams 做主编排**：实验特性、默认关、明确写着「no session resumption / task status can lag / no nested teams」，且会把命名 subagent 意外变成 teammate。与扁平编排铁律冲突。**反向动作**：显式关闭（§二）。
- **向量库 / trajectory 回放 / 自建 benchmark**：progress.md 已在「明确不做」段落钉死，本轮不翻案。

---

## 六、姊妹仓：复核后仍成立的三条（其余已完成或不搬）

`.claude/research/siblings-delta-2026-08.md` 是 2026-08 对 codex/cursor/pi 三仓的增量分析。本轮逐条读源码复核，**两条已经做过了，不重复计功**：

- ~~privacy 入 waiver 禁词~~ → **已完成**：`harness.mjs` `WAIVER_FORBIDDEN_RE` 已含 `privacy`（实测 `validateWaiver` 错误串："safety|security|privacy|pii|secret|credential|destructive|push|deploy|production"）。
- ~~空验证计划=失败~~ → **已完成**：`verifyPlan` 已有 `emptyPlan = imp.affected.length > 0 && waived.length === 0`，`state` 取 `BLOCKED`（harness.mjs 内 S8 段，注释写明「nothing ran, so nothing was established」）。

**仍成立的三条**：

1. **waiver 三重收紧（源自 cursor-base）** — 当前 `applyWaiver` 把非 security/safety/privacy 类的 **FAIL** 也能洗成 SKIPPED。cursor 的立场更硬：`WAIVABLE_STATUSES = {MISSING, BLOCKED, SKIPPED}`——**跑过并 FAIL 的检查是缺陷的证据，永不可豁免**；豁免只给「跑不了的」。另加：waiver 绑 `diffHash`（豁免的是这一版改动上的这个检查，不是一个时间窗）；critical 档模块认领的 check，其 waiver 申请即拒；**零认领检查的属性缺口不可被 waiver 遮盖**（那是布线缺陷，不是证据被推迟）。→ 落 P1，**改变现行为，属家底改动**。

2. **架构存量债改 per-edge 基线进 git（源自 pi-base）** — 当前 `compareRatchet` 是 **count 棘轮**，有两个真漏洞：① 还掉一条旧债同时添一条新债，计数不变即通过；② `TREND_METRICS` 里 `forbidden` 也参与棘轮（源码实测 `if ((m === 'undeclared' || m === 'forbidden' || m === 'cycles') && latestV > minPrior)`）——**用户显式声明的安全/隐私禁边违规，能作为旧债带病通过 `--gate`**，与「禁令赢」的立场自相矛盾。再加台账 git-ignored 导致多机基准漂移。
   改法：catalog 加 `archBaseline:[{from,to,reason}]` 进 git；命中清单的那条边报 tolerated，任何新边立即 FAIL；**forbidden/layer 违规永不进基线**（判定顺序上先归违规桶再查表）；已还清的边报 stale 提示清除。count 棘轮降级为趋势报告。→ 落 P6。

3. **retention / quarantine / 衰变播报（codex 与 cursor 趋同）** — `.claude/evidence/gate-block.log` 无轮转无限追加；context-pack 产物无上限；状态 JSON 损坏时各 hook 多为「当无状态重建」，静默丢证据。codex 的做法是隔离区：改名 `*.corrupt-<ts>` 保全 → 记 quarantine 事件 → 调用方用默认值继续 → SessionStart 播报。**「隐私」在五性里被定义成含『销毁合规』，自家运行态却只积不销**，这是自我不一致。→ retention 落 P1，quarantine + 播报落 P4。

**codewhale-base（2026-08-20，那份分析之后才有）**：25 子命令引擎 + 哈希链 + quarantine + retention + 五维属性门，与 codex/cursor/dsh 同源趋同，未发现独有机制。不单独立项。

---

## 七、Phase 计划与验收闸

每个 Phase 收口必须过：`selftest` 全绿 + `harness-golden.mjs --check` 零差异 + `run-all.sh` 全绿 + 该 Phase 自己的新增测试。

| Phase | 内容 | 完成判据 |
|---|---|---|
| **P0 地基** | 引擎拆库 `harness.mjs` → `lib/{core,catalog,graph,quality,scan,context,selftest}.mjs`；golden 基线锁 | golden 零差异（拆前拆后逐字节相同）+ selftest 106 断言全过 + run-all 全绿 |
| **P1 证据层** | `gate`(+证据落盘+planHash) / `ledger` 哈希链 / `gate-audit` / `retention` / `risk` / `task` / `budget`；waiver 三重收紧；`PreToolUse` Scope 越界拦；`TaskCompleted` 证据闸 | 链断能被 `ledger` 抓到（注入损坏做反向验证）；FAIL 不再可豁免（回归锁）；越界写入被真拦 |
| **P2 规格层** | `spec-lint`(EARS) / `trace` / `spec` / `dod`；spec 批准绑内容哈希 | 拿本仓 Product-Spec 真跑；坏样例能被逐条点名 |
| **P3 评审层** | `review` 引擎（start/blue/lens/verdict/backlog）/ `review-pack`（删除文件独立成节）/ **作者≠评审机器强制**（作者账本 + verdict 校验）/ `SubagentStop` 回执信封强制 | 同一 agent_id 既写又评 → verdict 被拒（反向验证）；无 file:line 的 finding 被拒 |
| **P4 记忆层** | `recap` / `invariants` / `archive` / `sync-check`；**`PostCompact` 不变量回注**；`Stop` 措辞检测；quarantine + 衰变播报 | 压缩后不变量确实回到上下文（真跑一次压缩验证）；措辞检测有真阳性也有真阴性 |
| **P5 宪法层** | CLAUDE.md 45KB → ~12KB 索引式，每条规则标 `[M: 命令→退出码]` 或 `[P]`；冷规则下沉 rules/；`rules-audit` 量化 M/P；`skills-lint` / `claude-md-lint`；`fast` 债务化；`PermissionRequest` 三档；`InstructionsLoaded` 扫描；`ConfigChange` 护栏锁 | `rules-audit` 报出的 M 比例可被引用；路由行为回归不退化（test-routing 全绿） |
| **P6 边界层** | `cochange` / `fleet` / `init` 自动发现 / `release`；架构债 per-edge 基线；git hooks + CI；测试补齐 | 在本仓真跑 `init` 能生成可用 catalog 骨架；git hook 真拦一次坏 commit |

---

## 八、贯穿全程的纪律

1. **零行为回归**：每个 Phase 都跑 golden `--check`。现有 15 个子命令的 stdout JSON 与退出码是对外契约（hook 在消费），除非显式决策否则不许动。
2. **默认关不变**：catalog 不存在 = 全部大仓能力静默关闭、hook 走原逻辑。新增能力一律遵守这条，小项目零负担。
3. **跨平台成对**：新增 hook 必须 `.sh` + `.ps1` 成对，且过 `test-hook-parity.sh`。引擎源码保持纯 ASCII。
4. **每条新闸必须能说出它拦过什么**：`gate-audit` 会问。加闸时同批产出一条反向验证（注入缺陷 → 闸响）。
5. **家底风格无缝贴合**：改 CLAUDE.md / hooks / skills 时缩进、标记、语气、密度同原文，改完读不出哪句是后加的。
