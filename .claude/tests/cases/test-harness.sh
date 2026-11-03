#!/usr/bin/env bash
# risk: medium
# test-harness.sh — 大仓治理 harness 自测脚手架（SKIP-非假绿）。
# 契约：无 node → 打印 SKIPPED 并 exit 0（未执行 != 通过，对齐 run-all.sh SKIPPED 语义）；
#   有 node → 真跑 node harness.mjs selftest 断言 {"ok":true} + exit 0，再跑 doctor 断言出 JSON。
# Phase 1（T1.5）在此追加 catalog/impact/context-pack/receipt fixtures 断言 + 规模 smoke。
set -eu

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
HARNESS="$ROOT/.claude/harness/harness.mjs"

echo "===== test-harness ====="

# node 缺失 → 可见跳过，非假绿
if ! command -v node >/dev/null 2>&1; then
  echo "SKIPPED: 无 node（command -v node 未找到）——harness 自测跳过，未执行 != 通过。"
  exit 0
fi
[ -f "$HARNESS" ] || { echo "  [FAIL] 缺 harness.mjs：$HARNESS" >&2; exit 1; }
HARNESS_DIR="$(cd "$(dirname "$HARNESS")" && pwd)"
HOOKS_LIB="$ROOT/.claude/hooks/lib"
PROFILE="$ROOT/.claude/harness/profile.json"

# 把整台引擎搬进沙箱：harness.mjs 拆库后 import 同级 lib/，只拷单文件会 ERR_MODULE_NOT_FOUND 起不来。
# ext/ 一起搬：下面测的绝大多数子命令都住在那个可选包里，少了它们一律 rc 3 报「未安装」，
# 而 rc 3 在契约里是降级、hook 照原逻辑放行——⑰⑱ 那两条会绿在一条根本没跑过判定的路径上。
# 两个目录都由 $HARNESS 推导、按目录整拷，后续新增模块自动跟着走，不写死文件名。
# hooks/lib/ 一并搬：档位只有一个解析器且放在 hook 侧，引擎 lib/tier.mjs import 的是
# ../../hooks/lib/tier.mjs——沙箱里少这一份，引擎起不来、以契约外的 rc 1 退出，
# ⑰⑱ 那几条端到端断言测到的就不再是 hook 的判定链。
# profile.json 同装：档位表在不在 = 档位启不启用，不装是在测一条不存在的兼容路径。
install_harness() {
  local dest="$1/.claude/harness" d
  mkdir -p "$dest"
  cp "$HARNESS" "$dest/harness.mjs"
  for d in lib ext; do
    [ -d "$HARNESS_DIR/$d" ] || continue
    mkdir -p "$dest/$d"
    cp -R "$HARNESS_DIR/$d/." "$dest/$d/"
  done
  if [ -f "$PROFILE" ]; then
    cp "$PROFILE" "$dest/profile.json"
  fi
  if [ -d "$HOOKS_LIB" ]; then
    mkdir -p "$1/.claude/hooks/lib"
    cp -R "$HOOKS_LIB/." "$1/.claude/hooks/lib/"
  fi
}

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }

# ① selftest：stdout JSON 含 "ok":true 且 exit 0
RC=0
OUT=$(node "$HARNESS" selftest) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"ok":true'; then
  pass "selftest 返回 {\"ok\":true} 且 exit 0"
else
  fail "selftest 未通过（exit ${RC}，输出：${OUT}）"
fi

# ② doctor：exit 0 且 stdout 是 JSON 对象（含 node 字段）
RC=0
OUT=$(node "$HARNESS" doctor) || RC=$?
case "$OUT" in
  '{'*'"node"'*) DJSON=1 ;;
  *) DJSON=0 ;;
esac
if [ "$RC" -eq 0 ] && [ "$DJSON" -eq 1 ]; then
  pass "doctor 出 JSON 且 exit 0"
else
  fail "doctor 未出预期 JSON（exit ${RC}，输出：${OUT}）"
fi

# ⑤ verify 退出码契约（pre-commit-check 消费：rc=2 阻断 commit、rc=3 静默降级、rc=0 放行）
#   selftest 已覆盖 runCheck/aggregateStates 纯函数；本段补 CLI dispatch -> 退出码映射集成层。
#   每条独立临时仓，跑完即删；catalog JSON 用 node -e 写避免引号嵌套。
verify_setup() {
  local check_cmd="$1" tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/.claude/harness"
  if [ "${2:-}" != "no-catalog" ]; then
    node -e '
      const fs = require("fs");
      fs.writeFileSync(process.argv[1], JSON.stringify({
        version: 1,
        modules: [{ id: "core", paths: ["core/**"], riskTier: "medium" }],
        riskChecks: { medium: ["chk"] },
        checks: { chk: { command: process.argv[2], class: "static" } }
      }));
    ' "$tmp/.claude/harness/module-catalog.json" "$check_cmd"
  fi
  ( cd "$tmp" && git init -q && git config core.autocrlf false \
    && git config user.email t@t.t && git config user.name t \
    && mkdir -p core && echo "x" > core/a.ts && git add -A && git commit -qm init \
    && echo "changed" >> core/a.ts ) >/dev/null 2>&1
  printf '%s' "$tmp"
}

# ⑤a verify 全 PASS -> rc 0
TMPV="$(verify_setup 'node -e "process.exit(0)"')"
RC=0
OUT=$(cd "$TMPV" && CLAUDE_PROJECT_DIR="$TMPV" node "$HARNESS" verify) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"state":"PASS"'; then
  pass "verify 全 PASS -> rc 0"
else
  fail "verify 全 PASS 应 rc 0（exit ${RC}，输出：${OUT}）"
fi
rm -rf "$TMPV"

# ⑤b verify 任一 FAIL -> rc 2（commit 闸阻断）
TMPV="$(verify_setup 'node -e "process.exit(1)"')"
RC=0
OUT=$(cd "$TMPV" && CLAUDE_PROJECT_DIR="$TMPV" node "$HARNESS" verify) || RC=$?
if [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -q '"state":"FAIL"'; then
  pass "verify FAIL -> rc 2"
else
  fail "verify FAIL 应 rc 2（exit ${RC}，输出：${OUT}）"
fi
rm -rf "$TMPV"

# ⑤c verify 缺命令 -> BLOCKED -> rc 2（不假绿：二进制找不到不能默默放行）
TMPV="$(verify_setup 'definitely-not-real-binary-xyz-12345')"
RC=0
OUT=$(cd "$TMPV" && CLAUDE_PROJECT_DIR="$TMPV" node "$HARNESS" verify) || RC=$?
if [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -q '"state":"BLOCKED"'; then
  pass "verify 缺命令 -> BLOCKED -> rc 2（不假绿）"
else
  fail "verify 缺命令应 BLOCKED rc 2（exit ${RC}，输出：${OUT}）"
fi
rm -rf "$TMPV"

# ⑥ receipt verify 退出码契约（stop-gate 消费：rc=4 拦停强制重审、rc=3 降级、rc=0 放行）
#   selftest 已覆盖 matchReceipts/contentHash 纯函数；本段补 receipt write 落盘往返 + verify 退出码映射。
# ⑥a receipt write 落盘 -> verify 同 diff rc 0
TMPR="$(mktemp -d)"
( cd "$TMPR" && git init -q && git config core.autocrlf false \
  && git config user.email t@t.t && git config user.name t \
  && mkdir -p core && echo "x" > core/a.ts && git add -A && git commit -qm init \
  && echo "changed" >> core/a.ts ) >/dev/null 2>&1
RC=0
OUT=$(cd "$TMPR" && CLAUDE_PROJECT_DIR="$TMPR" node "$HARNESS" receipt write <<<'{"taskId":"T1","reviewer":"alice","verdict":"pass","scope":"core"}'
) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"taskId":"T1"' \
   && [ -f "$TMPR/.claude/harness/receipts/T1.json" ] \
   && grep -q '"contentHash"' "$TMPR/.claude/harness/receipts/T1.json"; then
  RC2=0
  OUT2=$(cd "$TMPR" && CLAUDE_PROJECT_DIR="$TMPR" node "$HARNESS" receipt verify) || RC2=$?
  if [ "$RC2" -eq 0 ]; then
    pass "receipt write 落盘 -> verify 同 diff rc 0"
  else
    fail "receipt verify 同 diff 应 rc 0（exit ${RC2}，输出：${OUT2}）"
  fi
else
  fail "receipt write 应 rc 0 + 落盘 T1.json + contentHash（exit ${RC}，输出：${OUT}）"
fi

# ⑥b 改一个字节后 verify -> rc 4（STALE：stop-gate 拦停强制重审）
echo "more-change" >> "$TMPR/core/a.ts"
RC=0
OUT=$(cd "$TMPR" && CLAUDE_PROJECT_DIR="$TMPR" node "$HARNESS" receipt verify) || RC=$?
if [ "$RC" -eq 4 ] && printf '%s' "$OUT" | grep -q '"state":"STALE"'; then
  pass "receipt diff 变动 -> verify rc 4（STALE）"
else
  fail "receipt verify 改一字节应 rc 4 STALE（exit ${RC}，输出：${OUT}）"
fi
rm -rf "$TMPR"

# ⑦ waiver create 真写（非 dry-run）：dry-run 已在 ④ 测过，这里验真写落盘 + 禁词真写也拒
# ⑦a 合法 waiver 真写 -> rc 0 + 文件落盘 + contentHash 字段
TMPW="$(mktemp -d)"; mkdir -p "$TMPW/.claude/harness"
RC=0
OUT=$(cd "$TMPW" && CLAUDE_PROJECT_DIR="$TMPW" node "$HARNESS" waiver create \
  --owner tester --reason "flake on CI" --scope lint \
  --expiry 2099-01-01T00:00:00.000Z --compensation "rerun on rebuild") || RC=$?
WPATH=""
if [ "$RC" -eq 0 ]; then
  WPATH=$(printf '%s' "$OUT" | grep -oE '"path":"[^"]*"' | head -1 | sed 's/"path":"//; s/"$//')
fi
# 报出来的 path 是仓库相对（stdout 是机器契约，不带机器目录），所以要拼回仓根才能验落盘；
# 顺带钉住形态——写成绝对路径这里会因为 $TMPW 前缀多一截而找不到文件。
if [ "$RC" -eq 0 ] && [ -n "$WPATH" ] && [ -f "$TMPW/$WPATH" ] && grep -q '"contentHash"' "$TMPW/$WPATH"; then
  pass "waiver create 真写 -> rc 0 + 落盘（path 为仓库相对）+ contentHash"
else
  fail "waiver create 真写未落盘（rc=${RC}，path=${WPATH}，输出：${OUT}）"
fi
rm -rf "$TMPW"

# ⑦b waiver create reason 含 security -> rc 非 0 + 不落盘（独立临时仓，初态 waiver 数=0）
TMPW="$(mktemp -d)"; mkdir -p "$TMPW/.claude/harness"
RC=0
OUT=$(cd "$TMPW" && CLAUDE_PROJECT_DIR="$TMPW" node "$HARNESS" waiver create \
  --owner tester --reason "bypass security gate" --scope lint \
  --expiry 2099-01-01T00:00:00.000Z --compensation "nope" 2>/dev/null) || RC=$?
WAIVER_COUNT=$(find "$TMPW/.claude/harness/waivers" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
if [ "$RC" -ne 0 ] && [ "${WAIVER_COUNT:-0}" -eq 0 ]; then
  pass "waiver create reason 含 security -> rc 非 0 + 未落盘"
else
  fail "waiver create 禁词应拒绝且不落盘（rc=${RC}，waiver count=${WAIVER_COUNT}，输出：${OUT}）"
fi
rm -rf "$TMPW"

# ⑪ catalog-lint CLI：契约 = 无错 rc 0 / 有错 rc 1（四错误码各验）/ 无 catalog rc 3
FX="$ROOT/.claude/tests/fixtures/harness"
# ⑪a good fixture + 全映射 tracked -> rc 0
RC=0
OUT=$(node "$HARNESS" catalog-lint --catalog "$FX/catalog-good.json" \
  --tracked core/index.ts,db/schema.ts,auth/login.ts,api/routes.ts,package.json,README.md,docs/guide.md) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"ok":true'; then
  pass "catalog-lint good -> rc 0"
else
  fail "catalog-lint good 应 rc 0（exit ${RC}，输出：${OUT}）"
fi

# ⑪b UNMAPPED（tracked 驱动）-> rc 1
RC=0
OUT=$(node "$HARNESS" catalog-lint --catalog "$FX/catalog-bad-unmapped.json" \
  --tracked src/unmapped.ts) || RC=$?
if [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -q '"UNMAPPED"'; then
  pass "catalog-lint UNMAPPED -> rc 1"
else
  fail "catalog-lint UNMAPPED 应 rc 1（exit ${RC}，输出：${OUT}）"
fi

# ⑪f 无 catalog -> rc 3
TMPCL="$(mktemp -d)"
RC=0
OUT=$(cd "$TMPCL" && CLAUDE_PROJECT_DIR="$TMPCL" node "$HARNESS" catalog-lint) || RC=$?
if [ "$RC" -eq 3 ] && printf '%s' "$OUT" | grep -q '"catalog-missing"'; then
  pass "catalog-lint 无 catalog -> rc 3"
else
  fail "catalog-lint 无 catalog 应 rc 3（exit ${RC}，输出：${OUT}）"
fi
rm -rf "$TMPCL"

# ⑫ impact CLI：契约 = 正常 rc 0 / 无 catalog rc 3 / 非 git rc 3
# ⑫a 正常（core 变更，api dependsOn core -> affected=[core,api] 反向闭包）-> rc 0
TMPI="$(mktemp -d)"; mkdir -p "$TMPI/.claude/harness"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    version: 1,
    modules: [
      { id: "core", paths: ["core/**"], riskTier: "medium" },
      { id: "api", paths: ["api/**"], dependsOn: ["core"], riskTier: "medium" }
    ], global: [], ignored: []
  }));
' "$TMPI/.claude/harness/module-catalog.json"
RC=0
OUT=$(CLAUDE_PROJECT_DIR="$TMPI" node "$HARNESS" impact \
  --catalog "$TMPI/.claude/harness/module-catalog.json" --changed core/a.ts) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"affected":\["core","api"\]'; then
  pass "impact 正常 -> rc 0 + 反向闭包"
else
  fail "impact 正常应 rc 0（exit ${RC}，输出：${OUT}）"
fi

# ⑫b 无 catalog -> rc 3
RC=0
OUT=$(CLAUDE_PROJECT_DIR="$TMPI" node "$HARNESS" impact \
  --catalog "$TMPI/nope.json" --changed core/a.ts) || RC=$?
if [ "$RC" -eq 3 ] && printf '%s' "$OUT" | grep -q '"catalog-missing"'; then
  pass "impact 无 catalog -> rc 3"
else
  fail "impact 无 catalog 应 rc 3（exit ${RC}，输出：${OUT}）"
fi

# ⑫c 非 git（catalog 在，不传 --changed 走 changedPaths 自动检测）-> rc 3
TMPI2="$(mktemp -d)"; mkdir -p "$TMPI2/.claude/harness"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    version: 1, modules: [{ id: "core", paths: ["core/**"], riskTier: "medium" }], global: [], ignored: []
  }));
' "$TMPI2/.claude/harness/module-catalog.json"
RC=0
OUT=$(cd "$TMPI2" && CLAUDE_PROJECT_DIR="$TMPI2" node "$HARNESS" impact \
  --catalog "$TMPI2/.claude/harness/module-catalog.json") || RC=$?
if [ "$RC" -eq 3 ] && printf '%s' "$OUT" | grep -q '"non-git"'; then
  pass "impact 非 git -> rc 3"
else
  fail "impact 非 git 应 rc 3（exit ${RC}，输出：${OUT}）"
fi
rm -rf "$TMPI" "$TMPI2"

# ⑬ context-pack CLI：契约 = 正常 rc 0 / 非 git rc 3
# ⑬a 正常（临时 git 仓 + catalog + 工作树变更）-> rc 0
TMPC="$(mktemp -d)"; mkdir -p "$TMPC/.claude/harness"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    version: 1, modules: [{ id: "core", paths: ["core/**"], riskTier: "medium" }], global: [], ignored: []
  }));
' "$TMPC/.claude/harness/module-catalog.json"
( cd "$TMPC" && git init -q && git config core.autocrlf false \
  && git config user.email t@t.t && git config user.name t \
  && mkdir -p core && echo "x" > core/a.ts && git add -A && git commit -qm init \
  && echo "changed" >> core/a.ts ) >/dev/null 2>&1
RC=0
OUT=$(cd "$TMPC" && CLAUDE_PROJECT_DIR="$TMPC" node "$HARNESS" context-pack) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"diffHash"'; then
  pass "context-pack 正常 -> rc 0"
else
  fail "context-pack 正常应 rc 0（exit ${RC}，输出：${OUT}）"
fi
rm -rf "$TMPC"

# ⑬b 非 git -> rc 3
TMPC="$(mktemp -d)"
RC=0
OUT=$(cd "$TMPC" && CLAUDE_PROJECT_DIR="$TMPC" node "$HARNESS" context-pack) || RC=$?
if [ "$RC" -eq 3 ]; then
  pass "context-pack 非 git -> rc 3"
else
  fail "context-pack 非 git 应 rc 3（exit ${RC}，输出：${OUT}）"
fi
rm -rf "$TMPC"

# ⑭ CLI dispatch：契约 = unknown/missing 总是 rc 3（+ usage 诊断到 stderr）
# ⑭a unknown 命令 -> rc 3 + usage
RC=0
ERR=$(node "$HARNESS" bogus-cmd-xyz 2>&1 1>/dev/null) || RC=$?
if [ "$RC" -eq 3 ] && printf '%s' "$ERR" | grep -q 'unknown subcommand: bogus-cmd-xyz' \
   && printf '%s' "$ERR" | grep -q 'usage: node harness.mjs'; then
  pass "unknown 命令 -> rc 3 + usage"
else
  fail "unknown 命令应 rc 3 + usage（exit ${RC}，stderr：${ERR}）"
fi

# ⑭b 可选包没装：ext/ 的子命令降级到 rc 3 并说清怎么装，lib/ 那四个照常跑。
#   拆包后这是绝大多数目标项目的日常状态，所以它得是一条被测过的路径而不是一条推测。
#   在沙箱里做，不动本仓的 ext/：中途被打断的话，改名版会把这个仓的引擎留在半残状态。
TMPX="$(mktemp -d)"
install_harness "$TMPX"
rm -rf "$TMPX/.claude/harness/ext"
XH="$TMPX/.claude/harness/harness.mjs"
RC=0
ERR=$(cd "$TMPX" && CLAUDE_PROJECT_DIR="$TMPX" node "$XH" impact 2>&1 1>/dev/null) || RC=$?
if [ "$RC" -eq 3 ] && printf '%s' "$ERR" | grep -q 'not installed' \
   && printf '%s' "$ERR" | grep -q -- '--with-harness'; then
  pass "ext 未装 -> impact rc 3 + stderr 说清怎么装"
else
  fail "ext 未装时 impact 应 rc 3 + not installed（exit ${RC}，stderr：${ERR}）"
fi

RC=0
OUT=$(cd "$TMPX" && CLAUDE_PROJECT_DIR="$TMPX" node "$XH" tier status 2>/dev/null) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"tier"'; then
  pass "ext 未装 -> tier status 仍 rc 0（档位盘不依赖可选包）"
else
  fail "ext 未装时 tier status 应 rc 0（exit ${RC}，输出：${OUT}）"
fi

RC=0
OUT=$(cd "$TMPX" && CLAUDE_PROJECT_DIR="$TMPX" node "$XH" doctor 2>/dev/null) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"extInstalled":false'; then
  pass "ext 未装 -> doctor 仍 rc 0 且 extInstalled:false（不把「没装」报成「装了但是空的」）"
else
  fail "ext 未装时 doctor 应 rc 0 + extInstalled:false（exit ${RC}，输出：${OUT}）"
fi

RC=0
OUT=$(cd "$TMPX" && CLAUDE_PROJECT_DIR="$TMPX" node "$XH" selftest 2>/dev/null) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"ext":"not installed"'; then
  pass "ext 未装 -> selftest rc 0 但自报只跑了核心那条（一条绿不冒充整套绿）"
else
  fail "ext 未装时 selftest 应 rc 0 + ext:\"not installed\"（exit ${RC}，输出：${OUT}）"
fi
rm -rf "$TMPX"

# ⑰ stop-gate 端到端（hook→lib-harness→harness.mjs receipt verify 链）
#   验重点：stop-gate.mjs 真调了 harness receipt verify 并据 rc=4 拦停、rc=0 放行（不只 CLI 单测）。
#   关键：临时仓必须自带 harness.mjs（hook 经 $CLAUDE_PROJECT_DIR/.claude/harness/harness.mjs 找它）。
STOP_GATE="$ROOT/.claude/hooks/stop-gate.mjs"

# ⑰a 有 stale receipt + diff 变动 + .needs-review=clean -> stop-gate 点名 STALE（rc=4 路径）
#   判据是「回执过期必须点名到人」，不是某个出口形态：standard 档 stop-gate 是 advise（systemMessage），
#   strict 档是 decision:block，两边的正文是同一段话，所以断言认那段话、不认出口形态。
TMPS="$(mktemp -d)"
install_harness "$TMPS"
node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({version:1, modules:[{id:"core",paths:["core/**"],riskTier:"medium"}]}));' "$TMPS/.claude/harness/module-catalog.json"
( cd "$TMPS" && git init -q && git config core.autocrlf false \
  && git config user.email t@t.t && git config user.name t \
  && mkdir -p core && echo "x" > core/a.ts && git add -A && git commit -qm init ) >/dev/null 2>&1
echo "changed" >> "$TMPS/core/a.ts"
# 写 receipt 绑定当前 diff，再改代码制造 stale（rc=4 触发条件：receipts 存在但都不匹配当前 diff）
( cd "$TMPS" && CLAUDE_PROJECT_DIR="$TMPS" node "$HARNESS" receipt write <<<'{"taskId":"T1","reviewer":"bob","verdict":"pass","scope":"core"}'
) >/dev/null 2>&1
echo "more-change-after-receipt" >> "$TMPS/core/a.ts"
echo "clean" > "$TMPS/.claude/.needs-review"
RC=0
OUT=$(cd "$TMPS" && CLAUDE_PROJECT_DIR="$TMPS" node "$STOP_GATE" 2>&1) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '无匹配的已通过回执' \
   && printf '%s' "$OUT" | grep -qE '"(systemMessage|decision)"'; then
  pass "stop-gate 端到端 rc=4 告警链（stale receipt -> 点名「无匹配的已通过回执」）"
else
  fail "stop-gate 未按 rc=4 点名 STALE 回执（rc=${RC}，输出：${OUT}）"
fi

# ⑰b 写匹配 receipt -> stop-gate 放行 + 清理 .needs-review
( cd "$TMPS" && CLAUDE_PROJECT_DIR="$TMPS" node "$HARNESS" receipt write <<<'{"taskId":"T2","reviewer":"bob","verdict":"pass","scope":"core"}'
) >/dev/null 2>&1
RC=0
OUT=$(cd "$TMPS" && CLAUDE_PROJECT_DIR="$TMPS" node "$STOP_GATE" 2>&1) || RC=$?
if [ "$RC" -eq 0 ] && [ ! -f "$TMPS/.claude/.needs-review" ] \
   && ! printf '%s' "$OUT" | grep -q '"decision":"block"'; then
  pass "stop-gate 端到端放行链（匹配 receipt -> 放行 + 清 .needs-review）"
else
  fail "stop-gate 匹配 receipt 未放行（rc=$RC, needs-review 残留=$([ -f "$TMPS/.claude/.needs-review" ] && echo YES || echo NO), 输出：${OUT}）"
fi
rm -rf "$TMPS"

# ⑱ pre-commit-check 端到端（hook→lib-harness→harness.mjs verify 链）
#   验重点：pre-commit-check.mjs 真调了 harness verify 并据 rc=2 阻断 commit（exit 2）、rc=0 放行。
#   stdin 喂 git commit JSON 模拟 PreToolUse hook；catalog verification 故意 FAIL。
PRECOMMIT="$ROOT/.claude/hooks/pre-commit-check.mjs"

# ⑱a catalog verification FAIL -> pre-commit exit 2（阻断 commit）
TMPP="$(mktemp -d)"
install_harness "$TMPP"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    version:1, modules:[{id:"core",paths:["core/**"],riskTier:"medium",verification:["chk"]}],
    riskChecks:{medium:["chk"]}, checks:{chk:{command:process.argv[2],class:"static"}}
  }));
' "$TMPP/.claude/harness/module-catalog.json" 'node -e "process.exit(1)"'
( cd "$TMPP" && git init -q && git config core.autocrlf false \
  && git config user.email t@t.t && git config user.name t \
  && mkdir -p core && echo "x" > core/a.ts && git add -A && git commit -qm init ) >/dev/null 2>&1
echo "stage-me" >> "$TMPP/core/a.ts" && ( cd "$TMPP" && git add -A ) >/dev/null 2>&1
RC=0
OUT=$(echo '{"tool_input":{"command":"git commit -m test"}}' | (cd "$TMPP" && CLAUDE_PROJECT_DIR="$TMPP" node "$PRECOMMIT") 2>&1) || RC=$?
if [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -q '大仓四态质量门未通过'; then
  pass "pre-commit 端到端 rc=2 阻断链（verification FAIL -> exit 2）"
else
  fail "pre-commit 未按 rc=2 阻断（rc=${RC}，输出：${OUT}）"
fi

# ⑱b 改 verification PASS -> pre-commit exit 0（放行）
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    version:1, modules:[{id:"core",paths:["core/**"],riskTier:"medium",verification:["chk"]}],
    riskChecks:{medium:["chk"]}, checks:{chk:{command:process.argv[2],class:"static"}}
  }));
' "$TMPP/.claude/harness/module-catalog.json" 'node -e "process.exit(0)"'
RC=0
OUT=$(echo '{"tool_input":{"command":"git commit -m test"}}' | (cd "$TMPP" && CLAUDE_PROJECT_DIR="$TMPP" node "$PRECOMMIT") 2>&1) || RC=$?
if [ "$RC" -eq 0 ]; then
  pass "pre-commit 端到端放行链（verification PASS -> exit 0）"
else
  fail "pre-commit verification PASS 应放行 exit 0（rc=${RC}，输出：${OUT}）"
fi

# ⑲c 无 catalog -> rc 3
TMPA="$(mktemp -d)"
( cd "$TMPA" && git init -q ) >/dev/null 2>&1
RC=0
OUT=$(cd "$TMPA" && CLAUDE_PROJECT_DIR="$TMPA" node "$HARNESS" arch-check) || RC=$?
if [ "$RC" -eq 3 ]; then
  pass "arch-check 无 catalog -> rc 3"
else
  fail "arch-check 无 catalog 应 rc 3（rc=${RC}，输出：${OUT}）"
fi
rm -rf "$TMPA"

# ⑳ fitness CLI：契约 = error 命中 rc 1 / 压制后 rc 0（--paths 显式指定，无需 catalog）
TMPF="$(mktemp -d)"
printf 'const apiKey = "AKIAABCDEFGHIJKLMNOP";\n' > "$TMPF/leak.ts"  # scan-secrets:ignore 假密钥，测的就是 fitness 规则本身
RC=0
OUT=$(cd "$TMPF" && CLAUDE_PROJECT_DIR="$TMPF" node "$HARNESS" fitness --paths leak.ts) || RC=$?
if [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -q '"no-secret-literal"'; then
  pass "fitness 密钥字面量 -> rc 1 + no-secret-literal 命中"
else
  fail "fitness 密钥应 rc 1（rc=${RC}，输出：${OUT}）"
fi
printf '// harness-fitness:ignore\nconst apiKey = "AKIAABCDEFGHIJKLMNOP";\n' > "$TMPF/leak.ts"  # scan-secrets:ignore 同上
RC=0
OUT=$(cd "$TMPF" && CLAUDE_PROJECT_DIR="$TMPF" node "$HARNESS" fitness --paths leak.ts) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"ok":true'; then
  pass "fitness 行内压制 -> rc 0"
else
  fail "fitness 压制后应 rc 0（rc=${RC}，输出：${OUT}）"
fi
rm -rf "$TMPF"

# ㉑ attributes CLI：契约 = blocking 属性未接线 rc 1 / 接线后 rc 0 / 无 catalog rc 3
TMPQ="$(mktemp -d)"; mkdir -p "$TMPQ/.claude/harness"
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    version: 1,
    modules: [{ id: "pay", paths: ["pay/**"], riskTier: "high", verification: ["lint"], attributes: { security: "critical" } }],
    checks: { lint: { command: "node --version", class: "static" } }
  }));
' "$TMPQ/.claude/harness/module-catalog.json"
RC=0
OUT=$(CLAUDE_PROJECT_DIR="$TMPQ" node "$HARNESS" attributes --catalog "$TMPQ/.claude/harness/module-catalog.json") || RC=$?
if [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -q '"unwiredBlocking":1'; then
  pass "attributes critical 声明未接线 -> rc 1 可见缺口"
else
  fail "attributes 未接线应 rc 1（rc=${RC}，输出：${OUT}）"
fi
node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    version: 1,
    modules: [{ id: "pay", paths: ["pay/**"], riskTier: "high", verification: ["sec"], attributes: { security: "critical" } }],
    checks: { sec: { command: "node --version", class: "security", attributes: ["security"] } }
  }));
' "$TMPQ/.claude/harness/module-catalog.json"
RC=0
OUT=$(CLAUDE_PROJECT_DIR="$TMPQ" node "$HARNESS" attributes --catalog "$TMPQ/.claude/harness/module-catalog.json") || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"ok":true'; then
  pass "attributes 接线后 -> rc 0"
else
  fail "attributes 接线后应 rc 0（rc=${RC}，输出：${OUT}）"
fi
rm -rf "$TMPQ"

# ㉔ adr-check CLI：契约 = 无 ADR rc 0 / 缺执法或幽灵引用 rc 1 / manual-only 与 retired 放行
TMPADR="$(mktemp -d)"
# ㉔a 无任何 ADR 文档 -> rc 0 + records:0
RC=0
OUT=$(cd "$TMPADR" && CLAUDE_PROJECT_DIR="$TMPADR" node "$HARNESS" adr-check) || RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '"records":0'; then
  pass "adr-check 无 ADR 文档 -> rc 0 nothing to enforce"
else
  fail "adr-check 无文档应 rc 0（rc=${RC}，输出：${OUT}）"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]