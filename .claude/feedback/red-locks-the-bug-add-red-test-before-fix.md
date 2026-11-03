---
type: feedback
description: red-locks-the-bug 铁律——review 交叉审 / 系统测试 / commander 抽查发现的缺陷（bug/漏洞），修复前必须先由 tester 补一条锁定该缺陷的失败测试（红）→ commander 验红（亲见 fail）→ coder 修到绿（禁碰测试断言）→ 异模型 reviewer 复审。把发现的缺陷固化为永久回归测试（防再犯）+ 修复有客观靶子（红转绿、杜绝口头说修了实际没修）+ 机制化不靠自觉。是 TDD「先红后绿」从新功能向缺陷修复的自然延伸
created: 2026-06-11
updated: 2026-06-11
graduated: true  # 2026-06-11 用户认可固化 → Product-Spec §5.4 + CLAUDE.md per-Task 循环 + dev-builder SKILL.md + ARCHITECTURE §5 + CHANGELOG v1.2，本文件留作细则参照
source_skill: dev-builder
priority: 铁律（用户明确"必须写入规格里面""我认可了，加"）
---

# red-locks-the-bug：缺陷修复前先补红测锁定

**起源**：
P1-T1 开发中，reviewer-claude 交叉审（claude 审 coder-codex 写的 `tools/evidence-index.sh`）审出 Medium 级 **job_id 路径遍历漏洞**（`write job_id="../PWNED"` 逃逸 evidence 目录、`read "../../etc/passwd"` 读任意文件）。commander 独立复现确认后，没让 coder 直接改，而是走了：**tester 补 4 条 job_id 安全失败测试（红）→ commander 验红 → coder-codex 修 job_id 字符集过滤（红转绿 23/0）→ reviewer-claude 复审**。用户观察到这套流程「好像不在规则里但挺好」，确认后要求「必须写入规格」。

**规则（铁律）**：
review 交叉审 / 系统测试 / commander 抽查发现的缺陷（bug / 漏洞），**修复前必须先由 tester 补一条锁定该缺陷的失败测试（红）**，commander 验红（亲见 fail、失败因缺陷真实存在），再由 coder 修到绿（**禁碰测试断言**）、异模型 reviewer 复审（≤2 轮封顶内）。

**触发场景**：
任何「review/系统测试/抽查发现缺陷 → 要修复」的场景。尤其 dev-builder per-Task 的 Stage 2 失败、阶段5 系统测试问题分级、commander 抽查发现造假/漏洞时。

**Why（为什么先补红测再修）**：
1. **缺陷固化为永久回归测试**——发现的 bug 变成测试套件的一部分，下次有人改坏会被立刻抓住，防同一坑再踩。
2. **修复有客观靶子**——红转绿是机器可验证的完成信号，杜绝「coder 口头说修了、实际没修或没修对」（与「验收以客观证据为准」铁律协同）。
3. **机制化不靠自觉**——是 TDD「先红后绿」哲学从「新功能」向「缺陷修复」的自然延伸；缺陷修复同样是「定义期望行为（红测）→ 实现到满足（绿）」。
4. 对比反模式：coder 直接改一改、说「修好了」——没有测试锁定，无法证明真修了、也防不住回归。

**How to apply（怎么做）**：
1. **分工**：tester 补红测（coder 禁碰测试断言，写测≠被测作者）→ commander 验红 → coder 修绿 → 异模型 reviewer 复审。
2. **红测要精准锁定该缺陷**：针对 reviewer/测试发现的具体问题写最小失败测试（如路径遍历→写 `job_id` 含 `/`、`..`、逃逸落盘、逃逸读取等 case）。
3. **验红是 commander 的活**：亲跑见红、确认红因缺陷真实（非测试笔误），再放行 coder 修。
4. **复审封顶内**：修复后异模型 reviewer 复审属第 2 轮（review≤2 封顶内），聚焦修复点 + 是否引入新问题。

**实证**：
P1-T1 evidence-index.sh job_id 路径遍历：reviewer 审出 → tester 补 4 红测（slash/dotdot/write逃逸/read泄漏）→ 验红（19绿/4红）→ coder-codex 修（23/0全绿）→ commander 独立复现漏洞已堵 → reviewer 复审。漏洞从此被回归测试永久锁定。

**关联**：
[[tdd-test-first-over-after-the-fact-regression]]（TDD 测试先行总纲，本条是其向缺陷修复的延伸）、[[tdd-per-task-test-side-defect-routing]]（测试侧缺陷派回 tester）、与「验收以客观证据为准」铁律协同（红转绿是客观完成信号）。

**已固化落地**：Product-Spec §5.4 + 阶段4 §73 + 阶段5 §83 + CLAUDE.md per-Task 循环 + dev-builder SKILL.md 第11步 + ARCHITECTURE §5 铁律表 + CHANGELOG v1.2。
