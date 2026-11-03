# 09 闸门与档位：每道 hook 什么时候响、怎么放行

这章解决的问题：你被某道闸拦住了，或者发现某道闸没响，却不知道它挂在哪个事件、按什么判、在当前档位是提醒还是硬拦、怎么正当地放行。读完你能：

- 对着一张全表说出 21 个注册 hook 各自的事件、matcher、判据、standard 档的行为、放行方式，以及哪五个是任何档都改不了的地板闸；
- 用 `tier status / explain / validate / set` 查看和切换 fast / standard / strict 三档，知道自动升档从哪来、什么时候回落、fast 为什么最多 8 小时；
- 读懂 `gate-block.log` 账本和 `gate-audit.sh` 的报告，按「闸靠数据留」的口径判断一道闸该不该留；
- 知道状态行每一段在说什么。

前置：[08 记忆与恢复](08-memory.md) 已讲过三文件同步与压缩两闸的语义，这里只给它们在表里的位置。

术语：**闸**（guard）= 以 `decision: block` 或 exit 2 表态的 hook；**记账闸**（recorder）= 只记录、提醒、通知的 hook；**地板闸** = 写在 `profile.floor` 里、任何档位都跑全强度的五个。

---

## 入门：先看你现在在哪一档

```bash
node .claude/harness/harness.mjs tier status
```

你会看到（stderr 一行人读结论，stdout 一行机读 JSON）：

```
tier: standard, source=default
{"tier":"standard","source":"default","default":"standard","profilePresent":true,"hooks":{"auto-push":"on","check-evolution":"on","dangerous-pkill-guard":"block","detect-feedback-signal":"on","harness-async-verify":"block","kill-dev-ports":"on","mark-review-needed":"on","no-direct-code-guard":"block","notify":"on","postcompact-reinject":"on","pre-commit-check":"block","precompact-gate":"block","recap-on-dirty":"on","record-authorship":"on","release-gate":"block","secret-exfil-guard":"block","session-rules-banner":"on","stop-gate":"advise","subagent-acceptance-reminder":"on","tdd-gate":"advise","three-file-sync-gate":"advise"}}
```

`hooks` 里每个 id 的值就是它此刻的模式：guard 类是 `off / advise / block`，recorder 类是 `off / on`。`source` 说档位从哪来：`default`（profile 默认）/ `session`（你 `tier set` 过）/ `raise`（家底改动自动升档）。

同一件事的薄壳：`bash .claude/scripts/fast-mode.sh status`（Windows：`pwsh .claude/scripts/fast-mode.ps1 status`），只转出那行人读结论。

### 单个闸怎么判

```bash
node .claude/harness/harness.mjs tier explain stop-gate
```

你会看到：

```
stop-gate: advise now (guard, source default) -- fast=off, standard=advise, strict=block
{"hook":"stop-gate","kind":"guard","floor":false,"tiers":{"fast":"off","standard":"advise","strict":"block"},"effective":"advise","tier":"standard","source":"default"}
```

换成地板闸：

```bash
node .claude/harness/harness.mjs tier explain secret-exfil-guard
```

```
secret-exfil-guard: block now (guard, source floor) -- fast=block, standard=block, strict=block
```

`source floor` 就是「这道闸不在档位表里，三档都是 block，谁也调不了」。

### 被拦了，最常见的三种放行

| 拦你的闸 | 它说什么 | 正当放行 |
|---|---|---|
| stop-gate | 「代码已修改但未 code review（N 个待审文件：…）」 | 派 code-reviewer 审完，`echo clean > .claude/.needs-review` |
| tdd-gate | 「派 implementer 做 GREEN 实现前须先完成 RED」 | 高价值逻辑：派 tester 出失败测试、验红后 `touch .claude/.red-verified`；UI / 样式 / 非 TDD 逻辑：`touch .claude/.tdd-exempt` |
| no-direct-code-guard | 「主 Agent 不应直接写业务源码：src/app.ts」 | 别绕，派 implementer；文档、`.claude/` 下、`*.md *.json *.toml *.sh *.ps1` 本来就豁免 |

Windows 纯 PowerShell：`Set-Content .claude/.needs-review clean`、`New-Item -ItemType File .claude/.red-verified -Force`；Git Bash 里直接用上面的 bash 命令。

---

## 进阶：hook 全表

注册表是 `.claude/settings.json`，全部 21 个 hook 都是 `node ${CLAUDE_PROJECT_DIR}/.claude/hooks/<id>.mjs`，id = 文件名去后缀。`.claude/hooks/static-check.mjs` 不在表里——它不读 stdin、不注册，是 code-review Stage 0 调的脚本。

档位列取自 `.claude/harness/profile.json`；「standard 行为」是本仓默认档下真实发生的事。

### 事件顺序里的 21 个 hook

| 事件 / matcher | hook | 干什么 | 类型 | fast / standard / strict | standard 下 | 放行 / 豁免 | 地板 |
|---|---|---|---|---|---|---|---|
| UserPromptSubmit | detect-feedback-signal | prompt 命中修正信号词 → 注 `additionalContext` 提醒派 feedback-observer | recorder | off / on / on | 提醒 | 信号表 `.claude/hooks/feedback-signals.txt` 可增删 | |
| UserPromptExpansion `release-builder` | release-gate | 你敲 `/release-builder` 时：`.needs-review` 有待审 → `decision: block`；干净 → 注发布前置卡点提醒 | guard | block / block / block | 拦 | 清待审清单 | **是** |
| SessionStart | check-evolution | 数 FEEDBACK-INDEX.md 里未毕业条目，有则提醒派 evolution-runner | recorder | off / on / on | 提醒 | — | |
| SessionStart | session-rules-banner | 播档位 + 六条核心铁律；`source=compact/resume` 静默，fast 档例外照喊 | recorder | on / on / on | 播报 | — | |
| SessionStart | recap-on-dirty | 工作树有未提交改动 → 提醒先 `/recap-project` | recorder | off / on / on | 提醒 | — | |
| PreToolUse `Bash` | pre-commit-check | 命令含 `git commit` 时按 staged 文件的栈跑门禁：`.ts/.tsx` → `npx --no-install tsc --noEmit`；`.py` → `ruff check`，没 ruff 降级 `py_compile` 只认 SyntaxError；`.mjs/.cjs/.js` → `node --check`；大仓启用再跑 `harness verify` | guard | advise / block / block | 任一红 exit 2 拦 commit | 修红；工具没装自动跳过该栈 | |
| PreToolUse `Bash` | kill-dev-ports | 命令是 `pnpm dev*` 时清 3000/3001/4173/5173/8080 端口占用（`CC_DEV_PORTS` 可改） | recorder | off / on / on | 顺手清场，零输出 | — | |
| PreToolUse `Bash` | dangerous-pkill-guard | 拦 `pkill -f` 宽泛匹配（锚定命令起始 / 分隔符，`echo "pkill -f"` 不算） | guard | block / block / block | exit 2 | 先 `pgrep` 拿 PID 再 `kill <PID>` | **是** |
| PreToolUse `Bash` | secret-exfil-guard | 拦四类：直读密钥文件（cat/head/grep… + `.env` 家族 / `id_rsa` / `*.pem` / `credentials`）、拷贝搬运（cp/scp/rsync/mv）、`env\|printenv\|set` 管进 curl/wget/nc、curl/wget/nc 携带密钥文件；先剥 sudo/nohup/timeout/`bash -c` 壳再判 | guard | block / block / block | exit 2 | `.env.example/.sample/.template/.dist` 合法；要个别变量按名取 `printf '%s' "$VAR"` | **是** |
| PreToolUse `Edit\|Write` | no-direct-code-guard | 主 Agent 写业务源码路径 → exit 2；事件带 `agent_id`（子 Agent 内）一律放行 | guard | advise / block / block | 拦 | 路径豁免正则见下；派 implementer | |
| PreToolUse `Agent` | tdd-gate | `tool_input.subagent_type === 'implementer'`、prompt 含 red-lock 关键词（bug / 修复 / 线上 / 解析器 / 契约 / 迁移 / 鉴权 等中英说法，全表在文件头 `RED_LOCK_KEYWORDS`）且 `.claude/.red-verified` / `.tdd-exempt` 都不在（或已过 2 小时）→ 提醒或拦；不含关键词静默；advise 档同一单子一小时内只提醒一次（`.tdd-gate-advised`） | guard | off / advise / block | 只提醒（stderr，exit 0） | `touch` 两个标记之一，2 小时内有效 | |
| PostToolUse `Bash` | auto-push | 命令是 `git commit`（允许夹 `-c` / `-C` 全局选项）且本地领先上游 → 自动 push | recorder | off / on / on | 推 | 没配上游不推 | |
| PostToolUse `Edit\|Write` | mark-review-needed | 业务文件被改 → 登记进 `.claude/.needs-review`（每行一个相对路径，加锁串行写） | recorder | on / on / on | 记 | 根级 `tools/` 与 `.claude/` 豁免；路径归一后出根的不登记 | |
| PostToolUse `Edit\|Write` | harness-async-verify | 大仓启用时后台跑 `harness verify`，FAIL/BLOCKED exit 2 唤醒主 Agent；180 秒防抖；`asyncRewake`，timeout 300 | guard | off / block / block | 无 catalog 立即退出 | 只在大仓启用时有意义 | |
| PostToolUse `Edit\|Write\|NotebookEdit` | record-authorship | 把「谁（`agent_type` / `agent_id` / main）写了哪个文件」喂给 `harness authorship record` | recorder | on / on / on | 无 catalog 立即退出 | 只在大仓启用时有意义；三档全 on | |
| PreCompact | precompact-gate | 待审未清或代码脏而 progress.md 没动 → `decision: block` 一次，10 分钟冷却 | guard | advise / block / block | 拦一次 | `/record` 后重试 | |
| PostCompact | postcompact-reinject | 从文件重新派生 Pinned + 待审 + 档位（装了 ext 走 `harness invariants`）注回 | guard（floor） | — | 注回 | — | **是** |
| Notification `agent_needs_input\|agent_completed\|permission_prompt` | notify | 三类通知转 OSC 777 桌面通知 + BEL，经 `terminalSequence` 由宿主代发 | recorder（floor） | — | 通知 | — | **是** |
| Stop | stop-gate | `.needs-review` 去空行去 `clean` 后仍有文件 → 拦或提醒；同一清单连拦 3 次第 4 次放行并醒目提示 | guard | off / advise / block | **只提醒** | `echo clean > .claude/.needs-review` | |
| Stop | three-file-sync-gate | 代码 / 家底脏而 progress.md 没动；Spec / CHANGELOG 只改一份；同一份脏清单一小时内只提醒一次（`.three-file-sync-advised`） | guard | advise / advise / advise | 只提醒 | 写 progress.md / 成对改 | |
| Stop | three-file-sync-gate（design-detail-sync） | 改了 docs/design/ 某份设计详述代码范围里的代码，设计详述没改 | guard | advise / advise / block | strict 拦 | 同步规则，或只改了测试就补测试名 | 同一个 hook 文件，单独取档 |
| SubagentStop `implementer\|code-reviewer\|tester\|deployer` | subagent-acceptance-reminder | 注给**刚停下的子 Agent 自己**：结论锚到实际跑过的命令、证不出的写 Not verified；回执 Domain findings 有内容时多一句 | recorder | off / on / on | 注 | 每个完成事件只提醒一次（`.claude/.subagent-reminded` 去重） | |

`settings.json` 还设了 `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=25` 和 `permissions.ask`（`gh release` / `npm publish` / `docker push` 三条不该豁免的安全底线）、`permissions.deny`（读 `.env` 家族、`id_rsa`、`~/.ssh`、`credentials.json` 等）。

### 几道闸的细节

**tdd-gate 为什么挂 PreToolUse(Agent) 而不是 Bash**。派 Sub-Agent 走 Agent 工具，永远不经过命令行；按命令文本匹配 `implementer` 只会误伤 `cat …implementer.md` 这类读文件的命令（账本里 19 次 strict 拦停按构造全是这么来的），还教会模型换个写法绕闸。现在只看 `tool_input.subagent_type`，派 tester / code-reviewer 不触发。两个标记的**时效 2 小时**（按 mtime）：本仓一枚 9 月 11 日留下的空 `.red-verified` 让闸静默放行了四天，过期标记比没有标记更坏；过期的当场删掉。

沙箱里 standard 档喂 `{"tool_input":{"subagent_type":"implementer"}}`，你会看到（stderr，rc=0）：

```
[advise] TDD 闸门：派 implementer 做 GREEN 实现前须先完成 RED。
高价值逻辑（契约/解析器/状态机/去重/schema 校验/驱动适配层等）：先派 tester 出失败测试 → 验红 → touch .claude/.red-verified，再派 implementer 写最简实现到绿。
若本 Task 是 UI/样式/非 TDD 逻辑：touch .claude/.tdd-exempt 显式声明豁免。
```

`touch .claude/.red-verified` 后同一事件：静默。strict 档同一段话前缀 `[block]`、rc=2。

**no-direct-code-guard 的两张正则**（`.claude/hooks/no-direct-code-guard.mjs`）：

```js
const EXEMPT = /(\.claude\/|CLAUDE\.md|Product-Spec|DEV-PLAN|progress\.md|CHANGELOG|\/feedback\/|\/agents\/|\/skills\/|\/hooks\/|\.md$|\.json$|\.toml$|\.sh$|\.ps1$)/;
const SOURCE = /(^|\/)(src|app|lib|components|pages|api|server|client|utils|models|services)\//;
```

先看 EXEMPT 命中即放行，再看 SOURCE 不命中也放行；两条之外的（比如 `src/app.ts`）才拦。事件带 `agent_id` 直接放行——settings 里的 hook 在子 Agent 内同样触发，implementer 写 `src/` 本就是它的活（2026-09-15 实测 implementer 写 `src/app.ts` 被拦过，修的就是这一行）。反斜杠先归一，Windows 侧 `src\app.ts` 也拦。

喂主 Agent 事件 `{"tool_input":{"file_path":"src/app.ts"}}`，你会看到（rc=2）：

```
⚠️  [no-direct-code-guard] 主 Agent 不应直接写业务源码：src/app.ts
请派 implementer Sub-Agent 来编写，保持职责边界。
```

同一路径加 `"agent_id":"abc"`：静默 rc=0。`src/README.md`：静默（`.md$` 豁免）。

**stop-gate 的待审清单与三振**。`.claude/.needs-review` 由 mark-review-needed 按文件登记；stop-gate 去掉空行与 `clean` 行后仍有条目就是欠账。放行契约是审完 `echo clean > .claude/.needs-review`，闸放行时顺手把状态文件、锁文件、连拦计数一起删。连拦计数 `.claude/.stop-gate-strikes` 按清单指纹（排序后 sha256）累加，**同一清单连拦 3 次后第 4 次放行**并醒目提示欠账仍在——子 Agent 场景无法自行派 reviewer，没有这条会无限重验。默认档只提醒：放行契约本就是被约束方自己 `echo clean`，外加三振，本质是提醒；2026-09-03 一天拦 38 次、单小时 12 次，纯空转。advise 档不累计连拦。大仓启用后清单清空还要过 `harness receipt verify`（rc 4 = 代码越过所有已审回执，强制重审）。

沙箱里 `.needs-review` 写一行 `src/app.ts`，喂 Stop，你会看到：

```json
{"systemMessage":"[advise] 代码已修改但未 code review（1 个待审文件：src/app.ts）。请派发 code-reviewer sub-agent 审一轮（Stage 0 → 1 → 2）；通过后执行 echo clean > .claude/.needs-review 放行。"}
```

`echo clean > .claude/.needs-review` 后再喂：静默，且 `.needs-review` 文件已被删。

**pre-commit-check 按栈卡**：只看 `git diff --cached --name-only --diff-filter=ACM` 里的文件，改 `.md` 不会触发 tsc；工具缺失一律降级不拦（Windows 上裸 `python3` 常是 Store stub，逐个候选探、只认 `--version` 报出 `Python 3` 的）。fast 档：门照跑、红照报，但不拦这次 commit，账本记 `[fast] … advise 档放行 commit`。自身崩了 exit 2——静默 exit 0 会把「门没跑成」伪装成「门过了」。

**secret-exfil-guard / dangerous-pkill-guard 任何档都拦**，代码里根本不问档位。喂 `cat .env`，你会看到（rc=2）：

```
⛔ [secret-exfil-guard] 检测到直读密钥文件（cat/head 等 + .env/id_rsa/*.pem/credentials），已拦截。
密钥/隐私是安全护栏，Fast Mode 也不豁免。正确做法：
- 需要了解配置结构 → 读 .env.example / 文档，不读真实密钥文件
- 确需操作密钥（轮换/迁移）→ 停下来向用户说明并由用户亲自执行
- 需要个别环境变量 → 按名取用（printf '%s' "$VAR_NAME"），不整包导出外传
```

`cat .env.example`：静默。`pkill -f node`：

```
⛔ [dangerous-pkill-guard] 检测到 pkill -f 宽泛匹配，已拦截。
宽泛 pkill -f 会误杀主 Agent 自身进程（shell wrapper 含相同关键词）。
正确做法：先用 ps/pgrep 拿精确 PID，再 kill <PID>。
```

**release-gate** 是 `/release-builder` 的唯一入口闸（skill 设了 `disable-model-invocation`，主 Agent 不能代触发）。待审清单干净时不拦，注一段提醒，你会看到：

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptExpansion","additionalContext":"发布前置卡点提醒（release-gate 注入）：① 打包前必过测试卡点——test-builder 全量跑，报绿须附运行清单（跑了哪些文件、各自结果），证据=运行器真实输出；② Fast Mode 不豁免发布卡点；③ 部署完成后主 Agent 独立核查三件套（容器创建时间戳+镜像 tag / 健康检查端点 / live 冒烟），不信 deployer 自报。"}}
```

**subagent-acceptance-reminder 注给子 Agent 自己**。实测两例：SubagentStop 的 `additionalContext` 落在刚停下的那个子 Agent 上下文，主 Agent 这侧收不到；官方文档 Stop / SubagentStop 措辞相同只写 "Added to Claude's conversation"，不判归属。所以文案按第二人称写给它。主 Agent 验收没有机器提醒兜底，靠读回执正文。

**notify** 输出的是终端转义序列：

```json
{"terminalSequence":"]777;notify;Claude Code;implementer done"}
```

hook 进程没有 `/dev/tty`，直写会失败；`terminalSequence` 是官方指定通道，Notification 事件忽略退出码与 stderr。

**record-authorship / harness-async-verify** 都以 `.claude/harness/module-catalog.json` 存在为开关，没 catalog 立即退出、不写任何文件。本仓没 catalog，这两道在这里从不干活；record-authorship 三档全 on 是因为作者账本一断，review 的「评审者不是作者」判定就失明，而它不拦任何东西、省不出什么。

### 子 Agent 里 hook 照样触发

settings 里的 hook 在子 Agent 内同样跑，事件多带 `agent_id` / `agent_type` 两个字段。三个 hook 靠它分流：no-direct-code-guard 见 `agent_id` 放行；record-authorship 用 `agent_type` 记作者、缺则退 `agent_id`、都无记 `main`；subagent-acceptance-reminder 用 `agent_id` 去重。

---

## 精通：档位的解析与账本

### 三档一张表

强度不是一个开关，是 `.claude/harness/profile.json` 里的一张表：每个非地板 hook 在三档下的模式。本仓这份：

| hook | kind | fast | standard | strict |
|---|---|---|---|---|
| stop-gate | guard | off | advise | block |
| three-file-sync-gate | guard | advise | advise | advise |
| design-detail-sync | guard | advise | advise | block |
| precompact-gate | guard | advise | block | block |
| pre-commit-check | guard | advise | block | block |
| no-direct-code-guard | guard | advise | block | block |
| tdd-gate | guard | off | advise | block |
| harness-async-verify | guard | off | block | block |
| mark-review-needed | recorder | on | on | on |
| record-authorship | recorder | on | on | on |
| auto-push | recorder | off | on | on |
| kill-dev-ports | recorder | off | on | on |
| subagent-acceptance-reminder | recorder | off | on | on |
| detect-feedback-signal | recorder | off | on | on |
| check-evolution | recorder | off | on | on |
| recap-on-dirty | recorder | off | on | on |
| session-rules-banner | recorder | on | on | on |

- **floor**：`secret-exfil-guard` / `dangerous-pkill-guard` / `release-gate` / `postcompact-reinject` / `notify`。结构上的地板写死在 `hooks/lib/tier.mjs` 的 `BUILTIN_FLOOR`，profile 的 `floor` 只能往里加、不能往外拿——把某闸从 floor 里删掉就能让它吃 fast，那 floor 就只是一句措辞。
- **guard 三态**：`off` 静默放行 / `advise` 照判照记账但只出提醒不拦 / `block` 拦。**recorder 两态**：`off` / `on`。
- **raise**：`to: strict`，`paths` = `.claude/hooks/**` `.claude/harness/**` `.claude/skills/**` `.claude/agents/**` `.claude/CLAUDE.md` `.claude/rules/**` `.claude/settings.json` `.github/**`。
- **overrides**：`{}`，项目级单闸覆盖写这里。

三档的口径（`.claude/CLAUDE.md` [档位]）：**standard** = 现行流程，stop-gate / three-file-sync-gate / tdd-gate 只提醒，no-direct-code-guard / pre-commit-check / precompact-gate 真拦；**strict** = stop-gate、tdd-gate 与 design-detail-sync 也真拦，人当审批者；**fast** = guard 类只提醒并记债（stop-gate 直接 off、mark-review-needed 照记——不派 reviewer 就没有「未审查」可提醒，但债得记下，撤销 fast 时 stop-gate 才有账可提），流程侧不自动派 tester / reviewer、不受四步走约束，静态检查照跑。fast 不等于部署或 push 授权，`release` 装配在 fast 生效时 `tier` 项直接 FAIL。

### 档位怎么算出来的

单一解析器 `.claude/hooks/lib/tier.mjs`，引擎（`harness/lib/tier.mjs`）从它 import，依赖方向只许「引擎 → hook lib」——缺陷 #38 就是同一个开关被三处各解析一遍、一边判开一边判关。

三个输入，合并规则「**只抬不降**」（秩 fast < standard < strict，取高者）：

| 输入 | 来源 | 细节 |
|---|---|---|
| ① profile.default | `profile.json` | 缺文件或坏 JSON → 用内置 `DEFAULT_PROFILE`（与分发的 profile.json 逐项相同），坏文件记进 `.claude/harness/state/quarantine.jsonl` |
| ② 会话覆盖 | `.claude/.runtime/tier.json` | **只有 `tier set` 写**，hook 只读；未过期才算数（`sticky: true` 且 `expires_epoch: null` 的记录不看过期，到 `tier set standard` 为止）；与默认同档的记录不算覆盖（`source` 仍报 `default`，否则分不出「钉住了」和「刚关掉 fast」） |
| ③ 治理面自动升档 | `git status --porcelain -z -uall` 里命中 `raise.paths` 的路径 | 运行态目录（`.claude/.runtime/` `.claude/evidence/` `.claude/harness/state/` 等）与 `.needs-review` 不算——否则跑一次闸落一行账本就把档位钉死在 strict |

`gateMode(id)` 的优先级：floor → overrides → 档位表。未登记的 id 按该种类最严值跑并 stderr 警告一句——漏登记不静默。hook 侧调 `gateModeOf(id)` 是动态 import；判定库缺失时退到 `io.mjs` 的 FALLBACK：guard 里 `stop-gate / tdd-gate / three-file-sync-gate` 回 `advise`、其余 guard 回 `block`、recorder 回 `on`——正好是 standard 那一列。

**三张表必须一致**：`profile.json`、`hooks/lib/tier.mjs` 的 `DEFAULT_PROFILE`、`hooks/lib/io.mjs` 的 `FALLBACK_GUARDS / FALLBACK_ADVISE`。改任何一张都要对另外两张；`tier validate` 只校前一张的内部一致性，不校三张互相对齐（本仓 2026-09-15 逐项核对过，三张一致）。

### fast：必带 reason，8 小时硬上限；连续开发期 --sticky

```bash
node .claude/harness/harness.mjs tier set fast --hours 2 --reason "脚手架期批量改文案"
node .claude/harness/harness.mjs tier set fast --sticky --reason "脚手架期连续开发"   # 到撤销为止；与 --hours 互斥；tier set standard 撤
# 薄壳（hours 默认 24，引擎会截到 8 并说明）
bash .claude/scripts/fast-mode.sh on 2
bash .claude/scripts/fast-mode.sh off        # = tier set standard --reason "fast-mode.sh off"
```

Windows：`pwsh .claude/scripts/fast-mode.ps1 on 2 | off | status`。

`tier set` 的拒绝面比接受面大（`harness/lib/tier.mjs` `cmdTierSet`）：未知档 rc 2；`fast` 不带 `--reason` rc 2；`--hours` 给非 fast 档 rc 2；hours 非正数 rc 2；`--sticky` 与 `--hours` 同给 rc 2、`--sticky` 给非 fast 档 rc 2；超 8 截到 8 并 stderr 说明。写下的文件：

```json
{"tier":"fast","reason":"…","by":"user","set_epoch":<now>,"expires_epoch":<now+hours*3600>}
{"tier":"fast","reason":"…","by":"user","set_epoch":<now>,"expires_epoch":null,"sticky":true}
```

读侧再夹一次：fast 记录缺 `set_epoch` / `expires_epoch` 不认（红蓝审查曾靠缺 `set_epoch` 换来 642713 小时的 fast）——sticky 记录要 `sticky: true`、`expires_epoch: null`、`set_epoch` 在、reason 非空四样齐全才认：缺 `set_epoch` 照旧按坏记录隔离，其余缺一样按普通 fast 处理（要么被夹回 8 小时、要么判已过期静默回默认档），拿不到无限期；锚点取 `min(set_epoch, now)` 防写到未来平移窗口；到期返回 null 自动回默认档，不靠人记得关。sticky 是这条的例外，也是有代价换来的：两个下游项目把「开工先切快速档并持续续期」写进 Pinned、两天续了 4 次，每次过期回 standard 那一刻 tdd-gate / stop-gate 立刻开响，一个月 113 + 326 条账本多数来自这个缝（#91）；换成到撤销为止后，statusline 与 session-rules-banner 改显示「到撤销」提醒你它还开着。本仓 `.claude/.runtime/tier.json` 此刻就躺着一份 2026-09-06 的 fast 记录，`tier status` 照样报 `standard / default`——过期即无效，文件留着不碍事。

每次 `tier set` 记一行账本：`tier	set fast (2026-09-06T…Z) -- <reason>`。降档必须留理由，事后 `gate-audit` 能统计 fast 期跳过了哪些闸。

session-rules-banner 在 fast 生效时开场必喊：`‼️ tier: fast（剩 N h，<reason>）：治理闸只提醒不拦，欠账照记…修完跑 bash .claude/scripts/fast-mode.sh off 恢复严格模式`，compact / resume 之后也喊——别的闸静默、就它反向。

### 自动升档与回落

工作树里改了 `raise.paths` 任一路径，本轮自动进 strict，`tier status` 的 `source: raise` 并在 `raisedBy` 点名文件；session-rules-banner 开场会说「工作树改了 X——治理面改动自动升档，本轮闸按最严跑」。**提交后自动回落**——判定看的是 `git status`，改动进了库就不再脏。升档不需要人，降档必须带 reason。

这就是为什么改 hook / skill / CLAUDE.md 时 stop-gate 和 tdd-gate 突然开始硬拦：你在动家底，strict 是设计好的。

### overrides 与 validate

项目级微调写 `profile.json` 的 `overrides`：

```json
"overrides": { "tdd-gate": "off" }
```

`tier explain tdd-gate` 会标 `source: override`。改完必须：

```bash
node .claude/harness/harness.mjs tier validate
```

你会看到（本仓）：

```
{"ok":true,"degraded":false,"file":".claude/harness/profile.json","registeredHooks":21,"registeredHooksReadable":true,"violations":[]}
```

它校什么（`validateProfile`，每条 finding 点名 hook）：

| 代码 | 含义 |
|---|---|
| `UNKNOWN_FIELD` / `UNKNOWN_ROW_FIELD` / `UNKNOWN_RAISE_FIELD` | 拼错的键被当成没有，设置永不生效 |
| `BAD_DEFAULT` / `BAD_RAISE_TO` | 档名不在 fast / standard / strict |
| `FLOOR_NOT_A_HOOK` / `NOT_A_HOOK` | floor 或表里写了 settings.json 没注册的 id——「一行没人读的配置比没有更坏，因为它看着像配了」 |
| `FLOOR_IN_TABLE` | 地板闸又出现在档位表里 |
| `BAD_KIND` / `BAD_MODE` | kind 不是 guard / recorder；guard 写了 on、recorder 写了 block |
| `NOT_MONOTONIC` | 某行低档比高档严——fast ≤ standard ≤ strict 是「档位被降了」对每道闸含义一致的前提 |
| `UNREGISTERED` | settings.json 注册了、表里和 floor 都没有的 hook，会按最严兜底跑 |
| `OVERRIDE_ON_FLOOR` / `FLOOR_OVERRIDE` / `BAD_OVERRIDE` | overrides 指向地板闸或值非法 |

退出码：0 合规 / 1 有违规 / 3 没有 profile.json（内置表在跑，无物可校——不是通过）。注册清单从 settings.json 的 `args[0]` 现算，不写死。

### gate-block.log 账本

所有拦停与 advise 提醒走 `.claude/hooks/lib/gatelog.mjs`，追加到 `.claude/evidence/gate-block.log`，一行 `<ISO-8601 UTC>\t<hook>\t<reason 首行>`。写不上账吞掉不抛——账本是旁路，绝不改变闸的判决。advise 档的提醒也记（前缀 `[advise]`）：不 block ≠ 不吭声，欠账得看得见。

```bash
tail -5 .claude/evidence/gate-block.log
```

你会看到（本仓）：

```
2026-09-15T06:23:35Z	stop-gate	代码已修改但未 code review（2 个待审文件：setup.sh、setup.ps1）。请派发 code-reviewer sub-agent 审一轮（Stage 0 → 1 → 2）；通过后执行 echo clean > .claude/.needs-review 放行。
2026-09-15T06:37:49Z	tdd-gate	未验红即派 implementer 写码，strict 档拦停
2026-09-15T07:14:15Z	dangerous-pkill-guard	拦截 pkill -f 宽泛匹配
2026-09-15T07:19:36Z	secret-exfil-guard	检测到拷贝/搬运密钥文件（cp/scp/rsync/mv + 密钥文件名）
2026-09-15T08:15:53Z	stop-gate	[advise] 代码已修改但未 code review（2 个待审文件：setup.sh、setup.ps1）。…
```

同一天先是 strict（家底改动升档）下的硬拦，提交后回落 standard 变成 `[advise]`——账本本身就能读出档位的变化。

### gate-audit：闸靠数据留

```bash
bash .claude/scripts/gate-audit.sh
```

你会看到（本仓，2026-09-15）：

```
── (a) 有战绩的钩子（按拦截次数降序）──
钩子名                      拦截次数  首次                末次
stop-gate                            40  2026-09-03T06:45:24Z  2026-09-15T08:15:53Z
three-file-sync-gate                 33  2026-09-01T15:29:14Z  2026-09-12T07:21:00Z
tdd-gate                             20  2026-09-05T21:58:31Z  2026-09-15T06:37:49Z
secret-exfil-guard                   17  2026-08-16T13:28:47Z  2026-09-15T07:19:36Z
dangerous-pkill-guard                 9  2026-09-04T05:15:35Z  2026-09-15T07:14:15Z
tier                                  8  2026-09-06T07:31:23Z  2026-09-06T07:31:24Z
precompact-gate                       2  2026-08-16T13:30:55Z  2026-09-06T11:40:04Z
release-gate                          1  2026-08-16T13:30:55Z  2026-08-16T13:30:55Z

── (b) 零记录钩子（注册了但从没拦过：前置条件不在本仓，或威慑生效）──
  • harness-async-verify
  • no-direct-code-guard
  • pre-commit-check

  本仓能力上下文：
  module-catalog.json：无
  tsconfig.json：0 个
  .py 文件：0 个
  以上某项不在本仓，对应的闸在这就没有可拦的场景，零拦停无从评价——
  退役任何一个闸之前，先查下游项目的 .claude/evidence/gate-block.log。

── (c) 汇总 ──
  注册钩子：10 个
  有记录　：7 个
  零记录　：3 个
```

怎么读：

- 「注册钩子 10 个」是源码里引了 `gatelog` 的 hook（能写账本的那批），不是 settings 里的 21 个——auto-push、banner 这类信息 hook 永远零记录，纳进来就必然被误报成死闸。
- 零记录先看 (b) 下面的能力上下文：本仓没有 tsconfig、没有 .py、没有 catalog，pre-commit-check 和 harness-async-verify 在这里压根没有可拦的东西；no-direct-code-guard 零记录更可能是威慑生效。**框架仓审自己的闸会系统性低估「为下游而存在」的那批**，退役前查下游项目的账本。
- 账本只在拦停时写，没有「跑过 N 次」这个分母，零拦停推不出死闸。
- `tier` 那 8 行是 `tier set` 留的痕，不是闸。
- 找到的账本文件数 > 1 说明有 worktree 各自落账，脚本会把主仓和所有 worktree 的都汇总。

`.claude/CLAUDE.md` [开发测试规则] 的口径：某闸长期全过、从没产出过 FIX_REQUIRED 或红，就简化或删掉；加闸要能说出它挡住过什么。stop-gate 默认档降成 advise、tdd-gate 改挂 Agent 事件，都是这张表推出来的决定。

### 状态行

`.claude/scripts/statusline.mjs` 注册在 `settings.json` 的 `statusLine`，每次渲染都跑，必须便宜、必须安静，任何异常降级输出静态 `cc-base`。喂一段假的会话 JSON：

```bash
echo '{"model":{"display_name":"Fable"},"context_window":{"used_percentage":42},"cost":{"total_cost_usd":1.23},"workspace":{"project_dir":"'$PWD'"}}' | node .claude/scripts/statusline.mjs
```

你会看到（本仓此刻有 2 个待审文件，红色）：

```
[Fable] | ctx 42% | $1.23 | tier: standard | 待审 2
```

| 段 | 来源 | 何时变色 |
|---|---|---|
| `[模型]` | stdin `model.display_name` | — |
| `ctx NN%` | `context_window.used_percentage` | ≥ 80 红 |
| `$成本` | `cost.total_cost_usd` > 0 | — |
| `tier: X` | `effectiveTier()`，自动升档标 `(raise)` | fast 黄，附剩余小时 `tier: fast 3.9h` |
| `待审 N` | `.claude/.needs-review` 有条目 | 红 |
| `harness ON` | `.claude/harness/module-catalog.json` 存在 | 绿 |

档位段走 `effectiveTier` 而不是只读 tier.json——自动升档也算数，状态行说的档必须就是闸此刻按的档，代价是一次 `git status`（与每个 hook 每次事件付的是同一笔）。

### 自己喂事件看闸的反应

照 `.claude/tests/test-hooks-node.sh` 的做法，在 `/tmp` 造沙箱，`CLAUDE_PROJECT_DIR` 指过去，hook 用本仓路径：

```bash
SB=$(mktemp -d); cd "$SB" && git init -q . && mkdir -p .claude src
printf '{"tool_input":{"file_path":"src/app.ts"}}' \
  | CLAUDE_PROJECT_DIR="$SB" node /path/to/cc-base/.claude/hooks/no-direct-code-guard.mjs; echo "rc=$?"
```

沙箱没有 profile.json → 内置表 → standard。账本写到 `$SB/.claude/evidence/gate-block.log`，不碰本仓。地板闸的全份用例在 `test-hooks-floor.sh`，提醒类每个 hook 一条主路径在 `test-hooks-node.sh`，见 [12 框架自测与 CI](12-selftest-ci.md)。

---

## 常见坑

| 坑 | 现象 | 怎么办 |
|---|---|---|
| 改了一个 hook，stop-gate / tdd-gate 突然硬拦 | `tier status` 报 `source: raise`，`raisedBy` 点名你改的文件 | 这是设计：家底改动自动 strict；提交后回落。别为此 `tier set fast` |
| `tier set fast` 报 rc 2 | 没带 `--reason` | fast 必须留理由；`fast-mode.sh on` 会替你填 `fast-mode.sh` |
| 以为 fast 能跳过密钥 / pkill / 发布闸 | 照样 exit 2 | 五个地板闸不吃档位；fast 也不是 push / 部署授权 |
| `.red-verified` 摸了但 tdd-gate 还响 | 标记超过 2 小时被当过期删掉 | 验红是「这一轮」的事，重新验红重新 touch |
| 手改 `.claude/.runtime/tier.json` 想开长一点的 fast | 读侧夹到 `set_epoch + 8h`；缺字段整份不认 | 只用 `tier set`，8 小时到了再开一次 |
| 改 profile.json 后闸行为不对 | 拼错的键被静默忽略 | 每次改完 `tier validate`，读 `UNKNOWN_FIELD` / `NOT_MONOTONIC` |
| 把某闸从 `floor` 里删掉想放水 | 没用 | `BUILTIN_FLOOR` 写死在 `hooks/lib/tier.mjs`，profile 只能加不能减 |
| stop-gate 明明有待审却放行了 | 同一清单已连拦 3 次，第 4 次放行并提示 | 看 systemMessage 里的「欠账仍在」，派 reviewer；别把三振当通过 |
| `.needs-review` 里有一行永远清不掉 | 路径是 Windows 反斜杠或出根路径 | mark-review-needed 已归一；手工写的行按相对项目根、正斜杠写 |
| implementer 写 `src/` 被 no-direct-code-guard 拦 | 事件没带 `agent_id`（旧版 Claude Code） | 升级 Claude Code；这条放行靠宿主传 `agent_id` |
| gate-audit 报某闸零记录就想删 | 本仓没有它的前置条件 | 先查下游项目账本；零拦停推不出死闸 |
| 三张档位表改了一张 | 判定库缺失时 FALLBACK 走旧值 | profile.json / DEFAULT_PROFILE / FALLBACK 三处同改 |
| Windows PowerShell 5.1 里 `echo clean > .claude/.needs-review` | 文件编码可能不是 UTF-8 | 用 Git Bash，或 pwsh 7 的 `Set-Content` |

下一章：[10 Sub-Agent 派发精通](10-subagents.md)。
