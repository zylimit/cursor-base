#!/usr/bin/env bash
# risk: high
# test-readable-md-blocks.sh — 人读文档 · 需求规格切块黑盒回归（docs/readable-spec/phase2-spec-contract.md 的 A、B 两节）。
# 断言只从契约推导。最怕：悄悄丢字或串块；核对器重切用同一段代码，切错它自己看不出，这份是切块唯一独立的把关。
# 夹具是合成需求规格；记号词 ZQnnn 散在各种块里，「不丢字」按它在所有块里各出现恰好一次来判。种类名契约没定，不断言。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-md-blocks ====="
if ! command -v node >/dev/null 2>&1; then echo "SKIPPED: 无 node，未执行 != 通过。"; exit 0; fi
[ -f "$ENGINE" ] || { echo "  [FAIL] 缺被测脚本：$ENGINE" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok() {  # ok <标题> <EXPECT> <GOT>
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$1"; else FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; fi
  printf '         EXPECT %s\n         GOT    %s\n' "$2" "$3"
}
PRE='const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")),s=j.spec,B=s&&s.blocks,
 F=t=>B.filter(b=>(b.cells?b.cells.join("\n"):b.text).includes(t)),S=t=>F(t)[0];'
jf() { node -e "$PRE try{process.stdout.write(String(eval(process.argv[2])))}catch(e){process.stdout.write('ERR:'+e.message)}" "$1" "$2" 2>&1 | head -c 400; }
eq() { ok "$1" "$2" "$(jf "$FACTS" "$3")"; }   # eq <标题> <EXPECT> <js 表达式：j 事实 / s spec / B 块 / F(记号)含该记号的块 / S(记号)第一块>
mk() {  # mk <root> <spec 路径或 null>：config + 最小建表文件（入口照旧要取库的事实）
  mkdir -p "$1/docs/readable-src" "$1/sql"; echo "CREATE TABLE orders (id int PRIMARY KEY);" >"$1/sql/s.sql"
  printf '{"version":1,"title":"t","spec":%s,"ddl":["sql/s.sql"],"codeRoots":[],"ignore":[]}\n' "$2" >"$1/docs/readable-src/config.json"
}
facts() { RC=0; env -u CLAUDE_PROJECT_DIR node "$ENGINE" build --facts-json --root "$1" >"$2" 2>"$TMP/err" || RC=$?; }

R="$TMP/main"; mk "$R" '"spec.md"'
cat >"$R/spec.md" <<'EOF'
# Orders ZQ001
Intro line ZQ002 here
second <name> **bold** `code` ~~del~~ ZQ003

## Lists ZQ004
- **Alpha**: parent ZQ005
  continuation ZQ006
  - child one ZQ007
  - child two ZQ008
    - third ZQ009
        - fourth ZQ010
- [REQ-ABC-001] req item ZQ011
1. numbered ZQ012

### Deep ZQ013
- deep item ZQ014

## Tables ZQ015
| Name ZQ016 | Note ZQ017 |
| --- | :-: |
| a\|b ZQ018 | ZQ019 |
| ZQ020 | x |

## Quotes ZQ021
> quoted ZQ022
> - not list ZQ023
> last ZQ024

## Fences ZQ025
```
# x ZQ026
EOF
printf '%s\n' '- y ZQ027  ' '```' 'after fence ZQ028' '' '## Edge ZQ029' 'trailing line ZQ030  ' '- tab-parent ZQ031' >>"$R/spec.md"
printf '\t- tab child ZQ032\n- \n' >>"$R/spec.md"
LONG=$(node -e 'process.stdout.write("- ZQ040 "+"中文,mix;".repeat(430)+" ZQ041")'); printf '%s\n' "$LONG" >>"$R/spec.md"
LEN=$(node -e 'console.log(process.argv[1].length-2)' -- "$LONG")
FACTS="$TMP/f1.json"; facts "$R" "$FACTS"; RC1=$RC; facts "$R" "$TMP/f2.json"
QL=$(grep -n 'quoted ZQ022' "$R/spec.md" | cut -d: -f1)
ok "夹具能 build --facts-json，含容易丢字的写法也退出码 0、spec.file 指向来源（红在这条则下面多数是连带）" "rc=0|true" "rc=$RC1|$(jf "$FACTS" 's.file.endsWith("spec.md")')"
eq "列表成树：续行并进父项（换行接上）、父项不含子项、一共三块；两条子项 parent 是父项序号，三四级各指上一级，顶层无 parent，level 逐级加深（打死续行当新块 / 子项并进父项）" "true|true|3|true|true|true|true|true|true" \
  'const p=S("ZQ005"),c1=S("ZQ007"),c2=S("ZQ008"),t=S("ZQ009"),f=S("ZQ010"); [F("ZQ006")[0]===p,/ZQ005\s*\n\s*continuation ZQ006/.test(p.text)&&!/ZQ007|ZQ008/.test(p.text),B.filter(b=>/ZQ00[5-8]/.test(b.text)).length,c1.parent===p.n,c2.parent===p.n,t.parent===c2.n,f.parent===t.n,p.parent==null,p.level<c1.level&&c1.level<t.level&&t.level<f.level].join("|")'
eq "表格：三块（表头 + 两行）、header 只有第一行为 true、分隔行不成块、\\| 是文字竖线、格数不多出来（打死按竖线硬切 / 把分隔行当数据）" '3|true,false,false|["Name ZQ016","Note ZQ017"],["a|b ZQ018","ZQ019"],["ZQ020","x"]|false' \
  'const r=B.filter(b=>b.cells&&/ZQ01[6-9]|ZQ020/.test(b.cells.join(""))); [r.length,r.map(b=>b.header===true).join(),r.map(b=>JSON.stringify(b.cells.map(x=>x.trim()))).join(","),B.some(b=>/:-:/.test((b.cells||[]).join()+b.text))].join("|")'
eq "行内记号与尖括号占位原样留在文字里，两行段落用换行接成一块（打死解释行内记号 / 吞 <name> 当标签 / 逐行拆块）" "true|true" \
  'const b=S("ZQ002"); [b.text==="Intro line ZQ002 here\nsecond <name> **bold** `code` ~~del~~ ZQ003",F("ZQ003")[0]===b].join("|")'
eq "引用：连着的 > 行一块，行数等于来源、开头的 > 已去掉、行内的 - 不当列表；起止行与来源一致（打死逐行拆块 / 不去 > / 引用里再解析）" "$(printf "quoted ZQ022\n- not list ZQ023\nlast ZQ024")|$QL|$((QL + 2))|true" \
  'const b=S("ZQ022"); [b.text,b.line,b.endLine,F("ZQ024")[0]===b&&F("ZQ023")[0]===b].join("|")'
eq "围栏：整段一块，# x 与 - y 不成标题与列表项，文字一个字符不动（含行尾两个空格），围栏后的段落另是一块（打死围栏内再解析 / 修剪行尾 / 围栏吞后文）" "true|true|false|true" \
  'const f=S("ZQ026"); [f.text.replace(/\n$/,"")==="# x ZQ026\n- y ZQ027  ",F("ZQ027")[0]===f,s.sections.some(x=>/x ZQ026/.test(x.title)),S("ZQ028")!==f&&S("ZQ028").parent==null].join("|")'
eq "章节：sections 的标题与级数恰是 7 个真标题（围栏里的 # 不算）；每块 path 是上面各级标题（回到二级后三级已弹栈）" \
  'Orders ZQ001,Lists ZQ004,Deep ZQ013,Tables ZQ015,Quotes ZQ021,Fences ZQ025,Edge ZQ029|1,2,3,2,2,2,2|["Orders ZQ001","Lists ZQ004"]|["Orders ZQ001","Lists ZQ004","Deep ZQ013"]|["Orders ZQ001","Tables ZQ015"]' \
  '[s.sections.map(x=>x.title).join(),s.sections.map(x=>x.level).join(),JSON.stringify(S("ZQ007").path),JSON.stringify(S("ZQ014").path),JSON.stringify(S("ZQ018").path)].join("|")'
eq "全局序号 n 从 1 起连续、起始行按文件先后严格递增（打死序号从 0 起 / 跳号 / 乱序）" "true|true" \
  '[B.every((b,i)=>b.n===i+1),B.every((b,i)=>i===0||b.line>B[i-1].line)].join("|")'
EXP=$(grep -o 'ZQ[0-9][0-9][0-9]' "$R/spec.md" | sort | tr '\n' ,)
ok "夹具自检：记号词在来源里互不重复（否则下一条断言失去意义）" "" "$(grep -o 'ZQ[0-9][0-9][0-9]' "$R/spec.md" | sort | uniq -d | tr '\n' ,)"
eq "不丢字：来源里的每个记号词（标题、续行、格子、引用、围栏、空项旁、长条目首尾）在所有块里各出现恰好一次，不多不少（打死任何一种丢字 / 重复）" "$EXP" \
  '(B.map(b=>b.cells?b.cells.join("\n"):b.text).join("\n").match(/ZQ\d{3}/g)||[]).sort().join(",")+","'
eq "易丢字写法：制表符缩进的项是上一项的子项，空项后面的长条目照常切出，3000 字长条目文字长度等于来源且首尾记号在同一块" "true|$LEN|true" \
  '[S("ZQ032").parent===S("ZQ031").n,S("ZQ040").text.length,F("ZQ041")[0]===S("ZQ040")].join("|")'

A="$TMP/anch"; mk "$A" '"spec.md"'
printf '%s\n' '# Top' '- **Alpha**: one ZQ101' '- **Alpha**: two ZQ102' '- **Alpha**: three ZQ103' '- [REQ-ABC-001] r1 ZQ104' '- [REQ-ABC-001] r2 ZQ105' \
  '- plain ZQ106' '- plain ZQ107' '' '[REQ-ABC-009] para ZQ108' >"$A/spec.md"
FACTS="$TMP/fa.json"; facts "$A" "$FACTS"
eq "锚点：REQ 编号开头 → req:<编号>（段落也认）；粗体词开头 → spec:<章节>/<词>；同锚点第二次起接 ~2、~3（REQ 同理）；其余 spec:<章节>#<序号>，两条不同且递增" \
  'spec:Top/Alpha,spec:Top/Alpha~2,spec:Top/Alpha~3|req:REQ-ABC-001,req:REQ-ABC-001~2|req:REQ-ABC-009|true' \
  'const a=t=>S(t).anchor,p=[a("ZQ106"),a("ZQ107")].map(x=>(x.match(/^spec:Top#(\d+)$/)||[])[1]); [["ZQ101","ZQ102","ZQ103"].map(a).join(),["ZQ104","ZQ105"].map(a).join(),a("ZQ108"),!!p[0]&&!!p[1]&&+p[1]>+p[0]].join("|")'

M="$TMP/mark"; mk "$M" '"spec.md"'   # marker 夹具：无序三种记号、有序 3. 与 2)、三条都写 1.、只有记号的空项，外加各种非列表块
printf '%s\n' '# Top ZQ200' '- dash ZQ201' '* star ZQ202' '+ plus ZQ203' '3. three ZQ204' '2) two ZQ205' '' '1. one ZQ206' '1. one ZQ207' '1. one ZQ208' '' 'para ZQ209' '' \
  '> quote ZQ210' '' '| H ZQ211 | x |' '|---|---|' '| c ZQ212 | y |' '' '```' 'fenced ZQ213' '```' '' '---' '' '9.' >"$M/spec.md"
FACTS="$TMP/fm.json"; facts "$M" "$FACTS"
eq "无序项的 marker 是它用的那个符号 - * +（打死不记 marker / 一律记成 -）" "-,*,+" '["ZQ201","ZQ202","ZQ203"].map(t=>S(t).marker).join()'
eq "有序项的 marker 是原文的编号连标点：3. 与 2) 各自原样（不排序、不统一标点），只有记号的空项 9. 也带 marker（打死丢序号 / 改标点 / 空项漏记）" "3.,2)|9." \
  '[S("ZQ204").marker,S("ZQ205").marker].join()+"|"+B.filter(b=>b.kind==="list").pop().marker'
eq "三条来源都写 1. 的有序项 marker 仍是 1. 1. 1.（不替人改成 1. 2. 3.；打死自动重新编号）" "1.,1.,1." '["ZQ206","ZQ207","ZQ208"].map(t=>S(t).marker).join()'
eq "列表项共 9 条且都有非空字符串 marker；别的种类的块（标题 段落 引用 表格行 围栏 分隔线共 7 块）没有 marker 或为 null（打死 marker 漏给非列表块）" "9|true|7|true" \
  'const L=B.filter(b=>b.kind==="list"),O=B.filter(b=>b.kind!=="list"); [L.length,L.every(b=>typeof b.marker==="string"&&b.marker.length>0),O.length,O.every(b=>b.marker==null)].join("|")'

N="$TMP/nospec"; mk "$N" null; FACTS="$TMP/fn.json"; facts "$N" "$FACTS"
eq "spec 为 null 的项目：退出码 0、spec 键存在且是 null、tables 照旧有（后两项今天的实现就满足，红只会红在 spec 键）" "rc=0|null|true" "\"rc=$RC|\"+String(j.spec)+\"|\"+(j.tables.length>0)"
D1=$(sha256sum <"$TMP/f1.json" | cut -c1-16); D2=$(sha256sum <"$TMP/f2.json" | cut -c1-16)
FACTS="$TMP/f1.json"
eq "同一份输入两次 --facts-json 逐字节相同，且确实带 spec（防今天没有 spec 键时空转为绿）" "same|true" "\"$([ "$D1" = "$D2" ] && echo same || echo diff)|\"+(Array.isArray(B)&&B.length>0)"
echo "==== test-readable-md-blocks：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ]
