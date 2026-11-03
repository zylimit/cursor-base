---
name: path-naming-contract
description: 审 harness「stdout 路径一律仓库相对」这条契约的固定攻法——符号链接降级、相对入参回退、断言同义反复、修复零覆盖
metadata:
  type: project
---

本仓 stdout 是机器契约，rules/harness-large-repo.md 立了「路径一律正斜杠、一律仓库相对」。
判据实现在 `core.mjs` 的 `repoRelative`（仓内转相对 / 仓外原样 / `..` 开头即判仓外）。
2026-09-03 审这条判据时，五条固定攻法四条有货：

1. **前缀撞名、`..foo`、根自身、跨盘符——都不用担心**。`path.relative` 按路径段比，
   `/repo-sibling` 不会被当仓内；`..foo/` 不触发 climb-out；Windows 侧 `D:\` 由
   `path.isAbsolute(rel)` 兜住，`c:` vs `C:` 照样转相对。验法：写一个 11 例 posix +
   8 例 `path.win32` 的矩阵直接跑函数，不要靠读。
2. **符号链接是唯一会悄悄降级的边界**。`projectRoot()` = `process.cwd()`（已解析真实路径），
   经软链传进来的仓内路径判成仓外 → 回显机器绝对路径，正是契约禁止的形态。
   macOS 的 `/var`→`/private/var`、`/tmp`→`/private/tmp` 就是它。
   **警报信号**：新 selftest 用 `fs.realpathSync(mkdtempSync(...))` 把这个形态绕开了——
   夹具主动 realpath = 作者知道函数怕软链，去问为什么不断言它。
3. **相对入参「原样回显」要当心方向搞反**。`path.relative(root, rel)` 本来就先按 cwd 解析入参，
   所以它给的是「真正被 fs 打开的那个文件」的仓相对名；改成原样回显后，cwd≠projectRoot 时
   报出的名字按仓相对读会指到**另一个文件**。判法：造一个 `cwd=.claude / CLAUDE_PROJECT_DIR=repo`
   的调用，再在两个候选位置各放一个文件，看错误信息变的是哪一个。
4. **断言可能由另一条分支给出同一答案 = 没钉住**。删 `if (!path.isAbsolute(raw)) return ...` 整行，
   selftest 仍 268 全绿——`repoRelative('docs/x.md')==='docs/x.md'` 在缺该分支时由 climb-out
   分支答出同值。查检：每条分支单独删一次跑一次，别整段替换。
5. **「命名」修好了不代表「读取」修好了**。同一轮里 `adr-check` 的真缺陷是
   `path.join(root, absPath)` 读错目录（accepted ADR 一条读不到还答 nothing to enforce），
   修法是 `path.resolve`；命名那半有 selftest 守，**读取那半零覆盖**——改回 `path.join`，
   selftest 268 / golden 20127 / test-harness 72 全绿。凡是「一个 bug 两半（读错 + 报错名）」，
   两半各要一条红。


2026-09-04 复审「成对归一 realpath」那版修复（`resolveThroughLinks` + 两侧同归一）时，攻法 2 结出两条新的：

6. **成对归一必然引入镜像方向的新回退，去问那个方向有没有被钉住**。修完「仓外软链指进来」，
   反向的「仓内拼法经软链指向仓外」就换成了绝对回显——正是契约禁止的形态，且两个方向都零覆盖
   （防砖用例只造「拼法本就在仓外」的路径，碰不到）。同理仓内软链指向仓内目录时，回显从
   `link/x` 变成 `real/x`，注释却写着「只有比较用解析形」——回显的就是解析形，注释与代码不符。
   固定实验：在 mktemp 里造 `repo/linkout -> 仓外` 与 `repo/.claude/link -> repo/.claude/real`
   各跑一次，再把那一行改回旧写法跑一次对拍，才分得清「回退」与「既有债」。
7. **红锁「各钉一个方向」要用半修突变验，不是全撤**。全撤两条都红说明不了互不遮蔽；
   分别做「只归一入参」「只归一根」两次半修，看是不是各红一条、恰好一条。本轮 ㉖a/㉖b 精确 1:1。

8. **这条契约最后收在「拼法优先、身份兜底」两问结构**（2026-09-04 定案）：先用不解软链的两侧拼法算，
   不爬出就按拼法命名；拼法爬出才两侧 realpath 再问一次；两次都在仓外原样回显。
   它同时满足「软链不解开」和「经软链递进来的 checkout 捞得回仓相对名」，且仓内路径零 realpath
   （实测比无条件成对归一快 ~9.4x）。**验它要看四条红锁是不是正交**：退回无条件成对归一应只红
   拼法那两条，砍掉身份兜底应只红身份那两条——任一半退化恰红两条才算钉住。
   已知残留（非回归，旧实现同样如此）：根用软链名、入参用真实名、且途经仓内 link-out 时仍回绝对路径。
相关：[[pattern_golden-baseline-rulers]]、[[pattern_duplicated-rule-tables]]、[[project_cc-base-is-a-framework-repo]]
