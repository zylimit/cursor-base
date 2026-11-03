# Harness v2 交叉授粉记录（cursor-base / codex-base / pi-base / ccb-base → cc-base）

_审计日期：2026-08-06。四仓从头逐文件深读（非沿用 07-31 旧分析）：cursor-base@fa3ba8a（src/harness.mts 4498 行全读 + 全部 docs/catalog/adapters）、codex-base@5396785（v2 runtime lib 全读 + HARNESS-AUDIT.md）、pi-base@6d839cf（extensions/docs）、ccb-base（CROSS-POLLINATION.md + HARNESS-V2-LOG.md 结构）。判断以源码与测试为准，不以 README 宣传为准。_

## 落地总览（本轮已实现进 cc-base）

| 能力 | 来源 | cc-base 落点 |
|---|---|---|
| 五性按模块分级（8 属性 × 6 档，none/minimal 必须给 reason） | cursor-base QUALITY-ATTRIBUTES + ADR-0001 | harness.mjs S11 + catalog-lint 新错误码 + rules/quality-attributes.md |
| 覆盖判定（认领 check PASS 且无反证；反证压过佐证；未接线 = 可见缺口） | cursor-base assessQuality | S11 assessAttributes + verify `gate:BLOCKED_BY_ATTRIBUTES` rc2 |
| arch-check 真实 import 边 vs 声明图（12 语言提取 / provides / NodeNext 重写 / 禁令赢过声明 / 虚边与未行使图诚实报告） | cursor-base archCheck | S12 cmdArchCheck |
| forbiddenDependencies + layers（隐私/安全边界可执行化，分层只许向内） | cursor-base | catalog schema + S12 + lint SELF_FORBIDDEN/FORBIDDEN_DECLARED/UNKNOWN_LAYER |
| fitness 内置零依赖规则（密钥/PII 日志/静默吞错/无界重试/未挂单 TODO；minimumTier 跟档位走；行内压制） | cursor-base fitness | S13 + fitness-rules.json 扩展点 |
| adapters 工具表（semgrep/osv/trivy/gitleaks/syft/presidio/stryker/schemathesis/k6/checkov/oslo 映射属性；缺工具 BLOCKED 不假绿；接线≠选中） | cursor-base adapters | S14 + harness/adapters.json |
| safety 类与 security 同级（永不 fast-skip、永不可豁免） | 用户五性要求 + cursor waiver 语义 | runCheck / applyWaiver / waiver 禁词 |
| 属性 waiver 只放 high、critical 永不；security/safety 属性 waiver 靠禁词天然不可表示 | cursor tierIsWaivable + cc-base 禁词机制的涌现组合 | S11 + rules 文档 |
| NUL 分隔 + quotePath=false 路径清单（CJK 文件名不被转义破坏） | cursor-base splitNulPaths（8430f26 修复） | S2 splitNul / changedPaths / trackedFiles |
| glob 编译缓存（分类热路径 N×M 不再重编译） | cursor/codex 的性能审计结论 | S3 GLOB_CACHE + selftest 规模冒烟（120 模块 × 3 万路径 <2.5s） |
| tracked 截断 = 坏测量（cap + truncated 显式告警/降级） | cursor maxTrackedPaths / codex 审计「truncated 必须安全扩大」 | trackedFiles cap + catalog-lint TRUNCATED warning |
| 进程守护（宕机自动拉起 / 指数退避 / 重启风暴熔断 fail-visible / 健康探针治假活） | 用户韧性要求；pi-base runtime 输出上限与 fail-closed 思想 | scripts/supervisor.mjs + tests/test-supervisor.sh |
| 五性从需求到验证贯通（Spec 问五性 → planner 折进 catalog → fitness 随变更 → verify 门禁 → waiver 留痕例外） | codex-base 审计法 + cursor GOVERNANCE | rules/quality-attributes.md「贯通」节 |

## 各仓精华与刻意不搬

### cursor-base（本轮最大供体）
吸收：见上表主体。另有值得记录未搬项——
- **不搬** task start --owned 写基线（第三方改动阻断下一次写）：cc-base 的 per-Task review 闭环 + stop-gate 已覆盖同一风险面；task 状态机会引入第二套 active-task 语义，与 `.needs-review` 清单模型冲突。押后观察。
- **不搬** quality ledger（持久 receipts 500 条）：cc-base verify 是无状态即跑即判，ledger 属于「跨会话完成门」形态，当前 stop-gate 用 diff-bound receipt 已够；避免双真相源（codex 审计 4.5 同类教训）。
- **不搬** hooks 全事件语义分类器（beforeShellExecution 等 shell 解析器）：Claude Code hook 面与 Cursor 不同，cc-base 已有 dangerous-pkill-guard 等成对 .sh/.ps1 闸；整套 shell 语义分类器是大工程，防误操作收益边际递减。记 EVOLUTION 候选。
- **不搬** runtime-sync 双份编译校验（src/.mts vs 编译产物字节比对）：cc-base 单文件 .mjs 无构建步，无此问题。

### codex-base
吸收：HARNESS-AUDIT 的「结构 validate 永不写质量 PASS」「双真相源必漂移」「20 万行 5 秒内」审计法进了本轮验收标准；conservative checks on expandedToAll 思想已由 cc-base 保守全 fanout 承担。
- **不搬** planHash / executor role 绑定（high-risk 须 tester 执行的 receipt）：依赖持久 ledger + task 状态机；cc-base 的写测独立性由 CLAUDE.md 派单铁律 + tester agent 承担（流程层已闸）。记 EVOLUTION 候选（若未来加 ledger 一并考虑）。
- **不搬** 资源锁 / SubagentStop 信封机械拦截：前者服务于并发 gate 执行（cc-base verify 串行跑）；后者 Claude Code 的 SubagentStop 有既有 subagent-acceptance-reminder hook 承担提醒职责，机械 block 会与回传纪律的「信封」软约束重复且误伤率未知。

### pi-base
吸收：有界扫描（maxTrackedPaths/maxFiles 上限 + 显式截断）、「evidence 长日志入运行态、模型只看摘要」（supervisor 日志落 .runtime 同理）、compaction 固定字段思想已由 progress.md 三文件同步承担。
- **不搬** TypeScript Extension 运行时 / Plan Mode / 子进程调度：Pi 宿主专属。

### ccb-base
吸收：交叉授粉治理法本身（盘点 → 评估 → 辐射 → 记账，本文件即台账）；「有界对抗轮次」「test-guard 防删测」已在 cc-base feedback/红蓝审查体系里有同源物。
- **不搬** CCB 多进程编排、跨模型异构对抗：cc-base 纯 CC 单会话形态，结构上不可得（CROSS-POLLINATION.md 护城河节已有共识）。

## 第二批演进（2026-08-07 用户批准「现在就演进」后落地）

| 能力 | 来源 | cc-base 落点 |
|---|---|---|
| adr-check：活跃 ADR 必须指向真实执法（幽灵引用比没有更糟） | cursor-base adrCheck（Enforced-by 校验） | S15：内联 `### ADR-xxx`（Architecture-Design.md）+ docs/adr/*.md 双源；token 解析 check id / fitness 规则 / harness 能力 / 显式 manual；零可识别 = fail、manual-only 单列、retired 豁免、搭车未知词只上报不拦（与 cursor 差异：cc-base 允许诚实 manual——强制机器执法会把"选 PostgreSQL"这类不可机器化决策逼成假引用） |
| arch-trend 漂移棘轮：旧债可带病接入、新债零容忍 | ratchet test 业界模式 + codex 审计「truncated/degraded 要给接入路径」思想 | S16：`arch-check --record` 快照（失败也照记）→ `arch-trend --gate` 只在最新超历史最优时 rc 1；undeclared/forbidden/cycles 进棘轮，unresolved/unused 是上下文不进；台账 git-ignored + 排除出 diff 指纹与 context-pack |

## 验收证据（2026-08-06 当场跑出）

- `node .claude/harness/harness.mjs selftest` → `{"ok":true,"tests":92}`（61 → 92，新增 31 例覆盖 S11-S13 纯函数 + NUL + safety 豁免禁令 + 规模冒烟）
- `bash .claude/tests/cases/test-harness.sh` → PASS=64 FAIL=0（51 → 64，新增 arch-check 越禁边/漂移/修复、fitness 命中/压制、attributes 接线缺口、verify 属性门 rc2、adapters list/add/dry-run/未知 id）
- `bash .claude/tests/test-supervisor.sh` → PASS=4 FAIL=0（kill -9 自动拉起实证 childPid 更替 + restarts=1；崩溃循环熔断 crashed；stop 收敛）
- 规模冒烟：120 模块 × 30000 路径 lint 全归类 <2.5s（selftest 内断言）；35 模块 impact+context-pack 全流程 107ms
