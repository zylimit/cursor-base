---
type: feedback
description: OCR 结果需可溯源到原图——V1 图不入库用完删导致结果无图可查，V2.0 服务化存图要建"OCR 结果 ↔ 原图"关联
created: 2026-07-28
updated: 2026-07-28
occurrences: 1
graduated: false
skipped: true  # 2026-11-08 裁定：optical-power-toolkit 的项目口径（OCR 结果 ↔ 原图关联），归该项目 domain/，不进框架
source_skill: product-spec-builder
origin: optical-power-toolkit
---

# OCR 结果需可溯源到原图

**问题描述**：V1 图片不入库、用完即删，OCR 结果（power/坐标/盒名/地址/时间）存进了库，但产生这些值的原图没了。业务方/下游看到一条 OCR 值想核对"这个值从哪张照片读出来的"，无图可查——这是 V1 真实痛点。用户原话"现在老是怀疑，觉得我 OCR 有问题"指的就是这个：不是怀疑 OCR 识别能力，是 OCR 结果没法追溯到产生它的原图。

**触发场景**：product-spec-builder 迭代 V2.0 服务化 Spec，讨论去重/合并规则时。主 Agent 误把用户原话听成"Claude 老怀疑 OCR 识别能力"，把方向记成了"别在 Spec 阶段反复怀疑已验证能力"。实际用户说的是结果可溯源性问题——OCR 结果与原图的关联断了。

**教训/建议**：V2.0 服务化存图的核心目的之一就是建"OCR 结果 ↔ 原图"关联——每条 OCR 记录的 `image_path` 指向产生该结果的那张原图，实现溯源。Spec 里把这条作为产品需求钉死，不是行为反馈、不是兜底怀疑。听用户反馈先确认语义再下结论，别把"结果没图可溯"听成"识别能力被怀疑"。
