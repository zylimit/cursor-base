---
name: branch-finisher
description: 当 Phase / 功能开发完成，或用户说"收尾"、"合并分支"、"这个分支弄完了"、"分支收一下"时使用。
disable-model-invocation: true
---

[任务]
    把一条开发分支干净收尾。先探清当前 git 环境，过测试闸门，再按环境给出条件化菜单（合并 / 提 PR / 暂留），按用户选择执行，最后清理收场。

[依赖检测]
    Skill 启动时第一步自动执行：

    必需：
    - 项目代码已存在 → 无代码则提示先调用 /dev-builder
    - git 可用，当前在 git 仓库内

    可选：
    - gh CLI → 有则可提 PR；无则只走本地合并，PR 选项标降级
    - test-builder 测试基建 → 有则跑回归作前置闸门；无则提示先补测试或由用户显式放行

[第一性原则]
    **先探后动**：收尾动作（合并、删分支、移 worktree）多是改历史/删东西的操作，做之前必须先探清当前在什么环境、什么分支、有没有未提交改动。环境没探清不动手。
    **测试全绿才许收尾**：收尾意味着这条分支的改动要进主线。没过测试闸门不许合并、不许提 PR——证据是测试运行器的真实输出，不是"应该过了"。
    **不删未合并的东西**：删分支、移 worktree 前确认改动已合并或已推远程，没合并的分支不删，避免丢工作。

[环境检测]
    收尾前先判断当前处于哪种 git 环境，三类分别走不同菜单。

    检测命令与判据：
    - 当前分支 / 是否 detached：`git symbolic-ref -q HEAD` 有输出=在分支上，无输出=detached HEAD
    - 是否在 linked worktree：比较 `git rev-parse --git-dir` 与 `git rev-parse --git-common-dir`，两者不同 → 在 linked worktree
      - **排除 submodule 误判**：submodule 的 git-dir 也与父仓不同。先确认当前路径不是某仓库的 submodule（看 `.git` 是否为指向 `modules/` 的 file、或父级有 .gitmodules 登记），是 submodule 就按"正常分支"处理，不当 worktree
    - 工作区是否干净：`git status --porcelain` 无输出=干净
    - 当前分支相对主分支的提交差：`git log --oneline <main>..HEAD`（确认有没有要收的改动）

    三类环境：
    1. **正常分支**（在分支上、非 worktree）
    2. **linked worktree**（在 worktree 内的分支上）
    3. **detached HEAD**（没在任何分支上）

[前置闸——测试全绿]
    给出收尾菜单前必须先过这一关，不过不给合并/PR 选项。

    - 复用 test-builder 卡点：派 tester Sub-Agent 跑回归（与四步走第2步、release-builder 打包前闸门同一套，复用不另起）
    - 证据 = 测试运行器真实输出（passed/failed 计数），不接受"应该过了"
    - 全绿 → 放行进收尾菜单
    - 有红 → 停，按代码错/测试错分流修复（bug-fixer 修代码 / tester 修测试），重跑到全绿再收尾
    - 无测试基建 → 提示先补测试，或由用户显式放行（放行须用户明确点头，记录这是无测试保护的收尾）

[收尾菜单（按环境条件化）]
    探清环境 + 过测试闸门后，按当前环境给对应选项，让用户选。

    **正常分支**：
    1. 合并到主分支：切到主分支 → `git merge <branch>` → 处理冲突 → push
    2. 提 PR（需 gh CLI）：push 当前分支 → `gh pr create` → 返回 PR 链接
    3. 暂留继续：不收尾，保持现状（用户还想接着改）

    **linked worktree**：
    - 上述三选项全部可用，外加收尾后清理 worktree（见 [清理规则]）
    - 注意：worktree 里不能 checkout 主仓已检出的同名分支；合并到主分支的操作在主工作树执行，或 push 后由主工作树拉取合并

    **detached HEAD**：
    - 先建分支再收：`git switch -c <new-branch>` 把当前提交收进一条命名分支
    - 建好分支后回到"正常分支"菜单走合并 / PR / 暂留
    - 不在 detached 状态直接合并——当前提交无分支引用，切走就可能丢

[清理规则]
    收尾动作完成后按需清理，删之前先确认改动已落地。

    - **删分支**：分支已合并进主线（`git branch --merged <main>` 能看到）→ `git branch -d <branch>`（用 -d 不用 -D，未合并时 -d 会拒绝，是保护）。提了 PR 待合并的分支不要本地删。
    - **移除 worktree**：worktree 内改动已合并或已 push → `git worktree remove <path>`；移除前确认该 worktree 工作区干净（`git status --porcelain` 无输出）。优先用 harness 原生 worktree 工具（如 ExitWorktree），没有再退回 git 命令。
    - **baseline 确认干净**：收尾前后各跑一次基线检查——`git status`（工作区/暂存区干净）+ `git worktree list`（无残留 worktree）+ 确认当前在预期分支上。前后对照，确认收尾没留下脏状态。

[工作流程]
    [启动阶段]
        第一步：依赖检测
            执行 [依赖检测]

        第二步：环境检测
            执行 [环境检测]，判定三类环境之一，向用户报告：
            "当前环境：[正常分支 / worktree / detached HEAD]，分支 [name]，工作区 [干净 / 有 N 处未提交]，相对 [main] 有 [N] 个提交待收。"
            如有未提交改动 → 先提示用户提交或暂存，不带着脏工作区收尾

    [闸门阶段]
        执行 [前置闸——测试全绿]
        全绿 → 进收尾菜单；有红 → 修复重跑；无基建 → 等用户放行

    [收尾阶段]
        按 [收尾菜单（按环境条件化）] 给当前环境的选项，用户选定后执行
        合并产生冲突 → 暂停，报告冲突文件，等用户决定（不擅自取舍）
        执行完合并/PR/暂留对应动作，附结果（合并后的 commit / PR 链接 / 暂留说明）

    [清理阶段]
        执行 [清理规则]：按需删分支、移除 worktree
        收尾前后各跑一次 baseline 确认干净
        向用户汇报：
        "✅ **分支已收尾**
         **动作**：[合并到 main / 提 PR #N / 暂留]
         **清理**：[删除分支 X / 移除 worktree Y / 无需清理]
         **baseline**：工作区干净，无残留 worktree，当前在 [分支]。"

[初始化]
    执行 [启动阶段]
