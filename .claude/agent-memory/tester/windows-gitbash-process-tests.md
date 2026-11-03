---
name: windows-gitbash-process-tests
description: 在 Git Bash（CI windows 格）上测进程/信号的坑——kill 对原生进程无效、/PID 会被路径转换、SIGTERM 是硬杀，以及怎么用 platform+process.kill 双层垫片在 Linux 上验 win32 分支
metadata:
  type: project
---

cc-base 的 gate 跑 `windows-latest` + `shell: bash`（= Git for Windows 的 Git Bash）。测试碰进程/信号时，这几处是 Windows 专属红：

- **Git Bash 的 `kill` 只对 MSYS 进程有效**，给 node.exe / cmd.exe 这类原生进程发信号发不出去，进程根本不死。配上惯用的 `2>/dev/null || true` 后完全静默，后面的断言就在验一个没成立的前提。杀原生进程一律分平台走 `taskkill /PID <pid> /T /F`（`/T` 收 `shell:true` 起的孙进程）。
- **`/PID` 这类开关会被 MSYS 当路径转换**成 `C:/Program Files/Git/PID`，taskkill 报 `Invalid argument/option`。两种解法**不能叠加**：`//PID` 靠运行时把 `//` 缩成 `/`，一旦环境里设了 `MSYS2_ARG_CONV_EXCL=*` 就原样传出去反而失效。选命令级前缀 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' taskkill /PID ... /T /F`——Git Bash 认前者、MSYS2 原生认后者，前缀赋值还能盖掉环境里的既有值。
- **平台检测照仓里的 `case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*)`**（setup.sh 已这么写，Git Bash 必带 uname）。
- **Windows 上没有优雅信号**：node 的 `process.kill(pid,'SIGTERM')` 走 TerminateProcess，目标的 `process.on('SIGTERM')` 监听器压根不触发（官方文档明写）。凡「停止后状态应收敛成 X」的断言，先想清楚实现是不是被自己发的 SIGTERM 抢在写状态之前打死了——这类红是实现缺陷，不是测试缺陷，别改断言迁就。
- **验 Windows 专属分支不用等 CI**：`PATH` 垫片造假 `uname`（`-s` 回 `MINGW64_NT-10.0`）就能把脚本逼进该分支；再加个假 `taskkill` 垫片（记 argv 到日志 + 用 `kill -9` 真杀）整套就能在 Linux 上跑绿，一次证到三件事——分支可达、argv 形状对、结果语义等价。只装假 uname 不装 taskkill 那一版更值：断言会红成 CI 里一模一样的样子，顺带证明它不是空断言。
- **CI 的 windows 格自 bbbae36 起不跑 run-all 了**（双形态分发，Windows 用户手上没有 .sh）。后果：**所有 .sh 测试里的 win32 分支，垫片是唯一防线**，不再有「等 CI 兜底」这一说；写这类断言时按「没有第二道闸」来要求自己。
- **测 .mjs 的 win32 分支，光换 `process.platform` 不够，必须连信号语义一起重放**：`Object.defineProperty(process,'platform',{value:'win32'})`（该属性 configurable，可改）只让代码走进分支；但 Linux 的 SIGTERM 是优雅的，于是「把分支删掉、退回发信号」在本机照样收敛成功——正向断言就成了恒真的空断言。补一层 `process.kill` 包装：signal 0 原样透传（探活，Windows 上也是探活），其余终止信号一律转 `SIGKILL` 并记日志。实测：只装 platform 那版，变异后仍全绿；两层都装，变异后立刻红成 CI 原样。
- **只伪装客户端、不伪装被测服务**：把 `stop` 客户端 import 前打垫片逼上 win32，supervisor 本体仍作普通 Linux 进程跑——被测的是「客户端这条分支对不对」，服务端照常才谈得上语义等价。手法：垫片 .mjs 改完 `process.argv` 再 `await import(pathToFileURL(实现))`，退出码原样透传。
- **判「进程被杀掉没有」别看 pid，看端口**：给 kill-dev-ports 这类清端口的 hook 写红锁，靶子存活判据用 `net.connect(port)` 探活（连上=还在听 / ECONNREFUSED=没了）——Git Bash 里 `$!` 是 msys pid，被 `taskkill /F` 掉的原生进程 `kill -0` 未必如实，而「端口空没空」本来就是这个 hook 的可观测面，两个平台同一份断言。POSIX 侧还要守 `command -v lsof`：lsof 不在时 hook 什么都杀不掉，该 SKIP 不该红。
- 相关：[[cc-base-testing-infra]]、[[red-lock-test-writing]]
