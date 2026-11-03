#!/usr/bin/env bash
# risk: low
# test-hooks-settings.sh — 注册面回归：settings.json 的 hook 必须是两种合法形态之一、全文件同一形态，
#   且指到的文件真实存在。exec form = command "node" + args[0] `${CLAUDE_PROJECT_DIR}/.claude/hooks/<name>.mjs`
#   （框架默认）；string form = command `node .claude/hooks/<name>.mjs`、没有 args 键（Cursor 不认 args，
#   setup --hook-form string 才生成）。两种混着挂说明转换半路断了，一样判红。
#
# 分级取舍（2026-09-10 测试预算表）：注册面判错的代价是「每次事件报一次 hook error」，
#   吵但不致命，所以只留两条主判据——形态（两种之一且全文件统一）与落地（文件在）。
#   timeout/matcher 逐条对拍、statusLine、零 .sh/.ps1 残留、node --check 那批穷举不再养；
#   两侧集合对拍归 test-hook-parity.sh。唯一留下的 matcher 断言是 tdd-gate 挂在哪个事件组：
#   它挂错组不是吵一声，是闸整条失效——挂 Bash 那版只能靠猜命令文本，猜不到派 Sub-Agent 这件事。
#
# 依赖：node（解析 JSON，故意不用 jq——目标机器只保证 node + git + coreutils）。
# 纪律：对本仓只读；每条断言打印 EXPECT / GOT，判定不依赖措辞。
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SETTINGS="$ROOT/.claude/settings.json"

echo "===== test-hooks-settings ====="

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node——settings.json 解析不了，未执行 != 通过。" >&2
    exit 1
fi

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

# sq <js 表达式> —— 在 settings.json 上求值，打印结果。作用域里可用：s（整份 settings）、
# entries（[{ev, matcher, h}] 展平的 hook 条目）、ROOT、fs / path、nameOf、formOf、hookPath。
sq() {
    # shellcheck disable=SC2016  # 单引号内是要喂给 node -e 的 JS 源码，故意不让 shell 展开其中的 $ 记号
    node -e '
const fs = require("node:fs");
const path = require("node:path");
const ROOT = process.argv[1];
const s = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const entries = [];
for (const ev of Object.keys(s.hooks || {})) {
  for (const g of (s.hooks[ev] || [])) {
    for (const h of (g.hooks || [])) entries.push({ ev: ev, matcher: g.matcher || "", h: h });
  }
}
const nameOf = (h) => {
  const a = Array.isArray(h.args) && h.args.length ? String(h.args[0]) : String(h.command || "");
  const m = a.match(/hooks[\/\\]([A-Za-z0-9_-]+)\.(mjs|sh|ps1)$/);
  return m ? m[1] : "?";
};
// formOf：exec / string / bad。与 hook-form.mjs 同口径，只认两个逐字模板。
const formOf = (h) => {
  if (h.command === "node" && Array.isArray(h.args) && h.args.length === 1 &&
      /^\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/hooks\/[A-Za-z0-9_-]+\.mjs$/.test(String(h.args[0]))) return "exec";
  if (!("args" in h) && /^node \.claude\/hooks\/[A-Za-z0-9_-]+\.mjs$/.test(String(h.command || ""))) return "string";
  return "bad";
};
// hookPath：exec form 取 args[0] 换掉占位符，string form 取 node 后面那段按项目根拼。
const hookPath = (h) => formOf(h) === "string"
  ? path.join(ROOT, String(h.command).slice(5))
  : String((h.args || [])[0] || "").split("${CLAUDE_PROJECT_DIR}").join(ROOT);
process.stdout.write(String(eval(process.argv[3])));
' "$ROOT" "$SETTINGS" "$1"
}

# ---------------------------------------------------------------------------
echo ""

N=$(sq 'entries.length')
chk "$([ "${N:-0}" -gt 0 ] && echo 0 || echo 1)" \
    "HS-1 settings.json 是合法 JSON 且能展平出 hook 条目（展不出 = 下面两条空转全绿）" \
    "至少 1 条 hook 条目" "$N 条"

BAD_CMD=$(sq 'entries.filter(e => formOf(e.h) === "bad").map(e => e.ev + ":" + nameOf(e.h)).join(" ") || "无"')
FORMS=$(sq '[...new Set(entries.map(e => formOf(e.h)).filter(f => f !== "bad"))].sort().join("+") || "无"')
chk "$([ "$BAD_CMD" = "无" ] && { [ "$FORMS" = "exec" ] || [ "$FORMS" = "string" ]; } && echo 0 || echo 1)" \
    "HS-2 每条 hook 都是 exec form 或 string form、全文件同一形态，零条 .sh/.ps1（混挂 = 转换半路断了）" \
    "零条不合法形态，形态恰好一种（exec 或 string）" "形态：$FORMS；违规：$BAD_CMD"

BAD_ARG=$(sq 'entries.filter(e => formOf(e.h) !== "bad" && !fs.existsSync(hookPath(e.h))).map(e => nameOf(e.h) + "<-" + hookPath(e.h)).join(" ") || "无"')
chk "$([ "$BAD_ARG" = "无" ] && echo 0 || echo 1)" \
    "HS-3 每条 hook 指向的文件真实存在（exec form 看 args[0]，string form 看 command；注册了但没装 = 每次事件都报 hook error）" \
    "零个指空的 hook 路径" "指空：$BAD_ARG"

TD_WIRE=$(sq 'entries.filter(e => nameOf(e.h) === "tdd-gate").map(e => e.ev + "/" + (e.matcher || "<空>")).sort().join(" ") || "没注册"')
chk "$([ "$TD_WIRE" = "PreToolUse/Agent|Task" ] && echo 0 || echo 1)" \
    "HS-4 tdd-gate 恰好挂在 PreToolUse 的 Agent|Task 组、不在 Bash 组（派 implementer 走子代理工具，Claude Code 叫 Agent、Cursor 叫 Task，永远不经过命令行）" \
    "恰好一条 PreToolUse/Agent|Task" "实际：$TD_WIRE"

# ---------------------------------------------------------------------------
echo ""
echo "==== test-hooks-settings：PASS=$PASS FAIL=$FAIL ===="
if [ "$FAIL" -gt 0 ]; then
    echo "test-hooks-settings: failed（settings 的 hook 注册形态或落地文件对不上）" >&2
    exit 1
fi
echo "test-hooks-settings: passed（$N 条 hook 全 $FORMS form 且指向的文件都装着）"
