# 07 发布与部署验收

这章解决的问题：代码过了四步走之后怎么变成一个能装、能跑、不泄露隐私的产物；为什么发布这一步框架不让主 Agent 代劳；`release-gate` 在你敲下命令的那一刻查什么；部署之后主 Agent 凭什么说「上线成功」；以及框架自己是怎么打发行包的。

读完你能做到：在正确的时机亲自敲 `/release-builder` 并预判它会先拦什么；按 Web / Desktop / CLI 三类策略走完打包与验证；对着实际产物目录跑隐私审计；派 deployer 后独立核查三件套而不看它的自报；出问题时按渠道回退；用 `make-release.sh` 给 cc-base 本身打一个不含私人内容的 zip。

前置：[06 审查、测试、修复](06-review-test-fix.md) 的待审清单已清、测试卡点有真实运行输出。

---

## 入门：做什么

### 发布链一览

```
用户亲自敲 /release-builder
      ↓
release-gate（UserPromptExpansion）：.needs-review 未清 → block；干净 → 注入卡点提醒
      ↓
release-builder skill：问清打包还是发布 / 渠道 / 平台 → 检测依赖 → 确认版本号
      ↓
测试卡点：派 tester 全量跑，运行器真实输出 + 运行清单
      ↓
构建打包 → 对实际产物目录跑隐私审计（任一失败即停）→ 安装测试 → 冒烟
      ↓
汇报全部结果，用户确认后发布（tag / Release / publish / 部署派 deployer）
      ↓
主 Agent 独立核查三件套 → 发布后再验一次 → 有问题走回退
```

### 为什么只能用户亲自敲

`.claude/skills/release-builder/SKILL.md` 的 frontmatter 有 `disable-model-invocation: true`。含义：发布是有副作用的工作流，主 Agent 不能代触发这个 skill——你口头说「发布 / 打包 / 上线」，主 Agent 只会回指 `/release-builder` 请你亲自敲。

这是 CLAUDE.md 审批三档里 HIGH 档「发版上线 / 部署必停等用户明确批准」的机器化：与其靠主 Agent 自觉在发布前停下来问，不如让这个入口本身只有人能触发。同样设了 `disable-model-invocation` 的还有 `/branch-finisher`（合并 / 清分支）。

档位不改变这一点：CLAUDE.md [档位] 明写「不等于部署或 push 授权，发布仍走 [发布阶段] 的完整卡点」；`release-gate` 在 `profile.json` 的 `floor` 里，任何档都改不了。

### release-gate 在展开前查什么

`release-gate.mjs` 挂在 `UserPromptExpansion`，matcher 是 `release-builder`——也就是你敲 `/release-builder` 时、skill 内容展开进上下文**之前**就跑。逻辑只有两条：

| `.claude/.needs-review` 状态 | 结果 |
|---|---|
| 有待审文件 | `decision: block`，reason 列出 N 个文件名，提示「先完成 review→fix 闭环（通过后 `echo clean > .claude/.needs-review`），再执行 /release-builder」 |
| 干净（只剩 clean / 空 / 不存在） | 放行，并注入 additionalContext 提醒三条发布前置卡点 |

注入的提醒原文：

> 发布前置卡点提醒（release-gate 注入）：① 打包前必过测试卡点——test-builder 全量跑，报绿须附运行清单（跑了哪些文件、各自结果），证据=运行器真实输出；② Fast Mode 不豁免发布卡点；③ 部署完成后主 Agent 独立核查三件套（容器创建时间戳+镜像 tag / 健康检查端点 / live 冒烟），不信 deployer 自报。

它是 fail-open 的：闸自身出错放行，因为发布流程后面还有 test-builder 卡点与 HIGH 档审批兜底。拦停会记进 `gate-block.log`。

### 发布检查清单

skill [发布检查清单]，打包前逐项过：

| 项 | 要求 |
|---|---|
| 版本 | package.json version 已按语义化更新；CHANGELOG 已更新；工作区干净 |
| 构建 | 构建命令零错误；产物存在且大小合理，异常偏大就排查是否打了不该打的东西 |
| 隐私审计 | 对实际的构建产物目录执行，见下节；发现任何一项立刻停 |
| 依赖 | `npm audit` 无 critical；构建过程无 `MODULE_NOT_FOUND` |
| 大批量改造后 | 确认收口期那次重复代码扫描已做过，没做先补 |
| Git | author 不暴露个人信息；`.gitignore` 覆盖所有数据文件（`.env*`、`*.db`、本地数据目录） |

### 隐私审计

skill 说这是「绝对底线，没有例外，没有豁免」。在**实际构建产物目录**（不是源码目录）执行：

```bash
cd <产物目录>
grep -rn "/Users/" .                                          # 开发者路径与个人信息
find . -name '*.db' -o -name '*.db-shm' -o -name '*.db-wal'   # 数据库文件
find . -name '.env*' -o -name 'credentials*' -o -name '*.pem' -o -name '*.key'
grep -rn -E "sk-ant-|sk-proj-|ANTHROPIC_API_KEY|OPENAI_API_KEY" .   # 密钥
```

再看有没有用户数据目录与明文密码。任一命中：停，修复，重新构建，重新审计。

### 三类发布策略

| 类型 | 步骤 |
|---|---|
| Web | 构建 → 隐私审计 → 配生产环境变量（密钥在平台配、不进代码）→ 部署并记录 URL → 访问验证无白屏 → 对照 Spec 冒烟 |
| Desktop | 构建 → 按平台打包并检查签名配置（无证书则告知用户绕过方式）→ 隐私审计 → 提醒用户从安装包装到系统目录启动 → 冒烟 |
| CLI | 构建 → 隐私审计 → `npm publish` 或打二进制 → 全局安装验证命令可运行 → 核心命令逐个冒烟 |

三类共同的原则：**dev 测通 ≠ 打包能用**。开发环境和打包后的运行时环境路径、依赖打包方式、权限都不同，必须从安装包测——Desktop 从安装包装到系统目录测，CLI 全局安装后测，Web 部署后在线测，不从构建输出目录测。

### 回退策略

| 类型 | 怎么退 |
|---|---|
| Web | 控制台或 CLI 回退到上一个成功部署 |
| Desktop | 已分发的安装包无法远程回退，修完 bump 版本重新打包发布 |
| CLI | `npm deprecate` 旧版本；严重问题 72 小时内 unpublish；修完 bump 版本重发 |

发布后再验一次，有问题走回退，不在线上现改。

---

## 进阶：为什么、怎么判

### 测试是打包前的闸门，不是打包后的

skill [第一性原则]：构建验证只证明「包能起来、语法没错」，不证明功能对。打包前必须有相关功能回归测试跑过且通过的真实输出；卡点未过先派 tester 跑通再打包，「部署 / 打包」指令不豁免这一条。它与 dev-builder 四步走第 2 步、branch-finisher 的前置闸是同一套 test-builder 卡点，复用而不是另起。

报「绿」须附运行清单——跑了哪些文件、各自绿 / 红 / 跳过原因。有 CI 的仓库，本地绿之后还要 `gh run list` 读 CI 自己的结论（[06 审查、测试、修复](06-review-test-fix.md#测试量与分级怎么落地)）。

### 部署派 deployer，验收留主 Agent

部署由 deployer Sub-Agent 执行（`.claude/agents/deployer.md`，opus，maxTurns 60，用 release-builder skill）。它的纪律：

- 只在主 Agent 明确告知「测试卡点已过」后才动手，否则回 BLOCKED，不擅自跳过。
- 构建能起来 ≠ 功能正确，那是测试的事，不归它判。
- 每一步留客观痕迹，证据原样交给主 Agent，不替部署结果打包票；不判「部署成功」为最终结论。
- 不改业务代码、不做未授权的基础设施变更；不 commit 业务代码（版本号 / release 配置按 skill 约定）。

回执信封同其他角色（Status / Changed / Verified / Not verified / …），另附各步原始输出、三件套证据、产物清单与路径、收尾情况。

### 三件套：为什么不看 Up 时长

主 Agent 独立核查三件套，全过才算成功——哪怕 deployer 回报 incomplete 或空回复；子 Agent 回报「完成」不是部署结果（skill [部署验收三件套]、CLAUDE.md 验收铁律）：

| # | 查什么 | 判据 | 为什么 |
|---|---|---|---|
| 1 | 容器创建时间戳 + 镜像 tag | 创建时间晚于最后一次提交；tag 是目标版本 | 「Up 时长」可能是重启前旧容器的残留读数，会误导——你看到 Up 3 天，可能是旧容器根本没被替换 |
| 2 | 健康检查端点 | 返回 200 | 进程起了不等于服务可用 |
| 3 | live 冒烟 | curl 真实端点，验证**新功能的产物**确实存在 | 只看进程起没起，验不出部署的是不是旧版本 |

三件套之外的收尾：清掉 deployer 留下的临时产物；确认版本号文件（`release.conf` / package.json）已提交。

远端写操作前另有一条 CLAUDE.md 铁律：对远端 / 生产做删 / 改 / 重启 / 重跑前，必须当场查目标的**当前**实况，不拿旧快照、时间推断、客户端侧状态当依据；被拒 / 中断 / 超时的远程调用按「可能已执行」对待，先实查再决定重发。

### 卡住先诊断

打包工具卡住时：进程 CPU 0% 而运行时长仍在涨 = 死锁，不是慢也不是网络，别干等。skill 点名的两个坑：electron-builder 会去遍历 pnpm 的符号链接依赖树，对依赖布局敏感；配置声明 ≠ 实际状态——`.npmrc` 写了 hoisted 不等于 node_modules 真是扁平，增量 install 会让二者脱节。打包前先验实际布局。打包报错先 WebSearch，特别是签名、公证、打包器与部署 CLI 的版本兼容。

### 给 deployer 的派单包长什么样

部署派单同样走七字段（[05 开发精讲](05-development.md#派单包七字段逐字段写法)），只是 Verification 变成三件套的取证要求，Escalation 要写清什么情况回 BLOCKED。一个 Web 部署到容器平台的例子：

```
Goal（HIGH——发布）：v1.4.0 镜像部署到 staging，容器由新镜像创建，/healthz 返回 200，/api/todos 的响应体含 dueAt 字段（本版新功能）。
Scope：只动部署配置 deploy/staging.yml 与镜像 tag；可执行 docker build / push / compose up。
Out of Scope：不改业务代码；不改生产环境；不改数据库 schema（迁移已在 CI 跑过）。
Existing Pattern：上一版部署记录见 progress.md Done 2026-09-08 那条；镜像 tag 规则 `<repo>:v<semver>`。
Business Context：本版交付「到期日」`[确认]`（Spec 功能需求，来源案例 2）；测试卡点已过——tester 回执 2026-09-15 14:02，vitest 47 passed 0 failed，运行清单附在 .claude/evidence/ 下。
Verification：回执附①容器创建时间戳与镜像 tag 的原始输出；②/healthz 的 HTTP 状态与响应体；③curl /api/todos 的响应体片段（含 dueAt）。不写「部署成功」四个字，只给这三样。
Escalation：测试卡点证据对不上（tester 回执缺运行器输出）→ 回 BLOCKED 不动手；push 被拒 / 超时 → 停下回报，不重发（远端可能已执行）；需要平台凭据 → NEEDS_CONTEXT。
```

deployer 回来的回执你只读三样东西：Changed 里的产物路径、Verified 里三件套的原始输出、Not verified 里它承认没证明的。然后主 Agent 自己再跑一遍三件套。

### 三件套怎么查（示例）

skill 只规定查什么，不规定用什么命令——按你的平台替换。容器平台的一种写法：

```bash
# ① 创建时间戳 + 镜像 tag：看 CreatedAt 与 Image，不看 STATUS 列的 Up 时长
docker ps --filter name=<容器名> --format '{{.CreatedAt}}  {{.Image}}  {{.Status}}'
git log -1 --format='%ci %h'        # 与最后一次提交时间对照，创建时间必须更晚

# ② 健康端点
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/healthz

# ③ live 冒烟：验证新功能的产物，不只看进程
curl -s https://<host>/api/todos | head -c 400
```

第 ①条要同时看两列：创建时间晚于最后一次提交，且 Image 的 tag 是目标版本。只看其中一列都能被旧容器骗过——旧容器的 tag 可能碰巧对（回滚过又推了同名 tag），或者创建时间对但 tag 是上一版（compose 没换 image）。第 ③条查的是「新功能的产物」：本版加了 `dueAt`，响应里就得有 `dueAt`；查 `/` 返回 200 不算。

### 三文件同步在发布阶段

版本号与 CHANGELOG 是检查清单第一项，同时也是三文件同步的一部分：发布决策（渠道、版本、回退方案）进 progress.md Decisions；发布完成进 Done；之前已打包发布过、之后又改了 Spec 的项目，[内容修订] 流程末尾会提醒重新 `/release-builder`。

---

## 精通：内部机制与边界

### 框架自身发版：make-release.sh

cc-base 本身的发行包由仓库根的 `make-release.sh` 产：

```bash
bash make-release.sh v1.0.3      # 产出 /tmp/cc-base-v1.0.3.zip，stdout 打印路径
```

它做的事：

| 步 | 内容 |
|---|---|
| 取源 | `git archive HEAD`——只含已跟踪文件，工作树里没 add 的东西不进包 |
| 排除私人进化内容 | 删 `feedback/` 顶层的经验 `*.md`（保留 `templates/`），把 `FEEDBACK-INDEX.md` 重置为干净模板 |
| 排除框架自己的维护记录 | 删 `progress.md`、`progress.archive.md`、`docs/`、`.claude/research/`、`.claude/agent-memory/`——它们指向本仓，装进别人项目是噪声，且 progress 里两次带出过开发者路径 |
| 保留进化机制 | EVOLUTION.md、evolution-engine skill、evolution-runner agent 照留 |
| 打包 | 非 Windows 用 `python3 zipfile`；Git Bash / MSYS 下 python 不认 `/tmp` 挂载，改用 PowerShell `Compress-Archive`（cygpath 转路径） |
| 泄漏扫描 | 解包核对：feedback 私有 `*.md`、progress、docs、research、agent-memory 任一泄漏即报错非零退出，不发坏包 |

在本仓实跑一次（产物随后删除），你会看到：

```
/tmp/cc-base-vguide-test.zip
```

解包统计：282 个条目，`.claude/` 272 个，另有 `.github/`、`.gitignore`、`ARCHITECTURE.md`、`README.md`、`make-release.sh`、`setup.ps1`、`setup.sh`。`feedback/` 下只剩 `FEEDBACK-INDEX.md`（模板版），没有 `progress.md`、没有 `docs/`、没有 `agent-memory/`、没有 `research/`；`.claude/tests/` 与 `.claude/harness/ext/` 在包里。

所以本指南（`docs/guide/`）不随 zip 装进目标项目，在线读 GitHub 上的 `docs/guide/`——README 的约定就是这么来的。

harness 另有 `release` 子命令（`node .claude/harness/harness.mjs release`，发布装配），CLAUDE.md 说明 fast 档生效时它的 `tier` 项直接 FAIL。

### 地板闸：release-gate 与两道安全护栏

`profile.json` 的 `floor` 列了五个任何档都改不了的 hook：`secret-exfil-guard` / `dangerous-pkill-guard` / `release-gate` / `postcompact-reinject` / `notify`。发布阶段直接相关的是前三个。看一个闸当前的档位与来源：

```bash
node .claude/harness/harness.mjs tier explain release-gate
```

你会看到：

```
release-gate: block now (guard, source floor) -- fast=block, standard=block, strict=block
{"hook":"release-gate","kind":"guard","floor":true,"tiers":{"fast":"block","standard":"block","strict":"block"},"effective":"block","tier":"standard","source":"floor"}
```

对比一个非地板闸：

```bash
node .claude/harness/harness.mjs tier explain stop-gate
```

```
stop-gate: advise now (guard, source default) -- fast=advise, standard=advise, strict=block
```

`floor: true` 与 `source: floor` 就是「放水不放安全」的机器表达。两道安全护栏在发布期尤其常碰：

| 闸 | 挂在 | 拦什么 | 怎么绕不过 |
|---|---|---|---|
| `secret-exfil-guard` | PreToolUse(Bash) | R1 直读密钥文件（`cat` / `less` / `head` / `tail` / `strings` / `xxd` / `od` 读 `.env` 家族、`id_rsa`、`*.pem`、`credentials` 等；`.env.example` / `.sample` / `.template` / `.dist` 合法）；R2 `cp` / `scp` / `rsync` / `mv` 搬运同一密钥文件集；R3 `env` / `printenv` / `set` 输出管进 `curl` / `wget` / `nc` | 先剥 `sudo` / `nohup` / `nice` / `timeout` / `env` 前缀与 `bash -c` 引号壳再判，原文与剥壳后两个形态都过检；命令锚定起始或分隔符之后，`echo` / `grep` 字符串场景放过 |
| `dangerous-pkill-guard` | PreToolUse(Bash) | 真实执行的 `pkill -f`（宽泛匹配会误杀主 Agent 进程） | 同样锚定命令起始 / 分隔符，多行命令每行都锚 |

所以发布时「看一眼 .env 里配了什么」这类动作会被拦，这是设计：密钥在平台配、不进代码，也不进主 Agent 的上下文。要核对环境变量名，读 `.env.example`。

### fast 档不是发布授权

`fast` 是用户明示的临时放水（必须带 reason，硬上限 8 小时自动回默认档），guard 类闸只出提醒不拦、不自动派 tester / code-reviewer。但它对发布链一件事都不改：release-gate 是地板；skill 的测试卡点写明「部署 / 打包指令不豁免」；release-gate 注入的提醒第 ② 条就是「Fast Mode 不豁免发布卡点」；harness 的 `release` 装配在 fast 生效时 `tier` 项直接 FAIL。

查当前档：

```bash
bash .claude/scripts/fast-mode.sh status      # 等价 node .claude/harness/harness.mjs tier status
```

你会看到（默认档）：

```
tier: standard, source=default
```

发布前看到 `tier: fast` 就先 `bash .claude/scripts/fast-mode.sh off`，再敲 `/release-builder`。

### 发布前自检：把三处规则合成一张单

发布涉及的规则散在 skill、hook、CLAUDE.md 三处，敲命令前过一遍：

| # | 项 | 出处 | 证据 |
|---|---|---|---|
| 1 | `.claude/.needs-review` 只剩 clean | release-gate | `cat .claude/.needs-review` |
| 2 | 档位不是 fast | 地板闸 / CLAUDE.md | `tier status` |
| 3 | tester 全量跑过，运行清单在手 | skill 测试卡点 | 运行器原始输出 |
| 4 | 有 CI 的，CI 结论已读 | CLAUDE.md 开发测试规则 | `gh run list` |
| 5 | 版本号与 CHANGELOG 已更新，工作区干净 | 发布检查清单 | `git status` |
| 6 | 大批量改造后的重复代码扫描做过 | 发布检查清单 | progress.md 留痕 |
| 7 | 家底改动或高风险批次过了红蓝 | dev-workflow-details | `$REPORT` 三态 ACCEPT |
| 8 | 隐私审计对象是产物目录，不是源码 | skill 隐私审计 | 四组命令输出 |
| 9 | 部署派 deployer，主 Agent 不亲自部署 | CLAUDE.md 职责边界 | 派单包 |
| 10 | 三件套由主 Agent 亲跑 | 验收铁律 | 原始输出 |

### 发布也可以过一遍红蓝

`dev-workflow-details.md` 对 red-blue-review 的自动建议里写了：发版 / 合并分支前，对高风险或家底改动建议过一遍。Red 的四 lens 里有专门的 **release** lens——打包 / 版本 / 发布产物缺漏、装不上、回滚难、漏排除私人内容——正对着本章的检查清单。用法见 [06 审查、测试、修复](06-review-test-fix.md#red-blue-reviewblue--red--judge)。

### 边界

- `/release-builder` 只由用户触发；主 Agent 不代触发、不派 Sub-Agent 代触发。
- `release-gate` 是地板闸，`fast` / `standard` / `strict` 都是 block；它只查待审清单，测试卡点靠 skill 与 tester 执行。
- deployer 不判「部署成功」，主 Agent 的三件套是唯一验收标准；三件套不看「Up 时长」。
- 隐私审计对产物目录做，不对源码目录做；源码里的密钥扫描是 code-review Stage 2 与 `secret-exfil-guard` 的事。
- 「只打包不发布」不检测部署工具；要登录认证或签名证书这类用户专属资产，skill 说明需要什么让你准备，不代办。
- `make-release.sh` 只打已跟踪文件；改了没 commit 的修复不会进包。

Windows 差异：`make-release.sh` 在 Git Bash 跑，内部已按 MINGW / MSYS 分支用 `Compress-Archive`；`grep -rn` / `find` 隐私审计命令在 PowerShell 用 `Select-String -Path . -Pattern "/Users/" -Recurse` 与 `Get-ChildItem -Recurse -Include *.db,*.env*,*.pem,*.key` 等价替代。

---

## 常见坑

| 坑 | 表现 | 怎么办 |
|---|---|---|
| 让主 Agent「帮我发一下」 | 它回指 `/release-builder` | 自己敲，这是设计不是偷懒 |
| 待审清单没清就敲 | release-gate block，reason 列出待审文件 | 走完 review → fix，`echo clean > .claude/.needs-review` 再敲 |
| 开了 fast 档以为能跳发布卡点 | 卡点提醒照注入，deployer 照要测试证据 | fast 不等于部署或 push 授权 |
| 从构建输出目录测 | dev 通了，装完不通 | Desktop 从安装包装到系统目录，CLI 全局安装，Web 部署后在线 |
| 对源码跑隐私审计 | 产物里带了 `.env` 或 `/Users/xxx` 路径 | 对实际产物目录跑那四组命令 |
| 产物异常偏大没管 | 打进了数据库或 node_modules | 大小异常先排查 |
| 看 deployer 说「部署完成」就报成功 | 线上还是旧版本 | 主 Agent 自己跑三件套 |
| 看容器 Up 时长判断已重启 | Up 3 天其实是旧容器 | 看创建时间戳与镜像 tag |
| 健康端点 200 就算完 | 进程起了但部署的是旧包 | 第三件：curl 真实端点验证新功能产物 |
| 远程调用超时就重发 | 双进程 / 双部署 | 按「可能已执行」对待，先实查远端再决定 |
| 打包进程干等 | CPU 0% 时长在涨 | 死锁，先诊断依赖布局，别等 |
| `.npmrc` 写了 hoisted 就信 | electron-builder 遍历符号链接树卡死 | 打包前验 node_modules 实际布局 |
| Desktop 出问题想远程回退 | 回不了 | 修完 bump 版本重新打包发布 |
| CLI 坏版本一直挂着 | 用户装到坏版本 | `npm deprecate`，严重的 72 小时内 unpublish |
| 版本号文件没提交 | 三件套查 tag 对不上 | 收尾确认 `release.conf` / package.json 已提交 |
| 用 make-release 打包未提交的修复 | 包里没有那个修复 | 它只取 `git archive HEAD`，先 commit |
| 把 skill 目录里的 RED-BLUE-REVIEW.md 填了 | 随 make-release 进包 | 每次拷到 `/tmp` 副本再填 |
| 发布后不再验 | 上线即失联 | 发布后再验一次，有问题走回退 |

下一章：[08 记忆与恢复](08-memory.md)——progress.md、feedback、口径库三套记忆怎么分工、`/recap-project` 怎么恢复。
