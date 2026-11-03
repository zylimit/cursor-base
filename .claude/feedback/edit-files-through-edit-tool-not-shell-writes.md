---
type: feedback
description: 改文件走编辑工具，不用 sed -i / python 写文件 / printf > 这类 shell 写法；写文件类的闸（路径闸、基线哈希闸）只认编辑工具这条路，shell 写法要么绕过闸、要么让闸之后误拦合法改动
created: 2026-11-04
updated: 2026-11-04
graduated: false
origin: cursor-base（docs/feedback/edit-owned-files-through-the-tracked-write-path，2026-09-16）
source_skill: N/A
scope: 所有会话里对受闸保护路径（no-direct-code-guard 管的业务路径、Cursor 侧任务 owned 范围内的文件）的写入；shell 写法含 sed -i、python3 heredoc 写文件、awk 重定向、tee、> 与 >>
exceptions: 受闸范围之外的路径不受影响；由框架命令自己充当写入方的产物（harness 命令写的证据、清单、审查会话状态）属预期写入；确需批量替换时在任务开始前做，或接受该文件此后冻结到任务结束
supersedes: none
applied_to: pending（自 cursor-base docs/feedback 迁入，待进化引擎评估）
---

# 改文件走编辑工具，不走 shell 写法

**问题描述**：写文件类的闸只盯编辑工具这一条写入路径。绕开它用 shell 写文件，闸要么根本看不见，要么基线对不上、之后把合法改动也拦了。原文是 cursor-base 一次会话里的两次拦截：任务生效期间，owned 范围内的文件被 `sed` 和 `python3` heredoc 改了，没走编辑工具；任务的 `known_hashes` 基线只有受跟踪的写入路径才会更新，下一次合法编辑就被拒，提示「changed outside this task since it was last written」——闸分不清这是有意的编辑还是别人的改动，而这正是它的职责。

**触发场景**：
- 另一次发生（来自 cursor-base，2026-09-16）：对同一份参考文件里七处标题做同样的替换，嫌逐处编辑麻烦用了 `python3` heredoc。替换本身没错，代价在后面：同一文件随后一处折行编辑被拦，除非取消并重启任务，否则无法对账。两次拦截分别落在 `.cursor/skills/release-build/SKILL.md` 与 `docs/LARGE-REPO-GUIDE.md`，任务 `task-1789546034211-45136ab7`；第一次已记在 progress.md 的 2026-09-16 吸收工作条目下。两次当时都是绕过去的（一次取消重启任务，一次放弃了纯外观的编辑）。
- 另一次发生（cc-base 侧，2026-11-04，按主 Agent 回报）：实测 cursor-agent 用 shell 重定向 `printf > src/x.js` 写文件，绕过了 no-direct-code-guard。守「主 Agent 不亲自写业务代码」的闸管不到 shell 这条路，等于写文件类的闸整体失效，这条路径有没有堵上未说明。

**教训/建议**：
1. 凡是受闸保护的路径，改文件一律用编辑工具，一处一改，哪怕正则更短；shell 文本工具只用来读和搜。
2. 确实要批量替换：在任务开始前做完；做在任务期间，就认这个文件之后被冻结。
3. 看到别人（含子 Agent、其他 harness 的 agent）用 shell 重定向写受保护路径，按绕闸算，不按「结果是对的」放过。闸拦不住的写法，靠自觉，也要在派单里写明。

**适用范围与例外**：同 frontmatter。与 main-agent-no-direct-coding.md 相邻：那条管谁能写业务代码，本条管写入走哪条路径才能让闸看见。

**本次落地**：pending。cursor-base 两次都是当场绕过去的，没有规则、skill 步骤或检查携带这条；cc-base 侧 no-direct-code-guard 对 shell 写法的覆盖面未核对。落点建议：先实测该闸对 `>`、`tee`、`sed -i` 的行为再决定改闸还是在派单规则里写明。
