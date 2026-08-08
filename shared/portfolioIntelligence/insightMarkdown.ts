import type { PortfolioInsightFinding } from './types.ts'

function titleForTag(tag: PortfolioInsightFinding['tag']): string {
  switch (tag) {
    case 'RECURRING ISSUES':
      return 'Recurring Issues'
    case 'RISK':
      return 'Needs Attention'
    case 'PREVENT FUTURE REPAIRS':
      return 'Prevent Future Repairs'
    case 'VENDOR RESPONSE':
      return 'Vendor Response'
  }
}

/** Ask Ulo markdown from shared insight findings + optional recommendation actions. */
export function buildInsightMarkdown(
  insights: PortfolioInsightFinding[],
  recommendationActions?: string[],
): string {
  if (insights.length === 0) {
    return [
      "Ulo's Property Insights doesn't currently flag a recurring-issue or preventive-repair pattern for your portfolio.",
      '',
      '### What I know',
      'I checked the same Property Insights signals shown on your Overview.',
      '',
      '### What happens next',
      "I'll keep watching for repeating categories and high-volume units so we can catch expensive patterns early.",
    ].join('\n')
  }

  const recurring = insights.find((i) => i.tag === 'RECURRING ISSUES')
  const risk = insights.find((i) => i.tag === 'RISK')
  const prevent = insights.find((i) => i.tag === 'PREVENT FUTURE REPAIRS')

  const parts: string[] = []

  if (recurring) {
    const countBit =
      typeof recurring.requestCount === 'number'
        ? ` Ulo has detected **${recurring.requestCount}** ${
            (recurring.categoryLabel ?? 'maintenance').toLowerCase()
          } requests in the last 60 days`
        : ''
    const place = recurring.building ? ` at **${recurring.building}**` : ''
    parts.push(
      `The biggest concern is your recurring **${
        (recurring.categoryLabel ?? 'maintenance').toLowerCase()
      }** problems${place}.${countBit}, which suggests an ongoing issue rather than isolated repairs.`,
    )
  }

  if (risk) {
    parts.push(
      `I'd also keep an eye on **${risk.unitLabel ?? 'the highest-volume unit'}** because it has generated more maintenance requests than any other unit recently${
        typeof risk.requestCount === 'number' ? ` (**${risk.requestCount}** in 60 days)` : ''
      }.`,
    )
  }

  if (prevent) {
    parts.push(
      `Finally, Ulo is recommending a preventive inspection for **${
        prevent.unitLabel ?? 'a high-activity unit'
      }**${
        prevent.categoryLabel ? ` (${prevent.categoryLabel.toLowerCase()})` : ''
      } before those repairs become more expensive.`,
    )
  }

  if (parts.length === 0) {
    parts.push(insights[0]!.text)
  }

  parts.push(
    '',
    '### Property Insights',
    ...insights.map((i) => `- **${titleForTag(i.tag)}:** ${i.text}`),
    '',
    "### What I'd do next",
  )

  const nextSteps = recommendationActions?.length
    ? recommendationActions
    : buildDefaultNextSteps(recurring, risk, prevent)

  for (const step of nextSteps) {
    parts.push(`- ${step}`)
  }

  return parts.join('\n')
}

function buildDefaultNextSteps(
  recurring: PortfolioInsightFinding | undefined,
  risk: PortfolioInsightFinding | undefined,
  prevent: PortfolioInsightFinding | undefined,
): string[] {
  const steps: string[] = []
  if (recurring) {
    steps.push(
      `Open a preventive inspection plan for the recurring ${
        (recurring.categoryLabel ?? 'issue').toLowerCase()
      } pattern${recurring.building ? ` at ${recurring.building}` : ''}.`,
    )
  }
  if (risk?.unitLabel) {
    steps.push(`Review the request history for ${risk.unitLabel} and look for a shared root cause.`)
  }
  if (prevent?.unitLabel) {
    steps.push(`Schedule the recommended preventive inspection for ${prevent.unitLabel}.`)
  }
  if (steps.length === 0) {
    steps.push('Use these Overview insights as the starting point before opening individual tickets.')
  }
  return steps
}

/** Recommendation-focused markdown for Ask Ulo "what should I do" questions. */
export function buildRecommendationMarkdown(
  recommendations: Array<{ title: string; message: string; actionLabel: string }>,
): string | null {
  if (recommendations.length === 0) return null
  const lead =
    recommendations.length === 1
      ? "Here's the highest-leverage action I'd take first."
      : "Here are the highest-leverage actions I'd take first, in order."
  const lines = [lead, '']
  recommendations.slice(0, 3).forEach((rec, i) => {
    lines.push(`### ${i + 1}. ${rec.title}`)
    lines.push(rec.message)
    lines.push(`**Next step:** ${rec.actionLabel}`)
    lines.push('')
  })
  return lines.join('\n').trim()
}
