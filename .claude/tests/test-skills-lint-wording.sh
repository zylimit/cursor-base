#!/usr/bin/env bash
# risk: low
# test-skills-lint-wording.sh — skill description 的措辞规则由引擎 `harness.mjs skills-lint` 执法。
# 规则（来自退役前那个 bash 措辞门的原文）：description 要触发式开头（含「当…时」或「由…调用」）；
#   通篇流程总结词（生成/通过/分阶段/输出/支持…）而无触发条件才追究。退出码沿用 skills-lint
#   契约：findings>0 → 1；仅 degraded → 3；干净 → 0。
# 留一正一反（2026-09-10 预算表）：合规写法不许误伤、无触发条件的流程总结必须判
#   DESCRIPTION_NOT_TRIGGER_SHAPED；finding 指向哪个目录、两半同出、本仓不误伤那批退休。
# 纪律：写操作只落 mktemp 沙箱，对本仓只读；判定只看 rc 与 findings 的 code，不看措辞。
set -eu

ROOT=${CC_BASE_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}

echo "===== test-skills-lint-wording ====="

command -v node >/dev/null 2>&1 || { echo "SKIPPED: 无 node——引擎是 .mjs，跑不起来；未执行 != 通过。" >&2; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "SKIPPED: 无 git——沙箱仓造不出来；未执行 != 通过。" >&2; exit 1; }
[ -f "$ROOT/.claude/harness/harness.mjs" ] || { echo "  [FAIL] 缺 harness.mjs" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0
chk() {
    if [ "$1" -eq 0 ]; then PASS=$((PASS + 1)); echo "  [PASS] $2"; else FAIL=$((FAIL + 1)); echo "  [FAIL] $2"; fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}
# 沙箱骨架：拷引擎 + hooks/lib，去掉 state（运行态，沙箱要干净），git init
SKEL="$TMP/skel"
mkdir -p "$SKEL/.claude/hooks" "$SKEL/.claude/skills"
cp -R "$ROOT/.claude/harness" "$SKEL/.claude/harness"; rm -rf "$SKEL/.claude/harness/state"
[ -d "$ROOT/.claude/hooks/lib" ] && cp -R "$ROOT/.claude/hooks/lib" "$SKEL/.claude/hooks/lib"
printf 'sandbox\n' > "$SKEL/README.md"
git -C "$SKEL" init -q; git -C "$SKEL" add -A >/dev/null 2>&1 || true
git -C "$SKEL" -c user.email=t@t -c user.name=t commit -qm init >/dev/null 2>&1 || true
# codes_of <stdout 文件> —— 取最后一行可解析 JSON 的 findings[].code，空格分隔
codes_of() {
    node -e '
        const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
        let j = null;
        for (let i = lines.length - 1; i >= 0; i--) { try { j = JSON.parse(lines[i]); break; } catch (e) {} }
        if (!j) { console.log("PARSE_ERROR"); process.exit(0); }
        const codes = (j.findings || []).map((f) => String(f.code));
        console.log(codes.length ? codes.join(" ") : "(none)");
    ' "$1"
}

# run_case <用例号> <skill 目录名> <description> —— 造沙箱 + 跑 skills-lint，
# 结果写 $CASE_RC / ${CASE_OUT}（stdout 文件）/ ${CASE_ERR}（stderr 文件）
run_case() {
    local id="$1" dir="$2" desc="$3" box
    box="$TMP/$id"
    rm -rf "$box"
    cp -R "$SKEL" "$box"
    mkdir -p "$box/.claude/skills/$dir"
    printf -- '---\nname: %s\ndescription: %s\n---\n\n# %s\n\n沙箱样本正文。\n' \
        "$dir" "$desc" "$dir" > "$box/.claude/skills/$dir/SKILL.md"
    CASE_OUT="$TMP/$id.out"; CASE_ERR="$TMP/$id.err"
    set +e
    ( cd "$box" && CLAUDE_PROJECT_DIR="$box" node "$box/.claude/harness/harness.mjs" skills-lint ) \
        > "$CASE_OUT" 2> "$CASE_ERR"
    CASE_RC=$?
    set -e
}

run_case W1 wording-trigger-ok "当用户说要审查代码时使用。"
codes=$(codes_of "$CASE_OUT")
[ "$CASE_RC" -eq 0 ] && [ "$codes" = "(none)" ] && r=0 || r=1
chk "$r" "W-1 「当…时使用」是触发式：rc 0 且无措辞类 finding（合规写法不许误伤）" \
    "rc=0 findings=(none)" \
    "rc=$CASE_RC findings=$codes ; stderr尾: $(tail -n 1 "$CASE_ERR" 2>/dev/null || true)"

run_case W2 wording-summary-bad "生成完整项目架构文档，分阶段输出并支持多种格式。"
codes=$(codes_of "$CASE_OUT")
case " $codes " in *" DESCRIPTION_NOT_TRIGGER_SHAPED "*) hasCode=0 ;; *) hasCode=1 ;; esac
[ "$CASE_RC" -eq 1 ] && [ $hasCode -eq 0 ] && r=0 || r=1
chk "$r" "W-2 无触发条件的流程总结 description：rc 1 且有 DESCRIPTION_NOT_TRIGGER_SHAPED" \
    "rc=1 findings 含 DESCRIPTION_NOT_TRIGGER_SHAPED" \
    "rc=$CASE_RC findings=$codes"

echo "==== test-skills-lint-wording：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ] || exit 1
