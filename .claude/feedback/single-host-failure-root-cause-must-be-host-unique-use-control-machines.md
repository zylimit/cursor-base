---
type: feedback
description: 用户说「只有 X 不行」时根因必须是 X 独有的属性，先拿同条件对照机排除共性；测到 MTU 先查本机网卡 MTU 与来源；找到绕过办法后接着追真因，推断标明是推断
created: 2026-10-21
updated: 2026-10-21
graduated: false
source_skill: N/A
scope: 主 Agent 做入站连通性 / 网络排障（SSH、Tailscale、WireGuard、MTU、中继）时的归因方式；非项目代码
exceptions: 用户没给出对照信息、也没有可用对照机时，可先给带「推断」标记的假设并说明要补哪项对照；与 inbound-connectivity-debug-state-direction-first 互补，不冲突
supersedes: none
applied_to: 当轮回复已修正根因说明（改指向本机 USB 有线网卡 DHCP option 26 下发的 MTU 1340）；skill / rule 本体不动
---

# 「只有本机不行」的根因必须是本机独有，先用对照机排除共性

**问题描述**：用户报「别的机器 ssh ai-ts（Tailscale）连不上本机 ai-node，ssh ai-wg（WireGuard）可以」。主 Agent 查到 laptop 晚上经 hub 上自建 Tailscale peer-relay 连本机，隧道内满 1280 的包被丢，SSH 卡在密钥交换（sshd 日志 Timeout before authentication）。主 Agent 加了 TCP MSS 钳制（1180）并做成 systemd 服务，然后把根因说成「laptop 走的中继线路装不下满尺寸包、推测 laptop 网络变了」。用户连续纠正：「不对啊，我远程连接 ssh mac-ts, ssh rog-ts, 怎么连都可以啊，就本机不行」「我白天是局域网，晚上是中继啊」「这就是我的常态」「我 ts 也是做了中继的，在 hub 上，目的是感觉和 WG 一样」。

真因是本机独有：USB 有线网卡 enx6c1ff7d07733 被路由器 DHCP（option 26，interface_mtu=1340）设成 MTU 1340，Linux NetworkManager 照收，Windows / macOS 的 mac、rog 不受影响；1280 + WG 头约 60 = 1340 刚好塞满，中继再加二十来字节头就超了。

**触发场景**：用户限定了「只有 X 不行」，同拓扑里还有 mac-ts、rog-ts 这些对照机一直正常；主 Agent 却把 laptop 到中继这段共有环节当根因，还拿「laptop 网络变了」这种没验证的推测当解释。用户的使用习惯（白天局域网、晚上中继、中继自建在 hub 上）是排障输入，开排前没问。

**教训/建议**：
- 用户说「只有 X 不行」，根因必须是 X 独有的属性。先拿同条件的对照机（同局域网、同中继的 mac / rog）排除共性，共有环节（中继线路）解释不了差异，就不能当根因。
- 测到 MTU / 大包问题，先查本机各网卡的 MTU 与来源（ip link、nmcli、DHCP option 26），再去推断远端链路。
- 发现临时绕过办法（MSS 钳制）后别停在绕过上，接着找真因再给解释；推断要明确标成「推断」，不说得像结论。
- 用户的使用习惯（几时在局域网、几时走中继、中继建在哪）是排障输入，开排前可一句话先问清网络拓扑。

**适用范围与例外**：主 Agent 排查「某台机器独有的连通性故障」且存在同条件对照机时按这条来。没有对照机或用户没说「只有它」时，可先给带「推断」标记的假设，说明还缺哪项对照再下结论。与 inbound-connectivity-debug-state-direction-first 同属入站排障，那条管沟通方式，这条管归因方法。

**本次落地**：已在当轮回复里落地，skill / rule 本体没动（当前产物已够，不动本体）。
- 根因说明改为本机独有：USB 有线网卡 enx6c1ff7d07733 被路由器 DHCP option 26 设成 MTU 1340，1280 + WG 头约 60 刚好塞满，中继再加头就超。
- 原先「laptop 中继线路装不下满尺寸包、推测 laptop 网络变了」的说法已撤回。
