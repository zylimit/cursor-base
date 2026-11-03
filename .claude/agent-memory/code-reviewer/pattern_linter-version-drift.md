---
name: linter-version-drift
description: 审「告警清零 + 按条 disable」类改动时，本机 shellcheck 版本的全绿不代表发行版自带版本也绿；实测拿旧版二进制对拍
metadata:
  type: project
---

「shellcheck 全量 0 条」只对跑的那个版本成立。按条 `# shellcheck disable=SCxxxx` 压制时，同一现象在不同版本里
编号不同：0.10+ 的 SC2329（函数没被调用，trap 间接调用时误报）在 0.9.0 里叫 SC2317，disable 了新号旧版照响。
2026-09-24 审 TODO #85（static-check 纳入 .claude/**/*.sh）：本机 0.11 全绿，换 0.9.0（Ubuntu 24.04 / Debian 12 apt 版）
cc-base 自己的 Stage 0 当场红 3 条（其中 2 条是 0.11 不报、0.9 报的存量）；目标项目默认装的 scripts/ + skills/ 两个版本都绿。

**Why:** Stage 0 红即停审，闸在常见发行版上假红，用户第一反应是关闸。

**How to apply:** 凡是 linter 告警清零 / 新纳入扫描范围的改动，从 GitHub release 拉 0.8.0 / 0.9.0 二进制
（`koalaman/shellcheck/releases/download/vX/shellcheck-vX.linux.x86_64.tar.xz`，放 scratchpad），
`PATH=旧版:$PATH` 各跑一次闸；并区分「默认装进目标项目的文件集」与「只在框架仓 / --with-tests 才有的文件集」分开报。
disable 诚实度的查法：playground 里把本次新增的 disable 全替成注释，逐文件重跑，看每条是否真会响（本次 36 条全响）。
相关：[[suppression-markers-need-honesty-audit]]、[[cross-platform-coverage-claims]]
