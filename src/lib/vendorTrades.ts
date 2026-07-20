/**
 * Single source of truth for vendor trades across Ulo.
 *
 * - DB / matching use normalized `slug` values
 * - UI displays `label` (and `rosterPlural` for empty-roster copy)
 * - Legacy aliases normalize on read via `normalizeVendorTrade`
 *
 * Keep in sync with: `supabase/functions/_shared/vendor_trades.ts`
 */

export const VENDOR_TRADE_DEFINITIONS = [
  {
    slug: 'appliance_repair',
    label: 'Appliance Repair',
    rosterPlural: 'appliance technicians',
  },
  {
    slug: 'carpentry',
    label: 'Carpentry',
    rosterPlural: 'carpenters',
  },
  {
    slug: 'cleaning',
    label: 'Cleaning',
    rosterPlural: 'cleaners',
  },
  {
    slug: 'electrical',
    label: 'Electrical',
    rosterPlural: 'electricians',
  },
  {
    slug: 'flooring',
    label: 'Flooring',
    rosterPlural: 'flooring contractors',
  },
  {
    slug: 'general',
    label: 'General / Handyman',
    rosterPlural: 'handymen',
  },
  {
    slug: 'hvac',
    label: 'HVAC',
    rosterPlural: 'HVAC technicians',
  },
  {
    slug: 'landscaping',
    label: 'Landscaping',
    rosterPlural: 'landscapers',
  },
  {
    slug: 'locksmith',
    label: 'Locksmith',
    rosterPlural: 'locksmiths',
  },
  {
    slug: 'painting',
    label: 'Painting',
    rosterPlural: 'painters',
  },
  {
    slug: 'pest_control',
    label: 'Pest Control',
    rosterPlural: 'pest control vendors',
  },
  {
    slug: 'plumbing',
    label: 'Plumbing',
    rosterPlural: 'plumbers',
  },
  {
    slug: 'roofing',
    label: 'Roofing',
    rosterPlural: 'roofers',
  },
  {
    slug: 'windows',
    label: 'Windows',
    rosterPlural: 'window technicians',
  },
  {
    slug: 'other',
    label: 'Other',
    rosterPlural: null,
  },
] as const

export type VendorTradeSlug = (typeof VENDOR_TRADE_DEFINITIONS)[number]['slug']

export const VENDOR_TRADE_SLUGS: readonly VendorTradeSlug[] =
  VENDOR_TRADE_DEFINITIONS.map((trade) => trade.slug)

const TRADE_BY_SLUG = new Map<string, (typeof VENDOR_TRADE_DEFINITIONS)[number]>(
  VENDOR_TRADE_DEFINITIONS.map((trade) => [trade.slug, trade]),
)

const VENDOR_TRADE_SLUG_SET = new Set<string>(VENDOR_TRADE_SLUGS)

/** Ordered dropdown / filter options (canonical UI list). */
export const VENDOR_TRADE_OPTIONS: { value: VendorTradeSlug; label: string }[] =
  VENDOR_TRADE_DEFINITIONS.map((trade) => ({
    value: trade.slug,
    label: trade.label,
  }))

/** Filter options including an empty “all trades” sentinel for selects that need it. */
export function vendorTradeFilterOptions(opts?: {
  includeAll?: boolean
  allLabel?: string
}): { value: string; label: string }[] {
  const rows: { value: string; label: string }[] = []
  if (opts?.includeAll) {
    rows.push({ value: '', label: opts.allLabel ?? 'All trades' })
  }
  for (const trade of VENDOR_TRADE_DEFINITIONS) {
    rows.push({ value: trade.slug, label: trade.label })
  }
  return rows
}

/**
 * Legacy / free-text → canonical trade slug.
 * Unmapped values become `other` (never null) when `fallbackOther` is true (default).
 * Empty input returns null so callers can treat “unset” separately from Other.
 */
export function normalizeVendorTrade(
  raw: string | null | undefined,
  opts?: { fallbackOther?: boolean },
): VendorTradeSlug | null {
  const fallbackOther = opts?.fallbackOther !== false
  if (raw == null) return fallbackOther ? 'other' : null
  const v = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!v || v === 'maintenance' || v === 'n/a' || v === 'na' || v === 'misc') {
    return fallbackOther ? 'other' : null
  }

  if (VENDOR_TRADE_SLUG_SET.has(v)) return v as VendorTradeSlug

  // Exact legacy aliases
  const exact: Record<string, VendorTradeSlug> = {
    appliance: 'appliance_repair',
    appliances: 'appliance_repair',
    appliance_repair: 'appliance_repair',
    handyman: 'general',
    generalist: 'general',
    general_maintenance: 'general',
    household: 'general',
    pest: 'pest_control',
    exterior: 'landscaping',
    outside: 'landscaping',
    outside_exterior_house: 'landscaping',
    lawn: 'landscaping',
    water: 'plumbing',
    water_damage: 'plumbing',
    leak: 'plumbing',
    lock: 'locksmith',
    locks: 'locksmith',
    door: 'windows',
    doors: 'windows',
    window: 'windows',
    door_window: 'windows',
    paint: 'painting',
    roof: 'roofing',
    floor: 'flooring',
    floors: 'flooring',
    carpenter: 'carpentry',
    clean: 'cleaning',
    hvac: 'hvac',
    heating: 'hvac',
    cooling: 'hvac',
    air_conditioning: 'hvac',
    ac: 'hvac',
  }
  if (exact[v]) return exact[v]

  // Substring heuristics — keep in sync with
  // supabase/functions/_shared/vendor_trades.ts + maintenance_classification/deterministicRules.ts
  if (v.includes('appliance')) return 'appliance_repair'
  if (
    v.includes('plumb') ||
    v.includes('sewage') ||
    v.includes('drain') ||
    v.includes('leak') ||
    v.includes('drip') ||
    v.includes('faucet') ||
    v.includes('sink') ||
    v.includes('basin') ||
    v.includes('toilet') ||
    v.includes('pipe') ||
    v.includes('clog') ||
    v.includes('flood') ||
    v.includes('overflow')
  ) {
    return 'plumbing'
  }
  if (v.includes('electric') || v.includes('outlet') || v.includes('spark')) {
    return 'electrical'
  }
  if (
    v.includes('hvac') ||
    v.includes('heat') ||
    (v.includes('air') && v.includes('condition')) ||
    v.includes('furnace') ||
    v.includes('thermostat')
  ) {
    return 'hvac'
  }
  if (v.includes('pest') || v.includes('roach') || v.includes('rodent')) return 'pest_control'
  if (v.includes('clean') || v.includes('janitor')) return 'cleaning'
  if (v.includes('landscap') || v.includes('lawn') || v.includes('grounds')) {
    return 'landscaping'
  }
  if (v.includes('lock')) return 'locksmith'
  if (v.includes('paint')) return 'painting'
  if (v.includes('roof') || v.includes('ceiling')) return 'roofing'
  if (v.includes('window') || v.includes('door')) return 'windows'
  if (v.includes('carpent') || v.includes('cabin')) return 'carpentry'
  if (v.includes('floor') || v.includes('carpet') || v.includes('tile')) return 'flooring'
  if (
    v.includes('handyman') ||
    v.includes('generalist') ||
    v === 'general' ||
    v.includes('household')
  ) {
    return 'general'
  }

  // Phrase-level fallback for multi-word free text (e.g. "leaky faucet in kitchen")
  const phrase = String(raw).toLowerCase()
  if (
    /\b(leak|leaking|leaky|drip|dripping|faucet|tap|sink|basin|toilet|pipe|drain|clog|flood|overflow|sewage|sewer)\b/
      .test(phrase)
  ) {
    return 'plumbing'
  }
  if (/\b(outlet|spark|sparks|sparking|breaker|wiring|electrical)\b/.test(phrase)) {
    return 'electrical'
  }
  if (/\b(hvac|no heat|furnace|thermostat|air condition|\bac\b|blowing warm)\b/.test(phrase)) {
    return 'hvac'
  }
  if (/\b(fridge|refrigerator|washer|dryer|oven|dishwasher|appliance)\b/.test(phrase)) {
    return 'appliance_repair'
  }
  if (/\b(locked out|locksmith|deadbolt|can't get in|cannot get in)\b/.test(phrase)) {
    return 'locksmith'
  }
  if (/\b(pest|roach|mouse|rat|termite|infestation)\b/.test(phrase)) {
    return 'pest_control'
  }
  if (/\b(roof|ceiling leak|pouring through the ceiling)\b/.test(phrase)) {
    return 'roofing'
  }

  return fallbackOther ? 'other' : null
}

/** Map ticket issue_category (or free text) to a vendor trade. Defaults to `other`. */
export function issueCategoryToVendorTrade(
  issueCategory: string | null | undefined,
): VendorTradeSlug {
  return normalizeVendorTrade(issueCategory, { fallbackOther: true }) ?? 'other'
}

/**
 * Back-compat alias used across the app.
 * Prefer `normalizeVendorTrade` / `issueCategoryToVendorTrade` for new code.
 * Returns null for empty input (legacy behavior).
 */
export function normIssueCategory(c: string | null | undefined): string | null {
  if (c == null || !String(c).trim()) return null
  return normalizeVendorTrade(c, { fallbackOther: true })
}

export function isVendorTradeSlug(value: string | null | undefined): value is VendorTradeSlug {
  if (!value) return false
  return VENDOR_TRADE_SLUG_SET.has(value)
}

export function formatVendorTradeLabel(
  raw: string | null | undefined,
  opts?: { emptyLabel?: string },
): string {
  const emptyLabel = opts?.emptyLabel ?? 'General / Handyman'
  if (raw == null || !String(raw).trim()) return emptyLabel
  const slug = normalizeVendorTrade(raw, { fallbackOther: true })
  if (!slug) return emptyLabel
  return TRADE_BY_SLUG.get(slug)?.label ?? emptyLabel
}

/** Plural specialty for empty-roster copy; null when too generic (Other). */
export function rosterVendorTypePluralFromTrade(
  issueCategory: string | null | undefined,
): string | null {
  const slug = normalizeVendorTrade(issueCategory, { fallbackOther: true })
  if (!slug || slug === 'other' || slug === 'general') return null
  return TRADE_BY_SLUG.get(slug)?.rosterPlural ?? null
}

export function isGeneralistTrade(raw: string | null | undefined): boolean {
  if (raw == null || !String(raw).trim()) return true
  const slug = normalizeVendorTrade(raw, { fallbackOther: false })
  return slug == null || slug === 'general'
}

/**
 * Admin vendor picker / reassignment:
 * - generalists (null / empty / `general`) match any issue
 * - specialists must match the normalized trade slug
 */
export function vendorMatchesTicketIssueCategory(
  vendorCategory: string | null | undefined,
  issueSlug: string | null | undefined,
): boolean {
  if (isGeneralistTrade(vendorCategory)) return true
  const issueTrade = normalizeVendorTrade(issueSlug, { fallbackOther: true })
  if (!issueTrade || issueTrade === 'other' || issueTrade === 'general') return true
  const vendorTrade = normalizeVendorTrade(vendorCategory, { fallbackOther: false })
  if (!vendorTrade) return true
  return vendorTrade === issueTrade
}

/**
 * Edge-style flexible match for auto-assignment tiers.
 * Empty vendor category does not match as specialist (generalists handled separately).
 */
export function vendorTradeMatchesFlexible(
  vendorCategory: string | null | undefined,
  issueCategory: string | null | undefined,
): boolean {
  const issueTrade = normalizeVendorTrade(issueCategory, { fallbackOther: true })
  if (!issueTrade || issueTrade === 'other' || issueTrade === 'general') return true
  if (vendorCategory == null || !String(vendorCategory).trim()) return false
  if (isGeneralistTrade(vendorCategory)) return false
  const vendorTrade = normalizeVendorTrade(vendorCategory, { fallbackOther: false })
  if (!vendorTrade) return false
  return vendorTrade === issueTrade
}

/** Persistable DB value for vendor forms / onboarding. */
export function vendorTradeToDbCategory(
  trade: string | null | undefined,
): VendorTradeSlug | null {
  if (trade == null || !String(trade).trim()) return null
  return normalizeVendorTrade(trade, { fallbackOther: true })
}

/** Form select value from a stored vendors.category. */
export function dbCategoryToVendorTrade(
  category: string | null | undefined,
): VendorTradeSlug | '' {
  if (category == null || !String(category).trim()) return 'general'
  return normalizeVendorTrade(category, { fallbackOther: true }) ?? 'other'
}

/**
 * Resolve `maintenance_requests.issue_category` slug, or infer from admin display `category`.
 */
export function getIssueCategorySlugForTicket(row: {
  issueCategoryRaw?: string | null
  category: string
}): string | null {
  const raw = row.issueCategoryRaw?.trim()
  if (raw) return issueCategoryToVendorTrade(raw)

  const d = row.category.trim()
  if (!d || d.toLowerCase() === 'maintenance') return null
  return issueCategoryToVendorTrade(d)
}

/** External vendor search trade terms from an issue category. */
export function tradeTermsFromVendorTrade(
  issueCategory: string | null | undefined,
): string {
  const slug = issueCategoryToVendorTrade(issueCategory)
  switch (slug) {
    case 'plumbing':
      return 'plumbing contractor'
    case 'hvac':
      return 'HVAC air conditioning heating'
    case 'electrical':
      return 'electrical contractor'
    case 'appliance_repair':
      return 'appliance repair'
    case 'pest_control':
      return 'pest control'
    case 'cleaning':
      return 'cleaning service'
    case 'landscaping':
      return 'landscaping lawn care'
    case 'locksmith':
      return 'locksmith'
    case 'painting':
      return 'painting contractor'
    case 'roofing':
      return 'roofing contractor'
    case 'windows':
      return 'window door repair'
    case 'carpentry':
      return 'carpentry handyman'
    case 'flooring':
      return 'flooring contractor'
    case 'general':
      return 'handyman general maintenance'
    case 'other':
    default:
      return 'home maintenance repair'
  }
}

export function buildExternalSearchQueryFromTrade(
  issueCategory: string | null,
  searchLocation: string,
): { tradeTerms: string; textQuery: string; searchLocation: string } {
  const loc = searchLocation.trim() || 'United States'
  const tradeTerms = tradeTermsFromVendorTrade(issueCategory)
  return {
    tradeTerms,
    textQuery: `${tradeTerms} near ${loc}`,
    searchLocation: loc,
  }
}

/** Trade buckets used by mock/external providers. */
export type ExternalVendorTradeBucket =
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'appliance'
  | 'pest_control'
  | 'cleaning'
  | 'roofing'
  | 'default'

export function tradeBucketFromVendorTrade(
  issueCategory: string | null | undefined,
): ExternalVendorTradeBucket {
  const slug = issueCategoryToVendorTrade(issueCategory)
  if (slug === 'plumbing') return 'plumbing'
  if (slug === 'electrical') return 'electrical'
  if (slug === 'hvac') return 'hvac'
  if (slug === 'appliance_repair') return 'appliance'
  if (slug === 'pest_control') return 'pest_control'
  if (slug === 'cleaning') return 'cleaning'
  if (slug === 'roofing') return 'roofing'
  return 'default'
}
