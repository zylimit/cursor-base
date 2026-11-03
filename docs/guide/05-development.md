# 05 开发精讲：Task 三档、派单包、四步走、Git 工作流

这章解决的问题：Spec 签字之后，代码是怎么一步步写出来的——DEV-PLAN 怎么拆、每个 Task 怎么定档、派单包怎么写、回执怎么看、什么时候必须先写红测试、Phase 怎么收口、commit 与 push 由哪些闸看着。

读完你能做到：读懂并修一份被 `plan-lint` 打红的 DEV-PLAN；对一个 Task 用机械判据定出 LOW / MEDIUM / HIGH 并知道各派谁；写一份不让 fresh 实例瞎猜的派单包；只看 diff 与运行器输出就验收，而不是看子 Agent 的自述；在 BLOCKED 时按升级阶梯走而不是原样重试；把 Phase 用四步走与四态门收口；用 `/branch-finisher` 把分支收干净。

前置：[04 需求与设计](04-requirements-and-design.md) 的 Spec 已过复述签字。本章所有派发都遵守 CLAUDE.md 主 Agent 职责边界：编码 / 审查 / 测试 / 部署一律派 Sub-Agent，主 Agent 只「写提示词 + 委派 + 验收」。

---

## 入门：做什么

### 从 Spec 到代码的一条链

```
/dev-planner → DEV-PLAN.md → plan-lint 绿
      ↓
/dev-builder → 初始化模式（无代码）或持续开发模式（有代码）
      ↓
每个 Phase：Plan Mode 列 TaskList
      ↓
每个 Task：定档 → 写派单包 → 派 implementer → （按档派 reviewer / tester）→ 验收 → echo clean → commit
      ↓
Phase 所有 Task 完成：四步走 → 四态门 → 用户确认 → 下一 Phase
      ↓
/branch-finisher 收尾分支
```

### DEV-PLAN 的 Phase 与 Task 粒度

`/dev-planner` 读 Product-Spec.md（可选叠加 Architecture-Design / DFX-Spec / Design-Brief / DESIGN.md / 已有代码）产 DEV-PLAN.md，模板在 `.claude/skills/dev-planner/templates/dev-plan-template.md`。每个 Phase 五个段名是 `plan-lint` 的锚点，写法不能改：

```markdown
## Phase 1: [功能名称]

**交付内容**：
- [动词开头，一条一个可感知交付物]

**验证的假设**：
- [无；或一条假设一 bullet：来源 → 本 Phase 用什么证明它成立]

**关键文件**：
- `src/path/to/file.tsx` — [用途]

**Task 清单**：
- **Task 1.1：[具体改动]** — 文件路径 + 改哪个函数 / 加哪个字段 + 验证命令

**验收标准**：
- [能编译、能启动、能看到 XX 效果；假设成立的证据是什么]
```

粒度判据（`dev-planner` [粒度校准法]）：

| 判定 | 判据 |
|---|---|
| Phase 太大 | 交付清单超 5 项 / 关键文件超 10 个 / 涉及 3 个以上互不相关的功能 |
| Phase 太小 | 交付清单只有 1 项且简单、关键文件只有 1-2 个 |
| 合适 | 交付 2-4 项、关键文件 3-8 个、功能之间有内聚性 |
| 例外 | 首条价值流程的最小骨架 Phase 允许超上限，超了写进已知风险 |

Task 每条给齐三样：文件路径 + 具体改动 + 验证命令（`tsc --noEmit`、`pytest tests/test_parser.py`、`curl localhost:3000/api/x`），不写「自行验证」。按最坏的执行者设防：对代码库零了解、厌恶写测试，照着也能做对。

Phase 顺序由两件事定：先交付核心价值（去掉它产品不成立的那条流程），先验证关键未知（Spec 的 `[推断]` `[待定]`、没用过的技术）。不为「地基」单排一个什么都看不到的 Phase；依赖是校正项，不是排序主轴。默认一次一个功能串行收口，不并排几个半成品。

能用一句话描述 diff 的改动不写计划，直接进 dev-builder。

### plan-lint 卡什么

```bash
bash .claude/scripts/plan-lint.sh [plan] [spec]    # 默认 DEV-PLAN.md 与同目录 Product-Spec.md
```

在本仓（没有 DEV-PLAN）跑，你会看到：

```
plan-lint: 无 DEV-PLAN，跳过 (DEV-PLAN.md)
```

它不认 `--help` 这类选项参数，会报 `plan-lint: 未知参数 --help（用法：plan-lint.sh [plan] [spec]）` 并 rc 2。四项检查（rc 1 任一失败）：

| 检查 | 规则 |
|---|---|
| 禁占位符 | `TBD`、`TODO`、待补充、待确定、类似 Task、类似 Phase、按需调整、做相应修改、implement later；围栏代码块内跳过 |
| Phase 结构 | 每个 `## Phase N:` 小节必须含 `**交付内容**` / `**验证的假设**` / `**关键文件**` / `**Task 清单**` / `**验收标准**` 五个锚点；一个 Phase 都没有也报 |
| Task 粒度 | 每个 Phase ≥ 1 条形如 `- **Task N.M：...**` 的条目 |
| 需求 ↔ 计划双向覆盖 | Spec 用了 `[REQ-…]` 编号时：每个声明的编号必须被某条 **Task 行**引用（「需求没人做」）；计划里引用的编号必须在 Spec 里存在（「悬空引用」）。Spec 没用编号则跳过并明说「跳过 = 没查，不是查过了」 |

覆盖只认 Task 条目行：计划别处提到编号多半是「已知风险：本期不做」，算成有人做就是假绿。

Windows：这是 bash 脚本，内部调 `python3`，在 Git Bash 里跑。

### 初始化模式 vs 持续开发模式

`/dev-builder` 启动时按项目状态路由：

| 状态 | 模式 | 做什么 |
|---|---|---|
| 无代码 + 有 DEV-PLAN | 初始化模式 | 代码放以项目名命名的子文件夹（小写字母 + 数字 + 连字符），规划文档留根目录；按技术栈表配置，开 TypeScript strict，装依赖，配环境变量；`git init`，`.gitignore` 排除规划文档 / 设计资源 / 环境变量 / 构建产物，建 private 远程仓库，首次 commit；然后进 Phase 1 |
| 有代码 + 有 DEV-PLAN | 持续开发模式 | 按 Phase 逐步开发，每个 Phase 走 per-Task 闭环与四步走 |
| 无 DEV-PLAN | — | 提示 `/dev-planner` |
| 无 Product-Spec | — | 提示 `/product-spec-builder` |

进已有项目或脚手架先读它自带的 AGENTS.md / CLAUDE.md，按项目的规矩来。

### Task 三档：机械判据与三条链

每个 Task 先定档再派发。主 Agent 按 `git diff --stat` 与触及路径机械判，三条任一命中即升到对应档，拿不准按高一档；派单包 Goal 首行写明档位（`dev-workflow-details.md` [项目开发阶段]）：

| 档 | 判据 | 派谁 | 跑几个 Stage | 收口 |
|---|---|---|---|---|
| LOW | 改动 < 50 行；不碰契约 / 解析器 / 鉴权 / 迁移 / 支付 / hooks 类路径；不引新依赖 | implementer 一单 | 不派 reviewer、不派 tester；implementer 自检 + static-check + 跑现有测试 | 主 Agent 对着 diff 与运行器输出验收 → commit |
| MEDIUM | 50 到 300 行；或碰上述路径之一；或引新依赖 | implementer → code-reviewer | Stage 0 + Stage 1（做对了没有） | 只 HIGH 阻断，修完由同一轮 reviewer 复核一次即收口 → commit |
| HIGH | > 300 行；或碰两类以上上述路径；或线上 bug / 数据迁移 / 安全相关 | implementer（派单传 `model: opus`）→ code-reviewer → tester | 全三 Stage | 有 HIGH 派修 + 同一轮复核 → tester 补关键逻辑测试（写测 ≠ 作者）→ commit |

任何档的 Medium / Low finding 记进 progress.md 残留随后续 Task 顺手修，不开新一轮。回执带反例或报告含「❓ 需求存疑」则回 product-spec-builder 迭代模式（见 [04 需求与设计](04-requirements-and-design.md#需求存疑从下游回流)）。

这张表取代了「同一套流水线一律套全档」的旧写法：审一个小 diff 便宜，贵的是仪式。

### 每 Task 收尾：`echo clean > .claude/.needs-review`

你在 `dev-builder` [Phase 执行流程] 里会看到这一行。它是待审清单的放行契约：

- `mark-review-needed.mjs`（PostToolUse on Edit|Write）在业务代码被编辑 / 创建后，把文件相对路径逐行登记进 `.claude/.needs-review`。根级 `tools/` 与 `.claude/` 框架自身豁免，`src/tools/` 这类业务目录不豁免。
- `stop-gate.mjs`（Stop）读这个文件：去掉空行与 `clean` 行后仍有文件 = 有欠账；只剩 `clean` / 全空 / 不存在 = 放行并清理。
- 所以 Task 验收通过后写一行 `clean` 覆盖它，就是告诉闸「这批改动审过了」。

fast 档 stop-gate 直接 off——不自动派 reviewer 就没有「未审查」可提醒；默认档（standard）是 advise：照判、照记账，出 `systemMessage` 提醒而不拦；strict 档才 `decision: block`，且同一清单连拦 3 次后第 4 次放行并醒目提示欠账仍在。细节见 [06 审查、测试、修复](06-review-test-fix.md#待审清单与-stop-gate)。

### Phase 四步走与四态门

所有 Task 完成后过四步走，每步附当场跑出的证据（`dev-builder` [Phase 完成度判断]）：

| 步 | 做什么 | 证据 |
|---|---|---|
| 一、Code Review | 对照 DEV-PLAN 该 Phase 交付清单逐项确认；查有无超出 Phase 范围的改动 | 逐项对照结果 |
| 二、测试完整性 | 派 tester 写测（写测 ≠ 被测作者），真覆盖交互层与故障路径；核对用例前提与生产一致（量纲、单位、输入可达性、断言方向）；存在但没跑的测试算缺 | 运行器真实输出 |
| 三、编译验证 | 前端 `tsc --noEmit` 零错误；后端 `ruff check` 零错误，无 ruff 则 `python3 -m py_compile` 全过；混合栈两栈都验 | 各自输出 |
| 四、功能测试 | 起 dev server 无错误输出，新功能可用，现有功能未破坏；有 Playwright 测核心交互，无则 curl 查 API 再提醒用户浏览器确认 | 命令与输出 |

中间有任何改动，四步重新来。验证中发现的问题派 bug-fixer 修，用 `fix:` 提交。

收尾四态门：

| 态 | 含义 |
|---|---|
| PASS | 全通过 |
| CONCERNS | 带残留清单前进 |
| FAIL | 停下修 |
| WAIVED | 必须写明理由与批准人；安全与数据丢失类缺口不许 WAIVED |

多 Phase / 跨目录的大批量改造收口时，另扫一次重复代码与可提炼逻辑，量化留痕（工具、窗口、克隆数），做或不做都写理由。

---

## 进阶：为什么、怎么判

### 派单包七字段逐字段写法

fresh 实例不继承 session 历史，需要的上下文主 Agent 必须显式给（`.claude/rules/subagent-dispatch.md` [派单包七字段]）。给的是文件路径不是历史——brief 与 diff 落盘传路径，不把前序 Task 的总结粘进派单。

| 字段 | 写什么 | 不能怎么写 |
|---|---|---|
| Goal | 完成后必须成立的具体结果；首行写档位 | 「实现待办功能」这种没法验的话 |
| Scope | 允许读改的文件、模块、行为 | 空着让它自己找 |
| Out of Scope | 明确不得顺手处理的内容 | 省略——省了它就会「顺手」重构 |
| Existing Pattern | 应遵循的现有实现、类型、命名、文档，给路径 | 「参考现有代码」 |
| Business Context | 为什么做、谁受益、Spec「规则与例外」相关条目、progress.md Pinned / Decisions 里适用的规则（引日期）、用户教过的相关纠正（feedback 文件名）、`domain/` 里匹配的口径——从 Spec、progress.md、domain/ 抄 | 编码 / 审查 / 测试类派单**不许写 N/A** |
| Verification | 本任务允许且需要的最小客观核查；用户豁免时写明 | 「自行验证」 |
| Escalation | 哪些情况必须返回主 Agent，不得自行扩大范围或权限 | 省略 |

其余不适用的字段写 N/A；大仓启用后由 `harness.mjs task` 子命令机器校验，缺哪个点哪个。

预算纪律：LOW / MEDIUM 档的单子只给「文件:行 + 改成什么 + 一条验证命令」，预期 ≤ 6 次工具调用；HIGH 档在 Verification 里写明预算（工具调用次数或分钟）。agent frontmatter 的 `maxTurns`（implementer 100、tester 60、code-reviewer 60）是熔断线不是目标。单次派单预期 > 60 分钟说明任务分解不合理，回去重切，而不是让 Sub-Agent 长跑。

### 好派单与坏派单：todo 应用的一个 Task

假设 DEV-PLAN 里有：

> **Task 2.3：给待办加「到期日」字段** — `src/lib/db.ts` 的 `todos` 表加 `due_at` 列并写迁移；`src/app/api/todos/route.ts` 的 POST 接受可选 `dueAt`；验证 `pnpm tsc --noEmit` + `curl -X POST localhost:3000/api/todos -d '{"title":"x","dueAt":"2026-10-01"}'`

**坏派单**（fresh 实例只能猜）：

```
帮我实现 Task 2.3 到期日功能。参考现有代码风格，做完跑一下测试。
Business Context: N/A
```

问题：没档位；Scope 空，它可能顺手改前端；没有 Out of Scope，它可能把「过期提醒」也做了；Business Context 写 N/A 违反规则；Verification 是「跑一下测试」，没有命令；没有 Escalation，遇到迁移工具不存在时它会自己装一个。

**好派单**：

```
Goal（MEDIUM——碰迁移路径）：todos 表有可空 `due_at` 列（ISO 8601 文本）；POST /api/todos 接受可选 `dueAt`，非法日期返回 400 `{error:"invalid dueAt"}`；GET 返回体带 `dueAt`（无则 null）。
Scope：src/lib/db.ts、src/lib/migrations/003-due-at.sql（新建）、src/app/api/todos/route.ts、src/app/api/todos/route.test.ts。
Out of Scope：不动前端（src/components/**）；不做过期提醒、不做排序；不改已有列。
Existing Pattern：迁移写法照 src/lib/migrations/002-add-done.sql（ALTER TABLE，执行前查列是否已存在，见 dev-builder [数据库]）；路由入参校验照 route.ts 里 `title` 的处理方式；时间字段命名照 created_at（snake_case）。
Business Context：Spec 功能需求「到期日」`[确认]`（来源：案例 2，小林周五漏掉房租单）；规则与例外第 3 条：到期日可空、不填不算逾期 `[确认]`；例外：跨时区用户按录入时的本地日期算 `[默认]`（来源：待定表 Q-2 不答先按什么做）。progress.md Decisions 2026-09-12：时间统一存 ISO 文本不存时间戳。
Verification：`pnpm tsc --noEmit` 零错误；`pnpm vitest run src/app/api/todos` 全绿并贴运行器输出；`curl -X POST localhost:3000/api/todos -d '{"title":"x","dueAt":"not-a-date"}'` 返回 400。新建的迁移文件用 `wc -l` + `git status` 认 `??`，不用 git diff 证明。
Escalation：迁移工具报表已有 due_at 列 → 停下回报，不 DROP；发现 Spec 没写 dueAt 的时区语义与现场数据矛盾 → 报 Counter-examples，不自行定；需要新依赖（日期库）→ 回 NEEDS_CONTEXT，不装。
```

差别不在长度，在于每个字段都能被 implementer 拿来判断「这个我能不能做」。

### 回执信封与四态

Sub-Agent 的最终回传消息是唯一进主 Agent 上下文的东西，一律以四态自评开头（`subagent-dispatch.md` [回传与验收]）：

| Status | 含义 |
|---|---|
| DONE | 完成，证据齐 |
| DONE_WITH_CONCERNS | 完成，但有疑虑写在回执里 |
| NEEDS_CONTEXT | 缺上下文，没猜，回来要 |
| BLOCKED | 被卡住，说明卡在哪 |

tester 可用 PASS / FAIL 表示运行器结果。

信封字段：

| 字段 | 内容 |
|---|---|
| Status | 上表四态之一 |
| Changed | 实际改动的文件或产物；只读角色（code-reviewer）写 None |
| Verified | 实际跑过且拿到结果的核查 |
| Not verified | 没执行或无法证明的，必须列 |
| Business assumptions | Spec 没写、自己补的判断；没有写 None |
| Counter-examples | 代码对得上 Spec、Spec 对不上业务的反例（情境 → 按 Spec 会怎样 → 业务上应怎样 → 依据）；没有写 None |
| Domain findings | 本次撞出的领域线索，带现场证据；报线索不报结论；没有写 None |
| Needs review by | 建议谁复核 |
| Evidence | 文件路径、commit hash、编译与测试输出位置、时间戳；不贴长日志 |

implementer 不 commit（归主 Agent 验收后执行）、不再派 Sub-Agent、不直接和用户交流；它也不许自判「通过审查」或「可提交」，这两句只有主 Agent 能说。

### 主 Agent 验收看什么

CLAUDE.md 的验收铁律：子 Agent 的回复只反映它跑完了，不等于任务结果正确。主 Agent 对着 diff 与运行器输出判，不对着实现者的报告判。五步闸：① 想清哪条命令能证明结论 ② 跑全量、全新的该命令 ③ 读完整输出、看 exit code、数失败数 ④ 确认输出支持结论 ⑤ 才开口。

三条实操：

- **新建文件不许用 `git diff` 证明改动**。对本 session 新建、尚未入库的文件，`git diff` 给的是空输出 + rc 0，与「这文件没被改过」一模一样。改用 `wc -l` + 内容锚点 + `git status` 认 `??`。
- 翻证据（读 artifact 全文、跑核查）这类体力活可以外包给 fresh 实例，「通过 / 不通过」的判断权留主 Agent。
- `subagent-acceptance-reminder.mjs`（SubagentStop，matcher implementer|code-reviewer|tester|deployer）会把收工前自检注回**子 Agent 自己**的上下文——实测 SubagentStop 的 additionalContext 落在刚停下的那个子 Agent 上，主 Agent 这侧收不到。所以主 Agent 验收靠读回执正文，没有机器提醒兜底。

### 升级阶梯：BLOCKED / NEEDS_CONTEXT 怎么办

禁原样重试。重派必须至少变更一项（上下文 / 范围 / 角色 / 模型），同 prompt 同模型原样重发属于赌运气：

| 步 | 动作 |
|---|---|
| ① | 缺什么补什么，带齐上下文重派 fresh 实例 |
| ② | 补不齐就砍范围重切任务 |
| ③ | 属缺陷定位类换 bug-fixer 路线 |
| ④ | 三步都不通升级用户拍板 |

### red-locks-the-bug 与 `.claude/.red-verified`

不是每个 Task 都先写测试。red-lock 只给两类：线上行为的 bug、核心解析器 / 契约的缺陷。流程：先派 tester 补一条锁定该缺陷的失败测试（红）→ 主 Agent 验红（亲见 fail、失败因功能缺失非笔误）→ `touch .claude/.red-verified` → 派 implementer 修绿。审查发现的边角输入、参数花样、文案类记进 progress.md 残留，不开红锁。

守这条的是 `tdd-gate.mjs`，挂在 PreToolUse(Agent)，只在 `subagent_type` 为 `implementer` **且派单 prompt 含 red-lock 关键词**（bug / 修复 / 缺陷 / 线上 / 生产 / 解析器 / 契约 / 状态机 / schema / 迁移 / 鉴权 等中英说法，全表在文件头 `RED_LOCK_KEYWORDS`）时起作用——UI、文案、配置类的单子静默放行，不用再 `touch .tdd-exempt`；advise 档同一单子一小时内只提醒一次（`.claude/.tdd-gate-advised`）。一个下游看板项目两天里它响了 23 次、全是误报（2026-10-30 账本），关键词门就是为这个加的：

| 档 | 行为 |
|---|---|
| fast | off，静默 |
| standard（默认） | advise，只提醒（exit 0） |
| strict | block，真拦（exit 2） |

标记有**两小时时效**（`MARK_TTL_MS = 2 * 3600 * 1000`）：验红验的是这一轮改动，不是一劳永逸。过期的标记当场删掉——本仓一枚 9 月 11 日留下的空 `.red-verified` 让闸静默放行了四天，过期标记比没有标记更坏。UI / 样式 / 非 TDD 逻辑的 Task 用 `touch .claude/.tdd-exempt` 显式声明豁免，同样两小时。

它挂 Agent 不挂 Bash：派 Sub-Agent 永远走 Agent 工具，不经过命令行。按命令文本匹配 implementer 只会误伤 `cat …implementer.md` 这类读文件命令。

当前档位与各闸模式看这条：

```bash
node .claude/harness/harness.mjs tier status
```

你会看到（本仓默认档）：

```
tier: standard, source=default
{"tier":"standard","source":"default",...,"hooks":{...,"pre-commit-check":"block","stop-gate":"advise","tdd-gate":"advise","no-direct-code-guard":"block",...}}
```

### Git 工作流

`dev-builder` [Git 工作流] 的规则与看着它的闸：

| 规则 | 谁守 |
|---|---|
| 原子提交：每完成一个独立功能就 commit，一个 commit 一个逻辑变更，不攒到 Phase 结束 | 自觉 |
| 前缀：`phase-N:` / `feat:` / `fix:` / `refactor:` / `chore:` | 自觉；四步走里的修复用 `fix:` |
| 提交门槛：本次改动涉及的栈编译或语法检查通过才许 commit | `pre-commit-check.mjs`（PreToolUse Bash，命令含 `git commit`） |
| push 由 hook 处理 | `auto-push.mjs`（PostToolUse Bash，命令含 `git commit`） |
| 多个独立 repo 各自 add / commit / push 分开执行 | 自觉 |

`pre-commit-check` 按栈卡编译：

- 只检查本次 staged 改动涉及的栈，不全量误伤（改 `.md` 不会触发 tsc）。
- TS：`tsc --noEmit`（找最浅的 tsconfig.json，深度 ≤ 3）。
- Python：优先 `ruff check`，降级到 `py_compile`；降级路径先探一个真解释器（Windows 上裸 `python3` 常是 Microsoft Store stub），逐文件编译，只有输出含 `SyntaxError` 才拦。
- 工具未安装 → 降级或跳过该栈，绝不因环境缺工具卡死 commit。
- 大仓四态门：catalog 存在才启用。
- 档位：standard / strict 是 block（exit 2 阻止 commit）；fast 是 advise（照跑照报不拦）。

`auto-push` 不解析 hook 输入的退出码字段（跨版本不稳），用 git 状态判：命令匹配 `git [全局选项] commit`（`git -c user.name=x commit` 也算），有上游分支且本地领先上游的 commit 数 > 0 才 `git push`；没配上游直接跳过。它在 fast 档是 off。`dev-builder` 写的「保护分支不自动推」是规则文字，hook 代码里没有按分支名判断的逻辑——保护分支靠远端的分支保护规则挡。

主 Agent 自己动 Edit / Write 写 `src/` `app/` `lib/` `components/` 这类业务源码时，`no-direct-code-guard.mjs`（PreToolUse Edit|Write）在 standard / strict 档 exit 2 拦下；子 Agent 里的写入带 `agent_id`，一律放行。

### branch-finisher 收尾菜单

`/branch-finisher` 设 `disable-model-invocation: true`——合并 / 清分支是副作用工作流，主 Agent 只能建议，你亲自敲。它先探环境、过测试闸、再给条件化菜单：

**环境检测**三类：

| 环境 | 判据 |
|---|---|
| 正常分支 | `git symbolic-ref -q HEAD` 有输出，且 `git rev-parse --git-dir` 与 `--git-common-dir` 相同 |
| linked worktree | 两个 git-dir 不同（排除 submodule 误判） |
| detached HEAD | `git symbolic-ref -q HEAD` 无输出 |

有未提交改动先提示提交或暂存，不带着脏工作区收尾。

**前置闸**：派 tester 跑回归，证据是运行器真实输出（passed / failed 计数）。全绿放行；有红按代码错 / 测试错分流修到全绿；无测试基建提示先补，或由你显式放行（记录这是无测试保护的收尾）。

**菜单**：

| 环境 | 选项 |
|---|---|
| 正常分支 | 1 合并到主分支（切主分支 → `git merge <branch>` → 处理冲突 → push）；2 提 PR（需 gh CLI：push → `gh pr create`）；3 暂留继续 |
| linked worktree | 同上三项，外加收尾后清理 worktree；合并在主工作树执行或 push 后由主工作树拉取 |
| detached HEAD | 先 `git switch -c <new-branch>` 收进命名分支，再回正常分支菜单 |

**清理**：已合并的分支用 `git branch -d`（不用 `-D`，未合并时 `-d` 会拒绝是保护）；提了 PR 待合并的不本地删；`git worktree remove <path>` 前确认干净。收尾前后各跑一次 `git status` + `git worktree list` 做 baseline。合并冲突暂停报告冲突文件等你决定，不擅自取舍。

---

## 精通：内部机制与边界

### 四个执行角色的定义

`.claude/agents/*.md` 的 frontmatter 定了模型与熔断线，正文定了职责与 Non-goals：

| 角色 | 模型 | maxTurns | memory | 只读？ | 关键 Non-goal |
|---|---|---|---|---|---|
| implementer | sonnet | 100 | 无 | 否 | 不自判「通过审查 / 可提交」；不引未授权新依赖；不做范围外重构；失败必须可见（禁空 catch、禁静默重试、禁静默降级） |
| code-reviewer | opus | 60 | project | 是（Edit/Write 只用于自己的 agent memory） | 不判「可合并 / 可发布」；不动手修；不扩大审查范围 |
| tester | sonnet | 60 | project | 否（只写测试） | 不判「功能正确」；不修业务代码；不为凑绿放宽断言 |
| deployer | opus | 60 | 无 | 否 | 不判「部署成功」为最终结论；卡点未过回 BLOCKED |

四者 `disallowedTools: Task`——Sub-Agent 不再拉 Sub-Agent，主 Agent 是唯一编排者。

模型分档（`subagent-dispatch.md` [派发形态]）：Task 定为 HIGH 时派单显式传 `model: opus` 升级；纯机械任务（改文案 / 样式微调 / 搬运）可传 haiku。记录类角色（progress-recorder / feedback-observer）用 `subagent_type: "fork"` 继承主对话全文；执行类四角色 fork 是污染不是红利，一律 fresh。

### 隔离原则为什么是铁律

- 每个 Task 一个 fresh 实例——防 Task A 的错误假设污染 Task B。
- 写测 ≠ 被测作者——自码自测会把作者的错误假设原样写进断言。tester 必须是与写该代码的 implementer 不同的实例；大仓启用后 `record-authorship.mjs`（PostToolUse Edit|Write|NotebookEdit）记谁写了哪些文件，`review` 的 verdict 据此拒绝自审 ACCEPT。
- 跨 Task 编码默认串行，同文件改动或有依赖一律串行；只读 / 可汇总的工作（审查、测试、探索）才是并行甜区。用户说「快点」≠ 授权并行铺开，正解是砍范围、串行提效。

Workflow 编排（`.claude/rules/workflow-orchestration.md`）是多个无依赖单位时的规模化上层，须用户显式 opt-in（多 Agent 耗 token 约 15 倍）。判据轴是「这些单元的决策要不要自洽」：编码要自洽 → 别并行；审查维度 / 测试目标 / 代码库探索不要自洽 → fan-out 甜区。并行写文件的 implementer 用 `agent(prompt, {agentType:'implementer', isolation:'worktree'})` 让 Claude Code 自建自清临时 worktree。

### 派发前置自检

CLAUDE.md 要求派发前确认已备齐完整任务上下文，这一步靠自觉。一份自检清单：

1. 涉及的 Spec 条目原文抄进 Business Context 了吗（含规则与例外）？
2. progress.md Pinned / Decisions 里适用本 Task 的规则引日期抄了吗？
3. `domain/` 存在时，按域与本 Task 会碰的技术对象匹配口径了吗？`docs/design/` 存在且改动落在某份设计详述的代码范围里时，规则编号抄了吗？
4. Scope 里的文件路径都是真路径吗？Existing Pattern 给了具体文件吗？
5. Verification 是能跑的命令，不是「跑一下测试」？
6. 档位写在 Goal 首行了吗？HIGH 传 `model: opus` 了吗？
7. red-lock 适用吗？适用的话 `.claude/.red-verified` 是两小时内的吗？
8. 派静默 Sub-Agent 前一句话告知用户了吗（静默运行 / 预计耗时 / 完成会通知）？

### 三文件同步在开发阶段的落点

每个 Task 与 Phase 都会产生三类东西要进 progress.md：决策（选型 / 取舍 / 否决 / 撤回）进 Decisions，带依据 / 适用范围 / 取代哪条；完成项进 Done；约束进 Pinned。决策不许埋进 Done 叙述充数。Medium / Low finding 的残留清单、四态门 CONCERNS 的残留、跳过某阶段的理由，都写 progress.md。写进文件即时做，入库随下一个有代码的提交，不为记账单独提交。

`three-file-sync-gate.mjs`（Stop）在任何档都只提醒不拦。

复杂模块的算法规则另有一层：`docs/design/<模块名>-设计.md`（设计详述，模板在 `arch-designer/templates/design-detail-template.md`）。每条规则一个编号，写规则原文、来源、合成例子、代码位置、常量和测试名；测试里用 `# rule: 编号` 或 `// rule: 编号` 标它验的规则。`node .claude/scripts/design-trace.mjs` 报三类缺口——有编号没测试、测试标了不存在的编号、常量表与代码值对不上，rc 0 全对、1 有缺口、2 用法错、3 脚本自身出错。progress.md 的 Decision 属于某模块算法规则的，正文进设计详述、progress 只留一行指针。同一个 Stop 闸会查「改了设计详述代码范围里的代码、设计详述没改」，这一条单独一档 `design-detail-sync`：standard 提醒、strict 拦。细则见 `.claude/rules/design-detail.md`。

### 边界

- 主 Agent 不亲手写业务代码——不是效率取舍，是隔离与可验收性的前提。仅 Product-Spec / CHANGELOG / DEV-PLAN 这类文档主 Agent 可直接写。
- Sub-Agent 不 commit，commit 由主 Agent 验收后执行；也不 push（auto-push 挂在主 Agent 的 Bash 上）。
- Task 拆分归 dev-builder 的 Plan Mode，不归 dev-planner（它不定函数签名、不定测试用例、不定分支策略）。
- 用户强调某个环节（「这次一定要测」）是追加要求，不替换基础流程，review 闭环照常走。
- fast 档（用户明示；`--hours` 硬上限 8 小时，连续开发期 `--sticky` 到撤销为止）下不自动派 tester / code-reviewer、不进 per-Task 闭环、不受四步走与 red-locks 约束，stop-gate 直接 off；implementer 直接交付「变更清单 + 实际执行结果 + 已知顾虑」；同一份代码全量测试只跑一次，闸与审查的过程不念给用户只报结论；static-check 之类廉价闸不在跳过范围。

Windows 差异：`plan-lint.sh` 在 Git Bash 跑；hook 全是 `node` 跑的 `.mjs`，`setup.ps1` 装出来的与 bash 侧逐字节同一份，只要 `node.exe` 在 PATH 上；`pre-commit-check` 的 Python 探测已处理 Store stub；`touch .claude/.red-verified` 在 PowerShell 用 `New-Item -ItemType File -Force .claude/.red-verified`。

---

## 常见坑

| 坑 | 表现 | 怎么办 |
|---|---|---|
| DEV-PLAN 写「类似 Task 2」 | plan-lint `占位符命中: 类似 Task` | 每条 Task 独立写齐文件路径 + 改动 + 验证命令 |
| Phase 段名改了措辞 | plan-lint `缺字段 **验收标准**` | 五个锚点原文照抄，加粗与冒号都不能变 |
| REQ 覆盖假绿 | 「已知风险」段提到了 REQ-X，以为算覆盖 | 只有 `- **Task N.M：**` 行里的引用算覆盖 |
| Business Context 写 N/A | implementer 回 NEEDS_CONTEXT 或按自己理解填规则 | 从 Spec 规则与例外、progress.md、domain/ 抄进去 |
| 派单粘历史 | 把前几个 Task 的总结贴进派单 | 传文件路径不传历史，贴历史的派单里 99% 是废话 |
| 用 git diff 证明新建文件 | 空输出 + rc 0 被当「没改」或「改好了」 | `wc -l` + 内容锚点 + `git status` 认 `??` |
| 拿「已派发」当「已完成」 | 后台 Sub-Agent 还没回，主 Agent 已经说做完了 | 验收必须等结果到手 |
| 同 prompt 原样重派 | BLOCKED 后换个实例再发一模一样的单 | 升级阶梯至少变一项 |
| 忘了 `echo clean` | strict 档 Stop 被拦；standard 档每次停止都有提醒 | 验收通过后 `echo clean > .claude/.needs-review` |
| `.red-verified` 过期 | 明明 touch 过，tdd-gate 还是提醒 / 拦 | 两小时时效，验红后立即派 implementer；过期重新验红 |
| commit 被 pre-commit-check 拦 | exit 2，stderr 列出 tsc / ruff 错误 | 修到零错误再提交；不是靠 `--no-verify`（那是 git 的钩子，这是 Claude Code 的 PreToolUse，绕不过） |
| commit 后没自动 push | 本地领先但远端没动 | 查 `git rev-parse --abbrev-ref @{u}`——没配上游 auto-push 直接跳过；fast 档 auto-push 是 off |
| 主 Agent 直接改 src/ | `no-direct-code-guard` exit 2 | 派 implementer；文档类文件不受限 |
| tester 与 implementer 同一个实例 | 断言照抄实现，测试永远绿 | 派与实现者不同的 fresh 实例 |
| 一个 Sub-Agent 跑一小时 | 等不到回执 | 单次派单预期 > 60 分钟就是分解不合理，回去重切 |
| CONCERNS 当 PASS 用 | 残留没记，下个 Phase 忘了 | CONCERNS 必须带残留清单进 progress.md |
| WAIVED 安全缺口 | 四态门写了 WAIVED 但缺口是密钥 / 数据丢失类 | 不许 WAIVED，只能 FAIL 停下修 |
| detached HEAD 直接合并 | 当前提交无分支引用，切走就丢 | branch-finisher 先 `git switch -c` 建分支 |
| 用 `-D` 删分支 | 未合并的工作被删 | 用 `-d`，被拒绝就是保护在起作用 |

下一章：[06 审查、测试、修复](06-review-test-fix.md)——三 Stage 审什么、测试预算怎么分、bug 怎么修、什么时候上红蓝对抗。
