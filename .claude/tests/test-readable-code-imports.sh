#!/usr/bin/env bash
# risk: high
# test-readable-code-imports.sh — 人读文档 · 文件清单 / 文件头说明 / 引用边 黑盒回归（docs/readable-spec/phase3-arch-contract.md B 节「文件」「引用」与 code 形状）。
# 断言只从契约推导，入口 build --facts-json 的 code.*。夹具全是合成项目，mktemp -d + --root。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-code-imports ====="
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
EF() { echo "d.code.edges.filter(e=>e.from=='$1')"; }        # 从某文件出发的边
FF() { echo "d.code.files.find(f=>f.path=='$1')"; }           # 某文件的清单项
w() { local f=$1; shift; mkdir -p "$(dirname "$R/$f")"; printf '%s\n' "$@" >"$R/$f"; }
mkcfg() { mkdir -p "$1/docs/readable-src" "$1/sql"; : >"$1/Product-Spec.md"; echo 'CREATE TABLE t1 (id int PRIMARY KEY);' >"$1/sql/s.sql"
  printf '{"version":1,"title":"t","spec":"Product-Spec.md","ddl":["sql/s.sql"],"codeRoots":%s,"ignore":["**/tests/**"]}\n' "$2" >"$1/docs/readable-src/config.json"; }

R="$TMP/m"; mkcfg "$R" '["app/api","app/tools","web/src"]'
w app/api/store.py 'def save(): pass' 'def load(): pass'
w app/api/r1.py 'from .store import save, load as ld'
w app/api/sub/deep.py 'from ..store import save'
w app/api/r3.py 'from . import store'
w app/api/selfie.py 'from .store import save' 'from .selfie import q'
w app/api/feeder/core.py 'def run(): pass'
w app/api/feeder/__init__.py 'VERSION = 1'
w app/api/tests/t_x.py 'from app.api.store import save'
w app/tools/use.py 'from feeder.core import run' 'from app.api.feeder.core import run'
w app/tools/use3.py 'from feeder import core' 'from feeder import VERSION'
w app/tools/multi.py 'from app.api.store import (' '    save,' '    load,' ')' 'import feeder.core as x, app.api.sub.deep as y'
w app/tools/cont.py 'from app.api.store import save, \' '    load'
w app/tools/fake.py '"""doc' 'from app.api.store import save' 'import feeder' '"""' '# import app.api.store' 'S = "from app.api.store import load"' "T = 'import app.api.sub.deep'" 'from typing import TYPE_CHECKING' 'def f():' '    from app.api.sub import deep' 'if TYPE_CHECKING:' '    import app.api.r3'
w app/tools/unres.py 'from .nope import x' 'import importlib' 'm = importlib.import_module(name)' 'import numpy as np' 'import os, json'
w app/tools/h1.py '#!/usr/bin/env python' '' '"""Feeds the thing.' '' 'Second line.' '"""' 'import os' '' 'if __name__ == "__main__":' '    pass'
w app/tools/h2.py 'x = 1' '"""late doc"""'
w app/tools/ui.vue '<template/>'; w web/src/b.vue '<template/>'; w web/src/a.vue '<template/>'; w app/tools/m.go 'package m'
w web/src/util.ts 'export const a = 1;' 'export const b = 2;' 'export const c = 3;'
w web/src/util2.ts 'export const w = 1;'; w web/src/comp/index.tsx 'export default 1;'; w web/src/side.ts 'export {};'; w web/src/a.css 'p{}'
w web/src/a.ts "import { a, b as c } from './util';" "import x from './comp';" "import './side';" "import s from './a.css';" "import y from '@/lib/a';" "import React from 'react';" "// import z from './util2';" "const q = \"import w from './util2'\";"
w web/src/h3.ts '/**' ' * Builds the view.' ' * Second row.' ' */' 'export const v = 1;'
w app/api/star.py 'from .store import *'
w app/tools/dyn.py 'import importlib' 'importlib.import_module("app.api.store")' 'importlib.import_module(name)'
w app/api/plain/mod.py 'def f(): pass'; w app/tools/pl.py 'from plain import mod'; w app/tools/pl2.py 'from plain.mod import f'
for n in 2 3 4 5; do w web/src/lib$n.ts 'export const a = 1;'; done
w web/src/js2.ts "const u = require('./lib2');" "export { a } from './lib3';" "export * from './lib4';" "const m = await import('./lib5');" 'const d1 = import(v);' 'const d2 = require(v);'
w web/src/sc.tsx "import { render } from '@testing-library/react';" "import './lib5';"
F="$TMP/m.json"; facts "$R" "$F"
eq "夹具能 build --facts-json（退出码 0，含 code.files）" "0|object" "$RC|$(jf "$F" 'typeof d.code.files[0]')"

# 1 打死：相对引用点数算错（上一层当本目录）、as 后的别名当名字、names 不排序
eq "相对引用：from .store 同目录名字 load,save（别名 ld 不算）；from ..store 上一层；from . import store → 都到 app/api/store.py" "app/api/store.py|load,save;app/api/store.py|save;app/api/store.py" "$(jf "$F" "$(EF app/api/r1.py).map(e=>e.to+'|'+e.names.join(',')).join('')+';'+$(EF app/api/sub/deep.py).map(e=>e.to+'|'+e.names.join(',')).join('')+';'+$(EF app/api/r3.py).map(e=>e.to).join('')")"
# 2 打死：经代码根与经项目根的绝对引用各成一条边、或有一种没解析
eq "绝对引用：from feeder.core（经代码根）与 from app.api.feeder.core（经项目根）合成一条边，行 1,2，名字 run" "1|app/api/feeder/core.py|1,2|run" "$(jf "$F" "$(EF app/tools/use.py).length+'|'+$(EF app/tools/use.py)[0].to+'|'+$(EF app/tools/use.py)[0].lines.join(',')+'|'+$(EF app/tools/use.py)[0].names.join(',')")"
# 3 打死：from 包 import 子模块 指到 __init__、from 包 import 名字 丢名字
eq "from feeder import core → core.py 且 whole；from feeder import VERSION → feeder/__init__.py 且名字含 VERSION；共两条边" "2|true|true" "$(jf "$F" "$(EF app/tools/use3.py).length+'|'+$(EF app/tools/use3.py).find(e=>e.to=='app/api/feeder/core.py').whole+'|'+$(EF app/tools/use3.py).find(e=>e.to=='app/api/feeder/__init__.py').names.includes('VERSION')")"
# 4 打死：括号里换行只取第一行、反斜杠续行丢名字、import a as x, b as y 只出一条边
eq "括号换行：load,save 都在；import a.b as x, c.d as y 两条边（whole）；反斜杠续行 load,save" "app/api/feeder/core.py|true app/api/store.py|false|load,save app/api/sub/deep.py|true;load,save" "$(jf "$F" "$(EF app/tools/multi.py).map(e=>e.to+'|'+e.whole+(e.to.endsWith('store.py')?'|'+e.names.join(','):'')).join(' ')+';'+$(EF app/tools/cont.py).map(e=>e.names.join(',')).join('')")"
# 5 打死：文档串 / # 注释 / 字符串里的 import 当真；函数体内与 TYPE_CHECKING 下的真引用漏掉
eq "fake.py：文档串 / 注释 / 字符串里的 import 不成边；函数里与 if TYPE_CHECKING 下的两条真引用成边；无 unresolved / dynamic / externals" "app/api/r3.py app/api/sub/deep.py|0|0|" "$(jf "$F" "$(EF app/tools/fake.py).map(e=>e.to).join(' ')+'|'+d.code.unresolved.filter(e=>e.file=='app/tools/fake.py').length+'|'+d.code.dynamic.filter(e=>e.file=='app/tools/fake.py').length+'|'+$(FF app/tools/fake.py).externals.join(',')")"
# 6 打死：解析不到的相对引用被丢或连到猜的文件、import_module 被丢、标准库进 externals、第三方没记
eq "unres.py：from .nope 进 unresolved（行 1、带原文）；import_module(name) 进 dynamic（行 3）；不成边；externals 只有 numpy（os json importlib 不在）" "1|true;3|true;0;numpy" "$(jf "$F" "d.code.unresolved.filter(e=>e.file=='app/tools/unres.py').map(e=>e.line+'|'+e.text.includes('from .nope import x')).join()+';'+d.code.dynamic.filter(e=>e.file=='app/tools/unres.py').map(e=>e.line+'|'+e.text.includes('import_module')).join()+';'+$(EF app/tools/unres.py).length+';'+$(FF app/tools/unres.py).externals.join(',')")"
# 7 打死：JS 扩展名 / index 补全不会、花括号 as 取了别名、样式表成边或进 unresolved、@/ 别名硬连、注释与字符串里的 import 当真
eq "a.ts：{a, b as c}→util.ts 名字 a,b；'./comp'→comp/index.tsx 含 default；'./side'→whole；样式表不成边；@/lib/a 只它进 unresolved（行 5）；react 进 externals；注释 / 字符串里的 util2 不成边" "comp/index.tsx|true side.ts|true util.ts|a,b;5;react" "$(jf "$F" "$(EF web/src/a.ts).map(e=>e.to.replace('web/src/','')+'|'+(e.to.endsWith('util.ts')?e.names.join(','):e.to.endsWith('index.tsx')?e.names.includes('default'):e.whole)).join(' ')+';'+d.code.unresolved.filter(e=>e.file=='web/src/a.ts').map(e=>e.line).join()+';'+$(FF web/src/a.ts).externals.join(',')")"
# 8 打死：文件头说明取错位置（代码后的字符串也算）/ 带引号与 * 记号 / 入口判错
eq "文件头：shebang+空行后的三引号说明原文在；代码之后的字符串 head 为 null；TS 的 /** */ 去掉 * 记号；entry 只有 h1 为 true" "true|true|null|true|true|false" "$(jf "$F" "$(FF app/tools/h1.py).head.includes('Feeds the thing.')+'|'+(!$(FF app/tools/h1.py).head.includes('\"\"\"'))+'|'+JSON.stringify($(FF app/tools/h2.py).head)+'|'+($(FF web/src/h3.ts).head.includes('Builds the view.')&&$(FF web/src/h3.ts).head.includes('Second row.')&&!$(FF web/src/h3.ts).head.includes('*'))+'|'+$(FF app/tools/h1.py).entry+'|'+$(FF app/tools/h2.py).entry")"
# 9 打死：清单乱序 / 绝对路径 / lang 多出别的值 / 行数错 / ignore 没排掉 / 自引用成边 / 没扫的扩展名不报数
eq "清单：files 按路径排且相对 /；lang 只有 js python；util.ts 3 行；tests/ 下文件不在 files 也无出边；selfie.py 只有到 store.py 一条边；edges 排好序" "true|js python|3|false|0|app/api/store.py|true" "$(jf "$F" "(p=>p.join()==[...p].sort().join()&&p.every(x=>!x.startsWith('/')&&!x.includes('\\\\'))) (d.code.files.map(f=>f.path))+'|'+[...new Set(d.code.files.map(f=>f.lang))].sort().join(' ')+'|'+$(FF web/src/util.ts).lines+'|'+d.code.files.some(f=>f.path.includes('/tests/'))+'|'+d.code.edges.filter(e=>e.from.includes('/tests/')).length+'|'+$(EF app/api/selfie.py).map(e=>e.to).join()+'|'+(k=>k.join()==[...k].sort().join())(d.code.edges.map(e=>e.from+'\n'+e.to))")"
eq "没扫的扩展名：.vue 3 个、.go 1 个出现在 skipped" "3|1" "$(jf "$F" "d.code.skipped.find(s=>s.ext=='.vue').count+'|'+d.code.skipped.find(s=>s.ext=='.go').count")"
# 11 打死：from x import * 的 star 不记 / 所有边一律 star；require、export from、export *、字面量 import() 漏边；变量参数硬连
eq "star：from .store import * 的边 star 为 true；对照 r1.py 的边 star 为 false" "true|false" "$(jf "$F" "$(EF app/api/star.py)[0].star+'|'+$(EF app/api/r1.py)[0].star")"
eq "JS 其它写法：require→whole；export {a} from→名字 a；export * from→whole；字面量 import()→边；import(v) / require(v) 进 dynamic（行 5、6）且不成边" "lib2.ts|true lib3.ts|a lib4.ts|true lib5.ts|ok;5,6" "$(jf "$F" "$(EF web/src/js2.ts).map(e=>{const t=e.to.replace('web/src/','');return t+'|'+(t=='lib3.ts'?e.names.join():t=='lib5.ts'?'ok':e.whole)}).join(' ')+';'+d.code.dynamic.filter(e=>e.file=='web/src/js2.ts').map(e=>e.line).join()")"
eq "import_module(\"app.api.store\") 字面量 → 成边；import_module(name) 只进 dynamic（行 3）" "app/api/store.py;3" "$(jf "$F" "$(EF app/tools/dyn.py).map(e=>e.to).join()+';'+d.code.dynamic.filter(e=>e.file=='app/tools/dyn.py').map(e=>e.line).join()")"
eq "带作用域的包：externals 是 @testing-library/react（两段）；同文件 import './lib5' 成边作对照" "@testing-library/react|web/src/lib5.ts" "$(jf "$F" "$(FF web/src/sc.tsx).externals.join()+'|'+$(EF web/src/sc.tsx).map(e=>e.to).join()")"
eq "没有 __init__.py 的目录也当包：from plain import mod 与 from plain.mod import f 都到 app/api/plain/mod.py" "app/api/plain/mod.py|app/api/plain/mod.py" "$(jf "$F" "$(EF app/tools/pl.py).map(e=>e.to).join()+'|'+$(EF app/tools/pl2.py).map(e=>e.to).join()")"
# 10 打死：输出带时间 / 乱序；没配 codeRoots 时 code 缺席或清单不是空数组
facts "$R" "$TMP/m2.json"
eq "同一份输入两次 --facts-json 逐字节相同（且 code 在，非空转）" "same|true" "$(cmp -s "$F" "$TMP/m2.json" && echo same || echo differs)|$(jf "$F" 'd.code.edges.length>5')"
# ---- 整期审查之后补的（2026-11-23）：合成项目各自另起一份，只看它那一点 ----
# 12 打死：JS 引用后面的说明取不到（只取得到三分之一）/ 跨行引用 + 指令后面认不出 / 文件最前面的说明被后面的盖掉 / 夹在两条引用之间的检查指令被当说明
R="$TMP/h"; mkcfg "$R" '["web/src","pyd"]'; w pyd/doc.py '"""Py doc."""' 'X = 1'; w web/src/x.ts 'export const a = 1;'; w web/src/y.ts 'export const y = 1;'
w web/src/hA.ts "'use client';" 'import {' '  a,' '  b,' "} from './x';" "import y from './y';" '' '// Renders the card.' '// Second line.' 'export const c = 1;'
w web/src/hB.ts '/** Top block. */' "import a from './x';" '/** Later block. */' 'export const q = 1;'
w web/src/hC.ts "import a from './x';" '// eslint-disable-next-line' "import b from './y';" 'export const q = 1;'
facts "$R" "$TMP/h.json"
eq "JS 文件头说明：指令加跨行引用之后、第一条别的语句之前的 // 块取得到（两行都在、没有 // 记号）；最前面有块时取最前面的（不含后面那块）；夹在两条引用之间的注释不算（head 为 null）；headAt：引用之后取到的是 after-imports、文件最前面的是 top、没有说明的是 null、Python 文档字符串是 top" "true|true|null|after-imports,top,null,top" "$(jf "$TMP/h.json" "(H=>(a=>a.includes('Renders the card.')&&a.includes('Second line.')&&!a.includes('//'))(H('web/src/hA.ts'))+'|'+(b=>b.includes('Top block.')&&!b.includes('Later block.'))(H('web/src/hB.ts'))+'|'+H('web/src/hC.ts')+'|'+['web/src/hA.ts','web/src/hB.ts','web/src/hC.ts','pyd/doc.py'].map(q=>String(d.code.files.find(x=>x.path==q).headAt)).join())(p=>String(d.code.files.find(x=>x.path==p).head))")"
# 13 打死：编译缓存目录里的文件算进「没扫的文件」（同一份代码跑过与没跑过出两样的页面）或进 files
R="$TMP/pc"; mkcfg "$R" '["app"]'; w app/m.py 'A = 1'; w app/z.vue '<template/>'; w app/__pycache__/m.cpython-312.pyc 'binary'; w app/__pycache__/stale.py 'B = 1'; w app/other/__pycache__/x.pyc 'binary'
facts "$R" "$TMP/pc.json"
eq "__pycache__ 里的 .pyc 不进 skipped、里面的 .py 不进 files（非空转：files 只有 app/m.py、skipped 只有 .vue 一个）" "false|false|app/m.py|.vue1" "$(jf "$TMP/pc.json" "d.code.skipped.some(s=>s.ext=='.pyc')+'|'+d.code.files.some(f=>f.path.includes('__pycache__'))+'|'+d.code.files.map(f=>f.path).join()+'|'+d.code.skipped.map(s=>s.ext+s.count).join()")"
# 14 打死：包里的 import logging / from celery import … 被接到同目录同名的文件上（或记成外部包）；用包名的引用不成边
R="$TMP/pk"; mkcfg "$R" '["svc"]'; w svc/__init__.py 'VERSION = 1'; w svc/logging.py 'X = 1'; w svc/celery.py 'Y = 1'; w svc/util.py 'Z = 1'
w svc/main.py 'from . import util' 'import logging' 'from celery import Task'; w svc/pk2.py 'import svc.util as u'
facts "$R" "$TMP/pk.json"
eq "包式的代码根（有 __init__.py、里面用了相对引用）：main.py 的 import logging（标准库）不成边也不进 unresolved；from celery（外部包，同目录有同名文件）不成边、不记成外部包、进 unresolved 一条且点出 svc/celery.py；相对引用照常到 util.py；pk2.py 用包名 import svc.util 照常成边" "svc/util.py|1|true|[]|svc/util.py" "$(jf "$TMP/pk.json" "$(EF svc/main.py).map(e=>e.to).join()+'|'+d.code.unresolved.filter(e=>e.file=='svc/main.py').length+'|'+d.code.unresolved.filter(e=>e.file=='svc/main.py').every(e=>e.text.includes('svc/celery.py'))+'|'+JSON.stringify($(FF svc/main.py).externals)+'|'+$(EF svc/pk2.py).map(e=>e.to).join()")"
# 15 打死：有 __init__.py 就一律当包、同目录的平铺引用全断
R="$TMP/fl"; mkcfg "$R" '["flat"]'; w flat/__init__.py ''; w flat/a.py 'import b'; w flat/b.py 'B = 1'; w flat/c.py 'from b import B'
facts "$R" "$TMP/fl.json"
eq "有 __init__.py 却全用平铺写法的代码根（没有一处引用按包的写法指进它）：import b / from b import B 照旧成边到 flat/b.py" "flat/b.py|flat/b.py" "$(jf "$TMP/fl.json" "$(EF flat/a.py).map(e=>e.to).join()+'|'+$(EF flat/c.py).map(e=>e.to).join()")"
# 16 打死：脚本目录里引用同目录的文件断掉（解释器先在脚本自己的目录里找）；没有入口文件的目录也被当脚本目录
R="$TMP/sc"; mkcfg "$R" '["src"]'; w src/tools/run.py 'import helper' 'if __name__ == "__main__":' '    pass'; w src/tools/helper.py 'H = 1'; w src/tools/h2.py 'from helper import H'
w src/plain/p1.py 'import p2'; w src/plain/p2.py 'P = 1'
facts "$R" "$TMP/sc.json"
eq "脚本目录（没有 __init__.py、里面有带 __main__ 的 run.py）：run.py 与同目录的 h2.py 引用 helper 都成边到 src/tools/helper.py；对照没有入口文件的 src/plain：p1.py 的 import p2 不成边" "src/tools/helper.py|src/tools/helper.py|0" "$(jf "$TMP/sc.json" "$(EF src/tools/run.py).map(e=>e.to).join()+'|'+$(EF src/tools/h2.py).map(e=>e.to).join()+'|'+$(EF src/plain/p1.py).length")"
# 17 打死：两个代码根下同名文件，引用被接到先试的那个根（另一个根）的文件上
R="$TMP/tw"; mkcfg "$R" '["r1","r2"]'; w r1/util.py 'A = 1'; w r2/util.py 'B = 1'; w r1/use.py 'import util'; w r2/use.py 'import util'
facts "$R" "$TMP/tw.json"
eq "两个代码根下都有 util.py：r1/use.py 的 import util 到 r1/util.py，r2/use.py 的到 r2/util.py（不是都到先配的 r1）" "r1/util.py|r2/util.py" "$(jf "$TMP/tw.json" "$(EF r1/use.py).map(e=>e.to).join()+'|'+$(EF r2/use.py).map(e=>e.to).join()")"
# 18 打死：留下一条指向清单外的边（页面哪儿都看不见它）/ 悄悄丢掉不报 / 记成外部包
R="$TMP/ou"; mkcfg "$R" '["src"]'; w shared.py 'S = 1'; w src/tests/fix.py 'F = 1'; w src/a.py 'import shared' 'from tests import fix'
facts "$R" "$TMP/ou.json"
eq "对上的文件不在文件清单里（项目根的 shared.py 在代码根之外；src/tests/fix.py 被 ignore 排掉）：不成边、各进 unresolved 一条（行 1、2）且写明「不在扫的范围里」、不记成外部包" "0|1,2|true|[]" "$(jf "$TMP/ou.json" "$(EF src/a.py).length+'|'+d.code.unresolved.filter(e=>e.file=='src/a.py').map(e=>e.line).join()+'|'+d.code.unresolved.filter(e=>e.file=='src/a.py').every(e=>e.text.includes('不在扫的范围里'))+'|'+JSON.stringify($(FF src/a.py).externals)")"
# 19 打死：./a.js 而只有 a.ts 时断边（TypeScript 引用里写编译后的扩展名）；components/Button 这类基准目录写法被记成外部包 components
R="$TMP/js"; mkcfg "$R" '["web/src"]'; w web/src/a.ts 'export const a = 1;'; w web/src/config.ts 'export const k = 1;'; w web/src/components/Button.tsx 'export default 1;'
w web/src/main.ts "import { a } from './a.js';" "import B from 'components/Button';" "import R from 'react';" "import cfg from 'config';"
facts "$R" "$TMP/js.json"
eq "JS：'./a.js' 而只有 a.ts → 成边到 web/src/a.ts；'components/Button'（代码根下有 components/）与 'config'（代码根下有 config.ts）都不成边、不记成外部包、各进 unresolved 一条（行 2、4）且点出同名的路径；react 照记外部包" "web/src/a.ts|2,4|true|true|react" "$(jf "$TMP/js.json" "$(EF web/src/main.ts).map(e=>e.to).join()+'|'+d.code.unresolved.filter(e=>e.file=='web/src/main.ts').map(e=>e.line).join()+'|'+d.code.unresolved.filter(e=>e.file=='web/src/main.ts'&&e.line==2).every(e=>e.text.includes('web/src/components'))+'|'+d.code.unresolved.filter(e=>e.file=='web/src/main.ts'&&e.line==4).every(e=>e.text.includes('web/src/config.ts'))+'|'+$(FF web/src/main.ts).externals.join()")"
R="$TMP/e"; mkcfg "$R" '[]'; w app/x.py 'import os'; facts "$R" "$TMP/e.json"
eq "codeRoots 为空：code 在，files / edges / unresolved / dynamic / skipped 都是空数组" "0|true" "$RC|$(jf "$TMP/e.json" "['files','edges','unresolved','dynamic','skipped'].every(k=>Array.isArray(d.code[k])&&d.code[k].length==0)")"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
