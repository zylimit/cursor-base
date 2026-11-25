// 不带出去的东西：隐去规则只有这一份（契约 G 节「不带出去的东西」）。
// note put 拒收、页面隐去、核对器比对都用它。
// 内网地址三段、带口令的地址（用户名为空的 ://:口令@ 也算）、sk-ant- / sk-proj- 开头的串、
// 几种形状固定的令牌（GitHub、AWS 访问键、Google 接口键、Slack、JWT，私钥是从 BEGIN 到 END 整块：照框架自带的密钥扫描
// .claude/harness/audit/scan-secrets.mjs 里标了 confident 的那几条写，两边不互相 import——那边扫仓库、这边隐页面，各管各的；
// 文件头说明全文上了架构页之后补的，那一段最容易夹着粘进来的令牌）、
// password / passwd / secret / token / api_key / 密码 / 口令 / 密钥（前后用下划线连着别的词也算，如 AWS_SECRET_ACCESS_KEY、db_password）
// 后面用 =、: 或全角的 ： 接着八位以上的值（值里可以有符号）、且带数字或总长不少于十六位的。
// 隐去只换掉口令或地址本身：值与地址里的用户名、口令都只取连着的 ASCII 可见字符，到空白、引号、中文或全角标点为止。
// 中文里很少有空格，取到空白为止会把口令后面整句话一起换掉，而核对两边换得一样、看不出来（第二期审查实测）。

export const REDACTED = '〔已隐去〕';

// 值里能有的字：ASCII 可见字符去掉三种引号；VAL_ND 再去掉数字（判「带数字」用）。
// 地址里的用户名与口令同样只认 ASCII 可见字符：用户名不含 / : @ 与引号，口令不含 / @ 与引号（口令里可以有冒号）。
const VAL = '[!#-&(-_a-~]';
const VAL_ND = '[!#-&(-/:-_a-~]';
const URL_USER = '[!#-&(-.0-9;-?A-~]';
const URL_PASS = '[!#-&(-.0-9:-?A-~]';

// 每条规则：kind 是给人看的原因，re 必须带 g，replace 决定换掉哪一段。
// 地址前后不许紧挨数字或点，免得把版本号、更长的数串里的一截当成地址。
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const ipTail = (n) => Array.from({ length: n }, () => `\\.${OCTET}`).join('');
const IP_PRE = '(?<![\\d.])';
const IP_POST = '(?!\\.?\\d)';

const RULES = [
  {
    kind: '密钥',
    // 私钥整块（契约 G 节）：从 BEGIN 那一行到 END 那一行，中间的正文一起换掉——只换 BEGIN 那一行，正文照样上页面。
    // 中间只认 ASCII（含换行），也不许跨过另一个 BEGIN：块与块之间、块后面的中文说明不被当成正文吞掉。
    // 没有 END 的，换到 BEGIN 后面连着的那几行整行只含字母、数字与 + / = 的为止（行尾要紧接换行或文字结尾，
    // 「Some English note.」这样开头像正文的一行不算），下一行不是这样的就停，不连带吞掉后面的话。
    // 排在第一条：别的规则先在正文里换掉一截，换进去的记号不是 ASCII，整块就认不全了。
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:(?:(?!-----BEGIN )[\t\n\r -~])*?-----END [A-Z ]*PRIVATE KEY-----|(?:\r?\n[A-Za-z0-9+/=]+(?=\r?\n|\r?$))*)/g,
    replace: () => REDACTED,
  },
  {
    kind: '带口令的地址',
    // redis 的 ://:口令@主机 这种只有口令、没有用户名的也是；冒号后面到 @ 之间隔着中文的（网址的端口之后接一句话、再接一个邮箱地址）不算。
    re: new RegExp(`://${URL_USER}*:${URL_PASS}+@`, 'g'),
    replace: () => `://${REDACTED}@`,
  },
  {
    kind: '内网地址',
    re: new RegExp(`${IP_PRE}10${ipTail(3)}${IP_POST}`, 'g'),
    replace: () => REDACTED,
  },
  {
    kind: '内网地址',
    re: new RegExp(`${IP_PRE}172\\.(?:1[6-9]|2\\d|3[01])${ipTail(2)}${IP_POST}`, 'g'),
    replace: () => REDACTED,
  },
  {
    kind: '内网地址',
    re: new RegExp(`${IP_PRE}192\\.168${ipTail(2)}${IP_POST}`, 'g'),
    replace: () => REDACTED,
  },
  {
    kind: '密钥',
    re: /(?<![A-Za-z0-9_-])sk-(?:ant|proj)-[A-Za-z0-9_-]*/g,
    replace: () => REDACTED,
  },
  // 形状固定的令牌：前缀加定长或够长的一串，没有无害的读法（私钥整块在第一条）。
  ...[
    /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub：ghp_ / gho_ / ghu_ / ghs_ / ghr_
    /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
    /\bAKIA[0-9A-Z]{16}\b/g, // AWS 访问键
    /\bAIza[0-9A-Za-z_-]{35}/g, // Google 接口键
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT：三段以点隔开，前两段是 JSON 开头
  ].map((re) => ({ kind: '密钥', re, replace: () => REDACTED })),
  {
    kind: '口令或密钥',
    // 真的密钥几乎都带数字或很长；纯字母又不长的（如英文注释「token: refreshes the login session」里的 refreshes）是正常的词，不当密钥。
    // 关键字前面连着的词（AWS_）不进匹配、原样留着；后面用下划线连着的词（_ACCESS_KEY、_key）进匹配，最多八节，免得一长串 a_a_a… 反复回溯。
    // 值只取连着的 ASCII 可见字符，可以带符号（hunter2!x9）；列定义里 password_xxx TEXT 这种后面不是 =、: 或 ： 的是列名，不算。
    // 「token:Bearer令牌……」里的 Bearer 不够八位，一个字都不换。
    re: new RegExp(`(password|passwd|secret|token|api_key|密码|口令|密钥)((?:_[A-Za-z0-9]+){0,8})(\\s*[=:：]\\s*['"\`]?)(?=${VAL}{8})(?:(?=${VAL_ND}*\\d)|(?=${VAL}{16}))${VAL}+`, 'gi'),
    replace: (_m, key, tail, sep) => `${key}${tail}${sep}${REDACTED}`,
  },
];

// 返回换过的文字与换了几处。
export function redact(text) {
  if (typeof text !== 'string' || text === '') return { text: text ?? '', hits: 0 };
  let out = text;
  let hits = 0;
  for (const rule of RULES) {
    out = out.replace(rule.re, (...args) => {
      hits += 1;
      return rule.replace(...args);
    });
  }
  return { text: out, hits };
}

// 命中了哪几类（按规则顺序去重），给 note put 拒收时说原因。
export function sensitiveKinds(text) {
  if (typeof text !== 'string' || text === '') return [];
  const kinds = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    if (rule.re.test(text) && !kinds.includes(rule.kind)) kinds.push(rule.kind);
    rule.re.lastIndex = 0;
  }
  return kinds;
}
