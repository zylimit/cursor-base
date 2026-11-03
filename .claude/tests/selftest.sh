#!/usr/bin/env bash
# selftest.sh — 脚手架自测：不依赖 claude CLI / 真 LLM，用手造 fixture 验断言库本身对不对。
# 验三件事：
#   ① good-run.jsonl   → assert_skill_invoked + assert_no_premature_action 均应 PASS；
#   ② premature-run.jsonl → assert_no_premature_action 应判 FAIL（这是「预期失败」，
#      断言函数正确识别出偷跑才算 selftest 通过——反过来如果它误判 PASS，说明断言库坏了）；
#   ③ assert_order / assert_contains 在 good-run 上行为正确。
# 退出码：脚手架自测全对 → 0；断言库行为不符预期 → 1。
set -eu

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/test-helpers.sh
. "$DIR/test-helpers.sh"

GOOD="$DIR/fixtures/good-run.jsonl"
PREM="$DIR/fixtures/premature-run.jsonl"
XLINE="$DIR/fixtures/cross-line-decoupled.jsonl"

# selftest 自身的预期判定计数（与断言库的 TESTS_PASS/FAIL 区分开）
ST_OK=0
ST_BAD=0
# 注意：断言函数失败时 return 1，在 set -e 下会触发 errexit；
# 这里用「先 if 包住断言取返回码再判」的写法——被 if 条件测试的命令不触发 errexit，
# 从而能把「预期失败」也当作正常流程走到 expect_fail。
expect_pass() { # <说明> <断言返回码>
    if [ "$2" -eq 0 ]; then ST_OK=$((ST_OK+1)); echo "  ✓ 预期 PASS：$1";
    else ST_BAD=$((ST_BAD+1)); echo "  ✗ 预期 PASS 但断言判 FAIL：$1"; fi
}
expect_fail() { # <说明> <断言返回码>
    if [ "$2" -ne 0 ]; then ST_OK=$((ST_OK+1)); echo "  ✓ 预期 FAIL 且断言正确判失败：$1";
    else ST_BAD=$((ST_BAD+1)); echo "  ✗ 预期 FAIL 但断言误判 PASS：$1"; fi
}
# run_assert <断言命令...>：跑断言，把真实返回码存进全局 RC，自身永远返回 0。
# 这样 set -e 不会在断言失败（return 1）时退出脚本——「预期失败」才能正常走到 expect_fail。
RC=0
run_assert() { if "$@"; then RC=0; else RC=$?; fi; return 0; }

echo "=== cc-base 框架自测脚手架 · selftest（无需 claude CLI）==="
echo ""
echo "--- ① good-run.jsonl：该绿全绿 ---"
run_assert assert_skill_invoked "$GOOD" product-spec-builder;    expect_pass "good 命中 Skill 调用" "$RC"
run_assert assert_no_premature_action "$GOOD";                   expect_pass "good 无偷跑" "$RC"
run_assert assert_contains "$GOOD" '"name":"Skill"';             expect_pass "good 含 Skill 事件" "$RC"
run_assert assert_order "$GOOD" '"name":"Skill"' '"name":"Edit"'; expect_pass "good 中 Skill 早于 Edit" "$RC"

echo ""
echo "--- ② premature-run.jsonl：偷跑须被正确判失败 ---"
run_assert assert_skill_invoked "$PREM" product-spec-builder;    expect_pass "premature 仍命中 Skill 调用" "$RC"
run_assert assert_no_premature_action "$PREM";                   expect_fail "premature 偷跑被识别（Edit/Bash 早于 Skill）" "$RC"
run_assert assert_order "$PREM" '"name":"Edit"' '"name":"Skill"'; expect_pass "premature 中 Edit 确在 Skill 之前" "$RC"

echo ""
echo "--- ③ cross-line-decoupled.jsonl：跨行解耦不许假绿 ---"
# 第1行真调的是 OTHER-skill，product-spec-builder 只在别的事件里被提到。
# 两次独立全文件 grep 会误判 PASS；锁同一 tool_use 后应正确判 FAIL。
run_assert assert_skill_invoked "$XLINE" product-spec-builder;   expect_fail "cross-line 目标只在文本里被提，不算真调" "$RC"
run_assert assert_skill_invoked "$XLINE" OTHER-skill;            expect_pass "cross-line 真调的 OTHER-skill 应命中" "$RC"

echo ""
echo "=== selftest 判定：符合预期=$ST_OK  不符预期=$ST_BAD ==="
echo "    （断言库内部计数 PASS=$TESTS_PASS FAIL=${TESTS_FAIL}，其中 premature 的 1 个 FAIL 是预期失败）"

if [ "$ST_BAD" -eq 0 ]; then
    echo "SELFTEST: PASS — 断言库行为符合预期。"
    exit 0
else
    echo "SELFTEST: FAIL — 断言库行为与预期不符，需修断言逻辑。"
    exit 1
fi
