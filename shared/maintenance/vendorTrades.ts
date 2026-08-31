/**
 * Vendor trade helpers — shared client + edge.
 * Taxonomy: vendorTradeDefinitions.ts · phrase rules: deterministicRules.ts
 */
import { resolveAmbiguousMaintenance } from './ambiguityResolution.ts'
import { inferTradeFromText } from './deterministicRules.ts'
import {
  VENDOR_TRADE_DEFINITIONS,
  VENDOR_TRADE_SLUGS,
  type VendorTradeSlug,
} from './vendorTradeDefinitions.ts'

export {
  VENDOR_TRADE_DEFINITIONS,
  VENDOR_TRADE_SLUGS,
  type VendorTrade,
  type VendorTradeSlug,
} from './vendorTradeDefinitions.ts'

const TRADE_BY_SLUG = new Map<string, (typeof VENDOR_TRADE_DEFINITIONS)[number]>(
  VENDOR_TRADE_DEFINITIONS.map((trade) => [trade.slug, trade]),
)

const VENDOR_TRADE_SLUG_SET = new Set<string>(VENDOR_TRADE_SLUGS)

export const VENDOR_TRADE_OPTIONS: { value: VendorTradeSlug; label: string }[] =
  VENDOR_TRADE_DEFINITIONS.map((trade) => ({
    value: trade.slug,
    label: trade.label,
  }))

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

  const rawText = String(raw).trim()
  const looksLikeFreeText = /[\s,]/.test(rawText) || rawText.length > 32
  if (looksLikeFreeText) {
    const inferred = inferTradeFromText(rawText)
    if (inferred) return inferred
    const resolved = resolveAmbiguousMaintenance(rawText)
    if (resolved.handled && resolved.needsClarification) {
      return fallbackOther ? 'other' : null
    }
    return fallbackOther ? 'other' : null
  }

  const exact: Record<string, VendorTradeSlug> = {
    appliance: 'appliance_repair',
    appliances: 'appliance_repair',
    appliance_repair: 'appliance_repair',
    handyman: 'general',
    generalist: 'general',
    general_maintenance: 'general',
    household: 'general',
    structural: 'general',
    structure: 'general',
    general_contractor: 'general',
    foundation: 'masonry',
    boiler: 'plumbing',
    radiator: 'plumbing',
    hydronic: 'plumbing',
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
    deck: 'deck_builder',
    decking: 'deck_builder',
    deck_builder: 'deck_builder',
    mason: 'masonry',
    masonry: 'masonry',
    brick: 'masonry',
    stone: 'masonry',
    concrete: 'concrete',
    concrete_contractor: 'concrete',
    cement: 'concrete',
  }
  if (exact[v]) return exact[v]

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
  if (v.includes('carpent') || v.includes('cabinet')) return 'carpentry'
  if (v.includes('deck')) return 'deck_builder'
  if (v.includes('mason') || v.includes('brick') || v.includes('mortar')) {
    return 'masonry'
  }
  if (v.includes('concrete') || v.includes('cement')) return 'concrete'
  if (v.includes('floor') || v.includes('carpet') || v.includes('tile')) return 'flooring'
  if (
    v.includes('handyman') ||
    v.includes('generalist') ||
    v === 'general' ||
    v.includes('household')
  ) {
    return 'general'
  }

  const inferred = inferTradeFromText(String(raw))
  if (inferred) return inferred

  return fallbackOther ? 'other' : null
}

export function issueCategoryToVendorTrade(
  issueCategory: string | null | undefined,
): VendorTradeSlug {
  return normalizeVendorTrade(issueCategory, { fallbackOther: true }) ?? 'other'
}

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

/**
 * Auto-dispatch match: same specific trade only.
 * Unknown / general tickets, or a plumber vs an oven, must not assign — Find External Vendor.
 */
export function vendorTradeMatchesForDispatch(
  vendorCategory: string | null | undefined,
  issueCategory: string | null | undefined,
): boolean {
  const issueTrade = normalizeVendorTrade(issueCategory, { fallbackOther: false })
  if (!issueTrade || issueTrade === 'other' || issueTrade === 'general') return false
  return vendorTradeMatchesFlexible(vendorCategory, issueCategory)
}

export function vendorTradeToDbCategory(
  trade: string | null | undefined,
): VendorTradeSlug | null {
  if (trade == null || !String(trade).trim()) return null
  return normalizeVendorTrade(trade, { fallbackOther: true })
}

export function dbCategoryToVendorTrade(
  category: string | null | undefined,
): VendorTradeSlug | '' {
  if (category == null || !String(category).trim()) return 'general'
  return normalizeVendorTrade(category, { fallbackOther: true }) ?? 'other'
}

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

export function tradeTermsFromVendorTrade(
  issueCategory: string | null | undefined,
): string {
  const slug = matchingTradeForVendorSearch(issueCategory)
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
    case 'deck_builder':
      return 'deck builder deck repair'
    case 'masonry':
      return 'mason masonry brick stone'
    case 'concrete':
      return 'concrete contractor'
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

export type ExternalVendorTradeBucket =
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'appliance'
  | 'pest_control'
  | 'cleaning'
  | 'roofing'
  | 'default'

export function matchingTradeForVendorSearch(
  issueCategory: string | null | undefined,
): VendorTradeSlug {
  const raw = String(issueCategory ?? '').trim().toLowerCase()
  if (raw === 'structural' || raw === 'structure') return 'general'
  return issueCategoryToVendorTrade(issueCategory)
}

export function tradeBucketFromVendorTrade(
  issueCategory: string | null | undefined,
): ExternalVendorTradeBucket {
  const slug = matchingTradeForVendorSearch(issueCategory)
  if (slug === 'plumbing') return 'plumbing'
  if (slug === 'electrical') return 'electrical'
  if (slug === 'hvac') return 'hvac'
  if (slug === 'appliance_repair') return 'appliance'
  if (slug === 'pest_control') return 'pest_control'
  if (slug === 'cleaning') return 'cleaning'
  if (slug === 'roofing') return 'roofing'
  return 'default'
}

/** Filter options built from the canonical trade list (subset for UI filters). */
export function vendorTradeFilterSubset(
  slugs: readonly VendorTradeSlug[],
  opts?: { includeAll?: boolean; allLabel?: string },
): { value: string; label: string }[] {
  const rows: { value: string; label: string }[] = []
  if (opts?.includeAll) {
    rows.push({ value: 'all', label: opts.allLabel ?? 'All categories' })
  }
  for (const slug of slugs) {
    const label = TRADE_BY_SLUG.get(slug)?.label
    if (label) rows.push({ value: slug, label })
  }
  return rows
}
