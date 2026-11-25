---
name: pattern-ddl-facts-and-page-redaction
description: 审「建表定义取事实 → 出人读页面 → 核对」一类生成器的必攻点：ALTER 级联、补名对不上、按字段白名单隐去必漏、代码里认 SQL 的误报与整文件没扫
metadata:
  type: feedback
---

审这类生成器（2026-11-23 人读文档第一期）先攻这几条，每条都真复现过：

- DROP COLUMN 只删列不删「点到这一列的」表级约束 / 主键标记 / 索引；RENAME COLUMN 不改表级约束的 columns 与别表 REFERENCES 的列名——合并器最常漏的是 PG 自动级联的那半边。
- 补出来的内部名（约束、无名索引）与库里真名对不上时，带 IF EXISTS 的 DROP 静默失效 → 旧约束与新约束并显。造「长表名 + 长列名」超 63 字节、`CREATE INDEX ON t(a)` + `DROP INDEX IF EXISTS t_a_idx` 两例。
- 隐去走「字段白名单」必漏：逐个列出页面上显示的字段，对表 scrub 过了哪些（这次漏了函数签名、未解析清单的 reason）。建议页面级兜底：自检对每页纯文字再跑一遍敏感规则。
- 规则字面照契约写的口令正则，拿 `redis://:pw@`、`AWS_SECRET_ACCESS_KEY=`、`secret_key=`、带符号的口令四例打，漏了归「需求存疑」不归缺陷。
- 代码里认 SQL：大小写不敏感 → docstring / 日志「update orders」记成写表；切字面量的三个必攻：JSX 文字里的撇号、`)` 后面的正则字面量、f 串格式说明里的引号——任一命中整文件进「没扫成」。下游实数要拿「只认大写」变体做差分，区分真小写 SQL 与散文误报。
- 核对器第 2 项读回了哪几格就只防那几格；出页面的代码在别处出错（主键、外键目标、约束、谁写谁读）第 1 项自己跟自己比，假绿。

**Why:** 读者拿文档当真，这几类错在下游真数据上都不报警（check 0 条），只有造输入才露。
**How to apply:** 审取事实器 / 渲染 / 核对三件套时，先跑这六条再读别的；结论分「契约内缺陷」与「契约字面导致的需求存疑」。相关：[[pattern-regex-scanner-fp-fn-budget]] [[pattern-handrolled-parser-needs-differential]]
