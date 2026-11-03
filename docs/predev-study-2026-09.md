# 开发前阶段（需求 / 界面 / 架构 / DFX）吃透与改造报告

> 2026-09-09。材料：`~/code/other/`（毒舌产品经理 3.0 / 4.0 / 5.0 两版、插件经理三版、script-breakdown、微信小程序 Cursor Rule）+ 业界一手源（当日联网实查，原文逐行读过的都在 `/tmp/predev-study/` 留了副本）。本报告只记结论与证据，改造落在 `feat/predev-upgrade` 分支。

## 0. 一页结论

- **需求侧**：我们 09-08 的「向人学业务 / 三种话分开 / 澄清记录 / 交互深度分档 / 案例复述」方向是对的，业界没有更好的地基；缺的是**方法层的厚度**——没有问题库（五段结构）、没有访谈原理（Mom Test 五铁律 + LLM 访谈七种失效）、没有覆盖扫描与问题预算、没有可测的成功判据、没有失败路径、没有范例、没有机器闸。PM 5.0 与 Spec Kit 各补一半。
- **界面侧**：我们的 design-brief-builder 在 09-08 去重脚本事故里被吞成 27 行（`5f7a4c9`，264 → 27，`[初始化]` 指向不存在的段），实际处于**不可用**状态；模板还是 4.0 的老版。业界 2026 年的共识已经收敛成两件事：**DESIGN.md（Google 开放规范，BMAD / Stitch / awesome-design-md 都采用）当机器可读的视觉身份**，加**一份行为脊柱（IA / 状态 / 交互原语 / 文案 / 无障碍 / 关键流程）**；「好看且时尚」的可操作定义来自 Anthropic frontend-design（五类 AI 通病 + 两遍法 + 一处放大胆）与 Vercel 界面规则（MUST/SHOULD/NEVER 质量地板）。
- **架构侧**：我们的七大原则 + ADR 执法方式 + catalog 机器闸已经领先多数框架；要补的是 BMAD 的**不变量测试**（只写「两个独立单元会做出不兼容选择」的决定，其余进 Deferred）、一致性约定表、运行与部署包络不许沉默、C4 两张图、MADR 形态的候选与后果。
- **DFX 侧**：我们的 12 维 + 六要素场景 + 档位经济学已经是华为口径的软件投影；要补 ISO/IEC 25010:2023 映射（新增 safety 五子特性、interaction capability、flexibility/scalability）、行业隐含合规扫描（BMAD spec 的做法）、威胁表（插件经理）、AI 产品的自主性 / 审批 / 熔断行。
- **两处硬伤当场发现**：① design-brief-builder 截断；② 09-08 新需求模板与 harness `spec-lint`（`lib/spec.mjs:52-58`）互相矛盾——模板把「应用场景」改名「工作现状故事」、把 `[待定]` 当合法标记，而 spec-lint 要求「应用场景」段存在、把裸 `待定` 记 PLACEHOLDER 错误。按新模板写出的任何 Spec 都过不了 spec-lint，而没人跑过。

## 1. 读了什么（证据）

| 来源 | 文件 / 行数 | 读法 |
|---|---|---|
| 毒舌产品经理 5.0 claude 版 | CLAUDE.md 166；product-spec-builder SKILL 109 + interview-principles 48 + question-bank 353 + workflow-0-1 67 + workflow-iteration 28 + 模板 292/73 + 范例 970；design-brief-builder SKILL 86 + question-bank 310 + workflow 56/20 + 模板 418 + 范例 1110；design-maker 33；goal-creator 52；dev-planner 57 | 逐行 |
| 毒舌产品经理 5.0 codex 版 | 与 claude 版 diff：只有 dev-builder / evolution-engine / skill-builder 四文件不同，前期 skill 逐字相同 | diff |
| 毒蛇产品经理 4.0 | CLAUDE.md 364；product-spec-builder SKILL 370 + 模板 215/111；design-brief-builder SKILL 264 + 模板 176；design-maker 153 | 逐行 |
| 毒蛇产品经理 3.0 | CLAUDE.md 235；product-spec-builder 335 + 模板 197；ui-prompt-generator 139 + 模板 154 | 逐行 |
| 插件经理 1.0 claude 版（codex / DeepSeek 版同源，仅宿主适配不同） | plugin-spec-builder SKILL 203 + dialogue-style 83 + question-bank 679 + workflow 224/90 + 模板 122；interactive-plugin-builder SKILL 94 + interview-protocol 99 + host-profiles 99 + artifact-contracts 144 + orchestration-core 238 + platform-defaults 86 + project-state-rules 85 + style-inventory 134；plugin-interaction-runtime-design SKILL 182 + interview-bank 264 + prototype-gate 82 + tool-design-rules 123 + workflow-design 170 + threat-model 145 + 模板 384；plugin-dev-planner 170；plugin-checker 212 + checklist 158；UI kit 两套（kits.md / kit.md / tokens.css / demo.html 结构）；scripts：validate-plugin-project.py 483、eval-skill-triggers.py 251、audit-ui.mjs 204 | 逐行（demo.html 读结构） |
| script-breakdown | agent.cordis.yml 94、三个 SKILL.md、references 4 份、模板 2 份 | 逐行 |
| 微信小程序 Cursor Rule | 410 行 | 逐行 |
| 业界一手源 | Anthropic `frontend-design/SKILL.md` 71 行原文；Vercel `web-interface-guidelines` AGENTS.md 155 + command.md 190；Spec Kit spec-template / plan-template / constitution-template / checklist-template + clarify 291 / checklist 379 / analyze 255 / specify 345 命令原文；Superpowers brainstorming（摘要）；MADR 模板全文；Google `design.md` docs/spec.md 377 + PHILOSOPHY.md 110 + README；awesome-design-md（Cursor 的 DESIGN.md 前 200 行）；BMAD v6.8 bmad-ux SKILL 89 + design-md-spec + key-screens + design-directions + color-themes + validate 115 + EXPERIENCE 范例 133、bmad-prd 94、bmad-spec 160、bmad-architecture 89 + spine 模板 + reviewer-gate、advanced-elicitation SKILL + 71 条方法库；UI/UX Pro Max SKILL 214 + quick-reference 256（119 条 UX 规则）+ pro-rules 117 + 88 种风格清单；Kiro specs 结构；Shape of AI 全部分类与模式；HITL 打断策略与审批面规则；ISO/IEC 25010:2023 九特性与 safety 五子特性；arc42 §10 质量场景；C4；华为 DFX 14 维口径；Claude Code 官方 SKILL.md 规范（description ≤1536 字符、正文建议 <500 行、渐进披露、`context: fork` 等） | 原文优先，取不到原文的用摘要并标注 |

## 2. 毒舌产品经理三代：演化里的教训

**3.0 → 4.0**：4.0 只是把 3.0 的单文件拆成 skill 目录、加了 feedback / evolution / implementer 子代理和设计 skill；需求 skill 主体几乎原样（`需求维度清单` 必须 / 尽量 / 可选 + `对话策略` + `信息充足度判断`）。两代共同的毛病：① 「AI 优先原则」写成主动推销——「这里要不要加个 AI 一键优化？」（3.0 SKILL:26-27、4.0 SKILL:21-24），正是我们 09-08 E 对照里旧版推销 OCR 的源头；② 布局在需求阶段问到「几栏、比例、控件」（4.0 SKILL:239），把设计决策前置进需求；③ 只有维度清单没有问法，敷衍答案挡不住；④ 没有范例。

**4.0 → 5.0**：真正的跃迁。
- 结构上按渐进披露拆：薄 SKILL（109 行）+ references 按需读 + 模板 + 970 行填充范例（`SKILL.md:16-28`、`101-106`）。这与 Claude Code 官方规范一致。
- `interview-principles.md` 把 Mom Test 写成五条铁律（谈他的生活不谈你的方案 / 问过去不问未来 / 一次一问 / 上下文无关开场 / 元问题收尾，`:22-27`），加「逼出具体四把刀」（锚定过去 / 要例子 / 要数字 / 二选一，`:29-35`）与 **LLM 访谈七种固定失效**（讨好 / 编造 / 过早收敛 / 从先验提问 / 捆绑提问 / 引导性问题 / 接受赞美当数据，`:37-45`）。
- `question-bank.md` 的**五段结构**（覆盖意图 / 主问题 / 追问深化「用户说 X → 你回 Y」/ 接受标准 / 不接受的答案，`:10-11`），定位是「反含糊的约束工具，不是顺序问卷」（`:6-8`），Phase 标签不暴露给用户。
- Phase 有地基门：问题与人 / Job 与成功 / 范围与非目标三相不过不解锁（`workflow-0-1.md:9-10`）；后面是旅程与功能（TASK / FLOW / REQ / 数据模型 / MUST-SHOULD 规则与输入校验）、AI 能力（先 litmus test 再概率性四问：质量条 / 触发方式 / 失败兜底 / 延迟成本，`question-bank:173-184`）、UI 五态一次一态（`:200-215`）、验收 GWT + 非功能六类给数字 + 假设与待确认（`:217-255`）、Agent 专项八问（自主性 / 工具 / 上下文 / 编排 / eval / 成本 / 失败 / 会话，`:257-353`）。
- **完成度判据**是全套里最值钱的一段：交接测试（没参与对话的工程师能不能直接开工）/ 边际测试（再问一个问题会不会改变要做什么）/ 不对称原则（缺了会返工的问到底，便宜能补的标待补充放行）/ 整体 80% 置信就停 / 收尾三件套（覆盖清单 + 元问题 + 读回摘要）（`workflow-0-1.md:52-59`）。
- 模板顶部的「0. AI 使用说明」是给下游 AI 的契约：MUST 优先 P0、MUST NOT 做范围外、按验收判完成、不明确用假设、判不了记待确认不自行扩展（`product-spec-template.md:15-21`）。范例里 `OUT-007` 把「调研未发现的能力记为未提供而非编造」写成范围条目（范例 `:90`），这是「不编造」落到文档形态的样子。
- 「AI 优先」在 5.0 仍是第一性原则（`SKILL.md:31`），但先 litmus（`:51`）再对照表、对照表锚点带日期（`:50`）——比 4.0 收敛，但仍会推销。我们 09-08 的「不推销、只在现状故事里出现人脑判断时才提」（我们 SKILL:68）更对。

**设计侧 5.0**：`形态先于视觉`（界面型 / 终端型 / 对话式 Agent / 嵌入式扩展可叠加，认错形态后面每问都错，`SKILL.md:29`）；`选择题优先 / 参考锚定 / 感受翻译表 / 给默认值让用户否决 / 不问像素`（`:30-34`）；Phase 顺序「先业务受众，最后才视觉——视觉方向是挣来的」（`:69`）；每轴二选一禁中间值（信息密度 / 色彩模式 / 温度 / 排版气质 / 个性 1-5 / 圆角 / 动效，`question-bank:136-156`）；先问现成品牌资产；终端 / Agent 形态换三条轴（渲染基元 / 色彩深度 / 列宽 degrade）；Agent 本体六问（交互骨架 / 呈现单元 / 运行态 / 透明度 / 授权 / 多 surface，`:183-253`）；工作台型页面「先标不可压缩的主任务区，别默认加第二侧栏」（`:276`）；模板 §A 给 Agent 形态、DASM / DQ 与 Spec 的 ASM / Q 同源（范例 `:1084-1110`）。

**5.0 的短板**：没有「使用情境与首要动作」（我们 bridge-B 加的）；没有 Google DESIGN.md 那样的机器可读 token 契约；没有对 AI 生成界面通病的校准；design-maker 只有 33 行，依赖 Pencil / Figma MCP。

## 3. 插件经理：一套完整的「采访 → 设计 → 计划 → 建 → 检」硬骨架

虽然它做的是 Claude Code / Codex 插件，前两个阶段的方法是通用的：
- **五级标注**（明确 / 推断 / 默认 / 待定 / 矛盾，`plugin-spec-builder/SKILL.md:57-64`、`interview-protocol.md:23-37`）——比我们的三标记多了「默认」（低风险、由框架定、用户只行使否决权）和「矛盾」（两条不能同时成立，必须摆出来）。
- **问题有成本**：只问会改变功能 / 宿主 / 交互 / 状态 / 权限 / 验收的问题；能推断的不问，能默认的不问，专业实现细节不推给用户（`:69-72`）。**问题预算**按复杂度 6-8 / 8-12 / ≤15，到 12 先做收敛审计（`:93-105`）。
- **能力激发 / 连带需求触发器**：用户说主动作，AI 只提当前最相关的 1-2 项连带能力并说代价（上传 → 类型 / 大小 / 进度 / 失败；画布 → 撤销 / 自动保存；生成 → 版本 / 取消 / 重试；长任务 → job / 重连 / 幂等；外部 API → secret / 域名 / 数据离开本机；破坏性 → 确认 / 预览 / 备份，`question-bank:384-405`、`dialogue-style:51-58`）。
- **回放公式**「我现在理解的是……这里还差一个会改变首版的决定……」与**反敷衍话术表**（都行 / 越多越好 / 像 Photoshop / 智能一点 / 实时 / 什么都支持 / 安全就行，`dialogue-style:19-49`），**用户面前禁用术语翻译表**（`:60-75`）。
- **形态判定的告知义务**：判定前用户必须已知情两种形态各适合什么，验收是「用户能用自己的话说出为什么选」（`workflow-0-1.md:98-103`）——这是「用户拍板」的正确形态：先教到能懂，再让选。
- **设计阶段三类决定分开**：User Decision（体验取舍，采访）/ Architect Decision（专业实现，自己定）/ Platform Fact（查官方，不让用户猜）（`plugin-interaction-runtime-design/SKILL.md:45-53`）；**UI 复杂度 A/B/C 与原型闸**（C 类画布 / 时间线 / 3D 必须先做可运行 spike，风险 = 技术不确定 × 流程关键度 × 晚发现成本，`prototype-gate.md`）；**七类场景走查**（首开 / 核心任务 / Agent 失败 / 并发与旧结果 / 关闭重开 / 权限文件网络失败 / fallback，`workflow-design.md:155-165`）；**八种界面状态**（空 / Loading / Agent 工作中 / 成功 / 错误 / 冲突 / 离线 / 无权限）。
- **威胁表**（THR-id / 资产 / 入口 / 威胁 / 影响 / 缓解 / 验证 / 关联 ID）与触发即必建模的九类能力（`threat-model.md:135-145`）。
- **机器校验**：`validate-plugin-project.py` 把文档当代码校——Status 必须 SPEC_READY、P0 Open Questions 必须 None、AC 必须存在、占位符扫描、形态三处一致（`:293-318`）；`eval-skill-triggers.py` 用无头 claude 跑正反例评测触发率；`audit-ui.mjs` 用 playwright 对产物做多主题 × 多宽度的溢出 / 折行 / 对比度 / 空白渲染审计并截图（`:56-128`）。
- **UI kit 的纪律**：颜色只给 Agent（蓝黑墨 / 极光），人类操作不许出现；语义靠形状不靠颜色；悬停不位移；动效快进快停；离线单文件不引 CDN；八态矩阵全用既有组件拼（`kits.md:11`、`ink-on-paper/kit.md:12-24`）。

它的局限：为插件这一种产品形态定制，术语重（MCP / Host Bridge），不能整体照搬；能搬的是方法骨架。

script-breakdown 与微信小程序规则价值不大：前者是三阶段流水线 + 汇报四要素 + 触发语料正反例（`trigger-corpus.md`）——正反例语料这一点和插件经理的 eval-skill-triggers 同源，值得记；后者是 2025 年的指令式 prompt（把「暗色 + 霓虹渐变 + 毛玻璃」写死成整体 UI 风格，`:187-214`），恰好是 Anthropic 五类通病的反面教材。

## 4. 业界一手源（2026-09 实查）

**Spec Kit（GitHub）**：`spec-template` 把用户故事按 P1/P2/P3 排优先级且每条**独立可测、单独实现也是可用 MVP**，每条带「为什么这个优先级」「独立测试法」「GWT 验收场景」；FR 用 `[NEEDS CLARIFICATION: …]` 标未定（`specify.md:122-129` 限最多 3 个，优先级 scope > 安全隐私 > 体验 > 技术）；成功判据 SC 必须**可度量且技术无关**（「用户 3 分钟完成结账」是好例，「API 200ms」是坏例，`specify.md:318-339`）。`clarify.md` 是最值得抄的一份：先按九类分类法做覆盖扫描（功能范围 / 领域数据 / 交互流 / 非功能 / 集成 / 边界失败 / 约束取舍 / 术语 / 完成信号 / 占位）标 Clear / Partial / Missing（`:73-127`），按 Impact × Uncertainty 排队**最多 5 问、一次一问**，每问必须是完整疑问句 + 一句「为什么要紧」+ **推荐选项置顶** + 选项表（`:140-169`），每个答案**当场**写进 `## Clarifications / ### Session 日期` 并同步改对应段、替换掉过时的矛盾句（`:182-198`），收尾给覆盖汇总表（Resolved / Deferred / Clear / Outstanding）。`checklist.md` 提出「**需求的单元测试**」：清单项只测需求写得好不好（完整 / 清晰 / 一致 / 可度量 / 覆盖），禁止「验证 / 测试 / 确认 + 行为」（`:9-28`、`:242-256`），≥80% 条目带可追溯引用。`analyze.md` 是只读的跨文档一致性分析（重复 / 模糊 / 欠规格 / 宪法冲突 / 覆盖缺口 / 术语漂移，最多 50 条，`:116-160`）。`constitution` 是项目原则文件，plan 里有「Constitution Check 闸」和「Complexity Tracking：越限 / 为什么需要 / 更简单的替代为什么不行」表——我们的 CLAUDE.md + Pinned + 恰如其分档位是同一件事。

**Kiro（AWS）**：requirements.md（用户故事 + EARS「WHEN … THE SYSTEM SHALL …」）/ design.md / tasks.md（`_Requirements: 1.1, 3.2_` 回链）三件套；2026 加了 Requirements-First / Design-First / Quick Spec 三种工作流与「Analyze Requirements」；社区一致的批评是「小改动也走全套太重」——我们的交互深度分档正是解法。

**BMAD v6.8**（5 月发布，GitHub 4.9 万星）：PRD skill 的顺序「Brain dump → 风险档位（hobby / internal / launch）→ 工作模式（Fast path 带 `[ASSUMPTION]` 标签 / Coaching path 分 Vision+Features 与 Journey-led 两个入口）→ 关注点扫描（开放清单）→ 形态 → **用户旅程是捕捉不是代笔，主角要有名字（"Mary, mom of three" 不是 "the user"）**」（`bmad-prd/SKILL.md:38-61`）；「引导而非指路：当你发现自己在挑 MVP 切法、提阶段划分——停，把笔还回去」（`:46`）；追加式 `.memlog.md` 决策日志，PRD 从日志蒸馏；「长度随风险档位缩放」；审查闸是并行子代理 lens、只回摘要。`bmad-spec` 的五字段内核（Why / Capabilities[intent+success] / Constraints / Non-goals / Success signal）与 **Spec 八法**（约束必须真能否掉什么、非目标至少一条、成功信号可测、能力 ID 稳定、精简）（`bmad-spec/SKILL.md:105-116`）；「**领域隐含要求没提就是缺口**：医疗不提 PHI、支付不提 PCI、控制系统不提 fail-safe，要点名不要替他答」（`:73`）。`bmad-ux` 改成**两脊柱**：DESIGN.md（Google 规范，管看起来怎样）+ EXPERIENCE.md（Foundation / IA / 语气 / 组件行为 / 状态 / 交互原语 / 无障碍地板 / 命名主角的关键流程带高潮一拍，管怎么运作）（`bmad-ux/SKILL.md:11-25`）；「只捕捉不代笔，绝不主动报颜色」（`:9`）；创意工具是三种离线 HTML：4-6 套色彩主题并排、3-6 个完整视觉方向的首屏样张、2-4 张承重页面 1:1 mock（`color-themes.md` / `design-directions.md` / `key-screens.md`）；**surface closure**：每个需求有一个页面承接、每个页面有一条旅程落到它（`:73`）；validate 八项（流程覆盖 / token 完整 / 组件覆盖 / 状态覆盖 / 视觉参照覆盖 / 臃肿 / 继承纪律 / 形态匹配，`validate.md:19-37`）。`bmad-architecture` 的**架构脊柱**：只固定「两个独立构建的单元会不会做出不兼容选择」的不变量，其余是种子（栈 / 树 / 数据形状，代码一出现就归代码）（`:9-13`）；每条 AD 带 Binds / Prevents / Rule，`[ADOPTED]` 标已定；Deferred 段是契约的另一半；「运行与部署包络整段沉默是失败」（`reviewer-gate.md:11`）；绿地推荐现行 starter（先联网核版本），棕地先读代码 ratify 既有约定（`:25`）；`lint_spine.py` 查占位 / 重复 ID / 缺 Binds-Prevents-Rule / 未钉版本。`bmad-advanced-elicitation` 71 条方法（Pre-mortem / Inversion / Assumption Audit / Stakeholder Lens Rotation / Steelmanning / Six Thinking Hats / Hindsight 20/20 / Boundary & Edge Case Sweep / Cascading Failure …）做成暂停点菜单，用户点才跑。

**Superpowers（obra）**：brainstorming 把请求分 spike / bounded / architectural 三档，一次一问，任何实现前硬闸；写完 spec 自查四项（占位 / 内部一致 / 范围 / 歧义）。writing-plans 的「按最坏执行者设防」我们已在 09-08 吸收。

**Anthropic 官方 frontend-design skill（71 行原文）**：以「工作室设计总监」身份从题材出发（`:9-13`）；排版承载人格、一到两个字族、行长 <80（`:19-23`）；**三条排版通病**（只强调标题里一个词 / 全大写标签 / 内容上方多余的标签，`:25-28`）；结构即信息，编号只给真序列（`:30`）；动效只留一处编排好的时刻，每段淡入上滑 + 每卡悬停过渡「读起来就是 AI 生成」（`:32`）；**五类 AI 生成界面聚簇**：奶油底 + 高对比衬线 + 陶土橙（#D97757 是 Anthropic 自家强调色，出现在用户项目里就是破绽）/ 近黑底 + 单一酸绿或朱红 / 报纸式发丝线零圆角密栏 / SaaS 卡片套件（一律圆角一律灰影一律渐变）/ 模板装饰（ALL-CAPS 眉标、中点串 A · B · C、「WORD — 片段」、#0B0B0B 冒充黑、等宽小标签、按钮尾巴 →）（`:38-45`）；**两遍法**：先出紧凑 token 计划（4-6 个具名色、字族角色、ASCII 线框与对齐、原则），再对照 brief 审一遍「这是不是给任何同类页面都会给的默认」，改了再写码（`:47-53`）；**把大胆花在一处**，其余安静，质量地板不宣告地做到（响应式 / 焦点可见 / 减动效 / 无障碍 / 色彩和谐），截图自评（`:59`）；文案：主动语态、按钮说清结果、同一动作全程同名、错误不道歉不含糊、空态是行动邀请（`:63-71`）。姊妹 skill `web-artifacts-builder` 一句话版：避免过度居中、紫色渐变、一律圆角、Inter 字体。

**Vercel Web Interface Guidelines**（2026-01 起可装成 agent 命令）：AGENTS.md 155 行 MUST / SHOULD / NEVER，覆盖键盘与焦点、命中区 ≥24px / 移动 ≥44px、表单（不阻止粘贴、Enter 提交、错误就地、警告未保存）、URL 反映状态、乐观更新与撤销、触控拖拽、动效只动 transform/opacity 且尊重 reduced-motion、布局安全区、内容与无障碍（不只靠颜色、tabular-nums、`…` 不是 `...`）、长内容截断、性能（>50 条虚拟化、CLS）、深色模式、设计（分层阴影、嵌套圆角子 ≤ 父、APCA 对比）；`command.md` 定义审计输出 `file:line - 问题` 的极简格式。这是「界面质量地板」的现成机器口径。

**Google DESIGN.md**（2026-04 开源，`google-labs-code/design.md`，`npx @google/design.md lint` 校验 token 引用与 WCAG 对比）：YAML 前言放 token（colors / typography / rounded / spacing / components，`{path.to.token}` 引用，兼容 DTCG），正文 8 段**顺序锁定**（Overview / Colors / Typography / Layout / Elevation & Depth / Shapes / Components / Do's and Don'ts）（`docs/spec.md:100-114`）；哲学：**一个具体的参照胜过一堆形容词**（「1970 年代老牌大学的研究生讲义」自带一整套约束，「现代、干净、可信、高级」什么都不是）、**否定约束随具体参照免费而来**、**prose 才是主体，token 是上下文不是渲染指令**（`PHILOSOPHY.md:17-58`）。awesome-design-md 收了 70 多个真实品牌的 DESIGN.md（Cursor 那份 `description` 一段就把「暖奶油编辑画布 + 单一 Cursor 橙 + 只在时间线用的柔和多色 + 无阴影发丝线 + 80px 段落节奏」说清了）。

**UI/UX Pro Max**：88 种风格（Liquid Glass / Material 3 Expressive / Bento / 玻璃拟态 / 克莱 / 新野兽派 / 极光 / 数据密集仪表盘 / E-ink 纸感 / OLED 深色 / 终端 CLI …）、192 种产品类型配色、74 组字体配对、119 条 UX 规则、三个「设计拨盘」（variance / motion / density 1-10）、MASTER.md + 页面覆盖；pro-rules 给出「不专业」的常见根因清单（emoji 当图标 / 图标线宽混用 / 按压位移 / 深色对比不单测 / 安全区）与交付前清单。它证明「风格词汇 + 产品类型匹配 + 反模式」可以做成可检索的数据。

**Shape of AI**：AI 产品交互模式六类（Wayfinders 起手 / Inputs 动作 / Tuners 调参 / Governors 人在回路 / Trust Builders 信任 / Identifiers 身份），其中 Governors 的 Action plan / Controls / Verification / Stream of Thought / Cost estimates 就是 5.0 §A 的「运行态 / 透明度 / 授权」。HITL 文献收敛的打断策略：不可逆性 / 影响范围 / 置信度 / 成本四判据；审批面要「看 diff 不看结果、能改再批、能批量、只在 publish / send / spend 设闸、先提案后提交」。

**ISO/IEC 25010:2023**：九特性（功能适合 / 性能效率 / 兼容 / **交互能力**（原 usability，加 inclusivity、self-descriptiveness、user engagement）/ 可靠（faultlessness）/ 安全（加 resistance）/ 可维护 / **灵活性**（原 portability，加 scalability）/ **safety**：operational constraint / risk identification / fail safe / hazard warning / safe integration）。arc42 §10 质量树 + 使用 / 变更 / 故障三类场景，短式（背景 / 刺激 / 度量）与长式（SEI 六要素）两种写法；C4 上下文 / 容器 / 组件 + 动态 / 部署图；MADR：背景与问题 / 决策驱动 / 候选 / 结论（because）/ 后果好坏 / **Confirmation（怎么确认合规，含自动 fitness）** / 各候选优劣。华为 DFX 14 维（可靠性 / 节能减排 / 归一化 / 可服务性 / 可安装性 / 可制造性 / 可维修性 / 可采购性 / 可供应性 / 可测试性 / 可修改性与可扩展性 / 成本 / 性能 / 安全性）、「DFX 不产生设计方案，它评价设计并为决策提供依据」、落地三阶段（概念筛选 / 设计协同 / 验证量化）。

**Claude Code 官方 skill 规范**：`description`（含 `when_to_use`）合计 ≤1536 字符；正文建议 <500 行、长参考拆支持文件按需读（我们 skills-lint 的 180 字符预算和「当…时」触发形是更严的子集，保留）。

## 5. 对照我们现状

| 阶段 | 我们的亮点（保留） | 缺口 | 硬伤 |
|---|---|---|---|
| 需求 product-spec-builder（138 行 + 模板 141 + changelog 80） | 向人学业务四条线；`[确认]/[推断]/[待定]` 带来源；澄清记录不重问；交互深度分档（直推 / 确认 / 探索 / 委托）；案例复述替代批准仪式；决策依据表；下游反例回流；对话示例与反例 | 无 references（访谈原理 / 问题库 / 工作流）与范例；无覆盖扫描与问题预算，每问无推荐；无「默认」与「矛盾」两级；成功判据不可度量；无未来态关键流程（命名主角 + 失败路径）；无需求单元测试式自查；AI / Agent 能力四问与专项丢了；无行业隐含合规扫描；无机器闸 | 模板与 `spec-lint` 矛盾（§0） |
| 界面 design-brief-builder（27 行 + 4.0 模板 176） | 「任务与环境优先」（使用情境 + 首要动作）是独家对的起点 | 几乎全部：问题库、形态分轨、Agent 轨、SCREEN / CMP 编号、六 / 八态、组件规格、token、a11y、响应式、假设待确认、范例；无 DESIGN.md 机器契约；无 AI 通病校准；无质量地板 | **文件截断不可用** |
| 设计稿 design-maker（133 行，odc 驱动） | 单文件离线 HTML 一份两用；odc 142 套 design system；假成功识别（exitCode）；验收判据客观 | 无两遍法；无方向样张让用户先选；不消费 token；无八态覆盖要求；无 DOM 级审计（溢出 / 对比度 / 空白）；无 AI 通病自检；无质量地板 | — |
| 架构 arch-designer（129 + 模板 70） | 七大原则推演 + 自检；规模分级；ADR 执法方式被 adr-check 机器校验；catalog 骨架；故障后果与团队能力先问 | 无不变量测试与 Deferred；无一致性约定表；运行与部署包络可沉默；无 C4 图；ADR 无决策驱动 / 候选优劣 / 后果；无术语表 / 风险与技术债；无越档理由表 | — |
| DFX dfx-designer（100 + 模板 53） | 12 维 = 华为口径软件投影 + 韧性 / 隐私 / 功能安全；六要素场景；档位经济学；验证闭环接 harness；评审模式 | 无 25010:2023 映射（safety 五子特性、交互能力、灵活性）；无隐含合规扫描；无威胁表；AI 产品的自主性 / 审批 / 熔断没有落点；S 档无短式场景 | — |

## 6. 改造设计

**总原则**：保留复用 + 增量补缺；改动风格贴合原文；每个对话型 skill 必有对话示例 / 反例 / 收敛 / 交接（skill-builder 规范）；references 按需读、SKILL.md 不超 500 行；机器闸随文档口径同批更新，且每条新闸带反向验证。

### 6.1 需求
- SKILL.md 重写为「地基 + 方法索引」：四条底线（四种话分开写 `[确认]/[推断]/[默认]/[待定]` + 矛盾单列；问过的不再问；问题有成本——只问会改变要做什么的问题、每问带推荐；引导不指路——不推销、不替用户挑 MVP 切法）；分档加问题预算（探索档按风险档位 6-8 / 8-12 / ≤15，到 12 收敛审计）；覆盖扫描（十类）；复述前先跑「需求单元测试」；高风险可点菜「深挖方法」（≤2 种）。来源：5.0 / Spec Kit clarify+checklist / 插件经理 / BMAD。
- 新增 `references/interview-principles.md`（五铁律 / 四把刀 / 七种失效 / 回放公式 / 反敷衍表 / 禁用术语翻译 / 提问工具边界）、`references/question-bank.md`（五段结构，13 个维度，含 AI 能力与 Agent 专项两个条件模块、连带需求触发器、隐含合规扫描）、`references/workflow-0-1.md`、`references/workflow-iteration.md`（变更分类 + 影响矩阵 + 阶段回退）、`references/spec-self-review.md`（需求单元测试清单）、`references/elicitation-menu.md`（10 种深挖方法）。
- 模板：段名回到 spec-lint 认的四个必需段（「应用场景：工作现状故事」）；新增成功判据（可度量、技术无关、带反向指标）、关键流程（命名主角 + 高潮 + 失败路径）、失败路径与恢复、非功能与隐含合规（指向 DFX）、AI 能力（条件段）；待定只许住在「待定问题」表（问题 / 影响 / 谁能答 / 押后到 / 不答先按什么做）；功能条目不许挂 `[待定]`，写成 `[默认]` 做法 + 表里一行。
- 范例：`examples/after-sales-dispatch.md`（售后工单派单，与 09-08 示例同一产品，全标记齐）。
- 机器闸：`spec-lint` 改「`待定` 只在『待定问题』段的完整表行里合法」（引擎 `lib/spec.mjs`，红锁先行）；新脚本 `scripts/predev-lint.mjs` 统一跑四份前期文档的结构与占位检查，接进签字闸。

### 6.2 界面
- 重建 design-brief-builder：SKILL + references（question-bank 六 Phase 分轨、workflow 两份、`style-vocabulary.md` 风格词汇与感受翻译与参考锚点对与 2026 趋势与 AI 通病清单、`ui-quality-floor.md` Vercel 规则中文口径、`agent-ux-patterns.md` Shape of AI + HITL + 5.0 §A）+ 两份模板（`design-brief-template.md` 行为脊柱；`design-md-template.md` Google 规范）+ 范例一对。
- 产物变成两份：`Design-Brief.md`（怎么运作 + 设计方向 + SCREEN / CMP）与 `DESIGN.md`（怎么看，token + 8 段 prose，可被 Stitch / Claude Code / Cursor / odc 直接消费，可 `npx @google/design.md lint`）。文件名不改动既有下游，DESIGN.md 是增量。
- design-maker：加两遍法（token 计划 → 对照 brief 查「默认」→ 生成）、方向样张（3 个首屏方向先选）、DESIGN.md token 进 prompt、八态覆盖、`scripts/ui-audit.mjs`（多主题 × 多宽度 DOM 审计 + 截图 + AI 通病提示）进验收、质量地板进 prompt 尾。
- dev-builder / code-review 的设计参照顺序补 DESIGN.md，UI 一致性审查引用 `ui-quality-floor.md`。

### 6.3 架构
- 第一性原则加「不变量测试」与「Deferred 是契约的另一半」；维度清单加一致性约定表、运行与部署包络（三态无空白）、C4 上下文 + 容器图与关键场景动态图（mermaid）、术语表、风险与技术债、越档理由表；ADR 改 MADR 形态（背景与问题 / 决策驱动 / 候选与优劣 / 结论 / 后果 / 执法方式）——「执法方式」字段与 adr-check 的 token 规则原样保留；推演策略加 Coaching / Fast 两路、绿地 starter、棕地 ratify。模板同步。

### 6.4 DFX
- 加 ISO/IEC 25010:2023 映射表（含 safety 五子特性、交互能力指向 Design-Brief 无障碍地板、灵活性 / 可伸缩）；第 13 维「能效」（华为节能减排的软件投影，可 N/A）；启动阶段加「行业隐含合规扫描」；安全维加威胁表（触发条件九类）；AI 产品加自主性分级 / 审批门 / 熔断 / 成本上限行；S 档允许短式场景。模板同步。

### 6.5 不采纳的（记下理由）
- 5.0 的「AI 优先」第一性原则与 AI 能力对照表——推销倾向，且模型锚点月月过期；保留 litmus + 四问 + 护栏作为条件模块。
- BMAD 的 `.memlog.md` 独立日志、`uv` 脚本链、Fast/Coaching 全套仪式——我们已有澄清记录 + progress.md Decisions + 交互深度分档，再加一层记录会重复。
- 插件经理的 phase / qualityGate 状态机与 plugin.yaml IR——为插件宿主定制，我们用文件存在性路由已够。
- UI/UX Pro Max 的 88 风格 CSV 数据库——不分发数据，只抽风格词汇表与反模式进 references；odc 已带 142 套 design system。
- 微信小程序规则——反面教材。
- Spec Kit 的 `[NEEDS CLARIFICATION]` 写进功能条目——与我们「功能条目不挂待定」冲突，改为默认做法 + 待定表。

## 7. 分批与验收

批次：① 报告 + 需求 skill 全套 → ② 界面两 skill 全套 → ③ 架构 / DFX 增量 → ④ 脚本与引擎（红锁先行：test-predev-lint / spec.mjs 待定规则 / ui-audit 参数契约）→ ⑤ 规则、主控、文件结构、下游引用、manifest → ⑥ 全量自测（selftest / golden / test-routing / skills-lint / 新测试）。

验收判据：`skills-lint` 零发现；`test-routing` 双向登记一致；`selftest` 与 `harness-golden --check --strict` 零差异；`predev-lint` 对五份范例（Spec / Brief / DESIGN / 架构 / DFX）拼成的 root 全过、对坏夹具全红；范例 Spec 过 `spec-lint`；FRAMEWORK-MANIFEST 重生成；分支推送待用户审阅合并。


## 8. 落地记录（2026-09-10，分支 feat/predev-upgrade）

对照第 6、7 节的设计与验收判据，实际落下的东西：

**四个前期 skill**
- product-spec-builder：SKILL.md 重写（向人学业务四条线、交互深度分档与问题预算、覆盖扫描、复述理解签字、收敛条件跑 spec-lint + predev-lint）；references 五份（采访原则 / 问题库十三维 / 0→1 与迭代工作流 / 需求自审 / 引出方法菜单）；模板改为四标记（确认 / 推断 / 默认 / 待定）+ 成功判据 + 关键流程 + 决策依据 + 五格待定表；changelog 模板加「分类与回退」；范例 after-sales-dispatch.md。
- design-brief-builder：从 27 行残件重建，两份产物 Design-Brief.md（体验脊柱）+ DESIGN.md（Google design.md 规范 token）；references 六份（问题库 / 两条工作流 / 风格词汇表与 AI 通病 / 质量地板 / Agent 交互模式）；两份模板、两份范例。
- design-maker：odc 管线保留，加方向样张、两遍法、token 进 prompt、八态覆盖、ui-audit 验收与 AI 通病自检。
- arch-designer：不变量测试、包络三态、一致性约定、C4 与时序图、MADR 形态 ADR（执法方式 token 保留）、押后决定、越档理由、术语表、风险与技术债；模板 16 段；范例。
- dfx-designer：13 维（新增能效）、ISO/IEC 25010:2023 映射表（含功能安全五子特性）、隐含合规扫描表、九类触发的威胁表、AI 产品附加行、S 档短式；模板同步；范例。

**机器闸**
- `scripts/predev-lint.mjs`：前期五份文档的静态闸（存在性检查、缺哪份跳哪份）——Spec 必需段 / 来源标记 / 待定表五格 / 成功判据非空；Brief 的 SCREEN 编号、必需状态与响应式、悬空引用；DESIGN.md 前言、记号可解析、八段顺序、重复段；架构五必需段与 ADR 四标签；DFX 优先级栈 ≥2 项、总表度量列按表头定位。占位规则与 spec-lint 同口径：尖括号只在像占位时报，待定问题段只豁免「待定」二字与表行规则，段名先精确后包含。
- `harness/lib/spec.mjs`：待定问题段规则（表行五格齐、段内只豁免「待定」）、段名归一化、比较式放过、转义管道。
- `scripts/ui-audit.mjs`：设计稿目录或 URL 多主题 × 多宽度真渲染，溢出 / 折行 / 对比度 / 空白判红，套话味 advisory，截图与 JSON 落盘；引擎缺席退 3 并说明原因、不留旧证据；静态服务防路径穿越与软链逃逸。
- 接线：Spec 签字前跑 spec-lint + predev-lint；设计阶段收敛跑 predev-lint；design-maker 验收跑 ui-audit --strict；dev-builder / code-review / dev-planner 参照顺序改为 设计稿 → DESIGN.md → Design-Brief → Spec 并引用质量地板；doctor 登记两脚本；run-all 挂两套测试并把「跳过」退 3 记为注记。

**闸的证据（四轮红锁 → 修绿 → 复审）**
- tester 十一批共 66 条 predev 用例（含五份范例 dogfood、五份模板原样必红且槽一个不漏、模板原句夹具、七种编号写法两闸对拍、围栏按用途扫槽与若干防回归位）、25 条 ui-audit 用例（U5 真渲染无引擎时 SKIPPED，套件退 3）、selftest 由 292 条增至 308 条；每批红锁都做了对照组（夹具改合规全绿、候选修复全绿、变异体恰红）。
- 十轮 fresh code-reviewer 对抗审查共抓出四十余条实缺陷（第十轮 PASS，只剩三条记为残留的 Low）（整段免检旁路、诱饵段抢锚点、比较式假红、带空格占位绕过、GFM 对齐分隔行不识别、缺席留旧证据、路径穿越与软链、度量列错位、两闸口径相反等），全部先红锁后修绿；一条撤回（针对已改掉的旧模板）。
- golden 基线按 lane 308 重录，严格对照 8361 条一致。

**没做、记着的**
- U5 真渲染路径本机无 playwright 零证据，只能靠有引擎的机器或 CI 补；predev-lint 494 行超 300 行门槛，拆分会破坏零依赖单文件口径，暂不拆。
- skills-lint「正文行数骤降」提醒（防再出现 27 行残件）是 v2.0.x 议题。
