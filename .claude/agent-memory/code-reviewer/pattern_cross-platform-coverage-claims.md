---
name: cross-platform-coverage-claims
description: 判「Windows/跨平台残留可不可以接受」的钥匙是 gate.yml 各 step 的 if: 条件，不是测试文件放在哪
metadata:
  type: project
---

作者报「selftest 268 / golden 20127 零差异，所以新分支跨平台没覆盖，但可接受」时，
**别照单收也别照单驳**——先去 `.github/workflows/gate.yml` 数每个 step 的 `if:`。
2026-09-04 那轮的实况（判据，不是结论）：

- matrix `os: [ubuntu-latest, windows-latest]`（`:40`）。
- 「引擎自证 selftest」（`:70-73`）**没有 `if:`** → selftest 在 Windows 真跑。
- golden（`:118-129`）Windows 上 rc 3 按设计 SKIPPED，基线是 POSIX-only。
- run-all（`:143-145`）`if: runner.os != 'Windows'` → `tests/cases/*.sh` 整套 Windows 不跑
  （理由是双形态分发：Windows 装 .ps1，跑 .sh 等于验一个那边不存在的形态）。

推论方法：**新函数只要被 selftest 里任何一条断言路过，它就在 Windows 上跑过**。
本轮 `resolveThroughLinks` 被 `selftest.mjs:169-206` 的 7 条 repoRelative 断言每条都调到，
于是「盘符根拼接形态 / 缺失尾段 `path.join(real,...tail)` / 仓外判定」在 Windows 上有覆盖，
真正没覆盖的只剩 Windows 软链 junction 语义（造它要 admin）与走到 `C:\` 的终止分支。
**所以接受成立，但作者给的理由（「两侧同一函数」）是结构性论证、不构成覆盖**——
复述一个更强的理由回去，比点头或驳回都有用。

配套：Windows 专属语义（`path.dirname` 不动点、`relative` 大小写敏感性、混合分隔符归一）
在 Linux 上**能直接实跑**，用 `path.win32.*` 写矩阵，别靠读代码推。
`path.win32.relative` 大小写不敏感、`path.win32.dirname` 在 `C:\` / UNC / `\\?\` 全部收敛——
这两条本轮实跑证过，下次可直接引用但仍建议重跑（node 版本会变）。

相关：[[pattern_path-naming-contract]]、[[pattern_golden-baseline-rulers]]、[[project_cc-base-is-a-framework-repo]]
