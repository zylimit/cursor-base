// UserPromptExpansion(release-builder)：发布指令展开前的前置闸——把「打包前先过测试卡点」
// 从 skill 文字升级为机器闸。用户敲 /release-builder 时（含 disable-model-invocation 后的
// 唯一入口），在 skill 内容展开进上下文之前检查：
//   - .needs-review 有待审文件 → block（review→fix 闭环没走完，不许进发布流程）
//   - 干净 → 放行，并注入 additionalContext 提醒发布前置卡点（测试全绿运行清单 /
//     打包禁跳步 / 部署三件套独立验收）
// 发布卡点是地板闸（profile.floor），任何档位都改不了（CLAUDE.md：Fast Mode 不等于部署或 push 授权）。
// fail-open：本闸出错放行（发布流程自身还有 test-builder 卡点与 HIGH 档审批兜底）。
import { projectDir, readStdinJson, pendingReviewFiles, emit, runFailOpen } from './lib/io.mjs';
import { gateLog } from './lib/gatelog.mjs';

const CTX = '发布前置卡点提醒（release-gate 注入）：① 打包前必过测试卡点——test-builder 全量跑，报绿须附运行清单（跑了哪些文件、各自结果），证据=运行器真实输出；② Fast Mode 不豁免发布卡点；③ 部署完成后主 Agent 独立核查三件套（容器创建时间戳+镜像 tag / 健康检查端点 / live 冒烟），不信 deployer 自报。';

runFailOpen(() => {
  const ev = readStdinJson();
  // matcher 已按命令名过滤；解析失败或非目标命令时不拦（belt-and-braces）
  const cmdName = ev ? String(ev.command_name || '') : '';
  if (cmdName && cmdName !== 'release-builder') return;

  const root = projectDir();
  const pending = pendingReviewFiles(root);

  if (pending.length > 0) {
    const reason = `发布前置闸：待审清单未清（${pending.length} 个文件待 code review：${pending.join('、')}）。先完成 review→fix 闭环（通过后 echo clean > .claude/.needs-review），再执行 /release-builder。`;
    gateLog('release-gate', reason);
    emit({ decision: 'block', reason });
    return;
  }

  emit({ hookSpecificOutput: { hookEventName: 'UserPromptExpansion', additionalContext: CTX } });
});
