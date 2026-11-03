# 04 需求与设计：Spec 迭代、架构、DFX、设计稿

这章解决的问题：代码开工之前那几份文档——Product-Spec.md、Product-Spec-CHANGELOG.md、Architecture-Design.md、DFX-Spec.md、Design-Brief.md、DESIGN.md、设计稿——各自是什么、由谁产出、什么时候该做、什么时候可以跳，以及机器闸 `predev-lint` 在这五份文档上卡什么。

读完你能做到：用一句话触发 0-1 需求采集或迭代改需求；看懂 `[确认] / [推断] / [默认] / [待定]` 四种标记并据此判断一条需求能不能顶回去；从 Spec 交付时的三行判定决定要不要做架构与 DFX；改需求时成对更新 Spec 与 CHANGELOG；把 `predev-lint` 跑红的原因对到具体规则；把下游报回来的「需求存疑」接回需求阶段。

前置：已按 [02 安装与初始化](02-install.md) 装好框架。本章命令都在项目根执行。

---

## 入门：做什么

### 阶段总览

| 阶段 | 触发 | 产物 | 谁执行 | 可跳过吗 |
|---|---|---|---|---|
| 需求收集 | 用户说想做产品 / 加功能 / 改需求（自动），或 `/product-spec-builder` | Product-Spec.md（+ 迭代时 Product-Spec-CHANGELOG.md） | 主 Agent 直接执行 skill | 不可 |
| 架构设计 | `/arch-designer`，或 Spec 交付时判为 M / L 档 | Architecture-Design.md（L 档另出 `.claude/harness/module-catalog.json` 骨架） | 主 Agent 直接执行 | 可，S 档默认跳 |
| DFX 设计 | `/dfx-designer`，或架构完成后顺路建议 | DFX-Spec.md | 主 Agent 直接执行 | 可，不涉钱 / 个人数据 / 医疗 / 物理设备时默认跳 |
| 设计规范 | `/design-brief-builder` | Design-Brief.md + DESIGN.md | 主 Agent 直接执行 | 纯 CLI / 纯后端可跳 |
| 设计稿 | `/design-maker` | demo/index.html 等（画布模式为 demo/canvas/） | 主 Agent 直接执行 | 可 |

这五步都是「文档类」工作，CLAUDE.md 允许主 Agent 亲自写，不派 Sub-Agent。编码 / 审查 / 测试 / 部署四个环节才必须派单（见 [05 开发精讲](05-development.md)）。

### 0-1 模式与迭代模式

`product-spec-builder` 有两种模式，靠项目里有没有 Product-Spec.md 分流：

| | 0-1 模式 | 迭代模式 |
|---|---|---|
| 前置 | 项目里没有 Product-Spec.md | Product-Spec.md 必须存在 |
| 触发 | 用户第一次表达想做产品 | 开发中提新功能、改需求、调 UI、纠正误解；或下游（code-review / tester / bug-fixer）送回「需求存疑」 |
| 流程 | 进场 WebSearch → 问风险档位 → 向人学业务四条线 → 覆盖扫描 → 需求单元测试 → 生成 → 复述 | 判档 → 问三件事 → 对照澄清记录查冲突 → 改 Spec → 追加 CHANGELOG → 复述 |
| 细则 | `.claude/skills/product-spec-builder/references/workflow-0-1.md` | `.claude/skills/product-spec-builder/references/workflow-iteration.md` |

启动检查会扫项目目录找需求文档：优先 Product-Spec.md，其次 `*spec*.md`、`*prd*.md`、`*PRD*.md`、`*需求*.md`、`*product*.md`。找到一个直接用，找到多个列出来问用哪个，没找到进 0-1 模式。所以你带着旧 PRD 来也行，它先读材料再只问没覆盖的。

### 最短路径：一句话起手

0-1 模式下用户只给一句短想法时，第一问是固定的（`workflow-0-1.md` 第 0 步）：

> 先别列功能。按真实使用过程讲一遍：谁会用它，他当时在做什么，最卡在哪里，最后希望手里得到什么？

你照着答就行。之后 AI 每轮只问 1-2 个问题，问的是「上一次」不是「一般来说」。答到四条线（现在怎么干 / 为什么做谁受益 / 规则与例外 / 谁说了算）都能用一个具体案例复述为止。

### 四种标记

Spec 里每条内容带来源标记，没标的一律按推断对待：

| 标记 | 含义 | 下游怎么用 |
|---|---|---|
| `[确认]` | 用户确认的事实，来源写用户原话或案例编号 | 实现者照做；反例出现时先摆矛盾再问 |
| `[推断]` | AI 的推断，来源写推断依据 | 实现时若现场证据相反，回报「需求存疑」+ 反例，不自行改需求 |
| `[默认]` | AI 采用的低风险默认，用户只行使否决权 | 照做；用户随时可否决 |
| `[待定]` | 没弄清的 | 只许出现在「待定问题」表里，功能条目上不许挂；按表里「不答先按什么做」做 |

`predev-lint` 会机器查这条：功能条目缺来源标记报 `NO_SOURCE_MARK`，功能条目挂 `[待定]` 报 `PENDING_IN_REQUIREMENT`。

### 交付 = 复述通过

Spec 生成后没有「请批准」按钮。签字闸的形式是 `[复述理解]`：AI 用你给的案例讲一遍上线后那次会怎么发生——谁打开什么、看到什么、系统做什么、例外那次怎么走、失败那次怎么恢复——每段结尾问一个具体的「那次是不是这样」。你挑出错，AI 改对应条目并回一句「改了第 X 条」；你挑不出错，就是通过。

复述之前主 Agent 先跑两道机器闸（`dev-workflow-details.md` [交付阶段]），红了先修再复述，机器能挑的错不拿给人挑：

```bash
node .claude/harness/harness.mjs spec-lint --file Product-Spec.md
node .claude/scripts/predev-lint.mjs
```

没过复述不进 `dev-planner`。

---

## 进阶：为什么、怎么判

### 风险档位决定什么

第一轮 AI 会问一句风险档位，三选一：**自用 / 内部 / 对外或涉钱涉合规**。它不是给你贴标签，是定三件事：

| 档位 | 问题预算 | Spec 长度 | 额外动作 |
|---|---|---|---|
| 自用 / 小工具 | 6-8 问 | 两页够 | 无 |
| 内部系统 | 8-12 问 | 五到八页 | 无 |
| 对外或涉钱涉合规 | 最多 15 问 | 按需求条目走 | 复述前把 `references/elicitation-menu.md` 里最相关的 3-5 种深挖方法摆给你点，点了才跑，最多两种 |

到第 12 问 AI 要先做收敛审计：剩下的未知真会改变首版吗、能不能用默认、该不该进待定表、是不是该留给设计阶段。只有仍有会改变首版的高风险未知或矛盾才许超预算。

风险档位写进 Spec「产品概述」段，后面 `arch-designer` 与 `dfx-designer` 的判档都会读它。

### 交互深度四档

风险档位管整份 Spec，交互深度档管每一次开口。判据是「不确定程度 × 做错的代价」，不是你的热情，也不是变更的字数：

| 档 | 什么情况 | AI 怎么做 |
|---|---|---|
| 直推档 | 边界清楚、Spec 里有依据、错了一改就好（改按钮文案、加下拉选项、换默认值） | 不问，改完一句话复述 |
| 确认档 | AI 能推断，但推断会改变行为（「导出」是导出筛选结果还是全部） | 推断 + 推荐 + 一个问题，你一个字能答；一次最多两问 |
| 探索档 | 为什么做、谁受益、现在怎么干、例外在哪，有一样说不清，且做错代价高 | 进「向人学业务」 |
| 委托档 | 你说「你定」「按你经验来」「别问了」 | AI 自己定，写进决策依据标「AI 决定（用户委托）」，之后不回头问 |

迭代模式也先判档：直推档改完复述一句即完成；确认档以上先问三件事——为什么改（什么事触发的）、原来哪条判断错了（Spec 第几条、当时依据）、影响哪些已确认条目。

### 「向人学业务」为什么这么问

`SKILL.md` [四条底线] 的核心是：AI 不懂你的行业、组织、历史和隐性规则，得先向你学，再用你自己的案例讲回去让你挑错。所以它的问法有几条固定纪律（`references/interview-principles.md`）：

- 问过去的具体事，不问未来假设——「你上次怎么做的」碾压「你会不会用」。
- 先问上游，能并才并——要你讲经过的开放题一次只问一个，最多带一个同一决策的副问题；互不依赖、又都给得出选项的题同一轮编号问完，你按编号一口气答。
- 查得到的事实不问你——已有代码、真库、旧文档里有的，AI 自己去查；你说的现状和代码实际行为对不上，两边并排摆出来让你选。
- 你连着几问只回「好」「对」→ AI 停一下，挑代价最高的那条收起推荐，请你用自己那次的案例讲一遍；讲不出来的降为 `[推断]`。
- 听到「一般、通常、应该、大概」→ 这是推断不是事实，标 `[推断]` 并要一个具体例子。
- 听到「都要」「越多越好」→ 没有取舍，问「只能保一个，保哪个」。
- 与前面说过的矛盾 → 两句话并排摆出来让你选，不自己圆。
- 你说不出「上次」→ 需求可能是想象出来的，降为 `[推断]`，建议先验证再做。
- 你转述别人（「运营会……」）→ 问「亲眼见过还是估计的」，转述和推测在 Spec 里是 `[推断]` 不是 `[确认]`。

你会发现 AI 不接受形容词。「简单」会被问成「东西更少还是步骤更少」，「系统很慢」会被逼成「响应超过 5 秒、约 30% 的时候、下午 2 到 3 点之间」。这是四把刀（锚定过去 / 要例子 / 要数字 / 二选一）在起作用，不是刁难。

### Spec 模板各段是什么

模板在 `.claude/skills/product-spec-builder/templates/product-spec-template.md`。段名不能改，其中四段是 `spec-lint` 的必需段：

| 段 | 写什么 | 谁在下游读它 |
|---|---|---|
| 0. AI 使用说明 | 固定三条：本文档是事实来源；优先 P0、不做非目标；`[推断]` `[默认]` 现场证据相反时报需求存疑 | 所有下游 |
| 产品概述（必需） | 一句人话、为什么现在做（真实案例）、受益 / 买单 / 变差三种人、核心价值、风险档位 | arch / dfx 判档 |
| 应用场景：工作现状故事（必需） | 2-3 个真实发生过的案例，有名字有顺序有工具，例外单独一段 | design-brief、tester 取材 |
| 成功判据 | 可数、技术无关、有基线、有反向指标 | dev-planner、tester |
| 范围与非目标 | 本版范围（每条 P0 单独实现也可用）、至少 3 条非目标、「以后」清单 | dev-planner |
| 功能需求（必需） | 「用户做什么 → 系统做什么 → 得到什么」三段，带标记与来源；可选 `[REQ-<模块>-<三位数>]` 编号 | implementer、code-reviewer |
| 规则与例外 | 每条规则一个例子一个例外（无例外写「无」） | 派单包 Business Context、tester 例外用例、口径库上游 |
| 关键流程 | 主角有名字、有高潮、有失败路径 | design-brief、tester |
| 数据与权限 | 实体、关键字段、单一写入者、谁只看、删除 / 归档 | arch-designer 定 single writer |
| 决策依据 | 定了什么、否掉了什么、为什么、谁定的（用户 / AI 用户委托 / AI 建议用户采纳 / 既定不可碰） | progress.md Decisions |
| UI 与使用情境 | 使用情境、首要动作；布局方向聊到了就写 | design-brief-builder |
| AI 能力 | 产品要用 AI 才写；质量条 / 触发 / 不确定时 / 降级 / 错了谁兜底 + 绝不能做 | dfx AI 附加行 |
| 技术方向（必需） | 产品类型、首版平台、技术栈（先 WebSearch）、存储、部署 | dev-planner |
| 非功能与隐含合规 | 六类各有数字或「不要求」；行业隐含合规点名不替答 | dfx-designer |
| 待定问题 | 全文唯一允许 `[待定]` 的地方，五列齐：问题 / 影响什么 / 谁能答 / 押后到 / 不答先按什么做 | dev-planner 开工前置 |
| 澄清记录 | 每次问答一行；问过的不再问的证据 | 迭代模式查重 |

`[REQ-...]` 编号是可选的：不写照常能用；写了 `harness.mjs trace` 能把需求和测试对上，`plan-lint` 能查开发计划有没有漏做。编号必须顶格写在列表项最前面，缩进超过一个空格机器就当你没写。小项目别加。

### Spec 交付时的三行判定：该不该做架构与 DFX

Spec 交付时 AI 会跟三行判定，每行「做」或「可跳过」加一句理由，判据只用 Spec 里已有的信息（`SKILL.md` [下一步判定]）：

| 判定 | 「做」的条件（任一命中） | 跳过的代价 |
|---|---|---|
| 架构设计 | 风险档位是对外或涉钱涉合规；或核心功能 ≥ 6 条；或数据实体 ≥ 4 个；或用户明确说要多模块 | 模块边界由编码时即兴决定，往后加功能可能要重划 |
| DFX | 涉钱 / 个人数据 / 医疗 / 控制物理设备任一命中；或非功能表里已有 P0 数字 | 质量属性只剩形容词没有度量，验收时无据可依 |
| 设计规范 | 产品有 UI | 无（纯 CLI / 纯后端） |

这三行是判定不是命令：你说跳就跳，AI 不劝第二次；跳过的那条连理由记进 progress.md，往后返工时查得到当时按什么依据跳的。

`arch-designer` 自己还有一套 S / M / L 规模分级，决定它走多深：

| 档 | 判据 | 产出深度 |
|---|---|---|
| S | 单模块 / ≤ 5 个功能 / 单人短周期 | 一页架构速写：命名范式 + 技术栈 + 目录结构 + ≤ 3 条关键决策 + 包络一行 + 押后一行；跳过 C4 与 catalog |
| M | 2-6 个模块 / 有明确边界诉求 | 完整 Architecture-Design.md；catalog 骨架可选 |
| L | ≥ 7 模块 / 多人协作 / 10 万行以上 | 完整文档 + 必产出 `module-catalog.json` 骨架，接通 arch-check；建议紧跟 `/dfx-designer` |

宁轻勿重，你可以显式要求升档，越档要在模板「越档理由」表写原因。

### CHANGELOG 成对更新

迭代模式改 Spec 时必须追加 Product-Spec-CHANGELOG.md，只改一个不算（CLAUDE.md 三文件同步铁律）。模板在 `templates/changelog-template.md`，一条记录回答四件事：

```markdown
## [v1.2] - 2026-09-15
**为什么改**：tester 写「VIP 单老张休假」用例时发现 Spec 没写走法，报需求存疑；用户确认退回组长派。
**原判断哪里错**：Spec 规则与例外第 2 条只写了「VIP 直达老张」，当时把老张常在当成了事实，实际每年休假两次。
**影响**：功能需求「VIP 直达」条目；Phase 2 派单规则。
**分类与回退**：行为变化；回 dev-planner 更新 Phase 2 Task，设计不变。

### 修改
- VIP 直达：老张不在（系统里标记休假）时退回组长派单 `[确认]`（来源：用户原话 2026-09-15）
```

「为什么改」与「原判断哪里错」不能空——它们是你以后核对自己判断的证据，也是 progress.md Decisions 的来源。版本号每次迭代 +0.1，重大改版 +1.0。

「分类与回退」用 `workflow-iteration.md` 的七种变更分类（澄清 / 加范围 / 减范围 / 行为变化 / 数据权限变化 / 验收变化 / 纠正），分类决定回退到哪个阶段：

| 变更影响 | 回退到 |
|---|---|
| 只改描述、无行为影响 | 不回退 |
| 改用户流程、界面结构、数据、权限、平台 | design-brief-builder / arch-designer，再 dev-planner |
| 设计不变、只改工作量 | dev-planner |
| 代码缺陷、不改需求 | bug-fixer，不改 Spec |

Spec 里被推翻的条目标「→ 被 <日期> 取代」，不删历史，不复用编号。

### arch-designer 产物：不变量、模块划分、ADR

Architecture-Design.md 的模板有 16 段（`templates/architecture-design-template.md`），核心是三样：

**不变量**。文档只写「两个各自独立开发的单元会在这上面做出不兼容选择的决定」；其余（栈、目录树、完整数据形状）是种子，代码一出现就归代码。判一条该不该进文档只问一句：如果两个独立构建的单元各自决定，会不会选得不兼容？会、且不显然、且是真取舍，才写；否则进「§9 押后决定」一句话带过。

**模块划分表**。每模块 id / 职责一句话 / 对外契约 / 依赖谁 / 禁依赖谁 / 变化原因 / riskTier，配 C4 上下文图与容器图（mermaid）。依赖必须画得出方向：出现双向依赖或环 = 边界划错了。七大设计原则（OCP / DIP / SRP / ISP / LoD / LSP / CARP）在这里既用来推演也用来自检，每条给出架构级投影与违反信号。

**ADR**。风格 / 存储 / 通信三样必须有结论，但不是每个结论都配一条 ADR——三条都占才记：撤回代价高、不交代背景后来的人会纳闷、当时真比过候选。缺一条的在模板 §8 的表里留一行结论加一句理由；没有真备选的选型硬编「被拒备选」比不写更糟，所以 ADR 不设条数下限。够得上的每条九个字段：背景与问题 / 决策驱动 / 候选与优劣 / 结论 / 后果 / 被拒备选 / **执法方式** / **revisit-if** / **reversal**。后三项被 `adr-check` 机器校验：

| 字段 | 合格 | 不合格 |
|---|---|---|
| 执法方式 | 指到 catalog check id / fitness 规则 id / harness 能力名（arch-check、layers、forbiddenDependencies…）/ 或显式「人工评审」 | 「大家注意」；指向不存在的闸（幽灵引用） |
| revisit-if | 写条件：日活超过 5 万 / 需要多租户 / 团队超过 3 人 | 写日期：三个月后再看 / 视情况 |
| reversal | 写撤回步骤与代价：换掉 ORM——改 storage 模块 12 个文件 + 一次数据迁移，约 3 天 | 空着。写不出撤回步骤的显式写「单向门」，不算 fail 但单列进单向门清单，须在 §9 或 §11 点名交你拍板 |

另外「§7 运行与部署包络」四项（环境 / 部署拓扑 / 基础设施与供应商 / 运维）每项必须是「决定 / 押后 / 未定」三态之一，整段留白是评审要挡的失败。

推演有两条路：默认 Coaching（把决定从你嘴里拉出来，承重的选择摆候选让你定），你明说要快才走 Fast（先起草整份，推断处标 `[假设]`，你审阅时纠正）。定风格前先问两件事：哪个模块坏一小时最疼、疼在谁身上；团队现在会什么、几个人维护。两人团队上微服务是负债不是架构。

输出阶段跑的命令：

```bash
node .claude/harness/harness.mjs catalog-lint   # L 档产 catalog 后
node .claude/harness/harness.mjs adr-check      # 校 ADR 后三项，rc 0 才交付
node .claude/scripts/predev-lint.mjs             # 必需段、ADR 字段、占位符
```

### dfx-designer 产物：档位、威胁表

DFX-Spec.md 模板 11 段（`templates/dfx-spec-template.md`），三个东西最要紧：

**优先级栈**（§1）。冲突时前压后，至少两项、一项一行（`predev-lint` 查 `PRIORITY_STACK_TOO_SHORT`）。DFX 维度互相打架（性能↔可修改性、成本↔可靠性），栈就是本项目所有取舍的引用依据。

**十三维总表**（§2）与**按模块定档**（§7）。每维给场景 / 度量 / 对策 / 验证落点；「度量」列每行含数字或 N/A（`UNMEASURED`）。档位六档：critical / high 阻断、medium 告警、low / minimal 记录、none 留痕退出；none / minimal 必须给书面理由。按模块 × 维度定档，不全局一刀切——支付模块 security:critical，营销落地页 security:medium。定档靠追问三件套：这个模块坏 1 小时损失什么 / 里面的数据泄了上什么新闻 / 谁半夜起来修它。

**威胁表**（§5）。Spec 或架构命中九类触发之一——项目外文件访问 / 网络或外部 API / Secret / 用户或 AI 生成的 HTML / 命令执行 / 删除·覆盖·发布 / 大文件与媒体解析 / iframe·postMessage·Bridge / 长任务与并发写回——该项必有一行 THR（资产 / 入口 / 威胁 / 影响 / 缓解 / 验证 / 关联 ID）。没有威胁表的安全定档只是个形容词。

还有两处机器校验：

- **延迟与重试预算表**（§3，韧性维必填）：各层预算之和 ≤ 端到端（`BUDGET_OVER_END_TO_END`），重试次数非 0 的最多一行（`RETRY_LAYERS_OVER_ONE`）。理由写在模板里：重试逐层相乘，5 层各 3 次就是 243 次。
- **隐含合规扫描**（§4）：个人数据、支付、医疗、未成年人、面向公众、审批留痕、开源分发、加密跨境、等保——这些词一出现，对应法规就是需求。命中的进合规表并成对回写 Spec「非功能与隐含合规」+ CHANGELOG。

Spec 有「AI 能力」段时 §8 必填：自主性分级（L0-L3，默认 ≤ L2）、审批门、熔断、成本上限、可追溯，每行要度量与验证。

评审模式（你说「DFX 评审」）只出评分卡（13 维 × 满足 / 风险 / 缺口 + 整改建议），不改任何文件；整改归 arch-designer 或 dev-planner，DFX 是裁判不是球员。

### Design-Brief 与 DESIGN.md 的分工

`design-brief-builder` 产两份互为姊妹的文件：

| | Design-Brief.md | DESIGN.md |
|---|---|---|
| 回答 | 怎么运作 | 怎么看 |
| 内容 | 信息架构、页面 SCREEN-n 与组件 CMP-n、八态、交互原语、文案、无障碍、关键流程 | 按 Google DESIGN.md 开放规范：YAML 前言 token（colors / typography / rounded / spacing / components）+ 八段 prose（Overview / Colors / Typography / Layout / Elevation & Depth / Shapes / Components / Do's and Don'ts） |
| 下游 | design-maker 覆盖判据；code-review 状态清单 | design-maker 原样进 prompt；代码颜色 / 字号 / 圆角只从 token 来，不许散写 hex |
| predev-lint 查 | SCREEN 编号存在（`NO_SCREEN`）、每个 SCREEN 有 `**必需状态**` 与 `**响应式**`（`SCREEN_INCOMPLETE`）、引用的 FLOW / SCOPE 在 Spec 里存在（`DANGLING_REF` 告警） | 有 YAML 前言（`NO_FRONTMATTER`）、正文 `{colors.primary}` 这类记号能解析（`UNRESOLVED_TOKEN`）、八段顺序（`SECTION_ORDER`）、不重名（`DUPLICATE_SECTION`） |

八态指：空 / 加载 / 成功 / 错误 / 冲突 / 离线 / 无权限，AI 产品加「Agent 工作中」。收敛条件里有一条 surface closure：Spec 每条 P0 需求有一个页面承接，每个页面有一条流程落到它。

采访顺序是「形态 → 受众情境 → 情绪人格 → 参考与反参考 → 轴与 token → 核心呈现与状态 → 结构与落地规格」，颜色是最后挣来的。你说「高级感」会被逼成「苹果那种大留白，还是爱马仕那种深色配金」，再被拆成属性。参照顺序（`dev-builder` [设计参照]）：设计稿 → DESIGN.md → Design-Brief.md → Product-Spec.md，冲突时前者为准。

`npx @google/design.md lint DESIGN.md` 能跑就跑（校 token 引用与对比度），内网跑不了标「未经 lint」不阻塞。

### design-maker：两遍法与 ui-audit 验收

`design-maker` 用 Open Design CLI（`odc`）生成一份单文件可交互 HTML 设计稿，开发照它编码、干系人直接浏览器打开评审。本机没有 `odc` 不退出，走「提示词模式」：前期功课照做，产出 `demo/design-prompt.md` 交你拿去任意工具生成。

三条路的先后：`odc` 优先；你主动点名 Claude Design 才走「画布模式」，主动要提示词才给提示词，不会因为会话里能出画布就自己改道。画布模式下全稿是画布上的一组画板，画完必须把画布上的文件全部拉回 `demo/canvas/` 并入库——画板源文件算编码的一部分，画布链接只是看稿入口。拉回来的还包括画板的运行文件（存成 `demo/canvas/project/support.js`）和一页本地目录 `demo/canvas/index.html`，浏览器打开目录页就能逐张看；双击打不开时在 `demo/canvas/` 下起一个本地静态服务再开。UI 审计一次只审一张，没审到的画板会在报告里写「UI 审计未覆盖」。

三阶段：

| 阶段 | 做什么 | 产物 |
|---|---|---|
| Phase 1 准备 | 读三份文档 → 选 design system 基底 → 两遍法 → 构建 prompt → 展示计划等你确认 | `demo/design-plan.md`、`design-prompt.md` |
| Phase 2 生成 | 2A 先出三个首屏方向样张让你选 → 2B 按选定方向出全稿 → 验收；2C AI Studio 手动兜底 | `demo/directions/direction-{1,2,3}.html`、`demo/index.html` |
| Phase 3 交付 | 落地到 `demo/`，commit | 完成报告 |

**两遍法**是防「AI 味界面」的核心：第一遍写一页紧凑设计计划（token 摘录、每页 ASCII 线框与对齐、大胆放在哪一处、动效只留哪一处、组件复用清单）；第二遍逐项对照 `design-brief-builder/references/style-vocabulary.md` 的 AI 通病清单与 DESIGN.md 的 Don'ts 自审——任何一处是「给任何同类页面都会给的默认」而不是给这个产品的选择，就改并写「原本 → 改成 → 为什么」进 design-plan.md。只有审过才生成。

**验收**逐条跑，不凭看：完整无截断（含 `</html>`）、离线自包含（无 `cdn.` / `unpkg.` / `googleapis`）、页面覆盖、八态覆盖、token 一致（产物 hex 全部在 DESIGN.md colors 里）、UI 审计、AI 通病自检、质量地板抽查。UI 审计命令：

```bash
node .claude/scripts/ui-audit.mjs demo --themes light --widths 1280,390 --out demo/ui-audit --strict
```

它逐主题 × 宽度真渲染，查横向溢出 / 小控件折行 / 文本对比度 / 空白渲染，截图落盘；另出一组「套话味」advisory（小号全大写标签、中点分隔、箭头结尾、一律圆角），只提示不参与 pass 判定。退出码：

| rc | 含义 |
|---|---|
| 0 | 审计完成 |
| 1 | `--strict` 且未通过（空白 / 溢出 / 折行 / 对比度） |
| 2 | 用法或目标不对 |
| 3 | 浏览器引擎缺席——未执行 ≠ 通过，报告里必须写「缺席」 |

依赖 `playwright-core` + 本机 Chrome，或一次性 `npm i playwright`。没有引擎时 rc 3，design-maker 报告注明「UI 审计缺席」，不冒充通过。

不带参数跑，你会看到：

```
缺少目标：URL 或设计稿目录
用法：node ui-audit.mjs <url|目录> [--themes light,dark] [--widths 1280,900] [--out <dir>] [--strict] [--json]
  --themes  逐个写进 <html data-theme>，默认 light,dark
  --widths  视口宽度（px），默认 1280,900
  --out     截图与 ui-audit.json 落盘目录，默认 .claude/evidence/ui-audit
  --strict  审计不通过（空白 / 溢出 / 折行 / 对比度）时 rc 1
  --json    stdout 只打报告 JSON，进度与告警走 stderr
退出码：0 完成 / 1 strict 不过 / 2 用法或目标不对 / 3 浏览器引擎缺席
```

另一道不开浏览器的静态闸是 `ui-slop-scan.mjs`：把 style-vocabulary 的通病清单与 DESIGN.md 硬约束表变成源码上能跑的数字判据（紫色系、奶油底陶土橙、字号 / 字距 / 圆角写法等），纯文本判定。有意为之的在命中行或其上一行写 `unslop-ignore` 跳过。提示词模式下用户存回 HTML 后，主 Agent 用它复核：

```bash
node .claude/scripts/ui-slop-scan.mjs --paths demo
```

在本仓（没有界面源码）跑，你会看到：

```
ui-slop-scan: 未找到界面源码，跳过。
```

退出码 0 通过或跳过 / 1 有 error / 2 参数用法错，warning 只报不拦。

### predev-lint 五文档闸的判据

`predev-lint.mjs` 把五个前期 skill 的模板规则自动化，是主 Agent 在每份文档生成后必跑的闸。用法与退出码：

```bash
node .claude/scripts/predev-lint.mjs [--root <目录>] [--json]
```

- rc 0 通过或跳过 / 1 有 error / 2 参数用法错；warning 只报不拦。
- 五份按存在性检查，缺哪份跳过哪份；五份都没有整体跳过。
- 只依赖 node 内置模块，不 import `.claude/harness`——引擎坏了这道闸也要能跑。
- 围栏感知：标了模板 / 代码语言（html / vue / jinja / js / ts / jsx / tsx…）的围栏里 `{{…}}` 是语法不扫；其余围栏与正文里的槽照扫。围栏没闭合报 `UNCLOSED_FENCE`。

在本仓（没有这五份文档）跑 `--json`，你会看到：

```json
{
  "ok": true,
  "root": "/home/z00632348/code/cc-base",
  "checked": [],
  "skipped": [
    "Product-Spec.md",
    "Design-Brief.md",
    "DESIGN.md",
    "Architecture-Design.md",
    "DFX-Spec.md"
  ],
  "errors": 0,
  "warnings": 0,
  "findings": []
}
```

不带 `--json` 是一句 `predev-lint: 五份前期文档一份都没有，跳过。`

各文档的判据（error 拦、warn 只报）：

| 文档 | 错误码 | 判什么 |
|---|---|---|
| 全部 | `PLACEHOLDER` | 尖括号槽、TBD、TODO、待补等占位残留（待定问题表里的「待定」二字放过） |
| Product-Spec.md | `MISSING_SECTION` | 缺必需段（产品概述 / 应用场景 / 功能需求 / 技术方向） |
| | `NO_SOURCE_MARK` | 功能条目没有 `[确认]` / `[推断]` / `[默认]` |
| | `PENDING_IN_REQUIREMENT` | 功能条目挂着 `[待定]` |
| | `PENDING_ROW_INCOMPLETE` | 待定问题表行不是五格齐或有空格子 |
| | `NO_SUCCESS_CRITERIA` | 成功判据只有表头没有数据行 |
| Design-Brief.md | `NO_SCREEN` | 信息架构里一个 SCREEN-n 都没有 |
| | `SCREEN_INCOMPLETE` | 某 SCREEN 缺 `**必需状态**` 或 `**响应式**` |
| | `DANGLING_REF`（warn） | 引用了 Spec 里没有的 FLOW / SCOPE 编号 |
| DESIGN.md | `NO_FRONTMATTER` / `MISSING_TOKEN` / `UNRESOLVED_TOKEN` | 没有 YAML 前言；前言缺 token；正文 `{a.b}` 记号解析不到 |
| | `SECTION_ORDER` / `DUPLICATE_SECTION` | 八段顺序不对；段重名 |
| Architecture-Design.md | `MISSING_SECTION` | 缺必需段 |
| | `ADR_INCOMPLETE` | ADR 缺字段 |
| DFX-Spec.md | `PRIORITY_STACK_TOO_SHORT` | 优先级栈少于两项 |
| | `UNMEASURED` | 维度总表「度量」列不含数字也不是 N/A |
| | `BUDGET_OVER_END_TO_END` / `RETRY_LAYERS_OVER_ONE` | 各层预算之和超端到端；重试层数超过一层 |
| | `BUDGET_*` / `RETRY_*`（warn） | 预算读不出毫秒、没写 fallback、没有端到端行、重试次数读不出、一层都不重试却没说明 |

### 领域口径库是副产品

有一种东西不属于 Spec、不属于 progress.md 的 Decisions、也不属于 feedback：这个领域里「事情是怎么算的」——关联键用 OLT IP 不用名字、Cluster 边界等于整簇凸包。产品做什么、代码怎么实现都可以变，事情怎么算不跟着变。这是第四种记忆，载体是项目根 `domain/<域>.md`，规则在 `.claude/rules/domain-rulings.md`，入口是 `/domain-rulings`。

它是副产品：长在需求分析、澄清、方案设计的对话里，不进四步走、不设卡点、不出现在任何验收链路上；没有 `domain/` 是正常的，不报错不催补。存在的理由只有一个：让 AI 下一次输出更准的需求规格、更稳的架构、更好用的前端设计。

**四象限分诊**是判一条该去哪儿的方法。问一句「这条当初是谁知道的」：

| 人知？ | AI 知？ | 去处 |
|---|---|---|
| 知 | 不知 | Spec「规则与例外」——走 product-spec-builder 迭代模式 |
| 不知 | 知 | 技术方向 / ADR / progress.md Decisions |
| 知 | 知 | 功能需求，Spec 正文 |
| 不知 | 不知，要共同查证才得出 | **口径库**——唯一入口 |

这个判断机器做不了，四格里的条目长得一模一样，区别只在它当初从谁那儿来。所以 `/domain-rulings` 由主 Agent 自己走、对着人一问一答，不派 Sub-Agent；AI 不先给推荐答案——给了人就顺着点头。

入库两问：① 收它是为了让 AI 下次输出更准，答不出「下次哪一步会因为它不一样」就不收；② 离开这个项目还成立吗。依据只认三类：实测撞出来的 / AI 查外网得到的 / 人查公司内部得到的——凭记忆、凭推断说得再确定也不收。分工是定的：AI 去外网找，人去公司内部找。

写入一律派 domain-recorder，`/domain-rulings` 自己不碰 `domain/` 里的文件。采集寄生在 Sub-Agent 回执的 **Domain findings** 栏——子 Agent 本来就要写回执，顺手多填一栏；填不出写 None，不逼着凑。

### 「需求存疑」从下游回流

四个下游都可能发现「代码对得上 Spec、Spec 对不上业务」：

| 来源 | 什么情况 | 怎么报 |
|---|---|---|
| code-reviewer Stage 1 | Spec 条目与规则 / 例外矛盾；`[推断]` 条目被现场证据推翻；代码照 Spec 做但受益者拿到的结果对不上「为什么做」 | 报告单列「❓ 需求存疑」，不算 Stage 1 失败 |
| tester 失败三分流 | 断言按 Spec 写没错，但与 Business Context 的规则 / 例外矛盾 | 用例先 skip 并注明原因 |
| bug-fixer | 修成 Spec 说的行为反而让例外那次走错 | 停，不修「正确的 bug」 |
| dev-planner | 待定表的默认与正文条目打架、规则没覆盖的分支 | 计划开头「开工前置」段列明待回签 |

反例统一格式：**情境 → 按 Spec 会怎样 → 业务上应怎样 → 依据**。主 Agent 接到后调 product-spec-builder 迭代模式：反例进「规则与例外」标来源（哪个下游、哪个情境）、追加澄清记录、成对写 CHANGELOG（「为什么改」里写清反例是什么）、复述签字，然后按 CHANGELOG 的「分类与回退」派对应 skill，最后回流开发链。审查者、测试者、修复者都不替你改 Spec。

---

## 精通：内部机制与边界

### 收敛条件与完成度判据

Spec 什么时候算够，`SKILL.md` [收敛条件] 是硬条件：待定问题表清零或每条都有「谁能答 / 押后到 / 不答先按什么做」（能答的人不在场、又卡着首版核心流程的，AI 会提一句替你给那个人出问卷，写法在 `references/third-party-questionnaire.md`，你转发出去、答复回来走迭代模式）；功能条目无 `[待定]`；每条核心需求有来源标记，`[确认]` 至少一个真实案例支撑；成功判据能数出来且技术无关；矛盾清零；`spec-self-review.md` 逐条过；`spec-lint` 与 `predev-lint` 都过；复述通过。

`workflow-0-1.md` 另给三个软判据：交接测试（交给没参与对话的工程师能直接开工不用猜吗）、边际测试（再问一个问题答案会改变要做什么吗）、不对称原则（缺了会让开发返工的必须问到底，缺了以后便宜能补的进待定表直接放行）。关键需求约 80% 置信、剩余都是便宜能补的，就停。缺「整体布局」「技术偏好」不阻塞生成；缺「现在怎么干」和「谁受益」不生成——那是文档的地基。

`references/spec-self-review.md` 是需求的单元测试，测的是需求写得好不好，不是系统做得对不对：完整性 / 清晰 / 一致 / 可度量 / 标记纪律 / 隐含合规 / 交接七组问题，每条对照 Spec 具体段落过。

### 三份文档之间的输入关系

| 上游 → 下游 | 传什么 |
|---|---|
| Spec → arch-designer / dfx-designer | 数据归属与权限、故障后果、行业隐含合规、涉钱涉人身条目 |
| Spec → design-brief-builder | 使用情境与首要动作、受益者画像、关键流程（命名主角）、失败路径 |
| Spec → dev-planner | 核心价值排序、成功判据、`[推断]` `[默认]` `[待定]` 清单——计划先验证这些假设 |
| Spec → 主 Agent 派单 | 每条功能的「为什么、谁受益、相关规则与例外」是派单包 Business Context 的来源 |
| Architecture-Design → dev-planner | Phase 按模块边界拆，目录结构沿用骨架 |
| DFX-Spec → dev-planner | 各维验证手段折进对应 Phase 验收；critical / high 档验证不许推到最后一个 Phase |
| DFX-Spec → arch-designer | 质量属性场景是架构驱动因子；没有就在关键决策处标 `[待 DFX 补充]` |
| Design-Brief → arch-designer | 页面与组件数量、Class C 复杂交互（画布 / 时间线）是模块边界与 spike 的输入 |
| Design-Brief → dfx-designer | 25010「交互能力」直接引用 Brief 的可访问性与响应式条目和八态，DFX 不重定 |
| DESIGN.md → dev-planner | token 落地作为首个含 UI 的 Phase 里的独立 Task |

顺序不是死的：arch 与 dfx 互为可选输入，谁先做都行，缺的那份标注后引导补。

### ADR 与口径的分界

`arch-designer` [第一性原则] 给了一条判据：ADR 记的是架构取舍，口径记的是领域判据。分不清就问「它是不是在几个候选方案里做了取舍」——是则 ADR，否则口径。一条 ADR 可能带出若干条口径，反过来口径不构成 ADR。

同理 `domain-rulings.md` 划了口径与其他三样的界：progress.md Decisions 是项目决策（跟项目走）；feedback 是 AI 工作方法的纠正（跟 AI 走）；Spec 功能需求是产品要做什么；口径是事情怎么算（跟领域走）。判去向：问「换一个八竿子打不着的项目，这条还成立吗」——成立且与业务无关的是框架问题，成立且描述某个域的是口径，不成立的是这个项目的需求问题。

### 三文件同步在需求阶段的落点

- 架构关键决策、DFX 档位与优先级栈、Design 的形态 / 密度 / 主题 / 参照——都即时进 progress.md Decisions（依据 / 适用范围 / 取代哪条）。
- 「既定不可碰」的决定进 Pinned。
- Spec 改动成对带 CHANGELOG；dfx 合规扫描回写 Spec 也要成对。
- 决策一出现就写进文件，但随下一个有代码的提交一起入库，不为记账单独提交。

### 边界：这些事需求阶段不做

- 不问像素：圆角、阴影、间距的值归 DESIGN.md token 和设计工具，采访只定方向。
- 不问「你要什么样的 UI」：布局归 design-brief-builder；需求阶段只问使用情境和这一屏最要紧的那个动作。
- 不默认加 AI 功能：AI 能力只在现状故事里出现「判断、生成、识别、归类」这类靠人脑的工作时才提，提的时候说清替代哪一步、错了谁兜底。
- 不替用户挑 MVP 切法、定阶段、提功能——发现自己在代笔就停，把笔还回去。
- 看盘 / 报表 / 指标卡在数据没准、基本功能没稳之前一律默认降级挂账。

Windows 差异：本章所有命令都是 `node` 脚本，PowerShell 直接跑同一条；`npx @google/design.md lint` 需要 npm 可达，内网先配代理。

---

## 常见坑

| 坑 | 表现 | 怎么办 |
|---|---|---|
| 把「一般会」写成需求 | Spec 里出现「客户一般会打电话催」→「系统需支持电话催单」 | 那是推断，标 `[推断]` 并要一个真实案例；没有案例的降级或进待定表 |
| 功能条目挂 `[待定]` | `predev-lint` 报 `PENDING_IN_REQUIREMENT` | 改成 `[默认]` 做法（如 `[默认]` CSV，来源：现状是 Excel），待定表留一行 |
| 待定表少格 | `PENDING_ROW_INCOMPLETE` | 五列齐：问题 / 影响什么 / 谁能答 / 押后到 / 不答先按什么做；没有「谁能答」是空喊 |
| REQ 编号没被认出 | plan-lint 或 trace 提示「写了编号但没被识别成声明」 | 编号顶格写在列表项最前面 `- [REQ-CORE-001] …`，缩进超过一个空格就不算 |
| 只改 Spec 不写 CHANGELOG | 三文件同步闸提醒；以后没人知道当初为什么这么定 | 迭代模式第五步必追加 CHANGELOG，「为什么改」「原判断哪里错」不能空 |
| 已委托的事又被问 | 上一轮说了「技术栈你定」，AI 又问 React 还是 Vue | 这是 AI 违反「问过的不再问」，指出来；澄清记录是证据 |
| ADR 的 revisit-if 写日期 | `adr-check` fail | 写条件不写日期：「日活超过 5 万」「团队超过 3 人」 |
| ADR 执法方式指向不存在的闸 | `adr-check` 报幽灵引用 | 指到真实的 catalog check / fitness 规则 / harness 能力名，或显式「人工评审」 |
| 部署包络整段留白 | 架构评审挡下 | 环境 / 拓扑 / 基础设施 / 运维每项写决定 / 押后 / 未定三态之一 |
| DFX 预算表两层都重试 | `RETRY_LAYERS_OVER_ONE` | 全链路只指定一层重试，其余写 0；一层都不重试也行，但要在端到端行说明 |
| DFX 度量写形容词 | `UNMEASURED` | 数字 + 单位 + 测法，或 N/A + 理由 |
| Design-Brief 写像素值 | brief 里出现「圆角 8px、阴影 0 2px 8px」 | 方向进 Brief，值进 DESIGN.md token |
| 三个方向样张长得一样 | 都是「奶油底 + 衬线 + 陶土橙」或「近黑 + 酸绿」 | 那是 AI 默认不是选择；两遍法第二遍要对照 style-vocabulary 通病清单改掉 |
| ui-audit rc 3 被当通过 | 报告写「审计通过」但本机没有浏览器引擎 | rc 3 = 缺席 ≠ 通过；报告必须写「UI 审计缺席」 |
| `odc --json` 解析失败 | 输出里混着 `[plugins] registered ...` | 解析前 `grep -v '^\[plugins\]'` |
| odc run `succeeded` 但产物空 | `status: succeeded` 而 `exitCode ≠ 0` | 假成功；读 `~/open-design/.od/runs/<runId>/events.jsonl` 定位真因，别盲目重试 |
| 把本次范围限制收进口径库 | 「本批不改 X」「不新建表」进了 `domain/` | 做完即失效的不进库；口径要做完仍为真 |
| 人早知道的业务规则收成口径 | 「我们一直按 IP 关联」进了 `domain/` | 第一格，家在 Spec「规则与例外」；收错地方派单时只抄 Spec 的人看不见它 |
| 子 Agent 报的线索直接入库 | 一次实测就定论 | 线索 ≠ 口径；AI 查外网、人查内部补齐依据才入库 |

下一章：[05 开发精讲](05-development.md)——从 DEV-PLAN 到每个 Task 的派单与验收。
