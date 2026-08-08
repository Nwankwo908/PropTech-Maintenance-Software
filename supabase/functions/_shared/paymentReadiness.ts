/**
 * Helper 1 — Can this landlord or vendor receive online payments?
 *
 * Ready = valid Stripe Connect account + charges enabled.
 * This is payout capability, not payment history.
 *
 * Architecture: this module only answers readiness questions. It must never
 * call recordActivityLog, logGraphEvent, or send notifications. When readiness
 * transitions NOT READY → READY, callers use paymentActivityEvents.ts.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  isLandlordStripeConnectReady,
  isStripeConnectReady,
  isVendorStripeConnectReady,
  loadLandlordStripeDestination,
  loadVendorStripeDestination,
  type StripeConnectDestination,
} from "./stripeConnect.ts"

export type PaymentRecipient =
  | { party: "landlord"; landlordId: string }
  | { party: "vendor"; vendorId: string }

export type CanReceivePaymentsResult = {
  ready: boolean
  destination: StripeConnectDestination | null
}

/** Whether a landlord or vendor Connect account can accept destination charges. */
export async function canReceivePayments(
  supabase: SupabaseClient,
  recipient: PaymentRecipient,
): Promise<CanReceivePaymentsResult> {
  if (recipient.party === "landlord") {
    const destination = await loadLandlordStripeDestination(
      supabase,
      recipient.landlordId,
    )
    return {
      ready: isStripeConnectReady(destination),
      destination,
    }
  }

  const destination = await loadVendorStripeDestination(
    supabase,
    recipient.vendorId,
  )
  return {
    ready: isStripeConnectReady(destination),
    destination,
  }
}

/** Convenience boolean — same rule as `canReceivePayments(...).ready`. */
export async function canLandlordReceivePayments(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<boolean> {
  return isLandlordStripeConnectReady(supabase, landlordId)
}

export async function canVendorReceivePayments(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<boolean> {
  return isVendorStripeConnectReady(supabase, vendorId)
}
