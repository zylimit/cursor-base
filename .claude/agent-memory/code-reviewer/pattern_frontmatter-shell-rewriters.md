---
name: pattern-frontmatter-shell-rewriters
description: 审 bash+awk 读写 markdown frontmatter 的脚本（collect-feedback 类）的固定攻法——CRLF、模板行内注释、带空格的项目名、同名目录
metadata:
  type: project
---

bash/awk 手搓 frontmatter 读写，自带测试全绿也常漏这四种输入，2026-10-30 审 collect-feedback.sh 四条全中：
- CRLF 文件：首行是 `---\r`，`$0 == "---"` 判不中 → 当成无 frontmatter，再补一段 → 双 frontmatter 写坏文件（Windows 下游真会产）。
- 模板行内注释：`origin:   # 可选…` 被 fm_get 当成值，合并后写成 `origin: # …,proj`，YAML 读出来是 null。改模板时顺手 grep 用这个模板的读写脚本。
- 带空格的名字：一边 `tr -d ' '` 一边不剥 → 永远不等，每次都落 conflict 副本。
- 两个父目录不同、basename 相同的项目被当成同一 origin，静默覆盖。

**How to apply:** 在 scratchpad 造这四种样例实跑一遍再下结论，再跑第二遍看幂等性；见 [[pattern-handrolled-parser-needs-differential]]。
