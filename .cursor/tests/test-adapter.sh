#!/usr/bin/env bash
# risk: high
# test-adapter.sh — Cursor 适配层自测：gen-agents.mjs、gen-rules.mjs、hook-adapter.mjs、cursor-hook-preload.mjs、
#   setup-cursor.sh 装到临时目录、sync-from-cc-base.sh 的行为与幂等。cc-base 原件自己的测试在 .claude/tests/，不在这里重复。
#
# 纪律：全程不写本仓（ROOT）：开头 cp -a 本仓（含 .git）到 mktemp 副本 $R，gen-agents / setup-cursor / sync 全在副本和更多临时目录里跑，
#   ROOT 只读；结尾核对 ROOT 的 git status --short 与开场一致。安装一律装到 mktemp 目录，用完删。
#   每条断言打印 EXPECT / GOT，判定不依赖措辞。
#   sync 幂等要有真 cc-base 仓才能跑（$CC_BASE_DIR，缺省 ../cc-base）；没有就 SKIP——未执行 != 通过。
#   sync 的行为断言用 mktemp 下造的最小 git 仓当假 cc-base，不依赖真 cc-base。
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1

echo "===== test-adapter ====="

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node——gen-agents 与 hook-form 都跑不了，未执行 != 通过。" >&2
    exit 1
fi

PASS=0
FAIL=0
SKIP=0
TMPS=""
STATUS0=$(git status --short | LC_ALL=C sort | cksum)

cleanup() {
    # shellcheck disable=SC2086  # TMPS 是空格分隔的 mktemp 路径，故意拆词
    [ -n "$TMPS" ] && rm -rf $TMPS
}
trap cleanup EXIT

# 本仓副本：下面所有会写文件的步骤都对它做，ROOT 不动
R=$(mktemp -d); TMPS="$TMPS $R"
cp -a "$ROOT/." "$R/" || { echo "cp -a 本仓到 $R 失败" >&2; exit 1; }
cd "$R" || exit 1
W=$(mktemp -d); TMPS="$TMPS $W"
MODELS="$R/.cursor/agents-models.json"
# gen [项目根]：在指定根（缺省副本 $R）上跑副本里的 gen-agents.mjs
gen() { CLAUDE_PROJECT_DIR="${1:-$R}" node "$R/.cursor/scripts/gen-agents.mjs"; }
# tsum <目录>：目录下除 .git 外所有文件的内容校验和（含路径），用来证明「一个文件都没动」
tsum() { (cd "$1" && find . -path ./.git -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 cksum | cksum); }

# chk <判定 0=过/1=不过> <标题> <EXPECT 描述> <GOT 描述>
chk() {
    if [ "$1" -eq 0 ]; then
        PASS=$((PASS + 1)); echo "  [PASS] $2"
    else
        FAIL=$((FAIL + 1)); echo "  [FAIL] $2"
    fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}

# has <文件> <固定串> —— 退出码 0 表示含
has() { grep -qF -- "$2" "$1"; }
# fmline <文件> <键> —— 只在 frontmatter（第一对 --- 之间）里取该键的值，没有就空
fmline() {
    awk -v k="$2" '
        /^---$/ { n++; next }
        n == 1 && index($0, k ": ") == 1 { print substr($0, length(k) + 3); exit }
        n >= 2 { exit }
    ' "$1"
}

AG="$R/.cursor/agents"

echo "--- gen-agents：产出形状"
gen >/dev/null 2>&1
rc=$?
chk "$rc" "gen-agents 退 0" "rc=0" "rc=$rc"
n=$(find "$AG" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
chk "$([ "$n" = "8" ] && echo 0 || echo 1)" "产出 8 个文件" "8" "$n"

bad_model=""; bad_key=""
for f in "$AG"/*.md; do
    [ "$(fmline "$f" model)" = "inherit" ] || bad_model="$bad_model $(basename "$f")"
    for k in skills color memory disallowedTools maxTurns tools; do
        [ -n "$(fmline "$f" "$k")" ] && bad_key="$bad_key $(basename "$f"):$k"
    done
done
chk "$([ -z "$bad_model" ] && echo 0 || echo 1)" "每个文件 frontmatter 含 model: inherit（未钉死时）" "无例外" "例外：${bad_model:-无}"
chk "$([ -z "$bad_key" ] && echo 0 || echo 1)" "frontmatter 不含 skills / color / memory 等 Cursor 不认的键" "无" "${bad_key:-无}"

bad_head=""
for f in "$AG"/*.md; do
    [ "$(head -n 1 "$f")" = "---" ] || bad_head="$bad_head $(basename "$f")"
done
chk "$([ -z "$bad_head" ] && echo 0 || echo 1)" "每个生成文件第 1 行恰好是 ---" "无例外" "例外：${bad_head:-无}"
bad_cmt=""
for f in "$AG"/*.md; do
    cl=$(grep -n -m1 -F '<!-- 由 .cursor/scripts/gen-agents.mjs' "$f" | cut -d: -f1)
    fe=$(awk '/^---$/ { n++; if (n == 2) { print NR; exit } }' "$f")
    { [ -n "$cl" ] && [ -n "$fe" ] && [ "$cl" -gt "$fe" ]; } || bad_cmt="$bad_cmt $(basename "$f")"
done
chk "$([ -z "$bad_cmt" ] && echo 0 || echo 1)" "每个生成文件有「由 gen-agents 生成」注释行且在 frontmatter 结束之后" "无例外" "例外：${bad_cmt:-无}"

has "$AG/implementer.md" "先完整读 \`.claude/skills/dev-builder/SKILL.md\`"; r1=$?
chk "$r1" "implementer 正文含「先完整读 .claude/skills/dev-builder/SKILL.md」" "命中" "rc=$r1"
has "$AG/tester.md" "不要再派子代理"; r2=$?
has "$AG/tester.md" "agent-memory/tester"; r3=$?
chk "$((r2 + r3))" "tester 正文含「不要再派子代理」与「agent-memory/tester」" "两句都命中" "不要再派子代理 rc=$r2；agent-memory/tester rc=$r3"

echo "--- gen-agents：正文逐字一致、frontmatter 取值、disallowedTools 写成正文"
# fbody <文件>：去掉 frontmatter（第一对 ---）与其后的前导空行，剩下的正文
fbody() { awk '/^---$/ && n < 2 { n++; next } n >= 2 { if (!st && $0 == "") next; st = 1; print }' "$1"; }
bad_body=""; bad_pre=""; bad_desc=""; bad_name=""
for f in "$AG"/*.md; do
    b=$(basename "$f"); src="$R/.claude/agents/$b"
    fbody "$src" >"$W/src.body"; fbody "$f" >"$W/gen.body"
    n=$(wc -l <"$W/src.body" | tr -d ' '); total=$(wc -l <"$W/gen.body" | tr -d ' ')
    tail -n "$n" "$W/gen.body" >"$W/gen.tail"
    cmp -s "$W/src.body" "$W/gen.tail" || bad_body="$bad_body $b"
    # 正文之前只许是：生成注释一行，加上开头的几句（读技能 / 不要再派子代理 / 不要用某工具 / 持久记忆）
    if head -n "$((total - n))" "$W/gen.body" | grep -v '^$' | tail -n +2 \
        | grep -qvE '^(开工前先完整读 |不要再派子代理。$|不要用 .+工具。$|你的持久记忆在 )'; then bad_pre="$bad_pre $b"; fi
    d_src=$(fmline "$src" description)
    { [ -n "$d_src" ] && [ "$(fmline "$f" description)" = "$d_src" ]; } || bad_desc="$bad_desc $b"
    [ "$(fmline "$f" name)" = "${b%.md}" ] || bad_name="$bad_name $b"
done
chk "$([ -z "$bad_body" ] && echo 0 || echo 1)" "每个生成文件的正文（去掉 frontmatter、注释与开头几句）与源文件去掉 frontmatter 后逐字一致" "无例外" "例外：${bad_body:-无}"
chk "$([ -z "$bad_pre" ] && echo 0 || echo 1)" "正文之前除生成注释外只有约定的几类开头句" "无例外" "例外：${bad_pre:-无}"
chk "$([ -z "$bad_desc" ] && echo 0 || echo 1)" "每个生成文件的 description 等于源文件的值（且非空）" "无例外" "例外：${bad_desc:-无}"
chk "$([ -z "$bad_name" ] && echo 0 || echo 1)" "每个生成文件的 name 等于文件名" "无例外" "例外：${bad_name:-无}"

bad_dis=""
for a in domain-recorder feedback-observer progress-recorder; do
    has "$AG/$a.md" "不要用 Shell（Bash）工具。" && has "$AG/$a.md" "不要再派子代理。" || bad_dis="$bad_dis $a"
done
chk "$([ -z "$bad_dis" ] && echo 0 || echo 1)" "disallowedTools 为 Bash, Task 的三个角色正文含「不要用 Shell（Bash）工具。」与「不要再派子代理。」" "三个都含两句" "缺：${bad_dis:-无}"
has "$AG/implementer.md" "不要用 Shell（Bash）工具。"; r1=$?
has "$AG/implementer.md" "不要再派子代理。"; r2=$?
chk "$([ "$r1" -ne 0 ] && [ "$r2" -eq 0 ] && echo 0 || echo 1)" "implementer（disallowedTools: Task）不含 Shell 那句、含不要再派子代理" "Shell 句 rc≠0、子代理句 rc=0" "Shell 句 rc=$r1；子代理句 rc=$r2"

echo "--- gen-agents：清掉源头已删的生成物"
F=$(mktemp -d); TMPS="$TMPS $F"
mkdir -p "$F/.claude/agents" "$F/.cursor/agents"
for n in gone stay; do
    printf -- '---\nname: %s\ndescription: d-%s\n---\n\n正文 %s\n' "$n" "$n" "$n" >"$F/.claude/agents/$n.md"
done
printf '手写的，没有生成注释\n' >"$F/.cursor/agents/keep.md"
gen "$F" >/dev/null 2>&1; rc1=$?
ok1=$([ -f "$F/.cursor/agents/gone.md" ] && echo 0 || echo 1)
rm -f "$F/.claude/agents/gone.md"
out=$(gen "$F" 2>&1); rc2=$?
chk "$((rc1 + rc2 + ok1))" "夹具里造 gone.md 源后生成，gone.md 出现；删源再生成退 0" "第一次生成出 gone.md，两次 rc=0" "rc=$rc1 / $rc2，gone.md 第一次生成=$([ "$ok1" = 0 ] && echo 有 || echo 无)"
chk "$([ ! -e "$F/.cursor/agents/gone.md" ] && echo 0 || echo 1)" "删源再生成后 .cursor/agents/gone.md 被清掉，stdout 说了一句" "gone.md 不在，stdout 含 gone.md" "gone.md=$([ -e "$F/.cursor/agents/gone.md" ] && echo 还在 || echo 已清)；stdout=$(printf '%s' "$out" | grep -c 'gone.md') 行提到"
chk "$([ -f "$F/.cursor/agents/keep.md" ] && [ -f "$F/.cursor/agents/stay.md" ] && echo 0 || echo 1)" "手写的 keep.md（无生成注释）与仍有源的 stay.md 都还在" "都在" "keep=$([ -f "$F/.cursor/agents/keep.md" ] && echo 有 || echo 无) stay=$([ -f "$F/.cursor/agents/stay.md" ] && echo 有 || echo 无)"

echo "--- gen-agents：复制改名的定制文件不被清、Agent 也写成不要再派子代理"
G=$(mktemp -d); TMPS="$TMPS $G"
mkdir -p "$G/.claude/agents"
printf -- '---\nname: code-reviewer\ndescription: d-cr\ndisallowedTools: Agent\n---\n\n正文 cr\n' >"$G/.claude/agents/code-reviewer.md"
gen "$G" >/dev/null 2>&1; rc1=$?
cp "$G/.cursor/agents/code-reviewer.md" "$G/.cursor/agents/my-reviewer.md"
gen "$G" >/dev/null 2>&1; rc2=$?
chk "$((rc1 + rc2 + $([ -f "$G/.cursor/agents/my-reviewer.md" ] && echo 0 || echo 1)))" "复制 code-reviewer.md 成 my-reviewer.md（注释里源名是 code-reviewer，无 my-reviewer 源），再生成后它还在" "rc=0 且 my-reviewer.md 在" "rc=$rc1 / $rc2，my-reviewer.md=$([ -f "$G/.cursor/agents/my-reviewer.md" ] && echo 有 || echo 被删)"
chk "$(has "$G/.cursor/agents/code-reviewer.md" "不要再派子代理。" && echo 0 || echo 1)" "源文件 disallowedTools: Agent 时生成版含「不要再派子代理。」" "含" "$(has "$G/.cursor/agents/code-reviewer.md" "不要再派子代理。" && echo 含 || echo 不含)"

echo "--- gen-agents：readonly 与 description 冒号转义"
bad_ro=""
for f in "$AG"/*.md; do
    [ -n "$(fmline "$f" readonly)" ] && bad_ro="$bad_ro $(basename "$f")"
done
chk "$([ -z "$bad_ro" ] && echo 0 || echo 1)" "现行内置角色（含 implementer / tester / code-reviewer）均不含 readonly" "无" "${bad_ro:-无}"
H=$(mktemp -d); TMPS="$TMPS $H"
mkdir -p "$H/.claude/agents"
printf -- '---\nname: ro\ndescription: 审码角色: 只审不改\ndisallowedTools: Write, Edit, Task\n---\n\n正文 ro\n' >"$H/.claude/agents/ro.md"
printf -- '---\nname: half\ndescription: 单禁写无冒号\ndisallowedTools: Write, Task\n---\n\n正文 half\n' >"$H/.claude/agents/half.md"
printf -- '---\nname: q\ndescription: "已引号: 值"\n---\n\n正文 q\n' >"$H/.claude/agents/q.md"
printf -- '---\nname: hash\ndescription: 处理 #1 任务\n---\n\n正文 hash\n' >"$H/.claude/agents/hash.md"
gen "$H" >/dev/null 2>&1; rc=$?
ro_val=$(fmline "$H/.cursor/agents/ro.md" readonly)
half_val=$(fmline "$H/.cursor/agents/half.md" readonly)
chk "$([ "$rc" -eq 0 ] && [ "$ro_val" = "true" ] && [ -z "$half_val" ] && echo 0 || echo 1)" "夹具同时禁 Write 与 Edit 输出 readonly: true；仅禁 Write 不输出" "rc=0 ro=true half=空" "rc=$rc ro=${ro_val:-空} half=${half_val:-空}"
ro_desc=$(fmline "$H/.cursor/agents/ro.md" description)
ro_parsed=$(DESC_RAW="$ro_desc" node --input-type=module -e 'try { const v = JSON.parse(process.env.DESC_RAW); if (typeof v === "string") process.stdout.write(v); } catch {}')
chk "$([ "$ro_desc" = '"审码角色: 只审不改"' ] && [ "$ro_parsed" = "审码角色: 只审不改" ] && echo 0 || echo 1)" "description 含冒号加空格时做 JSON 双引号转义且不破坏 frontmatter" '"审码角色: 只审不改"' "$ro_desc"
q_desc=$(fmline "$H/.cursor/agents/q.md" description)
h_desc=$(fmline "$H/.cursor/agents/hash.md" description)
chk "$([ "$q_desc" = '"已引号: 值"' ] && [ "$h_desc" = '"处理 #1 任务"' ] && echo 0 || echo 1)" "description 源写双引号不二次 stringify，含 #1 自动做 JSON 双引号转义" 'q="已引号: 值" hash="处理 #1 任务"' "q=$q_desc hash=$h_desc"

echo "--- gen-agents：agents-models.json 钉死与回落"
printf '{"code-reviewer":"auto"}\n' >"$MODELS"
gen >/dev/null 2>&1
got=$(fmline "$AG/code-reviewer.md" model)
other=$(fmline "$AG/tester.md" model)
chk "$([ "$got" = "auto" ] && [ "$other" = "inherit" ] && echo 0 || echo 1)" "钉了 code-reviewer: auto 后它变 auto、别的角色仍 inherit" "code-reviewer=auto tester=inherit" "code-reviewer=$got tester=$other"
rm -f "$MODELS"
gen >/dev/null 2>&1
got=$(fmline "$AG/code-reviewer.md" model)
chk "$([ "$got" = "inherit" ] && echo 0 || echo 1)" "删掉 agents-models.json 再生成，变回 inherit" "inherit" "$got"
printf '{坏的' >"$MODELS"
gen >/dev/null 2>&1; rc=$?
chk "$([ "$rc" -eq 1 ] && echo 0 || echo 1)" "agents-models.json 不是合法 JSON 时 gen-agents 退 1（不静默回落）" "rc=1" "rc=$rc"
# 还原副本里的状态，后面的 setup 才装得到正确的 .cursor/agents
rm -f "$MODELS"
gen >/dev/null 2>&1

echo "--- gen-rules：主控规则生成与异常退出"
trim_blank() {
    awk '{ sub(/\r$/, ""); a[++n] = $0 } END { s = 1; while (s <= n && a[s] == "") s++; while (n >= s && a[n] == "") n--; for (i = s; i <= n; i++) print a[i] }' "$1"
}
MDC="$R/.cursor/rules/cc-base-claude.mdc"
rm -f "$MDC"
CLAUDE_PROJECT_DIR="$R" node "$R/.cursor/scripts/gen-rules.mjs" >/dev/null 2>&1; rc=$?
aa=$([ -f "$MDC" ] && fmline "$MDC" alwaysApply || echo "")
chk "$([ "$rc" -eq 0 ] && [ "$aa" = "true" ] && echo 0 || echo 1)" "gen-rules 退 0，生成 cc-base-claude.mdc 且 frontmatter 含 alwaysApply: true" "rc=0 alwaysApply=true" "rc=$rc alwaysApply=${aa:-空}"
fbody "$MDC" >"$W/mdc.after_fm"
cmt_ok=$(head -n 1 "$W/mdc.after_fm" | grep -c '^<!-- 由 \.cursor/scripts/gen-rules\.mjs 从 \.claude/CLAUDE\.md 生成')
tail -n +2 "$W/mdc.after_fm" >"$W/mdc.raw_body"
trim_blank "$W/mdc.raw_body" >"$W/mdc.body"
trim_blank "$R/.claude/CLAUDE.md" >"$W/claude.body"
chk "$([ "$cmt_ok" = "1" ] && cmp -s "$W/mdc.body" "$W/claude.body" && echo 0 || echo 1)" "去掉 frontmatter 与头注释后正文与 .claude/CLAUDE.md 去首尾空行逐字一致" "头注释命中且正文逐字一致" "头注释=$cmt_ok cmp=$(cmp -s "$W/mdc.body" "$W/claude.body" && echo 一致 || echo 不同)"
R_BAD=$(mktemp -d); TMPS="$TMPS $R_BAD"
CLAUDE_PROJECT_DIR="$R_BAD" node "$R/.cursor/scripts/gen-rules.mjs" >/dev/null 2>&1; rc_miss=$?
mkdir -p "$R_BAD/.claude"
: >"$R_BAD/.claude/CLAUDE.md"
CLAUDE_PROJECT_DIR="$R_BAD" node "$R/.cursor/scripts/gen-rules.mjs" >/dev/null 2>&1; rc_empty=$?
printf '  \n\t\n' >"$R_BAD/.claude/CLAUDE.md"
CLAUDE_PROJECT_DIR="$R_BAD" node "$R/.cursor/scripts/gen-rules.mjs" >/dev/null 2>&1; rc_ws=$?
chk "$([ "$rc_miss" -eq 1 ] && [ "$rc_empty" -eq 1 ] && [ "$rc_ws" -eq 1 ] && [ ! -e "$R_BAD/.cursor/rules/cc-base-claude.mdc" ] && echo 0 || echo 1)" "缺 .claude/CLAUDE.md 或为空文件（含纯空白）时 gen-rules 退 1 且不落产物" "rc=1/1/1 且无产物" "miss=$rc_miss empty=$rc_empty ws=$rc_ws 产物=$([ -e "$R_BAD/.cursor/rules/cc-base-claude.mdc" ] && echo 有 || echo 无)"

echo "--- hook-adapter 与 cursor-hook-preload：五事件互补契约、密钥读护栏、发布命令询问与子代理桥接"
hk_info=$(HK_FILE="$R/.cursor/hooks.json" node --input-type=module -e '
  import fs from "node:fs";
  try {
    const d = JSON.parse(fs.readFileSync(process.env.HK_FILE, "utf8"));
    const keys = d && d.hooks && typeof d.hooks === "object" && !Array.isArray(d.hooks) ? Object.keys(d.hooks).sort() : [];
    const fc = Array.isArray(d.hooks?.beforeReadFile) && d.hooks.beforeReadFile[0]?.failClosed === true;
    process.stdout.write(keys.join(",") + "|failClosed=" + String(fc));
  } catch { process.stdout.write("INVALID|failClosed=false"); }
')
hk_expect="beforeReadFile,beforeShellExecution,sessionStart,subagentStart,subagentStop|failClosed=true"
chk "$([ "$hk_info" = "$hk_expect" ] && echo 0 || echo 1)" ".cursor/hooks.json 合法 JSON，五事件键集合精确匹配且 beforeReadFile[0].failClosed===true" "$hk_expect" "$hk_info"

HA="$R/.cursor/scripts/hook-adapter.mjs"
BRF_DIR=$(mktemp -d); TMPS="$TMPS $BRF_DIR"
: >"$BRF_DIR/.env"
ln -s .env "$BRF_DIR/innocent.txt"
run_brf() {
    local fp=$1 rt=${2:-$BRF_DIR} payload
    payload=$(FP="$fp" RT="$rt" node --input-type=module -e 'process.stdout.write(JSON.stringify({file_path: process.env.FP, workspace_roots: [process.env.RT]}))')
    BRF_OUT=$(printf '%s' "$payload" | env -u CURSOR_PROJECT_DIR -u CLAUDE_PROJECT_DIR node "$HA" beforeReadFile 2>/dev/null)
    BRF_RC=$?
}
chk_deny_out() {
    [ "$1" -eq 2 ] && printf '%s' "$2" | grep -qF -- '"permission":"deny"' && printf '%s' "$2" | grep -qF -- '"user_message"'
}
bad_brf=""
# shellcheck disable=SC2088  # 故意同时测字面量 ~/.ssh/id_rsa 与展开后的 $HOME/.ssh/id_rsa
for p in ".env" "secrets/a.txt" "~/.ssh/id_rsa" "$HOME/.ssh/id_rsa" "keys/id_rsa-prod" "cert.pem" "C:.env" 'C:\work\proj\server.pem.' "innocent.txt"; do
    run_brf "$p"
    chk_deny_out "$BRF_RC" "$BRF_OUT" || bad_brf="$bad_brf $p(rc=$BRF_RC)"
done
run_brf "db.txt" "/work/secrets"
chk_deny_out "$BRF_RC" "$BRF_OUT" || bad_brf="$bad_brf secrets-root/db.txt(rc=$BRF_RC)"
run_brf "/tmp/parent/secrets/proj/secrets/a.txt" "/tmp/parent/secrets/proj"
chk_deny_out "$BRF_RC" "$BRF_OUT" || bad_brf="$bad_brf root-secrets/secrets/a.txt(rc=$BRF_RC)"
BRF_OUT=$(printf '%s' '{"file_path":' | env -u CURSOR_PROJECT_DIR -u CLAUDE_PROJECT_DIR node "$HA" beforeReadFile 2>/dev/null); BRF_RC=$?
chk_deny_out "$BRF_RC" "$BRF_OUT" || bad_brf="$bad_brf trunc-json(rc=$BRF_RC)"
BRF_OUT=$(python3 -c '
import os, subprocess, sys, time
r, w = os.pipe()
os.set_blocking(r, False)
env = {k: v for k, v in os.environ.items() if k not in ("CURSOR_PROJECT_DIR", "CLAUDE_PROJECT_DIR")}
p = subprocess.Popen(["node", sys.argv[1], "beforeReadFile"], stdin=r, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
os.close(r)
time.sleep(0.04)
os.write(w, b"{\"file_path\":\".env\"}")
os.close(w)
out, _ = p.communicate(timeout=5)
sys.stdout.buffer.write(out)
sys.exit(p.returncode)
' "$HA" 2>/dev/null); BRF_RC=$?
if ! chk_deny_out "$BRF_RC" "$BRF_OUT" || printf '%s' "$BRF_OUT" | grep -qF -- '输入异常'; then
    bad_brf="$bad_brf nonblock-pipe(rc=$BRF_RC,out=$BRF_OUT)"
fi
for p in ".env.example" "README.md"; do
    run_brf "$p"
    { [ "$BRF_RC" -eq 0 ] && printf '%s' "$BRF_OUT" | grep -qF -- '"permission":"allow"'; } || bad_brf="$bad_brf allow:$p(rc=$BRF_RC)"
done
run_brf "/tmp/parent/secrets/proj/README.md" "/tmp/parent/secrets/proj"
{ [ "$BRF_RC" -eq 0 ] && printf '%s' "$BRF_OUT" | grep -qF -- '"permission":"allow"'; } || bad_brf="$bad_brf allow:posix-sec-anc(rc=$BRF_RC)"
run_brf 'c:\users\dev\secrets\proj\README.md' 'C:\users\dev\secrets\proj'
{ [ "$BRF_RC" -eq 0 ] && printf '%s' "$BRF_OUT" | grep -qF -- '"permission":"allow"'; } || bad_brf="$bad_brf allow:win-sec-anc(rc=$BRF_RC)"
chk "$([ -z "$bad_brf" ] && echo 0 || echo 1)" "beforeReadFile 敏感路径/Windows盘符尾点/敏感根/软链/坏JSON/O_NONBLOCK管道均 rc=2 deny+user_message，白名单均 rc=0 allow" "无异常" "异常：${bad_brf:-无}"

H1_DIR=$(mktemp -d); TMPS="$TMPS $H1_DIR"
H1_A="$H1_DIR/rootA"; H1_B="$H1_DIR/rootB"; mkdir -p "$H1_A" "$H1_B"
: >"$H1_B/.env"; ln -s .env "$H1_B/link.txt"
h1_p1=$(A="$H1_A" B="$H1_B" node --input-type=module -e 'process.stdout.write(JSON.stringify({file_path: "link.txt", workspace_roots: [process.env.A, process.env.B], cwd: process.env.B}))')
h1_o1=$(printf '%s' "$h1_p1" | env -u CURSOR_PROJECT_DIR -u CLAUDE_PROJECT_DIR node "$HA" beforeReadFile 2>/dev/null); h1_r1=$?
H1_C="$H1_DIR/posix_c"; mkdir -p "$H1_C/c:"
: >"$H1_C/.env"; ln -s ../.env "$H1_C/c:/innocent.txt"
h1_p2=$(C="$H1_C" node --input-type=module -e 'process.stdout.write(JSON.stringify({file_path: "c:/innocent.txt", workspace_roots: [process.env.C], cwd: process.env.C}))')
h1_o2=$(cd "$H1_C" && printf '%s' "$h1_p2" | env -u CURSOR_PROJECT_DIR -u CLAUDE_PROJECT_DIR node "$HA" beforeReadFile 2>/dev/null); h1_r2=$?
H1_D="$H1_DIR/dangling"; mkdir -p "$H1_D"
ln -s id_rsa-dangling "$H1_D/hop2.txt"; ln -s hop2.txt "$H1_D/hop1.txt"
run_brf "hop1.txt" "$H1_D"; h1_o3=$BRF_OUT; h1_r3=$BRF_RC
bad_h1=""
chk_deny_out "$h1_r1" "$h1_o1" || bad_h1="$bad_h1 multiroot(rc=$h1_r1)"
chk_deny_out "$h1_r2" "$h1_o2" || bad_h1="$bad_h1 posix-c:(rc=$h1_r2)"
chk_deny_out "$h1_r3" "$h1_o3" || bad_h1="$bad_h1 hop2-dangling(rc=$h1_r3)"
chk "$([ -z "$bad_h1" ] && echo 0 || echo 1)" "H1 软链绕过锁死：多根 cwd 软链、Linux 本地 c:/ 软链、两跳悬空软链均 rc=2 deny" "三项均 rc=2 deny" "异常：${bad_h1:-无}"

bad_bse=""
for cmd in "npm publish" "gh release create v1" "docker push img"; do
    bse_out=$(CMD="$cmd" node --input-type=module -e 'process.stdout.write(JSON.stringify({command: process.env.CMD}))' | node "$HA" beforeShellExecution 2>/dev/null); bse_rc=$?
    { [ "$bse_rc" -eq 0 ] && printf '%s' "$bse_out" | grep -qF -- '"permission":"ask"'; } || bad_bse="$bad_bse ask:$cmd(rc=$bse_rc)"
done
bse_out=$(printf '%s' '{"command":"git status"}' | node "$HA" beforeShellExecution 2>/dev/null); bse_rc=$?
{ [ "$bse_rc" -eq 0 ] && printf '%s' "$bse_out" | grep -qF -- '"permission":"allow"'; } || bad_bse="$bad_bse allow:git-status(rc=$bse_rc)"
chk "$([ -z "$bad_bse" ] && echo 0 || echo 1)" "beforeShellExecution 对发布命令返回 ask，普通命令 git status 返回 allow" "全部 rc=0 且 ask/allow 匹配" "异常：${bad_bse:-无}"

SB=$(mktemp -d); TMPS="$TMPS $SB"; cp -a "$R/." "$SB/"
ss_out=$(printf '{"workspace_roots":["%s"]}' "$SB" | env -u CURSOR_PROJECT_DIR -u NODE_OPTIONS CLAUDE_PROJECT_DIR="$SB" node "$SB/.cursor/scripts/hook-adapter.mjs" sessionStart 2>/dev/null)
node_opts=$(SS="$ss_out" node --input-type=module -e 'try { process.stdout.write(JSON.parse(process.env.SS).env.NODE_OPTIONS || ""); } catch {}')
run_ndcg() {
    printf '{"conversation_id":"%s","tool_name":"Write","tool_input":{"file_path":"src/a.py"}}' "$1" \
        | env -u CURSOR_PROJECT_DIR CLAUDE_PROJECT_DIR="$SB" NODE_OPTIONS="$node_opts" node "$SB/.claude/hooks/no-direct-code-guard.mjs" >/dev/null 2>&1
}
run_ndcg c1; rc_pre=$?
printf '{"subagent_id":"sub-1","subagent_type":"implementer","conversation_id":"c1"}' \
    | env -u CURSOR_PROJECT_DIR CLAUDE_PROJECT_DIR="$SB" node "$SB/.cursor/scripts/hook-adapter.mjs" subagentStart >/dev/null 2>&1; rc_start=$?
state_created=$([ -d "$SB/.claude/evidence/.cursor-subagents" ] && echo 1 || echo 0)
run_ndcg c1; rc_c1=$?
run_ndcg c2; rc_c2=$?

# M1：无 conversation_id 仍 rc=2、subagent_id 作 conversation_id 得 rc=0、CLAUDE_PROJECT_DIR 优先于外层 CURSOR_PROJECT_DIR
printf '%s' '{"tool_input":{"file_path":"src/a.py"}}' \
    | env -u CLAUDE_PROJECT_DIR CURSOR_PROJECT_DIR="$SB" NODE_OPTIONS="$node_opts" node "$SB/.claude/hooks/no-direct-code-guard.mjs" >/dev/null 2>&1; rc_nocid=$?
printf '%s' '{"conversation_id":"sub-1","tool_name":"Write","tool_input":{"file_path":"src/a.py"}}' \
    | env -u CLAUDE_PROJECT_DIR CURSOR_PROJECT_DIR="$SB" NODE_OPTIONS="$node_opts" node "$SB/.claude/hooks/no-direct-code-guard.mjs" >/dev/null 2>&1; rc_selfcid=$?
SB2=$(mktemp -d); TMPS="$TMPS $SB2"; cp -a "$R/." "$SB2/"
printf '%s' '{"conversation_id":"c1","tool_name":"Write","tool_input":{"file_path":"src/a.py"}}' \
    | CURSOR_PROJECT_DIR="$SB" CLAUDE_PROJECT_DIR="$SB2" NODE_OPTIONS="$node_opts" node "$SB2/.claude/hooks/no-direct-code-guard.mjs" >/dev/null 2>&1; rc_iso=$?

printf '{"subagent_id":"sub-1","conversation_id":"c1"}' \
    | env -u CURSOR_PROJECT_DIR CLAUDE_PROJECT_DIR="$SB" node "$SB/.cursor/scripts/hook-adapter.mjs" subagentStop >/dev/null 2>&1; rc_stop=$?
state_gone=$([ ! -e "$SB/.claude/evidence/.cursor-subagents" ] && echo 1 || echo 0)
run_ndcg c1; rc_post=$?
chk "$([ -n "$node_opts" ] && [ "$rc_pre" -eq 2 ] && [ "$rc_start" -eq 0 ] && [ "$state_created" -eq 1 ] && [ "$rc_c1" -eq 0 ] && [ "$rc_c2" -eq 2 ] && [ "$rc_stop" -eq 0 ] && [ "$state_gone" -eq 1 ] && [ "$rc_post" -eq 2 ] && echo 0 || echo 1)" "子代理 agent_id 桥接闭环：sessionStart 注入 NODE_OPTIONS -> c1 启前 rc=2 -> subagentStart 建目录且 c1=0/c2=2 -> subagentStop 删目录且 c1 恢复 rc=2" "opts非空 pre=2 start=0 dir建=1 c1=0 c2=2 stop=0 dir删=1 post=2" "opts=${node_opts:+有} pre=$rc_pre start=$rc_start dir建=$state_created c1=$rc_c1 c2=$rc_c2 stop=$rc_stop dir删=$state_gone post=$rc_post"
chk "$([ "$rc_nocid" -eq 2 ] && [ "$rc_selfcid" -eq 0 ] && [ "$rc_iso" -eq 2 ] && echo 0 || echo 1)" "M1 隔离锁死：缺 conversation_id 仍 rc=2、subagent_id 作 conversation_id 得 rc=0、CLAUDE_PROJECT_DIR 优先于 CURSOR_PROJECT_DIR 得 rc=2" "nocid=2 selfcid=0 iso=2" "nocid=$rc_nocid selfcid=$rc_selfcid iso=$rc_iso"

# M2：6 路并发 subagentStart 无丢更新，逐个 subagentStop 后空目录自动删除
pids=()
for sid in p1 p2 p3 p4 p5 p6; do
    (
        printf '{"subagent_id":"%s","subagent_type":"implementer","conversation_id":"c-%s"}' "$sid" "$sid" \
            | env -u CURSOR_PROJECT_DIR CLAUDE_PROJECT_DIR="$SB" node "$SB/.cursor/scripts/hook-adapter.mjs" subagentStart >/dev/null 2>&1
    ) &
    pids+=("$!")
done
m2_rc=0
for pid in "${pids[@]}"; do
    wait "$pid" || m2_rc=1
done
m2_cnt=$(find "$SB/.claude/evidence/.cursor-subagents" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
for sid in p1 p2 p3 p4 p5 p6; do
    printf '{"subagent_id":"%s","conversation_id":"c-%s"}' "$sid" "$sid" \
        | env -u CURSOR_PROJECT_DIR CLAUDE_PROJECT_DIR="$SB" node "$SB/.cursor/scripts/hook-adapter.mjs" subagentStop >/dev/null 2>&1 || m2_rc=1
done
m2_gone=$([ ! -e "$SB/.claude/evidence/.cursor-subagents" ] && echo 1 || echo 0)
chk "$([ "$m2_rc" -eq 0 ] && [ "$m2_cnt" = "6" ] && [ "$m2_gone" -eq 1 ] && echo 0 || echo 1)" "M2 并发 subagentStart 无丢更新落盘 6 个 .json，逐个 subagentStop 后空目录自动删除" "rc=0 cnt=6 gone=1" "rc=$m2_rc cnt=$m2_cnt gone=$m2_gone"

# L1：适配层脚本可执行位检查
not_exec=""
for s in .cursor/scripts/gen-agents.mjs .cursor/scripts/gen-rules.mjs .cursor/scripts/hook-adapter.mjs; do
    [ -x "$R/$s" ] || not_exec="$not_exec $s"
done
chk "$([ -z "$not_exec" ] && echo 0 || echo 1)" "L1 可执行位检查：gen-agents.mjs、gen-rules.mjs、hook-adapter.mjs 均为 -x" "三个均 -x" "非 -x：${not_exec:-无}"

echo "--- setup-cursor：装到临时目录"
if [ ! -x "$R/setup.sh" ]; then
    SKIP=$((SKIP + 1)); echo "  [SKIP] setup-cursor：本仓还没有 setup.sh（先 sync-from-cc-base.sh），未执行 != 通过"
else
    T=$(mktemp -d); TMPS="$TMPS $T"
    "$R/setup-cursor.sh" "$T" >"$T.out1" 2>&1; rc=$?; TMPS="$TMPS $T.out1"
    chk "$rc" "setup-cursor 退 0" "rc=0" "rc=$rc（输出尾：$(tail -2 "$T.out1" | tr '\n' ' ')）"
    form=$(node "$T/.claude/scripts/hook-form.mjs" --check --file "$T/.claude/settings.json" 2>&1)
    chk "$([ "$form" = "string" ] && echo 0 || echo 1)" "目标 settings.json 形态是 string" "string" "$form"
    n=$(find "$T/.cursor/agents" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
    chk "$([ "$n" = "8" ] && echo 0 || echo 1)" "目标 .cursor/agents/ 有 8 个" "8" "$n"
    chk "$([ -f "$T/AGENTS.md" ] && echo 0 || echo 1)" "目标 AGENTS.md 存在" "存在" "$([ -f "$T/AGENTS.md" ] && echo 存在 || echo 缺失)"
    chk "$([ -f "$T/.cursor/cli.json" ] && [ -f "$T/.cursor/scripts/gen-agents.mjs" ] && echo 0 || echo 1)" "目标有 .cursor/cli.json 与 gen-agents.mjs" "都在" "cli.json=$([ -f "$T/.cursor/cli.json" ] && echo 有 || echo 无) gen-agents=$([ -f "$T/.cursor/scripts/gen-agents.mjs" ] && echo 有 || echo 无)"
    miss_new=""
    for rel in .cursor/rules/cc-base-claude.mdc .cursor/hooks.json .cursor/scripts/gen-rules.mjs .cursor/scripts/hook-adapter.mjs .cursor/scripts/cursor-hook-preload.mjs; do
        [ -f "$T/$rel" ] || miss_new="$miss_new $rel"
    done
    sk_link=$([ -L "$T/.cursor/skills" ] && readlink "$T/.cursor/skills" || echo "非软链")
    chk "$([ -z "$miss_new" ] && [ "$sk_link" = "../.claude/skills" ] && echo 0 || echo 1)" "目标含 cc-base-claude.mdc、hooks.json、gen-rules.mjs、hook-adapter.mjs、cursor-hook-preload.mjs 及软链 .cursor/skills -> ../.claude/skills" "文件齐全且软链为 ../.claude/skills" "缺：${miss_new:-无} skills=$sk_link"

    # 目标里留一个「带生成注释、本仓已无同名」的残留和一个手写的：第二次装后残留清掉、手写的还在
    printf '<!-- 由 .cursor/scripts/gen-agents.mjs 从 .claude/agents/old-gen.md 生成 -->\n' >"$T/.cursor/agents/old-gen.md"
    printf '手写的\n' >"$T/.cursor/agents/hand.md"
    cp "$T/.cursor/agents/code-reviewer.md" "$T/.cursor/agents/my-reviewer.md"

    # 第二次装：先动 AGENTS.md 与 .cursor/hooks.json，均不许被覆盖，新版本落 .framework-new
    printf 'x' >>"$T/AGENTS.md"
    before=$(cksum <"$T/AGENTS.md")
    printf '{"version":1,"hooks":{}}\n' >"$T/.cursor/hooks.json"
    hk_before=$(cksum <"$T/.cursor/hooks.json")
    "$R/setup-cursor.sh" "$T" >"$T.out2" 2>&1; rc=$?; TMPS="$TMPS $T.out2"
    after=$(cksum <"$T/AGENTS.md")
    hk_after=$(cksum <"$T/.cursor/hooks.json")
    chk "$rc" "第二次装退 0" "rc=0" "rc=$rc（输出尾：$(tail -2 "$T.out2" | tr '\n' ' ')）"
    chk "$([ "$before" = "$after" ] && echo 0 || echo 1)" "改过的 AGENTS.md 装完内容不变" "cksum 不变" "前 $before 后 $after"
    chk "$([ ! -e "$T/.cursor/agents/old-gen.md" ] && [ -f "$T/.cursor/agents/hand.md" ] && echo 0 || echo 1)" "第二次装清掉目标里失源的生成物 old-gen.md，手写的 hand.md 不动" "old-gen 无、hand 有" "old-gen=$([ -e "$T/.cursor/agents/old-gen.md" ] && echo 有 || echo 无) hand=$([ -f "$T/.cursor/agents/hand.md" ] && echo 有 || echo 无)"
    chk "$([ -f "$T/.cursor/agents/my-reviewer.md" ] && echo 0 || echo 1)" "第二次装不删复制改名的 my-reviewer.md（注释里源名是 code-reviewer，不是自己）" "my-reviewer 有" "my-reviewer=$([ -f "$T/.cursor/agents/my-reviewer.md" ] && echo 有 || echo 无)"
    chk "$([ -f "$T/AGENTS.md.framework-new" ] && cmp -s "$T/AGENTS.md.framework-new" "$R/AGENTS.md" && echo 0 || echo 1)" "出现 AGENTS.md.framework-new 且等于本仓 AGENTS.md" "存在且相同" "$([ -f "$T/AGENTS.md.framework-new" ] && echo 存在 || echo 缺失)"
    chk "$([ "$hk_before" = "$hk_after" ] && [ -f "$T/.cursor/hooks.json.framework-new" ] && cmp -s "$T/.cursor/hooks.json.framework-new" "$R/.cursor/hooks.json" && echo 0 || echo 1)" "手改过的 .cursor/hooks.json 二装不覆盖，且落 hooks.json.framework-new 等于本仓原件" "原文件未变且 .framework-new 相同" "cksum=$([ "$hk_before" = "$hk_after" ] && echo 未变 || echo 被改) framework-new=$([ -f "$T/.cursor/hooks.json.framework-new" ] && echo 存在 || echo 缺失)"

    # dry-run 不写文件；源缺 hooks.json 早退 rc=1 且目标目录未创建
    D=$(mktemp -d); TMPS="$TMPS $D"
    "$R/setup-cursor.sh" "$D/proj" --dry-run >"$D.out" 2>&1; rc=$?; TMPS="$TMPS $D.out"
    chk "$([ "$rc" -eq 0 ] && [ ! -e "$D/proj" ] && echo 0 || echo 1)" "--dry-run 退 0 且目标目录没被建出来" "rc=0 且无 proj/" "rc=$rc proj=$([ -e "$D/proj" ] && echo 有 || echo 无)"
    R_MISS=$(mktemp -d); TMPS="$TMPS $R_MISS"; cp -a "$R/." "$R_MISS/"
    rm -f "$R_MISS/.cursor/hooks.json"
    "$R_MISS/setup-cursor.sh" "$D/miss-proj" >"$D.miss" 2>&1; rc=$?; TMPS="$TMPS $D.miss"
    chk "$([ "$rc" -eq 1 ] && [ ! -e "$D/miss-proj" ] && echo 0 || echo 1)" "源缺 .cursor/hooks.json 时 setup-cursor 早退 rc=1 且目标目录未创建" "rc=1 且无 miss-proj/" "rc=$rc miss-proj=$([ -e "$D/miss-proj" ] && echo 有 || echo 无)"
fi

echo "--- sync-from-cc-base：行为（假 cc-base 夹具）"
# 假 cc-base：最小 git 仓。hook-form.mjs 取本仓里的那份（同一份原件），.gitignore 白名单段与本仓逐字一致
FC=$(mktemp -d); TMPS="$TMPS $FC"
mkdir -p "$FC/.claude/agents" "$FC/.claude/scripts"
echo "# fake cc-base" >"$FC/.claude/CLAUDE.md"
printf -- '---\nname: one\ndescription: d1\ndisallowedTools: Task\n---\n\n正文一行\n' >"$FC/.claude/agents/one.md"
cp "$R/.claude/scripts/hook-form.mjs" "$FC/.claude/scripts/"
cat >"$FC/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/demo.mjs"]
          }
        ]
      }
    ]
  }
}
JSON
{ echo '# fake cc-base .gitignore'; echo; awk '/^# === Cursor 适配层 ===/ { exit } /^\/\*$/ { on = 1 } on' "$R/.gitignore"; } >"$FC/.gitignore"
echo "fake readme" >"$FC/README.md"
git -C "$FC" init -q && git -C "$FC" add -A -f && git -C "$FC" -c user.name=t -c user.email=t@t commit -q -m init
fc_ok=$?
chk "$fc_ok" "假 cc-base 夹具建好并提交" "rc=0" "rc=$fc_ok"

if [ "$fc_ok" -eq 0 ]; then
    # 1 白名单段改一个字符：退 1，目标一个文件没变
    T1=$(mktemp -d); TMPS="$TMPS $T1"; cp -a "$R/." "$T1/"
    sed -i 's|^!/setup.sh$|!/setup.shx|' "$T1/.gitignore"
    before=$(tsum "$T1")
    "$T1/sync-from-cc-base.sh" "$FC" >/dev/null 2>&1; rc=$?
    after=$(tsum "$T1")
    chk "$([ "$rc" -eq 1 ] && echo 0 || echo 1)" "本仓 .gitignore 白名单段改一个字符后 sync 退 1" "rc=1" "rc=$rc"
    chk "$([ "$before" = "$after" ] && echo 0 || echo 1)" "白名单核对失败时目标一个文件没变（校验和不变）" "前后相同" "前 $before 后 $after"

    # 2 干净的假 cc-base（外部预设 CLAUDE_PROJECT_DIR=$OTHER 验隔离）：删旧、不覆盖自有文件、取 HEAD 清单
    T2=$(mktemp -d); TMPS="$TMPS $T2"; cp -a "$R/." "$T2/"
    OTHER=$(mktemp -d); TMPS="$TMPS $OTHER"; cp -a "$FC/." "$OTHER/"
    old_has=$(grep -cxF 'setup.sh' "$T2/.cursor/cc-base-files.txt")
    CLAUDE_PROJECT_DIR="$OTHER" "$T2/sync-from-cc-base.sh" "$FC" >"$W/s2.out" 2>&1; rc=$?
    chk "$rc" "干净的假 cc-base 同步退 0（外部预设 CLAUDE_PROJECT_DIR）" "rc=0" "rc=$rc（输出尾：$(tail -2 "$W/s2.out" | tr '\n' ' ')）"
    chk "$([ "$old_has" = "1" ] && [ ! -e "$T2/setup.sh" ] && echo 0 || echo 1)" "上次清单里有、这次没有的 setup.sh 被删" "清单含 setup.sh，同步后文件不在" "清单含=$old_has；文件=$([ -e "$T2/setup.sh" ] && echo 还在 || echo 已删)"
    chk "$(cmp -s "$T2/README.md" "$R/README.md" && echo 0 || echo 1)" "本仓自有的 README.md 没被假 cc-base 的 README.md 覆盖" "与同步前相同" "$(cmp -s "$T2/README.md" "$R/README.md" && echo 相同 || echo 被改)"
    chk "$([ -f "$T2/.claude/agents/one.md" ] && [ -f "$T2/.cursor/agents/one.md" ] && echo 0 || echo 1)" "假 cc-base 的 one.md 被拷进来并生成了 .cursor/agents/one.md" "两个都在" "src=$([ -f "$T2/.claude/agents/one.md" ] && echo 有 || echo 无) gen=$([ -f "$T2/.cursor/agents/one.md" ] && echo 有 || echo 无)"
    form=$(CLAUDE_PROJECT_DIR="$T2" node "$T2/.claude/scripts/hook-form.mjs" --check --file "$T2/.claude/settings.json" 2>&1)
    other_form=$(CLAUDE_PROJECT_DIR="$OTHER" node "$T2/.claude/scripts/hook-form.mjs" --check --file "$OTHER/.claude/settings.json" 2>&1)
    t2_sk=$([ -L "$T2/.cursor/skills" ] && readlink "$T2/.cursor/skills" || echo "非软链")
    chk "$([ "$form" = "string" ] && [ "$other_form" = "exec" ] && [ ! -e "$OTHER/.cursor" ] && [ "$t2_sk" = "../.claude/skills" ] && echo 0 || echo 1)" "外部预设 CLAUDE_PROJECT_DIR=\$OTHER 时自身 settings.json 为 string、.cursor/skills 软链就位，且 \$OTHER 仍为 exec 未被污染" "self=string other=exec skills=../.claude/skills" "self=$form other=$other_form skills=$t2_sk"
    fbody "$T2/.cursor/rules/cc-base-claude.mdc" | tail -n +2 >"$W/t2.mdc.raw"
    trim_blank "$W/t2.mdc.raw" >"$W/t2.mdc.body"
    t2_aa=$(fmline "$T2/.cursor/rules/cc-base-claude.mdc" alwaysApply)
    chk "$([ "$t2_aa" = "true" ] && [ "$(cat "$W/t2.mdc.body")" = "# fake cc-base" ] && echo 0 || echo 1)" "假 cc-base 同步后自动生成最新 .cursor/rules/cc-base-claude.mdc" "alwaysApply=true 且正文为 # fake cc-base" "alwaysApply=${t2_aa:-空} body=$(head -n 1 "$W/t2.mdc.body")"

    # 3 源树脏：不带开关退 1 且目标不动；--allow-dirty 放行，未跟踪文件与未提交改动都不进来
    echo "untracked" >"$FC/.claude/untracked.md"
    echo "未提交的改动" >>"$FC/.claude/agents/one.md"
    T3=$(mktemp -d); TMPS="$TMPS $T3"; cp -a "$R/." "$T3/"
    before=$(tsum "$T3")
    "$T3/sync-from-cc-base.sh" "$FC" >/dev/null 2>&1; rc=$?
    after=$(tsum "$T3")
    chk "$([ "$rc" -eq 1 ] && [ "$before" = "$after" ] && echo 0 || echo 1)" "假 cc-base 工作树脏、没带 --allow-dirty：退 1 且目标没动" "rc=1、校验和不变" "rc=$rc；$([ "$before" = "$after" ] && echo 未动 || echo 被改)"
    T4=$(mktemp -d); TMPS="$TMPS $T4"; cp -a "$R/." "$T4/"
    "$T4/sync-from-cc-base.sh" --allow-dirty "$FC" >"$W/s4.out" 2>&1; rc=$?
    git -C "$FC" show HEAD:.claude/agents/one.md >"$W/one.head"
    chk "$rc" "带 --allow-dirty 放行脏的假 cc-base" "rc=0" "rc=$rc（输出尾：$(tail -2 "$W/s4.out" | tr '\n' ' ')）"
    chk "$([ ! -e "$T4/.claude/untracked.md" ] && cmp -s "$T4/.claude/agents/one.md" "$W/one.head" && echo 0 || echo 1)" "只认 HEAD：未跟踪文件不被拷、one.md 是 HEAD 的内容不是未提交的样子" "untracked.md 不在，one.md 等于 HEAD 版" "untracked=$([ -e "$T4/.claude/untracked.md" ] && echo 被拷 || echo 未拷) one.md=$(cmp -s "$T4/.claude/agents/one.md" "$W/one.head" && echo 等于HEAD || echo 不等于HEAD)"
fi

echo "--- sync-from-cc-base：幂等（真 cc-base，在本仓副本里跑）"
CC=${CC_BASE_DIR:-$ROOT/../cc-base}
if [ ! -f "$CC/.claude/CLAUDE.md" ] || [ ! -e "$CC/.git" ]; then
    SKIP=$((SKIP + 1)); echo "  [SKIP] sync 幂等：没有 cc-base 仓（$CC）。未执行 != 通过"
else
    # cc-base 工作树不干净时加 --allow-dirty：同步取的是 HEAD，脏改动不影响幂等判定
    OPT=""
    [ -n "$(git -C "$CC" status --porcelain)" ] && OPT="--allow-dirty" && echo "  (cc-base 工作树不干净，用 --allow-dirty)"
    T5=$(mktemp -d); TMPS="$TMPS $T5"; cp -a "$R/." "$T5/"
    # shellcheck disable=SC2086  # OPT 空时不能留下空参数
    "$T5/sync-from-cc-base.sh" $OPT "$CC" >/dev/null 2>&1; rc1=$?
    s1=$(git -C "$T5" status --short | LC_ALL=C sort | cksum); cp "$T5/.cursor/cc-base-version.txt" "$W/v1"
    # shellcheck disable=SC2086
    "$T5/sync-from-cc-base.sh" $OPT "$CC" >/dev/null 2>&1; rc2=$?
    s2=$(git -C "$T5" status --short | LC_ALL=C sort | cksum)
    chk "$((rc1 + rc2))" "两次 sync 都退 0" "rc=0 / rc=0" "rc=$rc1 / rc=$rc2"
    chk "$([ "$s1" = "$s2" ] && echo 0 || echo 1)" "第二次 sync 后 git status --short 与第一次后相同" "两次 cksum 相同" "$s1 / $s2"
    chk "$(cmp -s "$W/v1" "$T5/.cursor/cc-base-version.txt" && echo 0 || echo 1)" "cc-base-version.txt 两次逐字节相同" "相同" "$(cmp -s "$W/v1" "$T5/.cursor/cc-base-version.txt" && echo 相同 || echo 不同)"
fi

echo "--- 本仓只读"
STATUS1=$(git -C "$ROOT" status --short | LC_ALL=C sort | cksum)
chk "$([ "$STATUS0" = "$STATUS1" ] && echo 0 || echo 1)" "测试跑完后本仓 git status --short 与开场相同" "两次 cksum 相同" "$STATUS0 / $STATUS1"

echo "===== test-adapter：PASS=$PASS FAIL=$FAIL SKIP=$SKIP ====="
[ "$SKIP" -gt 0 ] && echo "注意：有 $SKIP 项 SKIP，未执行 != 通过。" >&2
[ "$FAIL" -eq 0 ]
