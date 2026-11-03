#!/usr/bin/env bash
# make-release.sh <version> — 构建 release 安装包 zip，排除「私人进化内容」。
# 排除（仅 release 包，仓库保留）：feedback/ 下积累的经验 *.md（保留 templates/，并把
#   FEEDBACK-INDEX.md 重置为干净模板，无私人条目）。
# 保留进化「机制」：EVOLUTION.md、evolution-engine skill、evolution-runner agent。
# 包内容来自 git HEAD（只含已跟踪文件）；opencode 版含预置 stub+lock（防启动黑屏）。
# 用法： bash make-release.sh v1.0.3   → 产出 /tmp/<repo>-v1.0.3.zip
set -eu

VER="${1:?usage: bash make-release.sh <version>  e.g. v1.0.3}"
ROOT=$(git rev-parse --show-toplevel)
REPO=$(basename "$ROOT")
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

git -C "$ROOT" archive --format=tar --prefix="$REPO/" HEAD | tar -x -C "$TMP"
PKG="$TMP/$REPO"

# 定位框架目录（.opencode 或 .claude）
FWDIR=""
for fw in .opencode .claude; do
  [ -d "$PKG/$fw" ] && { FWDIR="$PKG/$fw"; break; }
done

# 排除私人进化内容：删 feedback 顶层经验 *.md（保留 templates/），重置索引为模板
FB="$FWDIR/feedback"
if [ -n "$FWDIR" ] && [ -d "$FB" ]; then
  find "$FB" -maxdepth 1 -type f -name '*.md' -delete
  TPL="$FB/templates/feedback-index-template.md"
  [ -f "$TPL" ] && cp "$TPL" "$FB/FEEDBACK-INDEX.md"
fi

# 分发包只含引擎 + hooks + skills + agents + rules（+ tests 供 setup --with-tests）：
# 框架自己的维护记录（progress / docs / research）与本仓 sub-agent 记忆不进包——它们指向的是本仓，
# 装进别人项目就是噪声，而且 progress 里两次带出过开发者路径。
rm -f "$PKG/progress.md" "$PKG/progress.archive.md"
rm -rf "$PKG/docs"
[ -n "$FWDIR" ] && rm -rf "$FWDIR/research" "$FWDIR/agent-memory"

OUT="/tmp/$REPO-$VER.zip"
rm -f "$OUT"
# 打包：Windows（Git Bash/MINGW）下 python shutil 不认 /tmp 挂载会 FileNotFoundError（#9）→
#       Compress-Archive（cygpath 转 Windows 路径）；非 Windows 用 python3 zipfile（不依赖外部 zip）。
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    powershell -NoProfile -Command "Compress-Archive -Path '$(cygpath -w "$PKG")' -DestinationPath '$(cygpath -w "$OUT")' -Force"
    ;;
  *)
    python3 -c "import shutil; shutil.make_archive('/tmp/$REPO-$VER', 'zip', '$TMP', '$REPO')"
    ;;
esac

# 打包后泄漏扫描（verify-not-assume，守 #5）：解包确认 feedback/ 下无私有 *.md 泄漏
#   （templates/ 与 FEEDBACK-INDEX.md 除外）。发现泄漏即报错非零退出，不发坏包。
#   Windows 下 python zipfile 同样不认 /tmp 路径，用 cygpath -w 转换。
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    SCAN_PATH=$(cygpath -w "$OUT")
    ;;
  *)
    SCAN_PATH="$OUT"
    ;;
esac
python3 - "$SCAN_PATH" <<'PY'
import sys, zipfile
path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    names = z.namelist()
leaked = [
    n for n in names
    if ("/feedback/" in n and n.endswith(".md") and "/templates/" not in n and not n.endswith("/FEEDBACK-INDEX.md"))
    or n.endswith("/progress.md") or n.endswith("/progress.archive.md")
    or "/docs/" in n or "/research/" in n or "/agent-memory/" in n
]
if leaked:
    raise SystemExit("make-release: 私有 feedback 泄漏进包：" + ", ".join(leaked[:5]))
PY

echo "$OUT"
