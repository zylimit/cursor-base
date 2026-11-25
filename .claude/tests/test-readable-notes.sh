#!/usr/bin/env bash
# risk: high
# test-readable-notes.sh — 人读文档 · 说明的落盘、指纹与待更新黑盒回归（docs/readable-spec/phase1-db-contract.md G 节）。
# 断言只从契约推导：整批原子、指纹只由命令算、指纹绑切片、孤儿、确认、删除、待补清单、落盘确定性、页面读回标记。夹具合成表名，mktemp -d + --root。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-notes ====="
if ! command -v node >/dev/null 2>&1; then echo "SKIPPED: 无 node，未执行 != 通过。"; exit 0; fi
[ -f "$ENGINE" ] || { echo "  [FAIL] 缺被测脚本：$ENGINE" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
eq() {  # eq <标题> <EXPECT> <GOT>
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$1"; else FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; fi
  printf '         EXPECT %s\n         GOT    %s\n' "$2" "$3"
}
nd() { env -u CLAUDE_PROJECT_DIR node "$ENGINE" "$@"; }
put() { RC=0; printf '%s' "$2" | nd note put --root "$1" >"$TMP/o" 2>&1 || RC=$?; }   # put <root> <输入文本>
facts() { nd build --facts-json --root "$1" >"$TMP/f.json" 2>/dev/null || true; }
jf() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=eval(process.argv[2]);console.log(typeof v==="object"?JSON.stringify(v):String(v))}catch(e){console.log("NOJSON")}' "$TMP/f.json" "$1"; }
pj() { PR=0; nd pending --json --root "$1" >"$TMP/f.json" 2>/dev/null || PR=$?; }   # pending --json 落进 f.json，jf 按键取
st() { jf "(n=>n?n.status+'/'+n.state:'absent')(j.notes['$1'])"; }
tree() { if [ -d "$1" ]; then (cd "$1" && find . -type f | LC_ALL=C sort | xargs -r sha256sum | sha256sum | cut -c1-16); else echo none; fi; }
yn() { if "$@" >/dev/null 2>&1; then printf y; else printf n; fi; }
mk() {  # mk <root>：customers、orders（外键 customer_id、默认值列 status、带来源注释的 memo）、order_items，一个索引，map.json 分组 order
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
NOTES() { echo "$1/docs/readable-src/notes"; }
TO="## table:orders
订单主表，一行一张订单。
"
CS="## column:orders.status
订单状态。
"

# 1 打死：不落盘 / 落错路径 / 指纹没写进文件 / 状态不是 draft / 列的说明丢了
R="$TMP/a1"; mk "$R"; put "$R" "$TO
$CS"; facts "$R"; F="$(NOTES "$R")/table/orders.md"
eq "put 两段（表+列）：退出码 0；notes 里两个锚点都是 draft/current；table/orders.md 带 fp=十二位十六进制、status=draft 与列的小节" \
  "0|draft/current|draft/current|yyy" "$RC|$(st table:orders)|$(st column:orders.status)|$(yn grep -qE 'fp=[0-9a-f]{12}' "$F")$(yn grep -q 'status=draft' "$F")$(yn grep -qF '## column:orders.status' "$F")"

# 2 打死：能落的先落（有一段锚点不存在，整批不落盘）
R="$TMP/a2"; mk "$R"; put "$R" "## table:customers
客户。
"; B0=$(yn test -f "$(NOTES "$R")/table/customers.md"); H0=$(tree "$(NOTES "$R")")
put "$R" "$TO
## column:orders.nope
不存在的列。
"; H1=$(tree "$(NOTES "$R")")
eq "一批里有一段锚点不存在：退出码 2、notes 目录哈希不变、合法的那段也没落盘、输出点名 column:orders.nope（基线已落一份）" \
  "y|2|same|n|y" "$B0|$RC|$([ "$H0" = "$H1" ] && echo same || echo changed)|$(yn test -f "$(NOTES "$R")/table/orders.md")|$(yn grep -qF 'column:orders.nope' "$TMP/o")"

# 3 打死：让写的人自带指纹 / 放过内网地址与口令 / 放过空正文（每条都拒、不落盘；末尾正常 put 作对照）
R="$TMP/a3"; mk "$R"; G=""
for body in "订单。
<!-- readable-docs: fp=000000000000 status=reviewed -->" "服务在 10.1.2.3 上。" "配置 password=abcd1234efgh 即可。" "配置 secret=abcdefghijklmnop 即可。" ""; do
  put "$R" "## table:orders
$body
"; G="$G$RC"; done
N0=$(yn test -e "$(NOTES "$R")/table/orders.md"); put "$R" "$TO"
eq "自带 readable-docs 指纹、正文含 10.1.2.3、含 password=带数字八位以上、含 secret= 十六位纯字母、正文为空：各退出码 2 且无落盘；干净正文对照 put 退出码 0" "22222|n|0" "$G|$N0|$RC"
R="$TMP/a3b"; mk "$R"; put "$R" "## table:orders
订单主表。token: refreshes the login session
"
eq "正常英文说明 token: refreshes the login session 不被当密钥拒收（防过严的误杀）：退出码 0、已落盘" "0|y" "$RC|$(yn test -f "$(NOTES "$R")/table/orders.md")"

# 4 打死：绑整张表 / 什么都不绑 / 列绑错（加索引、改默认值不让表过期；改默认值只让那一列过期；加列让表过期）
R="$TMP/a4"; mk "$R"; put "$R" "$TO
$CS
## column:orders.memo
备注字段。
"; facts "$R"; S0="$(st table:orders)|$(st column:orders.status)|$(st column:orders.memo)"
echo 'CREATE INDEX orders_memo_idx ON orders (memo);' >>"$R/sql/s.sql"; sed -i "s/DEFAULT 'new'/DEFAULT 'open'/" "$R/sql/s.sql"
facts "$R"; S1="$(st table:orders)|$(st column:orders.status)|$(st column:orders.memo)"
pj "$R"; PS="$PR|$(jf "j.tables.flatMap(t=>t.stale).map(s=>s.anchor+'='+s.text.trim()).join(',')")"
echo 'ALTER TABLE orders ADD COLUMN extra int;' >>"$R/sql/s.sql"; facts "$R"
eq "加索引+改默认值：表说明与别的列仍 current、改了默认值的列 stale；再加列：表说明 stale" \
  "draft/current|draft/current|draft/current;draft/current|draft/stale|draft/current;draft/stale" "$S0;$S1;$(st table:orders)"
eq "有过期说明时 pending --json 退出码 0，tables[].stale 恰是过期列的锚点与旧正文" "0|column:orders.status=订单状态。" "$PS"

# 5 打死：来源里删了表，说明还留在 notes / 孤儿丢了正文 / pending 不列孤儿
R="$TMP/a5"; mk "$R"; put "$R" "## table:order_items
明细行，一行一个商品。
"; facts "$R"; P0=$(st table:order_items)
sed -i '/CREATE TABLE order_items/d' "$R/sql/s.sql"; facts "$R"; O5=$(jf "j.orphanNotes.map(o=>o.anchor+'='+o.text.trim()).join(',')"); O6=$(st table:order_items); pj "$R"
eq "表被删后：说明不在 notes、在 orphanNotes（带正文）；pending --json 列出孤儿锚点与正文" \
  "draft/current|absent|table:order_items=明细行，一行一个商品。|0|table:order_items=明细行，一行一个商品。" "$P0|$O6|$O5|$PR|$(jf "j.orphans.map(o=>o.anchor+'='+o.text.trim()).join(',')")"

# 6 打死：confirm 不记人与日期 / 指纹对不上也确认 / 重新 put 后仍是 reviewed
R="$TMP/a6"; mk "$R"; put "$R" "$TO
$CS"; RC1=0; nd note confirm table:orders --by 张三 --root "$R" >/dev/null 2>&1 || RC1=$?; facts "$R"
V1=$(jf "(n=>n.status+'/'+n.by+'/'+n.on)(j.notes['table:orders'])")
sed -i "s/DEFAULT 'new'/DEFAULT 'open'/" "$R/sql/s.sql"; RC2=0; nd note confirm column:orders.status --by 张三 --root "$R" >"$TMP/o" 2>&1 || RC2=$?; facts "$R"
V2=$(st column:orders.status); put "$R" "$TO"; facts "$R"
eq "confirm 指纹对得上：退出码 0、reviewed/张三/当天；指纹对不上：退出码 1、仍是 draft/stale；重新 put 同锚点回到 draft（by 为 null）" \
  "0|reviewed/张三/$(date +%F)|1|draft/stale|draft/current/null" \
  "$RC1|$V1|$RC2|$V2|$(jf "(n=>n.status+'/'+n.state+'/'+n.by)(j.notes['table:orders'])")"

# 7 打死：drop 不删 / 删光后留空文件 / 误删同文件里别的说明
R="$TMP/a7"; mk "$R"; put "$R" "$TO
$CS
## table:customers
客户。
"; N="$(NOTES "$R")/table"; D0=$(yn test -f "$N/customers.md")$(yn test -f "$N/orders.md")
nd note drop table:customers --root "$R" >/dev/null 2>&1 || true; facts "$R"; A1="$(st table:customers)|$(st table:orders)|$(yn test -e "$N/customers.md")"
nd note drop table:orders column:orders.status --root "$R" >/dev/null 2>&1 || true; facts "$R"
eq "drop 一个锚点：它不在 notes、同批别的说明还在；一个文件里的说明删光后文件不留（不留空文件）" \
  "yy|absent|draft/current|n|absent|n" "$D0|$A1|$(st column:orders.status)|$(yn test -e "$N/orders.md")"

# 8 打死：pending 漏列 / 误列外键列与已有来源注释的列 / 写了还列 / 上下文缺列
R="$TMP/a8"; mk "$R"; pj "$R"; P0=$PR
L=$(jf "(P=>'table:orders table:customers table:order_items group:order group:_ungrouped doc:db column:orders.status column:order_items.qty column:orders.memo column:orders.customer_id'.split(' ').map(a=>P.includes(a)?'y':'n').join(''))([...j.tables.filter(t=>t.missingTable).map(t=>'table:'+t.table),...j.tables.flatMap(t=>t.missingColumns),...j.groups.filter(g=>g.missing).map(g=>'group:'+g.id),...(JSON.stringify(j.doc).includes('doc:db')?['doc:db']:[])])")
CT=""; for w in customer_id status memo 备注 customers; do CT="$CT$(yn grep -qF "$w" "$TMP/f.json")"; done
ALL="## table:orders
订单。
## table:customers
客户。
## table:order_items
明细。
## group:order
订单组。
## group:_ungrouped
未分组。
## doc:db
库。
"; for c in customers.id customers.name orders.id orders.status order_items.id order_items.order_id order_items.qty; do ALL="$ALL## column:$c
含义。
"; done
put "$R" "$ALL"; P1=$RC; pj "$R"; PR2=$PR
eq "全无说明：退出码 0；列出 6 项说明缺口 + 无注释无说明的列，不列带来源注释的 memo 与外键列 customer_id；上下文含 orders 的列清单、来源注释与引用" \
  "0|yyyyyyyynn|yyyyy" "$P0|$L|$CT"
eq "全部写完后：put 退出码 0、pending 退出码 0、输出里不再出现任何锚点" "0|0|0" "$P1|$PR2|$(grep -cE '(table|column|group|doc):' "$TMP/f.json" || true)"

# 9 打死：落盘内容依赖 put 的先后与批次（同一批说明分两次、相反顺序交进两个相同夹具，逐字节相同）
RA="$TMP/a9a"; RB="$TMP/a9b"; mk "$RA"; mk "$RB"
S_T="$TO"; S_C="$CS"; S_K="## table:customers
客户。
"; S_G="## group:order
订单组。
"; S_D="## doc:db
库。
"
put "$RA" "$S_T
$S_C"; put "$RA" "$S_K
$S_G
$S_D"; put "$RB" "$S_D
$S_G
$S_K"; put "$RB" "$S_C
$S_T"
DR=0; diff -r "$(NOTES "$RA")" "$(NOTES "$RB")" >"$TMP/diff" 2>&1 || DR=$?
eq "同一批说明两次、相反顺序 put 进两个夹具：notes 目录非空（4 个文件）且逐字节相同；orders.md 里表的说明在列的前面" \
  "4|0|## table:orders" "$(find "$(NOTES "$RA")" -type f | wc -l | tr -d ' ')|$DR|$(head -1 "$(NOTES "$RB")/table/orders.md" 2>/dev/null)"

# 10 打死：页面状态标错 / 过期不提示或吞原文 / 正文不转义 / 来源注释里的内网地址原样出页
R="$TMP/a10"; mk "$R"; sed -i 's/-- 备注/-- 联系 192.168.1.10/' "$R/sql/s.sql"
put "$R" "## table:orders
订单<b>粗体</b>主表。

## table:order_items
明细行，一行一个商品。
"; sed -i 's/qty int/qty bigint/' "$R/sql/s.sql"; BR=0; nd build --root "$R" >/dev/null 2>&1 || BR=$?
P="$R/docs/readable/db"
ds() { grep -oE "<[^>]*data-note=\"$2\"[^>]*>" "$1" 2>/dev/null | head -1 | grep -oE 'data-state="[a-z]+"' | sed 's/data-state=//;s/"//g'; }
eq "build 后表页说明区 data-state：orders 草稿 draft、order_items 过期 stale、customers 没写 none" "0|draft|stale|none" "$BR|$(ds "$P/t-orders.html" table:orders)|$(ds "$P/t-order_items.html" table:order_items)|$(ds "$P/t-customers.html" table:customers)"
eq "过期页有「这段说明写于来源的旧版本」且原正文仍在；说明里的 <b> 转义（页面有 &lt;b&gt;、无原样 <b>粗体</b>）" "yy|yn" \
  "$(yn grep -qF '这段说明写于来源的旧版本' "$P/t-order_items.html")$(yn grep -qF '明细行，一行一个商品。' "$P/t-order_items.html")|$(yn grep -qF '&lt;b&gt;' "$P/t-orders.html")$(yn grep -qF '<b>粗体</b>' "$P/t-orders.html")"
eq "来源注释里的 192.168.1.10 不出现在表页源码、页面写「已隐去」" "n|y" "$(yn grep -rqF '192.168.1.10' "$P/t-orders.html")|$(yn grep -qF '已隐去' "$P/t-orders.html")"

# 11 打死：隐去逐字段打补丁、漏字段（按「整个 docs/readable 搜不到原文」测，不按某个字段被处理测）
# 带口令地址运行时拼（协议头、口令、主机分开放），仓库文件里不留完整的 协议://用户:口令@主机
SL=':'; SL="$SL//"; AT='@'
U1="postgres${SL}app:Passw0rd99${AT}10.20.30.40/db"; U2="postgres${SL}app:S3cretpw${AT}10.20.30.41/db"; U3="redis${SL}:Sup3rSecretPw${AT}host"
R="$TMP/a11"; mk "$R"; printf '%s\n' "CREATE FUNCTION f_c(d text DEFAULT '$U1') RETURNS int AS \$\$ SELECT 1 \$\$ LANGUAGE sql;" "CREATE TABLE bad LIKE '$U2';" "CREATE TABLE t (a int, -- $U3" '  b int, -- AWS_SECRET_ACCESS_KEY=abcd1234wxyz' '  c int, -- db_password: "hunter2!x9"' '  d int -- token: refreshes the login session' ');' >>"$R/sql/s.sql"
for u in "$U1" "$U2" "$U3"; do grep -qF "$u" "$R/sql/s.sql" || { echo "夹具没写进建表文件：$u"; exit 1; }; done  # 夹具真落盘才往下测，否则「搜不到」是假绿
sed -i 's/"title":"t"/"title":"db at 10.20.30.42"/' "$R/docs/readable-src/config.json"; BR=0; nd build --root "$R" >"$TMP/o" 2>&1 || BR=$?
eq "函数签名里的口令与地址、坏语法（未解析原因）里的带口令地址、配置 title 里的地址、三种新密钥写法：build 退出码 0，整个 docs/readable 搜不到任何一条原文" "0|" "$BR|$(grep -rhoE 'Passw0rd99|S3cretpw|10\.20\.30\.4[0-2]|Sup3rSecretPw|abcd1234wxyz|hunter2!x9' "$R/docs/readable" 2>/dev/null | sort -u | tr '\n' ,)"
eq "对照：是隐去不是整页丢掉——db/index.html 写了「已隐去」，正常英文说明 token: refreshes the login session 仍在 t 表页上" "y|y" "$(yn grep -qF '已隐去' "$R/docs/readable/db/index.html")|$(yn grep -qF 'refreshes the login session' "$R/docs/readable/db/t-t.html")"
# 12 打死：第三期文件头说明全文上页面后，几种形状固定的令牌没进隐去规则（页面把令牌原样带出去 = P0 泄密）；只隐去一部分种类、或隐去后核对误报
# 令牌一律运行时拼（片段分开放），仓库文件里不留任何一个完整的、长得像真令牌的字面量
P36=$(printf 'aB3%.0s' $(seq 1 12)); P16=$(printf 'A1B2%.0s' $(seq 1 4)); P35=$(printf 'a1B2c%.0s' $(seq 1 7))
SEC_GH="gh""p_$P36"; SEC_AK="AK""IA$P16"; SEC_AI="AI""za$P35"; SEC_XO="xo""xb-1234567890-abcdefghij"
SEC_JWT="ey""JhbGciOiJIUzI1NiJ9.ey""JzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz"; SEC_PEM="-----BEGIN RSA PRIV""ATE KEY-----"
PB1=$(printf 'Zm9vQmFy%.0s' $(seq 1 6)); PB2=$(printf 'cXV1eA+/%.0s' $(seq 1 5))"=="; PB3=$(printf 'dGVzdA%.0s' $(seq 1 8))   # 私钥正文三行（只含字母、数字与 + / =），运行时拼
SEC_END="-----END RSA PRIV""ATE KEY-----"; SEC_BEG2="-----BEGIN EC PRIV""ATE KEY-----"
R="$TMP/a12"; mkdir -p "$R/docs/readable-src" "$R/app" "$R/sql"; : >"$R/Product-Spec.md"; : >"$R/sql/s.sql"
printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["sql/s.sql"],"codeRoots":["app"],"ignore":[]}\n' >"$R/docs/readable-src/config.json"
printf '{"version":1,"tableGroups":[],"dynamicTables":[],"modules":[{"id":"mod1","title":"模块一","paths":["app/**"],"status":"proposed"}]}\n' >"$R/docs/readable-src/map.json"
printf '%s\n' '"""Head with fixed-shape tokens, one per line.' "$SEC_GH" "$SEC_AK" "$SEC_AI" "$SEC_XO" "$SEC_JWT" "$SEC_PEM" "$PB1" "$PB2" "$SEC_END" '整块之后的话。' "$SEC_BEG2" "$PB3" '没有结尾那块后面的话。' 'End of head."""' 'X = 1' >"$R/app/h.py"
BR=0; nd build --root "$R" >"$TMP/o12" 2>&1 || BR=$?
LK=""; i=0; for s in "$SEC_GH" "$SEC_AK" "$SEC_AI" "$SEC_XO" "$SEC_JWT" "$SEC_PEM" "$SEC_END" "$SEC_BEG2" "$PB1" "$PB2" "$PB3"; do i=$((i + 1)); grep -rqF -- "$s" "$R/docs/readable" && LK="$LK$i,"; done
HM=$(grep -oF '〔已隐去〕' "$R/docs/readable/arch/m-mod1.html" 2>/dev/null | wc -l | tr -d ' ')
CK=$(nd check --root "$R" 2>&1 | tail -1)
eq "文件头说明里写了 GitHub 令牌、AWS 访问键、Google 接口键、Slack 令牌、JWT、私钥头各一行，外加有 END 的整块私钥（BEGIN 到 END 连正文）与没有 END 的（BEGIN 后连着的正文行）：build 退出码 0、整个 docs/readable 搜不到其中任何一条原文（含私钥正文三行与 END 行）、模块页上换成「〔已隐去〕」至少 6 处（头说明里夹着的 Head with / End of head 仍在）、块后面紧跟的两句中文与头说明的首句都还在、check 末行「不一致 0 条」" "0||y|y|yyy|不一致 0 条" \
  "$BR|$LK|$([ "$HM" -ge 6 ] && echo y || echo "hm=$HM")|$(yn grep -qF 'End of head.' "$R/docs/readable/arch/m-mod1.html")|$(yn grep -qF '整块之后的话。' "$R/docs/readable/arch/m-mod1.html")$(yn grep -qF '没有结尾那块后面的话。' "$R/docs/readable/arch/m-mod1.html")$(yn grep -qF 'Head with fixed-shape tokens' "$R/docs/readable/arch/m-mod1.html")|$CK"

# 13 打死：note put 只拦内网地址与口令赋值，放过这几种令牌（说明正文是人 / AI 写的，一旦收下就进页面与侧车入库）
R="$TMP/a13"; mk "$R"; G=""
for v in GH AK AI XO JWT PEM; do eval "s=\$SEC_$v"; put "$R" "## table:orders
订单主表，凭据 $s 不该写在这里。
"; G="$G$RC"; done
put "$R" "## table:orders
订单主表。
$SEC_PEM
$PB1
$SEC_END
"; G="$G$RC"
N0=$(yn test -e "$(NOTES "$R")/table/orders.md"); put "$R" "$TO"
eq "说明正文里带 GitHub 令牌 / AWS 访问键 / Google 接口键 / Slack 令牌 / JWT / 私钥头 / 整块私钥（BEGIN、正文、END）：各退出码 2 且无落盘；干净正文对照 put 退出码 0" "2222222|n|0" "$G|$N0|$RC"
# 14 打死：整库导读（doc:db）的切片仍只绑各组的 id 与标题（往已有分组里加一张表，导读写着「全库三张表」却不被标待更新）/ 切片绑太宽（加个索引也把导读标过期，逼人白看）/ 重新 put 后仍旧是待更新
R="$TMP/a14"; mk "$R"; put "$R" "## doc:db
全库三张表，订单与客户两块。
"; facts "$R"; D0="$(st doc:db)"
echo 'CREATE INDEX order_items_qty_idx ON order_items (qty);' >>"$R/sql/s.sql"; facts "$R"; D1="$(st doc:db)"
echo 'CREATE TABLE shipments (id int PRIMARY KEY, order_id int);' >>"$R/sql/s.sql"
sed -i 's/"tables":\["orders","order_items"\]/"tables":["orders","order_items","shipments"]/' "$R/docs/readable-src/map.json"
facts "$R"; D2="$(st doc:db)"; pj "$R"; DP=$(jf "JSON.stringify(j.doc).includes('doc:db')?'listed':'unlisted'")
put "$R" "## doc:db
全库三张表，订单与客户两块。
"; facts "$R"; D3="$(st doc:db)"
eq "doc:db 的说明：写入后 current；只给已有表加索引仍 current；已有分组里加一张表后 stale 且 pending 列出；同样正文重新 put 后回到 current" \
  "draft/current|draft/current|draft/stale|listed|draft/current" "$D0|$D1|$D2|$DP|$D3"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
