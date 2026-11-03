# 10 Sub-Agent 派发精通

这章解决的问题：你已经知道「编码 / 审查 / 测试 / 部署要派 Sub-Agent」，但派出去的单子要么让子 Agent 瞎猜、要么回来一句「完成」你不知道信不信、要么卡住了你不知道该重派还是该等。读完你能：

- 说清主 Agent 为什么只写单 + 验收，fresh 与 fork 各用在哪；
- 对着八个角色的表知道每个的职责、默认模型、maxTurns、禁用工具，按 Task 三档给模型升降级；
- 写出一份七字段派单包，认得出反例；
- 读回执信封的每个字段，按五步验收，知道新建文件为什么不能拿 `git diff` 当证明；
- 子 Agent 回 BLOCKED / NEEDS_CONTEXT 时按升级阶梯处理，不原样重试；
- 判断什么能并行、什么时候该用 Workflow 编排、为什么要用户 opt-in；
- 派静默任务前后该说什么、什么算挂死。

前置：[05 开发精讲](05-development.md) 的 Task 三档，[06 审查、测试、修复](06-review-test-fix.md) 的 review → fix 闭环。规则原文：`.claude/rules/subagent-dispatch.md`、`.claude/rules/workflow-orchestration.md`、`.claude/CLAUDE.md` [运行模型] 与 [Sub-Agent 调度规则]——派发前主 Agent 必须先读前两份，本章不替代它们。

---

## 入门：谁干活、谁验收

### 运行模型

纯 Claude Code 方案：所有委派走原生 Agent 工具（Task 工具），不依赖任何外部编排进程。

| 角色 | 做什么 |
|---|---|
| 主 Agent | **唯一编排者**：需求分析、任务拆分、排序、派发、验收。编码 / 审查 / 测试 / 部署四个环节一律不亲自动手，只「写提示词 + 委派 + 验收」 |
| Sub-Agent | 工人：每次派发都是 **fresh 实例**，互不继承上下文，干完回一份结构化回执 |

**扁平编排是铁律**：Sub-Agent 不再拉 Sub-Agent（所有执行角色 `disallowedTools` 都含 `Task`）；Workflow 也由主 Agent 编写，其内 `workflow()` 嵌套只许一层。纯 CC 的 Sub-Agent 本就上下文隔离，只回传最终结论进主 Agent，不需要中间层协调员。

为什么主 Agent 只写单 + 验收：

- **隔离**：Task A 的错误假设不会污染 Task B；写测者不是被测作者，作者的错误假设不会原样写进断言。
- **上下文经济**：子 Agent 读几十个文件、跑几十条命令，全在它自己的窗口里；进主 Agent 的只有回执。
- **机器闸**：主 Agent 自己 Edit/Write 业务源码，`no-direct-code-guard.mjs` 当场 exit 2（见 [09](09-gates-and-tiers.md)）。文档类（Spec / CHANGELOG / DEV-PLAN / progress / rules / skills）主 Agent 可以直接写。

### 八个角色

`.claude/agents/*.md` 的 frontmatter 是权威。

| 角色 | 用的 Skill | 职责 | 模型 | maxTurns | 禁用工具 | 派发形态 |
|---|---|---|---|---|---|---|
| implementer | dev-builder | 按派单编码 + 编译验证 + 自检；不 commit、不判「可提交」 | sonnet | 100 | Task | fresh |
| code-reviewer | code-review | 对照 Spec / 设计稿审查，Stage 0 → 1 → 2；只审不改，Edit/Write 只用于自己的 agent memory | opus | 60 | NotebookEdit, Task | fresh |
| tester | test-builder | 为高价值逻辑写 / 跑回归测试；断言以 Spec 为准不抄实现；失败三分流 | sonnet | 60 | Task | fresh，且**与写该代码的 implementer 不同实例** |
| deployer | release-builder | 打包 / 构建 / 部署，收集三件套证据；测试卡点没过回 BLOCKED | opus | 60 | Task | fresh |
| progress-recorder | progress-recorder | 增量合并 progress.md / 归档 | sonnet | 25 | Bash, Task | **fork** |
| feedback-observer | feedback-writer | 记录用户对 AI 的纠正 | sonnet | 25 | Bash, Task | **fork** |
| evolution-runner | evolution-engine | 扫 feedback 出进化建议，只提不做 | sonnet | 30 | Task | fork（skill 声明 `context: fork`） |
| domain-recorder | 无（读 domain-rulings.md） | 按七栏把口径写进 `domain/`，维护依赖关系 | sonnet | 25 | Bash, Task | fresh |

code-reviewer 与 tester 挂了 `memory: project`，有跨会话的 agent memory（`.claude/agent-memory/<角色>/`，封顶见 [08](08-memory.md)）。

### fresh 与 fork

| | fresh（默认） | fork（`subagent_type: "fork"`） |
|---|---|---|
| 上下文 | 不继承 session 历史，只拿派单包 | 继承主对话全文 |
| 用在 | 执行类四角色：implementer / code-reviewer / tester / deployer | 记录类：progress-recorder / feedback-observer / evolution-runner——它们必须看见对话原文，fork 省掉主 Agent 手工转述这层失真 |
| 为什么 | 执行类 fork 是污染不是红利：前序 Task 的假设、被否掉的方案、半截讨论全进了它脑子 | 记录类不写代码，读全文只是为了不漏 |

### 模型分档

默认模型写在各 agent frontmatter（上表）。派单时按 Task 三档调：

| 档 | 模型 | 依据 |
|---|---|---|
| LOW / MEDIUM | frontmatter 默认（implementer / tester sonnet，code-reviewer / deployer opus） | — |
| HIGH | 派单显式传 `model: opus` | `.claude/rules/dev-workflow-details.md` [项目开发阶段] 三档表：HIGH 的 implementer 传 opus |
| 纯机械任务（改文案 / 样式微调 / 搬运） | 可传 `haiku` | subagent-dispatch.md [派发形态] |

「四个执行角色一律 opus」是 2026-09-15 前的默认，按档升级取代了它。

### 三档决定派几个角色

Task 档位由主 Agent 按 `git diff --stat` 与触及路径机械判（三条任一命中即升档，拿不准按高一档），派单包 Goal 首行写明。档位不只影响模型，还决定这一个 Task 要派几个角色（`.claude/rules/dev-workflow-details.md` [项目开发阶段]）：

| 档 | 判据 | 派谁 | 收口 |
|---|---|---|---|
| LOW | 改动 < 50 行，不碰契约 / 解析器 / 鉴权 / 迁移 / 支付 / hooks 类路径，不引新依赖 | implementer 一单（自检 + static-check + 跑现有测试） | 主 Agent 对着 diff 与运行器输出验收 → commit；**不派 reviewer、不派 tester** |
| MEDIUM | 50–300 行，或碰上述路径之一，或引新依赖 | implementer → code-reviewer 一轮只跑 Stage 0 + Stage 1 | 只 HIGH 阻断，修完由**同一轮** reviewer 复核一次即收口 → commit |
| HIGH | > 300 行，或碰两类以上上述路径，或线上 bug / 数据迁移 / 安全相关 | implementer（`model: opus`）→ code-reviewer 全三 Stage → 有 HIGH 派修 + 同一轮复核 → tester 补关键逻辑测试（写测 ≠ 作者） | commit |

任何档的 Medium / Low finding 记进 progress.md 残留随后续 Task 顺手修，不开新一轮、不派 fresh reviewer——审一个小 diff 便宜，贵的是仪式。

### 记录类角色的输入

记录类走 fork 能看见全文，但主 Agent 仍要给结构化输入，否则它不知道这次该记什么：

| 角色 | 主 Agent 传入 |
|---|---|
| progress-recorder | `mode`（record / archive，同轮二者皆有先 record 再 archive）/ `delta`（本轮对话增量原文 + 必要上下文）/ 项目根路径 |
| feedback-observer | 触发原因（用户原话）/ 当前 Skill（或 N/A）/ AI 做了什么（被修正的具体行为）/ **已落地的改变**（纠正已应用到当前产物哪条、progress.md Decisions 哪条、派单包；没有就写「尚未落地」） |
| evolution-runner | 触发方式（session 初始化 / 用户手动） |
| domain-recorder | 主 Agent 已裁定要收的口径 + 补齐的依据（三类之一）；只传线索会被拒收并说明缺哪类依据 |

---

## 进阶：派单包、回执、验收、升级

### 派单包七字段

fresh 实例不该猜的东西，主 Agent 必须显式给。给的是**文件路径不是历史**——brief 与 diff 落盘传路径，不把前序 Task 的总结粘进派单。

| 字段 | 写什么 | 反例 |
|---|---|---|
| **Goal** | 完成后必须成立的具体结果；**首行写明档位**（LOW / MEDIUM / HIGH），code-reviewer 按它决定跑几个 Stage | 「把登录做好」 |
| **Scope** | 允许读改的文件、模块、行为 | 「相关文件」 |
| **Out of Scope** | 明确不得顺手处理的内容 | 留空 |
| **Existing Pattern** | 应遵循的现有实现、类型、命名、文档 | 「按项目惯例」 |
| **Business Context** | 为什么做、谁受益；Spec「规则与例外」里相关条目；progress.md Pinned / Decisions 里适用于本 Task 的规则（**引日期**）；用户教过的相关纠正（feedback 文件名）；项目有 `domain/` 时按域匹配出的口径条目。**编码 / 审查 / 测试类派单不许写 N/A** | `N/A`；「见 Spec」（不抄条目让它自己翻） |
| **Verification** | 本任务允许且需要的最小客观核查；用户明确豁免时写明；**HIGH 档在这里写预算**（工具调用次数或分钟） | 「自测通过即可」 |
| **Escalation** | 哪些情况必须返回主 Agent，不得自行扩大范围或权限 | 留空 |

其余不适用的字段写 `N/A`。大仓启用后 `harness task` 子命令机器校验，缺哪个点哪个。

**规模纪律**：

- LOW / MEDIUM 单子只给「文件:行 + 改成什么 + 一条验证命令」，预期 **≤ 6 次工具调用**（2026-09-06 用户纠正：「6 轮我都嫌多」）。
- agent frontmatter 的 `maxTurns` 是熔断线不是目标。
- 单次派单预期 > 60 分钟说明任务分解不合理，回去重切，不让子 Agent 长跑。

一份 MEDIUM 单子的骨架：

```
Goal（MEDIUM）：src/export/olt.ts 的 buildKey() 改用 OLT IP 作关联键，导出结果里不再出现 OLT 名。
Scope：src/export/olt.ts:41-58；tests/export/olt.test.ts 可加断言。
Out of Scope：不动 src/export/index.ts 的列定义；不改 CSV 表头。
Existing Pattern：同目录 pon.ts 的 buildKey() 已用 IP，照它的签名与错误处理。
Business Context：Spec §3.2「导出以 IP 为唯一键」；progress.md Pinned 2026-09-10「关联键＝OLT IP，禁止用 OLT 名」；domain/OLT.md R-OLT-001。受益者：运维导出后按 IP 关联告警。
Verification：npx vitest run tests/export/olt.test.ts；贴运行器原始输出。
Escalation：发现 pon.ts 的 IP 取法与 Spec 冲突 → 停下回报，不自行改 pon.ts。
```

### 回执信封

Sub-Agent 的**最终回传消息**是唯一进主 Agent 上下文的东西。回传 = 结论 + 证据句柄（文件路径 / commit hash / 输出位置 / 时间戳）+ 关键提炼，不贴全文与原始长日志。

统一信封，首行四态自评：

| 字段 | 写什么 |
|---|---|
| **Status** | `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`；tester 可用 `PASS` / `FAIL` 表示运行器结果 |
| **Changed** | 实际改动的文件或产物；只读角色写 `None` |
| **Verified** | 实际跑过且拿到结果的核查 |
| **Not verified** | 没执行或无法证明的，**必须列** |
| **Business assumptions** | Spec 没写、自己补的判断；没有写 `None` |
| **Counter-examples** | 代码对得上 Spec、Spec 对不上业务的反例：情境 → 按 Spec 会怎样 → 业务上应怎样 → 依据；有就报「需求存疑」，主 Agent 回流 product-spec-builder；没有写 `None` |
| **Domain findings** | 本次撞出的领域线索，带手上的证据（实测结果、真实格式、真库状态）；**报线索不报结论**；没有写 `None` |
| **Needs review by** | 谁该复核 |
| **Evidence** | 文件路径、命令与结果句柄 |

`subagent-acceptance-reminder.mjs` 在 implementer / code-reviewer / tester / deployer 停下时把收工自检注给**它自己**（不是主 Agent）：

```
implementer：你就要收工了——自报（完成/通过/空回复）不算客观证据，把每条结论锚到你实际跑过的命令与它的输出上；没跑过、证不出的写进 Not verified。
```

回执的 Domain findings 栏真有内容（不是 None / N/A / 无）时多一句「写清你手上的证据是哪一类（实测 / 查外网 / 查内部）；定论归主 Agent，你只报不判」。判据按栏开头词，`None（本轮纯只读）` 这种带括注的也算 None。

### 主 Agent 验收五步

子 Agent 说「完成 / 通过」只代表它跑完了。任何「完成 / 通过 / 修好」出口前（`.claude/CLAUDE.md` 铁律 2）：

1. 想清哪条命令能证明这个结论；
2. 跑**全量、全新**的该命令，不复用上一条消息的旧输出；
3. 读完整输出、看 exit code、数失败数；
4. 确认输出确实支持结论（不是输出有了就算）；
5. 才许开口下结论。

禁「应该 / 大概 / 估计 / 看起来」。按环节：

| 环节 | 看什么 | 不看什么 |
|---|---|---|
| 编码 / 修复 | 编译输出 + 对照 Spec 逐条 + diff | implementer 的「已自测」 |
| 审查 | finding 附的文件:行号 + 怎么攻的与复现结果 | 「整体质量良好」 |
| 测试 | **运行器的真实输出**（跑了哪些文件、各自绿 / 红 / 跳过原因） | tester 一句「测试通过」 |
| 部署 | 独立核查三件套：容器创建时间戳 + 镜像 tag / 健康检查端点 / live 冒烟验证新功能产物 | 「Up 时长」、deployer 自报 |

**对着 diff 与运行器输出判，不对着实现者的报告判**。翻证据（读 artifact 全文、跑核查三件套）这类体力活可外包，「通过 / 不通过」的判断权留主 Agent。

**新建文件不能用 `git diff` 证明**。对本 session 新建、尚未入库的文件，`git diff` 给的是空输出 + rc 0，与「这文件没被改过」一模一样。2026-09-11 实测撞出来的：当天多个派单写着「贴 diff 证明只动了这几个文件」，对新建文件全是看着像通过的空结果。改用：

```bash
git status --short          # 新文件显示 ??
wc -l path/to/new-file      # 行数
grep -n '关键锚点' path/to/new-file
```

### 升级阶梯：禁原样重试

子 Agent 回 BLOCKED / NEEDS_CONTEXT 时按序：

| 步 | 动作 |
|---|---|
| ① | 缺什么补什么，带齐上下文重派 fresh |
| ② | 补不齐就砍范围重切任务 |
| ③ | 属缺陷定位类换 bug-fixer 路线 |
| ④ | 三步都不通升级用户拍板 |

重派必须至少变更一项（上下文 / 范围 / 角色 / 模型）；同 prompt 同模型原样重发属于赌运气。

### 并行判据

判据轴是「这些单元的决策要不要自洽」，不是任务多少。

| 类型 | 并行？ | 例子 |
|---|---|---|
| 要自洽（共享上下文 / 契约） | **串行** | 跨 Task 编码；同文件改动；有依赖的 Task |
| 只读 / 可独立汇总 | **并行甜区** | 审查维度、测试目标、代码库探索、研究广度 |

用户说「加速 / 快点」≠ 授权并行铺开——正解是砍范围、串行提效、减少返工。

### 异步与静默

Sub-Agent 默认后台跑：spawn 即返回，完成时结果自动回传进主 Agent 上下文并触发 `notify.mjs`（Notification `agent_completed`）出桌面通知。派发后可以继续别的编排，但**验收必须等结果到手**——「已派发」不是「已完成」。

派静默 Sub-Agent 或长后台任务前主 Agent 先一句话预告（静默运行 / 预计耗时 / 完成会通知），别让你对着无输出的终端误判卡死。这一下靠自觉，完成侧才有 notify 兜底。

**挂死判断**（铁律 9）：确认迹象——CPU 0% 而时长仍涨、已定位根因却没有进展——立即报告并止损，不许「进程还活着」式观望；观望是最贵的那个选项。工具调用被你的消息打断是 harness 信号不是否决：有新指示照办，只是提醒就解释后重发同一方案，不擅自换方案、不甩锅。

### 子 Agent 内 hook 照样触发

settings.json 里的 hook 在子 Agent 内同样跑，事件多带 `agent_id` / `agent_type`。你会看到的效果：implementer 写 `src/` 不被 no-direct-code-guard 拦（它看到 `agent_id` 放行）；子 Agent 里 `cat .env` 照样被 secret-exfil-guard 拦（地板闸不分主子）；大仓启用时 record-authorship 用 `agent_type` 记「implementer 写了 src/a.ts」，review 据此拒绝自审。stop-gate 的三振设计（同一清单连拦 3 次第 4 次放行）正是为「子 Agent 场景无法自行派 reviewer 满足闸条件、会被无限重验」留的——出处是 `stop-gate.mjs` 头注释。

---

## 精通：Workflow 编排

### 什么时候用

Task 直派是默认；Workflow 是它在「多个无依赖单位」时的规模化上层，不取代它。判据同上：只读 / 可独立汇总的才 fan-out。

| 场景 | 形态 |
|---|---|
| code-review 多维 + 对抗验证 | `pipeline(维度, 审查, 逐条 verify)`，已落地 `.claude/workflows/code-review-fanout.js` |
| test-builder 批量写测 | `parallel` 多个高价值逻辑各派 tester，fresh 天然独立于作者 |
| 代码库探索 / 研究 | breadth-first 普查 |

**成本闸门（硬约束）**：多 Agent 耗 token 约 **15 倍**（Anthropic 实证）。Workflow **必须用户显式 opt-in**，不静默触发——达到 fan-out 规模时主 Agent 先提议、你确认再跑。缓和项：同一 workflow 里同型 agent（同模型 / agentType / 工具 / schema / 工作目录）共享 prompt cache，实际低于裸 15 倍上限，但 opt-in 闸不变。单 Phase 仅 1–2 个单位直接 Task 直派。

### 三铁律不动

1. 主 Agent 仍是唯一编排者——workflow 是主 Agent 写的脚本，不是 Sub-Agent 自拉 Sub-Agent；`workflow()` 嵌套只一层。
2. 验收判断权留主 Agent——workflow 用 `schema` 回传「结论 + 证据句柄」，主 Agent 凭证据定夺。
3. 写测独立性靠 `agent()` 每次 fresh + 不同 agentType。

### code-review-fanout.js 长什么样

```js
export const meta = { name: 'code-review-fanout', whenToUse: '改动面较大…成本 ~15x，单 1-2 处改动用 Task 直派更划算', phases: [{ title: 'Review' }, { title: 'Verify' }] }
const DIMENSIONS = args.dimensions || [
  { key: 'correctness', prompt: '逐条对照 Product-Spec.md 检查功能正确性与边界…' },
  { key: 'security',    prompt: '安全审查：硬编码密钥、eval/innerHTML、SQL 注入…' },
  { key: 'spec',        prompt: '规格符合性 + Spec 漂移…' },
]
const LENSES = ['correctness', 'repro', 'security']
const results = await pipeline(
  DIMENSIONS,
  d => agent(`你是 code-reviewer。审查范围：${scope}。审查维度【${d.key}】…`, { agentType: 'code-reviewer', label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  review => parallel(review.findings.map(f => () => agent(`对抗式核验以下缺陷是否真实存在（默认怀疑…）…用【${LENSES[f.title.length % LENSES.length]}】视角`, { agentType: 'code-reviewer', label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA }).then(v => ({ ...f, verdict: v }))))
)
const confirmed = results.flat().filter(f => f.verdict && f.verdict.isReal)
return { scope, confirmedCount: confirmed.length, confirmed: … }
```

要点：

- `agent(prompt, { agentType, label, phase, schema })` 从同一注册表复用框架现有专职 Agent（带其 skill + system prompt）——**编排换脚本，工人不变**，隔离 / 职责边界 / 写测独立全保住。
- 每条 finding 必带 `verificationQuestion`（可独立判定的验证问题）与 `evidence`（证据句柄），verify 阶段用另一个视角 lens 默认怀疑、亲自核验；只有 `isReal` 的才回传。以视角多样性补回纯 CC 失去的「异构模型互照」。
- 每个维度审完即进入逐条 verify，不等其他维度（无 barrier）。
- 调用时 `args.scope` 传审查范围（「Phase 2 交付清单」或「src/auth/ 改动 git diff」）。

写自己的 workflow 前读 `.claude/rules/workflow-orchestration.md`，Claude Code 的 `workflow-authoring` skill 有脚本 API 与坑。

### worktree 隔离

并行**写文件**的 implementer 首选原生字段 `agent(prompt, { agentType: 'implementer', isolation: 'worktree' })`——Claude Code 自建自清临时 worktree（默认从默认分支分叉，`worktree.baseRef` 可调），并机器强制隔离（`git -C` / `GIT_DIR` 逃逸都拦）。每个 worktree 约 200–500ms + 磁盘成本，只在并行写文件时用；只读 fan-out 不需要。

确需手工管理时的纪律：① 先检测当前是否已在 worktree 中，已在则不再嵌套（排除 submodule 误判）；② 目录优先级——已声明目录 > 现存 `.worktrees` > 配置指定目录 > 默认，选定后 `git check-ignore` 确认该路径不入版本控制；③ 优先原生工具（`isolation` 字段 / EnterWorktree），没有再退回 git 命令。

各 worktree 里的 hook 各自落账本，`gate-audit.sh` 会把主仓和所有 worktree 的 `gate-block.log` 一起汇总。

---

## 常见坑

| 坑 | 现象 | 怎么办 |
|---|---|---|
| Business Context 写 N/A 或「见 Spec」 | implementer 回 NEEDS_CONTEXT，或按自己的理解把例外抹平 | 从 Spec / progress.md / domain/ **抄**条目进派单，引日期与文件名 |
| 把前几个 Task 的总结粘进派单 | 单子两千字，子 Agent 读完才开工，6 次工具调用预算被读文件吃光 | 贴路径不贴历史；brief 与 diff 落盘 |
| 执行类角色用 fork | implementer 带着被否掉的方案开工 | 执行类一律 fresh；只有记录类 fork |
| tester 和 implementer 同一实例 | 断言照抄实现，作者的错误假设写进测试 | 派不同 fresh 实例；大仓启用后 authorship 账本会拒绝自审 |
| 拿「已派发」当「已完成」 | 主 Agent 在回执没到时就报完成 | 验收必须等结果到手；notify 会通知完成 |
| 信子 Agent 一句「测试通过」 | 存在但没跑的测试算缺 | 要运行器原始输出 + 运行清单，主 Agent 亲跑一次全量 |
| 用 `git diff` 证明新建文件只动了几处 | 空输出 rc 0，看着像通过 | `git status` 认 `??` + `wc -l` + 内容锚点 |
| BLOCKED 后同 prompt 原样重发 | 同样卡在同一处 | 升级阶梯 ①→④，重派至少变一项 |
| 用户说「快点」就并行铺开编码 | 同文件冲突、契约不自洽 | 编码默认串行；并行只给只读 / 可汇总的 |
| 主 Agent 静默触发 fan-out | token 账单 15 倍 | Workflow 必须先提议、用户 opt-in |
| 单 Phase 1–2 个单位也走 workflow | worktree 与编排开销比省下的还多 | Task 直派 |
| 派单没写档位 | code-reviewer 按 HIGH 跑全三 Stage | Goal 首行写 LOW / MEDIUM / HIGH |
| HIGH 档 implementer 没传 `model: opus` | 复杂改动用 sonnet 返工 | 三档表：HIGH 显式升级；机械任务才降 haiku |
| 子 Agent「没输出」就以为挂死 | 它在后台跑 | 看 notify / 完成回传；确认 CPU 0% 且时长仍涨才算挂死 |
| 主 Agent 收到 subagent-acceptance-reminder 的提醒 | 收不到——那句注给子 Agent 自己 | 主 Agent 靠读回执正文验收，没有机器提醒兜底 |
| 子 Agent 回执报了 Domain findings 就直接收进 domain/ | 线索当口径，库里进噪音 | 线索要 AI 查外网、人查内部补齐依据后才派 domain-recorder |

下一章：[11 大仓治理可选包](11-large-repo.md)——派单包机器校验、回执绑定、作者账本在那里变成引擎判得了的事。
