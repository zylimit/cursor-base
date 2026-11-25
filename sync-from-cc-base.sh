#!/usr/bin/env bash
# sync-from-cc-base.sh — 把 cc-base 仓的原件同步进本仓（Mac/Linux）。
# 用法：./sync-from-cc-base.sh [--allow-dirty] [cc-base 仓路径]
#   路径缺省取 $CC_BASE_DIR，再缺省 ../cc-base。
# 流程：校验 cc-base 仓 → 要求工作树干净 → 核对 .gitignore 白名单段（拷贝之前，失败时一个文件都不动）→ 以 HEAD 的文件清单为准、从 HEAD 取内容（可执行位随 tar 保留）→
#   排除本仓自有文件 → 删掉「上次清单里有、这次没有」的旧文件 → 记清单与版本 →
#   settings.json 转 string form → 重新生成 .cursor/agents/ 与 .cursor/rules/cc-base-claude.mdc → 确保 .cursor/skills 软链。
# 取内容走 HEAD 而不是工作树：同步的是 cc-base「提交过的样子」，工作树里没提交的半成品不该进来；
#   所以默认要求干净，--allow-dirty 放行时脏改动不会被同步，只是提示一声。
# 清单也取 HEAD 的树（git ls-tree），不取 index：--allow-dirty 下 index 里暂存的新文件 HEAD 里没有，取了 tar 会找不到。
# 上一次的清单存 .cursor/cc-base-files.txt；只删上次清单里有的，本仓自有文件和适配层永远不会被删。
# 幂等：连跑两次，第二次 git status --short 不变；版本文件只记 cc-base 短 hash 与提交日期，不记同步时间，两次逐字节相同。
set -u

die() {
  printf 'sync: %s\n' "$1" >&2
  exit 1
}

usage_die() {
  printf 'sync: %s\n' "$1" >&2
  printf '用法：sync-from-cc-base.sh [--allow-dirty] [cc-base 仓路径]\n' >&2
  exit 2
}

ALLOW_DIRTY=0
CC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -*) usage_die "未知选项：$1" ;;
    *)
      [ -z "$CC" ] || usage_die "只收一个 cc-base 路径，多给了：$1"
      CC=$1
      ;;
  esac
  shift
done

HERE=$(cd "$(dirname "$0")" && pwd) || die "取不到脚本所在目录"
[ -n "$CC" ] || CC=${CC_BASE_DIR:-$HERE/../cc-base}
[ -d "$CC" ] || die "cc-base 路径不存在或不是目录：$CC"
CC=$(cd "$CC" && pwd)
[ "$CC" != "$HERE" ] || die "cc-base 路径指向了本仓自己：$CC"
[ -f "$CC/.claude/CLAUDE.md" ] || die "$CC 下没有 .claude/CLAUDE.md，不像 cc-base 仓"
[ -e "$CC/.git" ] || die "$CC 不是 git 仓（没有 .git）；同步要从 HEAD 取内容，需要提交历史"
command -v git >/dev/null 2>&1 || die "缺少必需命令：git"
command -v tar >/dev/null 2>&1 || die "缺少必需命令：tar"
command -v node >/dev/null 2>&1 || die "缺少必需命令：node（hook-form.mjs、gen-agents.mjs 与 gen-rules.mjs 都要它）"

dirty=$(git -C "$CC" status --porcelain) || die "git -C $CC status 失败"
if [ -n "$dirty" ]; then
  if [ "$ALLOW_DIRTY" = "1" ]; then
    printf 'sync: 注意：cc-base 工作树不干净，--allow-dirty 放行；同步取的是 HEAD，未提交的改动不会进来：\n' >&2
    printf '%s\n' "$dirty" | head -10 >&2
  else
    printf 'sync: cc-base 工作树不干净，拒绝同步（同步的版本要能对上一个提交）：\n' >&2
    printf '%s\n' "$dirty" | head -10 >&2
    die "先在 cc-base 里提交或清理；明知有未提交改动仍要同步（取 HEAD）加 --allow-dirty"
  fi
fi

cd "$HERE" || die "cd $HERE 失败"

# 本仓自有文件：cc-base 清单里即使撞名也不覆盖。后四项现在不在 cc-base 清单里，写进来防以后撞名。
is_excluded() {
  case "$1" in
    README.md | progress.md | progress.archive.md | .gitignore) return 0 ;;
    AGENTS.md | setup-cursor.sh | sync-from-cc-base.sh | .cursor/*) return 0 ;;
  esac
  return 1
}

TMP=$(mktemp -d) || die "mktemp 失败"
trap 'rm -rf "$TMP"' EXIT
NEW_LIST="$TMP/new.txt"      # 本次要复制的文件，换行分隔（排序，供 comm）
NEW_NUL="$TMP/new.nul"       # 同一份，NUL 分隔，喂 tar
: >"$NEW_LIST"
: >"$NEW_NUL"

# 核对 .gitignore 白名单段：本仓从 `/*` 那行起到 `# === Cursor 适配层 ===` 之前，必须与 cc-base 的 .gitignore
# 逐字一致（两边文件头的说明注释各写各的，不比；段尾空行不比）。不一致只报不改——白名单放行谁是要人看的决定。
# 排在拷贝之前：核对失败退 1 时一个文件都没动，不留「原件拷进来了、settings.json 还是 exec form」的半成品。
whitelist_body() {   # $1=文件 $2=1 表示在 Cursor 标记处截断
  awk -v cut="$2" '
    /^# === Cursor 适配层 ===/ { if (cut == 1) exit }
    /^\/\*$/ { on = 1 }
    on { lines[++n] = $0 }
    END { while (n > 0 && lines[n] == "") n--; for (i = 1; i <= n; i++) print lines[i] }
  ' "$1"
}
whitelist_body "$HERE/.gitignore" 1 >"$TMP/wl.here"
git -C "$CC" show HEAD:.gitignore | whitelist_body /dev/stdin 0 >"$TMP/wl.cc"
[ -s "$TMP/wl.cc" ] || die "cc-base 的 .gitignore 里找不到 /* 起头的白名单段"
if ! diff -u "$TMP/wl.cc" "$TMP/wl.here" >"$TMP/wl.diff"; then
  printf 'sync: 本仓 .gitignore 的 cc-base 白名单段与 cc-base 不一致（--- 是 cc-base，+++ 是本仓）：\n' >&2
  cat "$TMP/wl.diff" >&2
  die "白名单没对上，本次一个文件都没动；人工改 .gitignore 后重跑（脚本不自动改）"
fi

git -C "$CC" ls-tree -r -z --name-only HEAD >"$TMP/all.nul" || die "git ls-tree HEAD 失败（cc-base 没有提交？）"
[ -s "$TMP/all.nul" ] || die "cc-base HEAD 是空树"
while IFS= read -r -d '' f; do
  is_excluded "$f" && continue
  case "$f" in *$'\n'*) die "cc-base 里有含换行的文件名，清单格式装不下：$f" ;; esac
  printf '%s\n' "$f" >>"$NEW_LIST"
  printf '%s\0' "$f" >>"$NEW_NUL"
done <"$TMP/all.nul"
LC_ALL=C sort -o "$NEW_LIST" "$NEW_LIST"
copied=$(wc -l <"$NEW_LIST" | tr -d ' ')

# 复制：整棵 HEAD 打成 tar 流，只抽清单里的成员；tar 保留可执行位
git -C "$CC" archive HEAD | tar -x -C "$HERE" --null -T "$NEW_NUL" || die "从 cc-base HEAD 抽取文件失败"

# 删除：上次清单里有、这次没有的
deleted=0
OLD_LIST="$HERE/.cursor/cc-base-files.txt"
if [ -f "$OLD_LIST" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    is_excluded "$f" && continue   # 清单被手改过也不许删到自有文件
    if ! grep -qxF -- "$f" "$NEW_LIST"; then
      if [ -e "$HERE/$f" ]; then
        rm -f -- "$HERE/$f" || die "删除 $f 失败"
        deleted=$((deleted + 1))
        rmdir -p -- "$(dirname -- "$HERE/$f")" 2>/dev/null || true   # 空目录顺手收掉，非空就留着
      fi
    fi
  done <"$OLD_LIST"
else
  printf 'sync: 没有上次的清单（.cursor/cc-base-files.txt），本次不删任何文件\n' >&2
fi

mkdir -p "$HERE/.cursor" || die "无法创建 .cursor/"
cp "$NEW_LIST" "$OLD_LIST" || die "无法写 .cursor/cc-base-files.txt"
ver=$(git -C "$CC" log -1 --format='%h %cd' --date=short HEAD) || die "读 cc-base HEAD 失败"
printf 'cc-base %s\n' "$ver" >"$HERE/.cursor/cc-base-version.txt" \
  || die "无法写 .cursor/cc-base-version.txt"

CLAUDE_PROJECT_DIR="$HERE" node "$HERE/.claude/scripts/hook-form.mjs" --to string --file "$HERE/.claude/settings.json" || die "hook-form.mjs --to string 失败"
form=$(CLAUDE_PROJECT_DIR="$HERE" node "$HERE/.claude/scripts/hook-form.mjs" --check --file "$HERE/.claude/settings.json")
[ "$form" = "string" ] || die "转完 settings.json 形态是 ${form:-未知}，要 string"
gen=$(CLAUDE_PROJECT_DIR="$HERE" node "$HERE/.cursor/scripts/gen-agents.mjs") || die "gen-agents.mjs 失败"
agents=$(find "$HERE/.cursor/agents" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
rules_gen=$(CLAUDE_PROJECT_DIR="$HERE" node "$HERE/.cursor/scripts/gen-rules.mjs") || die "gen-rules.mjs 失败"
[ -s "$HERE/.cursor/rules/cc-base-claude.mdc" ] || die ".cursor/rules/cc-base-claude.mdc 未生成或为空"
if [ ! -d "$HERE/.cursor/skills" ] || [ -L "$HERE/.cursor/skills" ]; then
  ln -sfn ../.claude/skills "$HERE/.cursor/skills" || die "无法创建 .cursor/skills 软链"
fi

printf 'sync: 复制 %s / 删除 %s / cc-base %s / 形态 %s / 生成 agents %s\n' "$copied" "$deleted" "$ver" "$form" "$agents"
printf 'sync: %s\n' "$gen"
printf 'sync: %s\n' "$rules_gen"
printf 'sync: 下一步跑 bash .claude/tests/cases/run-all.sh 与 bash .cursor/tests/test-adapter.sh，通过后再提交\n'
