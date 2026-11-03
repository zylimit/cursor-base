#!/usr/bin/env bash
# risk: low
# test-three-file-sync-gate.sh — 三文件同步闸的改动集回归（无依赖 claude CLI）。
# 契约：一个工作单元若有未提交的代码/**家底**改动而 progress.md 未同步，Stop 闸须出提醒。
#   家底 = .claude/** 下的可控文件（CLAUDE.md / agents / skills / settings.json 等），只有
#   .claude/evidence/（账本，机器写）除外。本闸三档都是 advise：出 systemMessage、不出
#   decision:block——围绕「拦停」写的断言已随 Phase A 作废，这里判「有提醒且没拦」。
# 留一正一反（2026-09-10 预算表）：家底 .md 改动要提醒（扩展名表漏 .md/.json 的老形态）、
#   evidence 账本不提醒（边界）；未跟踪新目录、普通代码对照那批退休。临时仓建 mktemp，trap 清理。
set -eu

SRC=$(cd "$(dirname "$0")/.." && pwd)
HOOK="$SRC/hooks/three-file-sync-gate.mjs"
# .mjs 由 node 拉起，不需要执行位（执行位只对 shebang 生效）——判 -f 就够，判 -x 会变成恒红。
[ -f "$HOOK" ] || { echo "test-three-file-sync-gate: 缺 hook：$HOOK" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "test-three-file-sync-gate: 无 node——hook 是 .mjs，跑不起来；未执行 != 通过。" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
# 干净的临时仓：progress.md + 家底 + evidence 账本 + 档位表，全部已提交。
# 档位表随仓一起装并提交：不装就是在测一条不存在的兼容路径，未跟踪则会把沙箱抬成 strict。
fresh_repo() {
  local t="$1"
  rm -rf "$t"
  mkdir -p "$t/.claude/agents" "$t/.claude/evidence" "$t/.claude/harness" "$t/src"
  cp "$SRC/harness/profile.json" "$t/.claude/harness/profile.json" 2>/dev/null || true
  git -C "$t" init -q
  git -C "$t" config user.email t@t.t; git -C "$t" config user.name t
  printf '# progress\n' > "$t/progress.md"
  printf '# claude\n' > "$t/.claude/CLAUDE.md"; printf '# agent\n' > "$t/.claude/agents/impl.md"
  printf 'echo hi\n' > "$t/src/app.sh"; printf 'log\n' > "$t/.claude/evidence/gate-block.log"
  git -C "$t" add -A >/dev/null 2>&1; git -C "$t" -c commit.gpgsign=false commit -qm init >/dev/null 2>&1
}

run_gate() { CLAUDE_PROJECT_DIR="$1" node "$HOOK" 2>/dev/null; }
advised() {
  case "$1" in *'"systemMessage"'*) ;; *) return 1 ;; esac
  case "$1" in *'"decision":"block"'*|*'"decision": "block"'*) return 1 ;; esac
  return 0
}

echo "===== test-three-file-sync-gate ====="

echo "── 红：只改家底文件，progress 未同步 → 应出提醒 ──"
t="$TMP/repo"; fresh_repo "$t"
printf 'changed\n' >> "$t/.claude/CLAUDE.md"
out=$(run_gate "$t")
if advised "$out"; then
  pass "改家底 .claude/CLAUDE.md（progress 未同步）→ 闸出 systemMessage 提醒且不 block"
else
  fail "改家底 .claude/CLAUDE.md（progress 未同步）→ 漏判或改成了硬拦（期望 systemMessage 且无 decision:block，实得：[${out}]）"
fi

echo "── 边界：只改 .claude/evidence/ 账本，progress 未同步 → 不该出声 ──"
fresh_repo "$t"
printf 'more log\n' >> "$t/.claude/evidence/gate-block.log"
out=$(run_gate "$t")
if [ -z "$out" ]; then
  pass ".claude/evidence/ 改动 → 闸放行（账本机器写，不计入家底）"
else
  fail ".claude/evidence/ 改动被判成家底改动了（期望零输出，实得：[${out}]）"
fi

# ---- advise 档去重：同一份脏清单一小时内只提醒一次（下游两天 86 次、同一文件例子 62 次）----
# 去重标记 .claude/.three-file-sync-advised 在框架里由 .claude/.gitignore 挡住；临时仓没装那份，
# 用 info/exclude 等价挡掉——否则标记本身成了未跟踪的家底改动，签名每轮都变，测的就不是去重。
LOGF=".claude/evidence/gate-block.log"
tflog() { grep -c 'three-file-sync-gate' "$1/$LOGF" 2>/dev/null || true; }
dedup_repo() {
  fresh_repo "$1"
  mkdir -p "$1/.git/info"; printf '.claude/.three-file-sync-advised\n.claude/.runtime/\n' >> "$1/.git/info/exclude"
}

echo "── 去重 TS1：同一脏清单第二次 Stop → 静默且不写账本 ──"
t="$TMP/ts1"; dedup_repo "$t"
printf 'changed\n' >> "$t/src/app.sh"
o1=$(run_gate "$t"); n1=$(tflog "$t")
o2=$(run_gate "$t"); n2=$(tflog "$t")
if advised "$o1" && [ -z "$o2" ] && [ "$n1" = 1 ] && [ "$n2" = 1 ]; then
  pass "TS1 第一次提醒且账本 1 条；同一清单第二次零输出、账本仍 1 条"
else
  fail "TS1 同一清单第二次应静默不记账（o1=[${o1}] o2=[${o2}] 账本=${n1}/${n2}）"
fi

echo "── 去重 TS2：清单变了 → 再提醒 ──"
printf 'echo two\n' > "$t/src/two.sh"
o3=$(run_gate "$t"); n3=$(tflog "$t")
if advised "$o3" && [ "$n3" = 2 ]; then pass "TS2 多了 src/two.sh → 再提醒、账本 2 条"
else fail "TS2 清单变了应再提醒（实得：[${o3}] 账本=${n3}）"; fi

echo "── 去重 TS3：标记 ts 改老（超 60 分钟）→ 同一清单再提醒 ──"
sed -i 's/^ts=.*/ts=1000/' "$t/.claude/.three-file-sync-advised"
o4=$(run_gate "$t"); n4=$(tflog "$t")
if advised "$o4" && [ "$n4" = 3 ]; then pass "TS3 去重记录过时 → 同一清单再提醒、账本 3 条"
else fail "TS3 时限到了应再提醒（实得：[${o4}] 账本=${n4}）"; fi

echo "── 去重 TS4：progress.md 动了 → 清记录；再提交 progress、同一清单重现 → 再提醒 ──"
printf 'note\n' >> "$t/progress.md"
o5=$(run_gate "$t"); kept=$([ -e "$t/.claude/.three-file-sync-advised" ] && echo Y || echo N)
git -C "$t" add progress.md >/dev/null 2>&1; git -C "$t" -c commit.gpgsign=false commit -qm prog >/dev/null 2>&1
o6=$(run_gate "$t")
if [ -z "$o5" ] && [ "$kept" = N ] && advised "$o6"; then
  pass "TS4 progress 跟上时零输出且去重记录清掉；之后同一清单重现照样提醒"
else
  fail "TS4（o5=[${o5}] 记录还在=${kept} o6=[${o6}]）"
fi

# ---- 设计详述同步分支（design-detail-sync，档位单列：fast/standard advise、strict block）----
# 契约（.claude/rules/design-detail.md [接进流程] Stop 闸）：未提交改动里有文件落在某份设计详述文首
#   「> 代码范围：」通配内、而那份设计详述不在改动集 → 出一条理由；设计详述一并改了、或改的文件不在范围内
#   → 不出这条。三文件原判定（progress 未同步）是另一条理由——这里每个用例都把 progress.md 一并改了，
#   隔离出新分支；理由文案靠「设计详述同步」「三文件同步铁律」两个前缀区分。
HARNESS="$SRC/harness/harness.mjs"
[ -f "$HARNESS" ] || { echo "test-three-file-sync-gate: 缺引擎：$HARNESS" >&2; exit 1; }
DDDOC="docs/design/mod-设计.md"
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
blocked() { has "$1" '"decision":"block"' || has "$1" '"decision": "block"'; }
# dd_repo <目录> [范围通配] —— 在 fresh_repo 上加一份设计详述并提交；范围默认 src/**。
dd_repo() {
  local t="$1" scope="${2:-src/**}"
  fresh_repo "$t"
  mkdir -p "$t/docs/design" "$t/lib/sub" "$t/other"
  # shellcheck disable=SC2016  # 格式串里的反引号是写进设计详述的字面量，不该展开
  printf '# mod 设计详述\n\n> 代码范围：`%s`\n\n## 2. 规则\n\n#### MD-AA-01 规则\n' "$scope" > "$t/$DDDOC"
  printf 'x\n' > "$t/lib/a.sh"; printf 'x\n' > "$t/lib/sub/b.sh"; printf 'x\n' > "$t/other/o.sh"
  # 运行态覆盖文件是未提交的本地态，不让它混进改动集
  mkdir -p "$t/.git/info"; printf '.claude/.runtime/\n' >> "$t/.git/info/exclude"
  git -C "$t" add -A >/dev/null 2>&1; git -C "$t" -c commit.gpgsign=false commit -qm dd >/dev/null 2>&1
}
# set_tier <目录> <strict|fast> —— 走真引擎写会话覆盖（不是手写 tier.json，也不靠改 profile）。
set_tier() {
  local t="$1" want="$2"
  case "$want" in
    fast) ( cd "$t" && CLAUDE_PROJECT_DIR="$t" node "$HARNESS" tier set fast --hours 1 --reason "test-three-file-sync-gate" ) >/dev/null 2>&1 ;;
    *)    ( cd "$t" && CLAUDE_PROJECT_DIR="$t" node "$HARNESS" tier set "$want" ) >/dev/null 2>&1 ;;
  esac
}
# eff_dd <目录> —— design-detail-sync 此刻的生效模式 + 来源（explain 一行文本）。
eff_dd() { ( cd "$1" && CLAUDE_PROJECT_DIR="$1" node "$HARNESS" tier explain design-detail-sync ) 2>/dev/null | head -1; }  # stdout 是 JSON 一行
# 档位前提：不信「我以为是 standard」，用引擎读回来。standard 必须来源 default（没被自动升档抬成 strict）；
#   strict 必须来源 session（是 tier set 生效，不是未提交的 profile/家底触发的 raise）。
assert_tier() {
  local t="$1" mode="$2" src="$3" line
  line=$(eff_dd "$t")
  if has "$line" "\"effective\":\"$mode\"" && has "$line" "\"source\":\"$src\""; then
    pass "前提：design-detail-sync 生效为 ${mode}（source ${src}）"
  else
    fail "前提不成立：期望 $mode / source ${src}，引擎读回 [$line]"
  fi
}

echo "── 设计详述 DD1：standard 档，改范围内代码不改设计详述 → 提醒、不 block ──"
t="$TMP/dd1"; dd_repo "$t"
printf 'changed\n' >> "$t/src/app.sh"; printf 'note\n' >> "$t/progress.md"
out=$(run_gate "$t")
assert_tier "$t" advise default
if advised "$out" && has "$out" '设计详述同步' && has "$out" "$DDDOC" && has "$out" 'src/app.sh' && ! has "$out" '三文件同步铁律'; then
  pass "DD1 standard：systemMessage 点名 src/app.sh 与 ${DDDOC}，无 decision:block，无三文件理由"
else
  fail "DD1 standard 应出设计详述提醒且不拦（实得：[${out}]）"
fi

echo "── 设计详述 DD2：strict 档（tier set 生效）→ decision:block ──"
t="$TMP/dd2"; dd_repo "$t"; set_tier "$t" strict
printf 'changed\n' >> "$t/src/app.sh"; printf 'note\n' >> "$t/progress.md"
out=$(run_gate "$t")
assert_tier "$t" block session
if blocked "$out" && has "$out" '设计详述同步' && has "$out" "$DDDOC" && ! has "$out" '三文件同步铁律'; then
  pass "DD2 strict：decision:block 且理由是设计详述同步（不是三文件那条）"
else
  fail "DD2 strict 应 block 在设计详述同步上（实得：[${out}]）"
fi

echo "── 设计详述 DD3：fast 档 → advise（提醒不拦）──"
t="$TMP/dd3"; dd_repo "$t"; set_tier "$t" fast
printf 'changed\n' >> "$t/src/app.sh"; printf 'note\n' >> "$t/progress.md"
out=$(run_gate "$t")
if advised "$out" && has "$out" '设计详述同步'; then pass "DD3 fast：systemMessage 提醒、无 decision:block"
else fail "DD3 fast 应只提醒（实得：[${out}]）"; fi

echo "── 设计详述 DD4：设计详述一并改了 → 没有这条理由（standard 与 strict 各一）──"
for tier in standard strict; do
  t="$TMP/dd4-$tier"; dd_repo "$t"; [ "$tier" = strict ] && set_tier "$t" strict
  printf 'changed\n' >> "$t/src/app.sh"; printf 'note\n' >> "$t/progress.md"; printf '\n补一条\n' >> "$t/$DDDOC"
  out=$(run_gate "$t")
  if [ -z "$out" ]; then pass "DD4 ${tier}：代码 + 设计详述 + progress 一并改 → 零输出放行"
  else fail "DD4 ${tier}：设计详述已同步仍出声（实得：[${out}]）"; fi
done

echo "── 设计详述 DD5：改的文件不在代码范围内 → 不出这条（strict 下也放行）──"
t="$TMP/dd5"; dd_repo "$t"; set_tier "$t" strict
printf 'changed\n' >> "$t/other/o.sh"; printf 'note\n' >> "$t/progress.md"
out=$(run_gate "$t")
if [ -z "$out" ]; then pass "DD5 范围外的 other/o.sh → 零输出"
else fail "DD5 范围外改动被误判进设计详述范围（实得：[${out}]）"; fi

echo "── 设计详述 DD6：通配语义——* 不跨目录、** 跨目录 ──"
t="$TMP/dd6"; dd_repo "$t" 'lib/*.sh'; set_tier "$t" strict
printf 'c\n' >> "$t/lib/sub/b.sh"; printf 'note\n' >> "$t/progress.md"
out=$(run_gate "$t")
if [ -z "$out" ]; then pass "DD6a lib/*.sh 不命中 lib/sub/b.sh（* 不跨目录）→ 放行"
else fail "DD6a * 跨了目录（实得：[${out}]）"; fi
printf 'c\n' >> "$t/lib/a.sh"
out=$(run_gate "$t")
if blocked "$out" && has "$out" 'lib/a.sh'; then pass "DD6b lib/*.sh 命中 lib/a.sh → strict block"
else fail "DD6b 单层通配没命中（实得：[${out}]）"; fi
t="$TMP/dd6c"; dd_repo "$t" 'lib/**'; set_tier "$t" strict
printf 'c\n' >> "$t/lib/sub/b.sh"; printf 'note\n' >> "$t/progress.md"
out=$(run_gate "$t")
if blocked "$out" && has "$out" 'lib/sub/b.sh'; then pass "DD6c lib/** 命中 lib/sub/b.sh（** 跨目录）→ strict block"
else fail "DD6c ** 没跨目录（实得：[${out}]）"; fi

echo "── 设计详述 DD7：与三文件原判定分得开——progress 没改时两条理由并存，strict 仍 block ──"
t="$TMP/dd7"; dd_repo "$t"; set_tier "$t" strict
printf 'changed\n' >> "$t/src/app.sh"
out=$(run_gate "$t")
if blocked "$out" && has "$out" '设计详述同步' && has "$out" '三文件同步铁律'; then
  pass "DD7 代码改了、progress 与设计详述都没跟 → 两条理由都在，整体 block"
else
  fail "DD7 两条理由应并存（实得：[${out}]）"
fi

echo "── 设计详述 DD8：没有 docs/design/ 的项目不受影响（strict 下 progress 同步即放行）──"
t="$TMP/dd8"; fresh_repo "$t"; set_tier "$t" strict
printf 'changed\n' >> "$t/src/app.sh"; printf 'note\n' >> "$t/progress.md"
out=$(run_gate "$t")
if [ -z "$out" ]; then pass "DD8 无设计详述 → 零输出"
else fail "DD8 无 docs/design/ 却出声（实得：[${out}]）"; fi

echo "── 设计详述 DD9：代码范围写法宽容——无通配 src/restore、反斜杠写法都命中 ──"
for scope in 'src/restore' 'src\restore\**'; do
  t="$TMP/dd9"; dd_repo "$t" "$scope"
  mkdir -p "$t/src/restore"; printf 'x\n' > "$t/src/restore/core.py"
  git -C "$t" add -A >/dev/null 2>&1; git -C "$t" -c commit.gpgsign=false commit -qm restore >/dev/null 2>&1
  printf 'changed\n' >> "$t/src/restore/core.py"; printf 'note\n' >> "$t/progress.md"
  out=$(run_gate "$t")
  if advised "$out" && has "$out" '设计详述同步' && has "$out" 'src/restore/core.py'; then
    pass "DD9 范围写 \`$scope\`：改 src/restore/core.py 不改设计详述 → standard 提醒、不 block"
  else
    fail "DD9 范围写 \`$scope\` 没命中 src/restore/core.py（实得：[${out}]）"
  fi
done
# 反证：src/restore 是目录前缀，不该误伤同前缀的兄弟目录
t="$TMP/dd9b"; dd_repo "$t" 'src/restore'
mkdir -p "$t/src/restore2"; printf 'x\n' > "$t/src/restore2/o.py"
git -C "$t" add -A >/dev/null 2>&1; git -C "$t" -c commit.gpgsign=false commit -qm r2 >/dev/null 2>&1
printf 'changed\n' >> "$t/src/restore2/o.py"; printf 'note\n' >> "$t/progress.md"
out=$(run_gate "$t")
if [ -z "$out" ]; then pass "DD9b 范围 src/restore 不命中 src/restore2/o.py（按目录前缀算，不是字符串前缀）→ 零输出"
else fail "DD9b src/restore 误伤了 src/restore2（实得：[${out}]）"; fi

echo "── 设计详述 DD10：既无 progress.md 又无 docs/design/ → 无输出、不跑 git（索引损坏也不拦）──"
t="$TMP/dd10"; fresh_repo "$t"
git -C "$t" rm -q progress.md >/dev/null 2>&1; git -C "$t" -c commit.gpgsign=false commit -qm noprog >/dev/null 2>&1
printf 'garbage-not-an-index' > "$t/.git/index"
if git -C "$t" status --porcelain >/dev/null 2>&1; then
  fail "DD10 前提不成立：索引写坏后 git status 仍能跑，这条用例证不出「没跑 git」"
else
  out=$(run_gate "$t")
  if [ -z "$out" ]; then pass "DD10 无 progress.md 且无设计详述 → 零输出，索引损坏（git status 必败）也没拦"
  else fail "DD10 应当一行 git 都不跑直接放行（实得：[${out}]）"; fi
  # 对照：有设计详述时索引损坏必须 fail-closed 拦停（树没被看过不能当干净）
  mkdir -p "$t/docs/design"
  # shellcheck disable=SC2016  # 反引号是设计详述里的字面量，不该展开
  printf '> 代码范围：`src/**`\n' > "$t/docs/design/m-设计.md"
  out=$(run_gate "$t")
  if blocked "$out"; then pass "DD10b 对照：有设计详述时同一坏索引 → fail-closed 拦停（证明 DD10 的放行不是闸坏了）"
  else fail "DD10b 有设计详述 + 坏索引应拦停（实得：[${out}]）"; fi
fi

echo ""
echo "==== test-three-file-sync-gate：PASS=$PASS FAIL=$FAIL ===="
if [ "$FAIL" -gt 0 ]; then
  echo "test-three-file-sync-gate: failed（见上方 FAIL 行：闸的改动集有漏判）" >&2
  exit 1
fi
echo "test-three-file-sync-gate: passed（家底改动出提醒、evidence 放行、设计详述同步分支均符合契约）"
