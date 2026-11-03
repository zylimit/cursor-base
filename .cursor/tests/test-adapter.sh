#!/usr/bin/env bash
# risk: medium
# test-adapter.sh — Cursor 适配层自测：gen-agents.mjs 的产出形状、模型钉死与回落、setup-cursor.sh 装到临时目录、
#   sync-from-cc-base.sh 的幂等。cc-base 原件自己的测试在 .claude/tests/，不在这里重复。
#
# 纪律：对本仓只读（agents-models.json 的临时写入用完即还原；.cursor/agents/ 是生成物，重生成不算改动）；
#   安装一律装到 mktemp 目录，用完删。每条断言打印 EXPECT / GOT，判定不依赖措辞。
#   sync 幂等要有 cc-base 仓才能跑（$CC_BASE_DIR，缺省 ../cc-base）；没有就 SKIP——未执行 != 通过。
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1

echo "===== test-adapter ====="

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node——gen-agents 与 hook-form 都跑不了，未执行 != 通过。" >&2
    exit 1
fi

PASS=0
FAIL=0
SKIP=0
TMPS=""
MODELS="$ROOT/.cursor/agents-models.json"
MODELS_BAK=""

cleanup() {
    # 还原 agents-models.json：原来有就放回去，原来没有就删掉；再按还原后的状态重生成，别把测试的钉死值留在生成物里
    if [ -n "$MODELS_BAK" ]; then
        if [ "$MODELS_BAK" = "none" ]; then rm -f "$MODELS"; else cp "$MODELS_BAK" "$MODELS"; fi
        node "$ROOT/.cursor/scripts/gen-agents.mjs" >/dev/null 2>&1
    fi
    # shellcheck disable=SC2086  # TMPS 是空格分隔的 mktemp 路径，故意拆词
    [ -n "$TMPS" ] && rm -rf $TMPS
}
trap cleanup EXIT

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

# has <文件> <固定串> —— 退出码 0 表示含
has() { grep -qF -- "$2" "$1"; }
# fmline <文件> <键> —— 只在 frontmatter（第一对 --- 之间）里取该键的值，没有就空
fmline() {
    awk -v k="$2" '
        /^---$/ { n++; next }
        n == 1 && index($0, k ": ") == 1 { print substr($0, length(k) + 3); exit }
        n >= 2 { exit }
    ' "$1"
}

AG="$ROOT/.cursor/agents"

echo "--- gen-agents：产出形状"
node .cursor/scripts/gen-agents.mjs >/dev/null 2>&1
rc=$?
chk "$rc" "gen-agents 退 0" "rc=0" "rc=$rc"
n=$(find "$AG" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
chk "$([ "$n" = "8" ] && echo 0 || echo 1)" "产出 8 个文件" "8" "$n"

bad_model=""; bad_key=""
for f in "$AG"/*.md; do
    [ "$(fmline "$f" model)" = "inherit" ] || bad_model="$bad_model $(basename "$f")"
    for k in skills color memory disallowedTools maxTurns tools; do
        [ -n "$(fmline "$f" "$k")" ] && bad_key="$bad_key $(basename "$f"):$k"
    done
done
chk "$([ -z "$bad_model" ] && echo 0 || echo 1)" "每个文件 frontmatter 含 model: inherit（未钉死时）" "无例外" "例外：${bad_model:-无}"
chk "$([ -z "$bad_key" ] && echo 0 || echo 1)" "frontmatter 不含 skills / color / memory 等 Cursor 不认的键" "无" "${bad_key:-无}"

bad_head=""
for f in "$AG"/*.md; do
    [ "$(head -n 1 "$f")" = "---" ] || bad_head="$bad_head $(basename "$f")"
done
chk "$([ -z "$bad_head" ] && echo 0 || echo 1)" "每个生成文件第 1 行恰好是 ---" "无例外" "例外：${bad_head:-无}"
bad_cmt=""
for f in "$AG"/*.md; do
    cl=$(grep -n -m1 -F '<!-- 由 .cursor/scripts/gen-agents.mjs' "$f" | cut -d: -f1)
    fe=$(awk '/^---$/ { n++; if (n == 2) { print NR; exit } }' "$f")
    { [ -n "$cl" ] && [ -n "$fe" ] && [ "$cl" -gt "$fe" ]; } || bad_cmt="$bad_cmt $(basename "$f")"
done
chk "$([ -z "$bad_cmt" ] && echo 0 || echo 1)" "每个生成文件有「由 gen-agents 生成」注释行且在 frontmatter 结束之后" "无例外" "例外：${bad_cmt:-无}"

has "$AG/implementer.md" "先完整读 \`.claude/skills/dev-builder/SKILL.md\`"; r1=$?
chk "$r1" "implementer 正文含「先完整读 .claude/skills/dev-builder/SKILL.md」" "命中" "rc=$r1"
has "$AG/tester.md" "不要再派子代理"; r2=$?
has "$AG/tester.md" "agent-memory/tester"; r3=$?
chk "$((r2 + r3))" "tester 正文含「不要再派子代理」与「agent-memory/tester」" "两句都命中" "不要再派子代理 rc=$r2；agent-memory/tester rc=$r3"

echo "--- gen-agents：agents-models.json 钉死与回落"
if [ -f "$MODELS" ]; then
    MODELS_BAK=$(mktemp); cp "$MODELS" "$MODELS_BAK"; TMPS="$TMPS $MODELS_BAK"
else
    MODELS_BAK=none
fi
printf '{"code-reviewer":"auto"}\n' >"$MODELS"
node .cursor/scripts/gen-agents.mjs >/dev/null 2>&1
got=$(fmline "$AG/code-reviewer.md" model)
other=$(fmline "$AG/tester.md" model)
chk "$([ "$got" = "auto" ] && [ "$other" = "inherit" ] && echo 0 || echo 1)" "钉了 code-reviewer: auto 后它变 auto、别的角色仍 inherit" "code-reviewer=auto tester=inherit" "code-reviewer=$got tester=$other"
rm -f "$MODELS"
node .cursor/scripts/gen-agents.mjs >/dev/null 2>&1
got=$(fmline "$AG/code-reviewer.md" model)
chk "$([ "$got" = "inherit" ] && echo 0 || echo 1)" "删掉 agents-models.json 再生成，变回 inherit" "inherit" "$got"
printf '{坏的' >"$MODELS"
node .cursor/scripts/gen-agents.mjs >/dev/null 2>&1; rc=$?
chk "$([ "$rc" -eq 1 ] && echo 0 || echo 1)" "agents-models.json 不是合法 JSON 时 gen-agents 退 1（不静默回落）" "rc=1" "rc=$rc"
# 还原交给 cleanup（含重生成）；这里先还原好后面的 setup 才装得到正确的 .cursor/agents
if [ "$MODELS_BAK" = "none" ]; then rm -f "$MODELS"; else cp "$MODELS_BAK" "$MODELS"; fi
node .cursor/scripts/gen-agents.mjs >/dev/null 2>&1

echo "--- setup-cursor：装到临时目录"
if [ ! -x "$ROOT/setup.sh" ]; then
    SKIP=$((SKIP + 1)); echo "  [SKIP] setup-cursor：本仓还没有 setup.sh（先 sync-from-cc-base.sh），未执行 != 通过"
else
    T=$(mktemp -d); TMPS="$TMPS $T"
    ./setup-cursor.sh "$T" >"$T.out1" 2>&1; rc=$?; TMPS="$TMPS $T.out1"
    chk "$rc" "setup-cursor 退 0" "rc=0" "rc=$rc（输出尾：$(tail -2 "$T.out1" | tr '\n' ' ')）"
    form=$(node "$T/.claude/scripts/hook-form.mjs" --check --file "$T/.claude/settings.json" 2>&1)
    chk "$([ "$form" = "string" ] && echo 0 || echo 1)" "目标 settings.json 形态是 string" "string" "$form"
    n=$(find "$T/.cursor/agents" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
    chk "$([ "$n" = "8" ] && echo 0 || echo 1)" "目标 .cursor/agents/ 有 8 个" "8" "$n"
    chk "$([ -f "$T/AGENTS.md" ] && echo 0 || echo 1)" "目标 AGENTS.md 存在" "存在" "$([ -f "$T/AGENTS.md" ] && echo 存在 || echo 缺失)"
    chk "$([ -f "$T/.cursor/cli.json" ] && [ -f "$T/.cursor/scripts/gen-agents.mjs" ] && echo 0 || echo 1)" "目标有 .cursor/cli.json 与 gen-agents.mjs" "都在" "cli.json=$([ -f "$T/.cursor/cli.json" ] && echo 有 || echo 无) gen-agents=$([ -f "$T/.cursor/scripts/gen-agents.mjs" ] && echo 有 || echo 无)"

    # 第二次装：先动 AGENTS.md 一个字节，不许被覆盖，新版本落 .framework-new
    printf 'x' >>"$T/AGENTS.md"
    before=$(cksum <"$T/AGENTS.md")
    ./setup-cursor.sh "$T" >"$T.out2" 2>&1; rc=$?; TMPS="$TMPS $T.out2"
    after=$(cksum <"$T/AGENTS.md")
    chk "$rc" "第二次装退 0" "rc=0" "rc=$rc（输出尾：$(tail -2 "$T.out2" | tr '\n' ' ')）"
    chk "$([ "$before" = "$after" ] && echo 0 || echo 1)" "改过的 AGENTS.md 装完内容不变" "cksum 不变" "前 $before 后 $after"
    chk "$([ -f "$T/AGENTS.md.framework-new" ] && cmp -s "$T/AGENTS.md.framework-new" "$ROOT/AGENTS.md" && echo 0 || echo 1)" "出现 AGENTS.md.framework-new 且等于本仓 AGENTS.md" "存在且相同" "$([ -f "$T/AGENTS.md.framework-new" ] && echo 存在 || echo 缺失)"

    # dry-run 不写文件
    D=$(mktemp -d); TMPS="$TMPS $D"
    ./setup-cursor.sh "$D/proj" --dry-run >"$D.out" 2>&1; rc=$?; TMPS="$TMPS $D.out"
    chk "$([ "$rc" -eq 0 ] && [ ! -e "$D/proj" ] && echo 0 || echo 1)" "--dry-run 退 0 且目标目录没被建出来" "rc=0 且无 proj/" "rc=$rc proj=$([ -e "$D/proj" ] && echo 有 || echo 无)"
fi

echo "--- sync-from-cc-base：幂等"
CC=${CC_BASE_DIR:-$ROOT/../cc-base}
if [ ! -f "$CC/.claude/CLAUDE.md" ] || [ ! -e "$CC/.git" ]; then
    SKIP=$((SKIP + 1)); echo "  [SKIP] sync 幂等：没有 cc-base 仓（$CC）。未执行 != 通过"
else
    # cc-base 工作树不干净时加 --allow-dirty：同步取的是 HEAD，脏改动不影响幂等判定
    OPT=""
    [ -n "$(git -C "$CC" status --porcelain)" ] && OPT="--allow-dirty" && echo "  (cc-base 工作树不干净，用 --allow-dirty)"
    # shellcheck disable=SC2086  # OPT 空时不能留下空参数
    ./sync-from-cc-base.sh $OPT "$CC" >/dev/null 2>&1; rc1=$?
    s1=$(git status --short | LC_ALL=C sort | cksum)
    # shellcheck disable=SC2086
    ./sync-from-cc-base.sh $OPT "$CC" >/dev/null 2>&1; rc2=$?
    s2=$(git status --short | LC_ALL=C sort | cksum)
    chk "$((rc1 + rc2))" "两次 sync 都退 0" "rc=0 / rc=0" "rc=$rc1 / rc=$rc2"
    chk "$([ "$s1" = "$s2" ] && echo 0 || echo 1)" "第二次 sync 后 git status --short 与第一次后相同" "两次 cksum 相同" "$s1 / $s2"
fi

echo "===== test-adapter：PASS=$PASS FAIL=$FAIL SKIP=$SKIP ====="
[ "$SKIP" -gt 0 ] && echo "注意：有 $SKIP 项 SKIP，未执行 != 通过。" >&2
[ "$FAIL" -eq 0 ]
