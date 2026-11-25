---
name: pattern-predev-doc-gates
description: 审前期文档闸（CSS 通病扫描 / 表格算术 / 需求↔计划覆盖）的八条固定攻法：作用域连坐、两个解析器一警一哑、豁免关键词撞模板括注、覆盖判据宽于失败消息、从属校验漏判、基线对拍验零行为变化
metadata:
  type: feedback
---

前期闸（predev-lint / plan-lint / ui-slop-scan 这一类：读 Markdown 或 CSS 出结论）的缺陷集中在四处，每次照这个顺序攻，四次里中过三次。

**Why:** 这类闸的判据是「一段文本像不像某种东西」，作者按正例写正则、按正例写测试，反例与正当写法这两侧天然缺覆盖；而假红逼人天天写豁免、假绿让人以为查过了，两头都直接抵消闸的价值。

**How to apply:**

1. **作用域连坐**——判据先算一个「上下文」（CSS 选择器 / 段名 / 表名）再在上下文里判值时，看它用整串还是主体。`\bbody\b` 会命中 `.card-body`，`\bcopy\b` 会命中 `.copy-btn`，`\barticle\b` 会命中 `article h1`；后代选择器 `.prose h2` 的主体是 `h2` 不是 `.prose`。造六行标准写法（Tailwind `prose`、Bootstrap `card-body`、`article h1`、`code`）直接跑，不读代码。
2. **两个解析器一警一哑**——同一张表里 A 列读不出会 warn、B 列读不出静默按 0/默认算，就是假绿。逐个 `parseXxx` 问：返回 null 之后调用方做了什么？有没有出声？特别看正则尾锚 `\s*次?$` 这类——`1 次（带幂等键）`、`3（指数退避）`、`P95 500ms` 全都读不出。
3. **读不出的行退出求和**——不参与求和 = 阈值判据被悄悄放宽，error 会降级成 warning、rc 1 变 rc 0。构造「读不出的那行正好是让和超标的那行」。
4. **单文件读失败 catch 后 return null**——扫描器整体 catch 根目录、单文件却静默跳过；`chmod 000` 一个真有命中的文件，看它是不是报「未找到源码，跳过」+ rc 0。同一份文件 chmod 644 前后对比就是证据。
5. **豁免/退休关键词撞模板说明括注**——`status: accepted（废弃时改 superseded/deprecated）` 会被退休正则判成已退休，整条豁免。凡是「某状态即豁免」的闸，一律拿自家 templates/ 与 examples/ 真跑一遍再说。
6. **覆盖判据宽于失败消息**——消息写「没有任何 Task 引用」、模板规则写「Task 描述里写编号」，实现却是全文件 `in line`。于是 `## 已知风险：REQ-X 本期不做` 满足覆盖。凡是集合运算的闸，都造一条「在非预期位置提及」的样例。

7. **闸只自动化了主条款，从属校验被漏判**（2026-09-22，plan-lint.sh 加「范围外声明」）——特性文档里"不是免死金牌/不算豁免"后面常跟一句"但要…"（本仓 dev-plan-template.md note 15："不能只写编号不写理由"），实现只检查字段存不存在（冒号后有没有捕获组），不检查捕获值非空。攻法：把文档里每句"但要…"单独拎出来，各造一条只满足字段存在、不满足内容要求的夹具（如 `- REQ-X-01：` 空原因）。
8. **验证"新增节不影响旧行为"最快用基线对拍**——`git show HEAD:<script> > /tmp/old.sh`，矩阵夹具（新增契约点涉及的每个维度笛卡尔积）两个版本各跑一遍，diff 输出+rc；比逐行读 diff 更不会漏边角组合，本轮 18 组合零差异只用了一次脚本。

配套：变异复核用被测脚本路径入参（三套测试都支持 `test-xxx.sh <script-path>`），复制到 /tmp 改一行再跑，1 次调用能验 4 个变异。装新脚本别忘了查 `scripts/doctor.sh` 的存在性清单收没收——分母漏一项就是装不全也全绿。

相关：[[pattern_gate-scripts-false-green-in-machine-channel]]、[[pattern_regex-scanner-fp-fn-budget]]、[[pattern_exempt-zone-and-section-scoping]]、[[pattern_installer-and-selfcheck-attacks]]
