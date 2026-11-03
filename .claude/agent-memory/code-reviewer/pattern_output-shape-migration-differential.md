---
name: pattern_output-shape-migration-differential
description: 审 hook 输出形态迁移（纯文本 stdout → 嵌套 JSON、攒行后 finally 统一出口）的固定攻法：新旧对拍 + 载荷 sha + 抛错突变
metadata:
  type: feedback
---

hook 只改「输出包装」不改内容时，别读代码判等价，直接新旧对拍。
**Why:** 2026-11-04 审 session-rules-banner 改嵌套 JSON，8 个场景（marker × fast × compact/resume × off × 空/坏 stdin）对拍一次就钉死了静默规则与顺序，比逐行推理快且有证据。
**How to apply:**
- `git show HEAD:<hook>` 落 scratchpad，旁边 `cp -r hooks/lib` 让相对 import 能跑；同一沙箱同一 stdin 跑新旧，比 rc / 字节 / 行数。
- 载荷比对：新的取 additionalContext、旧的去尾换行，各 sha1——字节差应恰好是包壳长度 + 内部换行转义数。
- `try{攒}finally{flush}` 结构：sed 在中段插 `throw`，看「已攒的照出 + stderr 有 fail-open 诊断 + rc 0」与旧版「先 out 再抛」是否一致；空 lines 必须零字节。
- 测试侧辅助函数（如 ctxof）喂空串 / 纯文本 / 顶层形态三种，确认都走不到假绿；顺带查静默场景有没有被锁（常常没锁）。
