#!/usr/bin/env bash
# risk: medium
# test-exclusions-parity.sh — 排除表对拍：.claude/.gitignore 列的运行态文件必须同时在
#   harness/exclusions.json 的 pattern 里，否则 gen-manifest.sh 会把本机恰好存在的标记登记成框架文件，
#   装到别的机器上 doctor.sh 报「登记了但本地没有」。2026-11-04 一天漏了两条（.three-file-sync-advised、
#   .tdd-gate-advised），第二条已随提交污染过一次 FRAMEWORK-MANIFEST.txt。
#   EP-1 gitignore → 排除表；EP-2 清单里没有标记文件名；EP-3 排除表（运行态标记）→ gitignore 反向对拍。
#
# 依赖：node（解析 JSON，故意不用 jq）。纪律：对本仓只读；每条断言打印 EXPECT / GOT。
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
GI="$ROOT/.claude/.gitignore"
EX="$ROOT/.claude/harness/exclusions.json"
MF="$ROOT/.claude/FRAMEWORK-MANIFEST.txt"

echo "===== test-exclusions-parity ====="

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node——exclusions.json 解析不了，未执行 != 通过。" >&2
    exit 1
fi
for f in "$GI" "$EX" "$MF"; do
    if [ ! -f "$f" ]; then
        echo "SKIPPED: 缺 $f，未执行 != 通过。" >&2
        exit 1
    fi
done

PASS=0
FAIL=0

# chk <判定 0=过/1=不过> <标题> <EXPECT 描述> <GOT 描述>
chk() {
    if [ "$1" -eq 0 ]; then
        PASS=$((PASS + 1)); echo "  [PASS] $2"
    else
        FAIL=$((FAIL + 1)); echo "  [FAIL] $2"
    fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}

# q <js 表达式> —— 作用域：gi（gitignore 有效条目，已去尾 /）、pats（exclusions pattern 全集）、
# entries（exclusions 条目）、manifestPaths（清单路径列）。结果以空格拼接，空则打印「无」。
q() {
    # shellcheck disable=SC2016  # 单引号内是喂给 node -e 的 JS 源码
    node -e '
const fs = require("node:fs");
const lines = (p) => fs.readFileSync(p, "utf8").split(/\r?\n/);
const gi = lines(process.argv[1]).map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#")).map((l) => l.replace(/\/$/, ""));
const entries = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).entries;
const pats = entries.map((e) => e.pattern);
const manifestPaths = lines(process.argv[3]).filter((l) => l !== "" && !l.startsWith("#"))
  .map((l) => l.split("\t")[0]);
const out = eval(process.argv[4]);
process.stdout.write(Array.isArray(out) ? (out.join(" ") || "无") : String(out));
' "$GI" "$EX" "$MF" "$1"
}

echo ""

N_GI=$(q 'gi.length')
MISS1=$(q 'gi.filter((g) => !pats.some((p) => p.replace(/\/\*$/, "") === g))')
chk "$([ "$N_GI" -gt 0 ] && [ "$MISS1" = "无" ] && echo 0 || echo 1)" \
    "EP-1 .claude/.gitignore 每条有效条目（共 $N_GI 条）在 exclusions.json 都有对应 pattern（条目去尾 /，pattern 去尾 /*，相等即对应）" \
    "有效条目 >0 且未对应条目为空" "未对应：$MISS1"

HIT2=$(q 'gi.filter((g) => !g.includes("/") && !g.includes("*") && manifestPaths.includes(g))')
chk "$([ "$HIT2" = "无" ] && echo 0 || echo 1)" \
    "EP-2 FRAMEWORK-MANIFEST.txt 路径列不含 .gitignore 的单文件型条目（标记文件被登记成框架文件）" \
    "命中为空" "命中：$HIT2"

MISS3=$(q 'entries.filter((e) => e.keep === false && String(e.note || "").includes("运行态标记") && !gi.includes(e.pattern)).map((e) => e.pattern)')
N3=$(q 'entries.filter((e) => e.keep === false && String(e.note || "").includes("运行态标记")).length')
chk "$([ "$N3" -gt 0 ] && [ "$MISS3" = "无" ] && echo 0 || echo 1)" \
    "EP-3 exclusions.json 里 keep:false 且 note 含「运行态标记」的 pattern（共 $N3 条）都在 .claude/.gitignore 里（排除表有而 git 没忽略）" \
    "匹配条目 >0 且缺失为空" "缺失：$MISS3"

echo ""
echo "==== test-exclusions-parity：PASS=$PASS FAIL=$FAIL ===="
if [ "$FAIL" -gt 0 ]; then
    echo "test-exclusions-parity: failed（.gitignore / exclusions.json / 清单三者对不上）" >&2
    exit 1
fi
echo "test-exclusions-parity: passed"
