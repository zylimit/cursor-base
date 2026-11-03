# design-maker 回向适配来源表（2026-09-22）

依据：`codex-base` 分支 `improve/predev-synthesis-20260922` @ `d1a3287`（只读克隆路径见派单）；T4 判据见 `docs/predev-skills-diff-20260922.md` 第 5 节「design-maker」；来源标注对照 `docs/predev-synthesis-20260922.md` 对应节。本仓 design-maker 是 odc / Claude agent 出设计稿的工具链，T4 判「适配」的行（工具、daemon、第三方站点、提示词模式、自动 commit）是宿主差异，不搬——本表只搬 T4 判「C」领先的**方法**，不动工具链；本表只记录本仓 `.claude/skills/design-maker/SKILL.md` 的章节级来源，不代表已获授权修改本仓其它 Skill。

| 本仓原章节 | 适配后章节 | 来源（K 本仓 / C codex-base / 合并） | 一句理由 |
|---|---|---|---|
| [任务] | [任务] | K | T4 判「适配」：Codex 直接编辑仓库自包含 HTML 是宿主差异；本仓 odc/Claude agent 工具链不动，正文未改。 |
| [工具安装] | [工具安装] | K | T4 判「适配」：Codex 无需 daemon/第三方站点是宿主差异；本仓 odc 安装说明不动，正文未改。 |
| [依赖检测] | [依赖检测] | K | T4 判「适配」：odc 分路检测 vs Codex 直接编辑，工具链差异不搬；正文未改。 |
| （新增） | [文件结构] | C | T4 判「单边 C」：把构建原型与任务试走各自放进按需参考，执行时能直接找到判断方法；本仓原无此节，新开，登记 `references/prototype-construction.md`、`references/task-walkthrough.md` 两个新文件。 |
| [第一性原则] | [第一性原则] | 合并 | K 七条原则（完整覆盖 / 状态完备 / 文档驱动 / 两遍法 / 真实内容 / 质量地板 / 离线自包含）一字不动；新增「原型边界原则」，搬自 codex-base `[第一性原则]` 状态完备条款的「结果未知」与 `[交付物]` 的模拟边界 / 重置路径 / 数据保留条款，合成一条原则，方法判据未改写。 |
| [设计交付物] | [设计交付物] | 合并 | K 五项产物清单不动；`demo/index.html` 条目追加「标注模拟边界、保存位置、可重置演示入口」，收尾句追加「原型边界」到必须满足清单，搬自 codex-base `[交付物]` 对应条款。 |
| （新增） | [从关键屏落到完整原型] | C | T4 判「C」领先：从关键屏内容到 token、组件、状态、页面逐层展开并实际渲染，比本仓「视觉方向→design system 映射」更细化构造顺序。codex-base `[从关键屏落到完整原型]` 四个子方法（先解决可见问题 / 按关键屏→token→组件→状态→页面展开 / 动作说结果与恢复 / 内容键盘焦点一起工作）整节搬入，判据与顺序未改写，只把「由 Codex 直接编辑」类表述去掉，指回本仓 [验收]/[Phase 1：准备]。详细方法搬进新文件 `references/prototype-construction.md`。 |
| （新增） | [任务试走方法] | C | T4 判「单边 C」：参与者带目的试走、观察是否理解结果与恢复，比字符串 grep 更能识别「按钮能点但任务做不完」。codex-base `[任务试走方法]` 整节搬入（准备可判断的情境 / 观察理解和恢复 / 把发现回到正确来源），判据未改写；并入 [Phase 2：生成] 的 [验收]，与 ui-audit 并列（ui-audit 渲染审计，任务试走任务审计）。详细方法搬进新文件 `references/task-walkthrough.md`。 |
| [视觉方向 → design system 映射] | [视觉方向 → design system 映射] | K | T4 判「K 领先」的三方向样张、AI 通病自审已在本仓两遍法与本节覆盖，未改动。 |
| [Phase 1：准备] | [Phase 1：准备] | 合并 | K 原步骤 1-6 与两遍法第一 / 二遍、构建 prompt、展示计划步骤全部保留（重编号为 8-11，内容不变，仅序号后移）；新增步骤 7「划覆盖矩阵（页面 × 状态 × 任务 → 交互 → 验收锚点）+ 已有方向不再重复确认（跳过 2A）」，搬自 codex-base `[Phase 1：规划]` 对应判据。 |
| [Phase 2：生成（odc 为主，AI Studio 兜底）] | [Phase 2：生成（odc 为主，AI Studio 兜底）] | 合并 | K 的 2A/2B/2C 三条路与轮询、exitCode 核验判据一字不动；Phase 2 开头追加一句「方向已拍板时跳过 2A」（搬自 codex-base Phase 1 规划里的同一判据，呼应新增步骤 7）；[验收] 清单里「离线自包含」补强字符串检查是必要不充分的第一遍（搬自 codex-base `[Phase 2/3]`「不把简单 URL 字符串检查当资源加载证明」）、「质量地板抽查」补「浏览器不可用时明确写未验证」（搬自 codex-base 同节「不可预览的明确写未验证」）、新增「模拟边界属实」「任务试走」两项客观判据（分别搬自 codex-base `[交付物]` 与 `[任务试走方法]`）。其余判据（完整无截断 / 页面覆盖 / 八态覆盖 / token 一致 / UI 审计 / AI 通病自检 / 体积仅参考）未改。 |
| [Phase 3：交付] | [Phase 3：交付] | 合并 | K 的 [落地] 拷贝步骤保留；把自动 `git add && git commit` 改成「提交交由用户或主 Agent 决定何时提交，本 Skill 不自动 commit」，搬自 codex-base `[Phase 3：验收与交付]` 收尾「版本控制与发布是独立授权动作，本 Skill 不执行」。完成报告文本结构不变，追加「未验证」字段与「模拟边界属实 / 任务试走」验收结果行，搬自 codex-base `[回执]` 的方法部分（交回实际产物、证据与未测项），字段名按本仓「完成报告」话术风格改写，未采用 codex-base 的 `Status: DONE\|...` 信封格式（本仓 design-maker 不是 Sub-Agent 回执，不套用派单回执信封）。 |
| [提示词模式] | [提示词模式] | K | T4 明确「K 的提示词模式在本仓不是产物完成」（codex 侧判断的语境说明，不是要搬的方法）；本仓无 odc 时的降级路径属工具链差异不动，仅同步 Phase 1 步骤重编号后的引用（1-9→1-11、第 9/10 步→第 10/11 步、新增对第 7 步「跳过 2A」条款在提示词模式下不适用的说明）。 |
| [初始化] | [初始化] | K | 未改动。 |

## 新增 references（单边 C，整文件搬入）

| 新增文件 | 来源 | 一句理由 |
|---|---|---|
| `references/prototype-construction.md` | C | codex-base 同名文件整篇搬入，文件头加声明「codex-base `d1a3287` 教学材料；预约例是虚构案例，其中数字、命令、路径不自动成为本项目要求」。唯一改动：第 6 节「按当前未知和 controls 执行对应检查」的 `controls` 换成本仓「验收要求」（[验收] 判据由 SKILL.md 定义，不套 Codex 的 controls 概念）；第 6 节「先使用当前可用且获授权的浏览器/预览工具」补一句指向本仓 `node .claude/scripts/ui-audit.mjs`；方法正文（关键屏选取、token/组件/状态展开、动作契约六列表、异步与编辑冲突处理、页面与导航扩展、渲染核对七项检查表、预约例状态表、方法来源）未改写。第 7 节链接 `../../product-spec-builder/references/reservation-case.md` 指向同批并行适配 product-spec-builder 会新增的文件，路径结构与本仓一致，未改。 |
| `references/task-walkthrough.md` | C | codex-base 同名文件整篇搬入，文件头加同一声明。唯一改动：「如何记录结果」一节「在现有设计说明或交接中简短记录」改成「在 `demo/design-plan.md` 或交接说明中简短记录」，点名本仓落盘路径（工具名/路径适配，判据未变）。其余方法正文（先给目的再观察路线、结果未知不能伪装、发现怎样传下去、观察点证据表）未改写。 |

判「K」领先的行（三方向样张、AI 通病自审、完整页面/八态、token 集中、离线单文件、ui-audit、反默认审查细则）本仓已有，未动。Codex 的 `[Assurance]` 与 resolver/controls/catalog/Assurance 概念未搬，`grep -rn "\.agents\|\.codex\|resolver\|controls\|catalog\|Assurance" .claude/skills/design-maker/` 为空。

## 拿不准的合并决定

- 「已有方向不再走提示词替代流程」这条 codex-base 判据，本仓落点选在 [Phase 1：准备] 新增步骤 7 + [Phase 2：生成] 开头一句提示（跳过 2A 方向样张，直接用选定方向进 2B）。codex-base 原文语境是它自己「不重复走提示词确认」的流程，本仓没有对应的提示词确认环节，是按方法意图（已授权的方向不重复确认）做的等价落点，不是逐字对应；如果理解偏了，应该改成更明确的独立小节。
- codex-base `[回执]` 是给主 Agent 的结构化信封（`Status: DONE|...`），本仓 design-maker 不经 Sub-Agent 派发（不在 implementer/code-reviewer/tester/deployer 调度表里），没有对应的回执信封；改成把「交回实际产物、证据与未测项」的方法精神揉进已有的「完成报告」话术（新增未验证 / 模拟边界 / 任务试走字段），没有照搬 codex-base 的信封格式。如果主 Agent 认为 design-maker 也该有独立 [回执] 信封（例如未来接入 Sub-Agent 调度），需要另开一节，这次没加。
- [Phase 1：准备] 步骤 7-11 是重新编号（原 7-10），[提示词模式] 里三处数字引用（1-9→1-11、第 9 步→第 10 步、第 10 步→第 11 步）已同步改写；这是本次编辑产生的衔接改动，不在 codex-base 原文里，纯粹是保持本仓内部步骤引用一致，供复核时留意这几处数字改动的原因。
- 「模拟边界属实」验收项要求核对产物「声明的模拟行为与实际代码行为一致」，但本仓现有 [验收] 都是可脚本化的客观判据（grep/UI 审计），这一项目前只能人工读代码核对，没有配套脚本；先按人工判据写入，是否要配一个静态检查脚本（例如扫「模拟」「demo-only」标注是否覆盖了所有会改变数据的按钮）留给主 Agent 判断，这次没有新增脚本（超出「只改 .claude/skills/design-maker/ 与来源表」的约束范围）。

## 第二轮修正（2026-09-22，Codex 审 + 线 4 对等）

- **HIGH M1（已定方向的新增跳过路径缺项目创建步骤）**：[Phase 2：生成] 新增 [共同入口：建项目取 ID] 子节，把唯一的 `odc project create` 与 `.project.id` 获取从 [2A] 第 1 步移到 2A/2B 共同入口，2A、2B 之后统一引用同一个 `<projectId>`；[2A] 收窄为「可选，先选方向再出全稿」并注明跳过条件见 [共同入口]；[2B] 第 1 步改为按是否走过 2A 分两种 prompt 构造方式——走过 2A 用「按用户选定的方向 N」，跳过 2A（方向已由 DESIGN.md / 用户授权拍板）时不写方向 N，直接按既定方向构造完整 prompt（既定方向已经写在 design-prompt.md 正文里，不需要编号可指）。依据：Codex 侧审查 M1——[Phase 1：准备] 第 7 步与 [Phase 2] 开头都写了「已定方向跳过 2A、项目建好直接进 2B」，但项目创建与 ID 获取唯一入口在 [2A]，方向已拍板跳过 2A 时既没有 projectId 也没有可引用的「方向 N」，2B 的生成命令实际执行不了；这是接线漏了公共前置，不是 C 的「已定方向不重选」方法本身有问题，按 Codex 给的修法把建项目步骤挪到公共入口解决。[提示词模式] 引用的 Phase 1 步骤号未变（只重排了 Phase 2 内部子节，未动 Phase 1 编号），第 206 行「第 7 步『已拍板则跳过 2A』」的引用仍准确，未同步改动。
- **Medium M2（离线验收与交付声明矛盾）**：[Phase 3：交付] 完成报告「产物」行的「demo/index.html（N KB，可交互、离线）」改为「demo/index.html（N KB，可交互，单文件自包含；[离线自包含已核实 / 是否发出外部网络请求未验证，见下方「未验证」]）」，把「离线」从无条件断言改成按 [验收] 里「离线自包含」那条的真实检查结果二选一；本仓当前 ui-audit 不监听网络请求，字符串检查只是必要不充分的第一遍，因此这一项默认落在「未验证」分支，与完成报告下方「未验证」字段（已由 [验收] 逐条产生）保持一致，不再一边写「离线」一边在未验证里承认没查。[提示词模式] 的交付话术本来就没有「离线」断言，未改动。


## 2026-09-23 Matt Skills 整改同步

依据：`codex-base` `git diff 3e199f6 407c3bc -- .agents/skills`（计划 `docs/research/20260918-matt-skills-learning-plan.md`，行为对照在 `docs/research/20260918-matt-skills-study/`）。上游 `mattpocock/skills@74ca5fe`（MIT），处理方式 synthesized：只取方法，不搬 Codex 运行时概念。来源列 C = codex-base `407c3bc`，括号内为对应批次。

| 本仓章节 | 变更 | 来源（C = codex-base 407c3bc，对应批次 L1–L6；上游 mattpocock/skills@74ca5fe，MIT，synthesized） | 一句理由 |
|---|---|---|---|
| frontmatter description | 追加：用户要用离线逻辑沙盘检验一个明确的业务状态或规则问题时也使用，这时可在 Design Brief 之前做 | C（L2） | C 同步改了 description；本仓保留原触发句不动，只在其后追加，skills-lint 预算内。 |
| [任务] | 追加一行：只需回答一个明确状态 / 规则问题时走 [逻辑沙盘入口]，不必先定视觉方向，不走 odc 与三阶段 | C（L2） | C 改写了整段 [任务]；本仓的 odc 工具链与三阶段不动，只加入口一句。 |
| [依赖检测] | 末尾追加一行：必需项与分路只管完整设计稿，沙盘只要 Spec 或会话里已确认的规则片段足以说清问题，不要求 Design-Brief / DESIGN.md、不查 odc | C（L2） | 对应 C「完整 UI 稿再提取视觉约束」的收窄；不改原有必需项措辞。 |
| [文件结构] | 登记 references/logic-prototype.md | C（L2） | 同 C 的文件树改动。 |
| （新增） | [逻辑沙盘入口]（位于 [任务试走方法] 之后） | C（L2） | 合并 C 的 [选择入口] 与 [按需参考] 首行、以及散在 [第一性原则] / [交付物] / Phase / [验收] 里的「完整 UI 稿 vs 沙盘」分流：本仓 Phase 与验收高度绑定 odc，逐条插入限定语改动面太大，改为一节集中写何时走、怎么做、照样要守的原则与验收项、交付与回填。 |
| references/logic-prototype.md | 新增 | C（L2） | 正文照搬；「ignored state 或 `/tmp`」「owned paths 与沙箱许可」改为默认 `demo/logic-<问题简名>.html`、不覆盖全稿 `demo/index.html`；「按主 Skill 检查」指到本仓 SKILL.md [第一性原则] 的离线自包含与质量地板；文件头照同目录两份参考加教学材料声明。 |

改动的现有句子：仅 frontmatter description（在原句后追加，原句保留）。未搬：C 在 [第一性原则]、[交付物]、[Phase 1] / [Phase 2] 与 [验收] 各条前加「完整 UI 稿」限定语——本仓这些段落本身就是 odc 全稿流程，沙盘不走它们，由 [逻辑沙盘入口] 一处写明哪些照守、哪些不走。CLAUDE.md [Skill 调用规则] 里 /design-maker 的前置仍写「Product-Spec.md + Design-Brief.md」，沙盘不要求 Design-Brief；同批已由主 Agent 在 CLAUDE.md 与 rules/dev-workflow-details.md 补注「只做逻辑沙盘时有 Product-Spec.md 或会话里已确认的规则片段即可」。审查后另补两处：沙盘的 ui-audit 须另放目录命名为 index.html 再跑（本仓 ui-audit 只收目录、只开 index.html）；[文件结构] 的 SKILL.md 注释登记沙盘入口。
