# 三姊妹仓增量分析（2026-08）

> 分析范围：只看三仓相对已分析基线的**新提交增量**，找 cc-base（v1.10.0）尚未吸收的东西。
> - codex-base：5396785（v2，已析）→ 2384b66 "feat: upgrade Codex Base to v3 with five-attribute governance"（2026-08-07）
> - cursor-base：fa3ba8a（已深读）→ 06e436f "service supervision, integrity, retention, and design skills"（2026-08-07）+ 8017024 "let git push reach the approval prompt instead of a hard deny"（2026-08-14）
> - pi-base：6d839cf（已析）→ a5f22c4 "架构防腐与五性治理 + arch-designer/dfx-designer skill"（2026-08-07）
>
> cc-base 既有基线（对照用，来自 harness-v2-cross-pollination.md）：五性证据门（S11）+ arch-check（S12）+ fitness（S13）+ adapters（S14）+ adr-check（S15）+ arch-trend 棘轮（S16）+ catalog/impact/context-pack + diff-bound 回执 + waiver 禁词 + supervisor.mjs + gate-log 台账（lib-gate-log.sh + gate-audit.sh）+ stop-gate 三振熔断。已明确拒绝：task 状态机、持久 quality ledger、shell 全事件语义分类器、runtime-sync 双份校验、资源锁、SubagentStop 机械拦截。
> 判断以三仓源码为准（三仓 HEAD 即各自增量尖端，file:line 均对当前工作树有效）；分析日期 2026-08-16，只读，唯一写操作是本报告。

三仓增量高度趋同——都在补「五性治理 + 服务守护 + 主动风险」这一层，大量内容是从 cc-base v1.10.0 授粉**出去**的回流（arch/dfx skills、fitness 五规则、supervisor、feedback 教训库），这部分全部略过。下面只报 cc-base 没有的、或落地取舍不同的。

---

## 一、codex-base v3 增量（5396785 → 2384b66）

### 同构项（cc-base 已有，略过）

五性覆盖判定含反证优先（`quality.mjs` attributeCoverage ≈ cc-base S11 assessAttributes）、arch check/baseline（≈ S12/S16）、adr check（≈ S15）、fitness 五规则（≈ S13）、arch-designer/dfx-designer skills（授粉回流）、服务守护 `services.mjs`（≈ cc-base supervisor.mjs，其具名注册表与 cc-base `--id` 多实例等价）、gate-log 拦截台账 + `guard audit`（`audit.mjs:11,51` ≈ cc-base lib-gate-log.sh + gate-audit.sh，连"gates earn their keep with evidence"的措辞都同源于 cc-base gates-need-empirical-validation）、stop 三振熔断（`hooks.mjs:559-590` ≈ cc-base stop-gate.sh 的 `.stop-gate-strikes` 连拦 3 次放行）。

### 增量发现

**1. retention——证据/上下文/会话的保留销毁策略（隐私 by design）**
`state prune` 按策略清理：evidence 按 `evidenceMaxAgeDays`（默认 30 天）+ `evidenceMaxFiles`（300）修剪，**活跃任务引用的证据与每 (task,check) 的最新回执证据永不删**（保住新鲜回执的可验证性）；context pack 留最近 50 个；session 记录写入时就地封顶 200 条（"retention starts at write time"，`hooks.mjs:613`）。证据：`retention.mjs:7-11`（政策声明）、`:39-111`（pruneState 主体，保护集计算 `:49-60`）；配置默认值 `config.mjs` RETENTION_DEFAULTS。
cc-base 现状：运行态各自为政——trend 台账自限 500 行、supervisor 日志 5MB 轮转，但 `.claude/evidence/gate-block.log` 无限追加（lib-gate-log.sh:15 无轮转）、red-blue 证据包无清理、context-pack 产物无上限。五性里把「隐私」定义成"收集/使用/存储/**销毁**合规"（quality-attributes.md:10），自己的运行态却只积不销。
CC 原生承载：harness.mjs 加 `prune` 子命令（读 harness.json 可选 retention 段，缺省用默认值），gate-block.log 在 lib-gate-log 里加 4MB 轮转（codex 同款 `audit.mjs:15-17`）；doctor.sh 报告超限。纯 Node/bash，无新 hook 事件。

**2. privacy 升入保护属性集（不可 fast-skip、不可豁免）**
codex 把 `UNWAIVABLE_ATTRIBUTES = {security, safety, privacy}`（`receipts.mjs:171`）、`PROTECTED_ATTRIBUTES` 同三元组（`quality.mjs:13`）：携带这三个属性的 check 在 matrix 校验期就拒绝 `allowFastSkip`，waiver 创建/生效双拒。
cc-base 现状：五性含隐私，但 waiver 禁词表是 `safety|security|secret|credential|destructive|push|deploy|production`（harness.mjs:1992）——**没有 privacy**，`attribute:模块/privacy` 的属性 waiver 可以表示、high 档隐私缺口可被推迟。与"隐私与 security/safety 同为不可协商项"的五性立场不自洽。
CC 原生承载：harness.mjs 禁词表加一个词 + selftest 补一例 + quality-attributes.md 改一句。约 3 行的修正。

**3. 损坏状态隔离区（quarantine：不 brick 也不静默重建）**
运行态 JSON 损坏时：改名为 `*.corrupt-<ts>` 保全证据 → 追加 quarantine.jsonl 事件 → 调用方用默认值继续 → SessionStart/risk scan 播报"state file was corrupt and quarantined; verify no work was lost"。证据：`state.mjs:9-46`（quarantineState/quarantineEvents）、readState 接入 `:100-107`、播报 `risk.mjs:73-75`。设计注释直说：「损坏状态既不能 brick harness（韧性）也不能被静默重建（可审计）」。
cc-base 现状：各 hook 对自己的状态文件多为"损坏当无状态重建"（如 stop-gate strikes 注释），静默丢证据；harness.mjs 读 JSON 损坏则报错。两头各占一半，没有"隔离+留痕+继续"的合流。
CC 原生承载：harness.mjs 的运行态读取路径（trend 台账/回执/waiver）统一走 quarantine helper；session-rules-banner.sh 发现 `*.corrupt-*` 文件时播报一行。

**4. risk scan——主动风险扫描 + SessionStart 播报「状态衰变」**
`risk scan` 把静默腐烂的状态变成分级 findings：stale task（>72h）、账本链断裂、**同一 check 连败 ≥3 次**（"stop retrying and run root-cause analysis"）、lease 过期、Fast Mode 已过期但 SKIPPED 回执还躺着、stop 连拦 2 次预警、隔离区事件、服务 crashed/dead、证据文件超限。SessionStart 注入 top-3 非 info 项；扫描本身失败时播报「Treat harness state as unknown, not healthy」。证据：`risk.mjs:30-110`、`hooks.mjs:505-512`。
cc-base 现状：session-rules-banner 只播 fast-mode 状态；doctor.sh 查结构完整性不查状态衰变。fast-mode 过期残留、supervisor crashed、`.needs-review` 隔夜残留、gate 从未拦截过——这些衰变信号现在没人主动报。
CC 原生承载：session-rules-banner.sh 加几个廉价检查（fast-mode 过期、supervisor 状态文件 status=crashed、.needs-review 非空且 mtime 隔夜、`*.corrupt-*` 存在），或 harness.mjs 加 `risk` 子命令供 banner 调用。不需要 codex 的 task/ledger 那半（已拒绝的机制不因此复活）。

**5. 空验证计划 = 配置失败，不是绿灯**
计划字段 `empty: checks.length === 0`（`quality.mjs:159`），completion 把空计划记为阻断项："verification plan selected no checks; an empty plan is a configuration failure, not a pass"（`quality.mjs:430-438`）。
cc-base 现状：`aggregateStates([])` 返回 PASS（harness.mjs:1830-1834）——受影响模块一个 check 都没配时 verify gate=PASS rc=0（除非属性缺口兜住）。**空计划假绿**是真实缺口：catalog 配了模块但忘配 checks 的仓，pre-commit-check 永远放行。
CC 原生承载：harness.mjs verifyPlan 一处语义修正——affected 非空且 checks 为空 → gate=BLOCKED（或 DEGRADED rc3 至少可见），selftest 补一例。

**6. 危险命令分类器加固（wrapper 剥壳 + 嵌套 shell 递归 + 管道）与 secret 读/拷/外传拦截**
- 剥壳：`effectiveWords` 剥掉 sudo/doas/nice/ionice/stdbuf/timeout/env/command/exec/nohup/time 与 `VAR=x` 前缀找真实程序（注释自曝踩坑："`timeout 5 git reset --hard` 曾被判成运行名为 5 的程序"），`nestedShellPayloads` 对 `bash -c`/`pwsh -Command` 载荷递归分类（深度 3），管道追踪拦 `curl | sh`；新增 fork-bomb、`dd of=/dev/`、force-push（放行 `--force-with-lease`）、`chmod -R /` 等规则。证据：`hooks.mjs:37-62,64-79,116-124`。
- secret 三向拦截：`classifySensitiveCommand` 拦 SECRET_READERS（cat/grep/strings/base64…读 `.env`/密钥文件）、SECRET_COPIERS（cp/scp…）、EGRESS_COMMANDS（curl/nc…外传，含"先 cat 密钥再管道给外传命令"的跨段追踪）、`dd if=secret`。证据：`hooks.mjs:185-213`、接线 `:431-432`。
cc-base 现状：dangerous-pkill-guard 只拦 pkill/kill -9 一族；**没有任何 secret 文件读取/外传的运行时闸**（只有 CLAUDE.md 密钥隐私铁律 prose + fitness 的仓内硬编码密钥扫描——防的是"写进代码"，不防"读出来发走"）。harness-v2 拒绝过 cursor 的全事件语义分类器，但这里是窄得多的两件事：给已有闸换更硬的分类器、补 secret 读取闸这个空白。
CC 原生承载：PreToolUse(Bash) 新 hook（.sh/.ps1 成对）或扩展 dangerous-pkill-guard：先剥壳再匹配、`-c` 载荷递归一层、secret basename 表（.env*、*.pem、*.key、id_rsa、credentials）配 READERS/EGRESS 两个命令集。fail-closed deny + gate_log 记账。注意保留 `.env.example` 白名单。

**7. guardrail 资产写入通报（改护栏可以，但必须可见）**
PostToolUse 检测写入 `.codex/config.toml|harness.json|runtime/|rules/|agents/` 时不拦截，但记 gate-log 并注入 systemMessage："Guardrail asset modified: … Verify this change is intended; doctor will flag critical drift."（`hooks.mjs:452-479`）。
cc-base 现状：存量资产铁律是 prose + doctor 事后 drift 检测；session 内静默改掉 hook/skill 时没有当场提示。
CC 原生承载：PostToolUse(Edit|Write) hook 匹配 `.claude/hooks|skills|agents|CLAUDE.md` 路径 → additionalContext 一句"家底文件已被修改，确认符合存量资产铁律（HIGH 档需用户批准）"。与既有铁律互补，机制化"改了要说"。

**8. fail-streak 连败 ≥3 → 强制换根因模式**
completion 里同一 check 连败 3 次时在 reason 上追加"stop retrying, run root-cause analysis (bug-fixer) before the next attempt"（`quality.mjs:236-243,465-467`），risk scan 同报。防「无脑重跑期待自愈」。
cc-base 现状：无状态 verify 不记历史，无此信号；行为约束只散在 bug-fixer skill。
CC 原生承载：轻量版——verify 在 `.claude/.runtime/` 记每 check 最近 N 次结果（几行 JSON），连败 ≥3 在输出注明；或先只做 prompt 层（CLAUDE.md/bug-fixer 一句"同一验证连败 3 次禁止再重跑，必须转根因分析"）。

另有两处 verify 语义硬化随手可捡：**非必选 check 跑了且 FAIL 也永不 acceptable**（"optional failures silently disagreeing with the gate was a known failure mode"，`quality.mjs:471-480`——cc-base 无 required/optional 之分、执行即计入聚合，天然满足，仅记录立场）；waiver 生效判定统一走 `waiverForbiddenReason`（`receipts.mjs:144,173-178`）双保险。

### 建议吸收（codex-base v3）

| 项 | 载体 | 成本 |
|---|---|---|
| privacy 入 waiver 禁词/保护集 | harness.mjs 禁词表 + selftest | 极低，立即 |
| 空验证计划=失败 | harness.mjs verifyPlan 语义 + selftest | 极低，立即 |
| secret 读/拷/外传闸 + 危险分类器剥壳加固 | 新/扩 PreToolUse hook（.sh/.ps1）+ gate_log | 中 |
| retention prune + gate-block.log 轮转 | harness.mjs 子命令 + lib-gate-log 轮转 + doctor 报告 | 低-中 |
| 状态隔离区（quarantine） | harness.mjs 状态读取 helper + banner 播报 | 低 |
| risk 衰变播报（轻量子集） | session-rules-banner.sh 扩展 | 低 |
| guardrail 写入通报 | PostToolUse hook 一枚 | 低 |
| fail-streak 换根因（先 prompt 层） | CLAUDE.md / bug-fixer 一句 | 极低 |

### 不搬（codex-base v3）

- **哈希链账本**（`receipts.mjs` appendChainedLedger/verifyLedgerChain）：防"删掉后来的 FAIL 复活先前的 PASS"，前提是持久回执账本——cc-base 已拒绝 ledger（verify 无状态即跑即判，历史回执不背书完成，攻击面不存在）。链随 ledger 一起维持不搬。
- **task envelope / planHash / executor 绑定**：v2 时已拒，v3 未改变理由。
- **多服务具名注册表 + service 子命令族**：cc-base supervisor.mjs `--id` 多实例已等价；声明式注册表的增益（risk scan 可枚举所有服务）在 cc-base 形态下靠扫 `.runtime/supervisor/*/state.json` 同样可得。
- **guard audit / stop 三振**：cc-base 已有同构物（gate-audit.sh / .stop-gate-strikes），无需重复。

---

## 二、cursor-base 增量（fa3ba8a → 06e436f + 8017024）

### 同构 / 趋同 / 回流项（略过）

服务守护（serviceSupervise 一族）、retention（`src/harness.mts:3419-3470`，默认 30 天/200 evidence/50 context pack）、risk scan（`:3279`）、fail-streak 阈值 3（`:1840`）、哈希链账本 + 证据重哈希（`:1439`，TAMPERED/MISSING）——与 codex v3 全面趋同，判断同上（chain 不搬、retention/risk 以 codex 节的轻量版吸收即可，不重复列）。architecture-design/dfx-design skills、`docs/feedback/` 教训库（8 条教训全部注明 "distilled from … sibling harness corpora"——是 cc-base feedback 的授粉回流，含 watchdog/stop-loss、restart-storm 两条，cc-base 分别已有同名 feedback 与 supervisor 熔断机制）、600k 行实测（cc-base selftest 已有 120 模块×3 万路径断言）——均略过。CAPABILITY-MATRIX 明确记录从 cc-base 吸收了"supervisor liftoff confirmation and breaker semantics; the feedback-to-graduation lesson pipeline"（docs/CAPABILITY-MATRIX.md:7）。

### 增量发现

**1. push 走审批而非硬拒——权限层叠会互相短路（8017024）**
cli.json deny 名单里的 `Shell(git:push*)` 把 hook 的 ask 分类**短路**了：本意"push 要问用户"，实际"push 永远被拒且用户根本看不到审批提示"。修复=从 deny 名单删除，让 beforeShellExecution hook 的 ask 生效。证据：8017024 diff（.cursor/cli.json -1 行）+ commit body "The cli.json deny list short-circuited the hook's ask classification"。
对 cc-base 的意义：① 设计原则——**破坏性但业务必需的操作（push/deploy）应落"停等审批"档，deny 硬拒只留给纯破坏（reset --hard / rm -rf）**，cc-base 审批三档 HIGH 档已是此立场，且 auto-push.sh 走的是"commit 获批则 push 顺势"的另一头，无直接冲突；② 教训本体——**多层权限机制（settings.json permissions × hooks）叠加时，先到的 deny 会吞掉后面的 ask**。cc-base 现在 defaultMode=bypassPermissions + hooks 单层，没这个病；但未来若引入 permissions.deny 规则（Claude Code 里 deny 优先于一切、bypassPermissions 也不豁免），必须先核对不会短路 hook 侧的意图。
CC 原生承载：一条 feedback（permission-layers-deny-shortcircuits-ask），不改代码。

**2. waiver 三重收紧（本仓最值得搬的一组）**
- **跑了且 FAIL 的检查永不可豁免**：`WAIVABLE_STATUSES = {MISSING, BLOCKED, SKIPPED}`（`src/harness.mts:1793`），注释与 PROTOCOLS 同口径："an executed FAIL is evidence of a defect and is never waivable / deferring evidence is how completion claims go false"（docs/PROTOCOLS.md Waiver binding 节）。waiver 只给"跑不了的"（缺工具 BLOCKED、平台不符 SKIPPED、没接线 MISSING）。
- **waiver 绑 diff**：每条 waiver 记 `check + diff_sha256 + base_commit`，任何改动使 diff 移动即静默失效（`waiverFor` 按 diff_sha256 匹配，`:1795-1809`）——豁免的是"这一版改动上的这个检查"，不是一个时间窗。
- **critical 档认领检查创建即拒**：`checkClaimsCritical`（`:1811-1830`）——受影响模块把某属性定为 critical 时，其认领 check 的 waiver 在申请时就被拒，不是事后判定。
cc-base 现状对照：S10 applyWaiver 允许把非 security/safety 的 **FAIL** 洗成 SKIPPED（harness.mjs:1886-1888 注释明说）；waiver 只有 expiresAt 时间界，不绑 diff（同一 waiver 在有效期内给多轮不同改动背书）；critical 属性由 assessAttributes 层兜底（attribute waiver 只放 high）但 check 级 waiver 创建时不查属性档位。
CC 原生承载：harness.mjs S10 三处增强——① applyWaiver 的可豁免状态收窄为 BLOCKED（FAIL 不再可洗，flaky 测试的正解是修测试或降为非必选，不是豁免）；② waiver schema 加可选 diffHash 字段，validateWaiver 时有则比对当前 `diff-hash`（S2 已有该命令，基建现成）；③ createWaiver/validate 查 catalog：scope 指向的 check 被 critical 档模块认领即拒。取舍提示：①会改变现行为——存量 waiver 里若有洗 FAIL 的用法需迁移，按存量资产铁律须用户拍板。
- 同主题一并考虑：**无认领检查的属性缺口不可被 waiver 遮盖**——"An attribute with no claiming checks cannot be waived at all — that is a wiring defect in the catalog or matrix, and an exemption must not paper over it"（docs/QUALITY-ATTRIBUTES.md Evidence integrity and deferral 节）。cc-base 的 `attribute:模块/属性` waiver 目前可以推迟一个纯布线缺陷（没接线≠证据被推迟）。改法：assessAttributes 对 zero-claiming-checks 缺口忽略 attribute waiver。

**3. 风险档累积并入计划且入 planHash**
`task start --risk high` 把 riskChecks 各档**累积并集**（high ⊇ medium ⊇ low，"raising declared risk can only add evidence"），且风险档进 planHash——改风险档即作废旧回执（docs/QUALITY-ATTRIBUTES.md "Task risk widens the plan" 节）。
cc-base 对照：风险来自模块 riskTier 而非任务声明，catalog.riskChecks[risk] 是按档取用非累积。取舍不同而非缺口：cc-base 的模块定档已在 catalog 评审期锁定；若某档清单没写全，属于配置错误由 plan-lint/catalog-lint 管。低优先，可在 harness-large-repo.md 补一句"高档清单应包含低档全部检查"的编写规约即可。

**4. Fast Mode 被 cursor 明确拒绝（反方论证，记录在案）**
"A global fast mode bypass window [rejected]: per-check, diff-bound, expiring waivers give the same pressure valve without hiding which evidence was skipped, and **a mode flag is exactly the state that outlives its excuse**"（docs/CAPABILITY-MATRIX.md:11-15，同段还拒绝了跨 worktree 路径租约）。
cc-base 立场：Fast Mode 是用户显式要的家底（scaffold-development-skip-quality-gates feedback），且已有 TTL + banner 播报 + 安全不豁免三道缓解，不搬拒绝结论；但"模式旗标会活过它的借口"值得进 EVOLUTION 观察项——若 gate-audit 显示 Fast Mode 长期开启占比过高，cursor 的"细粒度 waiver 替代全局开关"是现成的收敛路径。

**5. record-lesson 的机器计数毕业候选（可选轻量）**
教训文件带 frontmatter（id/occurrences/first_seen/last_seen/graduated），重复发生时 +1 而非重写；`feedback list` 机器报"≥3 次的毕业候选"，risk scan 一并播报；`feedback lint` 作为 required check 保证语料可解析（"unreadable memory is no memory"）。证据：.cursor/skills/record-lesson/SKILL.md:8-24、src/harness.mts feedbackLessons。
cc-base 对照：FEEDBACK-INDEX.md 人工索引 + evolution-runner 判断毕业（3+ 次规则已有，靠读文判断而非计数）。差异只是"候选由机器数出来"。可选吸收：feedback 模板加 occurrences 行的书写约定，evolution-engine 扫描时优先读它；不必上 lint check。

**6. 服务状态"活性从 pid 现算，记录态只信终态"**
"Liveness is always synthesized from pids at read time; recorded status is trusted only for the deliberate terminal states stopped and crashed. A state file claiming supervision whose supervisor pid is dead reports dead"（docs/PROTOCOLS.md Service state 节）。cc-base supervisor status 已查 pid 存活，语义基本同构；值得对照自查一次"记录 running 但 pid 已死"是否显式报 dead 而非沿用记录态。

### 建议吸收（cursor-base）

| 项 | 载体 | 成本 |
|---|---|---|
| waiver 收紧：FAIL 不可豁免 / 绑 diffHash / critical 创建即拒 / 布线缺陷不可遮 | harness.mjs S10 + selftest；改行为需用户拍板 | 中，价值高 |
| 权限层叠教训（deny 短路 ask） | 一条 feedback 记录 | 极低 |
| record-lesson occurrences 计数约定 | feedback 模板 + evolution-engine 扫描规则 | 低（可选） |
| supervisor status 死 pid 显式报 dead 自查 | 对照检查，一次性 | 极低 |

### 不搬（cursor-base）

- **哈希链账本 + 证据重哈希 + quality verify TAMPERED**：同 codex 节理由——依赖持久 ledger（已拒绝），cc-base 回执本体已有 contentHash 防篡改（S7），无状态 verify 不消费历史回执。
- **Fast Mode 拒绝结论**：与 cc-base 用户家底冲突，只记录反方论证进观察项。
- **feedback frontmatter + lint 全套机制**：cc-base 的 FEEDBACK-INDEX + evolution-runner 已覆盖同一闭环，为机器可读重写全部存量 feedback 违背"家底风格无缝贴合"铁律，收益不抵扰动。
- **task 风险档累积机制本身**：cc-base 风险绑模块不绑任务，形态不同，无对应插槽。

---

## 三、pi-base 增量（6d839cf → a5f22c4）

### 同构 / 回流项（略过）

arch-check（layers/forbiddenDependencies/provides/禁令赢过声明/环检测）、attributes 六档 + none/minimal 强制 reason、fitness 五规则 + 抑制标记、pi-supervisor.mjs（自记"移植 cc-base supervisor.mjs"）、arch-designer/dfx-designer skills（自记"融合 cc-base 与 codex-base 两版"）——docs/CROSS-POLLINATION.md「第二轮吸收」节逐条注明来源是 cc-base/codex-base，全部回流，略过。60 万行目标与扫描上限提升（maxScanEntries 60000/maxModules 150）与 cc-base 已有规模冒烟同级。

### 差异化取舍（pi 落地时改了主意的地方）

**1. 架构存量债：git 版本化的 per-edge baseline，替代 runtime count 棘轮 —— 本轮三仓最有分量的一条**
pi 明确记录（docs/CROSS-POLLINATION.md 第二轮节、progress.md Decisions 2026-08-07）："存量债不走 runtime trend ledger（cc-base 的 --record/arch-trend），改为 config 内 arch.baseline（带 reason、可 review、stale 点名）——**债务是项目事实，应进 Git 而不是运行态**"。实现三要点：
- **边身份制**：baseline 是 `{from, to, reason}` 边清单（arch.ts:207 建 Map），只有**命中清单的那条边**被容忍（`:246-252` tolerated 桶）；任何新出现的 undeclared 边立即 FAIL。对照 cc-base arch-trend 是 **count 棘轮**（undeclared/forbidden/cycles 三个计数对比历史最优，harness.mjs compareRatchet）——计数制有个真实漏洞：**还掉一条旧债、同时添一条新债，计数不变即通过**，新债借旧债的额度混进来。边身份制天然免疫。
- **禁边与层违规永不进 baseline**：forbidden/layer 判定在 baseline 查表**之前**就归违规桶（arch.ts:234-244 先判 rule 再 `continue`，`:246` 的容忍查表只对 undeclared 可达）；progress.md 钉死"禁边与层违规永不可容忍"。对照 cc-base：arch-trend 把 forbidden 计数也纳入棘轮（selftest harness.mjs:811 历史含 forbidden:1 的记录参与比较）——即"越过隐私/安全边界的既有违规"也能作为旧债带病通过 `--gate`。但 forbiddenDependencies 本是**用户显式声明的安全/隐私边界**，与"忘了声明的依赖"性质不同，不该同享旧债豁免。
- **还清的债点名清除**：baseline 里已不再被观测到的边列为 staleBaseline 并提示"remove paid-off debt so the ratchet only tightens"（arch.ts:270-285）——棘轮单向性由清单卫生保证，而 cc-base 的 count 棘轮靠"历史最优"隐式保证、台账 git-ignored 每机各持（harness-large-repo.md:118 自陈"每机各持；团队要共享趋势可自行取消忽略"）——多人/多机协作时各自的历史最优不一致，棘轮基准漂移。
CC 原生承载：harness.mjs S12/S16 增强——① catalog（或 harness.json）加可选 `archBaseline: [{from,to,reason}]` 段，arch-check 对命中项报 tolerated 不 FAIL、对 stale 项点名；② **forbidden/layer 违规从 arch-trend 棘轮口径中剔除**（它们永远 rc1，不许当旧债）；③ arch-trend count 棘轮保留为趋势报告，`--gate` 职责让位给边身份制。存量债进 git 后 diff 指纹/context-pack 的排除规则相应简化（不再需要排除 runtime 台账）。这是对 cc-base 自研 S16 的一次有理有据的返修建议。

**2. builtin gate：防腐检查直接进完成门，不靠"记得接线"**
arch-check/fitness/attributes 做成 gate `builtin` 类型（gates.ts:124-139 runBuiltinGate 进程内执行，`:322` 与项目命令同路进 receipt 与 Completion Gate），pi 自记理由"复用既有完成门，不新增 hook 面"。
cc-base 对照：harness-large-repo.md:85 明说"arch-check / fitness / attributes 不走 hook 自动触发（成本考量），推荐进 catalog checks 由 verify 定向带跑"——能力等价但靠项目**自己记得**把 `arch-check` 写进 checks；忘接线时防腐闸静默不在场，且没有任何提醒。
CC 原生承载：不改执行形态，补一个"漏接可见"——catalog-lint（或 doctor）对声明了 layers/forbiddenDependencies 的 catalog 检查 checks 里是否有引用 arch-check 的条目，缺则 warning（与 S11"未接线=可见缺口"同一哲学，成本一条 lint 规则）。

**3. none/minimal 档缺 reason 前移到 config 解析期报错**
cc-base 的 UNJUSTIFIED_TIER 在 catalog-lint 期报；pi 挪到 config 解析期（CROSS-POLLINATION.md 自记"前移到 config 解析期"）——所有消费 catalog 的路径（impact/verify/attributes）都吃到这个校验，不依赖用户跑过 lint。轻微加固，cc-base 的 loadCatalog 已做结构校验，把该规则挪进去即可，低优先。

**4. 幽灵引用宁缺勿滥：无 adr-check 就退回人工评审**
pi 首版不做 adr-check 子命令，arch-designer skill 里规定"执法引用只准指向 Pi Base 真实存在的机制，无 adr-check 时退回 skill 纪律 + 人工评审，不留幽灵引用"（CROSS-POLLINATION.md）。cc-base 已有 adr-check（S15）且允许诚实 manual，立场一致且更完备，无需动作；记录 pi 的"未照搬"清单佐证 cc-base 判断：pi 也没搬 adapters add 自动改配置（改为对话式建议+用户确认）——与 cc-base "evolution 建议须用户逐条确认"同哲学。

### 建议吸收（pi-base）

| 项 | 载体 | 成本 |
|---|---|---|
| arch 存量债改 git 版本化 per-edge baseline（tolerated/stale 语义）+ forbidden/layer 退出棘轮容忍 | harness.mjs S12/S16 + catalog 可选段 + selftest | 中，价值高（修正自研棘轮的两处弱点） |
| L 档 catalog 未接 arch-check 的漏接提醒 | catalog-lint/doctor 一条 warning | 低 |
| UNJUSTIFIED_TIER 前移 loadCatalog | harness.mjs | 低（可选） |

### 不搬（pi-base）

- **typed extension / builtin gate 执行形态 / harness_arch 工具**：Pi 宿主专属（TypeScript 扩展 API），cc-base 单文件 .mjs + hook 接线形态不改；builtin 的实益（防漏接）以 lint 提醒承载即可。
- **fitness 规则并入 harness.json 单一配置**：cc-base fitness-rules.json 独立扩展点已稳定，合并只是包装差异，扰动家底无收益。
- **pi-supervisor.mjs**：cc-base supervisor 的移植回流，无新语义。

---

## 汇总：按性价比排序的吸收清单

1. **waiver 三重收紧**（cursor）：FAIL 永不可豁免、绑 diffHash、critical 创建即拒、布线缺陷不可遮——直击"豁免变后门"，基建（diff-hash/catalog）现成。
2. **arch 存量债 per-edge baseline 进 git + forbidden 退出棘轮**（pi）：修正 S16 count 棘轮"换债不被抓、每机各持、安全边界可带病"三处弱点。
3. **secret 读/拷/外传闸 + 危险分类器剥壳加固**（codex）：cc-base 唯一空白的运行时安全面（现只防写入不防读出/外传）。
4. **privacy 入禁词 + 空计划=失败**（codex）：两处几行级语义修正，立即可做。
5. **retention prune + gate-block 轮转 + 状态隔离区 + 衰变播报**（codex/cursor 趋同）：把"隐私销毁合规"从五性文档落到自家运行态，顺带治状态腐烂。
6. **guardrail 写入通报 + fail-streak 换根因 + 权限层叠 feedback**（codex/cursor）：三条低成本行为护栏。

不搬总口径：哈希链账本及其衍生（证据重哈希、chain 完整性 risk 项）——绑定已拒绝的持久 ledger；task/planHash 状态机——维持 v2 拒绝；Fast Mode 拒绝论、feedback frontmatter 全套、builtin/typed-extension 执行形态、多服务注册表——与 cc-base 家底冲突或已有等价物。
