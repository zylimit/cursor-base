#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const VERSION = "1.0.0";
const STATE_REL = ".cursor/harness-state";
const INSTALL_MANIFEST_REL = `${STATE_REL}/install-manifest.json`;
const SOURCE_MANIFEST_REL = "FRAMEWORK-MANIFEST.json";
const EVENTS = [
  "beforeShellExecution",
  "beforeMCPExecution",
  "beforeReadFile",
  "preToolUse",
  "afterFileEdit",
  "subagentStop",
  "stop",
  "sessionStart",
];
const INSTALL_ROOT_FILES = new Set([
  ".cursorignore",
  ".cursorindexingignore",
  "AGENTS.md",
  "scripts/harness.mjs",
]);

function findHarnessRoot(start) {
  let current = resolve(start);
  while (true) {
    if (
      existsSync(resolve(current, "harness/default-module-catalog.json")) &&
      existsSync(resolve(current, "scripts/harness.mjs"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Cannot locate the harness root.");
    }
    current = parent;
  }
}

const HARNESS_ROOT = findHarnessRoot(dirname(fileURLToPath(import.meta.url)));

function posix(value) {
  return value.split(sep).join("/");
}

function normalizeLf(value) {
  return value.replace(/\r\n?/g, "\n");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON at ${path}: ${error.message}`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    if (equal !== -1) {
      options[token.slice(2, equal)] = token.slice(equal + 1);
      continue;
    }
    const key = token.slice(2);
    if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
      options[key] = argv[index + 1];
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { options, positional };
}

function boolOption(options, key) {
  const value = options[key];
  return value === true || value === "true" || value === "1";
}

function targetFrom(options) {
  return resolve(String(options.target || process.cwd()));
}

function run(command, args, cwd, allowFailure = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    if (allowFailure) return { ok: false, stdout: "", stderr: result.error.message };
    throw new Error(`Unable to run ${command}: ${result.error.message}`);
  }
  const output = {
    ok: result.status === 0,
    stdout: normalizeLf(result.stdout || ""),
    stderr: normalizeLf(result.stderr || ""),
  };
  if (!output.ok && !allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${(output.stderr || output.stdout).trim()}`,
    );
  }
  return output;
}

function git(cwd, args, allowFailure = false) {
  return run("git", args, cwd, allowFailure);
}

function gitAvailable(cwd) {
  return git(cwd, ["--version"], true).ok;
}

function gitBase(cwd, requested) {
  if (!gitAvailable(cwd)) return "NO_GIT";
  const candidate = requested || "HEAD";
  const result = git(cwd, ["rev-parse", "--verify", `${candidate}^{commit}`], true);
  if (result.ok) return result.stdout.trim();
  if (requested) throw new Error(`Invalid Git base: ${requested}.`);
  return "NO_COMMIT";
}

function changedPaths(cwd, base) {
  if (!gitAvailable(cwd)) return [];
  const args =
    base && base !== "NO_COMMIT" && base !== "NO_GIT"
      ? ["diff", "--name-only", "--relative", base, "--", "."]
      : ["status", "--porcelain=v1", "--untracked-files=all"];
  const result = git(cwd, args, true);
  if (!result.ok) return [];
  const excludeState = (path) => path !== STATE_REL && !path.startsWith(`${STATE_REL}/`);
  if (args[0] === "status") {
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/^"|"$/g, ""))
      .map(posix)
      .filter(excludeState);
  }
  const tracked = result.stdout.split("\n").filter(Boolean).map(posix).filter(excludeState);
  const untracked = git(
    cwd,
    ["ls-files", "--others", "--exclude-standard", "--", "."],
    true,
  );
  return [
    ...new Set([
      ...tracked,
      ...untracked.stdout.split("\n").filter(Boolean).map(posix).filter(excludeState),
    ]),
  ].sort();
}

function canonicalDiff(cwd, base) {
  if (!gitAvailable(cwd)) {
    return normalizeLf(`NO_GIT\n${snapshotFiles(cwd).map((entry) => `${entry.path}\0${entry.sha256}`).join("\n")}`);
  }
  let diff = "";
  if (base !== "NO_COMMIT" && base !== "NO_GIT") {
    diff = git(
      cwd,
      [
        "diff",
        "--binary",
        "--no-ext-diff",
        "--relative",
        base,
        "--",
        ".",
        ":(exclude).cursor/harness-state/**",
      ],
      true,
    ).stdout;
  } else if (base === "NO_COMMIT") {
    diff += git(
      cwd,
      [
        "diff",
        "--cached",
        "--binary",
        "--no-ext-diff",
        "--relative",
        "--",
        ".",
        ":(exclude).cursor/harness-state/**",
      ],
      true,
    ).stdout;
    diff += git(
      cwd,
      [
        "diff",
        "--binary",
        "--no-ext-diff",
        "--relative",
        "--",
        ".",
        ":(exclude).cursor/harness-state/**",
      ],
      true,
    ).stdout;
  }
  const untracked = git(
    cwd,
    ["ls-files", "--others", "--exclude-standard", "--", "."],
    true,
  ).stdout
    .split("\n")
    .filter(Boolean)
    .filter((path) => path !== STATE_REL && !posix(path).startsWith(`${STATE_REL}/`))
    .sort();
  for (const path of untracked) {
    const absolute = resolve(cwd, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    const bytes = readFileSync(absolute);
    diff += `\n-- cursor-harness-untracked:${posix(path)}:${sha256(bytes)}:${bytes.length} --\n`;
  }
  return normalizeLf(diff);
}

function binding(cwd, requestedBase) {
  const base_commit = gitBase(cwd, requestedBase);
  return {
    base_commit,
    diff_sha256: sha256(canonicalDiff(cwd, base_commit)),
  };
}

function globRegex(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesPath(path, patterns) {
  const candidate = posix(path).replace(/^\.\//, "");
  return patterns.some((pattern) => {
    const normalized = posix(pattern).replace(/^\.\//, "");
    return globRegex(normalized).test(candidate) || candidate.startsWith(normalized.replace(/\/\*\*$/, "/"));
  });
}

function walkFiles(root, current = root) {
  if (!existsSync(current)) return [];
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = resolve(current, entry.name);
    const rel = posix(relative(root, absolute));
    if (
      entry.isDirectory() &&
      (entry.name === ".git" ||
        entry.name === "node_modules" ||
        rel === "tests" ||
        rel.startsWith("tests/"))
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, absolute));
    } else if (
      entry.isFile() &&
      !entry.name.endsWith(".cursor-harness-new") &&
      (!rel.startsWith(`${STATE_REL}/`) || rel === `${STATE_REL}/.gitignore`)
    ) {
      files.push(absolute);
    }
  }
  return files;
}

function isInstallable(root, absolute) {
  const rel = posix(relative(root, absolute));
  if (INSTALL_ROOT_FILES.has(rel)) return true;
  if (rel.startsWith("harness/")) return true;
  if (!rel.startsWith(".cursor/")) return false;
  return !rel.startsWith(`${STATE_REL}/`) || rel === `${STATE_REL}/.gitignore`;
}

function snapshotFiles(root, installableOnly = false) {
  return walkFiles(root)
    .filter((absolute) => !installableOnly || isInstallable(root, absolute))
    .map((absolute) => {
      const path = posix(relative(root, absolute));
      const raw = readFileSync(absolute);
      const text = raw.includes(0) ? raw : Buffer.from(normalizeLf(raw.toString("utf8")), "utf8");
      return { path, sha256: sha256(text), bytes: text.length };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sourceManifest() {
  const files = snapshotFiles(HARNESS_ROOT, true);
  return {
    version: 1,
    harness_version: VERSION,
    hash: "sha256-lf-v1",
    files,
    digest: manifestDigest(files),
  };
}

function manifestDigest(files) {
  return sha256(files.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(""));
}

function assertSafeTarget(target) {
  const parsedRoot = resolve(target, sep);
  if (resolve(target) === parsedRoot) {
    throw new Error("Refusing to manage a filesystem root.");
  }
  if (resolve(target) === resolve(homedir())) {
    throw new Error("Refusing to manage the user home directory; choose a repository target.");
  }
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function safeManagedPath(target, managedPath) {
  if (
    typeof managedPath !== "string" ||
    !managedPath ||
    isAbsolute(managedPath) ||
    /^[a-zA-Z]:[\\/]/.test(managedPath) ||
    /^[/\\]{2}/.test(managedPath)
  ) {
    throw new Error(`Unsafe managed path: ${String(managedPath)}.`);
  }
  const segments = managedPath.split(/[\\/]/);
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new Error(`Unsafe managed path: ${managedPath}.`);
  }
  const root = resolve(target);
  const destination = resolve(root, ...segments);
  if (!isWithin(root, destination) || destination === root) {
    throw new Error(`Managed path escapes target: ${managedPath}.`);
  }
  const physicalRoot = existsSync(root) ? realpathSync(root) : root;
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    let physical;
    try {
      physical = realpathSync(current);
    } catch (error) {
      if (metadata.isSymbolicLink()) {
        throw new Error(`Managed path contains an unsafe dangling symlink: ${managedPath}.`);
      }
      throw error;
    }
    if (!isWithin(physicalRoot, physical)) {
      throw new Error(`Managed path resolves outside target: ${managedPath}.`);
    }
  }
  return destination;
}

function validateInstallManifest(target, value) {
  if (
    value?.version !== 1 ||
    typeof value.harness_version !== "string" ||
    value.hash !== "sha256-lf-v1" ||
    !Array.isArray(value.files) ||
    typeof value.digest !== "string"
  ) {
    throw new Error("Install manifest has invalid required fields.");
  }
  const seen = new Set();
  for (const entry of value.files) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 || "") ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes < 0 ||
      seen.has(entry.path)
    ) {
      throw new Error(`Install manifest has an invalid file entry: ${entry?.path || "<unknown>"}.`);
    }
    safeManagedPath(target, entry.path);
    seen.add(entry.path);
  }
  if (!/^[a-f0-9]{64}$/.test(value.digest) || value.digest !== manifestDigest(value.files)) {
    throw new Error("Install manifest digest is invalid.");
  }
  return value;
}

function fileHash(path) {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  const raw = readFileSync(path);
  return sha256(raw.includes(0) ? raw : normalizeLf(raw.toString("utf8")));
}

function copyNormalized(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const raw = readFileSync(source);
  if (raw.includes(0)) {
    cpSync(source, destination);
  } else {
    writeFileSync(destination, normalizeLf(raw.toString("utf8")), "utf8");
  }
}

function conflictSidecar(target, destination, sourceHash) {
  const preferred = safeManagedPath(
    target,
    posix(relative(target, `${destination}.cursor-harness-new`)),
  );
  if (!existsSync(preferred) || fileHash(preferred) === sourceHash) return preferred;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let candidate = safeManagedPath(
    target,
    posix(relative(target, `${preferred}-${sourceHash.slice(0, 12)}-${timestamp}`)),
  );
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = safeManagedPath(
      target,
      posix(relative(target, `${preferred}-${sourceHash.slice(0, 12)}-${timestamp}-${suffix}`)),
    );
    suffix += 1;
  }
  return candidate;
}

function installLike(action, options) {
  const target = targetFrom(options);
  const dryRun = boolOption(options, "dry-run");
  assertSafeTarget(target);
  if (
    resolve(target) === resolve(HARNESS_ROOT) ||
    (existsSync(target) && realpathSync(target) === realpathSync(HARNESS_ROOT))
  ) {
    throw new Error("Refusing to install or upgrade with the harness source as the target.");
  }
  const manifest = sourceManifest();
  const oldPath = safeManagedPath(target, INSTALL_MANIFEST_REL);
  const oldManifest = existsSync(oldPath)
    ? validateInstallManifest(target, readJson(oldPath))
    : null;
  const oldByPath = new Map((oldManifest?.files || []).map((entry) => [entry.path, entry]));
  const operations = [];

  for (const entry of manifest.files) {
    const source = resolve(HARNESS_ROOT, entry.path);
    const destination = safeManagedPath(target, entry.path);
    const currentHash = fileHash(destination);
    const oldHash = oldByPath.get(entry.path)?.sha256;
    if (currentHash === entry.sha256) {
      operations.push({ path: entry.path, action: "unchanged" });
      continue;
    }
    const safeToReplace = currentHash === null || currentHash === oldHash;
    if (safeToReplace) {
      operations.push({ path: entry.path, action: currentHash === null ? "create" : "update" });
      if (!dryRun) copyNormalized(source, destination);
    } else {
      const sidecar = conflictSidecar(target, destination, entry.sha256);
      operations.push({ path: entry.path, action: "preserve", sidecar: posix(relative(target, sidecar)) });
      if (!dryRun) copyNormalized(source, sidecar);
    }
  }

  const sourcePaths = new Set(manifest.files.map((entry) => entry.path));
  if (action === "upgrade" && oldManifest) {
    for (const oldEntry of oldManifest.files || []) {
      if (sourcePaths.has(oldEntry.path)) continue;
      const destination = safeManagedPath(target, oldEntry.path);
      if (fileHash(destination) === oldEntry.sha256) {
        operations.push({ path: oldEntry.path, action: "remove-obsolete" });
        if (!dryRun) rmSync(destination, { force: true });
      } else if (existsSync(destination)) {
        operations.push({ path: oldEntry.path, action: "preserve-obsolete" });
      }
    }
  }

  if (!dryRun) {
    writeJson(oldPath, {
      ...manifest,
      installed_at: new Date().toISOString(),
      source: HARNESS_ROOT,
    });
  }
  printJson({ command: action, target, dry_run: dryRun, operations });
}

function uninstall(options) {
  const target = targetFrom(options);
  const dryRun = boolOption(options, "dry-run");
  assertSafeTarget(target);
  const manifestPath = safeManagedPath(target, INSTALL_MANIFEST_REL);
  if (!existsSync(manifestPath)) {
    throw new Error(`No install manifest found at ${manifestPath}.`);
  }
  const manifest = readJson(manifestPath);
  validateInstallManifest(target, manifest);
  const operations = [];
  for (const entry of manifest.files || []) {
    const destination = safeManagedPath(target, entry.path);
    if (!existsSync(destination)) continue;
    if (fileHash(destination) === entry.sha256) {
      operations.push({ path: entry.path, action: "remove" });
      if (!dryRun) rmSync(destination, { force: true });
    } else {
      operations.push({ path: entry.path, action: "preserve-modified" });
    }
  }
  if (!dryRun) rmSync(manifestPath, { force: true });
  printJson({ command: "uninstall", target, dry_run: dryRun, operations });
}

function catalog(root) {
  const local = resolve(root, "harness/module-catalog.json");
  return readJson(existsSync(local) ? local : resolve(HARNESS_ROOT, "harness/default-module-catalog.json"));
}

function matrix(root) {
  const local = resolve(root, "harness/verification-matrix.json");
  return readJson(
    existsSync(local) ? local : resolve(HARNESS_ROOT, "harness/default-verification-matrix.json"),
  );
}

function affectedModules(root, paths) {
  const definition = catalog(root);
  const direct = new Set();
  const matchedPaths = new Set();
  for (const module of definition.modules) {
    for (const path of paths) {
      if (!matchesPath(path, module.paths || [])) continue;
      direct.add(module.id);
      matchedPaths.add(posix(path));
    }
  }
  const affected = new Set(direct);
  let changed = true;
  while (changed) {
    changed = false;
    for (const module of definition.modules) {
      if (
        !affected.has(module.id) &&
        (module.dependsOn || []).some((dependency) => affected.has(dependency))
      ) {
        affected.add(module.id);
        changed = true;
      }
    }
  }
  return {
    paths: [...new Set(paths.map(posix))].sort(),
    unmatched: [...new Set(paths.map(posix))].filter((path) => !matchedPaths.has(path)).sort(),
    direct: [...direct].sort(),
    affected: definition.modules.filter((module) => affected.has(module.id)),
  };
}

function requestedPaths(root, positional, options) {
  const explicit = [
    ...positional,
    ...String(options.paths || "")
      .split(",")
      .filter(Boolean),
  ];
  return explicit.length ? explicit.map(posix) : changedPaths(root, gitBase(root, options.base));
}

function repoMap(options) {
  const root = targetFrom(options);
  const definition = catalog(root);
  printJson({
    version: definition.version,
    modules: definition.modules.map((module) => ({
      id: module.id,
      paths: module.paths,
      dependsOn: module.dependsOn || [],
      verification: module.verification || [],
      owners: module.owners || [],
    })),
  });
}

function affected(positional, options) {
  const root = targetFrom(options);
  const paths = requestedPaths(root, positional, options);
  const result = affectedModules(root, paths);
  printJson({
    target: root,
    paths: result.paths,
    direct: result.direct,
    affected: result.affected.map((module) => module.id),
  });
}

function verifyPlan(positional, options) {
  const root = targetFrom(options);
  const paths = requestedPaths(root, positional, options);
  const impact = affectedModules(root, paths);
  const checks = matrix(root).checks || {};
  const selected = [];
  const seen = new Set();
  for (const module of impact.affected) {
    for (const checkId of module.verification || []) {
      if (seen.has(checkId)) continue;
      if (!checks[checkId]) throw new Error(`Module ${module.id} references unknown check ${checkId}.`);
      seen.add(checkId);
      selected.push({ id: checkId, ...checks[checkId] });
    }
  }
  if (impact.unmatched.length > 0) {
    const conservativeId = checks.validate
      ? "validate"
      : Object.keys(checks).find((id) => checks[id]?.required)
        || Object.keys(checks)[0];
    if (!conservativeId) {
      throw new Error("Unmatched paths require at least one conservative verification check.");
    }
    if (seen.has(conservativeId)) {
      selected.find((check) => check.id === conservativeId).conservative = true;
    } else {
      selected.push({ id: conservativeId, ...checks[conservativeId], conservative: true });
    }
  }
  printJson({
    target: root,
    paths: impact.paths,
    unmatched_paths: impact.unmatched,
    modules: impact.affected.map((module) => module.id),
    checks: selected,
  });
}

function sensitivePath(filePath) {
  const normalized = posix(resolve(filePath)).toLowerCase();
  const name = basename(normalized);
  if (/^\.env($|\.)/.test(name) && !/\.(example|sample|template)$/.test(name)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(name)) return true;
  if (/^(id_rsa|id_ed25519|credentials\.json|secrets?\.json|service-account\.json)$/.test(name)) {
    return true;
  }
  return /\/(\.ssh|\.aws|\.azure|\.gnupg|\.kube)\//.test(normalized);
}

function shellDecision(command) {
  const value = String(command || "").trim();
  const lower = value.toLowerCase();
  const allow = { permission: "allow" };
  if (!value) return allow;
  const denyPatterns = [
    /\bgit\s+(reset\s+--hard|clean\s+(?:--force|-[a-z]*f[a-z]*)|checkout\s+--)\b/i,
    /\b(mkfs(\.\w+)?|diskpart|format\s+[a-z]:|shutdown|reboot)\b/i,
    /\bdd\b[^;&|]*(\bof=\/dev\/|\bof=\\\\\.\\physicaldrive)/i,
    /\b(drop|truncate)\s+(database|schema)\b/i,
    /\b(rm|rmdir)\b[^;&|]*(--no-preserve-root|\/\s*$|\/\*|\.\.[\\/]|\.git)/i,
    /\b(remove-item|del|erase)\b[^;&|]*(\*|\.\.[\\/]|\.git)[^;&|]*(-recurse|-force|\/s|\/q)/i,
    /\bremove-item\b[^;&|]*\b[a-z]:[\\/]["']?\s+[^;&|]*(-recurse|-force)/i,
    /\b(reg\s+delete|bcdedit)\b/i,
  ];
  if (denyPatterns.some((pattern) => pattern.test(value))) {
    return decision("deny", "Blocked an obviously destructive command.", value);
  }
  const askPatterns = [
    /\bgit(?:\s+(?:-[a-zA-Z]\s+\S+|--[\w-]+(?:=\S+)?))*\s+push\b/i,
    /\b(gh\s+(pr\s+merge|release\s+create)|npm\s+publish|cargo\s+publish|twine\s+upload)\b/i,
    /\bgh\s+(api|issue\s+create|pr\s+create)\b/i,
    /\bcurl\b[^;&|]*(?:\s-d(?:\s|=)|--data(?:-[a-z]+)?(?:\s|=)|--upload-file(?:\s|=)|\s-T\s)/i,
    /\b(invoke-restmethod|invoke-webrequest)\b[^;&|]*(?:-method\s+(post|put|patch|delete)|-body\b)/i,
    /\b(kubectl|helm|terraform|pulumi|ansible-playbook)\b/i,
    /\b(production|prod)\b.*\b(deploy|apply|migrate|restart|delete)\b/i,
    /\b(deploy|release|publish)\b.*\b(production|prod)\b/i,
    /\b(?:npm|pnpm|yarn)(?:\s+(?:--prefix|--cwd|-C)\s+\S+|\s+--[\w-]+(?:=\S+)?)*\s+(?:install|add|i)\b/i,
    /\b(?:pip|pip3|uv|cargo|go)\s+(?:install|add|get)\b/i,
    /\b(sudo|runas|start-process\b.*-verb\s+runas)\b/i,
    /\b(kill|killall|pkill|taskkill|stop-process)\b/i,
    /\b(?:rm|rmdir|del|erase|remove-item)\b/i,
    /\b(rm|rmdir)\b[^;&|]*-[a-z]*r/i,
    /\bremove-item\b[^;&|]*-recurse/i,
    /\bdocker\s+(system|volume|image|container)\s+prune\b/i,
    /\b(?:sh|bash|zsh)\s+-c\b/i,
    /\b(?:powershell|pwsh)(?:\.exe)?\s+(?:-command|-c)\b/i,
    /\bnode(?:\.exe)?\s+(?:-e|--eval)\b/i,
    /\b(?:python|python3|py)(?:\.exe)?\s+-c\b/i,
  ];
  if (askPatterns.some((pattern) => pattern.test(value))) {
    return decision("ask", "This command has external, destructive, privileged, or installation side effects.", value);
  }
  return lower.includes("git push")
    ? decision("ask", "Publishing repository changes requires approval.", value)
    : allow;
}

function mcpDecision(payload) {
  const name = String(payload.tool_name || "").toLowerCase();
  const input =
    typeof payload.tool_input === "string"
      ? payload.tool_input.toLowerCase()
      : JSON.stringify(payload.tool_input || {}).toLowerCase();
  const combined = `${name} ${input}`;
  if (
    /(^|[_-])(delete|destroy|drop|purge|revoke|rotate[_-]secret|reset)([_-]|$)/.test(name) ||
    (/\b(prod|production)\b/.test(combined) && /\b(write|create|update|deploy|apply|delete)\b/.test(combined))
  ) {
    return decision("deny", "Blocked a destructive or production MCP operation.", name);
  }
  if (
    /(^|[_-])(write|create|update|edit|send|post|put|patch|merge|publish|deploy|apply|upload|invite|comment|message|issue|pull-request|release)([_-]|$)/.test(
      name.replaceAll("pull_request", "pull-request"),
    ) ||
    /"(operation|action|method)"\s*:\s*"(write|create|update|edit|send|post|put|patch|merge|publish|deploy|apply|upload|delete)"/.test(
      input,
    )
  ) {
    return decision("ask", "This MCP tool appears to write data or cause an external side effect.", name);
  }
  return { permission: "allow" };
}

function decision(permission, message, subject) {
  return {
    permission,
    user_message: message,
    agent_message: `${message} Review and obtain explicit user approval before retrying: ${subject}`,
  };
}

async function stdinJson() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) return {};
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Hook input is not valid JSON: ${error.message}`);
  }
}

function appendLedger(root, event, payload, outcome) {
  const state = resolve(root, STATE_REL);
  mkdirSync(state, { recursive: true });
  const record = {
    timestamp: new Date().toISOString(),
    event,
    conversation_id: payload.conversation_id || null,
    generation_id: payload.generation_id || null,
    subject:
      payload.command ||
      payload.tool_name ||
      (payload.file_path ? posix(relative(root, payload.file_path)) : null),
    outcome,
  };
  appendFileSync(resolve(state, "ledger.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

async function hook(event, options) {
  if (!EVENTS.includes(event)) throw new Error(`Unsupported hook event: ${event}`);
  const payload = await stdinJson();
  const root = payload.workspace_roots?.[0] ? resolve(payload.workspace_roots[0]) : targetFrom(options);
  let output = {};
  if (event === "beforeShellExecution") {
    output = shellDecision(payload.command);
  } else if (event === "beforeMCPExecution") {
    output = mcpDecision(payload);
  } else if (event === "beforeReadFile") {
    output = sensitivePath(payload.file_path || "")
      ? {
          permission: "deny",
          user_message: "Blocked reading a likely credential or secret file.",
        }
      : { permission: "allow" };
  } else if (event === "preToolUse") {
    const tool = String(payload.tool_name || "").toLowerCase();
    const input = payload.tool_input || {};
    const path = input.file_path || input.path || "";
    if ((tool === "read" || tool === "write") && path && sensitivePath(path)) {
      output = decision("deny", "Blocked access to a likely credential or secret file.", path);
    } else if (
      tool === "delete" &&
      (!path || sensitivePath(path) || /(^|[\\/])\.git([\\/]|$)|\.\.[\\/]|[*?]/.test(path))
    ) {
      output = decision("deny", "Blocked a broad or sensitive delete operation.", path || "<unspecified>");
    } else {
      output = { permission: "allow" };
    }
  } else if (event === "sessionStart") {
    const current = binding(root);
    writeJson(resolve(root, STATE_REL, "baseline.json"), {
      ...current,
      changed_paths: changedPaths(root, current.base_commit),
      session_id: payload.session_id || payload.conversation_id || null,
      created_at: new Date().toISOString(),
    });
    output = {
      env: { CURSOR_HARNESS_ROOT: root },
      additional_context:
        "Safety controls are non-waivable. Record exact verification evidence and bind reviews to the current base commit and diff hash.",
    };
  } else if (event === "afterFileEdit") {
    const current = binding(root);
    const qualityPath = resolve(root, STATE_REL, "quality.json");
    const quality = existsSync(qualityPath) ? readJson(qualityPath) : {};
    const baselinePath = resolve(root, STATE_REL, "baseline.json");
    const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
    const editedFile = payload.file_path ? posix(relative(root, payload.file_path)) : null;
    writeJson(qualityPath, {
      ...quality,
      pending_diff_sha256: current.diff_sha256,
      edited_at: new Date().toISOString(),
      session_baseline_diff_sha256: baseline?.diff_sha256 || null,
      preexisting_changed_paths: baseline?.changed_paths || [],
      session_edited_files: [
        ...new Set([...(quality.session_edited_files || []), editedFile].filter(Boolean)),
      ],
    });
  } else if (event === "subagentStop") {
    if (
      payload.status === "completed" &&
      Array.isArray(payload.modified_files) &&
      payload.modified_files.length > 0 &&
      Number(payload.loop_count || 0) < 1
    ) {
      output = {
        followup_message:
          "Inspect the complete scoped diff and run the affected verification plan. Report exact outcomes; do not widen scope.",
      };
    }
  } else if (event === "stop") {
    const current = binding(root);
    const qualityPath = resolve(root, STATE_REL, "quality.json");
    const quality = existsSync(qualityPath) ? readJson(qualityPath) : {};
    if (
      payload.status === "completed" &&
      Number(payload.loop_count || 0) < 2 &&
      quality.pending_diff_sha256 === current.diff_sha256 &&
      quality.validated_diff_sha256 !== current.diff_sha256
    ) {
      output = {
        followup_message:
          "Quality evidence is stale for the current diff. Run the focused checks from `node scripts/harness.mjs verify-plan`, then validate and report any remaining gaps.",
      };
    }
  }
  appendLedger(root, event, payload, output.permission || (output.followup_message ? "followup" : "observe"));
  printJson(output);
}

function validateCatalog(value, label, errors) {
  if (value?.version !== 1 || !Array.isArray(value.modules)) {
    errors.push(`${label}: expected version 1 and a modules array.`);
    return;
  }
  const ids = new Set();
  for (const module of value.modules) {
    if (!module.id || ids.has(module.id)) errors.push(`${label}: module IDs must be unique and non-empty.`);
    ids.add(module.id);
    if (!Array.isArray(module.paths) || module.paths.length === 0) {
      errors.push(`${label}: module ${module.id || "<unknown>"} needs paths.`);
    }
  }
  for (const module of value.modules) {
    for (const dependency of module.dependsOn || []) {
      if (!ids.has(dependency)) errors.push(`${label}: module ${module.id} has unknown dependency ${dependency}.`);
    }
  }
}

function validateRuntimeSync(root, errors) {
  const source = resolve(root, "src/harness.ts");
  const runtime = resolve(root, ".cursor/runtime/harness.mjs");
  if (!existsSync(runtime)) {
    errors.push("Missing checked-in runtime: .cursor/runtime/harness.mjs.");
    return;
  }
  if (!existsSync(source)) {
    const manifestPath = resolve(root, INSTALL_MANIFEST_REL);
    if (!existsSync(manifestPath)) {
      errors.push("src/harness.ts is missing and no valid install manifest is available.");
      return;
    }
    try {
      const manifest = validateInstallManifest(root, readJson(manifestPath));
      if (!manifest.files.some((entry) => entry.path === ".cursor/runtime/harness.mjs")) {
        errors.push("Install manifest does not manage .cursor/runtime/harness.mjs.");
      }
    } catch (error) {
      errors.push(error.message);
    }
    return;
  }
  if (normalizeLf(readFileSync(source, "utf8")) !== normalizeLf(readFileSync(runtime, "utf8"))) {
    errors.push("TypeScript source and checked-in .mjs runtime are out of sync.");
  }
}

function validateManagedJson(root, paths, errors) {
  for (const path of [...new Set(paths)]) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) continue;
    try {
      readJson(absolute);
    } catch (error) {
      errors.push(error.message);
    }
  }
}

function isDefaultBootstrapConfig(root) {
  const pairs = [
    ["harness/module-catalog.json", "harness/default-module-catalog.json"],
    ["harness/verification-matrix.json", "harness/default-verification-matrix.json"],
  ];
  return pairs.every(([local, fallback]) => {
    const localPath = resolve(root, local);
    const fallbackPath = resolve(root, fallback);
    return (
      existsSync(localPath) &&
      existsSync(fallbackPath) &&
      normalizeLf(readFileSync(localPath, "utf8")) === normalizeLf(readFileSync(fallbackPath, "utf8"))
    );
  });
}

function validate(options) {
  const root = targetFrom(options);
  const errors = [];
  const warnings = [];
  const syncOnly = boolOption(options, "sync-only");
  validateRuntimeSync(root, errors);
  if (!syncOnly) {
    const required = [
      "AGENTS.md",
      ".cursor/hooks.json",
      ".cursor/cli.json",
      ".cursor/sandbox.json",
      ".cursor/worktrees.json",
      "harness/default-module-catalog.json",
      "harness/default-verification-matrix.json",
      "harness/module-catalog.json",
      "harness/verification-matrix.json",
      "scripts/harness.mjs",
    ];
    if (root === HARNESS_ROOT) {
      required.push(
        "README.md",
        "docs/ADOPTION.md",
        "docs/ARCHITECTURE.md",
        "docs/GOVERNANCE.md",
        "docs/LARGE-REPO-GUIDE.md",
        "docs/OPERATIONS.md",
        "docs/PROTOCOLS.md",
      );
    }
    for (const path of required) {
      if (!existsSync(resolve(root, path))) errors.push(`Missing required asset: ${path}`);
    }
    const managedJson = [
      ".cursor/hooks.json",
      ".cursor/cli.json",
      ".cursor/sandbox.json",
      ".cursor/worktrees.json",
      "harness/default-module-catalog.json",
      "harness/default-verification-matrix.json",
      "harness/module-catalog.json",
      "harness/verification-matrix.json",
      INSTALL_MANIFEST_REL,
    ];
    const schemaDir = resolve(root, "harness/schemas");
    if (existsSync(schemaDir)) {
      managedJson.push(
        ...readdirSync(schemaDir)
          .filter((name) => name.endsWith(".json"))
          .map((name) => `harness/schemas/${name}`),
      );
    }
    validateManagedJson(root, managedJson, errors);
    if (existsSync(resolve(root, ".cursor/hooks.json"))) {
      const config = readJson(resolve(root, ".cursor/hooks.json"));
      if (config.version !== 1) errors.push(".cursor/hooks.json must use version 1.");
      for (const event of EVENTS) {
        const definitions = config.hooks?.[event];
        if (!Array.isArray(definitions) || definitions.length !== 1) {
          errors.push(`.cursor/hooks.json must define exactly one ${event} hook.`);
          continue;
        }
        if (definitions[0].command !== `node .cursor/runtime/harness.mjs hook ${event}`) {
          errors.push(`Hook ${event} must call the checked-in runtime.`);
        }
        if (
          ["beforeShellExecution", "beforeMCPExecution", "beforeReadFile", "preToolUse"].includes(event) &&
          definitions[0].failClosed !== true
        ) {
          errors.push(`Security hook ${event} must set failClosed: true.`);
        }
      }
    }
    if (existsSync(resolve(root, "harness/default-module-catalog.json"))) {
      validateCatalog(
        readJson(resolve(root, "harness/default-module-catalog.json")),
        "default-module-catalog.json",
        errors,
      );
    }
    if (existsSync(resolve(root, "harness/default-verification-matrix.json"))) {
      const verification = readJson(resolve(root, "harness/default-verification-matrix.json"));
      if (verification.version !== 1 || !verification.checks || Array.isArray(verification.checks)) {
        errors.push("default-verification-matrix.json must define version 1 and a checks object.");
      }
    }
    if (isDefaultBootstrapConfig(root)) {
      warnings.push(
        "Module catalog and verification matrix still use bootstrap defaults; customize them for this repository.",
      );
    }
  }
  if (Number(process.versions.node.split(".")[0]) < 20) errors.push("Node.js 20 or newer is required.");
  if (!gitAvailable(root)) warnings.push("Git is unavailable; receipt bindings use a filesystem snapshot.");
  if (errors.length === 0 && !boolOption(options, "dry-run") && !syncOnly) {
    const current = binding(root);
    const qualityPath = resolve(root, STATE_REL, "quality.json");
    const quality = existsSync(qualityPath) ? readJson(qualityPath) : {};
    writeJson(qualityPath, {
      ...quality,
      validated_diff_sha256: current.diff_sha256,
      validated_at: new Date().toISOString(),
      validated_check: "full",
    });
  }
  printJson({
    command: "validate",
    check_type: syncOnly ? "sync-only" : "full",
    target: root,
    ok: errors.length === 0,
    errors,
    warnings,
  });
  if (errors.length) process.exitCode = 1;
}

function doctor(options) {
  const root = targetFrom(options);
  const checks = [];
  const warnings = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: major >= 20, detail: process.version });
  const gitVersion = git(root, ["--version"], true);
  checks.push({
    name: "git",
    ok: gitVersion.ok,
    detail: (gitVersion.stdout || gitVersion.stderr).trim() || "not found",
  });
  checks.push({
    name: "repository-root",
    ok: existsSync(resolve(root, "AGENTS.md")) && existsSync(resolve(root, ".cursor")),
    detail: root,
  });
  for (const path of ["scripts/harness.mjs", ".cursor/hooks.json"]) {
    checks.push({ name: path, ok: existsSync(resolve(root, path)), detail: existsSync(resolve(root, path)) ? "present" : "missing" });
  }
  const syncErrors = [];
  validateRuntimeSync(root, syncErrors);
  checks.push({
    name: "runtime-sync",
    ok: syncErrors.length === 0,
    detail: syncErrors[0] || "source and runtime match",
  });
  if (isDefaultBootstrapConfig(root)) {
    warnings.push(
      "Module catalog and verification matrix still use bootstrap defaults; customize them for this repository.",
    );
  }
  const ok = checks.every((check) => check.ok);
  printJson({ command: "doctor", target: root, ok, checks, warnings });
  if (!ok) process.exitCode = 1;
}

function manifest(options) {
  const root = targetFrom(options);
  if (root !== HARNESS_ROOT) {
    const files = snapshotFiles(root, true);
    printJson({
      version: 1,
      harness_version: VERSION,
      hash: "sha256-lf-v1",
      files,
      digest: manifestDigest(files),
      check: boolOption(options, "check"),
    });
    return;
  }
  const value = sourceManifest();
  const manifestPath = resolve(root, SOURCE_MANIFEST_REL);
  if (boolOption(options, "write")) {
    writeJson(manifestPath, value);
    printJson({
      command: "manifest",
      ok: true,
      written: manifestPath,
      digest: value.digest,
      files: value.files.length,
    });
    return;
  }
  if (boolOption(options, "check")) {
    const errors = [];
    validateRuntimeSync(root, errors);
    if (!existsSync(manifestPath)) {
      errors.push(`Missing source manifest: ${SOURCE_MANIFEST_REL}.`);
    } else {
      const expected = readJson(manifestPath);
      let savedDigest = null;
      if (Array.isArray(expected.files)) {
        savedDigest = manifestDigest(expected.files);
        if (savedDigest !== expected.digest) {
          errors.push("Saved source manifest digest does not match its files.");
        }
      } else {
        errors.push("Saved source manifest files must be an array.");
      }
      for (const field of ["version", "harness_version", "hash", "files", "digest"]) {
        if (JSON.stringify(expected[field]) !== JSON.stringify(value[field])) {
          errors.push(`Source manifest ${field} is stale.`);
        }
      }
      if (errors.length > 0) {
        errors.push("Source manifest is stale; run `node scripts/harness.mjs manifest --write`.");
      }
    }
    printJson({
      command: "manifest",
      ok: errors.length === 0,
      digest: value.digest,
      files: value.files.length,
      errors,
    });
    if (errors.length) process.exitCode = 1;
  } else {
    printJson(value);
  }
}

function testHarness(options) {
  const root = targetFrom(options);
  const result = spawnSync(process.execPath, ["--test"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw new Error(`Unable to run Node tests: ${result.error.message}`);
  if (result.status !== 0) process.exitCode = result.status || 1;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value, field) {
  const copy = { ...value };
  delete copy[field];
  return sha256(canonicalJson(copy));
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateReceipt(value) {
  const errors = [];
  const required = [
    "version",
    "base_commit",
    "diff_sha256",
    "scope",
    "exclusions",
    "reviewer",
    "decision",
    "findings",
    "not_reviewed",
    "created_at",
    "content_sha256",
  ];
  for (const field of required) {
    if (!Object.hasOwn(value || {}, field)) errors.push(`Missing receipt field: ${field}.`);
  }
  if (value?.version !== 1) errors.push("Receipt version must be 1.");
  if (typeof value?.base_commit !== "string" || !value.base_commit) {
    errors.push("Receipt base_commit must be a non-empty string.");
  }
  if (!/^[a-f0-9]{64}$/.test(value?.diff_sha256 || "")) {
    errors.push("Receipt diff_sha256 must be a SHA-256 hash.");
  }
  if (
    !Array.isArray(value?.scope) ||
    value.scope.length === 0 ||
    value.scope.some((entry) => typeof entry !== "string" || !entry)
  ) {
    errors.push("Receipt scope must be a non-empty string array.");
  }
  if (!Array.isArray(value?.exclusions) || value.exclusions.some((entry) => typeof entry !== "string")) {
    errors.push("Receipt exclusions must be a string array.");
  }
  if (typeof value?.reviewer !== "string" || !value.reviewer.trim()) {
    errors.push("Receipt reviewer must be non-empty.");
  }
  if (!["approve", "comment", "request-changes"].includes(value?.decision)) {
    errors.push("Receipt decision is invalid.");
  }
  if (!Array.isArray(value?.findings)) errors.push("Receipt findings must be an array.");
  if (typeof value?.not_reviewed !== "string") errors.push("Receipt not_reviewed must be a string.");
  if (!validTimestamp(value?.created_at)) errors.push("Receipt created_at must be an ISO timestamp.");
  if (!/^[a-f0-9]{64}$/.test(value?.content_sha256 || "")) {
    errors.push("Receipt content_sha256 must be a SHA-256 hash.");
  } else if (contentHash(value, "content_sha256") !== value.content_sha256) {
    errors.push("Receipt content integrity hash is invalid.");
  }
  return errors;
}

function receipt(positional, options) {
  const root = targetFrom(options);
  const subcommand = positional[0] === "check" ? "check" : "create";
  if (subcommand === "check") {
    const path = resolve(root, String(positional[1] || options.file || ""));
    if (!positional[1] && !options.file) throw new Error("receipt check requires a receipt path.");
    const value = readJson(path);
    const errors = validateReceipt(value);
    let current = null;
    if (errors.length === 0) {
      try {
        const defaultBase = gitBase(root);
        current =
          value.base_commit === "NO_COMMIT" || value.base_commit === "NO_GIT"
            ? binding(root)
            : binding(root, value.base_commit);
        if (value.base_commit !== current.base_commit || value.base_commit !== defaultBase) {
          errors.push("Receipt base commit is stale.");
        }
        if (value.diff_sha256 !== current.diff_sha256) {
          errors.push("Receipt diff hash is stale.");
        }
      } catch (error) {
        errors.push(error.message);
      }
    }
    const valid = errors.length === 0;
    printJson({ command: "receipt check", path, valid, errors, expected: current, receipt: value });
    if (!valid) process.exitCode = 1;
    return;
  }
  const scope = String(options.scope || ".")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const value = {
    version: 1,
    ...binding(root, options.base),
    scope,
    exclusions: String(options.exclusions || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    reviewer: String(options.reviewer || "unassigned"),
    decision: String(options.decision || "comment"),
    findings: [],
    not_reviewed: String(options["not-reviewed"] || ""),
    created_at: new Date().toISOString(),
  };
  if (!["approve", "comment", "request-changes"].includes(value.decision)) {
    throw new Error("receipt --decision must be approve, comment, or request-changes.");
  }
  value.content_sha256 = contentHash(value, "content_sha256");
  const errors = validateReceipt(value);
  if (errors.length) throw new Error(errors.join(" "));
  const path = options.out
    ? resolve(root, String(options.out))
    : resolve(root, STATE_REL, "receipts", `${Date.now()}-${value.diff_sha256.slice(0, 12)}.json`);
  if (!boolOption(options, "dry-run")) writeJson(path, value);
  printJson({ command: "receipt create", path, dry_run: boolOption(options, "dry-run"), receipt: value });
}

function waiver(positional, options) {
  const root = targetFrom(options);
  const subcommand = positional[0] || "list";
  const dir = resolve(root, STATE_REL, "waivers");
  if (subcommand === "list") {
    const waivers = existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.endsWith(".json"))
          .map((name) => ({ path: posix(relative(root, resolve(dir, name))), ...readJson(resolve(dir, name)) }))
      : [];
    printJson({ command: "waiver list", waivers });
    return;
  }
  if (subcommand === "check") {
    const path = resolve(root, String(positional[1] || options.file || ""));
    if (!positional[1] && !options.file) throw new Error("waiver check requires a waiver path.");
    const value = readJson(path);
    const errors = validateWaiver(value);
    printJson({ command: "waiver check", path, valid: errors.length === 0, errors, waiver: value });
    if (errors.length) process.exitCode = 1;
    return;
  }
  if (subcommand !== "create") throw new Error("waiver supports create, check, or list.");
  const value = {
    version: 1,
    owner: options.owner,
    reason: options.reason,
    scope: options.scope,
    expiry: options.expiry,
    compensation: options.compensation,
    created_at: new Date().toISOString(),
  };
  const errors = validateWaiver(value);
  if (errors.length) throw new Error(errors.join(" "));
  const id = `${Date.now()}-${sha256(`${value.owner}\0${value.scope}`).slice(0, 10)}`;
  const path = resolve(dir, `${id}.json`);
  if (!boolOption(options, "dry-run")) writeJson(path, value);
  printJson({ command: "waiver create", path, dry_run: boolOption(options, "dry-run"), waiver: value });
}

function validateWaiver(value) {
  const errors = [];
  if (value?.version !== 1) errors.push("Waiver version must be 1.");
  for (const field of ["owner", "reason", "scope", "expiry", "compensation"]) {
    if (!value?.[field] || !String(value[field]).trim()) errors.push(`Missing waiver field: ${field}.`);
  }
  if (!validTimestamp(value?.created_at)) errors.push("Waiver created_at must be an ISO timestamp.");
  const combined = `${value?.reason || ""} ${value?.scope || ""}`.toLowerCase();
  if (/\b(safety|security|secret|credential|destructive|push|deploy|production)\b/.test(combined)) {
    errors.push("Safety and external-side-effect controls cannot be waived.");
  }
  if (value?.expiry) {
    const expiry = Date.parse(value.expiry);
    if (!validTimestamp(value.expiry)) errors.push("Waiver expiry must be an ISO timestamp.");
    else if (expiry <= Date.now()) errors.push("Waiver is expired.");
  }
  return errors;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stdout.write(`Cursor repository harness ${VERSION}
Usage: node scripts/harness.mjs <command> [arguments] [--target PATH] [--dry-run]
Commands:
  hook <event>       Evaluate a Cursor hook event from JSON stdin
  doctor             Diagnose prerequisites and harness integrity
  validate           Validate configuration, catalogs, and runtime parity
  test               Run the deterministic Node test suite
  manifest           Print the LF-normalized SHA-256 source manifest
  install            Install safely into a repository
  upgrade            Upgrade managed files without overwriting user changes
  uninstall          Remove only unchanged managed files
  repo-map           Print declared module and dependency boundaries
  affected [paths]   Resolve affected modules from paths and declared dependencies
  verify-plan        Build a verification plan for affected modules
  receipt            Create or check a diff-bound review receipt
  waiver             Create, check, or list non-safety quality waivers
`);
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const { options, positional } = parseArgs(rest);
  switch (command) {
    case "hook":
      await hook(positional[0], options);
      break;
    case "doctor":
      doctor(options);
      break;
    case "validate":
      validate(options);
      break;
    case "test":
      testHarness(options);
      break;
    case "manifest":
      manifest(options);
      break;
    case "install":
      installLike("install", options);
      break;
    case "upgrade":
      installLike("upgrade", options);
      break;
    case "uninstall":
      uninstall(options);
      break;
    case "repo-map":
      repoMap(options);
      break;
    case "affected":
      affected(positional, options);
      break;
    case "verify-plan":
      verifyPlan(positional, options);
      break;
    case "receipt":
      receipt(positional, options);
      break;
    case "waiver":
      waiver(positional, options);
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`harness: ${error.message}\n`);
    process.exitCode = 1;
  });
}
