# 13 定制与扩展：改主控、加 skill、加 hook、进化引擎

这章解决的问题：框架装进项目之后要按自己的团队改——往 CLAUDE.md 加一条铁律、加一个 skill、加一道闸、加一个角色、调某个闸的档位、把一次纠正记成 feedback 并让它最终毕业成规则。读完你能按仓库既有的写法把这些改动做完整：每处该登记的都登记、该测的都有用例、`tier validate` / `test-routing` / `skills-lint` / `gen-manifest --check` 四道机器闸都过。

改家底自动升 strict 档（`profile.json` 的 `raise.paths` 含 `.claude/hooks|harness|skills|agents/**`、`.claude/CLAUDE.md`、`.claude/rules/**`、`.claude/settings.json`、`.github/**`），提交后回落。改的时候 stop-gate 会真拦、tdd-gate 对含 red-lock 关键词的派单真拦，这是设计。

## 入门：改 CLAUDE.md 的风格约束

`.claude/CLAUDE.md` 的结构是 `[段名]` + 四空格缩进正文，段内列表用 `- `，铁律用编号 + 粗体标题。它 126 行，是主 Agent 每轮都读的东西，所以：

| 约束 | 出处 | 怎么做 |
|---|---|---|
| 每条规则要么点名闸，要么标「靠自觉」 | [铁律——每条写明谁在守] 开头一段；Pinned「四个避免过度」 | 铁律末尾写 `闸：<hook-id>——<一句它拦什么>` 或 `靠自觉。` |
| 风格贴原文 | 铁律 5「往家底加内容风格贴原文：缩进、标记、语气、密度同，改完读不出哪句是后加的，禁英文缩写堆砌与元叙事」 | 改完读一遍，能一眼挑出「后加的那句」就重写 |
| 细则下沉 `.claude/rules/`，主控留指针 | [任务] / [运行模型] / [大仓治理与五性] 各段末尾的「…先读它」 | 超过三行的流程写进 rules，主控写「X 在 .claude/rules/Y.md，做 Z 之前先读」 |
| 规则行要能被 `rules-audit` 归类 | 第 11 章「三份规则闸」 | 执法点用行内反引号写 token（`no-direct-code-guard` / `tier validate`），承认靠自觉就写「靠自觉」 |

现状（本仓实跑 `node .claude/harness/harness.mjs rules-audit`）：CLAUDE.md 50 条规则行，machine 2 / prompt 3 / phantom 0 / unclassified 45。phantom 为零是硬指标，U 多少是给人的清单。

改完跑：

```bash
node .claude/harness/harness.mjs rules-audit     # phantom 必须 0
bash .claude/tests/test-routing.sh               # 调度表 / skill 列表与磁盘双向一致
```

## 入门：rules 的 path-scoped 加载

`.claude/rules/*.md` 每份头部有 frontmatter `paths:`，Claude Code 在会话碰到匹配路径的文件时自动把它加载进上下文；没碰到时靠 CLAUDE.md 的指针手动读，两条路都通（各文件第一段原话）。

| 文件 | paths |
|---|---|
| `dev-workflow-details.md` | `Product-Spec.md` / `Product-Spec-CHANGELOG.md` / `DEV-PLAN.md` / `Architecture-Design.md` |
| `domain-rulings.md` | `domain/**` |
| `file-structure.md` | `.claude/**` / `Product-Spec.md` / `DEV-PLAN.md` |
| `memory-systems.md` | `.claude/feedback/**` / `.claude/agent-memory/**` |
| `subagent-dispatch.md` | `.claude/agents/**` |
| `workflow-orchestration.md` | `.claude/workflows/**` |
| `harness-large-repo.md` / `quality-attributes.md`（随 `--with-harness` 装入） | `.claude/harness/**` |

加一份新 rule：文件放 `.claude/rules/<name>.md`，头部写 `paths`，第一段照抄「本文件由 CLAUDE.md 下沉；主控命中指针时必须完整读取本文件再行动」，CLAUDE.md 对应段末尾加指针。`doctor.sh` 只把 `file-structure` / `workflow-orchestration` / `dev-workflow-details` 三份当地板判缺，新加的不用登记进 doctor。

## 进阶：加一个 skill

`.claude/skills/skill-builder/SKILL.md` 是官方步骤，`templates/skill-template.md` 是骨架。按交互模式（对话采集 / 自主分析 / 执行操作 / 诊断修复）找一两个最接近的已有 skill 当参照，不按领域。

### 第一步：目录与 frontmatter

```
.claude/skills/<skill-name>/
├── SKILL.md
└── templates/        # 只在有模板时建
```

frontmatter 现存写法（`bug-fixer` / `release-builder` / `evolution-engine`）：

```yaml
---
name: bug-fixer
description: 当用户说'这个功能坏了'、'报错了'、'不正常'，或报告 bug、编译错误、运行时异常时使用。
argument-hint: "[问题描述或报错信息]"
---
```

```yaml
---
name: release-builder
description: 当用户说要打包、部署、发布、上线，或项目开发完成准备交付时使用。
disable-model-invocation: true
argument-hint: "[版本号或部署目标（可选）]"
---
```

```yaml
---
name: evolution-engine
description: 当 session 初始化时自动触发，或用户说"帮我看看有没有该升级的规则"、"检查进化建议"时手动触发。由 evolution-runner sub-agent 调用。
context: fork
agent: evolution-runner
---
```

`skills-lint` 判五件（第 11 章）：frontmatter 可解析；`name` kebab-case 且与目录同名；`description` 非空、≤180 字、触发式——含「当…时」或「由…调用」，否则 `DESCRIPTION_NOT_TRIGGER_SHAPED`；全体不重名；`disable-model-invocation` / `user-invocable` 这类布尔字段必须裸 `true` / `false`（引号包起来的 `"false"` 是非空字符串恒真）。裸值里不许有 `": "`，loader 会连整份文档一起拒。

`skill-template.md` 的「规范速查」说 frontmatter 只有 `name` 和 `description`；仓里已有 `argument-hint` / `disable-model-invocation` / `context` / `agent` 四个额外键在用，按需加，别发明第五个。

### 第二步：正文 Section

必须有：`[任务]` / `[依赖检测]` / `[第一性原则]` / `[文件结构]`（只有 SKILL.md 一个文件的不画树）/ `[初始化]`。推荐：对话型 skill 必有对话示例 / 反例 / 收敛条件 / 交接；`[XXX维度清单]` / `[XXX策略]` 按领域命名。`[第一性原则]` 只写本阶段特有的判断依据，CLAUDE.md 已有的铁律不重复。格式：`[标题]` + 四空格缩进 + 中文。

### 第三步：登记进 CLAUDE.md

Claude Code 会自动发现 `.claude/skills/` 下的新 skill，但主 Agent 靠 CLAUDE.md [Skill 调用规则] 路由。加一行，格式与现有行一致：

```
    - /<skill-name> - 自动：<触发条件>。手动：/<skill-name>。前置：<前置文件>
```

### 第四步：过机器闸

```bash
node .claude/harness/harness.mjs skills-lint    # frontmatter 五件
bash .claude/tests/test-routing.sh              # ② CLAUDE.md 登记的每个 skill 都有 SKILL.md；③ 每个 skills/<name>/ 都在 CLAUDE.md 有登记
bash .claude/scripts/doctor.sh .                # 每个 skill 目录有 SKILL.md
bash .claude/scripts/gen-manifest.sh            # 新文件入清单，否则装到别人项目时不分发
```

`test-routing.sh` 从 CLAUDE.md 用正则 `skills/([a-z0-9-]+)/` 抽登记的 skill 集合与磁盘目录集合双向比对，一边多一边少都非零退出。

## 进阶：加一个 hook

### 第一步：文件与 helper

文件放 `.claude/hooks/<hook-id>.mjs`，hook id = 文件名去后缀。只 import `./lib/io.mjs` / `./lib/gatelog.mjs` / `./lib/harness.mjs`，**不许 import `.claude/harness/lib/*`**（`io.mjs` 头注释：hook 与引擎进程级隔离，引擎 lib 被删时 hook 必须还起得来）。

`io.mjs` 的 export 与用途：

| export | 用途 |
|---|---|
| `readStdinJson()` | 读事件 JSON；空输入 `{}`，解析失败 `null` |
| `readStdinRaw()` / `readTextFile(file)` | 后者只把 ENOENT 当「不存在」，其余 errno 单独报 |
| `projectDir()` | `CLAUDE_PROJECT_DIR` → git 顶层 → cwd |
| `emit(obj)` | 单行 JSON 到 stdout（`decision` / `systemMessage` / `additionalContext`） |
| `out(text)` / `say(text)` | 裸文本到 stdout / 一行诊断到 stderr |
| `block(reason)` | `{decision:"block",reason}`，Stop / PreCompact / UserPromptExpansion 的拦停形态 |
| `run(cmd, argv)` / `git(args)` | `shell:false` + argv 数组，禁字符串拼命令 |
| `porcelainZ(root)` / `classifyChange(p)` / `relToProject(p, prefix)` | 工作树改动集与归类 |
| `toPosix(p)` | 反斜杠归一，Windows 侧事件里的 `src\app.ts` 才能被正则命中 |
| `gateModeOf(hookId)` | 档位总闸，返回 `off` / `advise` / `block` / `on` |
| `fastOff(hookId)` | 只关心「要不要静默放行」的 recorder 用 |
| `runFailClosed(main, reason)` | 主体异常当场落 `decision:block`——闸自己崩了等于没证明干净 |
| `runFailOpen(main)` | 主体异常留一行 `[hook] 内部异常，已放行` 后放行 |

`gatelog.mjs` 的 `gateLog(hook, reason)` 追加 `<ISO UTC>\t<hook>\t<reason 首行>` 到 `.claude/evidence/gate-block.log`，任何失败吞掉不影响判决——`gate-audit.sh` 靠它统计哪些闸从没拦过东西，**advise 档也要记账**（tdd-gate.mjs 注释：不记账的提醒闸会被当死闸删掉）。

最短的 guard 范例是 `.claude/hooks/no-direct-code-guard.mjs`（36 行），骨架：

```js
import { readStdinJson, toPosix, say, gateModeOf, runFailOpen } from './lib/io.mjs';
import { gateLog } from './lib/gatelog.mjs';

runFailOpen(async () => {
  const mode = await gateModeOf('no-direct-code-guard');
  if (mode === 'off') return;
  const ev = readStdinJson();
  if (ev && ev.agent_id) return;                       // 子 Agent 里放行
  const filePath = toPosix(String((ev.tool_input || {}).file_path || ''));
  if (!filePath || EXEMPT.test(filePath) || !SOURCE.test(filePath)) return;
  if (mode !== 'advise') process.exitCode = 2;         // 先落拦停码再写诊断
  say(`⚠️  [no-direct-code-guard] 主 Agent 不应直接写业务源码：${filePath}`);
  gateLog('no-direct-code-guard', `${mode === 'advise' ? '[advise] ' : ''}主 Agent 直接写业务源码被拦：${filePath}`);
});
```

三个写法要点：先落 `process.exitCode = 2` 再写 stderr / 账本，写诊断失败不该把已成立的拦停降级；`advise` 分支话照说账照记退出码留 0，前缀写 `[advise]` 不写 `[fast]`（advise 不只 fast 一档能来）；PreToolUse 的拦停靠 exit 2，Stop 类靠 `emit({decision:'block'})`（退出码留 0）。

### 第二步：三张档位表同步

`gateModeOf` 动态 import `./lib/tier.mjs`，判定库缺失时退到 `io.mjs` 里的 `FALLBACK_GUARDS` / `FALLBACK_ADVISE`。加一个 hook 要动的表：

| 表 | 位置 | 内容 |
|---|---|---|
| `profile.json` | `.claude/harness/profile.json` `hooks` | `"<id>": { "kind": "guard"|"recorder", "fast": …, "standard": …, "strict": … }`；guard 取 off / advise / block，recorder 取 off / on |
| `DEFAULT_PROFILE` | `.claude/hooks/lib/tier.mjs` | 与 `profile.json` 逐字同内容，缺文件时按它跑 |
| `GUARDS` | `.claude/hooks/lib/tier.mjs` | 以 exit 2 或 `decision:block` 表态的 hook id 集合，未登记 id 按种类取最严 |
| `FALLBACK_GUARDS` / `FALLBACK_ADVISE` | `.claude/hooks/lib/io.mjs` | 判定库整个加载不了时的 standard 列 |

进 `profile.floor` 的是地板闸：任何档都拦，`gateMode` 直接返回最严值，不读表；地板闸自己不问档位（`secret-exfil-guard.mjs` / `dangerous-pkill-guard.mjs` 头注释）。

`tier validate` 校验：三档单调（fast ≤ standard ≤ strict）、floor 不出现在档位表、kind 与取值域匹配、`raise.to` 合法、无未知字段、**已注册 hook（从 settings.json 的 `args[0]` 现算）必须在表里或在 floor**、表里不许有不存在的 hook id。本仓实跑：

```
$ node .claude/harness/harness.mjs tier validate
{"ok":true,"degraded":false,"file":".claude/harness/profile.json","registeredHooks":21,"registeredHooksReadable":true,"violations":[]}
```

`test-tier.sh` 里有三张表相等的断言（progress.md Done 2026-09-15：「三张档位表对齐并加 TD-1 相等断言」），漏改一张会红。

### 第三步：settings.json 注册

exec form，不经 shell，三个平台逐字相同（Pinned）：

```json
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/<hook-id>.mjs"],
  "timeout": 5
}
```

放进对应事件的 `matcher` 组：`PreToolUse` 现有 `Bash` / `Edit|Write` / `Agent` 三组，`PostToolUse` 有 `Bash` / `Edit|Write` / `Edit|Write|NotebookEdit`，`Stop` / `SubagentStop`（matcher `implementer|code-reviewer|tester|deployer`）/ `PreCompact` / `PostCompact` / `SessionStart` / `UserPromptSubmit` / `UserPromptExpansion` / `Notification`。后台形态加 `"asyncRewake": true`（`harness-async-verify.mjs` 的注册）。占位符只认花括号 `${CLAUDE_PROJECT_DIR}`。

`test-hooks-settings.sh` 锁注册面：exec form、`args[0]` 存在、零 `.sh/.ps1`、timeout 保值。`doctor.sh` 判每条 `args[0]` 指向的文件真的在。

### 第四步：写用例

`.claude/tests/test-hooks-node.sh` 的写法：`run_hook <id> <沙箱目录> <stdin JSON>` 回填 `RC` / `OUT`（stdout）/ `ERRT`（stderr）；`chk <0|1> <标题> <EXPECT> <GOT>` 累加 PASS / FAIL 并打印期望与实际。沙箱由 `newsb` 造，`profile.json` 随沙箱一起装（未跟踪的 `.claude/harness/**` 命中 raise.paths 会把沙箱抬成 strict，所以要赶在 git 提交之前）。

```bash
run_hook auto-push "$SB" '{"tool_input":{"command":"git commit -m t"}}'
chk "$([ "$RC" -eq 0 ] && synced "$SB" && echo 0 || echo 1)" \
    "AP-1 commit 后 auto-push 同步" "rc 0 且远端同步" "rc=$RC"
```

提醒类每个 hook 只保一条主路径；地板闸用例进 `test-hooks-floor.sh` 一条不减；三档矩阵与损坏输入不再养（`test-hooks-node.sh` 头注释「分级取舍」）。头行 `# risk:` 按第 12 章定。

### 第五步：入清单与登记

```bash
bash .claude/scripts/gen-manifest.sh
node .claude/harness/harness.mjs tier validate
bash .claude/tests/test-hooks-node.sh
bash .claude/tests/test-hooks-settings.sh
bash .claude/tests/test-tier.sh
```

CLAUDE.md 若有对应铁律，末尾写 `闸：<hook-id>`；`.claude/rules/file-structure.md` 的 hooks 行按需补名。

## 进阶：加一个 agent

`.claude/agents/<name>.md` frontmatter 现存写法（`implementer.md`）：

```yaml
---
name: implementer
description: 当项目规模较大，主 Agent 需要将 Phase 拆分为独立 Task 分别执行时派发。使用 dev-builder skill 编码，每个 Task 一个 fresh 实例。
skills: dev-builder
model: sonnet
color: green
disallowedTools: Task
maxTurns: 100
---
```

| 字段 | 取值 |
|---|---|
| `disallowedTools: Task` | 扁平编排铁律：Sub-Agent 不再派 Sub-Agent |
| `maxTurns` | 熔断线不是目标（`subagent-dispatch.md`）：implementer 100，tester / code-reviewer / deployer 60，evolution-runner 30，其余 25 |
| `model` | implementer / tester sonnet，code-reviewer / deployer opus |
| `memory: project` | 只 code-reviewer / tester 有，角色战术笔记，单文件 5KB、每角色 50KB 封顶 |

登记三处：CLAUDE.md [Sub-Agent 调度规则] 表加一行（`test-routing.sh ①` 从表里抽 `.claude/agents/<name>.md` 与磁盘目录比对，`doctor.sh` 对未登记的 agent 只提一句「主 Agent 不会派它」）；若是执行类角色，`settings.json` `SubagentStop` 的 matcher 加进去（`subagent-acceptance-reminder.mjs` 才会给它注收工自检）；`.claude/rules/subagent-dispatch.md` 的派单包与回执信封对它同样适用。

## 精通：profile overrides 与 tier validate

项目级微调不改 `hooks` 表，写 `overrides`：

```json
"overrides": { "stop-gate": "block" }
```

`gateMode` 优先级 floor → overrides → 档位表；overrides 是用户的最终话语权，`tier explain <id>` 会标 `source: override`。取值受 kind 约束（guard 三态 / recorder 两态），越界忽略。floor 里的闸不能 override。

```bash
node .claude/harness/harness.mjs tier explain stop-gate
```

你会看到（本仓无 override）：

```
stop-gate: advise now (guard, source default) -- fast=advise, standard=advise, strict=block
{"hook":"stop-gate","kind":"guard","floor":false,"tiers":{"fast":"advise","standard":"advise","strict":"block"},"effective":"advise","tier":"standard","source":"default"}
```

改完 `tier validate`；`profile.json` 不在时 rc 3 降级（缺文件按内置默认表跑，只是没有可校验的文件）。

## 精通：feedback 写法与毕业

feedback 记 AI 工作方法的纠正，不记项目事实（那进 progress.md Decisions）、不记领域口径（那进 `domain/`）——`.claude/rules/memory-systems.md` [三套系统的边界]。由 feedback-observer 用 feedback-writer skill 写，人不直接触发。

模板 `.claude/feedback/templates/feedback-topic-template.md` frontmatter：

| 字段 | 含义 |
|---|---|
| `type: feedback` | 固定 |
| `description` | 一句话摘要，索引扫描用 |
| `created` / `updated` | 日期 |
| `graduated: false` | 毕业后改 `true` 并在行尾注释毕业去向 |
| `source_skill` | skill 名或 `N/A` |
| `scope` / `exceptions` / `supersedes` | 适用范围 / 例外 / 取代哪条——没有范围的规则会被用到不该用的地方 |
| `applied_to` | 本次纠正已落到哪里（文件:段落 / progress.md Decisions 日期 / 派单包），未落地写 `pending` |
| `scores` | 可选，仅 Skill 执行后填：accuracy / coverage / efficiency / satisfaction 1-5 + evidence；evolution-engine 不再拿它当信号 |
| `origin` | 可选，下游项目名；框架仓用 `collect-feedback.sh` 收下游时填（多个逗号分隔），项目内自产留空 |

正文五段：问题描述（引原话）/ 触发场景 / 教训建议 / 适用范围与例外 / 本次落地。新建后同步更新 `FEEDBACK-INDEX.md`，格式 `- [标题](文件名.md) — 一句话描述`。

毕业的样子（`local-green-is-not-ci-green-check-before-closeout.md`）：

```yaml
graduated: true  # 2026-09-10 毕业→CLAUDE.md [开发测试规则]「本地绿只是必要条件」；当天原样复发一次（CI 连红四次）才落地
```

毕业不按出现次数（`evolution-engine/SKILL.md`：计数字段 43 条里 39 条恒为 1，2026-09-12 删掉）。判据两条：**现状核查**——去 CLAUDE.md / rules / SKILL.md / agents 实际 grep，已逐字成文的以既成事实毕业并点名落在哪，部分成文点名缺的那半，压根没有才进提案；**实证门槛**——正文里有真事故（返工、空转、被冻结的功能、重复争议）才提，只有「用户当场纠正」没有代价记录的判「暂不成文」写进 frontmatter，下次不重新裁定。

## 精通：evolution-engine 提议流程

`.claude/skills/evolution-engine/SKILL.md`，`context: fork` + `agent: evolution-runner`，SessionStart 由 `check-evolution.mjs` 触发或手动 `/evolution-engine`。框架仓里扫之前先 `bash .claude/scripts/collect-feedback.sh <下游项目路径…>` 把下游收进来（见 08 章）；下游项目里只分拣不毕业——项目内的 skill 是清单管的副本。

| 信号 | 判据 | 落点 |
|---|---|---|
| 规则毕业 | `graduated == false` 且 `skipped != true` 的每条过现状核查与实证门槛 | `source_skill` 明确 → 对应 SKILL.md；全局性 → CLAUDE.md |
| Skill 优化 | 某 Skill 的未毕业 feedback 有 3 条以上指向同一环节（按主题聚类）；scores 不再当信号 | 修改对应 SKILL.md |
| 新 Skill 提议 | 同族主题跨 3 条以上 feedback 反复出现且无已有 Skill 覆盖 | 调用 skill-builder |

提议格式固定「进化建议（共 N 条）」三段，每条带「确认 / 跳过」。用户逐条确认：毕业 → 写入目标文件并标 `graduated: true`；跳过 → 标 `skipped: true` 不再提。无信号返回「无进化建议」。

## 常见坑

- **description 不是触发式**：`skills-lint` 点 `DESCRIPTION_NOT_TRIGGER_SHAPED`；写「当…时使用」或「由…调用」。
- **frontmatter 布尔加引号**：`disable-model-invocation: "false"` 恒真，loader 读出来的意思正好相反。
- **frontmatter 畸形**：Claude Code 静默丢弃这个 skill，坏掉的和从没写过长得一样；`skills-lint` 是唯一能照出来的地方。
- **加了 skill 没登记 CLAUDE.md**：`test-routing.sh ③` 红（孤儿）；登记了没建目录 `②` 红。
- **hook 只改 `profile.json` 不改 `DEFAULT_PROFILE`**：`test-tier.sh` 相等断言红；缺 profile 的项目按旧表跑。
- **hook 注册了没进 `profile.hooks` 也不在 floor**：`tier validate` 报违规；运行时按最严档跑并在 stderr 喊「不在 profile.hooks 表里」。
- **hook 用 `process.stdout.write`**：管道下异步，写完立刻退出会丢内容；`io.mjs` 一律 `fs.writeSync`。
- **hook import 引擎 `harness/lib/core.mjs`**：引擎 lib 缺失时 hook 自己 `ERR_MODULE_NOT_FOUND` 起不来，「闸跑起来了但引擎坏了」与「闸没起来」混成一件。
- **Stop 类 hook 用 exit 2 拦停**：Stop / PreCompact 的契约是 stdout `decision:block`，退出码留 0。
- **advise 分支不记账**：`gate-audit.sh` 把它当死闸，下次清理就被删。
- **新文件没跑 `gen-manifest.sh`**：不入清单就不随 `setup.sh` 分发。
- **feedback 记项目事实**：那是 progress.md Decisions 的事；feedback 的 `applied_to` 写 `pending` 等于纠正没落地。
- **靠出现次数毕业**：字段已删；看现状核查与实证。
