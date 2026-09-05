// Development service supervision: crash restart with backoff, restart-storm breaker, health
// probes, and liveness synthesized from pids.

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { relative, resolve } from "node:path";
import { STATE_REL, isWithin, posix, printJson, readJson, targetFrom, whichCommand, writeJson } from "./core.mjs";
import type { CliOptions } from "./core.mjs";
import { parseShellCommand } from "./shell-policy.mjs";

// ============================== Service supervision ==============================
// A development-time guardian for long-running services: crash restart with exponential
// backoff, a restart-storm breaker that fails visibly instead of hammering the machine, and an
// optional health probe because a process that is alive but not serving is still an outage.
// It supervises only processes it started itself, and it is not a production init system.

export const SERVICES_CONFIG_REL = "harness/services.json";

export const SERVICES_STATE_REL = `${STATE_REL}/services`;

export interface ServiceHealth {
  url: string;
  intervalSec: number;
  timeoutMs: number;
  failureThreshold: number;
}

export interface ServiceRestart {
  backoffMs: number;
  maxBackoffMs: number;
  maxRestarts: number;
  windowSec: number;
}

export interface ServiceDefinition {
  command: string;
  cwd: string;
  env: Record<string, string>;
  health: ServiceHealth | null;
  restart: ServiceRestart;
}

export const SERVICE_RESTART_DEFAULTS: ServiceRestart = {
  backoffMs: 500,
  maxBackoffMs: 30_000,
  maxRestarts: 10,
  windowSec: 600,
};

export const SERVICE_LOG_MAX_BYTES = 5 * 1024 * 1024;

export const SERVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function positiveNumber(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number.`);
  return parsed;
}

// Config errors fail at load, not at restart number seven. A supervisor that starts under a
// misread config enforces a policy nobody wrote.
export function servicesConfig(root: string): Record<string, ServiceDefinition> {
  const path = resolve(root, SERVICES_CONFIG_REL);
  if (!existsSync(path)) return {};
  const value = readJson(path);
  if (value?.version !== 1 || typeof value.services !== "object" || value.services === null) {
    throw new Error(`${SERVICES_CONFIG_REL} must declare version 1 and a services object.`);
  }
  const services: Record<string, ServiceDefinition> = {};
  for (const [name, raw] of Object.entries<any>(value.services)) {
    if (!SERVICE_NAME_PATTERN.test(name)) {
      throw new Error(`Service name ${JSON.stringify(name)} must match ${SERVICE_NAME_PATTERN}.`);
    }
    if (!raw || typeof raw.command !== "string" || !raw.command.trim()) {
      throw new Error(`Service ${name} needs a non-empty command string.`);
    }
    const cwd = resolve(root, String(raw.cwd || "."));
    if (!isWithin(root, cwd)) {
      throw new Error(`Service ${name} cwd escapes the repository.`);
    }
    let health: ServiceHealth | null = null;
    if (raw.health) {
      const url = String(raw.health.url || "");
      if (!/^https?:\/\//.test(url)) {
        throw new Error(`Service ${name} health.url must be an http(s) URL.`);
      }
      health = {
        url,
        intervalSec: positiveNumber(raw.health.intervalSec, 15, `${name} health.intervalSec`),
        timeoutMs: positiveNumber(raw.health.timeoutMs, 4_000, `${name} health.timeoutMs`),
        failureThreshold: positiveNumber(raw.health.failureThreshold, 3, `${name} health.failureThreshold`),
      };
    }
    services[name] = {
      command: raw.command.trim(),
      cwd,
      env: typeof raw.env === "object" && raw.env !== null ? raw.env : {},
      health,
      restart: {
        backoffMs: positiveNumber(raw.restart?.backoffMs, SERVICE_RESTART_DEFAULTS.backoffMs, `${name} restart.backoffMs`),
        maxBackoffMs: positiveNumber(raw.restart?.maxBackoffMs, SERVICE_RESTART_DEFAULTS.maxBackoffMs, `${name} restart.maxBackoffMs`),
        maxRestarts: positiveNumber(raw.restart?.maxRestarts, SERVICE_RESTART_DEFAULTS.maxRestarts, `${name} restart.maxRestarts`),
        windowSec: positiveNumber(raw.restart?.windowSec, SERVICE_RESTART_DEFAULTS.windowSec, `${name} restart.windowSec`),
      },
    };
  }
  return services;
}

export type ServiceLifecycle = "running" | "backoff" | "crashed" | "stopped";

export interface ServiceState {
  version: 1;
  name: string;
  status: ServiceLifecycle;
  supervisor_pid: number | null;
  child_pid: number | null;
  restarts: number;
  restart_times: number[];
  last_exit: { code: number | null; signal: string | null; at: string } | null;
  health_failures: number;
  started_at: string;
  updated_at: string;
}

export function serviceDir(root: string, name: string): string {
  return resolve(root, SERVICES_STATE_REL, name);
}

export function readServiceState(root: string, name: string): ServiceState | null {
  const path = resolve(serviceDir(root, name), "state.json");
  if (!existsSync(path)) return null;
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

export function pidAlive(pid: number | null): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else, which still counts as alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Kills the process group so `npm run dev` does not leave its node grandchildren orphaned.
// Only pids recorded in the supervisor's own state ever reach this function.
export function killTree(pid: number, force = false): void {
  if (!pidAlive(pid)) return;
  if (process.platform === "win32") {
    // A console process cannot be terminated politely by taskkill, so the forced tree kill
    // follows the polite attempt immediately; there is no signal to hand over on this host.
    if (!force) spawnSync("taskkill", ["/PID", String(pid), "/T"], { windowsHide: true });
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

// Recorded state can outlive the processes (power loss, kill -9). Liveness is therefore
// reported from the pids, never from the last written status field.
export function synthesizeServiceStatus(state: ServiceState | null): {
  status: ServiceLifecycle | "dead" | "not-started";
  supervisor_alive: boolean;
  child_alive: boolean;
} {
  if (!state) return { status: "not-started", supervisor_alive: false, child_alive: false };
  const supervisorAlive = pidAlive(state.supervisor_pid);
  const childAlive = pidAlive(state.child_pid);
  if (state.status === "stopped" || state.status === "crashed") {
    return { status: state.status, supervisor_alive: supervisorAlive, child_alive: childAlive };
  }
  if (!supervisorAlive) return { status: "dead", supervisor_alive: false, child_alive: childAlive };
  return {
    status: childAlive ? "running" : "backoff",
    supervisor_alive: true,
    child_alive: childAlive,
  };
}

export function appendServiceLog(root: string, name: string, text: string): void {
  const dir = serviceDir(root, name);
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, "service.log");
  try {
    if (existsSync(path) && statSync(path).size >= SERVICE_LOG_MAX_BYTES) {
      renameSync(path, `${path}.1`);
    }
  } catch {
    // A failed rotation must never kill the service or lose the current line.
  }
  appendFileSync(path, text, "utf8");
}

export function supervisorLog(root: string, name: string, message: string): void {
  appendServiceLog(root, name, `[supervisor ${new Date().toISOString()}] ${message}\n`);
}

export function probeHealth(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const get = url.startsWith("https:") ? httpsGet : httpGet;
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolvePromise(value);
      }
    };
    try {
      const request = get(url, { timeout: timeoutMs }, (response) => {
        response.resume();
        finish((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 400);
      });
      request.on("timeout", () => {
        request.destroy();
        finish(false);
      });
      request.on("error", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

export async function serviceSupervise(root: string, name: string): Promise<void> {
  const definition = servicesConfig(root)[name];
  if (!definition) throw new Error(`Service ${name} is not defined in ${SERVICES_CONFIG_REL}.`);
  const dir = serviceDir(root, name);
  mkdirSync(dir, { recursive: true });
  const statePath = resolve(dir, "state.json");
  const stopFlag = resolve(dir, "stop.flag");

  const existing = readServiceState(root, name);
  if (existing && pidAlive(existing.supervisor_pid) && existing.supervisor_pid !== process.pid) {
    throw new Error(`Another supervisor (pid ${existing.supervisor_pid}) already owns ${name}.`);
  }

  const state: ServiceState = {
    version: 1,
    name,
    status: "running",
    supervisor_pid: process.pid,
    child_pid: null,
    restarts: 0,
    restart_times: [],
    last_exit: null,
    health_failures: 0,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const save = () => {
    state.updated_at = new Date().toISOString();
    writeJson(statePath, state);
  };

  let child: ReturnType<typeof spawn> | null = null;
  let stopping = false;
  let restartTimer: NodeJS.Timeout | null = null;

  const startChild = () => {
    // A command that is one program with arguments is spawned directly, so the recorded pid is
    // the service itself. Through a shell the pid would be `cmd.exe` or `sh`, and on Windows
    // killing that pid alone leaves the real process running with the repository as its cwd.
    // Pipelines, chains, and substitutions still need the shell.
    const parsed = parseShellCommand(definition.command);
    const program = parsed.segments.length === 1 && !parsed.dynamic ? parsed.segments[0].rawTokens[0] : undefined;
    const resolved = program ? whichCommand(program) : null;
    // `.cmd`/`.bat` wrappers (npm, npx, yarn on Windows) cannot be spawned without a shell.
    const direct = Boolean(resolved) && !/\.(cmd|bat)$/i.test(resolved ?? "");
    const options = {
      cwd: definition.cwd,
      // Its own process group on POSIX, so the whole tree can be terminated together.
      detached: process.platform !== "win32",
      env: { ...process.env, ...definition.env },
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
      windowsHide: true,
    };
    const spawned = direct
      ? spawn(resolved as string, parsed.segments[0].rawTokens.slice(1), options)
      : spawn(definition.command, { ...options, shell: true });
    // A spawn failure (ENOENT, EACCES) surfaces as an error event; without a listener it would
    // take the supervisor down with an uncaught exception instead of counting as a crash.
    spawned.on("error", (error) => {
      supervisorLog(root, name, `child failed to start: ${error.message}`);
      if (child === spawned && !spawned.pid) spawned.emit("exit", null, null);
    });
    child = spawned;
    state.child_pid = spawned.pid ?? null;
    state.status = "running";
    state.health_failures = 0;
    save();
    supervisorLog(root, name, `started child pid ${spawned.pid}: ${definition.command}`);
    spawned.stdout?.on("data", (chunk: Buffer) => appendServiceLog(root, name, chunk.toString("utf8")));
    spawned.stderr?.on("data", (chunk: Buffer) => appendServiceLog(root, name, chunk.toString("utf8")));
    spawned.on("exit", (code, signal) => {
      if (child !== spawned) return;
      child = null;
      state.child_pid = null;
      state.last_exit = { code, signal: signal ?? null, at: new Date().toISOString() };
      if (stopping) return;
      supervisorLog(root, name, `child exited (code ${code}, signal ${signal ?? "none"})`);
      scheduleRestart();
    });
  };

  const scheduleRestart = () => {
    const now = Date.now();
    const windowStart = now - definition.restart.windowSec * 1000;
    state.restart_times = [...state.restart_times.filter((at) => at >= windowStart), now];
    state.restarts += 1;
    // A restart storm means the fault is not transient. Failing visibly and keeping the
    // evidence beats hammering the machine forever while the log rotates the cause away.
    if (state.restart_times.length > definition.restart.maxRestarts) {
      state.status = "crashed";
      save();
      supervisorLog(
        root,
        name,
        `breaker tripped: ${state.restart_times.length} restarts inside ${definition.restart.windowSec}s; giving up.`,
      );
      process.exit(1);
    }
    const attempt = state.restart_times.length;
    const delay = Math.min(
      definition.restart.backoffMs * 2 ** Math.max(attempt - 1, 0),
      definition.restart.maxBackoffMs,
    );
    state.status = "backoff";
    save();
    supervisorLog(root, name, `restarting in ${delay}ms (attempt ${attempt} in window)`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!stopping) startChild();
    }, delay);
  };

  const shutdown = (reason: string) => {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    supervisorLog(root, name, `stopping: ${reason}`);
    const pid = child?.pid;
    if (pid) {
      killTree(pid);
      setTimeout(() => killTree(pid, true), 3_000).unref();
    }
    state.status = "stopped";
    state.child_pid = null;
    save();
    rmSync(stopFlag, { force: true });
    // Give the tree the grace period before the supervisor itself exits.
    setTimeout(() => process.exit(0), pid ? 3_500 : 0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  let lastProbe = 0;
  // The tick is deliberately not unref'd: it is also what keeps the supervisor alive between a
  // child crash and the delayed restart.
  setInterval(() => {
    if (stopping) return;
    if (existsSync(stopFlag)) {
      shutdown("stop flag");
      return;
    }
    const health = definition.health;
    if (!health || !child || state.status !== "running") return;
    const now = Date.now();
    if (now - lastProbe < health.intervalSec * 1000) return;
    lastProbe = now;
    void probeHealth(health.url, health.timeoutMs).then((healthy) => {
      if (stopping || !child) return;
      if (healthy) {
        if (state.health_failures > 0) {
          state.health_failures = 0;
          save();
        }
        return;
      }
      state.health_failures += 1;
      save();
      supervisorLog(root, name, `health probe failed (${state.health_failures}/${health.failureThreshold}): ${health.url}`);
      // Alive but not serving is an outage the exit handler never sees. Kill the tree and go
      // through the same backoff-and-breaker path as a crash.
      if (state.health_failures >= health.failureThreshold) {
        const failing = child;
        child = null;
        state.child_pid = null;
        state.last_exit = { code: null, signal: "health-probe", at: new Date().toISOString() };
        supervisorLog(root, name, "health probe threshold reached; restarting the child.");
        if (failing?.pid) {
          failing.removeAllListeners("exit");
          killTree(failing.pid);
          setTimeout(() => failing.pid && killTree(failing.pid, true), 3_000).unref();
        }
        scheduleRestart();
      }
    });
  }, 1_000);

  rmSync(stopFlag, { force: true });
  startChild();
  // The returned promise never settles; the supervisor leaves through process.exit only.
  return new Promise<never>(() => {});
}

export async function serviceStart(root: string, name: string): Promise<void> {
  const definition = servicesConfig(root)[name];
  if (!definition) throw new Error(`Service ${name} is not defined in ${SERVICES_CONFIG_REL}.`);
  const current = readServiceState(root, name);
  if (current && pidAlive(current.supervisor_pid)) {
    throw new Error(`Service ${name} is already supervised (pid ${current.supervisor_pid}). Stop it first.`);
  }
  const dir = serviceDir(root, name);
  mkdirSync(dir, { recursive: true });
  rmSync(resolve(dir, "stop.flag"), { force: true });

  const entry = process.argv[1];
  const supervisor = spawn(process.execPath, [entry, "service", "supervise", name, "--target", root], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  supervisor.unref();

  // "Started" with a dead pid is a false green. Success is reported only after the supervisor
  // has written a state file and its pid answers a liveness check.
  const deadline = Date.now() + 5_000;
  let observed: ServiceState | null = null;
  while (Date.now() < deadline) {
    observed = readServiceState(root, name);
    if (observed && observed.supervisor_pid && pidAlive(observed.supervisor_pid)) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  if (!observed || !pidAlive(observed.supervisor_pid)) {
    throw new Error(
      `Service ${name} did not confirm liftoff within 5s. Inspect ${posix(relative(root, resolve(dir, "service.log")))}.`,
    );
  }
  printJson({
    command: "service start",
    name,
    ok: true,
    supervisor_pid: observed.supervisor_pid,
    child_pid: observed.child_pid,
    status: observed.status,
    log: posix(relative(root, resolve(dir, "service.log"))),
  });
}

export async function serviceStop(root: string, name: string): Promise<void> {
  const state = readServiceState(root, name);
  if (!state) throw new Error(`Service ${name} has no recorded state.`);
  const dir = serviceDir(root, name);
  writeFileSync(resolve(dir, "stop.flag"), new Date().toISOString(), "utf8");
  // The supervisor owns the child tree and knows its current pid; it is asked to shut down and
  // given time to do so. On POSIX SIGTERM reaches its handler. On Windows `process.kill` is
  // TerminateProcess, which skips the handler and would orphan the child, so the stop flag it
  // polls every second is the only graceful channel there.
  if (process.platform !== "win32" && pidAlive(state.supervisor_pid)) {
    try {
      process.kill(state.supervisor_pid as number, "SIGTERM");
    } catch {
      // The stop flag remains the fallback channel.
    }
  }
  const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
  const graceDeadline = Date.now() + 6_000;
  while (pidAlive(state.supervisor_pid) && Date.now() < graceDeadline) await sleep(150);

  // A supervisor that ignored the request is terminated, and whatever child its last state
  // named is killed as a tree. This is the escalation path, not the normal one.
  if (pidAlive(state.supervisor_pid)) {
    const latest = readServiceState(root, name);
    for (const pid of new Set([latest?.child_pid, state.child_pid])) if (pid) killTree(pid, true);
    try {
      process.kill(state.supervisor_pid as number);
    } catch {
      // Already gone.
    }
  }
  // Whatever the supervisor recorded last is checked too: a child spawned between the request
  // and the shutdown would otherwise survive with the repository as its working directory.
  const latest = readServiceState(root, name);
  for (const pid of new Set([latest?.child_pid, state.child_pid])) {
    if (pid && pidAlive(pid)) killTree(pid, true);
  }

  // Both processes must be confirmed dead; reporting "stopped" while something survives is the
  // supervisor's own version of a false green.
  const deadline = Date.now() + 3_000;
  for (;;) {
    const supervisorAlive = pidAlive(state.supervisor_pid);
    const childAlive = [latest?.child_pid, state.child_pid].some((pid) => pid && pidAlive(pid));
    if (!supervisorAlive && !childAlive) break;
    if (Date.now() > deadline) {
      throw new Error(
        `Service ${name} did not stop within 9s (supervisor alive: ${supervisorAlive}, child alive: ${childAlive}).`,
      );
    }
    await sleep(150);
  }
  const final = readServiceState(root, name);
  if (final && final.status !== "stopped") {
    writeJson(resolve(dir, "state.json"), { ...final, status: "stopped", child_pid: null, updated_at: new Date().toISOString() });
  }
  printJson({ command: "service stop", name, ok: true });
}

export function serviceStatus(root: string, name?: string): void {
  const config = servicesConfig(root);
  const names = name ? [name] : [...new Set([...Object.keys(config), ...listServiceStateDirs(root)])];
  const services = names.map((serviceName) => {
    const state = readServiceState(root, serviceName);
    const synthesized = synthesizeServiceStatus(state);
    return {
      name: serviceName,
      configured: Boolean(config[serviceName]),
      ...synthesized,
      restarts: state?.restarts ?? 0,
      last_exit: state?.last_exit ?? null,
      updated_at: state?.updated_at ?? null,
    };
  });
  printJson({ command: "service status", target: root, services });
  if (services.some((entry) => entry.status === "crashed" || entry.status === "dead")) {
    process.exitCode = 2;
  }
}

export function listServiceStateDirs(root: string): string[] {
  const dir = resolve(root, SERVICES_STATE_REL);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function serviceLogs(root: string, name: string, options: CliOptions): void {
  const path = resolve(serviceDir(root, name), "service.log");
  if (!existsSync(path)) throw new Error(`Service ${name} has no log yet.`);
  const lines = Number(options.lines) > 0 ? Number(options.lines) : 100;
  const contents = readFileSync(path, "utf8");
  const tail = contents.split("\n").slice(-(lines + 1)).join("\n");
  process.stdout.write(`${tail}\n`);
}

export async function serviceCommand(positional: string[], options: CliOptions): Promise<void> {
  const root = targetFrom(options);
  const subcommand = positional[0] || "status";
  const name = positional[1];
  if (subcommand === "status") {
    serviceStatus(root, name);
    return;
  }
  if (subcommand === "list") {
    const config = servicesConfig(root);
    printJson({
      command: "service list",
      services: Object.entries(config).map(([serviceName, definition]) => ({
        name: serviceName,
        command: definition.command,
        health: definition.health?.url ?? null,
        status: synthesizeServiceStatus(readServiceState(root, serviceName)).status,
      })),
    });
    return;
  }
  if (!name || !SERVICE_NAME_PATTERN.test(name)) {
    throw new Error("service requires a valid service name.");
  }
  if (subcommand === "start") return serviceStart(root, name);
  if (subcommand === "supervise") return serviceSupervise(root, name);
  if (subcommand === "stop") return serviceStop(root, name);
  if (subcommand === "logs") {
    serviceLogs(root, name, options);
    return;
  }
  throw new Error("service supports start, stop, status, list, logs, or supervise.");
}
