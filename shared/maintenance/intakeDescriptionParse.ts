/**
 * Split concatenated intake description blobs (opening SMS + Tenant update
 * fragments + labeled lines) without summarizing them.
 */

const TENANT_UPDATE_SPLIT = /(?:^|\n+)\s*Tenant update:\s*/i

const LABELED_LINE_RE =
  /^\s*(Affected area|Safety concerns|First noticed|Resident availability|Entry if not home|Entry if absent|Preferred contact method|Preferred contact):\s*(.+?)\s*$/i

const WINDOW_CUE =
  /\b(?:(?:this|next|coming)\s+)?(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|sat|sun|mon|tue|wed|thu|fri)\b|\ball\s+day\b|\bafter\s+\d|\bbetween\s+\d|\b(?:am|pm)\b/i

const ISSUE_OR_GREETING =
  /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thank)/i

const PEST_LIKE =
  /\b(?:exterminator|pest\s+control|spray(?:ing)?\s+(?:the\s+)?(?:property|unit|apartment)|roach|cockroach|mice|mouse|termite)\b/i

export type IntakeDescriptionParts = {
  openingMessage: string
  tenantUpdates: string[]
  labeledFields: Record<string, string>
}

function normalizeLabelKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

/** Split a stored description into opening, Tenant update fragments, and labels. */
export function parseIntakeDescriptionParts(raw: string): IntakeDescriptionParts {
  const text = (raw ?? '').replace(/\r\n/g, '\n').trim()
  const labeledFields: Record<string, string> = {}
  const tenantUpdates: string[] = []

  if (!text) {
    return { openingMessage: '', tenantUpdates: [], labeledFields }
  }

  const withoutLabels = text
    .split('\n')
    .map((line) => {
      const m = line.match(LABELED_LINE_RE)
      if (!m) return line
      const key = normalizeLabelKey(m[1]!)
      const value = m[2]!.replace(/[.]+$/, '').trim()
      if (value) labeledFields[key] = value
      return ''
    })
    .join('\n')
    .replace(
      /\s*(Affected area|Safety concerns|First noticed|Resident availability|Entry if not home|Entry if absent|Preferred contact method|Preferred contact):\s*[^\n]+/gi,
      (full, label: string) => {
        const m =
          full.match(LABELED_LINE_RE) ??
          full.match(new RegExp(`${label}:\\s*(.+)`, 'i'))
        if (m) {
          const value = (m[2] ?? m[1] ?? '').replace(/[.]+$/, '').trim()
          if (value) labeledFields[normalizeLabelKey(label)] = value
        }
        return ' '
      },
    )

  const chunks = withoutLabels
    .split(TENANT_UPDATE_SPLIT)
    .map((c) => c.trim())
    .filter(Boolean)
  let openingMessage = (chunks[0] ?? '').replace(/\s+/g, ' ').trim()
  for (let i = 1; i < chunks.length; i += 1) {
    const update = chunks[i]!.replace(/\s+/g, ' ').trim()
    if (update) tenantUpdates.push(update)
  }

  if (/Tenant update:/i.test(openingMessage)) {
    const glued = openingMessage
      .split(/\s*Tenant update:\s*/i)
      .map((c) => c.trim())
      .filter(Boolean)
    openingMessage = glued[0] ?? ''
    tenantUpdates.unshift(...glued.slice(1))
  }

  return { openingMessage, tenantUpdates, labeledFields }
}

/**
 * Never treat the opening issue/greeting (or other non-window text) as
 * resident availability.
 */
export function sanitizeAvailabilityFromDescription(
  availability: string | null | undefined,
  openingMessage: string,
  extraSources: string[] = [],
): string | null {
  const t = (availability ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (ISSUE_OR_GREETING.test(t) && !WINDOW_CUE.test(t)) return null
  if (PEST_LIKE.test(t) && !WINDOW_CUE.test(t)) return null
  const lower = t.toLowerCase()
  for (const raw of [openingMessage, ...extraSources]) {
    const s = (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (!s) continue
    if (lower === s) return null
    if (s.startsWith(lower) && lower.length >= 40) return null
    if (lower.startsWith(s) && s.length >= 40) return null
  }
  if (!WINDOW_CUE.test(t)) return null
  return t
}
