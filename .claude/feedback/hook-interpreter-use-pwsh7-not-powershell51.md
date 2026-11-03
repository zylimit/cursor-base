---
type: feedback
description: 本机配置 hook / 脚本解释器时 PowerShell 一律用 pwsh 7 绝对路径（C:/Program Files/PowerShell/7/pwsh.exe），不用 Windows PowerShell 5.1
created: 2026-07-06
updated: 2026-07-06
graduated: true  # 2026-09-10 逐条比对后判定：以退休形式毕业——hook 单运行时改造后触发场景消失：settings.json 的 21 个 hook 全部是 node，零 PowerShell，剩余 5 个 .ps1 都在 scripts / tests 不在 hook 链上；「本机只装 pwsh7」是用户环境事实，归全局 CLAUDE.md / memory，不进项目规则
source_skill: N/A
---

# hook 解释器选 pwsh 7，不用 Windows PowerShell 5.1

**问题描述**：项目 .claude/settings.json 的 UserPromptSubmit hook（detect-feedback-signal.ps1）报 "hook timed out after 15s"。排查定位为 Git Bash 对裸 `powershell.exe` 的 PATH 解析卡顿（社区同类案例 claude-mem #1062），修复方案是改绝对路径 + 超时改回官方默认 30s。主 Agent 最初选了 Windows PowerShell 5.1 的绝对路径 `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`，用户修正："我就是用powershell7 不会用5"。

**触发场景**：修复 hook 超时、需要为 hook 命令选 PowerShell 解释器路径时。

**教训/建议**：
- 本项目/本机凡是配置 hook、脚本解释器，PowerShell 一律用 **pwsh 7**：`"C:/Program Files/PowerShell/7/pwsh.exe"`，不用 Windows PowerShell 5.1。
- hook 命令串由 bash 执行：路径用**正斜杠**；路径含空格必须**加引号**。
- 最终修复实测 3 次均 <1s 完成、exit 0。
- settings.json 里其余 hook 仍是裸 `powershell.exe`（5.1）：后续如出现同类超时，按同样方式逐个换成 pwsh 7 绝对路径——小步迭代，一次换一个、验证后再换下一个。
