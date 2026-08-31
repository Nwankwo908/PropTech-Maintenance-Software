/**
 * Client-side helpers aligned with shared maintenance classification rules.
 * Full LLM/embedding pipeline runs on the edge.
 */
import { inferTradeFromText } from '@shared/maintenance/deterministicRules.ts'
import { resolveAmbiguousMaintenance } from '@shared/maintenance/ambiguityResolution.ts'
import {
  issueCategoryToVendorTrade,
  type VendorTradeSlug,
} from '@/lib/vendorTrades'

/** Deterministic trade inference for free-text descriptions (shared rules). */
export function inferTradeFromDescription(text: string): VendorTradeSlug {
  const inferred = inferTradeFromText(text)
  if (inferred) return inferred
  const resolved = resolveAmbiguousMaintenance(text)
  if (resolved.handled && resolved.needsClarification) return 'other'
  return issueCategoryToVendorTrade(text)
}

/** Examples that must classify the same on client and edge. */
export const CLASSIFICATION_PARITY_EXAMPLES: Array<{
  text: string
  trade: VendorTradeSlug
}> = [
  { text: 'Leaky faucet', trade: 'plumbing' },
  { text: 'Tap keeps dripping', trade: 'plumbing' },
  { text: 'Water under kitchen sink', trade: 'plumbing' },
  { text: 'Toilet overflowing', trade: 'plumbing' },
  { text: 'Outlet sparks', trade: 'electrical' },
  { text: 'Fridge not cold', trade: 'appliance_repair' },
  { text: 'AC blowing warm air', trade: 'hvac' },
  { text: 'Locked out', trade: 'locksmith' },
]
