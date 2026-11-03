#!/usr/bin/env node
// ui-audit.mjs -- 可交互设计稿的 DOM 级审计闸：把「看着还行」换成可核对的证据。
// 用途：对 design-maker 产出的 HTML 设计稿，逐主题 × 宽度真渲染一遍，查横向溢出 /
//   小控件折行 / 文本对比度 / 空白渲染，全页截图落盘；另出一组「套话味」advisory
//   （小号全大写标签、中点分隔、箭头结尾、一律圆角），只提示，不参与 pass 判定。
//
// 用法：
//   node ui-audit.mjs <url|目录> [--themes light,dark] [--widths 1280,900]
//                     [--out .claude/evidence/ui-audit] [--strict] [--json]
//   目录目标就地起一个 loopback 静态服务再渲染；--json 时 stdout 只有报告 JSON，进度走 stderr。
//
// 退出码：0 审计完成 / 1 --strict 且未通过（空白 / 溢出 / 折行 / 对比度）/ 2 用法或目标不对 /
//   3 浏览器引擎缺席——未执行 != 通过，报告里必须写成「缺席」，吞成 0 的闸会永远绿着。
//
// 依赖：playwright-core + 本机 Chrome（channel: chrome），或一次性 npm i playwright。
//   两个包都 require 不到即 rc 3；本脚本自身零 npm 依赖，可单文件拷走跑。

import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const DEFAULT_OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'ui-audit');

const USAGE = [
  '用法：node ui-audit.mjs <url|目录> [--themes light,dark] [--widths 1280,900] [--out <dir>] [--strict] [--json]',
  '  --themes  逐个写进 <html data-theme>，默认 light,dark',
  '  --widths  视口宽度（px），默认 1280,900',
  '  --out     截图与 ui-audit.json 落盘目录，默认 .claude/evidence/ui-audit',
  '  --strict  审计不通过（空白 / 溢出 / 折行 / 对比度）时 rc 1',
  '  --json    stdout 只打报告 JSON，进度与告警走 stderr',
  '退出码：0 完成 / 1 strict 不过 / 2 用法或目标不对 / 3 浏览器引擎缺席',
].join('\n');

function usageExit(message) {
  console.error(message);
  console.error(USAGE);
  process.exit(2);
}

async function resolveModule(pkg) {
  let importError = null;
  try {
    return await import(pkg);
  } catch (error) {
    importError = error;   // 先记着：createRequire 那条路也不通时，两条原因得一起往上抛
  }
  const require = createRequire(join(process.cwd(), 'noop.js'));
  let entry;
  try {
    entry = require.resolve(pkg);
  } catch (error) {
    throw new Error(`${pkg} 解析不到：import ${importError && importError.message ? importError.message : importError}；require.resolve ${error && error.message ? error.message : error}`);
  }
  const mod = await import(pathToFileURL(entry).href);
  return mod.chromium ? mod : mod.default ?? mod;
}

// launch 抛的异常记在这儿：引擎装着却起不来时，「缺席」得说得出原因。包压根不在是另一回事，
//   单独记进 resolveError——混着记会让「装着起不来」的真原因被一句「找不到模块」顶掉。
let launchError = null;
let resolveError = null;

async function loadBrowser() {
  launchError = null;
  resolveError = null;
  for (const pkg of ['playwright-core', 'playwright']) {
    try {
      const mod = await resolveModule(pkg);
      try {
        return { browser: await mod.chromium.launch({ headless: true }), engine: pkg + ':chromium' };
      } catch (first) {
        launchError = first;
        try {
          return { browser: await mod.chromium.launch({ headless: true, channel: 'chrome' }), engine: pkg + ':chrome' };
        } catch (second) {
          launchError = second;
        }
      }
    } catch (error) {
      resolveError = error;   // 这个包解析不到，接着试下一个；一个都不通时它就是「缺席」的原因
    }
  }
  return null;
}

// 软链是到 readFile 那步才被跟随的，路径前缀怎么看都还在 root 里，所以比之前先各自问一次真身。
function realOr(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;   // 问不出真身就是不存在，按 404 处理
  }
}

// 设计稿是生成出来的第三方内容，服务目录之外的文件一律不端出来：解码、跟完软链之后仍落在 root 之内才放行。
export async function serveDir(dir) {
  const root = realOr(resolve(dir)) ?? resolve(dir);   // 服务根自己也可能在软链下（/tmp 常是），先钉成真身
  const server = createServer(async (req, res) => {
    let path = null;
    try {
      const pathname = decodeURIComponent(req.url.split('?')[0]);
      path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    } catch {
      path = null;   // 百分号编码坏了，按不存在处理
    }
    const real = path ? realOr(path) : null;
    if (!real || (real !== root && !real.startsWith(root + sep))) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    try {
      const body = await readFile(real);
      res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

// 浏览器里跑：溢出 / 折行 / 对比度 / 空白 四项判定 + genericTells 一组 advisory。
const PAGE_AUDIT = () => {
  const issues = { overflows: [], wrapped: [], contrastFails: [] };
  const tells = { upperTinyLabels: 0, midDotTexts: 0, arrowEndings: 0, radiusValues: 0, uniformRadius: false };
  const doc = document.documentElement;
  const radii = new Set();
  let radiusEls = 0;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > doc.clientWidth + 2) {
      let clipped = false;
      let a = el.parentElement;
      while (a && a !== document.body) {
        const cs = getComputedStyle(a);
        if (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowX === 'auto' || cs.overflowX === 'scroll') { clipped = true; break; }
        a = a.parentElement;
      }
      if (!clipped && issues.overflows.length < 12) {
        issues.overflows.push({ cls: String(el.className).slice(0, 50), over: Math.round(r.right - doc.clientWidth) });
      }
    }
    const cs = getComputedStyle(el);
    const radius = cs.borderRadius;
    if (radius && radius !== '0px' && radius !== '0%') { radii.add(radius); radiusEls += 1; }
    if (!el.children.length && cs.textTransform === 'uppercase' && parseFloat(cs.fontSize) <= 12) {
      const label = (el.textContent || '').trim();
      if (label.length > 0 && label.length <= 24) tells.upperTinyLabels += 1;
    }
  }
  for (const el of document.querySelectorAll('button, [class*="btn"], [class*="tab"], [class*="seg"] > *, [class*="chip"], [class*="pill"]')) {
    const text = (el.textContent || '').trim();
    if (el.offsetHeight > 44 && text.length > 0 && text.length <= 8 && issues.wrapped.length < 8) {
      issues.wrapped.push({ cls: String(el.className).slice(0, 50), h: el.offsetHeight, text: text.slice(0, 10) });
    }
  }
  const lum = (c) => {
    const m = c.match(/\d+(\.\d+)?/g);
    if (!m) return null;
    const [r, g, b] = m.slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && !bg.startsWith('rgba(0, 0, 0, 0)') && bg !== 'transparent') return bg;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  let sampled = 0;
  for (const el of document.querySelectorAll('p, span, li, td, th, label, h1, h2, h3, button, a, div')) {
    if (sampled >= 200 || issues.contrastFails.length >= 10) break;
    if (!el.childNodes.length || el.children.length) continue;
    const text = (el.textContent || '').trim();
    if (text.length < 2) continue;
    sampled += 1;
    const cs = getComputedStyle(el);
    const fg = lum(cs.color);
    const bg = lum(bgOf(el));
    if (fg === null || bg === null) continue;
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 600;
    const threshold = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < threshold) {
      issues.contrastFails.push({ cls: String(el.className).slice(0, 40), text: text.slice(0, 14), ratio: Math.round(ratio * 100) / 100 });
    }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if ((walker.currentNode.nodeValue || '').includes(' · ')) tells.midDotTexts += 1;
  }
  for (const el of document.querySelectorAll('button, a, [role="button"]')) {
    if ((el.textContent || '').trim().endsWith('→')) tells.arrowEndings += 1;
  }
  tells.radiusValues = radii.size;
  tells.uniformRadius = radii.size === 1 && radiusEls > 20;
  return {
    ...issues,
    genericTells: tells,
    elementCount: document.querySelectorAll('body *').length,
    textLength: (document.body.innerText || '').length,
  };
};

function tellsLine(t) {
  const parts = [];
  if (t.upperTinyLabels) parts.push(`小号全大写×${t.upperTinyLabels}`);
  if (t.midDotTexts) parts.push(`中点分隔×${t.midDotTexts}`);
  if (t.arrowEndings) parts.push(`箭头结尾×${t.arrowEndings}`);
  if (t.uniformRadius) parts.push(`一律圆角（圆角值仅 ${t.radiusValues} 种）`);
  else if (t.radiusValues) parts.push(`圆角值 ${t.radiusValues} 种`);
  return parts.length ? parts.join(' / ') : '无';
}

// 缺席不许把上一轮的旧报告留在那儿当通过：报告在就覆写成「没跑」；不在就什么都不建，rc 2 / 3 都不落盘新目录。
// 覆写失败（同名目录占着 / 目录不可写）只是写盘小事故，不许顶掉「缺席」这条结论：警告一句，退出码照旧走 3。
async function markAbsent(outDir, target, reason) {
  const reportPath = join(outDir, 'ui-audit.json');
  try {
    if (!(await stat(reportPath).catch(() => null))) return;
    const report = {
      absent: true,
      pass: false,
      at: new Date().toISOString(),
      target,
      reason: reason ? String(reason.message || reason) : '未找到可用浏览器引擎',
      screenshots: [],   // 下游数张数的那个字段，缺席就是零张，不留上一轮那批让人误读
    };
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    console.error(`缺席报告写入失败：${error && error.message ? error.message : error}`);
  }
}

// 严格解析崩了的时候 values 还不可知，可「审计没跑」这条结论总得落到某个目录上：--out X 与 --out=X
//   两种写法都先粗扫一遍，扫不到就是默认目录。写重复了取末位——parseArgs 也是末位胜，
//   预扫跟它看的不是同一个目录，作废就作废错了人。target 只是写进报告备查，扫不准不影响作废。
const VALUE_FLAGS = new Set(['--themes', '--widths', '--out']);
function prescanArgs(argv) {
  let out = null;
  let target = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--out=')) {
      const eqValue = arg.slice('--out='.length);
      if (!eqValue.startsWith('-')) out = eqValue;   // --out=--strict / --out=-x 等号右边蹲的是开关不是目录名，留 null 落回默认目录
    } else if (VALUE_FLAGS.has(arg)) {
      const next = argv[i + 1];
      const missing = next === undefined || next.startsWith('-');   // 值位上以 - 开头的一律缺值，单横线双横线不分家，不是把 --strict / -x 当目录名
      if (arg === '--out' && !missing) out = next;
      if (!missing) i += 1;   // 跳过它的值，别把值当成目标
    } else if (!target && !arg.startsWith('-')) {
      target = arg;
    }
  }
  return { out, target };
}

// 崩在半路时 catch 里还要作废旧报告，outDir 与 target 得留在 main 外面够得着的地方。
let outDirForExit = null;
let targetForExit = '';

async function main() {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        themes: { type: 'string', default: 'light,dark' },
        widths: { type: 'string', default: '1280,900' },
        out: { type: 'string', default: DEFAULT_OUT },
        strict: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    // 参数这一关没过，审计同样没跑：--out 从 argv 里预扫出来，旧报告照样作废，不留上一轮的 pass:true。
    const why = String(error && error.message ? error.message : error);
    const scan = prescanArgs(process.argv.slice(2));
    outDirForExit = resolve(scan.out && scan.out.trim() ? scan.out : DEFAULT_OUT);   // 空目录名不算数，别落到 cwd
    targetForExit = scan.target;
    await markAbsent(outDirForExit, scan.target, '参数解析失败：' + why);
    usageExit(why);
  }
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  // --out= / --out "" 给的是空目录名：往哪写谁也说不清，跟 --themes 空项一样按坏值算，作废退回默认目录。
  // --out --strict / --out=-x 是一路货：值以 - 开头给的是开关不是目录名，同样按缺值算。
  // 本机 node 24 遇上 --out --strict 直接抛「ambiguous」走上面的解析失败通道，这一支留给不抛的旧版 node 兜底。
  const emptyOut = !values.out.trim();
  const flagOut = values.out.startsWith('-');
  const outDir = resolve(emptyOut || flagOut ? DEFAULT_OUT : values.out);   // 先解析：下面每个没跑完的出口都拿它作废旧报告
  outDirForExit = outDir;
  const target = positionals[0];
  targetForExit = target ?? '';
  if (flagOut) {
    await markAbsent(outDir, targetForExit, `--out 缺少目录名：${values.out}`);
    usageExit('--out 缺少目录名');
  }
  if (emptyOut) {
    await markAbsent(outDir, targetForExit, '--out 是空目录名');
    usageExit('--out 不能是空目录名');
  }
  if (!target) {
    await markAbsent(outDir, targetForExit, '缺少目标：URL 或设计稿目录');
    usageExit('缺少目标：URL 或设计稿目录');
  }
  // 坏值一律算「没跑」：以前 filter 先把 NaN 和空项滤掉、剩下的照跑，跑出来的报告名不副实。判要判在滤之前，逐个原始项过。
  const themes = values.themes.split(',').map((s) => s.trim());
  const widthItems = values.widths.split(',').map((s) => s.trim());
  const badTheme = themes.find((s) => !s);
  const badWidth = widthItems.find((s) => !(Number.isFinite(Number(s)) && Number(s) > 0));
  if (badTheme !== undefined || badWidth !== undefined) {
    const why = badTheme !== undefined
      ? `--themes 有空项：${values.themes}`
      : `--widths 不是正数：${badWidth || '(空)'}`;
    await markAbsent(outDir, target, why);
    usageExit(why);
  }
  const widths = widthItems.map(Number);
  const say = values.json ? console.error : console.log;

  let staticServer = null;
  let url = target;
  if (!/^https?:/.test(target)) {
    const dir = resolve(target);
    const info = await stat(dir).catch(() => null);
    if (!info || !info.isDirectory()) {
      // 目标无效同样是「审计没跑」：--out 这时已解析出来，旧报告在就覆写成缺席，不留 pass:true 冒充通过。
      await markAbsent(outDir, target, `目标既不是 URL 也不是目录：${target}`);
      usageExit(`目标既不是 URL 也不是目录：${target}`);
    }
    staticServer = await serveDir(dir);
    url = staticServer.url;
  }

  const engine = await loadBrowser();
  if (!engine) {
    console.error('未找到可用浏览器引擎：装 playwright-core 并具备本机 Chrome，或一次性 npm i playwright；本次 UI 审计缺席，请在报告注明（未执行 != 通过）。');
    const why = launchError || resolveError;   // 装着起不来的原因优先，包压根不在才退而说解析报的错
    if (why) console.error(`原因：${why.message || why}`);
    if (staticServer) staticServer.server.close();
    await markAbsent(outDir, target, why);
    process.exit(3);
  }

  await mkdir(outDir, { recursive: true });
  const combos = [];
  const shots = [];
  const page = await engine.browser.newPage();
  for (const width of widths) {
    for (const theme of themes) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(400);
      const audit = await page.evaluate(PAGE_AUDIT);
      const shot = join(outDir, `${theme}-${width}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      shots.push(shot);
      const blank = audit.elementCount < 5 || audit.textLength < 10;
      combos.push({ theme, width, blank, ...audit });
      const flags = [];
      if (blank) flags.push('空白渲染');
      if (audit.overflows.length) flags.push(`溢出×${audit.overflows.length}`);
      if (audit.wrapped.length) flags.push(`折行×${audit.wrapped.length}`);
      if (audit.contrastFails.length) flags.push(`对比度×${audit.contrastFails.length}`);
      say(`[${theme} ${width}px] ${flags.length ? flags.join(' · ') : '干净'} · 套话味 ${tellsLine(audit.genericTells)}`);
    }
  }
  await engine.browser.close();
  if (staticServer) staticServer.server.close();

  const pass = combos.every((c) => !c.blank && !c.overflows.length && !c.wrapped.length && !c.contrastFails.length);
  const report = { target, engine: engine.engine, themes, widths, combos, screenshots: shots, pass, at: new Date().toISOString() };
  const reportPath = join(outDir, 'ui-audit.json');
  const body = JSON.stringify(report, null, 2) + '\n';
  await writeFile(reportPath, body);
  if (values.json) process.stdout.write(body);
  say(`报告：${reportPath}（截图 ${shots.length} 张）`);
  if (values.strict && !pass) {
    console.error('UI 审计未通过：存在空白渲染 / 溢出 / 折行 / 对比度不足。');
    process.exit(1);
  }
}

// 被 import 时只取导出（U8 探针单拿 serveDir），只有直接 node 跑这份文件才走 main。
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  const abs = resolve(entry);
  const self = fileURLToPath(import.meta.url);
  if (abs === self) return true;
  try {
    return realpathSync(abs) === realpathSync(self);   // /tmp 之类是软链时也认得出
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch(async (error) => {
    console.error(String(error && error.stack ? error.stack : error));
    // 跑到一半崩同样是「审计没跑完」：--out 已经解析出来就把旧报告作废，不留上一轮的 pass:true。
    if (outDirForExit) await markAbsent(outDirForExit, targetForExit, '运行中崩溃：' + (error && error.message ? error.message : error));
    process.exit(2);
  });
}
