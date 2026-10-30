const BLOCKED_NAME = /^(undefined|null|none|nan)$/i

/** First name from the account holder's contact name. Emails and placeholders are omitted. */
export function accountHolderFirstName(contactName: string | null | undefined): string | null {
  const trimmed = (contactName ?? '').trim().replace(/\s+/g, ' ')
  if (!trimmed || trimmed.includes('@') || BLOCKED_NAME.test(trimmed)) return null
  const first = trimmed.split(' ')[0] ?? ''
  if (!first || first.includes('@') || BLOCKED_NAME.test(first)) return null
  if (first === first.toLowerCase() || first === first.toUpperCase()) {
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
  }
  return first
}

function bandCopy(percent: number, named: boolean): string {
  if (percent <= 0) return named ? 'Let\u2019s get your portfolio ready, {name}' : 'Let\u2019s get your portfolio ready'
  if (percent < 30) return named ? 'You\u2019re building momentum, {name}' : 'You\u2019re building momentum'
  if (percent < 60) return named ? 'Your portfolio is taking shape, {name}' : 'Your portfolio is taking shape'
  if (percent < 85) return named ? 'Strong progress, {name}' : 'You\u2019re making strong progress'
  if (percent < 100) return named ? 'You\u2019re almost there, {name}' : 'You\u2019re almost there'
  return named ? 'Your portfolio is ready, {name}' : 'Your portfolio is ready'
}

/** Heading for the setup card. Uses a first name only when it is a real given name. */
export function setupPortfolioHeading(percent: number, contactName: string | null | undefined): string {
  const safePercent = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)))
  const firstName = accountHolderFirstName(contactName)
  const template = bandCopy(safePercent, Boolean(firstName))
  return firstName ? template.replace('{name}', firstName) : template
}
