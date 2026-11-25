---
type: feedback
description: 快速模式下连续部署 6 个未审改动（含数据迁移），被发版闸拦下才暴露；此后每次部署前必审、尽量补测试，迁移类先在上一版库形态上演练
created: 2026-11-02
updated: 2026-11-02（同日被 fast-mode-skips-review-and-tests.md 修正：「快速模式也不例外」部分作废）
graduated: true  # 2026-11-08 毕业既成事实→同上；其「落地建议 1」用户已回绝，不再据此出建议
source_skill: dev-builder
scope: ARIANE 项目；主 Agent 实现完准备部署（本机 8765 与内网发版都算）之前，不论当前档位；改动含启动迁移 / 改库内容时尤其
exceptions: 未说明（用户原话是「全部」，没给例外）；用户当轮明确豁免单次时按铁律 7 办
supersedes: progress.md Decisions 2026-10-29「快速开发模式…小改动不另派审查 / tester，…直接部署推送」的做法（Pinned 2026-11-02 已取代；读到时该旧条还没标「→ 被取代」）
applied_to: progress.md Pinned 2026-11-02；用户 memory review-before-every-deploy；档位已切回 standard；v0.15.0..HEAD 补审与独立 tester 已派（主 Agent 自述，结果待回）；方法教训尚未写入 skill / rule（pending，落点见末段）
origin: OFR-ARIANE-claude
---

# 部署前必过审查，快速模式也不例外；迁移类先在上一版库形态上演练

> **2026-11-02 修正**（见 fast-mode-skips-review-and-tests.md）：用户回绝下文落点建议 1，原话「不改，快速模式就是尽可能不测试，不检视」。作废：scope 的「不论当前档位」（fast 档除外）、标题后半句、教训第 3 条、落点建议 1 与 2。只在 standard 档适用：教训第 1、4 条。仍有效：教训第 5 条（发版前按 git diff 补审补测，用户同日确认「可以，发版前补审补测」，现为 fast 档改动唯一兜底）；教训第 2 条与落点建议 3（迁移演练，fast 档下放到发版前补测时做）。

**问题描述**：11-01 至 11-02，主 Agent 连续做了 6 个改动（Operation data 标签颜色、Dashboard 确认 = 锁定、图例与去除确认弹框、确认统计条 + 红框开关、OCC 全部推算含一次启动迁移、站点三种状态），其间用户要求了快速开发模式；每个改动实现完就部署到本机 8765，一个都没派 code-reviewer。其中 OCC 那个带启动迁移 migrate_ignore_poi_occ，会清掉库里 POI 来源的约定 OCC 并重排（迁移前先打了快照）。用户随后敲 /release-builder，被 release-gate 拦下：「发布前置闸：待审清单未清（5 个文件待 code review……）」。用户纠正：「后面全部要审计部署，最好测试」。

**触发场景**：下列时间取自拦停账本 .claude/evidence/gate-block.log（UTC）。
- 11-01 13:16 Operation-info 新模板（10 个文件）在 standard 档走了审查（Done 记「审查无 HIGH」），这条路本来是通的。
- 14:24、15:22 两次 stop-gate 提醒「代码已修改但未 code review」（待审 2 个、5 个文件），当时还是 standard 档，15:37 才切 fast；提醒没有被当成停手信号。
- 切 fast 之后 backend/app/api.py 有未提交改动（三文件同步闸 16:29–17:24 五次点名），待审清单却始终是那 5 个 frontend 文件：profile.json 里 mark-review-needed 在 fast 档是 off，fast 期间的改动没登记。release-gate 17:30 报的 5 个文件，全是 fast 之前登记的。
- 17:31 主 Agent 执行 fast-mode.sh off 切回 standard。
- 不是第一次：10-29 至 11-01，release-gate 因待审清单未清拦发版 4 次（账本第 41、74、196、231 行），stop-gate 提醒 20 次；feedback 目录里此前没有关于这件事的记录。

**教训/建议**：
- 顺序：实现 → 审查 → 修 HIGH → 同轮复核 → 部署；「做完直接部署」= 审查通过后部署。审查是硬的（用户原话「全部要」），测试是倾向（「最好」）：能测就派独立 tester 补（写测 ≠ 作者），测不了说明原因。硬软之分同 recommend-follows-literal-hard-constraint.md。
- 迁移类必须在上一已发布版（本次是 0.15.0）的库形态上演练，核对迁移前后行数与关键值，不只在本机已被前序迁移改过的库上试。内网是保留数据升级（Pinned 2026-10-31），真实路径是已发布形态的库一路迁到新版本；本次 OCC 迁移在真库副本上验过（Done 有记录），缺的是几个迁移叠在一起、从 0.15.0 形态走整条链的演练（推断）。
- 定档不因快速模式取消：数据迁移 / 线上 bug / 安全 / > 300 行本就是 HIGH 档（dev-workflow-details.md [项目开发阶段]），快速模式免的是「自动派」，不该免到 HIGH（建议）。
- 提醒不是刹车：20 次 stop-gate 提醒没拦住，拦住的只有地板闸 release-gate。看到「待审文件」提醒就当停手信号，派 reviewer，不攒到发版（建议）。
- 审查范围不能只认待审清单：fast 档下清单会少报，范围以 git diff v0.15.0..HEAD 为准（主 Agent 这次已这样派）。

**适用范围与例外**：见 frontmatter。这是用户给本项目的流程约束，不是通用框架规则。用户原话「全部」没区分改动大小，LOW 档小改动也按字面每次审，要放宽先问用户，不自行取软。本次未正式调 /dev-builder，对照的是它 [Phase 执行流程] 的 review → fix 闭环。

**本次落地**：progress.md Pinned 加了一条（2026-11-02 起每次改动部署前过代码审查并尽量补测试，取代「快速模式下做完直接部署、不派 reviewer」），用户 memory 记了 review-before-every-deploy，档位切回 standard，三项已读文件核对；v0.15.0..HEAD 补派 code-reviewer（HIGH 三 Stage，含 0.15.0 形态库升级演练）与独立 tester（主 Agent 自述，结果待回）。skill / rule 本体没动；progress.md Decisions 2026-10-29「快速开发模式」旧条还没标「→ 被取代」。

**落点建议**（未执行；按 EVOLUTION.md 改规则每条需用户确认，动 .claude/** 本轮会自动升 strict）：
进化两问：成文了吗——部分。CLAUDE.md [档位] 的 fast 一行写「流程侧不自动派 tester / reviewer、不受四步走约束」，没限定 HIGH 档，还和 dev-builder SKILL.md [Phase 执行流程] 的「用户强调某个环节是追加要求，不替换基础流程，review 闭环照常走」互相矛盾；造成过什么代价——4 次拦发版、本次 HIGH 全量补审、用户亲自纠正。结论：值得进化，三处，由轻到重：
1. .claude/harness/profile.json：mark-review-needed 的 fast 由 off 改 on（或写进 overrides，改完 `tier validate`）。「免派」和「不记账」是两件事，该免的只有前者；待审清单是 review 这笔债的账本，fast 下被关了。不改的话，fast 期间的改动进不了清单，若那 5 个 frontend 文件事先审完清掉，release-gate 当时就会放行（推断，由现有配置与账本推出；发版另有测试卡点，但它不查审查）。stop-gate 在 fast 本就是 advise，不新增拦停。
2. CLAUDE.md [档位] fast 一行 + dev-workflow-details.md [项目开发阶段] 定档段：补一句「fast 免的是自动派 reviewer 与四步走，不免定档；HIGH 档先审后部署」，并与 dev-builder 那句对齐消除矛盾。fast 窗口内累计多少未审 Task / 文件该主动停手，阈值由用户定（本次是 6 个改动、5 个以上文件才被发现）。
3. dev-builder SKILL.md [开发规则清单] 的 [数据库]：加一行「启动迁移上线前，在上一已发布版的库形态上演练，核对前后行数与关键值，迁移测试用上一版形态的样本库」。现有 [第一性原则]「修改纪律」只要求加启动迁移（删持久化数据时配迁移测试），没说演练基线。

不建议把「部署前必过审查」升成地板项：地板是任何档都改不了的安全护栏（密钥、危险 pkill、发版、compact 回注、通知）；用户 10-28、10-29 亲口要求过「快速开发模式」「做完直接部署」，这次是用户改了主意，属项目内约束，已进 Pinned。发版这一步 release-gate 本就是地板，这次也确实拦住了；本机部署没有对应的机器信号，升地板得先定义「部署」事件怎么识别，可行性未核实。
