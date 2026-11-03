#!/usr/bin/env bash
# doctor.sh — cc-base 安装/配置完整性自检。每项打 ✓/✗，有缺报非零退出。
# 用法： bash .claude/scripts/doctor.sh [仓库根目录]   默认当前目录
set -u

ROOT="${1:-.}"
case "$ROOT" in *..*) echo "doctor: 路径不安全: $ROOT" >&2; exit 2 ;; esac
[ -d "$ROOT" ] || { echo "doctor: 目标不存在: $ROOT" >&2; exit 2; }
cd "$ROOT" 2>/dev/null || { echo "doctor: 无法进入: $ROOT" >&2; exit 2; }

fail=0
warn=0

ok()   { printf '✓ %s\n' "$1"; }
bad()  { printf '✗ %s\n' "$1" >&2; fail=1; }
note() { printf '! %s\n' "$1" >&2; warn=1; }

# 上次安装装完了没：setup 中途挂了会把 .claude/.runtime/install.marker 的 status 翻成 interrupted。
# 放在最前面报——半装状态下下面那一串缺失多半都是它带出来的，先重跑 setup 再看别的。
if [ -f .claude/.runtime/install.marker ]; then
  if grep -q 'interrupted' .claude/.runtime/install.marker 2>/dev/null; then
    bad "上次安装未完成（.claude/.runtime/install.marker 记着 interrupted）：重跑 setup 补装"
  else
    note "存在 .claude/.runtime/install.marker（有个 setup 正在装？装完它会自己消失）"
  fi
fi

# 主控文件
# shellcheck disable=SC2015  # ok/bad 恒返回0（printf 不判失败），A&&B||C 在此处等价 if-else
[ -f .claude/CLAUDE.md ] && ok ".claude/CLAUDE.md 存在" || bad ".claude/CLAUDE.md 缺失"

# 主控下沉细则（rules/）
# shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
[ -d .claude/rules ] && ok ".claude/rules 存在" || bad ".claude/rules 缺失"
# harness-large-repo / quality-attributes 不在这张地板名单里：它们随 setup --with-harness 才落进
# rules/，默认不装的项目缺它们是正常状态，当缺陷报会让每个小项目的自检天天红一条。
for r in file-structure workflow-orchestration dev-workflow-details; do
  # shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
  [ -f ".claude/rules/$r.md" ] && ok "rule $r" || bad "rule $r 缺失"
done

# agent 装齐
# shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
[ -d .claude/agents ] && ok ".claude/agents 存在" || bad ".claude/agents 缺失"
# 七个核心角色写死当地板：调度表和 agents/ 一起错（整批改名、两边同时空）时，
# 两边同样错的动态比对会互相抵消判绿，写死的这份不会。
for name in implementer code-reviewer tester deployer feedback-observer evolution-runner progress-recorder; do
  # shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
  [ -f ".claude/agents/$name.md" ] && ok "agent $name" || bad "agent $name 缺失"
done
# 份数不写死。要查的是「该装的都装上了」，不是「恰好是某个数字」——写死 7 只挡得住那年的名单，
# 新增一个合规注册的 agent 就当场假红。真实来源取 CLAUDE.md 的调度表：它点名 .claude/agents/X.md 的，
# 本地就得有 X.md，少一份是漏装，正是这条要挡的。反过来多出来的不判 ✗——自建 agent 很正常，
# 只提一句它没登记（没进调度表，主 Agent 不会派它）。
if [ -f .claude/CLAUDE.md ]; then
  registered=$(grep -oE '\.claude/agents/[A-Za-z0-9_.-]+\.md' .claude/CLAUDE.md | sed 's#.*/##; s#\.md$##' | LC_ALL=C sort -u)
  reg_count=$(printf '%s\n' "$registered" | grep -c '^.' || true)
  if [ "$reg_count" -lt 7 ]; then
    bad "CLAUDE.md 调度表只解析到 $reg_count 个 agent 条目（至少该有七个核心角色）：表被改坏或没装全，名单比对失效"
  else
    # shellcheck disable=SC2086  # $registered 是换行分隔的多个名字，此处故意不加引号借 IFS 分词拼成单行空格分隔清单
    reg_flat=" $(printf '%s ' $registered)"
    miss=""
    for name in $registered; do
      [ -f ".claude/agents/$name.md" ] || miss="$miss $name"
    done
    # shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
    [ -z "$miss" ] && ok "agent 名单与 CLAUDE.md 调度表一致（登记 $reg_count 份）" \
      || bad "调度表登记了但本地没装：${miss# }（调度表共登记 $reg_count 份）"
    for f in .claude/agents/*.md; do
      [ -e "$f" ] || continue
      n=$(basename "$f" .md)
      case "$reg_flat" in *" $n "*) ;; *) note "agent $n 未登记进 CLAUDE.md 调度表（主 Agent 不会派它）" ;; esac
    done
  fi
else
  note "拿不到 .claude/CLAUDE.md，跳过 agent 名单与调度表的比对"
fi

# 每个 skill 都有 SKILL.md
# shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
[ -d .claude/skills ] && ok ".claude/skills 存在" || bad ".claude/skills 缺失"
for d in .claude/skills/*/; do
  [ -d "$d" ] || continue
  s=$(basename "$d")
  # shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
  [ -f "$d/SKILL.md" ] && ok "skill $s/SKILL.md" || bad "skill $s 缺 SKILL.md"
done

# hooks 语法：hook 全是 node 跑的 .mjs，不需要执行位；坏的是语法——注册着却起不来，
# 每次事件报一次 hook error，谁也不会去看那行小字。
# shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
[ -d .claude/hooks ] && ok ".claude/hooks 存在" || bad ".claude/hooks 缺失"
if command -v node >/dev/null 2>&1; then
  for hook in .claude/hooks/*.mjs .claude/hooks/lib/*.mjs; do
    [ -e "$hook" ] || continue
    # shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
    node --check "$hook" >/dev/null 2>&1 && ok "hook 语法 $hook" || bad "hook 语法错 ${hook}（node --check 不过）"
  done
else
  note "未找到 node，跳过 hooks/*.mjs 语法校验——hook 全靠 node 跑，装上 node 再验一次"
fi

# hook 公共库四件（22 个 hook 都 import，缺一件就是一整片 hook 起不来）
for m in io gatelog tier harness; do
  # shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
  [ -f ".claude/hooks/lib/$m.mjs" ] && ok "hooks/lib/$m.mjs 存在" || bad "hooks/lib/$m.mjs 缺失"
done

# settings.json 合法 JSON
if [ -f .claude/settings.json ]; then
  if command -v jq >/dev/null 2>&1; then
    if jq -e . .claude/settings.json >/dev/null 2>&1; then
      ok ".claude/settings.json 是合法 JSON"
    else
      bad ".claude/settings.json 不是合法 JSON"
    fi
  else
    note "未装 jq，跳过 settings.json JSON 校验"
  fi
else
  bad ".claude/settings.json 缺失"
fi

# settings.json 里每条 hook 指向的文件真的在——注册了却没装，是每次事件报一次 hook error，
# 而那行小字滚过去谁也不会读。用 node 解析（hook 本来就靠 node 跑，它不在的话下面也验不了语法）。
# 两种形态都要解析出路径：exec form 取 args[0]，string form（`node .claude/hooks/<name>.mjs`，没有 args）
# 取 command 里 node 后面那段、按项目根解析。
if [ -f .claude/settings.json ] && command -v node >/dev/null 2>&1; then
  # shellcheck disable=SC2016  # node -e 的单引号 JS 源码块，故意不让 shell 展开其中的 ${...}，那是 JS 里的字面量/表达式
  hook_miss=$(node -e '
const fs = require("node:fs");
const s = JSON.parse(fs.readFileSync(".claude/settings.json", "utf8"));
const root = process.cwd();
const miss = [];
for (const groups of Object.values(s.hooks || {})) {
  for (const g of (groups || [])) {
    for (const h of ((g && g.hooks) || [])) {
      let a = Array.isArray(h.args) && h.args.length ? String(h.args[0]) : "";
      if (!a && !("args" in h)) {
        const m = String(h.command || "").match(/^node (\.claude\/hooks\/[A-Za-z0-9_-]+\.mjs)$/);
        if (m) a = m[1];
      }
      if (!a) continue;
      const p = a.split("${CLAUDE_PROJECT_DIR}").join(root);
      if (!fs.existsSync(p.startsWith(".claude/") ? root + "/" + p : p)) miss.push(a);
    }
  }
}
process.stdout.write(miss.join(" "));
' 2>/dev/null) || hook_miss="PARSE_ERROR"
  if [ "$hook_miss" = "PARSE_ERROR" ]; then
    note "settings.json 的 hook 条目解析不了，跳过 hook 路径存在性检查"
  elif [ -z "$hook_miss" ]; then
    ok "settings.json 每条 hook 都指向真实存在的文件（exec form 看 args[0]，string form 看 command）"
  else
    bad "settings.json 有 hook 指向不存在的文件：$hook_miss"
  fi
fi

# 关键脚本存在
# make-release.sh 只在框架仓有：setup.sh 只装 .claude/ 那棵树，装到目标项目后它天然不在，
# 无条件判 ✗ 会让每个目标项目的 doctor 恒红——一个永远为真的红等于没有红。
# 判据取「像不像框架仓」：它自己在（那就该完好），或者仓根同时有 setup.sh 与 .git
# （框架仓的形态，此时缺了才是真缺）。两者都不成立就是目标项目，跳过并留一句话。
if [ -f make-release.sh ]; then
  ok "make-release.sh 存在"
elif [ -f setup.sh ] && [ -e .git ]; then
  bad "make-release.sh 缺失"
else
  note "非框架仓，跳过发布脚本检查"
fi
for s in doctor.sh plan-lint.sh predev-lint.mjs ui-audit.mjs test-age.mjs; do
  # shellcheck disable=SC2015  # 同上：ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
  [ -f ".claude/scripts/$s" ] && ok ".claude/scripts/$s 存在" || bad ".claude/scripts/$s 缺失"
done
# skill description 的 CSO 门（形状 + 措辞）已整条搬进引擎，存在性跟着挪到子命令上
if [ -f .claude/harness/harness.mjs ] && grep -q "skills-lint" .claude/harness/harness.mjs; then
  ok "harness skills-lint 子命令存在（skill description CSO 门）"
else
  bad "harness skills-lint 子命令缺失"
fi

# 运行时工具
# shellcheck disable=SC2015  # note 恒返回0，A&&B||C 是安全的 if-else 惯用写法
command -v git  >/dev/null 2>&1 && ok "git 可用"  || note "未找到 git；git 相关 hook 能力受限"
# shellcheck disable=SC2015  # 同上：note 恒返回0，A&&B||C 是安全的 if-else 惯用写法
command -v bash >/dev/null 2>&1 && ok "bash 可用" || note "未找到 bash"
# shellcheck disable=SC2015  # 同上：note 恒返回0，A&&B||C 是安全的 if-else 惯用写法
command -v jq   >/dev/null 2>&1 && ok "jq 可用（可选）"      || note "未找到 jq（可选）"
# shellcheck disable=SC2015  # ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
command -v node >/dev/null 2>&1 && ok "node 可用（22 个 hook 全靠它跑）" || bad "未找到 node；hook 一个都起不来"

# Claude Code 版本：hook 的 exec form（command:node + args）要够新的 Claude Code 才认。版本号拿不到就
# 只留一句话，不判 ✗——装法千奇百怪，为一句版本号把整份自检判红不值。
claude_ver=$(command -v claude >/dev/null 2>&1 && claude --version 2>/dev/null | head -1)
if [ -n "${claude_ver:-}" ]; then
  printf -- '- %s\n' "Claude Code：${claude_ver}（hook 走 exec form，需较新版本；本项只报不判）"
else
  note "拿不到 claude --version；hook 的 exec form 需较新的 Claude Code，版本自己确认一下"
fi

# 大仓治理 harness（默认关闭，catalog 存在即启用）——只报告状态，不 fail 小项目
# shellcheck disable=SC2015  # ok/note 恒返回0，A&&B||C 是安全的 if-else 惯用写法
[ -f .claude/harness/harness.mjs ] && ok "harness.mjs 存在" \
  || note "harness.mjs 缺失（大仓治理运行时；若不用大仓治理可忽略）"
# shellcheck disable=SC2015  # 同上：ok/note 恒返回0，A&&B||C 是安全的 if-else 惯用写法
[ -f .claude/harness/lib/core.mjs ] && ok "harness lib/ 存在（引擎拆库后 harness.mjs 单文件跑不起来）" \
  || note "harness lib/ 缺失（只拷 harness.mjs 不够，须连 .claude/harness/lib/ 一起装）"
# shellcheck disable=SC2015  # 同上：ok/note 恒返回0，A&&B||C 是安全的 if-else 惯用写法
[ -d .claude/harness/ext ] && ok "harness ext/ 存在（大仓治理引擎已装）" \
  || note "harness ext/ 未装（默认如此；要 impact/verify/gate 那套跑 setup.sh --with-harness）"
if [ -f .claude/harness/module-catalog.json ]; then
  ok "module-catalog.json 存在（大仓治理已启用）"
  # 开关开了、引擎没装 = stop-gate / pre-commit-check / harness-async-verify 三道闸一次也验不成。
  # 判 ✗ 不判 !：单看上面那行「ext 未装（默认如此）」是常态，配上 catalog 就是配置自相矛盾。
  # shellcheck disable=SC2015  # ok/bad 恒返回0，A&&B||C 是安全的 if-else 惯用写法
  [ -d .claude/harness/ext ] && ok "harness ext/ 与 catalog 配套（三道大仓闸能真跑）" \
    || bad "module-catalog.json 在但 harness ext/ 未装：stop-gate / pre-commit-check / harness-async-verify 三道闸只会当场提示未验、验不成——跑 setup.sh --with-harness 装包，或删掉 catalog 关闭大仓治理"
  # shellcheck disable=SC2015  # ok/note 恒返回0，A&&B||C 是安全的 if-else 惯用写法
  command -v node >/dev/null 2>&1 && ok "node 可用（harness 可跑）" \
    || note "未找到 node；大仓治理 harness 判定将降级跳过（非假绿）"
else
  printf -- '- %s\n' "module-catalog.json 未配置（大仓治理默认关闭，接线走原逻辑）"
fi

# FRAMEWORK-MANIFEST 全量比对：清单里每一条都算 LF 归一化 SHA256 对一遍，不符的逐条点名
# （路径 + 期望/实际 sha 前 8 位）并判 ✗。旧实现是「前 20 行里随机抽 3 个」的 note 级抽验，
# 两处都不成立：抽样窗口外的篡改永远看不见；shuf 让同一棵树每次给出不同结论。
# 分发完整性这种事要么全量确定地答，要么别答——不符也不再降级成告警，
# 它意味着框架文件被改过或清单已陈，两种都得有人看一眼。
if [ -f .claude/FRAMEWORK-MANIFEST.txt ] && command -v sha256sum >/dev/null 2>&1; then
  mismatch=0; checked=0; missing=0
  # 逐条点名有上限：几百条全不符时刷屏没人读，超出部分只报条数（下面那行）。
  MAN_MAX_NAMED=20
  while IFS=$(printf '\t') read -r m_rel m_sha; do
    case "$m_rel" in ''|\#*) continue ;; esac
    # 登记了却不在本地 = 分发缺件，和内容不符一样是「这棵树跟清单说的不是一回事」。
    # 原先只累加计数、末尾报一句告警，于是删掉三个框架文件 doctor 照样 rc 0，
    # 「N 条一致」只是悄悄变小——没人会去记上次那个 N 是多少。
    if [ ! -f ".claude/$m_rel" ]; then
      missing=$((missing + 1))
      [ "$missing" -le "$MAN_MAX_NAMED" ] \
        && bad "FRAMEWORK-MANIFEST 缺失：$m_rel 登记了但本地没有（期望 ${m_sha:0:8}）"
      continue
    fi
    checked=$((checked + 1))
    actual=$(tr -d '\r' <".claude/$m_rel" | sha256sum | awk '{print $1}')
    [ "$actual" = "$m_sha" ] && continue
    mismatch=$((mismatch + 1))
    [ "$mismatch" -le "$MAN_MAX_NAMED" ] \
      && bad "FRAMEWORK-MANIFEST 不符：$m_rel 期望 ${m_sha:0:8} 实际 ${actual:0:8}"
  done < <(grep -v '^#' .claude/FRAMEWORK-MANIFEST.txt)
  if [ "$mismatch" -gt "$MAN_MAX_NAMED" ]; then
    bad "FRAMEWORK-MANIFEST 另有 $((mismatch - MAN_MAX_NAMED)) 条不符未逐条列出（先修上面这些）"
  fi
  if [ "$missing" -gt "$MAN_MAX_NAMED" ]; then
    bad "FRAMEWORK-MANIFEST 另有 $((missing - MAN_MAX_NAMED)) 条缺失未逐条列出（先补上面这些）"
  fi
  if [ "$checked" -eq 0 ]; then
    note "FRAMEWORK-MANIFEST 存在但一条都没验到（清单为空，或登记的文件都不在本地）"
  elif [ "$mismatch" -eq 0 ]; then
    ok "FRAMEWORK-MANIFEST 全量比对 $checked 条 SHA 一致"
  else
    bad "FRAMEWORK-MANIFEST 全量比对 $checked 条，$mismatch 条 SHA 不符"
  fi
  # 缺件另算一档：没参与比对，不许混进「一致」的计数里，也不许只当告警。
  [ "$missing" -ne 0 ] && bad "FRAMEWORK-MANIFEST 全量比对 $checked 条，另有 $missing 条登记的文件不在本地"
fi

if [ "$fail" -ne 0 ]; then
  echo "doctor: 自检失败"
  exit 1
fi
if [ "$warn" -ne 0 ]; then
  echo "doctor: 通过（有告警）"
else
  echo "doctor: 通过"
fi
exit 0
