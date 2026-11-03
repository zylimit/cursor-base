---
name: suppression-markers-need-honesty-audit
description: 本仓爱用行内压制标记消误报；每个新增标记都要逐条验"拿掉标记会不会真的响"
metadata:
  type: project
---

cc-base 有三套互不通用的行内压制标记：`harness-fitness:ignore`、`scan-secrets:ignore`、
`scan-instructions:ignore`。安全文档正当引用危险串会自我命中，加标记是既定解法
（README 明说「不是放宽规则」）。但标记本身是高发问题源，审查时固定做三件事：

1. **逐条反向验**：把标记拿掉，那一行到底响不响？2026-09-01 实测
   `test-audit-scripts.sh:200/222/232` 三处标记加在只有 `%s` 占位、根本不含密钥的行上，
   删掉标记扫描依然 rc 0 —— 纯冗余，正是「测试目录一律压制」坏习惯的起点。
2. **注意标记压两行**：实现是「本行或上一行命中即跳过」，所以一个标记会连带压制**下一行**。
   写在注释行上时，下一行的真实内容跟着失去覆盖，且无任何输出痕迹。
3. **区分信任面**：扫第一方源码的（fitness / scan-secrets）用行内标记站得住；
   扫**声明为不可信输入**的（scan-instructions 扫 CLAUDE.md / rules / agents）用行内标记
   等于让攻击者自带关扫描的开关——实测在 CLAUDE.md 里塞
   `<!-- scan-instructions:ignore -->` 即可让注入 payload 扫出 rc 0 全绿。

**Why:** 压制是静默的——findings 里不留痕、计数不体现，绿得看不出是真绿还是被压绿。

**How to apply:** 见到新增标记就跑
`grep -rn 'scan-secrets:ignore\|scan-instructions:ignore\|harness-fitness:ignore' .`
拉全量清单逐条过上面三条。建议归口：输出里带 `suppressed` 计数/清单，让压制可见。

## 后继机制：外置白名单（2026-09-02 起，scan-instructions 用它替掉行内标记）

条目绑 `{file, line, rule, sha256(该行)}`，放 `.claude/harness/audit/instructions-allowlist.json`。
方向是对的（第 3 条的正解），但换机制不等于问题没了，固定攻这四条：

1. **豁免的来源必须和内容的来源同一个**。`--staged` 模式名单和内容都走索引，白名单却
   `fs.readFileSync` 读工作树——把豁免写进工作树、永不 `git add`，pre-commit 当场 rc 0 放行，
   而 commit 里一点痕迹都没有。实测复现过。判据一句话：**豁免能不能不进 commit 就生效？**
2. **行哈希绑不住上下文**。同一行放进 ```` ``` ```` 块里是「反例」，把围栏换成空行就是「照做」——
   行号、字节、sha256 三样全没变，豁免照旧生效、`allow` 那行输出一字不差。实测复现过。
   而 README 举的正当豁免场景恰恰就是「安全文档里的反例」。
3. **白名单文件本身要跟着入库**。新加的 `instructions-allowlist.json` 当时是 untracked——
   本机 rc 0、CI 全新 clone 上豁免不存在，两边判据不同。`git ls-files --error-unmatch` 一把验。
4. **失效方向必须 fail-closed**。行改 / 哈希错 / JSON 坏 / 条目字段非法 —— 这四条实测都
   正确地转成 rc 3 + `ok:false` 或「豁免不生效」，是这版做对的部分，复审时确认没退化即可。
相关：[[pattern_gate-scripts-false-green-in-machine-channel]]
