#!/usr/bin/env bash
# risk: high
# test-readable-db-pages.sh — 人读文档 · 数据库设计页面黑盒回归（docs/readable-spec/phase1-db-contract.md C 节）。
# 断言只从契约推导：每表一页、确定性、原子落盘、离线自成一体、动态定义提示、分组与切页。夹具合成表名，mktemp -d + --root。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-db-pages ====="
if ! command -v node >/dev/null 2>&1; then echo "SKIPPED: 无 node，未执行 != 通过。"; exit 0; fi
[ -f "$ENGINE" ] || { echo "  [FAIL] 缺被测脚本：$ENGINE" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
eq() {  # eq <标题> <EXPECT> <GOT>
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$1"; else FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; fi
  printf '         EXPECT %s\n         GOT    %s\n' "$2" "$3"
}
yn() { if "$@" >/dev/null 2>&1; then printf y; else printf n; fi; }
run() { RC=0; env -u CLAUDE_PROJECT_DIR ${2:+"$2"} node "$ENGINE" build --root "$1" >"$TMP/out" 2>"$TMP/err" || RC=$?; }
mk() {  # mk <root>：13 张互不引用的 big_NN、solo_one、orders、order_items（引用 orders），一个 DO 块点到 orders
  mkdir -p "$1/docs/readable-src" "$1/sql"; : >"$1/Product-Spec.md"
  printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["sql/s.sql"],"codeRoots":[],"ignore":[]}\n' >"$1/docs/readable-src/config.json"
  { for i in $(seq -w 1 13); do echo "CREATE TABLE big_$i (id int PRIMARY KEY, note text);"; done
    echo "CREATE TABLE solo_one (id int PRIMARY KEY);"; echo "CREATE TABLE orders (id int PRIMARY KEY);"
    echo "CREATE TABLE order_items (id int PRIMARY KEY, order_id int REFERENCES orders(id));"
    echo 'DO $$ BEGIN ALTER TABLE orders DROP CONSTRAINT IF EXISTS x; END $$;'; } >"$1/sql/s.sql"
}
tree() { (cd "$1" && find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-16); }
A="$TMP/p1"; mk "$A"; run "$A"; D="$A/docs/readable/db"
eq "夹具能 build（退出码 0）" "0" "$RC"
# 1 打死：漏表 / 多出表页 / 缺首页
EXP=$({ printf 'big_%s\n' $(seq -w 1 13); printf '%s\n' solo_one orders order_items; } | LC_ALL=C sort | tr '\n' ,)
GOT=$(ls "$D" 2>/dev/null | sed -n 's/^t-\(.*\)\.html$/\1/p' | LC_ALL=C sort | tr '\n' ,)
IDX=$(for f in index.html db/index.html; do [ -f "$A/docs/readable/$f" ] && printf y || printf n; done)
eq "每张表恰有一页 db/t-<表>.html、无多出来的表页，index.html 与 db/index.html 都在" "$EXP|yy" "$GOT|$IDX"
# 2 打死：页面写时间 / 机器名 / 绝对路径（不同目录名、不同时刻生成两遍）
B="$TMP/p2"; mk "$B"; sleep 1; run "$B"
DR=0; diff -r "$A/docs/readable" "$B/docs/readable" >"$TMP/diff" 2>&1 || DR=$?
eq "同一夹具放进两个不同目录各生成一遍，docs/readable 逐字节无差异" "0" "$DR$([ "$DR" = 0 ] || head -c 200 "$TMP/diff")"
# 4 打死：引外部资源 / 页面写夹具绝对路径（内联 SVG 的 xmlns 命名空间串不是联网，先剔掉）
EXT=$(find "$A/docs/readable" -type f -exec sed 's#xmlns="http://www.w3.org/2000/svg"##g' {} + | grep -ciE 'https?://|<link |<script src' || true)
ABS=$(grep -rlF "$TMP" "$A/docs/readable" | wc -l | tr -d ' ')
eq "产物里没有 http(s):// / <link / <script src，也没有夹具根目录的绝对路径" "0|0" "$EXT|$ABS"
# 5 打死：提示没挂、挂错表、或每页都挂
H=$(for t in orders order_items big_01 solo_one; do grep -q '要到库里运行时才生效' "$D/t-$t.html" 2>/dev/null && printf y || printf n; done)
eq "被未合并 DO 块点到的 orders 页有「这张表有」提示；order_items / big_01 / solo_one 没有" "ynnn" "$H"
# 6 打死：不切页 / 切出超过 12 张 / 切得不均 / 单表前缀不并进其它
cnt() { grep -oE 't-big_[0-9]+\.html' "$1" 2>/dev/null | sort -u | wc -l | tr -d ' '; }
a=$(cnt "$D/g-big-1.html"); b=$(cnt "$D/g-big-2.html"); u=$(cat "$D/g-big-1.html" "$D/g-big-2.html" 2>/dev/null | grep -oE 't-big_[0-9]+\.html' | sort -u | wc -l | tr -d ' ')
O=$([ -f "$D/g-_other.html" ] && grep -q 't-solo_one.html' "$D/g-_other.html" && ! ls "$D"/g-solo* >/dev/null 2>&1 && printf y || printf n)
eq "13 张表的前缀切成 g-big-1 / -2 两页：每页 ≤12、均分（差不超过 1）、合起来 13；单表前缀 solo 进 g-_other.html" "ok|y" "$([ "$a" -le 12 ] && [ "$b" -le 12 ] && [ "$u" = 13 ] && [ $((a + b)) = 13 ] && printf ok || printf "a=$a,b=$b,u=$u")|$O"
# 3 打死：边写边覆盖 / 失败留临时目录（先改来源让重出一遍会变，再注入失败；对照组不注入则整目录哈希确实变）
H0=$(tree "$A/docs/readable"); L0=$(ls -A "$A/docs"); echo 'CREATE TABLE zeta_new (id int);' >>"$A/sql/s.sql"
run "$A" READABLE_FAIL_AT=render; R3=$RC; H1=$(tree "$A/docs/readable"); L1=$(ls -A "$A/docs")
run "$A"; H2=$(tree "$A/docs/readable")
eq "READABLE_FAIL_AT=render：退出码 3、docs/readable 总哈希不变、docs 下无多出来的临时目录；对照组不注入则哈希会变" "3|same|same|differs" "$R3|$([ "$H0" = "$H1" ] && echo same || echo changed)|$([ "$L0" = "$L1" ] && echo same || echo "$L1")|$([ "$H1" != "$H2" ] && echo differs || echo same)"

# 7 打死：只差大小写的表名在不分大小写的文件系统上互相覆盖 / 文件名里留大写与中文
X="$TMP/p3"; mk "$X"; { echo 'CREATE TABLE "Orders" (id int PRIMARY KEY);'; echo 'CREATE TABLE pm (id int PRIMARY KEY);'; echo 'ALTER TABLE pm DROP CONSTRAINT IF EXISTS gone_x;'; echo 'CREATE TABLE qm (id int PRIMARY KEY);'; echo 'ALTER TABLE qm DROP CONSTRAINT IF EXISTS c1;'; echo 'ALTER TABLE qm ADD CONSTRAINT c1 CHECK (id > 0);'; } >>"$X/sql/s.sql"; run "$X"; E="$X/docs/readable/db"
OF=$(grep -lF 'data-anchor="table:Orders"' "$E"/t-*.html 2>/dev/null | xargs -r -n1 basename | tr '\n' ,)
eq "\"Orders\" 与 orders 各一页（共 19 张表页）：文件名不同，Orders 的页不叫 t-orders.html；db/ 下所有文件名只含小写字母、数字、下划线、连字符与 ~，且不分大小写也无重名" "0|19|ok|||" "$RC|$(ls "$E" | grep -c '^t-')|$([ -n "$OF" ] && [ "$OF" != t-orders.html, ] && echo ok || echo "OF=$OF")|$(ls "$E" | grep -vE '^[a-z0-9_~-]+\.html$' | tr '\n' ,)|$(ls "$E" | tr 'A-Z' 'a-z' | sort | uniq -d | tr '\n' ,)|"
# 8 打死：maybeDropped 的提示没挂 / 每页都挂 / 先删后加同名的也挂
eq "按名字删约束没对上的 pm 页有「这张表有 1 条按名字删约束的语句没对上任何约束」并列出 gone_x；先删后加同名的 qm、无关的 order_items 没有" "y|y|n|n" "$(yn grep -qF '这张表有 1 条按名字删约束的语句没对上任何约束' "$E/t-pm.html")|$(yn grep -qF gone_x "$E/t-pm.html")|$(yn grep -qF '按名字删约束' "$E/t-qm.html")|$(yn grep -qF '按名字删约束' "$E/t-order_items.html")"
# 9 打死：代码文件的行号写进页面（F 节）。代码第 23 行读 orders；对照：建表文件的行号照旧；顶上加三行空行重出，整个 docs/readable 总哈希不变
Y="$TMP/p4"; mk "$Y"; mkdir -p "$Y/app/api"; sed -i 's#"codeRoots":\[\]#"codeRoots":["app"]#' "$Y/docs/readable-src/config.json"
{ for i in $(seq 1 22); do echo "# pad $i"; done; echo '    cur.execute("SELECT id FROM orders WHERE id = 1")'; } >"$Y/app/api/report.py"
run "$Y"; P="$Y/docs/readable/db/t-orders.html"; HA=$(tree "$Y/docs/readable"); nd() { env -u CLAUDE_PROJECT_DIR node "$ENGINE" build --facts-json --root "$Y"; }
L0=$(nd 2>/dev/null | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(j.usage.orders.reads.map(r=>r.line).join())')
{ printf '\n\n\n'; cat "$Y/app/api/report.py"; } >"$Y/x.py"; mv "$Y/x.py" "$Y/app/api/report.py"; run "$Y"; HB=$(tree "$Y/docs/readable")
L1=$(nd 2>/dev/null | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(j.usage.orders.reads.map(r=>r.line).join())')
eq "表页「谁在读」有 app/api/report.py、整页无「第 23 行」、建表文件仍写「第 N 行」；代码顶上加三行后事实里的行号 23 变 26，而 docs/readable 总哈希不变" \
  "y|n|y|23>26|same" "$(sed "s#<wbr>##g" "$P" | grep -qF app/api/report.py && printf y || printf n)|$(yn grep -qF '第 23 行' "$P")|$(yn grep -qE '第 ?[0-9]+ ?行' "$P")|$L0>$L1|$([ "$HA" = "$HB" ] && echo same || echo changed)"
# 10 打死：字段表显示的列名、谁在写 / 谁在读显示的文件路径没有 data-k 格（核对器只能拿锚点配行，显示的字写错看不出来）/ 格里的字不是列名或路径
Q="$TMP/p5"; mk "$Q"; mkdir -p "$Q/app/api"; sed -i 's#"codeRoots":\[\]#"codeRoots":["app"]#' "$Q/docs/readable-src/config.json"
printf '%s\n' 'def f(cur):' '    cur.execute("SELECT id FROM orders")' >"$Q/app/api/report.py"; printf '%s\n' 'def g(cur):' '    cur.execute("INSERT INTO orders (id) VALUES (1)")' >"$Q/app/api/put.py"
run "$Q"; env -u CLAUDE_PROJECT_DIR node "$ENGINE" build --facts-json --root "$Q" >"$TMP/fq.json" 2>/dev/null || true
cat >"$TMP/cells.js" <<'EOF'
const fs=require('fs'),D=process.argv[2]+'/docs/readable/db/',f=JSON.parse(fs.readFileSync(process.argv[3]));
const tx=s=>s.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const cell=(row,k)=>{const o=[],re=new RegExp('<(\\w+)[^>]*\\sdata-k="'+k+'"[^>]*>','g');let m;while((m=re.exec(row))){const r2=new RegExp('<(/?)'+m[1]+'(?=[\\s>/])[^>]*>','g');r2.lastIndex=m.index+m[0].length;let d=1,x;while(d&&(x=r2.exec(row)))d+=x[1]?-1:1;o.push(tx(row.slice(m.index,r2.lastIndex)))}return o};
const bad=[],W=[],R=[];let n=0;
for(const t of f.tables){const h=fs.readFileSync(D+'t-'+t.name+'.html','utf8');for(const row of h.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)||[]){
 const a=row.match(/data-anchor="column:([^".]+)\.([^"]+)"/);if(a){n++;const c=cell(row,'name');if(c.length!=1||c[0]!=a[2])bad.push(a[1]+'.'+a[2]+'='+c.join('/'))}
 const w=row.match(/data-row="(writer|reader)"/);if(w){const c=cell(row,'file');if(c.length!=1)bad.push(t.name+':'+w[1]+':nofile');else(w[1]=='writer'?W:R).push(c[0])}}}
const cols=f.tables.reduce((a,t)=>a+t.columns.length,0);if(n!=cols)bad.push('rows='+n+'/cols='+cols);
console.log(bad.join(';')+'|'+W.join()+'|'+R.join());
EOF
eq "每张表页字段表每一行（共与事实里的列数相同）有 data-k=name 格、显示的字等于列名；orders 页「谁在写」那一行有 data-k=file 格显示 app/api/put.py、「谁在读」显示 app/api/report.py" "|app/api/put.py|app/api/report.py" "$(node "$TMP/cells.js" "$Q" "$TMP/fq.json")"

# 11 打死：ddl 里列了的代码文件里的表定义，出处带上了行号（代码一改行号就挪，页面白变）/ 矫枉过正，连 .sql 里的定义也不带行号了
K="$TMP/p6"; mk "$K"; mkdir -p "$K/app"; printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["sql/s.sql","app/emb.py"],"codeRoots":["app"],"ignore":[]}\n' >"$K/docs/readable-src/config.json"
printf '%s\n' 'import os' 'SQL = "CREATE TABLE emb_tbl (id int PRIMARY KEY)"' >"$K/app/emb.py"; run "$K"; RK=$RC
env -u CLAUDE_PROJECT_DIR node "$ENGINE" build --facts-json --root "$K" >"$TMP/fk.json" 2>/dev/null || true
EF=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const t=j.tables.find(x=>x.name=="emb_tbl");console.log(t?t.file+":"+t.line:"none")' "$TMP/fk.json")
PE="$K/docs/readable/db/t-emb_tbl.html"; PO="$K/docs/readable/db/t-orders.html"
eq "ddl 列了 app/emb.py 与 sql/s.sql：build 0、事实里 emb_tbl 的出处是 app/emb.py:2（行号确在事实里）；emb_tbl 页写出了 emb.py、整页无「第 N 行」；定义写在 .sql 里的 orders 页仍写「第 N 行」" "0|app/emb.py:2|y|n|y" \
  "$RK|$EF|$(sed 's#<wbr>##g' "$PE" 2>/dev/null | grep -qF emb.py && echo y || echo n)|$(yn grep -qE '第 ?[0-9]+ ?行' "$PE")|$(yn grep -qE '第 ?[0-9]+ ?行' "$PO")"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
