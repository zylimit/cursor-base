#!/usr/bin/env bash
# risk: low
# todo-app-triggers-product-spec.sh — 真触发测试（需真 claude CLI）。
# naive prompt「我想做个 todo 应用」应触发 product-spec-builder，且调 Skill 前不偷跑。
# 跑法：在隔离的临时项目目录里 claude -p --output-format stream-json，拿事件日志后断言。
# 不被 run-all.sh 直接 source；由 run-all.sh 在确认有 claude CLI 后单独执行。
set -eu

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/../test-helpers.sh
. "$DIR/../test-helpers.sh"

PROMPT="我想做个 todo 应用"
SKILL="product-spec-builder"
TIMEOUT="${CASE_TIMEOUT:-300}"

# 必须在能加载到 cc-base .claude/CLAUDE.md 的目录里跑，否则框架路由规则不生效、
# Skill 自然不会触发（测的就是这套规则会不会触发）。所以 cd 到仓库根，而非空临时目录。
# --verbose 是当前 claude CLI 对 -p + stream-json 的硬性要求，少了会直接报错退出。
ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || ROOT="$(cd "$DIR/../../.." && pwd)"
LOG=$(mktemp 2>/dev/null) || { echo "FAIL: mktemp 失败"; exit 1; }
trap 'rm -f "$LOG"' EXIT

echo "=== 真触发测试：$PROMPT → $SKILL ==="
echo "项目根（加载 CLAUDE.md）：$ROOT"
echo "运行 claude -p（静默，最长 ${TIMEOUT}s）…"

# 命令失败不中断脚本（|| true），日志缺失/为空由后续断言兜底
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
