#!/usr/bin/env bash
# risk: medium
# test-hook-form.sh — hook-form.mjs 形态互转回归（exec form <-> string form，无依赖 claude CLI）。
# 契约：只转指向 .claude/hooks/<name>.mjs 的两种逐字模板，其余条目原样不动；往返无损（本仓 settings.json
#   --to string 再 --to exec 逐字节回到原样）；幂等；--check 四态 exec / string / mixed / none，mixed 退 1。
# 分级取舍：形态转坏的代价是 Cursor 侧闸全哑或 Claude Code 侧报 hook error，但只在显式 --hook-form string
#   时才走到，所以标 medium，不进 high。往返无损那条是硬约束，拿本仓真 settings 判，不另造。
# 依赖：node（目标机器只保证 node + git + coreutils）。对本仓只读，夹具都在临时目录。
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HF="$ROOT/.claude/scripts/hook-form.mjs"
[ -f "$HF" ] || { echo "test-hook-form: 缺 hook-form.mjs" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "SKIPPED: 无 node——hook-form.mjs 跑不了，未执行 != 通过。" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "===== test-hook-form ====="

PASS=0
FAIL=0
chk() {
    if [ "$1" -eq 0 ]; then
        PASS=$((PASS + 1)); echo "  [PASS] $2"
    else
        FAIL=$((FAIL + 1)); echo "  [FAIL] $2"
    fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}

# check <文件> —— 打印「输出/退出码」
check() {
    local out rc=0
    out=$(node "$HF" --check --file "$1" 2>&1) || rc=$?
    printf '%s/%s' "$out" "$rc"
}

# ---- HF-1 往返无损 ----
cp "$ROOT/.claude/settings.json" "$TMP/rt.json"
node "$HF" --to string --file "$TMP/rt.json" >/dev/null 2>&1
mid=$(check "$TMP/rt.json")
args_left=$(grep -c '"args"' "$TMP/rt.json" || true)
node "$HF" --to exec --file "$TMP/rt.json" >/dev/null 2>&1
chk "$([ "$mid" = "string/0" ] && [ "$args_left" = "0" ] && cmp -s "$TMP/rt.json" "$ROOT/.claude/settings.json" && echo 0 || echo 1)" \
    "HF-1 往返无损：本仓 settings --to string（全 string、零 args）再 --to exec 逐字节回原样" \
    "中途 string/0、args 0 处、回转后 cmp 一致" \
    "中途 $mid、args ${args_left} 处、cmp=$(cmp -s "$TMP/rt.json" "$ROOT/.claude/settings.json" && echo 一致 || echo 不一致)"

# ---- HF-2 --check 四态 ----
cat >"$TMP/mixed.json" <<'EOF'
{
  "statusLine": { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/scripts/statusline.mjs\"" },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-gate.mjs"], "timeout": 5 },
          { "type": "command", "command": "node .claude/hooks/notify.mjs", "asyncRewake": true, "timeout": 10 },
          { "type": "command", "command": "echo user-own" },
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/old-gate.sh", "timeout": 3 },
          { "type": "command", "command": "node", "args": ["/abs/path/.claude/hooks/abs.mjs"] }
        ]
      }
    ]
  }
}
EOF
printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo hi"}]}]}}\n' >"$TMP/none.json"
cp "$TMP/mixed.json" "$TMP/to-exec.json"
node "$HF" --to exec --file "$TMP/to-exec.json" >/dev/null 2>&1
cp "$TMP/mixed.json" "$TMP/to-string.json"
node "$HF" --to string --file "$TMP/to-string.json" >/dev/null 2>&1
got="$(check "$TMP/to-exec.json") $(check "$TMP/to-string.json") $(check "$TMP/mixed.json") $(check "$TMP/none.json")"
chk "$([ "$got" = "exec/0 string/0 mixed/1 none/0" ] && echo 0 || echo 1)" \
    "HF-2 --check 四态：exec / string / mixed（退 1）/ none（只有用户条目）" \
    "exec/0 string/0 mixed/1 none/0" "$got"

# ---- HF-3 非框架条目不动 + 其余键与键序 ----
# shellcheck disable=SC2016  # 单引号内是 JS 源码
pick='const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const hs = s.hooks.Stop[0].hooks;
process.stdout.write([JSON.stringify(s.statusLine), ...hs.map((h) => JSON.stringify(h))].join("\n"));'
before=$(node -e "$pick" "$TMP/mixed.json")
after=$(node -e "$pick" "$TMP/to-string.json")
keep_before=$(printf '%s\n' "$before" | sed -n '1p;4p;5p;6p')
keep_after=$(printf '%s\n' "$after" | sed -n '1p;4p;5p;6p')
conv=$(printf '%s\n' "$after" | sed -n '2p')
chk "$([ "$keep_before" = "$keep_after" ] && [ "$conv" = '{"type":"command","command":"node .claude/hooks/stop-gate.mjs","timeout":5}' ] && echo 0 || echo 1)" \
    "HF-3 只转框架两种模板：statusLine / 用户命令 / 历史 .sh / 绝对路径 args 原样不动，转过的键序 type, command, 其余" \
    "四条原样；stop-gate 成 {\"type\":\"command\",\"command\":\"node .claude/hooks/stop-gate.mjs\",\"timeout\":5}" \
    "原样=$([ "$keep_before" = "$keep_after" ] && echo Y || echo N)；stop-gate=$conv"
back=$(node -e "$pick" "$TMP/to-exec.json" | sed -n '3p')
# shellcheck disable=SC2016  # 单引号内是期望值原文：exec form 的 ${CLAUDE_PROJECT_DIR} 本来就是字面量，不该展开
chk "$([ "$back" = '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/notify.mjs"],"asyncRewake":true,"timeout":10}' ] && echo 0 || echo 1)" \
    "HF-3b string 转 exec：args 插在 command 后，其余键按原序（asyncRewake 在 timeout 前）" \
    '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/notify.mjs"],"asyncRewake":true,"timeout":10}' "$back"

# ---- HF-4 幂等 ----
cp "$TMP/to-string.json" "$TMP/idem.json"
out=$(node "$HF" --to string --file "$TMP/idem.json" 2>&1)
chk "$(cmp -s "$TMP/idem.json" "$TMP/to-string.json" && printf '%s' "$out" | grep -q 'converted=0' && echo 0 || echo 1)" \
    "HF-4 幂等：已是 string 再 --to string，converted=0 且文件逐字节不变" \
    "converted=0、cmp 一致" "$out；cmp=$(cmp -s "$TMP/idem.json" "$TMP/to-string.json" && echo 一致 || echo 不一致)"

# ---- HF-5 --file 与默认路径 ----
mkdir -p "$TMP/proj/.claude"
cp "$TMP/to-exec.json" "$TMP/proj/.claude/settings.json"
r_env=$(CLAUDE_PROJECT_DIR="$TMP/proj" node "$HF" --check 2>&1)
r_cwd=$(cd "$TMP/proj" && env -u CLAUDE_PROJECT_DIR node "$HF" --check 2>&1)
r_file=$(cd "$TMP" && env -u CLAUDE_PROJECT_DIR node "$HF" --check --file "$TMP/to-string.json" 2>&1)
rc_miss=0
node "$HF" --check --file "$TMP/nope.json" >/dev/null 2>&1 || rc_miss=$?
rc_bad=0
node "$HF" --to shell --file "$TMP/idem.json" >/dev/null 2>&1 || rc_bad=$?
chk "$([ "$r_env" = "exec" ] && [ "$r_cwd" = "exec" ] && [ "$r_file" = "string" ] && [ "$rc_miss" -eq 2 ] && [ "$rc_bad" -eq 2 ] && echo 0 || echo 1)" \
    "HF-5 --file 指定路径优先；不给时取 CLAUDE_PROJECT_DIR、再取 cwd；文件不在 / --to 值不对退 2" \
    "env=exec cwd=exec file=string 缺文件 rc=2 坏参数 rc=2" \
    "env=$r_env cwd=$r_cwd file=$r_file 缺文件 rc=$rc_miss 坏参数 rc=$rc_bad"

# ---- HF-T 独立补测（tester，不是作者写的）----
# 以下 fixture 一律由 node JSON.stringify(…, null, 2) 生成，保证是规范格式（往返逐字节无损的前提）。
# shellcheck disable=SC2016  # 单引号内是 JS 源码 / JSON 字面量，${CLAUDE_PROJECT_DIR} 本来就是字面量，不该展开
{
# mkset <文件> <hook JSON>... —— 一个 Stop 组，按序放入给定 hook 条目
mkset() {
    local f="$1"; shift
    node -e 'const hs = process.argv.slice(2).map((s) => JSON.parse(s));
require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ hooks: { Stop: [{ hooks: hs }] } }, null, 2) + "\n");' "$f" "$@"
}
# first_hook <文件> —— 打印第一条 hook 的紧凑 JSON
first_hook() {
    node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).hooks.Stop[0].hooks[0]));' "$1"
}

# ---- HF-T1 边界输入：两个方向都逐字不动 ----
n=0
while IFS='|' read -r label hook; do
    [ -n "$label" ] || continue
    n=$((n + 1)); f="$TMP/b$n.json"
    mkset "$f" "$hook"; cp "$f" "$f.orig"
    o1=$(node "$HF" --to string --file "$f" 2>&1); same1=$(cmp -s "$f" "$f.orig" && echo Y || echo N)
    o2=$(node "$HF" --to exec --file "$f" 2>&1); same2=$(cmp -s "$f" "$f.orig" && echo Y || echo N)
    ok=1
    [ "$same1" = Y ] && [ "$same2" = Y ] && printf '%s' "$o1" | grep -q 'converted=0' && printf '%s' "$o2" | grep -q 'converted=0' && ok=0
    chk "$ok" "HF-T1.$n 边界不动：$label（--to string / --to exec 都不改、converted=0）" \
        "两个方向 cmp 一致、converted=0" "string 后一致=$same1、exec 后一致=$same2；$(printf '%s' "$o1" | grep -o 'converted=[0-9]*')/$(printf '%s' "$o2" | grep -o 'converted=[0-9]*')"
done <<'LIST'
args 两个元素|{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/notify.mjs","--quiet"]}
string 形带参数|{"type":"command","command":"node .claude/hooks/x.mjs --flag"}
Windows 反斜杠路径|{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}\\.claude\\hooks\\x.mjs"]}
绝对路径 args|{"type":"command","command":"node","args":["/opt/proj/.claude/hooks/x.mjs"]}
绝对路径 string 形|{"type":"command","command":"node /opt/proj/.claude/hooks/x.mjs"}
command=node 但 args 空数组|{"type":"command","command":"node","args":[]}
历史 .sh 条目|{"type":"command","command":"\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/x.sh"}
.sh 的 exec 形|{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/x.sh"]}
string 形带尾随空格|{"type":"command","command":"node .claude/hooks/x.mjs "}
LIST

# ---- HF-T2 混合文件 ----
mkset "$TMP/m.json" \
    '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/a.mjs"]}' \
    '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/b.mjs"],"timeout":5}' \
    '{"type":"command","command":"node .claude/hooks/c.mjs"}' \
    '{"type":"command","command":"echo user"}'
g0=$(check "$TMP/m.json")
o_s=$(node "$HF" --to string --file "$TMP/m.json" 2>&1); g1=$(check "$TMP/m.json")
o_e=$(node "$HF" --to exec --file "$TMP/m.json" 2>&1); g2=$(check "$TMP/m.json")
c_s=$(printf '%s' "$o_s" | grep -o 'converted=[0-9]*'); c_e=$(printf '%s' "$o_e" | grep -o 'converted=[0-9]*')
chk "$([ "$g0" = "mixed/1" ] && [ "$g1" = "string/0" ] && [ "$g2" = "exec/0" ] && [ "$c_s" = "converted=2" ] && [ "$c_e" = "converted=3" ] && echo 0 || echo 1)" \
    "HF-T2 混合文件：mixed/1 → --to string 后 string（converted=2，只数真转的）→ --to exec 后 exec（converted=3，用户条目不计）" \
    "mixed/1 converted=2 string/0 converted=3 exec/0" "$g0 $c_s $g1 $c_e $g2"

# ---- HF-T3 --check 的空输入 ----
printf '{}\n' >"$TMP/e1.json"
printf '{"hooks":{}}\n' >"$TMP/e2.json"
printf '{"statusLine":{"type":"command","command":"node .claude/hooks/x.mjs"}}\n' >"$TMP/e3.json"
printf '{"hooks":{"Stop":{},"Pre":"x","Post":null,"Mid":[{"hooks":"x"},null,{"hooks":[null,1,"s"]}]}}\n' >"$TMP/e4.json"
i=0
for desc in '{}' '{"hooks":{}}' '只有 statusLine（其 command 恰好长得像 string form，也不计）' 'hooks 值不是数组 / 组不合规 / 条目不是对象'; do
    i=$((i + 1)); got=$(check "$TMP/e$i.json")
    chk "$([ "$got" = "none/0" ] && echo 0 || echo 1)" "HF-T3.$i --check：$desc → none、退 0、不崩" "none/0" "$got"
done
mkset "$TMP/e5.json" '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/a.mjs"]}'
node -e 'const f=process.argv[1],fs=require("node:fs");const d=JSON.parse(fs.readFileSync(f,"utf8"));d.hooks.Stop2={};fs.writeFileSync(f,JSON.stringify(d,null,2)+"\n");' "$TMP/e5.json"
got=$(check "$TMP/e5.json")
chk "$([ "$got" = "exec/0" ] && echo 0 || echo 1)" "HF-T3.5 非数组事件（Stop2: {}）不拖垮同文件里正常的 exec 条目" "exec/0" "$got"

# ---- HF-T4 参数错误：退 2 且不写文件 ----
cp "$TMP/m.json" "$TMP/pe.json"; node "$HF" --to string --file "$TMP/pe.json" >/dev/null 2>&1
mkset "$TMP/pe2.json" '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/a.mjs"]}' '{"type":"command","command":"node .claude/hooks/c.mjs"}'
for pf in "$TMP/pe.json" "$TMP/pe2.json"; do cp "$pf" "$pf.orig"; done
sleep 1
j=0
for argset in "--to shell" "--file F --to" "--check --to exec" "--check --to string" "--file /nonexistent/x.json --to string" "--bogus" "--to exec --bogus" "--check --file"; do
    j=$((j + 1)); rc=0; err=""
    for pf in "$TMP/pe.json" "$TMP/pe2.json"; do
        # shellcheck disable=SC2086  # 有意按词拆分
        a=$(echo "$argset" | sed "s#F#$pf#"); [ "${argset#*--file F}" != "$argset" ] || a="$a --file $pf"
        [ "${argset#--file /nonexistent}" != "$argset" ] && a="$argset"
        # shellcheck disable=SC2086
        node "$HF" $a >/dev/null 2>"$TMP/err.txt"; r=$?
        [ "$r" -eq 2 ] || rc=$r
        [ -s "$TMP/err.txt" ] || err="无stderr"
        cmp -s "$pf" "$pf.orig" || err="$err 文件被改($pf)"
    done
    chk "$([ "$rc" -eq 0 ] && [ -z "$err" ] && echo 0 || echo 1)" "HF-T4.$j 参数错误「$argset」→ 退 2、stderr 有说明、两份夹具逐字节不变" "rc=2、有 stderr、cmp 一致" "非2的rc=$rc 问题=${err:-无}"
done

# ---- HF-T5 其余键保真 ----
mkset "$TMP/k.json" \
    '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/a.mjs"],"note":"x","meta":{"a":[1,2]},"timeout":0,"asyncRewake":false,"matcher":"Bash"}' \
    '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/b.mjs"],"timeout":0,"zeta":null,"alpha":{"b":{"c":[]}}}'
cp "$TMP/k.json" "$TMP/k.orig"
node "$HF" --to string --file "$TMP/k.json" >/dev/null 2>&1
mid_first=$(first_hook "$TMP/k.json")
node "$HF" --to exec --file "$TMP/k.json" >/dev/null 2>&1
chk "$(cmp -s "$TMP/k.json" "$TMP/k.orig" && [ "$mid_first" = '{"type":"command","command":"node .claude/hooks/a.mjs","note":"x","meta":{"a":[1,2]},"timeout":0,"asyncRewake":false,"matcher":"Bash"}' ] && echo 0 || echo 1)" \
    "HF-T5 其余键保真：note / 嵌套 meta / timeout:0 / asyncRewake:false / null / 空数组 往返逐字节不变，中间态键序 type, command, 其余按原序" \
    '中间态 {"type":"command","command":"node .claude/hooks/a.mjs","note":"x","meta":{"a":[1,2]},"timeout":0,"asyncRewake":false,"matcher":"Bash"}；往返 cmp 一致' \
    "中间态 $mid_first；cmp=$(cmp -s "$TMP/k.json" "$TMP/k.orig" && echo 一致 || echo 不一致)"

# type 缺失：rebuild 有意补成 "command" 并放首位（这是有意补齐，不是原样保留）
mkset "$TMP/nt1.json" '{"command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/a.mjs"],"timeout":7}'
mkset "$TMP/nt2.json" '{"timeout":7,"command":"node .claude/hooks/a.mjs"}'
node "$HF" --to string --file "$TMP/nt1.json" >/dev/null 2>&1; r1=$(first_hook "$TMP/nt1.json")
node "$HF" --to exec --file "$TMP/nt2.json" >/dev/null 2>&1; r2=$(first_hook "$TMP/nt2.json")
chk "$([ "$r1" = '{"type":"command","command":"node .claude/hooks/a.mjs","timeout":7}' ] && echo 0 || echo 1)" \
    "HF-T5b type 缺失的 exec 条目 --to string：type 补成 command 且在首位（有意补齐）" \
    '{"type":"command","command":"node .claude/hooks/a.mjs","timeout":7}' "$r1"
chk "$([ "$r2" = '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/a.mjs"],"timeout":7}' ] && echo 0 || echo 1)" \
    "HF-T5c type 缺失且 timeout 在 command 前的 string 条目 --to exec：type 补齐置首，command / args 紧随，timeout 殿后" \
    '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/a.mjs"],"timeout":7}' "$r2"

# ---- HF-T6 无改动不写文件 ----
mkset "$TMP/w-s.json" '{"type":"command","command":"node .claude/hooks/a.mjs"}' '{"type":"command","command":"echo u"}'
mkset "$TMP/w-e.json" '{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.claude/hooks/a.mjs"]}'
mt_s=$(stat -c %y "$TMP/w-s.json"); mt_e=$(stat -c %y "$TMP/w-e.json")
sleep 1.1
o_ws=$(node "$HF" --to string --file "$TMP/w-s.json" 2>&1); o_we=$(node "$HF" --to exec --file "$TMP/w-e.json" 2>&1)
mt_s2=$(stat -c %y "$TMP/w-s.json"); mt_e2=$(stat -c %y "$TMP/w-e.json")
chk "$([ "$mt_s" = "$mt_s2" ] && [ "$mt_e" = "$mt_e2" ] && printf '%s\n%s\n' "$o_ws" "$o_we" | grep -c 'converted=0' | grep -q '^2$' && echo 0 || echo 1)" \
    "HF-T6 已是目标形态：--to 同形态 converted=0 且 mtime（纳秒）前后相同，即没有写文件" \
    "两个文件 mtime 不变、各 converted=0" "string 文件 mtime 变=$([ "$mt_s" = "$mt_s2" ] && echo 否 || echo 是)；exec 文件 mtime 变=$([ "$mt_e" = "$mt_e2" ] && echo 否 || echo 是)；$(printf '%s' "$o_ws" | grep -o 'converted=[0-9]*') $(printf '%s' "$o_we" | grep -o 'converted=[0-9]*')"
}

echo ""
echo "==== test-hook-form：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ] || { echo "test-hook-form: failed" >&2; exit 1; }
echo "test-hook-form: passed"
