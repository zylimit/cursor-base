#!/usr/bin/env bash
# risk: low
# test-routing.sh — 配置/跨文件一致性静态检查（无依赖 claude CLI）。
# 验三件事：① agents/*.md 实际数量 == CLAUDE.md [Sub-Agent 调度规则] 表里声明的 agent；
#   ② CLAUDE.md 登记的每个 skill 都有 skills/<name>/SKILL.md 实体；
#   ③ 反向：每个 skills/<name>/ 都在 CLAUDE.md 有登记（防孤儿）。
# 命中不一致即列出并非零退出。纳入 cases/run-all.sh 在 selftest 之后跑。
set -eu

# tests/ 在 .claude/tests/ 下，CLAUDE.md 在 .claude/ 下
CLAUDE_DIR=$(cd "$(dirname "$0")/.." && pwd)

python3 - "$CLAUDE_DIR" <<'PY'
from pathlib import Path
import re
import sys

cl = Path(sys.argv[1])
claude_md = cl / "CLAUDE.md"
failures = []

def fail(message):
    failures.append(message)

text = claude_md.read_text(encoding="utf-8")

# ---- ① agents：磁盘实体 vs CLAUDE.md 调度表声明 ----
agent_dir = cl / "agents"
actual_agents = sorted(p.stem for p in agent_dir.glob("*.md")) if agent_dir.exists() else []

# 从 [Sub-Agent 调度规则] 表里抽声明的 agent：表行形如 | implementer | .claude/agents/implementer.md | ... |
declared_agents = sorted(set(re.findall(r"\.claude/agents/([a-z0-9-]+)\.md", text)))
if not declared_agents:
    fail("CLAUDE.md 未在调度表声明任何 agent（正则未命中 .claude/agents/<name>.md）")
if actual_agents != declared_agents:
    fail(f"agent 集合不一致：磁盘 {actual_agents} vs CLAUDE.md 声明 {declared_agents}")

# ---- ② CLAUDE.md 登记的每个 skill 都有 SKILL.md 实体 ----
# 从 [可用技能] / [Skill 调用规则] 抽登记的 skill：/<name> 命令名 与 skills/<name>/ 路径
declared_skills = set(re.findall(r"skills/([a-z0-9-]+)/", text))
declared_skills |= set(re.findall(r"/([a-z0-9-]+)\s+-\s", text))  # [可用技能] 列表行 "/name   - 说明"
# record/archive 已是真 skill 目录；recap 是自带命令名（文档里仍会提到）、clear 同理，不算登记 skill
indicator_only = {"recap", "clear", "ccb-clear"}
declared_skills -= indicator_only

skills_dir = cl / "skills"
actual_skills = {p.name for p in skills_dir.iterdir() if p.is_dir()} if skills_dir.exists() else set()

for skill in sorted(declared_skills):
    if skill not in actual_skills:
        continue  # 名字可能误命中正则（如 design 子串），下面以双向交集为准；缺实体在 ③ 的反向之外单独核
    path = skills_dir / skill / "SKILL.md"
    if not path.exists():
        fail(f"登记的 skill 缺 SKILL.md 实体：{skill}/SKILL.md")

# 登记但磁盘无目录：只对「确属 skill 命令」的登记报（[可用技能] 段落里的 /name）
available_block = re.search(r"\[可用技能\](.*?)(?:\n\[|\Z)", text, re.S)
registered_cmds = set()
if available_block:
    registered_cmds = set(re.findall(r"/([a-z0-9-]+)\s+-\s", available_block.group(1)))
registered_cmds -= indicator_only
for skill in sorted(registered_cmds):
    if skill not in actual_skills:
        fail(f"CLAUDE.md [可用技能] 登记了 /{skill} 但磁盘无 skills/{skill}/ 目录")

# ---- ③ 反向：每个 skills/<name>/ 都在 CLAUDE.md 有登记（防孤儿）----
for skill in sorted(actual_skills):
    if skill not in registered_cmds and skill not in declared_skills:
        fail(f"孤儿 skill：磁盘有 skills/{skill}/ 但 CLAUDE.md 未登记")
    path = skills_dir / skill / "SKILL.md"
    if not path.exists():
        fail(f"skill 目录缺 SKILL.md：{skill}/SKILL.md")

if failures:
    print("test-routing: failed", file=sys.stderr)
    for item in failures:
        print(f"- {item}", file=sys.stderr)
    raise SystemExit(1)

print(f"test-routing: passed（agents={len(actual_agents)} 一致，skills={len(actual_skills)} 双向登记一致）")
PY
