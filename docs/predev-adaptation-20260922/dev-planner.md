# dev-planner 回向适配来源表（2026-09-22）

依据：`codex-base` 分支 `improve/predev-synthesis-20260922` @ `d1a3287`（只读克隆路径见派单）；T4 判据见 `docs/predev-skills-diff-20260922.md` 第 6 节「dev-planner」；来源标注对照 `docs/predev-synthesis-20260922.md` 对应节。本表只记录本仓 `.claude/skills/dev-planner/SKILL.md` 与 `templates/dev-plan-template.md` 的章节级来源，不代表已获授权修改本仓其它 Skill。

Codex 的 resolver 六输入 / `harness.mjs plan lint` / `[Assurance]` 是它的运行时概念，本次不搬；`[Assurance]` 节本身不落地到本仓。

| 本仓原章节 | 适配后章节 | 来源（K 本仓 / C codex-base / 合并） | 一句理由 |
|---|---|---|---|
| [任务] | [任务] | 合并 | K 的生成模式 / 迭代模式框架与"一句话 diff 跳过计划"不动；追加 C 的「完整结果一个 Task 就能交付、多个交付组才拆 Phase」判据，但受本仓 `plan-lint.sh` 要求至少一个 `## Phase` 小节的结构约束，改写为「单 Task 仍装一个 Phase，不硬拆多个」——是判据在本仓工具链下的落地，不是 C 原句字面搬运（见下方「拿不准的合并决定」）。 |
| [依赖检测] | [依赖检测] | 合并 | K 的六路可选输入判据骨架不动；DESIGN.md 一行从「固定单开 token Task」改判据为「按实际需要折进相关 UI Task」，对应 T4「不把固定 DESIGN token Task 普遍化」；插入 C 的「局部需求已确认可先出计划，未确认部分只阻断相关 Phase/Task」；括注补「文档实际拆分或不在默认路径时按项目实际路径读，不假设都叫固定文件名」，对应 T4「沿用实际 Spec/ADR/DFX/原型路径」。 |
| （新增） | [文件结构] | C | 从合成版对应节整段搬入（`.agents/` → `.claude/`），登记 `references/acceptance-and-dependencies.md` 与 `templates/dev-plan-template.md`；放在 [依赖检测] 之后、[第一性原则] 之前，对齐 arch-designer / product-spec-builder 等本仓已有 Skill 的章节顺序惯例。 |
| [第一性原则] | [第一性原则] | K | 未改动——T4 判 C 领先的「按价值与关键未知切片、保留真实依赖与最小基础设施」，本节「价值与未知先行」一条（先交付核心价值、先验证关键未知、基础设施只做支撑第一条价值流程所需的最小部分）已实质覆盖；T4 同时要求保留的「K 的依赖 DAG、假设前置、文件路径要求」分别落在本节「文件路径明确」与 [分析策略]，本来就有，不动。 |
| [分析维度清单] | [分析维度清单] | K | 未改动，T4 判 K 对 `[推断]`/`[待定]` 的早期验证与默认前提表更具体，属于要保留的一侧。 |
| [分析策略] | [分析策略] | K | 未改动——依赖图构建法、价值排序法、粒度校准法、假设前置法是 T4 明确点名「判 K 领先，本仓已有、不动」的内容（依赖 DAG、假设前置）。 |
| [待定问题处理] | [待定问题处理] | K | 未改动，T4 判 K 对 `[推断]`/`[待定]` 更具体，保留。 |
| [信息充足度判断] | [信息充足度判断] | 合并 | K 的六条「必须满足」骨架保留；「技术栈已确定」「Phase 拆分完成」两条改判据为「首次引入才 WebSearch、已有项目不强行重选」「多个交付组才用多个 Phase、单结果不凑数」，对应 C「不强行在小任务选技术栈、定版本或生成完整计划」；追加「范围外仍待定的部分只阻断依赖它的 Task/Phase，不倒过来阻断已确认部分先出计划」，对应 C「未知只阻断相关切片」；「不使用占位符」逐字保留，对应 T4「K 的『无占位符』保留为待派 Task 的质量要求」。 |
| [生成前自检] | [生成前自检] | 合并 | K 原四条（无占位符 / 命名一致 / Spec 覆盖 / 假设覆盖）一字不动；新增「Task 可派发」（Business Context / 依赖类型 / 证据产生者三项齐全，能直接抄进 implementer 派单）与「REQ 覆盖」两条，对应 C「Goal/Scope/Business context/owned paths/Verification 及适用 REQ 直接服务派单，验收含业务例子与产生者」。 |
| [确认策略] | [确认策略] | K | 未改动，T4 本节未提及，本仓原判据独立成立。 |
| [命名纪律] | [命名纪律] | K | 未改动——T4「K 的跨 Phase 命名核对有用」对应的实质内容在 [生成前自检]「命名一致」一条，已保留；本节讲的是 Phase 编号对用户的沟通口径，是另一件事，不动。 |
| [工作流程] | [工作流程] | 合并 | 生成模式一步插入「完整结果一个 Task 就够时只开一个 Phase，不硬拆多个」，并如实写明 `plan-lint.sh` 只按整份 Spec/Plan 做双向覆盖检查、不支持传需求子集参数（有该检查时说清楚它检查什么，没有子集能力就不假装能跑）；迭代模式把「已完成的 Phase（标 ✅）不动」改写为「已完成只证明当时那版行为、不证明 Spec 改完后新行为也成立，修正需求要落成新 Task，不能因为已标 ✅ 就漏掉」，对应 C「已完成证据保留历史但不证明新行为」，也是 T4 点名 K 原表述会漏掉修正任务的问题。 |
| [初始化] | [初始化] | K | 未改动。 |

新增 `references/acceptance-and-dependencies.md`：来源 C，codex-base `d1a3287` 教学材料整文件搬入，文件头加声明「codex-base `d1a3287` 教学材料；预约例是虚构案例，其中数字、命令、路径不自动成为本项目要求」。宿主适配：①「完整 Assurance 仍由主 Agent 派发」改写为「完整验收安排仍由主 Agent 按 Task 定档（LOW / MEDIUM / HIGH，见 dev-workflow-details.md）派发」；②「独立 reviewer/tester 的责任按 controls 安排」改写为「按 Task 定档安排（MEDIUM 起才派 code-reviewer，HIGH 加派 tester，与实现者不同实例）」；③ 删除末段指向 `../../dev-builder/references/async-proofreading-case.md` 的跨技能示例链接——该文件本仓不存在、也超出本次只改 dev-planner 的范围，避免留悬空引用。方法正文（补读界面/数据/技术依据、按完整结果切片排序、让结果有产生证据的人和动作、区分功能依赖与验证依赖、研究任务结束的是未知、交给下一角色）未改写。[文件结构] 已同步登记。

`templates/dev-plan-template.md` 同步改动（来源：合并）：顶部说明追加 Task 子字段与本仓「派单包七字段」（`.claude/rules/subagent-dispatch.md`）的对应关系，以及「单 Task 仍装一个 Phase」的判据；每个 `- **Task N.M：**` 条目下追加 Business Context / 依赖类型 / 证据产生者三个子字段（不受 `plan-lint.sh` 检查，但对齐派单字段）；「关键文件」写作要点补「共写文件标唯一 owner Task」；片段示例追加一条子字段示范；写作要点新增第 11–14 条，对应 Business Context 写法、依赖类型区分、证据产生者对应本仓 LOW/MEDIUM/HIGH 判档、Phase 数量不是固定门槛。原有段名锚点（**交付内容** / **验证的假设** / **关键文件** / **Task 清单** / **验收标准**）与 `- **Task N.M：**` 格式一字不改。

## 拿不准的合并决定

- **`plan-lint.sh` 与「不必用 Phase」的字面冲突**：T4 与派单原文都写「完整结果可用一个 Task 交付」，读起来像是可以完全不设 Phase 容器；但本仓 `plan-lint.sh`（`if not phase_matches: fail("未找到任何 ## Phase 小节")`）对任何 DEV-PLAN.md 硬性要求至少一个 `## Phase` 标题，且本次改动范围不含这个脚本。我把判据收窄成「单 Task 仍装进一个 Phase，只是不强行拆成多个」，这是在现有工具链约束下最贴近原判据的落地，但不是 C 原文的字面搬运。如果判断应该是改脚本本身（放开「零 Phase」结构），这个决定需要主 Agent 或 Codex 侧重新裁定，我没有改 `plan-lint.sh`。
- **`plan-lint.sh` 的「需求子集检查」没有对应能力**：派单原文写「plan-lint 按所选需求子集检查」，但脚本实际只支持 `[plan] [spec]` 两个位置参数，做的是整份双向覆盖检查，没有 `--requirements`/`--section` 这类子集入参（那是 Codex `harness.mjs plan lint` 的能力，按规则不搬）。工作流程一节如实写了这个限制，没有假装脚本已经支持子集过滤；如果需要脚本层面补这个能力，应作为独立的 MEDIUM 档改动交主 Agent 排期，不在本次范围内顺手加。
- **Business Context / 依赖类型 / 证据产生者的措辞选择**：三个新字段直接借用了本仓已有「派单包七字段」里的 `Business Context`（`.claude/rules/subagent-dispatch.md`）而不是另造贴近 C 原文（`Business context`/`Verification`）的新词，目的是让 DEV-PLAN 的 Task 条目能直接对上派单字段、少一次翻译；「依赖类型」「证据产生者」是我按 C 原文「依赖类型：功能前置与验收前置分开」「证据产生者」的意思起的本仓中文名，C 原文没有现成的对应字段名可抄。如果认为应该更贴近 C 的措辞或字段拆法，请指出。
- **acceptance-and-dependencies.md 末段跨技能链接被整段删除**：原文末段指向 `dev-builder` 的一个示例文件，本仓当前不存在，也不在本次「只改 dev-planner」的授权范围内新建；如果 dev-builder 那条适配线后续把这个文件补上了，可以再把链接加回来，这个决定留给主 Agent 判断是否需要跨 Skill 补链接。

## 第二轮修正（2026-09-22，Codex 审）

依据：Codex 侧异模型审查 `docs/handoff/codex-review-cc-adaptation-20260922.md`（`codex-base-ro` 只读克隆）第 6 节「dev-planner」，三条：HIGH PL1、HIGH PL2、Medium PL3。本轮只改 `.claude/skills/dev-planner/SKILL.md` 与 `templates/dev-plan-template.md`，不动 `plan-lint.sh`——PL2 的脚本侧新契约（「## 范围外（本次不计划）」小节的双向核对逻辑）由另一个 implementer 往 `plan-lint.sh` 里加，本表只记文档与模板侧改动。

| 问题 | 审查原文要点 | 改动位置 | 改法与依据 |
|---|---|---|---|
| HIGH PL1 | 第 14 行缺根目录 Product-Spec.md 就回 product-spec-builder；第 16 行「按实际路径」只修饰可选输入；第 7、65 行写死默认 Spec | `[任务]`（生成模式一句）、`[依赖检测]`（必需项 + 可选项括注）、`[待定问题处理]`、`[信息充足度判断]`（核心功能覆盖那条）、frontmatter description | 把「必需」的定义从「文件名叫 Product-Spec.md」改成「已确认的需求内容」：没人指定来源时默认读根目录 Product-Spec.md，用户指定的 PRD / Spec 路径、或会话内已经谈拢确认的局部需求都按实际来源读；只有默认文件不存在、用户没给替代来源、会话里也没谈出任何已确认内容时才回 /product-spec-builder。`[依赖检测]` 可选项括注补一句「必需输入也遵循这条」，不再让「按实际路径」只修饰可选输入。`[待定问题处理]` 的「待定问题」表改读「已确认需求来源」而非硬写 Product-Spec.md。`[信息充足度判断]` 的核心功能覆盖条补上来源出处（[依赖检测] 判定的实际来源）。frontmatter description 同步改成「当需求内容已确认（默认 Product-Spec.md，用户指定的其他实际来源同样适用）……」，确保 `grep -n "Product-Spec.md" SKILL.md` 每处命中都是默认名语义，不是强制文件名语义。 |
| HIGH PL2 | 第 81、84 行要求「整份 Spec 的功能 / REQ 都有 Task」，与第 15、75 行的局部计划出口冲突；第 93 行把全量 `plan-lint.sh` 无条件塞进生成流程 | `[生成前自检]`（Spec 覆盖、REQ 覆盖两条改名重写）、`[工作流程]`（生成模式一句）、`templates/dev-plan-template.md`（新增 `## 范围外（本次不计划）` 小节样例 + 顶部锚点说明 + 写作要点第 15 条） | 「Spec 覆盖」改名「当前范围覆盖」，核对对象从「Spec 的功能」收窄为「当前计划范围内的功能」；「REQ 覆盖」同样收窄到「当前计划范围内」的 REQ，范围外的 REQ 改为写进新的 `## 范围外（本次不计划）` 小节并给原因（待确认 / 已押后 / 归别的计划），不强行编 Task 也不能不声明。`[工作流程]` 生成模式补一步「按 templates 填充时把范围外 REQ 连同原因写进该小节」，并把 `plan-lint.sh` 那句改写成新契约的文档侧描述：对范围内 REQ 做双向覆盖检查，范围外已声明原因的 REQ 报「范围外（已声明）」不算失败，只有既没 Task 又没声明的才 FAIL——这段描述对应的是脚本侧另一个 implementer 正在加的能力，本轮只写目标契约，不代表本仓当前这份 `plan-lint.sh` 已经实现（脚本改动不在本次授权范围，未跑脚本验证这条新逻辑本身）。模板同步加 `## 范围外（本次不计划）` 小节的 markdown 样例（含「无」的写法提示）、顶部说明补上这个小节是 plan-lint 锚点，写作要点新增第 15 条「范围外声明不是豁免，每条要给原因和回来的条件」。 |
| Medium PL3 | `[分析维度清单]` 第 43-44 行「逐项 WebSearch」无条件；`[确认策略]` 第 86-87 行「小项目 3-5 个 Phase」选择题无条件；`[工作流程]` 第 93 行生成流程无条件 WebSearch 技术栈 | `[分析维度清单]`（技术栈那条）、`[确认策略]`、`[工作流程]`（生成模式一句，与 PL2 合并改写）、`[任务]`（生成模式一句，顺手补齐一致性） | 三处都加同一条件：只有本次确实新引入或变更技术栈时才 WebSearch 选型，已有项目沿用现有版本不必重新逐项核实；只有存在多个可独立验收的交付组、且 Phase 粒度确有偏好空间时才让用户在 Phase 数量里选，完整结果一个 Task 就够、或已有项目一条配置 / 文案 Task 时不问技术栈也不问 Phase 数。`[分析策略]`（依赖图构建法 / 价值排序法 / 粒度校准法 / 假设前置法）与 `[第一性原则]` 未改动，按要求保留 K 的依赖 DAG 与假设前置方法。`[任务]` 的「生成模式」一句原本也无条件写「WebSearch 验证技术选型」，审查未点名但与三处新条件矛盾，顺手补上同一条件，避免同一份 SKILL.md 内前后不一致；`[第一性原则]` 的「联网优先」一句未被审查点名、也未改——它讲的是「确实需要定版本时先 WebSearch」的一般方法，不是无条件触发指令，与新条件不冲突，不属于本轮改动范围。 |

验证（原始输出见回执）：`grep -n "Product-Spec.md" .claude/skills/dev-planner/SKILL.md` 6 处全部是「默认名，用户指定/会话确认的实际来源同样有效」语义；`grep -rn "范围外" .claude/skills/dev-planner/SKILL.md .claude/skills/dev-planner/templates/dev-plan-template.md` 两个文件都命中；`grep -rn "\.agents\|\.codex\|resolver\|controls\|Assurance" .claude/skills/dev-planner/` 为空；`bash .claude/tests/test-skills-lint-wording.sh` PASS=2 FAIL=0；顺手跑了 `node .claude/harness/harness.mjs skills-lint`（非任务要求的必跑项，但改了 frontmatter description 顺手核对）：18 个 skill 全部 in-scope，0 findings，dev-planner description 78 字符，在预算内。

## 第三轮修正（2026-09-22，Codex 复核 PL2）

依据：`docs/handoff/codex-recheck-cc-adaptation-20260922.md`（`codex-base-ro` 只读克隆）指出第二轮 `[工作流程]`（现 93 行）仍指导**无参**运行 `bash .claude/scripts/plan-lint.sh`，而脚本无参时只默认取 DEV-PLAN.md 同目录的 `Product-Spec.md`，需求来源换了名字或不在同目录时找不到便跳过覆盖检查（退出 0），覆盖缺口漏报。

改法：`[工作流程]` 生成模式一句把调用改成 `bash .claude/scripts/plan-lint.sh DEV-PLAN.md <实际需求来源路径>`——路径取 [依赖检测] 判定的实际来源，默认来源 `Product-Spec.md` 也显式传、不省略第二参数；补一句「需求来源只存在于本次会话、没有文件可传时，lint 跳过覆盖检查，在 DEV-PLAN.md「开工前置」段写明『REQ 覆盖未验证』，不把 Phase/Task 结构检查通过说成覆盖检查通过」。`[生成前自检]`（REQ 覆盖那条）与 `[信息充足度判断]` 中提到 `plan-lint.sh` 的句子是行为描述、不是调用语句，未改；`templates/dev-plan-template.md` 的「写作要点」里没有现成的调用命令句，按派单第 2 条「没有就不加」未动。`plan-lint.sh` 本身未改（脚本早已支持第二参数，本轮是补测试覆盖，不是修脚本缺陷）；`test-plan-lint.sh` 新增 L18（显式传非默认名、非同目录的 `docs/prd/order.md` → 覆盖检查按该文件做，漏引用的 REQ FAIL 并点名；同一夹具无参跑仍 rc 0，作为对照写进用例说明）与 L19（同一显式路径 + 目标 REQ 在「范围外（本次不计划）」声明 → 通过并 WARN），并把 `:174` 的「未覆盖」清单里「第二位置参数显式指定 Spec 路径」一项删除（已覆盖）。

另：`025cbac` 提交说明「六份 after-sales 示例加虚构教学例声明」的计数有误，见 `docs/predev-adaptation-20260922/product-spec-builder.md` 第二轮修正节末尾的更正。

验证（原始输出见回执）：`bash .claude/tests/test-plan-lint.sh` PASS=20 FAIL=0；`bash -n` 与 `shellcheck` 对 `test-plan-lint.sh` 均无告警；`node .claude/hooks/static-check.mjs .` 全绿；`bash .claude/tests/test-skills-lint-wording.sh` PASS=2 FAIL=0；`grep -n "plan-lint" .claude/skills/dev-planner/SKILL.md .claude/skills/dev-planner/templates/dev-plan-template.md` 中唯一的调用句（现 93 行）带 `DEV-PLAN.md <实际需求来源路径>`，其余命中均为行为描述、不涉及调用语法。


## 2026-09-23 Matt Skills 整改同步

依据：`codex-base` `git diff 3e199f6 407c3bc -- .agents/skills`（计划 `docs/research/20260918-matt-skills-learning-plan.md`，行为对照在 `docs/research/20260918-matt-skills-study/`）。上游 `mattpocock/skills@74ca5fe`（MIT），处理方式 synthesized：只取方法，不搬 Codex 运行时概念。来源列 C = codex-base `407c3bc`，括号内为对应批次。

| 本仓章节 | 变更 | 来源（C = codex-base 407c3bc，对应批次 L1–L6；上游 mattpocock/skills@74ca5fe，MIT，synthesized） | 一句理由 |
|---|---|---|---|
| [分析策略] | 新增「大范围迁移法」一条（接在假设前置法之后），指向参考的「大范围迁移的兼容与退出」 | C（L3） | C 把它放在 [策略] 的跨批路径与命名之后；本仓对应方法集中在 [分析策略]。 |
| [待定问题处理] | 追加一段：待定口径写不出预期行为与验收时，依赖写成「谁 / 哪份来源回答什么 → 解锁哪项行为、Task 与验收」，先排取证，不提前列可派发 Task | C（L1） | C 只改了参考文件；本仓 SKILL.md 原先对 acceptance-and-dependencies.md 只在 [文件结构] 登记、没有读取时机，按 L6「漏读先修指针」在最贴近的 [待定问题处理] 补一处指针。 |
| references/acceptance-and-dependencies.md | 「按完整结果切片与排序」追加业务口径未定时的取证依赖一段；新增「大范围迁移的兼容与退出」一节（位于「研究任务结束的是未知」之前） | C（L1、L3） | 正文照搬；「Git 分支、合入和回退操作仍须有实际授权」改为「分支合入、回退与远端操作仍按审批三档取得授权」，「共享集成分支或工作区」写作「共享集成分支或 worktree」。 |
| templates/dev-plan-template.md | Task 条目下新增可选子字段「迁移与可运行基线」；写作要点新增第 16 条 | C（L3） | C 改的是模板字段与第 10 条「跨 Phase 一致」；本仓写作要点没有同名条目，新增一条承接，不动原第 1–15 条与 plan-lint 锚点。 |

现有句子未改：本次全部为新增行或新增节。acceptance-and-dependencies.md 文件头仍写 `d1a3287`，新增两段的来源以本表为准；C 在 SKILL.md 把「读取参考中的『让每个结果……』『区分……』『研究任务……』」泛化为「读取参考中的适用方法」，本仓该句本不存在，未搬。
