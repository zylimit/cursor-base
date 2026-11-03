---
paths:
  - ".claude/harness/**"
---

本文件由 CLAUDE.md 下沉；主控命中指针时必须完整读取本文件再行动，不得凭指针行猜测内容。（frontmatter 的 paths 让 Claude Code 原生按需加载本规则——碰 .claude/harness/ 下文件时自动进上下文；未碰时靠 CLAUDE.md 指针手动读，两条路都通。）

[定位——五性治理为什么要机器化]
    检查跑通只证明「跑过」，不证明「建立了什么性质」。一个仓库可以每个 check 全绿，却没有任何证据说明支付模块是安全的、日志是不泄隐私的、故障是能自愈的。本层补上这个缺口：模块声明它必须持有证据的质量属性（韧性 Resilience / 网络与信息安全 Security / 功能安全 Safety / 隐私 Privacy / 可靠性 Reliability，外加可用性 / 性能 / 可维护性），check 声明它的通过是哪些属性的证据，覆盖与否从此可判定、可门禁。取自 ISO/IEC 25010，收窄到仓库能持有证据的子集。
    本层去除的是「没人查过」这个状态；它不担保属性成立——个人数据检测有漏网、静态分析看不见逻辑缺陷，工具边界要如实报告。

[属性清单（八项）与五性对应]
    - `security`：网络与信息安全——防未授权访问 / 破坏 / 窃听 / 篡改（SAST、依赖漏洞、密钥泄漏、SBOM）
    - `safety`：功能安全——故障或失效不对人身 / 环境 / 设备造成实质伤害（危险操作闸、失效模式检查、高危模块的挂单纪律）
    - `privacy`：隐私——个人与企业数据的收集 / 使用 / 存储 / 销毁合规（GDPR 等），日志与出口不携带 PII
    - `resilience`：韧性——主动识别风险、故障快速恢复、抗大规模并发冲击、宕机自动拉起（重试有界有退避、熔断、压测、supervisor）
    - `reliability`：可靠性——规定条件与时间内持续稳定无故障（回归测试、变异测试、契约测试、不吞错）
    - `availability` / `performance` / `maintainability`：可用性（SLO/负载）/ 性能 / 可维护性，按需声明
    五性映射：韧性=resilience、Security=security、Safety=safety、隐私=privacy、可靠性=reliability。

[六档强度——按模块给到该给的严格度]
    一刀切的严格度本身就是缺陷：全仓一个标准会把一次性原型养得和支付服务一样贵，团队的应对必然是整体关检查而不是调档。所以声明带档位：

    | 档位 | 执法 | 含义 |
    |---|---|---|
    | `critical` | 阻断 | 缺证据即阻断完成，**永不可豁免** |
    | `high` | 阻断 | 缺证据即阻断完成；可用属性 waiver 推迟（security/safety/privacy 属性除外，禁词天然不可表示） |
    | `medium` | 告警 | 报为缺口，不阻断 |
    | `low` | 记录 | 仅记录备查 |
    | `minimal` | 列示 | 按需列出；**必须给书面 reason** |
    | `none` | 退出 | 明确不治理；**必须给书面 reason** |

    minimal / none 必须给 reason（catalog-lint `UNJUSTIFIED_TIER` 拦裸退出）——因为「不治理」是每个属性在零成本下自然漂向的状态，退出必须是留痕决策。

    声明写法（module.attributes）：
    ```json
    {
      "id": "payments",
      "attributes": {
        "security": "critical",
        "privacy": "high",
        "reliability": "high",
        "availability": { "tier": "none", "reason": "纯库模块，无服务面" }
      }
    }
    ```

[覆盖判定（verify 里执行）]
    属性被覆盖 = 该模块自己 verification 选中的、声明认领该属性的 check 里，**至少一个 PASS 且没有任何一个 FAIL/BLOCKED**。三条铁则：
    - **反证压过佐证**：一个 check 说属性成立、另一个 check 证明它不成立时，属性不算覆盖——「证明不成立」比「部分证明成立」更强。
    - **声明而未接线 = 可见缺口，不是静默通过**：声明了 security:critical 却没有任何 check 认领 security，报缺口并阻断（这才是诚实状态）。`attributes` 子命令静态审计接线，不用跑命令。
    - **SKIPPED 不覆盖也不反证**：Fast Mode 或 waiver 跳过的检查不产生任何方向的证据。
    check 认领属性的写法（catalog.checks）：
    ```json
    { "sec-scan": { "command": "semgrep scan --error --config auto", "class": "security", "attributes": ["security"] } }
    ```
    门禁：受影响模块的 critical/high 属性缺覆盖 → `verify` 出 `gate:"BLOCKED_BY_ATTRIBUTES"`、rc 2 → pre-commit-check 阻断 commit。medium 报告、low/minimal 记录，均不阻断。

[fitness——第一天就能跑的内置规则（零外部工具）]
    `node .claude/harness/harness.mjs fitness`（默认扫变更文件；`--all` 全 tracked）。五条内置规则对应五性，纯文本启发式：
    - `no-secret-literal`（security，error）：源码里的密钥 / token / 私钥字面量
    - `no-pii-in-logs`（privacy，error）：日志语句携带 email / ssn / 卡号 / 生日等个人字段
    - `no-silent-failure`（reliability，error）：空 catch / except-pass——把故障变成没人上报的错误答案
    - `no-unbounded-retry`（resilience，warning）：无界重试循环——把瞬时故障放大成持续冲击
    - `no-unreferenced-deferral`（safety，warning，minimumTier=high）：safety 档位 ≥high 的模块里未挂单的 TODO/FIXME——高危模块里没人认领的欠账
    规则强度跟着模块档位走：带 `minimumTier` 的规则只在声明到该档位的模块里生效；模块把某属性设 `none` 则相关规则对它全部静音。行内 `harness-fitness:ignore`（本行或上一行）压制单条命中——压的是这一条，不是整条规则。
    项目扩展：`.claude/harness/fitness-rules.json`——`{"replace":false,"rules":[{"id","attributes","severity","forbid","appliesTo?","minimumTier?","rationale","fix"}]}`；replace:true 弃用内置只用自带。
    这些是文本启发式：能减少「没人查过」的缺陷面，不能证明属性成立。要真证据，接外部工具（下节）。

[adapters——外部工具接线（工具映射到属性）]
    harness 不捆绑不安装任何工具；`adapters list` 报每个工具 available（PATH 有没有）+ wired（catalog 接没接），`adapters add <id>` 把 check 写进 catalog.checks。**接线只是半步：模块 verification 引用它才会被选中**。可执行文件缺失时该 check 报 BLOCKED，绝不假绿。
    速查（按属性挑工具）：
    - security：`sast-semgrep`（SAST）/ `sca-osv-scanner`（依赖漏洞，快、低噪、适合每变更）/ `scan-trivy`（广域扫，适合定期）/ `secrets-gitleaks`（历史敏感信息，补 fitness 只看工作树的盲区）/ `sbom-syft`（SBOM 资产清单）/ `iac-checkov`（基础设施配置错误）
    - privacy：`pii-presidio`（个人数据检测）+ `secrets-gitleaks`
    - reliability：`mutation-stryker`（变异测试——测「测试真能抓住缺陷吗」）/ `contract-schemathesis`（API 契约对抗）
    - resilience / availability / performance：`load-k6`（负载 / 延迟 / 错误率目标）/ `slo-openslo`（SLO 声明式校验）
    class:runtime 的检查（如 k6）度量的是**部署后的系统**，没有 diff hash 能描述它——其结果按时间窗口理解，不当作当前工作树代码的证据。

[Claude Code 原生安全层（security/privacy 的执行层，零外部工具）]
    fitness / adapters 是「检测层」，Claude Code 自带的三件是「执行层」——检测告诉你有洞，执行层让洞打不穿：
    - **permissions deny/ask 规则**（框架 settings.json 已带）：`Read(**/.env)` 等 deny 规则挡住密钥文件被任何工具读到（Edit/Write 同路径连带被挡，Bash 里的 cat/head/sed 也认）；`Bash(git push*)` 等 ask 规则把「审批三档」的 HIGH 档做成机器强制——**bypassPermissions 模式下 ask 规则照样弹审批**（官方语义），deny 优先级压过一切 hook。
    - **secret-exfil-guard hook**（框架已带）：deny 规则不认任意子进程（python 脚本自己 open 文件就绕过了），本 hook 补拦密钥文件的读/拷/网络外传三类命令形态，带 wrapper 剥壳（sudo/nohup/timeout/bash -c 套壳先剥再判，借鉴 codex-base v3）；Fast Mode 不豁免。
    - **原生沙箱（opt-in，macOS/Linux/WSL2）**：`/sandbox` 或 settings `sandbox.enabled` 开启 OS 级隔离——文件系统写白名单、网络域名白名单（`sandbox.network.allowedDomains` + `strictAllowlist`）、凭据保护（`sandbox.credentials` deny/mask，mask 形态命令只见哨兵值、真值由代理在出口替换）。这是「analytics 永不许碰 pii-store」这类禁令的运行时孪生：arch-check 管代码边，沙箱管进程边。Linux/WSL2 需 `apt install bubblewrap socat`；原生 Windows 不支持（跑 WSL2）。要 OS 级证据时按模块声明 security/privacy 档位 + 开沙箱，二者互补不互替。
    - **官方 /security-review**：Anthropic 官方安全审查命令（多 agent 漏洞扫描），可作 security 属性的补充证据源——手动跑或在发版前跑，结论按「检测层」理解（同 fitness：减少没人查过，不担保成立）。

[开发态韧性——supervisor 进程守护]
    韧性不止是代码模式，还包括开发 / 演示 / 长任务环境里的服务自愈。`node .claude/scripts/supervisor.mjs`（零依赖，跨平台）：
    - `start --id web [--health-url http://127.0.0.1:3000/health] -- npm run dev`：宕机自动拉起（指数退避，基数 500ms 封顶 30s）；健康探针连败 3 次视为「活着但不服务」，杀掉重拉。
    - 重启风暴熔断：窗口（默认 600s）内超过 max-restarts（默认 10）→ 状态置 `crashed`、supervisor 退出——故障不是瞬时的就该人来看，不许无限空转（失败可见，不静默重试到天明）。
    - `stop --id web` / `status` / `logs --id web`；状态与日志落 `.claude/.runtime/supervisor/<id>/`（git 忽略），status 以 pid 实活性为准、不信旧字段。
    - 边界：这是开发态护栏，**不是生产 init**——生产仍归 systemd / k8s / 编排系统；部署验收照走 release-builder 的独立核查三件套。

[五性从需求到验证的贯通]
    - 需求侧：product-spec-builder 收集需求时对关键业务模块问清五性要求（哪些数据是个人数据、故障可容忍度、并发冲击预期、失效的物理后果），落进 Product-Spec 的验收标准。
    - 规划侧：dev-planner 把五性要求折进 module catalog 草案（riskTier + attributes 档位 + forbiddenDependencies 边界，如 analytics 永不 import pii-store）。
    - 开发侧：fitness 随变更跑；arch-check 看边界不被穿；`arch-check --record` + `arch-trend --gate` 做漂移棘轮——可修改性从形容词变成「undeclared 的**边集**只许缩不许扩」的硬指标（比的是边身份不是条数——还一条旧债同时添一条新债，数不变但债换了人；计数只作老台账的兜底）。老仓带债接入：先记基线，旧债慢慢还、新债零容忍；`forbiddenDependencies` 不在此列，那是声明的边界不是债，任何一条违规都当场拦。
    - 决策侧：Architecture-Design.md 里的每条活跃 ADR 用 `adr-check` 盯执法引用——决策要么指向真实存在的 check / fitness 规则 / harness 能力，要么显式声明人工评审；幽灵引用（指向不存在的闸）直接 fail。
    - 审查侧：code-review 对 security/safety 敏感改动加五性 lens（红蓝审查的 security lens 已有，属性声明给它靶子）。
    - 验证侧：verify 的属性覆盖门 + adapters 真工具证据；发布前 release-builder 测试卡点含全量 verify。
    - 例外侧：waiver 只放 high 且留痕带过期带补偿；critical 与 security/safety/privacy 属性没有豁免通道。
