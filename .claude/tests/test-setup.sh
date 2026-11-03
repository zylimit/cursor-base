#!/usr/bin/env bash
# risk: high
# test-setup.sh — 安装器回归测试：把 cc-base 用 setup.sh 装到临时目录，断言产物正确。
# 装坏别人项目是高风险五种之一，所以这四条主路径一条不减：
#   ① 全新安装装齐（CLAUDE.md / harness / agents 名单与源仓逐份对齐 / 各 skill 的 SKILL.md / hooks / settings.json
#      合法 JSON）+ 私有 feedback 已排除（target 只剩 templates/ + 重置的 FEEDBACK-INDEX.md）
#   ② 幂等重装（装两次产物 SHA256 一致；三条平台路径各自的合并语义）
#   ③ manifest 分层：用户改过的框架文件不被覆盖、落 .framework-new，私有新增文件保留
#   Windows 对等归 test-fix-platform.sh 的 .ps1 臂。
# 2026-09-10 预算表：⑤ 运行态隔离 / ⑥ 四份排除表逐臂对照 / ⑦–⑩ 事务化与路径边界那批退休——
#   它们锁的是安装器内部结构，装坏别人项目这件事由上面三条主路径直接判。
# 无依赖 claude CLI，纳入 cases/run-all.sh 在 selftest 之后跑。装完清理临时目录。
set -eu

# tests/ 在 .claude/tests/ 下，仓库根 = 上溯三层（tests → .claude → repo root）
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
[ -f "$ROOT/setup.sh" ] || { echo "test-setup: 仓库根缺 setup.sh：$ROOT" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() { echo "test-setup: $*" >&2; exit 1; }

TARGET="$TMP/project"
bash "$ROOT/setup.sh" "$TARGET" >"$TMP/setup-1.log" 2>&1 || { cat "$TMP/setup-1.log" >&2; fail "首次安装失败"; }

CL="$TARGET/.claude"

# ---- ① 关键文件装齐 ----
[ -f "$CL/CLAUDE.md" ] || fail "CLAUDE.md 未安装"
[ -f "$CL/settings.json" ] || fail "settings.json 未安装"
[ -f "$CL/EVOLUTION.md" ] || fail "EVOLUTION.md 未安装"

# harness 安装产物（引擎核心 + 接线依赖库）
# hook 的依赖库是 hooks/lib/ 四件 .mjs——只点 harness.mjs 一件的话，另外三件漏装照样静默：
# 缺哪一件都是「注册了但每次事件报 hook error」，装齐要逐件判。
# lib/ 两件是核心，默认装；ext/ 与它那两份 rules 归 --with-harness，默认不装的边界在
# test-distribution.sh 的 D-7 段判，这里不重复。
[ -f "$CL/harness/harness.mjs" ]         || fail "harness/harness.mjs 未安装"
for m in core tier; do
  [ -f "$CL/harness/lib/$m.mjs" ]        || fail "harness/lib/$m.mjs 未安装"
done
for m in io gatelog tier harness; do
  [ -f "$CL/hooks/lib/$m.mjs" ]          || fail "hooks/lib/$m.mjs 未安装"
done

# agent 全装齐。七个核心角色写死字面量当地板——整批改名或装空时，两边同样错的
# 动态比对会互相抵消判绿，写死的那份不会。份数与名单则与源仓逐份对齐：安装器的
# 职责就是「源仓有几个就装出几个」，多一份（漏了排除表）少一份（新 agent 没进拷贝
# 范围）都是它的错；写死 7 只能挡住那年的名单，新增一个合规 agent 就假红。
for ag in implementer code-reviewer tester deployer feedback-observer evolution-runner progress-recorder; do
  [ -f "$CL/agents/$ag.md" ] || fail "agent 缺失：$ag.md"
done
list_agents() { find "$1" -maxdepth 1 -type f -name '*.md' -exec basename {} \; | LC_ALL=C sort; }
src_agents=$(list_agents "$ROOT/.claude/agents")
got_agents=$(list_agents "$CL/agents")
agent_count=$(printf '%s\n' "$got_agents" | grep -c '^.' || true)
src_count=$(printf '%s\n' "$src_agents" | grep -c '^.' || true)
# 源仓自己数不到七份 = 基线异常（find 挂了 / 路径推错），此时名单比对会双空判绿，先拦下
[ "$src_count" -ge 7 ] || fail "源仓 agents/*.md 只数到 $src_count 份，不足七个核心角色——基线异常，非安装器之过"
[ "$src_agents" = "$got_agents" ] || fail "agent 名单与源仓不一致：源仓 $src_count 份 [$(printf '%s' "$src_agents" | tr '\n' ' ')] vs 装出 $agent_count 份 [$(printf '%s' "$got_agents" | tr '\n' ' ')]"

# 每个 skills/<name>/ 都有 SKILL.md 实体
while IFS= read -r d; do
  [ -f "$d/SKILL.md" ] || fail "skill 缺 SKILL.md：$(basename "$d")"
done < <(find "$CL/skills" -mindepth 1 -maxdepth 1 -type d)

# hooks/*.mjs 装齐。执行位不判：.mjs 由 settings.json 里的 `node <路径>` 拉起，
# 不走 shebang，位在不在与能不能跑无关（判它只会变成恒红）。
# 数量下限写 22 而不是 >0：21 个注册 hook + 未注册的 static-check，少一个就是漏装，
# 而「>0」在只装进一个文件时也照样绿。
hook_count=$(find "$CL/hooks" -maxdepth 1 -type f -name '*.mjs' | wc -l | tr -d ' ')
[ "$hook_count" -ge 22 ] || fail "hooks/*.mjs 装少了：实得 $hook_count 个，至少应有 22 个"

# settings.json 合法 JSON（有 jq 用 jq，无 jq 用 python3 解析——降级环境同样要验）
if command -v jq >/dev/null 2>&1; then
  jq empty "$CL/settings.json" >/dev/null 2>&1 || fail "settings.json 不是合法 JSON"
else
  python3 -c "import json,sys; json.load(open(sys.argv[1], encoding='utf-8'))" "$CL/settings.json" >/dev/null 2>&1 \
    || fail "settings.json 不是合法 JSON"
fi

# ---- ② 私有 feedback 已排除 ----
# 顶层私有 *.md 不该出现（FEEDBACK-INDEX.md 是重置模板，允许）
leaked=$(find "$CL/feedback" -maxdepth 1 -type f -name '*.md' ! -name 'FEEDBACK-INDEX.md' 2>/dev/null || true)
[ -z "$leaked" ] || fail "私有 feedback 泄漏到安装产物：$(echo "$leaked" | tr '\n' ' ')"
# templates/ 应保留
[ -d "$CL/feedback/templates" ] || fail "feedback/templates/ 未保留"
# FEEDBACK-INDEX.md 应被重置为干净模板（无私人条目，与模板同源）
[ -f "$CL/feedback/FEEDBACK-INDEX.md" ] || fail "FEEDBACK-INDEX.md 未安装"
TPL="$ROOT/.claude/feedback/templates/feedback-index-template.md"
if [ -f "$TPL" ]; then
  cmp -s "$TPL" "$CL/feedback/FEEDBACK-INDEX.md" || fail "FEEDBACK-INDEX.md 未重置为干净模板（与 template 不一致）"
fi

# ---- ③ 幂等性：装两次产物一致 ----
# 顶层先按「首次安装是否被路由到 setup.ps1」分流：setup.sh 在 MINGW/MSYS/CYGWIN 上会 exec pwsh
# 转交 setup.ps1（原生合并、不依赖 jq），此时断言语义与走 .sh 路径的 jq 有无是正交的，必须先判路由。
if grep -q "cc-base setup (Windows/.ps1)" "$TMP/setup-1.log"; then
  # 路由到 setup.ps1（Windows/MINGW）：原生合并语义。二次安装遇已有 settings.json 会先备份 .bak
  # 再原生重写；无新增 hook 命令时重写字节稳定，排除 .bak 后其余产物应保持幂等。
  cp -p "$CL/settings.json" "$TMP/settings.before"
  before=$(find "$TARGET" -type f ! -name '*.bak' | sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print $1}')
  bash "$ROOT/setup.sh" "$TARGET" >"$TMP/setup-2.log" 2>&1 || { cat "$TMP/setup-2.log" >&2; fail "二次安装报错（.ps1 原生合并）"; }
  after=$(find "$TARGET" -type f ! -name '*.bak' | sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print $1}')
  [ "$before" = "$after" ] || fail ".ps1 原生合并：二次安装后非 .bak 产物变化（before=$before after=${after}）"
  [ -f "$CL/settings.json.bak" ] || fail ".ps1 原生合并：已有 settings.json 时未生成 .bak 备份"
  cmp -s "$TMP/settings.before" "$CL/settings.json" || fail ".ps1 原生合并：二次安装后 settings.json 变化（无新增 hook 时重写应字节稳定）"
  grep -q "installed: ps1_hooks=" "$TMP/setup-2.log" || fail ".ps1 原生合并：未打印 .ps1 安装完成标志行"
  MODE=".ps1 原生合并"
elif command -v jq >/dev/null 2>&1; then
  # 走 setup.sh .sh 路径且有 jq：二次安装走自动合并，产物应完全一致
  before=$(find "$TARGET" -type f | sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print $1}')
  bash "$ROOT/setup.sh" "$TARGET" >"$TMP/setup-2.log" 2>&1 || { cat "$TMP/setup-2.log" >&2; fail "二次安装报错"; }
  after=$(find "$TARGET" -type f | sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print $1}')
  [ "$before" = "$after" ] || fail "安装非幂等：二次安装后产物 SHA256 变化（before=$before after=${after}）"
  MODE="jq 合并"
else
  # 走 setup.sh .sh 路径且无 jq 降级：二次安装遇到已有 settings.json 应备份 .bak + 原文件原样保留、不静默覆盖；
  # 其余产物（排除 .bak）保持幂等。
  cp -p "$CL/settings.json" "$TMP/settings.before"
  before=$(find "$TARGET" -type f ! -name '*.bak' | sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print $1}')
  bash "$ROOT/setup.sh" "$TARGET" >"$TMP/setup-2.log" 2>&1 || { cat "$TMP/setup-2.log" >&2; fail "二次安装报错（无 jq 降级路径）"; }
  after=$(find "$TARGET" -type f ! -name '*.bak' | sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print $1}')
  [ "$before" = "$after" ] || fail "无 jq 降级：二次安装后非 .bak 产物变化（before=$before after=${after}）"
  [ -f "$CL/settings.json.bak" ] || fail "无 jq 降级：已有 settings.json 时未生成 .bak 备份"
  cmp -s "$TMP/settings.before" "$CL/settings.json" || fail "无 jq 降级：已有 settings.json 被改动（应原样保留、只打印手工合并指引）"
  grep -q "手工" "$TMP/setup-2.log" || fail "无 jq 降级：未打印手工合并指引"
  MODE="无 jq 降级"
fi

echo "test-setup: passed（agents=$agent_count hooks=${hook_count}，私有 feedback 已排除，幂等校验通过，settings 路径=${MODE}）"

# ---- ④ 框架分层（FRAMEWORK-MANIFEST）：用户改动不覆盖 ----
[ -f "$CL/FRAMEWORK-MANIFEST.txt" ] || fail "首装未安装 FRAMEWORK-MANIFEST.txt"
grep -q 'agents/implementer.md' "$CL/FRAMEWORK-MANIFEST.txt" || fail "MANIFEST 缺少框架文件条目"

# 用户改一个框架文件 + 新增两个私有文件后重装 → 改动不覆盖、私有文件不删
echo "# user local modification" >>"$CL/agents/implementer.md"
user_sha=$(sha256sum "$CL/agents/implementer.md" | awk '{print $1}')
echo "private note" >"$CL/feedback/my-private-note-keepme.txt"
mkdir -p "$CL/skills/my-private-skill" && echo "# mine" >"$CL/skills/my-private-skill/SKILL.md"

bash "$ROOT/setup.sh" "$TARGET" >"$TMP/setup-3.log" 2>&1 || { cat "$TMP/setup-3.log" >&2; fail "三次安装（升级场景）报错"; }
after_sha=$(sha256sum "$CL/agents/implementer.md" | awk '{print $1}')
[ "$user_sha" = "$after_sha" ] || fail "manifest 分层：用户改过的框架文件被覆盖了"
[ -f "$CL/agents/implementer.md.framework-new" ] || fail "manifest 分层：未生成 .framework-new"
cmp -s "$ROOT/.claude/agents/implementer.md" "$CL/agents/implementer.md.framework-new" \
  || fail "manifest 分层：.framework-new 内容与框架源不一致"
grep -q "framework-new" "$TMP/setup-3.log" || fail "manifest 分层：未打印 .framework-new 汇总提示"

[ -f "$CL/feedback/my-private-note-keepme.txt" ] || fail "私有层：feedback 私有文件被删"
[ -f "$CL/skills/my-private-skill/SKILL.md" ] || fail "私有层：私有 skill 被删"
grep -q "# mine" "$CL/skills/my-private-skill/SKILL.md" || fail "私有层：私有 skill 内容被改"

# 目标已有 FEEDBACK-INDEX.md（下游自己积累的条目）重装后必须原样保留，不许被空模板重置（#87）
printf '%s\n' '- [下游自产条目](mine.md) — 不该被升级清掉' >>"$CL/feedback/FEEDBACK-INDEX.md"
idx_before=$(cksum <"$CL/feedback/FEEDBACK-INDEX.md")
bash "$ROOT/setup.sh" "$TARGET" >"$TMP/setup-4.log" 2>&1 || { cat "$TMP/setup-4.log" >&2; fail "四次安装（索引保留场景）报错"; }
[ "$idx_before" = "$(cksum <"$CL/feedback/FEEDBACK-INDEX.md")" ] || fail "目标已有 FEEDBACK-INDEX.md 重装后内容变了（被重置）"
grep -q '下游自产条目' "$CL/feedback/FEEDBACK-INDEX.md" || fail "重装后下游索引条目丢了"

echo "test-setup: manifest 分层校验通过（首装含 MANIFEST / 用户改动不覆盖落 .framework-new / 私有文件保留）"

# ---- ⑤ string form 目标升级：按 hook 名去重，不合出 exec form 重复，形态保持 string ----
# 合并的去重键以前是 command + args 整体：目标已是 string form（Cursor 用）时，同一个 hook 的 exec form
# 键不同，升级一次就把 21 条全合进来一份——全文件混挂，Cursor 那侧又是光杆 node。jq 合并才有这条路径，
# 无 jq 降级不自动合并、Windows 走 setup.ps1，都不在这里判。
if command -v jq >/dev/null 2>&1 && ! grep -q "cc-base setup (Windows/.ps1)" "$TMP/setup-1.log"; then
  STARGET="$TMP/project-string"
  bash "$ROOT/setup.sh" "$STARGET" --hook-form string >"$TMP/setup-s1.log" 2>&1 || { cat "$TMP/setup-s1.log" >&2; fail "--hook-form string 首装失败"; }
  SSET="$STARGET/.claude/settings.json"
  form=$(node "$ROOT/.claude/scripts/hook-form.mjs" --check --file "$SSET" || true)
  [ "$form" = "string" ] || fail "--hook-form string 首装后形态应为 string，实得 $form"
  # shellcheck disable=SC2016  # 单引号内是 JS 源码
  count_js='const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const n = []; for (const gs of Object.values(s.hooks || {})) for (const g of gs) for (const h of (g.hooks || [])) n.push(String(h.command) + " " + (h.args || []).join(" "));
process.stdout.write(n.length + " " + (n.length - new Set(n).size));'
  c1=$(node -e "$count_js" "$SSET")
  # 不带 --hook-form 升级：只靠合并去重，新条目一条都不该合进来
  bash "$ROOT/setup.sh" "$STARGET" >"$TMP/setup-s2.log" 2>&1 || { cat "$TMP/setup-s2.log" >&2; fail "string form 目标升级失败"; }
  c2=$(node -e "$count_js" "$SSET")
  form=$(node "$ROOT/.claude/scripts/hook-form.mjs" --check --file "$SSET" || true)
  [ "$form" = "string" ] || fail "string form 目标升级后形态变成 ${form}（合进了 exec form 条目）"
  [ "$c1" = "$c2" ] || fail "string form 目标升级后条目数/重复数变了：升级前 [$c1] 升级后 [$c2]（格式：总数 重复数）"
  [ "${c2#* }" = "0" ] || fail "string form 目标升级后有重复条目：$c2"
  echo "test-setup: string form 升级校验通过（条目 ${c2% *} 条，零重复，形态保持 string）"

  # (a) 上面那组升级前后是同一套 hook，「合进新条目」的分支没走到——补一个少一条框架 hook 的 string form 目标：
  # 不传 --hook-form 升级，缺的那条要合进来、且是 string form（沿用目标形态），不能留成 mixed。
  # shellcheck disable=SC2016  # 单引号内是 JS 源码
  node -e 'const fs = require("node:fs"); const f = process.argv[1]; const s = JSON.parse(fs.readFileSync(f, "utf8"));
for (const gs of Object.values(s.hooks)) for (const g of gs) g.hooks = g.hooks.filter((h) => !String(h.command).includes("notify.mjs"));
fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n");' "$SSET"
  ! grep -q 'notify.mjs' "$SSET" || fail "夹具 a：删 notify 条目没删干净"
  bash "$ROOT/setup.sh" "$STARGET" >"$TMP/setup-s3.log" 2>&1 || { cat "$TMP/setup-s3.log" >&2; fail "夹具 a：少一条 hook 的 string form 目标升级失败"; }
  form=$(node "$ROOT/.claude/scripts/hook-form.mjs" --check --file "$SSET" || true)
  [ "$form" = "string" ] || fail "夹具 a：升级后形态应为 string，实得 ${form}（新合进来的条目没跟着目标形态）"
  [ "$(grep -c 'notify.mjs' "$SSET")" = "1" ] || fail "夹具 a：升级后 notify.mjs 应合进 1 条，实得 $(grep -c 'notify.mjs' "$SSET")"
  grep -q '"command": "node .claude/hooks/notify.mjs"' "$SSET" || fail "夹具 a：合进来的 notify 条目不是 string form"
  c3=$(node -e "$count_js" "$SSET")
  [ "${c3#* }" = "0" ] || fail "夹具 a：升级后有重复条目：$c3"

  # (b) 用户自己写的「同一脚本 + 额外参数」条目不是框架模板，不能被记成 hook:notify 而把框架那条吃掉：
  # 升级后用户那条原样在，框架那条也合进来，notify.mjs 共两处。
  UTARGET="$TMP/project-userhook"
  bash "$ROOT/setup.sh" "$UTARGET" >"$TMP/setup-u1.log" 2>&1 || { cat "$TMP/setup-u1.log" >&2; fail "夹具 b：首装失败"; }
  # shellcheck disable=SC2016  # JSON 里的 ${CLAUDE_PROJECT_DIR} 是字面量，不让 shell 展开
  printf '%s\n' '{"hooks":{"Notification":[{"hooks":[{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/notify.mjs","--quiet"]}]}]}}' >"$UTARGET/.claude/settings.json"
  bash "$ROOT/setup.sh" "$UTARGET" >"$TMP/setup-u2.log" 2>&1 || { cat "$TMP/setup-u2.log" >&2; fail "夹具 b：用户自定义 hook 目标升级失败"; }
  [ "$(grep -c 'notify.mjs' "$UTARGET/.claude/settings.json")" = "2" ] || fail "夹具 b：升级后 notify.mjs 应出现 2 次（用户那条 + 框架那条），实得 $(grep -c 'notify.mjs' "$UTARGET/.claude/settings.json")"
  grep -q '"--quiet"' "$UTARGET/.claude/settings.json" || fail "夹具 b：用户自定义条目的 --quiet 参数丢了"
  # (c) string form 目标显式 --hook-form exec 升级：装完全文件必须是 exec（老条目转过去），不能是 mixed。
  ETARGET="$TMP/project-string-to-exec"
  bash "$ROOT/setup.sh" "$ETARGET" --hook-form string >"$TMP/setup-e1.log" 2>&1 || { cat "$TMP/setup-e1.log" >&2; fail "夹具 c：string 首装失败"; }
  ESET="$ETARGET/.claude/settings.json"
  # shellcheck disable=SC2016  # 单引号内是 JS 源码
  node -e 'const fs = require("node:fs"); const f = process.argv[1]; const s = JSON.parse(fs.readFileSync(f, "utf8"));
for (const gs of Object.values(s.hooks)) for (const g of gs) g.hooks = g.hooks.filter((h) => !String(h.command).includes("notify.mjs"));
fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n");' "$ESET"
  bash "$ROOT/setup.sh" "$ETARGET" --hook-form exec >"$TMP/setup-e2.log" 2>&1 || { cat "$TMP/setup-e2.log" >&2; fail "夹具 c：--hook-form exec 升级失败"; }
  form=$(node "$ROOT/.claude/scripts/hook-form.mjs" --check --file "$ESET" || true)
  [ "$form" = "exec" ] || fail "夹具 c：EXPECT exec，GOT ${form}（string 目标显式传 exec 升级后不是全文件 exec）"
  c4=$(node -e "$count_js" "$ESET")
  [ "${c4#* }" = "0" ] || fail "夹具 c：升级后有重复条目：$c4"
  [ "$(grep -c '"args"' "$ESET")" = "${c4% *}" ] || fail "夹具 c：EXPECT args 条数 ${c4% *}，GOT $(grep -c '"args"' "$ESET")"
  echo "test-setup: 沿用目标形态 + 去重键只认框架模板校验通过（夹具 a / b / c）"
else
  echo "test-setup: [SKIP] ⑤ string form 升级——无 jq 或走 setup.ps1，合并去重这条路径不在本机（未执行 != 通过）"
fi
