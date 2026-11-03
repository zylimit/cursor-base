#!/usr/bin/env bash
# risk: medium
# test-adapter.sh — Cursor 适配层自测：gen-agents.mjs 的产出形状、模型钉死与回落、setup-cursor.sh 装到临时目录、
#   sync-from-cc-base.sh 的幂等。cc-base 原件自己的测试在 .claude/tests/，不在这里重复。
#
# 纪律：全程不写本仓（ROOT）：开头 cp -a 本仓（含 .git）到 mktemp 副本 $R，gen-agents / setup-cursor / sync 全在副本和更多临时目录里跑，
#   ROOT 只读；结尾核对 ROOT 的 git status --short 与开场一致。安装一律装到 mktemp 目录，用完删。
#   每条断言打印 EXPECT / GOT，判定不依赖措辞。
#   sync 幂等要有真 cc-base 仓才能跑（$CC_BASE_DIR，缺省 ../cc-base）；没有就 SKIP——未执行 != 通过。
#   sync 的行为断言用 mktemp 下造的最小 git 仓当假 cc-base，不依赖真 cc-base。
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1

echo "===== test-adapter ====="

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node——gen-agents 与 hook-form 都跑不了，未执行 != 通过。" >&2
    exit 1
fi

PASS=0
FAIL=0
SKIP=0
TMPS=""
STATUS0=$(git status --short | LC_ALL=C sort | cksum)

cleanup() {
    # shellcheck disable=SC2086  # TMPS 是空格分隔的 mktemp 路径，故意拆词
    [ -n "$TMPS" ] && rm -rf $TMPS
}
trap cleanup EXIT

# 本仓副本：下面所有会写文件的步骤都对它做，ROOT 不动
R=$(mktemp -d); TMPS="$TMPS $R"
cp -a "$ROOT/." "$R/" || { echo "cp -a 本仓到 $R 失败" >&2; exit 1; }
cd "$R" || exit 1
W=$(mktemp -d); TMPS="$TMPS $W"
MODELS="$R/.cursor/agents-models.json"
# gen [项目根]：在指定根（缺省副本 $R）上跑副本里的 gen-agents.mjs
gen() { CLAUDE_PROJECT_DIR="${1:-$R}" node "$R/.cursor/scripts/gen-agents.mjs"; }
# tsum <目录>：目录下除 .git 外所有文件的内容校验和（含路径），用来证明「一个文件都没动」
tsum() { (cd "$1" && find . -path ./.git -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 cksum | cksum); }

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

# has <文件> <固定串> —— 退出码 0 表示含
has() { grep -qF -- "$2" "$1"; }
# fmline <文件> <键> —— 只在 frontmatter（第一对 --- 之间）里取该键的值，没有就空
fmline() {
    awk -v k="$2" '
        /^---$/ { n++; next }
        n == 1 && index($0, k ": ") == 1 { print substr($0, length(k) + 3); exit }
        n >= 2 { exit }
    ' "$1"
}

AG="$R/.cursor/agents"

echo "--- gen-agents：产出形状"
gen >/dev/null 2>&1
rc=$?
chk "$rc" "gen-agents 退 0" "rc=0" "rc=$rc"
n=$(find "$AG" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
chk "$([ "$n" = "8" ] && echo 0 || echo 1)" "产出 8 个文件" "8" "$n"

bad_model=""; bad_key=""
for f in "$AG"/*.md; do
    [ "$(fmline "$f" model)" = "inherit" ] || bad_model="$bad_model $(basename "$f")"
    for k in skills color memory disallowedTools maxTurns tools; do
        [ -n "$(fmline "$f" "$k")" ] && bad_key="$bad_key $(basename "$f"):$k"
    done
done
chk "$([ -z "$bad_model" ] && echo 0 || echo 1)" "每个文件 frontmatter 含 model: inherit（未钉死时）" "无例外" "例外：${bad_model:-无}"
chk "$([ -z "$bad_key" ] && echo 0 || echo 1)" "frontmatter 不含 skills / color / memory 等 Cursor 不认的键" "无" "${bad_key:-无}"

bad_head=""
for f in "$AG"/*.md; do
    [ "$(head -n 1 "$f")" = "---" ] || bad_head="$bad_head $(basename "$f")"
done
chk "$([ -z "$bad_head" ] && echo 0 || echo 1)" "每个生成文件第 1 行恰好是 ---" "无例外" "例外：${bad_head:-无}"
bad_cmt=""
for f in "$AG"/*.md; do
    cl=$(grep -n -m1 -F '<!-- 由 .cursor/scripts/gen-agents.mjs' "$f" | cut -d: -f1)
    fe=$(awk '/^---$/ { n++; if (n == 2) { print NR; exit } }' "$f")
    { [ -n "$cl" ] && [ -n "$fe" ] && [ "$cl" -gt "$fe" ]; } || bad_cmt="$bad_cmt $(basename "$f")"
done
chk "$([ -z "$bad_cmt" ] && echo 0 || echo 1)" "每个生成文件有「由 gen-agents 生成」注释行且在 frontmatter 结束之后" "无例外" "例外：${bad_cmt:-无}"

has "$AG/implementer.md" "先完整读 \`.claude/skills/dev-builder/SKILL.md\`"; r1=$?
chk "$r1" "implementer 正文含「先完整读 .claude/skills/dev-builder/SKILL.md」" "命中" "rc=$r1"
has "$AG/tester.md" "不要再派子代理"; r2=$?
has "$AG/tester.md" "agent-memory/tester"; r3=$?
chk "$((r2 + r3))" "tester 正文含「不要再派子代理」与「agent-memory/tester」" "两句都命中" "不要再派子代理 rc=$r2；agent-memory/tester rc=$r3"

echo "--- gen-agents：正文逐字一致、frontmatter 取值、disallowedTools 写成正文"
# fbody <文件>：去掉 frontmatter（第一对 ---）与其后的前导空行，剩下的正文
fbody() { awk '/^---$/ && n < 2 { n++; next } n >= 2 { if (!st && $0 == "") next; st = 1; print }' "$1"; }
bad_body=""; bad_pre=""; bad_desc=""; bad_name=""
for f in "$AG"/*.md; do
    b=$(basename "$f"); src="$R/.claude/agents/$b"
    fbody "$src" >"$W/src.body"; fbody "$f" >"$W/gen.body"
    n=$(wc -l <"$W/src.body" | tr -d ' '); total=$(wc -l <"$W/gen.body" | tr -d ' ')
    tail -n "$n" "$W/gen.body" >"$W/gen.tail"
    cmp -s "$W/src.body" "$W/gen.tail" || bad_body="$bad_body $b"
    # 正文之前只许是：生成注释一行，加上开头的几句（读技能 / 不要再派子代理 / 不要用某工具 / 持久记忆）
    if head -n "$((total - n))" "$W/gen.body" | grep -v '^$' | tail -n +2 \
        | grep -qvE '^(开工前先完整读 |不要再派子代理。$|不要用 .+工具。$|你的持久记忆在 )'; then bad_pre="$bad_pre $b"; fi
    d_src=$(fmline "$src" description)
    { [ -n "$d_src" ] && [ "$(fmline "$f" description)" = "$d_src" ]; } || bad_desc="$bad_desc $b"
    [ "$(fmline "$f" name)" = "${b%.md}" ] || bad_name="$bad_name $b"
done
chk "$([ -z "$bad_body" ] && echo 0 || echo 1)" "每个生成文件的正文（去掉 frontmatter、注释与开头几句）与源文件去掉 frontmatter 后逐字一致" "无例外" "例外：${bad_body:-无}"
chk "$([ -z "$bad_pre" ] && echo 0 || echo 1)" "正文之前除生成注释外只有约定的几类开头句" "无例外" "例外：${bad_pre:-无}"
chk "$([ -z "$bad_desc" ] && echo 0 || echo 1)" "每个生成文件的 description 等于源文件的值（且非空）" "无例外" "例外：${bad_desc:-无}"
chk "$([ -z "$bad_name" ] && echo 0 || echo 1)" "每个生成文件的 name 等于文件名" "无例外" "例外：${bad_name:-无}"

bad_dis=""
for a in domain-recorder feedback-observer progress-recorder; do
    has "$AG/$a.md" "不要用 Shell（Bash）工具。" && has "$AG/$a.md" "不要再派子代理。" || bad_dis="$bad_dis $a"
done
chk "$([ -z "$bad_dis" ] && echo 0 || echo 1)" "disallowedTools 为 Bash, Task 的三个角色正文含「不要用 Shell（Bash）工具。」与「不要再派子代理。」" "三个都含两句" "缺：${bad_dis:-无}"
has "$AG/implementer.md" "不要用 Shell（Bash）工具。"; r1=$?
has "$AG/implementer.md" "不要再派子代理。"; r2=$?
chk "$([ "$r1" -ne 0 ] && [ "$r2" -eq 0 ] && echo 0 || echo 1)" "implementer（disallowedTools: Task）不含 Shell 那句、含不要再派子代理" "Shell 句 rc≠0、子代理句 rc=0" "Shell 句 rc=$r1；子代理句 rc=$r2"

echo "--- gen-agents：清掉源头已删的生成物"
F=$(mktemp -d); TMPS="$TMPS $F"
mkdir -p "$F/.claude/agents" "$F/.cursor/agents"
for n in gone stay; do
    printf -- '---\nname: %s\ndescription: d-%s\n---\n\n正文 %s\n' "$n" "$n" "$n" >"$F/.claude/agents/$n.md"
done
printf '手写的，没有生成注释\n' >"$F/.cursor/agents/keep.md"
gen "$F" >/dev/null 2>&1; rc1=$?
ok1=$([ -f "$F/.cursor/agents/gone.md" ] && echo 0 || echo 1)
rm -f "$F/.claude/agents/gone.md"
out=$(gen "$F" 2>&1); rc2=$?
chk "$((rc1 + rc2 + ok1))" "夹具里造 gone.md 源后生成，gone.md 出现；删源再生成退 0" "第一次生成出 gone.md，两次 rc=0" "rc=$rc1 / $rc2，gone.md 第一次生成=$([ "$ok1" = 0 ] && echo 有 || echo 无)"
chk "$([ ! -e "$F/.cursor/agents/gone.md" ] && echo 0 || echo 1)" "删源再生成后 .cursor/agents/gone.md 被清掉，stdout 说了一句" "gone.md 不在，stdout 含 gone.md" "gone.md=$([ -e "$F/.cursor/agents/gone.md" ] && echo 还在 || echo 已清)；stdout=$(printf '%s' "$out" | grep -c 'gone.md') 行提到"
chk "$([ -f "$F/.cursor/agents/keep.md" ] && [ -f "$F/.cursor/agents/stay.md" ] && echo 0 || echo 1)" "手写的 keep.md（无生成注释）与仍有源的 stay.md 都还在" "都在" "keep=$([ -f "$F/.cursor/agents/keep.md" ] && echo 有 || echo 无) stay=$([ -f "$F/.cursor/agents/stay.md" ] && echo 有 || echo 无)"

echo "--- gen-agents：复制改名的定制文件不被清、Agent 也写成不要再派子代理"
G=$(mktemp -d); TMPS="$TMPS $G"
mkdir -p "$G/.claude/agents"
printf -- '---\nname: code-reviewer\ndescription: d-cr\ndisallowedTools: Agent\n---\n\n正文 cr\n' >"$G/.claude/agents/code-reviewer.md"
gen "$G" >/dev/null 2>&1; rc1=$?
cp "$G/.cursor/agents/code-reviewer.md" "$G/.cursor/agents/my-reviewer.md"
gen "$G" >/dev/null 2>&1; rc2=$?
chk "$((rc1 + rc2 + $([ -f "$G/.cursor/agents/my-reviewer.md" ] && echo 0 || echo 1)))" "复制 code-reviewer.md 成 my-reviewer.md（注释里源名是 code-reviewer，无 my-reviewer 源），再生成后它还在" "rc=0 且 my-reviewer.md 在" "rc=$rc1 / $rc2，my-reviewer.md=$([ -f "$G/.cursor/agents/my-reviewer.md" ] && echo 有 || echo 被删)"
chk "$(has "$G/.cursor/agents/code-reviewer.md" "不要再派子代理。" && echo 0 || echo 1)" "源文件 disallowedTools: Agent 时生成版含「不要再派子代理。」" "含" "$(has "$G/.cursor/agents/code-reviewer.md" "不要再派子代理。" && echo 含 || echo 不含)"

echo "--- gen-agents：agents-models.json 钉死与回落"
printf '{"code-reviewer":"auto"}\n' >"$MODELS"
gen >/dev/null 2>&1
got=$(fmline "$AG/code-reviewer.md" model)
other=$(fmline "$AG/tester.md" model)
chk "$([ "$got" = "auto" ] && [ "$other" = "inherit" ] && echo 0 || echo 1)" "钉了 code-reviewer: auto 后它变 auto、别的角色仍 inherit" "code-reviewer=auto tester=inherit" "code-reviewer=$got tester=$other"
rm -f "$MODELS"
gen >/dev/null 2>&1
got=$(fmline "$AG/code-reviewer.md" model)
chk "$([ "$got" = "inherit" ] && echo 0 || echo 1)" "删掉 agents-models.json 再生成，变回 inherit" "inherit" "$got"
printf '{坏的' >"$MODELS"
gen >/dev/null 2>&1; rc=$?
chk "$([ "$rc" -eq 1 ] && echo 0 || echo 1)" "agents-models.json 不是合法 JSON 时 gen-agents 退 1（不静默回落）" "rc=1" "rc=$rc"
# 还原副本里的状态，后面的 setup 才装得到正确的 .cursor/agents
rm -f "$MODELS"
gen >/dev/null 2>&1

echo "--- setup-cursor：装到临时目录"
if [ ! -x "$R/setup.sh" ]; then
    SKIP=$((SKIP + 1)); echo "  [SKIP] setup-cursor：本仓还没有 setup.sh（先 sync-from-cc-base.sh），未执行 != 通过"
else
    T=$(mktemp -d); TMPS="$TMPS $T"
    "$R/setup-cursor.sh" "$T" >"$T.out1" 2>&1; rc=$?; TMPS="$TMPS $T.out1"
    chk "$rc" "setup-cursor 退 0" "rc=0" "rc=$rc（输出尾：$(tail -2 "$T.out1" | tr '\n' ' ')）"
    form=$(node "$T/.claude/scripts/hook-form.mjs" --check --file "$T/.claude/settings.json" 2>&1)
    chk "$([ "$form" = "string" ] && echo 0 || echo 1)" "目标 settings.json 形态是 string" "string" "$form"
    n=$(find "$T/.cursor/agents" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
    chk "$([ "$n" = "8" ] && echo 0 || echo 1)" "目标 .cursor/agents/ 有 8 个" "8" "$n"
    chk "$([ -f "$T/AGENTS.md" ] && echo 0 || echo 1)" "目标 AGENTS.md 存在" "存在" "$([ -f "$T/AGENTS.md" ] && echo 存在 || echo 缺失)"
    chk "$([ -f "$T/.cursor/cli.json" ] && [ -f "$T/.cursor/scripts/gen-agents.mjs" ] && echo 0 || echo 1)" "目标有 .cursor/cli.json 与 gen-agents.mjs" "都在" "cli.json=$([ -f "$T/.cursor/cli.json" ] && echo 有 || echo 无) gen-agents=$([ -f "$T/.cursor/scripts/gen-agents.mjs" ] && echo 有 || echo 无)"

    # 目标里留一个「带生成注释、本仓已无同名」的残留和一个手写的：第二次装后残留清掉、手写的还在
    printf '<!-- 由 .cursor/scripts/gen-agents.mjs 从 .claude/agents/old-gen.md 生成 -->\n' >"$T/.cursor/agents/old-gen.md"
    printf '手写的\n' >"$T/.cursor/agents/hand.md"
    cp "$T/.cursor/agents/code-reviewer.md" "$T/.cursor/agents/my-reviewer.md"

    # 第二次装：先动 AGENTS.md 一个字节，不许被覆盖，新版本落 .framework-new
    printf 'x' >>"$T/AGENTS.md"
    before=$(cksum <"$T/AGENTS.md")
    "$R/setup-cursor.sh" "$T" >"$T.out2" 2>&1; rc=$?; TMPS="$TMPS $T.out2"
    after=$(cksum <"$T/AGENTS.md")
    chk "$rc" "第二次装退 0" "rc=0" "rc=$rc（输出尾：$(tail -2 "$T.out2" | tr '\n' ' ')）"
    chk "$([ "$before" = "$after" ] && echo 0 || echo 1)" "改过的 AGENTS.md 装完内容不变" "cksum 不变" "前 $before 后 $after"
    chk "$([ ! -e "$T/.cursor/agents/old-gen.md" ] && [ -f "$T/.cursor/agents/hand.md" ] && echo 0 || echo 1)" "第二次装清掉目标里失源的生成物 old-gen.md，手写的 hand.md 不动" "old-gen 无、hand 有" "old-gen=$([ -e "$T/.cursor/agents/old-gen.md" ] && echo 有 || echo 无) hand=$([ -f "$T/.cursor/agents/hand.md" ] && echo 有 || echo 无)"
    chk "$([ -f "$T/.cursor/agents/my-reviewer.md" ] && echo 0 || echo 1)" "第二次装不删复制改名的 my-reviewer.md（注释里源名是 code-reviewer，不是自己）" "my-reviewer 有" "my-reviewer=$([ -f "$T/.cursor/agents/my-reviewer.md" ] && echo 有 || echo 无)"
    chk "$([ -f "$T/AGENTS.md.framework-new" ] && cmp -s "$T/AGENTS.md.framework-new" "$R/AGENTS.md" && echo 0 || echo 1)" "出现 AGENTS.md.framework-new 且等于本仓 AGENTS.md" "存在且相同" "$([ -f "$T/AGENTS.md.framework-new" ] && echo 存在 || echo 缺失)"

    # dry-run 不写文件
    D=$(mktemp -d); TMPS="$TMPS $D"
    "$R/setup-cursor.sh" "$D/proj" --dry-run >"$D.out" 2>&1; rc=$?; TMPS="$TMPS $D.out"
    chk "$([ "$rc" -eq 0 ] && [ ! -e "$D/proj" ] && echo 0 || echo 1)" "--dry-run 退 0 且目标目录没被建出来" "rc=0 且无 proj/" "rc=$rc proj=$([ -e "$D/proj" ] && echo 有 || echo 无)"
fi

echo "--- sync-from-cc-base：行为（假 cc-base 夹具）"
# 假 cc-base：最小 git 仓。hook-form.mjs 取本仓里的那份（同一份原件），.gitignore 白名单段与本仓逐字一致
FC=$(mktemp -d); TMPS="$TMPS $FC"
mkdir -p "$FC/.claude/agents" "$FC/.claude/scripts"
echo "# fake cc-base" >"$FC/.claude/CLAUDE.md"
printf -- '---\nname: one\ndescription: d1\ndisallowedTools: Task\n---\n\n正文一行\n' >"$FC/.claude/agents/one.md"
cp "$R/.claude/scripts/hook-form.mjs" "$FC/.claude/scripts/"
cat >"$FC/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/demo.mjs"]
          }
        ]
      }
    ]
  }
}
JSON
{ echo '# fake cc-base .gitignore'; echo; awk '/^# === Cursor 适配层 ===/ { exit } /^\/\*$/ { on = 1 } on' "$R/.gitignore"; } >"$FC/.gitignore"
echo "fake readme" >"$FC/README.md"
git -C "$FC" init -q && git -C "$FC" add -A -f && git -C "$FC" -c user.name=t -c user.email=t@t commit -q -m init
fc_ok=$?
chk "$fc_ok" "假 cc-base 夹具建好并提交" "rc=0" "rc=$fc_ok"

if [ "$fc_ok" -eq 0 ]; then
    # 1 白名单段改一个字符：退 1，目标一个文件没变
    T1=$(mktemp -d); TMPS="$TMPS $T1"; cp -a "$R/." "$T1/"
    sed -i 's|^!/setup.sh$|!/setup.shx|' "$T1/.gitignore"
    before=$(tsum "$T1")
    "$T1/sync-from-cc-base.sh" "$FC" >/dev/null 2>&1; rc=$?
    after=$(tsum "$T1")
    chk "$([ "$rc" -eq 1 ] && echo 0 || echo 1)" "本仓 .gitignore 白名单段改一个字符后 sync 退 1" "rc=1" "rc=$rc"
    chk "$([ "$before" = "$after" ] && echo 0 || echo 1)" "白名单核对失败时目标一个文件没变（校验和不变）" "前后相同" "前 $before 后 $after"

    # 2 干净的假 cc-base：删旧、不覆盖自有文件、取 HEAD 清单
    T2=$(mktemp -d); TMPS="$TMPS $T2"; cp -a "$R/." "$T2/"
    old_has=$(grep -cxF 'setup.sh' "$T2/.cursor/cc-base-files.txt")
    "$T2/sync-from-cc-base.sh" "$FC" >"$W/s2.out" 2>&1; rc=$?
    chk "$rc" "干净的假 cc-base 同步退 0" "rc=0" "rc=$rc（输出尾：$(tail -2 "$W/s2.out" | tr '\n' ' ')）"
    chk "$([ "$old_has" = "1" ] && [ ! -e "$T2/setup.sh" ] && echo 0 || echo 1)" "上次清单里有、这次没有的 setup.sh 被删" "清单含 setup.sh，同步后文件不在" "清单含=$old_has；文件=$([ -e "$T2/setup.sh" ] && echo 还在 || echo 已删)"
    chk "$(cmp -s "$T2/README.md" "$R/README.md" && echo 0 || echo 1)" "本仓自有的 README.md 没被假 cc-base 的 README.md 覆盖" "与同步前相同" "$(cmp -s "$T2/README.md" "$R/README.md" && echo 相同 || echo 被改)"
    chk "$([ -f "$T2/.claude/agents/one.md" ] && [ -f "$T2/.cursor/agents/one.md" ] && echo 0 || echo 1)" "假 cc-base 的 one.md 被拷进来并生成了 .cursor/agents/one.md" "两个都在" "src=$([ -f "$T2/.claude/agents/one.md" ] && echo 有 || echo 无) gen=$([ -f "$T2/.cursor/agents/one.md" ] && echo 有 || echo 无)"
    form=$(node "$T2/.claude/scripts/hook-form.mjs" --check --file "$T2/.claude/settings.json" 2>&1)
    chk "$([ "$form" = "string" ] && echo 0 || echo 1)" "同步后 settings.json 转成 string form" "string" "$form"

    # 3 源树脏：不带开关退 1 且目标不动；--allow-dirty 放行，未跟踪文件与未提交改动都不进来
    echo "untracked" >"$FC/.claude/untracked.md"
    echo "未提交的改动" >>"$FC/.claude/agents/one.md"
    T3=$(mktemp -d); TMPS="$TMPS $T3"; cp -a "$R/." "$T3/"
    before=$(tsum "$T3")
    "$T3/sync-from-cc-base.sh" "$FC" >/dev/null 2>&1; rc=$?
    after=$(tsum "$T3")
    chk "$([ "$rc" -eq 1 ] && [ "$before" = "$after" ] && echo 0 || echo 1)" "假 cc-base 工作树脏、没带 --allow-dirty：退 1 且目标没动" "rc=1、校验和不变" "rc=$rc；$([ "$before" = "$after" ] && echo 未动 || echo 被改)"
    T4=$(mktemp -d); TMPS="$TMPS $T4"; cp -a "$R/." "$T4/"
    "$T4/sync-from-cc-base.sh" --allow-dirty "$FC" >"$W/s4.out" 2>&1; rc=$?
    git -C "$FC" show HEAD:.claude/agents/one.md >"$W/one.head"
    chk "$rc" "带 --allow-dirty 放行脏的假 cc-base" "rc=0" "rc=$rc（输出尾：$(tail -2 "$W/s4.out" | tr '\n' ' ')）"
    chk "$([ ! -e "$T4/.claude/untracked.md" ] && cmp -s "$T4/.claude/agents/one.md" "$W/one.head" && echo 0 || echo 1)" "只认 HEAD：未跟踪文件不被拷、one.md 是 HEAD 的内容不是未提交的样子" "untracked.md 不在，one.md 等于 HEAD 版" "untracked=$([ -e "$T4/.claude/untracked.md" ] && echo 被拷 || echo 未拷) one.md=$(cmp -s "$T4/.claude/agents/one.md" "$W/one.head" && echo 等于HEAD || echo 不等于HEAD)"
fi

echo "--- sync-from-cc-base：幂等（真 cc-base，在本仓副本里跑）"
CC=${CC_BASE_DIR:-$ROOT/../cc-base}
if [ ! -f "$CC/.claude/CLAUDE.md" ] || [ ! -e "$CC/.git" ]; then
    SKIP=$((SKIP + 1)); echo "  [SKIP] sync 幂等：没有 cc-base 仓（$CC）。未执行 != 通过"
else
    # cc-base 工作树不干净时加 --allow-dirty：同步取的是 HEAD，脏改动不影响幂等判定
    OPT=""
    [ -n "$(git -C "$CC" status --porcelain)" ] && OPT="--allow-dirty" && echo "  (cc-base 工作树不干净，用 --allow-dirty)"
    T5=$(mktemp -d); TMPS="$TMPS $T5"; cp -a "$R/." "$T5/"
    # shellcheck disable=SC2086  # OPT 空时不能留下空参数
    "$T5/sync-from-cc-base.sh" $OPT "$CC" >/dev/null 2>&1; rc1=$?
    s1=$(git -C "$T5" status --short | LC_ALL=C sort | cksum); cp "$T5/.cursor/cc-base-version.txt" "$W/v1"
    # shellcheck disable=SC2086
    "$T5/sync-from-cc-base.sh" $OPT "$CC" >/dev/null 2>&1; rc2=$?
    s2=$(git -C "$T5" status --short | LC_ALL=C sort | cksum)
    chk "$((rc1 + rc2))" "两次 sync 都退 0" "rc=0 / rc=0" "rc=$rc1 / rc=$rc2"
    chk "$([ "$s1" = "$s2" ] && echo 0 || echo 1)" "第二次 sync 后 git status --short 与第一次后相同" "两次 cksum 相同" "$s1 / $s2"
    chk "$(cmp -s "$W/v1" "$T5/.cursor/cc-base-version.txt" && echo 0 || echo 1)" "cc-base-version.txt 两次逐字节相同" "相同" "$(cmp -s "$W/v1" "$T5/.cursor/cc-base-version.txt" && echo 相同 || echo 不同)"
fi

echo "--- 本仓只读"
STATUS1=$(git -C "$ROOT" status --short | LC_ALL=C sort | cksum)
chk "$([ "$STATUS0" = "$STATUS1" ] && echo 0 || echo 1)" "测试跑完后本仓 git status --short 与开场相同" "两次 cksum 相同" "$STATUS0 / $STATUS1"

echo "===== test-adapter：PASS=$PASS FAIL=$FAIL SKIP=$SKIP ====="
[ "$SKIP" -gt 0 ] && echo "注意：有 $SKIP 项 SKIP，未执行 != 通过。" >&2
[ "$FAIL" -eq 0 ]
