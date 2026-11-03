// SessionStart：输出 CC 框架核心铁律横幅（source=compact/resume 时静默）。
// 各行攒进 lines，出口统一合成一条嵌套 JSON 的 additionalContext（Cursor 只收这种形态）。
// 档位（profile.json）：三档全 on——它是唯一反向用法的闸，fast 档下别的闸都静默，就它必须喊。
import path from 'node:path';
import fs from 'node:fs';
import { readStdinJson, context, runFailOpen } from './lib/io.mjs';

// 判定走共享库，动态 import——库缺失时按「什么都没开」处理（不播报档位，只出正常横幅）：
// 与本 hook 反向用法一致，其余 hook 静默、本横幅必须喊出来，缺库也不能因此崩掉开场。

/** 当前档位（缺 profile.json 就是内置默认表，不再有第二个开关文件可读）；判定库起不来返回 null。 */
async function tierNow(root) {
  try {
    const m = await import('./lib/tier.mjs');
    const t = m.effectiveTier({ projectDir: root });
    const session = m.readSession(root);
    return { ...t, reason: (session && session.reason) || '' };
  } catch (_e) {
    return null;
  }
}

/** 距过期还剩几小时（一位小数）；没有过期时间返回 null（null / 空串经 Number() 会变成 0，先挡掉）。 */
function hoursLeft(epoch) {
  if (epoch === null || epoch === undefined || epoch === '' || !Number.isFinite(Number(epoch))) return null;
  return Math.max(0, Math.round((Number(epoch) * 1000 - Date.now()) / 360000) / 10);
}

const BANNER = [
  '🔒 CC框架核心铁律：',
  '1. 主 Agent 不亲自编码/审查/测试/部署——一律派 Sub-Agent（implementer / code-reviewer / tester / deployer）',
  '2. 按档审查：Task 先定 LOW / MEDIUM / HIGH，MEDIUM 起派 code-reviewer fresh 实例审，不同 session 自审',
  '3. 验收以客观证据为准：跑命令核查，不只信 Sub-Agent 自述',
  '4. 存量资产保留复用：删/停/重写现有 hook/skill 须用户拍板',
  '5. 查证后再结论：结论前必须有证据（WebSearch / 命令输出 / 官方文档）',
  '6. 三文件同步：决策/约束/完成即时写 progress.md；需求变更写 Product-Spec + CHANGELOG',
].join('\n');

runFailOpen(async () => {
  const lines = [];
  try {
    await banner(lines);
  } finally {
    if (lines.length) context('SessionStart', lines.join('\n'));
  }
});

async function banner(lines) {
  const root = process.env.CLAUDE_PROJECT_DIR || '';

  // 上次 setup 挂在半路会留下 .claude/.runtime/install.marker——在半装的框架上开工全是坑，
  // 先把它顶到脸上（正常装完这文件不存在，不会天天吓人）。
  if (root && fs.existsSync(path.join(root, '.claude', '.runtime', 'install.marker'))) {
    lines.push('⚠️ 上次安装未完成（.claude/.runtime/install.marker）：重跑 setup.sh 补装完再干活。');
  }

  // compact/resume 不重复播报——档位那行跟着同一条纪律走，唯一例外是 fast：
  // 它是反向用法（别的闸静默、就它必须喊），压缩边界之后照喊，不然最该被记住的一条正好没了。
  const ev = readStdinJson();
  const source = ev ? String(ev.source || '') : '';
  const quiet = source === 'compact' || source === 'resume';

  // 档位播报：防 fast 忘关，也让自动升档说得出「为什么今天全是硬拦」。
  // 本闸也在 profile.hooks 表里——表说 off 就得真哑，否则 tier status 报的模式在撒谎。
  if (root) {
    try {
      const m = await import('./lib/tier.mjs');
      if (m.gateMode('session-rules-banner') === 'off') return;
    } catch (_e) { /* 判定库起不来照旧播报 */ }
  }
  const tier = root ? await tierNow(root) : null;
  if (tier && tier.tier === 'fast') {
    // sticky（tier set fast --sticky）没有过期时间，是用户明说的「到撤销为止」——照实说，别算出个剩几小时
    const left = tier.sticky === true ? null : hoursLeft(tier.expiresEpoch);
    const span = tier.sticky === true ? '到撤销为止' : (left === null ? '无过期时间' : `剩 ${left} h`);
    lines.push(`‼️ tier: fast（${span}${tier.reason ? `，${tier.reason}` : ''}）：治理闸只提醒不拦，欠账照记（.claude/.runtime/tier.json）。修完跑 bash .claude/scripts/fast-mode.sh off 恢复严格模式（Windows 纯 PowerShell 环境跑 pwsh .claude/scripts/fast-mode.ps1 off）。`);
    return;
  }
  if (quiet) return;

  if (tier) {
    const hits = (tier.raisedBy || []).slice(0, 3).join('、');
    lines.push(tier.source === 'raise'
      ? `tier: ${tier.tier}（来源 raise：工作树改了 ${hits}${(tier.raisedBy || []).length > 3 ? ' 等' : ''}）——治理面改动自动升档，本轮闸按最严跑。`
      : `tier: ${tier.tier}（来源 ${tier.source}）`);
  }

  lines.push(BANNER);
}
