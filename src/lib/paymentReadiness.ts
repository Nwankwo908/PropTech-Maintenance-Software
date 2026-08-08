/**
 * Helper 1 — Can this landlord or vendor receive online payments?
 *
 * Delegates to the shared Stripe Connect readiness rule (client runtime).
 *
 * Architecture: readiness checks only — never write activity feed entries or
 * send notifications from this module. Callers record business outcomes via
 * recordActivityLog after a real state change (see paymentActivityMessages.ts).
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  isLandlordStripeConnectReady,
  isStripeConnectReady,
  isVendorStripeConnectReady,
  loadLandlordStripeDestination,
  loadVendorStripeDestination,
  type StripeConnectDestination,
} from '@/lib/stripeConnectReady'

export type PaymentRecipient =
  | { party: 'landlord'; landlordId: string }
  | { party: 'vendor'; vendorId: string }

export type CanReceivePaymentsResult = {
  ready: boolean
  destination: StripeConnectDestination | null
}

export async function canReceivePayments(
  recipient: PaymentRecipient,
): Promise<CanReceivePaymentsResult> {
  if (recipient.party === 'landlord') {
    const landlordId = recipient.landlordId.trim() || getActiveLandlordId()
    const destination = await loadLandlordStripeDestination(landlordId)
    return {
      ready: isStripeConnectReady(destination),
      destination,
    }
  }

  const destination = await loadVendorStripeDestination(recipient.vendorId)
  return {
    ready: isStripeConnectReady(destination),
    destination,
  }
}

export async function canLandlordReceivePayments(
  landlordId: string = getActiveLandlordId(),
): Promise<boolean> {
  return isLandlordStripeConnectReady(landlordId)
}

export async function canVendorReceivePayments(vendorId: string): Promise<boolean> {
  return isVendorStripeConnectReady(vendorId)
}
