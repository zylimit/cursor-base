---
name: audit-scripts-fragile-zones
description: .claude/harness/audit 三个扫描脚本的易碎边界——工作树/索引之别、pwsh 缺席、自举扫描会扫到测试文件本身
metadata:
  type: project
---

给 `scan-instructions` / `scan-secrets` / `check-syntax` 写测时，这几处最容易写出假红或假绿：

- **工作树 vs 索引**：默认 tracked 模式判的是工作树（正确），`--staged` 该判索引。两种模式的期望值相反，断言必须写明判的是哪一个，否则对照组会被误当缺陷。踩过一次：给默认模式写了「索引有密钥就该拦」，那是我写错不是代码错。
- **pwsh 在本机是「后来装上的」**（2026-09 实测 `~/.local/bin/pwsh` 已存在，早先 WSL2 上没有）。所以 `.ps1` 相关断言两头都不能赌：既不能假定缺席直接 SKIP，也不能假定在场硬断言——一律 `command -v pwsh` 现查现判，缺席打 `[SKIP]` 说明理由。
- **测试文件自己会被扫**：`test-audit-scripts.sh` 有一条自举断言「本仓 tracked 源码不许带密钥字面量」。所以 `.claude/tests/` 下的测试文件里**不许出现字面量形态的假 token**，要运行期拼接（`GH_TOKEN="ghp_$(printf 'AAAA...')"`），否则新测试一落地就把别人的自举断言干红。
- **JSON 字段名会撞车**：`scan-secrets` 输出里 `skipped.allowlisted` 已存在（文件级白名单计数），别用裸 grep `allowlisted` 判断行级豁免机制是否实现，要解析后看具体字段。
- **改完实现要还原时禁用 `git checkout --`**：audit 那几个 .mjs 长期是 `AM` 状态（已进索引 + 工作树又被并行 agent 改过），checkout 还原到的是**索引版**，会把别人未暂存的活儿悄悄抹掉。做变异验证一律 `cp` 到 /tmp 备份 → 变异 → `cp` 回来 → `sha256sum -c` 逐字节验，还原完再 `git status --short` 比对开工快照。
- **豁免走外置白名单**：`scan-instructions` 的行内 `scan-instructions:ignore` 已作废（被扫文件不可信），豁免只认 `.claude/harness/audit/instructions-allowlist.json` 的 `{file,line,rule,sha256}`，路径按**被扫仓的 cwd** 解析；`scan-secrets` 的行内标记则仍生效（两个脚本不同规矩，别混）。造白名单 fixture 后记得删掉再跑后续断言。条目的 `context` 字段（绑 N-1..N+1 三行窗口，`prev+"\n"+line+"\n"+next` 的 sha256，末行空串也算窗口的一部分）**已从可选改成强制**：不带 `context` 的条目一律不生效，命中时打 `allowlist-entry-not-context-bound:<行>:<规则>` 的 note 且 finding 照报。凡是造白名单 fixture 的断言都得带上窗口哈希，否则必红。
- **`--paths` 三个脚本各不相同**：`scan-instructions` / `check-syntax` 支持，`scan-secrets` 不支持（未知参数 rc 2）。且 `--paths` 的 rc 分三档——全部路径不存在=用法错 rc 2、部分不存在=降级 rc 3（`path-not-found`）、悬空/空值=rc 2。断言写「不支持所以 rc 2」会变成描述与实际不符的潜伏谎言：rc 对了，理由是假的。
- **写「机制该更严」的红锁前先查该能力是不是已存在但可选**：踩过一次——派单说「现按单行 sha256 绑定，绑不住上下文」，实查发现 `context` 窗口绑定早已实现、只是可选，README 还把这条明写成已知边界。红锁因此要瞄「绑定改为**强制**」（无 context 的条目不得生效），瞄「实现窗口绑定」会当场变绿、推翻整个 TODO 前提。
- 相关：[[cc-base-testing-infra]]
- **给 scan-secrets 加新规则的红锁，交付前一定要拿候选修复扫一遍全仓**：新规则会连带打红存量文件，而那正是「本仓自举」断言和 git hook 会拦的东西。实测加 `url-userinfo` 后除我自己的测试文件（头注释里写了字面量形态，已改）外，还打红两处存量：`.claude/harness/audit/scan-instructions.mjs:127` 的 `HTTPS_PROXY=` 注释样例、`docs/CROSS-POLLINATION.md:47` 那条描述这条规则本身的台账行。这两处得配 `scan-secrets:ignore`，否则规则一落地 implementer 自己都 commit 不进去——红锁回执里要把这份名单交出去。
- **ADR `revisit-if` 的「日期式空话」判定有子串误伤（2026-09-10 实测）**：`scan.mjs` 的 `ADR_REVISIT_VAGUE_RE` 含 `年后|周后|个月后`，会跨词匹配「明**年后**端团队接手」「2026 **年后**端服务拆成多进程」这类正当条件（年 + 后端），CONDITION 白名单救不回来 → **假红**。反向的漏判反而无害：CONDITION 含 `当|若|需要` 这种高频字，「适**当**时候再评估」会被放过。本仓纪律是「判不准宁可放过」，所以假绿可接受、假红必须报给主 Agent，别自己去改实现，也别把当前行为写成断言固化下来。

- **agent / hook 份数写死在实现脚本里，新增一个合规 agent 就整仓假红**：`scripts/doctor.sh:40` 至今是 `[ "$agent_count" = "7" ]`（2026-09-11 实测：加了第 8 个 agent 后 doctor rc=1，`test-doctor.sh` 的「控制组：未篡改时 rc=0」跟着红，而它验的是清单篡改检测、与份数无关）。`tests/test-setup.sh` 同款硬编码已在 2026-09-11 改成「与源仓 `agents/*.md` 名单逐份比对 + 七个核心角色写死字面量当地板」；`test-routing.sh` 本来就是动态比对所以绿。再遇整仓红先 grep 一遍还有没有第三处写死份数的。

- **`test-gate-audit.sh` 的 `SECTION_B` 锚在「(b) 零记录」这五个字上，标题一改整段变空、11 条信息类断言静默空转**（2026-09-12 实测）：把 (b) 标题改成「零拦停钩子」并**故意把 `notify` 注进 (b) 名单**，整套仍 `PASS=15 FAIL=0`；同一注入但标题保留「零记录」的控制组当场红。给这份文件加断言一律自己另抽一份段落、结构锚点只认 `(b)` / `(c)`（派单钉死的不变量），别复用那个带文案的锚。
- **`gate-audit` 的「(b) 段里要提某词」类断言必须限定在 (b) 段内比**：`gate-block.log` 在 (c) 的账本文件清单里本来就有一处，拿整份输出当锚点恒真 = 免检。同理 `catalog` / `tsconfig` / `下游` 在 (b) 段内当下都是 0 命中，段内比才有判别力。
- **本仓「能力上下文」的实数（判零拦停闸是不是死闸的分母）**：`tsconfig.json` **0** 个（`git ls-files | grep tsconfig` 唯一命中是 golden 夹具 `tests/fixtures/golden/tree/tsconfig.base.json.txt`，而 `pre-commit-check.mjs` 的 `findTsconfig` 只认字面 `tsconfig.json`，所以别把那次命中当成 1）、`.py` **0** 个、`module-catalog.json` 不存在——`pre-commit-check` / `no-direct-code-guard` / `harness-async-verify` 三个零拦停闸的前置条件全不在本仓，而同一批在下游 digifiber 仓拦了 33 次。框架仓审自己的闸会系统性低估「为下游消费者而存在」的那批。
