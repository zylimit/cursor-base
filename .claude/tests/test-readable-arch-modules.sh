#!/usr/bin/env bash
# risk: high
# test-readable-arch-modules.sh — 人读文档 · 模块的项目判断、汇总与说明黑盒回归（docs/readable-spec/phase3-arch-contract.md A、B「汇总成模块」、C 节与 arch 形状）。
# 断言只从契约推导，入口 build --facts-json 的 arch、pending --json、note put。夹具全是合成项目，mktemp -d + --root。页面与 check 不在这里。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-arch-modules ====="
if ! command -v node >/dev/null 2>&1; then echo "SKIPPED: 无 node，未执行 != 通过。"; exit 0; fi
[ -f "$ENGINE" ] || { echo "  [FAIL] 缺被测脚本：$ENGINE" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
eq() {  # eq <标题> <EXPECT> <GOT>
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$1"; else FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; fi
  printf '         EXPECT %s\n         GOT    %s\n' "$2" "$3"
}
nd() { env -u CLAUDE_PROJECT_DIR node "$ENGINE" "$@"; }
facts() { RC=0; nd build --facts-json --root "$1" >"${2:-$TMP/f.json}" 2>"$TMP/err" || RC=$?; }
J() { node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const M=i=>d.arch.modules.find(m=>m.id==i);const r=eval(process.argv[2]);console.log(typeof r==="string"?r:JSON.stringify(r))' "${2:-$TMP/f.json}" "$1" 2>/dev/null || echo JSONERR; }
yn() { if "$@" >/dev/null 2>&1; then printf y; else printf n; fi; }
w() { local f=$1; shift; mkdir -p "$(dirname "$R/$f")"; printf '%s\n' "$@" >"$R/$f"; }
mkcfg() { mkdir -p "$1/docs/readable-src" "$1/sql"; : >"$1/Product-Spec.md"
  printf 'CREATE TABLE orders (id int PRIMARY KEY);\nCREATE TABLE items (id int PRIMARY KEY);\nCREATE TABLE logs (id int PRIMARY KEY);\n' >"$1/sql/s.sql"
  printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["sql/s.sql"],"codeRoots":%s,"ignore":[]}\n' "$2" >"$1/docs/readable-src/config.json"; }
map() { printf '{"version":1,"tableGroups":[],"dynamicTables":[],%s}\n' "$2" >"$1/docs/readable-src/map.json"; }
mapedit() { node -e 'const fs=require("fs");const f=process.argv[1]+"/docs/readable-src/map.json";const m=JSON.parse(fs.readFileSync(f,"utf8"));eval(process.argv[2]);fs.writeFileSync(f,JSON.stringify(m))' "$1" "$2"; }
st() { J "(n=>n?n.status+'/'+n.state:'absent')(d.notes['$1'])"; }
pj() { nd pending --json --root "$1" >"$TMP/p.json" 2>&1 || true; }
LY='"layers":["接口","业务","数据"]'
mod() { printf '{"id":"%s","title":"t-%s","layer":"%s","paths":[%s],"status":"proposed"}' "$1" "$1" "$2" "$3"; }

# 主夹具：api(甲，通配 *) / ingest(乙，** 大范围，与甲重叠) / store；store 内部互引；api→ingest→store 全是向下
R="$TMP/m"; mkcfg "$R" '["app"]'
map "$R" "$LY,\"modules\":[$(mod api 接口 '"app/api/*.py"'),$(mod ingest 业务 '"app/ingest/**","app/api/**"'),$(mod store 数据 '"app/store/**"')]"
w app/api/jobs.py 'from fastapi import APIRouter' 'import app.ingest.helpers' 'from ..ingest.runner import run_job' 'router = APIRouter(prefix="/jobs")' 'Q = "SELECT a FROM orders"' '@router.get("/list")' 'def list_jobs(): return 1'
w app/api/health.py 'from .jobs import router'; w app/api/sub/x.py 'X = 1'
w app/ingest/runner.py 'import requests' 'from ..store.db import save' 'def run_job(): return 1' 'W = "INSERT INTO items (a) VALUES (1)"' 'if __name__ == "__main__":' '    run_job()'
w app/ingest/helpers.py 'H = 1'; w app/ingest/cli.py 'if __name__ == "__main__":' '    pass'
w app/store/db.py 'import psycopg' 'def save(): pass' 'Q1 = "SELECT a FROM items JOIN orders ON 1=1"' 'Q2 = "INSERT INTO orders (x) VALUES (1)"' 'Q3 = "DELETE FROM logs"'
w app/store/db2.py 'from .db import save' 'Q = "INSERT INTO orders (x) VALUES (2)"'
w app/misc/stray.py 'S = 1'; seq 1 1001 | sed 's/^/x=/' >"$R/app/misc/big1001.py"; seq 1 1000 | sed 's/^/x=/' >"$R/app/misc/big1000.py"
facts "$R"; MRC=$RC; cp "$TMP/f.json" "$TMP/main.json"

# 1 打死：重叠文件两边都算 / 后到的抢走 / * 跨了目录 / 未归属被塞进模块或丢掉 / 文件重复或漏算
eq "归属：app/api/jobs.py 只在先写的 api（* 不跨目录，sub/x.py 只归 ingest）、ingest 不含它；problems 有 double；未匹配的 stray 只在 unassigned；各模块 files 加 unassigned 与 code.files 不重不漏" \
  "0|app/api/health.py,app/api/jobs.py|false|true|true|app/misc/big1000.py,app/misc/big1001.py,app/misc/stray.py|true" \
  "$MRC|$(J "M('api').files.join()+'|'+M('ingest').files.includes('app/api/jobs.py')+'|'+M('ingest').files.includes('app/api/sub/x.py')+'|'+d.arch.problems.some(p=>p.kind=='double')+'|'+d.arch.unassigned.join()+'|'+(a=>a.length==new Set(a).size&&a.sort().join()==d.code.files.map(f=>f.path).sort().join())([...d.arch.modules.flatMap(m=>m.files),...d.arch.unassigned])")"

# 3 打死：模块内部引用算依赖（自指）/ 方向反了 / pairs 或 names 丢 / provides 的 by 写成提供方 / 整文件引用不记 *
eq "依赖：api.uses 只有 ingest（health→jobs 同模块不算），pairs 两对（runner、整文件 helpers），names 含 run_job 与 *（整文件引用）；ingest.usedBy 是 api、不含自己；store.uses 为空（db2→db 同模块）、store.usedBy 是 ingest" \
  'ingest|[["app/api/jobs.py","app/ingest/helpers.py"],["app/api/jobs.py","app/ingest/runner.py"]]|true|api|[]|ingest|store|true' \
  "$(J "M('api').uses.map(u=>u.module).join()+'|'+JSON.stringify(M('api').uses[0].pairs.sort())+'|'+M('api').uses[0].names.includes('run_job')+'|'+M('ingest').usedBy.join()+'|'+JSON.stringify(M('store').uses)+'|'+M('store').usedBy.join()+'|'+M('ingest').uses.map(u=>u.module).join()+'|'+M('api').uses[0].names.includes('*')" "$TMP/main.json")"
eq "对外提供：ingest 的 run_job 在 runner.py 被 api 用、整个文件被引用的 helpers.py 名字是 *；store 的 save 只被 ingest 用（同模块 db2 不算 by）" \
  "*:app/ingest/helpers.py:api,run_job:app/ingest/runner.py:api|save:app/store/db.py:ingest" \
  "$(J "M('ingest').provides.map(p=>p.name+':'+p.file+':'+p.by.join()).sort().join()+'|'+M('store').provides.map(p=>p.name+':'+p.file+':'+p.by.join()).join()" "$TMP/main.json")"

# 5 打死：读写表串位 / 不去重不排序 / DELETE FROM 当读 / 行数外部包不汇总 / 接口丢
eq "汇总：store 读 items,orders、写 logs,orders（两个文件都写 orders，去重；DELETE FROM 不算读）；ingest 写 items；api 读 orders；api 的接口 list_jobs；store 行数 7；externals 按模块并起来" \
  "items,orders|logs,orders|items|orders|list_jobs@app/api/jobs.py|7|psycopg|requests" \
  "$(J "M('store').tables.reads.join()+'|'+M('store').tables.writes.join()+'|'+M('ingest').tables.writes.join()+'|'+M('api').tables.reads.join()+'|'+M('api').routes.map(r=>r.handler+'@'+r.file).join()+'|'+M('store').lines+'|'+M('store').externals.join()+'|'+M('ingest').externals.join()" "$TMP/main.json")"

# 7 打死：big 阈值差一（>=1000 或 >1001）/ idle 把入口或被引用的算进去 / 没人引用没入口的漏掉
eq "big：1001 行的在、1000 行的不在；idle：没入口没人引用的 db2.py 在，有入口没人引用的 cli.py、被引用的 db.py 不在" \
  "app/misc/big1001.py:1001|true|false|false" \
  "$(J "d.arch.big.map(b=>b.file+':'+b.lines).join()+'|'+d.arch.idle.includes('app/store/db2.py')+'|'+d.arch.idle.includes('app/ingest/cli.py')+'|'+d.arch.idle.includes('app/store/db.py')" "$TMP/main.json")"
eq "对照：主夹具（全向下、无环）cycles 与 upward 为空，problems 只有 api/ingest 重叠那一条 double" "[]|[]|double" "$(J "JSON.stringify(d.arch.cycles)+'|'+JSON.stringify(d.arch.upward)+'|'+d.arch.problems.map(p=>p.kind).join()" "$TMP/main.json")"

# 2 打死：对不上的让 build 失败 / 四种缺一种 / 空模块被丢 / 干净的也报
R="$TMP/c"; mkcfg "$R" '["app"]'; w app/a/x.py 'A=1'; w app/b/y.py 'B=1'; w app/c/z.py 'C=1'; w app/d/w.py 'D=1'; w app/e/v.py 'E=1'; w app/f/u.py 'F=1'
FM1='{"id":"fmt1","title":"t","layer":"业务","paths":["app/e/**"],"status":"done"}'; FM2='{"id":"fmt2","title":"t","layer":"业务","paths":"app/f/**","status":"proposed"}'
map "$R" "$LY,\"modules\":[$(mod a 业务 '"app/a/**"'),$(mod ghost 业务 '"nowhere/**"'),$(mod badlayer 不存在 '"app/b/**"'),$(mod Bad_Id 业务 '"app/c/**"'),$(mod a 业务 '"app/d/**"'),$FM1,$FM2,$(mod later 业务 '"app/c/**"')]"
facts "$R"; C1=$RC; K1=$(J "d.arch.problems.map(p=>p.kind).sort().join()+'|'+M('later').files.join()+'|'+(M('Bad_Id')||{files:[]}).files.includes('app/c/z.py')+'|'+d.arch.problems.filter(p=>p.kind=='empty').map(p=>p.module).join()"); K1=${K1#\"}; G1=$(J "M('ghost').files.length+'|'+M('ghost').layer")
map "$R" "$LY,\"modules\":[$(mod a 业务 '"app/a/**"'),$(mod b 数据 '"app/b/**"')]"; facts "$R"
eq "项目判断对不上：空 paths / 层名不在 layers / id 写法 / id 重复 / status 写成 done / paths 写成字符串各一条（paths 不成形的 fmt2 只记 format、不顺带记 empty；种类恰为 empty,format,format,id,id,layer，那条 empty 属于匹配不到文件的 ghost），退出码 0；id 不合写法的模块整个不用（它的 z.py 归后面的 later、不在它自己里）；ghost 仍在、files 为空；对照干净 map：problems 为空、退出码 0" \
  "0|empty,format,format,id,id,layer|app/c/z.py|false|ghost|0|业务|0|" "$C1|$K1|$G1|$RC|$(J "d.arch.problems.map(p=>p.kind).join()")"

# 4 打死：循环漏报或成员错 / 越层方向反了 / 向下引用误报 / 拿掉环后残留（三层：up 接口、mid 业务、low 数据）
R="$TMP/b"; mkcfg "$R" '["p"]'; map "$R" "$LY,\"modules\":[$(mod up 接口 '"p/up/**"'),$(mod mid 业务 '"p/mid/**"'),$(mod low 数据 '"p/low/**"')]"
w p/up/a.py 'from ..mid.b import f' 'def g(): pass'; w p/mid/b.py 'from ..up.a import g' 'def f(): pass'; w p/low/c.py 'from ..up.a import g'
facts "$R"; V1=$(J "d.arch.cycles.length+'|'+d.arch.cycles[0].modules.sort().join()+'|'+d.arch.upward.map(u=>u.from+'>'+u.to).sort().join()")
w p/mid/b.py 'def f(): pass'; facts "$R"
eq "循环与越层：up↔mid 成一组环（两个都在）；upward 是 low>up 与 mid>up（from 是下层），向下的 up>mid 不在；拿掉 mid 对 up 的引用后环为空、upward 只剩 low>up" \
  "1|mid,up|low>up,mid>up|0|low>up" "$V1|$(J "d.arch.cycles.length+'|'+d.arch.upward.map(u=>u.from+'>'+u.to).join()")"

# 6 打死：有 modules 还按目录分 / 无 modules 不分 / 子目录没并进一级 / 根下文件丢 / 无 codeRoots 仍有模块 / status 不照写
R="$TMP/d"; mkcfg "$R" '["svc"]'; w svc/top.py 'T=1'; w svc/alpha/a.py 'A=1'; w svc/beta/b.py 'B=1'; w svc/beta/deep/c.py 'C=1'; facts "$R"
D1=$(J "d.arch.source+'|'+d.arch.modules.length+'|'+[...new Set(d.arch.modules.map(m=>m.status))].join()+'|'+M('beta').files.join()+'|'+d.arch.modules.filter(m=>m.files.join()=='svc/top.py').length+'|'+d.arch.modules.map(m=>m.id).filter(i=>i=='alpha'||i=='beta').sort().join()")
map "$R" "\"modules\":[{\"id\":\"all\",\"title\":\"全部\",\"layer\":null,\"paths\":[\"svc/**\"],\"status\":\"confirmed\"}]"; facts "$R"; D2=$(J "d.arch.source+'|'+M('all').status+'|'+M('all').files.length")
mkcfg "$TMP/e" '[]'; facts "$TMP/e"
eq "按目录分：source dirs、三个模块（alpha、beta、根下文件各成一个）、status 都是 default、beta 含 deep/c.py；有 modules 时 source map、status 照写（confirmed）；没配 codeRoots 时 modules 为空数组" \
  "dirs|3|default|svc/beta/b.py,svc/beta/deep/c.py|1|alpha,beta|map|confirmed|4|[]" "$D1|$D2|$(J "JSON.stringify(d.arch.modules)")"

# 8 打死：加文件/接口/依赖不标过期（页面话跟不上）/ 改函数体就标过期 / 孤儿丢 / doc:arch 不跟模块清单 / 写完还列待写
N="$TMP/n"; cp -r "$TMP/m" "$N"; pj "$N"; P0=$(yn grep -qF module:api "$TMP/p.json")$(yn grep -qF module:ingest "$TMP/p.json")$(yn grep -qF doc:arch "$TMP/p.json")
printf '## module:api\n接口层。\n\n## doc:arch\n系统导读。\n' >"$TMP/in.md"; RC=0; nd note put --file "$TMP/in.md" --root "$N" >/dev/null 2>&1 || RC=$?
facts "$N"; S0="$(st module:api)|$(st doc:arch)"; pj "$N"; P1=$(yn grep -qF module:api "$TMP/p.json")$(yn grep -qF module:ingest "$TMP/p.json")$(yn grep -qF doc:arch "$TMP/p.json")
eq "说明落盘：未写时 pending 列 module:api、module:ingest、doc:arch；put 两段退出码 0、都是 draft/current；之后 pending 不再列这两段、仍列没写的 module:ingest" "yyy|0|draft/current|draft/current|nyn" "$P0|$RC|$S0|$P1"
cp -r "$N" "$TMP/n1"; w2() { R="$1"; shift; w "$@"; }; w2 "$TMP/n1" app/api/extra.py 'E=1'; facts "$TMP/n1"; A1=$(st module:api); pj "$TMP/n1"; A1P=$(yn grep -qF 接口层。 "$TMP/p.json")$(yn grep -qF module:api "$TMP/p.json")
cp -r "$N" "$TMP/n2"; sed -i 's/return 1/return 2/' "$TMP/n2/app/api/jobs.py"; facts "$TMP/n2"; A2="$(st module:api)|$(st doc:arch)"
cp -r "$N" "$TMP/n3"; mapedit "$TMP/n3" 'm.modules=m.modules.filter(x=>x.id!="api")'; facts "$TMP/n3"; A3="$(st module:api)|$(J "d.orphanNotes.map(o=>o.anchor).join()")"; pj "$TMP/n3"; A3P=$(yn grep -qF 接口层。 "$TMP/p.json")
cp -r "$N" "$TMP/n4"; mapedit "$TMP/n4" 'm.modules.push({id:"extra",title:"额外",layer:"业务",paths:["app/misc/**"],status:"proposed"})'; facts "$TMP/n4"; A4="$(st doc:arch)|$(st module:api)"
eq "过期判定：往 api 目录加文件 → module:api 待更新、pending 带旧正文；只改函数体 → 仍 current；删掉 api 模块 → 成孤儿（notes 无、orphanNotes 有、pending 带正文）；加一个模块 → doc:arch 待更新而 module:api 不动" \
  "draft/stale|yy|draft/current|draft/current|absent|module:api|y|draft/stale|draft/current" "$A1|$A1P|$A2|$A3|$A3P|$A4"

# 9 打死：坏锚点放进半批 / archDocs 指向不存在的文件不报 / init 不起草 archDocs 与测试文件排除
N="$TMP/n5"; cp -r "$TMP/m" "$N"; printf '## module:nope\n不存在的模块。\n\n## doc:arch\n导读。\n' >"$TMP/in.md"; RC=0; nd note put --file "$TMP/in.md" --root "$N" >/dev/null 2>&1 || RC=$?; PRC=$RC; facts "$N"; X1="$PRC|$(st doc:arch)"
node -e 'const fs=require("fs");const f=process.argv[1]+"/docs/readable-src/config.json";const c=JSON.parse(fs.readFileSync(f));c.archDocs=["docs/nope.md"];fs.writeFileSync(f,JSON.stringify(c))' "$N"; facts "$N"; X2="$RC|$(yn grep -qF archDocs "$TMP/err")"
R="$TMP/i"; mkdir -p "$R/sql" "$R/app"; : >"$R/Product-Spec.md"; echo '# arch' >"$R/Architecture-Design.md"; echo 'CREATE TABLE t (id int);' >"$R/sql/schema.sql"; echo 'A=1' >"$R/app/x.py"; RC=0; nd init --root "$R" >/dev/null 2>&1 || RC=$?
X3="$RC|$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(JSON.stringify([c.archDocs,["**/*.test.*","**/*.spec.*","**/__tests__/**"].every(p=>c.ignore.includes(p))]))' "$R/docs/readable-src/config.json" 2>/dev/null || echo NOCFG)"
eq "拒收与配置错：module:nope 整批拒收（退出码 2、同批的 doc:arch 也没落盘）；archDocs 指向不存在的文件 build 退出码 2 且点名 archDocs；init 起草 archDocs 含 Architecture-Design.md、ignore 含三条测试文件排除" \
  '2|absent|2|y|0|[["Architecture-Design.md"],true]' "$X1|$X2|$X3"

# 10 打死：上下文不封顶 / 没有上下文 / 同输入两次输出不同
R="$TMP/g"; mkcfg "$R" '["app"]'; map "$R" "\"modules\":[$(mod big 业务 '"app/big/**"')]"; for i in $(seq -w 1 40); do w app/big/f$i.py "\"\"\"$(printf 'Module number %s does one thing and then another thing, described at length here. %.0s' "$i" 1 2)\"\"\""; done
pj "$R"; facts "$R"; facts "$R" "$TMP/f2.json"
eq "pending --json 里 module:big 的上下文非空且不超过 4096 字节（40 个文件、文件头说明合计远超 4KB，必须截）；同一输入两次 --facts-json 逐字节相同且有 arch" "40|y|y|object|same" \
  "$(J "M('big').files.length" "$TMP/f.json")|$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const f=o=>{if(o&&typeof o=="object"){if(o.anchor=="module:big")return o;for(const k in o){const r=f(o[k]);if(r)return r}}};const it=f(d);const c=JSON.stringify(it&&it.context||"");console.log((c.includes("app/big/f")?"y":"n")+"|"+(Buffer.byteLength(c)<=4096?"y":"n"))' "$TMP/p.json" 2>/dev/null || echo NOPJ)|$(J "typeof d.arch" "$TMP/f.json")|$(cmp -s "$TMP/f.json" "$TMP/f2.json" && echo same || echo differ)"
# ---- 整期审查之后补的（2026-11-23）：合成项目各自另起一份 ----
# 11 打死：模块级 FastAPI 应用（带类型标注 / 写成 fastapi.FastAPI(…)）不认入口，服务的启动文件掉进「没人引用」清单；函数里的 app = FastAPI() 与只有 APIRouter 的也被当入口
R="$TMP/en"; mkcfg "$R" '["app"]'
w app/srv/main.py 'from fastapi import FastAPI' 'app = FastAPI()'
w app/srv/typed.py 'from fastapi import FastAPI' 'app: FastAPI = FastAPI()'
w app/srv/qual.py 'import fastapi' 'app = fastapi.FastAPI(title="t")'
w app/srv/infn.py 'from fastapi import FastAPI' 'def make():' '    app = FastAPI()' '    return app'
w app/srv/onlyrouter.py 'from fastapi import APIRouter' 'router = APIRouter()'
facts "$R" "$TMP/en.json"
eq "入口：模块级 app = FastAPI() / 带类型标注 / fastapi.FastAPI(…) 三种 entry 为真；写在函数里的、只有 APIRouter 的为假；arch.idle 里恰是后两个（前三个有入口，不再出现）" "true true true false false|app/srv/infn.py,app/srv/onlyrouter.py" "$(J "['main','typed','qual','infn','onlyrouter'].map(n=>d.code.files.find(f=>f.path=='app/srv/'+n+'.py').entry).join(' ')+'|'+d.arch.idle.join()" "$TMP/en.json")"
# 12 打死：codeRoots 下一个代码文件都没取到（只有没扫的扩展名）而 map.json 写了模块时仍出一份空壳，让人以为扫过
R="$TMP/nc"; mkcfg "$R" '["web"]'; w web/a.vue '<template/>'; map "$R" "$LY,\"modules\":[$(mod ui 接口 '"web/**"')]"
facts "$R" "$TMP/nc.json"
eq "codeRoots 下只有 .vue、map.json 写了模块：退出码 0、code.files 为空、arch.modules 是空数组（不出空壳）" "0|0|[]" "$RC|$(J "d.code.files.length" "$TMP/nc.json")|$(J "JSON.stringify(d.arch.modules)" "$TMP/nc.json")"
# 13 打死：没有 layers（没写 / 写成空数组）而模块写了 layer 时不报对不上；layer 为 null 的误报
R="$TMP/ly"; mkcfg "$R" '["app"]'; w app/a/x.py 'A = 1'
map "$R" "\"modules\":[$(mod a 业务 '"app/a/**"')]"; facts "$R" "$TMP/ly1.json"
map "$R" "\"layers\":[],\"modules\":[$(mod a 业务 '"app/a/**"')]"; facts "$R" "$TMP/ly2.json"
map "$R" "\"modules\":[{\"id\":\"a\",\"title\":\"t\",\"layer\":null,\"paths\":[\"app/a/**\"],\"status\":\"proposed\"}]"; facts "$R" "$TMP/ly3.json"
eq "没写 layers 而模块写了 layer、layers 写成空数组而模块写了 layer：problems 各恰一条 layer、该模块的层记 null；对照没写 layers 而模块的 layer 为 null：problems 为空" "layer/null|layer/null|" "$(J "d.arch.problems.map(p=>p.kind).join()+'/'+M('a').layer" "$TMP/ly1.json")|$(J "d.arch.problems.map(p=>p.kind).join()+'/'+M('a').layer" "$TMP/ly2.json")|$(J "d.arch.problems.map(p=>p.kind).join()" "$TMP/ly3.json")"
# 14 打死：pending --json 的模块上下文里接口路径带内网地址原样贴出（上下文会被贴进派单与日志）；上下文里根本没有接口（非空转）
R="$TMP/rd"; mkcfg "$R" '["app"]'; map "$R" "\"modules\":[$(mod api 接口 '"app/api/**"')]"
w app/api/p.py 'from fastapi import FastAPI' 'app = FastAPI()' '@app.get("/proxy/10.20.30.40/data")' 'def px(): pass'
pj "$R"
eq "接口路径里有内网地址 10.20.30.40：pending --json 里 module:api 的上下文带着接口（含 /proxy/）、但看不到那个地址" "y|n" "$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const f=o=>{if(o&&typeof o=="object"){if(o.anchor=="module:api")return o;for(const k in o){const r=f(o[k]);if(r)return r}}};const it=f(d);const c=JSON.stringify(it&&it.context||"");console.log((c.includes("/proxy/")?"y":"n")+"|"+(c.includes("10.20.30.40")?"y":"n"))' "$TMP/p.json" 2>/dev/null || echo NOPJ)"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
