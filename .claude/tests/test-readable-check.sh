#!/usr/bin/env bash
# risk: high
# test-readable-check.sh — 人读文档 · 核对器 check 黑盒回归（docs/readable-spec/phase1-db-contract.md H 节，C 节「机器读得回来」）。
# 断言只从契约推导：生成后即一致；手改页面 / 来源变了没重出 / 缺页 / 多页 / 说明过期孤儿手改 / 指向不存在的；每个「该报」配「不该报」的对照。夹具合成表名，mktemp -d + --root。
# 落盘前自检用 READABLE_FAIL_AT=selfcheck 注入（H 节）；核对器 3 个以上格子独立读回、超 10 张截断、守 check 不 import 出页面的代码。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-check ====="
if ! command -v node >/dev/null 2>&1; then echo "SKIPPED: 无 node，未执行 != 通过。"; exit 0; fi
[ -f "$ENGINE" ] || { echo "  [FAIL] 缺被测脚本：$ENGINE" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
eq() {  # eq <标题> <EXPECT> <GOT>
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$1"; else FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; fi
  printf '         EXPECT %s\n         GOT    %s\n' "$2" "$3"
}
nd() { env -u CLAUDE_PROJECT_DIR node "$ENGINE" "$@"; }
bd() { RB=0; nd build --root "$1" >/dev/null 2>&1 || RB=$?; }                       # 生成，退出码进 RB
ck() { RC=0; nd check --json --root "$1" >"$TMP/f.json" 2>/dev/null || RC=$?; }     # 核对，JSON 进 f.json，退出码进 RC
jf() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=eval(process.argv[2]);console.log(typeof v==="object"?JSON.stringify(v):String(v))}catch(e){console.log("NOJSON")}' "$TMP/f.json" "$1"; }
hp() { [ "$(jf "j.problems.some(p=>p.kind=='$1'&&(p.where+' '+p.detail).includes('$2'))")" = true ] && printf y || printf n; }   # hp <kind> <点名子串>
kinds() { jf "[...new Set(j.problems.map(p=>p.kind))].sort().join(',')"; }
last() { nd check --root "$1" 2>&1 | tail -1; }                                      # 人读输出末行
put() { printf '%s' "$2" | nd note put --root "$1" >/dev/null 2>&1 || true; }
mk() {  # mk <root>：customers、orders（外键、默认值、来源注释）、order_items；map.json 一个组 order
  mkdir -p "$1/docs/readable-src" "$1/sql"; : >"$1/Product-Spec.md"
  printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["sql/s.sql"],"codeRoots":[],"ignore":[]}\n' >"$1/docs/readable-src/config.json"
  printf '{"version":1,"tableGroups":[{"id":"order","title":"订单与明细","tables":["orders","order_items"],"status":"proposed"}],"dynamicTables":[]}\n' >"$1/docs/readable-src/map.json"
  cat >"$1/sql/s.sql" <<'EOF'
CREATE TABLE customers (id int PRIMARY KEY, name text);
CREATE TABLE orders (
  id int PRIMARY KEY,
  customer_id int REFERENCES customers(id),
  status text DEFAULT 'new',
  memo text -- 备注
);
CREATE TABLE order_items (id int PRIMARY KEY, order_id int, qty int);
CREATE INDEX orders_status_idx ON orders (status);
EOF
}
yn() { if "$@" >/dev/null 2>&1; then printf y; else printf n; fi; }
tree() { (cd "$1" && find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-16); }
T() { echo "$1/docs/readable/db/$2"; }
NOTE='## table:orders
订单主表，一行一张订单。
'

# 1 对照：生成后什么都不动 → 0 条（所有后面各臂的对照）；假绿的另一面是误报，这条挡误报
A="$TMP/a1"; mk "$A"; bd "$A"; ck "$A"
eq "生成后不动：build 0、check 退出码 0、ok=true、problems 为空数组、summary 是对象；人读末行「不一致 0 条」" \
  "0|0|true|0|object|不一致 0 条" "$RB|$RC|$(jf j.ok)|$(jf j.problems.length)|$(jf 'typeof j.summary')|$(last "$A")"
# 6 没写说明的表不算不一致，摘要报数；写了一张后数字少一
N0=$(nd check --root "$A" 2>&1 | grep -oE '没写说明[^0-9]*[0-9]+' | grep -oE '[0-9]+$' | head -1 || true)
put "$A" "$NOTE"; bd "$A"; ck "$A"; N1=$(nd check --root "$A" 2>&1 | grep -oE '没写说明[^0-9]*[0-9]+' | grep -oE '[0-9]+$' | head -1 || true)
eq "没写说明的表不算不一致：摘要里报了「没写说明」的数（N0>0），写一张并生成后少 1，ok 仍 true、退出码 0" "y|y|0|true" \
  "$([ "${N0:-0}" -gt 0 ] && echo y || echo n)|$([ "${N0:-0}" -gt 0 ] && [ "${N1:-x}" = "$((N0 - 1))" ] && echo y || echo n)|$RC|$(jf j.ok)"

# 2 手改页面上类型 / 可空 / 默认三格之一：退出码 1，stale-page 点到那页，fact-mismatch 点到那一列；别的列不被点
G=""
for c in 'type|<code>text</code>|<code>varchar</code>' 'nullable|是|否' 'default|<code>\&#39;new\&#39;</code>|<code>\&#39;old\&#39;</code>'; do
  IFS='|' read -r k f t <<<"$c"; R="$TMP/b$k"; mk "$R"; bd "$R"
  sed -i "/data-anchor=\"column:orders.status\"/s|data-k=\"$k\">$f|data-k=\"$k\">$t|" "$(T "$R" t-orders.html)"; ck "$R"
  G="$G$RC$(hp stale-page t-orders)$(hp fact-mismatch column:orders.status)$(hp fact-mismatch column:orders.id),"
done
eq "手改一列的类型格 / 可空格 / 默认格：各退出码 1、stale-page 点到 t-orders、fact-mismatch 点到 column:orders.status、没改的 column:orders.id 不被点（只做逐文件比、不独立读页面的实现过不了）" \
  "1yyn,1yyn,1yyn," "$G"

# 3 来源变了没重出 → stale-page；重出后回到 0 条
R="$TMP/c"; mk "$R"; bd "$R"; echo 'ALTER TABLE orders ADD COLUMN extra int;' >>"$R/sql/s.sql"; ck "$R"; S1="$RC$(hp stale-page t-orders)"
bd "$R"; ck "$R"
eq "建表定义里给 orders 加一列不重出：退出码 1 且 stale-page 点到 t-orders；重出后退出码 0、problems 为空" "1y|0|0" "$S1|$RC|$(jf j.problems.length)"

# 4 缺页 / 多页：删一张表页 → missing-page；放一个多余的 t-ghost.html → extra-page（对照：重出后都消失）
R="$TMP/d"; mk "$R"; bd "$R"; rm "$(T "$R" t-customers.html)"; ck "$R"; M1="$RC$(hp missing-page t-customers)"
bd "$R"; printf '<!doctype html><title>x</title>' >"$(T "$R" t-ghost.html)"; ck "$R"; M2="$RC$(hp extra-page t-ghost)$(hp missing-page t-ghost)"
rm "$(T "$R" t-ghost.html)"; ck "$R"
eq "删 t-customers.html：退出码 1 且 missing-page 点到它；多放 t-ghost.html：extra-page 点到它、不被报成 missing-page；清掉后 0 条" "1y|1yn|0" "$M1|$M2|$RC"

# 5 说明：落说明并生成 → 0 条；改列让说明过期、重出 → note-stale；删表重出 → note-orphan；手改页面说明一个字 → note-mismatch
R="$TMP/e"; mk "$R"; put "$R" "$NOTE"; bd "$R"; ck "$R"; E0="$RC"
sed -i "s/memo text -- 备注/memo text, extra int -- 备注/;s/status text DEFAULT 'new'/status varchar DEFAULT 'new'/" "$R/sql/s.sql"; bd "$R"; ck "$R"; E1="$RC$(hp note-stale table:orders)"
sed -i '/^CREATE TABLE orders (/,/^);/d;/orders_status_idx/d' "$R/sql/s.sql"; bd "$R"; ck "$R"; E2="$RC$(hp note-orphan table:orders)$(hp note-stale table:orders)"
R="$TMP/f"; mk "$R"; put "$R" "$NOTE"; bd "$R"; ck "$R"; F0=$RC; sed -i 's/一行一张订单/一行一张订车/' "$(T "$R" t-orders.html)"; ck "$R"
eq "有说明且生成：0 条；改 orders 的列后重出：note-stale 点到 table:orders；删掉 orders 重出：note-orphan 点到它、不再报 stale（孤儿不是过期）；手改页面说明的一个字：note-mismatch 点到 table:orders" \
  "0|1y|1yn|0|1y" "$E0|$E1|$E2|$F0|$RC$(hp note-mismatch table:orders)"

# 7 map.json 一个组点到不存在的表：生成照常，check 有 dangling 且只有这一类（来源与页面都没变）
R="$TMP/g"; mk "$R"; sed -i 's/"order_items"\]/"order_items","ghost_tbl"]/' "$R/docs/readable-src/map.json"; bd "$R"; ck "$R"
eq "组里点到不存在的表 ghost_tbl：build 退出码 0；check 退出码 1，dangling 点到 ghost_tbl，别的类一个都没有" "0|1|y|dangling" "$RB|$RC|$(hp dangling ghost_tbl)|$(kinds)"

# 9 未合并的动态定义、运行时拼的表名：文档已明说读不出，不算不一致（先确认夹具里真有这两样）
R="$TMP/hout"; mk "$R"; mkdir -p "$R/app"; sed -i 's/"codeRoots":\[\]/"codeRoots":["app"]/' "$R/docs/readable-src/config.json"
printf 'def f(t):\n    return "SELECT count(*) FROM " + t\n' >"$R/app/x.py"
printf 'DO $$ BEGIN ALTER TABLE orders DROP CONSTRAINT IF EXISTS x; END $$;\n' >>"$R/sql/s.sql"
bd "$R"; nd build --facts-json --root "$R" >"$TMP/f.json" 2>/dev/null || true; FX="$(jf 'j.unfolded.length')|$(jf 'j.dynamic.length')"; ck "$R"
eq "夹具里有 1 处未合并的动态定义与 1 处运行时拼的表名；check 仍退出码 0、ok=true、problems 为空" "1|1|0|true|0" "$FX|$RC|$(jf j.ok)|$(jf j.problems.length)"

# 8 落盘前自检：注入 READABLE_FAIL_AT=selfcheck → 退出码 3、点名哪一页、原页面一个字节不动、docs 下无残留；对照：不注入则页面确实会变
R="$TMP/i"; mk "$R"; bd "$R"; H0=$(tree "$R/docs/readable"); L0=$(ls -A "$R/docs"); echo 'CREATE TABLE zeta (id int);' >>"$R/sql/s.sql"
RS=0; READABLE_FAIL_AT=selfcheck nd build --root "$R" >"$TMP/o" 2>&1 || RS=$?; H1=$(tree "$R/docs/readable"); L1=$(ls -A "$R/docs"); bd "$R"; H2=$(tree "$R/docs/readable")
eq "自检失败：退出码 3、输出点名某一页、docs/readable 总哈希不变、docs 下无临时目录；对照组不注入则哈希变、退出码 0" "3|y|same|same|differs|0" "$RS|$(yn grep -q '\.html' "$TMP/o")|$([ "$H0" = "$H1" ] && echo same || echo changed)|$([ "$L0" = "$L1" ] && echo same || echo "$L1")|$([ "$H1" != "$H2" ] && echo differs || echo same)|$RB"

# 8b 页面级兜底：READABLE_FAIL_AT=leak 让新出的一页带内网地址 → 退出码 3、点名某一页、原页面不动、docs 下无残留；对照：不注入则退出码 0
R="$TMP/l"; mk "$R"; bd "$R"; H0=$(tree "$R/docs/readable"); L0=$(ls -A "$R/docs"); echo 'CREATE TABLE zeta (id int);' >>"$R/sql/s.sql"
RS=0; READABLE_FAIL_AT=leak nd build --root "$R" >"$TMP/o" 2>&1 || RS=$?; H1=$(tree "$R/docs/readable"); L1=$(ls -A "$R/docs"); bd "$R"
eq "漏隐兜底：退出码 3、输出点名某一页、docs/readable 总哈希不变、docs 下无临时目录；对照组不注入则退出码 0" "3|y|same|same|0" "$RS|$(yn grep -q '\.html' "$TMP/o")|$([ "$H0" = "$H1" ] && echo same || echo changed)|$([ "$L0" = "$L1" ] && echo same || echo "$L1")|$RB"

# 9 页面读取器要独立读到别的格子：手改 ref 格 / 删一行约束 / 删一行读它的文件，各被 fact-mismatch 点到；没改的 t-customers 不被点（对照）
mkr() { mk "$1"; mkdir -p "$1/app"; printf 'q = "SELECT id FROM orders"\n' >"$1/app/r.py"; sed -i 's/"codeRoots":\[\]/"codeRoots":["app"]/' "$1/docs/readable-src/config.json"; echo 'ALTER TABLE orders ADD CONSTRAINT orders_pos CHECK (id > 0);' >>"$1/sql/s.sql"; }
G=""
for c in 'ref|column:orders.customer_id' 'constraint|orders' 'reader|orders'; do
  k=${c%%|*}; R="$TMP/m$k"; mkr "$R"; bd "$R"; P=$(T "$R" t-orders.html); B0=$(md5sum <"$P"); N0=$(wc -l <"$P")
  if [ "$k" = ref ]; then perl -i -pe 's|(data-anchor="column:orders\.customer_id".*?data-k="ref"[^>]*>).*?(</td>)|$1<a href="t-customers.html">customers</a> (name)$2|' "$P"
  else sed -i "0,/data-row=\"$k\"/{/data-row=\"$k\"/d}" "$P"; fi
  ck "$R"; G="$G$RC$(hp fact-mismatch "${c#*|}")$(hp stale-page t-customers)$([ "$B0" != "$(md5sum <"$P")" ] && echo d || echo s)$((N0 - $(wc -l <"$P"))),"
done
eq "手改 ref 格 / 删 constraint 行 / 删 reader 行（d=页面确实被改，数字=少了几行）：各退出码 1、fact-mismatch 点到那页（ref 点到那一列）、没改的 t-customers 不被 stale-page 点" "1ynd0,1ynd1,1ynd1," "$G"

# 10 不是现行的页超过 10 张：人读输出只列前 10 张并写「另有」，--json 里全在
R="$TMP/j"; mk "$R"; for i in $(seq 1 14); do echo "CREATE TABLE tt_$i (id int);" >>"$R/sql/s.sql"; done; bd "$R"
{ echo; cat "$R/sql/s.sql"; } >"$TMP/s2" && mv "$TMP/s2" "$R/sql/s.sql"; ck "$R"; NS=$(jf "j.problems.filter(p=>p.kind=='stale-page').length"); nd check --root "$R" >"$TMP/human-out.txt" 2>&1 || true
eq "建表文件靠前加一空行、17 张表页都变：--json 里 stale-page 多于 10 条；人读输出点名页面的行不超过 10 行且有「另有」" "y|y|y" "$([ "$NS" -gt 10 ] && echo y || echo "ns=$NS")|$([ "$(grep -c '\.html' "$TMP/human-out.txt")" -le 10 ] && echo y || echo "lines=$(grep -c '\.html' "$TMP/human-out.txt")")|$(yn grep -q '另有' "$TMP/human-out.txt")"

# 11 守架构禁边：第 2 项（check-read 等）不许 import 出页面的代码，只读 import 行
IMP=$(for f in "$(dirname "$ENGINE")"/readable/check*.mjs; do grep -nE "(from|import\(|require\()[[:space:]]*['\"][^'\"]*render/" "$f" | sed "s|^|$(basename "$f"):|" || true; done)
eq "readable/check*.mjs 里带 render/ 的行没有 import（架构禁边；有命中则点出哪个文件哪一行）" "" "$IMP"

# 12 上一次被杀留下的临时目录：docs/.readable-tmp-99999 在 build 之后不在了，页面照常落盘
R="$TMP/k"; mk "$R"; bd "$R"; mkdir -p "$R/docs/.readable-tmp-99999"; echo x >"$R/docs/.readable-tmp-99999/f"; bd "$R"
eq "预放 docs/.readable-tmp-99999：build 退出码 0、它不在了、docs/readable/index.html 在" "0|n|y" "$RB|$(yn test -e "$R/docs/.readable-tmp-99999")|$(yn test -f "$R/docs/readable/index.html")"
# 13 打死：核对器只比 data-row / 锚点配行、不比显示的字——字段表显示的列名、「谁在读」显示的文件路径写错，check 照报 0 条（审查在架构页上用三处突变实测出同一类假绿）
cat >"$TMP/mutcell.js" <<'EOF'
// 用法：node mutcell.js <页面> <行起始正则> <data-k> <旧文> <新文>：在匹配的那一行里，把该 data-k 格内文字的第一处旧文改成新文，属性不动
const fs=require('fs'),[p,rowRe,k,a,b]=process.argv.slice(2),h=fs.readFileSync(p,'utf8');
const row=(h.match(new RegExp('<tr\\b[^>]*'+rowRe+'[^>]*>[\\s\\S]*?</tr>'))||[])[0];if(!row){console.log('NOROW');process.exit()}
const c=row.match(new RegExp('<(\\w+)([^>]*\\sdata-k="'+k+'"[^>]*)>([\\s\\S]*?)</\\1>'));if(!c){console.log('NOCELL');process.exit()}
if(!c[3].includes(a)){console.log('NOTEXT');process.exit()}
fs.writeFileSync(p,h.replace(row,()=>row.replace(c[0],()=>c[0].replace(c[3],()=>c[3].replace(a,b)))));
EOF
G=""
for c in 'column:orders.status|data-anchor="column:orders.status"|name|status|statuz|column:orders.status' 'reader|data-row="reader"|file|app|apq|orders'; do
  IFS='|' read -r tag rre k a b pt <<<"$c"; R="$TMP/n$k"; mkr "$R"; bd "$R"
  M=$(node "$TMP/mutcell.js" "$(T "$R" t-orders.html)" "$rre" "$k" "$a" "$b"); ck "$R"
  G="$G$M$RC$(hp fact-mismatch "$pt")$(hp stale-page t-customers),"
done
eq "手改：orders 页 status 那一列显示的列名改一个字（锚点不动）/ 「谁在读」那行显示的文件路径改一个字（data-row 不动）：各退出码 1、fact-mismatch 点到那一列 / 那张表、没改的 t-customers 不被 stale-page 点（NOROW、NOCELL 表示页面上没有这个读回标记）" "1yn,1yn," "$G"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
