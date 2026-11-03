---
type: feedback
description: 部署验收以宿主真实状态为准，独立核查三件套（容器时间戳+镜像tag / 健康检查 / live冒烟），不以子 Agent 回复状态为唯一依据
created: 2026-06-03
updated: 2026-06-03
graduated: true  # 2026-06-04 毕业→CLAUDE.md [总体规则] 验收铁律 + release-builder [部署验收]；本文件留作细则参照
source_skill: release-builder
scores:
  accuracy: 3
  coverage: 2
  efficiency: 3
  satisfaction: 4
  evidence: "accuracy=3: release-builder/部署验收流程未指引如何独立核查部署结果，验收方法靠主 Agent 临时发明；coverage=2: 子 Agent 回报失败/空回复时如何判定真实部署状态属完全未覆盖场景；efficiency=3: 因 incomplete+空回复一度误判失败、需多步独立核查才确认成功；satisfaction=4: 最终核查准确、用户无负面评价。"
---

# 部署验收：以宿主真实状态为准做独立核查，不轻信子 Agent 回复状态

**问题描述**：
某次本机部署，主 Agent 派发 deployer Sub-Agent 执行部署任务。deployer 回报 `incomplete` + **空回复**，表面像失败。但主 Agent 独立核查发现部署其实**成功了**：
- `docker ps --format` 显示 presurvey-api/web 容器**创建时间戳**已更新（20:27，在最后一次代码提交之后），镜像 tag 已是新版本 v1.0.3；
- live api 健康检查 200，`curl /api/export/all` 实时导出的 KMZ 含预期新功能产物（np-radius-rings Folder + poly-np-ring）；
- deployer 在工作树留下冒烟测试产物 test.kmz（内容正确），佐证 build/up/验证其实都跑通了，只是最后回报环节挂了（通信/超时）；
- 陷阱：首次 `docker ps` 读到的 "Up 4 hours" 是 deployer 重启**之前**的旧容器残留读数，按 Up 时长判断会误导，必须按容器**创建时间戳**判断。

**触发场景**：
deployer Sub-Agent 执行部署后回报失败或空回复，但实际部署可能已成功——回报环节出问题 ≠ 任务失败。

**教训/建议**：

Why：子 Agent 的回复状态（incomplete / 空回复 / 自报"完成"）只反映它跑完了，不等于**任务实际执行结果正确**。若以回复状态为唯一判据，会把成功的部署误判为失败、或把失败误判为成功，进而触发无谓的重试甚至破坏已正确的线上状态。部署的 Definition of Done 必须建立在宿主机的客观证据上。

How to apply —— 部署验收一律由主 Agent 做**独立核查三件套**，不依赖 agent 自述：
1. **容器时间戳 + 镜像 tag**：`docker ps --format` 看容器**创建时间戳**是否晚于最后一次代码提交、镜像 tag 是否为目标新版本。**不要看 "Up 时长"**——它可能是重启前旧容器的残留读数，会误导。
2. **健康检查端点**：curl live 健康检查端点，确认返回 200。
3. **live 冒烟**：直接 curl 真实端点验证**新功能产物**确实存在（如本例 `curl /api/export/all` 验证 KMZ 含 np-radius-rings Folder + poly-np-ring），而非仅看进程起没起来。

部署后收尾：
- 清理子 Agent 在工作树留下的临时产物（如 test.kmz）；
- 确认版本号文件（release.conf / package.json）已提交。

判定规则：三件套全过 = 部署成功（哪怕 agent 回报 incomplete/空）；任一不过 = 才视为失败并排查。**不以 agent 回复状态为唯一依据。**

进化信号（给 evolution-engine）：release-builder / 部署验收流程可固化「独立核查三件套（容器创建时间戳+镜像tag / 健康检查端点 / live 冒烟验证新功能产物）」作为部署的 Definition of Done，并显式写明「子 Agent incomplete/空回复 ≠ 部署失败，以宿主真实状态为准」「按容器创建时间戳判断、勿用 Up 时长」「收尾清理临时产物 + 确认版本文件已提交」。
