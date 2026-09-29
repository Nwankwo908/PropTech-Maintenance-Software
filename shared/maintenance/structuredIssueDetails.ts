/**
 * Parse concatenated intake description blobs into structured fields.
 *
 * Tickets often store the opening SMS plus appended "Tenant update:" fragments
 * and labeled lines (Affected area, Resident availability, …) in one
 * `maintenance_requests.description` string. Summarization must treat those as
 * distinct pieces — not one sentence to truncate.
 *
 * DATA-MODEL GAP (raise separately): inbound SMS lives in `sms_messages` as
 * distinct rows, but intake still concatenates answers into
 * `maintenance_requests.description`. That lossy merge is the same pattern that
 * caused sink-overflow parsing artifacts; extraction can only partially recover.
 */
import { generateIssueSummary } from './generateIssueSummary.ts'
import {
  parseIntakeDescriptionParts,
  sanitizeAvailabilityFromDescription,
  type IntakeDescriptionParts,
} from './intakeDescriptionParse.ts'
import { detectRecurringIssueSignal } from './recurringIssueSignal.ts'

export type { IntakeDescriptionParts }
export { parseIntakeDescriptionParts, sanitizeAvailabilityFromDescription }

const PEST_OPENING =
  /\b(?:exterminator|pest\s+control|spray(?:ing)?\s+(?:the\s+)?(?:property|unit|apartment)|roach|cockroach|mice|mouse|termite)\b/i

const TUNNEL_OR_BURROW =
  /\b(?:tunnel(?:ing|s)?|mud\s*tubes?|termite(?:s)?|burrow(?:ing|s)?|wood\s+damage|damaged\s+(?:floor|wood|beam|joist))\b/i

const LOCATION_IN_UPDATE =
  /\b(?:(?:in|near|by|under|behind|around|at)\s+(?:the\s+)?(?:foundation|back\s+porch|front\s+porch|basement|crawl\s*space|kitchen|bathroom|bedroom|attic|garage|yard|garden|wall|walls))\b/i

export type StructuredIssueDetails = {
  parts: IntakeDescriptionParts
  /** Short noun-phrase issue (title format by default). */
  issue: string
  recurring: boolean
  locationDetail: string | null
  /**
   * Distinct triage items for whoever assigns the vendor — never folded into
   * the issue noun-phrase prose.
   */
  triageFlags: string[]
  /** Real visit window only; null when missing or duplicated opening text. */
  availability: string | null
  /** Landlord/vendor-facing body built from structured fields. */
  displayDescription: string
}

function locationFromUpdates(updates: string[]): string | null {
  for (const u of updates) {
    const m = u.match(LOCATION_IN_UPDATE)
    if (m) return m[0]!.replace(/\s+/g, ' ').trim()
  }
  return null
}

function buildTriageFlags(input: {
  opening: string
  updates: string[]
  category?: string | null
}): string[] {
  const flags: string[] = []
  const updateHay = input.updates.join(' ')
  const openingHay = input.opening
  const category = (input.category ?? '').toLowerCase()
  const pestContext =
    PEST_OPENING.test(openingHay) ||
    /pest/.test(category) ||
    /\bspray\b/i.test(openingHay)

  if (pestContext && TUNNEL_OR_BURROW.test(updateHay)) {
    flags.push(
      'Possible termites / burrowing pest — tenant reported tunneling (not a routine spray-only job)',
    )
  } else if (
    !pestContext &&
    TUNNEL_OR_BURROW.test(updateHay) &&
    /pest|termite/i.test(updateHay)
  ) {
    flags.push('Possible termites / burrowing pest — tenant reported tunneling')
  }

  return flags
}

/**
 * Structured extraction for concatenated intake descriptions.
 * Issue noun-phrase uses the same generateIssueSummary path as titles/confirms.
 */
export function extractStructuredIssueDetails(
  rawDescription: string,
  options?: {
    category?: string | null
    format?: 'title' | 'summary'
  },
): StructuredIssueDetails {
  const parts = parseIntakeDescriptionParts(rawDescription)
  const category = options?.category ?? null
  const format = options?.format ?? 'title'

  const issueSource =
    parts.openingMessage ||
    parts.tenantUpdates.join(' ') ||
    rawDescription

  const issue = generateIssueSummary(issueSource, {
    format,
    category,
    maxChars: format === 'title' ? 50 : undefined,
    maxWords: format === 'summary' ? 18 : undefined,
  })

  const authoredForRecurring = [parts.openingMessage, ...parts.tenantUpdates].join(
    ' ',
  )
  const recurring = detectRecurringIssueSignal(authoredForRecurring)

  const locationDetail =
    parts.labeledFields['Affected area']?.trim() ||
    locationFromUpdates(parts.tenantUpdates)

  const triageFlags = buildTriageFlags({
    opening: parts.openingMessage,
    updates: parts.tenantUpdates,
    category,
  })

  const availability = sanitizeAvailabilityFromDescription(
    parts.labeledFields['Resident availability'],
    parts.openingMessage,
    parts.tenantUpdates,
  )

  const displayLines: string[] = []
  if (issue) displayLines.push(issue)
  if (recurring) {
    displayLines.push('Recurring / prior treatment reported.')
  }
  if (locationDetail) {
    displayLines.push(`Location: ${locationDetail}`)
  }
  for (const flag of triageFlags) {
    displayLines.push(`Flag: ${flag}`)
  }
  const safety = parts.labeledFields['Safety concerns']?.trim()
  if (safety && !/^(none|n\/a|nothing)/i.test(safety)) {
    displayLines.push(`Safety: ${safety}`)
  }
  if (availability) {
    displayLines.push(`Resident availability: ${availability}`)
  }

  return {
    parts,
    issue,
    recurring,
    locationDetail: locationDetail || null,
    triageFlags,
    availability,
    displayDescription: displayLines.join('\n') || issue || 'Maintenance issue',
  }
}
