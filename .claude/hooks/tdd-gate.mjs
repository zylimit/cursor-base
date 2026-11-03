// PreToolUse(Agent)：TDD 闸门。检测是否在没有 .red-verified / .tdd-exempt 的情况下派 implementer 写代码。
// 档位（profile.json）：fast=off 静默；standard=advise 只提醒（exit 0）；strict=block 真拦（exit 2）。
// 挂 Agent 不挂 Bash：派 Sub-Agent 走 Agent 工具，这件事永远不经过命令行——按命令文本匹配
// implementer / dev-builder 只会误伤 `cat …implementer.md` 这类读文件的命令（账本里 19 次 strict
// 拦停按构造全是这么来的），还顺带教会模型换个写法绕开闸。
// 只管 red-lock 该管的单子：派单 prompt 里没有 RED_LOCK_KEYWORDS 任一词就静默放行，strict 档也不拦。
//   由来：下游看板 UI 项目两天 23 次提醒、另一项目 30 天 113 次，按框架自己的 red-lock 口径全是误报。
// advise 档去重：.tdd-gate-advised 记 prompt 前 PROMPT_SIG_CHARS 字的签名，同一单子一小时内重复派
//   不再重复提醒（口径与 stop-gate 共用 lib/advise-dedup.mjs）；block 档每次都拦、不碰这个文件。
import fs from 'node:fs';
import path from 'node:path';
import { readStdinJson, git, say, errText, gateModeOf, runFailOpen } from './lib/io.mjs';
import { gateLog } from './lib/gatelog.mjs';
import { textSig, recentlyAdvised, recordAdvised } from './lib/advise-dedup.mjs';

// red-lock 该管的任务关键词，大小写不敏感。来源：.claude/CLAUDE.md [开发测试规则]
// 「red-locks-the-bug 只给线上行为 bug 与核心解析器 / 契约缺陷」，状态机 / schema 取自本闸提醒文案
// 列的高价值逻辑，迁移 / 鉴权取自同一文件 LOW 档判据里不许碰的路径。
// 缺陷 / 修复 / 生产 / 崩溃 / 报错与 fix / hotfix / migration / auth / contract 是同一批意思的中英说法：
// 派单写「修复 #123 崩溃」「hotfix auth」时原表一个词都撞不上，该提醒的单子静默放行。
// 英文短词只认词首（WORD_START_KEYWORDS，值是词首之后还要排除的尾巴）：bug 不认 debug——「加 debug
// 日志」不是修线上行为；fix 不认 prefix / suffix，也不认 fixture（测试夹具不是修缺陷）；auth 不认
// author，authz / authn / authorize / authentication 照样命中。bugfix / fixes / bug-fixer 照样命中。
const RED_LOCK_KEYWORDS = ['bug', '线上', '解析器', 'parser', '契约', '状态机', 'schema', '迁移', '鉴权',
  '缺陷', '修复', '生产', '崩溃', '报错', 'fix', 'hotfix', 'migration', 'auth', 'contract'];
const WORD_START_KEYWORDS = new Map([['bug', ''], ['fix', '(?!ture)'], ['auth', '(?!or(?!i[sz]))']]);
const KEYWORD_RE = new RegExp(
  RED_LOCK_KEYWORDS.map((k) => (WORD_START_KEYWORDS.has(k) ? `(?:^|[^a-z])${k}${WORD_START_KEYWORDS.get(k)}` : k))
    .join('|'), 'i');

// 去重签名取 prompt 前多少字：同一张派单重派时开头一致，尾部常被补一两句上下文。
const PROMPT_SIG_CHARS = 300;

// 标记的保质期。验红验的是「这一轮改动」，不是一劳永逸：本仓一枚 9 月 11 日留下的空
// .red-verified 让闸静默放行了四天——过期标记比没有标记更坏，它看着像验过。
const MARK_TTL_MS = 2 * 3600 * 1000;

/** 标记还算不算数：不存在 / 过期都算没有；过期的当场删掉，不留给下一次。 */
function markLive(file) {
  let st;
  try { st = fs.statSync(file); } catch (_e) { return false; }
  if (Date.now() - st.mtimeMs <= MARK_TTL_MS) return true;
  // 判决已经定了（过期 = 没有），删不掉也不翻案，但得留一行看得见的诊断
  try { fs.rmSync(file, { force: true }); } catch (e) { say(`[tdd-gate] 过期标记删不掉，仍按无标记算：${errText(e)}`); }
  return false;
}

runFailOpen(async () => {
  const mode = await gateModeOf('tdd-gate');
  if (mode === 'off') return;

  const ev = readStdinJson();
  const input = ev ? (ev.tool_input || {}) : {};
  if (String(input.subagent_type || '') !== 'implementer') return;
  const prompt = String(input.prompt || '');
  if (!KEYWORD_RE.test(prompt)) return;

  const top = git(['rev-parse', '--show-toplevel']);
  const projectRoot = (top.status === 0 && top.stdout.trim()) ? top.stdout.trim() : process.cwd();
  const claudeDir = path.join(projectRoot, '.claude');

  if (markLive(path.join(claudeDir, '.red-verified'))
      || markLive(path.join(claudeDir, '.tdd-exempt'))) return;

  // 先落拦停码再写诊断：写 stderr / 账本失败也不该把已经成立的拦停降级成放行
  // standard 档到此为止：建议性提示，不硬拦截。
  // strict 档人是审批者——没验红就不许派编码，同一段提醒后 exit 2 真拦。
  // 前缀与记账两档都有，写法同 stop-gate / three-file-sync-gate：advise 不记账，gate-audit 只读账本，
  // 就会把这道唯一守着 red-lock 的闸当成「从没拦过东西」的死闸删掉——提醒过多少次，账上得看得见。
  const block = mode === 'block';
  if (block) process.exitCode = 2;
  if (!block) {
    const advisedFile = path.join(claudeDir, '.tdd-gate-advised');
    const sig = textSig(prompt.slice(0, PROMPT_SIG_CHARS));
    if (recentlyAdvised(advisedFile, sig)) return;
    recordAdvised(advisedFile, sig);
  }
  say(`${block ? '[block] ' : '[advise] '}TDD 闸门：派 implementer 做 GREEN 实现前须先完成 RED。`);
  say('高价值逻辑（契约/解析器/状态机/去重/schema 校验/驱动适配层等）：先派 tester 出失败测试 → 验红 → touch .claude/.red-verified，再派 implementer 写最简实现到绿。');
  say('若本 Task 是 UI/样式/非 TDD 逻辑：touch .claude/.tdd-exempt 显式声明豁免。');
  gateLog('tdd-gate', block
    ? '未验红即派 implementer 写码，strict 档拦停'
    : '[advise] 未验红即派 implementer，standard 档只提醒');
});
