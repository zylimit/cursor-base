#!/usr/bin/env bash
# install-githooks.sh — 显式开关 git hooks 强制层（core.hooksPath 指向 .claude/githooks）。
# **默认不开**：setup.sh / setup.ps1 一律不碰 core.hooksPath——git hooks 是可选层，
#   默认安装悄悄改用户的 hooksPath 会把他自己的 .git/hooks 整个顶掉，这种事不能替人做决定。
# 只写仓库本地配置（.git/config），不动全局。
# 用法： bash .claude/scripts/install-githooks.sh on|off|status   （不带参数 = status）
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REL=".claude/githooks"
HOOKS_DIR="$ROOT/$REL"

cd "$ROOT" || { echo "install-githooks: 进不去 $ROOT" >&2; exit 2; }
git rev-parse --show-toplevel >/dev/null 2>&1 || {
  echo "install-githooks: 这里不是 git 仓库（git rev-parse --show-toplevel 失败）" >&2
  exit 2
}

# 当前 core.hooksPath（未设置时 git config --get 退出 1，这里当空处理）
current() { git config --get core.hooksPath 2>/dev/null || true; }

case "${1:-status}" in
  on)
    [ -d "$HOOKS_DIR" ] || { echo "install-githooks: 找不到 $HOOKS_DIR" >&2; exit 2; }
    PREV="$(current)"
    if [ -n "$PREV" ] && [ "$PREV" != "$REL" ]; then
      # 别人已经占了这个位（husky、lefthook、自建目录）。覆盖等于把他的 hook 全停掉，
      # 属于「删/停用现有资产」那一档，得由人拍板，不替他做。
      echo "install-githooks: core.hooksPath 已被占用（当前 = ${PREV}）。" >&2
      echo "  覆盖会把那套 hook 整个停掉。先确认要不要，再手动跑：" >&2
      echo "    git config core.hooksPath $REL" >&2
      exit 2
    fi
    chmod 0755 "$HOOKS_DIR"/pre-commit "$HOOKS_DIR"/commit-msg "$HOOKS_DIR"/pre-push 2>/dev/null || true
    git config core.hooksPath "$REL" || { echo "install-githooks: git config 写入失败" >&2; exit 2; }
    echo "install-githooks: on（core.hooksPath = ${REL}，仅本仓库）"
    echo "  已挂上：pre-commit（密钥+语法）/ commit-msg（subject 门槛）/ pre-push（文档放行，代码跑 selftest+密钥）"
    echo "  关掉：  bash .claude/scripts/install-githooks.sh off"
    echo "          或直接 git config --unset core.hooksPath"
    echo "  单次绕过：git commit --no-verify / git push --no-verify —— HIGH 档行为，得向人交代"
    ;;
  off)
    PREV="$(current)"
    if [ -z "$PREV" ]; then
      echo "install-githooks: off（core.hooksPath 本来就没设）"
    elif [ "$PREV" != "$REL" ]; then
      # 不是我们设的，就不替人删——那是别人的家底。
      echo "install-githooks: 没动（core.hooksPath = ${PREV}，不是 cc-base 设的）" >&2
      echo "  真要清就自己跑：git config --unset core.hooksPath" >&2
      exit 2
    else
      git config --unset core.hooksPath || true
      echo "install-githooks: off（core.hooksPath 已清，git 回到 .git/hooks）"
    fi
    ;;
  status)
    PREV="$(current)"
    if [ "$PREV" = "$REL" ]; then
      echo "install-githooks: on（core.hooksPath = ${PREV}）"
      for h in pre-commit commit-msg pre-push; do
        if [ -x "$HOOKS_DIR/$h" ]; then
          echo "  ${h}：在，有执行位"
        elif [ -f "$HOOKS_DIR/$h" ]; then
          echo "  ${h}：在，但**没有执行位**——git 不会跑它。重跑 on 修执行位" >&2
        else
          echo "  ${h}：不在（$HOOKS_DIR/${h}）" >&2
        fi
      done
    elif [ -n "$PREV" ]; then
      echo "install-githooks: off（core.hooksPath = ${PREV}，被别的工具占着）"
    else
      echo "install-githooks: off（core.hooksPath 未设，git 用 .git/hooks）"
    fi
    ;;
  *)
    echo "用法: bash .claude/scripts/install-githooks.sh on|off|status" >&2
    exit 2
    ;;
esac
exit 0
