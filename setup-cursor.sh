#!/usr/bin/env bash
# setup-cursor.sh — 把 cc-base 框架 + Cursor 适配层装到 target 项目（Mac/Linux）。
# 用法：./setup-cursor.sh <目标目录> [setup.sh 的其它参数]
# 流程：先核对本仓适配层文件齐全（缺件时零写入早退），再跑本仓的 setup.sh <目标目录> --hook-form string <其它参数>
#   （cc-base 原件的安装器，hook 注册成 Cursor 认的 string form），退出码非 0 原样退出；再把 .cursor/agents/、
#   .cursor/rules/、.cursor/scripts/、.cursor/skills（指向 ../.claude/skills 的软链）、.cursor/cli.json、
#   .cursor/hooks.json、.cursor/agents-models.json（有才拷）和 AGENTS.md 铺进目标。
# --dry-run 原样透传给 setup.sh，本脚本自己也不写任何文件，只打印会做什么。
# 取舍：.cursor/agents/、.cursor/rules/ 与 .cursor/scripts/ 是生成物和适配脚本，随装随覆盖；.cursor/skills 若目标已是真实目录则保留不动；
#   cli.json、hooks.json、agents-models.json、AGENTS.md 是目标可能手改过的配置，已有且内容不同就不覆盖，新版本落 <文件>.framework-new 供手工合并（同 setup.sh 的惯例）。
#   .cursor/agents/ 另外会清掉目标里「带生成注释、本仓已无同名」的残留，手写的 agent 不动。
#   .cursor/tests/ 是本仓适配层的自测，不装进目标。
set -u

die() {
  printf 'setup-cursor: %s\n' "$1" >&2
  exit 1
}

usage_die() {
  printf 'setup-cursor: %s\n' "$1" >&2
  printf '用法：setup-cursor.sh <目标目录> [setup.sh 的其它参数，如 --dry-run --with-tests]\n' >&2
  exit 2
}

[ $# -ge 1 ] || usage_die "缺目标目录"
case "$1" in
  -*) usage_die "第一个参数必须是目标目录，收到选项：$1" ;;
esac
target=$1
shift

HERE=$(cd "$(dirname "$0")" && pwd) || die "取不到脚本所在目录"
[ -x "$HERE/setup.sh" ] || die "$HERE/setup.sh 不存在或不可执行（先跑 sync-from-cc-base.sh 把 cc-base 原件同步进来）"

for need in .cursor/agents .cursor/rules .cursor/scripts .cursor/.gitignore .cursor/cli.json .cursor/hooks.json AGENTS.md; do
  [ -e "$HERE/$need" ] || die "本仓缺 $need，适配层不完整"
done

DRY_RUN=0
for a in "$@"; do
  [ "$a" = "--dry-run" ] && DRY_RUN=1
done

"$HERE/setup.sh" "$target" --hook-form string "$@"
rc=$?
[ "$rc" -eq 0 ] || exit "$rc"

# put_config <相对路径>：目标没有就拷；有且相同跳过；有且不同落 .framework-new，不覆盖
put_config() {
  local rel=$1 src="$HERE/$1" dest="$target/$1"
  if [ ! -e "$dest" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      printf 'setup-cursor: dry-run create %s\n' "$rel"
    else
      mkdir -p "$(dirname "$dest")" || die "无法创建 $(dirname "$dest")"
      cp -p "$src" "$dest" || die "无法写入 $dest"
      printf 'setup-cursor: create %s\n' "$rel"
    fi
  elif cmp -s "$src" "$dest"; then
    printf 'setup-cursor: skip %s（内容相同）\n' "$rel"
  else
    if [ "$DRY_RUN" = "1" ]; then
      printf 'setup-cursor: dry-run conflict %s（真装会落 %s.framework-new）\n' "$rel" "$rel"
    else
      cp -p "$src" "$dest.framework-new" || die "无法写入 $dest.framework-new"
      printf 'setup-cursor: 目标已有 %s 且内容不同，未覆盖；新版本在 %s.framework-new，手工合并\n' "$rel" "$rel" >&2
    fi
  fi
}

# put_tree <相对目录>：整目录覆盖式铺进目标
put_tree() {
  local rel=$1
  if [ "$DRY_RUN" = "1" ]; then
    printf 'setup-cursor: dry-run update %s/\n' "$rel"
  else
    mkdir -p "$target/$rel" || die "无法创建 $target/$rel"
    cp -pR "$HERE/$rel/." "$target/$rel/" || die "无法铺 $target/$rel"
    printf 'setup-cursor: update %s/\n' "$rel"
  fi
}

# prune_agents：目标 .cursor/agents/ 里带生成注释、但本仓已没有同名生成物的删掉（源头删了的角色）；手写的、注释里源名不是自己的不动
prune_agents() {
  local f base src
  for f in "$target"/.cursor/agents/*.md; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    [ -e "$HERE/.cursor/agents/$base" ] && continue
    # 注释里写的源名等于本文件名才算生成物；复制生成物改名定制的文件带着别人的注释，不动
    src=$(sed -n 's/.*由 \.cursor\/scripts\/gen-agents\.mjs 从 \.claude\/agents\/\(.*\)\.md 生成.*/\1/p' "$f" | head -n 1)
    [ "$src" = "${base%.md}" ] || continue
    if [ "$DRY_RUN" = "1" ]; then
      printf 'setup-cursor: dry-run remove .cursor/agents/%s（源头已删的生成物）\n' "$base"
    else
      rm -f -- "$f" || die "无法删除 $f"
      printf 'setup-cursor: remove .cursor/agents/%s（源头已删的生成物）\n' "$base"
    fi
  done
}

# link_skills：铺 .cursor/skills -> ../.claude/skills 相对软链；目标已有真实目录则保留不动
link_skills() {
  local dest="$target/.cursor/skills"
  if [ -d "$dest" ] && [ ! -L "$dest" ]; then
    printf 'setup-cursor: skip .cursor/skills（目标已有真实目录，保留不动）\n'
  elif [ "$DRY_RUN" = "1" ]; then
    printf 'setup-cursor: dry-run link .cursor/skills -> ../.claude/skills\n'
  else
    mkdir -p "$target/.cursor" || die "无法创建 $target/.cursor"
    ln -sfn ../.claude/skills "$dest" || die "无法创建软链 $dest"
    printf 'setup-cursor: link .cursor/skills -> ../.claude/skills\n'
  fi
}

put_tree .cursor/agents
prune_agents
put_tree .cursor/rules
put_tree .cursor/scripts
link_skills
put_config .cursor/.gitignore
put_config .cursor/cli.json
put_config .cursor/hooks.json
[ -f "$HERE/.cursor/agents-models.json" ] && put_config .cursor/agents-models.json
put_config AGENTS.md

if [ "$DRY_RUN" = "1" ]; then
  printf 'setup-cursor: dry-run 结束，%s 一个字节都没动\n' "$target"
else
  printf 'setup-cursor: 装完在目标里敲 cursor-agent，开场应看到 SiteMaster 横幅\n'
fi
