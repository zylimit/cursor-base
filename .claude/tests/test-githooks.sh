#!/usr/bin/env bash
# risk: medium
# test-githooks.sh — .claude/githooks/ 的强制层回归（只需 node + git）：会话内的 .claude/hooks/
# 管不到手敲的 git commit，这两个管得到。留四条主路径——pre-commit 干净树放行 / staged 假密钥
# 被拦 / 缺 node 打 SKIPPED 不阻断，pre-push 纯文档放行 / 代码推送只跑 selftest + secrets 两项；
# commit-msg 门槛、rc 2/3 各档降级、install-githooks 往返、语法扫那批按 2026-09-10 预算表退休。
# 退出码可控靠打桩（临时仓里放假的 harness.mjs）；全部在 mktemp -d 的临时仓里跑，对本仓只读。
set -eu

SRC=$(cd "$(dirname "$0")/.." && pwd)          # <repo>/.claude
HOOKS="$SRC/githooks"
AUDIT="$SRC/harness/audit"

for h in pre-commit pre-push; do [ -f "$HOOKS/$h" ] || { echo "test-githooks: 缺 $HOOKS/$h" >&2; exit 1; }; done
command -v node >/dev/null 2>&1 || { echo "test-githooks: 缺 node，hook 里的检查全跑不起来" >&2; exit 1; }
SH=$(command -v sh)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
# chk <判定 0=过/1=不过> <标题> <EXPECT> <GOT> —— 过不过都把期望和实际打出来。
chk() {
    if [ "$1" -eq 0 ]; then PASS=$((PASS + 1)); echo "  [PASS] $2"; else FAIL=$((FAIL + 1)); echo "  [FAIL] $2"; fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}

# mkrepo <dir> —— 干净的临时 git 仓：一个无害的 README，已 add 进索引。
mkrepo() {
    mkdir -p "$1/.claude/harness/audit" "$1/.claude/tests"
    (cd "$1" && git init -q . \
        && git config user.email t@example.com \
        && git config user.name t \
        && git config commit.gpgsign false)
    printf '# demo\n\nnothing dangerous here.\n' > "$1/README.md"
    (cd "$1" && git add -A)
}

# use_real_audit <dir> —— 真的审计脚本进临时仓（真行为，不打桩）。
use_real_audit() {
    cp "$AUDIT/lib.mjs" "$AUDIT/scan-secrets.mjs" "$AUDIT/scan-instructions.mjs" "$AUDIT/check-syntax.mjs" \
       "$1/.claude/harness/audit/"
    cp "$AUDIT/instructions-allowlist.json" "$1/.claude/harness/audit/" 2>/dev/null || true
}

# stub_engine <dir> <各子命令 rc…> —— 打桩引擎，按子命令返回指定码。
stub_engine() {
    cat > "$1/.claude/harness/harness.mjs" <<EOF
import fs from 'node:fs';
const rc = { 'catalog-lint': $2, 'fitness': $3, 'gate': $4, 'selftest': $5 };
const sub = process.argv[2] || '';
process.stderr.write('stub harness ' + sub + '\n');
process.exit(Object.prototype.hasOwnProperty.call(rc, sub) ? rc[sub] : 0);
EOF
}

RC=0; OUT=""
run_hook() { local d="$1"; RC=0; OUT=$( (cd "$d" && "$SH" "$HOOKS/$2" </dev/null 2>&1) ) || RC=$?; }

# 无 node 的 PATH：只软链 hook 会用到的外部命令、**故意不链 node**（PATH 置空连 git 都没了，
# 测出来的是别的东西）。
FAKEBIN="$TMP/bin-no-node"
mkdir -p "$FAKEBIN"
for b in git sed tr wc cat rm sh grep bash printf mktemp; do
    p=$(command -v "$b" 2>/dev/null) || continue
    case "$p" in /*) ;; *) continue ;; esac
    ln -sf "$p" "$FAKEBIN/$b"
done
run_hook_nonode() { local d="$1"; RC=0; OUT=$( (cd "$d" && PATH="$FAKEBIN" "$SH" "$HOOKS/$2" </dev/null 2>&1) ) || RC=$?; }

# push_line <dir> <这次要改的文件…> —— 造一次「已提交待推送」的改动，回填 PUSH_STDIN：
# git 喂给 pre-push 的就是这一行 <local_ref> <local_sha> <remote_ref> <remote_sha>。
PUSH_STDIN=""
push_line() {
    local dir="$1"; shift
    (cd "$dir" && git add -A && git commit -q -m "chore(demo): 基线" >/dev/null 2>&1) || true
    local base head f
    base=$(cd "$dir" && git rev-parse HEAD)
    for f in "$@"; do
        mkdir -p "$dir/$(dirname "$f")"
        printf 'x\n' >> "$dir/$f"
    done
    (cd "$dir" && git add -A && git commit -q -m "chore(demo): 待推送的改动")
    head=$(cd "$dir" && git rev-parse HEAD)
    PUSH_STDIN="refs/heads/main $head refs/heads/main $base"
}

run_push() { local d="$1"; RC=0; OUT=$( (cd "$d" && printf '%s\n' "$PUSH_STDIN" | "$SH" "$HOOKS/pre-push" 2>&1) ) || RC=$?; }

echo "===== test-githooks ====="

echo ""
echo "--- ① pre-commit：干净树放行 / staged 假密钥被拦 / 缺 node 打 SKIPPED ---"

R1="$TMP/r1"; mkrepo "$R1"; use_real_audit "$R1"
(cd "$R1" && git add -A)
run_hook "$R1" pre-commit
chk "$([ "$RC" -eq 0 ] && echo 0 || echo 1)" "干净树放行（真扫描器）" "rc 0" "rc ${RC}；$(printf '%s' "$OUT" | tail -3)"

FAKE_TOKEN="ghp_AAAABBBBCCCCDDDDEEEEFFFF0123456789"   # scan-secrets:ignore 假 token，供断言用
printf 'const t = "%s";\n' "$FAKE_TOKEN" > "$R1/leak.js"
(cd "$R1" && git add -A)
run_hook "$R1" pre-commit
if [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -q 'BLOCK'; then
    chk 0 "staged 假密钥被拦" "rc 1 且输出含 BLOCK" "rc $RC"
else
    chk 1 "staged 假密钥被拦" "rc 1 且输出含 BLOCK" "rc ${RC}；$OUT"
fi
rm -f "$R1/leak.js"
(cd "$R1" && git add -A)

run_hook_nonode "$R1" pre-commit
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q 'SKIPPED'; then
    chk 0 "缺 node 打 SKIPPED 不阻断（放行 != 通过，输出要说清）" "rc 0 且输出含 SKIPPED" "rc $RC"
else
    chk 1 "缺 node 打 SKIPPED 不阻断（放行 != 通过，输出要说清）" "rc 0 且输出含 SKIPPED" "rc ${RC}；$OUT"
fi

echo ""
echo "--- ② pre-push：纯文档放行 / 代码推送只跑两项 ---"

P1="$TMP/p1"; mkrepo "$P1"; use_real_audit "$P1"
stub_engine "$P1" 0 0 0 0
push_line "$P1" progress.md docs/note.md .claude/feedback/lesson.md
run_push "$P1"
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '纯文档推送'; then
    chk 0 "纯文档推送放行" "rc 0 且输出说「纯文档推送」" "rc ${RC}；$OUT"
else
    chk 1 "纯文档推送放行" "rc 0 且输出说「纯文档推送」" "rc ${RC}；$OUT"
fi
printf '%s' "$OUT" | grep -q 'selftest' && r=1 || r=0
chk "$r" "纯文档推送没跑 selftest（放行的意义就在于不跑）" "输出不含 selftest" "$(printf '%s' "$OUT" | tail -2)"

push_line "$P1" src/app.js
run_push "$P1"
# 只数带标记的检查行，别拿整段输出 grep——横幅里本来就要写「全量回归归 run-all.sh」。
LBLS=$(printf '%s\n' "$OUT" | grep -oE '\[(OK|BLOCK|SKIPPED)\][[:space:]]+[a-z-]+' | awk '{print $2}' | tr '\n' ' ')
if [ "$RC" -eq 0 ] && [ "$LBLS" = "selftest secrets " ]; then
    chk 0 "代码推送只跑 selftest + secrets 两项并放行" "rc 0 且检查项恰为「selftest secrets」" "rc ${RC}；项=[$LBLS]"
else
    chk 1 "代码推送只跑 selftest + secrets 两项并放行" "rc 0 且检查项恰为「selftest secrets」" "rc ${RC}；项=[$LBLS]；$OUT"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
