/**
 * Summary clarification — one short ask when a repair is missing or has
 * conflicting essential facts. Pure helpers shared by edge SMS + tests.
 */
import {
  extractMaintenanceRequestFacts,
  type MaintenanceRequestFacts,
} from './maintenanceRequestFacts.ts'

export type SummaryClarificationField =
  | 'physical_location'
  | 'which_repair'
  | 'serves_floor'

export type SummaryClarificationPending = {
  ticketId: string
  field: SummaryClarificationField
  question: string
  askedAt: string
  /** Optional list when field === which_repair */
  candidates?: Array<{ ticketId: string; label: string }>
}

export const AWAITING_SUMMARY_CLARIFICATION_KEY = 'awaiting_summary_clarification'

/** Map needsClarification copy → which field the answer should update. */
export function clarificationFieldFromNeeds(
  needsClarification: string | null | undefined,
): SummaryClarificationField | null {
  const q = (needsClarification ?? '').trim()
  if (!q) return null
  if (/which (?:repair|request|one)\b/i.test(q)) return 'which_repair'
  if (/which floor|serves (?:floor|the)/i.test(q)) return 'serves_floor'
  if (/where is|located|location|which room/i.test(q)) return 'physical_location'
  return 'physical_location'
}

export function buildSummaryClarificationSms(question: string): string {
  const q = question.trim().replace(/\s+/g, ' ')
  if (!q) return 'Quick question so we send the right technician — where is the issue located?'
  if (/\?$/.test(q)) return q
  return `${q}?`
}

const PLACE_RE =
  /\b(?:basement|crawl\s*space|attic|garage|kitchen|bathroom|bedroom|living\s*room|laundry|hallway|yard|utility\s*room|foundation|(?:back|front)\s+porch|porch)\b/i

const FLOOR_RE =
  /\b(?:first|1st|second|2nd|third|3rd|ground|main)\s+floor\b/i

function labelCase(place: string): string {
  const t = place.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Parse a resident answer into a field value. Returns null when unclear
 * (caller should re-ask once or leave pending).
 */
export function parseClarificationAnswer(
  field: SummaryClarificationField,
  rawAnswer: string,
  pending?: SummaryClarificationPending | null,
): string | null {
  const text = rawAnswer.replace(/\s+/g, ' ').trim()
  if (!text) return null

  if (field === 'which_repair' && pending?.candidates?.length) {
    const num = text.match(/^\s*(\d+)\s*[.)]?\s*$/)
    if (num) {
      const idx = Number(num[1]) - 1
      const hit = pending.candidates[idx]
      return hit?.ticketId ?? null
    }
    const lower = text.toLowerCase()
    const byLabel = pending.candidates.find((c) =>
      lower.includes(c.label.toLowerCase().slice(0, 24)),
    )
    return byLabel?.ticketId ?? null
  }

  if (field === 'serves_floor') {
    const m = text.match(FLOOR_RE)
    return m ? labelCase(m[0]!) : null
  }

  // physical_location
  const m = text.match(PLACE_RE)
  if (m) return labelCase(m[0]!)
  // Short free-text place ("utility closet")
  if (text.split(/\s+/).length <= 4 && text.length <= 40 && !/[?]/.test(text)) {
    return labelCase(text.replace(/[.!]+$/g, ''))
  }
  return null
}

/**
 * Merge a clarified value into the ticket description labeled fields without
 * dropping other confirmed details.
 */
export function appendClarificationToDescription(
  description: string,
  field: SummaryClarificationField,
  value: string,
): string {
  const lines = (description ?? '').replace(/\r\n/g, '\n').split('\n')
  const label =
    field === 'physical_location'
      ? 'Affected area'
      : field === 'serves_floor'
        ? 'Serves floor'
        : null
  if (!label) return description

  let replaced = false
  const next = lines.map((line) => {
    if (new RegExp(`^\\s*${label}:\\s*`, 'i').test(line)) {
      replaced = true
      return `${label}: ${value}`
    }
    return line
  })
  if (!replaced) next.push(`${label}: ${value}`)
  // Also append a tenant update line so authored evidence stays on the ticket.
  if (field === 'physical_location') {
    next.push(`Tenant update: In the ${value.toLowerCase()}`)
  } else if (field === 'serves_floor') {
    next.push(`Tenant update: Serving the ${value.toLowerCase()}`)
  }
  return next.join('\n').trim()
}

export function readAwaitingSummaryClarification(
  intakeState: unknown,
): SummaryClarificationPending | null {
  if (!intakeState || typeof intakeState !== 'object') return null
  const raw = (intakeState as Record<string, unknown>)[AWAITING_SUMMARY_CLARIFICATION_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const ticketId = typeof row.ticketId === 'string' ? row.ticketId.trim() : ''
  const field = row.field as SummaryClarificationField
  const question = typeof row.question === 'string' ? row.question.trim() : ''
  const askedAt = typeof row.askedAt === 'string' ? row.askedAt.trim() : ''
  if (!ticketId || !question || !askedAt) return null
  if (
    field !== 'physical_location' &&
    field !== 'which_repair' &&
    field !== 'serves_floor'
  ) {
    return null
  }
  const candidates = Array.isArray(row.candidates)
    ? row.candidates
        .map((c) => {
          if (!c || typeof c !== 'object') return null
          const o = c as Record<string, unknown>
          const id = typeof o.ticketId === 'string' ? o.ticketId.trim() : ''
          const label = typeof o.label === 'string' ? o.label.trim() : ''
          return id && label ? { ticketId: id, label } : null
        })
        .filter((c): c is { ticketId: string; label: string } => Boolean(c))
    : undefined
  return { ticketId, field, question, askedAt, candidates }
}

export function canHandleSummaryClarification(input: {
  identityType: string
  intakeState: unknown
}): boolean {
  if (input.identityType !== 'resident') return false
  return readAwaitingSummaryClarification(input.intakeState) != null
}

/** Whether a new ask should be skipped (already asked for this ticket+field). */
export function alreadyAskedSameClarification(
  intakeState: unknown,
  ticketId: string,
  field: SummaryClarificationField,
): boolean {
  const pending = readAwaitingSummaryClarification(intakeState)
  return Boolean(pending && pending.ticketId === ticketId && pending.field === field)
}

export function buildWhichRepairQuestion(
  candidates: Array<{ ticketId: string; label: string }>,
): string {
  const lines = candidates.map((c, i) => `${i + 1}) ${c.label}`)
  return `Which repair are you updating?\n${lines.join('\n')}\nReply with the number`
}

export function factsNeedLocationClarification(
  description: string,
  category?: string | null,
): string | null {
  return extractMaintenanceRequestFacts(description, { category }).needsClarification
}

export type { MaintenanceRequestFacts }
