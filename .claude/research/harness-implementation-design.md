# cc-base 大仓治理模块 — 实现设计（Phase 0-2 蓝图）

> 来源：Plan agent 架构校验（2026-07-30），已核实真实家底（node v24.14.1 在 PATH、对照 stop-gate.sh:31-34 / pre-commit-check.ps1:74-123 现有防崩模式 / lib-fast-mode dot-source 共享库模式）。
> 用途：Phase 0-2 每个 Task 派单的技术蓝图。已签字方案见 plan 文件；本文件是其实现细节层。

## 0. 关键约束落地方式
- 单文件 `.claude/harness/harness.mjs`（纯 .mjs + JSDoc typedef，零 npm 依赖，只用 node:crypto/fs/path/child_process）。不做 cursor 的 .ts/.mjs 双写。
- 默认关闭 = catalog 存在即启用：`.claude/harness/module-catalog.json` 是唯一开关。所有 hook 接线第一步判 `[ -f module-catalog.json ]`，不存在走原逻辑、零行为变化。
- 不新增 hook 事件：挂现有 `mark-review-needed → stop-gate`（Stop 链）与 `pre-commit-check`/`static-check`（质量锚点），沿用 lib-fast-mode dot-source 模式与 lib-gate-log evidence 账本。
- node 缺失优雅降级：新增 `lib-harness.sh/.ps1` 定位 node，找不到就让调用方跳过 + 打可见 note（可见跳过而非静默假绿，对齐 run-all.sh SKIPPED 语义），绝不 crash、绝不 block 小项目。

## 1. harness.mjs 公开接口
所有子命令：入参 argv flags + 可选 stdin JSON；出参一律 stdout 单行 JSON + exit code；人读诊断走 stderr。`.sh`（python3/jq）与 `.ps1`（ConvertFrom-Json）都能吃。

| 子命令 | 输入 | 输出 stdout JSON | exit |
|---|---|---|---|
| `catalog-lint` | `--catalog <path>`（默认 .claude/harness/module-catalog.json）；读 git ls-files | `{ok,errors:[{code,path,detail}],warnings,stats:{modules,trackedPaths,unmapped,overlaps}}` | 0=ok/1=失败/3=缺失降级 |
| `impact` | `--changed a,b,c` 或省略走 git diff --name-only；`--risk` 可覆盖 | `{affected:[id],direct:[id],expansionReasons:[str],verification:{checkId:cmd},degraded}` | 0/3=降级 |
| `context-pack` | `--task id --changed .. --budget-chars N`；stdin 可传 task envelope | `{packHash,included:[{path,bytes,reason}],omitted:[{path,reason}],degraded,budgets}` | 0 |
| `receipt write` | stdin `{taskId,reviewer,verdict,scope}`；内部算 baseCommit+diffHash | `{path,taskId,baseCommit,diffHash,contentHash}` | 0 |
| `receipt verify` | `--task id`；内部重算当前 diffHash | `{fresh,reason,receiptDiffHash,currentDiffHash}` | 0=fresh/4=stale或缺回执 |
| `verify` | `--risk low|med|high --changed ..`（或 `--modules`） | `{overall:PASS|FAIL|BLOCKED|SKIPPED,checks:[{id,class,state,exit,cmd}]}` | 0=PASS/2=FAIL或BLOCKED/3=降级 |
| `diff-hash` | 无（内部 git） | `{diffHash,baseCommit,nonGit}` | 0 |
| `selftest` | 无 | node:test 汇总 | 0/1 |
| `doctor` | 无 | `{node,catalogPresent,catalogValid,...}` | 0 |

约定：catalog 缺失一律 exit 3 + `{degraded:true}`；非 git impact 返回保守全模块 + degraded。

### 单文件内部分区（banner 注释 + JSDoc，不拆文件）
```
§0 CLI dispatch   main(), parseArgs(), route(cmd)
§1 common         readStdin(), stableJson(), sha256(), emit(obj,code), die(msg,code)
§2 git            headCommit(), changedPaths(), canonicalDiff()->Buffer, gitFingerprint()
§3 glob           globToRegExp(glob), matchAny(path,globs), specificity(glob)
§4 catalog        loadCatalog(), validateSchema(), classifyPath(), lintCatalog()
§5 impact         reverseClosure(), analyzeImpact()
§6 context-pack   DENY, isDenied(), prioritize(), buildPack()
§7 receipt        contentHash(), writeReceipt(), verifyReceipt()
§8 quality        requiredChecks(risk), runCheck()->四态, verifyPlan()
§9 config         loadHarnessConfig(), DEFAULTS
```
JSDoc typedef 集中文件头（Module/Catalog/Receipt/CheckResult），不引 tsconfig。

## 2. module-catalog.json schema（单文件承载 catalog + 检查矩阵，单一开关）
```jsonc
{
  "version": 1,
  "modules": [
    { "id": "auth", "paths": ["src/auth/**","packages/auth/**"],
      "dependsOn": ["core","db"], "owners": ["@team-auth"], "riskTier": "high" }
  ],
  "global":  ["package.json","pnpm-lock.yaml","tsconfig.base.json",".github/**"],
  "ignored": ["**/*.md","docs/**","**/*.snap","**/__snapshots__/**"],
  "riskChecks": { "low":["lint"], "medium":["lint","unit"], "high":["lint","unit","security","smoke"] },
  "checks": {
    "lint":     { "command":"npm run lint",  "class":"static" },
    "unit":     { "command":"npm test",      "class":"test" },
    "security": { "command":"npm audit --audit-level=high", "class":"security", "allowFastSkip":false },
    "smoke":    { "command":"npm run smoke",  "class":"integration", "allowFastSkip":true }
  },
  "contextPack": { "maxTotalChars":120000, "maxFiles":40, "maxFileChars":6000, "maxDiffChars":40000 }
}
```
字段裁剪：保留 codex 的 id/paths/dependsOn/owners + pi 的 riskTier；砍 codex 的 root/shared/contracts/capsule/tests 独立字段（ignored+global 两数组足以驱动保守扩张，capsule 后置）；砍 cursor 独立 schema 文件与 pi lease。

### 零依赖 glob（自写 ~30 行，不引 minimatch）
```js
/** glob -> 锚定 RegExp。支持 ** * ? 与字面 /；不支持 {a,b}/[..]（catalog 用不到）。 */
function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i+1] === '*') {                            // **
        i++;                                              // 吃掉第二个 *
        if (glob[i+1] === '/') { i++; re += '(?:.*/)?'; } // **/ -> 零或多段（前缀段可空）
        else re += '.*';                                  // 结尾 **（或 **x）-> 任意，跨 /
      } else re += '[^/]*';                               // * -> 段内不跨 /
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$');
}
```
勘误（2026-07-30，T0.1 review P1 实测）：**结尾 `**` 必须编译为 `.*` 而非 `(?:.*/)?`**。`(?:.*/)?` 只匹配空串或以 `/` 结尾的串，会让 `src/auth/**` 漏掉 `src/auth/login.ts`（不以 / 结尾）——catalog 模块 paths 恰恰几乎全是 `模块/**` 形式，误判会让 classifyPath 把模块文件当 unmapped、引爆保守全模块扩张。裸结尾 `**` 语义是「该目录下任意深度任意文件」，只有 `**/`（后跟斜杠）才是「零或多段前缀」。
`specificity(glob)` = 去通配后字面字符数，多模块命中取最具体者胜（pi 最深模块映射）。自测断言 `src/auth/**` 胜过 `src/**`，且 `src/auth/**` 命中 `src/auth/login.ts` 与 `src/auth/x/y.ts`、不命中 `src/authz/z.ts`。

## 3. impact 反向依赖闭包
```js
/** @returns {{affected,direct,expansionReasons,degraded}} */
function analyzeImpact(changed, catalog, { nonGit=false, truncated=false } = {}) {
  const reasons = new Set(), direct = new Set();
  for (const p of changed) {
    const cls = classifyPath(p, catalog);   // module|global|ignored|unmapped
    if (cls.kind === 'ignored') continue;
    else if (cls.kind === 'global')   reasons.add('global:'+p);
    else if (cls.kind === 'unmapped') reasons.add('unmapped:'+p);
    else direct.add(cls.moduleId);
  }
  if (nonGit) reasons.add('non-git');
  if (truncated) reasons.add('truncated');
  const allIds = catalog.modules.map(m => m.id);
  const affected = reasons.size > 0 ? allIds : [...reverseClosure(direct, catalog)];
  return { affected, direct:[...direct], expansionReasons:[...reasons], degraded: reasons.size>0 };
}
/** 反向依赖闭包：seed 及所有传递地 dependsOn seed 的消费者。visited 集容忍依赖环。 */
function reverseClosure(seeds, catalog) {
  const rev = new Map();
  for (const m of catalog.modules)
    for (const d of m.dependsOn || []) (rev.get(d) || rev.set(d,[]).get(d)).push(m.id);
  const out = new Set(seeds), q = [...seeds];
  while (q.length) for (const c of rev.get(q.pop()) || []) if (!out.has(c)) { out.add(c); q.push(c); }
  return out;
}
```
classifyPath 优先级（防广 ignored 掩盖模块文件）：module > ignored > global > unmapped。多模块命中取 specificity 最大者 + lint 登记 overlap。
unmapped/shared/global/non-git/truncated 任一出现 → affected=全模块 + degraded（防漏测的正确 default）。
**T1.3 实现注意（T0.1 review 留痕）**：analyzeImpact 的 changed 入参来自 §2 `changedPaths()`，而 `changedPaths()` 未过滤 STATE_EXCLUDE（`hashUntracked()` 过滤了，二者不对称）。若直接把 `changedPaths()` 结果喂给 analyzeImpact，`.claude/.needs-review`/`.fast-mode`/evidence/receipts 等运行态文件会被当 unmapped、触发全模块保守扩张（假降级）。T1.3 必须在 analyzeImpact 入口或 changedPaths 出口过滤掉 STATE_EXCLUDE 路径（复用 §2 `isStateExcluded()`），使运行态文件不参与影响面判定。

### catalog-lint 强制全量归类（防 root catch-all）
```
lintCatalog(catalog):
  1) 结构：id 唯一、paths 非空、dependsOn 引用存在
  2) 反 catch-all：module.paths 属于 {"",".","*","**","**/*"} -> error CATCH_ALL
  3) 全量覆盖：tracked=git ls-files；classifyPath 为 unmapped -> error UNMAPPED
  4) overlap：一 path 命中 >1 module -> error OVERLAP（除非 ignored 白名单显式排除）
  5) 环检测：dependsOn 成环 -> warning
```
UNMAPPED 判 error 是核心闸——强制每条 tracked path 被某 module/global/ignored 显式认领，杜绝 root catch-all 掩盖漏项。

## 4. context-pack 预算化
硬预算默认：maxTotalChars 120000 / maxFiles 40 / maxFileChars 6000 / maxDiffChars 40000（catalog 可覆盖）。
优先级（按序装入，装满即停，超单文件上限截断标 omitted:truncated）：
1. task envelope + Spec/Plan 指针（永远入包，最先扣）
2. canonical diff（截 maxDiffChars）
3. changed files 本身（每文件截 maxFileChars）
4. affected module 的 contract/capsule 摘要（Phase 0-2 无 capsule 字段则跳过）
5. affected module 测试入口
6. 依赖模块摘要

### 永不入包 deny（先于一切优先级）
```js
const DENY = [
  /(^|\/)\.git\//, /(^|\/)node_modules\//, /(^|\/)(dist|build|out|\.next|\.venv)\//,
  /(^|\/)\.claude\/(evidence|harness\/receipts)\//,
  /(^|\/)\.env(\.|$)/,
  /\.(pem|key|p12|pfx)$/, /(^|\/)id_rsa/, /(^|\/)\.(ssh|aws|azure|gnupg|kube)\//,
];
function isDenied(p){
  if (/(^|\/)\.env\.(example|sample|template)$/.test(p)) return false;
  return DENY.some(r => r.test(p));
}
```
packHash 稳定：不 hash 文件全文（随空白抖动），hash 清单指纹：
```js
packHash = sha256(stableJson({ budgets, diffHash,
  included: included.map(f => ({path:f.path, bytes:f.bytes})).sort(byPath) }));
```

## 5. diff-bound 回执
### contentHash 稳定 JSON（键排序）
```js
function stableJson(v){
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+stableJson(v[k])).join(',') + '}';
}
const contentHash = r => sha256(stableJson({ ...r, contentHash: undefined }));
```
### diffHash 绑定 canonical git diff
```js
const STATE_EXCLUDE = [
  ':(exclude).claude/.needs-review', ':(exclude).claude/.needs-review.lock',
  ':(exclude).claude/.fast-mode', ':(exclude).claude/evidence/**',
  ':(exclude).claude/harness/receipts/**',
];
function canonicalDiff(){   // 返回 Buffer，不 stringify（防编码/截断污染，pi 教训）
  if (!isGitRepo()) return { buf: Buffer.from('NON_GIT'), nonGit: true };
  const tracked = spawnSync('git',['diff','--binary','--no-ext-diff','HEAD','--',...STATE_EXCLUDE],
                            {maxBuffer:1<<28}).stdout;
  const untracked = hashUntracked();   // git ls-files --others --exclude-standard，逐个 hash 路径+内容
  return { buf: Buffer.concat([tracked, untracked]), nonGit: false };
}
```
### 回执落点
`.claude/harness/receipts/<taskId>.json`（不用 evidence/——evidence 是 append-only 拦截账本，回执是可覆盖按 task 单条状态）。必须 git-ignore：`.claude/.gitignore` 加 `harness/receipts/`，同步进 gen-manifest.sh 与 setup.sh skip 清单。
回执：`{taskId,baseCommit,diffHash,reviewer,verdict,scope,timestamp,contentHash}`。

### 挂接 mark-review-needed -> stop-gate（回执闸是现链"clean 放行"之后追加的第二道 diff-bound 判定，不改第一道）
stop-gate.sh 接线点在 :31-34 的 `if [ -z "$FILES" ]` 放行分支内 `exit 0` 之前插入：
```sh
_HL="$(dirname "$0")/lib-harness.sh"
if [ -f "$_HL" ]; then . "$_HL"
  if harness_enabled; then
    if harness_node_ok; then
      V=$(harness_run receipt verify --task "$(harness_active_task)")   # exit 4 = stale/缺回执
      if [ $? -eq 4 ]; then
        R="代码 diff 与 code review 回执不符（回执已 stale 或缺失），需重审：..."
        . "$(dirname "$0")/lib-gate-log.sh" 2>/dev/null || true; gate_log "stop-gate" "$R"
        jq -nc --arg r "$R" '{decision:"block",reason:$r}'; exit 0
      fi
    else
      jq -nc '{systemMessage:"harness 回执闸跳过：未找到 node（大仓治理降级）。"}'
    fi
  fi
fi
```
.ps1 侧在 stop-gate.ps1:35-40 对应放行分支等价接线（lib-harness.ps1 的 Test-HarnessEnabled/Invoke-HarnessReceiptVerify，纯 ASCII，native 防崩）。
回执写入方：code-reviewer 通过时从"仅 echo clean"升级为（catalog 模式）`node harness.mjs receipt write <<<'{...}' && echo clean > .needs-review`。属 code-reviewer.md/code-review skill 的增量补充（默认非 catalog 项目仍只 echo clean）。
价值：现链 .needs-review 只跟踪 Edit/Write 工具改动且 echo clean 可伪造。diff-bound 闸补两洞——(a) Bash sed/git apply/MCP 改的代码不进 .needs-review 但进 canonical diff，回执 stale 即拦；(b) 回执把"审过了"密码学绑定到具体 diffHash。

## 6. 四态门 PASS/FAIL/BLOCKED/SKIPPED
```js
function runCheck(check, { fastActive }) {
  if (!check || !check.command) return { state:'BLOCKED', reason:'no-command' };
  const exe = check.command.split(/\s+/)[0];
  if (!which(exe)) return { state:'BLOCKED', reason:'command-missing:'+exe };   // 绝不假绿
  if (fastActive && check.class !== 'security' && check.allowFastSkip)
    return { state:'SKIPPED', reason:'fast-mode' };                             // 可见跳过
  const r = spawnCmd(check.command);   // win32 用 cmd.exe /c
  return { state: r.code === 0 ? 'PASS' : 'FAIL', exit: r.code };
}
// 聚合：任一 FAIL->FAIL；无 FAIL 有 BLOCKED->BLOCKED；否则 PASS（SKIPPED 放行但计入报告）
```
- 命令缺失=BLOCKED（which 失败即 BLOCKED，不当 PASS 也不当 SKIPPED）。
- 风险分层：`requiredChecks(risk)=module.verification ?? catalog.riskChecks[risk]`。
- security 不可跳/不可豁免：class==='security' 硬编码跳过 fast-skip 分支；Phase 3 waiver 写入期也对 security 抛错（预留）。

### 挂现有锚点
- pre-commit-check.sh：现有 tsc/ruff 分栈检查之后、:61-66 的 FAIL 退出之前插 catalog 模式闸（harness verify，RC=2 -> FAIL=1；RC=3 降级或 node 缺失跳过保留现有结果）。.ps1 侧在 pre-commit-check.ps1:127 的 `if ($fail)` 前等价接线。
- static-check.sh：Stage 0 静态闸，已有"无工具->跳过"（:57-60）。三态输出语义对齐四态：green->PASS、red->FAIL(:61-64 exit 1)、无栈->SKIPPED(:57-60)。catalog 模式下 BLOCKED 由 harness verify 承担，static-check 保持栈探测 fallback 不抢职责。

## 7. 跨平台调用 + 优雅降级
新增 lib-harness.sh/.ps1（镜像 lib-fast-mode dot-source 共享库模式）。
```sh
# lib-harness.sh
harness_enabled() { [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "$CLAUDE_PROJECT_DIR/.claude/harness/module-catalog.json" ]; }
harness_node()    { command -v node 2>/dev/null; }
harness_node_ok() { harness_node >/dev/null 2>&1; }
harness_run()     { node "$CLAUDE_PROJECT_DIR/.claude/harness/harness.mjs" "$@"; }
```
```powershell
# lib-harness.ps1 —— 纯 ASCII
function Test-HarnessEnabled { $env:CLAUDE_PROJECT_DIR -and (Test-Path -LiteralPath (Join-Path $env:CLAUDE_PROJECT_DIR '.claude/harness/module-catalog.json')) }
function Get-HarnessNode { (Get-Command node -ErrorAction SilentlyContinue).Source }
function Invoke-Harness {
  param([string[]]$HarnessArgs)
  $node = Get-HarnessNode; if (-not $node) { return $null }
  $script = Join-Path $env:CLAUDE_PROJECT_DIR '.claude/harness/harness.mjs'
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $err = [System.IO.Path]::GetTempFileName()
  try { $out = & $node $script @HarnessArgs 2> $err; $code = $LASTEXITCODE }
  finally { Remove-Item $err -Force -ErrorAction SilentlyContinue; $ErrorActionPreference = $prev }
  [pscustomobject]@{ Out = ($out | Out-String); Code = $code }
}
```
### 三坑规避
1. .ps1 纯 ASCII（PS 5.1 GBK）；harness.mjs 也建议 ASCII-only 源码。
2. powershell.exe 5.1 非 pwsh 7：用 Get-Command node 而非固定路径，-ErrorAction SilentlyContinue。
3. native stderr 在 EAP=Stop 下崩：Invoke-Harness 临时放宽 Continue + stderr 重定向 temp + 靠 $LASTEXITCODE 判定（照搬已验证的 pre-commit-check.ps1:74-123）。

### 降级矩阵
| 场景 | 行为 |
|---|---|
| catalog 缺失 | hook 完全跳过 harness 分支，走原逻辑 |
| catalog 存在、node 缺失 | 跳过 harness 判定 + systemMessage 可见 note（非 block、非假绿）；stop-gate 仍按 .needs-review 工作 |
| catalog 存在、node 在、非 git | harness exit 3 degraded；impact 保守全模块；回执闸跳过 |
| harness.mjs 自身抛异常 | node 非 0 + stdout 无合法 JSON -> hook 按降级处理，绝不 block（避免单点 runtime bug 卡死所有 Stop） |

## 8. 自测策略
### 小 fixture（checked in，微型）：.claude/tests/fixtures/harness/
- catalog-good.json（3-4 模块 + dependsOn 链 + global/ignored）+ catalog-bad-*.json（catch-all/unmapped/overlap/dangling-dependsOn 各一）
- catalog-lint：good->ok；每 bad->对应 error code
- impact：改 db 文件->affected 含 db 及消费者 auth（反向闭包）；改 global->全模块+expansionReasons；改 unmapped->全模块；改 ignored-only->affected 空
- glob：src/auth/** 命中 src/auth/x/y.ts 不命中 src/authz/z.ts；多命中取最具体
- context-pack：超预算文件集->included<=maxFiles、.env/node_modules 恒不入包、同输入 packHash 稳定
- receipt：写后改 contentHash 一字节->判篡改；改工作树 diff->verify stale(exit 4)
- 四态：命令不存在->BLOCKED；exit0->PASS；exit1->FAIL；fast-mode+非security+allowFastSkip->SKIPPED；security 在 fast-mode 仍 PASS/FAIL 不 SKIPPED

### 规模化性能 smoke（不提交巨型 fixture，运行时 mktemp 生成）
24 模块 × ~8000 行合成 catalog + 假 tracked path 清单（对齐 codex tests:654-689、cursor:844-888 的 24 模块 20 万行基准），断言 impact 全流程 <5000ms 且不读源码内容（只吃路径清单），跑完即删。

### 挂 run-all.sh
run-all.sh:30 第二段追加 test-harness.sh。遵循 SKIPPED-非假绿：无 node->打印 SKIPPED 并 exit 0；有 node 才真跑 node harness.mjs selftest + 规模 smoke。

## 9. Phase 0-2 可派单 Task 拆分
> 关键排序：编辑同一文件 harness.mjs 的 Task 必须串行（单文件产物无法 worktree 隔离并行）。只有编辑不同文件（.sh/.ps1/fixtures/gitignore/manifest）的 Task 才可与 harness.mjs 内核并行。

### Phase 0 — 地基
- **T0.1**（串行锚，无依赖）harness.mjs 骨架：§0 CLI dispatch + §1 common + §2 git + §3 glob + §9 config/默认关闭检测。`harness doctor` 可跑。验证 `node harness.mjs doctor` 出 JSON、`diff-hash` 本仓返回稳定 hash。文件：.claude/harness/harness.mjs（新建）。
- **T0.2**（依赖 T0.1，可与 T0.3 并行）lib-harness.sh + lib-harness.ps1（node 定位 + enabled 检测 + Invoke 防崩，纯 ASCII）。验证 stub 四组合（catalog 在/不在 × node 在/不在）返回正确。文件：.claude/hooks/lib-harness.sh、.ps1（新建）。
- **T0.3**（可与 T0.2 并行，不碰 harness.mjs）安装事务 + 三层分离：.claude/.gitignore 加 `harness/receipts/`；gen-manifest.sh:23-36 + setup.sh:57-70 skip 清单加 `harness/receipts/*`（但 harness.mjs 与 module-catalog 示例入 manifest 被分发）；doctor.sh 加 harness 存在性 note。验证 gen-manifest 重跑含 harness.mjs 不含 receipts、git status 确认 receipts 忽略。
- **T0.4**（依赖 T0.1，改 harness.mjs 故串行于 T0.2）自测脚手架：test-harness.sh（SKIP-非假绿）+ harness selftest 子命令空壳 + fixtures 目录；挂 run-all.sh:30。验证 run-all 第二段跑到 test-harness、无 node SKIP、有 node 空跑通过。
- Phase 0 串行链：T0.1 -> (T0.2 ∥ T0.3) -> T0.4。

### Phase 1 — 三件套（均改 harness.mjs，内核严格串行）
- **T1.1**（依赖 T0.1）§4 catalog：loadCatalog + validateSchema + classifyPath（含最具体模块胜）。
- **T1.2**（依赖 T1.1）§4 lintCatalog：git ls-files 全量覆盖 + UNMAPPED/OVERLAP/CATCH_ALL/dangling-dependsOn；catalog-lint 子命令。
- **T1.3**（依赖 T1.1，逻辑可并行 T1.2 但同文件->串行）§5 impact：reverseClosure + analyzeImpact + 保守扩张；impact 子命令。
- **T1.4**（依赖 T1.1）§6 context-pack：DENY + prioritize + budget + packHash；context-pack 子命令。
- **T1.5**（依赖 T1.2/3/4，改 test 文件可与后续 harness.mjs 并行）三件套 fixtures + 规模 smoke + selftest 断言。
- 串行链：T1.1 -> T1.2 -> T1.3 -> T1.4；T1.5 可在 T1.4 后与 Phase 2 内核并行。

### Phase 2 — 回执 + 四态门
- **T2.1**（依赖 T0.1 git 适配器，串行于 P1 harness.mjs）§7 receipt：contentHash + writeReceipt + verifyReceipt(diffHash 绑定/stale exit 4)；receipt write/verify 子命令。
- **T2.2**（依赖 T2.1，改 hook 文件）stop-gate 回执闸接线 stop-gate.sh:31-34 + .ps1:35-40，含 node 缺失可见跳过；code-reviewer 通过写回执（doc 增量）。
- **T2.3**（依赖 T1.1 读 catalog.checks，串行于 harness.mjs）§8 quality：requiredChecks + runCheck 四态 + verifyPlan；verify 子命令。
- **T2.4**（依赖 T2.3，改 hook 文件）pre-commit-check 四态闸接线 :61 前 + .ps1:127 前；catalog 模式才生效。
- **T2.5**（依赖 T2.1/T2.3，改 test 文件可并行）回执 + 四态 fixtures/断言。
- 内核串行链：T2.1 -> T2.3；接线 T2.2/T2.4（不同 hook 文件）彼此可并行；T2.5 改 test 可并行。
- 跨 Phase 并行窗口受限：内核全在 harness.mjs 单文件 -> harness.mjs 归一条串行主链，能并行的是"改不同外围文件"的 Task（按文件归属分并行组）。

## Critical Files
- .claude/harness/harness.mjs（新建，单文件运行时核心）
- .claude/hooks/stop-gate.sh + .ps1（回执闸接线 :31-34 / :35-40）
- .claude/hooks/pre-commit-check.sh + .ps1（四态门接线 :61 / :127；PS native 防崩样板 :74-123）
- .claude/hooks/lib-harness.sh + .ps1（新建，node 定位 + 降级共享库，镜像 lib-fast-mode）
- .claude/scripts/gen-manifest.sh（:23-36 skip）+ setup.sh（:57-70 copy skip）+ .claude/.gitignore（receipts 运行态落点）
