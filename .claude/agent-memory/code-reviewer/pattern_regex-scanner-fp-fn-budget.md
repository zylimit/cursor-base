---
name: regex-scanner-fp-fn-budget
description: 审密钥/注入类正则扫描器的固定量法——真语料测误报、真凭据格式测漏报，两头都要出数字
metadata:
  type: project
---

本仓的 `scan-secrets` / `scan-instructions` / fitness 都是正则扫描器，且被设计成
「无档位、无开关」的兜底闸。这类东西**不能只看单元测试的几条 fixture**，要两头量：

1. **误报测真语料，出绝对数字**。拿机器上现成的大块无密钥代码跑同一条正则，
   数命中。2026-09-02 实测 `generic-assignment` 放宽到无引号形态后，
   python3.14 stdlib + 全局 node_modules（1.91M 行、零密钥）命中 **351 条**，
   放宽前 62 条——一个改动把误报翻了 5.7 倍。这个数字比任何「感觉噪声可控」都硬。
   语料位置：`/usr/lib/python3.*`、`~/.nvm/versions/node/*/lib/node_modules`。
2. **漏报测真凭据格式清单**。造一份当代格式表跑一遍：`sk-ant-api03-` / `sk-proj-` /
   `github_pat_` / `glpat-` / `AIza` / `hf_` / `npm_` / AWS secret access key。
   同日实测 9 条里 **8 条走过去**，包括 Anthropic 自己的 `sk-ant-`——而本仓
   `skills/code-review/SKILL.md:154` 和 `release-builder/SKILL.md:88` 早就写着要 grep
   `sk-ant-|sk-proj-`。仓里自己的文档就是现成的期望表，先拿它对一遍。
3. **散文文件的规则要用散文测**。`instruction-override` / `gate-disable-instruction`
   扫的是 CLAUDE.md 这种人写的指令文件，禁令句和攻击句长得一样：
   「Never skip the tests」「Do not disable the lint rules」「You are now responsible for…」
   实测 8 句正常规则文本里 7 句命中 error。中文文档不触发只是因为规则是英文词——
   AGENTS.md / copilot-instructions / .cursorrules 都是英文惯例文件，别拿本仓不响当证据。

**Why:** 这三只是要接 pre-commit 的硬闸。漏报让闸白装，误报让人把闸关掉——
后者更致命，因为它是不可逆的：闸被绕过一次就再也不会被信任。

**How to apply:** 报「正则修好了」之前必须附两个数字（真语料误报数 / 真格式漏报数）。
只给「新增分支能抓到 dotenv 形态」这种正向样例，等于只测了一半。
相关：[[pattern_gate-scripts-false-green-in-machine-channel]]、[[pattern_golden-baseline-rulers]]
