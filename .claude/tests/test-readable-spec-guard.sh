#!/usr/bin/env bash
# risk: high
# test-readable-spec-guard.sh — 需求规格「守卫自己还在不在」回归（phase2-spec-contract.md B/C/D/E 与 phase1 G 节隐去规则）。
# 断言只从约定推导；最贵的错是假绿（页面少字 / 没了层次而 check 报 0 条）。每个「该报」配「不该报」对照。
# 夹具是合成内容；口令样字面量运行时拼。mktemp -d + --root。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/readable-docs.mjs}"
echo "===== test-readable-spec-guard ====="
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
jf() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=eval(process.argv[2]);console.log(typeof v==="object"?JSON.stringify(v):String(v))}catch(e){console.log("NOJSON")}' "${2:-$TMP/f.json}" "$1"; }
sk() { jf "[...new Set(j.problems.filter(p=>p.kind.startsWith('spec-')).map(p=>p.kind))].sort().join(',')"; }
nk() { jf "j.problems.filter(p=>p.kind=='$1').length"; }
at() { jf "j.problems.some(p=>p.kind=='$1'&&/(^|\\D)$2(\\D|\$)/.test(p.where+' '+p.detail))"; }   # at <kind> <来源行号>：点到了那一行
yn() { if "$@" >/dev/null 2>&1; then printf y; else printf n; fi; }
tree() { (cd "$1" && find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-16); }
sp() { cat "$1"/docs/readable/spec/s-*.html; }
tx() { sp "$1" | sed 's/<[^>]*>//g'; }   # 页面纯文字
fx() { nd build --facts-json --root "$1" >"$TMP/fx.json" 2>/dev/null || true; }
bf() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const b=j.spec.blocks.find(b=>(b.text||"").includes(process.argv[2]));console.log(b?b[process.argv[3]]:0)' "$TMP/fx.json" "$1" "$2"; }   # bf <子串> n|line
X() { RC=0; if [ -n "$1" ]; then READABLE_FAIL_AT="$1" nd "${@:2}" >"$TMP/o" 2>"$TMP/e" || RC=$?; else nd "${@:2}" >"$TMP/o" 2>"$TMP/e" || RC=$?; fi; }
mk() {  # mk <root>，stdin 是需求规格
  mkdir -p "$1/docs/readable-src" "$1/sql"; echo "CREATE TABLE orders (id int PRIMARY KEY);" >"$1/sql/s.sql"
  printf '{"version":1,"title":"t","spec":"spec.md","ddl":["sql/s.sql"],"codeRoots":[],"ignore":[]}\n' >"$1/docs/readable-src/config.json"; cat >"$1/spec.md"
}
cat >"$TMP/mut.js" <<'EOF'
const [,, op, file, n, a, b] = process.argv; const fs = require('fs'); let h = fs.readFileSync(file, 'utf8');
const el = (s) => { const t = /^<(\w+)/.exec(h.slice(s))[1], re = new RegExp('<' + t + '(?=[\\s>/])|</' + t + '>', 'g'); re.lastIndex = s; let d = 0, m;
  while ((m = re.exec(h))) { d += m[0][1] === '/' ? -1 : 1; if (d === 0) return s + (m.index - s) + m[0].length; } return -1; };
const i = h.indexOf((op === 'pw' || op === 'pdel' ? 'data-print-of="' : 'data-block="') + n + '"');
if (op === 'lift') { const s = h.lastIndexOf('<li', i), e = el(s), li = h.slice(s, e), ps = h.lastIndexOf('<li', s - 1); h = h.slice(0, s) + h.slice(e); const pe = el(ps); h = h.slice(0, pe) + li + h.slice(pe); }
if (op === 'hd') { const s = h.lastIndexOf('<h', i), e = h.indexOf('</h' + a + '>', s); h = h.slice(0, s + 2) + b + h.slice(s + 3, e) + '</h' + b + '>' + h.slice(e + 5); }
if (op === 'pw' || op === 'pdel') { const s = h.lastIndexOf('<', i), e = el(s); h = op === 'pdel' ? h.slice(0, s) + h.slice(e) : h.slice(0, s) + h.slice(s, e).replace(a, b) + h.slice(e); }
fs.writeFileSync(file, h);
EOF
mu() { f=$(grep -l "$([ "$2" = pw ] || [ "$2" = pdel ] && echo data-print-of || echo data-block)=\"$3\"" "$1"/docs/readable/spec/s-*.html | head -1); [ -n "$f" ] || return 0; node "$TMP/mut.js" "$2" "$f" "$3" "${4:-}" "${5:-}"; }   # mu <根> lift|hd|pw|pdel <块号> [a b]
BASE='# 守卫基线

## 一章

### 小节甲

- 父项甲
  - 子项乙
- 父项丙

### 小节丁

段落丁。

> 引用甲
> 引用乙'
nb() { rm -rf "$1"; mk "$1" <<<"$BASE"; bd "$1"; }
# 1 打死：隐去连带吞掉后面的中文 / 值取到空白为止
K=pass; K2=word; T=tok; T2=en; R="$TMP/r1"
mk "$R" <<EOF
# 守卫

## 一

- $(printf '%s%s=%s' "$K" "$K2" Abc12345)，生产环境与测试环境各一套说明
- $(printf '%s%s:%s' "$T" "$T2" Abcdef)令牌说明保持原样
- 接口在 http://gw-host:8080，有问题发邮件到 ops@example.com 结束
EOF
bd "$R"; ck "$R"; P=$(tx "$R"); I=$(sed 's/<[^>]*>//g' "$R/docs/readable/spec/index.html")
eq "口令值后紧跟中文：只换那 8 位（后面中文都在）；token: 加六个字母不换；带端口网址加邮件不换；清单写换掉 8 个字；check 0 条" "y|y|y|y|1|y|y|00" \
  "$(yn grep -qF "$K$K2=〔已隐去〕，生产环境与测试环境各一套说明" <<<"$P")|$(yn grep -qF "Abcdef令牌说明保持原样" <<<"$P")|$(yn grep -qF "http://gw-host:8080，有问题发邮件到 ops@example.com 结束" <<<"$P")|$(yn grep -qE '换掉|8 ?个字' <<<"$I")|$(grep -o '〔已隐去〕' <<<"$P" | wc -l | tr -d ' ')|$(yn grep -qE '(^|[^0-9])8 ?个字' <<<"$I")|$(yn test -n "$P")|$RC$(jf j.problems.length)"
# 2 对照：真带口令的地址与中文关键字仍被隐去、页面搜不到值
PW=$(printf '%s%s' Zq7xK2 mP); VAL='Ab3$xY9!z'; R="$TMP/r2"
mk "$R" <<EOF
# 守卫

## 一

- 地址 $(printf '%s://%s%s%s/x' http "svc:$PW" @ hostname) 之后
- 密码：${VAL}之后的中文说明仍在
EOF
bd "$R"; ck "$R"; P=$(tx "$R")
eq "对照：带口令地址的口令、「密码：」后的值都搜不到，两处各隐去，「之后的中文说明仍在」留着，check 0 条" "n|n|y|y|00" \
  "$(yn grep -qF "$PW" <<<"$P")|$(yn grep -qF "$VAL" <<<"$P")|$(yn grep -qF "之后的中文说明仍在" <<<"$P")|$([ "$(grep -o '〔已隐去〕' <<<"$P" | wc -l)" -ge 2 ] && echo y || echo n)|$RC$(jf j.problems.length)"
# 3 打死：围栏起始行后的说明文字页面上没有 / 不进核对
R="$TMP/r3"; mk "$R" <<'EOF'
# 围栏

## 一

段落前。

```text 这是围栏说明句
echo 一行
```
EOF
bd "$R"; ck "$R"; C0=$RC$(jf j.problems.length); INF=$(sp "$R" | tr '\n' ' ' | grep -oE 'data-k="info".{0,400}' | head -1 || true); fx "$R"
FI=$(jf "j.spec.blocks.filter(b=>b.kind=='fence'&&(b.info||'').includes('这是围栏说明句')).length" "$TMP/fx.json")
sed -i 's/这是围栏说明句/这是围栏说明局/' "$R"/docs/readable/spec/s-*.html; ck "$R"
eq "围栏说明句：页面搜得到且带 data-k=info、facts 里那块有 info、check 0 条；页面上改一个字 → 退出码 1、spec-mismatch" "y|1|00|1|spec-mismatch" \
  "$(yn grep -qF 这是围栏说明句 <<<"$INF")|$FI|$C0|$RC|$(sk)"
# 4 打死：切块还原自检被摘掉 / 出半份结果；对照不注入全正常
nb "$TMP/b4"; H=$(tree "$TMP/b4/docs/readable"); L=$(printf 'build|check --json|build --facts-json')
G4=""; for c in "build" "check --json" "build --facts-json"; do X spec-cut $c --root "$TMP/b4"; G4="$G4$RC,$(yn grep -qE '[0-9]+' "$TMP/e"),$(wc -c <"$TMP/o" | tr -d ' ')/"; done
H1=$(tree "$TMP/b4/docs/readable"); N4=""; for c in "build" "check --json" "build --facts-json"; do X "" $c --root "$TMP/b4"; N4="$N4$RC,"; done
printf '# 标题\n\n\xff\xfe坏字节\n' >"$TMP/b4/spec.md"; X "" build --root "$TMP/b4"
eq "spec-cut 注入：build/check/facts 都退出码 3、stderr 带行号、stdout 为空、docs/readable 哈希不变；不注入都 0；非法 UTF-8 → 3" "3,y,0/3,y,0/3,y,0/|same|0,0,0,|3" \
  "$G4|$([ "$H" = "$H1" ] && echo same || echo changed)|$N4|$RC"
# 5 打死：落盘前的需求规格自检被摘掉；对照不注入则生成且页面变
nb "$TMP/b5"; H=$(tree "$TMP/b5/docs/readable"); echo '- 新增项' >>"$TMP/b5/spec.md"; X spec-render build --root "$TMP/b5"; R5=$RC; H1=$(tree "$TMP/b5/docs/readable")
X "" build --root "$TMP/b5"; H2=$(tree "$TMP/b5/docs/readable")
eq "spec-render 注入：build 退出码 3、原有页面哈希不变；对照不注入：退出码 0、页面变且带「新增项」" "3|same|0|differs|y" \
  "$R5|$([ "$H" = "$H1" ] && echo same || echo changed)|$RC|$([ "$H" != "$H2" ] && echo differs || echo same)|$(yn grep -q 新增项 <(sp "$TMP/b5"))"
# 6 打死：列表树被拍平 / 标题级数被统一；对照没动 0 条
nb "$TMP/b6"; fx "$TMP/b6"; NC=$(bf 子项乙 n); LC=$(bf 子项乙 line); NH=$(bf 小节甲 n); LH=$(bf 小节甲 line); ck "$TMP/b6"; Z=$RC$(nk spec-structure)
cp -r "$TMP/b6" "$TMP/b6a"; mu "$TMP/b6a" lift "$NC"; ck "$TMP/b6a"; A=$RC,$(sk),$(at spec-structure "$LC")
cp -r "$TMP/b6" "$TMP/b6b"; mu "$TMP/b6b" hd "$NH" 3 4; ck "$TMP/b6b"; B=$RC,$(sk),$(at spec-structure "$LH")
eq "对照没动 0 条；子项 <li> 挪到顶层列表 → 1、只报 spec-structure 点到来源第 ${LC} 行；<h3> 换 <h4> → 同样点到第 ${LH} 行" "00|1,spec-structure,true|1,spec-structure,true" "$Z|$A|$B"
# 7 打死：打印那一份不进核对；对照没动 0 条且每块引用恰一份
NQ=$(bf 引用甲 n); ck "$TMP/b6"; Z=$RC$(jf j.problems.length); NPR=$(sp "$TMP/b6" | grep -o "data-print-of=\"$NQ\"" | wc -l | tr -d ' ')
cp -r "$TMP/b6" "$TMP/b7a"; mu "$TMP/b7a" pw "$NQ" 引用乙 引用丙; ck "$TMP/b7a"; A=$RC,$(sk)
cp -r "$TMP/b6" "$TMP/b7b"; mu "$TMP/b7b" pdel "$NQ"; ck "$TMP/b7b"; B=$RC,$(sk)
eq "对照没动 0 条、引用块恰有 1 份 data-print-of；改打印份一个字 → 1、spec-mismatch；整份删掉 → 同样" "00|1|1,spec-mismatch|1,spec-mismatch" "$Z|$NPR|$A|$B"
# 8 打死：块数多时 LCS 退化乱报顺序 / 漏报
R="$TMP/r8"; { echo '# 大'; echo; seq 1 2100 | sed 's/.*/- 项目&号说明/'; } | mk "$R"; bd "$R"; ck "$R"; Z=$RC$(jf j.problems.length)
sed -i -e 's/^- 项目1号说明$/- 项目1号说名/' -e 's/^- 项目2100号说明$/- 项目2100号说名/' "$R/spec.md"; ck "$R"
eq "2100 条列表项：生成后对照 0 条；改首尾各一个字不重出 → spec-mismatch 恰 2 条、spec-order 0 条" "00|2|0" "$Z|$(nk spec-mismatch)|$(nk spec-order)"
# 9 打死：内网地址从标题 / 粗体词 / 锚点 / 清单页漏出去
R="$TMP/r9"; mk "$R" <<'EOF'
# 总

## 二级 10.9.8.7 标题

### 三级 192.168.4.5 小节

- **172.20.1.2**：粗体词条目说明
EOF
bd "$R"; ck "$R"; HIT=$(grep -rlE '10\.9\.8\.7|192\.168\.4\.5|172\.20\.1\.2' "$R/docs/readable" | wc -l | tr -d ' ')
eq "内网地址写在二、三级标题与粗体词里：build 0、整个 docs/readable 下（含属性、标题、清单页）搜不到、页面仍有「粗体词条目说明」、check 0 条" "0|0|y|00" \
  "$RB|$HIT|$(yn grep -qF 粗体词条目说明 <(tx "$R"))|$RC$(jf j.problems.length)"
echo "===== 汇总：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
