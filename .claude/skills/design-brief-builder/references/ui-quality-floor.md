---
name: ui-quality-floor
description: 设计稿验收、dev-builder 写界面、code-review 审 UI 一致性时读。界面质量地板：MUST / SHOULD / NEVER 三档，任何风格都得满足；审计输出用 file:line 一行一条。
---

[定位]
    风格是选择，地板不是。这里的规则不分风格、不分行业，设计稿和代码都按它审。审计时只报违反项，格式 `文件:行 - 问题`，一行一条，不解释除非修法不显然；全过写「✓ 通过」。

[交互 · 键盘与焦点]
    MUST 全键盘可操作，Tab 顺序与视觉顺序一致；焦点环可见且不被 sticky / fixed 元素遮住；焦点管理（弹层内困住、关闭后归还）。
    NEVER `outline: none` 而不给替代焦点样式。

[交互 · 命中区与输入]
    MUST 命中区 ≥24px，移动端 ≥44px；视觉小于它就扩大命中区。移动端输入框字号 ≥16px 防 iOS 缩放。`touch-action: manipulation` 防双击缩放。
    NEVER 禁用浏览器缩放（`user-scalable=no`、`maximum-scale=1`）。

[交互 · 表单]
    MUST 不阻止粘贴；提交按钮在请求开始前保持可用，请求中禁用并显示进度且保留原文案；Enter 提交聚焦的输入，textarea 里 ⌘/Ctrl+Enter 提交；先接受自由输入再校验，不阻止打字；错误就地显示在字段旁，提交时聚焦第一个错误；`autocomplete` 与有意义的 `name`，正确的 `type` 与 `inputmode`；离开前警告未保存；兼容密码管理器与验证码粘贴；复选框与单选的标签和控件共用一个命中区。
    SHOULD 邮箱 / 验证码 / 用户名关拼写检查；占位符以「…」结尾并给示例格式。

[交互 · 状态与导航]
    MUST URL 反映状态（筛选 / Tab / 分页 / 展开面板可深链）；后退恢复滚动位置；导航用 `<a>` / Link（支持 ⌘点击、中键）。
    NEVER 用 `<div onClick>` 做导航。

[交互 · 反馈]
    MUST 破坏性动作要确认或给撤销窗口；toast 与行内校验用 polite `aria-live`。
    SHOULD 乐观更新，失败回滚或给撤销；打开后续对话的选项和加载态用「…」结尾（「重命名…」「加载中…」）。

[交互 · 触控与拖拽]
    MUST 触控目标大方、可供性清晰；首个 tooltip 延迟、后续即时；弹层内 `overscroll-behavior: contain`；拖拽时禁文本选择并对被拖元素设 `inert`；拖拽 / 滑动 / 捏合都有点击与键盘替代（除非本质就是手势）；看起来能点的必须能点。
    SHOULD 桌面单主输入框可自动聚焦，移动端很少。

[动效]
    MUST 尊重 `prefers-reduced-motion`；只动 `transform` / `opacity`；动效可被输入打断；超过 5 秒的自动播放要有暂停 / 停止 / 隐藏；`transform-origin` 正确。
    NEVER 动 `top / left / width / height`；`transition: all`。
    SHOULD 优先 CSS，其次 Web Animations API，最后 JS 库；动效只为说明因果或有意的愉悦；缓动匹配变化（尺寸 / 距离 / 触发方式）。

[布局]
    MUST 刻意对齐到网格 / 基线 / 边缘，不许偶然摆放；移动、笔记本、超宽屏都验（超宽用 50% 缩放模拟）；尊重安全区 `env(safe-area-inset-*)`；不出现意外滚动条，修掉溢出。
    SHOULD 光学对齐 ±1px；图标与文字的重量 / 尺寸 / 间距 / 颜色平衡；布局用 flex / grid 不用 JS 测量。

[内容与无障碍]
    MUST 骨架屏镜像最终内容防布局跳动；`<title>` 对应当前上下文；没有死胡同，总给下一步或恢复；设计空 / 稀 / 密 / 错四种内容态；数字比较用 `font-variant-numeric: tabular-nums`；状态不只靠颜色，图标有文字标签；视觉省略标签时仍有可访问名称；用「…」字符不用「...」；标题有 `scroll-margin-top`、有跳到内容链接、`<h1>`–`<h6>` 层级；对用户生成内容（极短 / 一般 / 极长）健壮；日期时间数字本地化（`Intl.*`）；`aria-label` 准确、装饰元素 `aria-hidden`；图标按钮有描述性 `aria-label`；先用原生语义（button / a / label / table）再用 ARIA；媒体有字幕 / 文稿；不换行空格保住单位、快捷键、品牌名。
    SHOULD 行内帮助优先、tooltip 最后；弯引号；`text-wrap: balance` 防孤字；品牌名与代码标识加 `translate="no"`。

[内容处理]
    MUST 文本容器处理长内容（截断 / 行夹 / 断词）；flex 子元素 `min-w-0` 才能截断；空字符串 / 空数组不渲染坏 UI。

[性能]
    MUST 可靠测量（关掉干扰扩展）；跟踪并减少重渲染；用 CPU / 网络节流做剖析；批量读写布局避免回流；变更请求（POST / PATCH / DELETE）目标 <500ms；大列表（>50 项）虚拟化；首屏图预加载、其余懒加载；图片写明宽高防 CLS。
    SHOULD 测 iOS 低电量模式与 macOS Safari；优先非受控输入；CDN 域 `preconnect`；关键字体 `preload` + `font-display: swap`；用静音循环视频代替 GIF 并给静态与减动效替代。

[深色模式与主题]
    MUST 深色主题在 `<html>` 上设 `color-scheme: dark`；原生 `<select>` 显式 `background-color` 与 `color`；底色从 `#121212` 起，不用纯黑；层级靠白色叠加表达（4dp 约 9% 白），不靠更黑；主色在暗色下降饱和；最底层与白字对比 ≥ 15.8:1。
    SHOULD `<meta name="theme-color">` 与页面底色一致。

[设计]
    MUST 图表色盲友好；对比达标，优先 APCA 其次 WCAG 2；hover / active / focus 时对比增加而不是减少。
    SHOULD 分层阴影（环境 + 直射）；半透明边框 + 阴影出锐边；嵌套圆角子 ≤ 父且同心；边框 / 阴影 / 文字色向背景色相靠；浏览器 UI 与底色匹配；避免深色渐变条带。

[AI 通病自检]
    生成的设计稿或页面另过一遍 style-vocabulary.md 的通病清单：ALL-CAPS 眉标、中点串、破折号标签、一律圆角一律灰影、每段淡入、按钮尾巴「→」、纯黑冒充、单一酸绿强调——命中的说出为什么留或改。

[反模式速查（审计时点名）]
    `user-scalable=no` / `maximum-scale=1`；`onPaste` + `preventDefault`；`transition: all`；`outline-none` 无替代；`<div>` / `<span>` 挂点击当按钮；图片无尺寸；大数组 `.map()` 无虚拟化；输入无标签；图标按钮无 `aria-label`；硬编码日期数字格式；无理由的 `autoFocus`；能用视频却用 GIF；只有手势没有点击与键盘替代。
