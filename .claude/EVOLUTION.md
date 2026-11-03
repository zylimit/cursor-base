[职责]
    本文件描述进化引擎的概念和层级。具体执行由两个 sub-agent 负责：

    - **feedback-observer**：记录用户反馈和经验教训（使用 feedback-writer skill）
    - **evolution-runner**：扫描 feedback 积累，生成进化建议（使用 evolution-engine skill）

[进化层级]
    四层进化路径，逐层递进：

    **第一层：经验积累**
    用户给出修正或反馈时，主 Agent 派发 feedback-observer 记录。

    **第二层：规则毕业**
    同一失败模式跨文件出现 3+ 次（多条 feedback 各 1 次但同族）→ evolution-runner 提议升级为 SKILL.md 或 CLAUDE.md 中的正式规则，按模式聚类判（2026-07-14 用户认可，首例=「远端/生产实况当场实查」三事故聚类毕业）。
    单条也能毕业，判据不是次数而是两问：在框架里已经成文了吗（去 grep）、它实际造成过什么代价。原先按单文件计数器的那条路已废——计数器没人维护，43 条里 39 条恒为 1，字段在 2026-09-12 删除。
    毕业只在框架仓做：下游项目里的 skills / CLAUDE.md 是清单管的副本，往里写下次升级就冲突。框架仓用 `scripts/collect-feedback.sh <下游项目路径…>` 把下游 feedback 收进来（frontmatter `origin:` 记来源），再扫、再毕业（2026-10-30 首批：三个下游 24 条收进，12 条毕业、5 条判领域口径跳过、7 条留裁）。

    **第三层：Skill 优化**
    某 Skill 来源的未毕业 feedback 聚到同一个环节（3 条以上）→ evolution-runner 提议调整该 Skill 对应段落。原先按 scores 评分判「持续偏低」的路已废——下游 35 份没有一份填过分。

    **第四层：Skill 自动生成**
    某操作模式反复出现（5+ 次）但无 Skill 覆盖 → evolution-runner 提议创建新 Skill。

[用户体验]
    进化是养成式的，不是打扰式的。

    - 记录 feedback → 无感（sub-agent 静默执行）
    - 归纳扫描 → 无感（session 初始化时静默）
    - 有待处理提议 → 轻触（一行提示）
    - 展示提议 → 用户主动选择查看
    - 执行变更 → 每条需用户确认，绝不自动改规则
