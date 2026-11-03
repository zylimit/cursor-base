#!/usr/bin/env bash
# risk: medium
# test-plan-lint.sh — DEV-PLAN 静态质量门（scripts/plan-lint.sh）的回归测试。
#
# 这个脚本此前零测试覆盖，所以既有行为（跳过 / 必需段 / 占位符 / 参数）与本批新增的需求↔计划双向覆盖一起兜。
#   断言按**契约**写：plan-lint.sh [plan] [spec]，无 plan → rc 0；任一失败项 → rc 1；未知或多余参数 → rc 2。
# 每条拒绝用例同时判 rc **和**失败行的关键词：只判 rc=1 的话，「python3 崩了 / 文件读不到」也给非零，红锁会被伪绿冒充过去。
# 覆盖检查两头都测：漏做（Spec 声明了没人引用）与悬空（计划引用了 Spec 里没有的）；外加一条防假红的地板——
#   围栏里的示例编号与示例占位符不算数，模板自己就带这种示例。夹具在 mktemp 沙箱里现造，不落 tests/fixtures。
#
# 用法：bash test-plan-lint.sh [plan-lint.sh 路径]
set -u

SRC=$(cd "$(dirname "$0")/.." && pwd)
LINT=${1:-"$SRC/scripts/plan-lint.sh"}

echo "===== test-plan-lint ====="
command -v python3 >/dev/null 2>&1 || {
    echo 'SKIPPED: 无 python3——被测脚本的判定全在内嵌 python 里，未执行 != 通过。'
    exit 0
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
chk() {
    if [ "$1" -eq 0 ]; then pass "$2"; else fail "$2"; fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}
contains() { case "$2" in *"$1"*) return 0 ;; *) return 1 ;; esac; }
brief() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-220 | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null; }
newdir() { mktemp -d "$TMP/caseXXXXXX"; }

RC=0
OUT=""
run_lint() { OUT=$(bash "$LINT" "$@" 2>&1); RC=$?; }

expect() { # <dir> <期望rc> <关键词> <说明>
    local r
    run_lint "$1/DEV-PLAN.md"
    if [ "$RC" -eq "$2" ] && contains "$3" "$OUT"; then r=0; else r=1; fi
    chk "$r" "$4" "rc=$2 且输出含「$3」" \
        "rc=${RC}；含=$(contains "$3" "$OUT" && echo yes || echo no)；输出：$(brief "$OUT")"
}

# ---------------------------------------------------------------------------
# 夹具：一份合规 Spec / DEV-PLAN + 逐条规则的单点变异
# ---------------------------------------------------------------------------
write_spec() { # <dir> [variant]
    local d=$1 v=${2:-good}
    {
        printf '%s\n' '# 派单小工具 Product Spec' '' '## 功能需求'
        case "$v" in
            no_id) printf '%s\n' '- 派单：组长选单 -> 指派师傅' '- 回单：师傅传照片 -> 系统记完成时间' ;;
            *)     printf '%s\n' '- [REQ-DISPATCH-001] 派单：组长选单 -> 指派师傅' \
                                 '- [REQ-REPORT-002] 回单：师傅传照片 -> 系统记完成时间' ;;
        esac
    } > "$d/Product-Spec.md"
}

write_plan() { # <dir> [variant]
    local d=$1 v=${2:-good}
    {
        printf '%s\n' '# 派单小工具 DEV-PLAN' '' '## Phase 1：派单闭环' '**交付内容**：组长能派单，师傅能回单'
        [ "$v" = no_anchor ] || printf '%s\n' '**验证的假设**：师傅愿意在手机上点开派单链接'
        printf '%s\n' '**关键文件**：src/dispatch.ts' '**Task 清单**'
        [ "$v" = no_task ] || printf '%s\n' '- **Task 1.1：派单接口** 覆盖 REQ-DISPATCH-001'
        case "$v" in
            uncovered|no_task) : ;;   # uncovered：少了引用 REQ-REPORT-002 的那条 Task
            dangling) printf '%s\n' '- **Task 1.2：回单接口** 覆盖 REQ-REPORT-002、REQ-GHOST-777' ;;
            *)        printf '%s\n' '- **Task 1.2：回单接口** 覆盖 REQ-REPORT-002' ;;
        esac
        case "$v" in
            placeholder) printf '%s\n' '**验收标准**：TBD' ;;
            *)           printf '%s\n' '**验收标准**：派单后师傅端 5 秒内收到通知' ;;
        esac
        [ "$v" != fenced ] || printf '%s\n' '' '照这段格式写，编号换成自己的：' '```md' \
                                             '- **Task 9.1：示例** 覆盖 REQ-DEMO-999' '- 这里别留 TODO' '```'
    } > "$d/DEV-PLAN.md"
}

if [ -f "$LINT" ]; then
    chk 0 "L0 被测脚本存在：$LINT" "plan-lint.sh 存在" "存在"
else
    chk 1 "L0 被测脚本存在：$LINT" "plan-lint.sh 存在" "不存在——下面每条都会红，红因是功能缺失"
fi

# ---------------------------------------------------------------------------
# 既有行为：跳过 / 必需段 / Task 粒度 / 占位符 / 参数
# ---------------------------------------------------------------------------
D=$(newdir); expect "$D" 0 '无 DEV-PLAN，跳过' "L1 无 DEV-PLAN → 打印跳过并 rc 0（cc-base 本体就没有 DEV-PLAN）"

run_lint --bogus
if [ "$RC" -eq 2 ] && contains '未知参数' "$OUT"; then r=0; else r=1; fi
chk "$r" "L2 未知参数 → rc 2" "rc=2 且输出含「未知参数」" "rc=${RC}；输出：$(brief "$OUT")"

D=$(newdir); write_spec "$D"; write_plan "$D"; expect "$D" 0 'plan-lint: 通过' "L3 合规计划 + 编号全覆盖 → rc 0（基线：底下那些红是真红，不是夹具本身坏）"

D=$(newdir); write_spec "$D"; write_plan "$D" no_anchor; expect "$D" 1 '缺字段 **验证的假设**' "L4 Phase 缺 **验证的假设** → 点名缺哪个字段"

D=$(newdir); write_plan "$D" no_task; expect "$D" 1 '没有可执行的 Task 条目' "L5 有 Task 清单标题但没有 Task 条目 → 报粒度（该目录不放 Spec，隔离覆盖检查）"

D=$(newdir); write_spec "$D"; write_plan "$D" placeholder; expect "$D" 1 '占位符命中' "L6 验收标准写 TBD → 占位符命中"

# ---------------------------------------------------------------------------
# 本批新增：需求 ↔ 计划双向覆盖
# ---------------------------------------------------------------------------
D=$(newdir); write_spec "$D"; write_plan "$D" uncovered; expect "$D" 1 '需求没人做: REQ-REPORT-002' "L7 Spec 声明的编号计划里没人引用 → 需求没人做"

D=$(newdir); write_spec "$D"; write_plan "$D" dangling; expect "$D" 1 '悬空引用: REQ-GHOST-777' "L8 计划引用了 Spec 里不存在的编号 → 悬空引用"

D=$(newdir); write_spec "$D" no_id; write_plan "$D"; expect "$D" 0 '未用 REQ 编号，跳过覆盖检查' "L9 Spec 不用 REQ 编号（小项目常态）→ 跳过覆盖检查，rc 不受影响"

D=$(newdir); write_plan "$D"; expect "$D" 0 '无 Product-Spec，跳过覆盖检查' "L10 无 Product-Spec.md → 跳过覆盖检查且仍 rc 0"

D=$(newdir); write_plan "$D" no_anchor; expect "$D" 1 '缺字段 **验证的假设**' "L11 无 Product-Spec 时其余检查照跑（跳过覆盖 ≠ 整个闸放假）"

D=$(newdir); write_spec "$D"; write_plan "$D" fenced; expect "$D" 0 'plan-lint: 通过' "L12 围栏里的 REQ-DEMO-999 与 TODO 不制造假红（模板自带这种示例段）"

# ---------------------------------------------------------------------------
# 本批新增：范围外声明（dev-planner 局部计划 × plan-lint 新契约，Codex 审查 HIGH PL2）
# ---------------------------------------------------------------------------
write_plan_oos() { # <dir> <variant> — 「## 范围外（本次不计划）」专用夹具，独立于 write_plan 避免连累既有用例
    local d=$1 v=$2
    {
        printf '%s\n' '# 派单小工具 DEV-PLAN' '' '## Phase 1：派单闭环' \
                       '**交付内容**：组长能派单，师傅能回单' \
                       '**验证的假设**：师傅愿意在手机上点开派单链接' \
                       '**关键文件**：src/dispatch.ts' \
                       '**Task 清单**' \
                       '- **Task 1.1：派单接口** 覆盖 REQ-DISPATCH-001'
        case "$v" in
            declared_and_referenced)
                printf '%s\n' '- **Task 1.2：回单接口** 覆盖 REQ-REPORT-002' \
                               '**验收标准**：派单后师傅端 5 秒内收到通知' '' \
                               '## 范围外（本次不计划）' \
                               '- REQ-REPORT-002：原因（已押后）'
                ;;
            declared_unknown_req)
                printf '%s\n' '- **Task 1.2：回单接口** 覆盖 REQ-REPORT-002' \
                               '**验收标准**：派单后师傅端 5 秒内收到通知' '' \
                               '## 范围外（本次不计划）' \
                               '- REQ-GHOST-777：原因（归别的计划）'
                ;;
            section_present_still_uncovered)
                printf '%s\n' '**验收标准**：派单后师傅端 5 秒内收到通知' '' \
                               '## 范围外（本次不计划）' \
                               '- 暂无其它安排'
                ;;
            declared_empty_reason)
                printf '%s\n' '**验收标准**：派单后师傅端 5 秒内收到通知' '' \
                               '## 范围外（本次不计划）' \
                               '- REQ-REPORT-002：'
                ;;
            declared_twice)
                printf '%s\n' '**验收标准**：派单后师傅端 5 秒内收到通知' '' \
                               '## 范围外（本次不计划）' \
                               '- REQ-REPORT-002：原因（第一次声明）' \
                               '- REQ-REPORT-002：原因（第二次声明，应被 WARN 点名但不影响判定）'
                ;;
            declared|*)
                printf '%s\n' '**验收标准**：派单后师傅端 5 秒内收到通知' '' \
                               '## 范围外（本次不计划）' \
                               '- REQ-REPORT-002：原因（待确认）'
                ;;
        esac
    } > "$d/DEV-PLAN.md"
}

D=$(newdir); write_spec "$D"; write_plan_oos "$D" declared; expect "$D" 0 '范围外（已声明）：REQ-REPORT-002' "L13 Spec 里已声明的 REQ 在「范围外」节声明不计划 → 不 FAIL，报「范围外（已声明）」"

D=$(newdir); write_spec "$D"; write_plan_oos "$D" section_present_still_uncovered; expect "$D" 1 '需求没人做: REQ-REPORT-002' "L14 有「范围外」节但目标 REQ 既未被 Task 引用也未被节内声明 → 仍 FAIL（回归：新节不是免死金牌）"

D=$(newdir); write_spec "$D"; write_plan_oos "$D" declared_unknown_req; expect "$D" 1 '范围外声明的编号不存在: REQ-GHOST-777' "L15 「范围外」节声明了 Spec 里不存在的编号 → FAIL（防拼错）"

D=$(newdir); write_spec "$D"; write_plan_oos "$D" declared_and_referenced; expect "$D" 1 '范围外声明与 Task 矛盾: REQ-REPORT-002' "L16 同一 REQ 既有 Task 引用又在「范围外」节声明 → FAIL（矛盾）"

D=$(newdir); write_spec "$D"; write_plan "$D"; expect "$D" 0 'plan-lint: 通过' "L17 没有「范围外」节时行为与旧版一致（回归：合规计划照常通过，新解析不误伤）"

# ---------------------------------------------------------------------------
# 本批新增：显式传第二个 Spec 路径（非默认名、非同目录，Codex 复核 PL2）
# ---------------------------------------------------------------------------
write_order_spec() { # <dir> — 唯一权威需求来源不叫 Product-Spec.md、也不与 DEV-PLAN.md 同目录
    local d=$1
    mkdir -p "$d/docs/prd"
    printf '%s\n' '# 订单模块 PRD' '' '## 功能需求' \
                   '- [REQ-ORDER-001] 下单：选品 -> 提交订单' \
                   '- [REQ-ORDER-002] 退单：申请退款 -> 系统退款' \
        > "$d/docs/prd/order.md"
}

write_order_plan() { # <dir> [variant] — DEV-PLAN.md 只引用 REQ-ORDER-001；oos 变体加「范围外」声明 002
    local d=$1 v=${2:-plain}
    {
        printf '%s\n' '# 订单模块 DEV-PLAN' '' '## Phase 1：下单闭环' \
                       '**交付内容**：用户能下单' \
                       '**验证的假设**：无' \
                       '**关键文件**：src/order.ts' \
                       '**Task 清单**' \
                       '- **Task 1.1：下单接口** 覆盖 REQ-ORDER-001' \
                       '**验收标准**：下单后返回订单号'
        if [ "$v" = oos ]; then
            printf '%s\n' '' '## 范围外（本次不计划）' '- REQ-ORDER-002：原因（已押后）'
        fi
    } > "$d/DEV-PLAN.md"
}

D=$(newdir); write_order_spec "$D"; write_order_plan "$D"
run_lint "$D/DEV-PLAN.md" "$D/docs/prd/order.md"
if [ "$RC" -eq 1 ] && contains '需求没人做: REQ-ORDER-002' "$OUT"; then r=0; else r=1; fi
chk "$r" "L18 显式传第二个 Spec 路径（非默认名 docs/prd/order.md、非 DEV-PLAN 同目录）→ 覆盖检查按该文件做，未被引用的 REQ-ORDER-002 → FAIL 并点名" \
    "rc=1 且输出含「需求没人做: REQ-ORDER-002」" "rc=${RC}；输出：$(brief "$OUT")"
# 对照（现状，不计入 PASS/FAIL，本次不改脚本）：同一夹具无参跑——默认只在 DEV-PLAN.md 同目录找 Product-Spec.md，
# 这里找不到就整段跳过覆盖检查、rc 0，REQ-ORDER-002 的缺口不会被无参调用发现，这正是 PL2 要修的问题本身
run_lint "$D/DEV-PLAN.md"
echo "  [NOTE] L18 对照（现状不变）：同一夹具无参跑 → rc=${RC}，输出：$(brief "$OUT")"

D=$(newdir); write_order_spec "$D"; write_order_plan "$D" oos
run_lint "$D/DEV-PLAN.md" "$D/docs/prd/order.md"
if [ "$RC" -eq 0 ] && contains '范围外（已声明）：REQ-ORDER-002' "$OUT"; then r=0; else r=1; fi
chk "$r" "L19 显式传第二个 Spec 路径 + REQ-ORDER-002 在「范围外（本次不计划）」声明 → 通过并 WARN" \
    "rc=0 且输出含「范围外（已声明）：REQ-ORDER-002」" "rc=${RC}；输出：$(brief "$OUT")"


# ---------------------------------------------------------------------------
# 本批新增：范围外声明的两处松动（progress.md TODO #84，「范围外」节声明不是豁免、每条要有原因）
# ---------------------------------------------------------------------------
D=$(newdir); write_spec "$D"; write_plan_oos "$D" declared_empty_reason
run_lint "$D/DEV-PLAN.md"
if [ "$RC" -eq 1 ] && contains '范围外声明缺原因: REQ-REPORT-002' "$OUT"; then r=0; else r=1; fi
chk "$r" "L20 「范围外」节声明原因留空（- REQ-REPORT-002：后面空着）→ FAIL（契约：声明不是豁免，每条要有原因）" \
    "rc=1 且输出含「范围外声明缺原因: REQ-REPORT-002」" "rc=${RC}；输出：$(brief "$OUT")"

D=$(newdir); write_spec "$D"; write_plan_oos "$D" declared_twice
run_lint "$D/DEV-PLAN.md"
if [ "$RC" -eq 0 ] && contains '范围外（已声明）：REQ-REPORT-002——原因（第一次声明）' "$OUT" \
    && contains 'L12' "$OUT" && contains 'L13' "$OUT"; then r=0; else r=1; fi
chk "$r" "L21 同一 REQ 在「范围外」节声明两次 → 仍以首条为准通过，但 WARN 点名两处行号（不静默取首条）" \
    "rc=0 且首条原因生效、WARN 含 L12 与 L13 两处行号" \
    "rc=${RC}；输出：$(brief "$OUT")"

echo "  [NOTE] 未覆盖：多余位置参数 rc 2、Spec 正文提过但未声明的编号（悬空判据用的是全文提及）、非 UTF-8 文档。"

echo ""
echo "==== test-plan-lint：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ]
