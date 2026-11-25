---
type: feedback
description: 页面部署在本机（rog-ts 8765）后出问题，先自己在本机用真实浏览器复现核查，再向用户要信息；WSL 机器上说「没有浏览器」之前先查 /mnt/c 下的 Chrome / Edge，用 Windows Chrome + CDP 实点验证
created: 2026-11-13
updated: 2026-11-13
graduated: true  # 2026-11-22 毕业（只收通用半句）→skills/release-builder/SKILL.md [部署验收三件套] 第 3 条、skills/dev-builder/SKILL.md [Phase 完成度判断] 第四步；WSL + Windows Chrome + CDP 的具体做法是那台机器的环境细节，留在本条
source_skill: release-builder
scope: 部署在主 Agent 所在机器（rog-ts，WSL2，Docker 8765）的页面或服务出现用户可见问题时的排查；部署后的 live 冒烟
exceptions: 问题只在用户自己的设备或网络上才出现（如用户端 VPN、浏览器扩展）且本机确实复现不了；此时只向用户要一个最轻的动作，并说明为什么本机做不了
supersedes: none
applied_to: 2026-11-22 skills/release-builder/SKILL.md [部署验收三件套] 第 3 条、skills/dev-builder/SKILL.md [Phase 完成度判断] 第四步（有交互的页面自己用真实浏览器点，不推给用户；真没有浏览器引擎报「交互验证缺席」）
origin: OFR-ARIANE-claude
---

# 本机部署的页面出问题，先自己查清再问用户

**问题描述**：Workload Forecast 改动部署到本机 8765 后，用户截图反馈：切「By week / Custom range」表格没变化，页面左上红字「Cannot reach the server.」，并问 UCI / Subcon 两列为什么是空的。主 Agent 查了服务器日志（带日期参数的请求没到服务器），在旁路实例和 8765 上用 curl 验证接口正常，然后回复「这台机器上没有浏览器，我没法在这边复现」，请用户自己在地址栏粘贴接口地址、按 F12 看 Network 报错。用户回了一张地址栏为 100.126.228.14:8765/forecast 的截图，原话：「这不是就是你本机吗」。此后主 Agent 才去装无头浏览器复现，只在 Linux 侧找浏览器，装 playwright 的 Linux chromium 在 rog-ts 上启动卡住或崩溃，试了六轮没成功，超过用户此前定的「卡住最多 5 轮」。

**第二次触发（同一轮会话稍后）**：主 Agent 在回复里又写了「这台机器上没有能用的浏览器，部署后的点击我自己验不了，要请你打开过目」。用户原话：「你这台机器是windows WSL，怎么可能没有浏览器」。主 Agent 随后实查：rog-ts 是 WSL2（networkingMode=mirrored，WSL interop 开着），Windows 侧有 Chrome（/mnt/c/Program Files/Google/Chrome/Application/chrome.exe）和 Edge（/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe）。从 WSL 直接启动 Windows 的 chrome.exe，在 WSL 里用 playwright-core 连上去，实点 8765 预测页的「4 weeks earlier」，带 from / to 的请求 200、表格换了周，没有报错。

**触发场景**：本机（rog-ts 8765）部署后，用户报告页面交互问题；curl 只能证明接口，证明不了页面行为。同时部署后没有在浏览器里打开过预测页，只核了镜像、接口版本和 JS 内容，交互问题是用户先发现的。第二次是同一结论换了说法：只在 Linux 侧找浏览器，找不到就判定「没有浏览器」，没查 WSL 能调用的 Windows 侧浏览器。

**教训/建议**：
1. 部署在本机的页面出问题，先在本机把能做的复现和核查做完，包括用真实浏览器点一遍，再向用户要信息；不要让用户去按 F12、粘地址。确实需要用户配合时，只要一个最轻的动作，并说明为什么本机做不了。
2. 在 WSL 机器上说「没有浏览器」之前，先查 /mnt/c 下的 Chrome / Edge。真正的缺口是只在 Linux 侧找浏览器，没想到 WSL 可以直接调用 Windows 的浏览器；Linux 侧 playwright chromium 起不来不等于没有浏览器。
3. 本机部署后的页面交互用 Windows Chrome + CDP 实点验证，不交给用户。做法（2026-11-13 实测通过）：从 WSL 启动 Windows 的 chrome.exe，参数 `--headless=new --remote-debugging-port=9333 --user-data-dir=<Windows 临时目录下的专用目录>`；在 WSL 里用 playwright-core 的 `chromium.connectOverCDP('http://127.0.0.1:9333')` 驱动，可点页面、看请求、截图。
4. 两个要点：① 从 Windows 浏览器访问本机服务要用 http://127.0.0.1:8765，用本机 Tailscale 地址 100.126.228.14 会超时（ERR_CONNECTION_TIMED_OUT）；② 这类命令要在命令沙箱之外跑。
5. 部署后的 live 冒烟，对有交互的页面要用浏览器实际点过，不能只核镜像、接口版本、JS 内容。
6. 排查卡住仍受「同一项最多 5 轮」约束（见 subagent-stuck-item-cap-5-rounds.md），超了就停下报告，不连试第六轮。

**适用范围与例外**：本机部署的页面或服务，出问题时按本条先自查；问题只在用户设备或网络上才出现、本机确实复现不了时不适用，那时只问一个最轻的动作并说明原因。第 2、3 条针对 WSL 环境；非 WSL 的 Linux 机器不适用，环境未说明时先查清。

**本次落地**：pending——主 Agent 未传入已落地的改变（本次只传入了实测通过的做法，未说明已改哪个产物）。落点建议：release-builder / deployer 的 live 冒烟段补一句「有交互的页面须用浏览器实际点过；WSL 机器用 Windows Chrome + CDP（做法与 127.0.0.1 要点见本条）」；原先「无头浏览器环境缺口」的 TODO 不必再立，已有可用路径。本体未改，待用户拍板。
