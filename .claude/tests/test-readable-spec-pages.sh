#!/usr/bin/env bash
# risk: high
# test-readable-spec-pages.sh — 人读文档 · 需求规格页面与零丢失核对黑盒回归（docs/readable-spec/phase2-spec-contract.md 的 C、D 两节）。
# 断言只从契约推导。最贵的两种错：页面吞字 / 串块而核对器报 0 条（假绿），核对器被分句 / 步骤图 / 隐去误报；每个「该报」配「不该报」对照。
# 夹具是合成需求规格；分句用「句号等标点后、下一句开头前出现标记或空白」判，不绑定具体标记。mktemp -d + --root。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-spec-pages ====="
if ! command -v node >/dev/null 2>&1; then echo "SKIPPED: 无 node，未执行 != 通过。"; exit 0; fi
[ -f "$ENGINE" ] || { echo "  [FAIL] 缺被测脚本：$ENGINE" >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
eq() {  # eq <标题> <EXPECT> <GOT>
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$1"; else FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; fi
  printf '         EXPECT %s\n         GOT    %s\n' "$2" "$3"
}
nd() { env -u CLAUDE_PROJECT_DIR node "$ENGINE" "$@"; }
bd() { RB=0; nd build --root "$1" >/dev/null 2>&1 || RB=$?; }
ck() { RC=0; nd check --json --root "$1" >"$TMP/f.json" 2>/dev/null || RC=$?; }
jf() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=eval(process.argv[2]);console.log(typeof v==="object"?JSON.stringify(v):String(v))}catch(e){console.log("NOJSON")}' "$TMP/f.json" "$1"; }
sk() { jf "[...new Set(j.problems.filter(p=>p.kind.startsWith('spec-')).map(p=>p.kind))].sort().join(',')"; }   # 只看 spec-* 类
yn() { if "$@" >/dev/null 2>&1; then printf y; else printf n; fi; }
tree() { (cd "$1" && find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-16); }
bn() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const b=j.spec.blocks.find(b=>(b.cells?b.cells.join(" "):b.text).includes(process.argv[2]));console.log(b?b.n:0)' "$TMP/f.json" "$1"; }
PG() { grep -l "data-block=\"$2\"" "$1"/docs/readable/spec/s-*.html 2>/dev/null | head -1 || true; }   # PG <根> <块号>：该块所在页
rg() { node -e 'const h=require("fs").readFileSync(process.argv[1],"utf8"),i=h.indexOf("data-block=\""+process.argv[2]+"\""),k=h.indexOf("data-block=\"",i+1);process.stdout.write(h.slice(i,k<0?h.length:k))' "$(PG "$1" "$2")" "$2" 2>/dev/null || true; }
cat >"$TMP/mut.js" <<'EOF'
const [,, op, file, n, a, b] = process.argv; const fs = require('fs'); let h = fs.readFileSync(file, 'utf8');
const at = k => { const i = h.indexOf('data-block="' + k + '"'); return i < 0 ? -1 : h.lastIndexOf('<', i); };
const s = at(n), e = at(+n + 1);
if (op === 'word') { const i = h.indexOf(a, s); h = h.slice(0, i) + b + h.slice(i + a.length); }
if (op === 'mark') { const j = h.indexOf('data-k="marker"', s), i = h.indexOf(a, j); h = h.slice(0, i) + b + h.slice(i + a.length); }
if (op === 'del') h = h.slice(0, s) + h.slice(e);
if (op === 'dup') h = h.slice(0, e) + h.slice(s, e) + h.slice(e);
if (op === 'swap') { const f = at(+n + 2); h = h.slice(0, s) + h.slice(e, f) + h.slice(s, e) + h.slice(f); }
fs.writeFileSync(file, h);
EOF
mt() { f=$(PG "$1" "$3"); [ -n "$f" ] && node "$TMP/mut.js" "$2" "$f" "$3" "${4:-}" "${5:-}" || true; }   # mt <根> word|del|dup|swap <块号> [旧 新]
cpy() { rm -rf "$2"; cp -r "$1" "$2"; }
LONG=""; for i in 1 2 3 4 5 6 7 8 9 10; do
  case $i in 5) m='第5句（括号内含。一个句号）之后继续填充填充填充填充填充填充填充';; *) m="第${i}句需求说明填充填充填充填充填充填充填充填充填充填充";; esac
  case $((i % 4)) in 0) e='？';; 1) e='；';; 2) e='！';; 3) e='。';; esac
  [ $i = 7 ] && e='?'; LONG="$LONG$m$e"; done
PARA=""; for i in 1 2 3 4 5 6 7 8 9 10 11 12; do   # 12 句、324 字的段落；第 7 句里有半角点紧贴字的 v2.31
  m="段落${i}号说明填充填充填充填充填充填充填充填充填充填充"; [ $i = 7 ] && m="段落7号升级到v2.31后保持不变填充填充填充填充填充填充填充填充填充"; PARA="$PARA$m。"; done
mk() {  # mk <root> <spec 路径或 null>
  mkdir -p "$1/docs/readable-src" "$1/sql"; echo "CREATE TABLE orders (id int PRIMARY KEY);" >"$1/sql/s.sql"
  printf '{"version":1,"title":"t","spec":%s,"ddl":["sql/s.sql"],"codeRoots":[],"ignore":[]}\n' "$2" >"$1/docs/readable-src/config.json"
  cat >"$1/spec.md" <<'EOF'
# 订单需求

前言一句话。

## 一 概览

- **登录**：用户用 <名称> 登录，支持 `等宽` 与 **粗体** 内容。
  - 子项：内网地址 10.1.2.3 不外传。
- 项甲
- 项乙
- 项丙
- 项丁
- 短条目：第一句。第二句。
- @@LONG@@

@@PARA@@

> 引用第一行
> 引用第二行

## 二 流程

### 步骤

1. 第一步，做甲。
2. 第二步，做乙。
3. 第三步，做丙。

| 列A | 列B |
|---|---|
| a1 | b1 |
EOF
  sed -i "s/@@LONG@@/$LONG/" "$1/spec.md"; sed -i "s/@@PARA@@/$PARA/" "$1/spec.md"
}
A="$TMP/a"; mk "$A" '"spec.md"'; bd "$A"; B0=$RB; ck "$A"; K0=$RC; OK0=$(jf j.ok); NP=$(jf j.problems.length)
LAST=$(nd check --root "$A" 2>&1 | tail -1); HOME_HAS=$(yn grep -q 需求规格 "$A/docs/readable/index.html"); NPG=$(ls "$A"/docs/readable/spec/s-*.html 2>/dev/null | wc -l | tr -d ' ')
nd build --facts-json --root "$A" >"$TMP/f.json" 2>/dev/null || true; NB=$(jf j.spec.blocks.length)
N_A=$(bn 项甲); N_B=$(bn 项乙); N_C=$(bn 项丙); N_L=$(bn 第1句); N_S=$(bn 第一句。第二句); N_H=$(bn 步骤); L_B=$(grep -n '^- 项乙' "$A/spec.md" | cut -d: -f1)
N_P=$(bn 段落1号); N_2=$(bn 第二步)   # 必须趁 f.json 还是 facts 时取块号（ck 会覆盖它）
# 1 对照：生成后什么都不动（后面各臂的对照）
eq "生成后不动：build 0、check 0、ok、问题 0 条、末行「不一致 0 条」；spec/index.html 在、三页（前言 + 两个二级标题）、首页有「需求规格」" \
  "0|0|true|0|不一致 0 条|y|3|y" "$B0|$K0|$OK0|$NP|$LAST|$(yn test -f "$A/docs/readable/spec/index.html")|$NPG|$HOME_HAS"
# 2 打死：漏块 / 重复块
GOT=$(grep -oh 'data-block="[0-9]*"' "$A"/docs/readable/spec/*.html 2>/dev/null | grep -o '[0-9]*' | sort -n | tr '\n' ,); EXP=$(seq 1 "${NB:-0}" | tr '\n' ,)
eq "spec/ 下所有页的 data-block 恰是 1..块数（${NB} 块），不重不漏" "$EXP" "$GOT"
# 3 打死：只比块数 / 只比有无不比字 / 点不到行
R="$TMP/r3"; cpy "$A" "$R"; mt "$R" word "$N_B" 项乙 项丁; ck "$R"
eq "手改「项乙」那块的一个字：退出码 1，spec-* 只有 1 条 spec-mismatch，where/detail 点到来源第 ${L_B} 行（没改的块不被点）" "1|spec-mismatch|1|1" \
  "$RC|$(sk)|$(jf "j.problems.filter(p=>p.kind.startsWith('spec-')).length")|$(jf "j.problems.filter(p=>p.kind=='spec-mismatch'&&(p.where+' '+p.detail).includes('$L_B')).length")"
# 4 打死：来源删了一条页面不报
R="$TMP/r4"; cpy "$A" "$R"; sed -i '/^- 项乙$/d' "$R/spec.md"; ck "$R"; X1="$RC$(jf "j.problems.some(p=>p.kind=='spec-extra'||(p.where+' '+p.detail).includes('项乙'))")"
bd "$R"; ck "$R"
eq "来源里删掉「项乙」不重出：退出码 1、有 spec-extra 或点到项乙；重出后 0 条" "1true|0|0" "$X1|$RC|$(jf j.problems.length)"
# 5 打死：缺块 / 重复块 / 顺序都报成别的类或不报
R="$TMP/r5a"; cpy "$A" "$R"; mt "$R" del "$N_B"; ck "$R"; M=$(sk)
R="$TMP/r5b"; cpy "$A" "$R"; mt "$R" dup "$N_C"; ck "$R"; D=$(sk)
R="$TMP/r5c"; cpy "$A" "$R"; mt "$R" swap "$N_A"; ck "$R"; O=$(sk)
eq "整块删「项乙」→ spec-missing；复制「项丙」→ spec-duplicate；对调「项甲」「项乙」→ spec-order（各自只报这一类，退出码 1）" "spec-missing|spec-duplicate|spec-order" "$M|$D|$O"
# 6 打死：分句就误报 / 根本没分句 / 括号内句号也断 / 短条目也断
RL=$(rg "$A" "$N_L"); RS=$(rg "$A" "$N_S")
NBRK=$(printf '%s' "$RL" | grep -oE '[。；？！?;!](<[^>]*>|[[:space:]])+第[0-9]+句' | wc -l | tr -d ' ')
eq "300 字长条目（10 句）在页面上断成 9 处、括号内「。一个句号」不断；200 字内的短条目「第一句。第二句」不断；check 0 条" "9|y|y|0" \
  "$NBRK|$(printf '%s' "$RL" | grep -qF '。一个句号' && echo y || echo n)|$(printf '%s' "$RS" | grep -qF '第一句。第二句' && echo y || echo n)|$NP"
# 7 打死：不隐去 / 隐去后零丢失对不上
SRC=$(cat "$A"/docs/readable/spec/*.html 2>/dev/null || true)
eq "页面源码里搜不到 10.1.2.3、搜得到「已隐去」，check 仍 0 条" "n|y|0" "$(printf '%s' "$SRC" | grep -qF 10.1.2.3 && echo y || echo n)|$(printf '%s' "$SRC" | grep -qF 已隐去 && echo y || echo n)|$NP"
# 8 打死：尖括号占位成了标签 / 行内记号没排出来
eq "<名称> 在页面里是 &lt;名称&gt;、没有裸的 <名称>；粗体、等宽排成标签；check 仍 0 条" "y|n|y|y|0" \
  "$(printf '%s' "$SRC" | grep -qF '&lt;名称&gt;' && echo y || echo n)|$(printf '%s' "$SRC" | grep -qF '<名称>' && echo y || echo n)|$(printf '%s' "$SRC" | grep -qE '<(strong|b)[ >]' && echo y || echo n)|$(printf '%s' "$SRC" | grep -qE '<code[ >]' && echo y || echo n)|$NP"
# 9 打死：没画步骤图 / 图画在列表之后 / 图里的字带 data-block 串号
RH=$(rg "$A" "$N_H"); SVG=$(printf '%s' "$RH" | tr '\n' ' ' | grep -oE '<svg.*</svg>' | head -1 || true)
eq "「步骤」标题与第一条列表项之间有 <svg，图里没有 data-block；列表照旧完整（check 0 条）" "y|0|0" "$(printf '%s' "$RH" | grep -q '<svg' && echo y || echo n)|$(printf '%s' "$SVG" | grep -c 'data-block' || true)|$NP"
# 9b 对照：没有有序列表的章（概览）没有步骤图，且与步骤图所在页不是同一页（打死每页都画 / 无条件画）
PB=$(PG "$A" "$N_B"); PH=$(PG "$A" "$N_H")
eq "含「项乙」的概览章没有有序列表：该页无 <svg；步骤图所在页有 <svg 且两页不同" "0|y|y" \
  "$(grep -c '<svg' "$PB" || true)|$(grep -q '<svg' "$PH" && echo y || echo n)|$([ "$PB" != "$PH" ] && echo y || echo n)"
# 9c 打死：有序列表的序号丢了 / 改了编号
PM=$(PG "$A" "$N_2"); MK=$(tr '\n' ' ' <"$PM" | grep -oE 'data-block="[0-9]+"[^>]*>(<[^>]*>)*[[:space:]]*<[^>]*data-k="marker"[^>]*>[[:space:]]*[0-9]+[.)]' | grep -oE '[0-9]+[.)]$' | tr '\n' ,)
R="$TMP/r9c"; cpy "$A" "$R"; mt "$R" mark "$N_2" 2. 9.; ck "$R"
eq "步骤页上三项带 data-k=\"marker\" 显示原文序号 1. 2. 3.；把第二项序号手改成 9. → 退出码 1、spec-mismatch 恰 1 条（打死页面只画圆点 / 序号不进核对）" "1.,2.,3.,|1|spec-mismatch|1" \
  "$MK|$RC|$(sk)|$(jf "j.problems.filter(p=>p.kind=='spec-mismatch').length")"
# 9d 打死：段落不分句 / 半角点紧贴字处也断 / 分句后核对误报
RP=$(rg "$A" "$N_P"); NP2=$(printf '%s' "$RP" | grep -oE '[。；？！?;!](<[^>]*>|[[:space:]])+段落[0-9]+号' | wc -l | tr -d ' ')
eq "324 字的段落（12 句）在页面上断成 11 处、v2.31 没被拆开；check 0 条" "11|y|0" "$NP2|$(printf '%s' "$RP" | grep -qF 'v2.31' && echo y || echo n)|$NP"
# 9e 打死：页面文件名带章名
SD="$A/docs/readable/spec"
eq "spec/ 下除 index.html 外文件名都是 s-两位序号.html，前言与两章恰是 s-00 s-01 s-02" "0|3|y" \
  "$(ls -A "$SD" | grep -vxE 'index\.html|s-[0-9][0-9]\.html' | wc -l | tr -d ' ')|$(ls -A "$SD" | grep -cE '^s-0[012]\.html$' || true)|$(yn test -f "$SD/index.html")"
# 10 打死：spec 为 null 仍出页面 / 首页仍列；对照：同一夹具 spec 写了路径时首页有（第 1 臂）
R="$TMP/r10"; mk "$R" null; bd "$R"; B10=$RB; ck "$R"
eq "spec 为 null：build 0、docs/readable/spec 不存在、首页没有「需求规格」、check 0 条；对照（第 1 臂）首页有" "0|n|n|0|y" "$B10|$(yn test -e "$R/docs/readable/spec")|$(yn grep -q 需求规格 "$R/docs/readable/index.html")|$RC|$HOME_HAS"
# 11 打死：不确定 / 非原子（需求规格几页写时间或边写边覆盖）
H0=$(tree "$A/docs/readable"); bd "$A"; H1=$(tree "$A/docs/readable"); R="$TMP/r11"; mk "$R" '"spec.md"'; sleep 1; bd "$R"; DR=0; diff -r "$A/docs/readable" "$R/docs/readable" >/dev/null 2>&1 || DR=$?
L0=$(ls -A "$A/docs"); echo '- 新增项' >>"$A/spec.md"; RF=0; READABLE_FAIL_AT=render nd build --root "$A" >/dev/null 2>&1 || RF=$?; H2=$(tree "$A/docs/readable"); L1=$(ls -A "$A/docs"); bd "$A"; H3=$(tree "$A/docs/readable")
eq "同输入两次 build、换目录再出一遍逐字节相同；READABLE_FAIL_AT=render：退出码 3、总哈希与 docs 不变；对照不注入则变、页面带「新增项」" "same|0|3|same|same|differs|y" \
  "$([ "$H0" = "$H1" ] && echo same || echo changed)|$DR|$RF|$([ "$H1" = "$H2" ] && echo same || echo changed)|$([ "$L0" = "$L1" ] && echo same || echo "$L1")|$([ "$H2" != "$H3" ] && echo differs || echo same)|$(grep -rlq 新增项 "$A/docs/readable/spec" && echo y || echo n)"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
