#!/usr/bin/env bash
# risk: high
# test-release-manifest.sh — release 排除表的成员一致性回归（只需 node）。
# 锁 core.mjs 的 STATE_EXCLUDE：这张表决定哪些运行态产物不进 diff 指纹与 manifest 审计，
#   表长出新成员时新成员天生免检——把 core.mjs 那份与本文件写死的那份逐条比一次，
#   加一条、改一条、删一条都在这里红并打印差在哪。
# 抽取自检写死条数（不写 >=）：抽取正则半坏时只抽到一部分，逐条比对会在空转而闸不响。
# 老化退休（2026-09-15）：STATE_EXCLUDE_PATHS / STATE_EXCLUDE_PREFIXES 两条同形比对删掉了
#   （同一契约的三个变体留最长的这条）；原先那套沙箱 + release 行为断言早已只剩定义没有调用，
#   一并清干净。四份排除表的字面口径另由 test-setup.sh ⑥ 比对。
# 用法：bash test-release-manifest.sh [harness.mjs 路径]
#   带参数是给突变验证用的——把引擎整目录拷到 /tmp、在副本上删规则，跑同一份断言看它红不红。
set -eu

SRC=$(cd "$(dirname "$0")/.." && pwd)
ENTRY=${1:-"$SRC/harness/harness.mjs"}

echo "===== test-release-manifest ====="
command -v node >/dev/null 2>&1 || { echo "SKIPPED: 无 node——未执行 != 通过。"; exit 0; }
[ -f "$ENTRY" ] || { echo "test-release-manifest: 找不到引擎入口 $ENTRY" >&2; exit 1; }

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }

TRACKED_CASES="
:(exclude).claude/.needs-review
:(exclude).claude/.needs-review.lock
:(exclude).claude/.fast-mode
:(exclude).claude/.tdd-exempt
:(exclude).claude/.red-verified
:(exclude).claude/.runtime/**
:(exclude).claude/evidence/**
:(exclude).claude/harness/receipts/**
:(exclude).claude/harness/waivers/**
:(exclude).claude/harness/trend/**
:(exclude).claude/harness/state/**
:(exclude).claude/harness/evidence/**
:(exclude).claude/worktrees/**
"

CORE_FILE="$(cd "$(dirname "$ENTRY")" && pwd)/lib/core.mjs"
EXP_EXCLUDE=13

# 从被测那份 core.mjs 里把数组字面量的字符串成员抠出来（单引号用 charCode 拼，避开 shell 引号地狱）
dump_table() {
  node -e '
const fs = require("fs");
const Q = String.fromCharCode(39);
const src = fs.readFileSync(process.argv[1], "utf8");
const m = new RegExp("const\\s+" + process.argv[2] + "\\s*=\\s*\\[([^\\]]*)\\]").exec(src);
if (!m) { console.log("<TABLE-NOT-FOUND>"); process.exit(0); }
const re = new RegExp(Q + "([^" + Q + "]*)" + Q, "g");
const out = [];
let x;
while ((x = re.exec(m[1])) !== null) out.push(x[1]);
for (const v of out) console.log(v);
' "$CORE_FILE" "$1" 2>/dev/null
}

cmp_table() { # $1=core 表名  $2=写死条数  $3=本文件的成员清单（已排序）  $4=来源说明
  local tname="$1" want="$2" mine="$3" src="$4"
  local got n_got n_mine
  got=$(dump_table "$tname" | sort)
  n_got=$(printf '%s\n' "$got" | sed '/^$/d' | wc -l | tr -d ' ')
  n_mine=$(printf '%s\n' "$mine" | sed '/^$/d' | wc -l | tr -d ' ')
  if [ "$got" = "<TABLE-NOT-FOUND>" ] || [ "$n_got" -eq 0 ]; then
    fail "⑥ 抽取坏了：在 $CORE_FILE 里没抠出 $tname 的成员（不是表变了，是本段的抽取正则失效了）"
    return
  fi
  if [ "$n_got" -eq "$want" ] && [ "$n_mine" -eq "$want" ] && [ "$got" = "$mine" ]; then
    pass "⑥ $tname 的 $want 条成员与本文件$src 逐条一致（表长新成员时这里会红）"
  else
    fail "⑥ $tname 与本文件$src 对不上：core.mjs=$n_got 本文件=$n_mine 写死期望=${want}。core 独有：[$(comm -23 <(printf '%s\n' "$got") <(printf '%s\n' "$mine") | tr '\n' ' ')] 本文件独有：[$(comm -13 <(printf '%s\n' "$got") <(printf '%s\n' "$mine") | tr '\n' ' ')]"
  fi
}

MINE_EXCLUDE=$(printf '%s\n' "$TRACKED_CASES" | sed '/^$/d' | sort)
cmp_table STATE_EXCLUDE "$EXP_EXCLUDE" "$MINE_EXCLUDE" "TRACKED_CASES"

echo ""
echo "==== test-release-manifest：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ]
