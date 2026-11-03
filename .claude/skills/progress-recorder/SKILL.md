---
name: progress-recorder
description: 当出现重要决策/硬约束/完成事项/明确的新任务时，或 /record /archive 指令触发时，由 progress-recorder sub-agent 调用。
user-invocable: false
---

[任务]
    接收主 Agent 传入的「对话增量（delta）+ mode」，对项目记忆文件执行原子操作：
    1. **增量合并（record）**：语义抽取 delta，将新增/变更信息按区块合并进 progress.md
    2. **快照归档（archive）**：progress.md 条目过多或显式触发时，把历史 Notes/Done/Decisions 原文搬迁至 progress.archive.md，保持主文件精简

    不进行用户交互，专注完成单一明确的原子任务。语言：中文。

[文件位置]
    - **progress.md**：项目根目录（与 Product-Spec.md 同级），不放 .claude/（避免混入独立配置库 sitemaster-config）。
    - **progress.archive.md**：同目录，仅在归档时创建/追加。
    - 路径由主 Agent 在 payload 中提供「项目根路径」，默认当前项目根。

[模式判断]
    - 指令含「增量合并任务」或 `/record` → 执行 [增量合并]（启用语义抽取与置信度闸门）
    - 指令含「快照归档任务」或 `/archive` → 执行 [快照归档]
    - 同轮同时出现 `/record` 与 `/archive` → 先 [增量合并] 再 [快照归档]

[技能]
    - **语义抽取**：依据语义而非关键词，识别 Constraints（Pinned 候选）、Facts（环境地址 / 端口 / 路径 / 基准数据，进 Context Index）、Decisions、TODO、Done、Risks/Assumptions、Notes
    - **高置信判定**：仅在明确表达强承诺时才写入 Pinned/Decisions（标准见 [增量合并] 第二步）
    - **稳健合并**：以区块为单位增量合并，格式一致、顺序稳定、最小扰动
    - **去重与对齐**：基于语义相似度与标识符去重更新，避免重复条目
    - **TODO 管理**：维护优先级（P0/P1/P2）、状态（OPEN/DOING/DONE）、唯一标识符（#ID 单调递增不复用）
    - **证据追踪**：为 Done 或重要变更附证据指针（commit/issue/PR/路径/链接）

[总体规则]
    - 高置信判定：仅当含确定性语言时才写 Pinned/Decisions；否则降级 Notes 并标 "Needs-Confirmation"
    - 受保护区块（Pinned/Decisions）不可自动修订或删除；检测到潜在冲突 → 记录于 Notes（含建议与理由）
    - Pinned 封顶 15 条：满了要加新条，先把最弱的一条降级成 Decision 或与同类合并，不是继续追加——Pinned 是每次 recap 必读的那一小段，长了就没人真读；`progress-archive.mjs` 跑时超 15 会报一行，报了就在本轮归并降级，不留到下次
    - Decisions 追加前先做取代检查：新条与现存哪条冲突、推翻或收窄了它，旧条末尾标「→ 被 <日期> 取代」；149 条里只有 3 条标过取代（2026-09-15 实数）就是没做这一步的样子，没做取代检查的追加不算完成
    - Decisions 属于某模块算法规则（阈值、先后顺序、例外）、且项目有 docs/design/ 对应设计详述时：规则正文由主 Agent 写进设计详述，这里只追加一行指针 `- 日期: <模块> <编号> <一句话> → docs/design/<模块名>-设计.md`，不把判据抄两份；拿不准是否已写进设计详述的，在 Notes 记「待同步设计详述」交主 Agent
    - 合并 TODO 执行去重：语义相似则更新原条目；无匹配则新增并分配新 ID（= 现存最大编号 + 1，未指定优先级默认 P1）；已关闭的 TODO 会被搬进归档，TODO 段末「归档指针」行里记着「已归档最大编号」，取它与正文现存最大编号里大的那个再加 1——编号不重用
    - 自动识别 Done（"完成了/实现了/修复了/上线了/已部署/已发布"等完成语义）并尽量附证据指针
    - 所有新增条目追加日期戳（YYYY-MM-DD）
    - 历史保护：仅在归档任务中对 Notes/Done/Decisions 执行原文搬迁；Pinned 与未关闭的 TODO 永不搬（已关闭的 TODO 见 [快照归档]）、搬走的原文一字不改；**progress.archive.md 只增不删，保持完整历史**
    - 输出完整 Markdown，可直接覆盖写入目标文件

[模板]
    [progress.md 模板]
        # Project: <name>
        _Last updated: <YYYY-MM-DD>_

        ## Pinned（仅高置信"必须遵守"写入；受保护不可修订）
            - <关键约束/接口要求/依赖版本/目标环境>（依据：<为什么有这条——用户原话 / 事故 / 外部约束>；适用范围：<哪些情况适用、哪些不适用>）

        ## Decisions（按时间顺序追加，历史不可改；三要素缺一不算决策）
            - <YYYY-MM-DD>: <决定或规则>（依据：<为什么这么定、否掉了什么>；适用范围：<适用 / 不适用的情况>；取代：<被取代的旧决策日期或「无」>）
            - <更早日期>: <旧决策>（…）→ 被 <YYYY-MM-DD> 取代

        ## TODO（权威待办清单）
            - [P0][OPEN][#1] <任务>（Owner：<可选>，Context：<路径/链接>）

        ## In Progress
            - [P0][DOING][#3] <任务>（Owner：<可选>，Context：<路径/链接>）

        ## Done（最近完成的放前面）
            - <YYYY-MM-DD>: [#4] <任务>（evidence：<commit/issue/PR/路径/链接>）

        ## Risks & Assumptions
            - Risk：<风险描述>（Mitigation：<缓解措施>）
            - Assumption：<假设>（Confidence：High/Med/Low）

        ## Notes（简要要点）
            - <YYYY-MM-DD>: <简短记录>
            - Needs-Confirmation：<待确认事项简述>

        ## Context Index（轻量索引）
            - Archive：./progress.archive.md（若存在）

    [progress.archive.md 模板]
        # Project Archive: <name>
        _Last updated: <YYYY-MM-DD>_

        ## Archived Notes
            - <YYYY-MM-DD>: <原文搬迁的 Notes 条目>

        ## Archived Done（最近完成的放前面）
            - <YYYY-MM-DD>: [#<id>] <任务>（evidence：<...>）

        ## Archived Decisions（倒序，原文搬迁）
            - <YYYY-MM-DD>: <决定或规则>（依据 / 适用范围 / 取代）

[增量合并]
    第一步：文件检查与初始化
        - 检查 progress.md 是否存在且含全部区块（Pinned/Decisions/TODO/In Progress/Done/Risks & Assumptions/Notes/Context Index）
        - 缺失则按模板初始化或补全
        - 扫描现有 TODO 确定最大 ID
        - 记录操作日期（YYYY-MM-DD）

    第二步：语义抽取与分类
        从 delta 提取并按语义分类：
        • Pinned 候选：含"必须/不能/要求/强制/禁止/务必/严格要求"等长期约束；服务器地址、端口、容器名、目录路径、基准数据文件这类环境事实不是约束，进 Context Index——下游一份 progress 的 Pinned 数到 51 条、多数是这类事实（2026-10-30 实数），recap 时没人真读
        • Decisions：含"决定使用/最终选择/将采用/确定方案/敲定"等确定性决策，以及用户的纠正（"不是这样/以后都/别再"）——纠正是最硬的决策，必须带「取代」
        • TODO：可执行行动项（"需要/应该/计划/待/要"+ 具体任务）
        • Done：含"完成了/实现了/修复了/上线了/已解决/已部署/已发布/搞定了"等
        • Risks：含"风险/可能导致/担心/潜在问题"
        • Assumptions：含"假设/前提/基于/依赖于/期望"
        • Notes：其他或无法高置信分类的内容

        高置信判定：含弱化词（可能/也许/大概/似乎/建议/考虑/或许）→ 自动降级 Notes + 标 "Needs-Confirmation"；边界情况保守处理（宁降级不误升级）

    第三步：区块级合并
        - Pinned：仅追加高置信约束，每条带依据与适用范围（delta 里没有就写「依据：用户原话，范围未说明」，不编）；与旧条冲突时新条写清取代哪条，旧条末尾追加「→ 被 <日期> 取代」，原文不删不改
        - Decisions：按时间追加，不改历史；每条三要素（依据 / 适用范围 / 取代）；新决策推翻旧项时旧项末尾追加「→ 被 <日期> 取代」标记，不再把修正关系赶进 Notes
        - TODO：语义去重（相似更新原条目，新任务分配递增 ID），支持状态推进
        - Done：识别完成项移入，尽量附证据指针
        - Risks & Assumptions：追加新识别项
        - Notes：记要点、待确认、冲突提示

    第四步：一致性验证与输出
        - 检查 TODO ID 唯一与单调
        - 验证受保护区块未被意外修改
        - 更新 "_Last updated: YYYY-MM-DD_"
        - 返回完整 progress.md 内容

[快照归档]
    第一步：阈值检查 —— Notes 与 Done 合计 > 100 条，或 Decisions > 30 条，或已关闭（DONE / 完成）的 TODO > 20 条，或显式 /archive 时执行；三组各判各的，哪组超线搬哪组
    第二步：归档执行
        - 搬运交给脚本，不手工搬：你没有 Bash，搬一条上千字的条目等于把原文当参数重敲一遍——2026-09-19 两次归档都撞轮次上限没做完，各花二十多万 token，其中一次丢了条目。发现超线就停在这里，回报主 Agent「哪组超线、现有几条」，由主 Agent 跑 `node .claude/scripts/progress-archive.mjs`（先写归档、从磁盘重读核对、再删正文，可重跑）。脚本不在（老安装）才按下面几条手工搬
        - Notes / Done 各保留最新 35 条，Decisions 保留最新 24 条，已关闭的 TODO 保留编号最大的 10 条（`OPEN` / `部分完成` / `明确不做` 永不搬），其余原文搬迁至 progress.archive.md 对应段。保留线压在触发线下面一截，是为了归档完不贴着线、下一条记录又触发
        - 先写归档、后删正文：要搬的条目先原文追加进 progress.archive.md，再拿每条开头的「日期 + 标题」逐条到归档里搜一遍，全部搜到了才从 progress.md 删；有一条搜不到就一条都不删，回报里写明缺哪条。反过来先删后写，中途被轮次上限截断就是永久丢失——2026-09-19 真丢过三条 Decisions，靠 git 里的旧版本才找回；被挤出去的若是当轮刚写、还没提交的条目就找不回了，而 recap 默认不读归档，没人会发现
        - 归档里已经有的条目不重复追加：上一轮搬到一半被截断，这一轮接着搬，结果与一次搬完相同
        - 搬过的段末尾留一行指针：脚本写的固定以「（归档指针：」开头，记累计条数与最近一次，TODO 段那行另记已归档最大编号；手工搬的写明搬走条数与日期区间，Decisions 段另注「仍在生效的硬约束已在 Pinned」。主 Agent recap 默认不读归档
        - 受保护区块（Pinned 与未关闭的 TODO）不参与归档
        - progress.archive.md 只增不删；本批条目整体插在对应段最前面（段内最新在上），批内顺序与正文一致
    第三步：文件管理
        - archive 不存在则创建；缺哪一段就在文件末尾新建哪一段
        - 更新 progress.md 的 Context Index archive 指针
        - 更新两文件时间戳；**严禁删除或修改 archive 中任何历史记录**
    第四步：返回精简后的 progress.md + 更新后的 progress.archive.md

[返回格式]
    返回给主 Agent 一行摘要（agent 据此回报）：
    - record："记录到 progress.md：[区块] +N 条 / 更新 M 条"（无有效信号 → "无新进度"）
    - archive："归档 N 条到 progress.archive.md，progress.md 现存 M 条"；交给脚本搬的写 "超线：<哪组> 现有 N 条，请跑 progress-archive"

    自检要点：
    1) progress.md 含全部模板区块、顺序正确、时间戳为当前日期
    2) Pinned/Decisions 仅因高置信语言追加；Decisions 每条有依据、适用范围、取代三要素，被取代的旧条有「→ 被取代」标记
    3) TODO #ID 唯一且单调，去重正确
    4) Done 尽量附证据指针，未提供时不虚构
    5) 归档时 archive 已创建、内容为原文搬迁、搬走的每一条都已在归档里搜到后才从正文删、Context Index 已更新
