---
name: evidence-ledger-attacks
description: 审哈希链账本 / 证据落盘 / 「硬闸」类机制的七条固定攻法——fail-open 落点几乎全在 I/O 边界和写而不读的字段上
metadata:
  type: project
---

本仓凡是「记录证据 + 事后自证没被改过」的机制（`lib/evidence.mjs` 的 ledger/gate/retention/risk、
`task complete` 四条件闸），照这七条打。2026-09-02 审 P1 证据层，七条中六条命中。

1. **读不出来 = 报绿**。`readLedger` 对「行解析不了」返回 `{corrupt:true}`（fail-closed），
   对「文件读不了」返回 `[]`（fail-open）——同一个函数里两种失败方向相反。
   固定实验：`chmod 000 ledger.jsonl`，看 `ledger` 是不是 `ok:true` rc 0、`retention --apply` 是不是把保护集清空后真删。
2. **并发追加把链写死**。read-then-append 无锁：12 个并发 `gate` → 18 处断裂，且
   **重跑门不能修复**（新行只往后追加，旧断裂永留），错误信息却写着「re-run the gates」。
   固定实验：把 check 换成 `sleep 3` 让 N 个进程对齐，再跑 `ledger`。
3. **半行拼接吃掉整条记录**。上一次写被 kill 留下无换行的尾行 → 下一条 append 直接拼上去 →
   两条一起变 unparseable。3 次 gate 只剩 1 条可见。查检：append 前有没有校验文件以 `\n` 结尾。
4. **写而不读的字段 = 装饰**。`evidenceSha256` / `planHash` 全仓 grep 只有写入点没有读取点：
   证据日志可以随便改写或删除，`ledger`/`risk`/`gate-audit`/`retention` 四个命令全 rc 0。
   固定实验：跑完 gate 把 `evidence/*.log` 内容换掉，看有没有任何命令响。
5. **保护集依赖损坏数据 = 保护失效**。「账本引用过的证据永不删」的保护集来自解析成功的记录；
   一条损坏行就让它引用的证据脱保，`--apply` 真删。删除类命令必须先验链再决定删不删。
6. **闸的输入范围可由调用方伪造**。`gate --changed <映射不到模块的路径>` → `PASS` + `modules:[]`，
   但 `diffHash` 仍是**真**工作树指纹；`task complete` 只看 `gate==='PASS' && diffHash 相等`，
   于是真跑会 FAIL 的树被判完成。查检：闸记录里有没有「范围是谁给的」这一字段，下游有没有比对 planHash。
7. **降级态被 waiver / Fast Mode 洗成绿**。waiver 把 FAIL 洗成 SKIPPED 后：`gate-audit` 把连败 4 次的
   check 列进 `neverIntervened` 并配文案「genuinely stable」，`risk` 的 FAIL_STREAK 也不计——
   **被压制的失败和从没接线长得一模一样**。Fast Mode 全 SKIP 时 gate 仍 PASS，`task complete` 照过。
   查检：每条聚合统计有没有单独的「被压制」桶。

配套：非 git 树里 `gitFingerprint()` 恒为 `sha256("NON_GIT")`，任何绑 diffHash 的凭据在非 git 下都退化成常量；
`task complete` 是唯一不做 non-git 降级的消费者，rc 2 + 「run: harness.mjs gate」而那条命令在同一棵树里必 rc 3。
相关：[[pattern_gate-scripts-false-green-in-machine-channel]]、[[pattern_golden-baseline-rulers]]
