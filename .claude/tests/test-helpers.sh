#!/usr/bin/env bash
# test-helpers.sh — cc-base 框架自测的断言库（可被 source）。
# 核心机制（借 Superpowers）：喂 naive prompt → claude -p --output-format stream-json
#   拿事件日志（每行一个 JSON 事件）→ grep 断言两件事：
#   (1) 该调的 Skill 工具真被调了；
#   (2) 调 Skill 之前没有「偷跑」——在 invoke skill 前就调 Edit/Write/Bash = agent
#       跳过流程自己干了，判 FAIL。允许清单：Skill、TodoWrite、Read。
# 不被直接执行，由 selftest.sh / cases/*.sh source 后调用。
# 计数（PASS/FAIL）维护在 TESTS_PASS / TESTS_FAIL，调用方读取后决定退出码。
set -eu

# 偷跑允许清单：调 Skill 之前可以出现的工具（规划/读取无副作用，不算偷跑）
PREMATURE_ALLOW='Skill|TodoWrite|Read'

# 计数器（首次 source 时初始化，重复 source 不清零）
: "${TESTS_PASS:=0}"
: "${TESTS_FAIL:=0}"

_pass() { TESTS_PASS=$((TESTS_PASS + 1)); echo "  [PASS] $1"; }
_fail() { TESTS_FAIL=$((TESTS_FAIL + 1)); echo "  [FAIL] $1"; }

# assert_skill_invoked <logfile> <skill-name>
# stream-json 里有没有 "name":"Skill" 且 skill 参数匹配（裸名或 namespace:名）。
assert_skill_invoked() {
    local logfile="$1" skill="$2"
    local name="assert_skill_invoked: $skill"
    if [ ! -f "$logfile" ]; then _fail "${name}（日志不存在：${logfile}）"; return 1; fi
    # skill 参数形如 "skill":"foo" 或 "skill":"plugin:foo"
    # 必须锁同一 tool_use 事件——先抽含 "name":"Skill" 的行，再在这些行上匹配 skill 名；
    # 两次独立全文件 grep 会被「调了别的 skill + 文本里提到目标名」假绿。
    local skill_pat='"skill":"([^"]*:)?'"${skill}"'"'
    if grep '"name":"Skill"' "$logfile" | grep -qE "$skill_pat"; then
        _pass "${name}（命中 Skill 调用）"
        return 0
    fi
    _fail "${name}（未找到对 $skill 的 Skill 调用）"
    echo "    实际触发的 skill：$(grep -oE '"skill":"[^"]*"' "$logfile" 2>/dev/null | sort -u | tr '\n' ' ' || true)"
    return 1
}

# assert_no_premature_action <logfile>
# 找第一个 Skill 调用的行号，扫它之前的 tool_use，过滤掉允许清单，
# 剩下的 = 偷跑证据 → FAIL。若整段没有 Skill 调用，也算偷跑可疑 → FAIL。
# 前提：依赖当前 claude CLI 的 stream-json 每事件一行、每行单个 tool_use；
# 若 CLI 改为合并 content 数组进一行，需改逐事件解析。
assert_no_premature_action() {
    local logfile="$1"
    local name="assert_no_premature_action"
    if [ ! -f "$logfile" ]; then _fail "${name}（日志不存在：${logfile}）"; return 1; fi

    local first_skill
    first_skill=$(grep -n '"name":"Skill"' "$logfile" | head -1 | cut -d: -f1 || true)
    if [ -z "$first_skill" ]; then
        _fail "${name}（全程没有 Skill 调用——无法确认未偷跑）"
        return 1
    fi

    # 第一个 Skill 调用之前的所有 tool_use，剔除允许清单后若有残留即偷跑
    local premature
    premature=$(head -n "$first_skill" "$logfile" \
        | grep '"type":"tool_use"' \
        | grep -vE '"name":"('"$PREMATURE_ALLOW"')"' || true)
    if [ -n "$premature" ]; then
        _fail "${name}（Skill 之前出现偷跑工具调用）"
        echo "$premature" | head -5 | sed 's/^/    /'
        return 1
    fi
    _pass "${name}（Skill 之前无越界工具调用）"
    return 0
}

# assert_contains <logfile> <pattern>
assert_contains() {
    local logfile="$1" pattern="$2"
    local name="assert_contains: $pattern"
    if [ ! -f "$logfile" ]; then _fail "${name}（日志不存在：${logfile}）"; return 1; fi
    if grep -qE "$pattern" "$logfile"; then
        _pass "$name"
        return 0
    fi
    _fail "${name}（未匹配到模式）"
    return 1
}

# assert_order <logfile> <p1> <p2>：p1 首次出现须在 p2 首次出现之前。
assert_order() {
    local logfile="$1" p1="$2" p2="$3"
    local name="assert_order: $p1 → $p2"
    if [ ! -f "$logfile" ]; then _fail "${name}（日志不存在：${logfile}）"; return 1; fi
    local l1 l2
    l1=$(grep -nE "$p1" "$logfile" | head -1 | cut -d: -f1 || true)
    l2=$(grep -nE "$p2" "$logfile" | head -1 | cut -d: -f1 || true)
    if [ -z "$l1" ]; then _fail "${name}（前者未出现：${p1}）"; return 1; fi
    if [ -z "$l2" ]; then _fail "${name}（后者未出现：${p2}）"; return 1; fi
    if [ "$l1" -lt "$l2" ]; then
        _pass "${name}（行 $l1 早于行 ${l2}）"
        return 0
    fi
    _fail "${name}（顺序颠倒：$p1 在行 ${l1}，$p2 在行 ${l2}）"
    return 1
}

# 打印计数小结。
print_summary() {
    echo ""
    echo "==== 断言小结：PASS=$TESTS_PASS  FAIL=$TESTS_FAIL ===="
}
