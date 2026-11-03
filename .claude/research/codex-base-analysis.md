# codex-base 深度架构分析

> 分析对象：`D:\code\codex-base`（OpenAI Codex CLI 的产品开发 harness 脚手架，v2.0.0）
> 分析目的：为构建支持 20-30 万行代码库的下一代 harness 提取可复用的实战经验
> 分析日期：2026-07-30 ｜ 分析者：只读研究 Sub-Agent

---

## 1. 定位与运行时

**目标 agent**：OpenAI Codex CLI（本机验证版本 `codex-cli 0.146.0`，见 `docs/HARNESS-AUDIT.md:22`、`.codex/runtime/lib/doctor.mjs:177`）。这是把 `ccb-base`/SiteMaster 产品开发框架**移植到 Codex 原生能力**的脚手架，与 cc-base（Claude Code）是姊妹项目。

**如何运行**：纯 Codex 原生方案，**无 daemon / 无 tmux / 无数据库 / 无向量索引 / 无 CCB / 无外部多模型驱动**（`docs/HARNESS-AUDIT.md:300`、`docs/CAPABILITY-MATRIX.md:34-41`）。运行时是**单一 Node.js 20+ 控制面，零第三方运行时依赖**（`package.json` engines node>=20 + type module；`docs/HARNESS-AUDIT.md:249-255`）。8 个 Codex hook 事件各注册**恰好一个** Node dispatcher（`node .codex/runtime/harness.mjs hook <Event>`），以消除同事件并发顺序竞态（`.codex/config.toml:10-65`）。同一份 `.mjs` 代码跨 Windows + Linux（`command` 与 `command_windows` 镜像同一命令）。

**技术栈**：ESM `.mjs` 模块；CLI 分发器 `harness.mjs` + 12 个 lib 模块（catalog / context / quality / tasks / hooks / receipts / common / state / git / config / doctor）。配置为 TOML（`.codex/config.toml`）+ JSON（`.codex/harness.json`、module-catalog、verification-matrix）。Sub-Agent 定义为 `.codex/agents/*.toml`（Codex 原生格式）。Skills 为 `.agents/skills/*/SKILL.md`。

**整体架构**：三份「复制即用」交付面——`AGENTS.md`（主控 prompt，约 9.5KB，压在 24KiB 预算内）+ `.codex/`（runtime/agents/config/rules/harness schema）+ `.agents/`（skills/feedback/EVOLUTION/hooks/scripts）（`docs/HARNESS-AUDIT.md:238-247`）。维护资产（scripts/tests/docs/package）留在源仓库，不污染目标项目根目录。主 Agent = 唯一编排者（SiteMaster），派 9 个 Codex 原生 Sub-Agent 干活（`docs/CAPABILITY-MATRIX.md:30-32`）。

---

## 2. 核心机制全清单

### 2.1 Hook 控制面（安全闸 + 上下文注入）
- **单-dispatcher-每事件** — 目的：消除同事件多 hook 并发的顺序假设失效（Codex 0.146.0 已知问题，`docs/HARNESS-AUDIT.md:227`）。证据：`.codex/config.toml:10-65`（8 事件各一个），`dispatchHook` 路由 `.codex/runtime/lib/hooks.mjs:382-401`。
- **PreToolUse fail-closed 危险命令拦截** — 目的：机械阻断 git reset --hard / git clean -fdx / rm -rf / pkill / shutdown / mkfs 等高置信度破坏操作。证据：`classifyDangerousCommand` `.codex/runtime/lib/hooks.mjs:17-46`，正则规则 + shell 分段 tokenizer 双层判定；`preToolUse` `hooks.mjs:247-269`。
- **写路径策略拦截** — 目的：阻止写 `.git`、依赖/生成目录、密钥文件（`.env.*`、secretNames、secretExtensions），带 allowedSecretTemplates 白名单例外。证据：`pathPolicyReason` `.codex/runtime/lib/hooks.mjs:226-237`，`validateWriteTarget` 用 symlink-aware `resolveForWrite` 防仓库外逃逸 `hooks.mjs:239-245`。
- **malformed 输入 fail-closed** — 目的：hook 收到坏 JSON 时，PreToolUse 返回 deny、Stop/SubagentStop 返回 block，而非放行。证据：`hooks.mjs:384-388`、`malformedHookOutput` `hooks.mjs:423-427`。
- **SessionStart 上下文注入** — 目的：把 active task / Fast Mode 状态 / 工作树变更数 / 缺失项目文档 / feedback 待处理数注入模型上下文。证据：`sessionStart` `.codex/runtime/lib/hooks.mjs:288-310`；三文件缺失明确报「recap degraded」`hooks.mjs:306-307`。
- **SubagentStart 递归约束注入 + SubagentStop 回执信封强制** — 目的：机械要求子 Agent 回传 Status/Changed/Verified/Not verified/Needs review by/Evidence 六字段，缺字段 block。证据：`subagentStart` `hooks.mjs:335-344`、`subagentStop` `hooks.mjs:346-353`。
- **Stop 完成闸** — 目的：有 active task 且完成门未满足时 block 停止，列出缺哪些 check/review。证据：`stop` `hooks.mjs:355-369`。
- **UserPromptSubmit 反馈信号探测** — 目的：识别用户纠正语（"你错了/不对"等）提示主 Agent 事后派 feedback-observer。证据：`userPromptSubmit` `hooks.mjs:324-333`。
- **hook 输出有界** — 目的：防 hook 回传灌爆上下文，超限降级。证据：`boundedHookOutput` `hooks.mjs:410-421`。

### 2.2 Sub-Agent 编排
- **9 个原生 Sub-Agent** — 7 工作流角色（implementer/code-reviewer/tester/deployer/feedback-observer/evolution-runner/progress-recorder）+ researcher + impact-analyst。证据：`.codex/runtime/lib/doctor.mjs:8`（AGENT_NAMES）；只读角色集 `doctor.mjs:9`（code-reviewer/evolution-runner/impact-analyst/researcher）。
- **depth=1 机械强制** — 目的：阻止子 Agent 再拉子 Agent，用 config 而非 prompt。证据：每个 `.codex/agents/*.toml` 末尾 `[agents] enabled = false`（如 `impact-analyst.toml:26-27`、`researcher.toml:25-26`），doctor 校验 `doctor.mjs:71`。
- **模型继承、不固定 slug** — 目的：避免把可用性绑死在账户/Provider（v1 固定 gpt-5.5 曾导致 invalid model，`docs/HARNESS-AUDIT.md:225`）。证据：doctor 强制「fixed model is forbidden」`doctor.mjs:70`；`config.toml` 用当前字段 `max_concurrent_threads_per_session=6` `.codex/config.toml:8`。
- **sandbox_mode 按职责** — 只读角色 read-only、写角色 workspace-write，doctor 校验错配即失败。证据：`doctor.mjs:72-73`。
- **统一派单包 + 回执信封** — Goal/Scope/Out of Scope/Existing Pattern/Verification/Escalation 派单；Status/Changed/Verified/Not verified/Needs review by/Evidence 回执；implementer 四态自评（DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED）。证据：`docs/PROTOCOLS.md:3-27`、agent toml developer_instructions。

### 2.3 大仓库控制面（catalog → impact → context）
- **module-catalog 显式模块目录** — 每个 bounded module 声明 id/root/paths/dependsOn/shared/owners/contracts/capsule/tests/verification。证据：`.codex/harness/module-catalog.json`，schema 校验 `catalog.mjs:45-83`（禁 root catch-all 掩盖漏项 `catalog.mjs:75-77`）。
- **catalog lint 全量覆盖闸** — 目的：每个 tracked path 必须归入 mapped/global/ignored，否则 unmapped/overlap 即失败。证据：`classifyPath` `.codex/runtime/lib/catalog.mjs:89-105`、`lintCatalog` `catalog.mjs:107-116`。
- **反向依赖闭包 + 保守扩张** — 目的：变更沿 reverse dependencies 传播到消费者；shared/global/unmapped/overlap/truncated/non-git 任一出现即安全扩到全部模块。证据：`reverseDependencyClosure` `catalog.mjs:126-140`、`analyzeImpact` expansionReasons `catalog.mjs:159-166`。
- **预算化 Context Pack** — 目的：以任务和变更为中心组包（task envelope + Spec/Plan 指针 + canonical diff + changed files + capsule + contracts + tests），强制单文件/总字符/文件数/diff 预算，密钥/.git/依赖目录/runtime 永不入包，产出 packHash + contentHash 存证。证据：`buildContextPack` `.codex/runtime/lib/context.mjs:37-111`（优先级排序 52-57、预算执行 67-80、deny policy `denied()` `context.mjs:9-21`）。
- **discoverModuleCandidates** — 只从 tracked manifest 路径推断模块根，不全仓扫描。证据：`catalog.mjs:181-186`。

### 2.4 任务绑定与 Git 指纹
- **Task envelope + baseline** — Task 记录 goal/scope/outOfScope/risk/ownedPaths/specRefs/planRefs/reviewExclusions；baseline 存 git fingerprint + preExistingDirty + knownHashes。证据：`validateEnvelope` `.codex/runtime/lib/tasks.mjs:13-32`、`startTask` `tasks.mjs:50-82`。
- **并发写 preflight** — 目的：写 owned path 前检测 baseline 是否移动、路径是否被任务外改动，冲突即 block。证据：`assertTaskBaseline` `tasks.mjs:101-111`、`preflightTaskWrites` `tasks.mjs:113-126`（PreToolUse 调用 `hooks.mjs:264`）。
- **canonical git fingerprint** — 目的：覆盖 staged/unstaged binary diff + untracked 内容（含 symlink/special/missing），排除 harness-state，非 git 用显式降级哨兵。证据：`canonicalGitDiff` `.codex/runtime/lib/git.mjs:86-151`、`gitFingerprint` `git.mjs:153-158`、`NON_GIT_BINDING` `git.mjs:6-10`、`STATE_EXCLUDE` `git.mjs:5`。

### 2.5 质量门与密码学回执
- **风险分级验证矩阵** — low/medium/high 各绑定 check 集，check 有 class/dependencies/resourceLocks/allowFastSkip；security class 禁 allowFastSkip（校验期即拒）。证据：`validateMatrix` `.codex/runtime/lib/quality.mjs:18-54`（security 禁跳 `quality.mjs:47`）、`.codex/harness/verification-matrix.json`。
- **拓扑排序 + 资源锁执行** — 目的：按依赖 DAG 顺序跑 check，跨进程资源锁串行化，超时 SIGKILL，证据溢出到忽略的 runtime。证据：`topologicalOrder` `quality.mjs:60-76`、`executeCheck` `quality.mjs:172-245`（resource lock 213、Fast skip 205-208、证据落盘 229-231）。
- **密码学回执（防篡改）** — verification/review/waiver 三类回执均带 contentHash（stableJson 的 SHA-256），读时校验篡改。证据：`validateIntegrity` `.codex/runtime/lib/receipts.mjs:6-10`、`verifyRecord` `receipts.mjs:92-98`。
- **diff-bound review** — review 绑 base commit + canonical diff hash + scope/exclusions；任一变化即 stale，旧 review 不能给新代码背书。证据：`createReview` `quality.mjs:277-283`、`completionStatus` review 判定 `quality.mjs:334-343`。
- **completion 门** — required check 需 fresh PASS（或有效 Fast SKIPPED/waiver）；**high-risk 必须 tester-executed 回执**（executorRole==='tester'）；medium/high 需 fresh APPROVE review 且无未解 blocker。证据：`completionStatus` `quality.mjs:303-345`（high-risk tester 门 `quality.mjs:324-327`）。
- **waiver 不可绕安全** — security check 不可豁免；waiver 必须带 approvalEvidence（本地 waiver ≠ 身份认证）+ 未来 expiry。证据：`createWaiver` `receipts.mjs:54-79`（security 禁豁免 55、approvalEvidence 必填 59-61）、`validWaiver` `quality.mjs:294-301`。

### 2.6 Fast Mode
- **windowId 绑定的限时旁路** — 默认关；on/off/status；1-720h（默认 24h）自动过期；SKIPPED 回执仅在当前 window 内有效，过期或 window 缺失即失效。证据：`fastModeStatus` `quality.mjs:132-142`、`setFastMode` `quality.mjs:144-157`；completion 校验 window 匹配 `quality.mjs:318-322`；SessionStart 播报过期/失效 `hooks.mjs:302-304`。安全 check 永不可跳（`quality.mjs:205` 显式排除 security）。

### 2.7 安装事务
- **manifest 化 staging/rollback/post-verify** — LF-normalized SHA-256 manifest；只更新仍等于旧基线的文件；用户定制冲突写 sidecar；obsolete 仅未定制时删；逐文件备份 + 逆序 rollback + 装后 hash 校验 + install receipt。证据：`planInstall` `scripts/lib/installer.mjs:32-79`、`applyInstallPlan` `installer.mjs:89-169`（rollback 143-168）、`planUninstall/applyUninstall` `installer.mjs:171-238`。
- **safeManagedPath / assertSafeTarget** — 防路径逃逸 + symlink/junction 攻击。证据：`installer.mjs` 引用 `files.mjs`；测试覆盖 junction 逃逸 `tests/harness.test.mjs:641-652`。

### 2.8 doctor / validate 自检
- **结构 validate 永不写质量 PASS** — 只查 harness 结构/配置/hook wire/agent config/skill 元数据；`structureOnly:true, qualityReceiptWritten:false`。证据：`validateHarness` `doctor.mjs:130-154`。
- **managed drift 检测** — 对 install-manifest 逐文件比对 hash，区分 critical（config/runtime/agents/rules）vs customized 漂移。证据：`managedDrift` `doctor.mjs:113-128`；catalog 未定制时降为 warning `doctor.mjs:186-189`。
- **hook wire / agent / PowerShell ASCII 校验** — hook 每事件恰一个 handler + command_windows；agent 9 个齐全 + 无固定 model + enabled=false + sandbox 正确；`.ps1` 全 ASCII。证据：`validateHookConfig` `doctor.mjs:40-56`、`validateAgents` `doctor.mjs:58-76`、`validatePowerShell` `doctor.mjs:95-104`。
- **runtime 泄漏检测** — git ls-files 查 harness-state 是否被误跟踪。证据：`trackedRuntime` `doctor.mjs:106-111`。

### 2.9 反馈 / 进化
- **feedback ≠ memory 两套系统** — feedback 进 `.agents/feedback/`（evolution 扫描改规则），progress 进项目根（跨 session 记忆）。证据：`.agents/feedback/FEEDBACK-INDEX.md`（13 条，5 条 `[已毕业]`）、`.agents/EVOLUTION.md` 四层进化路径。
- **evolution 四层 + 用户确认闸** — 经验积累→规则毕业(3+次)→Skill 优化→Skill 自动生成(5+次)；每条提议需用户逐条确认，绝不自动改规则。证据：`.agents/EVOLUTION.md:7-29`。

### 2.10 跨进程状态原子性
- **withFileLock（跨进程 + stale 检测）** — 目的：Codex hook 天然多进程，所有 runtime read-modify-write 走文件锁 + 原子替换；用 PID liveness 检测 stale 锁。证据：`withFileLock` `.codex/runtime/lib/state.mjs:8-42`（PID 存活检测 `lockOwnerAlive` 44-53）、`updateState` `state.mjs:78-97`、`appendLedger` `state.mjs:99-104`。

### 2.11 安全规则（Codex execpolicy）
- **`.codex/rules/safety.rules` prefix_rule** — forbidden（git reset --hard / git clean -fdx / rm -rf / Remove-Item -Recurse -Force / diskpart/mkfs/format）+ prompt（删除 / git push/commit / 依赖安装 / sudo/apt / kill / docker push / kubectl apply / gh pr create）。明确标注「defense in depth only；sandbox 和 user approval 仍是权威」。证据：`.codex/rules/safety.rules:1-111`。

---

## 3. 独特亮点（轻量单机 Claude Code 框架通常没有的）

1. **密码学回执链**：verification/review/waiver 全部 contentHash 防篡改 + diff-bound stale（`receipts.mjs:6-10`、`quality.mjs:314-343`）。轻量框架多用 `.needs-review` 空 marker / `echo clean`（v1 codex-base 正是如此，被 `docs/HARNESS-AUDIT.md:234` 列为反面）。
2. **可确定性计算的 impact 分析**：反向依赖闭包 + 六种保守扩张原因（`catalog.mjs:126-166`），而非「把更多源码塞进上下文」。
3. **预算化、以变更为中心的 Context Pack**：硬字符/文件预算 + 密钥 deny policy + 稳定 hash（`context.mjs:37-111`）。轻量框架一般直接喂全文件。
4. **机械 depth=1**：靠 `[agents] enabled=false` 配置 + doctor 校验，不靠 prompt（`doctor.mjs:71`）。
5. **跨进程文件锁 + 原子写贯穿所有 runtime state**（`state.mjs:8-104`）——承认 hook 多进程本质。
6. **windowId 绑定的 Fast Mode**：限时旁路但 SKIPPED 回执带 window 溯源，过期即失效，安全 check 永不可跳（`quality.mjs:132-157`、`quality.mjs:318-322`）。
7. **完整安装事务**：staging/rollback/post-hash/sidecar 定制保护（`installer.mjs:89-169`）。
8. **doctor 能发现语义漂移**：managed drift / runtime 泄漏 / 过时 hook 语义 / 默认 catalog 未定制（`doctor.mjs:113-190`）。
9. **合成大仓性能测试**：24 模块 20 万行合成仓，断言 impact < 5000ms 且不读源码内容（`tests/harness.test.mjs:654-689`）——不提交巨型 fixture。

---

## 4. 面向大规模项目（20-30 万行）的能力

**结论：有，且代码 + 测试双重支撑，这是该框架的核心竞争力。**

- **上下文/记忆管理**：预算化 Context Pack（`context.mjs:37-111`，`.codex/harness.json` totalChars 120000 / maxFiles 40）+ 只读 tracked path 摘要不读全仓源码。progress.md 项目记忆 + 100 条阈值自动归档。
- **任务分解**：module-catalog 显式模块边界（`.codex/harness/module-catalog.json`）+ Task envelope owned paths + 单模块 writer 串行（`large-repo-harness/SKILL.md:40-49`）。
- **并行编排**：明确「编码默认串行」，只有真正独立 + 全规格化才 worktree 隔离并行（`docs/HARNESS-AUDIT.md:299`）；`max_concurrent_threads_per_session=6`。业界结论「并行是只读甜区」被采纳。
- **大代码库导航**：`catalog discover`/`catalog lint` 强制全量覆盖闸（`catalog.mjs:107-116`）+ 反向依赖闭包（`catalog.mjs:126-140`），强制顺序 `catalog lint → affected → context pack → scoped work → verification`（`docs/HARNESS-AUDIT.md:271-277`、`large-repo-harness/SKILL.md`）。
- **防失控闸**：风险分级验证矩阵（`quality.mjs:18-54`）+ 保守扩张（unmapped/shared/global/truncated 扩到全仓，`catalog.mjs:159-166`）+ diff-bound stale + high-risk tester 门（`quality.mjs:324-327`）+ 完成门 block 停止（`hooks.mjs:355-369`）。
- **性能证据**：`tests/harness.test.mjs:654-689` 生成 24×8400 行合成仓，实测 impact 全流程 < 5s 且 lint 通过。

核心哲学（`large-repo-harness/SKILL.md:10`）：**「扩展方式是缩小活动范围，不是把更多源码灌入模型」**——直接对应 20-30 万行目标。

---

## 5. 血泪教训（progress.md / feedback / HARNESS-AUDIT 记录）

1. **PowerShell 必须 100% ASCII**：Windows PS 5.1 按本地代码页读非 BOM UTF-8，一个中文字符就炸；doctor 逐字节校验（`progress.md:8`、`doctor.mjs:95-104`）。cc-base 同款坑（issue #15 stdin UTF-8）。
2. **配置型重复故障要扫全部同类实例**：PreToolUse hook 超时只改一个 5s→15s 就宣称修复，Stop hook 立即同样 5s 复现——「打地鼠」。教训：定位配置根因后扫同事件/同阈值/同 wrapper 全部实例（`.agents/feedback/bug-fix-scan-sibling-config-instances.md`）。
3. **固定 model slug 把可用性绑死**：v1 全角色固定 `gpt-5.5`，后端派 evolution-runner 返回 invalid model；改为模型继承 + `[agents] enabled=false`（`docs/HARNESS-AUDIT.md:225-226`、`progress.md:10`）。
4. **撤销同仓双宿主改造**：曾尝试 codex-base/grok-base 同仓双宿主，撤回为纯 Codex 单独复制即用（`progress.md:20`、`progress.md:34`）。方向性回退。
5. **品牌资产误删事故**：commit `3a8a8e8` 重写初始化话术时误删 SITE MASTER ASCII LOGO，从 `HEAD^` 恢复；毕业为「清理默认保留品牌资产」规则（`progress.md:35`、`progress.md:87`、`.agents/feedback/preserve-brand-assets-during-cleanup.md`）。
6. **多 repo 提交隔离（已毕业）**：把主仓(https) + 配置库(.agents=sitemaster-config, ssh)两个独立 repo 提交耦合进一个脚本，导致 https 主仓 push 失败卡 ahead 1「半成功」；教训：独立 repo 独立提交、逐个验收远程（`.agents/feedback/multi-repo-commit-isolation.md`）。
7. **研究下钻按递归深度、不用平级数量冒充**：用户要求「向下多打 2 层」指委派树递归，不是同层加更多 Sub-Agent（`.agents/feedback/recursive-research-depth-not-fanout.md`）。
8. **翻证据可委派，下判断不外包**：调研用 Codex 原生 fresh Sub-Agent，但主 Agent 必须亲读关键材料独立判断，不盲从子 Agent 结论（`.agents/feedback/native-subagent-research-main-agent-judgment.md`）。
9. **v2 全面重写的动因（HARNESS-AUDIT.md）**：审计发现 v1 的 `.needs-review` 可伪造 marker、mark-review 只跟 apply_patch 漏记 Bash/MCP、Stop hook 输出 `{continue:false}` 而 0.146.0 要 `decision:"block"`、Unix hook 依赖 jq 缺失即降级、Bash/PowerShell 双实现持续漂移——这些促成了单 Node 控制面重写（`docs/HARNESS-AUDIT.md:223-234`）。

---

## 6. 反面教材 / 弱点（独立专家判断）

1. **progress.md 严重过时**：progress.md 停在 `Last updated: 2026-07-21`、引用 v1.1.8、还写着「本轮 Sub-Agent = 点名 spawn」「model 必须 gpt-5.5」（`progress.md:10-11`），但实际代码已是 v2.0.0 全新 Node runtime，model 固定已被明令禁止（`doctor.mjs:70`）。**项目记忆与代码脱节** ——框架把「三文件同步铁律」奉为铁律，自己却没守。这是最大的自相矛盾。
2. **HARNESS-AUDIT 自陈 v2 未完成即被分析**：`docs/HARNESS-AUDIT.md:21` 明说 codex-base 在 `63e972dee339` 上「继续 v2 未提交开发」、「旧 Hook config 使真实 validate 失败，doctor/installer 尚未实现」——即审计文档描述的目标态与仓库实际态存在 gap，读者需分辨「已由测试证明」vs「仅文档承诺」。（注：从实际代码看 doctor.mjs/installer.mjs 现已存在，说明该文档也已滞后。）
3. **正则 hook 的安全边界局限被诚实标注但仍是脆弱点**：`classifyDangerousCommand` 正则可被编码/变量/wrapper/未覆盖工具路径绕过（框架自己在 `docs/HARNESS-AUDIT.md:198-203` 承认）。诚实是优点，但作为「机械闸」它给的保证有限——真正的边界仍是 Codex sandbox/approval。移植时不能把它当硬隔离。
4. **runtime 复杂度对轻量目标的张力**：12 个 lib 模块 + 密码学回执 + 拓扑排序 + 跨进程锁 + 安装事务，对「复制即用、单机、零依赖」定位是不小的认知与维护负担。catalog/verification-matrix 需要人工精心配置才有效（doctor 会警告默认 catalog 未定制 `doctor.mjs:186-189`），**未配置时大仓能力形同虚设**——门槛高。
5. **Fast Mode 与「高保证」哲学的内在拉扯**：Fast Mode 跳过 review/test（安全除外）本质是给严格闸开后门。虽有 windowId + TTL + 过期播报缓解，但一旦养成依赖，「临时放水」易变常态——这是流程设计的固有风险，非实现 bug。
6. **单点 Node runtime 的 harness.mjs 是所有 hook 的必经路径**：任何 runtime bug 或 node 缺失会让 8 个 hook 全部降级。虽有 fail-closed 设计，但把安全 + 上下文 + 质量三职能全压在一个 dispatcher 上，故障面集中。
7. **`researcher`/`impact-analyst` 等只读 Agent 与主控 SiteMaster 产品叙事割裂**：这些是从 agent-roles-spec 吸收的通用角色，但 AGENTS.md 的产品开发流程（Spec→Design→Plan→Build）里几乎用不到它们，存在「为完备而加」的角色膨胀嫌疑（CROSS-POLLINATION 自己也警惕 role-count inflation，`docs/CROSS-POLLINATION.md:11`）。

---

## 7. Top 5 最值得借鉴（排序）

**#1 密码学回执 + diff-bound stale（防「旧证据背书新代码」）**
为什么值得：解决 AI 编码框架最核心的信任问题——「说通过了」≠「真通过了」+「上次审过了」≠「这次改动审过了」。contentHash 防篡改 + base commit/diffHash 绑定使任何 diff 变化自动作废旧回执，机制化而非靠自觉。
如何移植：把 cc-base 的 `.claude/.needs-review` 空 marker 升级为绑定 {taskId, baseCommit, diffHash, contentHash} 的 JSON 回执；review/verification/waiver 三类统一走 `receipts.mjs:6-10` 的 validateIntegrity 模式；完成门消费回执而非子 Agent 自述（`quality.mjs:303-345`）。cc-base 已有 stop-gate/three-file-sync-gate hook，可平滑接入。

**#2 catalog → impact → context pack 大仓三段式**
为什么值得：这是 20-30 万行目标的唯一被测证明的可行路径（`tests/harness.test.mjs:654-689` 实测 20 万行 < 5s）。核心洞见「缩小活动范围而非扩大上下文」直接对症。
如何移植：搬 `catalog.mjs`（globRegex/classifyPath/reverseDependencyClosure/analyzeImpact）+ `context.mjs`（预算 + deny policy + hash）几乎可原样复用（纯 Node、零依赖）。cc-base 需新增 `.claude/harness/module-catalog.json` + `catalog lint` 命令，强制 unmapped 失败。这是 cc-base 当前最缺的能力。

**#3 单 dispatcher 每事件 + 跨进程文件锁 + 原子写**
为什么值得：承认 hook 多进程本质，根治并发顺序竞态和 state 撕裂——这是所有 hook-heavy 框架的隐蔽坑。
如何移植：`state.mjs:8-104` 的 withFileLock（PID liveness stale 检测）+ atomicWrite 可整体复用。cc-base 若有多个同事件 hook，合并为单 dispatcher 内部按序执行（`.codex/config.toml:10-65` + `hooks.mjs:382-401` 模式）。

**#4 机械 depth=1 + 统一派单/回执信封 + high-risk tester 门**
为什么值得：把「主 Agent 唯一编排、写测≠被测作者、子 Agent 不盲信」从 prompt 规则升级为可校验机制。high-risk 必须 tester-executed 回执（`quality.mjs:324-327`）是防「自码自测确认偏误」的硬闸。
如何移植：cc-base 的 CLAUDE.md 已有这些规则文本，可加：SubagentStop hook 强制六字段信封（`hooks.mjs:346-353`）、completion 门校验 executorRole（`quality.mjs:324`）、agent 定义禁递归。doctor 式静态校验保证不漂移。

**#5 安装事务 + doctor 语义漂移检测（复制即用交付）**
为什么值得：脚手架分发的工程完整性——staging/rollback/post-hash/sidecar 定制保护让「升级不覆盖用户改动」，doctor 能发现 manifest 漂移/runtime 泄漏/过时语义。
如何移植：`installer.mjs:89-169` 事务模型 + `doctor.mjs:113-190` drift 检测可复用。cc-base 若要做「复制即用 + 可升级」分发，这是必需的安全网；LF-normalized SHA-256 manifest 尤其解决跨平台换行导致的假冲突。

---

## 附：与 cc-base 的关系速记
codex-base 是 cc-base（SiteMaster/Claude Code）的 Codex 移植姊妹项目，主控叙事、feedback/evolution/progress 三系统、Fast Mode、职责边界铁律高度同源。**最大差异**：codex-base 把「大仓治理 + 质量证据」从 prompt 规则**实现成了带测试的 Node runtime**，而 cc-base 仍主要靠 CLAUDE.md 文本规则 + shell/ps 脚本 hook。对「下一代支持 20-30 万行 harness」而言，codex-base 的 runtime 层（catalog/context/quality/receipts/state/git 六模块）是可直接吸收的最大价值资产。
