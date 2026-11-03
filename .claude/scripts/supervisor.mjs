#!/usr/bin/env node
// supervisor.mjs -- dev-time process supervisor (single file, zero npm deps).
// Purpose: resilience for long-running dev services (dev server / worker / db proxy):
// crash -> automatic restart with exponential backoff; restart storms trip a breaker
// instead of looping forever; an optional HTTP health probe restarts a hung-but-alive
// process. State and logs live under .claude/.runtime/supervisor/<id>/ (git-ignored).
// This is a dev harness guardrail, not a production init system -- production stays on
// systemd / k8s / a real orchestrator.
//
// usage:
//   node supervisor.mjs start --id web [--cwd dir] [--health-url http://127.0.0.1:3000/health]
//        [--max-restarts 10] [--window-sec 600] [--backoff-ms 500] -- <command ...>
//   node supervisor.mjs stop --id web
//   node supervisor.mjs status [--id web]
//   node supervisor.mjs logs --id web [--lines 80]
//
// exit codes: 0 ok / 1 error (including a state.json that will not parse) / 3 usage.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
function baseDir() {
  return path.join(projectRoot(), '.claude', '.runtime', 'supervisor');
}
function idDir(id) {
  return path.join(baseDir(), id);
}
function safeId(id) {
  const s = String(id == null ? '' : id).replace(/[^A-Za-z0-9._-]/g, '_');
  return (s === '' || s === '.' || s === '..') ? '' : s;
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let command = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { command = argv.slice(i + 1); break; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--') || next === '--') flags[key] = true;
      else { flags[key] = next; i++; }
    } else positional.push(a);
  }
  return { flags, positional, command };
}

function statePath(id) {
  return path.join(idDir(id), 'state.json');
}
// Three answers, and only two of them used to exist. No file at all means nothing was ever
// started under this id; a file that parses is what is running; a file that exists and will
// not parse is neither, and answering it like the first makes `status` report a service that
// is very possibly alive as dead, `start` launch a second supervisor over a live one, and
// `stop` say there is nothing here to stop.
function readStateResult(id) {
  const fp = statePath(id);
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch (_e) { return { state: null, corrupt: null }; }
  try { return { state: JSON.parse(raw), corrupt: null }; }
  catch (e) { return { state: null, corrupt: { path: fp, detail: String((e && e.message) || e) } }; }
}
function readState(id) {
  return readStateResult(id).state;
}
// Atomic write: a half-written state file would make every later status read lie.
function writeState(id, state) {
  const dir = idDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'state.json.' + process.pid + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, statePath(id));
}
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (_e) { return false; }
}

function logPath(id) {
  return path.join(idDir(id), 'service.log');
}
function rotateIfLarge(file) {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size >= LOG_MAX_BYTES) {
      fs.renameSync(file, file + '.1');   // keep one generation; older history goes
    }
  } catch (_e) { /* rotation failure must not kill the service */ }
}
function logLine(id, msg) {
  const file = logPath(id);
  rotateIfLarge(file);
  try { fs.appendFileSync(file, '[' + new Date().toISOString() + '] [supervisor] ' + msg + '\n', 'utf8'); }
  catch (_e) { /* best effort */ }
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      // Child was spawned detached (own process group): negative pid kills the group.
      try { process.kill(-pid, 'SIGTERM'); } catch (_e) { process.kill(pid, 'SIGTERM'); }
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch (_e) { try { process.kill(pid, 'SIGKILL'); } catch (_e2) { /* gone */ } }
      }, 3000).unref();
    }
  } catch (_e) { /* already gone */ }
}

function probe(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// ---------------------------------------------------------------------------
// __run: the detached supervisor loop (started by `start`, not by hand).
// ---------------------------------------------------------------------------
async function runLoop(flags, command) {
  const id = safeId(flags.id);
  const cwd = typeof flags.cwd === 'string' ? path.resolve(flags.cwd) : projectRoot();
  const maxRestarts = num(flags['max-restarts'], 10);
  const windowSec = num(flags['window-sec'], 600);
  const backoffBase = num(flags['backoff-ms'], 500);
  const healthUrl = typeof flags['health-url'] === 'string' ? flags['health-url'] : null;
  const healthIntervalSec = num(flags['health-interval-sec'], 15);
  const cmdString = command.join(' ');
  const stopFlag = path.join(idDir(id), 'stop.flag');
  const restartTimes = [];
  let child = null;
  let stopping = false;
  let healthFails = 0;

  const state = (patch) => {
    // Fresh identity fields override anything a previous (dead) supervisor left behind;
    // prior state is kept only for fields this write does not own (e.g. startedAt).
    const cur = readState(id) || {};
    writeState(id, {
      ...cur,
      id, cmd: cmdString, cwd, healthUrl,
      supervisorPid: process.pid,
      restarts: restartTimes.length,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  };

  const shutdown = (reason) => {
    if (stopping) return;
    stopping = true;
    logLine(id, 'stopping: ' + reason);
    if (child && child.pid) killTree(child.pid);
    state({ status: 'stopped', childPid: null, stoppedAt: new Date().toISOString(), stopReason: reason });
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const startChild = () => {
    rotateIfLarge(logPath(id));
    const out = fs.openSync(logPath(id), 'a');
    child = spawn(cmdString, {
      cwd, shell: true,
      detached: process.platform !== 'win32',   // own pgid so killTree(-pid) reaps grandchildren
      stdio: ['ignore', out, out],
    });
    fs.closeSync(out);
    healthFails = 0;
    logLine(id, 'started child pid=' + child.pid + ' cmd=' + cmdString);
    state({ status: 'running', childPid: child.pid, startedAt: new Date().toISOString() });

    child.on('exit', (code, signal) => {
      if (stopping) return;
      logLine(id, 'child exited code=' + code + ' signal=' + (signal || 'none'));
      state({ status: 'backoff', childPid: null, lastExit: { code, signal, at: new Date().toISOString() } });
      scheduleRestart('exit code=' + code);
    });
  };

  const scheduleRestart = (why) => {
    const now = Date.now();
    restartTimes.push(now);
    while (restartTimes.length && now - restartTimes[0] > windowSec * 1000) restartTimes.shift();
    if (restartTimes.length > maxRestarts) {
      // Breaker: a restart storm means the fault is not transient. Fail visibly and hold
      // the evidence (log tail) instead of hammering the machine forever.
      logLine(id, 'breaker tripped: ' + restartTimes.length + ' restarts within ' + windowSec + 's -- giving up');
      state({ status: 'crashed', childPid: null, breaker: { restarts: restartTimes.length, windowSec } });
      process.exit(1);
    }
    const delay = Math.min(backoffBase * Math.pow(2, restartTimes.length - 1), 30000);
    logLine(id, 'restart #' + restartTimes.length + ' in ' + delay + 'ms (' + why + ')');
    setTimeout(() => { if (!stopping) startChild(); }, delay);
  };

  // Watch tick: stop-flag polling (cross-platform stop without signal games) + health
  // probe. The interval is deliberately not unref'd -- it keeps the supervisor alive
  // between child restarts.
  let lastProbe = 0;
  setInterval(async () => {
    if (stopping) return;
    if (fs.existsSync(stopFlag)) {
      try { fs.unlinkSync(stopFlag); } catch (_e) { /* ignore */ }
      shutdown('stop.flag');
      return;
    }
    if (healthUrl && child && child.pid && Date.now() - lastProbe >= healthIntervalSec * 1000) {
      lastProbe = Date.now();
      const ok = await probe(healthUrl);
      if (ok) { healthFails = 0; return; }
      healthFails++;
      logLine(id, 'health probe failed (' + healthFails + '/3): ' + healthUrl);
      if (healthFails >= 3) {
        // Alive but not serving is an outage the exit handler never sees: restart it.
        logLine(id, 'health breaker: killing hung child pid=' + child.pid);
        healthFails = 0;
        const pid = child.pid;
        child.removeAllListeners('exit');
        killTree(pid);
        state({ status: 'backoff', childPid: null, lastExit: { code: null, signal: 'health-probe', at: new Date().toISOString() } });
        scheduleRestart('health probe failed 3x');
      }
    }
  }, 1000);

  startChild();
}

function num(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) || n <= 0 ? dflt : n;
}

// ---------------------------------------------------------------------------
// CLI verbs
// ---------------------------------------------------------------------------
function cmdStart(flags, command) {
  const id = safeId(flags.id);
  if (!id) return die('start requires --id <name> (A-Za-z0-9._-)', 3);
  if (!command.length) return die('start requires "-- <command ...>" after the flags', 3);
  const found = readStateResult(id);
  if (found.corrupt) {
    return die('id "' + id + '": ' + rel(found.corrupt.path) + ' will not parse (' + found.corrupt.detail
      + '); refusing to start a second supervisor behind a state.json nobody could read -- one may still be '
      + 'running against it. Check with ps, then repair or remove that file by hand', 1);
  }
  const existing = found.state;
  if (existing && existing.status === 'running' && pidAlive(existing.supervisorPid)) {
    return die('id "' + id + '" is already running (supervisor pid ' + existing.supervisorPid + '); stop it first', 1);
  }
  fs.mkdirSync(idDir(id), { recursive: true });
  try { fs.unlinkSync(path.join(idDir(id), 'stop.flag')); } catch (_e) { /* none */ }
  const args = [SELF, '__run', '--id', id];
  for (const k of ['cwd', 'max-restarts', 'window-sec', 'backoff-ms', 'health-url', 'health-interval-sec']) {
    if (typeof flags[k] === 'string') args.push('--' + k, flags[k]);
  }
  args.push('--', ...command);
  const sup = spawn(process.execPath, args, {
    detached: true, stdio: 'ignore',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot() },
  });
  sup.unref();
  // Confirm liftoff before reporting: "started" with a dead pid is a false green.
  const deadline = Date.now() + 5000;
  const wait = () => {
    const st = readState(id);
    if (st && st.supervisorPid && pidAlive(st.supervisorPid)) {
      emit({ ok: true, id, supervisorPid: st.supervisorPid, childPid: st.childPid || null, status: st.status, log: rel(logPath(id)) });
      return;
    }
    if (Date.now() > deadline) return die('supervisor did not report a live state within 5s; check ' + rel(logPath(id)), 1);
    setTimeout(wait, 150);
  };
  wait();
}

function cmdStop(flags) {
  const id = safeId(flags.id);
  if (!id) return die('stop requires --id <name>', 3);
  const found = readStateResult(id);
  if (found.corrupt) {
    return die('id "' + id + '": ' + rel(found.corrupt.path) + ' is corrupt (' + found.corrupt.detail
      + '); the file is there and unreadable, which is not the same as no such service -- the pids it '
      + 'recorded cannot be read back, so look for a live supervisor by hand before removing it', 1);
  }
  const st = found.state;
  if (!st) return die('no state for id "' + id + '"', 1);
  fs.writeFileSync(path.join(idDir(id), 'stop.flag'), new Date().toISOString() + '\n', 'utf8');
  const supAlive = !!(st.supervisorPid && pidAlive(st.supervisorPid));
  // Windows has no signals: process.kill(pid, 'SIGTERM') is emulated as unconditional
  // termination, so the supervisor's process.on('SIGTERM') never runs, shutdown() never
  // writes status=stopped, and state.json is frozen at "running" while `status` infers
  // "dead" from the pid -- a clean stop reported as an abnormal death. So on win32 send
  // nothing and let the 1s stop-flag tick shut it down; one tick of latency beats a lie.
  // POSIX keeps the signal -- there the handler really runs, and it is the fast path.
  const flagOnly = process.platform === 'win32';
  if (supAlive && !flagOnly) {
    try { process.kill(st.supervisorPid, 'SIGTERM'); } catch (_e) { /* flag will do it */ }
  }
  // A live supervisor reaps its own child inside shutdown(). On the flag-only path it stays
  // up for another tick, so killing the child here would look like a crash to its exit
  // handler and burn a restart before the flag lands. Reap only when nobody else will.
  let reaped = false;
  const reapOrphan = (pid) => { if (!reaped && pid && pidAlive(pid)) { reaped = true; killTree(pid); } };
  if (!(supAlive && flagOnly)) reapOrphan(st.childPid);
  // The flag path spends up to 1s waiting for the next tick plus the 0.5s exit timer before
  // the pid can clear -- that designed floor eats most of the 6s budget on a loaded Windows
  // runner, where taskkill/node spawns are slow too. Signalled path keeps 6s.
  const timeoutMs = flagOnly ? 15000 : 6000;
  const deadline = Date.now() + timeoutMs;
  const wait = () => {
    const cur = readState(id);
    const supGone = !cur || !cur.supervisorPid || !pidAlive(cur.supervisorPid);
    const childGone = !cur || !cur.childPid || !pidAlive(cur.childPid);
    if (supGone && childGone) {
      emit({ ok: true, id, status: 'stopped' });
      return;
    }
    // Supervisor gone with the child still up (kill -9, breaker, crash mid-shutdown): there
    // is no supervisor left to reap it, so stop must, or it leaves an orphan behind.
    if (supGone && !childGone) reapOrphan(cur.childPid);
    if (Date.now() > deadline) return die('stop did not converge within ' + Math.round(timeoutMs / 1000) + 's (supervisor=' + (supGone ? 'gone' : 'alive') + ', child=' + (childGone ? 'gone' : 'alive') + ')', 1);
    setTimeout(wait, 200);
  };
  wait();
}

function cmdStatus(flags) {
  const one = typeof flags.id === 'string' ? safeId(flags.id) : null;
  let ids = [];
  try { ids = fs.readdirSync(baseDir()).filter(n => fs.existsSync(path.join(baseDir(), n, 'state.json'))); }
  catch (e) {
    // ENOENT is the only one that means "nobody has ever started a service here". Anything
    // else -- a mode bit, a file standing where the directory belongs -- leaves every state
    // file inside unreachable, and "services":[] is the same answer a clean machine gives.
    // Read off that, "is everything stopped?" gets a yes nobody checked.
    if (!e || e.code !== 'ENOENT') {
      const detail = String((e && e.message) || e);
      process.stderr.write('status: ' + rel(baseDir()) + ' cannot be listed (' + detail
        + '); the services recorded in it are unknown, not absent\n');
      emit({ ok: false, error: 'state-dir-unreadable', path: rel(baseDir()), detail });
      process.exitCode = 1;
      return;
    }
    ids = [];
  }
  if (one) ids = ids.filter(n => n === one);
  let corrupt = 0;
  const services = ids.map(n => {
    const found = readStateResult(n);
    if (found.corrupt) {
      // "dead" is a claim about a process, read out of a state file. Here the file is what
      // failed, so there is nothing to read the claim out of, and reporting one anyway is a
      // guess wearing the clothes of a reading.
      corrupt++;
      process.stderr.write('status: ' + rel(found.corrupt.path) + ' will not parse (' + found.corrupt.detail
        + '); this service\'s liveness is unknown, not dead\n');
      return { id: n, status: 'corrupt', statePath: rel(found.corrupt.path), detail: found.corrupt.detail, log: rel(logPath(n)) };
    }
    const st = found.state || {};
    const supAlive = pidAlive(st.supervisorPid);
    const childAlive = pidAlive(st.childPid);
    // Recorded state can outlive the processes (power loss, kill -9): report liveness
    // from the pids, not from the last written status.
    const status = st.status === 'stopped' || st.status === 'crashed' ? st.status
      : (supAlive ? (childAlive ? 'running' : (st.status || 'backoff')) : 'dead');
    return {
      id: n, status, supervisorPid: st.supervisorPid || null, supervisorAlive: supAlive,
      childPid: st.childPid || null, childAlive, restarts: st.restarts || 0,
      cmd: st.cmd || null, healthUrl: st.healthUrl || null,
      lastExit: st.lastExit || null, updatedAt: st.updatedAt || null, log: rel(logPath(n)),
    };
  });
  emit({ ok: corrupt === 0, services });
  if (corrupt) process.exitCode = 1;
}

function cmdLogs(flags) {
  const id = safeId(flags.id);
  if (!id) return die('logs requires --id <name>', 3);
  const lines = num(flags.lines, 80);
  let text = '';
  try { text = fs.readFileSync(logPath(id), 'utf8'); } catch (_e) { return die('no log for id "' + id + '"', 1); }
  const tail = text.split('\n').filter(Boolean).slice(-lines);
  process.stdout.write(tail.join('\n') + '\n');
}

function rel(p) {
  return path.relative(projectRoot(), p).replace(/\\/g, '/');
}
function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
function die(msg, code = 1) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code);
}

function usage() {
  return 'usage: node supervisor.mjs <verb>\n' +
    '  start --id <name> [--cwd dir] [--health-url url] [--health-interval-sec 15]\n' +
    '        [--max-restarts 10] [--window-sec 600] [--backoff-ms 500] -- <command ...>\n' +
    '  stop --id <name>\n' +
    '  status [--id <name>]\n' +
    '  logs --id <name> [--lines 80]';
}

const { flags, positional, command } = parseArgs(process.argv.slice(2));
const verb = positional[0] || process.argv[2];
switch (verb) {
  case 'start':  cmdStart(flags, command); break;
  case 'stop':   cmdStop(flags); break;
  case 'status': cmdStatus(flags); break;
  case 'logs':   cmdLogs(flags); break;
  case '__run':  runLoop(flags, command); break;
  default:       die(usage(), 3);
}
