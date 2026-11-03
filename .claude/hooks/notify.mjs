// Notification(agent_needs_input|agent_completed|permission_prompt)：桌面通知——后台
// subagent 成为默认形态后（v2.1.198+ spawn 默认 async_launched），完成/需输入不再有
// 同步返回点，用户容易对着安静的终端干等。本 hook 把这三类通知转成终端转义序列
// （OSC 777 桌面通知 + BEL 响铃），经 hook JSON 的 terminalSequence 字段由 Claude Code
// 代发（hook 进程无 /dev/tty，直写会失败；terminalSequence 是官方指定通道）。
// Notification 事件忽略退出码与 stderr，terminalSequence 照常生效。
// 不拦任何东西，纯可见性；地板闸（profile.floor），任何档位都改不了——fast 档不是「不用通知我」。
import { readStdinJson, emit } from './lib/io.mjs';

const OSC = '\u001b]777;notify;Claude Code;';
const BEL = '\u0007\u0007';
// 事件读不懂时的兜底：宁可发一条没有正文的通知，也不能输出坏 JSON
// （坏 JSON 会被记成 hook error，等于这次通知白发）。
const FALLBACK = OSC + 'attention' + BEL;

let seq = FALLBACK;
try {
  const ev = readStdinJson();
  if (ev) {
    const msg = String(ev.message || 'Claude Code needs your attention').replace(/\n/g, ' ').slice(0, 120);
    seq = OSC + msg + BEL;
  }
} catch (_e) {
  seq = FALLBACK;
}
emit({ terminalSequence: seq });
process.exitCode = 0;
