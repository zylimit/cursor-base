#!/usr/bin/env bash
# gate-audit.sh — 只读诊断：汇总所有钩子的真实拦截战绩
#
# cc-base 注册了一批 block 闸（.claude/settings.json），拦截账本 gate-block.log
# 由 hooks/lib/gatelog.mjs 写在 .claude/evidence/（主仓 + 各 worktree 各一份）。本脚本把
# 它们全找出来，对照注册清单算出：哪些钩子真拦过（有战绩）、哪些注册了却从没出现
# （零拦停——账本只在拦停时写，没有「跑过 N 次」这个分母，零拦停推不出死闸）——
# 对齐「闸靠数据留，不靠感觉留」。
# 纯只读——除 stdout 外不写/改/删任何文件（尤其不碰任何 .log）。
set -euo pipefail

# 扫描根 = 主仓工作树根（worktree 里 --git-common-dir 指主仓 .git，其父即主根），
# 这样一次 find 既覆盖主仓 .claude/evidence 又覆盖所有 worktree 下的同名账本。
common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
if [ -n "$common_dir" ]; then
  scan_root=$(dirname "$common_dir")
else
  scan_root=$(pwd)   # 非 git 环境兜底：就地扫
fi

# 1) 找全所有 gate-block.log（主仓 + 所有 worktree，别漏任何一份）
logs=()
while IFS= read -r f; do logs+=("$f"); done < <(find "$scan_root" -type f -name gate-block.log 2>/dev/null | sort)

# 2) 注册闸清单：只认源码里引了 gatelog 的 hook 才算闸（能经 gateLog 写账本的 block 钩子）。
#    信息类 hook（auto-push / session-rules-banner 等不调 gateLog、永不拦截）不是闸，不纳入——
#    否则它们必然「零记录」，被误报成死闸。现算，别写死名单：写死的名单一定会跟代码走散。
registered=()
while IFS= read -r f; do registered+=("$(basename "$f" .mjs)"); done \
  < <(grep -lE "gatelog|gateLog\(" "$scan_root/.claude/hooks/"*.mjs 2>/dev/null | sort -u)

# 3) 账本统计：TSV（时间戳<TAB>钩子名<TAB>原因）→ 每钩子 次数/首次/末次
#    awk 输出「钩子名<TAB>次数<TAB>首次<TAB>末次」，按次数降序由 sort 处理。
stats=""
if [ "${#logs[@]}" -gt 0 ]; then
  stats=$(awk -F'\t' '
    NF>=2 && $2!="" {
      name=$2; ts=$1; c[name]++
      if (first[name]=="" || ts<first[name]) first[name]=ts
      if (last[name]=="" || ts>last[name])  last[name]=ts
    }
    END { for (n in c) printf "%s\t%d\t%s\t%s\n", n, c[n], first[n], last[n] }
  ' "${logs[@]}" | sort -t$'\t' -k2,2nr -k1,1)
fi

# 有战绩的钩子名集合（供「零记录」对比）
seen_names=$(printf '%s\n' "$stats" | awk -F'\t' 'NF>=1 && $1!=""{print $1}' | sort -u)

echo "════════════════════════════════════════════════════════════════"
echo " 钩子拦截战绩审计（gate-audit）"
echo " 扫描根：$scan_root"
echo "════════════════════════════════════════════════════════════════"
echo ""

# (a) 有战绩的钩子
echo "── (a) 有战绩的钩子（按拦截次数降序）──"
if [ -n "$stats" ]; then
  printf '%-30s %8s  %-20s  %-20s\n' "钩子名" "拦截次数" "首次" "末次"
  printf '%s\n' "$stats" | while IFS=$'\t' read -r name cnt first last; do
    [ -n "$name" ] || continue
    printf '%-30s %8s  %-20s  %-20s\n' "$name" "$cnt" "$first" "$last"
  done
else
  echo "（账本为空，没有任何拦截记录）"
fi
echo ""

# (b) 零记录钩子：注册了但账本里从没出现的
echo "── (b) 零记录钩子（注册了但从没拦过：前置条件不在本仓，或威慑生效）──"
zero_count=0
for h in "${registered[@]}"; do
  if ! printf '%s\n' "$seen_names" | grep -qxF -- "$h"; then
    echo "  • $h"
    zero_count=$((zero_count+1))
  fi
done
[ "$zero_count" -eq 0 ] && echo "（无——所有注册钩子都至少拦过一次）"

# 零拦停先看前置条件在不在本仓：catalog / tsconfig / .py 这三项不在，对应的闸在这压根没有
# 可拦的东西，账本零记录说不明死活。框架仓审自己的闸，会系统性低估「为下游消费者而存在」的那批。
cat_state=无
[ -f "$scan_root/.claude/harness/module-catalog.json" ] && cat_state=有
ts_count=$(find "$scan_root" -maxdepth 3 -name tsconfig.json -not -path '*/node_modules/*' 2>/dev/null | wc -l | tr -d ' ')
if git -C "$scan_root" rev-parse --git-dir >/dev/null 2>&1; then
  py_count="$(git -C "$scan_root" ls-files '*.py' | wc -l | tr -d ' ') 个"
else
  py_count="未知（非 git 目录）"
fi
echo ""
echo "  本仓能力上下文："
echo "  module-catalog.json：$cat_state"
echo "  tsconfig.json：$ts_count 个"
echo "  .py 文件：$py_count"
echo "  以上某项不在本仓，对应的闸在这就没有可拦的场景，零拦停无从评价——"
echo "  退役任何一个闸之前，先查下游项目的 .claude/evidence/gate-block.log。"
echo ""

# (c) 汇总
have_count=0
for h in "${registered[@]}"; do
  if printf '%s\n' "$seen_names" | grep -qxF -- "$h"; then
    have_count=$((have_count+1))
  fi
done
echo "── (c) 汇总 ──"
echo "  注册钩子：${#registered[@]} 个"
echo "  有记录　：$have_count 个"
echo "  零记录　：$zero_count 个"
echo ""
echo "  找到的账本文件（${#logs[@]} 份，暴露 worktree 漂移）："
if [ "${#logs[@]}" -gt 0 ]; then
  for f in "${logs[@]}"; do echo "    - $f"; done
else
  echo "    （未找到任何 gate-block.log）"
fi
