#!/usr/bin/env bash
# risk: medium
# test-evidence-defects.sh — P1 证据层（lib/evidence.mjs 的 gate/ledger/gate-audit/retention/risk
#   + lib/task.mjs 的 task/budget）七条缺陷的红锁回归测试。
#
# 与 cases/test-harness.sh 的分工：那份锁「引擎端到端链路该有的行为」（该全绿），
#   这份锁「证据层的核心主张——证据留得住、不能被静默改写——现在还不成立」。
#   E1 readLedger 对读不出来的账本 fail-open（返回 []），retention --apply 于是认为保护集为空、
#      把证据真删了；E5 链不完好时删除类命令必须 fail-closed。其余五条随测试减重退休，
#      证据层的纯函数面由 harness selftest 守。

set -eu

REPO="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"

HARNESS="$REPO/.claude/harness/harness.mjs"
LIBDIR="$(dirname "$HARNESS")/lib"
EXTDIR="$(dirname "$HARNESS")/ext"
HOOKSLIB="$REPO/.claude/hooks/lib"
PROFILE="$REPO/.claude/harness/profile.json"

echo "===== test-evidence-defects ====="
echo "REPO=$REPO"

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node（command -v node 未找到）——证据层是纯 node，一条都跑不了，未执行 != 通过。" >&2
    exit 1
fi
if ! command -v git >/dev/null 2>&1; then
    echo "SKIPPED: 无 git（command -v git 未找到）——沙箱仓造不出来，未执行 != 通过。" >&2
    exit 1
fi
if ! command -v sleep >/dev/null 2>&1; then
    echo "SKIPPED: 无 sleep——E2 的并发对齐造不出来，未执行 != 通过。" >&2
    exit 1
fi

TMP=$(mktemp -d)
trap 'chmod -R u+rwX "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

# chk <判定 0=过/1=不过> <标题> <EXPECT 描述> <GOT 描述>
# EXPECT / GOT 无论过不过都打印：判定要能被第三方复核，不能靠本文件的措辞。
chk() {
    if [ "$1" -eq 0 ]; then
        PASS=$((PASS + 1)); echo "  [PASS] $2"
    else
        FAIL=$((FAIL + 1)); echo "  [FAIL] $2"
    fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}

# run <沙箱> <子命令...> —— 跑引擎，回填 RC / OUT（stdout）/ ERR（stderr）。
RC=0
OUT=""
ERR=""
skip() { echo "  [SKIP] $1"; }

# ---------------------------------------------------------------------------
# 沙箱与引擎驱动
# ---------------------------------------------------------------------------

# newsandbox <名> <check命令> [check类] [--nogit]
#   造一个启用了 harness 的临时项目：一个 core 模块、一条 medium 档 check。
#   引擎按目录整拷（harness.mjs import 同级 lib/，只拷单文件会 ERR_MODULE_NOT_FOUND）。
#   ext/ 一起搬：gate / ledger / task 这几节都住在那个可选包里，缺它一律 rc 3 报「未安装」，
#   而本文件每条断言读的都是退出码，rc 3 会把整份文件变成在测一条空路径。
#   hooks/lib/ 与 profile.json 一起进来：档位只有一个解析器且在 hook 侧，引擎 lib/tier.mjs
#   import 的是 ../../hooks/lib/tier.mjs——缺它引擎以契约外的 rc 1 退出，下面每条「期望非零」
#   的断言都会因为同一个起不来而变绿，整份文件读起来全过、其实一条都没跑。
newsandbox() {
    local name="$1" cmd="$2" cls="${3:-test}" mode="${4:-git}"
    local d="$TMP/$name"
    mkdir -p "$d/.claude/harness" "$d/.claude/hooks" "$d/core" "$d/docs"
    cp "$HARNESS" "$d/.claude/harness/harness.mjs"
    cp -R "$LIBDIR" "$d/.claude/harness/lib"
    [ -d "$EXTDIR" ] && cp -R "$EXTDIR" "$d/.claude/harness/ext"
    cp -R "$HOOKSLIB" "$d/.claude/hooks/lib"
    cp "$PROFILE" "$d/.claude/harness/profile.json"
    cat > "$d/.claude/harness/module-catalog.json" <<EOF
{"version":1,
 "modules":[{"id":"core","paths":["core/**"],"riskTier":"medium"}],
 "global":[],
 "ignored":["docs/**"],
 "riskChecks":{"medium":["probe"]},
 "checks":{"probe":{"command":"$cmd","class":"$cls","allowFastSkip":true}}}
EOF
    echo baseline > "$d/core/a.txt"
    echo doc > "$d/docs/x.md"
    if [ "$mode" = git ]; then
        (
            cd "$d" && git init -q . \
                && git config core.autocrlf false \
                && git config user.email t@example.com && git config user.name t \
                && git add -A && git commit -qm init
        ) >/dev/null 2>&1
        echo worktree-change >> "$d/core/a.txt"
    fi
    printf '%s' "$d"
}

run() {
    local d="$1"; shift
    RC=0
    OUT=$( cd "$d" && CLAUDE_PROJECT_DIR="$d" node "$d/.claude/harness/harness.mjs" "$@" 2>"$TMP/.stderr" ) || RC=$?
    # shellcheck disable=SC2034  # run() 的 RC/OUT/ERR 三元组契约（见上方注释），本文件断言未消费 stderr 文本，保留补齐契约不影响行为
    ERR=$(cat "$TMP/.stderr" 2>/dev/null || true)
}

# jval <json> <点路径> —— 取字段（不存在回空串）。数组/对象回 JSON 串。
jval() {
    printf '%s' "$1" | node -e '
        let s = "";
        process.stdin.on("data", d => s += d).on("end", () => {
            try {
                const line = s.trim().split("\n").filter(Boolean).pop();
                let v = JSON.parse(line);
                for (const k of process.argv[1].split(".")) v = (v == null ? undefined : v[k]);
                console.log(v === undefined ? "" : (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)));
            } catch (_e) { console.log(""); }
        });
    ' "$2"
}

# chmod 000 对 root 无效——E1 整组依赖「文件真读不了」，先自证本机不是 root。
printf 'x' > "$TMP/.permprobe"
chmod 000 "$TMP/.permprobe"
PERM_BLOCKS=$(node -e 'try{require("fs").readFileSync(process.argv[1],"utf8");console.log("NO");}catch(e){console.log("YES");}' "$TMP/.permprobe")
chmod 644 "$TMP/.permprobe"
# ---------------------------------------------------------------------------
echo ""
echo "--- E1 账本读不出来时必须降级，不许 fail-open ---"
# 实测（缺陷未修）：chmod 000 ledger.jsonl 后
#   ledger      -> {"ok":true,"entries":0,...} rc 0
#   risk        -> {"ok":true,"findings":[]}   rc 0
#   retention --apply --max-evidence 0 -> protectedByLedger:0 removed:1，证据文件被真删

if [ "$PERM_BLOCKS" != "YES" ]; then
    skip "E1 全组 —— 本机 chmod 000 挡不住读（多半是 root），造不出「文件读不了」，未执行 != 通过"
else
    SB1=$(newsandbox e1 "echo probe-output")
    run "$SB1" gate
    E1_EV=$(jval "$OUT" results.0.evidence)
    chmod 000 "$SB1/.claude/harness/state/ledger.jsonl"

    run "$SB1" ledger
    E1_LRC="$RC"; E1_LOK=$(jval "$OUT" ok); E1_LN=$(jval "$OUT" entries)
    chk "$([ "$E1_LRC" -ne 0 ] && echo 0 || echo 1)" \
        "E1a 账本文件读不出来 -> ledger 不许 rc 0（读不出 = 无法判定，不是「链完好」）" \
        "rc != 0（降级 3 或报错 1 都行，就是不许 0）" \
        "rc=$E1_LRC ok=$E1_LOK entries=$E1_LN"

    chk "$([ "$E1_LOK" != "true" ] && echo 0 || echo 1)" \
        "E1b 账本文件读不出来 -> 输出不许自称 ok:true" \
        "ok != true" \
        "ok=$E1_LOK entries=${E1_LN}（entries=0 是把「读不了」当成了「空账本」）"

    run "$SB1" retention --apply --max-evidence 0
    E1_RRC="$RC"; E1_REMOVED=$(jval "$OUT" removed); E1_PROT=$(jval "$OUT" protectedByLedger)
    E1_EV_LEFT=$([ -f "$SB1/$E1_EV" ] && echo YES || echo NO)
    chk "$([ "$E1_EV_LEFT" = "YES" ] && echo 0 || echo 1)" \
        "E1c 账本读不出来时 retention --apply 一个文件都不许删（保护集未知 != 保护集为空）" \
        "被账本引用的证据文件仍在" \
        "证据文件=$E1_EV 仍在=$E1_EV_LEFT removed=$E1_REMOVED protectedByLedger=$E1_PROT"

    if [ "$E1_RRC" -ne 0 ] || [ "$(jval "$OUT" ok)" != "true" ]; then r=0; else r=1; fi
    chk "$r" \
        "E1d 这次拒绝删除必须机器可见，不许静默报成一次成功的修剪" \
        "rc != 0 或 ok != true" \
        "rc=$E1_RRC ok=$(jval "$OUT" ok) removed=$E1_REMOVED"

    chmod 644 "$SB1/.claude/harness/state/ledger.jsonl"
    run "$SB1" ledger
    chk "$([ "$RC" -eq 0 ] && [ "$(jval "$OUT" ok)" = "true" ] && echo 0 || echo 1)" \
        "E1e 权限恢复后照旧 rc 0 ok:true〔防回归位，现在就该绿：修 E1 不许把可读账本也判成断链〕" \
        "rc=0 且 ok=true" \
        "rc=$RC ok=$(jval "$OUT" ok)"
fi
# ---------------------------------------------------------------------------
echo ""
echo "--- E5 链不完好时删除类命令必须 fail-closed ---"
# 实测（缺陷未修）：链完好时 retention --apply --max-evidence 0 -> candidates:0 removed:0（对）；
#   把那条记录改成不可解析后 -> protectedByLedger:0 candidates:1 removed:1 rc 0，证据被真删。

SB5=$(newsandbox e5 "echo e5-output")
run "$SB5" gate
E5_EV=$(jval "$OUT" results.0.evidence)

run "$SB5" retention --apply --max-evidence 0
E5_INTACT_LEFT=$([ -f "$SB5/$E5_EV" ] && echo YES || echo NO)
chk "$([ "$E5_INTACT_LEFT" = "YES" ] && [ "$(jval "$OUT" removed)" = "0" ] && echo 0 || echo 1)" \
    "E5a 链完好时被引用的证据不许删〔防回归位，现在就该绿〕" \
    "removed=0 且证据文件仍在" \
    "removed=$(jval "$OUT" removed) protectedByLedger=$(jval "$OUT" protectedByLedger) 仍在=$E5_INTACT_LEFT"

node -e '
    const fs = require("fs"), p = process.argv[1];
    const lines = fs.readFileSync(p, "utf8").split("\n");
    lines[0] = "{{CORRUPTED" + lines[0];
    fs.writeFileSync(p, lines.join("\n"));
' "$SB5/.claude/harness/state/ledger.jsonl"

run "$SB5" ledger
E5_LRC="$RC"
run "$SB5" retention --apply --max-evidence 0
E5_RRC="$RC"; E5_REMOVED=$(jval "$OUT" removed); E5_OK=$(jval "$OUT" ok)
E5_LEFT=$([ -f "$SB5/$E5_EV" ] && echo YES || echo NO)
chk "$([ "$E5_LEFT" = "YES" ] && echo 0 || echo 1)" \
    "E5b 链已断裂（ledger rc=${E5_LRC}）时 retention --apply 一个文件都不许删" \
    "证据文件仍在（先验链再决定删不删）" \
    "证据文件=$E5_EV 仍在=$E5_LEFT removed=$E5_REMOVED protectedByLedger=$(jval "$OUT" protectedByLedger)"

if [ "$E5_RRC" -ne 0 ] || [ "$E5_OK" != "true" ]; then r=0; else r=1; fi
chk "$r" \
    "E5c 链断时的这次拒绝必须机器可见" \
    "rc != 0 或 ok != true" \
    "rc=$E5_RRC ok=$E5_OK removed=$E5_REMOVED"
echo ""
echo "==== test-evidence-defects：PASS=$PASS FAIL=$FAIL ===="
if [ "$FAIL" -gt 0 ]; then
    echo "test-evidence-defects: failed —— 修复前这是预期状态（红锁）；修复后必须转全绿" >&2
    exit 1
fi
echo "test-evidence-defects: passed（证据留得住、删除类命令 fail-closed）"
