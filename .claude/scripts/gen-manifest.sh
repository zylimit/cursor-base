#!/usr/bin/env bash
# gen-manifest.sh — 在框架源仓库生成 .claude/FRAMEWORK-MANIFEST.txt（框架核心文件清单）。
# 用法： bash .claude/scripts/gen-manifest.sh   （在 cc-base 仓库根或任意位置跑均可）
#        bash .claude/scripts/gen-manifest.sh --check   只比对不写：清单与源码树不一致 → 列出漂移项、退出 1
#          （改了框架文件没重跑本脚本，清单里就是旧哈希——装到别人项目那份会被当「用户改过」永不覆盖，
#            release 装配 manifest 项 FAIL、test-setup ⑨ 红；pre-commit githook 挂这一步是一天栽两次换来的）
# 清单格式：每行 <相对 .claude/ 的路径>TAB<sha256>；# 开头为注释头。
# 哈希算法：LF 归一化后再 SHA256（先 tr -d '\r' 再 sha256sum）——git autocrlf 会让不同
#   checkout 的工作树字节 CRLF/LF 不一，直接对字节算会误判"用户改过"，归一化后跨平台稳定。
# 排除逻辑对齐 setup.sh copy_claude_tree：运行态/机器特定/私有 feedback 不入清单；
#   settings.json 走 merge 不套 manifest；FEEDBACK-INDEX.md 装后重置为模板也不入清单。
# 同一张排除表另有三份，改这里必须同改：setup.sh copy_claude_tree 的 case（安装侧同一套口径）、
#   setup.ps1 的 $skip + 目录正则（Windows 安装侧，按 leaf 名匹配，语义等价）、
#   harness/ext/release.mjs MANIFEST_RULES（release 的 manifest 检查据此判「本表该不该收这个文件」，
#   它是审计者故意另抄一份、不共用来源，否则审不出本脚本的漂移）。四处口径分叉比缺一条更糟。
# 不抽单一来源是权衡后的结论，不是没想过：两个安装器要能被单独取走对着源码树跑（setup.sh 连
#   jq 都不敢依赖，还有整条无 jq 降级路径），多一个 source/parse 依赖就多一条装不上的路；
#   release.mjs 那份是审计者，共用来源就等于审计者和被审者对同一份表点头，审不出漂移。
#   代价是四份手工同步，所以口径由测试兜：tests/test-release-manifest.sh 造真文件锁本脚本 +
#   MANIFEST_RULES 两份行为一致，tests/test-setup.sh 的 ⑥ 逐臂比对四份表的字面口径。
# 排除项与 .claude/.gitignore 同源同步：gitignore 里排除的系统垃圾（.DS_Store / Thumbs.db /
#   *.swp）本表也必须挡——不挡就会被当框架文件登记进清单、装进别人项目。
# 排除项一律显式列名，不用 harness/* 这种通配符一把梭——运行态目录会继续增加，
#   但静默漏掉本该登记的框架文件（升级时会被当成"用户改过"永不覆盖）是更贵的错。
set -eu

CHECK=0
case "${1:-}" in
  --check) CHECK=1 ;;
  "") ;;
  *) echo "gen-manifest: 未知参数 $1（只认 --check）" >&2; exit 2 ;;
esac

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SRC="$ROOT/.claude"
OUT="$SRC/FRAMEWORK-MANIFEST.txt"
[ -d "$SRC" ] || { echo "gen-manifest: 找不到 .claude：$SRC" >&2; exit 1; }

norm_sha() { tr -d '\r' <"$1" | sha256sum | awk '{print $1}'; }

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

while IFS= read -r -d '' src; do
  rel=${src#"$SRC"/}
  case "$rel" in
    # @exclusions:begin （由 scripts/gen-exclusions.mjs 从 harness/exclusions.json 生成，手改会被 --check 抓出）
    FRAMEWORK-MANIFEST.txt) continue ;;  # 清单自身不入清单
    settings.json) continue ;;  # 天生合并对象，走 merge 逻辑
    settings-windows.json) continue ;;  # 无效产物 / 机器特定
    settings.local.json) continue ;;  # 无效产物 / 机器特定
    .needs-review) continue ;;  # stop-gate 运行时状态
    .needs-review.lock) continue ;;  # stop-gate 运行时状态
    .tdd-exempt) continue ;;  # 闸门运行时标记
    .red-verified) continue ;;  # 闸门运行时标记
    .static-gate) continue ;;  # 闸门运行时标记
    .degraded-review) continue ;;  # 闸门运行时标记
    .fast-mode) continue ;;  # 运行态标记
    .subagent-reminded) continue ;;  # 运行态标记
    .three-file-sync-advised) continue ;;  # 运行态标记
    .tdd-gate-advised) continue ;;  # 运行态标记
    .stop-gate-strikes) continue ;;  # 闸门计数 / 纪元 / 异步校验游标
    .stop-gate-advised) continue ;;  # 闸门计数 / 纪元 / 异步校验游标
    .precompact-block-epoch) continue ;;  # 闸门计数 / 纪元 / 异步校验游标
    .async-verify-last) continue ;;  # 闸门计数 / 纪元 / 异步校验游标
    signals.jsonl) continue ;;  # evolution 运行态信号队列
    */signals.jsonl) continue ;;  # evolution 运行态信号队列
    evidence/*) continue ;;  # 运行态证据目录
    harness/receipts/*) continue ;;  # 大仓治理运行态回执（harness.mjs / catalog 本体照常入清单）
    harness/state/*) continue ;;  # 证据哈希链 + 活跃 task 信封 + 评审会话（本机专属）
    harness/waivers/*) continue ;;  # 结构化 per-check 豁免
    harness/trend/*) continue ;;  # 架构漂移趋势台账（arch-check --record 快照）
    harness/evidence/*) continue ;;  # 每条 check 的原始 stdout/stderr
    harness/ext/*) continue ;;  # 大仓治理引擎：目标项目默认不装，setup --with-harness 才整目录拷，不入清单
    .runtime/*) continue ;;  # supervisor 进程守护运行态（supervisor.mjs 本体照常入清单）
    worktrees/*) continue ;;  # Claude Code sub-agent 的 worktree 隔离副本（整棵仓副本，不是这个仓的框架文件）
    tests/*) continue ;;  # 框架自测：目标项目默认不装（setup --with-tests 才整目录拷），不入清单
    research/*) continue ;;  # 姊妹框架分析等设计底本：框架自己的维护记录，不分发
    agent-memory/*) continue ;;  # 本仓 sub-agent 的战术记忆：审的是本仓，装进别人项目指向不存在的路径
    *.bak) continue ;;  # 安装器产物
    *.framework-new) continue ;;  # 安装器产物
    .DS_Store) continue ;;  # macOS 目录元数据（每层都会长，.gitignore 同条）
    */.DS_Store) continue ;;  # macOS 目录元数据（每层都会长，.gitignore 同条）
    Thumbs.db) continue ;;  # Windows 缩略图缓存（.gitignore 同条）
    */Thumbs.db) continue ;;  # Windows 缩略图缓存（.gitignore 同条）
    *.swp) continue ;;  # vim 交换文件（.gitignore 同条）
    feedback/templates/*) ;;  # 保留模板（框架资产）
    feedback/*/*) ;;  # feedback 子目录其他文件
    feedback/*.md) continue ;;  # 私人经验 + FEEDBACK-INDEX（装后重置为模板）
    # @exclusions:end
  esac
  printf '%s\t%s\n' "$rel" "$(norm_sha "$src")"
done < <(find "$SRC" -type f -print0) | sort >"$TMP"

if [ "$CHECK" -eq 1 ]; then
  [ -f "$OUT" ] || { echo "gen-manifest --check: 清单不存在：${OUT}（先不带参数跑一次生成）" >&2; exit 1; }
  # 只比正文：头四行注释不参与，清单里没有的路径与哈希变了的路径都算漂移
  DRIFT=$(diff <(grep -v '^#' "$OUT") "$TMP" | grep '^[<>]' || true)
  if [ -n "$DRIFT" ]; then
    echo "gen-manifest --check: 清单与源码树不一致（< 清单里的 / > 源码树实际的），重跑 bash .claude/scripts/gen-manifest.sh 后 git add：" >&2
    printf '%s\n' "$DRIFT" | cut -c1-80 >&2
    exit 1
  fi
  echo "gen-manifest --check: 清单与源码树一致（$(wc -l <"$TMP" | tr -d ' ') 个框架文件）"
  exit 0
fi

{
  printf '# cc-base FRAMEWORK-MANIFEST（框架核心文件清单，由 gen-manifest.sh 生成）\n'
  printf '# algorithm: sha256 of LF-normalized bytes（哈希前 tr -d '"'"'\\r'"'"'，抗 git autocrlf 干扰）\n'
  printf '# format: <path relative to .claude/>\tsha256\n'
  printf '# 不在本清单里的文件 = 项目私有层，升级安装一律不动。\n'
  cat "$TMP"
} >"$OUT"

count=$(wc -l <"$TMP" | tr -d ' ')
echo "gen-manifest: 已写入 ${OUT}（$count 个框架文件）"
