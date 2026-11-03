# 08 记忆与恢复：progress.md、feedback、口径库

这章解决一个问题：**上下文随时会没**——你 `/clear`、Claude Code 自动压缩、session 中断，对话里的决策、约束、进度就跟着蒸发。框架把「什么该记、记在哪、怎么恢复」做成了四套互不重叠的记忆和两道压缩闸。读完你能：

- 看懂 progress.md 每一段的用途，知道一条信息该落哪一段、怎么写才算数；
- 用 `/record` `/archive` `/recap-project` 三条指令维护和恢复项目状态，知道 recap 读哪三份文件、为什么不读归档；
- 理解三文件同步铁律和 Stop 时那句提醒是怎么来的；
- 知道上下文压缩前后两道闸各做什么，压缩后被注回的东西从哪来；
- 分清 feedback、用户 memory、agent memory、Claude Code 原生 auto memory、领域口径库五种容器的边界，不再把一条信息记错地方。

前置：读过 [03 第一个项目](03-first-project.md)，跑通过至少一轮开发。闸的档位语义见 [09 闸门与档位](09-gates-and-tiers.md)。

---

## 入门：三个文件、三条指令

### 记忆在哪

| 文件 | 位置 | 记什么 | 谁写 |
|---|---|---|---|
| `progress.md` | 项目根（与 Product-Spec.md 同级，**不在** `.claude/`） | 决策 / 约束 / 待办 / 完成 / 风险 / 笔记 | progress-recorder Sub-Agent（record / archive）；文档类改动主 Agent 也可直接写 |
| `progress.archive.md` | 项目根 | 从 progress.md 搬走的历史条目，只增不删 | progress-recorder（archive） |
| `Product-Spec.md` + `Product-Spec-CHANGELOG.md` | 项目根 | 需求本体 + 需求变更记录，**成对**改 | 主 Agent（product-spec-builder） |

progress.md 不放进 `.claude/` 是刻意的：`.claude/` 是框架自己的东西，装进别的项目时整目录复制；项目记忆属于项目，不该跟着框架走。

### 三条指令

| 指令 | 谁执行 | 做什么 |
|---|---|---|
| `/record` | 派 progress-recorder（record 模式） | 把本轮对话增量按语义抽取，**增量合并**进 progress.md 各段；无有效信号回「无新进度」 |
| `/archive` | 主 Agent 跑 `progress-archive.mjs`（脚本不在才派 progress-recorder） | 把过多的 Notes / Done / Decisions 原文搬到 progress.archive.md，主文件保持精简 |
| `/recap-project` | 主 Agent 自己读 | 读 **progress.md + Product-Spec.md + Product-Spec-CHANGELOG.md** 三份恢复处境；三份存在即读，不存在的跳过不报错 |

同一轮同时出现 `/record` 与 `/archive` → 先 record 再 archive。

三条指令的执行方式来自 `.claude/rules/dev-workflow-details.md`「progress-recorder」一节，与 `.claude/CLAUDE.md` [项目记忆规则] 一致。

### 什么时候不用你敲 /record

主控写死了自动触发：对话里出现下面这些语言时，主 Agent **必须**主动派 progress-recorder，不等你说。

| 语言信号 | 落到哪段 |
|---|---|
| 「决定使用 / 最终选择 / 将采用」 | Decisions |
| 「必须 / 不能 / 要求」 | Pinned（高置信时）或 Notes（弱化时） |
| 「完成了 / 实现了 / 修复了」 | Done |
| 「需要 / 应该 / 计划」 | TODO |

日常闲聊、过程细节、未定的设想不记——agent 文件写的是「宁可漏记，不可滥记」。

### 恢复的最短路径

```bash
# 新 session 开头，或 /clear 之后
/recap-project
```

主 Agent 读三份文件后应回你一段处境：现在在哪个 Phase、Pinned 里有哪些约束、TODO 排到哪、上次断点在哪。只读 progress.md 不算恢复完成——Spec 和 CHANGELOG 是「需求现在长什么样」的唯一来源，progress.md 里只有决策不带需求全文。

如果工作树有未提交改动，SessionStart 会先给你一句提醒（`recap-on-dirty.mjs`）。你会看到：

```
检测到 git 工作树有 4 处未提交改动——上个 session 可能中断或上下文已压缩，progress.md 未必反映真实状态。建议先 /recap-project 读 progress.md，对照实际改动校准（决策/完成是否已记）后再继续。
```

这句只是提醒，不拦任何事。

---

## 进阶：progress.md 怎么写才算数

### 各段的用途与硬规则

模板在 `.claude/skills/progress-recorder/SKILL.md` [模板]。最小段落集如下；项目可以加自己的段（本仓就多了「当前断点」「明确不做」「将来事」），但这八段不能少。

| 段 | 用途 | 写法与硬规则 |
|---|---|---|
| Pinned | 每次 recap **必读**的那一小段：长期约束、接口要求、依赖版本、目标环境 | 只收高置信「必须遵守」；每条带**依据**与**适用范围**；**封顶 15 条**——满了要加新条，先把最弱的一条降级成 Decision 或与同类合并，不是继续追加；受保护，不可自动修订或删除 |
| Decisions | 按时间追加的决策流水，历史不可改 | 每条**三要素**：依据 / 适用范围 / 取代哪条；新条推翻旧条时旧条末尾追加「→ 被 <日期> 取代」，原文不删不改；追加前必须做**取代检查**——没做的追加不算完成 |
| TODO | 权威待办清单 | `[P0][OPEN][#1] 任务（Owner / Context）`；`#ID` 单调递增不复用；语义相似的更新原条目不新开 |
| In Progress | 正在做的 | 状态 DOING |
| Done | 最近完成的放前面 | 带日期与**证据指针**（commit / issue / PR / 路径），没证据不虚构 |
| Risks & Assumptions | 风险与前提 | Risk 带 Mitigation；Assumption 带 Confidence |
| Notes | 要点、待确认、冲突提示 | 带弱化词（可能 / 也许 / 建议 / 考虑）的内容一律降级到这里并标 `Needs-Confirmation` |
| Context Index | 轻量索引 | 指向 `./progress.archive.md` |

两条最常被写错的：

- **决策不许埋进 Done**。「完成了 X，顺便决定以后都用 Y」——「用 Y」是 Decision，得单独一条带三要素；Done 只记「X 完成，evidence: commit abc」。铁律 6 的原文：「不许把决策埋进 Done」。
- **Pinned 与 Decisions 的冲突不会被自动解决**。recorder 检测到潜在冲突只会记进 Notes 附建议与理由；改 Pinned 是人的事。

### 一条合格的 Decision 长什么样

从本仓 progress.md 抄一条（截断）：

```
- 2026-09-15: **主 Agent 可直接写的「文档类」扩到 rules / skills / progress**——依据：本轮用户拍板由主 Agent 直接改规则与 skill；它们是提示词文档不是业务源码，`no-direct-code-guard` 的 EXEMPT 本就放行 `.claude/` 与 `*.md`，规则写成与闸一致；……适用范围：CLAUDE.md 铁律 1……
```

依据说清「为什么这么定、否掉了什么」，适用范围说清「哪些情况适用、哪些不适用」，取代写「无」或被顶掉的那条日期。下一阶段、下一角色、下一次 session 靠这三样判断一条规则还算不算数、在哪算数。

### record 的置信度闸门

progress-recorder 不是关键词匹配器，它按语义抽取，但写入 Pinned / Decisions 有门槛：

- 含确定性语言（「决定 / 敲定 / 必须 / 禁止」以及用户的纠正「不是这样 / 以后都 / 别再」）→ 进 Pinned / Decisions；**纠正是最硬的决策，必须带「取代」**。
- 含弱化词 → 降级 Notes + `Needs-Confirmation`。
- 边界情况保守处理：宁降级不误升级。

所以你在对话里说「先这样吧，回头再看」，它不会给你写成 Decision。要它记成决策，就把话说死。

### archive 什么时候触发、搬什么

| 触发 | 阈值 |
|---|---|
| 自动 | Notes 与 Done 合计 > 100 条，或 Decisions > 30 条，或已关闭的 TODO > 20 条——每次 record 完 recorder 必查，三组各判各的 |
| 手动 | `/archive` |

搬迁规则：

- **搬运由脚本做**：recorder 发现超线只回报，主 Agent 跑 `node .claude/scripts/progress-archive.mjs`（`--check` 只算不写）。recorder 没有 Bash，手工搬一条上千字的条目等于把原文重敲一遍——2026-09-19 两次都撞轮次上限没做完，各花二十多万 token。脚本不在的老安装才退回手工搬。
- Notes / Done 各保留最新 35 条，Decisions 保留最新 24 条，已关闭（DONE / 完成）的 TODO 保留编号最大的 10 条，其余**原文**搬到 progress.archive.md 对应段（Archived Notes / Archived Done / Archived Decisions / Archived TODO）。保留线压在触发线下面一截，归档完才不会贴着线、下一条记录又触发。
- **先写归档、后删正文**：要搬的条目先追加进归档，逐条在归档里搜到了才从 progress.md 删，有一条搜不到就一条都不删；已在归档里的不重复追加，所以搬到一半被截断可以接着搬。2026-09-19 本仓先删后写、中途撞到轮次上限，丢过三条 Decisions，靠 git 旧版本才找回。
- Pinned 与未关闭的 TODO（`OPEN` / `部分完成` / `明确不做`）**永不搬**。已关闭的 TODO 搬走后编号不重用：TODO 段末的「归档指针」行记着已归档最大编号，新编号取它与正文现存最大编号里大的那个再加 1。实测 recap 读进去的 81KB 里有 32KB 是早已关闭的 TODO，这是纳入它的原因。
- Decisions 段末尾留一行指针：搬走的条数、日期区间、「仍在生效的硬约束已在 Pinned」。
- progress.archive.md **只增不删**；每批条目整体插在对应段最前面（段内最新在上），批内顺序与正文一致。

本仓 2026-09-20 用脚本跑的第一次：Done 52 → 35、Notes 51 → 35、Decisions 31 → 24、已关闭的 TODO 61 → 10，共搬 91 条，progress.md 从 168KB 降到 112KB，recap 要读的四段从约 81KB 降到约 59KB；此前 2026-09-15 首批搬过 119 条 Decisions。这就是「超线归档」在真实项目里的样子。

### 为什么 recap 不读归档

归档里是已经被取代、已经完成、已经过时的东西；仍在生效的硬约束按规则必须在 Pinned。recap 读归档等于把上下文预算花在「历史上曾经怎样」上。SKILL.md 写的是「主 Agent recap 默认不读归档」——真要查历史，让主 Agent 显式去读 `progress.archive.md`。

大仓包（`setup.sh --with-harness`）装了之后，`node .claude/harness/harness.mjs recap` / `archive` / `sync-check` 三个子命令按同样口径机器化：recap 按预算从同样三份派生处境、archive 默认只报计划 `--apply` 才搬、sync-check 另判「记忆落后于代码」与「Spec 改了没配 CHANGELOG」。本仓没装，见 [11 大仓治理](11-large-repo.md)。

### 三文件同步铁律与 Stop 时那句提醒

铁律 6（`.claude/CLAUDE.md` [铁律]）：

> 决策 / 约束 / 完成一出现就写 progress.md——决策进 Decisions（三要素），完成进 Done，约束进 Pinned；需求变更 Spec + CHANGELOG 成对改；存在即维护，不存在的不强造；随下一个有代码的提交入库，不为记账单独提交。闸：three-file-sync-gate，Stop 时只提醒。

机器侧是 `.claude/hooks/three-file-sync-gate.mjs`，挂 Stop 事件，只看 **git 工作树实际未提交改动**（不用 mtime，checkout 时 mtime 前后 1ms 会假阳性）：

| 检查 | 命中条件 | 提醒内容 |
|---|---|---|
| C1 | 改动集里有代码 / 家底文件（`.sh .ps1 .mjs .cjs .ts .tsx .js .jsx .py .css .go .rs`，或 `.claude/` 下任何文件；排除 `.claude/evidence` `node_modules` `out` `dist`）且 progress.md **不在**改动集 | 「检测到未提交的代码/家底改动（如 X）但 progress.md 未同步」 |
| C2 | 改动集含 Product-Spec.md 但不含 CHANGELOG，或反之；两份都存在才判 | 「需求变更可能漏记 CHANGELOG」/「须成对更新」 |

三档都是 `advise`：出 `systemMessage` 提醒 + 记账本，**不 block**。干净树、非 git 仓、没有 progress.md 都优雅放行。闸自身出错 fail-closed 拦停——「树没被看过」不能当成「树是干净的」。

在沙箱里（有 progress.md、`src/app.ts` 改了没提交）喂一次 Stop 事件，你会看到：

```json
{"systemMessage":"[advise] 三文件同步铁律：检测到未提交的代码/家底改动（如 src/app.ts）但 progress.md 未同步。请把本轮的决策/完成事项/进度/新任务即时写入 progress.md（doc 类主 Agent 直接写），保证随时可 Clear→recap 完整恢复，然后重试停止。"}
```

往 progress.md 追加一行后再喂一次：静默，rc=0。

「只提醒」是数据换来的：账本里 three-file-sync-gate 拦了 33 次，多数是主 Agent 在同一轮里本就要写 progress.md、被 Stop 抢先一步。提醒够用，硬拦是空转。

---

## 精通：压缩闸、feedback、四套记忆的边界

### 上下文压缩前后的两道闸

压缩不是稀释约束，是删除：摘要器为任务连续性服务，二十轮没被引用的铁律正是它最先丢的。框架在压缩两端各放一道闸。

| | precompact-gate.mjs | postcompact-reinject.mjs |
|---|---|---|
| 事件 | PreCompact | PostCompact |
| 做什么 | 压缩**前**检查：C1 `.claude/.needs-review` 有待审文件；C2 工作树有未提交代码 / 家底改动但 progress.md 不在改动集。命中任一 → `decision: block` 拦一次，提示先 `/record` 固化 | 压缩**后**从文件重新派生「什么不能被交易掉 + 现在处在什么状态」，经 `additionalContext` 注回当前轮 |
| 拦几次 | 拦过一次后 **10 分钟**内不再拦（`.claude/.precompact-block-epoch` 记时间戳）——auto 压缩可能是上下文触顶的恢复动作，拦第二次只会让请求反复失败 | 不拦（PostCompact 没有 decision 通道，压缩已经发生） |
| 档位 | standard / strict 拦；fast 只提醒 | **地板闸**，任何档都跑 |
| 出错 | fail-open 放行（拦死压缩会卡死整个会话） | 打可见的降级说明（`systemMessage`），不静默 |

沙箱里工作树脏、progress.md 没动，喂 PreCompact，你会看到：

```json
{"decision":"block","reason":"压缩前守门：工作树有未提交代码/家底改动但 progress.md 未同步（本轮决策还没进项目记忆）。压缩会把对话正文换成摘要，这些状态最容易随之蒸发——请先派 progress-recorder /record 固化决策/完成事项（待审项处理或显式记欠账），再重试压缩。本次拦截后 10 分钟内不会再拦。"}
```

10 分钟内再喂一次：静默放行。

**postcompact 注回的东西从哪来**，分两条路：

- 装了大仓包（`.claude/harness/ext/` 存在）：跑 `harness invariants`，退出码 0（派生到了）或 3（源文件缺失但活跃状态仍派生到了）都注回；其余退出码是引擎出岔，打降级说明。
- 没装（目标项目默认就是这样）：hook **自己从文件派生**三样——progress.md 的 Pinned（最多 12 条、每条截 120 字符、跳过含「→ 被…取代」的历史条）、`.needs-review` 待审文件、当前档位。预算 1200 字符，超了截断并标「（已按预算截断）」。

沙箱里 Pinned 两条（一条已取代）、一个待审文件，喂 PostCompact，你会看到：

```json
{"systemMessage":"PostCompact: invariants re-derived without the engine (ext not installed)","additionalContext":"刚刚发生了一次上下文压缩。压缩不是把约束稀释了，是把它们删了；下面这份是刚从文件重新派生的，不是从摘要里回忆的——按它校准。\n\n# INVARIANTS —— 引擎未装，以下由 hook 直接从文件派生\n\n## 这棵树现在的状态\n- 档位：standard（来源 default）\n- 待审文件：1 个（src/x.ts）\n\n## Pinned（progress.md）\n- 关联键＝OLT IP，禁止用 OLT 名（依据：用户原话；适用范围：全部导出）"}
```

注意被取代的那条 Pinned 没被注回——把作废口径当铁律注回去比不注回更坏。这也是为什么 Pinned 要控在 15 条以内、被取代的要标清楚：postcompact 只认前 12 条。

### feedback：AI 工作方法的纠正

**feedback 是什么**：你纠正了 AI 的做法（不是纠正项目事实），这条纠正记进 `.claude/feedback/<kebab-case>.md`，由 evolution-runner 扫描、提议升级成规则。它记的是「AI 该怎么问、怎么做」，跟项目无关——换一个项目仍然成立的才是 feedback。

**什么时候派 feedback-observer**（`.claude/agents/feedback-observer.md`，sonnet，禁 Bash / Task，maxTurns 25）：

| 触发 | 谁触发 |
|---|---|
| 你的 prompt 命中修正信号词（「不是这样 / 你搞错了 / 别再 / 每次都 / 你又忘」等，全表在 `.claude/hooks/feedback-signals.txt`） | `detect-feedback-signal.mjs`（UserPromptSubmit）注入一句提醒，主 Agent 处理完当前请求后**必须**派 |
| 铁律 8「纠正当场落地」的第 ② 步 | 主 Agent 先把纠正应用到当前产物与 progress.md Decisions，再派 observer 记录，传入「已落地的改变」 |
| Skill 执行完要评效能 | 主 Agent 派，observer 按 4 维打分 |

喂 `{"prompt":"你搞错了，不是这样"}` 给 detect-feedback-signal，你会看到：

```json
{"additionalContext":"检测到用户修正信号。请在处理完用户请求后，派发 feedback-observer sub-agent 使用 feedback-writer skill 记录这条反馈。feedback 记录到 .claude/feedback/ 目录，不是 memory 目录。"}
```

信号词表是 sidecar 文件，你可以增删；文件缺了退回内置默认表，不会静默失效。

observer 用 `feedback-writer` skill，按 5 个观察维度判有没有信号（用户修正 / 未覆盖场景 / 重复操作 / 质量问题 / Skill 效能评估）；「宁可漏记，不可滥记」。写入前先查 `FEEDBACK-INDEX.md` 去重：同主题已有 → 更新正文补这次的触发场景、更新 `updated`；与旧条冲突 → 新条 `supersedes` 写旧文件名。

**frontmatter 字段**（模板 `.claude/feedback/templates/feedback-topic-template.md`）：

| 字段 | 含义 | 写不出来时 |
|---|---|---|
| `type` / `description` / `created` / `updated` | 索引用 | — |
| `source_skill` | 被纠正的是哪个 Skill | `N/A` |
| `scope` | 适用范围——哪些阶段 / 角色 / 项目类型 | 写「未说明」，不编 |
| `exceptions` | 哪些情况不适用 | `none` |
| `supersedes` | 取代或修正哪条旧规则 / 旧 feedback 文件名 | `none` |
| `applied_to` | 本次纠正已落到哪里（文件:段落 / progress.md Decisions 日期 / 派单包） | `pending`——给主 Agent 看的，说明纠正还没生效 |
| `graduated` | 是否已毕业 | `false` |
| `scores` | 仅 Skill 执行后填：accuracy / coverage / efficiency / satisfaction（1-5）+ evidence | 不填 |

`.claude/rules/memory-systems.md` 的原话：scope / exceptions / supersedes 是一条 feedback 能不能被正确使用的前提——没有范围的规则会被用到不该用的地方，没有取代关系的新规则会和旧规则并存打架。

**毕业（graduated）是什么意思**：这条 feedback 的内容已经写进了 CLAUDE.md / rules / 某个 SKILL.md / agents，规则本体已经承载它，feedback 文件留作细则参照。索引里毕业条目带 `✅[已毕业]` 前缀、被 evolution-engine 裁定跳过的（领域口径等不进框架）带 `⏭[已跳过]` 前缀，两者都不算待处理；frontmatter 的 `graduated: true` / `skipped: true` 后面跟一句注释说明毕业到了哪或为什么跳过。本仓 70 个 feedback 文件（含 2026-10-30 从三个下游收进的 24 条），索引里 55 条已毕业、5 条跳过、10 条待处理。

`check-evolution.mjs`（SessionStart）数的就是索引里两种前缀都不带的行。有待处理的，开场你会看到一句：`📋 项目有 N 条待处理 feedback（共 M 条）。建议派发 evolution-runner 检查是否有进化建议。`

**下游项目的 feedback 怎么回到框架**：项目里的 skills / CLAUDE.md 是清单管的框架副本，往里毕业下次 `setup.sh` 就报 conflict，所以下游的方法类教训只在项目里记、不在项目里毕业。框架仓跑 `bash .claude/scripts/collect-feedback.sh <项目路径…>` 把它们收进来——同名同内容跳过（只补 `origin`）、同名不同内容落 `<名>.from-<项目>.md`、frontmatter 写 `origin: <项目>`、索引自动追加，`--dry-run` 只算不写——再派 evolution-runner 毕业到本仓的 skill。三个下游项目 35 份 feedback 三个月 0 毕业（2026-10-30 实数）就是这条链断着的样子；`setup.sh` 从此只在目标没有 `FEEDBACK-INDEX.md` 时才建，不再每次升级重置成空模板（#87）。

### evolution-runner：什么时候跑、看三类信号

`.claude/agents/evolution-runner.md`（sonnet，禁 Task，maxTurns 30），用 `evolution-engine` skill（`context: fork`——它要看见对话原文）。触发：session 初始化时 check-evolution 提醒后由主 Agent 派，或你说「帮我看看有没有该升级的规则」。

| 信号 | 判据 | 产出 |
|---|---|---|
| 规则毕业 | 筛 `graduated == false` 且 `skipped != true`；**不按出现次数**（计数字段 2026-09-12 已删——43 条里 39 条恒为 1，从没人加）。每条先**现状核查**：去 CLAUDE.md / rules / SKILL.md / agents 真 grep，已成文的以既成事实毕业并给行号；部分成文点名缺的半；压根没有才进落地提案。**实证门槛**：正文里有真事故（返工、空转、重复争议）才提，只有「用户当场纠正」没代价记录的判「暂不成文」写进 frontmatter，下次不重裁 | 建议写入哪个文件哪一段 |
| Skill 优化 | 按 `source_skill` 聚合未毕业 feedback，3 条以上指向同一环节（按主题聚类）；scores 不再当信号——下游 35 份没有一份填过 | 改哪个 SKILL.md |
| 新 Skill 提议 | 同族主题跨 3 条以上 feedback 反复出现，且不属于任何已有 Skill | 调 skill-builder 创建 |

runner **只提建议不执行**。主 Agent 把提议展示给你逐条确认 / 跳过：确认 → 写入目标文件、标 `graduated: true`；跳过 → 标 `skipped: true` 不再提。四层进化路径（经验积累 → 规则毕业 → Skill 优化 → Skill 自动生成）写在 `.claude/EVOLUTION.md`。

### 四套记忆的边界

一条信息只进一个系统。判法是问「换了项目、换了 AI、换了角色，这条还成立吗」。

| 容器 | 位置 | 记什么 | 谁维护 | 不记什么 |
|---|---|---|---|---|
| **feedback** | `.claude/feedback/` | AI 工作方法的纠正（怎么问、怎么做）；跟 AI 走 | feedback-observer 写，evolution-runner 扫 | 项目事实、决策 |
| **用户 memory** | 用户的 memory 目录 | 跨 session 的用户偏好与项目上下文 | Claude Code | 用户对 AI 行为的纠正（那必须走 feedback，不能只写 memory） |
| **agent memory** | `.claude/agent-memory/<角色>/`；只有 code-reviewer / tester 挂了 `memory: project` | 角色自己的战术笔记：本项目高发缺陷模式、flaky 区、基建约定 | 角色自维护，无人工审核 | 框架规则（feedback 的事）、项目事实（progress.md 的事） |
| **Claude Code 原生 auto memory** | `~/.claude/projects/<repo>/memory/` | 机器本地琐碎：构建命令、调试线索 | Claude Code 自动 | **决策 / 约束 / 完成事项只认 progress.md**；恢复以 /recap 三份为准，不以 auto memory 为准 |

用户纠正分两类落地（memory-systems.md）：**业务规则**（这个项目里的事实、取舍）进 progress.md Decisions / Pinned 三要素，下一角色靠派单包 Business Context 拿到；**工作方法**进 feedback，`applied_to` 记它落到了哪。

**agent memory 的封顶**：单文件 5KB、每角色合计 50KB。超了就是文档不是记忆，搬到 `docs/agent-notes/<角色>/`，在该角色的 `MEMORY.md` 里留相对路径指针。理由写在规则里：fresh 实例照样会带上 MEMORY.md 索引与它点开的文件，记忆越厚「fresh」越假，也把「每单 ≤ 6 次工具调用」直接撑爆。本仓现状：code-reviewer 目录 49,304 字节（贴着 50KB 线）、最大单文件 4,713 字节；`docs/agent-notes/code-reviewer/` 已有 3 份搬出去的，MEMORY.md 里用 `../../../docs/agent-notes/...` 相对路径指过去。

### 领域口径库 domain/：第四种，也是副产品

口径 = 这个领域里「事情是怎么算的」（`R-CLU-002 Cluster 边界＝整簇凸包`、「关联键＝OLT IP，禁止用 OLT 名」）。跟领域走：换代码库、换实现者之后仍然成立。

和前三者的分界（`.claude/rules/domain-rulings.md` [定位与边界]）：

| | 跟谁走 | 例子 |
|---|---|---|
| progress.md Decisions | 项目 | 「这个项目默认模型用 sonnet」 |
| feedback | AI | 「派单前必须给 Business Context」 |
| Spec 功能需求 | 产品 | 「导出页要有 OLT 列」 |
| **domain/** | 领域 | 「OLT 关联键是 IP 不是名字」——产品做不做导出、代码怎么实现都可以变，这条不跟着变 |

几条硬约束：

- **载体**是项目根 `domain/<域>.md`，不进 `.claude/`；存在即维护、不存在不强造——框架本体没有领域，本仓没有 `domain/` 是正常的，不报错不催补。
- **它不是流程环节**：不进四步走、不设卡点、不挂 recap、不挂 SessionStart。口径是任务级不是 session 级，读取时机只有四个：派单时抄进 Business Context、审查时当判据的另一半、需求迭代前查现行口径、调试定预期时。
- **采集寄生在回执上**：Sub-Agent 回执信封的 **Domain findings** 栏「报线索不报结论」；`subagent-acceptance-reminder.mjs` 只在栏里真有内容时提一句「写清你手上的证据是哪一类」，写 None 不催。收不收由主 Agent 裁定，收则派 domain-recorder（sonnet，禁 Bash / Task，maxTurns 25）按七栏写入。
- **依据只认三类**：实测撞出来的 / AI 查外网得到的 / 人查公司内部得到的。凭记忆、凭推断说得再确定也不收——这是防噪音唯一的闸。
- 七栏（现行值 / 依据 / 适用范围 / 取代 / 失效条件 / 被谁依赖 / 已知污染）、三种变更（修订 / 取代 / 收窄放宽）、四种老化，全在 domain-rulings.md；收录前必须读它。

---

## 常见坑

| 坑 | 现象 | 怎么办 |
|---|---|---|
| 只读 progress.md 就当恢复完成 | recap 后主 Agent 不知道需求改过什么，按旧 Spec 派单 | `/recap-project` 必须读齐三份；CHANGELOG 是「需求最近动过什么」的唯一来源 |
| 决策埋进 Done | 三周后没人知道「为什么用了 Y」，取代检查也做不了 | 决策单独一条进 Decisions 带三要素；Done 只记完成 + 证据 |
| Pinned 追加到 20 多条 | recap 时没人真读；postcompact 只注回前 12 条，后面的等于没有 | 封顶 15；加新条前先降级或合并最弱的一条 |
| 追加 Decision 不做取代检查 | 新旧两条并存打架，下一角色不知道听谁的 | 新条写「取代：<日期>」，旧条末尾标「→ 被 <日期> 取代」 |
| 说话带「可能 / 建议 / 考虑」却指望被记成决策 | record 后发现进了 Notes 带 `Needs-Confirmation` | 要记成决策就把话说死；或在 `/record` 时明说「这条是决定」 |
| 把用户对 AI 的纠正只写进 memory | 换个 session 同样的错再犯，evolution-runner 也扫不到 | 纠正一律走 feedback-observer；memory-systems.md 明写「不能只写 memory」 |
| feedback 的 scope / supersedes 写「不清楚」以外的编造 | 规则被用到不该用的地方，或与旧规则并存 | 判断不了写「未说明」，不编；`applied_to` 没落地写 `pending` |
| agent memory 越写越厚 | fresh 实例开工先读 40KB 笔记，6 次工具调用预算被撑爆 | 单文件 5KB / 角色 50KB 封顶，超了搬 `docs/agent-notes/<角色>/` 留指针 |
| 把「本批不改 X」这类范围限制收进 domain/ | 库里堆满做完即失效的噪音 | 四类分拣：只有做完仍为真的才是口径；范围限制不进库，事实记录挂「已知污染」 |
| 压缩被 precompact 拦了就再压一次 | 10 分钟内第二次直接放行，欠账没记就丢了 | 拦下来那一次就派 `/record`；冷却窗是防砖不是给你绕的 |
| 单独提交「docs: 记 progress」 | 提交历史里记账提交比代码提交多 | 铁律 6：随下一个有代码的提交一起入库 |

下一章：[09 闸门与档位](09-gates-and-tiers.md)——这章提到的每道 hook 在哪一档响、怎么放行。
