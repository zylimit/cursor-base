#!/usr/bin/env bash
# collect-feedback.sh — 把下游项目积累的 feedback 经验拉回 cc-base 本仓 .claude/feedback/（回流链入口）。
# 用法：collect-feedback.sh [--dry-run] <下游项目路径>…
# 下游的 skills / CLAUDE.md 是清单管的框架文件，经验往下游毕业，下次 setup 就报 conflict；
# 框架这边得先把经验收回来、在本仓统一评审毕业。本脚本只做「收」，不改任何下游文件。
# 每份 `<项目>/.claude/feedback/*.md`（不含 FEEDBACK-INDEX.md 与 templates/）按四态处理：
#   new      本仓没有同名文件 → 复制
#   same     同名且内容相同（比对时不计 origin / graduated / skipped 三行：origin 是本脚本自己写的，
#            graduated / skipped 是本仓的毕业裁定、下游不知道）→ 跳过
#   updated  同名内容不同，且本仓那份 origin 已含该项目 → 说明本来就是从这个项目收的，覆盖更新
#   conflict 同名内容不同，本仓那份不是这个项目来的 → 落 <名>.from-<项目目录名>.md，不覆盖
# 拉进来或更新的文件，frontmatter 写 origin: <项目目录名>（已有则合并成逗号列表、去重）；
# 其它字段取下游原样；唯独 updated 覆盖时 graduated / skipped 两行保留本仓值——毕业与否是本仓的裁定，下游不知道。
# same 时也把项目名并进本仓 origin（origin 真变了才写文件，统计仍计 same）。
# 新文件（含 conflict 落的）按现有行格式追加进本仓 FEEDBACK-INDEX.md，已有同名行不重复。
# 换行：每行先剥行尾 \r 再判 `---`，下游 Windows 侧产出的 CRLF 文件也认得出 frontmatter；
#   收进本仓（new / updated / conflict 写回）时统一成 LF——这是有意的，本仓文件一律 LF。
# 行内注释：frontmatter 值里 ` #` 起的部分按 YAML 当注释剥掉（模板的 `origin:   # 可选——…` 读出来是空），
#   引号开头的值原样不剥。
# --dry-run：一个字节不写。做法是把本仓 feedback 目录拷进临时目录、真逻辑照跑一遍再丢掉，
#   所以多个下游里重名文件的计划和真跑时一致，不会因为「还没写」而把第二个也报成 new。
# 退出码：0 成功；1 路径或环境不对（路径不存在 / 不是目录 / 没有 .claude/feedback/）；2 选项用错。
set -u

die() {
  printf 'collect-feedback: %s\n' "$1" >&2
  exit 1
}

# 拼错的选项不能被当成路径收下（setup.sh 栽过：--dryrun 被当 target，演练变成真写）。
usage_die() {
  printf 'collect-feedback: %s\n' "$1" >&2
  printf '用法：collect-feedback.sh [--dry-run] <下游项目路径>…\n' >&2
  printf '合法选项：--dry-run\n' >&2
  exit 2
}

DRY=0
PROJECTS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -*) usage_die "未知选项：$arg" ;;
    *) PROJECTS+=("$arg") ;;
  esac
done
[ "${#PROJECTS[@]}" -gt 0 ] || usage_die "至少给一个下游项目路径"

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REAL_FB="$ROOT/.claude/feedback"
[ -d "$REAL_FB" ] || die "本仓没有 .claude/feedback/：$REAL_FB"

# 所有路径先验完再动手：中途才发现第三个路径写错，前两个已经拉进来就是半截状态。
SRCS=()
for p in "${PROJECTS[@]}"; do
  [ -e "$p" ] || die "路径不存在：$p"
  [ -d "$p" ] || die "不是目录：$p"
  [ -d "$p/.claude/feedback" ] || die "没有 .claude/feedback/：$p"
  SRCS+=("$(cd "$p" && pwd)")
done

FB=$REAL_FB
if [ "$DRY" = "1" ]; then
  SCRATCH=$(mktemp -d) || die "无法创建临时目录"
  trap 'rm -rf "$SCRATCH"' EXIT
  cp -R "$REAL_FB/." "$SCRATCH/" || die "无法拷贝 feedback 目录到临时目录"
  FB=$SCRATCH
fi
INDEX="$FB/FEEDBACK-INDEX.md"

# fm_get <文件> <键> [raw]：frontmatter 取字段值（只看首尾两条 --- 之间）；行内注释剥掉，空值带注释得空串。
# 第三参给 raw 就连注释原样取——updated 保留本仓 graduated / skipped 用，那行的注释记着毕业去向，不能丢。
fm_get() {
  awk -v key="$2" -v raw="${3:-}" '
    { sub(/\r$/, "") }
    NR == 1 { if ($0 != "---") exit; infm = 1; next }
    infm && $0 == "---" { exit }
    infm && index($0, key ":") == 1 {
      v = substr($0, length(key) + 2); sub(/^[ \t]+/, "", v)
      if (raw == "" && v !~ /^["\047]/) { if (v ~ /^#/) v = ""; else sub(/[ \t]+#.*$/, "", v) }
      sub(/[ \t]+$/, "", v); print v; exit
    }' "$1"
}

# 去掉 frontmatter 里的 origin / graduated / skipped 行后输出，比对内容时用。
# 后两行是本仓裁定的毕业状态：本仓毕业了、下游还是 false，内容其实没变，不该每次报 updated 再覆盖一遍。
strip_origin() {
  awk '
    { sub(/\r$/, "") }
    NR == 1 { infm = ($0 == "---") }
    NR > 1 && infm && $0 == "---" { infm = 0; print; next }
    infm && (index($0, "origin:") == 1 || index($0, "graduated:") == 1 || index($0, "skipped:") == 1) { next }
    { print }' "$1"
}

same_content() {
  [ "$(strip_origin "$1" | cksum)" = "$(strip_origin "$2" | cksum)" ]
}

# 正文第一个 `# ` 标题（跳过 frontmatter）
fm_title() {
  awk '
    { sub(/\r$/, "") }
    NR == 1 && $0 == "---" { infm = 1; next }
    infm && $0 == "---" { infm = 0; next }
    infm { next }
    /^# / { sub(/^# +/, ""); sub(/[ \t\r]+$/, ""); print; exit }' "$1"
}

# set_fm <文件> <键> <值>：有该键的行就替换，没有就插在 frontmatter 结束线前；无 frontmatter 则补一段。
# 写回统一 LF：awk 逐行剥 \r，CRLF 的下游文件收进来就成了 LF（有意的，见文件头）。
set_fm() {
  local f=$1 key=$2 val=$3 tmp
  tmp=$(mktemp "$f.XXXXXX") || die "无法创建临时文件：$f"
  if [ "$(head -n 1 "$f" | tr -d '\r')" != "---" ]; then
    { printf -- '---\n%s: %s\n---\n' "$key" "$val"; tr -d '\r' <"$f"; } >"$tmp"
  else
    awk -v key="$key" -v val="$val" '
      { sub(/\r$/, "") }
      NR == 1 { infm = 1; print; next }
      infm && $0 == "---" { if (!done) print key ": " val; infm = 0; print; next }
      infm && index($0, key ":") == 1 { print key ": " val; done = 1; next }
      { print }' "$f" >"$tmp"
  fi
  mv "$tmp" "$f" || die "无法写回：$f"
}

set_origin() { set_fm "$1" origin "$2"; }

# merge_origin <原列表> <项目名> → 追加、去重、保序
merge_origin() {
  printf '%s,%s\n' "$1" "$2" | awk -F',' '{
    out = ""
    for (i = 1; i <= NF; i++) {
      v = $i; gsub(/^[ \t]+|[ \t\r]+$/, "", v)
      if (v == "" || (v in seen)) continue
      seen[v] = 1; out = out (out == "" ? "" : ",") v
    }
    print out }'
}

N_NEW=0 N_UPD=0 N_SAME=0 N_CONF=0

index_add() {
  local file=$1 title desc
  if [ ! -f "$INDEX" ]; then
    printf 'collect-feedback: 本仓没有 FEEDBACK-INDEX.md，%s 未入索引\n' "$file" >&2
    return 0
  fi
  grep -qF "]($file)" "$INDEX" && return 0
  title=$(fm_title "$FB/$file"); [ -n "$title" ] || title=${file%.md}
  desc=$(fm_get "$FB/$file" description)
  # 索引末行没有换行时先补，免得新行接到上一行尾巴上
  [ -n "$(tail -c1 "$INDEX")" ] && printf '\n' >>"$INDEX"
  printf -- '- [%s](%s) — %s\n' "$title" "$file" "$desc" >>"$INDEX"
}

# write_from <源> <目标文件名> <项目名> <原 origin 列表>
write_from() {
  cp "$1" "$FB/$2" || die "无法复制 $1 → $FB/$2"
  set_origin "$FB/$2" "$(merge_origin "$4" "$3")"
}

collect_one() {
  local src=$1 proj f name dest cname old merged grad skip
  proj=$(basename "$src")
  for f in "$src"/.claude/feedback/*.md; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    [ "$name" = "FEEDBACK-INDEX.md" ] && continue
    dest="$FB/$name"
    if [ ! -e "$dest" ]; then
      write_from "$f" "$name" "$proj" "$(fm_get "$f" origin)"
      index_add "$name"
      N_NEW=$((N_NEW + 1)); printf '  new      %s  (%s)\n' "$name" "$proj"
    elif same_content "$f" "$dest"; then
      # 内容一样也要记上这个项目：多个下游产出同一条经验，本仓 origin 得看得出都是谁
      old=$(fm_get "$dest" origin)
      merged=$(merge_origin "$old" "$proj")
      [ "$merged" = "$old" ] || set_origin "$dest" "$merged"
      N_SAME=$((N_SAME + 1)); printf '  same     %s  (%s)\n' "$name" "$proj"
    else
      old=$(fm_get "$dest" origin)
      # 两边对称：old 只按逗号切开、去每项首尾空白（merge_origin 做的），项目名里的空格两边都留着
      if printf ',%s,' "$(merge_origin "$old" "")" | grep -qF ",$proj,"; then
        # graduated / skipped 是框架侧的毕业状态，下游副本不知道，覆盖时保留本仓值
        grad=$(fm_get "$dest" graduated raw); skip=$(fm_get "$dest" skipped raw)
        write_from "$f" "$name" "$proj" "$old"
        [ -z "$grad" ] || set_fm "$dest" graduated "$grad"
        [ -z "$skip" ] || set_fm "$dest" skipped "$skip"
        N_UPD=$((N_UPD + 1)); printf '  updated  %s  (%s)\n' "$name" "$proj"
      else
        # 副本文件名里不留空格：索引的 markdown 链接遇空格就断
        cname="${name%.md}.from-${proj// /-}.md"
        if [ -e "$FB/$cname" ] && same_content "$f" "$FB/$cname"; then
          N_SAME=$((N_SAME + 1)); printf '  same     %s  (%s，已有冲突副本)\n' "$name" "$proj"
        else
          write_from "$f" "$cname" "$proj" "$(fm_get "$f" origin)"
          index_add "$cname"
          N_CONF=$((N_CONF + 1)); printf '  conflict %s → %s  (%s)\n' "$name" "$cname" "$proj"
        fi
      fi
    fi
  done
}

for s in "${SRCS[@]}"; do
  collect_one "$s"
done

[ "$DRY" = "1" ] && printf 'collect-feedback: dry-run，未写入任何文件\n'
printf 'collect-feedback: new=%s updated=%s same=%s conflict=%s\n' "$N_NEW" "$N_UPD" "$N_SAME" "$N_CONF"
exit 0
