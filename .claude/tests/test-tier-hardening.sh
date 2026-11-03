#!/usr/bin/env bash
# risk: medium
# test-tier-hardening.sh — 档位执法面红锁：**地板闸不可被 override 压掉**。
#
# 与 test-tier.sh 的分工：那份锁子命令语义，这份只锁一件事——用户把 overrides 压到地板闸
#   头上时，判定层与对外契约都不许松口。突变实验证明删掉 floor 分支后其余用例全绿、
#   没有任何断言响，所以这条留着；别的韧性穷举（PH/PB/PS/PX/PL/PR）按 2026-09-10 预算表退休。
#
# 契约来源：docs/v3-tiered-harness-proposal.md §三「安全地板：任何档都改不了」。
# 纪律：写操作只落 mktemp 沙箱，对本仓只读；每条断言打印 EXPECT / GOT，判定不依赖措辞。
set -eu

ROOT=${CC_BASE_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}
HARNESS="$ROOT/.claude/harness/harness.mjs"
HOOKS="$ROOT/.claude/hooks"
FIX="$ROOT/.claude/tests/fixtures/tier/profile-base.json"

echo "===== test-tier-hardening ====="

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node——引擎与 hook 全是 .mjs，跑不起来；未执行 != 通过。" >&2
    exit 1
fi
if ! command -v git >/dev/null 2>&1; then
    echo "SKIPPED: 无 git——沙箱仓造不出来；未执行 != 通过。" >&2
    exit 1
fi
[ -f "$HARNESS" ] || { echo "  [FAIL] 缺 harness.mjs：$HARNESS" >&2; exit 1; }
[ -f "$FIX" ] || { echo "  [FAIL] 缺基线 profile 夹具：$FIX" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'chmod -R u+rwX "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

chk() {
    if [ "$1" -eq 0 ]; then
        PASS=$((PASS + 1)); echo "  [PASS] $2"
    else
        FAIL=$((FAIL + 1)); echo "  [FAIL] $2"
    fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}

show() { printf '%s' "${1:-空}" | tr '\n' '~' | cut -c1-300; }

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

# newsb <名> —— 沙箱项目：git 仓 + 整台引擎 + hooks（判定与 quarantine 落点都从引擎自身位置推）。
newsb() {
    local d="$TMP/$1"
    rm -rf "$d"
    mkdir -p "$d/.claude/harness/lib" "$d/.claude/hooks/lib" "$d/.claude/evidence" "$d/.claude/.runtime"
    cp "$ROOT/.claude/settings.json" "$d/.claude/settings.json" 2>/dev/null || true
    cp "$ROOT/.claude/harness/harness.mjs" "$d/.claude/harness/" 2>/dev/null || true
    cp "$ROOT"/.claude/harness/lib/*.mjs "$d/.claude/harness/lib/" 2>/dev/null || true
    cp "$HOOKS"/*.mjs "$d/.claude/hooks/" 2>/dev/null || true
    cp -R "$HOOKS/lib/." "$d/.claude/hooks/lib/" 2>/dev/null || true
    printf '# progress\n' > "$d/progress.md"
    ( cd "$d" && git init -q . && git config core.autocrlf false \
        && git config user.email t@example.com && git config user.name t \
        && git add -A && git commit -qm init ) >/dev/null 2>&1
    printf '%s' "$d"
}

# mkprofile <沙箱> <变异表达式> —— 基线 profile 做一处变异后写入并提交（留未跟踪会自动抬 strict）。
mkprofile() {
    local d="$1" mut="${2:-}"
    node -e '
const fs = require("node:fs");
const [src, dest, mut] = process.argv.slice(1);
const p = JSON.parse(fs.readFileSync(src, "utf8"));
if (mut) { eval(mut); }
fs.writeFileSync(dest, JSON.stringify(p, null, 2) + "\n");
' "$FIX" "$d/.claude/harness/profile.json" "$mut"
    ( cd "$d" && git add -A -f .claude/harness && git commit -qm profile ) >/dev/null 2>&1
}

RC=0
OUT=""
ERRT=""

hrun() {
    local d="$1"
    shift
    RC=0
    ( cd "$d" && CLAUDE_PROJECT_DIR="$d" node "$d/.claude/harness/harness.mjs" "$@" ) \
        >"$TMP/.o" 2>"$TMP/.e" || RC=$?
    OUT=$(cat "$TMP/.o" 2>/dev/null || true)
    ERRT=$(cat "$TMP/.e" 2>/dev/null || true)
}

# hookrun <hook 名> <沙箱> <stdin 文本> —— 跑沙箱里那份 hook（gateMode 才是每个事件都跑的执法点）。
hookrun() {
    local n="$1" d="$2" input="$3"
    RC=0
    printf '%s' "$input" | ( cd "$d" && CLAUDE_PROJECT_DIR="$d" node "$d/.claude/hooks/$n.mjs" ) \
        >"$TMP/.o" 2>"$TMP/.e" || RC=$?
    OUT=$(cat "$TMP/.o" 2>/dev/null || true)
    ERRT=$(cat "$TMP/.e" 2>/dev/null || true)
}

# ---------------------------------------------------------------------------
echo ""
echo "--- PF 地板不可被 override 压掉（floor 分支删掉后其余用例全绿，无人测到）---"

SB=$(newsb pf-ov); mkprofile "$SB" 'p.overrides = { "secret-exfil-guard": "off" };'
hrun "$SB" tier explain secret-exfil-guard
PF_E_RC="$RC"; PF_E="$OUT"
chk "$([ "$PF_E_RC" -eq 0 ] && [ "$(jq_ "$PF_E" 'String(d.source)')" = "floor" ] && echo 0 || echo 1)" \
    "PF-1 overrides 把地板闸写成 off → explain 的 source 仍是 floor（不是 override）" \
    "rc=0 且 source=floor" "rc=$PF_E_RC out=[$(show "$PF_E")]"
chk "$([ "$(jq_ "$PF_E" 'String(d.effective)')" = "block" ] && echo 0 || echo 1)" \
    "PF-2 同上 → explain 的 effective=block（判定层的地板；这一条才杀得掉「删 floor 分支」的突变）" \
    "effective=block" "out=[$(show "$PF_E")]"

hookrun secret-exfil-guard "$SB" '{"tool_input":{"command":"cat .env"}}'
chk "$([ "$RC" -eq 2 ] && echo 0 || echo 1)" \
    "PF-3 同一沙箱喂外泄命令 → hook 仍 exit 2（explain 是可选步骤，gateMode 才是每个事件都跑的执法点）" \
    "rc=2" "rc=$RC err1=[$(printf '%s' "$ERRT" | head -1 | cut -c1-120)]"

# 对照组：同样一条 overrides 压在**非地板**闸上必须真的生效。缺了它，上面三条等价于「override 全无效」。
SB=$(newsb pf-ctl); mkprofile "$SB" 'p.overrides = { "tdd-gate": "off" };'
hrun "$SB" tier status
chk "$([ "$(jq_ "$OUT" 'String((d.hooks||{})["tdd-gate"])')" = "off" ] && echo 0 || echo 1)" \
    "PF-4 对照：overrides 压在非地板闸 tdd-gate 上真的生效（=off），证明 PF-1..3 判的是地板" \
    "模式表 tdd-gate=off" "out=[$(show "$OUT")]"

# ---------------------------------------------------------------------------
echo ""
echo "--- PK sticky 不绕开读侧硬化（TODO #91）---"
# 非 sticky 的 fast 照旧必过期（test-tier.sh TT-1 锁着）；sticky 单列：它不看 expires，
# 所以「缺 set_epoch 不认」得在 sticky 形状上再锁一次——红蓝 High #2 当年就是靠缺 set_epoch
# 换来 642713 小时的 fast，sticky 若成了绕过它的新门，等于把那条修复白送回去。

SB=$(newsb pk-nose); mkprofile "$SB" ''
printf '{"tier":"fast","reason":"t","by":"user","sticky":true,"expires_epoch":null}\n' \
    > "$SB/.claude/.runtime/tier.json"
hrun "$SB" tier status
chk "$([ "$(jq_ "$OUT" 'String(d.tier)+"/"+String(d.sticky)')" = "standard/undefined" ] && echo 0 || echo 1)" \
    "PK-1 sticky:true + expires_epoch:null 但缺 set_epoch → 不认，回默认档 standard、不报 sticky" \
    "standard/undefined" "out=[$(show "$OUT")]"

# 对照组：同一份记录补上 set_epoch 就被认作 sticky fast——缺了它，PK-1 等价于「sticky 全不认」。
printf '{"tier":"fast","reason":"t","by":"user","set_epoch":1000,"sticky":true,"expires_epoch":null}\n' \
    > "$SB/.claude/.runtime/tier.json"
hrun "$SB" tier status
chk "$([ "$(jq_ "$OUT" 'String(d.tier)+"/"+String(d.sticky)')" = "fast/true" ] && echo 0 || echo 1)" \
    "PK-2 对照：补上 set_epoch（哪怕是 1970 年）→ 认作 sticky fast，证明 PK-1 判的是缺 set_epoch" \
    "fast/true" "out=[$(show "$OUT")]"

echo ""
echo "==== test-tier-hardening：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ]
