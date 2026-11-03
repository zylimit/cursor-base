#!/usr/bin/env bash
# risk: low
# bug-report-triggers-bug-fixer.sh — 真触发测试（需真 claude CLI）。
# naive prompt「这个功能坏了，跑起来报错」应触发 bug-fixer，且调 Skill 前不偷跑改文件。
# 结构同 todo-app 用例；由 run-all.sh 在确认有 claude CLI 后单独执行。
set -eu

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/../test-helpers.sh
. "$DIR/../test-helpers.sh"

PROMPT="这个功能坏了，一跑就报错，帮我修一下"
SKILL="bug-fixer"
TIMEOUT="${CASE_TIMEOUT:-300}"

# 同 todo-app 用例：须在能加载 cc-base CLAUDE.md 的仓库根跑，--verbose 是 CLI 硬要求。
ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || ROOT="$(cd "$DIR/../../.." && pwd)"
LOG=$(mktemp 2>/dev/null) || { echo "FAIL: mktemp 失败"; exit 1; }
trap 'rm -f "$LOG"' EXIT

echo "=== 真触发测试：$PROMPT → $SKILL ==="
echo "项目根（加载 CLAUDE.md）：$ROOT"
echo "运行 claude -p（静默，最长 ${TIMEOUT}s）…"

( cd "$ROOT" && timeout "$TIMEOUT" claude -p "$PROMPT" \
    --dangerously-skip-permissions \
    --verbose \
    --output-format stream-json \
    > "$LOG" 2>&1 ) || true

if [ ! -s "$LOG" ]; then
    echo "FAIL: claude 无输出（日志为空）——可能超时或 CLI 异常。"
    exit 1
fi

echo ""
echo "--- 断言 ---"
RC=0
assert_skill_invoked "$LOG" "$SKILL"   || RC=1
assert_no_premature_action "$LOG"      || RC=1
print_summary

echo "日志：$LOG"
if [ "$RC" -eq 0 ]; then echo "CASE: PASS"; else echo "CASE: FAIL"; fi
exit "$RC"
