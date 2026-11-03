// advise-dedup.mjs — advise 档提醒的去重：同一件事一小时内只说一次。
// 由来：stop-gate 先有这套（.stop-gate-advised），下游账本里同一份清单一天重复提醒上百次，
//   没一次被理会——响了几百次没人理的闸和从没拦过东西的闸一样没价值。three-file-sync-gate /
//   tdd-gate 撞上同一种噪音，抽到这里共用，免得三份各抄一套、抄漏一处就是一处永久静默。
// 标记文件两行自描述：sig=<签名>、ts=<毫秒 epoch>。签名由调用方决定「什么算同一件事」。
// 口径（三条闸一致）：
//   - 读写失败、文件损坏、时间戳异常一律当没提醒过——宁可多提醒一次，不许状态文件坏了就永久静默；
//   - 签名变了、满 ADVISE_REPEAT_MS 都再提醒一次，欠账不因去重永远沉底；
//   - 只在 advise 档用：block 档人是审批者，每次都该拦、每次都该说，不碰这个文件。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readTextFile } from './io.mjs';

/** advise 去重的重提间隔：同一件事静默这么久后再提醒一次。 */
export const ADVISE_REPEAT_MS = 60 * 60 * 1000;

/** 一组条目的签名：先排序再哈希，顺序不同不算两件事。 */
export function listSig(items) {
  return crypto.createHash('sha256').update([...items].sort().join('\n')).digest('hex');
}

/** 一段文本的签名（不排序）。 */
export function textSig(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/** 同一件事是否刚提醒过：sig 相同且距上次未满 repeatMs 才算；文件缺失 / 损坏 / 时间戳异常一律 false。 */
export function recentlyAdvised(markerPath, sig, repeatMs = ADVISE_REPEAT_MS) {
  const st = readTextFile(markerPath);
  if (!st.text) return false;
  const lines = st.text.replace(/\r/g, '').split('\n');
  const oldSig = (lines.find((l) => l.startsWith('sig=')) || '').slice(4);
  const ts = (lines.find((l) => l.startsWith('ts=')) || '').slice(3);
  if (oldSig !== sig || !/^\d+$/.test(ts)) return false;
  const age = Date.now() - Number(ts);
  return age >= 0 && age < repeatMs;
}

/** 记下本次提醒；写失败只代表下次多提醒一次，不能让闸出错。 */
export function recordAdvised(markerPath, sig) {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, `sig=${sig}\nts=${Date.now()}\n`);
  } catch { /* 记不下来 = 下次再提醒，宁可多说不可静默 */ }
}

/** 清去重状态：只在 advise 档调；删不掉最多少提醒一次，不该让闸拦停。 */
export function clearAdvised(markerPath) {
  try { fs.rmSync(markerPath, { force: true }); } catch { /* 清不掉 = 一小时内同一件事少提醒一次，不拦停 */ }
}
