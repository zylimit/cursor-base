---
name: dev-builder
description: 当 DEV-PLAN.md 就绪、用户说要开始写代码或继续开发下一个 Phase 时使用。
---

[任务]
    **初始化模式**：无代码 + 有 DEV-PLAN.md → 搭项目骨架、装依赖、配开发环境，完成 Phase 1。
    **持续开发模式**：有代码 + 有 DEV-PLAN.md → 按 Phase 逐步开发，每个 Phase 走 per-Task review → fix 闭环与四步走验证。

[依赖检测]
    Skill 启动时第一步自动执行。
    必需：Product-Spec.md、DEV-PLAN.md、DEV-PLAN 技术栈表里列的系统工具与运行时；缺了提示先补（缺 Spec 提示 /product-spec-builder，缺 Plan 提示 /dev-planner）。
    可选（缺了标降级模式继续，不阻塞）：Design-Brief.md、DESIGN.md（有则 token 直接进主题配置，不凭感觉配色）、设计工具 MCP、gh CLI、playwright。
    必需依赖缺失或版本不够，自己判断安装方式直接装；要用户权限或交互认证的才提示用户。
    进已有项目或脚手架先读它自带的 AGENTS.md / CLAUDE.md，按项目的规矩来，不用自己的默认覆盖。

[第一性原则]
    **修改纪律**：改代码前先评估影响范围（这个改动会牵动哪些现有功能，列出来），改完回归验证。删或改一个被多处引用的东西（常量、导出、内置数据、组件、接口、文案）前，先 grep 全项目列出所有引用点、一次性同步清理，别只改定义留下游脱节。改完跑全套测试（类型检查 + 单测 + e2e），类型检查过不代表单测 / e2e 不挂。改的东西若会被持久化（写进 db、本地存储、缓存、配置文件），要连存量数据一起管——加启动迁移或做兼容，否则老数据变成「代码已删、却顽固显示、还删不掉」的僵尸；删持久化数据的改动配一条迁移测试。CSS 改动重点查 overflow-hidden 裁切弹出层、z-index 层叠、flex-shrink 布局。
    **范围纪律**：只动当前 Phase 和 Task 范围内的东西。范围外的不碰，哪怕 Spec 里写了该行为。
    **测试隔离**：测试和脚本跑真实 app（起 server、连真实 db、electron launch）必须用独立数据目录，绝不写用户的生产库和配置；新入口对齐既有隔离写法，一个入口漏隔离，测试垃圾就进用户生产库。临时目录在收尾里清掉，别只 close 不删。
    **真实优先**：按钮、数字、卡片必须代表真实数据和真实行为，不写死、不假数据、不留装饰。引入项目里零先例的 UI 元素前先 grep 全项目确认先例，零先例默认不引入。
    **SDK-First**：框架和 SDK 已有的能力不重复造，用之前先确认它是否已支持。
    **联网优先**：用外部库、API 前先 WebSearch 确认当前版本的用法和兼容性，不靠过期记忆。
    **验证即证据（门禁）**：完成声明必须在同一条消息里带上刚跑的验证命令和输出。"之前编译过了"无效，没有当场验证就没有完成。
    **代码精简**：单文件不超过 300 行，超了按职责拆分；三行直白代码好过一个过度抽象。
    **喂模型不截断**：给人看的 UI 摘要可以截断省略，喂给模型和 Agent 的工具结果不许截；长输入扛不住就改精简格式（逐条压成单行），不砍条数。
    **文档回写**：开发中用户改了需求或设计，先回 product-spec-builder / design-brief-builder 更新文档再继续写码，不让代码和文档脱节。

[开发规则清单]
    [代码规范]
        - TypeScript strict，不用 any（用 unknown + 类型守卫）；Python 函数签名标参数与返回类型，复杂结构用 dataclass / TypedDict / Pydantic model
        - 命名：组件 PascalCase，前端函数变量 camelCase，文件 kebab-case，常量 UPPER_SNAKE_CASE；Python 模块 / 函数 / 变量 snake_case，类 PascalCase
        - 每个文件单一职责，副作用（DB、文件、网络）隔离到 hooks / API route / db 层；路由层只做请求解析与响应组装，业务逻辑下沉到 service 或 lib
        - 不裸 except，按异常类型处理，向上抛或转成明确的 HTTP 错误
        - 跟随已有代码库的风格，不强推个人偏好，不做无关重构；YAGNI，不为假想的未来需求写代码

    [视觉与复用]
        - 动 UI 前先读 Design-Brief 和现有公共样式、组件，列出可复用项，禁自造命名空间 override
        - 新页面继承相邻同类页面的语义、交互、危险操作规则，不一页单造一套
        - 复用对齐不止看组件名，要打开邻居基准页面实际对比渲染效果
        - 改完 UI 主动自检渲染边界，不等用户指出：按钮 / 文字不超容器、窄面板不挤爆（多按钮一行先估宽度，挤就拆行或图标化）、危险操作从主操作行分离并按 Brief 加确认
        - 视觉敏感产物（地图边界 / 渲染 / 版式）全量落地前先出一份小样给用户亲眼看过——数据校验过不算过，这一步是视觉闸，不是可选
        - 面向领域专家的界面标签用领域现成说法，不生造术语或缩写，拿不准先问用户

    [质量门槛]
        - 每个功能要有：正常流程、错误提示、加载态、空状态、基本输入校验，且无敏感信息硬编码
        - 长跑批处理设计期就带单任务超时兜底 + 输入侧廉价预检（病态输入直接跳过并记一行，不拖垮整条流水）——事后加等于已经空转过一轮

    [环境与安全]
        - 浏览器可见的前缀变量（VITE_ / NEXT_PUBLIC_）不放密钥，AI 调用一律走服务端
        - .env.example 进 Git，实际值进 .gitignore
        - 不硬编码密钥、绝对路径、个人信息

    [数据库]
        - 表名字段名 snake_case，每表有 id、created_at、updated_at，有默认值的在 schema 里声明 DEFAULT
        - migration 用 ALTER TABLE，执行前查列或表是否已存在
        - 参数化查询防注入，不裸拼 SQL；频繁查询的字段加索引，不滥加

    [Git 工作流]
        - 原子提交：每完成一个独立功能就 commit，一个 commit 一个逻辑变更，不攒到 Phase 结束
        - commit message 前缀：`phase-N:` / `feat:` / `fix:` / `refactor:` / `chore:`
        - 提交门槛：本次改动涉及的栈编译或语法检查通过才许 commit（前端 tsc --noEmit 零错误，后端 ruff check 或 py_compile 通过），由 pre-commit-check 按栈自动卡
        - push 由 hook 处理，保护分支不自动推
        - 宿主或编排层已把工作树钉在某个分支上时，就在这棵树、这个分支上提交，不另开或切换分支；只有自己管工作树时才自行决定开不开分支
        - 工作目录含多个独立 repo 时，各自 add / commit / push 分开执行、各自验收远程状态，不耦合进同一条命令——细则见 feedback/multi-repo-commit-isolation.md

[设计参照]
    参照顺序：设计工具中的设计稿 → DESIGN.md → Design-Brief.md → Product-Spec.md，冲突时前者为准。
    有设计工具 MCP 连接时，每个 Task 前读取涉及页面和组件的精确数值（宽高、padding、gap、字号、字重、颜色、圆角、阴影），每个 Task 都重新读、不凭记忆；编码后读代码实际值逐项对照，有偏差先修再提交。
    无设计工具时以 DESIGN.md 的 token 与 Brief 的 SCREEN 规格为参照，两者都没有就继承项目既有页面的先例，不自由发挥。
    提交前对照 design-brief-builder/references/ui-quality-floor.md 的 MUST 项自查：对比度 ≥ 4.5:1、焦点可见、触控目标够大、Brief 里该页的必需状态都做了。

[Phase 执行流程]
    编码由主 Agent 派 implementer fresh 实例执行，每 Task 一单、跨 Task 默认串行，派单包七字段见 rules/subagent-dispatch.md；主 Agent 只写单 + 验收，不亲手写码。
    Plan（读 DEV-PLAN 该 Phase 与 Spec 相关章节的原文，探索现有代码，写出 Task 拆分，每个页面 / 组件 / 功能一个 Task）→ 每个 Task：读派单包 Business Context（为什么做、谁受益、相关规则与例外；Spec 没写的分支按规则与例外推，推不出来的记为「业务假设」进回执，不静默选一个）→ 读该 Task 的交付清单、Spec 功能描述、设计参照的原文 → 编码 → 自检（代码实际值对设计数值、行为对 Spec、业务含义对 Business Context）→ 按 Task 档位走 rules/dev-workflow-details.md [项目开发阶段] 的三条链：LOW 不派 reviewer、主 Agent 对 diff 与运行器输出验收；MEDIUM 派 code-reviewer 一轮 Stage 0 + 1；HIGH 全三 Stage + tester → 只 HIGH 阻断，修完由同一轮复核一次即收口，Medium / Low 记残留不追 → `echo clean > .claude/.needs-review` → commit → 下一个 Task。
    用户强调某个环节是追加要求，不替换基础流程，review 闭环照常走。
    fast 档（`tier status` 报 fast）走短链：不自动派 reviewer / tester、不进四步走；同一份代码全量测试只跑一次，之后修阻断项只补直接对应的用例、复核只看修的那一处；审查与各道闸的过程不念给用户，只报结论与证据句柄；连续开发期用 `tier set fast --sticky --reason "…"` 到撤销为止，不每 8 小时续一次、不每次向用户报告。standard / strict 不受这段影响。
    反例回流：代码对得上 Spec、Spec 对不上业务规则或例外（那次例外会走错）→ 回执报「需求存疑」+ 反例，不自行改需求。
    领域事实回流：编码中撞见的领域事实（字段的真实格式、真库的实际状态、外部系统的实际行为）带依据写进回执的 Domain findings 栏，没有现场依据的不写。

[Phase 完成度判断]
    所有 Task 完成后过四步走，每步附当场跑出的证据：
    一、Code Review：对照 DEV-PLAN 该 Phase 的交付清单逐项确认，检查有无超出 Phase 范围的改动
    二、测试完整性：计划的功能都实现、无半成品；派 tester 写测（写测 ≠ 被测作者），测要真覆盖到交互层和故障路径，不止纯函数和顺畅路径。每条「绿」要能证明行为真的对——核对用例前提与生产一致（量纲、单位、输入可达性、断言方向），用假前提或不可达输入把缺陷盖成预期的等于没测；功能声明的错误态、空态、边界要有用例真的走到，不只在实现里留分支；存在但没跑的测试算缺；项目有 docs/design/ 设计详述时跑 `node .claude/scripts/design-trace.mjs`，rc 1 记 CONCERNS、缺口清单进残留，rc 2 / 3 是脚本用错或自身出错，修好再跑、不当缺口记
    三、编译验证：前端 tsc --noEmit 零错误；后端 ruff check 零错误，无 ruff 则 python3 -m py_compile 全过；混合栈两栈都验，各自附证据
    四、功能测试：启动 dev server 无错误输出，新功能可用，现有功能未破坏；有 Playwright 测核心交互流程，无则 curl 查 API 返回再提醒用户在浏览器确认 UI
    中间有任何改动，四步重新来。验证中发现的问题修完用 `fix:` 提交。
    多 Phase / 跨目录的大批量改造收口时，另扫一次重复代码与可提炼逻辑，量化留痕（工具、窗口、克隆数），做或不做都写理由——不等人提醒，也不为了抽象而抽象。
    收尾四态门：PASS 全通过 / CONCERNS 带残留清单前进 / FAIL 停下修 / WAIVED 必须写明理由与批准人——安全与数据丢失类缺口不许 WAIVED。

[初始化模式]
    - 项目代码放在以项目名命名的子文件夹（小写字母 + 数字 + 连字符），规划文档留根目录
    - 按 DEV-PLAN 技术栈表配置，开 TypeScript strict，装依赖，配环境变量
    - git init，.gitignore 排除规划文档、设计资源、环境变量、构建产物，建 private 远程仓库，首次 commit
    - 完成后进入 Phase 执行流程的 Phase 1

[初始化]
    检测项目状态路由：无代码 + 有 DEV-PLAN → 初始化模式；有代码 + 有 DEV-PLAN → 持续开发模式；无 DEV-PLAN → 提示 /dev-planner；无 Product-Spec → 提示 /product-spec-builder。
