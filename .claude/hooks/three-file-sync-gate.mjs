// Stop hook: 三文件同步铁律恢复侧强制闸——只认 git 工作树实际未提交改动（弃用裸 mtime
//   比较，mtime 在 checkout 1ms 先后下会假阳性）。
// C1：未提交改动里有代码/家底文件（.sh/.ps1/.mjs/.cjs/.ts/.tsx/.js/.jsx/.py/.css/.go/.rs，以及 .claude/
//     下的家底 CLAUDE.md/agents/skills/settings.json 等；排除 .claude/evidence/node_modules/out/
//     dist）且 progress.md 不在改动集 → 拦停提醒同步。
// C2：改动集含 Product-Spec.md 但不含 Product-Spec-CHANGELOG.md（或反之）→ 需求变更漏记。
//     只校验存在的文件——Spec/CHANGELOG 任一不存在则不强造、不拦停（框架本体可无 Spec）。
// 干净树 / 改动已含 progress 或两份成对 / 非 git 仓 / 无 progress.md → 优雅放行。
// 项目根解析：CLAUDE_PROJECT_DIR 优先，缺失回退 git root，再回退 pwd。
// 子目录场景：项目只是父仓子目录时（show-prefix 非空），status 加 -- . 限定项目子树，
//   记录路径先剥 show-prefix 前缀再分类，剥不掉的跳过；项目即仓根时前缀为空、行为不变。
// 设计详述分支（design-detail-sync，档位单列）：项目有 docs/design/*.md 时，未提交改动里有落在某份
//   设计详述文首「> 代码范围：」通配内的文件、而那份设计详述本身不在改动集 → 一条理由（点名文件与
//   设计详述）。设计详述自己不算代码改动。通配写法宽容：反斜杠当 /、去开头 ./ 与末尾 /，不含 * 的
//   条目按目录或文件前缀算。既无 progress.md 又无 docs/design/*.md 的项目一行 git 都不跑、直接放行
//   （旧行为）。与 C1/C2 各取各的档位，两边都有理由时任一边是 block 就整体 block、理由合并，
//   advise 档来源的理由在拦停文案里标「（仅提醒）」。
// 档位（profile.json）：off 静默放行；advise（fast 档）照判照记账但出 systemMessage 不 block；
//   block（standard/strict）走原逻辑。
// advise 档去重（只管 C1/C2 这一边，设计详述分支不去重）：.three-file-sync-advised 记上次提醒的签名
//   与时间，签名 = 判进 C1/C2 的脏文件清单（代码家底 + Spec + CHANGELOG）排序后哈希。同一签名一小时内
//   再 Stop 静默（不出 systemMessage、不写账本）；清单变了、progress.md 动了（C1/C2 无理由即清掉记录）、
//   满时限都再提醒一次。由来：下游两天 86 次提醒、同一文件例子 62 次，没一次被理会。整体要拦停时不去重，
//   拦停文案原样。口径与 stop-gate 共用 lib/advise-dedup.mjs。
// fail-closed：闸自身出错（含 git status 跑不成）绝不静默放行，一律拦停——树没被看过就不能
//   当成「树是干净的」。不读 stdin：判定只来自工作树，喂什么都不影响结论。
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, git, porcelainZ, classifyChange, relToProject, emit, gateModeOf, runFailClosed } from './lib/io.mjs';
import { gateLog } from './lib/gatelog.mjs';
import { listSig, recentlyAdvised, recordAdvised, clearAdvised } from './lib/advise-dedup.mjs';

// 读设计详述文首「> 代码范围：」行里反引号括起的通配，翻成正则：** 跨目录、* 不跨目录、其余字面。
// 先规范化：反斜杠当 /、去开头 ./ 与末尾 /；不含 * 的条目按目录或文件前缀（p 本身或 p/**）。
function globToRe(raw) {
  const g = raw.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  if (!g.includes('*')) return new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&') + '(?:/.*)?$');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

function designDetails(root) {
  const dir = path.join(root, 'docs', 'design');
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort(); } catch (_e) { return []; }
  const out = [];
  for (const n of names) {
    if (!fs.statSync(path.join(dir, n)).isFile()) continue;
    const text = fs.readFileSync(path.join(dir, n), 'utf8');
    const m = /^>\s*代码范围[:：](.*)$/m.exec(text);
    const globs = m ? [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1].trim()).filter((x) => x && !x.includes('{{')) : [];
    out.push({ rel: `docs/design/${n}`, res: globs.map(globToRe) });
  }
  return out;
}

runFailClosed(async () => {
  const mode = await gateModeOf('three-file-sync-gate');
  const ddMode = await gateModeOf('design-detail-sync');
  if (mode === 'off' && ddMode === 'off') return;

  const root = projectDir();
  // 无 progress.md 时 C1/C2 不适用（原行为），设计详述分支不依赖它，照判。
  const c12 = mode !== 'off' && fs.existsSync(path.join(root, 'progress.md'));
  const dds = ddMode !== 'off' ? designDetails(root) : [];
  if (!c12 && dds.length === 0) return;

  // 非 git 仓 → 无工作树可判，优雅放行。
  if (git(['rev-parse', '--is-inside-work-tree'], { cwd: root }).status !== 0) return;

  // porcelain 路径恒相对仓根：项目是父仓子目录时带前缀（如 proj/progress.md），先取 show-prefix 备剥。
  const prefix = git(['rev-parse', '--show-prefix'], { cwd: root }).stdout.replace(/\r?\n$/, '');

  let codeDirty = false;
  let progDirty = false;
  let specDirty = false;
  let changelogDirty = false;
  let firstCode = '';
  const changed = new Set();
  // 判进 C1/C2 的脏文件（代码家底 + Spec + CHANGELOG）：advise 去重的签名就从它算
  const c12Files = [];

  // 剥掉仓根到项目目录的前缀（剥不掉的跳过不分类，-- . 限定后理论上不该有），再把 kind
  // 映射回本闸的四个标志。前缀剥法与分类表都在 io.mjs，precompact-gate 用的是同一份。
  const take = (p) => {
    const rel = relToProject(p, prefix);
    if (rel === null) return;
    changed.add(rel);
    switch (classifyChange(rel)) {
      case 'progress': progDirty = true; break;
      case 'spec': specDirty = true; c12Files.push(rel); break;
      case 'changelog': changelogDirty = true; c12Files.push(rel); break;
      case 'code':
        codeDirty = true;
        c12Files.push(rel);
        if (!firstCode) firstCode = rel;
        break;
      default: break;
    }
  };

  // -z 记录解析（NUL 切、R/C 的 new/old 双记录）在 io.mjs。
  // -- . 限定只看项目子树内改动（cwd 已定到项目目录），仓外无关改动不进改动集。
  // -uall 不能省：未跟踪的新目录默认折叠成一条 `newmod/`，目录名匹配不上扩展名表，整个新模块就逃过了 C2。
  const st = porcelainZ(root, ['-uall', '--', '.']);
  if (st.status !== 0) {
    // git 自己跑不成（索引损坏 / git 不在）= 工作树压根没被看过，放行就是把「没看」当成「干净」
    const head = String(st.stderr || '').split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 2).join(' ').slice(0, 300);
    throw new Error(`git status --porcelain -z 以 ${st.status} 退出：${head || '（无 stderr）'}`);
  }
  for (const p of st.paths) take(p);

  const reasons = [];

  if (c12 && codeDirty && !progDirty) {
    reasons.push(`三文件同步铁律：检测到未提交的代码/家底改动（如 ${firstCode}）但 progress.md 未同步。请把本轮的决策/完成事项/进度/新任务即时写入 progress.md（doc 类主 Agent 直接写），保证随时可 Clear→recap 完整恢复，然后重试停止。`);
  }

  // 成对校验只在两份都存在时进行，缺一不强造、不拦停。
  if (c12 && fs.existsSync(path.join(root, 'Product-Spec.md')) && fs.existsSync(path.join(root, 'Product-Spec-CHANGELOG.md'))) {
    if (specDirty && !changelogDirty) {
      reasons.push('Product-Spec.md 有未提交改动但 Product-Spec-CHANGELOG.md 未同步，需求变更可能漏记 CHANGELOG。请在 Product-Spec-CHANGELOG.md 补本次需求变更记录后重试停止。');
    }
    if (changelogDirty && !specDirty) {
      reasons.push('Product-Spec-CHANGELOG.md 有未提交改动但 Product-Spec.md 未同步，需求变更须成对更新两份文件。请同步 Product-Spec.md 后重试停止。');
    }
  }

  // 设计详述分支：有 docs/design/ 才付代价。命中通配的改动文件 + 设计详述不在改动集 → 一条理由。
  const ddReasons = [];
  if (ddMode !== 'off') {
    for (const d of dds) {
      if (changed.has(d.rel)) continue;
      const hit = [...changed].filter((f) => !f.startsWith('docs/design/') && d.res.some((re) => re.test(f)));
      if (hit.length === 0) continue;
      const names = hit.slice(0, 3).join('、') + (hit.length > 3 ? ` 等 ${hit.length} 个` : '');
      ddReasons.push(`设计详述同步：改动了 ${names}（落在 ${d.rel} 的代码范围内），但 ${d.rel} 未改。请同步规则，或只改了测试就在设计详述里补测试名，然后重试停止。`);
    }
  }

  // 逐边定性：C1/C2 边按 mode，设计详述边按 ddMode；任一边是 block 整体 block，理由合并。
  const blocking = (reasons.length > 0 && mode !== 'advise') || (ddReasons.length > 0 && ddMode === 'block');

  // advise 去重：C1/C2 没理由了（progress 跟上了 / 树干净了）就清记录，下一轮同一清单重现照样提醒；
  // 有理由且整体只是提醒时，同一签名一小时内只说一次。
  const advisedFile = path.join(root, '.claude', '.three-file-sync-advised');
  if (mode === 'advise' && reasons.length === 0) clearAdvised(advisedFile);
  if (mode === 'advise' && reasons.length > 0 && !blocking) {
    const sig = listSig(c12Files);
    if (recentlyAdvised(advisedFile, sig)) reasons.length = 0;
    else recordAdvised(advisedFile, sig);
  }

  if (reasons.length === 0 && ddReasons.length === 0) return;
  // 拦停文案里，来自 advise 档那一边的理由标「（仅提醒）」，别让人以为它也在拦。
  const tag = (list, m) => (blocking && m === 'advise' ? list.map((r) => `（仅提醒）${r}`) : list);
  const reason = [...tag(reasons, mode), ...tag(ddReasons, ddMode)].join(' ');
  // advise 档：同一段话照说、照记账，只是不拦——欠账得看得见。
  // 前缀写 [advise] 不写 [fast]：这条闸任何档都可能只提醒，写死 fast 就是在报一个没人开过的档
  if (!blocking) {
    const msg = `[advise] ${reason}`;
    gateLog('three-file-sync-gate', msg);
    emit({ systemMessage: msg });
    return;
  }
  gateLog('three-file-sync-gate', reason);
  emit({ decision: 'block', reason });
}, 'three-file-sync-gate 自检失败，fail-closed 拦停——请修复闸后重试停止。');
