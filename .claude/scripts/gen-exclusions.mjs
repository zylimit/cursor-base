#!/usr/bin/env node
// 排除表生成器：.claude/harness/exclusions.json 是唯一真相源，本脚本据此重写标记区——
//   主循环三张表：.claude/scripts/gen-manifest.sh / setup.sh 的 case 臂（一条 pattern 一臂），
//   setup.ps1 的 $skip / $skipAnyDepth 两行与 -match 正则区（纯 ASCII，中文 note 不进 ps1）；
//   只用 mainTree!==false 的条目（state/* 这类只供可选包用的条目不进这三张表）。
//   可选包判定（progress.md TODO #82）：setup.sh is_optional_excluded() 的 case 臂、
//   setup.ps1 Test-OptionalExcluded() 的 -match 正则区，只用 optionalLeaf===true 的条目——
//   这批是与目录深度无关的「叶子级」项（.DS_Store / *.bak / state/* 等）；harness/ext/* 那种
//   main 树用的整棵子树排除项不进这里，可选包装的恰恰就是那几棵子树，混进来会把要装的也排除掉。
// 无参 = 重写；--check = 内存生成与文件现内容比对，有差异打印文件名并 rc 1（供 pre-commit / 测试用）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const CLAUDE_DIR = join(SCRIPTS, '..');
const REPO = join(CLAUDE_DIR, '..');

const EXCL = join(CLAUDE_DIR, 'harness', 'exclusions.json');
let entries;
try {
  entries = JSON.parse(readFileSync(EXCL, 'utf8')).entries;
  if (!Array.isArray(entries)) throw new Error('entries is not an array');
} catch (e) {
  // 真相源缺了或坏了：一行人读 + rc 1，不甩 node 栈——这个文件是用户可改的
  process.stderr.write(`gen-exclusions: cannot read ${EXCL}: ${(e && e.code) || (e && e.message) || e}\n`);
  process.exit(1);
}

// mainTree 默认 true：显式 false 的条目（目前只有 state/*）只服务可选包判定，不进下面这三张
// main 树表——它们要么与 main 树无关（harness/ext/* 已经整棵排除，state/* 加不加都一样），要么
// 加进来会是一次未经授权的 main 树行为变更（progress.md TODO #82 的范围只是可选包分支）。
const distEntries = entries.filter((e) => e.mainTree !== false);

// ① bash 臂：keep=true 是白名单（不 continue），顺序照 json
const bashArms = (indent) =>
  distEntries.map((e) => `${indent}${e.pattern})${e.keep ? '' : ' continue'} ;;  # ${e.note}`);

const psTokens = (kind) => distEntries.filter((e) => e.ps1 && e.ps1.kind === kind).map((e) => e.ps1.token);

// ② ps1 数组：单引号逗号拼，超宽换行续行（2 空格缩进）
function psArray(name, tokens) {
  const lines = [];
  let cur = `$${name} = @(`;
  let fresh = true;
  tokens.forEach((t, i) => {
    const item = `'${t}'` + (i === tokens.length - 1 ? ')' : ',');
    if (!fresh && cur.length + 1 + item.length > 108) {
      lines.push(cur);
      cur = '  ';
      fresh = true;
    }
    cur += (fresh ? '' : ' ') + item;
    fresh = false;
  });
  lines.push(cur);
  return lines;
}

// ③ ps1 正则区：kind:'regex' 的 token 按首次出现去重，一条一行
function regexLines() {
  const seen = new Set();
  const out = ['  # runtime state / non-distributed dirs / installer leftovers; notes live in harness/exclusions.json'];
  for (const e of distEntries) {
    if (!e.ps1 || e.ps1.kind !== 'regex' || seen.has(e.ps1.token)) continue;
    seen.add(e.ps1.token);
    out.push(`  if ($relSlash -match '${e.ps1.token}') { return }`);
  }
  return out;
}

// ④ 可选包判定：optionalLeaf===true 的条目才参与，按 ps1.optionalToken（没有就退回 ps1.token）
// 去重——.DS_Store 的 root 与 */嵌套两条 json 记录汇成同一行，state/* 那条 mainTree:false 也在
// 这里现身（它进不了上面三张表，但这里要它）。
const bashOptionalArms = (indent) =>
  entries.filter((e) => e.optionalLeaf).map((e) => `${indent}${e.pattern}) return 0 ;;  # ${e.note}`);

function optionalRegexLines() {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const token = e.optionalLeaf && e.ps1 && (e.ps1.optionalToken || e.ps1.token);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(`  if ($relSlash -match '${token}') { return $true }`);
  }
  return out;
}

const REGIONS = [
  {
    file: join(CLAUDE_DIR, 'scripts', 'gen-manifest.sh'),
    begin: '@exclusions:begin',
    end: '@exclusions:end',
    body: () => bashArms('    '),
  },
  {
    file: join(REPO, 'setup.sh'),
    begin: '@exclusions:begin',
    end: '@exclusions:end',
    body: () => bashArms('      '),
  },
  {
    file: join(REPO, 'setup.ps1'),
    begin: '@exclusions:skip-begin',
    end: '@exclusions:skip-end',
    ascii: true,
    body: () => [...psArray('skip', psTokens('skip')), ...psArray('skipAnyDepth', psTokens('skipAnyDepth'))],
  },
  {
    file: join(REPO, 'setup.ps1'),
    begin: '@exclusions:regex-begin',
    end: '@exclusions:regex-end',
    ascii: true,
    body: regexLines,
  },
  {
    file: join(REPO, 'setup.sh'),
    begin: '@exclusions:optional-begin',
    end: '@exclusions:optional-end',
    body: () => bashOptionalArms('    '),
  },
  {
    file: join(REPO, 'setup.ps1'),
    begin: '@exclusions:optional-begin',
    end: '@exclusions:optional-end',
    ascii: true,
    body: optionalRegexLines,
  },
];

function replaceRegion(lines, region) {
  const b = lines.findIndex((l) => l.includes(region.begin));
  const e = lines.findIndex((l) => l.includes(region.end));
  if (b < 0 || e < 0 || e <= b) {
    throw new Error(`标记区缺失或错位：${relative(REPO, region.file)} ${region.begin}`);
  }
  const body = region.body();
  if (region.ascii) {
    for (const line of body) {
      if (/[^\x00-\x7F]/.test(line)) throw new Error(`ps1 生成内容必须是纯 ASCII：${line}`);
    }
  }
  return [...lines.slice(0, b + 1), ...body, ...lines.slice(e)];
}

const check = process.argv.includes('--check');
const byFile = new Map();
for (const r of REGIONS) {
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(r);
}

let differ = 0;
for (const [file, regions] of byFile) {
  const orig = readFileSync(file, 'utf8');
  const eol = orig.includes('\r\n') ? '\r\n' : '\n';
  let lines = orig.split(/\r?\n/);
  for (const r of regions) lines = replaceRegion(lines, r);
  const next = lines.join(eol);
  if (next === orig) continue;
  if (check) {
    console.log(relative(REPO, file));
    differ = 1;
  } else {
    writeFileSync(file, next);
    console.log(`updated: ${relative(REPO, file)}`);
  }
}
process.exit(check ? differ : 0);
