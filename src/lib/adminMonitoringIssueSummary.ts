/**
 * Admin Messages rail — short issue noun-phrases for "Ulo summary for admin".
 * Issue wording via shared generateIssueSummary (same as titles / SMS confirms).
 */
import { generateIssueSummary } from '@shared/maintenance/generateIssueSummary.ts'
import {
  extractAdminIssueNounPhrase,
  stripTenantMessageFiller,
  type AdminIssueExtraction,
} from '@shared/maintenance/issueNounPhrase.ts'

export {
  extractAdminIssueNounPhrase,
  stripTenantMessageFiller,
  type AdminIssueExtraction,
} from '@shared/maintenance/issueNounPhrase.ts'

const MAX_SUMMARY_WORDS = 20

function enforceMaxWords(text: string, maxWords = MAX_SUMMARY_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return text.trim()
  return `${words.slice(0, maxWords).join(' ')}…`
}

function formatUnitLabel(unitLabel: string): string {
  const u = unitLabel.trim()
  if (!u) return ''
  return /^unit\b/i.test(u) ? u : `Unit ${u}`
}

function formatLocationParen(unitLabel: string, building: string): string {
  const unit = formatUnitLabel(unitLabel)
  const place = building.trim().replace(/\s+Apartments$/i, '').trim() || building.trim()
  const parts = [unit, place].filter(Boolean)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

function isUrgentFlag(urgency: string | null | undefined): boolean {
  const u = (urgency ?? '').trim().toLowerCase()
  return (
    u === 'urgent' ||
    u === 'high' ||
    u === 'critical' ||
    u === 'emergency' ||
    u === 'habitability'
  )
}

export type AdminMaintenanceReportSummaryInput = {
  residentName: string
  unitLabel?: string
  building?: string
  ticketDescription?: string
  ticketCategory?: string
  ticketUrgency?: string
  /** Inbound (preferred) or any resident-report message bodies, newest last. */
  messageBodies?: string[]
}

/**
 * One-line admin summary: "{name} ({unit}, {address}) reported {issue}."
 * Adds " — urgent" when the ticket is flagged urgent/habitability.
 */
export function buildAdminMaintenanceReportSummary(
  input: AdminMaintenanceReportSummaryInput,
): string | null {
  const name = input.residentName.trim() || 'The resident'
  const bodies = (input.messageBodies ?? [])
    .map((b) => b.trim())
    .filter(Boolean)
  const sourceText =
    (input.ticketDescription ?? '').trim() ||
    [...bodies].reverse().find((b) => {
      if (/^(yes|no|ok|okay|thanks?|thank you|start)[.!]?$/i.test(b)) return false
      return b.length >= 8
    }) ||
    bodies[bodies.length - 1] ||
    ''

  if (!sourceText && !(input.ticketCategory ?? '').trim()) return null

  const issue = generateIssueSummary(sourceText, {
    format: 'summary',
    category: input.ticketCategory,
    maxWords: 18,
  })

  const location = formatLocationParen(input.unitLabel ?? '', input.building ?? '')
  const urgent = isUrgentFlag(input.ticketUrgency)
  const line = urgent
    ? `${name}${location} reported ${issue} — urgent.`
    : `${name}${location} reported ${issue}.`

  return enforceMaxWords(line)
}
