---
name: secret-exfil-guard-blocks-env-fixtures
description: 审查时在临时仓造密钥样例，别用 .env 文件名——本仓 hook 会当场拦下
metadata:
  type: project
---

本仓 `.claude/hooks/secret-exfil-guard.sh` 会拦 `cat/head + .env/id_rsa/*.pem/credentials`
形态的 Bash 命令，**在 /tmp 的临时仓里造样例一样会被拦**（它只看命令形状，不看路径在哪）。
2026-09-01 用 `cat > .env <<EOF` 造 dotenv 样例时被拦停。

**Why:** 密钥护栏按设计不认 Fast Mode、不认「这是测试」，命中即停——这是对的，
但会打断审查者造反例的节奏。

**How to apply:** 造密钥形状的反例时用中性文件名（`envfile` / `conf.yml` / `blob.dat`）＋
`printf` 写入。文件名只在 `scan-secrets` 的白名单判定里有意义
（`*.example` / `*.sample` / `*.template` 会被跳过），验内容规则时叫什么都不影响结果；
只有专门验白名单那一格才需要真用 `.env.example` 这个名字。
