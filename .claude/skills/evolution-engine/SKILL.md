---
name: evolution-engine
description: 当 session 初始化时自动触发，或用户说"帮我看看有没有该升级的规则"、"检查进化建议"时手动触发。由 evolution-runner sub-agent 调用。
context: fork
agent: evolution-runner
---

[任务]
    扫描 .claude/feedback/ 中的积累，识别三类进化信号：
    1. 规则毕业：未毕业、未跳过的 feedback 过现状核查与实证门槛 → 提议写进目标 skill / 规则（不按出现次数，见第一步）
    2. Skill 优化：某 Skill 来源的未毕业 feedback 聚到同一个环节 → 提议调整 Skill 对应段落
    3. 新 Skill 提议：某操作模式反复出现但无 Skill 覆盖 → 提议创建新 Skill

    有信号 → 生成提议返回给主 Agent，由用户确认后执行。
    无信号 → 返回"无进化建议"。

    在哪儿跑决定毕业落在哪儿：
    - 框架仓（cc-base）：扫之前先 `bash .claude/scripts/collect-feedback.sh <下游项目路径…>` 把下游项目的 feedback 收进来（frontmatter `origin:` 记来源项目），毕业改本仓的 SKILL.md / CLAUDE.md，下游装新版自然带上。
    - 下游项目：项目里的 skills / CLAUDE.md 是清单管的框架副本，往里写下次 setup 就报 conflict——方法类教训（source_skill 非 N/A，或讲的是 AI 怎么问怎么做）只标「待回流 cc-base」留在 feedback，等框架仓收走；项目事实类进 progress.md Decisions，领域口径进 domain/。三个下游项目 35 份 feedback 三个月 0 毕业（2026-10-30 实数），就是落点没分清的样子。

[扫描流程]

    第一步：扫描毕业候选
        读取 .claude/feedback/FEEDBACK-INDEX.md 定位所有 feedback 文件
        读取每个文件的 frontmatter
        筛选：graduated == false 且 skipped != true（不按出现次数——计数这条路试过，43 条里 39 条恒为 1，从没有人去加，2026-09-12 删掉了该字段）
        每条先做**现状核查**再谈裁定：去 CLAUDE.md / rules/*.md / 相关 SKILL.md / agents 实际 grep 关键词，判三种结果——已逐字成文（哪怕措辞不同）→ 以既成事实毕业，点名落在哪个文件哪一段并给行号，不新增任何东西；部分成文 → 点名已成文的那半与缺的那半；压根没有 → 才进落地提案。
        **实证门槛**：提落地之前问一句「这条实际造成过什么代价」——feedback 正文里有真事故（返工、空转、被冻结的功能、重复争议）才提；只有「用户当场纠正」而没有代价记录的，判「暂不成文」并把理由写进该条 frontmatter 与索引，下次扫描不重新裁定。依据是 CLAUDE.md [开发测试规则]「闸靠数据留，不靠感觉留」——规则和闸同理，没有实证的规则只是又一条没人遵守的自觉条款。
        确定毕业目标：
        - source_skill 明确 → 毕业到对应 SKILL.md
        - 涉及多个 Skill 或全局性 → 毕业到 CLAUDE.md [总体规则]

    第二步：检查 Skill 优化信号
        按 source_skill 分组未毕业 feedback，3 条以上指向同一个环节（按主题聚类判，不按条数堆——已毕业条目不计，那些教训已落进规则，再算进来只会重复提议）→ 提议改该 Skill 的对应段落。
        scores 字段不再当信号：下游三个项目 35 份 feedback 没有一份填过（2026-10-30 实数），靠它判「评分持续偏低」永远判不出来；模板里保留该字段只作记录。

    第三步：检查新 Skill 信号
        筛选：同族主题跨 3 条以上 feedback 反复出现，且不属于任何已有 Skill 的覆盖范围
        → 标记为"新 Skill 候选"

    第四步：生成提议
        有信号 → 生成结构化提议（见 [提议格式]）
        无信号 → 返回"无进化建议"

[提议格式]
    "**进化建议**（共 N 条）

     **规则毕业**（X 条）
     1. [feedback 标题]（来源：[source_skill]；origin：[下游项目，本仓自产写 local]）
        建议写入：[目标文件] 的 [目标位置]
        内容摘要：[一句话]
        -- 确认 / 跳过

     **Skill 优化**（X 条）
     1. [Skill 名称]：[N] 条未毕业 feedback 指向 [环节]
        优化建议：[具体建议]
        -- 确认 / 跳过

     **新 Skill 提议**（X 条）
     1. [操作模式描述]：跨 [N] 条 feedback 反复出现
        -- 确认创建 / 跳过"

[确认后执行]
    用户逐条确认或跳过：
    - 规则毕业 → 将 feedback 内容写入目标 SKILL.md 或 CLAUDE.md，标记 graduated: true；带 origin 的条目在回执里列出来源项目与文件名，由人回下游把那份也标毕业（下游副本不会自动同步）
    - Skill 优化 → 修改对应 SKILL.md
    - 新 Skill → 调用 skill-builder 创建
    - 跳过 → 标记 skipped: true，不再重复提议

[返回格式]
    返回给主 Agent：
    - 有提议："有 N 条进化建议待处理"+ 完整提议内容
    - 无提议："无进化建议"
