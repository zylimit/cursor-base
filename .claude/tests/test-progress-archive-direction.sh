#!/usr/bin/env bash
# risk: high
# test-progress-archive-direction.sh — progress-archive.mjs「归档方向」黑盒回归（red-lock）。
# 契约：搬走的永远是最旧的条目、留下的永远是最新的 N 条，不管该段在文件里升序（最旧在上）还是降序（最新在上）写；
#   方向由该段首条与末条开头日期判断；首末同日（判断不出）时整次运行拒绝：不搬、报一行含关键词「方向」的原因、
#   退出码非 0、progress.md 与 progress.archive.md 一个字节不动（含 --check）。
# 背景：下游 lutetia 实测，Decisions / Notes 往后追加（最旧在上），脚本却一律留文件里前 N 条，把最新的现行决策搬走了。
# 保守取舍（契约未明处）：同一次运行里任一「需要搬」的段判断不出，整次拒绝，不做部分搬迁。
# 保留线 Done 35 / Notes 35 / Decisions 24，触发线 Done+Notes 100 / Decisions 30（来自任务单，不在此另立）。
# 夹具一律 mktemp -d + --root，不碰仓库根的真 progress.md / progress.archive.md。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/progress-archive.mjs}"
echo "===== test-progress-archive-direction ====="
if ! command -v node >/dev/null 2>&1; then
  echo "SKIPPED: 无 node——progress-archive.mjs 是纯 node 脚本，一条都跑不了，未执行 != 通过。"
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
run_pa() {  # run_pa <root> [参数...] —— 回填 PA_RC/PA_OUT/PA_ERR
  local root="$1"; shift
  PA_OUT=$(mktemp "$TMP/pa.out.XXXXXX"); PA_ERR=$(mktemp "$TMP/pa.err.XXXXXX"); PA_RC=0
  ( env -u CLAUDE_PROJECT_DIR node "$ENGINE" --root "$root" "$@" >"$PA_OUT" 2>"$PA_ERR" ) || PA_RC=$?
}
sha() { if [ -f "$1" ]; then sha256sum "$1" | awk '{print $1}'; else echo "<absent>"; fi; }
extract_block() { awk -v h="$2" '$0==h{inb=1;next} inb&&/^## /{exit} inb{print}' "$1"; }
norm() { awk 'NF'; }
# gen_dated <count> <label> <asc|desc> —— 日期逐条不同（2024-01-01 起每条 +1 天）；asc 位置1最旧，desc 位置1最新
gen_dated() {
  # shellcheck disable=SC2016  # 单引号是有意的：$ 留给 node 的模板字符串，不是 shell 展开
  node -e '
    const [n, label, dir] = [parseInt(process.argv[1], 10), process.argv[2], process.argv[3]];
    for (let i = 1; i <= n; i++) {
      const k = dir === "asc" ? i - 1 : n - i;
      const d = new Date(Date.UTC(2024, 0, 1 + k)).toISOString().slice(0, 10);
      console.log(`- ${d} ${label}-entry-${String(i).padStart(3, "0")} 占位描述文本`);
    }' "$1" "$2" "$3"
}
# gen_sameday <count> <label> —— 全部同一天
gen_sameday() { local i; for i in $(seq 1 "$1"); do printf -- '- 2024-06-15 %s-entry-%03d 占位描述文本\n' "$2" "$i"; done; }
build_progress() {  # build_progress <outfile> <done> <notes> <dec>
  {
    printf '# progress（测试夹具）\n\n_Last updated: 2020-01-01_\n\n## Pinned\n- 占位 Pinned 事项\n\n'
    printf '## Done\n%s\n\n## Notes\n%s\n\n## Decisions\n%s\n\n## TODO\n- [P2][OPEN][#3]  占位任务\n' "$2" "$3" "$4"
  } > "$1"
}
rng() { printf '%s\n' "$1" | sed -n "$2p"; }  # rng <多行文本> <起,止>

# ============================== D-asc ==============================
# Decisions 40 条升序（最旧在上）：搬原第1-16条（最旧）、留第17-40条（最新24条）、顺序不变、指针累计 16。
# 打死：一律 slice 文件里前 N 条（留前24搬后16）的实现；只翻转搬运但把保留区顺序也翻了。
DA_ROOT="$TMP/da"; mkdir -p "$DA_ROOT"
DA_ALL=$(gen_dated 40 dec asc)
build_progress "$DA_ROOT/progress.md" "$(gen_dated 5 "done" desc)" "$(gen_dated 5 notes desc)" "$DA_ALL"
run_pa "$DA_ROOT"
DA_KEPT=$(extract_block "$DA_ROOT/progress.md" '## Decisions' | grep -v '^（归档指针：' | norm)
DA_ARCH=$(extract_block "$DA_ROOT/progress.archive.md" '## Archived Decisions' | norm)
ok=0; [ "$PA_RC" = "0" ] || ok=1
chk "$ok" "D-asc-a Decisions 40 条升序：退出码 0" "rc=0" "rc=$PA_RC"
ok=0; [ "$DA_KEPT" = "$(rng "$DA_ALL" 17,40)" ] || ok=1
chk "$ok" "D-asc-b 正文 Decisions 保留原第17-40条（最新24条，顺序不变）" "保留区=原第17-40条" \
  "保留首=$(printf '%s\n' "$DA_KEPT" | head -1 | cut -c1-40) 末=$(printf '%s\n' "$DA_KEPT" | tail -1 | cut -c1-40) 行数=$(printf '%s\n' "$DA_KEPT" | grep -c .)"
ok=0; [ "$DA_ARCH" = "$(rng "$DA_ALL" 1,16)" ] || ok=1
chk "$ok" "D-asc-c Archived Decisions 恰为原第1-16条（最旧16条）" "归档区=原第1-16条" \
  "归档首=$(printf '%s\n' "$DA_ARCH" | head -1 | cut -c1-40) 末=$(printf '%s\n' "$DA_ARCH" | tail -1 | cut -c1-40) 行数=$(printf '%s\n' "$DA_ARCH" | grep -c .)"
ok=0; extract_block "$DA_ROOT/progress.md" '## Decisions' | grep -Fq -- '（归档指针：累计搬出 16 条' || ok=1
chk "$ok" "D-asc-d 正文 Decisions 段末有「（归档指针：累计搬出 16 条」" "含该指针前缀" \
  "指针行=$(extract_block "$DA_ROOT/progress.md" '## Decisions' | grep -F -- '归档指针' | cut -c1-40 || true)"

# ============================== D-desc ==============================
# Decisions 40 条降序（最新在上）：留前24、搬第25-40条。守住既有行为，打死「修方向时把降序搞反」。
DD_ROOT="$TMP/dd"; mkdir -p "$DD_ROOT"
DD_ALL=$(gen_dated 40 dec desc)
build_progress "$DD_ROOT/progress.md" "$(gen_dated 5 "done" desc)" "$(gen_dated 5 notes desc)" "$DD_ALL"
run_pa "$DD_ROOT"
DD_KEPT=$(extract_block "$DD_ROOT/progress.md" '## Decisions' | grep -v '^（归档指针：' | norm)
DD_ARCH=$(extract_block "$DD_ROOT/progress.archive.md" '## Archived Decisions' | norm)
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$DD_KEPT" = "$(rng "$DD_ALL" 1,24)" ] || ok=1; [ "$DD_ARCH" = "$(rng "$DD_ALL" 25,40)" ] || ok=1
chk "$ok" "D-desc Decisions 40 条降序：留原第1-24条、搬第25-40条" "rc=0，保留=1-24，归档=25-40" \
  "rc=$PA_RC 保留相等=$([ "$DD_KEPT" = "$(rng "$DD_ALL" 1,24)" ] && echo yes || echo no) 归档相等=$([ "$DD_ARCH" = "$(rng "$DD_ALL" 25,40)" ] && echo yes || echo no)"

# ============================== Mixed ==============================
# Notes 60 条升序 + Done 50 条降序（合计 110 过线）：同一次运行两段方向不同各判各的。
# 打死：全文件只判一次方向（或写死一种方向）；两段共用同一个方向变量。
MX_ROOT="$TMP/mx"; mkdir -p "$MX_ROOT"
MX_N=$(gen_dated 60 notes asc); MX_D=$(gen_dated 50 "done" desc)
build_progress "$MX_ROOT/progress.md" "$MX_D" "$MX_N" "$(gen_dated 5 dec desc)"
run_pa "$MX_ROOT"
MX_NK=$(extract_block "$MX_ROOT/progress.md" '## Notes' | grep -v '^（归档指针：' | norm)
MX_NA=$(extract_block "$MX_ROOT/progress.archive.md" '## Archived Notes' | norm)
MX_DK=$(extract_block "$MX_ROOT/progress.md" '## Done' | grep -v '^（归档指针：' | norm)
MX_DA=$(extract_block "$MX_ROOT/progress.archive.md" '## Archived Done' | norm)
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$MX_NA" = "$(rng "$MX_N" 1,25)" ] || ok=1; [ "$MX_NK" = "$(rng "$MX_N" 26,60)" ] || ok=1
chk "$ok" "Mixed-Notes 升序 60 条：搬原第1-25条、留第26-60条" "rc=0，归档=1-25，保留=26-60" \
  "rc=$PA_RC 归档相等=$([ "$MX_NA" = "$(rng "$MX_N" 1,25)" ] && echo yes || echo no) 保留相等=$([ "$MX_NK" = "$(rng "$MX_N" 26,60)" ] && echo yes || echo no)"
ok=0; [ "$MX_DA" = "$(rng "$MX_D" 36,50)" ] || ok=1; [ "$MX_DK" = "$(rng "$MX_D" 1,35)" ] || ok=1
chk "$ok" "Mixed-Done 降序 50 条：搬原第36-50条、留第1-35条（同次运行方向与 Notes 相反）" "归档=36-50，保留=1-35" \
  "归档相等=$([ "$MX_DA" = "$(rng "$MX_D" 36,50)" ] && echo yes || echo no) 保留相等=$([ "$MX_DK" = "$(rng "$MX_D" 1,35)" ] && echo yes || echo no)"

# ============================== Same-day ==============================
# Decisions 35 条全同一天（判断不出）：rc 非 0；stdout+stderr 合起来恰一行含关键词「方向」且该行提到 Decisions；
#   两份文件跑前跑后 sha256 相同；--check 同样 rc 非 0、文件不动。
# 打死：默认回落到某一方向照搬（rc 0 搬 11 条）；报错但已写了归档；--check 路径漏掉判断；静默拒绝不说原因。
sameday_run() {  # sameday_run <名> <是否预置归档 1/0> [参数...]
  local name="$1" witharch="$2"; shift 2
  local r="$TMP/sd-$name"; mkdir -p "$r"
  build_progress "$r/progress.md" "$(gen_dated 5 "done" desc)" "$(gen_dated 5 notes desc)" "$(gen_sameday 35 dec)"
  [ "$witharch" = "1" ] && printf '# Archive（测试夹具）\n\n_Last updated: 2020-01-01_\n' > "$r/progress.archive.md"
  local b1 b2; b1=$(sha "$r/progress.md"); b2=$(sha "$r/progress.archive.md")
  run_pa "$r" "$@"
  SD_SAME=1
  { [ "$(sha "$r/progress.md")" = "$b1" ] && [ "$(sha "$r/progress.archive.md")" = "$b2" ]; } || SD_SAME=0
  SD_MSG=$(cat "$PA_OUT" "$PA_ERR")
  SD_KEY=$(printf '%s\n' "$SD_MSG" | grep -c '方向' || true)
  SD_KEYDEC=$(printf '%s\n' "$SD_MSG" | grep '方向' | grep -c 'Decisions' || true)
}
sameday_run plain 1
ok=0; [ "$PA_RC" != "0" ] || ok=1; [ "$SD_SAME" = "1" ] || ok=1
chk "$ok" "Same-day-a 首末同日：rc 非 0，两份文件一个字节不动" "rc!=0，sha256 前后相同" "rc=$PA_RC 文件不变=$SD_SAME"
ok=0; [ "$SD_KEY" = "1" ] && [ "$SD_KEYDEC" = "1" ] || ok=1
chk "$ok" "Same-day-b 输出恰一行含「方向」，且该行提到 Decisions" "含「方向」的行数=1，其中含 Decisions 的=1" "方向行数=$SD_KEY 含Decisions=$SD_KEYDEC 输出=$(printf '%s' "$SD_MSG" | tr '\n' '|' | cut -c1-120)"
sameday_run check 0 --check
ok=0; [ "$PA_RC" != "0" ] || ok=1; [ "$SD_SAME" = "1" ] || ok=1
chk "$ok" "Same-day-c --check 同样 rc 非 0、文件不动（归档文件本就不存在，不得被创建）" "rc!=0，prog 与 archive(<absent>) 不变" "rc=$PA_RC 文件不变=$SD_SAME"

# ============================== Mixed-refuse ==============================
# 契约保守取舍：Notes 升序 60 + Done 降序 50 都能判断，但 Decisions 35 条同日判断不出 → 整次拒绝，
#   不做「能搬的先搬」。打死：按段独立容错（跳过判断不出的段、其余照搬）。
MR_ROOT="$TMP/mr"; mkdir -p "$MR_ROOT"
build_progress "$MR_ROOT/progress.md" "$(gen_dated 50 "done" desc)" "$(gen_dated 60 notes asc)" "$(gen_sameday 35 dec)"
printf '# Archive（测试夹具）\n\n_Last updated: 2020-01-01_\n' > "$MR_ROOT/progress.archive.md"
M1=$(sha "$MR_ROOT/progress.md"); M2=$(sha "$MR_ROOT/progress.archive.md")
run_pa "$MR_ROOT"
ok=0; [ "$PA_RC" != "0" ] || ok=1; [ "$(sha "$MR_ROOT/progress.md")" = "$M1" ] || ok=1; [ "$(sha "$MR_ROOT/progress.archive.md")" = "$M2" ] || ok=1
chk "$ok" "Mixed-refuse 一段判断不出：整次拒绝，其余段也不搬" "rc!=0，两份文件不变" \
  "rc=$PA_RC prog不变=$([ "$(sha "$MR_ROOT/progress.md")" = "$M1" ] && echo yes || echo no) arch不变=$([ "$(sha "$MR_ROOT/progress.archive.md")" = "$M2" ] && echo yes || echo no)"

echo "==== test-progress-archive-direction：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" = "0" ] || exit 1
