#!/usr/bin/env bash
# risk: high
# test-progress-archive.sh — progress.md → progress.archive.md 归档搬运黑盒回归（TODO #75）。
# 契约来源：用户 2026-09-19 拍板的 progress-archive-contract.md；断言只从契约推导，不看实现源码。
# 业务背景：同日人工搬迁两次撞轮次上限——上午先删正文后写归档丢了三条决策；用户拍板改用脚本，
#   所以 A5（失败时正文不动）/A6（打断后可续搬不重复）是最要紧的两条。
# 瘦身（2026-09-19，主 Agent 要求核心测试比例压到 0.5 以内）：每条臂只留能打死一个具体错误实现的，
#   互证/重复的合并或删；未变的是判别力，变的是报告粒度与措辞长度。
# 夹具一律 mktemp -d + --root，不碰、不拷仓库根的真 progress.md / progress.archive.md。
set -eu
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENGINE="${1:-$REPO_ROOT/.claude/scripts/progress-archive.mjs}"
echo "===== test-progress-archive ====="
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
# run_pa <root> [参数...] —— 回填 PA_RC/PA_OUT/PA_ERR；-u 双保险不受会话环境变量污染；PA_FAIL_AT
#   （可选，跑前设、跑后清）注入 PROGRESS_ARCHIVE_FAIL_AT（契约 2026-09-20 增补的故障注入点）。
run_pa() {
  local root="$1"; shift
  PA_OUT=$(mktemp "$TMP/pa.out.XXXXXX"); PA_ERR=$(mktemp "$TMP/pa.err.XXXXXX"); PA_RC=0
  ( env -u CLAUDE_PROJECT_DIR ${PA_FAIL_AT:+PROGRESS_ARCHIVE_FAIL_AT="$PA_FAIL_AT"} node "$ENGINE" --root "$root" "$@" >"$PA_OUT" 2>"$PA_ERR" ) || PA_RC=$?
}
sha() { if [ -f "$1" ]; then sha256sum "$1" | awk '{print $1}'; else echo "<absent>"; fi; }
jf() {  # jf <jsonfile> <点号路径> —— 本仓测试既有的 node -e 单行取字段写法
  node -e '
    const fs=require("fs"); let d;
    try { d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch(e){ process.stdout.write("<parse-error>"); process.exit(0); }
    for (const k of process.argv[2].split(".")) d=(d==null?undefined:d[k]);
    process.stdout.write(d===undefined?"<undefined>":String(d));
  ' "$1" "$2"
}
# extract_block <file> <"## 标题"整段字面量> —— 精确等值匹配（2026-09-20 增补收紧了标题认法，
#   "## TODO" 与 "## TODO 归档说明" 不相干；测试工具本身也不能再用前缀，否则 A10 先坑自己）。
extract_block() { awk -v h="$2" '$0==h{inb=1;next} inb&&/^## /{exit} inb{print}' "$1"; }
norm() { awk 'NF'; }  # 去空行，契约没定空行格式，比较正文不纠结这个
# gen_entries <count> <label> <cont_idx> —— count 条 Done/Notes/Decisions 风格条目，位置1(最新)..count(最旧)；cont_idx>0 时该条带两行缩进续行（0=不加）
gen_entries() {
  local count="$1" label="$2" cont_idx="$3" i d m y
  for i in $(seq 1 "$count"); do
    d=$(( (i % 28) + 1 )); m=$(( ((i / 28) % 12) + 1 )); y=$(( 2020 + i / 336 ))
    printf -- '- %04d-%02d-%02d %s-entry-%03d 占位描述文本\n' "$y" "$m" "$d" "$label" "$i"
    if [ "$i" -eq "$cont_idx" ]; then
      printf '  续行第一行：补充说明 %s-entry-%03d\n  续行第二行：再补充一句 %s-entry-%03d\n' "$label" "$i" "$label" "$i"
    fi
  done
}
gen_todo_small() { printf -- '- [P1][DONE][#1]  占位任务1已完成\n- [P1][完成][#2]  占位任务2已完成\n- [P2][OPEN][#3]  占位任务3进行中\n'; }
gen_todo_closed() { local n="$1" i; for i in $(seq 1 "$n"); do printf -- '- [P1][DONE][#%d]  真TODO占位%d\n' "$i" "$i"; done; }  # n 条顺编号已关闭 TODO
build_progress() {  # build_progress <outfile> <done> <notes> <dec> <todo> [<额外标题> <额外正文>]
  local out="$1" db="$2" nb="$3" decb="$4" tb="$5" xh="${6:-}" xb="${7:-}"
  {
    printf '# progress（测试夹具）\n\n_Last updated: 2020-01-01_\n\n'
    printf '## Pinned\n- 占位 Pinned 事项 1：某条硬约束\n- 占位 Pinned 事项 2：另一条硬约束\n\n'
    [ -n "$xh" ] && printf '%s\n%s\n\n' "$xh" "$xb"
    printf '## Done\n%s\n\n## Notes\n%s\n\n## Decisions\n%s\n\n## TODO\n%s\n' "$db" "$nb" "$decb" "$tb"
  } > "$out"
}
TODO_SMALL=$(gen_todo_small)
# ============================== A1 ==============================
# 没超线：三组阈值都不过线，两份文件必须逐字节不变。红了说明"没东西要搬"时仍动了文件，或阈值算错。
A1_ROOT="$TMP/a1"; mkdir -p "$A1_ROOT"
A1_PROG="$A1_ROOT/progress.md"; A1_ARCH="$A1_ROOT/progress.archive.md"
build_progress "$A1_PROG" "$(gen_entries 10 "done" 0)" "$(gen_entries 10 notes 0)" "$(gen_entries 10 dec 0)" "$TODO_SMALL"
printf '# Archive（测试夹具）\n\n_Last updated: 2020-01-01_\n' > "$A1_ARCH"
B1=$(sha "$A1_PROG"); B2=$(sha "$A1_ARCH")
run_pa "$A1_ROOT"
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$(sha "$A1_PROG")" = "$B1" ] || ok=1; [ "$(sha "$A1_ARCH")" = "$B2" ] || ok=1
chk "$ok" "A1 没超线：两份文件逐字节不变，退出码 0" "rc=0 且两份文件 sha256 跑前跑后相同" \
  "rc=$PA_RC prog相等=$([ "$(sha "$A1_PROG")" = "$B1" ] && echo yes || echo no) arch相等=$([ "$(sha "$A1_ARCH")" = "$B2" ] && echo yes || echo no)"
# ============================== A2 ==============================
# Done+Notes 合计超100：各留最新35条；非日期开头的"- （……）"指针行不算条目；续行随条目整体搬迁。
# 打死：①阈值按单段而非"合计"判断；②非条目行被误当条目数/搬，边界算错一位；③续行被切断或漏搬。
A2_ROOT="$TMP/a2"; mkdir -p "$A2_ROOT"
A2_PROG="$A2_ROOT/progress.md"; A2_ARCH="$A2_ROOT/progress.archive.md"
A2_DONE_ENTRIES=$(gen_entries 60 "done" 40)
A2_PTR='- （2020-08-01 及更早的 Done 条目已搬迁，参见 progress.archive.md）'
A2_DONE_BODY=$(printf '%s\n%s' "$A2_DONE_ENTRIES" "$A2_PTR")
build_progress "$A2_PROG" "$A2_DONE_BODY" "$(gen_entries 50 notes 0)" "$(gen_entries 10 dec 0)" "$TODO_SMALL"
run_pa "$A2_ROOT"
A2_DONE_POST=$(extract_block "$A2_PROG" '## Done')
# A2a：保留区=前35条，逐字节顺序不变
A2_KEPT_GOT=$(printf '%s\n' "$A2_DONE_POST" | sed -n '1,35p')
A2_KEPT_WANT=$(printf '%s\n' "$A2_DONE_ENTRIES" | sed -n '1,35p')
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$A2_KEPT_GOT" = "$A2_KEPT_WANT" ] || ok=1
chk "$ok" "A2a Done 保留区=前35条，逐字节、顺序与原文一致" "rc=0 且保留区前35行等于原始生成的前35条" \
  "rc=$PA_RC 相等=$([ "$A2_KEPT_GOT" = "$A2_KEPT_WANT" ] && echo yes || echo no)"
# A2b：非条目指针行（"- （……）"，字面以 "-" 开头，grep -F 须带 --）留在正文、不进归档
A2_ARCH_DONE=$(extract_block "$A2_ARCH" '## Archived Done')
ok=0; grep -Fxq -- "$A2_PTR" <<<"$A2_DONE_POST" || ok=1; grep -Fxq -- "$A2_PTR" <<<"$A2_ARCH_DONE" && ok=1
chk "$ok" "A2b 非日期开头的「- （……）」指针行不算条目：留在正文、不进归档" "该行逐字仍在正文 Done 区，不出现在 Archived Done 区" \
  "正文含=$(grep -Fxq -- "$A2_PTR" <<<"$A2_DONE_POST" && echo yes || echo no) 归档含=$(grep -Fxq -- "$A2_PTR" <<<"$A2_ARCH_DONE" && echo yes || echo no)"
# A2c：第36-60条（含 entry-040 两行续行）整体、原序搬进 Archived Done，一条不多不少
A2_MOVED_WANT=$(printf '%s\n' "$A2_DONE_ENTRIES" | sed -n '36,$p' | norm)
A2_GOT_ARCH=$(printf '%s\n' "$A2_ARCH_DONE" | norm)
ok=0; [ "$A2_GOT_ARCH" = "$A2_MOVED_WANT" ] || ok=1
chk "$ok" "A2c Done 第36-60条（含续行）整体、原序搬进 Archived Done" "Archived Done（去空行）恰等于原第36-60条（含续行，去空行）" \
  "相等=$([ "$A2_GOT_ARCH" = "$A2_MOVED_WANT" ] && echo yes || echo no) 归档行数=$(printf '%s\n' "$A2_GOT_ARCH" | grep -c . || true) 期望=$(printf '%s\n' "$A2_MOVED_WANT" | grep -c . || true)"
# ============================== A3 ==============================
# Decisions 超30：留最新24条；单独触发时 Done/Notes 不被连带搬（"三组各判各的"，全文只留这一处）。
# 打死：三组共用一把总阈值/保留数写死成别组的值；或误把"某组超线"当"全部超线"。
A3_ROOT="$TMP/a3"; mkdir -p "$A3_ROOT"
A3_PROG="$A3_ROOT/progress.md"; A3_ARCH="$A3_ROOT/progress.archive.md"
A3_DEC=$(gen_entries 35 dec 0)
build_progress "$A3_PROG" "$(gen_entries 5 "done" 0)" "$(gen_entries 5 notes 0)" "$A3_DEC" "$TODO_SMALL"
run_pa "$A3_ROOT" --json
A3_DEC_POST=$(extract_block "$A3_PROG" '## Decisions')
A3_KEPT_GOT=$(printf '%s\n' "$A3_DEC_POST" | sed -n '1,24p')
A3_KEPT_WANT=$(printf '%s\n' "$A3_DEC" | sed -n '1,24p')
A3_MOVED_WANT=$(printf '%s\n' "$A3_DEC" | sed -n '25,$p' | norm)
A3_ARCH_DEC=$(extract_block "$A3_ARCH" '## Archived Decisions' | norm)
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$A3_KEPT_GOT" = "$A3_KEPT_WANT" ] || ok=1; [ "$A3_ARCH_DEC" = "$A3_MOVED_WANT" ] || ok=1
chk "$ok" "A3a Decisions 超30：留最新24条，其余11条整体搬进 Archived Decisions" "rc=0，保留区前24条不变，Archived Decisions=第25-35条" \
  "rc=$PA_RC 保留相等=$([ "$A3_KEPT_GOT" = "$A3_KEPT_WANT" ] && echo yes || echo no) 归档相等=$([ "$A3_ARCH_DEC" = "$A3_MOVED_WANT" ] && echo yes || echo no)"
A3_DONE_POST=$(extract_block "$A3_PROG" '## Done' | norm); A3_DONE_WANT=$(gen_entries 5 "done" 0 | norm)
A3_NOTES_POST=$(extract_block "$A3_PROG" '## Notes' | norm); A3_NOTES_WANT=$(gen_entries 5 notes 0 | norm)
ok=0; [ "$A3_DONE_POST" = "$A3_DONE_WANT" ] || ok=1; [ "$A3_NOTES_POST" = "$A3_NOTES_WANT" ] || ok=1
chk "$ok" "A3b 三组各判各的：Decisions 单独超线时，没超线的 Done / Notes 不被连带搬" "Done / Notes 正文逐字节不变" \
  "Done相等=$([ "$A3_DONE_POST" = "$A3_DONE_WANT" ] && echo yes || echo no) Notes相等=$([ "$A3_NOTES_POST" = "$A3_NOTES_WANT" ] && echo yes || echo no)"
# ============================== A4 ==============================
# TODO 已关闭超20：只搬 DONE/完成，留编号最大的10条；OPEN/部分完成/明确不做永不搬；字母后缀编号
# （#30d #31b）按前导整数排序，不按字符串；夹具故意打乱文件顺序（编号与位置完全不对应）。
# 打死：①未关闭状态被误搬；②编号按字符串排序（"9">"18"这种坑）；③字母后缀解析失败/排错位；
# ④保留判断用了文件位置而非编号大小；⑤搬走的行漏搬/重复搬进归档。
A4_ROOT="$TMP/a4"; mkdir -p "$A4_ROOT"
A4_PROG="$A4_ROOT/progress.md"; A4_ARCH="$A4_ROOT/progress.archive.md"
A4_TODO_BODY=$(cat <<'EOF'
- [P1][DONE][#10]  占位任务 10 已完成
- [P2][OPEN][#500]  占位任务 500 进行中，编号很大但状态未关闭，永不该搬
- [P1][完成][#23]  占位任务 23 已完成
- [P1][DONE][#1]  占位任务 1 已完成
- [P1][DONE][#16]  占位任务 16 已完成
- [P2][部分完成][#501]  占位任务 501 部分完成，永不该搬
- [P1][完成][#2]  占位任务 2 已完成
- [P1][DONE][#30d]  占位任务 30d 已完成（编号带字母后缀）
- [P1][完成][#17]  占位任务 17 已完成
- [P1][DONE][#3]  占位任务 3 已完成
- [P2][OPEN][#9999]  占位任务 9999 进行中，编号极大但未关闭，永不该搬
- [P1][完成][#18]  占位任务 18 已完成
- [P1][DONE][#4]  占位任务 4 已完成
- [P1][完成][#31b]  占位任务 31b 已完成（编号带字母后缀）
- [P1][DONE][#19]  占位任务 19 已完成
- [P1][完成][#5]  占位任务 5 已完成
- [P2][明确不做][#502]  占位任务 502 明确不做，永不该搬
- [P1][DONE][#20]  占位任务 20 已完成
- [P1][完成][#6]  占位任务 6 已完成
- [P1][DONE][#21]  占位任务 21 已完成
- [P1][完成][#7]  占位任务 7 已完成
- [P1][DONE][#22]  占位任务 22 已完成
- [P1][完成][#8]  占位任务 8 已完成
- [P2][部分完成][#10000]  占位任务 10000 部分完成，永不该搬
- [P1][DONE][#9]  占位任务 9 已完成
- [P1][完成][#11]  占位任务 11 已完成
- [P1][DONE][#12]  占位任务 12 已完成
- [P1][完成][#13]  占位任务 13 已完成
- [P1][DONE][#14]  占位任务 14 已完成
- [P1][完成][#15]  占位任务 15 已完成
EOF
)
build_progress "$A4_PROG" "$(gen_entries 5 "done" 0)" "$(gen_entries 5 notes 0)" "$(gen_entries 5 dec 0)" "$A4_TODO_BODY"
run_pa "$A4_ROOT"
A4_TODO_POST=$(extract_block "$A4_PROG" '## TODO')
A4_ARCH_TODO=$(extract_block "$A4_ARCH" '## Archived TODO')
# A4a：编号最大的10条（含字母后缀 30d/31b）全部保留在正文
ok=0
for id in 31b 30d 23 22 21 20 19 18 17 16; do grep -Eq "\[#${id}\]" <<<"$A4_TODO_POST" || ok=1; done
chk "$ok" "A4a 编号最大的10个已关闭条目（含字母后缀 30d/31b）全部保留在正文" "31b 30d 23 22 21 20 19 18 17 16 十条全在正文" \
  "$(for id in 31b 30d 23 22 21 20 19 18 17 16; do grep -Eq "\[#${id}\]" <<<"$A4_TODO_POST" && echo -n "$id=y " || echo -n "$id=n "; done)"
# A4b：其余15条（含易错的单数字 #9）从正文搬出、原样进归档且各恰好一次；保留的10条不进归档
ok=0
for id in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  grep -Eq "\[#${id}\]" <<<"$A4_TODO_POST" && ok=1
  line=$(grep -E "\[#${id}\]" <<<"$A4_TODO_BODY" | head -1)
  cnt=$(grep -Fx -- "$line" <<<"$A4_ARCH_TODO" | grep -c . || true); [ "${cnt:-0}" = "1" ] || ok=1
done
for id in 31b 30d 23 22 21 20 19 18 17 16; do grep -Eq "\[#${id}\]" <<<"$A4_ARCH_TODO" && ok=1; done
chk "$ok" "A4b #1-#15（含单数字 #9，防字符串排序把它误判成大数）搬出正文、原样进归档各恰好一次，保留的10条不进归档" \
  "#1..#15 不留正文、各在 Archived TODO 恰好1次；#16-#23/#30d/#31b 不进归档" "校验通过=$([ "$ok" = "0" ] && echo yes || echo no)"
# A4d：OPEN/部分完成/明确不做——不论编号多大，一条不动
ok=0
for id in 500 501 502 9999 10000; do grep -Eq "\[#${id}\]" <<<"$A4_TODO_POST" || ok=1; grep -Eq "\[#${id}\]" <<<"$A4_ARCH_TODO" && ok=1; done
chk "$ok" "A4d OPEN/部分完成/明确不做五条（含超大编号 #9999 #10000）原样留正文、不进归档" "五条全部仍在正文，一条都不在归档" \
  "校验通过=$([ "$ok" = "0" ] && echo yes || echo no)"
# A4e：TODO 段末尾指针行带「已归档最大编号」且数值=15（搬出批次里最大的编号）
A4_PTR=$(printf '%s\n' "$A4_TODO_POST" | awk 'NF{l=$0} END{print l}')
ok=0
case "$A4_PTR" in '（归档指针：'*) : ;; *) ok=1 ;; esac
printf '%s' "$A4_PTR" | grep -Eq '已归档最大编号[^0-9]*15([^0-9]|$)' || ok=1
chk "$ok" "A4e TODO 区末尾指针行带「已归档最大编号 #15」" "指针行以（归档指针： 开头，含「已归档最大编号」+ 数值15" "ptr=[$A4_PTR]"
# ============================== A5 ==============================
# 归档读不了（同名目录顶替，EISDIR/ENOTDIR）：progress.md 必须一字节不动，退出码1。这条只守
# "读不了就别动正文"——它在"算计划"前就先撞上加载归档的独立读失败，走不到"写→核对→写正文"那段
# （实测：把写归档/核对两处 catch 都改成吞掉错误，这条照样绿），顺序本身由 A5a/A5b 分别守。
# 打死：读归档失败被当成"归档不存在"处理，继续往下走。
A5_ROOT="$TMP/a5"; mkdir -p "$A5_ROOT"
A5_PROG="$A5_ROOT/progress.md"
build_progress "$A5_PROG" "$(gen_entries 60 "done" 0)" "$(gen_entries 50 notes 0)" "$(gen_entries 5 dec 0)" "$TODO_SMALL"
mkdir -p "$A5_ROOT/progress.archive.md"
A5_SHA_BEFORE=$(sha "$A5_PROG")
run_pa "$A5_ROOT"
ok=0; [ "$PA_RC" = "1" ] || ok=1; [ "$A5_SHA_BEFORE" = "$(sha "$A5_PROG")" ] || ok=1; [ -s "$PA_ERR" ] || ok=1
chk "$ok" "A5 归档读不了（同名目录顶替）：退出码1，progress.md 一字节不动，stderr非空" "rc=1，progress.md sha256 跑前跑后相同，stderr 非空" \
  "rc=$PA_RC sha相等=$([ "$A5_SHA_BEFORE" = "$(sha "$A5_PROG")" ] && echo yes || echo no) stderr头=[$(head -c160 "$PA_ERR" 2>/dev/null)]"
# A5a —— 顺序保护①：写归档那一步失败（PROGRESS_ARCHIVE_FAIL_AT=archive-write 注入）。
# 打死：「先删正文、后写归档」的旧顺序（事故根因）——归档写失败时正文已被裁剪，数据丢失。
A5A_ROOT="$TMP/a5a"; mkdir -p "$A5A_ROOT"
A5A_PROG="$A5A_ROOT/progress.md"; A5A_ARCH="$A5A_ROOT/progress.archive.md"
build_progress "$A5A_PROG" "$(gen_entries 5 "done" 0)" "$(gen_entries 5 notes 0)" "$(gen_entries 35 dec 0)" "$TODO_SMALL"  # 必须真超线，注入点才走得到
printf '# Archive（测试夹具）\n\n_Last updated: 2020-01-01_\n' > "$A5A_ARCH"
B5A1=$(sha "$A5A_PROG"); B5A2=$(sha "$A5A_ARCH")
PA_FAIL_AT=archive-write
run_pa "$A5A_ROOT"
PA_FAIL_AT=
ok=0; [ "$PA_RC" = "1" ] || ok=1; [ "$B5A1" = "$(sha "$A5A_PROG")" ] || ok=1; [ "$B5A2" = "$(sha "$A5A_ARCH")" ] || ok=1; [ -s "$PA_ERR" ] || ok=1
chk "$ok" "A5a 故障注入 archive-write：退出码1，stderr非空，progress.md 与归档两份文件都逐字节不变" \
  "rc=1，两份文件 sha256 跑前跑后相同，stderr 非空（说清是写归档这一步）" \
  "rc=$PA_RC prog相等=$([ "$B5A1" = "$(sha "$A5A_PROG")" ] && echo yes || echo no) arch相等=$([ "$B5A2" = "$(sha "$A5A_ARCH")" ] && echo yes || echo no) stderr头=[$(head -c160 "$PA_ERR" 2>/dev/null)]"
# A5b —— 顺序保护②：核对那一步失败（PROGRESS_ARCHIVE_FAIL_AT=verify 注入），此时归档已经真写完，
#   是安全的「两边都有」中间态；随后不带注入重跑必须能正常收尾且归档不出现重复。
A5B_ROOT="$TMP/a5b"; mkdir -p "$A5B_ROOT"
A5B_PROG="$A5B_ROOT/progress.md"; A5B_ARCH="$A5B_ROOT/progress.archive.md"
A5B_DEC=$(gen_entries 35 dec 0)
build_progress "$A5B_PROG" "$(gen_entries 5 "done" 0)" "$(gen_entries 5 notes 0)" "$A5B_DEC" "$TODO_SMALL"
B5B=$(sha "$A5B_PROG")
PA_FAIL_AT=verify
run_pa "$A5B_ROOT"
PA_FAIL_AT=
A5B_MOVED_WANT=$(printf '%s\n' "$A5B_DEC" | sed -n '25,$p' | norm)
ok=0; [ "$PA_RC" = "1" ] || ok=1; [ "$B5B" = "$(sha "$A5B_PROG")" ] || ok=1
[ "$(extract_block "$A5B_ARCH" '## Archived Decisions' | norm)" = "$A5B_MOVED_WANT" ] || ok=1
chk "$ok" "A5b 故障注入 verify：退出码1，progress.md 不变，但归档此时已写好要搬的条目（安全的「两边都有」态）" \
  "rc=1，progress.md sha256 不变，Archived Decisions 已恰等于第25-35条" \
  "rc=$PA_RC prog相等=$([ "$B5B" = "$(sha "$A5B_PROG")" ] && echo yes || echo no) 归档已含=$([ "$(extract_block "$A5B_ARCH" '## Archived Decisions' | norm)" = "$A5B_MOVED_WANT" ] && echo yes || echo no)"
run_pa "$A5B_ROOT"  # 不带注入重跑
A5B_KEPT_GOT=$(extract_block "$A5B_PROG" '## Decisions' | sed -n '1,24p')
A5B_KEPT_WANT=$(printf '%s\n' "$A5B_DEC" | sed -n '1,24p')
A5B_ARCH_AFTER=$(extract_block "$A5B_ARCH" '## Archived Decisions' | norm)
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$A5B_KEPT_GOT" = "$A5B_KEPT_WANT" ] || ok=1; [ "$A5B_ARCH_AFTER" = "$A5B_MOVED_WANT" ] || ok=1
chk "$ok" "A5b2 从 verify 失败的中间态不带注入重跑：rc=0，正文被正确精简，归档里没有重复条目" \
  "rc=0，Decisions 保留区=前24条，Archived Decisions 仍恰等于第25-35条（不重复）" \
  "rc=$PA_RC 保留相等=$([ "$A5B_KEPT_GOT" = "$A5B_KEPT_WANT" ] && echo yes || echo no) 归档相等=$([ "$A5B_ARCH_AFTER" = "$A5B_MOVED_WANT" ] && echo yes || echo no)"
# ============================== A6 ==============================
# 可续搬（打断后重跑，幂等）：归档里预先放好一部分要搬的条目（模拟上一轮写完归档、没删正文就被
# 打断），跑完后归档不重复、正文被正确精简；再跑第二遍是「没东西要搬」。
# 打死：①不去重导致归档条目重复；②续搬后正文未被正确裁剪；③第二遍重跑又误判「有东西要搬」。
A6_ROOT="$TMP/a6"; mkdir -p "$A6_ROOT"
A6_PROG="$A6_ROOT/progress.md"; A6_ARCH="$A6_ROOT/progress.archive.md"
A6_DONE_ENTRIES=$(gen_entries 60 "done" 0)
# Notes 也要给到50条（Done+Notes=110 才过合计100的触发线；只堆 Done 到60不够）。
build_progress "$A6_PROG" "$A6_DONE_ENTRIES" "$(gen_entries 50 notes 0)" "$(gen_entries 5 dec 0)" "$TODO_SMALL"
A6_PRESEED=$(printf '%s\n' "$A6_DONE_ENTRIES" | sed -n '36,45p')  # 预置第36-45条，模拟"上一轮写了归档没删正文"
{ printf '# Archive（测试夹具）\n\n_Last updated: 2020-01-01_\n\n## Archived Done\n%s\n' "$A6_PRESEED"; } > "$A6_ARCH"
run_pa "$A6_ROOT" --json
A6_ARCH_DONE=$(extract_block "$A6_ARCH" '## Archived Done')
A6_MOVED_WANT=$(printf '%s\n' "$A6_DONE_ENTRIES" | sed -n '36,$p' | norm | sort)
A6_GOT=$(printf '%s\n' "$A6_ARCH_DONE" | norm | sort)
# 按集合比（排序后比较）：契约只要求"批内相对顺序与正文一致"，没要求与"上一轮已写入的部分"合并后
# 严格连续——"新批整体插在既有条目之前"同样合规，过度按36..60顺序死抠属于测试本身写错。
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$A6_GOT" = "$A6_MOVED_WANT" ] || ok=1
for i in 36 40 45; do
  line=$(printf '%s\n' "$A6_DONE_ENTRIES" | sed -n "${i}p")
  cnt=$(grep -Fx -- "$line" <<<"$A6_ARCH_DONE" | grep -c . || true); [ "${cnt:-0}" = "1" ] || ok=1
done
chk "$ok" "A6a 续搬：预置的10条不重复，剩余15条补齐，Archived Done 最终恰为第36-60条各一次（集合比，不强求顺序）" \
  "rc=0；Archived Done（去空行、排序后比）恰等于 Done 第36-60条这个集合；抽查的预置行各恰好出现1次" "rc=$PA_RC 集合相等=$([ "$A6_GOT" = "$A6_MOVED_WANT" ] && echo yes || echo no)"
A6_DONE_POST=$(extract_block "$A6_PROG" '## Done')
A6_KEPT_GOT=$(printf '%s\n' "$A6_DONE_POST" | norm | sed -n '1,35p')
A6_KEPT_WANT=$(printf '%s\n' "$A6_DONE_ENTRIES" | sed -n '1,35p')
A6_LINES=$(printf '%s\n' "$A6_DONE_POST" | norm | grep -c '^- ' || true)
ok=0; [ "$A6_KEPT_GOT" = "$A6_KEPT_WANT" ] || ok=1; [ "${A6_LINES:-0}" = "35" ] || ok=1
chk "$ok" "A6b 续搬完成后正文 Done 区被正确精简为前35条（不多不少）" "保留区等于原第1-35条，正文条目恰好35条" \
  "保留区相等=$([ "$A6_KEPT_GOT" = "$A6_KEPT_WANT" ] && echo yes || echo no) 条目数=$A6_LINES"
B3=$(sha "$A6_PROG"); B4=$(sha "$A6_ARCH")
run_pa "$A6_ROOT" --json
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$(jf "$PA_OUT" nothingDue)" = "true" ] || ok=1
[ "$B3" = "$(sha "$A6_PROG")" ] || ok=1; [ "$B4" = "$(sha "$A6_ARCH")" ] || ok=1
chk "$ok" "A6c 续搬完成后重跑第二遍：nothingDue=true，两份文件不再变化（幂等）" "rc=0，JSON nothingDue=true，两份文件 sha256 跑前跑后相同" \
  "rc=$PA_RC nothingDue=$(jf "$PA_OUT" nothingDue) prog相等=$([ "$B3" = "$(sha "$A6_PROG")" ] && echo yes || echo no) arch相等=$([ "$B4" = "$(sha "$A6_ARCH")" ] && echo yes || echo no)"
# ============================== A7 ==============================
# 保护区：## Pinned 与契约没点名的其它区块逐字节不变；归档只增不删（原有的每一行都还在）。
# 打死：把 Pinned/自定义区块误当 Done/Notes 扫描改写；或写归档时覆盖/丢弃了归档里原本就有的内容。
A7_ROOT="$TMP/a7"; mkdir -p "$A7_ROOT"
A7_PROG="$A7_ROOT/progress.md"; A7_ARCH="$A7_ROOT/progress.archive.md"
A7_LINKS='- 占位链接 1：某个外部参考
- 占位链接 2：另一个外部参考'
build_progress "$A7_PROG" "$(gen_entries 60 "done" 0)" "$(gen_entries 50 notes 0)" "$(gen_entries 5 dec 0)" "$TODO_SMALL" "## Links" "$A7_LINKS"
A7_PINNED_BEFORE=$(extract_block "$A7_PROG" '## Pinned'); A7_LINKS_BEFORE=$(extract_block "$A7_PROG" '## Links')
{
  printf '# Archive（测试夹具）\n\n_Last updated: 2020-01-01_\n\n## Archived Done\n- 2019-01-01 done-entry-old-1 早先已归档的条目1\n\n'
  printf '## Archived Misc\n- 占位：一条与本次搬迁完全无关的既有归档记录\n'
} > "$A7_ARCH"
# 契约"不做"条款明文放行 `_Last updated:` 可更新为当天，排除在"原有的每一行都还在"断言之外。
A7_ORIG=$(grep -v '^[[:space:]]*$' "$A7_ARCH" | grep -v '^_Last updated:')
run_pa "$A7_ROOT"
ok=0; [ "$PA_RC" = "0" ] || ok=1
[ "$A7_PINNED_BEFORE" = "$(extract_block "$A7_PROG" '## Pinned')" ] || ok=1
[ "$A7_LINKS_BEFORE" = "$(extract_block "$A7_PROG" '## Links')" ] || ok=1
chk "$ok" "A7a ## Pinned 与契约没点名的自定义区块（## Links）逐字节不变" "两区块内容跑前跑后完全一致" "校验通过=$([ "$ok" = "0" ] && echo yes || echo no)"
ok=0
while IFS= read -r line; do [ -n "$line" ] || continue; grep -Fxq -- "$line" "$A7_ARCH" || ok=1; done <<<"$A7_ORIG"
chk "$ok" "A7b 归档文件只增不删：跑前已有的每一行，跑后仍然逐字存在" "归档里原有的所有非空行（含无关的 Archived Misc）跑后一条不少" \
  "校验通过=$([ "$ok" = "0" ] && echo yes || echo no)"
# ============================== A8 ==============================
# 行尾：CRLF 的 progress.md 跑完仍是 CRLF；LF 的不被静默改成 CRLF（TODO #73 同族问题在这条链路上
# 的对应版本）。打死：统一按 \n 读写、把 CRLF 源文件的行尾静默改成 LF（或反过来）。
A8_LF_ROOT="$TMP/a8lf"; A8_CRLF_ROOT="$TMP/a8crlf"; mkdir -p "$A8_LF_ROOT" "$A8_CRLF_ROOT"
A8_LF_PROG="$A8_LF_ROOT/progress.md"; A8_CRLF_PROG="$A8_CRLF_ROOT/progress.md"
build_progress "$A8_LF_PROG" "$(gen_entries 5 "done" 0)" "$(gen_entries 5 notes 0)" "$(gen_entries 35 dec 0)" "$TODO_SMALL"
sed 's/$/\r/' "$A8_LF_PROG" > "$A8_CRLF_PROG"
run_pa "$A8_LF_ROOT"; A8_LF_RC="$PA_RC"
run_pa "$A8_CRLF_ROOT"; A8_CRLF_RC="$PA_RC"
A8_TOTAL=$(wc -l < "$A8_CRLF_PROG" | tr -d ' '); A8_CR=$(grep -c $'\r$' "$A8_CRLF_PROG" || true)
ok=0; [ "$A8_CRLF_RC" = "0" ] || ok=1; [ "${A8_CR:-0}" = "$A8_TOTAL" ] || ok=1
chk "$ok" "A8a CRLF 的 progress.md 跑完仍是 CRLF（\\r 数=行数，没有被静默改成 LF）" "rc=0，每一行都以 \\r\\n 结尾" \
  "rc=$A8_CRLF_RC 总行数=$A8_TOTAL 带\\r的行数=$A8_CR"
A8_LF_CR=$(grep -c $'\r' "$A8_LF_PROG" || true)
ok=0; [ "$A8_LF_RC" = "0" ] || ok=1; [ "${A8_LF_CR:-0}" = "0" ] || ok=1
chk "$ok" "A8b LF 的 progress.md 跑完不被改成 CRLF" "rc=0，文件里不含任何 \\r 字符" "rc=$A8_LF_RC 含\\r的行数=$A8_LF_CR"
# ============================== A9 ==============================
# CLI 契约：--check 不写任何文件；未知参数退出码2且点名；progress.md 不存在时退出码0。
A9A_ROOT="$TMP/a9a"; mkdir -p "$A9A_ROOT"; A9A_PROG="$A9A_ROOT/progress.md"
build_progress "$A9A_PROG" "$(gen_entries 5 "done" 0)" "$(gen_entries 5 notes 0)" "$(gen_entries 35 dec 0)" "$TODO_SMALL"
A9A_SHA=$(sha "$A9A_PROG")
run_pa "$A9A_ROOT" --check --json
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$(sha "$A9A_PROG")" = "$A9A_SHA" ] || ok=1
[ ! -e "$A9A_ROOT/progress.archive.md" ] || ok=1; [ "$(jf "$PA_OUT" check)" = "true" ] || ok=1
chk "$ok" "A9a --check：即便有东西该搬（Decisions超线），也只算不写，两份文件都不动" "rc=0，progress.md sha256 不变，archive 不被创建，JSON check=true" \
  "rc=$PA_RC sha相等=$([ "$(sha "$A9A_PROG")" = "$A9A_SHA" ] && echo yes || echo no) archive存在=$([ -e "$A9A_ROOT/progress.archive.md" ] && echo yes || echo no) check=$(jf "$PA_OUT" check)"
A9B_ROOT="$TMP/a9b"; mkdir -p "$A9B_ROOT"
run_pa "$A9B_ROOT" --this-flag-does-not-exist
ok=0; [ "$PA_RC" = "2" ] || ok=1; grep -Fq -- "--this-flag-does-not-exist" "$PA_ERR" || ok=1
chk "$ok" "A9b 未知参数：退出码2，stderr 点名具体是哪个参数（本仓惯例）" "rc=2，stderr 含参数原文" "rc=$PA_RC stderr=[$(head -c200 "$PA_ERR" 2>/dev/null)]"
A9C_ROOT="$TMP/a9c"; mkdir -p "$A9C_ROOT"
run_pa "$A9C_ROOT"
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ ! -e "$A9C_ROOT/progress.archive.md" ] || ok=1
chk "$ok" "A9c progress.md 不存在：退出码0，不强造，不凭空创建 progress.archive.md" "rc=0，目标目录里不出现 progress.archive.md" \
  "rc=$PA_RC archive存在=$([ -e "$A9C_ROOT/progress.archive.md" ] && echo yes || echo no)"
# ============================== A10 ==============================
# 区块标题认法收紧（2026-09-20增补）：标题须整个等于目标名或紧跟全/半角括号才算，形似标题
# （"## TODO 归档说明"）不算。打死：前缀匹配（startsWith）——旧逻辑下它会先命中 "TODO" 这个
# kind，导致真正的 "## TODO" 反而被当成无关区块跳过、一条都不处理。
A10_ROOT="$TMP/a10"; mkdir -p "$A10_ROOT"
A10_PROG="$A10_ROOT/progress.md"
A10_DECOY='- [P1][DONE][#900]  这不是真TODO条目，是说明文字，不该被扫描
- [P1][完成][#901]  同上，形似已关闭TODO但不该被搬迁'
A10_REAL=$(gen_todo_closed 25)  # 25条顺编号已关闭，超20触发；保留16-25，搬出1-15
{
  printf '# progress（测试夹具）\n\n_Last updated: 2020-01-01_\n\n## Pinned\n- p\n\n'
  printf '## Done\n%s\n\n## Notes\n%s\n\n## Decisions\n%s\n\n' "$(gen_entries 5 "done" 0)" "$(gen_entries 5 notes 0)" "$(gen_entries 5 dec 0)"
  printf '## TODO 归档说明\n%s\n\n## TODO\n%s\n' "$A10_DECOY" "$A10_REAL"
} > "$A10_PROG"
A10_DECOY_BEFORE=$(extract_block "$A10_PROG" '## TODO 归档说明')
run_pa "$A10_ROOT"
A10_DECOY_AFTER=$(extract_block "$A10_PROG" '## TODO 归档说明')
A10_TODO_POST=$(extract_block "$A10_PROG" '## TODO')
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$A10_DECOY_BEFORE" = "$A10_DECOY_AFTER" ] || ok=1
for id in $(seq 16 25); do grep -Eq "\[#${id}\]" <<<"$A10_TODO_POST" || ok=1; done
for id in $(seq 1 15); do grep -Eq "\[#${id}\]" <<<"$A10_TODO_POST" && ok=1; done
chk "$ok" "A10 形似标题「## TODO 归档说明」不当 TODO 段扫描、逐字节不动；真「## TODO」照常按规则搬" \
  "rc=0；说明段跑前跑后逐字节相同；真TODO段编号16-25保留、1-15搬出" \
  "rc=$PA_RC 说明段不变=$([ "$A10_DECOY_BEFORE" = "$A10_DECOY_AFTER" ] && echo yes || echo no) 校验通过=$([ "$ok" = "0" ] && echo yes || echo no)"
# ============================== A11 ==============================
# 判重与核对同尺（2026-09-20增补）：归档预置一行，是某条待搬条目首行的前缀更长版（子串陷阱）。
# 打死：子串包含式判重——把真实条目当成"已经在归档里"而跳过插入，正文却仍照常删掉它，这行内容
# 从此哪里都找不到；核对步按整行比对会发现不了，下次重跑还会一直卡 rc=1。
A11_ROOT="$TMP/a11"; mkdir -p "$A11_ROOT"
A11_PROG="$A11_ROOT/progress.md"; A11_ARCH="$A11_ROOT/progress.archive.md"
A11_DEC=$(gen_entries 35 dec 0)
build_progress "$A11_PROG" "$(gen_entries 5 "done" 0)" "$(gen_entries 5 notes 0)" "$A11_DEC" "$TODO_SMALL"
A11_FIRST_MOVED=$(printf '%s\n' "$A11_DEC" | sed -n '25p')
A11_DECOY_LINE="${A11_FIRST_MOVED} （子串陷阱：更长但不是同一行）"
{ printf '# Archive（测试夹具）\n\n_Last updated: 2020-01-01_\n\n## Archived Decisions\n%s\n' "$A11_DECOY_LINE"; } > "$A11_ARCH"
run_pa "$A11_ROOT"
A11_ARCH_DEC=$(extract_block "$A11_ARCH" '## Archived Decisions')
A11_DEC_POST=$(extract_block "$A11_PROG" '## Decisions')
A11_CNT=$(grep -Fx -- "$A11_FIRST_MOVED" <<<"$A11_ARCH_DEC" | grep -c . || true)
ok=0; [ "$PA_RC" = "0" ] || ok=1
grep -Fxq -- "$A11_DECOY_LINE" <<<"$A11_ARCH_DEC" || ok=1  # 原有的长行必须还在（归档只增不删）
[ "${A11_CNT:-0}" = "1" ] || ok=1                          # 真实条目被完整插入，且恰好一次（不是0=丢了，不是2=重复）
grep -Fxq -- "$A11_FIRST_MOVED" <<<"$A11_DEC_POST" && ok=1 # 已经搬走，不留正文
chk "$ok" "A11a 归档里子串式的更长行不能顶替真实条目：该条目仍被完整插入归档、恰好一次，且已从正文搬出" \
  "rc=0；子串陷阱行仍在；真实条目在 Archived Decisions 恰好1次；正文不再含该条目" \
  "rc=$PA_RC 陷阱行还在=$(grep -Fxq -- "$A11_DECOY_LINE" <<<"$A11_ARCH_DEC" && echo yes || echo no) 真实条目次数=${A11_CNT:-0} 正文已删=$(grep -Fxq -- "$A11_FIRST_MOVED" <<<"$A11_DEC_POST" && echo no || echo yes)"
B11_1=$(sha "$A11_PROG"); B11_2=$(sha "$A11_ARCH")
run_pa "$A11_ROOT"
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$B11_1" = "$(sha "$A11_PROG")" ] || ok=1; [ "$B11_2" = "$(sha "$A11_ARCH")" ] || ok=1
chk "$ok" "A11b 再跑一遍无事可做：真实条目已在归档，不重复处理，两份文件不再变化" "rc=0，两份文件 sha256 跑前跑后相同" \
  "rc=$PA_RC prog相等=$([ "$B11_1" = "$(sha "$A11_PROG")" ] && echo yes || echo no) arch相等=$([ "$B11_2" = "$(sha "$A11_ARCH")" ] && echo yes || echo no)"
# ============================== A12 ==============================
# Pinned 封顶 15 只报不搬（TODO #91 同批）：recorder 模板是四空格缩进写法，夹具就用它。
# 打死：①只认顶层 `- ` 而缩进写法数成 0；②超线后顺手改了文件或改了退出码；③--check 下不报；
#   ④边界算错一位（15 条也报）。
build_pinned() {  # build_pinned <outfile> <n> —— n 条缩进写法 Pinned，其余各段没过线
  local out="$1" n="$2" i
  {
    printf '# progress（测试夹具）\n\n_Last updated: 2020-01-01_\n\n## Pinned（必守）\n'
    for i in $(seq 1 "$n"); do printf '    - 占位 Pinned %02d：192.168.0.%d:80%02d 这类环境事实\n' "$i" "$i" "$i"; done
    printf '\n## Done\n%s\n\n## TODO\n%s\n' "$(gen_entries 3 "done" 0)" "$TODO_SMALL"
  } > "$out"
}
A12_WARN='progress-archive: Pinned 16 条超封顶 15'
A12_ROOT="$TMP/a12"; mkdir -p "$A12_ROOT"; build_pinned "$A12_ROOT/progress.md" 16
B12=$(sha "$A12_ROOT/progress.md")
run_pa "$A12_ROOT"; A12_RC="$PA_RC"; A12_HIT=$(grep -cF -- "$A12_WARN" "$PA_OUT" || true)
run_pa "$A12_ROOT" --check; A12_CRC="$PA_RC"; A12_CHIT=$(grep -cF -- "$A12_WARN" "$PA_OUT" || true)
ok=0; [ "$A12_RC" = "0" ] && [ "$A12_CRC" = "0" ] || ok=1; [ "$A12_HIT" = "1" ] && [ "$A12_CHIT" = "1" ] || ok=1
[ "$(sha "$A12_ROOT/progress.md")" = "$B12" ] || ok=1
chk "$ok" "A12a Pinned 16 条（四空格缩进写法）→ stdout 恰一行超封顶告警（含 --check），退出码仍 0，文件不动" \
  "两次 rc=0；告警行各 1 次；progress.md sha256 不变" \
  "rc=$A12_RC/check rc=$A12_CRC 告警=$A12_HIT/$A12_CHIT 文件不变=$([ "$(sha "$A12_ROOT/progress.md")" = "$B12" ] && echo yes || echo no)"
A12B_ROOT="$TMP/a12b"; mkdir -p "$A12B_ROOT"; build_pinned "$A12B_ROOT/progress.md" 15
run_pa "$A12B_ROOT"; A12B_HIT=$(grep -cF -- '超封顶' "$PA_OUT" "$PA_ERR" | awk -F: '{s+=$NF} END{print s+0}')
ok=0; [ "$PA_RC" = "0" ] || ok=1; [ "$A12B_HIT" = "0" ] || ok=1
chk "$ok" "A12b Pinned 恰 15 条 → 不报（封顶是「超过」才响）" "rc=0；stdout/stderr 无超封顶字样" "rc=$PA_RC 命中=$A12B_HIT"
printf '==== test-progress-archive：PASS=%s FAIL=%s ====\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
