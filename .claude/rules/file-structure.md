---
paths:
  - ".claude/**"
  - "Product-Spec.md"
  - "DEV-PLAN.md"
---

本文件由 CLAUDE.md 下沉；主控命中指针时必须完整读取本文件再行动，不得凭指针行猜测内容。

[文件结构]
    project/
    ├── Product-Spec.md                    # 产品需求文档
    ├── Product-Spec-CHANGELOG.md          # 需求变更记录
    ├── Architecture-Design.md             # 架构设计文档（可选，M/L 档项目）
    ├── DFX-Spec.md                        # DFX 质量属性设计（可选，与架构设计配套）
    ├── Design-Brief.md                    # 设计规范文档（可选，体验脊柱：信息架构 / 页面规格 / 八态 / 文案 / 可访问性）
    ├── DESIGN.md                          # 视觉 token 与规则（可选，与 Design-Brief 配套，Google design.md 规范，代码直接读 token）
    ├── DEV-PLAN.md                        # 分阶段开发计划
    ├── domain/                            # 领域口径库（可选，副产品；一域一文件，见 .claude/rules/domain-rulings.md）
    ├── docs/design/                       # 设计详述（可选，一个复杂模块一份 <模块名>-设计.md：规则编号 + 代码位置 + 常量 + 测试，见 .claude/rules/design-detail.md）
    ├── <project-name>/                    # 项目代码（以项目名命名的子文件夹）
    │   ├── src/
    │   ├── package.json
    │   └── ...
    ├── .gitignore
    └── .claude/
        ├── CLAUDE.md                      # 主控
        ├── settings.json                  # hooks 等 Claude Code 配置
        ├── rules/                         # 主控下沉的细则（file-structure / workflow-orchestration / dev-workflow-details / subagent-dispatch / memory-systems / domain-rulings / design-detail；harness-large-repo / quality-attributes 随 --with-harness 装进来）
        ├── hooks/                         # 闸门钩子（stop-gate / no-direct-code-guard / tdd-gate / pre-commit-check / three-file-sync-gate / dangerous-pkill-guard / secret-exfil-guard / precompact-gate / release-gate / harness-async-verify / notify / session-rules-banner 等，全部 .mjs，node 单运行时，共用逻辑在 hooks/lib/）
        ├── harness/                       # 核心只剩 harness.mjs + lib/{core,tier}.mjs + profile.json（档位表）+ exclusions.json + audit/；大仓治理引擎在 harness/ext/（含 ext/rules/ 两份细则），目标项目默认不装、setup --with-harness 才装，module-catalog.json 放置即启用
        ├── workflows/                     # Workflow 编排脚本（code-review-fanout.js）
        ├── agents/
        │   ├── implementer.md             # 实现者 Sub-Agent（编码）
        │   ├── code-reviewer.md           # 审查者 Sub-Agent（审查）
        │   ├── tester.md                  # 测试者 Sub-Agent（写测/跑测，独立于实现者）
        │   ├── deployer.md                # 部署者 Sub-Agent（打包/部署）
        │   ├── feedback-observer.md       # 反馈观察 Sub-Agent
        │   ├── evolution-runner.md        # 进化引擎 Sub-Agent
        │   ├── domain-recorder.md         # 领域口径 Sub-Agent
        │   └── progress-recorder.md       # 项目记忆 Sub-Agent
        ├── EVOLUTION.md                   # 进化引擎
        ├── feedback/                      # 经验教训
        ├── scripts/                       # 质量脚本（doctor 自检 / plan-lint / predev-lint 前期五文档闸 / ui-audit 设计稿渲染审计 / fast-mode 开关 / gate-audit / collect-feedback 收下游 feedback / progress-archive 归档搬运 / design-trace 设计详述规则 ↔ 测试 ↔ 常量核对 / statusline 状态行 / supervisor 进程守护）
        ├── tests/                         # 框架自测三十来套（selftest 引擎自测 / 安装器与跨平台 / hook 行为与注册面 / 档位 / 闸与证据层红锁 / 审计脚本 / 发布装配 / 前期文档闸与设计稿审计），每套头一行标 `# risk:`，cases/run-all.sh 统一跑（默认 high，`--level all` 跑全）——清单以目录实际内容为准，不在本文件逐个列
        └── skills/
            ├── product-spec-builder/      # 需求收集
            ├── arch-designer/             # 架构设计（不变量 + 模块划分 + C4 + ADR + 押后决定；templates 含设计详述模板）
            ├── dfx-designer/              # DFX 设计（13 维质量属性定档 + 合规扫描 + 威胁表）
            ├── design-brief-builder/      # 设计规范（Design-Brief.md + DESIGN.md，references 含风格词汇表 / 质量地板 / Agent 交互模式）
            ├── design-maker/              # 设计图制作（odc 为主，点名时走 Claude Design 画布或提示词；方向样张 + 两遍法 + ui-audit 验收）
            ├── dev-planner/               # 开发计划
            ├── dev-builder/               # 项目开发
            ├── bug-fixer/                 # Bug 修复
            ├── code-review/               # 代码审查
            ├── test-builder/              # 系统测试
            ├── release-builder/           # 构建发布
            ├── red-blue-review/           # 红蓝对抗审查
            ├── branch-finisher/           # 开发分支收尾
            ├── skill-builder/             # 创建新 Skill
            ├── feedback-writer/           # 记录用户反馈
            ├── evolution-engine/          # 进化引擎扫描
            ├── domain-rulings/            # 领域口径库入口（四象限分诊 / 查 / 待复核 / 手工收录）
            ├── progress-recorder/         # 项目记忆维护（sub-agent 调用）
            ├── record/                    # /record 入口：派 progress-recorder 合并本轮增量
            ├── archive/                   # /archive 入口：跑 progress-archive.mjs 归档
            └── recap-project/             # /recap-project 入口：恢复项目上下文
