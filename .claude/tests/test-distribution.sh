#!/usr/bin/env bash
# risk: high
# test-distribution.sh — 分发边界红锁：哪些东西该进安装产物 / 清单 / 发布包，哪些绝不该。
# 契约：tests/ 与 harness/ext/ 默认不装（要装得显式 --with-tests / --with-harness）、
# research/ 与 agent-memory/ 是本机私产永不分发；
# 清单侧同口径；release zip 里不含 progress*.md / docs/ / research/ / agent-memory/，但**含** tests/
# （zip 是 --with-tests 的料源，抽掉了 --with-tests 就成了空承诺）。
# 老化退休（2026-09-15）：D-1a、D-2a、D-2b、D-3a、D-4a、D-4c 六条删了——「默认安装 rc=0」紧跟着
#   就是一条硬中止（红因一样打印 stderr），「hooks 装齐 22 个」那种写死计数改一次 hook 就要改一次、
#   反向对照由同一沙箱上的 D-7b（默认安装仍有引擎核心）承担，其余三条是「开关退 0」「生成器跑通」
#   「测完还原」这类自证，判别力都已并进它们各自那条实效断言。
# 沙箱造法照抄 test-setup.sh：mktemp -d + git init + bash setup.sh <tmp>；
# 断言用 chk 逐条计数、不撞见第一条就 exit——六段互相独立，一次要看全各红在哪。
# 功能未实现期间整份为红，红因是「setup.sh 没有 --with-tests / 排除表没有这三项」，不是夹具坏。
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
[ -f "$ROOT/setup.sh" ]        || { echo "test-distribution: 仓库根缺 setup.sh：$ROOT" >&2; exit 1; }
[ -f "$ROOT/make-release.sh" ] || { echo "test-distribution: 仓库根缺 make-release.sh：$ROOT" >&2; exit 1; }
GEN_SH="$ROOT/.claude/scripts/gen-manifest.sh"
[ -f "$GEN_SH" ]               || { echo "test-distribution: 缺 gen-manifest.sh" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() { echo "test-distribution: $*" >&2; exit 1; }

PASS=0
FAIL=0
chk() {  # chk <0=通过/非0=失败> <标题> <EXPECT> <GOT>
  if [ "$1" = "0" ]; then
    PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$2"
  else
    FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$2"
  fi
  printf '         EXPECT %s\n' "$3"
  printf '         GOT    %s\n' "$4"
}
# 日志首行塞进 GOT，主 Agent 不用重跑就能分辨「没实现」和「夹具没搭起来」。
d_head() { head -1 "$1" 2>/dev/null | tr -d '\000-\011\013-\037\177' | cut -c1-140; }

mk_sandbox() {  # mk_sandbox <路径>——mktemp 里建目标目录并 git init（与 test-setup 沙箱同形）
  mkdir -p "$1"
  if command -v git >/dev/null 2>&1; then ( cd "$1" && git init -q . ) >/dev/null 2>&1 || true; fi
}

# ---- D-1 默认安装：tests/ research/ agent-memory/ 三个都不该出现 ----
T1="$TMP/d1"
mk_sandbox "$T1"
RC1=0
bash "$ROOT/setup.sh" "$T1" >"$TMP/d1.out" 2>"$TMP/d1.err" || RC1=$?
CL1="$T1/.claude"

[ "$RC1" = "0" ] || fail "D-1 脚手架：默认安装就失败（rc=${RC1}，stderr：$(d_head "$TMP/d1.err")），后面五段的判别力全没了"

for d in tests research agent-memory; do
  ok=0; [ ! -e "$CL1/$d" ] || ok=1
  chk "$ok" "D-1 默认安装不含 .claude/$d/" \
    "目标里不存在 .claude/${d}（本机私产 / 框架自测，装进别人项目是脏数据）" \
    "存在=$([ -e "$CL1/$d" ] && echo yes || echo no) 文件数=$(find "$CL1/$d" -type f 2>/dev/null | wc -l | tr -d ' ')"
done

# ---- D-3 --with-tests：tests/ 装进来，另两个仍不许出现 ----
T2="$TMP/d2"
mk_sandbox "$T2"
RC2=0
bash "$ROOT/setup.sh" --with-tests "$T2" >"$TMP/d2.out" 2>"$TMP/d2.err" || RC2=$?
CL2="$T2/.claude"

ok=0; [ "$RC2" = "0" ] || ok=1; [ -f "$CL2/tests/cases/run-all.sh" ] || ok=1
chk "$ok" "D-3b --with-tests 装出 tests/cases/run-all.sh" \
  "rc=0 且目标里存在 .claude/tests/cases/run-all.sh（开关认得出来，装了测试就要能一把跑）" \
  "rc=$RC2 存在=$([ -f "$CL2/tests/cases/run-all.sh" ] && echo yes || echo no) tests 下文件数=$(find "$CL2/tests" -type f 2>/dev/null | wc -l | tr -d ' ') stderr=[$(d_head "$TMP/d2.err")]"
for d in research agent-memory; do
  ok=0; [ ! -e "$CL2/$d" ] || ok=1
  chk "$ok" "D-3c --with-tests 仍不含 .claude/$d/" \
    "开关只放行 tests/，不许顺带把私产一起带出去" \
    "存在=$([ -e "$CL2/$d" ] && echo yes || echo no) 文件数=$(find "$CL2/$d" -type f 2>/dev/null | wc -l | tr -d ' ')"
done

# ---- D-4 清单侧同口径：三项一条都不许登记进 FRAMEWORK-MANIFEST ----
# gen-manifest.sh 写的是本仓那份，跑前跑后钉 sha 并从备份还原——用 git checkout 还原的话，
# 工作树里本就有的未提交改动会被一起抹掉。
MANIFEST="$ROOT/.claude/FRAMEWORK-MANIFEST.txt"
[ -f "$MANIFEST" ] || fail "D-4 脚手架：本仓缺 $MANIFEST"
cp -p "$MANIFEST" "$TMP/manifest.backup"
GRC=0
bash "$GEN_SH" >"$TMP/d4.out" 2>"$TMP/d4.err" || GRC=$?
listed=$(grep -cE '^(tests|research|agent-memory)/' "$MANIFEST" || true)
listed_names=$(grep -E '^(tests|research|agent-memory)/' "$MANIFEST" | cut -f1 | head -5 | tr '\n' ' ' || true)
cp -p "$TMP/manifest.backup" "$MANIFEST"

# 生成器的 rc 并进这一条：gen-manifest 没跑成时 listed 读的是旧清单，只判条数会恒绿。
ok=0; [ "$GRC" = "0" ] || ok=1; [ "$listed" = "0" ] || ok=1
chk "$ok" "D-4b MANIFEST 里 tests/ research/ agent-memory/ 条目数为 0" \
  "gen-manifest rc=0 且 0 条（登记成框架文件的话，release 的 manifest 检查随手一跑就转 FAIL）" \
  "rc=$GRC 实得 $listed 条，头几条=[${listed_names}] stderr=[$(d_head "$TMP/d4.err")]"

# ---- D-5 发布包边界：私产不进 zip，tests/ 必须在 zip 里 ----
ZRC=0
bash "$ROOT/make-release.sh" vTEST >"$TMP/d5.out" 2>"$TMP/d5.err" || ZRC=$?
ZIP=$(tail -1 "$TMP/d5.out" | tr -d '\r' | grep -oE '[^[:space:]]+\.zip' | tail -1 || true)
[ -n "$ZIP" ] || ZIP=$(grep -oE '[^[:space:]]+\.zip' "$TMP/d5.out" 2>/dev/null | tail -1 || true)
case "$ZIP" in /*) : ;; "") : ;; *) ZIP="$ROOT/$ZIP" ;; esac

ok=0
[ "$ZRC" = "0" ] || ok=1
[ -n "$ZIP" ] && [ -f "$ZIP" ] || ok=1
chk "$ok" "D-5a make-release.sh vTEST 产出 zip 并在末行给出路径" \
  "rc=0 且末行路径指向一个真实存在的 .zip" \
  "rc=$ZRC zip=[$ZIP] 存在=$([ -n "$ZIP" ] && [ -f "$ZIP" ] && echo yes || echo no) stderr=[$(d_head "$TMP/d5.err")]"

if [ -n "$ZIP" ] && [ -f "$ZIP" ]; then
  # 本机无 unzip，用 python3 的 zipfile 列条目（列全路径，不做任何裁剪）
  python3 - "$ZIP" >"$TMP/zip-entries.txt" <<'PY' || true
import sys, zipfile
print("\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))
PY
  entries=$(grep -c . "$TMP/zip-entries.txt" || true)
  [ "$entries" -gt 0 ] || fail "D-5 脚手架：zip 条目列表为空（列包失败？${ZIP}），后面的「不含」断言会恒绿"

  # 「不含」四组：按路径分量匹配，别用裸子串——progress.md 是 progress.archive.md 的子串，
  # 子串匹配红是红了，点名的却是另一份文件。
  for pair in \
    'progress.md|(^|/)progress\.md$' \
    'progress.archive.md|(^|/)progress\.archive\.md$' \
    'docs/|(^|/)docs/' \
    '.claude/research/|(^|/)\.claude/research/' \
    '.claude/agent-memory/|(^|/)\.claude/agent-memory/'
  do
    name=${pair%%|*}; pat=${pair#*|}
    hits=$(grep -cE "$pat" "$TMP/zip-entries.txt" || true)
    sample=$(grep -E "$pat" "$TMP/zip-entries.txt" | head -3 | tr '\n' ' ' || true)
    ok=0; [ "$hits" = "0" ] || ok=1
    chk "$ok" "D-5 zip 不含 $name" \
      "0 条（项目记忆 / 内部文档 / 本机私产不随包发出去）" \
      "实得 $hits 条，头几条=[$sample]"
  done

  wt_hits=$(grep -cE '(^|/)\.claude/tests/cases/run-all\.sh$' "$TMP/zip-entries.txt" || true)
  ok=0; [ "$wt_hits" -ge 1 ] 2>/dev/null || ok=1
  chk "$ok" "D-5 zip **含** .claude/tests/cases/run-all.sh" \
    "≥1 条（zip 是 --with-tests 的唯一料源，抽掉 tests/ 那个开关就成了空承诺）" \
    "实得 $wt_hits 条，包内 tests 条目数=$(grep -cE '(^|/)\.claude/tests/' "$TMP/zip-entries.txt" || true)"

  rm -f "$ZIP"
fi

# ---- D-6 未知选项仍拒（防 --with-tests 的解析把别的横杠参数一起放进来）----
T3="$TMP/d3"
mk_sandbox "$T3"
RC3=0
bash "$ROOT/setup.sh" --bogus "$T3" >"$TMP/d6.out" 2>"$TMP/d6.err" || RC3=$?
ok=0; [ "$RC3" = "2" ] || ok=1
chk "$ok" "D-6 未知选项 --bogus 仍以 rc=2 拒绝" \
  "rc=2（usage_die 的既有口径；加 --with-tests 时若把 -* 分支改成放行，这里当场红）" \
  "rc=$RC3 stderr=[$(d_head "$TMP/d6.err")] 目标被写=$([ -e "$T3/.claude" ] && echo yes || echo no)"

# ---- D-7 harness/ext：默认不装，--with-harness 才装（两份细则同时落进 rules/）----
# 这一段守的是拆包的全部意义：默认装出来的脚手架里不该有那一万五千行引擎，也不该有它那两份
# 必读细则；而开关一开，细则必须同时出现在 .claude/rules/ 下——frontmatter 的 path 作用域只在
# 那个目录被 Claude Code 认，只拷进 ext/ 等于装了一份谁也加载不到的文档。
ok=0; [ ! -e "$CL1/harness/ext" ] || ok=1
chk "$ok" "D-7a 默认安装不含 .claude/harness/ext/" \
  "目标里不存在 .claude/harness/ext（大仓治理引擎默认不装）" \
  "存在=$([ -e "$CL1/harness/ext" ] && echo yes || echo no) 文件数=$(find "$CL1/harness/ext" -type f 2>/dev/null | wc -l | tr -d ' ')"

ok=0; [ -f "$CL1/harness/harness.mjs" ] && [ -f "$CL1/harness/lib/core.mjs" ] || ok=1
chk "$ok" "D-7b 默认安装仍有引擎核心（证明上一条不是整个 harness/ 没装蒙来的绿）" \
  "harness.mjs 与 lib/core.mjs 都在（tier / doctor / diff-hash 不依赖可选包）" \
  "harness.mjs=$([ -f "$CL1/harness/harness.mjs" ] && echo yes || echo no) lib/core.mjs=$([ -f "$CL1/harness/lib/core.mjs" ] && echo yes || echo no)"

for r in harness-large-repo quality-attributes; do
  ok=0; [ ! -e "$CL1/rules/$r.md" ] || ok=1
  chk "$ok" "D-7c 默认安装不含 rules/$r.md" \
    "不存在（引擎不装，它的必读细则也不该占目标项目的阅读量）" \
    "存在=$([ -e "$CL1/rules/$r.md" ] && echo yes || echo no)"
done

T4="$TMP/d7"
mk_sandbox "$T4"
RC4=0
bash "$ROOT/setup.sh" --with-harness "$T4" >"$TMP/d7.out" 2>"$TMP/d7.err" || RC4=$?
CL4="$T4/.claude"

ok=0; [ "$RC4" = "0" ] || ok=1
chk "$ok" "D-7d --with-harness 是被识别的开关、正常退出" \
  "rc=0" \
  "rc=$RC4 stderr=[$(d_head "$TMP/d7.err")]"

ext_count=$(find "$CL4/harness/ext" -name '*.mjs' -type f 2>/dev/null | wc -l | tr -d ' ')
ok=0; [ "$ext_count" = "14" ] || ok=1
chk "$ok" "D-7e --with-harness 装出 harness/ext/ 全部 14 个模块" \
  "14 个 .mjs（少一个引擎就在某条子命令上 ERR_MODULE_NOT_FOUND，数量写死好让人看一眼）" \
  "实得 $ext_count 个"

for r in harness-large-repo quality-attributes; do
  ok=0; [ -f "$CL4/rules/$r.md" ] && [ -f "$CL4/harness/ext/rules/$r.md" ] || ok=1
  chk "$ok" "D-7f --with-harness 把 $r.md 同时落到 rules/ 与 ext/rules/" \
    "两处都在（rules/ 那份是 Claude Code 真会加载的，ext/rules/ 那份是随包走的源）" \
    "rules/=$([ -f "$CL4/rules/$r.md" ] && echo yes || echo no) ext/rules/=$([ -f "$CL4/harness/ext/rules/$r.md" ] && echo yes || echo no)"
done

ok=0; [ ! -e "$CL4/tests" ] || ok=1
chk "$ok" "D-7g --with-harness 不顺带把 tests/ 带出去" \
  "不存在（两个开关各管各的，一个开了另一个不跟着开）" \
  "存在=$([ -e "$CL4/tests" ] && echo yes || echo no)"

# ---- D-7h 同一份字节，两条路径必须被 scan-instructions 判成同一个结论（TODO #70 红锁）----
# --with-harness 把 rules/*.md 逐字节复制到两处：.claude/rules/（Claude Code 真加载的那份）与
# .claude/harness/ext/rules/（随包的源）。instructions-allowlist.json 的豁免只绑
# .claude/harness/ext/rules/harness-large-repo.md:63 这一条路径，装出来的 rules/ 那份拿不到同一条
# 豁免——下游项目一装完、一开 githooks 就被这份「装出来的文件」自己的指令审计拦停，装坏的是
# 别人的项目，不是这仓自己。复用 D-7 段已经装好的 $T4/${CL4}，不再起第二个沙箱。
# 在当前实现下这段必红：rules/ 那份 rc=1 / error=1 / allowlisted=0，
# 与 ext/rules/ 那份的 rc=0 / error=0 / allowlisted=1 对不上；D-7h3 的 sha256 一致则证明
# 这不是内容差异，纯粹是豁免只认路径没认字节。
jget() {  # jget <json文本> <字段路径，如 counts.error> — 经环境变量传 JSON，避开引号/中文转义
  J="$1" node -e '
    let d;
    try { d = JSON.parse(process.env.J); } catch (e) { process.stdout.write("<PARSE-ERROR>"); process.exit(0); }
    let cur = d;
    for (const k of process.argv[1].split(".").filter(Boolean)) cur = (cur == null) ? undefined : cur[k];
    process.stdout.write(cur === undefined ? "<UNDEFINED>" : String(cur));
  ' "$2"
}

RULES_RC=0
RULES_JSON=$( (cd "$T4" && node .claude/harness/audit/scan-instructions.mjs --paths .claude/rules/harness-large-repo.md --json) 2>"$TMP/d7h-rules.err" ) || RULES_RC=$?
EXT_RC=0
EXT_JSON=$( (cd "$T4" && node .claude/harness/audit/scan-instructions.mjs --paths .claude/harness/ext/rules/harness-large-repo.md --json) 2>"$TMP/d7h-ext.err" ) || EXT_RC=$?

RULES_ERR=$(jget "$RULES_JSON" counts.error)
RULES_AL=$(jget "$RULES_JSON" counts.allowlisted)
ok=0
[ "$RULES_RC" = "0" ] || ok=1
[ "$RULES_ERR" = "0" ] || ok=1
case "$RULES_AL" in ''|*[!0-9]*) ok=1 ;; *) [ "$RULES_AL" -ge 1 ] || ok=1 ;; esac
chk "$ok" "D-7h1 装出的 .claude/rules/harness-large-repo.md 扫描应 rc=0 / error=0 / allowlisted>=1" \
  "rc=0 counts.error=0 counts.allowlisted>=1（第 63 行那条 gate-disable-instruction 豁免该随字节走，不该只认 ext/rules/ 那一条路径）" \
  "rc=$RULES_RC counts.error=$RULES_ERR counts.allowlisted=$RULES_AL stderr=[$(d_head "$TMP/d7h-rules.err")]"

OK1=$(jget "$RULES_JSON" ok); OK2=$(jget "$EXT_JSON" ok)
ERR1="$RULES_ERR"; ERR2=$(jget "$EXT_JSON" counts.error)
AL1="$RULES_AL"; AL2=$(jget "$EXT_JSON" counts.allowlisted)
ok=0
[ "$OK1" = "$OK2" ] || ok=1
[ "$ERR1" = "$ERR2" ] || ok=1
[ "$AL1" = "$AL2" ] || ok=1
chk "$ok" "D-7h2 rules/ 与 ext/rules/ 两条路径对同一份字节的扫描结论必须一致（防两边一起坏掉的假绿）" \
  "ok 相等 且 counts.error 相等 且 counts.allowlisted 相等" \
  "rules/: ok=$OK1 error=$ERR1 allowlisted=$AL1 | ext/rules/: ok=$OK2 error=$ERR2 allowlisted=$AL2 rc=$RULES_RC/$EXT_RC"

SHA1=$(sha256sum "$CL4/rules/harness-large-repo.md" 2>/dev/null | cut -d' ' -f1)
SHA2=$(sha256sum "$CL4/harness/ext/rules/harness-large-repo.md" 2>/dev/null | cut -d' ' -f1)
ok=0; [ -n "$SHA1" ] && [ "$SHA1" = "$SHA2" ] || ok=1
chk "$ok" "D-7h3 两份 harness-large-repo.md 字节完全相同（判定差异不是内容差异，是路径绑定）" \
  "sha256 相同且非空（同一份字节，两条路径）" \
  "rules/=$SHA1 ext/rules/=$SHA2"

printf '==== test-distribution：PASS=%s FAIL=%s ====\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
