/**
 * HQS fail-category → Ulo vendor trade (pure defaults + DB row overlay).
 */
import { normalizeVendorTrade, type VendorTradeSlug } from './vendorTrades.ts'

/** In-code defaults mirroring hqs_fail_category_trade_map seed. */
export const HQS_FAIL_CATEGORY_TRADE_DEFAULTS: Record<string, VendorTradeSlug> = {
  'gas range/oven': 'appliance_repair',
  'range/oven': 'appliance_repair',
  refrigerator: 'appliance_repair',
  'smoke detector': 'electrical',
  'smoke detectors': 'electrical',
  'carbon monoxide detector': 'electrical',
  'electrical system': 'electrical',
  'electrical outlets': 'electrical',
  'outlets/switches': 'electrical',
  lighting: 'electrical',
  plumbing: 'plumbing',
  'water heater': 'plumbing',
  toilet: 'plumbing',
  sink: 'plumbing',
  'bathtub/shower': 'plumbing',
  'hot water': 'plumbing',
  heating: 'hvac',
  hvac: 'hvac',
  'air conditioning': 'hvac',
  windows: 'windows',
  doors: 'carpentry',
  'exterior doors': 'carpentry',
  walls: 'carpentry',
  ceilings: 'carpentry',
  floors: 'flooring',
  'floor covering': 'flooring',
  roof: 'roofing',
  gutters: 'roofing',
  stairs: 'carpentry',
  handrails: 'carpentry',
  porch: 'deck_builder',
  deck: 'deck_builder',
  'site/grounds': 'landscaping',
  infestation: 'pest_control',
  'pest infestation': 'pest_control',
  locks: 'locksmith',
  security: 'locksmith',
  paint: 'painting',
  'lead paint': 'painting',
  other: 'general',
}

export function mapHqsFailCategoryToVendorTrade(
  failItemCategory: string,
  overlay?: Record<string, string> | null,
): VendorTradeSlug {
  const key = failItemCategory.trim().toLowerCase()
  if (overlay) {
    for (const [k, v] of Object.entries(overlay)) {
      if (k.trim().toLowerCase() === key) {
        return normalizeVendorTrade(v) ?? 'general'
      }
    }
  }
  if (HQS_FAIL_CATEGORY_TRADE_DEFAULTS[key]) return HQS_FAIL_CATEGORY_TRADE_DEFAULTS[key]!
  // Fuzzy contains
  for (const [k, trade] of Object.entries(HQS_FAIL_CATEGORY_TRADE_DEFAULTS)) {
    if (key.includes(k) || k.includes(key)) return trade
  }
  return normalizeVendorTrade(failItemCategory) ?? 'general'
}
