#!/usr/bin/env bash
# risk: high
# test-readable-code-routes.sh — 人读文档 · 接口（装饰器路由）黑盒回归（docs/readable-spec/phase3-arch-contract.md B 节「接口」与 code.routes 形状）。
# 断言只从契约推导，入口 build --facts-json 的 code.routes / code.unresolved。夹具全是合成项目，mktemp -d + --root。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-code-routes ====="
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
w() { local f=$1; shift; mkdir -p "$(dirname "$R/$f")"; printf '%s\n' "$@" >"$R/$f"; }
mkcfg() { mkdir -p "$1/docs/readable-src" "$1/sql"; : >"$1/Product-Spec.md"; echo 'CREATE TABLE t1 (id int PRIMARY KEY);' >"$1/sql/s.sql"
  printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["sql/s.sql"],"codeRoots":%s,"ignore":["**/tests/**"]}\n' "$2" >"$1/docs/readable-src/config.json"; }
X="d.code.routes.find(r=>r.handler=="   # 按处理函数名取一条（用法：$X'名')）
N() { echo "v=>v===null?'N':v"; }                                  # null 显成 N，undefined 不会

R="$TMP/m"; mkcfg "$R" '["app/api"]'
w app/api/orphan.py 'from fastapi import APIRouter' 'router = APIRouter(prefix="/api/jobs")' 'def deco(f): return f' '@router.post("/{id}/retry")' '@deco' 'async def retry_job(id):' '    """Retry the job once."""' '    return 1'
w app/api/jobs.py 'from fastapi import APIRouter' 'router = APIRouter(prefix="/api/jobs")' '@router.get("/list")' 'def list_jobs(): pass'
w app/api/users.py 'from fastapi import APIRouter' 'router = APIRouter(prefix="/users")' '@router.get("/me")' 'def me(): pass'
w app/api/main.py 'from fastapi import FastAPI' 'from . import jobs' 'from .users import router as users_router' 'app = FastAPI()' 'app.include_router(jobs.router, prefix="/v2")' 'app.include_router(users_router, prefix="/u")' 'app.include_router(mystery(), prefix="/x")' 'app.include_router(other())' '@app.get("/health")' 'def health(): pass'
w app/api/dyn.py 'from fastapi import APIRouter' 'router = APIRouter(prefix=API_PREFIX)' 'r2 = APIRouter(prefix="/lit")' '@router.get("/a")' 'def dyn_a(): pass' '@r2.get(PATH_VAR)' 'def dyn_b(): pass' '@r2.get("/ok")' 'def dyn_c(): pass'
w app/api/twice.py 'from fastapi import APIRouter' 'router = APIRouter(prefix="/tw")' '@router.get("/t")' 'def tw(): pass'
w app/api/main2.py 'from fastapi import FastAPI' 'from . import twice' 'app2 = FastAPI()' 'app2.include_router(twice.router, prefix="/first")' 'app2.include_router(twice.router, prefix="/second")'
w app/api/others.py 'from fastapi import APIRouter' 'router = APIRouter()' '@router.api_route("/x", methods=["GET", "POST"])' 'def multi(): pass' '@router.websocket("/ws")' 'async def sock(ws): pass' '@router.get(path="/kw")' 'def kw_one(): pass' '@router.api_route("/any", methods=METHODS)' 'def anyone(): pass' '@router.api_route("/dflt")' 'def dflt(): pass'
w app/api/fakes.py 'from fastapi import APIRouter' 'router = APIRouter(prefix="/f")' 'other = Thing()' 'cache = Cache()' 'X = """' '@router.get("/fake1")' '"""' '# @router.get("/fake2")' "S = '@router.get(\"/fake3\")'" 'cache.get("/k")' '@other.get("/x")' 'def not_a_route(): pass' '@router.get("/real")' 'def real(): pass'
w app/api/consts.py 'IMPORTED = "/imp"'
w app/api/vals.py 'from fastapi import APIRouter' 'from .consts import IMPORTED' 'BASE = "/sessions/{sid}"' 'TWICE = "/a"' 'TWICE = "/b"' 'PRE = "/pre"' 'BAD = make()' 'router = APIRouter(prefix=PRE)' 'r3 = APIRouter(prefix="/lit3")' 'def helper():' '    LOC = "/loc"' '@router.get(BASE + "/map")' 'def v_map(): pass' '@router.get(BASE)' 'def v_base(): pass' '@router.get("/lit")' 'def v_lit(): pass' '@r3.get(TWICE)' 'def v_twice(): pass' '@r3.get(BAD)' 'def v_call(): pass' '@r3.get(IMPORTED)' 'def v_imp(): pass' '@r3.get(LOC)' 'def v_loc(): pass'
w app/api/consts2.py 'from .consts import IMPORTED'
w app/api/consts3.py 'DUP = "/d"' 'DUP = "/e"'
w app/api/hop.py 'from fastapi import APIRouter' 'from .consts2 import IMPORTED' 'from .consts3 import DUP' 'router = APIRouter(prefix="/hop")' '@router.get(IMPORTED)' 'def v_hop(): pass' '@router.get(DUP)' 'def v_dup(): pass'
w app/api/child.py 'from fastapi import APIRouter' 'router = APIRouter(prefix="/leaf")' '@router.get("/x")' 'def nested_x(): pass'
w app/api/nest.py 'from fastapi import APIRouter, FastAPI' 'from . import child' 'parent = APIRouter(prefix="/p")' 'parent.include_router(child.router, prefix="/c")' 'app4 = FastAPI()' 'app4.include_router(parent, prefix="/v1")'
w app/api/nest2.py 'from fastapi import APIRouter, FastAPI' 'parent2 = APIRouter(prefix="/p2")' 'parent2.include_router(mystery())' 'app3 = FastAPI()' 'app3.include_router(mystery())'
w app/api/sjobs.py 'from fastapi import APIRouter' 'router = APIRouter(prefix="/sj")' '@router.get("/q")' 'def v_setup(): pass'
# 契约改后没被挂载的路由器完整路径为 null：下面这份应用把原有断言要用的路由器（含 orphan.py）都无前缀挂上，它们的完整路径与改前一样；没被挂的情形另在文末那份合成项目里测
w app/api/mountall.py 'from fastapi import FastAPI' 'from . import dyn, others, fakes, vals, hop, orphan' 'from .dyn import r2' 'from .vals import r3' 'appm = FastAPI()' 'appm.include_router(dyn.router)' 'appm.include_router(r2)' 'appm.include_router(others.router)' 'appm.include_router(fakes.router)' 'appm.include_router(vals.router)' 'appm.include_router(r3)' 'appm.include_router(hop.router)' 'appm.include_router(orphan.router)'
w app/api/setup.py 'from . import sjobs' 'def setup(app):' '    app.include_router(sjobs.router, prefix="/api")'
F="$TMP/m.json"; facts "$R" "$F"
eq "夹具能 build --facts-json（退出码 0，code.routes 是数组）" "0|true" "$RC|$(jf "$F" 'Array.isArray(d.code.routes)')"

# 1 打死：隔装饰器 / async def 的漏掉；方法不大写；path 与 fullPath 混；前缀没拼；doc 丢或带引号；file 错
eq "基本一条：orphan.py 的 retry_job（隔一个装饰器、async）→ 仅 1 条，POST、path、fullPath 拼上路由器前缀 /api/jobs、doc 原文、file" "1|POST|/{id}/retry|/api/jobs/{id}/retry|retry_job|Retry the job once.|app/api/orphan.py" "$(jf "$F" "(x=>x.length+'|'+x.map(r=>[r.method,r.path,r.fullPath,r.handler,r.doc,r.file].join('|')).join())(d.code.routes.filter(r=>r.handler=='retry_job'))")"
# 2 打死：include_router 前缀不拼 / 模块属性与 as 别名只认一种 / 挂载时把别的路由器的前缀混进来（orphan 与 jobs 同前缀同名 router，orphan 无前缀挂载仍只用自己的前缀）
eq "挂载带前缀：jobs.router 挂 /v2 → /v2/api/jobs/list；from .users import router as users_router 挂 /u → /u/users/me；对照 orphan 无前缀挂载 → 仍是 /api/jobs/{id}/retry" "/v2/api/jobs/list /u/users/me /api/jobs/{id}/retry" "$(jf "$F" "['jobs','users','orphan'].map(f=>d.code.routes.filter(r=>r.file=='app/api/'+f+'.py').map(r=>r.fullPath).join()).join(' ')")"
# 3 打死：直接挂在应用对象上的路由漏掉或被拼上别的前缀
eq "@app.get(\"/health\") → GET /health" "GET /health" "$(jf "$F" "d.code.routes.filter(r=>r.handler=='health').map(r=>r.method+' '+r.fullPath).join()")"
# 4 打死：前缀 / 路径是变量时给一个猜的地址（或丢掉接口、或 path 不照写）；对照字面量的照常拼
eq "拼不出的记 null：前缀是从没赋过值的变量 → fullPath null、path 照写 /a；路径是变量 → fullPath null 且接口在；对照同文件字面量 /lit + /ok → /lit/ok" "N|/a|N|/lit/ok" "$(jf "$F" "[$X'dyn_a').fullPath,$X'dyn_a').path,$X'dyn_b').fullPath,$X'dyn_c').fullPath].map($(N)).join('|')")"
# 10 打死：同文件只赋一次的字符串常量不算（当成 null）/ 常量前缀不按值算 / + 拼接不认；以及见名字就硬算（赋两次、调用、别的文件引进来、只在函数里赋过）
eq "算得准的照算（含别的文件引进来跟一层的 IMPORTED → /imp）：BASE + \"/map\"、BASE、字面量 /lit 在 prefix=PRE（常量）的路由器下 → path 记算出的值，fullPath 拼上 /pre" "/sessions/{sid}/map>/pre/sessions/{sid}/map /sessions/{sid}>/pre/sessions/{sid} /lit>/pre/lit /imp>/lit3/imp" "$(jf "$F" "['v_map','v_base','v_lit','v_imp'].map(h=>$X h).path+'>'+$X h).fullPath).join(' ')")"
eq "算不准的仍 null：赋了两次 / 函数调用 / 转了两道手引进来 / 被引文件里赋了两次 / 只在函数里赋过 → fullPath null、path 含源码里的名字；对照同文件 v_map 的 fullPath 照常拼出" "N|true N|true N|true N|true N|true /pre/sessions/{sid}/map" "$(jf "$F" "['v_twice:TWICE','v_call:BAD','v_hop:IMPORTED','v_dup:DUP','v_loc:LOC'].map(s=>{const[h,n]=s.split(':'),r=$X h);return ($(N))(r.fullPath)+'|'+r.path.includes(n)}).join(' ')+' '+$X'v_map').fullPath")"
eq "挂载一路前缀：child（/leaf）→ parent 挂 /c（甲自己前缀 /p）→ app 挂 /v1 → /v1/p/c/leaf/x；甲是函数参数（setup(app)）→ 下面接口 fullPath null、path 照写" "/v1/p/c/leaf/x|N|/q" "$(jf "$F" "$X'nested_x').fullPath+'|'+($(N))($X'v_setup').fullPath)+'|'+$X'v_setup').path")"
eq "乙找不到：甲带前缀的 parent2.include_router(mystery())（nest2.py 第 3 行）要报；对照 app3.include_router(mystery())（第 5 行，确定为空）不报" "1|3" "$(jf "$F" "(u=>u.length+'|'+u.map(e=>e.line).join())(d.code.unresolved.filter(e=>e.file=='app/api/nest2.py'))")"
# 5 打死：挂载没解析到却悄悄吞掉；不带前缀的未解析挂载也报（多报）
eq "unresolved：mystery() 带前缀的挂载（main.py 第 7 行）进一条；other() 不带前缀的不多报一条" "1|7" "$(jf "$F" "(u=>u.length+'|'+u.map(e=>e.line).join())(d.code.unresolved.filter(e=>e.file=='app/api/main.py'))")"
# 6 打死：同一路由器挂两次拼了第二处 / 取最后一处 / 不报另一处
eq "挂两次：取先出现的 /first → /first/tw/t；第二处（main2.py 第 5 行）进 unresolved 且只此一条" "/first/tw/t|1|5" "$(jf "$F" "$X'tw').fullPath+'|'+d.code.unresolved.filter(e=>e.file=='app/api/main2.py').length+'|'+d.code.unresolved.filter(e=>e.file=='app/api/main2.py').map(e=>e.line).join()")"
# 7 打死：api_route 只出一条 / methods 非字面量不记 ANY / websocket 漏或方法不是 WS / path= 取不到
eq "别的写法：api_route methods=[GET,POST] → 两条各 /x；websocket → WS；methods=变量 → ANY；不写 methods → 恰一条 GET（不是 ANY）" "GET,POST|/x,/x|WS|ANY|1GET" "$(jf "$F" "(m=>m.map(r=>r.method).sort().join()+'|'+m.map(r=>r.fullPath).join()+'|'+$X'sock').method+'|'+$X'anyone').method+'|'+(q=>q.length+q[0].method)(d.code.routes.filter(r=>r.handler=='dflt')))(d.code.routes.filter(r=>r.handler=='multi'))")"
eq "path= 关键字取到 /kw；普通 def 照认；没有文档串 doc 为 null（不是空串）；对照 retry_job 的 doc 在" "/kw|N|1|Retry the job once." "$(jf "$F" "[$X'kw_one').path,$X'kw_one').doc].map($(N)).join('|')+'|'+d.code.routes.filter(r=>r.handler=='kw_one').length+'|'+$X'retry_job').doc")"
# 8 打死：文档串 / # 注释 / 字符串里的装饰器当真；非路由器对象的同名方法、调用当真
eq "不该算的：fakes.py 只有真的 /f/real 一条（文档串 / 注释 / 字符串 / cache.get / @other.get 都不算）；全项目共 26 条（对照：别处的真路由都在）" "/f/real|26" "$(jf "$F" "d.code.routes.filter(r=>r.file=='app/api/fakes.py').map(r=>r.fullPath).join()+'|'+d.code.routes.length")"
# 9 打死：乱序 / 方法小写 / 输出带时间；没路由的项目 routes 缺席或不是空数组
eq "清单形状：routes 按文件、行排序；方法全大写；共 26 条（非空转）" "true|true|26" "$(jf "$F" "(r=>r.every((x,i)=>i==0||r[i-1].file<x.file||(r[i-1].file==x.file&&r[i-1].line<=x.line))+'|'+r.every(x=>/^[A-Z]+\$/.test(x.method))+'|'+r.length)(d.code.routes)")"
facts "$R" "$TMP/m2.json"
eq "同一份输入两次 --facts-json 逐字节相同（且 routes 非空，非空转）" "same|true" "$(cmp -s "$F" "$TMP/m2.json" && echo same || echo differs)|$(jf "$F" 'd.code.routes.length>10')"
# ---- 整期审查之后补的（2026-11-23）：挂载认不出 / 子应用 / 认不出路由器的装饰器 / 原文无行号。合成项目另起一份 ----
R="$TMP/x"; mkcfg "$R" '["app/api"]'
w app/api/unm.py 'from fastapi import APIRouter' 'router = APIRouter(prefix="/un")' '@router.get("/a")' 'def un_a(): pass'
w app/api/mm.py 'from fastapi import APIRouter' 'rtr = APIRouter(prefix="/users")' '@rtr.get("/list")' 'def mm_list(): pass'
w app/api/mm_main.py 'from fastapi import FastAPI' 'from . import mm' 'def make(): return mm.rtr' 'appx = FastAPI()' 'appx.include_router(make(), prefix="/admin")'
w app/api/prop.py 'from fastapi import APIRouter' 'par = APIRouter(prefix="/pp")' 'kid = APIRouter(prefix="/kk")' 'par.include_router(kid, prefix="/c")' '@kid.get("/x")' 'def kid_x(): pass'
w app/api/app_only.py 'from fastapi import FastAPI' 'app = FastAPI()' '@app.get("/hello")' 'def hello(): pass' '@app.trace("/tr")' 'def tr_h(): pass'
w app/api/rt.py 'from fastapi import APIRouter, FastAPI' 'appr = FastAPI()' 'rr1 = APIRouter(prefix=f"/{ver}")' '@rr1.get("/ping")' 'def rt_ping(): pass' 'appr.include_router(rr1)'
w app/api/sub.py 'from fastapi import FastAPI' 'from fastapi.staticfiles import StaticFiles' 'sub = FastAPI()' '@sub.get("/pong")' 'def sub_pong(): pass' 'apps = FastAPI()' 'apps.mount("/v2", sub)' 'apps.mount("/static", StaticFiles(directory="d"))'
w app/api/un1.py 'from fastapi import APIRouter' 'def attach(rtr):' '    @rtr.get("/param")' '    def by_param(): pass' 'if FLAG:' '    rr = APIRouter(prefix="/a")' 'else:' '    rr = APIRouter(prefix="/b")' '@rr.get("/branch")' 'def by_branch(): pass'
w app/api/mk.py 'from unittest import mock' 'import cache' '@mock.patch("a.b")' 'def t1(m): pass' '@cache.get("key")' 'def t2(): pass'
w app/api/tw.py 'from fastapi import APIRouter, FastAPI' 'tr = APIRouter(prefix="/tw")' '@tr.get("/t")' 'def tw_t(): pass' 'a1 = FastAPI()' 'a1.include_router(tr, prefix="/one")' 'a1.include_router(tr, prefix="/two")'
w app/api/bad.py 'Q = """never closed' 'x = 1'
w app/api/fac1.py 'from fastapi import APIRouter' 'def make_router():' '    r = APIRouter(prefix="/fac")' '    return r' 'fr = make_router()' '@fr.get("/one")' 'def fac_one(): pass'
w app/api/facapp.py 'from fastapi import FastAPI' 'from . import fac1' 'appf = FastAPI()' 'appf.include_router(fac1.fr, prefix="/api")'
w app/api/fac2.py 'from fastapi import APIRouter, FastAPI' 'def make(prefix):' '    r = APIRouter(prefix=prefix)' '    return r' 'ra = make("/a")' 'rb = make("/b")' '@ra.get("/p")' 'def fac_p(): pass' 'appt = FastAPI()' 'appt.include_router(ra)' 'appt.include_router(rb)'
w app/api/fac3.py 'from fastapi import APIRouter, FastAPI' 'def make2():' '    r1 = APIRouter(prefix="/x1")' '    r2 = APIRouter(prefix="/x2")' '    return r1' 'fq = make2()' '@fq.get("/q")' 'def fac_q(): pass' 'appq = FastAPI()' 'appq.include_router(fq)'
F="$TMP/x.json"; facts "$R" "$F"
# 11 打死：没被挂的路由器仍按自己的前缀拼（少一段前缀而不自知）；挂载认不出（make() 的返回值）时同样；挂在没被挂的路由器下的也算；没被挂的应用被误伤成 null
eq "没被挂的路由器 / 挂载认不出（include_router(make(), prefix=\"/admin\")）/ 挂在没被挂的路由器下 → fullPath null、why unmounted；没被挂的 FastAPI 应用照旧 /hello、why 无；build 退出码 0" "N|unmounted N|unmounted N|unmounted /hello|N|0" "$(jf "$F" "['un_a','mm_list','kid_x'].map(h=>($(N))($X h).fullPath)+'|'+$X h).why).join(' ')+' '+$X'hello').fullPath+'|'+($(N))($X'hello').why)")|$RC"
# 12 打死：前缀是 f 串的路由器 why 记成 unmounted 或不记；mount 挂的子应用漏前缀（/pong 而不是 /v2/pong）；mount(StaticFiles) 被当成「认不出的挂载」报出来
eq "前缀是 f 串（已挂载）→ fullPath null、why runtime；app.mount(\"/v2\", sub) 下的接口 → /v2/pong；app.mount(\"/static\", StaticFiles(…)) 不报（sub.py 没有 unresolved）" "N|runtime /v2/pong 0" "$(jf "$F" "($(N))($X'rt_ping').fullPath)+'|'+$X'rt_ping').why+' '+$X'sub_pong').fullPath+' '+d.code.unresolved.filter(e=>e.file=='app/api/sub.py').length")"
# 13 打死：认不出路由器的接口哪张清单都不进（静默漏）；把 mock.patch / cache.get 这类也报成接口；.trace 认不得或方法不是 TRACE
eq "认不出路由器（函数参数、if / else 各定义一次）：un1.py 的两个接口不进 routes、进 unresolved 两条且写明「没进接口清单」；mk.py 的 @mock.patch(\"a.b\") 与 @cache.get(\"key\") 既不进 routes 也不进 unresolved；@app.trace 认得、方法 TRACE" "0|2|true|0|0|TRACE" "$(jf "$F" "d.code.routes.filter(r=>r.file=='app/api/un1.py').length+'|'+d.code.unresolved.filter(e=>e.file=='app/api/un1.py').length+'|'+d.code.unresolved.filter(e=>e.file=='app/api/un1.py').every(e=>e.text.includes('没进接口清单'))+'|'+d.code.routes.filter(r=>r.file=='app/api/mk.py').length+'|'+d.code.unresolved.filter(e=>e.file=='app/api/mk.py').length+'|'+($X'tr_h')||{method:'absent'}).method")"
# 14 打死：原文里写「第 N 行」（代码顶上加三行页面就变，逐字节不变的约定破了）；挂两次 / 切不动的文件悄悄不报（非空转：两个文件各恰一条）
eq "unresolved 每条的 text 都没有「第 N 行」；挂了两次的路由器（tw.py）与有一处没闭合的文件（bad.py）各恰一条（非空转）" "true|1|1" "$(jf "$F" "d.code.unresolved.every(e=>!/第\\s*\\d+\\s*行/.test(e.text))+'|'+d.code.unresolved.filter(e=>e.file=='app/api/tw.py').length+'|'+d.code.unresolved.filter(e=>e.file=='app/api/bad.py').length")"
# 15 打死：工厂函数造的路由器不认（接口拼不出前缀，掉成「没找到它挂在哪」）；认了却丢了字面量前缀或挂载前缀
eq "工厂造的路由器（字面量前缀 /fac、调用一次、fac1.fr 在别的文件挂 /api）→ /api/fac/one、why 无" "/api/fac/one|N" "$(jf "$F" "($X'fac_one')||{}).fullPath+'|'+($(N))(($X'fac_one')||{}).why)")"
# 16 打死：工厂前缀是参数时硬拼一个（或记成 unmounted）；两次调用各挂一次时接口列两份 / 不报另一处
eq "同一个工厂调用两次（前缀是参数）、各挂一次：fac_p 只列一条、fullPath null、why runtime；fac2.py 的 unresolved 恰一条且写明「挂了多次」" "1|N|runtime|1|true" "$(jf "$F" "d.code.routes.filter(r=>r.handler=='fac_p').length+'|'+($(N))(($X'fac_p')||{}).fullPath)+'|'+($X'fac_p')||{}).why+'|'+d.code.unresolved.filter(e=>e.file=='app/api/fac2.py').length+'|'+d.code.unresolved.filter(e=>e.file=='app/api/fac2.py').every(e=>e.text.includes('挂了多次'))")"
# 17 打死：函数体里定义了两个路由器的工厂也被认成路由器（猜 return 的那个）
eq "对照：工厂函数体里定义了两个路由器 → 不认，fac_q 不进 routes（它的装饰器像接口、认不出路由器，进 unresolved 一条写明「没进接口清单」）" "0|1|true" "$(jf "$F" "d.code.routes.filter(r=>r.handler=='fac_q').length+'|'+d.code.unresolved.filter(e=>e.file=='app/api/fac3.py').length+'|'+d.code.unresolved.filter(e=>e.file=='app/api/fac3.py').every(e=>e.text.includes('没进接口清单'))")"
R="$TMP/e"; mkcfg "$R" '["app/api"]'; w app/api/plain.py 'cache = {}' 'cache.get("/z")' 'def f(): pass'; facts "$R" "$TMP/e.json"
eq "没有装饰器路由的项目：退出码 0，routes 是空数组（code.files 有 1 个文件，代码确实扫过）" "0|true|1" "$RC|$(jf "$TMP/e.json" "(Array.isArray(d.code.routes)&&d.code.routes.length==0)")|$(jf "$TMP/e.json" 'd.code.files.length')"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
