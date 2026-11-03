---
type: feedback
description: TDD per-Task 循环里 coder 被硬约束「禁改测试文件」（保 TDD 纯度），但 GREEN 后 lint:static 撞到的是 tester 写的测试文件自身的 typecheck/eslint 缺陷——非实现问题，coder 合理停手（非死锁）；正确处置=按「测试错→测试作者(tester)修，代码错→bug-fixer/coder 修」分流，纯类型/lint 缺陷保持断言不变派回 tester
created: 2026-06-10
updated: 2026-06-10
graduated: true
source_skill: test-builder
---

> **毕业 2026-06-10**：已规则化（用户确认进化建议 #4 后即时固化）。落点：CLAUDE.md [test-builder] 执行方式 + AGENTS.md 对等段加「TDD GREEN 测试侧缺陷归属（铁律）」——coder 被禁改测试撞到 tester 测试文件自身纯类型/lint 缺陷时停手是约束生效非死锁；先隔离判断错在 impl 还是 test（仅对 impl 跑 typecheck），test 侧缺陷派回 tester 做断言不变的最小修复，coder 永不削弱/触碰断言。源自实测：测试桩自身的类型/lint 缺陷（非实现），派回 tester 做断言不变的最小修复。

# TDD per-Task 循环：测试侧缺陷（typecheck/lint）的归属分流——派回 tester，不让 coder 碰测试

**问题描述**：
一次用真实开发流压测 per-Task TDD 循环。流程是 tester(codex) 先出失败测试定义契约 → coder 实现到绿（GREEN），coder 被**硬约束「禁改任何测试文件」**以保 TDD 纯度（coder 不得削弱/触碰断言、不得改测试迁就实现）。

GREEN 后跑 `lint:static` 阻断，但撞到的缺陷**不在实现文件，而在 tester 写的测试文件自身**：
- 测试桩里某可选字段在严格类型检查（如 TS exactOptionalPropertyTypes）下不接受显式 undefined；
- `async send` 方法体内无 `await`，触发 `require-await` eslint 规则。

这两个都是**测试代码自身的类型/lint 缺陷**，与被测实现无关。coder 因被禁改测试而**合理停手**（这是约束生效、不是死锁）——它没有越界去改测试，也没有为绕过 lint 而削弱断言。

**触发场景**：
per-Task TDD 循环 GREEN 阶段后跑 `lint:static`/`typecheck` 闸门时，失败源是 tester 写的测试文件本身的纯类型/lint 缺陷（非实现 bug、非断言逻辑问题），而 coder 被「禁改测试文件」硬约束挡住、不能也不该自己修。

**教训/建议**：

**Why**：
- 「coder 禁改测试」是 TDD 纯度的护栏——防 coder 削弱断言/改测试迁就实现（confirmation bias 的另一面）。这条护栏必须保。
- 但护栏的副作用是：当 lint:static 阻断源**在测试文件侧**时，coder 既不能修（违约）也不该修（越界碰断言），会卡在「闸门红 + 我不能动」的合法停手态。
- 此时 ≠ 死锁、≠ 实现没写完、≠ coder 偷懒——是**职责边界正确触发**，需要主 Agent 介入做归属分流，把测试侧修复派回测试作者（tester），而非逼 coder 越界或硬塞 echo clean 绕闸。
- 与既有「测试独立性（写测≠被测作者）」「TDD 测试先行」两条正交互补：那两条管「谁写测试、何时写」；本条管「测试写完后、测试文件自身的缺陷该谁修」——答案仍是测试作者（tester），保住「coder 永不碰断言」。

**How to apply —— per-Task TDD 循环新增「lint:static 失败归属分流」判据**：
1. **先定位错在 impl 还是 test 文件**：lint:static/typecheck 失败时，先看报错文件路径。可用「**仅对 impl 文件跑 typecheck**」（隔离 impl 子集 / 临时排除 test glob）把 impl 侧错误与 test 侧错误分开，确认阻断源到底在哪侧。
2. **分流处置**：
   - **错在 impl 文件（实现 bug / 类型错 / 实现侧 lint）** → coder / bug-fixer 修（正常 GREEN 修实现到绿）。
   - **错在 test 文件（纯类型/lint 缺陷，如 TS2379、require-await，且不涉及断言逻辑）** → **派回 tester（测试作者）做「最小断言保持」修复**——只修类型/lint（如给 `params` 改成条件展开避免显式 undefined、给 `send` 加 await 或改签名/禁用该行规则），**断言一字不改**，保住 TDD 红→绿的契约语义。
   - **错在 test 文件但牵涉断言本身写错** → 仍派 tester（测试作者）判断契约是否需修正，coder 不碰。
3. **coder 合理停手不算失败**：coder 因「禁改测试」而停在测试侧 lint 阻断 ≠ 死锁/偷懒，主 Agent 不催 coder 越界、不硬塞 echo clean 绕闸，而是识别为「该 tester 上场」并派回。
4. **绝不破坏的护栏**：coder 永不削弱/触碰测试断言；测试侧任何修复一律走测试作者（tester）且保持断言语义不变（最小改、只动类型/lint）。

**evolution-engine 信号**：
test-builder / dev-builder per-Task TDD 循环（CLAUDE.md [工作流程] 第三步 GREEN 后的 lint:static 闸门）可固化「lint:static 失败归属分流」一步——失败时先隔离判断错在 impl 还是 test 文件（可仅对 impl 跑 typecheck），impl 侧 → coder/bug-fixer 修，test 侧纯类型/lint 缺陷 → 派回 tester 做「断言不变的最小修复」，明确「coder 因禁改测试而停手是约束生效非死锁」。与 test-independence-author-not-tester（写测≠作者）、tdd-test-first-over-after-the-fact-regression（测试先行）交叉链接，共同收口「测试的编写与修复都归独立测试作者、coder 全程不碰断言」。
