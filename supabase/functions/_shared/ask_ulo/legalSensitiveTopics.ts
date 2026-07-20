/**
 * Sensitive legal topics that require stronger caution and counsel referral.
 * Ulo explains rules; it does not replace a lawyer on high-stakes decisions.
 */

export type LegalSensitiveTopicId =
  | "fair_housing"
  | "disability_accommodation"
  | "tenant_screening"
  | "application_denial"
  | "lead_environmental"
  | "eviction"
  | "domestic_violence"
  | "retaliation"
  | "illegal_self_help"

export type LegalSensitiveTopic = {
  id: LegalSensitiveTopicId
  label: string
}

const TOPICS: Array<{
  id: LegalSensitiveTopicId
  label: string
  re: RegExp
}> = [
  {
    id: "fair_housing",
    label: "Fair housing / discrimination",
    re: /\b(fair\s*housing|discriminat(?:e|ion|ory)|protected\s*class|racial|race|religion|national\s*origin|familial\s*status|sex\s*discrimination|lgbtq|steering|disparate\s*(?:impact|treatment)|fha\b|hud\s*complaint)\b/i,
  },
  {
    id: "disability_accommodation",
    label: "Disability accommodations",
    re: /\b(reasonable\s*accommodat(?:ion|e)|reasonable\s*modificat(?:ion|e)|disability|disabilities|ada\b|service\s*animal|emotional\s+support\s*animal|esa\b|wheelchair|accessibility|assistive)\b/i,
  },
  {
    id: "tenant_screening",
    label: "Tenant screening",
    re: /\b(tenant\s*screen(?:ing)?|background\s*check|credit\s*check|criminal\s*(?:history|record|background)|eviction\s*history\s*check|screen(?:ing)?\s*(?:criteria|policy|applicant)|ban[\s-]?the[\s-]?box|screening\s*report)\b/i,
  },
  {
    id: "application_denial",
    label: "Denying rental applications",
    re: /\b(deny(?:ing|ied)?\s*(?:(?:an?|the)\s+)?(?:rental\s+)?application|reject(?:ing|ed)?\s*(?:(?:an?|the)\s+)?applicant|adverse\s*action|application\s*denial|turn(?:ing)?\s*(?:(?:an?|the)\s+)?applicant\s*down|refuse(?:d)?\s*to\s*rent)\b/i,
  },
  {
    id: "lead_environmental",
    label: "Lead paint / environmental hazards",
    re: /\b(lead\s*paint|lead[\s-]?based\s*paint|lead\s*disclosure|asbestos|radon|mold(?:\s*hazard)?|black\s*mold|environmental\s*hazard|epa\s*(?:rule|disclosure)|rrpm|renovation\s*repair\s*and\s*painting)\b/i,
  },
  {
    id: "eviction",
    label: "Evictions",
    re: /\b(evict(?:ion|ing|ed)?|unlawful\s*detainer|notice\s*to\s*(?:quit|vacate)|forcible\s*entry|writ\s*of\s*possession|holdover\s*tenant|lock\s*out)\b/i,
  },
  {
    id: "domestic_violence",
    label: "Domestic violence protections",
    re: /\b(domestic\s*violence|domestic\s*abuse|intimate\s*partner\s*violence|dv\s*protection|VAWA|violence\s*against\s*women|restraining\s*order|protection\s*order|safe\s*housing\s*act)\b/i,
  },
  {
    id: "retaliation",
    label: "Retaliation claims",
    re: /\b(retaliat(?:e|ion|ory)|revenge\s*(?:evict|rent)|punish(?:ing)?\s+(?:the\s+)?tenant\s+for\s+(?:complain|report|code)|raise\s+rent\s+because\s+(?:they|tenant)\s+complain)\b/i,
  },
  {
    id: "illegal_self_help",
    label: "Lockouts / utility shutoffs (self-help)",
    re: /\b(lock\s*out|change\s+(?:the\s+)?locks|self[\s-]?help\s+eviction|shut\s*(?:ting)?\s*off\s+(?:the\s+)?(?:water|gas|electric|power|utilities)|cut\s*off\s+(?:the\s+)?(?:water|gas|electric|utilities))\b/i,
  },
]

export function detectLegalSensitiveTopics(text: string): LegalSensitiveTopic[] {
  const corpus = text.trim()
  if (!corpus) return []
  const out: LegalSensitiveTopic[] = []
  for (const t of TOPICS) {
    if (t.re.test(corpus)) out.push({ id: t.id, label: t.label })
  }
  return out
}

export function formatSensitiveCounselNote(topics: LegalSensitiveTopic[]): string {
  if (topics.length === 0) return ""
  const labels = topics.map((t) => t.label).join("; ")
  return (
    `This involves **${labels}** — high-stakes legal and ethical ground. ` +
    `I can help you understand the cited rules and options, but I will not decide for you. ` +
    `Hand this to a qualified professional (company counsel, an outside landlord-tenant lawyer, ` +
    `a compliance specialist, or an experienced regional property manager) before you act.`
  )
}

/** Topics that imply tenant-screening PII should stay isolated from general ops context. */
export function isScreeningPrivacyTopic(id: LegalSensitiveTopicId): boolean {
  return id === "tenant_screening" || id === "application_denial"
}
