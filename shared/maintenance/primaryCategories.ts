/**
 * User-facing maintenance buckets (7). Vendor matching uses a specific trade underneath.
 */
import type { VendorTrade } from './vendorTradeDefinitions.ts'

export const PRIMARY_CATEGORIES = [
  'plumbing',
  'hvac',
  'electrical',
  'appliance',
  'structural',
  'pest',
  'general',
] as const

export type PrimaryCategory = (typeof PRIMARY_CATEGORIES)[number]

/** Default bucket for a resolved trade. Ambiguity resolution may override (e.g. radiator heat → HVAC + plumbing). */
export function primaryCategoryFromTrade(trade: VendorTrade | null | undefined): PrimaryCategory {
  switch (trade) {
    case 'plumbing':
      return 'plumbing'
    case 'hvac':
      return 'hvac'
    case 'electrical':
      return 'electrical'
    case 'appliance_repair':
      return 'appliance'
    case 'pest_control':
      return 'pest'
    case 'roofing':
    case 'carpentry':
    case 'masonry':
    case 'concrete':
    case 'flooring':
    case 'windows':
    case 'locksmith':
    case 'deck_builder':
      return 'structural'
    default:
      return 'general'
  }
}
