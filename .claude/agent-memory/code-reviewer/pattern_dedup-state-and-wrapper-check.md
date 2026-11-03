---
name: dedup-state-and-wrapper-check
description: 审「提醒去重状态文件」与「包壳后再 node --check」两类改动的固定攻法（2026-10-12 #89/#90 各命中两条）
metadata:
  type: project
---

**提醒去重（stop-gate advise 一类）**
- 「清空后重现再提醒」只在闸亲眼见到空清单时才成立：`echo clean` 后同一轮内又登记同一批文件、中间没有 Stop → 签名相同 → 静默。固定实验：提醒一次 → clean + 重写同清单 → 再跑，看是不是零输出。
- 数每一个提前 return 的出口有没有清去重状态（引擎包未装 / 回执 rc4 那几条出口不清 → 清空后重现被吞）。
- 新增的 `rmSync(状态文件)` 落在 block 档也走的路径上：`.claude` 只读或该路径是目录时，旧版静默、新版 fail-closed 拦。对拍法：`git show HEAD:hook` 拷到临时目录跑同一序列，diff stdout + 目录清单 + 账本。
- 状态文件内容花样（空 / 乱码 / 未来时间 / CRLF / BOM / 3MB）本仓这次全攻不动，别再花预算。

**包壳再 node --check（workflows/*.js）**
- 壳里只要残留一个模块关键字（`import` 行、BOM 顶着的 `export`、`export{a}`），node 22.22 / 24.14 / 24.18 对歧义 `.js` 整份放行，后面的真语法错一起漏；临时文件改 `.cjs` 后三种都能抓到。
- 行号 / 路径回写靠「临时路径前缀匹配」：`TMPDIR` 指向软链目录（macOS 默认如此）即失配，报出临时路径且行号多 1。固定实验：`TMPDIR=<软链> … --paths`。
- 判定版本无关性要真换 node 跑：本机有 nvm 24.14.1 / 24.18.1 与 /usr/bin/node 22.22.1，没有 CI 的 24.21。
- `date +%s%3N` 在本机不出毫秒，造时间戳用 `node -p 'Date.now()'`。

相关：[[pattern_evidence-ledger-attacks]]、[[pattern_cross-platform-coverage-claims]]
