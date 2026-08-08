/**
 * Shared Stripe Connect readiness — same rule as Edge `_shared/stripeConnect.ts`.
 *
 * Prefer `@/lib/paymentReadiness` (`canReceivePayments`) for the product-facing
 * "ready to get paid?" question. Use `@/lib/paymentSettlement` for whether a
 * specific rent run or invoice was paid.
 *
 * Connect readiness transitions (NOT READY → READY) are logged by callers via
 * paymentActivityMessages.ts — not by these helpers.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type StripeConnectDestination = {
  accountId: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
}

/**
 * Official readiness check: valid `acct_…` id AND charges enabled.
 */
export function isStripeConnectReady(
  destination: {
    accountId?: string | null
    chargesEnabled?: boolean | null
  } | null | undefined,
): boolean {
  if (!destination) return false
  const accountId =
    typeof destination.accountId === 'string' ? destination.accountId.trim() : ''
  return accountId.startsWith('acct_') && destination.chargesEnabled === true
}

export function stripeConnectDestinationFromRow(
  row: {
    stripe_connect_account_id?: string | null
    stripe_connect_charges_enabled?: boolean | null
    stripe_connect_payouts_enabled?: boolean | null
    stripe_connect_details_submitted?: boolean | null
  } | null | undefined,
): StripeConnectDestination | null {
  const accountId =
    typeof row?.stripe_connect_account_id === 'string'
      ? row.stripe_connect_account_id.trim()
      : ''
  if (!accountId.startsWith('acct_')) return null
  return {
    accountId,
    chargesEnabled: row?.stripe_connect_charges_enabled === true,
    payoutsEnabled: row?.stripe_connect_payouts_enabled === true,
    detailsSubmitted: row?.stripe_connect_details_submitted === true,
  }
}

export async function loadLandlordStripeDestination(
  landlordId: string = getActiveLandlordId(),
): Promise<StripeConnectDestination | null> {
  if (!supabase || !landlordId.trim()) return null
  const { data, error } = await supabase
    .from('landlords')
    .select(
      'stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted',
    )
    .eq('id', landlordId)
    .maybeSingle()
  if (error || !data) return null
  return stripeConnectDestinationFromRow(data)
}

export async function loadVendorStripeDestination(
  vendorId: string,
): Promise<StripeConnectDestination | null> {
  if (!supabase || !vendorId.trim()) return null
  const { data, error } = await supabase
    .from('vendors')
    .select(
      'stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted',
    )
    .eq('id', vendorId)
    .maybeSingle()
  if (error || !data) return null
  return stripeConnectDestinationFromRow(data)
}

export async function isLandlordStripeConnectReady(
  landlordId: string = getActiveLandlordId(),
): Promise<boolean> {
  return isStripeConnectReady(await loadLandlordStripeDestination(landlordId))
}

export async function isVendorStripeConnectReady(vendorId: string): Promise<boolean> {
  return isStripeConnectReady(await loadVendorStripeDestination(vendorId))
}
