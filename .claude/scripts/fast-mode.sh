#!/usr/bin/env bash
# fast-mode.sh — 档位开关的旧入口，现在是薄壳：on/off/status 一律转发给引擎的 tier 子命令，
# 自己不再解析也不再落盘（判定与写入各只有一处：读在 .claude/hooks/lib/tier.mjs，
# 写在 harness.mjs tier set，写的文件是 .claude/.runtime/tier.json，旧的 .claude/.fast-mode 不再有人碰）。
# 两个开关文件并存过一次就够了——#38 就是一边判开一边判关。
# 用法： bash .claude/scripts/fast-mode.sh on [hours|--sticky]|off|status   （不带参数 = status；hours 默认 24）
# 注：hours 上限 8 小时由引擎截断并说明；这里仍收 24 是保住老肌肉记忆，不是两套上限。
# on --sticky 原样转发 tier set fast --sticky：到撤销为止的 fast（TODO #91），off 即撤销；与 hours 互斥由引擎判。
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HARNESS="$ROOT/.claude/harness/harness.mjs"
DEFAULT_HOURS=24

# run_tier <argv…> —— 跑引擎：stdout 的 JSON 是给机器的，这里只把 stderr 那行人读结论转出来。
# 引擎跑不成时说清是引擎的问题，并给出不依赖引擎的退路——档位关不掉会让所有闸一直是提醒态，
# 而普通 fast 最多 8 小时自动过期（sticky 不过期），所以这里给的是「等它过期或删掉那个文件」，不是自己动手写状态。
run_tier() {
  local err rc=0
  if [ ! -f "$HARNESS" ]; then
    echo "引擎不在（${HARNESS}）：档位改不了。要强制回默认档就删掉 .claude/.runtime/tier.json；普通 fast 最多 8 小时自动失效，sticky 只能删文件。" >&2
    return 3
  fi
  err=$(cd "$ROOT" && CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$ROOT}" node "$HARNESS" "$@" 2>&1 >/dev/null) || rc=$?
  [ -n "$err" ] && echo "$err"
  return "$rc"
}

case "${1:-status}" in
  on)
    if [ "${2:-}" = "--sticky" ]; then
      run_tier tier set fast --sticky --reason "fast-mode.sh"
      exit $?
    fi
    HOURS="${2:-$DEFAULT_HOURS}"
    case "$HOURS" in
      ''|*[!0-9]*|0) echo "hours 必须是正整数（如 fast-mode.sh on 3）" >&2; exit 2 ;;
    esac
    run_tier tier set fast --hours "$HOURS" --reason "fast-mode.sh"
    ;;
  off)
    run_tier tier set standard --reason "fast-mode.sh off"
    ;;
  status)
    run_tier tier status
    ;;
  *)
    echo "用法: bash .claude/scripts/fast-mode.sh on [hours|--sticky]|off|status" >&2
    exit 2
    ;;
esac
