---
type: feedback
description: 配置类缺陷（超时、阈值、解释器路径、包装写法）修一处不算完，要把同族的每个实例都搜一遍再说修好，回执列出查过的全部实例
created: 2026-11-04
updated: 2026-11-04
graduated: false
origin: cursor-base（docs/feedback/config-defects-recur-across-sibling-instances，2026-08-07）
source_skill: N/A
scope: 缺陷形态属于配置的情形：超时值、阈值、解释器路径、包装模式；同族指同一事件族、同一取值、同一模板
exceptions: 缺陷是某个实例独有的逻辑错误、不由共享配置形态引起的，不必全族扫
supersedes: none
applied_to: pending（自 cursor-base docs/feedback 迁入，待进化引擎评估）
---

# 配置类缺陷在每个同族实例里都会再来

**问题描述**：一个超时缺陷在被报告的地方修好了，同一取值在兄弟 hook 里原样复现了同样的失败。只修被报告的那个实例，是打地鼠。

**触发场景**：缺陷形态是配置：超时、阈值、解释器路径、包装写法。原文来自 2026-08 cursor-base 交叉吸收审查时收的一次「同一超时值重复出事」的记录（2026-08-07），原文未给出具体 hook 名与提交。

**教训/建议**：声称修好之前，先找同形态的全部实例：同一事件族、同一取值、同一模板。修的是这一类，不是这一处；回执里列出查过的每个实例。

**适用范围与例外**：见 frontmatter。参照 hook-interpreter-use-pwsh7-not-powershell51.md 里「其余 hook 仍是裸 powershell.exe、后续逐个换」的做法：那条是逐个小步迭代，本条要求在声称完成之前就把同族盘点清楚，二者不冲突。

**本次落地**：pending。原文落在 cursor-base 教训库，cc-base 未见对应规则；落点建议：bug-fixer 修复收尾的验证步骤里加「配置类缺陷列同族实例清单」一句。
