/** Deno copy of `src/lib/slaRules.ts` — keep in sync for Edge Functions. */

export const SLA_RULES = {
  plumbing: {
    urgent: 120,
    normal: 240,
    low: 1440,
  },
  electrical: {
    urgent: 60,
    normal: 180,
    low: 720,
  },
  appliance: {
    urgent: 240,
    normal: 720,
    low: 2880,
  },
} as const

type SlaCategory = keyof typeof SLA_RULES
type SlaSeverity = keyof (typeof SLA_RULES)['plumbing']

function normalizeCategory(raw: string | undefined): SlaCategory | 'other' {
  const cat = (raw || '').trim().toLowerCase()
  if (cat === 'plumbing') return 'plumbing'
  if (cat === 'electrical') return 'electrical'
  if (cat === 'appliance' || cat === 'appliances') return 'appliance'
  return 'other'
}

function normalizeSeverity(raw: string | undefined): SlaSeverity {
  const sev = (raw || 'normal').trim().toLowerCase()
  if (sev === 'low') return 'low'
  if (sev === 'urgent' || sev === 'emergency' || sev === 'high') return 'urgent'
  return 'normal'
}

export function getEstimatedMinutes(
  category?: string,
  severity?: string,
): number {
  const cat = normalizeCategory(category)
  const sev = normalizeSeverity(severity)
  if (cat === 'other') return 240
  return SLA_RULES[cat][sev] ?? 240
}
