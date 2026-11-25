#!/usr/bin/env node
// page-shots.mjs —— 让主 Agent 亲眼看生成出来的页面：把一个目录下点名的几页用本机已有的
//   Chrome / Chromium / Edge 打开，按固定高度切成一段一段的 PNG。只截图、不判通过与否，横向溢出只报出来。
// 为什么有它：人读文档出完要真看过首页、分组页、表页，不能拿「核对 0 条」当看过；现成的 ui-audit.mjs 要装
//   playwright，没装只能缺席。这里只用 node 内置的 fetch / WebSocket 走浏览器调试端口（CDP），零 npm 依赖。
// 为什么切段：十几屏高的页整张截下来给模型看会被缩成一条细带，字认不出；一段一千多像素高才读得了。
//
// 用法：node page-shots.mjs <目录> <页面相对路径…> [--out <目录>] [--width 1280] [--segment 1400] [--json]
// 退出码：0 都截了 / 1 有页面失败（导航超过 30 秒、打不开、截图出错），别的页照截 /
//   2 用法不对、目录不在、点名的页面不在或越出了那个目录 /
//   3 看页面缺席：没找到浏览器（或找到了起不来、node 没有内置 WebSocket）——stderr 一行「看页面缺席：……」，
//     一张图都不出。缺席不许冒充看过：没截成的页就是没看过。
// 找浏览器：设了 CHROME_PATH 就只认它；没设依次找 PATH 上的 google-chrome、google-chrome-stable、chromium、
//   chromium-browser、microsoft-edge，Playwright 缓存里的 Chromium，再是 macOS、Windows 的标准安装位置；
//   WSL 里不借 Windows 那一侧的（PATH 上 /mnt/<盘>/ 下的不认）：调试端口跨不过去的情形太多。
// 只读被看的目录（--out 落在它里面算用法不对）。浏览器用临时的用户数据目录，正常结束、出错、Ctrl-C、kill -TERM
//   都连进程组带临时目录一起收掉；脚本自己被强杀时靠多带的那条调试管道——管道这头没了，浏览器自己退。

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAV_MS = 30000;      // 单页导航到 load 事件的上限，超了这一页算失败
const LAUNCH_MS = 60000;   // 浏览器起到调试端口连得上的上限：装好后第一次启动要建缓存，慢机器上不止 20 秒
const SHOT_MS = 30000;     // 单个 CDP 调用（量尺寸、截一段）的上限
const VIEW_H = 900;        // 窗口高度取常见的一屏；切段靠截图的 clip，不靠窗口高度
const MAX_DIR = 62;        // 用户数据目录路径的上限：完整版 Chromium 在里面建套接字，再长一启动就崩（实测 62 行、63 崩）
const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
const CFT = 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PW_EXES = [          // Playwright 缓存里各平台、各代的可执行文件位置，不存在的跳过；完整版在 headless shell 前
  'chrome-linux64/chrome', 'chrome-linux/chrome', `chrome-mac-arm64/${CFT}`, `chrome-mac-x64/${CFT}`, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/headless_shell',
  'chrome-headless-shell-win64/chrome-headless-shell.exe', ...['arm64', 'x64'].map((a) => `chrome-headless-shell-mac-${a}/chrome-headless-shell`)];
const MAC_APPS = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
const WIN_APPS = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe', 'Chromium/Application/chrome.exe'];
const SCRIPT_DIR = import.meta.dirname ?? path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const USAGE = `用法：node page-shots.mjs <目录> <页面相对路径…> [--out <目录>] [--width 1280] [--segment 1400] [--json]
  --out      图落在哪，默认 .claude/evidence/page-shots/（不许落在被看的目录里）
  --width / --segment  窗口宽度、每段图的高度（px），默认 1280 / 1400
  --json     stdout 只打 { engine, pages: [{ page, height, segments, overflowX }] }
退出码：0 都截了 / 1 有页面失败 / 2 用法或目标不对 / 3 看页面缺席（没有可用的浏览器）`;
// 等字体就绪再量；documentElement 的 scrollHeight 至少一屏，所以短页也是一段
const MEASURE = `(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { const d = document.documentElement;
  return { h: Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0), sw: d.scrollWidth, cw: d.clientWidth }; })`;

const die = (code, msg) => { console.error(msg); process.exit(code); };
const usage = (msg) => die(2, `page-shots: ${msg}\n${USAGE}`);
const absent = (why) => `看页面缺席：${why}；本次一张图都没截，未执行不等于看过。`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastLine = (s) => s.trim().split('\n').pop() || '（没有输出）';
const within = (base, p) => { const r = path.relative(base, p); return r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };
const fileUrl = (abs) => `file://${abs.startsWith('/') ? '' : '/'}${abs.split(/[\\/]/)
  .map((s, i) => (i === 0 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/')}`;

function withTimeout(promise, ms, msg) {
  let timer;
  return Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(timer));
}

function parseCli(argv) {
  const o = { out: null, width: '1280', segment: '1400', json: false }, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], m = /^--(out|width|segment)(?:=(.*))?$/s.exec(a);
    if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    if (a === '--json') o.json = true;
    else if (m) { o[m[1]] = m[2] ?? argv[++i]; if (!o[m[1]]) usage(`--${m[1]} 缺值`); }
    else if (a.startsWith('-')) usage(`不认识的参数：${a}`);
    else pos.push(a);
  }
  for (const k of ['width', 'segment']) if (/^[1-9]\d*$/.test(o[k])) o[k] = Number(o[k]); else usage(`--${k} 要正整数，拿到的是「${o[k]}」`);
  if (pos.length === 0) usage('没给目录');
  if (pos.length === 1) usage('没给页面：至少点名一页（相对那个目录的路径）');
  return { ...o, dir: pos[0], pages: pos.slice(1) };
}

// 全部校验在找浏览器之前做完：用法错（2）不该被「没浏览器」（3）盖住
function resolveTargets(cli) {
  const dir = path.resolve(cli.dir);
  let st; try { st = fs.statSync(dir); } catch (e) { usage(`目录不在：${dir}（${e.code}）`); }
  if (!st.isDirectory()) usage(`不是目录：${dir}`);
  const dirReal = fs.realpathSync(dir);
  const pages = cli.pages.map((p) => {
    const abs = path.resolve(dir, p);
    if (abs === dir || !within(dir, abs)) usage(`越出了目录 ${dir}：${p}`);
    let ps; try { ps = fs.statSync(abs); } catch (e) { usage(`页面不在：${p}（${e.code}）`); }
    if (!ps.isFile()) usage(`不是文件：${p}`);
    if (!within(dirReal, fs.realpathSync(abs))) usage(`越出了目录 ${dir}（链接指到了外面）：${p}`);
    return { rel: path.relative(dir, abs).split(path.sep).join('/'), abs };
  });
  const out = path.resolve(cli.out ?? path.join(SCRIPT_DIR, '..', 'evidence', 'page-shots'));
  if (within(dir, out) || within(dirReal, out)) usage(`--out ${out} 落在被看的目录里：这个脚本只读那个目录，换一个 --out`);
  if (fs.existsSync(out) && !fs.statSync(out).isDirectory()) usage(`--out 不是目录：${out}`);
  return { pages, out };
}

function isExe(p) {
  try { return fs.statSync(p).isFile() && (process.platform === 'win32' || (fs.accessSync(p, fs.constants.X_OK), true)); }
  catch (e) { if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(e.code)) return false; throw e; }
}

function playwrightDirs(root) {   // 新版本在前；同一版本完整的 chromium 排在 headless shell 前面
  let names; try { names = fs.readdirSync(root); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []; throw e; }
  const rev = (n) => Number(n.split('-').pop());
  return names.filter((n) => /^chromium(_headless_shell)?-\d+$/.test(n)).sort((a, b) => rev(b) - rev(a) || a.length - b.length);
}

function findBrowser() {
  const env = process.env.CHROME_PATH;
  if (env) return isExe(env) ? { exe: env } : { why: `设了 CHROME_PATH=${env}，但那里没有可执行的浏览器（设了就只认它）` };
  const plat = process.platform, home = os.homedir(), cands = [];
  const binDirs = (process.env.PATH ?? '').split(path.delimiter).filter((d) => d && !(plat === 'linux' && /^\/mnt\/[a-z]\//i.test(d)));
  for (const n of PATH_NAMES) for (const d of binDirs) cands.push(path.join(d, plat === 'win32' ? `${n}.exe` : n));
  const pwRoot = plat === 'darwin' ? path.join(home, 'Library', 'Caches', 'ms-playwright')
    : plat === 'win32' ? path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'ms-playwright')
      : path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'ms-playwright');
  for (const d of playwrightDirs(pwRoot)) for (const rel of PW_EXES) cands.push(path.join(pwRoot, d, rel));
  const std = plat === 'darwin' ? [['/Applications', path.join(home, 'Applications')], MAC_APPS]
    : plat === 'win32' ? [[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA], WIN_APPS] : [[], []];
  for (const base of std[0]) if (base) for (const a of std[1]) cands.push(path.join(base, a));
  const exe = cands.find(isExe);
  if (exe) return { exe };
  return { why: `没设 CHROME_PATH；PATH 上没有 ${PATH_NAMES.join(' / ')}，Playwright 缓存 ${pwRoot} 里没有 Chromium`
    + (std[1].length ? '，标准安装位置也没有' : '') };
}

// ---- 浏览器的生与死：进程与临时用户数据目录记在这里，任何一条退出路径都经 cleanupSync 收掉 ----
const live = { proc: null, userDir: null };
let cleaned = false;

function killBrowser() {
  const { proc } = live;
  if (!proc || proc.pid === undefined) return;
  if (process.platform === 'win32') { if (proc.exitCode === null) spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); return; }
  // detached 起的，浏览器自成一个进程组：连渲染、GPU 等子进程一起杀；进程组已经没了（ESRCH）就是收干净了
  try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') console.error(`page-shots: 收浏览器进程组失败：${e.message}`); }
}

function removeUserDir() {
  if (!live.userDir) return;
  try { fs.rmSync(live.userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); live.userDir = null; }
  catch (e) { console.error(`page-shots: 临时用户数据目录没删掉：${live.userDir}（${e.message}）`); }
}

function cleanupSync() { if (cleaned) return; cleaned = true; killBrowser(); removeUserDir(); }
process.on('exit', cleanupSync);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { console.error(`page-shots: 收到 ${sig}，收掉浏览器后退出`); process.exit(128 + os.constants.signals[sig]); });
}

async function shutdown(cdp) {   // 正常收尾：等浏览器真退了再删目录，免得边删边有进程往里写
  const { proc } = live;
  cdp?.close(); killBrowser();
  if (proc && proc.exitCode === null && proc.signalCode === null) await withTimeout(new Promise((r) => proc.once('exit', r)), 5000,
    '浏览器 5 秒内没退出').catch((e) => console.error(`page-shots: ${e.message}`));
  proc?.stdio.slice(3).forEach((s) => s.destroy());   // 调试管道主动放掉，不让它拖住 node 退出
  cleaned = true; removeUserDir();
}

// 系统临时目录长到建出来的路径会越过 MAX_DIR 时改建在 /tmp 下；/tmp 用不了就照旧建，起不来时缺席那句话点明路径太长
function userDirBase() {
  const base = os.tmpdir();
  if (process.platform === 'win32' || path.join(base, 'page-shots-XXXXXX').length <= MAX_DIR) return base;
  try { fs.accessSync('/tmp', fs.constants.W_OK | fs.constants.X_OK); return fs.statSync('/tmp').isDirectory() ? '/tmp' : base; }
  catch (e) { if (['ENOENT', 'ENOTDIR', 'EACCES', 'EROFS'].includes(e.code)) return base; throw e; }
}

async function launch(exe) {   // 起浏览器，返回调试端口
  live.userDir = fs.mkdtempSync(path.join(userDirBase(), 'page-shots-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-pipe', `--user-data-dir=${live.userDir}`, '--no-first-run',
    '--no-default-browser-check', '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--disable-extensions', 'about:blank'];
  // 浏览器自己在 TMPDIR 下建的单例目录（org.chromium.Chromium.*）也落进临时目录：被 SIGKILL 时不在 /tmp 留尾巴
  const env = { ...process.env, TMPDIR: live.userDir };
  // fd 3、4 是调试管道，CDP 照旧走端口：它只管脚本被强杀时管道一断、浏览器自己退；浏览器往 fd 4 写的读掉扔了，免得写满堵住
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env, detached: process.platform !== 'win32' });
  live.proc = proc;
  for (const s of proc.stdio.slice(3)) s.on('error', (e) => console.error(`page-shots: 调试管道出错：${e.message}`)).resume();
  let tail = '', spawnError = null, last = null;
  proc.stderr.on('data', (d) => { tail = (tail + d).slice(-800); });
  proc.on('error', (e) => { spawnError = e; });
  // 端口 0 让浏览器自己挑空闲端口，写进用户数据目录的 DevToolsActivePort，不会撞端口
  const portFile = path.join(live.userDir, 'DevToolsActivePort');
  for (const end = Date.now() + LAUNCH_MS; Date.now() < end; await sleep(150)) {
    if (spawnError) throw new Error(spawnError.message);
    if (proc.exitCode !== null || proc.signalCode !== null) {
      const n = live.userDir.length, long = n > MAX_DIR ? `；临时目录路径太长（${n} 个字符），把 TMPDIR 设到短路径再试` : '';
      throw new Error(`一启动就退出了（${proc.exitCode ?? proc.signalCode}）：${lastLine(tail)}${long}`);
    }
    try {
      const port = Number.parseInt(fs.readFileSync(portFile, 'utf8'), 10);
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return port;
      last = new Error(`/json/version 回了 ${res.status}`);
    } catch (e) { last = e; }   // 端口文件还没写出来、端口还没开：再等一轮；超时时把最后这个原因带出去
  }
  throw new Error(`${LAUNCH_MS / 1000} 秒内没连上调试端口（${last?.message}）；浏览器最后的输出：${lastLine(tail)}`);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map(), loaded = new Set(), loadWaiters = new Map();
    let seq = 0, closed = null;
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)), p = m.id !== undefined && pending.get(m.id);
      if (p) {
        pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new Error(`${p.method}：${m.error.message}`)); else p.resolve(m.result);
      } else if (m.method === 'Page.lifecycleEvent' && m.params.name === 'load') {
        // 按 loaderId 认是哪一次导航的 load：上一页超时后迟到的 load 不会被当成这一页的
        const w = loadWaiters.get(m.params.loaderId);
        if (w) { loadWaiters.delete(m.params.loaderId); w(); } else loaded.add(m.params.loaderId);
      }
    };
    ws.onclose = () => { closed = new Error('和浏览器的连接断了'); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(closed); } pending.clear(); };
    ws.onerror = (e) => reject(new Error(`连不上页面的调试地址 ${wsUrl}：${e.message ?? e.type}`));
    ws.onopen = () => resolve({
      send: (method, params = {}, ms = SHOT_MS) => (closed ? Promise.reject(closed) : new Promise((res, rej) => {
        const id = ++seq;
        const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method} 超过 ${ms / 1000} 秒没回`)); }, ms);
        pending.set(id, { method, resolve: res, reject: rej, timer });
        ws.send(JSON.stringify({ id, method, params }));
      })),
      waitLoad: (id) => (loaded.delete(id) ? Promise.resolve() : new Promise((res) => loadWaiters.set(id, res))),
      close: () => ws.close(),
    });
  });
}

// 开一个新标签并设好窗口；给了 old 就先关掉它。某页出错后换新标签：脚本死循环的页会卡住它所在的
//   渲染进程，留着那个标签，后面的页一张也打不开
async function openTab(port, width, old) {
  const api = (p, method = 'GET') => fetch(`http://127.0.0.1:${port}/json/${p}`, { method, signal: AbortSignal.timeout(5000) });
  const r = old && (old.close(), await api(`close/${old.id}`).catch((e) => ({ ok: false, status: e.message })));
  if (r && !r.ok) console.error(`page-shots: 关不掉出错的那个标签（${r.status}），换新标签接着截`);
  const t = await (await api('new?about:blank', 'PUT')).json();
  const cdp = Object.assign(await connect(t.webSocketDebuggerUrl), { id: t.id });
  await cdp.send('Page.enable');
  await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
  return cdp;
}

async function shoot(cdp, p, cli, out) {
  const name = p.rel.replaceAll('/', '_');
  // 上一轮同一页留下的段先清掉：这一轮段数少了或这一页失败了，旧图不许混进来冒充这一轮看过
  const stale = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+\\.png$`);
  for (const f of fs.readdirSync(out)) if (stale.test(f)) fs.rmSync(path.join(out, f));
  await withTimeout((async () => {
    const nav = await cdp.send('Page.navigate', { url: fileUrl(p.abs) }, NAV_MS);
    if (nav.errorText) throw new Error(`打不开：${nav.errorText}`);
    await cdp.waitLoad(nav.loaderId);
  })(), NAV_MS, `导航超过 ${NAV_MS / 1000} 秒还没加载完`);
  const ev = await cdp.send('Runtime.evaluate', { expression: MEASURE, awaitPromise: true, returnByValue: true });
  if (ev.exceptionDetails) throw new Error(`量不出页面尺寸：${ev.exceptionDetails.text}`);
  const { h, sw, cw } = ev.result.value, segments = [];
  try {
    for (let y = 0; y < h; y += cli.segment) {
      const clip = { x: 0, y, width: cli.width, height: Math.min(cli.segment, h - y), scale: 1 };
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
      const file = path.join(out, `${name}-${segments.length + 1}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      segments.push(file);
    }
  } catch (e) {
    for (const f of segments) fs.rmSync(f, { force: true });   // 截到一半失败：这一页整页算没看过
    throw new Error(`截第 ${segments.length + 1} 段时出错：${e.message}`);
  }
  return { result: { page: p.rel, height: h, segments, overflowX: sw > cw }, sw, cw };
}

// ---- 主流程 ----
const cli = parseCli(process.argv.slice(2));
const { pages, out } = resolveTargets(cli);
if (typeof WebSocket !== 'function' || typeof fetch !== 'function') die(3, absent(`这个 node（${process.version}）没有内置的 WebSocket / fetch，要 node 22 及以上`));
const found = findBrowser();
if (!found.exe) die(3, absent(found.why));
let port, cdp, broken = null;
try { port = await launch(found.exe); cdp = await openTab(port, cli.width); }
catch (e) { die(3, absent(`找到了 ${found.exe}，但起不来或连不上调试端口：${e.message}`)); }
try { fs.mkdirSync(out, { recursive: true }); } catch (e) { die(2, `page-shots: --out 建不了：${out}（${e.message}）`); }

if (!cli.json) console.log(`浏览器：${found.exe}\n图在：${out}`);
const results = [];
for (const p of pages) {
  try {
    if (broken) throw broken;
    const { result: r, sw, cw } = await shoot(cdp, p, cli, out);
    results.push(r);
    if (!cli.json) console.log(`${r.page}：高 ${r.height}px，切 ${r.segments.length} 段，横向溢出：${r.overflowX ? `有（内容宽 ${sw}px，窗口 ${cw}px）` : '无'}`);
  } catch (e) {
    results.push({ page: p.rel, height: null, segments: [], overflowX: null, error: e.message });
    if (!cli.json) console.log(`${p.rel}：失败——${e.message}`);
    if (!broken) cdp = await openTab(port, cli.width, cdp).catch((e2) => { broken = new Error(`出错之后换不出新标签：${e2.message}`); return null; });
  }
}
await shutdown(cdp);
if (cli.json) console.log(JSON.stringify({ engine: found.exe, pages: results }, null, 2));
process.exitCode = results.some((r) => r.error) ? 1 : 0;
setTimeout(() => process.exit(), 3000).unref();   // 兜底：万一有句柄没放掉，3 秒后照 exitCode 退出
