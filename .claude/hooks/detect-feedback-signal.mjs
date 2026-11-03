// UserPromptSubmit：检测用户 prompt 中是否包含修正/反馈信号，命中则注入 additionalContext
// 提醒派 feedback-observer。关键词对齐 feedback-writer SKILL.md 观察维度第 1 条「用户修正」的信号定义。
//
// 触发词以 sidecar hooks/feedback-signals.txt 为唯一来源（用户可增删）；锚在本 hook 自己的目录，
// 不依赖 CLAUDE_PROJECT_DIR。文件缺失时退回下面这份内置默认表——丢个文件就永不触发，
// 是那种没人会发现的静默失效。
//
// 输出用**顶层** additionalContext（UserPromptSubmit 的契约，不是 hookSpecificOutput）。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdinJson, readTextFile, emit, say, fastOff, runFailOpen } from './lib/io.mjs';

const DEFAULT_SIGNALS = '不是这样|别这样做|你搞错|搞错了|你错了|不对|不应该|你漏了|你忘了|改一下|不合理|你理解错|我说的不是|你确定|到底在|为什么没|没有执行|没有生效|你又忘|强调了|说过了|提醒过|怎么还|一直在|每次都|我不是让你|你先.*看|再说一遍|你到底|什么意思|能不能|不要再|别再|停下|不用管|先不要';

const CONTEXT = '检测到用户修正信号。请在处理完用户请求后，派发 feedback-observer sub-agent 使用 feedback-writer skill 记录这条反馈。feedback 记录到 .claude/feedback/ 目录，不是 memory 目录。';

runFailOpen(async () => {
  if (await fastOff('detect-feedback-signal')) return;

  const ev = readStdinJson();
  if (!ev) return;
  const prompt = String(ev.prompt || '');
  if (!prompt) return;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const sidecar = readTextFile(path.join(here, 'feedback-signals.txt'));
  let pattern;
  if (sidecar.absent) {
    pattern = DEFAULT_SIGNALS;
  } else if (sidecar.error) {
    // 读不出来 ≠ 不存在：退回内置表，但把这一下说出来，别让「sidecar 坏了」看着像「没信号」
    say(`[detect-feedback-signal] feedback-signals.txt 读不出来（${sidecar.error.code || 'IO'}），本次用内置默认触发词。`);
    pattern = DEFAULT_SIGNALS;
  } else {
    pattern = (sidecar.text || '').trim();
    if (!pattern) return;
  }

  let re;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    say(`[detect-feedback-signal] feedback-signals.txt 不是合法正则，本次不触发：${e.message}`);
    return;
  }

  if (re.test(prompt)) emit({ additionalContext: CONTEXT });
});
