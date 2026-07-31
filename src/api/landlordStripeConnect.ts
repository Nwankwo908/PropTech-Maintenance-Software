/**
 * Client wrappers for landlord Stripe Express Connect (rent payouts).
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { requireAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isStripeConnectReady } from '@/lib/stripeConnectReady'

export type LandlordStripePayoutMethod = {
  id: string
  kind: 'bank_account' | 'card'
  label: string
  last4: string | null
  bankName: string | null
  brand: string | null
  funding: string | null
  defaultForCurrency: boolean
  currency: string | null
}

export type LandlordStripeConnectStatus = {
  accountId: string | null
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  ready: boolean
  payoutMethods: LandlordStripePayoutMethod[]
}

function resolveEdgeUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) {
    throw new Error("Payout setup isn't available right now. Please try again later.")
  }
  return `${base}/functions/v1/landlord-stripe-connect`
}


async function invokeLandlordStripeConnect(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetchAdminEdgeFunction(resolveEdgeUrl(), {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(requireAdminEdgeSecret('Payout setup')),
    body: JSON.stringify({
      ...body,
      landlordId:
        typeof body.landlordId === 'string' && body.landlordId.trim()
          ? body.landlordId.trim()
          : getActiveLandlordId(),
    }),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const raw =
      typeof json.error === 'string' && json.error.trim()
        ? json.error.trim()
        : "We couldn't complete payout setup. Please try again."
    throw new Error(raw)
  }
  return json
}

function parsePayoutMethod(raw: unknown): LandlordStripePayoutMethod | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const kind = row.kind === 'bank_account' || row.kind === 'card' ? row.kind : null
  const label = typeof row.label === 'string' ? row.label.trim() : ''
  if (!id || !kind || !label) return null
  return {
    id,
    kind,
    label,
    last4: typeof row.last4 === 'string' ? row.last4 : null,
    bankName: typeof row.bankName === 'string' ? row.bankName : null,
    brand: typeof row.brand === 'string' ? row.brand : null,
    funding: typeof row.funding === 'string' ? row.funding : null,
    defaultForCurrency: row.defaultForCurrency === true,
    currency: typeof row.currency === 'string' ? row.currency : null,
  }
}

function parseStatus(json: Record<string, unknown>): LandlordStripeConnectStatus {
  const methodsRaw = Array.isArray(json.payoutMethods) ? json.payoutMethods : []
  const payoutMethods = methodsRaw
    .map(parsePayoutMethod)
    .filter((m): m is LandlordStripePayoutMethod => m != null)

  const accountId =
    typeof json.accountId === 'string' && json.accountId.trim()
      ? json.accountId.trim()
      : null
  const chargesEnabled = json.chargesEnabled === true

  return {
    accountId,
    chargesEnabled,
    payoutsEnabled: json.payoutsEnabled === true,
    detailsSubmitted: json.detailsSubmitted === true,
    ready: isStripeConnectReady({ accountId, chargesEnabled }),
    payoutMethods,
  }
}

/** Primary masked payout destination for review / confirmation copy. */
export function primaryPayoutMethodLabel(
  status: LandlordStripeConnectStatus | null | undefined,
): string | null {
  if (!status?.payoutMethods?.length) return null
  const preferred =
    status.payoutMethods.find((m) => m.defaultForCurrency) ?? status.payoutMethods[0]
  return preferred?.label?.trim() || null
}

export async function fetchLandlordStripeConnectStatus(
  landlordId?: string,
): Promise<LandlordStripeConnectStatus> {
  const json = await invokeLandlordStripeConnect({
    action: 'status',
    landlordId,
  })
  return parseStatus(json)
}

export async function createLandlordConnectAccountLink(
  landlordId?: string,
): Promise<LandlordStripeConnectStatus & { url: string }> {
  const returnOrigin =
    typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : undefined
  const json = await invokeLandlordStripeConnect({
    action: 'create_connect_account_link',
    landlordId,
    ...(returnOrigin ? { returnOrigin } : {}),
  })
  const url = typeof json.url === 'string' ? json.url.trim() : ''
  if (!url) throw new Error('Could not open payout setup.')
  return { ...parseStatus(json), url }
}

export async function refreshLandlordConnectStatus(
  landlordId?: string,
): Promise<LandlordStripeConnectStatus> {
  const json = await invokeLandlordStripeConnect({
    action: 'refresh_connect_status',
    landlordId,
  })
  return parseStatus(json)
}
