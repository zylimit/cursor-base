#!/usr/bin/env bash
# risk: low
# handover-docs-triggers-readable-docs.sh — 真触发测试（需真 claude CLI）。
# 大白话「项目要交给没参与开发的团队，出能看懂的数据库设计和架构文档」（没提技能名）应触发 readable-docs，
# 且调 Skill 前不偷跑 Edit / Write / Bash。
# 跑法同 todo-app-triggers-product-spec.sh：claude -p --output-format stream-json 拿事件日志后断言；
#   默认不被 run-all 触发——run-all 第三段要 CCBASE_RUN_CLAUDE_CASES=1 才跑 cases/*.sh。
#
# 与另两个真触发用例的区别（也是这份用例最要紧的一处）：**不在仓库根下跑会话**。
#   readable-docs 一触发就会去跑 init、build，往当前目录写 docs/readable-src/、docs/readable/；
#   在仓库根跑 = 把生成物写进 cc-base 自己。可选的办法有两个：
#     ① 在临时目录里的小项目上跑，先用仓库根的 setup.sh 把框架装进去（路由规则才生效）；
#     ② 限制轮数、只看到 Skill 事件就停——本机 claude 没有 --max-turns 之类的开关（claude --help 实测），做不到。
#   选 ①：Skill 触发之后会话想写什么都落在临时目录，用完整个删掉；跑完再断言仓库根 git status --short 没多出生成物。
# 前提说明：临时项目里放了一份合成的建表文件 sql/schema.sql 与代码目录 app/，让技能有东西可出文档；名字全是合成的。
set -eu

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/../test-helpers.sh
. "$DIR/../test-helpers.sh"

PROMPT="这个项目下个月要交给另一个团队，他们没参与过开发，给他们出一套能看懂的数据库设计和架构文档"
SKILL="readable-docs"
TIMEOUT="${CASE_TIMEOUT:-300}"

ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || ROOT="$(cd "$DIR/../../.." && pwd)"
LOG=$(mktemp 2>/dev/null) || { echo "FAIL: mktemp 失败"; exit 1; }
PROJ=$(mktemp -d 2>/dev/null) || { echo "FAIL: mktemp -d 失败"; exit 1; }
trap 'rm -rf "$LOG" "$PROJ"' EXIT

echo "=== 真触发测试：$PROMPT → $SKILL ==="
echo "临时项目（会话在这里跑，不在仓库根）：$PROJ"

# ---- 搭临时项目：合成的小项目 + 装上框架 ----
mkdir -p "$PROJ/sql" "$PROJ/app"
printf '# 示例系统 需求规格\n\n## 功能需求\n- [REQ-A-001] 记录订单 [确认]\n' >"$PROJ/Product-Spec.md"
printf 'CREATE TABLE orders (id int PRIMARY KEY, status text);\nCREATE TABLE order_items (id int PRIMARY KEY, order_id int REFERENCES orders(id));\n' >"$PROJ/sql/schema.sql"
for i in 1 2 3 4; do printf 'def f%s():\n    return %s\n' "$i" "$i" >"$PROJ/app/m$i.py"; done
git -C "$PROJ" init -q
if ! bash "$ROOT/setup.sh" "$PROJ" >"$PROJ/.setup.log" 2>&1; then
    echo "FAIL: setup.sh 装不进临时项目（见下）"; tail -5 "$PROJ/.setup.log"; exit 1
fi
rm -f "$PROJ/.setup.log"

BEFORE=$(git -C "$ROOT" status --short)

echo "运行 claude -p（静默，最长 ${TIMEOUT}s）…"
( cd "$PROJ" && timeout "$TIMEOUT" claude -p "$PROMPT" \
    --dangerously-skip-permissions \
    --verbose \
    --output-format stream-json \
    > "$LOG" 2>&1 ) || true

if [ ! -s "$LOG" ]; then
    echo "FAIL: claude 无输出（日志为空）——可能超时或 CLI 异常。"
    exit 1
fi

echo ""
echo "--- 断言 ---"
RC=0
assert_skill_invoked "$LOG" "$SKILL"   || RC=1
assert_no_premature_action "$LOG"      || RC=1

# 仓库根没因这次会话多出东西（会话本不在那儿跑，这条是兜底：防的是技能路径写死到别处）。
# 判据：跑后新出现的 status 行里碰到 docs/readable 或 docs/readable-src（技能的生成物）即红；
# 其它新行（别人同时在改仓库）只打 NOTE 不判红——会话在 $PROJ 里跑，root 上的别的变化不是它造成的。
AFTER=$(git -C "$ROOT" status --short)
NEWL=$(diff <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER") | grep '^>' || true)
if printf '%s\n' "$NEWL" | grep -qE 'docs/readable(-src)?(/|$)'; then
    _fail "仓库根 git status --short 跑后多出人读文档生成物"; printf '%s\n' "$NEWL" | sed 's/^/    /' | head -10; RC=1
else
    _pass "仓库根 git status --short 没多出 docs/readable 与 docs/readable-src 下的东西"
    [ -z "$NEWL" ] || { echo "    NOTE: 跑期间仓库根另有变化（并发改动，非本会话生成物）："; printf '%s\n' "$NEWL" | sed 's/^/      /' | head -5; }
fi
print_summary

echo "日志：$LOG（退出时删除）"
if [ "$RC" -eq 0 ]; then echo "CASE: PASS"; else echo "CASE: FAIL"; fi
exit "$RC"
