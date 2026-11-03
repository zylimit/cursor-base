#!/usr/bin/env bash
# risk: low
# test-hooks-node.sh — 提醒类 hook 的存活回归：每个 .claude/hooks/<name>.mjs 各一条
#   「触发 → 期望输出 / 退出码」，喂 stdin 夹具，断言 stdout / stderr / 退出码 / 状态文件。
#
# 分级取舍（2026-09-10 测试预算表）：地板闸（secret-exfil-guard / dangerous-pkill-guard）
#   的用例全份搬去 test-hooks-floor.sh，一条不减；留在这里的都是提醒类——判错的代价是
#   少一句提醒，不是密钥外传，所以每个 hook 只保一条主路径，损坏输入 / 三档矩阵 /
#   lib 契约那些穷举不再养。three-file-sync-gate 三档都是 advise，围绕「拦停」写的那批断言
#   随之作废，改判「出提醒且没拦」；tdd-gate 只有 strict 才 block，那一档单留一条。
#
# 契约来源：docs/v3-phase-d-inventory.md A 段契约卡（stdin 字段 / 状态文件 / 输出形态 / 退出码）。
#
# 跨平台：只用 bash + node + git + coreutils。可变样例一律落 mktemp 沙箱，trap 清理；对本仓只读。
#   每条断言打印 EXPECT / GOT，判定不依赖措辞；组号沿用契约卡（EX / LB / AP / …）。
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HOOKS="$ROOT/.claude/hooks"
LIBDIR="$HOOKS/lib"
PROFILE="$ROOT/.claude/harness/profile.json"

echo "===== test-hooks-node ====="

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node——hook 全是 .mjs，跑不起来；未执行 != 通过。" >&2
    exit 1
fi
if ! command -v git >/dev/null 2>&1; then
    echo "SKIPPED: 无 git——沙箱仓造不出来；未执行 != 通过。" >&2
    exit 1
fi

TMP=$(mktemp -d)
trap 'chmod -R u+rwX "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

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

RC=0
OUT=""
ERRT=""

# run_script <脚本> <工作目录> <stdin 文本> [argv…] —— 回填 RC / OUT(stdout) / ERRT(stderr)。
# stdout 与 stderr 分开收：「纯 stderr」与「stdout JSON」是两种形态，混在一起就分不清。
run_script() {
    local script="$1" d="$2" input="$3"
    shift 3
    RC=0
    printf '%s' "$input" | ( cd "$d" && CLAUDE_PROJECT_DIR="$d" node "$script" "$@" ) \
        >"$TMP/.o" 2>"$TMP/.e" || RC=$?
    OUT=$(cat "$TMP/.o" 2>/dev/null || true)
    ERRT=$(cat "$TMP/.e" 2>/dev/null || true)
}

run_hook() { local n="$1"; shift; run_script "$HOOKS/$n.mjs" "$@"; }

# newsb <名> [git] [progress] —— 造沙箱项目，回显路径。
#   档位表随沙箱一起装：profile.json 在不在 = 档位启不启用；必须赶在 git 提交之前，
#   未跟踪的 .claude/harness/** 命中 raise.paths 会把沙箱悄悄抬成 strict。
newsb() {
    local d="$TMP/$1"
    shift
    mkdir -p "$d/.claude/harness" "$d/src"
    cp "$PROFILE" "$d/.claude/harness/profile.json" 2>/dev/null || true
    local a
    for a in "$@"; do
        case "$a" in
            progress) printf '# progress\n' > "$d/progress.md" ;;
            git)
                ( cd "$d" && git init -q . \
                    && git config core.autocrlf false \
                    && git config user.email t@example.com && git config user.name t \
                    && printf 'echo hi\n' > src/app.sh && git add -A && git commit -qm init ) >/dev/null 2>&1
                ;;
        esac
    done
    printf '%s' "$d"
}

# newrepo_remote <名> —— 带 bare 远端的沙箱仓（auto-push 要真推一次才算数）。
newrepo_remote() {
    local d="$TMP/$1" r="$TMP/$1-remote.git"
    mkdir -p "$d/.claude"
    git init -q --bare "$r" >/dev/null 2>&1
    ( cd "$d" && git init -q . && git config core.autocrlf false \
        && git config user.email t@example.com && git config user.name t \
        && printf 'x\n' > a.txt && git add -A && git commit -qm init \
        && git remote add origin "$r" && git push -q -u origin HEAD ) >/dev/null 2>&1
    printf '%s' "$d"
}
ahead_by_one() { ( cd "$1" && printf 'y\n' >> a.txt && git commit -aqm second ) >/dev/null 2>&1; }
synced() {
    local d="$1" br lh rh
    br=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || echo x)
    lh=$(git -C "$d" rev-parse HEAD 2>/dev/null || echo L)
    rh=$(git -C "$TMP/$(basename "$d")-remote.git" rev-parse "refs/heads/$br" 2>/dev/null || echo R)
    [ "$lh" = "$rh" ]
}

# 判定小工具
blocked()  { printf '%s' "$1" | grep -q '"decision":"block"'; }
hasq()     { printf '%s' "$2" | grep -qF "$1"; }
mentions() { printf '%s' "$2" | grep -qE "(^|[^0-9])$1([^0-9]|\$)"; }
# SessionStart 注入契约：stdout 恰好一行嵌套 JSON，取 additionalContext 文本（不满足输出 <bad-shape>）
ctxof()    { [ "$(printf '%s\n' "$1" | wc -l)" -eq 1 ] && jq_ "$1" 'String(d.hookSpecificOutput.hookEventName) === "SessionStart" ? d.hookSpecificOutput.additionalContext : "<bad-event>"' || printf '<bad-shape>'; }
silent()   { [ -z "$OUT" ] && [ -z "$ERRT" ]; }
show()     { printf '%s' "${1:-空}" | tr '\n' '~' | cut -c1-260; }

# advise 档：Stop 类闸改出 systemMessage 提醒，不再出 decision:block。判「有提醒且没拦」，
# 别只判「不是 block」——什么都不输出也不是 block，那是闸没跑。
advised() {
    case "$1" in *'"systemMessage"'*) ;; *) return 1 ;; esac
    case "$1" in *'"decision":"block"'*|*'"decision": "block"'*) return 1 ;; esac
    return 0
}

# jq_ <json 文本> <js 表达式（用变量 d）> —— 用 node 取字段（故意不依赖 jq）。
jq_() {
    printf '%s' "$1" | node -e '
let s = "";
process.stdin.on("data", (c) => { s += c; });
process.stdin.on("end", () => {
  try { const d = JSON.parse(s); process.stdout.write(String(eval(process.argv[1]))); }
  catch (e) { process.stdout.write("<not-json>"); }
});
' "$2"
}

# age_file <文件> <秒> —— 把 mtime 往前拨，造「过期标记」。用 node 而不是 touch -d '3 hours ago'：
# 相对时间那种写法是 GNU touch 专有的，BSD（macOS）的 -d 只认 ISO8601，在那边会静默拨不动 →
# 用例变成假绿（跑的是「新鲜标记」那条路径，却挂着「过期」的标题）。
age_file() {
    node -e '
const fs = require("node:fs");
const t = (Date.now() - Number(process.argv[2]) * 1000) / 1000;
fs.utimesSync(process.argv[1], t, t);
' "$1" "$2"
}

# set_tier <沙箱> <fast|standard|strict> —— 改沙箱 profile 的默认档（真仓根的档位一概不碰）。
set_tier() {
    node -e '
const fs = require("node:fs");
const f = process.argv[1];
const p = JSON.parse(fs.readFileSync(f, "utf8"));
p.default = process.argv[2];
fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
' "$1/.claude/harness/profile.json" "$2"
}

# ---------------------------------------------------------------------------
echo ""
echo "--- EX / LB 存在性（这两条红 = 装漏了；下面所有红的根因都是它）---"

MISS=""
for h in auto-push check-evolution dangerous-pkill-guard detect-feedback-signal \
         harness-async-verify kill-dev-ports mark-review-needed no-direct-code-guard notify \
         postcompact-reinject pre-commit-check precompact-gate recap-on-dirty record-authorship \
         release-gate secret-exfil-guard session-rules-banner static-check stop-gate \
         subagent-acceptance-reminder tdd-gate three-file-sync-gate; do
    [ -f "$HOOKS/$h.mjs" ] || MISS="$MISS $h"
done
chk "$([ -z "$MISS" ] && echo 0 || echo 1)" \
    "EX-1 22 个 hook 的 .mjs 全部就位" "0 个缺失" "缺失：${MISS:- 无}"

LBMISS=""
for m in io gatelog tier harness; do
    [ -f "$LIBDIR/$m.mjs" ] || LBMISS="$LBMISS $m"
done
chk "$([ -z "$LBMISS" ] && echo 0 || echo 1)" \
    "LB-1 hooks/lib 四件齐（缺一件就是每次事件报 hook error）" "0 个缺失" "缺失：${LBMISS:- 无}"

# ---------------------------------------------------------------------------
echo ""
echo "--- 各 hook 一条主路径 ---"

SB=$(newrepo_remote ap-commit); ahead_by_one "$SB"
run_hook auto-push "$SB" '{"tool_input":{"command":"git commit -m t"}}'
chk "$([ "$RC" -eq 0 ] && synced "$SB" && echo 0 || echo 1)" \
    "AP git commit 且本地领先上游 → 真的 push 上去（远端 ref 追平本地 HEAD）" \
    "rc=0 且远端 = 本地 HEAD" \
    "rc=$RC 已同步=$(synced "$SB" && echo Y || echo N) err=[$(show "$ERRT")]"

SB=$(newsb ce-two)
mkdir -p "$SB/.claude/feedback"
cat > "$SB/.claude/feedback/FEEDBACK-INDEX.md" <<'IDX'
# Feedback Index

- [甲](a.md) — 描述
- [乙](b.md) — 描述
- ✅[已毕业] [丙](c.md) — 描述
IDX
run_hook check-evolution "$SB" ''
CTX=$(ctxof "$OUT")
chk "$([ "$RC" -eq 0 ] && mentions 2 "$CTX" && mentions 3 "$CTX" && echo 0 || echo 1)" \
    "CE 2 条待处理 + 1 条已毕业 → stdout 单行 JSON，additionalContext 报「2 条待处理（共 3 条）」" \
    "additionalContext 同时出现 2 与 3" "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb ce-skip)
mkdir -p "$SB/.claude/feedback"
cat > "$SB/.claude/feedback/FEEDBACK-INDEX.md" <<'IDX'
# Feedback Index

- [甲](a.md) — 描述
- ✅[已毕业] [丙](c.md) — 描述
- ⏭[已跳过] [丁](d.md) — 描述
- ⏭[已跳过] [戊](e.md) — 描述
IDX
run_hook check-evolution "$SB" ''
CTX=$(ctxof "$OUT")
chk "$([ "$RC" -eq 0 ] && mentions 1 "$CTX" && mentions 4 "$CTX" && echo 0 || echo 1)" \
    "CE-2 ⏭[已跳过] 行不计入待处理但计入总数 → 1 条待处理 + 1 已毕业 + 2 已跳过报「1 条待处理（共 4 条）」" \
    "additionalContext 同时出现 1 与 4" "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb df-hit)
run_hook detect-feedback-signal "$SB" '{"prompt":"你搞错了，不是这样"}'
chk "$([ "$RC" -eq 0 ] && [ "$(jq_ "$OUT" 'typeof d.additionalContext')" = "string" ] && echo 0 || echo 1)" \
    "DF 命中修正信号 → 顶层 {\"additionalContext\":…}（不是 hookSpecificOutput）" \
    "顶层 additionalContext 是字符串" "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb av-off)
run_hook harness-async-verify "$SB" '{"tool_input":{"file_path":"src/a.ts"}}'
chk "$([ "$RC" -eq 0 ] && silent && echo 0 || echo 1)" \
    "AV 无 catalog（大仓治理默认关）→ rc 0、零输出、零行为变化" \
    "rc=0 无输出" "rc=$RC out=[$(show "$OUT")] err=[$(show "$ERRT")]"

# 引擎包未装的提醒一个 session 只说一次：两次之间删掉防抖标记，确保第二次真的走到提醒那一支
# （不删的话 180 秒防抖先返回，用例就成了测防抖的假绿）；换一个 session_id 必须再说一次作对照。
SB=$(newsb av-once)
printf '{"version":1,"modules":[]}\n' > "$SB/.claude/harness/module-catalog.json"
avlog() { grep -c 'harness-async-verify' "$SB/.claude/evidence/gate-block.log" 2>/dev/null || true; }
run_hook harness-async-verify "$SB" '{"session_id":"s-1","tool_input":{"file_path":"src/a.ts"}}'; AVE1="$ERRT"; AVN1=$(avlog)
rm -f "$SB/.claude/.async-verify-last"
run_hook harness-async-verify "$SB" '{"session_id":"s-1","tool_input":{"file_path":"src/a.ts"}}'; AVE2="$ERRT"; AVN2=$(avlog)
rm -f "$SB/.claude/.async-verify-last"
run_hook harness-async-verify "$SB" '{"session_id":"s-2","tool_input":{"file_path":"src/a.ts"}}'; AVN3=$(avlog)
chk "$([ "$RC" -eq 0 ] && hasq '引擎包未装' "$AVE1" && [ -z "$AVE2" ] && [ "$AVN1" = 1 ] && [ "$AVN2" = 1 ] && [ "$AVN3" = 2 ] && echo 0 || echo 1)" \
    "AV-2 catalog 在、引擎包未装 → 同一 session 第二次 Edit 不再出声、不再写账本；换 session 再说一次" \
    "第一次 stderr 含「引擎包未装」、账本 1 条；同 session 第二次 stderr 空、账本仍 1 条；新 session 账本 2 条" \
    "rc=$RC 账本=$AVN1/$AVN2/$AVN3 err1=[$(show "$AVE1")] err2=[$(show "$AVE2")]"

SB=$(newsb kd-plain)
run_hook kill-dev-ports "$SB" '{"tool_input":{"command":"ls"}}'
chk "$([ "$RC" -eq 0 ] && silent && echo 0 || echo 1)" \
    "KD 非 dev server 命令 → rc 0 零输出（脚本内自判，不进清端口分支）" \
    "rc=0 无输出" "rc=$RC out=[$(show "$OUT")] err=[$(show "$ERRT")]"

SB=$(newsb mr-src)
run_hook mark-review-needed "$SB" '{"tool_input":{"file_path":"src/app.ts"}}'
# shellcheck disable=SC2002  # 非「无用 cat」：cat ... 2>/dev/null 是有意吞掉「文件不存在」的错误，改成 tr < file 2>/dev/null 救不回来（实测：重定向本身失败时结尾 2>/dev/null 补不上，rc 从 0 变 1 且错误仍会打印），保留 cat 形态
chk "$([ "$RC" -eq 0 ] && grep -qxF 'src/app.ts' "$SB/.claude/.needs-review" 2>/dev/null && echo 0 || echo 1)" \
    "MR 编辑业务源码 → rc 0 且 .needs-review 登记 src/app.ts" \
    "清单含 src/app.ts" "rc=$RC 清单=[$(cat "$SB/.claude/.needs-review" 2>/dev/null | tr '\n' ',')] err=[$(show "$ERRT")]"

SB=$(newsb nd-src)
run_hook no-direct-code-guard "$SB" '{"tool_input":{"file_path":"src/app.ts"}}'
chk "$([ "$RC" -eq 2 ] && [ -n "$ERRT" ] && [ -z "$OUT" ] && echo 0 || echo 1)" \
    "ND 主 Agent 直接写 src/ 业务源码 → exit 2 拦截，警告走 stderr" \
    "rc=2 且 stderr 非空、stdout 空" "rc=$RC out=[$(show "$OUT")] err=[$(show "$ERRT")]"

SB=$(newsb nd-sub)
run_hook no-direct-code-guard "$SB" \
    '{"agent_id":"a1","agent_type":"implementer","tool_name":"Write","tool_input":{"file_path":"src/app.ts"}}'
chk "$([ "$RC" -eq 0 ] && silent && echo 0 || echo 1)" \
    "ND 同一份写入带 agent_id（事件来自子 Agent 内）→ rc 0 零输出（闸守的是主 Agent 不亲自编码，写 src/ 正是 implementer 的活）" \
    "rc=0 无输出" "rc=$RC out=[$(show "$OUT")] err=[$(show "$ERRT")]"

SB=$(newsb nt-basic)
run_hook notify "$SB" '{"message":"NOTIFY-PROBE done"}'
chk "$([ "$RC" -eq 0 ] && [ "$(jq_ "$OUT" 'typeof d.terminalSequence')" = "string" ] \
      && hasq 'NOTIFY-PROBE' "$OUT" && echo 0 || echo 1)" \
    "NT 正常消息 → rc 0 且 stdout 是含 terminalSequence 的合法 JSON，消息正文进转义序列" \
    "terminalSequence 是字符串且含 NOTIFY-PROBE" "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb pr-noharness)
# 大仓包在、入口没了：这才是 no-harness 那条降级。ext 目录不拷进来的话走的是下面那条自派生路径。
cp -R "$ROOT/.claude/harness/ext" "$SB/.claude/harness/ext" 2>/dev/null || mkdir -p "$SB/.claude/harness/ext"
run_hook postcompact-reinject "$SB" '{"compact_trigger":"auto"}'
chk "$([ "$RC" -eq 0 ] && [ "$(jq_ "$OUT" 'typeof d.systemMessage')" = "string" ] \
      && [ "$(jq_ "$OUT" 'd.additionalContext === undefined')" = "true" ] && echo 0 || echo 1)" \
    "PR 引擎文件缺失 → 只给 systemMessage 降级说明、不给 additionalContext（别让人以为不变量已回来）" \
    "systemMessage 是字符串且无 additionalContext" "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb pr-noext)
printf '# progress\n\n## Pinned（必守）\n- PIN-PROBE 这条压缩后必须还看得见\n\n## Done\n- 别的段不该被读进来\n' > "$SB/progress.md"
run_hook postcompact-reinject "$SB" '{"compact_trigger":"auto"}'
chk "$([ "$RC" -eq 0 ] && hasq 'PIN-PROBE 这条压缩后必须还看得见' "$(jq_ "$OUT" 'String(d.additionalContext)')" \
      && hasq 'without the engine' "$(jq_ "$OUT" 'String(d.systemMessage)')" && echo 0 || echo 1)" \
    "PR 大仓包（harness/ext）未装 → hook 自己从 progress.md 派生最小回注，不谎报「引擎失败」（地板闸，装不装都得回注）" \
    "additionalContext 含那条 Pinned 且 systemMessage 含 without the engine" "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb pr-superseded)
printf '# progress\n\n## Pinned（必守）\n- PIN-LIVE 这条还算数\n- PIN-DEAD 旧口径 → 被 2026-09-15 的新口径取代\n' > "$SB/progress.md"
run_hook postcompact-reinject "$SB" '{"compact_trigger":"auto"}'
PRAC=$(jq_ "$OUT" 'String(d.additionalContext)')
chk "$([ "$RC" -eq 0 ] && hasq 'PIN-LIVE' "$PRAC" && ! hasq 'PIN-DEAD' "$PRAC" && echo 0 || echo 1)" \
    "PR 标了「→ 被 … 取代」的 Pinned 条目不回注、同段另一条照回注（把作废口径当铁律注回去比不注更坏：那半句「被取代」在摘要里早没了）" \
    "additionalContext 含 PIN-LIVE、不含 PIN-DEAD" "rc=$RC 回注=[$(show "$PRAC")]"

SB=$(newsb pc-nocommit git)
run_hook pre-commit-check "$SB" '{"tool_input":{"command":"ls -la"}}'
chk "$([ "$RC" -eq 0 ] && silent && echo 0 || echo 1)" \
    "PC 非 git commit 命令 → rc 0 零输出" "rc=0 无输出" "rc=$RC err=[$(show "$ERRT")]"

SB=$(newsb pg-pending)
printf 'src/app.ts\nsrc/lib.ts\n' > "$SB/.claude/.needs-review"
run_hook precompact-gate "$SB" '{"trigger":"auto"}'
chk "$([ "$RC" -eq 0 ] && blocked "$OUT" && echo 0 || echo 1)" \
    "PG 待审清单未清 → decision:block 拦一次压缩，rc 仍 0" \
    'rc=0 且 stdout 含 "decision":"block"' "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb rd-dirty git)
printf 'x\n' > "$SB/uncommitted.ts"
run_hook recap-on-dirty "$SB" '{"source":"startup"}'
chk "$([ "$RC" -eq 0 ] && [ "$(jq_ "$OUT" 'String((d.hookSpecificOutput||{}).hookEventName)')" = "SessionStart" ] \
      && [ "$(jq_ "$OUT" 'typeof (d.hookSpecificOutput||{}).additionalContext')" = "string" ] && echo 0 || echo 1)" \
    "RD 工作树脏 → hookSpecificOutput.hookEventName = SessionStart 且 additionalContext 是字符串" \
    "hookEventName=SessionStart 且提醒正文非空" "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb ra-off)
run_hook record-authorship "$SB" '{"tool_input":{"file_path":"src/a.ts"},"agent_type":"implementer"}'
chk "$([ "$RC" -eq 0 ] && silent && [ ! -e "$SB/.claude/harness/state" ] && echo 0 || echo 1)" \
    "RA 无 catalog（大仓治理默认关）→ rc 0、零输出、不调引擎" \
    "rc=0、无输出、无 harness/state" \
    "rc=$RC out=[$(show "$OUT")] state=$([ -e "$SB/.claude/harness/state" ] && echo 有 || echo 无)"

SB=$(newsb rg-clean)
run_hook release-gate "$SB" '{"command_name":"release-builder"}'
chk "$([ "$RC" -eq 0 ] && [ "$(jq_ "$OUT" 'String((d.hookSpecificOutput||{}).hookEventName)')" = "UserPromptExpansion" ] \
      && hasq additionalContext "$OUT" && ! blocked "$OUT" && echo 0 || echo 1)" \
    "RG 待审清单干净 → 放行并注入卡点提醒（hookEventName=UserPromptExpansion，不许 block）" \
    "hookEventName=UserPromptExpansion 且无 decision:block" "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb sb-normal)
run_hook session-rules-banner "$SB" '{"source":"startup"}'
CTX=$(ctxof "$OUT")
chk "$([ "$RC" -eq 0 ] && hasq '铁律' "$CTX" && hasq '6.' "$CTX" && echo 0 || echo 1)" \
    "SB 正常启动 → stdout 单行 JSON，additionalContext 含六条核心铁律横幅" "additionalContext 含「铁律」与第 6 条" "rc=$RC out=[$(show "$OUT")]"

# sticky fast（tier set fast --sticky 的写侧形状）：没有过期时间，横幅照实说「到撤销为止」，不许算出 NaN / 剩 0 h
SB=$(newsb sb-sticky); mkdir -p "$SB/.claude/.runtime"
printf '{"tier":"fast","reason":"脚手架冲刺","by":"t","set_epoch":%s,"expires_epoch":null,"sticky":true}\n' "$(date +%s)" \
    > "$SB/.claude/.runtime/tier.json"
run_hook session-rules-banner "$SB" '{"source":"startup"}'
CTX=$(ctxof "$OUT")
chk "$([ "$RC" -eq 0 ] && hasq 'tier: fast' "$CTX" && hasq '撤销' "$CTX" && ! hasq 'NaN' "$CTX" && ! hasq '剩 0 h' "$CTX" && echo 0 || echo 1)" \
    "SB-2 sticky fast → 横幅报 fast 且说「到撤销为止」，不含 NaN、不报剩 0 h" \
    "stdout 含「tier: fast」与「撤销」，无 NaN / 剩 0 h" "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb sc-good)
mkdir -p "$SB/work"; printf 'export const a = 1;\n' > "$SB/work/ok.mjs"
run_script "$HOOKS/static-check.mjs" "$SB" '' "$SB/work"
chk "$([ "$RC" -eq 0 ] && hasq 'node --check' "$OUT" && echo 0 || echo 1)" \
    "SC 语法正确的 .mjs → rc 0 且报告里点出跑了 node --check（没跑却报绿是假绿）" \
    "rc=0 且 stdout 含 node --check" "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb sg-pending)
printf 'src/app.ts\nsrc/lib.ts\n' > "$SB/.claude/.needs-review"
run_hook stop-gate "$SB" ''
chk "$([ "$RC" -eq 0 ] && advised "$OUT" && hasq 'src/app.ts' "$OUT" && echo 0 || echo 1)" \
    "SG-1 待审 2 个文件 → standard 档出 systemMessage 提醒、不拦，且点名待审文件（不点名的提醒没法处理）" \
    'rc=0 且含 systemMessage 与 src/app.ts、不含 "decision":"block"' "rc=$RC out=[$(show "$OUT")]"

SB=$(newsb sg-strict); set_tier "$SB" strict
printf 'src/app.ts\nsrc/lib.ts\n' > "$SB/.claude/.needs-review"
run_hook stop-gate "$SB" ''
chk "$([ "$RC" -eq 0 ] && blocked "$OUT" && hasq 'src/app.ts' "$OUT" && echo 0 || echo 1)" \
    "SG-2 同一份待审清单在 strict 档 → decision:block 真拦（那一档人是审批者）" \
    'rc=0 且含 "decision":"block" 与 src/app.ts' "rc=$RC out=[$(show "$OUT")]"

# stop-gate advise 档去重：同一份待审清单不重复提醒（2026-10 下游一天 95 次、同清单重复 91 次）
SB=$(newsb sg-dedup)
printf 'src/app.ts\nsrc/lib.ts\n' > "$SB/.claude/.needs-review"
run_hook stop-gate "$SB" ''; run_hook stop-gate "$SB" ''
chk "$([ "$RC" -eq 0 ] && silent && echo 0 || echo 1)" \
    "SG-4 advise 档同一清单连续第二次 Stop → 静默放行（不出 systemMessage）" "rc=0 且零输出" "rc=$RC out=[$(show "$OUT")]"
printf 'src/app.ts\nsrc/lib.ts\nsrc/new.ts\n' > "$SB/.claude/.needs-review"
run_hook stop-gate "$SB" ''
chk "$([ "$RC" -eq 0 ] && advised "$OUT" && hasq 'src/new.ts' "$OUT" && echo 0 || echo 1)" \
    "SG-5 清单变了 → 再提醒一次" "含 systemMessage 与 src/new.ts" "rc=$RC out=[$(show "$OUT")]"
echo clean > "$SB/.claude/.needs-review"; run_hook stop-gate "$SB" ''
printf 'src/app.ts\nsrc/lib.ts\nsrc/new.ts\n' > "$SB/.claude/.needs-review"
run_hook stop-gate "$SB" ''
chk "$([ "$RC" -eq 0 ] && advised "$OUT" && echo 0 || echo 1)" \
    "SG-6 清空后同一清单重现 → 再提醒" "含 systemMessage" "rc=$RC out=[$(show "$OUT")]"
sed -i 's/^ts=.*/ts=1000/' "$SB/.claude/.stop-gate-advised"
run_hook stop-gate "$SB" ''
chk "$([ "$RC" -eq 0 ] && advised "$OUT" && echo 0 || echo 1)" \
    "SG-6b 上次提醒超 60 分钟（状态文件时间戳改旧）同一清单 → 再提醒" "含 systemMessage" "rc=$RC out=[$(show "$OUT")]"
SB=$(newsb sg-dedup-strict); set_tier "$SB" strict
printf 'src/app.ts\n' > "$SB/.claude/.needs-review"
echo 'sig=x' > "$SB/.claude/.stop-gate-advised"
run_hook stop-gate "$SB" ''; O1="$OUT"; run_hook stop-gate "$SB" ''
chk "$(blocked "$O1" && blocked "$OUT" && [ "$(cat "$SB/.claude/.stop-gate-advised")" = "sig=x" ] && echo 0 || echo 1)" \
    "SG-7 strict 档同一清单连续两次 → 两次都 decision:block，且不写、不删预置的去重状态" "两次 block、去重状态文件原样" "o1=[$(show "$O1")] o2=[$(show "$OUT")]"
SB=$(newsb sg-dedup-undeletable)
mkdir -p "$SB/.claude/.stop-gate-advised/sub"; : > "$SB/.claude/.stop-gate-advised/sub/f"
run_hook stop-gate "$SB" ''
chk "$([ "$RC" -eq 0 ] && ! blocked "$OUT" && echo 0 || echo 1)" \
    "SG-8 去重状态路径删不掉（是非空目录）、无 .needs-review → 不拦停（删不掉最多少提醒一次）" "rc=0 且无 decision:block" "rc=$RC out=[$(show "$OUT")]"
SB=$(newsb sg-dedup-noext git)
printf '{"version":1,"modules":[]}\n' > "$SB/.claude/harness/module-catalog.json"
( cd "$SB" && git add -A && git commit -qm catalog ) >/dev/null 2>&1
printf 'src/app.ts\n' > "$SB/.claude/.needs-review"; run_hook stop-gate "$SB" ''
echo clean > "$SB/.claude/.needs-review"; run_hook stop-gate "$SB" ''
printf 'src/app.ts\n' > "$SB/.claude/.needs-review"; run_hook stop-gate "$SB" ''
chk "$([ "$RC" -eq 0 ] && advised "$OUT" && hasq 'src/app.ts' "$OUT" && echo 0 || echo 1)" \
    "SG-9 引擎包未装的出口清空清单 → 同一清单重现仍再提醒（不被去重状态吞掉）" "第三步含 systemMessage 与 src/app.ts" "rc=$RC out=[$(show "$OUT")]"

# 大仓包未装那格假绿（2026-09-15 拆包新开的）：catalog 是开关、ext 是引擎，只放开关时三道闸
#   的子命令只会 rc 3 降级。闸不拦是对的，零输出不是——「闸没跑成」和「验过了没问题」必须长得不一样。
#   catalog 造完先提交：未跟踪的 .claude/harness/** 命中 raise.paths 会把沙箱悄悄抬成 strict。
SB=$(newsb hx-noext git)
printf '{"version":1,"modules":[]}\n' > "$SB/.claude/harness/module-catalog.json"
( cd "$SB" && git add -A && git commit -qm catalog ) >/dev/null 2>&1
echo clean > "$SB/.claude/.needs-review"
run_hook stop-gate "$SB" ''
chk "$([ "$RC" -eq 0 ] && advised "$OUT" && hasq '引擎包未装' "$OUT" && echo 0 || echo 1)" \
    "SG-3 catalog 在、引擎包（harness/ext）未装 → stop-gate 出 systemMessage 点明本次未验、不拦（回执闸压根没跑，静默放行就是假绿）" \
    'rc=0 且含 systemMessage 与「引擎包未装」、不含 "decision":"block"' "rc=$RC out=[$(show "$OUT")]"

( cd "$SB" && printf 'export const a = 1;\n' > src/ok.mjs && git add src/ok.mjs ) >/dev/null 2>&1
run_hook pre-commit-check "$SB" '{"tool_input":{"command":"git commit -m x"}}'
chk "$([ "$RC" -eq 0 ] && hasq '引擎包未装' "$ERRT" && echo 0 || echo 1)" \
    "PC-2 同一棵树 commit → pre-commit-check 同一句诊断进 stderr，退出码照旧不拦（四态门一条没跑过，不许零输出）" \
    "rc=0 且 stderr 含「引擎包未装」" "rc=$RC err=[$(show "$ERRT")]"

SB=$(newsb sa-basic)
run_hook subagent-acceptance-reminder "$SB" '{"agent_type":"implementer","agent_id":"a-1"}'
chk "$([ "$RC" -eq 0 ] && [ "$(jq_ "$OUT" 'String((d.hookSpecificOutput||{}).hookEventName)')" = "SubagentStop" ] \
      && hasq implementer "$(jq_ "$OUT" 'String((d.hookSpecificOutput||{}).additionalContext)')" && echo 0 || echo 1)" \
    "SA implementer 返回 → hookSpecificOutput.hookEventName = SubagentStop 且提醒正文点名角色" \
    "hookEventName=SubagentStop 且 additionalContext 含 implementer" "rc=$RC out=[$(show "$OUT")]"

# 下面几条按新契约写，不按现有实现写：SubagentStop 的 additionalContext 实测落在刚停下的那个
#   子 Agent 自己身上，主 Agent 这侧收不到，所以这句提醒是第二人称写给它的收工取证要求，
#   不是写给主 Agent 的验收指令。领域那一句只在回执**真有** Domain findings 且正文非空
#   （不以 None / N/A / 无 起头）时才追加：口径库是沟通过程的副产品，没这一栏是无从判断、
#   不是漏填，催出来的是凑数，凑的没依据，进库即噪音。
#   三个标记**同时**判，不判其一：「领域发现」跨两版措辞都成立（换措辞那轮负向断言只盯新标记，
#   旧措辞的追加句照样漏出来而新标记天生不命中，四条当场全假绿），「证据是哪一类」「只报不判」
#   钉的是那句话带的两件事——只判一个的话，实现少写半句照样绿。
#   ① 两臂：第二臂正文以「无」起头但是真发现，纯前缀判法会把它吞成「没有」，这条就是那道防线。
DOMARM=0
while IFS='|' read -r DVAL DDESC <&3; do
    [ -n "${DVAL:-}" ] || continue
    DOMARM=$((DOMARM + 1))
    SB=$(newsb "sa-domain$DOMARM")
    run_hook subagent-acceptance-reminder "$SB" \
        "{\"agent_type\":\"tester\",\"agent_id\":\"a-2-$DOMARM\",\"last_assistant_message\":\"Status: PASS\\nChanged: None\\nDomain findings: $DVAL\\nEvidence: runner 输出\"}"
    SAAC=$(jq_ "$OUT" 'String((d.hookSpecificOutput||{}).additionalContext)')
    SADOM=$(hasq '领域发现' "$SAAC" && echo 有 || echo 无)
    SACLS=$(hasq '证据是哪一类' "$SAAC" && echo 有 || echo 无)
    SANOJ=$(hasq '只报不判' "$SAAC" && echo 有 || echo 无)
    chk "$([ "$RC" -eq 0 ] && [ "$(jq_ "$OUT" 'String((d.hookSpecificOutput||{}).hookEventName)')" = "SubagentStop" ] \
          && hasq tester "$SAAC" && hasq '客观证据' "$SAAC" \
          && [ "$SADOM" = 有 ] && [ "$SACLS" = 有 ] && [ "$SANOJ" = 有 ] && echo 0 || echo 1)" \
        "SA 回执 $DDESC → 追加一句第二人称的取证要求（写清证据是哪一类 / 定论归主 Agent，两个标记都要出现）" \
        "rc=0、hookEventName=SubagentStop、additionalContext 点名角色且含收工取证正文，并同时出现「领域发现」「证据是哪一类」「只报不判」" \
        "rc=$RC 写法=[$DVAL] 追加领域句=$SADOM 证据分类=$SACLS 只报不判=$SANOJ 追加段=[$(show "${SAAC#*Not verified。}")]"
done 3<<'ARMS'
pon_links.olt_ip 实测全表 0 条命中 OLT 名|真有领域发现（普通写法）
无线接入侧 VLAN 按 OLT 槽位算|真有领域发现、但正文以「无」起头（纯前缀判法会吞掉它，这条是那道防线）
ARMS

# ② 一族四个写法，一把尺子：判据是「正文以 None / N/A / 无 **起头**就算没有」，不是整串相等——
#   子 Agent 写回执时自然会在 None 后面补一句为什么没有（上一轮实现者与我 2/2 都这么写），
#   整串相等那种判法会把「明说没有还解释了」翻面判成真有发现，正好催出它要防的凑数口径。
#   六臂都断言不追加、不催补报；表走 fd 3，免得循环体里读 stdin 的命令把它吃掉。
#   各臂独立沙箱 + 各自 agent_id：hook 带去重表 .claude/.subagent-reminded，同 id 第二次直接静默。
#   「追加领域句」这一项判的是**跨两版措辞都成立**的词「领域发现」：只判新标记会假绿——旧措辞
#   的追加句照样漏出来，而新标记天生不命中，负向断言就看不见泄漏（实测吃过一次假绿）。
NONEARM=0
while IFS='|' read -r NLBL NVAL NDESC <&3; do
    [ -n "${NLBL:-}" ] || continue
    NONEARM=$((NONEARM + 1))
    SB=$(newsb "sa-domain-none$NONEARM")
    run_hook subagent-acceptance-reminder "$SB" \
        "{\"agent_type\":\"code-reviewer\",\"agent_id\":\"a-3-$NONEARM\",\"last_assistant_message\":\"Status: DONE\\nChanged: None\\n$NLBL: $NVAL\\nEvidence: 审查记录\"}"
    SAAC=$(jq_ "$OUT" 'String((d.hookSpecificOutput||{}).additionalContext)')
    SACLS=$(hasq '证据是哪一类' "$SAAC" && echo 有 || echo 无)
    SANOJ=$(hasq '只报不判' "$SAAC" && echo 有 || echo 无)
    SANAG=$({ hasq '漏报' "$SAAC" || hasq '补问' "$SAAC"; } && echo 有 || echo 无)
    SADOM=$(hasq '领域发现' "$SAAC" && echo 有 || echo 无)
    chk "$([ "$RC" -eq 0 ] && [ "$(jq_ "$OUT" 'String((d.hookSpecificOutput||{}).hookEventName)')" = "SubagentStop" ] \
          && hasq code-reviewer "$SAAC" && hasq '客观证据' "$SAAC" \
          && [ "$SADOM" = 无 ] && [ "$SACLS" = 无 ] && [ "$SANOJ" = 无 ] && [ "$SANAG" = 无 ] && echo 0 || echo 1)" \
        "SA 回执 $NDESC → 只有收工取证正文，不追加那句取证要求也不催补报（判据是以 None / N/A / 无 起头即算没有，后面的括注不翻面，不是整串相等）" \
        "rc=0、hookEventName=SubagentStop、additionalContext 点名角色且含收工取证正文，不出现「领域发现」（跨两版措辞的追加句标记），「证据是哪一类」「只报不判」与催补报的话也都不出现" \
        "rc=$RC 写法=[$NLBL: $NVAL] 追加领域句=$SADOM 证据分类=$SACLS 只报不判=$SANOJ 催补话=$SANAG 泄漏句=[$([ "$SADOM" = 有 ] && show "领域发现${SAAC##*领域发现}" || echo 空)]"
done 3<<'ARMS'
Domain findings|None|裸 None（最朴素的写法）
**Domain findings**|None（本轮全是框架自身测试基建，无业务领域口径）|栏名加粗 + None 后跟中文括注（子 Agent 的自然写法）
Domain findings|None (framework-internal only)|None 后跟英文括注
Domain findings|无（本轮无领域口径）|中文「无」+ 中文括注
Domain findings|无|裸「无」（现实现本来判对，\b 那种方案会让它退化，得有人守着）
Domain findings|N/A（本轮不适用）|N/A + 中文括注
ARMS

SB=$(newsb sa-nodomain)
run_hook subagent-acceptance-reminder "$SB" \
    '{"agent_type":"deployer","agent_id":"a-4","last_assistant_message":"Status: DONE\nChanged: src/a.ts"}'
SAAC=$(jq_ "$OUT" 'String((d.hookSpecificOutput||{}).additionalContext)')
SADF=$(printf '%s' "$SAAC" | grep -qi 'domain findings' && echo 提了 || echo 没提)
SACLS=$(hasq '证据是哪一类' "$SAAC" && echo 有 || echo 无)
SANOJ=$(hasq '只报不判' "$SAAC" && echo 有 || echo 无)
SANAG=$({ hasq '漏报' "$SAAC" || hasq '补问' "$SAAC"; } && echo 有 || echo 无)
SADOM=$(hasq '领域发现' "$SAAC" && echo 有 || echo 无)
chk "$([ "$RC" -eq 0 ] && [ "$(jq_ "$OUT" 'String((d.hookSpecificOutput||{}).hookEventName)')" = "SubagentStop" ] \
      && hasq deployer "$SAAC" && hasq '客观证据' "$SAAC" \
      && [ "$SADF" = 没提 ] && [ "$SADOM" = 无 ] && [ "$SACLS" = 无 ] && [ "$SANOJ" = 无 ] && [ "$SANAG" = 无 ] && echo 0 || echo 1)" \
    "SA 回执完全没有 Domain findings 栏 → 不提这一栏、不追加那句取证要求、不催补报（没有现场依据的口径进库即噪音）" \
    "rc=0、hookEventName=SubagentStop、additionalContext 点名角色且含收工取证正文，不出现 Domain findings、「领域发现」（跨两版措辞的追加句标记）、两个新标记与催补报的话" \
    "rc=$RC 提Domain=$SADF 追加领域句=$SADOM 证据分类=$SACLS 只报不判=$SANOJ 催补话=$SANAG 泄漏句=[$([ "$SADOM" = 有 ] && show "领域发现${SAAC##*领域发现}" || echo 空)]"

TDKW='{"tool_name":"Agent","tool_input":{"subagent_type":"implementer","prompt":"修线上 bug：解析器漏判空行"}}'
SB=$(newsb td-impl)
run_hook tdd-gate "$SB" '{"tool_name":"Agent","tool_input":{"subagent_type":"implementer","prompt":"修线上 bug：解析器漏判空行"}}'
chk "$([ "$RC" -eq 0 ] && hasq 'TDD 闸门' "$ERRT" && [ -z "$OUT" ] && echo 0 || echo 1)" \
    "TD-1 派 implementer 且无红锁标记 → standard 档出提醒走 stderr、exit 0（advise 不硬拦）" \
    "rc=0 且 stderr 含「TDD 闸门」、stdout 空" "rc=$RC out=[$(show "$OUT")] err=[$(show "$ERRT")]"

TDLOG=$(cat "$SB/.claude/evidence/gate-block.log" 2>/dev/null || true)
chk "$(hasq 'tdd-gate' "$TDLOG" && hasq '[advise]' "$TDLOG" && echo 0 || echo 1)" \
    "TD-1b 同一次 advise 提醒写进 .claude/evidence/gate-block.log 且带 [advise] 前缀（advise 不记账，gate-audit 就把这道唯一守红锁的活闸判成死闸）" \
    "账本有 tdd-gate 行且含 [advise]" "账本=[$(show "$TDLOG")]"

SB=$(newsb td-other)
run_hook tdd-gate "$SB" '{"tool_name":"Agent","tool_input":{"subagent_type":"code-reviewer","prompt":"x"}}'
chk "$([ "$RC" -eq 0 ] && silent && echo 0 || echo 1)" \
    "TD-2 派的不是 implementer（code-reviewer）→ rc 0 零输出（闸只管 GREEN 实现那一步）" \
    "rc=0 无输出" "rc=$RC out=[$(show "$OUT")] err=[$(show "$ERRT")]"

SB=$(newsb td-stale); : > "$SB/.claude/.red-verified"; age_file "$SB/.claude/.red-verified" 10800
run_hook tdd-gate "$SB" '{"tool_name":"Agent","tool_input":{"subagent_type":"implementer","prompt":"修线上 bug：解析器漏判空行"}}'
chk "$([ "$RC" -eq 0 ] && hasq 'TDD 闸门' "$ERRT" && [ ! -e "$SB/.claude/.red-verified" ] && echo 0 || echo 1)" \
    "TD-3 .red-verified 的 mtime 在 3 小时前 → 视同没有标记照样提醒，且标记当场清掉（过期标记看着像验过，比没有更坏）" \
    "rc=0、stderr 含「TDD 闸门」、标记文件已删" \
    "rc=$RC 标记还在=$([ -e "$SB/.claude/.red-verified" ] && echo Y || echo N) err=[$(show "$ERRT")]"

SB=$(newsb td-fresh); : > "$SB/.claude/.red-verified"
run_hook tdd-gate "$SB" '{"tool_name":"Agent","tool_input":{"subagent_type":"implementer","prompt":"修线上 bug：解析器漏判空行"}}'
chk "$([ "$RC" -eq 0 ] && silent && [ -e "$SB/.claude/.red-verified" ] && echo 0 || echo 1)" \
    "TD-4 新鲜的 .red-verified → rc 0 零输出且标记留着（刚验过红就该放行）" \
    "rc=0 无输出、标记还在" \
    "rc=$RC 标记还在=$([ -e "$SB/.claude/.red-verified" ] && echo Y || echo N) out=[$(show "$OUT")] err=[$(show "$ERRT")]"

SB=$(newsb td-strict); set_tier "$SB" strict
run_hook tdd-gate "$SB" '{"tool_name":"Agent","tool_input":{"subagent_type":"implementer","prompt":"修线上 bug：解析器漏判空行"}}'
chk "$([ "$RC" -eq 2 ] && hasq 'TDD 闸门' "$ERRT" && [ -z "$OUT" ] && echo 0 || echo 1)" \
    "TD-5 strict 档同一件事 → exit 2 真拦（那一档人是审批者）" \
    "rc=2 且 stderr 含「TDD 闸门」、stdout 空" "rc=$RC out=[$(show "$OUT")] err=[$(show "$ERRT")]"

# 只管 red-lock 该管的单子：派单里没有 bug / 线上 / 解析器 / 契约 … 这类词就不吭声，strict 也不拦
TDUI='{"tool_name":"Agent","tool_input":{"subagent_type":"implementer","prompt":"看板 UI：卡片加阴影、加 debug 日志"}}'
SB=$(newsb td-ui-std); run_hook tdd-gate "$SB" "$TDUI"; TDR1=$RC; TDS1=$(silent && echo Y || echo N)
SB=$(newsb td-ui-strict); set_tier "$SB" strict; run_hook tdd-gate "$SB" "$TDUI"
chk "$([ "$TDR1" -eq 0 ] && [ "$TDS1" = Y ] && [ "$RC" -eq 0 ] && silent && [ ! -e "$SB/.claude/evidence/gate-block.log" ] && echo 0 || echo 1)" \
    "TD-6 派单无 red-lock 关键词（UI 卡片，debug 不算 bug）→ standard 与 strict 都 rc 0 零输出、不记账" \
    "两档都 rc=0 无输出、无账本" "standard rc=$TDR1 静默=$TDS1；strict rc=$RC out=[$(show "$OUT")] err=[$(show "$ERRT")]"

SB=$(newsb td-dedup)
run_hook tdd-gate "$SB" "$TDKW"; TDE1="$ERRT"; TDR1=$RC
TDN1=$(grep -c 'tdd-gate' "$SB/.claude/evidence/gate-block.log" 2>/dev/null || true)
chk "$([ "$TDR1" -eq 0 ] && hasq 'TDD 闸门' "$TDE1" && [ "$TDN1" = 1 ] && [ -f "$SB/.claude/.tdd-gate-advised" ] && echo 0 || echo 1)" \
    "TD-7 含关键词、无红锁标记、头一回派 → advise 提醒并记账，留下去重标记" \
    "rc=0、stderr 含「TDD 闸门」、账本 1 条、.tdd-gate-advised 在" "rc=$TDR1 账本=$TDN1 err=[$(show "$TDE1")]"
run_hook tdd-gate "$SB" "$TDKW"
TDN2=$(grep -c 'tdd-gate' "$SB/.claude/evidence/gate-block.log" 2>/dev/null || true)
chk "$([ "$RC" -eq 0 ] && silent && [ "$TDN2" = 1 ] && echo 0 || echo 1)" \
    "TD-8 同一张单子第二次派 → 静默放行、账本不加行" \
    "rc=0 无输出、账本仍 1 条" "rc=$RC 账本=$TDN2 out=[$(show "$OUT")] err=[$(show "$ERRT")]"

# 中文同义词与英文短词词首：「修复 #123 崩溃」该提醒；prefix / author 里的 fix / auth 不是词首，静默
SB=$(newsb td-zh)
run_hook tdd-gate "$SB" '{"tool_name":"Agent","tool_input":{"subagent_type":"implementer","prompt":"修复 #123 崩溃"}}'
chk "$([ "$RC" -eq 0 ] && hasq 'TDD 闸门' "$ERRT" && echo 0 || echo 1)" \
    "TD-9 派单「修复 #123 崩溃」→ standard 档出提醒（中文同义词进了关键词表）" \
    "rc=0 且 stderr 含「TDD 闸门」" "rc=$RC err=[$(show "$ERRT")]"
SB=$(newsb td-prefix)
run_hook tdd-gate "$SB" '{"tool_name":"Agent","tool_input":{"subagent_type":"implementer","prompt":"prefix 与 author 字段"}}'
chk "$([ "$RC" -eq 0 ] && silent && echo 0 || echo 1)" \
    "TD-10 派单「prefix 与 author 字段」→ 静默（fix / auth 只认词首）" \
    "rc=0 无输出" "rc=$RC out=[$(show "$OUT")] err=[$(show "$ERRT")]"

SB=$(newsb tf-dirty progress git)
printf 'echo more\n' >> "$SB/src/app.sh"
run_hook three-file-sync-gate "$SB" ''
chk "$([ "$RC" -eq 0 ] && advised "$OUT" && echo 0 || echo 1)" \
    "TF 改了代码而 progress.md 未同步 → 出 systemMessage 提醒且不 block（三档都是 advise）" \
    "rc=0 且 stdout 含 systemMessage、不含 decision:block" "rc=$RC out=[$(show "$OUT")]"

# ---------------------------------------------------------------------------
echo ""
echo "==== test-hooks-node：PASS=$PASS FAIL=$FAIL ===="
if [ "$FAIL" -gt 0 ]; then
    echo "test-hooks-node: failed（上面点名了是哪个 hook 的主路径变了）" >&2
    exit 1
fi
echo "test-hooks-node: passed（各 hook 主路径的输出形态与退出码符合契约）"
