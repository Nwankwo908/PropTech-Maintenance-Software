/**
 * Normalizes labels to appliance | plumbing | electrical when possible (substring rules).
 * Edge `vendor_assignment.ts` uses flexible `categoryMatches` for assignment.
 */
export function normIssueCategory(c: string | null | undefined): string | null {
  if (c == null) return null
  const v = String(c).trim().toLowerCase()
  if (!v) return null
  if (v.includes('appliance')) return 'appliance'
  if (v.includes('plumb')) return 'plumbing'
  if (v.includes('electric')) return 'electrical'
  return v
}

/**
 * Admin vendor picker: generalists (no category) match any issue; specialists must match normalized slugs.
 */
export function vendorMatchesTicketIssueCategory(
  vendorCategory: string | null | undefined,
  issueSlug: string | null | undefined,
): boolean {
  const issueNorm = normIssueCategory(issueSlug)
  if (!issueNorm) return true
  const vNorm = normIssueCategory(vendorCategory)
  if (vNorm == null) return true
  return vNorm === issueNorm
}

/**
 * Resolve `maintenance_requests.issue_category` slug, or infer from admin display `category`
 * (same labels as ticket table / issue classifier).
 */
export function getIssueCategorySlugForTicket(row: {
  issueCategoryRaw?: string | null
  category: string
}): string | null {
  const raw = row.issueCategoryRaw?.trim()
  if (raw) return raw.toLowerCase()

  const d = row.category.trim().toLowerCase()
  if (!d || d === 'maintenance') return null
  if (d.includes('plumb')) return 'plumbing'
  if (d.includes('electrical')) return 'electrical'
  if (d.includes('appliance')) return 'appliance'
  if (d === 'hvac' || d.includes('hvac')) return 'hvac'
  if (d.includes('noise') || d.includes('door') || d.includes('window')) return 'other'
  return null
}
