---
type: feedback
description: 对本 session 新建、尚未 git add 的文件跑 git diff，空输出+rc 0 与"文件没被改"完全无法区分；改用 wc -l + 内容锚点 + git status 认 ?? 核验
created: 2026-09-11
updated: 2026-09-12
graduated: true  # 2026-09-12 毕业→rules/subagent-dispatch.md [回传与验收]「新建文件的改动证明不许用 git diff」；本文件留作细则参照
source_skill: N/A（Sub-Agent 派单验收环节，非特定 Skill 运行中）
scope: 派单要求 Sub-Agent（或主 Agent 自己）用 git 命令证明"只改了这几个文件"、且改动可能包含新建文件时
exceptions: 已入库（此前已有提交历史）的文件用 git diff 完全适用，不受本条影响——本条只管新建、未 git add 的文件
supersedes: 未说明；是「完成声明需当场新鲜证据」（completion-claims-need-fresh-verification-five-step-gate.md）与「部署验收独立核查」（deploy-acceptance-independent-verification.md）两条已毕业铁律在"用 git diff 做改动证明"这一具体技术手法上的补充，不是取代关系
applied_to: .claude/rules/subagent-dispatch.md [回传与验收] 新增一条（"新建文件的改动证明不许用 git diff"，给出 wc -l + 内容锚点 + git status 认 ?? 的替代手法）
---

# 新建文件用 git diff 验证不出改动，空输出与未改动无法区分

**问题描述**：
2026-09-11 实测撞出来的——当天多个派单里都写着"贴 diff 证明只动了这几个文件"，验收时发现对新建文件这条完全不成立：新建、尚未 `git add` 的文件跑 `git diff` 只会输出空结果 + exit code 0，这和"这个文件根本没被碰过"在输出层面一模一样，没法靠这条命令区分两种情况。

**触发场景**：
验收 Sub-Agent 改动范围、且改动中包含新建文件时，沿用了对已有文件同样有效的 `git diff` 核验手法。

**教训/建议**：
这条已经当场改掉，但产生它的场景（派单里有新建文件）以后还会反复出现，所以照"当场改掉了但坑还在"的规则仍要记一条，提醒以后每次有新建文件的派单都要换手法，不能沿用旧口径。改用的手法：`wc -l` 核对行数 + 内容锚点核对具体写了什么 + `git status` 确认该文件确实列在 `??`（未跟踪）里。

**适用范围与例外**：
适用于任何要求核验"新建文件改动范围"的验收场景；已有提交历史的文件改动仍用 git diff，不受影响。

**本次落地**：
.claude/rules/subagent-dispatch.md [回传与验收] 新增一条，明确"新建文件的改动证明不许用 git diff"，给出 wc -l + 内容锚点 + git status 认 ?? 的替代手法。
