#!/usr/bin/env bash
# risk: low
# test-fast-mode.sh — 旧入口 scripts/fast-mode.sh 的回归（Phase A 起它是薄壳）。
# 契约：开关只有一个——`.claude/.runtime/tier.json`。fast-mode.sh 自己不解析、不落盘，
#   `on N` 转发 `tier set fast --hours N`、`off` 转发 `tier set standard`；`.claude/.fast-mode`
#   既不写也不读（#38：一个开关不许两个解析器）。
# 留一条（2026-09-10 预算表）：on 写出 fast 档且不产生旧开关文件（#38 的一开关一解析器）。
#   off 回默认档、小时数差值、8h 上限、非法入参、抽 tdd-gate、判定库缺失那批退休——
#   档位判定那半归 test-tier.sh 与 test-tier-hardening.sh。
# 临时目录当项目根（拷 scripts / hooks / harness / profile），trap 清理；对本仓只读。
set -eu

SRC=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$SRC/scripts/fast-mode.sh" ] || { echo "test-fast-mode: 缺 $SRC/scripts/fast-mode.sh" >&2; exit 1; }
[ -f "$SRC/harness/profile.json" ] || { echo "test-fast-mode: 缺 $SRC/harness/profile.json——档位没启用，这份测的东西不存在" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "test-fast-mode: 无 node——引擎与薄壳转发的都是 .mjs；未执行 != 通过。" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
# 伪项目根：拷薄壳、引擎（薄壳要转发给它）、档位表。lib/ 按目录整拷、不枚举模块名：
# 枚举法漏一个就是 ERR_MODULE_NOT_FOUND 的假红。
ROOT="$TMP/proj"
mkdir -p "$ROOT/.claude/scripts" "$ROOT/.claude/hooks/lib" "$ROOT/.claude/harness"
cp "$SRC/scripts/fast-mode.sh" "$ROOT/.claude/scripts/"
cp -R "$SRC/hooks/lib/." "$ROOT/.claude/hooks/lib/"
cp "$SRC/harness/harness.mjs" "$SRC/harness/profile.json" "$ROOT/.claude/harness/"
[ -d "$SRC/harness/lib" ] && cp -R "$SRC/harness/lib" "$ROOT/.claude/harness/"
FM="bash $ROOT/.claude/scripts/fast-mode.sh"
TIERF="$ROOT/.claude/.runtime/tier.json"; LEGACY="$ROOT/.claude/.fast-mode"
# jf <文件> <js 表达式（变量 d）> —— 取 tier.json 字段；文件缺失/坏 JSON 输出 <none>。
jf() {
    node -e '
const fs = require("node:fs");
try {
  const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(eval(process.argv[2])));
} catch (e) { process.stdout.write("<none>"); }
' "$1" "$2"
}

echo "===== test-fast-mode ====="

# ① on 4 → tier.json 里 tier=fast，且不产生旧开关文件
$FM on 4 >/dev/null 2>&1 || true
if [ "$(jf "$TIERF" 'd.tier')" = "fast" ]; then
  pass "on 4 → .claude/.runtime/tier.json 的 tier=fast"
else
  fail "on 4 未写出 fast 档的 tier.json（实得：$(jf "$TIERF" 'JSON.stringify(d)')）"
fi
if [ ! -f "$LEGACY" ]; then
  pass "on 不再产生 .claude/.fast-mode（薄壳自己不落盘）"
else
  fail "on 仍写了 .claude/.fast-mode（内容：$(cat "$LEGACY" 2>/dev/null)）"
fi

# ② on --sticky → 原样转发 tier set fast --sticky（TODO #91）：sticky:true、expires_epoch:null
$FM on --sticky >/dev/null 2>&1 || true
if [ "$(jf "$TIERF" 'd.tier+"/"+d.sticky+"/"+d.expires_epoch')" = "fast/true/null" ]; then
  pass "on --sticky → tier.json 为 fast/sticky:true/expires_epoch:null（薄壳透传，不自己算过期）"
else
  fail "on --sticky 未透传成 sticky（实得：$(jf "$TIERF" 'JSON.stringify(d)')）"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
