#!/usr/bin/env bash
# risk: high
# test-plan-archive.sh — DEV-PLAN.md → DEV-PLAN.archive.md 搬运黑盒回归（docs/living-docs-contract-2026-11.md 第 2 节）。
# 断言只从契约推导。最怕：搬丢、搬错头、搬一半——先写归档、核对、再删正文，失败时 DEV-PLAN.md 一字节不动。
# 夹具一律 mktemp -d + --root，不碰仓库根的真 DEV-PLAN.md。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/plan-archive.mjs}"
LINT="$REPO_ROOT/.claude/scripts/plan-lint.sh"
echo "===== test-plan-archive ====="
if ! command -v node >/dev/null 2>&1; then
  echo "SKIPPED: 无 node——plan-archive.mjs 是纯 node 脚本，一条都跑不了，未执行 != 通过。"
  exit 0
fi
[ -f "$ENGINE" ] || { echo "  [FAIL] 缺被测脚本：$ENGINE" >&2; exit 1; }
TMP=$(mktemp -d)
trap 'chmod -R u+rwX "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
chk() {  # chk <0=过/非0=不过> <标题> <EXPECT> <GOT>
  if [ "$1" = "0" ]; then PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$2"
  else FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$2"; fi
  printf '         EXPECT %s\n         GOT    %s\n' "$3" "$4"
}
run_pl() {  # run_pl <root> [参数...] —— 回填 PL_RC/PL_OUT/PL_ERR；PL_FAIL_AT 注入 PLAN_ARCHIVE_FAIL_AT
  local root="$1"; shift
  PL_OUT=$(mktemp "$TMP/o.XXXXXX"); PL_ERR=$(mktemp "$TMP/e.XXXXXX"); PL_RC=0
  ( env -u CLAUDE_PROJECT_DIR ${PL_FAIL_AT:+PLAN_ARCHIVE_FAIL_AT="$PL_FAIL_AT"} node "$ENGINE" --root "$root" "$@" >"$PL_OUT" 2>"$PL_ERR" ) || PL_RC=$?
}
sha() { sha256sum "$1" | awk '{print $1}'; }
jf() {
  node -e '
    const fs=require("fs"); let d;
    try { d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch(e){ process.stdout.write("<parse-error>"); process.exit(0); }
    for (const k of process.argv[2].split(".")) d=(d==null?undefined:d[k]);
    process.stdout.write(d===undefined?"<undefined>":String(d));
  ' "$1" "$2"
}
# gen_phase <n> <done 0|1> [标题] [Task 行附加文本] [正文填充字节数] —— 带齐 plan-lint 要的五个字段与一条 Task
gen_phase() {
  local n="$1" d="$2" t="${3:-标题$1}" x="${4:-}" pad=""
  if [ -n "${5:-}" ]; then pad=$(head -c "$5" /dev/zero | tr '\0' x); fi
  if [ "$d" = 1 ]; then printf '## Phase %s: %s ✅（2026-10-28，PASS）\n' "$n" "$t"; else printf '## Phase %s: %s（进行中）\n' "$n" "$t"; fi
  printf '\n**交付内容**：交付说明 %s\n**验证的假设**：假设说明\n**关键文件**：src/a.txt\n**Task 清单**：\n- **Task %s.1：做某事 %s**\n**验收标准**：验收说明 %s\n\n---\n\n' "$n" "$n" "$x" "$pad"
}
heads() { grep -o '^## Phase [0-9]*' "$1" | awk '{print $3}' | tr '\n' ' '; }  # 现存 Phase 编号，空格分隔
# ============================== P1 ==============================
# 条数线：25 个 Phase，其中 2、25 没带 ✅；已完成 23 个 → 搬最靠前的 3 个（1、3、4），留最靠后的 20 个；
# 未标完成的 Phase 2（夹在被搬的中间）与「## 范围外」一个字不动，归档里是原文。
# unmarked 只数最后一个 ✅（Phase 24）之前的：2 算；25 排在它之后、是还没做的，不算，所以是 1。
# 打死：搬最靠后的（搬错头）；把没带 ✅ 的小节当已完成搬走；搬走时改了原文。
R1="$TMP/p1"; mkdir -p "$R1"
{ printf '# DEV-PLAN（测试夹具）\n\n'; gen_phase 1 1; gen_phase 2 0; for i in $(seq 3 24); do gen_phase "$i" 1; done; gen_phase 25 0
  printf '## 范围外（本次不计划）\n- REQ-X-001：原因\n'; } > "$R1/DEV-PLAN.md"
run_pl "$R1" --json
P1_LEFT=$(heads "$R1/DEV-PLAN.md"); P1_WANT="2 $(seq -s' ' 5 25) "
P1_ARCH=$(cat "$R1/DEV-PLAN.archive.md" 2>/dev/null || true); P1_E=$(gen_phase 1 1; gen_phase 3 1; gen_phase 4 1)
ok=0; [ "$PL_RC" = "0" ] || ok=1; [ "$P1_LEFT" = "$P1_WANT" ] || ok=1; grep -Fxq '## 范围外（本次不计划）' "$R1/DEV-PLAN.md" || ok=1
[[ "$P1_ARCH" == *"$P1_E"* ]] || ok=1; [ "$(heads "$R1/DEV-PLAN.archive.md" 2>/dev/null)" = "1 3 4 " ] || ok=1
for f in total:25 completed:23 moved:3 unmarked:1; do [ "$(jf "$PL_OUT" "${f%%:*}")" = "${f##*:}" ] || ok=1; done
chk "$ok" "P1 已完成 23 个超线：搬最靠前的 1/3/4 留后 20 个，未标 ✅ 的 2/25 与范围外不动，归档为原文" \
  "rc=0；DEV-PLAN 剩 2 5..25；归档含 1 3 4 三节原文；JSON total=25 completed=23 moved=3 unmarked=1" "rc=$PL_RC 剩=[$P1_LEFT] 归档=[$(heads "$R1/DEV-PLAN.archive.md" 2>/dev/null)] moved=$(jf "$PL_OUT" moved)"
# ============================== P2 ==============================
# 体积线（65536 字节，地板 3 个已完成）：条数没过 20 也搬；一直搬到 ≤ 线，但留下的已完成不得少于 3。
# 打死：只看条数；超线搬空（地板失守）。每节约 12KB×8 → 搬 3 个；每节约 40KB×5 → 到地板 3 个即停，搬 2 个。
vol() {  # vol <tag> <n> <pad> <want_moved>
  local r="$TMP/$1" i; mkdir -p "$r"
  { printf '# DEV-PLAN（测试夹具）\n\n'; for i in $(seq 1 "$2"); do gen_phase "$i" 1 "" "" "$3"; done; } > "$r/DEV-PLAN.md"
  run_pl "$r"
  local left; left=$(heads "$r/DEV-PLAN.md")
  ok=0; [ "$PL_RC" = "0" ] || ok=1; [ "$left" = "$(seq -s' ' $(($4 + 1)) "$2") " ] || ok=1
  [ "$(grep -c '^## Phase' "$r/DEV-PLAN.archive.md" 2>/dev/null || true)" = "$4" ] || ok=1
  chk "$ok" "P2$1 $2 个已完成每节约 $3 字节：搬最靠前的 $4 个" "rc=0；DEV-PLAN 剩 Phase $(($4 + 1))..$2；归档恰 $4 节" "rc=$PL_RC 剩=[$left]"
}
vol a 8 12000 3
vol b 5 40000 2
# ============================== P3 ==============================
# 指针行：标题原文（含 ✅ 与括号）+ 固定后缀；REQ 按出现顺序去重；无 REQ 不接后缀；
# 「## 已归档 Phase」不存在时新建在留下的第一个 Phase 标题之前，指针按文档顺序。
R3="$TMP/p3"; mkdir -p "$R3"
{ printf '# DEV-PLAN（测试夹具）\n\n'; gen_phase 1 1 "POI 维护补完" "REQ-POI-001 REQ-POI-002 REQ-POI-001"; gen_phase 2 1 "无需求小节"
  for i in $(seq 3 22); do gen_phase "$i" 1; done; } > "$R3/DEV-PLAN.md"
run_pl "$R3"
P3_A='- Phase 1: POI 维护补完 ✅（2026-10-28，PASS） → DEV-PLAN.archive.md（REQ：REQ-POI-001, REQ-POI-002）'
P3_B='- Phase 2: 无需求小节 ✅（2026-10-28，PASS） → DEV-PLAN.archive.md'
ln() { grep -nFx -- "$2" "$1" | head -1 | cut -d: -f1; }
LA=$(ln "$R3/DEV-PLAN.md" "$P3_A"); LB=$(ln "$R3/DEV-PLAN.md" "$P3_B"); LH=$(ln "$R3/DEV-PLAN.md" '## 已归档 Phase'); LP=$(ln "$R3/DEV-PLAN.md" '## Phase 3: 标题3 ✅（2026-10-28，PASS）')
ok=0; [ "$PL_RC" = "0" ] || ok=1
for v in "$LA" "$LB" "$LH" "$LP"; do [ -n "$v" ] || ok=1; done
if [ "$ok" = "0" ]; then [ "$LH" -lt "$LA" ] && [ "$LA" -lt "$LB" ] && [ "$LB" -lt "$LP" ] || ok=1; fi
chk "$ok" "P3 指针行逐字等于契约例子（含 REQ 去重列表；无 REQ 不接后缀），在新建的「## 已归档 Phase」里先于留下的首个 Phase" \
  "rc=0；两行指针整行存在；行序 已归档标题 < Phase1 指针 < Phase2 指针 < Phase 3 标题" "rc=$PL_RC 行号 A=$LA B=$LB 标题=$LH Phase3=$LP"
# ============================== P4 ==============================
# 失败注入：写归档 / 核对两处失败，rc 1、stderr 非空、DEV-PLAN.md 一字节不动（打死先删后写）；
# 注入点必须真起作用——去掉注入重跑 rc 0、Phase 1 搬走，且前两次失败留下的半成品归档里 Phase 1 恰一份（不重复）。
R4="$TMP/p4"; mkdir -p "$R4"
{ printf '# DEV-PLAN（测试夹具）\n\n'; for i in $(seq 1 22); do gen_phase "$i" 1; done; } > "$R4/DEV-PLAN.md"
P4_SHA=$(sha "$R4/DEV-PLAN.md"); ok=0; P4_GOT=""
for at in archive-write verify; do
  PL_FAIL_AT=$at; run_pl "$R4"; PL_FAIL_AT=
  [ "$PL_RC" = "1" ] || ok=1; [ -s "$PL_ERR" ] || ok=1; [ "$(sha "$R4/DEV-PLAN.md")" = "$P4_SHA" ] || ok=1
  P4_GOT="$P4_GOT $at:rc=$PL_RC"
done
run_pl "$R4"
[ "$PL_RC" = "0" ] || ok=1; grep -q '^## Phase 1:' "$R4/DEV-PLAN.md" && ok=1
[ "$(grep -c '^## Phase 1:' "$R4/DEV-PLAN.archive.md" 2>/dev/null || true)" = "1" ] || ok=1
chk "$ok" "P4 注入 archive-write / verify：rc=1，DEV-PLAN.md sha256 不变；去注入重跑 rc=0 且归档不重复" \
  "两次注入 rc=1 且 stderr 非空、sha 不变；重跑 rc=0，Phase 1 在归档恰一份、不在正文" "注入:$P4_GOT 重跑 rc=$PL_RC"
# ============================== P5 ==============================
# 归档不许把需求覆盖检查搬红：22 个已完成 Phase 各引用一个 REQ，搬完 plan-lint 仍 rc 0（指针行里的 REQ 算已安排）。
# 打死：指针行漏写 REQ，或 plan-lint 没认指针行。先断言搬迁真发生、归档前 lint 本来就过，免得红在夹具上。
if ! command -v python3 >/dev/null 2>&1; then echo "  [SKIPPED] P5：无 python3，plan-lint 跑不了，未执行 != 通过"; else
R5="$TMP/p5"; mkdir -p "$R5"
{ printf '# Spec（夹具）\n\n## 功能需求\n'; for i in $(seq 1 22); do printf -- '- [REQ-LNT-%03d] 需求%s\n' "$i" "$i"; done; } > "$R5/Product-Spec.md"
{ printf '# DEV-PLAN（测试夹具）\n\n'; for i in $(seq 1 22); do gen_phase "$i" 1 "" "$(printf 'REQ-LNT-%03d' "$i")"; done; } > "$R5/DEV-PLAN.md"
P5_PRE=0; bash "$LINT" "$R5/DEV-PLAN.md" "$R5/Product-Spec.md" >"$TMP/l0.out" 2>&1 || P5_PRE=$?
run_pl "$R5"; P5_LINT=0; bash "$LINT" "$R5/DEV-PLAN.md" "$R5/Product-Spec.md" >"$TMP/l1.out" 2>&1 || P5_LINT=$?
ok=0; [ "$P5_PRE" = "0" ] || ok=1; [ "$PL_RC" = "0" ] || ok=1; grep -q '^## Phase 1:' "$R5/DEV-PLAN.md" && ok=1; [ "$P5_LINT" = "0" ] || ok=1
chk "$ok" "P5 搬完 Phase 1/2 后 plan-lint 仍 rc 0（需求覆盖不被搬红）" "归档前 lint rc=0；归档 rc=0 且 Phase 1 已搬走；归档后 lint rc=0" \
  "归档前 rc=$P5_PRE 归档 rc=$PL_RC 归档后 lint rc=$P5_LINT：$(head -c 200 "$TMP/l1.out" | tr '\n' ' ')"
fi
# ============================== P6 ==============================
# 指针行只认箭头后 `（REQ：…）` 后缀里的编号，不认前半标题原文（审查复现）：Phase 1 标题写「REQ-A-002 推到下期」，Task 行只提 REQ-A-001，
# REQ-A-002 在范围外声明。打死：plan-lint 整行读指针行——标题里的 REQ-A-002 被算成已安排，搬完报「范围外声明与 Task 矛盾」（搬红）。
if command -v python3 >/dev/null 2>&1; then
R6="$TMP/p6"; mkdir -p "$R6"
printf '# Spec（夹具）\n\n## 功能需求\n- [REQ-A-001] 需求\n- [REQ-A-002] 需求\n- [REQ-A-003] 需求\n' > "$R6/Product-Spec.md"
{ printf '# DEV-PLAN（测试夹具）\n\n'; gen_phase 1 1 "A 补完（REQ-A-002 推到下期）" "REQ-A-001"; for i in $(seq 2 21); do gen_phase "$i" 1 "" "REQ-A-001"; done
  gen_phase 22 0 "" "REQ-A-003"; printf '## 范围外（本次不计划）\n- REQ-A-002：推到下期\n'; } > "$R6/DEV-PLAN.md"
P6_PRE=0; bash "$LINT" "$R6/DEV-PLAN.md" "$R6/Product-Spec.md" >"$TMP/m0.out" 2>&1 || P6_PRE=$?
run_pl "$R6"; P6_LINT=0; bash "$LINT" "$R6/DEV-PLAN.md" "$R6/Product-Spec.md" >"$TMP/m1.out" 2>&1 || P6_LINT=$?
ok=0; [ "$P6_PRE" = "0" ] || ok=1; [ "$PL_RC" = "0" ] || ok=1; grep -q '^## Phase 1:' "$R6/DEV-PLAN.md" && ok=1; [ "$P6_LINT" = "0" ] || ok=1
chk "$ok" "P6 标题带范围外编号的 Phase 1 搬走后 plan-lint 仍 rc 0（指针行前半的标题编号不算已安排）" "归档前 lint rc=0；归档 rc=0 且 Phase 1 已搬；归档后 lint rc=0" \
  "归档前 rc=$P6_PRE 归档 rc=$PL_RC 归档后 lint rc=$P6_LINT：$(head -c 200 "$TMP/m1.out" | tr '\n' ' ')"
fi
printf '==== test-plan-archive：PASS=%s FAIL=%s ====\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
