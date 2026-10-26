import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomInt } from 'node:crypto'
const root = 'docs/ux/research/creation'
const sources = randomInt(2) ? ['baseline', 'prototype'] : ['prototype', 'baseline']
await mkdir(`${root}/blind-packet`, { recursive: true })
for (const [index, source] of sources.entries()) {
  const text = await readFile(`${root}/${source}.md`, 'utf8')
  // Only suppress the condition-specific system banner in the review copy.
  // All actual excerpts, placeholders and author edits remain unchanged.
  const anonymous = text.replace(
    '材料整理底稿\n\n以下仅将你的方向和原始材料编排为可编辑底稿；尚未生成论证或核实事实。\n\n',
    '',
  )
  await writeFile(`${root}/blind-packet/${index ? 'B' : 'A'}.md`, anonymous)
}
await writeFile(
  `${root}/blind-key.json`,
  JSON.stringify(
    {
      investigatorOnly: true,
      createdAt: new Date().toISOString(),
      A: sources[0],
      B: sources[1],
      mask: 'Only the local Mock system banner removed from review copies; content and placeholders retained.',
    },
    null,
    2,
  ),
)
await writeFile(
  `${root}/blind-packet/REVIEW.md`,
  `# 匿名底稿评审\n\n原始主题：少收集一点，给每周回顾留出时间。\n\n原始记录：周五原始记录：我存了 12 个链接，只重读了 2 条。下周先重读，再决定要不要继续收藏。\n\n作者校订句：先完成一次回顾。\n\n请分别按素材忠实度、意图与观点、事实边界、结构与可编辑性、完整度与剩余劳动评分（1–5），附原文位置和理由。编造事实、误归因和丢失限定条件单列为阻断缺陷。\n\n两份均为本地演示底稿。系统来源标记已隐藏，实际摘录与待补写位置保留。结构可能暴露来源，请另记出处猜测与信心。请勿只按流畅度评分。\n`,
)
console.log('Anonymous review packet prepared; no review performed and nobody contacted.')
