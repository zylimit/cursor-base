---
name: red-blue-review
description: 当要对一批改动做发版前 / 合并前对抗审查，或用户说红蓝审查、对抗审查、检视改动时使用。
argument-hint: "[改动范围（可选，默认工作树/最近提交）]"
---

[任务]
    对一批改动跑 Blue → Red → Judge 三遍，把审查从"看着没问题"变成"证据说话"。
    定位：发版 / 合并前的对抗闸。比 code-review 三阶段更对抗（红队默认证伪、专挑死角），比 code-review-fanout 省（不走 Workflow、不并行、不吃 ~15x token）。
    输出结论填进 RED-BLUE-REVIEW.md：ACCEPT（放行）/ FIX_REQUIRED（须修清单）/ NEEDS_MORE_EVIDENCE（证据不足，补了再判）。

[依赖检测]
    Skill 启动时第一步自动执行。

    必需：
    - 一批已成型的改动 → 已 commit（默认审最近 tag..HEAD）或工作树未提交（--working）。无改动则提示无可审范围
    - git 可用

    可选：
    - Product-Spec.md → 有则红队可对照需求挑"自相矛盾"
    - DEV-PLAN.md → 有则可对照 Phase 交付清单看漏没漏

[第一性原则]
    **自述不作数**：Blue 的自证、Red 的指控、子 Agent 的"通过"，都不因为"它这么说"就采信——必须落到 file:line 或可复现路径才算数。给不出落点的，一律不进结论。
    **红队是证伪姿态**：Red pass 默认想推翻这批改动，不是找优点。专往边界、回滚、Windows 真机、安全死角挑——"没挑出问题"只在挑过了之后才成立。
    **Judge 只看证据**：裁定时只认 file:line 和复现路径，不看任何一方的自述措辞。证据够才下结论，不够就要 NEEDS_MORE_EVIDENCE，不替任何一方圆场。

[文件结构]
    ```
    red-blue-review/
    ├── SKILL.md                           # 主 Skill 定义（本文件）
    ├── red-blue-review.sh                 # 凑证据包（diff/删除审计/新文件），喂给红队
    ├── test-red-blue-review.sh            # 无效 ref 静默空包保护契约的回归自测（可选随包）
    └── RED-BLUE-REVIEW.md                 # 审查报告空模板（每次拷到 per-review 路径填，这份永远保持空）
    ```

[三遍流程]
    审查按三遍执行：Blue（自证）→ Red（攻击）→ Judge（裁定）。前两遍产证据，第三遍只凭证据下结论。

    --- Blue pass：自证（摆靶子，不作数）---
    派 implementer 把这批改动逐条自证：
    - 改了什么（文件 + 一句话意图）
    - 验证了什么（跑了什么命令、看了什么）
    - 证据在哪（file:line / 命令 + 输出位置）
    明确告诉它：这是自述，只作红队的靶子，**不作为通过依据**。Blue 说"验过了没问题"不能让任何一条免于 Red 攻击。

    --- Red pass：攻击（证伪姿态，四 lens）---
    派 code-reviewer（fresh 实例），按四个 lens 逐个往死里挑，每 lens 默认想推翻：
    - **correctness**——逻辑错、边界漏（空 / 越界 / null）、与既有规则或 Spec 自相矛盾
    - **security**——注入 / 越权 / 泄露（密钥、路径）/ 破坏性操作（rm、force push）无防护
    - **release**——打包 / 版本 / 发布产物缺漏、装不上、回滚难、漏排除私人内容
    - **windows**——PowerShell 5.1 / 路径分隔 / 换行（CRLF）/ 编码（BOM、GBK）等 Windows 真机坑（本框架吃过 PS 5.1 git fatal 泄漏的亏）
    铁律：每个 finding 必须附**复现路径或文件行号**——给不出复现 / 行号的不算 finding（防空喊）。挑不出就如实报"该 lens 无 finding"，不凑数。

    --- Judge pass：裁定（主 Agent，只看证据）---
    主 Agent 逐条裁定每个 Red finding：
    - **采信**——证据（file:line / 复现路径）成立 → 计入须修
    - **驳回**——证据不足 / 复现不出来 → 写明理由，降级待确认，不计入须修
    全部裁完后出三态之一：
    - **ACCEPT**——无采信的硬伤，可放行
    - **FIX_REQUIRED**——有采信的须修问题，列清单（每条带 file:line + 修复建议）
    - **NEEDS_MORE_EVIDENCE**——证据不足以判（关键 finding 复现不出、或 Blue/Red 都没覆盖到的高风险面），指明缺什么、回去补了再判

[工作流程]
    主 Agent 编排，三遍按序走，Judge 留给主 Agent：

    [第零步：拷出本次报告副本]
        skill 目录里的 RED-BLUE-REVIEW.md 是空模板，**永远保持空**——绝不就地填（就地填会污染模板、还会被 make-release 打进包）。
        每次审查先把模板拷到一个 per-review 工作路径，本次三遍都填这份副本：
            REPORT=/tmp/red-blue-review-<标识>.md   # 标识由主 Agent 传入（如范围或时间戳），别用随机值，方便子 Agent 与主 Agent 指同一份
            cp .claude/skills/red-blue-review/RED-BLUE-REVIEW.md "$REPORT"
        后续 Blue / Red / Judge 写的都是 $REPORT，不动 skill 目录那份。

    [第一步：凑证据包]
        跑 bash .claude/skills/red-blue-review/red-blue-review.sh [BASE] [HEAD]
        Windows 下须在 Git Bash 内运行本脚本（它不是 hook、不会被 setup.ps1 转 .ps1，依赖 bash/coreutils）
        （BASE 默认最近 tag，HEAD 默认 HEAD；审未提交工作树用 --working，--working 可在任意位置）
        拿到 markdown 证据包：审查范围、改动清单、删除审计、新文件、完整 diff（或 diff 临时文件路径）
        **删除审计重点看**：家底审查时，diff 里删除行落在 hook / skill / CLAUDE.md / agents 上，确认是不是误删既有规则
        脚本失败响亮：BASE / HEAD ref 无效会非零退出 + stderr 报错（不会静默产空包）——见到报错先核对参数，别把空包当「没东西可审」往下走

    [第二步：Blue 自证]
        派 implementer（fresh 实例），传入证据包 + 这批改动的上下文 + 本次报告副本路径 $REPORT
        让它按 [三遍流程] Blue pass 逐条自证，**把自证表（改了什么 / 验证了什么 / 证据 file:line）直接写进 $REPORT 的 Blue 自证表**
        回传只给「已写入 $REPORT」+ 一句话摘要，**不靠回传消息承载 findings**
        铁律：子 Agent 回传空壳 ≠ 完成，产物文件才是交付——主 Agent 验收读 $REPORT，不读回传措辞（呼应 [总体规则] 验收以客观证据为准）

    [第三步：Red 攻击]
        派 code-reviewer（fresh 实例，独立于 Blue），传入同一证据包 + 本次报告副本路径 $REPORT（Blue 自证表已在里面，作靶子）
        让它按 [三遍流程] Red pass 四 lens 逐个攻击，每个 finding 附复现路径 / file:line + 严重度
        **把按 lens 分组的 findings 直接写进 $REPORT 的 Red findings**，回传只给「已写入 $REPORT」+ 一句话摘要，**不靠回传消息承载 findings**
        铁律：子 Agent 回传空壳 ≠ 完成，产物文件才是交付——主 Agent 验收读 $REPORT 里的 findings，不读回传措辞

    [第四步：Judge 裁定]
        主 Agent 不派子 Agent，自己读 $REPORT 里的 Red findings 逐条裁定（采信 / 驳回）——复现不出 / 给不出落点的驳回
        证据句柄需要回溯原文核实的，再派 fresh 实例翻证据，但裁定权留主 Agent
        出三态结论 + 逐条裁定理由（+ FIX_REQUIRED 时的修复清单），填进 $REPORT 的 Judge 裁定
        - ACCEPT → 放行，可继续 commit / 合并 / 发版
        - FIX_REQUIRED → 主 Agent 按清单派 bug-fixer / implementer 修 → 修完重跑本流程
        - NEEDS_MORE_EVIDENCE → 补齐缺的证据（补测试 / 补复现）→ 回到对应遍重判
        驳回不等于扔掉：Red 攻死角攻出来的东西，一部分是缺陷，另一部分是「原来这个域是这样的」——后者按缺陷判必被驳回，却恰是该留的。裁定时把这类单独挑出来当领域线索，依据齐了按 .claude/rules/domain-rulings.md 派 domain-recorder 收录，没齐的记进 progress.md 残留。

[初始化]
    执行 [工作流程]
