# cc-base v3 提案——分档位执行 + 裁剪（不减功能，减重复与死重）

> 产出日期：2026-09-05。触发：用户指令「不缩减功能、还要加功能；7 万行要裁；可严格 / 可快速 / 可精细调强度；避免过度复杂化，轻便而全面；借鉴 dsh-base / codex-base 但不盲从，上网找优秀实践」。
> 证据来源：本仓只读摸底（Explore）、dsh-base `bcf70e4` 与 codex-base `6d1429d` 只读摸底、联网调研 60 余条来源（50 条 WebFetch 核实）。每条主张都带句柄；没有证据的不写。
> 本文是提案，不是决定。落地前每个 Phase 都要用户拍板；ADR 段在被接受后才搬进 `docs/adr/`。

---

## 一、底数：7.7 万行是什么

| 仓 | 总行数 | 引擎 | 测试 | 其中基线 | in-session hook | 子命令 |
|---|---:|---:|---:|---:|---|---:|
| cc-base `647a426` | 76,591 | 16,984（22%） | 41,469（54%） | golden 29,236（38%） | 21 个，25 对 .sh/.ps1 镜像 3,083 行 | 39 |
| dsh-base `bcf70e4` | 22,647 | 5,337 + 顶层 2,913 | 5,291（23%） | 1,807（8%） | 0（自判 Rejected） | 39 |
| codex-base `6d1429d` | 41,758 | 17,480（42%） | 9,479（23%，单文件） | 0 | 10 事件共用一段 inline node 派发器 | 28 顶层 / 63 契约 |

cc-base 的体量不在功能上：手写的引擎 + hook + skill 不到 2.5 万行，与 codex 同量级；多出来的 5 万行里，**golden 基线 2.9 万行**是机器录的，**分发包里 44% 以上的字节**（73 个测试文件 1.48 MB、11 篇 research 253 KB、18 篇本仓 agent-memory 88 KB、progress 系列）在目标项目里没有任何 hook / CI 调用方。

同一件事写多份的面（本仓摸底，带句柄）：

| 面 | 量 | 现状 |
|---|---|---|
| 六份排除表 | `gen-manifest.sh:36-60` / `setup.sh copy_claude_tree` / `release.mjs:295-331` 三份 35 条**逐字相等**；`setup.ps1:238-261` 27 条语义等价；`core.mjs:233-260,610-620` 同 11 项在文件内写了 2–3 遍 | 刻意买的「审计者不与被审者共用来源」保险；但评审记忆 `pattern_duplicated-rule-tables.md` 记着删掉 `release.mjs` 8 条规则后 selftest + golden 全绿——四层测试里两层对它零灵敏 |
| .ps1 镜像 | 1,071 代码行对 .sh 916 行，25 对，函数一一对应 | 受 `setup.ps1:322-337` 的 `.sh→.ps1` 改写逻辑绑定，那段逻辑零行为测试；dsh 台账 :120 记 cc 的 ps1 曾「16/34 臂不等价、静默装漏」 |
| 规则散文复述 | 「三文件同步」9 份、「作者≠评审」约 10 份散文 + 9 份 golden | 唯一不靠手抄的传播路径是 `memory.mjs:80` 从 CLAUDE.md 抠 13 条铁律回注 |
| hook 内样板 | 项目根解析 ×8、stdin 排空 ×19、fail-open 拼装 ×7、jq 双分支 ×N | 两侧合计 150–200 行 |
| 零调用方脚本 | `skill-description-lint.sh` 116 / `install-githooks.ps1` 106 / `gate-audit.sh` 96 / `plan-lint.sh` 89 / `statusline.ps1` 70 = 477 行 | 前两个与引擎 `skills-lint` / `gate-audit` 同目的异实现、读两套账本 |
| 39 个子命令的调用方 | 10 个有 hook / githook / CI 调用；4 个由 SKILL.md 指示手跑；25 个只有测试与散文引用 | 不是冗余，是诊断口——但说明「常驻」与「按需」两层从没分开过 |

强度旋钮的现状：**只有两个布尔**——`.fast-mode`（约 20 个脚本各自经 `lib-fast-mode.sh` 读一遍）与 catalog 有无（`lib-harness.sh` 统一判）。#38 的 CRLF 分叉就是三处解析同一个文件各写一遍的直接后果。

---

## 二、「超越」的定义（不是子命令数）

兄弟仓与本仓一样，**从未出现过净简化的提交**：dsh 64 个 commit 只有 1 个净删（−51 行），codex 51 个只有 1 个净删（−33 行），两仓五天各长 78% / 净增 6,740 行。codex 自己 2026-09-05 的对照研究写得直白（`REPORT.md:5`）：「继续增加档位、Agent、命令或 Hook 不是目前最有价值的方向」；它的 16 轴档位有 9 轴从没接线。

v2 总纲曾把「超越」定义为「把 P 变 M」——把靠自觉的规则变机器闸。那一步做完了（39 子命令、21 hook）。v3 的超越是另外三条，每条都可量：

1. **同一功能，用户面更少**：强度一个开关、闸门一个入口、排除表一个真相源。判据：`grep -l fast-mode` 从 20 个文件变 1 个。
2. **每个机制说得出它挡住过什么**：`gate-audit` 数据为零的闸退到按需层，不常驻。判据：常驻闸门清单上每条附最近一次拦停记录。
3. **三档随手切，切完行为可预测**：档位是一张表，不是散落的布尔。判据：`tier explain` 能打印「当前档下这个闸是 off / advise / block，因为哪条规则」。

业界共识支撑（联网调研跨方向共识 1–8，句柄见 §五）：分档第一轴是 advisory vs enforced 而非规则条数；每个机制都是「假设模型做不到什么」，无实证收益就删；指令数是硬预算；升档要人批、降档要自动；小任务跳过流程是官方与所有主流框架的共识。

---

## 三、分档位设计

### 3.1 三档 + 安全地板

档位按「人在这个档里扮演什么角色」命名（arXiv 2506.12469 的分级法），不按「跑几个闸」命名：

| 档 | 一句话 | 自动派发 | 闸门默认 | 谁能进 |
|---|---|---|---|---|
| `fast` | 人是操作员，框架只提醒不拦 | 不派 code-reviewer / tester，不走 red-locks | 治理闸 advise（出提醒、记债、不 block） | 显式开，**硬上限 8 小时**自动回 `standard`（dsh `quality.mjs:786` 的做法；本仓现在默认 24h 且无上限） |
| `standard` | 人是验收者，框架按现行流程拦 | per-Task review→fix、Phase 四步走、three-file-sync、stop-gate | 现行默认 | 默认档 |
| `strict` | 人是审批者，框架把回执也机器验 | + tester 必须独立 fresh、家底改动过 red-blue、`SubagentStop` 机器解析六字段信封不合格即 deny、`TaskCompleted` 无 PASS 门不许标完成、发版要 CI 绿 + gate-fresh | 全 block | 显式开，或被治理面自动抬上来 |
| **地板** | 任何档都改不了 | — | `secret-exfil-guard` / `dangerous-pkill-guard` / 远端实况实查 / 不可逆操作审批 / 密钥隐私 | 结构上不在档位表里，profile 文件碰不到它 |

现在的 fast-mode 已经是这个模型的 1/3：它跳的正是 `fast` 档跳的那些。差别在于它是布尔、没有 `strict`、没有地板的结构化表达、也没有细粒度。

### 3.2 细粒度：闸门级三态表

每个闸有 id，档位 = `闸 id → off | advise | block` 的一张表。用户可在项目级覆盖单个闸（如 `standard` 下把 `tdd-gate` 调成 `off`），也可在会话级临时覆盖。这一步把「精细化调整框架强度」变成改一行表，不改 hook：

```
.claude/harness/profile.json（≈60 行）
{
  "default": "standard",
  "tiers": { "fast": {...}, "standard": {...}, "strict": {...} },
  "floor": ["secret-exfil-guard", "dangerous-pkill-guard", "release-gate"],
  "raise": { "paths": [".claude/hooks/**", ".claude/harness/**", ".claude/skills/**",
                       ".claude/agents/**", ".claude/CLAUDE.md", ".github/**"], "to": "strict" },
  "overrides": {}
}
```

### 3.3 单调性：升自动、降留痕

借 codex `assurance.mjs:397-413` 的「只抬不降」合并（序型取高、集合取并、布尔取 OR），但**只取三档、只对已接线的闸**（codex 16 轴接线 7 轴，剩下 9 轴是纸面档位，这是明确不抄的部分）：

- **治理面自动升档**：改 `raise.paths` 命中的文件，当次会话自动进 `strict` 并点名文件（codex `floors.paths` 的做法；本仓 `risk` 已有 `GOVERNANCE_SURFACE_CHANGED`，只差把它接到档位）。
- **降档必须留痕**：`tier set fast --hours 4 --reason "..."` 才生效，写进 gate log，`gate-audit` 能统计「fast 开着的时候跳过了哪些闸、后来债还了没」——本仓已有 `FAST_MODE_DEBT`，补一条「只有债后 fresh PASS 才算还」（codex `debt.mjs:262` 的判据）。
- **模块 riskTier 抬地板**：有 catalog 时，critical / high 模块被触到 → 该次 gate 至少 `standard`（dsh `quality.mjs:897-902` 的地板；本仓 catalog 已有 riskTier，只差消费）。
- **升档不需要人，降档不能靠 agent**：agent 不能自己 `tier set fast`——这条走 `PermissionRequest`（HIGH 档），与「Fast Mode 不等于 push 授权」同源。

### 3.4 实现面（最小改动，估 +400 行，净 +250）

| 件 | 改什么 | 行数 |
|---|---|---|
| `profile.json` | 新建，档位表 + 地板 + 升档路径 | ~60 |
| `lib-fast-mode.sh/.ps1` → `lib-tier.sh/.ps1` | `is_fast_mode` 改成 `gate_mode <id>`，返回 off/advise/block；读 profile + 会话覆盖 + 自动升档标记 | 各 ~40，替换现有 26/21 |
| 20 个 hook | 各改一行：`if is_fast_mode; then exit 0` → `case $(gate_mode xxx) in off) exit 0;; advise) 只 additionalContext;; block) 现逻辑;; esac` | ~60 |
| 引擎 `tier` 子命令 | status / set / explain / validate（三档单调性校验，参照 codex 53 行但只 3 档） | ~150，落 `quality.mjs` 或新 `tier.mjs` |
| `fast-mode.sh/.ps1` | 变薄壳转发 `tier set fast`，删掉自己的解析 | −40 |
| `memory.mjs` / `quality.mjs` / `lib-fast-mode.sh` 三处 `.fast-mode` 解析 | 合并为一处（#38 的根治） | −30 |

**不动**：39 个子命令的 stdout JSON 与退出码契约、catalog schema、hook 事件注册。档位只改「拦不拦」，不改「报什么」——这是里氏替换在这件事上的形态。

---

## 四、裁剪杠杆（按「省多少 × 动不动契约」排序）

| # | 杠杆 | 省多少 | 动契约？ | 风险与验收 |
|---|---|---|---|---|
| L1 | **分发面收口**：tests / research / agent-memory / progress 不进包（目标项目留 `selftest` + `doctor` 自检，`setup.sh --with-tests` 可选装） | 包体 −44% 字节以上；manifest 241 → ~140 条 | manifest 条目数变（老安装的 `.framework-new` 冲突基线变） | 顺手根治「progress 里的个人路径进包」这一类隐私问题（v1.13.0 / v1.14.0 两次都抓到）；验收 = `test-release-manifest` + 从 zip 装后 doctor / selftest 绿 |
| L2 | **golden 瘦身**：25 个无运行时调用方的子命令只录 `{argv, exitCode, sha256(归一化 stdout), stderr 类别}`；10 个 hook / CI 消费 + 4 个 SKILL 消费的子命令保留全量 stdout（它们才是契约） | 29,236 → 约 6,000 行，−600 KB | 不动（stdout 契约照旧被 14 个命令的全量基线锁着） | 验收 = `--mutate` 13/13 killed 不降（MUTANTS.json 就是这刀的尺子）；`--record --full` 保留本地全量 dump 供归因 |
| L3 | **排除表单一真相源**：`exclusions.json` 35 条 → 脚本生成 `gen-manifest.sh` case、`setup.sh` case、`setup.ps1` 数组；`release.mjs` 那份**保留**（审计者独立），改由测试断言它等于生成物 | −60 行；改动点 4 → 1 | manifest 内容不变 | 保住「审计者不共用来源」的设计意图，同时消灭「改一份忘三份」；验收 = `test-setup ⑥` 改成对拍生成物 |
| L4 | **hook 单运行时**：25 对 `.sh/.ps1` → 25 个 `.mjs` + 三个 lib，`settings.json` 里 `command` 两平台逐字相同（`node .claude/hooks/x.mjs`） | −1,415 −1,668 +~1,200 = **−1,900 行**，样板（L7）随之消失 | **动**：`setup.ps1:322-337` 的 `.sh→.ps1` 改写逻辑整段删除，`fix-platform` 大半失效，Pinned「.ps1 纯 ASCII」对 hook 不再适用 | 官方 hooks reference 明写 `node` exec form 「works on every platform」；codex 已这么跑；`test-ps1-behavior` 28 条 + `test-hook-failopen` 28 条先移植成 `.mjs` 行为测试再动。**HIGH 档，家底重写，用户拍板** |
| L5 | **零调用方脚本收编**：`skill-description-lint.sh` → `skills-lint`；`gate-audit.sh` 与引擎 `gate-audit` 合账本；`plan-lint.sh` 进 `dod` 或 doctor；`install-githooks.ps1` / `statusline.ps1` 随 L4 消失 | −477 行 | `statusline.ps1` 被 `setup.ps1:322` 按名改写，随 L4 一起处理 | 验收 = doctor 与 CI 对应步骤照旧绿 |
| L6 | **宪法瘦身**：CLAUDE.md 356 行 / 43.9 KB → ≤200 行（官方 memory 页目标）；流程段下沉 skill（Anthropic Claude 5 规则：验证流程抽成 skill）；「三文件同步」9 份 → 1 定义 + `sync-check`；每条规则附一行「为何加 / 失败了什么」（arXiv 2608.11095：带 rationale 的规则增长 +211% → +1.4%，遵守率 +23.1%） | −150 行主控，散文复述 −20 处 | 不动 | 验收 = `rules-audit` M/P/U 计数不降、`claude-md-lint` 绿；Notes 里「一个 gate 修了一天」类教训已证明主控越长越不被读 |
| L7 | hook 样板 lib 化 | −150 行 | 不动 | 若做 L4 则不必单独做 |

合计：76.6K → 约 45K 行，**零功能删除**；分发包字节 −44% 以上。子命令 39 个一个不删，但 `help` 分三组显示：常驻（10）/ skill 驱动（4）/ 诊断（25）。

---

## 五、借鉴判定（吸收 / 改造 / 拒绝，一条一个判定）

### codex-base

| 机制 | 判定 | 理由 |
|---|---|---|
| profile 阶梯 + floors 只抬不降 + `floors.paths` 治理面升档（`assurance.mjs:397-472`） | **吸收改造** | 模型对；只取三档、只对已接线闸；codex 自己 16 轴接线 7 轴，剩下 9 轴是它 REPORT.md C1 的 P1 缺口 |
| evidence debt 从哈希链账本推导、关窗不清债、只有债后 fresh PASS 算还（`debt.mjs:221-287`） | **吸收** | 本仓 `FAST_MODE_DEBT` 已有雏形，补「债后 fresh PASS」判据即可 |
| decision log（decisionId / policyRevision / inputDigest，200 条 + 1 MiB 双限） | **吸收（小）** | `tier set` 的留痕载体 |
| 10 事件共用 inline node 派发器、两平台 command 逐字相同 | **吸收** = L4 | 官方推荐路线 |
| AGENTS.md 32 KiB 预算纪律 | **吸收** = L6 | 本仓 CLAUDE.md 43.9 KB 已超 |
| 16 轴 × 4 档、数值取 max | **拒绝** | 9 轴无消费者；数值取 max 与它自己 `Architecture-Design.md:86`「越大越安全」的反对矛盾（其 C3） |
| 25 份 JSON Schema 2,262 行 | **拒绝（现在）** | 只给 profile / receipt / ledger 三份的价值再评估 |
| shell 语法解析 + 语义分类器 1,777 行 | **拒绝** | 本仓 guard 是窄正则，`gate-audit` 没有数据说它漏过；有数据再议 |
| path lease | **拒绝** | 已有决策（pi-base lease 层 YAGNI） |

### dsh-base

| 机制 | 判定 | 理由 |
|---|---|---|
| fast 窗口 8 小时硬上限（`quality.mjs:786`） | **吸收** | 本仓默认 24h 无上限 |
| protected attributes 永不可 waive / fast-skip | 已有 | #20b 落地时已做 |
| 发版 lens 深度地板 `review-depth`（`context.mjs:706-723`） | **吸收进 strict 档** | 台账原判「观察」，档位给了它落点 |
| 9 份 ADR 语料 | **吸收（形式）** | 本仓 `adr-check` 执法器空转、`docs/adr/` 不存在；本提案的 3 条 ADR 被接受后即为首批 |
| setup.sh 17 行 / setup.ps1 44 行薄壳 + `install.mjs` 单实现 | **吸收方向** = L4 的安装器侧 | 本仓两个安装器 484 / 458 行各写一遍 |
| `OPERATIONS.md` 一页运维手册 | **吸收（小）** | 本仓操作流散在 `harness-large-repo.md:224-231` |
| fleet 多仓契约层 ~673 行 | 拒绝 | 已有决策（2026-09-03 四条理由） |
| NFR 五份 789 行、第二本能力台账 | 拒绝 | 本仓 `quality-attributes.md` 一份够；台账一本够 |
| 零 in-session hook | 不适用 | 那是它宿主没有 |

### 业界（联网调研，核实状态见调研回执）

| 来源 | 吸收什么 |
|---|---|
| Anthropic best-practices / Steering / Claude 5 context rules | advisory vs enforced 二分；「一句话能描述的 diff 跳过 plan」= `fast` 档的官方版；主控 −80% 的先例 |
| Anthropic auto mode（2026-03-25）/ measuring-autonomy | 分档范式 = 白名单 → 可回滚免审 → 分类器 → 人；连续 3 次或总 20 次拒绝升级人工——升档阈值是数字 |
| obra/superpowers 5.0.6（2026-03-25） | 删掉子代理 review 循环，「25 分钟开销无可测收益」。**本仓不照抄**：progress 记着 code-reviewer 抓出过真回退（P2-1 `path.join` 回退、批 1 的 ENOENT 家族）。但这正是「闸靠数据留」要回答的问题——`standard` 档保留 per-Task review，`gate-audit` 出 FIX_REQUIRED 率，低于阈值再议 |
| BMAD scale-adaptive / OpenSpec delta specs | 低档误用时自动提示升档；以变更为单位的增量规格 |
| arXiv 2506.12469 / 2606.04321 / Microsoft 信任分 | 档位按人的角色命名；升要证据 + 人签、降自动不对称；信任分带衰减 |
| arXiv 2608.11095 / IFScale / HANDBOOK.md | 规则带 rationale；指令总数是硬预算；长规则文件本身是失败源 |
| arXiv 2606.05976 Self-Correction Illusion | 把被审代码当「他人产出」呈现，纠错率 +23–93pp——作者≠评审有了新证据，strict 档的 fresh reviewer 不是仪式 |
| arXiv 2602.01011 | 自组织多 agent 团队输给最强个体最多 41%——fan-out 审查要并列独立 + 主 Agent 裁决，不让审查者协商（本仓 red-blue 的 Judge 结构已符合） |
| hooks reference exec form / claudefa.st / function hooks 预览 | 单运行时薄壳是官方路线，进程内 TS hook 已在预览 |
| ruflo 审计（39 个未接线 hook、91 个 agent 定义） | 「接线审计」要常态化——本仓 `rules-audit` 的 P 计数 + `gate-audit` 就是这个 |

---

## 六、七大原则自检（arch-designer 口诀：开闭看扩展点、倒置看依赖向、单一看变化因、隔离看契约宽、迪米特看越界手、里氏看替换性、合成看继承树）

| 原则 | 本提案 | 违反信号有没有 |
|---|---|---|
| 开闭 | 新增一个闸 = profile 加一行 + 一个 hook 文件，不改既有 hook | 无 |
| 依赖倒置 | hook 依赖 `gate_mode` 抽象，不再各自读 `.fast-mode` 文件 | 现状违反（20 处直读），提案修 |
| 单一职责 | `profile.json` 只管强度，`module-catalog.json` 只管架构与属性，两者不混 | 无；catalog 的 riskTier 只作为升档输入 |
| 接口隔离 | hook 只问 `gate_mode <id>`，不需要知道档位全貌 | 无 |
| 迪米特 | hook 不直接读引擎状态目录；升档标记由引擎写、lib 读 | 无 |
| 里氏替换 | 换档只改 off/advise/block 映射，39 个子命令的 stdout / 退出码契约逐字不变 | 无——这是 golden 保留 14 个契约命令全量基线的原因 |
| 合成复用 | hook 组合三个 lib；L4 后 `.mjs` hook import 共享模块，无继承树 | 无 |

---

## 七、ADR（被接受后搬进 `docs/adr/`，让 `adr-check` 有东西查）

**ADR-0001 强度用三档 profile 表达，不用布尔开关**
背景：`.fast-mode` 布尔被 20 个脚本各自解析，三处解析器出现 CRLF 分叉（#38）；用户要求可严格 / 可快速 / 可细调。决策：`profile.json` 三档 + 闸门级三态 + 安全地板 + 治理面自动升档；降档必须带 reason 与 expiry。被拒备选：codex 16 轴四档（9 轴无消费者）；继续用布尔加第二个布尔（`strict-mode`，会再造一遍分叉）。执法方式：`tier validate` 校验单调性（selftest lane）；`gate-audit` 统计降档期间跳过的闸；`fitness` 规则禁止 hook 直读 `.fast-mode`。

**ADR-0002 hook 走单运行时（node），不再成对维护 .sh/.ps1**
背景：25 对镜像 3,083 行，`setup.ps1` 的改写逻辑零行为测试，dsh 曾抓到 16/34 臂不等价。决策：hook 以 `.mjs` 实现，两平台 `command` 逐字相同；`.ps1` 只剩 `setup.ps1` 薄壳。被拒备选：继续成对 + 补 `.ps1` 行为测试（治标）；Go 单二进制薄壳（多一条构建链）。执法方式：`test-hook-parity` 改为断言 settings.json 无 `.sh`/`.ps1` 命令；`release` manifest 检查；人工评审（家底重写属 HIGH 档）。

**ADR-0003 分发包只含引擎 + hooks + skills + agents + rules，不含测试 / research / 记忆**
背景：包内 44% 字节无目标项目调用方；两次发版隐私审计都抓到 progress 里的个人路径。决策：默认不装 tests / research / agent-memory / progress，`--with-tests` 可选。被拒备选：继续全装并靠擦路径（治标，且每版都要擦一次）。执法方式：`release` 的 manifest 项 + `test-release-manifest`；`scan-secrets` 对包内容扫描进 `make-release.sh`。

---

## 八、分期与成本（每期都可单独停）

| Phase | 内容 | 估时 | 档位 | 收口闸 |
|---|---|---|---|---|
| A | §三分档：profile + lib-tier + `tier` 子命令 + 20 个 hook 各改一行；fast-mode 变薄壳 | 1 天 | MEDIUM（改 hook 是增量补缺，不删） | selftest / golden `--check` 零差异 / run-all / CI / `tier explain` 三档各跑一遍 |
| B | L1 分发面 + L3 排除表真相源 + L5 脚本收编 | 1 天 | MEDIUM | `test-release-manifest` / 从 zip 装后 doctor + selftest / `scan-secrets` 包内零命中 |
| C | L2 golden 瘦身 | 1–2 天 | MEDIUM | `--mutate` 13/13 不降；14 个契约命令全量基线逐字不变 |
| D | L4 hook 单运行时（含安装器薄壳化） | 2–3 天 | **HIGH**（家底重写） | 先移植 56 条 `.ps1` / fail-open 行为断言为 `.mjs` 测试再动；CI windows 格真跑 |
| E | L6 宪法瘦身 + 规则 rationale | 持续 | HIGH（改 CLAUDE.md 规则） | `rules-audit` 计数不降、`claude-md-lint` 绿 |

顺序理由：A 最先，因为它用最少代码改变最多用户面行为，且是用户这次指令的核心；D 最后，因为它是最大的契约变更。B 与 C 可与 A 并行（不同文件面）。A 做完后先用一周，用 `gate-audit` 看三档各自挡住了什么，再决定 superpowers 那条「per-Task review 是否值 25 分钟」在本仓成不成立。

---

## 九、明确不做（与既有决策对齐）

fleet 多仓层（2026-09-03）；16 轴档位；全量 JSON Schema；shell 语法解析器；第二本台账；NFR 文档集；macOS CI 格（2026-09-03）；lease 层（2026-07-30）；自建 benchmark（2026-06-15）。加功能走「先接线再加新」：codex 与本仓的经验一致——没接线的能力是死重。

---

## 十、待用户定的三件事

1. 三档命名与默认档（`fast / standard / strict`，默认 `standard`）是否接受；`fast` 硬上限取 8 小时还是保留 24。
2. Phase D（hook 单运行时）是否进计划——这是唯一动家底的一刀，也是省行数最多、跨平台风险最低的一刀。
3. L1 分发面收口后，目标项目默认不带测试；是否接受「用 `--with-tests` 才装」。
