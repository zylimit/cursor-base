#!/usr/bin/env bash
# plan-lint.sh — DEV-PLAN.md 静态质量门（把 dev-planner 的规则自动化）。
# 用法： bash .claude/scripts/plan-lint.sh [plan] [spec]   默认 DEV-PLAN.md 与同目录 Product-Spec.md
# 文件不存在则提示并正常退出（cc-base 本体没有 DEV-PLAN）。
set -eu

PLAN=""
SPEC=""
seen=0
for arg in "$@"; do
  case "$arg" in
    -*)
      echo "plan-lint: 未知参数 ${arg}（用法：plan-lint.sh [plan] [spec]）" >&2
      exit 2
      ;;
    *)
      seen=$((seen + 1))
      case "$seen" in
        1) PLAN="$arg" ;;
        2) SPEC="$arg" ;;
        *) echo "plan-lint: 多余参数 ${arg}（用法：plan-lint.sh [plan] [spec]）" >&2; exit 2 ;;
      esac
      ;;
  esac
done

PLAN="${PLAN:-DEV-PLAN.md}"
SPEC="${SPEC:-$(dirname "$PLAN")/Product-Spec.md}"

if [ ! -f "$PLAN" ]; then
  echo "plan-lint: 无 DEV-PLAN，跳过 ($PLAN)"
  exit 0
fi

if [ ! -f "$SPEC" ]; then
  echo "plan-lint: 无 Product-Spec，跳过覆盖检查 ($SPEC)"
  SPEC=""
fi

python3 - "$PLAN" "$SPEC" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
spec_path = Path(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else None
text = path.read_text(encoding="utf-8")
lines = text.splitlines()
failures = []

def fail(message):
    failures.append(message)

# 标记 ``` 围栏内的行号（成对围栏之间，含围栏行本身），占位符与 REQ 扫描跳过这些行
def fenced_lines(src_lines):
    marked = set()
    in_fence = False
    for i, line in enumerate(src_lines):
        if re.match(r"\s*```", line):
            marked.add(i)
            in_fence = not in_fence
            continue
        if in_fence:
            marked.add(i)
    return marked

fenced = fenced_lines(lines)

def lines_matching(pattern):
    return [i + 1 for i, line in enumerate(lines)
            if i not in fenced and re.search(pattern, line, re.I)]

# 1) 禁占位符（对齐 dev-planner SKILL.md 已写的规则）
placeholder_patterns = [
    r"\bTBD\b",
    r"\bTODO\b",
    "待补充",
    "待确定",
    "类似 Task",
    "类似 Phase",
    "按需调整",
    "做相应修改",
    "implement later",
]
for pattern in placeholder_patterns:
    hits = lines_matching(pattern)
    if hits:
        loc = ", ".join(f"L{n}" for n in hits)
        fail(f"占位符命中: {pattern}  ({loc})")

# 2) Phase 结构完整：每个 Phase 须有 交付内容/关键文件/Task 清单/验收标准
phase_matches = list(re.finditer(r"^## Phase\s+\d+[:：].*$", text, re.M))
if not phase_matches:
    fail("未找到任何 ## Phase 小节")

def line_no(pos):
    return text.count("\n", 0, pos) + 1

TASK_ITEM_RE = re.compile(r"^\s*-\s*\*\*Task\s+\d+\.\d+[:：]", re.M)

for index, match in enumerate(phase_matches):
    start = match.start()
    end = phase_matches[index + 1].start() if index + 1 < len(phase_matches) else len(text)
    section = text[start:end]
    title = match.group(0).strip()
    ln = line_no(start)
    for anchor in ["**交付内容**", "**验证的假设**", "**关键文件**", "**Task 清单**", "**验收标准**"]:
        if anchor not in section:
            fail(f"L{ln} {title} 缺字段 {anchor}")
    # 3) 任务粒度：每个 Phase ≥ 1 个 Task
    task_count = len(TASK_ITEM_RE.findall(section))
    if task_count == 0:
        fail(f"L{ln} {title} 没有可执行的 Task 条目（需 - **Task N.M：...**）")

# 4) 需求 ↔ 计划双向覆盖：id 口径同 harness/ext/spec.mjs（声明在行首方括号，引用是裸 token）
REQ_DECL = re.compile(r"^\s{0,1}(?:[-*+]|\d+[.)])\s*\[(REQ-[A-Za-z0-9]{1,16}-\d{2,4})\]\s*")
REQ_REF = re.compile(r"\bREQ-[A-Za-z0-9]{1,16}-\d{2,4}\b")

def name_few(id_to_line):
    shown = sorted(id_to_line.items(), key=lambda kv: kv[1])[:3]
    loc = "、".join(f"{rid}（L{ln}）" for rid, ln in shown)
    return loc + (f" 等 {len(id_to_line)} 个" if len(id_to_line) > 3 else "")

def scan_ids(src_lines, skip):
    declared = {}
    mentioned = {}
    for i, line in enumerate(src_lines):
        if i in skip:
            continue
        decl = REQ_DECL.match(line)
        if decl and decl.group(1) not in declared:
            declared[decl.group(1)] = i + 1
        for req_id in REQ_REF.findall(line):
            mentioned.setdefault(req_id, i + 1)
    return declared, mentioned

if spec_path is not None:
    spec_lines = spec_path.read_text(encoding="utf-8").splitlines()
    spec_declared, spec_mentioned = scan_ids(spec_lines, fenced_lines(spec_lines))
    if not spec_declared:
        # 写了编号却一条都没被认成声明，多半是缩进超了或没写成列表项；不点名的话跳过看着像查过了
        if spec_mentioned:
            print(f"plan-lint: 警告（不改 rc）：{spec_path.name} 里出现了 {name_few(spec_mentioned)}，"
                  "但没有一条被识别成声明——检查是不是缩进超了一个空格，或者没写成列表项开头"
                  "（声明须形如行首 - [REQ-CORE-001] ……）", file=sys.stderr)
        # Spec 没用编号（小项目常态），整段跳过，与 harness trace 的口径一致
        print(f"plan-lint: Spec 未用 REQ 编号，跳过覆盖检查 ({spec_path})——跳过 = 没查，不是查过了")
    else:
        plan_mentioned = scan_ids(lines, fenced)[1]
        # 覆盖只认 Task 条目行：计划别处提到编号多半是「已知风险：本期不做」，算成有人做就是假绿。
        # 悬空判定照旧看全文，正文引用一个不存在的编号仍要报。
        task_ids = set()
        for i, line in enumerate(lines):
            if i not in fenced and TASK_ITEM_RE.match(line):
                task_ids.update(REQ_REF.findall(line))

        # 4.5) 范围外声明：dev-planner 允许局部计划，顶格 "## 范围外（本次不计划）" 标题到
        #      下一个 "## " 之间的 "- REQ-XXX：原因" 行算数；REQ 号复用上面 REQ_REF 那条正则
        OOS_HEADING_RE = re.compile(r"^## 范围外（本次不计划）\s*$")
        OOS_ITEM_RE = re.compile(r"^\s*-\s*(" + REQ_REF.pattern + r")\s*[:：]\s*(.*)$")
        oos_items = []  # 全部匹配行，含重复声明，按出现顺序——「每条要有原因」按行查，不去重
        in_oos = False
        for i, line in enumerate(lines):
            if i in fenced:
                continue
            if OOS_HEADING_RE.match(line):
                in_oos = True
                continue
            if in_oos and re.match(r"^## ", line):
                in_oos = False
                continue
            if in_oos:
                m = OOS_ITEM_RE.match(line)
                if m:
                    oos_items.append((m.group(1), i + 1, m.group(2).strip()))

        # 声明不是豁免：每一条范围外声明都要有原因，空原因不许悄悄放行成「已声明」
        for req_id, ln, reason in oos_items:
            if not reason:
                fail(f"范围外声明缺原因: {req_id}（{path.name} L{ln}）")

        # 同一 REQ 声明多次：仍以首条为准（不改判定结果），但重复本身要点名，不许静默吞掉后面几条
        oos_lines_by_id = {}
        for req_id, ln, _reason in oos_items:
            oos_lines_by_id.setdefault(req_id, []).append(ln)
        for req_id, lns in oos_lines_by_id.items():
            if len(lns) > 1:
                loc = "、".join(f"L{n}" for n in lns)
                print(f"plan-lint: 警告（不改 rc）：{req_id} 在「范围外」节重复声明 {len(lns)} 次"
                      f"（{loc}），仍以首条 L{lns[0]} 为准", file=sys.stderr)

        oos_declared = {}
        for req_id, ln, reason in oos_items:
            if req_id not in oos_declared:
                oos_declared[req_id] = (ln, reason)

        for req_id, ln in spec_declared.items():
            if req_id not in task_ids and req_id not in oos_declared:
                fail(f"需求没人做: {req_id}（{spec_path.name} L{ln}）在 {path.name} 里没有任何 Task 引用")

        # 范围外声明本身要经得住查：Spec 里没这个编号多半是拼错；已经被 Task 引用又声明不计划是自相矛盾
        for req_id, (ln, reason) in oos_declared.items():
            if req_id not in spec_mentioned:
                fail(f"范围外声明的编号不存在: {req_id}（{path.name} L{ln}，{spec_path.name} 中没有这个编号"
                     "——检查是不是拼错了）")
            elif req_id in task_ids:
                fail(f"范围外声明与 Task 矛盾: {req_id} 既被 Task 引用又在「范围外」节声明为不计划"
                     f"（{path.name} L{ln}）")
            else:
                print(f"plan-lint: 范围外（已声明）：{req_id}——{reason}（{path.name} L{ln}）", file=sys.stderr)

        # 悬空看 Spec 全文提到的编号，不止声明行——正文提过就算它还在；已经在范围外声明里报过
        # 一次「编号不存在」的不再重复报，避免同一处拼错冒出两条不同措辞的失败
        for req_id in sorted(plan_mentioned.keys() - spec_mentioned.keys() - oos_declared.keys()):
            hits = [i + 1 for i, line in enumerate(lines)
                    if i not in fenced and req_id in line]
            loc = ", ".join(f"L{n}" for n in hits)
            fail(f"悬空引用: {req_id} 在 {spec_path.name} 中不存在  ({loc})")
        # 别处正确声明过的编号在正文被提及是正常的（澄清记录会写「REQ-X 已改」），只挑全 Spec 一处都
        # 没声明、计划里也没人做的——这种多半是缩进写坏了没被认出来，不点名就跟着覆盖检查一起静默漏掉
        stray = {rid: ln for rid, ln in spec_mentioned.items()
                 if rid not in spec_declared and rid not in plan_mentioned}
        if stray:
            print(f"plan-lint: 警告（不改 rc）：{spec_path.name} 里的 {name_few(stray)}"
                  "写了编号但没被识别成声明，计划里也没人做——检查是不是缩进超了一个空格，"
                  "或者没写成列表项开头（声明须形如行首 - [REQ-CORE-001] ……）", file=sys.stderr)

if failures:
    print("plan-lint: 失败", file=sys.stderr)
    for item in failures:
        print(f"- {item}", file=sys.stderr)
    raise SystemExit(1)

print(f"plan-lint: 通过 ({path})")
PY
