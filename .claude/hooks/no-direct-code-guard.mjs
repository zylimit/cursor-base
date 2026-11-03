// PreToolUse(Edit|Write)：检测主 Agent 是否直接写业务源码，是则警告并 exit 2 拦下。
// 档位（profile.json）：off 静默放行；advise（fast 档）只警告不拦（exit 0）；block 走原逻辑。
import { readStdinJson, toPosix, say, gateModeOf, runFailOpen } from './lib/io.mjs';
import { gateLog } from './lib/gatelog.mjs';

// 框架文件放行（.claude/ / CLAUDE.md / Product-Spec / DEV-PLAN / progress / feedback / agents / skills / hooks / *.md）
const EXEMPT = /(\.claude\/|CLAUDE\.md|Product-Spec|DEV-PLAN|progress\.md|CHANGELOG|\/feedback\/|\/agents\/|\/skills\/|\/hooks\/|\.md$|\.json$|\.toml$|\.sh$|\.ps1$)/;
// 业务源码路径（src/ / app/ / lib/ / components/ 等），相对/绝对两种形态都拦
const SOURCE = /(^|\/)(src|app|lib|components|pages|api|server|client|utils|models|services)\//;

runFailOpen(async () => {
  const mode = await gateModeOf('no-direct-code-guard');
  if (mode === 'off') return;

  const ev = readStdinJson();
  // 子 Agent 里的写入一律放行：settings 里的 hook 在子 Agent 内同样触发，事件多带 agent_id /
  // agent_type（官方 hooks 文档明写）。这个闸守的是「主 Agent 不亲自编码」，implementer 写
  // src/ 本就是它的活——2026-09-15 实测 implementer 写 src/app.ts 被本闸 rc=2 拦下。
  if (ev && ev.agent_id) return;

  const input = ev ? (ev.tool_input || {}) : {};
  // 反斜杠先归一：Windows 侧事件里是 src\app.ts，不归一这条闸在那边等于不存在
  const filePath = toPosix(String(input.file_path || input.path || ''));
  if (!filePath) return;

  if (EXEMPT.test(filePath)) return;
  if (!SOURCE.test(filePath)) return;

  // 先落拦停码再写诊断：写 stderr / 账本失败也不该把已经成立的拦停降级成放行
  // advise 档只提醒不拦：话照说、账照记，退出码留 0。前缀写 [advise] 不写 [fast]——
  // advise 不只 fast 一档能来（overrides 也能），账本上写死档名等于记错了是谁放的行
  if (mode !== 'advise') process.exitCode = 2;
  say(`⚠️  [no-direct-code-guard] 主 Agent 不应直接写业务源码：${filePath}`);
  say('请派 implementer Sub-Agent 来编写，保持职责边界。');
  gateLog('no-direct-code-guard', `${mode === 'advise' ? '[advise] ' : ''}主 Agent 直接写业务源码被拦：${filePath}`);
});
