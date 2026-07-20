/**
 * Human expert handoff for Ask Ulo legal answers.
 * Ulo finds and explains rules; judgment belongs with a qualified professional.
 */

import type { LegalSensitiveTopic, LegalSensitiveTopicId } from "./legalSensitiveTopics.ts"

export type CounselExpertRoleId =
  | "company_attorney"
  | "landlord_tenant_lawyer"
  | "compliance_specialist"
  | "regional_property_manager"

export type CounselExpertRole = {
  id: CounselExpertRoleId
  label: string
  shortLabel: string
  description: string
  whenToUse: string
}

export const COUNSEL_EXPERT_ROLES: CounselExpertRole[] = [
  {
    id: "company_attorney",
    label: "Your company's attorney",
    shortLabel: "Company counsel",
    description: "In-house or retained counsel who already knows your portfolio and policies.",
    whenToUse: "Policy decisions, notices your company will stand behind, multi-property risk.",
  },
  {
    id: "landlord_tenant_lawyer",
    label: "Outside landlord-tenant lawyer",
    shortLabel: "L-T lawyer",
    description: "Independent counsel focused on residential landlord-tenant and housing law.",
    whenToUse: "Evictions, discrimination complaints, contested notices, high-stakes filings.",
  },
  {
    id: "compliance_specialist",
    label: "Compliance specialist",
    shortLabel: "Compliance",
    description: "Fair housing, lead/environmental, screening, or program-compliance specialist.",
    whenToUse: "Lead disclosures, FHA/HUD program rules, screening criteria audits.",
  },
  {
    id: "regional_property_manager",
    label: "Experienced regional property manager",
    shortLabel: "Regional PM",
    description: "Seasoned local operator who knows how rules play out in practice in your market.",
    whenToUse: "Operational judgment, local custom, when counsel is not yet required.",
  },
]

const ROLE_BY_ID = Object.fromEntries(
  COUNSEL_EXPERT_ROLES.map((r) => [r.id, r]),
) as Record<CounselExpertRoleId, CounselExpertRole>

export function parseCounselExpertRoleId(raw: unknown): CounselExpertRoleId | null {
  if (typeof raw !== "string") return null
  const id = raw.trim() as CounselExpertRoleId
  return ROLE_BY_ID[id] ? id : null
}

export function counselExpertRole(id: CounselExpertRoleId): CounselExpertRole {
  return ROLE_BY_ID[id]
}

/** Recommend who should review, based on sensitive topics. */
export function recommendCounselExpert(
  topics: Array<Pick<LegalSensitiveTopic, "id">>,
): CounselExpertRoleId {
  const ids = new Set(topics.map((t) => t.id))
  if (
    ids.has("fair_housing") ||
    ids.has("disability_accommodation") ||
    ids.has("eviction") ||
    ids.has("domestic_violence") ||
    ids.has("retaliation") ||
    ids.has("illegal_self_help")
  ) {
    return "landlord_tenant_lawyer"
  }
  if (ids.has("lead_environmental")) return "compliance_specialist"
  if (ids.has("tenant_screening") || ids.has("application_denial")) {
    return "company_attorney"
  }
  if (topics.length > 0) return "company_attorney"
  return "regional_property_manager"
}

export function formatCounselHandoffMarkdown(input: {
  requireCounsel: boolean
  counselNote: string | null
  recommendedExpertId: CounselExpertRoleId
  /** When false, omit the whole section (default: include only if requireCounsel). */
  include?: boolean
}): string[] {
  const include = input.include ?? input.requireCounsel
  if (!include) return []

  const recommended = counselExpertRole(input.recommendedExpertId)
  const lines: string[] = [
    "## You may want a second opinion if...",
  ]
  if (input.requireCounsel && input.counselNote) {
    lines.push(`- ${input.counselNote}`)
  } else {
    lines.push("- You're planning an eviction.")
    lines.push("- A fair housing issue is involved.")
    lines.push("- A disability accommodation has been requested.")
    lines.push("- You're unsure how a local law applies.")
  }
  lines.push(
    `- **Suggested reviewer:** ${recommended.label}. ${recommended.whenToUse}`,
  )
  lines.push(
    "If that happens, Ask Ulo can help organize the information before you speak with your attorney, compliance team, or regional property manager.",
  )
  lines.push(
    `💡 **Tip:** Use thumbs down on this answer to flag it for **${recommended.shortLabel}** review.`,
  )
  return lines
}

export function topicIdsForHandoff(
  topics: Array<{ id: string }>,
): LegalSensitiveTopicId[] {
  const allowed = new Set<string>([
    "fair_housing",
    "disability_accommodation",
    "tenant_screening",
    "application_denial",
    "lead_environmental",
    "eviction",
    "domestic_violence",
    "retaliation",
    "illegal_self_help",
  ])
  const out: LegalSensitiveTopicId[] = []
  for (const t of topics) {
    if (allowed.has(t.id)) out.push(t.id as LegalSensitiveTopicId)
  }
  return out
}
