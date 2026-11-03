#!/usr/bin/env bash
# risk: low
# test-supervisor.sh — 开发态韧性 supervisor 回归（SKIP-非假绿）。
# 契约：无 node → 打印 SKIPPED 并 exit 0（未执行 != 通过，对齐 run-all.sh SKIPPED 语义）；
#   有 node → 验一条主链：start 长驻 -> status running -> stop 收敛 stopped、进程全清。
# 2026-09-10 预算表：自动拉起 / 熔断 / win32 stop 分支与负向对照 / 孤儿检查 / state.json 坏掉那批
#   退休——supervisor 是开发态便利件，判错的代价是自己重启一下，不在高风险五种之列。
set -eu

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
SUP="${1:-$ROOT/.claude/scripts/supervisor.mjs}"

echo "===== test-supervisor ====="
if ! command -v node >/dev/null 2>&1; then
  echo "SKIPPED: 无 node（command -v node 未找到）——supervisor 回归跳过，未执行 != 通过。"
  exit 0
fi
[ -f "$SUP" ] || { echo "  [FAIL] 缺 supervisor.mjs：$SUP" >&2; exit 1; }

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
TMP="$(mktemp -d)"
cleanup() {
  ( cd "$TMP" && CLAUDE_PROJECT_DIR="$TMP" node "$SUP" stop --id svc ) >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

json_field() { python3 -c "import sys,json;d=json.load(sys.stdin);print($2)" <<<"$1"; }

# ① start 长驻 -> rc 0，稍后 status 报 running + 子进程活着
# start 立刻返回（那一刻子进程还没落地，状态是 backoff），所以「起来了没有」要问 status，
# 不看 start 自己的回显——看回显会把「拉起中」读成「已就绪」。
RC=0
OUT=$( cd "$TMP" && CLAUDE_PROJECT_DIR="$TMP" node "$SUP" start --id svc -- sleep 300 ) || RC=$?
sleep 2
ST=$( cd "$TMP" && CLAUDE_PROJECT_DIR="$TMP" node "$SUP" status --id svc )
STATUS=$(json_field "$ST" 'd["services"][0]["status"]')
CHILD_ALIVE=$(json_field "$ST" 'd["services"][0]["childAlive"]')
if [ "$RC" -eq 0 ] && [ "$STATUS" = "running" ] && [ "$CHILD_ALIVE" = "True" ]; then
  pass "start 长驻 -> rc 0，status running + 子进程活着"
else
  fail "start 未长驻（rc=${RC}，status=${STATUS}，childAlive=${CHILD_ALIVE}，start 回显：${OUT}）"
fi

# ② stop -> 收敛 stopped，supervisor 与 child 全清
RC=0
OUT=$( cd "$TMP" && CLAUDE_PROJECT_DIR="$TMP" node "$SUP" stop --id svc ) || RC=$?
ST=$( cd "$TMP" && CLAUDE_PROJECT_DIR="$TMP" node "$SUP" status --id svc )
STATUS=$(json_field "$ST" 'd["services"][0]["status"]')
CHILD_ALIVE=$(json_field "$ST" 'd["services"][0]["childAlive"]')
if [ "$RC" -eq 0 ] && [ "$STATUS" = "stopped" ] && [ "$CHILD_ALIVE" = "False" ]; then
  pass "stop -> 收敛 stopped + 进程全清"
else
  fail "stop 未收敛（rc=${RC}，status=${STATUS}，childAlive=${CHILD_ALIVE}）"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
