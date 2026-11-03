#!/usr/bin/env bash
# fix-platform.sh — 把老版本装出来的 .sh/.ps1 hook 形态归一到单运行时（node 跑 .mjs）。
# 老安装升级上来后 hooks/ 里还留着不再分发的 .sh/.ps1，settings.json 里也还挂着指向它们的 command——
# 文件早没了还挂着，就是每次事件报一次 hook error。升级 / 跨平台搬迁后跑一次即可，幂等。
# 干三件事：① 删 hooks/ 下历史遗留的 *.sh / *.ps1（含 lib-*）② settings.json 里指向 .sh/.ps1 的 hook
#   command 改写成 .mjs 条目、statusLine 归一到 statusline.mjs ③ scripts/*.sh 补执行位。
# 改写成哪种形态沿用文件里已有的 .mjs 条目：有 string form（`node .claude/hooks/<name>.mjs`，给 Cursor 用的）
#   就产 string form，否则 exec form。已是 .mjs 的条目不管哪种形态一律不改写——形态互转归 hook-form.mjs。
# 不依赖 cc-base 仓库在场、不依赖 jq——用 python3 解析/写回 JSON（python3 是 cc-base 已有依赖，
# session-rules-banner 已用 python3 -c 解析 JSON）。python3 不可用时降级报错+指引，不自作主张换实现。
set -u

die() {
  printf 'fix-platform: %s\n' "$1" >&2
  exit 1
}

# 定位项目根：优先 CLAUDE_PROJECT_DIR，其次脚本所在目录往上推断（脚本在 <root>/.claude/scripts/ 下）。
script_dir=$(cd "$(dirname "$0")" && pwd) || die "无法定位脚本目录"
project_root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$project_root" ]; then
  case "$script_dir" in
    */.claude/scripts|*/.claude/scripts/|*\\.claude\\scripts|*\\.claude\\scripts\\)
      project_root=$(cd "$script_dir/../.." && pwd) || die "无法推断项目根"
      ;;
    *)
      project_root="$script_dir"
      ;;
  esac
fi

settings="$project_root/.claude/settings.json"
[ -f "$settings" ] || die "找不到 settings.json：${settings}（请在项目根运行，或设 CLAUDE_PROJECT_DIR）"

hooks_dir="$project_root/.claude/hooks"

if ! command -v python3 >/dev/null 2>&1; then
  die "本机无 python3，无法解析 JSON。python3 是 fix-platform.sh 的必需依赖（不用 jq）。请安装 python3 后重跑；或改在 Windows 跑 fix-platform.ps1。"
fi

# python3 脚本：把 settings.json 里的历史 hook command 归一为 .mjs 条目。
# 逻辑：遍历 hooks 各 event 各 group.hooks，① 认出指向 .claude/hooks/<name>.sh|.ps1 的条目 ② 同 group 已有
#       该 hook 的 .mjs 条目就直接删掉旧条目，否则原地改写成全文件已有的那种形态（type/timeout/asyncRewake 原样留）
#       ③ 不匹配框架 hook 路径的用户自定义 command 一律不动。幂等。
python3 - "$settings" <<'PYEOF'
import json, re, sys

settings_path = sys.argv[1]

with open(settings_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# 历史形态判定：command 或 args 任一项指向 .claude/hooks/<name>.sh|.ps1
# （与 setup.sh jq is_legacy_hook 同口径，只认框架路径，不误伤用户自定义 powershell / bash 命令）。
LEGACY_HOOK_RE = re.compile(r'\.claude[/\\]hooks[/\\]([A-Za-z0-9_-]+)\.(?:sh|ps1)')
MJS_HOOK_RE = re.compile(r'\.claude[/\\]hooks[/\\]([A-Za-z0-9_-]+)\.mjs')

# exec form 模板（与仓库 settings.json 逐字一致）：占位符只认花括号，路径只用正斜杠。
ARG_FORM = '${CLAUDE_PROJECT_DIR}/.claude/hooks/'
# string form 模板（与 hook-form.mjs 同口径）：没有 args 键，路径相对项目根、正斜杠、不带占位符。
STRING_FORM = 'node .claude/hooks/'
STRING_FORM_RE = re.compile(r'^node \.claude/hooks/[A-Za-z0-9_-]+\.mjs$')


def hook_name(h, pattern):
    if not isinstance(h, dict):
        return None
    parts = [h.get('command', '') or '']
    args = h.get('args')
    if isinstance(args, list):
        parts.extend(str(a) for a in args)
    for p in parts:
        m = pattern.search(p)
        if m:
            return m.group(1)
    return None


def is_string_form(h):
    return isinstance(h, dict) and 'args' not in h and bool(STRING_FORM_RE.match(str(h.get('command', '') or '')))


converted = 0
dropped = 0

hooks = data.get('hooks')
# 全文件有一条 string form 的 .mjs 条目，改写出来的就跟它走，否则 exec form
use_string = False
if isinstance(hooks, dict):
    for groups in hooks.values():
        for group in (groups if isinstance(groups, list) else []):
            if isinstance(group, dict) and isinstance(group.get('hooks'), list):
                if any(is_string_form(h) for h in group['hooks']):
                    use_string = True
if isinstance(hooks, dict):
    for groups in hooks.values():
        if not isinstance(groups, list):
            continue
        for group in groups:
            if not isinstance(group, dict):
                continue
            hook_list = group.get('hooks')
            if not isinstance(hook_list, list):
                continue
            # 先收集本 group 已经是 .mjs 的 hook 名（两种形态都算，避免改写出重复条目）
            existing = set()
            for h in hook_list:
                name = hook_name(h, MJS_HOOK_RE)
                if name:
                    existing.add(name)
            new_list = []
            for h in hook_list:
                name = hook_name(h, LEGACY_HOOK_RE)
                if not name:
                    new_list.append(h)
                    continue
                if name in existing:
                    dropped += 1
                    continue
                rest = {k: v for k, v in h.items() if k not in ('type', 'command', 'args')}
                if use_string:
                    new_h = {
                        'type': h.get('type', 'command'),
                        'command': STRING_FORM + name + '.mjs',
                    }
                else:
                    new_h = {
                        'type': h.get('type', 'command'),
                        'command': 'node',
                        'args': [ARG_FORM + name + '.mjs'],
                    }
                new_h.update(rest)
                new_list.append(new_h)
                converted += 1
                existing.add(name)
            group['hooks'] = new_list

# statusLine：框架状态行归一到 statusline.mjs（statusLine 没有 exec form，只能 shell 串；正斜杠 + 双引号，
# 让 Git Bash 与 PowerShell 两侧都能展开。只认框架 statusline 路径，不动用户自定义状态行）。
STATUSLINE_RE = re.compile(r'\.claude[/\\]scripts[/\\]statusline\.(?:sh|ps1)', re.IGNORECASE)
STATUSLINE_FORM = 'node "$CLAUDE_PROJECT_DIR/.claude/scripts/statusline.mjs"'
statusline_fixed = 0
sl = data.get('statusLine')
if isinstance(sl, dict):
    cmd = sl.get('command', '') or ''
    if STATUSLINE_RE.search(cmd):
        sl['command'] = STATUSLINE_FORM
        statusline_fixed = 1

# 写回（indent=2 保结构；ensure_ascii=False 保中文若存在）
with open(settings_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')

print('fix-platform: converted to %s form=%d, dropped duplicate legacy entries=%d, statusline fixed=%d' % ('string' if use_string else 'exec', converted, dropped, statusline_fixed))
PYEOF
py_rc=$?
[ $py_rc -eq 0 ] || die "python3 归一失败（exit ${py_rc}）"

# 删 hooks/ 下历史遗留的 *.sh / *.ps1（含 lib-*.sh / lib-*.ps1）——新版一个都不分发，留着只会让
# doctor.sh / gate-audit.sh 照旧数它们，还容易让人以为 hook 有两套。
removed=0
if [ -d "$hooks_dir" ]; then
  while IFS= read -r -d '' f; do
    if rm -f "$f"; then removed=$((removed + 1)); fi
  done < <(find "$hooks_dir" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.ps1' \) -print0 2>/dev/null)
fi
printf 'fix-platform: removed legacy hooks/*.sh|*.ps1 files=%d\n' "$removed"

# chmod 0755 .claude/scripts/*.sh（.sh 在 Linux/Mac 必须有执行位才跑得起来；hook 已经不是 .sh，不再需要）
chmod_count=0
if [ -d "$project_root/.claude/scripts" ]; then
  while IFS= read -r -d '' sh; do
    if chmod 0755 "$sh"; then chmod_count=$((chmod_count + 1)); fi
  done < <(find "$project_root/.claude/scripts" -maxdepth 1 -type f -name '*.sh' -print0 2>/dev/null)
fi
printf 'fix-platform: chmod 0755 scripts/*.sh files=%d\n' "$chmod_count"
printf '完成。settings.json 已归一为 .mjs 条目（node 跑 .mjs，形态沿用文件里已有的）。路径：%s\n' "$settings"
