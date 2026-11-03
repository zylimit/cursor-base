export const meta = {
  name: 'code-review-fanout',
  description: '多维 fan-out 代码审查 + 逐条 CoVe 多视角对抗验证，回传已独立核验的高可信缺陷清单',
  whenToUse: '改动面较大、需要多审查维度并行 + 对抗验证时，由主 Agent 显式 opt-in 调用（成本 ~15x，单 1-2 处改动用 Task 直派更划算）',
  phases: [
    { title: 'Review', detail: '多审查维度并行，各派 code-reviewer 出 findings' },
    { title: 'Verify', detail: '每条 finding 用不同视角 lens 独立对抗核验' },
  ],
}

// args: { scope?: string, dimensions?: [{key, prompt}] }
// 主 Agent 调用前用 args.scope 传审查范围（如 "Phase 2 交付清单" 或 "src/auth/ 改动 git diff"）
const scope = (args && args.scope) || '当前改动范围（git diff）'
const DIMENSIONS = (args && args.dimensions) || [
  { key: 'correctness', prompt: '逐条对照 Product-Spec.md 检查功能正确性与边界（越界 / null / 错误分支 / 竞态）' },
  { key: 'security', prompt: '安全审查：硬编码密钥、eval/innerHTML、SQL 注入、路径泄露、依赖漏洞' },
  { key: 'spec', prompt: '规格符合性 + Spec 漂移：每条 Spec 是否实现，代码是否有 Spec 外的多余功能' },
]

// 视角多样性 lens —— 以多视角补回纯 CC 失去的「异构模型互照」
const LENSES = ['correctness', 'repro', 'security']

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          verificationQuestion: { type: 'string', description: '可独立判定的验证问题（CoVe）' },
          evidence: { type: 'string', description: '证据句柄：grep 命中 / 测试输出 / 编译输出 / Spec 原文' },
        },
        required: ['title', 'file', 'severity', 'verificationQuestion', 'evidence'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    isReal: { type: 'boolean' },
    reason: { type: 'string' },
    evidence: { type: 'string', description: '核验所凭的客观证据句柄' },
  },
  required: ['isReal', 'reason'],
}

phase('Review')
log(`审查范围：${scope}；维度：${DIMENSIONS.map(d => d.key).join(' / ')}`)

// pipeline：每个维度审完即进入逐条 verify，不等其他维度（无 barrier）
const results = await pipeline(
  DIMENSIONS,
  d => agent(
    `你是 code-reviewer。审查范围：${scope}。审查维度【${d.key}】：${d.prompt}\n` +
    `用关键条件验证法（CoVe）：每个风险点给出一个可独立判定的 verificationQuestion + 一条 evidence 证据句柄。只报实锤与高可信疑点，别堆砌主观感受。`,
    { agentType: 'code-reviewer', label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }
  ),
  (review) => parallel(
    ((review && review.findings) || []).map(f => () =>
      agent(
        `对抗式核验以下缺陷是否真实存在（默认怀疑：证据不足即判 isReal=false）：\n` +
        `标题：${f.title}\n文件：${f.file}:${f.line || '?'}\n验证问题：${f.verificationQuestion}\n声称证据：${f.evidence}\n` +
        `用【${LENSES[f.title.length % LENSES.length]}】视角，亲自核验证据句柄（grep / 读文件 / 跑命令）后下判断，附你核到的客观证据。`,
        { agentType: 'code-reviewer', label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA }
      ).then(v => ({ ...f, verdict: v }))
    )
  )
)

// 汇总：只留被独立核验确认为真的缺陷，回传「结论 + 证据句柄」给主 Agent 定夺
const confirmed = results.flat().filter(Boolean).filter(f => f.verdict && f.verdict.isReal)
log(`确认缺陷 ${confirmed.length} 条（已逐条独立核验）`)

return {
  scope,
  confirmedCount: confirmed.length,
  confirmed: confirmed.map(f => ({
    title: f.title,
    file: f.file,
    line: f.line,
    severity: f.severity,
    verificationQuestion: f.verificationQuestion,
    evidence: (f.verdict && f.verdict.evidence) || f.evidence,
    verdictReason: f.verdict && f.verdict.reason,
  })),
}
