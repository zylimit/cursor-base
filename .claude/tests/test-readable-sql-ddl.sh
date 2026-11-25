#!/usr/bin/env bash
# risk: high
# test-readable-sql-ddl.sh — 人读文档 · 建表定义取事实器黑盒回归（docs/readable-spec/phase1-db-contract.md 的 A、B 两节）。
# 断言只从契约推导。最怕：悄悄漏掉一张表 / 一个列，或把读不出的部分装作读出来了。
# B 节末尾有输出键名清单：布尔字段按键名断言（K 取列对象），其余仍用「JSON 里含不含某段原文」。
# 夹具一律 mktemp -d + --root，手写合成 SQL。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-sql-ddl ====="
if ! command -v node >/dev/null 2>&1; then
  echo "SKIPPED: 无 node——取事实器是纯 node 脚本，一条都跑不了，未执行 != 通过。"
  exit 0
fi
[ -f "$ENGINE" ] || { echo "  [FAIL] 缺被测脚本：$ENGINE" >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
chk() {  # chk <0=过/非0=不过> <标题> <EXPECT> <GOT>
  if [ "$1" = "0" ]; then PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$2"
  else FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$2"; fi
  printf '         EXPECT %s\n         GOT    %s\n' "$3" "$4"
}
eq() { local g; g=$(q "$FACTS" "$3" 2>&1 || true); if [ "$g" = "$2" ]; then chk 0 "$1" "$2" "$g"; else chk 1 "$1" "$2" "$g"; fi; }
q() {  # q <facts.json> <js 表达式，d 是整份事实，T(表)/C(表,列)/J(x) 是取用助手>
  node -e '
    const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const T=n=>d.tables.find(t=>t.name===n), J=x=>JSON.stringify(x);
    const K=(t,c)=>T(t).columns.find(x=>x.name===c), C=(t,c)=>J(K(t,c));
    process.stdout.write(String(eval(process.argv[2])));
  ' "$1" "$2" 2>&1 || printf '<error>'
}
run() { RC=0; env -u CLAUDE_PROJECT_DIR node "$ENGINE" "$@" >"$TMP/out" 2>"$TMP/err" || RC=$?; }
mkcfg() {  # mkcfg <root> <ddl 数组 JSON>
  mkdir -p "$1/docs/readable-src"; : >"$1/Product-Spec.md"
  printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":%s,"codeRoots":[],"ignore":[]}\n' "$2" >"$1/docs/readable-src/config.json"
}
R="$TMP/r1"; mkdir -p "$R/sql"; mkcfg "$R" '["sql/a.sql","sql/b.sql"]'
cat >"$R/sql/a.sql" <<'EOF'
/* 块注释里有分号; 不切 */
-- 表甲注释
-- 表甲第二行
CREATE TABLE IF NOT EXISTS alpha (
  id serial PRIMARY KEY,
  name text NOT NULL DEFAULT 'a;b', -- 名称行尾
  -- kind上方;含分号
  kind text CHECK (kind IN ('x','y')),
  owner_id int REFERENCES beta(id) ON DELETE CASCADE,
  code text UNIQUE
);
CREATE TABLE beta (id int PRIMARY KEY, note text);
CREATE TABLE gamma LIKE beta;
CREATE TABLE delta (a int, b int, c int, PRIMARY KEY (a), UNIQUE (a, b), CHECK (a < b), CHECK (c > 0), CONSTRAINT named_ck CHECK (a > 0));
CREATE TABLE epsilon (a int, b int, CHECK (a < b));
DO $$ BEGIN
  ALTER TABLE alpha DROP CONSTRAINT IF EXISTS x;
  ALTER TABLE beta ADD CONSTRAINT c_pos CHECK (id > 0);
END $$;
DO $fn$ BEGIN EXECUTE format('ALTER TABLE %I ADD COLUMN z int', 'alpha'); END $fn$;
DO $$ BEGIN CREATE ROLE r1; END $$;
EOF
cat >"$R/sql/b.sql" <<'EOF'
ALTER TABLE alpha ADD COLUMN IF NOT EXISTS name varchar(5);
-- 新增列说明
ALTER TABLE alpha ADD COLUMN IF NOT EXISTS extra int;
ALTER TABLE alpha ADD COLUMN extra bigint;
-- 不该归属
ALTER TABLE beta ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE ONLY public.alpha DROP CONSTRAINT IF EXISTS alpha_kind_check, ADD COLUMN w int;
ALTER TABLE alpha ADD COLUMN tail int; -- 行尾tail
ALTER TABLE delta DROP CONSTRAINT delta_check;
ALTER TABLE delta DROP CONSTRAINT delta_c_check;
ALTER TABLE epsilon DROP CONSTRAINT epsilon_a_b_check;
DROP INDEX IF EXISTS ix_old;
CREATE INDEX ix_a ON alpha (name);
CREATE UNIQUE INDEX ix_old ON alpha (code);
DROP INDEX ix_old;
COMMENT ON COLUMN alpha.code IS 'code覆盖';
CREATE OR REPLACE VIEW v_a AS SELECT 1;
CREATE OR REPLACE FUNCTION f_a(x int) RETURNS int AS $$ BEGIN RETURN x; END $$ LANGUAGE plpgsql;
CREATE FUNCTION f_o(x int) RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;
CREATE FUNCTION f_o(x text) RETURNS int AS $$ SELECT 2 $$ LANGUAGE sql;
ALTER TABLE ghost ADD COLUMN q int;
ALTER TABLE alpha DROP CONSTRAINT nosuch;
EOF
run build --facts-json --root "$R"; cp "$TMP/out" "$TMP/f1.json"; FACTS="$TMP/f1.json"; RC1=$RC
chk "$RC1" "夹具能 build --facts-json 出事实（退出码 0）" "rc=0" "rc=$RC1 $(head -c 200 "$TMP/err")"
# 1 打死：按分号硬切（块注释 / 行注释 / 字符串 / $$ 里的分号会把表切碎或多出假表）
eq "切语句：表恰为 alpha,beta,delta,epsilon（gamma 读不懂不算），分号全在引号 / 注释 / \$\$ 里不切断" "alpha,beta,delta,epsilon" 'd.tables.map(t=>t.name).join()'
eq "切语句：字符串默认值里的分号原样保留" "true" 'C("alpha","name").includes("a;b")'
eq "切语句：列行尾分号后的整张表没被截断，alpha 列序是首次出现序，extra 只一次" "id,name,kind,owner_id,code,extra,w,tail" 'T("alpha").columns.map(c=>c.name).join()'
# 2 打死：重复加列 / IF NOT EXISTS 静默覆盖先前定义 / 无 IF NOT EXISTS 重复加却不报冲突
eq "IF NOT EXISTS 重申：name 保留先前的 text，不被 varchar(5) 覆盖" "true" 'C("alpha","name").includes("text")&&!C("alpha","name").includes("varchar")'
eq "无 IF NOT EXISTS 重加 extra：保留 int 不是 bigint，且进定义冲突" "true" 'C("alpha","extra").includes("int")&&!C("alpha","extra").includes("bigint")&&J(d.conflicts).includes("extra")'
eq "冲突清单恰三条：extra 重加、nosuch、epsilon_a_b_check 找不到约束（IF NOT EXISTS 与 IF EXISTS 的不记）" "3" 'd.conflicts.length+(J(d.conflicts).includes("nosuch")&&J(d.conflicts).includes("epsilon_a_b_check")?0:100)'
# 3 打死：DO 块里的 ALTER 被当成已合并；无关的 CREATE ROLE 块也被列出；多条语句的块被拆成多项
eq "unfolded 恰两项：点名 alpha+beta 的块、%I 动态表名的块（CREATE ROLE 块不进）" "2" 'd.unfolded.length+(J(d.unfolded).includes("CREATE ROLE")?100:0)'
eq "unfolded 带文件、起始行、head 前缀、表名" "true" "$(printf 'const u=d.unfolded[0]; u.file.includes("a.sql")&&u.line===%s&&u.head.startsWith("ALTER TABLE alpha")&&u.head.length<=80&&u.tables.includes("alpha")&&u.tables.includes("beta")' "$(grep -n -m1 'DO \$\$' "$R/sql/a.sql" | cut -d: -f1)")"
eq "unfolded：占位表名记成「动态表名」" "true" 'd.unfolded[1].tables.includes("动态表名")'
eq "DO 块里的 ADD CONSTRAINT / ADD COLUMN 没被合并进现行结构" "false" 'J(T("beta")).includes("c_pos")||J(T("alpha").columns).includes("\"z\"")'
# 4 打死：一处读不懂整次失败，或猜一个结构
eq "unparsed 点名 gamma 与文件，且同文件的 alpha / beta 照常取出" "1" 'd.unparsed.length+(J(d.unparsed).includes("gamma")&&J(d.unparsed).includes("a.sql")&&T("beta")?0:100)'
eq "orphanAlters 恰一条，点名 ghost，ghost 没被凭空建出" "1" 'd.orphanAlters.length+(J(d.orphanAlters).includes("ghost")&&!T("ghost")?0:100)'
# 5 打死：注释挂错对象
eq "注释：表上方连续 -- 行归表，不漏到列" "true" 'J(T("alpha")).includes("表甲注释")&&J(T("alpha")).includes("表甲第二行")&&!C("alpha","id").includes("表甲")'
eq "注释：行尾归该列、列上方整行归该列（含分号），互不串" "true" 'C("alpha","name").includes("名称行尾")&&!C("alpha","name").includes("kind上方")&&C("alpha","kind").includes("kind上方;含分号")&&!C("alpha","kind").includes("名称行尾")'
eq "改动备注：ALTER 上方的 -- 进表的 changes、addedColumns 只含真加的 extra（重加的不算），不挂到 extra / note 列上（打死把改动说明归列）" "true" 'const e=T("alpha").changes.filter(c=>String(c.comment).includes("新增列说明")); e.length===1&&e[0].addedColumns.join()==="extra"&&typeof e[0].line==="number"&&!C("alpha","extra").includes("新增列说明")&&!C("beta","note").includes("不该归属")'
eq "注释：ADD COLUMN 那一行行尾的 -- 仍归它加进来的列（打死连行尾一起不归列）" "true" 'C("alpha","tail").includes("行尾tail")'
eq "约束名：没写名字的表级约束 name 为 null、输出里不出现补的 <表>_ 名字，写了名字的照出（打死把推断的名字写进输出）" "3|2|true|false" 'const c=T("delta").constraints; [c.length,c.filter(x=>x.name===null).length,c.some(x=>x.name==="named_ck"),J(c).includes("delta_")].join("|")'
eq "补名：单列 CHECK 叫 delta_c_check、多列叫 delta_check 都能摘（delta 只剩主键 / 唯一 / named_ck，打死补错名）" "true" 'T("delta").constraints.every(x=>x.type!=="check"||x.name==="named_ck")'
eq "补名：DROP epsilon_a_b_check（列名连起来）摘不掉多列 CHECK，CHECK 还在（打死按列名连起来补名）" "1" 'T("epsilon").constraints.filter(x=>x.type==="check").length'
eq "列标志按键名：主键 / NOT NULL 的 nullable=false，主键 primaryKey、UNIQUE 的 unique，其余反之；无默认值键在且为 null" "true" 'const i=K("alpha","id"),n=K("alpha","name"),k=K("alpha","kind"),u=K("alpha","code"); i.primaryKey===true&&i.nullable===false&&n.nullable===false&&k.nullable===true&&k.primaryKey===false&&u.unique===true&&i.unique===false&&"default" in k&&k.default===null'
eq "注释：COMMENT ON COLUMN 覆盖" "true" 'C("alpha","code").includes("code覆盖")'
# 6 打死：不认自动约束名 / 不摘索引 / 丢外键
eq "外键引用表与 ON DELETE 动作都取到" "true" 'C("alpha","owner_id").includes("beta")&&C("alpha","owner_id").includes("CASCADE")'
eq "DROP CONSTRAINT IF EXISTS alpha_kind_check 摘掉 kind 的行内 CHECK（同条语句里逗号后的 ADD COLUMN w 仍生效）" "false" 'J(T("alpha")).includes("IN (")||!T("alpha").columns.some(c=>c.name==="w")'
eq "DROP INDEX 摘掉 ix_old，ix_a 仍在" "true" 'J(T("alpha")).includes("ix_a")&&!J(T("alpha")).includes("ix_old")'
# 7 视图与函数
eq "视图：anchor、name、文件、定义原文" "view:v_a|v_a|true|true" 'd.views.map(v=>[v.anchor,v.name,v.file.includes("b.sql"),v.sql.includes("SELECT 1")].join("|")).join()'
eq "函数：anchor、name、文件、签名行，且不混进视图" "function:f_a|f_a|true|true|1" 'd.functions.filter(f=>f.name==="f_a").map(f=>[f.anchor,f.name,f.file.includes("b.sql"),f.signature.includes("f_a(x int)")].join("|")).join()+"|"+d.views.length'
eq "同名重载：锚点 function:f_o#<6 位指纹> 且两个不同；单个的 f_a 不接指纹" "true" 'const a=d.functions.filter(f=>f.name==="f_o").map(f=>f.anchor); a.length===2&&a.every(x=>/^function:f_o#[0-9a-f]{6}$/.test(x))&&a[0]!==a[1]'
# 9 打死：输出含时间戳 / 无序遍历
run build --facts-json --root "$R"
cmp -s "$TMP/out" "$TMP/f1.json"; chk $? "同一输入两次 build --facts-json 逐字节相同" "字节一致" "cmp rc 见上"
# 8 init
X="$TMP/r2"; mkdir -p "$X/x/sql"; : >"$X/x/sql/002_b.sql"; : >"$X/x/sql/001_a.sql"
run init --root "$X"; RCI=$RC; CFG="$X/docs/readable-src/config.json"
G=$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ddl.join())}catch(e){process.stdout.write("<无配置>")}' "$CFG")
if [ "$RCI" = 0 ] && [ "$G" = "x/sql/001_a.sql,x/sql/002_b.sql" ]; then chk 0 "init 起草：找到 x/sql/*.sql（不只根下 sql/），按文件名排序" "rc=0 ddl=001,002" "rc=$RCI ddl=$G"
else chk 1 "init 起草：找到 x/sql/*.sql（不只根下 sql/），按文件名排序" "rc=0 ddl=x/sql/001_a.sql,x/sql/002_b.sql" "rc=$RCI ddl=$G"; fi
printf '{"version":1,"title":"手改","ddl":["x/sql/001_a.sql"]}' >"$CFG"; B4=$(sha256sum "$CFG")
run init --root "$X"; RCJ=$RC; AF=$(sha256sum "$CFG")
if [ "$RCJ" = 0 ] && [ "$B4" = "$AF" ] && grep -q '配置已存在' "$TMP/out" "$TMP/err" 2>/dev/null; then chk 0 "init 配置已存在：一字节不动、说「配置已存在」、退出码 0" "不动+rc=0" "rc=$RCJ"
else chk 1 "init 配置已存在：一字节不动、说「配置已存在」、退出码 0" "sha 不变 rc=0 且提示" "rc=$RCJ same=$([ "$B4" = "$AF" ] && echo y || echo n) out=$(head -c 120 "$TMP/out")"; fi
printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["x/sql/001_a.sql","no/such.sql"],"codeRoots":[],"ignore":[]}' >"$CFG"; : >"$X/Product-Spec.md"
run build --facts-json --root "$X"
if [ "$RC" = 2 ] && cat "$TMP/out" "$TMP/err" | grep -q 'no/such.sql'; then chk 0 "ddl 路径不存在：build 退出码 2 并点名那一条" "rc=2 点名 no/such.sql" "rc=$RC"
else chk 1 "ddl 路径不存在：build 退出码 2 并点名那一条" "rc=2 点名 no/such.sql" "rc=$RC err=$(head -c 160 "$TMP/err")"; fi
# 10 打死：DROP / RENAME COLUMN 不连带、不认 GENERATED 子句就丢整表、没名字的索引摘不掉、物化视图当表、`CREATE TABLE x ( -- ` 行尾注释丢了、maybeDropped 误报漏报
R3="$TMP/r3"; mkdir -p "$R3/sql"; mkcfg "$R3" '["sql/c.sql"]'
cat >"$R3/sql/c.sql" <<'EOF'
CREATE TABLE p (id int PRIMARY KEY);
CREATE TABLE t (a int, b int, CHECK (a > 0), UNIQUE (a, b), FOREIGN KEY (b) REFERENCES p(id), PRIMARY KEY (a, b));
CREATE INDEX t_b_ix ON t (b);
ALTER TABLE t DROP COLUMN b;
CREATE TABLE u (id int, k int, UNIQUE (id, k), CHECK (k > 0));
CREATE INDEX u_k_ix ON u (k);
CREATE TABLE v (id int PRIMARY KEY, uk int REFERENCES u(k));
CREATE TABLE w (uk int, FOREIGN KEY (uk) REFERENCES u(k));
ALTER TABLE u RENAME COLUMN k TO kk;
CREATE TABLE g (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, n int, sq int GENERATED ALWAYS AS (n * n) STORED);
CREATE TABLE m (a int, b int);
CREATE INDEX ON m (a);
CREATE INDEX ON m (a, b);
CREATE TABLE m2 (a int);
CREATE INDEX ON m2 (a);
DROP INDEX IF EXISTS m_a_idx;
CREATE VIEW v_plain AS SELECT 1;
CREATE MATERIALIZED VIEW mv_daily AS SELECT a FROM m;
CREATE TABLE cm ( -- 行尾表注释
  id int
);
CREATE TABLE md1 (id int);
ALTER TABLE md1 DROP CONSTRAINT IF EXISTS gone_x;
CREATE TABLE md2 (id int);
ALTER TABLE md2 DROP CONSTRAINT IF EXISTS c1;
ALTER TABLE md2 ADD CONSTRAINT c1 CHECK (id > 0);
CREATE TABLE md3 (id int);
ALTER TABLE md3 ADD CONSTRAINT c2 CHECK (id > 0);
ALTER TABLE md3 DROP CONSTRAINT IF EXISTS c2;
EOF
run build --facts-json --root "$R3"; cp "$TMP/out" "$TMP/f3.json"; FACTS="$TMP/f3.json"
chk "$RC" "r3 夹具能 build --facts-json（红在这条则下面各条都是连带）" "rc=0" "rc=$RC $(head -c 200 "$TMP/err")"
eq "DROP COLUMN b：点到 b 的 UNIQUE / FOREIGN KEY / 主键与 (b) 上的索引都没了，只剩只点 a 的 CHECK，a 不再是主键（打死只摘列不摘约束）" "check|0|false|a" 'const t=T("t"); [t.constraints.map(c=>c.type).join(),t.indexes.length,K("t","a").primaryKey,t.columns.map(c=>c.name).join()].join("|")'
eq "RENAME COLUMN k TO kk：本表 UNIQUE 与索引的列名、v 行内外键与 w 表级外键指向的列名都改成 kk，w 里不剩 \"k\"（打死只改列不改连带）" "id+kk|kk|kk|true|id,kk" 'const N=x=>String([].concat(x)).split(/[\s,]+/).filter(Boolean).join("+"),w=J(T("w").constraints); [T("u").constraints.filter(c=>c.type==="unique").map(c=>N(c.columns)).join(),T("u").indexes.map(i=>N(i.columns)).join(),K("v","uk").references.column,w.includes("\"kk\"")&&!w.includes("\"k\""),T("u").columns.map(c=>c.name).join()].join("|")'
eq "IDENTITY / 生成列：整张 g 表在、generated 有原文、普通列 generated 为 null、主键仍认、未解析 0 条（打死遇到不认识的子句丢整表）" "3|true|true|true|true|0" '[T("g").columns.length,String(K("g","id").generated).includes("IDENTITY"),String(K("g","sq").generated).includes("n * n"),K("g","n").generated===null,K("g","id").primaryKey,d.unparsed.length].join("|")'
eq "没写名字的索引：m2 的输出里 name 为 null；DROP INDEX IF EXISTS m_a_idx 只摘 m 上 (a) 那条，(a, b) 那条留着（打死补名不对 / 不摘 / 摘多）" "a+b:null|null" 'const N=x=>String([].concat(x)).split(/[\s,]+/).filter(Boolean).join("+"); [T("m").indexes.map(i=>N(i.columns)+":"+i.name).join(),T("m2").indexes.map(i=>String(i.name)).join()].join("|")'
eq "CREATE MATERIALIZED VIEW：在 views 里且 materialized 为 true、不在 tables 里；普通视图 materialized 不为 true" "true|true|true|false" 'const a=d.views.find(v=>v.name==="mv_daily"),b=d.views.find(v=>v.name==="v_plain"); [!!a,a&&a.materialized===true,b&&b.materialized!==true,d.tables.some(t=>t.name==="mv_daily")].join("|")'
eq "CREATE TABLE cm ( -- 注释：行尾注释归表，不漏给列" "true|false" '[String(T("cm").comment).includes("行尾表注释"),String(K("cm","id").comment).includes("行尾表注释")].join("|")'
eq "maybeDropped：没对上且之后没人再加同名的 md1 一条（带 gone_x）；先删后加同名的 md2、对上了的 md3 都没有；这三条都不进定义冲突" "1,0,0|true|0" '[["md1","md2","md3"].map(n=>(T(n).maybeDropped||[]).length).join(),String(J(T("md1").maybeDropped)).includes("gone_x"),d.conflicts.length].join("|")'
R="$TMP/r6"; mkdir -p "$R/sql"; mkcfg "$R" '["sql/a.sql"]'
echo 'CREATE TABLE gi (id bigint GENERATED ALWAYS AS IDENTITY, n int, sq int GENERATED ALWAYS AS (n * n) STORED);' >"$R/sql/a.sql"
run build --facts-json --root "$R"; cp "$TMP/out" "$TMP/f6.json"; FACTS="$TMP/f6.json"
eq "标识列没写主键也没写 NOT NULL：nullable 为 false（库自动设不可空）；同表的生成列 STORED nullable 为 true、普通列 true（打死标识列误报可空 / 生成列误报不可空）" "false|true|true|0" '[K("gi","id").nullable,K("gi","sq").nullable,K("gi","n").nullable,d.unparsed.length].join("|")'
# 11 守卫式 DO 块（B 节「读得出的那一种要并进来」）：打死漏并（凡 DO 一律不并）与把推断当事实（动态 / 按条件删 / 循环里 / 守卫不查系统表的也并）
R7="$TMP/r7"; mkdir -p "$R7/sql"; mkcfg "$R7" '["sql/d.sql"]'; S7="$R7/sql/d.sql"
cat >"$S7" <<'EOF'
CREATE TABLE orders (id int PRIMARY KEY);
CREATE TABLE order_items (id int PRIMARY KEY, order_id int, ref text);
CREATE TABLE shipments (id int, order_id int);
CREATE TABLE legacy (id int, CONSTRAINT fk_old CHECK (id > 0));
CREATE TABLE looped (id int);
CREATE TABLE flagged (id int);
EOF
cat >"$TMP/blk" <<'EOF'
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_items_order') THEN
        ALTER TABLE order_items ADD CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id);
    END IF;
END $$;
EOF
cat "$TMP/blk" "$TMP/blk" >>"$S7"
cat >>"$S7" <<'EOF'
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ux_items_ref') THEN CREATE UNIQUE INDEX ux_items_ref ON order_items (ref); END IF; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ship_order') THEN ALTER TABLE shipments ADD CONSTRAINT fk_ship_order FOREIGN KEY (order_id) REFERENCES orders(id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ship_id') THEN ALTER TABLE shipments ADD CONSTRAINT ck_ship_id CHECK (id > 0); END IF;
  EXECUTE format('ALTER TABLE %I ADD COLUMN note text', 'shipments');
END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_old') THEN ALTER TABLE legacy DROP CONSTRAINT fk_old; END IF; END $$;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT 1 LOOP IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_loop') THEN ALTER TABLE looped ADD CONSTRAINT ck_loop CHECK (id > 0); END IF; END LOOP; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM app_flags WHERE name = 'x') THEN ALTER TABLE flagged ADD CONSTRAINT ck_flag CHECK (id > 0); END IF; END $$;
EOF
run build --facts-json --root "$R7"; cp "$TMP/out" "$TMP/f7.json"; FACTS="$TMP/f7.json"; L1=$(grep -n -m1 'ALTER TABLE order_items' "$S7" | cut -d: -f1); LI=$(grep -n 'CREATE UNIQUE INDEX' "$S7" | cut -d: -f1)
chk "$RC" "r7 夹具能 build --facts-json（红在这条则下面各条都是连带）" "rc=0" "rc=$RC $(head -c 200 "$TMP/err")"
eq "守卫式静态外键并进 order_items：名字 fk_items_order、类型 foreign key、line 是 ALTER 那一行（先出现的那份）（打死凡 DO 块一律不并）" "foreign key|$L1" 'const c=T("order_items").constraints.find(x=>x.name==="fk_items_order"); c.type+"|"+c.line'
eq "同一守卫块连写两遍：约束仍一条、定义冲突 0（打死不按已有同名就跳过）" "1|0" 'T("order_items").constraints.filter(x=>x.name==="fk_items_order").length+"|"+d.conflicts.length'
eq "守卫里 CREATE UNIQUE INDEX：order_items 多出 ux_items_ref，唯一、line 是该语句所在行" "1|true|$LI" 'const i=T("order_items").indexes.filter(x=>x.name==="ux_items_ref"); i.length+"|"+(i[0]&&i[0].unique)+"|"+(i[0]&&i[0].line)'
eq "整块并完的不进 unfolded：外键块、索引块都不在清单里，清单只剩四个没并完的块（打死并了不拿掉 / 全并也留）" "4|false" 'd.unfolded.length+"|"+(J(d.unfolded).includes("fk_items_order")||J(d.unfolded).includes("ux_items_ref"))'
eq "一块两守卫加一句 EXECUTE：两条约束都并进 shipments，动态加的列 note 没并（打死有动态语句就整块不并）" "ck_ship_id,fk_ship_order|id,order_id" 'T("shipments").constraints.map(x=>x.name).sort().join()+"|"+T("shipments").columns.map(c=>c.name).join()'
eq "同一个块仍在 unfolded 里、tables 恰为 [\"动态表名\"]，不含 shipments（打死并了一部分就把块拿掉 / tables 没收窄）" "1|[\"动态表名\"]" 'const u=d.unfolded.filter(x=>x.tables.includes("动态表名")); u.length+"|"+J(u[0]&&u[0].tables)'
eq "不该并的三种：按条件删（fk_old 还在）、循环里（looped 没 ck_loop）、守卫查的不是系统表（flagged 没 ck_flag），三块都仍在 unfolded（打死把推断当事实）" "true|0|0|true|true|true" '[T("legacy").constraints.some(x=>x.name==="fk_old"),T("looped").constraints.length,T("flagged").constraints.length,...["legacy","looped","flagged"].map(n=>d.unfolded.some(u=>u.tables.includes(n)))].join("|")'
# 12 init --suggest（契约 I 节第 5 条）：新项目的配置在还没有代码时起草，之后冒出的建表文件与代码目录没人填进去，数据库设计与架构设计就一直是空的
tree() { (cd "$1" && find . -type f | LC_ALL=C sort | xargs -r sha256sum | sha256sum | cut -c1-16); }
sg_cfg() {  # sg_cfg <root> <spec JSON> <ddl JSON> <codeRoots JSON> <archDocs JSON>
  mkdir -p "$1/docs/readable-src"
  printf '{"version":1,"title":"t","spec":%s,"ddl":%s,"codeRoots":%s,"ignore":["**/tests/**"],"archDocs":%s}\n' "$2" "$3" "$4" "$5" >"$1/docs/readable-src/config.json"
}
sg_files() { local d="$1" n="$2" e="$3" i; mkdir -p "$d"; for i in $(seq 1 "$n"); do : >"$d/m$i.$e"; done; }
sg_get() { q "$TMP/sg.json" 'J([d.ok,d.missing.ddl,d.missing.codeRoots,d.missing.spec,d.missing.archDocs])'; }
sg_run() { run init --suggest --json --root "$1"; RCS=$RC; cp "$TMP/out" "$TMP/sg.json"; }
# 12a 打死：配置起草后加进来的建表文件 / 代码目录不报；报了但漏报其一；已列的也跟着报；填进去后仍报差别
SA="$TMP/sa"; mkdir -p "$SA/sql" "$SA/db"; : >"$SA/Product-Spec.md"; : >"$SA/sql/001_a.sql"; : >"$SA/db/schema.sql"; sg_files "$SA/svc" 3 py; sg_files "$SA/app" 4 py
sg_cfg "$SA" '"Product-Spec.md"' '["sql/001_a.sql"]' '["svc"]' '[]'
sg_run "$SA"; G1="rc=$RCS $(sg_get)"; run init --suggest --root "$SA"; HM=$RC; H1=$(grep -cF 'db/schema.sql' "$TMP/out" || true); H2=$(grep -cF 'app' "$TMP/out" || true)
sg_cfg "$SA" '"Product-Spec.md"' '["sql/001_a.sql","db/schema.sql"]' '["svc","app"]' '[]'; sg_run "$SA"; G2="rc=$RCS $(sg_get)"; run init --suggest --root "$SA"; HF=$RC; HFT=$(grep -cF '配置跟得上项目，没有漏项' "$TMP/out" || true)
W1='rc=1 [false,["db/schema.sql"],["app"],null,[]]'; W2='rc=0 [true,[],[],null,[]]'
chk "$([ "$G1" = "$W1" ] && [ "$HM" = 1 ] && [ "$H1" -ge 1 ] && [ "$H2" -ge 1 ] && [ "$G2" = "$W2" ] && [ "$HF" = 0 ] && [ "$HFT" -ge 1 ] && echo 0 || echo 1)" "init --suggest：新加的 db/schema.sql 与 app/（4 个 .py）各被报出、已列的 sql/001_a.sql 与 svc 不报，退出码 1，人读输出点名两者；填进配置后退出码 0、ok true、写「配置跟得上项目，没有漏项」" "$W1 | 人读 rc=1 点名两者 | $W2 | 人读 rc=0 含「没有漏项」" "$G1 | 人读 rc=$HM 点名=$H1/$H2 | $G2 | 人读 rc=$HF 含=$HFT"
# 12b 打死：ignore 排掉的目录与建表文件也报、已有代码根在里面的顶层目录也报、只有 2 个代码文件的顶层目录也报（提醒太吵，人就不看了）；real/ 是正例，防得到空答案就算过
SC="$TMP/sc"; mkdir -p "$SC/tests" "$SC/pkg/api" "$SC/pkg/web"; : >"$SC/Product-Spec.md"
sg_files "$SC/tests" 5 py; : >"$SC/tests/schema.sql"; sg_files "$SC/pkg/api" 3 py; sg_files "$SC/pkg/web" 5 py; sg_files "$SC/tiny" 2 py; sg_files "$SC/real" 4 ts
sg_cfg "$SC" '"Product-Spec.md"' '[]' '["pkg/api"]' '[]'; sg_run "$SC"; G3="rc=$RCS $(sg_get)"
W3='rc=1 [false,[],["real"],null,[]]'
chk "$([ "$G3" = "$W3" ] && echo 0 || echo 1)" "init --suggest 收窄：被 ignore 排掉的 tests/（5 个 .py + schema.sql）、已有代码根 pkg/api 的 pkg（另有 pkg/web 5 个 .py）、只有 2 个 .py 的 tiny 都不报；只剩 real/（4 个 .ts）" "$W3" "$G3"
# 12c 打死：spec 是 null 而根目录有 Product-Spec.md 不报 / archDocs 里没有 Architecture-Design.md 不报 / 已列的别的架构文档也跟着报；填好后仍报
SD="$TMP/sd"; mkdir -p "$SD/docs"; : >"$SD/Product-Spec.md"; : >"$SD/Architecture-Design.md"; : >"$SD/docs/arch-old.md"
sg_cfg "$SD" 'null' '[]' '[]' '["docs/arch-old.md"]'; sg_run "$SD"; G4="rc=$RCS $(sg_get)"
sg_cfg "$SD" '"Product-Spec.md"' '[]' '[]' '["docs/arch-old.md","Architecture-Design.md"]'; sg_run "$SD"; G5="rc=$RCS $(sg_get)"
W4='rc=1 [false,[],[],"Product-Spec.md",["Architecture-Design.md"]]'; W5='rc=0 [true,[],[],null,[]]'
chk "$([ "$G4" = "$W4" ] && [ "$G5" = "$W5" ] && echo 0 || echo 1)" "init --suggest：spec 为 null 而根目录有 Product-Spec.md、archDocs 里缺根目录的 Architecture-Design.md，各自报出（已列的 docs/arch-old.md 不报）；填好后退出码 0" "$W4 | $W5" "$G4 | $G5"
# 12e 打死：spec 写 null / 架构文档有意不出时，把文件名写进 ignore 仍照报（没有出口，每次提交都报、照填就改回用户的决定）；ignore 一份却把两份都排掉，或排掉后退出码不是 0 / 不写「没有漏项」
se_cfg() {  # se_cfg <root> <ignore JSON>
  printf '{"version":1,"title":"t","spec":null,"ddl":[],"codeRoots":[],"ignore":%s,"archDocs":[]}\n' "$2" >"$1/docs/readable-src/config.json"
}
SE="$TMP/se"; mkdir -p "$SE/docs/readable-src"; : >"$SE/Product-Spec.md"; : >"$SE/Architecture-Design.md"
se_cfg "$SE" '["Product-Spec.md","Architecture-Design.md"]'; run init --suggest --root "$SE"; HE=$RC; HET=$(grep -cF '配置跟得上项目，没有漏项' "$TMP/out" || true); sg_run "$SE"; E1="rc=$RCS $(sg_get)"
se_cfg "$SE" '["Product-Spec.md"]'; sg_run "$SE"; E2="rc=$RCS $(sg_get)"
se_cfg "$SE" '["Architecture-Design.md"]'; sg_run "$SE"; E3="rc=$RCS $(sg_get)"
WE1='rc=0 [true,[],[],null,[]]'; WE2='rc=1 [false,[],[],null,["Architecture-Design.md"]]'; WE3='rc=1 [false,[],[],"Product-Spec.md",[]]'
chk "$([ "$HE" = 0 ] && [ "$HET" -ge 1 ] && [ "$E1" = "$WE1" ] && [ "$E2" = "$WE2" ] && [ "$E3" = "$WE3" ] && echo 0 || echo 1)" "init --suggest：spec 为 null、根目录有两份文档，ignore 写了两个文件名则不报（退出码 0、人读写「没有漏项」）；拿掉 Architecture-Design.md 只报它；拿掉 Product-Spec.md 只报它" "人读 rc=0 含「没有漏项」 | $WE1 | $WE2 | $WE3" "人读 rc=$HE 含=$HET | $E1 | $E2 | $E3"
# 12d 打死：--suggest 悄悄改配置或往项目里落文件（含 --json 与人读两种）；没有配置时退出码不是 2、或顺手建了配置
sg_cfg "$SA" '"Product-Spec.md"' '["sql/001_a.sql"]' '["svc"]' '[]'; T0=$(tree "$SA"); H0=$(sha256sum "$SA/docs/readable-src/config.json")
run init --suggest --root "$SA"; RCH=$RC; run init --suggest --json --root "$SA"; RCJ2=$RC; T1=$(tree "$SA"); H1c=$(sha256sum "$SA/docs/readable-src/config.json")
SN="$TMP/sn"; mkdir -p "$SN/db"; : >"$SN/db/schema.sql"; N0=$(tree "$SN"); run init --suggest --root "$SN"; RCN=$RC; NO=$(cat "$TMP/out" "$TMP/err" | grep -cE '先.{0,4}init' || true); N1=$(tree "$SN")
chk "$([ "$RCH|$RCJ2" = "1|1" ] && [ "$T0" = "$T1" ] && [ "$H0" = "$H1c" ] && [ "$RCN" = 2 ] && [ "$NO" -ge 1 ] && [ "$N0" = "$N1" ] && [ ! -e "$SN/docs" ] && echo 0 || echo 1)" "init --suggest 只读：有漏项时（两种都真跑到了：退出码 1）跑完人读与 --json 两种，项目目录总哈希与配置哈希不变；没有配置时退出码恰为 2、提示「先…init」（不是用法串）、没建 docs" "rc=1|1 tree 同|config 同|rc=2|提示含先 init|无 docs" "rc=$RCH|$RCJ2 tree $([ "$T0" = "$T1" ] && echo 同 || echo 变)|config $([ "$H0" = "$H1c" ] && echo 同 || echo 变)|rc=$RCN|先 init 提示=$NO|docs=$([ -e "$SN/docs" ] && echo 有 || echo 无)"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
