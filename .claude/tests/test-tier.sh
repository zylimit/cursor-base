#!/usr/bin/env bash
# risk: medium
# test-tier.sh — 档位规格回归：`node harness.mjs tier` 的两条要害语义。
#
# 分级取舍（2026-09-10 测试预算表）：档位判错的代价是「闸松了一档」，不在高风险五种之列，
#   四个子命令的正反穷举（TV/TS/TT/TE/TP/TC/TL/TG 五十余条）不再养，只留三条——
#   三档单调性校验、fast 会话覆盖过期后回默认档、两张档位表逐字相等；
#   「地板不可 override」归 test-tier-hardening.sh。
#
# 契约来源：docs/v3-work-packs.md A.1 数据模型 / A.2 判定函数 / A.3 tier 子命令退出码。
# 纪律：一切写操作只落 mktemp 沙箱（真仓根写 tier.json 会当场影响本 session 在跑的 hook），
#   对本仓只读；每条断言打印 EXPECT / GOT，判定不依赖措辞。
set -eu

# CC_BASE_ROOT 覆盖是给「拿候选实现验修得好」留的口子：指向打过补丁的仓库副本跑同一批断言。
ROOT=${CC_BASE_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}
HARNESS="$ROOT/.claude/harness/harness.mjs"
HOOKS="$ROOT/.claude/hooks"
SCRIPTS="$ROOT/.claude/scripts"
FIX="$ROOT/.claude/tests/fixtures/tier/profile-base.json"

echo "===== test-tier ====="

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node——引擎与 hook 全是 .mjs，跑不起来；未执行 != 通过。" >&2
    exit 1
fi
if ! command -v git >/dev/null 2>&1; then
    echo "SKIPPED: 无 git——沙箱仓造不出来（自动升档要读工作树）；未执行 != 通过。" >&2
    exit 1
fi
[ -f "$HARNESS" ] || { echo "  [FAIL] 缺 harness.mjs：$HARNESS" >&2; exit 1; }
[ -f "$FIX" ] || { echo "  [FAIL] 缺基线 profile 夹具：$FIX" >&2; exit 1; }
TMP=$(mktemp -d)
trap 'chmod -R u+rwX "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

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

show() { printf '%s' "${1:-空}" | tr '\n' '~' | cut -c1-300; }

# jq_ <json 文本> <js 表达式（变量 d）> —— 用 node 取字段（故意不依赖 jq）。
jq_() {
    printf '%s' "$1" | node -e '
let s = "";
process.stdin.on("data", (c) => { s += c; });
process.stdin.on("end", () => {
  try { const d = JSON.parse(s); process.stdout.write(String(eval(process.argv[1]))); }
  catch (e) { process.stdout.write("<not-json>"); }
});
' "$2"
}

hasq() { printf '%s' "$2" | grep -qF "$1"; }

# newsb <名> —— 造沙箱项目：git 仓 + .claude 骨架 + 引擎所需的 settings.json / hooks / scripts。
newsb() {
    local d="$TMP/$1"
    rm -rf "$d"
    mkdir -p "$d/.claude/harness/lib" "$d/.claude/hooks/lib" "$d/.claude/scripts" \
             "$d/.claude/evidence" "$d/.claude/.runtime" "$d/src"
    cp "$ROOT/.claude/settings.json" "$d/.claude/settings.json" 2>/dev/null || true
    # lib/ 按目录整拷、不枚举模块名（拆库后少一个就是起不来的假红）。
    cp "$ROOT/.claude/harness/harness.mjs" "$d/.claude/harness/" 2>/dev/null || true
    cp "$ROOT"/.claude/harness/lib/*.mjs "$d/.claude/harness/lib/" 2>/dev/null || true
    cp "$HOOKS"/*.mjs "$d/.claude/hooks/" 2>/dev/null || true
    cp -R "$HOOKS/lib/." "$d/.claude/hooks/lib/" 2>/dev/null || true
    cp "$SCRIPTS/fast-mode.sh" "$d/.claude/scripts/" 2>/dev/null || true
    printf 'export const a = 1;\n' > "$d/src/a.ts"
    printf '# progress\n' > "$d/progress.md"
    ( cd "$d" && git init -q . \
        && git config core.autocrlf false \
        && git config user.email t@example.com && git config user.name t \
        && git add -A && git commit -qm init ) >/dev/null 2>&1
    printf '%s' "$d"
}

# mkprofile <沙箱> [变异表达式] —— 从 A.1 基线 profile 起稿，可对对象 p 做一处变异后写入。
mkprofile() {
    local d="$1" mut="${2:-}"
    mkdir -p "$d/.claude/harness"
    node -e '
const fs = require("node:fs");
const [src, dest, mut] = process.argv.slice(1);
const p = JSON.parse(fs.readFileSync(src, "utf8"));
if (mut) { eval(mut); }
fs.writeFileSync(dest, JSON.stringify(p, null, 2) + "\n");
' "$FIX" "$d/.claude/harness/profile.json" "$mut"
    # 提交掉：.claude/harness/** 在 raise.paths 里，留未跟踪会把沙箱自动抬成 strict。
    ( cd "$d" && git add -A -f .claude/harness && git commit -qm profile ) >/dev/null 2>&1
}

# mktier <沙箱> <fast|standard|strict> [live|expired] —— 造运行态覆盖文件。
mktier() {
    local d="$1" t="$2" st="${3:-live}" now exp f
    mkdir -p "$d/.claude/.runtime"
    f="$d/.claude/.runtime/tier.json"
    now=$(date +%s)
    exp=$((now + 3600))
    case "$st" in
        live)    printf '{"tier":"%s","reason":"t","by":"user","set_epoch":%s,"expires_epoch":%s}\n' "$t" "$now" "$exp" > "$f" ;;
        expired) printf '{"tier":"%s","reason":"t","by":"user","set_epoch":1000,"expires_epoch":2000}\n' "$t" > "$f" ;;
    esac
}

RC=0
OUT=""
ERRT=""

# hrun <沙箱> <argv…> —— 在沙箱当项目根跑仓里的引擎。
hrun() {
    local d="$1"
    shift
    RC=0
    ( cd "$d" && CLAUDE_PROJECT_DIR="$d" node "$HARNESS" "$@" ) >"$TMP/.o" 2>"$TMP/.e" || RC=$?
    OUT=$(cat "$TMP/.o" 2>/dev/null || true)
    ERRT=$(cat "$TMP/.e" 2>/dev/null || true)
}

echo ""
echo "--- TV tier validate：三档单调（fast ≤ standard ≤ strict）---"

SB=$(newsb tv-nonmono); mkprofile "$SB" 'p.hooks["tdd-gate"].fast = "block";'
hrun "$SB" tier validate
TV_RC="$RC"; TV_ALL="$OUT$ERRT"
chk "$([ "$TV_RC" -eq 1 ] && echo 0 || echo 1)" \
    "TV-1 三档非单调（tdd-gate fast=block > standard=advise）→ rc 1" \
    "rc=1" "rc=$TV_RC out=[$(show "$OUT")] err=[$(show "$ERRT")]"
chk "$(hasq 'tdd-gate' "$TV_ALL" && echo 0 || echo 1)" \
    "TV-2 非单调报告点名违规 hook（不点名的校验没法处理）" \
    "输出含 tdd-gate" "输出=[$(show "$TV_ALL")]"

echo ""
echo "--- TT tier status：fast 会话覆盖的过期回落 ---"

SB=$(newsb tt-expired); mkprofile "$SB"; mktier "$SB" fast expired
hrun "$SB" tier status
TT_E="$OUT"
chk "$([ "$RC" -eq 0 ] && [ "$(jq_ "$TT_E" 'String(d.tier)')" = "standard" ] && echo 0 || echo 1)" \
    "TT-1 过期的 tier.json → 视为无覆盖，effective 回 default（过期自动失效，不靠人记得关）" \
    "rc=0 且 tier=standard" "rc=$RC out=[$(show "$TT_E")]"
chk "$([ "$(jq_ "$TT_E" 'String(d.source)')" = "default" ] && echo 0 || echo 1)" \
    "TT-2 过期时 source 报 default 而不是 session（来源报错会让人以为覆盖还在生效）" \
    "source=default" "out=[$(show "$TT_E")]"

echo ""
echo "--- TS tier set fast --sticky：到撤销为止的 fast（TODO #91）---"
# sticky 的全部意义就是「不看 expires」：把 set_epoch 改到 1970 年（普通 fast 按读侧 8h 夹早已过期），
# 再把判定时刻拨到一年后，两头都仍得是 fast。少了任何一头，sticky 都只是一个更长的定时器。

SB=$(newsb ts-sticky); mkprofile "$SB"
hrun "$SB" tier set fast --sticky --reason x
TS_SET_RC="$RC"
TSF="$SB/.claude/.runtime/tier.json"
node -e '
const fs = require("node:fs"); const f = process.argv[1];
const d = JSON.parse(fs.readFileSync(f, "utf8")); d.set_epoch = 1000;
fs.writeFileSync(f, JSON.stringify(d) + "\n");
' "$TSF"
TS_FILE=$(cat "$TSF" 2>/dev/null || true)
hrun "$SB" tier status
TS_OUT="$OUT"; TS_ERR="$ERRT"
TS_FUT=$(node -e '
const path = require("node:path"); const url = require("node:url");
import(url.pathToFileURL(path.join(process.argv[1], ".claude/hooks/lib/tier.mjs")).href).then((m) => {
  const e = m.effectiveTier({ projectDir: process.argv[2], now: Date.now() + 365 * 86400 * 1000 });
  process.stdout.write(e.tier + "/" + String(e.sticky === true));
});
' "$ROOT" "$SB" 2>&1 || true)
chk "$([ "$TS_SET_RC" -eq 0 ] \
      && [ "$(jq_ "$TS_FILE" 'String(d.sticky)+"/"+String(d.expires_epoch)')" = "true/null" ] \
      && [ "$(jq_ "$TS_OUT" 'd.tier+"/"+d.sticky+"/"+d.expiresEpoch+"/"+("remainingHours" in d)')" = "fast/true/null/false" ] \
      && [ "$TS_FUT" = "fast/true" ] && echo 0 || echo 1)" \
    "TS-1 sticky 写 sticky:true + expires_epoch:null；set_epoch 改成 1970、判定时刻拨到一年后仍是 fast" \
    "set rc=0；文件 true/null；status fast/true/null 且无 remainingHours；一年后 fast/true" \
    "set rc=$TS_SET_RC 文件=[$(show "$TS_FILE")] status=[$(show "$TS_OUT")] 一年后=$TS_FUT"
chk "$(hasq 'fast (sticky, until revoked)' "$TS_ERR" && hasq ' -- x' "$TS_ERR" && echo 0 || echo 1)" \
    "TS-2 status 人读行写明 sticky 与理由（到撤销为止的放水，理由比时长更该被看见）" \
    "stderr 含 'fast (sticky, until revoked)' 与 '-- x'" "stderr=[$(show "$TS_ERR")]"

hrun "$SB" tier set fast --sticky --hours 2 --reason x
TS_MX="$RC"
hrun "$SB" tier set strict --sticky --reason x
TS_NF="$RC"
chk "$([ "$TS_MX" -eq 2 ] && [ "$TS_NF" -eq 2 ] && echo 0 || echo 1)" \
    "TS-3 --sticky 与 --hours 同给 → rc 2；--sticky 给非 fast 档 → rc 2（都是 usage 错，不是静默取一个）" \
    "两者 rc=2" "sticky+hours rc=$TS_MX，strict+sticky rc=$TS_NF"

hrun "$SB" tier set standard
hrun "$SB" tier status
TS_REV="$OUT"; TS_REV_FILE=$(cat "$TSF" 2>/dev/null || true)
chk "$([ "$(jq_ "$TS_REV" 'd.tier+"/"+String(d.sticky)')" = "standard/undefined" ] \
      && [ "$(jq_ "$TS_REV_FILE" 'String(d.sticky)')" = "undefined" ] && echo 0 || echo 1)" \
    "TS-4 tier set standard 即撤销：status 回 standard，status JSON 与 tier.json 都不再有 sticky" \
    "status standard/undefined；文件 sticky=undefined" \
    "status=[$(show "$TS_REV")] 文件=[$(show "$TS_REV_FILE")]"

echo ""
echo "--- TD 两张档位表逐字相等（profile.json ↔ tier.mjs 的 DEFAULT_PROFILE）---"
# profile.json 缺席时 hook 按 tier.mjs 里那份内置表跑。两张表分叉 = 装了 profile 的项目和没装的
# 项目对同一个闸说两套话，而这种分叉谁也看不出来——上一回是靠人眼发现的（2026-09-15）。

RC=0
OUT=$(node -e '
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");
const root = process.argv[1];
// 键序归一后再比：两份表的书写顺序不同不算分叉，取值不同才算。
const sortDeep = (v) => (v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
  : v);
const norm = (v) => JSON.stringify(sortDeep(v));
import(url.pathToFileURL(path.join(root, ".claude/hooks/lib/tier.mjs")).href).then((m) => {
  const file = JSON.parse(fs.readFileSync(path.join(root, ".claude/harness/profile.json"), "utf8")).hooks || {};
  const builtin = (m.DEFAULT_PROFILE || {}).hooks || {};
  const ids = [...new Set([...Object.keys(file), ...Object.keys(builtin)])].sort();
  const diff = ids.filter((id) => norm(file[id]) !== norm(builtin[id]))
    .map((id) => id + ": profile=" + JSON.stringify(file[id]) + " tier.mjs=" + JSON.stringify(builtin[id]));
  process.stdout.write(diff.join(" | "));
  process.exitCode = diff.length ? 1 : 0;
});
' "$ROOT" 2>&1) || RC=$?
chk "$([ "$RC" -eq 0 ] && echo 0 || echo 1)" \
    "TD-1 profile.json 的 hooks 表与 tier.mjs 的 DEFAULT_PROFILE.hooks 逐项相等" \
    "0 项不一致" "不一致项：${OUT:-无}"

echo ""
echo "==== test-tier：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ]
