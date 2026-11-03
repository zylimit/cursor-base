---
type: feedback
description: review → fix 闭环需设收敛判据——核心行为缺陷清零即收口，非真实调用路径的边角输入参数花样记残留、不再开新一轮红锁；防御代码只为真实调用路径写，不为假想输入摆设
created: 2026-09-10
updated: 2026-09-10
graduated: true  # 2026-09-10 逐条比对后判定：该条的进化信号已 100% 落地，共五处：CLAUDE.md [开发测试规则] red-locks 与审查收敛两条、code-review / test-builder / dev-builder 三个 SKILL.md、rules/dev-workflow-details.md 开发链；原 graduated: false 是陈旧标记
source_skill: code-review
scope: 本仓 review → fix 闭环（code-review 主导的 FIX_REQUIRED 循环 + red-locks-the-bug 红测循环）的收敛判据，以及新增脚本/新闸的防御代码写作边界
exceptions: 安全类缺陷（路径穿越、密钥泄漏、不可逆操作）的防御不受此限，出现即修，不算过度防御；已识别的核心行为缺陷仍按 red-locks-the-bug 正常走红锁，不因本条而降低修复标准
supersedes: 无
applied_to: .claude/CLAUDE.md [开发测试规则]；code-review / test-builder / dev-builder SKILL.md；rules/dev-workflow-details.md
---

# review 循环收敛于核心行为，避免过度防御边角输入

**问题描述**：
主 Agent 在前期阶段改造收口时，把两支新脚本（predev-lint.mjs / ui-audit.mjs）与既有 spec.mjs 一起送入 review → fix 闭环，一共跑了十轮 fresh code-reviewer 对抗审查、十二批 tester 红锁。前七轮抓的是核心行为缺陷——待定段整段免检旁路、比较式假红、模板原句被放过、GFM 分隔行不识别、路径穿越、缺席留旧证据——这些命中真实调用路径，该修。第八至十轮全在 ui-audit 的 `--out` 参数花样上打转：单横线值（`--out -x`）、等号写法（`--out=--strict`，与空格写法两通道回退目录还不一致）、POSIX `--` 终止符、`--json` 非零出口时 stdout 为空——修的是 design-maker / code-review 真实调用路径**之外**的输入。主 Agent 每轮拿到 FIX_REQUIRED 就再开一批红锁，没有设收敛判据，闭环本该在核心行为清零时收口，却顺着 reviewer 能想出的输入空间一路防御下去。

**触发场景**：
- 新脚本/新闸接入 review → fix 闭环或 red-locks-the-bug 红测循环时，reviewer 挑的问题逐渐从"这个功能按规格该怎么表现"转向"如果传一个没人会传的参数会怎样"。
- 已经过完对核心行为（规格/模板要求、真实调用路径会触达的逻辑）的几轮审查后，后续几轮开始只在参数解析的边角写法（引号、等号、连字符、终止符）上继续找。

**教训/建议**：

Why：闭环没有收敛判据，就会把"reviewer 还能想出新花样"当成"还没修完"的信号，这两者不是一回事。防御代码的成本不止是写下的那几行，还把回归测试面、维护面一并扩大到假想输入上；而真实调用方（design-maker / code-review）从未、也不会传这些边角值。红锁本该是"缺陷固化为回归测试"的工具，用在真实调用路径之外的输入上，锁住的是不会发生的场景，纯成本没有收益。

How to apply：
1. **闭环收敛判据 = 核心行为无 HIGH / Medium**。核心行为指规格/模板要求、真实调用路径会触达的逻辑（本例：待定段免检、假红判定、模板匹配、分隔行识别、路径穿越、缺席证据）——这些清零即可收口，不必等 reviewer 想不出新问题为止。
2. **边角输入记残留、不追加红锁**：非真实调用路径的参数花样（本例 `--out` 的四种写法）发现即记一笔"已知边界、真实调用不触达"，不为它再开一批 tester 红锁；真被后续调用方用到再补。
3. **防御代码只为真实调用路径写**：写一个分支前先问"design-maker / code-review 会不会真这样调"，答不上来就不写；不因为"reviewer 能想到"就等于"该防"。
4. **闸的验收标准以模板与范例为准绳，不追多出来的花样**：新闸的验收锚定在既定模板/规格文本上，reviewer 若在标准之外继续发散，主 Agent 有权判定"超出本轮闭环范围"，不必照单全收。

**本次落地**：
progress.md Decisions 新增一条「避免过度设计、过度防御（用户纠正）」，三要素齐：依据=本次十轮审查中后三轮已偏离核心行为、只在真实调用路径之外的参数写法上打转；适用范围=本仓 review → fix 闭环与新增脚本/闸的防御边界，安全类缺陷不受限；取代=无（新增收敛判据，不取代 red-locks-the-bug，只是给它加了"何时该停"的条件）。未修改任何 skill/rule 文件本体——用户未说"以后都"，且本条的精神正是"避免过度"，为此再去动多处规则本体反而是过度动作；已合并的防御代码（第八至十轮针对 `--out` 的处理）未回退，维持现状，不做额外清理。

**进化信号（给 evolution-engine）**：
可在 code-review skill 或 dev-workflow-details.md 的 review → fix 循环处加一句收敛判据（"核心行为清零即收口，边角输入记残留、不追加红锁"），把本条从个案提炼成流程条款——本条只建议，未动手改。与 red-locks-the-bug-add-red-test-before-fix.md 互补：那条管"发现缺陷要不要补红测"（要），本条管"闭环该在哪停"（核心行为清零，不追边角）；也与 gates-need-empirical-validation.md、meta-tests-not-in-release-chain-scaffold-stay-lean.md 同源——都是"闸/循环/防御代码的成本要配得上它挡住的真实风险"，同一条"脚手架不要过度复杂"的诉求在不同机制上的第三次出现。
