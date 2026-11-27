// .cursor/scripts/ps-floor.mjs — Dual-shell (POSIX Bash + Windows PowerShell + CMD) safety floor library.
// Pure functions `checkDangerousCommand(cmd)`, `checkSecretExfil(cmd)`, and `isSafePowerShellEnvCommand(cmd)`
// with zero external dependencies. Enforced unconditionally across all tiers (even when `.claude/` is not yet installed).

const MAX_CMD_BYTES = 16 * 1024;
const MAX_SUBSTITUTIONS = 500;

// ---------------------------------------------------------------------------
// Part 1: Dangerous & Destructive Command Guard (`checkDangerousCommand`)
// ---------------------------------------------------------------------------

function splitUnquotedSegments(cmd) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (q) {
      if (ch === '\\' && q === '"' && i + 1 < cmd.length) {
        cur += ch + cmd[i + 1];
        i += 1;
        continue;
      }
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === '$' && cmd[i + 1] === '(') {
      out.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    if (ch === '$' && cmd[i + 1] === '{') {
      const vm = /^\$\{[A-Za-z_][A-Za-z0-9_:]*\}/.exec(cmd.slice(i));
      if (vm) {
        cur += vm[0];
        i += vm[0].length - 1;
        continue;
      }
    }
    if (/[;&|\n`(){}]/.test(ch)) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function findParenEnd(cmd, start, escapeBackslash) {
  let depth = 1;
  let q = null;
  for (let i = start; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (q === "'") {
      if (ch === "'") q = null;
      continue;
    }
    if (escapeBackslash && ch === '\\') {
      i += 1;
      continue;
    }
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractDoubleQuotedSubstitutions(cmd) {
  const subs = [];
  let q = null;
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (q === "'") {
      if (ch === "'") q = null;
      continue;
    }
    if (q === '"') {
      if (ch === '\\' && i + 1 < cmd.length && /[\\"$`]/.test(cmd[i + 1])) {
        i += 1;
        continue;
      }
      if (ch === '"') {
        q = null;
        continue;
      }
      if (ch === '$' && cmd[i + 1] === '(') {
        const start = i + 2;
        let end = findParenEnd(cmd, start, true);
        if (end === -1) end = findParenEnd(cmd, start, false);
        if (end !== -1) {
          subs.push(cmd.slice(start, end));
          i = end;
        } else {
          subs.push(cmd.slice(start));
          break;
        }
        continue;
      }
      if (ch === '`') {
        let end = -1;
        for (let j = i + 1; j < cmd.length; j += 1) {
          if (cmd[j] === '\\' && j + 1 < cmd.length && /[\\"$`]/.test(cmd[j + 1])) {
            j += 1;
            continue;
          }
          if (cmd[j] === '"') break;
          if (cmd[j] === '`') {
            end = j;
            break;
          }
        }
        if (end !== -1) {
          subs.push(cmd.slice(i + 1, end).replace(/\\([`\\$"])/g, '$1'));
          i = end;
          continue;
        }
      }
      continue;
    }
    if (ch === '\\' && i + 1 < cmd.length && /[\\"']/.test(cmd[i + 1])) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
    }
  }
  return subs;
}

function splitTokens(s) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const WRAPPER_VERBS = new Set(['sudo', 'nohup', 'command', 'env', '&']);
const SHELL_CARRIERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const PS_REMOVE_VERBS = new Set(['remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);

function unquote(t) {
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function isCatastrophicTarget(rawTarget) {
  const t = unquote(rawTarget).trim();
  if (!t || t.startsWith('-')) return false;
  if (/^[/\\]+\*?$/.test(t)) return true;
  if (/^[A-Za-z]:(?:[/\\]+\*?|[/\\]*)?$/.test(t)) return true;
  if (/^(?:~(?:[/\\]\*?)?|\$\{?HOME\}?(?:[/\\]\*?)?|\$\{?env:(?:USERPROFILE|HOME|HOMEDRIVE)\}?(?:[/\\]\*?)?|%USERPROFILE%(?:[/\\]\*?)?)$/i.test(t)) {
    return true;
  }
  if (/^\.\.(?:[/\\].*|$)/.test(t)) return true;
  return false;
}

function checkRmSegment(tokens, vi) {
  let hasRecursive = false;
  let hasForce = false;
  const targets = [];
  let optsDone = false;
  for (let i = vi + 1; i < tokens.length; i += 1) {
    const raw = tokens[i];
    const bare = unquote(raw);
    if (!optsDone && bare === '--') { optsDone = true; continue; }
    if (!optsDone && bare.startsWith('--')) {
      if (bare === '--recursive') hasRecursive = true;
      else if (bare === '--force') hasForce = true;
      else if (bare === '--no-preserve-root') return '检测到 rm --no-preserve-root 毁灭性选项';
      continue;
    }
    if (!optsDone && bare.startsWith('-') && bare.length > 1) {
      if (/[rR]/.test(bare)) hasRecursive = true;
      if (/[fF]/.test(bare)) hasForce = true;
      continue;
    }
    targets.push(raw);
  }
  if (hasRecursive && hasForce && targets.some(isCatastrophicTarget)) {
    return '检测到 rm -rf 指向根目录 / 家目录 / 上级目录的高危删除命令';
  }
  return null;
}

function checkPowerShellRemoveSegment(tokens, vi) {
  let hasRecurse = false;
  let hasForce = false;
  const targets = [];
  for (let i = vi + 1; i < tokens.length; i += 1) {
    const bare = unquote(tokens[i]);
    const lower = bare.toLowerCase();
    if (/^-(?:r|rec|recurse)(?::\$?true)?$/.test(lower)) { hasRecurse = true; continue; }
    if (/^-(?:fo|force)(?::\$?true)?$/.test(lower)) { hasForce = true; continue; }
    if (lower === '-path' || lower === '-literalpath' || lower === '-lp') continue;
    if (bare.startsWith('-')) continue;
    targets.push(tokens[i]);
  }
  if (hasRecurse && hasForce && targets.some(isCatastrophicTarget)) {
    return '检测到 PowerShell Remove-Item -Recurse -Force 指向根目录 / 盘符 / 家目录 / 上级目录的高危删除';
  }
  return null;
}

function checkGitSegment(tokens, vi) {
  let i = vi + 1;
  while (i < tokens.length) {
    const bare = unquote(tokens[i]);
    if (bare === '-C' || bare === '-c' || bare === '--git-dir' || bare === '--work-tree') {
      i += 2;
      continue;
    }
    if (bare.startsWith('-')) { i += 1; continue; }
    break;
  }
  if (i >= tokens.length) return null;
  const sub = unquote(tokens[i]);
  const rest = tokens.slice(i + 1).map(unquote);

  if (sub === 'reset' && rest.includes('--hard')) {
    return '检测到 git reset --hard（会丢弃未提交工作区改动，需拆分为安全操作或由用户确认）';
  }
  if (sub === 'clean' && rest.some((a) => /^-[A-Za-z]*f/.test(a) && (/[dx]/.test(a) || rest.some((b) => /^-[A-Za-z]*[dx]/.test(b))))) {
    return '检测到 git clean -fd/-fdx（会永久删除未跟踪文件）';
  }
  if (sub === 'push' && rest.some((a) => a === '-f' || a === '--force' || a.startsWith('--force='))) {
    return '检测到 git push --force / -f（强制覆盖远端分支属于 HIGH 档受控操作）';
  }
  return null;
}

const PWSH_ENC_FLAG = '(?:ec|e(?:n(?:c(?:o(?:d(?:e(?:d(?:c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?)?)?)?)?)?)?)?)';
const PWSH_ENC_RE = new RegExp(
  `\\b(?:powershell|pwsh)(?:\\.exe)?\\b[^\\n;|&]*?\\s[-/]${PWSH_ENC_FLAG}(?:\\s+|:)\\s*["']?([A-Za-z0-9+/=]{4,})["']?`,
  'gi',
);

function checkDangerousEncodedPwsh(cmd, depth) {
  if (depth > 3) return null;
  PWSH_ENC_RE.lastIndex = 0;
  for (const m of cmd.matchAll(PWSH_ENC_RE)) {
    let buf;
    try { buf = Buffer.from(m[1], 'base64'); } catch { continue; }
    if (!buf.length) continue;
    const u16 = buf.toString('utf16le').replace(/\0/g, '').trim();
    const u8 = buf.toString('utf8').replace(/\0/g, '').trim();
    for (const decoded of new Set([u16, u8].filter(Boolean))) {
      const hit = checkDangerousInternal(decoded, depth + 1);
      if (hit) return `检测到 PowerShell -EncodedCommand 编码隐藏危险命令（${hit}）`;
    }
  }
  return null;
}

function checkDangerousSegment(seg, depth) {
  if (depth > 4) return null;
  const tokens = splitTokens(seg);
  let vi = 0;
  while (vi < tokens.length) {
    const t = unquote(tokens[vi]);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || /^\$env:[A-Za-z_][A-Za-z0-9_]*=/i.test(t)) {
      vi += 1;
      continue;
    }
    if (WRAPPER_VERBS.has(t)) {
      vi += 1;
      continue;
    }
    break;
  }
  if (vi >= tokens.length) return null;

  const verbRaw = unquote(tokens[vi]);
  const verb = verbRaw.replace(/^.*[/\\]/, '');
  const lower = verb.toLowerCase();

  if (SHELL_CARRIERS.has(lower) || lower === 'eval' || lower === 'iex' || lower === 'invoke-expression') {
    for (let i = vi + 1; i < tokens.length; i += 1) {
      const tok = tokens[i];
      if (tok.length >= 2 && (tok[0] === '"' || tok[0] === "'") && tok[tok.length - 1] === tok[0]) {
        const innerHit = checkDangerousInternal(tok.slice(1, -1), depth + 1);
        if (innerHit) return innerHit;
      }
    }
  }

  if (lower === 'cmd' || lower === 'cmd.exe') {
    const restJoined = tokens.slice(vi + 1).map(unquote).join(' ');
    if (/(?:^|\s)\/[ck]\s+.*\b(?:rd|rmdir)\b(?=[^\n]*\/s\b)(?=[^\n]*\/q\b)/i.test(restJoined)) {
      return '检测到 cmd /c rd /s /q 强制递归静默删除命令';
    }
    if (/(?:^|\s)\/[ck]\s+.*\bformat\s+[A-Za-z]:/i.test(restJoined)) {
      return '检测到 cmd /c format 磁盘格式化命令';
    }
  }
  if (
    (lower === 'rd' || lower === 'rmdir') &&
    tokens.slice(vi + 1).some((a) => /^\/s$/i.test(unquote(a))) &&
    tokens.slice(vi + 1).some((a) => /^\/q$/i.test(unquote(a)))
  ) {
    const targets = tokens.slice(vi + 1).filter((a) => !unquote(a).startsWith('/'));
    if (targets.length === 0 || targets.some(isCatastrophicTarget)) {
      return '检测到 rd /s /q 指向高危目录的强制删除命令';
    }
  }

  if (verb === 'pkill' && tokens.slice(vi + 1).some((a) => /^-[A-Za-z]*f/.test(unquote(a)))) {
    return '检测到 pkill -f 宽泛匹配（极易误杀主 Agent 宿主进程；请先用 ps/pgrep 查精确 PID 再 kill <PID>）';
  }

  if (verb === 'rm' || lower === 'rm') {
    const hit = checkRmSegment(tokens, vi) || checkPowerShellRemoveSegment(tokens, vi);
    if (hit) return hit;
  }

  if (PS_REMOVE_VERBS.has(lower)) {
    const hit = checkPowerShellRemoveSegment(tokens, vi);
    if (hit) return hit;
  }

  if (lower === 'git' || lower === 'git.exe') {
    const hit = checkGitSegment(tokens, vi);
    if (hit) return hit;
  }

  if (
    /^mkfs(?:\.[A-Za-z0-9_-]+)?$/.test(lower) ||
    lower === 'fdisk' ||
    lower === 'parted' ||
    lower === 'diskpart' ||
    lower === 'format-volume' ||
    lower === 'clear-disk' ||
    lower === 'initialize-disk' ||
    lower === 'remove-partition'
  ) {
    return `检测到磁盘/分区级高危破坏命令（${verb}）`;
  }
  if (lower === 'format' && tokens.slice(vi + 1).some((a) => /^[A-Za-z]:$/i.test(unquote(a)))) {
    return '检测到 format <盘符> 磁盘格式化命令';
  }
  if (verb === 'dd' && tokens.slice(vi + 1).some((a) => /^of=\/dev\//.test(unquote(a)))) {
    return '检测到 dd of=/dev/* 直接覆写块设备命令';
  }

  return null;
}

function checkDangerousInternal(cmd, depth = 0) {
  if (depth > 4) return null;
  const encHit = checkDangerousEncodedPwsh(cmd, depth);
  if (encHit) return encHit;
  for (const inner of extractDoubleQuotedSubstitutions(cmd)) {
    const subHit = checkDangerousInternal(inner, depth + 1);
    if (subHit) return subHit;
  }
  for (const seg of splitUnquotedSegments(cmd)) {
    const hit = checkDangerousSegment(seg, depth);
    if (hit) return hit;
  }
  return null;
}

/**
 * Check a shell / PowerShell command string for dangerous/destructive commands.
 * @param {string} cmd
 * @returns {string | null} block reason if dangerous, else `null`
 */
export function checkDangerousCommand(cmd) {
  const s = String(cmd ?? '');
  if (!s.trim()) return null;
  return checkDangerousInternal(s, 0);
}

// ---------------------------------------------------------------------------
// Part 2: Secret Read / Copy / Exfiltration Guard (`checkSecretExfil`)
// ---------------------------------------------------------------------------

const SECRET_NAMES = '\\.env(\\.[A-Za-z0-9_-]+)?|id_rsa[A-Za-z0-9_.-]*|id_ed25519[A-Za-z0-9_.-]*|\\S*\\.(pem|ppk|p12|pfx|key)|\\.?credentials\\.json|\\.aws/credentials|\\.ssh/\\S+';
const SECRET_CORE = `(${SECRET_NAMES})([\\s"']|$)`;
const SECRET_PATH = new RegExp(`^([^\\s"']*/)?(${SECRET_NAMES})$`, 'i');

const TYPICAL_SECRET_NAMES = [
  '.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519',
  'key.pem', 'key.ppk', 'server.key', '.aws/credentials', '.ssh/id_rsa',
];

const ARGPFX = "\\s+([^|;&]*[\\s/\\\\\"'=@])?";
const ANCHOR = '(^|;|&&|\\|\\||`|\\$\\(|\\(|\\{)\\s*';
const NET_SINKS = '(curl|wget|nc|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)';
const HOST_TOKENS = '(CODEAGENT3_X_AUTH_TOKEN|X_AUTH_TOKEN|DEVUC_REFRESH_TOKEN|ENTERPRISE_API_KEY)';

const SECRET_RULES = [
  {
    re: new RegExp(
      `(\\$\\{?(?:env:)?${HOST_TOKENS}\\b|%${HOST_TOKENS}%|\\bEnv:[/\\\\]?${HOST_TOKENS}\\b|\\bprintenv\\s+["']?${HOST_TOKENS}\\b|process\\.env\\.${HOST_TOKENS}\\b|process\\.env\\[["']${HOST_TOKENS}["']\\]|os\\.environ[^\\n]{0,40}${HOST_TOKENS}|GetEnvironmentVariable\\s*\\(\\s*["']${HOST_TOKENS}["'])`,
      'im',
    ),
    reason: '检测到读取或打印宿主受保护凭据环境变量（CODEAGENT3_X_AUTH_TOKEN / X_AUTH_TOKEN / DEVUC_REFRESH_TOKEN / ENTERPRISE_API_KEY）',
  },
  {
    re: new RegExp(
      `${ANCHOR}(?:(?:env|printenv|set)\\b|(?:Get-ChildItem|gci|dir|ls|Get-Item|gi)\\s+Env:[A-Za-z0-9_*\\\\/]*)(?=\\s|\\||$)[^|]*\\|[^;\\n]*\\b${NET_SINKS}\\b`,
      'im',
    ),
    reason: '检测到环境变量整包管道外传（env / printenv / Get-ChildItem Env: | curl/iwr/irm）',
  },
  {
    re: new RegExp(
      `\\b${NET_SINKS}\\b[^;\\n]*\\b(?:Get-ChildItem|gci|dir|Get-Item|gi)\\s+Env:`,
      'im',
    ),
    reason: '检测到网络请求携带 Env: 环境变量枚举输出（Invoke-WebRequest/Invoke-RestMethod/curl + Get-ChildItem Env:）',
  },
  {
    re: new RegExp(
      `(\\$\\{?env:[A-Za-z0-9_]*(?:SECRET|TOKEN|KEY|PASS|PWD|CRED)[A-Za-z0-9_]*\\}?[^;\\n]*\\|\\s*${NET_SINKS}\\b|\\b${NET_SINKS}\\b[^;\\n]*\\$\\{?env:[A-Za-z0-9_]*(?:SECRET|TOKEN|KEY|PASS|PWD|CRED)[A-Za-z0-9_]*\\}?)`,
      'im',
    ),
    reason: '检测到 PowerShell 敏感环境变量（$env:*SECRET/TOKEN/KEY*）向网络端点外传',
  },
  {
    re: new RegExp(`${ANCHOR}${NET_SINKS}${ARGPFX}${SECRET_CORE}`, 'im'),
    reason: '检测到网络命令携带密钥文件（curl/wget/nc/iwr/irm + 密钥文件名）',
  },
];

const ARG_REASON = '检测到命令参数是密钥文件路径（.env/id_rsa/*.pem/*.key/credentials），且动词不在只碰元数据的放行表里';

const METADATA_VERBS = new Set([
  'ls', 'stat', 'test', '[', '[[', 'file', 'du', 'chmod', 'chown', 'chgrp',
  'rm', 'unlink', 'touch', 'mkdir', 'rmdir', 'cd', 'pushd', 'popd',
  'basename', 'dirname', 'realpath', 'readlink', 'which', 'echo', 'printf', 'find',
  'test-path',
]);

const GIT_METADATA_SUBCOMMANDS = new Set(['ls-files', 'check-ignore', 'status', 'log']);
const GIT_LOG_CONTENT_FLAGS = /^(-p|--patch|-u|-L|-G|-S|--full-diff)/;

function gitLogHasContentFlag(tokens, subIdx) {
  for (let i = subIdx + 1; i < tokens.length; i += 1) {
    const bare = tokens[i].replace(/["']/g, '');
    if (GIT_LOG_CONTENT_FLAGS.test(bare)) return true;
  }
  return false;
}

const INTERPRETER_VERBS = new Set([
  'python', 'python2', 'python3', 'node', 'nodejs', 'ruby', 'perl', 'php', 'deno', 'bun', 'eval',
]);
const SHELL_C_VERBS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const PWSH_VERBS = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);

function shellCPayloadIndex(verb, tokens, vi) {
  const lower = verb.toLowerCase();
  if (PWSH_VERBS.has(lower)) {
    let i = vi + 1;
    while (i < tokens.length) {
      const bare = tokens[i].replace(/["']/g, '').toLowerCase();
      if (bare === '-c' || bare === '-command') return i + 1 < tokens.length ? i + 1 : -1;
      if (bare === '-executionpolicy' || bare === '-ep' || bare === '-windowstyle' || bare === '-inputformat' || bare === '-outputformat') {
        i += 2;
        continue;
      }
      if (bare.startsWith('-')) { i += 1; continue; }
      return i;
    }
    return -1;
  }
  if (!SHELL_C_VERBS.has(verb)) return -1;
  let i = vi + 1;
  while (i < tokens.length) {
    const bare = tokens[i].replace(/["']/g, '');
    if (bare === '-c') return i + 1 < tokens.length ? i + 1 : -1;
    if (bare === '-o') { i += 2; continue; }
    if (/^-[A-Za-z]+$/.test(bare)) {
      if (bare.includes('c')) return i + 1 < tokens.length ? i + 1 : -1;
      i += 1;
      continue;
    }
    return -1;
  }
  return -1;
}

const SINGLE_CARRIER_VERBS = new Set([
  'ssh', 'sudo', 'timeout', 'watch', 'nohup', 'xargs', 'parallel', 'eval',
  'iex', 'invoke-expression',
]);

const TWO_LEVEL_CARRIER_SUBS = {
  docker: new Set(['exec', 'run']),
  kubectl: new Set(['exec']),
  podman: new Set(['exec']),
};

const GREP_VERBS = new Set(['grep', 'egrep', 'fgrep', 'rg']);

const EXAMPLE_PLACEHOLDER = 'SAMPLEFILE';
function stripExamples(s) {
  return s.replace(/\.env\.(example|sample|template|schema|dist)[A-Za-z0-9_.-]*/gi, EXAMPLE_PLACEHOLDER);
}

const COPY_MOVE_VERBS = new Set(['cp', 'mv']);
const COPY_MOVE_FLAG = /^-[rRfnvpaiuLP]+$/;
const COPY_MOVE_SAMPLE_SRC = new RegExp(`^([^\\s"'<>|;&$\`]*[/\\\\])?${EXAMPLE_PLACEHOLDER}$`);
const COPY_MOVE_SEG_META = /[<>`$]/;
const COPY_MOVE_IMPERSONATION = /(^|[\s;&|(`{'"])((function\s+)?(cp|mv)\s*\(\s*\)|function\s+(cp|mv)([\s{(]|$)|alias\s+(-\S+\s+)*(cp|mv)=|Set-Alias\s+[^\n;]*(cp|mv)|(PATH|BASH_ENV|ENV|LD_[A-Za-z0-9_]+|DYLD_[A-Za-z0-9_]+)\+?=|\$env:PATH\s*\+?=)/i;

const PREFIX_WRAPPERS = [
  /^\s+/,
  /^sudo\s+/,
  /^nohup\s+/,
  /^nice(\s+-n\s*[0-9]+)?\s+/,
  /^timeout(\s+--?[A-Za-z-]+(\s+\S+)?)*\s+[0-9]+[smhd]?\s+/,
  /^env(\s+[A-Za-z_][A-Za-z0-9_]*=\S*)*\s+/,
];

const SHELL_C_PREFIX = /^(?:(?:ba|z|da|k)?sh\s+-l?c|(?:powershell|pwsh)(?:\.exe)?(?:\s+-(?:NoProfile|nop|NonInteractive|noni|ExecutionPolicy\s+\S+|ep\s+\S+))*\s+-(?:c|Command))\s+(["'])/i;

function stripWrappers(cmd) {
  let c = cmd;
  let prev = null;
  for (let i = 0; i < 5 && c !== prev; i += 1) {
    prev = c;
    for (const re of PREFIX_WRAPPERS) c = c.replace(re, '');
    const m = SHELL_C_PREFIX.exec(c);
    if (m) {
      const q = m[1];
      c = c.slice(m[0].length);
      if (c.endsWith(q)) c = c.slice(0, -1);
    }
  }
  return c;
}

function splitSimple(cmd) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === '$' && cmd[i + 1] === '(') {
      out.push(cur); cur = ''; i += 1;
    } else if (ch === '$' && cmd[i + 1] === '{') {
      const vm = /^\$\{[A-Za-z_][A-Za-z0-9_:]*\}/.exec(cmd.slice(i));
      if (vm) {
        cur += vm[0];
        i += vm[0].length - 1;
      } else {
        out.push(cur); cur = '';
      }
    } else if (/[;&|\n`(){}]/.test(ch)) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const GLOB_PATTERN_MAX = 512;

function parseCharClass(pattern, start) {
  let i = start;
  let negate = false;
  if (pattern[i] === '!' || pattern[i] === '^') { negate = true; i += 1; }
  const items = [];
  while (i < pattern.length && pattern[i] !== ']') {
    const ch = pattern[i];
    if (pattern[i + 1] === '-' && i + 2 < pattern.length && pattern[i + 2] !== ']') {
      const from = ch;
      const to = pattern[i + 2];
      if (from.charCodeAt(0) > to.charCodeAt(0)) return null;
      items.push({ from, to });
      i += 3;
    } else {
      items.push({ from: ch, to: ch });
      i += 1;
    }
  }
  if (i >= pattern.length) return null;
  const matcher = (c) => {
    const hit = items.some((it) => c >= it.from && c <= it.to);
    return negate ? !hit : hit;
  };
  return { matcher, next: i + 1 };
}

function tokenizeGlob(pattern) {
  const tokens = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') { tokens.push({ t: 'star' }); i += 1; }
    else if (ch === '?') { tokens.push({ t: 'any' }); i += 1; }
    else if (ch === '[') {
      const cls = parseCharClass(pattern, i + 1);
      if (cls) { tokens.push({ t: 'class', matcher: cls.matcher }); i = cls.next; }
      else { tokens.push({ t: 'lit', ch: '[' }); i += 1; }
    } else {
      tokens.push({ t: 'lit', ch });
      i += 1;
    }
  }
  return tokens;
}

function tokenMatchesChar(tok, ch) {
  if (tok.t === 'lit') return tok.ch === ch;
  if (tok.t === 'any') return true;
  if (tok.t === 'class') return tok.matcher(ch);
  return false;
}

function globMatch(tokens, text) {
  let ti = 0;
  let si = 0;
  let starTi = -1;
  let starSi = -1;
  const n = tokens.length;
  const m = text.length;
  while (si < m) {
    if (ti < n && tokens[ti].t === 'star') {
      starTi = ti; starSi = si; ti += 1;
    } else if (ti < n && tokenMatchesChar(tokens[ti], text[si])) {
      ti += 1; si += 1;
    } else if (starTi !== -1) {
      ti = starTi + 1; starSi += 1; si = starSi;
    } else {
      return false;
    }
  }
  while (ti < n && tokens[ti].t === 'star') ti += 1;
  return ti === n;
}

function globHits(bare) {
  if (!/[*?[]/.test(bare)) return false;
  if (bare.length > GLOB_PATTERN_MAX) return false;
  const tokens = tokenizeGlob(bare);
  if (
    tokens.some((t) => t.t === 'lit' || t.t === 'class') &&
    TYPICAL_SECRET_NAMES.some((name) => globMatch(tokens, name))
  ) {
    return true;
  }
  const slash = bare.lastIndexOf('/');
  if (slash === -1) return false;
  const filename = bare.slice(slash + 1);
  const fnTokens = tokenizeGlob(filename);
  if (!fnTokens.some((t) => t.t === 'lit' || t.t === 'class')) return false;
  return TYPICAL_SECRET_NAMES.some((name) => globMatch(fnTokens, name.slice(name.lastIndexOf('/') + 1)));
}

function colonSuffixHits(bare) {
  const idx = bare.lastIndexOf(':');
  if (idx === -1) return false;
  if (bare.slice(idx + 1, idx + 3) === '//') return false;
  const suffix = bare.slice(idx + 1);
  if (!suffix) return false;
  return SECRET_PATH.test(suffix) || globHits(suffix);
}

function shellWordText(t) {
  let out = '';
  let q = null;
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (q === "'") { if (ch === "'") q = null; else out += ch; continue; }
    if (ch === '\\' && i + 1 < t.length) { out += t[i + 1]; i += 1; continue; }
    if (ch === '"') { q = q === '"' ? null : '"'; continue; }
    if (ch === "'" && !q) { q = "'"; continue; }
    out += ch;
  }
  return out;
}

function winWordPosix(t) {
  let out = '';
  let q = null;
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (q) {
      if (ch === q) q = null;
      else out += (ch === '\\' ? '/' : ch);
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    out += (ch === '\\' ? '/' : ch);
  }
  return out;
}

function singlePathHits(candidate) {
  if (!candidate) return false;
  if (SECRET_PATH.test(candidate) || globHits(candidate) || colonSuffixHits(candidate)) return true;
  const eq = candidate.indexOf('=');
  if (eq > 0) {
    const val = candidate.slice(eq + 1);
    if (SECRET_PATH.test(val) || globHits(val)) return true;
  }
  return false;
}

function tokenHits(raw, scanNested) {
  const t = raw.replace(/^[0-9]*<{1,3}/, '').replace(/^@/, '');
  const posixEscaped = shellWordText(t);
  const winPosix = winWordPosix(t);
  if (singlePathHits(posixEscaped) || (winPosix !== posixEscaped && singlePathHits(winPosix))) {
    return true;
  }
  if (!scanNested) return false;
  const quoted = t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0];
  const inner = quoted ? t.slice(1, -1) : t;
  for (const m of inner.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    const s = m[1] === undefined ? m[2] : m[1];
    const sPosix = s.replace(/\\/g, '/');
    if (SECRET_PATH.test(s) || globHits(s) || SECRET_PATH.test(sPosix) || globHits(sPosix)) return true;
  }
  return false;
}

function isNestedQuoteVerb(verb, tokens, vi) {
  const lower = verb.toLowerCase();
  if (INTERPRETER_VERBS.has(lower)) return true;
  return shellCPayloadIndex(verb, tokens, vi) !== -1;
}

function gitSubcommandIndex(tokens, vi) {
  for (let i = vi + 1; i < tokens.length; i += 1) {
    const bare = tokens[i].replace(/["']/g, '');
    if (!bare.startsWith('-')) return i;
  }
  return -1;
}

function isAllowedVerb(verb, tokens, vi) {
  const lower = verb.toLowerCase();
  if (METADATA_VERBS.has(verb) || lower === 'test-path') return true;
  if (lower === 'git' || lower === 'git.exe') {
    const subIdx = gitSubcommandIndex(tokens, vi);
    if (subIdx === -1) return false;
    const sub = tokens[subIdx].replace(/["']/g, '');
    if (!GIT_METADATA_SUBCOMMANDS.has(sub)) return false;
    if (sub === 'log' && gitLogHasContentFlag(tokens, subIdx)) return false;
    return true;
  }
  return false;
}

function copyMoveSampleTargetIndex(seg, tokens, vi, isPowerShellCmdlet = false) {
  if (COPY_MOVE_SEG_META.test(seg)) return -1;
  if (/\\-/.test(seg)) return -1;
  if (isPowerShellCmdlet) {
    let namedSrcIdx = -1;
    let namedDstIdx = -1;
    const posIndices = [];
    for (let i = vi + 1; i < tokens.length; i += 1) {
      const rawTok = tokens[i];
      if (rawTok.startsWith('-')) {
        const flag = rawTok.toLowerCase();
        if (flag === '-path' || flag === '-literalpath' || flag === '-lp') {
          if (namedSrcIdx !== -1 || i + 1 >= tokens.length || tokens[i + 1].startsWith('-')) return -1;
          namedSrcIdx = i + 1;
          i += 1;
          continue;
        }
        if (flag === '-destination' || flag === '-dest') {
          if (namedDstIdx !== -1 || i + 1 >= tokens.length || tokens[i + 1].startsWith('-')) return -1;
          namedDstIdx = i + 1;
          i += 1;
          continue;
        }
        if (flag === '-force' || flag === '-recurse') continue;
        return -1;
      }
      posIndices.push(i);
    }
    let srcIdx = namedSrcIdx;
    let dstIdx = namedDstIdx;
    let p = 0;
    if (srcIdx === -1 && p < posIndices.length) srcIdx = posIndices[p++];
    if (dstIdx === -1 && p < posIndices.length) dstIdx = posIndices[p++];
    if (p !== posIndices.length || srcIdx === -1 || dstIdx === -1) return -1;
    const src = tokens[srcIdx].replace(/["']/g, '');
    if (!COPY_MOVE_SAMPLE_SRC.test(src) || tokenHits(tokens[srcIdx], false)) return -1;
    return dstIdx;
  }
  const operands = [];
  for (let i = vi + 1; i < tokens.length; i += 1) {
    if (tokens[i].startsWith('-')) {
      if (!COPY_MOVE_FLAG.test(tokens[i])) return -1;
      continue;
    }
    operands.push(i);
  }
  if (operands.length !== 2) return -1;
  const src = tokens[operands[0]].replace(/["']/g, '');
  if (!COPY_MOVE_SAMPLE_SRC.test(src) || tokenHits(tokens[operands[0]], false)) return -1;
  return operands[1];
}

function grepTokensToCheck(tokens, vi) {
  const toCheck = [];
  let patternHandled = false;
  let optionsEnded = false;
  let i = vi + 1;
  while (i < tokens.length) {
    const raw = tokens[i];
    const bare = raw.replace(/["']/g, '');
    if (!optionsEnded && bare === '--') {
      optionsEnded = true;
      i += 1;
      if (!patternHandled && i < tokens.length) {
        patternHandled = true;
        i += 1;
      }
      continue;
    }
    if (!optionsEnded && (bare === '-e' || bare === '--regexp')) {
      patternHandled = true;
      i += 2;
      continue;
    }
    if (!optionsEnded && /^--regexp=/.test(bare)) {
      patternHandled = true;
      i += 1;
      continue;
    }
    if (!optionsEnded && (bare === '-f' || bare === '--file')) {
      patternHandled = true;
      toCheck.push(raw);
      i += 1;
      continue;
    }
    if (!optionsEnded && bare.startsWith('-')) {
      toCheck.push(raw);
      i += 1;
      continue;
    }
    if (!patternHandled) {
      patternHandled = true;
      i += 1;
      continue;
    }
    toCheck.push(raw);
    i += 1;
  }
  return toCheck;
}

function isFullyQuoted(t) {
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0];
}

function isCommandCarrier(verb, tokens, vi) {
  const lower = verb.toLowerCase();
  if (SINGLE_CARRIER_VERBS.has(verb) || SINGLE_CARRIER_VERBS.has(lower)) return true;
  if (verb === 'su') return tokens.some((t) => t.replace(/["']/g, '') === '-c');
  if (shellCPayloadIndex(verb, tokens, vi) !== -1) return true;
  const subs = TWO_LEVEL_CARRIER_SUBS[lower];
  if (!subs) return false;
  const next = tokens[vi + 1] ? tokens[vi + 1].replace(/["']/g, '').toLowerCase() : null;
  return next !== null && subs.has(next);
}

const SAFE_FOREACH_PROPS = new Set([
  'name', 'fullname', 'basename', 'extension', 'directory', 'directoryname',
  'length', 'exists', 'attributes', 'mode', 'lastwritetime', 'creationtime',
]);

function extractBraceBlocks(s) {
  const blocks = [];
  let q = null;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) {
      if (ch === '\\' && q === '"' && i + 1 < s.length) { i += 1; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '$' && s[i + 1] === '{') {
      const vm = /^\$\{[A-Za-z_][A-Za-z0-9_:]*\}/.exec(s.slice(i));
      if (vm) { i += vm[0].length - 1; continue; }
    }
    if (ch === '{') {
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        blocks.push(s.slice(start, i));
        start = -1;
      }
    }
  }
  return blocks;
}

function substitutionEnd(cmd, start, backtick) {
  if (backtick) {
    for (let i = start; i < cmd.length; i += 1) {
      if (cmd[i] === '\\') { i += 1; continue; }
      if (cmd[i] === '`') return i;
    }
    return -1;
  }
  let depth = 1;
  let q = null;
  for (let i = start; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (q === "'") { if (ch === "'") q = null; continue; }
    if (ch === '\\') { i += 1; continue; }
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function extractInlineSubstitutions(s) {
  const subs = [];
  let q = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q === "'") { if (ch === "'") q = null; continue; }
    if (ch === '\\') { i += 1; continue; }
    if (ch === '$' && s[i + 1] === '(') {
      const start = i + 2;
      const end = substitutionEnd(s, start, false);
      subs.push(s.slice(start, end === -1 ? s.length : end));
      if (end === -1) break;
      i = end;
      continue;
    }
    if (ch === '`') {
      const start = i + 1;
      const end = substitutionEnd(s, start, true);
      if (end !== -1) {
        subs.push(s.slice(start, end));
        i = end;
        continue;
      }
    }
    if (q === '"') { if (ch === '"') q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
  }
  return subs;
}

function foreachScriptTriggers(body, depth = 0) {
  if (depth > 3) return false;
  if (/\[[^\]]+\]::|\.\s*(?:OpenRead|OpenText|ReadAllText|ReadAllBytes|ReadAllLines)\b/i.test(body)) {
    return true;
  }
  if (SECRET_RULES.some((r) => r.re.test(body))) return true;
  for (const sub of extractInlineSubstitutions(body)) {
    if (foreachScriptTriggers(sub, depth + 1)) return true;
  }
  for (const seg of splitSimple(body)) {
    let s = stripWrappers(seg).trim();
    s = s.replace(/^(?:\$(?:env:)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*|[A-Za-z_][A-Za-z0-9_]*=\S*\s+|&\s+)+/i, '').trim();
    if (!s) continue;
    const stoks = splitTokens(s);
    if (!stoks.length) continue;
    const sverb = stoks[0].replace(/["']/g, '').replace(/^.*[/\\]/, '');
    const slower = sverb.toLowerCase();
    if (slower === 'foreach-object' || slower === '%') {
      if (laterSegmentTriggersBlock(s, depth + 1)) return true;
      continue;
    }
    if (!isAllowedVerb(sverb, stoks, 0)) return true;
  }
  return false;
}

function laterSegmentTriggersBlock(seg, depth = 0) {
  if (depth > 3) return false;
  const tokens = splitTokens(seg);
  let vi = 0;
  while (vi < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[vi]) || /^\$env:[A-Za-z_][A-Za-z0-9_]*=/i.test(tokens[vi]))) {
    vi += 1;
  }
  if (vi >= tokens.length) return false;
  const verb = tokens[vi].replace(/["']/g, '').replace(/^.*[/\\]/, '').toLowerCase();
  if (
    verb === 'get-content' || verb === 'gc' || verb === 'select-string' || verb === 'sls' ||
    verb === 'invoke-webrequest' || verb === 'invoke-restmethod' || verb === 'iwr' || verb === 'irm'
  ) {
    return true;
  }
  if (verb === 'foreach-object' || verb === '%') {
    const blocks = extractBraceBlocks(seg);
    if (blocks.length === 0) {
      for (let i = vi + 1; i < tokens.length; i += 1) {
        const bare = tokens[i].replace(/["']/g, '');
        if (bare.startsWith('-')) continue;
        if (!SAFE_FOREACH_PROPS.has(bare.toLowerCase()) && !isAllowedVerb(bare, tokens, i)) return true;
      }
      return false;
    }
    return blocks.some((b) => foreachScriptTriggers(b, depth + 1));
  }
  if (verb !== 'xargs' && verb !== 'parallel') return false;
  for (let i = vi + 1; i < tokens.length; i += 1) {
    const bare = tokens[i].replace(/["']/g, '');
    if (bare.startsWith('-')) continue;
    if (!isAllowedVerb(bare, tokens, i)) return true;
  }
  return false;
}

function splitChains(cmd) {
  const chains = [];
  let chain = [];
  let cur = '';
  let q = null;
  let braceDepth = 0;
  const endSeg = () => { chain.push(cur); cur = ''; };
  const endChain = () => { endSeg(); chains.push(chain); chain = []; };
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (q) {
      if (ch === '\\' && q === '"' && i + 1 < cmd.length) {
        cur += ch + cmd[i + 1];
        i += 1;
        continue;
      }
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '$' && cmd[i + 1] === '{') {
      const vm = /^\$\{[A-Za-z_][A-Za-z0-9_:]*\}/.exec(cmd.slice(i));
      if (vm) {
        cur += vm[0];
        i += vm[0].length - 1;
        continue;
      }
    }
    if (ch === '{') {
      if (braceDepth === 0 && cur.trim() === '') endChain();
      else { braceDepth += 1; cur += ch; }
      continue;
    }
    if (ch === '}') {
      if (braceDepth > 0) { braceDepth -= 1; cur += ch; }
      else endChain();
      continue;
    }
    if (braceDepth > 0) { cur += ch; continue; }
    if (ch === '$' && cmd[i + 1] === '(') { endChain(); i += 1; continue; }
    if (ch === '|' && cmd[i + 1] === '|') { endChain(); i += 1; continue; }
    if (ch === '&' && cmd[i + 1] === '&') { endChain(); i += 1; continue; }
    if (ch === '|') { endSeg(); continue; }
    if (/[;&\n`()]/.test(ch)) { endChain(); continue; }
    cur += ch;
  }
  endChain();
  return chains
    .map((segs) => segs.map((s) => s.trim()).filter(Boolean))
    .filter((segs) => segs.length > 0);
}

function segmentHasSecretToken(seg) {
  const tokens = splitTokens(seg);
  let vi = 0;
  while (vi < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[vi])) vi += 1;
  const verb = vi < tokens.length ? tokens[vi].replace(/["']/g, '').replace(/^.*[/\\]/, '') : '';
  const scanNested = vi < tokens.length && isNestedQuoteVerb(verb, tokens, vi);
  return tokens.some((t) => tokenHits(t, scanNested));
}

function pipelineForwardHits(cmd) {
  for (const chain of splitChains(cmd)) {
    if (chain.length < 2) continue;
    const segs = chain.map((seg) => stripWrappers(seg));
    for (let i = 0; i < segs.length - 1; i += 1) {
      if (!segmentHasSecretToken(segs[i])) continue;
      for (let j = i + 1; j < segs.length; j += 1) {
        if (laterSegmentTriggersBlock(segs[j])) return true;
      }
    }
  }
  return false;
}

const SUBST_PLACEHOLDER = '$(SUBST)';
function prefixVerbIndex(tokens) {
  let vi = 0;
  for (let guard = 0; guard < 8; guard += 1) {
    while (vi < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[vi])) vi += 1;
    const w = tokens[vi];
    if (w === 'sudo' || w === 'nohup' || w === 'env') { vi += 1; continue; }
    if (w === 'nice') { vi += tokens[vi + 1] === '-n' ? 3 : 1; continue; }
    if (w === 'timeout') {
      vi += 1;
      while (vi < tokens.length && tokens[vi].startsWith('-')) vi += 1;
      vi += 1;
      continue;
    }
    if (w !== undefined && /^(ba|z|da|k)?sh$/.test(w) && /^-l?c$/.test(tokens[vi + 1] || '')) { vi += 2; continue; }
    break;
  }
  return vi;
}

function checkSecretOne(cmd, encDepth = 0) {
  const state = { impersonatesCopyMove: false };

  function checkSimple(seg) {
    const tokens = splitTokens(seg);
    let vi = 0;
    while (vi < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[vi]) || /^\$env:[A-Za-z_][A-Za-z0-9_]*=/i.test(tokens[vi]))) {
      vi += 1;
    }
    if (vi >= tokens.length) return false;
    const rawVerb = tokens[vi].replace(/["']/g, '');
    const verb = rawVerb.replace(/^.*[/\\]/, '');
    const lowerVerb = verb.toLowerCase();

    if (verb === 'source' || verb === '.' || (verb === 'hash' && tokens.slice(vi + 1).some((t) => /^-[A-Za-z]*p/.test(t)))) {
      state.impersonatesCopyMove = true;
    }
    if (verb === 'builtin' || verb === 'command') {
      const next = tokens.slice(vi + 1).find((t) => !t.startsWith('-'));
      if (next !== undefined && /^(source|\.)$/.test(next.replace(/["']/g, ''))) state.impersonatesCopyMove = true;
    }
    if (verb === 'trap' && tokens.slice(vi + 1).some((t) => /^(DEBUG|EXIT|ERR|RETURN)$/.test(t.replace(/["']/g, '')))) {
      const action = tokens.slice(vi + 1).find((t) => !t.startsWith('-'));
      if (action !== undefined && /(^|[\s;&|(])(source|\.)\s/.test(action.replace(/^["']|["']$/g, ''))) state.impersonatesCopyMove = true;
    }
    if (isAllowedVerb(verb, tokens, vi)) return false;

    const scanNested = isNestedQuoteVerb(verb, tokens, vi);
    let checkTokens = tokens;
    if (GREP_VERBS.has(verb)) {
      checkTokens = tokens.slice(0, vi + 1).concat(grepTokensToCheck(tokens, vi));
    } else if (
      (COPY_MOVE_VERBS.has(verb) && rawVerb === verb && !state.impersonatesCopyMove) ||
      ((lowerVerb === 'copy-item' || lowerVerb === 'move-item') && rawVerb.toLowerCase() === lowerVerb && !state.impersonatesCopyMove)
    ) {
      const isPsCmdlet = lowerVerb === 'copy-item' || lowerVerb === 'move-item';
      const ti = copyMoveSampleTargetIndex(seg, tokens, vi, isPsCmdlet);
      if (ti !== -1) checkTokens = tokens.filter((_, i) => i !== ti);
    }
    return checkTokens.some((t) => tokenHits(t, scanNested));
  }

  function carrierHits(seg, depth) {
    const tokens = splitTokens(seg);
    let vi = 0;
    while (vi < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[vi])) vi += 1;
    if (vi >= tokens.length) return false;
    if (isFullyQuoted(tokens[vi]) && /\s/.test(tokens[vi])) return scanSegments(tokens[vi].slice(1, -1), depth + 1);
    const verb = tokens[vi].replace(/["']/g, '').replace(/^.*[/\\]/, '');
    if (!isCommandCarrier(verb, tokens, vi)) return false;
    for (let i = vi + 1; i < tokens.length; i += 1) {
      const t = tokens[i];
      if (!isFullyQuoted(t)) continue;
      const inner = t.slice(1, -1);
      for (const r of SECRET_RULES) {
        if (r.re.test(inner)) return true;
      }
      if (scanSegments(inner, depth + 1)) return true;
    }
    return false;
  }

  function substitutionArgHits(subCmd, depth) {
    let tokens = [];
    let scanned = 0;
    let q = null;
    for (let i = 0; i < subCmd.length; i += 1) {
      const ch = subCmd[i];
      if (q === "'") { if (ch === "'") q = null; continue; }
      const isDollar = ch === '$' && subCmd[i + 1] === '(';
      if (ch === '\\') { i += 1; continue; }
      if (isDollar || ch === '`') {
        const innerStart = i + (isDollar ? 2 : 1);
        const found = substitutionEnd(subCmd, innerStart, !isDollar);
        const end = found === -1 ? subCmd.length : found;
        let inner = subCmd.slice(innerStart, end);
        if (!isDollar) inner = inner.replace(/\\([`\\$])/g, '$1');
        if (depth < 3 && scanSegments(inner, depth + 1)) return true;
        if (found === -1 && depth < 3 && scanSegments(inner.replace(/["']/g, ''), depth + 1)) return true;
        for (const t of splitTokens(subCmd.slice(scanned, i).replace(/["']/g, ''))) {
          if (t.replace(/@/g, '') !== '') tokens.push(t);
        }
        const vi = prefixVerbIndex(tokens);
        if (vi < tokens.length) {
          const verb = tokens[vi].replace(/^.*[/\\]/, '');
          if (!isAllowedVerb(verb, tokens, vi) && splitTokens(inner.replace(/\\(.)/g, '$1')).some((t) => tokenHits(t, false))) {
            return true;
          }
        }
        tokens.push(SUBST_PLACEHOLDER);
        i = end;
        scanned = end + 1;
        continue;
      }
      if (q === '"') { if (ch === '"') q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (/[;&|\n()]/.test(ch)) { tokens = []; scanned = i + 1; }
    }
    return false;
  }

  function scanSegments(subCmd, depth) {
    if (pipelineForwardHits(subCmd)) return true;
    if (substitutionArgHits(subCmd, depth)) return true;
    for (const seg of splitSimple(subCmd)) {
      const bare = stripWrappers(seg);
      if (bare !== seg && depth < 3) {
        if (scanSegments(bare, depth + 1)) return true;
        continue;
      }
      if (checkSimple(bare)) return true;
      if (depth < 3 && carrierHits(bare, depth)) return true;
    }
    return false;
  }

  if (encDepth < 3) {
    PWSH_ENC_RE.lastIndex = 0;
    for (const m of cmd.matchAll(PWSH_ENC_RE)) {
      let buf;
      try { buf = Buffer.from(m[1], 'base64'); } catch { continue; }
      if (!buf.length) continue;
      const candidates = new Set();
      const u16 = buf.toString('utf16le').replace(/\0/g, '').trim();
      if (u16) candidates.add(u16);
      const u8 = buf.toString('utf8').replace(/\0/g, '').trim();
      if (u8) candidates.add(u8);
      for (const decoded of candidates) {
        const hit = checkSecretOne(decoded, encDepth + 1);
        if (hit) return `检测到 PowerShell -EncodedCommand 编码载荷命中密钥防护（${hit}）`;
      }
    }
  }

  const c = stripExamples(cmd);
  state.impersonatesCopyMove = COPY_MOVE_IMPERSONATION.test(c);
  for (const r of SECRET_RULES) {
    if (r.re.test(c)) return r.reason;
  }
  return scanSegments(c, 0) ? ARG_REASON : null;
}

/**
 * Check a shell / PowerShell command string for secret file reads, copies, or exfiltration.
 * @param {string} cmd
 * @returns {string | null} block reason if secret policy triggered, else `null`
 */
export function checkSecretExfil(cmd) {
  const s = String(cmd ?? '');
  if (!s.trim()) return null;

  const substCount = (s.match(/\$\(/g) || []).length + Math.ceil((s.match(/`/g) || []).length / 2);
  if ((substCount >= 1 && Buffer.byteLength(s, 'utf8') > MAX_CMD_BYTES) || substCount > MAX_SUBSTITUTIONS) {
    return `命令过长或命令替换过多（${Buffer.byteLength(s, 'utf8')} 字节、${substCount} 个替换，上限 ${MAX_CMD_BYTES} 字节 / ${MAX_SUBSTITUTIONS} 个），安全闸直接阻断`;
  }

  const stripped = stripWrappers(s);
  return checkSecretOne(s, 0) || (stripped !== s ? checkSecretOne(stripped, 0) : null);
}

const SINGLE_PWSH_WRAPPER_RE = /^(?:powershell|pwsh)(?:\.exe)?(?:\s+-(?:NoProfile|nop|NonInteractive|noni|ExecutionPolicy\s+[A-Za-z]+|ep\s+[A-Za-z]+))*\s+-(?:c|Command)\s+(["'])([^"']+)\1$/i;

function isSafeDotEnvTargetPath(rawTok, allowWildcardTail = false) {
  const p = unquote(String(rawTok ?? '')).replace(/\\/g, '/').trim();
  if (!p || p.startsWith('-')) return false;
  const segs = p.split('/');
  if (segs.includes('..')) return false;
  const base = segs[segs.length - 1] || '';
  if (allowWildcardTail) {
    return /^\.env(?:\.[A-Za-z0-9_.*-]+|\*)?$/i.test(base);
  }
  return /^\.env(?:\.[A-Za-z0-9_.-]+)?$/i.test(base);
}

function isSafeDotEnvSampleSourcePath(rawTok) {
  const p = unquote(String(rawTok ?? '')).replace(/\\/g, '/').trim();
  if (!p || p.startsWith('-')) return false;
  if (/[*?[\]]/.test(p)) return false;
  const segs = p.split('/');
  if (segs.includes('..')) return false;
  const base = segs[segs.length - 1] || '';
  return /^\.env\.(?:example|sample|template|schema|dist)(?:\.[A-Za-z0-9_.-]+)?$/i.test(base);
}

/**
 * Returns `true` ONLY when `cmd` passes both `checkDangerousCommand` and `checkSecretExfil`,
 * AND consists solely of a single unpiped, unchained read-only `Test-Path <.env*>`
 * or sample initialization `Copy-Item / Move-Item <.env.example|.env.sample|.env.template|.env.schema|.env.dist> <.env*>`.
 * @param {string} cmd
 * @returns {boolean}
 */
export function isSafePowerShellEnvCommand(cmd) {
  const raw = String(cmd ?? '').trim();
  if (!raw) return false;
  if (checkDangerousCommand(raw) !== null || checkSecretExfil(raw) !== null) {
    return false;
  }

  const wm = SINGLE_PWSH_WRAPPER_RE.exec(raw);
  const inner = wm ? wm[2].trim() : raw;
  if (!inner || /[|;&\r\n`$(){}<>]/.test(inner)) {
    return false;
  }

  const tokens = splitTokens(inner);
  if (tokens.length < 2) return false;

  const verbRaw = unquote(tokens[0]).trim();
  if (!verbRaw || /[/\\]/.test(verbRaw)) return false;
  const lower = verbRaw.toLowerCase();

  if (lower === 'test-path') {
    const paths = [];
    for (let i = 1; i < tokens.length; i += 1) {
      const tok = tokens[i];
      if (tok.startsWith('-')) {
        const flag = tok.toLowerCase();
        if (flag === '-path' || flag === '-literalpath' || flag === '-lp') {
          if (i + 1 >= tokens.length || tokens[i + 1].startsWith('-')) return false;
          paths.push(tokens[i + 1]);
          i += 1;
          continue;
        }
        if (flag === '-pathtype' || flag === '-pt') {
          if (i + 1 >= tokens.length || !/^(?:leaf|container|any)$/i.test(unquote(tokens[i + 1]))) return false;
          i += 1;
          continue;
        }
        if (flag === '-isvalid') continue;
        return false;
      }
      paths.push(tok);
    }
    return paths.length >= 1 && paths.every((p) => isSafeDotEnvTargetPath(p, true));
  }

  if (lower === 'copy-item' || lower === 'move-item') {
    let namedSrc = null;
    let namedDst = null;
    const positional = [];
    for (let i = 1; i < tokens.length; i += 1) {
      const tok = tokens[i];
      if (tok.startsWith('-')) {
        const flag = tok.toLowerCase();
        if (flag === '-path' || flag === '-literalpath' || flag === '-lp') {
          if (namedSrc !== null || i + 1 >= tokens.length || tokens[i + 1].startsWith('-')) return false;
          namedSrc = tokens[i + 1];
          i += 1;
          continue;
        }
        if (flag === '-destination' || flag === '-dest') {
          if (namedDst !== null || i + 1 >= tokens.length || tokens[i + 1].startsWith('-')) return false;
          namedDst = tokens[i + 1];
          i += 1;
          continue;
        }
        if (flag === '-force') continue;
        return false;
      }
      positional.push(tok);
    }
    let src = namedSrc;
    let dst = namedDst;
    let p = 0;
    if (src === null && p < positional.length) src = positional[p++];
    if (dst === null && p < positional.length) dst = positional[p++];
    if (p !== positional.length || src === null || dst === null) return false;
    return isSafeDotEnvSampleSourcePath(src) && isSafeDotEnvTargetPath(dst, false);
  }

  return false;
}
