#!/usr/bin/env bash
# risk: high
# test-readable-code-scan.sh — 人读文档 · 谁写谁读 / 代码里建的表 / 项目判断 黑盒回归（docs/readable-spec/phase1-db-contract.md F 节）。
# 断言只从契约推导，入口 build --facts-json。夹具全是合成表名，mktemp -d + --root。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-code-scan ====="
if ! command -v node >/dev/null 2>&1; then echo "SKIPPED: 无 node，未执行 != 通过。"; exit 0; fi
[ -f "$ENGINE" ] || { echo "  [FAIL] 缺被测脚本：$ENGINE" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
eq() {  # eq <标题> <EXPECT> <GOT>
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$1"; else FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; fi
  printf '         EXPECT %s\n         GOT    %s\n' "$2" "$3"
}
facts() { RC=0; env -u CLAUDE_PROJECT_DIR node "$ENGINE" build --facts-json --root "$1" >"$2" 2>"$TMP/err" || RC=$?; }
jf() { node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const r=eval(process.argv[2]);console.log(typeof r==="string"?r:JSON.stringify(r))' "$1" "$2" 2>/dev/null || echo JSONERR; }
ALL='Object.entries(d.usage).flatMap(([t,u])=>[...u.writes.map(e=>({t,k:"w",...e})),...u.reads.map(e=>({t,k:"r",...e}))])'
pf() { jf "$F" "$ALL.filter(e=>e.file=='$1'&&!e.judged).map(e=>e.t+'/'+e.k+'/'+e.line+(e.k=='w'?'/'+e.verb:'')).sort().join(' ')"; }
df() { jf "$F" "d.dynamic.filter(e=>e.file=='$1').map(e=>e.line+'/'+e.verb).sort().join(' ')"; }

mkmain() {  # 小项目：sql 三张表 + app 下几份代码；e.py 与 schema_embed.py 不在 ddl 里 / 在 ddl 里
  local r=$1; mkdir -p "$r/docs/readable-src" "$r/sql" "$r/app/api" "$r/app/web" "$r/app/tools"; : >"$r/Product-Spec.md"
  printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["sql/s.sql","app/tools/schema_embed.py"],"codeRoots":["app"],"ignore":[]}\n' >"$r/docs/readable-src/config.json"
  printf '%s\n' 'CREATE TABLE orders (id int PRIMARY KEY);' 'CREATE TABLE order_items (id int PRIMARY KEY, order_id int REFERENCES orders(id));' 'CREATE TABLE refunds (id int PRIMARY KEY);' >"$r/sql/s.sql"
  cat >"$r/app/api/a.py" <<'EOF'
from orders import load
# SELECT * FROM orders
Q = """
SELECT o.id
  FROM orders o
  JOIN order_items i ON i.order_id = o.id
"""
EOF
  cat >"$r/app/api/b.py" <<'EOF'
A = "INSERT INTO orders (id) SELECT id FROM refunds"
B = "DELETE FROM orders WHERE id = 1"
C = """INSERT INTO orders (id) VALUES (1)
ON CONFLICT (id) DO UPDATE SET id = 2"""
D = "select id from orders"
EOF
  cat >"$r/app/api/c.py" <<'EOF'
def f(tbl, name, conn, v):
    a = f"UPDATE {tbl} SET x = 1"
    b = "SELECT * FROM " + name
    conn.copy_records_to_table(
        "orders", records=v)
    conn.copy_records_to_table(tbl, records=v)
    c = "WITH tmp AS (SELECT 1) SELECT * FROM tmp"
    d = "CREATE TEMP TABLE scratch (id int)"
    e = "INSERT INTO scratch SELECT 1"
EOF
  printf '%s\n' 'export const q = `DELETE FROM ${t}`;' '// SELECT * FROM refunds' 'const r = "SELECT id FROM refunds";' >"$r/app/web/d.ts"
  printf '%s\n' 'import sqlite3' 'db = sqlite3.connect("x")' 'db.execute("CREATE TABLE orders (id int)")' 'db.execute("INSERT INTO orders VALUES (1)")' >"$r/app/tools/e.py"
  printf '%s\n' 'Q = """SELECT * FROM orders' 'WHERE id = 1' >"$r/app/api/bad.py"   # 三引号到文件末尾不闭合
  cat >"$r/app/tools/schema_embed.py" <<'EOF'
"""Notes: a migration may run ALTER TABLE foo ADD x int later."""
NOTE = "remember to ALTER TABLE audit_log when it grows"
SCHEMA = """
CREATE TABLE audit_log (
  id int PRIMARY KEY,
  who text
);
"""
EOF
}
mk2() {  # mk2 <root> [map.json 内容]：ord_a ord_b ref_x solo 四张互不相干的表，不扫代码
  mkdir -p "$1/docs/readable-src" "$1/sql"; : >"$1/Product-Spec.md"
  printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["sql/s.sql"],"codeRoots":[],"ignore":[]}\n' >"$1/docs/readable-src/config.json"
  for t in ord_a ord_b ref_x solo; do echo "CREATE TABLE $t (id int PRIMARY KEY);"; done >"$1/sql/s.sql"
  if [ -n "${2:-}" ]; then printf '%s\n' "$2" >"$1/docs/readable-src/map.json"; fi
}

M="$TMP/m"; mkmain "$M"; F="$TMP/m.json"; facts "$M" "$F"
eq "夹具能 build --facts-json（退出码 0，含 usage 键）" "0|object" "$RC|$(jf "$F" 'typeof d.usage')"
# 1 打死：对全文硬搜（注释 / import 行里的表名算读）、三引号按首行记行号
eq "a.py：import 行与 # 注释里的 orders 不记；三引号里跨行 FROM orders 记第 5 行、JOIN order_items 记第 6 行" "order_items/r/6 orders/r/5" "$(pf app/api/a.py)"
# 2+3 打死：FROM / UPDATE 一律算数、DELETE FROM 当读、只认大写、ON CONFLICT DO UPDATE 多记 update
eq "b.py：INSERT…SELECT FROM 写 orders+读 refunds；DELETE FROM 只写不读；ON CONFLICT DO UPDATE SET 不多记；小写 select/from 也认" "orders/r/5 orders/w/1/insert orders/w/2/delete orders/w/3/insert refunds/r/1" "$(pf app/api/b.py)"
# 4 打死：认不出的静默丢掉、或硬塞给某张表
eq "运行时拼表名：f\"UPDATE {tbl}\" / \"FROM \" + name / .ts 反引号 \${t} 都进 dynamic（行与动作对），且不记在任何表的 usage 里" "2/update 3/select 6/copy|1/delete|app/api/c.py app/web/d.ts" "$(df app/api/c.py)|$(df app/web/d.ts)|$(jf "$F" "[...new Set(d.dynamic.map(e=>e.file))].sort().join(' ')")"
eq "JS 一族 // 注释不算、字符串里的 FROM refunds 记第 3 行" "refunds/r/3" "$(pf app/web/d.ts)"
# 5 打死：copy_records_to_table 不认 / 记成表名所在行 / 变量实参不进 dynamic
eq "copy_records_to_table(换行后 \"orders\") 记 orders 一处 copy 写（动词行 4）；实参是变量的那处不记表" "orders/w/4/copy" "$(pf app/api/c.py)"
# 6 打死：临时表与 CTE 当表、同名别处的表不带标记
SN=$(jf "$F" "$ALL.filter(e=>e.sameNameDdl).map(e=>e.file+'/'+e.k+'/'+e.line).join(' ')")
eq "usage 里没有 scratch / tmp；e.py 自建 orders 又写它 → 只那一条带 sameNameDdl，且 codeTables 恰有 e.py 第 3 行 orders（临时表、并进表清单的 audit_log 都不在）" "no|app/tools/e.py/w/4|app/tools/e.py/3/orders" "$(jf "$F" "('scratch' in d.usage||'tmp' in d.usage)?'yes':'no'")|$SN|$(jf "$F" "d.codeTables.map(e=>e.file+'/'+e.line+'/'+e.name).join(' ')")"
# 7 打死：一个文件坏了全盘失败 / 出半截结果
eq "bad.py 字符串到末尾不闭合：退出码 0、进 unscanned、不出它的半截 usage；别的文件照常（a.py 仍扫出）" "0|app/api/bad.py||order_items/r/6 orders/r/5" "$RC|$(jf "$F" "d.unscanned.map(e=>e.file).join(' ')")|$(pf app/api/bad.py)|$(pf app/api/a.py)"
# 8 打死：ddl 里的代码文件被忽略 / 说明文字被当语句 / 并进去还留在 codeTables
eq "ddl 列的代码文件里 CREATE TABLE audit_log 字面量：进表清单、出处是该文件第 4 行；说明文字里的 ALTER TABLE 不进未解析的语句" "app/tools/schema_embed.py/4|0" "$(jf "$F" "d.tables.filter(t=>t.name=='audit_log').map(t=>t.file+'/'+t.line).join(' ')")|$(jf "$F" "d.unparsed.filter(u=>u.file.includes('schema_embed')).length")"
# 11 打死：输出里混入时间 / 乱序
facts "$M" "$TMP/m2.json"
eq "同一份输入两次 --facts-json 逐字节相同" "same" "$(cmp -s "$F" "$TMP/m2.json" && echo same || echo differs)"
# 10 打死：项目判断补的条目没进 usage / 没标 judged / 没标已归属
printf '%s\n' '{"version":1,"dynamicTables":[{"file":"app/api/c.py","reads":["orders"],"writes":["refunds"],"status":"proposed"}]}' >"$M/docs/readable-src/map.json"
facts "$M" "$TMP/mj.json"; F="$TMP/mj.json"
eq "dynamicTables：orders 读与 refunds 写各多一条 judged=proposed 且 line/verb 为 null；c.py 的 dynamic 条目 assigned 为真、d.ts 的为假" "0|app/api/c.py/proposed/null|app/api/c.py/proposed/null/null|true true true false" "$RC|$(jf "$F" "d.usage.orders.reads.filter(e=>e.judged).map(e=>e.file+'/'+e.judged+'/'+e.line).join(' ')")|$(jf "$F" "d.usage.refunds.writes.filter(e=>e.judged).map(e=>e.file+'/'+e.judged+'/'+e.line+'/'+e.verb).join(' ')")|$(jf "$F" "d.dynamic.map(e=>!!e.assigned).join(' ')")"

# 9 分组与 map.json 校验
grp() { jf "$F" "d.groups.map(g=>g.id+':'+g.tables.join(',')+':'+g.status).sort().join(' ')"; }
N="$TMP/n"; mk2 "$N"; F="$TMP/n.json"; facts "$N" "$F"
eq "无 map.json：按前缀分（ord 一组），单表前缀 ref / solo 并进 _other，status 为 default" "0|_other:ref_x,solo:default ord:ord_a,ord_b:default" "$RC|$(grp)"
V='{"version":1,"tableGroups":[{"id":"G1","title":"甲","tables":["ord_a","ord_b"],"status":"confirmed"},{"id":"G2","title":"乙","tables":["ref_x"],"status":"proposed"}]}'
mk2 "$N" "$V"; facts "$N" "$F"
eq "有 tableGroups：groups 照它（status 取它写的），没被收进去的 solo 进 _ungrouped；干净的 map 没有 mapProblems" "0|G1:ord_a,ord_b:confirmed G2:ref_x:proposed _ungrouped:solo|0" "$RC|$(jf "$F" "d.groups.map(g=>g.id+':'+g.tables.join(',')+(g.id=='_ungrouped'?'':':'+g.status)).sort().join(' ')")|$(jf "$F" 'd.mapProblems.length')"
for bad in 'ghost 组里点到不存在的表|{"version":1,"tableGroups":[{"id":"G1","title":"甲","tables":["ord_a","ghost"],"status":"proposed"}]}' \
           'dup 一张表进两个组|{"version":1,"tableGroups":[{"id":"G1","title":"甲","tables":["ord_a"],"status":"proposed"},{"id":"G2","title":"乙","tables":["ord_a"],"status":"proposed"}]}' \
           'status status 写了别的值|{"version":1,"tableGroups":[{"id":"G1","title":"甲","tables":["ord_a"],"status":"weird"}]}'; do
  mk2 "$N" "${bad#*|}"; facts "$N" "$F"
  eq "map.json ${bad%%|*}：生成照常（退出码 0），mapProblems 恰一条" "0|1" "$RC|$(jf "$F" 'd.mapProblems.length')"
done
mk2 "$N" '{not json'; facts "$N" "$F"
eq "map.json 不是合法 JSON：退出码 2" "2" "$RC"

# 12 打死：散文进读写（日志里的 delete from）/ 大写也要看形状 / 三种写法切坏文件 / codeRoots 越界不拦
S="$TMP/s"; mkdir -p "$S/docs/readable-src" "$S/sql" "$S/app"; : >"$S/Product-Spec.md"
printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["sql/s.sql"],"codeRoots":["app"],"ignore":[]}\n' >"$S/docs/readable-src/config.json"
printf '%s\n' 'CREATE TABLE orders (id int);' 'CREATE TABLE refunds (id int);' >"$S/sql/s.sql"
printf '%s\n' 'A = """Never update orders here; reads only."""' 'log.info("failed to delete from orders, will retry")' 'raise ValueError("cannot insert into orders twice")' 'D = "update orders set n = 1"' 'E = "delete from orders"' 'F = "select id from orders o where o.x = 1"' 'G = "DELETE FROM orders, x"' >"$S/app/p.py"
printf '%s\n' "export const A = () => <p>Don't refresh</p>;" 'const q = "SELECT id FROM orders";' >"$S/app/j.tsx"
printf '%s\n' "if (s) /'/.test(s);" 'const q = "DELETE FROM refunds WHERE id = 1";' >"$S/app/r.js"
printf '%s\n' "x = f\"{v:'>10}\"" 'q = "UPDATE refunds SET a = 1"' >"$S/app/f.py"
facts "$S" "$TMP/s.json"; F="$TMP/s.json"; RS=$RC
eq "三句散文不进 usage、都进 ambiguous（update / delete / insert 各一）；像 SQL 的小写 update / delete / select 与大写 DELETE FROM orders, x 进 usage；p.py 没有运行时拼的表名" "0|orders/r/6 orders/w/4/update orders/w/5/delete orders/w/7/delete|1/update/orders 2/delete/orders 3/insert/orders|" "$RS|$(pf app/p.py)|$(jf "$F" "d.ambiguous.filter(e=>e.file=='app/p.py').map(e=>e.line+'/'+e.verb+'/'+e.table).join(' ')")|$(df app/p.py)"
eq "JSX 文字里的撇号 / 右括号后的正则字面量 / f 串格式说明里的引号：三个文件都不进 unscanned，文件里后面的真 SQL 照认" "|orders/r/2|refunds/w/2/delete|refunds/w/2/update" "$(jf "$F" "d.unscanned.map(e=>e.file).join(' ')")|$(pf app/j.tsx)|$(pf app/r.js)|$(pf app/f.py)"
sed -i 's|"codeRoots":\["app"\]|"codeRoots":["../outside"]|' "$S/docs/readable-src/config.json"; facts "$S" "$TMP/s3.json"
eq "codeRoots 写 ../outside（越出根目录）：退出码 2，不去扫外面" "2" "$RC"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
