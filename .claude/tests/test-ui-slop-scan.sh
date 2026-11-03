#!/usr/bin/env bash
# risk: medium
# test-ui-slop-scan.sh — 「AI 味界面」静态闸（scripts/ui-slop-scan.mjs）的回归测试。
#
# 断言按**契约**写：node ui-slop-scan.mjs [--paths <逗号分隔>] [--json]，扫不到界面源码 → rc 0；有 error → rc 1；
#   未知参数 → rc 2；warning 只报不拦——所以命中逐条从 --json 按 code@行号 取，不靠 rc 猜。
# 这道闸两头都会坏，用例也分两头：假绿是该报的没报（紫靛主色 / 正文小字 / 行高出 1.4–1.6 / 大圆角 / 渐变色标堆多）；
#   假红是正当写法被拦（角标 line-height:1、图标容器 0、大字号收字距、胶囊 9999px）——行高与字距刚因误伤收窄过，
#   反向用例就是钉住这次收窄。夹具在 mktemp 沙箱里现造，不落 tests/fixtures；对本仓只读。
#
# 用法：bash test-ui-slop-scan.sh [ui-slop-scan.mjs 路径]
set -u

SRC=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(cd "$SRC/.." && pwd)
SCAN=${1:-"$SRC/scripts/ui-slop-scan.mjs"}

echo "===== test-ui-slop-scan ====="
command -v node >/dev/null 2>&1 || {
    echo 'SKIPPED: 无 node——被测脚本是 .mjs，未执行 != 通过。'
    exit 0
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
chk() {
    if [ "$1" -eq 0 ]; then pass "$2"; else fail "$2"; fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}
contains() { case "$2" in *"$1"*) return 0 ;; *) return 1 ;; esac; }
brief() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-200 | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null; }
newdir() { mktemp -d "$TMP/caseXXXXXX"; }
# 顶层计数取 --json 的字段，命中取 code@行号 的有序串——「有没有这个词」和「这条命中指着哪一行」是两回事。
jread() { # <json> <codes|字段名>
    printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("PARSE_ERROR")}const f=process.argv[1];console.log(f==="codes"?(j.findings||[]).map(x=>x.code+"@"+x.line).sort().join(" "):j[f])})' -- "$2"
}

RC=0
OUT=""
run_json() { OUT=$(node "$SCAN" --paths "$1" --json 2>&1); RC=$?; }

if [ -f "$SCAN" ]; then
    chk 0 "U0 被测脚本存在：$SCAN" "ui-slop-scan.mjs 存在" "存在"
else
    chk 1 "U0 被测脚本存在：$SCAN" "ui-slop-scan.mjs 存在" "不存在——下面每条都会红，红因是功能缺失"
fi

# ---------------------------------------------------------------------------
# 地板：没有界面的仓库不许被弄红
# ---------------------------------------------------------------------------
# U1 本仓自己就是「没有界面源码」的样子：默认扫当前目录，必须跳过而不是报一堆。
OUT=$(cd "$REPO" && node "$SCAN" 2>&1); RC=$?
if [ "$RC" -eq 0 ] && contains '未找到界面源码，跳过' "$OUT"; then r=0; else r=1; fi
chk "$r" "U1 在本仓根目录默认扫描：跳过且 rc 0（没界面的仓库不该被这道闸弄红）" \
    "rc=0 且输出含「未找到界面源码，跳过」" "rc=${RC}；输出：$(brief "$OUT")"

OUT=$(node "$SCAN" --bogus 2>&1); RC=$?
if [ "$RC" -eq 2 ] && contains '未知参数：--bogus' "$OUT"; then r=0; else r=1; fi
chk "$r" "U3 未知参数 → rc 2 并点名那个参数" "rc=2 且输出含「未知参数：--bogus」" \
    "rc=${RC}；输出：$(brief "$OUT")"

# ---------------------------------------------------------------------------
# 假绿一侧：五条判据各来一条真阳性，按 code@行号 对齐
# ---------------------------------------------------------------------------
D=$(newdir)
printf '%s\n' ':root { --color-primary: #6366F1; }' 'body { font-size: 12px; }' 'p { font-size: 16px; line-height: 1.2; }' \
              '.card { border-radius: 16px; }' '.hero { background: linear-gradient(90deg, #ff0000, #00ff00, #0000ff, #ffff00); }' > "$D/app.css"
run_json "$D"
GOT=$(jread "$OUT" codes)
WANT='BIG_RADIUS@4 GRADIENT_STOPS@5 LINE_HEIGHT@3 PURPLE_PRIMARY@1 SMALL_BODY_TEXT@2'
if [ "$RC" -eq 1 ] && [ "$GOT" = "$WANT" ]; then r=0; else r=1; fi
chk "$r" "U4 五条判据各命中一行：紫靛主色 / 正文 12px / 行高 1.2 / 圆角 16px / 渐变 4 色标" \
    "rc=1（三条 error）且 codes=[$WANT]" "rc=${RC}；codes=[$GOT]"

# ---------------------------------------------------------------------------
# 假红一侧（重点）：这四行是正当写法，一条都不许报
# ---------------------------------------------------------------------------
D=$(newdir)
printf '%s\n' '.badge { line-height: 1; }' '.icon { line-height: 0; }' \
              'h1 { font-size: 48px; letter-spacing: -0.03em; }' '.pill { border-radius: 9999px; }' > "$D/ok.css"
run_json "$D"
GOT=$(jread "$OUT" codes)
if [ "$RC" -eq 0 ] && [ -z "$GOT" ]; then r=0; else r=1; fi
chk "$r" "U5 角标 line-height:1 / 图标 0 / 48px 收字距 / 胶囊 9999px 一条都不许报（判据收窄后的防误伤地板）" \
    "rc=0 且 findings 为空" "rc=${RC}；codes=[$GOT]；warnings=$(jread "$OUT" warnings)"

# ---------------------------------------------------------------------------
# 逃逸口：有意为之的写 unslop-ignore，跳过并计入已豁免（不是悄悄不算）
# ---------------------------------------------------------------------------
D=$(newdir)
printf '%s\n' '/* unslop-ignore 品牌手册钉死的紫，改不了 */' ':root { --color-primary: #6366F1; }' > "$D/brand.css"
run_json "$D"
GOT=$(jread "$OUT" codes); EX=$(jread "$OUT" exempt)
if [ "$RC" -eq 0 ] && [ -z "$GOT" ] && [ "$EX" = "1" ]; then r=0; else r=1; fi
chk "$r" "U6 命中行上一行写 unslop-ignore：不报且 exempt 计 1（豁免要看得见，不然等于没设闸）" \
    "rc=0；findings 空；exempt=1" "rc=${RC}；codes=[$GOT]；exempt=$EX"

echo "  [NOTE] 未覆盖：真实前端项目（.tsx/.vue/styled-components）上的表现、TOO_MANY_COLORS/TOO_MANY_FAMILIES/CREAM_TERRACOTTA 三条文件级判据、块注释与跨行渐变的解析、--paths 多根去重。"

echo ""
echo "==== test-ui-slop-scan：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ]
