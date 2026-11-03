---
name: pattern_registration-form-dual-support
description: 审 hook 注册面支持多形态（exec/string）+ 安装器合并去重的固定攻法；2026-11-04 hook-form 一轮命中
metadata:
  type: project
---

- 测「形态保持」必须让框架**新增**一条 hook 再升级：去重只能挡已有条目，合并按默认形态产新条目 → 文件混挂，string 侧新闸静默不跑。只拿同一套 hook 重装测会假绿。
- 去重键从「整条命令」放宽成「hook 名」后，造一条用户自定义的、指向同一个 .mjs 但带额外参数的条目，放在**另一个事件**里：`commands` 是全文件收集的，框架那条会被整条吞掉（相对旧键是回归）。
- 转换器只认逐字模板时，把不认的四类（多 args / command 带参数 / 反斜杠 / 绝对路径）喂进去，确认原样保留且 --check 不把它们算进形态。
- 新测试文件先过一遍 static-check：单引号 JS 块不加 `# shellcheck disable=SC2016` 会让 Stage 0 变红（本仓惯例是每处都加注释）。
- 「显式参数优先」只做了一个方向的收尾时（只在 string 时跑转换），拿对向参数打对向目标（`--hook-form exec` 打 string 目标）：结果是 mixed，退出 0。
- 相对路径的 string form 在 Claude Code 里依赖 cwd = 项目根；会话中途 cd 会不会让 hook 找不到文件，官方文档没写，报「需求存疑 / 待确认」，别报实锤。

**Why:** 本轮测试 6 套全绿，但升级新增 hook → mixed、跨事件吞条目这两个问题都是手工复现出来的。
**How to apply:** 凡是「多形态 + 合并去重」的改动都按上面顺序攻；参考 [[pattern_installer-and-selfcheck-attacks]]、[[pattern_output-shape-migration-differential]]。
