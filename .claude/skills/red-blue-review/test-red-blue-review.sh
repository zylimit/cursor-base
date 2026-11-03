#!/usr/bin/env bash
# test-red-blue-review.sh — red-blue-review.sh 的回归测试，锁「静默空包」保护契约。
# 核心契约：无效 BASE ref 必须响亮报错（非零退出 + 明确报错），绝不静默 exit 0 产空证据包——
#   否则审查工具会因手滑参数序 / ref 拼错谎报「没东西可审」。若哪天有人把 ref 校验删了导致静默空包，
#   断言1 要能转红。--working 位置无关（base-tag --working 与 --working base-tag 等价）是正确行为，断言2/3 兼锁之。
# 测试自造临时 git repo（带 tag base-tag + 一处已知改动），断言可判定、可独立重跑，不依赖 cc-base 当前状态。
# 用法： bash test-red-blue-review.sh   → 退出码 0 表示全绿；非 0 表示有断言失败。
set -eu

SCRIPT="$(cd "$(dirname "$0")" && pwd)/red-blue-review.sh"
[ -f "$SCRIPT" ] || { echo "找不到被测脚本：$SCRIPT" >&2; exit 2; }

# ---- 造临时 git repo：一个 base-tag + 一处真实改动（HEAD 相对 tag 有 diff）----
WORK=$(mktemp -d -t rbr-test.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
git init -q
git config user.email t@t.t
git config user.name t
git config commit.gpgsign false
printf 'line1\nline2\n' >file.txt
git add file.txt
git commit -q -m init
git tag base-tag
# 相对 base-tag 的已知改动：改一行 + 新增一行（保证 diff 行数 > 0、有删除行、有改动文件）
printf 'line1-CHANGED\nline2\nline3-NEW\n' >file.txt
git add file.txt
git commit -q -m change

PASS=0; FAIL=0
ok()   { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

run() {  # run <args...> → 填 OUT(stdout) ERR(stderr) RC(exit code)
  set +e
  OUT=$(bash "$SCRIPT" "$@" 2>/tmp/rbr_err.$$); RC=$?
  ERR=$(cat /tmp/rbr_err.$$); rm -f /tmp/rbr_err.$$
  set -e
}

echo "[断言1] 锁保护契约：无效 BASE ref → 必须非零退出 + 明确报错（防静默空包）"
# 拼错 / 不存在的 ref。脚本须响亮报错（exit≠0 + 「无效的 BASE ref」），不许静默产空证据包。
run nonexistent-ref-xyz
ERRORED=0
[ "$RC" -ne 0 ] && ERRORED=1                                    # 非零退出 = 明确报错
echo "$OUT$ERR" | grep -qiE "error|无效|invalid|未知|unknown|bad revision|unrecognized" && ERRORED=1  # 或 stdout/stderr 明确报错
# 同时确认没把空证据包当正常产出（即便万一 exit 0，产了空包也算违约）。
EMPTY=0
echo "$OUT" | grep -q "完整 diff（0 行）" && EMPTY=1
echo "$OUT" | grep -q "（无改动）" && EMPTY=1
if [ "$ERRORED" -eq 1 ] && [ "$EMPTY" -eq 0 ]; then
  ok "无效 BASE ref 'nonexistent-ref-xyz' 响亮报错、未产空证据包（RC=${RC}）"
else
  bad "保护契约破裂：无效 ref 未响亮报错或仍产空证据包（RC=${RC}，ERRORED=${ERRORED}，EMPTY=${EMPTY}）"
fi

echo "[断言2] 正常路径（防误伤）：--working 在前 + 有效 BASE → 产非空证据包"
run --working base-tag
N2=0
echo "$OUT" | grep -q "改动清单" && N2=$((N2+1))               # 含「改动清单」段
echo "$OUT" | grep -q "file.txt" && N2=$((N2+1))               # 列出了改动文件
echo "$OUT" | grep -qE "完整 diff（[1-9][0-9]* 行）" && N2=$((N2+1))  # diff 行数 > 0
if [ "$RC" -eq 0 ] && [ "$N2" -ge 2 ]; then
  ok "正常路径产出非空证据包（含改动清单 + 改动文件 + diff>0，命中 $N2/3，RC=${RC}）"
else
  bad "正常路径未产出预期非空证据包（命中 $N2/3，RC=${RC}）"
fi

echo "[断言2b] --working 位置无关：'base-tag --working'（BASE 在前）也应产非空证据包"
run base-tag --working
N2B=0
echo "$OUT" | grep -q "改动清单" && N2B=$((N2B+1))
echo "$OUT" | grep -q "file.txt" && N2B=$((N2B+1))
echo "$OUT" | grep -qE "完整 diff（[1-9][0-9]* 行）" && N2B=$((N2B+1))
if [ "$RC" -eq 0 ] && [ "$N2B" -ge 2 ]; then
  ok "BASE 在前的 'base-tag --working' 等价于 '--working base-tag'，产出非空证据包（命中 $N2B/3，RC=${RC}）"
else
  bad "--working 位置相关了：'base-tag --working' 未产出预期非空证据包（命中 $N2B/3，RC=${RC}）"
fi

echo "[断言3] 无 fatal 泄漏：任一调用 stderr 不含 fatal"
LEAK=0
for args in "base-tag --working" "--working base-tag" "nonexistent-ref-xyz"; do
  # shellcheck disable=SC2086
  run $args
  if echo "$ERR" | grep -qi "fatal"; then
    bad "调用 '$args' stderr 泄漏 fatal：$(echo "$ERR" | grep -i fatal | head -1)"
    LEAK=1
  fi
done
[ "$LEAK" -eq 0 ] && ok "三种调用 stderr 均无 fatal 泄漏"

echo
echo "结果：PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
