# Development Plan — 人读文档

> 记录这项框架能力的开发阶段、当前进度和剩余工作。需求来源 docs/readable-spec/Product-Spec.md，架构 docs/readable-spec/Architecture-Design.md，行为契约 docs/readable-spec/phase1-db-contract.md（第一期）与 phase2-spec-contract.md（第二期）。

## 开工前置

- [默认] 条目：REQ-DOC-001 的两条细则（每张表列哪几样、一张图只画一组表）与 REQ-DOC-006 的两条细则，小样出来请用户挑错。
- 待定「接手方是否要求 Word / PDF」「客户审核用什么语言」：押后到首份文档交出去之前，期间只出中文网页。
- 待定「conflation 的文档在哪台机器上生成」：第一期的小样在本机那份副本上跑、产物放仓外，不动那个仓；正式生成前再定。

---

## Phase 1: 数据库设计 ✅（2026-11-23，CONCERNS：残留 #142）

**交付内容**：
- 维护者跑一条命令，从项目的建表定义读出每张表，生成按组切开、带关系图的数据库设计页面
- 页面标明每段内容的来历，读不出的定义明着列出来
- 每张表上能看到哪些文件在写它、读它
- AI 写的表用途与字段含义经命令落盘并盖指纹，来源变了自动标「待更新」
- 一条核对命令报出页面与来源的不一致

**验证的假设**：
- 只读建表定义的文本、不连真库，就能合并出现行表结构（技术未知）——拿 conflation 的 schema.sql 实跑，取出的表数要等于原文行首的 77 条建表；117 条加列（行首 105 条）每一条要么加出了新列、要么是重申已有列被跳过、要么列在清单里；17 个 `DO $$` 块里碰表结构的 16 个全部出现在「未合并」清单里（2026-11-23 实数）
- 从字符串里的 SQL 能推出「谁写谁读」（技术未知）——在小样上抽十张表人工核对，漏报不超过两成
- [默认] 没有项目判断时按表名前缀分组，读者看得懂——小样给用户看

**关键文件**：
- `.claude/scripts/readable-docs.mjs` — 入口与子命令
- `.claude/scripts/readable/model.mjs` — 实体、锚点、指纹（owner：Task 1.1）
- `.claude/scripts/readable/sources/sql-ddl.mjs` — 建表定义的取事实器
- `.claude/scripts/readable/render/db.mjs`、`.claude/scripts/readable/render/layout.mjs` — 数据库设计页面与共用版式
- `.claude/scripts/readable/sources/code-scan.mjs`、`.claude/scripts/readable/links.mjs` — 代码里对表的写读与关联
- `.claude/scripts/readable/notes.mjs` — 配置、项目判断、说明的读写
- `.claude/scripts/readable/check.mjs` — 核对器
- `.claude/skills/readable-docs/SKILL.md` — 什么时候跑、待办怎么补、说明怎么写

**Task 清单**：
- **Task 1.1：建表定义的取事实器与配置（REQ-DOC-001）** — 新建 `readable-docs.mjs`（`init` 与 `build --facts-json`）、`readable/model.mjs`、`readable/sources/sql-ddl.mjs`；按契约 A、B 节；验证 `node .claude/scripts/readable-docs.mjs build --facts-json --root <conflation 副本>` 报出的表数、未合并块数
  - Business Context：接手团队第一步看数据库设计，conflation 约一百张表没有任何说明；建表文件是 77 条 CREATE、117 条 ADD COLUMN、17 个 `DO $$` 块（2026-11-23 实数）。区分例子：`ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT` 而表里已有这一列 → 保留原定义、不重复；`DO $$` 里的 `ALTER` → 进「未合并」清单，不合并
  - 依赖类型：功能前置无；验证前置＝conflation 的 schema.sql（只读，拷到临时目录）
  - 证据产生者：HIGH 档——implementer 自检，tester 独立写测；code-reviewer 整期一轮（四步走第 1 步），依据用户 2026-09-22 给脚手架仓定的快速开发模式
- **Task 1.2：数据库设计页面与原子落盘（REQ-DOC-001、REQ-DOC-011）** — 新建 `readable/render/db.mjs`、`readable/render/layout.mjs`，`readable-docs.mjs` 加 `build`；按契约 C 节；验证对同一来源跑两次 `build` 后 `diff -r` 无差异
  - Business Context：读者只有浏览器、可能离线，每页要自成一体；页面是生成物，同样的来源必须生成同样的文件，否则每次提交都是噪音。区分例子：一组 30 张表 → 切成三页，每页的关系图不超过 12 张表
  - 依赖类型：功能前置＝Task 1.1（要它的文档模型）；`readable-docs.mjs` 的唯一 owner 是 Task 1.1，本 Task 只加 `build` 分支
  - 证据产生者：HIGH 档——同上
- **Task 1.3：谁写谁读、代码里建的表、项目判断（REQ-DOC-001、REQ-DOC-005）** — 新建 `readable/sources/code-scan.mjs`、`readable/links.mjs`，读 `docs/readable-src/map.json`；表页加「谁在写」「谁在读」、小关系图与「服务的需求：未关联」，按项目判断分组；按契约 F 节；验证在小样上抽十张表人工核对。谁写谁读先到文件这一层，到模块那一层等第二期定了模块怎么分再接
  - Business Context：成功判据 SC-1 要求说清每张表谁写谁读；conflation 的 SQL 全写在字符串里（非测试代码 161 处 INSERT、77 处 DELETE、29 处 UPDATE、11 处走 `copy_records_to_table`），18 处表名是运行时拼的要明示；有两张主库的表只在代码里建；按表名前缀分组会把最核心的几张表甩进「其它」（它们的前缀下都只有一张表），所以要能按业务分组（2026-11-23 实数）
  - 依赖类型：功能前置＝Task 1.1、1.2
  - 证据产生者：HIGH 档——同上
- **Task 1.4：说明的落盘、指纹与待更新（REQ-DOC-006）** — 新建 `readable/notes.mjs`，入口加 `pending`、`note put`、`note confirm`、`note drop`；表页、组页、清单显示说明与状态，敏感字样隐去；按契约 G 节；验证改一张表的列之后重跑，原说明带「待更新」，只加一个索引则不带
  - Business Context：说明只能经命令落盘、指纹由命令盖，AI 碰不到指纹；锚点不存在的拒收；规格把「生成物里不出现密钥、内网地址与账号」定为 P0
  - 依赖类型：功能前置＝Task 1.2、1.3（同改表页与入口，排在 1.3 之后）
  - 证据产生者：HIGH 档——同上
- **Task 1.5：核对器的数据库部分（REQ-DOC-007）** — 新建 `readable/check.mjs`，`build` 改为先核临时目录再替换；按契约 H 节；验证手工改坏一页后 `check` 退出码 1 并点名
  - Business Context：核对器不读渲染器的任何中间结果，自己重新取事实、自己从页面反读，否则渲染器吞了字它看不见
  - 依赖类型：功能前置＝Task 1.1～1.4
  - 证据产生者：HIGH 档——同上

**验收标准**：
- 对 conflation 的副本跑 `build`，每张表一页，浏览器离线能开，用户看过小样
- 假设成立的证据：取出的表数与原文一致；16 处碰表结构的运行时定义全部列在「未合并」；十张表的写读抽查漏报不超过两成
- `check` 在未改动时报不一致 0 条，改坏任一页或改了建表定义而未重出时退出码 1

---

## Phase 2: 人读版需求规格（2026-11-23 代码与一轮审查完成，CONCERNS：复核轮未做、残留 #142；小样待用户看）

**交付内容**：
- 维护者跑同一条命令，Product-Spec.md 被逐块投影成按章切开的网页：标题、列表、表格、引用各归各位，长条目分句显示，有序步骤配步骤图
- 一个字不加、一个字不少：核对命令逐块把页面读回来与来源比，少一块、多一块、错一个字都点名到行
- 来源里的内网地址与密钥样式的字样在页面上隐去

**验证的假设**：
- 一份没有按模板写的、四百多 KB 的老规格也能切得一块不丢（技术未知）——拿下游那份 757 行、最长一行 7397 字的规格实跑，切块的还原自检过、`check` 报 0 条
- [默认] 长条目分句显示之后读得下去——出小样给用户看
- [默认] 内网地址隐去并标出、核对按隐去后的文字比——用户三次没有回话，按主 Agent 的建议当默认，用户可否决

**关键文件**：
- `.claude/scripts/readable/sources/md-blocks.mjs` — Markdown 切块与还原自检
- `.claude/scripts/readable/render/spec.mjs` — 需求规格的页面
- `.claude/scripts/readable/check-spec.mjs` — 零丢失那一项（`check.mjs` 调它）
- `.claude/scripts/readable-docs.mjs` — 接上新来源与新页面（owner：Task 2.2）

**Task 清单**：
- **Task 2.1：Markdown 切块（REQ-DOC-004）** — 新建 `readable/sources/md-blocks.mjs`，`build --facts-json` 多出 `spec`；按第二期契约 A、B 节；验证拿下游那份规格跑，报块数与还原自检的结果
  - Business Context：用户最早要的就是这一份——开发看、客户也会审的需求规格，硬约束是「只能从 Product-Spec.md 生成」「1:1 对应」「不能有丢失」；切块丢一个字，后面排得再好也是错的。区分例子：一条列表项下面缩进更深的三行，两行是子项、一行是续行 → 子项各成一块，续行并进父项的文字
  - 依赖类型：功能前置无；验证前置＝下游那份规格（只读，拷到仓外的小样工作区）
  - 证据产生者：HIGH 档——implementer 自检，tester 独立写测；code-reviewer 整期一轮
- **Task 2.2：需求规格的页面与零丢失核对（REQ-DOC-004、REQ-DOC-006、REQ-DOC-007、REQ-DOC-011）** — 新建 `readable/render/spec.mjs`，`check.mjs` 加一项，入口接上；按第二期契约 C、D 节；验证手改一个字后 `check` 点名到行
  - Business Context：核对器不信出页面的代码，自己把页面读回来比——出页面时吞了一个字，重出一遍两边错得一样看不出来。区分例子：一条 300 字的条目分句显示成 6 行 → 页面读回来的文字与来源相同，核对 0 条
  - 依赖类型：功能前置＝Task 2.1（要它的块）
  - 证据产生者：HIGH 档——同上

**验收标准**：
- 对下游那份规格跑 `build`，每个二级标题一页，浏览器离线能开，用户看过小样
- 假设成立的证据：还原自检过；`check` 报不一致 0 条；手改页面一个字、从来源删一条而不重出，`check` 各退出码 1 并点名
- 页面里搜不到来源中的 8 处内网地址

---

## Phase 3: 架构设计（2026-11-23 六个 Task、一轮整期审查与修复都已完成，CONCERNS：复核轮未做、残留 #145；小样待用户看）

**交付内容**：
- 维护者跑同一条命令，得到一份架构文档：系统由哪几个模块组成、分几层，每个模块管什么、有哪些文件、对外提供哪些接口与名字、依赖谁、被谁依赖、读写哪些表
- 文件、引用、接口、读写的表都从代码里机械取；文件怎么归成模块是项目判断（AI 提议、人确认），每个模块管什么是 AI 写的说明，页面上分得开
- 数据库设计的表页连到模块页，模块页连到表页
- 现有的架构文档逐块换排成网页，标明是旧文档

**验证的假设**：
- 只读源码文本、不跑代码，就能把文件之间的引用解析准（技术未知）——下游后端 371 个文件实测，解析出的边数与用语言自带的语法树算出来的对一遍（2026-11-23 摸底：1058 条、没解析到 2 条），随机抽 20 条人看
- [推断] 平铺在一个目录下的 165 个文件，能照引用关系与文件头说明归成十几到二十几个模块，分出来的图接手的架构师看得懂——出小样给用户看；划分全部标「AI 提议」
- [默认] 模块多于 12 个时总图只画层与层之间的线，模块自己的关系看它那一页——出小样时看这样读不读得下去

**关键文件**：
- `.claude/scripts/readable/sources/code-imports.mjs` — 文件清单、文件头说明、引用边
- `.claude/scripts/readable/sources/code-routes.mjs` — 接口
- `.claude/scripts/readable/links.mjs` — 归成模块、汇总依赖与读写的表（owner：Task 3.3）
- `.claude/scripts/readable/notes.mjs` — `module:` 与 `doc:arch` 两种锚点与切片（owner：Task 3.3）
- `.claude/scripts/readable/render/arch.mjs` — 架构的页面
- `.claude/scripts/readable/check-arch.mjs` — 架构那一项核对
- `.claude/scripts/readable-docs.mjs` — 接上新来源与新页面（owner：各 Task 依次，串行）

**Task 清单**：
- **Task 3.1：文件清单、文件头说明与引用边（REQ-DOC-002）** — 新建 `readable/sources/code-imports.mjs`，`build --facts-json` 多出 `code.files`、`code.edges`、`code.unresolved`、`code.dynamic`、`code.skipped`；按第三期契约 B 节「文件」「引用」；验证拿下游后端实跑，边数与语言自带语法树算出来的逐条对
  - Business Context：接手团队第二步看架构；现在那个项目的架构文档停在三个月前，代码早已走远。引用关系是整份架构文档的地基——错一条边，模块图就画错一条线。区分例子：`from .store import save` 写在 `app/api/jobs.py` 里 → 一条从 `app/api/jobs.py` 到 `app/api/store.py` 的边，名字 `save`；同一行写在文档串里 → 不算
  - 依赖类型：功能前置无；验证前置＝下游后端的源码副本（只读，仓外小样工作区）
  - 证据产生者：HIGH 档——implementer 自检，tester 独立写测；code-reviewer 整期一轮
- **Task 3.2：接口（REQ-DOC-002）** — 新建 `readable/sources/code-routes.mjs`，`build --facts-json` 多出 `code.routes`；按契约 B 节「接口」；验证拿下游后端实跑，226 个接口取全、完整路径拼对
  - Business Context：模块「对外提供什么」里最要紧的就是 HTTP 接口；前端与测试的人拿接口清单对着找代码。区分例子：路由器前缀 `/api/jobs`、装饰器路径 `/{id}/retry` → 完整路径 `/api/jobs/{id}/retry`；前缀是变量 → 完整路径记 null 并明说
  - 依赖类型：功能前置无（与 3.1 共用词法，串行在 3.1 之后）
  - 证据产生者：HIGH 档——同上
- **Task 3.3：模块的项目判断、汇总与说明（REQ-DOC-002、REQ-DOC-005）** — `map.json` 的 `modules` 与 `layers`，`links.mjs` 汇总出 `arch`，`notes.mjs` 加两种锚点与切片，`pending` 给模块的上下文，`init` 起草 `archDocs`；按契约 A 节、B 节「汇总成模块」、C 节；验证四种对不上的情形各自点名
  - Business Context：平铺的目录读不出模块，硬按文件名前缀猜就是把推断当事实；所以划分是项目判断，AI 只许写「提议」。区分例子：一个文件被两个模块的通配同时匹配 → 归第一个，首页「项目判断里对不上的」两个都点名
  - 依赖类型：功能前置＝Task 3.1、3.2（要它们的事实）
  - 证据产生者：HIGH 档——同上
- **Task 3.4：架构的页面与核对（REQ-DOC-002、REQ-DOC-005、REQ-DOC-006、REQ-DOC-007、REQ-DOC-011）** — 新建 `readable/render/arch.mjs`、`readable/check-arch.mjs`，表页标模块，入口接上；按契约 D、E 节；验证加一个文件不重出、手改页面，`check` 各自点名
  - Business Context：架构师从总图点进一个模块，要一页看全它管什么、接口、依赖、碰哪些表；开发从一张表的页面要能跳到写它的模块。区分例子：没有架构这一份的项目，数据库设计的页面与现在逐字节相同
  - 依赖类型：功能前置＝Task 3.3
  - 证据产生者：HIGH 档——同上
- **Task 3.5：现有架构文档的逐块投影（REQ-DOC-002）** — `archDocs` 里的每一份照人读版需求规格的办法换排成网页，零丢失核对同样管它；按契约 D 节末段、E 节
  - Business Context：代码里看不出「为什么这么分」，那些话在旧的架构文档与决策记录里；规格要求取来并标明出处——整份原文换排、顶上写明是旧文档，比摘录更不会断章取义
  - 依赖类型：功能前置＝Task 3.4（页面的入口）；复用第二期的切块与核对
  - 证据产生者：MEDIUM 档——implementer 自检加 tester 补臂
- **Task 3.6：下游全量小样（验证假设）** — 在仓外小样工作区给那个下游项目提模块划分（全部 `proposed`）、写 `module:` 与 `doc:arch` 的说明，`check` 到 0 条，截图给用户看
  - Business Context：第一期也是这样验的——机制对不对，要在真项目上铺开才看得出（上次铺开时翻出生成器漏了 87 条守卫式约束）。划分与说明只留在仓外和那个项目自己的仓里，不进本仓
  - 依赖类型：功能前置＝Task 3.4；验证前置＝仓外小样工作区
  - 证据产生者：主 Agent 提划分、派 Sub-Agent 写说明，主 Agent 亲看页面

**验收标准**：
- 对下游那个项目跑 `build`，每个模块一页，浏览器离线能开，用户看过小样
- 假设成立的证据：引用边与语法树算出的逐条相同或差异逐条有解释；模块划分全部标着「AI 提议」；`check` 报不一致 0 条
- 改一个模块的文件清单不重出、手改页面上一条接口，`check` 各退出码 1 并点名

---

## Phase 4: 接进开发流程（2026-11-25 八个 Task、一轮审查与修复都已完成，CONCERNS：复核轮未做、Task 4.5～4.8 没过审查轮、残留 #147）

**交付内容**：
- 装了框架的项目照常开发，人读文档自动跟着生成、跟着更新：需求规格一生成就出人读版；配置跟得上后来出现的建表文件与代码目录；计划、派单、编码、审查、收尾、发版各带着文档的那一份
- 项目的状态里报得出文档到哪了；框架升级之后提示页面要重出
- readable-docs 技能写明两种走法（跟着开发走、存量一次补齐），带上在真项目上用过的派单模板、说明范例、报数行怎么读

**验证的假设**：
- [推断] 只靠技能与规则里的文字，一个没参与过的实现者接到普通的开发 Task，会把这次新加的表、列、模块的说明当场补上并让 `check` 回到 0 条——在合成的小项目上派一单看
- [推断] 主 Agent 一侧同样只靠文字：一个全新的会话接到「开发某个 Phase」，开发计划里一个字不提人读文档，会在开工前起头、派单前记基线、派单里带上文档那一条、验收时亲跑 `check`——在合成的小项目上起一个全新的会话看（2026-11-24 已验，成立）
- [确认]（2026-11-24 用户「认，默认出人读文档」；此前标的是默认）装了框架的项目默认出人读文档，用户明说不出的才不建——机械的两步不花钱，说明只对新加、改到的负责；用户可否决

**关键文件**：
- `.claude/scripts/readable/init.mjs` — `init --suggest`
- `.claude/hooks/lib/readable-refresh.mjs` — 提交前顺带提醒配置漏项
- `.claude/scripts/project-status.mjs`、`.claude/scripts/doctor.sh` — 状态与升级后的提示
- `.claude/skills/readable-docs/` — 技能正文与三份参考文件
- `.claude/rules/dev-workflow-details.md`、`.claude/skills/dev-builder/SKILL.md` 等八处 — 流程里的落点
- `.claude/scripts/page-shots.mjs` — 看页面：把页面截成图给 Agent 读
- `.claude/tests/cases/dev-flow-carries-readable-docs.sh` — 真跑用例：全新会话照常开发，文档跟没跟上（默认不跑）
- `.claude/scripts/collect-feedback.sh`、`.claude/scripts/collect-feedback-docs.mjs` — 回流时每个下游项目报一行文档状态

**Task 清单**：
- **Task 4.1：配置跟上项目、状态与升级提示（REQ-DOC-006）** — `init --suggest`、提交前提醒、`project-status` 的「人读文档」一行、`doctor.sh` 的不同步提示；按第一期契约 I 节第 5、10、11 条
  - Business Context：用户 2026-11-24「你是让后续的，Agent开发过程能正常，自动生成这些文档」。新项目的配置是在还没有代码时起草的，之后没人把建表文件与代码目录填进去，文档就一直是空的而没人知道
  - 依赖类型：无前置
  - 证据产生者：MEDIUM 档——implementer 自检加 tester 补臂
- **Task 4.2：流程里的落点与技能补全（REQ-DOC-006）** — 交付、开发、发版三个阶段与计划、派单、实现者、审查五处各补一句；readable-docs 技能加 [跟着开发走] [交给用户]、小样先行、升级后重出，三份参考文件；按契约 I 节第 4、6～9 条
  - Business Context：盘点结果——流程里只接上了提交前重出与 dev-builder 一节，没有谁来起头，计划、派单规则、审查、发版都不提；分批写说明、提模块划分的做法只在一次会话的派单里
  - 依赖类型：功能前置＝Task 4.1（文字里提到的命令要先有）
  - 证据产生者：主 Agent 直接写（文档类），都是在原句上增补
- **Task 4.3：真触发用例（REQ-DOC-006）** — 一句没提技能名的大白话触发 readable-docs；并进路由对
  - Business Context：技能写得再全，触发不了等于没有
  - 依赖类型：无前置
  - 证据产生者：tester；本机跑不了真会话时如实写没跑过
- **Task 4.4：在合成项目上验一遍正常开发（验证假设）** — 一个只有需求规格的小项目：起头两步 → 派一位实现者做「加一张表与一个接口」→ 看配置提醒、说明、页面、`check`、状态各是不是自己跟上了
  - Business Context：用户在乎的是技能——「我在乎的不是生成的文档，是你的skill」。主 Agent 自己会做不算数，要看没参与的实例只凭技能与规则做成什么样
  - 依赖类型：功能前置＝Task 4.1、4.2
  - 证据产生者：主 Agent 搭夹具、派单、亲看结果；卡住的地方回头补进技能
- **Task 4.5：看页面的工具（REQ-DOC-006）** — 新建 `.claude/scripts/page-shots.mjs`，用本机已有的浏览器把点名的页面切成一段一段的图；技能里「亲眼看页面」指到它；按第一期契约 I 节第 12 条
  - Business Context：技能要求出完文档亲眼看页面，而框架里现成的页面审计要装 playwright——没参与过的 Agent 在没装的机器上只能跳过这一步或者谎称看过。最贵的错是没看成却报看过，其次是留下僵尸浏览器
  - 依赖类型：无前置
  - 证据产生者：MEDIUM 档——implementer 自检加 tester 写契约测试；没过审查轮，主 Agent 亲跑验收
- **Task 4.6：全新会话照常开发一个小 Phase（验证假设，REQ-DOC-006）** — 合成的小项目（第一期已做完、第二期待开发，计划里不提人读文档）上起一个全新的会话，只说「开发 Phase 2」；看起头、基线、派单、说明、验收、入库各是不是自己跟上了；把这次验证固化成默认不跑的用例 `.claude/tests/cases/dev-flow-carries-readable-docs.sh`
  - Business Context：用户 2026-11-24「你是让后续的，Agent开发过程能正常，自动生成这些文档」。Task 4.4 验的是实现者一侧；起头、派单、验收这些是主 Agent 的事，子 Agent 不能再派子 Agent，只有全新的会话才演得了主 Agent。存量项目的开发计划都是这个功能之前写的，所以计划里故意不提
  - 依赖类型：功能前置＝Task 4.1、4.2、4.5
  - 证据产生者：主 Agent 搭夹具、起会话、亲自在跑完的项目上核对；用例由 tester 写，断言对着录下来的那一次离线核、各条先红
- **Task 4.7：下游的文档状态随回流一起报（REQ-DOC-006）** — `collect-feedback.sh` 给每个下游项目多报一行「人读文档」的状态，没跟上的行首标 `!`；进化引擎的技能里写明把它当信号；按第一期契约 I 节第 13 条
  - Business Context：用户 2026-11-24「这个持续搞吧」——真实项目上的验证持续做。下游各自的会话照常开发，文档应当自己跟上；框架这边要能持续看到跟没跟上，不靠谁想起来去每个项目里跑一遍。最贵的错是某个下游的文档悄悄不同步而框架这边一直不知道
  - 依赖类型：功能前置＝Task 4.1（状态与配置检查的机器可读输出）
  - 证据产生者：MEDIUM 档——implementer 自检加 tester 写契约测试；没过审查轮，主 Agent 亲跑验收并对本机在用的下游仓干跑一遍
- **Task 4.8：结构变坏当场提醒（REQ-DOC-006）** — 只读子命令 `readable-docs.mjs structure` 从架构首页读回结构；提交前自动重出的那一段在放行的那一回与上一个提交比，新多出来的循环依赖（含已有的一组里文件对数变多）、越层引用、未归属的文件、超过 1000 行的文件当场点名，只提醒不拦；回流那一行带上结构的数与近 7 天提醒的次数；按第一期契约 I 节第 14 条
  - Business Context：用户 2026-11-24「文档既代码，文档乱说明代码乱，说明设计不合理，说明架构在腐化，一切都暴露在阳光下，无处躲藏」。这几个数本来就照实列在架构首页上，但从 3 变成 4 没有人会去翻页面；流程文字里的「不许悄悄变坏」只靠验收时人比数。最贵的错按先后：新逻辑把提交弄坏；该提醒的没提醒；不该提醒的乱提醒
  - 依赖类型：功能前置＝第三期的读回标记、Task 4.7 的回流那一行
  - 证据产生者：MEDIUM 档（碰提交前钩子的库）——implementer 用 opus 加 tester 写契约测试；没过审查轮，主 Agent 逐行读了钩子库的改动、亲跑四套测试、做了三处突变、在合成项目上重放

**验收标准**：
- 合成项目上那一单做完：页面里有新加的表与接口，新表、新列有说明，`check` 报不一致 0 条，`project-status` 报得出这些数
- 假设成立的证据：实现者的回执里带着 `check` 的末行，说明是它自己补的、没有人提醒；没补的话记下它卡在哪一句，改技能后重派一次
- 没有人读文档配置的项目，提交、状态、自检的输出与这一期之前逐字相同
- 全新会话那一次做完：`check` 不一致 0 条，新表有说明，`pending` 的缺口不比开工前多，页面已入库、工作树干净；事件日志里看得到开工前的起头、派单里的那一条、主会话验收时亲跑的 `check`

---

## 范围外（本次不计划）

- REQ-DOC-005 里「需求连到模块与文件」的那一半：已押后——第五期；机械推不出，要 AI 提议、人确认
- REQ-DOC-003：已押后——第五期；算法规则只投影设计详述，补哪些模块由主 Agent 提名单给用户划
- REQ-DOC-008：已押后——第五期（测试设计）
- REQ-DOC-009：已押后——第五期（上手指南），要有人真跑一遍
- REQ-DOC-010：已押后——第五期（业务入门）

---

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 生成器 | Node.js 内置模块 | 与框架现有脚本同 | 不引第三方依赖 |
| 产物 | 静态 HTML、内联 SVG | — | 浏览器直接打开 |

## 开发规则

- 每完成一个 Phase 走四步走：Code Review → 测试完整性 → 编译验证 → 功能测试
- 四步走全部通过才算 Phase 完成
- Commit message 格式：`phase-N: 简要描述`
