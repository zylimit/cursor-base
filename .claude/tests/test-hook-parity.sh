#!/usr/bin/env bash
# risk: low
# test-hook-parity.sh — settings.json 与 hooks/ 目录的一一对应对拍（无依赖 claude CLI）。
#
# 分工：形态那一面归 test-hooks-settings.sh（exec form、args[0] 落地）。本文件只做两个方向的
#   集合对拍——目录里的 .mjs 有没有全被注册，注册表里的名字有没有全在目录里。反向漏一个
#   （写了 hook 却忘了注册）的后果是「闸装了却从来不触发」，最难发现的那种失效。
#
# 依赖：node（解析 JSON，故意不用 jq——目标机器只保证 node + git + coreutils）。
# 纪律：对本仓只读；每条断言打印 EXPECT / GOT，判定不依赖措辞。
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SETTINGS="$ROOT/.claude/settings.json"
HOOKDIR="$ROOT/.claude/hooks"

echo "===== test-hook-parity ====="

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node——settings.json 解析不了，未执行 != 通过。" >&2
    exit 1
fi

PASS=0
FAIL=0

chk() {
    if [ "$1" -eq 0 ]; then
        PASS=$((PASS + 1)); echo "  [PASS] $2"
    else
        FAIL=$((FAIL + 1)); echo "  [FAIL] $2"
    fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}

# 注册名清单：展平所有事件下的 hook，从 args[0]（exec form）或 command 里抠出 hooks/<name> 的
# name，每行一个。抠不出名字的记成 ?<原文>——那种条目会在下面两个方向里各红一次，比静默丢掉强。
REG=$(node -e '
const fs = require("node:fs");
const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const out = [];
for (const ev of Object.keys(s.hooks || {})) {
  for (const g of (s.hooks[ev] || [])) {
    for (const h of (g.hooks || [])) {
      const a = Array.isArray(h.args) && h.args.length ? String(h.args[0]) : String(h.command || "");
      const m = a.match(/hooks[\/\\]([A-Za-z0-9_-]+)\.[A-Za-z0-9]+$/);
      out.push(m ? m[1] : "?" + a);
    }
  }
}
process.stdout.write(out.sort().join("\n"));
' "$SETTINGS" 2>&1) || REG="<解析失败>"

# 目录侧：hooks/ 顶层的 .mjs（lib/ 是子目录，-maxdepth 1 天然排除）。
DIR_ALL=$(find "$HOOKDIR" -maxdepth 1 -type f -name '*.mjs' 2>/dev/null \
    | sed 's#.*/##; s#\.mjs$##' | sort)

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT
printf '%s\n' "$REG" | grep -v '^$' | sort -u > "$TMPD/reg"
printf '%s\n' "$DIR_ALL" | grep -v '^$' > "$TMPD/dir"

REG_N=$(grep -c . "$TMPD/reg" || true)
DIR_N=$(grep -c . "$TMPD/dir" || true)

echo ""
chk "$([ "${REG_N:-0}" -gt 0 ] && [ "${DIR_N:-0}" -gt 0 ] && echo 0 || echo 1)" \
    "PT-0 两侧清单都非空（任一为空，下面的对拍就是空转全绿）" \
    "注册侧与目录侧各至少 1 个" "注册 $REG_N 个 / 目录 $DIR_N 个"

# static-check 按 D.1 明确不注册：它是 code-review Stage 0 手调的工具，注册进去会变成
# 每次事件都跑一遍全仓静态检查。所以它从这一侧的期望里排除。
ORPHAN=$(grep -vxF 'static-check' "$TMPD/dir" | grep -vxF -f "$TMPD/reg" | tr '\n' ' ' || true)
chk "$([ -z "$ORPHAN" ] && echo 0 || echo 1)" \
    "PT-1 除 static-check 外，每个 hooks/*.mjs 都在 settings.json 里注册了（装了个从不触发的闸）" \
    "零个未注册的 .mjs" "未注册：${ORPHAN:-无}"

GHOST=$(grep -vxF -f "$TMPD/dir" "$TMPD/reg" | tr '\n' ' ' || true)
chk "$([ -z "$GHOST" ] && echo 0 || echo 1)" \
    "PT-2 每个注册名在 hooks/ 下都有同名 .mjs（注册了却没文件 = 每次事件都报 hook error）" \
    "零个注册了但没文件的名字" "缺文件：${GHOST:-无}"

echo ""
echo "==== test-hook-parity：PASS=$PASS FAIL=$FAIL ===="
if [ "$FAIL" -gt 0 ]; then
    echo "test-hook-parity: failed（settings.json 与 hooks/ 目录对不上，上面点名了是哪一侧多/少）" >&2
    echo "    注册侧（${REG_N}）：$(tr '\n' ' ' < "$TMPD/reg")" >&2
    echo "    目录侧（${DIR_N}）：$(tr '\n' ' ' < "$TMPD/dir")" >&2
    exit 1
fi
echo "test-hook-parity: passed（$REG_N 个注册 hook 与 $DIR_N 个 hooks/*.mjs 双向对得上）"
