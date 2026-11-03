#!/usr/bin/env bash
# run-all.sh — 跑全部框架自测。
# 永远先跑 selftest（无依赖、必跑）；再跑静态自测（test-setup/test-routing，无需 claude CLI）；
#   最后一段真触发 cases（需 claude CLI）默认不跑，CCBASE_RUN_CLAUDE_CASES=1 才跑。
# 检测 command -v claude：不存在就明确打印 SKIPPED 并只跑前两段，绝不静默假绿
#   （呼应框架的反静默失败——缺 CLI 是「跳过」不是「通过」）。
# 用法：run-all.sh [--level high|medium|all]，默认 high——日常只跑高风险那批，CI 跑 all。
#   分级看被测脚本头部那行 `# risk: high|medium|low`；没打级的按 high 跑（过渡期安全默认）。
#   被跳过的按级别计数，汇总行里点名——未执行 != 通过。
# 退出码：selftest 失败 → 非 0；静态自测失败 → 非 0；真触发 cases 全过（或被 SKIP）→ 0；有 case 失败 → 非 0。
set -eu

# 内嵌 python3 的编码：Windows runner 上 python 的 stdout 默认是 cp1252，从 python 里打中文
#   直接 UnicodeEncodeError（CI 抓到的是 test-routing 的全角括号 '（' 崩在 cp1252.py）。本仓 8 个
#   测试脚本内嵌 python3 -c / python3 - <<PY，眼下只有 test-routing 和 cases/test-harness 会从
#   python 里打中文，其余六个离同一个崩只差一句 print——所以设在这里而不是逐个脚本里，散点写法
#   下次加测试必然漏一个。两个变量分工不同，都要设：PYTHONIOENCODING 管 std 流，PYTHONUTF8 管
#   open() 的默认编码（漏写 encoding= 的读文件）；且前者优先级高于后者，只设 PYTHONUTF8 救不了
#   stdout。覆盖的是所有走 run-all 的路径（含它拉起的静态自测与 dod）；CI 单独跑某个脚本的路径
#   由 .github/workflows/gate.yml 的 job 级 env 兜，两处覆盖面不同，不算重复。
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(cd "$DIR/.." && pwd)"
REPO_ROOT="$(cd "$TESTS_DIR/../.." && pwd)"

LEVEL=high
while [ $# -gt 0 ]; do
    case "$1" in
        --level) LEVEL="${2:-}"; shift 2 ;;
        --level=*) LEVEL="${1#--level=}"; shift ;;
        -h|--help) echo "用法：run-all.sh [--level high|medium|all]"; exit 0 ;;
        *) echo "未知参数：$1（用法：run-all.sh [--level high|medium|all]）" >&2; exit 2 ;;
    esac
done
case "$LEVEL" in
    high|medium|all) : ;;
    *) echo "--level 只认 high|medium|all，收到 '$LEVEL'" >&2; exit 2 ;;
esac

# 用例账本：每套测试的逐条 [PASS]/[FAIL]/[SKIPPED] 追加一行 JSON，供 test-age.mjs 算老化。
#   目录进 .gitignore（根 .gitignore 的 /.claude/evidence/），只是本机跑过什么的流水，不入库。
LEDGER="$REPO_ROOT/.claude/evidence/test-ledger.jsonl"
mkdir -p "$(dirname "$LEDGER")"
LEDGER_TMP="$(mktemp)"
trap 'rm -f "$LEDGER_TMP"' EXIT
SKIP_MEDIUM=0
SKIP_LOW=0
MISSING_NOTE=""

# 头部十行内找 `# risk: x`；找不到当 high——没打级的宁可多跑，不许悄悄少跑。
risk_of() {
    case "$(sed -n '1,10p' "$1" 2>/dev/null | grep -m1 -E '^# risk: *(high|medium|low)' || true)" in
        *high*) echo high ;;
        *medium*) echo medium ;;
        *low*) echo low ;;
        *) echo high ;;
    esac
}

level_covers() {
    case "$LEVEL" in
        all) return 0 ;;
        medium) [ "$1" != "low" ] ;;
        *) [ "$1" = "high" ] ;;
    esac
}

# 把一套测试的输出解析成账本行。逐条标记（形如 `  [PASS] P33 …`）一条一行；
#   整套没有逐条标记的（dod / release 这类只打一句结论的），按整套记一行，不去改人家的输出格式。
ledger_append() {
    LA_FILE="$1"; LA_OUT="$2"; LA_RC="$3"
    LA_N=0
    if [ -f "$LA_OUT" ]; then
        LA_N=$(LC_ALL=C grep -c -E '^[[:space:]]*\[(PASS|FAIL|SKIPPED)\]' "$LA_OUT" || true)
    fi
    if [ "${LA_N:-0}" -gt 0 ]; then
        # LC_ALL=C：按字节跑。gawk 在 UTF-8 locale 下会把下面那个字节区间判成非法排序字符直接崩，
        #   崩了这一套的账本就整套没了——所以锁死 C locale，截断与补救在同一套口径上。
        LC_ALL=C awk -v f="$LA_FILE" -v t="$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
            function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/[\t\r]/, " ", s); return s }
            {
                line = $0; sub(/^[ \t]+/, "", line)
                if (match(line, /^\[(PASS|FAIL|SKIPPED)\]/)) {
                    r = substr(line, 2, RLENGTH - 2)
                    n = substr(line, RLENGTH + 1); sub(/^[ \t]+/, "", n); sub(/[ \t]+$/, "", n)
                    # 截到 80：gawk 在 UTF-8 locale 按字符切，mawk 按字节切可能断在半个汉字上，
                    #   下面这条只在真截断时抹掉结尾那个残缺序列（未截断的不动，免得吃掉正常末字）。
                    if (length(n) > 80) { n = substr(n, 1, 80); sub(/[\300-\377][\200-\277]*$/, "", n) }
                    printf "{\"t\":\"%s\",\"file\":\"%s\",\"case\":\"%s\",\"result\":\"%s\"}\n", t, esc(f), esc(n), r
                }
            }
        ' "$LA_OUT" >> "$LEDGER" || echo "（账本：$LA_FILE 的 $LA_N 条结果没解析成，这一套在账本里缺了）"
    else
        printf '{"t":"%s","file":"%s","case":"<整套>","result":"%s"}\n' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$LA_FILE" "$([ "$LA_RC" -eq 0 ] && echo PASS || echo FAIL)" >> "$LEDGER" || true
    fi
}

# 静态套件失败点名：置 STATIC_RC、把套件名追加进 FAILED_SUITES、照旧提示这一条判 FAIL——
#   汇总行不再写死一句话，读的人一眼看出是哪几个套件红了。
mark_static_fail() {
    STATIC_RC=1
    if [ -z "$FAILED_SUITES" ]; then
        FAILED_SUITES="$1"
    else
        FAILED_SUITES="${FAILED_SUITES}、$1"
    fi
    echo "（上面这个静态测试判 FAIL）"
}

# 跑一套测试：按 --level 决定跑不跑，跑了就 tee 一份进账本，返回被测脚本自己的退出码。
#   因分级跳过 / 文件还没落地时返回 0 并计数——这两种都在汇总行里点名，不冒充通过。
run_test() {
    RT_PATH="$1"
    RT_NAME="$(basename "$RT_PATH")"
    if [ ! -f "$RT_PATH" ]; then
        echo "SKIPPED: $RT_NAME 不存在（尚未落地，未执行 != 通过）"
        MISSING_NOTE="${MISSING_NOTE}；$RT_NAME 缺文件 SKIPPED"
        return 0
    fi
    RT_RISK="$(risk_of "$RT_PATH")"
    if ! level_covers "$RT_RISK"; then
        if [ "$RT_RISK" = medium ]; then SKIP_MEDIUM=$((SKIP_MEDIUM+1)); else SKIP_LOW=$((SKIP_LOW+1)); fi
        echo "----- 跳过 ${RT_NAME}（risk: ${RT_RISK}，当前 --level ${LEVEL}）-----"
        return 0
    fi
    echo "----- 运行 $RT_NAME -----"
    RT_RC=0
    ( set -o pipefail; bash "$RT_PATH" 2>&1 | tee "$LEDGER_TMP" ) || RT_RC=$?
    ledger_append "$RT_NAME" "$LEDGER_TMP" "$RT_RC"
    return "$RT_RC"
}

echo "########## cc-base 框架自测 · run-all（--level ${LEVEL}）##########"
echo ""

# ---- 第一段：脚手架自测（无依赖，必跑）----
echo ">>> [1/3] selftest（脚手架自测，无需 claude CLI）"
SELF_RC=0
( set -o pipefail; bash "$TESTS_DIR/selftest.sh" 2>&1 | tee "$LEDGER_TMP" ) || SELF_RC=$?
# selftest 吐的是 JSON 结果，不按逐条标记解析——整套记一行就够，它本来就是「断言库还可信吗」一个判定。
printf '{"t":"%s","file":"selftest.sh","case":"selftest","result":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$([ "$SELF_RC" -eq 0 ] && echo PASS || echo FAIL)" >> "$LEDGER"
if [ "$SELF_RC" -ne 0 ]; then
    echo ""
    echo "########## 结果：selftest 失败（退出码 ${SELF_RC}），断言库本身不可信，停止。 ##########"
    exit "$SELF_RC"
fi

# ---- 第二段：静态自测（安装器回归 + 配置一致性，无需 claude CLI，必跑）----
echo ""
echo ">>> [2/3] 静态自测（test-setup / test-routing / 闸回归，无需 claude CLI）"
STATIC_RC=0
FAILED_SUITES=""
for s in test-setup.sh test-setup-optional.sh test-routing.sh test-fix-platform.sh test-hook-parity.sh test-gate-audit.sh test-three-file-sync-gate.sh test-fast-mode.sh test-supervisor.sh; do
    run_test "$TESTS_DIR/$s" || mark_static_fail "$s"
done
# harness 自测在 cases/（无需 claude CLI，只需 node），归第二段跑；无 node 时其自身打 SKIPPED 非假绿。
run_test "$DIR/test-harness.sh" || mark_static_fail "test-harness.sh"
# audit 三只哨兵：同样只需 node + git，归第二段跑。两套分工不同，都要跑——
#   test-audit-scripts 锁「脚本该有的行为」（干净仓 rc 0 / 坏样例 rc 1 / 豁免可见 / 非 git rc 3），
#   test-audit-defects 锁「已修的那批缺陷不再复发」（--staged 只判索引、压制外置、超限不假绿……）。
#   无 node 时这两个脚本自身已经打 SKIPPED 退 0（不再是 exit 1），这里的守卫留着是为了汇总行里
#   那句 AUDIT_NOTE —— 跳过了要在最后一行说出来，不让「跑不了」冒充通过。
AUDIT_NOTE=""
if command -v node >/dev/null 2>&1; then
    for s in test-audit-scripts.sh test-audit-defects.sh; do
        run_test "$TESTS_DIR/$s" || mark_static_fail "$s"
    done
    # 前期闸这一组：predev-lint（五份文档结构 + 延迟与重试预算算术）、ui-audit（渲染审计）、
    #   plan-lint（需求↔计划双向覆盖）、ui-slop-scan（界面通病静态扫描）、design-trace（设计详述规则 ↔ 测试 ↔ 常量）。
    #   test-ui-audit 在没有浏览器引擎的机器上 U5 只能 SKIPPED，套件按 golden 的约定退 3——
    #   「没跑」要在最后一行说出来，不让 CI 把它读成通过；其余几套不会退 3。
    #   分级由各套自己头部的 `# risk:` 决定：predev-lint 与 design-trace 是 high 天天跑，另三套 medium 进 CI。
    for s in test-predev-lint.sh test-design-trace.sh test-ui-audit.sh test-plan-lint.sh test-ui-slop-scan.sh; do
        PREDEV_RC=0
        run_test "$TESTS_DIR/$s" || PREDEV_RC=$?
        if [ "$PREDEV_RC" -eq 3 ]; then
            AUDIT_NOTE="${AUDIT_NOTE}；$s 有 SKIPPED（无浏览器引擎，未执行 != 通过）"
        elif [ "$PREDEV_RC" -ne 0 ]; then
            mark_static_fail "$s"
        fi
    done
else
    echo "SKIPPED: 无 node（command -v node 未找到）——audit 三只哨兵的两套测试跳过，未执行 != 通过。"
    AUDIT_NOTE="；audit 测试 SKIPPED（无 node）"
fi
# hook 单运行时的两份回归网：22 个 .mjs 的行为（喂 stdin 断言 stdout/退出码/状态文件副作用）
#   与 settings.json 的注册面（exec form、args[0] 存在、零 .sh/.ps1、timeout 保值）。
#   引擎崩掉给契约外退出码时闸不许静默放行的那 28 条红锁，已并进 test-hooks-node.sh 的
#   SG / PC 组（原 test-hook-failopen.sh 随 Phase D 退役）。
#   与 cases/test-harness.sh 分工——那份锁「引擎端到端链路该有的行为」，这两份锁「闸自己的行为」。
#   test-tier.sh 跟在后面：档位（profile.json + .runtime/tier.json）决定每个闸此刻怎么跑，
#   它锁的是那张表与 tier 子命令本身，闸的行为对不对由前两份判。
#   都只需 node + git；无 node 时它们自身是 exit 1 而不是 SKIPPED，所以守卫放在这里。
HOOKS_NOTE=""
if command -v node >/dev/null 2>&1; then
    for s in test-hooks-floor.sh test-hooks-node.sh test-hooks-settings.sh test-tier.sh test-tier-hardening.sh test-distribution.sh test-skills-lint-wording.sh test-progress-archive.sh; do
        run_test "$TESTS_DIR/$s" || mark_static_fail "$s"
    done
else
    echo "SKIPPED: 无 node（command -v node 未找到）——hook 行为与注册面回归跳过，未执行 != 通过。"
    HOOKS_NOTE="；hook 行为/注册面/档位回归 SKIPPED（无 node）"
fi
# 证据层红锁：账本读不出来要降级、并发追加不许断链、证据被改写要有命令看得见、
#   闸的范围不许由调用方伪造、被压制的失败不许冒充「从没跑过」。
#   与 cases/test-harness.sh 分工——那份锁「引擎端到端链路该有的行为」，这份锁「证据层的核心主张」。
#   只需 node + git + sleep；无 node 时它自身是 exit 1 而不是 SKIPPED，所以守卫放在这里。
EVIDENCE_NOTE=""
if command -v node >/dev/null 2>&1; then
    run_test "$TESTS_DIR/test-evidence-defects.sh" || mark_static_fail "test-evidence-defects.sh"
else
    echo "SKIPPED: 无 node（command -v node 未找到）——证据层红锁跳过，未执行 != 通过。"
    EVIDENCE_NOTE="；证据层红锁 SKIPPED（无 node）"
fi
# git hooks 强制层（.claude/githooks/）：会话外的提交路径归它管，与 .claude/hooks/ 那层分工不同。
#   打桩控退出码，所以只需 node + git；无 node 时它自身是 exit 1 而不是 SKIPPED，守卫放在这里。
#   注意它**不跑** pre-push 的 FULL 模式——那会反过来拉起本文件，再拉起 claude -p。
GITHOOKS_NOTE=""
if command -v node >/dev/null 2>&1; then
    run_test "$TESTS_DIR/test-githooks.sh" || mark_static_fail "test-githooks.sh"
else
    echo "SKIPPED: 无 node（command -v node 未找到）——git hooks 强制层回归跳过，未执行 != 通过。"
    GITHOOKS_NOTE="；git hooks 回归 SKIPPED（无 node）"
fi
# 两个一键闸自己也要进回归网：dod（静态治理总闸）和 release（发版就绪装配器）是提交/发版前
#   最后两道，此前谁都没跑过它们——最外层的闸没人守，是最容易烂掉的那种。
#   dod 断 rc 0：本仓静态治理常态全绿，红了就是真有 blocking step 挂了。
#   release **不能**断 rc 0——工作树脏 / Fast Mode 开着 / CI 红都会让它正确地判「未就绪」(rc 1)，
#   断 rc 0 会把它变成恒红。这里断的是「引擎跑出了结构完整的清单」：rc 在 {0,1} 内、stdout 是
#   JSON、八个装配项齐、状态在枚举内、每条 blocker 带 nextStep。引擎崩了也给 rc 1 但吐不出 JSON，
#   正好被结构这一层区分开——「判定为未就绪」和「引擎崩了」不许混成同一个红。
ONEKEY_NOTE=""
if command -v node >/dev/null 2>&1; then
    HARNESS_MJS="$TESTS_DIR/../harness/harness.mjs"
    echo "----- 运行 dod（一键静态治理闸）-----"
    DOD_RC=0
    ( cd "$REPO_ROOT" && node "$HARNESS_MJS" dod >/dev/null ) || DOD_RC=$?
    if [ "$DOD_RC" -eq 0 ]; then
        echo "dod: rc 0（每条 blocking 治理步都有结论）"
    else
        echo "dod: rc ${DOD_RC}（有 blocking step 没过或引擎崩了，跑 node .claude/harness/harness.mjs dod 看是哪条）"
        mark_static_fail "dod"
    fi

    echo "----- 运行 release（发版就绪装配器，判结构不判就绪）-----"
    RELEASE_RC=0
    RELEASE_JSON=$( cd "$REPO_ROOT" && node "$HARNESS_MJS" release 2>/dev/null ) || RELEASE_RC=$?
    if [ "$RELEASE_RC" -eq 3 ]; then
        echo "SKIPPED: release rc 3（非 git 仓，或八项全 UNKNOWN 什么都没确立）——未执行 != 通过。"
        ONEKEY_NOTE="；release SKIPPED（rc 3 什么都没确立）"
    elif [ "$RELEASE_RC" -ne 0 ] && [ "$RELEASE_RC" -ne 1 ]; then
        echo "release: rc $RELEASE_RC 不在 {0,1,3} 契约内——引擎崩了，不是判定未就绪"
        mark_static_fail "release"
    else
        printf '%s' "$RELEASE_JSON" | node -e '
let s = "";
process.stdin.on("data", d => s += d).on("end", () => {
  let j;
  try { j = JSON.parse(s); } catch (e) {
    console.error("release: stdout 不是 JSON（引擎崩了，不是判定未就绪）：" + e.message);
    process.exit(1);
  }
  // 档位落地后这项叫 tier 不叫 fast-mode（放水与否是档位盘的一格，不再是独立开关），
  // 且装配多了 gate-fresh 一项。名单照 RELEASE_CHECKS 的实际八项写全：少写一项，
  // 那一项哪天从装配里掉出去也没人拦得住。
  const want = ["worktree", "remote", "dod", "manifest", "review-queue", "tier", "ci", "gate-fresh"];
  const got = (j.checks || []).map(c => c.id);
  const miss = want.filter(w => !got.includes(w));
  if (miss.length) {
    console.error("release: 装配项缺 " + miss.join(", ") + "（实得 " + (got.join(", ") || "空") + "）");
    process.exit(1);
  }
  const bad = (j.checks || []).filter(c => !["PASS", "FAIL", "DEGRADED"].includes(c.status));
  if (bad.length) {
    console.error("release: 状态越界 " + bad.map(c => c.id + "=" + c.status).join(", "));
    process.exit(1);
  }
  const noStep = (j.blockers || []).filter(b => !b.nextStep);
  if (noStep.length) {
    console.error("release: blocker 缺 nextStep（只诊断不给下一步，闸就没人用）：" + noStep.map(b => b.id).join(", "));
    process.exit(1);
  }
  console.log("release: 清单结构完整（" + got.length + " 项，blockers=" + (j.blockers || []).length
    + "，established=" + j.established + "）——就绪与否是它的判定，不是本测试的断言");
});
' || mark_static_fail "release"
    fi

    # release 的 manifest 项：上面那条只判清单结构，判不出八项里某一项的内容对不对。
    #   这份在沙箱仓里造真的运行态文件（.stop-gate-strikes / harness/state/* / .runtime/* …），
    #   断言 manifest 仍 PASS 且 unlisted=0——MANIFEST_RULES 的运行态排除规则此前无人守，
    #   删掉整批 selftest 与 golden 都照样全绿。它自身有 node/git/sha256sum 守卫会打 SKIPPED。
    run_test "$TESTS_DIR/test-release-manifest.sh" || mark_static_fail "test-release-manifest.sh"

    # 借鉴兄弟仓那轮落地的四份（2026-09-04），同样只需 node + git，各自内部有守卫：
    #   test-doctor 锁「清单全量比对、不抽样」；test-scan-secrets-userinfo 锁 url-userinfo 那条密钥模式；
    #   test-static-check 锁 Stage 0 对 .mjs 不再空绿；test-release-binding 锁 release 的 gate-fresh /
    #   trustBoundary、receipt 绑引擎哈希、治理面 risk、shim 发现。
    for s in test-doctor.sh test-scan-secrets-userinfo.sh test-static-check.sh test-release-binding.sh; do
        run_test "$TESTS_DIR/$s" || mark_static_fail "$s"
    done
else
    echo "SKIPPED: 无 node（command -v node 未找到）——dod / release 一键闸跳过，未执行 != 通过。"
    ONEKEY_NOTE="；dod / release 一键闸 SKIPPED（无 node）"
fi
# 剩余 .ps1 的回归：单运行时之后 hook 不再有 .ps1，这份缩到「幸存的 6 个 .ps1 纯 ASCII」
#   与 fast-mode.ps1 的端到端开关行为——hook 行为归 test-hooks-node.sh（Windows 上由 Git Bash 跑）。
#   本机没 pwsh 就明示 SKIP：CI 的 ps1 那格会真跑，那里 rc 3 直接判失败。
#   退出码：0=全过 / 1=有断言红 / 3=有整组没跑成（缺 node 或 git）。
PS1_NOTE=""
PS1_BEHAVIOR="$TESTS_DIR/test-ps1-behavior.ps1"
if command -v pwsh >/dev/null 2>&1; then
    echo "----- 运行 test-ps1-behavior.ps1（原生 pwsh 跑剩余 .ps1）-----"
    PS1_RC=0
    pwsh -NoProfile -File "$PS1_BEHAVIOR" || PS1_RC=$?
    if [ "$PS1_RC" -eq 3 ]; then
        PS1_NOTE="；剩余 .ps1 回归有整组 SKIPPED（未执行 != 通过）"
    elif [ "$PS1_RC" -ne 0 ]; then
        mark_static_fail "test-ps1-behavior.ps1"
    fi
else
    echo "SKIPPED: 无 pwsh（command -v pwsh 未找到）——剩余 .ps1 回归跳过，未执行 != 通过。"
    PS1_NOTE="；剩余 .ps1 回归 SKIPPED（无 pwsh）"
fi
# 按级别跳过的要在汇总行里报数：日常 --level high 少跑的那批，看的人得知道少了多少。
LEVEL_NOTE=""
if [ "$SKIP_MEDIUM" -gt 0 ] || [ "$SKIP_LOW" -gt 0 ]; then
    LEVEL_NOTE="；跳过 $SKIP_MEDIUM 套 medium / $SKIP_LOW 套 low 用例（--level ${LEVEL}，未执行 != 通过）"
fi
if [ "$STATIC_RC" -ne 0 ]; then
    echo ""
    echo "########## 结果：静态自测失败（失败套件：${FAILED_SUITES}）${LEVEL_NOTE}${MISSING_NOTE}，停止。 ##########"
    exit "$STATIC_RC"
fi

# ---- 第三段：真触发 cases（需 claude CLI）----
echo ""
echo ">>> [3/3] 真触发 cases（需 claude CLI + 耗 token）"
# 默认不跑：这两个 case 真去拉 claude -p，耗 token 也耗分钟，挂在每次 push / 每次自测上不值当。
# 要跑就显式 CCBASE_RUN_CLAUDE_CASES=1，跳过时汇总行里点名——未执行 != 通过。
if [ "${CCBASE_RUN_CLAUDE_CASES:-0}" != "1" ]; then
    echo "SKIPPED: 真触发 case 默认不跑，CCBASE_RUN_CLAUDE_CASES=1 才跑（未执行 != 通过）"
    echo ""
    echo "########## 结果：selftest + 静态自测通过${AUDIT_NOTE}${HOOKS_NOTE}${EVIDENCE_NOTE}${GITHOOKS_NOTE}${ONEKEY_NOTE}${PS1_NOTE}${LEVEL_NOTE}${MISSING_NOTE}；真触发 cases 已 SKIP（opt-in 未开，非假绿）。 ##########"
    exit 0
fi
if ! command -v claude >/dev/null 2>&1; then
    echo "SKIPPED: 无 claude CLI（command -v claude 未找到）——真触发测试跳过，未执行 != 通过。"
    echo ""
    echo "########## 结果：selftest + 静态自测通过${AUDIT_NOTE}${HOOKS_NOTE}${EVIDENCE_NOTE}${GITHOOKS_NOTE}${ONEKEY_NOTE}${PS1_NOTE}${LEVEL_NOTE}${MISSING_NOTE}；真触发 cases 已 SKIP（非假绿）。 ##########"
    exit 0
fi

CASE_RC=0
RAN=0
for c in "$DIR"/*.sh; do
    [ "$(basename "$c")" = "run-all.sh" ] && continue
    [ "$(basename "$c")" = "test-harness.sh" ] && continue   # 已在第二段跑（只需 node，不需 claude CLI）
    [ "$(basename "$c")" = "test-skill-behavior.sh" ] && continue  # opt-in（RUN_LIVE_SKILL=1），默认不跑，单独执行
    RAN=$((RAN+1))
    echo ""
    echo "----- 运行 case：$(basename "$c") -----"
    bash "$c" || { CASE_RC=1; echo "（上面这个 case 判 FAIL）"; }
done

echo ""
if [ "$RAN" -eq 0 ]; then
    echo "########## 结果：selftest + 静态自测通过${AUDIT_NOTE}${HOOKS_NOTE}${EVIDENCE_NOTE}${GITHOOKS_NOTE}${ONEKEY_NOTE}${PS1_NOTE}${LEVEL_NOTE}${MISSING_NOTE}；cases 目录无可跑用例。 ##########"
elif [ "$CASE_RC" -eq 0 ]; then
    echo "########## 结果：selftest + 静态自测${AUDIT_NOTE}${HOOKS_NOTE}${EVIDENCE_NOTE}${GITHOOKS_NOTE}${ONEKEY_NOTE}${PS1_NOTE}${LEVEL_NOTE}${MISSING_NOTE} + 全部 $RAN 个真触发 case 通过。 ##########"
else
    echo "########## 结果：selftest + 静态自测通过${AUDIT_NOTE}${HOOKS_NOTE}${EVIDENCE_NOTE}${GITHOOKS_NOTE}${ONEKEY_NOTE}${PS1_NOTE}${LEVEL_NOTE}${MISSING_NOTE}，但有真触发 case 失败。 ##########"
fi
exit "$CASE_RC"
