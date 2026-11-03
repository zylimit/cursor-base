#!/usr/bin/env bash
# red-blue-review.sh [BASE] [HEAD] — 凑「证据包」喂给红队 agent，自己不做审查（审查是 LLM 的活）。
# BASE 默认取最近 tag（取不到回退 origin/main）；HEAD 默认 HEAD。
# 审未提交工作树： bash red-blue-review.sh --working
# --working 可出现在任意位置（--working base-tag 与 base-tag --working 等价）。
# 输出（stdout，markdown 块，可直接贴进红队提示词）：审查范围 / 改动清单 / 删除审计 / 新文件 / 完整 diff。
# diff 过长则写临时文件，stdout 给出路径。git 调用全程安全兜底，无 tag/无 upstream 不泄漏 fatal。
# 失败响亮：BASE / HEAD ref 无效则非零退出 + stderr 明确报错，绝不静默产空证据包。
set -eu

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "red-blue-review: 不在 git 仓库内" >&2; exit 1; }
cd "$ROOT"

# 清理陈旧 diff 残留（只删 2 小时前的，别误删并发运行的当前文件，也别删本次刚产的）
find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'red-blue-diff.*' -type f -mmin +120 -delete 2>/dev/null || true

# 参数解析：--working 出现在任意位置都识别，剔除后剩下的按序作 BASE / HEAD
WORKING=0
POS=()
for arg in "$@"; do
  if [ "$arg" = "--working" ]; then
    WORKING=1
  else
    POS+=("$arg")
  fi
done

# BASE：显式给则用，否则默认最近 tag，取不到回退 origin/main，再取不到回退首个 commit
BASE="${POS[0]:-}"
if [ -z "$BASE" ]; then
  BASE=$(git describe --tags --abbrev=0 2>/dev/null) || BASE=""
  [ -z "$BASE" ] && { git rev-parse --verify --quiet origin/main >/dev/null 2>&1 && BASE="origin/main"; }
  [ -z "$BASE" ] && BASE=$(git rev-list --max-parents=0 HEAD 2>/dev/null | head -1)
fi
HEAD="${POS[1]:-HEAD}"

# ref 校验：最终用到的 BASE（及非工作树模式的 HEAD）必须是有效 ref，无效即响亮报错退出，
# 防手滑参数序（如把 --working 当 HEAD ref）静默产空证据包。无 tag/无 upstream 的兜底回退已在上面处理。
if [ -z "$BASE" ] || ! git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null 2>&1; then
  echo "red-blue-review: 无效的 BASE ref '${BASE}'" >&2
  exit 1
fi
if [ "$WORKING" -eq 0 ] && ! git rev-parse --verify --quiet "$HEAD^{commit}" >/dev/null 2>&1; then
  echo "red-blue-review: 无效的 HEAD ref '${HEAD}'" >&2
  exit 1
fi

# diff 落点：工作树模式比对 BASE..工作树，否则 BASE..HEAD
if [ "$WORKING" -eq 1 ]; then
  RANGE_LABEL="$BASE..（未提交工作树）"
  DIFF_ARGS=("$BASE")
else
  RANGE_LABEL="$BASE..$HEAD"
  DIFF_ARGS=("$BASE..$HEAD")
fi

echo "## 红蓝审查证据包"
echo
echo "**审查范围**：$RANGE_LABEL"
BASE_SHA=$(git rev-parse --short "$BASE" 2>/dev/null || echo "?")
echo "- BASE：${BASE}（${BASE_SHA}）"
if [ "$WORKING" -eq 1 ]; then
  echo "- HEAD：未提交工作树（含已暂存 + 未暂存）"
else
  HEAD_SHA=$(git rev-parse --short "$HEAD" 2>/dev/null || echo "?")
  echo "- HEAD：${HEAD}（${HEAD_SHA}）"
fi
echo

# ---- commit 清单（工作树模式无新 commit，跳过）----
if [ "$WORKING" -eq 0 ]; then
  echo "### Commit 清单"
  if git log --oneline "$BASE..$HEAD" 2>/dev/null | grep -q .; then
    git log --oneline "$BASE..$HEAD" 2>/dev/null | sed 's/^/- /'
  else
    echo "（无新 commit）"
  fi
  echo
fi

# ---- 改动清单 ----
echo "### 改动清单（git diff --stat）"
echo '```'
git diff --stat "${DIFF_ARGS[@]}" 2>/dev/null || echo "（无改动）"
echo '```'
echo

# ---- 删除审计：列出 diff 里有删除行的文件（家底审查重点看有没有误删既有规则）----
echo "### 删除审计（有删除行的文件——重点核有无误删既有规则）"
DEL=$(git diff "${DIFF_ARGS[@]}" 2>/dev/null \
  | awk '/^diff --git/{f=$0; sub(/^diff --git a\//,"",f); sub(/ b\/.*$/,"",f)}
         /^-/ && !/^---/ {if(f){print f; f=""}}' \
  | sort -u) || DEL=""
if [ -n "$DEL" ]; then
  printf '%s\n' "$DEL" | sed 's/^/- /'
else
  echo "（无删除行）"
fi
echo

# ---- 未跟踪新文件 ----
echo "### 未跟踪新文件"
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null) || UNTRACKED=""
if [ -n "$UNTRACKED" ]; then
  printf '%s\n' "$UNTRACKED" | sed 's/^/- /'
else
  echo "（无）"
fi
echo

# ---- 完整 diff：过长写临时文件，stdout 给路径 ----
DIFF_TMP=$(mktemp -t red-blue-diff.XXXXXX)
git diff "${DIFF_ARGS[@]}" >"$DIFF_TMP" 2>/dev/null || true
LINES=$(wc -l <"$DIFF_TMP" | tr -d ' ')
echo "### 完整 diff（$LINES 行）"
if [ "$LINES" -gt 800 ]; then
  echo "diff 过长（$LINES 行），已写入临时文件，红队读这个文件："
  echo "  $DIFF_TMP"
  echo "（红队读完可删此文件；未删的陈旧残留下次运行会自动清理）"
else
  echo '```diff'
  cat "$DIFF_TMP"
  echo '```'
  rm -f "$DIFF_TMP"
fi
