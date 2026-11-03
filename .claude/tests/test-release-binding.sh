#!/usr/bin/env bash
# risk: high
# test-release-binding.sh — 批 3「发版与证据绑定」五条契约（L3a~L3e）的红锁回归测试。
#
# 与既有测试的分工：
#   test-release-manifest.sh  锁 release 的 manifest 项对排除表的口径（已实现，该全绿）
#   test-evidence-defects.sh  锁证据层「证据留得住、不能被静默改写」（另一批）
#   本文件                    锁「发版结论必须绑在证据上」这五条——**现在一条都不成立**
#
# red-locks-the-bug：断言写的是**修复后应该成立的行为**，不是「缺陷能复现」。
#   所以实现补齐之前本脚本整体必然 FAIL —— 那是它的成功状态，不是它写坏了。
#   转绿之后它就是永久回归防线：谁把哪条绑定摘掉，哪条立刻红。
#
# 五条契约（引擎 .claude/harness/harness.mjs + lib/{release,quality,evidence}.mjs）：
#   L3a  release 新增检查项 gate-fresh：有 catalog 时须存在一条 gate 记录
#        （.claude/harness/state/ledger.jsonl）满足 gate==='PASS' 且 diffHash 等于当前工作树
#        指纹、且不是 fast-mode 下的全 SKIPPED，才 PASS；否则 FAIL，blocker 的下一步命令点名
#        `node .claude/harness/harness.mjs gate`。无 catalog -> DEGRADED 且不阻断
#        （cc-base 自己没 catalog，不能因此发不了版）。
#   L3b  release 输出恒带 trustBoundary，四个字段永远 false：producerIdentityAuthenticated /
#        ciProvenanceVerified / externalSignatureVerified / releaseAuthorized，
#        并且人读 stderr 有一行说明「这是候选证明，不是授权」。
#   L3c  receipt write 记 engineHash（运行中引擎目录 harness.mjs + lib/*.mjs 的内容 sha256）；
#        receipt verify 发现回执 engineHash 与当前引擎不同 -> STALE rc 4 note engine-moved；
#        老回执没有该字段 -> 放行但输出 engineHash:null（升级不砖化存量回执）。
#   L3d  risk 治理面告警：工作树改动落在 .claude/hooks|harness|skills|agents|rules/** 、
#        .claude/CLAUDE.md 或 .github/** -> finding GOVERNANCE_SURFACE_CHANGED（severity warning，
#        列出路径）。
#   L3e  lib/quality.mjs 的命令可执行判定在找不到命令时回落扫描 shim 目录
#        （win32 默认 WinGet/scoop/chocolatey；任何平台可用 CC_HARNESS_SHIM_DIRS 覆盖，
#        path.delimiter 分隔），命中则把该目录前置进子进程 PATH 让 check 真跑，而不是判 BLOCKED。
#
# 本机实测到的两处「契约描述与引擎现状不符」，断言按契约写、按实测选形态（详见各段注释）：
#   ① 契约把「fast-mode 全 SKIPPED」括注成「现在 rc 3、不算 PASS」——实测不是：
#      cmdGate 对全 SKIPPED 聚合出 gate:'PASS' 且 rc 0，账本里也是一条 gate:'PASS' 记录。
#      所以 gate-fresh 必须自己把这种记录挡掉，否则一次 fast-mode 空跑就能喂饱发版闸。
#   ② 契约的「非 git -> gate-fresh DEGRADED」在现有 cmdRelease 结构下不可达：非 git 时
#      cmdRelease 早返回 {error:'non-git', checks:[]}，七项检查一项都不跑。本文件不为它写
#      「gate-fresh 存在」的断言（那会逼实现改 cmdRelease 的整体结构），只按 L3b 的「恒带」
#      要求那条早返回路径也带 trustBoundary。
#
# 三种标记，别把它们当成一样的东西：
#   【防回归位】     现在就绿而且**现在就有信息量**（引擎真的做到了那件事），留着防修复时把
#                    对照那一侧改坏。L3e①⑥ 是这种。
#   【现在恒绿·…】   现在也绿，但绿得毫无信息量——功能整个不存在，否定式判据自然成立。
#                    要等实现补齐才开始真正守东西。L3c③⑥⑦、L3d①③ 是这种。
#   【超契约字面】   契约没写但同源方向的补洞（L3c⑤、L3d③），交主 Agent 裁定要不要保留。
#
# 覆盖面：只覆盖 .sh 可驱动的引擎行为。这批全是纯 node，.ps1 侧无同构代码。
# 纪律：一切样例写进 mktemp 出来的临时 git 仓，trap 清理；对 cc-base 只读。
#   每条断言打印 EXPECT / GOT，判定不依赖措辞——复核只看这两行。
# 依赖：node + git。python3 / jq / pwsh 都不需要。
#
# 用法：bash test-release-binding.sh [REPO]
#   REPO 默认本仓。传打了补丁的引擎副本可以跑同一份断言——全绿就证明每条红都是功能缺失。
set -eu

REPO="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"

HARNESS="$REPO/.claude/harness/harness.mjs"
LIBDIR="$(dirname "$HARNESS")/lib"
EXTDIR="$(dirname "$HARNESS")/ext"
HOOKSLIB="$REPO/.claude/hooks/lib"
PROFILE="$REPO/.claude/harness/profile.json"

echo "===== test-release-binding ====="
echo "REPO=$REPO"

if ! command -v node >/dev/null 2>&1; then
    echo "SKIPPED: 无 node（command -v node 未找到）——被测的全是纯 node 引擎，一条都跑不了，未执行 != 通过。" >&2
    exit 1
fi
if ! command -v git >/dev/null 2>&1; then
    echo "SKIPPED: 无 git（command -v git 未找到）——沙箱仓造不出来，未执行 != 通过。" >&2
    exit 1
fi

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

# ---------------------------------------------------------------------------
# 沙箱与引擎驱动
# ---------------------------------------------------------------------------

# engdeps <项目根> —— 补齐引擎在别处也能起来所需的那两样：hooks/lib/ 与 profile.json。
#   档位只有一个解析器且放在 hook 侧，引擎 lib/tier.mjs import 的是 ../../hooks/lib/tier.mjs；
#   只搬 harness/ 的树里引擎会 ERR_MODULE_NOT_FOUND，以契约外的 rc 1 退出，
#   下面「gate 该 PASS」「receipt 该 STALE」这类断言全部读成同一个起不来。
engdeps() {
    local d="$1"
    mkdir -p "$d/.claude/hooks"
    cp -R "$HOOKSLIB" "$d/.claude/hooks/lib"
    cp "$PROFILE" "$d/.claude/harness/profile.json"
}

# mksandbox <名> <catalog yes|no> [check命令]
#   造一个临时项目：一个 core 模块、一条 medium 档 check、一个 src/ 非治理面文件。
#   引擎按目录整拷（harness.mjs import 同级 lib/，只拷单文件会 ERR_MODULE_NOT_FOUND）。
#   ext/ 一起搬：release / gate / receipt 都住在那个可选包里，缺它一律 rc 3 报「未安装」，
#   下面按退出码判的断言会全部读成同一个「没装」。
#   catalog 把 .claude/** 与 src/** 归入 ignored，好让 catalog-lint / dod 在沙箱里是干净的，
#   否则 release 里除 gate-fresh 之外还会多出一片跟本测试无关的红。
mksandbox() {
    local name="$1" withcat="$2" cmd="${3:-true}"
    local d="$TMP/$name"
    mkdir -p "$d/.claude/harness" "$d/core" "$d/src"
    cp "$HARNESS" "$d/.claude/harness/harness.mjs"
    cp -R "$LIBDIR" "$d/.claude/harness/lib"
    [ -d "$EXTDIR" ] && cp -R "$EXTDIR" "$d/.claude/harness/ext"
    engdeps "$d"
    if [ "$withcat" = yes ]; then
        cat > "$d/.claude/harness/module-catalog.json" <<EOF
{"version":1,
 "modules":[{"id":"core","paths":["core/**"],"riskTier":"medium"}],
 "global":[],
 "ignored":[".claude/**","src/**"],
 "riskChecks":{"medium":["probe"]},
 "checks":{"probe":{"command":"$cmd","class":"test"}}}
EOF
    fi
    echo baseline > "$d/core/a.txt"
    echo source   > "$d/src/a.ts"
    (
        cd "$d" && git init -q . \
            && git config core.autocrlf false \
            && git config user.email t@example.com && git config user.name t \
            && git add -A && git commit -qm init
    ) >/dev/null 2>&1
    printf '%s' "$d"
}

RC=0
OUT=""
ERR=""

# run <沙箱> <子命令...> —— 用沙箱自带的引擎跑，回填 RC / OUT / ERR。
run() {
    local d="$1"; shift
    RC=0
    OUT=$( cd "$d" && CLAUDE_PROJECT_DIR="$d" node "$d/.claude/harness/harness.mjs" "$@" 2>"$TMP/.stderr" ) || RC=$?
    # shellcheck disable=SC2034  # run() 的 RC/OUT/ERR 三元组契约（见上方注释），本文件断言未消费 stderr 文本，保留补齐契约不影响行为
    ERR=$(cat "$TMP/.stderr" 2>/dev/null || true)
}

# jval <json> <点路径> —— 取字段（不存在回空串，null 回字面量 "null"）。
jval() {
    printf '%s' "$1" | node -e '
        let s = "";
        process.stdin.on("data", d => s += d).on("end", () => {
            try {
                const line = s.trim().split("\n").filter(Boolean).pop();
                let v = JSON.parse(line);
                for (const k of process.argv[1].split(".")) v = (v == null ? undefined : v[k]);
                console.log(v === undefined ? "" : (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)));
            } catch (_e) { console.log(""); }
        });
    ' "$2"
}

# rel_check <json> <检查 id> —— 制表符四列：status / nextStep / 是否进 blockers / blocker 的 nextStep
#   检查项不存在回 ABSENT（跟 DEGRADED 分得开：一个是没实现，一个是实现了但答不出）。
rel_check() {
    printf '%s' "$1" | node -e '
        let s = "";
        process.stdin.on("data", d => s += d).on("end", () => {
            let j;
            try { j = JSON.parse(s.trim().split("\n").filter(Boolean).pop()); }
            catch (_e) { console.log(["PARSE-ERR", "", "", ""].join("\t")); return; }
            const id = process.argv[1];
            const c = (j.checks || []).find(x => x && x.id === id);
            const b = (j.blockers || []).find(x => x && x.id === id);
            console.log([
                c ? String(c.status) : "ABSENT",
                c ? String(c.nextStep === null || c.nextStep === undefined ? "" : c.nextStep) : "",
                b ? "yes" : "no",
                b ? String(b.nextStep === null || b.nextStep === undefined ? "" : b.nextStep) : "",
            ].join("\t"));
        });
    ' "$2"
}

# 老回执改写器：删掉 engineHash，用**引擎自己导出的** contentHash 重算，产出一份「升级前写的」
#   合法回执。手搓哈希算法会在实现换算法时假红；借引擎自己的实现就永远对得上。
cat > "$TMP/legacy-receipt.mjs" <<'MJSEOF'
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [, , qualityPath, receiptPath] = process.argv;
const { contentHash } = await import(pathToFileURL(qualityPath).href);
const r = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
delete r.engineHash;
delete r.contentHash;
r.contentHash = contentHash(r);
fs.writeFileSync(receiptPath, JSON.stringify(r, null, 2) + '\n', 'utf8');
console.log(r.contentHash);
MJSEOF

# ---------------------------------------------------------------------------
echo ""
# 沙箱：有 catalog、工作树有一处改动（L3a 全段共用）。
SB_A=$(mksandbox l3a yes)
echo worktree-change >> "$SB_A/core/a.txt"

echo "--- L3a  release 的 gate-fresh：发版结论必须绑在一条新鲜的 gate 记录上 ---"
# 现状：release 只有七项（worktree/remote/dod/manifest/review-queue/fast-mode/ci），
#   跑没跑过闸、跑的是不是这棵树，发版命令一个字都不问。

run "$SB_A" release
REL_A1=$(rel_check "$OUT" gate-fresh)
A1_STATUS=$(printf '%s' "$REL_A1" | cut -f1)
A1_BLOCK=$(printf '%s' "$REL_A1" | cut -f3)
A1_BNEXT=$(printf '%s' "$REL_A1" | cut -f4)

chk "$([ "$A1_STATUS" = "FAIL" ] && echo 0 || echo 1)" \
    "L3a① 有 catalog、有代码改动、账本里没有 gate 记录 -> gate-fresh = FAIL" \
    "checks 里有 id=gate-fresh 且 status=FAIL" \
    "status=${A1_STATUS}（ABSENT = 这个检查项还不存在）"

chk "$([ "$A1_BLOCK" = "yes" ] && printf '%s' "$A1_BNEXT" | grep -q 'gate' && echo 0 || echo 1)" \
    "L3a② 该 FAIL 进 blockers，且下一步命令点名 gate" \
    "blockers 含 gate-fresh，其 nextStep 含 'gate'（契约给的是 node .claude/harness/harness.mjs gate）" \
    "inBlockers=$A1_BLOCK nextStep=[$A1_BNEXT]"

# 跑一趟真闸：PASS + 账本落一条记录。
run "$SB_A" gate
GATE_VERDICT=$(jval "$OUT" gate)
GATE_DH=$(jval "$OUT" diffHash)
chk "$([ "$RC" -eq 0 ] && [ "$GATE_VERDICT" = "PASS" ] && echo 0 || echo 1)" \
    "脚手架：沙箱里 gate 真跑出 PASS（后面两条断言的前提）" \
    "gate rc=0 且 gate=PASS" \
    "rc=$RC gate=$GATE_VERDICT diffHash=$GATE_DH"

# 指纹稳定性自证：gate/release 自己写的运行态文件如果动了指纹，L3a③ 就会是假红。
run "$SB_A" diff-hash
NOW_DH=$(jval "$OUT" diffHash)
chk "$([ "$GATE_DH" = "$NOW_DH" ] && echo 0 || echo 1)" \
    "脚手架：跑完 gate 后工作树指纹没变（运行态写入被 STATE_EXCLUDE 挡住）" \
    "gate 记录的 diffHash == 事后 diff-hash" \
    "gate=$GATE_DH now=$NOW_DH"

run "$SB_A" release
REL_A3=$(rel_check "$OUT" gate-fresh)
A3_STATUS=$(printf '%s' "$REL_A3" | cut -f1)
chk "$([ "$A3_STATUS" = "PASS" ] && echo 0 || echo 1)" \
    "L3a③ 账本里有一条 gate=PASS 且 diffHash 等于当前指纹 -> gate-fresh = PASS" \
    "status=PASS" \
    "status=${A3_STATUS}（ledger 行数=$(wc -l < "$SB_A/.claude/harness/state/ledger.jsonl" 2>/dev/null || echo 0)）"

# 代码往前走一步：那条记录背书的已经不是这棵树了。
echo one-more-change >> "$SB_A/core/a.txt"
run "$SB_A" diff-hash
MOVED_DH=$(jval "$OUT" diffHash)
run "$SB_A" release
REL_A4=$(rel_check "$OUT" gate-fresh)
A4_STATUS=$(printf '%s' "$REL_A4" | cut -f1)
chk "$([ "$A4_STATUS" = "FAIL" ] && echo 0 || echo 1)" \
    "L3a④ 改一个文件后 diffHash 不再匹配 -> gate-fresh 回到 FAIL" \
    "status=FAIL（旧 gate 记录不再背书新的树）" \
    "status=$A4_STATUS gate记录diffHash=$GATE_DH 当前diffHash=$MOVED_DH"
#   rc 3），所以 gate-fresh 必须自己认出来并拒收——否则开着 Fast Mode 空跑一趟就能喂饱发版闸。
#   契约明文「不是 fast-mode 下的全 SKIPPED」，任务清单里没单列这一条，见文件头说明①。
SB_FAST=$(mksandbox l3a-fast yes)
# allowFastSkip 只有单独写进 check 才成立，mksandbox 的默认模板不带，这里就地覆盖。
cat > "$SB_FAST/.claude/harness/module-catalog.json" <<'EOF'
{"version":1,
 "modules":[{"id":"core","paths":["core/**"],"riskTier":"medium"}],
 "global":[],
 "ignored":[".claude/**","src/**"],
 "riskChecks":{"medium":["probe"]},
 "checks":{"probe":{"command":"true","class":"test","allowFastSkip":true}}}
EOF
(cd "$SB_FAST" && git add -A && git commit -qm catalog) >/dev/null 2>&1
echo worktree-change >> "$SB_FAST/core/a.txt"
# fast 档只有一个开关：.claude/.runtime/tier.json（旧的 .claude/.fast-mode 判定不再读）。
mkdir -p "$SB_FAST/.claude/.runtime"
printf '{"tier":"fast","reason":"test","by":"test","set_epoch":%s,"expires_epoch":%s}\n' \
    "$(date +%s)" "$(( $(date +%s) + 3600 ))" > "$SB_FAST/.claude/.runtime/tier.json"
run "$SB_FAST" gate
FAST_VERDICT=$(jval "$OUT" gate)
FAST_SKIPPED=$(jval "$OUT" skippedByFastMode)
FAST_RESULTS=$(jval "$OUT" results)
chk "$([ "$FAST_VERDICT" = "PASS" ] && [ "$FAST_SKIPPED" != "[]" ] && echo 0 || echo 1)" \
    "脚手架：fast-mode 下的 gate 确实落了一条 gate=PASS 的全 SKIPPED 记录（这就是要挡的东西）" \
    "gate=PASS 且 skippedByFastMode 非空" \
    "gate=$FAST_VERDICT rc=$RC skipped=$FAST_SKIPPED results=$(printf '%s' "$FAST_RESULTS" | head -c 160)"
run "$SB_FAST" release
REL_A7=$(rel_check "$OUT" gate-fresh)
A7_STATUS=$(printf '%s' "$REL_A7" | cut -f1)
# 同上：要求这项存在，否则「检查项还没实现」也能撑出一条绿。
chk "$([ "$A7_STATUS" != "PASS" ] && [ "$A7_STATUS" != "ABSENT" ] && [ "$A7_STATUS" != "PARSE-ERR" ] && echo 0 || echo 1)" \
    "L3a⑦ fast-mode 全 SKIPPED 的 gate 记录不许喂饱 gate-fresh（契约说这种判 FAIL）" \
    "gate-fresh 这项存在，且 status != PASS（写否定形式：FAIL 或 DEGRADED 都算合规修法）" \
    "status=$A7_STATUS"

# ---------------------------------------------------------------------------
echo ""
echo "==== test-release-binding：PASS=$PASS FAIL=$FAIL ===="
[ "$FAIL" -eq 0 ] || exit 1
exit 0