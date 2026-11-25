#!/usr/bin/env bash
# risk: high
# test-readable-spec-figures.sh — 人读文档 · 需求规格的图（步骤图 / 流程链图）与条目索引黑盒回归（phase2-spec-contract.md C 节「条目的地址」「本章条目」「步骤图」「流程链图」「图不许编字」、D 节 spec-figure）。
# 断言只从契约推导；方框不绑定标签：取 data-fig 元素里去掉标签后的各段文字，去掉末尾标点比较。夹具是合成内容，内网地址是为测隐去而写的保留段地址。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
export LC_ALL=C.UTF-8
echo "===== test-readable-spec-figures ====="
if ! command -v node >/dev/null 2>&1; then echo "SKIPPED: 无 node，未执行 != 通过。"; exit 0; fi
[ -f "$ENGINE" ] || { echo "  [FAIL] 缺被测脚本：$ENGINE" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
eq() { if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$1"; else FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; fi; printf '         EXPECT %s\n         GOT    %s\n' "$2" "$3"; }
nd() { env -u CLAUDE_PROJECT_DIR node "$ENGINE" "$@"; }
bd() { RB=0; nd build --root "$1" >/dev/null 2>&1 || RB=$?; }
ck() { RC=0; nd check --json --root "$1" >"$TMP/f.json" 2>/dev/null || RC=$?; }
jf() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=eval(process.argv[2]);console.log(typeof v==="object"?JSON.stringify(v):String(v))}catch(e){console.log("NOJSON")}' "$TMP/f.json" "$1"; }
sk() { jf "[...new Set(j.problems.filter(p=>p.kind.startsWith('spec-')).map(p=>p.kind))].sort().join(',')"; }
at() { jf "j.problems.some(p=>p.kind=='$1'&&/(^|\\D)$2(\\D|\$)/.test(p.where+' '+p.detail))"; }
tree() { (cd "$1" && find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-16); }
fx() { nd build --facts-json --root "$1" >"$TMP/fx.json" 2>/dev/null || true; }
bn() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const b=j.spec.blocks.find(b=>(b.cells?b.cells.join(" "):b.text).includes(process.argv[2]));console.log(b?b.n:0)' "$TMP/fx.json" "$1"; }
bl() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(j.spec.blocks.find(b=>(b.text||"").includes(process.argv[2])).line)' "$TMP/fx.json" "$1"; }
F() { node "$TMP/fg.js" "$1/docs/readable/spec" "${@:2}" 2>/dev/null || echo ERR; }   # F <根> n|t|mut|ids|dup|lk|mark …
mk() { mkdir -p "$1/docs/readable-src" "$1/sql"; echo "CREATE TABLE orders (id int PRIMARY KEY);" >"$1/sql/s.sql"
  printf '{"version":1,"title":"t","spec":"spec.md","ddl":["sql/s.sql"],"codeRoots":[],"ignore":[]}\n' >"$1/docs/readable-src/config.json"; cat >"$1/spec.md"; }
cat >"$TMP/fg.js" <<'EOF'
const fs=require('fs'),P=require('path'),[,,dir,op,x,y,z]=process.argv,rd=f=>fs.readFileSync(f,'utf8');
const fl=fs.readdirSync(dir).filter(f=>/^s-\d+\.html$/.test(f)).sort().map(f=>P.join(dir,f));
const end=(h,s)=>{const t=/^<(\w+)/.exec(h.slice(s))[1],re=new RegExp('<'+t+'(?=[\\s>/])|</'+t+'>','g');re.lastIndex=s;let d=0,m;while((m=re.exec(h))){d+=m[0][1]==='/'?-1:1;if(!d)return m.index+m[0].length}return -1};
const strip=s=>s.replace(/<[^>]*>/g,'');
const txt=s=>[...new Set(strip(s.replace(/<(script|style|title|desc|figcaption)[\s\S]*?<\/\1>/g,'').replace(/<(\w+)[^>]*data-k="marker"[^>]*>[\s\S]*?<\/\1>/g,'').replace(/<[^>]*>/g,'\n')).split('\n').map(t=>t.trim().replace(/[。；;，,]+$/,'')).filter(t=>t&&!/^[→⟶➜➔▶▸>\-–—]+$/.test(t)))];
const g=[];for(const f of fl){const h=rd(f),re=/data-fig="([^"]*)"/g;let m;while((m=re.exec(h))){const s=h.lastIndexOf('<',m.index);g.push({f,h,s,e:end(h,s),k:m[1].split(',')})}}
const tags=h=>[...h.matchAll(/<\w+[^>]*data-block="(\d+)"[^>]*>/g)],at=(t,a)=>(new RegExp('\\s'+a+'="([^"]*)"').exec(t)||[])[1];
const q=g.filter(q=>q.k.includes(x));
if(op==='n')console.log(q.length);
if(op==='c')console.log(q.filter(a=>a.k.length===1).length);
if(op==='s')console.log(q.filter(a=>a.k.length>1).length);
if(op==='t')console.log(q[0]?JSON.stringify(txt(q[0].h.slice(q[0].s,q[0].e))):'none');
if(op==='mut'&&q[0]){const a=q[0];fs.writeFileSync(a.f,a.h.slice(0,a.s)+a.h.slice(a.s,a.e).split(y).join(z)+a.h.slice(a.e))}
if(op==='ids')for(const f of fl)for(const m of tags(rd(f)))console.log(at(m[0],'data-anchor')+'\t'+at(m[0],'id'));
if(op==='dup'){let d=0;for(const f of fl){const i=[...rd(f).matchAll(/\sid="([^"]*)"/g)].map(m=>m[1]);d+=i.length-new Set(i).size}console.log(d)}
if(op==='lk'){const h=rd(fl.find(f=>rd(f).includes('data-block="'+x+'"'))),ids=new Set([...h.matchAll(/\sid="([^"]*)"/g)].map(m=>m[1]));
  console.log(JSON.stringify([...h.matchAll(/<a[^>]*href="#([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(m=>[strip(m[2]).trim(),m[1]]).filter(l=>l[0]&&!/隐去/.test(l[0])).map(l=>l[0]+(ids.has(l[1])?'':'!'))))}
if(op==='mark'){let N=0,L=0,T=0,V=0;for(const f of fl){const h=rd(f),ts=tags(h);ts.forEach((m,i)=>{N++;const id=at(m[0],'id'),seg=h.slice(m.index,i+1<ts.length?ts[i+1].index:h.length);
  const as=[...seg.matchAll(new RegExp('<a[^>]*href="#'+id+'"[^>]*>([\\s\\S]*?)</a>','g'))];if(as.length)L++;if(as.some(a=>/tabindex="-1"/.test(a[0])))V++;if(as.some(a=>strip(a[1]).trim()))T++})}console.log(N+'|'+L+'|'+T+'|'+V)}
EOF
LS=$(printf '很长%.0s' $(seq 1 20)); LW=条目名称一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳
A="$TMP/a"; mk "$A" <<EOF
# 总

## 一章

- **登录**：输入账号 → 系统校验 → 进入首页；失败三次锁定。
- 导入 → 解压并校验（识别三张表：甲 → 乙 → 丙）→ 入库
- 超长 → ${LS} → 末
- 双段 → 末

| 表头甲 | 表头乙 |
|---|---|
| 阶一 → 阶二 → 阶三 | 无 |

- 数据 → 经 10.8.8.8 中转 → 终点
- [REQ-ABC-001] 编号条目说明
- **重名**：同
- **重名**：同

## 二章

说明一段话。

1. 甲步，做
2. 乙步，做
3. 丙步，做

- 父项嵌套
  1. 子甲，做
  2. 子乙，做
  3. 子丙，做
- 两步父
  1. 仅甲，做
  2. 仅乙，做

说明另一段。

1. 起步，做
2. 链步 → 乙段 → 丙段
3. 收步，做

说明第三段。

1. 仅一，做
2. 链二 → 乙二 → 丙二

## 三章

- **登记**：说明甲
- **注册**：说明乙
- **审核**：说明丙
- **归档**：说明丁
- **通知**：说明戊
- **统计**：说明己
- **${LW}**：说明庚
- **10.7.7.7**：说明辛

## 四章

- **丁一**：说明
- **丁二**：说明
- **丁三**：说明
- **丁四**：说明
EOF
bd "$A"; B0=$RB; ck "$A"; K0=$RC$(jf j.problems.length); fx "$A"
NB=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).spec.blocks.length)' "$TMP/fx.json")
N1=$(bn 输入账号); N2=$(bn 解压并校验); N3=$(bn 超长); N4=$(bn 双段); N5=$(bn 阶一); N6=$(bn 终点)
S1=$(bn 甲步，做); S2=$(bn 乙步，做); S3=$(bn 子甲，做); S4=$(bn 仅甲，做); C3=$(bn 说明甲); C4=$(bn 丁一); L1=$(bl 输入账号); T1=$(bn 起步，做); T2=$(bn 链步); U1=$(bn 仅一，做); U2=$(bn 链二); L2="$(bl 甲步，做)|$(bl 乙步，做)"
# 1 流程链图画对（打死：图里的字被读成这一块的字而误报；引子 / 句尾也画进方框）
eq "「登录」块恰一个带 data-fig 的图，方框字恰是 输入账号/系统校验/进入首页（引子「登录」与「失败三次锁定」不在图里）；生成 0、check 0 条" '1|["输入账号","系统校验","进入首页"]|0|00' "$(F "$A" n "$N1")|$(F "$A" t "$N1")|$B0|$K0"
# 2 括号里的箭头不分段
TL=$(F "$A" t "$N2"); J() { printf '%s' "$TL" | node -e 'try{const a=JSON.parse(require("fs").readFileSync(0));console.log('"$1"')}catch(e){console.log("none")}'; }
eq "括号里的「甲 → 乙 → 丙」不分段：恰三个方框，中间一个含「识别三张表：甲 → 乙 → 丙」" '3|true' "$(J 'a.length')|$(J 'a[1].includes("识别三张表：甲 → 乙 → 丙")')"
# 3 不该画的不画（对照：第 1 臂的「登录」画了）
eq "有一段超 30 字 / 只有两段 / 表格格子里的箭头链：都没有图（0,0,0），check 仍 0 条；对照「登录」块有图" "0,0,0|00|1" "$(F "$A" n "$N3"),$(F "$A" n "$N4"),$(F "$A" n "$N5")|$K0|$(F "$A" n "$N1")"
# 4 图里的字有人核
R="$TMP/r4a"; cp -r "$A" "$R"; F "$R" mut "$N1" 系统校验 系统校骏; ck "$R"; X1="$RC|$(sk)|$(at spec-figure "$L1")"
R="$TMP/r4b"; cp -r "$A" "$R"; F "$R" mut "$S2" 乙步 乙部; ck "$R"; X2="$RC|$(sk)|$(at spec-figure "($L2)")"
eq "流程链图里改一个字 → 退出码 1、spec-* 只有 spec-figure（没有 spec-mismatch）、点到来源第 ${L1} 行；步骤图里改一个字 → 同样（点到甲步或乙步所在行）；对照没动 0 条见第 1 臂" "1|spec-figure|true|1|spec-figure|true" "$X1|$X2"
# 5 步骤图放宽
eq "段落后的三步有序列表有步骤图、嵌在列表项下的三步子列表有步骤图、两步的没有；check 仍 0 条" "1,1,0|00" "$(F "$A" n "$S1"),$(F "$A" n "$S3"),$(F "$A" n "$S4")|$K0"
# 5b 步骤图里的步不再各画流程链图（对照：两步的列表没有步骤图，其中一步照画链图）
eq "三步列表（中间一步是三段箭头链）有步骤图、「链步」自己没有流程链图；两步列表没有步骤图、「链二」有流程链图；check 0 条" "1,0|0,1|00" "$(F "$A" s "$T1"),$(F "$A" c "$T2")|$(F "$A" s "$U1"),$(F "$A" c "$U2")|$K0"
# 6 本章条目
P3=$(F "$A" lk "$C3"); P4=$(F "$A" lk "$C4"); LWT="${LW:0:28}…"
eq "三章 8 条粗体词条目：索引按来源先后列出 6 个词 + 超 28 字的截成 28 字加「…」、每条 href 指的 id 本页有（无「!」）；正文里有完整的长词；四章只 4 条：不列" "[\"登记\",\"注册\",\"审核\",\"归档\",\"通知\",\"统计\",\"$LWT\"]|y|[]" \
  "$P3|$(cat "$A"/docs/readable/spec/s-03.html | sed 's/<[^>]*>//g' | grep -qF "$LW" && echo y || echo n)|$P4"
# 7 条目的地址
F "$A" ids >"$TMP/i0"; B="$TMP/b"; sed '0,/^- \*\*登录/s//- **新增条目**：新一句。\n&/' "$A/spec.md" | mk "$B"; bd "$B"; F "$B" ids >"$TMP/i1"
PR=$(awk -F'\t' 'NR==FNR{if($1!~/#[0-9]+$/)a[$1]=$2;next} ($1 in a){n++; if(a[$1]!=$2)bad++} END{print (n>=8?"enough":"few:"n)"|"bad+0}' "$TMP/i0" "$TMP/i1")
eq "同页 id 不重复（含两条一字不差的「重名」）；[REQ-ABC-001] 的 id 就是 REQ-ABC-001；前面插一条后重出，按 data-anchor 配对的原有条目（粗体词 / 编号，≥8 条）id 逐个不变" "0|REQ-ABC-001|enough|0" "$(F "$A" dup)|$(grep -F 'req:REQ-ABC-001' "$TMP/i0" | cut -f2)|$PR"
# 8 链接记号不带字
eq "每一块（共 ${NB} 块）里都有指向自己的链接，链接标签之间没有字，且都带 tabindex=-1" "$NB|$NB|0|$NB" "$(F "$A" mark)"
# 9 图与索引也过隐去
HIT=$(grep -rlE '10\.7\.7\.7|10\.8\.8\.8' "$A/docs/readable" | wc -l | tr -d ' ')
eq "内网地址写在粗体词（进索引）与箭头链的一段里：docs/readable 下搜不到；箭头链仍画出图（1 个）；check 0 条" "0|1|00" "$HIT|$(F "$A" n "$N6")|$K0"
# 10 确定性
H0=$(tree "$A/docs/readable"); bd "$A"; eq "带图夹具两次 build 逐字节相同" "$H0" "$(tree "$A/docs/readable")"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
