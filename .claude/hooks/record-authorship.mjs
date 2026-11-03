// PostToolUse(Edit|Write|NotebookEdit)：作者台账自动记账——把「谁写了哪个文件」喂给
// harness authorship record，让 review verdict 的「评审者不是作者」从纸面变成引擎判得了的事。
// 为什么要它：引擎侧 authorship record|show 早就有，但全仓没有一处调用，账本永远是空的，
//   verdict 于是永远走「账本为空 → authorshipEnforced:false」——规则只存在于文字里。
//   Claude Code 的 hook 输入在 sub-agent 内触发时带 agent_type / agent_id，这正是账本缺的那一半。
// 谁算作者：agent_type 优先（角色名才是评审侧 review lens --agent <id> 用得上的同一把钥匙），
//   缺则退 agent_id，两者都无 = 主 Agent 自己在写，记 main。agentType 字段原样传 agent_type
//   （空串由引擎归一为 null），agentId 才是匹配键。
// 启用条件与降级：catalog 存在才跑——大仓治理默认关闭，无 catalog 时立刻退出，不写任何文件、
//   不调引擎（可判定的降级，非假绿）。
// 档位（profile.json）：三档全 on——fast 档同样记账。作者账本一断，review 的「评审者不是作者」
//   判定就失明，而这本账不拦任何东西、省不出什么（#50）。
// 这是记账不是闸：任何内部错误一律 exit 0（PostToolUse 的非 0 退出码会回灌工具结果），
//   只往 stderr 写一行说明；引擎调用套 10 秒超时，一次卡死不许拖住每一次 Edit。
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, readStdinJson, toPosix, say, fastOff, runFailOpen } from './lib/io.mjs';
import { harnessEnabled, harnessRun } from './lib/harness.mjs';

const RECORD_TIMEOUT_MS = 10000;

/** path.relative 的答案是否根本没待在 base 底下（要爬出去，或跨盘符压根没有相对路线）。 */
function escapesBase(rel) {
  return rel === '..' || rel.startsWith(`..${path.sep}`) || rel.startsWith('../') || path.isAbsolute(rel);
}

/** 展开真实路径（Windows 上顺带展开 8.3 短名）；文件不存在就用原样，本函数绝不抛。 */
function realOrSelf(p) {
  try { return fs.realpathSync.native(p); } catch (_e) { return p; }
}

/**
 * 仓相对路径；折完出根（或折成空）返回 null——账本靠逐字相等匹配 changedSet，记一条带 .. 的
 * 路径只会留下永远匹配不上的脏行。拼法优先、身份兜底（core.mjs repoRelative 的精简版）。
 */
function repoRel(root, raw) {
  const rootAbs = path.resolve(toPosix(root));
  const abs = path.resolve(rootAbs, toPosix(raw));
  const spelling = path.relative(rootAbs, abs);
  if (spelling !== '' && !escapesBase(spelling)) return toPosix(spelling);
  const identity = path.relative(realOrSelf(rootAbs), realOrSelf(abs));
  if (identity !== '' && !escapesBase(identity)) return toPosix(identity);
  return null;
}

runFailOpen(async () => {
  if (await fastOff('record-authorship')) return;

  const ev = readStdinJson();
  if (!harnessEnabled()) return;

  // 与 harnessEnabled() 用同一个根：catalog 在哪个根下找到的，相对路径就得按那个根算，
  // 否则 CLAUDE_PROJECT_DIR 缺失时会按 cwd（可能是子目录）记出一条引擎永远匹配不上的路径
  const root = projectDir();
  const input = ev ? (ev.tool_input || {}) : {};
  // NotebookEdit 的路径字段叫 notebook_path，不叫 file_path——只认一个会让 notebook 编辑无声漏账
  const filePath = String(input.file_path || input.notebook_path || '');
  if (!filePath) return;

  const agentType = ev && ev.agent_type ? String(ev.agent_type) : '';
  const author = agentType || (ev && ev.agent_id ? String(ev.agent_id) : '') || 'main';

  const rel = repoRel(root, filePath);
  if (rel === null) return;

  // 用 JSON.stringify 造 payload：文件名里的引号 / 反斜杠 / 非 ASCII 交给它转义，手拼字符串
  // 迟早拼出坏 JSON
  const payload = JSON.stringify({ agentId: author, agentType, files: [rel] });

  // cwd 落在项目根：record 要算 baseCommit（git 跑在 cwd），cwd 不对会记下一个无关仓的 HEAD
  const r = harnessRun(['authorship', 'record'], { input: payload, cwd: root, timeout: RECORD_TIMEOUT_MS });
  if (r.status !== 0) {
    const head = String(r.stderr || '').split(/\r?\n/).find((l) => l.trim() !== '') || '';
    say(`[record-authorship] 作者台账未记上（${rel} ← ${author}）：harness authorship record 退出码 ${r.status}。${head}`);
  }
});
