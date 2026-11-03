# audit —— 跑在引擎之外的独立审计脚本

`harness.mjs` 是治理引擎；这个目录是**不依赖它**的三只哨兵。

## 为什么故意不 import 引擎

1. **引擎坏了它们还得能跑**。`harness.mjs` 是单文件 14 万字符的运行时，
   它自己出一个语法错，所有走它的检查同时哑掉——而「检查哑掉」和「检查通过」
   在退出码上长得一模一样。独立观察者不共享这个失败模式：`check-syntax.mjs`
   要能在 `harness.mjs` 已经语法崩坏时告诉你它崩了。
2. **它们是 git hook / CI 的第一道**。这一层要能在没有 catalog、没有配置、
   甚至没装任何东西的仓库里直接 `node <path>` 就跑起来。引擎的定向能力
   （impact / verify / arch-check）无 catalog 一律 rc 3 降级，兜底面不能跟着降级。
3. **不受档位调节**。引擎侧的检查按模块档位收放（见 `.claude/harness/ext/rules/quality-attributes.md`），
   这是对的——但一个能被调到静音的底线不叫底线。这三只没有档位可调。

代价是有重叠（尤其 `scan-secrets` 与 fitness 的 `no-secret-literal`）。重叠是故意的。

## 三只哨兵

| 脚本 | 回答的问题 | 扫描面 |
|---|---|---|
| `scan-instructions.mjs` | 自动进模型上下文的指令文件里，有没有注入 / 凭据 / 外传 / 隐藏字符？ | CLAUDE.md、`.claude/rules/**.md`、`**/skills/*/SKILL.md`、`.claude/agents/*.md`、`.claude/settings.json`、AGENTS.md、GEMINI.md、`.cursorrules`、`.cursor/rules/**`、`.github/copilot-instructions.md`、`.windsurfrules` |
| `scan-secrets.mjs` | 提交面上有没有凭据字面量？ | 全部 tracked（或 staged）文本文件 |
| `check-syntax.mjs` | 框架自己的资产还解析得动吗？ | `.mjs/.cjs/.js`、`.json`、`.sh`、`.ps1`、SKILL.md 与 agents 的 frontmatter |

### scan-instructions.mjs

指令文件是**执行邻接**的输入：cc-base 会在人未必打开过它们的情况下把 CLAUDE.md、
各条 rules、每个 SKILL.md、每个 agent 定义送进模型上下文。2026 年的实测结论是
这已经是活跃攻击面——AI 指令文件里被发现过外泄的 API key 和被改写的模型 base URL，
README / 指令注入是被记录在案的劫持编码助手的手法。所以这个脚本把这些文件
**当不可信输入**扫，而不是当自家文档。

八条规则（除最后一条外都是 error 级）：

| 规则 | 抓什么 |
|---|---|
| `endpoint-override` | 端点与凭据落点的环境名被赋值——名字按「厂商词 + 前后缀通配 + 落点词」认（`ANTHROPIC_BEDROCK_BASE_URL` 这种中缀形态、`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` 这两个无前缀凭据落点都在内），另认 Windows 的 `setx NAME value` 空格形态和各类 `*_PROXY` |
| `embedded-credential` | 与 `scan-secrets` 同一张格式表：`sk-ant-` / `sk-proj-` / `sk-` / `ghp_` / `github_pat_` / `glpat-` / `AKIA` / `AIza` / `hf_` / `npm_` / `xox?-` / JWT 三段式、PEM 私钥块 |
| `instruction-override` | `ignore previous instructions` 一类话术——仓库提供的文本是权限最低的一层，声称自己更高的文本就是注入 |
| `exfiltration-command` | `curl` / `Invoke-WebRequest` 带上传参数（`-d` / `--data` / `-F` / `-T` / `-Method Post`），`wget` 按它自己的上传参数认（`--post-data` / `--body-file`；`-T` 在 wget 是超时，不是上传），或 `nc` 反连 |
| `silent-execution` | 下载管道直灌 shell（`curl ... \| sh`、`iex (iwr ...)`) |
| `hidden-characters` | 零宽与双向控制字符——人看不见而模型读得到的文本，按构造就是为了逃过审查 |
| `gate-disable-instruction` | `--no-verify`、`skip the hook/gate/check/test`、`disable the lint`——教唆绕自己的闸。**只认肯定祈使**：同一子句里带 never / do not / must not / forbidden / 禁止 / 不许的反向禁令不报，命中数计进 `counts.prohibitionSkips` |
| `secret-file-read`（warning） | 文本点名 `.env` / `id_rsa` / `.ssh/` / `.aws/credentials` / `.npmrc` |

`.claude/settings.json` 也在扫描面内：它不是散文，但 `env` 块正是改写 `ANTHROPIC_BASE_URL`
的落点，而 Claude Code 读它同样不需要人先打开。JSON 的键带引号（`"KEY": "v"`），
`endpoint-override` 因此在名字和分隔符之间容一个可选引号——只认 `KEY=` 的写法会把
整个 JSON 形态放过去。

### scan-secrets.mjs

不分级、不看 catalog、给 git hook 和 CI 用的兜底面。二进制按 NUL 字节探测跳过
（不靠扩展名猜），超过 1 MB 的文件**记进 `degraded` 并让整次运行退 3**——
「文件里有 token 但没人看过」和「扫过了很干净」必须是两个退出码。
`*.example` / `*.sample` / `*.template` / `.env.example` 走白名单（这是范围之外，
不是没扫成，仍按 rc 0 算）。submodule（gitlink，mode 160000）同属「范围之外」而不是
「没扫成」——它在本仓根本没有字节。把它记成降级会让任何带 submodule 的仓恒退 3，
而恒红的闸等于没有闸，接闸的人下一步就是忽略 rc 3。

规则分两类，处理方式不同：

- **confident**（`ghp_` / `github_pat_` / `glpat-` / `sk-ant-` / `sk-proj-` / `sk-` /
  `AKIA` / `aws_secret_access_key` 的 40 字符值 / `AIza` / `hf_` / `npm_` / `xox?-` /
  stripe live key / JWT / PEM 块）——形状本身就没有无辜解释，**不做上下文豁免**。
  这张表是这只脚本的价值所在：只认 `ghp_` 而不认 `sk-ant-` / `github_pat_` 的表，
  对今天真正在泄的东西一律报干净。
- **heuristic**（`password=` / `api_key=` 这类赋值猜测，只有 `generic-assignment` 一条）——
  同一行出现 `example` / `placeholder` / `process.env` 等占位语境时跳过；此外**值必须是字面量**：
  裸值只许由 `[A-Za-z0-9_+=-]` 组成（带 `.` `(` `[` `$` `/` 的是表达式、路径或变量引用，
  `password = self.password.encode(...)` / `passwd = fallback_getpass(prompt, stream)` /
  `api_key = os.environ["X"]` 全是「从别处读密钥」这个正确写法），且必须字母数字混合、
  不同字符数 ≥6（`the-value-you-copied` 这种散文词组不算凭据）。
  引号不再是判据本身——dotenv 与 YAML 最常见的写法本就不带引号；但「不带引号」放开时
  必须把「值得是字面量」这条一起接住，否则规则会淹掉：同一份 250 万行零密钥真实语料
  （python stdlib / dist-packages / node_modules / TypeScript），**放宽引号后 277 命中、
  加上字面量判据后 4 命中，真阳性一条不少**。

### check-syntax.mjs

cc-base 把行为写在配置里：hook 是 `.sh`/`.ps1`，引擎是 `.mjs`，接线是 `.json`，
而每个 skill 与 agent 是一份靠 YAML frontmatter 决定「是否被加载」的 Markdown。
**畸形 frontmatter 不报错，skill 只是不存在了**——这是本仓最贵的静默失败，
所以它单独占一类检查。

- `.mjs/.cjs/.js` → `node --check`；`.claude/workflows/` 下的 Workflow 脚本（允许顶层 `return` / `await`）先包一层 async function 再查，判定不随 node 版本变
- `.json` → `JSON.parse`
- `.sh` → `bash -n`
- `.ps1` → `[System.Management.Automation.Language.Parser]::ParseFile`（批量一次调用）
- SKILL.md / `.claude/agents/*.md` → frontmatter 能否被解析（`---` 包裹，
  `key: value`、嵌套映射、列表项、注释、可跨行的引号标量、块标量）

这里没有 YAML 解析器（零依赖，而且手搓一个的下场就是和真正的加载器意见相左），
所以子集收窄到 Claude Code frontmatter 实际用到的构造。**超出子集的写法
（流式集合 `{}` `[]`、锚点 / 别名 / 标签、显式键、合并键、指令行）报
`UNDECIDABLE`**——不判对也不判错，只说这个检查器不裁定，同样计退出码 3。

判失败的是这些（每条都对着 `yaml.safe_load` 逐条核过，方向全是「真 YAML 非法而这里
放过了」的假阴——那是最坏的一种错，读起来是绿的、真加载器却把整个 skill 丢掉）：

- 裸值里出现 `": "` 或以 `:` 结尾。**这是本仓最可能踩的一格**：skill / agent 的
  `description:` 就是长句散文，补一个 ASCII 冒号（`description: ... 触发: 用户要求审查代码`）
  就非法，而畸形 frontmatter 不报错、skill 只是不存在了。
- 裸值以 YAML 保留指示符 `@` / 反引号 / `%` 开头，或以 `- ` 开头（那是序列项），
  或块标量头写坏（`|literal` 这种指示符后直接接文本）。
- 缩进栈对不上的错误 dedent（4 空格进去、2 空格出来）——只跟上一个 key 比缩进看不出来。
- 块标量正文的缩进区里出现制表符；以及顶层的制表符缩进、跨行未闭合的引号。
- 已经带标量值的 key 底下再出现 `key: value`（标量之下不能挂映射）。

`--staged` / `--paths` 与另外两只同义：`--staged` 从索引取内容（外部解析器只能读真文件，
所以索引内容会落进临时副本再交给 `node --check` / `bash -n` / PowerShell 解析器，
报错里的临时路径会被换回原路径），`--paths` 只收窄文件集、不改内容来源。

**规模边界**：每个文件起一次子进程，实测 500 个 `.mjs` + 300 个 `.sh` 耗 **8.8 s**
（node v24 / Linux）。按这个斜率，几千个文件的仓库用 `--staged` 或 `--paths` 收窄到
待提交集才跑得动，全量扫适合放进 CI 而不是每次 commit。批量化解析是后续的事。

**缺检查器 = SKIPPED，不是 PASS**：没有 bash 或没有 pwsh 时，该类被显式打印为
`SKIPPED`、写进 JSON 的 `skipped` 字段，**并让 `ok` 为 false、退出码为 3**。
26 个 `.ps1` 一个没验却报 rc 0 `ok:true`，读起来就是「验过了，没问题」——
而实际发生的是没人打开过它们。
PowerShell 侧包一层「wrapper 永远 exit 0、坏文件走 stdout」，这样
**语法错**和**检查器自己炸了**不会被混为一谈——后者报成 `ps1-checker` 失败。

## 共同契约

- **stdout 永远是单行 JSON**，人读诊断一律走 stderr；`--json` 关掉 stderr 人读行。
- 退出码：`0` **范围内全扫过且干净** / `1` 有命中 / `2` 参数错（拼错的 flag、悬空的
  `--paths`、`--paths` 点名的路径一个都不存在）/ `3` **降级**——非 git 仓（**拒绝猜文件集**）、
  该扫却没扫成（超限、读不动、整类没检查器、超出可判定子集、`--paths` 部分路径不存在）。
  `0` 和 `3` 的分界就是这三只存在的理由：**没扫到永远不许读作干净**，
  所以 `ok` 在降级时同样是 false。命中优先于降级（真命中更可执行，且 git hook 本来就卡 1）。
- **「没东西可扫」不是降级**。清单取到了、里面没有本检查器认识的类（只提交文档的 commit、
  空暂存集、全是图片的仓），报 `notes` 里的 `nothing-in-scope` 并**退 0**，输出里
  `listed` 与 `in-scope` 两个数都在。把它算降级会让每个文档 commit 都亮一次黄灯，
  而恒亮的灯和不亮没区别——这三只自己就是靠「恒红=没红」这条立论的。
  唯一的例外是 `listing-empty-but-repo-nonempty`：tracked 模式一个都没列出来、
  但 HEAD 里明明有文件——那是清单机制不再描述这个仓（子目录那个 bug 从外面看就长这样），
  单列一个 kind、退 3，不和 `nothing-in-scope` 混。
- **一律以仓根为基准**：先 `git rev-parse --show-toplevel` 定位再进去跑，文件清单、
  内容读取、报告路径共用一个原点。`git ls-files` 在子目录只列该子树、且按该子目录相对命名，
  所以从 `.claude/` 里跑曾经让三只同时报 rc 0 `ok:true`——同一个仓、同样的三处真缺陷，
  换个当前目录就全绿。**当前目录不许参与安全判定**。
- `--staged` 三只都有，文件名**和内容都来自索引**（`git diff --cached` + `git show :<path>`）。
  从索引取名单、却从工作树读内容，是同时制造漏报和误报：暂存了密钥再把磁盘擦干净会放过去，
  只存在于磁盘上的改动会拦住一次并不包含它的 commit。默认模式走 `git ls-files` + 工作树，
  两者都用 `-c core.quotePath=false` + `-z`，非 ASCII 文件名不会被转义打断。
  代价：`--staged` 每个文件起一次 `git show`，面向的本来就是体量小的待提交集。
- `--paths`（`scan-instructions` 与 `check-syntax` 有，`scan-secrets` 没有）**只收窄文件集，
  不改内容来源**。`--staged --paths X` 仍然判索引——让 `--paths` 悄悄把 `--staged` 吃掉，
  等于给「工作树内容冒充待提交内容」这个已修的缺陷留了一个加个 flag 就能走的后门。
  点名的路径不存在时按**程度**分档：**部分**不存在 → 剩下的照扫、缺的逐条进 `degraded`
  的 `path-not-found`、退 3（不许把「只扫到一半」读成扫完了）；**一个都不存在** → 退 2，
  因为这时候这条命令面对的根本不是这个仓（跑错目录、参数写错、清单过期），属参数错。
  两种情况都不会静默：扫零个「你要我扫的文件」然后报干净，正是这一族脚本要防的那种绿。
- 源码**纯 ASCII**（同 `harness.mjs` 与 `.ps1` 约定），零 npm 依赖，只用 node 内置模块。
- **命中不回显原文**：凭据类命中的 excerpt 会做 REDACTED 处理。扫描器把密钥
  原样打进 CI 日志，等于替攻击者又发布了一次。
- 用 `fs.writeSync` 而不是 `process.stdout.write` 输出契约行——管道上的异步写
  遇到进程退出会截断，截断的 JSON 是看不见的失败。

## 压制：两种机制，按「被扫文件可不可信」分

**`scan-instructions` 没有行内标记**。这个脚本的全部立论是「被扫文件不可信」，
而让不可信文件里的一行 `scan-instructions:ignore` 关掉对它自己的扫描，是逻辑自毁——
能写进注入载荷的人，同样能写进那行静音，且旧实现连一条痕迹都不留。
豁免改走**外置白名单** `.claude/harness/audit/instructions-allowlist.json`
（相对被扫仓的路径解析：豁免是这个仓的账，跟着仓走，不跟着脚本走）：

```json
{
  "version": 1,
  "entries": [
    { "file": "CLAUDE.md", "line": 12, "rule": "endpoint-override",
      "sha256": "<该行内容的 sha256，不含行尾换行>",
      "context": "<上一行 + 该行 + 下一行、用 \n 连接后的 sha256>",
      "reason": "为什么这条是良性的" }
  ]
}
```

- 条目绑 `{file, line, rule, sha256, context}`，**行改一个字、或上下任一行动了，豁免自动失效**——
  白名单没法退化成万能静音。
- **`context` 把绑定从字节扩到语境，两个哈希都是必需的**。只绑本行只能保证字节没变，
  保证不了这行还是原来那个意思：把一条反例外面的 ``` 围栏删掉，行号、字节、sha256 全不变，
  而这一行从「**千万别这么写**」变成了「照着做」——而 README 举的正当豁免场景恰恰就是
  「安全文档里的反例」，也就是说最常见的用法正是最脆的那种。所以这条绑定不做成可选的加固：
  最常见的用法从不开启的防护，等于谁都没防住。
- **两个哈希都算在剥掉开头 UTF-8 BOM、`\r\n` 归一成 `\n` 之后的内容上**，所以同一份内容不管是 LF 签出还是
  Windows `core.autocrlf=true` 的 CRLF 签出，`sha256` 与 `context` 都是同一组值——一条条目
  两种签出都能用，不用分别签。孤立的 `\r`（后面不跟 `\n`）不在此列：它不归一，原样留在行里
  照样计入哈希，所以被豁免的行里混进一个孤立 `\r`，就对不上旧签名，豁免照样失效——宁可错拦
  一条被改动过的行，也不为它保住一份不该再算数的豁免。
- **没写 `context` 的条目不生效**：命中时豁免作废、finding 照常报出，并打一条
  `allowlist-entry-not-context-bound` 的 note 点名是哪一行、哪条规则。它不算白名单坏了
  （不退 3——这次扫描跑完了，只是其中一条豁免是空转的），也不算 `allowlist-entry-unused`
  （那句话是「行改过了，该重新算哈希」，而这里该改的恰恰不是哈希）。
  **迁移旧条目**：按上面那行注释算出三行窗口的 sha256 填进 `context` 即可，`sha256` 不用动。
- `--staged` 模式下白名单**也从索引读**。只写进工作树（甚至 gitignore 掉）的豁免曾经能关掉
  一次 staged 扫描而在 commit 里不留任何痕迹——那让白名单比它取代的行内标记还糟：
  行内标记至少和载荷在同一个文件里，diff 看得见。索引里没有这个文件 = 这次提交不给任何豁免，
  不是错误。
- 每条生效的豁免都在 stderr 打 ` allow ` 行、在 JSON 的 `allowlisted` 里列出，
  并计进 `counts.allowlisted`。**看不见的豁免不是决定，是盲区**。
- 匹配不上的条目报 `allowlist-entry-unused`（行改过了或位置挪了，该删或该重签）；
  指向本仓根本没有的文件报 `allowlist-entry-orphan`（它既不会生效也不会过期，
  不点名就会一直堆着）；规则 id 不存在、同一 `{file,line,rule}` 重复、
  白名单本身坏了（JSON 不合法、版本不认识）算降级，退 3，不静默把豁免丢掉。

  **重签一条条目**：先把那行**重新读一遍**——豁免失效正是让人再看一眼的那个卡点，
  不看就换哈希等于盖橡皮章。确认它还是同一个意思之后，`{line, sha256, context}`
  三个值一起按当前文件重算（`allowlist-entry-unused` 的诊断里印的就是这条命令）：

  ```bash
  node -e "const f=process.argv[1],i=+process.argv[2]-1,h=s=>require('crypto').createHash('sha256').update(s).digest('hex'),L=require('fs').readFileSync(f,'utf8').split('\n');console.log(JSON.stringify({line:i+1,sha256:h(L[i]),context:h((L[i-1]||'')+'\n'+L[i]+'\n'+(L[i+1]||''))}))" <file> <line>
  ```

  在别处插了几行、把被豁免的行整体推下去时，`sha256` 与 `context` 都不会变，
  变的只有 `line`——三个值一起重算就不用自己判断哪个动了。

**这道机制的边界（当前默认态就是这样，不是待办）**：

- **窗口只有上下各一行**。能把一行意思翻过来的东西——围栏、否定词、「以下是反例」这类引导句——
  通常就贴在它上下，所以三行够用；但语境写在三行之外时（上一段的引导句被改掉），
  三个哈希一个都不会动。窗口开多大是取舍：开大了任何一次无关排版都会作废豁免，
  而作废得太勤的机制，最后是被整条关掉。
- **它防的是「无声豁免」，不防「有仓库写权限的攻击者」**。能改被扫文件的人同样能改白名单；
  这套东西换来的是每条豁免都在 stderr 和 JSON 里现形、且改一个字就失效，
  也就是把静音变成一条要走 diff 和评审的记录。威胁模型是「误提交 / 被投毒的第三方内容 /
  没人复核的静音」，不是「已经拿到写权限的对手」。
- **拿去扫不可信的第三方仓时，白名单在仓内是致命的**——那等于让被审对象自带免检条款。
  那种场景需要「白名单走仓外路径」这个能力，当前**没有**，别拿现在这套直接上。

**`scan-secrets` 保留行内 `scan-secrets:ignore`**（本行或上一行，只压这一行）——
源码文件不是它的威胁模型，但**每一条被压掉的命中都进 stderr 的 ` mute ` 行和 JSON 的
`suppressed`**，只记 file/line/rule、不重印被压掉的凭据。无痕压制不合格。

（引擎侧 fitness 的对应标记是 `harness-fitness:ignore`，与上面两者互不通用，故意的：
压制哪个扫描器必须写清楚是哪个。）

**自指是常态**：安全文档正当地写出「不许出现 ANTHROPIC_BASE_URL」时会自我命中。
解法是给那一行记一条白名单条目（或对 `scan-secrets` 加行内标记），**不是**放宽规则——
放宽一次，规则对所有人都薄一层。

## 怎么跑

```bash
node .claude/harness/audit/scan-instructions.mjs          # 全部 tracked 指令文件
node .claude/harness/audit/scan-instructions.mjs --staged # 只看待提交的
node .claude/harness/audit/scan-secrets.mjs --json        # 机器消费
node .claude/harness/audit/check-syntax.mjs
node .claude/harness/audit/check-syntax.mjs --staged      # 待提交内容的语法（git hook 用这个）
node .claude/harness/audit/check-syntax.mjs --paths a.mjs,b.sh   # 只验点名的几个

bash .claude/tests/test-audit-scripts.sh                  # 三只哨兵的回归测试
bash .claude/tests/test-audit-defects.sh                  # 已修缺陷的红锁（防复发）
```

## 与 harness `fitness` 的分工

| | `fitness`（引擎内） | `scan-secrets`（本目录） |
|---|---|---|
| 位置 | `verify` 质量门内 | git hook / CI 第一道 |
| 分级 | 按 module-catalog 的模块档位收放，属性声明 `none` 即静音 | 无档位、无开关 |
| 依赖 | catalog（无 catalog 时失去分级） | 无 |
| 语义 | 「这个模块持有它档位要求的证据吗」 | 「有没有凭据要被提交，是或否」 |
| 规则面 | 五性五条（密钥 / 日志 PII / 静默吞错 / 无界重试 / 未挂单 TODO） | 只管凭据字面量 |

要真证据（历史提交里的密钥、SAST、依赖漏洞），接
`.claude/harness/adapters.json` 里的 `secrets-gitleaks` / `sast-semgrep` 等外部工具，
按属性走 verify 门。见 `.claude/harness/ext/rules/quality-attributes.md`。

## 已知盲区（别把这三只当证明）

1. **正则不是证明**。这里做的是词法扫描：能减少「没人查过」的面，不能证明
   「不存在」。没被命中只说明没匹配上已知形状。
2. **扫的是工作树，不是历史**。已经提交进 git 历史的密钥，这里一个都看不见——
   那是 `gitleaks` 之类工具的活。轮换密钥永远比删文件重要。
3. **`scan-instructions` 只认路径形状**。用别的名字加载的指令文件（自定义
   `--append-system-prompt`、MCP 服务器下发的提示词、issue / PR 正文）不在扫描面内。
   模式表在脚本顶部，新载体要手工加。
4. **`scan-secrets` 目前不查「不该被 track 的路径」**。tracked 的 `.env` / `id_rsa` /
   `*.pem` 本身就是泄露，但当前只按内容形状判，不按路径判——多数情况下内容规则
   会顺带抓到，少数情况（二进制密钥库）会漏。要补就补成独立一条 finding kind，
   别塞进现有规则。
5. **`check-syntax` 只证明「解析得动」**。解析通过的 hook 仍然可能逻辑全错，
   frontmatter 解析通过也不代表 `name` / `description` 写对了（这一层归引擎
   `harness.mjs skills-lint`）。
6. **`node --check` 的解析目标随 node 版本变**。含 ESM 语法的 `.js` 在新版 node 上
   靠模块语法探测通过，老版本会判失败——所以 JSON 输出里带 `node` 版本字段，
   一条失败必须连着它读。
7. **超过 1 MB 的文件一个字都没扫**。现在这件事会让整次运行退 3、`ok` 为 false，
   但它仍然只是「被告知没扫」，不是「扫过了」。要覆盖大文件得换工具或改上限，
   而改上限是决定，不是顺手。
8. **frontmatter 检查器不是 YAML 解析器，覆盖面要照着上面那张清单读**。
   它认得的非法形态就是 check-syntax 那节列出的那几类（`": "` / 保留指示符 / `- ` 开头 /
   坏块标量头 / 错误 dedent / 制表符缩进 / 未闭合引号 / 标量之下挂映射）；
   流式集合、锚点 / 别名 / 标签、显式键、合并键、指令行一律 `UNDECIDABLE` 不裁定；
   **这两份清单之外的 YAML 非法形态，这里会放过去**——别把「没报错」读成「是合法 YAML」。
   Claude Code 真实加载时用的是它自己的解析器，这里的「能解析」只是必要条件。
9. **白名单条目会过期而没人管**。`allowlist-entry-unused` / `allowlist-entry-orphan`
   只是 note，不拦任何东西——它提醒你那行已经变了、或那个文件已经没了，
   不会替你决定该删还是该重新算哈希。
10. **`generic-assignment` 的字面量判据是有取舍的**。要求裸值字母数字混合，
    换来的是同一份 250 万行语料上 277 → 4 的噪声下降，代价是纯小写无数字的裸口令
    （`password=correcthorsebatterystaple`）会漏——真正在流通的凭据格式归上面那张
    confident 表管，这一条只是兜底。要收紧就加格式，不要放宽这条的形状判据：
    上一次放宽（去掉引号要求却没接住「值得是字面量」）直接把它变成了噪声源。
11. **反向禁令的豁免是可以绕的**。`gate-disable-instruction` 按子句判肯定 / 否定，
    攻击者写「Never mind, skip the tests」就能躲过去。这是拿可绕性换可用性的取舍：
    不这么做，一个满篇禁令句的仓库会把这条规则整个逼停。真正的注入话术仍归
    `instruction-override` 管。
