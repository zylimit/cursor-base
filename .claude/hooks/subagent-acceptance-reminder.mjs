// SubagentStop（matcher: implementer|code-reviewer|tester|deployer）
// 执行类 Sub-Agent 停下时，注入它自己的收工前自检：结论锚到实际跑过的命令，证不出的写进 Not verified。
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { readStdinJson, readTextFile, emit, fastOff, runFailOpen } from './lib/io.mjs';

runFailOpen(async () => {
  if (await fastOff('subagent-acceptance-reminder')) return;

  // 事件读不懂也照样提醒（退化成默认称呼）：漏掉一次验收提醒比多提醒一次贵
  const ev = readStdinJson();
  const role = ev ? String(ev.agent_type || ev.subagent_type || '') : '';
  const agent = role || '子 Agent';

  // 去重：同一子代理完成事件可能重复触发本 hook（如 stop 闸拦回子代理、其再停一次），反复提醒
  // 会淹没子代理终报。每个完成事件只提醒一次——有 agent_id 用之，否则取稳定字段哈希做键；
  // 已提醒键记 .claude/.subagent-reminded（保留最近 50 条，状态损坏/缺失只会多提醒一次，不阻断）。
  const root = process.env.CLAUDE_PROJECT_DIR;
  if (root && ev) {
    const key = ev.agent_id
      ? String(ev.agent_id)
      : createHash('sha256')
          .update(`${ev.session_id || ''}|${role}|${ev.transcript_path || ''}`)
          .digest('hex');
    const seen = path.join(root, '.claude', '.subagent-reminded');
    const prior = (readTextFile(seen).text || '').replace(/\r/g, '').split('\n');
    if (prior.includes(key)) return;
    try {
      fs.mkdirSync(path.dirname(seen), { recursive: true });
      fs.appendFileSync(seen, key + '\n');
      const all = (readTextFile(seen).text || '').replace(/\r/g, '').split('\n').filter((l) => l !== '');
      if (all.length > 50) fs.writeFileSync(seen, all.slice(-50).join('\n') + '\n');
    } catch (_e) {
      /* 去重表写不成只会多提醒一次，不阻断子代理 */
    }
  }

  // 这句注入落在刚停下的那个子 Agent 自己的上下文，主 Agent 这侧收不到（实测两例；官方文档 Stop /
  // SubagentStop 两处措辞相同、只写 "Added to Claude's conversation"，不判归属），所以按第二人称写给它。
  // 回执真报了领域发现才点一句：口径库是沟通 / 澄清过程的副产品，催不来——催出来的是凑数，凑的
  // 没有现场依据，进库即噪音，正是 domain-rulings 自己要防的东西。没这一栏、栏里写 None、回执
  // 压根读不到，一律静默：那是无从判断，不是漏填。栏名容忍加粗与列表符，正文算到下一个字段标签为止。
  // 判据按开头词不按整串相等：`None（本轮纯只读）` 这种带括注的是子 Agent 的自然写法，整串相等会把它
  // 判成「有发现」，正好催在刚反转掉的意图上。「无」那一支不能用 \b（JS 的 \b 是 ASCII 词边界、对汉字
  // 不成立，裸「无」会退化），改判后面不许跟汉字，否则「无线接入侧 VLAN 按 OLT 槽位算」这类真发现会被吞掉。
  const receipt = ev && typeof ev.last_assistant_message === 'string' ? ev.last_assistant_message : '';
  const label = /(?:^|\n)[\s>*+-]*\**\s*domain findings\s*\**\s*[:：]?/i.exec(receipt);
  const tail = label ? receipt.slice(label.index + label[0].length) : '';
  const found = tail.split(/\n[\s>*+-]*\**\s*(?:needs review by|evidence)\b/i)[0].replace(/[\s*`_>-]/g, '');
  const hasDomain = found !== '' && !/^(none|n\/a)\b|^无(?![一-鿿])/i.test(found);

  const msg = `${agent}：你就要收工了——自报（完成/通过/空回复）不算客观证据，把每条结论锚到你实际跑过的命令与它的输出上；没跑过、证不出的写进 Not verified。${hasDomain ? '回执里报了领域发现的，写清你手上的证据是哪一类（实测 / 查外网 / 查内部）；定论归主 Agent，你只报不判。' : ''}`;
  emit({ hookSpecificOutput: { hookEventName: 'SubagentStop', additionalContext: msg } });
});
