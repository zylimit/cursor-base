# 15 术语表

按拼音首字母排序（英文术语按字母），每条一到三句，括号指向讲它的章节。

## A

- **agent memory**：code-reviewer / tester 挂 `memory: project` 的角色战术笔记（高发缺陷模式 / flaky 区），角色自维护；单文件封顶 5KB、每角色 50KB，超了搬 `docs/agent-notes/`。不承载框架规则也不承载项目事实。（08、13）
- **archive / 归档**：progress.md 的 Done / Notes 合计超 100 条、Decisions 超 30 条时把最老条目搬进 `progress.archive.md`，原地留一行指针；`archive` 子命令默认 dry-run，`--apply` 才动，Pinned 与 TODO 永不归档。（08、11）

## B

- **毕业**：一条 feedback 被写进 CLAUDE.md / rules / SKILL.md 成为正式规则，frontmatter 改 `graduated: true` 并注去向。判据是现状核查加实证门槛，不按出现次数。（08、13）

## C

- **catalog**：`.claude/harness/module-catalog.json`，大仓包的唯一开关，声明模块 id / paths / dependsOn / riskTier / verification / attributes / forbiddenDependencies / layer。存在即启用，删掉即关闭。（11）
- **CI 五格**：`.github/workflows/gate.yml` 的 gate job 四格（ubuntu / windows × node 22 / 24）加 ps1 job 一格；Windows 格不跑 run-all，ps1 格在 Git Bash 跑 `test-hooks-node.sh`。每周一 03:17 UTC 定时跑一次。（12）

## D

- **大仓包（ext）**：`.claude/harness/ext/` 下的引擎实现，十四个分节加两份细则，目标项目默认不装，`setup.sh --with-harness` 才装；没装时 ext 子命令 rc 3 + `not installed`。（11）
- **档位（fast / standard / strict）**：`.claude/harness/profile.json` 里每个闸在三档下的模式表，guard 类 off / advise / block、recorder 类 off / on；默认 standard，`tier set fast` 必带 reason，`--hours` 8 小时硬上限、`--sticky` 到撤销为止。（09）
- **地板闸**：`profile.floor` 里的五个——secret-exfil-guard / dangerous-pkill-guard / release-gate / postcompact-reinject / notify，任何档位改不了，它们自己不读档位表。（09、14）

## F

- **feedback**：`.claude/feedback/*.md`，记 AI 工作方法的纠正（不记项目事实、不记领域口径），frontmatter 带 scope / exceptions / supersedes / applied_to，由 feedback-observer 写、evolution-engine 扫。（08、13）
- **fitness**：`fitness` 子命令的五条零外部工具规则——密钥字面量 / 日志 PII / 静默吞错 / 无界重试 / 高危模块未挂单 TODO，各对应一性；无 catalog 也能跑。（11）
- **fork**：Agent 工具的一种派发形态，子实例继承主 Agent 全部上下文并总在同一模型上跑；feedback-observer / progress-recorder 用它，implementer 等执行角色用 fresh 实例。（10）
- **fresh 实例**：每次派发新起、不继承 session 历史的 Sub-Agent；缺上下文它只能猜，所以派单包必须完整。写测者必须是与实现者不同的 fresh 实例。（10）

## G

- **gate-block.log**：`.claude/evidence/gate-block.log`，hook 拦停账本，每行 `<ISO UTC>\t<hook>\t<reason 首行>`，`gatelog.mjs` 写、`gate-audit.sh` 读；advise 档也记。（09、12、13）
- **githooks**：`.claude/githooks/` 的 pre-commit / commit-msg / pre-push，Claude Code 会话之外的强制层；默认不开，`install-githooks.sh on` 才把 `core.hooksPath` 指过去。（12）
- **归档**：见 archive。

## J

- **闸（guard / recorder）**：`.claude/hooks/*.mjs`。guard 以 exit 2 或 `decision:block` 表态，有 off / advise / block 三态；recorder 只记账或提醒，有 off / on 两态。（09）

## L

- **领域口径**：这个领域里「事情是怎么算的」，跟领域走不跟仓库走，载体是项目根 `domain/`，采集寄生在回执的 Domain findings 栏，收录派 domain-recorder。（08）

## M

- **manifest**：`.claude/FRAMEWORK-MANIFEST.txt`，框架核心文件清单，每行 `<相对 .claude/ 路径>TAB<LF 归一化 sha256>`；`setup.sh` 据它判哪些文件是用户改过不覆盖，`doctor.sh` 全量比对，`gen-manifest.sh` 重生。（12）

## P

- **排除表**：`.claude/harness/exclusions.json`，哪些文件不入清单不随装的真相源；`gen-exclusions.mjs` 据此重写 `gen-manifest.sh` / `setup.sh` / `setup.ps1` 三处，`release.mjs` 的 `MANIFEST_RULES` 是故意手写的审计者。（12）
- **派单包**：主 Agent 派 Sub-Agent 时传的七字段——Goal / Scope / Out of scope / Existing pattern / Business Context / Verification / Escalation，Business Context 不许 N/A。（10）
- **Pinned / Decisions / Done**：progress.md 三个段。Pinned 是必守约束封顶 15 条；Decisions 每条三要素（依据 / 适用范围 / 取代哪条）正文留 30 条；Done 是完成项，决策不许埋进去。（08）

## Q

- **签字闸**：需要用户明确批准才能过的门——Spec 签字、发版上线、不可逆操作、删或重写现有家底；属 HIGH 档。（04、07）

## R

- **receipt / 回执**：`.claude/harness/receipts/<taskId>.json`，绑 diffHash / engineHash / contentHash 的审查回执；diff 变一个字节即 stale rc 4，stop-gate 据此拦停。（11）
- **recap**：`/recap-project`（不带斜杠说 recap 也行；带斜杠的 `/recap` 是 Claude Code 自带命令，到不了框架）读 progress.md 的 Pinned + 现存 Decisions + 断点 + TODO，加 Product-Spec.md 与 CHANGELOG，存在即读不读归档；只读 progress 不算恢复完成。大仓包的 `recap` 子命令按预算从同样三份派生。（08、11）
- **red-locks-the-bug**：线上行为 bug 与核心解析器 / 契约缺陷的修法——先派 tester 出红、主 Agent 亲见 fail、`touch .claude/.red-verified`（两小时内有效）、再派 implementer 修绿；tdd-gate 守它。（06）
- **risk 分级**：测试脚本头十行内 `# risk: high|medium|low`，`run-all.sh` 默认只跑 high，CI 跑 all；没打级的按 high。（12）
- **run-all**：`bash .claude/tests/cases/run-all.sh`，三段——selftest / 静态自测 / 真触发 case（默认跳过），每次把逐条结果追加进 test-ledger.jsonl。（12）

## S

- **三文件同步**：决策 / 约束 / 完成一出现就写 progress.md；需求变更 Product-Spec.md 与 Product-Spec-CHANGELOG.md 成对改；存在即维护，不存在不强造。three-file-sync-gate 在 Stop 时提醒。（08）
- **Sub-Agent**：主 Agent 用 Agent 工具派出的工人——implementer / code-reviewer / tester / deployer 等，定义在 `.claude/agents/*.md`，`disallowedTools: Task` 不再派 Sub-Agent。（10）
- **四步走**：每个 Phase 完成的验证——Code Review → 测试完整性 → 编译验证 → 功能测试，中间有改动四步重来。（05）
- **四态门**：Phase 收尾的 PASS / CONCERNS / FAIL / WAIVED，WAIVED 写明理由与批准人，安全与数据丢失类不许 WAIVED。（05）
- **四态自评**：回执信封开头的 Status——DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED（tester 可用 PASS / FAIL）。（10）

## T

- **Task 三档**：LOW（< 50 行、不碰契约 / 解析器 / 鉴权 / 迁移 / 支付 / hooks）只派 implementer；MEDIUM 加一轮 reviewer Stage 0 + 1；HIGH 全套 + tester，implementer 用 opus。（05）
- **test-age**：`node .claude/scripts/test-age.mjs`，从 test-ledger.jsonl 列「跑过 ≥ 20 次一次没红过」的退休候选；三个地板文件不列入。（12）

## V

- **verify 四态**：单 check 的 PASS / FAIL / BLOCKED / SKIPPED；聚合任一 FAIL → FAIL、任一 BLOCKED → BLOCKED；空计划 = BLOCKED；全 SKIPPED rc 3。（11）

## W

- **waiver**：`.claude/harness/waivers/*.json`，指名到 check 的结构化豁免，带 owner / reason / scope / expiry / compensation；security / safety / privacy 类永不可豁免，critical 属性缺口没有豁免通道。（11）
- **五性**：韧性 resilience / Security / Safety / 隐私 privacy / 可靠性 reliability，模块按六档声明，check 认领属性，verify 判覆盖。（11）

## Z

- **主 Agent**：会话里的唯一编排者——需求分析、拆任务、写派单、验收；不亲自编码 / 审查 / 测试 / 部署，no-direct-code-guard 守着。（01、10）
- **自动升档**：工作树里改了 `profile.raise.paths` 命中的家底路径（hooks / harness / skills / agents / CLAUDE.md / rules / settings.json / .github）本轮自动进 strict，提交后回落；`tier status` 的 `source: raise` 点名文件。（09）
- **回执信封**：Sub-Agent 回传的统一格式——Status / Changed / Verified / Not verified / Business assumptions / Counter-examples / Domain findings / Needs review by / Evidence。（10）
