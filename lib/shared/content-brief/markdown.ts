import type { ContentBrief } from '@/types/market'

export function briefToMarkdown(brief: ContentBrief): string {
  const lines: string[] = []
  const date = new Date(brief.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  lines.push(`# Content Brief: ${brief.recommendedTitle}`)
  lines.push('')
  lines.push(`**Primary Keyword:** ${brief.keyword}`)
  if (brief.keywordCluster.length > 1) {
    lines.push(`**Keyword Cluster:** ${brief.keywordCluster.join(', ')}`)
  }
  lines.push(`**Intent:** ${brief.primaryIntent}`)
  lines.push(`**Target Word Count:** ${brief.targetWordCount.toLocaleString()} words`)
  lines.push(`**Generated:** ${date}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  lines.push('## Meta')
  lines.push('')
  lines.push(`**Title Tag:** ${brief.recommendedTitle}`)
  lines.push('')
  lines.push(`**Meta Description:** ${brief.metaDescription}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  lines.push('## Key Topics to Cover')
  lines.push('')
  for (const topic of brief.keyTopics) {
    lines.push(`- ${topic}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  lines.push('## Content Outline')
  lines.push('')
  for (const section of brief.sections) {
    const prefix = section.level === 2 ? '##' : '###'
    lines.push(`${prefix} ${section.heading}`)
    lines.push(`*~${section.estimatedWords} words*`)
    lines.push('')
    for (const point of section.keyPoints) {
      lines.push(`- ${point}`)
    }
    lines.push('')
  }
  lines.push('---')
  lines.push('')

  if (brief.serpInsights.length > 0) {
    lines.push('## SERP Insights')
    lines.push('')
    for (const insight of brief.serpInsights) {
      lines.push(`- ${insight}`)
    }
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  if (brief.competitorGaps.length > 0) {
    lines.push('## Competitor Gaps & Opportunities')
    lines.push('')
    for (const gap of brief.competitorGaps) {
      lines.push(`- ${gap}`)
    }
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  if (brief.internalLinks.length > 0) {
    lines.push('## Internal Linking Suggestions')
    lines.push('')
    lines.push('| Anchor Text | Target URL | Context |')
    lines.push('|---|---|---|')
    for (const link of brief.internalLinks) {
      const anchor = link.anchorText.replace(/\|/g, '\\|')
      const slug = link.targetSlug.replace(/\|/g, '\\|')
      const ctx = link.context.replace(/\|/g, '\\|')
      lines.push(`| ${anchor} | \`${slug}\` | ${ctx} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function downloadMarkdownBrief(brief: ContentBrief): void {
  const md = briefToMarkdown(brief)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `content-brief-${brief.keyword.replace(/\s+/g, '-').toLowerCase()}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
