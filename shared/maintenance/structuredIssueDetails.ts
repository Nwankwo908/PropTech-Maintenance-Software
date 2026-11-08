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
import { summarizeMaintenanceRequestDeterministic } from './maintenanceRequestFacts.ts'
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

export type StructuredIssueDetails = {
  parts: IntakeDescriptionParts
  /** Short noun-phrase issue (title format by default). */
  issue: string
  recurring: boolean
  /** Physical location only (not floor served). */
  locationDetail: string | null
  /** Equipment / fixture when known. */
  equipment: string | null
  /** Floor/area served when distinct from physical location. */
  servesFloor: string | null
  /**
   * Distinct triage items for whoever assigns the vendor — never folded into
   * the issue noun-phrase prose.
   */
  triageFlags: string[]
  /** Real visit window only; null when missing or duplicated opening text. */
  availability: string | null
  /**
   * Resident-facing polished description (tenant-reports attribution).
   */
  reportedDetail: string | null
  /** Clarification Ulo should ask when facts conflict or location is missing. */
  needsClarification: string | null
  /** Landlord/vendor-facing body built from structured fields. */
  displayDescription: string
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
 * Prefer shared maintenanceRequestFacts for title / location / description.
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

  const summary = summarizeMaintenanceRequestDeterministic(rawDescription, {
    category,
  })

  // Prefer explicitly labeled equipment / serves-floor when present.
  const labeledEquipment = parts.labeledFields['Equipment']?.trim() || null
  const labeledServes = parts.labeledFields['Serves floor']?.trim() || null
  const labeledArea = parts.labeledFields['Affected area']?.trim() || null
  const physicalFromLabel = labeledArea
    ? labeledArea.split(/\s*[—\-–]\s*/)[0]!.trim()
    : null

  const issue = summary.title
  const locationDetail =
    summary.location ||
    physicalFromLabel ||
    summary.facts.physicalLocation ||
    null
  const equipment = labeledEquipment || summary.facts.equipment
  const servesFloor = labeledServes || summary.facts.servesFloor

  const authoredForRecurring = [parts.openingMessage, ...parts.tenantUpdates].join(
    ' ',
  )
  const recurring = detectRecurringIssueSignal(authoredForRecurring)

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

  const reportedDetail = summary.description

  const displayLines: string[] = []
  if (issue) displayLines.push(issue)
  if (recurring) {
    displayLines.push('Recurring / prior treatment reported.')
  }
  if (locationDetail) {
    displayLines.push(`Location: ${locationDetail}`)
  }
  if (equipment && !issue.toLowerCase().includes(equipment.toLowerCase().split(/\s+/)[0]!)) {
    displayLines.push(`Equipment: ${equipment}`)
  }
  if (servesFloor) {
    displayLines.push(`Serves: ${servesFloor}`)
  }
  if (reportedDetail) {
    displayLines.push(reportedDetail)
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
  if (summary.facts.needsClarification) {
    displayLines.push(`Clarify: ${summary.facts.needsClarification}`)
  }

  // format option kept for call-site compatibility (title vs summary noun-phrase).
  void options?.format

  return {
    parts,
    issue,
    recurring,
    locationDetail: locationDetail || null,
    equipment,
    servesFloor,
    triageFlags,
    availability,
    reportedDetail,
    needsClarification: summary.facts.needsClarification,
    displayDescription: displayLines.join('\n') || issue || 'Maintenance issue',
  }
}
