---
name: handrolled-parser-needs-differential
description: 本仓爱手搓「不装依赖的语法子集校验器」；判它对不对只认与真解析器的批量对拍，不认几条 fixture
metadata:
  type: project
---

`check-syntax.mjs` 的 frontmatter 校验器是本仓典型：零依赖、手写、自称
「收窄到子集，子集外报 UNDECIDABLE」。这类东西的验收只有一条硬标准——
**和真解析器批量对拍，样例现造、不复用它自己测试里的那几条**。

2026-09-02 实测：README 声称「子集内与 `yaml.safe_load` 对齐过」，
依据是 `test-audit-defects.sh` §8 的 4 条探针（g1/g2 合法、g3/g4 非法）。
我另造 30 条跑对拍，**5 条相左，方向全是假阴（校验器 PASS、pyyaml 报错）**：

| 样例 | pyyaml | 校验器 |
|---|---|---|
| `desc: use when: you need it`（无引号值里含 `": "`） | error | PASS |
| `desc: @reserved` / `` desc: `x ``（YAML 保留指示符） | error | PASS |
| `meta:` 下 4 空格再退到 2 空格（错误 dedent） | error | PASS |
| 块标量体里用 tab 缩进 | error | PASS |

第一条是本仓最可能真发生的形态——skill/agent 的 `description:` 是长句散文，
补一个 ASCII 冒号就崩。实测把真的 `agents/code-reviewer.md` 的 description 后面接
` 触发: 用户要求审查代码`，pyyaml 直接报 `mapping values are not allowed here`，
`check-syntax` 报 `rc=0 ok:true failures:[] undecidable:[]`——**它存在的唯一理由
（畸形 frontmatter 静默失效）在最典型的那一格是空的**。

同时确认 `undecidable` 分支不是死代码：flow collection `[a, b]` / `{a: 1}`、
anchor/alias/tag、merge key、显式键都正确落进 UNDECIDABLE（30 条里 6 条）。

**Why:** 「子集内对齐」是个可证伪的强断言，靠 4 条样例撑不住；而它写进了 README，
读的人会当成结论用。手搓解析器的失败方向天然偏假阴——写的人只想到自己见过的写法。

2026-09-10 同一条在 markdown 表格上又中一次，落点是**表形状识别**：`predev-lint.mjs` 的
`isSepCell = /^:?-{2,}:?$/` 要求 ≥2 个破折号，而 GFM 分隔行一个就够——`|:-:|:-:|:-:|` 与 `|-|-|-|`
都是合法的居中/紧凑写法。后果两头都出：整张维度总表认不出 → UNMEASURED 一次都不触发（同一张表
只改分隔行，`:-:` rc 0 零 finding、`---` rc 1 两条）；前面若还有一张小注表，`at` 状态漏到后面 →
7 条假红，其中一条在judge分隔行自己（「:--」的度量「:-:」）。契约里 23 处分隔行**全是** `| --- |`，
所以红锁全绿也照样漏。查检：手搓 markdown/CSV/表格解析器，先把 GFM 允许的四种分隔写法
（`---` / `-` / `:-` / `:-:`）各喂一遍比 rc，再看契约里出现过几种。

**How to apply:** 见到手搓校验器（YAML / JSON5 / ini / frontmatter / glob / 版本号 / markdown 表），
造 25~30 条现成样例分三组（合法、非法、子集外），拿 `python3 -c "import yaml"` 之类
真解析器批量对拍，输出「相左几条、方向如何」。相左方向若是假阴，直接判 finding：
声明的能力那一格是空的。样例里必须含**本仓真实文件的最小突变**，别全是教科书构造。
相关：[[pattern_gate-scripts-false-green-in-machine-channel]]、[[project_cc-base-is-a-framework-repo]]
