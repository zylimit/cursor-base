// Platform layer: repository discovery, atomic state IO, hashing, glob matching, git access,
// the canonical diff binding, secret redaction, and the shared hook vocabulary. Imports only
// Node built-ins; every other module may import it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
export const VERSION = "2.0.0";
export const STATE_REL = ".cursor/harness-state";
export const INSTALL_MANIFEST_REL = `${STATE_REL}/install-manifest.json`;
export const SOURCE_MANIFEST_REL = "FRAMEWORK-MANIFEST.json";
export const EVENTS = [
    "beforeShellExecution",
    "beforeMCPExecution",
    "beforeReadFile",
    "preToolUse",
    "afterFileEdit",
    "afterShellExecution",
    "postToolUse",
    "subagentStart",
    "subagentStop",
    "preCompact",
    "stop",
    "sessionStart",
];
export const SECURITY_EVENTS = [
    "beforeShellExecution",
    "beforeMCPExecution",
    "beforeReadFile",
    "preToolUse",
];
/**
 * Process exit-code contract shared by every command. `DEGRADED` is never a pass: it means
 * the harness refused to guess (no catalog, no git, no requirement documents). `STALE` means
 * evidence exists but no longer binds the current tree.
 */
export const EXIT = Object.freeze({
    OK: 0,
    VIOLATION: 1,
    GATE: 2,
    DEGRADED: 3,
    STALE: 4,
});
export const INSTALL_ROOT_FILES = new Set([
    ".cursorignore",
    ".cursorindexingignore",
    "AGENTS.md",
    "scripts/harness.mjs",
]);
export function findHarnessRoot(start) {
    let current = resolve(start);
    while (true) {
        if (existsSync(resolve(current, "harness/default-module-catalog.json")) &&
            existsSync(resolve(current, "scripts/harness.mjs"))) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) {
            throw new Error("Cannot locate the harness root.");
        }
        current = parent;
    }
}
export const HARNESS_ROOT = findHarnessRoot(dirname(fileURLToPath(import.meta.url)));
// Installing copies `harness/` and `scripts/harness.mjs`, so an installed repository also
// satisfies findHarnessRoot. Only the source checkout carries `src/harness.mts`.
export function isHarnessSourceRoot(root) {
    return existsSync(resolve(root, "src/harness.mts"));
}
export function posix(value) {
    return value.split(sep).join("/");
}
export function normalizeLf(value) {
    return value.replace(/\r\n?/g, "\n");
}
export function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch (error) {
        throw new Error(`Invalid JSON at ${path}: ${errorMessage(error)}`);
    }
}
// A partially written state file is worse than a missing one, because every later read
// treats it as authoritative. Writes therefore land through a rename, which is atomic.
export function writeJson(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
}
export const LOCK_STALE_MS = 60_000;
export const LOCK_WAIT_MS = 10_000;
// Several hook processes can run at once, and each one read-modify-writes shared state.
// Without a lock the last writer silently discards whatever the others recorded.
export function withStateLock(root, name, action) {
    const directory = resolve(root, STATE_REL, "locks");
    mkdirSync(directory, { recursive: true });
    const lockPath = resolve(directory, `${name}.lock`);
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
        try {
            writeFileSync(lockPath, JSON.stringify({ token, pid: process.pid, created_at: Date.now() }), {
                encoding: "utf8",
                flag: "wx",
            });
            break;
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
            let holder = {};
            try {
                holder = JSON.parse(readFileSync(lockPath, "utf8"));
            }
            catch {
                holder = {};
            }
            const age = Date.now() - Number(holder.created_at || 0);
            if (age > LOCK_STALE_MS) {
                rmSync(lockPath, { force: true });
                continue;
            }
            if (Date.now() > deadline) {
                throw new Error(`Timed out waiting for the ${name} state lock.`);
            }
            // Busy-wait briefly; hooks are short-lived and a sleep dependency is not worth it.
            const until = Date.now() + 25;
            while (Date.now() < until) {
                /* spin */
            }
        }
    }
    try {
        return action();
    }
    finally {
        try {
            const holder = JSON.parse(readFileSync(lockPath, "utf8"));
            if (holder?.token === token)
                rmSync(lockPath, { force: true });
        }
        catch {
            rmSync(lockPath, { force: true });
        }
    }
}
export function parseArgs(argv) {
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
        }
        else {
            options[key] = true;
        }
    }
    return { options, positional };
}
export function boolOption(options, key) {
    const value = options[key];
    return value === true || value === "true" || value === "1";
}
export function targetFrom(options) {
    return resolve(String(options.target || process.cwd()));
}
// Node's default pipe limit is 1 MiB. A repository large enough to matter exceeds that on a
// routine `git ls-files`, and the truncated result is indistinguishable from "nothing found".
export const PROCESS_MAX_BUFFER = 256 * 1024 * 1024;
export function run(command, args, cwd, allowFailure = false) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: PROCESS_MAX_BUFFER,
    });
    if (result.error) {
        const code = result.error.code;
        // Output that did not fit is a broken measurement, never an empty one. Reporting it as
        // absent would let a truncated diff pass for a verified one.
        if (code === "ENOBUFS") {
            throw new Error(`${command} ${args[0] ?? ""} produced more than ${PROCESS_MAX_BUFFER} bytes; the result cannot be trusted.`);
        }
        if (allowFailure)
            return { ok: false, stdout: "", stderr: result.error.message };
        throw new Error(`Unable to run ${command}: ${result.error.message}`);
    }
    const output = {
        ok: result.status === 0,
        stdout: normalizeLf(result.stdout || ""),
        stderr: normalizeLf(result.stderr || ""),
    };
    if (!output.ok && !allowFailure) {
        throw new Error(`${command} ${args.join(" ")} failed: ${(output.stderr || output.stdout).trim()}`);
    }
    return output;
}
export function git(cwd, args, allowFailure = false) {
    return run("git", args, cwd, allowFailure);
}
export const gitReadiness = new Map();
// Two different situations were previously conflated: a directory that is not a repository,
// which is a legitimate degraded mode, and a git command that failed, which must fail closed.
// Memoized because it used to spawn a subprocess on every call, several times per hook.
export function gitAvailable(cwd) {
    const key = resolve(cwd);
    const cached = gitReadiness.get(key);
    if (cached !== undefined)
        return cached;
    const ready = git(cwd, ["--version"], true).ok &&
        git(cwd, ["rev-parse", "--is-inside-work-tree"], true).stdout.trim() === "true";
    gitReadiness.set(key, ready);
    return ready;
}
export function gitBase(cwd, requested) {
    if (!gitAvailable(cwd))
        return "NO_GIT";
    const candidate = requested || "HEAD";
    const result = git(cwd, ["rev-parse", "--verify", `${candidate}^{commit}`], true);
    if (result.ok)
        return result.stdout.trim();
    if (requested)
        throw new Error(`Invalid Git base: ${requested}.`);
    return "NO_COMMIT";
}
export function changedPaths(cwd, base) {
    if (!gitAvailable(cwd))
        return [];
    const args = base && base !== "NO_COMMIT" && base !== "NO_GIT"
        ? ["diff", "--name-only", "-z", "--relative", base, "--", "."]
        : ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
    const result = git(cwd, args, true);
    // Failing to list changes is not the same as there being none. Returning an empty set here
    // would report an unverified change set as fully verified.
    if (!result.ok) {
        throw new Error(`Unable to determine changed paths: ${(result.stderr || "git failed").trim()}`);
    }
    const excludeState = (path) => path !== STATE_REL && !path.startsWith(`${STATE_REL}/`);
    if (args[0] === "status") {
        // With `-z`, porcelain v1 emits `XY <path>` NUL, and a rename adds the old path as its own
        // NUL-terminated record, so the record after an R or C status is consumed rather than parsed.
        const records = result.stdout.split("\0").filter(Boolean);
        const paths = [];
        for (let index = 0; index < records.length; index += 1) {
            const record = records[index];
            if (record.length < 4)
                continue;
            const status = record.slice(0, 2);
            paths.push(posix(record.slice(3)));
            if (/[RC]/.test(status) && index + 1 < records.length) {
                paths.push(posix(records[index + 1]));
                index += 1;
            }
        }
        return paths.filter(excludeState);
    }
    const tracked = splitNulPaths(result.stdout).filter(excludeState);
    return [...new Set([...tracked, ...untrackedPaths(cwd)])].sort();
}
/**
 * Size of the change against `base`: added plus removed lines for tracked files (binary files
 * count as a file, not as lines) and every line of each untracked file, with the same scoping
 * and state exclusion as `changedPaths`, so the two always describe the same set. Null when Git
 * cannot answer; a guess would be reported as a measurement.
 */
export function diffStats(cwd, base) {
    if (!gitAvailable(cwd) || base === "NO_GIT")
        return null;
    const excludeState = (path) => path !== STATE_REL && !path.startsWith(`${STATE_REL}/`);
    let changedLines = 0;
    // Without a commit there is no base to diff against: the index (`--cached`) and the worktree
    // changes on top of it are the two passes the diff digest binds in that state.
    const passes = base === "NO_COMMIT"
        ? [["diff", "--cached", "--numstat", "-z", "--relative", "--", "."], ["diff", "--numstat", "-z", "--relative", "--", "."]]
        : [["diff", "--numstat", "-z", "--relative", base, "--", "."]];
    for (const args of passes) {
        const result = git(cwd, args, true);
        if (!result.ok)
            return null;
        // `-z` terminates each record with NUL; renames add the two paths as further NUL records.
        for (const record of result.stdout.split("\0")) {
            const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(record);
            if (!match || !excludeState(posix(match[3])))
                continue;
            if (match[1] !== "-")
                changedLines += Number(match[1]);
            if (match[2] !== "-")
                changedLines += Number(match[2]);
        }
    }
    let untracked;
    try {
        untracked = untrackedPaths(cwd);
    }
    catch {
        return null;
    }
    for (const path of untracked) {
        try {
            const contents = readFileSync(resolve(cwd, path));
            if (!contents.includes(0)) {
                // Same convention as numstat: a line is a newline-terminated line, plus a final
                // unterminated one when the file does not end with a newline.
                const text = contents.toString("utf8");
                changedLines += text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
            }
        }
        catch {
            // Unreadable or vanished; it still counts as a new file.
        }
    }
    return { changed_lines: changedLines, new_files: untracked.length };
}
export const DIFF_EXCLUDE = `:(exclude)${STATE_REL}/**`;
export function diffArgumentSets(base) {
    const tail = ["--", ".", DIFF_EXCLUDE];
    const common = ["diff", "--binary", "--no-ext-diff", "--relative"];
    if (base !== "NO_COMMIT" && base !== "NO_GIT") {
        return [[...common, base, ...tail]];
    }
    if (base === "NO_COMMIT") {
        return [
            ["diff", "--cached", "--binary", "--no-ext-diff", "--relative", ...tail],
            [...common, ...tail],
        ];
    }
    return [];
}
// `--output` has to precede the `--` separator; placed after it, git treats the value as a
// pathspec and writes nothing, which is indistinguishable from an empty diff.
export function withDiffOutput(args, output) {
    const separator = args.indexOf("--");
    const at = separator === -1 ? args.length : separator;
    return [...args.slice(0, at), `--output=${output}`, ...args.slice(at)];
}
/** Streaming CRLF normalization, carrying a trailing `\r` across chunk boundaries. */
export function normalizeLfChunk(chunk, carry) {
    let value = chunk.toString("binary");
    if (carry)
        value = `\r${value}`;
    const endsWithCr = value.endsWith("\r");
    if (endsWithCr)
        value = value.slice(0, -1);
    return { text: value.replace(/\r\n?/g, "\n"), carry: endsWithCr };
}
// The diff is written to a file rather than piped, so its size is bounded by disk rather than by
// a pipe buffer. Hashing it in chunks keeps a multi-hundred-megabyte diff out of memory.
export function canonicalDiffDigest(cwd, base) {
    if (!gitAvailable(cwd)) {
        return sha256(normalizeLf(`NO_GIT\n${snapshotFiles(cwd).map((entry) => `${entry.path}\0${entry.sha256}`).join("\n")}`));
    }
    const hash = createHash("sha256");
    const scratch = mkdtempSync(resolve(tmpdir(), "cursor-harness-diff-"));
    try {
        let index = 0;
        for (const args of diffArgumentSets(base)) {
            const output = resolve(scratch, `part-${index}`);
            index += 1;
            const produced = git(cwd, withDiffOutput(args, output), true);
            if (!produced.ok) {
                throw new Error(`Unable to compute the canonical diff: ${(produced.stderr || "git failed").trim()}`);
            }
            if (!existsSync(output))
                continue;
            const descriptor = openSync(output, "r");
            try {
                const buffer = Buffer.allocUnsafe(1024 * 1024);
                let carry = false;
                for (;;) {
                    const read = readSync(descriptor, buffer, 0, buffer.length, null);
                    if (read === 0)
                        break;
                    const normalized = normalizeLfChunk(buffer.subarray(0, read), carry);
                    carry = normalized.carry;
                    hash.update(normalized.text, "binary");
                }
                if (carry)
                    hash.update("\n", "binary");
            }
            finally {
                closeSync(descriptor);
            }
        }
    }
    finally {
        rmSync(scratch, { recursive: true, force: true });
    }
    for (const path of untrackedPaths(cwd)) {
        const absolute = resolve(cwd, path);
        if (!existsSync(absolute) || !statSync(absolute).isFile())
            continue;
        const bytes = readFileSync(absolute);
        hash.update(`\n-- cursor-harness-untracked:${posix(path)}:${sha256(bytes)}:${bytes.length} --\n`);
    }
    return hash.digest("hex");
}
// `git` escapes and quotes any path containing a non-ASCII byte unless the output is
// NUL-separated. Splitting on NUL keeps a CJK filename usable instead of turning it into an
// octal string that no pattern can ever match.
export function splitNulPaths(value) {
    return value.split("\0").filter(Boolean).map(posix);
}
export function untrackedPaths(cwd) {
    const result = git(cwd, ["ls-files", "-z", "--others", "--exclude-standard", "--", "."], true);
    if (!result.ok) {
        throw new Error("Unable to enumerate untracked files; the diff binding cannot be trusted.");
    }
    return splitNulPaths(result.stdout)
        .filter((path) => path !== STATE_REL && !path.startsWith(`${STATE_REL}/`))
        .sort();
}
/** Bounded diff text, for callers that display it rather than bind to it. */
export function canonicalDiffText(cwd, base, limit) {
    if (!gitAvailable(cwd))
        return "";
    const scratch = mkdtempSync(resolve(tmpdir(), "cursor-harness-text-"));
    try {
        let collected = "";
        let index = 0;
        for (const args of diffArgumentSets(base)) {
            if (collected.length >= limit)
                break;
            const output = resolve(scratch, `part-${index}`);
            index += 1;
            git(cwd, withDiffOutput(args, output), true);
            if (!existsSync(output))
                continue;
            const descriptor = openSync(output, "r");
            try {
                const buffer = Buffer.allocUnsafe(Math.min(limit + 1, 8 * 1024 * 1024));
                const read = readSync(descriptor, buffer, 0, buffer.length, 0);
                collected += normalizeLf(buffer.subarray(0, read).toString("utf8"));
            }
            finally {
                closeSync(descriptor);
            }
        }
        return collected.slice(0, limit);
    }
    finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}
// Computing a binding costs a full `git diff` over the repository. A single hook invocation used
// to pay that two or three times, which is the dominant cost of every interactive hook.
export const bindingCache = new Map();
export function binding(cwd, requestedBase) {
    const key = `${resolve(cwd)}\0${String(requestedBase ?? "")}`;
    const cached = bindingCache.get(key);
    if (cached)
        return cached;
    const base_commit = gitBase(cwd, requestedBase);
    const value = {
        base_commit,
        diff_sha256: canonicalDiffDigest(cwd, base_commit),
    };
    bindingCache.set(key, value);
    return value;
}
// Compiled patterns are cached because classification is pattern-count times path-count. On a
// repository large enough to matter, recompiling the same regex per path dominated the cost of
// `catalog lint` long before file I/O did.
export const GLOB_REGEX_CACHE = new Map();
export function globRegex(pattern) {
    const cached = GLOB_REGEX_CACHE.get(pattern);
    if (cached)
        return cached;
    let source = "";
    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index];
        if (char === "*" && pattern[index + 1] === "*") {
            source += ".*";
            index += 1;
        }
        else if (char === "*") {
            source += "[^/]*";
        }
        else if (char === "?") {
            source += "[^/]";
        }
        else {
            source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
        }
    }
    const compiled = new RegExp(`^${source}$`);
    // The cache is bounded so a pathological catalog cannot grow it without limit.
    if (GLOB_REGEX_CACHE.size < 10_000)
        GLOB_REGEX_CACHE.set(pattern, compiled);
    return compiled;
}
export function matchesPath(path, patterns) {
    const candidate = posix(path).replace(/^\.\//, "");
    return patterns.some((pattern) => {
        const normalized = posix(pattern).replace(/^\.\//, "");
        if (globRegex(normalized).test(candidate))
            return true;
        // The prefix fallback must stop at a path separator. Without it the pattern `src` also
        // claimed `srcbackup/`, so a module silently owned a directory it never declared.
        const prefix = normalized.endsWith("/**")
            ? normalized.slice(0, -2)
            : normalized.endsWith("/")
                ? normalized
                : `${normalized}/`;
        return candidate.startsWith(prefix);
    });
}
// `excludeTests` exists only for the install manifest, which must not ship the harness's own
// tests. Every other caller enumerates the real tree, so a task owning `tests/**` gets a
// baseline and arch-check can see test code.
export function walkFiles(root, current = root, excludeTests = false) {
    if (!existsSync(current))
        return [];
    const files = [];
    for (const entry of readdirSync(current, { withFileTypes: true })) {
        const absolute = resolve(current, entry.name);
        const rel = posix(relative(root, absolute));
        if (entry.isDirectory() &&
            (entry.name === ".git" ||
                entry.name === "node_modules" ||
                (excludeTests && (rel === "tests" || rel.startsWith("tests/"))))) {
            continue;
        }
        if (entry.isDirectory()) {
            files.push(...walkFiles(root, absolute, excludeTests));
        }
        else if (entry.isFile() &&
            !entry.name.endsWith(".cursor-harness-new") &&
            (!rel.startsWith(`${STATE_REL}/`) || rel === `${STATE_REL}/.gitignore`)) {
            files.push(absolute);
        }
    }
    return files;
}
/**
 * The live contract files belong to the repository that runs the harness. This repository's own
 * copies describe this repository; the installer seeds a target's from the `default-*` templates
 * (or from discovery) and never distributes these.
 */
export const LIVE_CONTRACTS = [
    ["harness/module-catalog.json", "harness/default-module-catalog.json"],
    ["harness/verification-matrix.json", "harness/default-verification-matrix.json"],
    ["harness/assurance-policy.json", "harness/default-assurance-policy.json"],
];
/** Suffix of a discovery draft written beside an edited live contract. */
export const DRAFT_SUFFIX = ".draft.json";
export function draftPath(live) {
    return live.replace(/\.json$/, DRAFT_SUFFIX);
}
/**
 * The template a live contract is seeded from and compared against: the repository's installed
 * copy when it has one, else the harness's. One resolver for the seed, the read fallback, and
 * the "still the template" comparison, so they can never disagree.
 */
export function templatePath(root, live) {
    const pair = LIVE_CONTRACTS.find(([candidate]) => candidate === live);
    if (!pair)
        throw new Error(`Unknown live contract: ${live}.`);
    return [resolve(root, pair[1]), resolve(HARNESS_ROOT, pair[1])].find((candidate) => existsSync(candidate)) ?? null;
}
export function isInstallable(root, absolute) {
    const rel = posix(relative(root, absolute));
    if (INSTALL_ROOT_FILES.has(rel))
        return true;
    if (LIVE_CONTRACTS.some(([live]) => live === rel))
        return false;
    // A discovery draft describes the repository it was produced in, never a target.
    if (rel.startsWith("harness/") && rel.endsWith(DRAFT_SUFFIX))
        return false;
    if (rel.startsWith("harness/"))
        return true;
    if (!rel.startsWith(".cursor/"))
        return false;
    return !rel.startsWith(`${STATE_REL}/`) || rel === `${STATE_REL}/.gitignore`;
}
export function snapshotFiles(root, installableOnly = false) {
    return walkFiles(root, root, true)
        .filter((absolute) => !installableOnly || isInstallable(root, absolute))
        .map((absolute) => {
        const path = posix(relative(root, absolute));
        const raw = readFileSync(absolute);
        const text = raw.includes(0) ? raw : Buffer.from(normalizeLf(raw.toString("utf8")), "utf8");
        return { path, sha256: sha256(text), bytes: text.length };
    })
        .sort((left, right) => left.path.localeCompare(right.path));
}
export function isWithin(root, candidate) {
    const rel = relative(root, candidate);
    return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}
export function fileHash(path) {
    if (!existsSync(path) || !statSync(path).isFile())
        return null;
    const raw = readFileSync(path);
    return sha256(raw.includes(0) ? raw : normalizeLf(raw.toString("utf8")));
}
export function copyNormalized(source, destination) {
    mkdirSync(dirname(destination), { recursive: true });
    const raw = readFileSync(source);
    if (raw.includes(0)) {
        cpSync(source, destination);
    }
    else {
        writeFileSync(destination, normalizeLf(raw.toString("utf8")), "utf8");
    }
}
export const SECRET_PATTERNS = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
    [/\b(gh[pousr]_)[A-Za-z0-9]{16,}\b/g, "$1[REDACTED]"],
    [/\b(xox[abposr]-)[A-Za-z0-9-]{10,}\b/g, "$1[REDACTED]"],
    [/\b(sk|pk|rk)-[A-Za-z0-9]{16,}\b/g, "[REDACTED]"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
    // The value can carry an auth scheme, so the credential sits after the scheme keyword.
    // Whitespace is restricted to spaces and tabs so a trailing `password =` cannot swallow the
    // first token of the following line.
    [
        /((?:authorization|api[-_]?key|token|password|passwd|secret)["']?[ \t]*[:=][ \t]*)(?:bearer|basic|token|digest)?[ \t]*\S+/gi,
        "$1[REDACTED]",
    ],
    // Environment-variable form, which is how credentials actually appear in shell output:
    // AWS_SECRET_ACCESS_KEY=..., DATABASE_PASSWORD=..., FOO_TOKEN=...
    [/\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*=)\S+/g, "$1[REDACTED]"],
    // Credentials embedded in a URL's userinfo component.
    [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@]+@/gi, "$1[REDACTED]@"],
    [/([?&](?:access_token|api_key|token|key|password|secret)=)[^&\s]+/gi, "$1[REDACTED]"],
];
export function redactSecrets(text) {
    let value = text;
    for (const [pattern, replacement] of SECRET_PATTERNS)
        value = value.replace(pattern, replacement);
    return value;
}
/** Keeps the tail, which is where a failing command puts its error. */
export function boundedText(text, limit) {
    if (text.length <= limit)
        return text;
    const notice = `[... ${text.length - limit} characters omitted ...]\n`;
    return `${notice}${text.slice(-(Math.max(limit - notice.length, 0)))}`;
}
// Keeps the head, for a command or path where the leading tokens identify the subject. Truncating
// a command from the front discards the program name, which is what an audit needs most.
export function boundedHead(text, limit) {
    if (text.length <= limit)
        return text;
    const notice = ` [... ${text.length - limit} characters omitted ...]`;
    return `${text.slice(0, Math.max(limit - notice.length, 0))}${notice}`;
}
// Evidence and context packs accumulate one file per check run. Keeping the newest N bounds the
// directory without discarding anything a current receipt still points at.
export function pruneDirectory(directory, keep) {
    try {
        const entries = readdirSync(directory)
            .map((name) => {
            const path = resolve(directory, name);
            try {
                return { path, mtime: statSync(path).mtimeMs, temporary: name.endsWith(".tmp") };
            }
            catch {
                return null;
            }
        })
            .filter((entry) => entry !== null);
        // A `.tmp` file is the residue of a write that was killed mid-flight and is never referenced.
        for (const entry of entries.filter((item) => item.temporary))
            rmSync(entry.path, { force: true });
        const live = entries.filter((item) => !item.temporary).sort((a, b) => b.mtime - a.mtime);
        for (const entry of live.slice(keep))
            rmSync(entry.path, { force: true });
    }
    catch {
        // Pruning is housekeeping; failing to prune must never fail the check that triggered it.
    }
}
export function whichCommand(name) {
    if (name.includes("/") || name.includes("\\")) {
        const direct = resolve(name);
        return existsSync(direct) && statSync(direct).isFile() ? direct : null;
    }
    const separator = process.platform === "win32" ? ";" : ":";
    // On Windows the PATHEXT candidates come first, as cmd.exe resolves them, so `npm` finds
    // `npm.cmd` and not the POSIX `npm` script that ships beside it; the bare name is tried last
    // for a word that already carries its extension (`node.exe`).
    const extensions = process.platform === "win32"
        ? [...(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean), ""]
        : [""];
    for (const directory of (process.env.PATH || "").split(separator).filter(Boolean)) {
        for (const extension of extensions) {
            const candidate = resolve(directory, `${name}${extension}`);
            try {
                if (statSync(candidate).isFile())
                    return candidate;
            }
            catch {
                continue;
            }
        }
    }
    return null;
}
export function parseFrontmatter(contents) {
    const match = /^---\n([\s\S]*?)\n---/.exec(normalizeLf(contents));
    if (!match)
        return {};
    const fields = {};
    for (const line of match[1].split("\n")) {
        const separator = line.indexOf(":");
        if (separator === -1)
            continue;
        fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    return fields;
}
export function sensitivePath(filePath) {
    // Backslashes are folded first so the verdict is identical on every host. A security check
    // whose answer depends on the platform running it is not a check.
    const normalized = posix(resolve(filePath.replace(/\\/g, "/"))).toLowerCase().replace(/\\/g, "/");
    const name = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (/^\.env($|\.)/.test(name) && !/\.(example|sample|template)$/.test(name))
        return true;
    if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(name))
        return true;
    if (/^(id_rsa|id_ecdsa|id_ed25519|credentials|credentials\.json|secrets?\.json|service-account\.json|\.netrc|\.npmrc|\.pypirc)$/.test(name)) {
        return true;
    }
    // Matches the directory itself as well as anything under it, since a trailing separator is
    // absent when the path names the directory.
    return /(^|\/)(\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker)(\/|$)/.test(normalized);
}
/**
 * Directories no scanner or context pack reads: generated output, vendored code, caches, and
 * the harness's own state. One vocabulary for "not source", shared by context packs, fitness,
 * and anything else that walks the tree for content.
 */
export const CONTEXT_DENIED_DIRECTORIES = [
    ".git",
    "node_modules",
    "vendor",
    "third_party",
    "dist",
    "build",
    "out",
    "coverage",
    ".cache",
    ".venv",
    ".next",
    ".cursor/harness-state",
];
/** True for secret-bearing paths and for anything under a denied directory. */
export function contextDenied(path) {
    const candidate = posix(path);
    if (sensitivePath(candidate))
        return true;
    return CONTEXT_DENIED_DIRECTORIES.some((directory) => candidate === directory || candidate.startsWith(`${directory}/`));
}
export async function stdinJson() {
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin)
        input += chunk;
    if (!input.trim())
        return {};
    try {
        return JSON.parse(input);
    }
    catch (error) {
        throw new Error(`Hook input is not valid JSON: ${errorMessage(error)}`);
    }
}
export function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const record = value;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
export function contentHash(value, field) {
    const copy = { ...value };
    delete copy[field];
    return sha256(canonicalJson(copy));
}
export function validTimestamp(value) {
    return (typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
        Number.isFinite(Date.parse(value)));
}
export function printJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
