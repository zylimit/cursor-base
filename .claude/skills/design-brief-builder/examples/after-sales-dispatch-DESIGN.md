---
# 虚构教学例：其中页面数、token、状态与业务假设不自动成为任何项目的要求，也不可当作验收证据。
version: alpha
name: 售后工单派单
description: 像一本瑞士手表说明书：暖白纸底、一支墨、结构靠细线、字号差距小、唯一的彩色只给型号标签。桌面端是安静的工作台，手机端是一列大字大点。
colors:
  primary: "#284057"
  on-primary: "#FFFFFF"
  secondary: "#656359"
  neutral: "#F0EFEB"
  surface: "#F7F6F3"
  on-surface: "#1C1C1A"
  on-surface-muted: "#565349"
  border: "#C6C3B9"
  success: "#2F6B3F"
  warning: "#8A5A12"
  error: "#973A2F"
typography:
  display:
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.01em
  headline-md:
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.35
  body-md:
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  label-sm:
    fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.2
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  none: 0px
  sm: 4px
  md: 7px
  lg: 10px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  gutter: 24px
  section: 48px
components:
  button-primary:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    padding: 10px 18px
    height: 40px
  button-primary-hover:
    backgroundColor: "#32312D"
  button-primary-mobile:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    typography: "{typography.headline-md}"
    rounded: "{rounded.md}"
    height: 56px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 9px 17px
    height: 40px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 10px
    height: 44px
  row:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    height: 32px
  row-mobile:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    height: 56px
  chip-model:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 10px
---

## Overview

一本瑞士手表的说明书：暖白的纸、一支墨、每个符号都有含义。受众是客服、维修组长和维修工——他们要的不是被打动，是几秒钟内找到人、按下唯一那个按钮。桌面端是安静的工作台，中等偏紧的密度，结构靠细线不靠阴影；手机端是一列大字大点，拇指够得到。没有装饰，没有渐变，没有卡片阵列。

## Colors

一支墨加一个强调，其余都是纸的明度。
- **Primary ({colors.primary})**：蓝黑墨，只给型号标签——待派单上最需要一眼认出的信息；不用于按钮、标题、背景。
- **On-surface ({colors.on-surface}) / muted ({colors.on-surface-muted})**：正文与次级文字，两级明度而不是两种颜色；主按钮就是墨的反色。
- **Neutral ({colors.neutral}) / Surface ({colors.surface})**：桌面与纸，层级靠这两级明度差；不再加第三层。
- **Border ({colors.border})**：发丝线，唯一的结构手段。
- **Success ({colors.success}) / Warning ({colors.warning}) / Error ({colors.error})**：只做状态的冗余通道；语义先靠形状（空心 / 半实 / 实心 / 删除线），颜色其次。Error 同时是作废与破坏性动作的色，不做强调色。
- 深色模式首版不做（两端都在亮环境）；补的时候另出一组 token，不是把上面反转。

## Typography

一个字族做全部界面（Inter 带中文回退），等宽只给工单号与型号代码。字号差距小：显示级 24、标题 18、正文 16、标签 14，说明书式的克制。
- **Display（typography.display）**：手机端当前单的地址与型号；桌面端不用。
- **Headline ({typography.headline-md})**：区块标题、手机端主按钮文字。
- **Body ({typography.body-md})**：正文与表单，行长桌面端 ≤40 个汉字。
- **Label ({typography.label-sm})**：按钮、表头、chip；不全大写。
- **Mono（typography.mono）**：工单号「1032」、型号代码「X-200」；不当装饰用在别的地方。

## Layout

桌面端固定最大宽 1440，左 40% 表单右 60% 列表，列间距 {spacing.gutter}；区块间距 {spacing.section}。手机端单列，页边距 {spacing.md}，行间距 {spacing.sm}，主按钮固定底部并留安全区。间距刻度 4 / 8 / 16 / 24 / 40，密度靠刻度不靠肉眼。

## Elevation & Depth

没有阴影。层级靠 {colors.neutral} 与 {colors.surface} 的明度差和 {colors.border} 发丝线；弹层用一层半透明遮罩加纸面，不用投影。悬停不位移、不抬升，只改背景一级。

## Shapes

小圆角的工程感：控件 {rounded.sm}、按钮与行 {rounded.md}、弹层 {rounded.lg}；型号 chip 用 {rounded.full} 做唯一的胶囊。同一屏不混用锐角与圆角；嵌套时子圆角不大于父。

## Components

- **Button**：主按钮是墨的反色 {components.button-primary}，手机端全宽 56px {components.button-primary-mobile}；悬停只加深一级 {components.button-primary-hover}；聚焦焦点环 2px 墨色偏移 2px；禁用 40% 不透明度；加载保留文案加进度。次级按钮 {components.button-secondary} 纸底墨字加发丝线。
- **Input**：按 components.input 取值，label 常显在上方，错误时下方红字 {colors.error} 并把边线换成 error 色。
- **Row**：桌面 components.row 高 32px，手机 components.row-mobile 高 56px；当前行左侧一根墨线，不用背景色块。
- **Chip（型号）**：{components.chip-model}，全站唯一的彩色实心块。
- **Status dot**：空心 / 半实 / 实心 / 删除线四形，颜色只做冗余。

## Do's and Don'ts

- Do 把 primary 只用在型号 chip 上；主按钮永远是墨色。
- Do 用形状表达状态，颜色只做第二通道。
- Do 保持对比 ≥4.5:1，手机端正文 ≥7:1；reduced-motion 时动效归零。
- Do 让每屏只有一个主按钮。
- Don't 用渐变、发光、拟物、投影——说明书没有这些。
- Don't 把内容切成一律圆角一律灰影的卡片阵列。
- Don't 用 ALL-CAPS 眉标、中点串元信息、「WORD — 片段」标签、按钮尾巴「→」。
- Don't 每段淡入上滑；全站只有新单进入列表那一次高亮渐退。
- Don't 用 #000 或 #0B0B0B；墨是 {colors.on-surface}，纸是 {colors.neutral}。

## Motion

```yaml
motion:
  feedback: 120ms
  content: 220ms
  easing: "cubic-bezier(0.165, 0.84, 0.44, 1)"
```
快进快停不弹跳。交互反馈（按压、展开）120ms，内容变化（新单进入、状态切换）220ms，同一条曲线 cubic-bezier(0.165, 0.84, 0.44, 1)。没有页面级转场；任何动效超过 300ms 就砍掉；reduced-motion 时全部归零。
