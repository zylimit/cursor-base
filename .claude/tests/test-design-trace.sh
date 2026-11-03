#!/usr/bin/env bash
# risk: high
# test-design-trace.sh — 设计详述核对脚本（scripts/design-trace.mjs）的回归测试。
#
# 断言按**契约**写（.claude/rules/design-detail.md [核对脚本] + 模板 + 脚本头注释）：
#   node design-trace.mjs [--root <目录>] [--json]；三类缺口 = 文档现行编号没测试标 / 测试标了现行规则里
#   没有的编号（标已取代编号要说明）/ 常量表值与代码同名常量对不上；rc 0 全对或没有设计详述（跳过）、
#   1 有缺口、2 用法错。验收原文：最小样例（2 规则、1 有测试 1 没测试、1 常量不一致、1 测试标了不存在
#   的编号）恰好 3 条缺口 rc 1；补齐后 rc 0。样例全在 mktemp 里现造，trap 清理。
set -eu

SRC=$(cd "$(dirname "$0")/.." && pwd)
TRACE="$SRC/scripts/design-trace.mjs"
[ -f "$TRACE" ] || { echo "test-design-trace: 缺脚本：$TRACE" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "test-design-trace: 无 node——脚本是 .mjs，跑不起来；未执行 != 通过。" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }

RC=0
OUT=""
# run_trace <参数…> —— 收 rc 与合并输出（stdout+stderr）。
run_trace() { RC=0; OUT=$(node "$TRACE" "$@" 2>&1) || RC=$?; }
has() { case "$OUT" in *"$1"*) return 0 ;; *) return 1 ;; esac; }
# expect <名字> <期望rc> [必含子串…]
expect() {
  local name="$1" want="$2"; shift 2
  local miss=""
  for s in "$@"; do has "$s" || miss="$miss [$s]"; done
  if [ "$RC" -eq "$want" ] && [ -z "$miss" ]; then pass "$name"
  else fail "${name}（期望 rc=${want}，实得 rc=${RC}，缺子串：${miss:-无}；输出：${OUT}）"; fi
}

# 最小样例：2 条现行规则（AA-01 有测试标、AA-02 没有）、常量 MAX_N 文档 150 / 代码 160、
# 测试另标了文档里不存在的 ZZ-99 → 恰好 无测试 1 / 编号不存在 1 / 常量不一致 1。
mk_base() {
  local d="$1"
  rm -rf "$d"; mkdir -p "$d/docs/design" "$d/src" "$d/tests"
  cat > "$d/docs/design/demo-设计.md" <<'DOC'
# demo 设计详述

> 代码范围：`src/**`, `tests/**`

## 1. 概述

- **输入**：合成数字

## 2. 规则（按执行顺序）

### 2.1 第一步：截断

#### DM-AA-01 超过上限的值截断到上限

- **规则**：值大于 MAX_N 时取 MAX_N
- **测试**：`tests/test_calc.py::test_cap`

#### DM-AA-02 负值归零

- **规则**：值小于 0 时取 0
- **测试**：待补

## 3. 常量表

| 常量名 | 值 | 代码位置 | 含义 | 用于 |
|---|---|---|---|---|
| `MAX_N` | 150 | `src/calc.py` | 上限 | DM-AA-01 |

## 4. 已知例外与坑

- 无

## 5. 取代记录

<!-- 空 -->
DOC
  printf 'MAX_N = 160\n\ndef cap(v):\n    return min(v, MAX_N)\n' > "$d/src/calc.py"
  printf '# rule: DM-AA-01\ndef test_cap():\n    pass\n\n# rule: DM-ZZ-99\ndef test_ghost():\n    pass\n' > "$d/tests/test_calc.py"
}
# 补齐：给 AA-02 加标签、常量改一致、删掉错标签。
mk_fixed() {
  local d="$1"
  mk_base "$d"
  printf 'MAX_N = 150\n\ndef cap(v):\n    return min(v, MAX_N)\n' > "$d/src/calc.py"
  printf '# rule: DM-AA-01\ndef test_cap():\n    pass\n\n# rule: DM-AA-02\ndef test_floor():\n    pass\n' > "$d/tests/test_calc.py"
}

echo "===== test-design-trace ====="

echo "── 验收：最小样例恰好 3 条缺口、rc 1 ──"
D="$TMP/base"; mk_base "$D"
run_trace --root "$D"
expect "D1 最小样例 → rc 1 且汇总行三类计数各为 1" 1 "缺口 3 条" "无测试 1" "编号不存在 1" "常量不一致 1"
if has "DM-AA-02" && has "DM-ZZ-99" && has "MAX_N"; then pass "D2 三条缺口各点名 DM-AA-02 / DM-ZZ-99 / MAX_N"
else fail "D2 缺口清单没点全三个对象：$OUT"; fi
# 有测试的 AA-01 不许被当缺口：逐行找「无测试」行
if printf '%s\n' "$OUT" | grep -a '无测试' | grep -aq 'DM-AA-01'; then fail "D3 DM-AA-01 有 rule 标签，却被报无测试：$OUT"; else pass "D3 有标签的 DM-AA-01 不报无测试"; fi
if has "160" && has "150"; then pass "D4 常量缺口同时给出文档值 150 与代码值 160"
else fail "D4 常量缺口没给出两个值：$OUT"; fi

echo "── --json：机器读的三类计数 ──"
run_trace --root "$D" --json
J=$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const m=o.summary;console.log([m.total,m.noTest,m.noRule,m.constMismatch,o.gaps.length].join(","))}catch(e){console.log("ERR")}})')
if [ "$RC" -eq 1 ] && [ "$J" = "3,1,1,1,3" ]; then pass "J1 --json → rc 1，summary 3/1/1/1，gaps 数组 3 项"
else fail "J1 --json 不对（rc=${RC}，解析得 [$J]，输出：${OUT}）"; fi

echo "── 补齐 → rc 0 ──"
D="$TMP/fixed"; mk_fixed "$D"
run_trace --root "$D"
expect "F1 补齐（加标签 / 常量改一致 / 删错标签）→ rc 0、缺口 0 条" 0 "缺口 0 条"
run_trace --root "$D" --json
J=$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(o.summary.total+","+o.gaps.length)}catch(e){console.log("ERR")}})')
if [ "$RC" -eq 0 ] && [ "$J" = "0,0" ]; then pass "F2 补齐后 --json → rc 0，total 0"
else fail "F2 补齐后 --json 不对（rc=${RC}，[$J]）"; fi
# 单点补救各只消掉一条（三类互相独立，不能一补全消）
D="$TMP/part"; mk_base "$D"
printf 'MAX_N = 150\n\ndef cap(v):\n    return min(v, MAX_N)\n' > "$D/src/calc.py"
run_trace --root "$D"
expect "F3 只改常量 → 仍 rc 1，剩 2 条（无测试 1 / 编号不存在 1 / 常量不一致 0）" 1 "缺口 2 条" "无测试 1" "编号不存在 1" "常量不一致 0"
D="$TMP/part2"; mk_base "$D"
printf '# rule: DM-AA-01, DM-AA-02\ndef test_cap():\n    pass\n' > "$D/tests/test_calc.py"
run_trace --root "$D"
expect "F4 一个用例逗号分隔标两条 + 删错标签 → 只剩常量缺口 1 条" 1 "缺口 1 条" "无测试 0" "编号不存在 0" "常量不一致 1"

echo "── 用法错 rc 2 / 没有设计详述 rc 0 ──"
run_trace --bogus
expect "U1 未知参数 → rc 2" 2
run_trace --root
expect "U2 --root 缺值 → rc 2" 2
run_trace --root "$TMP/不存在的目录"
expect "U3 --root 指向不存在目录 → rc 2" 2
mkdir -p "$TMP/empty"
run_trace --root "$TMP/empty"
expect "N1 没有 docs/design/ → rc 0 且输出含「跳过」" 0 "跳过"
mkdir -p "$TMP/emptydir/docs/design"; printf 'x\n' > "$TMP/emptydir/docs/design/readme.txt"
run_trace --root "$TMP/emptydir"
expect "N2 docs/design/ 里没有 .md → rc 0 且含「跳过」" 0 "跳过"
run_trace --root "$TMP/empty" --json
if [ "$RC" -eq 0 ] && has '"skipped"'; then pass "N3 跳过时 --json 也 rc 0 并带 skipped 标记"
else fail "N3 跳过的 --json 不对（rc=${RC}，${OUT}）"; fi
# 默认 root 为当前目录
D="$TMP/cwd"; mk_base "$D"
RC=0; OUT=$(cd "$D" && node "$TRACE" 2>&1) || RC=$?
expect "N4 不给 --root 以当前目录为根 → rc 1、缺口 3 条" 1 "缺口 3 条"

echo "── 取代记录 / 围栏 / 标签变体 ──"
D="$TMP/sup"; mk_fixed "$D"
cat >> "$D/docs/design/demo-设计.md" <<'DOC'

#### DM-AA-00 旧版：负值取绝对值 → 被 2026-02-01 DM-AA-02 取代

- **规则**：已作废
DOC
printf '# rule: DM-AA-00\ndef test_old():\n    pass\n' >> "$D/tests/test_calc.py"
run_trace --root "$D"
expect "S1 测试标了取代记录里的旧编号 → 归「编号不存在」一类，且文案提到已取代 / 新编号" 1 "缺口 1 条" "编号不存在 1" "DM-AA-00" "取代" "DM-AA-02"
D="$TMP/sup2"; mk_fixed "$D"
cat >> "$D/docs/design/demo-设计.md" <<'DOC'

#### DM-AA-00 旧版 → 被 2026-02-01 DM-AA-02 取代
DOC
run_trace --root "$D"
expect "S2 取代记录里的旧编号没人标 → 不算「无测试」缺口，rc 0" 0 "缺口 0 条"
D="$TMP/fence"; mk_fixed "$D"
cat >> "$D/docs/design/demo-设计.md" <<'DOC'

## 4.1 写法示例

```
#### DM-FF-01 围栏里的示例标题
```

~~~
#### DM-FF-02 波浪围栏里的示例标题
~~~
DOC
run_trace --root "$D"
expect "X1 围栏代码块里的 #### XX-YY-01 不算规则 → rc 0" 0 "缺口 0 条"
D="$TMP/js"; mk_fixed "$D"
printf '// rule: DM-AA-01, DM-AA-02\ntest("x", () => {});\n' > "$D/tests/calc.test.js"
printf '# rule: DM-AA-01\n' > "$D/tests/test_calc.py"
run_trace --root "$D"
expect "X2 JS 的 // rule: 标签同样认（Py 只标 AA-01，AA-02 靠 JS 文件）→ rc 0" 0 "缺口 0 条"
D="$TMP/hit"; mk_fixed "$D"
printf '# rule: DM-AA-01\n' > "$D/tests/test_calc.py"
run_trace --root "$D"
expect "X3 反证 X2：去掉 JS 标签后 AA-02 无人标 → rc 1、无测试 1" 1 "无测试 1" "DM-AA-02"

echo "── 常量表边界 ──"
D="$TMP/c1"; mk_fixed "$D"
rm "$D/src/calc.py"
run_trace --root "$D"
expect "C1 代码位置的文件不存在 → 常量缺口（不静默放过）" 1 "常量不一致 1" "MAX_N"
D="$TMP/c2"; mk_fixed "$D"
printf 'OTHER = 150\n' > "$D/src/calc.py"
run_trace --root "$D"
expect "C2 文件在但找不到同名常量 → 常量缺口" 1 "常量不一致 1" "MAX_N"
D="$TMP/c3"; mk_fixed "$D"
printf 'export const MAX_N = 150; // 上限\n' > "$D/src/calc.py"
run_trace --root "$D"
expect "C3 JS 风格 export const … = 150; // 注释 → 值一致，rc 0" 0 "缺口 0 条"
D="$TMP/c4"; mk_fixed "$D"
printf 'MAX_N = 150  # 上限\n' > "$D/src/calc.py"
run_trace --root "$D"
expect "C4 Py 行尾注释不影响比对 → rc 0" 0 "缺口 0 条"

# ---- 实现者按审查意见改过一轮后补的回归（契约：rules/design-detail.md [文档结构] [核对脚本]）----
# 样例的文首代码范围行 `src/**`, `tests/**` 在改版后是必需的：缺了或匹配 0 个文件都算结构缺口，
#   所以 mk_base 一开始就带着它、且两个通配都能匹配到样例里的文件。
# jsum <目录> —— 取 --json 的 total,noTest,noRule,constMismatch,structure（字段缺省按 0）。
jsum() {
  node "$TRACE" --root "$1" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const m=JSON.parse(s).summary;console.log([m.total,m.noTest,m.noRule,m.constMismatch,m.structure||0].join(","))}catch(e){console.log("ERR")}})'
}
chk_sum() { # 名字 目录 期望 total,noTest,noRule,constMismatch,structure [期望rc]
  local got rcw="${4:-}"
  got=$(jsum "$2"); node "$TRACE" --root "$2" >/dev/null 2>&1 && RC=0 || RC=$?
  if [ "$got" = "$3" ] && { [ -z "$rcw" ] || [ "$RC" -eq "$rcw" ]; }; then pass "$1"
  else fail "$1（期望 summary=$3 rc=${rcw:-任意}，实得 summary=$got rc=${RC}）"; fi
}

echo "── 规则标题写法 / 结构缺口 ──"
D="$TMP/h1"; mk_fixed "$D"
cat > "$D/docs/design/demo-设计.md" <<'DOC'
# demo 设计详述

> 代码范围：`src/**`, `tests/**`

## 2. 规则

#### TR-A-01：全角冒号接标题

- **规则**：x

#### **TR-A-02** 编号加粗的标题

- **规则**：y

## 3. 常量表

| 常量名 | 值 | 代码位置 | 含义 | 用于 |
|---|---|---|---|---|
DOC
printf '# rule: TR-A-01, TR-A-02\ndef test_a():\n    pass\n' > "$D/tests/test_calc.py"
chk_sum "H1 标题 `#### TR-A-01：标题` 与 `#### **TR-A-02** 标题` 都解析成规则 → 无缺口 rc 0" "$D" "0,0,0,0,0" 0
printf '# rule: TR-A-01\ndef test_a():\n    pass\n' > "$D/tests/test_calc.py"
chk_sum "H1b 反证：只标 TR-A-01 → TR-A-02 被识别为规则而报无测试 1" "$D" "1,1,0,0,0" 1
D="$TMP/h2"; mk_fixed "$D"
cat >> "$D/docs/design/demo-设计.md" <<'DOC'
DOC
python3 - "$D/docs/design/demo-设计.md" <<'PY'
import sys
p=sys.argv[1]; t=open(p,encoding='utf8').read()
t=t.replace("#### DM-AA-02 负值归零","#### 这条标题忘了写编号\n\n- **规则**：z\n\n#### DM-AA-02 负值归零",1)
open(p,'w',encoding='utf8').write(t)
PY
chk_sum "H2 规则段里解析不出编号的 #### 行 → 恰 1 条结构缺口、rc 1（其余三类 0）" "$D" "1,0,0,0,1" 1
D="$TMP/h3"; mk_fixed "$D"
cp "$SRC/skills/arch-designer/templates/design-detail-template.md" "$D/docs/design/demo-设计.md"
run_trace --root "$D"
if [ "$RC" -eq 1 ] && [ "$(jsum "$D" | awk -F, '{print $5}')" -ge 1 ] 2>/dev/null; then pass "H3 只有模板占位的设计详述 → rc 1 且至少 1 条结构缺口"
else fail "H3 模板原样应报结构缺口（rc=${RC}，summary=$(jsum "$D")，输出：${OUT}）"; fi
D="$TMP/h4"; mk_fixed "$D"
python3 - "$D/docs/design/demo-设计.md" <<'PY'
import sys
p=sys.argv[1]; t=open(p,encoding='utf8').read()
t=t.replace("> 代码范围：`src/**`, `tests/**`\n","",1)
open(p,'w',encoding='utf8').write(t)
PY
chk_sum "H4 文首没有代码范围行 → 结构缺口 1、rc 1" "$D" "1,0,0,0,1" 1
D="$TMP/h5"; mk_fixed "$D"
# shellcheck disable=SC2016  # 单引号里的反引号是 fixture 文本里的字面量，本就不该展开
sed -i 's#`src/\*\*`, `tests/\*\*`#`src/**`, `nomatch/**`#' "$D/docs/design/demo-设计.md"
chk_sum "H5 某条通配在项目里匹配 0 个文件 → 结构缺口 1、rc 1" "$D" "1,0,0,0,1" 1

echo "── 标签只认测试文件 / 标签文本不是编号 ──"
D="$TMP/t1"; mk_fixed "$D"
printf '# rule: DM-AA-01\ndef test_cap():\n    pass\n' > "$D/tests/test_calc.py"
printf 'MAX_N = 150\n# rule: DM-AA-02\ndef cap(v):\n    return min(v, MAX_N)\n' > "$D/src/calc.py"
chk_sum "T1 实现文件（src/calc.py，非测试）里的 # rule: DM-AA-02 不抵消无测试缺口 → 无测试 1" "$D" "1,1,0,0,0" 1
D="$TMP/t2"; mk_fixed "$D"
printf '// rule: input must be sorted\ntest("x", () => {});\n' > "$D/tests/sorted.test.js"
chk_sum "T2 // rule: input must be sorted 这种非编号文本不被当成编号 → 无编号不存在缺口、rc 0" "$D" "0,0,0,0,0" 0
D="$TMP/t3"; mk_fixed "$D"
mkdir -p "$D/tests/docs"
printf '# rule: DM-AA-01, DM-AA-02\ndef test_x():\n    pass\n' > "$D/tests/docs/test_x.py"
rm "$D/tests/test_calc.py"
chk_sum "T3 tests/docs/test_x.py 里的标签能扫到（docs 只在根目录跳过）→ rc 0" "$D" "0,0,0,0,0" 0

echo "── 常量比对：注释 / 唯一性 / Java 字面量 ──"
D="$TMP/k1"; mk_fixed "$D"
printf '# MAX_N = 999\nMAX_N = 150\n' > "$D/src/calc.py"
chk_sum "K1 行注释里的旧值不参与比对 → rc 0" "$D" "0,0,0,0,0" 0
printf '"""\nMAX_N = 999\n"""\nMAX_N = 150\n' > "$D/src/calc.py"
chk_sum "K2 三引号文档字符串里的旧值不参与比对 → rc 0" "$D" "0,0,0,0,0" 0
printf 'MAX_N = 150\nMAX_N = 150\n' > "$D/src/calc.py"
chk_sum "K3 同名常量两处赋值 → 常量缺口 1（定义不唯一）" "$D" "1,0,0,1,0" 1
run_trace --root "$D"
if has "不唯一"; then pass "K3b 文案点明「定义不唯一」"
else fail "K3b 文案没说定义不唯一：$OUT"; fi
D="$TMP/k2"; mk_fixed "$D"
python3 - "$D/docs/design/demo-设计.md" <<'PY'
import sys
p=sys.argv[1]; t=open(p,encoding='utf8').read()
t=t.replace("| `MAX_N` | 150 | `src/calc.py` | 上限 | DM-AA-01 |","| `LIMIT` | 5000 | `src/Calc.java` | 上限 | DM-AA-01 |\n| `RATIO` | 0.5 | `src/Calc.java` | 比例 | DM-AA-01 |",1)
open(p,'w',encoding='utf8').write(t)
PY
printf 'class Calc {\n  static final long LIMIT = 5_000L;\n  static final float RATIO = 0.5f;\n}\n' > "$D/src/Calc.java"
chk_sum "K4 Java 的 5_000L、0.5f 与文档 5000、0.5 判相等 → rc 0" "$D" "0,0,0,0,0" 0
printf 'class Calc {\n  static final long LIMIT = 5_000L;\n  static final float RATIO = 0.6f;\n}\n' > "$D/src/Calc.java"
chk_sum "K5 故意不等（0.6f vs 0.5）→ 常量缺口 1、rc 1" "$D" "1,0,0,1,0" 1
printf 'class Calc {\n  static final long LIMIT = 5_001L;\n  static final float RATIO = 0.5f;\n}\n' > "$D/src/Calc.java"
chk_sum "K6 故意不等（5_001L vs 5000）→ 常量缺口 1、rc 1" "$D" "1,0,0,1,0" 1

echo "── 脚本内部错误 rc 3 ──"
D="$TMP/e1"; mk_fixed "$D"
mkdir -p "$D/docs/design/bad.md"
RC=0; ERR=$(node "$TRACE" --root "$D" 2>&1 >/dev/null) || RC=$?
if [ "$RC" -eq 3 ] && [ -n "$ERR" ]; then pass "E1 docs/design/bad.md 是目录 → rc 3 且 stderr 有说明（不与「有缺口」rc 1 混）"
else fail "E1 目录冒充设计详述应 rc 3（rc=${RC}，stderr：${ERR}）"; fi

echo ""
echo "==== test-design-trace：PASS=$PASS FAIL=$FAIL ===="
if [ "$FAIL" -gt 0 ]; then
  echo "test-design-trace: failed（见上方 FAIL 行：design-trace 与契约不符）" >&2
  exit 1
fi
echo "test-design-trace: passed（三类缺口 / 补齐 / 用法错 / 跳过均符合契约）"
