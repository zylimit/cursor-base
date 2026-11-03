#!/usr/bin/env bash
# risk: high
# test-scan-secrets-userinfo.sh — scan-secrets 必须认「URL 里内嵌口令」这一形态（批 4 · L4c）。
#
# 锁的行为（断言写「修好后应成立」）：
#   ① URL 的 userinfo 段（主机名前面 user:pass 那一截）内嵌口令时必须报出来，
#      finding 的 rule 是 url-userinfo，且点名到 文件:行。
#   ② 精度：https://host/x（无凭据）、https://user@host（有用户无口令）、
#      https://host:8080/path@x（端口 + 路径里带 @）三种都不许报。
#      第三种是给「正则写松了」准备的——`https?://\S+:\S+@` 这种偷懒写法会把它误报。
#   ③ .env.example 一类模板文件照既有文件级白名单跳过。
#   ④ 命中输出不许回显口令原文（报告本身不能是第二次泄露）。
#   ⑤ 新规则走既有管线：行内 scan-secrets:ignore 对它同样生效，且压制要计数、要可见。
#      这条挡的是「另起一遍扫描把规则焊在管线外」的修法。
#
# ⚠️ 本文件里**不许出现字面量形态的 user:pass@host**：tests/test-audit-scripts.sh 末尾那条自举
#   断言会拿 scan-secrets 扫本仓 tracked 源码，url-userinfo 规则一上线，字面量就会把它干红。
#   所以 @ 一律走运行期拼接的 ${AT}，样例文件用 printf 组装。
#
# 沙箱：mktemp 出来的 git 仓，本仓只读。scan-secrets 的 tracked 模式从 `git ls-files` 取名单，
#   所以样例文件必须 `git add`（不必 commit）。
#
# 用法：bash test-scan-secrets-userinfo.sh [audit 目录路径]
#   带参数是给突变/修复验证用的——把 audit/ 整目录拷 /tmp 打补丁，跑同一份断言看它转不转绿。
set -u

SRC=$(cd "$(dirname "$0")/.." && pwd)
AUDIT=${1:-"$SRC/harness/audit"}

echo "===== test-scan-secrets-userinfo ====="
command -v node >/dev/null 2>&1 || {
    echo "SKIPPED: 无 node——scan-secrets 是纯 node，一条都跑不了，未执行 != 通过。"
    exit 0
}
command -v git >/dev/null 2>&1 || {
    echo "SKIPPED: 无 git——scan-secrets 的文件集来自 git ls-files，造不出被扫面，未执行 != 通过。"
    exit 0
}
[ -f "$AUDIT/scan-secrets.mjs" ] || { echo "test-scan-secrets-userinfo: 缺 $AUDIT/scan-secrets.mjs" >&2; exit 1; }

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

# run —— 跑 scan-secrets，回填 RC / OUT_JSON / OUT_HUMAN。
RC=0
OUT_JSON=""
OUT_HUMAN=""
run() {
    RC=0
    OUT_JSON=$( (cd "$R" && node "$AUDIT/scan-secrets.mjs" 2>"$TMP/stderr.txt") ) || RC=$?
    OUT_HUMAN=$(cat "$TMP/stderr.txt")
}

# jval <JS 表达式> —— 从 OUT_JSON 取字段（d 为解析后的对象）；取不到回 <undefined>。
jval() {
    printf '%s' "$OUT_JSON" | node -e '
let s = "";
process.stdin.on("data", d => { s += d; }).on("end", () => {
  let d;
  try { d = JSON.parse(s); } catch (e) { console.log("<unparseable>"); return; }
  let v;
  try { v = new Function("d", "return (" + process.argv[1] + ");")(d); } catch (e) { v = undefined; }
  if (v === undefined || v === null) console.log("<undefined>");
  else if (typeof v === "object") console.log(JSON.stringify(v));
  else console.log(String(v));
});' "$1" 2>/dev/null || printf '<error>'
}

# ---------------------------------------------------------------------------
# 沙箱：一条阳性 + 三条阴性 + 一份模板文件
# ---------------------------------------------------------------------------
R="$TMP/repo"
mkdir -p "$R"
(cd "$R" && git init -q . && git config user.email t@example.com && git config user.name t) \
    || { echo "test-scan-secrets-userinfo: git init 失败" >&2; exit 1; }

AT=$(printf '\100')          # @ —— 见文件头，本文件里不许出现字面量的 user:pass@host
U='alice'
P='hunter2'
H='db.example.com'

write_positive() {   # $1 = 行尾附加内容（用于挂 scan-secrets:ignore 标记）
    printf 'const dsn = "https://%s:%s%s%s/x";%s\n' "$U" "$P" "$AT" "$H" "${1:-}" > "$R/conn.js"
}
write_positive
printf 'const plain = "https://%s/x";\n' "$H"                    > "$R/plain.js"
printf 'const useronly = "https://%s%s%s";\n' "$U" "$AT" "$H"    > "$R/useronly.js"
printf 'const withport = "https://api.%s:8080/health%sv2";\n' "$H" "$AT" > "$R/porturl.js"
printf 'DATABASE_URL=https://%s:%s%s%s/db\n' "$U" "$P" "$AT" "$H" > "$R/.env.example"
(cd "$R" && git add -A) || { echo "test-scan-secrets-userinfo: git add 失败" >&2; exit 1; }

# ---------------------------------------------------------------------------
# ① 阳性：报出来、rule 正确、点名文件:行
# ---------------------------------------------------------------------------
echo "-- ① URL 内嵌口令必须被报出来 --"
run
R_RC="$RC"; R_HUMAN="$OUT_HUMAN"
N_ERR=$(jval 'd.counts.error')
N_FIND=$(jval 'd.findings.length')
F_RULE=$(jval 'd.findings.map(f => f.rule).join(",")')
F_FILE=$(jval 'd.findings.map(f => f.file + ":" + f.line).join(",")')

if [ "$R_RC" -eq 1 ]; then r=0; else r=1; fi
chk "$r" "①a 有内嵌口令的 URL → rc 1" "rc=1（脚本契约：至少一条命中）" "rc=${R_RC}；stderr：$(printf '%s' "$R_HUMAN" | tr '\n' '|')"

r=1; [ "$F_RULE" = "url-userinfo" ] && r=0
chk "$r" "①b finding 的 rule 是 url-userinfo" "rule=url-userinfo" "rule=[$F_RULE]"

r=1; [ "$F_FILE" = "conn.js:1" ] && r=0
chk "$r" "①c 点名到 文件:行" "conn.js:1" "[$F_FILE]"

# ①d 一条不多一条不少 —— 这一条同时锁住三个阴性样例和模板文件：
#     只要 plain / useronly / porturl / .env.example 里任何一个被误报，条数就不是 1。
r=1; [ "$N_FIND" = "1" ] && [ "$N_ERR" = "1" ] && r=0
chk "$r" "①d 恰好 1 条命中（三条阴性 + 模板文件一个都没误报）" \
    "findings.length=1 且 counts.error=1" "findings.length=$N_FIND counts.error=$N_ERR 命中清单=[$F_FILE]"

# ①e 报告不许是第二次泄露
if printf '%s%s' "$R_HUMAN" "$OUT_JSON" | grep -q "$P"; then
    fail "①e 命中输出里回显了口令原文（等于二次泄露）"
    echo "         EXPECT 输出里不出现口令原文"
    echo "         GOT    出现了"
else
    pass "①e 命中输出未回显口令原文（已 REDACTED）"
fi

# ①g stdout 仍是单行合法 JSON（契约的机器可读面）
LINES=$(printf '%s' "$OUT_JSON" | wc -l | tr -d ' ')
r=1
if [ "$LINES" -eq 0 ] && printf '%s' "$OUT_JSON" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' 2>/dev/null; then r=0; fi
chk "$r" "①g stdout 是单行合法 JSON" "单行且可 JSON.parse" "内嵌换行 $LINES 处；前 120 字：$(printf '%s' "$OUT_JSON" | head -c 120)"

# ---------------------------------------------------------------------------
# ② 新规则必须走既有管线：行内 scan-secrets:ignore 生效且留痕
#    另起一遍扫描、把规则焊在管线外的修法会在这里红。
# ---------------------------------------------------------------------------
echo "-- ② 行内压制标记对新规则同样生效 --"
write_positive '  // scan-secrets:ignore'
(cd "$R" && git add -A)
run
S_RULE=$(jval 'd.suppressed.map(s => s.rule + "@" + s.file + ":" + s.line).join(",")')
r=1
if [ "$RC" -eq 0 ] && [ "$S_RULE" = "url-userinfo@conn.js:1" ]; then r=0; fi
chk "$r" "② 压制后 rc 0，且 suppressed 里留下 url-userinfo 的痕迹" \
    "rc=0 且 suppressed=[url-userinfo@conn.js:1]" "rc=$RC suppressed=[$S_RULE]"

echo ""
echo "==== test-scan-secrets-userinfo：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ]