#!/usr/bin/env bash
# risk: low
# test-gate-audit.sh — gate-audit 误报回归测试（无依赖 claude CLI）。
# 契约：「(b) 零记录死闸」段只该列**真闸**（import gatelog.mjs、经 gateLog 写账本的 block 钩子）
#   里从没拦过的那些；信息类 hook 不是闸，列进去就是误报死闸，把噪声当治理负债。真闸/信息类的
#   判据 = 钩子源码里有没有 gatelog（独立于 gate-audit 自身实现，按 Spec 取真值）。
# 另带一条防空转：注册闸集合若算成空集，(b) 段恒空——「没有死闸」与「压根没算」输出一模一样，
#   只有把 (c) 的注册数与本文件自己数出的真闸数对拍才分得开。扫真实 cc-base .claude/，锁
#   「(b) 段不含某名」与「注册数对得上」，不锁易变的拦截计数。
set -eu

CLAUDE_DIR=$(cd "$(dirname "$0")/.." && pwd)
AUDIT="$CLAUDE_DIR/scripts/gate-audit.sh"
[ -x "$AUDIT" ] || { echo "test-gate-audit: 缺 gate-audit.sh：$AUDIT" >&2; exit 1; }

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }

# 跑 gate-audit，从仓库根扫真实账本。
OUT=$(cd "$CLAUDE_DIR/.." && bash "$AUDIT" 2>&1) || { echo "test-gate-audit: gate-audit 执行失败" >&2; echo "$OUT" >&2; exit 1; }

# 抽「(b) 零记录」段：自 (b) 标题行起，至 (c) 汇总标题前止。
SECTION_B=$(printf '%s\n' "$OUT" | awk '/\(b\) 零记录/{f=1;next} /\(c\) 汇总/{f=0} f')

# 真闸 / 信息类都从 hooks/*.mjs 现算（lib/ 是子目录，不被 * 匹配到，不用额外排除）：
#   注册 = settings.json 的 args[0] 里出现 hooks/<name>.mjs（exec form 之后路径只在 args 里，
#          不再有 command 字符串可 grep；static-check 不注册，天然落选）
#   真闸 = 源码里出现 gatelog（import hooks/lib/gatelog.mjs 的那批）
info_only=()
real_gates=()
for h in "$CLAUDE_DIR"/hooks/*.mjs; do
  [ -f "$h" ] || continue
  base=$(basename "$h" .mjs)
  grep -q "/hooks/${base}\.mjs\"" "$CLAUDE_DIR/settings.json" 2>/dev/null || continue
  if grep -q 'gatelog' "$h" 2>/dev/null; then
    real_gates+=("$base")
  else
    info_only+=("$base")
  fi
done

[ "${#info_only[@]}" -gt 0 ] || { echo "test-gate-audit: 没探到任何信息类 hook，断言前提不成立" >&2; exit 1; }
[ "${#real_gates[@]}" -gt 0 ] || { echo "test-gate-audit: 没探到任何真闸，断言前提不成立（settings 的 args 里一个 hooks/*.mjs 都没有？）" >&2; exit 1; }

# 防空转断言：(c) 汇总里的「注册钩子」数必须等于本文件自己数出来的真闸数。
# gate-audit 若还按 hooks/*.sh 现算注册清单，迁移后它会数出 0 个，(b) 段随之恒空——
# 下面那组「信息类不在 (b) 里」会全绿，而闸其实早就不看了。
REG_N=$(printf '%s\n' "$OUT" | sed -n 's/.*注册钩子[^0-9]*\([0-9][0-9]*\).*/\1/p' | head -1)
if [ "${REG_N:-x}" = "${#real_gates[@]}" ]; then
  pass "(c) 注册钩子数 = 源码里的真闸数（$REG_N 个）"
else
  fail "(c) 注册钩子数 $REG_N != 源码里的真闸数 ${#real_gates[@]}（真闸：${real_gates[*]}）——gate-audit 的注册清单算错了或压根没算"
fi

# 核心断言：(b) 死闸段**不该**出现任何信息类 hook。
for h in "${info_only[@]}"; do
  if printf '%s\n' "$SECTION_B" | grep -qE "•[[:space:]]+${h}\$"; then
    fail "信息类 hook 被误列进 (b) 死闸段：${h}（它不调 gateLog，不是闸）"
  else
    pass "信息类 hook 未出现在 (b) 死闸段：$h"
  fi
done

# ── 以下三条锁 gate-audit.sh:68 的判据错：零拦停被当成「疑似死闸/黑箱」。
# 账本只在**拦停时**写（pre-commit-check.mjs:169/172、no-direct-code-guard.mjs:29、
# harness-async-verify.mjs:76/85），脚本没有「跑过 N 次」这个分母，所以「零记录」只等于
# 从没拦过，推不出死闸。本仓这三个零记录闸的前置条件压根不在：tsconfig.json 0 个、.py 0 个、
# module-catalog.json 不存在；同样这三个在下游 digifiber-conflation-claude 的账本里拦了 33 次
# （no-direct-code-guard 28 / harness-async-verify 5）——框架仓审自己的闸会系统性低估
# 「为下游消费者而存在」的那批。判词照旧就会把它们砍掉，所以按目标行为锁，不按现实现锁。
# 结构锚点只认 (a)(b)(c)：上面的 SECTION_B 锚的是「(b) 零记录」，那几个字一改它就空、
# 上面 11 条信息类断言会跟着空转成假绿，所以下面这三条自己另抽一份。
B_TITLE=$(printf '%s\n' "$OUT" | grep -F '(b)' | head -1)
SEC_B=$(printf '%s\n' "$OUT" | awk '/\(b\)/{f=1;next} /\(c\)/{f=0} f')

# chk <判定 0=过/1=不过> <标题> <EXPECT> <GOT>——计数复用上面的 pass/fail。
chk() {
  if [ "$1" -eq 0 ]; then pass "$2"; else fail "$2"; fi
  echo "         EXPECT $3"
  echo "         GOT    $4"
}
inb() { printf '%s\n' "$SEC_B" | grep -qF -- "$1"; }   # 只在 (b) 段内找
inh() { printf '%s\n' "$B_TITLE" | grep -qE -- "$1"; } # 只在 (b) 标题行里找

# 零拦停 ≠ 死闸：旧判词不许再出现在任何一行输出里。
# 正向合取防空转：输出整份为空时「不含某词」恒成立，所以 (b) 标题行必须真的在场。
DEAD_WORDS=$(printf '%s\n' "$OUT" | grep -nF -e 疑似死闸 -e 黑箱 | tr '\n' ' ')
C=0
[ -n "$B_TITLE" ] || C=1
[ -z "$DEAD_WORDS" ] || C=1
chk "$C" "(b) 零拦停闸不再被下死闸判词" \
  "(b) 标题行在场，且整份输出不含「疑似死闸」「黑箱」——没有「跑过 N 次」这个分母，零拦停推不出死闸" \
  "(b)标题=[${B_TITLE:-缺}] 判词命中=[${DEAD_WORDS:-无}]"

# 标题要点明零拦停的两种无害解释：前置条件不在本仓 / 威慑生效。
# 「威慑」收同义的「震慑」，免得换一个字被判假红；两个锚点缺任一即红。
T_PRE=无; T_DET=无
if inh 前置条件;    then T_PRE=有; fi
if inh '威慑|震慑'; then T_DET=有; fi
C=0
[ "$T_PRE" = 有 ] || C=1
[ "$T_DET" = 有 ] || C=1
chk "$C" "(b) 标题点明零拦停的两种无害解释" \
  "(b) 标题行里同时出现「前置条件」与「威慑」（收同义「震慑」）" \
  "前置条件=$T_PRE 威慑=$T_DET 标题=[${B_TITLE:-缺}]"

# 列出零拦停闸之后要打本仓能力上下文三项事实 + 退役前查下游账本的提示。
# 这几条一律只在 (b) 段内比：gate-block.log 在 (c) 的账本清单里本来就有一处，
# 拿整份输出比它恒真，等于免检。
A_CAT=无; A_TS=无; A_PY=无; A_DOWN=无; A_LOG=无
if inb catalog;             then A_CAT=有;  fi
if inb tsconfig;            then A_TS=有;   fi
if inb '.py' || inb Python; then A_PY=有;   fi
if inb 下游;                then A_DOWN=有; fi
if inb gate-block.log;      then A_LOG=有;  fi
LAST_BULLET=$(printf '%s\n' "$SEC_B" | grep -nF '•' | tail -1 | cut -d: -f1)
FIRST_CTX=$(printf '%s\n' "$SEC_B" | grep -nF 'catalog' | head -1 | cut -d: -f1)
C=0
for v in "$A_CAT" "$A_TS" "$A_PY" "$A_DOWN" "$A_LOG"; do [ "$v" = 有 ] || C=1; done
if [ -n "$LAST_BULLET" ] && [ -n "$FIRST_CTX" ]; then
  ORD="列表末行=$LAST_BULLET 上下文首行=$FIRST_CTX"
  [ "$FIRST_CTX" -gt "$LAST_BULLET" ] || C=1
elif [ -z "$LAST_BULLET" ]; then
  ORD="不判（(b) 段当下没有零拦停闸可列）"
else
  ORD="不判（上下文没打出来，左边几列已报红）"
fi
chk "$C" "(b) 零拦停名单之后打出本仓能力上下文 + 下游账本提示" \
  "(b) 段内有 catalog / tsconfig / .py（或 Python）三项事实，加「下游」与「gate-block.log」，且排在零拦停名单之后" \
  "catalog=$A_CAT tsconfig=$A_TS py=$A_PY 下游=$A_DOWN 账本=$A_LOG 顺序：$ORD"

echo ""
echo "==== test-gate-audit：PASS=$PASS FAIL=$FAIL ===="
if [ "$FAIL" -gt 0 ]; then
  echo "test-gate-audit: failed（注册闸清单算错，或信息类 hook 被误报为死闸；(b) 段实际内容如下）" >&2
  printf '%s\n' "$SECTION_B" | sed 's/^/    /' >&2
  exit 1
fi
echo "test-gate-audit: passed（注册闸数对得上，(b) 死闸段不含任何信息类 hook）"
