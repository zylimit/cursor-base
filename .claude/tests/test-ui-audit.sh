#!/usr/bin/env bash
# risk: high
# test-ui-audit.sh — UI 审计闸（scripts/ui-audit.mjs）的回归测试。
#
# 契约：node ui-audit.mjs <url|目录> [--themes a,b] [--widths 1280,900] [--out <dir>] [--strict] [--json]
#   无参 → stderr 用法 rc 2；--help → stdout 用法 rc 0；目标既非 URL 也非目录 → rc 2；
#   找不到浏览器引擎 → stderr 一行「UI 审计缺席」rc 3；有引擎 → 逐主题×宽度审计 + 截图，
#   写 <out>/ui-audit.json（含 pass 与 combos），--strict 且不 pass → rc 1。缺引擎那条单列：一个把「没装 playwright」吞成 rc 0 的审计闸，会在 CI 上永远绿着。
# 只留高风险几条：缺席不冒充通过（U4/U9）、目录与软链穿越（U8/U10）、对比度判红（U7）。
#   参数解析的花样组合与要真引擎的渲染用例早已删。跑不成的路径走 SKIPPED 并计数，不算 PASS
#   也不算 FAIL：「未执行 != 通过」。
# 老化退休（2026-09-15）：U0（被测脚本存在，自证）、U1 / U2 / U3（同一条用法 + 退出码契约的
#   三个入口，退出码由 U4 的 rc 3 守着）、U22（空 catch，那条规则由 dod 的 fitness 扫全仓，
#   本套件里是第二把同样的尺子）删了。
#   U7 一度也在退休名单里，主 Agent 判回：它不在「泄密 / 毁数据 / 装坏别人项目 / 发错版 /
#   签字闸误放行」五类里，但删了就没人守 ui-audit 的核心判定——脚本核心行为的唯一回归不退。
#   编号不重排，账本里同名用例的历史才接得上。
# 站点夹具只剩一页：U7 走的是桩返回的 canned 审计结果，判定与页面内容无关；真渲染那条早已删。
# 用法：bash test-ui-audit.sh [ui-audit.mjs 路径]
set -u

SRC=$(cd "$(dirname "$0")/.." && pwd)
AUDIT=${1:-"$SRC/scripts/ui-audit.mjs"}
case "$AUDIT" in /*) ;; *) AUDIT="$PWD/$AUDIT" ;; esac   # 桩用例要切 cwd，先钉成绝对路径

echo "===== test-ui-audit ====="
command -v node >/dev/null 2>&1 || {
    echo 'SKIPPED: 无 node——被测脚本是 .mjs，未执行 != 通过。'
    exit 0
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0; SKIP=0
pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
skip() { SKIP=$((SKIP + 1)); echo "  [SKIPPED] $1"; }
chk() {
    if [ "$1" -eq 0 ]; then pass "$2"; else fail "$2"; fi
    echo "         EXPECT $3"
    echo "         GOT    $4"
}
contains() { case "$2" in *"$1"*) return 0 ;; *) return 1 ;; esac; }
brief() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-200 | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null; }

RC=0; STDOUT=""; STDERR=""

# 引擎在不在，决定 U4 与桩用例怎么隔离
if node -e "require.resolve('playwright-core')" >/dev/null 2>&1 || node -e "require.resolve('playwright')" >/dev/null 2>&1; then
    HAS_ENGINE=1
else
    HAS_ENGINE=0
fi
echo "  [ENV] 浏览器引擎可用=$HAS_ENGINE"

# 站点夹具：剩下的用例只把它当「一个存在的目录」用（审计判定那条已退休），一页就够。
mkdir -p "$TMP/site"
printf '%s\n' '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>派单</title></head><body>一页</body></html>' > "$TMP/site/index.html"

# U4 缺引擎必须是 rc 3。引擎在场时把脚本复制到仓外目录，**并且在该目录里跑**：
#   ui-audit.mjs 的回退解析是 createRequire(join(process.cwd(), 'noop.js'))，认的是 cwd 不是文件位置——
#   只搬文件不切 cwd 的话，ESM 那步确实找不到包，但紧接着的 require 回退仍从仓库根解析得到，
#   引擎正常起来 rc 0，本条就在装过 playwright-core 的机器上恒红（假红，不是实现的错）。
#   两条解析路径得一起掘断，缺一不可。
U4RUN="$AUDIT"
if [ "$HAS_ENGINE" -eq 1 ] && [ -f "$AUDIT" ]; then
    mkdir -p "$TMP/iso"; cp "$AUDIT" "$TMP/iso/ui-audit.mjs"; U4RUN="$TMP/iso/ui-audit.mjs"
fi
(cd "$(dirname "$U4RUN")" && NODE_PATH=/nonexistent node "$U4RUN" "$TMP/site") > "$TMP/o" 2> "$TMP/e"
RC=$?; STDERR=$(cat "$TMP/e")
if [ "$RC" -eq 3 ] && contains 'UI 审计缺席' "$STDERR"; then r=0; else r=1; fi
chk "$r" "U4 引擎不可用 → stderr 一行「UI 审计缺席」，rc 3（缺席不许冒充通过）" \
    "rc=3 且 stderr 含「UI 审计缺席」" "rc=${RC}；stderr：$(brief "$STDERR")"

# ---------------------------------------------------------------------------
# 引擎桩：本机没装 playwright 也要能验「审计判定」与「启动失败」两条路径。
# 桩是个 CJS 包（package.json 的 main 指向 index.js；写成 exports.chromium 是为了让
#   cjs-module-lexer 认出具名导出）。默认以桩目录为 cwd 跑仓里那份 ui-audit.mjs；本机若
#   真装了 playwright（会抢在裸 import 那一步），改把脚本复制进桩目录，让裸 import 也落到桩上。
# ---------------------------------------------------------------------------
STUB_THROW='exports.chromium = { async launch() { throw new Error("boom-launch"); } };'

STUB_CONTRAST=$(cat <<'JS'
const fs = require('fs');
const AUDIT = {
  overflows: [], wrapped: [], contrastFails: [{ cls: 'x', text: '灰字', ratio: 2.1 }],
  genericTells: { upperTinyLabels: 0, midDotTexts: 0, arrowEndings: 0, radiusValues: 0, uniformRadius: false },
  elementCount: 50, textLength: 200,
};
const page = {
  async setViewportSize() {}, async goto() {}, async waitForTimeout() {},
  // 带参数那次是设 data-theme，不带参数那次才是 PAGE_AUDIT
  async evaluate(fn, ...args) { return args.length ? undefined : AUDIT; },
  async screenshot(opts) { fs.writeFileSync(opts.path, ''); },
};
const browser = { async newPage() { return page; }, async close() {} };
exports.chromium = { async launch() { return browser; } };
JS
)

stub_run() { # <用例名> <index.js 内容> [args...]
    local name=$1 js=$2 runner; shift 2
    local d="$TMP/$name"
    mkdir -p "$d/node_modules/playwright-core"
    printf '%s\n' '{"name":"playwright-core","version":"0.0.0-stub","main":"index.js"}' \
        > "$d/node_modules/playwright-core/package.json"
    printf '%s\n' "$js" > "$d/node_modules/playwright-core/index.js"
    runner="$AUDIT"
    if [ "$HAS_ENGINE" -eq 1 ]; then cp "$AUDIT" "$d/ui-audit.mjs"; runner="$d/ui-audit.mjs"; fi
    ( cd "$d" && node "$runner" ${@+"$@"} ) > "$TMP/o" 2> "$TMP/e"
    RC=$?; STDOUT=$(cat "$TMP/o"); STDERR=$(cat "$TMP/e")
}

stub_run u7 "$STUB_CONTRAST" "$TMP/site" --strict --themes light --widths 1280 --out "$TMP/u7out"
ok=1
[ "$RC" -eq 1 ] || ok=0
[ -f "$TMP/u7out/ui-audit.json" ] || ok=0
if [ -f "$TMP/u7out/ui-audit.json" ] && ! grep -qE '"pass"[[:space:]]*:[[:space:]]*false' "$TMP/u7out/ui-audit.json"; then ok=0; fi
if [ "$ok" -eq 1 ]; then r=0; else r=1; fi
chk "$r" "U7 只有对比度不达标也要判红：4.5:1 是 ui-quality-floor 的 MUST，闸不拦等于没闸" \
    "rc=1 且 <out>/ui-audit.json 里 pass=false" \
    "rc=${RC}；报告存在=$([ -f "$TMP/u7out/ui-audit.json" ] && echo yes || echo no)；pass 行：$(grep -a '\"pass\"' "$TMP/u7out/ui-audit.json" 2>/dev/null | tr -d ' ')；stderr：$(brief "$STDERR")"

# ---------------------------------------------------------------------------
# 穿越探针：U8（/../ 三种写法）与 U10（软链）判的是同一件事——服务目录外的文件不许被端出来，
#   只有待试路径不同，所以共用一份。必须走 raw socket：fetch / undici 会先把 /../ 规范化掉，
#   穿越根本发不出去，测出来的是客户端而不是服务端。
# ---------------------------------------------------------------------------
cat > "$TMP/probe.mjs" <<'PROBEJS'
import net from 'node:net';
const L = process.env.PROBE_LABEL;
const mod = await import(process.env.PROBE_AUDIT);
if (typeof mod.serveDir !== 'function') { console.log(L + '-NO-EXPORT'); process.exit(9); }
const { server, url } = await mod.serveDir(process.env.PROBE_ROOT + '/site');
const port = Number(new URL(url).port);
const raw = (path) => new Promise((ok) => {
  const c = net.connect(port, '127.0.0.1', () => c.write('GET ' + path + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'));
  let buf = ''; c.on('data', (d) => { buf += d; }); c.on('end', () => ok(buf)); c.on('error', (e) => ok('ERR ' + e.message));
});
const bad = [];
for (const t of process.env.PROBE_PATHS.split(' ')) {
  const res = await raw(t);
  if (/^HTTP\/1\.\d 200/.test(res) || res.includes('CANARY-OUTSIDE')) bad.push(t);
}
const inside = await raw('/index.html');
server.close();
if (bad.length) { console.log(L + '-LEAK ' + bad.join(' ')); process.exit(1); }
if (!/^HTTP\/1\.\d 200/.test(inside)) { console.log(L + '-INSIDE-BROKEN'); process.exit(2); }
console.log(L + '-OK');
PROBEJS

probe() { # <标签> <root（其 site/ 子目录被服务）> <待试路径，空格分隔>
    PROBE_LABEL="$1" PROBE_AUDIT="$AUDIT" PROBE_ROOT="$2" PROBE_PATHS="$3" \
        node "$TMP/probe.mjs" > "$TMP/o" 2> "$TMP/e"
    RC=$?; STDOUT=$(cat "$TMP/o"); STDERR=$(cat "$TMP/e")
}

mkdir -p "$TMP/u8/site"
printf '%s\n' '<!doctype html><html lang="zh"><body>站点内的正常页面</body></html>' > "$TMP/u8/site/index.html"
printf '%s\n' 'CANARY-OUTSIDE-DO-NOT-SERVE' > "$TMP/u8/secret-outside.txt"
probe U8 "$TMP/u8" '/../secret-outside.txt /%2e%2e/secret-outside.txt /..%2Fsecret-outside.txt'
if [ "$RC" -eq 0 ] && contains 'U8-OK' "$STDOUT"; then r=0; else r=1; fi
chk "$r" "U8 目录服务不许被 /../ 穿越读到服务目录外的文件（三种写法都要挡）" \
    "rc=0 且 stdout 含 U8-OK（三次穿越都非 200 且不含 canary，站内 index.html 仍 200）" \
    "rc=${RC}；stdout：$(brief "$STDOUT")；stderr：$(brief "$STDERR")"

# U10 前缀校验只看解析后的路径字符串，软链是在 readFile 那一步才被跟随的——站内一个指向
#   站外的软链就能把 canary 端出来，路径前缀怎么看都还在 root 之内。
mkdir -p "$TMP/u10/site" "$TMP/u10/outside"
printf '%s\n' 'CANARY-OUTSIDE-DO-NOT-SERVE' > "$TMP/u10/outside/secret.txt"
printf '%s\n' '<!doctype html><html lang="zh"><body>站点内的正常页面</body></html>' > "$TMP/u10/site/index.html"
if ln -s ../outside/secret.txt "$TMP/u10/site/link.txt" 2>/dev/null && ln -s ../outside "$TMP/u10/site/dirlink" 2>/dev/null; then
    probe U10 "$TMP/u10" '/link.txt /dirlink/secret.txt'
    if [ "$RC" -eq 0 ] && contains 'U10-OK' "$STDOUT"; then r=0; else r=1; fi
    chk "$r" "U10 站内指向站外的软链（文件链 + 目录链）不许被端出来" \
        "rc=0 且 stdout 含 U10-OK（两条软链都非 200 且不含 canary，站内 index.html 仍 200）" \
        "rc=${RC}；stdout：$(brief "$STDOUT")；stderr：$(brief "$STDERR")"
else
    skip "U10 软链穿越：本文件系统建不了符号链接，未执行 != 通过"
fi

# ---------------------------------------------------------------------------
# U9 缺席不许留着上一轮的旧证据当通过：旧 ui-audit.json 还写着 pass:true，下游看报告就
#   以为这轮审计过了。顺带守一条防回归位：rc 2 / 3 都不许顺手把 --out 目录建出来。
# ---------------------------------------------------------------------------
mkdir -p "$TMP/u9out"
printf '%s\n' '{"pass": true, "target": "OLD-RUN"}' > "$TMP/u9out/ui-audit.json"
stub_run u9 "$STUB_THROW" "$TMP/site" --strict --out "$TMP/u9out"
ok=1
[ "$RC" -eq 3 ] || ok=0
grep -aqE '"pass"[[:space:]]*:[[:space:]]*true' "$TMP/u9out/ui-audit.json" && ok=0
grep -aqE '"absent"[[:space:]]*:[[:space:]]*true' "$TMP/u9out/ui-audit.json" || ok=0
stub_run u9b "$STUB_THROW" "$TMP/site" --out "$TMP/u9never"
[ -d "$TMP/u9never" ] && ok=0
if [ "$ok" -eq 1 ]; then r=0; else r=1; fi
chk "$r" "U9 缺席时旧 ui-audit.json 必须被覆写成「没跑」，且不为缺席新建 --out 目录" \
    "rc=3；报告里 pass 不为 true 且含 absent:true；$TMP/u9never 不许被建出来" \
    "rc=${RC}；报告=$(brief "$(cat "$TMP/u9out/ui-audit.json" 2>/dev/null)")；never 目录存在=$([ -d "$TMP/u9never" ] && echo yes || echo no)"

echo "  [NOTE] 未覆盖：URL 目标、多主题×多宽度组合矩阵、截图文件命名、--json 的 combos 结构细节、"
echo "         参数解析的花样组合，以及退休掉的对比度判红与空 catch 两条——前者靠 design-maker"
echo "         的人工验收，后者靠 dod 的 fitness 全仓扫。"

echo ""
echo "==== test-ui-audit：PASS=$PASS FAIL=$FAIL SKIPPED=$SKIP ===="
# 退出码三态：有红退 1；全绿但有跳过退 3——「未执行 != 通过」必须传得出这一层，
#   否则 CI 上没装引擎就是永远的绿。
[ "$FAIL" -eq 0 ] || exit 1
[ "$SKIP" -eq 0 ] || exit 3
exit 0
