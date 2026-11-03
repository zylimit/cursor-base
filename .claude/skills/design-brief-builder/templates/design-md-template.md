---
name: design-md-template
description: DESIGN.md 输出模板，按 Google DESIGN.md 开放规范（google-labs-code/design.md）写：YAML 前言放 token，正文八段按固定顺序写 prose；prose 是主体，token 是上下文。设计工具、Claude Code、Cursor、Stitch 都能直接读。
---

# DESIGN.md 输出模板

文件名 DESIGN.md，放项目根。两层：前言是机器读的 token（`{path.to.token}` 引用），正文是人读的 prose——prose 才是主体，token 是它的上下文。八段可省略但顺序锁定；未知段（如 Motion、Iconography）允许追加在合适位置，消费方保留不报错。
写法上的两条铁律：**一个具体参照胜过一堆形容词**（写「1970 年代老牌大学的研究生讲义」，不写「现代、干净、可信」）；**每个 token 说清为什么存在、用在哪、不用在哪**。Do's and Don'ts 收进参照带来的否定约束、反参考和 AI 通病。
能跑就跑 `npx @google/design.md lint DESIGN.md`（校 token 引用与 WCAG 对比）；跑不了标「未经 lint」。

---

```markdown
---
version: alpha
name: {{产品名 / 系统名}}
description: {{一句：这套视觉是什么，用一个具体参照物说}}
colors:
  primary: "{{#hex，唯一强调色，只给最重要的动作}}"
  on-primary: "{{#hex}}"
  secondary: "{{#hex，边框 / 元信息 / 次级文字}}"
  neutral: "{{#hex，底色}}"
  surface: "{{#hex，卡片 / 面板}}"
  on-surface: "{{#hex，正文}}"
  on-surface-muted: "{{#hex，次级文字，对比 ≥4.5:1}}"
  border: "{{#hex}}"
  success: "{{#hex}}"
  warning: "{{#hex}}"
  error: "{{#hex，同时是破坏性动作的色}}"
  agent: "{{#hex 或删掉；有 AI 才有，且只给 AI 的活动}}"
typography:
  display:
    fontFamily: {{字族}}
    fontSize: {{px/rem}}
    fontWeight: {{数字}}
    lineHeight: {{倍数}}
    letterSpacing: {{em}}
  headline-md:
    fontFamily: {{字族}}
    fontSize: {{…}}
    fontWeight: {{…}}
    lineHeight: {{…}}
  body-md:
    fontFamily: {{字族}}
    fontSize: {{≥16px 移动端}}
    fontWeight: 400
    lineHeight: {{1.5-1.7}}
  label-sm:
    fontFamily: {{字族}}
    fontSize: {{…}}
    fontWeight: {{…}}
    lineHeight: {{…}}
  mono:
    fontFamily: {{等宽字族，代码 / ID / 时间码}}
    fontSize: {{…}}
    fontWeight: 400
    lineHeight: 1.5
rounded:
  none: 0px
  sm: {{px}}
  md: {{px}}
  lg: {{px}}
  full: 9999px
spacing:
  xs: {{px}}
  sm: {{px}}
  md: {{px}}
  lg: {{px}}
  xl: {{px}}
  gutter: {{px}}
  section: {{px}}
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    padding: {{px px}}
    height: {{px}}
  button-primary-hover:
    backgroundColor: "{{#hex 或 token}}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: {{px px}}
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: {{px}}
    height: {{≥44px 移动端}}
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
---

## Overview

{{一段具体参照：这套视觉像什么——一件器物、一种印刷品、一个场所——受众是谁、该有什么情绪反应、密度是密是疏。写画面，不写形容词清单。}}

## Colors

{{一句系统：单强调还是双色、暖冷、深浅。然后每个颜色一条：}}
- **Primary ({colors.primary})**：{{只用于最重要的一个动作与…；不用于…}}
- **Secondary ({colors.secondary})**：{{边框、说明、元信息；不用于…}}
- **Neutral ({colors.neutral}) / Surface ({colors.surface})**：{{底与面的层级靠明度差不靠阴影}}
- **Error ({colors.error})**：{{错误与破坏性动作专用，不做强调色}}
- **Agent ({colors.agent})**：{{只出现在 AI 的产出、进度、可撤销范围；人类操作不许用；人接手即退成普通}}
{{深色模式：另一组 token 或另一份 DESIGN.md；不是浅色反转，对比单独测。}}

## Typography

{{一到两个字族及其角色；两个的话要明显不同。行长上限、字号差距是大是小、标题是醒目还是克制。}}
- **Display（typography.display）**：{{用在哪、不用在哪}}
- **Body（typography.body-md）**：{{正文，行长 <80 字符}}
- **Label（typography.label-sm）**：{{按钮、表格头；不全大写除非有理由}}
- **Mono（typography.mono）**：{{代码、ID、时间码；不用于小数据标签装饰}}

## Layout

{{网格模型：流式 / 固定最大宽；间距刻度（{spacing.xs} 到 {spacing.xl}）与节奏；段落间距 {spacing.section}；工作台型写清不可压缩的主任务区。}}

## Elevation & Depth

{{层级靠什么：明度阶梯 / 发丝线 / 阴影。用阴影的写清阴影语言（环境 + 直射）；扁平的写替代手段。}}

## Shapes

{{圆角语言与它的逻辑：{rounded.sm} 控件、{rounded.md} 卡片、{rounded.lg} 弹层；嵌套圆角子 ≤ 父；不在同一屏混用锐角与圆角。}}

## Components

{{每个核心组件一段：解剖、色用法、尺寸、状态外观（默认 / 悬停 / 聚焦 / 禁用 / 加载 / 错误）；悬停不位移；焦点环可见。}}
- **Button**：{{…}}
- **Input**：{{…}}
- **Card / Table row**：{{…}}
- **Status dot / badge**：{{语义靠形状不只靠颜色}}

## Do's and Don'ts

- Do：{{参照带来的做法}}
- Do：{{只把 primary 用在每屏唯一的主动作上}}
- Do：{{对比 ≥4.5:1；reduced-motion 时动效退化}}
- Don't：{{参照带来的否定：不做渐变 / 发光 / 拟物 / 一律圆角…}}
- Don't：{{反参考}}
- Don't：{{AI 通病：ALL-CAPS 眉标、中点串元信息、「WORD — 片段」标签、按钮尾巴 →、每段淡入、一律灰影卡片、纯黑冒充}}

## Motion

```yaml
motion:
  feedback: {{ms}}
  content: {{ms}}
  easing: "{{cubic-bezier}}"
```
{{动效只为说明因果：交互反馈 {{ms}}，内容过渡 {{ms}}，曲线只有一条；只留一处编排好的时刻；超过 {{ms}} 的砍掉；reduced-motion 全部归零。}}

## 硬约束

| 项 | 约束 |
|---|---|
| 主色 | 不用紫 / 靛作主色；不用「奶油底 + 衬线大标题 + 陶土橙」整套 |
| 色彩数量 | 总色 ≤ 5，渐变色标 ≤ 3，不单一色相统治全屏 |
| 字体 | 字族 ≤ 2；正文 ≥ 14px；letter-spacing 不为负；字号不随视口缩放 |
| 行长与行高 | 正文 `max-width: 65ch`；`line-height` 1.4–1.6 |
| 圆角 | ≤ 8px；不全场统一一个圆角；禁卡中卡、禁区块做浮卡 |

这张表既约束生成，也是 `ui-slop-scan` 的判据来源（`node .claude/scripts/ui-slop-scan.mjs`）；病因不是「用了紫色」而是「没做选择」，所以扫描只兜底、不当审美裁判，有意违反的在代码里写 `unslop-ignore: <理由>`，扫描跳过并计入已豁免。
表里机器能判的（主色色相、正文字号、字距、行高、圆角、总色数、字族数、渐变色标、奶油底与陶土橙同现）扫描已实现；「不单一色相统治全屏」「不全场统一一个圆角」「禁卡中卡」「`max-width: 65ch`」「字号不随视口缩放」静态判不准，留给人眼与 design-maker 的两遍法。
```

---

## 写作要点
1. 前言至少 `name` 与 `colors.primary`；token 名按意图命名（`primary`、`on-surface`），不按值命名（`blue-500`）。
2. 八段顺序锁定（Overview / Colors / Typography / Layout / Elevation & Depth / Shapes / Components / Do's and Don'ts）；Motion 等自定义段放最后。
3. prose 里引用 token 用 `{colors.primary}` 形式，让引用可被 lint 校验。
4. 有 UI 系统（shadcn / MUI / 原生）时只写差量，token 引用系统默认值的写「继承 xxx」。
5. Do's and Don'ts 是给生成器的护栏：参照的否定约束 + 反参考 + AI 通病三合一。
6. 深色两套一起设计；纯黑（#000）与冒充黑（#0B0B0B）都要有理由。
