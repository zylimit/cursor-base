# tester memory index

- [测试基建约定](../../../docs/agent-notes/tester/testing-infra.md) — bash 测试形状、基线当场重测、跑前跑后钉 sha、未知子命令 rc=3 会被 usage 撑绿、golden 只能仓内变异、/tmp 变异副本验牙、合并用例行必对 PASS 计数、harness selftest 是 .mjs 平表（tests:N 即用例数、无 skip、中文走 \uXXXX）、安装器断言反向验证用 shim 换 setup.sh 注缺陷、清单已排除 tests/ 与 agent-memory/（动它们不再变陈）、test-hooks-node 与 test-gate-audit 是 low（medium 档也不跑）、手搓 stdin 必 printf '%s'、\b 在中文哨兵后不成立、expect_code 是子串判据（改名变异照样绿）、比值分母实测 10726、退休前先按行数排盘子、本机**有** pwsh（.ps1 臂是真跑的）、「跑没跑过」查账本别查记忆、退休前先给候选本身打变异（只验保留项是漏的）、共享沙箱会连坐要看红因指向谁、密钥扫描器整份是地板、grep -F 模式以 - 起头须加 --、「A+B合计」阈值夹具两边都要堆够、纵深防护下反向验证要一次性废掉全部守卫才能验出牙
- [审计脚本易碎区](../../../docs/agent-notes/tester/audit-scripts-fragile-zones.md) — 工作树/索引之别、pwsh 缺席要守卫、测试文件自己会被自举扫描扫到、ADR revisit-if 空话判定有 年后/后端 子串假红、doctor.sh 写死 agent 份数 7、gate-audit 的 (b) 段锚点带文案会让老断言空转、能力上下文实数（tsconfig/py/catalog 皆 0）
- [红锁测试写法](../../../docs/agent-notes/tester/red-lock-test-writing.md) — 断言写「修好后应成立」、期望引用已修好的同族而非发明、对照组写死字面量、验红之外拿候选修复验「修得好」、反转类契约配四个变异（删句 / 只写半句 / 恒真 / 静默）、措辞迁移期负向断言要用跨两版的词当尺子、被否的候选实现当变异体验每臂的牙
- [Git Bash 进程测试坑](windows-gitbash-process-tests.md) — kill 杀不动原生进程、/PID 被路径转换、SIGTERM 是硬杀、双层垫片在 Linux 上验 win32 分支（CI 已不跑 Windows .sh）
