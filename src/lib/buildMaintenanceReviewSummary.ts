import type { IssueParsed } from '../api/issueAnalysis'

function responseTimeLabel(urgency: string): string {
  if (urgency === 'urgent') return 'As soon as possible (priority response)'
  if (urgency === 'low') return 'Within several business days'
  return 'Within 48 hours'
}

/**
 * Rich text-style string for the review screen; uses **bold** markers for emphasis.
 */
export function buildMaintenanceReviewSummary(
  parsed: IssueParsed | null,
  description: string,
  unit: string,
  urgency: string,
): string {
  const unitTrim = unit.trim()
  const descTrim = description.trim()

  const headline =
    parsed?.issueType?.trim() || 'Maintenance request'

  let narrative =
    parsed?.normalizedSummary?.trim() ||
    descTrim ||
    'No additional details were provided.'

  if (unitTrim && !narrative.toLowerCase().includes(unitTrim.toLowerCase())) {
    narrative = `${narrative} Resident unit: ${unitTrim}.`
  }

  const action =
    parsed?.appliance && parsed?.room
      ? `Have a qualified technician inspect the ${parsed.appliance} in the ${parsed.room}.`
      : parsed?.room
        ? `Have maintenance assess the issue in the ${parsed.room}.`
        : 'Schedule a maintenance technician to assess the issue and follow up with the resident.'

  return `**${headline}** ${narrative} **Estimated Response Time:** ${responseTimeLabel(urgency)} **Recommended Action:** ${action}`
}
