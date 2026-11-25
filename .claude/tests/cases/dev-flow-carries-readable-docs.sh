#!/usr/bin/env bash
# risk: low
# dev-flow-carries-readable-docs.sh — 真跑用例（需真 claude CLI，贵）。
# 验什么：装了框架的存量项目里，只说「开发 Phase 2」，人读文档自己跟上：
#   开工前起头（readable-docs init）、派给实现者的单子里带着核对那一句、实现者给新表写了说明、
#   主会话验收时亲自跑 check、页面连同源一起入库、存量缺口没变多。
# 为什么开发计划里故意一个字不提人读文档：存量项目的计划都是这个功能之前写的；
#   要验的是开发流程（技能与规则的文字）自己会带上，不靠谁在计划里记着写一句。
#   最贵的错是流程文字改坏了（开工不再起头、派单不再带那一句）而没有任何东西报警——这条用例就是那个警报。
#
# 三道开关（默认什么都不做）：
#   1. CCBASE_RUN_DEV_FLOW_CASE=1 才真跑。run-all 第三段开了 CCBASE_RUN_CLAUDE_CASES=1 也不跑它——太贵。
#   2. 没有 claude 命令：SKIPPED。
#   3. 回放模式：CASE_REPLAY_LOG=<事件日志> CASE_REPLAY_PROJ=<跑完后的项目目录> 两个都给，
#      跳过搭项目与起会话，直接对这两样跑全部断言（D8 跳过）。不需要前两个开关，不需要 claude。离线核断言用。
# run-all 第三段点名跳过它（不跑、不计入「通过」的个数）；要验就单独执行：CCBASE_RUN_DEV_FLOW_CASE=1 bash <本文件>。
#   直接执行而没开开关时仍打印 SKIPPED: 并退 0，SKIPPED 行写明「未执行 != 通过」。
# 代价：一次约 15 分钟、几美元（2026-11-24 手工跑的那次：14 分 35 秒、39 轮）。CASE_TIMEOUT（默认 2700 秒）、
#   CASE_BUDGET（默认 15 美元）可调；CASE_KEEP=1 保留临时项目与日志并打印路径。
# 会话不连任何 MCP：--strict-mcp-config 不带 --mcp-config，免得会话碰用户的记忆库等外部服务。
# 临时项目全在 mktemp -d 里，不碰仓库根；D8 兜底核跑前跑后仓库根 git status --short 相同。
set -eu

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/../test-helpers.sh
. "$DIR/../test-helpers.sh"

ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || ROOT="$(cd "$DIR/../../.." && pwd)"
PROMPT="/dev-builder 开发 Phase 2：照 DEV-PLAN.md 做完整个 Phase，含收尾的四步走，中间不用问我。"
REPLAY=0
if [ -n "${CASE_REPLAY_LOG:-}" ] && [ -n "${CASE_REPLAY_PROJ:-}" ]; then REPLAY=1; fi

if [ "$REPLAY" -eq 0 ]; then
    if [ "${CCBASE_RUN_DEV_FLOW_CASE:-0}" != "1" ]; then
        echo "SKIPPED: dev-flow-carries-readable-docs 太贵（一次约十五分钟、几美元），要 CCBASE_RUN_DEV_FLOW_CASE=1 才跑（CCBASE_RUN_CLAUDE_CASES=1 单独开也不跑）；未执行 != 通过。"
        exit 0
    fi
    if ! command -v claude >/dev/null 2>&1; then
        echo "SKIPPED: 无 claude CLI（command -v claude 未找到）——开发流程真跑用例跳过，未执行 != 通过。"
        exit 0
    fi
fi
command -v node >/dev/null 2>&1 || { echo "FAIL: 需要 node"; exit 1; }

CLEAN=""
cleanup() {
    [ -n "$CLEAN" ] || return 0
    if [ "${CASE_KEEP:-0}" = "1" ]; then echo "CASE_KEEP=1，保留：$CLEAN"; else rm -rf $CLEAN; fi
}
trap cleanup EXIT

if [ "$REPLAY" -eq 1 ]; then
    LOG="$CASE_REPLAY_LOG"; PROJ="$CASE_REPLAY_PROJ"
    [ -s "$LOG" ] || { echo "FAIL: 回放日志不存在或为空：$LOG"; exit 1; }
    [ -d "$PROJ/.claude" ] || { echo "FAIL: 回放项目目录不对（没有 .claude/）：$PROJ"; exit 1; }
    echo "=== 回放模式：不起会话，对录下来的日志与项目跑断言 ==="
else
    LOG=$(mktemp) || { echo "FAIL: mktemp 失败"; exit 1; }
    PROJ=$(mktemp -d) || { echo "FAIL: mktemp -d 失败"; exit 1; }
    CLEAN="$LOG $LOG.err $PROJ"
    echo "=== 真跑：$PROMPT ==="
    echo "临时项目：$PROJ"

    # ---- 搭合成项目（图书借阅小系统，Phase 1 做完、Phase 2 待开发；计划里不提人读文档）----
    mkdir -p "$PROJ/db" "$PROJ/app" "$PROJ/tests"
    printf '.claude/\n__pycache__/\n*.db\n' >"$PROJ/.gitignore"
    cat >"$PROJ/Product-Spec.md" <<'EOF'
# 图书借阅系统

## 产品概述

给一家社区图书馆用：馆员管书，读者借书还书。风险档位：自用小工具。

## 功能需求

- [REQ-LIB-001] **借书**：读者在柜台出示借书证 → 系统记下一次借出并算出应还时间 → 读者拿走这一册书 `[确认]`
- [REQ-LIB-002] **还书**：读者把书还回柜台 → 系统结清这一次借出 → 这一册书回到在架 `[确认]`
- [REQ-LIB-003] **预约**：读者想借的书都被借走时可以预约 → 系统按先后排队 → 书还回来时排在最前面的读者得到通知，保留三天 `[确认]`

## 规则与例外

- 每位读者同时最多借 5 册。
- 同一位读者对同一种书（同一个 ISBN）只能有一条有效的预约。
- 预约按提交的先后排队；书还回来时只通知排在最前面的一位。

## 技术方向

- Python 标准库加 SQLite，不引第三方依赖 `[确认]`
- 建表定义在 db/schema.sql；测试用内存库，`python3 -m unittest discover -s tests` `[确认]`
EOF
    cat >"$PROJ/DEV-PLAN.md" <<'EOF'
# Development Plan — 图书借阅系统

> 记录项目的开发阶段划分、当前进度和剩余工作。新 session 启动先读本文件。

## Phase 1: 借书与还书 ✅（2026-11-20，PASS）

**交付内容**：
- 读者办证；借书记下一次借出并算应还时间；还书结清借出、这一册回到在架

**验证的假设**：
- 无

**关键文件**：
- `db/schema.sql` — 建表定义
- `app/db.py` — 数据库连接与建库
- `app/members.py` — 读者办证
- `app/loans.py` — 借书与还书

**Task 清单**：
- **Task 1.1：读者、书、借出三张表与办证** — `db/schema.sql`、`app/db.py`、`app/members.py`；验证 `python3 -m unittest discover -s tests`
  - Business Context：馆员给读者办借书证，证号不重复。
  - 依赖类型：无
  - 证据产生者：implementer 自检
- **Task 1.2：借书与还书（[REQ-LIB-001] [REQ-LIB-002]）** — `app/loans.py` 的 `borrow` 与 `give_back`；验证 `python3 -m unittest discover -s tests`
  - Business Context：每位读者同时最多借 5 册；还书后这一册回到在架。例子：已借 5 册的读者再借，拒绝。
  - 依赖类型：功能前置＝Task 1.1
  - 证据产生者：code-reviewer 复核

**验收标准**：
- 单元测试全过；借满 5 册再借被拒

---

## Phase 2: 预约排队

**交付内容**：
- 读者对被借走的书预约，系统按先后排队
- 书还回来时，排在最前面的预约变成「已通知」并记下保留到哪天

**验证的假设**：
- 无

**关键文件**：
- `db/schema.sql` — 新增预约表
- `app/reservations.py` — 预约与排队
- `app/loans.py` — 还书时通知最前面的预约（owner：Task 2.1）

**Task 清单**：
- **Task 2.1：预约表、预约与还书时的通知（[REQ-LIB-003]）** — `db/schema.sql` 新增 `reservations` 表；新建 `app/reservations.py`（`reserve`、`next_in_line`）；`app/loans.py` 的 `give_back` 在还书后把这种书最前面的一条有效预约标成已通知并记保留到期日；验证 `python3 -m unittest discover -s tests`
  - Business Context：想借的书都被借走时读者可以预约；同一位读者对同一种书（同一个 ISBN）只能有一条有效的预约；书还回来时排在最前面的读者得到通知、保留三天。例子：读者甲、乙先后预约同一种书，书还回来时甲的预约变成已通知、保留到三天后，乙仍在排队；甲再预约同一种书被拒。
  - 依赖类型：功能前置＝Phase 1 的三张表与 `give_back`
  - 证据产生者：code-reviewer 复核

**验收标准**：
- 单元测试全过；上面例子里的三种情形各有一条测试；原有借还功能未破坏

---

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 语言 | Python | 3 | 只用标准库，不引第三方依赖 |
| 数据库 | SQLite | 随 Python | 测试用内存库，建表定义在 db/schema.sql |

## 数据库表

| 表名 | 所属 Phase | 用途 |
|------|-----------|------|
| `members` | Phase 1 | 读者 |
| `books` | Phase 1 | 书，一行是架上的一册 |
| `loans` | Phase 1 | 借出 |
| `reservations` | Phase 2 | 预约 |

## 开发规则

- 每完成一个 Phase 走四步走：Code Review → 测试完整性 → 编译验证 → 功能测试
- 四步走全部通过才算 Phase 完成
- Commit message 格式：`phase-N: 简要描述`
- 不引第三方依赖；测试用 `python3 -m unittest discover -s tests`
EOF
    cat >"$PROJ/db/schema.sql" <<'EOF'
-- 读者
CREATE TABLE members (
  id          integer PRIMARY KEY,
  card_no     text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 书：一行是架上的一册
CREATE TABLE books (
  id          integer PRIMARY KEY,
  isbn        text NOT NULL,
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'on_shelf'
);

-- 借出
CREATE TABLE loans (
  id           integer PRIMARY KEY,
  member_id    integer NOT NULL REFERENCES members(id),
  book_id      integer NOT NULL REFERENCES books(id),
  due_at       text NOT NULL,
  returned_at  text
);
EOF
    printf '"""图书借阅系统。"""\n' >"$PROJ/app/__init__.py"
    cat >"$PROJ/app/db.py" <<'EOF'
"""数据库连接：全系统共用的建库与连接。"""
import sqlite3
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "db" / "schema.sql"


def connect(path=":memory:"):
    """连上数据库；库是空的就照建表定义建出来。"""
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    if conn.execute("SELECT count(*) FROM sqlite_master WHERE type = 'table'").fetchone()[0] == 0:
        conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    return conn
EOF
    cat >"$PROJ/app/members.py" <<'EOF'
"""读者：办借书证。"""


def register(conn, card_no, name):
    """办证：证号不许重复。"""
    cur = conn.execute("INSERT INTO members (card_no, name) VALUES (?, ?)", (card_no, name))
    return cur.lastrowid
EOF
    cat >"$PROJ/app/loans.py" <<'EOF'
"""借还：借书与还书。"""
from datetime import datetime, timedelta

MAX_LOANS = 5
LOAN_DAYS = 30


class LoanError(Exception):
    """借不了或还不了：在借册数到了上限、这一册不在架、没有这一次借出。"""


def borrow(conn, member_id, book_id, now=None):
    """借书：查在借册数，记下一次借出并算出应还时间。"""
    now = now or datetime.now()
    n = conn.execute("SELECT count(*) FROM loans WHERE member_id = ? AND returned_at IS NULL", (member_id,)).fetchone()[0]
    if n >= MAX_LOANS:
        raise LoanError("在借册数已到上限")
    status = conn.execute("SELECT status FROM books WHERE id = ?", (book_id,)).fetchone()
    if status is None or status[0] != "on_shelf":
        raise LoanError("这一册不在架")
    due = (now + timedelta(days=LOAN_DAYS)).isoformat(timespec="seconds")
    cur = conn.execute("INSERT INTO loans (member_id, book_id, due_at) VALUES (?, ?, ?)", (member_id, book_id, due))
    conn.execute("UPDATE books SET status = 'on_loan' WHERE id = ?", (book_id,))
    return cur.lastrowid


def give_back(conn, loan_id, now=None):
    """还书：结清这一次借出，这一册回到在架。"""
    now = now or datetime.now()
    row = conn.execute("SELECT book_id FROM loans WHERE id = ? AND returned_at IS NULL", (loan_id,)).fetchone()
    if row is None:
        raise LoanError("没有这一次在借的借出")
    conn.execute("UPDATE loans SET returned_at = ? WHERE id = ?", (now.isoformat(timespec="seconds"), loan_id))
    conn.execute("UPDATE books SET status = 'on_shelf' WHERE id = ?", (row[0],))
    return row[0]
EOF
    cat >"$PROJ/tests/test_loans.py" <<'EOF'
"""借还的回归：借满上限被拒、还书后回到在架。"""
import unittest

from app import db, loans, members


class LoanTest(unittest.TestCase):
    def setUp(self):
        self.conn = db.connect()
        self.member = members.register(self.conn, "A001", "读者甲")
        for i in range(6):
            self.conn.execute("INSERT INTO books (isbn, title) VALUES (?, ?)", ("isbn-%d" % i, "示例书 %d" % i))

    def test_borrow_marks_book_on_loan(self):
        loans.borrow(self.conn, self.member, 1)
        self.assertEqual(self.conn.execute("SELECT status FROM books WHERE id = 1").fetchone()[0], "on_loan")

    def test_sixth_loan_is_refused(self):
        for book_id in range(1, 6):
            loans.borrow(self.conn, self.member, book_id)
        with self.assertRaises(loans.LoanError):
            loans.borrow(self.conn, self.member, 6)

    def test_give_back_returns_book_to_shelf(self):
        loan_id = loans.borrow(self.conn, self.member, 1)
        loans.give_back(self.conn, loan_id)
        self.assertEqual(self.conn.execute("SELECT status FROM books WHERE id = 1").fetchone()[0], "on_shelf")


if __name__ == "__main__":
    unittest.main()
EOF
    git -C "$PROJ" init -q
    git -C "$PROJ" config user.name demo
    git -C "$PROJ" config user.email demo@example.invalid
    git -C "$PROJ" add -A && git -C "$PROJ" commit -q -m "基线：第一期借书与还书，第二期预约排队待开发"
    if ! bash "$ROOT/setup.sh" "$PROJ" >"$PROJ/.setup.log" 2>&1; then
        echo "FAIL: setup.sh 装不进临时项目（见下）"; tail -8 "$PROJ/.setup.log"; exit 1
    fi
    rm -f "$PROJ/.setup.log"
    if [ -d "$PROJ/docs/readable-src" ]; then
        echo "FAIL: 装完框架项目里就有 docs/readable-src/——起头必须是会话自己做的，前提不成立"; exit 1
    fi

    BEFORE=$(git -C "$ROOT" status --short)
    echo "运行 claude -p（静默，最长 ${CASE_TIMEOUT:-2700}s，预算 \$${CASE_BUDGET:-15}）…"
    RC_CLAUDE=0
    ( cd "$PROJ" && timeout "${CASE_TIMEOUT:-2700}" claude -p "$PROMPT" \
        --dangerously-skip-permissions --strict-mcp-config --no-session-persistence \
        --max-budget-usd "${CASE_BUDGET:-15}" --verbose --output-format stream-json \
        >"$LOG" 2>"$LOG.err" ) || RC_CLAUDE=$?
    if [ ! -s "$LOG" ] || [ "$RC_CLAUDE" -eq 124 ]; then
        echo "FAIL: 会话超时（rc=$RC_CLAUDE）或日志为空，不往下断言。日志尾部："
        tail -c 1500 "$LOG" 2>/dev/null || true; tail -c 800 "$LOG.err" 2>/dev/null || true
        exit 1
    fi
fi

echo ""
echo "--- 断言 ---"
RC=0
ok()  { _pass "$1 | EXPECT: $2 | GOT: $3"; }
bad() { _fail "$1 | EXPECT: $2 | GOT: $3"; RC=1; }

# D1～D3：解析事件日志。每行一个 JSON 事件；主会话 parent_tool_use_id 为空，子 Agent 非空。
# 输出 KEY<TAB>ok|bad<TAB>GOT。
EVAL=$(node - "$LOG" <<'JS'
const fs = require('fs');
const calls = [];
let events = 0;
for (const line of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  if (ev.type !== 'assistant' || !ev.message || !Array.isArray(ev.message.content)) continue;
  events++;
  for (const b of ev.message.content) {
    if (b.type !== 'tool_use') continue;
    calls.push({ main: !ev.parent_tool_use_id, name: b.name, input: b.input || {} });
  }
}
const isDispatch = c => c.name === 'Agent' || c.name === 'Task';
const isImpl = c => isDispatch(c) && /(^|:)implementer$/.test(String(c.input.subagent_type || ''));
const bash = c => c.main && c.name === 'Bash' ? String(c.input.command || '') : '';
const firstImpl = calls.findIndex(c => c.main && isImpl(c));
const out = (k, ok, got) => console.log(`${k}\t${ok ? 'ok' : 'bad'}\t${got}`);
out('META', events > 0, `assistant 事件 ${events} 个，工具调用 ${calls.length} 次，派 implementer ${calls.filter(isImpl).length} 次`);
if (firstImpl < 0) {
  out('D1', false, '主会话没派过 implementer，无从判先后');
  out('D3', false, '主会话没派过 implementer，无从判先后');
} else {
  const init = calls.findIndex((c, i) => i < firstImpl && bash(c).includes('readable-docs.mjs init'));
  out('D1', init >= 0, init >= 0 ? `第 ${init + 1} 次调用起头，第 ${firstImpl + 1} 次调用首派 implementer` : `首派 implementer 前（第 ${firstImpl + 1} 次调用）没有含 readable-docs.mjs init 的 Bash`);
  const chk = calls.filter((c, i) => i > firstImpl && bash(c).includes('readable-docs.mjs check')).length;
  out('D3', chk > 0, `首派 implementer 之后主会话亲跑 check ${chk} 次`);
}
const impls = calls.filter(isImpl);
const carry = impls.filter(c => { const p = String(c.input.prompt || ''); return p.includes('readable-docs') && p.includes('check'); }).length;
out('D2', carry > 0, `${impls.length} 张 implementer 派单里 ${carry} 张同时含 readable-docs 与 check`);
JS
)
echo "$EVAL" | awk -F'\t' '$1=="META"{print "    "$3}'
ev_line() { echo "$EVAL" | awk -F'\t' -v k="$1" '$1==k{print $2"\t"$3}'; }
chk_ev() { # key title expect
    local r st got; r=$(ev_line "$1"); st=${r%%$'\t'*}; got=${r#*$'\t'}
    [ -n "$r" ] || { bad "$2" "$3" "解析脚本没给出结果"; return 0; }
    if [ "$st" = "ok" ]; then ok "$2" "$3" "$got"; else bad "$2" "$3" "$got"; fi
}
chk_ev D1 "D1 开工前起头" "首次派 implementer 之前，主会话有 Bash 含 readable-docs.mjs init"
chk_ev D2 "D2 派单带着" "至少一张 implementer 派单同时含 readable-docs 与 check"
chk_ev D3 "D3 验收亲跑" "首次派 implementer 之后，主会话自己有 Bash 含 readable-docs.mjs check"

# D4：核对干净
CHK_OUT=$(cd "$PROJ" && node .claude/scripts/readable-docs.mjs check 2>&1) && CHK_RC=0 || CHK_RC=$?
if [ "$CHK_RC" -eq 0 ] && printf '%s\n' "$CHK_OUT" | grep -q '不一致 0 条'; then
    ok "D4 核对干净" "check 退出码 0 且输出含「不一致 0 条」" "rc=0，$(printf '%s\n' "$CHK_OUT" | grep '不一致' | tail -1)"
else
    bad "D4 核对干净" "check 退出码 0 且输出含「不一致 0 条」" "rc=$CHK_RC，$(printf '%s\n' "$CHK_OUT" | tail -2 | tr '\n' ' ' | cut -c1-300)"
fi

# D5：新表有说明
NOTE="$PROJ/docs/readable-src/notes/table/reservations.md"
PEND_OUT=$(cd "$PROJ" && node .claude/scripts/readable-docs.mjs pending 2>&1) || true
if [ -f "$NOTE" ] && grep -q '## table:reservations' "$NOTE" && ! printf '%s\n' "$PEND_OUT" | grep -q 'table:reservations'; then
    ok "D5 新表有说明" "notes/table/reservations.md 存在且含 '## table:reservations'；pending 里没有 table:reservations" "文件在、标题在、pending 不再点名"
else
    F=no; [ -f "$NOTE" ] && F=yes
    bad "D5 新表有说明" "notes/table/reservations.md 存在且含 '## table:reservations'；pending 里没有 table:reservations" "文件存在=$F，含标题=$(grep -c '## table:reservations' "$NOTE" 2>/dev/null || true)，pending 点名=$(printf '%s\n' "$PEND_OUT" | grep -c 'table:reservations' || true) 行"
fi

# D6：存量缺口没变多（基线：存量 members/books/loans 三张表没写说明）
FIRST=$(printf '%s\n' "$PEND_OUT" | head -1)
N=$(printf '%s\n' "$FIRST" | grep -o '表 [0-9][0-9]* 张' | head -1 | grep -o '[0-9][0-9]*' || true)
if [ -z "$N" ]; then
    case "$FIRST" in *要补的*) bad "D6 存量缺口没变多" "pending 首行「表 N 张」N <= 3" "首行有「要补的」却读不出「表 N 张」：$FIRST" ;;
        *) ok "D6 存量缺口没变多" "pending 首行「表 N 张」N <= 3" "首行没有表缺口（N=0）：$FIRST" ;; esac
elif [ "$N" -le 3 ]; then ok "D6 存量缺口没变多" "pending 首行「表 N 张」N <= 3" "N=$N"
else bad "D6 存量缺口没变多" "pending 首行「表 N 张」N <= 3" "N=$N（$FIRST）"; fi

# D7：页面入库
HAS_PAGE=$(git -C "$PROJ" ls-files docs/readable | grep -cx 'docs/readable/db/t-reservations.html' || true)
DIRTY=$(git -C "$PROJ" status --short -- docs/readable docs/readable-src)
if [ "$HAS_PAGE" -ge 1 ] && [ -z "$DIRTY" ]; then
    ok "D7 页面入库" "ls-files 有 docs/readable/db/t-reservations.html，docs/readable 与 docs/readable-src 无未提交改动" "已入库、工作树干净"
else
    bad "D7 页面入库" "ls-files 有 docs/readable/db/t-reservations.html，docs/readable 与 docs/readable-src 无未提交改动" "页面入库=$HAS_PAGE，未提交：$(printf '%s' "$DIRTY" | head -3 | tr '\n' ';')"
fi

# D8：没写到仓库根
if [ "$REPLAY" -eq 1 ]; then
    echo "  [SKIPPED] D8 没写到仓库根 | 回放模式没有「跑前」快照，跳过（未执行 != 通过）"
else
    AFTER=$(git -C "$ROOT" status --short)
    if [ "$BEFORE" = "$AFTER" ]; then ok "D8 没写到仓库根" "跑前跑后仓库根 git status --short 相同" "相同"
    else bad "D8 没写到仓库根" "跑前跑后仓库根 git status --short 相同" "不同：$(diff <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER") | grep '^[<>]' | head -5 | tr '\n' ';')"; fi
fi

print_summary
if [ "$RC" -eq 0 ]; then echo "CASE: PASS"; else echo "CASE: FAIL"; fi
exit "$RC"
