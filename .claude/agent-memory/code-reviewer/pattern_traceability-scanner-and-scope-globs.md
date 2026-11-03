---
name: traceability-scanner-and-scope-globs
description: 审「文档规则编号 ↔ 测试标签 ↔ 常量值」追溯脚本与「代码范围通配」提醒闸的固定攻法（2026-10-20 design-trace / design-detail-sync）
metadata:
  type: project
---

追溯类脚本最危险的不是误报，是**解析不到 = 不存在 = 0 缺口 rc 0**。固定造这几样，逐个看 rc：
① 标题自然变体：`#### ID：标题`（全角冒号紧贴）/ `#### **ID**` / `#### ID。`——规则整条蒸发，rc 0；
   原样模板（占位 `{{}}`）同样 rc 0。summary 里没有「解析出几条规则」的计数就照不出来。
② 标签放在生产代码注释里（`# rule: X` 写在实现旁）——扫描不分测试与源码，「无测试」被静默抹掉。
③ 常量「第一处赋值」取值：注释 / docstring 里的旧值、后文重赋值都会先被命中，漂移被盖住。
④ 扫描跳过目录按名字不按根相对路径（docs/build/out 任意深度）、扩展名表窄——这两个是吵的误报，次要。
⑤ 范围通配闸：目录路径（契约写「路径或通配」）、`./` 前缀、反斜杠、大小写——全部永久静默，无人报「范围匹配 0 个文件」。
⑥ 新增分支挪了宿主闸的早退（如「无 progress.md 直接 return」）→ 老项目每次 Stop 多跑 git status，并新暴露 fail-closed 拦停面。
⑦ 脚本崩溃退出码撞上「有缺口」的码（node 未捕获异常 = 1），下游按 CONCERNS 记，无从分辨。
**How to apply:** 先在 scratch 造上述输入跑脚本看 rc；子闸借宿主日志 id 记账时，顺手查 gate-audit 能否分出子闸数据。
相关：[[gate-scripts-false-green-in-machine-channel]] [[pattern_gate-vocabulary-vs-artifact-templates]]
