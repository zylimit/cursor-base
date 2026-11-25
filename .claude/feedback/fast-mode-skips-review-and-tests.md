---
type: feedback
description: 用户回绝「fast 档也记待审清单」，原话「不改，快速模式就是尽可能不测试，不检视」；fast 档改完构建通过即部署本机 8765，不派 reviewer / tester、不跑测试；发版前按 git diff 补审补测兜底（用户确认「可以，发版前补审补测」）
created: 2026-11-02
updated: 2026-11-02
graduated: true  # 2026-11-08 毕业既成事实→.claude/CLAUDE.md [档位] fast 行、skills/dev-builder/SKILL.md fast 档短链
source_skill: N/A（发版收尾汇报里主 Agent 提的档位配置建议，不在 Skill 执行中；被修正的做法属 dev-builder 快速迭代流程）
scope: ARIANE 项目；harness 处于 fast 档时的日常改动与本机 8765 部署
exceptions: standard / strict 档仍先审后部署；发版（/release-builder：打内网包、推 tag）不在 fast 档做，发版前按 git diff 对上次发版以来全部改动补审补测（用户确认「可以，发版前补审补测」）；数据迁移、线上 bug 在 fast 档要不要审，用户没单独说，按原话字面不审，由发版前补审兜底（未说明）
supersedes: review-before-deploy-even-in-fast-mode.md 的「快速模式也不例外」部分（scope「不论当前档位」、标题后半句、教训第 3 条、落点建议 1 与 2）；progress.md Pinned 2026-11-02 第一条「快速模式不再跳过审查直接部署本机 8765」一句
applied_to: progress.md Pinned 2026-11-02 第一条已标该句被取代；progress.md Decisions 末尾 2026-11-02「快速模式就是尽可能不测试、不检视」新条（含用户确认「可以，发版前补审补测」）；harness profile.json 不改（mark-review-needed 的 fast 仍为 off）；review-before-deploy-even-in-fast-mode.md 已标被本文件修正
origin: OFR-ARIANE-claude
---

# 快速模式就是尽可能不测试、不检视；审查与测试的兜底放到发版前

**问题描述**：0.16.0 内网升级完成后，主 Agent 在汇报末尾请用户拍板 review-before-deploy-even-in-fast-mode.md 的落点建议 1：把 profile.json 里 mark-review-needed 的 fast 由 off 改 on，让快速模式下的改动也进待审清单，发版闸才拦得到没审过的改动。用户回绝：「不改，快速模式就是尽可能不测试，不检视」。主 Agent 回复时说明发版前仍按 git diff 补审补测，用户确认：「可以，发版前补审补测」。

**触发场景**：同日早些时候 /release-builder 被 release-gate 以待审清单未清拦下，用户说「后面全部要审计部署，最好测试」。主 Agent 把这句外推到快速模式下的本机部署，写进 Pinned（「快速模式不再跳过审查直接部署本机 8765」），旧 feedback 也记成「快速模式也不例外」，并给出改档位表的落点建议。0.16.0 发版前按 git diff v0.15.0..HEAD 全量补审补测，查出 H1（REQ-PLN-010 迁移每次启动改回人工完成的 POI issuing）；内网升级成功后主 Agent 请用户就落点建议 1 拍板，得到上述回复。

**教训/建议**：
- 用户原话是在某个具体场景说的，适用范围先按那个场景收窄。「后面全部要审计部署」说在发版被拦时，外推到快速模式的本机部署之前该先问一句；这次没问，Pinned 与旧 feedback 都写宽了。发版这一层用户已确认：「可以，发版前补审补测」；standard 档先审后部署沿用 Pinned，用户没再表态。
- 快速模式的口径以本次原话为准：fast 档改完、构建通过就部署本机 8765；不派 code-reviewer / tester，不补测试，也不跑全量测试。部署照旧先在线备份库、起来后核查服务与页面（progress.md Decisions 同日条），这是部署验收，不算测试。
- 兜底在发版（用户已确认：「可以，发版前补审补测」）：发版不能在 fast 档做（CLAUDE.md [档位]：release 装配在 fast 生效时 tier 项直接 FAIL）。/release-builder 之前按 git diff <上次发版 tag>..HEAD 对全部改动补审补测，不以待审清单为准——fast 档下清单本就不记。0.16.0 就是这样查出 H1 的。迁移类在上一已发布版库形态上的演练算这一步补测的一部分（主 Agent 的理解，用户没单独点到）。
- 被回绝的建议不再提：fast 档也记待审清单、[档位] fast 一行补「HIGH 档先审后部署」。evolution-engine 扫到旧条落点建议 1、2 时，不据此再出进化建议。

**适用范围与例外**：按这条来：用户说「快速开发模式」等、harness 切到 fast 档期间的日常改动与本机 8765 部署。不按这条：standard / strict 档（按 Pinned 先审后部署，旧 feedback 教训第 1、4 条仍适用）；发版前（补审补测，用户已确认，见上）；用户当轮对某次改动另有要求时按铁律 7。数据迁移、线上 bug 这类本属 HIGH 档的改动，在 fast 档要不要审用户没单独说，按原话字面不审，由发版前补审兜底。

**本次落地**：progress.md Pinned 2026-11-02 第一条标「快速模式不再跳过审查」一句被取代；Decisions 末尾加 2026-11-02「快速模式就是尽可能不测试、不检视」新条（三要素齐，取代该句，写入用户确认「可以，发版前补审补测」）。harness profile.json 不改。review-before-deploy-even-in-fast-mode.md 的 updated 加「被本文件修正」，标题下加一行写明作废与仍有效的部分；FEEDBACK-INDEX.md 加本条、旧条描述同步。skill / rule 本体不动：CLAUDE.md [档位] fast 一行「流程侧不自动派 tester / reviewer、不受四步走约束」本就与用户口径一致。
