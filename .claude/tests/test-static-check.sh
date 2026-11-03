#!/usr/bin/env bash
# risk: low
# test-static-check.sh — static-check 必须认 JS 家族并且真的跑过。
# 留两条（2026-09-10 预算表）：① 语法错 → rc 非 0 且点名到 文件:行；② 全对 → rc 0 且输出出现
#   `node --check`（光判 rc=0 会被「未识别到可跑的静态检查……跳过」那条空绿路径冒充）；
#   三个扩展名逐个验、node_modules 排除那批退休。
# 沙箱里不放 .sh/.py/tsconfig.json：那样 ran 会被 shellcheck/ruff/tsc 填上，判据就不干净了。
# 坏样例 `export const x = ;` 在 ESM 下必是语法错，不另设脚手架自证。
# 追加三条（TODO #85）：③ shellcheck 范围补上 .claude/**/*.sh 后，.claude 下的坏 .sh 也该判红
#   （回归旧 PRUNE 整块排掉 .claude 的漏检）；④/⑤ .claude/workflows/*.js 允许顶层 return/await
#   （宿主包一层 async function 执行），裸 node --check 会把这个设计误判成语法错——合法的顶层
#   return 该判绿，真语法错误仍要判红，且报的行号要能对回原文件（包壳查法的行号映射）。
set -u

SRC=$(cd "$(dirname "$0")/.." && pwd)
CHECK=${1:-"$SRC/hooks/static-check.mjs"}

echo "===== test-static-check ====="
command -v node >/dev/null 2>&1 || {
    echo 'SKIPPED: 无 node——node --check 这条分支本身跑不了，未执行 != 通过。'
    exit 0
}
[ -f "$CHECK" ] || { echo "test-static-check: 找不到被测 static-check.mjs：$CHECK" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0
chk() {
    if [ "$1" -eq 0 ]; then PASS=$((PASS + 1)); echo "  [PASS] $2"; else FAIL=$((FAIL + 1)); echo "  [FAIL] $2"; fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}
contains() { case "$2" in *"$1"*) return 0 ;; *) return 1 ;; esac; }

SC_RC=0; SC_OUT=""
run_check() { SC_RC=0; SC_OUT=$(node "$CHECK" "$1" 2>&1) || SC_RC=$?; }
brief() { printf '%s\n' "$1" | head -6 | tr '\n' '|'; }

# 每个场景一间干净屋子：只有 JS，判据才只关乎 JS 分支。
mkbox() {
    local d="$TMP/$1"; rm -rf "$d"; mkdir -p "$d"
    printf 'export const y = 1;\n' > "$d/ok.mjs"; printf '%s' "$d"
}

echo "-- ① 语法错必须被抓到并点名到行 --"
BOX=$(mkbox bad-mjs)
printf 'export const x = ;\n' > "$BOX/bad.mjs"
run_check "$BOX"
r=1
if [ "$SC_RC" -ne 0 ] && contains "bad.mjs" "$SC_OUT"; then r=0; fi
chk "$r" "① 坏的 .mjs → rc 非 0 且点名 bad.mjs" \
    "rc != 0 且输出含 bad.mjs" "rc=${SC_RC}；输出：$(brief "$SC_OUT")"
printf '%s\n' "$SC_OUT" | grep -q "bad\.mjs:[0-9]"; r=$?
chk "$r" "① 点名到行号（bad.mjs:<行>）" \
    "输出含形如 bad.mjs:1 的位置" "匹配：[$(printf '%s\n' "$SC_OUT" | grep -o "bad\.mjs:[0-9]*" | head -3 | tr '\n' ' ')]"

echo "-- ② 全对时必须是「跑过且通过」，不是「没识别所以跳过」 --"
BOX=$(mkbox good)
printf 'export function f(a) { return a + 1; }\n' > "$BOX/util.js"
printf 'module.exports = { a: 1 };\n' > "$BOX/conf.cjs"
run_check "$BOX"
r=1
if [ "$SC_RC" -eq 0 ] && contains 'node --check' "$SC_OUT"; then r=0; fi
chk "$r" "② 三个好文件 → rc 0 且输出出现 node --check（判 rc=0 会被空绿路径冒充）" \
    "rc=0 且输出含 'node --check'" "rc=${SC_RC}；输出：$(brief "$SC_OUT")"

if command -v shellcheck >/dev/null 2>&1; then
    echo "-- ③ shellcheck 范围要覆盖 .claude/**/*.sh（不再被 PRUNE 整块排掉）--"
    BOX=$(mkbox claude-sh)
    mkdir -p "$BOX/.claude/scripts"
    # shellcheck disable=SC2016  # 单引号是夹具内容本身（一份带未加引号变量的坏 .sh），故意不让外层 shell 展开 $UNQUOTED
    printf '#!/usr/bin/env bash\necho $UNQUOTED\n' > "$BOX/.claude/scripts/badcheck.sh"
    run_check "$BOX"
    r=1
    if [ "$SC_RC" -ne 0 ] && contains "badcheck.sh" "$SC_OUT" && contains "shellcheck" "$SC_OUT"; then r=0; fi
    chk "$r" "③ .claude/scripts/ 下带告警的 .sh → rc 非 0 且点名 badcheck.sh（shellcheck 段落）" \
        "rc != 0 且输出含 badcheck.sh 与 shellcheck" "rc=${SC_RC}；输出：$(brief "$SC_OUT")"
else
    echo "SKIPPED ③：未装 shellcheck，该断言本身跑不了，未执行 != 通过。"
fi

echo "-- ④ .claude/workflows/*.js 顶层 return（宿主包壳执行）应判绿，不是伪造的语法错 --"
BOX=$(mkbox wf-ok)
mkdir -p "$BOX/.claude/workflows"
printf 'export const meta = { name: "x", description: "d" }\nconst a = 1\nreturn { a }\n' \
    > "$BOX/.claude/workflows/ok-flow.js"
run_check "$BOX"
r=1
if [ "$SC_RC" -eq 0 ] && contains 'node --check' "$SC_OUT"; then r=0; fi
chk "$r" "④ 合法 workflow 脚本（顶层 export const meta + 顶层 return）→ rc 0" \
    "rc=0 且输出含 'node --check'" "rc=${SC_RC}；输出：$(brief "$SC_OUT")"

echo "-- ⑤ .claude/workflows/*.js 真语法错误仍要判红，且行号对回原文件 --"
BOX=$(mkbox wf-bad)
mkdir -p "$BOX/.claude/workflows"
printf 'export const meta = { name: "x", description: "d" }\nconst a = 1\nconst b = ;\nreturn { a, b }\n' \
    > "$BOX/.claude/workflows/bad-flow.js"
run_check "$BOX"
r=1
if [ "$SC_RC" -ne 0 ] && contains "bad-flow.js" "$SC_OUT"; then r=0; fi
chk "$r" "⑤ 坏的 workflow 脚本 → rc 非 0 且点名 bad-flow.js" \
    "rc != 0 且输出含 bad-flow.js" "rc=${SC_RC}；输出：$(brief "$SC_OUT")"
printf '%s\n' "$SC_OUT" | grep -q "bad-flow\.js:3$"; r=$?
chk "$r" "⑤ 行号对回原文件第 3 行（真错误在 const b = ; 那行，不是包壳后的行号）" \
    "输出含 bad-flow.js:3" "匹配：[$(printf '%s\n' "$SC_OUT" | grep -o "bad-flow\.js:[0-9]*" | head -3 | tr '\n' ' ')]"

echo "-- ⑥ .claude/workflows/*.js 缺右括号（EOF 错误）时，行号不许越过原文件末尾（code-review Low-3）--"
BOX=$(mkbox wf-eof)
mkdir -p "$BOX/.claude/workflows"
printf 'export const meta = {\n' > "$BOX/.claude/workflows/eof-flow.js"
run_check "$BOX"
r=1
if [ "$SC_RC" -ne 0 ] && contains "eof-flow.js" "$SC_OUT"; then r=0; fi
chk "$r" "⑥ 只有一行的 workflow 脚本（漏了右括号）→ rc 非 0 且点名 eof-flow.js" \
    "rc != 0 且输出含 eof-flow.js" "rc=${SC_RC}；输出：$(brief "$SC_OUT")"
printf '%s\n' "$SC_OUT" | grep -q "eof-flow\.js:1$"; r=$?
chk "$r" "⑥ 行号钳在原文件仅有的第 1 行（不是包壳后越界的 :3）" \
    "输出含 eof-flow.js:1" "匹配：[$(printf '%s\n' "$SC_OUT" | grep -o "eof-flow\.js:[0-9]*" | head -3 | tr '\n' ' ')]"

echo ""
echo "==== test-static-check：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ]
