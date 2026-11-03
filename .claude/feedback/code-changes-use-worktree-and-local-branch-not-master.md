---
type: feedback
description: 代码改动一律 worktree + 本地分支，不直接在 master 上 commit/push
created: 2026-08-02
updated: 2026-08-02
occurrences: 1
graduated: false
source_skill: N/A
origin: digifiber-conflation-claude,digifiber-optical-evidence
---

# 代码改动走 worktree + 本地分支，不直接落 master

**问题描述**：本 session 主 Agent 多笔代码改动（cluster 边界、命名、completion、ODF 等）直接 commit + push 到 master，没开 worktree、没建本地分支。用户原话纠正："你这边也要 worktree 工作 + 本地分支工作方式哈"。

**触发场景**：本项目（digifiber-conflation-claude）做代码改动——功能开发、bug 修复、热补脚本。用户另一侧 tmux 分屏也是分支化开发，要两侧流程对齐、改动隔离，避免 master 被直接污染。

**教训/建议**：
- **Why**：两侧（tmux 分屏 + Claude）走同一套分支化开发，要改动隔离、可审、可回退；直接落 master 打乱节奏、没法按改动粒度收口。
- **How to apply**：
  - 任何代码改动（功能 / 修复 / 热补）：先用 EnterWorktree 开隔离工作树 + 建本地分支干活；改完走合并 / 提 PR，不直接落 master。
  - 只读探索、容器侧热补（docker cp 进容器验证）等非代码改动不受此约束。
  - worktree 操作纪律照旧：Step0 先查是否已在 worktree（排除 submodule 误判）、`git check-ignore` 确认 worktree 路径不入库、优先用 harness 原生 EnterWorktree。
