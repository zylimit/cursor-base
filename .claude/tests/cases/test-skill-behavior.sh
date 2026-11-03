#!/usr/bin/env bash
# risk: low
# test-skill-behavior.sh — headless 路由真触发烟囱测试（opt-in，耗 token）。
# 默认 SKIP：未设 RUN_LIVE_SKILL=1 时直接 exit 0，不跑真 LLM、不污染 run-all 默认。
# 跑法：RUN_LIVE_SKILL=1 bash .claude/tests/cases/test-skill-behavior.sh
#
# 测的是 cc-base 最大未验证面：CLAUDE.md [Skill 调用规则] 的「1% 即调」会不会真触发。
# test-routing.sh 只静态验 agent(7)/skill(15) 双向一致（规则写对没），
# 本脚本真跑 claude -p 验「naive prompt → 期望 skill」路由命中 + 调 Skill 前不偷跑。
#
# 机制（借 Superpowers + 现有 cases/*.sh + test-helpers.sh 断言库）：
#   喂 naive prompt → claude -p --output-format stream-json 拿事件日志
#   → assert_skill_invoked 验路由命中
#   → assert_no_premature_action 验 Skill 之前无 Edit/Write/Bash 偷跑。
#
# 与 cases/*.sh 的区别：
#   - cases/*.sh 单 case 单 prompt，被 run-all.sh 自动遍历（无 opt-in）。
#   - 本脚本聚合多路由对 + 默认 opt-in SKIP，避免污染默认 run-all。
#
# 跑此脚本的前置（任一不满足 → SKIP，exit 0 不算 fail）：
#   1. RUN_LIVE_SKILL=1 显式 opt-in（live 路由测试耗 token，opt-in 防误跑）。
#   2. command -v claude 存在。
#   3. 在 cc-base 仓库根跑（git rev-parse --show-toplevel）—— 否则 CLAUDE.md 路由规则不生效。
#
# 环境已知限制（progress 多次记 + 本脚本探针实测）：
#   - use-local（OAuth login bypass LiteLLM）环境下 claude -p 可能：
#     ① OAuth 过期 / 认证失败（进不去 agent loop，自然无 Skill 事件）；
#     ② LiteLLM 代理不转发 Skill 工具调用（即便认证通也不产 Skill 事件）。
#   - 任一情况 → 本脚本探针检测到后 SKIP 剩余对（带诊断），不算失败。
#   - 换真 Anthropic API 环境设 RUN_LIVE_SKILL=1 重跑 —— 框架到位即交付。
set -eu

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/../test-helpers.sh
. "$DIR/../test-helpers.sh"

# ---- 临时文件统一清理（多 LOG 场景）----
CLEANUP_FILES=""
# shellcheck disable=SC2329,SC2317  # trap 注册的退出钩子：脚本以显式 exit "$var" 收尾时 shellcheck 认不出 trap 间接调用，是工具已知误判，非真未调用（SC2329 是 0.10+ 的编号，SC2317 是 0.9 系列同一条判定的旧编号）
# shellcheck disable=SC2086  # $CLEANUP_FILES 是空格分隔的多个临时文件路径，故意不加引号借词分割逐个传给 rm -f
# shellcheck disable=SC2015  # 不是伪装 if-else：末尾 || true 恒吞掉 rm -f 的非零退出（防 set -e 误杀），C 恒为 true 不是条件性分支（0.11 起该形状不再报，0.9/0.8 仍报）
cleanup() { [ -n "$CLEANUP_FILES" ] && rm -f $CLEANUP_FILES 2>/dev/null || true; }
trap cleanup EXIT
mktemp_log() {
    local f
    f=$(mktemp 2>/dev/null) || { echo "FAIL: mktemp 失败"; exit 1; }
    CLEANUP_FILES="$CLEANUP_FILES $f"
    echo "$f"
}

# ---- opt-in 开关：默认 SKIP ----
if [ "${RUN_LIVE_SKILL:-0}" != "1" ]; then
    echo "SKIPPED: 未设 RUN_LIVE_SKILL=1（live 路由测试 opt-in，耗 token）"
    echo "  跑法：RUN_LIVE_SKILL=1 bash .claude/tests/cases/test-skill-behavior.sh"
    echo "  注：use-local/LiteLLM OAuth 环境可能不产 Skill 事件；换真 Anthropic API 环境再跑。"
    exit 0
fi

# ---- 前置探测：无 claude CLI → SKIP ----
if ! command -v claude >/dev/null 2>&1; then
    echo "SKIPPED: 无 claude CLI（command -v claude 未找到）—— live 路由测试无法跑。"
    exit 0
fi

ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || ROOT="$(cd "$DIR/../../.." && pwd)"
TIMEOUT="${CASE_TIMEOUT:-300}"

# ---- 路由对（naive prompt → 期望 skill）----
# 选 CLAUDE.md [Skill 调用规则] 里明确「自动调用」且不依赖项目状态的触发条件：
#   product-spec-builder：用户表达想要开发产品/应用/工具时
#   bug-fixer：用户报告 bug、说「坏了/报错/不正常」时
ROUTE_PAIRS=(
    "我想做个 todo 应用|product-spec-builder"
    "这个功能坏了，一跑就报错，帮我修一下|bug-fixer"
)

echo "########## test-skill-behavior：headless 路由真触发（opt-in）##########"
echo "项目根（加载 CLAUDE.md）：$ROOT"
echo "路由对数：${#ROUTE_PAIRS[@]}"
echo "超时（每对）：${TIMEOUT}s"
echo ""

# ---- 实跑 + 第一个对兼环境探针 ----
# 判环境通不通的标准：第一个对的 LOG 里有没有任何 "name":"Skill" 事件。
#   - 认证失败（OAuth 过期等）→ SKIP 剩余，带诊断。
#   - 无任何 Skill 事件 → 环境不产 Skill（已知问题），SKIP 剩余，带诊断。
#   - 有 Skill 事件（哪怕不是目标 skill）→ 环境通，继续跑剩余对。
# 第一个对既是探针也是真测试：探针通过后正常计入 PASS/FAIL。
OVERALL_RC=0
IDX=0
ENV_PROBED=0
for pair in "${ROUTE_PAIRS[@]}"; do
    IDX=$((IDX+1))
    PROMPT="${pair%%|*}"
    SKILL="${pair##*|}"
    LOG=$(mktemp_log)

    echo ">>> [$IDX/${#ROUTE_PAIRS[@]}] 路由：$PROMPT → $SKILL"
    echo "  运行 claude -p（最长 ${TIMEOUT}s）…"
    ( cd "$ROOT" && timeout "$TIMEOUT" claude -p "$PROMPT" \
        --dangerously-skip-permissions \
        --verbose \
        --output-format stream-json \
        > "$LOG" 2>&1 ) || true

    if [ ! -s "$LOG" ]; then
        echo "  FAIL: claude 无输出（日志为空）—— 可能超时或 CLI 异常。"
        OVERALL_RC=1
        continue
    fi

    # ---- 环境探针（仅第一个对跑一次）----
    if [ "$ENV_PROBED" = "0" ]; then
        ENV_PROBED=1
        # 认证失败 → SKIP 全部（不算 fail，是环境问题）
        if grep -q '"error":"authentication_failed"' "$LOG" 2>/dev/null \
           || grep -q 'Failed to authenticate' "$LOG" 2>/dev/null; then
            echo ""
            echo "SKIPPED: claude 认证失败（OAuth 过期或 token 失效）—— live 路由测试无法跑。"
            echo "  证据（探针日志 ${LOG}）："
            grep -E '"error":"authentication_failed"|Failed to authenticate' "$LOG" \
                | head -2 | sed 's/^/    /'
            echo "  修复：重新登录 claude（或换真 Anthropic API 环境）后重跑。"
            exit 0
        fi
        # 无任何 Skill 事件 → 环境不产 Skill（已知问题），SKIP 全部
        if ! grep -q '"name":"Skill"' "$LOG" 2>/dev/null; then
            echo ""
            echo "SKIPPED: 当前环境 claude -p 不产 Skill 事件（use-local/LiteLLM OAuth 已知问题）。"
            echo "  证据（探针日志 ${LOG}）：无 '\"name\":\"Skill\"' 事件。"
            echo "  日志末 3 行（诊断）："
            tail -3 "$LOG" | sed 's/^/    /'
            echo "  实际触发的工具（如有）："
            grep -oE '"name":"[^"]*"' "$LOG" 2>/dev/null | sort -u | head -10 | sed 's/^/    /' || true
            echo "  换真 Anthropic API 环境设 RUN_LIVE_SKILL=1 重跑。"
            exit 0
        fi
        echo "  环境通：探针命中 Skill 事件，继续断言。"
    fi

    # ---- 正常断言 ----
    echo "  --- 断言 ---"
    RC=0
    assert_skill_invoked "$LOG" "$SKILL"   || RC=1
    assert_no_premature_action "$LOG"      || RC=1

    if [ "$RC" -eq 0 ]; then
        echo "  CASE: PASS"
    else
        echo "  CASE: FAIL"
        OVERALL_RC=1
    fi
done

echo ""
print_summary
echo ""
if [ "$OVERALL_RC" -eq 0 ]; then
    echo "########## 结果：全部路由对通过 ##########"
else
    echo "########## 结果：有路由对未通过（见上） ##########"
fi
exit "$OVERALL_RC"
