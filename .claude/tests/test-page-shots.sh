#!/usr/bin/env bash
# risk: high
# test-page-shots.sh — 看页面脚本（scripts/page-shots.mjs）的黑盒回归。契约：
#   docs/readable-spec/phase1-db-contract.md I 节第 12 条。
#
# 契约要点：node page-shots.mjs <目录> <页面…> [--out d] [--width 1280] [--segment 1400] [--json]
#   CHROME_PATH 设了只用它（不存在即算没有）→ 退出码 3、stderr 一行含「缺席」、一张图不出——
#   没看成却报看过是最贵的错，所以这条不需要浏览器，任何机器都跑；
#   用法不对 / 目录不在 / 页面不在 / `../` 越出 → 退出码 2；先校验再截，不留半截结果；
#   有浏览器时：按 --segment 切段（张数 = ceil(高度/段高)）、overflowX 判横向溢出、
#   图名 = 页面路径 `/`→`_` + 段号、只读被看目录、退出后不留浏览器进程。
# 跑不成的路径（本机无任何浏览器）走 SKIPPED 并计数，不算 PASS 也不算 FAIL：「未执行 != 通过」。
# 不测像素内容。
# 用法：bash test-page-shots.sh [page-shots.mjs 路径]
set -u

SRC=$(cd "$(dirname "$0")/.." && pwd)
SHOTS=${1:-"$SRC/scripts/page-shots.mjs"}
case "$SHOTS" in /*) ;; *) SHOTS="$PWD/$SHOTS" ;; esac

echo "===== test-page-shots ====="
command -v node >/dev/null 2>&1 || {
    echo 'SKIPPED: 无 node——被测脚本是 .mjs，未执行 != 通过。'
    exit 0
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0; SKIP=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
skip() { SKIP=$((SKIP + 1)); echo "  [SKIPPED] $1"; }
chk() {
    if [ "$1" -eq 0 ]; then pass "$2"; else fail "$2"; fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}
contains() { case "$2" in *"$1"*) return 0 ;; *) return 1 ;; esac; }
brief() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-200 | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null; }
count_files() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }

# 找一个真浏览器：先 Playwright 缓存，再 PATH。找不到则有浏览器的几条全 SKIPPED。
BROWSER=""
for c in "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome; do
    [ -x "$c" ] && BROWSER="$c" && break
done
if [ -z "$BROWSER" ]; then
    for n in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
        p=$(command -v "$n" 2>/dev/null) && [ -n "$p" ] && BROWSER="$p" && break
    done
fi
echo "  [ENV] 浏览器=${BROWSER:-无}"

SITE="$TMP/site"; mkdir -p "$SITE/sub"
H='<!doctype html><html><head><meta charset="utf-8"><title>t</title></head>'
printf '%s<body style="margin:0"><div style="height:5000px;background:#eee">tall</div></body></html>\n' "$H" > "$SITE/tall.html"
printf '%s<body style="margin:0"><div style="width:3000px;height:50px;background:#ccc">wide</div></body></html>\n' "$H" > "$SITE/wide.html"
printf '%s<body style="margin:0"><p>正常页</p></body></html>\n' "$H" > "$SITE/sub/a.html"

RC=0; STDOUT=""; STDERR=""
# run <CHROME_PATH 值> 参数…；在 $TMP 下跑，结果落 RC/STDOUT/STDERR
run() {
    local cp=$1; shift
    (cd "$TMP" && CHROME_PATH="$cp" node "$SHOTS" "$@") > "$TMP/o" 2> "$TMP/e"
    RC=$?; STDOUT=$(cat "$TMP/o"); STDERR=$(cat "$TMP/e")
}

# 无真浏览器时用一个存在的假可执行文件，让用法错的校验不被「缺席」抢先
STUB="$TMP/fake-chrome"; printf '#!/bin/sh\nexit 1\n' > "$STUB"; chmod +x "$STUB"
CP_OK=${BROWSER:-$STUB}

# P1 缺席不冒充看过（任何机器都跑）
run "$TMP/no-such-chrome" "$SITE" tall.html --out "$TMP/o1"
n=$(count_files "$TMP/o1")
ok=1
[ "$RC" -eq 3 ] || ok=0
contains '缺席' "$STDERR" || ok=0
[ "$n" -eq 0 ] || ok=0
contains '截了' "$STDOUT" && ok=0
if [ "$ok" -eq 1 ]; then r=0; else r=1; fi
chk "$r" "P1 CHROME_PATH 指向不存在文件 → rc 3、stderr 含「缺席」、--out 无图、stdout 不报「截了」" \
    "rc=3；stderr 含「缺席」；文件数 0；stdout 无「截了」" "rc=${RC}；文件数=${n}；stderr：$(brief "$STDERR")；stdout：$(brief "$STDOUT")"

# P2 用法错各退出码 2
bad=""
printf '<p>outside</p>' > "$TMP/outside.html"
run "$CP_OK";                                         [ "$RC" -eq 2 ] || bad="$bad 没给目录(rc=$RC)"
run "$CP_OK" "$TMP/nodir" tall.html;                  [ "$RC" -eq 2 ] || bad="$bad 目录不存在(rc=$RC)"
run "$CP_OK" "$SITE";                                 [ "$RC" -eq 2 ] || bad="$bad 没给页面(rc=$RC)"
run "$CP_OK" "$SITE" nope.html --out "$TMP/o2";       [ "$RC" -eq 2 ] || bad="$bad 页面不在(rc=$RC)"
run "$CP_OK" "$SITE" ../outside.html --out "$TMP/o2"; [ "$RC" -eq 2 ] || bad="$bad 越出目录(rc=$RC)"
run "$TMP/no-such-chrome" "$SITE" nope.html --out "$TMP/o2"; [ "$RC" -eq 2 ] || bad="$bad 缺席且用法错(rc=$RC，应 2 不被 3 盖住)"
if [ -z "$bad" ]; then r=0; else r=1; fi
chk "$r" "P2 用法错（无目录 / 目录不在 / 无页面 / 页面不在 / ../ 越出 / CHROME_PATH 不存在且页面不在）各 rc 2" \
    "六种情形都是 rc 2（用法检查先于找浏览器）" "不符：${bad:-无}"

# P8 点名两页、一页不存在 → rc 2，一张图都不出（先校验再截）
run "$CP_OK" "$SITE" tall.html nope.html --out "$TMP/o8"
n=$(count_files "$TMP/o8")
if [ "$RC" -eq 2 ] && [ "$n" -eq 0 ]; then r=0; else r=1; fi
chk "$r" "P8 点名两页、其一不存在 → rc 2 且不留半截图" "rc=2；文件数 0" "rc=${RC}；文件数=${n}"

# ---- 以下要真浏览器 ----
if [ -z "$BROWSER" ]; then
    for t in "P3 切段张数 / PNG 头 / --json 与磁盘一致" "P4 overflowX 判定" "P5 图名 sub_a" "P6 被看目录只读" "P7 无残留浏览器进程" "P9 脚本被强杀浏览器自退" "P10 长临时目录路径起得来"; do
        skip "$t：本机无浏览器，未执行 != 通过"
    done
else
    sums() { (cd "$SITE" && find . | sort && find . -type f | sort | xargs sha256sum); }
    sums > "$TMP/before.txt"
    # 残留进程判据：跑前跑后 cmdline 含 remote-debugging 的 pid 集合，只看「新出现且仍在」的
    pgrep -f 'remote-debugging' 2>/dev/null | sort > "$TMP/pids.before"
    run "$BROWSER" "$SITE" tall.html wide.html sub/a.html --out "$TMP/out" --segment 1400 --json
    RUNRC=$RC
    sleep 2
    pgrep -f 'remote-debugging' 2>/dev/null | sort > "$TMP/pids.after"
    sums > "$TMP/after.txt"
    printf '%s' "$STDOUT" > "$TMP/run.json"

    # 一次 node 解析，每页一行：page|height|overflowX|json段数|磁盘存在数|合法PNG数
    node -e '
      const fs=require("fs"),path=require("path");
      let j; try{ j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }catch(e){ console.log("BADJSON"); process.exit(0); }
      const sig=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
      for(const p of j.pages||[]){
        const segs=p.segments||[]; let ex=0,good=0;
        for(const s of segs){ const f=path.resolve(process.argv[2],s);
          if(fs.existsSync(f)){ ex++; const b=fs.readFileSync(f); if(b.length>64 && b.subarray(0,8).equals(sig)) good++; } }
        console.log([p.page,p.height,p.overflowX,segs.length,ex,good].join("|"));
      }' "$TMP/run.json" "$TMP" > "$TMP/facts.txt" 2>&1
    facts=$(cat "$TMP/facts.txt")
    fact_of() { grep -F "$1|" "$TMP/facts.txt" | head -1; }

    # P3 切段
    IFS='|' read -r _ h _ sj ex good <<< "$(fact_of tall.html)"
    exp=$(( (5000 + 1399) / 1400 ))
    disk=$(find "$TMP/out" -type f -name '*tall*' 2>/dev/null | wc -l | tr -d ' ')
    hi=${h%.*}
    ok=1
    [ "$RUNRC" -eq 0 ] || ok=0
    { [ "${sj:-x}" = "$exp" ] && [ "${ex:-x}" = "$exp" ] && [ "${good:-x}" = "$exp" ] && [ "$disk" = "$exp" ]; } || ok=0
    case "${hi:-}" in ''|*[!0-9]*) ok=0 ;; *) [ $(( hi - 5000 )) -le 1000 ] && [ $(( 5000 - hi )) -le 1000 ] || ok=0 ;; esac
    if [ "$ok" -eq 1 ]; then r=0; else r=1; fi
    chk "$r" "P3 5000px 页 --segment 1400：张数 = ceil(高/1400) = $exp，全是合法 PNG，--json 的 segments 数 = 磁盘文件数，height 与实高差 ≤ 一屏" \
        "rc=0；json 段数=磁盘数=合法 PNG 数=$exp" "rc=${RUNRC}；height=${h:-?} json段=${sj:-?} 存在=${ex:-?} 合法PNG=${good:-?} 磁盘=${disk}；facts：$(brief "$facts")；stderr：$(brief "$STDERR")"

    # P4 overflowX
    wo=$(fact_of wide.html | cut -d'|' -f3); no=$(fact_of sub/a.html | cut -d'|' -f3)
    if [ "$wo" = "true" ] && [ "$no" = "false" ]; then r=0; else r=1; fi
    chk "$r" "P4 内容比窗口宽的页 overflowX=true，正常页 false" "wide=true normal=false" "wide=${wo:-?} normal=${no:-?}"

    # P5 图名
    names=$(find "$TMP/out" -type f 2>/dev/null | sed "s|.*/||" | sort | tr '\n' ' ')
    if find "$TMP/out" -type f -name '*sub_a*' | grep -q .; then r=0; else r=1; fi
    chk "$r" "P5 sub/a.html 的图名含 sub_a（/ 换成 _）" "有名含 sub_a 的图" "图名：$names"

    # P6 只读
    if cmp -s "$TMP/before.txt" "$TMP/after.txt"; then r=0; else r=1; fi
    chk "$r" "P6 被看目录跑前跑后文件清单与内容哈希不变" "清单与哈希一致" "$(diff "$TMP/before.txt" "$TMP/after.txt" 2>&1 | head -3 | tr '\n' ' ')"

    # P7 无残留进程：跑前没有、跑完 2 秒后仍在的 remote-debugging 进程即残留
    left=$(comm -13 "$TMP/pids.before" "$TMP/pids.after" | tr '\n' ' ')
    if [ -z "${left// /}" ]; then r=0; else r=1; fi
    chk "$r" "P7 跑完没有残留的浏览器进程（判据：跑前跑后 pgrep -f remote-debugging 的 pid 差集）" "新增残留 pid 为空" "残留：${left:-无}"

    # P9 脚本被 kill -9（只杀那一个进程），浏览器自己在 10 秒内退。
    #   判据：浏览器的 --user-data-dir 路径（从它命令行里取）；pgrep -f 该路径得到该浏览器全部进程（含子进程）。
    #   动手时机：等浏览器就绪（<用户数据目录>/DevToolsActivePort 出现 = 调试端口起来了）而不是进程出现——
    #   浏览器要走到读调试管道那一步才发现管道断了，冷启动慢的机器上这一步来得晚，早动手是假红。最长等 60 秒。
    HS="$TMP/hangsite"; mkdir -p "$HS"
    printf '%s<body><script>while(true){}</script></body></html>\n' "$H" > "$HS/hang.html"
    pgrep -f 'remote-debugging' 2>/dev/null | sort > "$TMP/p9.before"
    CHROME_PATH="$BROWSER" node "$SHOTS" "$HS" hang.html --out "$TMP/o9" >/dev/null 2>&1 &
    SPID=$!
    UD=""; READY=0; i=0
    while [ "$i" -lt 600 ] && [ "$READY" -eq 0 ]; do
        if [ -z "$UD" ]; then
            for q in $(pgrep -f 'remote-debugging' 2>/dev/null); do
                grep -qx "$q" "$TMP/p9.before" && continue
                UD=$(tr '\0' ' ' < "/proc/$q/cmdline" 2>/dev/null | sed -n 's/.*--user-data-dir=\([^ ]*\).*/\1/p' | head -1)
                [ -n "$UD" ] && break
            done
        fi
        if [ -n "$UD" ] && [ -f "$UD/DevToolsActivePort" ]; then READY=1; else sleep 0.1; fi
        i=$((i + 1))
    done
    if [ "$READY" -eq 0 ]; then
        kill -9 "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null
        if [ -n "$UD" ]; then
            for q in $(pgrep -f -- "--user-data-dir=$UD" 2>/dev/null); do kill -9 "$q" 2>/dev/null; done
            case "$UD" in */page-shots-*) rm -rf "$UD" ;; esac
        fi
        skip "P9 脚本被强杀浏览器自退：60 秒内浏览器没就绪，没法验"
    else
        sleep 1   # 让被测脚本连上并开始导航那页死循环的页面
        kill -9 "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null
        t=0; alive=""
        while [ "$t" -lt 50 ]; do
            alive=$(pgrep -f -- "--user-data-dir=$UD" 2>/dev/null | tr '\n' ' ')
            [ -z "${alive// /}" ] && break
            sleep 0.2; t=$((t + 1))
        done
        if [ -z "${alive// /}" ]; then r=0; else r=1; fi
        chk "$r" "P9 脚本被 kill -9（单个进程），10 秒内它起的浏览器全部自己退出" "浏览器就绪后强杀，10 秒内无存活进程" "存活 pid：${alive:-无}；用户数据目录：$UD"
        for q in $alive; do kill -9 "$q" 2>/dev/null; done   # 按记下的 pid 收，不按名字杀
        case "$UD" in */page-shots-*) rm -rf "$UD" ;; esac   # 强杀后没人能收（契约写明）
    fi

    # P10 TMPDIR 路径 80+ 字符也起得来
    LONGT="$TMP/$(printf 'd%.0s' $(seq 1 80))"; mkdir -p "$LONGT"
    (cd "$TMP" && TMPDIR="$LONGT" CHROME_PATH="$BROWSER" node "$SHOTS" "$SITE" sub/a.html --out "$TMP/o10") > "$TMP/o" 2> "$TMP/e"
    RC=$?; STDERR=$(cat "$TMP/e")
    f=$(find "$TMP/o10" -type f -name '*.png' 2>/dev/null | head -1)
    sig=""; [ -n "$f" ] && sig=$(head -c 8 "$f" | od -An -tx1 | tr -d ' \n')
    if [ "$RC" -eq 0 ] && [ "$sig" = "89504e470d0a1a0a" ] && [ "$(wc -c < "$f")" -gt 64 ]; then r=0; else r=1; fi
    chk "$r" "P10 TMPDIR 路径 ${#LONGT} 字符：退出码 0 且出一张合法 PNG" "rc=0；PNG 头 89504e470d0a1a0a" "rc=${RC}；图=${f:-无}；头=${sig:-?}；stderr：$(brief "$STDERR")"
    case "$BROWSER" in *headless_shell*) echo "  [NOTE] P10 找到的是 headless shell，它不受路径长度影响，对旧代码也会绿。" ;; esac
    rm -rf "$LONGT"
    echo "  [NOTE] P7 只抓带 remote-debugging 参数的进程；临时用户数据目录是否删净本套件没验。"
fi

echo "  [NOTE] 未覆盖：截图像素内容、单页导航超 30 秒的退出码 1、--width 参数效果、CHROME_PATH 未设时的自动查找顺序。"
echo ""
echo "==== test-page-shots：PASS=$PASS FAIL=$FAIL SKIPPED=$SKIP ===="
[ "$FAIL" -eq 0 ] || exit 1
[ "$SKIP" -eq 0 ] || exit 3
exit 0
