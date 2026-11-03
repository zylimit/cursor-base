#!/usr/bin/env node
// test-age.mjs — 用例老化：读 .claude/evidence/test-ledger.jsonl，列「跑够次数且一次没红过」的退休候选。
// 用法： node .claude/scripts/test-age.mjs [--min-runs N]   默认 20
// 账本由 run-all.sh 每次运行追加（每条用例一行 JSON）；没有账本就直说没有，不假装算过。
// 退出码：0=算完（有没有候选都算 0）；2=参数不对。
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 地板文件：密钥 / 危险命令 / 安装器这三类即使从不红也留着——它们红的那天代价是泄密、毁数据、装坏别人项目。
const FLOOR_FILES = ["test-scan-secrets-userinfo.sh", "test-setup.sh", "test-hooks-floor.sh"];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LEDGER = join(ROOT, ".claude", "evidence", "test-ledger.jsonl");

let minRuns = 20;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--min-runs") minRuns = Number(args[++i]);
  else if (args[i].startsWith("--min-runs=")) minRuns = Number(args[i].slice(11));
  else {
    console.error(`未知参数：${args[i]}（用法：test-age.mjs [--min-runs N]）`);
    process.exit(2);
  }
}
if (!Number.isFinite(minRuns) || minRuns < 1) {
  console.error("--min-runs 要一个 ≥1 的数");
  process.exit(2);
}

if (!existsSync(LEDGER)) {
  console.log(`还没有账本（${LEDGER}）——跑一次 .claude/tests/cases/run-all.sh 就有了。`);
  process.exit(0);
}

const agg = new Map();
let bad = 0;
for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let r;
  try { r = JSON.parse(line); } catch { bad++; continue; }
  if (!r || !r.file || !r.case) { bad++; continue; }
  const key = `${r.file}\u0000${r.case}`;
  const a = agg.get(key) || { file: r.file, case: r.case, runs: 0, fails: 0, skips: 0, firstSeen: r.t, lastFail: "" };
  // runs 只数真跑过的（PASS/FAIL）：SKIPPED 是没执行，拿它凑次数等于给从没跑过的用例发退休证。
  if (r.result === "PASS") a.runs++;
  else if (r.result === "FAIL") { a.runs++; a.fails++; if (r.t > a.lastFail) a.lastFail = r.t; }
  else a.skips++;
  if (r.t && (!a.firstSeen || r.t < a.firstSeen)) a.firstSeen = r.t;
  agg.set(key, a);
}

const rows = [...agg.values()]
  .filter((a) => a.runs >= minRuns && a.fails === 0 && !FLOOR_FILES.includes(a.file))
  .sort((x, y) => y.runs - x.runs || x.file.localeCompare(y.file));

console.log(`账本 ${LEDGER}`);
console.log(`用例 ${agg.size} 条，退休门槛 --min-runs ${minRuns}（地板文件不列入：${FLOOR_FILES.join(" / ")}）`);
if (bad) console.log(`坏行 ${bad} 条（解析不了，已跳过）`);
if (!rows.length) {
  console.log("没有退休候选——要么跑得还不够多，要么都红过。");
  process.exit(0);
}
const w = (s, n) => String(s) + " ".repeat(Math.max(1, n - String(s).length));
console.log("");
console.log(w("file", 30) + w("runs", 6) + w("firstSeen", 22) + "case");
for (const a of rows) console.log(w(a.file, 30) + w(a.runs, 6) + w(a.firstSeen || "-", 22) + a.case);
console.log("");
console.log(`共 ${rows.length} 条候选：跑过 ≥ ${minRuns} 次、一次没红过。发版前过一遍，删掉哪条记进 progress.md。`);
