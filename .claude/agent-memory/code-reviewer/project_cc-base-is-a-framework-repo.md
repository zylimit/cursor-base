---
name: cc-base-is-a-framework-repo
description: cc-base 的交付物是 .claude/ 编排配置本身，不是业务代码；审查前该跑哪些自带闸
metadata:
  type: project
---

cc-base 的被审对象是 `.claude/` 这套配置：hooks（.sh/.ps1 成对）、skills、agents、
`harness/harness.mjs` 引擎、`harness/audit/` 独立脚本。没有 Product-Spec.md，
规格底本是 `.claude/research/v2-program-design.md` 与 `.claude/rules/*.md`。

**Why:** 没有业务代码可对照，"Spec 合规"要对照设计文档的条目表和退出码契约表来核，
不是对照功能清单。

**How to apply:** 开审先跑仓里自带的闸当 Stage 0，全是零依赖、秒级：
- `node .claude/hooks/static-check.mjs .`（识栈跑 shellcheck + node --check）
- `node .claude/harness/audit/check-syntax.mjs`（js/json/sh/ps1/frontmatter）
- `bash .claude/tests/cases/run-all.sh`、`bash .claude/tests/test-audit-scripts.sh`
退出码契约表在 `.claude/rules/harness-large-repo.md`，判"契约有没有被破坏"以它为准。
跨平台铁律：引擎与 audit 的 `.mjs` 源码必须纯 ASCII，用
`LC_ALL=C grep -n '[^\x00-\x7F]' <file>` 逐个验；测试 `.sh` 里的中文注释是既有惯例，不算违规。
相关：[[pattern_gate-scripts-false-green-in-machine-channel]]
