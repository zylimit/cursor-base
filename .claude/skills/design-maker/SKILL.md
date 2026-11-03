---
name: design-maker
description: 当 Design Brief 完成后、用户需要生成设计稿时使用；用户要用离线逻辑沙盘检验一个明确的业务状态或规则问题时也使用，这时可在 Design Brief 之前做。
---

[任务]
    读取 Product-Spec.md、Design-Brief.md、DESIGN.md，通过 Open Design CLI（odc）生成一份完整的可交互 HTML 设计稿。
    **一份产物两用**：开发照着它实现（编码核心参照）；给领导/干系人评审直接浏览器打开看。HTML 就是最终成品的真容，所见即所得。
    先出三个首屏方向样张让用户选，再出全稿；生成前走两遍法把「给任何页面都会给的默认」挑出来；产物过 UI 审计与质量地板才交付。
    确保 Product Spec 中每个有 UI 的功能都有对应页面，每个页面覆盖八态。
    分三个阶段，每阶段完成后向用户确认再进入下一阶段。
    本机没有 odc 时不退出：前期功课照做，改出一份提示词交用户拿去任意工具生成（[提示词模式]）；用户主动要提示词时有 odc 也走这条。
    用户主动点名 Claude Design 时走 [画布模式]：全稿换成画布上的一组画板，画完把画布上的文件全部拉回仓库入库。
    只需回答一个明确的业务状态或规则问题时走 [逻辑沙盘入口]：直接写一份单文件、可离线操作的 HTML，让领域人员操作事件、观察结果，不必先定整套视觉方向，也不走 odc 与三阶段。

[工具安装]
    **Open Design CLI（odc）** —— 生成侧唯一依赖，本地 daemon 驱动，内部调用 Claude/Codex agent 生成 HTML。
    - 封装命令为 `odc`（避开 GNU coreutils 的 `/usr/bin/od`）。daemon 默认 `http://127.0.0.1:17456`。
    - 自带 142 个品牌级 design system（apple/linear/notion/stripe/minimal/clean/modern…），当基底用；token 以 DESIGN.md 为准。
    - ⚠️ **所有 `odc ... --json` 输出前面会混入 `[plugins] registered ...` 日志行**，解析前必须 `grep -v '^\[plugins\]'`，否则 JSON 解析失败。
    - 安装参考 https://github.com/nexu-io/open-design ；本项目环境已部署。
    **UI 审计**：`node .claude/scripts/ui-audit.mjs`，需要 `playwright-core` + 本机 Chrome（或一次性安装 playwright）；没有就审计缺席，报告里注明，不冒充通过。

[依赖检测]
    必需：Product-Spec.md → 缺失则提示先调用 /product-spec-builder
    必需：Design-Brief.md → 缺失则提示先调用 /design-brief-builder
    强烈建议：DESIGN.md → 缺失则从 Design-Brief 的视觉方向临时抽一组 token 写进 prompt，产物标「未经 DESIGN.md」，并建议回 /design-brief-builder 补
    分路：`which odc` 查得到 → `odc daemon status --json | grep -v '^\[plugins\]'` 要返回 `"ok": true`，
          未起则 `odc daemon start --headless --serve-web --no-open --port 17456` 后重试，走 Phase 1-3 的生成流程；
          查不到 odc → 进 [提示词模式]，不退出不报错，开口第一句告诉用户这次走的是哪条路
          用户主动点名 Claude Design → 进 [画布模式]，不查 odc；先用会话的 Artifact 工具确认 Design 画布类型可用，不可用就如实说并退回上面两条
          用户主动要提示词 → 进 [提示词模式]，有 odc 也不走生成
          三条路的先后：odc 优先；画布与提示词只在用户点名时走，不因为会话里能出画布就自己改道
    可选：`node -e "require('playwright-core')"` 成功 → 验收跑 ui-audit；失败 → 报告注明「UI 审计缺席」
    缺 Product-Spec.md 或 Design-Brief.md → 退出，提示补全后重新调用
    以上必需项与分路只管完整设计稿；按 [逻辑沙盘入口] 走沙盘时，只要 Product-Spec.md 或会话里已确认的规则片段足以说清所问的问题，不要求 Design-Brief.md / DESIGN.md，也不查 odc，不因缺它们退出

[文件结构]
    design-maker/
    ├── SKILL.md                          # 本文件：odc / 画布模式 / 提示词模式三条生成路 + 两遍法 + 原型构建与任务试走方法 + Phase + 验收 + 交付 + 逻辑沙盘入口
    └── references/
        ├── logic-prototype.md            # 业务逻辑沙盘：限定一个问题，用状态 / 事件 / 异常 / 重置做可自由操作的单文件（含预约教学例）
        ├── prototype-construction.md     # 从关键屏到 token/组件/状态/页面逐层展开、实际渲染与键盘/内容核对方法（含预约教学例）
        └── task-walkthrough.md           # 带任务试走方法：参与者带目的试走、观察理解与恢复、发现回填到正确来源
    视觉词汇与质量地板复用 ../design-brief-builder/references/style-vocabulary.md、ui-quality-floor.md，两遍法自审与验收抽查时读。

[第一性原则]
    **完整覆盖原则**：Product Spec 中每个有 UI 的功能、Design-Brief 里每个 SCREEN 都必须在生成 prompt 里点名，确保产物覆盖。漏一个页面，开发时就少一个参照。
    **状态完备原则**：每个页面不只默认态。八态（空 / 加载 / 成功 / 错误 / 冲突 / 离线 / 无权限 / AI 工作中）在 prompt 里逐页要求，Design-Brief 已写的照抄不改。
    **原型边界原则**：结果未知（已提交但还不能确认成功或失败）是合法状态，不能靠转圈动画或默认成功掩盖；产物里清楚区分真实本地交互与模拟的外部 / 后端行为（不真的发送、同步、扣款、持久化到后端），模拟标注写在原型说明里，不混进产品主流程文案。每个会改变结果的动作说明保存位置、刷新后是否保留、以及怎样重置，让同一任务与异常能反复试走。
    **文档驱动原则**：一切设计决策来自三份文档。颜色、字号、圆角、间距只从 DESIGN.md token 来，不散写 hex；DESIGN.md 的 Do's and Don'ts 原样进 prompt 当护栏；不添加文档未描述的功能。
    **两遍法原则**：生成前先写一页紧凑的设计计划（token 摘录、每页 ASCII 线框与对齐、大胆放在哪一处、动效只留哪一处），再对照 brief 与 `../design-brief-builder/references/style-vocabulary.md` 的 AI 通病清单审一遍——任何一处是「给任何同类页面都会给的默认」而不是给这个产品的选择，就改并说出改了什么；只有审过才生成。
    **真实内容原则**：prompt 里提供 Spec 与 Brief 里的真实文案和样本业务数据（案例里的人名、型号、地址），要求产物不使用 Lorem ipsum 或无意义占位符。
    **质量地板原则**：`../design-brief-builder/references/ui-quality-floor.md` 的 MUST 不宣告地做到——键盘可达、焦点可见、reduced-motion、对比达标、命中区、空 / 错态有下一步。
    **离线自包含原则**：产物必须单文件 index.html、CSS/JS 全内联、零外部依赖（无 CDN/unpkg/googleapis，字体用系统栈回退），浏览器双击即开、完全离线可用。[画布模式] 的全稿是一组画板加一份运行文件，不是单文件，本条换成「源文件与运行文件全部拉回仓库、本地打得开」。

[设计交付物]
    - `demo/design-plan.md`：两遍法的设计计划与自审记录（token 摘录、线框、大胆一处、通病自检结果、选定方向）
    - `demo/design-prompt.md`：整段可粘的生成提示词（提示词模式下的产物，交用户拿去任意工具生成）
    - `demo/directions/direction-{1,2,3}.html`：三个首屏方向样张（同一页面三种完整人格，不是换色）
    - `demo/index.html`：全稿——**给开发**编码核心参照；**给领导/干系人**评审时浏览器直接打开看，可点可交互；内部标注哪些操作是真实本地交互、哪些是模拟（不真的发送 / 同步 / 扣款 / 持久化），模拟数据保存在哪里、刷新后是否保留；每个可能改变结果的动作提供可重置的演示入口，让同一任务与异常能反复试走
    - `demo/ui-audit/`：审计 JSON 与截图（有引擎时）
    - `demo/canvas/`：[画布模式] 下的全稿——画布索引、逐张画板源文件、画板运行文件 `project/support.js` 与本地目录页 `index.html`，从画布上拉回来的那一份，是编码的一部分，必须入库，本地浏览器直接打得开；画布链接只是看稿入口，不算交付物
    产物必须满足 [第一性原则]：完整页面覆盖、八态、真实数据、离线自包含、质量地板、原型边界（模拟标注与可重置）。

[从关键屏落到完整原型]
    **先解决最重要的可见问题**：从覆盖矩阵（[Phase 1：准备] 新增的那一步）里选最能暴露当前未知的关键屏，用真实内容先处理主次、对齐、密度和动作位置，再实际打开看渲染；已有 Design-Brief / DESIGN.md 的 token 优先继承，不能只把 token 写对就假定页面已经有正确的视觉层次。

    **按关键屏 → token → 组件 → 状态 → 页面展开**：从关键屏提炼实际需要的颜色角色、排版、间距，集中成 design-plan.md / DESIGN.md 里的具名 token；建立对应语义组件，再让组件经历当前任务的真实状态，最后扩展到 Brief 里其余 SCREEN 和导航关系。一个组件复用的是一致的作用与行为，不能把所有对象套成同样卡片；发现状态语义与 Brief 不一致时回 Design-Brief 核对，不自己另造一套。

    **每个动作都能说明结果与恢复**：按「触发 → 可见反馈 → 保留数据 → 可用动作 → 退出/恢复」写清每个会改变结果的动作（简单动作一句话即可）；区分真实的本地交互、模拟的外部 / 后端行为和未实现部分。显示 toast 不能代替保存，出现「可撤销」必须真的能恢复所声明的原型数据，取消加载动画也不等于撤销已经发生的业务动作。涉及异步结果或用户正在编辑的内容时，核对对象、请求代次与当前意图，旧结果不能无说明覆盖新内容。详细方法（含预约教学例）见 `references/prototype-construction.md`。

    **让内容、键盘与焦点一起工作**：先让内容顺序与主任务在窄屏成立，再调整装饰；核心路线用键盘实际走通，检查焦点进入、模态约束、退出后返回，以及错误后的下一步；非模态区域不能无故困住焦点。代表长文案、放大、固定导航遮挡、状态播报与 reduced-motion 分别核查，不把加了 ARIA 属性当完成验证——这几项在 [验收] 里有 UI 审计引擎时随 ui-audit 一起跑，没有引擎时人工核对，查不到的写「未验证」。

[任务试走方法]
    比字符串 grep 或结构检查更能识别「按钮能点但任务做不完」：让参与者（没有真实参与者时 Agent 自行追演，明确只是自检）带着一个来自 Product-Spec / Design-Brief 的真实任务目的去走原型，不把每一步该点哪里先告诉参与者——那只能证明能跟指令，暴露不出入口、信息次序或状态文案的问题。

    观察三件事：认不认得出入口、理解不理解动作后果和当前结果、被打断或出错后能不能接上（返回、纠错、中断恢复、重复操作）。按当前设计的不确定性挑一个相关异常（输入不全、结果尚未确认、无权限、操作被取消），看信息和输入是否保留、下一步是否明确。反馈不明时请参与者描述看到的结果和下一步，不问引导性的「这样是不是方便」；只记录实际动作、具体话语、卡点，Agent 自演与真实观察分开标注，不虚构满意评分。

    发现按来源回填：布局 / 视觉层次问题回 Design-Brief；数据含义、权限、成功条件或流程分歧回 Product-Spec；跨模块的结果 / 恢复承诺交主 Agent 同步架构 / DFX；再更新 design-plan.md 与产物本身。一次试走通过不证明所有人、设备或异常都可用，没走过的路线要在交付时列出。方法细节与虚构教学例见 `references/task-walkthrough.md`。

    并入 [Phase 2：生成] 的 [验收]，与 ui-audit 并列跑：ui-audit 是渲染审计（溢出 / 对比度 / 焦点可见性等结构性检查），任务试走是任务审计（能不能真的走完一个业务任务），两者都要，不能用其中一个替代另一个。

[逻辑沙盘入口]
    **何时走**：用户要检验一个状态、事件顺序或业务规则，当前不需要完整页面和视觉方向（arch-designer 的反证取决于领域人员操作顺序时也会建议走这里）。要评估界面层次、导航、品牌视觉或完整任务流程的，走完整设计稿的 Phase 1-3；一个明确的文案 / 位置修改沿已有内容直接改，不因此生成沙盘。
    **怎么做**：先读 references/logic-prototype.md，写清问题、来源、初态、事件、异常与重置，再由执行本 Skill 的 Agent 直接写出可操作的 HTML；不得只交文字状态表或静态卡片。业务取舍仍未知时标出候选分支和可观察后果，只暂停依赖该决定的承诺。沙盘不走 odc、方向样张、两遍法、覆盖矩阵、逐页八态与 token 一致性检查，覆盖的是所问问题的状态、事件、异常与重置。
    **照样要守**：[第一性原则] 的原型边界、真实内容、质量地板、离线自包含；[验收] 里的完整无截断、离线自包含、模拟边界属实、质量地板抽查照做。ui-audit 只收目录、只打开其中的 index.html：要审沙盘就把它另放一个目录并命名为 index.html 后对该目录跑，不要对 `demo/` 跑（那审的是全稿，还会覆盖全稿的审计证据）；没这样跑就报「UI 审计未覆盖沙盘」，按实际覆盖报告。画面范围有限不代表业务规则或可访问性可以跳过核查；沙盘里的观察不自动成为生产需求或实现依据。
    **交付与回填**：报告 HTML 路径与打开方式、问题和来源、可试走事件、实际观察、模拟边界、已验证与未验证项。规则发现回 Product-Spec；状态归属或跨模块结果有争议时，把发现和来源交主 Agent 按需路由 arch-designer，不由原型推定权威事实。产物落盘即止，不自动提交。

[视觉方向 → design system 映射]
    DESIGN.md 是 token 的唯一来源，odc 的 design system 只当基底：
    1. `odc design-systems list` 列出全部（输出第一列就是 create 要用的**短 ID**）
    2. 按 DESIGN.md 的 Overview 参照物与情绪词匹配最接近的一个（用**短 ID，不带 `design-system-` 前缀**），例如：
       - 极简/克制/纸感 → `minimal` / `clean`
       - 现代中性 → `modern` / `default`（Neutral Modern）
       - 高级感/苹果风 → `apple`
       - 效率工具/Linear 风 → `linear-app`
       - 文档/Notion 风 → `notion`
       - 金融/数据密集 → `stripe` / `binance`
    3. 基底与 DESIGN.md 冲突时 DESIGN.md 赢：prompt 里明写「以下 token 覆盖 design system 默认值」
    4. 拿不准时列 2-3 个候选给用户选；选定后记下短 ID 备用

[Phase 1：准备]
    1. 检测依赖（[依赖检测]），有 odc 时 daemon 必须在跑；没有 odc 转 [提示词模式]；用户点名 Claude Design 转 [画布模式]
    2. 读 Product-Spec.md → 提取真实样本数据、关键流程、成功判据里的可见指标
    3. 读 Design-Brief.md → 提取 SCREEN 清单（页面目的 / 首要动作 / 首屏开在哪 / 布局 / 内容层级 / 八态 / 响应式）、CMP 清单、交互原语、文案规则、动效「只留哪一处」、§A（Agent 形态时）
    4. 读 DESIGN.md → 前言 token 全量 + 八段 prose + Do's and Don'ts + Motion；缺 DESIGN.md 时从 Brief 视觉方向临时抽 token 并标注
    5. 选 design system（[视觉方向 → design system 映射]）
    6. 选 skill —— `odc skills list` 列出，用**真实 registry ID**，按产品类型挑：
       - 通用前端/Web 应用 → `frontend-design`
       - 其余按 skills list 输出里语义最贴近的 ID 选
       ⚠️ 不要用 `example-*`——那是 scenario 示例，不是 skill，create 会 `SKILL_NOT_FOUND`
       拿不准列候选给用户选
    7. **划覆盖矩阵**：页面 × 状态 × 任务 → 交互 → 验收锚点，把 Design-Brief 的 SCREEN/CMP 和 Product-Spec 的业务任务对齐；标出哪些已经有明确依据（Spec/Brief/DESIGN.md 写清楚了）、哪些是本次真正的未知（业务规则未定、可逆视觉细节由 Agent 按现状决定并说明）。只暂停依赖未决决定的部分，已确认的继续往下走。已有明确方向（DESIGN.md 判据清楚、用户此前已选定或明确授权某个方向）时跳过 2A 方向样张，项目建好直接进 2B 全稿；只有方向仍待定或用户要求比较时才出方向样张，不为了走流程而重复确认已经拍板的方向。
    8. **两遍法第一遍——写 `demo/design-plan.md`**：token 摘录（4-6 个具名色、字族角色、圆角与间距刻度）；每个 SCREEN 一段 ASCII 线框 + 对齐说明（左对齐 / 居中 / 两端）；首屏开在题材最有特征的什么上；大胆放在哪一处；动效只留哪一处；组件复用清单
    9. **两遍法第二遍——自审**：逐项对照 style-vocabulary 的 AI 通病清单（五类聚簇、排版通病、动效通病、首屏通病）与 DESIGN.md 的 Don'ts；命中的写「原本 → 改成 → 为什么」进 design-plan.md；brief 钉死的照 brief
    10. **构建生成 prompt**（写入临时文件 `design-prompt.md`，[提示词模式] 下落盘到 `demo/design-prompt.md`）——一份 prompt 两条路通用，视觉规范必须写进正文（odc 有 design-system 注入，交人拿去生成的那条全靠 prompt，2C 与 [提示词模式] 都走它）：
       - **DESIGN.md 原文**（前言 token + 八段 prose + Do's and Don'ts + Motion），并声明「token 覆盖 design system 默认，不许出现 token 之外的 hex」
       - **设计计划**（design-plan.md 的线框、大胆一处、动效一处）
       - 逐页面：SCREEN 编号 + 布局分区 + 内容层级 + 真实内容 + 交互（每个交互写明「点击 X → Y」）+ 八态 + 响应式断点 + 页面间跳转关系
       - 组件清单与变体状态（引用 CMP 编号）
       - 文案规则（动词开头、同一动作同名、错误给下一步、空态是邀请）
       - **质量地板摘要**（键盘可达与焦点环、命中区 ≥44px 移动端、reduced-motion、对比 ≥4.5:1、状态不只靠颜色、`…` 不是 `...`、tabular-nums）
       - 末尾固定追加：
         ```
         Output: single self-contained index.html, all CSS and JS inlined.
         ZERO external dependencies — no CDN, no unpkg, no googleapis. Must work fully offline.
         Cover every page and all required state variants. Use the provided real data, no Lorem ipsum.
         Use only the color / type / radius / spacing tokens given above; do not invent new hex values.
         Respect prefers-reduced-motion; all interactive elements keyboard-reachable with visible focus.
         ```
    11. 向用户展示计划（页面数 / 变体数 + 选定的 skill + design system + 覆盖矩阵里的未知项 + 通病自审改了什么），确认后进 Phase 2

[Phase 2：生成（odc 为主，AI Studio 兜底）]
    默认走 odc（2A + 2B）。仅当 odc daemon 不可用 / agent 鉴权失败 / 产物验收始终不过时，降级到 AI Studio（2C）。

    [共同入口：建项目取 ID]
        不论方向是否已拍板，2A 与 2B 共用同一个项目，先建项目取 ID（**不带 `--mode`**，--mode 只接受 design|chat）：
        ```
        odc project create --name "<项目名> Design" --skill <skillId> --design-system <designSystemId> --json
        ```
        输出过滤 `[plugins]` 后取 **`.project.id`**（不是顶层 projectId），后续 2A、2B 的 `<projectId>` 都指这个。
        Phase 1 第 7 步已判定方向已经拍板（DESIGN.md 判据清楚、用户明确授权）时跳过 2A，建完项目直接进 2B 用既定方向出全稿；仍需要比较方向时才走 2A 再进 2B。

    [2A：方向样张（可选，先选方向再出全稿）]
        跳过条件见 [共同入口]；只在方向仍待定或用户要求比较时执行。
        1. 发起方向样张 run：message = design-prompt.md 的 DESIGN.md 与设计计划部分 + 「只做首屏（SCREEN-1）的三个完整视觉方向，各自独立成一个 section 并排：三者在密度、字重、动效暗示、品牌气质上明显不同，都遵守同一套 token 与 Don'ts；用真实内容；单文件离线」
           ```
           odc run start --project <projectId> --agent claude --message "$(cat direction-prompt.md)" --json
           ```
        2. 轮询到 `succeeded` 且 `exitCode == 0`（判据同 2B），取 `resolvedDir/index.html` 复制到 `demo/directions/`
        3. 让用户在浏览器里看三个方向选一个（或一主一辅），把选择与理由写进 design-plan.md；无 odc 时用文字各描一句画面让用户选
        4. 没有方向被选中 → 按用户的反馈改 design-plan.md 重出一次，不第三次

    [2B：全稿生成]
        1. 用 [共同入口] 取到的同一个 `<projectId>` 发起生成 run：
           - 走过 2A（比较过方向）→ prompt = 完整 design-prompt.md + 「按用户选定的方向 N」
           - 跳过了 2A（方向已由 DESIGN.md / 用户授权拍板）→ prompt = 完整 design-prompt.md，直接按该既定方向构造；不写「方向 N」——没有 2A 就没有编号可指，既定方向本身已经写在 design-prompt.md 里
           ```
           odc run start --project <projectId> --agent claude --message "$(cat design-prompt.md)" --json
           ```
           取顶层 `runId`（出 HTML 走 agent，用 claude/codex 的 CLI 登录态即可，不需要额外 image key）
        2. 轮询直到完成（异步，几分钟级）：
           ```
           odc run info <runId> --json | grep -v '^\[plugins\]'
           ```
           - `status: running` → 继续等，每 30-60s 一次，向用户报进度
           - `status: succeeded` → **别轻信，继续核 `exitCode`（必须 == 0）**。succeeded+exitCode≠0 = 假成功
           - `status: failed` 或 exitCode≠0 → 读 events 日志定位真因（鉴权/agent 报错都在这）：
             `~/open-design/.od/runs/<runId>/events.jsonl`，别盲目重试
        3. 取产物：`odc project info <projectId> --json | grep -v '^\[plugins\]'` 取顶层 `resolvedDir` → 产物 = `<resolvedDir>/index.html`
        4. 验收（见下）→ 进 Phase 3

    [2C：Google AI Studio 手动（兜底）]
        1. 将 `design-prompt.md` 完整原文输出给用户（已含完整视觉规范，AI Studio 无需 design-system）
        2. 提示用户：「打开 aistudio.google.com，把上面 prompt 整段粘进去生成；完成后把生成的完整 HTML 原样拷回来」
        3. 用户回传 HTML → 写入项目 `demo/index.html`
        4. 验收（见下）→ 进 Phase 3

    [验收]（两路统一，客观判据，对照 [第一性原则]；逐条跑，不凭看）：
        - **完整无截断**：含 `</html>`、`<style>`/`<script>` 配平、正常收尾（硬判据，不是体积）✓
        - **离线自包含**：无 `cdn.`/`unpkg.`/`googleapis` 字样——但这只是必要不充分的第一遍，字符串没命中不等于零外部请求：SVG 的 `xmlns="http://www.w3.org/2000/svg"` 是命名空间不算，纯文字说明里的链接不算，真正要看的是会实际发起请求的 `<script src>`/`<link>`/`@import`/fetch 目标。ui-audit 只渲染截图不监听网络请求，证明不了零外部请求，这一项明确写「未验证：是否发出外部网络请求未查」，不能因为字符串检查过了就宣称完全离线 ✓
        - **页面覆盖**：grep Brief 里每个 SCREEN 的页面名或功能关键词都在 ✓
        - **八态覆盖**：grep 每页的空 / 加载 / 错误等状态文案（Brief 写了什么就查什么）✓
        - **token 一致**：产物里出现的 hex 值全部在 DESIGN.md 的 colors 里（`grep -o '#[0-9a-fA-F]\{6\}' | sort -u` 对照），多出来的要么改回 token 要么说明理由 ✓
        - **模拟边界属实**：产物里声明的模拟行为（不真的发送 / 同步 / 扣款 / 持久化）与实际代码行为一致，不存在表面成功但什么都没发生却没声明的按钮；每个可能改变结果的动作能重置，同一任务能反复试走 ✓
        - **UI 审计**（渲染审计）：`node .claude/scripts/ui-audit.mjs demo --themes light --widths 1280,390 --out demo/ui-audit --strict`（DESIGN.md 有深色 token 时 `--themes light,dark`）→ 溢出 / 折行 / 对比度 / 空白渲染为零；无引擎时 rc 3，报告注明「UI 审计缺席」，不冒充通过 ✓
        - **任务试走**（任务审计，见 [任务试走方法]，与 UI 审计并列、不互相替代）：挑 1-2 个 Spec/Brief 里的真实任务目的，参与者或 Agent 自演带目的走一遍，看认不认得入口、懂不懂结果、断了能不能接上；发现按来源回填 Brief/Spec/design-plan.md；没有可用参与者时写明是 Agent 自检 ✓
        - **AI 通病自检**：ui-audit 的 `genericTells` 与人工过一遍 style-vocabulary 清单（ALL-CAPS 小标签、中点串、按钮尾巴「→」、一律圆角、每段淡入、奶油底陶土橙）——命中的说明留或改 ✓
        - **质量地板抽查**：有可用浏览器时实际 Tab 一遍主流程看焦点可见、缩到 390px 看有无横向滚动、开 `prefers-reduced-motion` 看动画是否停（ui-audit 已覆盖溢出类结构检查，其余需要人工操作）；没有可用浏览器时明确写「未验证：键盘 / 窄屏 / reduced-motion 未查」，不能拿字符串或结构检查冒充体验验证 ✓
        - 体积仅参考：多页面应用通常 >20KB；极简单页可低至几 KB，不据此判失败（<3KB 才警惕空壳）
        验收失败 → 调 prompt 重新生成（A 路重新 run / B 路让用户重生成），或在 odc web UI 手动迭代；同一失败两轮无新证据 → 停下向用户报阻塞

[Phase 3：交付]
    [落地]
        - 2B（odc）：`cp <resolvedDir>/index.html <项目根>/demo/index.html`
        - 2C（AI Studio）：用户回传的 HTML 已在 Phase 2 写入 `demo/index.html`，跳过
        - 提交交由用户或主 Agent 决定何时提交：本 Skill 不自动 `git add`/`git commit`，产物落盘即止，版本控制是独立的授权动作

    输出完成报告：

    "✅ 设计稿已生成（Open Design 一套出 HTML）

     **产物**：demo/index.html（N KB，可交互，单文件自包含；[离线自包含已核实 / 是否发出外部网络请求未验证，见下方「未验证」]）；方向样张 demo/directions/（用户选定方向 N，或「方向已拍板，跳过 2A」）；设计计划 demo/design-plan.md
     **skill / design system**：<skillId> / <designSystemId>（token 以 DESIGN.md 为准）
     **验收**：页面 N/N 覆盖、八态 N/N、token 一致 ✓、模拟边界属实 ✓、UI 审计 [通过 / 缺席（无引擎）]、任务试走 [场景 N，参与者/Agent 自检，结果概述]、通病自检改了 X 处
     **未验证**：<按 [验收] 里逐条写「未验证」的项列出，没有就写「无」>

     ---

     **给开发**：编码照此 demo 实现，颜色字号圆角只用 DESIGN.md token；原型里标注的模拟边界（哪些是假的后端行为）在真实实现时要替换成真实调用。
     **给领导/干系人评审**：浏览器直接打开 demo/index.html，可点可交互，这就是最终成品的样子；试走结果与未验证项见上。

     编码参照优先级：demo/index.html（最高）→ DESIGN.md（token）→ Design-Brief.md（行为）→ Product-Spec.md

     调用 /dev-planner 制定开发计划，设计稿作为 Phase 拆分和编码实现的核心参照。"

[画布模式]
    用户主动点名 Claude Design 时的路：前期功课一步不省，全稿换成画布上的一组画板，由执行本 Skill 的 Agent 直接画。画板源文件是编码的一部分，必须拉回本地进配置库（用户 2026-10-13 定），只留在画布上或只留一个链接不算交付。
    1. Phase 1 的 1-11 步照走，只跳过第 5、6 步——选基底与选 skill 是 odc 的东西；账号下挂了设计系统的按画布类型自带的说明安装，没挂的 token 全部来自 DESIGN.md。第 10 步的 prompt 不必落盘，design-plan.md 照写
    2. 建画布：用会话的 Artifact 工具按 Design 类型新建，标题用「<项目名> 设计稿」；画板文件格式、布局与发送方式以该类型随建随带的说明为准，本 Skill 不复述，格式变了以它为准
    3. 工作目录定在仓库里：`demo/canvas/` 当根，索引与画板都在其下的 `project/`，不用会话暂存目录——画布类型说明里「只放暂存、不提交」那句在本项目不适用，以本条为准
    4. 方向仍待定时先出方向：首屏三个方向各一张画板并排，用户选定后把选择与理由写进 design-plan.md，落选的两张从画布与 `demo/canvas/` 一并撤掉；已拍板的跳过
    5. 出全稿：Design-Brief 每个 SCREEN 一张画板，默认态之外 Brief 写了的状态各补一张、挨着本页排成一行，行首用标题注明页面名；真实内容与样本数据同 [第一性原则]，颜色只用 DESIGN.md token
    6. **拉回本地**：画完列出画布上的全部文件，把 `project/` 下的逐个读回 `demo/canvas/project/`，再对一遍——画布上有的本地都有、内容一致，才算落地；对不上的以画布上的现状为准重拉，不拿本地旧稿盖过去。之后有人在画布页面上手工改过，下次改稿前同样先拉回再动，改完再拉一遍，仓库里的与画布上的不许两样
    7. **让本地打得开**：画板靠同目录的 `./support.js` 渲染，这个文件画布上不在 `project/` 里——把画布文件清单里的 `artifact-type/dc-runtime.js` 读回来存成 `demo/canvas/project/support.js`；再写一页 `demo/canvas/index.html`，按画布索引的顺序列出每张画板的标题与链接。这两个文件只在本地、不往画布上发，上一步的核对不算它们。然后用浏览器实际打开至少一张画板，看到内容渲染出来才算数；双击打不开时在 `demo/canvas/` 下起一个本地静态服务再开。画布类型换了运行文件名或加载方式、本地渲染不出来时如实报「本地暂时打不开」，不拿画布链接顶替
    8. 验收：[验收] 里页面覆盖、八态覆盖、token 一致、AI 通病自检四项对 `demo/canvas/project/` 下拉回来的源文件照查；完整无截断改查每张画板文件正常收尾；离线自包含改查画板里除运行文件外有没有别的外部请求（引了在线字体的如实写明）；任务试走由 Agent 对着画板顺序自演并注明是自检；模拟边界一项只在画板带可操作控件时查。质量地板抽查在本地打开的画板上做。UI 审计只收目录、只打开其中的 index.html，一次审不了一组画板：要审就把单张画板连同 support.js 另放一个目录、画板改名 index.html 后对该目录跑，没这样跑的画板写「UI 审计未覆盖」，不冒充通过
    9. 入库与留痕：`demo/canvas/` 整个目录与 design-plan.md 列进交付报告的待提交清单，随这一次设计稿的提交入库，不许被 .gitignore 挡掉；画布链接写进 progress.md（链接默认只有建它的人能开，要给别人看由用户自己在画布页面上分享）。要整套流程连起来点着走的交互稿时另走 [逻辑沙盘入口] 或 odc，画布不顶替
    10. 输出交付话术：

    "✅ 设计稿已上画布并拉回本地（用户点名 Claude Design，走的画布模式）

     **产物**：`demo/canvas/`（索引 + N 张画板源文件 + 运行文件 + 目录页，已与画布核对一致，本地已实际打开过，待提交）；画布链接 <链接>（私有，看稿用）；设计计划 demo/design-plan.md
     **验收**：页面 N/N 覆盖、八态 N/N、token 一致 ✓、通病自检改了 X 处、任务试走 [场景 N，Agent 自检，结果概述]
     **未验证**：<UI 审计未覆盖的画板、没查的键盘 / 窄屏 / reduced-motion 等逐条列出，没有就写「无」>

     ---

     **给开发**：编码照 demo/canvas/project/ 下的画板源文件实现，颜色字号圆角只用 DESIGN.md token。
     **给领导/干系人评审**：浏览器打开 demo/canvas/index.html 逐张看；要并排看整体、直接批注就开画布链接（需先在画布页面上分享），批注改完会再拉回仓库。

     编码参照优先级：demo/canvas/ 画板（最高）→ DESIGN.md（token）→ Design-Brief.md（行为）→ Product-Spec.md

     调用 /dev-planner 制定开发计划，设计稿作为 Phase 拆分和编码实现的核心参照。"

[提示词模式]
    没有 odc、或用户主动要提示词时的另一条路：前期功课一步不省，只是 HTML 换成用户拿提示词去别处生成。
    1. Phase 1 的 1-11 步照走，只跳过第 6 步——选 skill 是 odc 的东西，没有 odc 就没这回事；第 5 步选基底直接按 [视觉方向 → design system 映射] 的表挑，不跑 `design-systems list`；第 7 步「已拍板则跳过 2A」这半句不适用（提示词模式没有 2A/2B 之分），只保留划覆盖矩阵那部分。第 11 步没有 Phase 2 可进，换成下面第 3 步的交付话术
    2. 第 10 步构建出来的那份 prompt 就是产物，与 odc 路只差两点：落盘到 `demo/design-prompt.md`，不写临时文件；「DESIGN.md 原文」那一项后面补上 DESIGN.md 硬约束节整表
    3. 输出交付话术：

    "✅ 设计提示词已生成（本机没有 odc，走的提示词模式）

     **产物**：demo/design-prompt.md（整段可粘）；设计计划 demo/design-plan.md
     **覆盖**：页面 N/N、八态逐页写明、真实样本数据 N 组；参照基底 <designSystemId>（token 以 DESIGN.md 为准，提示词里已写明覆盖）

     ---

     把 demo/design-prompt.md 整段粘到任意生成工具（网页版 Claude、v0、Lovable 等），生成的单文件 HTML 存回 demo/index.html。
     存好回来说一声，我按 [验收] 过一遍质量地板，再跑 `node .claude/scripts/ui-slop-scan.mjs` 复核。"

[初始化]
    执行 Phase 1 第 1 步。
