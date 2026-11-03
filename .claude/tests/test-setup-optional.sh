#!/usr/bin/env bash
# risk: high
# test-setup-optional.sh — 可选包（--with-tests / --with-harness，ps1 对等 -WithTests / -WithHarness）
#   绕过主循环三层保护的回归（progress.md TODO #74，2026-09-19 审查实测）：copy_claude_tree 的主循环
#   对已存在且被用户改过的文件走 manifest 分层（不覆盖、落 .framework-new），走四份排除表
#   （@exclusions:begin...end），且 rules/*.md 只收顶层；--with-tests/--with-harness 两支线各自
#   另起一段 find，逐文件直接 copy_file/Copy-Item，不经过上面任何一层。
# 契约（progress.md TODO #81 / #82，按它写断言，实现归 implementer，不预设修法）：
#   ①目标已存在且内容不同：与主循环 copy_claude_tree 的 manifest 分层判定完全对等——已改过的、
#     或目标从没装过这份可选包（查不到历史记录）不覆盖、落 .framework-new，不再留 .bak 后覆盖；
#     src 升级但用户没碰过目标（历史记录里的 sha 与目标当前 sha 一致）照常 update，新文件
#     create，相同内容 skip；dry-run 报的动作名与主循环同一套词表（create/update/skip/conflict）。
#     "未改过"这个判断要成立，可选包必须在目标侧自己有一份历史记录可查——tests/*、harness/ext/*
#     有意不进 FRAMEWORK-MANIFEST.txt（gen-manifest.sh 的排除表，那是主循环清单的口径，不因为
#     可选包要用就去改），所以这份历史记录是可选包在目标侧另开的一份账（收口 reviewer HIGH-1：
#     此前没有这份账，old_sha 永远查不到，update 分支是死代码，src 升级、用户没碰过的文件也被
#     当成用户改过处理，dry-run 里两种情况报的动词一样，用户分不清）。
#   ②排除表照用：.DS_Store / *.bak / state/* 不拷，且这份判定本身来自 gen-exclusions.mjs 生成块
#     （harness/exclusions.json 加一条、重跑生成器，可选包立刻认得，不用改安装器代码）
#   ③harness/ext/rules/ 只顶层 .md 进 rules/，嵌套目录里的不压平、两侧一致
#   ④默认（不带开关）行为不变
# 本文件只锁「修好后应成立」的行为，不改安装器（tester 不是安装器作者），也不预设"目标侧账本"
# 具体落在哪个文件、什么格式——那是 implementer 的修法，本文件只从外部观察行为断言。
# R1（不覆盖 + 落 .framework-new）现状：实现前 sh 侧 copy_file 会先 .bak 再覆盖（留了痕迹但改动
#   已经不在原地了），ps1 侧 Copy-Item -Force 连 .bak 都不留、真实不可逆丢失。这组锁的是修好后
#   两侧都必须"不覆盖"（用户改动原样留在 live 文件里）且"落 .framework-new"（新版本单独放一份，
#   不含用户改动），.bak 不该再出现——出现了说明走的还是旧的覆盖路径。
# R2（dry-run 动作名·冲突态）：对 R1 场景里那个已经不再一致的文件，dry-run 必须报 conflict（不是
#   create——它已存在；也不是 skip——它确实跟框架源不一致），与主循环 plan_note 用同一个词。
# R3（排除表）两侧都锁：.DS_Store / *.bak / state/y 不拷。
# R4（rules 顶层限定）只 sh 有过红：case "$rel" in harness/ext/rules/*.md) 的 * 在 bash case 里
#   跨 /，会把 rules/nested/z.md 压平成 rules/z.md；ps1 侧 [^/]+ 正则本就不跨 /，现状已经对——标
#   防回归位。
# R5（默认不装）两侧防回归：不带开关时两条支线各自的 if 判断不生效，行为不该被这次改动带坏。
# R6（排除判定来自生成块，不是手写死表）：往 exclusions.json 临时加一条新排除项、重新生成
#   （只在拷贝的 $SRC 里跑，不碰本仓），可选包装出时新探针文件必须被排除——这条如果红，说明
#   is_optional_excluded / Test-OptionalExcluded 还在读一份手写表，没有真的从生成块取数据。
# R7（dry-run 动作名·安全升级态，reviewer HIGH-1 红锁）：只改 SRC 里的探针文件（模拟框架发新版），
#   不碰目标里已装的那份，dry-run 必须报 update；同一次 dry-run 里 R1/R2 那个真被用户改过的文件
#   仍报 conflict——两个动词要在同一条日志里各自准确，不能靠"反正都不是 create"蒙混。真装一次后
#   目标内容要变成 src 的新版本、且不许落 .framework-new（那是 conflict 专属）。这条红的时候，
#   红因应该是"报了 conflict 而不是 update"或"目标没跟着更新"，不是夹具本身出错。
#
# 夹具：把本仓 setup.sh / setup.ps1 / .claude 整棵拷进 mktemp 当源（git ls-files，天然跳过
#   .claude/worktrees），在拷贝里种 R3/R4 的诱饵文件——对本仓只读，安装目标另开 mktemp。
# ps1 臂靠 command -v pwsh 现查现判，缺席打 [SKIP]（判「跑没跑过」查账本别查记忆——本机 2026-09
#   起实测在场，不假定，也不硬赌）。
# 独立 PASS/FAIL 计数，不 fail-fast：同一类缺陷（数据丢失/dry-run/排除表/rules）要一次性把红因全亮出来，
#   不能撞见第一条就退出，那样后面几条的红因永远看不见。
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
[ -f "$ROOT/setup.sh" ]  || { echo "test-setup-optional: 仓库根缺 setup.sh：$ROOT" >&2; exit 1; }
[ -f "$ROOT/setup.ps1" ] || { echo "test-setup-optional: 仓库根缺 setup.ps1：$ROOT" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
SKIPN=0
chk() {  # chk <0=通过/非0=失败> <标题> <EXPECT> <GOT>
  if [ "$1" = "0" ]; then
    PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$2"
  else
    FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$2"
  fi
  printf '         EXPECT %s\n' "$3"
  printf '         GOT    %s\n' "$4"
}
sk() { SKIPN=$((SKIPN + 1)); printf '  [SKIP] %s\n' "$1"; }

echo "===== test-setup-optional ====="

# ---- 夹具：拷源，只读本仓 ----
SRC="$TMP/src"
mkdir -p "$SRC"
cp "$ROOT/setup.sh" "$SRC/setup.sh"
cp "$ROOT/setup.ps1" "$SRC/setup.ps1"
(cd "$ROOT" && git ls-files -z --cached --others --exclude-standard -- .claude | tar --null -T - -cf -) \
  | (cd "$SRC" && tar -xf -) \
  || { echo "test-setup-optional: 拷贝源 .claude 失败" >&2; exit 1; }
[ -d "$SRC/.claude/harness/ext" ] || { echo "test-setup-optional: 源仓缺 .claude/harness/ext，无法造夹具" >&2; exit 1; }

# R3/R4 诱饵：DS_Store / *.bak / state/y / 嵌套 rules（种进拷贝的源，不碰本仓）
mkdir -p "$SRC/.claude/harness/ext/state"
: > "$SRC/.claude/harness/ext/.DS_Store"
: > "$SRC/.claude/harness/ext/x.bak"
: > "$SRC/.claude/harness/ext/state/y"
mkdir -p "$SRC/.claude/harness/ext/rules/nested"
printf '# nested doc（应留在 nested/ 里，不许压平进 rules/）\n' > "$SRC/.claude/harness/ext/rules/nested/z.md"

MARK_FILE="harness/ext/catalog.mjs"   # 主循环之外确定存在、非二进制的探针文件
[ -f "$SRC/.claude/$MARK_FILE" ] || { echo "test-setup-optional: 源缺探针文件 .claude/$MARK_FILE" >&2; exit 1; }

# ==================== sh 臂 ====================
T1="$TMP/target-sh"
RC1=0
bash "$SRC/setup.sh" --with-harness "$T1" >"$TMP/sh-install1.log" 2>&1 || RC1=$?
WIN_ROUTED=0
grep -q "cc-base setup (Windows/.ps1)" "$TMP/sh-install1.log" 2>/dev/null && WIN_ROUTED=1

if [ "$RC1" != "0" ] || [ "$WIN_ROUTED" = "1" ]; then
  sk "sh 臂整组：首次 --with-harness 安装 rc=$RC1 路由到ps1=${WIN_ROUTED}（见 $TMP/sh-install1.log；本机预期走 .sh 直装路径，非零多半是环境问题不是本文件要锁的缺陷）"
else
  CL1="$T1/.claude"

  # ---- R3：DS_Store / *.bak / state/y 不许被拷进目标 ----
  ok=0; [ ! -e "$CL1/harness/ext/.DS_Store" ] || ok=1
  chk "$ok" "R3a(sh) harness/ext/.DS_Store 不进安装产物" \
    "不存在（同 .claude/harness/exclusions.json 的 */.DS_Store 臂）" \
    "存在=$([ -e "$CL1/harness/ext/.DS_Store" ] && echo yes || echo no)"

  ok=0; [ ! -e "$CL1/harness/ext/x.bak" ] || ok=1
  chk "$ok" "R3b(sh) harness/ext/x.bak 不进安装产物" \
    "不存在（同 exclusions.json 的 *.bak 臂——它本是安装器自己产物的排除项，不该被可选包绕开）" \
    "存在=$([ -e "$CL1/harness/ext/x.bak" ] && echo yes || echo no)"

  ok=0; [ ! -e "$CL1/harness/ext/state/y" ] || ok=1
  chk "$ok" "R3c(sh) harness/ext/state/y 不进安装产物" \
    "不存在（运行态子目录不该整目录跟着 harness/ext/ 一起装出去）" \
    "存在=$([ -e "$CL1/harness/ext/state/y" ] && echo yes || echo no)"

  # ---- R4：rules/ 只收顶层 .md，嵌套目录不压平；原文件仍照常落在 harness/ext/rules/nested/ ----
  ok=0; [ ! -e "$CL1/rules/z.md" ] || ok=1
  chk "$ok" "R4a(sh) 嵌套 rules/nested/z.md 不许被压平进 .claude/rules/z.md" \
    "不存在（bash case 的 harness/ext/rules/*.md 臂里 * 跨 / 是红因所在）" \
    "存在=$([ -e "$CL1/rules/z.md" ] && echo yes || echo no)"

  ok=0; [ -f "$CL1/harness/ext/rules/nested/z.md" ] || ok=1
  chk "$ok" "R4b(sh) 嵌套文件本身仍原样落在 harness/ext/rules/nested/z.md（防止把 R4a 的修法连累成整体不装）" \
    "存在" "存在=$([ -f "$CL1/harness/ext/rules/nested/z.md" ] && echo yes || echo no)"

  # ---- R1：用户改过 harness/ext/catalog.mjs 后重装，不许覆盖，必须落 .framework-new ----
  MARKER="// test-setup-optional user edit marker sh $$"
  printf '%s\n' "$MARKER" >> "$CL1/$MARK_FILE"
  RC2=0
  bash "$SRC/setup.sh" --with-harness "$T1" >"$TMP/sh-install2.log" 2>&1 || RC2=$?
  ok=0; [ "$RC2" = "0" ] || ok=1
  chk "$ok" "R1 前置(sh) 二次安装本身应成功" "rc=0" "rc=$RC2"

  LIVE_HAS=no; grep -qF -- "$MARKER" "$CL1/$MARK_FILE" 2>/dev/null && LIVE_HAS=yes
  ok=0; [ "$LIVE_HAS" = "yes" ] || ok=1
  chk "$ok" "R1a(sh) 用户改动重装后必须原样留在 live 文件里，不许被覆盖（契约①：与主循环对等）" \
    "改动仍在 \$MARK_FILE 里" "live含改动=$LIVE_HAS"

  FN_HAS_MARKER=no
  [ -f "$CL1/$MARK_FILE.framework-new" ] && grep -qF -- "$MARKER" "$CL1/$MARK_FILE.framework-new" 2>/dev/null && FN_HAS_MARKER=yes
  ok=0; [ -f "$CL1/$MARK_FILE.framework-new" ] && [ "$FN_HAS_MARKER" = "no" ] || ok=1
  chk "$ok" "R1b(sh) 落 \$MARK_FILE.framework-new，且内容是框架源（不含用户改动）——供手工合并" \
    "存在且不含 marker（marker 应该只在 live 文件里，不该也混进 framework-new）" \
    "framework-new存在=$([ -f "$CL1/$MARK_FILE.framework-new" ] && echo yes || echo no) 内容含marker=$FN_HAS_MARKER"

  ok=0; [ ! -f "$CL1/$MARK_FILE.bak" ] || ok=1
  chk "$ok" "R1c(sh) 不再留 .bak 后覆盖（改用 conflict→.framework-new，不覆盖 live 文件就不需要 .bak 了）" \
    "不存在 \$MARK_FILE.bak" \
    "存在=$([ -f "$CL1/$MARK_FILE.bak" ] && echo yes || echo no)"

  # ---- R2：live 文件与框架源仍不一致（R1 没覆盖它），dry-run 必须报 conflict ----
  RC3=0
  bash "$SRC/setup.sh" --dry-run --with-harness "$T1" >"$TMP/sh-dry.log" 2>&1 || RC3=$?
  ok=0; [ "$RC3" = "0" ] || ok=1
  chk "$ok" "R2 前置(sh) dry-run 本身应成功" "rc=0" "rc=$RC3"

  DRY_LINE=$(grep -E "\\.claude/$MARK_FILE\$" "$TMP/sh-dry.log" | head -1 || true)
  DRY_ACTION=$(printf '%s' "$DRY_LINE" | awk '{print $1}')
  ok=1; [ "$DRY_ACTION" = "conflict" ] && ok=0
  chk "$ok" "R2(sh) 对用户改过、且查不到 manifest 历史记录的可选包文件，dry-run 必须报 conflict（与主循环 plan_note 同一词表，不是 create 也不是 skip）" \
    "conflict" \
    "动作=[${DRY_ACTION:-<未找到该行>}] 原始行=[$DRY_LINE]"

  # ---- R7：src 升级、用户没碰过目标——必须 update，不是 conflict（收口 reviewer HIGH-1）----
  # UPGRADE_FILE 与 MARK_FILE 是两个不同探针：MARK_FILE 这时已经处于"用户改过"状态（R1/R2 占用），
  # 这里用另一个从没被本文件碰过的文件模拟"框架发新版本、用户没动过目标里那份"。
  UPGRADE_FILE="harness/ext/graph.mjs"
  [ -f "$SRC/.claude/$UPGRADE_FILE" ] || { echo "test-setup-optional: 源缺探针文件 .claude/$UPGRADE_FILE" >&2; exit 1; }
  UPGRADE_MARK="// test-setup-optional R7 upgrade marker sh $$"
  printf '%s\n' "$UPGRADE_MARK" >> "$SRC/.claude/$UPGRADE_FILE"   # 只改 SRC（模拟框架下一版），不碰 T1 里已装的那份

  RC4=0
  bash "$SRC/setup.sh" --dry-run --with-harness "$T1" >"$TMP/sh-dry2.log" 2>&1 || RC4=$?
  ok=0; [ "$RC4" = "0" ] || ok=1
  chk "$ok" "R7 前置(sh) 第二次 dry-run（src 升级后）本身应成功" "rc=0" "rc=$RC4"

  UP_DRY_LINE=$(grep -E "\\.claude/$UPGRADE_FILE\$" "$TMP/sh-dry2.log" | head -1 || true)
  UP_DRY_ACTION=$(printf '%s' "$UP_DRY_LINE" | awk '{print $1}')
  ok=1; [ "$UP_DRY_ACTION" = "update" ] && ok=0
  chk "$ok" "R7a(sh) src 升级、用户没碰过目标里的对应文件——dry-run 必须报 update（不是 conflict：老实现里 old_sha 永远查不到，这里必须区分开）" \
    "update" "动作=[${UP_DRY_ACTION:-<未找到该行>}] 原始行=[$UP_DRY_LINE]"

  MARK_DRY_LINE2=$(grep -E "\\.claude/$MARK_FILE\$" "$TMP/sh-dry2.log" | head -1 || true)
  MARK_DRY_ACTION2=$(printf '%s' "$MARK_DRY_LINE2" | awk '{print $1}')
  ok=1; [ "$MARK_DRY_ACTION2" = "conflict" ] && ok=0
  chk "$ok" "R7b(sh) 同一次 dry-run 里，用户真改过的 \$MARK_FILE 仍报 conflict——同一条日志里 update 与 conflict 两个动词必须区分开，不是巧合" \
    "conflict" "动作=[${MARK_DRY_ACTION2:-<未找到该行>}] 原始行=[$MARK_DRY_LINE2]"

  RC5R=0
  bash "$SRC/setup.sh" --with-harness "$T1" >"$TMP/sh-install3.log" 2>&1 || RC5R=$?
  ok=0; [ "$RC5R" = "0" ] || ok=1
  chk "$ok" "R7 前置(sh) 真装（应用 update）本身应成功" "rc=0" "rc=$RC5R"

  ok=0; cmp -s "$SRC/.claude/$UPGRADE_FILE" "$CL1/$UPGRADE_FILE" || ok=1
  chk "$ok" "R7c(sh) update 真落盘：目标内容变成 src 的新版本（不是停在旧内容不动）" \
    "目标与 src 字节相同" \
    "相同=$(cmp -s "$SRC/.claude/$UPGRADE_FILE" "$CL1/$UPGRADE_FILE" && echo yes || echo no)"

  ok=0; [ ! -f "$CL1/$UPGRADE_FILE.framework-new" ] || ok=1
  chk "$ok" "R7d(sh) update 场景不许落 .framework-new（那是 conflict 专属，update 应该干净覆盖）" \
    "不存在 \$UPGRADE_FILE.framework-new" \
    "存在=$([ -f "$CL1/$UPGRADE_FILE.framework-new" ] && echo yes || echo no)"
fi

# ---- R5：默认安装（不带任何 --with-*）不含 harness/ext/ 与 tests/（防回归，两条排除臂不该被带坏）----
T5="$TMP/target-sh-default"
RC5=0
bash "$SRC/setup.sh" "$T5" >"$TMP/sh-install5.log" 2>&1 || RC5=$?
if [ "$RC5" != "0" ]; then
  sk "R5(sh) 默认安装本身失败（rc=${RC5}，见 $TMP/sh-install5.log），跳过防回归判定"
else
  ok=0; [ ! -e "$T5/.claude/harness/ext" ] || ok=1
  chk "$ok" "R5a(sh) 默认安装不含 .claude/harness/ext/" \
    "不存在" "存在=$([ -e "$T5/.claude/harness/ext" ] && echo yes || echo no)"
  ok=0; [ ! -e "$T5/.claude/tests" ] || ok=1
  chk "$ok" "R5b(sh) 默认安装不含 .claude/tests/" \
    "不存在" "存在=$([ -e "$T5/.claude/tests" ] && echo yes || echo no)"
fi

# ==================== ps1 臂（本机现查现判，缺 pwsh 打 SKIP 不假绿）====================
if ! command -v pwsh >/dev/null 2>&1; then
  sk "ps1 臂整组：无 pwsh（本机 2026-09 起实测在场，判「跑没跑过」查账本不查记忆——这里现场再查一次不赌旧结论）"
else
  T1P="$TMP/target-ps"
  RC1P=0
  pwsh -NoProfile -ExecutionPolicy Bypass -File "$SRC/setup.ps1" -Target "$T1P" -WithHarness \
    >"$TMP/ps-install1.log" 2>&1 || RC1P=$?
  if [ "$RC1P" != "0" ]; then
    sk "ps1 臂整组：首次 -WithHarness 安装 rc=${RC1P}（见 $TMP/ps-install1.log，多半是本机 pwsh 环境问题不是本文件要锁的缺陷）"
  else
    CL1P="$T1P/.claude"

    ok=0; [ ! -e "$CL1P/harness/ext/.DS_Store" ] || ok=1
    chk "$ok" "R3a(ps1) harness/ext/.DS_Store 不进安装产物" \
      "不存在" "存在=$([ -e "$CL1P/harness/ext/.DS_Store" ] && echo yes || echo no)"
    ok=0; [ ! -e "$CL1P/harness/ext/x.bak" ] || ok=1
    chk "$ok" "R3b(ps1) harness/ext/x.bak 不进安装产物" \
      "不存在" "存在=$([ -e "$CL1P/harness/ext/x.bak" ] && echo yes || echo no)"
    ok=0; [ ! -e "$CL1P/harness/ext/state/y" ] || ok=1
    chk "$ok" "R3c(ps1) harness/ext/state/y 不进安装产物" \
      "不存在" "存在=$([ -e "$CL1P/harness/ext/state/y" ] && echo yes || echo no)"

    ok=0; [ ! -e "$CL1P/rules/z.md" ] || ok=1
    chk "$ok" "R4a(ps1)-防回归位 嵌套 rules/nested/z.md 不许被压平进 .claude/rules/z.md（ps1 现状本就不压平，别读成已经按本次要求修好）" \
      "不存在" "存在=$([ -e "$CL1P/rules/z.md" ] && echo yes || echo no)"
    ok=0; [ -f "$CL1P/harness/ext/rules/nested/z.md" ] || ok=1
    chk "$ok" "R4b(ps1) 嵌套文件本身仍原样落在 harness/ext/rules/nested/z.md" \
      "存在" "存在=$([ -f "$CL1P/harness/ext/rules/nested/z.md" ] && echo yes || echo no)"

    MARKER_P="// test-setup-optional user edit marker ps $$"
    printf '%s\n' "$MARKER_P" >> "$CL1P/$MARK_FILE"
    RC2P=0
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$SRC/setup.ps1" -Target "$T1P" -WithHarness \
      >"$TMP/ps-install2.log" 2>&1 || RC2P=$?
    ok=0; [ "$RC2P" = "0" ] || ok=1
    chk "$ok" "R1 前置(ps1) 二次安装本身应成功" "rc=0" "rc=$RC2P"

    LIVE_HAS_P=no; grep -qF -- "$MARKER_P" "$CL1P/$MARK_FILE" 2>/dev/null && LIVE_HAS_P=yes
    ok=0; [ "$LIVE_HAS_P" = "yes" ] || ok=1
    chk "$ok" "R1a(ps1) 用户改动重装后必须原样留在 live 文件里，不许被覆盖（契约①：与主循环对等）" \
      "改动仍在 \$MARK_FILE 里" "live含改动=$LIVE_HAS_P"

    FN_HAS_MARKER_P=no
    [ -f "$CL1P/$MARK_FILE.framework-new" ] && grep -qF -- "$MARKER_P" "$CL1P/$MARK_FILE.framework-new" 2>/dev/null && FN_HAS_MARKER_P=yes
    ok=0; [ -f "$CL1P/$MARK_FILE.framework-new" ] && [ "$FN_HAS_MARKER_P" = "no" ] || ok=1
    chk "$ok" "R1b(ps1) 落 \$MARK_FILE.framework-new，且内容是框架源（不含用户改动）——供手工合并" \
      "存在且不含 marker" \
      "framework-new存在=$([ -f "$CL1P/$MARK_FILE.framework-new" ] && echo yes || echo no) 内容含marker=$FN_HAS_MARKER_P"

    ok=0; [ ! -f "$CL1P/$MARK_FILE.bak" ] || ok=1
    chk "$ok" "R1c(ps1) 不再留 .bak 后覆盖（此前 ps1 是 Copy-Item -Force 连 .bak 都不留，现在改用 conflict→.framework-new，不覆盖就不需要 .bak）" \
      "不存在 \$MARK_FILE.bak" \
      "存在=$([ -f "$CL1P/$MARK_FILE.bak" ] && echo yes || echo no)"

    RC3P=0
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$SRC/setup.ps1" -Target "$T1P" -WithHarness -DryRun \
      >"$TMP/ps-dry.log" 2>&1 || RC3P=$?
    ok=0; [ "$RC3P" = "0" ] || ok=1
    chk "$ok" "R2 前置(ps1) dry-run 本身应成功" "rc=0" "rc=$RC3P"

    DRY_LINE_P=$(grep -E "\\.claude/$MARK_FILE\$" "$TMP/ps-dry.log" | head -1 || true)
    DRY_ACTION_P=$(printf '%s' "$DRY_LINE_P" | awk '{print $1}')
    ok=1; [ "$DRY_ACTION_P" = "conflict" ] && ok=0
    chk "$ok" "R2(ps1) 对用户改过、且查不到 manifest 历史记录的可选包文件，dry-run 必须报 conflict（与主循环 Add-Plan 同一词表）" \
      "conflict" \
      "动作=[${DRY_ACTION_P:-<未找到该行>}] 原始行=[$DRY_LINE_P]"

    # ---- R7：src 升级、用户没碰过目标——必须 update，不是 conflict（收口 reviewer HIGH-1）----
    UPGRADE_FILE_P="harness/ext/graph.mjs"
    [ -f "$SRC/.claude/$UPGRADE_FILE_P" ] || { echo "test-setup-optional: 源缺探针文件 .claude/$UPGRADE_FILE_P" >&2; exit 1; }
    UPGRADE_MARK_P="// test-setup-optional R7 upgrade marker ps $$"
    printf '%s\n' "$UPGRADE_MARK_P" >> "$SRC/.claude/$UPGRADE_FILE_P"

    RC4P=0
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$SRC/setup.ps1" -Target "$T1P" -WithHarness -DryRun \
      >"$TMP/ps-dry2.log" 2>&1 || RC4P=$?
    ok=0; [ "$RC4P" = "0" ] || ok=1
    chk "$ok" "R7 前置(ps1) 第二次 dry-run（src 升级后）本身应成功" "rc=0" "rc=$RC4P"

    UP_DRY_LINE_P=$(grep -E "\\.claude/$UPGRADE_FILE_P\$" "$TMP/ps-dry2.log" | head -1 || true)
    UP_DRY_ACTION_P=$(printf '%s' "$UP_DRY_LINE_P" | awk '{print $1}')
    ok=1; [ "$UP_DRY_ACTION_P" = "update" ] && ok=0
    chk "$ok" "R7a(ps1) src 升级、用户没碰过目标里的对应文件——dry-run 必须报 update（不是 conflict）" \
      "update" "动作=[${UP_DRY_ACTION_P:-<未找到该行>}] 原始行=[$UP_DRY_LINE_P]"

    MARK_DRY_LINE2_P=$(grep -E "\\.claude/$MARK_FILE\$" "$TMP/ps-dry2.log" | head -1 || true)
    MARK_DRY_ACTION2_P=$(printf '%s' "$MARK_DRY_LINE2_P" | awk '{print $1}')
    ok=1; [ "$MARK_DRY_ACTION2_P" = "conflict" ] && ok=0
    chk "$ok" "R7b(ps1) 同一次 dry-run 里，用户真改过的 \$MARK_FILE 仍报 conflict——update 与 conflict 两个动词必须区分开" \
      "conflict" "动作=[${MARK_DRY_ACTION2_P:-<未找到该行>}] 原始行=[$MARK_DRY_LINE2_P]"

    RC5RP=0
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$SRC/setup.ps1" -Target "$T1P" -WithHarness \
      >"$TMP/ps-install3.log" 2>&1 || RC5RP=$?
    ok=0; [ "$RC5RP" = "0" ] || ok=1
    chk "$ok" "R7 前置(ps1) 真装（应用 update）本身应成功" "rc=0" "rc=$RC5RP"

    ok=0; cmp -s "$SRC/.claude/$UPGRADE_FILE_P" "$CL1P/$UPGRADE_FILE_P" || ok=1
    chk "$ok" "R7c(ps1) update 真落盘：目标内容变成 src 的新版本" \
      "目标与 src 字节相同" \
      "相同=$(cmp -s "$SRC/.claude/$UPGRADE_FILE_P" "$CL1P/$UPGRADE_FILE_P" && echo yes || echo no)"

    ok=0; [ ! -f "$CL1P/$UPGRADE_FILE_P.framework-new" ] || ok=1
    chk "$ok" "R7d(ps1) update 场景不许落 .framework-new" \
      "不存在 \$UPGRADE_FILE_P.framework-new" \
      "存在=$([ -f "$CL1P/$UPGRADE_FILE_P.framework-new" ] && echo yes || echo no)"
  fi

  T5P="$TMP/target-ps-default"
  RC5P=0
  pwsh -NoProfile -ExecutionPolicy Bypass -File "$SRC/setup.ps1" -Target "$T5P" >"$TMP/ps-install5.log" 2>&1 || RC5P=$?
  if [ "$RC5P" != "0" ]; then
    sk "R5(ps1) 默认安装本身失败（rc=${RC5P}，见 $TMP/ps-install5.log），跳过防回归判定"
  else
    ok=0; [ ! -e "$T5P/.claude/harness/ext" ] || ok=1
    chk "$ok" "R5a(ps1) 默认安装不含 .claude/harness/ext/" \
      "不存在" "存在=$([ -e "$T5P/.claude/harness/ext" ] && echo yes || echo no)"
    ok=0; [ ! -e "$T5P/.claude/tests" ] || ok=1
    chk "$ok" "R5b(ps1) 默认安装不含 .claude/tests/" \
      "不存在" "存在=$([ -e "$T5P/.claude/tests" ] && echo yes || echo no)"
  fi
fi

# ==================== R6：排除判定来自生成块，不是安装器手写死表 ====================
# 往拷贝里的 exclusions.json 加一条新排除项，用 gen-exclusions.mjs 重新生成（只碰 ${SRC}，不碰
# 本仓），装一个全新目标验证可选包立刻认得——不用改 setup.sh / setup.ps1 一行代码。
if ! command -v node >/dev/null 2>&1; then
  sk "R6 整组：无 node，gen-exclusions.mjs 本身需要 node，这条锁不了"
else
  R6_EXCL="$SRC/.claude/harness/exclusions.json"
  R6_GEN="$SRC/.claude/scripts/gen-exclusions.mjs"
  R6ADD_RC=0
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.entries.push({
      pattern: "*.optcanary",
      keep: false,
      mainTree: false,
      optionalLeaf: true,
      note: "test-setup-optional R6 探针：验证可选包排除判定来自生成块",
      ps1: { optionalToken: "\\.optcanary$" }
    });
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  ' "$R6_EXCL" >"$TMP/r6-add.log" 2>&1 || R6ADD_RC=$?
  if [ "$R6ADD_RC" != "0" ]; then
    sk "R6 整组：往拷贝的 exclusions.json 加探针条目失败（见 $TMP/r6-add.log）"
  else
    R6GEN_RC=0
    node "$R6_GEN" >"$TMP/r6-gen.log" 2>&1 || R6GEN_RC=$?
    if [ "$R6GEN_RC" != "0" ]; then
      sk "R6 整组：gen-exclusions.mjs 重跑失败（rc=${R6GEN_RC}，见 $TMP/r6-gen.log），无法验证生成块联动"
    else
      : > "$SRC/.claude/harness/ext/canary.optcanary"
      T6="$TMP/target-sh-r6"
      RC6=0
      bash "$SRC/setup.sh" --with-harness "$T6" >"$TMP/sh-r6.log" 2>&1 || RC6=$?
      if [ "$RC6" != "0" ]; then
        sk "R6(sh)：装出失败（rc=${RC6}，见 $TMP/sh-r6.log）"
      else
        ok=0; [ ! -e "$T6/.claude/harness/ext/canary.optcanary" ] || ok=1
        chk "$ok" "R6(sh) exclusions.json 新增一条、重新生成后，is_optional_excluded 立刻认得（不用改安装器代码）" \
          "不存在（探针文件被生成块里的新判定挡住）" \
          "存在=$([ -e "$T6/.claude/harness/ext/canary.optcanary" ] && echo yes || echo no)"
      fi

      if ! command -v pwsh >/dev/null 2>&1; then
        sk "R6(ps1)：无 pwsh"
      else
        T6P="$TMP/target-ps-r6"
        RC6P=0
        pwsh -NoProfile -ExecutionPolicy Bypass -File "$SRC/setup.ps1" -Target "$T6P" -WithHarness \
          >"$TMP/ps-r6.log" 2>&1 || RC6P=$?
        if [ "$RC6P" != "0" ]; then
          sk "R6(ps1)：装出失败（rc=${RC6P}，见 $TMP/ps-r6.log）"
        else
          ok=0; [ ! -e "$T6P/.claude/harness/ext/canary.optcanary" ] || ok=1
          chk "$ok" "R6(ps1) 同一条新增排除项，重新生成后 Test-OptionalExcluded 也立刻认得" \
            "不存在" \
            "存在=$([ -e "$T6P/.claude/harness/ext/canary.optcanary" ] && echo yes || echo no)"
        fi
      fi
    fi
  fi
fi

echo "==== test-setup-optional：PASS=$PASS FAIL=$FAIL SKIP=$SKIPN ===="
[ "$FAIL" -eq 0 ]
