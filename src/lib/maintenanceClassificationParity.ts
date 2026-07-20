/**
 * Client-side helpers kept aligned with the server unified classification
 * heuristics (supabase/functions/_shared/maintenance_classification).
 *
 * Full LLM/embedding pipeline runs on the edge. This module covers the
 * deterministic signals used for local UX (category chips, previews).
 */

import { issueCategoryToVendorTrade, type VendorTradeSlug } from './vendorTrades'

/** Deterministic trade inference for free-text descriptions (parity with edge rules). */
export function inferTradeFromDescription(text: string): VendorTradeSlug {
  return issueCategoryToVendorTrade(text)
}

/** Examples that must stay plumbing on both client and server. */
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
